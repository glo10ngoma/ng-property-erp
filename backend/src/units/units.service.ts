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
             t.phone AS tenant_phone,
             l.end_date AS active_lease_end_date
      FROM units u
      JOIN buildings b ON b.id = u.building_id
      LEFT JOIN tenants t ON t.unit_id = u.id AND t.status = 'ACTIVE' AND t.deleted_at IS NULL
      LEFT JOIN leases l ON l.unit_id = u.id AND l.status = 'ACTIVE' AND l.deleted_at IS NULL
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
              t.phone AS tenant_phone, t.email AS tenant_email,
              l.end_date AS active_lease_end_date
       FROM units u
       JOIN buildings b ON b.id = u.building_id
       LEFT JOIN tenants t ON t.unit_id = u.id AND t.status = 'ACTIVE' AND t.deleted_at IS NULL
       LEFT JOIN leases l ON l.unit_id = u.id AND l.status = 'ACTIVE' AND l.deleted_at IS NULL
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
    const leases = await this.db.query(
      `SELECT l.*, CONCAT(t.first_name, ' ', t.last_name) AS tenant_name, t.phone, t.email
       FROM leases l
       JOIN tenants t ON t.id = l.tenant_id
       WHERE l.unit_id = $1 AND l.organization_id = $2 AND l.deleted_at IS NULL
       ORDER BY l.start_date DESC, l.id DESC`,
      [id, organizationId],
    );
    const maintenance = await this.db.query(
      `SELECT id, request_number, title, status, priority, reported_at, resolved_at
       FROM maintenance_requests
       WHERE unit_id = $1 AND organization_id = $2 AND deleted_at IS NULL
       ORDER BY reported_at DESC, id DESC`,
      [id, organizationId],
    );
    const hasDebt = invoices.rows.some((invoice) => Number(invoice.remaining_amount) > 0);
    const hasOverdue = invoices.rows.some((invoice) => invoice.status !== 'PAID' && new Date(invoice.due_date) < new Date());
    return {
      ...unit,
      tenants: tenants.rows,
      leases: leases.rows,
      invoices: invoices.rows,
      payments: payments.rows,
      rent_history: leases.rows.map((lease) => ({
        id: lease.id,
        start_date: lease.start_date,
        end_date: lease.end_date,
        monthly_rent: lease.monthly_rent,
        tenant_name: lease.tenant_name,
      })),
      maintenance: maintenance.rows,
      documents: [],
      photos: [],
      timeline: this.unitTimeline(unit, leases.rows, payments.rows, maintenance.rows),
      situation: hasOverdue ? 'En retard' : hasDebt ? 'Dette' : 'À jour',
    };
  }

  async create(dto: CreateUnitDto) {
    const organizationId = this.context.organizationId();
    const { rows } = await this.db.query(
      `INSERT INTO units (
         building_id, number, floor, type, monthly_rent, status, organization_id,
         surface_area, bedrooms_count, bathrooms_count, has_balcony, has_parking, is_furnished,
         has_air_conditioning, has_equipped_kitchen, has_internet, has_water_meter, water_meter_number,
         has_electricity_meter, electricity_meter_number, description, observations
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
       RETURNING *`,
      [
        dto.building_id,
        dto.number,
        dto.floor,
        dto.type,
        dto.monthly_rent,
        dto.status,
        organizationId,
        dto.surface_area ?? null,
        dto.bedrooms_count ?? null,
        dto.bathrooms_count ?? null,
        Boolean(dto.has_balcony),
        Boolean(dto.has_parking),
        Boolean(dto.is_furnished),
        Boolean(dto.has_air_conditioning),
        Boolean(dto.has_equipped_kitchen),
        Boolean(dto.has_internet),
        Boolean(dto.has_water_meter),
        dto.water_meter_number ?? null,
        Boolean(dto.has_electricity_meter),
        dto.electricity_meter_number ?? null,
        dto.description ?? null,
        dto.observations ?? null,
      ],
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
           status = COALESCE($7, status),
           surface_area = COALESCE($8, surface_area),
           bedrooms_count = COALESCE($9, bedrooms_count),
           bathrooms_count = COALESCE($10, bathrooms_count),
           has_balcony = COALESCE($11, has_balcony),
           has_parking = COALESCE($12, has_parking),
           is_furnished = COALESCE($13, is_furnished),
           has_air_conditioning = COALESCE($14, has_air_conditioning),
           has_equipped_kitchen = COALESCE($15, has_equipped_kitchen),
           has_internet = COALESCE($16, has_internet),
           has_water_meter = COALESCE($17, has_water_meter),
           water_meter_number = COALESCE($18, water_meter_number),
           has_electricity_meter = COALESCE($19, has_electricity_meter),
           electricity_meter_number = COALESCE($20, electricity_meter_number),
           description = COALESCE($21, description),
           observations = COALESCE($22, observations)
       WHERE id = $1 AND organization_id = $23 AND deleted_at IS NULL RETURNING *`,
      [
        id,
        dto.building_id,
        dto.number,
        dto.floor,
        dto.type,
        dto.monthly_rent,
        dto.status,
        dto.surface_area,
        dto.bedrooms_count,
        dto.bathrooms_count,
        dto.has_balcony,
        dto.has_parking,
        dto.is_furnished,
        dto.has_air_conditioning,
        dto.has_equipped_kitchen,
        dto.has_internet,
        dto.has_water_meter,
        dto.water_meter_number,
        dto.has_electricity_meter,
        dto.electricity_meter_number,
        dto.description,
        dto.observations,
        this.context.organizationId(),
      ],
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

  private unitTimeline(unit: Record<string, any>, leases: Record<string, any>[], payments: Record<string, any>[], maintenance: Record<string, any>[]) {
    const events = [
      { date: unit.created_at, title: 'Appartement créé' },
      ...leases.flatMap((lease) => [
        { date: lease.start_date, title: `Bail signé - ${lease.tenant_name}` },
        lease.end_date ? { date: lease.end_date, title: 'Fin du bail' } : null,
      ]).filter(Boolean),
      ...payments.map((payment) => ({ date: payment.payment_date, title: `Paiement ${payment.invoice_number}` })),
      ...maintenance.map((item) => ({ date: item.reported_at, title: `Intervention maintenance ${item.request_number ?? item.id}` })),
    ];
    return events.filter((event) => event?.date).sort((a, b) => new Date(String(b?.date)).getTime() - new Date(String(a?.date)).getTime());
  }
}
