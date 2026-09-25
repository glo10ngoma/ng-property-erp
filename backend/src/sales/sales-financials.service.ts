import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import type { PoolClient } from 'pg';
import { RequestContext } from '../auth/request-context';
import { EmailService } from '../communication/email/email.service';
import { DocumentDeliveryTrigger } from '../communication/shared/enums/document-delivery-trigger.enum';
import { DocumentType } from '../communication/shared/enums/document-type.enum';
import { DatabaseService } from '../database/database.service';
import { PdfRendererService } from '../documents/pdf-renderer.service';
import type {
  CancelSalesReservationPaymentDto,
  CreateSalesReservationPaymentDto,
  CreateSalesReservationRefundDto,
  SalesInvoiceListQueryDto,
  SalesReservationStatusActionDto,
} from './dto';
import { SalesRepository } from './sales.repository';

type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'CANCELLED';
type PaymentStatus = 'CONFIRMED' | 'CANCELLED' | 'PARTIALLY_REFUNDED' | 'REFUNDED';

type SalesInvoiceRow = {
  id: number;
  organization_id: number;
  subscription_id: number;
  installment_id: number;
  invoice_number: string;
  status: InvoiceStatus;
  issue_date: string;
  due_date: string;
  currency: string;
  subtotal_amount: number;
  discount_amount: number;
  fee_allocation_amount: number;
  total_amount: number;
  paid_amount: number;
  refunded_amount: number;
  balance_due: number;
  buyer_name?: string | null;
  buyer_email?: string | null;
  subscription_number?: string | null;
  catalog_title?: string | null;
  project_name?: string | null;
  installment_label?: string | null;
  installment_sequence_number?: number | null;
  sent_at?: string | null;
  send_status?: string | null;
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
  documents?: unknown[];
  payments?: unknown[];
};

type SalesInvoicePaymentRow = {
  id: number;
  organization_id: number;
  invoice_id: number;
  subscription_id: number;
  installment_id?: number | null;
  payment_number: string;
  status: PaymentStatus;
  amount: number;
  currency: string;
  payment_date: string;
  payment_method: string;
  destination_type: string;
  cash_session_id?: number | null;
  bank_account_id?: number | null;
  cash_movement_id?: number | null;
  bank_transaction_id?: number | null;
  external_reference?: string | null;
  notes?: string | null;
  idempotency_key?: string | null;
  payload_hash?: string | null;
  refunded_amount?: number | null;
  allocated_amount?: number | null;
  available_refundable_amount?: number | null;
  receipt?: unknown;
  refunds?: unknown[];
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
};

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}
function asDateString(value?: Date | string | null) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value.slice(0, 10) : parsed.toISOString().slice(0, 10);
  }
  return new Date().toISOString().slice(0, 10);
}
function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: currency || 'USD',
    maximumFractionDigits: 2,
  }).format(value || 0);
}

@Injectable()
export class SalesFinancialsService {
  private readonly pdfRenderer = new PdfRendererService();

  constructor(
    private readonly db: DatabaseService,
    private readonly context: RequestContext,
    private readonly repository: SalesRepository,
    private readonly emailService: EmailService,
  ) {}

