import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import type {
  CreateSalesBuyerDto,
  CreateSalesCatalogItemDto,
  CreateSalesProjectDto,
  CreateSalesReservationDto,
  CreateSalesSubscriptionDto,
  SalesBuyerListQueryDto,
  SalesCatalogListQueryDto,
  SalesProjectListQueryDto,
  SalesReservationListQueryDto,
  SalesSubscriptionListQueryDto,
  SimulateSalesSubscriptionDto,
  UpdateSalesBuyerDto,
  UpdateSalesCatalogItemDto,
  UpdateSalesProjectDto,
  UpdateSalesReservationDto,
  UpdateSalesSettingsDto,
  UpdateSalesSubscriptionDto,
} from './dto';

type Queryable = Pick<PoolClient, 'query'> | DatabaseService;

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (token) => `\\${token}`);
}

@Injectable()
export class SalesRepository {
  constructor(private readonly db: DatabaseService) {}

  private runner(client?: PoolClient): Queryable {
    return client ?? this.db;
  }

  private async query<T = any>(text: string, params: unknown[] = [], client?: PoolClient) {
    const runner: any = this.runner(client);
    return runner.query(text, params) as Promise<{ rows: T[] }>;
  }

  async findSettings(organizationId: number, client?: PoolClient) {
    const { rows } = await this.query(
      `SELECT *
       FROM sales_settings
       WHERE organization_id = $1
       LIMIT 1`,
      [organizationId],
    );
    return rows[0] ?? null;
  }

  async upsertSettings(organizationId: number, dto: UpdateSalesSettingsDto, client: PoolClient) {
    const { rows } = await client.query(
      `INSERT INTO sales_settings (
         organization_id,
         default_currency,
         secondary_currency,
         quotation_prefix,
         reservation_prefix,
         contract_prefix,
         receipt_prefix,
         invoice_prefix,
         reservation_default_duration_days,
         reservation_fee_required,
         reservation_default_fee,
         minimum_deposit_type,
         minimum_deposit_percentage,
         minimum_deposit_amount,
         maximum_installment_count,
         default_installment_frequency,
         grace_period_days,
         discount_approval_threshold_percentage,
         allow_custom_schedule,
         allowed_currencies,
         contract_generation_mode,
         invoice_generation_mode,
         revenue_recognition_mode,
         settings_json,
         created_at,
         updated_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8,
         COALESCE($9, 7), COALESCE($10, false), COALESCE($11, 0),
         COALESCE($12, 'PERCENTAGE'), $13, $14, COALESCE($15, 24), COALESCE($16, 'MONTHLY'),
         COALESCE($17, 0), COALESCE($18, 0), COALESCE($19, true), COALESCE($20::jsonb, '["USD","CDF"]'::jsonb),
         NULLIF($21, ''), NULLIF($22, ''), NULLIF($23, ''),
         COALESCE($24::jsonb, '{}'::jsonb), NOW(), NOW()
       )
       ON CONFLICT (organization_id)
       DO UPDATE SET
         default_currency = COALESCE(EXCLUDED.default_currency, sales_settings.default_currency),
         secondary_currency = COALESCE(EXCLUDED.secondary_currency, sales_settings.secondary_currency),
         quotation_prefix = COALESCE(EXCLUDED.quotation_prefix, sales_settings.quotation_prefix),
         reservation_prefix = COALESCE(EXCLUDED.reservation_prefix, sales_settings.reservation_prefix),
         contract_prefix = COALESCE(EXCLUDED.contract_prefix, sales_settings.contract_prefix),
         receipt_prefix = COALESCE(EXCLUDED.receipt_prefix, sales_settings.receipt_prefix),
         invoice_prefix = COALESCE(EXCLUDED.invoice_prefix, sales_settings.invoice_prefix),
         reservation_default_duration_days = COALESCE(EXCLUDED.reservation_default_duration_days, sales_settings.reservation_default_duration_days),
         reservation_fee_required = COALESCE(EXCLUDED.reservation_fee_required, sales_settings.reservation_fee_required),
         reservation_default_fee = COALESCE(EXCLUDED.reservation_default_fee, sales_settings.reservation_default_fee),
         minimum_deposit_type = COALESCE(EXCLUDED.minimum_deposit_type, sales_settings.minimum_deposit_type),
         minimum_deposit_percentage = COALESCE(EXCLUDED.minimum_deposit_percentage, sales_settings.minimum_deposit_percentage),
         minimum_deposit_amount = COALESCE(EXCLUDED.minimum_deposit_amount, sales_settings.minimum_deposit_amount),
         maximum_installment_count = COALESCE(EXCLUDED.maximum_installment_count, sales_settings.maximum_installment_count),
         default_installment_frequency = COALESCE(EXCLUDED.default_installment_frequency, sales_settings.default_installment_frequency),
         grace_period_days = COALESCE(EXCLUDED.grace_period_days, sales_settings.grace_period_days),
         discount_approval_threshold_percentage = COALESCE(EXCLUDED.discount_approval_threshold_percentage, sales_settings.discount_approval_threshold_percentage),
         allow_custom_schedule = COALESCE(EXCLUDED.allow_custom_schedule, sales_settings.allow_custom_schedule),
         allowed_currencies = COALESCE(EXCLUDED.allowed_currencies, sales_settings.allowed_currencies),
         contract_generation_mode = COALESCE(EXCLUDED.contract_generation_mode, sales_settings.contract_generation_mode),
         invoice_generation_mode = COALESCE(EXCLUDED.invoice_generation_mode, sales_settings.invoice_generation_mode),
         revenue_recognition_mode = COALESCE(EXCLUDED.revenue_recognition_mode, sales_settings.revenue_recognition_mode),
         settings_json = COALESCE(EXCLUDED.settings_json, sales_settings.settings_json),
         updated_at = NOW()
       RETURNING *`,
      [
        organizationId,
        dto.default_currency ?? null,
        dto.secondary_currency ?? null,
        dto.quotation_prefix ?? null,
        dto.reservation_prefix ?? null,
        dto.contract_prefix ?? null,
        dto.receipt_prefix ?? null,
        dto.invoice_prefix ?? null,
        dto.reservation_default_duration_days ?? null,
        dto.reservation_fee_required ?? null,
        dto.reservation_default_fee ?? null,
        dto.minimum_deposit_type ?? null,
        dto.minimum_deposit_percentage ?? null,
        dto.minimum_deposit_amount ?? null,
        dto.maximum_installment_count ?? null,
        dto.default_installment_frequency ?? null,
        dto.grace_period_days ?? null,
        dto.discount_approval_threshold_percentage ?? null,
        dto.allow_custom_schedule ?? null,
        dto.allowed_currencies ? JSON.stringify(dto.allowed_currencies) : null,
        dto.contract_generation_mode ?? null,
        dto.invoice_generation_mode ?? null,
        dto.revenue_recognition_mode ?? null,
        dto.settings_json ? JSON.stringify(dto.settings_json) : null,
      ],
    );
    return rows[0];
  }

