import { Injectable } from '@nestjs/common';
import { RequestContext } from '../auth/request-context';
import { requireRow } from '../common/not-found';
import { DatabaseService } from '../database/database.service';
import { CreateTenantDto, UpdateTenantDto } from './dto';

@Injectable()
export class TenantsService {
  constructor(private readonly db: DatabaseService, private readonly context: RequestContext) {}

  async findAll() {
    const organizationId = this.context.organizationId();
    const { rows } = await this.db.query(`
      SELECT t.*, u.number AS unit_number, u.monthly_rent,
             b.id AS building_id, b.name AS building_name
      FROM tenants t
      JOIN units u ON u.id = t.unit_id
      JOIN buildings b ON b.id = u.building_id
      WHERE t.organization_id = $1 AND t.deleted_at IS NULL
      ORDER BY t.last_name, t.first_name
    `, [organizationId]);
    return rows;
  }

  async findOne(id: number) {
    const organizationId = this.context.organizationId();
    const { rows } = await this.db.query(
      `SELECT t.*, u.number AS unit_number, u.monthly_rent,
              b.id AS building_id, b.name AS building_name, b.address AS building_address
       FROM tenants t
       JOIN units u ON u.id = t.unit_id
       JOIN buildings b ON b.id = u.building_id
       WHERE t.id = $1 AND t.organization_id = $2 AND t.deleted_at IS NULL`,
      [id, organizationId],
    );
    const tenant = requireRow(rows[0], 'Tenant');
    const invoices = await this.db.query(
      `SELECT i.*, COALESCE(s.paid_amount, 0)::FLOAT AS paid_amount,
              COALESCE(s.remaining_amount, i.total)::FLOAT AS remaining_amount
       FROM invoices i
       LEFT JOIN invoice_payment_summary s ON s.invoice_id = i.id
       WHERE i.tenant_id = $1 AND i.organization_id = $2 AND i.deleted_at IS NULL
       ORDER BY i.due_date DESC`,
      [id, organizationId],
    );
    const payments = await this.db.query(
      `SELECT p.*, i.invoice_number
       FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
       WHERE i.tenant_id = $1 AND p.organization_id = $2 AND p.deleted_at IS NULL
       ORDER BY p.payment_date DESC`,
      [id, organizationId],
    );
    const financial = invoices.rows.reduce(
      (acc, invoice) => {
        acc.total_invoiced += Number(invoice.total);
        acc.total_paid += Number(invoice.paid_amount);
        acc.remaining += Number(invoice.remaining_amount);
        acc.invoices += 1;
        if (invoice.status === 'PAID') acc.paid_invoices += 1;
        if (invoice.status !== 'PAID') acc.unpaid_invoices += 1;
        if (invoice.status !== 'PAID' && new Date(invoice.due_date) < new Date()) acc.overdue_invoices += 1;
        return acc;
      },
      {
        total_invoiced: 0,
        total_paid: 0,
        remaining: 0,
        invoices: 0,
        paid_invoices: 0,
        unpaid_invoices: 0,
        overdue_invoices: 0,
      },
    );
    const situation =
      financial.overdue_invoices > 0 ? 'En retard' : financial.remaining > 0 ? 'Dette' : 'À jour';
    return { ...tenant, financial, invoices: invoices.rows, payments: payments.rows, situation };
  }

  async create(dto: CreateTenantDto) {
    const organizationId = this.context.organizationId();
    const { rows } = await this.db.query(
      `INSERT INTO tenants (first_name, last_name, phone, email, unit_id, move_in_date, status, organization_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [dto.first_name, dto.last_name, dto.phone, dto.email ?? null, dto.unit_id, dto.move_in_date, dto.status, organizationId],
    );
    await this.db.query(`UPDATE units SET status = 'OCCUPIED' WHERE id = $1 AND organization_id = $2`, [dto.unit_id, organizationId]);
    return rows[0];
  }

  async update(id: number, dto: UpdateTenantDto) {
    const previous = (await this.findOne(id)) as unknown as { unit_id: number };
    const { rows } = await this.db.query(
      `UPDATE tenants
       SET first_name = COALESCE($2, first_name),
           last_name = COALESCE($3, last_name),
           phone = COALESCE($4, phone),
           email = COALESCE($5, email),
           unit_id = COALESCE($6, unit_id),
           move_in_date = COALESCE($7, move_in_date),
           status = COALESCE($8, status)
       WHERE id = $1 AND organization_id = $9 AND deleted_at IS NULL RETURNING *`,
      [id, dto.first_name, dto.last_name, dto.phone, dto.email, dto.unit_id, dto.move_in_date, dto.status, this.context.organizationId()],
    );
    if (dto.unit_id && dto.unit_id !== previous.unit_id) {
      await this.db.query(`UPDATE units SET status = 'OCCUPIED' WHERE id = $1 AND organization_id = $2`, [dto.unit_id, this.context.organizationId()]);
      await this.db.query(
        `UPDATE units SET status = 'VACANT'
         WHERE id = $1 AND NOT EXISTS (
           SELECT 1 FROM tenants WHERE unit_id = $1 AND status = 'ACTIVE' AND deleted_at IS NULL
         )`,
        [previous.unit_id],
      );
    }
    return rows[0];
  }

  async remove(id: number) {
    const tenant = (await this.findOne(id)) as unknown as { unit_id: number };
    await this.db.query('UPDATE tenants SET deleted_at = NOW(), deleted_by = $2, status = $3 WHERE id = $1 AND organization_id = $4', [
      id,
      this.context.userId(),
      'INACTIVE',
      this.context.organizationId(),
    ]);
    await this.db.query(
      `UPDATE units SET status = 'VACANT'
       WHERE id = $1 AND NOT EXISTS (
         SELECT 1 FROM tenants WHERE unit_id = $1 AND status = 'ACTIVE' AND deleted_at IS NULL
       )`,
      [tenant.unit_id],
    );
    return { deleted: true };
  }
}
