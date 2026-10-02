import { Injectable } from '@nestjs/common';
import { RequestContext } from '../auth/request-context';
import { DatabaseService } from '../database/database.service';

type AuditRow = {
  tenant_id: number;
  tenant_name: string;
  active_lease_count: number;
  active_lease_refs: string[];
  monthly_count: number;
  quarterly_count: number;
  other_frequency_count: number;
  monthly_contract_total: number;
  valid_invoice_count: number;
  invoiced_total: number;
  paid_total: number;
  outstanding_total: number;
  available_credit_usd: number;
  available_credit_cdf: number;
  guarantee_expected: number;
  guarantee_paid: number;
  guarantee_remaining: number;
  anomalies: string[];
};

@Injectable()
export class TenantAccountAuditService {
  constructor(
    private readonly db: DatabaseService,
    private readonly context: RequestContext,
  ) {}

  async report() {
    const organizationId = this.context.organizationId();
    const result = await this.db.query<AuditRow>(
      `WITH scoped_tenants AS (
         SELECT t.id,
                COALESCE(NULLIF(TRIM(t.company_name), ''), NULLIF(TRIM(CONCAT_WS(' ', t.first_name, t.last_name)), ''), CONCAT('Locataire #', t.id)) AS tenant_name
         FROM tenants t
         WHERE t.organization_id = $1
           AND t.deleted_at IS NULL
       ),
       active_leases AS (
         SELECT l.id, l.tenant_id, l.lease_number, l.start_date, l.end_date,
                COALESCE(l.billing_frequency_months, 1) AS billing_frequency_months,
                COALESCE(l.monthly_rent, 0) + COALESCE(l.maintenance_fee_amount, 0) + COALESCE(l.monthly_syndic_amount, 0) AS monthly_contract_total,
                COALESCE(g.amount, l.rental_guarantee_amount, 0) AS guarantee_expected,
                COALESCE(g.paid_amount, l.rental_guarantee_paid, 0) AS guarantee_paid,
                COALESCE(g.status, l.rental_guarantee_status, 'NOT_PAID') AS guarantee_status
         FROM leases l
         LEFT JOIN lease_guarantees g
           ON g.lease_id = l.id
          AND g.organization_id = l.organization_id
          AND g.deleted_at IS NULL
         WHERE l.organization_id = $1
           AND l.deleted_at IS NULL
           AND l.archived_at IS NULL
           AND l.status = 'ACTIVE'
       ),
       lease_stats AS (
         SELECT tenant_id,
                COUNT(*)::INT AS active_lease_count,
                ARRAY_AGG(COALESCE(lease_number, CONCAT('B-', id)) ORDER BY start_date, id) AS active_lease_refs,
                COUNT(*) FILTER (WHERE billing_frequency_months = 1)::INT AS monthly_count,
                COUNT(*) FILTER (WHERE billing_frequency_months = 3)::INT AS quarterly_count,
                COUNT(*) FILTER (WHERE billing_frequency_months NOT IN (1, 3))::INT AS other_frequency_count,
                COALESCE(SUM(monthly_contract_total), 0)::FLOAT AS monthly_contract_total,
                COALESCE(SUM(guarantee_expected), 0)::FLOAT AS guarantee_expected,
                COALESCE(SUM(guarantee_paid), 0)::FLOAT AS guarantee_paid,
                COALESCE(SUM(GREATEST(guarantee_expected - guarantee_paid, 0)), 0)::FLOAT AS guarantee_remaining,
                COUNT(*) FILTER (WHERE guarantee_paid > guarantee_expected + 0.01)::INT AS guarantee_overpaid_count,
                COUNT(*) FILTER (
                  WHERE (guarantee_paid >= guarantee_expected - 0.01 AND guarantee_expected > 0 AND guarantee_status NOT IN ('PAID', 'FULLY_PAID'))
                     OR (guarantee_paid < guarantee_expected - 0.01 AND guarantee_status IN ('PAID', 'FULLY_PAID'))
                )::INT AS guarantee_status_mismatch_count
         FROM active_leases
         GROUP BY tenant_id
       ),
       valid_invoices AS (
         SELECT i.id, i.tenant_id, i.lease_id, i.period_start, i.period_end, i.status, i.total,
                COALESCE(s.paid_amount, 0) AS paid_amount,
                COALESCE(s.remaining_amount, i.total) AS remaining_amount
         FROM invoices i
         LEFT JOIN invoice_payment_summary s ON s.invoice_id = i.id
         WHERE i.organization_id = $1
           AND i.deleted_at IS NULL
           AND i.status <> 'CANCELLED'
       ),
       invoice_stats AS (
         SELECT tenant_id,
                COUNT(*)::INT AS valid_invoice_count,
                COALESCE(SUM(total), 0)::FLOAT AS invoiced_total,
                COALESCE(SUM(paid_amount), 0)::FLOAT AS paid_total,
                COALESCE(SUM(remaining_amount), 0)::FLOAT AS outstanding_total,
                COUNT(*) FILTER (
                  WHERE (status = 'PAID' AND remaining_amount > 0.01)
                     OR (status IN ('UNPAID', 'OVERDUE') AND paid_amount > 0.01)
                     OR (status = 'PARTIAL' AND (paid_amount <= 0.01 OR remaining_amount <= 0.01))
                )::INT AS status_mismatch_count
         FROM valid_invoices
         GROUP BY tenant_id
       ),
       duplicate_invoices AS (
         SELECT tenant_id, COUNT(*)::INT AS duplicate_count
         FROM (
           SELECT tenant_id, lease_id, period_start
           FROM valid_invoices
           WHERE lease_id IS NOT NULL AND period_start IS NOT NULL
           GROUP BY tenant_id, lease_id, period_start
           HAVING COUNT(*) > 1
         ) duplicates
         GROUP BY tenant_id
       ),
       missing_current_invoices AS (
         SELECT al.tenant_id, COUNT(*)::INT AS missing_count
         FROM active_leases al
         WHERE al.start_date <= CURRENT_DATE
           AND (al.end_date IS NULL OR al.end_date >= DATE_TRUNC('month', CURRENT_DATE)::DATE)
           AND NOT EXISTS (
             SELECT 1
             FROM valid_invoices i
             WHERE i.lease_id = al.id
               AND i.period_start <= (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::DATE
               AND i.period_end >= DATE_TRUNC('month', CURRENT_DATE)::DATE
           )
         GROUP BY al.tenant_id
       ),
       out_of_period_invoices AS (
         SELECT i.tenant_id, COUNT(*)::INT AS out_of_period_count
         FROM valid_invoices i
         JOIN leases l
           ON l.id = i.lease_id
          AND l.organization_id = $1
         WHERE (i.period_end IS NOT NULL AND i.period_end < l.start_date)
            OR (l.end_date IS NOT NULL AND i.period_start IS NOT NULL AND i.period_start > l.end_date)
         GROUP BY i.tenant_id
       ),
       inactive_outstanding AS (
         SELECT i.tenant_id, COUNT(*)::INT AS inactive_outstanding_count
         FROM valid_invoices i
         JOIN leases l
           ON l.id = i.lease_id
          AND l.organization_id = $1
         WHERE i.remaining_amount > 0.01
           AND (l.deleted_at IS NOT NULL OR l.archived_at IS NOT NULL OR l.status <> 'ACTIVE')
         GROUP BY i.tenant_id
       ),
       credit_stats AS (
         SELECT tenant_id,
                COALESCE(SUM(remaining_amount) FILTER (WHERE currency = 'USD'), 0)::FLOAT AS available_credit_usd,
                COALESCE(SUM(remaining_amount) FILTER (WHERE currency = 'CDF'), 0)::FLOAT AS available_credit_cdf
         FROM tenant_credits
         WHERE organization_id = $1
           AND deleted_at IS NULL
           AND status IN ('AVAILABLE', 'PARTIALLY_USED')
           AND remaining_amount > 0
         GROUP BY tenant_id
       )
       SELECT st.id AS tenant_id,
              st.tenant_name,
              COALESCE(ls.active_lease_count, 0)::INT AS active_lease_count,
              COALESCE(ls.active_lease_refs, ARRAY[]::VARCHAR[]) AS active_lease_refs,
              COALESCE(ls.monthly_count, 0)::INT AS monthly_count,
              COALESCE(ls.quarterly_count, 0)::INT AS quarterly_count,
              COALESCE(ls.other_frequency_count, 0)::INT AS other_frequency_count,
              COALESCE(ls.monthly_contract_total, 0)::FLOAT AS monthly_contract_total,
              COALESCE(ins.valid_invoice_count, 0)::INT AS valid_invoice_count,
              COALESCE(ins.invoiced_total, 0)::FLOAT AS invoiced_total,
              COALESCE(ins.paid_total, 0)::FLOAT AS paid_total,
              COALESCE(ins.outstanding_total, 0)::FLOAT AS outstanding_total,
              COALESCE(cs.available_credit_usd, 0)::FLOAT AS available_credit_usd,
              COALESCE(cs.available_credit_cdf, 0)::FLOAT AS available_credit_cdf,
              COALESCE(ls.guarantee_expected, 0)::FLOAT AS guarantee_expected,
              COALESCE(ls.guarantee_paid, 0)::FLOAT AS guarantee_paid,
              COALESCE(ls.guarantee_remaining, 0)::FLOAT AS guarantee_remaining,
              ARRAY_REMOVE(ARRAY[
                CASE WHEN COALESCE(ins.status_mismatch_count, 0) > 0 THEN 'INVOICE_STATUS_MISMATCH' END,
                CASE WHEN COALESCE(di.duplicate_count, 0) > 0 THEN 'DUPLICATE_INVOICE_PERIOD' END,
                CASE WHEN COALESCE(mi.missing_count, 0) > 0 THEN 'MISSING_CURRENT_INVOICE' END,
                CASE WHEN COALESCE(op.out_of_period_count, 0) > 0 THEN 'INVOICE_OUTSIDE_LEASE' END,
                CASE WHEN COALESCE(io.inactive_outstanding_count, 0) > 0 THEN 'INACTIVE_LEASE_OUTSTANDING' END,
                CASE WHEN COALESCE(ls.guarantee_overpaid_count, 0) > 0 THEN 'GUARANTEE_OVERPAID' END,
                CASE WHEN COALESCE(ls.guarantee_status_mismatch_count, 0) > 0 THEN 'GUARANTEE_STATUS_MISMATCH' END
              ]::TEXT[], NULL) AS anomalies
       FROM scoped_tenants st
       LEFT JOIN lease_stats ls ON ls.tenant_id = st.id
       LEFT JOIN invoice_stats ins ON ins.tenant_id = st.id
       LEFT JOIN duplicate_invoices di ON di.tenant_id = st.id
       LEFT JOIN missing_current_invoices mi ON mi.tenant_id = st.id
       LEFT JOIN out_of_period_invoices op ON op.tenant_id = st.id
       LEFT JOIN inactive_outstanding io ON io.tenant_id = st.id
       LEFT JOIN credit_stats cs ON cs.tenant_id = st.id
       ORDER BY st.tenant_name, st.id`,
      [organizationId],
    );

    const rows = result.rows.map((row) => ({
      ...row,
      audit_status: row.anomalies.length > 0 ? 'A_VERIFIER' : 'OK',
      financial_status: Number(row.outstanding_total) > 0.01 ? 'SOLDE_DU' : 'A_JOUR',
      guarantee_status:
        Number(row.guarantee_expected) <= 0.01
          ? 'AUCUNE'
          : Number(row.guarantee_remaining) <= 0.01
            ? 'REGLEE'
            : Number(row.guarantee_paid) > 0.01
              ? 'PARTIELLE'
              : 'NON_REGLEE',
    }));

    return {
      generated_at: new Date().toISOString(),
      summary: {
        total_tenants: rows.length,
        active_tenants: rows.filter((row) => Number(row.active_lease_count) > 0).length,
        ok_accounts: rows.filter((row) => row.audit_status === 'OK').length,
        accounts_to_review: rows.filter((row) => row.audit_status === 'A_VERIFIER').length,
        outstanding_total: this.sum(rows, 'outstanding_total'),
        available_credit_usd: this.sum(rows, 'available_credit_usd'),
        available_credit_cdf: this.sum(rows, 'available_credit_cdf'),
        guarantee_expected: this.sum(rows, 'guarantee_expected'),
        guarantee_paid: this.sum(rows, 'guarantee_paid'),
        guarantee_remaining: this.sum(rows, 'guarantee_remaining'),
      },
      rows,
    };
  }

  private sum(rows: Record<string, unknown>[], field: string) {
    return Number(rows.reduce((total, row) => total + Number(row[field] ?? 0), 0).toFixed(2));
  }
}