  async listInvoices(query: SalesInvoiceListQueryDto) {
    const organizationId = this.context.organizationId();
    const page = Math.max(Number(query.page ?? 1), 1);
    const pageSize = Math.min(Math.max(Number(query.pageSize ?? 20), 1), 100);
    const offset = (page - 1) * pageSize;
    const params: unknown[] = [organizationId];
    const filters: string[] = ['si.organization_id = $1'];
    const sortColumnMap: Record<string, string> = {
      invoice_number: 'si.invoice_number',
      status: 'si.status',
      issue_date: 'si.issue_date',
      due_date: 'si.due_date',
      total_amount: 'si.total_amount',
      paid_amount: 'si.paid_amount',
      balance_due: 'si.balance_due',
      created_at: 'si.created_at',
      updated_at: 'si.updated_at',
    };
    const sortColumn = sortColumnMap[query.sortBy ?? 'due_date'] ?? sortColumnMap.due_date;
    const sortOrder = String(query.sortOrder ?? 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    if (query.search?.trim()) {
      params.push(`%${query.search.trim().toLowerCase()}%`);
      filters.push(`(
        LOWER(si.invoice_number) LIKE $${params.length}
        OR LOWER(COALESCE(sb.full_name, sb.company_name, '')) LIKE $${params.length}
        OR LOWER(COALESCE(ss.subscription_number, '')) LIKE $${params.length}
        OR LOWER(COALESCE(sc.title, '')) LIKE $${params.length}
      )`);
    }

    if (query.status?.trim()) {
      params.push(query.status.trim().toUpperCase());
      filters.push(`si.status = $${params.length}`);
    }

    const where = filters.join(' AND ');
    const totalResult = await this.db.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM sales_invoices si
       JOIN sales_subscriptions ss ON ss.id = si.subscription_id
       JOIN sales_buyers sb ON sb.id = ss.buyer_id
       JOIN sales_property_catalog sc ON sc.id = ss.catalog_item_id AND sc.organization_id = ss.organization_id
       WHERE ${where}`,
      params,
    );

    params.push(pageSize, offset);
    const rows = await this.db.query<SalesInvoiceRow>(
      `SELECT
         si.*,
         ss.subscription_number,
         ss.project_id,
         sb.full_name AS buyer_name,
         sc.title AS catalog_title,
         sp.name AS project_name,
         ssi.label AS installment_label,
         ssi.sequence_number AS installment_sequence_number
       FROM sales_invoices si
       JOIN sales_subscriptions ss ON ss.id = si.subscription_id
       JOIN sales_buyers sb ON sb.id = ss.buyer_id
       JOIN sales_property_catalog sc ON sc.id = ss.catalog_item_id AND sc.organization_id = ss.organization_id
       LEFT JOIN sales_projects sp ON sp.id = ss.project_id
       LEFT JOIN sales_subscription_installments ssi ON ssi.id = si.installment_id
       WHERE ${where}
       ORDER BY ${sortColumn} ${sortOrder}, si.id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return {
      items: rows.rows.map((row) => this.normalizeInvoice(row)),
      total: Number(totalResult.rows[0]?.total ?? 0),
      page,
      pageSize,
    };
  }

  async getInvoice(id: number, client?: PoolClient) {
    const organizationId = this.context.organizationId();
    const runner = client ?? this.db;
    const invoice = await this.findInvoice(organizationId, id, client);
    if (!invoice) throw new NotFoundException('Facture introuvable.');
    const payments = await this.listPaymentsForInvoiceInternal(organizationId, id, client);
    const items = await (runner as any).query(
      `SELECT * FROM sales_invoice_items
       WHERE organization_id = $1 AND invoice_id = $2
       ORDER BY sort_order ASC, id ASC`,
      [organizationId, id],
    );
    const documents = await (runner as any).query(
      `SELECT *
       FROM sales_document_generations
       WHERE organization_id = $1 AND entity_type = 'SALES_INVOICE' AND entity_id = $2
       ORDER BY created_at DESC, id DESC`,
      [organizationId, id],
    );
    const paymentDestinations = {
      cash_sessions: await this.repository.listOpenCashSessions(organizationId, client),
      bank_accounts: await this.repository.listActiveBankAccounts(organizationId, String(invoice.currency ?? 'USD'), client),
    };
    return {
      ...invoice,
      items: items.rows,
      payments,
      documents: documents.rows,
      payment_destinations: paymentDestinations,
    };
  }

  async getSubscriptionFinancialSummary(subscriptionId: number) {
    const organizationId = this.context.organizationId();
    const subscription = await this.repository.findSubscription(organizationId, subscriptionId);
    if (!subscription) throw new NotFoundException('Souscription introuvable.');
    const installmentsResult = await this.db.query<any>(
      `SELECT
         ssi.*,
         si.id AS invoice_id,
         si.invoice_number,
         si.status AS invoice_status,
         si.issue_date,
         si.due_date AS invoice_due_date,
         si.total_amount,
         si.paid_amount,
         si.refunded_amount,
         si.balance_due
       FROM sales_subscription_installments ssi
       LEFT JOIN sales_invoices si
         ON si.organization_id = ssi.organization_id
        AND si.installment_id = ssi.id
        AND si.status <> 'CANCELLED'
       WHERE ssi.organization_id = $1
         AND ssi.subscription_id = $2
       ORDER BY ssi.sequence_number ASC`,
      [organizationId, subscriptionId],
    );
    const feeSummary = subscription.reservation_id
      ? await this.repository.getReservationFeeSummary(organizationId, subscription.reservation_id)
      : null;
    const now = new Date();
    let totalFactured = 0;
    let totalPaid = 0;
    let totalRefunded = 0;
    let amountDue = 0;
    let overdueAmount = 0;
    let paidInstallments = 0;
    let overdueInstallments = 0;
    let remainingInstallments = 0;
    let nextDueDate: string | null = null;

    const installments = installmentsResult.rows.map((row) => {
      const totalAmount = Number(row.total_amount ?? row.amount ?? 0);
      const paidAmount = Number(row.paid_amount ?? 0);
      const refundedAmount = Number(row.refunded_amount ?? 0);
      const balanceDue = Number(row.balance_due ?? totalAmount);
      const dueDate = row.invoice_due_date ?? row.due_date;
      const isOverdue = balanceDue > 0 && dueDate ? new Date(dueDate) < now : false;
      totalFactured += row.invoice_id ? totalAmount : 0;
      totalPaid += paidAmount;
      totalRefunded += refundedAmount;
      amountDue += balanceDue;
      if (balanceDue <= 0 && row.invoice_id) paidInstallments += 1;
      else remainingInstallments += 1;
      if (isOverdue) {
        overdueAmount += balanceDue;
        overdueInstallments += 1;
      }
      if (balanceDue > 0 && dueDate && (!nextDueDate || new Date(dueDate) < new Date(nextDueDate))) {
        nextDueDate = dueDate;
      }
      return {
        ...row,
        financial_status: balanceDue <= 0 ? 'PAID' : isOverdue ? 'OVERDUE' : paidAmount > 0 ? 'PARTIALLY_PAID' : 'SCHEDULED',
      };
    });

    const feePaid = Number(feeSummary?.fee_paid ?? 0);
    const feeRefunded = Number(feeSummary?.fee_refunded ?? 0);
    const feeAllocated = Number(feeSummary?.fee_allocated ?? 0);
    const feeAvailable = Number(feeSummary?.fee_available ?? 0);
    const finalSalePrice = Number(subscription.final_sale_price ?? 0);
    const depositAmount = Number(subscription.deposit_amount ?? 0);
    const financedBalance = Number(subscription.financed_balance ?? 0);
    const globalBalance = Math.max(roundMoney(finalSalePrice - totalPaid + totalRefunded - feeAllocated), 0);

    return {
      subscription_id: subscription.id,
      subscription_number: subscription.subscription_number,
      currency: subscription.currency,
      final_sale_price: finalSalePrice,
      deposit_expected: depositAmount,
      deposit_paid: totalPaid >= depositAmount ? depositAmount : totalPaid,
      financed_balance: financedBalance,
      total_invoiced: roundMoney(totalFactured),
      total_paid: roundMoney(totalPaid),
      total_refunded: roundMoney(totalRefunded),
      balance_due: roundMoney(amountDue),
      global_balance_due: globalBalance,
      amount_due: roundMoney(amountDue),
      overdue_amount: roundMoney(overdueAmount),
      next_due_date: nextDueDate,
      installments_paid: paidInstallments,
      installments_remaining: remainingInstallments,
      installments_overdue: overdueInstallments,
      reservation_fee: {
        paid: roundMoney(feePaid),
        refunded: roundMoney(feeRefunded),
        allocated: roundMoney(feeAllocated),
        available: roundMoney(feeAvailable),
      },
      installments,
    };
  }

  async listSubscriptionInstallments(subscriptionId: number) {
    return this.getSubscriptionFinancialSummary(subscriptionId).then((summary) => summary.installments);
  }

  async generateInvoice(subscriptionId: number, installmentId: number) {
    return this.db.transaction(async (client) => {
      return this.generateInvoiceForAutomation(
        this.context.organizationId(),
        subscriptionId,
        installmentId,
        this.context.userId(),
        client,
      );
    });
  }

  async generateInvoiceForAutomation(
    organizationId: number,
    subscriptionId: number,
    installmentId: number,
    actorUserId: number | null,
    client: PoolClient,
  ) {
    const subscription = await this.requireSubscriptionFinancialContext(organizationId, subscriptionId, client);
    const installment = await this.requireInstallment(organizationId, subscriptionId, installmentId, client);
    const existing = await this.findActiveInvoiceByInstallment(organizationId, subscriptionId, installmentId, client);
    if (existing) {
      return this.normalizeInvoice(existing);
    }
    const settings = await this.repository.findSettings(organizationId, client);
    const configuredInvoiceFormat = String(settings?.sales_invoice_number_format ?? '').trim();
    const legacyInvoicePrefix = String(settings?.invoice_prefix ?? '').trim();
    const invoiceNumberFormat = configuredInvoiceFormat
      ? configuredInvoiceFormat
      : legacyInvoicePrefix
        ? `${legacyInvoicePrefix}-{YYYY}-{SEQ:5}`
        : 'FAC-VTE-{YYYY}-{SEQ:5}';
    const invoiceNumber = await this.generateSequence(
      organizationId,
      'SALES_INVOICE',
      invoiceNumberFormat,
      client,
    );
    const feeAllocation = await this.resolveDeductibleAllocation(organizationId, subscriptionId, client);
    const baseAmount = Number(installment.amount ?? 0);
    const totalAmount = Math.max(roundMoney(baseAmount - feeAllocation.remainingDeductible), 0);
    const created = await client.query<SalesInvoiceRow>(
      `INSERT INTO sales_invoices (
         organization_id, subscription_id, installment_id, invoice_number, status,
         issue_date, due_date, currency, subtotal_amount, discount_amount, fee_allocation_amount,
         total_amount, paid_amount, refunded_amount, balance_due, generated_mode,
         generation_key, created_by, updated_by, created_at, updated_at
       )
       VALUES (
         $1, $2, $3, $4, 'DRAFT',
         $5, $6, $7, $8, 0, $9,
         $10, 0, 0, $10, 'AUTOMATIC',
         $11, $12, $12, NOW(), NOW()
       )
       RETURNING *`,
      [
        organizationId,
        subscriptionId,
        installmentId,
        invoiceNumber,
        asDateString(new Date().toISOString()),
        asDateString(installment.due_date),
        installment.currency,
        baseAmount,
        feeAllocation.remainingDeductible,
        totalAmount,
        `subscription:${subscriptionId}:installment:${installmentId}`,
        actorUserId,
      ],
    );
    const invoice = created.rows[0];
    await client.query(
      `INSERT INTO sales_invoice_items (
         organization_id, invoice_id, line_type, label, description, quantity, unit_price, line_amount, currency, sort_order, created_at, updated_at
       )
       VALUES ($1, $2, 'INSTALLMENT', $3, $4, 1, $5, $5, $6, 1, NOW(), NOW())`,
      [
        organizationId,
        invoice.id,
        installment.label || `Échéance ${installment.sequence_number}`,
        `Souscription ${subscription.subscription_number}`,
        baseAmount,
        installment.currency,
      ],
    );
    if (feeAllocation.remainingDeductible > 0) {
      await client.query(
        `INSERT INTO sales_invoice_items (
           organization_id, invoice_id, line_type, label, description, quantity, unit_price, line_amount, currency, sort_order, created_at, updated_at
         )
         VALUES ($1, $2, 'RESERVATION_FEE_ALLOCATION', $3, $4, 1, $5, $5, $6, 2, NOW(), NOW())`,
        [
          organizationId,
          invoice.id,
          'Déduction des frais de réservation',
          'Allocation existante non redéduite au-delà du disponible',
          -Math.abs(feeAllocation.remainingDeductible),
          installment.currency,
        ],
      );
    }
    await this.repository.writeAuditEvent(
      organizationId,
      'sales_invoice',
      invoice.id,
      'SALES_INVOICE_CREATED',
      actorUserId,
      null,
      invoice,
      client,
    );
    return this.getInvoice(invoice.id, client);
  }

  async issueInvoice(id: number) {
    return this.db.transaction(async (client) => {
      return this.issueInvoiceForAutomation(this.context.organizationId(), id, this.context.userId(), client);
    });
  }

  async issueInvoiceForAutomation(
    organizationId: number,
    id: number,
    actorUserId: number | null,
    client: PoolClient,
  ) {
    const invoice = await this.requireInvoice(organizationId, id, client);
    if (invoice.status === 'CANCELLED') {
      throw new ConflictException({ code: 'INVOICE_CANCELLED', message: 'La facture est déjà annulée.' });
    }
    const updated = await client.query<SalesInvoiceRow>(
      `UPDATE sales_invoices
       SET status = CASE
             WHEN balance_due <= 0 THEN 'PAID'
             ELSE 'ISSUED'
           END,
           issued_at = COALESCE(issued_at, NOW()),
           updated_by = $3,
           updated_at = NOW()
       WHERE organization_id = $1 AND id = $2
       RETURNING *`,
      [organizationId, id, actorUserId],
    );
    await this.repository.writeAuditEvent(organizationId, 'sales_invoice', id, 'SALES_INVOICE_ISSUED', actorUserId, invoice, updated.rows[0], client);
    await this.generateInvoiceDocument(id, client);
    return this.getInvoice(id, client);
  }

  async cancelInvoice(id: number, dto: SalesReservationStatusActionDto) {
    return this.db.transaction(async (client) => {
      const organizationId = this.context.organizationId();
      const invoice = await this.requireInvoice(organizationId, id, client);
      if (invoice.status === 'PAID' || Number(invoice.paid_amount ?? 0) > 0) {
        throw new ConflictException({ code: 'INVOICE_ALREADY_PAID', message: 'Une facture encaissée ne peut plus être annulée.' });
      }
      const updated = await client.query<SalesInvoiceRow>(
        `UPDATE sales_invoices
         SET status = 'CANCELLED',
             cancelled_at = NOW(),
             cancellation_reason = $3,
             updated_by = $4,
             updated_at = NOW()
         WHERE organization_id = $1 AND id = $2
         RETURNING *`,
        [organizationId, id, dto.reason ?? null, this.context.userId()],
      );
      await this.repository.writeAuditEvent(organizationId, 'sales_invoice', id, 'SALES_INVOICE_CANCELLED', this.context.userId(), invoice, updated.rows[0], client);
      return this.getInvoice(id, client);
    });
  }

  async listInvoicePayments(invoiceId: number) {
    const organizationId = this.context.organizationId();
    await this.requireInvoice(organizationId, invoiceId);
    return this.listPaymentsForInvoiceInternal(organizationId, invoiceId);
  }

  async createInvoicePayment(invoiceId: number, dto: CreateSalesReservationPaymentDto) {
    return this.db.transaction(async (client) => {
      const organizationId = this.context.organizationId();
      const invoice = await this.requireInvoice(organizationId, invoiceId, client);
      if (invoice.status === 'CANCELLED') {
        throw new ConflictException({ code: 'INVOICE_CANCELLED', message: 'Impossible d’encaisser une facture annulée.' });
      }
      const requestedAmount = roundMoney(Number(dto.amount));
      const remainingBalance = roundMoney(Number(invoice.balance_due ?? invoice.total_amount ?? 0));
      if (requestedAmount <= 0) {
        throw new BadRequestException('Le montant doit être strictement positif.');
      }
      const settings = await this.repository.findSettings(organizationId, client);
      const allowOverpayment = Boolean(settings?.sales_allow_invoice_overpayment);
      if (!allowOverpayment && requestedAmount > remainingBalance) {
        throw new ConflictException({ code: 'PAYMENT_EXCEEDS_BALANCE', message: 'Le paiement dépasse le solde restant.' });
      }

      const payloadHash = this.hashPayload(dto);
      if (dto.idempotency_key) {
        const existing = await client.query<SalesInvoicePaymentRow>(
          `SELECT * FROM sales_invoice_payments
           WHERE organization_id = $1 AND idempotency_key = $2
           LIMIT 1`,
          [organizationId, dto.idempotency_key],
        );
        if (existing.rows[0]) {
          if (existing.rows[0].payload_hash !== payloadHash) {
            throw new ConflictException({
              code: 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD',
              message: "La clé d'idempotence a déjà été utilisée avec un autre payload.",
            });
          }
          return this.getInvoice(invoiceId, client);
        }
      }

      const paymentNumber = await this.generateSequence(
        organizationId,
        'SALES_INVOICE_PAYMENT',
        String(settings?.sales_invoice_payment_number_format ?? 'PAI-VTE-{YYYY}-{SEQ:5}'),
        client,
      );

      let cashMovementId: number | null = null;
      let bankTransactionId: number | null = null;

      if (dto.destination_type === 'CASH') {
        const session = await this.requireOpenCashSession(organizationId, Number(dto.cash_session_id ?? 0), client);
        const cashMovement = await this.createCashMovement(client, {
          organizationId,
          sessionId: Number(session.id),
          amount: requestedAmount,
          currency: invoice.currency,
          reference: paymentNumber,
          sourceType: 'SALES_INSTALLMENT_PAYMENT',
          sourceId: 0,
          notes: dto.notes ?? `Encaissement facture ${invoice.invoice_number}`,
        });
        cashMovementId = Number(cashMovement.id);
      } else if (dto.destination_type === 'BANK') {
        const account = await this.requireBankAccount(organizationId, Number(dto.bank_account_id ?? 0), invoice.currency, client);
        const bankTransaction = await this.createBankTransaction(client, {
          organizationId,
          bankAccountId: Number(account.id),
          amount: requestedAmount,
          currency: invoice.currency,
          reference: paymentNumber,
          sourceType: 'SALES_INSTALLMENT_PAYMENT',
          sourceId: 0,
          notes: dto.notes ?? `Encaissement facture ${invoice.invoice_number}`,
        });
        bankTransactionId = Number(bankTransaction.id);
      }

      const inserted = await client.query<SalesInvoicePaymentRow>(
        `INSERT INTO sales_invoice_payments (
           organization_id, invoice_id, subscription_id, installment_id, payment_number, status,
           amount, currency, payment_date, payment_method, destination_type, cash_session_id, bank_account_id,
           cash_movement_id, bank_transaction_id, external_reference, notes, idempotency_key, payload_hash,
           created_by, updated_by, created_at, updated_at
         )
         VALUES (
           $1, $2, $3, $4, $5, 'CONFIRMED',
           $6, $7, $8, $9, $10, $11, $12,
           $13, $14, $15, $16, $17, $18,
           $19, $19, NOW(), NOW()
         )
         RETURNING *`,
        [
          organizationId,
          invoice.id,
          invoice.subscription_id,
          invoice.installment_id,
          paymentNumber,
          requestedAmount,
          invoice.currency,
          asDateString(dto.payment_date),
          dto.payment_method,
          dto.destination_type,
          dto.cash_session_id ?? null,
          dto.bank_account_id ?? null,
          cashMovementId,
          bankTransactionId,
          dto.external_reference ?? null,
          dto.notes ?? null,
          dto.idempotency_key ?? null,
          payloadHash,
          this.context.userId(),
        ],
      );
      const payment = inserted.rows[0];
      await this.refreshInvoiceAggregates(organizationId, invoice.id, client);
      await this.repository.writeAuditEvent(organizationId, 'sales_invoice_payment', payment.id, 'SALES_PAYMENT_CREATED', this.context.userId(), null, payment, client);
      await this.generatePaymentReceipt(payment.id, client);
      return this.getInvoice(invoiceId, client);
    });
  }

  async cancelInvoicePayment(paymentId: number, dto: CancelSalesReservationPaymentDto) {
    return this.db.transaction(async (client) => {
      const organizationId = this.context.organizationId();
      const payment = await this.requireInvoicePayment(organizationId, paymentId, client);
      const reasonCode = await this.resolvePaymentCancellationBlock(payment, client);
      if (reasonCode) {
        throw new ConflictException({ code: reasonCode, message: this.messageForCancellationCode(reasonCode) });
      }

      if (payment.destination_type === 'CASH' && payment.cash_movement_id) {
        await this.createCashMovement(client, {
          organizationId,
          sessionId: Number(payment.cash_session_id),
          amount: Number(payment.amount),
          currency: payment.currency,
          reference: `${payment.payment_number}-ANN`,
          sourceType: 'SALES_INSTALLMENT_PAYMENT_REVERSAL',
          sourceId: payment.id,
          notes: dto.reason,
          direction: 'OUT',
        });
      }
      if (payment.destination_type === 'BANK' && payment.bank_transaction_id) {
        await this.createBankTransaction(client, {
          organizationId,
          bankAccountId: Number(payment.bank_account_id),
          amount: Number(payment.amount),
          currency: payment.currency,
          reference: `${payment.payment_number}-ANN`,
          sourceType: 'SALES_INSTALLMENT_PAYMENT_REVERSAL',
          sourceId: payment.id,
          notes: dto.reason,
          direction: 'OUT',
        });
      }

      const updated = await client.query<SalesInvoicePaymentRow>(
        `UPDATE sales_invoice_payments
         SET status = 'CANCELLED',
             cancelled_at = NOW(),
             cancellation_reason = $3,
             updated_by = $4,
             updated_at = NOW()
         WHERE organization_id = $1 AND id = $2
         RETURNING *`,
        [organizationId, paymentId, dto.reason, this.context.userId()],
      );
      await this.refreshInvoiceAggregates(organizationId, Number(payment.invoice_id), client);
      await this.repository.writeAuditEvent(organizationId, 'sales_invoice_payment', paymentId, 'SALES_PAYMENT_CANCELLED', this.context.userId(), payment, updated.rows[0], client);
      return this.getInvoice(Number(payment.invoice_id), client);
    });
  }

  async refundInvoicePayment(paymentId: number, dto: CreateSalesReservationRefundDto) {
    return this.db.transaction(async (client) => {
      const organizationId = this.context.organizationId();
      const payment = await this.requireInvoicePayment(organizationId, paymentId, client);
      const refundableAmount = await this.computeRefundableAmount(organizationId, paymentId, client);
      const requestedAmount = roundMoney(Number(dto.amount));
      if (requestedAmount > refundableAmount) {
        throw new ConflictException({ code: 'PAYMENT_ALREADY_REFUNDED', message: 'Le montant dépasse le solde remboursable.' });
      }
      const settings = await this.repository.findSettings(organizationId, client);
      const refundNumber = await this.generateSequence(
        organizationId,
        'SALES_INVOICE_REFUND',
        String(settings?.sales_invoice_refund_number_format ?? 'REM-VTE-{YYYY}-{SEQ:5}'),
        client,
      );
      let cashMovementId: number | null = null;
      let bankTransactionId: number | null = null;

      if (dto.destination_type === 'CASH') {
        const session = await this.requireOpenCashSession(organizationId, Number(dto.cash_session_id ?? 0), client);
        const movement = await this.createCashMovement(client, {
          organizationId,
          sessionId: Number(session.id),
          amount: requestedAmount,
          currency: payment.currency,
          reference: refundNumber,
          sourceType: 'SALES_INSTALLMENT_REFUND',
          sourceId: payment.id,
          notes: dto.reason,
          direction: 'OUT',
        });
        cashMovementId = Number(movement.id);
      } else if (dto.destination_type === 'BANK') {
        const account = await this.requireBankAccount(organizationId, Number(dto.bank_account_id ?? 0), payment.currency, client);
        const transaction = await this.createBankTransaction(client, {
          organizationId,
          bankAccountId: Number(account.id),
          amount: requestedAmount,
          currency: payment.currency,
          reference: refundNumber,
          sourceType: 'SALES_INSTALLMENT_REFUND',
          sourceId: payment.id,
          notes: dto.reason,
          direction: 'OUT',
        });
        bankTransactionId = Number(transaction.id);
      }

      await client.query(
        `INSERT INTO sales_invoice_payment_refunds (
           organization_id, payment_id, refund_number, status, amount, currency, refund_date, refund_method, destination_type,
           cash_session_id, bank_account_id, cash_movement_id, bank_transaction_id, external_reference, reason, notes,
           idempotency_key, payload_hash, created_by, updated_by, created_at, updated_at
         )
         VALUES (
           $1, $2, $3, 'CONFIRMED', $4, $5, $6, $7, $8,
           $9, $10, $11, $12, $13, $14, $15,
           $16, $17, $18, $18, NOW(), NOW()
         )`,
        [
          organizationId,
          paymentId,
          refundNumber,
          requestedAmount,
          payment.currency,
          asDateString(dto.refund_date),
          dto.refund_method,
          dto.destination_type,
          dto.cash_session_id ?? null,
          dto.bank_account_id ?? null,
          cashMovementId,
          bankTransactionId,
          dto.external_reference ?? null,
          dto.reason,
          dto.notes ?? null,
          dto.idempotency_key ?? null,
          this.hashPayload(dto),
          this.context.userId(),
        ],
      );
      await this.refreshInvoiceAggregates(organizationId, Number(payment.invoice_id), client);
      await this.repository.writeAuditEvent(organizationId, 'sales_invoice_payment', paymentId, 'SALES_PAYMENT_REFUNDED', this.context.userId(), null, { amount: requestedAmount, reason: dto.reason }, client);
      return this.getInvoice(Number(payment.invoice_id), client);
    });
  }

  async downloadInvoiceDocument(documentId: number) {
    const organizationId = this.context.organizationId();
    const { rows } = await this.db.query<any>(
      `SELECT *
       FROM sales_document_generations
       WHERE organization_id = $1 AND id = $2`,
      [organizationId, documentId],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException('Document introuvable.');
    return {
      mimeType: row.mime_type || 'application/pdf',
      fileName: row.file_name || `${row.document_number}.pdf`,
      buffer: Buffer.from(String(row.pdf_base64 || ''), 'base64'),
    };
  }

  async regenerateInvoiceDocument(invoiceId: number) {
    return this.db.transaction(async (client) => {
      await this.requireInvoice(this.context.organizationId(), invoiceId, client);
      await this.generateInvoiceDocument(invoiceId, client);
      return this.getInvoice(invoiceId, client);
    });
  }

  async regeneratePaymentReceipt(paymentId: number) {
    return this.db.transaction(async (client) => {
      const payment = await this.requireInvoicePayment(this.context.organizationId(), paymentId, client);
      await this.generatePaymentReceipt(paymentId, client);
      return this.getInvoice(Number(payment.invoice_id), client);
    });
  }

  async sendInvoice(invoiceId: number) {
    return this.db.transaction(async (client) => {
      return this.sendInvoiceForAutomation(this.context.organizationId(), invoiceId, this.context.userId(), client);
    });
  }

  async sendInvoiceForAutomation(
    organizationId: number,
    invoiceId: number,
    actorUserId: number | null,
    client: PoolClient,
  ) {
    const invoice = await this.requireInvoice(organizationId, invoiceId, client);
    const delivery = await this.sendSalesInvoiceEmail(
      organizationId,
      invoiceId,
      actorUserId,
      client,
      {
        subject: `Votre facture ${invoice.invoice_number}`,
        message: `Bonjour,\n\nVotre facture ${invoice.invoice_number} est disponible en pièce jointe.\nMerci de procéder au règlement avant l'échéance prévue.`,
        idempotencyKey: `${organizationId}:EMAIL:SALES_INVOICE:${invoiceId}:AUTO`,
      },
    );
    const updated = await client.query(
      `UPDATE sales_invoices
       SET send_status = $4,
           sent_at = CASE WHEN $4 IN ('SENT', 'SKIPPED') THEN NOW() ELSE sent_at END,
           updated_by = $3,
           updated_at = NOW()
       WHERE organization_id = $1 AND id = $2
       RETURNING *`,
      [organizationId, invoiceId, actorUserId, delivery.deliveryMode === 'DISABLED' ? 'SKIPPED' : 'SENT'],
    );
    await this.repository.writeAuditEvent(organizationId, 'sales_invoice', invoiceId, 'SALES_INVOICE_SENT', actorUserId, invoice, updated.rows[0], client);
    return this.getInvoice(invoiceId, client);
  }

  async sendInvoiceReminderForAutomation(
    organizationId: number,
    invoiceId: number,
    actorUserId: number | null,
    client: PoolClient,
    args: {
      reminderType: string;
      reminderStage: string;
      idempotencyKey: string;
    },
  ) {
    const invoice = await this.requireInvoice(organizationId, invoiceId, client);
    return this.sendSalesInvoiceEmail(
      organizationId,
      invoiceId,
      actorUserId,
      client,
      {
        subject: this.buildReminderSubject(invoice.invoice_number, args.reminderType),
        message: this.buildReminderMessage(invoice.invoice_number, Number(invoice.balance_due ?? 0), invoice.currency, invoice.due_date, args.reminderType),
        idempotencyKey: args.idempotencyKey,
      },
    );
  }

  async listOutstandingInvoices() {
    const organizationId = this.context.organizationId();
    const { rows } = await this.db.query(
      `SELECT *
       FROM sales_invoices
       WHERE organization_id = $1
         AND status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE')
       ORDER BY due_date ASC, id DESC`,
      [organizationId],
    );
    return rows;
  }

  async listOverdueInvoices() {
    const organizationId = this.context.organizationId();
    const { rows } = await this.db.query(
      `SELECT *
       FROM sales_invoices
       WHERE organization_id = $1
         AND status = 'OVERDUE'
       ORDER BY due_date ASC, id DESC`,
      [organizationId],
    );
    return rows;
  }

  private async findInvoice(organizationId: number, id: number, client?: PoolClient) {
    const runner = client ?? this.db;
    const result = await (runner as any).query(
      `SELECT
         si.*,
         ss.subscription_number,
         sb.full_name AS buyer_name,
         sb.email AS buyer_email,
         sc.title AS catalog_title,
         sp.name AS project_name,
         ssi.label AS installment_label,
         ssi.sequence_number AS installment_sequence_number
       FROM sales_invoices si
       JOIN sales_subscriptions ss ON ss.id = si.subscription_id
       JOIN sales_buyers sb ON sb.id = ss.buyer_id
       JOIN sales_property_catalog sc ON sc.id = ss.catalog_item_id AND sc.organization_id = ss.organization_id
       LEFT JOIN sales_projects sp ON sp.id = ss.project_id
       LEFT JOIN sales_subscription_installments ssi ON ssi.id = si.installment_id
       WHERE si.organization_id = $1 AND si.id = $2`,
      [organizationId, id],
    );
    return result.rows[0] ? this.normalizeInvoice(result.rows[0]) : null;
  }

  private async requireInvoice(organizationId: number, id: number, client?: PoolClient) {
    const invoice = await this.findInvoice(organizationId, id, client);
    if (!invoice) throw new NotFoundException('Facture introuvable.');
    return invoice;
  }

  private async requireSubscriptionFinancialContext(organizationId: number, subscriptionId: number, client?: PoolClient) {
    const subscription = await this.repository.findSubscription(organizationId, subscriptionId, client);
    if (!subscription) throw new NotFoundException('Souscription introuvable.');
    if (!['APPROVED', 'CONVERTED'].includes(String(subscription.status))) {
      throw new ConflictException('Seules les souscriptions approuvées peuvent être facturées.');
    }
    return subscription;
  }

  private async requireInstallment(organizationId: number, subscriptionId: number, installmentId: number, client?: PoolClient) {
    const runner = client ?? this.db;
    const result = await (runner as any).query(
      `SELECT *
       FROM sales_subscription_installments
       WHERE organization_id = $1 AND subscription_id = $2 AND id = $3`,
      [organizationId, subscriptionId, installmentId],
    );
    if (!result.rows[0]) throw new NotFoundException('Échéance introuvable.');
    return result.rows[0];
  }

  private async findActiveInvoiceByInstallment(organizationId: number, subscriptionId: number, installmentId: number, client?: PoolClient) {
    const runner = client ?? this.db;
    const result = await (runner as any).query(
      `SELECT *
       FROM sales_invoices
       WHERE organization_id = $1
         AND subscription_id = $2
         AND installment_id = $3
         AND status <> 'CANCELLED'
       ORDER BY id DESC
       LIMIT 1`,
      [organizationId, subscriptionId, installmentId],
    );
    return result.rows[0] ?? null;
  }

  private async sendSalesInvoiceEmail(
    organizationId: number,
    invoiceId: number,
    actorUserId: number | null,
    client: PoolClient,
    args: {
      subject: string;
      message: string;
      idempotencyKey: string;
    },
  ) {
    const invoice = await this.requireInvoice(organizationId, invoiceId, client);
    const document = await this.buildSalesInvoiceEmailDocument(organizationId, invoiceId, invoice, args.message, client);
    return this.context.run({
      user: {
        sub: actorUserId ?? 0,
        email: 'sales-automation@test.local',
        role: 'SYSTEM',
        organization_id: organizationId,
        permissions: [],
        active_modules: ['SALES'],
      },
    }, () => this.emailService.sendDocumentEmail({
      to: invoice.buyer_email ?? undefined,
      subject: args.subject,
      message: args.message,
      document,
      documentType: DocumentType.INVOICE,
      documentId: Number(document.documentId),
      trigger: DocumentDeliveryTrigger.AUTO,
      idempotencyKey: args.idempotencyKey,
    }));
  }

  private async buildSalesInvoiceEmailDocument(
    organizationId: number,
    invoiceId: number,
    invoice: any,
    message: string,
    client: PoolClient,
  ) {
    let currentInvoice = invoice;
    if (!currentInvoice.pdf_document_id) {
      await this.generateInvoiceDocument(invoiceId, client);
      currentInvoice = await this.requireInvoice(organizationId, invoiceId, client);
    }
    const generationId = Number(currentInvoice.pdf_document_id ?? 0);
    if (!generationId) {
      throw new BadRequestException('Le PDF de la facture est indisponible.');
    }
    const { rows } = await client.query<{
      id: number;
      document_number: string | null;
      file_name: string | null;
      mime_type: string | null;
      pdf_base64: string | null;
    }>(
      `SELECT id, document_number, file_name, mime_type, pdf_base64
       FROM sales_document_generations
       WHERE organization_id = $1 AND id = $2
       LIMIT 1`,
      [organizationId, generationId],
    );
    const generation = rows[0];
    if (!generation?.pdf_base64) {
      throw new BadRequestException('Le PDF de la facture est indisponible.');
    }
    return {
      documentType: DocumentType.INVOICE,
      documentId: generation.id,
      recipientFallback: currentInvoice.buyer_email ?? null,
      subjectFallback: `Facture ${currentInvoice.invoice_number}`,
      attachmentFileName: generation.file_name || `${generation.document_number || currentInvoice.invoice_number}.pdf`,
      templateName: 'invoice.html',
      templateVariables: {
        recipient_name: currentInvoice.buyer_name || 'client',
        message_body: message.replace(/\n/g, '<br />'),
        reference: currentInvoice.invoice_number,
        amount: this.formatMoney(currentInvoice.total_amount, currentInvoice.currency),
        due_date: this.formatDate(currentInvoice.due_date),
      },
      pdfBuffer: Buffer.from(String(generation.pdf_base64), 'base64'),
    };
  }

  private buildReminderSubject(invoiceNumber: string, reminderType: string) {
    const labels: Record<string, string> = {
      UPCOMING_DUE: 'Rappel avant échéance',
      DUE_TODAY: "Échéance aujourd'hui",
      OVERDUE: 'Facture en retard',
      FINAL_NOTICE: 'Dernière relance',
    };
    return `${labels[reminderType] ?? 'Relance de facture'} - ${invoiceNumber}`;
  }

  private buildReminderMessage(
    invoiceNumber: string,
    balanceDue: number,
    currency: string,
    dueDate: string | Date | null | undefined,
    reminderType: string,
  ) {
    const introMap: Record<string, string> = {
      UPCOMING_DUE: `La facture ${invoiceNumber} arrive prochainement à échéance.`,
      DUE_TODAY: `La facture ${invoiceNumber} arrive à échéance aujourd'hui.`,
      OVERDUE: `La facture ${invoiceNumber} est échue et reste impayée.`,
      FINAL_NOTICE: `La facture ${invoiceNumber} reste impayée malgré nos précédentes relances.`,
    };
    return [
      'Bonjour,',
      '',
      introMap[reminderType] ?? `La facture ${invoiceNumber} nécessite votre attention.`,
      `Solde restant : ${this.formatMoney(balanceDue, currency)}.`,
      `Échéance : ${this.formatDate(dueDate)}.`,
      '',
      'Merci de régulariser la situation dans les meilleurs délais.',
    ].join('\n');
  }

  private normalizeInvoice(row: SalesInvoiceRow) {
    const balanceDue = roundMoney(Number(row.balance_due ?? row.total_amount ?? 0));
    const paidAmount = roundMoney(Number(row.paid_amount ?? 0));
    const refundedAmount = roundMoney(Number(row.refunded_amount ?? 0));
    const dueDate = row.due_date ? new Date(row.due_date) : null;
    const now = new Date();
    let status = row.status;
    if (status !== 'CANCELLED') {
      if (balanceDue <= 0) status = 'PAID';
      else if (paidAmount > 0) status = 'PARTIALLY_PAID';
      else if (dueDate && dueDate < now && balanceDue > 0) status = 'OVERDUE';
    }
    return {
      ...row,
      status,
      paid_amount: paidAmount,
      refunded_amount: refundedAmount,
      balance_due: balanceDue,
    };
  }

  private formatMoney(value: number | string | null | undefined, currency: string | null | undefined) {
    const amount = roundMoney(Number(value ?? 0));
    const normalizedCurrency = String(currency ?? '').trim() || 'USD';
    return new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount) + ` ${normalizedCurrency}`;
  }

  private formatDate(value: string | Date | null | undefined) {
    if (!value) return 'Non définie';
    const date = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(date.getTime())) return 'Non définie';
    return new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Africa/Kinshasa',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);
  }

