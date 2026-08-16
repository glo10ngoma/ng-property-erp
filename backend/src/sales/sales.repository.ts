import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import type {
  CreateSalesBuyerDto,
  CreateSalesCatalogItemDto,
  CreateSalesProjectDto,
  SalesBuyerListQueryDto,
  SalesCatalogListQueryDto,
  SalesProjectListQueryDto,
  UpdateSalesBuyerDto,
  UpdateSalesCatalogItemDto,
  UpdateSalesProjectDto,
  UpdateSalesSettingsDto,
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
         settings_json,
         created_at,
         updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::jsonb, '{}'::jsonb), NOW(), NOW())
       ON CONFLICT (organization_id)
       DO UPDATE SET
         default_currency = COALESCE(EXCLUDED.default_currency, sales_settings.default_currency),
         secondary_currency = COALESCE(EXCLUDED.secondary_currency, sales_settings.secondary_currency),
         quotation_prefix = COALESCE(EXCLUDED.quotation_prefix, sales_settings.quotation_prefix),
         reservation_prefix = COALESCE(EXCLUDED.reservation_prefix, sales_settings.reservation_prefix),
         contract_prefix = COALESCE(EXCLUDED.contract_prefix, sales_settings.contract_prefix),
         receipt_prefix = COALESCE(EXCLUDED.receipt_prefix, sales_settings.receipt_prefix),
         invoice_prefix = COALESCE(EXCLUDED.invoice_prefix, sales_settings.invoice_prefix),
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
         address, city, country, id_document_type, id_document_number, tax_number, status,
         metadata, created_by, updated_by, created_at, updated_at
       )
       VALUES (
         $1, $2, $3, NULLIF($4, ''), NULLIF($5, ''), NULLIF($6, ''), NULLIF($7, ''), NULLIF($8, ''),
         NULLIF($9, ''), NULLIF($10, ''), NULLIF($11, ''), NULLIF($12, ''), NULLIF($13, ''), NULLIF($14, ''),
         COALESCE($15, 'ACTIVE'), COALESCE($16::jsonb, '{}'::jsonb), $17, $17, NOW(), NOW()
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
           metadata = COALESCE($17::jsonb, metadata),
           updated_by = $18,
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

  async ensureProjectBelongsToOrganization(organizationId: number, projectId: number | null | undefined, client: PoolClient) {
    if (!projectId) return;
    const { rows } = await client.query(
      `SELECT id
       FROM sales_projects
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [projectId, organizationId],
    );
    if (!rows[0]) {
      throw new NotFoundException('Project not found');
    }
  }

  async ensureBuildingBelongsToOrganization(organizationId: number, buildingId: number | null | undefined, client: PoolClient) {
    if (!buildingId) return;
    const { rows } = await client.query(
      `SELECT id
       FROM buildings
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [buildingId, organizationId],
    );
    if (!rows[0]) {
      throw new NotFoundException('Building not found');
    }
  }

  async ensureUnitBelongsToOrganization(organizationId: number, unitId: number | null | undefined, client: PoolClient) {
    if (!unitId) return;
    const { rows } = await client.query(
      `SELECT id
       FROM units
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [unitId, organizationId],
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