  async listBuyers(organizationId: number, query: SalesBuyerListQueryDto, client?: PoolClient) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const offset = (page - 1) * pageSize;
    const sortColumnMap: Record<string, string> = {
      buyer_ref: 'sb.buyer_ref',
      full_name: `COALESCE(sb.full_name, sb.company_name)`,
      company_name: `COALESCE(sb.company_name, sb.full_name)`,
      created_at: 'sb.created_at',
      updated_at: 'sb.updated_at',
    };
    const sortColumn = sortColumnMap[query.sortBy ?? 'created_at'] ?? sortColumnMap.created_at;
    const sortOrder = String(query.sortOrder ?? 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const search = query.search ? `%${escapeLike(query.search.toLowerCase())}%` : null;
    const params: unknown[] = [organizationId];
    const filters = ['sb.organization_id = $1', 'sb.deleted_at IS NULL'];

    if (query.status) {
      params.push(query.status);
      filters.push(`sb.status = $${params.length}`);
    }
    if (search) {
      params.push(search);
      filters.push(`(
        LOWER(COALESCE(sb.buyer_ref, '')) LIKE $${params.length} ESCAPE '\\'
        OR LOWER(COALESCE(sb.full_name, '')) LIKE $${params.length} ESCAPE '\\'
        OR LOWER(COALESCE(sb.company_name, '')) LIKE $${params.length} ESCAPE '\\'
        OR LOWER(COALESCE(sb.email, '')) LIKE $${params.length} ESCAPE '\\'
      )`);
    }

    const whereClause = filters.join(' AND ');
    const count = await this.query<{ total: number }>(
      `SELECT COUNT(*)::INT AS total
       FROM sales_buyers sb
       WHERE ${whereClause}`,
      params,
    );

    params.push(pageSize, offset);
    const { rows } = await this.query(
      `SELECT sb.*
       FROM sales_buyers sb
       WHERE ${whereClause}
       ORDER BY ${sortColumn} ${sortOrder}, sb.id DESC
       LIMIT $${params.length - 1}
       OFFSET $${params.length}`,
      params,
    );

    return { items: rows, total: count.rows[0]?.total ?? 0, page, pageSize };
  }

  async findBuyer(organizationId: number, id: number, client?: PoolClient) {
    const { rows } = await this.query(
      `SELECT *
       FROM sales_buyers
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [id, organizationId],
    );
    return rows[0] ?? null;
  }

  async createBuyer(organizationId: number, userId: number | null, dto: CreateSalesBuyerDto, client: PoolClient) {
    const { rows } = await client.query(
      `INSERT INTO sales_buyers (
         organization_id, buyer_ref, buyer_type, full_name, company_name, phone, whatsapp, email,
         address, city, country, id_document_type, id_document_number, tax_number, status, commercial_stage,
         metadata, created_by, updated_by, created_at, updated_at
       )
       VALUES (
         $1, $2, $3, NULLIF($4, ''), NULLIF($5, ''), NULLIF($6, ''), NULLIF($7, ''), NULLIF($8, ''),
         NULLIF($9, ''), NULLIF($10, ''), NULLIF($11, ''), NULLIF($12, ''), NULLIF($13, ''), NULLIF($14, ''),
         COALESCE($15, 'ACTIVE'), COALESCE($16, 'PROSPECT'), COALESCE($17::jsonb, '{}'::jsonb), $18, $18, NOW(), NOW()
       )
       RETURNING *`,
      [
        organizationId,
        dto.buyer_ref,
        dto.buyer_type,
        dto.full_name ?? null,
        dto.company_name ?? null,
        dto.phone ?? null,
        dto.whatsapp ?? null,
        dto.email ?? null,
        dto.address ?? null,
        dto.city ?? null,
        dto.country ?? null,
        dto.id_document_type ?? null,
        dto.id_document_number ?? null,
        dto.tax_number ?? null,
        dto.status ?? 'ACTIVE',
        dto.commercial_stage ?? 'PROSPECT',
        dto.metadata ? JSON.stringify(dto.metadata) : null,
        userId,
      ],
    );
    return rows[0];
  }

  async updateBuyer(organizationId: number, id: number, userId: number | null, dto: UpdateSalesBuyerDto, client: PoolClient) {
    const { rows } = await client.query(
      `UPDATE sales_buyers
       SET buyer_ref = COALESCE($3, buyer_ref),
           buyer_type = COALESCE($4, buyer_type),
           full_name = COALESCE(NULLIF($5, ''), full_name),
           company_name = COALESCE(NULLIF($6, ''), company_name),
           phone = COALESCE(NULLIF($7, ''), phone),
           whatsapp = COALESCE(NULLIF($8, ''), whatsapp),
           email = COALESCE(NULLIF($9, ''), email),
           address = COALESCE(NULLIF($10, ''), address),
           city = COALESCE(NULLIF($11, ''), city),
           country = COALESCE(NULLIF($12, ''), country),
           id_document_type = COALESCE(NULLIF($13, ''), id_document_type),
           id_document_number = COALESCE(NULLIF($14, ''), id_document_number),
           tax_number = COALESCE(NULLIF($15, ''), tax_number),
           status = COALESCE($16, status),
           commercial_stage = COALESCE($17, commercial_stage),
           metadata = COALESCE($18::jsonb, metadata),
           updated_by = $19,
           updated_at = NOW()
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [
        id,
        organizationId,
        dto.buyer_ref ?? null,
        dto.buyer_type ?? null,
        dto.full_name ?? null,
        dto.company_name ?? null,
        dto.phone ?? null,
        dto.whatsapp ?? null,
        dto.email ?? null,
        dto.address ?? null,
        dto.city ?? null,
        dto.country ?? null,
        dto.id_document_type ?? null,
        dto.id_document_number ?? null,
        dto.tax_number ?? null,
        dto.status ?? null,
        dto.commercial_stage ?? null,
        dto.metadata ? JSON.stringify(dto.metadata) : null,
        userId,
      ],
    );
    return rows[0] ?? null;
  }

