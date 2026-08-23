import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import { join } from 'path';
import { RequestContext } from '../../auth/request-context';
import { DatabaseService } from '../../database/database.service';
import { DocumentDeliveryTrigger } from '../shared/enums/document-delivery-trigger.enum';
import { DocumentType } from '../shared/enums/document-type.enum';
import { ResolvedDocument } from '../document-resolver.service';
import { CommunicationChannel } from '../shared/enums/communication-channel.enum';
import { CommunicationLog } from '../shared/interfaces/communication-log.interface';
import { SendTestEmailDto } from './dto/send-test-email.dto';
import { UpdateEmailSettingsDto } from './dto/update-email-settings.dto';
import { EmailProvider } from './providers/email-provider';
import { ResendProvider } from './providers/resend.provider';
import { decryptSecret, encryptSecret } from './utils/secret-crypto';

const INVOICE_EMAIL_HIDE_ORGANIZATION_IDS = new Set([1, 5]);

type EmailSettingsRow = {
  id: number;
  organization_id: number;
  provider: string;
  from_name: string | null;
  from_email: string | null;
  reply_to: string | null;
  api_key_encrypted: string | null;
  enabled: boolean;
  auto_send_invoice: boolean;
  auto_send_payment_receipt: boolean;
  auto_send_tenant_credit_receipt: boolean;
  created_at: string;
  updated_at: string;
};

type CommunicationLogFilters = {
  limit?: number;
  offset?: number;
  status?: string;
  trigger?: string;
  documentType?: string;
  recipient?: string;
  search?: string;
  from?: string;
  to?: string;
};

type CommunicationLogRow = CommunicationLog & {
  document_reference: string | null;
  invoice_reference: string | null;
  document_label: string | null;
  actor_label: string | null;
};

type EmailSettingsSummary = {
  provider: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  enabled: boolean;
  hasApiKey: boolean;
  autoSendInvoice: boolean;
  autoSendPaymentReceipt: boolean;
  autoSendTenantCreditReceipt: boolean;
  updatedAt: string | null;
};

type EmailDeliveryMode = 'LIVE' | 'TEST_REDIRECT' | 'DISABLED';

