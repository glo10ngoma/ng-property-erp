import { Injectable } from '@nestjs/common';
import { RequestContext } from '../auth/request-context';
import { SendDocumentDto } from './dto/send-document.dto';
import { DocumentResolverService } from './document-resolver.service';
import { DocumentDeliveryTrigger } from './shared/enums/document-delivery-trigger.enum';
import { DocumentType } from './shared/enums/document-type.enum';
import { SendTestEmailDto } from './email/dto/send-test-email.dto';
import { UpdateEmailSettingsDto } from './email/dto/update-email-settings.dto';
import { EmailService } from './email/email.service';

@Injectable()
export class CommunicationService {
  constructor(
    private readonly emailService: EmailService,
    private readonly documentResolver: DocumentResolverService,
    private readonly context: RequestContext,
  ) {}

  getEmailSettings() {
    return this.emailService.getSettings();
  }

  updateEmailSettings(dto: UpdateEmailSettingsDto) {
    return this.emailService.updateSettings(dto);
  }

  testEmailConnection() {
    return this.emailService.testConnection();
  }

  sendTestEmail(dto: SendTestEmailDto) {
    return this.emailService.sendTestEmail(dto);
  }

  async sendDocument(dto: SendDocumentDto) {
    const trigger = dto.trigger ?? DocumentDeliveryTrigger.MANUAL;
    const document = await this.documentResolver.resolve({
      documentType: dto.documentType,
      documentId: dto.documentId,
      message: dto.message,
    });
    if (trigger === DocumentDeliveryTrigger.AUTO) {
      return this.sendAutomaticDocument(document.documentType, document.documentId, {
        to: dto.to,
        cc: dto.cc,
        subject: dto.subject,
        message: dto.message,
        document,
      });
    }
    return this.emailService.sendDocumentEmail({
      to: dto.to,
      cc: dto.cc,
      subject: dto.subject,
      message: dto.message,
      document,
      documentType: dto.documentType,
      documentId: dto.documentId,
      trigger,
    });
  }

  emailLogs(limit?: number) {
    return this.emailService.listLogs(limit);
  }

  private async sendAutomaticDocument(
    documentType: DocumentType,
    documentId: number,
    args: { to?: string; cc?: string; subject?: string; message: string; document: Awaited<ReturnType<DocumentResolverService['resolve']>>; },
  ) {
    const settings = await this.emailService.getSettings();
    const subject = args.subject?.trim() || args.document.subjectFallback;
    const recipient = String(args.to ?? args.document.recipientFallback ?? '').trim();
    const idempotencyKey = this.buildAutomaticDocumentIdempotencyKey(documentType, documentId);
    const autoAllowed = this.isAutoSendEnabled(documentType, settings);
    const recipientValid = this.isEmail(recipient);

    if (!autoAllowed || !settings.enabled || !settings.hasApiKey || !settings.fromEmail || !recipientValid) {
      await this.emailService.insertDocumentLog({
        organizationId: this.context.organizationId(),
        provider: settings.provider,
        recipient: recipient || '',
        subject,
        documentType,
        documentId,
        trigger: DocumentDeliveryTrigger.AUTO,
        idempotencyKey,
        status: 'SKIPPED',
        error: !autoAllowed
          ? 'AUTO_SEND_DISABLED'
          : !settings.enabled
            ? 'EMAIL_DISABLED'
            : !settings.hasApiKey
              ? 'API_KEY_MISSING'
              : !settings.fromEmail
                ? 'SENDER_EMAIL_MISSING'
                : 'RECIPIENT_EMAIL_MISSING',
      });
      return {
        success: true,
        skipped: true,
        status: 'SKIPPED',
        provider: settings.provider,
      };
    }

    if (await this.emailService.hasDocumentLogByIdempotencyKey(idempotencyKey)) {
      return {
        success: true,
        skipped: true,
        status: 'SKIPPED',
        provider: settings.provider,
        duplicated: true,
      };
    }

    return this.emailService.sendDocumentEmail({
      to: recipient,
      cc: args.cc,
      subject,
      message: args.message,
      document: args.document,
      documentType,
      documentId,
      trigger: DocumentDeliveryTrigger.AUTO,
      idempotencyKey,
    });
  }

  private buildAutomaticDocumentIdempotencyKey(documentType: DocumentType, documentId: number) {
    return [
      this.context.organizationId(),
      'EMAIL',
      documentType,
      documentId,
      'AUTO',
    ].join(':');
  }

  private isAutoSendEnabled(documentType: DocumentType, settings: Awaited<ReturnType<EmailService['getSettings']>>) {
    switch (documentType) {
      case DocumentType.INVOICE:
        return Boolean(settings.autoSendInvoice);
      case DocumentType.PAYMENT_RECEIPT:
        return Boolean(settings.autoSendPaymentReceipt);
      case DocumentType.TENANT_CREDIT_RECEIPT:
        return Boolean(settings.autoSendTenantCreditReceipt);
      default:
        return false;
    }
  }

  private isEmail(value: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? '').trim());
  }
}