  private async listPaymentsForInvoiceInternal(organizationId: number, invoiceId: number, client?: PoolClient) {
    const runner = client ?? this.db;
    const payments = (await (runner as any).query(
      `SELECT p.*,
         COALESCE((
           SELECT SUM(r.amount)
           FROM sales_invoice_payment_refunds r
           WHERE r.organization_id = p.organization_id
             AND r.payment_id = p.id
             AND r.status = 'CONFIRMED'
         ), 0) AS refunded_amount
       FROM sales_invoice_payments p
       WHERE p.organization_id = $1 AND p.invoice_id = $2
       ORDER BY p.payment_date DESC, p.id DESC`,
      [organizationId, invoiceId],
    )) as { rows: Array<SalesInvoicePaymentRow & { refunded_amount?: number | string | null }> };
    return payments.rows.map((row: SalesInvoicePaymentRow & { refunded_amount?: number | string | null }) => ({
      ...row,
      refunded_amount: roundMoney(Number(row.refunded_amount ?? 0)),
      available_refundable_amount: roundMoney(Number(row.amount ?? 0) - Number(row.refunded_amount ?? 0)),
    }));
  }

  private async requireInvoicePayment(organizationId: number, paymentId: number, client?: PoolClient) {
    const runner = client ?? this.db;
    const result = await (runner as any).query(
      `SELECT p.*,
         COALESCE((
           SELECT SUM(r.amount)
           FROM sales_invoice_payment_refunds r
           WHERE r.organization_id = p.organization_id
             AND r.payment_id = p.id
             AND r.status = 'CONFIRMED'
         ), 0) AS refunded_amount
       FROM sales_invoice_payments p
       WHERE p.organization_id = $1 AND p.id = $2`,
      [organizationId, paymentId],
    );
    if (!result.rows[0]) throw new NotFoundException('Paiement introuvable.');
    return result.rows[0];
  }

