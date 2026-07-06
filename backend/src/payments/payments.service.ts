import { Injectable } from '@nestjs/common';
import { RequestContext } from '../auth/request-context';
import { requireRow } from '../common/not-found';
import { DatabaseService } from '../database/database.service';
import { InvoicesService } from '../invoices/invoices.service';
import { SaasService } from '../saas/saas.service';
import { CreatePaymentDto, UpdatePaymentDto } from './dto';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly invoices: InvoicesService,
    private readonly saas: SaasService,
    private readonly context: RequestContext,
  ) {}

  async findAll() {
    const organizationId = this.context.organizationId();
    const { rows } = await this.db.query(`
      SELECT p.*, i.invoice_number, i.total, i.status,
             CONCAT(t.first_name, ' ', t.last_name) AS tenant_name
      FROM payments p
      LEFT JOIN invoices i ON i.id = p.invoice_id
      JOIN tenants t ON t.id = i.tenant_id
      WHERE p.organization_id = $1 AND p.deleted_at IS NULL
      ORDER BY p.payment_date DESC, p.id DESC
    `, [organizationId]);
    return rows;
  }

  async findOne(id: number) {
    const { rows } = await this.db.query('SELECT * FROM payments WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL', [
      id,
      this.context.organizationId(),
    ]);
    const payment = requireRow(rows[0], 'Payment');
    const allocations = await this.db.query(
      `SELECT pa.*, i.invoice_number
       FROM payment_allocations pa
       JOIN invoices i ON i.id = pa.invoice_id
       WHERE pa.payment_id = $1 AND pa.organization_id = $2 AND pa.deleted_at IS NULL
       ORDER BY pa.id`,
      [id, this.context.organizationId()],
    );
    return { ...payment, allocations: allocations.rows };
  }

  async create(dto: CreatePaymentDto) {
    return this.db.transaction(async (client) => {
      const allocations = this.allocationsFromDto(dto);
      const total = allocations.reduce((sum, allocation) => sum + Number(allocation.amount), 0);
      const primaryInvoiceId = dto.invoice_id ?? allocations[0]?.invoice_id;
      const receiptNumber = await this.nextReceiptNumber(client);
      const { rows } = await client.query(
        `INSERT INTO payments (invoice_id, payment_date, amount, payment_method, reference, notes, payer_name, receipt_number, organization_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [primaryInvoiceId, dto.payment_date, total || dto.amount, dto.payment_method, dto.reference ?? null, dto.notes ?? null, dto.payer_name ?? null, receiptNumber, this.context.organizationId()],
      );
      for (const allocation of allocations) {
        await client.query(
          `INSERT INTO payment_allocations (payment_id, invoice_id, amount, organization_id)
           VALUES ($1, $2, $3, $4)`,
          [rows[0].id, allocation.invoice_id, allocation.amount, this.context.organizationId()],
        );
        await this.invoices.refreshStatus(client, allocation.invoice_id);
      }
      await this.saas.createInvoicePaymentMovement(client, rows[0].id, primaryInvoiceId, total || dto.amount, dto.reference);
      return rows[0];
    });
  }

  async update(id: number, dto: UpdatePaymentDto) {
    await this.findOne(id);
    return this.db.transaction(async (client) => {
      const invoiceId = Number(dto.invoice_id);
      const { rows } = await client.query(
        `UPDATE payments
         SET invoice_id = $2, payment_date = $3, amount = $4,
             payment_method = $5, reference = $6, notes = $7
         WHERE id = $1 AND organization_id = $8 AND deleted_at IS NULL RETURNING *`,
        [id, invoiceId, dto.payment_date, dto.amount, dto.payment_method, dto.reference ?? null, dto.notes ?? null, this.context.organizationId()],
      );
      await this.invoices.refreshStatus(client, invoiceId);
      return rows[0];
    });
  }

  async remove(id: number) {
    const payment = await this.findOne(id);
    await this.db.transaction(async (client) => {
      await client.query('UPDATE payments SET deleted_at = NOW(), deleted_by = $2 WHERE id = $1 AND organization_id = $3', [
        id,
        this.context.userId(),
        this.context.organizationId(),
      ]);
      await client.query('UPDATE payment_allocations SET deleted_at = NOW(), deleted_by = $2 WHERE payment_id = $1 AND organization_id = $3', [
        id,
        this.context.userId(),
        this.context.organizationId(),
      ]);
      for (const allocation of payment.allocations ?? []) {
        await this.invoices.refreshStatus(client, allocation.invoice_id);
      }
    });
    return { deleted: true };
  }

  private allocationsFromDto(dto: CreatePaymentDto) {
    if (dto.allocations?.length) return dto.allocations;
    return [{ invoice_id: Number(dto.invoice_id), amount: Number(dto.amount) }];
  }

  private async nextReceiptNumber(client: import('pg').PoolClient) {
    const year = new Date().getFullYear();
    const { rows } = await client.query(
      `SELECT COALESCE(MAX((SUBSTRING(receipt_number FROM $1))::INT), 0) + 1 AS value
       FROM payments
       WHERE receipt_number LIKE $2 AND organization_id = $3`,
      [`RCPT-${year}-([0-9]+)`, `RCPT-${year}-%`, this.context.organizationId()],
    );
    return `RCPT-${year}-${String(rows[0].value).padStart(4, '0')}`;
  }
}
