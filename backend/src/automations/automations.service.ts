import { BadRequestException, forwardRef, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PoolClient } from 'pg';
import { RequestContext } from '../auth/request-context';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { SaasService } from '../saas/saas.service';
import {
  calculateInitialBillingCycle,
  calculateNextFullBillingPeriod,
  daysInMonth as billingDaysInMonth,
  normalizeBillingFrequency,
  parseDate,
} from '../utils/billing-period';

type MonthlyRentBillingSettingRecord = {
  id: number;
  organization_id: number;
  automation_code: string;
  is_enabled: boolean;
  execution_time: string;
  timezone: string;
  due_day: number;
  email_enabled: boolean;
  whatsapp_enabled: boolean;
  updated_at?: string;
  updated_by?: number | null;
};

type BillingPeriod = {
  month: number;
  year: number;
  issueDate: string;
  dueDate: string;
  periodStart: string;
  periodEnd: string;
  frequencyMonths: number;
};

type RecurringAmountSummary = {
  amount: number;
};

type EligibleLease = {
  id: number;
  lease_number?: number | null;
  tenant_id: number;
  unit_id: number;
  building_id: number;
  monthly_rent: number;
  maintenance_fee_amount: number;
  monthly_syndic_amount: number;
  billing_frequency_months?: number | null;
  status: string;
  start_date: string;
  end_date?: string | null;
  last_rent_period_start?: string | null;
  last_rent_period_end?: string | null;
  last_rent_billing_month?: number | null;
  last_rent_billing_year?: number | null;
  tenant_name: string;
  tenant_email?: string | null;
  tenant_phone?: string | null;
  building_name?: string | null;
  unit_number?: string | null;
};

type AutomationRunRow = {
  id: number;
  organization_id: number;
  automation_code: string;
  execution_mode: 'AUTOMATIC' | 'MANUAL';
  billing_month: number;
  billing_year: number;
  started_at: string;
  completed_at?: string | null;
  status: string;
  eligible_count: number;
  created_count: number;
  skipped_count: number;
  failed_count: number;
  error_summary?: string | null;
  triggered_by?: number | null;
  created_at: string;
};

@Injectable()
export class AutomationsService {
  private readonly logger = new Logger(AutomationsService.name);
  private readonly automationCode = 'MONTHLY_RENT_BILLING';
  private readonly generationDay = 25;
  private readonly automaticDueDay = 5;

  constructor(
    private readonly db: DatabaseService,
    private readonly context: RequestContext,
    @Inject(forwardRef(() => SaasService))
    private readonly saasService: SaasService,
    private readonly emailService: EmailService,
  ) {}

