import { BadRequestException, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { RequestContext } from '../auth/request-context';
import { requireRow } from '../common/not-found';
import { DatabaseService } from '../database/database.service';
import { CreateTenantDto, UpdateTenantDto } from './dto';

@Injectable()
export class TenantsService {
  private tenantCivilityColumnsPromise?: Promise<boolean>;

  constructor(private readonly db: DatabaseService, private readonly context: RequestContext) {}

  async findAll() {
    const organizationId = this.context.organizationId();
    const { rows } = await this.db.query(`
      SELECT t.*,
             ('CLI-' || LPAD(COALESCE(t.tenant_number, t.id)::TEXT, 6, '0')) AS client_reference,
             lease_info.unit_id,
             lease_info.unit_number,
             lease_info.monthly_rent,
             COALESCE(lease_stats.total_rent_amount, 0)::FLOAT AS total_rent_amount,
             COALESCE(lease_stats.total_syndic_amount, 0)::FLOAT AS total_syndic_amount,
             COALESCE(lease_stats.total_general_amount, 0)::FLOAT AS total_general_amount,
             lease_info.active_lease_id,
             lease_info.active_lease_number,
             lease_info.active_lease_end_date,
             lease_info.active_lease_status,
             lease_info.building_id,
             lease_info.building_name,
             COALESCE(lease_stats.active_lease_count, 0)::INT AS active_lease_count,
             COALESCE(lease_stats.active_leases_count, 0)::INT AS active_leases_count,
             COALESCE(lease_stats.occupied_units_count, 0)::INT AS occupied_units_count,
             lease_stats.occupied_unit_labels,
             lease_stats.occupied_building_names,
             COALESCE(fin.remaining_amount, 0)::FLOAT AS remaining_amount,
             fin.last_payment_date,
             fin.last_reminder_at,
             COALESCE(fin.reminder_count, 0)::INT AS reminder_count,
             COALESCE(fin.overdue_invoices, 0)::INT AS overdue_invoices
      FROM tenants t
      LEFT JOIN LATERAL (
        SELECT u.id AS unit_id,
               u.number AS unit_number,
               (COALESCE(l.monthly_rent, u.monthly_rent, 0) + COALESCE(l.maintenance_fee_amount, 0))::FLOAT AS monthly_rent,
               l.id AS active_lease_id,
               l.lease_number AS active_lease_number,
               l.end_date AS active_lease_end_date,
               l.status AS active_lease_status,
               b.id AS building_id,
               b.name AS building_name
        FROM leases l
        LEFT JOIN units u ON u.id = l.unit_id
        LEFT JOIN buildings b ON b.id = u.building_id
        WHERE l.tenant_id = t.id
          AND l.organization_id = t.organization_id
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
      ) lease_info ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(DISTINCT l.id)::INT AS active_lease_count,
               COUNT(DISTINCT l.id)::INT AS active_leases_count,
               COUNT(DISTINCT l.unit_id)::INT AS occupied_units_count,
               COALESCE(SUM(COALESCE(l.monthly_rent, 0) + COALESCE(l.maintenance_fee_amount, 0)), 0)::FLOAT AS total_rent_amount,
               COALESCE(SUM(COALESCE(l.monthly_syndic_amount, 0)), 0)::FLOAT AS total_syndic_amount,
               COALESCE(SUM(COALESCE(l.monthly_rent, 0) + COALESCE(l.maintenance_fee_amount, 0) + COALESCE(l.monthly_syndic_amount, 0)), 0)::FLOAT AS total_general_amount,
               STRING_AGG(DISTINCT u.number, ', ' ORDER BY u.number) FILTER (WHERE u.number IS NOT NULL) AS occupied_unit_labels,
               STRING_AGG(DISTINCT b.name, ', ' ORDER BY b.name) FILTER (WHERE b.name IS NOT NULL) AS occupied_building_names
        FROM leases l
        LEFT JOIN units u ON u.id = l.unit_id
        LEFT JOIN buildings b ON b.id = u.building_id
        WHERE l.tenant_id = t.id
          AND l.organization_id = t.organization_id
          AND l.deleted_at IS NULL
          AND l.start_date <= CURRENT_DATE
          AND (l.end_date IS NULL OR l.end_date >= CURRENT_DATE)
          AND COALESCE(l.status, '') NOT IN ('DRAFT', 'CANCELLED')
      ) lease_stats ON TRUE
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
      financial.overdue_invoices > 0 ? 'En retard' : financial.remaining > 0 ? 'Dette' : 'A jour';
    return { ...tenant, financial, invoices: invoices.rows, payments: payments.rows, situation };
  }

  async findTrashed() {
    const organizationId = this.context.organizationId();
    const { rows } = await this.db.query(`
      SELECT t.*,
             ('CLI-' || LPAD(COALESCE(t.tenant_number, t.id)::TEXT, 6, '0')) AS client_reference,
             deleted_user.email AS deleted_by_name,
             COALESCE(lease_stats.lease_count, 0)::INT AS lease_count,
             COALESCE(invoice_stats.invoice_count, 0)::INT AS invoice_count,
             COALESCE(payment_stats.payment_count, 0)::INT AS payment_count
      FROM tenants t
      LEFT JOIN app_users deleted_user ON deleted_user.id = t.deleted_by
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::INT AS lease_count
        FROM leases l
        WHERE l.tenant_id = t.id
          AND l.organization_id = t.organization_id
          AND l.deleted_at IS NULL
      ) lease_stats ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::INT AS invoice_count
        FROM invoices i
        WHERE i.tenant_id = t.id
          AND i.organization_id = t.organization_id
          AND i.deleted_at IS NULL
      ) invoice_stats ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::INT AS payment_count
        FROM payments p
        JOIN invoices i ON i.id = p.invoice_id
        WHERE i.tenant_id = t.id
          AND p.organization_id = t.organization_id
          AND p.deleted_at IS NULL
      ) payment_stats ON TRUE
      WHERE t.organization_id = $1
        AND t.deleted_at IS NOT NULL
      ORDER BY t.deleted_at DESC, t.id DESC
    `, [organizationId]);
    return rows;
  }

  async create(dto: CreateTenantDto) {
    return this.db.transaction(async (client) => {
      const organizationId = this.context.organizationId();
      const includesCivilityColumns = await this.hasTenantCivilityColumns();
      const tenantNumber = await this.nextTenantNumber(client, organizationId);
      const columns = [
        'tenant_type',
        'first_name',
        'last_name',
        ...(includesCivilityColumns ? ['civility'] : []),
        'post_name',
        'company_name',
        'rccm',
        'tax_number',
        'business_sector',
        'legal_representative_name',
        ...(includesCivilityColumns ? ['legal_representative_civility'] : []),
        'legal_representative_role',
        'legal_representative_phone',
        'legal_representative_email',
        'company_document_name',
        'legal_form',
        'national_id_number',
        'commune',
        'city',
        'country',
        'representative_post_name',
        'representative_first_name',
        'phone',
        'secondary_phone',
        'email',
        'profession',
        'address',
        'id_document_type',
        'id_number',
        'id_document_file_name',
        'id_document_file_url',
        'nationality',
        'emergency_contact_name',
        'emergency_contact_phone',
        'notes',
        'unit_id',
        'move_in_date',
        'status',
        'organization_id',
        'tenant_number',
      ];
      const values = [
        dto.tenant_type ?? 'PHYSICAL',
        dto.first_name,
        dto.last_name,
        ...(includesCivilityColumns ? [this.normalizeCivility(dto.civility)] : []),
        dto.post_name ?? null,
        dto.company_name ?? null,
        dto.rccm ?? null,
        dto.tax_number ?? null,
        dto.business_sector ?? null,
        dto.legal_representative_name ?? null,
        ...(includesCivilityColumns ? [this.normalizeCivility(dto.legal_representative_civility)] : []),
        dto.legal_representative_role ?? null,
        dto.legal_representative_phone ?? null,
        dto.legal_representative_email || null,
        dto.company_document_name ?? null,
        dto.legal_form ?? null,
        dto.national_id_number ?? null,
        dto.commune ?? null,
        dto.city ?? null,
        dto.country ?? null,
        dto.representative_post_name ?? null,
        dto.representative_first_name ?? null,
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
        tenantNumber,
      ];
      const placeholders = values.map((_, index) => `$${index + 1}`);
      const { rows } = await client.query(
        `INSERT INTO tenants (${columns.join(', ')})
         VALUES (${placeholders.join(', ')}) RETURNING *`,
        values,
      );
      if (dto.unit_id) {
        await client.query(`UPDATE units SET status = 'OCCUPIED' WHERE id = $1 AND organization_id = $2`, [dto.unit_id, organizationId]);
      }
      return rows[0];
    });
  }

  async update(id: number, dto: UpdateTenantDto) {
    const previous = (await this.findOne(id)) as unknown as { unit_id?: number };
    const includesCivilityColumns = await this.hasTenantCivilityColumns();
    const values: Array<string | number | null | undefined> = [id];
    const setClauses = ['tenant_type', 'first_name', 'last_name'];
    const normalizedValues: Array<string | number | null | undefined> = [
      dto.tenant_type,
      dto.first_name,
      dto.last_name,
    ];

    if (includesCivilityColumns) {
      setClauses.push('civility');
      normalizedValues.push(this.normalizeCivility(dto.civility));
    }

    setClauses.push(
      'post_name',
      'company_name',
      'legal_form',
      'rccm',
      'national_id_number',
      'tax_number',
      'business_sector',
      'legal_representative_name',
    );
    normalizedValues.push(
      dto.post_name,
      dto.company_name,
      dto.legal_form,
      dto.rccm,
      dto.national_id_number,
      dto.tax_number,
      dto.business_sector,
      dto.legal_representative_name,
    );

    if (includesCivilityColumns) {
      setClauses.push('legal_representative_civility');
      normalizedValues.push(this.normalizeCivility(dto.legal_representative_civility));
    }

    setClauses.push(
      'representative_post_name',
      'representative_first_name',
      'legal_representative_role',
      'legal_representative_phone',
      'legal_representative_email',
      'company_document_name',
      'commune',
      'city',
      'country',
      'phone',
      'secondary_phone',
      'email',
      'profession',
      'address',
      'id_document_type',
      'id_number',
      'id_document_file_name',
      'id_document_file_url',
      'nationality',
      'emergency_contact_name',
      'emergency_contact_phone',
      'notes',
      'unit_id',
      'move_in_date',
      'status',
    );
    normalizedValues.push(
      dto.representative_post_name,
      dto.representative_first_name,
      dto.legal_representative_role,
      dto.legal_representative_phone,
      dto.legal_representative_email,
      dto.company_document_name,
      dto.commune,
      dto.city,
      dto.country,
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
    );

    values.push(...normalizedValues);
    const assignments = setClauses.map((column, index) => `${column} = COALESCE($${index + 2}, ${column})`);
    values.push(this.context.organizationId());
    const { rows } = await this.db.query(
      `UPDATE tenants
       SET ${assignments.join(', ')}
       WHERE id = $1 AND organization_id = $${values.length} AND deleted_at IS NULL RETURNING *`,
      values,
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
    return this.trash(id, 'Suppression depuis la liste des locataires');
  }

  async trash(id: number, reason: string) {
    const deletionReason = String(reason ?? '').trim();
    if (!deletionReason) {
      throw new BadRequestException('Le motif de suppression est obligatoire.');
    }
    return this.db.transaction(async (client) => {
      const organizationId = this.context.organizationId();
      const tenant = await client.query(
        `SELECT id, unit_id
         FROM tenants
         WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
         FOR UPDATE`,
        [id, organizationId],
      );
      const row = requireRow(tenant.rows[0], 'Tenant');
      await client.query(
        `UPDATE tenants
         SET deleted_at = NOW(),
             deleted_by = $2,
             deletion_reason = $3,
             status = 'INACTIVE'
         WHERE id = $1 AND organization_id = $4 AND deleted_at IS NULL`,
        [id, this.context.userId(), deletionReason, organizationId],
      );
      if (row.unit_id) {
        await client.query(
          `UPDATE units SET status = 'VACANT'
           WHERE id = $1 AND organization_id = $2 AND NOT EXISTS (
             SELECT 1 FROM tenants WHERE unit_id = $1 AND status = 'ACTIVE' AND deleted_at IS NULL
           )`,
          [row.unit_id, organizationId],
        );
      }
      await this.writeTenantAudit(client, 'TENANT_MOVED_TO_TRASH', id, { deletion_reason: deletionReason });
      return { trashed: true, id };
    });
  }

  async restore(id: number) {
    return this.db.transaction(async (client) => {
      const organizationId = this.context.organizationId();
      const tenant = await client.query(
        `SELECT id, unit_id, status
         FROM tenants
         WHERE id = $1 AND organization_id = $2 AND deleted_at IS NOT NULL
         FOR UPDATE`,
        [id, organizationId],
      );
      requireRow(tenant.rows[0], 'Tenant');
      await client.query(
        `UPDATE tenants
         SET deleted_at = NULL,
             deleted_by = NULL,
             deletion_reason = NULL,
             status = CASE WHEN status = 'INACTIVE' THEN 'ACTIVE' ELSE status END
         WHERE id = $1 AND organization_id = $2 AND deleted_at IS NOT NULL`,
        [id, organizationId],
      );
      await client.query(
        `UPDATE units u
         SET status = 'OCCUPIED'
         FROM leases l
         WHERE l.unit_id = u.id
           AND l.tenant_id = $1
           AND l.organization_id = $2
           AND u.organization_id = $2
           AND l.deleted_at IS NULL
           AND l.start_date <= CURRENT_DATE
           AND (l.end_date IS NULL OR l.end_date >= CURRENT_DATE)
           AND COALESCE(l.status, '') NOT IN ('DRAFT', 'CANCELLED')`,
        [id, organizationId],
      );
      await this.writeTenantAudit(client, 'TENANT_RESTORED', id, {});
      return { restored: true, id };
    });
  }

  async deletionImpact(id: number) {
    const organizationId = this.context.organizationId();
    const tenant = await this.db.query(
      `SELECT id FROM tenants WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [id, organizationId],
    );
    requireRow(tenant.rows[0], 'Tenant');
    const { rows } = await this.db.query(
      `SELECT
         (SELECT COUNT(*)::INT FROM leases WHERE tenant_id = $1 AND organization_id = $2 AND deleted_at IS NULL) AS leases,
         (SELECT COUNT(*)::INT FROM invoices WHERE tenant_id = $1 AND organization_id = $2 AND deleted_at IS NULL) AS invoices,
         (SELECT COUNT(*)::INT
          FROM payments p
          JOIN invoices i ON i.id = p.invoice_id
          WHERE i.tenant_id = $1 AND p.organization_id = $2 AND p.deleted_at IS NULL) AS payments`,
      [id, organizationId],
    );
    const counts = rows[0] ?? {};
    const dependencies = [
      { type: 'Baux', count: Number(counts.leases ?? 0) },
      { type: 'Factures', count: Number(counts.invoices ?? 0) },
      { type: 'Paiements', count: Number(counts.payments ?? 0) },
    ].filter((entry) => entry.count > 0);
    return {
      canHardDelete: false,
      hasFinancialHistory: dependencies.some((entry) => entry.type === 'Factures' || entry.type === 'Paiements'),
      dependencies,
    };
  }

  async permanentDelete(id: number) {
    await this.deletionImpact(id);
    throw new BadRequestException("La suppression definitive d'un locataire n'est pas disponible depuis l'interface.");
  }

  private async writeTenantAudit(client: PoolClient, action: string, tenantId: number, metadata: Record<string, unknown>) {
    await client.query(
      `INSERT INTO audit_logs (organization_id, user_id, action, resource, resource_id, method, path, status_code, metadata)
       VALUES ($1, $2, $3, 'tenants', $4, 'PATCH', $5, 200, $6::JSONB)`,
      [this.context.organizationId(), this.context.userId() ?? null, action, tenantId, `/api/tenants/${tenantId}`, JSON.stringify(metadata)],
    );
  }

  private normalizeCivility(value: string | null | undefined) {
    const normalized = String(value ?? '').trim().toUpperCase();
    if (!normalized) return null;
    if (normalized === 'MONSIEUR') return 'MR';
    if (normalized === 'MADAME') return 'MRS';
    return normalized;
  }

  private async hasTenantCivilityColumns() {
    if (!this.tenantCivilityColumnsPromise) {
      this.tenantCivilityColumnsPromise = this.db
        .query(
          `SELECT COUNT(*)::INT AS count
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'tenants'
             AND column_name IN ('civility', 'legal_representative_civility')`,
        )
        .then(({ rows }) => Number(rows[0]?.count ?? 0) === 2);
    }
    return this.tenantCivilityColumnsPromise;
  }

  private async nextTenantNumber(client: PoolClient, organizationId: number) {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`tenant-number-${organizationId}`]);
    const { rows } = await client.query(
      `SELECT GREATEST(
         COALESCE(MAX(tenant_number), 0),
         COUNT(*) FILTER (WHERE tenant_number IS NULL)
       ) + 1 AS value
       FROM tenants
       WHERE organization_id = $1
         AND deleted_at IS NULL`,
      [organizationId],
    );
    return Number(rows[0]?.value ?? 1);
  }
}
