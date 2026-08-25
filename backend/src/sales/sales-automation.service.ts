import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RequestContext } from '../auth/request-context';
import { DatabaseService } from '../database/database.service';
import {
  SalesAutomationExecuteDto,
  SalesAutomationRunListQueryDto,
  SalesCollectionsQueryDto,
  SalesInvoiceReminderListQueryDto,
  SendSalesInvoiceReminderDto,
  UpdateSalesSettingsDto,
} from './dto';
import { SalesFinancialsService } from './sales-financials.service';
import { SalesRepository } from './sales.repository';

@Injectable()
export class SalesAutomationService {
  private readonly logger = new Logger(SalesAutomationService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly context: RequestContext,
    private readonly repository: SalesRepository,
    private readonly config: ConfigService,
    private readonly financials: SalesFinancialsService,
  ) {}

  getSettings() {
    return this.repository.findSettings(this.context.organizationId());
  }

  updateSettings(dto: UpdateSalesSettingsDto) {
    return this.db.transaction(async (client) => {
      const organizationId = this.context.organizationId();
      const before = await this.repository.findSettings(organizationId, client);
      const after = await this.repository.upsertSettings(organizationId, dto, client);
      await this.repository.writeAuditEvent(
        organizationId,
        'sales_automation_settings',
        Number(after.id),
        'SALES_AUTOMATION_SETTINGS_UPDATED',
        this.context.userId(),
        before,
        after,
        client,
      );
      return after;
    });
  }

  async dryRunInstallments(dto: SalesAutomationExecuteDto = {}) {
    const snapshot = await this.buildInstallmentSnapshot(dto);
    return {
      organization_id: this.context.organizationId(),
      evaluated_at: new Date().toISOString(),
      timezone: snapshot.timezone,
      installments_scanned: snapshot.installments_scanned,
      eligible_invoices: snapshot.eligible_invoices,
      existing_invoices: snapshot.existing_invoices,
      upcoming_reminders: 0,
      overdue_reminders: 0,
      missing_email: snapshot.missing_email,
      skipped: snapshot.skipped,
      items: snapshot.items,
    };
  }

  async runInstallments(dto: SalesAutomationExecuteDto = {}) {
    const organizationId = this.context.organizationId();
    const snapshot = await this.buildInstallmentSnapshot(dto);
    const settings = await this.repository.findSettings(organizationId);
    const clock = this.buildManualClock(organizationId, settings, dto.as_of_date);
    const result = await this.runScheduledInstallmentsForOrganization(organizationId, settings, clock, {
      executionMode: this.normalizeExecutionMode(dto.execution_mode),
      actorUserId: this.context.userId(),
      force: Boolean((dto as any).force),
      throwOnLocked: true,
    });
    if (!result) {
      throw new BadRequestException("Aucune exécution d'automatisation n'a pu être démarrée.");
    }
    return {
      run: result.run,
      snapshot,
    };
  }

  async dryRunReminders(dto: SalesAutomationExecuteDto = {}) {
    const snapshot = await this.buildReminderSnapshot(dto);
    return {
      organization_id: this.context.organizationId(),
      evaluated_at: new Date().toISOString(),
      timezone: snapshot.timezone,
      installments_scanned: 0,
      eligible_invoices: snapshot.eligible_invoices,
      existing_invoices: 0,
      upcoming_reminders: snapshot.upcoming_reminders,
      overdue_reminders: snapshot.overdue_reminders,
      missing_email: snapshot.missing_email,
      skipped: snapshot.skipped,
      items: snapshot.items,
    };
  }

  async runReminders(dto: SalesAutomationExecuteDto = {}) {
    const organizationId = this.context.organizationId();
    const snapshot = await this.buildReminderSnapshot(dto);
    const settings = await this.repository.findSettings(organizationId);
    const clock = this.buildManualClock(organizationId, settings, dto.as_of_date);
    const result = await this.runScheduledRemindersForOrganization(organizationId, settings, clock, {
      executionMode: this.normalizeExecutionMode(dto.execution_mode),
      actorUserId: this.context.userId(),
      force: Boolean((dto as any).force),
      throwOnLocked: true,
    });
    if (!result) {
      throw new BadRequestException("Aucune exécution de relances n'a pu être démarrée.");
    }
    return {
      run: result.run,
      snapshot,
    };
  }

  listRuns(query: SalesAutomationRunListQueryDto) {
    return this.repository.listAutomationRuns(this.context.organizationId(), query);
  }

