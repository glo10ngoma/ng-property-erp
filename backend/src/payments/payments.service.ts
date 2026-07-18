import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { RequestContext } from '../auth/request-context';
import { requireRow } from '../common/not-found';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { InvoicesService } from '../invoices/invoices.service';
import { SaasService } from '../saas/saas.service';
import { CreatePaymentDto, UpdatePaymentDto } from './dto';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly guaranteePaymentColumns = ['payment_type', 'lease_guarantee_id', 'cash_movement_id', 'idempotency_key'];

  constructor(
    private readonly db: DatabaseService,
    private readonly invoices: InvoicesService,
    private readonly saas: SaasService,
    private readonly emailService: EmailService,
    private readonly context: RequestContext,
  ) {}

  async findAll() {
    const organizationId = this.context.organizationId();
    if (!(await this.supportsGuaranteePaymentSchema())) {
      return this.findAllInvoicePayments(organizationId);
    }
    const { rows } = await this.db.query(`
      SELECT p.*, i.invoice_number, i.invoice_type, i.total, i.status AS invoice_status,
             CASE WHEN t.tenant_type = 'COMPANY' THEN COALESCE(t.company_name, '')
                  ELSE TRIM(CONCAT(COALESCE(t.first_name, ''), ' ', COALESCE(t.last_name, ''), ' ', COALESCE(t.post_name, '')))
             END AS tenant_name,
             t.phone AS tenant_phone,
             t.email AS tenant_email,
             u.number AS unit_number,
             COALESCE(l.lease_number, gl.lease_number, l.id, gl.id) AS lease_number,
             b.name AS building_name
      FROM payments p
      LEFT JOIN invoices i ON i.id = p.invoice_id
      LEFT JOIN lease_guarantees g ON g.id = p.lease_guarantee_id
      LEFT JOIN leases gl ON gl.id = g.lease_id
      LEFT JOIN tenants t ON t.id = COALESCE(i.tenant_id, gl.tenant_id)
      LEFT JOIN leases l ON l.id = i.lease_id
      LEFT JOIN units u ON u.id = COALESCE(i.unit_id, l.unit_id, gl.unit_id, t.unit_id)
      LEFT JOIN buildings b ON b.id = COALESCE(i.building_id, u.building_id)
      WHERE p.organization_id = $1 AND p.deleted_at IS NULL
      ORDER BY p.payment_date DESC, p.id DESC
    `, [organizationId]);
    return rows;
  }

  async findOne(id: number) {
    const organizationId = this.context.organizationId();
    if (!(await this.supportsGuaranteePaymentSchema())) {
      return this.findOneInvoicePayment(id, organizationId);
    }
    const { rows } = await this.db.query(
      `SELECT p.*, i.invoice_number, i.invoice_type, i.month, i.year, i.issue_date, i.due_date, i.total AS invoice_total, i.status AS invoice_status,
              CASE WHEN t.tenant_type = 'COMPANY' THEN COALESCE(t.company_name, '')
                   ELSE TRIM(CONCAT(COALESCE(t.first_name, ''), ' ', COALESCE(t.last_name, ''), ' ', COALESCE(t.post_name, '')))
              END AS tenant_name,
              t.tenant_type, t.phone AS tenant_phone, t.secondary_phone AS tenant_secondary_phone, t.email AS tenant_email,
              t.company_name, t.rccm, t.tax_number, t.business_sector,
              u.number AS unit_number, u.monthly_rent, u.status AS unit_status,
              b.name AS building_name, b.address AS building_address, b.city AS building_city, b.commune AS building_commune,
              COALESCE(l.id, gl.id) AS lease_id, COALESCE(l.lease_number, gl.lease_number, l.id, gl.id) AS lease_number,
              COALESCE(l.start_date, gl.start_date) AS lease_start_date,
              COALESCE(l.end_date, gl.end_date) AS lease_end_date,
              COALESCE(l.status, gl.status) AS lease_status,
              g.amount AS guarantee_amount,
              g.paid_amount AS guarantee_paid_amount,
              g.status AS guarantee_status
       FROM payments p
       LEFT JOIN invoices i ON i.id = p.invoice_id
       LEFT JOIN lease_guarantees g ON g.id = p.lease_guarantee_id
       LEFT JOIN leases gl ON gl.id = g.lease_id
       LEFT JOIN tenants t ON t.id = COALESCE(i.tenant_id, gl.tenant_id)
       LEFT JOIN leases l ON l.id = i.lease_id
       LEFT JOIN units u ON u.id = COALESCE(i.unit_id, l.unit_id, gl.unit_id, t.unit_id)
       LEFT JOIN buildings b ON b.id = COALESCE(i.building_id, u.building_id)
       WHERE p.id = $1 AND p.organization_id = $2 AND p.deleted_at IS NULL`,
      [id, organizationId],
    );
    const payment = requireRow(rows[0], 'Payment');
    const allocations = await this.db.query(
      `SELECT pa.*, i.invoice_number
       FROM payment_allocations pa
       JOIN invoices i ON i.id = pa.invoice_id
       WHERE pa.payment_id = $1 AND pa.organization_id = $2 AND pa.deleted_at IS NULL
       ORDER BY pa.id`,
      [id, organizationId],
    );
    const reminders = payment.invoice_id
      ? await this.db.query(
        `SELECT * FROM invoice_reminders WHERE invoice_id = $1 AND organization_id = $2 ORDER BY reminded_at DESC`,
        [payment.invoice_id, organizationId],
      )
      : { rows: [] };
    const audit = await this.db.query(
      `SELECT al.id, al.created_at AS date, al.action, al.resource, al.method, al.path, al.status_code, al.metadata,
              CONCAT(u.first_name, ' ', u.last_name) AS user_name
       FROM audit_logs al
       LEFT JOIN app_users u ON u.id = al.user_id
       WHERE al.organization_id = $1 AND al.resource = 'payments' AND al.resource_id = $2
       ORDER BY al.created_at DESC`,
      [organizationId, String(id)],
    );
    return { ...payment, allocations: allocations.rows, reminders: reminders.rows, audit: audit.rows };
  }

  private async supportsGuaranteePaymentSchema() {
    const { rows } = await this.db.query(
      `SELECT COUNT(*)::INT AS column_count
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'payments'
         AND column_name = ANY($1::TEXT[])`,
      [this.guaranteePaymentColumns],
    );
    return Number(rows[0]?.column_count ?? 0) === this.guaranteePaymentColumns.length;
  }

  private async findAllInvoicePayments(organizationId: number) {
    const { rows } = await this.db.query(`
      SELECT p.*, i.invoice_number, i.invoice_type, i.total, i.status AS invoice_status,
             CASE WHEN t.tenant_type = 'COMPANY' THEN COALESCE(t.company_name, '')
                  ELSE TRIM(CONCAT(COALESCE(t.first_name, ''), ' ', COALESCE(t.last_name, ''), ' ', COALESCE(t.post_name, '')))
             END AS tenant_name,
             t.phone AS tenant_phone,
             t.email AS tenant_email,
             u.number AS unit_number,
             COALESCE(l.lease_number, l.id) AS lease_number,
             b.name AS building_name
      FROM payments p
      LEFT JOIN invoices i ON i.id = p.invoice_id
      LEFT JOIN tenants t ON t.id = i.tenant_id
      LEFT JOIN leases l ON l.id = i.lease_id
      LEFT JOIN units u ON u.id = COALESCE(i.unit_id, l.unit_id, t.unit_id)
      LEFT JOIN buildings b ON b.id = COALESCE(i.building_id, u.building_id)
      WHERE p.organization_id = $1 AND p.deleted_at IS NULL
      ORDER BY p.payment_date DESC, p.id DESC
    `, [organizationId]);
    return rows;
  }

  private async findOneInvoicePayment(id: number, organizationId: number) {
    const { rows } = await this.db.query(
      `SELECT p.*, i.invoice_number, i.invoice_type, i.month, i.year, i.issue_date, i.due_date, i.total AS invoice_total, i.status AS invoice_status,
              CASE WHEN t.tenant_type = 'COMPANY' THEN COALESCE(t.company_name, '')
                   ELSE TRIM(CONCAT(COALESCE(t.first_name, ''), ' ', COALESCE(t.last_name, ''), ' ', COALESCE(t.post_name, '')))
              END AS tenant_name,
              t.tenant_type, t.phone AS tenant_phone, t.secondary_phone AS tenant_secondary_phone, t.email AS tenant_email,
              t.company_name, t.rccm, t.tax_number, t.business_sector,
              u.number AS unit_number, u.monthly_rent, u.status AS unit_status,
              b.name AS building_name, b.address AS building_address, b.city AS building_city, b.commune AS building_commune,
              l.id AS lease_id, COALESCE(l.lease_number, l.id) AS lease_number,
              l.start_date AS lease_start_date,
              l.end_date AS lease_end_date,
              l.status AS lease_status,
              NULL::NUMERIC AS guarantee_amount,
              NULL::NUMERIC AS guarantee_paid_amount,
              NULL::TEXT AS guarantee_status
       FROM payments p
       LEFT JOIN invoices i ON i.id = p.invoice_id
       LEFT JOIN tenants t ON t.id = i.tenant_id
       LEFT JOIN leases l ON l.id = i.lease_id
       LEFT JOIN units u ON u.id = COALESCE(i.unit_id, l.unit_id, t.unit_id)
       LEFT JOIN buildings b ON b.id = COALESCE(i.building_id, u.building_id)
       WHERE p.id = $1 AND p.organization_id = $2 AND p.deleted_at IS NULL`,
      [id, organizationId],
    );
    const payment = requireRow(rows[0], 'Payment');
    const allocations = await this.db.query(
      `SELECT pa.*, i.invoice_number
       FROM payment_allocations pa
       JOIN invoices i ON i.id = pa.invoice_id
       WHERE pa.payment_id = $1 AND pa.organization_id = $2 AND pa.deleted_at IS NULL
       ORDER BY pa.id`,
      [id, organizationId],
    );
    const reminders = payment.invoice_id
      ? await this.db.query(
        `SELECT * FROM invoice_reminders WHERE invoice_id = $1 AND organization_id = $2 ORDER BY reminded_at DESC`,
        [payment.invoice_id, organizationId],
      )
      : { rows: [] };
    const audit = await this.db.query(
      `SELECT al.id, al.created_at AS date, al.action, al.resource, al.method, al.path, al.status_code, al.metadata,
              CONCAT(u.first_name, ' ', u.last_name) AS user_name
       FROM audit_logs al
       LEFT JOIN app_users u ON u.id = al.user_id
       WHERE al.organization_id = $1 AND al.resource = 'payments' AND al.resource_id = $2
       ORDER BY al.created_at DESC`,
      [organizationId, String(id)],
    );
    return { ...payment, allocations: allocations.rows, reminders: reminders.rows, audit: audit.rows };
  }

  async create(dto: CreatePaymentDto) {
    const payment = await this.db.transaction(async (client) => {
      const locked = await this.lockInvoiceForPayment(client, dto);
      const exchangeRate = await this.currentExchangeRate();
      const paymentCurrency = String(dto.payment_currency ?? 'USD').toUpperCase();
      const amountUsd = this.safeNumber(dto.amount_usd ?? (paymentCurrency === 'USD' ? dto.amount : 0));
      const amountCdf = this.safeNumber(dto.amount_cdf ?? (paymentCurrency === 'CDF' ? dto.amount : 0));
      const rateUsed = this.safeNumber(dto.exchange_rate_used ?? exchangeRate?.rate ?? 0) || null;
      const exchangeRateDate = dto.exchange_rate_date ?? exchangeRate?.effective_date ?? null;
      if (paymentCurrency === 'CDF' && !rateUsed) {
        throw new BadRequestException('Aucun taux de change n\'est configure. Veuillez definir le taux dans Parametres.');
      }
      if (paymentCurrency === 'MIXED' && amountCdf > 0 && !rateUsed) {
        throw new BadRequestException('Un taux de change est requis pour un paiement mixte.');
      }
      const cdfEquivalentUsd = amountCdf > 0 && rateUsed ? Number((amountCdf / rateUsed).toFixed(2)) : 0;
      const totalEquivalentUsd = Number((amountUsd + cdfEquivalentUsd).toFixed(2));
      if (!Number.isFinite(amountUsd) || !Number.isFinite(amountCdf) || !Number.isFinite(totalEquivalentUsd)) {
        throw new BadRequestException('Montant de paiement invalide');
      }
      if (amountUsd <= 0 && amountCdf <= 0) {
        throw new BadRequestException('Le paiement doit contenir au moins un montant USD ou CDF.');
      }
      if (amountUsd < 0 || amountCdf < 0) {
        throw new BadRequestException('Les montants de paiement ne peuvent pas etre negatifs.');
      }
      if (rateUsed !== null && (!Number.isFinite(rateUsed) || rateUsed <= 0)) {
        throw new BadRequestException('Le taux de change doit etre superieur a 0.');
      }
      const remaining = Number(locked.remaining_amount ?? locked.total ?? 0);
      if (remaining <= 0 || String(locked.status).toUpperCase() === 'PAID') {
        throw new BadRequestException('Cette facture est deja soldée.');
      }
      if (totalEquivalentUsd > remaining + 0.01) {
        throw new BadRequestException(`Le paiement depasse le restant dû (${remaining.toFixed(2)} USD).`);
      }
      const allocations = this.allocationsFromDto(dto);
      const allocationTotal = allocations.reduce((sum, allocation) => sum + Number(allocation.amount), 0);
      const primaryInvoiceId = dto.invoice_id ?? allocations[0]?.invoice_id;
      if (!primaryInvoiceId) {
        throw new BadRequestException('Une facture est requise pour enregistrer le paiement.');
      }
      const receiptNumber = await this.nextReceiptNumber(client);
      const { rows } = await client.query(
        `INSERT INTO payments (invoice_id, payment_date, amount, payment_method, reference, notes, payer_name, receipt_number, currency, amount_usd, amount_cdf, exchange_rate_used, exchange_rate_date, cdf_equivalent_usd, total_equivalent_usd, organization_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING *`,
        [
          primaryInvoiceId,
          dto.payment_date,
          totalEquivalentUsd || allocationTotal || this.safeNumber(dto.amount),
          dto.payment_method,
          dto.reference ?? null,
          dto.notes ?? null,
          dto.payer_name ?? null,
          receiptNumber,
          paymentCurrency,
          amountUsd,
          amountCdf,
          rateUsed,
          exchangeRateDate,
          cdfEquivalentUsd,
          totalEquivalentUsd || allocationTotal || this.safeNumber(dto.amount),
          this.context.organizationId(),
        ],
      );
      for (const allocation of allocations) {
        await client.query(
          `INSERT INTO payment_allocations (payment_id, invoice_id, amount, organization_id)
           VALUES ($1, $2, $3, $4)`,
          [rows[0].id, allocation.invoice_id, allocation.amount, this.context.organizationId()],
        );
        await this.invoices.refreshStatus(client, allocation.invoice_id);
      }
      if (amountUsd > 0) {
        await this.saas.createInvoicePaymentMovement(client, rows[0].id, primaryInvoiceId, amountUsd, dto.reference, {
          currency: 'USD',
          equivalentUsd: amountUsd,
        });
      }
      if (amountCdf > 0) {
        await this.saas.createInvoicePaymentMovement(client, rows[0].id, primaryInvoiceId, amountCdf, dto.reference, {
          currency: 'CDF',
          exchangeRateUsed: rateUsed,
          exchangeRateDate: exchangeRateDate ? String(exchangeRateDate) : null,
          equivalentUsd: cdfEquivalentUsd,
        });
      }
      await this.invoices.refreshStatus(client, primaryInvoiceId);
      return rows[0];
    });
    void this.sendPaymentReceiptIfEnabled(Number(payment.id)).catch((error) => {
      this.logger.error(
        `[PAYMENT] async receipt email failed paymentId=${Number(payment.id)} organizationId=${this.context.organizationId()} message=${error instanceof Error ? error.message : String(error)}`,
      );
    });
    return payment;
  }

  async update(id: number, dto: UpdatePaymentDto) {
    await this.findOne(id);
    return this.db.transaction(async (client) => {
      const invoiceId = Number(dto.invoice_id);
      const { rows } = await client.query(
        `UPDATE payments
         SET invoice_id = $2, payment_date = $3, amount = $4,
             payment_method = $5, reference = $6, notes = $7
         WHERE id = $1 AND organization_id = $8 AND deleted_at IS NULL RETURNING *`,
        [id, invoiceId, dto.payment_date, dto.amount, dto.payment_method, dto.reference ?? null, dto.notes ?? null, this.context.organizationId()],
      );
      await this.invoices.refreshStatus(client, invoiceId);
      return rows[0];
    });
  }

  async remove(id: number) {
    const payment = await this.findOne(id);
    await this.db.transaction(async (client) => {
      await client.query('UPDATE payments SET deleted_at = NOW(), deleted_by = $2 WHERE id = $1 AND organization_id = $3', [
        id,
        this.context.userId(),
        this.context.organizationId(),
      ]);
      await client.query('UPDATE payment_allocations SET deleted_at = NOW(), deleted_by = $2 WHERE payment_id = $1 AND organization_id = $3', [
        id,
        this.context.userId(),
        this.context.organizationId(),
      ]);
      for (const allocation of payment.allocations ?? []) {
        await this.invoices.refreshStatus(client, allocation.invoice_id);
      }
    });
    return { deleted: true };
  }

  private allocationsFromDto(dto: CreatePaymentDto) {
    if (dto.allocations?.length) return dto.allocations;
    return [{ invoice_id: Number(dto.invoice_id), amount: Number(dto.amount) }];
  }

  private safeNumber(value: unknown) {
    const number = Number(value ?? 0);
    return Number.isFinite(number) ? number : 0;
  }

  private async lockInvoiceForPayment(client: import('pg').PoolClient, dto: CreatePaymentDto) {
    const invoiceId = Number(dto.invoice_id ?? dto.allocations?.[0]?.invoice_id ?? 0);
    if (!invoiceId) {
      throw new BadRequestException('Une facture est requise pour enregistrer le paiement.');
    }
    const { rows } = await client.query(
      `SELECT i.id, i.total, i.status,
              COALESCE(s.paid_amount, 0)::NUMERIC(12,2) AS paid_amount,
              COALESCE(s.remaining_amount, i.total)::NUMERIC(12,2) AS remaining_amount
       FROM invoices i
       LEFT JOIN invoice_payment_summary s ON s.invoice_id = i.id
       WHERE i.id = $1 AND i.organization_id = $2 AND i.deleted_at IS NULL
       FOR UPDATE OF i`,
      [invoiceId, this.context.organizationId()],
    );
    const invoice = requireRow(rows[0], 'Invoice');
    return invoice;
  }

  private async currentExchangeRate() {
    const { rows } = await this.db.query(
      `SELECT rate, effective_date
       FROM exchange_rates
       WHERE organization_id = $1 AND deleted_at IS NULL AND is_active = TRUE
       ORDER BY effective_date DESC, id DESC
       LIMIT 1`,
      [this.context.organizationId()],
    );
    return rows[0] ?? null;
  }

  private async nextReceiptNumber(client: import('pg').PoolClient) {
    const year = new Date().getFullYear();
    const { rows } = await client.query(
      `SELECT COALESCE(MAX((SUBSTRING(receipt_number FROM $1))::INT), 0) + 1 AS value
       FROM payments
       WHERE receipt_number LIKE $2 AND organization_id = $3`,
      [`RCPT-${year}-([0-9]+)`, `RCPT-${year}-%`, this.context.organizationId()],
    );
    return `RCPT-${year}-${String(rows[0].value).padStart(4, '0')}`;
  }

  private async sendPaymentReceiptIfEnabled(paymentId: number) {
    const runtime = this.emailService.getRuntimeConfig();
    if (!runtime.paymentReceiptEnabled) {
      return;
    }

    const details = await this.findOne(paymentId) as Record<string, unknown>;
    const remainingAmount = details.invoice_total !== undefined
      ? Math.max(Number(details.invoice_total ?? 0) - Number(details.total_equivalent_usd ?? details.amount ?? 0), 0)
      : null;

    await this.emailService.sendPaymentReceiptEmail({
      organizationId: this.context.organizationId(),
      paymentId: Number(details.id),
      invoiceId: details.invoice_id ? Number(details.invoice_id) : null,
      invoiceNumber: details.invoice_number ? String(details.invoice_number) : null,
      receiptNumber: String(details.receipt_number ?? `PAY-${details.id}`),
      tenantName: String(details.tenant_name ?? 'Locataire'),
      tenantEmail: details.tenant_email ? String(details.tenant_email) : null,
      paymentDate: String(details.payment_date),
      amount: Number(details.total_equivalent_usd ?? details.amount ?? 0),
      currency: 'USD',
      remainingAmount,
      reference: details.reference ? String(details.reference) : null,
      createdBy: this.context.userId() ?? 1,
      idempotencyKey: this.emailService.buildIdempotencyKey([
        this.context.organizationId(),
        'PAYMENT_RECEIVED',
        Number(details.id ?? paymentId),
        String(details.receipt_number ?? details.reference ?? ''),
      ]),
    });
  }
}
