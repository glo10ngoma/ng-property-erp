import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { RequestContext } from '../auth/request-context';
import { requireRow } from '../common/not-found';
import { CommunicationService } from '../communication/communication.service';
import { DocumentDeliveryTrigger } from '../communication/shared/enums/document-delivery-trigger.enum';
import { DocumentType } from '../communication/shared/enums/document-type.enum';
import { DatabaseService } from '../database/database.service';
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
    private readonly communicationService: CommunicationService,
    private readonly context: RequestContext,
  ) {}

  async findAll() {
    const organizationId = this.context.organizationId();
    if (!(await this.supportsGuaranteePaymentSchema())) {
      return this.findAllInvoicePayments(organizationId);
    }
    if (!(await this.supportsTenantCreditSchema())) {
      return this.findAllGuaranteePaymentsWithoutTenantCredits(organizationId);
    }
    const { rows } = await this.db.query(`
      SELECT p.*, i.invoice_number, i.invoice_type, i.total, i.status AS invoice_status,
             CASE WHEN t.tenant_type = 'COMPANY' THEN COALESCE(t.company_name, '')
                  ELSE TRIM(CONCAT(COALESCE(t.first_name, ''), ' ', COALESCE(t.last_name, ''), ' ', COALESCE(t.post_name, '')))
             END AS tenant_name,
             t.phone AS tenant_phone,
             t.email AS tenant_email,
             u.number AS unit_number,
             COALESCE(l.lease_number, gl.lease_number, cl.lease_number, l.id, gl.id, cl.id) AS lease_number,
             b.name AS building_name
      FROM payments p
      LEFT JOIN invoices i ON i.id = p.invoice_id
      LEFT JOIN lease_guarantees g ON g.id = p.lease_guarantee_id
      LEFT JOIN leases gl ON gl.id = g.lease_id
      LEFT JOIN tenant_credits tc ON tc.source_payment_id = p.id AND tc.organization_id = p.organization_id AND tc.deleted_at IS NULL
      LEFT JOIN leases cl ON cl.id = tc.lease_id
      LEFT JOIN tenants t ON t.id = COALESCE(i.tenant_id, gl.tenant_id, tc.tenant_id)
      LEFT JOIN leases l ON l.id = i.lease_id
      LEFT JOIN units u ON u.id = COALESCE(i.unit_id, l.unit_id, gl.unit_id, cl.unit_id, t.unit_id)
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
    if (!(await this.supportsTenantCreditSchema())) {
      return this.findOneGuaranteePaymentWithoutTenantCredits(id, organizationId);
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
              g.status AS guarantee_status,
              tc.id AS tenant_credit_id,
              tc.currency AS tenant_credit_currency,
              tc.original_amount AS tenant_credit_original_amount,
              tc.remaining_amount AS tenant_credit_remaining_amount,
              tc.status AS tenant_credit_status,
              pcm.created_by AS created_by_user_id,
              COALESCE(NULLIF(TRIM(CONCAT(COALESCE(creator.first_name, ''), ' ', COALESCE(creator.last_name, ''))), ''), creator.email) AS created_by_name
       FROM payments p
       LEFT JOIN invoices i ON i.id = p.invoice_id
       LEFT JOIN lease_guarantees g ON g.id = p.lease_guarantee_id
       LEFT JOIN leases gl ON gl.id = g.lease_id
       LEFT JOIN tenant_credits tc ON tc.source_payment_id = p.id AND tc.organization_id = p.organization_id AND tc.deleted_at IS NULL
       LEFT JOIN leases cl ON cl.id = tc.lease_id
       LEFT JOIN tenants t ON t.id = COALESCE(i.tenant_id, gl.tenant_id, tc.tenant_id)
       LEFT JOIN leases l ON l.id = i.lease_id
       LEFT JOIN units u ON u.id = COALESCE(i.unit_id, l.unit_id, gl.unit_id, cl.unit_id, t.unit_id)
       LEFT JOIN buildings b ON b.id = COALESCE(i.building_id, u.building_id)
      LEFT JOIN LATERAL (
         SELECT created_by
         FROM (
           SELECT cm.created_by, cm.id
           FROM cash_movements cm
           WHERE cm.payment_id = p.id
             AND cm.organization_id = p.organization_id
             AND cm.deleted_at IS NULL
           UNION ALL
           SELECT gcm.created_by, gcm.id
           FROM guarantee_cash_movements gcm
           WHERE gcm.payment_id = p.id
             AND gcm.organization_id = p.organization_id
             AND gcm.deleted_at IS NULL
         ) movement_creators
         ORDER BY id
         LIMIT 1
       ) pcm ON TRUE
       LEFT JOIN app_users creator ON creator.id = pcm.created_by AND creator.deleted_at IS NULL
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

  private async supportsTenantCreditSchema() {
    return this.tableExists('tenant_credits');
  }

  private async tableExists(tableName: string) {
    const { rows } = await this.db.query(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name = $1
       ) AS exists`,
      [tableName],
    );
    return Boolean(rows[0]?.exists);
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

  private async findAllGuaranteePaymentsWithoutTenantCredits(organizationId: number) {
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
              NULL::TEXT AS guarantee_status,
              pcm.created_by AS created_by_user_id,
              COALESCE(NULLIF(TRIM(CONCAT(COALESCE(creator.first_name, ''), ' ', COALESCE(creator.last_name, ''))), ''), creator.email) AS created_by_name
       FROM payments p
       LEFT JOIN invoices i ON i.id = p.invoice_id
       LEFT JOIN tenants t ON t.id = i.tenant_id
       LEFT JOIN leases l ON l.id = i.lease_id
       LEFT JOIN units u ON u.id = COALESCE(i.unit_id, l.unit_id, t.unit_id)
       LEFT JOIN buildings b ON b.id = COALESCE(i.building_id, u.building_id)
       LEFT JOIN LATERAL (
         SELECT cm.created_by
         FROM cash_movements cm
         WHERE cm.payment_id = p.id
           AND cm.organization_id = p.organization_id
           AND cm.deleted_at IS NULL
         ORDER BY cm.id
         LIMIT 1
       ) pcm ON TRUE
       LEFT JOIN app_users creator ON creator.id = pcm.created_by AND creator.deleted_at IS NULL
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

  private async findOneGuaranteePaymentWithoutTenantCredits(id: number, organizationId: number) {
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
              g.status AS guarantee_status,
              NULL::INTEGER AS tenant_credit_id,
              NULL::TEXT AS tenant_credit_currency,
              NULL::NUMERIC AS tenant_credit_original_amount,
              NULL::NUMERIC AS tenant_credit_remaining_amount,
              NULL::TEXT AS tenant_credit_status,
              pcm.created_by AS created_by_user_id,
              COALESCE(NULLIF(TRIM(CONCAT(COALESCE(creator.first_name, ''), ' ', COALESCE(creator.last_name, ''))), ''), creator.email) AS created_by_name
       FROM payments p
       LEFT JOIN invoices i ON i.id = p.invoice_id
       LEFT JOIN lease_guarantees g ON g.id = p.lease_guarantee_id
       LEFT JOIN leases gl ON gl.id = g.lease_id
       LEFT JOIN tenants t ON t.id = COALESCE(i.tenant_id, gl.tenant_id)
       LEFT JOIN leases l ON l.id = i.lease_id
       LEFT JOIN units u ON u.id = COALESCE(i.unit_id, l.unit_id, gl.unit_id, t.unit_id)
       LEFT JOIN buildings b ON b.id = COALESCE(i.building_id, u.building_id)
       LEFT JOIN LATERAL (
         SELECT created_by
         FROM (
           SELECT cm.created_by, cm.id
           FROM cash_movements cm
           WHERE cm.payment_id = p.id
             AND cm.organization_id = p.organization_id
             AND cm.deleted_at IS NULL
           UNION ALL
           SELECT gcm.created_by, gcm.id
           FROM guarantee_cash_movements gcm
           WHERE gcm.payment_id = p.id
             AND gcm.organization_id = p.organization_id
             AND gcm.deleted_at IS NULL
         ) movement_creators
         ORDER BY id
         LIMIT 1
       ) pcm ON TRUE
       LEFT JOIN app_users creator ON creator.id = pcm.created_by AND creator.deleted_at IS NULL
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
      const paymentMethod = String(dto.payment_method ?? 'CASH').toUpperCase();
      const amountUsd = this.safeNumber(dto.amount_usd ?? (paymentCurrency === 'USD' ? dto.amount : 0));
      const amountCdf = this.safeNumber(dto.amount_cdf ?? (paymentCurrency === 'CDF' ? dto.amount : 0));
      const rateUsed = this.safeNumber(dto.exchange_rate_used ?? exchangeRate?.rate ?? 0) || null;
      const exchangeRateDate = dto.exchange_rate_date ?? exchangeRate?.effective_date ?? null;
      if (!['CASH', 'BANK', 'MOBILE_MONEY'].includes(paymentMethod)) {
        throw new BadRequestException('Mode de paiement invalide');
      }
      if (paymentMethod === 'BANK' && paymentCurrency === 'MIXED') {
        throw new BadRequestException('Les paiements bancaires ne sont pas compatibles avec un paiement mixte.');
      }
      const bankAccount = paymentMethod === 'BANK'
        ? await this.validateBankAccountForPayment(client, dto.bank_account_id, paymentCurrency)
        : null;
      const bankRentPaymentType = paymentMethod === 'BANK'
        ? await this.bankRentPaymentType(client)
        : 'MANUAL_ADJUSTMENT';
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
          paymentMethod,
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
      if (paymentMethod !== 'BANK' && amountUsd > 0) {
        await this.saas.createInvoicePaymentMovement(client, rows[0].id, primaryInvoiceId, amountUsd, dto.reference, {
          currency: 'USD',
          equivalentUsd: amountUsd,
        });
      }
      if (paymentMethod !== 'BANK' && amountCdf > 0) {
        await this.saas.createInvoicePaymentMovement(client, rows[0].id, primaryInvoiceId, amountCdf, dto.reference, {
          currency: 'CDF',
          exchangeRateUsed: rateUsed,
          exchangeRateDate: exchangeRateDate ? String(exchangeRateDate) : null,
          equivalentUsd: cdfEquivalentUsd,
        });
      }
      if (bankAccount) {
        await this.createBankPaymentTransaction(client, {
          paymentId: Number(rows[0].id),
          invoice: locked,
          bankAccount,
          amount: paymentCurrency === 'CDF' ? amountCdf : amountUsd,
          currency: paymentCurrency,
          receiptNumber,
          reference: dto.reference ?? null,
          createdBy: this.context.userId() ?? null,
          transactionType: bankRentPaymentType,
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

  private async validateBankAccountForPayment(client: import('pg').PoolClient, bankAccountId: number | undefined, paymentCurrency: string) {
    const accountId = Number(bankAccountId ?? 0);
    if (!accountId) {
      throw new BadRequestException('Un compte bancaire actif est requis pour un paiement par banque.');
    }
    const { rows } = await client.query(
      `SELECT id, bank_name, account_name, currency, status
       FROM bank_accounts
       WHERE id = $1
         AND organization_id = $2
         AND deleted_at IS NULL`,
      [accountId, this.context.organizationId()],
    );
    const account = requireRow(rows[0], 'Bank account');
    if (String(account.status).toUpperCase() !== 'ACTIVE') {
      throw new BadRequestException('Le compte bancaire sélectionné doit être actif.');
    }
    if (String(account.currency).toUpperCase() !== String(paymentCurrency).toUpperCase()) {
      throw new BadRequestException('La devise du compte bancaire doit correspondre à celle du paiement.');
    }
    return account;
  }

  private safeNumber(value: unknown) {
    const number = Number(value ?? 0);
    return Number.isFinite(number) ? number : 0;
  }

  private async createBankPaymentTransaction(
    client: import('pg').PoolClient,
    payload: {
      paymentId: number;
      invoice: { id: number; invoice_number?: string | null; tenant_id?: number | null; tenant_name?: string | null };
      bankAccount: { id: number; bank_name?: string | null; account_name?: string | null; currency: string };
      amount: number;
      currency: string;
      receiptNumber: string;
      reference?: string | null;
      createdBy: number | null;
      transactionType: string;
    },
  ) {
    const transactionNumber = await this.nextBankTransactionNumber(client);
    const amount = Number(payload.amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Le montant du mouvement bancaire est invalide.');
    }
    await client.query(
      `INSERT INTO bank_transactions
        (organization_id, bank_account_id, transaction_number, transaction_date, direction, transaction_type, amount, currency,
         reference, description, counterparty_name, source_module, source_entity_type, source_entity_id, status, reversal_of_id,
         idempotency_key, created_by)
       VALUES
        ($1, $2, $3, CURRENT_DATE, 'IN', $4, $5, $6,
         $7, $8, $9, 'PAYMENTS', 'PAYMENT', $10, 'VALIDATED', NULL,
         $11, $12)`,
      [
        this.context.organizationId(),
        payload.bankAccount.id,
        transactionNumber,
        payload.transactionType,
        amount,
        String(payload.currency).toUpperCase(),
        String(payload.reference ?? '').trim() || payload.receiptNumber,
        `Paiement de loyer${payload.invoice.invoice_number ? ` - ${payload.invoice.invoice_number}` : ''}`,
        payload.invoice.tenant_name ?? null,
        payload.paymentId,
        `rent-payment:${this.context.organizationId()}:${payload.paymentId}`,
        payload.createdBy,
      ],
    );
  }

  private async lockInvoiceForPayment(client: import('pg').PoolClient, dto: CreatePaymentDto) {
    const invoiceId = Number(dto.invoice_id ?? dto.allocations?.[0]?.invoice_id ?? 0);
    if (!invoiceId) {
      throw new BadRequestException('Une facture est requise pour enregistrer le paiement.');
    }
    const { rows } = await client.query(
      `SELECT i.id, i.invoice_number, i.total, i.status,
              i.tenant_id,
              CASE WHEN t.tenant_type = 'COMPANY' THEN COALESCE(t.company_name, '')
                   ELSE TRIM(CONCAT(COALESCE(t.first_name, ''), ' ', COALESCE(t.last_name, ''), ' ', COALESCE(t.post_name, '')))
              END AS tenant_name,
              COALESCE(s.paid_amount, 0)::NUMERIC(12,2) AS paid_amount,
              COALESCE(s.remaining_amount, i.total)::NUMERIC(12,2) AS remaining_amount
       FROM invoices i
       LEFT JOIN tenants t ON t.id = i.tenant_id
       LEFT JOIN invoice_payment_summary s ON s.invoice_id = i.id
       WHERE i.id = $1 AND i.organization_id = $2 AND i.deleted_at IS NULL
       FOR UPDATE OF i`,
      [invoiceId, this.context.organizationId()],
    );
    const invoice = requireRow(rows[0], 'Invoice');
    return invoice;
  }

  private async bankRentPaymentType(client: import('pg').PoolClient) {
    const { rows } = await client.query(
      `SELECT EXISTS (
         SELECT 1
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'public'
           AND t.relname = 'bank_transactions'
           AND c.contype = 'c'
           AND pg_get_constraintdef(c.oid) ILIKE '%RENT_PAYMENT%'
       ) AS supported`,
    );
    return rows[0]?.supported ? 'RENT_PAYMENT' : 'MANUAL_ADJUSTMENT';
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

  private async nextBankTransactionNumber(client: import('pg').PoolClient) {
    const year = new Date().getFullYear();
    const { rows } = await client.query(
      `SELECT COALESCE(MAX((SUBSTRING(transaction_number FROM $1))::INT), 0) + 1 AS value
       FROM bank_transactions
       WHERE transaction_number LIKE $2
         AND organization_id = $3`,
      [`BTR-${year}-([0-9]+)`, `BTR-${year}-%`, this.context.organizationId()],
    );
    return `BTR-${year}-${String(rows[0].value).padStart(6, '0')}`;
  }

  private async sendPaymentReceiptIfEnabled(paymentId: number) {
    await this.communicationService.sendDocument({
      documentType: DocumentType.PAYMENT_RECEIPT,
      documentId: paymentId,
      message: 'Veuillez trouver ci-joint votre reçu de paiement.',
      trigger: DocumentDeliveryTrigger.AUTO,
    });
  }
}