  async archiveBuyer(organizationId: number, id: number, userId: number | null, client: PoolClient) {
    const { rows } = await client.query(
      `UPDATE sales_buyers
       SET status = 'ARCHIVED', archived_at = NOW(), archived_by = $3, updated_at = NOW(), updated_by = $3
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [id, organizationId, userId],
    );
    return rows[0] ?? null;
  }

  async listProjects(organizationId: number, query: SalesProjectListQueryDto, client?: PoolClient) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const offset = (page - 1) * pageSize;
    const sortColumnMap: Record<string, string> = {
      project_ref: 'sp.project_ref',
      name: 'sp.name',
      status: 'sp.status',
      created_at: 'sp.created_at',
      updated_at: 'sp.updated_at',
    };
    const sortColumn = sortColumnMap[query.sortBy ?? 'created_at'] ?? sortColumnMap.created_at;
    const sortOrder = String(query.sortOrder ?? 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const search = query.search ? `%${escapeLike(query.search.toLowerCase())}%` : null;
    const params: unknown[] = [organizationId];
    const filters = ['sp.organization_id = $1', 'sp.deleted_at IS NULL'];

    if (query.status) {
      params.push(query.status);
      filters.push(`sp.status = $${params.length}`);
    }
    if (search) {
      params.push(search);
      filters.push(`(
        LOWER(COALESCE(sp.project_ref, '')) LIKE $${params.length} ESCAPE '\\'
        OR LOWER(COALESCE(sp.name, '')) LIKE $${params.length} ESCAPE '\\'
        OR LOWER(COALESCE(sp.location_label, '')) LIKE $${params.length} ESCAPE '\\'
      )`);
    }

    const whereClause = filters.join(' AND ');
    const count = await this.query<{ total: number }>(
      `SELECT COUNT(*)::INT AS total
       FROM sales_projects sp
       WHERE ${whereClause}`,
      params,
    );

    params.push(pageSize, offset);
    const { rows } = await this.query(
      `SELECT sp.*
       FROM sales_projects sp
       WHERE ${whereClause}
       ORDER BY ${sortColumn} ${sortOrder}, sp.id DESC
       LIMIT $${params.length - 1}
       OFFSET $${params.length}`,
      params,
    );

    return { items: rows, total: count.rows[0]?.total ?? 0, page, pageSize };
  }

  async findProject(organizationId: number, id: number, client?: PoolClient) {
    const { rows } = await this.query(
      `SELECT *
       FROM sales_projects
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [id, organizationId],
    );
    return rows[0] ?? null;
  }

  async createProject(organizationId: number, userId: number | null, dto: CreateSalesProjectDto, client: PoolClient) {
    const { rows } = await client.query(
      `INSERT INTO sales_projects (
         organization_id, project_ref, name, description, location_label, status,
         launch_date, closing_date, metadata, created_by, updated_by, created_at, updated_at
       )
       VALUES (
         $1, $2, $3, NULLIF($4, ''), NULLIF($5, ''), COALESCE($6, 'DRAFT'),
         NULLIF($7, '')::date, NULLIF($8, '')::date, COALESCE($9::jsonb, '{}'::jsonb), $10, $10, NOW(), NOW()
       )
       RETURNING *`,
      [
        organizationId,
        dto.project_ref,
        dto.name,
        dto.description ?? null,
        dto.location_label ?? null,
        dto.status ?? 'DRAFT',
        dto.launch_date ?? null,
        dto.closing_date ?? null,
        dto.metadata ? JSON.stringify(dto.metadata) : null,
        userId,
      ],
    );
    return rows[0];
  }

  async updateProject(organizationId: number, id: number, userId: number | null, dto: UpdateSalesProjectDto, client: PoolClient) {
    const { rows } = await client.query(
      `UPDATE sales_projects
       SET project_ref = COALESCE($3, project_ref),
           name = COALESCE($4, name),
           description = COALESCE(NULLIF($5, ''), description),
           location_label = COALESCE(NULLIF($6, ''), location_label),
           status = COALESCE($7, status),
           launch_date = COALESCE(NULLIF($8, '')::date, launch_date),
           closing_date = COALESCE(NULLIF($9, '')::date, closing_date),
           metadata = COALESCE($10::jsonb, metadata),
           updated_by = $11,
           updated_at = NOW()
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [
        id,
        organizationId,
        dto.project_ref ?? null,
        dto.name ?? null,
        dto.description ?? null,
        dto.location_label ?? null,
        dto.status ?? null,
        dto.launch_date ?? null,
        dto.closing_date ?? null,
        dto.metadata ? JSON.stringify(dto.metadata) : null,
        userId,
      ],
    );
    return rows[0] ?? null;
  }

  async archiveProject(organizationId: number, id: number, userId: number | null, client: PoolClient) {
    const { rows } = await client.query(
      `UPDATE sales_projects
       SET status = 'ARCHIVED', archived_at = NOW(), archived_by = $3, updated_at = NOW(), updated_by = $3
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [id, organizationId, userId],
    );
    return rows[0] ?? null;
  }

