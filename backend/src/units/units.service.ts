import { Injectable } from '@nestjs/common';
import { RequestContext } from '../auth/request-context';
import { requireRow } from '../common/not-found';
import { DatabaseService } from '../database/database.service';
import { CreateUnitDto, UpdateUnitDto } from './dto';

@Injectable()
export class UnitsService {
  constructor(private readonly db: DatabaseService, private readonly context: RequestContext) {}

  async findAll() {
    const organizationId = this.context.organizationId();
    const { rows } = await this.db.query(`
      SELECT u.*, b.name AS building_name, t.id AS tenant_id,
             CONCAT(t.first_name, ' ', t.last_name) AS tenant_name,
             t.phone AS tenant_phone
      FROM units u
      JOIN buildings b ON b.id = u.building_id
      LEFT JOIN tenants t ON t.unit_id = u.id AND t.status = 'ACTIVE' AND t.deleted_at IS NULL
      WHERE u.organization_id = $1 AND u.deleted_at IS NULL AND b.deleted_at IS NULL
      ORDER BY b.name, u.number
    `, [organizationId]);
    return rows;
  }

  async findOne(id: number) {
    const organizationId = this.context.organizationId();
    const { rows } = await this.db.query(
      `SELECT u.*, b.name AS building_name, b.address AS building_address,
              t.id AS tenant_id, CONCAT(t.first_name, ' ', t.last_name) AS tenant_name,
              t.phone AS tenant_phone, t.email AS tenant_email
       FROM units u
       JOIN buildings b ON b.id = u.building_id
       LEFT JOIN tenants t ON t.unit_id = u.id AND t.status = 'ACTIVE' AND t.deleted_at IS NULL
       WHERE u.id = $1 AND u.organization_id = $2 AND u.deleted_at IS NULL`,
      [id, organizationId],
    );
    const unit = requireRow(rows[0], 'Unit');
    const tenants = await this.db.query(
      `SELECT id, first_name, last_name, phone, email, move_in_date, status
       FROM tenants WHERE unit_id = $1 AND organization_id = $2 AND deleted_at IS NULL ORDER BY move_in_date DESC`,
      [id, organizationId],
    );
    const invoices = await this.db.query(
      `SELECT i.*, CONCAT(t.first_name, ' ', t.last_name) AS tenant_name,
              COALESCE(s.paid_amount, 0)::FLOAT AS paid_amount,
              COALESCE(s.remaining_amount, i.total)::FLOAT AS remaining_amount
       FROM invoices i
       JOIN tenants t ON t.id = i.tenant_id
       LEFT JOIN invoice_payment_summary s ON s.invoice_id = i.id
       WHERE t.unit_id = $1 AND i.organization_id = $2 AND i.deleted_at IS NULL
       ORDER BY i.due_date DESC`,
      [id, organizationId],
    );
    const payments = await this.db.query(
      `SELECT p.*, i.invoice_number, CONCAT(t.first_name, ' ', t.last_name) AS tenant_name
       FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
       JOIN tenants t ON t.id = i.tenant_id
       WHERE t.unit_id = $1 AND p.organization_id = $2 AND p.deleted_at IS NULL
       ORDER BY p.payment_date DESC`,
      [id, organizationId],
    );
    const hasDebt = invoices.rows.some((invoice) => Number(invoice.remaining_amount) > 0);
    const hasOverdue = invoices.rows.some(
      (invoice) => invoice.status !== 'PAID' && new Date(invoice.due_date) < new Date(),
    );
    return {
      ...unit,
      tenants: tenants.rows,
      invoices: invoices.rows,
      payments: payments.rows,
      situation: hasOverdue ? 'En retard' : hasDebt ? 'Dette' : 'À jour',
    };
  }

  async create(dto: CreateUnitDto) {
    const organizationId = this.context.organizationId();
    const { rows } = await this.db.query(
      `INSERT INTO units (building_id, number, floor, type, monthly_rent, status, organization_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [dto.building_id, dto.number, dto.floor, dto.type, dto.monthly_rent, dto.status, organizationId],
    );
    return rows[0];
  }

  async update(id: number, dto: UpdateUnitDto) {
    await this.findOne(id);
    const { rows } = await this.db.query(
      `UPDATE units
       SET building_id = COALESCE($2, building_id),
           number = COALESCE($3, number),
           floor = COALESCE($4, floor),
           type = COALESCE($5, type),
           monthly_rent = COALESCE($6, monthly_rent),
           status = COALESCE($7, status)
       WHERE id = $1 AND organization_id = $8 AND deleted_at IS NULL RETURNING *`,
      [id, dto.building_id, dto.number, dto.floor, dto.type, dto.monthly_rent, dto.status, this.context.organizationId()],
    );
    return rows[0];
  }

  async remove(id: number) {
    await this.findOne(id);
    await this.db.query('UPDATE units SET deleted_at = NOW(), deleted_by = $2 WHERE id = $1 AND organization_id = $3', [
      id,
      this.context.userId(),
      this.context.organizationId(),
    ]);
    return { deleted: true };
  }
}