  @Cron('0 * * 25 * *', { timeZone: 'Africa/Kinshasa' })
  async executeScheduledAutomations() {
    const now = new Date();
    const { rows } = await this.db.query<MonthlyRentBillingSettingRecord>(
      `SELECT *
       FROM automation_settings
       WHERE automation_code = $1
         AND is_enabled = TRUE
         AND deleted_at IS NULL`,
      [this.automationCode],
    );

    for (const setting of rows) {
      try {
        if (!this.shouldRunAt(setting, now)) {
          continue;
        }

        const period = this.periodFromDateInTimeZone(now, setting.timezone);
        const alreadyRan = await this.hasAutomaticRunForPeriod(setting.organization_id, period.month, period.year);
        if (alreadyRan) {
          continue;
        }

        await this.runMonthlyRentBillingForOrganization(setting.organization_id, {
          mode: 'AUTOMATIC',
          billingMonth: period.month,
          billingYear: period.year,
          triggeredBy: null,
        });
      } catch (error) {
        this.logger.error(
          `Monthly rent billing scheduler failed for organization ${setting.organization_id}: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }
  }

  async listAutomations() {
    const setting = await this.getMonthlyRentBillingSetting();
    return [setting];
  }

  async getMonthlyRentBillingSetting() {
    const row = await this.ensureSetting(this.context.organizationId());
    const lastRun = await this.latestRunForOrganization(this.context.organizationId());
    return this.presentSetting(row, lastRun);
  }

  async updateMonthlyRentBillingSetting(body: Record<string, unknown>) {
    const organizationId = this.context.organizationId();
    await this.ensureSetting(organizationId);
    const executionTime = body.execution_time === undefined ? undefined : this.normalizeExecutionTime(body.execution_time);
    const timezone = body.timezone === undefined ? undefined : this.normalizeTimezone(body.timezone);
    const payload = {
      is_enabled: body.is_enabled === undefined ? undefined : Boolean(body.is_enabled),
      execution_time: executionTime,
      timezone,
      email_enabled: body.email_enabled === undefined ? undefined : Boolean(body.email_enabled),
      whatsapp_enabled: body.whatsapp_enabled === undefined ? undefined : Boolean(body.whatsapp_enabled),
      updated_by: this.context.userId() ?? 1,
    };
    const columns = Object.entries(payload).filter(([, value]) => value !== undefined);
    if (!columns.length) {
      return this.getMonthlyRentBillingSetting();
    }

    const assignments = columns.map(([key], index) => `${key} = $${index + 2}`);
    const values = columns.map(([, value]) => value);
    const { rows } = await this.db.query<MonthlyRentBillingSettingRecord>(
      `UPDATE automation_settings
       SET ${assignments.join(', ')},
           updated_at = NOW()
       WHERE organization_id = $1
         AND automation_code = $${values.length + 2}
         AND deleted_at IS NULL
       RETURNING *`,
      [organizationId, ...values, this.automationCode],
    );
    const lastRun = await this.latestRunForOrganization(organizationId);
    return this.presentSetting(rows[0], lastRun);
  }

  async listRuns(filters: { automationCode?: string; limit?: number; executionMode?: 'AUTOMATIC' | 'MANUAL' }) {
    const organizationId = this.context.organizationId();
    const params: unknown[] = [organizationId];
    const where = ['organization_id = $1', 'deleted_at IS NULL'];
    if (filters.automationCode) {
      params.push(filters.automationCode);
      where.push(`automation_code = $${params.length}`);
    }
    if (filters.executionMode) {
      params.push(filters.executionMode);
      where.push(`execution_mode = $${params.length}`);
    }
    params.push(Math.min(Math.max(Number(filters.limit ?? 20), 1), 100));
    const { rows } = await this.db.query(
      `SELECT *
       FROM automation_runs
       WHERE ${where.join(' AND ')}
       ORDER BY started_at DESC, id DESC
       LIMIT $${params.length}`,
      params,
    );
    return rows;
  }

  async getRun(id: number) {
    const organizationId = this.context.organizationId();
    const { rows } = await this.db.query<AutomationRunRow>(
      `SELECT *
       FROM automation_runs
       WHERE id = $1
         AND organization_id = $2
         AND deleted_at IS NULL`,
      [id, organizationId],
    );
    const run = rows[0];
    if (!run) {
      throw new NotFoundException('Execution introuvable');
    }
    const items = await this.db.query(
      `SELECT *
       FROM automation_run_items
       WHERE automation_run_id = $1
       ORDER BY id`,
      [id],
    );
    return { ...run, items: items.rows };
  }

  async previewMonthlyRentBilling(body: { month?: number; year?: number }) {
    const organizationId = this.context.organizationId();
    const setting = await this.ensureSetting(organizationId);
    const period = this.periodFromInput(body.month, body.year);
    const leases = await this.fetchLeaseCandidates(organizationId);
    const skipped: Array<Record<string, unknown>> = [];
    const createable: Array<Record<string, unknown>> = [];
    const existingInvoices: Array<Record<string, unknown>> = [];
    let eligibleCount = 0;

    for (const lease of leases) {
      const exclusionReason = this.leaseExclusionReason(lease, period, this.todayInTimeZone(setting.timezone));
      if (exclusionReason) {
        skipped.push({
          lease_id: lease.id,
          lease_reference: this.leaseReference(lease),
          tenant_name: lease.tenant_name,
          unit_number: lease.unit_number,
          reason: exclusionReason,
        });
        continue;
      }
      const leasePeriod = this.nextBillingPeriodForLease(period, lease);
      if (!leasePeriod) {
        skipped.push({
          lease_id: lease.id,
          lease_reference: this.leaseReference(lease),
          tenant_name: lease.tenant_name,
          unit_number: lease.unit_number,
          reason: 'OUTSIDE_BILLING_FREQUENCY',
        });
        continue;
      }
      eligibleCount += 1;
      const existing = await this.findExistingRentInvoice(organizationId, lease.id, leasePeriod);
      if (existing) {
        existingInvoices.push({
          lease_id: lease.id,
          lease_reference: this.leaseReference(lease),
          invoice_id: existing.id,
          invoice_number: existing.invoice_number,
          tenant_name: lease.tenant_name,
          unit_number: lease.unit_number,
          building_name: lease.building_name,
        });
        skipped.push({
          lease_id: lease.id,
          lease_reference: this.leaseReference(lease),
          tenant_name: lease.tenant_name,
          unit_number: lease.unit_number,
          reason: 'ALREADY_BILLED',
        });
        continue;
      }

      const amounts = this.recurringAmountsForPeriod(lease, leasePeriod);
      createable.push({
        lease_id: lease.id,
        lease_reference: this.leaseReference(lease),
        tenant_name: lease.tenant_name,
        unit_number: lease.unit_number,
        building_name: lease.building_name,
        monthly_rent: amounts.rent.amount,
        monthly_syndic_amount: amounts.syndic.amount,
        total_amount: amounts.total,
        billing_frequency_months: leasePeriod.frequencyMonths,
        period_start: leasePeriod.periodStart,
        period_end: leasePeriod.periodEnd,
        email_status: lease.tenant_email ? (setting.email_enabled ? 'READY' : 'DISABLED') : 'EMAIL_MISSING',
        whatsapp_status: lease.tenant_phone ? (setting.whatsapp_enabled ? 'READY' : 'DISABLED') : 'PHONE_MISSING',
      });
    }

    return {
      automation_code: this.automationCode,
      billing_month: period.month,
      billing_year: period.year,
      issue_date: period.issueDate,
      due_date: period.dueDate,
      period_start: period.periodStart,
      period_end: period.periodEnd,
      eligible_count: eligibleCount,
      existing_count: existingInvoices.length,
      create_count: createable.length,
      skipped_count: skipped.length,
      settings: this.presentSetting(setting, await this.latestRunForOrganization(organizationId)),
      createable,
      existing_invoices: existingInvoices,
      skipped,
    };
  }

  async runMonthlyRentBillingManually(body: { month?: number; year?: number }) {
    const setting = await this.ensureSetting(this.context.organizationId());
    const period = this.periodFromInput(body.month, body.year);
    return this.runMonthlyRentBillingForOrganization(this.context.organizationId(), {
      mode: 'MANUAL',
      billingMonth: period.month,
      billingYear: period.year,
      triggeredBy: this.context.userId() ?? 1,
    });
  }

  async generateImmediateInitialRentInvoiceForLease(leaseId: number) {
    const organizationId = this.context.organizationId();
    const setting = await this.ensureSetting(organizationId);
    if (!setting.is_enabled) {
      return { status: 'SKIPPED', reason: 'AUTOMATION_DISABLED' };
    }

    const today = this.todayInTimeZone(setting.timezone);
    const period = this.buildBillingPeriod(this.yearFromDate(today), this.monthFromDate(today));
    const lease = await this.fetchLeaseCandidateById(organizationId, leaseId);
    if (!lease) {
      return { status: 'SKIPPED', reason: 'LEASE_NOT_FOUND' };
    }

    const exclusionReason = this.leaseExclusionReason(lease, period, today);
    if (exclusionReason) {
      return { status: 'SKIPPED', reason: exclusionReason };
    }
    if (lease.last_rent_period_end || lease.last_rent_billing_month || lease.last_rent_billing_year) {
      return { status: 'SKIPPED', reason: 'RENT_INVOICE_ALREADY_EXISTS' };
    }

    const startDate = this.dateOnly(lease.start_date);
    if (!startDate || startDate > today) {
      return { status: 'SKIPPED', reason: 'START_DATE_NOT_REACHED' };
    }
    const todayDay = this.dayFromDate(today);
    const startDay = this.dayFromDate(startDate);
    const missedCycle = startDate < period.periodStart || todayDay > this.generationDay;
    if (startDay <= this.generationDay && !missedCycle) {
      return { status: 'SKIPPED', reason: 'WAITING_FOR_MONTHLY_CRON' };
    }

    const leasePeriod = this.nextBillingPeriodForLease(period, lease);
    if (!leasePeriod) {
      return { status: 'SKIPPED', reason: 'OUTSIDE_BILLING_FREQUENCY' };
    }
    const existing = await this.findExistingRentInvoice(organizationId, lease.id, leasePeriod);
    if (existing) {
      return { status: 'SKIPPED', reason: 'ALREADY_BILLED', invoice_id: existing.id, invoice_number: existing.invoice_number };
    }

    const companySettings = await this.companySettingsForOrganization(organizationId);
    const actorId = await this.resolveActorId(organizationId, this.context.userId() ?? null);
    const invoice = await this.createRentInvoice({
      organizationId,
      lease,
      period,
      runId: null,
      createdBy: actorId,
      invoiceBottomText: String(companySettings.invoice_bottom_text ?? '').trim() || null,
      generationSource: 'LEASE_ACTIVATION_RENT_BILLING',
      asOfDate: today,
    });
    const amounts = this.recurringAmountsForPeriod(lease, leasePeriod);
    const communicationStatuses = await this.handleInvoiceCommunications({
      organizationId,
      invoiceId: Number(invoice.id),
      invoiceNumber: String(invoice.invoice_number),
      issueDate: String(invoice.issue_date),
      tenantName: String(lease.tenant_name || 'Locataire'),
      tenantEmail: lease.tenant_email ?? null,
      tenantPhone: lease.tenant_phone ?? null,
      unitNumber: lease.unit_number ?? null,
      buildingName: lease.building_name ?? null,
      dueDate: String(invoice.due_date),
      rentAmount: amounts.rent.amount,
      syndicAmount: amounts.syndic.amount,
      totalAmount: Number(invoice.total ?? 0),
      emailEnabled: setting.email_enabled,
      whatsappEnabled: setting.whatsapp_enabled,
      createdBy: actorId,
      companyName: this.companyDisplayName(companySettings),
      periodLabel: this.periodLabelForRange(leasePeriod),
    });
    await this.updateInvoiceCommunicationStatuses(Number(invoice.id), organizationId, communicationStatuses);

    return {
      status: 'SUCCESS',
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
      period_start: leasePeriod.periodStart,
      period_end: leasePeriod.periodEnd,
    };
  }

  private async runMonthlyRentBillingForOrganization(
    organizationId: number,
    options: { mode: 'AUTOMATIC' | 'MANUAL'; billingMonth: number; billingYear: number; triggeredBy: number | null },
  ) {
    const setting = await this.ensureSetting(organizationId);
    const period = this.periodFromInput(options.billingMonth, options.billingYear);
    const companySettings = await this.companySettingsForOrganization(organizationId);
    const actorId = await this.resolveActorId(organizationId, options.triggeredBy);

    if (options.mode === 'AUTOMATIC' && !setting.is_enabled) {
      return {
        automation_code: this.automationCode,
        status: 'SKIPPED',
        reason: 'AUTOMATION_DISABLED',
      };
    }

    const reserved = await this.reserveRun({
      organizationId,
      executionMode: options.mode,
      billingMonth: period.month,
      billingYear: period.year,
      triggeredBy: options.triggeredBy,
    });
    if (!reserved.run) {
      return {
        automation_code: this.automationCode,
        status: 'SKIPPED',
        reason: reserved.reason,
        period,
        running_run_id: reserved.runningRunId ?? null,
      };
    }
    const run = reserved.run;

    const asOfDate = period.issueDate;
    const leases = await this.fetchEligibleLeases(organizationId, period, asOfDate);
    const runItems: Array<{ entityId: number; status: string; message: string; reference?: string | null }> = [];
    let createdCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (const lease of leases) {
      try {
        const leasePeriod = this.nextBillingPeriodForLease(period, lease);
        if (!leasePeriod) {
          skippedCount += 1;
          runItems.push({
            entityId: lease.id,
            status: 'SKIPPED',
            message: 'Bail hors cycle de facturation',
            reference: this.leaseReference(lease),
          });
          continue;
        }
        const existing = await this.findExistingRentInvoice(organizationId, lease.id, leasePeriod);
        if (existing) {
          skippedCount += 1;
          runItems.push({
            entityId: lease.id,
            status: 'SKIPPED',
            message: 'Facture deja existante pour cette periode',
            reference: existing.invoice_number,
          });
          continue;
        }

        const invoice = await this.createRentInvoice({
          organizationId,
          lease,
          period,
          runId: run.id,
          createdBy: actorId,
          invoiceBottomText: String(companySettings.invoice_bottom_text ?? '').trim() || null,
          generationSource: 'MONTH_END_RENT_BILLING',
          asOfDate,
        });
        const amounts = this.recurringAmountsForPeriod(lease, leasePeriod);

        const communicationStatuses = await this.handleInvoiceCommunications({
          organizationId,
          invoiceId: Number(invoice.id),
          invoiceNumber: String(invoice.invoice_number),
          issueDate: String(invoice.issue_date),
          tenantName: String(lease.tenant_name || 'Locataire'),
          tenantEmail: lease.tenant_email ?? null,
          tenantPhone: lease.tenant_phone ?? null,
          unitNumber: lease.unit_number ?? null,
          buildingName: lease.building_name ?? null,
          dueDate: String(invoice.due_date),
          rentAmount: amounts.rent.amount,
          syndicAmount: amounts.syndic.amount,
          totalAmount: Number(invoice.total ?? 0),
          emailEnabled: setting.email_enabled,
          whatsappEnabled: setting.whatsapp_enabled,
          createdBy: actorId,
          companyName: this.companyDisplayName(companySettings),
          periodLabel: this.periodLabelForRange(leasePeriod),
        });

        await this.updateInvoiceCommunicationStatuses(Number(invoice.id), organizationId, communicationStatuses);

        createdCount += 1;
        runItems.push({
          entityId: lease.id,
          status: 'SUCCESS',
          message: `Facture creee (${communicationStatuses.email.status} email / ${communicationStatuses.whatsapp.status} WhatsApp)`,
          reference: String(invoice.invoice_number),
        });
      } catch (error) {
        failedCount += 1;
        runItems.push({
          entityId: lease.id,
          status: 'FAILED',
          message: error instanceof Error ? error.message : String(error),
          reference: this.leaseReference(lease),
        });
      }
    }

    for (const item of runItems) {
      await this.db.query(
        `INSERT INTO automation_run_items (automation_run_id, entity_type, entity_id, status, message, reference)
         VALUES ($1, 'LEASE', $2, $3, $4, $5)`,
        [run.id, item.entityId, item.status, item.message, item.reference ?? null],
      );
    }

    const status = this.runStatus(leases.length, createdCount, skippedCount, failedCount);
    const errorSummary = failedCount
      ? runItems
          .filter((item) => item.status === 'FAILED')
          .slice(0, 5)
          .map((item) => `${item.reference ?? this.leaseReference({ id: item.entityId })}: ${item.message}`)
          .join(' | ')
      : null;

    const { rows } = await this.db.query<AutomationRunRow>(
      `UPDATE automation_runs
       SET completed_at = NOW(),
           status = $2,
           eligible_count = $3,
           created_count = $4,
           skipped_count = $5,
           failed_count = $6,
           error_summary = $7
       WHERE id = $1
       RETURNING *`,
      [run.id, status, leases.length, createdCount, skippedCount, failedCount, errorSummary],
    );

    return {
      ...rows[0],
      items: runItems,
      period,
    };
  }

  private async createRentInvoice(args: {
    organizationId: number;
    lease: EligibleLease;
    period: BillingPeriod;
    runId: number | null;
    createdBy: number;
    invoiceBottomText: string | null;
    generationSource?: string;
    asOfDate?: string;
  }) {
    return this.db.transaction(async (client) => {
      const lockedLease = await client.query<EligibleLease>(
        `SELECT l.id, l.tenant_id, l.unit_id, u.building_id, l.monthly_rent, l.maintenance_fee_amount, l.monthly_syndic_amount,
                COALESCE(l.billing_frequency_months, 1) AS billing_frequency_months,
                l.status, l.start_date, l.end_date,
                last_invoice.period_start AS last_rent_period_start,
                last_invoice.period_end AS last_rent_period_end,
                last_invoice.billing_month AS last_rent_billing_month,
                last_invoice.billing_year AS last_rent_billing_year
         FROM leases l
         JOIN units u ON u.id = l.unit_id
         LEFT JOIN LATERAL (
           SELECT i.period_start, i.period_end, i.billing_month, i.billing_year
           FROM invoices i
           WHERE i.organization_id = l.organization_id
             AND i.lease_id = l.id
             AND i.invoice_type = 'RENT'
             AND i.deleted_at IS NULL
           ORDER BY COALESCE(i.period_end, (MAKE_DATE(i.billing_year, i.billing_month, 1) + INTERVAL '1 month' - INTERVAL '1 day')::DATE) DESC, i.id DESC
           LIMIT 1
         ) last_invoice ON TRUE
         WHERE l.id = $1
           AND l.organization_id = $2
           AND l.deleted_at IS NULL
         FOR UPDATE`,
        [args.lease.id, args.organizationId],
      );
      const lease = lockedLease.rows[0];
      if (!lease) {
        throw new NotFoundException('Bail introuvable');
      }
      if (!this.isLeaseEligible(lease, args.period, args.asOfDate ?? args.period.issueDate)) {
        throw new BadRequestException('Bail non eligible pour cette periode');
      }
      const leasePeriod = this.nextBillingPeriodForLease(args.period, lease);
      if (!leasePeriod) {
        throw new BadRequestException('Bail hors cycle de facturation');
      }
      await this.assertNoDuplicateRentInvoice(client, args.organizationId, args.lease.id, leasePeriod);

      const nextId = await this.nextInvoiceId(client);
      const invoiceNumber = await this.nextInvoiceNumber(client, args.period.year);
      const amounts = this.recurringAmountsForPeriod(lease, leasePeriod);
      const rentAmount = amounts.rent.amount;
      const syndicAmount = amounts.syndic.amount;
      const totalAmount = rentAmount + syndicAmount;
      const { rows } = await client.query(
        `INSERT INTO invoices (
           id, tenant_id, lease_id, unit_id, building_id, invoice_number,
           month, year, issue_date, due_date, status, total, discount_amount,
           public_notes, internal_notes, attachment_file_name, attachment_file_url,
           organization_id, invoice_type, billing_month, billing_year, period_start, period_end,
           invoice_date, generated_automatically, generation_source, automation_run_id
         )
         VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9, $10, 'UNPAID', $11, 0,
           $12, NULL, NULL, NULL,
           $13, 'RENT', $14, $15, $16, $17,
           $18, TRUE, $19, $20
         )
         RETURNING *`,
        [
          nextId,
          args.lease.tenant_id,
          args.lease.id,
          args.lease.unit_id,
          args.lease.building_id,
          invoiceNumber,
          leasePeriod.month,
          leasePeriod.year,
          leasePeriod.issueDate,
          leasePeriod.dueDate,
          totalAmount,
          args.invoiceBottomText,
          args.organizationId,
          leasePeriod.month,
          leasePeriod.year,
          leasePeriod.periodStart,
          leasePeriod.periodEnd,
          leasePeriod.issueDate,
          args.generationSource ?? 'MONTH_END_RENT_BILLING',
          args.runId,
        ],
      );

      if (rentAmount > 0) {
        await client.query(
          `INSERT INTO invoice_items (invoice_id, item_type, description, amount, organization_id)
           VALUES ($1, 'Monthly rent', $2, $3, $4)`,
          [nextId, this.periodDescriptionForRange('Loyer', leasePeriod), rentAmount, args.organizationId],
        );
      }
      if (syndicAmount > 0) {
        await client.query(
          `INSERT INTO invoice_items (invoice_id, item_type, description, amount, organization_id)
           VALUES ($1, 'Syndic', $2, $3, $4)`,
          [nextId, this.periodDescriptionForRange('Syndic', leasePeriod), syndicAmount, args.organizationId],
        );
      }

      return rows[0];
    });
  }

  private async handleInvoiceCommunications(args: {
    organizationId: number;
    invoiceId: number;
    invoiceNumber: string;
    issueDate: string;
    tenantName: string;
    tenantEmail: string | null;
    tenantPhone: string | null;
    unitNumber: string | null;
    buildingName: string | null;
    dueDate: string;
    rentAmount: number;
    syndicAmount: number;
    totalAmount: number;
    emailEnabled: boolean;
    whatsappEnabled: boolean;
    createdBy: number;
    companyName: string;
    periodLabel: string;
  }) {
    const subject = `Facture de loyer - ${args.periodLabel} - Appartement ${args.unitNumber ?? '-'}`;
    const emailMessage = [
      `Bonjour ${args.tenantName},`,
      '',
      `Veuillez trouver votre facture de loyer pour ${args.periodLabel}.`,
      '',
      `Loyer : ${this.money(args.rentAmount)} USD`,
      args.syndicAmount > 0 ? `Syndic : ${this.money(args.syndicAmount)} USD` : null,
      `Total : ${this.money(args.totalAmount)} USD`,
      `Echeance : ${this.formatDate(args.dueDate)}`,
      '',
      `Cordialement,`,
      args.companyName,
    ]
      .filter(Boolean)
      .join('\n');
    const whatsappMessage = [
      `Bonjour ${args.tenantName},`,
      `Votre facture de loyer de ${args.periodLabel} est disponible.`,
      `Loyer : ${this.money(args.rentAmount)} USD`,
      args.syndicAmount > 0 ? `Syndic : ${this.money(args.syndicAmount)} USD` : null,
      `Total : ${this.money(args.totalAmount)} USD`,
      `Echeance : ${this.formatDate(args.dueDate)}`,
      args.companyName,
    ]
      .filter(Boolean)
      .join('\n');

    const email = await this.deliverInvoiceCommunication({
      organizationId: args.organizationId,
      createdBy: args.createdBy,
      channel: 'EMAIL',
      enabled: args.emailEnabled,
      recipient: args.tenantEmail,
      missingReason: 'EMAIL_MISSING',
      disabledReason: 'EMAIL_DISABLED',
      invoiceId: args.invoiceId,
      subject,
      message: emailMessage,
      issueDate: args.issueDate,
      invoiceNumber: args.invoiceNumber,
      dueDate: args.dueDate,
      periodLabel: args.periodLabel,
      tenantName: args.tenantName,
      unitNumber: args.unitNumber,
      buildingName: args.buildingName,
      rentAmount: args.rentAmount,
      syndicAmount: args.syndicAmount,
      totalAmount: args.totalAmount,
    });
    const whatsapp = await this.deliverInvoiceCommunication({
      organizationId: args.organizationId,
      createdBy: args.createdBy,
      channel: 'WHATSAPP',
      enabled: args.whatsappEnabled,
      recipient: args.tenantPhone,
      missingReason: 'PHONE_MISSING',
      disabledReason: 'WHATSAPP_DISABLED',
      invoiceId: args.invoiceId,
      subject: null,
      message: whatsappMessage,
      issueDate: args.issueDate,
      invoiceNumber: args.invoiceNumber,
      dueDate: args.dueDate,
      periodLabel: args.periodLabel,
      tenantName: args.tenantName,
      unitNumber: args.unitNumber,
      buildingName: args.buildingName,
      rentAmount: args.rentAmount,
      syndicAmount: args.syndicAmount,
      totalAmount: args.totalAmount,
    });

    return { email, whatsapp };
  }

  private async deliverInvoiceCommunication(args: {
    organizationId: number;
    createdBy: number;
    channel: 'EMAIL' | 'WHATSAPP';
    enabled: boolean;
    recipient: string | null;
    missingReason: string;
    disabledReason: string;
    invoiceId: number;
    subject: string | null;
    message: string;
    issueDate: string;
    invoiceNumber: string;
    dueDate: string;
    periodLabel: string;
    tenantName: string;
    unitNumber: string | null;
    buildingName: string | null;
    rentAmount: number;
    syndicAmount: number;
    totalAmount: number;
  }) {
    if (!args.enabled) {
      return { status: 'SKIPPED', reason: args.disabledReason, attempts: 0, sentAt: null };
    }
    if (!args.recipient) {
      return { status: 'SKIPPED', reason: args.missingReason, attempts: 0, sentAt: null };
    }

    try {
      const result = args.channel === 'EMAIL'
        ? await this.emailService.sendInvoiceCreatedEmail({
            organizationId: args.organizationId,
            invoiceId: args.invoiceId,
            invoiceNumber: args.invoiceNumber,
            invoiceType: 'RENT',
            tenantName: args.tenantName,
            tenantEmail: args.recipient,
            issueDate: args.issueDate,
            dueDate: args.dueDate,
            periodLabel: args.periodLabel,
            unitNumber: args.unitNumber,
            buildingName: args.buildingName,
            currency: 'USD',
            totalAmount: args.totalAmount,
            rentAmount: args.rentAmount,
            syndicAmount: args.syndicAmount,
            lineItems: [
              { description: `Loyer ${args.periodLabel}`, amount: args.rentAmount },
              ...(args.syndicAmount > 0 ? [{ description: `Syndic ${args.periodLabel}`, amount: args.syndicAmount }] : []),
            ],
            createdBy: args.createdBy,
            idempotencyKey: this.emailService.buildIdempotencyKey([args.organizationId, 'INVOICE_CREATED', args.invoiceId]),
          })
        : await this.context.run(
            {
              user: {
                sub: args.createdBy,
                email: 'automation@system.local',
                role: 'ADMIN',
                organization_id: args.organizationId,
                permissions: ['*'],
              },
            },
            () =>
              this.saasService.sendCommunication(args.channel, {
                recipient: args.recipient,
                subject: args.subject ?? undefined,
                message: args.message,
                related_entity_type: 'invoice',
                related_entity_id: args.invoiceId,
                created_by: args.createdBy,
              }),
          );

      const status = String((result as { status?: string; log?: { status?: string } })?.status ?? (result as { log?: { status?: string } })?.log?.status ?? 'SIMULATED').toUpperCase();
      return {
        status,
        reason: status === 'FAILED' ? 'SEND_FAILED' : null,
        attempts: 1,
        sentAt: status === 'SENT' ? new Date().toISOString() : null,
      };
    } catch (error) {
      return {
        status: 'FAILED',
        reason: error instanceof Error ? error.message.slice(0, 120) : 'SEND_FAILED',
        attempts: 1,
        sentAt: null,
      };
    }
  }

  private async updateInvoiceCommunicationStatuses(
    invoiceId: number,
    organizationId: number,
    statuses: {
      email: { status: string; reason: string | null; attempts: number; sentAt: string | null };
      whatsapp: { status: string; reason: string | null; attempts: number; sentAt: string | null };
    },
  ) {
    await this.db.query(
      `UPDATE invoices
       SET email_delivery_status = $3,
           email_delivery_reason = $4,
           email_attempt_count = COALESCE(email_attempt_count, 0) + $5,
           last_emailed_at = COALESCE($6::timestamp, last_emailed_at),
           whatsapp_delivery_status = $7,
           whatsapp_delivery_reason = $8,
           whatsapp_attempt_count = COALESCE(whatsapp_attempt_count, 0) + $9,
           last_whatsapp_at = COALESCE($10::timestamp, last_whatsapp_at)
       WHERE id = $1
         AND organization_id = $2
         AND deleted_at IS NULL`,
      [
        invoiceId,
        organizationId,
        statuses.email.status,
        statuses.email.reason,
        statuses.email.attempts,
        statuses.email.sentAt,
        statuses.whatsapp.status,
        statuses.whatsapp.reason,
        statuses.whatsapp.attempts,
        statuses.whatsapp.sentAt,
      ],
    );
  }

  private async ensureSetting(organizationId: number) {
    const { rows } = await this.db.query<MonthlyRentBillingSettingRecord>(
      `INSERT INTO automation_settings (
         organization_id, automation_code, is_enabled, execution_time, timezone, due_day,
         email_enabled, whatsapp_enabled, updated_by
       )
       VALUES ($1, $2, FALSE, TIME '23:00', 'Africa/Kinshasa', 5, TRUE, TRUE, $3)
       ON CONFLICT (organization_id, automation_code) DO UPDATE
         SET organization_id = EXCLUDED.organization_id
       RETURNING *`,
      [organizationId, this.automationCode, this.context.userId() ?? 1],
    );
    return rows[0];
  }

  private async latestRunForOrganization(organizationId: number) {
    const { rows } = await this.db.query<AutomationRunRow>(
      `SELECT *
       FROM automation_runs
       WHERE organization_id = $1
         AND automation_code = $2
         AND deleted_at IS NULL
       ORDER BY started_at DESC, id DESC
       LIMIT 1`,
      [organizationId, this.automationCode],
    );
    return rows[0] ?? null;
  }

  private async reserveRun(args: {
    organizationId: number;
    executionMode: 'AUTOMATIC' | 'MANUAL';
    billingMonth: number;
    billingYear: number;
    triggeredBy: number | null;
  }) {
    return this.db.transaction(async (client) => {
      await client.query(
        `SELECT id
         FROM automation_settings
         WHERE organization_id = $1
           AND automation_code = $2
           AND deleted_at IS NULL
         FOR UPDATE`,
        [args.organizationId, this.automationCode],
      );

      const running = await client.query<{ id: number }>(
        `SELECT id
         FROM automation_runs
         WHERE organization_id = $1
           AND automation_code = $2
           AND billing_month = $3
           AND billing_year = $4
           AND status = 'RUNNING'
           AND deleted_at IS NULL
         ORDER BY id DESC
         LIMIT 1`,
        [args.organizationId, this.automationCode, args.billingMonth, args.billingYear],
      );

      if (running.rows[0]) {
        return {
          run: null,
          reason: 'RUN_ALREADY_IN_PROGRESS',
          runningRunId: Number(running.rows[0].id),
        };
      }

      const { rows } = await client.query<AutomationRunRow>(
        `INSERT INTO automation_runs (
           organization_id, automation_code, execution_mode, billing_month, billing_year,
           started_at, status, triggered_by
         )
         VALUES ($1, $2, $3, $4, $5, NOW(), 'RUNNING', $6)
         RETURNING *`,
        [args.organizationId, this.automationCode, args.executionMode, args.billingMonth, args.billingYear, args.triggeredBy],
      );

      return {
        run: rows[0],
        reason: null,
        runningRunId: null,
      };
    });
  }

  private async fetchEligibleLeases(organizationId: number, period: BillingPeriod, asOfDate: string) {
    const { rows } = await this.db.query<EligibleLease>(
      `SELECT l.id, l.lease_number, l.tenant_id, l.unit_id, u.building_id, l.monthly_rent, l.maintenance_fee_amount, l.monthly_syndic_amount,
              COALESCE(l.billing_frequency_months, 1) AS billing_frequency_months,
              l.status, l.start_date, l.end_date,
              last_invoice.period_start AS last_rent_period_start,
              last_invoice.period_end AS last_rent_period_end,
              last_invoice.billing_month AS last_rent_billing_month,
              last_invoice.billing_year AS last_rent_billing_year,
              CASE
                WHEN t.tenant_type = 'COMPANY' THEN COALESCE(t.company_name, 'Locataire')
                ELSE TRIM(CONCAT(COALESCE(t.first_name, ''), ' ', COALESCE(t.last_name, ''), ' ', COALESCE(t.post_name, '')))
              END AS tenant_name,
              t.email AS tenant_email,
              t.phone AS tenant_phone,
              b.name AS building_name,
              u.number AS unit_number
       FROM leases l
       JOIN tenants t ON t.id = l.tenant_id
       JOIN units u ON u.id = l.unit_id
       LEFT JOIN buildings b ON b.id = u.building_id
       LEFT JOIN LATERAL (
         SELECT i.period_start, i.period_end, i.billing_month, i.billing_year
         FROM invoices i
         WHERE i.organization_id = l.organization_id
           AND i.lease_id = l.id
           AND i.invoice_type = 'RENT'
           AND i.deleted_at IS NULL
         ORDER BY COALESCE(i.period_end, (MAKE_DATE(i.billing_year, i.billing_month, 1) + INTERVAL '1 month' - INTERVAL '1 day')::DATE) DESC, i.id DESC
         LIMIT 1
       ) last_invoice ON TRUE
       WHERE l.organization_id = $1
         AND l.deleted_at IS NULL
         AND l.status = 'ACTIVE'
         AND l.tenant_id IS NOT NULL
         AND l.unit_id IS NOT NULL
         AND (COALESCE(l.monthly_rent, 0) + COALESCE(l.maintenance_fee_amount, 0)) > 0
         AND l.start_date <= $2
         AND (l.end_date IS NULL OR l.end_date >= $3)
       ORDER BY COALESCE(b.name, ''), COALESCE(u.number, ''), l.id`,
      [organizationId, asOfDate, period.periodStart],
    );
    return rows;
  }

  private async fetchLeaseCandidateById(organizationId: number, leaseId: number) {
    const { rows } = await this.db.query<EligibleLease>(
      `SELECT l.id, l.lease_number, l.tenant_id, l.unit_id, u.building_id, l.monthly_rent, l.maintenance_fee_amount, l.monthly_syndic_amount,
              COALESCE(l.billing_frequency_months, 1) AS billing_frequency_months,
              l.status, l.start_date, l.end_date,
              last_invoice.period_start AS last_rent_period_start,
              last_invoice.period_end AS last_rent_period_end,
              last_invoice.billing_month AS last_rent_billing_month,
              last_invoice.billing_year AS last_rent_billing_year,
              CASE
                WHEN t.tenant_type = 'COMPANY' THEN COALESCE(t.company_name, 'Locataire')
                ELSE TRIM(CONCAT(COALESCE(t.first_name, ''), ' ', COALESCE(t.last_name, ''), ' ', COALESCE(t.post_name, '')))
              END AS tenant_name,
              t.email AS tenant_email,
              t.phone AS tenant_phone,
              b.name AS building_name,
              u.number AS unit_number
       FROM leases l
       JOIN tenants t ON t.id = l.tenant_id
       JOIN units u ON u.id = l.unit_id
       LEFT JOIN buildings b ON b.id = u.building_id
       LEFT JOIN LATERAL (
         SELECT i.period_start, i.period_end, i.billing_month, i.billing_year
         FROM invoices i
         WHERE i.organization_id = l.organization_id
           AND i.lease_id = l.id
           AND i.invoice_type = 'RENT'
           AND i.deleted_at IS NULL
         ORDER BY COALESCE(i.period_end, (MAKE_DATE(i.billing_year, i.billing_month, 1) + INTERVAL '1 month' - INTERVAL '1 day')::DATE) DESC, i.id DESC
         LIMIT 1
       ) last_invoice ON TRUE
       WHERE l.organization_id = $1
         AND l.id = $2
         AND l.deleted_at IS NULL
       LIMIT 1`,
      [organizationId, leaseId],
    );
    return rows[0] ?? null;
  }

  private async fetchLeaseCandidates(organizationId: number) {
    const { rows } = await this.db.query<EligibleLease>(
      `SELECT l.id, l.lease_number, l.tenant_id, l.unit_id, u.building_id, l.monthly_rent, l.maintenance_fee_amount, l.monthly_syndic_amount,
              COALESCE(l.billing_frequency_months, 1) AS billing_frequency_months,
              l.status, l.start_date, l.end_date,
              last_invoice.period_start AS last_rent_period_start,
              last_invoice.period_end AS last_rent_period_end,
              last_invoice.billing_month AS last_rent_billing_month,
              last_invoice.billing_year AS last_rent_billing_year,
              CASE
                WHEN t.tenant_type = 'COMPANY' THEN COALESCE(t.company_name, 'Locataire')
                ELSE TRIM(CONCAT(COALESCE(t.first_name, ''), ' ', COALESCE(t.last_name, ''), ' ', COALESCE(t.post_name, '')))
              END AS tenant_name,
              t.email AS tenant_email,
              t.phone AS tenant_phone,
              b.name AS building_name,
              u.number AS unit_number
       FROM leases l
       LEFT JOIN tenants t ON t.id = l.tenant_id
       LEFT JOIN units u ON u.id = l.unit_id
       LEFT JOIN buildings b ON b.id = u.building_id
       LEFT JOIN LATERAL (
         SELECT i.period_start, i.period_end, i.billing_month, i.billing_year
         FROM invoices i
         WHERE i.organization_id = l.organization_id
           AND i.lease_id = l.id
           AND i.invoice_type = 'RENT'
           AND i.deleted_at IS NULL
         ORDER BY COALESCE(i.period_end, (MAKE_DATE(i.billing_year, i.billing_month, 1) + INTERVAL '1 month' - INTERVAL '1 day')::DATE) DESC, i.id DESC
         LIMIT 1
       ) last_invoice ON TRUE
       WHERE l.organization_id = $1
         AND l.deleted_at IS NULL
       ORDER BY COALESCE(b.name, ''), COALESCE(u.number, ''), l.id`,
      [organizationId],
    );
    return rows;
  }

  private async findExistingRentInvoice(organizationId: number, leaseId: number, period: BillingPeriod) {
    const { rows } = await this.db.query(
      `SELECT id, invoice_number
       FROM invoices
       WHERE organization_id = $1
         AND lease_id = $2
         AND (
           (period_start = $3::DATE AND period_end = $4::DATE)
           OR (billing_month = $5 AND billing_year = $6)
         )
         AND invoice_type = 'RENT'
         AND deleted_at IS NULL
       ORDER BY id DESC
       LIMIT 1`,
      [organizationId, leaseId, period.periodStart, period.periodEnd, period.month, period.year],
    );
    return rows[0] ?? null;
  }

  private async assertNoDuplicateRentInvoice(client: PoolClient, organizationId: number, leaseId: number, period: BillingPeriod) {
    const existing = await client.query(
      `SELECT id, invoice_number
       FROM invoices
       WHERE organization_id = $1
         AND lease_id = $2
         AND (
           (period_start = $3::DATE AND period_end = $4::DATE)
           OR (billing_month = $5 AND billing_year = $6)
         )
         AND invoice_type = 'RENT'
         AND deleted_at IS NULL
       LIMIT 1`,
      [organizationId, leaseId, period.periodStart, period.periodEnd, period.month, period.year],
    );
    if (existing.rows[0]) {
      throw new BadRequestException(`Facture RENT deja existante pour ${period.month}/${period.year}: ${existing.rows[0].invoice_number}`);
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
    return Number(rows[0].value);
  }

  private async nextInvoiceNumber(client: PoolClient, billingYear: number) {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`invoice-number-${billingYear}`]);
    const { rows } = await client.query(
      `SELECT COALESCE(MAX((SUBSTRING(invoice_number FROM $1))::INT), 0) + 1 AS value
       FROM invoices
       WHERE invoice_number LIKE $2`,
      [`INV-${billingYear}-([0-9]+)`, `INV-${billingYear}-%`],
    );
    return `INV-${billingYear}-${String(rows[0].value).padStart(4, '0')}`;
  }

  private async hasAutomaticRunForPeriod(organizationId: number, month: number, year: number) {
    const { rows } = await this.db.query(
      `SELECT id
       FROM automation_runs
       WHERE organization_id = $1
         AND automation_code = $2
         AND execution_mode = 'AUTOMATIC'
         AND billing_month = $3
         AND billing_year = $4
         AND deleted_at IS NULL
       LIMIT 1`,
      [organizationId, this.automationCode, month, year],
    );
    return Boolean(rows[0]);
  }

  private presentSetting(setting: MonthlyRentBillingSettingRecord, lastRun: AutomationRunRow | null) {
    return {
      id: setting.id,
      automationCode: setting.automation_code,
      isEnabled: Boolean(setting.is_enabled),
      executionTime: this.timeOnly(setting.execution_time),
      generationDay: this.generationDay,
      timezone: setting.timezone,
      dueDay: this.automaticDueDay,
      emailEnabled: Boolean(setting.email_enabled),
      whatsappEnabled: Boolean(setting.whatsapp_enabled),
      nextExecutionAt: this.nextExecution(setting),
      lastRun: lastRun
        ? {
            id: lastRun.id,
            executionMode: lastRun.execution_mode,
            billingMonth: lastRun.billing_month,
            billingYear: lastRun.billing_year,
            startedAt: lastRun.started_at,
            completedAt: lastRun.completed_at,
            status: lastRun.status,
            eligibleCount: Number(lastRun.eligible_count ?? 0),
            createdCount: Number(lastRun.created_count ?? 0),
            skippedCount: Number(lastRun.skipped_count ?? 0),
            failedCount: Number(lastRun.failed_count ?? 0),
          }
        : null,
      explanation: 'Facturation automatique le 25 du mois courant, avec echeance fixee au 05 du mois suivant.',
    };
  }

  private periodFromInput(month?: number, year?: number) {
    const billingMonth = Number(month);
    const billingYear = Number(year);
    if (!Number.isInteger(billingMonth) || billingMonth < 1 || billingMonth > 12) {
      throw new BadRequestException('Mois de facturation invalide');
    }
    if (!Number.isInteger(billingYear) || billingYear < 2000) {
      throw new BadRequestException('Annee de facturation invalide');
    }
    return this.buildBillingPeriod(billingYear, billingMonth);
  }

  private periodFromDateInTimeZone(date: Date, timeZone: string) {
    const parts = this.zonedParts(date, timeZone);
    return this.buildBillingPeriod(parts.year, parts.month);
  }

  private todayInTimeZone(timeZone: string) {
    const parts = this.zonedParts(new Date(), this.normalizeTimezone(timeZone));
    return `${parts.year}-${this.two(parts.month)}-${this.two(parts.day)}`;
  }

  private buildBillingPeriod(year: number, month: number): BillingPeriod {
    const lastDay = this.daysInMonth(year, month);
    const issueDay = Math.min(this.generationDay, lastDay);
    return {
      month,
      year,
      issueDate: `${year}-${this.two(month)}-${this.two(issueDay)}`,
      dueDate: this.getAutomaticRentDueDate(year, month),
      periodStart: `${year}-${this.two(month)}-01`,
      periodEnd: `${year}-${this.two(month)}-${this.two(lastDay)}`,
      frequencyMonths: 1,
    };
  }

  private getAutomaticRentDueDate(year: number, month: number) {
    let nextMonth = month + 1;
    let nextYear = year;
    if (nextMonth > 12) {
      nextMonth = 1;
      nextYear += 1;
    }
    const clampedDay = Math.min(this.automaticDueDay, this.daysInMonth(nextYear, nextMonth));
    return `${nextYear}-${this.two(nextMonth)}-${this.two(clampedDay)}`;
  }

  private shouldRunAt(setting: MonthlyRentBillingSettingRecord, now: Date) {
    const timeZone = this.normalizeTimezone(setting.timezone);
    const parts = this.zonedParts(now, timeZone);
    if (parts.day !== this.generationDay) {
      return false;
    }
    const execution = this.normalizeExecutionTime(setting.execution_time);
    const [hourText, minuteText] = execution.split(':');
    const targetHour = Number(hourText);
    const targetMinute = Number(minuteText);
    if (parts.hour < targetHour) return false;
    if (parts.hour === targetHour && parts.minute < targetMinute) return false;
    return true;
  }

  private nextExecution(setting: MonthlyRentBillingSettingRecord) {
    const now = new Date();
    const timeZone = this.normalizeTimezone(setting.timezone);
    const parts = this.zonedParts(now, timeZone);
    const execution = this.normalizeExecutionTime(setting.execution_time);
    const [hourText, minuteText] = execution.split(':');
    const targetHour = Number(hourText);
    const targetMinute = Number(minuteText);
    let year = parts.year;
    let month = parts.month;
    const alreadyPassed =
      parts.day > this.generationDay ||
      (parts.day === this.generationDay && (parts.hour > targetHour || (parts.hour === targetHour && parts.minute >= targetMinute)));
    if (alreadyPassed) {
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }
    return `${year}-${this.two(month)}-${this.two(this.generationDay)} ${execution} (${timeZone})`;
  }

  private zonedParts(date: Date, timeZone: string) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    const parts = formatter.formatToParts(date);
    const map = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
    return {
      year: Number(map.year),
      month: Number(map.month),
      day: Number(map.day),
      hour: Number(map.hour),
      minute: Number(map.minute),
    };
  }

  private normalizeExecutionTime(value: unknown) {
    const text = this.timeOnly(value);
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text)) {
      throw new BadRequestException('Heure d execution invalide');
    }
    return text;
  }

  private timeOnly(value: unknown) {
    const text = String(value ?? '23:00').trim();
    return text.includes(':') ? text.slice(0, 5) : '23:00';
  }

  private normalizeTimezone(value: unknown) {
    const timeZone = String(value ?? 'Africa/Kinshasa').trim() || 'Africa/Kinshasa';
    try {
      new Intl.DateTimeFormat('fr-FR', { timeZone }).format(new Date());
      return timeZone;
    } catch {
      throw new BadRequestException('Fuseau horaire invalide');
    }
  }

  private normalizeDueDay(value: unknown) {
    const dueDay = Number(value);
    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
      throw new BadRequestException('Jour d echeance invalide');
    }
    return dueDay;
  }

  private daysInMonth(year: number, month: number) {
    return billingDaysInMonth(parseDate(`${year}-${this.two(month)}-01`));
  }

  private two(value: number) {
    return String(value).padStart(2, '0');
  }

  private periodDescription(prefix: string, month: number, year: number) {
    return `${prefix} - ${this.periodLabel(month, year)}`;
  }

  private periodDescriptionForRange(prefix: string, period: BillingPeriod) {
    return `${prefix} - ${this.periodLabelForRange(period)}`;
  }

  private periodLabel(month: number, year: number) {
    const names = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'];
    return `${names[month - 1] ?? month} ${year}`;
  }

  private periodLabelForRange(period: BillingPeriod) {
    if (period.frequencyMonths <= 1) {
      return this.periodLabel(period.month, period.year);
    }
    const start = this.periodLabel(period.month, period.year);
    const end = this.periodLabel(this.monthFromDate(period.periodEnd), this.yearFromDate(period.periodEnd));
    return `${start} - ${end}`;
  }

  private nextBillingPeriodForLease(basePeriod: BillingPeriod, lease: Partial<EligibleLease>) {
    const frequencyMonths = normalizeBillingFrequency(lease.billing_frequency_months);
    const lastEnd = this.dateOnly(lease.last_rent_period_end) ?? this.lastRentPeriodEndFromBillingFields(lease);
    let calculatedPeriod: { period_start: string; period_end: string; frequency_months: number } | null = null;

    if (lastEnd) {
      calculatedPeriod = calculateNextFullBillingPeriod(parseDate(lastEnd), frequencyMonths);
      if (calculatedPeriod.period_start !== basePeriod.periodStart) {
        return null;
      }
    } else {
      const startDate = this.dateOnly(lease.start_date);
      if (!startDate) {
        return null;
      }
      calculatedPeriod = calculateInitialBillingCycle(parseDate(startDate), frequencyMonths, []);
      if (calculatedPeriod.period_start > basePeriod.periodEnd) {
        return null;
      }
    }

    const year = this.yearFromDate(calculatedPeriod.period_start);
    const month = this.monthFromDate(calculatedPeriod.period_start);
    const period = this.buildBillingPeriod(year, month);
    return {
      ...period,
      frequencyMonths: calculatedPeriod.frequency_months,
      periodStart: calculatedPeriod.period_start,
      periodEnd: calculatedPeriod.period_end,
    };
  }

  private recurringAmountsForPeriod(lease: Partial<EligibleLease>, period: BillingPeriod): { rent: RecurringAmountSummary; syndic: RecurringAmountSummary; total: number } {
    const cycle = calculateInitialBillingCycle(parseDate(period.periodStart), period.frequencyMonths, [
      { code: 'RENT', label: 'Loyer', monthlyAmount: this.leaseRentAmount(lease) },
      { code: 'SYNDIC', label: 'Syndic', monthlyAmount: Number(lease.monthly_syndic_amount ?? 0) },
    ]);
    const rentAmount = cycle.lines
      .filter((line) => line.component_code === 'RENT')
      .reduce((sum, line) => sum + line.amount, 0);
    const syndicAmount = cycle.lines
      .filter((line) => line.component_code === 'SYNDIC')
      .reduce((sum, line) => sum + line.amount, 0);
    return {
      rent: { amount: rentAmount },
      syndic: { amount: syndicAmount },
      total: cycle.total_amount,
    };
  }

  private lastRentPeriodEndFromBillingFields(lease: Partial<EligibleLease>) {
    const month = Number(lease.last_rent_billing_month ?? 0);
    const year = Number(lease.last_rent_billing_year ?? 0);
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000) {
      return null;
    }
    return `${year}-${this.two(month)}-${this.two(this.daysInMonth(year, month))}`;
  }

  private monthFromDate(value: string) {
    return Number(value.slice(5, 7));
  }

  private yearFromDate(value: string) {
    return Number(value.slice(0, 4));
  }

  private dayFromDate(value: string) {
    return Number(value.slice(8, 10));
  }

  private money(value: number) {
    return Number(value ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  private formatDate(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('fr-FR');
  }

  private runStatus(eligibleCount: number, createdCount: number, skippedCount: number, failedCount: number) {
    if (eligibleCount === 0) return 'SKIPPED';
    if (failedCount > 0 && (createdCount > 0 || skippedCount > 0)) return 'PARTIAL';
    if (failedCount > 0) return 'FAILED';
    if (createdCount === 0 && skippedCount > 0) return 'SKIPPED';
    return 'SUCCESS';
  }

  private isLeaseEligible(lease: Pick<EligibleLease, 'status' | 'monthly_rent' | 'maintenance_fee_amount' | 'start_date' | 'end_date' | 'billing_frequency_months'>, period: BillingPeriod, asOfDate = period.issueDate) {
    return !this.leaseExclusionReason(lease, period, asOfDate);
  }

  private leaseExclusionReason(
    lease: Partial<Pick<EligibleLease, 'tenant_id' | 'unit_id' | 'status' | 'monthly_rent' | 'maintenance_fee_amount' | 'start_date' | 'end_date' | 'billing_frequency_months'>>,
    period: BillingPeriod,
    asOfDate = period.issueDate,
  ) {
    const startDate = this.dateOnly(lease.start_date);
    const endDate = this.dateOnly(lease.end_date);
    if (!lease.tenant_id) return 'TENANT_MISSING';
    if (!lease.unit_id) return 'UNIT_MISSING';
    if (String(lease.status ?? '') !== 'ACTIVE') return `STATUS_${String(lease.status ?? 'UNKNOWN').toUpperCase()}`;
    if (!(this.leaseRentAmount(lease) > 0)) return 'RENT_MISSING';
    if (!startDate || startDate > period.periodEnd) return 'STARTS_AFTER_PERIOD';
    if (startDate > asOfDate) return 'START_DATE_NOT_REACHED';
    if (endDate && endDate < period.periodStart) return 'ENDED_BEFORE_PERIOD';
    return null;
  }

  private leaseRentAmount(lease: Partial<Pick<EligibleLease, 'monthly_rent' | 'maintenance_fee_amount'>>) {
    return Number(lease.monthly_rent ?? 0) + Number(lease.maintenance_fee_amount ?? 0);
  }

  private leaseReference(lease: Pick<EligibleLease, 'id'> & { lease_number?: number | null }) {
    return `B-${String(lease.lease_number ?? lease.id).padStart(5, '0')}`;
  }

  private dateOnly(value: unknown) {
    if (!value) return null;
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) return null;
      return `${value.getFullYear()}-${this.two(value.getMonth() + 1)}-${this.two(value.getDate())}`;
    }
    const text = String(value).trim();
    if (!text) return null;
    const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : null;
  }

  private async companySettingsForOrganization(organizationId: number) {
    const { rows } = await this.db.query(
      `SELECT *
       FROM company_settings
       WHERE organization_id = $1
         AND deleted_at IS NULL`,
      [organizationId],
    );
    return rows[0] ?? {};
  }

  private companyDisplayName(settings: Record<string, unknown>) {
    return String(settings.company_legal_name ?? settings.legal_name ?? settings.company_name ?? 'Bailleur');
  }

  private async resolveActorId(organizationId: number, preferredUserId: number | null) {
    if (preferredUserId) {
      return preferredUserId;
    }
    const { rows } = await this.db.query(
      `SELECT id
       FROM app_users
       WHERE organization_id = $1
       ORDER BY CASE WHEN role = 'ADMIN' THEN 0 ELSE 1 END, id
       LIMIT 1`,
      [organizationId],
    );
    return Number(rows[0]?.id ?? 1);
  }
}