  private async computeRefundableAmount(organizationId: number, paymentId: number, client?: PoolClient) {
    const payment = await this.requireInvoicePayment(organizationId, paymentId, client);
    return Math.max(roundMoney(Number(payment.amount ?? 0) - Number(payment.refunded_amount ?? 0)), 0);
  }

  private async resolvePaymentCancellationBlock(payment: SalesInvoicePaymentRow, client: PoolClient) {
    if (payment.status === 'CANCELLED') return 'PAYMENT_ALREADY_CANCELLED';
    const refundedAmount = Number(payment.refunded_amount ?? 0);
    if (refundedAmount > 0) {
      return refundedAmount >= Number(payment.amount ?? 0) ? 'PAYMENT_ALREADY_REFUNDED' : 'PAYMENT_PARTIALLY_REFUNDED';
    }
    if (payment.destination_type === 'CASH' && payment.cash_session_id) {
      const session = await client.query<{ status: string }>(
        `SELECT status FROM cash_sessions WHERE organization_id = $1 AND id = $2`,
        [payment.organization_id, payment.cash_session_id],
      );
      if (session.rows[0] && String(session.rows[0].status).toUpperCase() !== 'OPEN') {
        return 'CASH_SESSION_CLOSED';
      }
    }
    if (payment.destination_type === 'BANK' && payment.bank_transaction_id) {
      const tx = await client.query<{ is_reconciled?: boolean | null; locked_at?: string | null }>(
        `SELECT is_reconciled, locked_at
         FROM bank_transactions
         WHERE organization_id = $1 AND id = $2`,
        [payment.organization_id, payment.bank_transaction_id],
      );
      if (tx.rows[0]?.is_reconciled || tx.rows[0]?.locked_at) {
        return 'BANK_TRANSACTION_RECONCILED';
      }
    }
    return null;
  }