  async listInvoiceReminders(invoiceId: number, _query: SalesInvoiceReminderListQueryDto) {
    const reminders = await this.repository.listInvoiceReminders(this.context.organizationId(), invoiceId);
    return reminders.map((item: Record<string, unknown>) => {
      const recipient = typeof item.recipient === 'string' ? item.recipient : null;
      return {
        ...item,
        recipient: null,
        masked_recipient: this.maskReminderRecipient(recipient),
      };
    });
  }

  async sendInvoiceReminder(invoiceId: number, dto: SendSalesInvoiceReminderDto) {
    const organizationId = this.context.organizationId();
    const invoice = await this.financials.getInvoice(invoiceId);

    return this.db.transaction(async (client) => {
      const idempotencyKey = [
        organizationId,
        invoiceId,
        dto.reminder_type,
        dto.reminder_stage ?? 'MANUAL',
        new Date().toISOString().slice(0, 10),
        'EMAIL',
      ].join(':');
      const created = await this.repository.createInvoiceReminder(organizationId, {
        invoice_id: invoiceId,
        subscription_id: invoice.subscription_id,
        buyer_id: null,
        reminder_type: dto.reminder_type,
        reminder_stage: dto.reminder_stage ?? 'MANUAL',
        scheduled_for: new Date().toISOString(),
        sent_at: null,
        status: this.resolveCollectionDeliveryMode() === 'DISABLED' ? 'SKIPPED' : 'PENDING',
        channel: 'EMAIL',
        recipient: invoice.buyer_name ? '[masked]' : null,
        communication_log_id: null,
        idempotency_key: idempotencyKey,
        metadata: {
          manual_reason: dto.reason ?? null,
          delivery_mode: this.resolveCollectionDeliveryMode(),
          invoice_number: invoice.invoice_number,
        },
      }, client);
      let finalized;
      try {
        const delivery = await this.financials.sendInvoiceReminderForAutomation(
          organizationId,
          invoiceId,
          this.context.userId(),
          client,
          {
            reminderType: dto.reminder_type,
            reminderStage: dto.reminder_stage ?? 'MANUAL',
            idempotencyKey,
          },
        );
        const outcome = this.resolveReminderDeliveryOutcome(delivery);
        finalized = await client.query(
          `UPDATE sales_invoice_reminders
           SET status = $3,
               sent_at = CASE WHEN $3 IN ('SENT', 'SKIPPED') THEN NOW() ELSE sent_at END,
               recipient = COALESCE($4, recipient),
               communication_log_id = $5,
               failure_code = $6,
               failure_message = $7,
               updated_at = NOW()
           WHERE organization_id = $1 AND id = $2
           RETURNING *`,
          [
            organizationId,
            created.id,
            outcome.status,
            delivery.recipient ?? null,
            outcome.communicationLogId,
            outcome.failureCode,
            outcome.failureMessage,
          ],
        );
      } catch (error) {
        finalized = await client.query(
          `UPDATE sales_invoice_reminders
           SET status = 'FAILED',
               failure_code = $3,
               failure_message = $4,
               updated_at = NOW()
           WHERE organization_id = $1 AND id = $2
           RETURNING *`,
          [
            organizationId,
            created.id,
            this.resolveReminderFailureCode(error),
            error instanceof Error ? error.message : String(error),
          ],
        );
      }
      await this.repository.writeAuditEvent(
        organizationId,
        'sales_invoice_reminder',
        Number(created?.id ?? 0),
        'SALES_INVOICE_REMINDER_QUEUED',
        this.context.userId(),
        null,
        finalized.rows[0] ?? created,
        client,
      );
      return finalized.rows[0] ?? created;
    });
  }

  async getCollections(query: SalesCollectionsQueryDto) {
    const [summary, table] = await Promise.all([
      this.repository.summarizeCollections(this.context.organizationId()),
      this.repository.listCollections(this.context.organizationId(), query),
    ]);
    return {
      summary,
      ...table,
    };
  }

