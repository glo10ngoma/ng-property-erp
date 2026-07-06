import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { RequestContext } from '../auth/request-context';
import { requireRow } from '../common/not-found';
import { DatabaseService } from '../database/database.service';
import { CreateInvoiceDto, InvoiceItemDto, UpdateInvoiceDto } from './dto';

@Injectable()
export class InvoicesService {
  constructor(private readonly db: DatabaseService, private readonly context: RequestContext) {}

  async findAll() {
    const organizationId = this.context.organizationId();
    const { rows } = await this.db.query(`
      SELECT i.*, t.first_name, t.last_name, u.number AS unit_number, b.name AS building_name,
             l.id AS lease_number,
             COALESCE(s.paid_amount, 0)::FLOAT AS paid_amount,
             COALESCE(s.remaining_amount, i.total)::FLOAT AS remaining_amount
      FROM invoices i
      JOIN tenants t ON t.id = i.tenant_id
      JOIN units u ON u.id = t.unit_id
      JOIN buildings b ON b.id = u.building_id
      LEFT JOIN leases l ON l.id = i.lease_id
      LEFT JOIN invoice_payment_summary s ON s.invoice_id = i.id
      WHERE i.organization_id = $1 AND i.deleted_at IS NULL
      ORDER BY i.issue_date DESC, i.id DESC
    `, [organizationId]);
    return rows;
  }

  async findOne(id: number) {
    const organizationId = this.context.organizationId();
    const { rows } = await this.db.query(
      `SELECT i.*, t.first_name, t.last_name, t.phone, t.email,
              u.number AS unit_number, u.monthly_rent,
              b.name AS building_name, b.address AS building_address, b.city AS building_city,
              l.start_date AS lease_start_date, l.end_date AS lease_end_date,
              COALESCE(s.paid_amount, 0)::FLOAT AS paid_amount,
              COALESCE(s.remaining_amount, i.total)::FLOAT AS remaining_amount
       FROM invoices i
       JOIN tenants t ON t.id = i.tenant_id
       JOIN units u ON u.id = t.unit_id
       JOIN buildings b ON b.id = u.building_id
       LEFT JOIN leases l ON l.id = i.lease_id
       LEFT JOIN invoice_payment_summary s ON s.invoice_id = i.id
       WHERE i.id = $1 AND i.organization_id = $2 AND i.deleted_at IS NULL`,
      [id, organizationId],
    );
    const invoice = requireRow(rows[0], 'Invoice');
    const items = await this.db.query('SELECT * FROM invoice_items WHERE invoice_id = $1 AND organization_id = $2 AND deleted_at IS NULL ORDER BY id', [id, organizationId]);
    const payments = await this.db.query('SELECT * FROM payments WHERE invoice_id = $1 AND organization_id = $2 AND deleted_at IS NULL ORDER BY payment_date DESC', [id, organizationId]);
    return { ...invoice, items: items.rows, payments: payments.rows };
  }

