import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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
      SELECT i.*, t.first_name, t.last_name, t.tenant_type, t.company_name,
             CASE WHEN t.tenant_type = 'COMPANY' THEN COALESCE(t.company_name, '')
                  ELSE TRIM(CONCAT(COALESCE(t.first_name, ''), ' ', COALESCE(t.last_name, ''), ' ', COALESCE(t.post_name, '')))
             END AS tenant_name,
             u.number AS unit_number, b.name AS building_name,
             l.id AS lease_number,
             COALESCE(s.paid_amount, 0)::FLOAT AS paid_amount,
             COALESCE(s.remaining_amount, i.total)::FLOAT AS remaining_amount
      FROM invoices i
      JOIN tenants t ON t.id = i.tenant_id
      LEFT JOIN leases l ON l.id = i.lease_id
      LEFT JOIN units u ON u.id = COALESCE(i.unit_id, l.unit_id, t.unit_id)
      LEFT JOIN buildings b ON b.id = COALESCE(i.building_id, u.building_id)
      LEFT JOIN invoice_payment_summary s ON s.invoice_id = i.id
      WHERE i.organization_id = $1 AND i.deleted_at IS NULL
      ORDER BY i.issue_date DESC, i.id DESC
    `, [organizationId]);
    return rows.map((row) => this.normalizeInvoiceDateFields(row));
  }

  async findOne(id: number) {
    const organizationId = this.context.organizationId();
    const { rows } = await this.db.query(
      `SELECT i.*, t.first_name, t.last_name, t.tenant_type, t.company_name,
              CASE WHEN t.tenant_type = 'COMPANY' THEN COALESCE(t.company_name, '')
                   ELSE TRIM(CONCAT(COALESCE(t.first_name, ''), ' ', COALESCE(t.last_name, ''), ' ', COALESCE(t.post_name, '')))
              END AS tenant_name,
              t.phone, t.email,
              u.number AS unit_number, u.monthly_rent, u.monthly_syndic_amount AS unit_monthly_syndic_amount,
              b.name AS building_name, b.address AS building_address, b.city AS building_city,
              l.start_date AS lease_start_date, l.end_date AS lease_end_date, l.monthly_rent AS lease_monthly_rent,
              l.maintenance_fee_amount, l.monthly_syndic_amount,
              COALESCE(s.paid_amount, 0)::FLOAT AS paid_amount,
              COALESCE(s.remaining_amount, i.total)::FLOAT AS remaining_amount
       FROM invoices i
       JOIN tenants t ON t.id = i.tenant_id
       LEFT JOIN leases l ON l.id = i.lease_id
       LEFT JOIN units u ON u.id = COALESCE(i.unit_id, l.unit_id, t.unit_id)
       LEFT JOIN buildings b ON b.id = COALESCE(i.building_id, u.building_id)
       LEFT JOIN invoice_payment_summary s ON s.invoice_id = i.id
       WHERE i.id = $1 AND i.organization_id = $2 AND i.deleted_at IS NULL`,
      [id, organizationId],
    );
    const invoice = rows[0];
    if (!invoice) throw new NotFoundException('Facture introuvable');
    const items = await this.db.query('SELECT * FROM invoice_items WHERE invoice_id = $1 AND organization_id = $2 AND deleted_at IS NULL ORDER BY id', [id, organizationId]);
    const payments = await this.db.query('SELECT * FROM payments WHERE invoice_id = $1 AND organization_id = $2 AND deleted_at IS NULL ORDER BY payment_date DESC', [id, organizationId]);
    const reminders = await this.db.query('SELECT * FROM invoice_reminders WHERE invoice_id = $1 AND organization_id = $2 ORDER BY reminded_at DESC', [id, organizationId]);
    const emailLogs = await this.db.query(
      `SELECT id, recipient, subject, message, status, provider_response, sent_at, created_at
       FROM email_logs
       WHERE organization_id = $1
         AND related_entity_type = 'invoice'
         AND related_entity_id = $2
         AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [organizationId, id],
    );
    const whatsappLogs = await this.db.query(
      `SELECT id, recipient, message, status, provider_response, sent_at, created_at
       FROM whatsapp_logs
       WHERE organization_id = $1
         AND related_entity_type = 'invoice'
         AND related_entity_id = $2
         AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [organizationId, id],
    );
    const automationRun = invoice.automation_run_id
      ? await this.db.query(
          `SELECT id, automation_code, execution_mode, billing_month, billing_year, status, started_at, completed_at
           FROM automation_runs
           WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
          [invoice.automation_run_id, organizationId],
        )
      : { rows: [] as Record<string, unknown>[] };
    return this.normalizeInvoiceDateFields({
      ...invoice,
      items: items.rows,
      payments: payments.rows,
      reminders: reminders.rows,
      email_logs: emailLogs.rows,
      whatsapp_logs: whatsappLogs.rows,
      automation_run: automationRun.rows[0] ?? null,
    });
  }

  async create(dto: CreateInvoiceDto) {
    return this.db.transaction(async (client) => {
      const lease = dto.lease_id ? await this.leaseForInvoice(client, dto.lease_id) : null;
      const tenantId = dto.tenant_id ?? lease?.tenant_id;
      if (!tenantId) throw new Error('tenant_id or lease_id is required');
      const invoiceType = this.normalizeInvoiceType(dto.invoice_type, dto.items);
      const billingMonth = Number(dto.billing_month ?? dto.month);
      const billingYear = Number(dto.billing_year ?? dto.year);
      const periodStart = dto.period_start ?? this.periodStart(billingMonth, billingYear);
      const periodEnd = dto.period_end ?? this.periodEnd(billingMonth, billingYear);
      if (invoiceType === 'RENT' && dto.lease_id) {
        await this.assertNoDuplicateRentInvoice(client, dto.lease_id, billingMonth, billingYear);
      }
      const nextId = await this.nextInvoiceId(client);
      const invoiceNumber = await this.nextInvoiceNumber(client, billingYear);
      const total = this.calculateTotal(dto.items, dto.discount_amount);
      const organizationId = this.context.organizationId();
      const { rows } = await client.query(
        `INSERT INTO invoices (
           id, tenant_id, lease_id, unit_id, building_id, invoice_number,
           month, year, issue_date, due_date, status, total, discount_amount,
           public_notes, internal_notes, attachment_file_name, attachment_file_url, organization_id,
           invoice_type, billing_month, billing_year, period_start, period_end, invoice_date,
           generated_automatically, generation_source
         )
         VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9, $10, $11, $12, $13,
           $14, $15, $16, $17, $18,
           $19, $20, $21, $22, $23, $24,
           FALSE, NULL
         )
         RETURNING *`,
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
          Number(dto.discount_amount ?? 0),
          dto.public_notes ?? null,
          dto.internal_notes ?? null,
          dto.attachment_file_name ?? null,
          dto.attachment_file_url ?? null,
          organizationId,
          invoiceType,
          billingMonth,
          billingYear,
          periodStart,
          periodEnd,
          dto.issue_date,
        ],
      );
      await this.insertItems(client, rows[0].id, dto.items, organizationId);
      return this.findOne(Number(rows[0].id));
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
      const current = await this.findOne(id) as unknown as { items: InvoiceItemDto[]; discount_amount?: number };
      const targetMonth = Number(dto.billing_month ?? dto.month ?? (rowsafe(current, 'billing_month') ?? rowsafe(current, 'month') ?? 0));
      const targetYear = Number(dto.billing_year ?? dto.year ?? (rowsafe(current, 'billing_year') ?? rowsafe(current, 'year') ?? 0));
      const invoiceType = this.normalizeInvoiceType(dto.invoice_type ?? rowsafe(current, 'invoice_type'), dto.items ?? current.items);
      if (invoiceType === 'RENT') {
        const leaseId = Number(rowsafe(current, 'lease_id') ?? 0);
        if (leaseId) {
          await this.assertNoDuplicateRentInvoice(client, leaseId, targetMonth, targetYear, id);
        }
      }
      const total = dto.items || dto.discount_amount !== undefined
        ? this.calculateTotal(dto.items ?? current.items, dto.discount_amount ?? current.discount_amount ?? 0)
        : undefined;
      const { rows } = await client.query(
        `UPDATE invoices
         SET issue_date = COALESCE($2, issue_date),
             due_date = COALESCE($3, due_date),
             total = COALESCE($4, total),
             month = COALESCE($5, month),
             year = COALESCE($6, year),
             discount_amount = COALESCE($7, discount_amount),
             public_notes = COALESCE($8, public_notes),
             internal_notes = COALESCE($9, internal_notes),
             attachment_file_name = COALESCE($10, attachment_file_name),
             attachment_file_url = COALESCE($11, attachment_file_url),
             invoice_type = COALESCE($12, invoice_type),
             billing_month = COALESCE($13, billing_month),
             billing_year = COALESCE($14, billing_year),
             period_start = COALESCE($15, period_start),
             period_end = COALESCE($16, period_end),
             invoice_date = COALESCE($17, invoice_date, issue_date)
         WHERE id = $1 AND organization_id = $18 AND deleted_at IS NULL RETURNING *`,
        [
          id,
          dto.issue_date,
          dto.due_date,
          total,
          dto.month,
          dto.year,
          dto.discount_amount,
          dto.public_notes,
          dto.internal_notes,
          dto.attachment_file_name,
          dto.attachment_file_url,
          invoiceType,
          targetMonth || null,
          targetYear || null,
          dto.period_start ?? (targetMonth && targetYear ? this.periodStart(targetMonth, targetYear) : null),
          dto.period_end ?? (targetMonth && targetYear ? this.periodEnd(targetMonth, targetYear) : null),
          dto.issue_date ?? null,
          this.context.organizationId(),
        ],
      );
      if (rows[0] && rows[0].invoice_type === 'RENT' && rows[0].lease_id) {
        await this.assertNoDuplicateRentInvoice(client, Number(rows[0].lease_id), Number(rows[0].billing_month ?? rows[0].month), Number(rows[0].billing_year ?? rows[0].year), id);
      }
      await this.refreshStatus(client, id);
      return this.findOne(id);
    });
  }

  async validate(id: number) {
    return this.db.transaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE invoices SET status = 'UNPAID', validated_at = NOW()
         WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL AND status = 'DRAFT'
         RETURNING *`,
        [id, this.context.organizationId()],
      );
      const invoice = requireRow(rows[0], 'Invoice') as Record<string, unknown>;
      const tenant = await client.query(
        `SELECT first_name, last_name, email, phone
         FROM tenants
         WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
        [invoice.tenant_id, this.context.organizationId()],
      );
      const tenantRow = tenant.rows[0];
      if (tenantRow) {
        const tenantName = [tenantRow.first_name, tenantRow.last_name].filter(Boolean).join(' ').trim();
        const message = `Bonjour ${tenantName || 'client'}, votre facture ${invoice.invoice_number} a ete validee.`;
        if (tenantRow.email) {
          await client.query(
            `INSERT INTO email_logs (recipient, subject, message, status, provider_response, related_entity_type, related_entity_id, sent_at, created_by, organization_id)
             VALUES ($1, $2, $3, 'SIMULATED', $4, 'invoice', $5, NOW(), $6, $7)`,
            [tenantRow.email, `Facture ${invoice.invoice_number}`, message, JSON.stringify({ provider: 'LOCAL_SIMULATOR', event: 'INVOICE_VALIDATED' }), id, this.context.userId() ?? 1, this.context.organizationId()],
          );
        }
        if (tenantRow.phone) {
          await client.query(
            `INSERT INTO whatsapp_logs (recipient, message, status, provider_response, related_entity_type, related_entity_id, sent_at, created_by, organization_id)
             VALUES ($1, $2, 'SIMULATED', $3, 'invoice', $4, NOW(), $5, $6)`,
            [tenantRow.phone, message, JSON.stringify({ provider: 'LOCAL_SIMULATOR', event: 'INVOICE_VALIDATED' }), id, this.context.userId() ?? 1, this.context.organizationId()],
          );
        }
      }
      return this.findOne(Number(invoice.id));
    });
  }

  async cancel(id: number, reason: string) {
    await this.findOne(id);
    const { rows } = await this.db.query(
      `UPDATE invoices SET status = 'CANCELLED', cancelled_at = NOW(), cancellation_reason = $3
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [id, this.context.organizationId(), reason],
    );
    return this.findOne(id);
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

  private calculateTotal(items: InvoiceItemDto[], discountAmount = 0) {
    const subtotal = items.reduce((sum, item) => sum + this.itemAmount(item), 0);
    return Math.max(0, subtotal - Number(discountAmount ?? 0));
  }

  private async insertItems(client: PoolClient, invoiceId: number, items: InvoiceItemDto[], organizationId: number) {
    for (const item of items) {
      const description = String(item.description ?? '').trim();
      if (!description) {
        throw new BadRequestException('Chaque ligne de facture doit contenir une description.');
      }
      await client.query(
        'INSERT INTO invoice_items (invoice_id, item_type, description, amount, organization_id) VALUES ($1, $2, $3, $4, $5)',
        [invoiceId, item.charge_type ?? item.item_type ?? description, description, this.itemAmount(item), organizationId],
      );
    }
  }

  private async nextInvoiceId(client: PoolClient) {
    await client.query(
      `SELECT setval(
         'invoices_id_seq',
         COALESCE((SELECT MAX(id) FROM invoices), 1),
         EXISTS(SELECT 1 FROM invoices)
       )`,
    );
    const { rows } = await client.query(`SELECT nextval('invoices_id_seq')::INT AS value`);
    return rows[0].value;
  }

  private async nextInvoiceNumber(client: PoolClient, year: number) {
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
    return requireRow(rows[0], 'Lease') as { tenant_id: number; unit_id: number; building_id: number; monthly_rent?: number; maintenance_fee_amount?: number; monthly_syndic_amount?: number };
  }

  private normalizeInvoiceType(value: unknown, items: InvoiceItemDto[]) {
    const normalized = String(value ?? '').trim().toUpperCase();
    if (normalized === 'RENT' || normalized === 'MAINTENANCE' || normalized === 'OTHER' || normalized === 'OTHER_CHARGE') {
      return normalized;
    }
    const hasRentLine = items.some((item) => {
      const type = String(item.item_type ?? '').trim().toUpperCase();
      const description = String(item.description ?? '').trim().toUpperCase();
      return type === 'MONTHLY RENT' || type === 'SYNDIC' || description.startsWith('LOYER ') || description.startsWith('SYNDIC ');
    });
    if (hasRentLine) return 'RENT';
    const hasMaintenanceLine = items.some((item) => {
      const type = String(item.item_type ?? '').trim().toUpperCase();
      const description = String(item.description ?? '').trim().toUpperCase();
      return type === 'MAINTENANCE' || description.startsWith('MAINTENANCE');
    });
    return 'OTHER_CHARGE';
  }

  private itemAmount(item: InvoiceItemDto) {
    const quantity = Number(item.quantity);
    const unitPrice = Number(item.unit_price);
    if (Number.isFinite(quantity) && Number.isFinite(unitPrice)) {
      if (quantity <= 0) throw new BadRequestException('La quantite doit etre strictement superieure a 0.');
      if (unitPrice < 0) throw new BadRequestException('Le prix unitaire doit etre superieur ou egal a 0.');
      return Number((quantity * unitPrice).toFixed(2));
    }
    const amount = Number(item.amount ?? 0);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new BadRequestException('Montant de ligne invalide.');
    }
    return amount;
  }

  private periodStart(month: number, year: number) {
    return `${year}-${String(month).padStart(2, '0')}-01`;
  }

  private periodEnd(month: number, year: number) {
    const lastDay = new Date(year, month, 0).getDate();
    return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  }

  private normalizeInvoiceDateFields<T extends Record<string, any>>(row: T): T {
    const dateKeys = [
      'issue_date',
      'due_date',
      'period_start',
      'period_end',
      'invoice_date',
      'lease_start_date',
      'lease_end_date',
      'payment_date',
      'reminded_at',
      'sent_at',
      'validated_at',
      'cancelled_at',
    ];
    const normalized: Record<string, any> = { ...row };
    for (const key of dateKeys) {
      if (normalized[key] instanceof Date) {
        normalized[key] = this.formatDateOnly(normalized[key] as Date);
      }
    }
    if (Array.isArray(normalized.items)) {
      normalized.items = normalized.items.map((item: Record<string, any>) => this.normalizeInvoiceDateFields(item));
    }
    if (Array.isArray(normalized.payments)) {
      normalized.payments = normalized.payments.map((payment: Record<string, any>) => this.normalizeInvoiceDateFields(payment));
    }
    if (Array.isArray(normalized.reminders)) {
      normalized.reminders = normalized.reminders.map((reminder: Record<string, any>) => this.normalizeInvoiceDateFields(reminder));
    }
    if (Array.isArray(normalized.email_logs)) {
      normalized.email_logs = normalized.email_logs.map((log: Record<string, any>) => this.normalizeInvoiceDateFields(log));
    }
    if (Array.isArray(normalized.whatsapp_logs)) {
      normalized.whatsapp_logs = normalized.whatsapp_logs.map((log: Record<string, any>) => this.normalizeInvoiceDateFields(log));
    }
    if (normalized.automation_run && typeof normalized.automation_run === 'object') {
      normalized.automation_run = this.normalizeInvoiceDateFields(normalized.automation_run);
    }
    return normalized as T;
  }

  private formatDateOnly(value: Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private async assertNoDuplicateRentInvoice(client: PoolClient, leaseId: number, month: number, year: number, excludeId?: number) {
    const params: unknown[] = [this.context.organizationId(), leaseId, month, year];
    const clauses = [
      'organization_id = $1',
      'lease_id = $2',
      'billing_month = $3',
      'billing_year = $4',
      `invoice_type = 'RENT'`,
      'deleted_at IS NULL',
    ];
    if (excludeId) {
      params.push(excludeId);
      clauses.push(`id <> $${params.length}`);
    }
    const { rows } = await client.query(
      `SELECT id, invoice_number
       FROM invoices
       WHERE ${clauses.join(' AND ')}
       LIMIT 1`,
      params,
    );
    if (rows[0]) {
      throw new BadRequestException(`Facture de loyer deja existante pour cette periode: ${rows[0].invoice_number}`);
    }
  }
}

function rowsafe(source: unknown, key: string) {
  if (!source || typeof source !== 'object') return undefined;
  return (source as Record<string, unknown>)[key];
}