  private messageForCancellationCode(code: string) {
    const messages: Record<string, string> = {
      PAYMENT_ALREADY_CANCELLED: 'Ce paiement est déjà annulé.',
      PAYMENT_ALREADY_REFUNDED: 'Ce paiement a déjà été remboursé.',
      PAYMENT_PARTIALLY_REFUNDED: 'Ce paiement a déjà été partiellement remboursé.',
      CASH_SESSION_CLOSED: 'La session de caisse est clôturée.',
      BANK_TRANSACTION_RECONCILED: 'La transaction bancaire est rapprochée ou verrouillée.',
      PAYMENT_NOT_CANCELLABLE: 'Ce paiement ne peut plus être annulé.',
    };
    return messages[code] ?? 'Ce paiement ne peut plus être annulé.';
  }

  private async refreshInvoiceAggregates(organizationId: number, invoiceId: number, client: PoolClient) {
    const paymentTotals = await client.query<{ paid: string; refunded: string }>(
      `SELECT
         COALESCE(SUM(CASE WHEN p.status <> 'CANCELLED' THEN p.amount ELSE 0 END), 0)::text AS paid,
         COALESCE((
           SELECT SUM(r.amount)
           FROM sales_invoice_payment_refunds r
           WHERE r.organization_id = $1
             AND r.payment_id IN (
               SELECT id
               FROM sales_invoice_payments
               WHERE organization_id = $1 AND invoice_id = $2
             )
             AND r.status = 'CONFIRMED'
         ), 0)::text AS refunded
       FROM sales_invoice_payments p
       WHERE p.organization_id = $1 AND p.invoice_id = $2`,
      [organizationId, invoiceId],
    );
    const paid = roundMoney(Number(paymentTotals.rows[0]?.paid ?? 0));
    const refunded = roundMoney(Number(paymentTotals.rows[0]?.refunded ?? 0));
    const invoice = await this.requireInvoice(organizationId, invoiceId, client);
    const netPaid = roundMoney(paid - refunded);
    const balanceDue = Math.max(roundMoney(Number(invoice.total_amount ?? 0) - netPaid), 0);
    let status: InvoiceStatus = 'ISSUED';
    if (balanceDue <= 0) status = 'PAID';
    else if (netPaid > 0) status = 'PARTIALLY_PAID';
    else if (invoice.due_date && new Date(invoice.due_date) < new Date()) status = 'OVERDUE';
    await client.query(
      `UPDATE sales_invoices
       SET paid_amount = $3,
           refunded_amount = $4,
           balance_due = $5,
           status = CASE WHEN status = 'CANCELLED' THEN status ELSE $6 END,
           updated_by = $7,
           updated_at = NOW()
       WHERE organization_id = $1 AND id = $2`,
      [organizationId, invoiceId, paid, refunded, balanceDue, status, this.context.userId()],
    );
  }

