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
      SELECT u.*, b.name AS building_name,
             current_lease.current_tenant_id AS tenant_id,
             current_lease.current_tenant_name AS tenant_name,
             current_lease.current_tenant_phone AS tenant_phone,
             current_lease.current_lease_end_date AS active_lease_end_date,
             current_lease.current_tenant_id,
             current_lease.current_tenant_name,
             current_lease.current_tenant_phone,
             current_lease.current_lease_id,
             current_lease.current_lease_number,
             current_lease.current_lease_status,
             current_lease.current_lease_start_date,
             current_lease.current_lease_end_date,
             current_lease.current_lease_monthly_rent,
             current_lease.current_lease_maintenance_fee_amount
      FROM units u
      JOIN buildings b ON b.id = u.building_id
      LEFT JOIN LATERAL (
        SELECT l.id AS current_lease_id,
               l.lease_number AS current_lease_number,
               l.status AS current_lease_status,
               l.start_date AS current_lease_start_date,
               l.end_date AS current_lease_end_date,
               l.monthly_rent AS current_lease_monthly_rent,
               l.maintenance_fee_amount AS current_lease_maintenance_fee_amount,
               t.id AS current_tenant_id,
               CASE
                 WHEN t.tenant_type = 'COMPANY' THEN COALESCE(NULLIF(TRIM(t.company_name), ''), 'Societe')
                 ELSE COALESCE(
                   NULLIF(CONCAT_WS(' ', NULLIF(TRIM(t.first_name), ''), NULLIF(TRIM(t.post_name), ''), NULLIF(TRIM(t.last_name), '')), ''),
                   NULLIF(CONCAT_WS(' ', NULLIF(TRIM(t.first_name), ''), NULLIF(TRIM(t.last_name), '')), ''),
                   'Locataire'
                 )
               END AS current_tenant_name,
               CASE
                 WHEN t.tenant_type = 'COMPANY' THEN COALESCE(NULLIF(TRIM(t.phone), ''), NULLIF(TRIM(t.legal_representative_phone), ''))
                 ELSE COALESCE(NULLIF(TRIM(t.phone), ''), NULLIF(TRIM(t.secondary_phone), ''))
               END AS current_tenant_phone
        FROM leases l
        JOIN tenants t ON t.id = l.tenant_id
                     AND t.organization_id = u.organization_id
                     AND t.deleted_at IS NULL
        WHERE l.unit_id = u.id
          AND l.organization_id = u.organization_id
          AND l.deleted_at IS NULL
          AND l.start_date <= CURRENT_DATE
          AND (l.end_date IS NULL OR l.end_date >= CURRENT_DATE)
          AND COALESCE(l.status, '') NOT IN ('DRAFT', 'CANCELLED')
        ORDER BY CASE
                   WHEN l.status = 'ACTIVE' THEN 0
                   WHEN l.status IN ('SIGNED', 'VALIDATED', 'PENDING') THEN 1
                   WHEN l.status = 'TERMINATED' THEN 2
                   ELSE 3
                 END,
                 l.start_date DESC,
                 l.id DESC
        LIMIT 1
      ) current_lease ON TRUE
      WHERE u.organization_id = $1 AND u.deleted_at IS NULL AND b.deleted_at IS NULL
      ORDER BY b.name, u.number
    `, [organizationId]);
    return rows;
  }

  async findOne(id: number) {
    const organizationId = this.context.organizationId();
    const { rows } = await this.db.query(
      `SELECT u.*, b.name AS building_name, b.address AS building_address,
              current_lease.current_tenant_id AS tenant_id,
              current_lease.current_tenant_name AS tenant_name,
              current_lease.current_tenant_phone AS tenant_phone,
              current_lease.current_tenant_email AS tenant_email,
              current_lease.current_lease_end_date AS active_lease_end_date,
              current_lease.current_tenant_id,
              current_lease.current_tenant_name,
              current_lease.current_tenant_phone,
              current_lease.current_tenant_email,
              current_lease.current_lease_id,
              current_lease.current_lease_number,
              current_lease.current_lease_status,
              current_lease.current_lease_start_date,
              current_lease.current_lease_end_date,
              current_lease.current_lease_monthly_rent,
              current_lease.current_lease_maintenance_fee_amount
       FROM units u
       JOIN buildings b ON b.id = u.building_id
       LEFT JOIN LATERAL (
         SELECT l.id AS current_lease_id,
                l.lease_number AS current_lease_number,
                l.status AS current_lease_status,
                l.start_date AS current_lease_start_date,
                l.end_date AS current_lease_end_date,
                l.monthly_rent AS current_lease_monthly_rent,
                l.maintenance_fee_amount AS current_lease_maintenance_fee_amount,
                t.id AS current_tenant_id,
                CASE
                  WHEN t.tenant_type = 'COMPANY' THEN COALESCE(NULLIF(TRIM(t.company_name), ''), 'Societe')
                  ELSE COALESCE(
                    NULLIF(CONCAT_WS(' ', NULLIF(TRIM(t.first_name), ''), NULLIF(TRIM(t.post_name), ''), NULLIF(TRIM(t.last_name), '')), ''),
                    NULLIF(CONCAT_WS(' ', NULLIF(TRIM(t.first_name), ''), NULLIF(TRIM(t.last_name), '')), ''),
                    'Locataire'
                  )
                END AS current_tenant_name,
                CASE
                  WHEN t.tenant_type = 'COMPANY' THEN COALESCE(NULLIF(TRIM(t.phone), ''), NULLIF(TRIM(t.legal_representative_phone), ''))
                  ELSE COALESCE(NULLIF(TRIM(t.phone), ''), NULLIF(TRIM(t.secondary_phone), ''))
                END AS current_tenant_phone,
                t.email AS current_tenant_email
         FROM leases l
         JOIN tenants t ON t.id = l.tenant_id
                      AND t.organization_id = u.organization_id
                      AND t.deleted_at IS NULL
         WHERE l.unit_id = u.id
           AND l.organization_id = u.organization_id
           AND l.deleted_at IS NULL
           AND l.start_date <= CURRENT_DATE
           AND (l.end_date IS NULL OR l.end_date >= CURRENT_DATE)
           AND COALESCE(l.status, '') NOT IN ('DRAFT', 'CANCELLED')
         ORDER BY CASE
                    WHEN l.status = 'ACTIVE' THEN 0
                    WHEN l.status IN ('SIGNED', 'VALIDATED', 'PENDING') THEN 1
                    WHEN l.status = 'TERMINATED' THEN 2
                    ELSE 3
                  END,
                  l.start_date DESC,
                  l.id DESC
         LIMIT 1
       ) current_lease ON TRUE
       WHERE u.id = $1 AND u.organization_id = $2 AND u.deleted_at IS NULL`,
      [id, organizationId],
    );
    const unit = requireRow(rows[0], 'Unit');
    const tenants = await this.db.query(
      `SELECT id, first_name, last_name, post_name, phone, secondary_phone, email, profession,
              nationality, address, id_number, id_document_file_name, id_document_file_url,
              move_in_date, status, notes
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
    const invoiceSummaries = await this.db.query(
      `SELECT invoice_id,
              COALESCE(SUM(CASE WHEN item_type = 'Monthly rent' OR description = 'Monthly rent' OR description ILIKE 'Loyer %' THEN amount ELSE 0 END), 0)::FLOAT AS rent_amount,
              COALESCE(SUM(CASE WHEN item_type = 'Syndic' OR description = 'Syndic' OR description ILIKE 'Syndic %' THEN amount ELSE 0 END), 0)::FLOAT AS syndic_amount
       FROM invoice_items
       WHERE organization_id = $1
         AND deleted_at IS NULL
         AND invoice_id = ANY($2::INT[])
       GROUP BY invoice_id`,
      [organizationId, invoices.rows.length ? invoices.rows.map((invoice) => Number(invoice.id)) : [0]],
    );
    const invoiceSummaryMap = new Map(invoiceSummaries.rows.map((row) => [Number(row.invoice_id), row]));
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
      `SELECT l.*, CONCAT(t.first_name, ' ', t.last_name) AS tenant_name, t.phone, t.email,
              COALESCE(g.amount, l.rental_guarantee_amount, 0)::FLOAT AS guarantee_amount,
              COALESCE(g.paid_amount, l.rental_guarantee_paid, 0)::FLOAT AS guarantee_paid,
              COALESCE(g.status, l.rental_guarantee_status) AS guarantee_status
       FROM leases l
       JOIN tenants t ON t.id = l.tenant_id
       LEFT JOIN lease_guarantees g ON g.lease_id = l.id AND g.deleted_at IS NULL
       WHERE l.unit_id = $1 AND l.organization_id = $2 AND l.deleted_at IS NULL
       ORDER BY l.start_date DESC, l.id DESC`,
      [id, organizationId],
    );
    const maintenance = await this.db.query(
      `SELECT mr.id, mr.request_number, mr.title, mr.description, mr.status, mr.priority, mr.reported_at,
              mr.resolved_at, mr.external_provider, mr.resolution_comments,
              COALESCE(SUM(me.amount) FILTER (WHERE me.deleted_at IS NULL AND me.status <> 'REJECTED'), 0)::FLOAT AS cost
       FROM maintenance_requests mr
       LEFT JOIN maintenance_expenses me ON me.maintenance_request_id = mr.id AND me.organization_id = mr.organization_id
       WHERE mr.unit_id = $1 AND mr.organization_id = $2 AND mr.deleted_at IS NULL
       GROUP BY mr.id
       ORDER BY mr.reported_at DESC, mr.id DESC`,
      [id, organizationId],
    );
    const documents = await this.db.query(
      `SELECT ld.id, ld.file_name AS name, ld.document_type AS type, ld.uploaded_at AS created_at,
              CONCAT(u.first_name, ' ', u.last_name) AS author
       FROM lease_documents ld
       JOIN leases l ON l.id = ld.lease_id
       LEFT JOIN app_users u ON u.id = ld.uploaded_by
       WHERE l.unit_id = $1 AND ld.organization_id = $2 AND ld.deleted_at IS NULL
       ORDER BY ld.uploaded_at DESC, ld.id DESC`,
      [id, organizationId],
    );
    const hasDebt = invoices.rows.some((invoice) => Number(invoice.remaining_amount) > 0);
    const hasOverdue = invoices.rows.some((invoice) => invoice.status !== 'PAID' && new Date(invoice.due_date) < new Date());
    return {
      ...unit,
      tenants: tenants.rows,
      leases: leases.rows,
      invoices: invoices.rows.map((invoice) => {
        const summary = invoiceSummaryMap.get(Number(invoice.id));
        return {
          ...invoice,
          rent_amount: Number(summary?.rent_amount ?? 0),
          syndic_amount: Number(summary?.syndic_amount ?? 0),
        };
      }),
      payments: payments.rows,
      rent_history: leases.rows.map((lease) => ({
        id: lease.id,
        start_date: lease.start_date,
        end_date: lease.end_date,
        monthly_rent: lease.monthly_rent,
        maintenance_fee_amount: lease.maintenance_fee_amount,
        monthly_syndic_amount: lease.monthly_syndic_amount,
        tenant_name: lease.tenant_name,
      })),
      maintenance: maintenance.rows,
      documents: documents.rows,
      photos: [],
      timeline: this.unitTimeline(unit, leases.rows, payments.rows, maintenance.rows),
      situation: hasOverdue ? 'En retard' : hasDebt ? 'Dette' : 'À jour',
    };
  }

  async create(dto: CreateUnitDto) {
    const organizationId = this.context.organizationId();
    const { rows } = await this.db.query(
      `INSERT INTO units (
         building_id, number, floor, type, monthly_rent, monthly_syndic_amount, syndic_currency, status, organization_id,
         surface_area, bedrooms_count, bathrooms_count, has_balcony, has_parking, is_furnished,
         has_air_conditioning, has_equipped_kitchen, has_internet, has_water_meter, water_meter_number,
         has_electricity_meter, electricity_meter_number, description, observations
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
       RETURNING *`,
      [
        dto.building_id,
        dto.number,
        dto.floor,
        dto.type,
        dto.monthly_rent,
        Number(dto.monthly_syndic_amount ?? 0),
        dto.syndic_currency ?? 'USD',
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
           monthly_syndic_amount = COALESCE($7, monthly_syndic_amount),
           syndic_currency = COALESCE($8, syndic_currency),
           status = COALESCE($9, status),
           surface_area = COALESCE($10, surface_area),
           bedrooms_count = COALESCE($11, bedrooms_count),
           bathrooms_count = COALESCE($12, bathrooms_count),
           has_balcony = COALESCE($13, has_balcony),
           has_parking = COALESCE($14, has_parking),
           is_furnished = COALESCE($15, is_furnished),
           has_air_conditioning = COALESCE($16, has_air_conditioning),
           has_equipped_kitchen = COALESCE($17, has_equipped_kitchen),
           has_internet = COALESCE($18, has_internet),
           has_water_meter = COALESCE($19, has_water_meter),
           water_meter_number = COALESCE($20, water_meter_number),
           has_electricity_meter = COALESCE($21, has_electricity_meter),
           electricity_meter_number = COALESCE($22, electricity_meter_number),
           description = COALESCE($23, description),
           observations = COALESCE($24, observations)
       WHERE id = $1 AND organization_id = $25 AND deleted_at IS NULL RETURNING *`,
      [
        id,
        dto.building_id,
        dto.number,
        dto.floor,
        dto.type,
        dto.monthly_rent,
        dto.monthly_syndic_amount,
        dto.syndic_currency,
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
