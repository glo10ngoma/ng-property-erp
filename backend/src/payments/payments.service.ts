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
      SELECT p.*, i.invoice_number, i.total, i.status AS invoice_status,
             CASE WHEN t.tenant_type = 'COMPANY' THEN COALESCE(t.company_name, '')
                  ELSE TRIM(CONCAT(COALESCE(t.first_name, ''), ' ', COALESCE(t.last_name, ''), ' ', COALESCE(t.post_name, '')))
             END AS tenant_name,
             t.phone AS tenant_phone,
             t.email AS tenant_email,
             u.number AS unit_number,
             b.name AS building_name
      FROM payments p
      LEFT JOIN invoices i ON i.id = p.invoice_id
      JOIN tenants t ON t.id = i.tenant_id
      LEFT JOIN leases l ON l.id = i.lease_id
      LEFT JOIN units u ON u.id = COALESCE(i.unit_id, l.unit_id, t.unit_id)
      LEFT JOIN buildings b ON b.id = COALESCE(i.building_id, u.building_id)
      WHERE p.organization_id = $1 AND p.deleted_at IS NULL
      ORDER BY p.payment_date DESC, p.id DESC
    `, [organizationId]);
    return rows;
  }

  async findOne(id: number) {
    const organizationId = this.context.organizationId();
    const { rows } = await this.db.query(
      `SELECT p.*, i.invoice_number, i.month, i.year, i.issue_date, i.due_date, i.total AS invoice_total, i.status AS invoice_status,
              CASE WHEN t.tenant_type = 'COMPANY' THEN COALESCE(t.company_name, '')
                   ELSE TRIM(CONCAT(COALESCE(t.first_name, ''), ' ', COALESCE(t.last_name, ''), ' ', COALESCE(t.post_name, '')))
              END AS tenant_name,
              t.tenant_type, t.phone AS tenant_phone, t.secondary_phone AS tenant_secondary_phone, t.email AS tenant_email,
              t.company_name, t.rccm, t.tax_number, t.business_sector,
              u.number AS unit_number, u.monthly_rent, u.status AS unit_status,
              b.name AS building_name, b.address AS building_address, b.city AS building_city, b.commune AS building_commune,
              l.id AS lease_id, l.start_date AS lease_start_date, l.end_date AS lease_end_date, l.status AS lease_status
       FROM payments p
       LEFT JOIN invoices i ON i.id = p.invoice_id
       LEFT JOIN tenants t ON t.id = i.tenant_id
       LEFT JOIN leases l ON l.id = i.lease_id
       LEFT JOIN units u ON u.id = COALESCE(i.unit_id, l.unit_id, t.unit_id)
       LEFT JOIN buildings b ON b.id = COALESCE(i.building_id, u.building_id)
       WHERE p.id = $1 AND p.organization_id = $2 AND p.deleted_at IS NULL`,
      [id, organizationId],
    );
    const payment = requireRow(rows[0], 'Payment');
    const allocations = await this.db.query(
      `SELECT pa.*, i.invoice_number
       FROM payment_allocations pa
       JOIN invoices i ON i.id = pa.invoice_id
       WHERE pa.payment_id = $1 AND pa.organization_id = $2 AND pa.deleted_at IS NULL
       ORDER BY pa.id`,
      [id, organizationId],
    );
    const reminders = payment.invoice_id
      ? await this.db.query(
        `SELECT * FROM invoice_reminders WHERE invoice_id = $1 AND organization_id = $2 ORDER BY reminded_at DESC`,
        [payment.invoice_id, organizationId],
      )
      : { rows: [] };
    const audit = await this.db.query(
      `SELECT al.id, al.created_at AS date, al.action, al.resource, al.method, al.path, al.status_code, al.metadata,
              CONCAT(u.first_name, ' ', u.last_name) AS user_name
       FROM audit_logs al
       LEFT JOIN app_users u ON u.id = al.user_id
       WHERE al.organization_id = $1 AND al.resource = 'payments' AND al.resource_id = $2
       ORDER BY al.created_at DESC`,
      [organizationId, String(id)],
    );
    return { ...payment, allocations: allocations.rows, reminders: reminders.rows, audit: audit.rows };
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