  async listCatalog(organizationId: number, query: SalesCatalogListQueryDto, client?: PoolClient) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const offset = (page - 1) * pageSize;
    const sortColumnMap: Record<string, string> = {
      catalog_ref: 'spc.catalog_ref',
      title: 'spc.title',
      commercial_status: 'spc.commercial_status',
      list_price: 'spc.list_price',
      created_at: 'spc.created_at',
      updated_at: 'spc.updated_at',
    };
    const sortColumn = sortColumnMap[query.sortBy ?? 'created_at'] ?? sortColumnMap.created_at;
    const sortOrder = String(query.sortOrder ?? 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const search = query.search ? `%${escapeLike(query.search.toLowerCase())}%` : null;
    const params: unknown[] = [organizationId];
    const filters = ['spc.organization_id = $1', 'spc.deleted_at IS NULL'];

    if (query.status) {
      params.push(query.status);
      filters.push(`spc.commercial_status = $${params.length}`);
    }
    if (search) {
      params.push(search);
      filters.push(`(
        LOWER(COALESCE(spc.catalog_ref, '')) LIKE $${params.length} ESCAPE '\\'
        OR LOWER(COALESCE(spc.title, '')) LIKE $${params.length} ESCAPE '\\'
        OR LOWER(COALESCE(spc.location_label, '')) LIKE $${params.length} ESCAPE '\\'
      )`);
    }

    const whereClause = filters.join(' AND ');
    const count = await this.query<{ total: number }>(
      `SELECT COUNT(*)::INT AS total
       FROM sales_property_catalog spc
       WHERE ${whereClause}`,
      params,
    );

    params.push(pageSize, offset);
    const { rows } = await this.query(
      `SELECT spc.*,
              sp.name AS project_name,
              b.name AS building_name,
              u.number AS unit_number
       FROM sales_property_catalog spc
       LEFT JOIN sales_projects sp ON sp.id = spc.project_id AND sp.organization_id = spc.organization_id
       LEFT JOIN buildings b ON b.id = spc.building_id AND b.organization_id = spc.organization_id
       LEFT JOIN units u ON u.id = spc.unit_id AND u.organization_id = spc.organization_id
       WHERE ${whereClause}
       ORDER BY ${sortColumn} ${sortOrder}, spc.id DESC
       LIMIT $${params.length - 1}
       OFFSET $${params.length}`,
      params,
    );

    return { items: rows, total: count.rows[0]?.total ?? 0, page, pageSize };
  }

  async findCatalogItem(organizationId: number, id: number, client?: PoolClient) {
    const { rows } = await this.query(
      `SELECT spc.*,
              sp.name AS project_name,
              b.name AS building_name,
              u.number AS unit_number
       FROM sales_property_catalog spc
       LEFT JOIN sales_projects sp ON sp.id = spc.project_id AND sp.organization_id = spc.organization_id
       LEFT JOIN buildings b ON b.id = spc.building_id AND b.organization_id = spc.organization_id
       LEFT JOIN units u ON u.id = spc.unit_id AND u.organization_id = spc.organization_id
       WHERE spc.id = $1 AND spc.organization_id = $2 AND spc.deleted_at IS NULL
       LIMIT 1`,
      [id, organizationId],
    );
    return rows[0] ?? null;
  }

  async ensureProjectBelongsToOrganization(organizationId: number, projectId: number | null | undefined, client?: PoolClient) {
    if (!projectId) return;
    const { rows } = await this.query(
      `SELECT id
       FROM sales_projects
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [projectId, organizationId],
      client,
    );
    if (!rows[0]) {
      throw new NotFoundException('Project not found');
    }
  }

  async ensureBuildingBelongsToOrganization(organizationId: number, buildingId: number | null | undefined, client?: PoolClient) {
    if (!buildingId) return;
    const { rows } = await this.query(
      `SELECT id
       FROM buildings
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [buildingId, organizationId],
      client,
    );
    if (!rows[0]) {
      throw new NotFoundException('Building not found');
    }
  }

  async ensureUnitBelongsToOrganization(organizationId: number, unitId: number | null | undefined, client?: PoolClient) {
    if (!unitId) return;
    const { rows } = await this.query(
      `SELECT id
       FROM units
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [unitId, organizationId],
      client,
    );
    if (!rows[0]) {
      throw new NotFoundException('Unit not found');
    }
  }

  validateCatalogMoney(payload: { list_price?: number | null; minimum_price?: number | null; currency?: string | null }) {
    const hasPrice = payload.list_price != null || payload.minimum_price != null;
    if (hasPrice && !payload.currency) {
      throw new BadRequestException('La devise est obligatoire lorsque le prix est renseigné.');
    }
    if (payload.minimum_price != null && payload.list_price != null && payload.minimum_price > payload.list_price) {
      throw new BadRequestException('Le prix minimum ne peut pas dépasser le prix affiché.');
    }
  }

  async createCatalogItem(organizationId: number, userId: number | null, dto: CreateSalesCatalogItemDto, client: PoolClient) {
    const { rows } = await client.query(
      `INSERT INTO sales_property_catalog (
         organization_id, project_id, building_id, unit_id, catalog_ref, property_type, title, description,
         list_price, minimum_price, currency, commercial_status, availability_date, surface_area,
         location_label, metadata, created_by, updated_by, created_at, updated_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, NULLIF($8, ''),
         $9, $10, $11, COALESCE($12, 'DRAFT'), NULLIF($13, '')::date, $14,
         NULLIF($15, ''), COALESCE($16::jsonb, '{}'::jsonb), $17, $17, NOW(), NOW()
       )
       RETURNING *`,
      [
        organizationId,
        dto.project_id ?? null,
        dto.building_id ?? null,
        dto.unit_id ?? null,
        dto.catalog_ref,
        dto.property_type,
        dto.title,
        dto.description ?? null,
        dto.list_price ?? null,
        dto.minimum_price ?? null,
        dto.currency ?? null,
        dto.commercial_status ?? 'DRAFT',
        dto.availability_date ?? null,
        dto.surface_area ?? null,
        dto.location_label ?? null,
        dto.metadata ? JSON.stringify(dto.metadata) : null,
        userId,
      ],
    );
    return rows[0];
  }

  async updateCatalogItem(organizationId: number, id: number, userId: number | null, dto: UpdateSalesCatalogItemDto, client: PoolClient) {
    const { rows } = await client.query(
      `UPDATE sales_property_catalog
       SET project_id = COALESCE($3, project_id),
           building_id = COALESCE($4, building_id),
           unit_id = COALESCE($5, unit_id),
           catalog_ref = COALESCE($6, catalog_ref),
           property_type = COALESCE($7, property_type),
           title = COALESCE($8, title),
           description = COALESCE(NULLIF($9, ''), description),
           list_price = COALESCE($10, list_price),
           minimum_price = COALESCE($11, minimum_price),
           currency = COALESCE($12, currency),
           commercial_status = COALESCE($13, commercial_status),
           availability_date = COALESCE(NULLIF($14, '')::date, availability_date),
           surface_area = COALESCE($15, surface_area),
           location_label = COALESCE(NULLIF($16, ''), location_label),
           metadata = COALESCE($17::jsonb, metadata),
           updated_by = $18,
           updated_at = NOW()
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [
        id,
        organizationId,
        dto.project_id ?? null,
        dto.building_id ?? null,
        dto.unit_id ?? null,
        dto.catalog_ref ?? null,
        dto.property_type ?? null,
        dto.title ?? null,
        dto.description ?? null,
        dto.list_price ?? null,
        dto.minimum_price ?? null,
        dto.currency ?? null,
        dto.commercial_status ?? null,
        dto.availability_date ?? null,
        dto.surface_area ?? null,
        dto.location_label ?? null,
        dto.metadata ? JSON.stringify(dto.metadata) : null,
        userId,
      ],
    );
    return rows[0] ?? null;
  }

