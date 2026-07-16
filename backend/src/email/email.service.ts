import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import * as nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { RequestContext } from '../auth/request-context';
import { DatabaseService } from '../database/database.service';

type EmailAttachment = {
  filename: string;
  content: Buffer | string;
  contentType?: string;
};

type SendEmailInput = {
  to: string;
  cc?: string[] | string | null;
  bcc?: string[] | string | null;
  subject: string;
  html?: string | null;
  text?: string | null;
  attachments?: EmailAttachment[];
  organizationId?: number;
  templateCode?: string | null;
  relatedEntityType?: string | null;
  relatedEntityId?: number | null;
  createdBy?: number | null;
  idempotencyKey?: string | null;
  forceSend?: boolean;
  metadata?: Record<string, unknown>;
};

type SenderIdentity = {
  organizationName: string;
  senderName: string;
  replyTo: string | null;
  logoUrl: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
};

type EmailLogRow = {
  id: number;
  organization_id: number;
  recipient: string;
  subject: string | null;
  message: string;
  status: string;
  template_code: string | null;
  provider: string | null;
  provider_message_id: string | null;
  created_by: number | null;
  related_entity_type: string | null;
  related_entity_id: number | null;
};

export type TransactionalEmailResult = {
  success: boolean;
  provider: string;
  providerMessageId: string | null;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  logId: number | null;
  duplicated?: boolean;
};

