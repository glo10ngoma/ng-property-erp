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

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly templatesRoot = join(process.cwd(), 'src', 'communication', 'email', 'templates');
  private readonly provider: EmailProvider;

  constructor(
    private readonly db: DatabaseService,
    private readonly context: RequestContext,
    private readonly config: ConfigService,
    resendProvider: ResendProvider,
  ) {
    this.provider = resendProvider;
  }

  async getSettings() {
    const row = await this.loadSettingsRow(this.context.organizationId());
    return this.toSettingsSummary(row);
  }

  async updateSettings(dto: UpdateEmailSettingsDto) {
    const organizationId = this.context.organizationId();
    const existing = await this.loadSettingsRow(organizationId);
    const apiKeyEncrypted = dto.api_key
      ? encryptSecret(dto.api_key, this.secretKey())
      : existing?.api_key_encrypted ?? null;

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
      dto.auto_send_invoice ?? false,
      dto.auto_send_payment_receipt ?? false,
      dto.auto_send_tenant_credit_receipt ?? false,
    ]);

    return this.toSettingsSummary(result.rows[0] ?? null);
  }

  async testConnection() {
    const settings = await this.getValidatedSettingsForSending(this.context.organizationId(), false);
    return this.provider.testConnection({
      apiKey: settings.apiKey,
    });
  }

  async sendTestEmail(dto: SendTestEmailDto) {
    const organizationId = this.context.organizationId();
    const settings = await this.getValidatedSettingsForSending(organizationId, true);
    const organizationName = await this.resolveOrganizationName(organizationId);
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
        recipient: dto.recipient,
        subject: 'Test ERP Immobilier',
      });
      const sent = await this.provider.send({
        apiKey: settings.apiKey,
        fromEmail: settings.fromEmail,
        fromName: settings.fromName,
        replyTo: settings.replyTo,
        to: dto.recipient,
        subject: 'Test ERP Immobilier',
        html,
        text,
      });

      if (logId) {
        await this.finalizeLog(logId, 'SENT', sent.externalMessageId, null);
      }

      return {
        success: true,
        provider: sent.provider,
        recipient: dto.recipient,
        externalMessageId: sent.externalMessageId,
        logId,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur inconnue';
      if (logId) {
        await this.finalizeLog(logId, 'FAILED', null, message);
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
        recipient,
        subject: finalSubject,
      });
      const sent = await this.provider.send({
        apiKey: settings.apiKey,
        fromEmail: settings.fromEmail,
        fromName: settings.fromName,
        replyTo: settings.replyTo,
        to: recipient,
        cc,
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
        await this.finalizeLog(logId, 'SENT', sent.externalMessageId, null);
      }

      return {
        success: true,
        recipient,
        cc,
        provider: sent.provider,
        externalMessageId: sent.externalMessageId,
        attachment_file_name: args.document.attachmentFileName,
        logId,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur inconnue';
      if (logId) {
        await this.finalizeLog(logId, 'FAILED', null, message);
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
    });
    const html = this.renderTemplate(baseTemplate, {
      title: subject,
      body: bodyHtml,
    });
    const text = this.htmlToText(args.message || '');

    const logId = await this.insertDocumentLog({
      organizationId,
      provider: settings.provider,
      recipient,
      subject,
      documentType: args.documentType,
      documentId: args.documentId,
      trigger,
      idempotencyKey: args.idempotencyKey ?? null,
      status: 'PENDING',
    });

    if (!logId) {
      return {
        success: true,
        recipient,
        cc,
        provider: settings.provider,
        externalMessageId: null,
        attachment_file_name: args.document.attachmentFileName,
        logId: null,
        skipped: true,
        duplicated: true,
      };
    }

    try {
      const sent = await this.provider.send({
        apiKey: settings.apiKey,
        fromEmail: settings.fromEmail,
        fromName: settings.fromName,
        replyTo: settings.replyTo,
        to: recipient,
        cc,
        subject,
        html,
        text,
        attachments: [{
          filename: args.document.attachmentFileName,
          content: args.document.pdfBuffer.toString('base64'),
          contentType: 'application/pdf',
        }],
      });

      await this.finalizeLog(logId, 'SENT', sent.externalMessageId, null);
      return {
        success: true,
        recipient,
        cc,
        provider: sent.provider,
        externalMessageId: sent.externalMessageId,
        attachment_file_name: args.document.attachmentFileName,
        logId,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur inconnue';
      await this.finalizeLog(logId, 'FAILED', null, message);
      throw error;
    }
  }

  async listLogs(limit = 20) {
    const normalizedLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 20;
    const result = await this.db.query<CommunicationLog>(
      `
        SELECT
          id,
          organization_id,
          channel,
          provider,
          recipient,
          subject,
          status,
          document_type,
          document_id,
          delivery_trigger,
          idempotency_key,
          external_message_id,
          error,
          created_at
        FROM communication_logs
        WHERE organization_id = $1
          AND channel = $2
        ORDER BY created_at DESC, id DESC
        LIMIT $3
      `,
      [this.context.organizationId(), CommunicationChannel.EMAIL, normalizedLimit],
    );
    return result.rows;
  }

  private async loadSettingsRow(organizationId: number) {
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
          auto_send_invoice,
          auto_send_payment_receipt,
          auto_send_tenant_credit_receipt,
          created_at,
          updated_at
        FROM communication_settings
        WHERE organization_id = $1
      `,
      [organizationId],
    );
    return result.rows[0] ?? null;
  }

  private toSettingsSummary(row: EmailSettingsRow | null): EmailSettingsSummary {
    return {
      provider: row?.provider ?? 'RESEND',
      fromName: row?.from_name ?? '',
      fromEmail: row?.from_email ?? '',
      replyTo: row?.reply_to ?? '',
      enabled: row?.enabled ?? false,
      hasApiKey: Boolean(row?.api_key_encrypted),
      autoSendInvoice: Boolean(row?.auto_send_invoice ?? false),
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

  private async insertPendingLog({
    organizationId,
    provider,
    recipient,
    subject,
  }: {
    organizationId: number;
    provider: string;
    recipient: string;
    subject: string;
  }) {
    const result = await this.db.query<{ id: number }>(
      `
        INSERT INTO communication_logs (
          organization_id,
          channel,
          provider,
          recipient,
          subject,
          status,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, 'PENDING', NOW())
        RETURNING id
      `,
      [organizationId, CommunicationChannel.EMAIL, provider, recipient, subject],
    );
    return result.rows[0]?.id ?? null;
  }

  async hasDocumentLogByIdempotencyKey(idempotencyKey: string) {
    const result = await this.db.query<{ id: number }>(
      `
        SELECT id
        FROM communication_logs
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
  }) {
    const result = await this.db.query<{ id: number }>(
      `
        INSERT INTO communication_logs (
          organization_id,
          channel,
          provider,
          recipient,
          subject,
          status,
          document_type,
          document_id,
          delivery_trigger,
          idempotency_key,
          error,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
        ON CONFLICT (organization_id, channel, idempotency_key)
        WHERE idempotency_key IS NOT NULL
        DO NOTHING
        RETURNING id
      `,
      [
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
      ],
    );
    return result.rows[0]?.id ?? null;
  }

  private async finalizeLog(logId: number, status: 'SENT' | 'FAILED', externalMessageId: string | null, error: string | null) {
    await this.db.query(
      `
        UPDATE communication_logs
        SET status = $2,
            external_message_id = $3,
            error = $4
        WHERE id = $1
      `,
      [logId, status, externalMessageId, error],
    );
  }
}