type EmailDeliveryPlan = {
  mode: EmailDeliveryMode;
  recipient: string;
  cc: string[];
  redirected: boolean;
  environment: string;
  logNote: string | null;
};

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly templatesRoot = join(process.cwd(), 'src', 'communication', 'email', 'templates');
  private readonly provider: EmailProvider;
  private communicationLogsSchemaPromise?: Promise<{ hasCreatedBy: boolean }>;

  constructor(
    private readonly db: DatabaseService,
    private readonly context: RequestContext,
    private readonly config: ConfigService,
    resendProvider: ResendProvider,
  ) {
    this.provider = resendProvider;
  }

  async getSettings() {
    const organizationId = this.context.organizationId();
    const row = await this.loadSettingsRow(organizationId);
    return this.toSettingsSummary(row, organizationId);
  }

  async updateSettings(dto: UpdateEmailSettingsDto) {
    const organizationId = this.context.organizationId();
    const existing = await this.loadSettingsRow(organizationId);
    const apiKeyEncrypted = dto.api_key
      ? encryptSecret(dto.api_key, this.secretKey())
      : existing?.api_key_encrypted ?? null;
    const autoSendInvoice = this.normalizeAutomaticInvoiceSetting(organizationId, dto.auto_send_invoice ?? false);

    const query = `
      INSERT INTO communication_settings (
        organization_id,
        provider,
        from_name,
        from_email,
        reply_to,
        api_key_encrypted,
        enabled,
        auto_send_invoice,
        auto_send_payment_receipt,
        auto_send_tenant_credit_receipt,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      ON CONFLICT (organization_id)
      DO UPDATE SET
        provider = EXCLUDED.provider,
        from_name = EXCLUDED.from_name,
        from_email = EXCLUDED.from_email,
        reply_to = EXCLUDED.reply_to,
        api_key_encrypted = EXCLUDED.api_key_encrypted,
        enabled = EXCLUDED.enabled,
        auto_send_invoice = EXCLUDED.auto_send_invoice,
        auto_send_payment_receipt = EXCLUDED.auto_send_payment_receipt,
        auto_send_tenant_credit_receipt = EXCLUDED.auto_send_tenant_credit_receipt,
        updated_at = NOW()
      RETURNING *
    `;

    const result = await this.db.query<EmailSettingsRow>(query, [
      organizationId,
      dto.provider,
      dto.from_name ?? null,
      dto.from_email ?? null,
      dto.reply_to ?? null,
      apiKeyEncrypted,
      dto.enabled,
      autoSendInvoice,
      dto.auto_send_payment_receipt ?? false,
      dto.auto_send_tenant_credit_receipt ?? false,
    ]);

    return this.toSettingsSummary(result.rows[0] ?? null, organizationId);
  }

  async testConnection() {
    const settings = await this.getValidatedSettingsForSending(this.context.organizationId(), false);
    return this.provider.testConnection({
      apiKey: settings.apiKey,
    });
  }

  async sendTestEmail(dto: SendTestEmailDto) {
    const organizationId = this.context.organizationId();
    const settings = await this.getValidatedSettingsForSending(organizationId, false);
    const organizationName = await this.resolveOrganizationName(organizationId);
    const requestedRecipient = String(dto.recipient ?? '').trim();
    if (!requestedRecipient) {
      throw new BadRequestException("L'adresse email du destinataire est obligatoire.");
    }
    if (!this.isEmail(requestedRecipient)) {
      throw new BadRequestException("L'adresse email du destinataire est invalide.");
    }
    const delivery = this.resolveEmailDeliveryPlan(requestedRecipient, []);
    const [baseTemplate, bodyTemplate] = await Promise.all([
      this.readTemplate('base.html'),
      this.readTemplate('test-email.html'),
    ]);

    const bodyHtml = this.renderTemplate(bodyTemplate, {
      organization_name: organizationName,
      generated_date: new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa' }),
    });
    const html = this.renderTemplate(baseTemplate, {
      title: 'Test ERP Immobilier',
      body: bodyHtml,
    });
    const text = [
      'Bonjour,',
      '',
      'La configuration email ERP Immobilier fonctionne correctement.',
      `Organisation : ${organizationName}`,
      `Date : ${new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa' })}`,
    ].join('\n');

    let logId: number | null = null;
    try {
      logId = await this.insertPendingLog({
        organizationId,
        provider: settings.provider,
        recipient: delivery.recipient,
        subject: 'Test ERP Immobilier',
        createdBy: this.context.userId(),
      });
      if (delivery.mode === 'DISABLED') {
        if (logId) {
          await this.finalizeLog(logId, 'SKIPPED', null, delivery.logNote);
        }
        return {
          success: true,
          provider: settings.provider,
          recipient: delivery.recipient,
          externalMessageId: null,
          logId,
          skipped: true,
          deliveryMode: delivery.mode,
          redirected: delivery.redirected,
        };
      }
      const sent = await this.provider.send({
        apiKey: settings.apiKey,
        fromEmail: settings.fromEmail,
        fromName: settings.fromName,
        replyTo: settings.replyTo,
        to: delivery.recipient,
        subject: 'Test ERP Immobilier',
        html,
        text,
      });

      if (logId) {
        await this.finalizeLog(logId, 'SENT', sent.externalMessageId, delivery.logNote);
      }

      return {
        success: true,
        provider: sent.provider,
        recipient: delivery.recipient,
        externalMessageId: sent.externalMessageId,
        logId,
        deliveryMode: delivery.mode,
        redirected: delivery.redirected,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur inconnue';
      if (logId) {
        await this.finalizeLog(logId, 'FAILED', null, this.combineLogMessage(delivery.logNote, message));
      }
      this.logger.error(`Unable to send communication test email: ${message}`);
      throw error;
    }
  }

  async sendResolvedDocumentEmail(args: {
    to: string;
    cc?: string;
    subject?: string;
    message: string;
    document: ResolvedDocument;
  }) {
    const organizationId = this.context.organizationId();
    const settings = await this.getValidatedSettingsForSending(organizationId, true);
    const recipient = String(args.to ?? args.document.recipientFallback ?? '').trim();
    if (!recipient) {
      throw new BadRequestException("L'adresse email du destinataire est obligatoire.");
    }
    if (!this.isEmail(recipient)) {
      throw new BadRequestException("L'adresse email du destinataire est invalide.");
    }

    const cc = this.parseCc(args.cc);
    const delivery = this.resolveEmailDeliveryPlan(recipient, cc);
    const [baseTemplate, bodyTemplate, organizationName] = await Promise.all([
      this.readTemplate('base.html'),
      this.readTemplate(args.document.templateName),
      this.resolveOrganizationName(organizationId),
    ]);

    if (!args.document.pdfBuffer?.byteLength) {
      throw new BadRequestException('Le PDF demandé est indisponible.');
    }

    const bodyHtml = this.renderTemplate(bodyTemplate, {
      ...args.document.templateVariables,
      organization_name: organizationName,
      organization_signature: this.invoiceOrganizationSignature(args.document.documentType, organizationId, organizationName),
    });
    const finalSubject = args.subject?.trim() || args.document.subjectFallback;
    const html = this.renderTemplate(baseTemplate, {
      title: finalSubject,
      body: bodyHtml,
    });
    const text = this.htmlToText(args.message || '');

    let logId: number | null = null;
    try {
      logId = await this.insertPendingLog({
        organizationId,
        provider: settings.provider,
        recipient: delivery.recipient,
        subject: finalSubject,
        createdBy: this.context.userId(),
      });
      if (delivery.mode === 'DISABLED') {
        if (logId) {
          await this.finalizeLog(logId, 'SKIPPED', null, delivery.logNote);
        }
        return {
          success: true,
          recipient: delivery.recipient,
          cc: delivery.cc,
          provider: settings.provider,
          externalMessageId: null,
          attachment_file_name: args.document.attachmentFileName,
          logId,
          skipped: true,
          deliveryMode: delivery.mode,
          redirected: delivery.redirected,
        };
      }
      const sent = await this.provider.send({
        apiKey: settings.apiKey,
        fromEmail: settings.fromEmail,
        fromName: settings.fromName,
        replyTo: settings.replyTo,
        to: delivery.recipient,
        cc: delivery.cc,
        subject: finalSubject,
        html,
        text,
        attachments: [{
          filename: args.document.attachmentFileName,
          content: args.document.pdfBuffer.toString('base64'),
          contentType: 'application/pdf',
        }],
      });

      if (logId) {
        await this.finalizeLog(logId, 'SENT', sent.externalMessageId, delivery.logNote);
      }

      return {
        success: true,
        recipient: delivery.recipient,
        cc: delivery.cc,
        provider: sent.provider,
        externalMessageId: sent.externalMessageId,
        attachment_file_name: args.document.attachmentFileName,
        logId,
        deliveryMode: delivery.mode,
        redirected: delivery.redirected,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur inconnue';
      if (logId) {
        await this.finalizeLog(logId, 'FAILED', null, this.combineLogMessage(delivery.logNote, message));
      }
      throw error;
    }
  }

  async sendDocumentEmail(args: {
    to?: string;
    cc?: string;
    subject?: string;
    message: string;
    document: ResolvedDocument;
    documentType: DocumentType;
    documentId: number;
    trigger?: DocumentDeliveryTrigger;
    idempotencyKey?: string | null;
  }) {
    const organizationId = this.context.organizationId();
    const settings = await this.getValidatedSettingsForSending(organizationId, true);
    const trigger = args.trigger ?? DocumentDeliveryTrigger.MANUAL;
    const recipient = String(args.to ?? args.document.recipientFallback ?? '').trim();
    const subject = args.subject?.trim() || args.document.subjectFallback;
    const cc = this.parseCc(args.cc);
    const delivery = this.resolveEmailDeliveryPlan(recipient, cc);

    if (!args.document.pdfBuffer?.byteLength) {
      throw new BadRequestException('Le PDF demandé est indisponible.');
    }
    if (!recipient) {
      throw new BadRequestException("L'adresse email du destinataire est obligatoire.");
    }
    if (!this.isEmail(recipient)) {
      throw new BadRequestException("L'adresse email du destinataire est invalide.");
    }

    const [baseTemplate, bodyTemplate, organizationName] = await Promise.all([
      this.readTemplate('base.html'),
      this.readTemplate(args.document.templateName),
      this.resolveOrganizationName(organizationId),
    ]);

    const bodyHtml = this.renderTemplate(bodyTemplate, {
      ...args.document.templateVariables,
      organization_name: organizationName,
      organization_signature: this.invoiceOrganizationSignature(args.document.documentType, organizationId, organizationName),
    });
    const html = this.renderTemplate(baseTemplate, {
      title: subject,
      body: bodyHtml,
    });
    const text = this.htmlToText(args.message || '');

    const logId = await this.insertDocumentLog({
      organizationId,
      provider: settings.provider,
      recipient: delivery.recipient,
      subject,
      documentType: args.documentType,
      documentId: args.documentId,
      trigger,
      idempotencyKey: args.idempotencyKey ?? null,
      status: delivery.mode === 'DISABLED' ? 'SKIPPED' : 'PENDING',
      error: delivery.logNote,
      createdBy: this.context.userId(),
    });

    if (!logId) {
      return {
        success: true,
        recipient: delivery.recipient,
        cc: delivery.cc,
        provider: settings.provider,
        externalMessageId: null,
        attachment_file_name: args.document.attachmentFileName,
        logId: null,
        skipped: true,
        duplicated: true,
        deliveryMode: delivery.mode,
        redirected: delivery.redirected,
      };
    }

    if (delivery.mode === 'DISABLED') {
      return {
        success: true,
        recipient: delivery.recipient,
        cc: delivery.cc,
        provider: settings.provider,
        externalMessageId: null,
        attachment_file_name: args.document.attachmentFileName,
        logId,
        skipped: true,
        deliveryMode: delivery.mode,
        redirected: delivery.redirected,
      };
    }

    try {
      const sent = await this.provider.send({
        apiKey: settings.apiKey,
        fromEmail: settings.fromEmail,
        fromName: settings.fromName,
        replyTo: settings.replyTo,
        to: delivery.recipient,
        cc: delivery.cc,
        subject,
        html,
        text,
        attachments: [{
          filename: args.document.attachmentFileName,
          content: args.document.pdfBuffer.toString('base64'),
          contentType: 'application/pdf',
        }],
      });

      await this.finalizeLog(logId, 'SENT', sent.externalMessageId, delivery.logNote);
      return {
        success: true,
        recipient: delivery.recipient,
        cc: delivery.cc,
        provider: sent.provider,
        externalMessageId: sent.externalMessageId,
        attachment_file_name: args.document.attachmentFileName,
        logId,
        deliveryMode: delivery.mode,
        redirected: delivery.redirected,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur inconnue';
      await this.finalizeLog(logId, 'FAILED', null, this.combineLogMessage(delivery.logNote, message));
      throw error;
    }
  }

  async listLogs(filters: CommunicationLogFilters = {}) {
    const { sql, params } = await this.buildLogQuery(filters);
    const result = await this.db.query<CommunicationLogRow>(sql, params);
    return result.rows;
  }

  async getLog(id: number) {
    const { sql, params } = await this.buildLogQuery({ limit: 1 }, id);
    const result = await this.db.query<CommunicationLogRow>(sql, params);
    return result.rows[0] ?? null;
  }

  private async loadSettingsRow(organizationId: number) {
    const schema = await this.getCommunicationSettingsSchema();
    if (!schema.table_exists) {
      return null;
    }

    const result = await this.db.query<EmailSettingsRow>(
      `
        SELECT
          id,
          organization_id,
          provider,
          from_name,
          from_email,
          reply_to,
          api_key_encrypted,
          enabled,
          ${schema.has_auto_send_invoice ? 'auto_send_invoice' : 'FALSE AS auto_send_invoice'},
          ${schema.has_auto_send_payment_receipt ? 'auto_send_payment_receipt' : 'FALSE AS auto_send_payment_receipt'},
          ${schema.has_auto_send_tenant_credit_receipt ? 'auto_send_tenant_credit_receipt' : 'FALSE AS auto_send_tenant_credit_receipt'},
          created_at,
          updated_at
        FROM communication_settings
        WHERE organization_id = $1
      `,
      [organizationId],
    );
    return result.rows[0] ?? null;
  }

  private toSettingsSummary(row: EmailSettingsRow | null, organizationId = row?.organization_id ?? this.context.organizationId()): EmailSettingsSummary {
    return {
      provider: row?.provider ?? 'RESEND',
      fromName: row?.from_name ?? '',
      fromEmail: row?.from_email ?? '',
      replyTo: row?.reply_to ?? '',
      enabled: row?.enabled ?? false,
      hasApiKey: Boolean(row?.api_key_encrypted),
      autoSendInvoice: this.normalizeAutomaticInvoiceSetting(organizationId, Boolean(row?.auto_send_invoice ?? false)),
      autoSendPaymentReceipt: Boolean(row?.auto_send_payment_receipt ?? false),
      autoSendTenantCreditReceipt: Boolean(row?.auto_send_tenant_credit_receipt ?? false),
      updatedAt: row?.updated_at ?? null,
    };
  }

  private async getValidatedSettingsForSending(organizationId: number, requireEnabled: boolean) {
    const row = await this.loadSettingsRow(organizationId);
    if (!row) {
      throw new BadRequestException('Aucune configuration email n’est enregistrée pour cette organisation.');
    }
    if (requireEnabled && !row.enabled) {
      throw new BadRequestException('La configuration email est désactivée pour cette organisation.');
    }
    if (!row.from_email) {
      throw new BadRequestException("L'adresse email d'expédition est obligatoire.");
    }
    if (!row.api_key_encrypted) {
      throw new BadRequestException('La clé API Resend est obligatoire.');
    }

    let apiKey: string;
    try {
      apiKey = decryptSecret(row.api_key_encrypted, this.secretKey());
    } catch {
      throw new InternalServerErrorException('Impossible de déchiffrer la clé API email.');
    }

    return {
      provider: row.provider,
      fromName: row.from_name,
      fromEmail: row.from_email,
      replyTo: row.reply_to,
      apiKey,
    };
  }

  private secretKey() {
    return this.config.get<string>('COMMUNICATION_ENCRYPTION_KEY')
      ?? this.config.get<string>('JWT_SECRET')
      ?? 'local-demo-secret';
  }

  private normalizeAutomaticInvoiceSetting(organizationId: number, value: boolean) {
    void organizationId;
    return Boolean(value);
  }

  private resolveEmailDeliveryMode(): EmailDeliveryMode {
    const rawMode = String(this.config.get('EMAIL_DELIVERY_MODE') ?? process.env.EMAIL_DELIVERY_MODE ?? '')
      .trim()
      .toUpperCase();
    if (rawMode === 'LIVE' || rawMode === 'TEST_REDIRECT' || rawMode === 'DISABLED') {
      return rawMode;
    }
    return this.runtimeEnvironment() === 'production' ? 'LIVE' : 'DISABLED';
  }

  private runtimeEnvironment() {
    return String(this.config.get('NODE_ENV') ?? process.env.NODE_ENV ?? 'development')
      .trim()
      .toLowerCase() || 'development';
  }

  private resolveEmailDeliveryPlan(recipient: string, cc: string[]): EmailDeliveryPlan {
    const mode = this.resolveEmailDeliveryMode();
    const environment = this.runtimeEnvironment();
    if (mode === 'LIVE') {
      return {
        mode,
        recipient,
        cc,
        redirected: false,
        environment,
        logNote: null,
      };
    }

    const maskedRecipient = this.maskRecipient(recipient);
    const ccCount = cc.length;
    if (mode === 'TEST_REDIRECT') {
      const redirectedRecipient = String(this.config.get('EMAIL_TEST_RECIPIENT') ?? process.env.EMAIL_TEST_RECIPIENT ?? '').trim();
      if (!redirectedRecipient || !this.isEmail(redirectedRecipient)) {
        throw new BadRequestException('EMAIL_TEST_RECIPIENT invalide ou absent pour EMAIL_DELIVERY_MODE=TEST_REDIRECT.');
      }
      return {
        mode,
        recipient: redirectedRecipient,
        cc: [],
        redirected: true,
        environment,
        logNote: `EMAIL_TEST_REDIRECT redirected=true environment=${environment} original_recipient=${maskedRecipient}${ccCount ? ` original_cc_count=${ccCount}` : ''}`,
      };
    }

    return {
      mode,
      recipient,
      cc: [],
      redirected: false,
      environment,
      logNote: `EMAIL_DISABLED redirected=false environment=${environment} original_recipient=${maskedRecipient}${ccCount ? ` original_cc_count=${ccCount}` : ''}`,
    };
  }

  private combineLogMessage(note: string | null, message: string | null) {
    const parts = [note, message].filter((value): value is string => Boolean(value && String(value).trim()));
    if (!parts.length) {
      return null;
    }
    return parts.join(' | ').slice(0, 1000);
  }

  private maskRecipient(value: string) {
    const text = String(value ?? '').trim();
    const [localPart = '', domainPart = ''] = text.split('@');
    if (!domainPart) {
      return '***';
    }
    const visibleLocal = localPart.slice(0, Math.min(2, localPart.length));
    return `${visibleLocal || '*'}***@${domainPart}`;
  }

  private async getCommunicationLogsSchema() {
    if (!this.communicationLogsSchemaPromise) {
      this.communicationLogsSchemaPromise = this.db
        .query<{ has_created_by: boolean }>(
          `
            SELECT EXISTS (
              SELECT 1
              FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = 'communication_logs'
                AND column_name = 'created_by'
            ) AS has_created_by
          `,
        )
        .then((result) => ({ hasCreatedBy: Boolean(result.rows[0]?.has_created_by) }))
        .catch(() => ({ hasCreatedBy: false }));
    }

    return this.communicationLogsSchemaPromise;
  }

  private invalidateCommunicationLogsSchemaCache() {
    this.communicationLogsSchemaPromise = undefined;
  }

  private async buildLogQuery(filters: CommunicationLogFilters, id?: number) {
    const params: unknown[] = [];
    const push = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    const schema = await this.getCommunicationLogsSchema();
    const hasCreatedBy = Boolean(schema.hasCreatedBy);

    const conditions = [
      `cl.organization_id = ${push(this.context.organizationId())}`,
      `cl.channel = ${push(CommunicationChannel.EMAIL)}`,
    ];
    if (typeof id === 'number') {
      conditions.push(`cl.id = ${push(id)}`);
    }
    if (filters.status) {
      conditions.push(`cl.status = ${push(String(filters.status).toUpperCase())}`);
    }
    if (filters.trigger) {
      conditions.push(`cl.delivery_trigger = ${push(String(filters.trigger).toUpperCase())}`);
    }
    if (filters.documentType) {
      conditions.push(`cl.document_type = ${push(String(filters.documentType).toUpperCase())}`);
    }
    if (filters.recipient) {
      conditions.push(`cl.recipient ILIKE ${push(`%${String(filters.recipient).trim()}%`)}`);
    }
    if (filters.from) {
      conditions.push(`cl.created_at::date >= ${push(String(filters.from).slice(0, 10))}`);
    }
    if (filters.to) {
      conditions.push(`cl.created_at::date <= ${push(String(filters.to).slice(0, 10))}`);
    }
    if (filters.search) {
      const term = `%${String(filters.search).trim()}%`;
      conditions.push(`(
        cl.recipient ILIKE ${push(term)}
        OR COALESCE(cl.subject, '') ILIKE ${push(term)}
        OR COALESCE(cl.error, '') ILIKE ${push(term)}
        OR COALESCE(cl.external_message_id, '') ILIKE ${push(term)}
        OR COALESCE(o.name, '') ILIKE ${push(term)}
        OR COALESCE(document_reference.reference, '') ILIKE ${push(term)}
        ${hasCreatedBy ? `OR COALESCE(u_full.name, '') ILIKE ${push(term)}` : ''}
      )`);
    }

    const limit = Number.isFinite(filters.limit) ? Math.min(Math.max(Number(filters.limit), 1), 100) : 50;
    const offset = Number.isFinite(filters.offset) ? Math.max(Number(filters.offset), 0) : 0;
    const limitParam = push(limit);
    const offsetParam = push(offset);

    const sql = `
      WITH base AS (
        SELECT
          cl.id,
          cl.organization_id,
          COALESCE(o.name, 'Organisation ' || cl.organization_id::text) AS organization_name,
          cl.channel,
          cl.provider,
          cl.recipient,
          cl.subject,
          cl.status,
          cl.document_type,
          cl.document_id,
          cl.delivery_trigger,
          cl.idempotency_key,
          cl.external_message_id,
          cl.error,
          ${hasCreatedBy ? 'cl.created_by' : 'NULL::INTEGER AS created_by'},
          ${hasCreatedBy ? "COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''), u.email) AS created_by_name" : 'NULL::TEXT AS created_by_name'},
          CASE
            WHEN cl.delivery_trigger = 'AUTO' THEN 'PROCESSUS AUTOMATIQUE'
            WHEN cl.delivery_trigger = 'SYSTEM' THEN 'SYSTEME'
            ELSE 'UTILISATEUR'
          END AS actor_label,
          CASE
            WHEN cl.document_type = 'INVOICE' THEN 'Facture'
            WHEN cl.document_type = 'PAYMENT_RECEIPT' THEN 'Reçu de paiement'
            WHEN cl.document_type = 'TENANT_CREDIT_RECEIPT' THEN 'Reçu de crédit locataire'
            ELSE COALESCE(cl.document_type, 'Document')
          END AS document_label,
          CASE
            WHEN cl.document_type = 'INVOICE' THEN invoice_doc.invoice_number
            WHEN cl.document_type = 'PAYMENT_RECEIPT' THEN payment_doc.receipt_number
            WHEN cl.document_type = 'TENANT_CREDIT_RECEIPT' THEN credit_doc.receipt_number
            ELSE NULL
          END AS document_reference,
          CASE
            WHEN cl.document_type = 'INVOICE' THEN invoice_doc.invoice_number
            WHEN cl.document_type = 'PAYMENT_RECEIPT' THEN payment_invoice.invoice_number
            WHEN cl.document_type = 'TENANT_CREDIT_RECEIPT' THEN credit_invoice.invoice_number
            ELSE NULL
          END AS invoice_reference,
          COUNT(*) OVER (
            PARTITION BY cl.organization_id,
            cl.channel,
            COALESCE(
              cl.idempotency_key,
              CONCAT(
                COALESCE(cl.document_type, ''),
                ':',
                COALESCE(cl.document_id::text, ''),
                ':',
                LOWER(COALESCE(cl.recipient, '')),
                ':',
                COALESCE(cl.subject, '')
              )
            )
          )::INT AS attempt_count,
          cl.created_at
        FROM public.communication_logs cl
        LEFT JOIN organizations o
          ON o.id = cl.organization_id
        ${hasCreatedBy ? `LEFT JOIN app_users u ON u.id = cl.created_by AND u.deleted_at IS NULL` : ''}
        LEFT JOIN invoices invoice_doc
          ON cl.document_type = 'INVOICE'
         AND invoice_doc.id = cl.document_id
         AND invoice_doc.organization_id = cl.organization_id
         AND invoice_doc.deleted_at IS NULL
        LEFT JOIN payments payment_doc
          ON cl.document_type = 'PAYMENT_RECEIPT'
         AND payment_doc.id = cl.document_id
         AND payment_doc.organization_id = cl.organization_id
         AND payment_doc.deleted_at IS NULL
        LEFT JOIN invoices payment_invoice
          ON payment_invoice.id = payment_doc.invoice_id
         AND payment_invoice.organization_id = cl.organization_id
         AND payment_invoice.deleted_at IS NULL
        LEFT JOIN tenant_credits credit_doc
          ON cl.document_type = 'TENANT_CREDIT_RECEIPT'
         AND credit_doc.id = cl.document_id
         AND credit_doc.organization_id = cl.organization_id
         AND credit_doc.deleted_at IS NULL
        LEFT JOIN payments credit_payment
          ON cl.document_type = 'TENANT_CREDIT_RECEIPT'
         AND credit_payment.id = credit_doc.source_payment_id
         AND credit_payment.organization_id = cl.organization_id
         AND credit_payment.deleted_at IS NULL
        LEFT JOIN invoices credit_invoice
          ON credit_invoice.id = credit_payment.invoice_id
         AND credit_invoice.organization_id = cl.organization_id
         AND credit_invoice.deleted_at IS NULL
        LEFT JOIN LATERAL (
          SELECT COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u2.first_name, ''), ' ', COALESCE(u2.last_name, ''))), ''), u2.email) AS name
          FROM app_users u2
          WHERE u2.id = cl.created_by
            AND u2.deleted_at IS NULL
        ) u_full ON TRUE
        LEFT JOIN LATERAL (
          SELECT COALESCE(invoice_doc.invoice_number, payment_doc.receipt_number, credit_doc.receipt_number) AS reference
        ) document_reference ON TRUE
        WHERE ${conditions.join(' AND ')}
      )
      SELECT *
      FROM base
      ORDER BY created_at DESC, id DESC
      LIMIT ${limitParam}
      OFFSET ${offsetParam}
    `;

    return { sql, params };
  }

  private async resolveOrganizationName(organizationId: number) {
    const result = await this.db.query<{ company_name: string | null; legal_name: string | null; organization_name: string }>(
      `
        SELECT
          o.name AS organization_name,
          cs.company_name,
          cs.legal_name
        FROM organizations o
        LEFT JOIN company_settings cs
          ON cs.organization_id = o.id
        WHERE o.id = $1
      `,
      [organizationId],
    );
    const row = result.rows[0];
    if (!row) {
      return `Organisation ${organizationId}`;
    }
    return row.legal_name || row.company_name || row.organization_name;
  }

  private async getCommunicationSettingsSchema() {
    const result = await this.db.query<{
      table_exists: boolean;
      has_auto_send_invoice: boolean;
      has_auto_send_payment_receipt: boolean;
      has_auto_send_tenant_credit_receipt: boolean;
    }>(
      `
        SELECT
          to_regclass('public.communication_settings') IS NOT NULL AS table_exists,
          EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'communication_settings'
              AND column_name = 'auto_send_invoice'
          ) AS has_auto_send_invoice,
          EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'communication_settings'
              AND column_name = 'auto_send_payment_receipt'
          ) AS has_auto_send_payment_receipt,
          EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'communication_settings'
              AND column_name = 'auto_send_tenant_credit_receipt'
          ) AS has_auto_send_tenant_credit_receipt
      `,
    );

    return result.rows[0] ?? {
      table_exists: false,
      has_auto_send_invoice: false,
      has_auto_send_payment_receipt: false,
      has_auto_send_tenant_credit_receipt: false,
    };
  }

  private async readTemplate(fileName: string) {
    return fs.readFile(join(this.templatesRoot, fileName), 'utf8');
  }

  private renderTemplate(template: string, variables: Record<string, string>) {
    return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => variables[key] ?? '');
  }

  private parseCc(value?: string) {
    const parts = String(value ?? '')
      .split(/[;,]/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    for (const email of parts) {
      if (!this.isEmail(email)) {
        throw new BadRequestException(`Adresse CC invalide: ${email}`);
      }
    }
    return parts;
  }

  private isEmail(value: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? '').trim());
  }

  private htmlToText(value: string) {
    return this.normalizeMessage(value)
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n');
  }

  private normalizeMessage(value: string) {
    return String(value ?? '').trim() || 'Veuillez trouver ci-joint votre document.';
  }

  private invoiceOrganizationSignature(documentType: DocumentType, organizationId: number, organizationName: string) {
    if (documentType !== DocumentType.INVOICE || INVOICE_EMAIL_HIDE_ORGANIZATION_IDS.has(organizationId)) {
      return '';
    }
    const trimmed = String(organizationName ?? '').trim();
    return trimmed ? `<br />${this.escapeHtml(trimmed)}` : '';
  }

  private escapeHtml(value: string) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private async insertPendingLog({
    organizationId,
    provider,
    recipient,
    subject,
    createdBy,
  }: {
    organizationId: number;
    provider: string;
    recipient: string;
    subject: string;
    createdBy?: number | null;
  }) {
    const schema = await this.getCommunicationLogsSchema();
    const hasCreatedBy = Boolean(schema.hasCreatedBy);
    const columns = [
      'organization_id',
      'channel',
      'provider',
      'recipient',
      'subject',
      'status',
      ...(hasCreatedBy ? ['created_by'] : []),
      'created_at',
    ];
    const placeholders = hasCreatedBy ? '$1, $2, $3, $4, $5, \'PENDING\', $6, NOW()' : '$1, $2, $3, $4, $5, \'PENDING\', NOW()';
    const values = hasCreatedBy
      ? [organizationId, CommunicationChannel.EMAIL, provider, recipient, subject, createdBy ?? null]
      : [organizationId, CommunicationChannel.EMAIL, provider, recipient, subject];
    const result = await this.db.query<{ id: number }>(
      `
        INSERT INTO public.communication_logs (
          ${columns.join(',\n          ')}
        )
        VALUES (${placeholders})
        RETURNING id
      `,
      values,
    );
    return result.rows[0]?.id ?? null;
  }

  async hasDocumentLogByIdempotencyKey(idempotencyKey: string) {
    const result = await this.db.query<{ id: number }>(
      `
        SELECT id
        FROM public.communication_logs
        WHERE organization_id = $1
          AND channel = $2
          AND idempotency_key = $3
        LIMIT 1
      `,
      [this.context.organizationId(), CommunicationChannel.EMAIL, idempotencyKey],
    );
    return Boolean(result.rows[0]);
  }

  async insertDocumentLog({
    organizationId,
    provider,
    recipient,
    subject,
    documentType,
    documentId,
    trigger,
    idempotencyKey,
    status,
    error,
    createdBy,
  }: {
    organizationId: number;
    provider: string;
    recipient: string;
    subject: string;
    documentType?: DocumentType | null;
    documentId?: number | null;
    trigger?: DocumentDeliveryTrigger;
    idempotencyKey?: string | null;
    status: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';
    error?: string | null;
    createdBy?: number | null;
  }) {
    const schema = await this.getCommunicationLogsSchema();
    const includeCreatedBy = Boolean(schema.hasCreatedBy);

    try {
      return await this.executeDocumentLogInsert({
        organizationId,
        provider,
        recipient,
        subject,
        documentType,
        documentId,
        trigger,
        idempotencyKey,
        status,
        error,
        createdBy,
        includeCreatedBy,
      });
    } catch (caughtError) {
      const pgError = caughtError as { code?: string; message?: string };
      const isCreatedByMismatch =
        pgError?.code === '42703' &&
        typeof pgError?.message === 'string' &&
        /created_by/i.test(pgError.message);

      if (!isCreatedByMismatch) {
        throw caughtError;
      }

      this.invalidateCommunicationLogsSchemaCache();
      return this.executeDocumentLogInsert({
        organizationId,
        provider,
        recipient,
        subject,
        documentType,
        documentId,
        trigger,
        idempotencyKey,
        status,
        error,
        createdBy,
        includeCreatedBy: false,
      });
    }
  }

  private async executeDocumentLogInsert({
    organizationId,
    provider,
    recipient,
    subject,
    documentType,
    documentId,
    trigger,
    idempotencyKey,
    status,
    error,
    createdBy,
    includeCreatedBy,
  }: {
    organizationId: number;
    provider: string;
    recipient: string;
    subject: string;
    documentType?: DocumentType | null;
    documentId?: number | null;
    trigger?: DocumentDeliveryTrigger;
    idempotencyKey?: string | null;
    status: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';
    error?: string | null;
    createdBy?: number | null;
    includeCreatedBy: boolean;
  }) {
    const columns = [
      'organization_id',
      'channel',
      'provider',
      'recipient',
      'subject',
      'status',
      'document_type',
      'document_id',
      'delivery_trigger',
      'idempotency_key',
      'error',
      ...(includeCreatedBy ? ['created_by'] : []),
      'created_at',
    ];
    const placeholders = includeCreatedBy
      ? '$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW()'
      : '$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW()';
    const values = includeCreatedBy
      ? [
          organizationId,
          CommunicationChannel.EMAIL,
          provider,
          recipient,
          subject,
          status,
          documentType ?? null,
          documentId ?? null,
          trigger ?? DocumentDeliveryTrigger.MANUAL,
          idempotencyKey ?? null,
          error ?? null,
          createdBy ?? null,
        ]
      : [
          organizationId,
          CommunicationChannel.EMAIL,
          provider,
          recipient,
          subject,
          status,
          documentType ?? null,
          documentId ?? null,
          trigger ?? DocumentDeliveryTrigger.MANUAL,
          idempotencyKey ?? null,
          error ?? null,
        ];
    const result = await this.db.query<{ id: number }>(
      `
        INSERT INTO public.communication_logs (
          ${columns.join(',\n          ')}
        )
        VALUES (${placeholders})
        ON CONFLICT (organization_id, channel, idempotency_key)
        WHERE idempotency_key IS NOT NULL
        DO NOTHING
        RETURNING id
      `,
      values,
    );
    return result.rows[0]?.id ?? null;
  }

  private async finalizeLog(logId: number, status: 'SENT' | 'FAILED' | 'SKIPPED', externalMessageId: string | null, error: string | null) {
    await this.db.query(
      `
        UPDATE public.communication_logs
        SET status = $2,
            external_message_id = $3,
            error = $4
        WHERE id = $1
      `,
      [logId, status, externalMessageId, error],
    );
  }
}