  async updateCatalogStatus(organizationId: number, id: number, status: string, userId: number | null, client: PoolClient) {
    const { rows } = await client.query(
      `UPDATE sales_property_catalog
       SET commercial_status = $3, updated_at = NOW(), updated_by = $4
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [id, organizationId, status, userId],
    );
    return rows[0] ?? null;
  }

  async archiveCatalogItem(organizationId: number, id: number, userId: number | null, client: PoolClient) {
    const { rows } = await client.query(
      `UPDATE sales_property_catalog
       SET commercial_status = 'WITHDRAWN', archived_at = NOW(), archived_by = $3, updated_at = NOW(), updated_by = $3
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [id, organizationId, userId],
    );
    return rows[0] ?? null;
  }

  async generateScopedReference(
    organizationId: number,
    tableName: 'sales_reservations' | 'sales_subscriptions',
    columnName: 'reservation_number' | 'subscription_number',
    prefix: string,
    client: PoolClient,
  ) {
    const safePrefix = prefix.trim() || (tableName === 'sales_reservations' ? 'RSV' : 'SUB');
    const { rows } = await client.query<{ next_value: number }>(
      `SELECT COALESCE(COUNT(*), 0)::int + 1 AS next_value
       FROM ${tableName}
       WHERE organization_id = $1`,
      [organizationId],
    );
    return `${safePrefix}-${String(rows[0]?.next_value ?? 1).padStart(5, '0')}`;
  }

  async listReservations(organizationId: number, query: SalesReservationListQueryDto, client?: PoolClient) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const offset = (page - 1) * pageSize;
    const sortColumnMap: Record<string, string> = {
      reservation_number: 'sr.reservation_number',
      status: 'sr.status',
      reservation_date: 'sr.reservation_date',
      expires_at: 'sr.expires_at',
      updated_at: 'sr.updated_at',
    };
    const sortColumn = sortColumnMap[query.sortBy ?? 'updated_at'] ?? sortColumnMap.updated_at;
    const sortOrder = String(query.sortOrder ?? 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const search = query.search ? `%${escapeLike(query.search.toLowerCase())}%` : null;
    const params: unknown[] = [organizationId];
    const filters = ['sr.organization_id = $1', 'sr.archived_at IS NULL'];

    if (query.status) {
      params.push(query.status);
      filters.push(`sr.status = $${params.length}`);
    }
    if (search) {
      params.push(search);
      filters.push(`(
        LOWER(COALESCE(sr.reservation_number, '')) LIKE $${params.length} ESCAPE '\\'
        OR LOWER(COALESCE(sb.full_name, sb.company_name, '')) LIKE $${params.length} ESCAPE '\\'
        OR LOWER(COALESCE(spc.title, '')) LIKE $${params.length} ESCAPE '\\'
      )`);
    }

    const whereClause = filters.join(' AND ');
    const count = await this.query<{ total: number }>(
      `SELECT COUNT(*)::INT AS total
       FROM sales_reservations sr
       LEFT JOIN sales_buyers sb ON sb.id = sr.buyer_id AND sb.organization_id = sr.organization_id
       LEFT JOIN sales_property_catalog spc ON spc.id = sr.catalog_item_id AND spc.organization_id = sr.organization_id
       WHERE ${whereClause}`,
      params,
      client,
    );

    params.push(pageSize, offset);
    const { rows } = await this.query(
      `SELECT sr.*,
              COALESCE(sb.full_name, sb.company_name) AS buyer_name,
              sb.buyer_ref,
              spc.title AS catalog_title,
              spc.catalog_ref,
              sp.name AS project_name
       FROM sales_reservations sr
       LEFT JOIN sales_buyers sb ON sb.id = sr.buyer_id AND sb.organization_id = sr.organization_id
       LEFT JOIN sales_property_catalog spc ON spc.id = sr.catalog_item_id AND spc.organization_id = sr.organization_id
       LEFT JOIN sales_projects sp ON sp.id = sr.project_id AND sp.organization_id = sr.organization_id
       WHERE ${whereClause}
       ORDER BY ${sortColumn} ${sortOrder}, sr.id DESC
       LIMIT $${params.length - 1}
       OFFSET $${params.length}`,
      params,
      client,
    );

    return { items: rows, total: count.rows[0]?.total ?? 0, page, pageSize };
  }