  private async resolveDeductibleAllocation(organizationId: number, subscriptionId: number, client: PoolClient) {
    const subscription = await this.repository.findSubscription(organizationId, subscriptionId, client);
    if (!subscription?.reservation_id) {
      return { remainingDeductible: 0 };
    }
    const summary = await this.repository.getReservationFeeSummary(organizationId, subscription.reservation_id, client);
    const reservation = await this.repository.findReservation(organizationId, subscription.reservation_id, client);
    const deductibility = String(summary?.deductibility ?? reservation?.deductibility ?? 'NON_DEDUCTIBLE');
    const available = Number(summary?.fee_available ?? 0);
    if (deductibility === 'NON_DEDUCTIBLE' || available <= 0) {
      return { remainingDeductible: 0 };
    }
    if (deductibility === 'PARTIALLY_DEDUCTIBLE') {
      const percentage = Number(summary?.deductible_percentage ?? reservation?.deductible_percentage ?? 0);
      return { remainingDeductible: roundMoney((available * percentage) / 100) };
    }
    return { remainingDeductible: roundMoney(available) };
  }

  private async generateSequence(organizationId: number, documentType: string, format: string, client: PoolClient) {
    const year = new Date().getFullYear();
    const sequence = await this.repository.nextSequenceValue(organizationId, documentType, year, client);
    return this.repository.formatSequence(format, sequence, year);
  }