  async runSchedulerTick(now = new Date()) {
    const organizations = await this.repository.listOrganizationsEligibleForSalesAutomation();
    for (const settings of organizations) {
      try {
        const clock = this.resolveOrganizationClock(
          Number(settings.organization_id),
          String(settings.sales_reminder_timezone ?? 'Africa/Kinshasa'),
          String(settings.sales_reminder_execution_time ?? '09:00'),
          now,
        );
        if (Boolean(settings.sales_installment_automation_enabled) && this.shouldRunAtLocalTime(clock.localTime, clock.executionTime)) {
          await this.runScheduledInstallmentsForOrganization(Number(settings.organization_id), settings, clock);
        }
        if (Boolean(settings.sales_reminders_enabled) && this.shouldRunAtLocalTime(clock.localTime, clock.executionTime)) {
          await this.runScheduledRemindersForOrganization(Number(settings.organization_id), settings, clock);
        }
      } catch (error) {
        this.logger.error(
          `[SALES_AUTOMATION] organization=${Number(settings.organization_id)} code=${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }
  }

  private async buildInstallmentSnapshot(dto: SalesAutomationExecuteDto) {
    return this.buildInstallmentSnapshotForOrganization(this.context.organizationId(), dto);
  }

  private async buildInstallmentSnapshotForOrganization(organizationId: number, dto: SalesAutomationExecuteDto) {
    const settings = await this.repository.findSettings(organizationId);
    const asOfDate = dto.as_of_date ?? new Date().toISOString().slice(0, 10);
    const daysBefore = Number(settings?.sales_auto_generate_invoice_days_before ?? 0);
    const { rows } = await this.db.query(
      `SELECT
         ssi.id AS installment_id,
         ssi.subscription_id,
         ssi.sequence_number,
         ssi.due_date,
         ssi.amount,
         ssi.currency,
         ss.subscription_number,
         ss.status AS subscription_status,
         COALESCE(sb.full_name, sb.company_name) AS buyer_name,
         sb.email AS buyer_email,
         sc.title AS catalog_title,
         EXISTS (
           SELECT 1
           FROM sales_invoices si
           WHERE si.organization_id = ssi.organization_id
             AND si.subscription_id = ssi.subscription_id
             AND si.installment_id = ssi.id
             AND si.status <> 'CANCELLED'
         ) AS has_active_invoice
       FROM sales_subscription_installments ssi
       JOIN sales_subscriptions ss
         ON ss.id = ssi.subscription_id
        AND ss.organization_id = ssi.organization_id
       LEFT JOIN sales_buyers sb
         ON sb.id = ss.buyer_id
        AND sb.organization_id = ss.organization_id
       LEFT JOIN sales_property_catalog sc
         ON sc.id = ss.catalog_item_id
        AND sc.organization_id = ss.organization_id
       WHERE ssi.organization_id = $1
         AND ssi.amount > 0
         AND ss.status IN ('SUBMITTED', 'APPROVED', 'CONVERTED')
         AND ssi.due_date <= ($2::date + make_interval(days => $3::int))
       ORDER BY ssi.due_date ASC, ssi.id ASC`,
      [organizationId, asOfDate, daysBefore],
    );

    const items = rows.map((row: any) => {
      const reasons: string[] = [];
      if (row.has_active_invoice) reasons.push('facture active déjà présente');
      return {
        installment_id: row.installment_id,
        subscription_id: row.subscription_id,
        subscription_number: row.subscription_number,
        buyer_name: row.buyer_name,
        catalog_title: row.catalog_title,
        due_date: row.due_date,
        amount: row.amount,
        currency: row.currency,
        eligible: reasons.length === 0,
        reasons,
      };
    });

    return {
      settings,
      timezone: String(settings?.sales_reminder_timezone ?? 'Africa/Kinshasa'),
      installments_scanned: rows.length,
      eligible_invoices: items.filter((item) => item.eligible).length,
      existing_invoices: items.filter((item) => item.reasons.includes('facture active déjà présente')).length,
      missing_email: rows.filter((row: any) => !row.buyer_email).length,
      skipped: items.filter((item) => !item.eligible),
      items,
    };
  }

  private async buildReminderSnapshot(dto: SalesAutomationExecuteDto) {
    return this.buildReminderSnapshotForOrganization(this.context.organizationId(), dto);
  }

  private async buildReminderSnapshotForOrganization(organizationId: number, dto: SalesAutomationExecuteDto) {
    const settings = await this.repository.findSettings(organizationId);
    const asOfDate = dto.as_of_date ?? new Date().toISOString().slice(0, 10);
    const graceDays = Number(settings?.sales_overdue_grace_days ?? 0);
    const { rows } = await this.db.query(
      `SELECT
         si.id,
         si.subscription_id,
         si.invoice_number,
         si.status,
         si.due_date,
         si.total_amount,
         si.paid_amount,
         si.balance_due,
         si.currency,
         COALESCE(sb.full_name, sb.company_name) AS buyer_name,
         sb.email AS buyer_email
       FROM sales_invoices si
       JOIN sales_subscriptions ss
         ON ss.id = si.subscription_id
        AND ss.organization_id = si.organization_id
       LEFT JOIN sales_buyers sb
         ON sb.id = ss.buyer_id
        AND sb.organization_id = ss.organization_id
       WHERE si.organization_id = $1
         AND si.status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE')
         AND si.balance_due > 0
         AND si.due_date <= ($2::date + make_interval(days => $3::int))
       ORDER BY si.due_date ASC, si.id ASC`,
      [organizationId, asOfDate, graceDays],
    );

    const beforeDays = Array.isArray(settings?.sales_reminder_days_before) ? settings?.sales_reminder_days_before : [];
    const overdueDays = Array.isArray(settings?.sales_overdue_reminder_days) ? settings?.sales_overdue_reminder_days : [];

    const items = rows.map((row: any) => {
      const rawDueDate = row.due_date instanceof Date
        ? row.due_date
        : new Date(String(row.due_date));
      const dueDate = new Date(Date.UTC(
        rawDueDate.getUTCFullYear(),
        rawDueDate.getUTCMonth(),
        rawDueDate.getUTCDate(),
      ));
      const target = new Date(`${asOfDate}T00:00:00.000Z`);
      const delta = Math.round((dueDate.getTime() - target.getTime()) / 86400000);
      let reminder_type: string | null = null;
      if (delta > 0 && beforeDays.includes(delta)) reminder_type = 'UPCOMING_DUE';
      else if (delta === 0) reminder_type = 'DUE_TODAY';
      else if (delta < 0 && overdueDays.includes(Math.abs(delta))) reminder_type = Math.abs(delta) >= Math.max(...overdueDays, 0) ? 'FINAL_NOTICE' : 'OVERDUE';
      return {
        invoice_id: row.id,
        invoice_number: row.invoice_number,
        buyer_name: row.buyer_name,
        balance_due: row.balance_due,
        currency: row.currency,
        due_date: row.due_date,
        overdue_days: Math.max(0, -delta),
        reminder_type,
        can_send: Boolean(row.buyer_email) && Boolean(reminder_type),
      };
    }).filter((item) => Boolean(item.reminder_type));

    return {
      settings,
      timezone: String(settings?.sales_reminder_timezone ?? 'Africa/Kinshasa'),
      eligible_invoices: items.length,
      upcoming_reminders: items.filter((item) => item.reminder_type === 'UPCOMING_DUE' || item.reminder_type === 'DUE_TODAY').length,
      overdue_reminders: items.filter((item) => item.reminder_type === 'OVERDUE' || item.reminder_type === 'FINAL_NOTICE').length,
      missing_email: items.filter((item) => !item.can_send).length,
      skipped: items.filter((item) => !item.can_send),
      items,
    };
  }

  private resolvePeriodKey(automationType: string, asOfDate?: string) {
    const base = asOfDate ?? new Date().toISOString().slice(0, 10);
    return `${automationType}:${base}`;
  }

  private resolvePeriodKeyForOrganization(organizationId: number, automationType: string, localDate: string) {
    return `${organizationId}:${automationType}:${localDate}`;
  }

  private resolveCollectionDeliveryMode() {
    return String(
      this.config.get<string>('EMAIL_DELIVERY_MODE')
      || this.config.get<string>('EMAIL_DELIVERY_MODE_OVERRIDE')
      || 'DISABLED',
    ).toUpperCase();
  }

  private maskReminderRecipient(recipient: string | null) {
    const value = String(recipient ?? '').trim();
    if (!value) return 'Destinataire indisponible';
    if (value.includes('@')) {
      const [localPart, domainPart] = value.split('@');
      if (!localPart || !domainPart) return 'Destinataire indisponible';
      const localMask = `${localPart.slice(0, Math.min(localPart.length, 2))}***`;
      const domainSegments = domainPart.split('.');
      const domainName = domainSegments.shift() ?? '';
      const domainSuffix = domainSegments.join('.');
      const domainMask = `${domainName.slice(0, Math.min(domainName.length, 2))}***`;
      return `${localMask}@${domainSuffix ? `${domainMask}.${domainSuffix}` : domainMask}`;
    }
    const digits = value.replace(/\D/g, '');
    if (digits.length >= 6) {
      const prefix = digits.startsWith('243') ? '+243' : `+${digits.slice(0, 3)}`;
      const suffix = digits.slice(-3);
      const hidden = '*'.repeat(Math.max(digits.length - (prefix === '+243' ? 6 : 6), 4));
      return `${prefix}${hidden}${suffix}`;
    }
    return 'Destinataire indisponible';
  }

  private resolveReminderDeliveryOutcome(delivery: {
    deliveryMode?: string | null;
    logId?: number | null;
    logStatus?: string | null;
  }) {
    const logStatus = String(delivery.logStatus ?? '').toUpperCase();
    if (delivery.deliveryMode === 'DISABLED' || logStatus === 'SKIPPED') {
      return {
        status: 'SKIPPED',
        communicationLogId: delivery.logId ?? null,
        failureCode: null,
        failureMessage: null,
      };
    }
    if (logStatus === 'SENT' && delivery.logId) {
      return {
        status: 'SENT',
        communicationLogId: delivery.logId,
        failureCode: null,
        failureMessage: null,
      };
    }
    if (logStatus === 'FAILED') {
      return {
        status: 'FAILED',
        communicationLogId: delivery.logId ?? null,
        failureCode: 'REMINDER_COMMUNICATION_FAILED',
        failureMessage: 'Le journal de communication associé est en échec.',
      };
    }
    return {
      status: 'FAILED',
      communicationLogId: null,
      failureCode: 'COMMUNICATION_LOG_REQUIRED',
      failureMessage: 'Aucune communication liée n’a été enregistrée pour cette relance.',
    };
  }

  private resolveReminderFailureCode(error: unknown) {
    const message = String(error instanceof Error ? error.message : error ?? '');
    if (
      message.includes('Aucune configuration email')
      || message.includes('La clé API Resend est obligatoire')
    ) {
      return 'EMAIL_PROVIDER_NOT_CONFIGURED';
    }
    if (message.includes('EMAIL_TEST_RECIPIENT')) {
      return 'EMAIL_TEST_REDIRECT_NOT_CONFIGURED';
    }
    return 'REMINDER_DELIVERY_FAILED';
  }

  private async runScheduledInstallmentsForOrganization(
    organizationId: number,
    settings: any,
    clock: any,
    options: {
      executionMode: 'AUTOMATIC' | 'MANUAL';
      actorUserId: number | null;
      force?: boolean;
      throwOnLocked?: boolean;
    } = {
      executionMode: 'AUTOMATIC',
      actorUserId: null,
    },
  ) {
    const snapshot = await this.buildInstallmentSnapshotForOrganization(organizationId, { as_of_date: clock.localDate, execution_mode: 'AUTOMATIC' });
    const periodKey = this.resolvePeriodKeyForOrganization(organizationId, 'INSTALLMENT_INVOICING', clock.localDate);

    return this.db.transaction(async (client) => {
      const locked = await this.repository.tryAcquireAutomationLock(organizationId, 'INSTALLMENT_INVOICING', periodKey, client);
      if (!locked) {
        if (options.throwOnLocked) {
          throw new BadRequestException('Une exécution de génération des échéances est déjà en cours pour cette période.');
        }
        this.logger.debug(`[SALES_AUTOMATION] organization=${organizationId} type=INSTALLMENT_INVOICING lock=busy period_key=${periodKey}`);
        return null;
      }
      let run: any = null;
      try {
        run = await this.prepareAutomationRun(organizationId, 'INSTALLMENT_INVOICING', periodKey, options.executionMode, snapshot, client, {
          timezone: clock.timezone,
          execution_time: clock.executionTime,
          logical_date: clock.localDate,
        }, {
          force: Boolean(options.force),
          triggeredBy: options.actorUserId,
        });
        if (!run) {
          return null;
        }
        let processedCount = 0;
        let createdCount = 0;
        let sentCount = 0;
        let skippedCount = Array.isArray(snapshot.skipped) ? snapshot.skipped.length : 0;
        let failedCount = 0;

        for (const item of snapshot.items.filter((entry: any) => entry.eligible)) {
          await this.repository.touchAutomationRunHeartbeat(Number(run.id), client);
          processedCount += 1;
          const lockedInstallment = await this.repository.lockInstallmentForAutomation(organizationId, Number(item.installment_id), client);
          if (!lockedInstallment) {
            skippedCount += 1;
            continue;
          }
          const paidAmount = Number(lockedInstallment.paid_amount ?? 0);
          const amount = Number(lockedInstallment.amount ?? 0);
          if (!['SUBMITTED', 'APPROVED', 'CONVERTED'].includes(String(lockedInstallment.subscription_status ?? ''))) {
            skippedCount += 1;
            continue;
          }
          if (amount <= 0 || paidAmount >= amount || lockedInstallment.invoice_id) {
            skippedCount += 1;
            continue;
          }

          const invoice = await this.financials.generateInvoiceForAutomation(
            organizationId,
            Number(lockedInstallment.subscription_id),
            Number(lockedInstallment.installment_id),
            options.actorUserId,
            client,
          );
          createdCount += 1;

          if (Boolean(settings.sales_auto_issue_invoice)) {
            await this.financials.issueInvoiceForAutomation(organizationId, Number(invoice.id), options.actorUserId, client);
          }
          if (Boolean(settings.sales_auto_send_invoice)) {
            await this.financials.sendInvoiceForAutomation(organizationId, Number(invoice.id), options.actorUserId, client);
            sentCount += 1;
          }
        }

        await this.repository.updateAutomationRun(Number(run.id), {
          status: failedCount > 0 ? (createdCount > 0 || skippedCount > 0 ? 'PARTIAL' : 'FAILED') : 'SUCCESS',
          complete: true,
          eligible_count: snapshot.eligible_invoices,
          processed_count: processedCount,
          created_count: createdCount,
          sent_count: sentCount,
          skipped_count: skippedCount,
          failed_count: failedCount,
          metadata: {
            timezone: clock.timezone,
            execution_time: clock.executionTime,
            logical_date: clock.localDate,
            automation_enabled: Boolean(settings.sales_installment_automation_enabled),
          },
        }, client);
        return { run };
      } catch (error) {
        if (run?.id) {
          await this.repository.updateAutomationRun(Number(run.id), {
            status: 'FAILED',
            complete: true,
            error_summary: error instanceof Error ? error.message : String(error),
          }, client);
        }
        throw error;
      }
    });
  }

  private async runScheduledRemindersForOrganization(
    organizationId: number,
    settings: any,
    clock: any,
    options: {
      executionMode: 'AUTOMATIC' | 'MANUAL';
      actorUserId: number | null;
      force?: boolean;
      throwOnLocked?: boolean;
    } = {
      executionMode: 'AUTOMATIC',
      actorUserId: null,
    },
  ) {
    const snapshot = await this.buildReminderSnapshotForOrganization(organizationId, { as_of_date: clock.localDate, execution_mode: 'AUTOMATIC' });
    const periodKey = this.resolvePeriodKeyForOrganization(organizationId, 'INVOICE_REMINDERS', clock.localDate);

    return this.db.transaction(async (client) => {
      const locked = await this.repository.tryAcquireAutomationLock(organizationId, 'INVOICE_REMINDERS', periodKey, client);
      if (!locked) {
        if (options.throwOnLocked) {
          throw new BadRequestException('Une exécution de relances est déjà en cours pour cette période.');
        }
        this.logger.debug(`[SALES_AUTOMATION] organization=${organizationId} type=INVOICE_REMINDERS lock=busy period_key=${periodKey}`);
        return null;
      }
      let run: any = null;
      try {
        run = await this.prepareAutomationRun(organizationId, 'INVOICE_REMINDERS', periodKey, options.executionMode, snapshot, client, {
          timezone: clock.timezone,
          execution_time: clock.executionTime,
          logical_date: clock.localDate,
        }, {
          force: Boolean(options.force),
          triggeredBy: options.actorUserId,
        });
        if (!run) {
          return null;
        }

        let processedCount = 0;
        let createdCount = 0;
        let sentCount = 0;
        let skippedCount = Array.isArray(snapshot.skipped) ? snapshot.skipped.length : 0;
        let failedCount = 0;
        const deliveryMode = this.resolveCollectionDeliveryMode();
        const cooldownHours = Number(settings.sales_reminder_cooldown_hours ?? 24);
        const maxReminders = Number(settings.sales_max_reminders_per_invoice ?? 6);

        for (const item of snapshot.items.filter((entry: any) => entry.can_send)) {
          await this.repository.touchAutomationRunHeartbeat(Number(run.id), client);
          processedCount += 1;
          const invoice = await this.repository.lockInvoiceForReminderAutomation(organizationId, Number(item.invoice_id), client);
          if (!invoice) {
            skippedCount += 1;
            continue;
          }
          if (['PAID', 'CANCELLED'].includes(String(invoice.status ?? '')) || Number(invoice.balance_due ?? 0) <= 0) {
            skippedCount += 1;
            continue;
          }

          const stats = await this.repository.listReminderStatsForInvoice(organizationId, Number(invoice.id), client);
          const reminderCount = Number(stats?.reminder_count ?? 0);
          if (!options.force && reminderCount >= maxReminders) {
            skippedCount += 1;
            continue;
          }
          const lastDeliveryAt = stats?.last_delivery_at ? new Date(stats.last_delivery_at).getTime() : NaN;
          if (!options.force && Number.isFinite(lastDeliveryAt) && (Date.now() - lastDeliveryAt) < cooldownHours * 3600000) {
            skippedCount += 1;
            continue;
          }
          const idempotencyKey = [organizationId, invoice.id, item.reminder_type, clock.localDate, 'EMAIL'].join(':');
          const existing = await this.repository.findReminderByIdempotencyKey(organizationId, idempotencyKey, client);
          if (existing && !(options.force && String(existing.status).toUpperCase() === 'FAILED')) {
            skippedCount += 1;
            continue;
          }

          const reminder = await this.repository.createInvoiceReminder(organizationId, {
            invoice_id: invoice.id,
            subscription_id: invoice.subscription_id,
            buyer_id: null,
            reminder_type: item.reminder_type,
            reminder_stage: item.overdue_days > 0 ? 'AUTOMATIC_OVERDUE' : 'AUTOMATIC_UPCOMING',
            scheduled_for: new Date().toISOString(),
            sent_at: deliveryMode === 'DISABLED' ? null : null,
            status: deliveryMode === 'DISABLED' ? 'SKIPPED' : 'PENDING',
            channel: 'EMAIL',
            recipient: invoice.buyer_email ? '[masked]' : null,
            communication_log_id: null,
            idempotency_key: idempotencyKey,
            metadata: {
              delivery_mode: deliveryMode,
              invoice_number: invoice.invoice_number,
              logical_date: clock.localDate,
              timezone: clock.timezone,
            },
          }, client);
          createdCount += 1;
          try {
            const delivery = await this.financials.sendInvoiceReminderForAutomation(
              organizationId,
              Number(invoice.id),
              options.actorUserId,
              client,
              {
                reminderType: String(item.reminder_type),
                reminderStage: item.overdue_days > 0 ? 'AUTOMATIC_OVERDUE' : 'AUTOMATIC_UPCOMING',
                idempotencyKey,
              },
            );
            const outcome = this.resolveReminderDeliveryOutcome(delivery);
            await client.query(
              `UPDATE sales_invoice_reminders
               SET status = $3,
                   sent_at = CASE WHEN $3 IN ('SENT', 'SKIPPED') THEN NOW() ELSE sent_at END,
                   recipient = COALESCE($4, recipient),
                   communication_log_id = $5,
                   failure_code = $6,
                   failure_message = $7,
                   updated_at = NOW()
               WHERE organization_id = $1 AND id = $2`,
              [
                organizationId,
                reminder.id,
                outcome.status,
                delivery.recipient ?? null,
                outcome.communicationLogId,
                outcome.failureCode,
                outcome.failureMessage,
              ],
            );
            if (outcome.status === 'SENT') {
              sentCount += 1;
            } else if (outcome.status === 'FAILED') {
              failedCount += 1;
            }
          } catch (error) {
            failedCount += 1;
            await client.query(
              `UPDATE sales_invoice_reminders
               SET status = 'FAILED',
                   failure_code = $3,
                   failure_message = $4,
                   updated_at = NOW()
               WHERE organization_id = $1 AND id = $2`,
              [
                organizationId,
                reminder.id,
                this.resolveReminderFailureCode(error),
                error instanceof Error ? error.message : String(error),
              ],
            );
          }
        }

        await this.repository.updateAutomationRun(Number(run.id), {
          status: failedCount > 0 ? (createdCount > 0 || skippedCount > 0 ? 'PARTIAL' : 'FAILED') : 'SUCCESS',
          complete: true,
          eligible_count: snapshot.eligible_invoices,
          processed_count: processedCount,
          created_count: createdCount,
          sent_count: sentCount,
          skipped_count: skippedCount,
          failed_count: failedCount,
          metadata: {
            timezone: clock.timezone,
            execution_time: clock.executionTime,
            logical_date: clock.localDate,
            delivery_mode: deliveryMode,
          },
        }, client);
        return { run };
      } catch (error) {
        if (run?.id) {
          await this.repository.updateAutomationRun(Number(run.id), {
            status: 'FAILED',
            complete: true,
            error_summary: error instanceof Error ? error.message : String(error),
          }, client);
        }
        throw error;
      }
    });
  }

  private async prepareAutomationRun(
    organizationId: number,
    automationType: string,
    periodKey: string,
    executionMode: 'AUTOMATIC' | 'MANUAL',
    snapshot: any,
    client: any,
    metadata: Record<string, unknown>,
    options: {
      force?: boolean;
      triggeredBy?: number | null;
    } = {},
  ) {
    const latest = await this.repository.findLatestAutomationRun(organizationId, automationType, periodKey, client);
    const gate = this.resolveRunGate(latest, Boolean(options.force));
    if (gate === 'BLOCKED_RUNNING' || gate === 'BLOCKED_SUCCESS') {
      return null;
    }
    if (latest && gate === 'RESUME_STALE') {
      return this.repository.updateAutomationRun(Number(latest.id), {
        status: 'RUNNING',
        eligible_count: snapshot.eligible_invoices ?? 0,
        processed_count: 0,
        created_count: 0,
        sent_count: 0,
        skipped_count: Array.isArray(snapshot.skipped) ? snapshot.skipped.length : 0,
        failed_count: 0,
        error_summary: null,
        metadata: {
          ...metadata,
          resumed_from_stale_run: true,
        },
      }, client);
    }
    return this.repository.createAutomationRun(organizationId, {
      automation_type: automationType,
      period_key: periodKey,
      status: 'RUNNING',
      execution_mode: executionMode,
      eligible_count: snapshot.eligible_invoices ?? 0,
      processed_count: 0,
      created_count: 0,
      sent_count: 0,
      skipped_count: Array.isArray(snapshot.skipped) ? snapshot.skipped.length : 0,
      failed_count: 0,
      metadata,
      triggered_by: options.triggeredBy ?? null,
    }, client);
  }

  private resolveRunGate(run: any, force = false) {
    if (!run) return 'CREATE';
    const status = String(run.status ?? '').toUpperCase();
    if (status === 'RUNNING') {
      return this.isRecentHeartbeat(run.heartbeat_at ?? run.started_at) ? 'BLOCKED_RUNNING' : 'RESUME_STALE';
    }
    if (status === 'SUCCESS') {
      return force ? 'RETRY' : 'BLOCKED_SUCCESS';
    }
    if (status === 'FAILED' || status === 'PARTIAL') {
      return 'RETRY';
    }
    return 'CREATE';
  }

  private isRecentHeartbeat(value: string | null | undefined) {
    if (!value) return false;
    const startedAt = new Date(value).getTime();
    if (Number.isNaN(startedAt)) return false;
    return Date.now() - startedAt < 30 * 60 * 1000;
  }

  private resolveOrganizationClock(organizationId: number, timezoneValue: string, executionTimeValue: string, now: Date) {
    const timezone = this.normalizeSchedulerTimezone(timezoneValue);
    const executionTime = this.normalizeSchedulerExecutionTime(executionTimeValue);
    try {
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      });
      const parts = Object.fromEntries(
        formatter
          .formatToParts(now)
          .filter((part) => part.type !== 'literal')
          .map((part) => [part.type, part.value]),
      );
      return {
        organizationId,
        timezone,
        executionTime,
        localDate: `${parts.year}-${parts.month}-${parts.day}`,
        localTime: `${parts.hour}:${parts.minute}`,
      };
    } catch (error) {
      this.logger.error(`[SALES_AUTOMATION] organization=${organizationId} code=INVALID_TIMEZONE timezone=${timezone}`);
      throw error;
    }
  }

  private normalizeSchedulerTimezone(value: string) {
    const timezone = String(value ?? '').trim() || 'Africa/Kinshasa';
    try {
      new Intl.DateTimeFormat('fr-FR', { timeZone: timezone }).format(new Date());
      return timezone;
    } catch {
      throw new BadRequestException(`INVALID_TIMEZONE:${timezone}`);
    }
  }

  private normalizeSchedulerExecutionTime(value: string) {
    const text = String(value ?? '').trim() || '09:00';
    return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : '09:00';
  }

  private buildManualClock(organizationId: number, settings: any, asOfDate?: string) {
    const timezone = this.normalizeSchedulerTimezone(String(settings?.sales_reminder_timezone ?? 'Africa/Kinshasa'));
    const executionTime = this.normalizeSchedulerExecutionTime(String(settings?.sales_reminder_execution_time ?? '09:00'));
    const logicalDate = asOfDate ?? new Date().toISOString().slice(0, 10);
    return {
      organizationId,
      timezone,
      executionTime,
      localDate: logicalDate,
      localTime: executionTime,
    };
  }

  private normalizeExecutionMode(value: string | null | undefined): 'AUTOMATIC' | 'MANUAL' {
    return String(value ?? '').toUpperCase() === 'AUTOMATIC' ? 'AUTOMATIC' : 'MANUAL';
  }

  private shouldRunAtLocalTime(localTime: string, executionTime: string) {
    return localTime >= executionTime;
  }
}
