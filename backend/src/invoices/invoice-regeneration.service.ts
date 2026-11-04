import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { RequestContext } from '../auth/request-context';
import { calculateBillingCycleForPeriod, parseDate } from '../utils/billing-period';

/**
 * Read-only regeneration preview. No invoice, payment or credit is modified.
 * Deliberately blocks confirmation until a fully audited allocation reconciliation exists.
 */
@Injectable()
export class InvoiceRegenerationService {
  constructor(private readonly db: DatabaseService, private readonly context: RequestContext) {}

  private assertAdmin() {
    const user = this.context.user();
    const role = String(user?.organization_role ?? user?.role ?? '').toUpperCase();
    if (!user || !['ADMIN', 'OWNER', 'SUPER_ADMIN', 'ORG_ADMIN', 'ADMINISTRATOR'].includes(role)) {
      throw new ForbiddenException('Régénération réservée aux administrateurs de l’organisation.');
    }
  }

  async preview(invoiceId: number) {
    this.assertAdmin();
    const organizationId = this.context.organizationId();
    const { rows } = await this.db.query(
      `SELECT i.id, i.invoice_number, i.invoice_type, i.status, i.total,
              i.period_start::text, i.period_end::text, i.discount_amount,
              i.lease_id, l.start_date::text AS lease_start,
              l.monthly_rent, l.maintenance_fee_amount, l.monthly_syndic_amount,
              l.other_charges_amount, l.billing_frequency_months
         FROM invoices i
         JOIN leases l ON l.id = i.lease_id AND l.organization_id = i.organization_id
        WHERE i.id = $1 AND i.organization_id = $2
          AND i.deleted_at IS NULL AND l.deleted_at IS NULL`,
      [invoiceId, organizationId],
    );
    const invoice = rows[0];
    if (!invoice) throw new NotFoundException('Facture ou bail introuvable dans cette organisation.');
    if (invoice.invoice_type !== 'RENT') throw new BadRequestException('Seules les factures de loyer sont prises en charge.');
    const start = String(invoice.period_start).slice(0, 10);
    const end = String(invoice.period_end).slice(0, 10);
    const leaseStart = String(invoice.lease_start).slice(0, 10);
    const effectiveStart = start < leaseStart ? leaseStart : start;
    if (effectiveStart > end) throw new BadRequestException('Période antérieure au début du bail.');
    const rent = Number(invoice.monthly_rent) + Number(invoice.maintenance_fee_amount ?? 0);
    const syndic = Number(invoice.monthly_syndic_amount ?? 0);
    const other = Number(invoice.other_charges_amount ?? 0);
    const cycle = calculateBillingCycleForPeriod(parseDate(effectiveStart), parseDate(end), [
      { code: 'RENT', label: 'Loyer et maintenance', monthlyAmount: rent },
      { code: 'SYNDIC', label: 'Syndic', monthlyAmount: syndic },
      ...(other ? [{ code: 'OTHER', label: 'Autres charges', monthlyAmount: other }] : []),
    ]);
    // Business rule: syndic is a fixed monthly charge, not prorated.
    // Each monthly syndic line is charged in full even in the initial partial month.
    for (const line of cycle.lines) {
      if (line.component_code === 'SYNDIC') line.amount = Math.round(syndic * 100) / 100;
    }
    cycle.total_amount = Math.round(cycle.lines.reduce((sum, line) => sum + line.amount, 0) * 100) / 100;
    const { rows: allocations } = await this.db.query(
      `SELECT COALESCE(SUM(amount), 0)::numeric AS allocated
         FROM payment_allocations
        WHERE organization_id = $1 AND invoice_id = $2 AND deleted_at IS NULL`,
      [organizationId, invoiceId],
    );
    const { rows: credits } = await this.db.query(
      `SELECT COALESCE(SUM(amount_applied), 0)::numeric AS credit_allocated
         FROM tenant_credit_allocations
        WHERE organization_id = $1 AND invoice_id = $2 AND deleted_at IS NULL`,
      [organizationId, invoiceId],
    );
    const allocated = Number(allocations[0]?.allocated ?? 0);
    const creditAllocated = Number(credits[0]?.credit_allocated ?? 0);
    const discount = Number(invoice.discount_amount ?? 0);
    const proposedTotal = Math.max(0, Math.round((cycle.total_amount - discount) * 100) / 100);
    return {
      invoice_id: invoiceId, invoice_number: invoice.invoice_number,
      status: invoice.status, period_start: effectiveStart, period_end: end,
      current_total: Number(invoice.total), proposed_total: proposedTotal,
      delta: Math.round((proposedTotal - Number(invoice.total)) * 100) / 100,
      lines: cycle.lines, discount_amount: discount,
      allocated_payments: allocated, allocated_credits_included: creditAllocated,
      proposed_balance: Math.max(0, Math.round((proposedTotal - allocated) * 100) / 100),
      warnings: [
        ...(invoice.status === 'CANCELLED' ? ['Facture annulée : réémission avec traçabilité obligatoire.'] : []),
        ...(allocated > proposedTotal ? ['Paiements supérieurs au montant recalculé : réconciliation nécessaire.'] : []),
        ...(creditAllocated > 0 ? ['Crédits locataires : vérifier les affectations inter-factures.'] : []),
        'Simulation uniquement : aucune écriture financière modifiée.',
      ],
      can_confirm: false,
    };
  }
}