  private hashPayload(payload: unknown) {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  private async requireOpenCashSession(organizationId: number, sessionId: number, client: PoolClient) {
    if (!sessionId) throw new BadRequestException('Une session de caisse ouverte est obligatoire.');
    const { rows } = await client.query<any>(
      `SELECT *
       FROM cash_sessions
       WHERE organization_id = $1 AND id = $2`,
      [organizationId, sessionId],
    );
    if (!rows[0]) throw new NotFoundException('Session de caisse introuvable.');
    if (String(rows[0].status).toUpperCase() !== 'OPEN') {
      throw new ConflictException({ code: 'CASH_SESSION_CLOSED', message: 'La session de caisse est clôturée.' });
    }
    return rows[0];
  }

  private async requireBankAccount(organizationId: number, bankAccountId: number, currency: string, client: PoolClient) {
    if (!bankAccountId) throw new BadRequestException('Un compte bancaire est obligatoire.');
    const { rows } = await client.query<any>(
      `SELECT *
       FROM bank_accounts
       WHERE organization_id = $1 AND id = $2`,
      [organizationId, bankAccountId],
    );
    if (!rows[0]) throw new NotFoundException('Compte bancaire introuvable.');
    if (String(rows[0].currency ?? '').toUpperCase() !== String(currency).toUpperCase()) {
      throw new ConflictException({ code: 'CURRENCY_MISMATCH', message: 'La devise du compte bancaire est incompatible.' });
    }
    return rows[0];
  }

  private async createCashMovement(
    client: PoolClient,
    payload: {
      organizationId: number;
      sessionId: number;
      amount: number;
      currency: string;
      reference: string;
      sourceType: string;
      sourceId: number;
      notes: string;
      direction?: 'IN' | 'OUT';
    },
  ) {
    const { rows } = await client.query<any>(
      `INSERT INTO cash_movements (
         cash_session_id, type, category, amount, movement_date, description, reference, currency,
         equivalent_usd, created_by, organization_id, created_at
       )
       VALUES (
         $1, $2, $3, $4, CURRENT_DATE, $5, $6, $7,
         $8, $9, $10, NOW()
       )
       RETURNING *`,
      [
        payload.sessionId,
        payload.direction === 'OUT' ? 'OUT' : 'IN',
        payload.direction === 'OUT' ? 'INVOICE_REFUND' : 'INVOICE_PAYMENT',
        payload.amount,
        payload.notes,
        payload.reference,
        payload.currency,
        payload.amount,
        this.context.userId(),
        payload.organizationId,
      ],
    );
    return rows[0];
  }

  private async createBankTransaction(
    client: PoolClient,
    payload: {
      organizationId: number;
      bankAccountId: number;
      amount: number;
      currency: string;
      reference: string;
      sourceType: string;
      sourceId: number;
      notes: string;
      direction?: 'IN' | 'OUT';
    },
  ) {
    const { rows } = await client.query<any>(
      `INSERT INTO bank_transactions (
         organization_id, bank_account_id, transaction_number, transaction_date, direction, transaction_type, amount, currency,
         reference, description, source_module, source_entity_type, source_entity_id, status, reversal_of_id, idempotency_key, created_by, created_at
       )
       VALUES (
         $1, $2, $3, CURRENT_DATE, $4, 'MANUAL_ADJUSTMENT', $5, $6,
         $7, $8, 'SALES', $9, $10, 'VALIDATED', NULL, NULL, $11, NOW()
       )
       RETURNING *`,
      [
        payload.organizationId,
        payload.bankAccountId,
        `SV32-${payload.reference}`,
        payload.direction === 'OUT' ? 'OUT' : 'IN',
        payload.amount,
        payload.currency,
        payload.reference,
        payload.notes,
        payload.sourceType,
        payload.sourceId,
        this.context.userId(),
      ],
    );
    return rows[0];
  }

  private async generateInvoiceDocument(invoiceId: number, client: PoolClient) {
    const organizationId = this.context.organizationId();
    const invoice = await this.requireInvoice(organizationId, invoiceId, client);
    const existingDocuments = await this.repository.listDocumentGenerations(organizationId, 'SALES_INVOICE', invoiceId, client);
    const documentVersion = existingDocuments.length + 1;
    const documentNumber = documentVersion === 1
      ? `${invoice.invoice_number}-PDF`
      : `${invoice.invoice_number}-PDF-V${documentVersion}`;
    const generation = await this.repository.createDocumentGeneration(
      organizationId,
      {
        entity_type: 'SALES_INVOICE',
        entity_id: invoiceId,
        template_type: 'SALES_INVOICE',
        template_id: null,
        version: documentVersion,
        document_number: documentNumber,
        file_name: `${documentNumber}.pdf`,
        variables_snapshot: invoice,
        generated_by: this.context.userId(),
      },
      client,
    );
    const html = this.renderInvoiceHtml(invoice);
    const buffer = await this.pdfRenderer.renderA4Pdf(html);
    const document = await this.repository.markDocumentGenerationSuccess(organizationId, generation.id, {
      pdf_base64: buffer.toString('base64'),
      mime_type: 'application/pdf',
      generated_by: this.context.userId(),
    }, client);
    await client.query(
      `UPDATE sales_invoices
       SET pdf_document_id = $3,
           updated_by = $4,
           updated_at = NOW()
       WHERE organization_id = $1 AND id = $2`,
      [organizationId, invoiceId, document.id, this.context.userId()],
    );
    await this.repository.writeAuditEvent(organizationId, 'sales_invoice', invoiceId, 'SALES_INVOICE_PDF_GENERATED', this.context.userId(), null, { document_generation_id: generation.id }, client);
  }

  private async generatePaymentReceipt(paymentId: number, client: PoolClient) {
    const organizationId = this.context.organizationId();
    const payment = await this.requireInvoicePayment(organizationId, paymentId, client);
    const invoice = await this.requireInvoice(organizationId, Number(payment.invoice_id), client);
    const settings = await this.repository.findSettings(organizationId, client);
    const receiptNumber = await this.generateSequence(
      organizationId,
      'SALES_INVOICE_RECEIPT',
      String(settings?.sales_invoice_receipt_number_format ?? 'REC-VTE-{YYYY}-{SEQ:5}'),
      client,
    );
    const generation = await this.repository.createDocumentGeneration(
      organizationId,
      {
        entity_type: 'SALES_INVOICE_PAYMENT',
        entity_id: paymentId,
        template_type: 'SALES_INVOICE_RECEIPT',
        template_id: null,
        version: 1,
        document_number: receiptNumber,
        file_name: `${receiptNumber}.pdf`,
        variables_snapshot: { invoice, payment },
        generated_by: this.context.userId(),
      },
      client,
    );
    const html = this.renderReceiptHtml(invoice, payment, receiptNumber);
    const buffer = await this.pdfRenderer.renderA4Pdf(html);
    const document = await this.repository.markDocumentGenerationSuccess(organizationId, generation.id, {
      pdf_base64: buffer.toString('base64'),
      mime_type: 'application/pdf',
      generated_by: this.context.userId(),
    }, client);
    await client.query(
      `UPDATE sales_invoice_payments
       SET receipt_document_id = $3,
           updated_by = $4,
           updated_at = NOW()
       WHERE organization_id = $1 AND id = $2`,
      [organizationId, paymentId, document.id, this.context.userId()],
    );
    await this.repository.writeAuditEvent(organizationId, 'sales_invoice_payment', paymentId, 'SALES_PAYMENT_RECEIPT_GENERATED', this.context.userId(), null, { document_generation_id: generation.id }, client);
  }

  private renderInvoiceHtml(invoice: SalesInvoiceRow) {
    return `<!DOCTYPE html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <style>
      body { font-family: Arial, sans-serif; color: #102542; margin: 32px; }
      h1 { margin: 0 0 12px; font-size: 26px; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
      .card { border: 1px solid #d7e0ea; border-radius: 12px; padding: 14px; }
      table { width: 100%; border-collapse: collapse; margin-top: 18px; }
      th, td { border-bottom: 1px solid #e3e9f0; padding: 10px 8px; text-align: left; }
      .totals { margin-top: 24px; }
      .muted { color: #5b708b; }
    </style>
  </head>
  <body>
    <h1>Facture ${escapeHtml(invoice.invoice_number)}</h1>
    <div class="grid">
      <div class="card">
        <strong>Organisation</strong>
        <p class="muted">Organisation commerciale</p>
        <p>${escapeHtml(invoice.project_name ?? '')}</p>
      </div>
      <div class="card">
        <strong>Client</strong>
        <p>${escapeHtml(invoice.buyer_name ?? 'Acquéreur')}</p>
        <p class="muted">Souscription ${escapeHtml(invoice.subscription_number ?? '')}</p>
      </div>
    </div>
    <table>
      <thead>
        <tr>
          <th>Échéance</th>
          <th>Bien</th>
          <th>Émission</th>
          <th>Exigible</th>
          <th>Montant</th>
          <th>Payé</th>
          <th>Solde</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${escapeHtml(invoice.installment_label ?? `Échéance ${invoice.installment_sequence_number ?? ''}`)}</td>
          <td>${escapeHtml(invoice.catalog_title ?? '')}</td>
          <td>${escapeHtml(invoice.issue_date)}</td>
          <td>${escapeHtml(invoice.due_date)}</td>
          <td>${escapeHtml(formatMoney(Number(invoice.total_amount ?? 0), invoice.currency))}</td>
          <td>${escapeHtml(formatMoney(Number(invoice.paid_amount ?? 0), invoice.currency))}</td>
          <td>${escapeHtml(formatMoney(Number(invoice.balance_due ?? 0), invoice.currency))}</td>
        </tr>
      </tbody>
    </table>
    <div class="totals">
      <p><strong>Statut :</strong> ${escapeHtml(invoice.status)}</p>
      <p><strong>Déjà payé :</strong> ${escapeHtml(formatMoney(Number(invoice.paid_amount ?? 0), invoice.currency))}</p>
      <p><strong>Solde restant :</strong> ${escapeHtml(formatMoney(Number(invoice.balance_due ?? 0), invoice.currency))}</p>
    </div>
  </body>
</html>`;
  }

  private renderReceiptHtml(invoice: SalesInvoiceRow, payment: SalesInvoicePaymentRow, receiptNumber: string) {
    return `<!DOCTYPE html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <style>
      body { font-family: Arial, sans-serif; color: #102542; margin: 32px; }
      h1 { margin: 0 0 12px; font-size: 24px; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
      .card { border: 1px solid #d7e0ea; border-radius: 12px; padding: 14px; }
      .signature { margin-top: 48px; display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
      .signature div { border-top: 1px solid #bcc8d4; padding-top: 12px; }
    </style>
  </head>
  <body>
    <h1>Reçu ${escapeHtml(receiptNumber)}</h1>
    <div class="grid">
      <div class="card">
        <p><strong>Facture :</strong> ${escapeHtml(invoice.invoice_number)}</p>
        <p><strong>Paiement :</strong> ${escapeHtml(payment.payment_number)}</p>
        <p><strong>Acquéreur :</strong> ${escapeHtml(invoice.buyer_name ?? '')}</p>
        <p><strong>Souscription :</strong> ${escapeHtml(invoice.subscription_number ?? '')}</p>
      </div>
      <div class="card">
        <p><strong>Montant :</strong> ${escapeHtml(formatMoney(Number(payment.amount ?? 0), payment.currency))}</p>
        <p><strong>Date :</strong> ${escapeHtml(payment.payment_date)}</p>
        <p><strong>Mode :</strong> ${escapeHtml(payment.payment_method)}</p>
        <p><strong>Référence :</strong> ${escapeHtml(payment.external_reference ?? payment.payment_number)}</p>
      </div>
    </div>
    <div class="signature">
      <div>Signature organisation</div>
      <div>Signature client / opérateur</div>
    </div>
  </body>
</html>`;
  }
}
