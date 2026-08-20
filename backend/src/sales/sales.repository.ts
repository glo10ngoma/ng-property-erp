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
         buyer_number_format,
         project_number_format,
         catalog_number_format,
         reservation_number_format,
         subscription_number_format,
         reservation_contract_number_format,
         subscription_contract_number_format,
         reservation_default_duration_days,
         reservation_fee_required,
         reservation_default_fee,
         reservation_fee_enabled,
         reservation_fee_default_amount,
         reservation_fee_default_currency,
         reservation_fee_deductibility,
         reservation_fee_deductible_percentage,
         reservation_fee_refundable,
         reservation_fee_refundable_percentage,
         reservation_fee_refund_deadline_days,
         reservation_fee_accounting_treatment,
         reservation_payment_number_format,
         reservation_refund_number_format,
         reservation_receipt_number_format,
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
         COALESCE(NULLIF($9, ''), 'ACQ-{YYYY}-{SEQ:5}'),
         COALESCE(NULLIF($10, ''), 'PRJ-{YYYY}-{SEQ:4}'),
         COALESCE(NULLIF($11, ''), 'BIE-{YYYY}-{SEQ:5}'),
         COALESCE(NULLIF($12, ''), 'RSV-{YYYY}-{SEQ:5}'),
         COALESCE(NULLIF($13, ''), 'SOU-{YYYY}-{SEQ:5}'),
         COALESCE(NULLIF($14, ''), 'CR-{YYYY}-{SEQ:5}'),
         COALESCE(NULLIF($15, ''), 'CV-{YYYY}-{SEQ:5}'),
         COALESCE($16, 7), COALESCE($17, false), COALESCE($18, 0),
         COALESCE($19, true), COALESCE($20, 0), COALESCE($21, 'USD'), COALESCE($22, 'DEDUCTIBLE'),
         COALESCE($23, 100), COALESCE($24, true), COALESCE($25, 100), COALESCE($26, 0),
         COALESCE($27, 'CUSTOMER_ADVANCE'),
         COALESCE(NULLIF($28, ''), 'PRS-{YYYY}-{SEQ:5}'),
         COALESCE(NULLIF($29, ''), 'RRS-{YYYY}-{SEQ:5}'),
         COALESCE(NULLIF($30, ''), 'RCR-{YYYY}-{SEQ:5}'),
         COALESCE($31, 'PERCENTAGE'), $32, $33, COALESCE($34, 24), COALESCE($35, 'MONTHLY'),
         COALESCE($36, 0), COALESCE($37, 0), COALESCE($38, true), COALESCE($39::jsonb, '["USD","CDF"]'::jsonb),
         NULLIF($40, ''), NULLIF($41, ''), NULLIF($42, ''),
         COALESCE($43::jsonb, '{}'::jsonb), NOW(), NOW()
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
         buyer_number_format = COALESCE(EXCLUDED.buyer_number_format, sales_settings.buyer_number_format),
         project_number_format = COALESCE(EXCLUDED.project_number_format, sales_settings.project_number_format),
         catalog_number_format = COALESCE(EXCLUDED.catalog_number_format, sales_settings.catalog_number_format),
         reservation_number_format = COALESCE(EXCLUDED.reservation_number_format, sales_settings.reservation_number_format),
         subscription_number_format = COALESCE(EXCLUDED.subscription_number_format, sales_settings.subscription_number_format),
         reservation_contract_number_format = COALESCE(EXCLUDED.reservation_contract_number_format, sales_settings.reservation_contract_number_format),
         subscription_contract_number_format = COALESCE(EXCLUDED.subscription_contract_number_format, sales_settings.subscription_contract_number_format),
         reservation_default_duration_days = COALESCE(EXCLUDED.reservation_default_duration_days, sales_settings.reservation_default_duration_days),
         reservation_fee_required = COALESCE(EXCLUDED.reservation_fee_required, sales_settings.reservation_fee_required),
         reservation_default_fee = COALESCE(EXCLUDED.reservation_default_fee, sales_settings.reservation_default_fee),
         reservation_fee_enabled = COALESCE(EXCLUDED.reservation_fee_enabled, sales_settings.reservation_fee_enabled),
         reservation_fee_default_amount = COALESCE(EXCLUDED.reservation_fee_default_amount, sales_settings.reservation_fee_default_amount),
         reservation_fee_default_currency = COALESCE(EXCLUDED.reservation_fee_default_currency, sales_settings.reservation_fee_default_currency),
         reservation_fee_deductibility = COALESCE(EXCLUDED.reservation_fee_deductibility, sales_settings.reservation_fee_deductibility),
         reservation_fee_deductible_percentage = COALESCE(EXCLUDED.reservation_fee_deductible_percentage, sales_settings.reservation_fee_deductible_percentage),
         reservation_fee_refundable = COALESCE(EXCLUDED.reservation_fee_refundable, sales_settings.reservation_fee_refundable),
         reservation_fee_refundable_percentage = COALESCE(EXCLUDED.reservation_fee_refundable_percentage, sales_settings.reservation_fee_refundable_percentage),
         reservation_fee_refund_deadline_days = COALESCE(EXCLUDED.reservation_fee_refund_deadline_days, sales_settings.reservation_fee_refund_deadline_days),
         reservation_fee_accounting_treatment = COALESCE(EXCLUDED.reservation_fee_accounting_treatment, sales_settings.reservation_fee_accounting_treatment),
         reservation_payment_number_format = COALESCE(EXCLUDED.reservation_payment_number_format, sales_settings.reservation_payment_number_format),
         reservation_refund_number_format = COALESCE(EXCLUDED.reservation_refund_number_format, sales_settings.reservation_refund_number_format),
         reservation_receipt_number_format = COALESCE(EXCLUDED.reservation_receipt_number_format, sales_settings.reservation_receipt_number_format),
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
        dto.buyer_number_format ?? null,
        dto.project_number_format ?? null,
        dto.catalog_number_format ?? null,
        dto.reservation_number_format ?? null,
        dto.subscription_number_format ?? null,
        dto.reservation_contract_number_format ?? null,
        dto.subscription_contract_number_format ?? null,
        dto.reservation_default_duration_days ?? null,
        dto.reservation_fee_required ?? null,
        dto.reservation_default_fee ?? null,
        dto.reservation_fee_enabled ?? null,
        dto.reservation_fee_default_amount ?? null,
        dto.reservation_fee_default_currency ?? null,
        dto.reservation_fee_deductibility ?? null,
        dto.reservation_fee_deductible_percentage ?? null,
        dto.reservation_fee_refundable ?? null,
        dto.reservation_fee_refundable_percentage ?? null,
        dto.reservation_fee_refund_deadline_days ?? null,
        dto.reservation_fee_accounting_treatment ?? null,
        dto.reservation_payment_number_format ?? null,
        dto.reservation_refund_number_format ?? null,
        dto.reservation_receipt_number_format ?? null,
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
    if (query.project_id) {
      params.push(query.project_id);
      filters.push(`spc.project_id = $${params.length}`);
    }
    if (query.available_only) {
      filters.push(`spc.commercial_status = 'AVAILABLE'`);
      filters.push(`NOT EXISTS (
        SELECT 1
        FROM sales_reservations sr
        WHERE sr.organization_id = spc.organization_id
          AND sr.catalog_item_id = spc.id
          AND sr.archived_at IS NULL
          AND sr.status IN ('ACTIVE', 'CONFIRMED')
      )`);
      filters.push(`NOT EXISTS (
        SELECT 1
        FROM sales_subscriptions ss
        WHERE ss.organization_id = spc.organization_id
          AND ss.catalog_item_id = spc.id
          AND ss.archived_at IS NULL
          AND ss.status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'CONVERTED')
      )`);
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
    const year = new Date().getUTCFullYear();
    const sequence = await this.nextSequenceValue(
      organizationId,
      tableName === 'sales_reservations' ? 'RESERVATION' : 'SUBSCRIPTION',
      year,
      client,
    );
    return this.formatSequence(`${prefix.trim() || (tableName === 'sales_reservations' ? 'RSV' : 'SUB')}-{SEQ:5}`, sequence, year);
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

  async findActiveSubscriptionForCatalog(organizationId: number, catalogItemId: number, client?: PoolClient, excludeId?: number) {
    const params: unknown[] = [organizationId, catalogItemId];
    let excludeClause = '';
    if (excludeId) {
      params.push(excludeId);
      excludeClause = ` AND id <> $${params.length}`;
    }
    const { rows } = await this.query(
      `SELECT *
       FROM sales_subscriptions
       WHERE organization_id = $1
         AND catalog_item_id = $2
         AND archived_at IS NULL
         AND status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'CONVERTED')
         ${excludeClause}
       LIMIT 1`,
      params,
      client,
    );
    return rows[0] ?? null;
  }

  async lockCatalogItem(organizationId: number, catalogItemId: number, client: PoolClient) {
    const { rows } = await client.query(
      `SELECT spc.*,
              sp.name AS project_name,
              b.name AS building_name,
              u.number AS unit_number
       FROM sales_property_catalog spc
       LEFT JOIN sales_projects sp ON sp.id = spc.project_id AND sp.organization_id = spc.organization_id
       LEFT JOIN buildings b ON b.id = spc.building_id AND b.organization_id = spc.organization_id
       LEFT JOIN units u ON u.id = spc.unit_id AND u.organization_id = spc.organization_id
       WHERE spc.id = $1 AND spc.organization_id = $2 AND spc.deleted_at IS NULL
       FOR UPDATE OF spc`,
      [catalogItemId, organizationId],
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

  async nextSequenceValue(
    organizationId: number,
    documentType: string,
    sequenceYear: number | null,
    client?: PoolClient,
  ) {
    const execute = async (sql: string, params: unknown[]) =>
      client
        ? client.query(sql, params)
        : this.query(sql, params);

    await execute(
      `INSERT INTO sales_number_sequences (organization_id, document_type, sequence_year, current_value, created_at, updated_at)
       VALUES ($1, $2, $3, 0, NOW(), NOW())
       ON CONFLICT (organization_id, document_type, sequence_year) DO NOTHING`,
      [organizationId, documentType, sequenceYear],
    );
    const { rows } = await execute(
      `UPDATE sales_number_sequences
       SET current_value = current_value + 1,
           updated_at = NOW()
       WHERE organization_id = $1
         AND document_type = $2
         AND sequence_year IS NOT DISTINCT FROM $3
       RETURNING current_value`,
      [organizationId, documentType, sequenceYear],
    );
    return Number(rows[0]?.current_value ?? 1);
  }

  formatSequence(format: string, sequenceValue: number, year: number) {
    return String(format || '{SEQ:5}')
      .replace(/\{YYYY\}/g, String(year))
      .replace(/\{SEQ:(\d+)\}/g, (_, size: string) => String(sequenceValue).padStart(Number(size), '0'))
      .replace(/\{SEQ\}/g, String(sequenceValue));
  }

  async listDocumentTemplates(organizationId: number, client?: PoolClient) {
    const { rows } = await this.query(
      `SELECT sdt.*,
              COALESCE(usage_stats.used_documents_count, 0)::INT AS used_documents_count
       FROM sales_document_templates
       sdt
       LEFT JOIN (
         SELECT template_id, COUNT(*)::INT AS used_documents_count
         FROM sales_document_generations
         WHERE organization_id = $1
           AND template_id IS NOT NULL
         GROUP BY template_id
       ) AS usage_stats
         ON usage_stats.template_id = sdt.id
       WHERE sdt.organization_id = $1
         AND archived_at IS NULL
       ORDER BY sdt.template_type ASC, sdt.is_active DESC, sdt.version DESC, sdt.id DESC`,
      [organizationId],
      client,
    );
    return rows;
  }

  async findDocumentTemplate(organizationId: number, id: number, client?: PoolClient) {
    const { rows } = await this.query(
      `SELECT sdt.*,
              COALESCE(usage_stats.used_documents_count, 0)::INT AS used_documents_count
       FROM sales_document_templates sdt
       LEFT JOIN (
         SELECT template_id, COUNT(*)::INT AS used_documents_count
         FROM sales_document_generations
         WHERE organization_id = $1
           AND template_id IS NOT NULL
         GROUP BY template_id
       ) AS usage_stats
         ON usage_stats.template_id = sdt.id
       WHERE sdt.organization_id = $1
         AND sdt.id = $2
         AND sdt.archived_at IS NULL
       LIMIT 1`,
      [organizationId, id],
      client,
    );
    return rows[0] ?? null;
  }

  async deactivateDocumentTemplatesByType(organizationId: number, templateType: string, client?: PoolClient) {
    const runner: any = this.runner(client);
    await runner.query(
      `UPDATE sales_document_templates
       SET is_active = FALSE,
           updated_at = NOW()
       WHERE organization_id = $1
         AND template_type = $2
         AND archived_at IS NULL
         AND is_active = TRUE`,
      [organizationId, templateType],
    );
  }

  async nextDocumentTemplateVersion(organizationId: number, templateType: string, client?: PoolClient) {
    const { rows } = await this.query<{ next_version: number }>(
      `SELECT COALESCE(MAX(version), 0)::INT + 1 AS next_version
       FROM sales_document_templates
       WHERE organization_id = $1
         AND template_type = $2`,
      [organizationId, templateType],
      client,
    );
    return Number(rows[0]?.next_version ?? 1);
  }

  async createDocumentTemplate(organizationId: number, userId: number | null, payload: Record<string, unknown>, client?: PoolClient) {
    const runner: any = this.runner(client);
    const version = await this.nextDocumentTemplateVersion(organizationId, String(payload.template_type), client);
    if (payload.is_active !== false) {
      await this.deactivateDocumentTemplatesByType(organizationId, String(payload.template_type), client);
    }
    const { rows } = await runner.query(
      `INSERT INTO sales_document_templates (
         organization_id, template_type, title, template_body, header_html, footer_html,
         variables_schema, clause_order, version, is_active, created_by, updated_by, created_at, updated_at
       )
       VALUES (
         $1, $2, $3, $4, NULLIF($5, ''), NULLIF($6, ''),
         COALESCE($7::jsonb, '[]'::jsonb), COALESCE($8::jsonb, '[]'::jsonb), COALESCE($9, 1), COALESCE($10, TRUE),
         $11, $11, NOW(), NOW()
       )
       RETURNING *`,
      [
        organizationId,
        payload.template_type,
        payload.title,
        payload.template_body,
        payload.header_html ?? null,
        payload.footer_html ?? null,
        JSON.stringify(payload.variables_schema ?? []),
        JSON.stringify(payload.clause_order ?? []),
        version,
        payload.is_active ?? true,
        userId,
      ],
    );
    return this.findDocumentTemplate(organizationId, Number(rows[0]?.id), client);
  }

  async updateDocumentTemplate(organizationId: number, id: number, userId: number | null, payload: Record<string, unknown>, client?: PoolClient) {
    const current = await this.findDocumentTemplate(organizationId, id, client);
    if (!current) return null;
    return this.createDocumentTemplate(
      organizationId,
      userId,
      {
        template_type: current.template_type,
        title: payload.title ?? current.title,
        template_body: payload.template_body ?? current.template_body,
        header_html: payload.header_html ?? current.header_html,
        footer_html: payload.footer_html ?? current.footer_html,
        variables_schema: payload.variables_schema ?? current.variables_schema ?? [],
        clause_order: payload.clause_order ?? current.clause_order ?? [],
        is_active: payload.is_active ?? current.is_active ?? true,
      },
      client,
    );
  }

  async ensureDefaultTemplate(
    organizationId: number,
    templateType: string,
    userId: number | null,
    templateSeed: { title: string; template_body: string },
    availableVariables: string[],
    client?: PoolClient,
  ) {
    const { rows } = await this.query(
      `SELECT *
       FROM sales_document_templates
       WHERE organization_id = $1
         AND template_type = $2
         AND archived_at IS NULL
         AND is_active = TRUE
       ORDER BY version DESC, id DESC
       LIMIT 1`,
      [organizationId, templateType],
      client,
    );
    if (rows[0]) {
      return rows[0];
    }
    return this.createDocumentTemplate(
      organizationId,
      userId,
      {
        template_type: templateType,
        title: templateSeed.title,
        template_body: templateSeed.template_body,
        variables_schema: availableVariables,
        clause_order: [],
        version: 1,
        is_active: true,
      },
      client,
    );
  }

  async createDocumentGeneration(
    organizationId: number,
    payload: {
      entity_type: string;
      entity_id: number;
      template_type: string;
      template_id?: number | null;
      version: number;
      document_number: string;
      file_name?: string | null;
      variables_snapshot: Record<string, unknown>;
      generated_by: number | null;
    },
    client?: PoolClient,
  ) {
    const runner: any = this.runner(client);
    const { rows } = await runner.query(
      `INSERT INTO sales_document_generations (
         organization_id, entity_type, entity_id, template_type, template_id, version,
         document_number, file_name, variables_snapshot, generation_status, generated_by, created_at, updated_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9::jsonb, 'PENDING', $10, NOW(), NOW()
       )
       RETURNING *`,
      [
        organizationId,
        payload.entity_type,
        payload.entity_id,
        payload.template_type,
        payload.template_id ?? null,
        payload.version,
        payload.document_number,
        payload.file_name ?? null,
        JSON.stringify(payload.variables_snapshot ?? {}),
        payload.generated_by,
      ],
    );
    return rows[0];
  }

  async markDocumentGenerationSuccess(organizationId: number, id: number, payload: { pdf_base64: string; mime_type: string; generated_by: number | null }) {
    const { rows } = await this.query(
      `UPDATE sales_document_generations
       SET pdf_base64 = $3,
           mime_type = $4,
           generation_status = 'GENERATED',
           generated_at = NOW(),
           generated_by = $5,
           updated_at = NOW()
       WHERE id = $1 AND organization_id = $2
       RETURNING *`,
      [id, organizationId, payload.pdf_base64, payload.mime_type, payload.generated_by],
    );
    return rows[0] ?? null;
  }

  async markDocumentGenerationFailure(organizationId: number, id: number, errorMessage: string, generatedBy: number | null) {
    const { rows } = await this.query(
      `UPDATE sales_document_generations
       SET generation_status = 'GENERATION_FAILED',
           error_message = LEFT($3, 1000),
           generated_at = NOW(),
           generated_by = $4,
           updated_at = NOW()
       WHERE id = $1 AND organization_id = $2
       RETURNING *`,
      [id, organizationId, errorMessage, generatedBy],
    );
    return rows[0] ?? null;
  }

  async listDocumentGenerations(organizationId: number, entityType: string, entityId: number, client?: PoolClient) {
    const { rows } = await this.query(
      `SELECT *
       FROM sales_document_generations
       WHERE organization_id = $1
         AND entity_type = $2
         AND entity_id = $3
       ORDER BY created_at DESC, id DESC`,
      [organizationId, entityType, entityId],
      client,
    );
    return rows;
  }

  async findDocumentGeneration(organizationId: number, id: number, client?: PoolClient) {
    const { rows } = await this.query(
      `SELECT *
       FROM sales_document_generations
       WHERE id = $1 AND organization_id = $2
       LIMIT 1`,
      [id, organizationId],
      client,
    );
    return rows[0] ?? null;
  }

  async getReservationDocumentContext(organizationId: number, reservationId: number, client?: PoolClient) {
    const { rows } = await this.query(
      `SELECT sr.*,
              o.name AS organization_name,
              '' AS organization_address,
              COALESCE(sb.full_name, sb.company_name) AS buyer_name,
              sb.buyer_ref,
              sb.phone AS buyer_phone,
              sb.email AS buyer_email,
              sb.address AS buyer_address,
              sb.id_document_number AS buyer_identity_number,
              spc.title AS catalog_title,
              spc.catalog_ref,
              spc.property_type,
              spc.location_label AS catalog_location,
              spc.surface_area AS catalog_surface_area,
              sp.name AS project_name,
              sp.project_ref,
              sp.location_label AS project_location
       FROM sales_reservations sr
       JOIN organizations o ON o.id = sr.organization_id
       LEFT JOIN sales_buyers sb ON sb.id = sr.buyer_id AND sb.organization_id = sr.organization_id
       LEFT JOIN sales_property_catalog spc ON spc.id = sr.catalog_item_id AND spc.organization_id = sr.organization_id
       LEFT JOIN sales_projects sp ON sp.id = sr.project_id AND sp.organization_id = sr.organization_id
       WHERE sr.id = $1 AND sr.organization_id = $2 AND sr.archived_at IS NULL
       LIMIT 1`,
      [reservationId, organizationId],
      client,
    );
    return rows[0] ?? null;
  }

  async getSubscriptionDocumentContext(organizationId: number, subscriptionId: number, client?: PoolClient) {
    const { rows } = await this.query(
      `SELECT ss.*,
              o.name AS organization_name,
              '' AS organization_address,
              COALESCE(sb.full_name, sb.company_name) AS buyer_name,
              sb.buyer_ref,
              sb.phone AS buyer_phone,
              sb.email AS buyer_email,
              sb.address AS buyer_address,
              sb.id_document_number AS buyer_identity_number,
              spc.title AS catalog_title,
              spc.catalog_ref,
              spc.property_type,
              spc.location_label AS catalog_location,
              spc.surface_area AS catalog_surface_area,
              sp.name AS project_name,
              sp.project_ref,
              sp.location_label AS project_location,
              sr.reservation_number
       FROM sales_subscriptions ss
       JOIN organizations o ON o.id = ss.organization_id
       LEFT JOIN sales_buyers sb ON sb.id = ss.buyer_id AND sb.organization_id = ss.organization_id
       LEFT JOIN sales_property_catalog spc ON spc.id = ss.catalog_item_id AND spc.organization_id = ss.organization_id
       LEFT JOIN sales_projects sp ON sp.id = ss.project_id AND sp.organization_id = ss.organization_id
       LEFT JOIN sales_reservations sr ON sr.id = ss.reservation_id AND sr.organization_id = ss.organization_id
       WHERE ss.id = $1 AND ss.organization_id = $2 AND ss.archived_at IS NULL
       LIMIT 1`,
      [subscriptionId, organizationId],
      client,
    );
    return rows[0] ?? null;
  }

  async getReservationPaymentReceiptContext(organizationId: number, paymentId: number, client?: PoolClient) {
    const { rows } = await this.query(
      `SELECT p.*,
              r.reservation_number,
              r.currency AS reservation_currency,
              r.negotiated_price,
              r.reservation_fee,
              o.name AS organization_name,
              COALESCE(sb.full_name, sb.company_name) AS buyer_name,
              sb.phone AS buyer_phone,
              sb.email AS buyer_email,
              COALESCE(NULLIF(TRIM(CONCAT(COALESCE(au.first_name, ''), ' ', COALESCE(au.last_name, ''))), ''), au.email, '-') AS created_by_name,
              sp.name AS project_name,
              sp.project_ref,
              spc.title AS catalog_title,
              spc.catalog_ref,
              spc.property_type,
              ba.bank_name,
              ba.account_name,
              ba.account_number,
              cs.opened_at AS cash_opened_at
       FROM sales_reservation_payments p
       JOIN sales_reservations r
         ON r.id = p.reservation_id
        AND r.organization_id = p.organization_id
       JOIN organizations o
         ON o.id = p.organization_id
       LEFT JOIN sales_buyers sb
         ON sb.id = r.buyer_id
        AND sb.organization_id = r.organization_id
       LEFT JOIN app_users au
         ON au.id = p.created_by
       LEFT JOIN sales_projects sp
         ON sp.id = r.project_id
        AND sp.organization_id = r.organization_id
       LEFT JOIN sales_property_catalog spc
         ON spc.id = r.catalog_item_id
        AND spc.organization_id = r.organization_id
       LEFT JOIN bank_accounts ba
         ON ba.id = p.bank_account_id
        AND ba.organization_id = p.organization_id
       LEFT JOIN cash_sessions cs
         ON cs.id = p.cash_session_id
        AND cs.organization_id = p.organization_id
       WHERE p.id = $1
         AND p.organization_id = $2
       LIMIT 1`,
      [paymentId, organizationId],
      client,
    );
    return rows[0] ?? null;
  }

  async getReservationRefundReceiptContext(organizationId: number, refundId: number, client?: PoolClient) {
    const { rows } = await this.query(
      `SELECT rf.*,
              p.payment_number,
              r.reservation_number,
              r.currency AS reservation_currency,
              o.name AS organization_name,
              COALESCE(sb.full_name, sb.company_name) AS buyer_name,
              sp.name AS project_name,
              sp.project_ref,
              spc.title AS catalog_title,
              spc.catalog_ref,
              spc.property_type,
              ba.bank_name,
              ba.account_name,
              ba.account_number,
              cs.opened_at AS cash_opened_at
       FROM sales_reservation_refunds rf
       JOIN sales_reservation_payments p
         ON p.id = rf.reservation_payment_id
        AND p.organization_id = rf.organization_id
       JOIN sales_reservations r
         ON r.id = rf.reservation_id
        AND r.organization_id = rf.organization_id
       JOIN organizations o
         ON o.id = rf.organization_id
       LEFT JOIN sales_buyers sb
         ON sb.id = r.buyer_id
        AND sb.organization_id = r.organization_id
       LEFT JOIN sales_projects sp
         ON sp.id = r.project_id
        AND sp.organization_id = r.organization_id
       LEFT JOIN sales_property_catalog spc
         ON spc.id = r.catalog_item_id
        AND spc.organization_id = r.organization_id
       LEFT JOIN bank_accounts ba
         ON ba.id = rf.bank_account_id
        AND ba.organization_id = rf.organization_id
       LEFT JOIN cash_sessions cs
         ON cs.id = rf.cash_session_id
        AND cs.organization_id = rf.organization_id
       WHERE rf.id = $1
         AND rf.organization_id = $2
       LIMIT 1`,
      [refundId, organizationId],
      client,
    );
    return rows[0] ?? null;
  }

  async lockReservation(organizationId: number, reservationId: number, client: PoolClient) {
    const { rows } = await client.query(
      `SELECT *
       FROM sales_reservations
       WHERE id = $1
         AND organization_id = $2
         AND archived_at IS NULL
       FOR UPDATE`,
      [reservationId, organizationId],
    );
    return rows[0] ?? null;
  }

  async listOpenCashSessions(organizationId: number, client?: PoolClient) {
    const { rows } = await this.query(
      `SELECT id,
              CONCAT('Session caisse ouverte #', id, ' — ', TO_CHAR(opened_at, 'DD/MM/YYYY HH24:MI')) AS label,
              status
       FROM cash_sessions
       WHERE organization_id = $1
         AND deleted_at IS NULL
         AND status = 'OPEN'
       ORDER BY opened_at DESC, id DESC`,
      [organizationId],
      client,
    );
    return rows;
  }

  async findOpenCashSession(organizationId: number, sessionId: number, client?: PoolClient) {
    const { rows } = await this.query(
      `SELECT id, status, opened_at
       FROM cash_sessions
       WHERE id = $1
         AND organization_id = $2
         AND deleted_at IS NULL
       LIMIT 1`,
      [sessionId, organizationId],
      client,
    );
    return rows[0] ?? null;
  }

  async listActiveBankAccounts(organizationId: number, currency?: string | null, client?: PoolClient) {
    const params: unknown[] = [organizationId];
    let filter = '';
    if (currency) {
      params.push(String(currency).toUpperCase());
      filter = ` AND UPPER(currency) = $${params.length}`;
    }
    const { rows } = await this.query(
      `SELECT id,
              CONCAT(COALESCE(bank_name, 'Banque'), ' — ', COALESCE(account_name, 'Compte'), ' (', UPPER(currency), ')') AS label,
              account_type,
              currency,
              status
       FROM bank_accounts
       WHERE organization_id = $1
         AND deleted_at IS NULL
         AND status = 'ACTIVE'
         ${filter}
       ORDER BY bank_name ASC, account_name ASC, id ASC`,
      params,
      client,
    );
    return rows;
  }

  async findActiveBankAccount(organizationId: number, bankAccountId: number, client?: PoolClient) {
    const { rows } = await this.query(
      `SELECT *
       FROM bank_accounts
       WHERE id = $1
         AND organization_id = $2
         AND deleted_at IS NULL
       LIMIT 1`,
      [bankAccountId, organizationId],
      client,
    );
    return rows[0] ?? null;
  }

  async getReservationFeeSummary(organizationId: number, reservationId: number, client?: PoolClient) {
    const { rows } = await this.query(
      `SELECT
          COALESCE(r.reservation_fee, 0)::NUMERIC(18,2) AS fee_agreed,
          COALESCE((
            SELECT SUM(p.amount)
            FROM sales_reservation_payments p
            WHERE p.organization_id = r.organization_id
              AND p.reservation_id = r.id
              AND p.status IN ('CONFIRMED', 'PARTIALLY_REFUNDED', 'REFUNDED')
          ), 0)::NUMERIC(18,2) AS fee_paid,
          COALESCE((
            SELECT SUM(srref.amount)
            FROM sales_reservation_refunds srref
            WHERE srref.organization_id = r.organization_id
              AND srref.reservation_id = r.id
              AND srref.status = 'CONFIRMED'
          ), 0)::NUMERIC(18,2) AS fee_refunded,
          COALESCE((
            SELECT SUM(sra.amount)
            FROM sales_reservation_fee_allocations sra
            WHERE sra.organization_id = r.organization_id
              AND sra.reservation_id = r.id
              AND sra.reversed_at IS NULL
          ), 0)::NUMERIC(18,2) AS fee_allocated,
          r.currency,
          COALESCE(ss.reservation_fee_deductibility, 'DEDUCTIBLE') AS deductibility,
          COALESCE(ss.reservation_fee_refundable_percentage, 100)::NUMERIC(8,2) AS refundable_percentage
       FROM sales_reservations r
       LEFT JOIN sales_settings ss
         ON ss.organization_id = r.organization_id
       WHERE r.id = $1
         AND r.organization_id = $2
       LIMIT 1`,
      [reservationId, organizationId],
      client,
    );
    return rows[0] ?? null;
  }

  async listReservationPayments(organizationId: number, reservationId: number, client?: PoolClient) {
    const { rows } = await this.query(
      `SELECT p.*,
              COALESCE(refunds.total_refunded, 0)::NUMERIC(18,2) AS refunded_amount,
              COALESCE(allocations.total_allocated, 0)::NUMERIC(18,2) AS allocated_amount,
              GREATEST(
                p.amount - COALESCE(refunds.total_refunded, 0) - COALESCE(allocations.total_allocated, 0),
                0
              )::NUMERIC(18,2) AS available_refundable_amount
       FROM sales_reservation_payments p
       LEFT JOIN (
         SELECT reservation_payment_id, organization_id, SUM(amount)::NUMERIC(18,2) AS total_refunded
         FROM sales_reservation_refunds
         WHERE status = 'CONFIRMED'
         GROUP BY reservation_payment_id, organization_id
       ) refunds
         ON refunds.reservation_payment_id = p.id AND refunds.organization_id = p.organization_id
       LEFT JOIN (
         SELECT reservation_payment_id, organization_id, SUM(amount)::NUMERIC(18,2) AS total_allocated
         FROM sales_reservation_fee_allocations
         WHERE reservation_payment_id IS NOT NULL
           AND reversed_at IS NULL
         GROUP BY reservation_payment_id, organization_id
       ) allocations
         ON allocations.reservation_payment_id = p.id AND allocations.organization_id = p.organization_id
       WHERE p.organization_id = $1
         AND p.reservation_id = $2
       ORDER BY p.payment_date DESC, p.id DESC`,
      [organizationId, reservationId],
      client,
    );
    return rows;
  }

  async findReservationPayment(organizationId: number, paymentId: number, client?: PoolClient) {
    const { rows } = await this.query(
      `SELECT *
       FROM sales_reservation_payments
       WHERE id = $1
         AND organization_id = $2
       LIMIT 1`,
      [paymentId, organizationId],
      client,
    );
    return rows[0] ?? null;
  }

  async findReservationPaymentByIdempotency(organizationId: number, idempotencyKey: string, client?: PoolClient) {
    const { rows } = await this.query(
      `SELECT *
       FROM sales_reservation_payments
       WHERE organization_id = $1
         AND idempotency_key = $2
       LIMIT 1`,
      [organizationId, idempotencyKey],
      client,
    );
    return rows[0] ?? null;
  }

  async listReservationRefunds(organizationId: number, reservationPaymentId: number, client?: PoolClient) {
    const { rows } = await this.query(
      `SELECT *
       FROM sales_reservation_refunds
       WHERE organization_id = $1
         AND reservation_payment_id = $2
       ORDER BY refund_date DESC, id DESC`,
      [organizationId, reservationPaymentId],
      client,
    );
    return rows;
  }

  async createReservationPayment(organizationId: number, userId: number | null, payload: Record<string, unknown>, client: PoolClient) {
    const { rows } = await client.query(
      `INSERT INTO sales_reservation_payments (
         organization_id, reservation_id, payment_number, payment_date, amount, currency,
         payment_method, destination_type, cash_session_id, cash_movement_id,
         bank_account_id, bank_transaction_id, external_reference, idempotency_key, accounting_treatment_snapshot,
         status, notes, created_at, created_by
       )
       VALUES (
         $1, $2, $3, $4::date, $5, $6,
         $7, $8, $9, $10,
         $11, $12, NULLIF($13, ''), $14, $15,
         $16, NULLIF($17, ''), NOW(), $18
       )
       RETURNING *`,
      [
        organizationId,
        payload.reservation_id,
        payload.payment_number,
        payload.payment_date,
        payload.amount,
        payload.currency,
        payload.payment_method,
        payload.destination_type,
        payload.cash_session_id ?? null,
        payload.cash_movement_id ?? null,
        payload.bank_account_id ?? null,
        payload.bank_transaction_id ?? null,
        payload.external_reference ?? null,
        payload.idempotency_key,
        payload.accounting_treatment_snapshot ?? 'CUSTOMER_ADVANCE',
        payload.status ?? 'CONFIRMED',
        payload.notes ?? null,
        userId,
      ],
    );
    return rows[0];
  }

  async updateReservationPaymentLinks(
    organizationId: number,
    paymentId: number,
    payload: { cash_movement_id?: number | null; bank_transaction_id?: number | null },
    client: PoolClient,
  ) {
    const { rows } = await client.query(
      `UPDATE sales_reservation_payments
       SET cash_movement_id = COALESCE($3, cash_movement_id),
           bank_transaction_id = COALESCE($4, bank_transaction_id)
       WHERE id = $1
         AND organization_id = $2
       RETURNING *`,
      [paymentId, organizationId, payload.cash_movement_id ?? null, payload.bank_transaction_id ?? null],
    );
    return rows[0] ?? null;
  }

  async createReservationRefund(organizationId: number, userId: number | null, payload: Record<string, unknown>, client: PoolClient) {
    const { rows } = await client.query(
      `INSERT INTO sales_reservation_refunds (
         organization_id, reservation_payment_id, reservation_id, refund_number, refund_date,
         amount, currency, refund_method, destination_type, cash_session_id, cash_movement_id,
         bank_account_id, bank_transaction_id, reason, idempotency_key, status, created_at, created_by
       )
       VALUES (
         $1, $2, $3, $4, $5::date,
         $6, $7, $8, $9, $10, $11,
         $12, $13, $14, $15, $16, NOW(), $17
       )
       RETURNING *`,
      [
        organizationId,
        payload.reservation_payment_id,
        payload.reservation_id,
        payload.refund_number,
        payload.refund_date,
        payload.amount,
        payload.currency,
        payload.refund_method,
        payload.destination_type,
        payload.cash_session_id ?? null,
        payload.cash_movement_id ?? null,
        payload.bank_account_id ?? null,
        payload.bank_transaction_id ?? null,
        payload.reason,
        payload.idempotency_key,
        payload.status ?? 'CONFIRMED',
        userId,
      ],
    );
    return rows[0];
  }

  async updateReservationRefundLinks(
    organizationId: number,
    refundId: number,
    payload: { cash_movement_id?: number | null; bank_transaction_id?: number | null },
    client: PoolClient,
  ) {
    const { rows } = await client.query(
      `UPDATE sales_reservation_refunds
       SET cash_movement_id = COALESCE($3, cash_movement_id),
           bank_transaction_id = COALESCE($4, bank_transaction_id)
       WHERE id = $1
         AND organization_id = $2
       RETURNING *`,
      [refundId, organizationId, payload.cash_movement_id ?? null, payload.bank_transaction_id ?? null],
    );
    return rows[0] ?? null;
  }

  async updateReservationPaymentStatus(
    organizationId: number,
    paymentId: number,
    payload: { status: string; cancelled_at?: string | null; cancelled_by?: number | null; cancellation_reason?: string | null },
    client: PoolClient,
  ) {
    const { rows } = await client.query(
      `UPDATE sales_reservation_payments
       SET status = $3,
           cancelled_at = CASE WHEN $4::timestamptz IS NULL THEN cancelled_at ELSE $4::timestamptz END,
           cancelled_by = CASE WHEN $5::bigint IS NULL THEN cancelled_by ELSE $5::bigint END,
           cancellation_reason = CASE WHEN $6::text IS NULL THEN cancellation_reason ELSE $6::text END
       WHERE id = $1
         AND organization_id = $2
       RETURNING *`,
      [paymentId, organizationId, payload.status, payload.cancelled_at ?? null, payload.cancelled_by ?? null, payload.cancellation_reason ?? null],
    );
    return rows[0] ?? null;
  }

  async createReservationFeeAllocation(organizationId: number, userId: number | null, payload: Record<string, unknown>, client: PoolClient) {
    const { rows } = await client.query(
      `INSERT INTO sales_reservation_fee_allocations (
         organization_id, reservation_id, reservation_payment_id, subscription_id, amount, currency, created_at, created_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
       RETURNING *`,
      [
        organizationId,
        payload.reservation_id,
        payload.reservation_payment_id ?? null,
        payload.subscription_id,
        payload.amount,
        payload.currency,
        userId,
      ],
    );
    return rows[0];
  }

  async listActiveReservationFeeAllocations(organizationId: number, reservationId: number, client?: PoolClient) {
    const { rows } = await this.query(
      `SELECT *
       FROM sales_reservation_fee_allocations
       WHERE organization_id = $1
         AND reservation_id = $2
         AND reversed_at IS NULL
       ORDER BY created_at ASC, id ASC`,
      [organizationId, reservationId],
      client,
    );
    return rows;
  }
}
