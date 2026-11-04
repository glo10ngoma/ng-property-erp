import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
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

  /**
   * Conservative transactional regeneration. Existing payments and credit allocations
   * remain untouched. Cancelled invoices and over-allocations require a separate
   * explicit accounting workflow, never silent resurrection or reassignment.
   */
  async confirm(invoiceId: number, reason: string, expectedTotal: number) {
    this.assertAdmin();
    if (!reason?.trim() || reason.trim().length < 8) {
      throw new BadRequestException('Motif de régénération obligatoire (8 caractères minimum).');
    }
    if (!Number.isFinite(expectedTotal) || expectedTotal < 0) {
      throw new BadRequestException('Montant attendu invalide.');
    }
    const organizationId = this.context.organizationId();
    return this.db.transaction(async (client: PoolClient) => {
      const { rows: locked } = await client.query(
        'SELECT id, status, total FROM invoices WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL FOR UPDATE',
        [invoiceId, organizationId],
      );
      if (!locked.length) throw new NotFoundException('Facture introuvable.');
      if (['CANCELLED', 'DRAFT'].includes(String(locked[0].status).toUpperCase())) {
        throw new BadRequestException('Facture annulée ou brouillon : réémission contrôlée nécessaire.');
      }
      const preview = await this.preview(invoiceId);
      if (Math.round(preview.proposed_total * 100) !== Math.round(expectedTotal * 100)) {
        throw new BadRequestException('Le montant a changé depuis la simulation : relancez la prévisualisation.');
      }
      const { rows: allocations } = await client.query(
        `SELECT COALESCE(SUM(pa.amount), 0)::numeric AS paid
           FROM payment_allocations pa
           JOIN payments p ON p.id = pa.payment_id AND p.organization_id = pa.organization_id
          WHERE pa.organization_id = $1 AND pa.invoice_id = $2
            AND pa.deleted_at IS NULL AND p.deleted_at IS NULL`,
        [organizationId, invoiceId],
      );
      const paid = Number(allocations[0]?.paid ?? 0);
      if (paid > preview.proposed_total + 0.00001) {
        throw new BadRequestException('Paiements supérieurs au nouveau total : réconciliation manuelle requise.');
      }
      // Avoid changing any payment or credit record.
      await client.query(
        'UPDATE invoice_items SET deleted_at = NOW(), deleted_by = $3 WHERE invoice_id = $1 AND organization_id = $2 AND deleted_at IS NULL',
        [invoiceId, organizationId, this.context.userId()],
      );
      for (const line of preview.lines) {
        await client.query(
          `INSERT INTO invoice_items (invoice_id, organization_id, item_type, description, amount)
           VALUES ($1, $2, $3, $4, $5)`,
          [invoiceId, organizationId, line.component_code === 'RENT' ? 'MONTHLY RENT' : line.component_code, line.component_label, line.amount],
        );
      }
      const nextStatus = paid <= 0 ? 'UNPAID' : paid + 0.00001 < preview.proposed_total ? 'PARTIAL' : 'PAID';
      await client.query(
        `UPDATE invoices SET total = $3, period_start = $4, period_end = $5,
               status = $6, internal_notes = CONCAT_WS(E'\\n', NULLIF(internal_notes, ''),
               $7)
          WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
        [invoiceId, organizationId, preview.proposed_total, preview.period_start, preview.period_end, nextStatus,
          '[REGENERATION] ' + new Date().toISOString() + ' | user=' + this.context.userId()
          + ' | ancien=' + locked[0].total + ' | nouveau=' + preview.proposed_total + ' | motif=' + reason.trim()],
      );
      return { invoice_id: invoiceId, old_total: Number(locked[0].total),
        new_total: preview.proposed_total, preserved_allocations: paid, status: nextStatus };
    });
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
    const storedEnd = String(invoice.period_end).slice(0, 10);
    // The stored period may be truncated by the old billing engine (e.g. 30 Oct).
    // For a monthly rent invoice, calculate through the actual last day of its month.
    const monthStart = start.slice(0, 7);
    const storedEndMonth = storedEnd.slice(0, 7);
    const end = monthStart === storedEndMonth
      ? `${start.slice(0, 7)}-${String(new Date(Number(start.slice(0, 4)), Number(start.slice(5, 7)), 0).getDate()).padStart(2, '0')}`
      : storedEnd;
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
      `SELECT COALESCE(SUM(pa.amount), 0)::numeric AS allocated
         FROM payment_allocations pa
         JOIN payments p ON p.id = pa.payment_id AND p.organization_id = pa.organization_id
        WHERE pa.organization_id = $1 AND pa.invoice_id = $2 AND pa.deleted_at IS NULL AND p.deleted_at IS NULL`,
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