  async create(dto: CreateInvoiceDto) {
    return this.db.transaction(async (client) => {
      const lease = dto.lease_id ? await this.leaseForInvoice(client, dto.lease_id) : null;
      const tenantId = dto.tenant_id ?? lease?.tenant_id;
      if (!tenantId) throw new Error('tenant_id or lease_id is required');
      const nextId = await this.nextInvoiceId(client);
      const invoiceNumber = await this.nextInvoiceNumber(client);
      const total = this.calculateTotal(dto.items);
      const organizationId = this.context.organizationId();
      const { rows } = await client.query(
        `INSERT INTO invoices (id, tenant_id, lease_id, unit_id, building_id, invoice_number, month, year, issue_date, due_date, status, total, organization_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
        [
          nextId,
          tenantId,
          dto.lease_id ?? null,
          lease?.unit_id ?? null,
          lease?.building_id ?? null,
          invoiceNumber,
          dto.month,
          dto.year,
          dto.issue_date,
          dto.due_date,
          dto.status ?? 'UNPAID',
          total,
          organizationId,
        ],
      );
      await this.insertItems(client, rows[0].id, dto.items, organizationId);
      return rows[0];
    });
  }

  async update(id: number, dto: UpdateInvoiceDto) {
    await this.findOne(id);
    return this.db.transaction(async (client) => {
      if (dto.items) {
        await client.query('UPDATE invoice_items SET deleted_at = NOW(), deleted_by = $2 WHERE invoice_id = $1 AND organization_id = $3', [
          id,
          this.context.userId(),
          this.context.organizationId(),
        ]);
        await this.insertItems(client, id, dto.items, this.context.organizationId());
      }
      const total = dto.items ? this.calculateTotal(dto.items) : undefined;
      const { rows } = await client.query(
        `UPDATE invoices
         SET issue_date = COALESCE($2, issue_date),
             due_date = COALESCE($3, due_date),
             total = COALESCE($4, total)
         WHERE id = $1 AND organization_id = $5 AND deleted_at IS NULL RETURNING *`,
        [id, dto.issue_date, dto.due_date, total, this.context.organizationId()],
      );
      await this.refreshStatus(client, id);
      return rows[0];
    });
  }

  async validate(id: number) {
    const { rows } = await this.db.query(
      `UPDATE invoices SET status = 'UNPAID', validated_at = NOW()
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL AND status = 'DRAFT'
       RETURNING *`,
      [id, this.context.organizationId()],
    );
    return requireRow(rows[0], 'Invoice');
  }

  async cancel(id: number, reason: string) {
    await this.findOne(id);
    const { rows } = await this.db.query(
      `UPDATE invoices SET status = 'CANCELLED', cancelled_at = NOW(), cancellation_reason = $3
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [id, this.context.organizationId(), reason],
    );
    return rows[0];
  }

  async refreshStatus(client: PoolClient, invoiceId: number) {
    await client.query(
      `UPDATE invoices i
       SET status = CASE
         WHEN i.status = 'DRAFT' THEN 'DRAFT'
         WHEN i.status = 'CANCELLED' THEN 'CANCELLED'
         WHEN s.paid_amount <= 0 THEN 'UNPAID'
         WHEN s.paid_amount < i.total THEN 'PARTIAL'
         ELSE 'PAID'
       END
       FROM invoice_payment_summary s
       WHERE s.invoice_id = i.id AND i.id = $1`,
      [invoiceId],
    );
  }

  async remove(id: number) {
    await this.findOne(id);
    await this.db.query('UPDATE invoices SET deleted_at = NOW(), deleted_by = $2 WHERE id = $1 AND organization_id = $3', [
      id,
      this.context.userId(),
      this.context.organizationId(),
    ]);
    return { deleted: true };
  }

  private calculateTotal(items: InvoiceItemDto[]) {
    return items.reduce((sum, item) => sum + Number(item.amount), 0);
  }

  private async insertItems(client: PoolClient, invoiceId: number, items: InvoiceItemDto[], organizationId: number) {
    for (const item of items) {
      await client.query(
        'INSERT INTO invoice_items (invoice_id, item_type, description, amount, organization_id) VALUES ($1, $2, $3, $4, $5)',
        [invoiceId, item.item_type ?? item.description, item.description, item.amount, organizationId],
      );
    }
  }

  private async nextInvoiceId(client: PoolClient) {
    await client.query(
      `SELECT setval('invoices_id_seq', (SELECT COALESCE(MAX(id), 0) FROM invoices), true)`,
    );
    const { rows } = await client.query(`SELECT nextval('invoices_id_seq')::INT AS value`);
    return rows[0].value;
  }

  private async nextInvoiceNumber(client: PoolClient) {
    const year = new Date().getFullYear();
    const { rows } = await client.query(
      `SELECT COALESCE(
         MAX((SUBSTRING(invoice_number FROM $1))::INT),
         0
       ) + 1 AS value
       FROM invoices
       WHERE invoice_number LIKE $2`,
      [`INV-${year}-([0-9]+)`, `INV-${year}-%`],
    );
    return `INV-${year}-${String(rows[0].value).padStart(4, '0')}`;
  }

  private async leaseForInvoice(client: PoolClient, leaseId: number) {
    const { rows } = await client.query(
      `SELECT l.*, u.building_id
       FROM leases l
       JOIN units u ON u.id = l.unit_id
       WHERE l.id = $1 AND l.organization_id = $2 AND l.deleted_at IS NULL`,
      [leaseId, this.context.organizationId()],
    );
    return requireRow(rows[0], 'Lease') as { tenant_id: number; unit_id: number; building_id: number };
  }
}
