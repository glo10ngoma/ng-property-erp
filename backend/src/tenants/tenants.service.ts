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
      SELECT t.*,
             ('CLI-' || LPAD(t.id::TEXT, 6, '0')) AS client_reference,
             u.id AS unit_id,
             u.number AS unit_number,
             COALESCE(l.monthly_rent, u.monthly_rent, 0)::FLOAT AS monthly_rent,
             l.id AS active_lease_id,
             l.end_date AS active_lease_end_date,
             l.status AS active_lease_status,
             b.id AS building_id,
             b.name AS building_name,
             COALESCE(fin.remaining_amount, 0)::FLOAT AS remaining_amount,
             fin.last_payment_date,
             fin.last_reminder_at,
             COALESCE(fin.reminder_count, 0)::INT AS reminder_count,
             COALESCE(fin.overdue_invoices, 0)::INT AS overdue_invoices
      FROM tenants t
      LEFT JOIN leases l ON l.tenant_id = t.id AND l.organization_id = t.organization_id AND l.status = 'ACTIVE' AND l.deleted_at IS NULL
      LEFT JOIN units u ON u.id = COALESCE(l.unit_id, t.unit_id)
      LEFT JOIN buildings b ON b.id = u.building_id
      LEFT JOIN (
        SELECT i.tenant_id,
               SUM(COALESCE(s.remaining_amount, i.total)) AS remaining_amount,
               MAX(p.payment_date) AS last_payment_date,
               MAX(i.last_reminder_at) AS last_reminder_at,
               SUM(COALESCE(i.reminder_count, 0)) AS reminder_count,
               COUNT(*) FILTER (WHERE i.status <> 'PAID' AND i.due_date < CURRENT_DATE) AS overdue_invoices
        FROM invoices i
        LEFT JOIN invoice_payment_summary s ON s.invoice_id = i.id
        LEFT JOIN payments p ON p.invoice_id = i.id AND p.deleted_at IS NULL
        WHERE i.organization_id = $1 AND i.deleted_at IS NULL
        GROUP BY i.tenant_id
      ) fin ON fin.tenant_id = t.id
      WHERE t.organization_id = $1 AND t.deleted_at IS NULL
      ORDER BY COALESCE(t.company_name, t.last_name, ''), COALESCE(t.first_name, '')
    `, [organizationId]);
    return rows;
  }

  async findOne(id: number) {
    const organizationId = this.context.organizationId();
    const { rows } = await this.db.query(
      `SELECT t.*, u.number AS unit_number, u.monthly_rent,
              b.id AS building_id, b.name AS building_name, b.address AS building_address
       FROM tenants t
       LEFT JOIN units u ON u.id = t.unit_id
       LEFT JOIN buildings b ON b.id = u.building_id
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
      `INSERT INTO tenants (
         tenant_type, first_name, last_name, post_name, company_name, rccm, tax_number, business_sector,
         legal_representative_name, legal_representative_role, legal_representative_phone, legal_representative_email,
         company_document_name, phone, secondary_phone, email, profession, address,
         id_document_type, id_number, id_document_file_name, id_document_file_url, nationality, emergency_contact_name, emergency_contact_phone, notes,
         unit_id, move_in_date, status, organization_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30) RETURNING *`,
      [
        dto.tenant_type ?? 'PHYSICAL',
        dto.first_name,
        dto.last_name,
        dto.post_name ?? null,
        dto.company_name ?? null,
        dto.rccm ?? null,
        dto.tax_number ?? null,
        dto.business_sector ?? null,
        dto.legal_representative_name ?? null,
        dto.legal_representative_role ?? null,
        dto.legal_representative_phone ?? null,
        dto.legal_representative_email || null,
        dto.company_document_name ?? null,
        dto.phone,
        dto.secondary_phone ?? null,
        dto.email || null,
        dto.profession ?? null,
        dto.address ?? null,
        dto.id_document_type ?? null,
        dto.id_number ?? null,
        dto.id_document_file_name ?? null,
        dto.id_document_file_url ?? null,
        dto.nationality ?? null,
        dto.emergency_contact_name ?? null,
        dto.emergency_contact_phone ?? null,
        dto.notes ?? null,
        dto.unit_id ?? null,
        dto.move_in_date ?? null,
        dto.status,
        organizationId,
      ],
    );
    if (dto.unit_id) await this.db.query(`UPDATE units SET status = 'OCCUPIED' WHERE id = $1 AND organization_id = $2`, [dto.unit_id, organizationId]);
    return rows[0];
  }

  async update(id: number, dto: UpdateTenantDto) {
    const previous = (await this.findOne(id)) as unknown as { unit_id?: number };
    const { rows } = await this.db.query(
      `UPDATE tenants
       SET tenant_type = COALESCE($2, tenant_type),
           first_name = COALESCE($3, first_name),
           last_name = COALESCE($4, last_name),
           post_name = COALESCE($5, post_name),
           company_name = COALESCE($6, company_name),
           rccm = COALESCE($7, rccm),
           tax_number = COALESCE($8, tax_number),
           business_sector = COALESCE($9, business_sector),
           legal_representative_name = COALESCE($10, legal_representative_name),
           legal_representative_role = COALESCE($11, legal_representative_role),
           legal_representative_phone = COALESCE($12, legal_representative_phone),
           legal_representative_email = COALESCE($13, legal_representative_email),
           company_document_name = COALESCE($14, company_document_name),
           phone = COALESCE($15, phone),
           secondary_phone = COALESCE($16, secondary_phone),
           email = COALESCE($17, email),
           profession = COALESCE($18, profession),
           address = COALESCE($19, address),
           id_document_type = COALESCE($20, id_document_type),
           id_number = COALESCE($21, id_number),
           id_document_file_name = COALESCE($22, id_document_file_name),
           id_document_file_url = COALESCE($23, id_document_file_url),
           nationality = COALESCE($24, nationality),
           emergency_contact_name = COALESCE($25, emergency_contact_name),
           emergency_contact_phone = COALESCE($26, emergency_contact_phone),
           notes = COALESCE($27, notes),
           unit_id = COALESCE($28, unit_id),
           move_in_date = COALESCE($29, move_in_date),
           status = COALESCE($30, status)
       WHERE id = $1 AND organization_id = $31 AND deleted_at IS NULL RETURNING *`,
      [
        id,
        dto.tenant_type,
        dto.first_name,
        dto.last_name,
        dto.post_name,
        dto.company_name,
        dto.rccm,
        dto.tax_number,
        dto.business_sector,
        dto.legal_representative_name,
        dto.legal_representative_role,
        dto.legal_representative_phone,
        dto.legal_representative_email,
        dto.company_document_name,
        dto.phone,
        dto.secondary_phone,
        dto.email,
        dto.profession,
        dto.address,
        dto.id_document_type,
        dto.id_number,
        dto.id_document_file_name,
        dto.id_document_file_url,
        dto.nationality,
        dto.emergency_contact_name,
        dto.emergency_contact_phone,
        dto.notes,
        dto.unit_id,
        dto.move_in_date,
        dto.status,
        this.context.organizationId(),
      ],
    );
    if (dto.unit_id && dto.unit_id !== previous.unit_id) {
      await this.db.query(`UPDATE units SET status = 'OCCUPIED' WHERE id = $1 AND organization_id = $2`, [dto.unit_id, this.context.organizationId()]);
      if (previous.unit_id) {
        await this.db.query(
          `UPDATE units SET status = 'VACANT'
           WHERE id = $1 AND NOT EXISTS (
             SELECT 1 FROM tenants WHERE unit_id = $1 AND status = 'ACTIVE' AND deleted_at IS NULL
           )`,
          [previous.unit_id],
        );
      }
    }
    return rows[0];
  }

  async remove(id: number) {
    const tenant = (await this.findOne(id)) as unknown as { unit_id?: number };
    await this.db.query('UPDATE tenants SET deleted_at = NOW(), deleted_by = $2, status = $3 WHERE id = $1 AND organization_id = $4', [
      id,
      this.context.userId(),
      'INACTIVE',
      this.context.organizationId(),
    ]);
    if (tenant.unit_id) {
      await this.db.query(
        `UPDATE units SET status = 'VACANT'
         WHERE id = $1 AND NOT EXISTS (
           SELECT 1 FROM tenants WHERE unit_id = $1 AND status = 'ACTIVE' AND deleted_at IS NULL
         )`,
        [tenant.unit_id],
      );
    }
    return { deleted: true };
  }
}