  async findReservation(organizationId: number, id: number, client?: PoolClient) {
    const { rows } = await this.query(
      `SELECT sr.*,
              COALESCE(sb.full_name, sb.company_name) AS buyer_name,
              sb.buyer_ref,
              spc.title AS catalog_title,
              spc.catalog_ref,
              sp.name AS project_name
       FROM sales_reservations sr
       LEFT JOIN sales_buyers sb ON sb.id = sr.buyer_id AND sb.organization_id = sr.organization_id
       LEFT JOIN sales_property_catalog spc ON spc.id = sr.catalog_item_id AND spc.organization_id = sr.organization_id
       LEFT JOIN sales_projects sp ON sp.id = sr.project_id AND sp.organization_id = sr.organization_id
       WHERE sr.id = $1 AND sr.organization_id = $2 AND sr.archived_at IS NULL
       LIMIT 1`,
      [id, organizationId],
      client,
    );
    return rows[0] ?? null;
  }

  async findActiveReservationForCatalog(organizationId: number, catalogItemId: number, client?: PoolClient, excludeId?: number) {
    const params: unknown[] = [organizationId, catalogItemId];
    let excludeClause = '';
    if (excludeId) {
      params.push(excludeId);
      excludeClause = ` AND id <> $${params.length}`;
    }
    const { rows } = await this.query(
      `SELECT *
       FROM sales_reservations
       WHERE organization_id = $1
         AND catalog_item_id = $2
         AND archived_at IS NULL
         AND status IN ('ACTIVE', 'CONFIRMED')
         ${excludeClause}
       LIMIT 1`,
      params,
      client,
    );
    return rows[0] ?? null;
  }

  async createReservation(organizationId: number, userId: number | null, dto: CreateSalesReservationDto, reservationNumber: string, client: PoolClient) {
    const { rows } = await client.query(
      `INSERT INTO sales_reservations (
         organization_id, reservation_number, buyer_id, catalog_item_id, project_id, status, currency,
         catalog_price, negotiated_price, reservation_fee, reservation_date, expires_at, notes,
         created_by, updated_by, created_at, updated_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         $8, $9, $10, $11::date, $12::date, NULLIF($13, ''),
         $14, $14, NOW(), NOW()
       )
       RETURNING *`,
      [
        organizationId,
        reservationNumber,
        dto.buyer_id,
        dto.catalog_item_id,
        dto.project_id ?? null,
        dto.status ?? 'ACTIVE',
        dto.currency,
        dto.catalog_price,
        dto.negotiated_price,
        dto.reservation_fee ?? 0,
        dto.reservation_date,
        dto.expires_at ?? null,
        dto.notes ?? null,
        userId,
      ],
    );
    return rows[0];
  }

  async updateReservation(organizationId: number, id: number, userId: number | null, dto: UpdateSalesReservationDto, client: PoolClient) {
    const { rows } = await client.query(
      `UPDATE sales_reservations
       SET buyer_id = COALESCE($3, buyer_id),
           catalog_item_id = COALESCE($4, catalog_item_id),
           project_id = COALESCE($5, project_id),
           status = COALESCE($6, status),
           currency = COALESCE($7, currency),
           catalog_price = COALESCE($8, catalog_price),
           negotiated_price = COALESCE($9, negotiated_price),
           reservation_fee = COALESCE($10, reservation_fee),
           reservation_date = COALESCE($11::date, reservation_date),
           expires_at = COALESCE($12::date, expires_at),
           notes = COALESCE(NULLIF($13, ''), notes),
           updated_by = $14,
           updated_at = NOW()
       WHERE id = $1 AND organization_id = $2 AND archived_at IS NULL
       RETURNING *`,
      [
        id,
        organizationId,
        dto.buyer_id ?? null,
        dto.catalog_item_id ?? null,
        dto.project_id ?? null,
        dto.status ?? null,
        dto.currency ?? null,
        dto.catalog_price ?? null,
        dto.negotiated_price ?? null,
        dto.reservation_fee ?? null,
        dto.reservation_date ?? null,
        dto.expires_at ?? null,
        dto.notes ?? null,
        userId,
      ],
    );
    return rows[0] ?? null;
  }

  async transitionReservationStatus(
    organizationId: number,
    id: number,
    nextStatus: string,
    userId: number | null,
    reason: string | null,
    client: PoolClient,
  ) {
    const { rows } = await client.query(
      `UPDATE sales_reservations
       SET status = $3,
           confirmed_at = CASE WHEN $3 = 'CONFIRMED' THEN NOW() ELSE confirmed_at END,
           cancelled_at = CASE WHEN $3 IN ('CANCELLED', 'EXPIRED') THEN NOW() ELSE cancelled_at END,
           cancellation_reason = CASE WHEN $3 IN ('CANCELLED', 'EXPIRED') THEN NULLIF($5, '') ELSE cancellation_reason END,
           updated_by = $4,
           updated_at = NOW()
       WHERE id = $1 AND organization_id = $2 AND archived_at IS NULL
       RETURNING *`,
      [id, organizationId, nextStatus, userId, reason],
    );
    return rows[0] ?? null;
  }