export type EmailRuntimeConfig = {
  provider: string;
  sendingEnabled: boolean;
  sandboxMode: boolean;
  testRecipient: string | null;
  fromAddress: string | null;
  fromName: string | null;
  replyTo: string | null;
  maxPerRun: number;
  maxRetries: number;
  retryDelayMinutes: number;
  invoiceAutomaticEnabled: boolean;
  reminderEnabled: boolean;
  paymentReceiptEnabled: boolean;
  maintenanceEnabled: boolean;
};

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly templatesRoot = join(process.cwd(), 'templates', 'emails');
  private readonly templateCache = new Map<string, string>();
  private transporter: nodemailer.Transporter<SMTPTransport.SentMessageInfo> | null = null;

  constructor(
    private readonly db: DatabaseService,
    private readonly context: RequestContext,
    private readonly config: ConfigService,
  ) {}

  getRuntimeConfig(): EmailRuntimeConfig {
    return this.readRuntimeConfig();
  }

  buildIdempotencyKey(parts: Array<string | number | null | undefined>) {
    return createHash('sha256').update(parts.map((part) => String(part ?? '')).join('|')).digest('hex');
  }

  async emailSettingsSummary(organizationId: number) {
    const runtime = this.readRuntimeConfig();
    const sender = await this.resolveSenderIdentity(organizationId);
    return {
      provider: runtime.provider,
      sendingEnabled: runtime.sendingEnabled,
      sandboxMode: runtime.sandboxMode,
      fromAddress: runtime.fromAddress,
      fromName: sender.senderName,
      replyTo: runtime.replyTo ?? sender.replyTo,
      testRecipient: runtime.testRecipient,
      maxPerRun: runtime.maxPerRun,
      maxRetries: runtime.maxRetries,
      invoiceAutomaticEnabled: runtime.invoiceAutomaticEnabled,
      reminderEnabled: runtime.reminderEnabled,
      paymentReceiptEnabled: runtime.paymentReceiptEnabled,
      maintenanceEnabled: runtime.maintenanceEnabled,
    };
  }

  async sendTestEmail(recipient: string, organizationId: number, createdBy?: number | null) {
    const sender = await this.resolveSenderIdentity(organizationId);
    const variables = {
      organization_name: sender.organizationName,
      sender_name: sender.senderName,
      sandbox_mode: this.readRuntimeConfig().sandboxMode ? 'activé' : 'désactivé',
      generated_at: new Date().toISOString(),
      contact_phone: sender.contactPhone ?? '—',
      contact_email: sender.contactEmail ?? '—',
      footer_note: this.readRuntimeConfig().sandboxMode
        ? 'Mode SANDBOX actif : le destinataire final a été redirigé vers l’adresse de test configurée.'
        : '',
    };

    return this.send({
      to: recipient,
      subject: `Test email - ${sender.organizationName}`,
      html: await this.renderTemplate('system/test-email.html', variables),
      text: await this.renderTemplate('system/test-email.txt', variables),
      organizationId,
      createdBy,
      templateCode: 'EMAIL_TEST',
      relatedEntityType: 'settings',
      relatedEntityId: null,
      forceSend: true,
      metadata: { event: 'EMAIL_TEST' },
    });
  }

  async sendInvoiceCreatedEmail(args: {
    organizationId: number;
    invoiceId: number;
    invoiceNumber: string;
    invoiceType: 'RENT' | 'OTHER_CHARGE';
    tenantName: string;
    tenantEmail: string | null;
    issueDate: string;
    dueDate: string;
    periodLabel?: string | null;
    unitNumber?: string | null;
    buildingName?: string | null;
    currency: string;
    totalAmount: number;
    rentAmount?: number;
    syndicAmount?: number;
    lineItems?: Array<{ description: string; amount: number }>;
    createdBy?: number | null;
    idempotencyKey?: string | null;
  }) {
    if (!args.tenantEmail) {
      return this.skipWithoutRecipient(args.organizationId, {
        recipient: '',
        subject: `Facture ${args.invoiceNumber}`,
        message: 'Adresse email locataire absente',
        templateCode: args.invoiceType === 'OTHER_CHARGE' ? 'INVOICE_OTHER_CHARGE' : 'INVOICE_RENT_CREATED',
        relatedEntityType: 'invoice',
        relatedEntityId: args.invoiceId,
        createdBy: args.createdBy ?? null,
        idempotencyKey: args.idempotencyKey ?? null,
        errorCode: 'RECIPIENT_EMAIL_MISSING',
      });
    }

    const sender = await this.resolveSenderIdentity(args.organizationId);
    const variables = {
      organization_name: sender.organizationName,
      logo_url: sender.logoUrl ?? '',
      recipient_name: args.tenantName,
      invoice_number: args.invoiceNumber,
      issue_date: this.formatDate(args.issueDate),
      due_date: this.formatDate(args.dueDate),
      period_label: args.periodLabel ?? 'Période courante',
      unit_number: args.unitNumber ?? '—',
      building_name: args.buildingName ?? '—',
      total: this.formatMoney(args.totalAmount, args.currency),
      rent_amount: this.formatMoney(args.rentAmount ?? 0, args.currency),
      syndic_amount: this.formatMoney(args.syndicAmount ?? 0, args.currency),
      line_items_html: (args.lineItems ?? [])
        .map((item) => `<li><strong>${this.escapeHtml(item.description)}</strong> : ${this.formatMoney(item.amount, args.currency)}</li>`)
        .join('') || '<li>Aucune ligne</li>',
      line_items_text: (args.lineItems ?? []).map((item) => `- ${item.description}: ${this.formatMoney(item.amount, args.currency)}`).join('\n') || '- Aucune ligne',
      contact_phone: sender.contactPhone ?? '—',
      contact_email: sender.contactEmail ?? '—',
      footer_note: this.readRuntimeConfig().sandboxMode
        ? 'Mode SANDBOX actif : le destinataire final a été redirigé vers l’adresse de test configurée.'
        : '',
    };

    const baseName = args.invoiceType === 'OTHER_CHARGE' ? 'invoices/other-charge-created' : 'invoices/rent-created';
    return this.send({
      to: args.tenantEmail,
      subject: args.invoiceType === 'OTHER_CHARGE'
        ? `Facture autres charges ${args.invoiceNumber}`
        : `Facture de loyer ${args.invoiceNumber}`,
      html: await this.renderTemplate(`${baseName}.html`, variables),
      text: await this.renderTemplate(`${baseName}.txt`, variables),
      organizationId: args.organizationId,
      createdBy: args.createdBy ?? null,
      templateCode: args.invoiceType === 'OTHER_CHARGE' ? 'INVOICE_OTHER_CHARGE' : 'INVOICE_RENT_CREATED',
      relatedEntityType: 'invoice',
      relatedEntityId: args.invoiceId,
      idempotencyKey: args.idempotencyKey ?? null,
      metadata: { event: 'INVOICE_CREATED', invoiceType: args.invoiceType },
    });
  }

  async sendInvoiceReminderEmail(args: {
    organizationId: number;
    invoiceId: number;
    invoiceNumber: string;
    tenantName: string;
    tenantEmail: string | null;
    amount: number;
    currency: string;
    dueDate?: string | null;
    stage: string;
    message: string;
    createdBy?: number | null;
    idempotencyKey?: string | null;
  }) {
    if (!args.tenantEmail) {
      return this.skipWithoutRecipient(args.organizationId, {
        recipient: '',
        subject: `Relance facture ${args.invoiceNumber}`,
        message: 'Adresse email locataire absente',
        templateCode: 'INVOICE_REMINDER',
        relatedEntityType: 'invoice',
        relatedEntityId: args.invoiceId,
        createdBy: args.createdBy ?? null,
        idempotencyKey: args.idempotencyKey ?? null,
        errorCode: 'RECIPIENT_EMAIL_MISSING',
      });
    }

    const sender = await this.resolveSenderIdentity(args.organizationId);
    const variables = {
      organization_name: sender.organizationName,
      recipient_name: args.tenantName,
      invoice_number: args.invoiceNumber,
      amount: this.formatMoney(args.amount, args.currency),
      due_date: args.dueDate ? this.formatDate(args.dueDate) : '—',
      reminder_stage: args.stage,
      reminder_message: this.escapeHtml(args.message).replace(/\n/g, '<br/>'),
      reminder_message_text: args.message,
      contact_phone: sender.contactPhone ?? '—',
      contact_email: sender.contactEmail ?? '—',
      footer_note: this.readRuntimeConfig().sandboxMode
        ? 'Mode SANDBOX actif : le destinataire final a été redirigé vers l’adresse de test configurée.'
        : '',
    };

    return this.send({
      to: args.tenantEmail,
      subject: `Relance facture ${args.invoiceNumber}`,
      html: await this.renderTemplate('invoices/reminder.html', variables),
      text: await this.renderTemplate('invoices/reminder.txt', variables),
      organizationId: args.organizationId,
      createdBy: args.createdBy ?? null,
      templateCode: 'INVOICE_REMINDER',
      relatedEntityType: 'invoice',
      relatedEntityId: args.invoiceId,
      idempotencyKey: args.idempotencyKey ?? null,
      metadata: { event: 'INVOICE_REMINDER', stage: args.stage },
    });
  }

  async sendPaymentReceiptEmail(args: {
    organizationId: number;
    paymentId: number;
    invoiceId: number | null;
    invoiceNumber: string | null;
    receiptNumber: string;
    tenantName: string;
    tenantEmail: string | null;
    paymentDate: string;
    amount: number;
    currency: string;
    remainingAmount?: number | null;
    reference?: string | null;
    createdBy?: number | null;
    idempotencyKey?: string | null;
  }) {
    if (!args.tenantEmail) {
      return this.skipWithoutRecipient(args.organizationId, {
        recipient: '',
        subject: `Reçu ${args.receiptNumber}`,
        message: 'Adresse email locataire absente',
        templateCode: 'PAYMENT_RECEIVED',
        relatedEntityType: 'payment',
        relatedEntityId: args.paymentId,
        createdBy: args.createdBy ?? null,
        idempotencyKey: args.idempotencyKey ?? null,
        errorCode: 'RECIPIENT_EMAIL_MISSING',
      });
    }

    const sender = await this.resolveSenderIdentity(args.organizationId);
    const variables = {
      organization_name: sender.organizationName,
      recipient_name: args.tenantName,
      receipt_number: args.receiptNumber,
      invoice_number: args.invoiceNumber ?? '—',
      payment_date: this.formatDate(args.paymentDate),
      amount: this.formatMoney(args.amount, args.currency),
      remaining_amount: args.remainingAmount !== undefined && args.remainingAmount !== null
        ? this.formatMoney(args.remainingAmount, args.currency)
        : '—',
      reference: args.reference ?? '—',
      contact_phone: sender.contactPhone ?? '—',
      contact_email: sender.contactEmail ?? '—',
      footer_note: this.readRuntimeConfig().sandboxMode
        ? 'Mode SANDBOX actif : le destinataire final a été redirigé vers l’adresse de test configurée.'
        : '',
    };

    return this.send({
      to: args.tenantEmail,
      subject: `Confirmation de paiement ${args.receiptNumber}`,
      html: await this.renderTemplate('payments/payment-received.html', variables),
      text: await this.renderTemplate('payments/payment-received.txt', variables),
      organizationId: args.organizationId,
      createdBy: args.createdBy ?? null,
      templateCode: 'PAYMENT_RECEIVED',
      relatedEntityType: 'payment',
      relatedEntityId: args.paymentId,
      idempotencyKey: args.idempotencyKey ?? null,
      metadata: { event: 'PAYMENT_RECEIVED', invoiceId: args.invoiceId },
    });
  }

  async send(input: SendEmailInput): Promise<TransactionalEmailResult> {
    const runtime = this.readRuntimeConfig();
    const organizationId = input.organizationId ?? this.context.organizationId();
    const createdBy = input.createdBy ?? this.context.userId() ?? null;
    const subject = String(input.subject ?? '').trim();
    const recipient = this.normalizeSingleEmail(input.to);

    if (!subject) {
      throw new BadRequestException('Sujet email requis');
    }
    if (!recipient) {
      throw new BadRequestException('Destinataire email requis');
    }
    if (!this.isValidEmail(recipient)) {
      return this.skipWithoutRecipient(organizationId, {
        recipient,
        subject,
        message: input.text ?? this.plainTextFromHtml(input.html ?? ''),
        templateCode: input.templateCode ?? null,
        relatedEntityType: input.relatedEntityType ?? null,
        relatedEntityId: input.relatedEntityId ?? null,
        createdBy,
        idempotencyKey: input.idempotencyKey ?? null,
        errorCode: 'INVALID_RECIPIENT_EMAIL',
      });
    }

    if (!input.forceSend && input.idempotencyKey) {
      const duplicate = await this.findDuplicateLog(organizationId, input.idempotencyKey);
      if (duplicate) {
        return {
          success: duplicate.status === 'SENT',
          provider: duplicate.provider ?? runtime.provider,
          providerMessageId: duplicate.provider_message_id ?? null,
          status: 'SKIPPED',
          errorCode: 'DUPLICATE_EMAIL',
          errorMessage: 'Email déjà traité pour cette clé métier',
          logId: Number(duplicate.id),
          duplicated: true,
        };
      }
    }

    const textBody = (input.text ?? this.plainTextFromHtml(input.html ?? '')).trim();
    const { rows } = await this.db.query<{ id: number }>(
      `INSERT INTO email_logs (
         recipient, subject, message, status, provider_response,
         related_entity_type, related_entity_id, sent_at, created_by, organization_id,
         template_code, provider, provider_message_id, attempt_count, failed_at,
         error_code, error_message, sandbox_recipient, idempotency_key, updated_at
       )
       VALUES (
         $1, $2, $3, 'PENDING', $4::jsonb,
         $5, $6, NULL, $7, $8,
         $9, $10, NULL, 0, NULL,
         NULL, NULL, NULL, $11, NOW()
       )
       RETURNING id`,
      [
        recipient,
        subject,
        textBody,
        JSON.stringify({ queuedAt: new Date().toISOString(), meta: input.metadata ?? {} }),
        input.relatedEntityType ?? null,
        input.relatedEntityId ?? null,
        createdBy,
        organizationId,
        input.templateCode ?? null,
        runtime.provider,
        input.idempotencyKey ?? null,
      ],
    );

    return this.processQueuedEmail(rows[0].id, {
      ...input,
      to: recipient,
      subject,
      text: textBody,
      organizationId,
      createdBy,
    });
  }

  @Cron('0 */5 * * * *', { timeZone: 'Africa/Kinshasa' })
  async retryQueuedEmails() {
    const runtime = this.readRuntimeConfig();
    if (!runtime.sendingEnabled || runtime.provider !== 'SMTP') {
      return;
    }

    const { rows } = await this.db.query<{ id: number }>(
      `SELECT id
       FROM email_logs
       WHERE deleted_at IS NULL
         AND status IN ('PENDING', 'FAILED')
         AND attempt_count < $1
         AND (
           status = 'PENDING'
           OR failed_at IS NULL
           OR failed_at <= NOW() - ($2 || ' minutes')::INTERVAL
         )
       ORDER BY created_at ASC
       LIMIT $3`,
      [runtime.maxRetries, String(runtime.retryDelayMinutes), runtime.maxPerRun],
    );

    for (const row of rows) {
      try {
        await this.processStoredLog(row.id);
      } catch (error) {
        this.logger.warn(`[EMAIL] retry_failed logId=${row.id} message=${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private async processStoredLog(logId: number) {
    const { rows } = await this.db.query<EmailLogRow>(
      `SELECT *
       FROM email_logs
       WHERE id = $1
         AND deleted_at IS NULL`,
      [logId],
    );
    const log = rows[0];
    if (!log) return null;

    return this.processQueuedEmail(logId, {
      to: log.recipient,
      subject: log.subject ?? '(sans sujet)',
      text: log.message,
      organizationId: log.organization_id,
      templateCode: log.template_code,
      relatedEntityType: log.related_entity_type,
      relatedEntityId: log.related_entity_id,
      createdBy: log.created_by,
      forceSend: true,
    });
  }

  private async processQueuedEmail(logId: number, input: SendEmailInput): Promise<TransactionalEmailResult> {
    const runtime = this.readRuntimeConfig();
    const organizationId = input.organizationId ?? this.context.organizationId();
    const sender = await this.resolveSenderIdentity(organizationId);
    const finalRecipient = runtime.sandboxMode ? runtime.testRecipient : this.normalizeSingleEmail(input.to);

    await this.db.query(
      `UPDATE email_logs
       SET status = 'SENDING',
           provider = $2,
           sandbox_recipient = $3,
           updated_at = NOW()
       WHERE id = $1`,
      [logId, runtime.provider, finalRecipient],
    );

    if (!runtime.sendingEnabled) {
      return this.finalizeSkipped(logId, runtime.provider, 'EMAIL_SENDING_DISABLED', 'Envoi email désactivé');
    }
    if (runtime.provider !== 'SMTP') {
      return this.finalizeFailed(logId, runtime.provider, 'EMAIL_PROVIDER_UNSUPPORTED', `Fournisseur email non supporté: ${runtime.provider}`);
    }
    if (!runtime.fromAddress) {
      return this.finalizeFailed(logId, runtime.provider, 'EMAIL_FROM_ADDRESS_MISSING', 'Adresse expéditeur non configurée');
    }
    if (!finalRecipient || !this.isValidEmail(finalRecipient)) {
      return this.finalizeFailed(logId, runtime.provider, 'EMAIL_TEST_RECIPIENT_INVALID', 'Adresse de destination finale invalide');
    }

    const transporter = this.smtpTransporter();
    const html = input.html ? this.normalizeEmailHtml(input.html) : this.fallbackHtml(input.subject, input.text ?? '');
    const text = (input.text ?? this.plainTextFromHtml(html)).trim();

    try {
      this.logger.log(`[EMAIL] sending organizationId=${organizationId} templateCode=${input.templateCode ?? 'MANUAL'} relatedEntityId=${input.relatedEntityId ?? 'null'} logId=${logId}`);
      const response = await transporter.sendMail({
        from: this.formatFromHeader(sender.senderName, runtime.fromAddress),
        to: finalRecipient,
        cc: this.normalizeEmailList(input.cc).length ? this.normalizeEmailList(input.cc) : undefined,
        bcc: this.normalizeEmailList(input.bcc).length ? this.normalizeEmailList(input.bcc) : undefined,
        replyTo: runtime.replyTo ?? sender.replyTo ?? undefined,
        subject: input.subject,
        html,
        text,
        attachments: input.attachments,
      });

      await this.db.query(
        `UPDATE email_logs
         SET status = 'SENT',
             provider = $2,
             provider_message_id = $3,
             sent_at = NOW(),
             failed_at = NULL,
             error_code = NULL,
             error_message = NULL,
             attempt_count = COALESCE(attempt_count, 0) + 1,
             provider_response = $4::jsonb,
             updated_at = NOW()
         WHERE id = $1`,
        [
          logId,
          runtime.provider,
          response.messageId ?? null,
          JSON.stringify({
            accepted: response.accepted,
            rejected: response.rejected,
            envelope: response.envelope,
            originalRecipient: input.to,
            sandboxMode: runtime.sandboxMode,
          }),
        ],
      );

      this.logger.log(`[EMAIL] sent organizationId=${organizationId} templateCode=${input.templateCode ?? 'MANUAL'} relatedEntityId=${input.relatedEntityId ?? 'null'} providerMessageId=${response.messageId ?? 'n/a'} logId=${logId}`);
      return {
        success: true,
        provider: runtime.provider,
        providerMessageId: response.messageId ?? null,
        status: 'SENT',
        errorCode: null,
        errorMessage: null,
        logId,
      };
    } catch (error) {
      const errorCode = this.emailErrorCode(error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.db.query(
        `UPDATE email_logs
         SET status = 'FAILED',
             provider = $2,
             failed_at = NOW(),
             error_code = $3,
             error_message = $4,
             attempt_count = COALESCE(attempt_count, 0) + 1,
             provider_response = $5::jsonb,
             updated_at = NOW()
         WHERE id = $1`,
        [
          logId,
          runtime.provider,
          errorCode,
          errorMessage.slice(0, 1000),
          JSON.stringify({
            originalRecipient: input.to,
            sandboxMode: runtime.sandboxMode,
          }),
        ],
      );
      this.logger.error(
        `[EMAIL] failed organizationId=${organizationId} templateCode=${input.templateCode ?? 'MANUAL'} relatedEntityId=${input.relatedEntityId ?? 'null'} errorCode=${errorCode} logId=${logId} message=${errorMessage}`,
      );
      return {
        success: false,
        provider: runtime.provider,
        providerMessageId: null,
        status: 'FAILED',
        errorCode,
        errorMessage,
        logId,
      };
    }
  }

  private async skipWithoutRecipient(
    organizationId: number,
    args: {
      recipient: string;
      subject: string;
      message: string;
      templateCode: string | null;
      relatedEntityType: string | null;
      relatedEntityId: number | null;
      createdBy: number | null;
      idempotencyKey: string | null;
      errorCode: string;
    },
  ): Promise<TransactionalEmailResult> {
    const runtime = this.readRuntimeConfig();
    const { rows } = await this.db.query<{ id: number }>(
      `INSERT INTO email_logs (
         recipient, subject, message, status, provider_response,
         related_entity_type, related_entity_id, sent_at, created_by, organization_id,
         template_code, provider, provider_message_id, attempt_count, failed_at,
         error_code, error_message, sandbox_recipient, idempotency_key, updated_at
       )
       VALUES (
         $1, $2, $3, 'SKIPPED', $4::jsonb,
         $5, $6, NULL, $7, $8,
         $9, $10, NULL, 0, NULL,
         $11, $12, NULL, $13, NOW()
       )
       RETURNING id`,
      [
        args.recipient,
        args.subject,
        args.message,
        JSON.stringify({ reason: args.errorCode }),
        args.relatedEntityType,
        args.relatedEntityId,
        args.createdBy,
        organizationId,
        args.templateCode,
        runtime.provider,
        args.errorCode,
        args.errorCode,
        args.idempotencyKey,
      ],
    );
    this.logger.log(`[EMAIL] skipped organizationId=${organizationId} templateCode=${args.templateCode ?? 'MANUAL'} relatedEntityId=${args.relatedEntityId ?? 'null'} reason=${args.errorCode}`);
    return {
      success: false,
      provider: runtime.provider,
      providerMessageId: null,
      status: 'SKIPPED',
      errorCode: args.errorCode,
      errorMessage: args.errorCode,
      logId: rows[0].id,
    };
  }

  private async finalizeSkipped(logId: number, provider: string, errorCode: string, errorMessage: string): Promise<TransactionalEmailResult> {
    await this.db.query(
      `UPDATE email_logs
       SET status = 'SKIPPED',
           provider = $2,
           error_code = $3,
           error_message = $4,
           updated_at = NOW()
       WHERE id = $1`,
      [logId, provider, errorCode, errorMessage],
    );
    this.logger.log(`[EMAIL] skipped provider=${provider} logId=${logId} reason=${errorCode}`);
    return {
      success: false,
      provider,
      providerMessageId: null,
      status: 'SKIPPED',
      errorCode,
      errorMessage,
      logId,
    };
  }

  private async finalizeFailed(logId: number, provider: string, errorCode: string, errorMessage: string): Promise<TransactionalEmailResult> {
    await this.db.query(
      `UPDATE email_logs
       SET status = 'FAILED',
           provider = $2,
           failed_at = NOW(),
           error_code = $3,
           error_message = $4,
           attempt_count = COALESCE(attempt_count, 0) + 1,
           updated_at = NOW()
       WHERE id = $1`,
      [logId, provider, errorCode, errorMessage],
    );
    this.logger.error(`[EMAIL] failed provider=${provider} logId=${logId} errorCode=${errorCode} message=${errorMessage}`);
    return {
      success: false,
      provider,
      providerMessageId: null,
      status: 'FAILED',
      errorCode,
      errorMessage,
      logId,
    };
  }

  private async findDuplicateLog(organizationId: number, idempotencyKey: string) {
    const { rows } = await this.db.query<EmailLogRow>(
      `SELECT *
       FROM email_logs
       WHERE organization_id = $1
         AND idempotency_key = $2
         AND deleted_at IS NULL
         AND status IN ('PENDING', 'SENDING', 'SENT', 'SKIPPED')
       ORDER BY id DESC
       LIMIT 1`,
      [organizationId, idempotencyKey],
    );
    return rows[0] ?? null;
  }

  private async resolveSenderIdentity(organizationId: number): Promise<SenderIdentity> {
    const { rows } = await this.db.query(
      `SELECT
         o.name AS organization_name,
         COALESCE(cs.company_legal_name, cs.legal_name, cs.company_name, o.name) AS sender_name,
         COALESCE(NULLIF(TRIM(cs.email), ''), NULL) AS reply_to,
         COALESCE(NULLIF(TRIM(cs.logo_file_url), ''), NULL) AS logo_url,
         COALESCE(NULLIF(TRIM(cs.phone), ''), NULL) AS contact_phone,
         COALESCE(NULLIF(TRIM(cs.email), ''), NULL) AS contact_email
       FROM organizations o
       LEFT JOIN company_settings cs
         ON cs.organization_id = o.id
        AND cs.deleted_at IS NULL
       WHERE o.id = $1
       LIMIT 1`,
      [organizationId],
    );
    const row = rows[0];
    return {
      organizationName: String(row?.organization_name ?? `Organisation ${organizationId}`),
      senderName: String(row?.sender_name ?? row?.organization_name ?? `Organisation ${organizationId}`),
      replyTo: row?.reply_to ? String(row.reply_to) : null,
      logoUrl: row?.logo_url ? String(row.logo_url) : null,
      contactPhone: row?.contact_phone ? String(row.contact_phone) : null,
      contactEmail: row?.contact_email ? String(row.contact_email) : null,
    };
  }

  private smtpTransporter() {
    if (this.transporter) {
      return this.transporter;
    }

    const host = this.config.get<string>('SMTP_HOST');
    const port = Number(this.config.get<string>('SMTP_PORT') ?? 587);
    const user = this.config.get<string>('SMTP_USER');
    const password = this.config.get<string>('SMTP_PASSWORD');
    const secure = String(this.config.get<string>('SMTP_SECURE') ?? 'false').trim().toLowerCase() === 'true';

    if (!host || !user || !password) {
      throw new BadRequestException('Configuration SMTP incomplète');
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass: password },
    });
    return this.transporter;
  }

  private readRuntimeConfig(): EmailRuntimeConfig {
    return {
      provider: String(this.config.get<string>('EMAIL_PROVIDER') ?? 'SMTP').trim().toUpperCase(),
      sendingEnabled: String(this.config.get<string>('EMAIL_SENDING_ENABLED') ?? 'false').trim().toLowerCase() === 'true',
      sandboxMode: String(this.config.get<string>('EMAIL_SANDBOX_MODE') ?? 'true').trim().toLowerCase() === 'true',
      testRecipient: this.normalizeSingleEmail(this.config.get<string>('EMAIL_TEST_RECIPIENT') ?? ''),
      fromAddress: this.normalizeSingleEmail(this.config.get<string>('EMAIL_FROM_ADDRESS') ?? ''),
      fromName: this.config.get<string>('EMAIL_FROM_NAME') ?? null,
      replyTo: this.normalizeSingleEmail(this.config.get<string>('EMAIL_REPLY_TO') ?? ''),
      maxPerRun: this.safePositiveInteger(this.config.get<string>('EMAIL_MAX_PER_RUN') ?? '20', 20),
      maxRetries: this.safePositiveInteger(this.config.get<string>('EMAIL_MAX_RETRIES') ?? '3', 3),
      retryDelayMinutes: this.safePositiveInteger(this.config.get<string>('EMAIL_RETRY_DELAY_MINUTES') ?? '10', 10),
      invoiceAutomaticEnabled: String(this.config.get<string>('EMAIL_INVOICE_AUTOMATIC_ENABLED') ?? 'true').trim().toLowerCase() === 'true',
      reminderEnabled: String(this.config.get<string>('EMAIL_REMINDER_ENABLED') ?? 'true').trim().toLowerCase() === 'true',
      paymentReceiptEnabled: String(this.config.get<string>('EMAIL_PAYMENT_RECEIPT_ENABLED') ?? 'true').trim().toLowerCase() === 'true',
      maintenanceEnabled: String(this.config.get<string>('EMAIL_MAINTENANCE_ENABLED') ?? 'false').trim().toLowerCase() === 'true',
    };
  }

  private safePositiveInteger(value: string, fallback: number) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : fallback;
  }

  private normalizeSingleEmail(value: string | null | undefined) {
    const normalized = String(value ?? '').trim().toLowerCase();
    return normalized || null;
  }

  private normalizeEmailList(value: string[] | string | null | undefined) {
    if (!value) return [];
    const list = Array.isArray(value) ? value : String(value).split(',');
    return list
      .map((item) => this.normalizeSingleEmail(item))
      .filter((item): item is string => Boolean(item && this.isValidEmail(item)));
  }

  private isValidEmail(value: string | null | undefined) {
    if (!value) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
  }

  private async renderTemplate(templatePath: string, variables: Record<string, unknown>) {
    const fullPath = join(this.templatesRoot, templatePath);
    const cached = this.templateCache.get(fullPath);
    const raw = cached ?? await fs.readFile(fullPath, 'utf8');
    if (!cached) {
      this.templateCache.set(fullPath, raw);
    }
    return raw.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => String(variables[key] ?? ''));
  }

  private normalizeEmailHtml(html: string) {
    return html.replace(/{{\s*[^}]+\s*}}/g, '').trim();
  }

  private fallbackHtml(subject: string, text: string) {
    return `<div><h1>${this.escapeHtml(subject)}</h1><p>${this.escapeHtml(text).replace(/\n/g, '<br/>')}</p></div>`;
  }

  private plainTextFromHtml(html: string) {
    return String(html ?? '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private formatFromHeader(senderName: string, fromAddress: string) {
    const cleanName = String(senderName ?? '').replace(/["<>]/g, '').trim();
    return cleanName ? `"${cleanName}" <${fromAddress}>` : fromAddress;
  }

  private formatMoney(value: number, currency: string) {
    return `${Number(value ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
  }

  private formatDate(value: string) {
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleDateString('fr-FR');
  }

  private emailErrorCode(error: unknown) {
    if (typeof error === 'object' && error && 'code' in error && typeof (error as { code?: unknown }).code === 'string') {
      return String((error as { code: string }).code).toUpperCase();
    }
    return 'EMAIL_SEND_FAILED';
  }

  private escapeHtml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