  async listSubscriptions(organizationId: number, query: SalesSubscriptionListQueryDto, client?: PoolClient) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const offset = (page - 1) * pageSize;
    const sortColumnMap: Record<string, string> = {
      subscription_number: 'ss.subscription_number',
      status: 'ss.status',
      created_at: 'ss.created_at',
      updated_at: 'ss.updated_at',
      first_due_date: 'ss.first_due_date',
    };
    const sortColumn = sortColumnMap[query.sortBy ?? 'updated_at'] ?? sortColumnMap.updated_at;
    const sortOrder = String(query.sortOrder ?? 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const search = query.search ? `%${escapeLike(query.search.toLowerCase())}%` : null;
    const params: unknown[] = [organizationId];
    const filters = ['ss.organization_id = $1', 'ss.archived_at IS NULL'];

    if (query.status) {
      params.push(query.status);
      filters.push(`ss.status = $${params.length}`);
    }
    if (search) {
      params.push(search);
      filters.push(`(
        LOWER(COALESCE(ss.subscription_number, '')) LIKE $${params.length} ESCAPE '\\'
        OR LOWER(COALESCE(sb.full_name, sb.company_name, '')) LIKE $${params.length} ESCAPE '\\'
        OR LOWER(COALESCE(spc.title, '')) LIKE $${params.length} ESCAPE '\\'
      )`);
    }

    const whereClause = filters.join(' AND ');
    const count = await this.query<{ total: number }>(
      `SELECT COUNT(*)::INT AS total
       FROM sales_subscriptions ss
       LEFT JOIN sales_buyers sb ON sb.id = ss.buyer_id AND sb.organization_id = ss.organization_id
       LEFT JOIN sales_property_catalog spc ON spc.id = ss.catalog_item_id AND spc.organization_id = ss.organization_id
       WHERE ${whereClause}`,
      params,
      client,
    );

    params.push(pageSize, offset);
    const { rows } = await this.query(
      `SELECT ss.*,
              COALESCE(sb.full_name, sb.company_name) AS buyer_name,
              sb.buyer_ref,
              spc.title AS catalog_title,
              spc.catalog_ref,
              sp.name AS project_name,
              sr.reservation_number
       FROM sales_subscriptions ss
       LEFT JOIN sales_buyers sb ON sb.id = ss.buyer_id AND sb.organization_id = ss.organization_id
       LEFT JOIN sales_property_catalog spc ON spc.id = ss.catalog_item_id AND spc.organization_id = ss.organization_id
       LEFT JOIN sales_projects sp ON sp.id = ss.project_id AND sp.organization_id = ss.organization_id
       LEFT JOIN sales_reservations sr ON sr.id = ss.reservation_id AND sr.organization_id = ss.organization_id
       WHERE ${whereClause}
       ORDER BY ${sortColumn} ${sortOrder}, ss.id DESC
       LIMIT $${params.length - 1}
       OFFSET $${params.length}`,
      params,
      client,
    );

    return { items: rows, total: count.rows[0]?.total ?? 0, page, pageSize };
  }

  async findSubscription(organizationId: number, id: number, client?: PoolClient) {
    const { rows } = await this.query(
      `SELECT ss.*,
              COALESCE(sb.full_name, sb.company_name) AS buyer_name,
              sb.buyer_ref,
              spc.title AS catalog_title,
              spc.catalog_ref,
              sp.name AS project_name,
              sr.reservation_number
       FROM sales_subscriptions ss
       LEFT JOIN sales_buyers sb ON sb.id = ss.buyer_id AND sb.organization_id = ss.organization_id
       LEFT JOIN sales_property_catalog spc ON spc.id = ss.catalog_item_id AND spc.organization_id = ss.organization_id
       LEFT JOIN sales_projects sp ON sp.id = ss.project_id AND sp.organization_id = ss.organization_id
       LEFT JOIN sales_reservations sr ON sr.id = ss.reservation_id AND sr.organization_id = ss.organization_id
       WHERE ss.id = $1 AND ss.organization_id = $2 AND ss.archived_at IS NULL
       LIMIT 1`,
      [id, organizationId],
      client,
    );
    return rows[0] ?? null;
  }

  async listSubscriptionInstallments(organizationId: number, subscriptionId: number, client?: PoolClient) {
    const { rows } = await this.query(
      `SELECT *
       FROM sales_subscription_installments
       WHERE organization_id = $1 AND subscription_id = $2
       ORDER BY sequence_number ASC`,
      [organizationId, subscriptionId],
      client,
    );
    return rows;
  }

  async createSubscription(
    organizationId: number,
    userId: number | null,
    dto: CreateSalesSubscriptionDto,
    subscriptionNumber: string,
    derived: {
      final_sale_price: number;
      discount_amount: number;
      deposit_amount: number;
      deposit_percentage: number | null;
      financed_balance: number;
      installment_count: number;
      frequency: string;
      first_due_date: string | null;
      grace_period_days: number;
      regular_installment_amount: number;
      final_installment_amount: number | null;
    },
    client: PoolClient,
  ) {
    const { rows } = await client.query(
      `INSERT INTO sales_subscriptions (
         organization_id, subscription_number, reservation_id, buyer_id, catalog_item_id, project_id,
         status, currency, catalog_price, discount_amount, final_sale_price, deposit_type, deposit_percentage,
         deposit_amount, financed_balance, installment_count, frequency, first_due_date, regular_installment_amount,
         final_installment_amount, grace_period_days, notes, created_by, updated_by, created_at, updated_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9, $10, $11, $12, $13,
         $14, $15, $16, $17, $18::date, $19,
         $20, $21, NULLIF($22, ''), $23, $23, NOW(), NOW()
       )
       RETURNING *`,
      [
        organizationId,
        subscriptionNumber,
        dto.reservation_id ?? null,
        dto.buyer_id,
        dto.catalog_item_id,
        dto.project_id ?? null,
        dto.status ?? 'DRAFT',
        dto.currency,
        dto.catalog_price,
        derived.discount_amount,
        derived.final_sale_price,
        dto.deposit_type,
        derived.deposit_percentage,
        derived.deposit_amount,
        derived.financed_balance,
        derived.installment_count,
        derived.frequency,
        derived.first_due_date,
        derived.regular_installment_amount,
        derived.final_installment_amount,
        derived.grace_period_days,
        dto.notes ?? null,
        userId,
      ],
    );
    return rows[0];
  }

  async replaceSubscriptionInstallments(
    organizationId: number,
    subscriptionId: number,
    installments: Array<{
      sequence_number: number;
      label?: string | null;
      due_date: string;
      amount: number;
      currency: string;
      installment_type?: string;
    }>,
    client: PoolClient,
  ) {
    await client.query(
      `DELETE FROM sales_subscription_installments
       WHERE organization_id = $1 AND subscription_id = $2`,
      [organizationId, subscriptionId],
    );

    for (const installment of installments) {
      await client.query(
        `INSERT INTO sales_subscription_installments (
           organization_id, subscription_id, sequence_number, label, due_date, amount, currency, installment_type, created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, NOW(), NOW())`,
        [
          organizationId,
          subscriptionId,
          installment.sequence_number,
          installment.label ?? null,
          installment.due_date,
          installment.amount,
          installment.currency,
          installment.installment_type ?? 'REGULAR',
        ],
      );
    }
  }

  async updateSubscription(
    organizationId: number,
    id: number,
    userId: number | null,
    dto: UpdateSalesSubscriptionDto,
    derived: {
      final_sale_price: number;
      discount_amount: number;
      deposit_amount: number;
      deposit_percentage: number | null;
      financed_balance: number;
      installment_count: number;
      frequency: string;
      first_due_date: string | null;
      grace_period_days: number;
      regular_installment_amount: number;
      final_installment_amount: number | null;
    },
    client: PoolClient,
  ) {
    const { rows } = await client.query(
      `UPDATE sales_subscriptions
       SET reservation_id = COALESCE($3, reservation_id),
           buyer_id = COALESCE($4, buyer_id),
           catalog_item_id = COALESCE($5, catalog_item_id),
           project_id = COALESCE($6, project_id),
           status = COALESCE($7, status),
           currency = COALESCE($8, currency),
           catalog_price = COALESCE($9, catalog_price),
           discount_amount = $10,
           final_sale_price = $11,
           deposit_type = COALESCE($12, deposit_type),
           deposit_percentage = $13,
           deposit_amount = $14,
           financed_balance = $15,
           installment_count = $16,
           frequency = $17,
           first_due_date = $18::date,
           regular_installment_amount = $19,
           final_installment_amount = $20,
           grace_period_days = $21,
           notes = COALESCE(NULLIF($22, ''), notes),
           updated_by = $23,
           updated_at = NOW()
       WHERE id = $1 AND organization_id = $2 AND archived_at IS NULL
       RETURNING *`,
      [
        id,
        organizationId,
        dto.reservation_id ?? null,
        dto.buyer_id ?? null,
        dto.catalog_item_id ?? null,
        dto.project_id ?? null,
        dto.status ?? null,
        dto.currency ?? null,
        dto.catalog_price ?? null,
        derived.discount_amount,
        derived.final_sale_price,
        dto.deposit_type ?? null,
        derived.deposit_percentage,
        derived.deposit_amount,
        derived.financed_balance,
        derived.installment_count,
        derived.frequency,
        derived.first_due_date,
        derived.regular_installment_amount,
        derived.final_installment_amount,
        derived.grace_period_days,
        dto.notes ?? null,
        userId,
      ],
    );
    return rows[0] ?? null;
  }

  async transitionSubscriptionStatus(
    organizationId: number,
    id: number,
    nextStatus: string,
    userId: number | null,
    reason: string | null,
    client: PoolClient,
  ) {
    const { rows } = await client.query(
      `UPDATE sales_subscriptions
       SET status = $3,
           approved_by = CASE WHEN $3 = 'APPROVED' THEN $4 ELSE approved_by END,
           approved_at = CASE WHEN $3 = 'APPROVED' THEN NOW() ELSE approved_at END,
           notes = CASE WHEN NULLIF($5, '') IS NULL THEN notes ELSE CONCAT(COALESCE(notes, ''), CASE WHEN COALESCE(notes, '') = '' THEN '' ELSE E'\\n' END, 'Motif: ', NULLIF($5, '')) END,
           updated_by = $4,
           updated_at = NOW()
       WHERE id = $1 AND organization_id = $2 AND archived_at IS NULL
       RETURNING *`,
      [id, organizationId, nextStatus, userId, reason],
    );
    return rows[0] ?? null;
  }

  async findCatalogForSale(organizationId: number, id: number, client?: PoolClient) {
    const row = await this.findCatalogItem(organizationId, id, client);
    if (!row) {
      throw new NotFoundException('Catalog item not found');
    }
    return row;
  }

  async findBuyerForSale(organizationId: number, id: number, client?: PoolClient) {
    const row = await this.findBuyer(organizationId, id, client);
    if (!row) {
      throw new NotFoundException('Buyer not found');
    }
    return row;
  }

  async setBuyerCommercialStage(organizationId: number, buyerId: number, stage: string, userId: number | null, client: PoolClient) {
    await client.query(
      `UPDATE sales_buyers
       SET commercial_stage = $3, updated_by = $4, updated_at = NOW()
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [buyerId, organizationId, stage, userId],
    );
  }

  async writeStatusHistory(
    organizationId: number,
    entityType: string,
    entityId: number,
    previousStatus: string | null | undefined,
    newStatus: string,
    reason: string | null | undefined,
    userId: number | null,
    client: PoolClient,
  ) {
    await client.query(
      `INSERT INTO sales_status_history (
         organization_id, entity_type, entity_id, previous_status, new_status, reason, changed_by, changed_at
       )
       VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''), $7, NOW())`,
      [organizationId, entityType, entityId, previousStatus ?? null, newStatus, reason ?? null, userId],
    );
  }

  async writeAuditEvent(
    organizationId: number,
    entityType: string,
    entityId: number,
    eventType: string,
    userId: number | null,
    beforeData: unknown,
    afterData: unknown,
    client: PoolClient,
  ) {
    await client.query(
      `INSERT INTO sales_audit_events (
         organization_id, entity_type, entity_id, event_type, user_id, before_data, after_data, context_data, created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, NOW())`,
      [
        organizationId,
        entityType,
        entityId,
        eventType,
        userId,
        beforeData == null ? null : JSON.stringify(beforeData),
        afterData == null ? null : JSON.stringify(afterData),
        JSON.stringify({ source: 'sales-module-v1.1' }),
      ],
    );
  }
}
