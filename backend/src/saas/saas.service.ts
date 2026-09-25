import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { ForbiddenException, forwardRef, HttpException, Inject, InternalServerErrorException, Logger } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import { ServiceUnavailableException } from '@nestjs/common';
import { RequestContext } from '../auth/request-context';
import { hashPassword } from '../auth/password';
import { requireRow } from '../common/not-found';
import { DatabaseService } from '../database/database.service';
import { CommunicationService } from '../communication/communication.service';
import { DocumentDeliveryTrigger } from '../communication/shared/enums/document-delivery-trigger.enum';
import { DocumentType } from '../communication/shared/enums/document-type.enum';
import { EmailService } from '../email/email.service';
import { AutomationsService } from '../automations/automations.service';
import {
  buildLeaseContractDocxBuffer,
  formatDateInTimeZone,
  buildLeaseContractHtml,
  getDocxBufferSha256,
  getLeaseContractTemplateMetadata,
  renderLeaseContractTemplate,
  unresolvedPlaceholders,
} from '../leases/lease-contracts';
import { DocumentRendererService } from '../documents/document-renderer.service';
import { DocumentTemplateService } from '../documents/document-template.service';
import { PdfRendererService } from '../documents/pdf-renderer.service';
import { LEASE_DOCUMENT_RENDERER_VERSION, LEASE_PDF_MIME_TYPE } from '../documents/document-storage.service';
import { isPlatformRole, normalizeRole } from './permissions';
import {
  CreatePlatformMembershipDto,
  CreatePlatformOrganizationDto,
  CreatePlatformUserDto,
  DisablePlatformOrganizationModuleDto,
  PlatformListQueryDto,
  PlatformOrganizationListQueryDto,
  ReactivatePlatformOrganizationDto,
  SuspendPlatformOrganizationDto,
  UpdatePlatformMembershipDto,
  UpdatePlatformOrganizationDto,
  UpdatePlatformUserDto,
} from './settings.dto';

@Injectable()
export class SaasService {
  private readonly logger = new Logger(SaasService.name);
  private readonly companyStorageBucket = 'company';
  private readonly leaseContractStorageBucket = 'contracts';
  private readonly purchaseAttachmentStorageBucket = 'contracts';
  private readonly guaranteePaymentColumns = ['payment_type', 'lease_guarantee_id', 'cash_movement_id', 'idempotency_key'];
  private readonly allowedCompanyFileKinds = new Set(['logo', 'signature', 'stamp']);
  private readonly allowedCompanyFileMimeTypes = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml']);
  private readonly allowedPurchaseAttachmentMimeTypes = new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ]);
  private readonly platformModuleCatalogItems = [
    { code: 'CORE', label: 'Noyau applicatif', category: 'PLATFORM', description: 'ParamÃ¨tres gÃ©nÃ©raux et session.', icon: 'layers', is_core: true, is_assignable: false, is_active: true, dependencies: [] },
    { code: 'BUILDINGS', label: 'Immeubles', category: 'PROPERTY', description: 'Gestion des immeubles.', icon: 'building-2', is_core: false, is_assignable: true, is_active: true, dependencies: ['CORE'] },
    { code: 'UNITS', label: 'UnitÃ©s locatives', category: 'PROPERTY', description: 'Gestion des appartements et unitÃ©s.', icon: 'home', is_core: false, is_assignable: true, is_active: true, dependencies: ['BUILDINGS'] },
    { code: 'TENANTS', label: 'Locataires', category: 'PROPERTY', description: 'Gestion des locataires.', icon: 'users', is_core: false, is_assignable: true, is_active: true, dependencies: ['UNITS'] },
    { code: 'LEASES', label: 'Baux', category: 'PROPERTY', description: 'Gestion des baux et contrats.', icon: 'scroll-text', is_core: false, is_assignable: true, is_active: true, dependencies: ['TENANTS'] },
    { code: 'FINANCE', label: 'Finance', category: 'FINANCE', description: 'Factures, paiements et synthÃ¨se financiÃ¨re.', icon: 'credit-card', is_core: false, is_assignable: true, is_active: true, dependencies: ['CORE'] },
    { code: 'CASH', label: 'Caisse principale', category: 'FINANCE', description: 'Mouvements de caisse principale.', icon: 'wallet-cards', is_core: false, is_assignable: true, is_active: true, dependencies: ['FINANCE'] },
    { code: 'BANKING', label: 'Banque', category: 'FINANCE', description: 'Comptes bancaires et transactions.', icon: 'landmark', is_core: false, is_assignable: true, is_active: true, dependencies: ['FINANCE'] },
    { code: 'GUARANTEE_CASH', label: 'Caisse garanties', category: 'FINANCE', description: 'Garanties locatives et encaissements associÃ©s.', icon: 'shield-check', is_core: false, is_assignable: true, is_active: true, dependencies: ['FINANCE'] },
    { code: 'STOCK', label: 'Stock', category: 'OPERATIONS', description: 'Articles, mouvements et inventaires.', icon: 'boxes', is_core: false, is_assignable: true, is_active: true, dependencies: ['CORE'] },
    { code: 'MAINTENANCE', label: 'Maintenance', category: 'OPERATIONS', description: 'Demandes, interventions et suivi technique.', icon: 'wrench', is_core: false, is_assignable: true, is_active: true, dependencies: ['BUILDINGS'] },
    { code: 'HR', label: 'Ressources humaines', category: 'OPERATIONS', description: 'EmployÃ©s, contrats et paie.', icon: 'briefcase-business', is_core: false, is_assignable: true, is_active: true, dependencies: ['CORE'] },
    { code: 'DOCUMENTS', label: 'Documents', category: 'PLATFORM', description: 'BibliothÃ¨que documentaire et piÃ¨ces jointes.', icon: 'folder-open', is_core: false, is_assignable: true, is_active: true, dependencies: ['CORE'] },
    { code: 'COMMUNICATION', label: 'Communication', category: 'PLATFORM', description: 'Emails, SMS, journaux et notifications.', icon: 'message-square', is_core: false, is_assignable: true, is_active: true, dependencies: ['CORE'] },
    { code: 'REPORTS', label: 'Rapports', category: 'PLATFORM', description: 'Rapports et exports mÃ©tier.', icon: 'file-text', is_core: false, is_assignable: true, is_active: true, dependencies: ['CORE'] },
    { code: 'WORKFLOW', label: 'Workflow', category: 'PLATFORM', description: 'Circuits dâ€™approbation et tÃ¢ches.', icon: 'workflow', is_core: false, is_assignable: true, is_active: true, dependencies: ['CORE'] },
    { code: 'SALES', label: 'Ventes immobiliÃ¨res', category: 'COMMERCIAL', description: 'RÃ©servations, souscriptions et recouvrement commercial.', icon: 'line-chart', is_core: false, is_assignable: true, is_active: true, dependencies: ['CORE', 'FINANCE'] },
  ] as const;
  private readonly documentRenderer = new DocumentRendererService();
  private readonly documentTemplate = new DocumentTemplateService();
  private readonly pdfRenderer = new PdfRendererService();

  constructor(
    private readonly db: DatabaseService,
    private readonly context: RequestContext,
    private readonly emailService: EmailService,
    @Inject(forwardRef(() => CommunicationService))
    private readonly communicationService: CommunicationService,
    @Inject(forwardRef(() => AutomationsService))
    private readonly automationsService: AutomationsService,
  ) {}

  async findAll(table: string, orderBy = 'id DESC') {
    const { rows } = await this.db.query(`SELECT * FROM ${table} WHERE organization_id = $1 AND deleted_at IS NULL ORDER BY ${orderBy}`, [
      this.context.organizationId(),
    ]);
    return rows;
  }

  async insert(table: string, body: Record<string, unknown>, allowed: string[]) {
    const payload: Record<string, unknown> = { ...body, organization_id: this.context.organizationId() };
    const keys = [...allowed, 'organization_id'].filter((key, index, arr) => arr.indexOf(key) === index && payload[key] !== undefined);
    if (!keys.length) throw new BadRequestException('No data provided');
    const values = keys.map((key) => payload[key]);
    const placeholders = keys.map((_, index) => `$${index + 1}`);
    const { rows } = await this.db.query(
      `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
      values,
    );
    return rows[0];
  }

  async updateById(table: string, id: number, body: Record<string, unknown>, allowed: string[]) {
    const keys = allowed.filter((key) => body[key] !== undefined);
    if (!keys.length) throw new BadRequestException('No data provided');
    const assignments = keys.map((key, index) => `${key} = $${index + 2}`);
    const { rows } = await this.db.query(
      `UPDATE ${table} SET ${assignments.join(', ')} WHERE id = $1 AND organization_id = $${keys.length + 2} AND deleted_at IS NULL RETURNING *`,
      [id, ...keys.map((key) => body[key]), this.context.organizationId()],
    );
    return requireRow(rows[0], table);
  }

  private normalizeMonth(value: unknown, fallback = new Date().getMonth() + 1) {
    const month = Number(value ?? fallback);
    if (!Number.isFinite(month) || month < 1 || month > 12) {
      throw new BadRequestException('Mois invalide');
    }
    return month;
  }

  private normalizeYear(value: unknown, fallback = new Date().getFullYear()) {
    const year = Number(value ?? fallback);
    if (!Number.isFinite(year) || year < 2000) {
      throw new BadRequestException('AnnÃ©e invalide');
    }
    return year;
  }

  private calculateMonthlyAttendanceMetrics(monthlySalary: number, workingDays: number, unjustifiedAbsenceDays: number, advancesTotal: number) {
    const safeWorkingDays = Math.max(Number(workingDays || 0), 1);
    const dailySalary = Number(monthlySalary || 0) / safeWorkingDays;
    const absenceDeduction = dailySalary * Math.max(Number(unjustifiedAbsenceDays || 0), 0);
    const estimatedNetSalary = Math.max(Number(monthlySalary || 0) - absenceDeduction - Number(advancesTotal || 0), 0);
    return {
      dailySalary: Number(dailySalary.toFixed(2)),
      absenceDeduction: Number(absenceDeduction.toFixed(2)),
      estimatedNetSalary: Number(estimatedNetSalary.toFixed(2)),
    };
  }

  private async monthlyAdvanceTotal(client: PoolClient, employeeId: number, month: number, year: number) {
    const { rows } = await client.query(
      `SELECT COALESCE(SUM(amount), 0)::NUMERIC(12,2) AS total
       FROM salary_advances
       WHERE employee_id = $1
         AND organization_id = $2
         AND deleted_at IS NULL
         AND status = 'PAID'
         AND EXTRACT(MONTH FROM advance_date) = $3
         AND EXTRACT(YEAR FROM advance_date) = $4`,
      [employeeId, this.context.organizationId(), month, year],
    );
    return Number(rows[0]?.total ?? 0);
  }

  private normalizeAttendancePayload(body: Record<string, unknown>) {
    const employeeId = Number(body.employee_id ?? 0);
    const month = this.normalizeMonth(body.month);
    const year = this.normalizeYear(body.year);
    const workingDays = Number(body.working_days ?? 0);
    const paidLeaveDays = Number(body.paid_leave_days ?? 0);
    const sickDays = Number(body.sick_days ?? 0);
    const unjustifiedAbsenceDays = Number(body.unjustified_absence_days ?? 0);
    const lateCount = Number(body.late_count ?? 0);
    const overtimeHours = Number(body.overtime_hours ?? 0);
    const presentDays = body.present_days !== undefined
      ? Number(body.present_days ?? 0)
      : Math.max(workingDays - paidLeaveDays - sickDays - unjustifiedAbsenceDays, 0);
    const totalDays = presentDays + paidLeaveDays + sickDays + unjustifiedAbsenceDays;

    if (!employeeId) throw new BadRequestException('EmployÃ© requis');
    if (workingDays <= 0) throw new BadRequestException('Le nombre de jours ouvrables doit Ãªtre supÃ©rieur Ã  0.');
    if (totalDays > workingDays) {
      throw new BadRequestException('La somme prÃ©sence + congÃ©s payÃ©s + maladie + absences non justifiÃ©es ne peut pas dÃ©passer les jours ouvrables.');
    }

    return {
      employeeId,
      month,
      year,
      workingDays,
      presentDays,
      paidLeaveDays,
      sickDays,
      unjustifiedAbsenceDays,
      lateCount,
      overtimeHours,
      observations: body.observations ?? null,
      status: body.status ?? 'DRAFT',
    };
  }

  private isOptionalSchemaError(error: any) {
    return error?.code === '42P01' || error?.code === '42703';
  }

  private async queryOptionalRows<T extends Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
    fallbackSql?: string,
    fallbackParams: unknown[] = params,
  ) {
    try {
      const { rows } = await this.db.query<T>(sql, params);
      return rows;
    } catch (error) {
      if (fallbackSql && this.isOptionalSchemaError(error)) {
        const { rows } = await this.db.query<T>(fallbackSql, fallbackParams);
        return rows;
      }
      if (this.isOptionalSchemaError(error)) {
        return [] as T[];
      }
      throw error;
    }
  }

  private async tryPayrollDetailQuery(sql: string, params: unknown[]) {
    try {
      const { rows } = await this.db.query(sql, params);
      return rows;
    } catch (error) {
      if (this.isOptionalSchemaError(error)) {
        return [];
      }
      throw error;
    }
  }

  private async upsertEmployeeMonthlyAttendance(client: PoolClient, payload: ReturnType<SaasService['normalizeAttendancePayload']>) {
    const employee = await client.query(
      `SELECT id, monthly_salary
       FROM employees
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [payload.employeeId, this.context.organizationId()],
    );
    const employeeRow = requireRow(employee.rows[0], 'Employee');
    const existing = await client.query(
      `SELECT id, status
       FROM employee_monthly_attendance
       WHERE organization_id = $1 AND employee_id = $2 AND month = $3 AND year = $4 AND deleted_at IS NULL`,
      [this.context.organizationId(), payload.employeeId, payload.month, payload.year],
    );
    if (existing.rows[0] && existing.rows[0].status === 'VALIDATED') {
      throw new BadRequestException('Ce pointage mensuel est dÃ©jÃ  validÃ© et ne peut plus Ãªtre modifiÃ©.');
    }

    const advancesTotal = await this.monthlyAdvanceTotal(client, payload.employeeId, payload.month, payload.year);
    const metrics = this.calculateMonthlyAttendanceMetrics(
      Number(employeeRow.monthly_salary ?? 0),
      payload.workingDays,
      payload.unjustifiedAbsenceDays,
      advancesTotal,
    );
    const { rows } = await client.query(
      `INSERT INTO employee_monthly_attendance (
         employee_id, month, year, working_days, present_days, paid_leave_days, sick_days,
         unjustified_absence_days, late_count, overtime_hours, absence_deduction,
         estimated_net_salary, observations, status, created_by, organization_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       ON CONFLICT (organization_id, employee_id, year, month) WHERE deleted_at IS NULL
       DO UPDATE SET working_days = EXCLUDED.working_days,
                     present_days = EXCLUDED.present_days,
                     paid_leave_days = EXCLUDED.paid_leave_days,
                     sick_days = EXCLUDED.sick_days,
                     unjustified_absence_days = EXCLUDED.unjustified_absence_days,
                     late_count = EXCLUDED.late_count,
                     overtime_hours = EXCLUDED.overtime_hours,
                     absence_deduction = EXCLUDED.absence_deduction,
                     estimated_net_salary = EXCLUDED.estimated_net_salary,
                     observations = EXCLUDED.observations,
                     status = CASE WHEN employee_monthly_attendance.status = 'VALIDATED' THEN employee_monthly_attendance.status ELSE EXCLUDED.status END,
                     updated_at = NOW()
       RETURNING *`,
      [
        payload.employeeId,
        payload.month,
        payload.year,
        payload.workingDays,
        payload.presentDays,
        payload.paidLeaveDays,
        payload.sickDays,
        payload.unjustifiedAbsenceDays,
        payload.lateCount,
        payload.overtimeHours,
        metrics.absenceDeduction,
        metrics.estimatedNetSalary,
        payload.observations,
        payload.status,
        this.context.userId() ?? 1,
        this.context.organizationId(),
      ],
    );
    return rows[0];
  }

  async listUsers() {
    const currentUser = this.context.user();
    if (currentUser?.platform_role && isPlatformRole(currentUser.platform_role)) {
      const { rows } = await this.db.query(
        `SELECT
           au.id,
           au.first_name,
           au.last_name,
           au.email,
           au.role,
           au.status,
           au.organization_id,
           o.name AS organization_name,
           au.created_at
         FROM app_users au
         LEFT JOIN organizations o ON o.id = au.organization_id
         WHERE au.deleted_at IS NULL
         ORDER BY au.created_at DESC, au.id DESC`,
      );
      return rows;
    }

    try {
      const { rows } = await this.db.query(
        `SELECT
           au.id,
           au.first_name,
           au.last_name,
           au.email,
           uo.role_code AS role,
           au.status,
           uo.organization_id,
           o.name AS organization_name,
           au.created_at
         FROM user_organizations uo
         JOIN app_users au ON au.id = uo.user_id
         JOIN organizations o ON o.id = uo.organization_id
         WHERE uo.organization_id = $1
           AND uo.is_active = TRUE
           AND au.deleted_at IS NULL
           AND COALESCE(au.platform_role, '') = ''
         ORDER BY au.created_at DESC, au.id DESC`,
        [this.context.organizationId()],
      );
      return rows;
    } catch (error) {
      if (!this.isOptionalSchemaError(error)) throw error;
      const { rows } = await this.db.query(
        `SELECT
           au.id,
           au.first_name,
           au.last_name,
           au.email,
           COALESCE(au.role, 'VIEWER_CLIENT') AS role,
           au.status,
           au.organization_id,
           o.name AS organization_name,
           au.created_at
         FROM app_users au
         LEFT JOIN organizations o ON o.id = au.organization_id
         WHERE au.organization_id = $1
           AND au.deleted_at IS NULL
           AND COALESCE(au.platform_role, '') = ''
         ORDER BY au.created_at DESC, au.id DESC`,
        [this.context.organizationId()],
      );
      return rows;
    }
  }

  async createScopedUser(body: Record<string, unknown>) {
    const roleCode = this.normalizeScopedUserRole(body.role);
    const password = String(body.password ?? body.password_hash ?? 'demo');
    const firstName = String(body.first_name ?? '').trim();
    const lastName = String(body.last_name ?? '').trim();
    const email = String(body.email ?? '').trim();
    const status = String(body.status ?? 'ACTIVE').trim().toUpperCase() || 'ACTIVE';
    const organizationId = this.context.organizationId();

    if (!firstName || !lastName || !email) {
      throw new BadRequestException('Nom, prÃ©nom et adresse e-mail sont obligatoires.');
    }

    const existing = await this.db.query(
      `SELECT id FROM app_users WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL LIMIT 1`,
      [email],
    );
    if (existing.rows[0]) {
      throw new ConflictException('Un utilisateur avec cette adresse e-mail existe dÃ©jÃ .');
    }

    const { rows } = await this.db.query(
      `INSERT INTO app_users (
         first_name, last_name, email, password_hash, role, status, organization_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        firstName,
        lastName,
        email,
        await hashPassword(password),
        roleCode,
        status,
        organizationId,
      ],
    );

    const created = rows[0];
    try {
      await this.db.query(
        `INSERT INTO user_organizations (
           user_id, organization_id, role_code, is_active, is_default
         )
         VALUES ($1, $2, $3, TRUE, TRUE)
         ON CONFLICT (user_id, organization_id)
         DO UPDATE SET role_code = EXCLUDED.role_code, is_active = TRUE, updated_at = NOW()`,
        [created.id, organizationId, roleCode],
      );
    } catch (error) {
      if (!this.isOptionalSchemaError(error)) throw error;
    }

    return {
      ...created,
      role: roleCode,
      organization_name: this.context.user()?.organization_name ?? `Organisation ${organizationId}`,
    };
  }

  async updateScopedUser(id: number, body: Record<string, unknown>) {
    const currentUser = this.context.user();
    const organizationId = this.context.organizationId();
    const isPlatformUser = Boolean(currentUser?.platform_role && isPlatformRole(currentUser.platform_role));
    const roleCode = body.role !== undefined ? this.normalizeScopedUserRole(body.role) : undefined;
    const targetUserResult = await this.db.query(
      `SELECT id, role FROM app_users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [id],
    );
    const targetUser = requireRow(targetUserResult.rows[0], 'User');

    if (!isPlatformUser) {
      try {
        const membership = await this.db.query(
          `SELECT au.id
           FROM user_organizations uo
           JOIN app_users au ON au.id = uo.user_id
           WHERE au.id = $1
             AND uo.organization_id = $2
             AND uo.is_active = TRUE
             AND au.deleted_at IS NULL
             AND COALESCE(au.platform_role, '') = ''
           LIMIT 1`,
          [id, organizationId],
        );
        if (!membership.rows[0]) {
          throw new ConflictException('Utilisateur introuvable dans lâ€™organisation active.');
        }
      } catch (error) {
        if (!this.isOptionalSchemaError(error)) throw error;
        const membership = await this.db.query(
          `SELECT id
           FROM app_users
           WHERE id = $1
             AND organization_id = $2
             AND deleted_at IS NULL
             AND COALESCE(platform_role, '') = ''
           LIMIT 1`,
          [id, organizationId],
        );
        if (!membership.rows[0]) {
          throw new ConflictException('Utilisateur introuvable dans lâ€™organisation active.');
        }
      }
    }

    if (roleCode && isPlatformRole(targetUser.role)) {
      throw new ConflictException('Le rÃ´le plateforme de cet utilisateur doit Ãªtre gÃ©rÃ© sÃ©parÃ©ment.');
    }

    const baseFields = ['first_name', 'last_name', 'email', 'status'] as const;
    const baseKeys = baseFields.filter((key) => body[key] !== undefined);
    if (baseKeys.length) {
      const assignments = baseKeys.map((key, index) => `${key} = $${index + 2}`);
      const values = baseKeys.map((key) => body[key]);
      const updated = await this.db.query(
        `UPDATE app_users
         SET ${assignments.join(', ')}
         WHERE id = $1 AND deleted_at IS NULL
         RETURNING *`,
        [id, ...values],
      );
      requireRow(updated.rows[0], 'User');
    }

    if (roleCode) {
      try {
        await this.db.query(
          `INSERT INTO user_organizations (user_id, organization_id, role_code, is_active, is_default)
           VALUES ($1, $2, $3, TRUE, FALSE)
           ON CONFLICT (user_id, organization_id)
           DO UPDATE SET role_code = EXCLUDED.role_code, is_active = TRUE, updated_at = NOW()`,
          [id, organizationId, roleCode],
        );
      } catch (error) {
        if (!this.isOptionalSchemaError(error)) throw error;
      }
      await this.db.query(
        `UPDATE app_users
         SET role = CASE WHEN organization_id = $2 THEN $3 ELSE role END
         WHERE id = $1 AND deleted_at IS NULL`,
        [id, organizationId, roleCode],
      );
    }

    try {
      const { rows } = await this.db.query(
        `SELECT
           au.*,
           COALESCE(uo.role_code, au.role) AS role,
           o.name AS organization_name
         FROM app_users au
         LEFT JOIN user_organizations uo
           ON uo.user_id = au.id
          AND uo.organization_id = $2
         LEFT JOIN organizations o ON o.id = COALESCE(uo.organization_id, au.organization_id)
         WHERE au.id = $1 AND au.deleted_at IS NULL
         LIMIT 1`,
        [id, organizationId],
      );
      return requireRow(rows[0], 'User');
    } catch (error) {
      if (!this.isOptionalSchemaError(error)) throw error;
      const { rows } = await this.db.query(
        `SELECT
           au.*,
           au.role AS role,
           o.name AS organization_name
         FROM app_users au
         LEFT JOIN organizations o ON o.id = au.organization_id
         WHERE au.id = $1 AND au.deleted_at IS NULL
         LIMIT 1`,
        [id],
      );
      return requireRow(rows[0], 'User');
    }
  }

  async platformOverview() {
    const statsQuery = async () => {
      try {
        return await this.db.query(
          `SELECT
             (SELECT COUNT(*)::INT FROM organizations) AS total_organizations,
             (SELECT COUNT(*)::INT FROM organizations WHERE status = 'ACTIVE') AS active_organizations,
             (SELECT COUNT(*)::INT FROM organizations WHERE status = 'SUSPENDED') AS suspended_organizations,
             (SELECT COUNT(*)::INT FROM app_users WHERE deleted_at IS NULL) AS total_users,
             (SELECT COUNT(*)::INT FROM app_users WHERE deleted_at IS NULL AND status = 'ACTIVE') AS active_users,
             (SELECT COUNT(*)::INT FROM (
                SELECT user_id
                FROM user_organizations
                WHERE is_active = TRUE
                GROUP BY user_id
                HAVING COUNT(*) > 1
              ) multi) AS multi_organization_users,
             (SELECT COUNT(*)::INT FROM user_organizations WHERE is_active = TRUE) AS active_memberships`,
        );
      } catch (error) {
        if (!this.isOptionalSchemaError(error)) throw error;
        return this.db.query(
          `SELECT
             (SELECT COUNT(*)::INT FROM organizations) AS total_organizations,
             (SELECT COUNT(*)::INT FROM organizations WHERE status = 'ACTIVE') AS active_organizations,
             (SELECT COUNT(*)::INT FROM organizations WHERE status = 'SUSPENDED') AS suspended_organizations,
             (SELECT COUNT(*)::INT FROM app_users WHERE deleted_at IS NULL) AS total_users,
             (SELECT COUNT(*)::INT FROM app_users WHERE deleted_at IS NULL AND status = 'ACTIVE') AS active_users,
             0::INT AS multi_organization_users,
             (SELECT COUNT(*)::INT FROM app_users WHERE deleted_at IS NULL AND organization_id IS NOT NULL) AS active_memberships`,
        );
      }
    };

    const [stats, latestOrganizations, latestActivity] = await Promise.all([
      statsQuery(),
      this.db.query(
        `SELECT id, name, slug, status, created_at
         FROM organizations
         ORDER BY created_at DESC, id DESC
         LIMIT 5`,
      ),
      this.platformActivity(),
    ]);

    return {
      stats: stats.rows[0],
      latestOrganizations: latestOrganizations.rows,
      latestActivity,
    };
  }

  async platformOrganizations(filters: PlatformOrganizationListQueryDto) {
    const params: unknown[] = [];
    const where: string[] = [];
    if (filters.search) {
      params.push(`%${String(filters.search).trim()}%`);
      where.push(`(o.name ILIKE $${params.length} OR o.slug ILIKE $${params.length})`);
    }
    if (filters.status && filters.status !== 'ALL') {
      params.push(filters.status);
      where.push(`o.status = $${params.length}`);
    }
    if (filters.moduleCode && filters.moduleCode !== 'ALL') {
      params.push(filters.moduleCode);
      where.push(`EXISTS (
        SELECT 1
        FROM organization_modules om
        WHERE om.organization_id = o.id
          AND om.module_code = $${params.length}
          AND om.is_enabled = TRUE
      )`);
    }
    const sortByMap: Record<string, string> = {
      created_at: 'o.created_at',
      updated_at: 'COALESCE(o.reactivated_at, o.suspended_at, o.created_at)',
      name: 'o.name',
      slug: 'o.slug',
      status: 'o.status',
    };
    const sortColumn = sortByMap[String(filters.sortBy ?? 'created_at').toLowerCase()] ?? 'o.created_at';
    const sortDirection = String(filters.sortOrder ?? 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const { rows } = await this.db.query(
      `SELECT
         o.id,
         o.name,
         o.slug,
         o.status,
         o.created_at,
         COALESCE(o.reactivated_at, o.suspended_at, o.created_at) AS updated_at,
         o.suspended_at,
         o.suspension_reason,
         o.reactivated_at,
         o.reactivation_reason,
         cs.company_name,
         cs.email AS primary_email,
         cs.phone,
         cs.company_country AS country,
         cs.company_city AS city,
         (SELECT COUNT(*)::INT FROM app_users au WHERE au.organization_id = o.id AND au.deleted_at IS NULL) AS users_count,
         (SELECT COUNT(*)::INT FROM user_organizations uo WHERE uo.organization_id = o.id) AS memberships_count,
         COALESCE((
           SELECT json_agg(om.module_code ORDER BY om.module_code)
           FROM organization_modules om
           WHERE om.organization_id = o.id
             AND om.is_enabled = TRUE
         ), '[]'::json) AS active_modules
       FROM organizations o
       LEFT JOIN company_settings cs ON cs.organization_id = o.id AND cs.deleted_at IS NULL
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY ${sortColumn} ${sortDirection}, o.id DESC`,
      params,
    );
    return rows;
  }

  async platformOrganizationDetail(id: number) {
    const { rows } = await this.db.query(
      `SELECT
         o.*,
         COALESCE(o.reactivated_at, o.suspended_at, o.created_at) AS updated_at,
         cs.company_name,
         cs.legal_name,
         cs.email AS primary_email,
         cs.phone,
         cs.company_country AS country,
         cs.company_city AS city,
         cs.currency,
         cs.language,
         cs.timezone,
         (
           SELECT COUNT(*)::INT
           FROM app_users au
           WHERE au.organization_id = o.id
             AND au.deleted_at IS NULL
         ) AS users_count,
         (
           SELECT COUNT(*)::INT
           FROM user_organizations uo
           WHERE uo.organization_id = o.id
         ) AS memberships_count,
         COALESCE((
           SELECT json_agg(om.module_code ORDER BY om.module_code)
           FROM organization_modules om
           WHERE om.organization_id = o.id
             AND om.is_enabled = TRUE
         ), '[]'::json) AS active_modules
       FROM organizations o
       LEFT JOIN company_settings cs ON cs.organization_id = o.id AND cs.deleted_at IS NULL
       WHERE o.id = $1
       LIMIT 1`,
      [id],
    );
    return requireRow(rows[0], 'Organization');
  }

  async platformOrganizationActivity(id: number) {
    await this.platformOrganizationDetail(id);
    const { rows } = await this.db.query(
      `SELECT
         id,
         action,
         target_user_id,
         organization_id,
         before_json,
         after_json,
         created_at
       FROM platform_admin_audit_logs
       WHERE organization_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT 50`,
      [id],
    );
    return rows;
  }

  async platformModulesCatalog() {
    try {
      const { rows } = await this.db.query(
        `SELECT code, label, category, description, icon, is_core, is_assignable, is_active, dependencies, sort_order
         FROM modules_catalog
         WHERE is_active = TRUE
         ORDER BY sort_order ASC, code ASC`,
      );
      if (rows.length) return rows;
    } catch (error) {
      if (!this.isOptionalSchemaError(error)) throw error;
    }
    return this.platformModuleCatalogItems.map((module, index) => ({
      ...module,
      dependencies: JSON.stringify(module.dependencies),
      sort_order: index + 1,
    }));
  }

  async platformOrganizationModules(id: number) {
    await this.platformOrganizationDetail(id);
    const catalog = await this.platformModulesCatalog();
    const { rows } = await this.db.query(
      `SELECT
         module_code,
         is_enabled,
         enabled_at,
         enabled_by,
         disabled_at,
         disabled_by,
         disable_reason
       FROM organization_modules
       WHERE organization_id = $1`,
      [id],
    );
    const stateByCode = new Map(rows.map((row) => [String(row.module_code), row]));
    return catalog.map((item: Record<string, unknown>) => {
      const moduleCode = String(item.code);
      const state = stateByCode.get(moduleCode);
      return {
        ...item,
        organization_id: id,
        module_code: moduleCode,
        is_enabled: Boolean(state?.is_enabled),
        enabled_at: state?.enabled_at ?? null,
        enabled_by: state?.enabled_by ?? null,
        disabled_at: state?.disabled_at ?? null,
        disabled_by: state?.disabled_by ?? null,
        disable_reason: state?.disable_reason ?? null,
      };
    });
  }

  async platformSuspendOrganization(id: number, body: SuspendPlatformOrganizationDto) {
    this.ensureActorIsSuperAdmin();
    const existing = await this.platformOrganizationDetail(id);
    if (String(existing.status ?? '').toUpperCase() === 'ARCHIVED') {
      throw new ConflictException('PLATFORM_ORGANIZATION_ARCHIVED');
    }
    if (String(existing.status ?? '').toUpperCase() === 'SUSPENDED') {
      throw new ConflictException('PLATFORM_ORGANIZATION_ALREADY_SUSPENDED');
    }
    const reason = String(body.reason ?? '').trim();
    if (!reason) {
      throw new BadRequestException('PLATFORM_SUSPENSION_REASON_REQUIRED');
    }
    const { rows } = await this.db.query(
      `UPDATE organizations
       SET status = 'SUSPENDED',
           suspended_at = NOW(),
           suspended_by = $2,
           suspension_reason = $3,
           reactivated_at = NULL,
           reactivated_by = NULL,
           reactivation_reason = NULL
       WHERE id = $1
       RETURNING *`,
      [id, this.context.userId() ?? null, reason],
    );
    const updated = requireRow(rows[0], 'Organization');
    await this.writePlatformAudit('ORGANIZATION_SUSPENDED', null, id, existing, updated);
    return updated;
  }

  async platformReactivateOrganization(id: number, body: ReactivatePlatformOrganizationDto) {
    this.ensureActorIsSuperAdmin();
    const existing = await this.platformOrganizationDetail(id);
    if (String(existing.status ?? '').toUpperCase() === 'ARCHIVED') {
      throw new ConflictException('PLATFORM_ORGANIZATION_ARCHIVED');
    }
    const reason = String(body.reason ?? '').trim() || null;
    const { rows } = await this.db.query(
      `UPDATE organizations
       SET status = 'ACTIVE',
           reactivated_at = NOW(),
           reactivated_by = $2,
           reactivation_reason = $3
       WHERE id = $1
       RETURNING *`,
      [id, this.context.userId() ?? null, reason],
    );
    const updated = requireRow(rows[0], 'Organization');
    await this.writePlatformAudit('ORGANIZATION_REACTIVATED', null, id, existing, updated);
    return updated;
  }

  async platformEnableOrganizationModule(id: number, code: string) {
    this.ensureActorIsSuperAdmin();
    const organization = await this.platformOrganizationDetail(id);
    if (!this.isAccessibleOrganizationStatus(organization.status)) {
      throw new ConflictException('PLATFORM_ORGANIZATION_NOT_ACTIVE');
    }
    const moduleCode = this.normalizePlatformModuleCode(code);
    const moduleDefinition = await this.getPlatformModuleDefinition(moduleCode);
    if (!moduleDefinition.is_active) {
      throw new ConflictException('PLATFORM_MODULE_INACTIVE');
    }
    if (!moduleDefinition.is_assignable) {
      throw new ConflictException('PLATFORM_MODULE_NOT_ASSIGNABLE');
    }
    const dependencyCodes = this.normalizeModuleDependencies(moduleDefinition.dependencies);
    if (dependencyCodes.length) {
      const { rows } = await this.db.query<{ module_code: string }>(
        `SELECT module_code
         FROM organization_modules
         WHERE organization_id = $1
           AND is_enabled = TRUE
           AND module_code = ANY($2::text[])`,
        [id, dependencyCodes],
      );
      const enabledDependencyCodes = new Set(rows.map((row) => String(row.module_code)));
      const missingDependencies = dependencyCodes.filter((dependency) => !enabledDependencyCodes.has(dependency));
      if (missingDependencies.length) {
        throw new ConflictException(`PLATFORM_MODULE_DEPENDENCIES_MISSING:${missingDependencies.join(',')}`);
      }
    }
    const { rows } = await this.db.query(
      `INSERT INTO organization_modules (
         organization_id, module_code, is_enabled, enabled_at, enabled_by, disabled_at, disabled_by, disable_reason
       )
       VALUES ($1, $2, TRUE, NOW(), $3, NULL, NULL, NULL)
       ON CONFLICT (organization_id, module_code)
       DO UPDATE SET
         is_enabled = TRUE,
         enabled_at = NOW(),
         enabled_by = EXCLUDED.enabled_by,
         disabled_at = NULL,
         disabled_by = NULL,
         disable_reason = NULL
       RETURNING *`,
      [id, moduleCode, this.context.userId() ?? null],
    );
    const updated = requireRow(rows[0], 'Organization module');
    await this.writePlatformAudit('ORGANIZATION_MODULE_ENABLED', null, id, null, updated);
    return updated;
  }

  async platformDisableOrganizationModule(id: number, code: string, body: DisablePlatformOrganizationModuleDto) {
    this.ensureActorIsSuperAdmin();
    await this.platformOrganizationDetail(id);
    const moduleCode = this.normalizePlatformModuleCode(code);
    const moduleDefinition = await this.getPlatformModuleDefinition(moduleCode);
    if (moduleDefinition.is_core) {
      throw new ConflictException('PLATFORM_MODULE_CORE_REQUIRED');
    }
    const reason = String(body.reason ?? '').trim();
    if (!reason) {
      throw new BadRequestException('PLATFORM_MODULE_DISABLE_REASON_REQUIRED');
    }
    const { rows: dependentRows } = await this.db.query<{ module_code: string }>(
      `SELECT om.module_code
       FROM organization_modules om
       JOIN modules_catalog mc ON mc.code = om.module_code
       WHERE om.organization_id = $1
         AND om.is_enabled = TRUE
         AND om.module_code <> $2
         AND mc.dependencies @> to_jsonb(ARRAY[$2]::text[])`,
      [id, moduleCode],
    );
    if (dependentRows.length) {
      throw new ConflictException(`PLATFORM_MODULE_DEPENDENTS_ACTIVE:${dependentRows.map((row) => row.module_code).join(',')}`);
    }
    const before = await this.db.query(
      `SELECT *
       FROM organization_modules
       WHERE organization_id = $1
         AND module_code = $2
       LIMIT 1`,
      [id, moduleCode],
    );
    const { rows } = await this.db.query(
      `INSERT INTO organization_modules (
         organization_id, module_code, is_enabled, enabled_at, enabled_by, disabled_at, disabled_by, disable_reason
       )
       VALUES ($1, $2, FALSE, NULL, NULL, NOW(), $3, $4)
       ON CONFLICT (organization_id, module_code)
       DO UPDATE SET
         is_enabled = FALSE,
         disabled_at = NOW(),
         disabled_by = EXCLUDED.disabled_by,
         disable_reason = EXCLUDED.disable_reason
       RETURNING *`,
      [id, moduleCode, this.context.userId() ?? null, reason],
    );
    const updated = requireRow(rows[0], 'Organization module');
    await this.writePlatformAudit('ORGANIZATION_MODULE_DISABLED', null, id, before.rows[0] ?? null, updated);
    return updated;
  }

  async platformCreateOrganization(body: CreatePlatformOrganizationDto) {
    this.ensureActorIsSuperAdmin();
    const name = String(body.name ?? '').trim();
    const slug = String(body.slug ?? '').trim().toLowerCase();
    if (!name || !slug) throw new BadRequestException('PLATFORM_ORGANIZATION_REQUIRED');

    const { rows } = await this.db.query(
      `INSERT INTO organizations (name, slug, status)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [name, slug, String(body.status ?? 'ACTIVE').toUpperCase()],
    );
    const organization = rows[0];

    await this.db.query(
      `INSERT INTO company_settings (
         organization_id, company_name, legal_name, currency, language, timezone, created_by
       )
       VALUES ($1, $2, $2, 'USD', 'fr', 'Africa/Kinshasa', $3)
       ON CONFLICT (organization_id) DO NOTHING`,
      [organization.id, name, this.context.userId() ?? 1],
    );

    await this.writePlatformAudit('ORGANIZATION_CREATED', null, organization.id, null, organization);
    return organization;
  }

  async platformUpdateOrganization(id: number, body: UpdatePlatformOrganizationDto) {
    this.ensureActorIsSuperAdmin();
    const before = await this.db.query(`SELECT * FROM organizations WHERE id = $1 LIMIT 1`, [id]);
    const existing = requireRow(before.rows[0], 'Organization');
    const keys = (['name', 'slug', 'status'] as const).filter((key) => body[key] !== undefined);
    if (!keys.length) throw new BadRequestException('PLATFORM_UPDATE_EMPTY');
    const assignments = keys.map((key, index) => `${key} = $${index + 2}`);
    const { rows } = await this.db.query(
      `UPDATE organizations
       SET ${assignments.join(', ')}
       WHERE id = $1
       RETURNING *`,
      [id, ...keys.map((key) => key === 'slug' ? String(body[key]).toLowerCase() : body[key])],
    );
    const updated = requireRow(rows[0], 'Organization');
    await this.writePlatformAudit('ORGANIZATION_UPDATED', null, id, existing, updated);
    return updated;
  }

  async platformUsers(filters: PlatformListQueryDto) {
    const params: unknown[] = [];
    const where = ['au.deleted_at IS NULL'];
    if (filters.search) {
      params.push(`%${String(filters.search).trim()}%`);
      where.push(`(CONCAT(COALESCE(au.first_name, ''), ' ', COALESCE(au.last_name, '')) ILIKE $${params.length} OR au.email ILIKE $${params.length})`);
    }
    if (filters.status && filters.status !== 'ALL') {
      params.push(filters.status);
      where.push(`au.status = $${params.length}`);
    }

    try {
      const { rows } = await this.db.query(
        `SELECT
           au.id,
           au.first_name,
           au.last_name,
           au.email,
           au.status,
           au.role,
           au.platform_role,
           au.created_at,
           au.organization_id,
           default_org.organization_name,
           default_org.organization_slug,
           default_org.role_code AS default_membership_role,
           COALESCE(orgs.membership_count, 0)::INT AS organizations_count,
           COALESCE(orgs.organizations, '[]'::json) AS organizations
         FROM app_users au
         LEFT JOIN LATERAL (
           SELECT o.name AS organization_name, o.slug AS organization_slug, uo.role_code
           FROM user_organizations uo
           JOIN organizations o ON o.id = uo.organization_id
           WHERE uo.user_id = au.id AND uo.is_default = TRUE
           ORDER BY uo.id DESC
           LIMIT 1
         ) default_org ON TRUE
         LEFT JOIN LATERAL (
           SELECT
             COUNT(*) AS membership_count,
             json_agg(json_build_object(
               'organization_id', o.id,
               'organization_name', o.name,
               'organization_slug', o.slug,
               'role_code', uo.role_code,
               'is_active', uo.is_active,
               'is_default', uo.is_default
             ) ORDER BY o.name ASC) AS organizations
           FROM user_organizations uo
           JOIN organizations o ON o.id = uo.organization_id
           WHERE uo.user_id = au.id
         ) orgs ON TRUE
         WHERE ${where.join(' AND ')}
         ORDER BY au.created_at DESC, au.id DESC`,
        params,
      );
      return rows;
    } catch (error) {
      if (!this.isOptionalSchemaError(error)) throw error;
      const { rows } = await this.db.query(
        `SELECT
           au.id,
           au.first_name,
           au.last_name,
           au.email,
           au.status,
           au.role,
           au.platform_role,
           au.created_at,
           au.organization_id,
           o.name AS organization_name,
           o.slug AS organization_slug,
           COALESCE(au.role, 'VIEWER_CLIENT') AS default_membership_role,
           CASE WHEN au.organization_id IS NULL THEN 0 ELSE 1 END::INT AS organizations_count,
           CASE
             WHEN au.organization_id IS NULL THEN '[]'::json
             ELSE json_build_array(json_build_object(
               'organization_id', o.id,
               'organization_name', o.name,
               'organization_slug', o.slug,
               'role_code', COALESCE(au.role, 'VIEWER_CLIENT'),
               'is_active', TRUE,
               'is_default', TRUE
             ))
           END AS organizations
         FROM app_users au
         LEFT JOIN organizations o ON o.id = au.organization_id
         WHERE ${where.join(' AND ')}
         ORDER BY au.created_at DESC, au.id DESC`,
        params,
      );
      return rows;
    }
  }

  async platformCreateUser(body: CreatePlatformUserDto) {
    this.ensureActorIsSuperAdmin();
    const organizationId = Number(body.organization_id ?? 0);
    if (!organizationId) throw new BadRequestException('PLATFORM_ORGANIZATION_REQUIRED');
    await this.ensureActivePlatformOrganization(organizationId);
    const password = String(body.password ?? '');
    const firstName = String(body.first_name ?? '').trim();
    const lastName = String(body.last_name ?? '').trim();
    const email = String(body.email ?? '').trim();
    const status = String(body.status ?? 'ACTIVE').trim().toUpperCase() || 'ACTIVE';
    const platformRole = this.normalizePlatformRole(body.platform_role);
    if (!firstName || !lastName || !email) {
      throw new BadRequestException('Nom, prÃ©nom et adresse e-mail sont obligatoires.');
    }
    if (!password) {
      throw new BadRequestException('PLATFORM_PASSWORD_REQUIRED');
    }
    const { rows } = await this.db.query(
      `INSERT INTO app_users (
         first_name, last_name, email, password_hash, role, platform_role, status, organization_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [firstName, lastName, email, await hashPassword(password), 'VIEWER_CLIENT', platformRole, status, organizationId],
    );
    const created = rows[0];
    await this.writePlatformAudit('PLATFORM_USER_CREATED', created.id, created.organization_id ?? null, null, created);
    return this.sanitizePlatformUserResponse(created);
  }

  async platformUpdateUser(id: number, body: UpdatePlatformUserDto) {
    this.ensureActorIsSuperAdmin();
    const before = await this.db.query(`SELECT * FROM app_users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [id]);
    const existing = requireRow(before.rows[0], 'User');
    const keys = (['first_name', 'last_name', 'email', 'status', 'platform_role'] as const).filter(
      (key) => body[key] !== undefined,
    );
    if (!keys.length) throw new BadRequestException('PLATFORM_UPDATE_EMPTY');
    const nextPlatformRole = body.platform_role === undefined ? String(existing.platform_role ?? '').trim().toUpperCase() || null : this.normalizePlatformRole(body.platform_role);
    const nextStatus = String(body.status ?? existing.status ?? 'ACTIVE').trim().toUpperCase() || 'ACTIVE';
    if (Number(existing.id) === Number(this.context.userId() ?? 0) && (nextStatus !== 'ACTIVE' || nextPlatformRole !== 'SUPER_ADMIN')) {
      throw new ConflictException('PLATFORM_USER_SELF_LOCKOUT');
    }
    if (String(existing.platform_role ?? '').trim().toUpperCase() === 'SUPER_ADMIN' && (nextStatus !== 'ACTIVE' || nextPlatformRole !== 'SUPER_ADMIN')) {
      const activeSuperAdmins = await this.countActiveSuperAdmins();
      if (activeSuperAdmins <= 1) {
        throw new ConflictException('LAST_ACTIVE_SUPER_ADMIN');
      }
    }
    const assignments = keys.map((key, index) => `${key} = $${index + 2}`);
    const { rows } = await this.db.query(
      `UPDATE app_users
       SET ${assignments.join(', ')}
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING *`,
      [
        id,
        ...keys.map((key) => {
          if (key === 'platform_role') return nextPlatformRole;
          if (key === 'status') return nextStatus;
          return body[key];
        }),
      ],
    );
    const updated = requireRow(rows[0], 'User');
    await this.writePlatformAudit('PLATFORM_USER_UPDATED', id, updated.organization_id ?? null, existing, updated);
    return this.sanitizePlatformUserResponse(updated);
  }

  async platformMemberships(filters: PlatformListQueryDto) {
    const params: unknown[] = [];
    const where: string[] = [];
    if (filters.userId) {
      params.push(filters.userId);
      where.push(`uo.user_id = $${params.length}`);
    }
    if (filters.organizationId) {
      params.push(filters.organizationId);
      where.push(`uo.organization_id = $${params.length}`);
    }
    try {
      const { rows } = await this.db.query(
        `SELECT
           uo.id,
           uo.user_id,
           uo.organization_id,
           uo.role_code,
           uo.role_id,
           uo.is_active,
           uo.is_default,
           uo.created_at,
           uo.updated_at,
           CONCAT(COALESCE(au.first_name, ''), ' ', COALESCE(au.last_name, '')) AS user_name,
           au.email,
           o.name AS organization_name,
           o.slug AS organization_slug,
           r.name AS role_name
         FROM user_organizations uo
         JOIN app_users au ON au.id = uo.user_id
         JOIN organizations o ON o.id = uo.organization_id
         LEFT JOIN roles r ON r.id = uo.role_id
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY uo.created_at DESC, uo.id DESC`,
        params,
      );
      return rows;
    } catch (error) {
      if (!this.isOptionalSchemaError(error)) throw error;
      const fallbackWhere = where
        .map((clause) => clause.replace(/uo\.user_id/g, 'au.id').replace(/uo\.organization_id/g, 'au.organization_id'))
        .join(' AND ');
      const { rows } = await this.db.query(
        `SELECT
           au.id,
           au.id AS user_id,
           au.organization_id,
           COALESCE(au.role, 'VIEWER_CLIENT') AS role_code,
           NULL::INTEGER AS role_id,
           TRUE AS is_active,
           TRUE AS is_default,
           au.created_at,
           au.created_at AS updated_at,
           CONCAT(COALESCE(au.first_name, ''), ' ', COALESCE(au.last_name, '')) AS user_name,
           au.email,
           o.name AS organization_name,
           o.slug AS organization_slug,
           NULL::VARCHAR AS role_name
         FROM app_users au
         JOIN organizations o ON o.id = au.organization_id
         ${fallbackWhere ? `WHERE ${fallbackWhere}` : ''}
         ORDER BY au.created_at DESC, au.id DESC`,
        params,
      );
      return rows;
    }
  }

  async platformUpsertMembership(body: CreatePlatformMembershipDto) {
    this.ensureActorIsSuperAdmin();
    const userId = Number(body.user_id ?? 0);
    const organizationId = Number(body.organization_id ?? 0);
    const roleCode = this.normalizeScopedUserRole(body.role_code ?? 'VIEWER_CLIENT');
    const isActive = body.is_active === undefined ? true : Boolean(body.is_active);
    const isDefault = body.is_default === undefined ? false : Boolean(body.is_default);
    if (!userId || !organizationId) throw new BadRequestException('PLATFORM_MEMBERSHIP_REQUIRED');
    if (isDefault && !isActive) {
      throw new BadRequestException('PLATFORM_MEMBERSHIP_INACTIVE');
    }

    await this.ensureActivePlatformOrganization(organizationId);
    await this.ensureActivePlatformUser(userId);
    const roleId = await this.resolveOrganizationRoleId(organizationId, roleCode);

    return this.db.transaction(async (client) => {
      const before = await client.query(`SELECT * FROM user_organizations WHERE user_id = $1 AND organization_id = $2 LIMIT 1`, [userId, organizationId]);
      if (before.rows[0]) {
        throw new ConflictException('PLATFORM_MEMBERSHIP_ALREADY_EXISTS');
      }
      if (isDefault) {
        await client.query(`UPDATE user_organizations SET is_default = FALSE, updated_at = NOW() WHERE user_id = $1`, [userId]);
      }
      const { rows } = await client.query(
        `INSERT INTO user_organizations (
           user_id, organization_id, role_code, role_id, is_active, is_default, created_by, updated_by
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
         RETURNING *`,
        [userId, organizationId, roleCode, roleId, isActive, isDefault, this.context.userId() ?? 1],
      );
      const membership = rows[0];
      await this.writePlatformAudit('MEMBERSHIP_CREATED', userId, organizationId, null, membership);
      return membership;
    });
  }

  async platformUpdateMembership(id: number, body: UpdatePlatformMembershipDto) {
    this.ensureActorIsSuperAdmin();
    const before = await this.db.query(`SELECT * FROM user_organizations WHERE id = $1 LIMIT 1`, [id]);
    const existing = requireRow(before.rows[0], 'Membership');
    await this.ensureActivePlatformOrganization(Number(existing.organization_id));
    await this.ensureActivePlatformUser(Number(existing.user_id));
    const nextRoleCode = body.role_code !== undefined
      ? this.normalizeScopedUserRole(body.role_code)
      : existing.role_code;
    const nextIsActive = body.is_active === undefined ? existing.is_active : Boolean(body.is_active);
    const nextIsDefault = body.is_default === undefined ? existing.is_default : Boolean(body.is_default);
    if (nextIsDefault && !nextIsActive) {
      throw new BadRequestException('PLATFORM_MEMBERSHIP_INACTIVE');
    }
    const roleId = await this.resolveOrganizationRoleId(existing.organization_id, nextRoleCode);
    return this.db.transaction(async (client) => {
      if (nextIsDefault) {
        await client.query(`UPDATE user_organizations SET is_default = FALSE, updated_at = NOW() WHERE user_id = $1`, [existing.user_id]);
      }
      const { rows } = await client.query(
        `UPDATE user_organizations
         SET role_code = $2,
             role_id = $3,
             is_active = $4,
             is_default = $5,
             updated_by = $6,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [id, nextRoleCode, roleId, nextIsActive, nextIsDefault, this.context.userId() ?? 1],
      );
      const updated = requireRow(rows[0], 'Membership');
      await this.writePlatformAudit('MEMBERSHIP_UPDATED', updated.user_id, updated.organization_id, existing, updated);
      return updated;
    });
  }

  async platformRoles() {
    return {
      platformRoles: [
        { code: 'SUPER_ADMIN', label: 'Super administrateur', scope: 'PLATFORM' },
        { code: 'ADMIN_PLATFORM', label: 'Administrateur plateforme', scope: 'PLATFORM' },
      ],
      organizationRoles: [
        { code: 'ADMIN_CLIENT', label: 'Administrateur client', scope: 'ORGANIZATION' },
        { code: 'EDITOR_CLIENT', label: 'Utilisateur en Ã©criture', scope: 'ORGANIZATION' },
        { code: 'VIEWER_CLIENT', label: 'Lecture seule', scope: 'ORGANIZATION' },
      ],
    };
  }

  async platformActivity() {
    try {
      const { rows } = await this.db.query(
        `SELECT
           pal.id,
           pal.actor_user_id,
           pal.target_user_id,
           pal.organization_id,
           pal.action,
           pal.created_at,
           CONCAT(COALESCE(actor.first_name, ''), ' ', COALESCE(actor.last_name, '')) AS actor_name,
           CONCAT(COALESCE(target.first_name, ''), ' ', COALESCE(target.last_name, '')) AS target_name,
           o.name AS organization_name
         FROM platform_admin_audit_logs pal
         LEFT JOIN app_users actor ON actor.id = pal.actor_user_id
         LEFT JOIN app_users target ON target.id = pal.target_user_id
         LEFT JOIN organizations o ON o.id = pal.organization_id
         ORDER BY pal.created_at DESC, pal.id DESC
         LIMIT 20`,
      );
      return rows;
    } catch (error: any) {
      if (error?.code === '42P01') return [];
      throw error;
    }
  }

  async createUser(body: Record<string, unknown>) {
    return this.createScopedUser(body);
  }

  private normalizePlatformModuleCode(value: string) {
    const normalized = String(value ?? '').trim().toUpperCase();
    if (!normalized) {
      throw new BadRequestException('PLATFORM_MODULE_REQUIRED');
    }
    return normalized;
  }

  private normalizeModuleDependencies(value: unknown) {
    if (Array.isArray(value)) {
      return value.map((item) => this.normalizePlatformModuleCode(String(item)));
    }
    if (typeof value === 'string' && value.trim()) {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.map((item) => this.normalizePlatformModuleCode(String(item))) : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  private async getPlatformModuleDefinition(moduleCode: string) {
    try {
      const { rows } = await this.db.query<{
        code: string;
        label: string;
        category: string;
        description: string | null;
        icon: string | null;
        is_core: boolean;
        is_assignable: boolean;
        is_active: boolean;
        dependencies: unknown;
      }>(
        `SELECT code, label, category, description, icon, is_core, is_assignable, is_active, dependencies
         FROM modules_catalog
         WHERE code = $1
         LIMIT 1`,
        [moduleCode],
      );
      if (rows[0]) {
        return rows[0];
      }
    } catch (error) {
      if (!this.isOptionalSchemaError(error)) throw error;
    }
    const fallback = this.platformModuleCatalogItems.find((item) => item.code === moduleCode);
    if (fallback) {
      return {
        ...fallback,
        dependencies: fallback.dependencies,
      };
    }
    throw new NotFoundException('PLATFORM_MODULE_NOT_FOUND');
  }

  private async ensurePlatformModuleExists(moduleCode: string) {
    await this.getPlatformModuleDefinition(moduleCode);
  }

  private ensureActorIsSuperAdmin() {
    const platformRole = String(this.context.user()?.platform_role ?? this.context.user()?.role ?? '').trim().toUpperCase();
    if (platformRole !== 'SUPER_ADMIN') {
      throw new ForbiddenException('PLATFORM_SUPER_ADMIN_REQUIRED');
    }
  }

  private normalizePlatformRole(role: unknown) {
    if (role === null) return null;
    const value = String(role ?? '').trim().toUpperCase();
    if (!value) return null;
    if (value === 'SUPER_ADMIN' || value === 'ADMIN_PLATFORM') return value;
    throw new BadRequestException('PLATFORM_ROLE_INVALID');
  }

  private normalizeScopedUserRole(role: unknown) {
    const value = String(role ?? 'EDITOR_CLIENT').trim().toUpperCase();
    if (value === 'ADMIN' || value === 'ADMIN_CLIENT') return 'ADMIN_CLIENT';
    if (['EDITOR', 'EDITOR_CLIENT', 'ACCOUNTANT', 'STAFF', 'AGENT', 'GESTIONNAIRE', 'COMPTABLE'].includes(value)) return 'EDITOR_CLIENT';
    if (value === 'VIEWER' || value === 'VIEWER_CLIENT' || !value) return 'VIEWER_CLIENT';
    throw new BadRequestException('PLATFORM_ROLE_INVALID');
  }

  private async ensureActivePlatformOrganization(organizationId: number) {
    const { rows } = await this.db.query(`SELECT id, status FROM organizations WHERE id = $1 LIMIT 1`, [organizationId]);
    const organization = requireRow(rows[0], 'Organization');
    if (!this.isAccessibleOrganizationStatus(organization.status)) {
      throw new ConflictException('ORGANIZATION_ACCESS_DENIED');
    }
    return organization;
  }

  private isAccessibleOrganizationStatus(status: unknown) {
    const normalized = String(status ?? '').trim().toUpperCase();
    return normalized === 'ACTIVE' || normalized === 'TEST';
  }

  private async ensureActivePlatformUser(userId: number) {
    const { rows } = await this.db.query(
      `SELECT id, status, platform_role
       FROM app_users
       WHERE id = $1 AND deleted_at IS NULL
       LIMIT 1`,
      [userId],
    );
    const user = requireRow(rows[0], 'User');
    if (String(user.status ?? '').trim().toUpperCase() !== 'ACTIVE') {
      throw new ConflictException('PLATFORM_USER_NOT_FOUND');
    }
    return user;
  }

  private async countActiveSuperAdmins() {
    const { rows } = await this.db.query(
      `SELECT COUNT(*)::INT AS count
       FROM app_users
       WHERE deleted_at IS NULL
         AND status = 'ACTIVE'
         AND COALESCE(platform_role, '') = 'SUPER_ADMIN'`,
    );
    return Number(rows[0]?.count ?? 0);
  }

  private async resolveOrganizationRoleId(organizationId: number, roleCode: string) {
    const candidates =
      roleCode === 'ADMIN_CLIENT'
        ? ['ADMIN']
        : roleCode === 'EDITOR_CLIENT'
          ? ['STAFF', 'ACCOUNTANT']
          : ['DIRECTOR'];
    const { rows } = await this.db.query(
      `SELECT id
       FROM roles
       WHERE organization_id = $1
         AND code = ANY($2::text[])
       ORDER BY CASE code
         WHEN 'ADMIN' THEN 1
         WHEN 'STAFF' THEN 2
         WHEN 'ACCOUNTANT' THEN 3
         WHEN 'DIRECTOR' THEN 4
         ELSE 99
       END
      LIMIT 1`,
      [organizationId, candidates],
    );
    if (!rows[0]?.id) {
      throw new ConflictException('PLATFORM_ROLE_ORGANIZATION_MISMATCH');
    }
    return rows[0].id;
  }

  private async writePlatformAudit(action: string, targetUserId: number | null, organizationId: number | null, beforeJson: unknown, afterJson: unknown) {
    try {
      await this.db.query(
        `INSERT INTO platform_admin_audit_logs (
           actor_user_id, target_user_id, organization_id, action, before_json, after_json
         )
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          this.context.userId(),
          targetUserId,
          organizationId,
          action,
          beforeJson ? JSON.stringify(this.sanitizePlatformAuditPayload(beforeJson)) : null,
          afterJson ? JSON.stringify(this.sanitizePlatformAuditPayload(afterJson)) : null,
        ],
      );
    } catch (error: any) {
      if (error?.code === '42P01') return;
      throw error;
    }
  }

  private sanitizePlatformAuditPayload(payload: unknown): unknown {
    if (Array.isArray(payload)) {
      return payload.map((item) => this.sanitizePlatformAuditPayload(item));
    }
    if (!payload || typeof payload !== 'object') {
      return payload;
    }
    const clone: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      if (['password', 'password_hash', 'jwt', 'token', 'refresh_token'].includes(key)) {
        clone[key] = '[REDACTED]';
        continue;
      }
      clone[key] = this.sanitizePlatformAuditPayload(value);
    }
    return clone;
  }

  private sanitizePlatformUserResponse(payload: Record<string, unknown>) {
    const { password_hash, password, ...safe } = payload;
    return safe;
  }

  workflowDefinitions() {
    return this.findAll('workflow_definitions', 'type, name');
  }

  async workflowInstances() {
    const { rows } = await this.db.query(
      `SELECT wi.*, CONCAT(u.first_name, ' ', u.last_name) AS requester_name
       FROM workflow_instances wi
       LEFT JOIN app_users u ON u.id = wi.requester_id
       WHERE wi.organization_id = $1 AND wi.deleted_at IS NULL
       ORDER BY wi.created_at DESC, wi.id DESC`,
      [this.context.organizationId()],
    );
    return rows;
  }

  async myWorkflowApprovals() {
    const role = this.context.user()?.role;
    const userId = this.context.userId();
    const { rows } = await this.db.query(
      `SELECT wi.*, ws.id AS step_id, ws.name AS step_name, ws.approver_role, ws.approver_user_id
       FROM workflow_instances wi
       JOIN workflow_steps ws ON ws.workflow_instance_id = wi.id
       WHERE wi.organization_id = $1
         AND wi.deleted_at IS NULL
         AND wi.status = 'PENDING'
         AND ws.status = 'PENDING'
         AND (ws.approver_role = $2 OR ws.approver_user_id = $3)
       ORDER BY wi.created_at`,
      [this.context.organizationId(), role, userId ?? null],
    );
    return rows;
  }

  async workflowDetail(id: number) {
    const workflow = await this.db.query(
      `SELECT wi.*, CONCAT(u.first_name, ' ', u.last_name) AS requester_name
       FROM workflow_instances wi
       LEFT JOIN app_users u ON u.id = wi.requester_id
       WHERE wi.id = $1 AND wi.organization_id = $2 AND wi.deleted_at IS NULL`,
      [id, this.context.organizationId()],
    );
    const row = requireRow(workflow.rows[0], 'Workflow');
    const steps = await this.db.query(
      `SELECT * FROM workflow_steps WHERE workflow_instance_id = $1 AND organization_id = $2 AND deleted_at IS NULL ORDER BY step_order`,
      [id, this.context.organizationId()],
    );
    const actions = await this.db.query(
      `SELECT wa.*, CONCAT(u.first_name, ' ', u.last_name) AS actor_name
       FROM workflow_actions wa
       LEFT JOIN app_users u ON u.id = wa.acted_by
       WHERE wa.workflow_instance_id = $1 AND wa.organization_id = $2 AND wa.deleted_at IS NULL
       ORDER BY wa.acted_at, wa.id`,
      [id, this.context.organizationId()],
    );
    return { ...row, steps: steps.rows, actions: actions.rows };
  }

  async createWorkflowInstance(body: Record<string, unknown>) {
    return this.db.transaction((client) => this.createWorkflowInstanceInTransaction(client, body));
  }

  async approveWorkflow(id: number, comment?: string) {
    return this.db.transaction(async (client) => {
      await this.ensureWorkflowStepCanAct(client, id);
      await client.query(
        `UPDATE workflow_steps
         SET status = 'APPROVED', comment = $3, acted_by = $4, acted_at = NOW()
         WHERE workflow_instance_id = $1 AND organization_id = $2 AND status = 'PENDING'`,
        [id, this.context.organizationId(), comment ?? null, this.context.userId() ?? 1],
      );
      const { rows } = await client.query(
        `UPDATE workflow_instances
         SET status = 'APPROVED', comment = $3, approved_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND organization_id = $2 RETURNING *`,
        [id, this.context.organizationId(), comment ?? null],
      );
      await this.addWorkflowAction(client, id, 'APPROVED', comment);
      return rows[0];
    });
  }

  async rejectWorkflow(id: number, comment?: string) {
    return this.db.transaction(async (client) => {
      await this.ensureWorkflowStepCanAct(client, id);
      await client.query(
        `UPDATE workflow_steps
         SET status = 'REJECTED', comment = $3, acted_by = $4, acted_at = NOW()
         WHERE workflow_instance_id = $1 AND organization_id = $2 AND status = 'PENDING'`,
        [id, this.context.organizationId(), comment ?? null, this.context.userId() ?? 1],
      );
      const { rows } = await client.query(
        `UPDATE workflow_instances
         SET status = 'REJECTED', comment = $3, rejected_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND organization_id = $2 RETURNING *`,
        [id, this.context.organizationId(), comment ?? null],
      );
      await this.addWorkflowAction(client, id, 'REJECTED', comment);
      return rows[0];
    });
  }

  async cancelWorkflow(id: number, comment?: string) {
    const { rows } = await this.db.query(
      `UPDATE workflow_instances SET status = 'CANCELLED', comment = $3, cancelled_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL RETURNING *`,
      [id, this.context.organizationId(), comment ?? null],
    );
    return requireRow(rows[0], 'Workflow');
  }

  async employees() {
    const today = new Date().toISOString().slice(0, 10);
    const rows = await this.queryOptionalRows(
      `SELECT e.*,
              COALESCE(s.name, e.department) AS department,
              COALESCE(p.name, e.job_title) AS job_title,
              CONCAT(e.first_name, ' ', COALESCE(e.post_name || ' ', ''), e.last_name) AS full_name,
              c.contract_number AS current_contract_number,
              c.contract_type AS current_contract_type,
              c.end_date AS current_contract_end_date,
              a.status AS attendance_status_today
       FROM employees e
       LEFT JOIN hr_services s
         ON s.id = e.service_id
        AND s.organization_id = e.organization_id
        AND s.deleted_at IS NULL
       LEFT JOIN hr_positions p
         ON p.id = e.position_id
        AND p.organization_id = e.organization_id
        AND p.deleted_at IS NULL
       LEFT JOIN LATERAL (
         SELECT ec.contract_number, ec.contract_type, ec.end_date
         FROM employee_contracts ec
         WHERE ec.employee_id = e.id
           AND ec.organization_id = e.organization_id
           AND ec.deleted_at IS NULL
         ORDER BY CASE WHEN ec.status = 'ACTIVE' THEN 0 ELSE 1 END, ec.start_date DESC, ec.id DESC
         LIMIT 1
       ) c ON TRUE
       LEFT JOIN employee_attendance a
         ON a.employee_id = e.id
        AND a.organization_id = e.organization_id
        AND a.deleted_at IS NULL
        AND a.attendance_date = $2::DATE
       WHERE e.organization_id = $1 AND e.deleted_at IS NULL
       ORDER BY e.created_at DESC, e.id DESC`,
      [this.context.organizationId(), today],
      `SELECT e.*,
              CONCAT(e.first_name, ' ', COALESCE(e.post_name || ' ', ''), e.last_name) AS full_name,
              c.contract_number AS current_contract_number,
              c.contract_type AS current_contract_type,
              c.end_date AS current_contract_end_date,
              a.status AS attendance_status_today
       FROM employees e
       LEFT JOIN LATERAL (
         SELECT ec.contract_number, ec.contract_type, ec.end_date
         FROM employee_contracts ec
         WHERE ec.employee_id = e.id
           AND ec.organization_id = e.organization_id
           AND ec.deleted_at IS NULL
         ORDER BY CASE WHEN ec.status = 'ACTIVE' THEN 0 ELSE 1 END, ec.start_date DESC, ec.id DESC
         LIMIT 1
       ) c ON TRUE
       LEFT JOIN employee_attendance a
         ON a.employee_id = e.id
        AND a.organization_id = e.organization_id
        AND a.deleted_at IS NULL
        AND a.attendance_date = $2::DATE
       WHERE e.organization_id = $1 AND e.deleted_at IS NULL
       ORDER BY e.created_at DESC, e.id DESC`,
      [this.context.organizationId(), today],
    );
    return rows;
  }

  async createEmployee(body: Record<string, unknown>) {
    return this.db.transaction(async (client) => {
      const serviceId = this.normalizeOptionalPositiveInt(body.service_id ?? body.serviceId);
      const positionId = this.normalizeOptionalPositiveInt(body.position_id ?? body.positionId);
      const serviceName = await this.resolveHrCatalogName(client, 'hr_services', serviceId, body.department);
      const positionName = await this.resolveHrCatalogName(client, 'hr_positions', positionId, body.job_title);
      const providedEmployeeNumber = String(body.employee_number ?? '').trim();
      const employeeNumber = providedEmployeeNumber && !providedEmployeeNumber.toLowerCase().includes('automatique')
        ? providedEmployeeNumber
        : await this.nextEmployeeNumber(client);
      const contractPayload = this.normalizeInitialEmployeeContractPayload(body, {
        contractType: body.contract_type,
        startDate: body.contract_start_date ?? body.start_date ?? body.hire_date,
        endDate: body.contract_end_date ?? body.end_date,
        salaryAmount: body.contract_salary_amount ?? body.salary_amount ?? body.monthly_salary,
        currency: body.contract_currency ?? body.currency,
        jobTitle: positionName,
        department: serviceName,
        observations: body.contract_observations ?? body.observations,
        status: body.contract_status,
      });
      const payload = {
        ...body,
        service_id: serviceId,
        position_id: positionId,
        department: serviceName,
        job_title: positionName,
        employee_number: employeeNumber,
        monthly_salary: Number(body.monthly_salary ?? 0),
        status: body.status ?? 'ACTIVE',
      };
      const employee = await this.insertInTransaction(client, 'employees', payload, [
        'employee_number', 'first_name', 'last_name', 'post_name', 'gender', 'birth_date', 'nationality', 'marital_status',
        'phone', 'secondary_phone', 'email', 'address', 'service_id', 'position_id', 'job_title', 'department', 'hire_date', 'contract_type',
        'assigned_site', 'manager_name', 'status', 'monthly_salary', 'payment_method', 'bank_name', 'account_number',
        'mobile_money_number', 'id_document_type', 'id_document_number', 'identity_attachment_name', 'cv_attachment_name',
        'signed_contract_attachment_name', 'emergency_contact_name', 'emergency_contact_phone', 'internal_notes',
      ]);
      const contractNumber = await this.nextEmployeeContractNumber(client);
      const contract = await this.insertInTransaction(client, 'employee_contracts', {
        employee_id: employee.id,
        contract_number: contractNumber,
        ...contractPayload,
        created_by: this.context.userId() ?? 1,
      }, [
        'employee_id', 'contract_number', 'contract_type', 'start_date', 'end_date', 'salary_amount', 'currency',
        'job_title', 'department', 'contract_file_name', 'contract_file_url', 'observations', 'status', 'created_by',
      ]);
      return { ...employee, contract, contract_id: contract.id, contract_status: contract.status };
    });
  }

  async updateEmployee(id: number, body: Record<string, unknown>) {
    const serviceId = body.service_id !== undefined || body.serviceId !== undefined
      ? this.normalizeOptionalPositiveInt(body.service_id ?? body.serviceId)
      : undefined;
    const positionId = body.position_id !== undefined || body.positionId !== undefined
      ? this.normalizeOptionalPositiveInt(body.position_id ?? body.positionId)
      : undefined;
    const current = await this.db.query(
      `SELECT id, department, job_title, service_id, position_id
       FROM employees
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [id, this.context.organizationId()],
    );
    const employee = requireRow(current.rows[0], 'Employee');
    const serviceName = body.department !== undefined || serviceId !== undefined
      ? await this.resolveHrCatalogName(this.db, 'hr_services', serviceId ?? employee.service_id ?? null, body.department)
      : undefined;
    const positionName = body.job_title !== undefined || positionId !== undefined
      ? await this.resolveHrCatalogName(this.db, 'hr_positions', positionId ?? employee.position_id ?? null, body.job_title)
      : undefined;
    const payload = {
      ...body,
      service_id: serviceId,
      position_id: positionId,
      department: serviceName,
      job_title: positionName,
      monthly_salary: body.monthly_salary !== undefined ? Number(body.monthly_salary ?? 0) : undefined,
    };
    return this.updateById('employees', id, payload, [
      'employee_number', 'first_name', 'last_name', 'post_name', 'gender', 'birth_date', 'nationality', 'marital_status',
      'phone', 'secondary_phone', 'email', 'address', 'service_id', 'position_id', 'job_title', 'department', 'hire_date', 'contract_type',
      'assigned_site', 'manager_name', 'status', 'monthly_salary', 'payment_method', 'bank_name', 'account_number',
      'mobile_money_number', 'id_document_type', 'id_document_number', 'identity_attachment_name', 'cv_attachment_name',
      'signed_contract_attachment_name', 'emergency_contact_name', 'emergency_contact_phone', 'internal_notes',
    ]);
  }

  async employeeDetail(id: number) {
    const organizationId = this.context.organizationId();
    const employee = await this.queryOptionalRows(
      `SELECT e.*,
              COALESCE(s.name, e.department) AS department,
              COALESCE(p.name, e.job_title) AS job_title,
              CONCAT(e.first_name, ' ', COALESCE(e.post_name || ' ', ''), e.last_name) AS full_name
       FROM employees e
       LEFT JOIN hr_services s
         ON s.id = e.service_id
        AND s.organization_id = e.organization_id
        AND s.deleted_at IS NULL
       LEFT JOIN hr_positions p
         ON p.id = e.position_id
        AND p.organization_id = e.organization_id
        AND p.deleted_at IS NULL
       WHERE e.id = $1 AND e.organization_id = $2 AND e.deleted_at IS NULL`,
      [id, organizationId],
      `SELECT e.*, CONCAT(e.first_name, ' ', COALESCE(e.post_name || ' ', ''), e.last_name) AS full_name
       FROM employees e
       WHERE e.id = $1`,
      [id],
    );
    const advances = await this.queryOptionalRows(
      'SELECT * FROM salary_advances WHERE employee_id = $1 AND organization_id = $2 AND deleted_at IS NULL ORDER BY advance_date DESC, id DESC',
      [id, organizationId],
      'SELECT * FROM salary_advances WHERE employee_id = $1 ORDER BY advance_date DESC, id DESC',
      [id],
    );
    const leaves = await this.queryOptionalRows(
      'SELECT * FROM leaves WHERE employee_id = $1 AND organization_id = $2 AND deleted_at IS NULL ORDER BY start_date DESC, id DESC',
      [id, organizationId],
      'SELECT * FROM leaves WHERE employee_id = $1 ORDER BY start_date DESC, id DESC',
      [id],
    );
    const payrolls = await this.queryOptionalRows(
      'SELECT * FROM payrolls WHERE employee_id = $1 AND organization_id = $2 AND deleted_at IS NULL ORDER BY year DESC, month DESC',
      [id, organizationId],
      'SELECT * FROM payrolls WHERE employee_id = $1 ORDER BY year DESC, month DESC',
      [id],
    );
    const contracts = await this.queryOptionalRows(
      'SELECT * FROM employee_contracts WHERE employee_id = $1 AND organization_id = $2 AND deleted_at IS NULL ORDER BY start_date DESC, id DESC',
      [id, organizationId],
      'SELECT * FROM employee_contracts WHERE employee_id = $1 ORDER BY start_date DESC, id DESC',
      [id],
    );
    const attendance = await this.queryOptionalRows(
      `SELECT *
       FROM employee_monthly_attendance
       WHERE employee_id = $1 AND organization_id = $2 AND deleted_at IS NULL
       ORDER BY year DESC, month DESC, id DESC LIMIT 24`,
      [id, organizationId],
      `SELECT *
       FROM employee_monthly_attendance
       WHERE employee_id = $1
       ORDER BY year DESC, month DESC, id DESC LIMIT 24`,
      [id],
    );
    const audit = await this.queryOptionalRows(
      `SELECT action, resource, resource_id, status_code, metadata, created_at
       FROM audit_logs
       WHERE organization_id = $1
         AND deleted_at IS NULL
         AND (
           (resource = 'employees' AND resource_id = $2::TEXT)
           OR metadata::TEXT LIKE $3
         )
       ORDER BY created_at DESC
       LIMIT 40`,
      [organizationId, id, `%"employee_id":${id}%`],
    );
    const row = requireRow(employee[0], 'Employee');
    const documents = [
      row.identity_attachment_name ? { type: 'PiÃ¨ce identitÃ©', file_name: row.identity_attachment_name } : null,
      row.cv_attachment_name ? { type: 'CV', file_name: row.cv_attachment_name } : null,
      row.signed_contract_attachment_name ? { type: 'Contrat signÃ©', file_name: row.signed_contract_attachment_name } : null,
      ...contracts.filter((contract) => contract.contract_file_name).map((contract) => ({ type: 'Contrat RH', file_name: contract.contract_file_name })),
    ].filter(Boolean);
    const timeline = [
      { date: row.created_at, event: 'CrÃ©ation employÃ©', description: row.full_name },
      ...contracts.map((contract) => ({ date: contract.start_date, event: 'Contrat', description: `${contract.contract_number} - ${contract.contract_type}` })),
      ...advances.map((advance) => ({ date: advance.advance_date, event: 'Avance', description: `Montant ${advance.amount}` })),
      ...leaves.map((leave) => ({ date: leave.start_date, event: 'CongÃ©', description: `${leave.leave_type} - ${leave.status}` })),
      ...attendance.map((entry) => ({ date: `${entry.year}-${String(entry.month).padStart(2, '0')}-01`, event: 'Pointage mensuel', description: `${entry.month}/${entry.year} - ${entry.status}` })),
      ...payrolls.map((payroll) => ({ date: `${payroll.year}-${String(payroll.month).padStart(2, '0')}-01`, event: 'Paie', description: `${payroll.month}/${payroll.year} - ${payroll.status}` })),
    ].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return {
      ...row,
      current_contract: contracts[0] ?? null,
      contracts,
      advances,
      leaves,
      payrolls,
      attendance,
      latest_monthly_attendance: attendance[0] ?? null,
      documents,
      timeline,
      audit,
    };
  }

  async hrServices() {
    return this.queryOptionalRows(
      `SELECT *
       FROM hr_services
       WHERE organization_id = $1 AND deleted_at IS NULL
       ORDER BY LOWER(name) ASC, id ASC`,
      [this.context.organizationId()],
    );
  }

  async createHrService(body: Record<string, unknown>) {
    return this.createHrCatalogRow('hr_services', body);
  }

  async updateHrService(id: number, body: Record<string, unknown>) {
    return this.updateHrCatalogRow('hr_services', id, body);
  }

  async deactivateHrService(id: number) {
    return this.deactivateHrCatalogRow('hr_services', id);
  }

  async hrPositions() {
    return this.queryOptionalRows(
      `SELECT *
       FROM hr_positions
       WHERE organization_id = $1 AND deleted_at IS NULL
       ORDER BY LOWER(name) ASC, id ASC`,
      [this.context.organizationId()],
    );
  }

  async createHrPosition(body: Record<string, unknown>) {
    return this.createHrCatalogRow('hr_positions', body);
  }

  async updateHrPosition(id: number, body: Record<string, unknown>) {
    return this.updateHrCatalogRow('hr_positions', id, body);
  }

  async deactivateHrPosition(id: number) {
    return this.deactivateHrCatalogRow('hr_positions', id);
  }

  async deactivateEmployee(id: number) {
    const { rows } = await this.db.query(
      `UPDATE employees
       SET status = 'INACTIVE', updated_at = NOW()
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [id, this.context.organizationId()],
    );
    return requireRow(rows[0], 'Employee');
  }

  async salaryAdvances() {
    const { rows } = await this.db.query(`
      SELECT sa.*, CONCAT(e.first_name, ' ', e.last_name) AS employee_name
      FROM salary_advances sa
      JOIN employees e ON e.id = sa.employee_id
      WHERE sa.organization_id = $1 AND sa.deleted_at IS NULL
      ORDER BY sa.advance_date DESC, sa.id DESC
    `, [this.context.organizationId()]);
    return rows;
  }

  async createSalaryAdvance(body: Record<string, unknown>) {
    return this.db.transaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO salary_advances (employee_id, amount, advance_date, reason, payment_method, reference, repayment_schedule, observations, status, created_by, organization_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [
          body.employee_id,
          Number(body.amount ?? 0),
          body.advance_date ?? new Date().toISOString().slice(0, 10),
          body.reason ?? null,
          body.payment_method ?? null,
          body.reference ?? null,
          body.repayment_schedule ?? null,
          body.observations ?? null,
          body.workflow_required ? 'PENDING' : body.status ?? 'DRAFT',
          this.context.userId() ?? body.created_by ?? 1,
          this.context.organizationId(),
        ],
      );
      if (body.workflow_required) {
        const workflow = await this.createWorkflowInstanceInTransaction(client, {
          type: 'SALARY_ADVANCE_APPROVAL',
          entity_type: 'salary_advances',
          entity_id: rows[0].id,
          title: `Avance salaire #${rows[0].id}`,
          comment: body.reason ?? null,
        });
        await client.query('UPDATE salary_advances SET workflow_instance_id = $2 WHERE id = $1', [rows[0].id, workflow.id]);
        rows[0].workflow_instance_id = workflow.id;
      }
      return rows[0];
    });
  }

  async updateSalaryAdvanceStatus(id: number, status: string) {
    const { rows } = await this.db.query(
      `UPDATE salary_advances
       SET status = $3
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [id, this.context.organizationId(), status],
    );
    return requireRow(rows[0], 'Salary advance');
  }

  async paySalaryAdvance(id: number, reference?: string) {
    return this.db.transaction(async (client) => {
      const advance = await client.query(
        `SELECT sa.*, CONCAT(e.first_name, ' ', e.last_name) AS employee_name
         FROM salary_advances sa
         JOIN employees e ON e.id = sa.employee_id
         WHERE sa.id = $1 AND sa.organization_id = $2 AND sa.deleted_at IS NULL`,
        [id, this.context.organizationId()],
      );
      const row = requireRow(advance.rows[0], 'Salary advance');
      if (row.status === 'PAID') throw new BadRequestException('Cette avance est dÃ©jÃ  payÃ©e');
      await this.ensureWorkflowApproved(client, row.workflow_instance_id);
      if (!['APPROVED', 'PENDING', 'DRAFT'].includes(row.status)) throw new BadRequestException('Cette avance ne peut pas Ãªtre payÃ©e');
      const paid = await client.query(
        `UPDATE salary_advances SET status = 'PAID'
         WHERE id = $1 AND organization_id = $2 RETURNING *`,
        [id, this.context.organizationId()],
      );
      await this.createCashMovementInTransaction(client, {
        type: 'OUT',
        category: 'SALARY_ADVANCE',
        amount: Number(row.amount),
        movement_date: new Date().toISOString().slice(0, 10),
        employee_id: row.employee_id,
        description: row.reason ?? `Avance sur salaire - ${row.employee_name}`,
        reference: reference ?? `ADV-${row.id}`,
      });
      return paid.rows[0];
    });
  }

  async leaves(start = '2000-01-01', end = '2999-12-31') {
    const { rows } = await this.db.query(
      `SELECT l.*, CONCAT(e.first_name, ' ', e.last_name) AS employee_name, e.job_title
       FROM leaves l
       JOIN employees e ON e.id = l.employee_id
       WHERE l.organization_id = $1 AND l.deleted_at IS NULL
         AND l.start_date <= $3::DATE AND l.end_date >= $2::DATE
       ORDER BY l.start_date DESC, l.id DESC`,
      [this.context.organizationId(), start, end],
    );
    return rows;
  }

  async createLeave(body: Record<string, unknown>) {
    return this.db.transaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO leaves (employee_id, start_date, end_date, leave_type, reason, attachment_file_name, observations, status, organization_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          body.employee_id,
          body.start_date,
          body.end_date,
          body.leave_type,
          body.reason ?? null,
          body.attachment_file_name ?? null,
          body.observations ?? null,
          body.workflow_required ? 'PENDING' : body.status ?? 'PENDING',
          this.context.organizationId(),
        ],
      );
      if (body.workflow_required) {
        const workflow = await this.createWorkflowInstanceInTransaction(client, {
          type: 'LEAVE_APPROVAL',
          entity_type: 'leaves',
          entity_id: rows[0].id,
          title: `Demande congÃ© #${rows[0].id}`,
          comment: body.reason ?? null,
        });
        await client.query('UPDATE leaves SET workflow_instance_id = $2 WHERE id = $1', [rows[0].id, workflow.id]);
        rows[0].workflow_instance_id = workflow.id;
      }
      return rows[0];
    });
  }

  async updateLeave(id: number, body: Record<string, unknown>) {
    return this.updateById('leaves', id, body, ['employee_id', 'start_date', 'end_date', 'leave_type', 'reason', 'attachment_file_name', 'observations', 'status']);
  }

  async updateLeaveStatus(id: number, status: string) {
    if (status === 'APPROVED') {
      const wf = await this.db.query('SELECT workflow_instance_id FROM leaves WHERE id = $1 AND organization_id = $2', [id, this.context.organizationId()]);
      await this.db.transaction((client) => this.ensureWorkflowApproved(client, wf.rows[0]?.workflow_instance_id));
    }
    const { rows } = await this.db.query(
      `UPDATE leaves
       SET status = $3
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [id, this.context.organizationId(), status],
    );
    return requireRow(rows[0], 'Leave');
  }

  async payrolls(filters: { month?: number; year?: number; department?: string; status?: string; employeeId?: number } = {}) {
    const { rows } = await this.db.query(
      `SELECT p.*,
              CONCAT(e.first_name, ' ', COALESCE(e.post_name || ' ', ''), e.last_name) AS employee_name,
              e.job_title,
              e.department,
              e.employee_number
       FROM payrolls p
       JOIN employees e ON e.id = p.employee_id
       WHERE p.organization_id = $1 AND p.deleted_at IS NULL
         AND ($2::INT IS NULL OR p.month = $2)
         AND ($3::INT IS NULL OR p.year = $3)
         AND ($4::TEXT IS NULL OR e.department = $4)
         AND ($5::TEXT IS NULL OR p.status = $5)
         AND ($6::INT IS NULL OR p.employee_id = $6)
       ORDER BY p.year DESC, p.month DESC, e.last_name, e.first_name, p.id DESC`,
      [
        this.context.organizationId(),
        filters.month ?? null,
        filters.year ?? null,
        filters.department ?? null,
        filters.status ?? null,
        filters.employeeId ?? null,
      ],
    );
    return rows;
  }

  async payrollDetail(id: number) {
    const organizationId = this.context.organizationId();
    const primary = await this.tryPayrollDetailQuery(
      `SELECT p.*,
              CONCAT(e.first_name, ' ', COALESCE(e.post_name || ' ', ''), e.last_name) AS employee_name,
              e.employee_number,
              e.department,
              e.job_title
       FROM payrolls p
       JOIN employees e ON e.id = p.employee_id
       WHERE p.id = $1 AND p.organization_id = $2 AND p.deleted_at IS NULL`,
      [id, organizationId],
    );
    if (primary.length) {
      return requireRow(primary[0], 'Payroll');
    }
    const fallback = await this.tryPayrollDetailQuery(
      `SELECT p.*,
              CONCAT(e.first_name, ' ', COALESCE(e.post_name || ' ', ''), e.last_name) AS employee_name,
              e.employee_number,
              e.department,
              e.job_title
       FROM payrolls p
       JOIN employees e ON e.id = p.employee_id
       WHERE p.id = $1`,
      [id],
    );
    return requireRow(fallback[0], 'Payroll');
  }

  async generatePayroll(body: Record<string, unknown>) {
    const month = this.normalizeMonth(body.month);
    const year = this.normalizeYear(body.year);
    const employeeId = body.employee_id ? Number(body.employee_id) : null;
    const organizationId = this.context.organizationId();
    return this.db.transaction(async (client) => {
      const attendance = await client.query(
        `SELECT ema.*,
                e.monthly_salary,
                e.employee_number,
                e.department,
                e.job_title,
                CONCAT(e.first_name, ' ', COALESCE(e.post_name || ' ', ''), e.last_name) AS employee_name
         FROM employee_monthly_attendance ema
         JOIN employees e ON e.id = ema.employee_id
         WHERE ema.organization_id = $1
           AND ema.deleted_at IS NULL
           AND ema.month = $2
           AND ema.year = $3
           AND ema.status = 'VALIDATED'
           AND ($4::INT IS NULL OR ema.employee_id = $4)
           AND e.deleted_at IS NULL
         ORDER BY e.last_name, e.first_name`,
        [organizationId, month, year, employeeId],
      );
      if (!attendance.rows.length) {
        throw new BadRequestException('Aucun pointage mensuel validÃ© pour cette pÃ©riode.');
      }

      const generated: Record<string, unknown>[] = [];
      for (const entry of attendance.rows) {
        const existing = await client.query(
          `SELECT id, status
           FROM payrolls
           WHERE organization_id = $1 AND employee_id = $2 AND month = $3 AND year = $4 AND deleted_at IS NULL`,
          [organizationId, entry.employee_id, month, year],
        );
        if (existing.rows[0] && ['VALIDATED', 'PAID'].includes(String(existing.rows[0].status))) {
          generated.push(existing.rows[0]);
          continue;
        }

        const gross = Number(entry.monthly_salary ?? 0);
        if (Number(entry.working_days ?? 0) <= 0) {
          throw new BadRequestException(`Jours ouvrables invalides pour ${entry.employee_name}.`);
        }
        if (gross <= 0) {
          throw new BadRequestException(`Salaire mensuel manquant pour ${entry.employee_name}.`);
        }
        const advancesTotal = await this.monthlyAdvanceTotal(client, Number(entry.employee_id), month, year);
        const metrics = this.calculateMonthlyAttendanceMetrics(
          gross,
          Number(entry.working_days ?? 0),
          Number(entry.unjustified_absence_days ?? 0),
          advancesTotal,
        );
        const bonusAmount = Number(body.bonus_amount ?? 0);
        const overtimeAmount = Number(body.overtime_amount ?? 0);
        const deductionsTotal = Number(entry.absence_deduction ?? metrics.absenceDeduction);
        const netSalary = Math.max(gross - deductionsTotal - advancesTotal + bonusAmount + overtimeAmount, 0);

        const { rows } = await client.query(
          `INSERT INTO payrolls (
             employee_id, employee_monthly_attendance_id, month, year,
             gross_salary, daily_salary, working_days, present_days, paid_leave_days, sick_days,
             unjustified_absence_days, late_count, overtime_hours, advances_total, deductions_total,
             absence_deduction, bonus_amount, net_salary, status, organization_id
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
           ON CONFLICT (organization_id, employee_id, year, month) WHERE deleted_at IS NULL
           DO UPDATE SET employee_monthly_attendance_id = EXCLUDED.employee_monthly_attendance_id,
                         gross_salary = EXCLUDED.gross_salary,
                         daily_salary = EXCLUDED.daily_salary,
                         working_days = EXCLUDED.working_days,
                         present_days = EXCLUDED.present_days,
                         paid_leave_days = EXCLUDED.paid_leave_days,
                         sick_days = EXCLUDED.sick_days,
                         unjustified_absence_days = EXCLUDED.unjustified_absence_days,
                         late_count = EXCLUDED.late_count,
                         overtime_hours = EXCLUDED.overtime_hours,
                         advances_total = EXCLUDED.advances_total,
                         deductions_total = EXCLUDED.deductions_total,
                         absence_deduction = EXCLUDED.absence_deduction,
                         bonus_amount = EXCLUDED.bonus_amount,
                         net_salary = EXCLUDED.net_salary,
                         status = CASE WHEN payrolls.status IN ('VALIDATED', 'PAID') THEN payrolls.status ELSE EXCLUDED.status END,
                         updated_at = NOW()
           RETURNING *`,
          [
            entry.employee_id,
            entry.id,
            month,
            year,
            gross,
            metrics.dailySalary,
            entry.working_days,
            entry.present_days,
            entry.paid_leave_days,
            entry.sick_days,
            entry.unjustified_absence_days,
            entry.late_count,
            entry.overtime_hours,
            advancesTotal,
            deductionsTotal,
            deductionsTotal,
            bonusAmount,
            Number(netSalary.toFixed(2)),
            body.status ?? 'DRAFT',
            organizationId,
          ],
        );
        generated.push(rows[0]);
      }

      return employeeId ? generated[0] : generated;
    });
  }

  async updatePayrollStatus(id: number, status: string) {
    const { rows } = await this.db.query(
      `UPDATE payrolls
       SET status = $3
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [id, this.context.organizationId(), status],
    );
    return requireRow(rows[0], 'Payroll');
  }

  async payPayroll(id: number, reference?: string) {
    return this.db.transaction(async (client) => {
      const payroll = await client.query(
        `SELECT p.*, CONCAT(e.first_name, ' ', e.last_name) AS employee_name
         FROM payrolls p
         JOIN employees e ON e.id = p.employee_id
         WHERE p.id = $1 AND p.organization_id = $2 AND p.deleted_at IS NULL`,
        [id, this.context.organizationId()],
      );
      const row = requireRow(payroll.rows[0], 'Payroll');
      if (row.status === 'PAID') throw new BadRequestException('Cette paie est dÃ©jÃ  payÃ©e');
      if (!['VALIDATED', 'DRAFT'].includes(row.status)) throw new BadRequestException('Cette paie ne peut pas Ãªtre payÃ©e');
      const paid = await client.query(
        `UPDATE payrolls SET status = 'PAID', payment_date = CURRENT_DATE
         WHERE id = $1 AND organization_id = $2 RETURNING *`,
        [id, this.context.organizationId()],
      );
      await this.createCashMovementInTransaction(client, {
        type: 'OUT',
        category: 'SALARY_PAYMENT',
        amount: Number(row.net_salary),
        movement_date: new Date().toISOString().slice(0, 10),
        employee_id: row.employee_id,
        description: `Paiement salaire ${row.month}/${row.year} - ${row.employee_name}`,
        reference: reference ?? `PAY-${row.id}`,
      });
      return paid.rows[0];
    });
  }

  async openCash(body: Record<string, unknown>) {
    const exists = await this.db.query(`SELECT id FROM cash_sessions WHERE status = 'OPEN' AND organization_id = $1 AND deleted_at IS NULL LIMIT 1`, [
      this.context.organizationId(),
    ]);
    if (exists.rows[0]) throw new ConflictException('Une caisse est deja ouverte');
    try {
      return await this.insert('cash_sessions', { opened_by: this.context.userId() ?? 1, opening_balance: 0, status: 'OPEN', ...body }, [
        'opened_by',
        'opening_balance',
        'status',
      ]);
    } catch (error: any) {
      if (error?.code === '23505' && String(error?.message ?? '').includes('cash_one_open_session')) {
        throw new ConflictException('Une caisse est deja ouverte');
      }
      throw error;
    }
  }

  async closeCash(closingBalance: number) {
    return this.db.transaction(async (client) => {
      const session = await this.openSession(client);
      const totals = await client.query(
        `SELECT
           COALESCE(SUM(CASE WHEN type = 'IN' THEN amount ELSE 0 END), 0)::NUMERIC(12,2) AS total_in,
           COALESCE(SUM(CASE WHEN type = 'OUT' THEN amount ELSE 0 END), 0)::NUMERIC(12,2) AS total_out
         FROM cash_movements
         WHERE cash_session_id = $1
           AND organization_id = $2
           AND deleted_at IS NULL
           AND category NOT IN ('LEASE_GUARANTEE', 'LEASE_GUARANTEE_REFUND')`,
        [session.id, this.context.organizationId()],
      );
      const expected = Number(session.opening_balance) + Number(totals.rows[0].total_in) - Number(totals.rows[0].total_out);
      const { rows } = await client.query(
        `UPDATE cash_sessions
         SET status = 'CLOSED', closed_by = $4, closed_at = NOW(),
             closing_balance = $2::NUMERIC, expected_balance = $3::NUMERIC, difference_amount = $2::NUMERIC - $3::NUMERIC
         WHERE id = $1 RETURNING *`,
        [session.id, closingBalance, expected, this.context.userId() ?? 1],
      );
      return rows[0];
    });
  }

  async createCashMovement(body: Record<string, unknown>) {
    return this.db.transaction(async (client) => {
      const sourceRegister = String(body.source_register ?? 'MAIN_CASH').trim().toUpperCase();
      if (sourceRegister === 'BANK') {
        return this.createBankExpenseInTransaction(client, body);
      }
      if (body.workflow_required) {
        return this.createWorkflowInstanceInTransaction(client, {
          type: 'EXPENSE_APPROVAL',
          entity_type: 'cash_movements',
          entity_id: null,
          title: `Demande dÃ©pense ${body.category ?? 'caisse'} - ${Number(body.amount ?? 0)}`,
          comment: body.description ?? body.notes ?? null,
        });
      }
      await this.ensureWorkflowApproved(client, body.workflow_instance_id);
      return this.createCashMovementInTransaction(client, body);
    });
  }

  async createInvoicePaymentMovement(client: PoolClient, paymentId: number, invoiceId: number, amount: number, reference?: string | null, options: { currency?: string; exchangeRateUsed?: number | null; exchangeRateDate?: string | null; equivalentUsd?: number | null } = {}) {
    const session = await this.openSession(client);
    const invoice = await client.query('SELECT tenant_id FROM invoices WHERE id = $1 AND organization_id = $2', [invoiceId, this.context.organizationId()]);
    await client.query(
      `INSERT INTO cash_movements (cash_session_id, type, category, amount, movement_date, payment_id, invoice_id, tenant_id, description, reference, currency, exchange_rate_used, exchange_rate_date, equivalent_usd, created_by, organization_id)
       VALUES ($1, 'IN', 'INVOICE_PAYMENT', $2, CURRENT_DATE, $3, $4, $5, 'Paiement facture', $6, $7, $8, $9, $10, $11, $12)`,
      [
        session.id,
        amount,
        paymentId,
        invoiceId,
        invoice.rows[0]?.tenant_id ?? null,
        reference ?? null,
        options.currency ?? 'USD',
        options.exchangeRateUsed ?? null,
        options.exchangeRateDate ?? null,
        options.equivalentUsd ?? amount,
        this.context.userId() ?? 1,
        this.context.organizationId(),
      ],
    );
  }

  async createInvoicePaymentVentilation(client: PoolClient, args: {
    paymentId: number;
    primaryInvoiceId: number;
    paymentDate: string;
    paymentMethod: string;
    reference?: string | null;
    amountUsd: number;
    amountCdf: number;
    cdfEquivalentUsd: number;
    exchangeRateUsed?: number | null;
    exchangeRateDate?: string | null;
  }) {
    await this.ensureSyndicCashSchema(client);
    const organizationId = this.context.organizationId();
    const allocationResult = await client.query(
      `SELECT pa.invoice_id,
              pa.amount::FLOAT AS allocated_amount,
              i.tenant_id,
              COALESCE(lines.total_amount, i.total, 0)::FLOAT AS invoice_amount,
              COALESCE(lines.syndic_amount, 0)::FLOAT AS syndic_amount
       FROM payment_allocations pa
       JOIN invoices i
         ON i.id = pa.invoice_id
        AND i.organization_id = pa.organization_id
        AND i.deleted_at IS NULL
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(ii.amount), 0) AS total_amount,
                COALESCE(SUM(
                  CASE
                    WHEN UPPER(TRIM(COALESCE(ii.item_type, ''))) = 'SYNDIC'
                      OR UPPER(TRIM(COALESCE(ii.description, ''))) LIKE 'SYNDIC%'
                    THEN ii.amount ELSE 0
                  END
                ), 0) AS syndic_amount
         FROM invoice_items ii
         WHERE ii.invoice_id = i.id
           AND ii.organization_id = i.organization_id
           AND ii.deleted_at IS NULL
       ) lines ON TRUE
       WHERE pa.payment_id = $1
         AND pa.organization_id = $2
         AND pa.deleted_at IS NULL
       ORDER BY pa.id`,
      [args.paymentId, organizationId],
    );
    const breakdown = allocationResult.rows.map((row) => {
      const invoiceAmount = Number(row.invoice_amount ?? 0);
      const syndicAmount = Number(row.syndic_amount ?? 0);
      const allocatedAmount = Number(row.allocated_amount ?? 0);
      const syndicRatio = invoiceAmount > 0 ? Math.min(Math.max(syndicAmount / invoiceAmount, 0), 1) : 0;
      return {
        invoice_id: Number(row.invoice_id),
        allocated_amount: allocatedAmount,
        syndic_ratio: Number(syndicRatio.toFixed(8)),
        syndic_equivalent_usd: Number((allocatedAmount * syndicRatio).toFixed(2)),
        tenant_id: Number(row.tenant_id ?? 0) || null,
      };
    });
    const allocationTotal = breakdown.reduce((sum, row) => sum + row.allocated_amount, 0);
    const syndicEquivalentTotal = breakdown.reduce((sum, row) => sum + row.syndic_equivalent_usd, 0);
    const syndicRatio = allocationTotal > 0
      ? Math.min(Math.max(syndicEquivalentTotal / allocationTotal, 0), 1)
      : 0;
    const tenantId = breakdown.find((row) => row.tenant_id)?.tenant_id ?? null;
    const treasuryLocation = args.paymentMethod === 'BANK' ? 'BANK' : 'MAIN_CASH';

    const currencies = [
      { currency: 'USD', amount: args.amountUsd, equivalentUsd: args.amountUsd },
      { currency: 'CDF', amount: args.amountCdf, equivalentUsd: args.cdfEquivalentUsd },
    ].filter((entry) => entry.amount > 0);

    for (const entry of currencies) {
      const syndicAmount = Number((entry.amount * syndicRatio).toFixed(2));
      const syndicEquivalentUsd = Number((entry.equivalentUsd * syndicRatio).toFixed(2));
      const rentAmount = Number((entry.amount - syndicAmount).toFixed(2));
      const rentEquivalentUsd = Number((entry.equivalentUsd - syndicEquivalentUsd).toFixed(2));

      if (args.paymentMethod !== 'BANK' && rentAmount > 0) {
        await this.createInvoicePaymentMovement(client, args.paymentId, args.primaryInvoiceId, rentAmount, args.reference, {
          currency: entry.currency,
          exchangeRateUsed: entry.currency === 'CDF' ? args.exchangeRateUsed : null,
          exchangeRateDate: entry.currency === 'CDF' ? args.exchangeRateDate : null,
          equivalentUsd: rentEquivalentUsd,
        });
        await client.query(
          `UPDATE cash_movements
           SET movement_date = $2,
               description = 'Paiement loyer (hors syndic)'
           WHERE payment_id = $1
             AND organization_id = $3
             AND currency = $4
             AND deleted_at IS NULL`,
          [args.paymentId, args.paymentDate, organizationId, entry.currency],
        );
      }

      if (syndicAmount > 0) {
        await client.query(
          `INSERT INTO syndic_cash_movements (
             organization_id, type, movement_type, amount, currency, equivalent_usd,
             exchange_rate_used, exchange_rate_date, movement_date, payment_id, invoice_id,
             tenant_id, payment_method, treasury_location, reference, description,
             allocation_breakdown, created_by
           ) VALUES (
             $1, 'IN', 'SYNDIC_PAYMENT', $2, $3, $4,
             $5, $6, $7, $8, $9,
             $10, $11, $12, $13, 'Paiement syndic',
             $14::JSONB, $15
           )`,
          [
            organizationId,
            syndicAmount,
            entry.currency,
            syndicEquivalentUsd,
            entry.currency === 'CDF' ? args.exchangeRateUsed ?? null : null,
            entry.currency === 'CDF' ? args.exchangeRateDate ?? null : null,
            args.paymentDate,
            args.paymentId,
            args.primaryInvoiceId,
            tenantId,
            args.paymentMethod,
            treasuryLocation,
            args.reference ?? null,
            JSON.stringify(breakdown),
            this.context.userId() ?? 1,
          ],
        );
      }
    }

    return {
      syndic_ratio: Number(syndicRatio.toFixed(8)),
      syndic_equivalent_usd: Number((args.amountUsd * syndicRatio + args.cdfEquivalentUsd * syndicRatio).toFixed(2)),
    };
  }

  async cashExpenseCategories() {
    try {
      return await this.findAll('cash_expense_categories', 'name');
    } catch (error) {
      this.handleCashExpenseCategorySchemaError(error);
      throw error;
    }
  }

  async createCashExpenseCategory(body: Record<string, unknown>) {
    const payload = this.normalizeCashExpenseCategoryPayload(body);
    try {
      return await this.insert('cash_expense_categories', payload, ['code', 'name', 'description', 'status']);
    } catch (error: any) {
      if (error?.code === '23505') {
        throw new ConflictException('Une catÃ©gorie de dÃ©pense avec ce code ou ce nom existe dÃ©jÃ .');
      }
      this.handleCashExpenseCategorySchemaError(error);
      throw error;
    }
  }

  async updateCashExpenseCategory(id: number, body: Record<string, unknown>) {
    const payload = this.normalizeCashExpenseCategoryPayload(body);
    try {
      const { rows } = await this.db.query(
        `UPDATE cash_expense_categories
         SET code = $2,
             name = $3,
             description = $4,
             status = $5,
             updated_at = NOW()
         WHERE id = $1 AND organization_id = $6 AND deleted_at IS NULL
         RETURNING *`,
        [id, payload.code, payload.name, payload.description, payload.status, this.context.organizationId()],
      );
      return requireRow(rows[0], 'Cash expense category');
    } catch (error: any) {
      if (error?.code === '23505') {
        throw new ConflictException('Une catÃ©gorie de dÃ©pense avec ce code ou ce nom existe dÃ©jÃ .');
      }
      this.handleCashExpenseCategorySchemaError(error);
      throw error;
    }
  }

  async cashMovements() {
    const hasShareholderSchema = await this.hasShareholderPayoutSchema();
    const supportsStockPurchaseId = await this.columnExists('cash_movements', 'stock_purchase_id');
    const shareholderSelect = hasShareholderSchema
      ? `,
             spl.id AS shareholder_payout_line_id,
             spl.batch_id AS shareholder_batch_id,
             spl.shareholder_id,
             sh.display_name AS shareholder_name`
      : `,
             NULL::INT AS shareholder_payout_line_id,
             NULL::INT AS shareholder_batch_id,
             NULL::INT AS shareholder_id,
             NULL::VARCHAR AS shareholder_name`;
    const shareholderJoin = hasShareholderSchema
      ? `
      LEFT JOIN shareholder_payout_lines spl ON spl.cash_movement_id = cm.id AND spl.organization_id = cm.organization_id AND spl.deleted_at IS NULL
      LEFT JOIN shareholders sh ON sh.id = spl.shareholder_id AND sh.organization_id = spl.organization_id`
      : '';
    const { rows } = await this.db.query(`
      SELECT cm.*, cs.status AS session_status,
             COALESCE(cm.invoice_id, p.invoice_id) AS invoice_id,
             COALESCE(i.invoice_number, pi.invoice_number) AS invoice_number,
             CONCAT(t.first_name, ' ', t.last_name) AS tenant_name,
             CONCAT(e.first_name, ' ', e.last_name) AS employee_name
             ${shareholderSelect},
             FALSE AS is_locked,
             NULL::VARCHAR AS locked_reason
      FROM cash_movements cm
      JOIN cash_sessions cs ON cs.id = cm.cash_session_id
      LEFT JOIN payments p ON p.id = cm.payment_id AND p.organization_id = cm.organization_id
      LEFT JOIN invoices i ON i.id = cm.invoice_id
      LEFT JOIN invoices pi ON pi.id = p.invoice_id
      LEFT JOIN tenants t ON t.id = cm.tenant_id
      LEFT JOIN employees e ON e.id = cm.employee_id
      ${shareholderJoin}
      WHERE cm.organization_id = $1
        AND cm.deleted_at IS NULL
        AND cm.category NOT IN ('LEASE_GUARANTEE', 'LEASE_GUARANTEE_REFUND')
      ORDER BY cm.movement_date DESC, cm.id DESC
    `, [this.context.organizationId()]);
    return rows;
  }

  async cashMovementDetail(id: number) {
    const hasShareholderSchema = await this.hasShareholderPayoutSchema();
    const supportsStockPurchaseId = await this.columnExists('cash_movements', 'stock_purchase_id');
    const shareholderSelect = hasShareholderSchema
      ? `,
              spl.id AS shareholder_payout_line_id,
              spl.batch_id AS shareholder_batch_id,
              spl.shareholder_id,
              sh.display_name AS shareholder_name`
      : `,
              NULL::INT AS shareholder_payout_line_id,
              NULL::INT AS shareholder_batch_id,
              NULL::INT AS shareholder_id,
              NULL::VARCHAR AS shareholder_name`;
    const shareholderJoin = hasShareholderSchema
      ? `
       LEFT JOIN shareholder_payout_lines spl ON spl.cash_movement_id = cm.id AND spl.organization_id = cm.organization_id AND spl.deleted_at IS NULL
       LEFT JOIN shareholders sh ON sh.id = spl.shareholder_id AND sh.organization_id = spl.organization_id`
      : '';
    const { rows } = await this.db.query(
      `SELECT cm.*, cs.status AS session_status, cs.opened_at, cs.closed_at, cs.opening_balance, cs.closing_balance,
              COALESCE(cm.invoice_id, p.invoice_id) AS invoice_id,
              cs.expected_balance, cs.difference_amount,
              COALESCE(i.invoice_number, pi.invoice_number) AS invoice_number,
              COALESCE(i.total, pi.total) AS invoice_total, COALESCE(i.status, pi.status) AS invoice_status,
              CONCAT(t.first_name, ' ', t.last_name) AS tenant_name,
              t.phone AS tenant_phone, t.email AS tenant_email,
              CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
              u.number AS unit_number, b.name AS building_name
              ${shareholderSelect},
              FALSE AS is_locked,
              NULL::VARCHAR AS locked_reason,
              al.action AS audit_action, al.created_at AS audit_date, al.metadata AS audit_metadata
       FROM cash_movements cm
       JOIN cash_sessions cs ON cs.id = cm.cash_session_id
       LEFT JOIN payments p ON p.id = cm.payment_id AND p.organization_id = cm.organization_id
       LEFT JOIN invoices i ON i.id = cm.invoice_id
       LEFT JOIN invoices pi ON pi.id = p.invoice_id
       LEFT JOIN tenants t ON t.id = cm.tenant_id
       LEFT JOIN employees e ON e.id = cm.employee_id
       LEFT JOIN units u ON u.id = COALESCE(i.unit_id, pi.unit_id)
       LEFT JOIN buildings b ON b.id = COALESCE(i.building_id, pi.building_id, u.building_id)
       ${shareholderJoin}
       LEFT JOIN LATERAL (
         SELECT action, created_at, metadata
         FROM audit_logs
         WHERE organization_id = $2 AND resource = 'cash' AND resource_id = cm.id::TEXT
         ORDER BY created_at DESC
         LIMIT 1
       ) al ON TRUE
       WHERE cm.id = $1
         AND cm.organization_id = $2
         AND cm.deleted_at IS NULL
         AND cm.category NOT IN ('LEASE_GUARANTEE', 'LEASE_GUARANTEE_REFUND')`,
      [id, this.context.organizationId()],
    );
    const movement = requireRow(rows[0], 'Cash movement');
    const editPolicy = await this.resolveCashMovementEditPolicy(movement as Record<string, unknown>);
    const timeline = await this.db.query(
      `SELECT id, created_at AS date, action, resource, method, path, status_code, metadata
       FROM audit_logs
       WHERE organization_id = $1 AND resource = 'cash' AND resource_id = $2::TEXT
       ORDER BY created_at DESC`,
      [this.context.organizationId(), String(id)],
    );
    const documents = [
      { name: 'ReÃ§u PDF', exists: true, detail: `Mouvement_${movement.id}.pdf` },
      {
        name: 'PiÃ¨ce jointe',
        exists: Boolean((movement as Record<string, unknown>).attachment_file_name),
        detail: String((movement as Record<string, unknown>).attachment_file_name ?? 'Non disponible'),
      },
      { name: 'QR Code', exists: true, detail: 'Placeholder' },
      { name: 'Code barre', exists: true, detail: 'Placeholder' },
    ];
    return {
      ...movement,
      editable: editPolicy.editable,
      edit_block_reason: editPolicy.reason,
      edit_source_type: editPolicy.sourceType,
      edit_source_id: editPolicy.sourceId,
      edit_source_route: editPolicy.sourceRoute,
      edit_source_label: editPolicy.sourceLabel,
      timeline: timeline.rows,
      documents,
      history: timeline.rows,
    };
  }

  async updateCashMovement(id: number, body: Record<string, unknown>) {
    if (!this.hasPermission('cash.update')) {
      throw new ForbiddenException('Permission requise pour modifier un mouvement de caisse.');
    }

    const reason = String(body.reason ?? body.modification_reason ?? '').trim();
    if (!reason) {
      throw new BadRequestException('Le motif de modification est obligatoire.');
    }

    return this.db.transaction(async (client) => {
      const movementResult = await client.query(
        `SELECT cm.*, cs.status AS session_status
         FROM cash_movements cm
         JOIN cash_sessions cs ON cs.id = cm.cash_session_id
         WHERE cm.id = $1
           AND cm.organization_id = $2
           AND cm.deleted_at IS NULL
         FOR UPDATE`,
        [id, this.context.organizationId()],
      );
      const movement = requireRow(movementResult.rows[0], 'Cash movement') as Record<string, unknown>;
      const policy = await this.resolveCashMovementEditPolicy(movement);

      if (!policy.editable) {
        throw new ConflictException({
          code: 'CASH_MOVEMENT_DIRECT_EDIT_FORBIDDEN',
          message: policy.reason ?? 'La modification directe de ce mouvement de caisse est interdite.',
          sourceType: policy.sourceType,
          sourceId: policy.sourceId,
          sourceRoute: policy.sourceRoute,
          sourceLabel: policy.sourceLabel,
        });
      }

      const originalCurrency = String(movement.currency ?? 'USD').toUpperCase();
      const nextCurrency = body.currency === undefined
        ? originalCurrency
        : String(body.currency ?? '').trim().toUpperCase();
      if (!['USD', 'CDF'].includes(nextCurrency)) {
        throw new BadRequestException('Devise invalide. Utilisez USD ou CDF.');
      }
      if (nextCurrency !== originalCurrency) {
        throw new BadRequestException('Le changement de devise est interdit pour prÃ©server la cohÃ©rence des agrÃ©gats.');
      }

      const nextAmount = body.amount === undefined ? Number(movement.amount ?? 0) : Number(body.amount ?? 0);
      if (!Number.isFinite(nextAmount) || nextAmount <= 0) {
        throw new BadRequestException('Le montant doit Ãªtre supÃ©rieur Ã  zÃ©ro.');
      }

      const nextDate = body.movement_date === undefined
        ? String(movement.movement_date ?? '').slice(0, 10)
        : String(body.movement_date ?? '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) {
        throw new BadRequestException('Date de mouvement invalide.');
      }

      const nextCategory = body.category === undefined
        ? String(movement.category ?? '').trim()
        : String(body.category ?? '').trim();
      if (!nextCategory) {
        throw new BadRequestException('La catÃ©gorie est obligatoire.');
      }

      const nextExchangeRate = nextCurrency === 'CDF'
        ? Number(body.exchange_rate_used === undefined ? movement.exchange_rate_used ?? 0 : body.exchange_rate_used)
        : null;
      if (nextCurrency === 'CDF' && (!Number.isFinite(nextExchangeRate) || Number(nextExchangeRate) <= 0)) {
        throw new BadRequestException('Le taux de change est obligatoire pour un mouvement en CDF.');
      }

      const nextEquivalentUsd = nextCurrency === 'CDF'
        ? Number((nextAmount / Number(nextExchangeRate)).toFixed(2))
        : nextAmount;

      const updateSets = [
        'label = $1',
        'category = $2',
        'amount = $3',
        'movement_date = $4',
        'supplier = $5',
        'description = $6',
        'reference = $7',
        'attachment_file_name = $8',
        'attachment_file_url = $9',
      ];
      const updateValues: unknown[] = [
        body.label === undefined ? movement.label ?? null : String(body.label ?? '').trim() || null,
        nextCategory,
        nextAmount,
        nextDate,
        body.supplier === undefined ? movement.supplier ?? null : String(body.supplier ?? '').trim() || null,
        body.description === undefined ? movement.description ?? null : String(body.description ?? '').trim() || null,
        body.reference === undefined ? movement.reference ?? null : String(body.reference ?? '').trim() || null,
        body.attachment_file_name === undefined ? movement.attachment_file_name ?? null : String(body.attachment_file_name ?? '').trim() || null,
        body.attachment_file_url === undefined ? movement.attachment_file_url ?? null : String(body.attachment_file_url ?? '').trim() || null,
      ];

      if (await this.columnExists('cash_movements', 'currency')) {
        updateValues.push(nextCurrency);
        updateSets.push(`currency = $${updateValues.length}`);
      }
      if (await this.columnExists('cash_movements', 'exchange_rate_used')) {
        updateValues.push(nextCurrency === 'CDF' ? Number(nextExchangeRate) : null);
        updateSets.push(`exchange_rate_used = $${updateValues.length}`);
      }
      if (await this.columnExists('cash_movements', 'exchange_rate_date')) {
        const nextExchangeDate = nextCurrency === 'CDF'
          ? (body.exchange_rate_date === undefined
              ? movement.exchange_rate_date ?? nextDate
              : String(body.exchange_rate_date ?? '').trim() || nextDate)
          : null;
        updateValues.push(nextExchangeDate);
        updateSets.push(`exchange_rate_date = $${updateValues.length}`);
      }
      if (await this.columnExists('cash_movements', 'equivalent_usd')) {
        updateValues.push(nextEquivalentUsd);
        updateSets.push(`equivalent_usd = $${updateValues.length}`);
      }

      updateValues.push(id, this.context.organizationId());
      const updatedResult = await client.query(
        `UPDATE cash_movements
         SET ${updateSets.join(', ')}
         WHERE id = $${updateValues.length - 1}
           AND organization_id = $${updateValues.length}
           AND deleted_at IS NULL
         RETURNING *`,
        updateValues,
      );
      const updated = requireRow(updatedResult.rows[0], 'Cash movement');

      await client.query(
        `INSERT INTO audit_logs (organization_id, user_id, action, resource, resource_id, method, path, status_code, metadata)
         VALUES ($1, $2, $3, 'cash', $4, 'PATCH', $5, 200, $6::JSONB)`,
        [
          this.context.organizationId(),
          this.context.userId() ?? null,
          'CASH_MOVEMENT_UPDATED',
          String(id),
          `/api/cash/movements/${id}`,
          JSON.stringify({
            reason,
            before: {
              label: movement.label ?? null,
              category: movement.category ?? null,
              amount: movement.amount ?? null,
              currency: movement.currency ?? originalCurrency,
              movement_date: movement.movement_date ?? null,
              supplier: movement.supplier ?? null,
              reference: movement.reference ?? null,
              description: movement.description ?? null,
              attachment_file_name: movement.attachment_file_name ?? null,
              exchange_rate_used: movement.exchange_rate_used ?? null,
              exchange_rate_date: movement.exchange_rate_date ?? null,
              equivalent_usd: movement.equivalent_usd ?? null,
            },
            after: {
              label: updated.label ?? null,
              category: updated.category ?? null,
              amount: updated.amount ?? null,
              currency: updated.currency ?? nextCurrency,
              movement_date: updated.movement_date ?? null,
              supplier: updated.supplier ?? null,
              reference: updated.reference ?? null,
              description: updated.description ?? null,
              attachment_file_name: updated.attachment_file_name ?? null,
              exchange_rate_used: updated.exchange_rate_used ?? null,
              exchange_rate_date: updated.exchange_rate_date ?? null,
              equivalent_usd: updated.equivalent_usd ?? null,
            },
          }),
        ],
      );

      return this.cashMovementDetail(id);
    });
  }

  async trashedCashMovements() {
    const { rows } = await this.db.query(
      `SELECT cm.id,
              cm.type,
              cm.category,
              cm.amount,
              cm.currency,
              cm.movement_date,
              cm.reference,
              cm.payment_id,
              COALESCE(cm.invoice_id, p.invoice_id) AS invoice_id,
              COALESCE(i.invoice_number, pi.invoice_number) AS invoice_number,
              cm.deleted_at,
              cm.deletion_reason,
              cm.organization_id,
              COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''), u.email) AS deleted_by_name,
              CASE
                WHEN t.tenant_type = 'COMPANY' THEN COALESCE(t.company_name, '')
                ELSE TRIM(CONCAT(COALESCE(t.first_name, ''), ' ', COALESCE(t.last_name, ''), ' ', COALESCE(t.post_name, '')))
              END AS tenant_name
       FROM cash_movements cm
       LEFT JOIN payments p ON p.id = cm.payment_id AND p.organization_id = cm.organization_id
       LEFT JOIN invoices i ON i.id = cm.invoice_id
       LEFT JOIN invoices pi ON pi.id = p.invoice_id
       LEFT JOIN tenants t ON t.id = COALESCE(i.tenant_id, pi.tenant_id, cm.tenant_id)
       LEFT JOIN app_users u ON u.id = cm.deleted_by
       WHERE cm.organization_id = $1
         AND cm.deleted_at IS NOT NULL
       ORDER BY cm.deleted_at DESC, cm.id DESC`,
      [this.context.organizationId()],
    );
    return rows;
  }

  async deleteCashMovement(id: number, body?: Record<string, unknown>) {
    if (!this.hasPermission('cash_movements.delete')) {
      throw new ForbiddenException('Permission requise pour supprimer un mouvement de caisse.');
    }
    const deletionReason = String(body?.reason ?? '').trim();
    if (!deletionReason) {
      throw new BadRequestException('Le motif de suppression est obligatoire.');
    }
    const supportsStockPurchaseId = await this.columnExists('cash_movements', 'stock_purchase_id');
    const supportsMaintenanceExpenseId = await this.columnExists('cash_movements', 'maintenance_expense_id');
    const supportsStockPurchasePaymentId = await this.columnExists('cash_movements', 'stock_purchase_payment_id');
    const supportsTreasuryTransferId = await this.columnExists('cash_movements', 'treasury_transfer_id');
    const supportsTenantCreditId = await this.columnExists('cash_movements', 'tenant_credit_id');
    const supportsShareholderPayoutLineId = await this.columnExists('cash_movements', 'shareholder_payout_line_id');
    const supportsCashExpenseCategories = await this.tableExists('cash_expense_categories');
    const hasShareholderSchema = await this.hasShareholderPayoutSchema();
    const supportsShareholderTrash = hasShareholderSchema
      && (await this.columnExists('shareholder_payout_lines', 'deleted_at'))
      && (await this.columnExists('shareholder_payout_batches', 'deleted_at'));
    this.logger.log(
      `cash delete requested | requestedCashMovementId=${id} organizationId=${this.context.organizationId()} supportsShareholderTrash=${supportsShareholderTrash}`,
    );
    return this.db.transaction(async (client) => {
      const movementResult = await client.query(
        `SELECT id, type, payment_id, invoice_id, category, piece_number, amount, currency, reference, movement_date, organization_id, deleted_at
                ${supportsStockPurchaseId ? ', stock_purchase_id' : ', NULL::INT AS stock_purchase_id'}
                ${supportsMaintenanceExpenseId ? ', maintenance_expense_id' : ', NULL::INT AS maintenance_expense_id'}
                ${supportsStockPurchasePaymentId ? ', stock_purchase_payment_id' : ', NULL::INT AS stock_purchase_payment_id'}
                ${supportsTreasuryTransferId ? ', treasury_transfer_id' : ', NULL::INT AS treasury_transfer_id'}
                ${supportsTenantCreditId ? ', tenant_credit_id' : ', NULL::INT AS tenant_credit_id'}
                ${supportsShareholderPayoutLineId ? ', shareholder_payout_line_id' : ', NULL::INT AS shareholder_payout_line_id'}
         FROM cash_movements
         WHERE id = $1
           AND organization_id = $2
           AND deleted_at IS NULL
         FOR UPDATE`,
        [id, this.context.organizationId()],
      );
      this.logger.log(
        `cash delete lookup | requestedCashMovementId=${id} organizationId=${this.context.organizationId()} movementFound=${Boolean(movementResult.rows[0])}`,
      );
      const movement = requireRow(movementResult.rows[0], 'Cash movement') as Record<string, unknown>;
      this.logger.log(
        `cash delete resolved | requestedCashMovementId=${id} organizationId=${this.context.organizationId()} sourceType=${String(movement.category ?? 'UNKNOWN')} sourceId=${movement.payment_id ?? movement.invoice_id ?? movement.maintenance_expense_id ?? movement.stock_purchase_payment_id ?? movement.stock_purchase_id ?? null}`,
      );
      const workflow = await this.resolveCashMovementTrashWorkflow(client, id, movement, {
        supportsShareholderTrash,
        supportsCashExpenseCategories,
      });
      switch (workflow.type) {
        case 'PAYMENT':
          if (!workflow.sourceId) {
            this.throwCashMovementWorkflowNotImplemented(id, movement, workflow.type, workflow.sourceId);
          }
          return this.trashPaymentInTransaction(client, workflow.sourceId, deletionReason, {
            auditAction: 'CASH_PAYMENT_MOVED_TO_TRASH',
            auditResource: 'cash',
            auditResourceId: String(id),
            sourceMovementId: id,
          });
        case 'SHAREHOLDER_PAYOUT':
          if (!workflow.sourceId) {
            this.throwCashMovementWorkflowNotImplemented(id, movement, workflow.type, workflow.sourceId);
          }
          return this.trashShareholderPayoutInTransaction(client, workflow.sourceId, deletionReason, {
            auditAction: 'SHAREHOLDER_PAYOUT_MOVED_TO_TRASH_FROM_CASH',
            auditResource: 'cash',
            auditResourceId: String(id),
            sourceMovementId: id,
          });
        case 'MAINTENANCE_EXPENSE':
        case 'EXPENSE':
          if (!workflow.sourceId) {
            this.throwCashMovementWorkflowNotImplemented(id, movement, workflow.type, workflow.sourceId);
          }
          return this.trashExpenseInTransaction(client, workflow.sourceId, deletionReason, {
            auditAction: workflow.type === 'EXPENSE'
              ? 'CASH_EXPENSE_MOVED_TO_TRASH_FROM_CASH'
              : 'MAINTENANCE_EXPENSE_MOVED_TO_TRASH_FROM_CASH',
            auditResource: workflow.type === 'EXPENSE' ? 'cash' : 'cash',
            auditResourceId: String(id),
            sourceMovementId: id,
          });
        case 'STOCK_PURCHASE':
          if (!workflow.sourceId) {
            this.throwCashMovementWorkflowNotImplemented(id, movement, workflow.type, workflow.sourceId);
          }
          return this.trashPurchasePaymentInTransaction(client, workflow.sourceId, deletionReason, {
            auditAction: 'STOCK_PURCHASE_PAYMENT_MOVED_TO_TRASH_FROM_CASH',
            auditResource: 'cash',
            auditResourceId: String(id),
            sourceMovementId: id,
          });
        case 'TENANT_CREDIT':
          if (!workflow.sourceId) {
            this.throwCashMovementWorkflowNotImplemented(id, movement, workflow.type, workflow.sourceId);
          }
          return this.trashTenantCreditInTransaction(client, workflow.sourceId, deletionReason, {
            auditAction: 'TENANT_CREDIT_MOVED_TO_TRASH_FROM_CASH',
            auditResource: 'cash',
            auditResourceId: String(id),
            sourceMovementId: id,
          });
        case 'TENANT_CREDIT_REFUND':
          if (!workflow.sourceId) {
            this.throwCashMovementWorkflowNotImplemented(id, movement, workflow.type, workflow.sourceId);
          }
          return this.trashTenantCreditRefundInTransaction(client, workflow.sourceId, deletionReason, {
            auditAction: 'TENANT_CREDIT_REFUND_MOVED_TO_TRASH_FROM_CASH',
            auditResource: 'cash',
            auditResourceId: String(id),
            sourceMovementId: id,
          });
        case 'GUARANTEE_REFUND':
          if (!workflow.sourceId) {
            this.throwCashMovementWorkflowNotImplemented(id, movement, workflow.type, workflow.sourceId);
          }
          return this.trashGuaranteeRefundInTransaction(client, workflow.sourceId, deletionReason, {
            auditAction: 'GUARANTEE_REFUND_MOVED_TO_TRASH_FROM_CASH',
            auditResource: 'cash',
            auditResourceId: String(id),
            sourceMovementId: id,
          });
        default:
          this.throwCashMovementWorkflowNotImplemented(id, movement, workflow.type, workflow.sourceId);
      }
    });
  }

  private async resolveCashMovementEditPolicy(movement: Record<string, unknown>) {
    const sessionStatus = String(movement.session_status ?? '').toUpperCase();
    if (sessionStatus && sessionStatus !== 'OPEN') {
      return {
        editable: false,
        reason: 'La session de caisse est clÃ´turÃ©e. Utilisez une Ã©criture de correction ou une contrepassation traÃ§able.',
        sourceType: null,
        sourceId: null,
        sourceRoute: null,
        sourceLabel: null,
      };
    }

    if (Boolean(movement.is_locked)) {
      return {
        editable: false,
        reason: String(movement.locked_reason ?? 'Ce mouvement est verrouillÃ© ou rapprochÃ© et ne peut pas Ãªtre modifiÃ© directement.'),
        sourceType: null,
        sourceId: null,
        sourceRoute: null,
        sourceLabel: null,
      };
    }

    const category = String(movement.category ?? '').trim().toUpperCase();
    const paymentId = Number(movement.payment_id ?? 0) || null;
    const invoiceId = Number(movement.invoice_id ?? 0) || null;
    const tenantCreditId = Number(movement.tenant_credit_id ?? 0) || null;
    const stockPurchasePaymentId = Number(movement.stock_purchase_payment_id ?? 0) || null;
    const maintenanceExpenseId = Number(movement.maintenance_expense_id ?? 0) || null;
    const treasuryTransferId = Number(movement.treasury_transfer_id ?? 0) || null;
    const shareholderPayoutLineId = Number(movement.shareholder_payout_line_id ?? 0) || null;
    const salesReservationPaymentId = Number(movement.sales_reservation_payment_id ?? 0) || null;
    const salesReservationRefundId = Number(movement.sales_reservation_refund_id ?? 0) || null;

    if (tenantCreditId || category === 'TENANT_CREDIT') {
      return {
        editable: false,
        reason: 'Ce mouvement provient dâ€™un crÃ©dit locataire. Corrigez lâ€™opÃ©ration source pour prÃ©server la cohÃ©rence comptable.',
        sourceType: 'TENANT_CREDIT',
        sourceId: tenantCreditId,
        sourceRoute: tenantCreditId ? `/tenant-credits?credit_id=${tenantCreditId}` : null,
        sourceLabel: 'Corriger le crÃ©dit locataire',
      };
    }

    if (category === 'TENANT_CREDIT_REFUND') {
      return {
        editable: false,
        reason: 'Ce mouvement provient dâ€™un remboursement de crÃ©dit locataire. La modification directe est interdite.',
        sourceType: 'TENANT_CREDIT_REFUND',
        sourceId: paymentId,
        sourceRoute: paymentId ? `/payments/${paymentId}` : null,
        sourceLabel: 'Ouvrir le reÃ§u liÃ©',
      };
    }

    if (paymentId || invoiceId || ['INVOICE_PAYMENT', 'PAYMENT_REFUND', 'LEASE_GUARANTEE', 'LEASE_GUARANTEE_REFUND'].includes(category)) {
      return {
        editable: false,
        reason: 'Ce mouvement est gÃ©nÃ©rÃ© par un paiement ou une garantie. Corrigez lâ€™opÃ©ration source au lieu de modifier la caisse directement.',
        sourceType: 'PAYMENT',
        sourceId: paymentId ?? invoiceId,
        sourceRoute: paymentId ? `/payments/${paymentId}` : null,
        sourceLabel: paymentId ? 'Corriger le paiement source' : null,
      };
    }

    if (
      salesReservationPaymentId ||
      salesReservationRefundId ||
      ['SALES_RESERVATION_FEE', 'SALES_RESERVATION_FEE_REFUND', 'SALES_RESERVATION_FEE_REVERSAL'].includes(category)
    ) {
      return {
        editable: false,
        reason: 'Ce mouvement est gÃ©nÃ©rÃ© par un encaissement ou un remboursement de frais de rÃ©servation. Corrigez lâ€™opÃ©ration source dans le module Ventes.',
        sourceType: salesReservationRefundId ? 'SALES_RESERVATION_REFUND' : 'SALES_RESERVATION_PAYMENT',
        sourceId: salesReservationRefundId ?? salesReservationPaymentId,
        sourceRoute: null,
        sourceLabel: null,
      };
    }

    if (treasuryTransferId || category === 'BANK_DEPOSIT' || category === 'BANK_WITHDRAWAL') {
      return {
        editable: false,
        reason: 'Ce mouvement provient dâ€™un transfert de trÃ©sorerie. Utilisez la fiche du transfert source.',
        sourceType: 'TREASURY_TRANSFER',
        sourceId: treasuryTransferId,
        sourceRoute: treasuryTransferId ? `/treasury-transfers/${treasuryTransferId}` : null,
        sourceLabel: 'Corriger le transfert source',
      };
    }

    if (shareholderPayoutLineId || category === 'SHAREHOLDER_PAYOUT') {
      return {
        editable: false,
        reason: 'Ce mouvement est issu dâ€™un remboursement actionnaire. La modification directe est interdite.',
        sourceType: 'SHAREHOLDER_PAYOUT',
        sourceId: shareholderPayoutLineId,
        sourceRoute: shareholderPayoutLineId ? `/shareholder-payout-lines/${shareholderPayoutLineId}/receipt` : null,
        sourceLabel: shareholderPayoutLineId ? 'Ouvrir le justificatif source' : null,
      };
    }

    if (stockPurchasePaymentId || category === 'STOCK_PURCHASE') {
      return {
        editable: false,
        reason: 'Ce mouvement est gÃ©nÃ©rÃ© par un rÃ¨glement fournisseur. Utilisez le flux source pour corriger lâ€™Ã©criture.',
        sourceType: 'STOCK_PURCHASE',
        sourceId: stockPurchasePaymentId,
        sourceRoute: null,
        sourceLabel: null,
      };
    }

    if (maintenanceExpenseId || category === 'MAINTENANCE_EXPENSE') {
      return {
        editable: false,
        reason: 'Ce mouvement provient dâ€™une dÃ©pense de maintenance. Corrigez la dÃ©pense source.',
        sourceType: 'MAINTENANCE_EXPENSE',
        sourceId: maintenanceExpenseId,
        sourceRoute: null,
        sourceLabel: null,
      };
    }

    return {
      editable: true,
      reason: null,
      sourceType: null,
      sourceId: null,
      sourceRoute: null,
      sourceLabel: null,
    };
  }

  private async resolveCashMovementTrashWorkflow(
    client: PoolClient,
    cashMovementId: number,
    movement: Record<string, unknown>,
    options: {
      supportsShareholderTrash: boolean;
      supportsMaintenanceExpenseId?: boolean;
      supportsStockPurchasePaymentId?: boolean;
      supportsCashExpenseCategories?: boolean;
    },
  ): Promise<{ type: string; sourceId: number | null }> {
    const rawCategory = String(movement.category ?? '');
    const normalizedCategory = rawCategory.trim().toUpperCase();
    const expenseCategoryLookup = movement.type === 'OUT'
      ? await this.findCashExpenseCategoryForTrash(rawCategory)
      : null;
    const matchedCashExpenseCategory = expenseCategoryLookup?.matchedCategory ?? null;
    const cashExpenseCategoryExists = Boolean(
      matchedCashExpenseCategory && Boolean(matchedCashExpenseCategory.is_active),
    );
    let resolvedWorkflowType = normalizedCategory || 'AUTRE';
    let resolvedSourceId: number | null = null;

    const logCashTrashResolution = () => {
      this.logger.log(
        `cash trash resolution | cashMovementId=${cashMovementId} organizationId=${this.context.organizationId()} movementType=${String(movement.type ?? 'UNKNOWN')} rawCategory=${rawCategory} normalizedCategory=${normalizedCategory} expenseCategoryExists=${cashExpenseCategoryExists} matchedCategoryId=${matchedCashExpenseCategory?.id ?? null} matchedCategoryCode=${matchedCashExpenseCategory?.code ?? null} matchedCategoryActive=${Boolean(matchedCashExpenseCategory?.is_active)} workflowType=${resolvedWorkflowType} sourceId=${resolvedSourceId ?? null}`,
      );
    };

    if (normalizedCategory === 'SHAREHOLDER_PAYOUT') {
      if (!options.supportsShareholderTrash) {
        logCashTrashResolution();
        return { type: 'SHAREHOLDER_PAYOUT', sourceId: null };
      }
      // Preferred resolution:
      // cash_movements.shareholder_payout_line_id
      // Fallback:
      // shareholder_payout_lines.cash_movement_id
      // for backward compatibility.
      const preferredPayoutLineId = Number(movement.shareholder_payout_line_id ?? 0) || null;
      const payoutLineResult = preferredPayoutLineId
        ? await client.query(
            `SELECT id
             FROM shareholder_payout_lines
             WHERE id = $1
               AND organization_id = $2
               AND deleted_at IS NULL
             LIMIT 1
             FOR UPDATE`,
            [preferredPayoutLineId, this.context.organizationId()],
          )
        : await client.query(
            `SELECT id
             FROM shareholder_payout_lines
             WHERE organization_id = $1
               AND cash_movement_id = $2
               AND deleted_at IS NULL
             LIMIT 1
             FOR UPDATE`,
            [this.context.organizationId(), cashMovementId],
          );
      this.logger.log(
        `cash delete shareholder lookup | requestedCashMovementId=${cashMovementId} organizationId=${this.context.organizationId()} payoutLineFound=${Boolean(payoutLineResult.rows[0])} payoutLineId=${payoutLineResult.rows[0]?.id ?? null}`,
      );
      resolvedWorkflowType = 'SHAREHOLDER_PAYOUT';
      resolvedSourceId = payoutLineResult.rows[0] ? Number(payoutLineResult.rows[0].id) : null;
      logCashTrashResolution();
      return {
        type: resolvedWorkflowType,
        sourceId: resolvedSourceId,
      };
    }

    if (normalizedCategory === 'MAINTENANCE_EXPENSE') {
      const directExpenseId = Number(movement.maintenance_expense_id ?? 0) || null;
      if (directExpenseId) {
        resolvedWorkflowType = 'MAINTENANCE_EXPENSE';
        resolvedSourceId = directExpenseId;
        logCashTrashResolution();
        return { type: resolvedWorkflowType, sourceId: resolvedSourceId };
      }
      const expenseResult = await client.query(
        `SELECT id
         FROM maintenance_expenses
         WHERE organization_id = $1
           AND cash_movement_id = $2
           AND deleted_at IS NULL
         LIMIT 1
         FOR UPDATE`,
        [this.context.organizationId(), cashMovementId],
      );
      resolvedWorkflowType = 'MAINTENANCE_EXPENSE';
      resolvedSourceId = expenseResult.rows[0] ? Number(expenseResult.rows[0].id) : null;
      logCashTrashResolution();
      return {
        type: resolvedWorkflowType,
        sourceId: resolvedSourceId,
      };
    }

    if (movement.type === 'OUT' && options.supportsCashExpenseCategories && cashExpenseCategoryExists) {
      resolvedWorkflowType = 'EXPENSE';
      resolvedSourceId = cashMovementId;
      logCashTrashResolution();
      return { type: resolvedWorkflowType, sourceId: resolvedSourceId };
    }

    if (normalizedCategory === 'STOCK_PURCHASE') {
      const directPaymentId = Number(movement.stock_purchase_payment_id ?? 0) || null;
      if (directPaymentId) {
        resolvedWorkflowType = 'STOCK_PURCHASE';
        resolvedSourceId = directPaymentId;
        logCashTrashResolution();
        return { type: resolvedWorkflowType, sourceId: resolvedSourceId };
      }
      const paymentResult = await client.query(
        `SELECT id
         FROM stock_purchase_payments
         WHERE organization_id = $1
           AND cash_movement_id = $2
           AND deleted_at IS NULL
         LIMIT 1
         FOR UPDATE`,
        [this.context.organizationId(), cashMovementId],
      );
      resolvedWorkflowType = 'STOCK_PURCHASE';
      resolvedSourceId = paymentResult.rows[0] ? Number(paymentResult.rows[0].id) : null;
      logCashTrashResolution();
      return {
        type: resolvedWorkflowType,
        sourceId: resolvedSourceId,
      };
    }

    if (normalizedCategory === 'TENANT_CREDIT') {
      const directCreditId = Number(movement.tenant_credit_id ?? 0) || null;
      if (directCreditId) {
        resolvedWorkflowType = 'TENANT_CREDIT';
        resolvedSourceId = directCreditId;
        logCashTrashResolution();
        return { type: resolvedWorkflowType, sourceId: resolvedSourceId };
      }
      const paymentId = Number(movement.payment_id ?? 0) || null;
      if (paymentId) {
        const creditResult = await client.query(
          `SELECT id
           FROM tenant_credits
           WHERE organization_id = $1
             AND source_payment_id = $2
             AND deleted_at IS NULL
           LIMIT 1
           FOR UPDATE`,
          [this.context.organizationId(), paymentId],
        );
        resolvedWorkflowType = 'TENANT_CREDIT';
        resolvedSourceId = creditResult.rows[0] ? Number(creditResult.rows[0].id) : null;
        logCashTrashResolution();
        return {
          type: resolvedWorkflowType,
          sourceId: resolvedSourceId,
        };
      }
      resolvedWorkflowType = 'TENANT_CREDIT';
      resolvedSourceId = null;
      logCashTrashResolution();
      return { type: resolvedWorkflowType, sourceId: resolvedSourceId };
    }

    if (normalizedCategory === 'TENANT_CREDIT_REFUND') {
      const refundResult = await client.query(
        `SELECT id
         FROM tenant_credit_refunds
         WHERE organization_id = $1
           AND cash_movement_id = $2
           AND deleted_at IS NULL
         LIMIT 1
         FOR UPDATE`,
        [this.context.organizationId(), cashMovementId],
      );
      resolvedWorkflowType = 'TENANT_CREDIT_REFUND';
      resolvedSourceId = refundResult.rows[0] ? Number(refundResult.rows[0].id) : null;
      logCashTrashResolution();
      return {
        type: resolvedWorkflowType,
        sourceId: resolvedSourceId,
      };
    }

    if (normalizedCategory === 'BANK_DEPOSIT' || normalizedCategory === 'BANK_WITHDRAWAL' || Number(movement.treasury_transfer_id ?? 0) > 0) {
      const transferId = Number(movement.treasury_transfer_id ?? 0) || null;
      if (transferId) {
        resolvedWorkflowType = 'TREASURY_TRANSFER';
        resolvedSourceId = transferId;
        logCashTrashResolution();
        return { type: resolvedWorkflowType, sourceId: resolvedSourceId };
      }
      const transferResult = await client.query(
        `SELECT id
         FROM treasury_transfers
         WHERE organization_id = $1
           AND (source_cash_movement_id = $2 OR destination_cash_movement_id = $2)
         LIMIT 1`,
        [this.context.organizationId(), cashMovementId],
      );
      resolvedWorkflowType = 'TREASURY_TRANSFER';
      resolvedSourceId = transferResult.rows[0] ? Number(transferResult.rows[0].id) : null;
      logCashTrashResolution();
      return {
        type: resolvedWorkflowType,
        sourceId: resolvedSourceId,
      };
    }

    if (['INVOICE_PAYMENT', 'PAYMENT_REFUND', 'LEASE_GUARANTEE'].includes(normalizedCategory) || Number(movement.payment_id ?? 0) > 0) {
      resolvedWorkflowType = 'PAYMENT';
      resolvedSourceId = Number(movement.payment_id ?? 0) || null;
      logCashTrashResolution();
      return { type: resolvedWorkflowType, sourceId: resolvedSourceId };
    }

    if (normalizedCategory === 'LEASE_GUARANTEE_REFUND') {
      const paymentId = Number(movement.payment_id ?? 0) || null;
      if (paymentId) {
        resolvedWorkflowType = 'GUARANTEE_REFUND';
        resolvedSourceId = paymentId;
        logCashTrashResolution();
        return { type: resolvedWorkflowType, sourceId: resolvedSourceId };
      }
      const guaranteeRefundResult = await client.query(
        `SELECT p.id
         FROM guarantee_cash_movements gcm
         JOIN payments p ON p.guarantee_cash_movement_id = gcm.id AND p.organization_id = gcm.organization_id AND p.deleted_at IS NULL
         WHERE gcm.organization_id = $1
           AND gcm.id = $2
           AND gcm.deleted_at IS NULL
         LIMIT 1
         FOR UPDATE`,
        [this.context.organizationId(), cashMovementId],
      );
      resolvedWorkflowType = 'GUARANTEE_REFUND';
      resolvedSourceId = guaranteeRefundResult.rows[0] ? Number(guaranteeRefundResult.rows[0].id) : null;
      logCashTrashResolution();
      return {
        type: resolvedWorkflowType,
        sourceId: resolvedSourceId,
      };
    }

    if (['SALARY_ADVANCE', 'SALARY_PAYMENT'].includes(normalizedCategory)) {
      resolvedWorkflowType = 'PAYROLL';
      resolvedSourceId = null;
      logCashTrashResolution();
      return { type: resolvedWorkflowType, sourceId: resolvedSourceId };
    }

    resolvedWorkflowType = normalizedCategory || 'AUTRE';
    resolvedSourceId = null;
    logCashTrashResolution();
    return { type: resolvedWorkflowType, sourceId: resolvedSourceId };
  }

  async trashExpense(
    expenseId: number,
    reason: string,
    options?: {
      auditAction?: string;
      auditResource?: string;
      auditResourceId?: string;
      sourceMovementId?: number | null;
    },
  ) {
    return this.db.transaction((client) => this.trashExpenseInTransaction(client, expenseId, reason, options));
  }

  async trashPurchasePayment(
    paymentId: number,
    reason: string,
    options?: {
      auditAction?: string;
      auditResource?: string;
      auditResourceId?: string;
      sourceMovementId?: number | null;
    },
  ) {
    return this.db.transaction((client) => this.trashPurchasePaymentInTransaction(client, paymentId, reason, options));
  }

  async trashTenantCredit(
    creditId: number,
    reason: string,
    options?: {
      auditAction?: string;
      auditResource?: string;
      auditResourceId?: string;
      sourceMovementId?: number | null;
    },
  ) {
    return this.db.transaction((client) => this.trashTenantCreditInTransaction(client, creditId, reason, options));
  }

  async trashTenantCreditRefund(
    refundId: number,
    reason: string,
    options?: {
      auditAction?: string;
      auditResource?: string;
      auditResourceId?: string;
      sourceMovementId?: number | null;
    },
  ) {
    return this.db.transaction((client) => this.trashTenantCreditRefundInTransaction(client, refundId, reason, options));
  }

  async trashGuaranteeRefund(
    paymentId: number,
    reason: string,
    options?: {
      auditAction?: string;
      auditResource?: string;
      auditResourceId?: string;
      sourceMovementId?: number | null;
    },
  ) {
    return this.db.transaction((client) => this.trashGuaranteeRefundInTransaction(client, paymentId, reason, options));
  }

  async restorePayment(
    paymentId: number,
    reason?: string,
    options?: {
      auditAction?: string;
      auditResource?: string;
      auditResourceId?: string;
      sourceMovementId?: number | null;
    },
  ) {
    if (!this.hasPermission('payments.update')) {
      throw new ForbiddenException('Permission requise pour restaurer un paiement.');
    }
    return this.db.transaction((client) => this.restorePaymentInTransaction(client, paymentId, reason ?? 'Restauration depuis la corbeille', options));
  }

  async restoreTenantCredit(
    creditId: number,
    reason?: string,
    options?: {
      auditAction?: string;
      auditResource?: string;
      auditResourceId?: string;
      sourceMovementId?: number | null;
    },
  ) {
    if (!this.hasPermission('payments.update')) {
      throw new ForbiddenException('Permission requise pour restaurer un crÃ©dit locataire.');
    }
    return this.db.transaction((client) => this.restoreTenantCreditInTransaction(client, creditId, reason ?? 'Restauration depuis la corbeille', options));
  }

  async restoreTenantCreditRefund(
    refundId: number,
    reason?: string,
    options?: {
      auditAction?: string;
      auditResource?: string;
      auditResourceId?: string;
      sourceMovementId?: number | null;
    },
  ) {
    if (!this.hasPermission('payments.update')) {
      throw new ForbiddenException('Permission requise pour restaurer un remboursement de crÃ©dit locataire.');
    }
    return this.db.transaction((client) => this.restoreTenantCreditRefundInTransaction(client, refundId, reason ?? 'Restauration depuis la corbeille', options));
  }

  private async trashExpenseInTransaction(
    client: PoolClient,
    expenseId: number,
    reason: string,
    options?: {
      auditAction?: string;
      auditResource?: string;
      auditResourceId?: string;
      sourceMovementId?: number | null;
    },
  ) {
    const organizationId = this.context.organizationId();
    const maintenanceExpenseResult = await client.query(
      `SELECT me.id, me.maintenance_request_id, me.amount, me.expense_date, me.category, me.description,
              me.status, me.cash_movement_id, me.supplier, me.payment_method, me.reference,
              me.attachment_file_name, me.attachment_file_url, me.observation, me.deleted_at
       FROM maintenance_expenses me
       WHERE me.id = $1
         AND me.organization_id = $2
       FOR UPDATE`,
      [expenseId, organizationId],
    );
    let expense = maintenanceExpenseResult.rows[0] ? (requireRow(maintenanceExpenseResult.rows[0], 'Maintenance expense') as Record<string, unknown>) : null;
    let cashMovementId = Number(expense?.cash_movement_id ?? 0) || null;
    let maintenanceRequestId = Number(expense?.maintenance_request_id ?? 0) || null;
    let directCashExpense = false;

    if (!expense) {
      const linkedExpenseResult = await client.query(
        `SELECT me.id, me.maintenance_request_id, me.amount, me.expense_date, me.category, me.description,
                me.status, me.cash_movement_id, me.supplier, me.payment_method, me.reference,
                me.attachment_file_name, me.attachment_file_url, me.observation, me.deleted_at
         FROM maintenance_expenses me
         WHERE me.cash_movement_id = $1
           AND me.organization_id = $2
         FOR UPDATE`,
        [expenseId, organizationId],
      );
      if (linkedExpenseResult.rows[0]) {
        expense = requireRow(linkedExpenseResult.rows[0], 'Maintenance expense') as Record<string, unknown>;
        cashMovementId = Number(expense.cash_movement_id ?? 0) || null;
        maintenanceRequestId = Number(expense.maintenance_request_id ?? 0) || null;
      }
    }

    if (!expense) {
      const cashMovementResult = await client.query(
        `SELECT id, category, amount, movement_date, description, reference, supplier,
                attachment_file_name, attachment_file_url, deleted_at
         FROM cash_movements
         WHERE id = $1
           AND organization_id = $2
         FOR UPDATE`,
        [expenseId, organizationId],
      );
      expense = requireRow(cashMovementResult.rows[0], 'Cash movement expense') as Record<string, unknown>;
      if (expense.deleted_at) {
        throw new ConflictException('Ce mouvement est dÃ©jÃ  dans la corbeille.');
      }
      cashMovementId = Number(expense.id ?? expenseId) || expenseId;
      directCashExpense = true;
    } else if (expense.deleted_at) {
      throw new ConflictException('Cette dÃ©pense est dÃ©jÃ  dans la corbeille.');
    }

    if (cashMovementId) {
      await this.softDeleteFinanceRows(client, 'cash_movements', 'id', cashMovementId, reason);
    }

    if (!directCashExpense) {
      await this.softDeleteFinanceRows(client, 'maintenance_expenses', 'id', Number(expense.id ?? expenseId), reason);
    }

    if (maintenanceRequestId) {
      await this.addMaintenanceTimeline(
        client,
        maintenanceRequestId,
        'EXPENSE_TRASH',
        'DÃ©pense mise en corbeille',
        String(reason ?? '').trim() || 'DÃ©pense supprimÃ©e depuis la caisse',
      );
    }

    await this.writeFinanceTrashAudit(
      client,
      options?.auditAction ?? (directCashExpense ? 'CASH_EXPENSE_MOVED_TO_TRASH' : 'MAINTENANCE_EXPENSE_MOVED_TO_TRASH'),
      options?.auditResource ?? (directCashExpense ? 'cash' : 'maintenance_expenses'),
      options?.auditResourceId ?? String(expenseId),
      {
        reason,
        maintenance_expense_id: directCashExpense ? null : Number(expense.id ?? expenseId),
        maintenance_request_id: maintenanceRequestId,
        cash_movement_id: cashMovementId,
        category: expense.category ?? null,
        amount: Number(expense.amount ?? 0),
        expense_date: expense.expense_date ?? null,
        source_movement_id: options?.sourceMovementId ?? cashMovementId ?? expenseId,
      },
    );

    return {
      deleted: true,
      maintenance_expense_id: directCashExpense ? null : Number(expense.id ?? expenseId),
      maintenance_request_id: maintenanceRequestId,
      cash_movement_id: cashMovementId,
    };
  }

  private async trashPurchasePaymentInTransaction(
    client: PoolClient,
    paymentId: number,
    reason: string,
    options?: {
      auditAction?: string;
      auditResource?: string;
      auditResourceId?: string;
      sourceMovementId?: number | null;
    },
  ) {
    const paymentResult = await client.query(
      `SELECT spp.id, spp.stock_purchase_id, spp.payment_date, spp.amount, spp.payment_method, spp.reference,
              spp.notes, spp.cash_movement_id, spp.deleted_at
       FROM stock_purchase_payments spp
       WHERE spp.id = $1
         AND spp.organization_id = $2
       FOR UPDATE`,
      [paymentId, this.context.organizationId()],
    );
    const payment = requireRow(paymentResult.rows[0], 'Stock purchase payment') as Record<string, unknown>;
    if (payment.deleted_at) {
      throw new ConflictException('Ce paiement d achat est dÃ©jÃ  dans la corbeille.');
    }

    const cashMovementId = Number(payment.cash_movement_id ?? 0) || null;
    if (cashMovementId) {
      await this.softDeleteFinanceRows(client, 'cash_movements', 'id', cashMovementId, reason);
    }

    await client.query(
      `UPDATE stock_purchase_payments
       SET deleted_at = NOW()
       WHERE id = $1
         AND organization_id = $2
         AND deleted_at IS NULL`,
      [paymentId, this.context.organizationId()],
    );

    const stockPurchaseId = Number(payment.stock_purchase_id ?? 0) || null;
    if (stockPurchaseId) {
      const totals = await client.query(
        `SELECT COALESCE(SUM(amount), 0)::NUMERIC(14,2) AS paid_amount
         FROM stock_purchase_payments
         WHERE stock_purchase_id = $1
           AND organization_id = $2
           AND deleted_at IS NULL`,
        [stockPurchaseId, this.context.organizationId()],
      );
      const paidAmount = Number(totals.rows[0]?.paid_amount ?? 0);
      await client.query(
        `UPDATE stock_purchases
         SET paid_amount = $2,
             updated_at = NOW()
         WHERE id = $1
           AND organization_id = $3`,
        [stockPurchaseId, paidAmount, this.context.organizationId()],
      );
      await this.refreshStockPurchaseStatus(client, stockPurchaseId);
      await this.addStockPurchaseTimeline(
        client,
        stockPurchaseId,
        'PAYMENT_TRASH',
        'Paiement mis en corbeille',
        String(reason ?? '').trim() || 'Paiement supprimÃ© depuis la caisse',
      );
    }

    await this.writeFinanceTrashAudit(
      client,
      options?.auditAction ?? 'STOCK_PURCHASE_PAYMENT_MOVED_TO_TRASH',
      options?.auditResource ?? 'stock_purchase_payments',
      options?.auditResourceId ?? String(paymentId),
      {
        reason,
        stock_purchase_payment_id: paymentId,
        stock_purchase_id: stockPurchaseId,
        payment_date: payment.payment_date ?? null,
        amount: Number(payment.amount ?? 0),
        payment_method: payment.payment_method ?? null,
        reference: payment.reference ?? null,
        cash_movement_id: cashMovementId,
        source_movement_id: options?.sourceMovementId ?? cashMovementId,
      },
    );

    return {
      deleted: true,
      stock_purchase_payment_id: paymentId,
      stock_purchase_id: stockPurchaseId,
      cash_movement_id: cashMovementId,
    };
  }

  private async trashTenantCreditInTransaction(
    client: PoolClient,
    creditId: number,
    reason: string,
    options?: {
      auditAction?: string;
      auditResource?: string;
      auditResourceId?: string;
      sourceMovementId?: number | null;
    },
  ) {
    const creditResult = await client.query(
      `SELECT id, source_payment_id, tenant_id, lease_id, currency, original_amount, remaining_amount, status,
              payment_date, reference, notes, deleted_at
       FROM tenant_credits
       WHERE id = $1
         AND organization_id = $2
       FOR UPDATE`,
      [creditId, this.context.organizationId()],
    );
    const credit = requireRow(creditResult.rows[0], 'Tenant credit') as Record<string, unknown>;
    if (credit.deleted_at) {
      throw new ConflictException('Ce crÃ©dit locataire est dÃ©jÃ  dans la corbeille.');
    }

    const paymentId = Number(credit.source_payment_id ?? 0) || null;
    if (paymentId) {
      await this.softDeleteFinanceRows(client, 'cash_movements', 'payment_id', paymentId, reason);
      await this.softDeleteFinanceRows(client, 'payment_allocations', 'payment_id', paymentId, reason);
      await this.softDeleteFinanceRows(client, 'payments', 'id', paymentId, reason);
    }

    const refundRows = await client.query(
      `SELECT id, cash_movement_id
       FROM tenant_credit_refunds
       WHERE tenant_credit_id = $1
         AND organization_id = $2
         AND deleted_at IS NULL
       FOR UPDATE`,
      [creditId, this.context.organizationId()],
    );
    for (const refund of refundRows.rows) {
      const cashMovementId = Number(refund.cash_movement_id ?? 0) || null;
      if (cashMovementId) {
        await this.softDeleteFinanceRows(client, 'cash_movements', 'id', cashMovementId, reason);
      }
      await client.query(
        `UPDATE tenant_credit_refunds
         SET deleted_at = NOW(),
             deleted_by = $2,
             deletion_reason = $3
         WHERE id = $1
           AND organization_id = $4
           AND deleted_at IS NULL`,
        [Number(refund.id), this.context.userId() ?? null, reason, this.context.organizationId()],
      );
    }

    const allocationRows = await client.query(
      `SELECT id, payment_id
       FROM tenant_credit_allocations
       WHERE tenant_credit_id = $1
         AND organization_id = $2
         AND deleted_at IS NULL
       FOR UPDATE`,
      [creditId, this.context.organizationId()],
    );
    for (const allocation of allocationRows.rows) {
      const allocationPaymentId = Number(allocation.payment_id ?? 0) || null;
      if (allocationPaymentId) {
        await this.softDeleteFinanceRows(client, 'cash_movements', 'payment_id', allocationPaymentId, reason);
        await this.softDeleteFinanceRows(client, 'payment_allocations', 'payment_id', allocationPaymentId, reason);
        await this.softDeleteFinanceRows(client, 'payments', 'id', allocationPaymentId, reason);
      }
      await client.query(
        `UPDATE tenant_credit_allocations
         SET deleted_at = NOW()
         WHERE id = $1
           AND organization_id = $2
           AND deleted_at IS NULL`,
        [Number(allocation.id), this.context.organizationId()],
      );
    }

    await client.query(
      `UPDATE tenant_credits
       SET deleted_at = NOW(),
           deleted_by = $2,
           deletion_reason = $3
       WHERE id = $1
         AND organization_id = $4
         AND deleted_at IS NULL`,
      [creditId, this.context.userId() ?? null, reason, this.context.organizationId()],
    );

    await this.writeFinanceTrashAudit(
      client,
      options?.auditAction ?? 'TENANT_CREDIT_MOVED_TO_TRASH',
      options?.auditResource ?? 'tenant_credits',
      options?.auditResourceId ?? String(creditId),
      {
        reason,
        tenant_credit_id: creditId,
        tenant_id: Number(credit.tenant_id ?? 0) || null,
        lease_id: Number(credit.lease_id ?? 0) || null,
        source_payment_id: paymentId,
        source_movement_id: options?.sourceMovementId ?? paymentId,
      },
    );

    return {
      deleted: true,
      tenant_credit_id: creditId,
      source_payment_id: paymentId,
    };
  }

  private async trashTenantCreditRefundInTransaction(
    client: PoolClient,
    refundId: number,
    reason: string,
    options?: {
      auditAction?: string;
      auditResource?: string;
      auditResourceId?: string;
      sourceMovementId?: number | null;
    },
  ) {
    const refundResult = await client.query(
      `SELECT id, tenant_credit_id, tenant_id, lease_id, amount, currency, refund_date, payment_method,
              reference, reason AS refund_reason, cash_movement_id, receipt_number, status, deleted_at
       FROM tenant_credit_refunds
       WHERE id = $1
         AND organization_id = $2
       FOR UPDATE`,
      [refundId, this.context.organizationId()],
    );
    const refund = requireRow(refundResult.rows[0], 'Tenant credit refund') as Record<string, unknown>;
    if (refund.deleted_at) {
      throw new ConflictException('Ce remboursement de crÃ©dit locataire est dÃ©jÃ  dans la corbeille.');
    }

    const cashMovementId = Number(refund.cash_movement_id ?? 0) || null;
    if (cashMovementId) {
      await this.softDeleteFinanceRows(client, 'cash_movements', 'id', cashMovementId, reason);
    }

    await client.query(
      `UPDATE tenant_credit_refunds
       SET deleted_at = NOW(),
           deleted_by = $2,
           deletion_reason = $3
       WHERE id = $1
         AND organization_id = $4
         AND deleted_at IS NULL`,
      [refundId, this.context.userId() ?? null, reason, this.context.organizationId()],
    );

    const creditId = Number(refund.tenant_credit_id ?? 0) || null;
    if (creditId) {
      const remaining = await client.query(
        `SELECT
           tc.original_amount,
           tc.remaining_amount,
           COALESCE(SUM(CASE WHEN tcr.deleted_at IS NULL THEN tcr.amount ELSE 0 END), 0)::NUMERIC(14,2) AS active_refunds
         FROM tenant_credits tc
         LEFT JOIN tenant_credit_refunds tcr ON tcr.tenant_credit_id = tc.id AND tcr.organization_id = tc.organization_id
         WHERE tc.id = $1 AND tc.organization_id = $2
         GROUP BY tc.id`,
        [creditId, this.context.organizationId()],
      );
      const originalAmount = Number(remaining.rows[0]?.original_amount ?? 0);
      const activeRefunds = Number(remaining.rows[0]?.active_refunds ?? 0);
      const nextRemaining = Number(Math.max(originalAmount - activeRefunds, 0).toFixed(2));
      const nextStatus = nextRemaining <= 0 ? 'REFUNDED' : nextRemaining < originalAmount ? 'PARTIALLY_USED' : 'AVAILABLE';
      await client.query(
        `UPDATE tenant_credits
         SET remaining_amount = $2,
             status = $3,
             updated_at = NOW()
         WHERE id = $1
           AND organization_id = $4`,
        [creditId, nextRemaining, nextStatus, this.context.organizationId()],
      );
    }

    await this.writeFinanceTrashAudit(
      client,
      options?.auditAction ?? 'TENANT_CREDIT_REFUND_MOVED_TO_TRASH',
      options?.auditResource ?? 'tenant_credit_refunds',
      options?.auditResourceId ?? String(refundId),
      {
        reason,
        tenant_credit_refund_id: refundId,
        tenant_credit_id: creditId,
        tenant_id: Number(refund.tenant_id ?? 0) || null,
        lease_id: Number(refund.lease_id ?? 0) || null,
        amount: Number(refund.amount ?? 0),
        currency: refund.currency ?? null,
        cash_movement_id: cashMovementId,
        source_movement_id: options?.sourceMovementId ?? cashMovementId,
      },
    );

    return {
      deleted: true,
      tenant_credit_refund_id: refundId,
      tenant_credit_id: creditId,
      cash_movement_id: cashMovementId,
    };
  }

  private async trashGuaranteeRefundInTransaction(
    client: PoolClient,
    paymentId: number,
    reason: string,
    options?: {
      auditAction?: string;
      auditResource?: string;
      auditResourceId?: string;
      sourceMovementId?: number | null;
    },
  ) {
    const paymentResult = await client.query(
      `SELECT id, payment_type, lease_guarantee_id, deleted_at
       FROM payments
       WHERE id = $1
         AND organization_id = $2
       FOR UPDATE`,
      [paymentId, this.context.organizationId()],
    );
    const payment = requireRow(paymentResult.rows[0], 'Guarantee refund payment') as Record<string, unknown>;
    if (payment.deleted_at) {
      throw new ConflictException('Ce remboursement de garantie est dÃ©jÃ  dans la corbeille.');
    }
    if (String(payment.payment_type ?? '').toUpperCase() !== 'GUARANTEE') {
      throw new ConflictException('Ce paiement n est pas un remboursement de garantie.');
    }
    return this.trashPaymentInTransaction(client, paymentId, reason, {
      auditAction: options?.auditAction ?? 'GUARANTEE_REFUND_MOVED_TO_TRASH_FROM_CASH',
      auditResource: options?.auditResource ?? 'cash',
      auditResourceId: options?.auditResourceId ?? String(options?.sourceMovementId ?? paymentId),
      sourceMovementId: options?.sourceMovementId ?? paymentId,
    });
  }

  private async restorePaymentInTransaction(
    client: PoolClient,
    paymentId: number,
    reason: string,
    options?: {
      auditAction?: string;
      auditResource?: string;
      auditResourceId?: string;
      sourceMovementId?: number | null;
    },
  ) {
    const paymentResult = await client.query(
      `SELECT id, payment_type, lease_guarantee_id, invoice_id, deleted_at
       FROM payments
       WHERE id = $1
         AND organization_id = $2
       FOR UPDATE`,
      [paymentId, this.context.organizationId()],
    );
    const payment = requireRow(paymentResult.rows[0], 'Payment') as Record<string, unknown>;
    if (!payment.deleted_at) {
      throw new ConflictException('Ce paiement est dÃ©jÃ  actif.');
    }

    const allocationRows = await client.query(
      `SELECT id, invoice_id
       FROM payment_allocations
       WHERE payment_id = $1
         AND organization_id = $2
       FOR UPDATE`,
      [paymentId, this.context.organizationId()],
    );
    const invoiceIds = Array.from(
      new Set(
        [
          Number(payment.invoice_id ?? 0),
          ...allocationRows.rows.map((row) => Number(row.invoice_id ?? 0)),
        ].filter((invoiceId) => invoiceId > 0),
      ),
    );

    await this.restoreFinanceRows(client, 'cash_movements', 'payment_id', paymentId);
    await this.restoreFinanceRows(client, 'guarantee_cash_movements', 'payment_id', paymentId);
    if (await this.tableExists('syndic_cash_movements')) {
      await this.restoreFinanceRows(client, 'syndic_cash_movements', 'payment_id', paymentId);
    }
    await this.restoreFinanceRows(client, 'payment_allocations', 'payment_id', paymentId);
    await this.restoreFinanceRows(client, 'payments', 'id', paymentId);

    for (const invoiceId of invoiceIds) {
      await this.refreshInvoiceStatusInTransaction(client, this.context.organizationId(), invoiceId);
    }

    if (String(payment.payment_type ?? '').toUpperCase() === 'GUARANTEE' && Number(payment.lease_guarantee_id ?? 0) > 0) {
      await this.recalculateLeaseGuaranteeFromActiveRows(client, Number(payment.lease_guarantee_id));
    }

    await this.writeFinanceTrashAudit(
      client,
      options?.auditAction ?? 'PAYMENT_RESTORED',
      options?.auditResource ?? 'payments',
      options?.auditResourceId ?? String(paymentId),
      {
        reason,
        payment_id: paymentId,
        payment_type: payment.payment_type ?? 'INVOICE',
        invoice_ids: invoiceIds,
        lease_guarantee_id: Number(payment.lease_guarantee_id ?? 0) || null,
        source_movement_id: options?.sourceMovementId ?? null,
        restored: true,
      },
    );

    return {
      restored: true,
      payment_id: paymentId,
      payment_type: String(payment.payment_type ?? 'INVOICE'),
      invoice_ids: invoiceIds,
      lease_guarantee_id: Number(payment.lease_guarantee_id ?? 0) || null,
    };
  }

  private async restoreTenantCreditInTransaction(
    client: PoolClient,
    creditId: number,
    reason: string,
    options?: {
      auditAction?: string;
      auditResource?: string;
      auditResourceId?: string;
      sourceMovementId?: number | null;
    },
  ) {
    const creditResult = await client.query(
      `SELECT id, source_payment_id, tenant_id, lease_id, currency, original_amount, remaining_amount, status,
              payment_date, reference, notes, deleted_at
       FROM tenant_credits
       WHERE id = $1
         AND organization_id = $2
       FOR UPDATE`,
      [creditId, this.context.organizationId()],
    );
    const credit = requireRow(creditResult.rows[0], 'Tenant credit') as Record<string, unknown>;
    if (!credit.deleted_at) {
      throw new ConflictException('Ce crÃ©dit locataire est dÃ©jÃ  actif.');
    }

    const deletedRefunds = await client.query(
      `SELECT id, cash_movement_id
       FROM tenant_credit_refunds
       WHERE tenant_credit_id = $1
         AND organization_id = $2
       FOR UPDATE`,
      [creditId, this.context.organizationId()],
    );
    const deletedAllocations = await client.query(
      `SELECT id, payment_id
       FROM tenant_credit_allocations
       WHERE tenant_credit_id = $1
         AND organization_id = $2
       FOR UPDATE`,
      [creditId, this.context.organizationId()],
    );

    const sourcePaymentId = Number(credit.source_payment_id ?? 0) || null;

    for (const refund of deletedRefunds.rows) {
      const cashMovementId = Number(refund.cash_movement_id ?? 0) || null;
      if (cashMovementId) {
        await this.restoreFinanceRows(client, 'cash_movements', 'id', cashMovementId);
      }
      await this.restoreFinanceRows(client, 'tenant_credit_refunds', 'id', Number(refund.id));
    }

    for (const allocation of deletedAllocations.rows) {
      const allocationPaymentId = Number(allocation.payment_id ?? 0) || null;
      if (allocationPaymentId) {
        await this.restoreFinanceRows(client, 'cash_movements', 'payment_id', allocationPaymentId);
        await this.restoreFinanceRows(client, 'payment_allocations', 'payment_id', allocationPaymentId);
        await this.restoreFinanceRows(client, 'payments', 'id', allocationPaymentId);
      }
      await this.restoreFinanceRows(client, 'tenant_credit_allocations', 'id', Number(allocation.id));
    }

    if (sourcePaymentId) {
      await this.restoreFinanceRows(client, 'cash_movements', 'payment_id', sourcePaymentId);
      await this.restoreFinanceRows(client, 'payment_allocations', 'payment_id', sourcePaymentId);
      await this.restoreFinanceRows(client, 'payments', 'id', sourcePaymentId);
    }

    await this.restoreFinanceRows(client, 'tenant_credits', 'id', creditId);

    const balanceRows = await client.query(
      `SELECT tc.original_amount,
              COALESCE(SUM(CASE WHEN tca.deleted_at IS NULL THEN tca.amount_applied ELSE 0 END), 0)::NUMERIC(14,2) AS active_allocations,
              COALESCE(SUM(CASE WHEN tcr.deleted_at IS NULL THEN tcr.amount ELSE 0 END), 0)::NUMERIC(14,2) AS active_refunds
       FROM tenant_credits tc
       LEFT JOIN tenant_credit_allocations tca ON tca.tenant_credit_id = tc.id AND tca.organization_id = tc.organization_id
       LEFT JOIN tenant_credit_refunds tcr ON tcr.tenant_credit_id = tc.id AND tcr.organization_id = tc.organization_id
       WHERE tc.id = $1 AND tc.organization_id = $2
       GROUP BY tc.id`,
      [creditId, this.context.organizationId()],
    );
    const originalAmount = Number(balanceRows.rows[0]?.original_amount ?? 0);
    const activeAllocations = Number(balanceRows.rows[0]?.active_allocations ?? 0);
    const activeRefunds = Number(balanceRows.rows[0]?.active_refunds ?? 0);
    const remainingAmount = Number(Math.max(originalAmount - activeAllocations - activeRefunds, 0).toFixed(2));
    const nextStatus = activeAllocations > 0
      ? (remainingAmount <= 0 ? 'USED' : 'PARTIALLY_USED')
      : activeRefunds > 0
        ? (remainingAmount <= 0 ? 'REFUNDED' : 'PARTIALLY_USED')
        : 'AVAILABLE';
    await client.query(
      `UPDATE tenant_credits
       SET remaining_amount = $2,
           status = $3,
           deleted_at = NULL,
           deleted_by = NULL,
           deletion_reason = NULL,
           updated_at = NOW()
       WHERE id = $1
         AND organization_id = $4`,
      [creditId, remainingAmount, nextStatus, this.context.organizationId()],
    );

    await this.writeFinanceTrashAudit(
      client,
      options?.auditAction ?? 'TENANT_CREDIT_RESTORED',
      options?.auditResource ?? 'tenant_credits',
      options?.auditResourceId ?? String(creditId),
      {
        reason,
        tenant_credit_id: creditId,
        source_payment_id: sourcePaymentId,
        source_movement_id: options?.sourceMovementId ?? sourcePaymentId,
        restored: true,
        remaining_amount: remainingAmount,
        status: nextStatus,
      },
    );

    return {
      restored: true,
      tenant_credit_id: creditId,
      source_payment_id: sourcePaymentId,
      remaining_amount: remainingAmount,
      status: nextStatus,
    };
  }

  private async restoreTenantCreditRefundInTransaction(
    client: PoolClient,
    refundId: number,
    reason: string,
    options?: {
      auditAction?: string;
      auditResource?: string;
      auditResourceId?: string;
      sourceMovementId?: number | null;
    },
  ) {
    const refundResult = await client.query(
      `SELECT id, tenant_credit_id, cash_movement_id, deleted_at
       FROM tenant_credit_refunds
       WHERE id = $1
         AND organization_id = $2
       FOR UPDATE`,
      [refundId, this.context.organizationId()],
    );
    const refund = requireRow(refundResult.rows[0], 'Tenant credit refund') as Record<string, unknown>;
    if (!refund.deleted_at) {
      throw new ConflictException('Ce remboursement de crÃ©dit locataire est dÃ©jÃ  actif.');
    }

    const cashMovementId = Number(refund.cash_movement_id ?? 0) || null;
    if (cashMovementId) {
      await this.restoreFinanceRows(client, 'cash_movements', 'id', cashMovementId);
    }
    await this.restoreFinanceRows(client, 'tenant_credit_refunds', 'id', refundId);

    const creditId = Number(refund.tenant_credit_id ?? 0) || null;
    if (creditId) {
      const balanceRows = await client.query(
        `SELECT tc.original_amount,
                COALESCE(SUM(CASE WHEN tca.deleted_at IS NULL THEN tca.amount_applied ELSE 0 END), 0)::NUMERIC(14,2) AS active_allocations,
                COALESCE(SUM(CASE WHEN tcr.deleted_at IS NULL THEN tcr.amount ELSE 0 END), 0)::NUMERIC(14,2) AS active_refunds
         FROM tenant_credits tc
         LEFT JOIN tenant_credit_allocations tca ON tca.tenant_credit_id = tc.id AND tca.organization_id = tc.organization_id
         LEFT JOIN tenant_credit_refunds tcr ON tcr.tenant_credit_id = tc.id AND tcr.organization_id = tc.organization_id
         WHERE tc.id = $1 AND tc.organization_id = $2
         GROUP BY tc.id`,
        [creditId, this.context.organizationId()],
      );
      const originalAmount = Number(balanceRows.rows[0]?.original_amount ?? 0);
      const activeAllocations = Number(balanceRows.rows[0]?.active_allocations ?? 0);
      const activeRefunds = Number(balanceRows.rows[0]?.active_refunds ?? 0);
      const remainingAmount = Number(Math.max(originalAmount - activeAllocations - activeRefunds, 0).toFixed(2));
      const nextStatus = activeAllocations > 0
        ? (remainingAmount <= 0 ? 'USED' : 'PARTIALLY_USED')
        : activeRefunds > 0
          ? (remainingAmount <= 0 ? 'REFUNDED' : 'PARTIALLY_USED')
          : 'AVAILABLE';
      await client.query(
        `UPDATE tenant_credits
         SET remaining_amount = $2,
             status = $3,
             updated_at = NOW()
         WHERE id = $1
           AND organization_id = $4`,
        [creditId, remainingAmount, nextStatus, this.context.organizationId()],
      );
    }

    await this.writeFinanceTrashAudit(
      client,
      options?.auditAction ?? 'TENANT_CREDIT_REFUND_RESTORED',
      options?.auditResource ?? 'tenant_credit_refunds',
      options?.auditResourceId ?? String(refundId),
      {
        reason,
        tenant_credit_refund_id: refundId,
        tenant_credit_id: creditId,
        cash_movement_id: cashMovementId,
        source_movement_id: options?.sourceMovementId ?? cashMovementId,
        restored: true,
      },
    );

    return {
      restored: true,
      tenant_credit_refund_id: refundId,
      tenant_credit_id: creditId,
      cash_movement_id: cashMovementId,
    };
  }

  private async restoreFinanceRows(
    client: PoolClient,
    tableName: 'payments' | 'payment_allocations' | 'cash_movements' | 'guarantee_cash_movements' | 'syndic_cash_movements' | 'tenant_credits' | 'tenant_credit_refunds' | 'tenant_credit_allocations',
    keyColumn: 'id' | 'payment_id',
    value: number,
  ) {
    const supportsDeletionReason = await this.columnExists(tableName, 'deletion_reason');
    const supportsDeletedBy = await this.columnExists(tableName, 'deleted_by');
    const supportsRestoredAt = await this.columnExists(tableName, 'restored_at');
    const supportsRestoredBy = await this.columnExists(tableName, 'restored_by');
    const assignments = ['deleted_at = NULL'];
    const params: unknown[] = [value, this.context.organizationId()];
    let index = 3;
    if (supportsDeletionReason) {
      assignments.push(`deletion_reason = NULL`);
    }
    if (supportsDeletedBy) {
      assignments.push(`deleted_by = NULL`);
    }
    if (supportsRestoredAt) {
      assignments.push(`restored_at = NOW()`);
    }
    if (supportsRestoredBy) {
      assignments.push(`restored_by = $${index}`);
      params.push(this.context.userId() ?? null);
      index += 1;
    }
    await client.query(
      `UPDATE ${tableName}
       SET ${assignments.join(', ')}
       WHERE ${keyColumn} = $1
         AND organization_id = $2`,
      params,
    );
  }

  private throwCashMovementWorkflowNotImplemented(
    cashMovementId: number,
    movement: Record<string, unknown>,
    workflowType: string,
    sourceId: number | null,
  ): never {
    this.logger.warn(
      `cash delete workflow not implemented | requestedCashMovementId=${cashMovementId} organizationId=${this.context.organizationId()} category=${String(movement.category ?? 'UNKNOWN')} workflowType=${workflowType} sourceId=${sourceId ?? null}`,
    );
    throw new ConflictException("Le workflow de suppression de ce type de mouvement n'est pas encore implÃ©mentÃ©.");
  }

  async trashPayment(
    paymentId: number,
    reason: string,
    options?: {
      auditAction?: string;
      auditResource?: string;
      auditResourceId?: string;
      sourceMovementId?: number | null;
    },
  ) {
    return this.db.transaction((client) =>
      this.trashPaymentInTransaction(client, paymentId, reason, options),
    );
  }

  async trashShareholderPayout(
    payoutLineId: number,
    reason: string,
    options?: {
      auditAction?: string;
      auditResource?: string;
      auditResourceId?: string;
      sourceMovementId?: number | null;
    },
  ) {
    await this.ensureShareholderSchema();
    if (!this.hasPermission('shareholder_payouts.delete')) {
      throw new ForbiddenException('Permission requise pour supprimer un remboursement actionnaire.');
    }
    const deletionReason = String(reason ?? '').trim();
    if (!deletionReason) {
      throw new BadRequestException('Le motif de suppression est obligatoire.');
    }
    this.logger.log(
      `shareholder payout trash transaction start | payoutLineId=${payoutLineId} organizationId=${this.context.organizationId()} sourceMovementId=${options?.sourceMovementId ?? null}`,
    );
    try {
      const result = await this.db.transaction((client) =>
        this.trashShareholderPayoutInTransaction(client, payoutLineId, deletionReason, options),
      );
      this.logger.log(
        `shareholder payout trash transaction commit OK | payoutLineId=${payoutLineId} organizationId=${this.context.organizationId()} sourceMovementId=${options?.sourceMovementId ?? null}`,
      );
      return result;
    } catch (error) {
      this.logShareholderPayoutTrashError('transaction', payoutLineId, error);
      throw error;
    }
  }

  async stockCategories() {
    return this.findAll('stock_categories', 'name');
  }

  async createStockCategory(body: Record<string, unknown>) {
    return this.insert('stock_categories', { status: 'ACTIVE', ...body }, ['name', 'description', 'status']);
  }

  async stockItems() {
    const { rows } = await this.db.query(`
      SELECT si.*,
             last_entry.movement_date AS last_entry_date,
             last_exit.movement_date AS last_exit_date,
             CASE
               WHEN si.status <> 'ACTIVE' THEN 'INACTIVE'
               WHEN si.current_quantity <= 0 THEN 'OUT_OF_STOCK'
               WHEN si.current_quantity <= si.minimum_quantity THEN 'LOW_STOCK'
               ELSE 'OK'
             END AS stock_alert
      FROM stock_items si
      LEFT JOIN LATERAL (
        SELECT movement_date FROM stock_movements
        WHERE stock_item_id = si.id AND organization_id = si.organization_id
          AND deleted_at IS NULL AND type IN ('IN', 'ENTRY', 'RETURN', 'INVENTORY_GAIN')
        ORDER BY movement_date DESC, id DESC LIMIT 1
      ) last_entry ON TRUE
      LEFT JOIN LATERAL (
        SELECT movement_date FROM stock_movements
        WHERE stock_item_id = si.id AND organization_id = si.organization_id
          AND deleted_at IS NULL AND type IN ('OUT', 'EXIT', 'MAINTENANCE_CONSUMPTION', 'INVENTORY_LOSS')
        ORDER BY movement_date DESC, id DESC LIMIT 1
      ) last_exit ON TRUE
      WHERE si.organization_id = $1 AND si.deleted_at IS NULL
      ORDER BY si.name
    `, [this.context.organizationId()]);
    return rows;
  }

  async stockItemDetail(id: number) {
    const item = await this.db.query(
      `SELECT * FROM stock_items WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [id, this.context.organizationId()],
    );
    const movements = await this.db.query(
      `SELECT sm.*, CONCAT(u.first_name, ' ', u.last_name) AS user_name
       FROM stock_movements sm
       LEFT JOIN app_users u ON u.id = sm.created_by
       WHERE sm.stock_item_id = $1 AND sm.organization_id = $2 AND sm.deleted_at IS NULL
       ORDER BY sm.movement_date DESC, sm.id DESC`,
      [id, this.context.organizationId()],
    );
    const [inventories, alerts] = await Promise.all([
      this.db.query(
        `SELECT ic.inventory_number, ic.count_date, ic.status, icl.theoretical_quantity,
                icl.physical_quantity, icl.difference_quantity, icl.difference_cost
         FROM inventory_count_lines icl
         JOIN inventory_counts ic ON ic.id = icl.inventory_count_id
         WHERE icl.stock_item_id = $1 AND icl.organization_id = $2
           AND icl.deleted_at IS NULL AND ic.deleted_at IS NULL
         ORDER BY ic.count_date DESC, ic.id DESC`,
        [id, this.context.organizationId()],
      ),
      this.db.query(
        `SELECT * FROM stock_alerts
         WHERE stock_item_id = $1 AND organization_id = $2 AND deleted_at IS NULL
         ORDER BY created_at DESC`,
        [id, this.context.organizationId()],
      ),
    ]);
    return { ...requireRow(item.rows[0], 'Stock item'), movements: movements.rows, inventories: inventories.rows, alerts: alerts.rows };
  }

  async employeeContracts() {
    const { rows } = await this.db.query(
      `SELECT ec.*,
              CONCAT(e.first_name, ' ', COALESCE(e.post_name || ' ', ''), e.last_name) AS employee_name
       FROM employee_contracts ec
       JOIN employees e ON e.id = ec.employee_id
       WHERE ec.organization_id = $1 AND ec.deleted_at IS NULL
       ORDER BY ec.start_date DESC, ec.id DESC`,
      [this.context.organizationId()],
    );
    return rows;
  }

  async createEmployeeContract(body: Record<string, unknown>) {
    return this.db.transaction(async (client) => {
      const contractNumber = body.contract_number ? String(body.contract_number) : await this.nextEmployeeContractNumber(client);
      const salaryAmount = Number(body.salary_amount ?? body.monthly_salary ?? 0);
      const row = await this.insertInTransaction(client, 'employee_contracts', {
        ...body,
        contract_number: contractNumber,
        salary_amount: salaryAmount,
        currency: body.currency ?? 'USD',
        status: body.status ?? 'ACTIVE',
      }, [
        'employee_id', 'contract_number', 'contract_type', 'start_date', 'end_date', 'salary_amount', 'currency',
        'job_title', 'department', 'contract_file_name', 'contract_file_url', 'observations', 'status', 'created_by',
      ]);
      await client.query(
        `UPDATE employees
         SET contract_type = COALESCE($2, contract_type),
             monthly_salary = COALESCE(NULLIF($3::NUMERIC, 0), monthly_salary),
             job_title = COALESCE($4, job_title),
             department = COALESCE($5, department),
             signed_contract_attachment_name = COALESCE($6, signed_contract_attachment_name),
             updated_at = NOW()
         WHERE id = $1 AND organization_id = $7 AND deleted_at IS NULL`,
        [
          row.employee_id,
          row.contract_type ?? null,
          salaryAmount,
          row.job_title ?? null,
          row.department ?? null,
          row.contract_file_name ?? null,
          this.context.organizationId(),
        ],
      );
      return row;
    });
  }

  async employeeAttendance(filters: { month?: number; year?: number; department?: string; employeeId?: number } = {}) {
    const { rows } = await this.db.query(
      `SELECT ema.*,
              CONCAT(e.first_name, ' ', COALESCE(e.post_name || ' ', ''), e.last_name) AS employee_name,
              e.department,
              e.job_title,
              e.employee_number,
              e.monthly_salary
       FROM employee_monthly_attendance ema
       JOIN employees e ON e.id = ema.employee_id
       WHERE ema.organization_id = $1 AND ema.deleted_at IS NULL
         AND ($2::INT IS NULL OR ema.month = $2)
         AND ($3::INT IS NULL OR ema.year = $3)
         AND ($4::TEXT IS NULL OR e.department = $4)
         AND ($5::INT IS NULL OR ema.employee_id = $5)
       ORDER BY ema.year DESC, ema.month DESC, e.last_name, e.first_name`,
      [this.context.organizationId(), filters.month ?? null, filters.year ?? null, filters.department ?? null, filters.employeeId ?? null],
    );
    return rows;
  }

  async employeeAttendanceTemplate(month?: number, year?: number, department?: string) {
    const normalizedMonth = this.normalizeMonth(month);
    const normalizedYear = this.normalizeYear(year);
    const { rows } = await this.db.query(
      `SELECT e.id AS employee_id,
              e.employee_number,
              CONCAT(e.first_name, ' ', COALESCE(e.post_name || ' ', ''), e.last_name) AS employee_name,
              e.department,
              e.job_title,
              e.monthly_salary,
              COALESCE(ema.id, 0) AS attendance_id,
              ema.status,
              ema.working_days,
              ema.present_days,
              ema.paid_leave_days,
              ema.sick_days,
              ema.unjustified_absence_days,
              ema.late_count,
              ema.overtime_hours,
              ema.absence_deduction,
              ema.estimated_net_salary,
              ema.observations,
              COALESCE(adv.total, 0)::NUMERIC(12,2) AS advances_total
       FROM employees e
       LEFT JOIN employee_monthly_attendance ema
         ON ema.employee_id = e.id
        AND ema.organization_id = e.organization_id
        AND ema.deleted_at IS NULL
        AND ema.month = $2
        AND ema.year = $3
       LEFT JOIN (
         SELECT employee_id, COALESCE(SUM(amount), 0)::NUMERIC(12,2) AS total
         FROM salary_advances
         WHERE organization_id = $1
           AND deleted_at IS NULL
           AND status = 'PAID'
           AND EXTRACT(MONTH FROM advance_date) = $2
           AND EXTRACT(YEAR FROM advance_date) = $3
         GROUP BY employee_id
       ) adv ON adv.employee_id = e.id
       WHERE e.organization_id = $1
         AND e.deleted_at IS NULL
         AND e.status = 'ACTIVE'
         AND ($4::TEXT IS NULL OR e.department = $4)
       ORDER BY e.last_name, e.first_name`,
      [this.context.organizationId(), normalizedMonth, normalizedYear, department ?? null],
    );
    return rows.map((row) => {
      const workingDays = Number(row.working_days ?? 0);
      const paidLeaveDays = Number(row.paid_leave_days ?? 0);
      const sickDays = Number(row.sick_days ?? 0);
      const unjustifiedAbsenceDays = Number(row.unjustified_absence_days ?? 0);
      const effectiveWorkingDays = workingDays > 0 ? workingDays : 26;
      const presentDays = row.present_days !== null && row.present_days !== undefined
        ? Number(row.present_days)
        : Math.max(effectiveWorkingDays - paidLeaveDays - sickDays - unjustifiedAbsenceDays, 0);
      const metrics = this.calculateMonthlyAttendanceMetrics(
        Number(row.monthly_salary ?? 0),
        effectiveWorkingDays,
        unjustifiedAbsenceDays,
        Number(row.advances_total ?? 0),
      );
      return {
        employee_id: row.employee_id,
        employee_number: row.employee_number,
        employee_name: row.employee_name,
        department: row.department,
        job_title: row.job_title,
        monthly_salary: Number(row.monthly_salary ?? 0),
        month: normalizedMonth,
        year: normalizedYear,
        attendance_id: Number(row.attendance_id || 0) || null,
        working_days: effectiveWorkingDays,
        paid_leave_days: paidLeaveDays,
        sick_days: sickDays,
        unjustified_absence_days: unjustifiedAbsenceDays,
        late_count: Number(row.late_count ?? 0),
        overtime_hours: Number(row.overtime_hours ?? 0),
        present_days: presentDays,
        absence_deduction: row.absence_deduction !== null && row.absence_deduction !== undefined ? Number(row.absence_deduction) : metrics.absenceDeduction,
        estimated_net_salary: row.estimated_net_salary !== null && row.estimated_net_salary !== undefined ? Number(row.estimated_net_salary) : metrics.estimatedNetSalary,
        advances_total: Number(row.advances_total ?? 0),
        status: row.status ?? 'DRAFT',
        observations: row.observations ?? null,
        locked: row.status === 'VALIDATED',
      };
    });
  }

  async createEmployeeAttendance(body: Record<string, unknown>) {
    return this.db.transaction(async (client) => this.upsertEmployeeMonthlyAttendance(client, this.normalizeAttendancePayload(body)));
  }

  async createEmployeeAttendanceBulk(body: Record<string, unknown>) {
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length) throw new BadRequestException('Aucune ligne de pointage Ã  enregistrer.');
    return this.db.transaction(async (client) => {
      const saved = [];
      for (const row of rows) {
        const payload = this.normalizeAttendancePayload({
          ...row,
          month: row.month ?? body.month,
          year: row.year ?? body.year,
          working_days: row.working_days ?? body.working_days,
          status: row.status ?? body.status ?? 'DRAFT',
        });
        saved.push(await this.upsertEmployeeMonthlyAttendance(client, payload));
      }
      return saved;
    });
  }

  async validateEmployeeAttendance(id: number) {
    const { rows } = await this.db.query(
      `UPDATE employee_monthly_attendance
       SET status = 'VALIDATED', validated_at = NOW(), validated_by = $3, updated_at = NOW()
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [id, this.context.organizationId(), this.context.userId() ?? 1],
    );
    return requireRow(rows[0], 'Employee monthly attendance');
  }

  async validateEmployeeAttendanceMonth(body: Record<string, unknown>) {
    const month = this.normalizeMonth(body.month);
    const year = this.normalizeYear(body.year);
    const department = body.department ? String(body.department) : null;
    const employeeIds = Array.isArray(body.employee_ids) ? body.employee_ids.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0) : [];
    return this.db.transaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE employee_monthly_attendance ema
         SET status = 'VALIDATED', validated_at = NOW(), validated_by = $5, updated_at = NOW()
         FROM employees e
         WHERE ema.employee_id = e.id
           AND ema.organization_id = $1
           AND ema.deleted_at IS NULL
           AND ema.month = $2
           AND ema.year = $3
           AND e.organization_id = $1
           AND e.deleted_at IS NULL
           AND ($4::TEXT IS NULL OR e.department = $4)
           AND (CARDINALITY($6::INT[]) = 0 OR ema.employee_id = ANY($6::INT[]))
           AND ema.status <> 'VALIDATED'
         RETURNING ema.*`,
        [this.context.organizationId(), month, year, department, this.context.userId() ?? 1, employeeIds],
      );
      return rows;
    });
  }

  async hrReport(month?: number, year?: number) {
    const employees = await this.employees();
    const contracts = await this.employeeContracts();
    const advances = await this.salaryAdvances();
    const leaves = await this.leaves();
    const monthFilter = month ?? new Date().getMonth() + 1;
    const yearFilter = year ?? new Date().getFullYear();
    const payrolls = await this.payrolls({ month: monthFilter, year: yearFilter });
    const attendance = await this.employeeAttendance({ month: monthFilter, year: yearFilter });
    const expiringContracts = contracts.filter((row) => row.end_date && new Date(row.end_date).getTime() <= Date.now() + 1000 * 60 * 60 * 24 * 45);
    const monthlyPayroll = payrolls.filter((row) => Number(row.month) === monthFilter && Number(row.year) === yearFilter);
    const monthlyAttendance = attendance.filter((row) => Number(row.month) === monthFilter && Number(row.year) === yearFilter);
    const byDepartmentMap = new Map<string, number>();
    for (const employee of employees) {
      const key = String(employee.department ?? 'Non renseignÃ©');
      byDepartmentMap.set(key, (byDepartmentMap.get(key) ?? 0) + 1);
    }
    return {
      summary: {
        total_employees: employees.length,
        active_employees: employees.filter((row) => row.status === 'ACTIVE').length,
        monthly_payroll: monthlyPayroll.reduce((sum, row) => sum + Number(row.net_salary ?? 0), 0),
        advances_open: advances.filter((row) => row.status !== 'PAID' && row.status !== 'REJECTED').length,
        contracts_expiring: expiringContracts.length,
        absences: monthlyAttendance.reduce((sum, row) => sum + Number(row.unjustified_absence_days ?? 0), 0),
        delays: monthlyAttendance.reduce((sum, row) => sum + Number(row.late_count ?? 0), 0),
      },
      employees,
      contracts,
      advances,
      leaves,
      attendance,
      payrolls,
      by_department: Array.from(byDepartmentMap.entries()).map(([department, count]) => ({ department, count })),
      expiring_contracts: expiringContracts,
      current_month: `${yearFilter}-${String(monthFilter).padStart(2, '0')}`,
    };
  }

  async stockPurchases() {
    const { rows } = await this.db.query(
      `SELECT sp.*,
              CONCAT(u.first_name, ' ', u.last_name) AS user_name,
              COUNT(spl.id)::INT AS line_count
       FROM stock_purchases sp
       LEFT JOIN stock_purchase_lines spl
         ON spl.stock_purchase_id = sp.id AND spl.deleted_at IS NULL
       LEFT JOIN app_users u ON u.id = sp.created_by
       WHERE sp.organization_id = $1 AND sp.deleted_at IS NULL
       GROUP BY sp.id, u.first_name, u.last_name
       ORDER BY sp.purchase_date DESC, sp.id DESC`,
      [this.context.organizationId()],
    );
    return rows;
  }

  async stockPurchaseDetail(id: number) {
    const purchase = await this.db.query(
      `SELECT sp.*, CONCAT(u.first_name, ' ', u.last_name) AS user_name
       FROM stock_purchases sp
       LEFT JOIN app_users u ON u.id = sp.created_by
       WHERE sp.id = $1 AND sp.organization_id = $2 AND sp.deleted_at IS NULL`,
      [id, this.context.organizationId()],
    );
    const row = requireRow(purchase.rows[0], 'Stock purchase');
    const [lines, receipts, payments, timeline, stockMovements, cashMovements, attachments] = await Promise.all([
      this.db.query(
        `SELECT spl.*, si.code AS item_code, si.name AS item_name, si.unit, si.category
         FROM stock_purchase_lines spl
         JOIN stock_items si ON si.id = spl.stock_item_id
         WHERE spl.stock_purchase_id = $1 AND spl.organization_id = $2 AND spl.deleted_at IS NULL
         ORDER BY spl.id`,
        [id, this.context.organizationId()],
      ),
      this.db.query(
        `SELECT spr.*,
                (
                  SELECT COALESCE(SUM(quantity_received), 0)
                  FROM stock_purchase_receipt_lines sprl
                  WHERE sprl.stock_purchase_receipt_id = spr.id
                    AND sprl.organization_id = spr.organization_id
                    AND sprl.deleted_at IS NULL
                )::FLOAT AS quantity_received
         FROM stock_purchase_receipts spr
         WHERE spr.stock_purchase_id = $1 AND spr.organization_id = $2 AND spr.deleted_at IS NULL
         ORDER BY spr.receipt_date DESC, spr.id DESC`,
        [id, this.context.organizationId()],
      ),
      this.db.query(
        `SELECT spp.*, CONCAT(u.first_name, ' ', u.last_name) AS user_name
         FROM stock_purchase_payments spp
         LEFT JOIN app_users u ON u.id = spp.created_by
         WHERE spp.stock_purchase_id = $1 AND spp.organization_id = $2 AND spp.deleted_at IS NULL
         ORDER BY spp.payment_date DESC, spp.id DESC`,
        [id, this.context.organizationId()],
      ),
      this.db.query(
        `SELECT spt.*, CONCAT(u.first_name, ' ', u.last_name) AS user_name
         FROM stock_purchase_timeline spt
         LEFT JOIN app_users u ON u.id = spt.created_by
         WHERE spt.stock_purchase_id = $1 AND spt.organization_id = $2
         ORDER BY spt.created_at DESC, spt.id DESC`,
        [id, this.context.organizationId()],
      ),
      this.db.query(
        `SELECT sm.*, si.code AS item_code, si.name AS item_name, si.unit,
                CONCAT(u.first_name, ' ', u.last_name) AS user_name
         FROM stock_movements sm
         JOIN stock_items si ON si.id = sm.stock_item_id
         LEFT JOIN app_users u ON u.id = sm.created_by
         WHERE sm.stock_purchase_id = $1 AND sm.organization_id = $2 AND sm.deleted_at IS NULL
         ORDER BY sm.movement_date DESC, sm.id DESC`,
        [id, this.context.organizationId()],
      ),
      this.db.query(
        `SELECT cm.*, CONCAT(t.first_name, ' ', t.last_name) AS tenant_name
         FROM cash_movements cm
         LEFT JOIN tenants t ON t.id = cm.tenant_id
         WHERE cm.stock_purchase_id = $1 AND cm.organization_id = $2 AND cm.deleted_at IS NULL
         ORDER BY cm.movement_date DESC, cm.id DESC`,
        [id, this.context.organizationId()],
      ),
      this.db.query(
        `SELECT id, purchase_id, file_name, storage_path, mime_type, file_size, created_at
         FROM purchase_attachments
         WHERE purchase_id = $1 AND organization_id = $2 AND deleted_at IS NULL
         ORDER BY created_at DESC, id DESC`,
        [id, this.context.organizationId()],
      ),
    ]);

    const receiptIds = receipts.rows.map((entry) => Number(entry.id));
    const receiptLines = receiptIds.length
      ? await this.db.query(
          `SELECT sprl.*, spr.receipt_number, spr.receipt_date, si.code AS item_code, si.name AS item_name, si.unit
           FROM stock_purchase_receipt_lines sprl
           JOIN stock_purchase_receipts spr ON spr.id = sprl.stock_purchase_receipt_id
           JOIN stock_items si ON si.id = sprl.stock_item_id
           WHERE sprl.organization_id = $1 AND sprl.deleted_at IS NULL AND sprl.stock_purchase_receipt_id = ANY($2::INT[])
           ORDER BY spr.receipt_date DESC, sprl.id DESC`,
          [this.context.organizationId(), receiptIds],
        )
      : { rows: [] };

    return {
      ...row,
      lines: lines.rows,
      receipts: receipts.rows,
      receipt_lines: receiptLines.rows,
      payments: payments.rows,
      timeline: timeline.rows,
      stock_movements: stockMovements.rows,
      cash_movements: cashMovements.rows,
      attachments: attachments.rows,
    };
  }

  async suppliers() {
    const { rows } = await this.db.query(
      `SELECT *
       FROM suppliers
       WHERE organization_id = $1
         AND deleted_at IS NULL
       ORDER BY LOWER(name), id`,
      [this.context.organizationId()],
    );
    return rows;
  }

  async supplier(id: number) {
    const { rows } = await this.db.query(
      `SELECT *
       FROM suppliers
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [id, this.context.organizationId()],
    );
    return requireRow(rows[0], 'Supplier');
  }

  async createSupplier(body: Record<string, unknown>) {
    return this.db.transaction(async (client) => {
      const supplierCode = await this.nextSupplierCode(client);
      const name = String(body.name ?? body.company_name ?? '').trim();
      if (!name) {
        throw new BadRequestException('Le nom du fournisseur est obligatoire');
      }
      const { rows } = await client.query(
        `INSERT INTO suppliers
         (supplier_code, supplier_type, name, company_name, contact_person, phone, secondary_phone, email, address,
          tax_number, national_id, rccm, payment_terms, notes, status, organization_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         RETURNING *`,
        [
          supplierCode,
          String(body.supplier_type ?? 'COMPANY').toUpperCase() === 'INDIVIDUAL' ? 'INDIVIDUAL' : 'COMPANY',
          name,
          String(body.company_name ?? '').trim() || null,
          String(body.contact_person ?? '').trim() || null,
          String(body.phone ?? '').trim() || null,
          String(body.secondary_phone ?? '').trim() || null,
          String(body.email ?? '').trim() || null,
          String(body.address ?? '').trim() || null,
          String(body.tax_number ?? '').trim() || null,
          String(body.national_id ?? '').trim() || null,
          String(body.rccm ?? '').trim() || null,
          String(body.payment_terms ?? '').trim() || null,
          String(body.notes ?? '').trim() || null,
          String(body.status ?? 'ACTIVE').toUpperCase() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
          this.context.organizationId(),
        ],
      );
      return rows[0];
    });
  }

  async updateSupplier(id: number, body: Record<string, unknown>) {
    const keys = [
      'supplier_type',
      'name',
      'company_name',
      'contact_person',
      'phone',
      'secondary_phone',
      'email',
      'address',
      'tax_number',
      'national_id',
      'rccm',
      'payment_terms',
      'notes',
      'status',
    ].filter((key) => body[key] !== undefined);
    if (!keys.length) {
      throw new BadRequestException('No data provided');
    }
    const normalizedBody = {
      ...body,
      supplier_type: String(body.supplier_type ?? '').toUpperCase() === 'INDIVIDUAL' ? 'INDIVIDUAL' : 'COMPANY',
      status: String(body.status ?? '').toUpperCase() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
    };
    return this.updateById('suppliers', id, normalizedBody, keys);
  }

  async createStockPurchase(body: Record<string, unknown>) {
    const lines = Array.isArray(body.lines) ? (body.lines as Array<Record<string, unknown>>) : [];
    if (!lines.length) throw new BadRequestException('Ajoutez au moins un article');
    const purchaseId = await this.db.transaction(async (client) => {
      const paymentType = String(body.payment_type ?? 'DEFERRED').toUpperCase();
      const receiptStatus = String(body.receipt_status ?? 'PENDING').toUpperCase();
      const dueDate = String(body.due_date ?? '').trim() || null;
      if (!['CASH', 'PARTIAL', 'DEFERRED'].includes(paymentType)) {
        throw new BadRequestException('Type de paiement invalide');
      }
      if (!['PENDING', 'RECEIVED'].includes(receiptStatus)) {
        throw new BadRequestException('Statut de reception invalide');
      }
      const purchaseNumber = await this.nextStockPurchaseNumber(client);
      const supplier = await this.requireSupplier(client, Number(body.supplier_id ?? 0));
      const normalizedLines = await this.normalizeStockPurchaseLines(client, lines);
      const subtotalAmount = normalizedLines.reduce((sum, line) => sum + Number(line.line_total), 0);
      const taxAmount = Number(body.tax_amount ?? 0);
      const discountAmount = Number(body.discount_amount ?? 0);
      const totalAmount = subtotalAmount + taxAmount - discountAmount;
      let initialPaidAmount = 0;
      if (paymentType === 'CASH') initialPaidAmount = totalAmount;
      if (paymentType === 'PARTIAL') initialPaidAmount = Number(body.initial_payment_amount ?? 0);
      if (initialPaidAmount < 0 || initialPaidAmount > totalAmount) {
        throw new BadRequestException('Montant paye initial invalide');
      }
      const { rows } = await client.query(
        `INSERT INTO stock_purchases
         (purchase_number, purchase_date, supplier_id, supplier_name, supplier_reference, store, payment_terms, payment_method,
          payment_type, due_date, subtotal_amount, tax_amount, discount_amount, total_amount, paid_amount,
          outstanding_amount, purchase_status, reception_status, payment_status, observations, created_by, organization_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'OPEN', 'PENDING', $17, $18, $19, $20)
         RETURNING *`,
        [
          purchaseNumber,
          body.purchase_date ?? new Date().toISOString().slice(0, 10),
          supplier.id,
          supplier.name,
          body.supplier_reference ?? null,
          body.store ?? null,
          body.payment_terms ?? supplier.payment_terms ?? null,
          body.payment_method ?? null,
          paymentType,
          dueDate,
          subtotalAmount,
          taxAmount,
          discountAmount,
          totalAmount,
          0,
          totalAmount,
          'UNPAID',
          body.observations ?? null,
          this.context.userId() ?? 1,
          this.context.organizationId(),
        ],
      );
      const purchase = rows[0];
      const createdLines: Array<Record<string, unknown>> = [];
      for (const line of normalizedLines) {
        const lineInsert = await client.query(
          `INSERT INTO stock_purchase_lines
           (stock_purchase_id, stock_item_id, quantity, received_quantity, unit_price, line_total, organization_id)
           VALUES ($1, $2, $3, 0, $4, $5, $6)
           RETURNING *`,
          [purchase.id, line.stock_item_id, line.quantity, line.unit_price, line.line_total, this.context.organizationId()],
        );
        createdLines.push(lineInsert.rows[0]);
      }
      await this.addStockPurchaseTimeline(client, purchase.id, 'CREATED', 'Achat fournisseur', `Bon ${purchaseNumber} cree`);
      if (receiptStatus === 'RECEIVED') {
        await this.receiveStockPurchaseInTransaction(client, purchase, {
          receipt_date: body.purchase_date ?? new Date().toISOString().slice(0, 10),
          receiver_name: null,
          store: body.store ?? null,
          notes: body.observations ?? `Reception immediate ${purchaseNumber}`,
          lines: createdLines.map((line) => ({
            stock_purchase_line_id: line.id,
            quantity_received: line.quantity,
          })),
        }, createdLines);
      }
      if (initialPaidAmount > 0) {
        const payment = await this.recordStockPurchasePaymentInTransaction(client, purchase.id, {
          amount: initialPaidAmount,
          payment_date: body.purchase_date ?? new Date().toISOString().slice(0, 10),
          payment_method: body.payment_method ?? null,
          reference: purchaseNumber,
          notes: paymentType === 'CASH' ? 'Paiement comptant achat fournisseur' : 'Paiement partiel achat fournisseur',
        }, true);
        const updatedPurchase = await client.query(
          `SELECT *
           FROM stock_purchases
           WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
          [purchase.id, this.context.organizationId()],
        );
        await this.addStockPurchaseTimeline(client, purchase.id, 'PAYMENT', 'Paiement fournisseur', `Paiement initial ${initialPaidAmount.toFixed(2)} USD`);
        return requireRow(updatedPurchase.rows[0], 'Stock purchase').id;
      }
      return Number(purchase.id);
    });
    return this.stockPurchaseDetail(Number(purchaseId));
  }

  async receiveStockPurchase(id: number, body: Record<string, unknown>) {
    const lines = Array.isArray(body.lines) ? (body.lines as Array<Record<string, unknown>>) : [];
    if (!lines.length) throw new BadRequestException('Ajoutez au moins une ligne de reception');
    await this.db.transaction(async (client) => {
      const purchase = await client.query(
        `SELECT * FROM stock_purchases
         WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
         FOR UPDATE`,
        [id, this.context.organizationId()],
      );
      const purchaseRow = requireRow(purchase.rows[0], 'Stock purchase');
      if (purchaseRow.purchase_status === 'CANCELLED') throw new BadRequestException('Cet achat est annule');
      await this.receiveStockPurchaseInTransaction(client, purchaseRow, body);
    });
    return this.stockPurchaseDetail(id);
  }

  async listPurchaseAttachments(id: number) {
    await this.stockPurchaseDetail(id);
    const { rows } = await this.db.query(
      `SELECT id, purchase_id, file_name, mime_type, file_size, created_at
       FROM purchase_attachments
       WHERE purchase_id = $1 AND organization_id = $2 AND deleted_at IS NULL
       ORDER BY created_at DESC, id DESC`,
      [id, this.context.organizationId()],
    );
    return rows;
  }

  async uploadPurchaseAttachment(id: number, file: any) {
    await this.stockPurchaseDetail(id);
    this.validatePurchaseAttachmentFile(file);
    const fileName = this.originalFileName(file.originalname ?? file.originalName ?? file.name ?? 'piece-jointe');
    const storagePath = this.purchaseAttachmentStoragePath(id, fileName);
    await this.uploadPurchaseAttachmentToStorage(storagePath, file);
    try {
      const { rows } = await this.db.query(
        `INSERT INTO purchase_attachments
         (organization_id, purchase_id, file_name, storage_path, mime_type, file_size, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, purchase_id, file_name, mime_type, file_size, created_at`,
        [this.context.organizationId(), id, fileName, storagePath, file.mimetype, Number(file.size ?? 0), this.context.userId() ?? 1],
      );
      return rows[0];
    } catch (error) {
      await this.deletePurchaseAttachmentStorage(storagePath);
      throw error;
    }
  }

  async downloadPurchaseAttachment(purchaseId: number, attachmentId: number) {
    const { rows } = await this.db.query(
      `SELECT file_name, storage_path, mime_type
       FROM purchase_attachments
       WHERE id = $1 AND purchase_id = $2 AND organization_id = $3 AND deleted_at IS NULL`,
      [attachmentId, purchaseId, this.context.organizationId()],
    );
    const row = requireRow(rows[0], 'Purchase attachment');
    return this.downloadPurchaseAttachmentStorage(String(row.storage_path), String(row.file_name), String(row.mime_type));
  }

  async deletePurchaseAttachment(purchaseId: number, attachmentId: number) {
    const { rows } = await this.db.query(
      `SELECT id, storage_path
       FROM purchase_attachments
       WHERE id = $1 AND purchase_id = $2 AND organization_id = $3 AND deleted_at IS NULL`,
      [attachmentId, purchaseId, this.context.organizationId()],
    );
    const row = requireRow(rows[0], 'Purchase attachment');
    await this.db.query(
      `UPDATE purchase_attachments
       SET deleted_at = NOW()
       WHERE id = $1 AND purchase_id = $2 AND organization_id = $3`,
      [attachmentId, purchaseId, this.context.organizationId()],
    );
    await this.deletePurchaseAttachmentStorage(String(row.storage_path));
    return { success: true };
  }

  async payStockPurchase(id: number, body: Record<string, unknown>) {
    return this.db.transaction(async (client) => {
      const payment = await this.recordStockPurchasePaymentInTransaction(client, id, body, true);
      await this.addStockPurchaseTimeline(client, id, 'PAYMENT', 'Paiement fournisseur', `${Number(body.amount ?? 0).toFixed(2)} USD enregistre`);
      return payment;
    });
  }

  async createStockItem(body: Record<string, unknown>) {
    return this.db.transaction(async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`stock-item-code-${this.context.organizationId()}`]);
      const nextId = await client.query(`SELECT nextval('stock_items_id_seq')::INT AS value`);
      const id = nextId.rows[0].value;
      const nextCode = await client.query(
        `SELECT COALESCE(MAX(NULLIF(regexp_replace(code, '[^0-9]', '', 'g'), '')::INT), 0) + 1 AS value
         FROM stock_items
         WHERE organization_id = $1`,
        [this.context.organizationId()],
      );
      const providedCode = String(body.code ?? '').trim();
      const code = providedCode && !providedCode.toLowerCase().includes('automatique')
        ? providedCode
        : `ART-${String(nextCode.rows[0]?.value ?? 1).padStart(5, '0')}`;
      const initialQuantity = Number(body.current_quantity ?? 0);
      const { rows } = await client.query(
        `INSERT INTO stock_items
         (id, code, name, description, category, unit, current_quantity, minimum_quantity, purchase_price,
          average_purchase_price, observations, status, organization_id, store, barcode, supplier_reference,
          supplier_name, brand, model, photo_file_name, attachment_file_name)
         VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
         RETURNING *`,
        [
          id,
          code,
          body.name,
          body.description ?? null,
          body.category ?? 'Autres',
          body.unit ?? 'piece',
          Number(body.minimum_quantity ?? 0),
          Number(body.purchase_price ?? body.average_purchase_price ?? 0),
          body.observations ?? null,
          body.status ?? 'ACTIVE',
          this.context.organizationId(),
          body.store ?? null,
          body.barcode ?? null,
          body.supplier_reference ?? null,
          body.supplier_name ?? null,
          body.brand ?? null,
          body.model ?? null,
          body.photo_file_name ?? null,
          body.attachment_file_name ?? null,
        ],
      );
      if (initialQuantity > 0) {
        await this.createStockMovementInTransaction(client, {
          stock_item_id: id,
          type: 'INVENTORY',
          quantity: initialQuantity,
          movement_date: new Date().toISOString().slice(0, 10),
          source: 'INITIAL_STOCK',
          reference: `INIT-${code}`,
          notes: 'Stock initial',
          unit_price: Number(body.purchase_price ?? body.average_purchase_price ?? 0),
        });
      }
      return { ...rows[0], current_quantity: initialQuantity };
    });
  }

  async updateStockItem(id: number, body: Record<string, unknown>) {
    const keys = ['code', 'name', 'description', 'category', 'unit', 'minimum_quantity', 'purchase_price', 'average_purchase_price',
      'observations', 'status', 'store', 'barcode', 'supplier_reference', 'supplier_name', 'brand', 'model',
      'photo_file_name', 'attachment_file_name'].filter(
      (key) => body[key] !== undefined,
    );
    if (!keys.length) throw new BadRequestException('No data provided');
    const assignments = keys.map((key, index) => `${key} = $${index + 2}`);
    const { rows } = await this.db.query(
      `UPDATE stock_items SET ${assignments.join(', ')}, updated_at = NOW()
       WHERE id = $1 AND organization_id = $${keys.length + 2} AND deleted_at IS NULL RETURNING *`,
      [id, ...keys.map((key) => body[key]), this.context.organizationId()],
    );
    return requireRow(rows[0], 'Stock item');
  }

  async deactivateStockItem(id: number) {
    const { rows } = await this.db.query(
      `UPDATE stock_items SET status = 'INACTIVE', updated_at = NOW()
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL RETURNING *`,
      [id, this.context.organizationId()],
    );
    return requireRow(rows[0], 'Stock item');
  }

  async reactivateStockItem(id: number) {
    const { rows } = await this.db.query(
      `UPDATE stock_items SET status = 'ACTIVE', updated_at = NOW()
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL RETURNING *`,
      [id, this.context.organizationId()],
    );
    return requireRow(rows[0], 'Stock item');
  }

  async deleteStockItem(id: number) {
    return this.db.transaction(async (client) => {
      const item = await client.query(
        `SELECT id FROM stock_items WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL FOR UPDATE`,
        [id, this.context.organizationId()],
      );
      requireRow(item.rows[0], 'Stock item');

      const history = await client.query(
        `SELECT
           EXISTS(SELECT 1 FROM stock_movements WHERE stock_item_id = $1 AND organization_id = $2 AND deleted_at IS NULL) AS has_movements,
           EXISTS(SELECT 1 FROM inventory_count_lines WHERE stock_item_id = $1 AND organization_id = $2 AND deleted_at IS NULL) AS has_inventory,
           EXISTS(SELECT 1 FROM stock_purchase_lines WHERE stock_item_id = $1 AND organization_id = $2 AND deleted_at IS NULL) AS has_purchases,
           EXISTS(SELECT 1 FROM stock_document_lines WHERE stock_item_id = $1 AND organization_id = $2 AND deleted_at IS NULL) AS has_documents`,
        [id, this.context.organizationId()],
      );
      const row = history.rows[0] ?? {};
      if (row.has_movements || row.has_inventory || row.has_purchases || row.has_documents) {
        throw new ConflictException("Cet article possÃ¨de un historique et ne peut pas Ãªtre supprimÃ©. Vous pouvez le dÃ©sactiver.");
      }

      await client.query(`DELETE FROM stock_items WHERE id = $1 AND organization_id = $2`, [id, this.context.organizationId()]);
      return { deleted: true };
    });
  }

  createStockEntry(body: Record<string, unknown>) {
    if (Array.isArray(body.lines)) return this.createStockDocument('ENTRY', body);
    return this.createStockMovement({ ...body, type: 'IN', source: 'STOCK_ENTRY' });
  }

  createStockExit(body: Record<string, unknown>) {
    if (Array.isArray(body.lines)) return this.createStockDocument('EXIT', body);
    return this.createStockMovement({ ...body, type: 'OUT', source: 'STOCK_EXIT' });
  }

  async createStockDocument(documentType: 'ENTRY' | 'EXIT', body: Record<string, unknown>) {
    const lines = Array.isArray(body.lines) ? body.lines as Array<Record<string, unknown>> : [];
    if (!lines.length) throw new BadRequestException('Ajoutez au moins un article');
    return this.db.transaction(async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`stock-document-${this.context.organizationId()}-${documentType}`]);
      const prefix = documentType === 'ENTRY' ? 'ES' : 'SO';
      const sequence = await client.query(
        `SELECT COALESCE(MAX(NULLIF(regexp_replace(document_number, '[^0-9]', '', 'g'), '')::INT), 0) + 1 AS value
         FROM stock_documents
         WHERE organization_id = $1 AND document_type = $2`,
        [this.context.organizationId(), documentType],
      );
      const documentNumber = `${prefix}-${String(sequence.rows[0].value).padStart(6, '0')}`;
      const document = await client.query(
        `INSERT INTO stock_documents
         (document_number, document_type, document_date, supplier, supplier_reference, store, reference,
          reason, observations, attachment_file_name, attachment_file_url, created_by, organization_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING *`,
        [
          documentNumber,
          documentType,
          body.document_date ?? new Date().toISOString().slice(0, 10),
          body.supplier ?? null,
          body.supplier_reference ?? null,
          body.store ?? null,
          body.reference ?? null,
          body.reason ?? null,
          body.observations ?? null,
          body.attachment_file_name ?? null,
          body.attachment_file_url ?? null,
          this.context.userId() ?? 1,
          this.context.organizationId(),
        ],
      );
      const movements: Record<string, unknown>[] = [];
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const quantity = Number(line.quantity ?? 0);
        if (quantity <= 0) throw new BadRequestException(`Ligne ${index + 1}: la quantitÃ© doit Ãªtre positive`);
        const item = await client.query(
          `SELECT id, name, current_quantity, status
           FROM stock_items
           WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL FOR UPDATE`,
          [line.stock_item_id, this.context.organizationId()],
        );
        const itemRow = requireRow(item.rows[0], `Article ligne ${index + 1}`);
        if (documentType === 'EXIT' && quantity > Number(itemRow.current_quantity)) {
          throw new BadRequestException(
            `Ligne ${index + 1} - ${itemRow.name}: stock insuffisant (${itemRow.current_quantity} disponible)`,
          );
        }
        const unitPrice = Number(line.unit_price ?? 0);
        await client.query(
          `INSERT INTO stock_document_lines
           (stock_document_id, stock_item_id, quantity, unit_price, line_total, organization_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [document.rows[0].id, line.stock_item_id, quantity, unitPrice, quantity * unitPrice, this.context.organizationId()],
        );
        movements.push(await this.createStockMovementInTransaction(client, {
          stock_item_id: line.stock_item_id,
          movement_number: `${documentNumber}-${String(index + 1).padStart(3, '0')}`,
          type: documentType === 'ENTRY' ? 'IN' : 'OUT',
          quantity,
          unit_price: unitPrice,
          movement_date: document.rows[0].document_date,
          source: documentType === 'ENTRY' ? 'STOCK_ENTRY' : 'STOCK_EXIT',
          reference: documentNumber,
          supplier: body.supplier ?? null,
          destination: body.store ?? null,
          notes: body.observations ?? null,
          reason: body.reason ?? null,
          attachment_file_name: body.attachment_file_name ?? null,
          stock_document_id: document.rows[0].id,
        }));
      }
      return {
        ...document.rows[0],
        lines_count: lines.length,
        total: lines.reduce((sum, line) => sum + Number(line.quantity ?? 0) * Number(line.unit_price ?? 0), 0),
        movements,
      };
    });
  }

  createMaintenanceStockConsumption(body: Record<string, unknown>) {
    const lines = Array.isArray(body.lines) ? body.lines as Array<Record<string, unknown>> : null;
    if (Array.isArray(lines)) {
      if (!lines.length) {
        throw new BadRequestException('Ajoutez au moins un article Ã  consommer.');
      }
      return this.db.transaction(async (client) => {
        const movements: Record<string, unknown>[] = [];
        const movementPrefix = `MNT-${body.maintenance_request_id ?? Date.now()}-${Date.now().toString().slice(-6)}`;
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index];
          movements.push(await this.createStockMovementInTransaction(client, {
            ...line,
            movement_number: `${movementPrefix}-${String(index + 1).padStart(2, '0')}`,
            type: 'OUT',
            source: 'MAINTENANCE',
            destination: 'Maintenance',
            maintenance_reference: body.maintenance_reference ?? body.reference ?? movementPrefix,
            maintenance_request_id: body.maintenance_request_id ?? null,
            notes: line.observation ?? line.comment ?? line.notes ?? line.reason ?? body.comment ?? body.notes ?? 'Consommation maintenance',
          }));
        }
        if (body.maintenance_request_id) {
          const totalCost = movements.reduce((sum, movement) => sum + Number((movement as Record<string, unknown>).quantity ?? 0) * Number((movement as Record<string, unknown>).unit_price ?? 0), 0);
          await this.addMaintenanceTimeline(client, Number(body.maintenance_request_id), 'STOCK', 'Consommation de stock', this.maintenanceStockTimelineDetails(movements.length, totalCost));
        }
        return { lines: movements, total_cost: movements.reduce((sum, movement) => sum + Number((movement as Record<string, unknown>).quantity ?? 0) * Number((movement as Record<string, unknown>).unit_price ?? 0), 0) };
      });
    }
    return this.createStockMovement({
      ...body,
      type: 'OUT',
      source: 'MAINTENANCE',
      destination: 'Maintenance',
      maintenance_reference: body.maintenance_reference ?? body.reference ?? null,
      maintenance_request_id: body.maintenance_request_id ?? null,
      notes: body.comment ?? body.notes ?? 'Consommation maintenance',
    });
  }

  private async validateMaintenanceRequestPayload(
    client: PoolClient,
    body: Record<string, unknown>,
    current?: Record<string, unknown> | null,
  ) {
    const title = body.title === undefined ? String(current?.title ?? '') : String(body.title ?? '').trim();
    if (!title) throw new BadRequestException('Le titre est obligatoire');

    const description = body.description === undefined ? String(current?.description ?? '') : String(body.description ?? '').trim();
    if (!description) throw new BadRequestException('La description est obligatoire');

    const category = body.category === undefined ? String(current?.category ?? '') : String(body.category ?? '').trim();
    if (!category) throw new BadRequestException('La catÃ©gorie est obligatoire');
    await this.assertMaintenanceCategoryExists(client, category, current?.category ? String(current.category) : null);

    const priority = body.priority === undefined ? String(current?.priority ?? 'NORMAL') : String(body.priority ?? '').trim().toUpperCase();
    if (!['LOW', 'NORMAL', 'HIGH', 'URGENT'].includes(priority)) {
      throw new BadRequestException('PrioritÃ© de maintenance invalide');
    }

    const buildingId = this.normalizeMaintenanceEntityId(body.building_id ?? current?.building_id ?? null, 'building_id');
    const unitId = this.normalizeMaintenanceEntityId(body.unit_id ?? current?.unit_id ?? null, 'unit_id');
    const leaseId = this.normalizeMaintenanceEntityId(body.lease_id ?? current?.lease_id ?? null, 'lease_id');
    const tenantId = this.normalizeMaintenanceEntityId(body.tenant_id ?? current?.tenant_id ?? null, 'tenant_id');

    const building = buildingId ? await this.requireMaintenanceScopedEntity(client, 'buildings', buildingId, 'Immeuble') : null;
    const unit = unitId ? await this.requireMaintenanceScopedEntity(client, 'units', unitId, 'UnitÃ©') : null;
    const lease = leaseId ? await this.requireMaintenanceScopedEntity(client, 'leases', leaseId, 'Bail') : null;
    const tenant = tenantId ? await this.requireMaintenanceScopedEntity(client, 'tenants', tenantId, 'Locataire') : null;

    if (building && unit && Number(unit.building_id ?? 0) !== buildingId) {
      throw new BadRequestException("L'unitÃ© sÃ©lectionnÃ©e n'appartient pas Ã  l'immeuble choisi");
    }
    if (lease && unit && Number(lease.unit_id ?? 0) !== unitId) {
      throw new BadRequestException("Le bail sÃ©lectionnÃ© n'appartient pas Ã  l'unitÃ© choisie");
    }
    if (lease && tenant && Number(lease.tenant_id ?? 0) !== tenantId) {
      throw new BadRequestException("Le bail sÃ©lectionnÃ© n'appartient pas au locataire choisi");
    }
    if (unit && tenantId && unit.tenant_id && Number(unit.tenant_id) !== tenantId) {
      throw new BadRequestException("Le locataire sÃ©lectionnÃ© ne correspond pas Ã  l'unitÃ© choisie");
    }

    const estimatedCost = this.normalizeMaintenanceNumeric(body.estimated_cost ?? current?.estimated_cost ?? 0, 'estimated_cost', true);
    const reportedAt = body.reported_at === undefined ? current?.reported_at ?? null : this.normalizeMaintenanceDate(body.reported_at, 'reported_at');
    const dueDate = body.due_date === undefined ? current?.due_date ?? null : this.normalizeMaintenanceDate(body.due_date, 'due_date');
    if (reportedAt && dueDate && new Date(String(dueDate)).getTime() < new Date(String(reportedAt)).getTime()) {
      throw new BadRequestException("La date d'Ã©chÃ©ance doit Ãªtre postÃ©rieure Ã  la date du signalement");
    }

    return {
      title,
      description,
      category,
      priority,
      buildingId,
      unitId,
      leaseId,
      tenantId,
      reportedAt,
      dueDate,
      estimatedCost,
    };
  }

  private async validateMaintenanceDiagnosisPayload(client: PoolClient, body: Record<string, unknown>) {
    const estimatedCost = this.normalizeMaintenanceNumeric(body.estimated_cost ?? 0, 'estimated_cost', true);
    const estimatedHours = this.normalizeMaintenanceNumeric(body.estimated_hours ?? 0, 'estimated_hours', true);
    const recommendedTechnician = this.normalizeMaintenanceEntityId(body.recommended_technician ?? null, 'recommended_technician');
    if (recommendedTechnician) {
      await this.requireMaintenanceScopedEntity(client, 'employees', recommendedTechnician, 'EmployÃ©');
    }
    return { estimatedCost, estimatedHours, recommendedTechnician };
  }

  private async validateMaintenanceAssignmentPayload(client: PoolClient, body: Record<string, unknown>) {
    const employeeId = this.normalizeMaintenanceEntityId(body.employee_id ?? null, 'employee_id');
    const externalProvider = String(body.external_provider ?? '').trim() || null;
    if (!employeeId && !externalProvider) {
      throw new BadRequestException("SÃ©lectionnez un technicien interne ou un prestataire externe");
    }
    if (employeeId && externalProvider) {
      throw new BadRequestException("Choisissez soit un technicien interne, soit un prestataire externe");
    }
    if (employeeId) {
      await this.requireMaintenanceScopedEntity(client, 'employees', employeeId, 'EmployÃ©');
    }
    const plannedDate = this.normalizeMaintenanceDate(body.planned_date ?? null, 'planned_date');
    const plannedTime = this.normalizeMaintenanceTime(body.planned_time ?? null, 'planned_time');
    const notes = body.notes === undefined || body.notes === null ? null : String(body.notes).trim();
    if (notes && notes.length > 2000) {
      throw new BadRequestException("Les notes d'affectation sont trop longues");
    }
    return { employeeId, externalProvider, plannedDate, plannedTime, notes };
  }

  private validateMaintenanceExpensePayload(body: Record<string, unknown>) {
    const lines = Array.isArray(body.lines) ? (body.lines as Array<Record<string, unknown>>) : [body];
    if (!lines.length) throw new BadRequestException('Aucune ligne de dÃ©pense fournie');
    const paymentMethod = body.payment_method ? String(body.payment_method).trim().toUpperCase() : null;
    if (paymentMethod && !['CASH', 'BANK', 'MOBILE_MONEY'].includes(paymentMethod)) {
      throw new BadRequestException('Moyen de paiement de maintenance invalide');
    }
    return lines.map((line, index) => {
      const amount = this.normalizeMaintenanceNumeric(line.amount ?? 0, `lines[${index}].amount`, false);
      const category = String(line.category ?? body.category ?? '').trim();
      if (!category) throw new BadRequestException(`Ligne ${index + 1}: la catÃ©gorie est obligatoire`);
      const expenseDate = this.normalizeMaintenanceDate(line.expense_date ?? body.expense_date ?? new Date().toISOString().slice(0, 10), `lines[${index}].expense_date`);
      return { line, amount, category, expenseDate };
    });
  }

  private async validateMaintenanceDocumentPayload(client: PoolClient, id: number, body: Record<string, unknown>) {
    await this.requireMaintenanceRequest(client, id);
    const fileName = String(body.file_name ?? '').trim();
    if (!fileName) throw new BadRequestException('Le nom du document est obligatoire');
    const fileUrl = body.file_url === undefined || body.file_url === null ? null : String(body.file_url).trim();
    const documentType = String(body.document_type ?? 'OTHER').trim() || 'OTHER';
    return { fileName, fileUrl, documentType };
  }

  private normalizeMaintenanceEntityId(value: unknown, fieldName: string) {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new BadRequestException(`Identifiant invalide pour ${fieldName}`);
    }
    return parsed;
  }

  private normalizeMaintenanceNumeric(value: unknown, fieldName: string, allowZero: boolean) {
    const parsed = Number(value ?? 0);
    if (!Number.isFinite(parsed)) {
      throw new BadRequestException(`Valeur numÃ©rique invalide pour ${fieldName}`);
    }
    if (allowZero ? parsed < 0 : parsed <= 0) {
      throw new BadRequestException(allowZero ? `La valeur de ${fieldName} ne peut pas Ãªtre nÃ©gative` : `La valeur de ${fieldName} doit Ãªtre strictement positive`);
    }
    return parsed;
  }

  private normalizeMaintenanceDate(value: unknown, fieldName: string) {
    if (value === undefined || value === null || value === '') return null;
    const text = String(value).trim();
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`Date invalide pour ${fieldName}`);
    }
    return text;
  }

  private normalizeMaintenanceTime(value: unknown, fieldName: string) {
    if (value === undefined || value === null || value === '') return null;
    const text = String(value).trim();
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(text)) {
      throw new BadRequestException(`Heure invalide pour ${fieldName}`);
    }
    return text;
  }

  private async requireMaintenanceScopedEntity(client: PoolClient, table: string, id: number, label: string) {
    const { rows } = await client.query(
      `SELECT * FROM ${table} WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [id, this.context.organizationId()],
    );
    return requireRow(rows[0], label);
  }

  private async requireMaintenanceRequest(client: PoolClient, id: number) {
    const { rows } = await client.query(
      `SELECT * FROM maintenance_requests WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [id, this.context.organizationId()],
    );
    return requireRow(rows[0], 'Maintenance request');
  }

  private async assertMaintenanceCategoryExists(client: PoolClient, category: string, allowedHistorical?: string | null) {
    const normalized = category.trim().toLowerCase();
    if (allowedHistorical && allowedHistorical.trim().toLowerCase() === normalized) {
      return;
    }
    const { rows } = await client.query(
      `SELECT id FROM maintenance_categories
       WHERE organization_id = $1
         AND deleted_at IS NULL
         AND status = 'ACTIVE'
         AND LOWER(name) = $2
       LIMIT 1`,
      [this.context.organizationId(), normalized],
    );
    if (!rows[0]) {
      throw new BadRequestException('CatÃ©gorie de maintenance invalide');
    }
  }

  private maintenanceStockTimelineDetails(count: number, totalCost: number) {
    const label = count > 1 ? 'articles consommÃ©s' : 'article consommÃ©';
    return `${count} ${label} pour ${this.formatMaintenanceUsd(totalCost)}`;
  }

  private maintenanceExpenseTimelineDetails(count: number) {
    const label = count > 1 ? 'dÃ©penses enregistrÃ©es' : 'dÃ©pense enregistrÃ©e';
    return `${count} ${label}`;
  }

  private formatMaintenanceUsd(value: number) {
    return `${Number(value ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
  }

  maintenanceCategories() {
    return this.findAll('maintenance_categories', 'name');
  }

  async maintenanceDashboard(filters: Record<string, unknown> = {}) {
    const organizationId = this.context.organizationId();
    const period = String(filters.period ?? '30d');
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const startOfYear = `${now.getFullYear()}-01-01`;
    const startDate = filters.start ? String(filters.start).slice(0, 10) : (
      period === 'today' ? today :
      period === '7d' ? new Date(now.getTime() - 6 * 86400000).toISOString().slice(0, 10) :
      period === 'year' ? startOfYear :
      period === 'custom' ? null :
      new Date(now.getTime() - 29 * 86400000).toISOString().slice(0, 10)
    );
    const endDate = filters.end ? String(filters.end).slice(0, 10) : today;
    const values: unknown[] = [organizationId];
    const clauses = ['mr.organization_id = $1', 'mr.deleted_at IS NULL'];
    if (startDate) {
      values.push(startDate);
      clauses.push(`mr.reported_at::DATE >= $${values.length}`);
    }
    if (endDate) {
      values.push(endDate);
      clauses.push(`mr.reported_at::DATE <= $${values.length}`);
    }
    const addNumericFilter = (field: string, value: unknown) => {
      if (value === undefined || value === null || value === '') return;
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) return;
      values.push(parsed);
      clauses.push(`${field} = $${values.length}`);
    };
    addNumericFilter('mr.building_id', filters.building_id);
    addNumericFilter('mr.assigned_employee_id', filters.employee_id);
    if (filters.priority) {
      values.push(String(filters.priority));
      clauses.push(`mr.priority = $${values.length}`);
    }
    if (filters.status) {
      values.push(String(filters.status));
      clauses.push(`mr.status = $${values.length}`);
    }
    const whereSql = clauses.join(' AND ');
    const baseSql = `
      WITH request_costs AS (
        SELECT mr.id,
               COALESCE(exp.total_expenses, 0)::FLOAT AS expenses_total,
               COALESCE(stock.total_stock_cost, 0)::FLOAT AS stock_cost_total
        FROM maintenance_requests mr
        LEFT JOIN (
          SELECT maintenance_request_id, SUM(amount) AS total_expenses
          FROM maintenance_expenses
          WHERE organization_id = $1 AND deleted_at IS NULL AND status <> 'REJECTED'
          GROUP BY maintenance_request_id
        ) exp ON exp.maintenance_request_id = mr.id
        LEFT JOIN (
          SELECT maintenance_request_id, SUM(quantity * unit_price) AS total_stock_cost
          FROM stock_movements
          WHERE organization_id = $1 AND deleted_at IS NULL AND maintenance_request_id IS NOT NULL
          GROUP BY maintenance_request_id
        ) stock ON stock.maintenance_request_id = mr.id
        WHERE mr.organization_id = $1 AND mr.deleted_at IS NULL
      )
    `;
    const [summary, byStatus, byPriority, monthly, monthlyCosts, topBuildings, topTechnicians, recent, overdue] = await Promise.all([
      this.db.query(
        `${baseSql}
         SELECT
           COUNT(*)::INT AS total_requests,
           COUNT(*) FILTER (WHERE mr.status NOT IN ('RESOLVED', 'VALIDATED', 'CLOSED', 'CANCELLED'))::INT AS open_requests,
           COUNT(*) FILTER (WHERE mr.status IN ('ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'))::INT AS in_progress,
           COUNT(*) FILTER (WHERE mr.status IN ('RESOLVED', 'VALIDATED'))::INT AS resolved,
           COUNT(*) FILTER (WHERE mr.status = 'CLOSED')::INT AS closed,
           COUNT(*) FILTER (WHERE mr.priority = 'URGENT')::INT AS critical_priority,
           COUNT(*) FILTER (WHERE mr.priority = 'HIGH')::INT AS high_priority,
           COUNT(*) FILTER (WHERE mr.reported_at::DATE = CURRENT_DATE)::INT AS interventions_today,
           COUNT(*) FILTER (WHERE DATE_TRUNC('month', mr.reported_at) = DATE_TRUNC('month', CURRENT_DATE))::INT AS interventions_this_month,
           COALESCE(AVG(EXTRACT(EPOCH FROM (mr.resolved_at - mr.reported_at)) / 3600) FILTER (WHERE mr.resolved_at IS NOT NULL), 0)::FLOAT AS average_resolution_hours,
           COALESCE(SUM(rc.expenses_total + rc.stock_cost_total), 0)::FLOAT AS total_cost,
           COALESCE(SUM(rc.stock_cost_total), 0)::FLOAT AS stock_cost,
           COALESCE(SUM(rc.expenses_total), 0)::FLOAT AS expenses_cost
         FROM maintenance_requests mr
         JOIN request_costs rc ON rc.id = mr.id
         WHERE ${whereSql}`,
        values,
      ),
      this.db.query(
        `${baseSql}
         SELECT mr.status, COUNT(*)::INT AS count
         FROM maintenance_requests mr
         JOIN request_costs rc ON rc.id = mr.id
         WHERE ${whereSql}
         GROUP BY mr.status`,
        values,
      ),
      this.db.query(
        `${baseSql}
         SELECT mr.priority, COUNT(*)::INT AS count
         FROM maintenance_requests mr
         JOIN request_costs rc ON rc.id = mr.id
         WHERE ${whereSql}
         GROUP BY mr.priority`,
        values,
      ),
      this.db.query(
        `${baseSql}
         SELECT TO_CHAR(months.month, 'YYYY-MM') AS month,
                COUNT(mr.id)::INT AS intervention_count
         FROM generate_series(DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '11 months', DATE_TRUNC('month', CURRENT_DATE), INTERVAL '1 month') months(month)
         LEFT JOIN maintenance_requests mr ON DATE_TRUNC('month', mr.reported_at) = months.month AND ${whereSql}
         LEFT JOIN request_costs rc ON rc.id = mr.id
         GROUP BY months.month
         ORDER BY months.month`,
        values,
      ),
      this.db.query(
        `${baseSql}
         SELECT TO_CHAR(months.month, 'YYYY-MM') AS month,
                COALESCE(SUM(rc.stock_cost_total), 0)::FLOAT AS stock_cost,
                COALESCE(SUM(rc.expenses_total), 0)::FLOAT AS expenses_cost,
                COALESCE(SUM(rc.stock_cost_total + rc.expenses_total), 0)::FLOAT AS total_cost
         FROM generate_series(DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '11 months', DATE_TRUNC('month', CURRENT_DATE), INTERVAL '1 month') months(month)
         LEFT JOIN maintenance_requests mr ON DATE_TRUNC('month', mr.reported_at) = months.month AND ${whereSql}
         LEFT JOIN request_costs rc ON rc.id = mr.id
         GROUP BY months.month
         ORDER BY months.month`,
        values,
      ),
      this.db.query(
        `${baseSql}
         SELECT COALESCE(b.name, 'Non renseignÃ©') AS building_name,
                COUNT(mr.id)::INT AS intervention_count,
                COALESCE(SUM(rc.expenses_total + rc.stock_cost_total), 0)::FLOAT AS total_cost
         FROM maintenance_requests mr
         JOIN request_costs rc ON rc.id = mr.id
         LEFT JOIN buildings b ON b.id = mr.building_id AND b.organization_id = mr.organization_id
         WHERE ${whereSql}
         GROUP BY b.name
         ORDER BY intervention_count DESC, total_cost DESC
         LIMIT 10`,
        values,
      ),
      this.db.query(
        `${baseSql}
         SELECT COALESCE(CONCAT(e.first_name, ' ', e.last_name), 'Non assignÃ©') AS technician_name,
                COUNT(mr.id)::INT AS interventions_done,
                COUNT(*) FILTER (WHERE mr.status = 'CLOSED')::INT AS closed_interventions,
                COALESCE(AVG(EXTRACT(EPOCH FROM (mr.resolved_at - mr.reported_at)) / 3600) FILTER (WHERE mr.resolved_at IS NOT NULL), 0)::FLOAT AS average_resolution_hours
         FROM maintenance_requests mr
         JOIN request_costs rc ON rc.id = mr.id
         LEFT JOIN employees e ON e.id = mr.assigned_employee_id AND e.organization_id = mr.organization_id
         WHERE ${whereSql}
         GROUP BY e.first_name, e.last_name
         ORDER BY interventions_done DESC, closed_interventions DESC
         LIMIT 10`,
        values,
      ),
      this.db.query(
        `${baseSql}
         SELECT mr.id, mr.request_number, mr.reported_at, mr.title, mr.priority, mr.status,
                COALESCE(b.name, '-') AS building_name,
                COALESCE(CONCAT(e.first_name, ' ', e.last_name), '-') AS technician_name,
                (rc.expenses_total + rc.stock_cost_total)::FLOAT AS total_cost
         FROM maintenance_requests mr
         JOIN request_costs rc ON rc.id = mr.id
         LEFT JOIN buildings b ON b.id = mr.building_id AND b.organization_id = mr.organization_id
         LEFT JOIN employees e ON e.id = mr.assigned_employee_id AND e.organization_id = mr.organization_id
         WHERE ${whereSql}
         ORDER BY mr.reported_at DESC, mr.id DESC
         LIMIT 10`,
        values,
      ),
      this.db.query(
        `${baseSql}
         SELECT mr.id, mr.request_number, mr.title, mr.priority, mr.due_date,
                GREATEST(0, (CURRENT_DATE - mr.due_date::DATE))::INT AS days_overdue,
                COALESCE(b.name, '-') AS building_name,
                COALESCE(CONCAT(e.first_name, ' ', e.last_name), '-') AS technician_name
         FROM maintenance_requests mr
         JOIN request_costs rc ON rc.id = mr.id
         LEFT JOIN buildings b ON b.id = mr.building_id AND b.organization_id = mr.organization_id
         LEFT JOIN employees e ON e.id = mr.assigned_employee_id AND e.organization_id = mr.organization_id
         WHERE ${whereSql}
           AND mr.status NOT IN ('CLOSED', 'CANCELLED')
           AND mr.due_date IS NOT NULL
           AND mr.due_date::DATE < CURRENT_DATE
         ORDER BY days_overdue DESC, mr.due_date ASC
         LIMIT 10`,
        values,
      ),
    ]);
    return {
      filters: { period, start: startDate, end: endDate },
      kpis: summary.rows[0] ?? {},
      by_status: byStatus.rows,
      by_priority: byPriority.rows,
      monthly_interventions: monthly.rows,
      monthly_costs: monthlyCosts.rows,
      top_buildings: topBuildings.rows,
      top_technicians: topTechnicians.rows,
      recent_interventions: recent.rows,
      overdue_interventions: overdue.rows,
      generated_at: new Date().toISOString(),
    };
  }

  async maintenanceRequests() {
    const { rows } = await this.db.query(
      `SELECT mr.*, b.name AS building_name, u.number AS unit_number,
              CONCAT(t.first_name, ' ', t.last_name) AS tenant_name,
              CONCAT(e.first_name, ' ', e.last_name) AS assigned_employee_name,
              COALESCE(exp.total_expenses, 0)::FLOAT AS expenses_total,
              COALESCE(stock.total_stock_cost, 0)::FLOAT AS stock_cost_total,
              (COALESCE(exp.total_expenses, 0) + COALESCE(stock.total_stock_cost, 0))::FLOAT AS total_cost,
              CASE WHEN mr.due_date IS NOT NULL AND mr.status NOT IN ('RESOLVED', 'VALIDATED', 'CLOSED', 'CANCELLED') AND mr.due_date < NOW() THEN TRUE ELSE FALSE END AS is_overdue,
              CASE WHEN mr.resolved_at IS NOT NULL THEN EXTRACT(EPOCH FROM (mr.resolved_at - mr.reported_at)) / 3600 ELSE NULL END AS resolution_hours
       FROM maintenance_requests mr
       LEFT JOIN buildings b ON b.id = mr.building_id
       LEFT JOIN units u ON u.id = mr.unit_id
       LEFT JOIN tenants t ON t.id = mr.tenant_id
       LEFT JOIN employees e ON e.id = mr.assigned_employee_id
       LEFT JOIN (
         SELECT maintenance_request_id, SUM(amount) AS total_expenses
         FROM maintenance_expenses
         WHERE organization_id = $1 AND deleted_at IS NULL AND status <> 'REJECTED'
         GROUP BY maintenance_request_id
       ) exp ON exp.maintenance_request_id = mr.id
       LEFT JOIN (
         SELECT maintenance_request_id, SUM(quantity * unit_price) AS total_stock_cost
         FROM stock_movements
         WHERE organization_id = $1 AND deleted_at IS NULL AND maintenance_request_id IS NOT NULL
         GROUP BY maintenance_request_id
       ) stock ON stock.maintenance_request_id = mr.id
       WHERE mr.organization_id = $1 AND mr.deleted_at IS NULL
       ORDER BY mr.reported_at DESC, mr.id DESC`,
      [this.context.organizationId()],
    );
    return rows;
  }

  async maintenanceRequestDetail(id: number) {
    const request = await this.db.query(
      `SELECT mr.*, b.name AS building_name, u.number AS unit_number,
              CONCAT(t.first_name, ' ', t.last_name) AS tenant_name,
              CONCAT(e.first_name, ' ', e.last_name) AS assigned_employee_name,
              COALESCE(exp.total_expenses, 0)::FLOAT AS expenses_total,
              COALESCE(stock.total_stock_cost, 0)::FLOAT AS stock_cost_total,
              (COALESCE(exp.total_expenses, 0) + COALESCE(stock.total_stock_cost, 0))::FLOAT AS total_cost
       FROM maintenance_requests mr
       LEFT JOIN buildings b ON b.id = mr.building_id
       LEFT JOIN units u ON u.id = mr.unit_id
       LEFT JOIN tenants t ON t.id = mr.tenant_id
       LEFT JOIN employees e ON e.id = mr.assigned_employee_id
       LEFT JOIN (
         SELECT maintenance_request_id, SUM(amount) AS total_expenses
         FROM maintenance_expenses
         WHERE organization_id = $2 AND deleted_at IS NULL AND status <> 'REJECTED'
         GROUP BY maintenance_request_id
       ) exp ON exp.maintenance_request_id = mr.id
       LEFT JOIN (
         SELECT maintenance_request_id, SUM(quantity * unit_price) AS total_stock_cost
         FROM stock_movements
         WHERE organization_id = $2 AND deleted_at IS NULL AND maintenance_request_id IS NOT NULL
         GROUP BY maintenance_request_id
       ) stock ON stock.maintenance_request_id = mr.id
       WHERE mr.id = $1 AND mr.organization_id = $2 AND mr.deleted_at IS NULL`,
      [id, this.context.organizationId()],
    );
    const row = requireRow(request.rows[0], 'Maintenance request');
    const [assignments, timeline, documents, expenses, stock, communications] = await Promise.all([
      this.db.query(
        `SELECT ma.*, CONCAT(e.first_name, ' ', e.last_name) AS employee_name
         FROM maintenance_assignments ma
         LEFT JOIN employees e ON e.id = ma.employee_id
         WHERE ma.maintenance_request_id = $1 AND ma.organization_id = $2 AND ma.deleted_at IS NULL
         ORDER BY ma.assigned_at DESC`,
        [id, this.context.organizationId()],
      ),
      this.db.query(
        `SELECT * FROM maintenance_timeline
         WHERE maintenance_request_id = $1 AND organization_id = $2 AND deleted_at IS NULL
         ORDER BY created_at, id`,
        [id, this.context.organizationId()],
      ),
      this.db.query(
        `SELECT * FROM maintenance_documents
         WHERE maintenance_request_id = $1 AND organization_id = $2 AND deleted_at IS NULL
         ORDER BY uploaded_at DESC`,
        [id, this.context.organizationId()],
      ),
      this.db.query(
        `SELECT * FROM maintenance_expenses
         WHERE maintenance_request_id = $1 AND organization_id = $2 AND deleted_at IS NULL
         ORDER BY expense_date DESC, id DESC`,
        [id, this.context.organizationId()],
      ),
      this.db.query(
        `SELECT sm.*, si.name AS item_name
         FROM stock_movements sm
         JOIN stock_items si ON si.id = sm.stock_item_id
         WHERE sm.maintenance_request_id = $1 AND sm.organization_id = $2 AND sm.deleted_at IS NULL
         ORDER BY sm.movement_date DESC, sm.id DESC`,
        [id, this.context.organizationId()],
      ),
      this.db.query(
        `SELECT channel, recipient, message, status, sent_at, created_by
         FROM (
           SELECT 'EMAIL'::TEXT AS channel, recipient, message, status, sent_at, created_by
           FROM email_logs
           WHERE related_entity_type = 'maintenance_request' AND related_entity_id = $1 AND organization_id = $2
           UNION ALL
           SELECT 'SMS'::TEXT AS channel, recipient, message, status, sent_at, created_by
           FROM sms_logs
           WHERE related_entity_type = 'maintenance_request' AND related_entity_id = $1 AND organization_id = $2
           UNION ALL
           SELECT 'WHATSAPP'::TEXT AS channel, recipient, message, status, sent_at, created_by
           FROM whatsapp_logs
           WHERE related_entity_type = 'maintenance_request' AND related_entity_id = $1 AND organization_id = $2
         ) comms
         ORDER BY sent_at DESC NULLS LAST`,
        [id, this.context.organizationId()],
      ),
    ]);
    return { ...row, assignments: assignments.rows, timeline: timeline.rows, documents: documents.rows, expenses: expenses.rows, stock_movements: stock.rows, communications: communications.rows };
  }

  async createMaintenanceRequest(body: Record<string, unknown>) {
    return this.db.transaction(async (client) => {
      const validated = await this.validateMaintenanceRequestPayload(client, body);
      const sequence = await client.query(`SELECT COALESCE(MAX(NULLIF(SUBSTRING(request_number FROM '([0-9]+)$'), '')::INT), 0) + 1 AS value FROM maintenance_requests WHERE organization_id = $1 AND request_number LIKE 'M-%'`, [
        this.context.organizationId(),
      ]);
      const requestNumber = body.request_number ?? `M-${String(sequence.rows[0].value).padStart(4, '0')}`;
      const { rows } = await client.query(
        `INSERT INTO maintenance_requests
         (request_number, title, description, category, priority, status, building_id, unit_id, lease_id, tenant_id,
          reported_by_name, reported_at, due_date, attachment_file_name, attachment_file_url, internal_notes, created_by, organization_id)
         VALUES ($1, $2, $3, $4, $5, 'NEW', $6, $7, $8, $9, $10, COALESCE($11::TIMESTAMP, NOW()), $12, $13, $14, $15, $16, $17)
         RETURNING *`,
        [
          requestNumber,
          validated.title,
          validated.description,
          validated.category,
          validated.priority,
          validated.buildingId,
          validated.unitId,
          validated.leaseId,
          validated.tenantId,
          body.reported_by_name ?? null,
          validated.reportedAt,
          validated.dueDate,
          body.attachment_file_name ?? null,
          body.attachment_file_url ?? null,
          body.internal_notes ?? null,
          this.context.userId() ?? 1,
          this.context.organizationId(),
        ],
      );
      if (validated.estimatedCost > 0) {
        await client.query(
          `UPDATE maintenance_requests SET estimated_cost = $3 WHERE id = $1 AND organization_id = $2`,
          [rows[0].id, this.context.organizationId(), validated.estimatedCost],
        );
        rows[0].estimated_cost = validated.estimatedCost;
      }
      await this.addMaintenanceTimeline(client, rows[0].id, 'REPORT', 'Signalement', body.description ? String(body.description) : 'Signalement crÃ©Ã©');
      return rows[0];
    });
  }

  async updateMaintenanceRequest(id: number, body: Record<string, unknown>) {
    return this.db.transaction(async (client) => {
      const current = await client.query(
        `SELECT * FROM maintenance_requests WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
        [id, this.context.organizationId()],
      );
      const existing = requireRow(current.rows[0], 'Maintenance request');
      const validated = await this.validateMaintenanceRequestPayload(client, body, existing);
      const { rows } = await client.query(
        `UPDATE maintenance_requests
         SET title = $3,
             description = $4,
             category = $5,
             priority = $6,
             building_id = $7,
             unit_id = $8,
             lease_id = $9,
             tenant_id = $10,
             reported_by_name = $11,
             reported_at = $12,
             due_date = $13,
             attachment_file_name = $14,
             attachment_file_url = $15,
             internal_notes = $16,
             estimated_cost = $17,
             updated_at = NOW()
         WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
         RETURNING *`,
        [
          id,
          this.context.organizationId(),
          validated.title,
          validated.description,
          validated.category,
          validated.priority,
          validated.buildingId,
          validated.unitId,
          validated.leaseId,
          validated.tenantId,
          body.reported_by_name ?? existing.reported_by_name ?? null,
          validated.reportedAt,
          validated.dueDate,
          body.attachment_file_name ?? existing.attachment_file_name ?? null,
          body.attachment_file_url ?? existing.attachment_file_url ?? null,
          body.internal_notes ?? existing.internal_notes ?? null,
          validated.estimatedCost,
        ],
      );
      await this.addMaintenanceTimeline(client, id, 'UPDATE', 'Modification', 'Demande mise Ã  jour');
      return requireRow(rows[0], 'Maintenance request');
    });
  }

  async diagnoseMaintenanceRequest(id: number, body: Record<string, unknown>) {
    return this.db.transaction(async (client) => {
      await this.assertMaintenanceStatus(client, id, ['NEW', 'DIAGNOSIS']);
      const validated = await this.validateMaintenanceDiagnosisPayload(client, body);
      const nextStatus = body.workflow_required ? 'WAITING_APPROVAL' : 'DIAGNOSIS';
      const { rows } = await client.query(
        `UPDATE maintenance_requests
         SET status = $9,
             diagnostic = $3,
             cause = $4,
             proposed_solution = $5,
             estimated_cost = $6,
             estimated_hours = $7,
             recommended_technician = $8,
             updated_at = NOW()
         WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
         RETURNING *`,
        [
          id,
          this.context.organizationId(),
          body.diagnostic ?? null,
          body.cause ?? null,
          body.proposed_solution ?? null,
          validated.estimatedCost,
          validated.estimatedHours,
          validated.recommendedTechnician,
          nextStatus,
        ],
      );
      if (body.workflow_required) {
        const workflow = await this.createWorkflowInstanceInTransaction(client, {
          type: 'MAINTENANCE_APPROVAL',
          entity_type: 'maintenance_requests',
          entity_id: id,
          title: `Approbation maintenance ${rows[0].request_number}`,
          comment: body.diagnostic ?? null,
        });
        await client.query('UPDATE maintenance_requests SET workflow_instance_id = $2 WHERE id = $1', [id, workflow.id]);
        rows[0].workflow_instance_id = workflow.id;
      }
      await this.addMaintenanceTimeline(client, id, 'DIAGNOSIS', 'Diagnostic', body.diagnostic ? String(body.diagnostic) : 'Diagnostic enregistrÃ©');
      return requireRow(rows[0], 'Maintenance request');
    });
  }

  async requestMaintenanceApproval(id: number, body: Record<string, unknown>) {
    return this.db.transaction(async (client) => {
      await this.assertMaintenanceStatus(client, id, ['DIAGNOSIS']);
      const current = await client.query(
        `SELECT request_number, workflow_instance_id FROM maintenance_requests
         WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
        [id, this.context.organizationId()],
      );
      const request = requireRow(current.rows[0], 'Maintenance request');
      let workflowInstanceId = request.workflow_instance_id;
      if (!workflowInstanceId && body.workflow_required === true) {
        const workflow = await this.createWorkflowInstanceInTransaction(client, {
          type: 'MAINTENANCE_APPROVAL',
          entity_type: 'maintenance_requests',
          entity_id: id,
          title: `Approbation maintenance ${request.request_number}`,
          comment: body.comment ?? null,
        });
        workflowInstanceId = workflow.id;
      }
      const { rows } = await client.query(
        `UPDATE maintenance_requests
         SET status = 'WAITING_APPROVAL', workflow_instance_id = $3, updated_at = NOW()
         WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL RETURNING *`,
        [id, this.context.organizationId(), workflowInstanceId ?? null],
      );
      await this.addMaintenanceTimeline(client, id, 'WAITING_APPROVAL', 'Demande approbation', String(body.comment ?? 'Demande transmise pour approbation'));
      return rows[0];
    });
  }

  async transitionMaintenanceRequest(id: number, status: string, title: string, details: string) {
    const allowedPrevious: Record<string, string[]> = {
      APPROVED: ['WAITING_APPROVAL'],
      DIAGNOSIS: ['WAITING_APPROVAL'],
      ON_HOLD: ['IN_PROGRESS'],
      IN_PROGRESS: ['ON_HOLD', 'RESOLVED'],
      CANCELLED: ['NEW', 'DIAGNOSIS', 'ON_HOLD'],
    };
    if (!allowedPrevious[status]) throw new BadRequestException('Transition maintenance non prise en charge');
    if (status === 'APPROVED') {
      const wf = await this.db.query('SELECT workflow_instance_id FROM maintenance_requests WHERE id = $1 AND organization_id = $2', [id, this.context.organizationId()]);
      await this.db.transaction((client) => this.ensureWorkflowApproved(client, wf.rows[0]?.workflow_instance_id));
    }
    return this.db.transaction(async (client) => {
      await this.assertMaintenanceStatus(client, id, allowedPrevious[status]);
      const { rows } = await client.query(
        `UPDATE maintenance_requests SET status = $3, updated_at = NOW()
         WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL RETURNING *`,
        [id, this.context.organizationId(), status],
      );
      await this.addMaintenanceTimeline(client, id, status, title, details);
      return requireRow(rows[0], 'Maintenance request');
    });
  }

  async assignMaintenanceRequest(id: number, body: Record<string, unknown>) {
    return this.db.transaction(async (client) => {
      await this.assertMaintenanceStatus(client, id, ['NEW', 'DIAGNOSIS', 'APPROVED', 'ASSIGNED']);
      const validated = await this.validateMaintenanceAssignmentPayload(client, body);
      const { rows } = await client.query(
        `UPDATE maintenance_requests
         SET status = 'ASSIGNED', assigned_employee_id = $3, external_provider = $4, updated_at = NOW()
         WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL RETURNING *`,
        [id, this.context.organizationId(), validated.employeeId, validated.externalProvider],
      );
      const request = requireRow(rows[0], 'Maintenance request');
      await client.query(
        `INSERT INTO maintenance_assignments
         (maintenance_request_id, employee_id, external_provider, assigned_by, notes, planned_date, planned_time, organization_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, validated.employeeId, validated.externalProvider, this.context.userId() ?? 1, validated.notes, validated.plannedDate, validated.plannedTime, this.context.organizationId()],
      );
      await this.createMaintenanceAssignmentCommunications(client, request, { ...body, employee_id: validated.employeeId, planned_date: validated.plannedDate, planned_time: validated.plannedTime, notes: validated.notes });
      await this.addMaintenanceTimeline(client, id, 'ASSIGNMENT', 'Assignation', validated.notes ? String(validated.notes) : 'Intervention affectÃ©e');
      return request;
    });
  }

  async startMaintenanceRequest(id: number, body: Record<string, unknown>) {
    await this.db.transaction((client) => this.assertMaintenanceStatus(client, id, ['ASSIGNED']));
    const { rows } = await this.db.query(
      `UPDATE maintenance_requests
       SET status = 'IN_PROGRESS', started_at = COALESCE(started_at, COALESCE($3::TIMESTAMP, NOW())), updated_at = NOW()
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL RETURNING *`,
      [id, this.context.organizationId(), body.started_at ?? null],
    );
    await this.db.transaction((client) => this.addMaintenanceTimeline(client, id, 'INTERVENTION', 'Intervention', body.comments ? String(body.comments) : 'Intervention dÃ©marrÃ©e'));
    return requireRow(rows[0], 'Maintenance request');
  }

  async resolveMaintenanceRequest(id: number, body: Record<string, unknown>) {
    return this.db.transaction(async (client) => {
      await this.assertMaintenanceStatus(client, id, ['IN_PROGRESS']);
      const actualHours = this.normalizeMaintenanceNumeric(body.actual_hours ?? 0, 'actual_hours', true);
      const { rows } = await client.query(
        `UPDATE maintenance_requests
         SET status = 'RESOLVED',
             resolved_at = COALESCE($3::TIMESTAMP, NOW()),
             actual_hours = $4,
             resolution_comments = $5,
             updated_at = NOW()
         WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL RETURNING *`,
        [id, this.context.organizationId(), body.resolved_at ?? null, actualHours, body.resolution_comments ?? body.comments ?? null],
      );
      await this.addMaintenanceTimeline(client, id, 'RESOLUTION', 'RÃ©solution', body.resolution_comments ? String(body.resolution_comments) : 'Intervention rÃ©solue');
      await this.notifyMaintenanceResolution(client, id, 'RESOLVED', String(body.resolution_comments ?? body.comments ?? 'Intervention rÃ©solue'));
      return requireRow(rows[0], 'Maintenance request');
    });
  }

  async validateMaintenanceRequest(id: number, body: Record<string, unknown>) {
    await this.db.transaction((client) => this.assertMaintenanceStatus(client, id, ['RESOLVED']));
    const { rows } = await this.db.query(
      `UPDATE maintenance_requests
       SET status = 'VALIDATED', validated_by = $3, validated_at = NOW(), final_validation_comments = $4,
           technician_signature_name = COALESCE($5, technician_signature_name),
           technician_signed_at = CASE WHEN $5 IS NOT NULL THEN NOW() ELSE technician_signed_at END,
           client_signature_name = COALESCE($6, client_signature_name),
           client_signed_at = CASE WHEN $6 IS NOT NULL THEN NOW() ELSE client_signed_at END,
           updated_at = NOW()
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL RETURNING *`,
      [id, this.context.organizationId(), this.context.userId() ?? 1, body.comments ?? null, body.technician_signature_name ?? null, body.client_signature_name ?? null],
    );
    await this.db.transaction((client) => this.addMaintenanceTimeline(client, id, 'VALIDATION', 'Validation finale', body.comments ? String(body.comments) : 'RÃ©solution validÃ©e'));
    return requireRow(rows[0], 'Maintenance request');
  }

  async closeMaintenanceRequest(id: number) {
    return this.db.transaction(async (client) => {
      await this.assertMaintenanceStatus(client, id, ['VALIDATED']);
      const { rows } = await client.query(
        `UPDATE maintenance_requests
         SET status = 'CLOSED', closed_by = $3, closed_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL RETURNING *`,
        [id, this.context.organizationId(), this.context.userId() ?? 1],
      );
      await this.addMaintenanceTimeline(client, id, 'CLOSURE', 'ClÃ´ture', 'Demande clÃ´turÃ©e');
      await this.notifyMaintenanceResolution(client, id, 'CLOSED', 'Intervention clÃ´turÃ©e');
      return requireRow(rows[0], 'Maintenance request');
    });
  }

  async createMaintenanceExpense(id: number, body: Record<string, unknown>) {
    return this.db.transaction(async (client) => {
      await this.assertMaintenanceStatus(client, id, ['IN_PROGRESS']);
      const validatedLines = this.validateMaintenanceExpensePayload(body);
      const created: Record<string, unknown>[] = [];
      for (const { line, amount, category, expenseDate } of validatedLines) {
        let cashMovementId = null;
        const status = String(line.status ?? body.status ?? 'APPROVED');
        if (status !== 'REJECTED') {
          const movement = await this.createCashMovementInTransaction(client, {
            type: 'OUT',
            category: 'MAINTENANCE_EXPENSE',
            amount,
            movement_date: expenseDate,
            description: line.description ?? line.label ?? body.description ?? 'DÃ©pense maintenance',
            reference: line.reference ?? body.reference ?? `MNT-EXP-${id}`,
            supplier: line.supplier ?? body.supplier ?? null,
            attachment_file_name: line.attachment_file_name ?? body.attachment_file_name ?? null,
            attachment_file_url: line.attachment_file_url ?? body.attachment_file_url ?? null,
            label: line.label ?? line.description ?? body.description ?? 'DÃ©pense maintenance',
          });
          cashMovementId = movement.id;
        }
        const { rows } = await client.query(
          `INSERT INTO maintenance_expenses
           (maintenance_request_id, amount, expense_date, category, description, status, cash_movement_id,
            supplier, payment_method, reference, attachment_file_name, attachment_file_url, observation,
            created_by, organization_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
          [
            id,
            amount,
            expenseDate,
            category,
            line.description ?? line.label ?? body.description ?? null,
            status,
            cashMovementId,
            line.supplier ?? body.supplier ?? null,
            line.payment_method ?? body.payment_method ?? null,
            line.reference ?? body.reference ?? null,
            line.attachment_file_name ?? body.attachment_file_name ?? null,
            line.attachment_file_url ?? body.attachment_file_url ?? null,
            line.observation ?? line.notes ?? body.observation ?? body.notes ?? null,
            this.context.userId() ?? 1,
            this.context.organizationId(),
          ],
        );
        created.push(rows[0]);
      }
      await this.addMaintenanceTimeline(client, id, 'EXPENSE', 'DÃ©pense', this.maintenanceExpenseTimelineDetails(created.length));
      return created.length === 1 ? created[0] : { lines: created, total_amount: created.reduce((sum, row) => sum + Number((row as Record<string, unknown>).amount ?? 0), 0) };
    });
  }

  async createMaintenanceDocument(id: number, body: Record<string, unknown>) {
    const validated = await this.db.transaction((client) => this.validateMaintenanceDocumentPayload(client, id, body));
    const { rows } = await this.db.query(
      `INSERT INTO maintenance_documents (maintenance_request_id, document_type, file_name, file_url, uploaded_by, organization_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [id, validated.documentType, validated.fileName, validated.fileUrl, this.context.userId() ?? 1, this.context.organizationId()],
    );
    await this.db.transaction((client) => this.addMaintenanceTimeline(client, id, 'DOCUMENT', 'Document', validated.fileName || 'Document ajoutÃ©'));
    return rows[0];
  }

  async createStockMovement(body: Record<string, unknown>) {
    return this.db.transaction((client) => this.createStockMovementInTransaction(client, body));
  }

  async stockMovements() {
    const { rows } = await this.db.query(`
      SELECT sm.*, si.code AS item_code, si.name AS item_name, si.category, si.unit, si.store,
             sd.document_number, sd.document_type, sd.reason AS document_reason,
             sp.purchase_number, spr.receipt_number,
             CONCAT(u.first_name, ' ', u.last_name) AS user_name
      FROM stock_movements sm
      JOIN stock_items si ON si.id = sm.stock_item_id
      LEFT JOIN stock_documents sd ON sd.id = sm.stock_document_id AND sd.organization_id = sm.organization_id
      LEFT JOIN stock_purchases sp ON sp.id = sm.stock_purchase_id AND sp.organization_id = sm.organization_id
      LEFT JOIN stock_purchase_receipts spr ON spr.id = sm.stock_purchase_receipt_id AND spr.organization_id = sm.organization_id
      LEFT JOIN app_users u ON u.id = sm.created_by
      WHERE sm.organization_id = $1 AND sm.deleted_at IS NULL
      ORDER BY sm.movement_date DESC, sm.id DESC
    `, [this.context.organizationId()]);
    return rows;
  }

  async stockInventories() {
    const { rows } = await this.db.query(`
      SELECT ic.*,
             COUNT(icl.id)::INT AS line_count,
             COUNT(icl.id) FILTER (WHERE icl.physical_quantity IS NOT NULL)::INT AS counted_lines,
             COALESCE(SUM(CASE WHEN icl.difference_quantity > 0 THEN icl.difference_quantity ELSE 0 END), 0)::FLOAT AS positive_difference,
             COALESCE(SUM(CASE WHEN icl.difference_quantity < 0 THEN ABS(icl.difference_quantity) ELSE 0 END), 0)::FLOAT AS negative_difference,
             COALESCE(SUM(icl.difference_cost), 0)::FLOAT AS difference_value
      FROM inventory_counts ic
      LEFT JOIN inventory_count_lines icl ON icl.inventory_count_id = ic.id AND icl.deleted_at IS NULL
      WHERE ic.organization_id = $1 AND ic.deleted_at IS NULL
      GROUP BY ic.id
      ORDER BY ic.count_date DESC, ic.id DESC
    `, [this.context.organizationId()]);
    return rows;
  }

  async stockMovementDetail(id: number) {
    const movement = await this.db.query(
      `SELECT sm.*, si.code AS item_code, si.name AS item_name, si.category, si.unit,
              COALESCE(sd.store, si.store) AS store, sd.document_number, sd.document_type,
              sd.supplier, sd.supplier_reference, sd.reference AS document_reference,
              sd.reason AS document_reason, sd.observations AS document_observations,
              sp.purchase_number, spr.receipt_number,
              COALESCE(sd.attachment_file_name, sm.attachment_file_name) AS attachment_file_name,
              sd.attachment_file_url, CONCAT(u.first_name, ' ', u.last_name) AS user_name
       FROM stock_movements sm
       JOIN stock_items si ON si.id = sm.stock_item_id
       LEFT JOIN stock_documents sd ON sd.id = sm.stock_document_id AND sd.organization_id = sm.organization_id
       LEFT JOIN stock_purchases sp ON sp.id = sm.stock_purchase_id AND sp.organization_id = sm.organization_id
       LEFT JOIN stock_purchase_receipts spr ON spr.id = sm.stock_purchase_receipt_id AND spr.organization_id = sm.organization_id
       LEFT JOIN app_users u ON u.id = sm.created_by
       WHERE sm.id = $1 AND sm.organization_id = $2 AND sm.deleted_at IS NULL`,
      [id, this.context.organizationId()],
    );
    const history = await this.db.query(
      `SELECT smh.*, CONCAT(u.first_name, ' ', u.last_name) AS user_name
       FROM stock_movement_history smh
       LEFT JOIN app_users u ON u.id = smh.performed_by
       WHERE smh.stock_movement_id = $1 AND smh.organization_id = $2
       ORDER BY smh.created_at DESC, smh.id DESC`,
      [id, this.context.organizationId()],
    );
    return { ...requireRow(movement.rows[0], 'Stock movement'), history: history.rows };
  }

  async stockInventoryDetail(id: number) {
    const inventory = await this.db.query(
      `SELECT ic.*, CONCAT(u.first_name, ' ', u.last_name) AS user_name
       FROM inventory_counts ic
       LEFT JOIN app_users u ON u.id = ic.created_by
       WHERE ic.id = $1 AND ic.organization_id = $2 AND ic.deleted_at IS NULL`,
      [id, this.context.organizationId()],
    );
    const lines = await this.db.query(
      `SELECT icl.*, si.code AS item_code, si.name AS item_name, si.unit
       FROM inventory_count_lines icl
       JOIN stock_items si ON si.id = icl.stock_item_id
       WHERE icl.inventory_count_id = $1 AND icl.organization_id = $2 AND icl.deleted_at IS NULL
       ORDER BY si.name`,
      [id, this.context.organizationId()],
    );
    const countedLines = lines.rows.filter((line) => line.physical_quantity !== null && line.physical_quantity !== undefined).length;
    return {
      ...requireRow(inventory.rows[0], 'Inventory'),
      counted_lines: countedLines,
      uncounted_lines: Math.max(lines.rows.length - countedLines, 0),
      lines: lines.rows,
    };
  }

  async createStockInventory(body: Record<string, unknown>) {
    return this.db.transaction(async (client) => {
      const sequence = await client.query(`SELECT COALESCE(MAX(id), 0) + 1 AS value FROM inventory_counts WHERE organization_id = $1`, [
        this.context.organizationId(),
      ]);
      const inventoryNumber = body.inventory_number ?? `INV-STK-${String(sequence.rows[0].value).padStart(5, '0')}`;
      const inventory = await client.query(
        `INSERT INTO inventory_counts (inventory_number, count_date, status, notes, created_by, organization_id)
         VALUES ($1, $2, 'DRAFT', $3, $4, $5) RETURNING *`,
        [inventoryNumber, body.count_date ?? new Date().toISOString().slice(0, 10), body.notes ?? null, this.context.userId() ?? 1, this.context.organizationId()],
      );
      const suppliedLines = Array.isArray(body.lines) ? (body.lines as Array<Record<string, unknown>>) : [];
      const activeItems = suppliedLines.length ? { rows: suppliedLines } : await client.query(
        `SELECT id AS stock_item_id, current_quantity AS theoretical_quantity,
                average_purchase_price AS unit_cost
         FROM stock_items
         WHERE organization_id = $1 AND deleted_at IS NULL AND status = 'ACTIVE'
         ORDER BY name`,
        [this.context.organizationId()],
      );
      const lines = activeItems.rows;
      for (const line of lines) {
        const item = await client.query(
          `SELECT current_quantity, average_purchase_price, purchase_price
           FROM stock_items WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
          [line.stock_item_id, this.context.organizationId()],
        );
        const theoretical = Number(line.theoretical_quantity ?? item.rows[0]?.current_quantity ?? 0);
        const hasPhysical = line.physical_quantity !== undefined && line.physical_quantity !== null && String(line.physical_quantity) !== '';
        const physical = hasPhysical ? Number(line.physical_quantity) : null;
        const unitCost = Number(line.unit_cost ?? item.rows[0]?.average_purchase_price ?? item.rows[0]?.purchase_price ?? 0);
        const difference = physical === null ? null : physical - theoretical;
        await client.query(
          `INSERT INTO inventory_count_lines
           (inventory_count_id, stock_item_id, theoretical_quantity, physical_quantity, difference_quantity,
            unit_cost, difference_cost, notes, organization_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [inventory.rows[0].id, line.stock_item_id, theoretical, physical, difference, unitCost,
            difference === null ? null : difference * unitCost, line.notes ?? null, this.context.organizationId()],
        );
      }
      return { ...inventory.rows[0], line_count: lines.length };
    });
  }

  async updateStockInventory(id: number, body: Record<string, unknown>) {
    return this.db.transaction(async (client) => {
      const inventory = await client.query(
        `SELECT * FROM inventory_counts WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL FOR UPDATE`,
        [id, this.context.organizationId()],
      );
      const row = requireRow(inventory.rows[0], 'Inventory');
      if (row.status === 'VALIDATED' || row.status === 'CANCELLED') {
        throw new BadRequestException('Cet inventaire est verrouillÃ©');
      }
      const lines = Array.isArray(body.lines) ? body.lines as Array<Record<string, unknown>> : [];
      let counted = 0;
      for (const line of lines) {
        const hasPhysical = line.physical_quantity !== undefined && line.physical_quantity !== null && String(line.physical_quantity) !== '';
        const physical = hasPhysical ? Number(line.physical_quantity) : null;
        if (physical !== null) counted += 1;
        const updated = await client.query(
          `UPDATE inventory_count_lines
           SET physical_quantity = $3,
               difference_quantity = CASE WHEN $3::NUMERIC IS NULL THEN NULL ELSE $3 - theoretical_quantity END,
               difference_cost = CASE WHEN $3::NUMERIC IS NULL THEN NULL ELSE ($3 - theoretical_quantity) * unit_cost END,
               notes = COALESCE($4, notes)
           WHERE id = $1 AND inventory_count_id = $2 AND organization_id = $5 AND deleted_at IS NULL
           RETURNING id`,
          [line.id, id, physical, line.notes ?? null, this.context.organizationId()],
        );
        requireRow(updated.rows[0], 'Inventory line');
      }
      await client.query(
        `UPDATE inventory_counts SET status = $3, updated_at = NOW()
         WHERE id = $1 AND organization_id = $2`,
        [id, this.context.organizationId(), counted > 0 ? 'IN_PROGRESS' : 'DRAFT'],
      );
      return { ...row, status: counted > 0 ? 'IN_PROGRESS' : 'DRAFT' };
    });
  }

  async validateStockInventory(id: number) {
    return this.db.transaction(async (client) => {
      const inventory = await client.query(
        `SELECT * FROM inventory_counts WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
        [id, this.context.organizationId()],
      );
      const inventoryRow = requireRow(inventory.rows[0], 'Inventory');
      if (inventoryRow.status === 'VALIDATED') throw new BadRequestException('Inventaire dÃ©jÃ  validÃ©');
      const lines = await client.query(
        `SELECT * FROM inventory_count_lines WHERE inventory_count_id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
        [id, this.context.organizationId()],
      );
      if (lines.rows.some((line) => line.physical_quantity === null || line.physical_quantity === undefined)) {
        throw new BadRequestException('Tous les articles doivent avoir un stock physique saisi avant validation.');
      }
      for (const line of lines.rows) {
        const difference = Number(line.difference_quantity);
        if (difference === 0) continue;
        await this.createStockMovementInTransaction(client, {
          stock_item_id: line.stock_item_id,
          type: difference > 0 ? 'INVENTORY_GAIN' : 'INVENTORY_LOSS',
          quantity: Math.abs(difference),
          movement_date: inventoryRow.count_date,
          source: 'INVENTORY',
          reference: inventoryRow.inventory_number,
          notes: line.notes ?? 'Ajustement inventaire',
          inventory_count_id: id,
        });
      }
      const { rows } = await client.query(
        `UPDATE inventory_counts
         SET status = 'VALIDATED', validated_by = $3, validated_at = NOW()
         WHERE id = $1 AND organization_id = $2 RETURNING *`,
        [id, this.context.organizationId(), this.context.userId() ?? 1],
      );
      return rows[0];
    });
  }

  async stockAlerts() {
    const { rows } = await this.db.query(
      `SELECT sa.*, si.code AS item_code, si.name AS item_name, si.unit
       FROM stock_alerts sa
       JOIN stock_items si ON si.id = sa.stock_item_id
       WHERE sa.organization_id = $1 AND sa.deleted_at IS NULL
       ORDER BY sa.created_at DESC`,
      [this.context.organizationId()],
    );
    return rows;
  }

  private async leaseRowsByScope(scope: 'active' | 'trash' | 'archive') {
    const visibilityClause =
      scope === 'trash'
        ? 'l.deleted_at IS NOT NULL AND l.archived_at IS NULL'
        : scope === 'archive'
          ? 'l.archived_at IS NOT NULL'
          : 'l.deleted_at IS NULL AND l.archived_at IS NULL';
    const hasLeaseGuarantees = await this.tableExists('lease_guarantees');
    const guaranteeJoin = hasLeaseGuarantees
      ? 'LEFT JOIN lease_guarantees g ON g.lease_id = l.id AND g.organization_id = l.organization_id AND g.deleted_at IS NULL'
      : '';
    const guaranteeAmountExpr = hasLeaseGuarantees ? 'COALESCE(g.amount, l.rental_guarantee_amount, 0)::FLOAT' : 'COALESCE(l.rental_guarantee_amount, 0)::FLOAT';
    const guaranteePaidExpr = hasLeaseGuarantees ? 'COALESCE(g.paid_amount, l.rental_guarantee_paid, 0)::FLOAT' : 'COALESCE(l.rental_guarantee_paid, 0)::FLOAT';
    const guaranteeStatusExpr = hasLeaseGuarantees ? 'COALESCE(g.status, l.rental_guarantee_status)' : 'l.rental_guarantee_status';
    const { rows } = await this.db.query(
      `
        SELECT l.*,
               CASE WHEN t.tenant_type = 'COMPANY' THEN COALESCE(t.company_name, '')
                    ELSE TRIM(CONCAT(COALESCE(t.first_name, ''), ' ', COALESCE(t.last_name, ''), ' ', COALESCE(t.post_name, '')))
               END AS tenant_name,
               u.number AS unit_number,
               b.name AS building_name,
               latest_contract.id AS latest_contract_id,
               latest_contract.status AS latest_contract_status,
               ${guaranteeAmountExpr} AS guarantee_amount,
               ${guaranteePaidExpr} AS guarantee_paid,
               ${guaranteeStatusExpr} AS guarantee_status,
               COALESCE(
                 latest_contract.signed_contract_file_name,
                 latest_contract.docx_file_name,
                 latest_contract.pdf_file_name,
                 l.signed_contract_file_name,
                 l.generated_contract_file_name,
                 l.contract_file_name
               ) AS contract_file_name,
               COALESCE(
                 latest_contract.signed_contract_file_url,
                 latest_contract.docx_file_url,
                 latest_contract.pdf_file_url,
                 l.signed_contract_url,
                 l.generated_contract_url,
                 l.contract_file_url
               ) AS contract_file_url,
               deleted_user.email AS deleted_by_name,
               archived_user.email AS archived_by_name
        FROM leases l
        JOIN tenants t ON t.id = l.tenant_id
        JOIN units u ON u.id = l.unit_id
        JOIN buildings b ON b.id = u.building_id
        ${guaranteeJoin}
        LEFT JOIN app_users deleted_user ON deleted_user.id = l.deleted_by
        LEFT JOIN app_users archived_user ON archived_user.id = l.archived_by
        LEFT JOIN LATERAL (
          SELECT cg.id, cg.status, cg.docx_file_name, cg.docx_file_url, cg.pdf_file_name, cg.pdf_file_url, cg.signed_contract_file_name, cg.signed_contract_file_url
          FROM lease_contract_generations cg
          WHERE cg.lease_id = l.id
            AND cg.organization_id = l.organization_id
            AND cg.deleted_at IS NULL
          ORDER BY cg.generated_at DESC, cg.id DESC
          LIMIT 1
        ) latest_contract ON TRUE
        WHERE l.organization_id = $1
          AND ${visibilityClause}
        ORDER BY COALESCE(l.deleted_at, l.archived_at, l.start_date) DESC, l.id DESC
      `,
      [this.context.organizationId()],
    );
    return rows;
  }

  async leases() {
    return this.leaseRowsByScope('active');
  }

  async trashedLeases() {
    return this.leaseRowsByScope('trash');
  }

  async archivedLeases() {
    return this.leaseRowsByScope('archive');
  }

  async leaseDetail(id: number, scope: 'trash' | 'archive' | 'any' | 'active' = 'active') {
    const visibilityClause =
      scope === 'trash'
        ? 'l.deleted_at IS NOT NULL AND l.archived_at IS NULL'
        : scope === 'archive'
          ? 'l.archived_at IS NOT NULL'
          : scope === 'any'
            ? '(l.deleted_at IS NULL OR l.deleted_at IS NOT NULL OR l.archived_at IS NOT NULL)'
            : 'l.deleted_at IS NULL AND l.archived_at IS NULL';
    const tenantOptionalColumns = await this.optionalColumnSelects('tenants', [
      'post_name',
      'civility',
      'legal_form',
      'rccm',
      'national_id_number',
      'tax_number',
      'address',
      'commune',
      'city',
      'country',
      'id_document_type',
      'id_number',
      'legal_representative_name',
      'legal_representative_civility',
      'legal_representative_role',
      'representative_post_name',
      'representative_first_name',
    ], 't');
    const unitOptionalColumns = await this.optionalColumnSelects('units', [
      'surface_area',
      'bedrooms_count',
      'parking_spaces_count',
      'has_parking',
      'is_furnished',
      'usage_type',
    ], 'u');
    const tenantPostNameExpr = await this.optionalColumnExpression('tenants', 'post_name', 't');
    const tenantAddressExpr = await this.optionalColumnExpression('tenants', 'address', 't');
    const tenantCommuneExpr = await this.optionalColumnExpression('tenants', 'commune', 't');
    const tenantCityExpr = await this.optionalColumnExpression('tenants', 'city', 't');
    const tenantCountryExpr = await this.optionalColumnExpression('tenants', 'country', 't');
    const buildingCommuneExpr = await this.optionalColumnExpression('buildings', 'commune', 'b');
    const buildingCityExpr = await this.optionalColumnExpression('buildings', 'city', 'b');
    const buildingNeighborhoodExpr = await this.optionalColumnExpression('buildings', 'neighborhood', 'b');
    const lease = await this.db.query(
      `SELECT l.*,
               CASE WHEN t.tenant_type = 'COMPANY' THEN COALESCE(t.company_name, '')
                    ELSE TRIM(CONCAT(COALESCE(t.first_name, ''), ' ', COALESCE(t.last_name, ''), ' ', COALESCE(${tenantPostNameExpr}, '')))
               END AS tenant_name,
               t.tenant_type,
               t.first_name, t.last_name, ${tenantOptionalColumns.post_name}, ${tenantOptionalColumns.civility}, t.company_name, ${tenantOptionalColumns.legal_form}, ${tenantOptionalColumns.rccm}, ${tenantOptionalColumns.national_id_number},
               ${tenantOptionalColumns.tax_number}, ${tenantAddressExpr} AS tenant_address, ${tenantCommuneExpr} AS tenant_commune, ${tenantCityExpr} AS tenant_city, ${tenantCountryExpr} AS tenant_country,
               ${tenantOptionalColumns.id_document_type}, ${tenantOptionalColumns.id_number}, ${tenantOptionalColumns.legal_representative_name}, ${tenantOptionalColumns.legal_representative_civility}, ${tenantOptionalColumns.legal_representative_role},
               ${tenantOptionalColumns.representative_post_name}, ${tenantOptionalColumns.representative_first_name},
               t.phone AS tenant_phone,
               t.email AS tenant_email,
               u.number AS unit_number, u.status AS unit_status, u.type AS unit_type, ${unitOptionalColumns.surface_area}, ${unitOptionalColumns.bedrooms_count},
               ${unitOptionalColumns.parking_spaces_count}, ${unitOptionalColumns.has_parking}, ${unitOptionalColumns.is_furnished}, ${unitOptionalColumns.usage_type},
               b.name AS building_name, b.address AS building_address, ${buildingCommuneExpr} AS building_commune,
               ${buildingCityExpr} AS building_city, ${buildingNeighborhoodExpr} AS building_neighborhood,
              deleted_user.email AS deleted_by_name,
              archived_user.email AS archived_by_name
       FROM leases l
       JOIN tenants t ON t.id = l.tenant_id
       JOIN units u ON u.id = l.unit_id
       JOIN buildings b ON b.id = u.building_id
       LEFT JOIN app_users deleted_user ON deleted_user.id = l.deleted_by
       LEFT JOIN app_users archived_user ON archived_user.id = l.archived_by
       WHERE l.id = $1 AND l.organization_id = $2 AND ${visibilityClause}`,
      [id, this.context.organizationId()],
    );
    const row = requireRow(lease.rows[0], 'Lease');
    const activeContractTemplateCode = this.resolveLeaseTemplateCodeForUsage(row.lease_usage ?? row.usage_type)
      ?? (row.contract_template_code ? String(row.contract_template_code).trim() : null);
    const activeContractTemplateVersion = activeContractTemplateCode
      ? await this.activeLeaseContractTemplateVersion(activeContractTemplateCode)
      : null;
    const guarantee = await this.leaseGuarantee(id, row as Record<string, unknown>);
    return {
      ...row,
      guarantee,
      guarantee_payments: await this.leaseGuaranteePayments(id),
      tenant_credit_summary: await this.leaseTenantCreditSummary(id),
      documents: await this.leaseDocuments(id),
      history: await this.unitOccupationHistory(lease.rows[0]?.unit_id ?? 0),
      latest_contract: await this.latestLeaseContract(id),
      active_contract_template_version: this.leasePdfV9Enabled() ? 9 : activeContractTemplateVersion,
    };
  }

  async createLease(body: Record<string, unknown>) {
    const lease = await this.db.transaction(async (client) => {
      const organizationId = this.context.organizationId();
      const normalized = this.normalizeLeasePayload(body, { forceInitialGuaranteeUnpaid: true });
      if (normalized.status === 'ACTIVE') {
        await this.ensureNoLeaseConflict(client, normalized.unitId, normalized.startDate, normalized.endDate);
      }
      const leaseNumber = await this.nextLeaseNumber(client, organizationId);
      const { rows } = await client.query(
       `INSERT INTO leases
         (tenant_id, unit_id, start_date, end_date, monthly_rent, monthly_syndic_amount, rental_guarantee_amount, rental_guarantee_paid,
          rental_guarantee_payment_date, rental_guarantee_status, contract_file_url, contract_file_name, status,
          maintenance_fee_amount, other_charges_amount, lease_total_amount, guarantee_months, notice_months,
          signature_place, signature_date, lease_usage, lease_activity_description, contract_template_code, organization_id, notes, contract_note, lease_number,
          billing_frequency_months)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28)
         RETURNING *`,
        [
          normalized.tenantId,
          normalized.unitId,
          normalized.startDate,
          normalized.endDate,
          normalized.monthlyRent,
          normalized.monthlySyndicAmount,
          normalized.guaranteeAmount,
          normalized.guaranteePaid,
          normalized.guaranteePaymentDate,
          normalized.guaranteeStatus,
          normalized.contractFileUrl,
          normalized.contractFileName,
          normalized.status,
          normalized.maintenanceFeeAmount,
          normalized.otherChargesAmount,
          normalized.leaseTotalAmount,
          normalized.guaranteeMonths,
          normalized.noticeMonths,
          normalized.signaturePlace,
          normalized.signatureDate,
          normalized.leaseUsage,
          normalized.leaseActivityDescription,
          normalized.contractTemplateCode,
          organizationId,
          normalized.notes,
          normalized.contractNote,
          leaseNumber,
          normalized.billingFrequencyMonths,
        ],
      );
      await this.upsertLeaseGuarantee(client, rows[0].id, {
        amount: normalized.guaranteeAmount,
        paid_amount: normalized.guaranteePaid,
        payment_date: normalized.guaranteePaymentDate,
        status: normalized.guaranteeStatus,
      });
      if (normalized.contractFileName) {
        await client.query(
          `INSERT INTO lease_documents (lease_id, document_type, file_name, file_url, uploaded_by, organization_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [rows[0].id, 'CONTRACT', normalized.contractFileName, normalized.contractFileUrl, this.context.userId(), organizationId],
        );
      }
      if (rows[0].status === 'ACTIVE') await this.activateLeaseInTransaction(client, rows[0].id);
      return rows[0];
    });
    if (String(lease.status ?? '').toUpperCase() === 'ACTIVE') {
      await this.generateImmediateInitialRentInvoiceIfNeeded(Number(lease.id));
    }
    return lease;
  }

  async updateLease(id: number, body: Record<string, unknown>) {
    const current = await this.leaseDetail(id) as Record<string, unknown>;
    let shouldGenerateImmediateInitialRentInvoice = false;
    const lease = await this.db.transaction(async (client) => {
      const hasLeaseActivityDescriptionColumn = await this.tableHasColumn(client, 'leases', 'lease_activity_description');
      const currentUsage = this.normalizeLeaseUsageCode(current.lease_usage ?? current.usage_type);
      const currentActivityDescription = String(current.lease_activity_description ?? '').trim();
      const usageProvided = Object.prototype.hasOwnProperty.call(body, 'lease_usage');
      const activityProvided = Object.prototype.hasOwnProperty.call(body, 'lease_activity_description');
      const requestedUsage = usageProvided ? this.normalizeLeaseUsageCode(body.lease_usage) : currentUsage;
      const requestedActivityDescription = activityProvided ? String(body.lease_activity_description ?? '').trim() : currentActivityDescription;
      const requireBusinessActivity = (requestedUsage === 'COMMERCIAL' || requestedUsage === 'PROFESSIONAL')
        && (usageProvided || activityProvided || Boolean(currentActivityDescription));

      if (!hasLeaseActivityDescriptionColumn && (activityProvided || (usageProvided && (requestedUsage === 'COMMERCIAL' || requestedUsage === 'PROFESSIONAL')))) {
        throw new BadRequestException("La base doit d'abord appliquer la migration 20260715_lease_commercial_professional_templates.sql pour modifier l'activitÃ© du bail.");
      }

      const currentGuarantee = current.guarantee as Record<string, unknown> | undefined;
      const normalized = this.normalizeLeasePayload(
        {
          ...current,
          ...body,
          lease_usage: requestedUsage,
          lease_activity_description: requestedActivityDescription || null,
          rental_guarantee_paid: currentGuarantee?.paid_amount ?? current.rental_guarantee_paid ?? current.guarantee_paid ?? 0,
          guarantee_paid: currentGuarantee?.paid_amount ?? current.rental_guarantee_paid ?? current.guarantee_paid ?? 0,
          rental_guarantee_payment_date: currentGuarantee?.payment_date ?? current.rental_guarantee_payment_date ?? current.guarantee_payment_date ?? null,
          guarantee_payment_date: currentGuarantee?.payment_date ?? current.rental_guarantee_payment_date ?? current.guarantee_payment_date ?? null,
          rental_guarantee_status: currentGuarantee?.status ?? current.rental_guarantee_status ?? current.guarantee_status ?? 'NOT_PAID',
          guarantee_status: currentGuarantee?.status ?? current.rental_guarantee_status ?? current.guarantee_status ?? 'NOT_PAID',
        },
        { requireBusinessActivity },
      );
      shouldGenerateImmediateInitialRentInvoice = this.shouldGenerateImmediateInitialRentInvoiceAfterLeaseUpdate(current, normalized, body);
      if (normalized.status === 'ACTIVE') {
        await this.ensureNoLeaseConflict(client, normalized.unitId, normalized.startDate, normalized.endDate, id);
      }
      const updateColumns = [
        'tenant_id = $2',
        'unit_id = $3',
        'start_date = $4',
        'end_date = $5',
        'monthly_rent = $6',
        'monthly_syndic_amount = $7',
        'rental_guarantee_amount = $8',
        'rental_guarantee_paid = $9',
        'rental_guarantee_payment_date = $10',
        'rental_guarantee_status = $11',
        'contract_file_url = $12',
        'contract_file_name = $13',
        'status = $14',
        'maintenance_fee_amount = $15',
        'other_charges_amount = $16',
        'lease_total_amount = $17',
        'guarantee_months = $18',
        'notice_months = $19',
        'signature_place = $20',
        'signature_date = $21',
        'lease_usage = $22',
        'billing_frequency_months = $23',
      ];
      const values: unknown[] = [
        id,
        normalized.tenantId,
        normalized.unitId,
        normalized.startDate,
        normalized.endDate,
        normalized.monthlyRent,
        normalized.monthlySyndicAmount,
        normalized.guaranteeAmount,
        normalized.guaranteePaid,
        normalized.guaranteePaymentDate,
        normalized.guaranteeStatus,
        normalized.contractFileUrl,
        normalized.contractFileName,
        normalized.status,
        normalized.maintenanceFeeAmount,
        normalized.otherChargesAmount,
        normalized.leaseTotalAmount,
        normalized.guaranteeMonths,
        normalized.noticeMonths,
        normalized.signaturePlace,
        normalized.signatureDate,
        normalized.leaseUsage,
        normalized.billingFrequencyMonths,
      ];
      let nextPlaceholder = 24;
      if (hasLeaseActivityDescriptionColumn) {
        updateColumns.push(`lease_activity_description = $${nextPlaceholder}`);
        values.push(normalized.leaseActivityDescription);
        nextPlaceholder += 1;
      }
      updateColumns.push(`contract_template_code = $${nextPlaceholder}`);
      values.push(normalized.contractTemplateCode);
      nextPlaceholder += 1;
      updateColumns.push(`notes = $${nextPlaceholder}`);
      values.push(normalized.notes);
      nextPlaceholder += 1;
      updateColumns.push(`contract_note = $${nextPlaceholder}`);
      values.push(normalized.contractNote);
      nextPlaceholder += 1;
      updateColumns.push('updated_at = NOW()');
      values.push(this.context.organizationId());
      await client.query(
        `UPDATE leases
         SET ${updateColumns.join(',\n             ')}
         WHERE id = $1 AND organization_id = $${nextPlaceholder} AND deleted_at IS NULL`,
        values,
      );
      await this.upsertLeaseGuarantee(client, id, {
        amount: normalized.guaranteeAmount,
        paid_amount: normalized.guaranteePaid,
        payment_date: normalized.guaranteePaymentDate,
        status: normalized.guaranteeStatus,
      });
      if (body.contract_file_name !== undefined || body.contract_file_url !== undefined || normalized.contractFileName) {
        const existingDocument = await client.query(
          `SELECT id FROM lease_documents
           WHERE lease_id = $1 AND organization_id = $2 AND document_type = 'CONTRACT' AND deleted_at IS NULL
           ORDER BY uploaded_at DESC, id DESC
           LIMIT 1`,
          [id, this.context.organizationId()],
        );
        if (existingDocument.rows[0]) {
          await client.query(
            `UPDATE lease_documents
             SET file_name = COALESCE($2, file_name),
                 file_url = COALESCE($3, file_url)
             WHERE id = $1`,
            [existingDocument.rows[0].id, normalized.contractFileName ?? null, normalized.contractFileUrl ?? null],
          );
        } else if (normalized.contractFileName) {
          await client.query(
            `INSERT INTO lease_documents (lease_id, document_type, file_name, file_url, uploaded_by, organization_id)
             VALUES ($1, 'CONTRACT', $2, $3, $4, $5)`,
            [id, normalized.contractFileName, normalized.contractFileUrl ?? null, this.context.userId() ?? 1, this.context.organizationId()],
          );
        }
      }
      return this.leaseDetail(id);
    });
    if (shouldGenerateImmediateInitialRentInvoice) {
      await this.generateImmediateInitialRentInvoiceIfNeeded(id);
    }
    return lease;
  }

  async leaseDeletionImpact(id: number) {
    return this.db.transaction((client) => this.leaseDeletionImpactInTransaction(client, id));
  }

  async trashLease(id: number, reason: string) {
    const deletionReason = String(reason ?? '').trim();
    if (!deletionReason) {
      throw new BadRequestException('Le motif de suppression est obligatoire.');
    }
    return this.db.transaction(async (client) => {
      const organizationId = this.context.organizationId();
      const userId = this.context.userId() ?? null;
      const leaseResult = await client.query(
        `SELECT id, unit_id, status
         FROM leases
         WHERE id = $1
           AND organization_id = $2
           AND deleted_at IS NULL
           AND archived_at IS NULL`,
        [id, organizationId],
      );
      const lease = requireRow(leaseResult.rows[0], 'Lease') as Record<string, unknown>;
      await client.query(
        `UPDATE leases
         SET deleted_at = NOW(),
             deleted_by = $2,
             deletion_reason = $3,
             updated_at = NOW()
         WHERE id = $1 AND organization_id = $4`,
        [id, userId, deletionReason, organizationId],
      );
      if (String(lease.status ?? '').toUpperCase() === 'ACTIVE') {
        await client.query(
          `UPDATE units
           SET status = 'VACANT'
           WHERE id = $1
             AND organization_id = $2
             AND deleted_at IS NULL
             AND NOT EXISTS (
               SELECT 1
               FROM leases
               WHERE unit_id = $1
                 AND organization_id = $2
                 AND status = 'ACTIVE'
                 AND deleted_at IS NULL
                 AND archived_at IS NULL
             )`,
          [Number(lease.unit_id), organizationId],
        );
      }
      await this.writeLeaseAudit(client, 'LEASE_MOVED_TO_TRASH', id, { deletion_reason: deletionReason });
      return { trashed: true, id };
    });
  }

  async restoreLease(id: number) {
    return this.db.transaction(async (client) => {
      const organizationId = this.context.organizationId();
      const leaseResult = await client.query(
        `SELECT *
         FROM leases
         WHERE id = $1
           AND organization_id = $2
           AND deleted_at IS NOT NULL
           AND archived_at IS NULL`,
        [id, organizationId],
      );
      const lease = requireRow(leaseResult.rows[0], 'Lease') as Record<string, unknown>;
      const linkedRecords = await client.query(
        `SELECT t.id AS tenant_id, u.id AS unit_id, b.id AS building_id
         FROM tenants t
         JOIN units u ON u.id = $1 AND u.organization_id = $2 AND u.deleted_at IS NULL
         JOIN buildings b ON b.id = u.building_id AND b.organization_id = $2 AND b.deleted_at IS NULL
         WHERE t.id = $3 AND t.organization_id = $2 AND t.deleted_at IS NULL`,
        [Number(lease.unit_id), organizationId, Number(lease.tenant_id)],
      );
      if (!linkedRecords.rows[0]) {
        throw new ConflictException("Ce contrat ne peut pas etre restaure car le locataire, l unite ou l immeuble lie n existe plus dans l etat actif.");
      }
      if (String(lease.status ?? '').toUpperCase() === 'ACTIVE') {
        await this.ensureNoLeaseConflict(client, Number(lease.unit_id), String(lease.start_date), lease.end_date ? String(lease.end_date) : null, id);
      }
      await client.query(
        `UPDATE leases
         SET deleted_at = NULL,
             deleted_by = NULL,
             deletion_reason = NULL,
             updated_at = NOW()
         WHERE id = $1 AND organization_id = $2`,
        [id, organizationId],
      );
      if (String(lease.status ?? '').toUpperCase() === 'ACTIVE') {
        await client.query(
          `UPDATE units
           SET status = 'OCCUPIED'
           WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
          [Number(lease.unit_id), organizationId],
        );
      }
      await this.writeLeaseAudit(client, 'LEASE_RESTORED', id, {});
      return { restored: true, id };
    });
  }

  async archiveLease(id: number, reason?: string) {
    return this.db.transaction(async (client) => {
      await this.archiveLeaseInTransaction(client, id, reason);
      return { archived: true, id };
    });
  }

  async permanentlyDeleteLease(id: number, reason?: string) {
    return this.db.transaction(async (client) => {
      const organizationId = this.context.organizationId();
      const leaseResult = await client.query(
        `SELECT id, unit_id, status
         FROM leases
         WHERE id = $1
           AND organization_id = $2
           AND deleted_at IS NOT NULL
           AND archived_at IS NULL`,
        [id, organizationId],
      );
      const lease = requireRow(leaseResult.rows[0], 'Lease') as Record<string, unknown>;
      const impact = await this.leaseDeletionImpactInTransaction(client, id);
      if (!impact.canHardDelete) {
        await this.archiveLeaseInTransaction(client, id, String(reason ?? '').trim() || 'Archive automatique apres tentative de suppression definitive');
        return { deleted: false, archived: true, id, impact };
      }
      await client.query('DELETE FROM lease_guarantees WHERE lease_id = $1 AND organization_id = $2', [id, organizationId]);
      await client.query('DELETE FROM leases WHERE id = $1 AND organization_id = $2', [id, organizationId]);
      await client.query(
        `UPDATE units
         SET status = 'VACANT'
         WHERE id = $1
           AND organization_id = $2
           AND deleted_at IS NULL
           AND NOT EXISTS (
             SELECT 1
             FROM leases
             WHERE unit_id = $1
               AND organization_id = $2
               AND status = 'ACTIVE'
               AND deleted_at IS NULL
               AND archived_at IS NULL
           )`,
        [Number(lease.unit_id), organizationId],
      );
      await this.writeLeaseAudit(client, 'LEASE_PERMANENTLY_DELETED', id, { reason: String(reason ?? '').trim() || null });
      return { deleted: true, archived: false, id, impact };
    });
  }

  async deleteLease(id: number) {
    return this.db.transaction(async (client) => {
      const organizationId = this.context.organizationId();
      const userId = this.context.userId();
      const leaseResult = await client.query(
        `SELECT id, unit_id, tenant_id, status
         FROM leases
         WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL AND archived_at IS NULL`,
        [id, organizationId],
      );
      const lease = requireRow(leaseResult.rows[0], 'Lease') as Record<string, unknown>;
      const leaseStatus = String(lease.status ?? '').trim().toUpperCase();
      if (leaseStatus !== 'DRAFT' && leaseStatus !== 'BROUILLON') {
        throw new ConflictException('Seuls les baux en brouillon peuvent Ãªtre supprimÃ©s.');
      }

      const [invoices, contracts, documents] = await Promise.all([
        client.query(
          `SELECT COUNT(*)::INT AS total
           FROM invoices
           WHERE lease_id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
          [id, organizationId],
        ),
        client.query(
          `SELECT COUNT(*)::INT AS total
           FROM lease_contract_generations
           WHERE lease_id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
          [id, organizationId],
        ),
        client.query(
          `SELECT COUNT(*)::INT AS total
           FROM lease_documents
           WHERE lease_id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
          [id, organizationId],
        ),
      ]);

      const invoicesCount = Number(invoices.rows[0]?.total ?? 0);
      const contractsCount = Number(contracts.rows[0]?.total ?? 0);
      const documentsCount = Number(documents.rows[0]?.total ?? 0);
      if (invoicesCount > 0 || contractsCount > 0 || documentsCount > 0) {
        throw new ConflictException(
          'Ce bail possÃ¨de dÃ©jÃ  un historique financier ou contractuel et ne peut pas Ãªtre supprimÃ©.',
        );
      }

      await client.query(
        `UPDATE lease_guarantees
         SET deleted_at = NOW(), deleted_by = $2
         WHERE lease_id = $1 AND organization_id = $3 AND deleted_at IS NULL`,
        [id, userId ?? null, organizationId],
      );
      await client.query(
        `UPDATE leases
         SET deleted_at = NOW(), deleted_by = $2, updated_at = NOW()
         WHERE id = $1 AND organization_id = $3 AND deleted_at IS NULL`,
        [id, userId ?? null, organizationId],
      );
      await client.query(
        `UPDATE units
         SET status = 'VACANT'
         WHERE id = $1
           AND organization_id = $2
           AND NOT EXISTS (
             SELECT 1
             FROM leases
             WHERE unit_id = $1
               AND organization_id = $2
               AND status = 'ACTIVE'
               AND deleted_at IS NULL
               AND archived_at IS NULL
           )`,
        [Number(lease.unit_id), organizationId],
      );

      return { deleted: true, id };
    });
  }

  async activateLease(id: number) {
    const lease = await this.db.transaction((client) => this.activateLeaseInTransaction(client, id));
    await this.generateImmediateInitialRentInvoiceIfNeeded(id);
    return lease;
  }

  async terminateLease(id: number, reason: string) {
    return this.db.transaction(async (client) => {
      const lease = await client.query(
        `SELECT * FROM leases WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL AND archived_at IS NULL`,
        [id, this.context.organizationId()],
      );
      const row = requireRow(lease.rows[0], 'Lease');
      const { rows } = await client.query(
        `UPDATE leases
         SET status = 'TERMINATED', terminated_at = NOW(), end_date = COALESCE(end_date, CURRENT_DATE), termination_reason = $3, updated_at = NOW()
         WHERE id = $1 AND organization_id = $2 RETURNING *`,
        [id, this.context.organizationId(), reason],
      );
      await client.query(
        `UPDATE units SET status = 'VACANT'
         WHERE id = $1 AND organization_id = $2 AND NOT EXISTS (
           SELECT 1 FROM leases
           WHERE unit_id = $1 AND organization_id = $2 AND status = 'ACTIVE' AND deleted_at IS NULL AND archived_at IS NULL AND id <> $3
         )`,
        [row.unit_id, this.context.organizationId(), id],
      );
      return rows[0];
    });
  }

  async leaseGuarantee(id: number, leaseFallback?: Record<string, unknown>) {
    if (!(await this.tableExists('lease_guarantees'))) {
      return this.legacyLeaseGuaranteeFallback(id, leaseFallback);
    }
    const { rows } = await this.db.query(
      `SELECT * FROM lease_guarantees WHERE lease_id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [id, this.context.organizationId()],
    );
    return rows[0] ?? this.legacyLeaseGuaranteeFallback(id, leaseFallback);
  }

  async leaseGuaranteePayments(id: number) {
    if (!(await this.tableExists('lease_guarantees')) || !(await this.supportsGuaranteePaymentSchema())) {
      return [];
    }
    const { rows } = await this.db.query(
      `SELECT p.id, p.payment_date, p.amount, p.payment_method, p.reference, p.receipt_number, p.cash_movement_id, p.guarantee_cash_movement_id,
              p.amount_usd, p.amount_cdf, p.total_equivalent_usd
       FROM payments p
       JOIN lease_guarantees g ON g.id = p.lease_guarantee_id
       WHERE g.lease_id = $1
         AND p.organization_id = $2
         AND g.organization_id = $2
         AND p.payment_type = 'GUARANTEE'
         AND p.deleted_at IS NULL
         AND g.deleted_at IS NULL
       ORDER BY p.payment_date DESC, p.id DESC`,
      [id, this.context.organizationId()],
    );
    return rows;
  }

  private legacyLeaseGuaranteeFallback(id: number, lease?: Record<string, unknown>) {
    if (!lease) return null;
    const amount = Number(lease.rental_guarantee_amount ?? lease.guarantee_amount ?? 0);
    const paidAmount = Number(lease.rental_guarantee_paid ?? lease.guarantee_paid ?? 0);
    const status = String(lease.rental_guarantee_status ?? lease.guarantee_status ?? (paidAmount >= amount && amount > 0 ? 'PAID' : paidAmount > 0 ? 'PARTIAL' : 'NOT_PAID'));
    if (amount <= 0 && paidAmount <= 0 && !status) return null;
    return {
      id: null,
      lease_id: id,
      amount,
      paid_amount: paidAmount,
      payment_date: lease.rental_guarantee_payment_date ?? lease.guarantee_payment_date ?? null,
      status,
      historical: true,
    };
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

  async leaseDocuments(id: number) {
    const { rows } = await this.db.query(
      `SELECT * FROM lease_documents WHERE lease_id = $1 AND organization_id = $2 AND deleted_at IS NULL ORDER BY uploaded_at DESC`,
      [id, this.context.organizationId()],
    );
    return rows;
  }

  async latestLeaseContract(id: number) {
    const { rows } = await this.db.query(
      `SELECT cg.*
       FROM lease_contract_generations cg
       WHERE cg.lease_id = $1
         AND cg.organization_id = $2
         AND cg.deleted_at IS NULL
       ORDER BY cg.generated_at DESC, cg.id DESC
       LIMIT 1`,
      [id, this.context.organizationId()],
    );
    return rows[0] ?? null;
  }

  async latestLeaseContractDocx(id: number) {
    const { rows } = await this.db.query(
      `SELECT cg.id, cg.lease_id, cg.template_version, cg.template_code, cg.template_hash,
              cg.generated_at, cg.status, cg.docx_file_name, cg.docx_file_url, cg.docx_storage_path,
              cg.docx_file_hash, cg.docx_mime_type
       FROM lease_contract_generations cg
       WHERE cg.lease_id = $1
         AND cg.organization_id = $2
         AND cg.deleted_at IS NULL
         AND cg.docx_file_name IS NOT NULL
         AND cg.docx_file_url IS NOT NULL
         AND cg.status IN ('GENERATED', 'PRINTED', 'SIGNED')
       ORDER BY cg.generated_at DESC, cg.id DESC
       LIMIT 1`,
      [id, this.context.organizationId()],
    );
    const contract = rows[0];
    if (!contract) return null;
    return {
      id: contract.id,
      lease_id: contract.lease_id,
      template_version: contract.template_version,
      template_code: contract.template_code ?? null,
      template_hash: contract.template_hash ?? null,
      generated_at: contract.generated_at,
      status: contract.status,
      docx_file_name: contract.docx_file_name ?? null,
      docx_file_url: contract.docx_file_url ?? null,
      docx_storage_path: contract.docx_storage_path ?? null,
      docx_file_hash: contract.docx_file_hash ?? null,
      docx_mime_type: contract.docx_mime_type ?? null,
    };
  }

  async generateLeaseContract(id: number) {
    if (!this.leasePdfV9Enabled()) {
      return this.generateLeaseContractDocx(id);
    }
    return this.generateLeaseContractPdfV9(id);
  }

  private async generateLeaseContractPdfV9(id: number) {
    const organizationId = this.context.organizationId();
    let leaseId = id;
    let templateCode = 'LEASE_RESIDENTIAL';
    let currentStep = 'started';
    let uploadedPdfForCleanup: { storagePath: string; fileName: string } | undefined;

    try {
      const lease = await this.leaseDetail(id) as Record<string, any>;
      leaseId = Number(lease.id ?? id);
      const company = await this.companySettings();
      const companyData = company as Record<string, any>;
      const landlordName = String(companyData.company_legal_name_resolved ?? companyData.company_legal_name ?? companyData.legal_name ?? companyData.company_name ?? '').trim();
      const tenantName = String(lease.tenant_name ?? '').trim();
      const unitNumber = String(lease.unit_number ?? '').trim();
      const buildingName = String(lease.building_name ?? '').trim();
      const startDate = String(lease.start_date ?? '').trim();
      const monthlyRent = Number(lease.monthly_rent ?? 0);
      if (!landlordName || !tenantName || !unitNumber || !buildingName || !startDate || !Number.isFinite(monthlyRent) || monthlyRent <= 0) {
        throw new BadRequestException('Informations insuffisantes pour generer le contrat PDF');
      }

      const usage = this.normalizeLeaseUsageCode(lease.lease_usage ?? companyData.default_lease_usage ?? lease.usage_type);
      templateCode = this.resolveLeaseTemplateCodeForUsage(usage) ?? templateCode;
      if ((usage === 'COMMERCIAL' || usage === 'PROFESSIONAL' || usage === 'MIXED') && !String(lease.lease_activity_description ?? '').trim()) {
        throw new BadRequestException("Activite ou destination des lieux requise pour generer ce contrat.");
      }

      const generationInstant = new Date();
      const snapshot = this.buildLeaseContractSnapshot(lease, company, generationInstant);
      currentStep = 'context_loaded';
      this.logLeasePdfV9('context_loaded', { leaseId, organizationId, templateCode });

      const renderContext = this.documentRenderer.buildLeaseRenderContext(snapshot);
      const rendered = this.documentTemplate.renderLeaseTemplate(renderContext);
      templateCode = rendered.templateCode;
      currentStep = 'template_loaded';
      this.logLeasePdfV9('template_loaded', {
        leaseId,
        organizationId,
        templateCode,
        templateSource: rendered.templateSource,
        templateRoot: rendered.templateRoot,
        templateRuntime: this.documentTemplate.getRuntimeInfo(),
      });
      currentStep = 'html_rendered';
      this.logLeasePdfV9('html_rendered', {
        leaseId,
        organizationId,
        templateCode,
        htmlBytes: Buffer.byteLength(rendered.html, 'utf8'),
      });

      const chromium = await this.pdfRenderer.getRuntimeInfo();
      currentStep = 'chromium_started';
      this.logLeasePdfV9('chromium_started', {
        leaseId,
        organizationId,
        templateCode,
        executablePath: chromium.executablePath,
        executableExists: chromium.executableExists,
      });

      const pdfBuffer = await this.pdfRenderer.renderA4Pdf(rendered.html);
      const pdfHash = getDocxBufferSha256(pdfBuffer);
      currentStep = 'pdf_generated';
      this.logLeasePdfV9('pdf_generated', {
        leaseId,
        organizationId,
        templateCode,
        pdfBytes: pdfBuffer.byteLength,
        pdfHeader: pdfBuffer.subarray(0, 4).toString(),
      });

      return this.db.transaction(async (client) => {
        const template = await this.activeLeaseContractTemplate(client, rendered.templateCode);
        currentStep = 'db_persist_started';
        this.logLeasePdfV9('db_persist_started', {
          leaseId,
          organizationId,
          templateCode,
        });
        const { rows } = await client.query(
          `INSERT INTO lease_contract_generations
           (organization_id, lease_id, template_id, template_version, generated_content, generated_html, snapshot_json,
            docx_file_name, docx_file_url, pdf_file_name, pdf_file_url, generated_by, status, template_code, template_hash)
           VALUES ($1, $2, $3, $4, $5, $6, $7::JSONB, NULL, NULL, NULL, NULL, $8, 'GENERATED', $9, $10)
           RETURNING *`,
          [
            organizationId,
            id,
            template.id,
            9,
            rendered.html,
            rendered.html,
            JSON.stringify({ ...snapshot, renderer: { version: rendered.rendererVersion, templateSource: rendered.templateSource } }),
            this.context.userId() ?? 1,
            rendered.templateCode,
            rendered.templateHash,
          ],
        );
        const contract = rows[0];
        const generatedAt = new Date(contract.generated_at ?? new Date().toISOString());
        const pdfFileName = this.buildLeasePdfFileName(lease.id, contract.id, 9);
        currentStep = 'storage_upload_started';
        this.logLeasePdfV9('storage_upload_started', {
          leaseId,
          organizationId,
          templateCode,
          contractId: contract.id,
          fileName: pdfFileName,
        });
        const storedPdf = await this.persistLeaseContractPdf(id, contract.id, 9, generatedAt, pdfFileName, pdfBuffer);
        uploadedPdfForCleanup = { storagePath: storedPdf.storagePath, fileName: storedPdf.fileName };
        currentStep = 'storage_uploaded';
        this.logLeasePdfV9('storage_uploaded', {
          leaseId,
          organizationId,
          templateCode,
          fileName: storedPdf.fileName,
          storagePath: storedPdf.storagePath,
          mimeType: storedPdf.mimeType,
        });
        this.logLeasePdfV9('db_value_lengths', {
          leaseId,
          organizationId,
          templateCode,
          values: [
            { columnName: 'pdf_file_name', valueLength: storedPdf.fileName.length, maxLengthExpected: 220 },
            { columnName: 'pdf_file_url', valueLength: storedPdf.fileUrl.length, maxLengthExpected: null },
            { columnName: 'status', valueLength: 'GENERATED'.length, maxLengthExpected: 30 },
            { columnName: 'template_code', valueLength: rendered.templateCode.length, maxLengthExpected: 80 },
            { columnName: 'template_hash', valueLength: rendered.templateHash.length, maxLengthExpected: 64 },
            { columnName: 'pdf_hash', valueLength: pdfHash.length, maxLengthExpected: 64 },
          ],
        });

        const { rows: updatedRows } = await client.query(
          `UPDATE lease_contract_generations
           SET pdf_file_name = $3,
               pdf_file_url = $4,
               template_code = $5,
               template_hash = $6
           WHERE id = $1 AND lease_id = $2 AND organization_id = $7
           RETURNING *`,
          [
            contract.id,
            id,
            storedPdf.fileName,
            storedPdf.fileUrl,
            rendered.templateCode,
            rendered.templateHash,
            organizationId,
          ],
        );
        await client.query(
          `UPDATE leases
           SET generated_contract_file_name = $2,
               generated_contract_url = $3,
               contract_generated_at = NOW(),
               contract_template_code = $4,
               updated_at = NOW()
           WHERE id = $1 AND organization_id = $5`,
          [id, storedPdf.fileName, storedPdf.fileUrl, rendered.templateCode, organizationId],
        );
        await client.query(
          `INSERT INTO lease_documents (lease_id, document_type, file_name, file_url, uploaded_by, organization_id)
           VALUES ($1, 'GENERATED_CONTRACT_PDF', $2, $3, $4, $5)`,
          [id, storedPdf.fileName, storedPdf.fileUrl, this.context.userId() ?? 1, organizationId],
        );
        currentStep = 'db_persisted';
        this.logLeasePdfV9('db_persisted', {
          leaseId,
          organizationId,
          templateCode,
          contractId: contract.id,
        });
        uploadedPdfForCleanup = undefined;
        currentStep = 'response_sent';
        this.logLeasePdfV9('response_sent', {
          leaseId,
          organizationId,
          templateCode,
          contractId: contract.id,
        });
        return updatedRows[0];
      });
    } catch (error: any) {
      this.logger.error(
        `[LEASE_PDF_V9] failed leaseId=${leaseId} organizationId=${organizationId} templateCode=${templateCode} step=${currentStep} errorName=${error?.name ?? 'Error'} message=${error?.message ?? '(empty)'} code=${error?.code ?? error?.response?.code ?? '(none)'} status=${error?.status ?? error?.response?.statusCode ?? '(none)'}`,
        error?.stack,
      );
      if (error?.cause) {
        this.logger.error(
          `[LEASE_PDF_V9] causeName=${error.cause?.name ?? 'Error'} causeMessage=${error.cause?.message ?? String(error.cause)} causeCode=${error.cause?.code ?? '(none)'}`,
          error.cause?.stack,
        );
      }
      if (error?.response) {
        this.logger.error(`[LEASE_PDF_V9] response=${JSON.stringify(error.response)}`);
      }
      if (uploadedPdfForCleanup) {
        await this.deleteUploadedLeaseContractStorage(uploadedPdfForCleanup.storagePath)
          .then(() => this.logLeasePdfV9('storage_orphan_cleaned', {
            leaseId,
            organizationId,
            templateCode,
            fileName: uploadedPdfForCleanup?.fileName,
            storagePath: uploadedPdfForCleanup?.storagePath,
          }))
          .catch((cleanupError) => this.logger.error(
            `[LEASE_PDF_V9] storage_orphan_cleanup_failed leaseId=${leaseId} organizationId=${organizationId} storagePath=${uploadedPdfForCleanup?.storagePath} message=${cleanupError?.message ?? cleanupError}`,
            cleanupError?.stack,
          ));
      }
      throw this.mapLeasePdfV9Error(error);
    }
  }

  async generateLeaseContractDocx(id: number) {
    return this.db.transaction(async (client) => {
      const templateRuntime = getLeaseContractTemplateMetadata();
      const lease = await this.leaseDetail(id) as Record<string, any>;
      const company = await this.companySettings();
      const companyData = company as Record<string, any>;
      const landlordName = String(companyData.company_legal_name_resolved ?? companyData.company_legal_name ?? companyData.legal_name ?? companyData.company_name ?? '').trim();
      const landlordRccm = String(companyData.company_rccm ?? '').trim();
      const landlordAddress = String(companyData.company_address_resolved ?? companyData.company_address ?? companyData.address ?? '').trim();
      const landlordRepresentative = String(companyData.legal_representative_name ?? '').trim();
      const landlordRepresentativeTitle = String(companyData.legal_representative_title ?? '').trim();
      const tenantName = String(lease.tenant_name ?? '').trim();
      const unitNumber = String(lease.unit_number ?? '').trim();
      const buildingName = String(lease.building_name ?? '').trim();
      const startDate = String(lease.start_date ?? '').trim();
      const monthlyRent = Number(lease.monthly_rent ?? 0);
      if (!landlordName || !landlordRccm || !landlordAddress || !landlordRepresentative || !landlordRepresentativeTitle || !tenantName || !unitNumber || !buildingName || !startDate || !Number.isFinite(monthlyRent) || monthlyRent <= 0) {
        throw new BadRequestException('Informations insuffisantes pour generer le contrat');
      }
      const templateCode = this.resolveLeaseTemplateCodeForUsage(lease.lease_usage ?? companyData.default_lease_usage ?? lease.usage_type)
        ?? (lease.contract_template_code ? String(lease.contract_template_code).trim() : '');
      if (!templateCode) {
        throw new BadRequestException(this.missingLeaseTemplateMessage(lease.lease_usage ?? companyData.default_lease_usage ?? lease.usage_type));
      }
      if ((templateCode === 'LEASE_COMMERCIAL' || templateCode === 'LEASE_PROFESSIONAL' || templateCode === 'LEASE_MIXED')
        && !String(lease.lease_activity_description ?? '').trim()) {
        throw new BadRequestException("Activite ou destination des lieux requise pour generer ce contrat.");
      }
      const template = await this.activeLeaseContractTemplate(client, templateCode);
      const generationInstant = new Date();
      const snapshot = this.buildLeaseContractSnapshot(lease, company, generationInstant);
      const renderedContent = renderLeaseContractTemplate(template.content, snapshot);
      const placeholders = unresolvedPlaceholders(renderedContent);
      if (placeholders.length) {
        throw new BadRequestException(`Variables de contrat non resolues: ${placeholders.join(', ')}`);
      }
      const renderedHtml = buildLeaseContractHtml(renderedContent, snapshot);
      const { rows } = await client.query(
        `INSERT INTO lease_contract_generations
         (organization_id, lease_id, template_id, template_version, generated_content, generated_html, snapshot_json,
          docx_file_name, docx_file_url, pdf_file_name, pdf_file_url, generated_by, status, template_code, template_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7::JSONB, NULL, NULL, NULL, NULL, $8, 'GENERATED', $9, $10)
         RETURNING *`,
        [
          this.context.organizationId(),
          id,
          template.id,
          template.version,
          renderedContent,
          renderedHtml,
          JSON.stringify(snapshot),
          this.context.userId() ?? 1,
          template.code,
          templateRuntime.sha256,
        ],
      );
      const contract = rows[0];
      const generatedAt = new Date(contract.generated_at ?? new Date().toISOString());
      const generatedStamp = generatedAt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
      const docxFileName = `Contrat_bail_${this.leaseReferenceCode(lease.id)}_contract-${contract.id}-v${template.version}-${generatedStamp}.docx`;
      const docxBuffer = buildLeaseContractDocxBuffer(snapshot, renderedContent);
      const generatedFileHash = getDocxBufferSha256(docxBuffer);
      const storedDocx = await this.persistLeaseContractDocx(id, contract.id, template.version, generatedAt, docxFileName, docxBuffer);
      const { rows: updatedRows } = await client.query(
        `UPDATE lease_contract_generations
         SET docx_file_name = $3,
             docx_file_url = $4,
             docx_storage_path = $5,
             docx_file_hash = $6,
             docx_mime_type = $7,
             template_code = $8,
             template_hash = $9
         WHERE id = $1 AND lease_id = $2 AND organization_id = $10
         RETURNING *`,
        [
          contract.id,
          id,
          storedDocx.fileName,
          storedDocx.fileUrl,
          storedDocx.storagePath,
          generatedFileHash,
          storedDocx.mimeType,
          template.code,
          templateRuntime.sha256,
          this.context.organizationId(),
        ],
      );
      await client.query(
        `UPDATE leases
         SET generated_contract_file_name = $2,
             generated_contract_url = $3,
             contract_generated_at = NOW(),
             contract_template_code = $4,
             updated_at = NOW()
         WHERE id = $1 AND organization_id = $5`,
        [id, storedDocx.fileName, storedDocx.fileUrl, template.code, this.context.organizationId()],
      );
      await client.query(
        `INSERT INTO lease_documents (lease_id, document_type, file_name, file_url, uploaded_by, organization_id)
         VALUES ($1, 'GENERATED_CONTRACT', $2, $3, $4, $5)`,
        [id, storedDocx.fileName, storedDocx.fileUrl, this.context.userId() ?? 1, this.context.organizationId()],
      );
      console.info(
        '[lease-docx]',
        JSON.stringify({
          leaseId: id,
          contractId: contract.id,
          templateCode: template.code,
          templateVersion: template.version,
          templatePath: templateRuntime.path,
          templateSize: templateRuntime.size,
          templateHash: templateRuntime.sha256,
          generatedFileHash,
          storagePath: storedDocx.storagePath,
          fileName: storedDocx.fileName,
          mimeType: storedDocx.mimeType,
        }),
      );
      return updatedRows[0];
    });
  }

  async downloadLeaseContractDocx(leaseId: number, contractId: number) {
    const { rows } = await this.db.query(
      `SELECT cg.id, cg.lease_id, cg.template_version, cg.generated_at, cg.docx_file_name, cg.docx_file_url, cg.docx_storage_path,
              cg.docx_mime_type, cg.docx_file_hash, cg.pdf_file_name, cg.pdf_file_url,
              l.lease_number
       FROM lease_contract_generations cg
       JOIN leases l ON l.id = cg.lease_id AND l.organization_id = cg.organization_id
       WHERE cg.id = $1 AND cg.lease_id = $2 AND cg.organization_id = $3 AND cg.deleted_at IS NULL`,
      [contractId, leaseId, this.context.organizationId()],
    );
    const contract = requireRow(rows[0], 'Lease contract generation');
    const pdfFileName = String(contract.pdf_file_name ?? '').trim();
    const pdfFileUrl = String(contract.pdf_file_url ?? '').trim();
    const pdfDownloadName = `${this.leaseReferenceCodeFromNumber(contract.lease_number ?? leaseId)}.pdf`;
    if (pdfFileName && pdfFileUrl) {
      if (pdfFileUrl.startsWith('data:')) {
        return { ...this.dataUrlFile(pdfFileUrl, pdfFileName), downloadName: pdfDownloadName };
      }
      const generatedAt = new Date(contract.generated_at ?? new Date().toISOString());
      const templateVersion = Number(contract.template_version ?? 9);
      const storagePath = this.leaseContractStoragePath(leaseId, contractId, templateVersion, generatedAt, pdfFileName);
      try {
        return { ...(await this.downloadLeaseContractStorage(storagePath, pdfFileName, LEASE_PDF_MIME_TYPE)), downloadName: pdfDownloadName };
      } catch (error: any) {
        const fallbackStoragePath = await this.findLeaseContractStoragePathByPrefix(leaseId, contractId, templateVersion, pdfFileName);
        if (!fallbackStoragePath) {
          throw error;
        }
        return { ...(await this.downloadLeaseContractStorage(fallbackStoragePath, pdfFileName, LEASE_PDF_MIME_TYPE)), downloadName: pdfDownloadName };
      }
    }
    const fileName = String(contract.docx_file_name ?? '').trim();
    const fileUrl = String(contract.docx_file_url ?? '').trim();
    const storagePath = String(contract.docx_storage_path ?? '').trim();
    if (!fileName || !fileUrl) {
      throw new BadRequestException('Aucun contrat genere pour ce bail');
    }
    if (fileUrl.startsWith('data:')) {
      return this.dataUrlFile(fileUrl, fileName);
    }
    return this.downloadLeaseContractStorage(storagePath || this.legacyLeaseContractStoragePath(leaseId, contractId, fileName), fileName);
  }

  async markLeaseContractPrinted(leaseId: number, contractId: number) {
    const { rows } = await this.db.query(
      `UPDATE lease_contract_generations
       SET printed_at = NOW(),
           status = CASE WHEN status = 'SIGNED' THEN status ELSE 'PRINTED' END
       WHERE id = $1 AND lease_id = $2 AND organization_id = $3 AND deleted_at IS NULL
       RETURNING *`,
      [contractId, leaseId, this.context.organizationId()],
    );
    return requireRow(rows[0], 'Lease contract generation');
  }

  async markLeaseContractSigned(leaseId: number, contractId: number) {
    const { rows } = await this.db.query(
      `UPDATE lease_contract_generations
       SET signed_at = NOW(), status = 'SIGNED'
       WHERE id = $1 AND lease_id = $2 AND organization_id = $3 AND deleted_at IS NULL
       RETURNING *`,
      [contractId, leaseId, this.context.organizationId()],
    );
    const contract = requireRow(rows[0], 'Lease contract generation');
    await this.db.query(
      `UPDATE leases
       SET contract_signed_at = COALESCE(contract_signed_at, NOW()), updated_at = NOW()
       WHERE id = $1 AND organization_id = $2`,
      [leaseId, this.context.organizationId()],
    );
    return contract;
  }

  async uploadSignedLeaseContract(leaseId: number, contractId: number, body: Record<string, unknown>) {
    const fileName = String(body.file_name ?? body.signed_contract_file_name ?? '').trim();
    if (!fileName) throw new BadRequestException('Nom du contrat signe requis');
    const fileUrl = body.file_url ?? body.signed_contract_file_url ?? null;
    const { rows } = await this.db.query(
      `UPDATE lease_contract_generations
       SET signed_contract_file_name = $3,
           signed_contract_file_url = $4,
           signed_at = NOW(),
           uploaded_by = $5,
           status = 'SIGNED'
       WHERE id = $1 AND lease_id = $2 AND organization_id = $6 AND deleted_at IS NULL
       RETURNING *`,
      [contractId, leaseId, fileName, fileUrl, this.context.userId() ?? 1, this.context.organizationId()],
    );
    const contract = requireRow(rows[0], 'Lease contract generation');
    await this.db.query(
      `UPDATE leases
       SET signed_contract_file_name = $2,
           signed_contract_url = $3,
           contract_signed_at = NOW(),
           updated_at = NOW()
       WHERE id = $1 AND organization_id = $4`,
      [leaseId, fileName, fileUrl, this.context.organizationId()],
    );
    await this.db.query(
      `INSERT INTO lease_documents (lease_id, document_type, file_name, file_url, uploaded_by, organization_id)
       VALUES ($1, 'SIGNED_CONTRACT', $2, $3, $4, $5)`,
      [leaseId, fileName, fileUrl, this.context.userId() ?? 1, this.context.organizationId()],
    );
    return contract;
  }

  async messageTemplates() {
    return this.findAll('message_templates', 'channel, name');
  }

  async createMessageTemplate(body: Record<string, unknown>) {
    return this.insert(
      'message_templates',
      {
        ...body,
        channel: String(body.channel ?? 'EMAIL').toUpperCase(),
        variables: this.normalizeVariables(body.variables),
        status: body.status ?? 'ACTIVE',
        created_by: this.context.userId() ?? body.created_by ?? 1,
      },
      ['code', 'name', 'channel', 'subject', 'body', 'variables', 'status', 'created_by'],
    );
  }

  async updateMessageTemplate(id: number, body: Record<string, unknown>) {
    const payload = { ...body };
    if (payload.channel) payload.channel = String(payload.channel).toUpperCase();
    if (payload.variables !== undefined) payload.variables = this.normalizeVariables(payload.variables);
    return this.updateById('message_templates', id, { ...payload, updated_at: new Date() }, [
      'code',
      'name',
      'channel',
      'subject',
      'body',
      'variables',
      'status',
      'updated_at',
    ]);
  }

  async deactivateMessageTemplate(id: number) {
    return this.updateById('message_templates', id, { status: 'INACTIVE', updated_at: new Date() }, ['status', 'updated_at']);
  }

  async communicationLogs(channel: string) {
    return this.findAll(this.logTableFor(channel), 'created_at DESC');
  }

  async sendCommunication(channel: string, body: Record<string, unknown>) {
    const target = this.logTableFor(channel);
    const template = body.template_code ? await this.activeTemplate(String(body.template_code), channel) : null;
    const variables = this.objectValue(body.variables);
    const message = template ? this.renderTemplate(String(template.body), variables) : String(body.message ?? '');
    const subject = template?.subject ? this.renderTemplate(String(template.subject), variables) : body.subject ? String(body.subject) : null;
    const recipient = String(body.recipient ?? body.to ?? '').trim();
    if (!recipient) throw new BadRequestException('Destinataire requis');
    if (!message.trim()) throw new BadRequestException('Message requis');
    if (target === 'email_logs') {
      const result = await this.emailService.send({
        to: recipient,
        cc: body.cc ? String(body.cc).split(',').map((item) => item.trim()) : null,
        bcc: body.bcc ? String(body.bcc).split(',').map((item) => item.trim()) : null,
        subject: subject ?? 'Notification',
        text: message,
        html: body.html ? String(body.html) : null,
        organizationId: this.context.organizationId(),
        templateCode: body.template_code ? String(body.template_code) : null,
        relatedEntityType: body.related_entity_type ? String(body.related_entity_type) : null,
        relatedEntityId: body.related_entity_id ? Number(body.related_entity_id) : null,
        createdBy: Number(body.created_by ?? this.context.userId() ?? 1),
        idempotencyKey: body.idempotency_key ? String(body.idempotency_key) : null,
        forceSend: Boolean(body.force_send),
        metadata: variables,
      });
      const log = result.logId
        ? await this.db.query(`SELECT * FROM email_logs WHERE id = $1`, [result.logId])
        : { rows: [null] as Array<Record<string, unknown> | null> };
      return { ...result, log: log.rows[0] };
    }
    const columns =
      ['recipient', 'message', 'status', 'provider_response', 'related_entity_type', 'related_entity_id', 'sent_at', 'created_by', 'organization_id'];
    const commonValues = [
      recipient,
      message,
      'SIMULATED',
      JSON.stringify({ provider: 'LOCAL_SIMULATOR', channel: channel.toUpperCase(), template_code: body.template_code ?? null }),
      body.related_entity_type ?? null,
      body.related_entity_id ?? null,
      new Date(),
      this.context.userId() ?? body.created_by ?? 1,
      this.context.organizationId(),
    ];
    const placeholders = columns.map((_, index) => `$${index + 1}`);
    const { rows } = await this.db.query(`INSERT INTO ${target} (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`, commonValues);
    return { success: true, simulated: true, log: rows[0] };
  }

  async remindInvoice(id: number, body: Record<string, unknown>) {
    const organizationId = this.context.organizationId();
    const channel = String(body.channel ?? '').toUpperCase();
    const skipDelivery = body.skip_delivery === true;
    if (!['EMAIL', 'SMS', 'WHATSAPP'].includes(channel)) throw new BadRequestException('Canal de relance invalide');

    const { rows } = await this.db.query(
      `SELECT i.id, i.invoice_number, i.total, i.tenant_id, i.organization_id,
              CONCAT(t.first_name, ' ', t.last_name) AS tenant_name, t.email, t.phone
       FROM invoices i
       JOIN tenants t ON t.id = i.tenant_id
       WHERE i.id = $1 AND i.organization_id = $2 AND i.deleted_at IS NULL`,
      [id, organizationId],
    );
    const invoice = requireRow(rows[0], 'Invoice');
    const recipient = channel === 'EMAIL' ? invoice.email : invoice.phone;
    if (!skipDelivery && !recipient) throw new BadRequestException(channel === 'EMAIL' ? 'Adresse email locataire absente' : 'TÃ©lÃ©phone locataire absent');

    const message = body.message
      ? String(body.message)
      : this.defaultReminderMessage(channel, {
          tenant_name: invoice.tenant_name,
          invoice_number: invoice.invoice_number,
          amount: Number(invoice.total).toLocaleString('fr-FR', { maximumFractionDigits: 2 }),
          currency: 'USD',
        });

    const communication = skipDelivery
      ? null
      : channel === 'EMAIL'
        ? await this.emailService.sendInvoiceReminderEmail({
            organizationId,
            invoiceId: id,
            invoiceNumber: String(invoice.invoice_number),
            tenantName: String(invoice.tenant_name ?? 'Locataire'),
            tenantEmail: invoice.email ? String(invoice.email) : null,
            amount: Number(invoice.total ?? 0),
            currency: 'USD',
            dueDate: null,
            stage: String(body.stage ?? 'MANUAL'),
            message,
            createdBy: this.context.userId() ?? 1,
            idempotencyKey: body.idempotency_key
              ? String(body.idempotency_key)
              : this.emailService.buildIdempotencyKey([organizationId, 'INVOICE_REMINDER', id, channel, String(body.stage ?? 'MANUAL'), message]),
          })
        : await this.sendCommunication(channel, {
            recipient,
            subject: channel === 'EMAIL' ? `Relance facture ${invoice.invoice_number}` : undefined,
            message,
            related_entity_type: 'invoice',
            related_entity_id: id,
          });
    const communicationStatus = skipDelivery
      ? String(body.status ?? 'SENT').toUpperCase()
      : String((communication as { status?: string; log?: { status?: string } })?.status ?? (communication as { log?: { status?: string } })?.log?.status ?? 'SIMULATED').toUpperCase();
    const status = communicationStatus === 'FAILED'
      ? 'FAILED'
      : communicationStatus === 'SENT'
        ? 'SENT'
        : communicationStatus === 'SKIPPED'
          ? 'SKIPPED'
          : 'SIMULATED';
    const remindedAt = new Date();
    const reminder = await this.db.query(
      `INSERT INTO invoice_reminders (organization_id, invoice_id, tenant_id, channel, message, status, reminded_at, reminded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [organizationId, id, invoice.tenant_id, channel, message, status, remindedAt, this.context.userId() ?? 1],
    );
    await this.db.query(
      `UPDATE invoices
       SET last_reminder_at = $1,
           reminder_count = COALESCE(reminder_count, 0) + 1
       WHERE id = $2 AND organization_id = $3`,
      [remindedAt, id, organizationId],
    );
    return { success: true, status, reminder: reminder.rows[0], communication };
  }

  private defaultReminderMessage(channel: string, variables: Record<string, unknown>) {
    if (channel === 'EMAIL') {
      return `Bonjour ${variables.tenant_name},\nSauf erreur de notre part, votre facture ${variables.invoice_number} d'un montant de ${variables.amount} ${variables.currency} reste impayÃ©e.\nMerci de rÃ©gulariser votre situation.`;
    }
    return `Bonjour ${variables.tenant_name}, votre facture ${variables.invoice_number} de ${variables.amount} ${variables.currency} reste impayÃ©e. Merci de rÃ©gulariser.`;
  }

  async notifications() {
    const { rows } = await this.db.query(
      `SELECT n.*, CONCAT(u.first_name, ' ', u.last_name) AS user_name
       FROM notifications n
       LEFT JOIN app_users u ON u.id = n.user_id
       WHERE n.organization_id = $1
         AND n.deleted_at IS NULL
         AND (n.user_id IS NULL OR n.user_id = $2)
       ORDER BY CASE n.status WHEN 'UNREAD' THEN 0 WHEN 'READ' THEN 1 ELSE 2 END, n.created_at DESC`,
      [this.context.organizationId(), this.context.userId()],
    );
    return rows;
  }

  async createNotification(body: Record<string, unknown>) {
    return this.insert(
      'notifications',
      {
        ...body,
        priority: String(body.priority ?? 'NORMAL').toUpperCase(),
        status: body.status ?? 'UNREAD',
        created_by: this.context.userId() ?? body.created_by ?? 1,
      },
      ['user_id', 'title', 'message', 'priority', 'status', 'source', 'related_entity_type', 'related_entity_id', 'link_path', 'created_by'],
    );
  }

  async markNotificationRead(id: number) {
    return this.updateById('notifications', id, { status: 'READ', read_at: new Date() }, ['status', 'read_at']);
  }

  async archiveNotification(id: number) {
    return this.updateById('notifications', id, { status: 'ARCHIVED', archived_at: new Date() }, ['status', 'archived_at']);
  }

  async companySettings() {
    const { rows } = await this.db.query(
      `SELECT *,
              COALESCE(company_legal_name, legal_name, company_name) AS company_legal_name_resolved,
              COALESCE(company_address, address) AS company_address_resolved
       FROM company_settings
       WHERE organization_id = $1 AND deleted_at IS NULL`,
      [this.context.organizationId()],
    );
    const row = rows[0] ?? (await this.createDefaultCompanySettings());
    return this.companySettingsRow(row);
  }

  async uploadCompanyFile(kind: string, file?: { originalname: string; mimetype: string; size: number; buffer: Buffer }) {
    const resolvedKind = this.normalizeCompanyFileKind(kind);
    if (!file) {
      throw new BadRequestException('Fichier requis');
    }
    this.validateCompanyFile(file);
    const fileName = this.originalFileName(file.originalname);
    await this.uploadToCompanyStorage(resolvedKind, fileName, file);
    const { rows } = await this.db.query(
      `UPDATE company_settings
       SET ${resolvedKind}_file_name = $2,
           ${resolvedKind}_file_url = $3,
           updated_by = $4,
           updated_at = NOW()
       WHERE organization_id = $1 AND deleted_at IS NULL
       RETURNING *`,
      [this.context.organizationId(), fileName, this.companyFileRoute(resolvedKind), this.context.userId() ?? 1],
    );
    return this.companySettingsRow(rows[0]);
  }

  async deleteCompanyFile(kind: string) {
    const resolvedKind = this.normalizeCompanyFileKind(kind);
    const row = requireRow(await this.companySettingsRaw(), 'Company settings');
    const fileName = row[`${resolvedKind}_file_name`] ?? this.legacyFileName(row[`${resolvedKind}_file_url`]);
    if (fileName) {
      await this.deleteFromCompanyStorage(resolvedKind, String(fileName));
    }
    const { rows } = await this.db.query(
      `UPDATE company_settings
       SET ${resolvedKind}_file_name = NULL,
           ${resolvedKind}_file_url = NULL,
           updated_by = $2,
           updated_at = NOW()
       WHERE organization_id = $1 AND deleted_at IS NULL
       RETURNING *`,
      [this.context.organizationId(), this.context.userId() ?? 1],
    );
    return this.companySettingsRow(rows[0]);
  }

  async companyFile(kind: string) {
    const resolvedKind = this.normalizeCompanyFileKind(kind);
    const row = requireRow(await this.companySettingsRaw(), 'Company settings');
    const fileName = row[`${resolvedKind}_file_name`] ?? this.legacyFileName(row[`${resolvedKind}_file_url`]);
    if (!fileName) {
      throw new BadRequestException('Aucun fichier disponible');
    }
    return this.downloadCompanyStorage(resolvedKind, String(fileName));
  }

  async exchangeRate() {
    const { rows } = await this.db.query(
      `SELECT id, organization_id, base_currency, quote_currency, rate, effective_date, is_active, created_by, created_at, updated_at
       FROM exchange_rates
       WHERE organization_id = $1 AND deleted_at IS NULL AND is_active = TRUE
         AND base_currency = 'USD'
         AND quote_currency = 'CDF'
       ORDER BY effective_date DESC, id DESC
       LIMIT 1`,
      [this.context.organizationId()],
    );
    const row = rows[0];
    return row
      ? {
        id: row.id,
        organization_id: row.organization_id,
        fromCurrency: row.base_currency,
        toCurrency: row.quote_currency,
        rate: Number(row.rate),
        effectiveDate: this.toDateOnly(row.effective_date),
        isActive: row.is_active,
        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
      : null;
  }

  async updateExchangeRate(body: Record<string, unknown>) {
    const rate = Number(body.rate ?? 0);
    if (!Number.isFinite(rate) || !(rate > 0)) throw new BadRequestException('Le taux doit etre superieur a 0');
    const effectiveDate = String(body.effectiveDate ?? body.effective_date ?? new Date().toISOString().slice(0, 10));
    return this.db.transaction(async (client) => {
      await client.query(
        `UPDATE exchange_rates
         SET is_active = FALSE, updated_at = NOW()
         WHERE organization_id = $1 AND deleted_at IS NULL AND is_active = TRUE
           AND base_currency = 'USD'
           AND quote_currency = 'CDF'`,
        [this.context.organizationId()],
      );
      const { rows } = await client.query(
        `INSERT INTO exchange_rates (organization_id, base_currency, quote_currency, rate, effective_date, is_active, created_by)
         VALUES ($1, 'USD', 'CDF', $2, $3, TRUE, $4)
         RETURNING *`,
        [this.context.organizationId(), rate, effectiveDate, this.context.userId() ?? 1],
      );
      const row = rows[0];
      return {
        id: row.id,
        organization_id: row.organization_id,
        fromCurrency: row.base_currency,
        toCurrency: row.quote_currency,
        rate: Number(row.rate),
        effectiveDate: this.toDateOnly(row.effective_date),
        isActive: row.is_active,
        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }

  private toDateOnly(value: unknown) {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) {
      const year = value.getFullYear();
      const month = String(value.getMonth() + 1).padStart(2, '0');
      const day = String(value.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
    const text = String(value);
    return text.length >= 10 ? text.slice(0, 10) : text;
  }

  async updateCompanySettings(body: Record<string, unknown>) {
    await this.companySettings();
    const normalizedBody: Record<string, unknown> = { ...body };
    if (normalizedBody.company_legal_name === undefined && normalizedBody.legal_name !== undefined) {
      normalizedBody.company_legal_name = normalizedBody.legal_name;
    }
    if (normalizedBody.legal_name === undefined && normalizedBody.company_legal_name !== undefined) {
      normalizedBody.legal_name = normalizedBody.company_legal_name;
    }
    if (normalizedBody.company_address === undefined && normalizedBody.address !== undefined) {
      normalizedBody.company_address = normalizedBody.address;
    }
    if (normalizedBody.address === undefined && normalizedBody.company_address !== undefined) {
      normalizedBody.address = normalizedBody.company_address;
    }
    const allowed = [
      'logo_url',
      'invoice_logo_url',
      'signature_url',
      'stamp_url',
      'company_name',
      'legal_name',
      'company_legal_name',
      'company_acronym',
      'company_legal_form',
      'company_rccm',
      'company_national_id',
      'company_tax_id',
      'address',
      'company_address',
      'company_commune',
      'company_city',
      'company_country',
      'phone',
      'email',
      'website',
      'legal_representative_name',
      'legal_representative_title',
      'legal_representative_civility',
      'currency',
      'language',
      'timezone',
      'invoice_footer',
      'paper_format',
      'invoice_bottom_text',
      'logo_file_name',
      'logo_file_url',
      'signature_file_name',
      'signature_file_url',
      'stamp_file_name',
      'stamp_file_url',
      'default_lease_duration_months',
      'default_notice_months',
      'default_guarantee_months',
      'default_signature_place',
      'default_lease_usage',
      'default_contract_template_code',
    ];
    const keys = allowed.filter((key) => normalizedBody[key] !== undefined);
    if (!keys.length) throw new BadRequestException('No data provided');
    const assignments = keys.map((key, index) => `${key} = $${index + 2}`);
    const { rows } = await this.db.query(
      `UPDATE company_settings
       SET ${assignments.join(', ')}, updated_by = $${keys.length + 2}, updated_at = NOW()
       WHERE organization_id = $1 AND deleted_at IS NULL
       RETURNING *`,
      [this.context.organizationId(), ...keys.map((key) => normalizedBody[key]), this.context.userId() ?? 1],
    );
    return this.companySettingsRow(requireRow(rows[0], 'Company settings'));
  }

  async referenceData(type?: string) {
    const params: unknown[] = [this.context.organizationId()];
    let where = 'organization_id = $1 AND deleted_at IS NULL';
    if (type) {
      params.push(type);
      where += ' AND type = $2';
    }
    const { rows } = await this.db.query(
      `SELECT * FROM reference_data WHERE ${where} ORDER BY type, sort_order, label`,
      params,
    );
    return rows;
  }

  async createReferenceData(body: Record<string, unknown>) {
    return this.insert(
      'reference_data',
      {
        ...body,
        code: String(body.code ?? '').toUpperCase().trim(),
        status: body.status ?? 'ACTIVE',
        sort_order: Number(body.sort_order ?? 0),
        created_by: this.context.userId() ?? body.created_by ?? 1,
      },
      ['type', 'code', 'label', 'description', 'sort_order', 'status', 'created_by'],
    );
  }

  async updateReferenceData(id: number, body: Record<string, unknown>) {
    const payload = { ...body };
    if (payload.code) payload.code = String(payload.code).toUpperCase().trim();
    if (payload.sort_order !== undefined) payload.sort_order = Number(payload.sort_order);
    return this.updateById('reference_data', id, { ...payload, updated_by: this.context.userId() ?? 1, updated_at: new Date() }, [
      'type',
      'code',
      'label',
      'description',
      'sort_order',
      'status',
      'updated_by',
      'updated_at',
    ]);
  }

  async deactivateReferenceData(id: number) {
    return this.updateById('reference_data', id, { status: 'INACTIVE', updated_by: this.context.userId() ?? 1, updated_at: new Date() }, [
      'status',
      'updated_by',
      'updated_at',
    ]);
  }

  publisherServices() {
    return [
      'Personnalisation facture',
      'Creation rapport personnalise',
      'Migration donnees',
      'Formation utilisateurs',
      'Integration SMS/WhatsApp reelle',
      'Sauvegarde externalisee',
      'Support premium',
      'Developpement specifique',
    ].map((title) => ({ title, action: 'Contacter l editeur' }));
  }

  async restrictedSettings() {
    await this.auditRead('PUBLISHER_SETTINGS_VIEWED', 'settings', 'restricted');
    return [
      'Numerotation avancee',
      'Workflows avances',
      'Permissions avancees',
      'Modeles PDF',
      'Rapports personnalises',
      'Automatisations avancees',
      'Configuration cloud',
      'Securite',
      'Sauvegardes',
      'Integrations providers email/SMS/WhatsApp reels',
    ].map((label) => ({ label, status: 'Reserve editeur' }));
  }

  async emailNotificationSettings() {
    return this.emailService.emailSettingsSummary(this.context.organizationId());
  }

  async sendTestEmail(recipient: string) {
    return this.emailService.sendTestEmail(recipient, this.context.organizationId(), this.context.userId() ?? 1);
  }

  async guaranteeCashOverview(filters: Record<string, unknown> = {}) {
    await this.ensureGuaranteeCashSchema();
    const { where, values } = this.guaranteeCashWhere(filters);
    const { rows } = await this.db.query(
      `SELECT
         COALESCE(SUM(CASE WHEN type = 'IN' THEN COALESCE(equivalent_usd, amount) ELSE 0 END), 0)::FLOAT AS total_in,
         COALESCE(SUM(CASE WHEN type = 'OUT' THEN COALESCE(equivalent_usd, amount) ELSE 0 END), 0)::FLOAT AS total_out,
         COALESCE(SUM(CASE WHEN type = 'IN' THEN COALESCE(equivalent_usd, amount) ELSE -COALESCE(equivalent_usd, amount) END), 0)::FLOAT AS balance_usd,
         COUNT(*)::INT AS movement_count,
         MAX(movement_date) AS last_movement_date
       FROM guarantee_cash_movements gcm
       ${where}`,
      values,
    );
    const last = await this.db.query(
      `SELECT gcm.*, l.lease_number,
              CASE WHEN t.tenant_type = 'COMPANY' THEN COALESCE(t.company_name, '')
                   ELSE TRIM(CONCAT(COALESCE(t.first_name, ''), ' ', COALESCE(t.last_name, ''), ' ', COALESCE(t.post_name, '')))
              END AS tenant_name,
              COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''), u.email) AS user_name
       FROM guarantee_cash_movements gcm
       LEFT JOIN leases l ON l.id = gcm.lease_id
       LEFT JOIN tenants t ON t.id = gcm.tenant_id
       LEFT JOIN app_users u ON u.id = gcm.created_by
       ${where}
       ORDER BY gcm.movement_date DESC, gcm.id DESC
       LIMIT 1`,
      values,
    );
    return { ...(rows[0] ?? {}), last_movement: last.rows[0] ?? null };
  }

  async guaranteeCashMovements(filters: Record<string, unknown> = {}) {
    await this.ensureGuaranteeCashSchema();
    const hasShareholderSchema = await this.hasShareholderPayoutSchema();
    const { where, values } = this.guaranteeCashWhere(filters);
    const shareholderSelect = hasShareholderSchema
      ? `,
              spl.batch_id AS shareholder_batch_id,
              spl.shareholder_id,
              sh.display_name AS shareholder_name`
      : `,
              NULL::INT AS shareholder_batch_id,
              NULL::INT AS shareholder_id,
              NULL::VARCHAR AS shareholder_name`;
    const shareholderJoin = hasShareholderSchema
      ? `
       LEFT JOIN shareholder_payout_lines spl ON spl.guarantee_cash_movement_id = gcm.id AND spl.organization_id = gcm.organization_id
       LEFT JOIN shareholders sh ON sh.id = spl.shareholder_id AND sh.organization_id = spl.organization_id`
      : '';
    const { rows } = await this.db.query(
      `SELECT gcm.*, l.lease_number,
              CASE WHEN t.tenant_type = 'COMPANY' THEN COALESCE(t.company_name, '')
                   ELSE TRIM(CONCAT(COALESCE(t.first_name, ''), ' ', COALESCE(t.last_name, ''), ' ', COALESCE(t.post_name, '')))
              END AS tenant_name,
              COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''), u.email) AS user_name
              ${shareholderSelect}
       FROM guarantee_cash_movements gcm
       LEFT JOIN leases l ON l.id = gcm.lease_id
       LEFT JOIN tenants t ON t.id = gcm.tenant_id
       LEFT JOIN app_users u ON u.id = gcm.created_by
       ${shareholderJoin}
       ${where}
       ORDER BY gcm.movement_date DESC, gcm.id DESC`,
      values,
    );
    return rows;
  }

  async trashedGuaranteeCashMovements() {
    await this.ensureGuaranteeCashSchema();
    const hasShareholderSchema = await this.hasShareholderPayoutSchema();
    const shareholderSelect = hasShareholderSchema
      ? `,
              spl.batch_id AS shareholder_batch_id,
              sh.display_name AS shareholder_name`
      : `,
              NULL::INT AS shareholder_batch_id,
              NULL::VARCHAR AS shareholder_name`;
    const shareholderJoin = hasShareholderSchema
      ? `
       LEFT JOIN shareholder_payout_lines spl ON spl.guarantee_cash_movement_id = gcm.id AND spl.organization_id = gcm.organization_id
       LEFT JOIN shareholders sh ON sh.id = spl.shareholder_id AND sh.organization_id = spl.organization_id`
      : '';
    const { rows } = await this.db.query(
      `SELECT gcm.id,
              gcm.movement_type,
              gcm.type,
              gcm.amount,
              gcm.currency,
              gcm.equivalent_usd,
              gcm.movement_date,
              gcm.reference,
              gcm.reason,
              gcm.notes,
              gcm.payment_id,
              gcm.lease_guarantee_id,
              gcm.lease_id,
              gcm.deleted_at,
              gcm.deletion_reason,
              gcm.organization_id,
              l.lease_number,
              COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''), u.email) AS deleted_by_name,
              CASE WHEN t.tenant_type = 'COMPANY' THEN COALESCE(t.company_name, '')
                   ELSE TRIM(CONCAT(COALESCE(t.first_name, ''), ' ', COALESCE(t.last_name, ''), ' ', COALESCE(t.post_name, '')))
              END AS tenant_name
              ${shareholderSelect}
       FROM guarantee_cash_movements gcm
       LEFT JOIN leases l ON l.id = gcm.lease_id
       LEFT JOIN tenants t ON t.id = gcm.tenant_id
       LEFT JOIN app_users u ON u.id = gcm.deleted_by
       ${shareholderJoin}
       WHERE gcm.organization_id = $1
         AND gcm.deleted_at IS NOT NULL
       ORDER BY gcm.deleted_at DESC, gcm.id DESC`,
      [this.context.organizationId()],
    );
    return rows;
  }

  async createGuaranteeCashExpense(body: Record<string, unknown>) {
    await this.ensureGuaranteeCashSchema();
    const amount = Number(body.amount ?? 0);
    const currency = String(body.currency ?? 'USD').toUpperCase();
    const reason = String(body.reason ?? '').trim();
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Montant de sortie invalide.');
    }
    if (!['USD', 'CDF'].includes(currency)) {
      throw new BadRequestException('Devise invalide.');
    }
    if (!reason) {
      throw new BadRequestException('Le motif est obligatoire.');
    }
    const exchangeRate = currency === 'CDF' ? await this.exchangeRate() : null;
    const exchangeRateUsed = Number(body.exchange_rate_used ?? exchangeRate?.rate ?? 0) || null;
    const exchangeRateDate = body.exchange_rate_date ?? exchangeRate?.effectiveDate ?? null;
    if (currency === 'CDF' && (!exchangeRateUsed || exchangeRateUsed <= 0)) {
      throw new BadRequestException('Taux de change requis pour une sortie en CDF.');
    }
    return this.db.transaction(async (client) => {
      const movement = await this.createGuaranteeCashMovementInTransaction(client, {
        movement_type: 'GARANTY_EXPENSE',
        type: 'OUT',
        amount,
        currency,
        equivalent_usd: currency === 'CDF' && exchangeRateUsed ? Number((amount / exchangeRateUsed).toFixed(2)) : amount,
        movement_date: body.movement_date ?? new Date().toISOString().slice(0, 10),
        reference: body.reference ?? null,
        reason,
        notes: body.notes ?? null,
        exchange_rate_used: exchangeRateUsed,
        exchange_rate_date: exchangeRateDate,
      });
      await this.auditGuaranteeCash(client, 'GARANTY_EXPENSE', movement.id, { amount, currency, reason });
      return movement;
    });
  }

  async deleteGuaranteeCashMovement(id: number, body?: Record<string, unknown>) {
    await this.ensureGuaranteeCashSchema();
    if (!this.hasPermission('guarantee_cash.delete')) {
      throw new ForbiddenException('Permission requise pour supprimer un mouvement de caisse garanties.');
    }
    const deletionReason = String(body?.reason ?? '').trim();
    if (!deletionReason) {
      throw new BadRequestException('Le motif de suppression est obligatoire.');
    }
    return this.db.transaction(async (client) => {
      const supportsShareholderPayoutLineId = await this.columnExists('guarantee_cash_movements', 'shareholder_payout_line_id');
      const movementResult = await client.query(
        `SELECT id, movement_type, type, payment_id, lease_guarantee_id, lease_id, amount, currency, equivalent_usd, reference
                ${supportsShareholderPayoutLineId ? ', shareholder_payout_line_id' : ', NULL::INT AS shareholder_payout_line_id'}
         FROM guarantee_cash_movements
         WHERE id = $1
           AND organization_id = $2
           AND deleted_at IS NULL
         FOR UPDATE`,
        [id, this.context.organizationId()],
      );
      const movement = requireRow(movementResult.rows[0], 'Guarantee cash movement') as Record<string, unknown>;
      const movementType = String(movement.movement_type ?? '').toUpperCase();

      if (movementType === 'SHAREHOLDER_PAYOUT') {
        const directPayoutLineId = Number(movement.shareholder_payout_line_id ?? 0) || null;
        if (directPayoutLineId) {
          const directLineResult = await client.query(
            `SELECT id
             FROM shareholder_payout_lines
             WHERE id = $1
               AND organization_id = $2
               AND deleted_at IS NULL
             LIMIT 1
             FOR UPDATE`,
            [directPayoutLineId, this.context.organizationId()],
          );
          if (directLineResult.rows[0]) {
            return this.trashShareholderPayoutInTransaction(client, Number(directLineResult.rows[0].id), deletionReason, {
              auditAction: 'SHAREHOLDER_PAYOUT_MOVED_TO_TRASH_FROM_GUARANTEE_CASH',
              auditResource: 'guarantee_cash',
              auditResourceId: String(id),
              sourceMovementId: id,
            });
          }
        }

        const payoutLineResult = await client.query(
          `SELECT id
           FROM shareholder_payout_lines
           WHERE organization_id = $1
             AND guarantee_cash_movement_id = $2
             AND deleted_at IS NULL
           LIMIT 1
           FOR UPDATE`,
          [this.context.organizationId(), id],
        );
        if (payoutLineResult.rows[0]) {
          return this.trashShareholderPayoutInTransaction(client, Number(payoutLineResult.rows[0].id), deletionReason, {
            auditAction: 'SHAREHOLDER_PAYOUT_MOVED_TO_TRASH_FROM_GUARANTEE_CASH',
            auditResource: 'guarantee_cash',
            auditResourceId: String(id),
            sourceMovementId: id,
          });
        }
      }

      if (movementType === 'GARANTY_TRANSFER') {
        throw new ConflictException('Ce mouvement de garantie doit Ãªtre gÃ©rÃ© depuis son module d origine.');
      }

      if (movement.payment_id) {
        return this.trashPaymentInTransaction(client, Number(movement.payment_id), deletionReason, {
          auditAction: 'GUARANTEE_PAYMENT_MOVED_TO_TRASH',
          auditResource: 'guarantee_cash',
          auditResourceId: String(id),
          sourceMovementId: id,
        });
      }

      if (!['GARANTY_REFUND', 'GARANTY_EXPENSE'].includes(movementType)) {
        throw new ConflictException('Ce mouvement de garantie ne peut pas Ãªtre supprimÃ© depuis cet Ã©cran.');
      }

      if (movementType === 'GARANTY_REFUND') {
        await this.softDeleteFinanceRows(client, 'guarantee_cash_movements', 'id', id, deletionReason);
        const leaseGuaranteeId = Number(movement.lease_guarantee_id ?? 0);
        if (leaseGuaranteeId > 0) {
          await this.recalculateLeaseGuaranteeFromActiveRows(client, leaseGuaranteeId);
        }
        await this.writeFinanceTrashAudit(client, 'GUARANTEE_REFUND_MOVED_TO_TRASH', 'guarantee_cash', String(id), {
          reason: deletionReason,
          movement_type: movementType,
          lease_guarantee_id: leaseGuaranteeId || null,
          lease_id: Number(movement.lease_id ?? 0) || null,
          reference: String(movement.reference ?? '').trim() || null,
        });
        return { deleted: true };
      }

      await this.softDeleteFinanceRows(client, 'guarantee_cash_movements', 'id', id, deletionReason);
      const leaseGuaranteeId = Number(movement.lease_guarantee_id ?? 0);
      if (leaseGuaranteeId > 0) {
        await this.recalculateLeaseGuaranteeFromActiveRows(client, leaseGuaranteeId);
      }
      await this.writeFinanceTrashAudit(client, 'GUARANTEE_MOVEMENT_MOVED_TO_TRASH', 'guarantee_cash', String(id), {
        reason: deletionReason,
        movement_type: movementType,
        lease_guarantee_id: leaseGuaranteeId || null,
        lease_id: Number(movement.lease_id ?? 0) || null,
      });
      return { deleted: true };
    });
  }

  async guaranteeCashReport(filters: Record<string, unknown> = {}) {
    const [overview, movements] = await Promise.all([
      this.guaranteeCashOverview(filters),
      this.guaranteeCashMovements(filters),
    ]);
    return { overview, movements };
  }

  async syndicCashOverview(filters: Record<string, unknown> = {}) {
    await this.ensureSyndicCashSchema();
    const { where, values } = this.syndicCashWhere(filters);
    const { rows } = await this.db.query(
      `SELECT
         COALESCE(SUM(CASE WHEN scm.type = 'IN' THEN scm.equivalent_usd ELSE -scm.equivalent_usd END), 0)::FLOAT AS balance_usd,
         COALESCE(SUM(CASE WHEN scm.type = 'IN' THEN scm.equivalent_usd ELSE 0 END), 0)::FLOAT AS total_in,
         COALESCE(SUM(CASE WHEN scm.type = 'OUT' THEN scm.equivalent_usd ELSE 0 END), 0)::FLOAT AS total_out,
         COALESCE(SUM(CASE WHEN scm.treasury_location = 'MAIN_CASH' THEN scm.equivalent_usd ELSE 0 END), 0)::FLOAT AS main_cash_total,
         COALESCE(SUM(CASE WHEN scm.treasury_location = 'BANK' THEN scm.equivalent_usd ELSE 0 END), 0)::FLOAT AS bank_total,
         COUNT(*)::INT AS movement_count,
         MAX(scm.movement_date) AS last_movement_date
       FROM syndic_cash_movements scm
       ${where}`,
      values,
    );
    return rows[0] ?? {};
  }

  async syndicCashMovements(filters: Record<string, unknown> = {}) {
    await this.ensureSyndicCashSchema();
    const { where, values } = this.syndicCashWhere(filters);
    const { rows } = await this.db.query(
      `SELECT scm.*,
              i.invoice_number,
              CASE WHEN t.tenant_type = 'COMPANY' THEN COALESCE(t.company_name, '')
                   ELSE TRIM(CONCAT(COALESCE(t.first_name, ''), ' ', COALESCE(t.last_name, ''), ' ', COALESCE(t.post_name, '')))
              END AS tenant_name,
              COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''), u.email) AS user_name
       FROM syndic_cash_movements scm
       LEFT JOIN invoices i ON i.id = scm.invoice_id AND i.organization_id = scm.organization_id
       LEFT JOIN tenants t ON t.id = scm.tenant_id AND t.organization_id = scm.organization_id
       LEFT JOIN app_users u ON u.id = scm.created_by
       ${where}
       ORDER BY scm.movement_date DESC, scm.id DESC`,
      values,
    );
    return rows;
  }

  async syndicCashReport(filters: Record<string, unknown> = {}) {
    const [overview, movements] = await Promise.all([
      this.syndicCashOverview(filters),
      this.syndicCashMovements(filters),
    ]);
    return { overview, movements };
  }

  async bankDashboard(filters: Record<string, unknown> = {}) {
    await this.ensureBankSchema();
    const period = this.normalizeBankPeriod(filters);
    const accountValues: unknown[] = [this.context.organizationId()];
    const accountClauses = ['ba.organization_id = $1', 'ba.deleted_at IS NULL'];
    if (filters.bank_name) {
      accountValues.push(`%${String(filters.bank_name).trim().toLowerCase()}%`);
      accountClauses.push(`LOWER(ba.bank_name) LIKE $${accountValues.length}`);
    }
    if (filters.currency) {
      accountValues.push(String(filters.currency).trim().toUpperCase());
      accountClauses.push(`ba.currency = $${accountValues.length}`);
    }
    if (filters.status) {
      accountValues.push(String(filters.status).trim().toUpperCase());
      accountClauses.push(`ba.status = $${accountValues.length}`);
    }

    const transactionsValues: unknown[] = [this.context.organizationId(), period.start, period.end];
    const transactionsClauses = [
      'bt.organization_id = $1',
      'bt.status = \'VALIDATED\'',
      'bt.transaction_date >= $2',
      'bt.transaction_date <= $3',
    ];
    if (filters.bank_account_id) {
      transactionsValues.push(Number(filters.bank_account_id));
      transactionsClauses.push(`bt.bank_account_id = $${transactionsValues.length}`);
    }
    if (filters.currency) {
      transactionsValues.push(String(filters.currency).trim().toUpperCase());
      transactionsClauses.push(`bt.currency = $${transactionsValues.length}`);
    }

    const [balancesResult, flowsResult, activeCountResult] = await Promise.all([
      this.db.query(
        `SELECT ba.currency,
                COALESCE(SUM(COALESCE(tx.balance, 0)), 0)::NUMERIC(14,2) AS total_balance
         FROM bank_accounts ba
         LEFT JOIN (
           SELECT bank_account_id,
                  SUM(CASE WHEN direction = 'IN' THEN amount ELSE -amount END)::NUMERIC(14,2) AS balance
           FROM bank_transactions
           WHERE organization_id = $1
             AND status = 'VALIDATED'
           GROUP BY bank_account_id
         ) tx ON tx.bank_account_id = ba.id
         WHERE ${accountClauses.join(' AND ')}
         GROUP BY ba.currency`,
        accountValues,
      ),
      this.db.query(
        `SELECT bt.currency,
                COALESCE(SUM(CASE WHEN bt.direction = 'IN' THEN bt.amount ELSE 0 END), 0)::NUMERIC(14,2) AS total_in,
                COALESCE(SUM(CASE WHEN bt.direction = 'OUT' THEN bt.amount ELSE 0 END), 0)::NUMERIC(14,2) AS total_out
         FROM bank_transactions bt
         JOIN bank_accounts ba ON ba.id = bt.bank_account_id AND ba.organization_id = bt.organization_id
         WHERE ${transactionsClauses.join(' AND ')}
         GROUP BY bt.currency`,
        transactionsValues,
      ),
      this.db.query(
        `SELECT COUNT(*)::INT AS active_count
         FROM bank_accounts ba
         WHERE ${accountClauses.join(' AND ')}
           AND ba.status = 'ACTIVE'`,
        accountValues,
      ),
    ]);

    const byCurrency = Object.fromEntries(
      balancesResult.rows.map((row) => [String(row.currency), Number(row.total_balance ?? 0)]),
    ) as Record<string, number>;
    const flowsByCurrency = Object.fromEntries(
      flowsResult.rows.map((row) => [
        String(row.currency),
        {
          total_in: Number(row.total_in ?? 0),
          total_out: Number(row.total_out ?? 0),
        },
      ]),
    ) as Record<string, { total_in: number; total_out: number }>;

    return {
      period,
      totals: {
        usd: Number(byCurrency.USD ?? 0),
        cdf: Number(byCurrency.CDF ?? 0),
        period_in_usd: Number(flowsByCurrency.USD?.total_in ?? 0),
        period_in_cdf: Number(flowsByCurrency.CDF?.total_in ?? 0),
        period_out_usd: Number(flowsByCurrency.USD?.total_out ?? 0),
        period_out_cdf: Number(flowsByCurrency.CDF?.total_out ?? 0),
        active_accounts: Number(activeCountResult.rows[0]?.active_count ?? 0),
      },
    };
  }

  async bankAccounts(filters: Record<string, unknown> = {}) {
    await this.ensureBankSchema();
    const values: unknown[] = [this.context.organizationId()];
    const clauses = ['ba.organization_id = $1', 'ba.deleted_at IS NULL'];
    if (filters.search) {
      values.push(`%${String(filters.search).trim().toLowerCase()}%`);
      clauses.push(`(
        LOWER(COALESCE(ba.bank_name, '')) LIKE $${values.length}
        OR LOWER(COALESCE(ba.account_name, '')) LIKE $${values.length}
        OR LOWER(COALESCE(ba.account_number, '')) LIKE $${values.length}
      )`);
    }
    if (filters.bank_name) {
      values.push(`%${String(filters.bank_name).trim().toLowerCase()}%`);
      clauses.push(`LOWER(ba.bank_name) LIKE $${values.length}`);
    }
    if (filters.currency) {
      values.push(String(filters.currency).trim().toUpperCase());
      clauses.push(`ba.currency = $${values.length}`);
    }
    if (filters.status) {
      values.push(String(filters.status).trim().toUpperCase());
      clauses.push(`ba.status = $${values.length}`);
    }

    const { rows } = await this.db.query(
      `SELECT ba.*,
              COALESCE(tx.total_in, 0)::NUMERIC(14,2) AS total_in,
              COALESCE(tx.total_out, 0)::NUMERIC(14,2) AS total_out,
              COALESCE(tx.current_balance, 0)::NUMERIC(14,2) AS current_balance,
              COALESCE(tx.transaction_count, 0)::INT AS transaction_count,
              COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''), u.email) AS created_by_name
       FROM bank_accounts ba
       LEFT JOIN (
         SELECT bt.bank_account_id,
                SUM(CASE WHEN bt.status = 'VALIDATED' AND bt.direction = 'IN' THEN bt.amount ELSE 0 END) AS total_in,
                SUM(CASE WHEN bt.status = 'VALIDATED' AND bt.direction = 'OUT' THEN bt.amount ELSE 0 END) AS total_out,
                SUM(CASE WHEN bt.status = 'VALIDATED' AND bt.direction = 'IN' THEN bt.amount ELSE -bt.amount END) AS current_balance,
                COUNT(*) FILTER (WHERE bt.status = 'VALIDATED') AS transaction_count
         FROM bank_transactions bt
         WHERE bt.organization_id = $1
         GROUP BY bt.bank_account_id
       ) tx ON tx.bank_account_id = ba.id
       LEFT JOIN app_users u ON u.id = ba.created_by
       WHERE ${clauses.join(' AND ')}
       ORDER BY ba.bank_name ASC, ba.account_name ASC, ba.id DESC`,
      values,
    );
    return rows;
  }

  async bankAccount(id: number) {
    await this.ensureBankSchema();
    const { rows } = await this.db.query(
      `SELECT ba.*,
              COALESCE(tx.total_in, 0)::NUMERIC(14,2) AS total_in,
              COALESCE(tx.total_out, 0)::NUMERIC(14,2) AS total_out,
              COALESCE(tx.current_balance, 0)::NUMERIC(14,2) AS current_balance,
              COALESCE(tx.transaction_count, 0)::INT AS transaction_count,
              COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''), u.email) AS created_by_name
       FROM bank_accounts ba
       LEFT JOIN (
         SELECT bt.bank_account_id,
                SUM(CASE WHEN bt.status = 'VALIDATED' AND bt.direction = 'IN' THEN bt.amount ELSE 0 END) AS total_in,
                SUM(CASE WHEN bt.status = 'VALIDATED' AND bt.direction = 'OUT' THEN bt.amount ELSE 0 END) AS total_out,
                SUM(CASE WHEN bt.status = 'VALIDATED' AND bt.direction = 'IN' THEN bt.amount ELSE -bt.amount END) AS current_balance,
                COUNT(*) FILTER (WHERE bt.status = 'VALIDATED') AS transaction_count
         FROM bank_transactions bt
         WHERE bt.organization_id = $1
         GROUP BY bt.bank_account_id
       ) tx ON tx.bank_account_id = ba.id
       LEFT JOIN app_users u ON u.id = ba.created_by
       WHERE ba.organization_id = $1
         AND ba.id = $2
         AND ba.deleted_at IS NULL`,
      [this.context.organizationId(), id],
    );
    return requireRow(rows[0], 'Bank account');
  }

  async createBankAccount(body: Record<string, unknown>) {
    await this.ensureBankSchema();
    const payload = this.normalizeBankAccountCreatePayload(body);
    const createdId = await this.db.transaction(async (client) => {
      try {
        const inserted = await client.query(
          `INSERT INTO bank_accounts
            (organization_id, bank_name, account_name, account_number, account_type, currency, opening_balance, status, notes, created_by)
           VALUES
            ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING *`,
          [
            this.context.organizationId(),
            payload.bank_name,
            payload.account_name,
            payload.account_number,
            payload.account_type,
            payload.currency,
            payload.opening_balance,
            payload.status,
            payload.notes,
            this.context.userId() ?? null,
          ],
        );
        const account = requireRow(inserted.rows[0], 'Bank account');
        let openingTransactionId: number | null = null;
        if (payload.opening_balance > 0) {
          const transactionNumber = await this.nextBankTransactionNumber(client);
          const openingTransaction = await client.query(
            `INSERT INTO bank_transactions
              (organization_id, bank_account_id, transaction_number, transaction_date, direction, transaction_type, amount, currency,
               reference, description, counterparty_name, source_module, source_entity_type, source_entity_id, status, reversal_of_id,
               idempotency_key, created_by)
             VALUES
              ($1, $2, $3, $4, 'IN', 'OPENING_BALANCE', $5, $6,
               $7, $8, NULL, 'BANK', 'BANK_ACCOUNT', $2, 'VALIDATED', NULL,
               $9, $10)
             RETURNING id`,
            [
              this.context.organizationId(),
              account.id,
              transactionNumber,
              payload.opening_date,
              payload.opening_balance,
              payload.currency,
              `OPEN-${account.id}`,
              'Solde initial du compte bancaire.',
              `bank-opening-balance:${this.context.organizationId()}:${account.id}`,
              this.context.userId() ?? null,
            ],
          );
          openingTransactionId = Number(openingTransaction.rows[0]?.id ?? 0) || null;
        }

        await client.query(
          `INSERT INTO audit_logs (organization_id, user_id, action, resource, resource_id, method, path, status_code, metadata)
           VALUES ($1, $2, 'BANK_ACCOUNT_CREATED', 'bank_accounts', $3, 'POST', '/api/bank-accounts', 201, $4::JSONB)`,
          [
            this.context.organizationId(),
            this.context.userId() ?? null,
            String(account.id),
            JSON.stringify({
              bank_account_id: account.id,
              bank_name: account.bank_name,
              account_name: account.account_name,
              account_number: account.account_number,
              currency: account.currency,
              status: account.status,
              opening_balance: Number(account.opening_balance ?? 0),
              opening_transaction_id: openingTransactionId,
            }),
          ],
        );
        return Number(account.id);
      } catch (error: any) {
        if (error?.code === '23505') {
          throw new ConflictException('Un compte bancaire identique existe dÃ©jÃ  pour cette organisation et cette devise.');
        }
        throw error;
      }
    });
    return this.bankAccount(createdId);
  }

  async updateBankAccount(id: number, body: Record<string, unknown>) {
    await this.ensureBankSchema();
    const current = await this.bankAccount(id);
    if (body.currency !== undefined || body.opening_balance !== undefined || body.organization_id !== undefined || body.created_by !== undefined || body.created_at !== undefined) {
      throw new BadRequestException('Les champs devise, solde initial et mÃ©tadonnÃ©es de crÃ©ation ne sont pas modifiables.');
    }
    const payload = this.normalizeBankAccountUpdatePayload(body);
    const keys = Object.keys(payload);
    if (!keys.length) {
      throw new BadRequestException('Aucune donnÃ©e de mise Ã  jour fournie.');
    }
    const statusValue = String(payload.status ?? current.status).toUpperCase();
    const assignments = keys.map((key, index) => `${key} = $${index + 2}`);
    const statusParamIndex = keys.length + 2;
    const idParamIndex = keys.length + 3;
    assignments.push(`archived_at = CASE WHEN $${statusParamIndex}::VARCHAR(20) = 'ARCHIVED' THEN COALESCE(archived_at, NOW()) ELSE NULL END`);
    assignments.push('updated_at = NOW()');
    try {
      const { rows } = await this.db.query(
        `UPDATE bank_accounts
         SET ${assignments.join(', ')}
         WHERE organization_id = $1
           AND id = $${idParamIndex}
           AND deleted_at IS NULL
         RETURNING *`,
        [
          this.context.organizationId(),
          ...keys.map((key) => (payload as Record<string, unknown>)[key]),
          statusValue,
          id,
        ],
      );
      const updated = requireRow(rows[0], 'Bank account');
      const action = String(updated.status) === 'ARCHIVED' && String(current.status) !== 'ARCHIVED'
        ? 'BANK_ACCOUNT_ARCHIVED'
        : 'BANK_ACCOUNT_UPDATED';
      await this.db.query(
       Û^·é¼­zÊ&ŠÛ^u10(€€€€€€1P)=%8Ñ•¹…¹ÑÌÑ•¸=8Ñ•¸¹¥€ô=1M¡‰¤¹Ñ•¹…¹Ñ}¥°‰°¹Ñ•¹…¹Ñ}¥¤9Ñ•¸¹½É…¹¥é…Ñ¥½¹}¥€ô‰Ð¹½É…¹¥é…Ñ¥½¹}¥9Ñ•¸¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€1P)=%8±•…Í•ÌÉ‰°=8É‰°¹¥€ô‰Ð¹Í½ÕÉ•}•¹Ñ¥Ñå}¥(€€€€€€€€9‰Ð¹Í½ÕÉ•}µ½‘Õ±”€ô€UI9QLœ(€€€€€€€€9‰Ð¹Í½ÕÉ•}•¹Ñ¥Ñå}ÑåÁ”€ô€UI9Q}IU9œ(€€€€€€€€9É‰°¹½É…¹¥é…Ñ¥½¹}¥€ô‰Ð¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€€€9É‰°¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€1P)=%8Õ¹¥ÑÌÉ‰Ô=8É‰Ô¹¥€ôÉ‰°¹Õ¹¥Ñ}¥9É‰Ô¹½É…¹¥é…Ñ¥½¹}¥€ô‰Ð¹½É…¹¥é…Ñ¥½¹}¥9É‰Ô¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€1P)=%8Ñ•¹…¹ÑÌÉÑ•¸=8ÉÑ•¸¹¥€ôÉ‰°¹Ñ•¹…¹Ñ}¥9ÉÑ•¸¹½É…¹¥é…Ñ¥½¹}¥€ô‰Ð¹½É…¹¥é…Ñ¥½¹}¥9ÉÑ•¸¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€1P)=%8±•…Í•ÌÑ°=8Ñ°¹¥€ôÑÉ•¹±•…Í•}¥9Ñ°¹½É…¹¥é…Ñ¥½¹}¥€ô‰Ð¹½É…¹¥é…Ñ¥½¹}¥9Ñ°¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€1P)=%8Õ¹¥ÑÌÑÔ=8ÑÔ¹¥€ôÑ°¹Õ¹¥Ñ}¥9ÑÔ¹½É…¹¥é…Ñ¥½¹}¥€ô‰Ð¹½É…¹¥é…Ñ¥½¹}¥9ÑÔ¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€1P)=%8Ñ•¹…¹ÑÌÑÑ•¸=8ÑÑ•¸¹¥€ôÑÉ•¹Ñ•¹…¹Ñ}¥9ÑÑ•¸¹½É…¹¥é…Ñ¥½¹}¥€ô‰Ð¹½É…¹¥é…Ñ¥½¹}¥9ÑÑ•¸¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€‘íÑÉ•…ÍÕÉå)½¥¹ô(€€€€€€]!I‰Ð¹½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€9‰Ð¹¥€ô€É€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°¥‘t°(€€€€¤ì(€€€É•ÑÕÉ¸É•ÅÕ¥É•I½Ü¡É½ÝÍlÁt°€	…¹¬ÑÉ…¹Í…Ñ¥½¸œ¤ì(€ô((€…Íå¹ŒÑÉ•…ÍÕÉåQÉ…¹Í™•É½Éµ…Ñ„¡Í½ÕÉ•I•¥ÍÑ•Èè€5%9}M œð€	9,œ¤ì(€€€…Ý…¥ÐÑ¡¥Ì¹•¹ÍÕÉ•	…¹­M¡•µ„ ¤ì(€€€…Ý…¥ÐÑ¡¥Ì¹•¹ÍÕÉ•QÉ•…ÍÕÉåQÉ…¹Í™•ÉM¡•µ„ ¤ì(€€€½¹ÍÐm‰…¹­½Õ¹ÑÌ°…Í¡	…±…¹•Ì°…Í¡M•ÍÍ¥½¹I•ÍÕ±Ñt€ô…Ý…¥ÐAÉ½µ¥Í”¹…±°¡l(€€€€€Ñ¡¥Ì¹Í¡…É•¡½±‘•É	…¹­½Õ¹ÑÌ ¤°(€€€€€Ñ¡¥Ì¹ÑÉ•…ÍÕÉå…Í¡	…±…¹•Ì ¤°(€€€€€Ñ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€€€M1P¥°ÍÑ…ÑÕÌ°½Á•¹•‘}…Ð°½Á•¹¥¹}‰…±…¹”(€€€€€€€€I=4…Í¡}Í•ÍÍ¥½¹Ì(€€€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€€€9ÍÑ…ÑÕÌ€ô€=A8œ(€€€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€=IH	d½Á•¹•‘}…ÐM(€€€€€€€€1%5%P€Å€°(€€€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€€€¤°(€€€t¤ì(€€€½¹ÍÐÑÉ…¹Í™•ÉQåÁ•ÌèÉÉ…äñìÙ…±Õ”èÍÑÉ¥¹œì±…‰•°èÍÑÉ¥¹œôø€ômtì(€€€¥˜€¡Ñ¡¥Ì¹¡…ÍA•Éµ¥ÍÍ¥½¸ ÑÉ•…ÍÕÉå}ÑÉ…¹Í™•ÉÌ¹™É½µ}…Í œ¤¤ì(€€€€€ÑÉ…¹Í™•ÉQåÁ•Ì¹ÁÕÍ ¡ìÙ…±Õ”è€M!}Q=}	9,œ°±…‰•°è€¥ÃÑÐ•¸‰…¹ÅÕ”œô¤ì(€€€ô(€€€¥˜€¡Ñ¡¥Ì¹¡…ÍA•Éµ¥ÍÍ¥½¸ ÑÉ•…ÍÕÉå}ÑÉ…¹Í™•ÉÌ¹™É½µ}‰…¹¬œ¤¤ì(€€€€€ÑÉ…¹Í™•ÉQåÁ•Ì¹ÁÕÍ ¡ìÙ…±Õ”è€	9-}Q=}M œ°±…‰•°è€I•ÑÉ…¥Ð‰…¹…¥É”Ù•ÉÌ…¥ÍÍ”œô¤ì(€€€ô(€€€¥˜€¡Í½ÕÉ•I•¥ÍÑ•È€ôôô€	9,œ€˜˜Ñ¡¥Ì¹¡…ÍA•Éµ¥ÍÍ¥½¸ ÑÉ•…ÍÕÉå}ÑÉ…¹Í™•ÉÌ¹‰…¹­}Ñ½}‰…¹¬œ¤¤ì(€€€€€ÑÉ…¹Í™•ÉQåÁ•Ì¹ÁÕÍ ¡ìÙ…±Õ”è€	9-}Q=}	9,œ°±…‰•°è€Y¥É•µ•¹Ð•¹ÑÉ”½µÁÑ•Ìœô¤ì(€€€ô(€€€É•ÑÕÉ¸ì(€€€€€Í½ÕÉ•}É•¥ÍÑ•ÈèÍ½ÕÉ•I•¥ÍÑ•È°(€€€€€ÑÉ…¹Í™•É}ÑåÁ•ÌèÑÉ…¹Í™•ÉQåÁ•Ì°(€€€€€Á…åµ•¹Ñ}µ•Ñ¡½‘Ìèl(€€€€€€€ìÙ…±Õ”è€	9-}QI9MHœ°±…‰•°è€Y¥É•µ•¹Ð‰…¹…¥É”œô°(€€€€€€€ìÙ…±Õ”è€M œ°±…‰•°è€ÍÃ¡•Ìœô°(€€€€€€€ìÙ…±Õ”è€!EUœ°±…‰•°è€£¡ÅÕ”œô°(€€€€€€€ìÙ…±Õ”è€=Q!Hœ°±…‰•°è€ÕÑÉ”œô°(€€€€€t°(€€€€€…Í¡}Í•ÍÍ¥½¸è…Í¡M•ÍÍ¥½¹I•ÍÕ±Ð¹É½ÝÍlÁt€üü¹Õ±°°(€€€€€…Í¡}‰…±…¹•Ìè…Í¡	…±…¹•Ì°(€€€€€‰…¹­}…½Õ¹ÑÌè‰…¹­½Õ¹ÑÌ°(€€€ôì(€ô((€…Íå¹ŒÉ•…Ñ•QÉ•…ÍÕÉåQÉ…¹Í™•È¡Í½ÕÉ•I•¥ÍÑ•Èè€5%9}M œð€	9,œ°‰½‘äèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø¤ì(€€€…Ý…¥ÐÑ¡¥Ì¹•¹ÍÕÉ•	…¹­M¡•µ„ ¤ì(€€€…Ý…¥ÐÑ¡¥Ì¹•¹ÍÕÉ•QÉ•…ÍÕÉåQÉ…¹Í™•ÉM¡•µ„ ¤ì(€€€½¹ÍÐÁ…å±½…€ôÑ¡¥Ì¹¹½Éµ…±¥é•QÉ•…ÍÕÉåQÉ…¹Í™•ÉA…å±½…¡Í½ÕÉ•I•¥ÍÑ•È°‰½‘ä¤ì(€€€Ñ¡¥Ì¹…ÍÍ•ÉÑQÉ•…ÍÕÉåQÉ…¹Í™•ÉA•Éµ¥ÍÍ¥½¸¡Á…å±½…¹ÑÉ…¹Í™•ÉQåÁ”¤ì(€€€É•ÑÕÉ¸Ñ¡¥Ì¹‘ˆ¹ÑÉ…¹Í…Ñ¥½¸¡…Íå¹Œ€¡±¥•¹Ð¤€ôøÑ¡¥Ì¹É•…Ñ•QÉ•…ÍÕÉåQÉ…¹Í™•É%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹Ð°Í½ÕÉ•I•¥ÍÑ•È°Á…å±½…¤¤ì(€ô((€…Íå¹ŒÑÉ•…ÍÕÉåQÉ…¹Í™•È¡¥è¹Õµ‰•È¤ì(€€€É•ÑÕÉ¸Ñ¡¥Ì¹ÑÉ•…ÍÕÉåQÉ…¹Í™•É	åá•ÕÑ½È¡Ñ¡¥Ì¹‘ˆ°¥¤ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÑÉ•…ÍÕÉåQÉ…¹Í™•É	åá•ÕÑ½È (€€€•á•ÕÑ½ÈèA¥¬ñ…Ñ…‰…Í•M•ÉÙ¥”°€ÅÕ•ÉäœøðA½½±±¥•¹Ð°(€€€¥è¹Õµ‰•È°(€€¤ì(€€€…Ý…¥ÐÑ¡¥Ì¹•¹ÍÕÉ•QÉ•…ÍÕÉåQÉ…¹Í™•ÉM¡•µ„ ¤ì(€€€½¹ÍÐÉÕ¹¹•È€ô•á•ÕÑ½È…ÌìÅÕ•Éäè€ñP€ô…¹äø¡Ñ•áÐèÍÑÉ¥¹œ°Á…É…µÌüèÕ¹­¹½Ý¹mt¤€ôøAÉ½µ¥Í”ñìÉ½ÝÌèQmtôøôì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥ÐÉÕ¹¹•È¹ÅÕ•Éä (€€€€€M1PÑÐ¸¨°(€€€€€€€€€€€€€=1M¡9U11%¡QI%4¡=9P¡=1M¡Ô¹™¥ÉÍÑ}¹…µ”°€œœ¤°€œ€œ°=1M¡Ô¹±…ÍÑ}¹…µ”°€œœ¤¤¤°€œœ¤°Ô¹•µ…¥°¤LÉ•…Ñ•‘}‰å}¹…µ”°(€€€€€€€€€€€€€ÍÉ}‰„¹‰…¹­}¹…µ”LÍ½ÕÉ•}‰…¹­}¹…µ”°(€€€€€€€€€€€€€ÍÉ}‰„¹…½Õ¹Ñ}¹…µ”LÍ½ÕÉ•}‰…¹­}…½Õ¹Ñ}¹…µ”°(€€€€€€€€€€€€€ÍÉ}‰„¹…½Õ¹Ñ}¹Õµ‰•ÈLÍ½ÕÉ•}‰…¹­}…½Õ¹Ñ}¹Õµ‰•È°(€€€€€€€€€€€€€‘ÍÑ}‰„¹‰…¹­}¹…µ”L‘•ÍÑ¥¹…Ñ¥½¹}‰…¹­}¹…µ”°(€€€€€€€€€€€€€‘ÍÑ}‰„¹…½Õ¹Ñ}¹…µ”L‘•ÍÑ¥¹…Ñ¥½¹}‰…¹­}…½Õ¹Ñ}¹…µ”°(€€€€€€€€€€€€€‘ÍÑ}‰„¹…½Õ¹Ñ}¹Õµ‰•ÈL‘•ÍÑ¥¹…Ñ¥½¹}‰…¹­}…½Õ¹Ñ}¹Õµ‰•È°(€€€€€€€€€€€€€ÍÉ}´¹Á¥••}¹Õµ‰•ÈLÍ½ÕÉ•}…Í¡}Á¥••}¹Õµ‰•È°(€€€€€€€€€€€€€ÍÉ}´¹µ½Ù•µ•¹Ñ}‘…Ñ”LÍ½ÕÉ•}…Í¡}µ½Ù•µ•¹Ñ}‘…Ñ”°(€€€€€€€€€€€€€‘ÍÑ}´¹Á¥••}¹Õµ‰•ÈL‘•ÍÑ¥¹…Ñ¥½¹}…Í¡}Á¥••}¹Õµ‰•È°(€€€€€€€€€€€€€‘ÍÑ}´¹µ½Ù•µ•¹Ñ}‘…Ñ”L‘•ÍÑ¥¹…Ñ¥½¹}…Í¡}µ½Ù•µ•¹Ñ}‘…Ñ”°(€€€€€€€€€€€€€ÍÉ}‰Ð¹ÑÉ…¹Í…Ñ¥½¹}¹Õµ‰•ÈLÍ½ÕÉ•}‰…¹­}ÑÉ…¹Í…Ñ¥½¹}¹Õµ‰•È°(€€€€€€€€€€€€€ÍÉ}‰Ð¹ÑÉ…¹Í…Ñ¥½¹}‘…Ñ”LÍ½ÕÉ•}‰…¹­}ÑÉ…¹Í…Ñ¥½¹}‘…Ñ”°(€€€€€€€€€€€€€‘ÍÑ}‰Ð¹ÑÉ…¹Í…Ñ¥½¹}¹Õµ‰•ÈL‘•ÍÑ¥¹…Ñ¥½¹}‰…¹­}ÑÉ…¹Í…Ñ¥½¹}¹Õµ‰•È°(€€€€€€€€€€€€€‘ÍÑ}‰Ð¹ÑÉ…¹Í…Ñ¥½¹}‘…Ñ”L‘•ÍÑ¥¹…Ñ¥½¹}‰…¹­}ÑÉ…¹Í…Ñ¥½¹}‘…Ñ”(€€€€€€I=4ÑÉ•…ÍÕÉå}ÑÉ…¹Í™•ÉÌÑÐ(€€€€€€1P)=%8…ÁÁ}ÕÍ•ÉÌÔ=8Ô¹¥€ôÑÐ¹É•…Ñ•‘}‰ä(€€€€€€1P)=%8‰…¹­}…½Õ¹ÑÌÍÉ}‰„=8ÍÉ}‰„¹¥€ôÑÐ¹Í½ÕÉ•}‰…¹­}…½Õ¹Ñ}¥9ÍÉ}‰„¹½É…¹¥é…Ñ¥½¹}¥€ôÑÐ¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€1P)=%8‰…¹­}…½Õ¹ÑÌ‘ÍÑ}‰„=8‘ÍÑ}‰„¹¥€ôÑÐ¹‘•ÍÑ¥¹…Ñ¥½¹}‰…¹­}…½Õ¹Ñ}¥9‘ÍÑ}‰„¹½É…¹¥é…Ñ¥½¹}¥€ôÑÐ¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€1P)=%8…Í¡}µ½Ù•µ•¹ÑÌÍÉ}´=8ÍÉ}´¹¥€ôÑÐ¹Í½ÕÉ•}…Í¡}µ½Ù•µ•¹Ñ}¥9ÍÉ}´¹½É…¹¥é…Ñ¥½¹}¥€ôÑÐ¹½É…¹¥é…Ñ¥½¹}¥9ÍÉ}´¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€1P)=%8…Í¡}µ½Ù•µ•¹ÑÌ‘ÍÑ}´=8‘ÍÑ}´¹¥€ôÑÐ¹‘•ÍÑ¥¹…Ñ¥½¹}…Í¡}µ½Ù•µ•¹Ñ}¥9‘ÍÑ}´¹½É…¹¥é…Ñ¥½¹}¥€ôÑÐ¹½É…¹¥é…Ñ¥½¹}¥9‘ÍÑ}´¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€1P)=%8‰…¹­}ÑÉ…¹Í…Ñ¥½¹ÌÍÉ}‰Ð=8ÍÉ}‰Ð¹¥€ôÑÐ¹Í½ÕÉ•}‰…¹­}ÑÉ…¹Í…Ñ¥½¹}¥9ÍÉ}‰Ð¹½É…¹¥é…Ñ¥½¹}¥€ôÑÐ¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€1P)=%8‰…¹­}ÑÉ…¹Í…Ñ¥½¹Ì‘ÍÑ}‰Ð=8‘ÍÑ}‰Ð¹¥€ôÑÐ¹‘•ÍÑ¥¹…Ñ¥½¹}‰…¹­}ÑÉ…¹Í…Ñ¥½¹}¥9‘ÍÑ}‰Ð¹½É…¹¥é…Ñ¥½¹}¥€ôÑÐ¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€]!IÑÐ¹½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€9ÑÐ¹¥€ô€É€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°¥‘t°(€€€€¤ì(€€€½¹ÍÐÑÉ…¹Í™•È€ôÉ•ÅÕ¥É•I½Ü¡É½ÝÍlÁt°€QÉ•…ÍÕÉäÑÉ…¹Í™•Èœ¤ì(€€€É•ÑÕÉ¸ì(€€€€€€¸¸¹ÑÉ…¹Í™•È°(€€€€€Í½ÕÉ•}±…‰•°èÑ¡¥Ì¹ÑÉ•…ÍÕÉåMÕÁÁ½ÉÑ1…‰•°¡ì(€€€€€€€ÍÕÁÁ½ÉÑQåÁ”èMÑÉ¥¹œ¡ÑÉ…¹Í™•È¹Í½ÕÉ•}ÑåÁ”¤°(€€€€€€€‰…¹­9…µ”èÑÉ…¹Í™•È¹Í½ÕÉ•}‰…¹­}¹…µ”°(€€€€€€€…½Õ¹Ñ9…µ”èÑÉ…¹Í™•È¹Í½ÕÉ•}‰…¹­}…½Õ¹Ñ}¹…µ”°(€€€€€ô¤°(€€€€€‘•ÍÑ¥¹…Ñ¥½¹}±…‰•°èÑ¡¥Ì¹ÑÉ•…ÍÕÉåMÕÁÁ½ÉÑ1…‰•°¡ì(€€€€€€€ÍÕÁÁ½ÉÑQåÁ”èMÑÉ¥¹œ¡ÑÉ…¹Í™•È¹‘•ÍÑ¥¹…Ñ¥½¹}ÑåÁ”¤°(€€€€€€€‰…¹­9…µ”èÑÉ…¹Í™•È¹‘•ÍÑ¥¹…Ñ¥½¹}‰…¹­}¹…µ”°(€€€€€€€…½Õ¹Ñ9…µ”èÑÉ…¹Í™•È¹‘•ÍÑ¥¹…Ñ¥½¹}‰…¹­}…½Õ¹Ñ}¹…µ”°(€€€€€ô¤°(€€€ôì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ•¹ÍÕÉ•	…¹­M¡•µ„ ¤ì(€€€¥˜€ „¡…Ý…¥ÐÑ¡¥Ì¹Ñ…‰±•á¥ÍÑÌ ‰…¹­}…½Õ¹ÑÌœ¤¤ñð€„¡…Ý…¥ÐÑ¡¥Ì¹Ñ…‰±•á¥ÍÑÌ ‰…¹­}ÑÉ…¹Í…Ñ¥½¹Ìœ¤¤¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1”µ½‘Õ±”	…¹ÅÕ”»Še•ÍÐÁ…Ì•¹½É”½¹™¥ÕË¤¸œ¤ì(€€€ô(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ•¹ÍÕÉ•QÉ•…ÍÕÉåQÉ…¹Í™•ÉM¡•µ„ ¤ì(€€€¥˜€ „¡…Ý…¥ÐÑ¡¥Ì¹Ñ…‰±•á¥ÍÑÌ ÑÉ•…ÍÕÉå}ÑÉ…¹Í™•ÉÌœ¤¤¤ì(€€€€€Ñ¡É½Ü¹•ÜM•ÉÙ¥•U¹…Ù…¥±…‰±•á•ÁÑ¥½¸ (€€€€€€€€1”µ½‘Õ±”‘•ÌÑÉ…¹Í™•ÉÑÌ¥¹Ñ•É¹•Ì»Še•ÍÐÁ…Ì‘¥ÍÁ½¹¥‰±”¸ÁÁ±¥ÅÕ•è±„µ¥É…Ñ¥½¸€ÈÀÈØÀÜÈÍ}‰…¹­}ÑÉ•…ÍÕÉå}ÑÉ…¹Í™•ÉÌ¹ÍÅ°¸œ°(€€€€€€¤ì(€€€ô(€ô((€ÁÉ¥Ù…Ñ”¹½Éµ…±¥é•	…¹­A•É¥½¡™¥±Ñ•ÉÌèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø¤ì(€€€½¹ÍÐ¹½Ü€ô¹•Ü…Ñ” ¤ì(€€€½¹ÍÐÍÑ…ÉÐ€ô™¥±Ñ•ÉÌ¹ÍÑ…ÉÐ(€€€€€€ü€¡Ñ¡¥Ì¹¹½Éµ…±¥é•1•…Í•A…å±½…‘…Ñ”¡™¥±Ñ•ÉÌ¹ÍÑ…ÉÐ°€ÍÑ…ÉÐœ°ÑÉÕ”¤€üüÑ¡¥Ì¹±½…±…Ñ•MÑÉ¥¹œ¡¹•Ü…Ñ”¡¹½Ü¹•ÑÕ±±e•…È ¤°¹½Ü¹•Ñ5½¹Ñ  ¤°€Ä¤¤¤(€€€€€€èÑ¡¥Ì¹±½…±…Ñ•MÑÉ¥¹œ¡¹•Ü…Ñ”¡¹½Ü¹•ÑÕ±±e•…È ¤°¹½Ü¹•Ñ5½¹Ñ  ¤°€Ä¤¤ì(€€€½¹ÍÐ•¹€ô™¥±Ñ•ÉÌ¹•¹(€€€€€€ü€¡Ñ¡¥Ì¹¹½Éµ…±¥é•1•…Í•A…å±½…‘…Ñ”¡™¥±Ñ•ÉÌ¹•¹°€•¹œ°ÑÉÕ”¤€üüÑ¡¥Ì¹±½…±…Ñ•MÑÉ¥¹œ¡¹•Ü…Ñ”¡¹½Ü¹•ÑÕ±±e•…È ¤°¹½Ü¹•Ñ5½¹Ñ  ¤€¬€Ä°€À¤¤¤(€€€€€€èÑ¡¥Ì¹±½…±…Ñ•MÑÉ¥¹œ¡¹•Ü…Ñ”¡¹½Ü¹•ÑÕ±±e•…È ¤°¹½Ü¹•Ñ5½¹Ñ  ¤€¬€Ä°€À¤¤ì(€€€¥˜€¡ÍÑ…ÉÐ€ø•¹¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1„Ã¥É¥½‘”‰…¹…¥É”•ÍÐ¥¹Ù…±¥‘”¸œ¤ì(€€€ô(€€€É•ÑÕÉ¸ìÍÑ…ÉÐ°•¹ôì(€ô((€ÁÉ¥Ù…Ñ”¹½Éµ…±¥é•	…¹­½Õ¹ÑÉ•…Ñ•A…å±½…¡‰½‘äèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø¤ì(€€€½¹ÍÐ‰…¹­9…µ”€ôMÑÉ¥¹œ¡‰½‘ä¹‰…¹­}¹…µ”€üü€œœ¤¹ÑÉ¥´ ¤ì(€€€½¹ÍÐ…½Õ¹Ñ9…µ”€ôMÑÉ¥¹œ¡‰½‘ä¹…½Õ¹Ñ}¹…µ”€üü€œœ¤¹ÑÉ¥´ ¤ì(€€€½¹ÍÐ…½Õ¹Ñ9Õµ‰•È€ôMÑÉ¥¹œ¡‰½‘ä¹…½Õ¹Ñ}¹Õµ‰•È€üü€œœ¤¹ÑÉ¥´ ¤ñð¹Õ±°ì(€€€½¹ÍÐ…½Õ¹ÑQåÁ”€ôMÑÉ¥¹œ¡‰½‘ä¹…½Õ¹Ñ}ÑåÁ”€üü€UII9Pœ¤¹ÑÉ¥´ ¤¹Ñ½UÁÁ•É…Í” ¤ì(€€€½¹ÍÐÕÉÉ•¹ä€ôMÑÉ¥¹œ¡‰½‘ä¹ÕÉÉ•¹ä€üü€œœ¤¹ÑÉ¥´ ¤¹Ñ½UÁÁ•É…Í” ¤ì(€€€½¹ÍÐÍÑ…ÑÕÌ€ôMÑÉ¥¹œ¡‰½‘ä¹ÍÑ…ÑÕÌ€üü€Q%Yœ¤¹ÑÉ¥´ ¤¹Ñ½UÁÁ•É…Í” ¤ì(€€€½¹ÍÐ½Á•¹¥¹	…±…¹”€ô‰½‘ä¹½Á•¹¥¹}‰…±…¹”€ôôô€œœñð‰½‘ä¹½Á•¹¥¹}‰…±…¹”€ôô¹Õ±°€ü€À€è9Õµ‰•È¡‰½‘ä¹½Á•¹¥¹}‰…±…¹”¤ì(€€€½¹ÍÐ½Á•¹¥¹…Ñ”€ôÑ¡¥Ì¹¹½Éµ…±¥é•1•…Í•A…å±½…‘…Ñ”¡‰½‘ä¹½Á•¹¥¹}‘…Ñ”€üüÑ¡¥Ì¹±½…±…Ñ•MÑÉ¥¹œ¡¹•Ü…Ñ” ¤¤°€½Á•¹¥¹}‘…Ñ”œ°ÑÉÕ”¤ì(€€€¥˜€ …‰…¹­9…µ”¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1”¹½´‘”±„‰…¹ÅÕ”•ÍÐ½‰±¥…Ñ½¥É”¸œ¤ì(€€€ô(€€€¥˜€ ……½Õ¹Ñ9…µ”¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1”¹½´‘Ô½µÁÑ”•ÍÐ½‰±¥…Ñ½¥É”¸œ¤ì(€€€ô(€€€¥˜€ …lUII9Pœ°€MY%9Lœ°€MI=\œ°€=Q!Ht¹¥¹±Õ‘•Ì¡…½Õ¹ÑQåÁ”¤¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ QåÁ”‘”½µÁÑ”‰…¹…¥É”¥¹Ù…±¥‘”¸œ¤ì(€€€ô(€€€¥˜€ …lUMœ°€t¹¥¹±Õ‘•Ì¡ÕÉÉ•¹ä¤¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ •Ù¥Í”‰…¹…¥É”¥¹Ù…±¥‘”¸œ¤ì(€€€ô(€€€¥˜€ …lQ%Yœ°€%9Q%Yœ°€I!%Yt¹¥¹±Õ‘•Ì¡ÍÑ…ÑÕÌ¤¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ MÑ…ÑÕÐ‘”½µÁÑ”‰…¹…¥É”¥¹Ù…±¥‘”¸œ¤ì(€€€ô(€€€¥˜€ …9Õµ‰•È¹¥Í¥¹¥Ñ”¡½Á•¹¥¹	…±…¹”¤ñð½Á•¹¥¹	…±…¹”€ð€À¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1”Í½±‘”¥¹¥Ñ¥…°‘½¥Ðƒ©ÑÉ”ÍÕÃ¥É¥•ÕÈ½Ôƒ¥…°ƒ€ë¥É¼¸œ¤ì(€€€ô(€€€É•ÑÕÉ¸ì(€€€€€‰…¹­}¹…µ”è‰…¹­9…µ”°(€€€€€…½Õ¹Ñ}¹…µ”è…½Õ¹Ñ9…µ”°(€€€€€…½Õ¹Ñ}¹Õµ‰•Èè…½Õ¹Ñ9Õµ‰•È°(€€€€€…½Õ¹Ñ}ÑåÁ”è…½Õ¹ÑQåÁ”°(€€€€€ÕÉÉ•¹ä°(€€€€€½Á•¹¥¹}‰…±…¹”è9Õµ‰•È¡½Á•¹¥¹	…±…¹”¹Ñ½¥á• È¤¤°(€€€€€½Á•¹¥¹}‘…Ñ”è½Á•¹¥¹…Ñ”°(€€€€€ÍÑ…ÑÕÌ°(€€€€€¹½Ñ•ÌèMÑÉ¥¹œ¡‰½‘ä¹¹½Ñ•Ì€üü€œœ¤¹ÑÉ¥´ ¤ñð¹Õ±°°(€€€ôì(€ô((€ÁÉ¥Ù…Ñ”¹½Éµ…±¥é•	…¹­½Õ¹ÑUÁ‘…Ñ•A…å±½…¡‰½‘äèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø¤ì(€€€½¹ÍÐÁ…å±½…èI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø€ôíôì(€€€¥˜€¡‰½‘ä¹‰…¹­}¹…µ”€„ôôÕ¹‘•™¥¹•¤ì(€€€€€½¹ÍÐ‰…¹­9…µ”€ôMÑÉ¥¹œ¡‰½‘ä¹‰…¹­}¹…µ”€üü€œœ¤¹ÑÉ¥´ ¤ì(€€€€€¥˜€ …‰…¹­9…µ”¤Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1”¹½´‘”±„‰…¹ÅÕ”•ÍÐ½‰±¥…Ñ½¥É”¸œ¤ì(€€€€€Á…å±½…¹‰…¹­}¹…µ”€ô‰…¹­9…µ”ì(€€€ô(€€€¥˜€¡‰½‘ä¹…½Õ¹Ñ}¹…µ”€„ôôÕ¹‘•™¥¹•¤ì(€€€€€½¹ÍÐ…½Õ¹Ñ9…µ”€ôMÑÉ¥¹œ¡‰½‘ä¹…½Õ¹Ñ}¹…µ”€üü€œœ¤¹ÑÉ¥´ ¤ì(€€€€€¥˜€ ……½Õ¹Ñ9…µ”¤Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1”¹½´‘Ô½µÁÑ”•ÍÐ½‰±¥…Ñ½¥É”¸œ¤ì(€€€€€Á…å±½…¹…½Õ¹Ñ}¹…µ”€ô…½Õ¹Ñ9…µ”ì(€€€ô(€€€¥˜€¡‰½‘ä¹…½Õ¹Ñ}¹Õµ‰•È€„ôôÕ¹‘•™¥¹•¤ì(€€€€€Á…å±½…¹…½Õ¹Ñ}¹Õµ‰•È€ôMÑÉ¥¹œ¡‰½‘ä¹…½Õ¹Ñ}¹Õµ‰•È€üü€œœ¤¹ÑÉ¥´ ¤ñð¹Õ±°ì(€€€ô(€€€¥˜€¡‰½‘ä¹…½Õ¹Ñ}ÑåÁ”€„ôôÕ¹‘•™¥¹•¤ì(€€€€€½¹ÍÐ…½Õ¹ÑQåÁ”€ôMÑÉ¥¹œ¡‰½‘ä¹…½Õ¹Ñ}ÑåÁ”€üü€œœ¤¹ÑÉ¥´ ¤¹Ñ½UÁÁ•É…Í” ¤ì(€€€€€¥˜€ …lUII9Pœ°€MY%9Lœ°€MI=\œ°€=Q!Ht¹¥¹±Õ‘•Ì¡…½Õ¹ÑQåÁ”¤¤ì(€€€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ QåÁ”‘”½µÁÑ”‰…¹…¥É”¥¹Ù…±¥‘”¸œ¤ì(€€€€€ô(€€€€€Á…å±½…¹…½Õ¹Ñ}ÑåÁ”€ô…½Õ¹ÑQåÁ”ì(€€€ô(€€€¥˜€¡‰½‘ä¹ÍÑ…ÑÕÌ€„ôôÕ¹‘•™¥¹•¤ì(€€€€€½¹ÍÐÍÑ…ÑÕÌ€ôMÑÉ¥¹œ¡‰½‘ä¹ÍÑ…ÑÕÌ€üü€œœ¤¹ÑÉ¥´ ¤¹Ñ½UÁÁ•É…Í” ¤ì(€€€€€¥˜€ …lQ%Yœ°€%9Q%Yœ°€I!%Yt¹¥¹±Õ‘•Ì¡ÍÑ…ÑÕÌ¤¤ì(€€€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ MÑ…ÑÕÐ‘”½µÁÑ”‰…¹…¥É”¥¹Ù…±¥‘”¸œ¤ì(€€€€€ô(€€€€€Á…å±½…¹ÍÑ…ÑÕÌ€ôÍÑ…ÑÕÌì(€€€ô(€€€¥˜€¡‰½‘ä¹¹½Ñ•Ì€„ôôÕ¹‘•™¥¹•¤ì(€€€€€Á…å±½…¹¹½Ñ•Ì€ôMÑÉ¥¹œ¡‰½‘ä¹¹½Ñ•Ì€üü€œœ¤¹ÑÉ¥´ ¤ñð¹Õ±°ì(€€€ô(€€€É•ÑÕÉ¸Á…å±½…ì(€ô((€ÁÉ¥Ù…Ñ”¹½Éµ…±¥é•QÉ•…ÍÕÉåQÉ…¹Í™•ÉA…å±½…¡Í½ÕÉ•I•¥ÍÑ•Èè€5%9}M œð€	9,œ°‰½‘äèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø¤ì(€€€½¹ÍÐÑÉ…¹Í™•ÉQåÁ”€ôMÑÉ¥¹œ¡‰½‘ä¹ÑÉ…¹Í™•É}ÑåÁ”€üü€œœ¤¹ÑÉ¥´ ¤¹Ñ½UÁÁ•É…Í” ¤ì(€€€¥˜€ …lM!}Q=}	9,œ°€	9-}Q=}M œ°€	9-}Q=}	9,t¹¥¹±Õ‘•Ì¡ÑÉ…¹Í™•ÉQåÁ”¤¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ QåÁ”‘”ÑÉ…¹Í™•ÉÐ¥¹Ñ•É¹”¥¹Ù…±¥‘”¸œ¤ì(€€€ô(€€€¥˜€¡Í½ÕÉ•I•¥ÍÑ•È€ôôô€5%9}M œ€˜˜ÑÉ…¹Í™•ÉQåÁ”€ôôô€	9-}Q=}	9,œ¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ ”ÑåÁ”‘”ÑÉ…¹Í™•ÉÐ‘½¥Ðƒ©ÑÉ”¥¹¥Ñ§¤‘•ÁÕ¥Ì±„Á…”	…¹ÅÕ”¸œ¤ì(€€€ô(€€€½¹ÍÐÑÉ…¹Í™•É…Ñ”€ôÑ¡¥Ì¹¹½Éµ…±¥é•1•…Í•A…å±½…‘…Ñ”¡‰½‘ä¹ÑÉ…¹Í™•É}‘…Ñ”€üüÑ¡¥Ì¹±½…±…Ñ•MÑÉ¥¹œ¡¹•Ü…Ñ” ¤¤°€ÑÉ…¹Í™•É}‘…Ñ”œ°ÑÉÕ”¤ì(€€€¥˜€ …ÑÉ…¹Í™•É…Ñ”¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1„‘…Ñ”‘ÔÑÉ…¹Í™•ÉÐ•ÍÐ½‰±¥…Ñ½¥É”¸œ¤ì(€€€ô(€€€½¹ÍÐÕÉÉ•¹ä€ôMÑÉ¥¹œ¡‰½‘ä¹ÕÉÉ•¹ä€üü€œœ¤¹ÑÉ¥´ ¤¹Ñ½UÁÁ•É…Í” ¤ì(€€€¥˜€ …lUMœ°€t¹¥¹±Õ‘•Ì¡ÕÉÉ•¹ä¤¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ •Ù¥Í”‘”ÑÉ…¹Í™•ÉÐ¥¹Ù…±¥‘”¸œ¤ì(€€€ô(€€€½¹ÍÐ…µ½Õ¹Ð€ô9Õµ‰•È¡‰½‘ä¹…µ½Õ¹Ð€üü€À¤ì(€€€¥˜€ …9Õµ‰•È¹¥Í¥¹¥Ñ”¡…µ½Õ¹Ð¤ñð…µ½Õ¹Ð€ðô€À¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1”µ½¹Ñ…¹Ð‘ÔÑÉ…¹Í™•ÉÐ•ÍÐ¥¹Ù…±¥‘”¸œ¤ì(€€€ô(€€€½¹ÍÐÁ…åµ•¹Ñ5•Ñ¡½€ôMÑÉ¥¹œ (€€€€€‰½‘ä¹Á…åµ•¹Ñ}µ•Ñ¡½(€€€€€€üü€¡ÑÉ…¹Í™•ÉQåÁ”€ôôô€	9-}Q=}M œ€ü€M œ€è€	9-}QI9MHœ¤°(€€€€¤¹ÑÉ¥´ ¤¹Ñ½UÁÁ•É…Í” ¤ì(€€€¥˜€ …l	9-}QI9MHœ°€M œ°€!EUœ°€=Q!Ht¹¥¹±Õ‘•Ì¡Á…åµ•¹Ñ5•Ñ¡½¤¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 5½‘”‘”ÑÉ…¹Í™•ÉÐ¥¹Ù…±¥‘”¸œ¤ì(€€€ô(€€€½¹ÍÐÍ½ÕÉ•	…¹­½Õ¹Ñ%€ôÑ¡¥Ì¹¹½Éµ…±¥é•9Õ±±…‰±•A½Í¥Ñ¥Ù•%¹Ð¡‰½‘ä¹Í½ÕÉ•}‰…¹­}…½Õ¹Ñ}¥¤ì(€€€½¹ÍÐ‘•ÍÑ¥¹…Ñ¥½¹	…¹­½Õ¹Ñ%€ôÑ¡¥Ì¹¹½Éµ…±¥é•9Õ±±…‰±•A½Í¥Ñ¥Ù•%¹Ð¡‰½‘ä¹‘•ÍÑ¥¹…Ñ¥½¹}‰…¹­}…½Õ¹Ñ}¥¤ì(€€€¥˜€¡ÑÉ…¹Í™•ÉQåÁ”€ôôô€M!}Q=}	9,œ€˜˜€…‘•ÍÑ¥¹…Ñ¥½¹	…¹­½Õ¹Ñ%¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1”½µÁÑ”‰…¹…¥É”‘”‘•ÍÑ¥¹…Ñ¥½¸•ÍÐ½‰±¥…Ñ½¥É”¸œ¤ì(€€€ô(€€€¥˜€¡ÑÉ…¹Í™•ÉQåÁ”€ôôô€	9-}Q=}M œ€˜˜€…Í½ÕÉ•	…¹­½Õ¹Ñ%¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1”½µÁÑ”‰…¹…¥É”Í½ÕÉ”•ÍÐ½‰±¥…Ñ½¥É”¸œ¤ì(€€€ô(€€€¥˜€¡ÑÉ…¹Í™•ÉQåÁ”€ôôô€	9-}Q=}	9,œ¤ì(€€€€€¥˜€ …Í½ÕÉ•	…¹­½Õ¹Ñ%ñð€…‘•ÍÑ¥¹…Ñ¥½¹	…¹­½Õ¹Ñ%¤ì(€€€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1•Ì½µÁÑ•Ì‰…¹…¥É•ÌÍ½ÕÉ”•Ð‘•ÍÑ¥¹…Ñ¥½¸Í½¹Ð½‰±¥…Ñ½¥É•Ì¸œ¤ì(€€€€€ô(€€€€€¥˜€¡Í½ÕÉ•	…¹­½Õ¹Ñ%€ôôô‘•ÍÑ¥¹…Ñ¥½¹	…¹­½Õ¹Ñ%¤ì(€€€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1”½µÁÑ”Í½ÕÉ”•Ð±”½µÁÑ”‘•ÍÑ¥¹…Ñ¥½¸‘½¥Ù•¹Ðƒ©ÑÉ”‘¥™›¥É•¹ÑÌ¸œ¤ì(€€€€€ô(€€€ô(€€€É•ÑÕÉ¸ì(€€€€€ÑÉ…¹Í™•ÉQåÁ”èÑÉ…¹Í™•ÉQåÁ”…Ì€M!}Q=}	9,œð€	9-}Q=}M œð€	9-}Q=}	9,œ°(€€€€€ÑÉ…¹Í™•É…Ñ”°(€€€€€ÕÉÉ•¹ä°(€€€€€…µ½Õ¹Ðè9Õµ‰•È¡…µ½Õ¹Ð¹Ñ½¥á• È¤¤°(€€€€€Á…åµ•¹Ñ5•Ñ¡½°(€€€€€Í½ÕÉ•	…¹­½Õ¹Ñ%°(€€€€€‘•ÍÑ¥¹…Ñ¥½¹	…¹­½Õ¹Ñ%°(€€€€€É•™•É•¹”èMÑÉ¥¹œ¡‰½‘ä¹É•™•É•¹”€üü€œœ¤¹ÑÉ¥´ ¤ñð¹Õ±°°(€€€€€‘•ÍÉ¥ÁÑ¥½¸èMÑÉ¥¹œ¡‰½‘ä¹‘•ÍÉ¥ÁÑ¥½¸€üü‰½‘ä¹É•…Í½¸€üü€œœ¤¹ÑÉ¥´ ¤ñð¹Õ±°°(€€€€€¹½Ñ•ÌèMÑÉ¥¹œ¡‰½‘ä¹¹½Ñ•Ì€üü€œœ¤¹ÑÉ¥´ ¤ñð¹Õ±°°(€€€€€¥‘•µÁ½Ñ•¹å-•äèMÑÉ¥¹œ (€€€€€€€‰½‘ä¹¥‘•µÁ½Ñ•¹å}­•ä(€€€€€€€€üü‰½‘ä¹±¥•¹Ñ}É•ÅÕ•ÍÑ}¥(€€€€€€€€üül(€€€€€€€€€€QIMUIe}QI9MHœ°(€€€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°(€€€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•É% ¤€üü€…¹½¸œ°(€€€€€€€€€ÑÉ…¹Í™•ÉQåÁ”°(€€€€€€€€€…Ñ”¹¹½Ü ¤°(€€€€€€€t¹©½¥¸ œèœ¤°(€€€€€€¤°(€€€ôì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ¹•áÑ	…¹­QÉ…¹Í…Ñ¥½¹9Õµ‰•È¡±¥•¹ÐèA½½±±¥•¹Ð¤ì(€€€½¹ÍÐå•…È€ô¹•Ü…Ñ” ¤¹•ÑÕ±±e•…È ¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P=1M¡5` ¡MU	MQI%9¡ÑÉ…¹Í…Ñ¥½¹}¹Õµ‰•ÈI=4€Ä¤¤èé%9P¤°€À¤€¬€ÄLÙ…±Õ”(€€€€€€I=4‰…¹­}ÑÉ…¹Í…Ñ¥½¹Ì(€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€9ÑÉ…¹Í…Ñ¥½¹}¹Õµ‰•È1%-€Í€°(€€€€€m	QH´‘íå•…Éô´¡lÀ´åt¬¥€°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°	QH´‘íå•…Éô´•t°(€€€€¤ì(€€€É•ÑÕÉ¸	QH´‘íå•…Éô´‘íMÑÉ¥¹œ¡É½ÝÍlÁtü¹Ù…±Õ”€üü€Ä¤¹Á…‘MÑ…ÉÐ Ø°€œÀœ¥õ€ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ¹•áÑQÉ•…ÍÕÉåQÉ…¹Í™•É9Õµ‰•È¡±¥•¹ÐèA½½±±¥•¹Ð¤ì(€€€½¹ÍÐå•…È€ô¹•Ü…Ñ” ¤¹•ÑÕ±±e•…È ¤ì(€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä¡M1PÁ}…‘Ù¥Í½Éå}á…Ñ}±½¬¡¡…Í¡Ñ•áÐ Ä¤¥€°mÑÉ•…ÍÕÉäµÑÉ…¹Í™•Èµ¹Õµ‰•È´‘íÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥õt¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P=1M¡5` ¡MU	MQI%9¡ÑÉ…¹Í™•É}¹Õµ‰•ÈI=4€Ä¤¤èé%9P¤°€À¤€¬€ÄLÙ…±Õ”(€€€€€€I=4ÑÉ•…ÍÕÉå}ÑÉ…¹Í™•ÉÌ(€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€9ÑÉ…¹Í™•É}¹Õµ‰•È1%-€Í€°(€€€€€mQI´‘íå•…Éô´¡lÀ´åt¬¥€°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°QI´‘íå•…Éô´•t°(€€€€¤ì(€€€É•ÑÕÉ¸QI´‘íå•…Éô´‘íMÑÉ¥¹œ¡É½ÝÍlÁtü¹Ù…±Õ”€üü€Ä¤¹Á…‘MÑ…ÉÐ Ø°€œÀœ¥õ€ì(€ô((€ÁÉ¥Ù…Ñ”±½…±…Ñ•MÑÉ¥¹œ¡Ù…±Õ”è…Ñ”¤ì(€€€½¹ÍÐå•…È€ôÙ…±Õ”¹•ÑÕ±±e•…È ¤ì(€€€½¹ÍÐµ½¹Ñ €ôMÑÉ¥¹œ¡Ù…±Õ”¹•Ñ5½¹Ñ  ¤€¬€Ä¤¹Á…‘MÑ…ÉÐ È°€œÀœ¤ì(€€€½¹ÍÐ‘…ä€ôMÑÉ¥¹œ¡Ù…±Õ”¹•Ñ…Ñ” ¤¤¹Á…‘MÑ…ÉÐ È°€œÀœ¤ì(€€€É•ÑÕÉ¸€‘íå•…Éô´‘íµ½¹Ñ¡ô´‘í‘…åõ€ì(€ô((€ÁÉ¥Ù…Ñ”¹½Éµ…±¥é•9Õ±±…‰±•A½Í¥Ñ¥Ù•%¹Ð¡Ù…±Õ”èÕ¹­¹½Ý¸¤ì(€€€¥˜€¡Ù…±Õ”€ôôôÕ¹‘•™¥¹•ñðÙ…±Õ”€ôôô¹Õ±°ñðÙ…±Õ”€ôôô€œœ¤É•ÑÕÉ¸¹Õ±°ì(€€€½¹ÍÐÁ…ÉÍ•€ô9Õµ‰•È¡Ù…±Õ”¤ì(€€€¥˜€ …9Õµ‰•È¹¥Í%¹Ñ••È¡Á…ÉÍ•¤ñðÁ…ÉÍ•€ðô€À¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ %‘•¹Ñ¥™¥…¹Ð‘”ÑÉ…¹Í™•ÉÐ¥¹Ñ•É¹”¥¹Ù…±¥‘”¸œ¤ì(€€€ô(€€€É•ÑÕÉ¸Á…ÉÍ•ì(€ô((€…Íå¹ŒÍ¡…É•¡½±‘•ÉÌ¡™¥±Ñ•ÉÌèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø€ôíô¤ì(€€€…Ý…¥ÐÑ¡¥Ì¹•¹ÍÕÉ•M¡…É•¡½±‘•ÉM¡•µ„ ¤ì(€€€½¹ÍÐÙ…±Õ•ÌèÕ¹­¹½Ý¹mt€ômÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥tì(€€€½¹ÍÐ±…ÕÍ•Ì€ôlÌ¹½É…¹¥é…Ñ¥½¹}¥€ô€Äœ°€Ì¹‘•±•Ñ•‘}…Ð%L9U10tì(€€€¥˜€¡™¥±Ñ•ÉÌ¹ÍÑ…ÑÕÌ¤ì(€€€€€Ù…±Õ•Ì¹ÁÕÍ ¡MÑÉ¥¹œ¡™¥±Ñ•ÉÌ¹ÍÑ…ÑÕÌ¤¹Ñ½UÁÁ•É…Í” ¤¤ì(€€€€€±…ÕÍ•Ì¹ÁÕÍ ¡Ì¹ÍÑ…ÑÕÌ€ô€‘íÙ…±Õ•Ì¹±•¹Ñ¡õ€¤ì(€€€ô(€€€¥˜€¡™¥±Ñ•ÉÌ¹Í•…É ¤ì(€€€€€Ù…±Õ•Ì¹ÁÕÍ ¡€”‘íMÑÉ¥¹œ¡™¥±Ñ•ÉÌ¹Í•…É ¤¹ÑÉ¥´ ¤¹Ñ½1½Ý•É…Í” ¥ô•€¤ì(€€€€€±…ÕÍ•Ì¹ÁÕÍ ¡€ (€€€€€€€1=]H¡=1M¡Ì¹‘¥ÍÁ±…å}¹…µ”°€œœ¤¤1%-€‘íÙ…±Õ•Ì¹±•¹Ñ¡ô(€€€€€€€=H1=]H¡=1M¡Ì¹•µ…¥°°€œœ¤¤1%-€‘íÙ…±Õ•Ì¹±•¹Ñ¡ô(€€€€€€€=H1=]H¡=1M¡Ì¹Á¡½¹”°€œœ¤¤1%-€‘íÙ…±Õ•Ì¹±•¹Ñ¡ô(€€€€€€¥€¤ì(€€€ô(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1PÌ¸¨°(€€€€€€€€€€€€€=1M¡µ…¥¸¹Ñ½Ñ…±}ÕÍ°€À¤èé9U5I% ÄÐ°È¤LÑ½Ñ…±}É••¥Ù•‘}ÕÍ°(€€€€€€€€€€€€€=1M¡µ…¥¸¹Ñ½Ñ…±}‘˜°€À¤èé9U5I% ÄÐ°È¤LÑ½Ñ…±}É••¥Ù•‘}‘˜°(€€€€€€€€€€€€€=1M¡µ…¥¸¹Á…å½ÕÑ}½Õ¹Ð°€À¤èé%9PLÁ…å½ÕÑ}½Õ¹Ð(€€€€€€I=4Í¡…É•¡½±‘•ÉÌÌ(€€€€€€€€1P)=%8€ (€€€€€€€€€€M1PÍÁ°¹Í¡…É•¡½±‘•É}¥°(€€€€€€€€€€€€€€€€€MU4¡M]!8ÍÁˆ¹ÍÑ…ÑÕÌ€ô€Y1%Qœ9ÍÁ°¹ÕÉÉ•¹ä€ô€UMœQ!8ÍÁ°¹…µ½Õ¹Ð1M€À9¤LÑ½Ñ…±}ÕÍ°(€€€€€€€€€€€€€€€€€MU4¡M]!8ÍÁˆ¹ÍÑ…ÑÕÌ€ô€Y1%Qœ9ÍÁ°¹ÕÉÉ•¹ä€ô€œQ!8ÍÁ°¹…µ½Õ¹Ð1M€À9¤LÑ½Ñ…±}‘˜°(€€€€€€€€€€€€€€€€€=U9P ¨¤%1QH€¡]!IÍÁˆ¹ÍÑ…ÑÕÌ€ô€Y1%Qœ¤LÁ…å½ÕÑ}½Õ¹Ð(€€€€€€€€€€I=4Í¡…É•¡½±‘•É}Á…å½ÕÑ}±¥¹•ÌÍÁ°(€€€€€€€€€€)=%8Í¡…É•¡½±‘•É}Á…å½ÕÑ}‰…Ñ¡•ÌÍÁˆ=8ÍÁˆ¹¥€ôÍÁ°¹‰…Ñ¡}¥9ÍÁˆ¹½É…¹¥é…Ñ¥½¹}¥€ôÍÁ°¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€€€€€]!IÍÁ°¹½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€€€€€9ÍÁ°¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€€€€€9ÍÁˆ¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€€€I=U@	dÍÁ°¹Í¡…É•¡½±‘•É}¥(€€€€€€€€€¤µ…¥¸=8µ…¥¸¹Í¡…É•¡½±‘•É}¥€ôÌ¹¥(€€€€€€]!I€‘í±…ÕÍ•Ì¹©½¥¸ œ9€œ¥ô(€€€€€€=IH	dÌ¹‘¥ÍÁ±…å}¹…µ”M€°(€€€€€Ù…±Õ•Ì°(€€€€¤ì(€€€É•ÑÕÉ¸É½ÝÌì(€ô((€…Íå¹ŒÍ¡…É•¡½±‘•È¡¥è¹Õµ‰•È¤ì(€€€…Ý…¥ÐÑ¡¥Ì¹•¹ÍÕÉ•M¡…É•¡½±‘•ÉM¡•µ„ ¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1PÌ¸¨°(€€€€€€€€€€€€€=1M¡µ…¥¸¹Ñ½Ñ…±}ÕÍ°€À¤èé9U5I% ÄÐ°È¤LÑ½Ñ…±}É••¥Ù•‘}ÕÍ°(€€€€€€€€€€€€€=1M¡µ…¥¸¹Ñ½Ñ…±}‘˜°€À¤èé9U5I% ÄÐ°È¤LÑ½Ñ…±}É••¥Ù•‘}‘˜°(€€€€€€€€€€€€€=1M¡µ…¥¸¹Á…å½ÕÑ}½Õ¹Ð°€À¤èé%9PLÁ…å½ÕÑ}½Õ¹Ð(€€€€€€I=4Í¡…É•¡½±‘•ÉÌÌ(€€€€€€1P)=%8€ (€€€€€€€€M1PÍÁ°¹Í¡…É•¡½±‘•É}¥°(€€€€€€€€€€€€€€€MU4¡M]!8ÍÁˆ¹ÍÑ…ÑÕÌ€ô€Y1%Qœ9ÍÁ°¹ÕÉÉ•¹ä€ô€UMœQ!8ÍÁ°¹…µ½Õ¹Ð1M€À9¤LÑ½Ñ…±}ÕÍ°(€€€€€€€€€€€€€€€MU4¡M]!8ÍÁˆ¹ÍÑ…ÑÕÌ€ô€Y1%Qœ9ÍÁ°¹ÕÉÉ•¹ä€ô€œQ!8ÍÁ°¹…µ½Õ¹Ð1M€À9¤LÑ½Ñ…±}‘˜°(€€€€€€€€€€€€€€€=U9P ¨¤%1QH€¡]!IÍÁˆ¹ÍÑ…ÑÕÌ€ô€Y1%Qœ¤LÁ…å½ÕÑ}½Õ¹Ð(€€€€€€€€I=4Í¡…É•¡½±‘•É}Á…å½ÕÑ}±¥¹•ÌÍÁ°(€€€€€€€€)=%8Í¡…É•¡½±‘•É}Á…å½ÕÑ}‰…Ñ¡•ÌÍÁˆ=8ÍÁˆ¹¥€ôÍÁ°¹‰…Ñ¡}¥9ÍÁˆ¹½É…¹¥é…Ñ¥½¹}¥€ôÍÁ°¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€€€]!IÍÁ°¹½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€€€9ÍÁ°¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€€€9ÍÁˆ¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€I=U@	dÍÁ°¹Í¡…É•¡½±‘•É}¥(€€€€€€€¤µ…¥¸=8µ…¥¸¹Í¡…É•¡½±‘•É}¥€ôÌ¹¥(€€€€€€]!IÌ¹¥€ô€È(€€€€€€€€9Ì¹½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€9Ì¹‘•±•Ñ•‘}…Ð%L9U11€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°¥‘t°(€€€€¤ì(€€€É•ÑÕÉ¸É•ÅÕ¥É•I½Ü¡É½ÝÍlÁt°€M¡…É•¡½±‘•Èœ¤ì(€ô((€…Íå¹ŒÍ¡…É•¡½±‘•É!¥ÍÑ½Éä¡¥è¹Õµ‰•È¤ì(€€€…Ý…¥ÐÑ¡¥Ì¹•¹ÍÕÉ•M¡…É•¡½±‘•ÉM¡•µ„ ¤ì(€€€…Ý…¥ÐÑ¡¥Ì¹Í¡…É•¡½±‘•È¡¥¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1PÍÁ°¹¥°(€€€€€€€€€€€€€ÍÁ°¹…µ½Õ¹Ð°(€€€€€€€€€€€€€ÍÁ°¹ÕÉÉ•¹ä°(€€€€€€€€€€€€€ÍÁ°¹Á…åµ•¹Ñ}µ•Ñ¡½°(€€€€€€€€€€€€€ÍÁ°¹É•™•É•¹”°(€€€€€€€€€€€€€ÍÁ°¹¹½Ñ•Ì°(€€€€€€€€€€€€€ÍÁ°¹É••¥ÁÑ}¹Õµ‰•È°(€€€€€€€€€€€€€ÍÁ°¹…Í¡}µ½Ù•µ•¹Ñ}¥°(€€€€€€€€€€€€€ÍÁ°¹Õ…É…¹Ñ••}…Í¡}µ½Ù•µ•¹Ñ}¥°(€€€€€€€€€€€€€ÍÁ°¹É•…Ñ•‘}…Ð°(€€€€€€€€€€€€€ÍÁˆ¹¥L‰…Ñ¡}¥°(€€€€€€€€€€€€€ÍÁˆ¹É•™•É•¹”L‰…Ñ¡}É•™•É•¹”°(€€€€€€€€€€€€€ÍÁˆ¹Á…å½ÕÑ}‘…Ñ”°(€€€€€€€€€€€€€ÍÁˆ¹Í½ÕÉ•}É•¥ÍÑ•È°(€€€€€€€€€€€€€ÍÁˆ¹½Á•É…Ñ¥½¹}ÑåÁ”°(€€€€€€€€€€€€€ÍÁˆ¹É•…Í½¸°(€€€€€€€€€€€€€=1M¡9U11%¡QI%4¡=9P¡=1M¡Ô¹™¥ÉÍÑ}¹…µ”°€œœ¤°€œ€œ°=1M¡Ô¹±…ÍÑ}¹…µ”°€œœ¤¤¤°€œœ¤°Ô¹•µ…¥°¤LÉ•…Ñ•‘}‰å}¹…µ”(€€€€€€I=4Í¡…É•¡½±‘•É}Á…å½ÕÑ}±¥¹•ÌÍÁ°(€€€€€€)=%8Í¡…É•¡½±‘•É}Á…å½ÕÑ}‰…Ñ¡•ÌÍÁˆ=8ÍÁˆ¹¥€ôÍÁ°¹‰…Ñ¡}¥9ÍÁˆ¹½É…¹¥é…Ñ¥½¹}¥€ôÍÁ°¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€1P)=%8…ÁÁ}ÕÍ•ÉÌÔ=8Ô¹¥€ôÍÁˆ¹É•…Ñ•‘}‰ä(€€€€€€]!IÍÁ°¹½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€9ÍÁ°¹Í¡…É•¡½±‘•É}¥€ô€È(€€€€€€€€9ÍÁ°¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€9ÍÁˆ¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€=IH	dÍÁˆ¹Á…å½ÕÑ}‘…Ñ”M°ÍÁ°¹¥M€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°¥‘t°(€€€€¤ì(€€€É•ÑÕÉ¸É½ÝÌì(€ô((€…Íå¹ŒÉ•…Ñ•M¡…É•¡½±‘•È¡‰½‘äèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø¤ì(€€€…Ý…¥ÐÑ¡¥Ì¹•¹ÍÕÉ•M¡…É•¡½±‘•ÉM¡•µ„ ¤ì(€€€½¹ÍÐÁ…å±½…€ôÑ¡¥Ì¹¹½Éµ…±¥é•M¡…É•¡½±‘•ÉA…å±½…¡‰½‘ä¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€%9MIP%9Q<Í¡…É•¡½±‘•ÉÌ(€€€€€€€€¡½É…¹¥é…Ñ¥½¹}¥°Í¡…É•¡½±‘•É}ÑåÁ”°‘¥ÍÁ±…å}¹…µ”°™¥ÉÍÑ}¹…µ”°±…ÍÑ}¹…µ”°½µÁ…¹å}¹…µ”°Á¡½¹”°•µ…¥°°(€€€€€€€€¥‘•¹Ñ¥Ñå}¹Õµ‰•È°…‘‘É•ÍÌ°½Ý¹•ÉÍ¡¥Á}Á•É•¹Ñ…”°¹½Ñ•Ì°ÍÑ…ÑÕÌ°É•…Ñ•‘}‰ä¤(€€€€€€Y1UL(€€€€€€€€ Ä°€È°€Ì°€Ð°€Ô°€Ø°€Ü°€à°(€€€€€€€€€ä°€ÄÀ°€ÄÄ°€ÄÈ°€ÄÌ°€ÄÐ¤(€€€€€€IQUI9%9€©€°(€€€€€l(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°(€€€€€€€Á…å±½…¹Í¡…É•¡½±‘•É}ÑåÁ”°(€€€€€€€Á…å±½…¹‘¥ÍÁ±…å}¹…µ”°(€€€€€€€Á…å±½…¹™¥ÉÍÑ}¹…µ”°(€€€€€€€Á…å±½…¹±…ÍÑ}¹…µ”°(€€€€€€€Á…å±½…¹½µÁ…¹å}¹…µ”°(€€€€€€€Á…å±½…¹Á¡½¹”°(€€€€€€€Á…å±½…¹•µ…¥°°(€€€€€€€Á…å±½…¹¥‘•¹Ñ¥Ñå}¹Õµ‰•È°(€€€€€€€Á…å±½…¹…‘‘É•ÍÌ°(€€€€€€€Á…å±½…¹½Ý¹•ÉÍ¡¥Á}Á•É•¹Ñ…”°(€€€€€€€Á…å±½…¹¹½Ñ•Ì°(€€€€€€€Á…å±½…¹ÍÑ…ÑÕÌ°(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•É% ¤€üü¹Õ±°°(€€€€€t°(€€€€¤ì(€€€½¹ÍÐÍ¡…É•¡½±‘•È€ôÉ•ÅÕ¥É•I½Ü¡É½ÝÍlÁt°€M¡…É•¡½±‘•Èœ¤ì(€€€…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€%9MIP%9Q<…Õ‘¥Ñ}±½Ì€¡½É…¹¥é…Ñ¥½¹}¥°ÕÍ•É}¥°…Ñ¥½¸°É•Í½ÕÉ”°É•Í½ÕÉ•}¥°µ•Ñ¡½°Á…Ñ °ÍÑ…ÑÕÍ}½‘”°µ•Ñ…‘…Ñ„¤(€€€€€€Y1UL€ Ä°€È°€M!I!=1I}IQœ°€Í¡…É•¡½±‘•ÉÌœ°€Ì°€A=MPœ°€œ½…Á¤½Í¡…É•¡½±‘•ÉÌœ°€ÈÀÄ°€Ðèé)M=9¥€°(€€€€€l(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•É% ¤€üü¹Õ±°°(€€€€€€€MÑÉ¥¹œ¡Í¡…É•¡½±‘•È¹¥¤°(€€€€€€€)M=8¹ÍÑÉ¥¹¥™ä¡ì(€€€€€€€€€Í¡…É•¡½±‘•É}¥èÍ¡…É•¡½±‘•È¹¥°(€€€€€€€€€Í¡…É•¡½±‘•É}ÑåÁ”èÍ¡…É•¡½±‘•È¹Í¡…É•¡½±‘•É}ÑåÁ”°(€€€€€€€€€‘¥ÍÁ±…å}¹…µ”èÍ¡…É•¡½±‘•È¹‘¥ÍÁ±…å}¹…µ”°(€€€€€€€€€ÍÑ…ÑÕÌèÍ¡…É•¡½±‘•È¹ÍÑ…ÑÕÌ°(€€€€€€€ô¤°(€€€€€t°(€€€€¤ì(€€€É•ÑÕÉ¸Í¡…É•¡½±‘•Èì(€ô((€…Íå¹ŒÕÁ‘…Ñ•M¡…É•¡½±‘•È¡¥è¹Õµ‰•È°‰½‘äèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø¤ì(€€€…Ý…¥ÐÑ¡¥Ì¹•¹ÍÕÉ•M¡…É•¡½±‘•ÉM¡•µ„ ¤ì(€€€…Ý…¥ÐÑ¡¥Ì¹Í¡…É•¡½±‘•È¡¥¤ì(€€€½¹ÍÐÁ…å±½…€ôÑ¡¥Ì¹¹½Éµ…±¥é•M¡…É•¡½±‘•ÉA…å±½…¡‰½‘ä¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€UAQÍ¡…É•¡½±‘•ÉÌ(€€€€€€MPÍ¡…É•¡½±‘•É}ÑåÁ”€ô€Ì°(€€€€€€€€€€‘¥ÍÁ±…å}¹…µ”€ô€Ð°(€€€€€€€€€€™¥ÉÍÑ}¹…µ”€ô€Ô°(€€€€€€€€€€±…ÍÑ}¹…µ”€ô€Ø°(€€€€€€€€€€½µÁ…¹å}¹…µ”€ô€Ü°(€€€€€€€€€€Á¡½¹”€ô€à°(€€€€€€€€€€•µ…¥°€ô€ä°(€€€€€€€€€€¥‘•¹Ñ¥Ñå}¹Õµ‰•È€ô€ÄÀ°(€€€€€€€€€€…‘‘É•ÍÌ€ô€ÄÄ°(€€€€€€€€€€½Ý¹•ÉÍ¡¥Á}Á•É•¹Ñ…”€ô€ÄÈ°(€€€€€€€€€€¹½Ñ•Ì€ô€ÄÌ°(€€€€€€€€€€ÍÑ…ÑÕÌ€ô€ÄÐ°(€€€€€€€€€€…É¡¥Ù•‘}…Ð€ôM]!8€ÄÐèéYI!H ÈÀ¤€ô€I!%YœQ!8=1M¡…É¡¥Ù•‘}…Ð°9=\ ¤¤1M9U109°(€€€€€€€€€€ÕÁ‘…Ñ•‘}…Ð€ô9=\ ¤(€€€€€€]!I¥€ô€È(€€€€€€€€9½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U10(€€€€€€IQUI9%9€©€°(€€€€€l(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°(€€€€€€€¥°(€€€€€€€Á…å±½…¹Í¡…É•¡½±‘•É}ÑåÁ”°(€€€€€€€Á…å±½…¹‘¥ÍÁ±…å}¹…µ”°(€€€€€€€Á…å±½…¹™¥ÉÍÑ}¹…µ”°(€€€€€€€Á…å±½…¹±…ÍÑ}¹…µ”°(€€€€€€€Á…å±½…¹½µÁ…¹å}¹…µ”°(€€€€€€€Á…å±½…¹Á¡½¹”°(€€€€€€€Á…å±½…¹•µ…¥°°(€€€€€€€Á…å±½…¹¥‘•¹Ñ¥Ñå}¹Õµ‰•È°(€€€€€€€Á…å±½…¹…‘‘É•ÍÌ°(€€€€€€€Á…å±½…¹½Ý¹•ÉÍ¡¥Á}Á•É•¹Ñ…”°(€€€€€€€Á…å±½…¹¹½Ñ•Ì°(€€€€€€€Á…å±½…¹ÍÑ…ÑÕÌ°(€€€€€t°(€€€€¤ì(€€€½¹ÍÐÍ¡…É•¡½±‘•È€ôÉ•ÅÕ¥É•I½Ü¡É½ÝÍlÁt°€M¡…É•¡½±‘•Èœ¤ì(€€€…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€%9MIP%9Q<…Õ‘¥Ñ}±½Ì€¡½É…¹¥é…Ñ¥½¹}¥°ÕÍ•É}¥°…Ñ¥½¸°É•Í½ÕÉ”°É•Í½ÕÉ•}¥°µ•Ñ¡½°Á…Ñ °ÍÑ…ÑÕÍ}½‘”°µ•Ñ…‘…Ñ„¤(€€€€€€Y1UL€ Ä°€È°€M!I!=1I}UAQœ°€Í¡…É•¡½±‘•ÉÌœ°€Ì°€AQ œ°€Ð°€ÈÀÀ°€Ôèé)M=9¥€°(€€€€€l(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•É% ¤€üü¹Õ±°°(€€€€€€€MÑÉ¥¹œ¡Í¡…É•¡½±‘•È¹¥¤°(€€€€€€€€½…Á¤½Í¡…É•¡½±‘•ÉÌ¼‘íÍ¡…É•¡½±‘•È¹¥‘õ€°(€€€€€€€)M=8¹ÍÑÉ¥¹¥™ä¡ì(€€€€€€€€€Í¡…É•¡½±‘•É}¥èÍ¡…É•¡½±‘•È¹¥°(€€€€€€€€€Í¡…É•¡½±‘•É}ÑåÁ”èÍ¡…É•¡½±‘•È¹Í¡…É•¡½±‘•É}ÑåÁ”°(€€€€€€€€€‘¥ÍÁ±…å}¹…µ”èÍ¡…É•¡½±‘•È¹‘¥ÍÁ±…å}¹…µ”°(€€€€€€€€€ÍÑ…ÑÕÌèÍ¡…É•¡½±‘•È¹ÍÑ…ÑÕÌ°(€€€€€€€ô¤°(€€€€€t°(€€€€¤ì(€€€É•ÑÕÉ¸Í¡…É•¡½±‘•Èì(€ô((€…Íå¹ŒÍ¡…É•¡½±‘•ÉA…å½ÕÑ½Éµ…Ñ„¡Í½ÕÉ•I•¥ÍÑ•Èè€5%9}M œð€UI9Q}M œð€	9,œ¤ì(€€€…Ý…¥ÐÑ¡¥Ì¹•¹ÍÕÉ•M¡…É•¡½±‘•ÉM¡•µ„ ¤ì(€€€Ñ¡¥Ì¹…ÍÍ•ÉÑM¡…É•¡½±‘•ÉA…å½ÕÑA•Éµ¥ÍÍ¥½¸¡Í½ÕÉ•I•¥ÍÑ•È¤ì(€€€¥˜€¡Í½ÕÉ•I•¥ÍÑ•È€ôôô€	9,œ¤ì(€€€€€…Ý…¥ÐÑ¡¥Ì¹•¹ÍÕÉ•	…¹­M¡•µ„ ¤ì(€€€ô(€€€½¹ÍÐÍ¡…É•¡½±‘•ÉÌ€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1P¥°‘¥ÍÁ±…å}¹…µ”°Í¡…É•¡½±‘•É}ÑåÁ”°Á¡½¹”°•µ…¥°(€€€€€€I=4Í¡…É•¡½±‘•ÉÌ(€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€9ÍÑ…ÑÕÌ€ô€Q%Yœ(€€€€€=IH	d‘¥ÍÁ±…å}¹…µ•€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€½¹ÍÐ‰…¹­½Õ¹ÑÌ€ôÍ½ÕÉ•I•¥ÍÑ•È€ôôô€	9,œ(€€€€€€ü…Ý…¥ÐÑ¡¥Ì¹Í¡…É•¡½±‘•É	…¹­½Õ¹ÑÌ ¤(€€€€€€èmtì(€€€½¹ÍÐ‰…±…¹•Ì€ôÍ½ÕÉ•I•¥ÍÑ•È€ôôô€5%9}M œ(€€€€€€ü…Ý…¥ÐÑ¡¥Ì¹Í¡…É•¡½±‘•É5…¥¹…Í¡	…±…¹•Ì ¤(€€€€€€èÍ½ÕÉ•I•¥ÍÑ•È€ôôô€UI9Q}M œ(€€€€€€€€ü…Ý…¥ÐÑ¡¥Ì¹Í¡…É•¡½±‘•ÉÕ…É…¹Ñ••…Í¡	…±…¹•Ì ¤(€€€€€€€€èÑ¡¥Ì¹Í¡…É•¡½±‘•É	…¹­	…±…¹•Ì¡‰…¹­½Õ¹ÑÌ¤ì(€€€É•ÑÕÉ¸ì(€€€€€Í½ÕÉ•}É•¥ÍÑ•ÈèÍ½ÕÉ•I•¥ÍÑ•È°(€€€€€Í¡…É•¡½±‘•ÉÌèÍ¡…É•¡½±‘•ÉÌ¹É½ÝÌ°(€€€€€‰…±…¹•Ì°(€€€€€‰…¹­}…½Õ¹ÑÌè‰…¹­½Õ¹ÑÌ°(€€€€€Á…åµ•¹Ñ}µ•Ñ¡½‘Ìèl(€€€€€€€ìÙ…±Õ”è€M œ°±…‰•°è€ÍÃ¡•Ìœô°(€€€€€€€ìÙ…±Õ”è€	9,œ°±…‰•°è€	…¹ÅÕ”œô°(€€€€€€€ìÙ…±Õ”è€5=	%1}5=9dœ°±…‰•°è€5½‰¥±”5½¹•äœô°(€€€€€t°(€€€€€½Á•É…Ñ¥½¹}ÑåÁ•Ìèl(€€€€€€€ìÙ…±Õ”è€M!I!=1I}IAe59Pœ°±…‰•°è€I•µ‰½ÕÉÍ•µ•¹Ð…Ñ¥½¹¹…¥É”œô°(€€€€€€€ìÙ…±Õ”è€M!I!=1I}UII9Q}=U9Pœ°±…‰•°è€½µÁÑ”½ÕÉ…¹Ð…Ñ¥½¹¹…¥É”œô°(€€€€€€€ìÙ…±Õ”è€%MQI%	UQ%=8œ°±…‰•°è€¥ÍÑÉ¥‰ÕÑ¥½¸œô°(€€€€€€€ìÙ…±Õ”è€Y9œ°±…‰•°è€Ù…¹”œô°(€€€€€€€ìÙ…±Õ”è€=Q!Hœ°±…‰•°è€ÕÑÉ”œô°(€€€€€t°(€€€ôì(€ô((€…Íå¹ŒÉ•…Ñ•M¡…É•¡½±‘•ÉA…å½ÕÐ¡Í½ÕÉ•I•¥ÍÑ•Èè€5%9}M œð€UI9Q}M œð€	9,œ°‰½‘äèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø¤ì(€€€…Ý…¥ÐÑ¡¥Ì¹•¹ÍÕÉ•M¡…É•¡½±‘•ÉM¡•µ„ ¤ì(€€€Ñ¡¥Ì¹…ÍÍ•ÉÑM¡…É•¡½±‘•ÉA…å½ÕÑA•Éµ¥ÍÍ¥½¸¡Í½ÕÉ•I•¥ÍÑ•È¤ì(€€€É•ÑÕÉ¸Ñ¡¥Ì¹‘ˆ¹ÑÉ…¹Í…Ñ¥½¸¡…Íå¹Œ€¡±¥•¹Ð¤€ôøÑ¡¥Ì¹É•…Ñ•M¡…É•¡½±‘•ÉA…å½ÕÑ%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹Ð°Í½ÕÉ•I•¥ÍÑ•È°‰½‘ä¤¤ì(€ô((€…Íå¹ŒÍ¡…É•¡½±‘•ÉA…å½ÕÑ	…Ñ ¡¥è¹Õµ‰•È¤ì(€€€…Ý…¥ÐÑ¡¥Ì¹•¹ÍÕÉ•M¡…É•¡½±‘•ÉM¡•µ„ ¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1PÍÁˆ¸¨°(€€€€€€€€€€€€€¼¹¹…µ”L½É…¹¥é…Ñ¥½¹}¹…µ”°(€€€€€€€€€€€€€‰„¹‰…¹­}¹…µ”°(€€€€€€€€€€€€€‰„¹…½Õ¹Ñ}¹…µ”L‰…¹­}…½Õ¹Ñ}¹…µ”°(€€€€€€€€€€€€€‰„¹…½Õ¹Ñ}¹Õµ‰•ÈL‰…¹­}…½Õ¹Ñ}¹Õµ‰•È°(€€€€€€€€€€€€€‰„¹ÕÉÉ•¹äL‰…¹­}…½Õ¹Ñ}ÕÉÉ•¹ä°(€€€€€€€€€€€€€=1M¡9U11%¡QI%4¡=9P¡=1M¡Ô¹™¥ÉÍÑ}¹…µ”°€œœ¤°€œ€œ°=1M¡Ô¹±…ÍÑ}¹…µ”°€œœ¤¤¤°€œœ¤°Ô¹•µ…¥°¤LÉ•…Ñ•‘}‰å}¹…µ”(€€€€€€I=4Í¡…É•¡½±‘•É}Á…å½ÕÑ}‰…Ñ¡•ÌÍÁˆ(€€€€€€)=%8½É…¹¥é…Ñ¥½¹Ì¼=8¼¹¥€ôÍÁˆ¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€1P)=%8…ÁÁ}ÕÍ•ÉÌÔ=8Ô¹¥€ôÍÁˆ¹É•…Ñ•‘}‰ä(€€€€€€1P)=%8‰…¹­}…½Õ¹ÑÌ‰„=8‰„¹¥€ôÍÁˆ¹‰…¹­}…½Õ¹Ñ}¥9‰„¹½É…¹¥é…Ñ¥½¹}¥€ôÍÁˆ¹½É…¹¥é…Ñ¥½¹}¥9‰„¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€]!IÍÁˆ¹½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€9ÍÁˆ¹¥€ô€É€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°¥‘t°(€€€€¤ì(€€€½¹ÍÐ‰…Ñ €ôÉ•ÅÕ¥É•I½Ü¡É½ÝÍlÁt°€M¡…É•¡½±‘•ÈÁ…å½ÕÐ‰…Ñ œ¤ì(€€€½¹ÍÐ±¥¹•Ì€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1PÍÁ°¸¨°(€€€€€€€€€€€€€Ì¹‘¥ÍÁ±…å}¹…µ”LÍ¡…É•¡½±‘•É}¹…µ”°(€€€€€€€€€€€€€Ì¹Í¡…É•¡½±‘•É}ÑåÁ”°(€€€€€€€€€€€€€´¹Á¥••}¹Õµ‰•ÈL…Í¡}Á¥••}¹Õµ‰•È°(€€€€€€€€€€€€€‰Ð¹¥L‰…¹­}ÑÉ…¹Í…Ñ¥½¹}¥°(€€€€€€€€€€€€€‰Ð¹ÑÉ…¹Í…Ñ¥½¹}¹Õµ‰•ÈL‰…¹­}ÑÉ…¹Í…Ñ¥½¹}¹Õµ‰•È°(€€€€€€€€€€€€€‰Ð¹É•™•É•¹”L‰…¹­}É•™•É•¹”°(€€€€€€€€€€€€€‰Ð¹‰…¹­}…½Õ¹Ñ}¥°(€€€€€€€€€€€€€‰„¹‰…¹­}¹…µ”°(€€€€€€€€€€€€€‰„¹…½Õ¹Ñ}¹…µ”L‰…¹­}…½Õ¹Ñ}¹…µ”°(€€€€€€€€€€€€€‰„¹…½Õ¹Ñ}¹Õµ‰•ÈL‰…¹­}…½Õ¹Ñ}¹Õµ‰•È(€€€€€€I=4Í¡…É•¡½±‘•É}Á…å½ÕÑ}±¥¹•ÌÍÁ°(€€€€€€)=%8Í¡…É•¡½±‘•ÉÌÌ=8Ì¹¥€ôÍÁ°¹Í¡…É•¡½±‘•É}¥9Ì¹½É…¹¥é…Ñ¥½¹}¥€ôÍÁ°¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€1P)=%8…Í¡}µ½Ù•µ•¹ÑÌ´=8´¹¥€ôÍÁ°¹…Í¡}µ½Ù•µ•¹Ñ}¥9´¹½É…¹¥é…Ñ¥½¹}¥€ôÍÁ°¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€1P)=%8‰…¹­}ÑÉ…¹Í…Ñ¥½¹Ì‰Ð=8‰Ð¹¥€ôÍÁ°¹‰…¹­}ÑÉ…¹Í…Ñ¥½¹}¥9‰Ð¹½É…¹¥é…Ñ¥½¹}¥€ôÍÁ°¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€1P)=%8‰…¹­}…½Õ¹ÑÌ‰„=8‰„¹¥€ô‰Ð¹‰…¹­}…½Õ¹Ñ}¥9‰„¹½É…¹¥é…Ñ¥½¹}¥€ô‰Ð¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€]!IÍÁ°¹½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€9ÍÁ°¹‰…Ñ¡}¥€ô€È(€€€€€€€€9ÍÁ°¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€=IH	dÌ¹‘¥ÍÁ±…å}¹…µ”°ÍÁ°¹¥‘€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°¥‘t°(€€€€¤ì(€€€É•ÑÕÉ¸ì€¸¸¹‰…Ñ °±¥¹•Ìè±¥¹•Ì¹É½ÝÌôì(€ô((€…Íå¹ŒÍ¡…É•¡½±‘•ÉA…å½ÕÑ1¥¹•I••¥ÁÐ¡¥è¹Õµ‰•È¤ì(€€€…Ý…¥ÐÑ¡¥Ì¹•¹ÍÕÉ•M¡…É•¡½±‘•ÉM¡•µ„ ¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1PÍÁ°¸¨°(€€€€€€€€€€€€€ÍÁˆ¹É•™•É•¹”L‰…Ñ¡}É•™•É•¹”°(€€€€€€€€€€€€€ÍÁˆ¹Í½ÕÉ•}É•¥ÍÑ•È°(€€€€€€€€€€€€€ÍÁˆ¹½Á•É…Ñ¥½¹}ÑåÁ”°(€€€€€€€€€€€€€ÍÁˆ¹É•…Í½¸°(€€€€€€€€€€€€€ÍÁˆ¹¹½Ñ•ÌL‰…Ñ¡}¹½Ñ•Ì°(€€€€€€€€€€€€€ÍÁˆ¹Á…å½ÕÑ}‘…Ñ”°(€€€€€€€€€€€€€ÍÁˆ¹‰…¹­}…½Õ¹Ñ}¥°(€€€€€€€€€€€€€¼¹¹…µ”L½É…¹¥é…Ñ¥½¹}¹…µ”°(€€€€€€€€€€€€€‰„¹‰…¹­}¹…µ”°(€€€€€€€€€€€€€‰„¹…½Õ¹Ñ}¹…µ”L‰…¹­}…½Õ¹Ñ}¹…µ”°(€€€€€€€€€€€€€‰„¹…½Õ¹Ñ}¹Õµ‰•ÈL‰…¹­}…½Õ¹Ñ}¹Õµ‰•È°(€€€€€€€€€€€€€‰„¹ÕÉÉ•¹äL‰…¹­}…½Õ¹Ñ}ÕÉÉ•¹ä°(€€€€€€€€€€€€€Ì¹‘¥ÍÁ±…å}¹…µ”LÍ¡…É•¡½±‘•É}¹…µ”°(€€€€€€€€€€€€€Ì¹Í¡…É•¡½±‘•É}ÑåÁ”°(€€€€€€€€€€€€€=1M¡9U11%¡QI%4¡=9P¡=1M¡Ô¹™¥ÉÍÑ}¹…µ”°€œœ¤°€œ€œ°=1M¡Ô¹±…ÍÑ}¹…µ”°€œœ¤¤¤°€œœ¤°Ô¹•µ…¥°¤LÉ•…Ñ•‘}‰å}¹…µ”°(€€€€€€€€€€€€€´¹Á¥••}¹Õµ‰•ÈL…Í¡}Á¥••}¹Õµ‰•È°(€€€€€€€€€€€€€‰Ð¹¥L‰…¹­}ÑÉ…¹Í…Ñ¥½¹}¥°(€€€€€€€€€€€€€‰Ð¹ÑÉ…¹Í…Ñ¥½¹}¹Õµ‰•ÈL‰…¹­}ÑÉ…¹Í…Ñ¥½¹}¹Õµ‰•È°(€€€€€€€€€€€€€‰Ð¹É•™•É•¹”L‰…¹­}É•™•É•¹”(€€€€€€I=4Í¡…É•¡½±‘•É}Á…å½ÕÑ}±¥¹•ÌÍÁ°(€€€€€€)=%8Í¡…É•¡½±‘•É}Á…å½ÕÑ}‰…Ñ¡•ÌÍÁˆ=8ÍÁˆ¹¥€ôÍÁ°¹‰…Ñ¡}¥9ÍÁˆ¹½É…¹¥é…Ñ¥½¹}¥€ôÍÁ°¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€)=%8½É…¹¥é…Ñ¥½¹Ì¼=8¼¹¥€ôÍÁ°¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€)=%8Í¡…É•¡½±‘•ÉÌÌ=8Ì¹¥€ôÍÁ°¹Í¡…É•¡½±‘•É}¥9Ì¹½É…¹¥é…Ñ¥½¹}¥€ôÍÁ°¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€1P)=%8…ÁÁ}ÕÍ•ÉÌÔ=8Ô¹¥€ôÍÁˆ¹É•…Ñ•‘}‰ä(€€€€€€1P)=%8…Í¡}µ½Ù•µ•¹ÑÌ´=8´¹¥€ôÍÁ°¹…Í¡}µ½Ù•µ•¹Ñ}¥9´¹½É…¹¥é…Ñ¥½¹}¥€ôÍÁ°¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€1P)=%8‰…¹­}ÑÉ…¹Í…Ñ¥½¹Ì‰Ð=8‰Ð¹¥€ôÍÁ°¹‰…¹­}ÑÉ…¹Í…Ñ¥½¹}¥9‰Ð¹½É…¹¥é…Ñ¥½¹}¥€ôÍÁ°¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€1P)=%8‰…¹­}…½Õ¹ÑÌ‰„=8‰„¹¥€ô‰Ð¹‰…¹­}…½Õ¹Ñ}¥9‰„¹½É…¹¥é…Ñ¥½¹}¥€ô‰Ð¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€]!IÍÁ°¹½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€9ÍÁ°¹¥€ô€É€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°¥‘t°(€€€€¤ì(€€€É•ÑÕÉ¸É•ÅÕ¥É•I½Ü¡É½ÝÍlÁt°€M¡…É•¡½±‘•ÈÁ…å½ÕÐÉ••¥ÁÐœ¤ì(€ô((€…Íå¹ŒÁ…å1•…Í•Õ…É…¹Ñ•”¡¥è¹Õµ‰•È°‰½‘äèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø¤ì(€€€É•ÑÕÉ¸Ñ¡¥Ì¹‘ˆ¹ÑÉ…¹Í…Ñ¥½¸¡…Íå¹Œ€¡±¥•¹Ð¤€ôøì(€€€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä M1PÁ}…‘Ù¥Í½Éå}á…Ñ}±½¬¡¡…Í¡Ñ•áÐ Ä¤¤œ°m±•…Í”µÕ…É…¹Ñ•”µÁ…åµ•¹Ð´‘íÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥ô´‘í¥‘õt¤ì(€€€€€½¹ÍÐ±•…Í”€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€M1P°¸¨°(€€€€€€€€€€€€€€€M]!8Ð¹Ñ•¹…¹Ñ}ÑåÁ”€ô€=5A9dœQ!8=1M¡Ð¹½µÁ…¹å}¹…µ”°€œœ¤(€€€€€€€€€€€€€€€€€€€€1MQI%4¡=9P¡=1M¡Ð¹™¥ÉÍÑ}¹…µ”°€œœ¤°€œ€œ°=1M¡Ð¹±…ÍÑ}¹…µ”°€œœ¤°€œ€œ°=1M¡Ð¹Á½ÍÑ}¹…µ”°€œœ¤¤¤(€€€€€€€€€€€€€€€9LÑ•¹…¹Ñ}¹…µ”°(€€€€€€€€€€€€€€€Ô¹¹Õµ‰•ÈLÕ¹¥Ñ}¹Õµ‰•È°(€€€€€€€€€€€€€€€°¹±•…Í•}¹Õµ‰•È(€€€€€€€€I=4±•…Í•Ì°(€€€€€€€€1P)=%8Ñ•¹…¹ÑÌÐ=8Ð¹¥€ô°¹Ñ•¹…¹Ñ}¥9Ð¹½É…¹¥é…Ñ¥½¹}¥€ô°¹½É…¹¥é…Ñ¥½¹}¥9Ð¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€1P)=%8Õ¹¥ÑÌÔ=8Ô¹¥€ô°¹Õ¹¥Ñ}¥9Ô¹½É…¹¥é…Ñ¥½¹}¥€ô°¹½É…¹¥é…Ñ¥½¹}¥9Ô¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€]!I°¹¥€ô€Ä9°¹½É…¹¥é…Ñ¥½¹}¥€ô€È9°¹‘•±•Ñ•‘}…Ð%L9U11€°(€€€€€€€m¥°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€€€¤ì(€€€€€½¹ÍÐÉ½Ü€ôÉ•ÅÕ¥É•I½Ü¡±•…Í”¹É½ÝÍlÁt°€1•…Í”œ¤ì(€€€€€½¹ÍÐ•á¡…¹•I…Ñ”€ô…Ý…¥ÐÑ¡¥Ì¹•á¡…¹•I…Ñ” ¤ì(€€€€€½¹ÍÐÁ…åµ•¹ÑÕÉÉ•¹ä€ôMÑÉ¥¹œ¡‰½‘ä¹Á…åµ•¹Ñ}ÕÉÉ•¹ä€üü€UMœ¤¹Ñ½UÁÁ•É…Í” ¤ì(€€€€€½¹ÍÐ…µ½Õ¹ÑUÍ€ô9Õµ‰•È¡‰½‘ä¹…µ½Õ¹Ñ}ÕÍ€üü€¡Á…åµ•¹ÑÕÉÉ•¹ä€ôôô€UMœ€ü‰½‘ä¹…µ½Õ¹Ð€è€À¤¤ñð€Àì(€€€€€½¹ÍÐ…µ½Õ¹Ñ‘˜€ô9Õµ‰•È¡‰½‘ä¹…µ½Õ¹Ñ}‘˜€üü€À¤ñð€Àì(€€€€€½¹ÍÐ•á¡…¹•I…Ñ•UÍ•€ô9Õµ‰•È¡‰½‘ä¹•á¡…¹•}É…Ñ•}ÕÍ•€üü•á¡…¹•I…Ñ”ü¹É…Ñ”€üü€À¤ñð¹Õ±°ì(€€€€€½¹ÍÐ•á¡…¹•I…Ñ•…Ñ”€ô‰½‘ä¹•á¡…¹•}É…Ñ•}‘…Ñ”€üü•á¡…¹•I…Ñ”ü¹•™™•Ñ¥Ù•…Ñ”€üü¹Õ±°ì(€€€€€¥˜€ …lUMœ°€œ°€5%at¹¥¹±Õ‘•Ì¡Á…åµ•¹ÑÕÉÉ•¹ä¤¤ì(€€€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ •Ù¥Í”‘”Á…¥•µ•¹Ð¥¹Ù…±¥‘”¸œ¤ì(€€€€€ô(€€€€€¥˜€ …9Õµ‰•È¹¥Í¥¹¥Ñ”¡…µ½Õ¹ÑUÍ¤ñð…µ½Õ¹ÑUÍ€ð€Àñð€…9Õµ‰•È¹¥Í¥¹¥Ñ”¡…µ½Õ¹Ñ‘˜¤ñð…µ½Õ¹Ñ‘˜€ð€À¤ì(€€€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 5½¹Ñ…¹Ð‘”Á…¥•µ•¹Ð¥¹Ù…±¥‘”¸œ¤ì(€€€€€ô(€€€€€¥˜€¡…µ½Õ¹ÑUÍ€ðô€À€˜˜…µ½Õ¹Ñ‘˜€ðô€À¤ì(€€€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1”µ½¹Ñ…¹Ð‘”±„…É…¹Ñ¥”‘½¥Ð•ÑÉ”ÍÕÁ•É¥•ÕÈ„€À¸œ¤ì(€€€€€ô(€€€€€¥˜€ ¡Á…åµ•¹ÑÕÉÉ•¹ä€ôôô€œñðÁ…åµ•¹ÑÕÉÉ•¹ä€ôôô€5%aœñð…µ½Õ¹Ñ‘˜€ø€À¤€˜˜€ …•á¡…¹•I…Ñ•UÍ•ñð•á¡…¹•I…Ñ•UÍ•€ðô€À¤¤ì(€€€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ U¸Ñ…Õà‘”¡…¹”•ÍÐÉ•ÅÕ¥ÌÁ½ÕÈÕ¸Á…¥•µ•¹Ð‘”…É…¹Ñ¥”•¸¸œ¤ì(€€€€€ô(€€€€€½¹ÍÐÁ…åµ•¹Ñ5•Ñ¡½‘UÍ€ôMÑÉ¥¹œ¡‰½‘ä¹Á…åµ•¹Ñ}µ•Ñ¡½‘}ÕÍ€üü‰½‘ä¹Á…åµ•¹Ñ}µ•Ñ¡½€üü€M œ¤¹Ñ½UÁÁ•É…Í” ¤ì(€€€€€½¹ÍÐÁ…åµ•¹Ñ5•Ñ¡½‘‘˜€ôMÑÉ¥¹œ¡‰½‘ä¹Á…åµ•¹Ñ}µ•Ñ¡½‘}‘˜€üü‰½‘ä¹Á…åµ•¹Ñ}µ•Ñ¡½€üü€M œ¤¹Ñ½UÁÁ•É…Í” ¤ì(€€€€€¥˜€ …lM œ°€	9,œ°€5=	%1}5=9dt¹¥¹±Õ‘•Ì¡Á…åµ•¹Ñ5•Ñ¡½‘UÍ¤ñð€…lM œ°€	9,œ°€5=	%1}5=9dt¹¥¹±Õ‘•Ì¡Á…åµ•¹Ñ5•Ñ¡½‘‘˜¤¤ì(€€€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 5½‘”‘”Á…¥•µ•¹Ð¥¹Ù…±¥‘”¸œ¤ì(€€€€€ô(€€€€€¥˜€¡Á…åµ•¹ÑÕÉÉ•¹ä€ôôô€5%aœ€˜˜€¡Á…åµ•¹Ñ5•Ñ¡½‘UÍ€ôôô€	9,œñðÁ…åµ•¹Ñ5•Ñ¡½‘‘˜€ôôô€	9,œ¤¤ì(€€€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1”Á…¥•µ•¹Ðµ¥áÑ”‘”…É…¹Ñ¥”‰…¹…¥É”¸•ÍÐÁ…Ì•¹½É”ÁÉ¥Ì•¸¡…É”¸œ¤ì(€€€€€ô(€€€€€½¹ÍÐÁ…åµ•¹Ñ5•Ñ¡½€ô…µ½Õ¹ÑUÍ€ø€À€üÁ…åµ•¹Ñ5•Ñ¡½‘UÍ€èÁ…åµ•¹Ñ5•Ñ¡½‘‘˜ì(€€€€€½¹ÍÐ¥Í	…¹­A…åµ•¹Ð€ôÁ…åµ•¹Ñ5•Ñ¡½€ôôô€	9,œì(€€€€€½¹ÍÐ‰…¹­½Õ¹Ð€ô¥Í	…¹­A…åµ•¹Ð(€€€€€€€€ü…Ý…¥ÐÑ¡¥Ì¹Ù…±¥‘…Ñ•	…¹­½Õ¹Ñ½ÉÕ…É…¹Ñ•”¡±¥•¹Ð°9Õµ‰•È¡‰½‘ä¹‰…¹­}…½Õ¹Ñ}¥€üü€À¤°Á…åµ•¹ÑÕÉÉ•¹ä¤(€€€€€€€€è¹Õ±°ì(€€€€€½¹ÍÐ‰…¹­Õ…É…¹Ñ••QÉ…¹Í…Ñ¥½¹QåÁ”€ô¥Í	…¹­A…åµ•¹Ð(€€€€€€€€ü…Ý…¥ÐÑ¡¥Ì¹‰…¹­Õ…É…¹Ñ••QÉ…¹Í…Ñ¥½¹QåÁ”¡±¥•¹Ð°€UI9Q}Ae59Pœ¤(€€€€€€€€è€59U1})UMQ59Pœì(€€€€€¥˜€ …¥Í	…¹­A…åµ•¹Ð¤ì(€€€€€€€…Ý…¥ÐÑ¡¥Ì¹•¹ÍÕÉ•Õ…É…¹Ñ••…Í¡M¡•µ„ ¤ì(€€€€€ô(€€€€€½¹ÍÐ‘™ÅÕ¥Ù…±•¹ÑUÍ€ô…µ½Õ¹Ñ‘˜€ø€À€˜˜•á¡…¹•I…Ñ•UÍ•€ü9Õµ‰•È ¡…µ½Õ¹Ñ‘˜€¼•á¡…¹•I…Ñ•UÍ•¤¹Ñ½¥á• È¤¤€è€Àì(€€€€€½¹ÍÐ…µ½Õ¹Ð€ô9Õµ‰•È ¡…µ½Õ¹ÑUÍ€¬‘™ÅÕ¥Ù…±•¹ÑUÍ¤¹Ñ½¥á• È¤¤ì(€€€€€½¹ÍÐÕ…É…¹Ñ•”€ô…Ý…¥ÐÑ¡¥Ì¹±•…Í•Õ…É…¹Ñ•”¡¥¤ì(€€€€€½¹ÍÐÕ…É…¹Ñ••µ½Õ¹Ð€ô9Õµ‰•È¡Õ…É…¹Ñ•”ü¹…µ½Õ¹Ð€üüÉ½Ü¹É•¹Ñ…±}Õ…É…¹Ñ••}…µ½Õ¹Ð€üü€À¤ì(€€€€€½¹ÍÐÁ…¥‘µ½Õ¹Ð€ô9Õµ‰•È¡Õ…É…¹Ñ•”ü¹Á…¥‘}…µ½Õ¹Ð€üüÉ½Ü¹É•¹Ñ…±}Õ…É…¹Ñ••}Á…¥€üü€À¤€¬…µ½Õ¹Ðì(€€€€€¥˜€¡Õ…É…¹Ñ••µ½Õ¹Ð€ø€À€˜˜Á…¥‘µ½Õ¹Ð€øÕ…É…¹Ñ••µ½Õ¹Ð€¬€À¸ÀÄ¤ì(€€€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1”Á…¥•µ•¹Ð‘•Á…ÍÍ”±”µ½¹Ñ…¹ÐÉ•ÍÑ…¹Ð‘”±„…É…¹Ñ¥”¸œ¤ì(€€€€€ô(€€€€€½¹ÍÐÍÑ…ÑÕÌ€ôÁ…¥‘µ½Õ¹Ð€øôÕ…É…¹Ñ••µ½Õ¹Ð€ü€A%œ€èÁ…¥‘µ½Õ¹Ð€ø€À€ü€AIQ%0œ€è€9=Q}A%œì(€€€€€…Ý…¥ÐÑ¡¥Ì¹ÕÁÍ•ÉÑ1•…Í•Õ…É…¹Ñ•”¡±¥•¹Ð°¥°ì(€€€€€€€…µ½Õ¹ÐèÕ…É…¹Ñ••µ½Õ¹Ð°(€€€€€€€Á…¥‘}…µ½Õ¹ÐèÁ…¥‘µ½Õ¹Ð°(€€€€€€€Á…åµ•¹Ñ}‘…Ñ”èMÑÉ¥¹œ¡‰½‘ä¹Á…åµ•¹Ñ}‘…Ñ”€üü¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤¹Í±¥” À°€ÄÀ¤¤°(€€€€€€€ÍÑ…ÑÕÌ°(€€€€€ô¤ì(€€€€€½¹ÍÐÁ•ÉÍ¥ÍÑ•‘Õ…É…¹Ñ•”€ô…Ý…¥ÐÑ¡¥Ì¹±•…Í•Õ…É…¹Ñ••%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹Ð°¥¤ì(€€€€€½¹ÍÐÉ••¥ÁÑ9Õµ‰•È€ô…Ý…¥ÐÑ¡¥Ì¹¹•áÑA…åµ•¹ÑI••¥ÁÑ9Õµ‰•È¡±¥•¹Ð¤ì(€€€€€½¹ÍÐÁ…åµ•¹Ñ…Ñ”€ôMÑÉ¥¹œ¡‰½‘ä¹Á…åµ•¹Ñ}‘…Ñ”€üü¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤¹Í±¥” À°€ÄÀ¤¤ì(€€€€€½¹ÍÐ¹½Éµ…±¥é•‘I•™•É•¹”€ô‰½‘ä¹É•™•É•¹”€üMÑÉ¥¹œ¡‰½‘ä¹É•™•É•¹”¤€èH´‘í¥‘õ€ì(€€€€€½¹ÍÐ¥‘•µÁ½Ñ•¹å-•ä€ôl(€€€€€€€€UI9Qœ°(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°(€€€€€€€¥°(€€€€€€€Á•ÉÍ¥ÍÑ•‘Õ…É…¹Ñ•”¹¥°(€€€€€€€Á…åµ•¹Ñ…Ñ”°(€€€€€€€…µ½Õ¹Ð¹Ñ½¥á• È¤°(€€€€€€€…µ½Õ¹ÑUÍ¹Ñ½¥á• È¤°(€€€€€€€…µ½Õ¹Ñ‘˜¹Ñ½¥á• È¤°(€€€€€€€¹½Éµ…±¥é•‘I•™•É•¹”°(€€€€€t¹©½¥¸ œèœ¤ì(€€€€€½¹ÍÐÁ…åµ•¹ÑI•ÍÕ±Ð€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€%9MIP%9Q<Á…åµ•¹ÑÌ(€€€€€€€€€€¡¥¹Ù½¥•}¥°Á…åµ•¹Ñ}‘…Ñ”°…µ½Õ¹Ð°Á…åµ•¹Ñ}µ•Ñ¡½°É•™•É•¹”°¹½Ñ•Ì°Á…å•É}¹…µ”°É••¥ÁÑ}¹Õµ‰•È°(€€€€€€€€€€ÕÉÉ•¹ä°…µ½Õ¹Ñ}ÕÍ°…µ½Õ¹Ñ}‘˜°•á¡…¹•}É…Ñ•}ÕÍ•°•á¡…¹•}É…Ñ•}‘…Ñ”°‘™}•ÅÕ¥Ù…±•¹Ñ}ÕÍ°Ñ½Ñ…±}•ÅÕ¥Ù…±•¹Ñ}ÕÍ°½É…¹¥é…Ñ¥½¹}¥°(€€€€€€€€€€Á…åµ•¹Ñ}ÑåÁ”°±•…Í•}Õ…É…¹Ñ••}¥°¥‘•µÁ½Ñ•¹å}­•ä¤(€€€€€€€€Y1UL(€€€€€€€€€€¡9U10°€Ä°€È°€Ì°€Ð°€Ô°€Ø°€Ü°(€€€€€€€€€€€à°€ä°€ÄÀ°€ÄÄ°€ÄÈ°€ÄÌ°€È°€ÄÐ°(€€€€€€€€€€€UI9Qœ°€ÄÔ°€ÄØ¤(€€€€€€€€=8=91%P€¡½É…¹¥é…Ñ¥½¹}¥°¥‘•µÁ½Ñ•¹å}­•ä¤(€€€€€€€€]!I‘•±•Ñ•‘}…Ð%L9U109¥‘•µÁ½Ñ•¹å}­•ä%L9=P9U10(€€€€€€€€<9=Q!%9(€€€€€€€€IQUI9%9€©€°(€€€€€€€l(€€€€€€€€€Á…åµ•¹Ñ…Ñ”°(€€€€€€€€€…µ½Õ¹Ð°(€€€€€€€€€Á…åµ•¹Ñ5•Ñ¡½°(€€€€€€€€€¹½Éµ…±¥é•‘I•™•É•¹”°(€€€€€€€€€‰½‘ä¹¹½Ñ•Ì€üMÑÉ¥¹œ¡‰½‘ä¹¹½Ñ•Ì¤€è€A…¥•µ•¹Ð…É…¹Ñ¥”±½…Ñ¥Ù”œ°(€€€€€€€€€É½Ü¹Ñ•¹…¹Ñ}¹…µ”€üü€¡É½Ü¹Ñ•¹…¹Ñ}¥€ü1½…Ñ…¥É”€Œ‘íÉ½Ü¹Ñ•¹…¹Ñ}¥‘õ€€è¹Õ±°¤°(€€€€€€€€€É••¥ÁÑ9Õµ‰•È°(€€€€€€€€€Á…åµ•¹ÑÕÉÉ•¹ä°(€€€€€€€€€…µ½Õ¹ÑUÍ°(€€€€€€€€€…µ½Õ¹Ñ‘˜°(€€€€€€€€€•á¡…¹•I…Ñ•UÍ•°(€€€€€€€€€•á¡…¹•I…Ñ•…Ñ”°(€€€€€€€€€‘™ÅÕ¥Ù…±•¹ÑUÍ°(€€€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°(€€€€€€€€€Á•ÉÍ¥ÍÑ•‘Õ…É…¹Ñ•”¹¥°(€€€€€€€€€¥‘•µÁ½Ñ•¹å-•ä°(€€€€€€€t°(€€€€€€¤ì(€€€€€¥˜€ …Á…åµ•¹ÑI•ÍÕ±Ð¹É½ÝÍlÁt¤ì(€€€€€€€Ñ¡É½Ü¹•Ü½¹™±¥Ñá•ÁÑ¥½¸ ”Á…¥•µ•¹Ð‘”…É…¹Ñ¥”•ÍÐ‘•©„•¸½ÕÉÌ‘”ÑÉ…¥Ñ•µ•¹Ð½Ô‘•©„•¹É•¥ÍÑÉ”¸œ¤ì(€€€€€ô(€€€€€½¹ÍÐµ½Ù•µ•¹ÑÌ€ômtì(€€€€€¥˜€¡…µ½Õ¹ÑUÍ€ø€À€˜˜€…¥Í	…¹­A…åµ•¹Ð¤ì(€€€€€€€½¹ÍÐµ½Ù•µ•¹Ð€ô…Ý…¥ÐÑ¡¥Ì¹É•…Ñ•Õ…É…¹Ñ••…Í¡5½Ù•µ•¹Ñ%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹Ð°ì(€€€€€€€€€µ½Ù•µ•¹Ñ}ÑåÁ”è€I9Qe}Ae59Q}%8œ°(€€€€€€€€€ÑåÁ”è€%8œ°(€€€€€€€€€…µ½Õ¹Ðè…µ½Õ¹ÑUÍ°(€€€€€€€€€µ½Ù•µ•¹Ñ}‘…Ñ”èÁ…åµ•¹Ñ…Ñ”°(€€€€€€€€€±•…Í•}¥è¥°(€€€€€€€€€±•…Í•}Õ…É…¹Ñ••}¥èÁ•ÉÍ¥ÍÑ•‘Õ…É…¹Ñ•”¹¥°(€€€€€€€€€Á…åµ•¹Ñ}¥èÁ…åµ•¹ÑI•ÍÕ±Ð¹É½ÝÍlÁt¹¥°(€€€€€€€€€Ñ•¹…¹Ñ}¥èÉ½Ü¹Ñ•¹…¹Ñ}¥°(€€€€€€€€€É•™•É•¹”è¹½Éµ…±¥é•‘I•™•É•¹”°(€€€€€€€€€É•…Í½¸è€A…¥•µ•¹Ð…É…¹Ñ¥”±½…Ñ¥Ù”œ°(€€€€€€€€€¹½Ñ•Ìè‰½‘ä¹¹½Ñ•Ì€üMÑÉ¥¹œ¡‰½‘ä¹¹½Ñ•Ì¤€è¹Õ±°°(€€€€€€€€€ÕÉÉ•¹äè€UMœ°(€€€€€€€€€•ÅÕ¥Ù…±•¹Ñ}ÕÍè…µ½Õ¹ÑUÍ°(€€€€€€€ô¤ì(€€€€€€€…Ý…¥ÐÑ¡¥Ì¹…Õ‘¥ÑÕ…É…¹Ñ••…Í ¡±¥•¹Ð°€I9Qe}Ae59Q}%8œ°µ½Ù•µ•¹Ð¹¥°ìÁ…åµ•¹Ñ}¥èÁ…åµ•¹ÑI•ÍÕ±Ð¹É½ÝÍlÁt¹¥°…µ½Õ¹Ðè…µ½Õ¹ÑUÍ°ÕÉÉ•¹äè€UMœô¤ì(€€€€€€€µ½Ù•µ•¹ÑÌ¹ÁÕÍ ¡µ½Ù•µ•¹Ð¤ì(€€€€€ô(€€€€€¥˜€¡…µ½Õ¹Ñ‘˜€ø€À€˜˜€…¥Í	…¹­A…åµ•¹Ð¤ì(€€€€€€€½¹ÍÐµ½Ù•µ•¹Ð€ô…Ý…¥ÐÑ¡¥Ì¹É•…Ñ•Õ…É…¹Ñ••…Í¡5½Ù•µ•¹Ñ%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹Ð°ì(€€€€€€€€€µ½Ù•µ•¹Ñ}ÑåÁ”è€I9Qe}Ae59Q}%8œ°(€€€€€€€€€ÑåÁ”è€%8œ°(€€€€€€€€€…µ½Õ¹Ðè…µ½Õ¹Ñ‘˜°(€€€€€€€€€µ½Ù•µ•¹Ñ}‘…Ñ”èÁ…åµ•¹Ñ…Ñ”°(€€€€€€€€€±•…Í•}¥è¥°(€€€€€€€€€±•…Í•}Õ…É…¹Ñ••}¥èÁ•ÉÍ¥ÍÑ•‘Õ…É…¹Ñ•”¹¥°(€€€€€€€€€Á…åµ•¹Ñ}¥èÁ…åµ•¹ÑI•ÍÕ±Ð¹É½ÝÍlÁt¹¥°(€€€€€€€€€Ñ•¹…¹Ñ}¥èÉ½Ü¹Ñ•¹…¹Ñ}¥°(€€€€€€€€€É•™•É•¹”è¹½Éµ…±¥é•‘I•™•É•¹”°(€€€€€€€€€É•…Í½¸è€A…¥•µ•¹Ð…É…¹Ñ¥”±½…Ñ¥Ù”œ°(€€€€€€€€€¹½Ñ•Ìè‰½‘ä¹¹½Ñ•Ì€üMÑÉ¥¹œ¡‰½‘ä¹¹½Ñ•Ì¤€è¹Õ±°°(€€€€€€€€€ÕÉÉ•¹äè€œ°(€€€€€€€€€•á¡…¹•}É…Ñ•}ÕÍ•è•á¡…¹•I…Ñ•UÍ•°(€€€€€€€€€•á¡…¹•}É…Ñ•}‘…Ñ”è•á¡…¹•I…Ñ•…Ñ”°(€€€€€€€€€•ÅÕ¥Ù…±•¹Ñ}ÕÍè‘™ÅÕ¥Ù…±•¹ÑUÍ°(€€€€€€€ô¤ì(€€€€€€€…Ý…¥ÐÑ¡¥Ì¹…Õ‘¥ÑÕ…É…¹Ñ••…Í ¡±¥•¹Ð°€I9Qe}Ae59Q}%8œ°µ½Ù•µ•¹Ð¹¥°ìÁ…åµ•¹Ñ}¥èÁ…åµ•¹ÑI•ÍÕ±Ð¹É½ÝÍlÁt¹¥°…µ½Õ¹Ðè…µ½Õ¹Ñ‘˜°ÕÉÉ•¹äè€œô¤ì(€€€€€€€µ½Ù•µ•¹ÑÌ¹ÁÕÍ ¡µ½Ù•µ•¹Ð¤ì(€€€€€ô(€€€€€±•Ð‰…¹­QÉ…¹Í…Ñ¥½¸èI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸øð¹Õ±°€ô¹Õ±°ì(€€€€€¥˜€¡¥Í	…¹­A…åµ•¹Ð€˜˜‰…¹­½Õ¹Ð¤ì(€€€€€€€‰…¹­QÉ…¹Í…Ñ¥½¸€ô…Ý…¥ÐÑ¡¥Ì¹É•…Ñ•Õ…É…¹Ñ••	…¹­QÉ…¹Í…Ñ¥½¹%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹Ð°ì(€€€€€€€€€‰…¹­½Õ¹Ð°(€€€€€€€€€…µ½Õ¹ÐèÁ…åµ•¹ÑÕÉÉ•¹ä€ôôô€œ€ü…µ½Õ¹Ñ‘˜€è…µ½Õ¹ÑUÍ°(€€€€€€€€€ÕÉÉ•¹äèÁ…åµ•¹ÑÕÉÉ•¹ä€ôôô€œ€ü€œ€è€UMœ°(€€€€€€€€€É••¥ÁÑ9Õµ‰•ÈèÁ…åµ•¹ÑI•ÍÕ±Ð¹É½ÝÍlÁt¹É••¥ÁÑ}¹Õµ‰•È°(€€€€€€€€€É•™•É•¹”è¹½Éµ…±¥é•‘I•™•É•¹”°(€€€€€€€€€É•…Ñ•‘	äèÑ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•É% ¤€üü¹Õ±°°(€€€€€€€€€ÑÉ…¹Í…Ñ¥½¹QåÁ”è‰…¹­Õ…É…¹Ñ••QÉ…¹Í…Ñ¥½¹QåÁ”°(€€€€€€€€€Í½ÕÉ•5½‘Õ±”è€UI9QLœ°(€€€€€€€€€‘¥É•Ñ¥½¸è€%8œ°(€€€€€€€€€Í½ÕÉ•¹Ñ¥ÑåQåÁ”è€UI9Qœ°(€€€€€€€€€Í½ÕÉ•¹Ñ¥Ñå%è9Õµ‰•È¡Á…åµ•¹ÑI•ÍÕ±Ð¹É½ÝÍlÁt¹¥¤°(€€€€€€€€€‘•ÍÉ¥ÁÑ¥½¸è€A…¥•µ•¹Ð‘”…É…¹Ñ¥”±½…Ñ¥Ù”œ°(€€€€€€€€€Ñ•¹…¹Ñ9…µ”èÉ½Ü¹Ñ•¹…¹Ñ}¹…µ”€üü¹Õ±°°(€€€€€€€€€±•…Í•9Õµ‰•ÈèÉ½Ü¹±•…Í•}¹Õµ‰•È€üü¹Õ±°°(€€€€€€€€€Õ¹¥Ñ9Õµ‰•ÈèÉ½Ü¹Õ¹¥Ñ}¹Õµ‰•È€üü¹Õ±°°(€€€€€€€ô¤ì(€€€€€ô(€€€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€UAQÁ…åµ•¹ÑÌ(€€€€€€€€MPÕ…É…¹Ñ••}…Í¡}µ½Ù•µ•¹Ñ}¥€ô€È(€€€€€€€€]!I¥€ô€Ä9½É…¹¥é…Ñ¥½¹}¥€ô€Í€°(€€€€€€€mÁ…åµ•¹ÑI•ÍÕ±Ð¹É½ÝÍlÁt¹¥°µ½Ù•µ•¹ÑÍlÁtü¹¥€üü¹Õ±°°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€€€¤ì(€€€€€É•ÑÕÉ¸ì(€€€€€€€Õ…É…¹Ñ•”è…Ý…¥ÐÑ¡¥Ì¹±•…Í•Õ…É…¹Ñ••%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹Ð°¥¤°(€€€€€€€Á…åµ•¹Ñ}¥èÁ…åµ•¹ÑI•ÍÕ±Ð¹É½ÝÍlÁt¹¥°(€€€€€€€É••¥ÁÑ}¹Õµ‰•ÈèÁ…åµ•¹ÑI•ÍÕ±Ð¹É½ÝÍlÁt¹É••¥ÁÑ}¹Õµ‰•È°(€€€€€€€…Í¡}µ½Ù•µ•¹Ñ}¥èµ½Ù•µ•¹ÑÍlÁtü¹¥€üü¹Õ±°°(€€€€€€€‰…¹­}ÑÉ…¹Í…Ñ¥½¸è‰…¹­QÉ…¹Í…Ñ¥½¸°(€€€€€€€µ½Ù•µ•¹Ðèµ½Ù•µ•¹ÑÍlÁt€üü¹Õ±°°(€€€€€€€µ½Ù•µ•¹ÑÌ°(€€€€€ôì(€€€ô¤ì(€ô((€…Íå¹ŒÉ•™Õ¹‘1•…Í•Õ…É…¹Ñ•”¡¥è¹Õµ‰•È°‰½‘äèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø¤ì(€€€É•ÑÕÉ¸Ñ¡¥Ì¹‘ˆ¹ÑÉ…¹Í…Ñ¥½¸¡…Íå¹Œ€¡±¥•¹Ð¤€ôøì(€€€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä M1PÁ}…‘Ù¥Í½Éå}á…Ñ}±½¬¡¡…Í¡Ñ•áÐ Ä¤¤œ°m±•…Í”µÕ…É…¹Ñ•”µÉ•™Õ¹´‘íÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥ô´‘í¥‘õt¤ì(€€€€€½¹ÍÐ±•…Í”€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€M1P°¸¨°(€€€€€€€€€€€€€€€M]!8Ð¹Ñ•¹…¹Ñ}ÑåÁ”€ô€=5A9dœQ!8=1M¡Ð¹½µÁ…¹å}¹…µ”°€œœ¤(€€€€€€€€€€€€€€€€€€€€1MQI%4¡=9P¡=1M¡Ð¹™¥ÉÍÑ}¹…µ”°€œœ¤°€œ€œ°=1M¡Ð¹±…ÍÑ}¹…µ”°€œœ¤°€œ€œ°=1M¡Ð¹Á½ÍÑ}¹…µ”°€œœ¤¤¤(€€€€€€€€€€€€€€€9LÑ•¹…¹Ñ}¹…µ”°(€€€€€€€€€€€€€€€Ô¹¹Õµ‰•ÈLÕ¹¥Ñ}¹Õµ‰•È°(€€€€€€€€€€€€€€€°¹±•…Í•}¹Õµ‰•È(€€€€€€€€I=4±•…Í•Ì°(€€€€€€€€1P)=%8Ñ•¹…¹ÑÌÐ=8Ð¹¥€ô°¹Ñ•¹…¹Ñ}¥9Ð¹½É…¹¥é…Ñ¥½¹}¥€ô°¹½É…¹¥é…Ñ¥½¹}¥9Ð¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€1P)=%8Õ¹¥ÑÌÔ=8Ô¹¥€ô°¹Õ¹¥Ñ}¥9Ô¹½É…¹¥é…Ñ¥½¹}¥€ô°¹½É…¹¥é…Ñ¥½¹}¥9Ô¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€]!I°¹¥€ô€Ä9°¹½É…¹¥é…Ñ¥½¹}¥€ô€È9°¹‘•±•Ñ•‘}…Ð%L9U11€°(€€€€€€€m¥°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€€€¤ì(€€€€€½¹ÍÐÉ½Ü€ôÉ•ÅÕ¥É•I½Ü¡±•…Í”¹É½ÝÍlÁt°€1•…Í”œ¤ì(€€€€€½¹ÍÐ•á¡…¹•I…Ñ”€ô…Ý…¥ÐÑ¡¥Ì¹•á¡…¹•I…Ñ” ¤ì(€€€€€½¹ÍÐÁ…åµ•¹ÑÕÉÉ•¹ä€ôMÑÉ¥¹œ¡‰½‘ä¹Á…åµ•¹Ñ}ÕÉÉ•¹ä€üü€UMœ¤¹Ñ½UÁÁ•É…Í” ¤ì(€€€€€½¹ÍÐ…µ½Õ¹ÑUÍ€ô9Õµ‰•È¡‰½‘ä¹…µ½Õ¹Ñ}ÕÍ€üü€¡Á…åµ•¹ÑÕÉÉ•¹ä€ôôô€UMœ€ü‰½‘ä¹…µ½Õ¹Ð€è€À¤¤ñð€Àì(€€€€€½¹ÍÐ…µ½Õ¹Ñ‘˜€ô9Õµ‰•È¡‰½‘ä¹…µ½Õ¹Ñ}‘˜€üü€À¤ñð€Àì(€€€€€½¹ÍÐ•á¡…¹•I…Ñ•UÍ•€ô9Õµ‰•È¡‰½‘ä¹•á¡…¹•}É…Ñ•}ÕÍ•€üü•á¡…¹•I…Ñ”ü¹É…Ñ”€üü€À¤ñð¹Õ±°ì(€€€€€½¹ÍÐ•á¡…¹•I…Ñ•…Ñ”€ô‰½‘ä¹•á¡…¹•}É…Ñ•}‘…Ñ”€üü•á¡…¹•I…Ñ”ü¹•™™•Ñ¥Ù•…Ñ”€üü¹Õ±°ì(€€€€€¥˜€ …lUMœ°€t¹¥¹±Õ‘•Ì¡Á…åµ•¹ÑÕÉÉ•¹ä¤¤ì(€€€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ •Ù¥Í”‘”É•µ‰½ÕÉÍ•µ•¹Ð¥¹Ù…±¥‘”¸œ¤ì(€€€€€ô(€€€€€¥˜€ …9Õµ‰•È¹¥Í¥¹¥Ñ”¡…µ½Õ¹ÑUÍ¤ñð…µ½Õ¹ÑUÍ€ð€Àñð€…9Õµ‰•È¹¥Í¥¹¥Ñ”¡…µ½Õ¹Ñ‘˜¤ñð…µ½Õ¹Ñ‘˜€ð€À¤ì(€€€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 5½¹Ñ…¹Ð‘”É•µ‰½ÕÉÍ•µ•¹Ð¥¹Ù…±¥‘”¸œ¤ì(€€€€€ô(€€€€€¥˜€¡…µ½Õ¹ÑUÍ€ðô€À€˜˜…µ½Õ¹Ñ‘˜€ðô€À¤ì(€€€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1”É•µ‰½ÕÉÍ•µ•¹Ð‘”±„…É…¹Ñ¥”‘½¥Ð•ÑÉ”ÍÕÁ•É¥•ÕÈ„€À¸œ¤ì(€€€€€ô(€€€€€¥˜€ ¡Á…åµ•¹ÑÕÉÉ•¹ä€ôôô€œñð…µ½Õ¹Ñ‘˜€ø€À¤€˜˜€ …•á¡…¹•I…Ñ•UÍ•ñð•á¡…¹•I…Ñ•UÍ•€ðô€À¤¤ì(€€€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ U¸Ñ…Õà‘”¡…¹”•ÍÐÉ•ÅÕ¥ÌÁ½ÕÈÕ¸É•µ‰½ÕÉÍ•µ•¹Ð‘”…É…¹Ñ¥”•¸¸œ¤ì(€€€€€ô(€€€€€½¹ÍÐÁ…åµ•¹Ñ5•Ñ¡½€ôMÑÉ¥¹œ¡‰½‘ä¹Á…åµ•¹Ñ}µ•Ñ¡½€üü€M œ¤¹Ñ½UÁÁ•É…Í” ¤ì(€€€€€¥˜€ …lM œ°€	9,œ°€5=	%1}5=9dt¹¥¹±Õ‘•Ì¡Á…åµ•¹Ñ5•Ñ¡½¤¤ì(€€€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 5½‘”‘”É•µ‰½ÕÉÍ•µ•¹Ð¥¹Ù…±¥‘”¸œ¤ì(€€€€€ô(€€€€€¥˜€¡Á…åµ•¹ÑÕÉÉ•¹ä€ôôô€œ€˜˜Á…åµ•¹Ñ5•Ñ¡½€ôôô€	9,œ€˜˜€ …•á¡…¹•I…Ñ•UÍ•ñð•á¡…¹•I…Ñ•UÍ•€ðô€À¤¤ì(€€€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ U¸Ñ…Õà‘”¡…¹”•ÍÐÉ•ÅÕ¥ÌÁ½ÕÈÕ¸É•µ‰½ÕÉÍ•µ•¹Ð‘”…É…¹Ñ¥”‰…¹…¥É”•¸¸œ¤ì(€€€€€ô(€€€€€½¹ÍÐ¥Í	…¹­A…åµ•¹Ð€ôÁ…åµ•¹Ñ5•Ñ¡½€ôôô€	9,œì(€€€€€½¹ÍÐ‰…¹­½Õ¹Ð€ô¥Í	…¹­A…åµ•¹Ð(€€€€€€€€ü…Ý…¥ÐÑ¡¥Ì¹Ù…±¥‘…Ñ•	…¹­½Õ¹Ñ½ÉÕ…É…¹Ñ•”¡±¥•¹Ð°9Õµ‰•È¡‰½‘ä¹‰…¹­}…½Õ¹Ñ}¥€üü€À¤°Á…åµ•¹ÑÕÉÉ•¹ä¤(€€€€€€€€è¹Õ±°ì(€€€€€½¹ÍÐ‰…¹­Õ…É…¹Ñ••QÉ…¹Í…Ñ¥½¹QåÁ”€ô¥Í	…¹­A…åµ•¹Ð(€€€€€€€€ü…Ý…¥ÐÑ¡¥Ì¹‰…¹­Õ…É…¹Ñ••QÉ…¹Í…Ñ¥½¹QåÁ”¡±¥•¹Ð°€UI9Q}IU9œ¤(€€€€€€€€è€59U1})UMQ59Pœì(€€€€€¥˜€ …¥Í	…¹­A…åµ•¹Ð¤ì(€€€€€€€…Ý…¥ÐÑ¡¥Ì¹•¹ÍÕÉ•Õ…É…¹Ñ••…Í¡M¡•µ„ ¤ì(€€€€€ô(€€€€€½¹ÍÐ‘™ÅÕ¥Ù…±•¹ÑUÍ€ô…µ½Õ¹Ñ‘˜€ø€À€˜˜•á¡…¹•I…Ñ•UÍ•€ü9Õµ‰•È ¡…µ½Õ¹Ñ‘˜€¼•á¡…¹•I…Ñ•UÍ•¤¹Ñ½¥á• È¤¤€è€Àì(€€€€€½¹ÍÐ…µ½Õ¹Ð€ô9Õµ‰•È ¡…µ½Õ¹ÑUÍ€¬‘™ÅÕ¥Ù…±•¹ÑUÍ¤¹Ñ½¥á• È¤¤ì(€€€€€½¹ÍÐÁ…åµ•¹Ñ…Ñ”€ôMÑÉ¥¹œ¡‰½‘ä¹Á…åµ•¹Ñ}‘…Ñ”€üü¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤¹Í±¥” À°€ÄÀ¤¤ì(€€€€€½¹ÍÐ¹½Éµ…±¥é•‘I•™•É•¹”€ô‰½‘ä¹É•™•É•¹”€üMÑÉ¥¹œ¡‰½‘ä¹É•™•É•¹”¤€èHµI´‘í¥‘õ€ì(€€€€€½¹ÍÐÉ•™Õ¹‘5½Ù•µ•¹Ñµ½Õ¹Ð€ôÁ…åµ•¹ÑÕÉÉ•¹ä€ôôô€œ€ü…µ½Õ¹Ñ‘˜€è…µ½Õ¹ÑUÍì(€€€€€½¹ÍÐÉ•™Õ¹‘5½Ù•µ•¹ÑÅÕ¥Ù…±•¹ÑUÍ€ôÁ…åµ•¹ÑÕÉÉ•¹ä€ôôô€œ€ü‘™ÅÕ¥Ù…±•¹ÑUÍ€è…µ½Õ¹ÑUÍì(€€€€€¥˜€ …¥Í	…¹­A…åµ•¹Ð¤ì(€€€€€€€½¹ÍÐ‘ÕÁ±¥…Ñ”€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€€€M1P¥(€€€€€€€€€€I=4Õ…É…¹Ñ••}…Í¡}µ½Ù•µ•¹ÑÌ(€€€€€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€€€€€9±•…Í•}¥€ô€È(€€€€€€€€€€€€9µ½Ù•µ•¹Ñ}ÑåÁ”€ô€I9Qe}IU9œ(€€€€€€€€€€€€9ÑåÁ”€ô€=UPœ(€€€€€€€€€€€€9…µ½Õ¹Ð€ô€Ì(€€€€€€€€€€€€9ÕÉÉ•¹ä€ô€Ð(€€€€€€€€€€€€9µ½Ù•µ•¹Ñ}‘…Ñ”€ô€ÔèéQ(€€€€€€€€€€€€9=1M¡É•™•É•¹”°€œœ¤€ô€Ø(€€€€€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€€€1%5%P€Å€°(€€€€€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°¥°É•™Õ¹‘5½Ù•µ•¹Ñµ½Õ¹Ð°Á…åµ•¹ÑÕÉÉ•¹ä°Á…åµ•¹Ñ…Ñ”°¹½Éµ…±¥é•‘I•™•É•¹•t°(€€€€€€€€¤ì(€€€€€€€¥˜€¡‘ÕÁ±¥…Ñ”¹É½ÝÍlÁt¤ì(€€€€€€€€€Ñ¡É½Ü¹•Ü½¹™±¥Ñá•ÁÑ¥½¸ ”É•µ‰½ÕÉÍ•µ•¹Ð‘”…É…¹Ñ¥”•ÍÐ‘•©„•¹É•¥ÍÑÉ”¸œ¤ì(€€€€€€€ô(€€€€€ô(€€€€€½¹ÍÐÕ…É…¹Ñ•”€ô…Ý…¥ÐÑ¡¥Ì¹±•…Í•Õ…É…¹Ñ•”¡¥¤ì(€€€€€½¹ÍÐÕ…É…¹Ñ••µ½Õ¹Ð€ô9Õµ‰•È¡Õ…É…¹Ñ•”ü¹…µ½Õ¹Ð€üüÉ½Ü¹É•¹Ñ…±}Õ…É…¹Ñ••}…µ½Õ¹Ð€üü€À¤ì(€€€€€½¹ÍÐÁ…¥‘µ½Õ¹Ð€ô9Õµ‰•È¡Õ…É…¹Ñ•”ü¹Á…¥‘}…µ½Õ¹Ð€üüÉ½Ü¹É•¹Ñ…±}Õ…É…¹Ñ••}Á…¥€üü€À¤ì(€€€€€¥˜€¡…µ½Õ¹Ð€øÁ…¥‘µ½Õ¹Ð€¬€À¸ÀÄ¤ì(€€€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1”É•µ‰½ÕÉÍ•µ•¹Ð‘•Á…ÍÍ”±”µ½¹Ñ…¹Ð‘•©„Á…å”¸œ¤ì(€€€€€ô(€€€€€½¹ÍÐ¹•áÑA…¥‘µ½Õ¹Ð€ô5…Ñ ¹µ…à¡9Õµ‰•È ¡Á…¥‘µ½Õ¹Ð€´…µ½Õ¹Ð¤¹Ñ½¥á• È¤¤°€À¤ì(€€€€€½¹ÍÐÍÑ…ÑÕÌ€ô¹•áÑA…¥‘µ½Õ¹Ð€øôÕ…É…¹Ñ••µ½Õ¹Ð€ü€A%œ€è¹•áÑA…¥‘µ½Õ¹Ð€ø€À€ü€AIQ%0œ€è€IU9œì(€€€€€…Ý…¥ÐÑ¡¥Ì¹ÕÁÍ•ÉÑ1•…Í•Õ…É…¹Ñ•”¡±¥•¹Ð°¥°ì(€€€€€€€…µ½Õ¹ÐèÕ…É…¹Ñ••µ½Õ¹Ð°(€€€€€€€Á…¥‘}…µ½Õ¹Ðè¹•áÑA…¥‘µ½Õ¹Ð°(€€€€€€€Á…åµ•¹Ñ}‘…Ñ”èÕ…É…¹Ñ•”ü¹Á…åµ•¹Ñ}‘…Ñ”€üü¹Õ±°°(€€€€€€€ÍÑ…ÑÕÌ°(€€€€€ô¤ì(€€€€€½¹ÍÐµ½Ù•µ•¹ÑÌ€ômtì(€€€€€±•Ð‰…¹­QÉ…¹Í…Ñ¥½¸èI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸øð¹Õ±°€ô¹Õ±°ì(€€€€€¥˜€¡¥Í	…¹­A…åµ•¹Ð€˜˜‰…¹­½Õ¹Ð¤ì(€€€€€€€‰…¹­QÉ…¹Í…Ñ¥½¸€ô…Ý…¥ÐÑ¡¥Ì¹É•…Ñ•Õ…É…¹Ñ••	…¹­QÉ…¹Í…Ñ¥½¹%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹Ð°ì(€€€€€€€€€‰…¹­½Õ¹Ð°(€€€€€€€€€…µ½Õ¹ÐèÉ•™Õ¹‘5½Ù•µ•¹Ñµ½Õ¹Ð°(€€€€€€€€€ÕÉÉ•¹äèÁ…åµ•¹ÑÕÉÉ•¹ä€ôôô€œ€ü€œ€è€UMœ°(€€€€€€€€€É••¥ÁÑ9Õµ‰•Èè¹½Éµ…±¥é•‘I•™•É•¹”°(€€€€€€€€€É•™•É•¹”è¹½Éµ…±¥é•‘I•™•É•¹”°(€€€€€€€€€É•…Ñ•‘	äèÑ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•É% ¤€üü¹Õ±°°(€€€€€€€€€ÑÉ…¹Í…Ñ¥½¹QåÁ”è‰…¹­Õ…É…¹Ñ••QÉ…¹Í…Ñ¥½¹QåÁ”°(€€€€€€€€€Í½ÕÉ•5½‘Õ±”è€UI9QLœ°(€€€€€€€€€‘¥É•Ñ¥½¸è€=UPœ°(€€€€€€€€€Í½ÕÉ•¹Ñ¥ÑåQåÁ”è€UI9Q}IU9œ°(€€€€€€€€€Í½ÕÉ•¹Ñ¥Ñå%è¥°(€€€€€€€€€‘•ÍÉ¥ÁÑ¥½¸è€I•µ‰½ÕÉÍ•µ•¹Ð‘”…É…¹Ñ¥”±½…Ñ¥Ù”œ°(€€€€€€€€€Ñ•¹…¹Ñ9…µ”èÉ½Ü¹Ñ•¹…¹Ñ}¹…µ”€üü¹Õ±°°(€€€€€€€€€±•…Í•9Õµ‰•ÈèÉ½Ü¹±•…Í•}¹Õµ‰•È€üü¹Õ±°°(€€€€€€€€€Õ¹¥Ñ9Õµ‰•ÈèÉ½Ü¹Õ¹¥Ñ}¹Õµ‰•È€üü¹Õ±°°(€€€€€€€ô¤ì(€€€€€ô•±Í”ì(€€€€€€€½¹ÍÐµ½Ù•µ•¹Ð€ô…Ý…¥ÐÑ¡¥Ì¹É•…Ñ•Õ…É…¹Ñ••…Í¡5½Ù•µ•¹Ñ%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹Ð°ì(€€€€€€€€€µ½Ù•µ•¹Ñ}ÑåÁ”è€I9Qe}IU9œ°(€€€€€€€€€ÑåÁ”è€=UPœ°(€€€€€€€€€…µ½Õ¹ÐèÉ•™Õ¹‘5½Ù•µ•¹Ñµ½Õ¹Ð°(€€€€€€€€€µ½Ù•µ•¹Ñ}‘…Ñ”èÁ…åµ•¹Ñ…Ñ”°(€€€€€€€€€±•…Í•}¥è¥°(€€€€€€€€€±•…Í•}Õ…É…¹Ñ••}¥èÕ…É…¹Ñ•”ü¹¥€üü¹Õ±°°(€€€€€€€€€Ñ•¹…¹Ñ}¥èÉ½Ü¹Ñ•¹…¹Ñ}¥°(€€€€€€€€€É•™•É•¹”è¹½Éµ…±¥é•‘I•™•É•¹”°(€€€€€€€€€É•…Í½¸è€I•µ‰½ÕÉÍ•µ•¹Ð…É…¹Ñ¥”±½…Ñ¥Ù”œ°(€€€€€€€€€¹½Ñ•Ìè‰½‘ä¹¹½Ñ•Ì€üMÑÉ¥¹œ¡‰½‘ä¹¹½Ñ•Ì¤€è¹Õ±°°(€€€€€€€€€ÕÉÉ•¹äèÁ…åµ•¹ÑÕÉÉ•¹ä°(€€€€€€€€€•á¡…¹•}É…Ñ•}ÕÍ•è•á¡…¹•I…Ñ•UÍ•°(€€€€€€€€€•á¡…¹•}É…Ñ•}‘…Ñ”è•á¡…¹•I…Ñ•…Ñ”°(€€€€€€€€€•ÅÕ¥Ù…±•¹Ñ}ÕÍèÉ•™Õ¹‘5½Ù•µ•¹ÑÅÕ¥Ù…±•¹ÑUÍ°(€€€€€€€ô¤ì(€€€€€€€…Ý…¥ÐÑ¡¥Ì¹…Õ‘¥ÑÕ…É…¹Ñ••…Í ¡±¥•¹Ð°€I9Qe}IU9œ°µ½Ù•µ•¹Ð¹¥°ì…µ½Õ¹ÐèÉ•™Õ¹‘5½Ù•µ•¹Ñµ½Õ¹Ð°±•…Í•}¥è¥ô¤ì(€€€€€€€µ½Ù•µ•¹ÑÌ¹ÁÕÍ ¡µ½Ù•µ•¹Ð¤ì(€€€€€ô(€€€€€É•ÑÕÉ¸ì(€€€€€€€Õ…É…¹Ñ•”è…Ý…¥ÐÑ¡¥Ì¹±•…Í•Õ…É…¹Ñ••%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹Ð°¥¤°(€€€€€€€‰…¹­}ÑÉ…¹Í…Ñ¥½¸è‰…¹­QÉ…¹Í…Ñ¥½¸°(€€€€€€€µ½Ù•µ•¹Ðèµ½Ù•µ•¹ÑÍlÁt€üü¹Õ±°°(€€€€€€€µ½Ù•µ•¹ÑÌ°(€€€€€ôì(€€€ô¤ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ¹•áÑA…åµ•¹ÑI••¥ÁÑ9Õµ‰•È¡±¥•¹ÐèA½½±±¥•¹Ð¤ì(€€€½¹ÍÐå•…È€ô¹•Ü…Ñ” ¤¹•ÑÕ±±e•…È ¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P=1M¡5` ¡MU	MQI%9¡É••¥ÁÑ}¹Õµ‰•ÈI=4€Ä¤¤èé%9P¤°€À¤€¬€ÄLÙ…±Õ”(€€€€€€I=4Á…åµ•¹ÑÌ(€€€€€€]!IÉ••¥ÁÑ}¹Õµ‰•È1%-€È9½É…¹¥é…Ñ¥½¹}¥€ô€Í€°(€€€€€mIAP´‘íå•…Éô´¡lÀ´åt¬¥€°IAP´‘íå•…Éô´•€°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€É•ÑÕÉ¸IAP´‘íå•…Éô´‘íMÑÉ¥¹œ¡É½ÝÍlÁt¹Ù…±Õ”¤¹Á…‘MÑ…ÉÐ Ð°€œÀœ¥õ€ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÙ…±¥‘…Ñ•	…¹­½Õ¹Ñ½ÉÕ…É…¹Ñ•”¡±¥•¹ÐèA½½±±¥•¹Ð°‰…¹­½Õ¹Ñ%è¹Õµ‰•ÈðÕ¹‘•™¥¹•°Á…åµ•¹ÑÕÉÉ•¹äèÍÑÉ¥¹œ¤ì(€€€½¹ÍÐ…½Õ¹Ñ%€ô9Õµ‰•È¡‰…¹­½Õ¹Ñ%€üü€À¤ì(€€€¥˜€ ……½Õ¹Ñ%¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ U¸½µÁÑ”‰…¹…¥É”…Ñ¥˜•ÍÐÉ•ÅÕ¥ÌÁ½ÕÈÕ¸Á…¥•µ•¹Ð‘”…É…¹Ñ¥”Á…È‰…¹ÅÕ”¸œ¤ì(€€€ô(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P¥°‰…¹­}¹…µ”°…½Õ¹Ñ}¹…µ”°ÕÉÉ•¹ä°ÍÑ…ÑÕÌ(€€€€€€I=4‰…¹­}…½Õ¹ÑÌ(€€€€€€]!I¥€ô€Ä(€€€€€€€€9½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U11€°(€€€€€m…½Õ¹Ñ%°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€½¹ÍÐ…½Õ¹Ð€ôÉ•ÅÕ¥É•I½Ü¡É½ÝÍlÁt°€	…¹¬…½Õ¹Ðœ¤ì(€€€¥˜€¡MÑÉ¥¹œ¡…½Õ¹Ð¹ÍÑ…ÑÕÌ¤¹Ñ½UÁÁ•É…Í” ¤€„ôô€Q%Yœ¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1”½µÁÑ”‰…¹…¥É”Í•±•Ñ¥½¹¹”‘½¥Ð•ÑÉ”…Ñ¥˜¸œ¤ì(€€€ô(€€€¥˜€¡MÑÉ¥¹œ¡…½Õ¹Ð¹ÕÉÉ•¹ä¤¹Ñ½UÁÁ•É…Í” ¤€„ôôMÑÉ¥¹œ¡Á…åµ•¹ÑÕÉÉ•¹ä¤¹Ñ½UÁÁ•É…Í” ¤¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1„‘•Ù¥Í”‘Ô½µÁÑ”‰…¹…¥É”‘½¥Ð½ÉÉ•ÍÁ½¹‘É”„•±±”‘”±„…É…¹Ñ¥”¸œ¤ì(€€€ô(€€€É•ÑÕÉ¸…½Õ¹Ðì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÙ…±¥‘…Ñ•	…¹­½Õ¹Ñ½ÉQ•¹…¹ÑÉ•‘¥Ð¡±¥•¹ÐèA½½±±¥•¹Ð°‰…¹­½Õ¹Ñ%è¹Õµ‰•ÈðÕ¹‘•™¥¹•°Á…åµ•¹ÑÕÉÉ•¹äèÍÑÉ¥¹œ¤ì(€€€½¹ÍÐ…½Õ¹Ñ%€ô9Õµ‰•È¡‰…¹­½Õ¹Ñ%€üü€À¤ì(€€€¥˜€ ……½Õ¹Ñ%¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ U¸½µÁÑ”‰…¹…¥É”…Ñ¥˜•ÍÐÉ•ÅÕ¥ÌÁ½ÕÈÕ¸Ë¥‘¥Ð±½…Ñ…¥É”Á…È‰…¹ÅÕ”¸œ¤ì(€€€ô(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P¥°‰…¹­}¹…µ”°…½Õ¹Ñ}¹…µ”°ÕÉÉ•¹ä°ÍÑ…ÑÕÌ(€€€€€€I=4‰…¹­}…½Õ¹ÑÌ(€€€€€€]!I¥€ô€Ä(€€€€€€€€9½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U11€°(€€€€€m…½Õ¹Ñ%°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€½¹ÍÐ…½Õ¹Ð€ôÉ•ÅÕ¥É•I½Ü¡É½ÝÍlÁt°€	…¹¬…½Õ¹Ðœ¤ì(€€€¥˜€¡MÑÉ¥¹œ¡…½Õ¹Ð¹ÍÑ…ÑÕÌ¤¹Ñ½UÁÁ•É…Í” ¤€„ôô€Q%Yœ¤ì(€€€€€Ñ¡É½Ü¹•Ü½¹™±¥Ñá•ÁÑ¥½¸ 1”½µÁÑ”‰…¹…¥É”Í•±•Ñ¥½¹¹”‘½¥Ð•ÑÉ”…Ñ¥˜¸œ¤ì(€€€ô(€€€¥˜€¡MÑÉ¥¹œ¡…½Õ¹Ð¹ÕÉÉ•¹ä¤¹Ñ½UÁÁ•É…Í” ¤€„ôôMÑÉ¥¹œ¡Á…åµ•¹ÑÕÉÉ•¹ä¤¹Ñ½UÁÁ•É…Í” ¤¤ì(€€€€€Ñ¡É½Ü¹•Ü½¹™±¥Ñá•ÁÑ¥½¸ 1„‘•Ù¥Í”‘Ô½µÁÑ”‰…¹…¥É”‘½¥Ð½ÉÉ•ÍÁ½¹‘É”„•±±”‘ÔË¥‘¥Ð±½…Ñ…¥É”¸œ¤ì(€€€ô(€€€É•ÑÕÉ¸…½Õ¹Ðì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÙ…±¥‘…Ñ•áÁ•¹Í•…Ñ•½Éä¡±¥•¹ÐèA½½±±¥•¹Ð°…Ñ•½Éå½‘”èÕ¹­¹½Ý¸¤ì(€€€½¹ÍÐ½‘”€ôMÑÉ¥¹œ¡…Ñ•½Éå½‘”€üü€œœ¤¹ÑÉ¥´ ¤ì(€€€¥˜€ …½‘”¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1„…Ó¥½É¥”‘”“¥Á•¹Í”•ÍÐ½‰±¥…Ñ½¥É”¸œ¤ì(€€€ô(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P¥°½‘”°¹…µ”°ÍÑ…ÑÕÌ(€€€€€€I=4…Í¡}•áÁ•¹Í•}…Ñ•½É¥•Ì(€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€9½‘”€ô€È(€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U11€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°½‘•t°(€€€€¤ì(€€€½¹ÍÐ…Ñ•½Éä€ôÉ•ÅÕ¥É•I½Ü¡É½ÝÍlÁt°€…Í •áÁ•¹Í”…Ñ•½Éäœ¤ì(€€€¥˜€¡MÑÉ¥¹œ¡…Ñ•½Éä¹ÍÑ…ÑÕÌ¤¹Ñ½UÁÁ•É…Í” ¤€„ôô€Q%Yœ¤ì(€€€€€Ñ¡É½Ü¹•Ü½¹™±¥Ñá•ÁÑ¥½¸ 1„…Ó¥½É¥”‘”“¥Á•¹Í”Ï¥±•Ñ¥½¹»¥”‘½¥Ð•ÑÉ”…Ñ¥Ù”¸œ¤ì(€€€ô(€€€É•ÑÕÉ¸…Ñ•½Éäì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÙ…±¥‘…Ñ•	…¹­½Õ¹Ñ½ÉáÁ•¹Í”¡±¥•¹ÐèA½½±±¥•¹Ð°‰…¹­½Õ¹Ñ%è¹Õµ‰•ÈðÕ¹‘•™¥¹•°ÕÉÉ•¹äèÍÑÉ¥¹œ¤ì(€€€½¹ÍÐ…½Õ¹Ñ%€ô9Õµ‰•È¡‰…¹­½Õ¹Ñ%€üü€À¤ì(€€€¥˜€ ……½Õ¹Ñ%¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ U¸½µÁÑ”‰…¹…¥É”…Ñ¥˜•ÍÐÉ•ÅÕ¥ÌÁ½ÕÈÕ¹”“¥Á•¹Í”‰…¹…¥É”¸œ¤ì(€€€ô(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P‰„¸¨°(€€€€€€€€€€€€€=1M¡Ñà¹ÕÉÉ•¹Ñ}‰…±…¹”°€À¤èé9U5I% ÄÐ°È¤LÕÉÉ•¹Ñ}‰…±…¹”(€€€€€€I=4‰…¹­}…½Õ¹ÑÌ‰„(€€€€€€1P)=%8€ (€€€€€€€€M1P‰Ð¹‰…¹­}…½Õ¹Ñ}¥°(€€€€€€€€€€€€€€€MU4¡M]!8‰Ð¹ÍÑ…ÑÕÌ€ô€Y1%Qœ9‰Ð¹‘¥É•Ñ¥½¸€ô€%8œQ!8‰Ð¹…µ½Õ¹Ð1M€µ‰Ð¹…µ½Õ¹Ð9¤LÕÉÉ•¹Ñ}‰…±…¹”(€€€€€€€€I=4‰…¹­}ÑÉ…¹Í…Ñ¥½¹Ì‰Ð(€€€€€€€€]!I‰Ð¹½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€I=U@	d‰Ð¹‰…¹­}…½Õ¹Ñ}¥(€€€€€€€¤Ñà=8Ñà¹‰…¹­}…½Õ¹Ñ}¥€ô‰„¹¥(€€€€€€]!I‰„¹¥€ô€È(€€€€€€€€9‰„¹½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€9‰„¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€=HUAQ€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°…½Õ¹Ñ%‘t°(€€€€¤ì(€€€½¹ÍÐ…½Õ¹Ð€ôÉ½ÝÍlÁtì(€€€¥˜€ ……½Õ¹Ð¤ì(€€€€€Ñ¡É½Ü¹•Ü9½Ñ½Õ¹‘á•ÁÑ¥½¸ ½µÁÑ”‰…¹…¥É”¥¹ÑÉ½ÕÙ…‰±”‘…¹Ì•ÑÑ”½É…¹¥Í…Ñ¥½¸¸œ¤ì(€€€ô(€€€¥˜€¡MÑÉ¥¹œ¡…½Õ¹Ð¹ÍÑ…ÑÕÌ¤¹Ñ½UÁÁ•É…Í” ¤€„ôô€Q%Yœ¤ì(€€€€€Ñ¡É½Ü¹•Ü½¹™±¥Ñá•ÁÑ¥½¸ 1”½µÁÑ”‰…¹…¥É”Í•±•Ñ¥½¹¹”‘½¥Ð•ÑÉ”…Ñ¥˜¸œ¤ì(€€€ô(€€€¥˜€¡MÑÉ¥¹œ¡…½Õ¹Ð¹ÕÉÉ•¹ä¤¹Ñ½UÁÁ•É…Í” ¤€„ôôMÑÉ¥¹œ¡ÕÉÉ•¹ä¤¹Ñ½UÁÁ•É…Í” ¤¤ì(€€€€€Ñ¡É½Ü¹•Ü½¹™±¥Ñá•ÁÑ¥½¸ 1„‘•Ù¥Í”‘Ô½µÁÑ”‰…¹…¥É”‘½¥Ð½ÉÉ•ÍÁ½¹‘É”„•±±”‘”±„“¥Á•¹Í”¸œ¤ì(€€€ô(€€€É•ÑÕÉ¸…½Õ¹Ðì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÉ•…Ñ•	…¹­áÁ•¹Í•%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹ÐèA½½±±¥•¹Ð°‰½‘äèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø¤ì(€€€½¹ÍÐ…Ñ•½Éä€ô…Ý…¥ÐÑ¡¥Ì¹Ù…±¥‘…Ñ•áÁ•¹Í•…Ñ•½Éä¡±¥•¹Ð°‰½‘ä¹…Ñ•½Éä¤ì(€€€½¹ÍÐÕÉÉ•¹ä€ôMÑÉ¥¹œ¡‰½‘ä¹ÕÉÉ•¹ä€üü€œœ¤¹ÑÉ¥´ ¤¹Ñ½UÁÁ•É…Í” ¤ì(€€€½¹ÍÐ…µ½Õ¹Ð€ô9Õµ‰•È¡‰½‘ä¹…µ½Õ¹Ð€üü€À¤ì(€€€½¹ÍÐµ½Ù•µ•¹Ñ…Ñ”€ôÑ¡¥Ì¹¹½Éµ…±¥é•1•…Í•A…å±½…‘…Ñ”¡‰½‘ä¹µ½Ù•µ•¹Ñ}‘…Ñ”€üüÑ¡¥Ì¹±½…±…Ñ•MÑÉ¥¹œ¡¹•Ü…Ñ” ¤¤°€µ½Ù•µ•¹Ñ}‘…Ñ”œ°ÑÉÕ”¤ì(€€€½¹ÍÐÑÉ…¹Í…Ñ¥½¹QåÁ”€ô…Ý…¥ÐÑ¡¥Ì¹‰…¹­Õ…É…¹Ñ••QÉ…¹Í…Ñ¥½¹QåÁ”¡±¥•¹Ð°€	9-}aA9Mœ¤ì(€€€½¹ÍÐÍÕÁÁ½ÉÑÍ…Ñ•½Éä€ô…Ý…¥ÐÑ¡¥Ì¹½±Õµ¹á¥ÍÑÌ ‰…¹­}ÑÉ…¹Í…Ñ¥½¹Ìœ°€…Ñ•½Éäœ¤ì(€€€½¹ÍÐÍÕÁÁ½ÉÑÍÑÑ…¡µ•¹Ñ9…µ”€ô…Ý…¥ÐÑ¡¥Ì¹½±Õµ¹á¥ÍÑÌ ‰…¹­}ÑÉ…¹Í…Ñ¥½¹Ìœ°€…ÑÑ…¡µ•¹Ñ}™¥±•}¹…µ”œ¤ì(€€€½¹ÍÐÍÕÁÁ½ÉÑÍÑÑ…¡µ•¹ÑUÉ°€ô…Ý…¥ÐÑ¡¥Ì¹½±Õµ¹á¥ÍÑÌ ‰…¹­}ÑÉ…¹Í…Ñ¥½¹Ìœ°€…ÑÑ…¡µ•¹Ñ}™¥±•}ÕÉ°œ¤ì(€€€¥˜€ …lUMœ°€t¹¥¹±Õ‘•Ì¡ÕÉÉ•¹ä¤¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ •Ù¥Í”‰…¹…¥É”¥¹Ù…±¥‘”¸œ¤ì(€€€ô(€€€¥˜€ …9Õµ‰•È¹¥Í¥¹¥Ñ”¡…µ½Õ¹Ð¤ñð…µ½Õ¹Ð€ðô€À¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1”µ½¹Ñ…¹Ð‘”±„“¥Á•¹Í”‰…¹…¥É”•ÍÐ¥¹Ù…±¥‘”¸œ¤ì(€€€ô(€€€½¹ÍÐ‰…¹­½Õ¹Ð€ô…Ý…¥ÐÑ¡¥Ì¹Ù…±¥‘…Ñ•	…¹­½Õ¹Ñ½ÉáÁ•¹Í”¡±¥•¹Ð°9Õµ‰•È¡‰½‘ä¹‰…¹­}…½Õ¹Ñ}¥€üü€À¤°ÕÉÉ•¹ä¤ì(€€€½¹ÍÐÑÉ…¹Í…Ñ¥½¹9Õµ‰•È€ô…Ý…¥ÐÑ¡¥Ì¹¹•áÑ	…¹­QÉ…¹Í…Ñ¥½¹9Õµ‰•È¡±¥•¹Ð¤ì(€€€½¹ÍÐ¹½Éµ…±¥é•‘I•™•É•¹”€ôMÑÉ¥¹œ¡‰½‘ä¹É•™•É•¹”€üü€œœ¤¹ÑÉ¥´ ¤ñð¹Õ±°ì(€€€½¹ÍÐÍÕÁÁ±¥•É9…µ”€ôMÑÉ¥¹œ¡‰½‘ä¹ÍÕÁÁ±¥•È€üü€œœ¤¹ÑÉ¥´ ¤ñð¹Õ±°ì(€€€½¹ÍÐ‘•ÍÉ¥ÁÑ¥½¸€ôMÑÉ¥¹œ¡‰½‘ä¹‘•ÍÉ¥ÁÑ¥½¸€üü€œœ¤¹ÑÉ¥´ ¤ñðMÑÉ¥¹œ¡‰½‘ä¹±…‰•°€üü€œœ¤¹ÑÉ¥´ ¤ñð…Ñ•½Éä¹¹…µ”ì(€€€½¹ÍÐ¥‘•µÁ½Ñ•¹å-•ä€ôMÑÉ¥¹œ¡‰½‘ä¹¥‘•µÁ½Ñ•¹å}­•ä€üül(€€€€€€	9-}aA9Mœ°(€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°(€€€€€‰…¹­½Õ¹Ð¹¥°(€€€€€…Ñ•½Éä¹½‘”°(€€€€€µ½Ù•µ•¹Ñ…Ñ”°(€€€€€ÕÉÉ•¹ä°(€€€€€…µ½Õ¹Ð¹Ñ½¥á• È¤°(€€€€€¹½Éµ…±¥é•‘I•™•É•¹”€üüÍÕÁÁ±¥•É9…µ”€üü€aA9Mœ°(€€€t¹©½¥¸ œèœ¤¤ì(€€€½¹ÍÐ¥¹Í•ÉÑ½±Õµ¹Ì€ôl(€€€€€€½É…¹¥é…Ñ¥½¹}¥œ°(€€€€€€‰…¹­}…½Õ¹Ñ}¥œ°(€€€€€€ÑÉ…¹Í…Ñ¥½¹}¹Õµ‰•Èœ°(€€€€€€ÑÉ…¹Í…Ñ¥½¹}‘…Ñ”œ°(€€€€€€‘¥É•Ñ¥½¸œ°(€€€€€€ÑÉ…¹Í…Ñ¥½¹}ÑåÁ”œ°(€€€€€€…µ½Õ¹Ðœ°(€€€€€€ÕÉÉ•¹äœ°(€€€€€€É•™•É•¹”œ°(€€€€€€‘•ÍÉ¥ÁÑ¥½¸œ°(€€€€€€½Õ¹Ñ•ÉÁ…ÉÑå}¹…µ”œ°(€€€€€€Í½ÕÉ•}µ½‘Õ±”œ°(€€€€€€Í½ÕÉ•}•¹Ñ¥Ñå}ÑåÁ”œ°(€€€€€€Í½ÕÉ•}•¹Ñ¥Ñå}¥œ°(€€€€€€ÍÑ…ÑÕÌœ°(€€€€€€É•Ù•ÉÍ…±}½™}¥œ°(€€€€€€¥‘•µÁ½Ñ•¹å}­•äœ°(€€€€€€É•…Ñ•‘}‰äœ°(€€€tì(€€€½¹ÍÐ¥¹Í•ÉÑY…±Õ•ÌèÕ¹­¹½Ý¹mt€ôl(€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°(€€€€€9Õµ‰•È¡‰…¹­½Õ¹Ð¹¥¤°(€€€€€ÑÉ…¹Í…Ñ¥½¹9Õµ‰•È°(€€€€€µ½Ù•µ•¹Ñ…Ñ”°(€€€€€€=UPœ°(€€€€€ÑÉ…¹Í…Ñ¥½¹QåÁ”°(€€€€€…µ½Õ¹Ð°(€€€€€MÑÉ¥¹œ¡ÕÉÉ•¹ä¤¹Ñ½UÁÁ•É…Í” ¤°(€€€€€¹½Éµ…±¥é•‘I•™•É•¹”°(€€€€€‘•ÍÉ¥ÁÑ¥½¸°(€€€€€ÍÕÁÁ±¥•É9…µ”°(€€€€€€aA9MLœ°(€€€€€€aA9Mœ°(€€€€€¹Õ±°°(€€€€€€Y1%Qœ°(€€€€€¹Õ±°°(€€€€€¥‘•µÁ½Ñ•¹å-•ä°(€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•É% ¤€üü€Ä°(€€€tì(€€€¥˜€¡ÍÕÁÁ½ÉÑÍ…Ñ•½Éä¤ì(€€€€€¥¹Í•ÉÑ½±Õµ¹Ì¹ÁÕÍ  …Ñ•½Éäœ¤ì(€€€€€¥¹Í•ÉÑY…±Õ•Ì¹ÁÕÍ ¡…Ñ•½Éä¹½‘”¤ì(€€€ô(€€€¥˜€¡ÍÕÁÁ½ÉÑÍÑÑ…¡µ•¹Ñ9…µ”¤ì(€€€€€¥¹Í•ÉÑ½±Õµ¹Ì¹ÁÕÍ  …ÑÑ…¡µ•¹Ñ}™¥±•}¹…µ”œ¤ì(€€€€€¥¹Í•ÉÑY…±Õ•Ì¹ÁÕÍ ¡‰½‘ä¹…ÑÑ…¡µ•¹Ñ}™¥±•}¹…µ”€üü¹Õ±°¤ì(€€€ô(€€€¥˜€¡ÍÕÁÁ½ÉÑÍÑÑ…¡µ•¹ÑUÉ°¤ì(€€€€€¥¹Í•ÉÑ½±Õµ¹Ì¹ÁÕÍ  …ÑÑ…¡µ•¹Ñ}™¥±•}ÕÉ°œ¤ì(€€€€€¥¹Í•ÉÑY…±Õ•Ì¹ÁÕÍ ¡‰½‘ä¹…ÑÑ…¡µ•¹Ñ}™¥±•}ÕÉ°€üü¹Õ±°¤ì(€€€ô(€€€½¹ÍÐ¥¹Í•ÉÑA±…•¡½±‘•ÉÌ€ô¥¹Í•ÉÑY…±Õ•Ì¹µ…À ¡|°¥¹‘•à¤€ôø€‘í¥¹‘•à€¬€Åõ€¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€%9MIP%9Q<‰…¹­}ÑÉ…¹Í…Ñ¥½¹Ì(€€€€€€€€ ‘í¥¹Í•ÉÑ½±Õµ¹Ì¹©½¥¸ œ°€œ¥ô¤(€€€€€€Y1UL(€€€€€€€€ ‘í¥¹Í•ÉÑA±…•¡½±‘•ÉÌ¹©½¥¸ œ°€œ¥ô¤(€€€€€€=8=91%P€¡½É…¹¥é…Ñ¥½¹}¥°¥‘•µÁ½Ñ•¹å}­•ä¤(€€€€€€]!I¥‘•µÁ½Ñ•¹å}­•ä%L9=P9U10(€€€€€€<9=Q!%9(€€€€€€IQUI9%9€©€°(€€€€€¥¹Í•ÉÑY…±Õ•Ì°(€€€€¤ì(€€€±•ÐÑÉ…¹Í…Ñ¥½¸€ôÉ½ÝÍlÁtì(€€€¥˜€ …ÑÉ…¹Í…Ñ¥½¸¤ì(€€€€€½¹ÍÐ•á¥ÍÑ¥¹œ€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€M1P€¨(€€€€€€€€I=4‰…¹­}ÑÉ…¹Í…Ñ¥½¹Ì(€€€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€€€9¥‘•µÁ½Ñ•¹å}­•ä€ô€È(€€€€€€€€1%5%P€Å€°(€€€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°¥‘•µÁ½Ñ•¹å-•åt°(€€€€€€¤ì(€€€€€ÑÉ…¹Í…Ñ¥½¸€ô•á¥ÍÑ¥¹œ¹É½ÝÍlÁtì(€€€ô(€€€ÑÉ…¹Í…Ñ¥½¸€ôÉ•ÅÕ¥É•I½Ü¡ÑÉ…¹Í…Ñ¥½¸°€	…¹¬ÑÉ…¹Í…Ñ¥½¸œ¤ì(€€€¥˜€ …ÑÉ…¹Í…Ñ¥½¸¹Í½ÕÉ•}•¹Ñ¥Ñå}¥¤ì(€€€€€½¹ÍÐÕÁ‘…Ñ•Y…±Õ•ÌèÕ¹­¹½Ý¹mt€ômÑÉ…¹Í…Ñ¥½¸¹¥°ÑÉ…¹Í…Ñ¥½¸¹¥‘tì(€€€€€½¹ÍÐÕÁ‘…Ñ•M•ÐèÍÑÉ¥¹mt€ôlÍ½ÕÉ•}•¹Ñ¥Ñå}¥€ô€Ètì(€€€€€¥˜€¡ÍÕÁÁ½ÉÑÍ…Ñ•½Éä¤ì(€€€€€€€ÕÁ‘…Ñ•Y…±Õ•Ì¹ÁÕÍ ¡…Ñ•½Éä¹½‘”¤ì(€€€€€€€ÕÁ‘…Ñ•M•Ð¹ÁÕÍ ¡…Ñ•½Éä€ô=1M ‘íÕÁ‘…Ñ•Y…±Õ•Ì¹±•¹Ñ¡ô°…Ñ•½Éä¥€¤ì(€€€€€ô(€€€€€¥˜€¡ÍÕÁÁ½ÉÑÍÑÑ…¡µ•¹Ñ9…µ”¤ì(€€€€€€€ÕÁ‘…Ñ•Y…±Õ•Ì¹ÁÕÍ ¡‰½‘ä¹…ÑÑ…¡µ•¹Ñ}™¥±•}¹…µ”€üü¹Õ±°¤ì(€€€€€€€ÕÁ‘…Ñ•M•Ð¹ÁÕÍ ¡…ÑÑ…¡µ•¹Ñ}™¥±•}¹…µ”€ô=1M ‘íÕÁ‘…Ñ•Y…±Õ•Ì¹±•¹Ñ¡ô°…ÑÑ…¡µ•¹Ñ}™¥±•}¹…µ”¥€¤ì(€€€€€ô(€€€€€¥˜€¡ÍÕÁÁ½ÉÑÍÑÑ…¡µ•¹ÑUÉ°¤ì(€€€€€€€ÕÁ‘…Ñ•Y…±Õ•Ì¹ÁÕÍ ¡‰½‘ä¹…ÑÑ…¡µ•¹Ñ}™¥±•}ÕÉ°€üü¹Õ±°¤ì(€€€€€€€ÕÁ‘…Ñ•M•Ð¹ÁÕÍ ¡…ÑÑ…¡µ•¹Ñ}™¥±•}ÕÉ°€ô=1M ‘íÕÁ‘…Ñ•Y…±Õ•Ì¹±•¹Ñ¡ô°…ÑÑ…¡µ•¹Ñ}™¥±•}ÕÉ°¥€¤ì(€€€€€ô(€€€€€ÕÁ‘…Ñ•Y…±Õ•Ì¹ÁÕÍ ¡Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤¤ì(€€€€€½¹ÍÐÕÁ‘…Ñ•€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€UAQ‰…¹­}ÑÉ…¹Í…Ñ¥½¹Ì(€€€€€€€€MP€‘íÕÁ‘…Ñ•M•Ð¹©½¥¸ œ°€œ¥ô(€€€€€€€€]!I¥€ô€Ä9½É…¹¥é…Ñ¥½¹}¥€ô€‘íÕÁ‘…Ñ•Y…±Õ•Ì¹±•¹Ñ¡ô(€€€€€€€€IQUI9%9€©€°(€€€€€€€ÕÁ‘…Ñ•Y…±Õ•Ì°(€€€€€€¤ì(€€€€€ÑÉ…¹Í…Ñ¥½¸€ôÉ•ÅÕ¥É•I½Ü¡ÕÁ‘…Ñ•¹É½ÝÍlÁt°€	…¹¬ÑÉ…¹Í…Ñ¥½¸œ¤ì(€€€ô(€€€É•ÑÕÉ¸ÑÉ…¹Í…Ñ¥½¸ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ‰…¹­Õ…É…¹Ñ••QÉ…¹Í…Ñ¥½¹QåÁ”¡±¥•¹ÐèA½½±±¥•¹Ð°ÑÉ…¹Í…Ñ¥½¹QåÁ”èÍÑÉ¥¹œ¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1Pa%MQL€ (€€€€€€€€M1P€Ä(€€€€€€€€I=4Á}½¹ÍÑÉ…¥¹ÐŒ(€€€€€€€€)=%8Á}±…ÍÌÐ=8Ð¹½¥€ôŒ¹½¹É•±¥(€€€€€€€€)=%8Á}¹…µ•ÍÁ…”¸=8¸¹½¥€ôÐ¹É•±¹…µ•ÍÁ…”(€€€€€€€€]!I¸¹¹ÍÁ¹…µ”€ô€ÁÕ‰±¥Œœ(€€€€€€€€€€9Ð¹É•±¹…µ”€ô€‰…¹­}ÑÉ…¹Í…Ñ¥½¹Ìœ(€€€€€€€€€€9Œ¹½¹ÑåÁ”€ô€Œœ(€€€€€€€€€€9Á}•Ñ}½¹ÍÑÉ…¥¹Ñ‘•˜¡Œ¹½¥¤%1%-€œ”œñð€Äñð€œ”œ(€€€€€€€¤LÍÕÁÁ½ÉÑ•‘€°(€€€€€mÑÉ…¹Í…Ñ¥½¹QåÁ•t°(€€€€¤ì(€€€É•ÑÕÉ¸É½ÝÍlÁtü¹ÍÕÁÁ½ÉÑ•€üÑÉ…¹Í…Ñ¥½¹QåÁ”€è€59U1})UMQ59Pœì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÉ•…Ñ•Õ…É…¹Ñ••	…¹­QÉ…¹Í…Ñ¥½¹%¹QÉ…¹Í…Ñ¥½¸ (€€€±¥•¹ÐèA½½±±¥•¹Ð°(€€€Á…å±½…èì(€€€€€‰…¹­½Õ¹Ðèì¥è¹Õµ‰•Èì‰…¹­}¹…µ”üèÍÑÉ¥¹œð¹Õ±°ì…½Õ¹Ñ}¹…µ”üèÍÑÉ¥¹œð¹Õ±°ìÕÉÉ•¹äèÍÑÉ¥¹œôì(€€€€€…µ½Õ¹Ðè¹Õµ‰•Èì(€€€€€ÕÉÉ•¹äèÍÑÉ¥¹œì(€€€€€É••¥ÁÑ9Õµ‰•ÈèÍÑÉ¥¹œì(€€€€€É•™•É•¹”üèÍÑÉ¥¹œð¹Õ±°ì(€€€€€É•…Ñ•‘	äè¹Õµ‰•Èð¹Õ±°ì(€€€€€ÑÉ…¹Í…Ñ¥½¹QåÁ”èÍÑÉ¥¹œì(€€€€€Í½ÕÉ•5½‘Õ±”èÍÑÉ¥¹œì(€€€€€‘¥É•Ñ¥½¸è€%8œð€=UPœì(€€€€€Í½ÕÉ•¹Ñ¥ÑåQåÁ”èÍÑÉ¥¹œì(€€€€€Í½ÕÉ•¹Ñ¥Ñå%è¹Õµ‰•Èì(€€€€€‘•ÍÉ¥ÁÑ¥½¸èÍÑÉ¥¹œì(€€€€€Ñ•¹…¹Ñ9…µ”üèÍÑÉ¥¹œð¹Õ±°ì(€€€€€±•…Í•9Õµ‰•Èüè¹Õµ‰•ÈðÍÑÉ¥¹œð¹Õ±°ì(€€€€€Õ¹¥Ñ9Õµ‰•ÈüèÍÑÉ¥¹œð¹Õ±°ì(€€€ô°(€€¤ì(€€€½¹ÍÐÑÉ…¹Í…Ñ¥½¹9Õµ‰•È€ô…Ý…¥ÐÑ¡¥Ì¹¹•áÑ	…¹­QÉ…¹Í…Ñ¥½¹9Õµ‰•È¡±¥•¹Ð¤ì(€€€½¹ÍÐ…µ½Õ¹Ð€ô9Õµ‰•È¡Á…å±½…¹…µ½Õ¹Ð€üü€À¤ì(€€€¥˜€ …9Õµ‰•È¹¥Í¥¹¥Ñ”¡…µ½Õ¹Ð¤ñð…µ½Õ¹Ð€ðô€À¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1”µ½¹Ñ…¹Ð‘Ôµ½ÕÙ•µ•¹Ð‰…¹…¥É”•ÍÐ¥¹Ù…±¥‘”¸œ¤ì(€€€ô(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€%9MIP%9Q<‰…¹­}ÑÉ…¹Í…Ñ¥½¹Ì(€€€€€€€€¡½É…¹¥é…Ñ¥½¹}¥°‰…¹­}…½Õ¹Ñ}¥°ÑÉ…¹Í…Ñ¥½¹}¹Õµ‰•È°ÑÉ…¹Í…Ñ¥½¹}‘…Ñ”°‘¥É•Ñ¥½¸°ÑÉ…¹Í…Ñ¥½¹}ÑåÁ”°…µ½Õ¹Ð°ÕÉÉ•¹ä°(€€€€€€€€É•™•É•¹”°‘•ÍÉ¥ÁÑ¥½¸°½Õ¹Ñ•ÉÁ…ÉÑå}¹…µ”°Í½ÕÉ•}µ½‘Õ±”°Í½ÕÉ•}•¹Ñ¥Ñå}ÑåÁ”°Í½ÕÉ•}•¹Ñ¥Ñå}¥°ÍÑ…ÑÕÌ°É•Ù•ÉÍ…±}½™}¥°(€€€€€€€€¥‘•µÁ½Ñ•¹å}­•ä°É•…Ñ•‘}‰ä¤(€€€€€€Y1UL(€€€€€€€€ Ä°€È°€Ì°UII9Q}Q°€Ð°€Ô°€Ø°€Ü°(€€€€€€€€€à°€ä°€ÄÀ°€ÄÄ°€ÄÈ°€ÄÌ°€Y1%Qœ°9U10°(€€€€€€€€€ÄÐ°€ÄÔ¤(€€€€€€IQUI9%9€©€°(€€€€€l(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°(€€€€€€€Á…å±½…¹‰…¹­½Õ¹Ð¹¥°(€€€€€€€ÑÉ…¹Í…Ñ¥½¹9Õµ‰•È°(€€€€€€€Á…å±½…¹‘¥É•Ñ¥½¸°(€€€€€€€Á…å±½…¹ÑÉ…¹Í…Ñ¥½¹QåÁ”°(€€€€€€€…µ½Õ¹Ð°(€€€€€€€MÑÉ¥¹œ¡Á…å±½…¹ÕÉÉ•¹ä¤¹Ñ½UÁÁ•É…Í” ¤°(€€€€€€€MÑÉ¥¹œ¡Á…å±½…¹É•™•É•¹”€üü€œœ¤¹ÑÉ¥´ ¤ñðÁ…å±½…¹É••¥ÁÑ9Õµ‰•È°(€€€€€€€Á…å±½…¹‘•ÍÉ¥ÁÑ¥½¸°(€€€€€€€Á…å±½…¹Ñ•¹…¹Ñ9…µ”€üü¹Õ±°°(€€€€€€€Á…å±½…¹Í½ÕÉ•5½‘Õ±”°(€€€€€€€Á…å±½…¹Í½ÕÉ•¹Ñ¥ÑåQåÁ”°(€€€€€€€Á…å±½…¹Í½ÕÉ•¹Ñ¥Ñå%°(€€€€€€€€‘íMÑÉ¥¹œ¡Á…å±½…¹Í½ÕÉ•5½‘Õ±”¤¹Ñ½1½Ý•É…Í” ¥ô´‘íMÑÉ¥¹œ¡Á…å±½…¹‘¥É•Ñ¥½¸¤¹Ñ½1½Ý•É…Í” ¥ôè‘íÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥ôè‘íÁ…å±½…¹Í½ÕÉ•5½‘Õ±•ôè‘íÁ…å±½…¹ÑÉ…¹Í…Ñ¥½¹QåÁ•ôè‘íÁ…å±½…¹Í½ÕÉ•¹Ñ¥ÑåQåÁ•ôè‘íÁ…å±½…¹Í½ÕÉ•¹Ñ¥Ñå%‘ôè‘íÁ…å±½…¹É•™•É•¹”€üüÁ…å±½…¹É••¥ÁÑ9Õµ‰•Éõ€°(€€€€€€€Á…å±½…¹É•…Ñ•‘	ä°(€€€€€t°(€€€€¤ì(€€€É•ÑÕÉ¸É½ÝÍlÁtì(€ô((€…Íå¹ŒÑ•¹…¹ÑÉ•‘¥ÑÌ¡™¥±Ñ•ÉÌèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø€ôíô¤ì(€€€…Ý…¥ÐÑ¡¥Ì¹•¹ÍÕÉ•Q•¹…¹ÑÉ•‘¥ÑM¡•µ„ ¤ì(€€€½¹ÍÐÙ…±Õ•ÌèÕ¹­¹½Ý¹mt€ômÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥tì(€€€½¹ÍÐ±…ÕÍ•Ì€ôlÑŒ¹½É…¹¥é…Ñ¥½¹}¥€ô€Äœ°€ÑŒ¹‘•±•Ñ•‘}…Ð%L9U10tì(€€€½¹ÍÐ…‘€ô€¡ÍÅ°èÍÑÉ¥¹œ°Ù…±Õ”èÕ¹­¹½Ý¸¤€ôøì(€€€€€Ù…±Õ•Ì¹ÁÕÍ ¡Ù…±Õ”¤ì(€€€€€±…ÕÍ•Ì¹ÁÕÍ ¡ÍÅ°¹É•Á±…” œüœ°€‘íÙ…±Õ•Ì¹±•¹Ñ¡õ€¤¤ì(€€€ôì(€€€¥˜€¡™¥±Ñ•ÉÌ¹Ñ•¹…¹Ñ}¥¤…‘ ÑŒ¹Ñ•¹…¹Ñ}¥€ô€üèé%9Pœ°9Õµ‰•È¡™¥±Ñ•ÉÌ¹Ñ•¹…¹Ñ}¥¤¤ì(€€€¥˜€¡™¥±Ñ•ÉÌ¹±•…Í•}¥¤…‘ ÑŒ¹±•…Í•}¥€ô€üèé%9Pœ°9Õµ‰•È¡™¥±Ñ•ÉÌ¹±•…Í•}¥¤¤ì(€€€¥˜€¡™¥±Ñ•ÉÌ¹ÍÑ…ÑÕÌ¤…‘ ÑŒ¹ÍÑ…ÑÕÌ€ô€üœ°MÑÉ¥¹œ¡™¥±Ñ•ÉÌ¹ÍÑ…ÑÕÌ¤¹Ñ½UÁÁ•É…Í” ¤¤ì(€€€¥˜€¡™¥±Ñ•ÉÌ¹ÕÉÉ•¹ä¤…‘ ÑŒ¹ÕÉÉ•¹ä€ô€üœ°MÑÉ¥¹œ¡™¥±Ñ•ÉÌ¹ÕÉÉ•¹ä¤¹Ñ½UÁÁ•É…Í” ¤¤ì(€€€¥˜€¡™¥±Ñ•ÉÌ¹ÍÑ…ÉÐ¤…‘ ÑŒ¹Á…åµ•¹Ñ}‘…Ñ”€øô€üèéQœ°MÑÉ¥¹œ¡™¥±Ñ•ÉÌ¹ÍÑ…ÉÐ¤¤ì(€€€¥˜€¡™¥±Ñ•ÉÌ¹•¹¤…‘ ÑŒ¹Á…åµ•¹Ñ}‘…Ñ”€ðô€üèéQœ°MÑÉ¥¹œ¡™¥±Ñ•ÉÌ¹•¹¤¤ì(€€€¥˜€¡™¥±Ñ•ÉÌ¹¥¤…‘ ÑŒ¹¥€ô€üèé%9Pœ°9Õµ‰•È¡™¥±Ñ•ÉÌ¹¥¤¤ì(€€€½¹ÍÐÍ•…É €ôMÑÉ¥¹œ¡™¥±Ñ•ÉÌ¹Í•…É €üü€œœ¤¹ÑÉ¥´ ¤ì(€€€¥˜€¡Í•…É ¤ì(€€€€€½¹ÍÐÁ±…•¡½±‘•ÉÌ€ôlÄ°€È°€Ì°€Ð°€Õt¹µ…À  ¤€ôøì(€€€€€€€Ù…±Õ•Ì¹ÁÕÍ ¡Í•…É ¤ì(€€€€€€€É•ÑÕÉ¸€‘íÙ…±Õ•Ì¹±•¹Ñ¡õ€ì(€€€€€ô¤ì(€€€€€±…ÕÍ•Ì¹ÁÕÍ ¡€ (€€€€€€€ÑŒ¹É•™•É•¹”%1%-€œ”œñð€‘íÁ±…•¡½±‘•ÉÍlÁuôñð€œ”œ(€€€€€€€=HÀ¹É••¥ÁÑ}¹Õµ‰•È%1%-€œ”œñð€‘íÁ±…•¡½±‘•ÉÍlÅuôñð€œ”œ(€€€€€€€=HÑ•¹…¹Ñ}¹…µ”¹¹…µ”%1%-€œ”œñð€‘íÁ±…•¡½±‘•ÉÍlÉuôñð€œ”œ(€€€€€€€=HÔ¹¹Õµ‰•È%1%-€œ”œñð€‘íÁ±…•¡½±‘•ÉÍlÍuôñð€œ”œ(€€€€€€€=Hˆ¹¹…µ”%1%-€œ”œñð€‘íÁ±…•¡½±‘•ÉÍlÑuôñð€œ”œ(€€€€€€¥€¤ì(€€€ô(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1PÑŒ¸¨°À¹É••¥ÁÑ}¹Õµ‰•È°À¹Á…åµ•¹Ñ}µ•Ñ¡½°À¹…µ½Õ¹Ñ}ÕÍ°À¹…µ½Õ¹Ñ}‘˜°À¹Ñ½Ñ…±}•ÅÕ¥Ù…±•¹Ñ}ÕÍ°(€€€€€€€€€€€€€Ñ•¹…¹Ñ}¹…µ”¹¹…µ”LÑ•¹…¹Ñ}¹…µ”°(€€€€€€€€€€€€€Ð¹•µ…¥°LÑ•¹…¹Ñ}•µ…¥°°(€€€€€€€€€€€€€Ô¹¹Õµ‰•ÈLÕ¹¥Ñ}¹Õµ‰•È°ˆ¹¹…µ”L‰Õ¥±‘¥¹}¹…µ”°(€€€€€€€€€€€€€°¹±•…Í•}¹Õµ‰•È(€€€€€€I=4Ñ•¹…¹Ñ}É•‘¥ÑÌÑŒ(€€€€€€)=%8Á…åµ•¹ÑÌÀ=8À¹¥€ôÑŒ¹Í½ÕÉ•}Á…åµ•¹Ñ}¥9À¹½É…¹¥é…Ñ¥½¹}¥€ôÑŒ¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€)=%8Ñ•¹…¹ÑÌÐ=8Ð¹¥€ôÑŒ¹Ñ•¹…¹Ñ}¥9Ð¹½É…¹¥é…Ñ¥½¹}¥€ôÑŒ¹½É…¹¥é…Ñ¥½¹}¥9Ð¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€1P)=%81QI0€ (€€€€€€€€M1PM]!8Ð¹Ñ•¹…¹Ñ}ÑåÁ”€ô€=5A9dœQ!8=1M¡Ð¹½µÁ…¹å}¹…µ”°Ð¹™¥ÉÍÑ}¹…µ”°€œœ¤(€€€€€€€€€€€€€€€€€€€€1MQI%4¡=9P¡=1M¡Ð¹™¥ÉÍÑ}¹…µ”°€œœ¤°€œ€œ°=1M¡Ð¹±…ÍÑ}¹…µ”°€œœ¤°€œ€œ°=1M¡Ð¹Á½ÍÑ}¹…µ”°€œœ¤¤¤(€€€€€€€€€€€€€€€9L¹…µ”(€€€€€€€¤Ñ•¹…¹Ñ}¹…µ”=8QIU(€€€€€€1P)=%8±•…Í•Ì°=8°¹¥€ôÑŒ¹±•…Í•}¥9°¹½É…¹¥é…Ñ¥½¹}¥€ôÑŒ¹½É…¹¥é…Ñ¥½¹}¥9°¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€1P)=%8Õ¹¥ÑÌÔ=8Ô¹¥€ô°¹Õ¹¥Ñ}¥9Ô¹½É…¹¥é…Ñ¥½¹}¥€ôÑŒ¹½É…¹¥é…Ñ¥½¹}¥9Ô¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€1P)=%8‰Õ¥±‘¥¹Ìˆ=8ˆ¹¥€ôÔ¹‰Õ¥±‘¥¹}¥9ˆ¹½É…¹¥é…Ñ¥½¹}¥€ôÑŒ¹½É…¹¥é…Ñ¥½¹}¥9ˆ¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€]!I€‘í±…ÕÍ•Ì¹©½¥¸ œ9€œ¥ô(€€€€€€=IH	dÑŒ¹Á…åµ•¹Ñ}‘…Ñ”M°ÑŒ¹¥M€°(€€€€€Ù…±Õ•Ì°(€€€€¤ì(€€€É•ÑÕÉ¸É½ÝÌì(€ô((€…Íå¹ŒÑÉ…Í¡•‘Q•¹…¹ÑÉ•‘¥ÑÌ ¤ì(€€€…Ý…¥ÐÑ¡¥Ì¹•¹ÍÕÉ•Q•¹…¹ÑÉ•‘¥ÑM¡•µ„ ¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1PÑŒ¹¥°(€€€€€€€€€€€€€ÑŒ¹Ñ•¹…¹Ñ}¥°(€€€€€€€€€€€€€ÑŒ¹±•…Í•}¥°(€€€€€€€€€€€€€ÑŒ¹Í½ÕÉ•}Á…åµ•¹Ñ}¥°(€€€€€€€€€€€€€ÑŒ¹ÕÉÉ•¹ä°(€€€€€€€€€€€€€ÑŒ¹½É¥¥¹…±}…µ½Õ¹ÐL…µ½Õ¹Ð°(€€€€€€€€€€€€€ÑŒ¹½É¥¥¹…±}…µ½Õ¹Ð°(€€€€€€€€€€€€€ÑŒ¹É•µ…¥¹¥¹}…µ½Õ¹Ð°(€€€€€€€€€€€€€ÑŒ¹ÍÑ…ÑÕÌ°(€€€€€€€€€€€€€ÑŒ¹Á…åµ•¹Ñ}‘…Ñ”°(€€€€€€€€€€€€€ÑŒ¹É•™•É•¹”°(€€€€€€€€€€€€€ÑŒ¹¹½Ñ•Ì°(€€€€€€€€€€€€€ÑŒ¹É••¥ÁÑ}¹Õµ‰•È°(€€€€€€€€€€€€€ÑŒ¹Á…åµ•¹Ñ}µ•Ñ¡½°(€€€€€€€€€€€€€ÑŒ¹‘•±•Ñ•‘}…Ð°(€€€€€€€€€€€€€ÑŒ¹‘•±•Ñ¥½¹}É•…Í½¸°(€€€€€€€€€€€€€ÑŒ¹½É…¹¥é…Ñ¥½¹}¥°(€€€€€€€€€€€€€M]!8Ð¹Ñ•¹…¹Ñ}ÑåÁ”€ô€=5A9dœQ!8=1M¡Ð¹½µÁ…¹å}¹…µ”°€œœ¤(€€€€€€€€€€€€€€€€€€1MQI%4¡=9P¡=1M¡Ð¹™¥ÉÍÑ}¹…µ”°€œœ¤°€œ€œ°=1M¡Ð¹±…ÍÑ}¹…µ”°€œœ¤°€œ€œ°=1M¡Ð¹Á½ÍÑ}¹…µ”°€œœ¤¤¤(€€€€€€€€€€€€€9LÑ•¹…¹Ñ}¹…µ”°(€€€€€€€€€€€€€Ð¹•µ…¥°LÑ•¹…¹Ñ}•µ…¥°°(€€€€€€€€€€€€€Ô¹¹Õµ‰•ÈLÕ¹¥Ñ}¹Õµ‰•È°(€€€€€€€€€€€€€ˆ¹¹…µ”L‰Õ¥±‘¥¹}¹…µ”°(€€€€€€€€€€€€€°¹±•…Í•}¹Õµ‰•È°(€€€€€€€€€€€€€À¹É••¥ÁÑ}¹Õµ‰•ÈLÍ½ÕÉ•}É••¥ÁÑ}¹Õµ‰•È°(€€€€€€€€€€€€€=1M¡9U11%¡QI%4¡=9P¡=1M¡ÔÄ¹™¥ÉÍÑ}¹…µ”°€œœ¤°€œ€œ°=1M¡ÔÄ¹±…ÍÑ}¹…µ”°€œœ¤¤¤°€œœ¤°ÔÄ¹•µ…¥°¤L‘•±•Ñ•‘}‰å}¹…µ”(€€€€€€I=4Ñ•¹…¹Ñ}É•‘¥ÑÌÑŒ(€€€€€€)=%8Á…åµ•¹ÑÌÀ=8À¹¥€ôÑŒ¹Í½ÕÉ•}Á…åµ•¹Ñ}¥9À¹½É…¹¥é…Ñ¥½¹}¥€ôÑŒ¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€)=%8Ñ•¹…¹ÑÌÐ=8Ð¹¥€ôÑŒ¹Ñ•¹…¹Ñ}¥9Ð¹½É…¹¥é…Ñ¥½¹}¥€ôÑŒ¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€1P)=%8±•…Í•Ì°=8°¹¥€ôÑŒ¹±•…Í•}¥9°¹½É…¹¥é…Ñ¥½¹}¥€ôÑŒ¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€1P)=%8Õ¹¥ÑÌÔ=8Ô¹¥€ô°¹Õ¹¥Ñ}¥9Ô¹½É…¹¥é…Ñ¥½¹}¥€ôÑŒ¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€1P)=%8‰Õ¥±‘¥¹Ìˆ=8ˆ¹¥€ôÔ¹‰Õ¥±‘¥¹}¥9ˆ¹½É…¹¥é…Ñ¥½¹}¥€ôÑŒ¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€1P)=%8…ÁÁ}ÕÍ•ÉÌÔÄ=8ÔÄ¹¥€ôÑŒ¹‘•±•Ñ•‘}‰ä9ÔÄ¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€]!IÑŒ¹½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€9ÑŒ¹‘•±•Ñ•‘}…Ð%L9=P9U10(€€€€€€=IH	dÑŒ¹‘•±•Ñ•‘}…ÐM°ÑŒ¹¥M€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€É•ÑÕÉ¸É½ÝÌì(€ô((€…Íå¹ŒÑ•¹…¹ÑÉ•‘¥Ñ•Ñ…¥°¡¥è¹Õµ‰•È°¥¹±Õ‘••±•Ñ•€ô™…±Í”¤ì(€€€…Ý…¥ÐÑ¡¥Ì¹•¹ÍÕÉ•Q•¹…¹ÑÉ•‘¥ÑI•™Õ¹‘M¡•µ„ ¤ì(€€€½¹ÍÐ¡¥±‘•±•Ñ•‘±…ÕÍ”€ô¥¹±Õ‘••±•Ñ•€ü€%L9=P9U10œ€è€%L9U10œì(€€€½¹ÍÐìÉ½ÝÌè‘¥É•Ðô€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1PÑŒ¸¨°À¹É••¥ÁÑ}¹Õµ‰•È°À¹Á…åµ•¹Ñ}µ•Ñ¡½°À¹…µ½Õ¹Ñ}ÕÍ°À¹…µ½Õ¹Ñ}‘˜°À¹Ñ½Ñ…±}•ÅÕ¥Ù…±•¹Ñ}ÕÍ°(€€€€€€€€€€€€€µ½Ù•µ•¹Ð¹¥L…Í¡}µ½Ù•µ•¹Ñ}¥°(€€€€€€€€€€€€€µ½Ù•µ•¹Ð¹Á¥••}¹Õµ‰•ÈL…Í¡}Á¥••}¹Õµ‰•È°(€€€€€€€€€€€€€µ½Ù•µ•¹Ð¹…Í¡}Í•ÍÍ¥½¹}¥°(€€€€€€€€€€€€€µ½Ù•µ•¹Ð¹Í•ÍÍ¥½¹}ÍÑ…ÑÕÌL…Í¡}Í•ÍÍ¥½¹}ÍÑ…ÑÕÌ°(€€€€€€€€€€€€€M]!8Ð¹Ñ•¹…¹Ñ}ÑåÁ”€ô€=5A9dœQ!8=1M¡Ð¹½µÁ…¹å}¹…µ”°Ð¹™¥ÉÍÑ}¹…µ”°€œœ¤(€€€€€€€€€€€€€€€€€€1MQI%4¡=9P¡=1M¡Ð¹™¥ÉÍÑ}¹…µ”°€œœ¤°€œ€œ°=1M¡Ð¹±…ÍÑ}¹…µ”°€œœ¤°€œ€œ°=1M¡Ð¹Á½ÍÑ}¹…µ”°€œœ¤¤¤(€€€€€€€€€€€€€9LÑ•¹…¹Ñ}¹…µ”°(€€€€€€€€€€€€€Ð¹•µ…¥°LÑ•¹…¹Ñ}•µ…¥°°(€€€€€€€€€€€€€Ô¹¹Õµ‰•ÈLÕ¹¥Ñ}¹Õµ‰•È°ˆ¹¹…µ”L‰Õ¥±‘¥¹}¹…µ”°°¹±•…Í•}¹Õµ‰•È(€€€€€€I=4Ñ•¹…¹Ñ}É•‘¥ÑÌÑŒ(€€€€€€)=%8Á…åµ•¹ÑÌÀ=8À¹¥€ôÑŒ¹Í½ÕÉ•}Á…åµ•¹Ñ}¥9À¹½É…¹¥é…Ñ¥½¹}¥€ôÑŒ¹½É…¹¥é…Ñ¥½¹}¥9À¹‘•±•Ñ•‘}…Ð€‘í¥¹±Õ‘••±•Ñ•€ü€%L9=P9U10œ€è€%L9U10ô(€€€€€€)=%8Ñ•¹…¹ÑÌÐ=8Ð¹¥€ôÑŒ¹Ñ•¹…¹Ñ}¥9Ð¹½É…¹¥é…Ñ¥½¹}¥€ôÑŒ¹½É…¹¥é…Ñ¥½¹}¥9Ð¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€1P)=%8±•…Í•Ì°=8°¹¥€ôÑŒ¹±•…Í•}¥9°¹½É…¹¥é…Ñ¥½¹}¥€ôÑŒ¹½É…¹¥é…Ñ¥½¹}¥9°¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€1P)=%8Õ¹¥ÑÌÔ=8Ô¹¥€ô°¹Õ¹¥Ñ}¥9Ô¹½É…¹¥é…Ñ¥½¹}¥€ôÑŒ¹½É…¹¥é…Ñ¥½¹}¥9Ô¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€1P)=%8‰Õ¥±‘¥¹Ìˆ=8ˆ¹¥€ôÔ¹‰Õ¥±‘¥¹}¥9ˆ¹½É…¹¥é…Ñ¥½¹}¥€ôÑŒ¹½É…¹¥é…Ñ¥½¹}¥9ˆ¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€1P)=%81QI0€ (€€€€€€€€M1P´¹¥°´¹Á¥••}¹Õµ‰•È°´¹…Í¡}Í•ÍÍ¥½¹}¥°Ì¹ÍÑ…ÑÕÌLÍ•ÍÍ¥½¹}ÍÑ…ÑÕÌ(€€€€€€€€I=4…Í¡}µ½Ù•µ•¹ÑÌ´(€€€€€€€€1P)=%8…Í¡}Í•ÍÍ¥½¹ÌÌ=8Ì¹¥€ô´¹…Í¡}Í•ÍÍ¥½¹}¥(€€€€€€€€]!I´¹½É…¹¥é…Ñ¥½¹}¥€ôÑŒ¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€€€€€9´¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€€€9€¡´¹Ñ•¹…¹Ñ}É•‘¥Ñ}¥€ôÑŒ¹¥=H´¹Á…åµ•¹Ñ}¥€ôÑŒ¹Í½ÕÉ•}Á…åµ•¹Ñ}¥¤(€€€€€€€€=IH	dM]!8´¹Ñ•¹…¹Ñ}É•‘¥Ñ}¥€ôÑŒ¹¥Q!8€À1M€Ä9°´¹¥M(€€€€€€€€1%5%P€Ä(€€€€€€€¤µ½Ù•µ•¹Ð=8QIU(€€€€€€]!IÑŒ¹¥€ô€Ä9ÑŒ¹½É…¹¥é…Ñ¥½¹}¥€ô€È9ÑŒ¹‘•±•Ñ•‘}…Ð€‘í¥¹±Õ‘••±•Ñ•€ü€%L9=P9U10œ€è€%L9U10õ€°(€€€€€m¥°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€½¹ÍÐÉ•‘¥Ð€ôÉ•ÅÕ¥É•I½Ü¡‘¥É•ÑlÁt°€Q•¹…¹ÐÉ•‘¥Ðœ¤ì(€€€½¹ÍÐm…±±½…Ñ¥½¹Ì°É•™Õ¹‘Ít€ô…Ý…¥ÐAÉ½µ¥Í”¹…±°¡l(€€€€€Ñ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1PÑ„¹¥°Ñ„¹…µ½Õ¹Ñ}…ÁÁ±¥•°Ñ„¹ÕÉÉ•¹ä°Ñ„¹É•…Ñ•‘}…Ð°(€€€€€€€€€€€€€¤¹¥L¥¹Ù½¥•}¥°¤¹¥¹Ù½¥•}¹Õµ‰•È°¤¹¥ÍÍÕ•}‘…Ñ”°¤¹‘Õ•}‘…Ñ”°(€€€€€€€€€€€€€À¹¥LÁ…åµ•¹Ñ}¥°À¹Á…åµ•¹Ñ}‘…Ñ”(€€€€€€I=4Ñ•¹…¹Ñ}É•‘¥Ñ}…±±½…Ñ¥½¹ÌÑ„(€€€€€€)=%8¥¹Ù½¥•Ì¤=8¤¹¥€ôÑ„¹¥¹Ù½¥•}¥9¤¹½É…¹¥é…Ñ¥½¹}¥€ôÑ„¹½É…¹¥é…Ñ¥½¹}¥9¤¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€)=%8Á…åµ•¹ÑÌÀ=8À¹¥€ôÑ„¹Á…åµ•¹Ñ}¥9À¹½É…¹¥é…Ñ¥½¹}¥€ôÑ„¹½É…¹¥é…Ñ¥½¹}¥9À¹‘•±•Ñ•‘}…Ð€‘í¡¥±‘•±•Ñ•‘±…ÕÍ•ô(€€€€€€]!IÑ„¹Ñ•¹…¹Ñ}É•‘¥Ñ}¥€ô€Ä(€€€€€€€€9Ñ„¹½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€9Ñ„¹‘•±•Ñ•‘}…Ð€‘í¡¥±‘•±•Ñ•‘±…ÕÍ•ô(€€€€€€=IH	dÑ„¹É•…Ñ•‘}…ÐM°Ñ„¹¥M€°(€€€€€m¥°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€€€¤°(€€€€€Ñ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€€€M1PÑÈ¹¥°ÑÈ¹…µ½Õ¹Ð°ÑÈ¹ÕÉÉ•¹ä°ÑÈ¹É•™Õ¹‘}‘…Ñ”°ÑÈ¹Á…åµ•¹Ñ}µ•Ñ¡½°ÑÈ¹É•™•É•¹”°ÑÈ¹É•…Í½¸°(€€€€€€€€€€€€€€€ÑÈ¹…Í¡}µ½Ù•µ•¹Ñ}¥°ÑÈ¹É••¥ÁÑ}¹Õµ‰•È°ÑÈ¹ÍÑ…ÑÕÌ°ÑÈ¹É•…Ñ•‘}…Ð°(€€€€€€€€€€€€€€€´¹Á¥••}¹Õµ‰•ÈL…Í¡}Á¥••}¹Õµ‰•È°(€€€€€€€€€€€€€€€=1M¡9U11%¡QI%4¡=9P¡=1M¡Ô¹™¥ÉÍÑ}¹…µ”°€œœ¤°€œ€œ°=1M¡Ô¹±…ÍÑ}¹…µ”°€œœ¤¤¤°€œœ¤°Ô¹•µ…¥°¤LÉ•…Ñ•‘}‰å}¹…µ”(€€€€€€€€I=4Ñ•¹…¹Ñ}É•‘¥Ñ}É•™Õ¹‘ÌÑÈ(€€€€€€€€1P)=%8…Í¡}µ½Ù•µ•¹ÑÌ´=8´¹¥€ôÑÈ¹…Í¡}µ½Ù•µ•¹Ñ}¥9´¹½É…¹¥é…Ñ¥½¹}¥€ôÑÈ¹½É…¹¥é…Ñ¥½¹}¥9´¹‘•±•Ñ•‘}…Ð€‘í¡¥±‘•±•Ñ•‘±…ÕÍ•ô(€€€€€€€€1P)=%8…ÁÁ}ÕÍ•ÉÌÔ=8Ô¹¥€ôÑÈ¹É•…Ñ•‘}‰ä9Ô¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€]!IÑÈ¹Ñ•¹…¹Ñ}É•‘¥Ñ}¥€ô€Ä(€€€€€€€€€€9ÑÈ¹½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€€€9ÑÈ¹‘•±•Ñ•‘}…Ð€‘í¡¥±‘•±•Ñ•‘±…ÕÍ•ô(€€€€€€€€=IH	dÑÈ¹É•™Õ¹‘}‘…Ñ”M°ÑÈ¹¥M€°(€€€€€€€m¥°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€€€¤°(€€€t¤ì(€€€½¹ÍÐ…±±½…Ñ¥½¹ÍI½ÝÌ€ô…±±½…Ñ¥½¹Ì¹É½ÝÌì(€€€½¹ÍÐÉ•™Õ¹‘ÍI½ÝÌ€ôÉ•™Õ¹‘Ì¹É½ÝÌì(€€€½¹ÍÐ¡…Í±±½…Ñ¥½¹Ì€ô…±±½…Ñ¥½¹ÍI½ÝÌ¹±•¹Ñ €ø€Àì(€€€½¹ÍÐ¡…ÍI•™Õ¹‘Ì€ôÉ•™Õ¹‘ÍI½ÝÌ¹±•¹Ñ €ø€Àì(€€€½¹ÍÐ…±±½…Ñ•‘µ½Õ¹Ð€ô…±±½…Ñ¥½¹ÍI½ÝÌ¹É•‘Õ” ¡ÍÕ´°É½Ü¤€ôøÍÕ´€¬9Õµ‰•È¡É½Ü¹…µ½Õ¹Ñ}…ÁÁ±¥•€üü€À¤°€À¤ì(€€€½¹ÍÐÉ•™Õ¹‘•‘µ½Õ¹Ð€ôÉ•™Õ¹‘ÍI½ÝÌ¹É•‘Õ” ¡ÍÕ´°É½Ü¤€ôøÍÕ´€¬9Õµ‰•È¡É½Ü¹…µ½Õ¹Ð€üü€À¤°€À¤ì(€€€½¹ÍÐÉ•µ…¥¹¥¹µ½Õ¹Ð€ô9Õµ‰•È¡É•‘¥Ð¹É•µ…¥¹¥¹}…µ½Õ¹Ð€üü€À¤ì(€€€É•ÑÕÉ¸ì(€€€€€€¸¸¹É•‘¥Ð°(€€€€€…±±½…Ñ¥½¹Ìè…±±½…Ñ¥½¹ÍI½ÝÌ°(€€€€€É•™Õ¹‘ÌèÉ•™Õ¹‘ÍI½ÝÌ°(€€€€€…±±½…Ñ•‘}…µ½Õ¹Ðè…±±½…Ñ•‘µ½Õ¹Ð°(€€€€€É•™Õ¹‘•‘}…µ½Õ¹ÐèÉ•™Õ¹‘•‘µ½Õ¹Ð°(€€€€€…Í¡}µ½Ù•µ•¹Ñ}¥è9Õµ‰•È¡É•‘¥Ð¹…Í¡}µ½Ù•µ•¹Ñ}¥€üü€À¤ñð¹Õ±°°(€€€€€…Í¡}Á¥••}¹Õµ‰•ÈèÉ•‘¥Ð¹…Í¡}Á¥••}¹Õµ‰•È€üü¹Õ±°°(€€€€€…Í¡}Í•ÍÍ¥½¹}ÍÑ…ÑÕÌèÉ•‘¥Ð¹…Í¡}Í•ÍÍ¥½¹}ÍÑ…ÑÕÌ€üü¹Õ±°°(€€€€€…¹}É•™Õ¹èÉ•µ…¥¹¥¹µ½Õ¹Ð€ø€À°(€€€€€…¹}…¹•°è€…¡…Í±±½…Ñ¥½¹Ì€˜˜€…¡…ÍI•™Õ¹‘Ì€˜˜9Õµ‰•È¡É•‘¥Ð¹½É¥¥¹…±}…µ½Õ¹Ð€üü€À¤€ôôôÉ•µ…¥¹¥¹µ½Õ¹Ð°(€€€ôì(€ô((€…Íå¹ŒÑÉ…Í¡•‘Q•¹…¹ÑÉ•‘¥Ñ•Ñ…¥°¡¥è¹Õµ‰•È¤ì(€€€É•ÑÕÉ¸Ñ¡¥Ì¹Ñ•¹…¹ÑÉ•‘¥Ñ•Ñ…¥°¡¥°ÑÉÕ”¤ì(€ô((€…Íå¹ŒÑÉ…Í¡•‘Q•¹…¹ÑÉ•‘¥ÑI•™Õ¹‘Ì ¤ì(€€€…Ý…¥ÐÑ¡¥Ì¹•¹ÍÕÉ•Q•¹…¹ÑÉ•‘¥ÑI•™Õ¹‘M¡•µ„ ¤ì(€€€½¹ÍÐÁ…É•¹Ñ•±•Ñ•‘±…ÕÍ”€ô€%L9=P9U10œì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1PÑÈ¹¥°(€€€€€€€€€€€€€ÑÈ¹Ñ•¹…¹Ñ}É•‘¥Ñ}¥°(€€€€€€€€€€€€€ÑÈ¹Ñ•¹…¹Ñ}¥°(€€€€€€€€€€€€€ÑÈ¹±•…Í•}¥°(€€€€€€€€€€€€€ÑÈ¹…µ½Õ¹Ð°(€€€€€€€€€€€€€ÑÈ¹ÕÉÉ•¹ä°(€€€€€€€€€€€€€ÑÈ¹É•™Õ¹‘}‘…Ñ”°(€€€€€€€€€€€€€ÑÈ¹Á…åµ•¹Ñ}µ•Ñ¡½°(€€€€€€€€€€€€€ÑÈ¹É•™•É•¹”°(€€€€€€€€€€€€€ÑÈ¹É•…Í½¸°(€€€€€€€€€€€€€ÑÈ¹…Í¡}µ½Ù•µ•¹Ñ}¥°(€€€€€€€€€€€€€ÑÈ¹É••¥ÁÑ}¹Õµ‰•È°(€€€€€€€€€€€€€ÑÈ¹ÍÑ…ÑÕÌ°(€€€€€€€€€€€€€ÑÈ¹‘•±•Ñ•‘}…Ð°(€€€€€€€€€€€€€ÑÈ¹‘•±•Ñ¥½¹}É•…Í½¸°(€€€€€€€€€€€€€ÑÈ¹½É…¹¥é…Ñ¥½¹}¥°(€€€€€€€€€€€€€ÑŒ¹É•™•É•¹”LÉ•‘¥Ñ}É•™•É•¹”°(€€€€€€€€€€€€€ÑŒ¹Í½ÕÉ•}Á…åµ•¹Ñ}¥°(€€€€€€€€€€€€€M]!8Ð¹Ñ•¹…¹Ñ}ÑåÁ”€ô€=5A9dœQ!8=1M¡Ð¹½µÁ…¹å}¹…µ”°€œœ¤(€€€€€€€€€€€€€€€€€€1MQI%4¡=9P¡=1M¡Ð¹™¥ÉÍÑ}¹…µ”°€œœ¤°€œ€œ°=1M¡Ð¹±…ÍÑ}¹…µ”°€œœ¤°€œ€œ°=1M¡Ð¹Á½ÍÑ}¹…µ”°€œœ¤¤¤(€€€€€€€€€€€€€9LÑ•¹…¹Ñ}¹…µ”°(€€€€€€€€€€€€€°¹±•…Í•}¹Õµ‰•È°(€€€€€€€€€€€€€Ô¹¹Õµ‰•ÈLÕ¹¥Ñ}¹Õµ‰•È°(€€€€€€€€€€€€€ˆ¹¹…µ”L‰Õ¥±‘¥¹}¹…µ”°(€€€€€€€€€€€€€´¹Á¥••}¹Õµ‰•ÈL…Í¡}Á¥••}¹Õµ‰•È°(€€€€€€€€€€€€€=1M¡9U11%¡QI%4¡=9P¡=1M¡ÔÄ¹™¥ÉÍÑ}¹…µ”°€œœ¤°€œ€œ°=1M¡ÔÄ¹±…ÍÑ}¹…µ”°€œœ¤¤¤°€œœ¤°ÔÄ¹•µ…¥°¤L‘•±•Ñ•‘}‰å}¹…µ”(€€€€€€I=4Ñ•¹…¹Ñ}É•‘¥Ñ}É•™Õ¹‘ÌÑÈ(€€€€€€)=%8Ñ•¹…¹Ñ}É•‘¥ÑÌÑŒ=8ÑŒ¹¥€ôÑÈ¹Ñ•¹…¹Ñ}É•‘¥Ñ}¥9ÑŒ¹½É…¹¥é…Ñ¥½¹}¥€ôÑÈ¹½É…¹¥é…Ñ¥½¹}¥9ÑŒ¹‘•±•Ñ•‘}…Ð€‘íÁ…É•¹Ñ•±•Ñ•‘±…ÕÍ•ô(€€€€€€)=%8Ñ•¹…¹ÑÌÐ=8Ð¹¥€ôÑÈ¹Ñ•¹…¹Ñ}¥9Ð¹½É…¹¥é…Ñ¥½¹}¥€ôÑÈ¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€1P)=%8±•…Í•Ì°=8°¹¥€ôÑÈ¹±•…Í•}¥9°¹½É…¹¥é…Ñ¥½¹}¥€ôÑÈ¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€1P)=%8Õ¹¥ÑÌÔ=8Ô¹¥€ô°¹Õ¹¥Ñ}¥9Ô¹½É…¹¥é…Ñ¥½¹}¥€ôÑÈ¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€1P)=%8‰Õ¥±‘¥¹Ìˆ=8ˆ¹¥€ôÔ¹‰Õ¥±‘¥¹}¥9ˆ¹½É…¹¥é…Ñ¥½¹}¥€ôÑÈ¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€1P)=%8…Í¡}µ½Ù•µ•¹ÑÌ´=8´¹¥€ôÑÈ¹…Í¡}µ½Ù•µ•¹Ñ}¥9´¹½É…¹¥é…Ñ¥½¹}¥€ôÑÈ¹½É…¹¥é…Ñ¥½¹}¥9´¹‘•±•Ñ•‘}…Ð€‘íÁ…É•¹Ñ•±•Ñ•‘±…ÕÍ•ô(€€€€€€1P)=%8…ÁÁ}ÕÍ•ÉÌÔÄ=8ÔÄ¹¥€ôÑÈ¹‘•±•Ñ•‘}‰ä9ÔÄ¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€]!IÑÈ¹½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€9ÑÈ¹‘•±•Ñ•‘}…Ð%L9=P9U10(€€€€€€=IH	dÑÈ¹‘•±•Ñ•‘}…ÐM°ÑÈ¹¥M€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€É•ÑÕÉ¸É½ÝÌì(€ô((€…Íå¹ŒÑ•¹…¹ÑÉ•‘¥ÑI•™Õ¹‘•Ñ…¥°¡¥è¹Õµ‰•È°¥¹±Õ‘••±•Ñ•€ô™…±Í”¤ì(€€€…Ý…¥ÐÑ¡¥Ì¹•¹ÍÕÉ•Q•¹…¹ÑÉ•‘¥ÑI•™Õ¹‘M¡•µ„ ¤ì(€€€½¹ÍÐÁ…É•¹Ñ•±•Ñ•‘±…ÕÍ”€ô¥¹±Õ‘••±•Ñ•€ü€%L9=P9U10œ€è€%L9U10œì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1PÑÈ¸¨°ÑŒ¹½É¥¥¹…±}…µ½Õ¹Ð°ÑŒ¹É•µ…¥¹¥¹}…µ½Õ¹Ð°ÑŒ¹ÍÑ…ÑÕÌLÉ•‘¥Ñ}ÍÑ…ÑÕÌ°ÑŒ¹É•™•É•¹”LÉ•‘¥Ñ}É•™•É•¹”°(€€€€€€€€€€€€€ÑŒ¹Í½ÕÉ•}Á…åµ•¹Ñ}¥°ÑŒ¹Á…åµ•¹Ñ}‘…Ñ”LÉ•‘¥Ñ}Á…åµ•¹Ñ}‘…Ñ”°(€€€€€€€€€€€€€M]!8Ð¹Ñ•¹…¹Ñ}ÑåÁ”€ô€=5A9dœQ!8=1M¡Ð¹½µÁ…¹å}¹…µ”°Ð¹™¥ÉÍÑ}¹…µ”°€œœ¤(€€€€€€€€€€€€€€€€€€1MQI%4¡=9P¡=1M¡Ð¹™¥ÉÍÑ}¹…µ”°€œœ¤°€œ€œ°=1M¡Ð¹±…ÍÑ}¹…µ”°€œœ¤°€œ€œ°=1M¡Ð¹Á½ÍÑ}¹…µ”°€œœ¤¤¤(€€€€€€€€€€€€€9LÑ•¹…¹Ñ}¹…µ”°(€€€€€€€€€€€€€°¹±•…Í•}¹Õµ‰•È°(€€€€€€€€€€€€€Ô¹¹Õµ‰•ÈLÕ¹¥Ñ}¹Õµ‰•È°(€€€€€€€€€€€€€ˆ¹¹…µ”L‰Õ¥±‘¥¹}¹…µ”°(€€€€€€€€€€€€€´¹Á¥••}¹Õµ‰•ÈL…Í¡}Á¥••}¹Õµ‰•È°(€€€€€€€€€€€€€À¹É••¥ÁÑ}¹Õµ‰•ÈLÍ½ÕÉ•}É••¥ÁÑ}¹Õµ‰•È°(€€€€€€€€€€€€€=1M¡9U11%¡QI%4¡=9P¡=1M¡É•…Ñ½È¹™¥ÉÍÑ}¹…µ”°€œœ¤°€œ€œ°=1M¡É•…Ñ½È¹±…ÍÑ}¹…µ”°€œœ¤¤¤°€œœ¤°É•…Ñ½È¹•µ…¥°¤LÉ•…Ñ•‘}‰å}¹…µ”(€€€€€€I=4Ñ•¹…¹Ñ}É•‘¥Ñ}É•™Õ¹‘ÌÑÈ(€€€€€€)=%8Ñ•¹…¹Ñ}É•‘¥ÑÌÑŒ=8ÑŒ¹¥€ôÑÈ¹Ñ•¹…¹Ñ}É•‘¥Ñ}¥9ÑŒ¹½É…¹¥é…Ñ¥½¹}¥€ôÑÈ¹½É…¹¥é…Ñ¥½¹}¥9ÑŒ¹‘•±•Ñ•‘}…Ð€‘íÁ…É•¹Ñ•±•Ñ•‘±…ÕÍ•ô(€€€€€€)=%8Ñ•¹…¹ÑÌÐ=8Ð¹¥€ôÑÈ¹Ñ•¹…¹Ñ}¥9Ð¹½É…¹¥é…Ñ¥½¹}¥€ôÑÈ¹½É…¹¥é…Ñ¥½¹}¥9Ð¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€1P)=%8±•…Í•Ì°=8°¹¥€ôÑÈ¹±•…Í•}¥9°¹½É…¹¥é…Ñ¥½¹}¥€ôÑÈ¹½É…¹¥é…Ñ¥½¹}¥9°¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€1P)=%8Õ¹¥ÑÌÔ=8Ô¹¥€ô°¹Õ¹¥Ñ}¥9Ô¹½É…¹¥é…Ñ¥½¹}¥€ôÑÈ¹½É…¹¥é…Ñ¥½¹}¥9Ô¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€1P)=%8‰Õ¥±‘¥¹Ìˆ=8ˆ¹¥€ôÔ¹‰Õ¥±‘¥¹}¥9ˆ¹½É…¹¥é…Ñ¥½¹}¥€ôÑÈ¹½É…¹¥é…Ñ¥½¹}¥9ˆ¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€1P)=%8…Í¡}µ½Ù•µ•¹ÑÌ´=8´¹¥€ôÑÈ¹…Í¡}µ½Ù•µ•¹Ñ}¥9´¹½É…¹¥é…Ñ¥½¹}¥€ôÑÈ¹½É…¹¥é…Ñ¥½¹}¥9´¹‘•±•Ñ•‘}…Ð€‘íÁ…É•¹Ñ•±•Ñ•‘±…ÕÍ•ô(€€€€€€1P)=%8Á…åµ•¹ÑÌÀ=8À¹¥€ôÑŒ¹Í½ÕÉ•}Á…åµ•¹Ñ}¥9À¹½É…¹¥é…Ñ¥½¹}¥€ôÑÈ¹½É…¹¥é…Ñ¥½¹}¥9À¹‘•±•Ñ•‘}…Ð€‘íÁ…É•¹Ñ•±•Ñ•‘±…ÕÍ•ô(€€€€€€1P)=%8…ÁÁ}ÕÍ•ÉÌÉ•…Ñ½È=8É•…Ñ½È¹¥€ôÑÈ¹É•…Ñ•‘}‰ä9É•…Ñ½È¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€]!IÑÈ¹¥€ô€Ä(€€€€€€€€9ÑÈ¹½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€9ÑÈ¹‘•±•Ñ•‘}…Ð€‘í¥¹±Õ‘••±•Ñ•€ü€%L9=P9U10œ€è€%L9U10õ€°(€€€€€m¥°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€É•ÑÕÉ¸É•ÅÕ¥É•I½Ü¡É½ÝÍlÁt°€Q•¹…¹ÐÉ•‘¥ÐÉ•™Õ¹œ¤ì(€ô((€…Íå¹ŒÑÉ…Í¡•‘Q•¹…¹ÑÉ•‘¥ÑI•™Õ¹‘•Ñ…¥°¡¥è¹Õµ‰•È¤ì(€€€É•ÑÕÉ¸Ñ¡¥Ì¹Ñ•¹…¹ÑÉ•‘¥ÑI•™Õ¹‘•Ñ…¥°¡¥°ÑÉÕ”¤ì(€ô((€…Íå¹ŒÑ•¹…¹ÑÉ•‘¥Ñ½Éµ…Ñ„ ¤ì(€€€½¹ÍÐmÑ•¹…¹ÑÌ°±•…Í•Ì°‰…¹­½Õ¹ÑÍt€ô…Ý…¥ÐAÉ½µ¥Í”¹…±°¡l(€€€€€Ñ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€€€M1P¥°(€€€€€€€€€€€€€€€M]!8Ñ•¹…¹Ñ}ÑåÁ”€ô€=5A9dœQ!8=1M¡½µÁ…¹å}¹…µ”°™¥ÉÍÑ}¹…µ”°€œœ¤(€€€€€€€€€€€€€€€€€€€€1MQI%4¡=9P¡=1M¡™¥ÉÍÑ}¹…µ”°€œœ¤°€œ€œ°=1M¡±…ÍÑ}¹…µ”°€œœ¤°€œ€œ°=1M¡Á½ÍÑ}¹…µ”°€œœ¤¤¤(€€€€€€€€€€€€€€€9L¹…µ”°(€€€€€€€€€€€€€€€Ñ•¹…¹Ñ}¹Õµ‰•È(€€€€€€€€I=4Ñ•¹…¹ÑÌ(€€€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Ä9‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€=IH	d¹…µ•€°(€€€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€€€¤°(€€€€€Ñ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€€€M1P°¹¥°°¹Ñ•¹…¹Ñ}¥°°¹±•…Í•}¹Õµ‰•È°°¹ÍÑ…ÑÕÌ°Ô¹¹Õµ‰•ÈLÕ¹¥Ñ}¹Õµ‰•È°ˆ¹¹…µ”L‰Õ¥±‘¥¹}¹…µ”(€€€€€€€€I=4±•…Í•Ì°(€€€€€€€€)=%8Õ¹¥ÑÌÔ=8Ô¹¥€ô°¹Õ¹¥Ñ}¥9Ô¹½É…¹¥é…Ñ¥½¹}¥€ô°¹½É…¹¥é…Ñ¥½¹}¥9Ô¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€1P)=%8‰Õ¥±‘¥¹Ìˆ=8ˆ¹¥€ôÔ¹‰Õ¥±‘¥¹}¥9ˆ¹½É…¹¥é…Ñ¥½¹}¥€ô°¹½É…¹¥é…Ñ¥½¹}¥9ˆ¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€]!I°¹½É…¹¥é…Ñ¥½¹}¥€ô€Ä9°¹‘•±•Ñ•‘}…Ð%L9U109°¹…É¡¥Ù•‘}…Ð%L9U109°¹ÍÑ…ÑÕÌ€ô€Q%Yœ(€€€€€€€€=IH	dˆ¹¹…µ”°Ô¹¹Õµ‰•È°°¹¥M€°(€€€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€€€¤°(€€€€€Ñ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€€€M1P¥°‰…¹­}¹…µ”°…½Õ¹Ñ}¹…µ”°…½Õ¹Ñ}¹Õµ‰•È°ÕÉÉ•¹ä°ÍÑ…ÑÕÌ(€€€€€€€€I=4‰…¹­}…½Õ¹ÑÌ(€€€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€€€9ÍÑ…ÑÕÌ€ô€Q%Yœ(€€€€€€€€=IH	d‰…¹­}¹…µ”°…½Õ¹Ñ}¹…µ”°¥M€°(€€€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€€€¤°(€€€t¤ì(€€€É•ÑÕÉ¸ì(€€€€€Ñ•¹…¹ÑÌèÑ•¹…¹ÑÌ¹É½ÝÌ°(€€€€€±•…Í•Ìè±•…Í•Ì¹É½ÝÌ°(€€€€€‰…¹­½Õ¹ÑÌè‰…¹­½Õ¹ÑÌ¹É½ÝÌ°(€€€€€Á…åµ•¹Ñ5•Ñ¡½‘Ìèl(€€€€€€€ìÙ…±Õ”è€M œ°±…‰•°è€ÍÃ¡•Ìœô°(€€€€€€€ìÙ…±Õ”è€	9,œ°±…‰•°è€	…¹ÅÕ”œô°(€€€€€€€ìÙ…±Õ”è€5=	%1}5=9dœ°±…‰•°è€5½‰¥±”5½¹•äœô°(€€€€€t°(€€€€€ÕÉÉ•¹¥•ÌèlUMœ°€t°(€€€ôì(€ô((€…Íå¹ŒÉ•…Ñ•Q•¹…¹ÑÉ•‘¥Ð¡‰½‘äèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø¤ì(€€€…Ý…¥ÐÑ¡¥Ì¹•¹ÍÕÉ•Q•¹…¹ÑÉ•‘¥ÑM¡•µ„ ¤ì(€€€¥˜€ …Ñ¡¥Ì¹¡…ÍA•Éµ¥ÍÍ¥½¸ Á…åµ•¹ÑÌ¹É•…Ñ”œ¤¤ì(€€€€€Ñ¡É½Ü¹•Ü½É‰¥‘‘•¹á•ÁÑ¥½¸ A•Éµ¥ÍÍ¥½¸‘”Ë¥…Ñ¥½¸‘”Á…¥•µ•¹ÐÉ•ÅÕ¥Í”¸œ¤ì(€€€ô(€€€½¹ÍÐÉ•‘¥Ð€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÑÉ…¹Í…Ñ¥½¸¡…Íå¹Œ€¡±¥•¹Ð¤€ôøì(€€€€€½¹ÍÐÑ•¹…¹Ñ%€ô9Õµ‰•È¡‰½‘ä¹Ñ•¹…¹Ñ}¥€üü€À¤ì(€€€€€½¹ÍÐ±•…Í•%€ô‰½‘ä¹±•…Í•}¥€ü9Õµ‰•È¡‰½‘ä¹±•…Í•}¥¤€è¹Õ±°ì(€€€€€½¹ÍÐÕÉÉ•¹ä€ôMÑÉ¥¹œ¡‰½‘ä¹ÕÉÉ•¹ä€üü€UMœ¤¹Ñ½UÁÁ•É…Í” ¤ì(€€€€€½¹ÍÐ…µ½Õ¹Ð€ô9Õµ‰•È¡‰½‘ä¹…µ½Õ¹Ð€üü€À¤ì(€€€€€½¹ÍÐÁ…åµ•¹Ñ5•Ñ¡½€ôMÑÉ¥¹œ¡‰½‘ä¹Á…åµ•¹Ñ}µ•Ñ¡½€üü€M œ¤¹Ñ½UÁÁ•É…Í” ¤ì(€€€€€½¹ÍÐÁ…åµ•¹Ñ…Ñ”€ôMÑÉ¥¹œ¡‰½‘ä¹Á…åµ•¹Ñ}‘…Ñ”€üü¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤¹Í±¥” À°€ÄÀ¤¤ì(€€€€€½¹ÍÐ•á¡…¹•I…Ñ•UÍ•€ô9Õµ‰•È¡‰½‘ä¹•á¡…¹•}É…Ñ•}ÕÍ•€üü€À¤ñð¹Õ±°ì(€€€€€½¹ÍÐ•á¡…¹•I…Ñ•…Ñ”€ô‰½‘ä¹•á¡…¹•}É…Ñ•}‘…Ñ”€üMÑÉ¥¹œ¡‰½‘ä¹•á¡…¹•}É…Ñ•}‘…Ñ”¤€è¹Õ±°ì(€€€€€¥˜€ …Ñ•¹…¹Ñ%¤Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1½…Ñ…¥É”É•ÅÕ¥Ì¸œ¤ì(€€€€€¥˜€ …lUMœ°€t¹¥¹±Õ‘•Ì¡ÕÉÉ•¹ä¤¤Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ •Ù¥Í”¥¹Ù…±¥‘”¸œ¤ì(€€€€€¥˜€ …9Õµ‰•È¹¥Í¥¹¥Ñ”¡…µ½Õ¹Ð¤ñð…µ½Õ¹Ð€ðô€À¤Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 5½¹Ñ…¹Ð‘ÔË¥‘¥Ð¥¹Ù…±¥‘”¸œ¤ì(€€€€€¥˜€ …lM œ°€	9,œ°€5=	%1}5=9dt¹¥¹±Õ‘•Ì¡Á…åµ•¹Ñ5•Ñ¡½¤¤Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 5½‘”‘”Á…¥•µ•¹Ð¥¹Ù…±¥‘”¸œ¤ì(€€€€€¥˜€¡ÕÉÉ•¹ä€ôôô€œ€˜˜€ …•á¡…¹•I…Ñ•UÍ•ñð•á¡…¹•I…Ñ•UÍ•€ðô€À¤¤ì(€€€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ U¸Ñ…Õà‘”¡…¹”•ÍÐÉ•ÅÕ¥ÌÁ½ÕÈÕ¸Ë¥‘¥Ð±½…Ñ…¥É”•¸¸œ¤ì(€€€€€ô(€€€€€¥˜€¡Á…åµ•¹Ñ5•Ñ¡½€ôôô€	9,œ¤ì(€€€€€€€…Ý…¥ÐÑ¡¥Ì¹•¹ÍÕÉ•	…¹­M¡•µ„ ¤ì(€€€€€ô(€€€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä M1PÁ}…‘Ù¥Í½Éå}á…Ñ}±½¬¡¡…Í¡Ñ•áÐ Ä¤¤œ°mÑ•¹…¹ÐµÉ•‘¥Ð´‘íÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥ô´‘íÑ•¹…¹Ñ%‘ô´‘íÁ…åµ•¹Ñ…Ñ•ô´‘í…µ½Õ¹Ñô´‘íÕÉÉ•¹åõt¤ì(€€€€€½¹ÍÐÑ•¹…¹Ð€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€M1P¥°(€€€€€€€€€€€€€€€M]!8Ñ•¹…¹Ñ}ÑåÁ”€ô€=5A9dœQ!8=1M¡½µÁ…¹å}¹…µ”°™¥ÉÍÑ}¹…µ”°€œœ¤(€€€€€€€€€€€€€€€€€€€€1MQI%4¡=9P¡=1M¡™¥ÉÍÑ}¹…µ”°€œœ¤°€œ€œ°=1M¡±…ÍÑ}¹…µ”°€œœ¤°€œ€œ°=1M¡Á½ÍÑ}¹…µ”°€œœ¤¤¤(€€€€€€€€€€€€€€€9L¹…µ”(€€€€€€€€I=4Ñ•¹…¹ÑÌ(€€€€€€€€]!I¥€ô€Ä9½É…¹¥é…Ñ¥½¹}¥€ô€È9‘•±•Ñ•‘}…Ð%L9U11€°(€€€€€€€mÑ•¹…¹Ñ%°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€€€¤ì(€€€€€½¹ÍÐÑ•¹…¹ÑI½Ü€ôÉ•ÅÕ¥É•I½Ü¡Ñ•¹…¹Ð¹É½ÝÍlÁt°€Q•¹…¹Ðœ¤ì(€€€€€¥˜€¡±•…Í•%¤ì(€€€€€€€½¹ÍÐ±•…Í”€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€€€M1P¥I=4±•…Í•Ì(€€€€€€€€€€]!I¥€ô€Ä9Ñ•¹…¹Ñ}¥€ô€È9½É…¹¥é…Ñ¥½¹}¥€ô€Ì(€€€€€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U109…É¡¥Ù•‘}…Ð%L9U109ÍÑ…ÑÕÌ€ô€Q%Y€°(€€€€€€€€€m±•…Í•%°Ñ•¹…¹Ñ%°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€€€€€¤ì(€€€€€€€É•ÅÕ¥É•I½Ü¡±•…Í”¹É½ÝÍlÁt°€1•…Í”œ¤ì(€€€€€ô(€€€€€½¹ÍÐ‰…¹­½Õ¹Ð€ôÁ…åµ•¹Ñ5•Ñ¡½€ôôô€	9,œ(€€€€€€€€ü…Ý…¥ÐÑ¡¥Ì¹Ù…±¥‘…Ñ•	…¹­½Õ¹Ñ½ÉQ•¹…¹ÑÉ•‘¥Ð¡±¥•¹Ð°9Õµ‰•È¡‰½‘ä¹‰…¹­}…½Õ¹Ñ}¥€üü€À¤°ÕÉÉ•¹ä¤(€€€€€€€€è¹Õ±°ì(€€€€€½¹ÍÐ…µ½Õ¹ÑUÍ€ôÕÉÉ•¹ä€ôôô€UMœ€ü…µ½Õ¹Ð€è€Àì(€€€€€½¹ÍÐ…µ½Õ¹Ñ‘˜€ôÕÉÉ•¹ä€ôôô€œ€ü…µ½Õ¹Ð€è€Àì(€€€€€½¹ÍÐ‘™ÅÕ¥Ù…±•¹ÑUÍ€ôÕÉÉ•¹ä€ôôô€œ€˜˜•á¡…¹•I…Ñ•UÍ•€ü9Õµ‰•È ¡…µ½Õ¹Ð€¼•á¡…¹•I…Ñ•UÍ•¤¹Ñ½¥á• È¤¤€è€Àì(€€€€€½¹ÍÐÑ½Ñ…±ÅÕ¥Ù…±•¹ÑUÍ€ôÕÉÉ•¹ä€ôôô€UMœ€ü…µ½Õ¹Ð€è‘™ÅÕ¥Ù…±•¹ÑUÍì(€€€€€½¹ÍÐÉ••¥ÁÑ9Õµ‰•È€ô…Ý…¥ÐÑ¡¥Ì¹¹•áÑA…åµ•¹ÑI••¥ÁÑ9Õµ‰•È¡±¥•¹Ð¤ì(€€€€€½¹ÍÐ¹½Éµ…±¥é•‘I•™•É•¹”€ô‰½‘ä¹É•™•É•¹”€üMÑÉ¥¹œ¡‰½‘ä¹É•™•É•¹”¤¹ÑÉ¥´ ¤€èI%P´‘íÑ•¹…¹Ñ%‘ô´‘íÁ…åµ•¹Ñ…Ñ•õ€ì(€€€€€½¹ÍÐ¥‘•µÁ½Ñ•¹å-•ä€ôMÑÉ¥¹œ¡‰½‘ä¹¥‘•µÁ½Ñ•¹å}­•ä€üül(€€€€€€€€Q99Q}I%Pœ°(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°(€€€€€€€Ñ•¹…¹Ñ%°(€€€€€€€±•…Í•%€üü€9=1Mœ°(€€€€€€€Á…åµ•¹Ñ…Ñ”°(€€€€€€€ÕÉÉ•¹ä°(€€€€€€€…µ½Õ¹Ð¹Ñ½¥á• È¤°(€€€€€€€¹½Éµ…±¥é•‘I•™•É•¹”°(€€€€€t¹©½¥¸ œèœ¤¤ì(€€€€€½¹ÍÐÁ…åµ•¹Ð€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€%9MIP%9Q<Á…åµ•¹ÑÌ(€€€€€€€€€€¡¥¹Ù½¥•}¥°Á…åµ•¹Ñ}‘…Ñ”°…µ½Õ¹Ð°Á…åµ•¹Ñ}µ•Ñ¡½°É•™•É•¹”°¹½Ñ•Ì°Á…å•É}¹…µ”°É••¥ÁÑ}¹Õµ‰•È°(€€€€€€€€€€ÕÉÉ•¹ä°…µ½Õ¹Ñ}ÕÍ°…µ½Õ¹Ñ}‘˜°•á¡…¹•}É…Ñ•}ÕÍ•°•á¡…¹•}É…Ñ•}‘…Ñ”°‘™}•ÅÕ¥Ù…±•¹Ñ}ÕÍ°Ñ½Ñ…±}•ÅÕ¥Ù…±•¹Ñ}ÕÍ°(€€€€€€€€€€½É…¹¥é…Ñ¥½¹}¥°Á…åµ•¹Ñ}ÑåÁ”°¥‘•µÁ½Ñ•¹å}­•ä¤(€€€€€€€€Y1UL(€€€€€€€€€€¡9U10°€Ä°€È°€Ì°€Ð°€Ô°€Ø°€Ü°(€€€€€€€€€€€à°€ä°€ÄÀ°€ÄÄ°€ÄÈ°€ÄÌ°€ÄÐ°(€€€€€€€€€€€ÄÔ°€Q99Q}I%Pœ°€ÄØ¤(€€€€€€€€=8=91%P€¡½É…¹¥é…Ñ¥½¹}¥°¥‘•µÁ½Ñ•¹å}­•ä¤(€€€€€€€€]!I‘•±•Ñ•‘}…Ð%L9U109¥‘•µÁ½Ñ•¹å}­•ä%L9=P9U10(€€€€€€€€<9=Q!%9(€€€€€€€€IQUI9%9€©€°(€€€€€€€l(€€€€€€€€€Á…åµ•¹Ñ…Ñ”°(€€€€€€€€€Ñ½Ñ…±ÅÕ¥Ù…±•¹ÑUÍ°(€€€€€€€€€Á…åµ•¹Ñ5•Ñ¡½°(€€€€€€€€€¹½Éµ…±¥é•‘I•™•É•¹”°(€€€€€€€€€‰½‘ä¹¹½Ñ•Ì€üMÑÉ¥¹œ¡‰½‘ä¹¹½Ñ•Ì¤€è€A…¥•µ•¹Ð…¹Ñ¥¥Ã¤±½…Ñ…¥É”œ°(€€€€€€€€€Ñ•¹…¹ÑI½Ü¹¹…µ”°(€€€€€€€€€É••¥ÁÑ9Õµ‰•È°(€€€€€€€€€ÕÉÉ•¹ä°(€€€€€€€€€…µ½Õ¹ÑUÍ°(€€€€€€€€€…µ½Õ¹Ñ‘˜°(€€€€€€€€€•á¡…¹•I…Ñ•UÍ•°(€€€€€€€€€•á¡…¹•I…Ñ•…Ñ”°(€€€€€€€€€‘™ÅÕ¥Ù…±•¹ÑUÍ°(€€€€€€€€€Ñ½Ñ…±ÅÕ¥Ù…±•¹ÑUÍ°(€€€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°(€€€€€€€€€¥‘•µÁ½Ñ•¹å-•ä°(€€€€€€€t°(€€€€€€¤ì(€€€€€¥˜€ …Á…åµ•¹Ð¹É½ÝÍlÁt¤Ñ¡É½Ü¹•Ü½¹™±¥Ñá•ÁÑ¥½¸ ”Ë¥‘¥Ð±½…Ñ…¥É”•ÍÐ“¥«€•¹É•¥ÍÑË¤¸œ¤ì(€€€€€½¹ÍÐÉ•‘¥Ð€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€%9MIP%9Q<Ñ•¹…¹Ñ}É•‘¥ÑÌ(€€€€€€€€€€¡½É…¹¥é…Ñ¥½¹}¥°Ñ•¹…¹Ñ}¥°±•…Í•}¥°Í½ÕÉ•}Á…åµ•¹Ñ}¥°ÕÉÉ•¹ä°½É¥¥¹…±}…µ½Õ¹Ð°É•µ…¥¹¥¹}…µ½Õ¹Ð°(€€€€€€€€€€ÍÑ…ÑÕÌ°Á…åµ•¹Ñ}‘…Ñ”°É•™•É•¹”°¹½Ñ•Ì°¥‘•µÁ½Ñ•¹å}­•ä°É•…Ñ•‘}‰ä¤(€€€€€€€€Y1UL€ Ä°€È°€Ì°€Ð°€Ô°€Ø°€Ø°€Y%1	1œ°€Ü°€à°€ä°€ÄÀ°€ÄÄ¤(€€€€€€€€IQUI9%9€©€°(€€€€€€€l(€€€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°(€€€€€€€€€Ñ•¹…¹Ñ%°(€€€€€€€€€±•…Í•%°(€€€€€€€€€Á…åµ•¹Ð¹É½ÝÍlÁt¹¥°(€€€€€€€€€ÕÉÉ•¹ä°(€€€€€€€€€…µ½Õ¹Ð°(€€€€€€€€€Á…åµ•¹Ñ…Ñ”°(€€€€€€€€€¹½Éµ…±¥é•‘I•™•É•¹”°(€€€€€€€€€‰½‘ä¹¹½Ñ•Ì€üMÑÉ¥¹œ¡‰½‘ä¹¹½Ñ•Ì¤€è¹Õ±°°(€€€€€€€€€¥‘•µÁ½Ñ•¹å-•ä°(€€€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•É% ¤€üü€Ä°(€€€€€€€t°(€€€€€€¤ì(€€€€€±•Ðµ½Ù•µ•¹ÐèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸øð¹Õ±°€ô¹Õ±°ì(€€€€€±•Ð‰…¹­QÉ…¹Í…Ñ¥½¸èI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸øð¹Õ±°€ô¹Õ±°ì(€€€€€¥˜€¡Á…åµ•¹Ñ5•Ñ¡½€ôôô€	9,œ¤ì(€€€€€€€½¹ÍÐÑÉ…¹Í…Ñ¥½¹QåÁ”€ô…Ý…¥ÐÑ¡¥Ì¹‰…¹­Õ…É…¹Ñ••QÉ…¹Í…Ñ¥½¹QåÁ”¡±¥•¹Ð°€Q99Q}I%Pœ¤ì(€€€€€€€‰…¹­QÉ…¹Í…Ñ¥½¸€ô…Ý…¥ÐÑ¡¥Ì¹É•…Ñ•Õ…É…¹Ñ••	…¹­QÉ…¹Í…Ñ¥½¹%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹Ð°ì(€€€€€€€€€‰…¹­½Õ¹Ðè‰…¹­½Õ¹Ð…Ìì¥è¹Õµ‰•Èì‰…¹­}¹…µ”üèÍÑÉ¥¹œð¹Õ±°ì…½Õ¹Ñ}¹…µ”üèÍÑÉ¥¹œð¹Õ±°ìÕÉÉ•¹äèÍÑÉ¥¹œô°(€€€€€€€€€…µ½Õ¹Ð°(€€€€€€€€€ÕÉÉ•¹ä°(€€€€€€€€€É••¥ÁÑ9Õµ‰•È°(€€€€€€€€€É•™•É•¹”è¹½Éµ…±¥é•‘I•™•É•¹”°(€€€€€€€€€É•…Ñ•‘	äèÑ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•É% ¤€üü¹Õ±°°(€€€€€€€€€ÑÉ…¹Í…Ñ¥½¹QåÁ”°(€€€€€€€€€Í½ÕÉ•5½‘Õ±”è€Q99Q}I%QLœ°(€€€€€€€€€‘¥É•Ñ¥½¸è€%8œ°(€€€€€€€€€Í½ÕÉ•¹Ñ¥ÑåQåÁ”è€Q99Q}I%Pœ°(€€€€€€€€€Í½ÕÉ•¹Ñ¥Ñå%è9Õµ‰•È¡É•‘¥Ð¹É½ÝÍlÁt¹¥¤°(€€€€€€€€€‘•ÍÉ¥ÁÑ¥½¸è€Ë¥‘¥Ð±½…Ñ…¥É”€¼A…¥•µ•¹Ð…¹Ñ¥¥Ã¤±½…Ñ…¥É”œ°(€€€€€€€€€Ñ•¹…¹Ñ9…µ”èÑ•¹…¹ÑI½Ü¹¹…µ”°(€€€€€€€€€±•…Í•9Õµ‰•Èè±•…Í•%€üü¹Õ±°°(€€€€€€€€€Õ¹¥Ñ9Õµ‰•Èè¹Õ±°°(€€€€€€€ô¤ì(€€€€€ô•±Í”ì(€€€€€€€µ½Ù•µ•¹Ð€ô…Ý…¥ÐÑ¡¥Ì¹É•…Ñ•…Í¡5½Ù•µ•¹Ñ%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹Ð°ì(€€€€€€€€€ÑåÁ”è€%8œ°(€€€€€€€€€…Ñ•½Éäè€Q99Q}I%Pœ°(€€€€€€€€€…µ½Õ¹Ð°(€€€€€€€€€µ½Ù•µ•¹Ñ}‘…Ñ”èÁ…åµ•¹Ñ…Ñ”°(€€€€€€€€€Á…åµ•¹Ñ}¥èÁ…åµ•¹Ð¹É½ÝÍlÁt¹¥°(€€€€€€€€€Ñ•¹…¹Ñ}¥èÑ•¹…¹Ñ%°(€€€€€€€€€‘•ÍÉ¥ÁÑ¥½¸è€A…¥•µ•¹Ð…¹Ñ¥¥Ã¤±½…Ñ…¥É”œ°(€€€€€€€€€É•™•É•¹”è¹½Éµ…±¥é•‘I•™•É•¹”°(€€€€€€€€€ÕÉÉ•¹ä°(€€€€€€€€€•á¡…¹•}É…Ñ•}ÕÍ•è•á¡…¹•I…Ñ•UÍ•°(€€€€€€€€€•á¡…¹•}É…Ñ•}‘…Ñ”è•á¡…¹•I…Ñ•…Ñ”°(€€€€€€€€€•ÅÕ¥Ù…±•¹Ñ}ÕÍèÑ½Ñ…±ÅÕ¥Ù…±•¹ÑUÍ°(€€€€€€€ô¤ì(€€€€€€€¥˜€¡…Ý…¥ÐÑ¡¥Ì¹½±Õµ¹á¥ÍÑÌ …Í¡}µ½Ù•µ•¹ÑÌœ°€Ñ•¹…¹Ñ}É•‘¥Ñ}¥œ¤¤ì(€€€€€€€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€€€€€UAQ…Í¡}µ½Ù•µ•¹ÑÌ(€€€€€€€€€€€€MPÑ•¹…¹Ñ}É•‘¥Ñ}¥€ô€Ä(€€€€€€€€€€€€]!I¥€ô€È9½É…¹¥é…Ñ¥½¹}¥€ô€Í€°(€€€€€€€€€€€mÉ•‘¥Ð¹É½ÝÍlÁt¹¥°µ½Ù•µ•¹Ðü¹¥€üü¹Õ±°°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€€€€€€€¤ì(€€€€€€€ô(€€€€€ô(€€€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€%9MIP%9Q<…Õ‘¥Ñ}±½Ì€¡½É…¹¥é…Ñ¥½¹}¥°ÕÍ•É}¥°…Ñ¥½¸°É•Í½ÕÉ”°É•Í½ÕÉ•}¥°µ•Ñ¡½°Á…Ñ °ÍÑ…ÑÕÍ}½‘”°µ•Ñ…‘…Ñ„¤(€€€€€€€€Y1UL€ Ä°€È°€Q99Q}I%Q}IQœ°€Ñ•¹…¹Ñ}É•‘¥ÑÌœ°€Ì°€A=MPœ°€œ½…Á¤½Ñ•¹…¹ÐµÉ•‘¥ÑÌœ°€ÈÀÄ°€Ð¥€°(€€€€€€€l(€€€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°(€€€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•É% ¤€üü¹Õ±°°(€€€€€€€€€MÑÉ¥¹œ¡É•‘¥Ð¹É½ÝÍlÁt¹¥¤°(€€€€€€€€€)M=8¹ÍÑÉ¥¹¥™ä¡ìÑ•¹…¹Ñ}¥èÑ•¹…¹Ñ%°±•…Í•}¥è±•…Í•%°Í½ÕÉ•}Á…åµ•¹Ñ}¥èÁ…åµ•¹Ð¹É½ÝÍlÁt¹¥°…µ½Õ¹Ð°ÕÉÉ•¹äô¤°(€€€€€€€t°(€€€€€€¤ì(€€€€€É•ÑÕÉ¸ì(€€€€€€€€¸¸¹É•‘¥Ð¹É½ÝÍlÁt°(€€€€€€€É••¥ÁÑ}¹Õµ‰•ÈèÁ…åµ•¹Ð¹É½ÝÍlÁt¹É••¥ÁÑ}¹Õµ‰•È°(€€€€€€€Í½ÕÉ•}Á…åµ•¹Ñ}¥èÁ…åµ•¹Ð¹É½ÝÍlÁt¹¥°(€€€€€€€…Í¡}µ½Ù•µ•¹Ñ}¥èµ½Ù•µ•¹Ðü¹¥€üü¹Õ±°°(€€€€€€€…Í¡}µ½Ù•µ•¹Ðèµ½Ù•µ•¹Ð°(€€€€€€€‰…¹­}ÑÉ…¹Í…Ñ¥½¸è‰…¹­QÉ…¹Í…Ñ¥½¸°(€€€€€ôì(€€€ô¤ì(€€€Ù½¥Ñ¡¥Ì¹Í•¹‘Q•¹…¹ÑÉ•‘¥ÑI••¥ÁÑ%™¹…‰±•¡É•‘¥Ð¹¥¤¹…Ñ  ¡•ÉÉ½È¤€ôøì(€€€€€Ñ¡¥Ì¹±½•È¹•ÉÉ½È (€€€€€€€mQ99Q}I%Qt…Íå¹ŒÉ••¥ÁÐ•µ…¥°™…¥±•É•‘¥Ñ%ô‘í9Õµ‰•È¡É•‘¥Ð¹¥¥ô½É…¹¥é…Ñ¥½¹%ô‘íÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥ôµ•ÍÍ…”ô‘í•ÉÉ½È¥¹ÍÑ…¹•½˜ÉÉ½È€ü•ÉÉ½È¹µ•ÍÍ…”€èMÑÉ¥¹œ¡•ÉÉ½È¥õ€°(€€€€€€¤ì(€€€ô¤ì(€€€É•ÑÕÉ¸É•‘¥Ðì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÍ•¹‘1•…Í•%¹Ù½¥•µ…¥±%™¹…‰±•¡¥¹Ù½¥”èI•½ÉñÍÑÉ¥¹œ°…¹äø¤ì(€€€…Ý…¥ÐÑ¡¥Ì¹½µµÕ¹¥…Ñ¥½¹M•ÉÙ¥”¹Í•¹‘½Õµ•¹Ð¡ì(€€€€€‘½Õµ•¹ÑQåÁ”è½Õµ•¹ÑQåÁ”¹%9Y=%°(€€€€€‘½Õµ•¹Ñ%è9Õµ‰•È¡¥¹Ù½¥”¹¥¤°(€€€€€µ•ÍÍ…”è€Y•Õ¥±±•èÑÉ½ÕÙ•È¤µ©½¥¹ÐÙ½ÑÉ”™…ÑÕÉ”¸œ°(€€€€€ÑÉ¥•Èè½Õµ•¹Ñ•±¥Ù•ÉåQÉ¥•È¹UQ<°(€€€ô¤ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÍ•¹‘Q•¹…¹ÑÉ•‘¥ÑI••¥ÁÑ%™¹…‰±•¡É•‘¥Ñ%è¹Õµ‰•È¤ì(€€€…Ý…¥ÐÑ¡¥Ì¹½µµÕ¹¥…Ñ¥½¹M•ÉÙ¥”¹Í•¹‘½Õµ•¹Ð¡ì(€€€€€‘½Õµ•¹ÑQåÁ”è½Õµ•¹ÑQåÁ”¹Q99Q}I%Q}I%AP°(€€€€€‘½Õµ•¹Ñ%èÉ•‘¥Ñ%°(€€€€€µ•ÍÍ…”è€Y•Õ¥±±•èÑÉ½ÕÙ•È¤µ©½¥¹ÐÙ½ÑÉ”É—Ô‘”Ë¥‘¥Ð±½…Ñ…¥É”¸œ°(€€€€€ÑÉ¥•Èè½Õµ•¹Ñ•±¥Ù•ÉåQÉ¥•È¹UQ<°(€€€ô¤ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÙ•¹Ñ¥±…Ñ•…Í¡Q•¹…¹ÑÉ•‘¥Ñ±±½…Ñ¥½¹%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹ÐèA½½±±¥•¹Ð°…ÉÌèì(€€€½É…¹¥é…Ñ¥½¹%è¹Õµ‰•Èì(€€€Ñ•¹…¹ÑÉ•‘¥Ñ%è¹Õµ‰•Èì(€€€¥¹Ù½¥•%è¹Õµ‰•Èì(€€€…µ½Õ¹ÑÁÁ±¥•è¹Õµ‰•Èì(€€€É•…Ñ•‘	äüè¹Õµ‰•Èð¹Õ±°ì(€ô¤ì(€€€…Ý…¥ÐÑ¡¥Ì¹•¹ÍÕÉ•Må¹‘¥…Í¡M¡•µ„¡±¥•¹Ð¤ì(€€€½¹ÍÐÍ½ÕÉ•I•ÍÕ±Ð€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1PÑŒ¹Í½ÕÉ•}Á…åµ•¹Ñ}¥°(€€€€€€€€€€€€€ÑŒ¹Ñ•¹…¹Ñ}¥°(€€€€€€€€€€€€€À¹Á…åµ•¹Ñ}µ•Ñ¡½°(€€€€€€€€€€€€€À¹Á…åµ•¹Ñ}‘…Ñ”èéQaPLÁ…åµ•¹Ñ}‘…Ñ”°(€€€€€€€€€€€€€À¹É•™•É•¹”°(€€€€€€€€€€€€€´¹¥L…Í¡}µ½Ù•µ•¹Ñ}¥°(€€€€€€€€€€€€€´¹…µ½Õ¹Ðèé1=PL…Í¡}…µ½Õ¹Ð°(€€€€€€€€€€€€€´¹ÕÉÉ•¹ä°(€€€€€€€€€€€€€´¹•ÅÕ¥Ù…±•¹Ñ}ÕÍèé1=PL…Í¡}•ÅÕ¥Ù…±•¹Ñ}ÕÍ°(€€€€€€€€€€€€€´¹•á¡…¹•}É…Ñ•}ÕÍ•èé1=PL•á¡…¹•}É…Ñ•}ÕÍ•°(€€€€€€€€€€€€€´¹•á¡…¹•}É…Ñ•}‘…Ñ”èéQaPL•á¡…¹•}É…Ñ•}‘…Ñ”(€€€€€€I=4Ñ•¹…¹Ñ}É•‘¥ÑÌÑŒ(€€€€€€)=%8Á…åµ•¹ÑÌÀ(€€€€€€€€=8À¹¥€ôÑŒ¹Í½ÕÉ•}Á…åµ•¹Ñ}¥(€€€€€€€9À¹½É…¹¥é…Ñ¥½¹}¥€ôÑŒ¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€€9À¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€)=%8…Í¡}µ½Ù•µ•¹ÑÌ´(€€€€€€€€=8´¹½É…¹¥é…Ñ¥½¹}¥€ôÑŒ¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€€9€¡´¹Ñ•¹…¹Ñ}É•‘¥Ñ}¥€ôÑŒ¹¥=H´¹Á…åµ•¹Ñ}¥€ôÑŒ¹Í½ÕÉ•}Á…åµ•¹Ñ}¥¤(€€€€€€€9´¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€]!IÑŒ¹¥€ô€Ä(€€€€€€€€9ÑŒ¹½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€9ÑŒ¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€9À¹Á…åµ•¹Ñ}µ•Ñ¡½%8€ M œ°€5=	%1}5=9dœ¤(€€€€€€=IH	dM]!8´¹Ñ•¹…¹Ñ}É•‘¥Ñ}¥€ôÑŒ¹¥Q!8€À1M€Ä9°´¹¥M(€€€€€€1%5%P€Ä(€€€€€€=HUAQ=µ€°(€€€€€m…ÉÌ¹Ñ•¹…¹ÑÉ•‘¥Ñ%°…ÉÌ¹½É…¹¥é…Ñ¥½¹%‘t°(€€€€¤ì(€€€½¹ÍÐÍ½ÕÉ”€ôÍ½ÕÉ•I•ÍÕ±Ð¹É½ÝÍlÁtì(€€€¥˜€ …Í½ÕÉ”¤É•ÑÕÉ¸ìÍå¹‘¥}…µ½Õ¹Ðè€À°Í­¥ÁÁ•èÑÉÕ”ôì((€€€½¹ÍÐ¥¹Ù½¥•I•ÍÕ±Ð€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P=1M¡±¥¹•Ì¹Ñ½Ñ…±}…µ½Õ¹Ð°¤¹Ñ½Ñ…°°€À¤èé1=PL¥¹Ù½¥•}…µ½Õ¹Ð°(€€€€€€€€€€€€€=1M¡±¥¹•Ì¹Íå¹‘¥}…µ½Õ¹Ð°€À¤èé1=PLÍå¹‘¥}…µ½Õ¹Ð(€€€€€€I=4¥¹Ù½¥•Ì¤(€€€€€€1P)=%81QI0€ (€€€€€€€€M1P=1M¡MU4¡¥¤¹…µ½Õ¹Ð¤°€À¤LÑ½Ñ…±}…µ½Õ¹Ð°(€€€€€€€€€€€€€€€=1M¡MU4 (€€€€€€€€€€€€€€€€€M(€€€€€€€€€€€€€€€€€€€]!8UAAH¡QI%4¡=1M¡¥¤¹¥Ñ•µ}ÑåÁ”°€œœ¤¤¤€ô€Me9%œ(€€€€€€€€€€€€€€€€€€€€€=HUAAH¡QI%4¡=1M¡¥¤¹‘•ÍÉ¥ÁÑ¥½¸°€œœ¤¤¤1%-€Me9%”œ(€€€€€€€€€€€€€€€€€€€Q!8¥¤¹…µ½Õ¹Ð1M€À(€€€€€€€€€€€€€€€€€9(€€€€€€€€€€€€€€€€¤°€À¤LÍå¹‘¥}…µ½Õ¹Ð(€€€€€€€€I=4¥¹Ù½¥•}¥Ñ•µÌ¥¤(€€€€€€€€]!I¥¤¹¥¹Ù½¥•}¥€ô¤¹¥(€€€€€€€€€€9¥¤¹½É…¹¥é…Ñ¥½¹}¥€ô¤¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€€€€€9¥¤¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€¤±¥¹•Ì=8QIU(€€€€€€]!I¤¹¥€ô€Ä(€€€€€€€€9¤¹½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€9¤¹‘•±•Ñ•‘}…Ð%L9U11€°(€€€€€m…ÉÌ¹¥¹Ù½¥•%°…ÉÌ¹½É…¹¥é…Ñ¥½¹%‘t°(€€€€¤ì(€€€½¹ÍÐ¥¹Ù½¥”€ôÉ•ÅÕ¥É•I½Ü¡¥¹Ù½¥•I•ÍÕ±Ð¹É½ÝÍlÁt°€%¹Ù½¥”œ¤ì(€€€½¹ÍÐ¥¹Ù½¥•µ½Õ¹Ð€ô9Õµ‰•È¡¥¹Ù½¥”¹¥¹Ù½¥•}…µ½Õ¹Ð€üü€À¤ì(€€€½¹ÍÐ¥¹Ù½¥•Må¹‘¥µ½Õ¹Ð€ô9Õµ‰•È¡¥¹Ù½¥”¹Íå¹‘¥}…µ½Õ¹Ð€üü€À¤ì(€€€½¹ÍÐÍå¹‘¥I…Ñ¥¼€ô¥¹Ù½¥•µ½Õ¹Ð€ø€À(€€€€€€ü5…Ñ ¹µ¥¸¡5…Ñ ¹µ…à¡¥¹Ù½¥•Må¹‘¥µ½Õ¹Ð€¼¥¹Ù½¥•µ½Õ¹Ð°€À¤°€Ä¤(€€€€€€è€Àì(€€€½¹ÍÐÍå¹‘¥µ½Õ¹Ð€ô9Õµ‰•È ¡…ÉÌ¹…µ½Õ¹ÑÁÁ±¥•€¨Íå¹‘¥I…Ñ¥¼¤¹Ñ½¥á• È¤¤ì(€€€¥˜€ „¡Íå¹‘¥µ½Õ¹Ð€ø€À¤¤É•ÑÕÉ¸ìÍå¹‘¥}…µ½Õ¹Ðè€À°Í­¥ÁÁ•èÑÉÕ”ôì(€€€¥˜€¡9Õµ‰•È¡Í½ÕÉ”¹…Í¡}…µ½Õ¹Ð€üü€À¤€ðÍå¹‘¥µ½Õ¹Ð¤ì(€€€€€Ñ¡É½Ü¹•Ü½¹™±¥Ñá•ÁÑ¥½¸ 1„Ù•¹Ñ¥±…Ñ¥½¸Íå¹‘¥Œ“¥Á…ÍÍ”±”Í½±‘”‘Ôµ½ÕÙ•µ•¹Ð‘”…¥ÍÍ”Í½ÕÉ”¸œ¤ì(€€€ô((€€€½¹ÍÐ•ÅÕ¥Ù…±•¹ÑI…Ñ¥¼€ô9Õµ‰•È¡Í½ÕÉ”¹…Í¡}…µ½Õ¹Ð€üü€À¤€ø€À(€€€€€€ü9Õµ‰•È¡Í½ÕÉ”¹…Í¡}•ÅÕ¥Ù…±•¹Ñ}ÕÍ€üü€À¤€¼9Õµ‰•È¡Í½ÕÉ”¹…Í¡}…µ½Õ¹Ð¤(€€€€€€è€Äì(€€€½¹ÍÐÍå¹‘¥ÅÕ¥Ù…±•¹ÑUÍ€ô9Õµ‰•È ¡Íå¹‘¥µ½Õ¹Ð€¨•ÅÕ¥Ù…±•¹ÑI…Ñ¥¼¤¹Ñ½¥á• È¤¤ì(€€€½¹ÍÐ‰É•…­‘½Ý¹¹ÑÉä€ôì(€€€€€Ñ•¹…¹Ñ}É•‘¥Ñ}¥è…ÉÌ¹Ñ•¹…¹ÑÉ•‘¥Ñ%°(€€€€€¥¹Ù½¥•}¥è…ÉÌ¹¥¹Ù½¥•%°(€€€€€…±±½…Ñ•‘}…µ½Õ¹Ðè…ÉÌ¹…µ½Õ¹ÑÁÁ±¥•°(€€€€€Íå¹‘¥}É…Ñ¥¼è9Õµ‰•È¡Íå¹‘¥I…Ñ¥¼¹Ñ½¥á• à¤¤°(€€€€€Íå¹‘¥}…µ½Õ¹ÐèÍå¹‘¥µ½Õ¹Ð°(€€€ôì((€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€UAQ…Í¡}µ½Ù•µ•¹ÑÌ(€€€€€€MP…µ½Õ¹Ð€ô…µ½Õ¹Ð€´€È°(€€€€€€€€€€•ÅÕ¥Ù…±•¹Ñ}ÕÍ€ôIQMP À°•ÅÕ¥Ù…±•¹Ñ}ÕÍ€´€Ì¤°(€€€€€€€€€€‘•ÍÉ¥ÁÑ¥½¸€ô€Ë¥‘¥Ð±½…Ñ…¥É”€¡¡½ÉÌÍå¹‘¥Œ¤œ(€€€€€€]!I¥€ô€Ä(€€€€€€€€9½É…¹¥é…Ñ¥½¹}¥€ô€Ð(€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U11€°(€€€€€mÍ½ÕÉ”¹…Í¡}µ½Ù•µ•¹Ñ}¥°Íå¹‘¥µ½Õ¹Ð°Íå¹‘¥ÅÕ¥Ù…±•¹ÑUÍ°…ÉÌ¹½É…¹¥é…Ñ¥½¹%‘t°(€€€€¤ì(€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€%9MIP%9Q<Íå¹‘¥}…Í¡}µ½Ù•µ•¹ÑÌ€ (€€€€€€€€½É…¹¥é…Ñ¥½¹}¥°ÑåÁ”°µ½Ù•µ•¹Ñ}ÑåÁ”°…µ½Õ¹Ð°ÕÉÉ•¹ä°•ÅÕ¥Ù…±•¹Ñ}ÕÍ°(€€€€€€€€•á¡…¹•}É…Ñ•}ÕÍ•°•á¡…¹•}É…Ñ•}‘…Ñ”°µ½Ù•µ•¹Ñ}‘…Ñ”°Á…åµ•¹Ñ}¥°¥¹Ù½¥•}¥°(€€€€€€€€Ñ•¹…¹Ñ}¥°Á…åµ•¹Ñ}µ•Ñ¡½°ÑÉ•…ÍÕÉå}±½…Ñ¥½¸°É•™•É•¹”°‘•ÍÉ¥ÁÑ¥½¸°(€€€€€€€€…±±½…Ñ¥½¹}‰É•…­‘½Ý¸°É•…Ñ•‘}‰ä(€€€€€€€¤Y1UL€ (€€€€€€€€€Ä°€%8œ°€Me9%}Ae59Pœ°€È°€Ì°€Ð°(€€€€€€€€€Ô°€Ø°€Ü°€à°€ä°(€€€€€€€€€ÄÀ°€ÄÄ°€5%9}M œ°€ÄÈ°€A…¥•µ•¹ÐÍå¹‘¥ŒÙ¥„Ë¥‘¥Ð±½…Ñ…¥É”œ°(€€€€€€€€€ÄÌèé)M=9°€ÄÐ(€€€€€€€¤(€€€€€€=8=91%P€¡½É…¹¥é…Ñ¥½¹}¥°Á…åµ•¹Ñ}¥°ÕÉÉ•¹ä¤(€€€€€€]!IÁ…åµ•¹Ñ}¥%L9=P9U109‘•±•Ñ•‘}…Ð%L9U10(€€€€€€<UAQMP(€€€€€€€€…µ½Õ¹Ð€ôÍå¹‘¥}…Í¡}µ½Ù•µ•¹ÑÌ¹…µ½Õ¹Ð€¬a1U¹…µ½Õ¹Ð°(€€€€€€€€•ÅÕ¥Ù…±•¹Ñ}ÕÍ€ôÍå¹‘¥}…Í¡}µ½Ù•µ•¹ÑÌ¹•ÅÕ¥Ù…±•¹Ñ}ÕÍ€¬a1U¹•ÅÕ¥Ù…±•¹Ñ}ÕÍ°(€€€€€€€€¥¹Ù½¥•}¥€ôa1U¹¥¹Ù½¥•}¥°(€€€€€€€€…±±½…Ñ¥½¹}‰É•…­‘½Ý¸€ôÍå¹‘¥}…Í¡}µ½Ù•µ•¹ÑÌ¹…±±½…Ñ¥½¹}‰É•…­‘½Ý¸ñða1U¹…±±½…Ñ¥½¹}‰É•…­‘½Ý¹€°(€€€€€l(€€€€€€€…ÉÌ¹½É…¹¥é…Ñ¥½¹%°(€€€€€€€Íå¹‘¥µ½Õ¹Ð°(€€€€€€€Í½ÕÉ”¹ÕÉÉ•¹ä°(€€€€€€€Íå¹‘¥ÅÕ¥Ù…±•¹ÑUÍ°(€€€€€€€Í½ÕÉ”¹•á¡…¹•}É…Ñ•}ÕÍ•€üü¹Õ±°°(€€€€€€€Í½ÕÉ”¹•á¡…¹•}É…Ñ•}‘…Ñ”€üü¹Õ±°°(€€€€€€€Í½ÕÉ”¹Á…åµ•¹Ñ}‘…Ñ”°(€€€€€€€Í½ÕÉ”¹Í½ÕÉ•}Á…åµ•¹Ñ}¥°(€€€€€€€…ÉÌ¹¥¹Ù½¥•%°(€€€€€€€Í½ÕÉ”¹Ñ•¹…¹Ñ}¥°(€€€€€€€Í½ÕÉ”¹Á…åµ•¹Ñ}µ•Ñ¡½°(€€€€€€€Í½ÕÉ”¹É•™•É•¹”€üü¹Õ±°°(€€€€€€€)M=8¹ÍÑÉ¥¹¥™ä¡m‰É•…­‘½Ý¹¹ÑÉåt¤°(€€€€€€€…ÉÌ¹É•…Ñ•‘	ä€üü¹Õ±°°(€€€€€t°(€€€€¤ì(€€€É•ÑÕÉ¸ìÍå¹‘¥}…µ½Õ¹ÐèÍå¹‘¥µ½Õ¹Ð°Í­¥ÁÁ•è™…±Í”ôì(€ô((€…Íå¹Œ…ÁÁ±åQ•¹…¹ÑÉ•‘¥ÑÍQ½I•¹Ñ%¹Ù½¥•%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹ÐèA½½±±¥•¹Ð°…ÉÌèì(€€€½É…¹¥é…Ñ¥½¹%è¹Õµ‰•Èì(€€€¥¹Ù½¥•%è¹Õµ‰•Èì(€€€±•…Í•%è¹Õµ‰•Èð¹Õ±°ì(€€€Ñ•¹…¹Ñ%è¹Õµ‰•Èð¹Õ±°ì(€€€É•…Ñ•‘	äüè¹Õµ‰•Èð¹Õ±°ì(€ô¤ì(€€€¥˜€ ……ÉÌ¹±•…Í•%ñð€……ÉÌ¹Ñ•¹…¹Ñ%¤ì(€€€€€É•ÑÕÉ¸ì…ÁÁ±¥•‘}Ñ½Ñ…°è€À°…±±½…Ñ¥½¹Ìèmt…ÌÉÉ…äñI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸øøôì(€€€ô((€€€½¹ÍÐ¥¹Ù½¥•I•ÍÕ±Ð€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P¥°¥¹Ù½¥•}¹Õµ‰•È°¥¹Ù½¥•}ÑåÁ”°¥ÍÍÕ•}‘…Ñ”èéQaPL¥ÍÍÕ•}‘…Ñ”°ÍÑ…ÑÕÌ°Ñ½Ñ…°(€€€€€€I=4¥¹Ù½¥•Ì(€€€€€€]!I¥€ô€Ä(€€€€€€€€9½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U10(€€€€€€=HUAQ€°(€€€€€m…ÉÌ¹¥¹Ù½¥•%°…ÉÌ¹½É…¹¥é…Ñ¥½¹%‘t°(€€€€¤ì(€€€½¹ÍÐ¥¹Ù½¥”€ôÉ•ÅÕ¥É•I½Ü¡¥¹Ù½¥•I•ÍÕ±Ð¹É½ÝÍlÁt°€%¹Ù½¥”œ¤ì(€€€¥˜€¡MÑÉ¥¹œ¡¥¹Ù½¥”¹¥¹Ù½¥•}ÑåÁ”€üü€œœ¤¹Ñ½UÁÁ•É…Í” ¤€„ôô€I9Pœ¤ì(€€€€€É•ÑÕÉ¸ì…ÁÁ±¥•‘}Ñ½Ñ…°è€À°…±±½…Ñ¥½¹Ìèmt…ÌÉÉ…äñI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸øøôì(€€€ô(€€€¥˜€¡lIPœ°€911t¹¥¹±Õ‘•Ì¡MÑÉ¥¹œ¡¥¹Ù½¥”¹ÍÑ…ÑÕÌ€üü€œœ¤¹Ñ½UÁÁ•É…Í” ¤¤¤ì(€€€€€É•ÑÕÉ¸ì…ÁÁ±¥•‘}Ñ½Ñ…°è€À°…±±½…Ñ¥½¹Ìèmt…ÌÉÉ…äñI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸øøôì(€€€ô((€€€½¹ÍÐÉ•‘¥ÑÌ€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P€¨(€€€€€€I=4Ñ•¹…¹Ñ}É•‘¥ÑÌ(€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€9±•…Í•}¥€ô€È(€€€€€€€€9Ñ•¹…¹Ñ}¥€ô€Ì(€€€€€€€€9ÕÉÉ•¹ä€ô€UMœ(€€€€€€€€9ÍÑ…ÑÕÌ%8€ Y%1	1œ°€AIQ%11e}UMœ¤(€€€€€€€€9É•µ…¥¹¥¹}…µ½Õ¹Ð€ø€À(€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U10(€€€€€€=IH	dÁ…åµ•¹Ñ}‘…Ñ”M°¥M(€€€€€€=HUAQ€°(€€€€€m…ÉÌ¹½É…¹¥é…Ñ¥½¹%°…ÉÌ¹±•…Í•%°…ÉÌ¹Ñ•¹…¹Ñ%‘t°(€€€€¤ì((€€€±•ÐÉ•µ…¥¹¥¹Q½ÁÁ±ä€ô9Õµ‰•È¡¥¹Ù½¥”¹Ñ½Ñ…°€üü€À¤ì(€€€½¹ÍÐ…±±½…Ñ¥½¹ÌèÉÉ…äñI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸øø€ômtì((€€€™½È€¡½¹ÍÐÉ•‘¥Ð½˜É•‘¥ÑÌ¹É½ÝÌ¤ì(€€€€€¥˜€¡É•µ…¥¹¥¹Q½ÁÁ±ä€ðô€À¤‰É•…¬ì(€€€€€½¹ÍÐ‘ÕÁ±¥…Ñ”€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€M1P€Ä(€€€€€€€€I=4Ñ•¹…¹Ñ}É•‘¥Ñ}…±±½…Ñ¥½¹Ì(€€€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€€€9Ñ•¹…¹Ñ}É•‘¥Ñ}¥€ô€È(€€€€€€€€€€9¥¹Ù½¥•}¥€ô€Ì(€€€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€1%5%P€Å€°(€€€€€€€m…ÉÌ¹½É…¹¥é…Ñ¥½¹%°É•‘¥Ð¹¥°…ÉÌ¹¥¹Ù½¥•%‘t°(€€€€€€¤ì(€€€€€¥˜€¡‘ÕÁ±¥…Ñ”¹É½ÝÍlÁt¤ì(€€€€€€€½¹Ñ¥¹Õ”ì(€€€€€ô((€€€€€½¹ÍÐ…Ù…¥±…‰±”€ô9Õµ‰•È¡É•‘¥Ð¹É•µ…¥¹¥¹}…µ½Õ¹Ð€üü€À¤ì(€€€€€¥˜€ „¡…Ù…¥±…‰±”€ø€À¤¤½¹Ñ¥¹Õ”ì(€€€€€½¹ÍÐ…µ½Õ¹ÑÁÁ±¥•€ô9Õµ‰•È¡5…Ñ ¹µ¥¸¡…Ù…¥±…‰±”°É•µ…¥¹¥¹Q½ÁÁ±ä¤¹Ñ½¥á• È¤¤ì(€€€€€¥˜€ „¡…µ½Õ¹ÑÁÁ±¥•€ø€À¤¤½¹Ñ¥¹Õ”ì((€€€€€½¹ÍÐÁ…åµ•¹ÑI•™•É•¹”€ôI%Pµ11=´‘íÉ•‘¥Ð¹¥‘ô´‘í…ÉÌ¹¥¹Ù½¥•%‘õ€ì(€€€€€½¹ÍÐ¥‘•µÁ½Ñ•¹å-•ä€ôQ99Q}I%Q}11=Q%=8è‘í…ÉÌ¹½É…¹¥é…Ñ¥½¹%‘ôè‘íÉ•‘¥Ð¹¥‘ôè‘í…ÉÌ¹¥¹Ù½¥•%‘õ€ì(€€€€€½¹ÍÐÁ…åµ•¹ÑI•ÍÕ±Ð€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€%9MIP%9Q<Á…åµ•¹ÑÌ(€€€€€€€€€€¡¥¹Ù½¥•}¥°Á…åµ•¹Ñ}‘…Ñ”°…µ½Õ¹Ð°Á…åµ•¹Ñ}µ•Ñ¡½°É•™•É•¹”°¹½Ñ•Ì°Á…å•É}¹…µ”°É••¥ÁÑ}¹Õµ‰•È°(€€€€€€€€€€ÕÉÉ•¹ä°…µ½Õ¹Ñ}ÕÍ°…µ½Õ¹Ñ}‘˜°•á¡…¹•}É…Ñ•}ÕÍ•°•á¡…¹•}É…Ñ•}‘…Ñ”°‘™}•ÅÕ¥Ù…±•¹Ñ}ÕÍ°Ñ½Ñ…±}•ÅÕ¥Ù…±•¹Ñ}ÕÍ°(€€€€€€€€€€½É…¹¥é…Ñ¥½¹}¥°Á…åµ•¹Ñ}ÑåÁ”°¥‘•µÁ½Ñ•¹å}­•ä¤(€€€€€€€€Y1UL(€€€€€€€€€€ Ä°€È°€Ì°€Q99Q}I%Pœ°€Ð°€Ô°€Ø°9U10°(€€€€€€€€€€€UMœ°€Ì°€À°9U10°9U10°€À°€Ì°(€€€€€€€€€€€Ü°€Q99Q}I%Q}11=Q%=8œ°€à¤(€€€€€€€€=8=91%P€¡½É…¹¥é…Ñ¥½¹}¥°¥‘•µÁ½Ñ•¹å}­•ä¤(€€€€€€€€]!I‘•±•Ñ•‘}…Ð%L9U109¥‘•µÁ½Ñ•¹å}­•ä%L9=P9U10(€€€€€€€€<9=Q!%9(€€€€€€€€IQUI9%9€©€°(€€€€€€€l(€€€€€€€€€…ÉÌ¹¥¹Ù½¥•%°(€€€€€€€€€MÑÉ¥¹œ¡¥¹Ù½¥”¹¥ÍÍÕ•}‘…Ñ”¤¹Í±¥” À°€ÄÀ¤°(€€€€€€€€€…µ½Õ¹ÑÁÁ±¥•°(€€€€€€€€€Á…åµ•¹ÑI•™•É•¹”°(€€€€€€€€€€A…¥•µ•¹ÐÁ…ÈË¥‘¥Ð±½…Ñ…¥É”œ°(€€€€€€€€€É•‘¥Ð¹É•™•É•¹”€üüË¥‘¥Ð±½…Ñ…¥É”€Œ‘íÉ•‘¥Ð¹¥‘õ€°(€€€€€€€€€…ÉÌ¹½É…¹¥é…Ñ¥½¹%°(€€€€€€€€€¥‘•µÁ½Ñ•¹å-•ä°(€€€€€€€t°(€€€€€€¤ì((€€€€€½¹ÍÐÁ…åµ•¹Ð€ô(€€€€€€€Á…åµ•¹ÑI•ÍÕ±Ð¹É½ÝÍlÁt(€€€€€€€€üü€ (€€€€€€€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€€€€€M1P€¨(€€€€€€€€€€€€I=4Á…åµ•¹ÑÌ(€€€€€€€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€€€€€€€9¥‘•µÁ½Ñ•¹å}­•ä€ô€È(€€€€€€€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€€€€€1%5%P€Å€°(€€€€€€€€€€€m…ÉÌ¹½É…¹¥é…Ñ¥½¹%°¥‘•µÁ½Ñ•¹å-•åt°(€€€€€€€€€€¤(€€€€€€€€¤¹É½ÝÍlÁtì(€€€€€¥˜€ …Á…åµ•¹Ð¤ì(€€€€€€€Ñ¡É½Ü¹•Ü½¹™±¥Ñá•ÁÑ¥½¸ %µÁ½ÍÍ¥‰±”‘”Ë¥•È±”Á…¥•µ•¹Ð“Še…™™•Ñ…Ñ¥½¸‘ÔË¥‘¥Ð±½…Ñ…¥É”¸œ¤ì(€€€€€ô((€€€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€%9MIP%9Q<Á…åµ•¹Ñ}…±±½…Ñ¥½¹Ì€¡½É…¹¥é…Ñ¥½¹}¥°Á…åµ•¹Ñ}¥°¥¹Ù½¥•}¥°…µ½Õ¹Ð¤(€€€€€€€€Y1UL€ Ä°€È°€Ì°€Ð¤(€€€€€€€€=8=91%P<9=Q!%9€°(€€€€€€€m…ÉÌ¹½É…¹¥é…Ñ¥½¹%°Á…åµ•¹Ð¹¥°…ÉÌ¹¥¹Ù½¥•%°…µ½Õ¹ÑÁÁ±¥•‘t°(€€€€€€¤ì(€€€€€½¹ÍÐ…±±½…Ñ¥½¹%¹Í•ÉÐ€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€%9MIP%9Q<Ñ•¹…¹Ñ}É•‘¥Ñ}…±±½…Ñ¥½¹Ì(€€€€€€€€€€¡½É…¹¥é…Ñ¥½¹}¥°Ñ•¹…¹Ñ}É•‘¥Ñ}¥°¥¹Ù½¥•}¥°Á…åµ•¹Ñ}¥°…µ½Õ¹Ñ}…ÁÁ±¥•°ÕÉÉ•¹ä°É•…Ñ•‘}‰ä¤(€€€€€€€€Y1UL€ Ä°€È°€Ì°€Ð°€Ô°€UMœ°€Ø¤(€€€€€€€€=8=91%P€¡½É…¹¥é…Ñ¥½¹}¥°Ñ•¹…¹Ñ}É•‘¥Ñ}¥°¥¹Ù½¥•}¥¤(€€€€€€€€]!I‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€<9=Q!%9(€€€€€€€€IQUI9%9¥‘€°(€€€€€€€m…ÉÌ¹½É…¹¥é…Ñ¥½¹%°É•‘¥Ð¹¥°…ÉÌ¹¥¹Ù½¥•%°Á…åµ•¹Ð¹¥°…µ½Õ¹ÑÁÁ±¥•°…ÉÌ¹É•…Ñ•‘	ä€üü¹Õ±±t°(€€€€€€¤ì(€€€€€¥˜€¡…±±½…Ñ¥½¹%¹Í•ÉÐ¹É½ÝÍlÁt¤ì(€€€€€€€…Ý…¥ÐÑ¡¥Ì¹Ù•¹Ñ¥±…Ñ•…Í¡Q•¹…¹ÑÉ•‘¥Ñ±±½…Ñ¥½¹%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹Ð°ì(€€€€€€€€€½É…¹¥é…Ñ¥½¹%è…ÉÌ¹½É…¹¥é…Ñ¥½¹%°(€€€€€€€€€Ñ•¹…¹ÑÉ•‘¥Ñ%è9Õµ‰•È¡É•‘¥Ð¹¥¤°(€€€€€€€€€¥¹Ù½¥•%è…ÉÌ¹¥¹Ù½¥•%°(€€€€€€€€€…µ½Õ¹ÑÁÁ±¥•°(€€€€€€€€€É•…Ñ•‘	äè…ÉÌ¹É•…Ñ•‘	ä€üü¹Õ±°°(€€€€€€€ô¤ì(€€€€€ô((€€€€€½¹ÍÐÉ•µ…¥¹¥¹µ½Õ¹Ð€ô9Õµ‰•È ¡…Ù…¥±…‰±”€´…µ½Õ¹ÑÁÁ±¥•¤¹Ñ½¥á• È¤¤ì(€€€€€½¹ÍÐ¹•áÑMÑ…ÑÕÌ€ôÉ•µ…¥¹¥¹µ½Õ¹Ð€ðô€À€ü€UMœ€è€AIQ%11e}UMœì(€€€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€UAQÑ•¹…¹Ñ}É•‘¥ÑÌ(€€€€€€€€MPÉ•µ…¥¹¥¹}…µ½Õ¹Ð€ô€È°(€€€€€€€€€€€€ÍÑ…ÑÕÌ€ô€Ì°(€€€€€€€€€€€€ÕÁ‘…Ñ•‘}…Ð€ô9=\ ¤(€€€€€€€€]!I¥€ô€Ä9½É…¹¥é…Ñ¥½¹}¥€ô€Ñ€°(€€€€€€€mÉ•‘¥Ð¹¥°É•µ…¥¹¥¹µ½Õ¹Ð°¹•áÑMÑ…ÑÕÌ°…ÉÌ¹½É…¹¥é…Ñ¥½¹%‘t°(€€€€€€¤ì(€€€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€%9MIP%9Q<…Õ‘¥Ñ}±½Ì€¡½É…¹¥é…Ñ¥½¹}¥°ÕÍ•É}¥°…Ñ¥½¸°É•Í½ÕÉ”°É•Í½ÕÉ•}¥°µ•Ñ¡½°Á…Ñ °ÍÑ…ÑÕÍ}½‘”°µ•Ñ…‘…Ñ„¤(€€€€€€€€Y1UL€ Ä°€È°€Q99Q}I%Q}AA1%œ°€Ñ•¹…¹Ñ}É•‘¥ÑÌœ°€Ì°€A=MPœ°€Ð°€ÈÀÀ°€Ô¥€°(€€€€€€€l(€€€€€€€€€…ÉÌ¹½É…¹¥é…Ñ¥½¹%°(€€€€€€€€€…ÉÌ¹É•…Ñ•‘	ä€üü¹Õ±°°(€€€€€€€€€MÑÉ¥¹œ¡É•‘¥Ð¹¥¤°(€€€€€€€€€€½…Á¤½¥¹Ù½¥•Ì¼‘í…ÉÌ¹¥¹Ù½¥•%‘ô½Ñ•¹…¹ÐµÉ•‘¥Ðµ…±±½…Ñ¥½¹€°(€€€€€€€€€)M=8¹ÍÑÉ¥¹¥™ä¡ì(€€€€€€€€€€€¥¹Ù½¥•}¥è…ÉÌ¹¥¹Ù½¥•%°(€€€€€€€€€€€Á…åµ•¹Ñ}¥èÁ…åµ•¹Ð¹¥°(€€€€€€€€€€€Ñ•¹…¹Ñ}É•‘¥Ñ}…±±½…Ñ¥½¹}…µ½Õ¹Ðè…µ½Õ¹ÑÁÁ±¥•°(€€€€€€€€€€€¥¹Ù½¥•}¹Õµ‰•Èè¥¹Ù½¥”¹¥¹Ù½¥•}¹Õµ‰•È°(€€€€€€€€€ô¤°(€€€€€€€t°(€€€€€€¤ì((€€€€€…±±½…Ñ¥½¹Ì¹ÁÕÍ ¡ì(€€€€€€€Ñ•¹…¹Ñ}É•‘¥Ñ}¥èÉ•‘¥Ð¹¥°(€€€€€€€Á…åµ•¹Ñ}¥èÁ…åµ•¹Ð¹¥°(€€€€€€€¥¹Ù½¥•}¥è…ÉÌ¹¥¹Ù½¥•%°(€€€€€€€…µ½Õ¹Ñ}…ÁÁ±¥•è…µ½Õ¹ÑÁÁ±¥•°(€€€€€€€ÕÉÉ•¹äè€UMœ°(€€€€€ô¤ì(€€€€€É•µ…¥¹¥¹Q½ÁÁ±ä€ô9Õµ‰•È ¡É•µ…¥¹¥¹Q½ÁÁ±ä€´…µ½Õ¹ÑÁÁ±¥•¤¹Ñ½¥á• È¤¤ì(€€€ô((€€€…Ý…¥ÐÑ¡¥Ì¹É•™É•Í¡%¹Ù½¥•MÑ…ÑÕÍ%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹Ð°…ÉÌ¹½É…¹¥é…Ñ¥½¹%°…ÉÌ¹¥¹Ù½¥•%¤ì(€€€É•ÑÕÉ¸ì(€€€€€…ÁÁ±¥•‘}Ñ½Ñ…°è…±±½…Ñ¥½¹Ì¹É•‘Õ” ¡ÍÕ´°…±±½…Ñ¥½¸¤€ôøÍÕ´€¬9Õµ‰•È¡…±±½…Ñ¥½¸¹…µ½Õ¹Ñ}…ÁÁ±¥•€üü€À¤°€À¤°(€€€€€…±±½…Ñ¥½¹Ì°(€€€ôì(€ô((€…Íå¹ŒÕÁ‘…Ñ•Q•¹…¹ÑÉ•‘¥Ð¡¥è¹Õµ‰•È°‰½‘äèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø¤ì(€€€…Ý…¥ÐÑ¡¥Ì¹•¹ÍÕÉ•Q•¹…¹ÑÉ•‘¥ÑI•™Õ¹‘M¡•µ„ ¤ì(€€€¥˜€ …Ñ¡¥Ì¹¡…ÍA•Éµ¥ÍÍ¥½¸ Ñ•¹…¹Ñ}É•‘¥ÑÌ¹ÕÁ‘…Ñ”œ¤¤ì(€€€€€Ñ¡É½Ü¹•Ü½É‰¥‘‘•¹á•ÁÑ¥½¸ A•Éµ¥ÍÍ¥½¸‘”½ÉÉ•Ñ¥½¸‘”Ë¥‘¥Ð±½…Ñ…¥É”É•ÅÕ¥Í”¸œ¤ì(€€€ô(€€€½¹ÍÐÕÁ‘…Ñ•‘%€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÑÉ…¹Í…Ñ¥½¸¡…Íå¹Œ€¡±¥•¹Ð¤€ôøì(€€€€€É•ÑÕÉ¸Ñ¡¥Ì¹ÕÁ‘…Ñ•Q•¹…¹ÑÉ•‘¥Ñ%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹Ð°¥°‰½‘ä¤ì(€€€ô¤ì(€€€É•ÑÕÉ¸Ñ¡¥Ì¹Ñ•¹…¹ÑÉ•‘¥Ñ•Ñ…¥°¡ÕÁ‘…Ñ•‘%¤ì(€ô((€…Íå¹ŒÉ•™Õ¹‘Q•¹…¹ÑÉ•‘¥Ð¡¥è¹Õµ‰•È°‰½‘äèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø¤ì(€€€…Ý…¥ÐÑ¡¥Ì¹•¹ÍÕÉ•Q•¹…¹ÑÉ•‘¥ÑI•™Õ¹‘M¡•µ„ ¤ì(€€€¥˜€ …Ñ¡¥Ì¹¡…ÍA•Éµ¥ÍÍ¥½¸ Ñ•¹…¹Ñ}É•‘¥ÑÌ¹É•™Õ¹œ¤¤ì(€€€€€Ñ¡É½Ü¹•Ü½É‰¥‘‘•¹á•ÁÑ¥½¸ A•Éµ¥ÍÍ¥½¸‘”É•µ‰½ÕÉÍ•µ•¹Ð‘”Ë¥‘¥Ð±½…Ñ…¥É”É•ÅÕ¥Í”¸œ¤ì(€€€ô(€€€É•ÑÕÉ¸Ñ¡¥Ì¹‘ˆ¹ÑÉ…¹Í…Ñ¥½¸¡…Íå¹Œ€¡±¥•¹Ð¤€ôøì(€€€€€É•ÑÕÉ¸Ñ¡¥Ì¹É•™Õ¹‘Q•¹…¹ÑÉ•‘¥Ñ%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹Ð°¥°‰½‘ä°™…±Í”¤ì(€€€ô¤ì(€ô((€…Íå¹Œ…¹•±Q•¹…¹ÑÉ•‘¥Ð¡¥è¹Õµ‰•È°‰½‘äèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø¤ì(€€€…Ý…¥ÐÑ¡¥Ì¹•¹ÍÕÉ•Q•¹…¹ÑÉ•‘¥ÑI•™Õ¹‘M¡•µ„ ¤ì(€€€¥˜€ …Ñ¡¥Ì¹¡…ÍA•Éµ¥ÍÍ¥½¸ Ñ•¹…¹Ñ}É•‘¥ÑÌ¹…¹•°œ¤¤ì(€€€€€Ñ¡É½Ü¹•Ü½É‰¥‘‘•¹á•ÁÑ¥½¸ A•Éµ¥ÍÍ¥½¸…¹¹Õ±…Ñ¥½¸‘”Ë¥‘¥Ð±½…Ñ…¥É”É•ÅÕ¥Í”¸œ¤ì(€€€ô(€€€É•ÑÕÉ¸Ñ¡¥Ì¹‘ˆ¹ÑÉ…¹Í…Ñ¥½¸¡…Íå¹Œ€¡±¥•¹Ð¤€ôøì(€€€€€É•ÑÕÉ¸Ñ¡¥Ì¹É•™Õ¹‘Q•¹…¹ÑÉ•‘¥Ñ%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹Ð°¥°‰½‘ä°ÑÉÕ”¤ì(€€€ô¤ì(€ô((€…Íå¹Œ±•…Í•Q•¹…¹ÑÉ•‘¥ÑMÕµµ…Éä¡±•…Í•%è¹Õµ‰•È¤ì(€€€¥˜€ „¡…Ý…¥ÐÑ¡¥Ì¹Ñ…‰±•á¥ÍÑÌ Ñ•¹…¹Ñ}É•‘¥ÑÌœ¤¤¤É•ÑÕÉ¸ìÑ½Ñ…±}ÕÍè€À°Ñ½Ñ…±}‘˜è€À°É•‘¥ÑÌèmtôì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1PÑŒ¹¥°ÑŒ¹ÕÉÉ•¹ä°ÑŒ¹É•µ…¥¹¥¹}…µ½Õ¹Ð°ÑŒ¹½É¥¥¹…±}…µ½Õ¹Ð°ÑŒ¹ÍÑ…ÑÕÌ°ÑŒ¹Á…åµ•¹Ñ}‘…Ñ”°(€€€€€€€€€€€€€ÑŒ¹Í½ÕÉ•}Á…åµ•¹Ñ}¥°À¹É••¥ÁÑ}¹Õµ‰•È(€€€€€€I=4Ñ•¹…¹Ñ}É•‘¥ÑÌÑŒ(€€€€€€)=%8Á…åµ•¹ÑÌÀ=8À¹¥€ôÑŒ¹Í½ÕÉ•}Á…åµ•¹Ñ}¥9À¹½É…¹¥é…Ñ¥½¹}¥€ôÑŒ¹½É…¹¥é…Ñ¥½¹}¥9À¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€]!IÑŒ¹±•…Í•}¥€ô€Ä(€€€€€€€€9ÑŒ¹½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€9ÑŒ¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€=IH	dÑŒ¹Á…åµ•¹Ñ}‘…Ñ”M°ÑŒ¹¥M€°(€€€€€m±•…Í•%°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€½¹ÍÐ…Ù…¥±…‰±•É•‘¥ÑÌ€ôÉ½ÝÌ¹™¥±Ñ•È ¡É½Ü¤€ôølY%1	1œ°€AIQ%11e}UMt¹¥¹±Õ‘•Ì¡MÑÉ¥¹œ¡É½Ü¹ÍÑ…ÑÕÌ€üü€œœ¤¹Ñ½UÁÁ•É…Í” ¤¤€˜˜9Õµ‰•È¡É½Ü¹É•µ…¥¹¥¹}…µ½Õ¹Ð€üü€À¤€ø€À¤ì(€€€É•ÑÕÉ¸ì(€€€€€Ñ½Ñ…±}ÕÍè…Ù…¥±…‰±•É•‘¥ÑÌ¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹ÕÉÉ•¹ä€ôôô€UMœ¤¹É•‘Õ” ¡ÍÕ´°É½Ü¤€ôøÍÕ´€¬9Õµ‰•È¡É½Ü¹É•µ…¥¹¥¹}…µ½Õ¹Ð€üü€À¤°€À¤°(€€€€€Ñ½Ñ…±}‘˜è…Ù…¥±…‰±•É•‘¥ÑÌ¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹ÕÉÉ•¹ä€ôôô€œ¤¹É•‘Õ” ¡ÍÕ´°É½Ü¤€ôøÍÕ´€¬9Õµ‰•È¡É½Ü¹É•µ…¥¹¥¹}…µ½Õ¹Ð€üü€À¤°€À¤°(€€€€€ÕÍ•‘}ÕÍèÉ½ÝÌ¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹ÕÉÉ•¹ä€ôôô€UMœ¤¹É•‘Õ” ¡ÍÕ´°É½Ü¤€ôøÍÕ´€¬9Õµ‰•È ¡É½Ü¹½É¥¥¹…±}…µ½Õ¹Ð€üü€À¤€´€¡É½Ü¹É•µ…¥¹¥¹}…µ½Õ¹Ð€üü€À¤¤°€À¤°(€€€€€ÕÍ•‘}‘˜èÉ½ÝÌ¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹ÕÉÉ•¹ä€ôôô€œ¤¹É•‘Õ” ¡ÍÕ´°É½Ü¤€ôøÍÕ´€¬9Õµ‰•È ¡É½Ü¹½É¥¥¹…±}…µ½Õ¹Ð€üü€À¤€´€¡É½Ü¹É•µ…¥¹¥¹}…µ½Õ¹Ð€üü€À¤¤°€À¤°(€€€€€¡¥ÍÑ½Éå}½Õ¹ÐèÉ½ÝÌ¹±•¹Ñ °(€€€€€É•‘¥ÑÌè…Ù…¥±…‰±•É•‘¥ÑÌ°(€€€ôì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ•¹ÍÕÉ•Q•¹…¹ÑÉ•‘¥ÑM¡•µ„ ¤ì(€€€¥˜€ „¡…Ý…¥ÐÑ¡¥Ì¹Ñ…‰±•á¥ÍÑÌ Ñ•¹…¹Ñ}É•‘¥ÑÌœ¤¤¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1”µ½‘Õ±”‘•ÌË¥‘¥ÑÌ±½…Ñ…¥É•Ì»Še•ÍÐÁ…Ì•¹½É”½¹™¥ÕË¤¸œ¤ì(€€€ô(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ•¹ÍÕÉ•Q•¹…¹ÑÉ•‘¥ÑI•™Õ¹‘M¡•µ„ ¤ì(€€€…Ý…¥ÐÑ¡¥Ì¹•¹ÍÕÉ•Q•¹…¹ÑÉ•‘¥ÑM¡•µ„ ¤ì(€€€¥˜€ „¡…Ý…¥ÐÑ¡¥Ì¹Ñ…‰±•á¥ÍÑÌ Ñ•¹…¹Ñ}É•‘¥Ñ}É•™Õ¹‘Ìœ¤¤¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1”µ½‘Õ±”‘”É•µ‰½ÕÉÍ•µ•¹Ð‘•ÌË¥‘¥ÑÌ±½…Ñ…¥É•Ì¸•ÍÐÁ…Ì•¹½É”½¹™¥ÕË¤¸œ¤ì(€€€ô(€ô((€ÁÉ¥Ù…Ñ”¡…ÍA•Éµ¥ÍÍ¥½¸¡Á•Éµ¥ÍÍ¥½¸èÍÑÉ¥¹œ¤ì(€€€½¹ÍÐÁ•Éµ¥ÍÍ¥½¹Ì€ôÑ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•È ¤ü¹Á•Éµ¥ÍÍ¥½¹Ì€üümtì(€€€É•ÑÕÉ¸Á•Éµ¥ÍÍ¥½¹Ì¹¥¹±Õ‘•Ì œ¨œ¤ñðÁ•Éµ¥ÍÍ¥½¹Ì¹¥¹±Õ‘•Ì¡Á•Éµ¥ÍÍ¥½¸¤ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÍ½™Ñ•±•Ñ•¥¹…¹•I½ÝÌ (€€€±¥•¹ÐèA½½±±¥•¹Ð°(€€€Ñ…‰±•9…µ”è€Á…åµ•¹ÑÌœð€Á…åµ•¹Ñ}…±±½…Ñ¥½¹Ìœð€…Í¡}µ½Ù•µ•¹ÑÌœð€Õ…É…¹Ñ••}…Í¡}µ½Ù•µ•¹ÑÌœð€Íå¹‘¥}…Í¡}µ½Ù•µ•¹ÑÌœð€µ…¥¹Ñ•¹…¹•}•áÁ•¹Í•Ìœ°(€€€­•å½±Õµ¸è€¥œð€Á…åµ•¹Ñ}¥œ°(€€€Ù…±Õ”è¹Õµ‰•È°(€€€É•…Í½¸èÍÑÉ¥¹œ°(€€¤ì(€€€½¹ÍÐÍÕÁÁ½ÉÑÍ•±•Ñ¥½¹I•…Í½¸€ô…Ý…¥ÐÑ¡¥Ì¹½±Õµ¹á¥ÍÑÌ¡Ñ…‰±•9…µ”°€‘•±•Ñ¥½¹}É•…Í½¸œ¤ì(€€€½¹ÍÐ…ÍÍ¥¹µ•¹ÑÌ€ôl‘•±•Ñ•‘}…Ð€ô9=\ ¤œ°€‘•±•Ñ•‘}‰ä€ô€Ètì(€€€½¹ÍÐÁ…É…µÌèÕ¹­¹½Ý¹mt€ômÙ…±Õ”°Ñ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•É% ¤€üü¹Õ±°°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥tì(€€€¥˜€¡ÍÕÁÁ½ÉÑÍ•±•Ñ¥½¹I•…Í½¸¤ì(€€€€€Á…É…µÌ¹ÍÁ±¥” È°€À°É•…Í½¸¤ì(€€€€€…ÍÍ¥¹µ•¹ÑÌ¹ÁÕÍ  ‘•±•Ñ¥½¹}É•…Í½¸€ô€Ìœ¤ì(€€€ô(€€€½¹ÍÐ½É…¹¥é…Ñ¥½¹A…É…´€ôÍÕÁÁ½ÉÑÍ•±•Ñ¥½¹I•…Í½¸€ü€Ð€è€Ìì(€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€UAQ€‘íÑ…‰±•9…µ•ô(€€€€€€MP€‘í…ÍÍ¥¹µ•¹ÑÌ¹©½¥¸ œ°€œ¥ô(€€€€€€]!I€‘í­•å½±Õµ¹ô€ô€Ä(€€€€€€€€9½É…¹¥é…Ñ¥½¹}¥€ô€‘í½É…¹¥é…Ñ¥½¹A…É…µô(€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U11€°(€€€€€Á…É…µÌ°(€€€€¤ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÑÉ…Í¡A…åµ•¹Ñ%¹QÉ…¹Í…Ñ¥½¸ (€€€±¥•¹ÐèA½½±±¥•¹Ð°(€€€Á…åµ•¹Ñ%è¹Õµ‰•È°(€€€É•…Í½¸èÍÑÉ¥¹œ°(€€€½ÁÑ¥½¹Ìüèì(€€€€€…Õ‘¥ÑÑ¥½¸üèÍÑÉ¥¹œì(€€€€€…Õ‘¥ÑI•Í½ÕÉ”üèÍÑÉ¥¹œì(€€€€€…Õ‘¥ÑI•Í½ÕÉ•%üèÍÑÉ¥¹œì(€€€€€Í½ÕÉ•5½Ù•µ•¹Ñ%üè¹Õµ‰•Èð¹Õ±°ì(€€€ô°(€€¤ì(€€€½¹ÍÐÁ…åµ•¹ÑI•ÍÕ±Ð€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P¥°Á…åµ•¹Ñ}ÑåÁ”°±•…Í•}Õ…É…¹Ñ••}¥°‘•±•Ñ•‘}…Ð°¥¹Ù½¥•}¥(€€€€€€I=4Á…åµ•¹ÑÌ(€€€€€€]!I¥€ô€Ä(€€€€€€€€9½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€=HUAQ€°(€€€€€mÁ…åµ•¹Ñ%°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€½¹ÍÐÁ…åµ•¹Ð€ôÉ•ÅÕ¥É•I½Ü¡Á…åµ•¹ÑI•ÍÕ±Ð¹É½ÝÍlÁt°€A…åµ•¹Ðœ¤…ÌI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸øì(€€€¥˜€¡Á…åµ•¹Ð¹‘•±•Ñ•‘}…Ð¤ì(€€€€€Ñ¡É½Ü¹•Ü½¹™±¥Ñá•ÁÑ¥½¸ ”Á…¥•µ•¹Ð•ÍÐ“¥«€‘…¹Ì±„½É‰•¥±±”¸œ¤ì(€€€ô((€€€½¹ÍÐ…±±½…Ñ¥½¹Ì€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P¥¹Ù½¥•}¥(€€€€€€I=4Á…åµ•¹Ñ}…±±½…Ñ¥½¹Ì(€€€€€€]!IÁ…åµ•¹Ñ}¥€ô€Ä(€€€€€€€€9½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U10(€€€€€€=HUAQ€°(€€€€€mÁ…åµ•¹Ñ%°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì((€€€…Ý…¥ÐÑ¡¥Ì¹Í½™Ñ•±•Ñ•¥¹…¹•I½ÝÌ¡±¥•¹Ð°€…Í¡}µ½Ù•µ•¹ÑÌœ°€Á…åµ•¹Ñ}¥œ°Á…åµ•¹Ñ%°É•…Í½¸¤ì(€€€…Ý…¥ÐÑ¡¥Ì¹Í½™Ñ•±•Ñ•¥¹…¹•I½ÝÌ¡±¥•¹Ð°€Õ…É…¹Ñ••}…Í¡}µ½Ù•µ•¹ÑÌœ°€Á…åµ•¹Ñ}¥œ°Á…åµ•¹Ñ%°É•…Í½¸¤ì(€€€¥˜€¡…Ý…¥ÐÑ¡¥Ì¹Ñ…‰±•á¥ÍÑÌ Íå¹‘¥}…Í¡}µ½Ù•µ•¹ÑÌœ¤¤ì(€€€€€…Ý…¥ÐÑ¡¥Ì¹Í½™Ñ•±•Ñ•¥¹…¹•I½ÝÌ¡±¥•¹Ð°€Íå¹‘¥}…Í¡}µ½Ù•µ•¹ÑÌœ°€Á…åµ•¹Ñ}¥œ°Á…åµ•¹Ñ%°É•…Í½¸¤ì(€€€ô(€€€…Ý…¥ÐÑ¡¥Ì¹Í½™Ñ•±•Ñ•¥¹…¹•I½ÝÌ¡±¥•¹Ð°€Á…åµ•¹Ñ}…±±½…Ñ¥½¹Ìœ°€Á…åµ•¹Ñ}¥œ°Á…åµ•¹Ñ%°É•…Í½¸¤ì(€€€…Ý…¥ÐÑ¡¥Ì¹Í½™Ñ•±•Ñ•¥¹…¹•I½ÝÌ¡±¥•¹Ð°€Á…åµ•¹ÑÌœ°€¥œ°Á…åµ•¹Ñ%°É•…Í½¸¤ì((€€€½¹ÍÐ¥¹Ù½¥•%‘Ì€ôÉÉ…ä¹™É½´ (€€€€€¹•ÜM•Ð (€€€€€€€l(€€€€€€€€€9Õµ‰•È¡Á…åµ•¹Ð¹¥¹Ù½¥•}¥€üü€À¤°(€€€€€€€€€€¸¸¹…±±½…Ñ¥½¹Ì¹É½ÝÌ¹µ…À ¡É½Ü¤€ôø9Õµ‰•È¡É½Ü¹¥¹Ù½¥•}¥€üü€À¤¤°(€€€€€€€t¹™¥±Ñ•È ¡¥¹Ù½¥•%¤€ôø¥¹Ù½¥•%€ø€À¤°(€€€€€€¤°(€€€€¤ì((€€€™½È€¡½¹ÍÐ¥¹Ù½¥•%½˜¥¹Ù½¥•%‘Ì¤ì(€€€€€…Ý…¥ÐÑ¡¥Ì¹É•™É•Í¡%¹Ù½¥•MÑ…ÑÕÍ%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹Ð°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°¥¹Ù½¥•%¤ì(€€€ô((€€€¥˜€¡MÑÉ¥¹œ¡Á…åµ•¹Ð¹Á…åµ•¹Ñ}ÑåÁ”€üü€œœ¤¹Ñ½UÁÁ•É…Í” ¤€ôôô€UI9Qœ€˜˜Á…åµ•¹Ð¹±•…Í•}Õ…É…¹Ñ••}¥¤ì(€€€€€…Ý…¥ÐÑ¡¥Ì¹É•…±Õ±…Ñ•1•…Í•Õ…É…¹Ñ••É½µÑ¥Ù•I½ÝÌ¡±¥•¹Ð°9Õµ‰•È¡Á…åµ•¹Ð¹±•…Í•}Õ…É…¹Ñ••}¥¤¤ì(€€€ô((€€€…Ý…¥ÐÑ¡¥Ì¹ÝÉ¥Ñ•¥¹…¹•QÉ…Í¡Õ‘¥Ð (€€€€€±¥•¹Ð°(€€€€€½ÁÑ¥½¹Ìü¹…Õ‘¥ÑÑ¥½¸€üü€Ae59Q}5=Y}Q=}QIM œ°(€€€€€½ÁÑ¥½¹Ìü¹…Õ‘¥ÑI•Í½ÕÉ”€üü€Á…åµ•¹ÑÌœ°(€€€€€½ÁÑ¥½¹Ìü¹…Õ‘¥ÑI•Í½ÕÉ•%€üüMÑÉ¥¹œ¡Á…åµ•¹Ñ%¤°(€€€€€ì(€€€€€€€É•…Í½¸°(€€€€€€€Á…åµ•¹Ñ}¥èÁ…åµ•¹Ñ%°(€€€€€€€Á…åµ•¹Ñ}ÑåÁ”èÁ…åµ•¹Ð¹Á…åµ•¹Ñ}ÑåÁ”€üü€%9Y=%œ°(€€€€€€€¥¹Ù½¥•}¥‘Ìè¥¹Ù½¥•%‘Ì°(€€€€€€€±•…Í•}Õ…É…¹Ñ••}¥è9Õµ‰•È¡Á…åµ•¹Ð¹±•…Í•}Õ…É…¹Ñ••}¥€üü€À¤ñð¹Õ±°°(€€€€€€€Í½ÕÉ•}µ½Ù•µ•¹Ñ}¥è½ÁÑ¥½¹Ìü¹Í½ÕÉ•5½Ù•µ•¹Ñ%€üü¹Õ±°°(€€€€€ô°(€€€€¤ì((€€€É•ÑÕÉ¸ì(€€€€€‘•±•Ñ•èÑÉÕ”°(€€€€€Á…åµ•¹Ñ}¥èÁ…åµ•¹Ñ%°(€€€€€Á…åµ•¹Ñ}ÑåÁ”èMÑÉ¥¹œ¡Á…åµ•¹Ð¹Á…åµ•¹Ñ}ÑåÁ”€üü€%9Y=%œ¤°(€€€€€¥¹Ù½¥•}¥‘Ìè¥¹Ù½¥•%‘Ì°(€€€€€±•…Í•}Õ…É…¹Ñ••}¥è9Õµ‰•È¡Á…åµ•¹Ð¹±•…Í•}Õ…É…¹Ñ••}¥€üü€À¤ñð¹Õ±°°(€€€ôì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÉ•…±Õ±…Ñ•1•…Í•Õ…É…¹Ñ••É½µÑ¥Ù•I½ÝÌ¡±¥•¹ÐèA½½±±¥•¹Ð°±•…Í•Õ…É…¹Ñ••%è¹Õµ‰•È¤ì(€€€½¹ÍÐÕ…É…¹Ñ••I•ÍÕ±Ð€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P¥°±•…Í•}¥°…µ½Õ¹Ð°Á…åµ•¹Ñ}‘…Ñ”(€€€€€€I=4±•…Í•}Õ…É…¹Ñ••Ì(€€€€€€]!I¥€ô€Ä(€€€€€€€€9½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U10(€€€€€€=HUAQ€°(€€€€€m±•…Í•Õ…É…¹Ñ••%°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€½¹ÍÐÕ…É…¹Ñ•”€ôÉ•ÅÕ¥É•I½Ü¡Õ…É…¹Ñ••I•ÍÕ±Ð¹É½ÝÍlÁt°€1•…Í”Õ…É…¹Ñ•”œ¤…ÌI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸øì(€€€½¹ÍÐÉ••¥ÁÑÌ€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P=1M¡MU4¡Ñ½Ñ…±}•ÅÕ¥Ù…±•¹Ñ}ÕÍ¤°€À¤èé9U5I% ÄÈ°È¤LÑ½Ñ…°(€€€€€€I=4Á…åµ•¹ÑÌ(€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€9±•…Í•}Õ…É…¹Ñ••}¥€ô€È(€€€€€€€€9Á…åµ•¹Ñ}ÑåÁ”€ô€UI9Qœ(€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U11€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°±•…Í•Õ…É…¹Ñ••%‘t°(€€€€¤ì(€€€½¹ÍÐÉ•™Õ¹‘Ì€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P=1M¡MU4¡=1M¡•ÅÕ¥Ù…±•¹Ñ}ÕÍ°…µ½Õ¹Ð¤¤°€À¤èé9U5I% ÄÈ°È¤LÑ½Ñ…°(€€€€€€I=4Õ…É…¹Ñ••}…Í¡}µ½Ù•µ•¹ÑÌ(€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€9±•…Í•}Õ…É…¹Ñ••}¥€ô€È(€€€€€€€€9µ½Ù•µ•¹Ñ}ÑåÁ”€ô€I9Qe}IU9œ(€€€€€€€€9ÑåÁ”€ô€=UPœ(€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U11€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°±•…Í•Õ…É…¹Ñ••%‘t°(€€€€¤ì(€€€½¹ÍÐ…µ½Õ¹Ð€ô9Õµ‰•È¡Õ…É…¹Ñ•”¹…µ½Õ¹Ð€üü€À¤ì(€€€½¹ÍÐÁ…¥‘µ½Õ¹Ð€ô5…Ñ ¹µ…à¡9Õµ‰•È¡É••¥ÁÑÌ¹É½ÝÍlÁtü¹Ñ½Ñ…°€üü€À¤€´9Õµ‰•È¡É•™Õ¹‘Ì¹É½ÝÍlÁtü¹Ñ½Ñ…°€üü€À¤°€À¤ì(€€€½¹ÍÐÍÑ…ÑÕÌ€ôÁ…¥‘µ½Õ¹Ð€øô…µ½Õ¹Ð€˜˜…µ½Õ¹Ð€ø€À(€€€€€€ü€A%œ(€€€€€€èÁ…¥‘µ½Õ¹Ð€ø€À(€€€€€€€€ü€AIQ%0œ(€€€€€€€€è€9=Q}A%œì(€€€…Ý…¥ÐÑ¡¥Ì¹ÕÁÍ•ÉÑ1•…Í•Õ…É…¹Ñ•”¡±¥•¹Ð°9Õµ‰•È¡Õ…É…¹Ñ•”¹±•…Í•}¥¤°ì(€€€€€…µ½Õ¹Ð°(€€€€€Á…¥‘}…µ½Õ¹ÐèÁ…¥‘µ½Õ¹Ð°(€€€€€Á…åµ•¹Ñ}‘…Ñ”èÁ…¥‘µ½Õ¹Ð€ø€À€ü€¡Õ…É…¹Ñ•”¹Á…åµ•¹Ñ}‘…Ñ”€üü¹Õ±°¤€è¹Õ±°°(€€€€€ÍÑ…ÑÕÌ°(€€€ô¤ì(€ô((€…Íå¹ŒÑÉ…Í¡•‘M¡…É•¡½±‘•ÉA…å½ÕÑ1¥¹•Ì ¤ì(€€€…Ý…¥ÐÑ¡¥Ì¹•¹ÍÕÉ•M¡…É•¡½±‘•ÉM¡•µ„ ¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1PÍÁ°¹¥°(€€€€€€€€€€€€€ÍÁ°¹‰…Ñ¡}¥°(€€€€€€€€€€€€€ÍÁ°¹Í¡…É•¡½±‘•É}¥°(€€€€€€€€€€€€€ÍÁ°¹…µ½Õ¹Ð°(€€€€€€€€€€€€€ÍÁ°¹ÕÉÉ•¹ä°(€€€€€€€€€€€€€ÍÁ°¹Á…åµ•¹Ñ}µ•Ñ¡½°(€€€€€€€€€€€€€ÍÁ°¹É•™•É•¹”°(€€€€€€€€€€€€€ÍÁ°¹É••¥ÁÑ}¹Õµ‰•È°(€€€€€€€€€€€€€ÍÁ°¹…Í¡}µ½Ù•µ•¹Ñ}¥°(€€€€€€€€€€€€€ÍÁ°¹Õ…É…¹Ñ••}…Í¡}µ½Ù•µ•¹Ñ}¥°(€€€€€€€€€€€€€ÍÁ°¹‘•±•Ñ•‘}…Ð°(€€€€€€€€€€€€€ÍÁ°¹‘•±•Ñ¥½¹}É•…Í½¸°(€€€€€€€€€€€€€=1M¡9U11%¡QI%4¡=9P¡=1M¡Ô¹™¥ÉÍÑ}¹…µ”°€œœ¤°€œ€œ°=1M¡Ô¹±…ÍÑ}¹…µ”°€œœ¤¤¤°€œœ¤°Ô¹•µ…¥°¤L‘•±•Ñ•‘}‰å}¹…µ”°(€€€€€€€€€€€€€ÍÁˆ¹É•™•É•¹”L‰…Ñ¡}É•™•É•¹”°(€€€€€€€€€€€€€ÍÁˆ¹Í½ÕÉ•}É•¥ÍÑ•È°(€€€€€€€€€€€€€Í ¹‘¥ÍÁ±…å}¹…µ”LÍ¡…É•¡½±‘•É}¹…µ”(€€€€€€I=4Í¡…É•¡½±‘•É}Á…å½ÕÑ}±¥¹•ÌÍÁ°(€€€€€€)=%8Í¡…É•¡½±‘•É}Á…å½ÕÑ}‰…Ñ¡•ÌÍÁˆ=8ÍÁˆ¹¥€ôÍÁ°¹‰…Ñ¡}¥9ÍÁˆ¹½É…¹¥é…Ñ¥½¹}¥€ôÍÁ°¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€)=%8Í¡…É•¡½±‘•ÉÌÍ =8Í ¹¥€ôÍÁ°¹Í¡…É•¡½±‘•É}¥9Í ¹½É…¹¥é…Ñ¥½¹}¥€ôÍÁ°¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€1P)=%8…ÁÁ}ÕÍ•ÉÌÔ=8Ô¹¥€ôÍÁ°¹‘•±•Ñ•‘}‰ä(€€€€€€]!IÍÁ°¹½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€9ÍÁ°¹‘•±•Ñ•‘}…Ð%L9=P9U10(€€€€€€=IH	dÍÁ°¹‘•±•Ñ•‘}…ÐM°ÍÁ°¹¥M€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€É•ÑÕÉ¸É½ÝÌì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÑÉ…Í¡M¡…É•¡½±‘•ÉA…å½ÕÑ%¹QÉ…¹Í…Ñ¥½¸ (€€€±¥•¹ÐèA½½±±¥•¹Ð°(€€€Á…å½ÕÑ1¥¹•%è¹Õµ‰•È°(€€€É•…Í½¸èÍÑÉ¥¹œ°(€€€½ÁÑ¥½¹Ìüèì(€€€€€…Õ‘¥ÑÑ¥½¸üèÍÑÉ¥¹œì(€€€€€…Õ‘¥ÑI•Í½ÕÉ”üèÍÑÉ¥¹œì(€€€€€…Õ‘¥ÑI•Í½ÕÉ•%üèÍÑÉ¥¹œì(€€€€€Í½ÕÉ•5½Ù•µ•¹Ñ%üè¹Õµ‰•Èð¹Õ±°ì(€€€ô°(€€¤ì(€€€½¹ÍÐÑÉ…”€ô€¡ÍÑ•ÀèÍÑÉ¥¹œ°ÍÑ…ÑÕÌè€MQIPœð€=,œð€%0œ°•áÑÉ„€ô€œœ¤€ôøì(€€€€€Ñ¡¥Ì¹±½•È¹±½œ (€€€€€€€Í¡…É•¡½±‘•ÈÁ…å½ÕÐÑÉ…Í €‘íÍÑ•Áô€‘íÍÑ…ÑÕÍôðÁ…å½ÕÑ1¥¹•%ô‘íÁ…å½ÕÑ1¥¹•%‘ô½É…¹¥é…Ñ¥½¹%ô‘íÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥ôÍ½ÕÉ•5½Ù•µ•¹Ñ%ô‘í½ÁÑ¥½¹Ìü¹Í½ÕÉ•5½Ù•µ•¹Ñ%€üü¹Õ±±ô‘í•áÑÉ„€ü€€‘í•áÑÉ…õ€€è€œõ€°(€€€€€€¤ì(€€€ôì(€€€½¹ÍÐ±½AÉÉ½È€ô€¡•ÉÉ½ÈèÕ¹­¹½Ý¸¤€ôøì(€€€€€½¹ÍÐÁÉÉ½È€ô•ÉÉ½È…Ìì(€€€€€€€½‘”üèÍÑÉ¥¹œì(€€€€€€€‘•Ñ…¥°üèÍÑÉ¥¹œì(€€€€€€€½¹ÍÑÉ…¥¹ÐüèÍÑÉ¥¹œì(€€€€€€€Ñ…‰±”üèÍÑÉ¥¹œì(€€€€€€€½±Õµ¸üèÍÑÉ¥¹œì(€€€€€ôì(€€€€€Ñ¡¥Ì¹±½•È¹•ÉÉ½È (€€€€€€€Í¡…É•¡½±‘•ÈÁ…å½ÕÐÑÉ…Í •ÉÉ½ÈðÁ…å½ÕÑ1¥¹•%ô‘íÁ…å½ÕÑ1¥¹•%‘ô½É…¹¥é…Ñ¥½¹%ô‘íÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥ôµ•ÍÍ…”ô‘í•ÉÉ½È¥¹ÍÑ…¹•½˜ÉÉ½È€ü•ÉÉ½È¹µ•ÍÍ…”€èMÑÉ¥¹œ¡•ÉÉ½È¥ôÁ½‘”ô‘íÁÉÉ½Èü¹½‘”€üü¹Õ±±ôÁ•Ñ…¥°ô‘íÁÉÉ½Èü¹‘•Ñ…¥°€üü¹Õ±±ôÁ½¹ÍÑÉ…¥¹Ðô‘íÁÉÉ½Èü¹½¹ÍÑÉ…¥¹Ð€üü¹Õ±±ôÁQ…‰±”ô‘íÁÉÉ½Èü¹Ñ…‰±”€üü¹Õ±±ôÁ½±Õµ¸ô‘íÁÉÉ½Èü¹½±Õµ¸€üü¹Õ±±õ€°(€€€€€€€•ÉÉ½È¥¹ÍÑ…¹•½˜ÉÉ½È€ü•ÉÉ½È¹ÍÑ…¬€èÕ¹‘•™¥¹•°(€€€€€€¤ì(€€€ôì((€€€±•Ð±¥¹”èI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸øì(€€€±•Ð…Í¡5½Ù•µ•¹Ñ%è¹Õµ‰•Èð¹Õ±°€ô¹Õ±°ì(€€€±•ÐÕ…É…¹Ñ••…Í¡5½Ù•µ•¹Ñ%è¹Õµ‰•Èð¹Õ±°€ô¹Õ±°ì(€€€±•ÐÉ•µ…¥¹¥¹1¥¹•½Õ¹Ð€ô€Àì(€€€±•ÐÉ•µ…¥¹¥¹Q½Ñ…±µ½Õ¹Ð€ô€Àì(€€€±•Ð¹•áÑ	…Ñ¡MÑ…ÑÕÌè€Y1%Qœð€911œ€ô€Y1%Qœì(€€€±•ÐÍ¡…É•¡½±‘•ÉQ½Ñ…±ÌèìÉ½ÝÌèÉÉ…äñìÑ½Ñ…±}ÕÍüè¹Õµ‰•ÈìÑ½Ñ…±}‘˜üè¹Õµ‰•ÈìÁ…å½ÕÑ}½Õ¹Ðüè¹Õµ‰•Èôøô€ôìÉ½ÝÌèmtôì((€€€ÑÉäì(€€€€€ÑÉ…” •¹ÑÉäœ°€MQIPœ¤ì(€€€€€ÑÉ…” Á…å½ÕÐ±¥¹”É•…œ°€MQIPœ¤ì(€€€€€½¹ÍÐ±¥¹•I•ÍÕ±Ð€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€M1PÍÁ°¹¥°(€€€€€€€€€€€€€€€ÍÁ°¹‰…Ñ¡}¥°(€€€€€€€€€€€€€€€ÍÁ°¹Í¡…É•¡½±‘•É}¥°(€€€€€€€€€€€€€€€ÍÁ°¹…µ½Õ¹Ð°(€€€€€€€€€€€€€€€ÍÁ°¹ÕÉÉ•¹ä°(€€€€€€€€€€€€€€€ÍÁ°¹É•™•É•¹”°(€€€€€€€€€€€€€€€ÍÁ°¹É••¥ÁÑ}¹Õµ‰•È°(€€€€€€€€€€€€€€€ÍÁ°¹…Í¡}µ½Ù•µ•¹Ñ}¥°(€€€€€€€€€€€€€€€ÍÁ°¹Õ…É…¹Ñ••}…Í¡}µ½Ù•µ•¹Ñ}¥°(€€€€€€€€€€€€€€€ÍÁ°¹‰…¹­}ÑÉ…¹Í…Ñ¥½¹}¥°(€€€€€€€€€€€€€€€ÍÁ°¹‘•±•Ñ•‘}…Ð°(€€€€€€€€€€€€€€€ÍÁˆ¹É•™•É•¹”L‰…Ñ¡}É•™•É•¹”°(€€€€€€€€€€€€€€€ÍÁˆ¹Í½ÕÉ•}É•¥ÍÑ•È°(€€€€€€€€€€€€€€€ÍÁˆ¹ÍÑ…ÑÕÌL‰…Ñ¡}ÍÑ…ÑÕÌ°(€€€€€€€€€€€€€€€ÍÁˆ¹‘•±•Ñ•‘}…ÐL‰…Ñ¡}‘•±•Ñ•‘}…Ð°(€€€€€€€€€€€€€€€Í ¹‘¥ÍÁ±…å}¹…µ”LÍ¡…É•¡½±‘•É}¹…µ”(€€€€€€€€I=4Í¡…É•¡½±‘•É}Á…å½ÕÑ}±¥¹•ÌÍÁ°(€€€€€€€€)=%8Í¡…É•¡½±‘•É}Á…å½ÕÑ}‰…Ñ¡•ÌÍÁˆ=8ÍÁˆ¹¥€ôÍÁ°¹‰…Ñ¡}¥9ÍÁˆ¹½É…¹¥é…Ñ¥½¹}¥€ôÍÁ°¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€€€)=%8Í¡…É•¡½±‘•ÉÌÍ =8Í ¹¥€ôÍÁ°¹Í¡…É•¡½±‘•É}¥9Í ¹½É…¹¥é…Ñ¥½¹}¥€ôÍÁ°¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€€€]!IÍÁ°¹¥€ô€Ä(€€€€€€€€€€9ÍÁ°¹½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€=HUAQ€°(€€€€€€€mÁ…å½ÕÑ1¥¹•%°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€€€¤ì(€€€€€ÑÉ…” Á…å½ÕÐ±¥¹”É•…œ°€=,œ°Á…å½ÕÑ½Õ¹ô‘í	½½±•…¸¡±¥¹•I•ÍÕ±Ð¹É½ÝÍlÁt¥õ€¤ì(€€€€€±¥¹”€ôÉ•ÅÕ¥É•I½Ü¡±¥¹•I•ÍÕ±Ð¹É½ÝÍlÁt°€M¡…É•¡½±‘•ÈÁ…å½ÕÐœ¤…ÌI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸øì((€€€€€ÑÉ…” ‰…Ñ É•…œ°€=,œ°‰…Ñ¡%ô‘í9Õµ‰•È¡±¥¹”¹‰…Ñ¡}¥¥ô‰…Ñ¡•±•Ñ•ô‘í	½½±•…¸¡±¥¹”¹‰…Ñ¡}‘•±•Ñ•‘}…Ð¥õ€¤ì(€€€€€ÑÉ…” Í¡…É•¡½±‘•ÈÉ•…œ°€=,œ°Í¡…É•¡½±‘•É%ô‘í9Õµ‰•È¡±¥¹”¹Í¡…É•¡½±‘•É}¥¥õ€¤ì((€€€€€¥˜€¡±¥¹”¹‘•±•Ñ•‘}…Ð¤ì(€€€€€€€ÑÉ…” Á…å½ÕÐ±¥¹”Ù…±¥‘…Ñ¥½¸œ°€%0œ°€É•…Í½¸õ…±É•…‘å}¥¹}ÑÉ…Í œ¤ì(€€€€€€€Ñ¡É½Ü¹•Ü½¹™±¥Ñá•ÁÑ¥½¸ ”É•µ‰½ÕÉÍ•µ•¹Ð…Ñ¥½¹¹…¥É”•ÍÐ“¥«€‘…¹Ì±„½É‰•¥±±”¸œ¤ì(€€€€€ô(€€€€€¥˜€¡±¥¹”¹‰…Ñ¡}‘•±•Ñ•‘}…Ð¤ì(€€€€€€€ÑÉ…” ‰…Ñ Ù…±¥‘…Ñ¥½¸œ°€%0œ°€É•…Í½¸õ‰…Ñ¡}…±É•…‘å}¥¹}ÑÉ…Í œ¤ì(€€€€€€€Ñ¡É½Ü¹•Ü½¹™±¥Ñá•ÁÑ¥½¸ 1”±½Ð‘”É•µ‰½ÕÉÍ•µ•¹Ð…Ñ¥½¹¹…¥É”•ÍÐ“¥«€‘…¹Ì±„½É‰•¥±±”¸œ¤ì(€€€€€ô(€€€€€¥˜€¡±¥¹”¹‰…¹­}ÑÉ…¹Í…Ñ¥½¹}¥¤ì(€€€€€€€ÑÉ…” ‰…¹¬ÑÉ…¹Í…Ñ¥½¸Ù…±¥‘…Ñ¥½¸œ°€%0œ°€É•…Í½¸õ‰…¹­}ÑÉ…¹Í…Ñ¥½¹}±¥¹­•œ¤ì(€€€€€€€Ñ¡É½Ü¹•Ü½¹™±¥Ñá•ÁÑ¥½¸ (€€€€€€€€€€”É•µ‰½ÕÉÍ•µ•¹Ð…Ñ¥½¹¹…¥É”‰…¹…¥É”¹”Á•ÕÐÁ…Ì•¹½É”ƒ©ÑÉ”ÍÕÁÁÉ¥·¤…ÕÑ½µ…Ñ¥ÅÕ•µ•¹Ð‘•ÁÕ¥Ì”Ý½É­™±½Ü¸œ°(€€€€€€€€¤ì(€€€€€ô((€€€€€…Í¡5½Ù•µ•¹Ñ%€ô9Õµ‰•È¡±¥¹”¹…Í¡}µ½Ù•µ•¹Ñ}¥€üü€À¤ñð¹Õ±°ì(€€€€€Õ…É…¹Ñ••…Í¡5½Ù•µ•¹Ñ%€ô9Õµ‰•È¡±¥¹”¹Õ…É…¹Ñ••}…Í¡}µ½Ù•µ•¹Ñ}¥€üü€À¤ñð¹Õ±°ì(€€€€€¥˜€¡…Í¡5½Ù•µ•¹Ñ%¤ì(€€€€€€€ÑÉ…” …Í¡}µ½Ù•µ•¹ÑÌÍ½™Ð‘•±•Ñ”œ°€MQIPœ°…Í¡5½Ù•µ•¹Ñ%ô‘í…Í¡5½Ù•µ•¹Ñ%‘õ€¤ì(€€€€€€€…Ý…¥ÐÑ¡¥Ì¹Í½™Ñ•±•Ñ•¥¹…¹•I½ÝÌ¡±¥•¹Ð°€…Í¡}µ½Ù•µ•¹ÑÌœ°€¥œ°…Í¡5½Ù•µ•¹Ñ%°É•…Í½¸¤ì(€€€€€€€ÑÉ…” …Í¡}µ½Ù•µ•¹ÑÌÍ½™Ð‘•±•Ñ”œ°€=,œ°…Í¡5½Ù•µ•¹Ñ%ô‘í…Í¡5½Ù•µ•¹Ñ%‘õ€¤ì(€€€€€ô•±Í”ì(€€€€€€€ÑÉ…” …Í¡}µ½Ù•µ•¹ÑÌÍ½™Ð‘•±•Ñ”œ°€=,œ°€…Í¡5½Ù•µ•¹Ñ%õ¹Õ±°œ¤ì(€€€€€ô(€€€€€¥˜€¡Õ…É…¹Ñ••…Í¡5½Ù•µ•¹Ñ%¤ì(€€€€€€€ÑÉ…” Õ…É…¹Ñ••}…Í¡}µ½Ù•µ•¹ÑÌÍ½™Ð‘•±•Ñ”œ°€MQIPœ°Õ…É…¹Ñ••…Í¡5½Ù•µ•¹Ñ%ô‘íÕ…É…¹Ñ••…Í¡5½Ù•µ•¹Ñ%‘õ€¤ì(€€€€€€€…Ý…¥ÐÑ¡¥Ì¹Í½™Ñ•±•Ñ•¥¹…¹•I½ÝÌ¡±¥•¹Ð°€Õ…É…¹Ñ••}…Í¡}µ½Ù•µ•¹ÑÌœ°€¥œ°Õ…É…¹Ñ••…Í¡5½Ù•µ•¹Ñ%°É•…Í½¸¤ì(€€€€€€€ÑÉ…” Õ…É…¹Ñ••}…Í¡}µ½Ù•µ•¹ÑÌÍ½™Ð‘•±•Ñ”œ°€=,œ°Õ…É…¹Ñ••…Í¡5½Ù•µ•¹Ñ%ô‘íÕ…É…¹Ñ••…Í¡5½Ù•µ•¹Ñ%‘õ€¤ì(€€€€€ô•±Í”ì(€€€€€€€ÑÉ…” Õ…É…¹Ñ••}…Í¡}µ½Ù•µ•¹ÑÌÍ½™Ð‘•±•Ñ”œ°€=,œ°€Õ…É…¹Ñ••…Í¡5½Ù•µ•¹Ñ%õ¹Õ±°œ¤ì(€€€€€ô((€€€€€ÑÉ…” Í¡…É•¡½±‘•É}Á…å½ÕÑ}±¥¹•ÌÕÁ‘…Ñ”œ°€MQIPœ¤ì(€€€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€UAQÍ¡…É•¡½±‘•É}Á…å½ÕÑ}±¥¹•Ì(€€€€€€€€MP‘•±•Ñ•‘}…Ð€ô9=\ ¤°(€€€€€€€€€€€€‘•±•Ñ•‘}‰ä€ô€È°(€€€€€€€€€€€€‘•±•Ñ¥½¹}É•…Í½¸€ô€Ì(€€€€€€€€]!I¥€ô€Ä(€€€€€€€€€€9½É…¹¥é…Ñ¥½¹}¥€ô€Ð(€€€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U11€°(€€€€€€€mÁ…å½ÕÑ1¥¹•%°Ñ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•É% ¤€üü¹Õ±°°É•…Í½¸°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€€€¤ì(€€€€€ÑÉ…” Í¡…É•¡½±‘•É}Á…å½ÕÑ}±¥¹•ÌÕÁ‘…Ñ”œ°€=,œ¤ì((€€€€€ÑÉ…” ‰…Ñ É•…±Õ±…Ñ¥½¸œ°€MQIPœ¤ì(€€€€€½¹ÍÐÉ•µ…¥¹¥¹I•ÍÕ±Ð€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€M1P=U9P ¨¤èé%9PL±¥¹•}½Õ¹Ð°(€€€€€€€€€€€€€€€=1M¡MU4¡…µ½Õ¹Ð¤°€À¤èé9U5I% ÄÐ°È¤LÑ½Ñ…±}…µ½Õ¹Ð(€€€€€€€€I=4Í¡…É•¡½±‘•É}Á…å½ÕÑ}±¥¹•Ì(€€€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€€€9‰…Ñ¡}¥€ô€È(€€€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U11€°(€€€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°9Õµ‰•È¡±¥¹”¹‰…Ñ¡}¥¥t°(€€€€€€¤ì(€€€€€É•µ…¥¹¥¹1¥¹•½Õ¹Ð€ô9Õµ‰•È¡É•µ…¥¹¥¹I•ÍÕ±Ð¹É½ÝÍlÁtü¹±¥¹•}½Õ¹Ð€üü€À¤ì(€€€€€É•µ…¥¹¥¹Q½Ñ…±µ½Õ¹Ð€ô9Õµ‰•È¡É•µ…¥¹¥¹I•ÍÕ±Ð¹É½ÝÍlÁtü¹Ñ½Ñ…±}…µ½Õ¹Ð€üü€À¤ì(€€€€€¹•áÑ	…Ñ¡MÑ…ÑÕÌ€ôÉ•µ…¥¹¥¹1¥¹•½Õ¹Ð€ø€À€ü€Y1%Qœ€è€911œì((€€€€€¥˜€¡É•µ…¥¹¥¹1¥¹•½Õ¹Ð€ø€À¤ì(€€€€€€€ÑÉ…” ‰…Ñ É•…±Õ±…Ñ¥½¸œ°€=,œ°É•µ…¥¹¥¹1¥¹•½Õ¹Ðô‘íÉ•µ…¥¹¥¹1¥¹•½Õ¹ÑôÑ½Ñ…±µ½Õ¹Ðô‘íÉ•µ…¥¹¥¹Q½Ñ…±µ½Õ¹ÑôÍÑ…ÑÕÌô‘í¹•áÑ	…Ñ¡MÑ…ÑÕÍõ€¤ì(€€€€€€€ÑÉ…” Í¡…É•¡½±‘•É}Á…å½ÕÑ}‰…Ñ¡•ÌÕÁ‘…Ñ”œ°€MQIPœ¤ì(€€€€€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€€€UAQÍ¡…É•¡½±‘•É}Á…å½ÕÑ}‰…Ñ¡•Ì(€€€€€€€€€€MPÑ½Ñ…±}…µ½Õ¹Ð€ô€Ì°(€€€€€€€€€€€€€€‰•¹•™¥¥…Éå}½Õ¹Ð€ô€Ð°(€€€€€€€€€€€€€€ÍÑ…ÑÕÌ€ô€Ô(€€€€€€€€€€]!I¥€ô€Ä(€€€€€€€€€€€€9½É…¹¥é…Ñ¥½¹}¥€ô€É€°(€€€€€€€€€m9Õµ‰•È¡±¥¹”¹‰…Ñ¡}¥¤°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°É•µ…¥¹¥¹Q½Ñ…±µ½Õ¹Ð°É•µ…¥¹¥¹1¥¹•½Õ¹Ð°¹•áÑ	…Ñ¡MÑ…ÑÕÍt°(€€€€€€€€¤ì(€€€€€€€ÑÉ…” Í¡…É•¡½±‘•É}Á…å½ÕÑ}‰…Ñ¡•ÌÕÁ‘…Ñ”œ°€=,œ°É•µ…¥¹¥¹1¥¹•½Õ¹Ðô‘íÉ•µ…¥¹¥¹1¥¹•½Õ¹Ñõ€¤ì(€€€€€ô•±Í”ì(€€€€€€€ÑÉ…” ‰…Ñ É•…±Õ±…Ñ¥½¸œ°€=,œ°É•µ…¥¹¥¹1¥¹•½Õ¹ÐôÀÑ½Ñ…±µ½Õ¹ÐôÀÍÑ…ÑÕÌô‘í¹•áÑ	…Ñ¡MÑ…ÑÕÍõ€¤ì(€€€€€€€ÑÉ…” Í¡…É•¡½±‘•É}Á…å½ÕÑ}‰…Ñ¡•ÌÕÁ‘…Ñ”œ°€MQIPœ¤ì(€€€€€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€€€UAQÍ¡…É•¡½±‘•É}Á…å½ÕÑ}‰…Ñ¡•Ì(€€€€€€€€€€MPÑ½Ñ…±}…µ½Õ¹Ð€ô€À°(€€€€€€€€€€€€€€‰•¹•™¥¥…Éå}½Õ¹Ð€ô€À°(€€€€€€€€€€€€€€ÍÑ…ÑÕÌ€ô€Ì°(€€€€€€€€€€€€€€‘•±•Ñ•‘}…Ð€ô9=\ ¤°(€€€€€€€€€€€€€€‘•±•Ñ•‘}‰ä€ô€Ð°(€€€€€€€€€€€€€€‘•±•Ñ¥½¹}É•…Í½¸€ô€Ô(€€€€€€€€€€]!I¥€ô€Ä(€€€€€€€€€€€€9½É…¹¥é…Ñ¥½¹}¥€ô€É€°(€€€€€€€€€m9Õµ‰•È¡±¥¹”¹‰…Ñ¡}¥¤°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°¹•áÑ	…Ñ¡MÑ…ÑÕÌ°Ñ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•É% ¤€üü¹Õ±°°É•…Í½¹t°(€€€€€€€€¤ì(€€€€€€€ÑÉ…” Í¡…É•¡½±‘•É}Á…å½ÕÑ}‰…Ñ¡•ÌÕÁ‘…Ñ”œ°€=,œ°€‰…Ñ¡5…É­•‘•±•Ñ•õÑÉÕ”œ¤ì(€€€€€ô((€€€€€ÑÉ…” Í¡…É•¡½±‘•ÈÑ½Ñ…±ÌÉ•…±Õ±…Ñ¥½¸œ°€MQIPœ¤ì(€€€€€½¹ÍÐÍ¡…É•¡½±‘•ÉQ½Ñ…±ÍI•ÍÕ±Ð€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€M1P=1M¡MU4¡M]!8ÍÁˆ¹ÍÑ…ÑÕÌ€ô€Y1%Qœ9ÍÁ°¹ÕÉÉ•¹ä€ô€UMœQ!8ÍÁ°¹…µ½Õ¹Ð1M€À9¤°€À¤èé9U5I% ÄÐ°È¤LÑ½Ñ…±}ÕÍ°(€€€€€€€€€€€€€€€=1M¡MU4¡M]!8ÍÁˆ¹ÍÑ…ÑÕÌ€ô€Y1%Qœ9ÍÁ°¹ÕÉÉ•¹ä€ô€œQ!8ÍÁ°¹…µ½Õ¹Ð1M€À9¤°€À¤èé9U5I% ÄÐ°È¤LÑ½Ñ…±}‘˜°(€€€€€€€€€€€€€€€=U9P ¨¤%1QH€¡]!IÍÁˆ¹ÍÑ…ÑÕÌ€ô€Y1%Qœ¤èé%9PLÁ…å½ÕÑ}½Õ¹Ð(€€€€€€€€I=4Í¡…É•¡½±‘•É}Á…å½ÕÑ}±¥¹•ÌÍÁ°(€€€€€€€€)=%8Í¡…É•¡½±‘•É}Á…å½ÕÑ}‰…Ñ¡•ÌÍÁˆ=8ÍÁˆ¹¥€ôÍÁ°¹‰…Ñ¡}¥9ÍÁˆ¹½É…¹¥é…Ñ¥½¹}¥€ôÍÁ°¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€€€]!IÍÁ°¹½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€€€9ÍÁ°¹Í¡…É•¡½±‘•É}¥€ô€È(€€€€€€€€€€9ÍÁ°¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€€€9ÍÁˆ¹‘•±•Ñ•‘}…Ð%L9U11€°(€€€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°9Õµ‰•È¡±¥¹”¹Í¡…É•¡½±‘•É}¥¥t°(€€€€€€¤ì(€€€€€Í¡…É•¡½±‘•ÉQ½Ñ…±Ì€ôÍ¡…É•¡½±‘•ÉQ½Ñ…±ÍI•ÍÕ±Ðì(€€€€€ÑÉ…” (€€€€€€€€Í¡…É•¡½±‘•ÈÑ½Ñ…±ÌÉ•…±Õ±…Ñ¥½¸œ°(€€€€€€€€=,œ°(€€€€€€€Ñ½Ñ…±UÍô‘í9Õµ‰•È¡Í¡…É•¡½±‘•ÉQ½Ñ…±Ì¹É½ÝÍlÁtü¹Ñ½Ñ…±}ÕÍ€üü€À¥ôÑ½Ñ…±‘˜ô‘í9Õµ‰•È¡Í¡…É•¡½±‘•ÉQ½Ñ…±Ì¹É½ÝÍlÁtü¹Ñ½Ñ…±}‘˜€üü€À¥ôÁ…å½ÕÑ½Õ¹Ðô‘í9Õµ‰•È¡Í¡…É•¡½±‘•ÉQ½Ñ…±Ì¹É½ÝÍlÁtü¹Á…å½ÕÑ}½Õ¹Ð€üü€À¥õ€°(€€€€€€¤ì((€€€€€ÑÉ…” …Õ‘¥Ðœ°€MQIPœ¤ì(€€€€€…Ý…¥ÐÑ¡¥Ì¹ÝÉ¥Ñ•¥¹…¹•QÉ…Í¡Õ‘¥Ð (€€€€€€€±¥•¹Ð°(€€€€€€€½ÁÑ¥½¹Ìü¹…Õ‘¥ÑÑ¥½¸€üü€M!I!=1I}Ae=UQ}5=Y}Q=}QIM œ°(€€€€€€€½ÁÑ¥½¹Ìü¹…Õ‘¥ÑI•Í½ÕÉ”€üü€Í¡…É•¡½±‘•É}Á…å½ÕÑÌœ°(€€€€€€€½ÁÑ¥½¹Ìü¹…Õ‘¥ÑI•Í½ÕÉ•%€üüMÑÉ¥¹œ¡Á…å½ÕÑ1¥¹•%¤°(€€€€€€€ì(€€€€€€€€€É•…Í½¸°(€€€€€€€€€Í¡…É•¡½±‘•É}Á…å½ÕÑ}±¥¹•}¥èÁ…å½ÕÑ1¥¹•%°(€€€€€€€€€Í¡…É•¡½±‘•É}¥è9Õµ‰•È¡±¥¹”¹Í¡…É•¡½±‘•É}¥¤°(€€€€€€€€€Í¡…É•¡½±‘•É}¹…µ”è±¥¹”¹Í¡…É•¡½±‘•É}¹…µ”€üü¹Õ±°°(€€€€€€€€€Í¡…É•¡½±‘•É}‰…Ñ¡}¥è9Õµ‰•È¡±¥¹”¹‰…Ñ¡}¥¤°(€€€€€€€€€‰…Ñ¡}É•™•É•¹”è±¥¹”¹‰…Ñ¡}É•™•É•¹”€üü¹Õ±°°(€€€€€€€€€Í½ÕÉ•}É•¥ÍÑ•Èè±¥¹”¹Í½ÕÉ•}É•¥ÍÑ•È€üü¹Õ±°°(€€€€€€€€€…µ½Õ¹Ðè9Õµ‰•È¡±¥¹”¹…µ½Õ¹Ð€üü€À¤°(€€€€€€€€€ÕÉÉ•¹äèMÑÉ¥¹œ¡±¥¹”¹ÕÉÉ•¹ä€üü€UMœ¤°(€€€€€€€€€É••¥ÁÑ}¹Õµ‰•Èè±¥¹”¹É••¥ÁÑ}¹Õµ‰•È€üü¹Õ±°°(€€€€€€€€€…Í¡}µ½Ù•µ•¹Ñ}¥è…Í¡5½Ù•µ•¹Ñ%°(€€€€€€€€€Õ…É…¹Ñ••}…Í¡}µ½Ù•µ•¹Ñ}¥èÕ…É…¹Ñ••…Í¡5½Ù•µ•¹Ñ%°(€€€€€€€€€Í½ÕÉ•}µ½Ù•µ•¹Ñ}¥è½ÁÑ¥½¹Ìü¹Í½ÕÉ•5½Ù•µ•¹Ñ%€üü…Í¡5½Ù•µ•¹Ñ%€üüÕ…É…¹Ñ••…Í¡5½Ù•µ•¹Ñ%°(€€€€€€€€€É•µ…¥¹¥¹}‰…Ñ¡}±¥¹•ÌèÉ•µ…¥¹¥¹1¥¹•½Õ¹Ð°(€€€€€€€€€‰…Ñ¡}Ñ½Ñ…±}…µ½Õ¹ÐèÉ•µ…¥¹¥¹Q½Ñ…±µ½Õ¹Ð°(€€€€€€€€€‰…Ñ¡}ÍÑ…ÑÕÌè¹•áÑ	…Ñ¡MÑ…ÑÕÌ°(€€€€€€€€€Í¡…É•¡½±‘•É}Ñ½Ñ…±}ÕÍè9Õµ‰•È¡Í¡…É•¡½±‘•ÉQ½Ñ…±Ì¹É½ÝÍlÁtü¹Ñ½Ñ…±}ÕÍ€üü€À¤°(€€€€€€€€€Í¡…É•¡½±‘•É}Ñ½Ñ…±}‘˜è9Õµ‰•È¡Í¡…É•¡½±‘•ÉQ½Ñ…±Ì¹É½ÝÍlÁtü¹Ñ½Ñ…±}‘˜€üü€À¤°(€€€€€€€€€Í¡…É•¡½±‘•É}Á…å½ÕÑ}½Õ¹Ðè9Õµ‰•È¡Í¡…É•¡½±‘•ÉQ½Ñ…±Ì¹É½ÝÍlÁtü¹Á…å½ÕÑ}½Õ¹Ð€üü€À¤°(€€€€€€€ô°(€€€€€€¤ì(€€€€€ÑÉ…” …Õ‘¥Ðœ°€=,œ¤ì((€€€€€ÑÉ…” É•ÑÕÉ¸Á…å±½…œ°€=,œ¤ì(€€€€€É•ÑÕÉ¸ì(€€€€€€€‘•±•Ñ•èÑÉÕ”°(€€€€€€€Í¡…É•¡½±‘•É}Á…å½ÕÑ}±¥¹•}¥èÁ…å½ÕÑ1¥¹•%°(€€€€€€€‰…Ñ¡}¥è9Õµ‰•È¡±¥¹”¹‰…Ñ¡}¥¤°(€€€€€€€Í¡…É•¡½±‘•É}¥è9Õµ‰•È¡±¥¹”¹Í¡…É•¡½±‘•É}¥¤°(€€€€€€€É•µ…¥¹¥¹}‰…Ñ¡}±¥¹•ÌèÉ•µ…¥¹¥¹1¥¹•½Õ¹Ð°(€€€€€€€‰…Ñ¡}‘•±•Ñ•èÉ•µ…¥¹¥¹1¥¹•½Õ¹Ð€ôôô€À°(€€€€€€€‰…Ñ¡}ÍÑ…ÑÕÌè¹•áÑ	…Ñ¡MÑ…ÑÕÌ°(€€€€€€€Í¡…É•¡½±‘•É}Ñ½Ñ…±}ÕÍè9Õµ‰•È¡Í¡…É•¡½±‘•ÉQ½Ñ…±Ì¹É½ÝÍlÁtü¹Ñ½Ñ…±}ÕÍ€üü€À¤°(€€€€€€€Í¡…É•¡½±‘•É}Ñ½Ñ…±}‘˜è9Õµ‰•È¡Í¡…É•¡½±‘•ÉQ½Ñ…±Ì¹É½ÝÍlÁtü¹Ñ½Ñ…±}‘˜€üü€À¤°(€€€€€€€Í¡…É•¡½±‘•É}Á…å½ÕÑ}½Õ¹Ðè9Õµ‰•È¡Í¡…É•¡½±‘•ÉQ½Ñ…±Ì¹É½ÝÍlÁtü¹Á…å½ÕÑ}½Õ¹Ð€üü€À¤°(€€€€€ôì(€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€ÑÉ…” Ý½É­™±½Üœ°€%0œ°ÍÑ•Àõ•á•ÁÑ¥½¹€¤ì(€€€€€Ñ¡¥Ì¹±½M¡…É•¡½±‘•ÉA…å½ÕÑQÉ…Í¡ÉÉ½È Ý½É­™±½Üœ°Á…å½ÕÑ1¥¹•%°•ÉÉ½È¤ì(€€€€€Ñ¡É½Ü•ÉÉ½Èì(€€€ô(€ô((€ÁÉ¥Ù…Ñ”±½M¡…É•¡½±‘•ÉA…å½ÕÑQÉ…Í¡ÉÉ½È¡ÍÑ…”èÍÑÉ¥¹œ°Á…å½ÕÑ1¥¹•%è¹Õµ‰•È°•ÉÉ½ÈèÕ¹­¹½Ý¸¤ì(€€€½¹ÍÐÁÉÉ½È€ô•ÉÉ½È…Ìì(€€€€€½‘”üèÍÑÉ¥¹œì(€€€€€‘•Ñ…¥°üèÍÑÉ¥¹œì(€€€€€½¹ÍÑÉ…¥¹ÐüèÍÑÉ¥¹œì(€€€€€Ñ…‰±”üèÍÑÉ¥¹œì(€€€€€½±Õµ¸üèÍÑÉ¥¹œì(€€€ôì(€€€Ñ¡¥Ì¹±½•È¹•ÉÉ½È (€€€€€Í¡…É•¡½±‘•ÈÁ…å½ÕÐÑÉ…Í €‘íÍÑ…•ô•ÉÉ½ÈðÁ…å½ÕÑ1¥¹•%ô‘íÁ…å½ÕÑ1¥¹•%‘ô½É…¹¥é…Ñ¥½¹%ô‘íÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥ôµ•ÍÍ…”ô‘í•ÉÉ½È¥¹ÍÑ…¹•½˜ÉÉ½È€ü•ÉÉ½È¹µ•ÍÍ…”€èMÑÉ¥¹œ¡•ÉÉ½È¥ôÁ½‘”ô‘íÁÉÉ½Èü¹½‘”€üü¹Õ±±ôÁ•Ñ…¥°ô‘íÁÉÉ½Èü¹‘•Ñ…¥°€üü¹Õ±±ôÁ½¹ÍÑÉ…¥¹Ðô‘íÁÉÉ½Èü¹½¹ÍÑÉ…¥¹Ð€üü¹Õ±±ôÁQ…‰±”ô‘íÁÉÉ½Èü¹Ñ…‰±”€üü¹Õ±±ôÁ½±Õµ¸ô‘íÁÉÉ½Èü¹½±Õµ¸€üü¹Õ±±õ€°(€€€€€•ÉÉ½È¥¹ÍÑ…¹•½˜ÉÉ½È€ü•ÉÉ½È¹ÍÑ…¬€èÕ¹‘•™¥¹•°(€€€€¤ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÝÉ¥Ñ•¥¹…¹•QÉ…Í¡Õ‘¥Ð (€€€±¥•¹ÐèA½½±±¥•¹Ð°(€€€…Ñ¥½¸èÍÑÉ¥¹œ°(€€€É•Í½ÕÉ”èÍÑÉ¥¹œ°(€€€É•Í½ÕÉ•%èÍÑÉ¥¹œ°(€€€µ•Ñ…‘…Ñ„èI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø°(€€¤ì(€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€%9MIP%9Q<…Õ‘¥Ñ}±½Ì€¡½É…¹¥é…Ñ¥½¹}¥°ÕÍ•É}¥°…Ñ¥½¸°É•Í½ÕÉ”°É•Í½ÕÉ•}¥°µ•Ñ¡½°Á…Ñ °ÍÑ…ÑÕÍ}½‘”°µ•Ñ…‘…Ñ„¤(€€€€€€Y1UL€ Ä°€È°€Ì°€Ð°€Ô°€1Qœ°€Ø°€ÈÀÀ°€Üèé)M=9¥€°(€€€€€l(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•É% ¤€üü¹Õ±°°(€€€€€€€…Ñ¥½¸°(€€€€€€€É•Í½ÕÉ”°(€€€€€€€É•Í½ÕÉ•%°(€€€€€€€€½…Á¤¼‘íÉ•Í½ÕÉ•ô¼‘íÉ•Í½ÕÉ•%‘õ€°(€€€€€€€)M=8¹ÍÑÉ¥¹¥™ä¡µ•Ñ…‘…Ñ„¤°(€€€€€t°(€€€€¤ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ•¹ÍÕÉ•M¡…É•¡½±‘•ÉM¡•µ„ ¤ì(€€€¥˜€ „¡…Ý…¥ÐÑ¡¥Ì¹¡…ÍM¡…É•¡½±‘•ÉA…å½ÕÑM¡•µ„ ¤¤¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1”µ½‘Õ±”‘•Ì…Ñ¥½¹¹…¥É•Ì¸•ÍÐÁ…Ì•¹½É”½¹™¥ÕË¤¸œ¤ì(€€€ô(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ¡…ÍM¡…É•¡½±‘•ÉA…å½ÕÑM¡•µ„ ¤ì(€€€É•ÑÕÉ¸€¡…Ý…¥ÐÑ¡¥Ì¹Ñ…‰±•á¥ÍÑÌ Í¡…É•¡½±‘•ÉÌœ¤¤(€€€€€€˜˜€¡…Ý…¥ÐÑ¡¥Ì¹Ñ…‰±•á¥ÍÑÌ Í¡…É•¡½±‘•É}Á…å½ÕÑ}‰…Ñ¡•Ìœ¤¤(€€€€€€˜˜€¡…Ý…¥ÐÑ¡¥Ì¹Ñ…‰±•á¥ÍÑÌ Í¡…É•¡½±‘•É}Á…å½ÕÑ}±¥¹•Ìœ¤¤ì(€ô((€ÁÉ¥Ù…Ñ”…ÍÍ•ÉÑM¡…É•¡½±‘•ÉA…å½ÕÑA•Éµ¥ÍÍ¥½¸¡Í½ÕÉ•I•¥ÍÑ•Èè€5%9}M œð€UI9Q}M œð€	9,œ¤ì(€€€¥˜€¡Í½ÕÉ•I•¥ÍÑ•È€ôôô€UI9Q}M œ¤ì(€€€€€¥˜€ …Ñ¡¥Ì¹¡…ÍA•Éµ¥ÍÍ¥½¸ Í¡…É•¡½±‘•É}Á…å½ÕÑÌ¹™É½µ}Õ…É…¹Ñ••}…Í œ¤¤ì(€€€€€€€Ñ¡É½Ü¹•Ü½É‰¥‘‘•¹á•ÁÑ¥½¸ A•Éµ¥ÍÍ¥½¸É•ÅÕ¥Í”Á½ÕÈÕÑ¥±¥Í•È±„…¥ÍÍ”‘•Ì…É…¹Ñ¥•Ì±½…Ñ¥Ù•Ì¸œ¤ì(€€€€€ô(€€€€€É•ÑÕÉ¸ì(€€€ô(€€€¥˜€¡Í½ÕÉ•I•¥ÍÑ•È€ôôô€	9,œ¤ì(€€€€€¥˜€ …Ñ¡¥Ì¹¡…ÍA•Éµ¥ÍÍ¥½¸ Í¡…É•¡½±‘•É}Á…å½ÕÑÌ¹™É½µ}‰…¹¬œ¤¤ì(€€€€€€€Ñ¡É½Ü¹•Ü½É‰¥‘‘•¹á•ÁÑ¥½¸ A•Éµ¥ÍÍ¥½¸É•ÅÕ¥Í”Á½ÕÈÕÑ¥±¥Í•È±„‰…¹ÅÕ”½µµ”Í½ÕÉ”‘”É•µ‰½ÕÉÍ•µ•¹Ð…Ñ¥½¹¹…¥É”¸œ¤ì(€€€€€ô(€€€€€É•ÑÕÉ¸ì(€€€ô(€€€¥˜€ …Ñ¡¥Ì¹¡…ÍA•Éµ¥ÍÍ¥½¸ Í¡…É•¡½±‘•É}Á…å½ÕÑÌ¹É•…Ñ”œ¤¤ì(€€€€€Ñ¡É½Ü¹•Ü½É‰¥‘‘•¹á•ÁÑ¥½¸ A•Éµ¥ÍÍ¥½¸É•ÅÕ¥Í”Á½ÕÈÙ…±¥‘•ÈÕ¸É•µ‰½ÕÉÍ•µ•¹Ð…Ñ¥½¹¹…¥É”¸œ¤ì(€€€ô(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÍ¡…É•¡½±‘•É	…¹­½Õ¹ÑÌ ¤ì(€€€…Ý…¥ÐÑ¡¥Ì¹•¹ÍÕÉ•	…¹­M¡•µ„ ¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1P‰„¸¨°(€€€€€€€€€€€€€=1M¡Ñà¹Ñ½Ñ…±}¥¸°€À¤èé9U5I% ÄÐ°È¤LÑ½Ñ…±}¥¸°(€€€€€€€€€€€€€=1M¡Ñà¹Ñ½Ñ…±}½ÕÐ°€À¤èé9U5I% ÄÐ°È¤LÑ½Ñ…±}½ÕÐ°(€€€€€€€€€€€€€=1M¡Ñà¹ÕÉÉ•¹Ñ}‰…±…¹”°€À¤èé9U5I% ÄÐ°È¤LÕÉÉ•¹Ñ}‰…±…¹”°(€€€€€€€€€€€€€=1M¡Ñà¹ÑÉ…¹Í…Ñ¥½¹}½Õ¹Ð°€À¤èé%9PLÑÉ…¹Í…Ñ¥½¹}½Õ¹Ð(€€€€€€I=4‰…¹­}…½Õ¹ÑÌ‰„(€€€€€€1P)=%8€ (€€€€€€€€M1P‰Ð¹‰…¹­}…½Õ¹Ñ}¥°(€€€€€€€€€€€€€€€MU4¡M]!8‰Ð¹ÍÑ…ÑÕÌ€ô€Y1%Qœ9‰Ð¹‘¥É•Ñ¥½¸€ô€%8œQ!8‰Ð¹…µ½Õ¹Ð1M€À9¤LÑ½Ñ…±}¥¸°(€€€€€€€€€€€€€€€MU4¡M]!8‰Ð¹ÍÑ…ÑÕÌ€ô€Y1%Qœ9‰Ð¹‘¥É•Ñ¥½¸€ô€=UPœQ!8‰Ð¹…µ½Õ¹Ð1M€À9¤LÑ½Ñ…±}½ÕÐ°(€€€€€€€€€€€€€€€MU4¡M]!8‰Ð¹ÍÑ…ÑÕÌ€ô€Y1%Qœ9‰Ð¹‘¥É•Ñ¥½¸€ô€%8œQ!8‰Ð¹…µ½Õ¹Ð1M€µ‰Ð¹…µ½Õ¹Ð9¤LÕÉÉ•¹Ñ}‰…±…¹”°(€€€€€€€€€€€€€€€=U9P ¨¤%1QH€¡]!I‰Ð¹ÍÑ…ÑÕÌ€ô€Y1%Qœ¤LÑÉ…¹Í…Ñ¥½¹}½Õ¹Ð(€€€€€€€€I=4‰…¹­}ÑÉ…¹Í…Ñ¥½¹Ì‰Ð(€€€€€€€€]!I‰Ð¹½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€I=U@	d‰Ð¹‰…¹­}…½Õ¹Ñ}¥(€€€€€€€¤Ñà=8Ñà¹‰…¹­}…½Õ¹Ñ}¥€ô‰„¹¥(€€€€€€]!I‰„¹½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€9‰„¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€9‰„¹ÍÑ…ÑÕÌ€ô€Q%Yœ(€€€€€€=IH	d‰„¹‰…¹­}¹…µ”M°‰„¹…½Õ¹Ñ}¹…µ”M°‰„¹¥M€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€É•ÑÕÉ¸É½ÝÌì(€ô((€ÁÉ¥Ù…Ñ”Í¡…É•¡½±‘•É	…¹­	…±…¹•Ì¡‰…¹­½Õ¹ÑÌèÉÉ…äñI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸øø¤ì(€€€½¹ÍÐ‰…±…¹•ÌèI•½ÉñÍÑÉ¥¹œ°¹Õµ‰•Èø€ôìUMè€À°è€Àôì(€€€™½È€¡½¹ÍÐ…½Õ¹Ð½˜‰…¹­½Õ¹ÑÌ¤ì(€€€€€½¹ÍÐÕÉÉ•¹ä€ôMÑÉ¥¹œ¡…½Õ¹Ð¹ÕÉÉ•¹ä€üü€UMœ¤¹Ñ½UÁÁ•É…Í” ¤ì(€€€€€‰…±…¹•ÍmÕÉÉ•¹åt€ô9Õµ‰•È ¡‰…±…¹•ÍmÕÉÉ•¹åt€üü€À¤€¬9Õµ‰•È¡…½Õ¹Ð¹ÕÉÉ•¹Ñ}‰…±…¹”€üü€À¤¤ì(€€€ô(€€€É•ÑÕÉ¸‰…±…¹•Ìì(€ô((€ÁÉ¥Ù…Ñ”…ÍÍ•ÉÑQÉ•…ÍÕÉåQÉ…¹Í™•ÉA•Éµ¥ÍÍ¥½¸¡ÑÉ…¹Í™•ÉQåÁ”è€M!}Q=}	9,œð€	9-}Q=}M œð€	9-}Q=}	9,œ¤ì(€€€¥˜€ …Ñ¡¥Ì¹¡…ÍA•Éµ¥ÍÍ¥½¸ ÑÉ•…ÍÕÉå}ÑÉ…¹Í™•ÉÌ¹É•…Ñ”œ¤¤ì(€€€€€Ñ¡É½Ü¹•Ü½É‰¥‘‘•¹á•ÁÑ¥½¸ A•Éµ¥ÍÍ¥½¸É•ÅÕ¥Í”Á½ÕÈË¥•ÈÕ¸ÑÉ…¹Í™•ÉÐ¥¹Ñ•É¹”¸œ¤ì(€€€ô(€€€¥˜€¡ÑÉ…¹Í™•ÉQåÁ”€ôôô€M!}Q=}	9,œ€˜˜€…Ñ¡¥Ì¹¡…ÍA•Éµ¥ÍÍ¥½¸ ÑÉ•…ÍÕÉå}ÑÉ…¹Í™•ÉÌ¹™É½µ}…Í œ¤¤ì(€€€€€Ñ¡É½Ü¹•Ü½É‰¥‘‘•¹á•ÁÑ¥½¸ A•Éµ¥ÍÍ¥½¸É•ÅÕ¥Í”Á½ÕÈ“¥Á½Í•È±„…¥ÍÍ”•¸‰…¹ÅÕ”¸œ¤ì(€€€ô(€€€¥˜€¡ÑÉ…¹Í™•ÉQåÁ”€ôôô€	9-}Q=}M œ€˜˜€…Ñ¡¥Ì¹¡…ÍA•Éµ¥ÍÍ¥½¸ ÑÉ•…ÍÕÉå}ÑÉ…¹Í™•ÉÌ¹™É½µ}‰…¹¬œ¤¤ì(€€€€€Ñ¡É½Ü¹•Ü½É‰¥‘‘•¹á•ÁÑ¥½¸ A•Éµ¥ÍÍ¥½¸É•ÅÕ¥Í”Á½ÕÈÉ•Ñ¥É•ÈÕ¸½µÁÑ”‰…¹…¥É”Ù•ÉÌ±„…¥ÍÍ”¸œ¤ì(€€€ô(€€€¥˜€¡ÑÉ…¹Í™•ÉQåÁ”€ôôô€	9-}Q=}	9,œ€˜˜€…Ñ¡¥Ì¹¡…ÍA•Éµ¥ÍÍ¥½¸ ÑÉ•…ÍÕÉå}ÑÉ…¹Í™•ÉÌ¹‰…¹­}Ñ½}‰…¹¬œ¤¤ì(€€€€€Ñ¡É½Ü¹•Ü½É‰¥‘‘•¹á•ÁÑ¥½¸ A•Éµ¥ÍÍ¥½¸É•ÅÕ¥Í”Á½ÕÈÙ¥É•È•¹ÑÉ”½µÁÑ•Ì‰…¹…¥É•Ì¸œ¤ì(€€€ô(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÑÉ•…ÍÕÉå…Í¡	…±…¹•Ì ¤ì(€€€½¹ÍÐÍ•ÍÍ¥½¸€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1P¥°½Á•¹¥¹}‰…±…¹”(€€€€€€I=4…Í¡}Í•ÍÍ¥½¹Ì(€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€9ÍÑ…ÑÕÌ€ô€=A8œ(€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U10(€€€€€€=IH	d½Á•¹•‘}…ÐM(€€€€€€1%5%P€Å€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€½¹ÍÐ½Á•¹M•ÍÍ¥½¸€ôÍ•ÍÍ¥½¸¹É½ÝÍlÁtì(€€€½¹ÍÐ‰…±…¹•ÌèI•½ÉñÍÑÉ¥¹œ°¹Õµ‰•Èø€ôìUMè€À°è€Àôì(€€€¥˜€ …½Á•¹M•ÍÍ¥½¸¤É•ÑÕÉ¸‰…±…¹•Ìì(€€€½¹ÍÐÍÕÁÁ½ÉÑÍÕÉÉ•¹ä€ô…Ý…¥ÐÑ¡¥Ì¹½±Õµ¹á¥ÍÑÌ …Í¡}µ½Ù•µ•¹ÑÌœ°€ÕÉÉ•¹äœ¤ì(€€€½¹ÍÐÑ½Ñ…±Ì€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€ÍÕÁÁ½ÉÑÍÕÉÉ•¹ä(€€€€€€€€üM1P=1M¡ÕÉÉ•¹ä°€UMœ¤LÕÉÉ•¹ä°(€€€€€€€€€€€€€€€€€=1M¡MU4¡M]!8ÑåÁ”€ô€%8œQ!8…µ½Õ¹Ð1M€µ…µ½Õ¹Ð9¤°€À¤èé9U5I% ÄÐ°È¤L‰…±…¹”(€€€€€€€€€€I=4…Í¡}µ½Ù•µ•¹ÑÌ(€€€€€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€€€€€9…Í¡}Í•ÍÍ¥½¹}¥€ô€È(€€€€€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€€€€€9…Ñ•½Éä9=P%8€ 1M}UI9Qœ°€1M}UI9Q}IU9œ¤(€€€€€€€€€€I=U@	d=1M¡ÕÉÉ•¹ä°€UMœ¥€(€€€€€€€€èM1P€UMœLÕÉÉ•¹ä°(€€€€€€€€€€€€€€€€€=1M¡MU4¡M]!8ÑåÁ”€ô€%8œQ!8…µ½Õ¹Ð1M€µ…µ½Õ¹Ð9¤°€À¤èé9U5I% ÄÐ°È¤L‰…±…¹”(€€€€€€€€€€I=4…Í¡}µ½Ù•µ•¹ÑÌ(€€€€€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€€€€€9…Í¡}Í•ÍÍ¥½¹}¥€ô€È(€€€€€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€€€€€9…Ñ•½Éä9=P%8€ 1M}UI9Qœ°€1M}UI9Q}IU9œ¥€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°½Á•¹M•ÍÍ¥½¸¹¥‘t°(€€€€¤ì(€€€‰…±…¹•Ì¹UM€ô9Õµ‰•È¡½Á•¹M•ÍÍ¥½¸¹½Á•¹¥¹}‰…±…¹”€üü€À¤ì(€€€™½È€¡½¹ÍÐÉ½Ü½˜Ñ½Ñ…±Ì¹É½ÝÌ¤ì(€€€€€½¹ÍÐÕÉÉ•¹ä€ôMÑÉ¥¹œ¡É½Ü¹ÕÉÉ•¹ä€üü€UMœ¤¹Ñ½UÁÁ•É…Í” ¤ì(€€€€€‰…±…¹•ÍmÕÉÉ•¹åt€ô9Õµ‰•È ¡‰…±…¹•ÍmÕÉÉ•¹åt€üü€À¤€¬9Õµ‰•È¡É½Ü¹‰…±…¹”€üü€À¤¤ì(€€€ô(€€€É•ÑÕÉ¸‰…±…¹•Ìì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ½Á•¹…Í¡M•ÍÍ¥½¹½ÉQÉ•…ÍÕÉä¡±¥•¹ÐèA½½±±¥•¹Ð¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P¥°ÍÑ…ÑÕÌ°½Á•¹•‘}…Ð°½Á•¹¥¹}‰…±…¹”(€€€€€€I=4…Í¡}Í•ÍÍ¥½¹Ì(€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€9ÍÑ…ÑÕÌ€ô€=A8œ(€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U10(€€€€€€=IH	d½Á•¹•‘}…ÐM(€€€€€€1%5%P€Ä(€€€€€€=HUAQ€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€É•ÑÕÉ¸É•ÅÕ¥É•I½Ü¡É½ÝÍlÁt°€…Í Í•ÍÍ¥½¸œ¤ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÑÉ•…ÍÕÉå…Í¡	…±…¹•½ÉÕÉÉ•¹ä¡±¥•¹ÐèA½½±±¥•¹Ð°Í•ÍÍ¥½¹%è¹Õµ‰•È°ÕÉÉ•¹äèÍÑÉ¥¹œ°½Á•¹¥¹	…±…¹”è¹Õµ‰•È¤ì(€€€½¹ÍÐ¹½Éµ…±¥é•‘ÕÉÉ•¹ä€ôMÑÉ¥¹œ¡ÕÉÉ•¹ä€üü€UMœ¤¹Ñ½UÁÁ•É…Í” ¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P=1M¡MU4¡M]!8ÑåÁ”€ô€%8œQ!8…µ½Õ¹Ð1M€µ…µ½Õ¹Ð9¤°€À¤èé9U5I% ÄÐ°È¤L‰…±…¹”(€€€€€€I=4…Í¡}µ½Ù•µ•¹ÑÌ(€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€9…Í¡}Í•ÍÍ¥½¹}¥€ô€È(€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€9…Ñ•½Éä9=P%8€ 1M}UI9Qœ°€1M}UI9Q}IU9œ¥€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°Í•ÍÍ¥½¹%‘t°(€€€€¤ì(€€€½¹ÍÐ‰…Í”€ô¹½Éµ…±¥é•‘ÕÉÉ•¹ä€ôôô€UMœ€ü9Õµ‰•È¡½Á•¹¥¹	…±…¹”€üü€À¤€è€Àì(€€€É•ÑÕÉ¸9Õµ‰•È ¡‰…Í”€¬9Õµ‰•È¡É½ÝÍlÁtü¹‰…±…¹”€üü€À¤¤¹Ñ½¥á• È¤¤ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÙ…±¥‘…Ñ•	…¹­½Õ¹Ñ½ÉQÉ•…ÍÕÉåQÉ…¹Í™•È (€€€±¥•¹ÐèA½½±±¥•¹Ð°(€€€‰…¹­½Õ¹Ñ%è¹Õµ‰•Èð¹Õ±°°(€€€ÕÉÉ•¹äèÍÑÉ¥¹œ°(€€€½ÁÑ¥½¹ÌèìÉ½±”è€Í½ÕÉ”œð€‘•ÍÑ¥¹…Ñ¥½¸œì™½ÉUÁ‘…Ñ”üè‰½½±•…¸ô°(€€¤ì(€€€½¹ÍÐ…½Õ¹Ñ%€ô9Õµ‰•È¡‰…¹­½Õ¹Ñ%€üü€À¤ì(€€€¥˜€ ……½Õ¹Ñ%¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ (€€€€€€€½ÁÑ¥½¹Ì¹É½±”€ôôô€Í½ÕÉ”œ(€€€€€€€€€€ü€1”½µÁÑ”‰…¹…¥É”Í½ÕÉ”•ÍÐ½‰±¥…Ñ½¥É”¸œ(€€€€€€€€€€è€1”½µÁÑ”‰…¹…¥É”‘”‘•ÍÑ¥¹…Ñ¥½¸•ÍÐ½‰±¥…Ñ½¥É”¸œ°(€€€€€€¤ì(€€€ô(€€€¥˜€¡½ÁÑ¥½¹Ì¹™½ÉUÁ‘…Ñ”¤ì(€€€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€M1P¥(€€€€€€€€I=4‰…¹­}…½Õ¹ÑÌ(€€€€€€€€]!I¥€ô€È(€€€€€€€€€€9½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€=HUAQ€°(€€€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°…½Õ¹Ñ%‘t°(€€€€€€¤ì(€€€ô(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P‰„¸¨°(€€€€€€€€€€€€€=1M¡Ñà¹ÕÉÉ•¹Ñ}‰…±…¹”°€À¤èé9U5I% ÄÐ°È¤LÕÉÉ•¹Ñ}‰…±…¹”(€€€€€€I=4‰…¹­}…½Õ¹ÑÌ‰„(€€€€€€1P)=%8€ (€€€€€€€€M1P‰Ð¹‰…¹­}…½Õ¹Ñ}¥°(€€€€€€€€€€€€€€€MU4¡M]!8‰Ð¹ÍÑ…ÑÕÌ€ô€Y1%Qœ9‰Ð¹‘¥É•Ñ¥½¸€ô€%8œQ!8‰Ð¹…µ½Õ¹Ð1M€µ‰Ð¹…µ½Õ¹Ð9¤LÕÉÉ•¹Ñ}‰…±…¹”(€€€€€€€€I=4‰…¹­}ÑÉ…¹Í…Ñ¥½¹Ì‰Ð(€€€€€€€€]!I‰Ð¹½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€I=U@	d‰Ð¹‰…¹­}…½Õ¹Ñ}¥(€€€€€€€¤Ñà=8Ñà¹‰…¹­}…½Õ¹Ñ}¥€ô‰„¹¥(€€€€€€]!I‰„¹¥€ô€È(€€€€€€€€9‰„¹½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€9‰„¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°…½Õ¹Ñ%‘t°(€€€€¤ì(€€€½¹ÍÐ…½Õ¹Ð€ôÉ•ÅÕ¥É•I½Ü¡É½ÝÍlÁt°€	…¹¬…½Õ¹Ðœ¤ì(€€€¥˜€¡MÑÉ¥¹œ¡…½Õ¹Ð¹ÍÑ…ÑÕÌ¤¹Ñ½UÁÁ•É…Í” ¤€„ôô€Q%Yœ¤ì(€€€€€Ñ¡É½Ü¹•Ü½¹™±¥Ñá•ÁÑ¥½¸ 1”½µÁÑ”‰…¹…¥É”Ï¥±•Ñ¥½¹»¤‘½¥Ðƒ©ÑÉ”…Ñ¥˜¸œ¤ì(€€€ô(€€€¥˜€¡MÑÉ¥¹œ¡…½Õ¹Ð¹ÕÉÉ•¹ä¤¹Ñ½UÁÁ•É…Í” ¤€„ôôMÑÉ¥¹œ¡ÕÉÉ•¹ä¤¹Ñ½UÁÁ•É…Í” ¤¤ì(€€€€€Ñ¡É½Ü¹•Ü½¹™±¥Ñá•ÁÑ¥½¸ 1„‘•Ù¥Í”‘Ô½µÁÑ”‰…¹…¥É”‘½¥Ð½ÉÉ•ÍÁ½¹‘É”ƒ€•±±”‘ÔÑÉ…¹Í™•ÉÐ¸œ¤ì(€€€ô(€€€É•ÑÕÉ¸…½Õ¹Ðì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ…ÍÍ•ÉÑ	…¹­QÉ…¹Í…Ñ¥½¹QåÁ•MÕÁÁ½ÉÑ•¡±¥•¹ÐèA½½±±¥•¹Ð°ÑÉ…¹Í…Ñ¥½¹QåÁ”èÍÑÉ¥¹œ¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1Pa%MQL€ (€€€€€€€€M1P€Ä(€€€€€€€€I=4Á}½¹ÍÑÉ…¥¹ÐŒ(€€€€€€€€)=%8Á}±…ÍÌÐ=8Ð¹½¥€ôŒ¹½¹É•±¥(€€€€€€€€)=%8Á}¹…µ•ÍÁ…”¸=8¸¹½¥€ôÐ¹É•±¹…µ•ÍÁ…”(€€€€€€€€]!I¸¹¹ÍÁ¹…µ”€ô€ÁÕ‰±¥Œœ(€€€€€€€€€€9Ð¹É•±¹…µ”€ô€‰…¹­}ÑÉ…¹Í…Ñ¥½¹Ìœ(€€€€€€€€€€9Œ¹½¹ÑåÁ”€ô€Œœ(€€€€€€€€€€9Á}•Ñ}½¹ÍÑÉ…¥¹Ñ‘•˜¡Œ¹½¥¤%1%-€œ”œñð€Äñð€œ”œ(€€€€€€€¤LÍÕÁÁ½ÉÑ•‘€°(€€€€€mÑÉ…¹Í…Ñ¥½¹QåÁ•t°(€€€€¤ì(€€€¥˜€ …É½ÝÍlÁtü¹ÍÕÁÁ½ÉÑ•¤ì(€€€€€Ñ¡É½Ü¹•ÜM•ÉÙ¥•U¹…Ù…¥±…‰±•á•ÁÑ¥½¸ (€€€€€€€€1„µ¥É…Ñ¥½¸€ÈÀÈØÀÜÈÍ}‰…¹­}ÑÉ•…ÍÕÉå}ÑÉ…¹Í™•ÉÌ¹ÍÅ°‘½¥Ðƒ©ÑÉ”…ÁÁ±¥Å×¥”Á½ÕÈ…Ñ¥Ù•È±•ÌÑÉ…¹Í™•ÉÑÌ¥¹Ñ•É¹•Ì¸œ°(€€€€€€¤ì(€€€ô(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÉ•…Ñ•QÉ•…ÍÕÉå	…¹­QÉ…¹Í…Ñ¥½¹%¹QÉ…¹Í…Ñ¥½¸ (€€€±¥•¹ÐèA½½±±¥•¹Ð°(€€€Á…å±½…èì(€€€€€ÑÉ…¹Í™•É%è¹Õµ‰•Èì(€€€€€ÑÉ…¹Í™•É9Õµ‰•ÈèÍÑÉ¥¹œì(€€€€€ÑÉ…¹Í™•É…Ñ”èÍÑÉ¥¹œì(€€€€€‘¥É•Ñ¥½¸è€%8œð€=UPœì(€€€€€‰…¹­½Õ¹ÐèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸øì(€€€€€…µ½Õ¹Ðè¹Õµ‰•Èì(€€€€€ÕÉÉ•¹äèÍÑÉ¥¹œì(€€€€€É•™•É•¹”üèÍÑÉ¥¹œð¹Õ±°ì(€€€€€‘•ÍÉ¥ÁÑ¥½¸èÍÑÉ¥¹œì(€€€€€½Õ¹Ñ•ÉÁ…ÉÑå9…µ”èÍÑÉ¥¹œì(€€€€€¥‘•µÁ½Ñ•¹å-•äèÍÑÉ¥¹œì(€€€ô°(€€¤ì(€€€½¹ÍÐÑÉ…¹Í…Ñ¥½¹QåÁ”€ôÁ…å±½…¹‘¥É•Ñ¥½¸€ôôô€%8œ€ü€QI9MI}%8œ€è€QI9MI}=UPœì(€€€…Ý…¥ÐÑ¡¥Ì¹…ÍÍ•ÉÑ	…¹­QÉ…¹Í…Ñ¥½¹QåÁ•MÕÁÁ½ÉÑ•¡±¥•¹Ð°ÑÉ…¹Í…Ñ¥½¹QåÁ”¤ì(€€€½¹ÍÐÑÉ…¹Í…Ñ¥½¹9Õµ‰•È€ô…Ý…¥ÐÑ¡¥Ì¹¹•áÑ	…¹­QÉ…¹Í…Ñ¥½¹9Õµ‰•È¡±¥•¹Ð¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€%9MIP%9Q<‰…¹­}ÑÉ…¹Í…Ñ¥½¹Ì(€€€€€€€€¡½É…¹¥é…Ñ¥½¹}¥°‰…¹­}…½Õ¹Ñ}¥°ÑÉ…¹Í…Ñ¥½¹}¹Õµ‰•È°ÑÉ…¹Í…Ñ¥½¹}‘…Ñ”°‘¥É•Ñ¥½¸°ÑÉ…¹Í…Ñ¥½¹}ÑåÁ”°…µ½Õ¹Ð°ÕÉÉ•¹ä°(€€€€€€€€É•™•É•¹”°‘•ÍÉ¥ÁÑ¥½¸°½Õ¹Ñ•ÉÁ…ÉÑå}¹…µ”°Í½ÕÉ•}µ½‘Õ±”°Í½ÕÉ•}•¹Ñ¥Ñå}ÑåÁ”°Í½ÕÉ•}•¹Ñ¥Ñå}¥°ÍÑ…ÑÕÌ°É•Ù•ÉÍ…±}½™}¥°(€€€€€€€€¥‘•µÁ½Ñ•¹å}­•ä°É•…Ñ•‘}‰ä¤(€€€€€€Y1UL(€€€€€€€€ Ä°€È°€Ì°€Ð°€Ô°€Ø°€Ü°€à°(€€€€€€€€€ä°€ÄÀ°€ÄÄ°€QIMUIe}QI9MILœ°€QIMUIe}QI9MHœ°€ÄÈ°€Y1%Qœ°9U10°(€€€€€€€€€ÄÌ°€ÄÐ¤(€€€€€€IQUI9%9€©€°(€€€€€l(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°(€€€€€€€9Õµ‰•È¡Á…å±½…¹‰…¹­½Õ¹Ð¹¥¤°(€€€€€€€ÑÉ…¹Í…Ñ¥½¹9Õµ‰•È°(€€€€€€€Á…å±½…¹ÑÉ…¹Í™•É…Ñ”°(€€€€€€€Á…å±½…¹‘¥É•Ñ¥½¸°(€€€€€€€ÑÉ…¹Í…Ñ¥½¹QåÁ”°(€€€€€€€Á…å±½…¹…µ½Õ¹Ð°(€€€€€€€Á…å±½…¹ÕÉÉ•¹ä°(€€€€€€€Á…å±½…¹É•™•É•¹”€üüÁ…å±½…¹ÑÉ…¹Í™•É9Õµ‰•È°(€€€€€€€Á…å±½…¹‘•ÍÉ¥ÁÑ¥½¸°(€€€€€€€Á…å±½…¹½Õ¹Ñ•ÉÁ…ÉÑå9…µ”°(€€€€€€€Á…å±½…¹ÑÉ…¹Í™•É%°(€€€€€€€Á…å±½…¹¥‘•µÁ½Ñ•¹å-•ä°(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•É% ¤€üü¹Õ±°°(€€€€€t°(€€€€¤ì(€€€É•ÑÕÉ¸É•ÅÕ¥É•I½Ü¡É½ÝÍlÁt°€	…¹¬ÑÉ…¹Í…Ñ¥½¸œ¤ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÉ•…Ñ•QÉ•…ÍÕÉåQÉ…¹Í™•É%¹QÉ…¹Í…Ñ¥½¸ (€€€±¥•¹ÐèA½½±±¥•¹Ð°(€€€Í½ÕÉ•I•¥ÍÑ•Èè€5%9}M œð€	9,œ°(€€€Á…å±½…èì(€€€€€ÑÉ…¹Í™•ÉQåÁ”è€M!}Q=}	9,œð€	9-}Q=}M œð€	9-}Q=}	9,œì(€€€€€ÑÉ…¹Í™•É…Ñ”èÍÑÉ¥¹œì(€€€€€ÕÉÉ•¹äèÍÑÉ¥¹œì(€€€€€…µ½Õ¹Ðè¹Õµ‰•Èì(€€€€€Á…åµ•¹Ñ5•Ñ¡½èÍÑÉ¥¹œì(€€€€€Í½ÕÉ•	…¹­½Õ¹Ñ%è¹Õµ‰•Èð¹Õ±°ì(€€€€€‘•ÍÑ¥¹…Ñ¥½¹	…¹­½Õ¹Ñ%è¹Õµ‰•Èð¹Õ±°ì(€€€€€É•™•É•¹”èÍÑÉ¥¹œð¹Õ±°ì(€€€€€‘•ÍÉ¥ÁÑ¥½¸èÍÑÉ¥¹œð¹Õ±°ì(€€€€€¹½Ñ•ÌèÍÑÉ¥¹œð¹Õ±°ì(€€€€€¥‘•µÁ½Ñ•¹å-•äèÍÑÉ¥¹œì(€€€ô°(€€¤ì(€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä M1PÁ}…‘Ù¥Í½Éå}á…Ñ}±½¬¡¡…Í¡Ñ•áÐ Ä¤¤œ°mÑÉ•…ÍÕÉäµÑÉ…¹Í™•Èè‘íÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥ôè‘íÁ…å±½…¹¥‘•µÁ½Ñ•¹å-•åõt¤ì(€€€½¹ÍÐ•á¥ÍÑ¥¹œ€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P¥(€€€€€€I=4ÑÉ•…ÍÕÉå}ÑÉ…¹Í™•ÉÌ(€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€9¥‘•µÁ½Ñ•¹å}­•ä€ô€È(€€€€€€1%5%P€Å€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°Á…å±½…¹¥‘•µÁ½Ñ•¹å-•åt°(€€€€¤ì(€€€¥˜€¡•á¥ÍÑ¥¹œ¹É½ÝÍlÁtü¹¥¤ì(€€€€€É•ÑÕÉ¸Ñ¡¥Ì¹ÑÉ•…ÍÕÉåQÉ…¹Í™•È¡9Õµ‰•È¡•á¥ÍÑ¥¹œ¹É½ÝÍlÁt¹¥¤¤ì(€€€ô((€€€½¹ÍÐÑÉ…¹Í™•É9Õµ‰•È€ô…Ý…¥ÐÑ¡¥Ì¹¹•áÑQÉ•…ÍÕÉåQÉ…¹Í™•É9Õµ‰•È¡±¥•¹Ð¤ì(€€€½¹ÍÐ‘•ÍÉ¥ÁÑ¥½¸€ôÁ…å±½…¹‘•ÍÉ¥ÁÑ¥½¸(€€€€€ñð€ (€€€€€€€Á…å±½…¹ÑÉ…¹Í™•ÉQåÁ”€ôôô€M!}Q=}	9,œ(€€€€€€€€€€ü€¥ÃÑÐ‘”…¥ÍÍ”•¸‰…¹ÅÕ”œ(€€€€€€€€€€èÁ…å±½…¹ÑÉ…¹Í™•ÉQåÁ”€ôôô€	9-}Q=}M œ(€€€€€€€€€€€€ü€I•ÑÉ…¥Ð‰…¹…¥É”Ù•ÉÌ…¥ÍÍ”œ(€€€€€€€€€€€€è€Y¥É•µ•¹Ð•¹ÑÉ”½µÁÑ•Ì‰…¹…¥É•Ìœ(€€€€€€¤ì((€€€±•ÐÍ½ÕÉ•QåÁ”è€5%9}M œð€	9,œ€ôÁ…å±½…¹ÑÉ…¹Í™•ÉQåÁ”€ôôô€M!}Q=}	9,œ€ü€5%9}M œ€è€	9,œì(€€€±•Ð‘•ÍÑ¥¹…Ñ¥½¹QåÁ”è€5%9}M œð€	9,œ€ôÁ…å±½…¹ÑÉ…¹Í™•ÉQåÁ”€ôôô€	9-}Q=}M œ€ü€5%9}M œ€è€	9,œì(€€€±•ÐÍ½ÕÉ•…Í¡M•ÍÍ¥½¸èI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸øð¹Õ±°€ô¹Õ±°ì(€€€±•Ð‘•ÍÑ¥¹…Ñ¥½¹…Í¡M•ÍÍ¥½¸èI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸øð¹Õ±°€ô¹Õ±°ì(€€€±•ÐÍ½ÕÉ•	…¹­½Õ¹ÐèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸øð¹Õ±°€ô¹Õ±°ì(€€€±•Ð‘•ÍÑ¥¹…Ñ¥½¹	…¹­½Õ¹ÐèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸øð¹Õ±°€ô¹Õ±°ì((€€€¥˜€¡Á…å±½…¹ÑÉ…¹Í™•ÉQåÁ”€ôôô€M!}Q=}	9,œ¤ì(€€€€€Í½ÕÉ•…Í¡M•ÍÍ¥½¸€ô…Ý…¥ÐÑ¡¥Ì¹½Á•¹…Í¡M•ÍÍ¥½¹½ÉQÉ•…ÍÕÉä¡±¥•¹Ð¤ì(€€€€€½¹ÍÐÍ½ÕÉ•…Í¡M•ÍÍ¥½¹I½Ü€ôÍ½ÕÉ•…Í¡M•ÍÍ¥½¸…ÌI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸øì(€€€€€½¹ÍÐ…Í¡	…±…¹”€ô…Ý…¥ÐÑ¡¥Ì¹ÑÉ•…ÍÕÉå…Í¡	…±…¹•½ÉÕÉÉ•¹ä (€€€€€€€±¥•¹Ð°(€€€€€€€9Õµ‰•È¡Í½ÕÉ•…Í¡M•ÍÍ¥½¹I½Ü¹¥¤°(€€€€€€€Á…å±½…¹ÕÉÉ•¹ä°(€€€€€€€9Õµ‰•È¡Í½ÕÉ•…Í¡M•ÍÍ¥½¹I½Ü¹½Á•¹¥¹}‰…±…¹”€üü€À¤°(€€€€€€¤ì(€€€€€¥˜€¡Á…å±½…¹…µ½Õ¹Ð€ø…Í¡	…±…¹”€¬€À¸ÀÀÀÄ¤ì(€€€€€€€Ñ¡É½Ü¹•Ü½¹™±¥Ñá•ÁÑ¥½¸ 1”Í½±‘”‘”…¥ÍÍ”•ÍÐ¥¹ÍÕ™™¥Í…¹ÐÁ½ÕÈ”“¥ÃÑÐ•¸‰…¹ÅÕ”¸œ¤ì(€€€€€ô(€€€€€‘•ÍÑ¥¹…Ñ¥½¹	…¹­½Õ¹Ð€ô…Ý…¥ÐÑ¡¥Ì¹Ù…±¥‘…Ñ•	…¹­½Õ¹Ñ½ÉQÉ•…ÍÕÉåQÉ…¹Í™•È¡±¥•¹Ð°Á…å±½…¹‘•ÍÑ¥¹…Ñ¥½¹	…¹­½Õ¹Ñ%°Á…å±½…¹ÕÉÉ•¹ä°ìÉ½±”è€‘•ÍÑ¥¹…Ñ¥½¸œô¤ì(€€€ô•±Í”¥˜€¡Á…å±½…¹ÑÉ…¹Í™•ÉQåÁ”€ôôô€	9-}Q=}M œ¤ì(€€€€€Í½ÕÉ•	…¹­½Õ¹Ð€ô…Ý…¥ÐÑ¡¥Ì¹Ù…±¥‘…Ñ•	…¹­½Õ¹Ñ½ÉQÉ•…ÍÕÉåQÉ…¹Í™•È¡±¥•¹Ð°Á…å±½…¹Í½ÕÉ•	…¹­½Õ¹Ñ%°Á…å±½…¹ÕÉÉ•¹ä°ìÉ½±”è€Í½ÕÉ”œ°™½ÉUÁ‘…Ñ”èÑÉÕ”ô¤ì(€€€€€½¹ÍÐÍ½ÕÉ•	…¹­½Õ¹ÑI½Ü€ôÍ½ÕÉ•	…¹­½Õ¹Ð…ÌI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸øì(€€€€€¥˜€¡Á…å±½…¹…µ½Õ¹Ð€ø9Õµ‰•È¡Í½ÕÉ•	…¹­½Õ¹ÑI½Ü¹ÕÉÉ•¹Ñ}‰…±…¹”€üü€À¤€¬€À¸ÀÀÀÄ¤ì(€€€€€€€Ñ¡É½Ü¹•Ü½¹™±¥Ñá•ÁÑ¥½¸ 1”Í½±‘”‰…¹…¥É”•ÍÐ¥¹ÍÕ™™¥Í…¹ÐÁ½ÕÈ”É•ÑÉ…¥ÐÙ•ÉÌ±„…¥ÍÍ”¸œ¤ì(€€€€€ô(€€€€€‘•ÍÑ¥¹…Ñ¥½¹…Í¡M•ÍÍ¥½¸€ô…Ý…¥ÐÑ¡¥Ì¹½Á•¹…Í¡M•ÍÍ¥½¹½ÉQÉ•…ÍÕÉä¡±¥•¹Ð¤ì(€€€ô•±Í”ì(€€€€€Í½ÕÉ•	…¹­½Õ¹Ð€ô…Ý…¥ÐÑ¡¥Ì¹Ù…±¥‘…Ñ•	…¹­½Õ¹Ñ½ÉQÉ•…ÍÕÉåQÉ…¹Í™•È¡±¥•¹Ð°Á…å±½…¹Í½ÕÉ•	…¹­½Õ¹Ñ%°Á…å±½…¹ÕÉÉ•¹ä°ìÉ½±”è€Í½ÕÉ”œ°™½ÉUÁ‘…Ñ”èÑÉÕ”ô¤ì(€€€€€‘•ÍÑ¥¹…Ñ¥½¹	…¹­½Õ¹Ð€ô…Ý…¥ÐÑ¡¥Ì¹Ù…±¥‘…Ñ•	…¹­½Õ¹Ñ½ÉQÉ•…ÍÕÉåQÉ…¹Í™•È¡±¥•¹Ð°Á…å±½…¹‘•ÍÑ¥¹…Ñ¥½¹	…¹­½Õ¹Ñ%°Á…å±½…¹ÕÉÉ•¹ä°ìÉ½±”è€‘•ÍÑ¥¹…Ñ¥½¸œ°™½ÉUÁ‘…Ñ”èÑÉÕ”ô¤ì(€€€€€½¹ÍÐÍ½ÕÉ•	…¹­½Õ¹ÑI½Ü€ôÍ½ÕÉ•	…¹­½Õ¹Ð…ÌI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸øì(€€€€€½¹ÍÐ‘•ÍÑ¥¹…Ñ¥½¹	…¹­½Õ¹ÑI½Ü€ô‘•ÍÑ¥¹…Ñ¥½¹	…¹­½Õ¹Ð…ÌI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸øì(€€€€€¥˜€¡9Õµ‰•È¡Í½ÕÉ•	…¹­½Õ¹ÑI½Ü¹¥¤€ôôô9Õµ‰•È¡‘•ÍÑ¥¹…Ñ¥½¹	…¹­½Õ¹ÑI½Ü¹¥¤¤ì(€€€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1”½µÁÑ”Í½ÕÉ”•Ð±”½µÁÑ”‘•ÍÑ¥¹…Ñ¥½¸‘½¥Ù•¹Ðƒ©ÑÉ”‘¥™›¥É•¹ÑÌ¸œ¤ì(€€€€€ô(€€€€€¥˜€¡Á…å±½…¹…µ½Õ¹Ð€ø9Õµ‰•È¡Í½ÕÉ•	…¹­½Õ¹ÑI½Ü¹ÕÉÉ•¹Ñ}‰…±…¹”€üü€À¤€¬€À¸ÀÀÀÄ¤ì(€€€€€€€Ñ¡É½Ü¹•Ü½¹™±¥Ñá•ÁÑ¥½¸ 1”Í½±‘”‰…¹…¥É”‘Ô½µÁÑ”Í½ÕÉ”•ÍÐ¥¹ÍÕ™™¥Í…¹ÐÁ½ÕÈ”Ù¥É•µ•¹Ð¸œ¤ì(€€€€€ô(€€€ô((€€€½¹ÍÐ¥¹Í•ÉÑ•€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€%9MIP%9Q<ÑÉ•…ÍÕÉå}ÑÉ…¹Í™•ÉÌ(€€€€€€€€¡½É…¹¥é…Ñ¥½¹}¥°ÑÉ…¹Í™•É}¹Õµ‰•È°ÑÉ…¹Í™•É}ÑåÁ”°ÑÉ…¹Í™•É}‘…Ñ”°ÕÉÉ•¹ä°…µ½Õ¹Ð°(€€€€€€€€Í½ÕÉ•}ÑåÁ”°Í½ÕÉ•}…Í¡}Í•ÍÍ¥½¹}¥°Í½ÕÉ•}‰…¹­}…½Õ¹Ñ}¥°(€€€€€€€€‘•ÍÑ¥¹…Ñ¥½¹}ÑåÁ”°‘•ÍÑ¥¹…Ñ¥½¹}…Í¡}Í•ÍÍ¥½¹}¥°‘•ÍÑ¥¹…Ñ¥½¹}‰…¹­}…½Õ¹Ñ}¥°(€€€€€€€€Á…åµ•¹Ñ}µ•Ñ¡½°É•™•É•¹”°‘•ÍÉ¥ÁÑ¥½¸°¹½Ñ•Ì°ÍÑ…ÑÕÌ°¥‘•µÁ½Ñ•¹å}­•ä°(€€€€€€€€É•…Ñ•‘}‰ä°É•…Ñ•‘}…Ð°ÕÁ‘…Ñ•‘}…Ð°Ù…±¥‘…Ñ•‘}…Ð¤(€€€€€€Y1UL(€€€€€€€€ Ä°€È°€Ì°€Ð°€Ô°€Ø°(€€€€€€€€€Ü°€à°€ä°(€€€€€€€€€ÄÀ°€ÄÄ°€ÄÈ°(€€€€€€€€€ÄÌ°€ÄÐ°€ÄÔ°€ÄØ°€Y1%Qœ°€ÄÜ°(€€€€€€€€€Äà°9=\ ¤°9=\ ¤°9=\ ¤¤(€€€€€€IQUI9%9€©€°(€€€€€l(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°(€€€€€€€ÑÉ…¹Í™•É9Õµ‰•È°(€€€€€€€Á…å±½…¹ÑÉ…¹Í™•ÉQåÁ”°(€€€€€€€Á…å±½…¹ÑÉ…¹Í™•É…Ñ”°(€€€€€€€Á…å±½…¹ÕÉÉ•¹ä°(€€€€€€€Á…å±½…¹…µ½Õ¹Ð°(€€€€€€€Í½ÕÉ•QåÁ”°(€€€€€€€Í½ÕÉ•…Í¡M•ÍÍ¥½¸€ü9Õµ‰•È¡Í½ÕÉ•…Í¡M•ÍÍ¥½¸¹¥¤€è¹Õ±°°(€€€€€€€Í½ÕÉ•	…¹­½Õ¹Ð€ü9Õµ‰•È¡Í½ÕÉ•	…¹­½Õ¹Ð¹¥¤€è¹Õ±°°(€€€€€€€‘•ÍÑ¥¹…Ñ¥½¹QåÁ”°(€€€€€€€‘•ÍÑ¥¹…Ñ¥½¹…Í¡M•ÍÍ¥½¸€ü9Õµ‰•È¡‘•ÍÑ¥¹…Ñ¥½¹…Í¡M•ÍÍ¥½¸¹¥¤€è¹Õ±°°(€€€€€€€‘•ÍÑ¥¹…Ñ¥½¹	…¹­½Õ¹Ð€ü9Õµ‰•È¡‘•ÍÑ¥¹…Ñ¥½¹	…¹­½Õ¹Ð¹¥¤€è¹Õ±°°(€€€€€€€Á…å±½…¹Á…åµ•¹Ñ5•Ñ¡½°(€€€€€€€Á…å±½…¹É•™•É•¹”°(€€€€€€€‘•ÍÉ¥ÁÑ¥½¸°(€€€€€€€Á…å±½…¹¹½Ñ•Ì°(€€€€€€€Á…å±½…¹¥‘•µÁ½Ñ•¹å-•ä°(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•É% ¤€üü¹Õ±°°(€€€€€t°(€€€€¤ì(€€€½¹ÍÐÑÉ…¹Í™•È€ôÉ•ÅÕ¥É•I½Ü¡¥¹Í•ÉÑ•¹É½ÝÍlÁt°€QÉ•…ÍÕÉäÑÉ…¹Í™•Èœ¤ì((€€€±•ÐÍ½ÕÉ•…Í¡5½Ù•µ•¹Ñ%è¹Õµ‰•Èð¹Õ±°€ô¹Õ±°ì(€€€±•ÐÍ½ÕÉ•	…¹­QÉ…¹Í…Ñ¥½¹%è¹Õµ‰•Èð¹Õ±°€ô¹Õ±°ì(€€€±•Ð‘•ÍÑ¥¹…Ñ¥½¹…Í¡5½Ù•µ•¹Ñ%è¹Õµ‰•Èð¹Õ±°€ô¹Õ±°ì(€€€±•Ð‘•ÍÑ¥¹…Ñ¥½¹	…¹­QÉ…¹Í…Ñ¥½¹%è¹Õµ‰•Èð¹Õ±°€ô¹Õ±°ì((€€€¥˜€¡Á…å±½…¹ÑÉ…¹Í™•ÉQåÁ”€ôôô€M!}Q=}	9,œ¤ì(€€€€€½¹ÍÐÍ½ÕÉ•1…‰•°€ôÑ¡¥Ì¹ÑÉ•…ÍÕÉåMÕÁÁ½ÉÑ1…‰•°¡ìÍÕÁÁ½ÉÑQåÁ”è€5%9}M œô¤ì(€€€€€½¹ÍÐ‘•ÍÑ¥¹…Ñ¥½¹1…‰•°€ôÑ¡¥Ì¹ÑÉ•…ÍÕÉåMÕÁÁ½ÉÑ1…‰•°¡ì(€€€€€€€ÍÕÁÁ½ÉÑQåÁ”è€	9,œ°(€€€€€€€‰…¹­9…µ”è‘•ÍÑ¥¹…Ñ¥½¹	…¹­½Õ¹Ðü¹‰…¹­}¹…µ”°(€€€€€€€…½Õ¹Ñ9…µ”è‘•ÍÑ¥¹…Ñ¥½¹	…¹­½Õ¹Ðü¹…½Õ¹Ñ}¹…µ”°(€€€€€ô¤ì(€€€€€½¹ÍÐ…Í¡5½Ù•µ•¹Ð€ô…Ý…¥ÐÑ¡¥Ì¹É•…Ñ•…Í¡5½Ù•µ•¹Ñ%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹Ð°ì(€€€€€€€ÑåÁ”è€=UPœ°(€€€€€€€…Ñ•½Éäè€	9-}A=M%Pœ°(€€€€€€€±…‰•°è€¥ÃÑÐ•¸‰…¹ÅÕ”œ°(€€€€€€€…µ½Õ¹ÐèÁ…å±½…¹…µ½Õ¹Ð°(€€€€€€€µ½Ù•µ•¹Ñ}‘…Ñ”èÁ…å±½…¹ÑÉ…¹Í™•É…Ñ”°(€€€€€€€‘•ÍÉ¥ÁÑ¥½¸°(€€€€€€€É•™•É•¹”èÁ…å±½…¹É•™•É•¹”€üüÑÉ…¹Í™•È¹ÑÉ…¹Í™•É}¹Õµ‰•È°(€€€€€€€ÕÉÉ•¹äèÁ…å±½…¹ÕÉÉ•¹ä°(€€€€€€€ÍÕÁÁ±¥•Èè‘•ÍÑ¥¹…Ñ¥½¹1…‰•°°(€€€€€€€ÑÉ•…ÍÕÉå}ÑÉ…¹Í™•É}¥èÑÉ…¹Í™•È¹¥°(€€€€€ô¤ì(€€€€€Í½ÕÉ•…Í¡5½Ù•µ•¹Ñ%€ô9Õµ‰•È¡…Í¡5½Ù•µ•¹Ð¹¥¤ì(€€€€€½¹ÍÐ‰…¹­QÉ…¹Í…Ñ¥½¸€ô…Ý…¥ÐÑ¡¥Ì¹É•…Ñ•QÉ•…ÍÕÉå	…¹­QÉ…¹Í…Ñ¥½¹%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹Ð°ì(€€€€€€€ÑÉ…¹Í™•É%è9Õµ‰•È¡ÑÉ…¹Í™•È¹¥¤°(€€€€€€€ÑÉ…¹Í™•É9Õµ‰•ÈèMÑÉ¥¹œ¡ÑÉ…¹Í™•È¹ÑÉ…¹Í™•É}¹Õµ‰•È¤°(€€€€€€€ÑÉ…¹Í™•É…Ñ”èÁ…å±½…¹ÑÉ…¹Í™•É…Ñ”°(€€€€€€€‘¥É•Ñ¥½¸è€%8œ°(€€€€€€€‰…¹­½Õ¹Ðè‘•ÍÑ¥¹…Ñ¥½¹	…¹­½Õ¹Ð…ÌI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø°(€€€€€€€…µ½Õ¹ÐèÁ…å±½…¹…µ½Õ¹Ð°(€€€€€€€ÕÉÉ•¹äèÁ…å±½…¹ÕÉÉ•¹ä°(€€€€€€€É•™•É•¹”èÁ…å±½…¹É•™•É•¹”°(€€€€€€€‘•ÍÉ¥ÁÑ¥½¸è€¥ÃÑÐ‘”…¥ÍÍ”•¸‰…¹ÅÕ”œ°(€€€€€€€½Õ¹Ñ•ÉÁ…ÉÑå9…µ”èÍ½ÕÉ•1…‰•°°(€€€€€€€¥‘•µÁ½Ñ•¹å-•äè€‘íÁ…å±½…¹¥‘•µÁ½Ñ•¹å-•åôé‰…¹¬µ¥¹€°(€€€€€ô¤ì(€€€€€‘•ÍÑ¥¹…Ñ¥½¹	…¹­QÉ…¹Í…Ñ¥½¹%€ô9Õµ‰•È¡‰…¹­QÉ…¹Í…Ñ¥½¸¹¥¤ì(€€€ô•±Í”¥˜€¡Á…å±½…¹ÑÉ…¹Í™•ÉQåÁ”€ôôô€	9-}Q=}M œ¤ì(€€€€€½¹ÍÐÍ½ÕÉ•1…‰•°€ôÑ¡¥Ì¹ÑÉ•…ÍÕÉåMÕÁÁ½ÉÑ1…‰•°¡ì(€€€€€€€ÍÕÁÁ½ÉÑQåÁ”è€	9,œ°(€€€€€€€‰…¹­9…µ”èÍ½ÕÉ•	…¹­½Õ¹Ðü¹‰…¹­}¹…µ”°(€€€€€€€…½Õ¹Ñ9…µ”èÍ½ÕÉ•	…¹­½Õ¹Ðü¹…½Õ¹Ñ}¹…µ”°(€€€€€ô¤ì(€€€€€½¹ÍÐ‘•ÍÑ¥¹…Ñ¥½¹1…‰•°€ôÑ¡¥Ì¹ÑÉ•…ÍÕÉåMÕÁÁ½ÉÑ1…‰•°¡ìÍÕÁÁ½ÉÑQåÁ”è€5%9}M œô¤ì(€€€€€½¹ÍÐ‰…¹­QÉ…¹Í…Ñ¥½¸€ô…Ý…¥ÐÑ¡¥Ì¹É•…Ñ•QÉ•…ÍÕÉå	…¹­QÉ…¹Í…Ñ¥½¹%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹Ð°ì(€€€€€€€ÑÉ…¹Í™•É%è9Õµ‰•È¡ÑÉ…¹Í™•È¹¥¤°(€€€€€€€ÑÉ…¹Í™•É9Õµ‰•ÈèMÑÉ¥¹œ¡ÑÉ…¹Í™•È¹ÑÉ…¹Í™•É}¹Õµ‰•È¤°(€€€€€€€ÑÉ…¹Í™•É…Ñ”èÁ…å±½…¹ÑÉ…¹Í™•É…Ñ”°(€€€€€€€‘¥É•Ñ¥½¸è€=UPœ°(€€€€€€€‰…¹­½Õ¹ÐèÍ½ÕÉ•	…¹­½Õ¹Ð…ÌI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø°(€€€€€€€…µ½Õ¹ÐèÁ…å±½…¹…µ½Õ¹Ð°(€€€€€€€ÕÉÉ•¹äèÁ…å±½…¹ÕÉÉ•¹ä°(€€€€€€€É•™•É•¹”èÁ…å±½…¹É•™•É•¹”°(€€€€€€€‘•ÍÉ¥ÁÑ¥½¸è€I•ÑÉ…¥Ð‰…¹…¥É”Ù•ÉÌ…¥ÍÍ”œ°(€€€€€€€½Õ¹Ñ•ÉÁ…ÉÑå9…µ”è‘•ÍÑ¥¹…Ñ¥½¹1…‰•°°(€€€€€€€¥‘•µÁ½Ñ•¹å-•äè€‘íÁ…å±½…¹¥‘•µÁ½Ñ•¹å-•åôé‰…¹¬µ½ÕÑ€°(€€€€€ô¤ì(€€€€€Í½ÕÉ•	…¹­QÉ…¹Í…Ñ¥½¹%€ô9Õµ‰•È¡‰…¹­QÉ…¹Í…Ñ¥½¸¹¥¤ì(€€€€€½¹ÍÐ…Í¡5½Ù•µ•¹Ð€ô…Ý…¥ÐÑ¡¥Ì¹É•…Ñ•…Í¡5½Ù•µ•¹Ñ%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹Ð°ì(€€€€€€€ÑåÁ”è€%8œ°(€€€€€€€…Ñ•½Éäè€	9-}]%Q!I]0œ°(€€€€€€€±…‰•°è€I•ÑÉ…¥Ð‰…¹…¥É”É—Ôœ°(€€€€€€€…µ½Õ¹ÐèÁ…å±½…¹…µ½Õ¹Ð°(€€€€€€€µ½Ù•µ•¹Ñ}‘…Ñ”èÁ…å±½…¹ÑÉ…¹Í™•É…Ñ”°(€€€€€€€‘•ÍÉ¥ÁÑ¥½¸°(€€€€€€€É•™•É•¹”èÁ…å±½…¹É•™•É•¹”€üüÑÉ…¹Í™•È¹ÑÉ…¹Í™•É}¹Õµ‰•È°(€€€€€€€ÕÉÉ•¹äèÁ…å±½…¹ÕÉÉ•¹ä°(€€€€€€€ÍÕÁÁ±¥•ÈèÍ½ÕÉ•1…‰•°°(€€€€€€€ÑÉ•…ÍÕÉå}ÑÉ…¹Í™•É}¥èÑÉ…¹Í™•È¹¥°(€€€€€ô¤ì(€€€€€‘•ÍÑ¥¹…Ñ¥½¹…Í¡5½Ù•µ•¹Ñ%€ô9Õµ‰•È¡…Í¡5½Ù•µ•¹Ð¹¥¤ì(€€€ô•±Í”ì(€€€€€½¹ÍÐÍ½ÕÉ•1…‰•°€ôÑ¡¥Ì¹ÑÉ•…ÍÕÉåMÕÁÁ½ÉÑ1…‰•°¡ì(€€€€€€€ÍÕÁÁ½ÉÑQåÁ”è€	9,œ°(€€€€€€€‰…¹­9…µ”èÍ½ÕÉ•	…¹­½Õ¹Ðü¹‰…¹­}¹…µ”°(€€€€€€€…½Õ¹Ñ9…µ”èÍ½ÕÉ•	…¹­½Õ¹Ðü¹…½Õ¹Ñ}¹…µ”°(€€€€€ô¤ì(€€€€€½¹ÍÐ‘•ÍÑ¥¹…Ñ¥½¹1…‰•°€ôÑ¡¥Ì¹ÑÉ•…ÍÕÉåMÕÁÁ½ÉÑ1…‰•°¡ì(€€€€€€€ÍÕÁÁ½ÉÑQåÁ”è€	9,œ°(€€€€€€€‰…¹­9…µ”è‘•ÍÑ¥¹…Ñ¥½¹	…¹­½Õ¹Ðü¹‰…¹­}¹…µ”°(€€€€€€€…½Õ¹Ñ9…µ”è‘•ÍÑ¥¹…Ñ¥½¹	…¹­½Õ¹Ðü¹…½Õ¹Ñ}¹…µ”°(€€€€€ô¤ì(€€€€€½¹ÍÐÍ½ÕÉ•QÉ…¹Í…Ñ¥½¸€ô…Ý…¥ÐÑ¡¥Ì¹É•…Ñ•QÉ•…ÍÕÉå	…¹­QÉ…¹Í…Ñ¥½¹%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹Ð°ì(€€€€€€€ÑÉ…¹Í™•É%è9Õµ‰•È¡ÑÉ…¹Í™•È¹¥¤°(€€€€€€€ÑÉ…¹Í™•É9Õµ‰•ÈèMÑÉ¥¹œ¡ÑÉ…¹Í™•È¹ÑÉ…¹Í™•É}¹Õµ‰•È¤°(€€€€€€€ÑÉ…¹Í™•É…Ñ”èÁ…å±½…¹ÑÉ…¹Í™•É…Ñ”°(€€€€€€€‘¥É•Ñ¥½¸è€=UPœ°(€€€€€€€‰…¹­½Õ¹ÐèÍ½ÕÉ•	…¹­½Õ¹Ð…ÌI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø°(€€€€€€€…µ½Õ¹ÐèÁ…å±½…¹…µ½Õ¹Ð°(€€€€€€€ÕÉÉ•¹äèÁ…å±½…¹ÕÉÉ•¹ä°(€€€€€€€É•™•É•¹”èÁ…å±½…¹É•™•É•¹”°(€€€€€€€‘•ÍÉ¥ÁÑ¥½¸è€Y¥É•µ•¹Ð•¹ÑÉ”½µÁÑ•Ì‰…¹…¥É•Ìœ°(€€€€€€€½Õ¹Ñ•ÉÁ…ÉÑå9…µ”è‘•ÍÑ¥¹…Ñ¥½¹1…‰•°°(€€€€€€€¥‘•µÁ½Ñ•¹å-•äè€‘íÁ…å±½…¹¥‘•µÁ½Ñ•¹å-•åôéÍ½ÕÉ•€°(€€€€€ô¤ì(€€€€€Í½ÕÉ•	…¹­QÉ…¹Í…Ñ¥½¹%€ô9Õµ‰•È¡Í½ÕÉ•QÉ…¹Í…Ñ¥½¸¹¥¤ì(€€€€€½¹ÍÐ‘•ÍÑ¥¹…Ñ¥½¹QÉ…¹Í…Ñ¥½¸€ô…Ý…¥ÐÑ¡¥Ì¹É•…Ñ•QÉ•…ÍÕÉå	…¹­QÉ…¹Í…Ñ¥½¹%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹Ð°ì(€€€€€€€ÑÉ…¹Í™•É%è9Õµ‰•È¡ÑÉ…¹Í™•È¹¥¤°(€€€€€€€ÑÉ…¹Í™•É9Õµ‰•ÈèMÑÉ¥¹œ¡ÑÉ…¹Í™•È¹ÑÉ…¹Í™•É}¹Õµ‰•È¤°(€€€€€€€ÑÉ…¹Í™•É…Ñ”èÁ…å±½…¹ÑÉ…¹Í™•É…Ñ”°(€€€€€€€‘¥É•Ñ¥½¸è€%8œ°(€€€€€€€‰…¹­½Õ¹Ðè‘•ÍÑ¥¹…Ñ¥½¹	…¹­½Õ¹Ð…ÌI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø°(€€€€€€€…µ½Õ¹ÐèÁ…å±½…¹…µ½Õ¹Ð°(€€€€€€€ÕÉÉ•¹äèÁ…å±½…¹ÕÉÉ•¹ä°(€€€€€€€É•™•É•¹”èÁ…å±½…¹É•™•É•¹”°(€€€€€€€‘•ÍÉ¥ÁÑ¥½¸è€Y¥É•µ•¹Ð•¹ÑÉ”½µÁÑ•Ì‰…¹…¥É•Ìœ°(€€€€€€€½Õ¹Ñ•ÉÁ…ÉÑå9…µ”èÍ½ÕÉ•1…‰•°°(€€€€€€€¥‘•µÁ½Ñ•¹å-•äè€‘íÁ…å±½…¹¥‘•µÁ½Ñ•¹å-•åôé‘•ÍÑ¥¹…Ñ¥½¹€°(€€€€€ô¤ì(€€€€€‘•ÍÑ¥¹…Ñ¥½¹	…¹­QÉ…¹Í…Ñ¥½¹%€ô9Õµ‰•È¡‘•ÍÑ¥¹…Ñ¥½¹QÉ…¹Í…Ñ¥½¸¹¥¤ì(€€€ô((€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€UAQÑÉ•…ÍÕÉå}ÑÉ…¹Í™•ÉÌ(€€€€€€MPÍ½ÕÉ•}…Í¡}µ½Ù•µ•¹Ñ}¥€ô€È°(€€€€€€€€€€Í½ÕÉ•}‰…¹­}ÑÉ…¹Í…Ñ¥½¹}¥€ô€Ì°(€€€€€€€€€€‘•ÍÑ¥¹…Ñ¥½¹}…Í¡}µ½Ù•µ•¹Ñ}¥€ô€Ð°(€€€€€€€€€€‘•ÍÑ¥¹…Ñ¥½¹}‰…¹­}ÑÉ…¹Í…Ñ¥½¹}¥€ô€Ô°(€€€€€€€€€€ÕÁ‘…Ñ•‘}…Ð€ô9=\ ¤(€€€€€€]!I¥€ô€Ä(€€€€€€€€9½É…¹¥é…Ñ¥½¹}¥€ô€Ù€°(€€€€€l(€€€€€€€ÑÉ…¹Í™•È¹¥°(€€€€€€€Í½ÕÉ•…Í¡5½Ù•µ•¹Ñ%°(€€€€€€€Í½ÕÉ•	…¹­QÉ…¹Í…Ñ¥½¹%°(€€€€€€€‘•ÍÑ¥¹…Ñ¥½¹…Í¡5½Ù•µ•¹Ñ%°(€€€€€€€‘•ÍÑ¥¹…Ñ¥½¹	…¹­QÉ…¹Í…Ñ¥½¹%°(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°(€€€€€t°(€€€€¤ì((€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€%9MIP%9Q<…Õ‘¥Ñ}±½Ì€¡½É…¹¥é…Ñ¥½¹}¥°ÕÍ•É}¥°…Ñ¥½¸°É•Í½ÕÉ”°É•Í½ÕÉ•}¥°µ•Ñ¡½°Á…Ñ °ÍÑ…ÑÕÍ}½‘”°µ•Ñ…‘…Ñ„¤(€€€€€€Y1UL€ Ä°€È°€QIMUIe}QI9MI}Y1%Qœ°€ÑÉ•…ÍÕÉå}ÑÉ…¹Í™•ÉÌœ°€Ì°€A=MPœ°€Ð°€ÈÀÄ°€Ôèé)M=9¥€°(€€€€€l(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•É% ¤€üü¹Õ±°°(€€€€€€€MÑÉ¥¹œ¡ÑÉ…¹Í™•È¹¥¤°(€€€€€€€Í½ÕÉ•I•¥ÍÑ•È€ôôô€5%9}M œ€ü€œ½…Á¤½…Í ½ÑÉ•…ÍÕÉäµÑÉ…¹Í™•ÉÌœ€è€œ½…Á¤½‰…¹¬½ÑÉ•…ÍÕÉäµÑÉ…¹Í™•ÉÌœ°(€€€€€€€)M=8¹ÍÑÉ¥¹¥™ä¡ì(€€€€€€€€€ÑÉ…¹Í™•É}¥èÑÉ…¹Í™•È¹¥°(€€€€€€€€€ÑÉ…¹Í™•É}¹Õµ‰•ÈèÑÉ…¹Í™•È¹ÑÉ…¹Í™•É}¹Õµ‰•È°(€€€€€€€€€ÑÉ…¹Í™•É}ÑåÁ”èÑÉ…¹Í™•È¹ÑÉ…¹Í™•É}ÑåÁ”°(€€€€€€€€€ÑÉ…¹Í™•É}‘…Ñ”èÑÉ…¹Í™•È¹ÑÉ…¹Í™•É}‘…Ñ”°(€€€€€€€€€…µ½Õ¹ÐèÁ…å±½…¹…µ½Õ¹Ð°(€€€€€€€€€ÕÉÉ•¹äèÁ…å±½…¹ÕÉÉ•¹ä°(€€€€€€€€€Í½ÕÉ•}ÑåÁ”èÍ½ÕÉ•QåÁ”°(€€€€€€€€€‘•ÍÑ¥¹…Ñ¥½¹}ÑåÁ”è‘•ÍÑ¥¹…Ñ¥½¹QåÁ”°(€€€€€€€€€Í½ÕÉ•}…Í¡}µ½Ù•µ•¹Ñ}¥èÍ½ÕÉ•…Í¡5½Ù•µ•¹Ñ%°(€€€€€€€€€Í½ÕÉ•}‰…¹­}ÑÉ…¹Í…Ñ¥½¹}¥èÍ½ÕÉ•	…¹­QÉ…¹Í…Ñ¥½¹%°(€€€€€€€€€‘•ÍÑ¥¹…Ñ¥½¹}…Í¡}µ½Ù•µ•¹Ñ}¥è‘•ÍÑ¥¹…Ñ¥½¹…Í¡5½Ù•µ•¹Ñ%°(€€€€€€€€€‘•ÍÑ¥¹…Ñ¥½¹}‰…¹­}ÑÉ…¹Í…Ñ¥½¹}¥è‘•ÍÑ¥¹…Ñ¥½¹	…¹­QÉ…¹Í…Ñ¥½¹%°(€€€€€€€ô¤°(€€€€€t°(€€€€¤ì((€€€É•ÑÕÉ¸Ñ¡¥Ì¹ÑÉ•…ÍÕÉåQÉ…¹Í™•É	åá•ÕÑ½È¡±¥•¹Ð°9Õµ‰•È¡ÑÉ…¹Í™•È¹¥¤¤ì(€ô((€ÁÉ¥Ù…Ñ”ÑÉ•…ÍÕÉåMÕÁÁ½ÉÑ1…‰•°¡Á…å±½…èìÍÕÁÁ½ÉÑQåÁ”èÍÑÉ¥¹œì‰…¹­9…µ”üèÕ¹­¹½Ý¸ì…½Õ¹Ñ9…µ”üèÕ¹­¹½Ý¸ô¤ì(€€€¥˜€¡MÑÉ¥¹œ¡Á…å±½…¹ÍÕÁÁ½ÉÑQåÁ”¤¹Ñ½UÁÁ•É…Í” ¤€ôôô€5%9}M œ¤ì(€€€€€É•ÑÕÉ¸€…¥ÍÍ”ÁÉ¥¹¥Á…±”œì(€€€ô(€€€½¹ÍÐ‰…¹­9…µ”€ôMÑÉ¥¹œ¡Á…å±½…¹‰…¹­9…µ”€üü€œœ¤¹ÑÉ¥´ ¤ì(€€€½¹ÍÐ…½Õ¹Ñ9…µ”€ôMÑÉ¥¹œ¡Á…å±½…¹…½Õ¹Ñ9…µ”€üü€œœ¤¹ÑÉ¥´ ¤ì(€€€É•ÑÕÉ¸m‰…¹­9…µ”°…½Õ¹Ñ9…µ•t¹™¥±Ñ•È¡	½½±•…¸¤¹©½¥¸ œ€´€œ¤ñð€½µÁÑ”‰…¹…¥É”œì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÙ…±¥‘…Ñ•	…¹­½Õ¹Ñ½ÉM¡…É•¡½±‘•ÉA…å½ÕÐ¡±¥•¹ÐèA½½±±¥•¹Ð°‰…¹­½Õ¹Ñ%è¹Õµ‰•ÈðÕ¹‘•™¥¹•°ÕÉÉ•¹äèÍÑÉ¥¹œ¤ì(€€€½¹ÍÐ…½Õ¹Ñ%€ô9Õµ‰•È¡‰…¹­½Õ¹Ñ%€üü€À¤ì(€€€¥˜€ ……½Õ¹Ñ%¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ U¸½µÁÑ”‰…¹…¥É”•ÍÐÉ•ÅÕ¥ÌÁ½ÕÈÕ¸É•µ‰½ÕÉÍ•µ•¹Ð…Ñ¥½¹¹…¥É”Á…È‰…¹ÅÕ”¸œ¤ì(€€€ô(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P‰„¸¨°(€€€€€€€€€€€€€=1M¡Ñà¹ÕÉÉ•¹Ñ}‰…±…¹”°€À¤èé9U5I% ÄÐ°È¤LÕÉÉ•¹Ñ}‰…±…¹”(€€€€€€I=4‰…¹­}…½Õ¹ÑÌ‰„(€€€€€€1P)=%8€ (€€€€€€€€M1P‰Ð¹‰…¹­}…½Õ¹Ñ}¥°(€€€€€€€€€€€€€€€MU4¡M]!8‰Ð¹ÍÑ…ÑÕÌ€ô€Y1%Qœ9‰Ð¹‘¥É•Ñ¥½¸€ô€%8œQ!8‰Ð¹…µ½Õ¹Ð1M€µ‰Ð¹…µ½Õ¹Ð9¤LÕÉÉ•¹Ñ}‰…±…¹”(€€€€€€€€I=4‰…¹­}ÑÉ…¹Í…Ñ¥½¹Ì‰Ð(€€€€€€€€]!I‰Ð¹½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€I=U@	d‰Ð¹‰…¹­}…½Õ¹Ñ}¥(€€€€€€€¤Ñà=8Ñà¹‰…¹­}…½Õ¹Ñ}¥€ô‰„¹¥(€€€€€€]!I‰„¹¥€ô€È(€€€€€€€€9‰„¹½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€9‰„¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€=HUAQ€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°…½Õ¹Ñ%‘t°(€€€€¤ì(€€€½¹ÍÐ…½Õ¹Ð€ôÉ½ÝÍlÁtì(€€€¥˜€ ……½Õ¹Ð¤ì(€€€€€Ñ¡É½Ü¹•Ü9½Ñ½Õ¹‘á•ÁÑ¥½¸ ½µÁÑ”‰…¹…¥É”¥¹ÑÉ½ÕÙ…‰±”‘…¹Ì•ÑÑ”½É…¹¥Í…Ñ¥½¸¸œ¤ì(€€€ô(€€€¥˜€¡MÑÉ¥¹œ¡…½Õ¹Ð¹ÍÑ…ÑÕÌ¤¹Ñ½UÁÁ•É…Í” ¤€„ôô€Q%Yœ¤ì(€€€€€Ñ¡É½Ü¹•Ü½¹™±¥Ñá•ÁÑ¥½¸ 1”½µÁÑ”‰…¹…¥É”Í•±•Ñ¥½¹¹”‘½¥Ð•ÑÉ”…Ñ¥˜¸œ¤ì(€€€ô(€€€¥˜€¡MÑÉ¥¹œ¡…½Õ¹Ð¹ÕÉÉ•¹ä¤¹Ñ½UÁÁ•É…Í” ¤€„ôôMÑÉ¥¹œ¡ÕÉÉ•¹ä¤¹Ñ½UÁÁ•É…Í” ¤¤ì(€€€€€Ñ¡É½Ü¹•Ü½¹™±¥Ñá•ÁÑ¥½¸ 1„‘•Ù¥Í”‘Ô½µÁÑ”‰…¹…¥É”‘½¥Ð½ÉÉ•ÍÁ½¹‘É”„•±±”‘Ô±½Ð…Ñ¥½¹¹…¥É”¸œ¤ì(€€€ô(€€€É•ÑÕÉ¸…½Õ¹Ðì(€ô((€ÁÉ¥Ù…Ñ”¹½Éµ…±¥é•M¡…É•¡½±‘•ÉA…å±½…¡‰½‘äèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø¤ì(€€€½¹ÍÐÍ¡…É•¡½±‘•ÉQåÁ”€ôMÑÉ¥¹œ¡‰½‘ä¹Í¡…É•¡½±‘•É}ÑåÁ”€üü€%9%Y%U0œ¤¹Ñ½UÁÁ•É…Í” ¤ì(€€€¥˜€ …l%9%Y%U0œ°€=5A9dt¹¥¹±Õ‘•Ì¡Í¡…É•¡½±‘•ÉQåÁ”¤¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ QåÁ”…Ñ¥½¹¹…¥É”¥¹Ù…±¥‘”¸œ¤ì(€€€ô(€€€½¹ÍÐÍÑ…ÑÕÌ€ôMÑÉ¥¹œ¡‰½‘ä¹ÍÑ…ÑÕÌ€üü€Q%Yœ¤¹Ñ½UÁÁ•É…Í” ¤ì(€€€¥˜€ …lQ%Yœ°€%9Q%Yœ°€I!%Yt¹¥¹±Õ‘•Ì¡ÍÑ…ÑÕÌ¤¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ MÑ…ÑÕÐ…Ñ¥½¹¹…¥É”¥¹Ù…±¥‘”¸œ¤ì(€€€ô(€€€½¹ÍÐ™¥ÉÍÑ9…µ”€ôMÑÉ¥¹œ¡‰½‘ä¹™¥ÉÍÑ}¹…µ”€üü€œœ¤¹ÑÉ¥´ ¤ñð¹Õ±°ì(€€€½¹ÍÐ±…ÍÑ9…µ”€ôMÑÉ¥¹œ¡‰½‘ä¹±…ÍÑ}¹…µ”€üü€œœ¤¹ÑÉ¥´ ¤ñð¹Õ±°ì(€€€½¹ÍÐ½µÁ…¹å9…µ”€ôMÑÉ¥¹œ¡‰½‘ä¹½µÁ…¹å}¹…µ”€üü€œœ¤¹ÑÉ¥´ ¤ñð¹Õ±°ì(€€€½¹ÍÐ‘¥ÍÁ±…å9…µ”€ôMÑÉ¥¹œ (€€€€€‰½‘ä¹‘¥ÍÁ±…å}¹…µ”(€€€€€€üü€¡Í¡…É•¡½±‘•ÉQåÁ”€ôôô€=5A9dœ(€€€€€€€€ü½µÁ…¹å9…µ”(€€€€€€€€èm™¥ÉÍÑ9…µ”°±…ÍÑ9…µ•t¹™¥±Ñ•È¡	½½±•…¸¤¹©½¥¸ œ€œ¤¤°(€€€€¤¹ÑÉ¥´ ¤ì(€€€¥˜€ …‘¥ÍÁ±…å9…µ”¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1”¹½´…™™¥£¤‘”°…Ñ¥½¹¹…¥É”•ÍÐ½‰±¥…Ñ½¥É”¸œ¤ì(€€€ô(€€€½¹ÍÐ½Ý¹•ÉÍ¡¥ÁA•É•¹Ñ…”€ô‰½‘ä¹½Ý¹•ÉÍ¡¥Á}Á•É•¹Ñ…”€ôôô€œœñð‰½‘ä¹½Ý¹•ÉÍ¡¥Á}Á•É•¹Ñ…”€ôôôÕ¹‘•™¥¹•ñð‰½‘ä¹½Ý¹•ÉÍ¡¥Á}Á•É•¹Ñ…”€ôôô¹Õ±°(€€€€€€ü¹Õ±°(€€€€€€è9Õµ‰•È¡‰½‘ä¹½Ý¹•ÉÍ¡¥Á}Á•É•¹Ñ…”¤ì(€€€¥˜€¡½Ý¹•ÉÍ¡¥ÁA•É•¹Ñ…”€„ôô¹Õ±°€˜˜€ …9Õµ‰•È¹¥Í¥¹¥Ñ”¡½Ý¹•ÉÍ¡¥ÁA•É•¹Ñ…”¤ñð½Ý¹•ÉÍ¡¥ÁA•É•¹Ñ…”€ð€Àñð½Ý¹•ÉÍ¡¥ÁA•É•¹Ñ…”€ø€ÄÀÀ¤¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1”Á½ÕÉ•¹Ñ…”‘”“¥Ñ•¹Ñ¥½¸‘½¥Ðƒ©ÑÉ”½µÁÉ¥Ì•¹ÑÉ”€À•Ð€ÄÀÀ¸œ¤ì(€€€ô(€€€É•ÑÕÉ¸ì(€€€€€Í¡…É•¡½±‘•É}ÑåÁ”èÍ¡…É•¡½±‘•ÉQåÁ”°(€€€€€‘¥ÍÁ±…å}¹…µ”è‘¥ÍÁ±…å9…µ”°(€€€€€™¥ÉÍÑ}¹…µ”è™¥ÉÍÑ9…µ”°(€€€€€±…ÍÑ}¹…µ”è±…ÍÑ9…µ”°(€€€€€½µÁ…¹å}¹…µ”è½µÁ…¹å9…µ”°(€€€€€Á¡½¹”èMÑÉ¥¹œ¡‰½‘ä¹Á¡½¹”€üü€œœ¤¹ÑÉ¥´ ¤ñð¹Õ±°°(€€€€€•µ…¥°èMÑÉ¥¹œ¡‰½‘ä¹•µ…¥°€üü€œœ¤¹ÑÉ¥´ ¤ñð¹Õ±°°(€€€€€¥‘•¹Ñ¥Ñå}¹Õµ‰•ÈèMÑÉ¥¹œ¡‰½‘ä¹¥‘•¹Ñ¥Ñå}¹Õµ‰•È€üü€œœ¤¹ÑÉ¥´ ¤ñð¹Õ±°°(€€€€€…‘‘É•ÍÌèMÑÉ¥¹œ¡‰½‘ä¹…‘‘É•ÍÌ€üü€œœ¤¹ÑÉ¥´ ¤ñð¹Õ±°°(€€€€€½Ý¹•ÉÍ¡¥Á}Á•É•¹Ñ…”è½Ý¹•ÉÍ¡¥ÁA•É•¹Ñ…”°(€€€€€¹½Ñ•ÌèMÑÉ¥¹œ¡‰½‘ä¹¹½Ñ•Ì€üü€œœ¤¹ÑÉ¥´ ¤ñð¹Õ±°°(€€€€€ÍÑ…ÑÕÌ°(€€€ôì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÍ¡…É•¡½±‘•É5…¥¹…Í¡	…±…¹•Ì ¤ì(€€€½¹ÍÐÍ•ÍÍ¥½¸€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1P¥°½Á•¹¥¹}‰…±…¹”(€€€€€€I=4…Í¡}Í•ÍÍ¥½¹Ì(€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€9ÍÑ…ÑÕÌ€ô€=A8œ(€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U10(€€€€€€=IH	d½Á•¹•‘}…ÐM(€€€€€€1%5%P€Å€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€½¹ÍÐ½Á•¹M•ÍÍ¥½¸€ôÍ•ÍÍ¥½¸¹É½ÝÍlÁtì(€€€½¹ÍÐ‰…±…¹•ÌèI•½ÉñÍÑÉ¥¹œ°¹Õµ‰•Èø€ôìUMè€À°è€Àôì(€€€¥˜€ …½Á•¹M•ÍÍ¥½¸¤É•ÑÕÉ¸‰…±…¹•Ìì(€€€½¹ÍÐÑ½Ñ…±Ì€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1P=1M¡ÕÉÉ•¹ä°€UMœ¤LÕÉÉ•¹ä°(€€€€€€€€€€€€€=1M¡MU4¡M]!8ÑåÁ”€ô€%8œQ!8…µ½Õ¹Ð1M€µ…µ½Õ¹Ð9¤°€À¤èé9U5I% ÄÐ°È¤L‰…±…¹”(€€€€€€I=4…Í¡}µ½Ù•µ•¹ÑÌ(€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€9…Í¡}Í•ÍÍ¥½¹}¥€ô€È(€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€9…Ñ•½Éä9=P%8€ 1M}UI9Qœ°€1M}UI9Q}IU9œ¤(€€€€€€I=U@	d=1M¡ÕÉÉ•¹ä°€UMœ¥€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°½Á•¹M•ÍÍ¥½¸¹¥‘t°(€€€€¤ì(€€€‰…±…¹•Ì¹UM€ô9Õµ‰•È¡½Á•¹M•ÍÍ¥½¸¹½Á•¹¥¹}‰…±…¹”€üü€À¤ì(€€€™½È€¡½¹ÍÐÉ½Ü½˜Ñ½Ñ…±Ì¹É½ÝÌ¤ì(€€€€€½¹ÍÐÕÉÉ•¹ä€ôMÑÉ¥¹œ¡É½Ü¹ÕÉÉ•¹ä€üü€UMœ¤¹Ñ½UÁÁ•É…Í” ¤ì(€€€€€‰…±…¹•ÍmÕÉÉ•¹åt€ô9Õµ‰•È ¡‰…±…¹•ÍmÕÉÉ•¹åt€üü€À¤€¬9Õµ‰•È¡É½Ü¹‰…±…¹”€üü€À¤¤ì(€€€ô(€€€É•ÑÕÉ¸‰…±…¹•Ìì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÍ¡…É•¡½±‘•ÉÕ…É…¹Ñ••…Í¡	…±…¹•Ì ¤ì(€€€…Ý…¥ÐÑ¡¥Ì¹•¹ÍÕÉ•Õ…É…¹Ñ••…Í¡M¡•µ„ ¤ì(€€€½¹ÍÐÑ½Ñ…±Ì€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1PÕÉÉ•¹ä°(€€€€€€€€€€€€€=1M¡MU4¡M]!8ÑåÁ”€ô€%8œQ!8…µ½Õ¹Ð1M€µ…µ½Õ¹Ð9¤°€À¤èé9U5I% ÄÐ°È¤L‰…±…¹”(€€€€€€I=4Õ…É…¹Ñ••}…Í¡}µ½Ù•µ•¹ÑÌ(€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U10(€€€€€€I=U@	dÕÉÉ•¹å€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€½¹ÍÐ‰…±…¹•ÌèI•½ÉñÍÑÉ¥¹œ°¹Õµ‰•Èø€ôìUMè€À°è€Àôì(€€€™½È€¡½¹ÍÐÉ½Ü½˜Ñ½Ñ…±Ì¹É½ÝÌ¤ì(€€€€€‰…±…¹•ÍmMÑÉ¥¹œ¡É½Ü¹ÕÉÉ•¹ä€üü€UMœ¤¹Ñ½UÁÁ•É…Í” ¥t€ô9Õµ‰•È¡É½Ü¹‰…±…¹”€üü€À¤ì(€€€ô(€€€É•ÑÕÉ¸‰…±…¹•Ìì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ¹•áÑM¡…É•¡½±‘•ÉA…å½ÕÑ	…Ñ¡I•™•É•¹”¡±¥•¹ÐèA½½±±¥•¹Ð¤ì(€€€½¹ÍÐå•…È€ô¹•Ü…Ñ” ¤¹•ÑÕ±±e•…È ¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P=1M¡5` ¡MU	MQI%9¡É•™•É•¹”I=4€Ä¤¤èé%9P¤°€À¤€¬€ÄLÙ…±Õ”(€€€€€€I=4Í¡…É•¡½±‘•É}Á…å½ÕÑ}‰…Ñ¡•Ì(€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€9É•™•É•¹”1%-€Í€°(€€€€€mMA´‘íå•…Éô´¡lÀ´åt¬¥€°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°MA´‘íå•…Éô´•t°(€€€€¤ì(€€€É•ÑÕÉ¸MA´‘íå•…Éô´‘íMÑÉ¥¹œ¡É½ÝÍlÁtü¹Ù…±Õ”€üü€Ä¤¹Á…‘MÑ…ÉÐ Ð°€œÀœ¥õ€ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ¹•áÑM¡…É•¡½±‘•ÉA…å½ÕÑI••¥ÁÑ9Õµ‰•È¡±¥•¹ÐèA½½±±¥•¹Ð¤ì(€€€½¹ÍÐå•…È€ô¹•Ü…Ñ” ¤¹•ÑÕ±±e•…È ¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P=1M¡5` ¡MU	MQI%9¡É••¥ÁÑ}¹Õµ‰•ÈI=4€Ä¤¤èé%9P¤°€À¤€¬€ÄLÙ…±Õ”(€€€€€€I=4Í¡…É•¡½±‘•É}Á…å½ÕÑ}±¥¹•Ì(€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€9É••¥ÁÑ}¹Õµ‰•È1%-€Í€°(€€€€€mM!H´‘íå•…Éô´¡lÀ´åt¬¥€°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°M!H´‘íå•…Éô´•t°(€€€€¤ì(€€€É•ÑÕÉ¸M!H´‘íå•…Éô´‘íMÑÉ¥¹œ¡É½ÝÍlÁtü¹Ù…±Õ”€üü€Ä¤¹Á…‘MÑ…ÉÐ Ð°€œÀœ¥õ€ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ¹•áÑM¡…É•¡½±‘•ÉA…å½ÕÑ1¥¹•%¡±¥•¹ÐèA½½±±¥•¹Ð¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P¹•áÑÙ…°¡Á}•Ñ}Í•É¥…±}Í•ÅÕ•¹” Í¡…É•¡½±‘•É}Á…å½ÕÑ}±¥¹•Ìœ°€¥œ¤¤LÙ…±Õ•€°(€€€€¤ì(€€€É•ÑÕÉ¸9Õµ‰•È¡É½ÝÍlÁtü¹Ù…±Õ”€üü€À¤ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÉ•…Ñ•M¡…É•¡½±‘•ÉA…å½ÕÑ%¹QÉ…¹Í…Ñ¥½¸ (€€€±¥•¹ÐèA½½±±¥•¹Ð°(€€€Í½ÕÉ•I•¥ÍÑ•Èè€5%9}M œð€UI9Q}M œð€	9,œ°(€€€‰½‘äèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø°(€€¤ì(€€€½¹ÍÐÁ…å½ÕÑ…Ñ”€ôMÑÉ¥¹œ¡‰½‘ä¹Á…å½ÕÑ}‘…Ñ”€üü¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤¹Í±¥” À°€ÄÀ¤¤ì(€€€½¹ÍÐÕÉÉ•¹ä€ôMÑÉ¥¹œ¡‰½‘ä¹ÕÉÉ•¹ä€üü€UMœ¤¹Ñ½UÁÁ•É…Í” ¤ì(€€€¥˜€ …lUMœ°€t¹¥¹±Õ‘•Ì¡ÕÉÉ•¹ä¤¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ •Ù¥Í”‘”±½Ð¥¹Ù…±¥‘”¸œ¤ì(€€€ô(€€€½¹ÍÐ½Á•É…Ñ¥½¹QåÁ”€ôMÑÉ¥¹œ¡‰½‘ä¹½Á•É…Ñ¥½¹}ÑåÁ”€üü€œœ¤¹Ñ½UÁÁ•É…Í” ¤ì(€€€¥˜€ …lM!I!=1I}IAe59Pœ°€M!I!=1I}UII9Q}=U9Pœ°€%MQI%	UQ%=8œ°€Y9œ°€=Q!Ht¹¥¹±Õ‘•Ì¡½Á•É…Ñ¥½¹QåÁ”¤¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ QåÁ”½Ã¥É…Ñ¥½¸¥¹Ù…±¥‘”¸œ¤ì(€€€ô(€€€½¹ÍÐÉ•…Í½¸€ôMÑÉ¥¹œ¡‰½‘ä¹É•…Í½¸€üü€œœ¤¹ÑÉ¥´ ¤ì(€€€¥˜€ …É•…Í½¸¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1”µ½Ñ¥˜•ÍÐ½‰±¥…Ñ½¥É”¸œ¤ì(€€€ô(€€€½¹ÍÐ‘•™…Õ±ÑA…åµ•¹Ñ5•Ñ¡½€ôÍ½ÕÉ•I•¥ÍÑ•È€ôôô€	9,œ(€€€€€€ü€	9,œ(€€€€€€èMÑÉ¥¹œ¡‰½‘ä¹‘•™…Õ±Ñ}Á…åµ•¹Ñ}µ•Ñ¡½€üü‰½‘ä¹Á…åµ•¹Ñ}µ•Ñ¡½€üü€M œ¤¹Ñ½UÁÁ•É…Í” ¤ì(€€€¥˜€ …lM œ°€	9,œ°€5=	%1}5=9dt¹¥¹±Õ‘•Ì¡‘•™…Õ±ÑA…åµ•¹Ñ5•Ñ¡½¤¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 5½‘”‘”Á…¥•µ•¹ÐÁ…È“¥™…ÕÐ¥¹Ù…±¥‘”¸œ¤ì(€€€ô(€€€½¹ÍÐ±¥¹•Í%¹ÁÕÐ€ôÉÉ…ä¹¥ÍÉÉ…ä¡‰½‘ä¹±¥¹•Ì¤€ü‰½‘ä¹±¥¹•Ì€èmtì(€€€¥˜€ …±¥¹•Í%¹ÁÕÐ¹±•¹Ñ ¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ Ôµ½¥¹ÌÕ¹”±¥¹”…Ñ¥½¹¹…¥É”•ÍÐ½‰±¥…Ñ½¥É”¸œ¤ì(€€€ô((€€€½¹ÍÐ¹½Éµ…±¥é•‘1¥¹•Ì€ô±¥¹•Í%¹ÁÕÐ¹µ…À ¡•¹ÑÉä°¥¹‘•à¤€ôøì(€€€€€½¹ÍÐÉ½Ü€ôÑåÁ•½˜•¹ÑÉä€ôôô€½‰©•Ðœ€˜˜•¹ÑÉä€ü•¹ÑÉä…ÌI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø€èíôì(€€€€€½¹ÍÐÍ¡…É•¡½±‘•É%€ô9Õµ‰•È¡É½Ü¹Í¡…É•¡½±‘•É}¥€üü€À¤ì(€€€€€½¹ÍÐ…µ½Õ¹Ð€ô9Õµ‰•È¡É½Ü¹…µ½Õ¹Ð€üü€À¤ì(€€€€€½¹ÍÐÁ…åµ•¹Ñ5•Ñ¡½€ôÍ½ÕÉ•I•¥ÍÑ•È€ôôô€	9,œ(€€€€€€€€ü€	9,œ(€€€€€€€€èMÑÉ¥¹œ¡É½Ü¹Á…åµ•¹Ñ}µ•Ñ¡½€üü‘•™…Õ±ÑA…åµ•¹Ñ5•Ñ¡½¤¹Ñ½UÁÁ•É…Í” ¤ì(€€€€€¥˜€ …9Õµ‰•È¹¥Í¥¹¥Ñ”¡Í¡…É•¡½±‘•É%¤ñðÍ¡…É•¡½±‘•É%€ðô€À¤ì(€€€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸¡Ñ¥½¹¹…¥É”¥¹Ù…±¥‘”ƒ€±„±¥¹”€‘í¥¹‘•à€¬€Åô¹€¤ì(€€€€€ô(€€€€€¥˜€ …9Õµ‰•È¹¥Í¥¹¥Ñ”¡…µ½Õ¹Ð¤ñð…µ½Õ¹Ð€ðô€À¤ì(€€€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸¡5½¹Ñ…¹Ð¥¹Ù…±¥‘”ƒ€±„±¥¹”€‘í¥¹‘•à€¬€Åô¹€¤ì(€€€€€ô(€€€€€¥˜€ …lM œ°€	9,œ°€5=	%1}5=9dt¹¥¹±Õ‘•Ì¡Á…åµ•¹Ñ5•Ñ¡½¤¤ì(€€€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸¡5½‘”‘”Á…¥•µ•¹Ð¥¹Ù…±¥‘”ƒ€±„±¥¹”€‘í¥¹‘•à€¬€Åô¹€¤ì(€€€€€ô(€€€€€É•ÑÕÉ¸ì(€€€€€€€Í¡…É•¡½±‘•É}¥èÍ¡…É•¡½±‘•É%°(€€€€€€€…µ½Õ¹Ðè9Õµ‰•È¡…µ½Õ¹Ð¹Ñ½¥á• È¤¤°(€€€€€€€Á…åµ•¹Ñ}µ•Ñ¡½èÁ…åµ•¹Ñ5•Ñ¡½°(€€€€€€€É•™•É•¹”èMÑÉ¥¹œ¡É½Ü¹É•™•É•¹”€üü€œœ¤¹ÑÉ¥´ ¤ñð¹Õ±°°(€€€€€€€¹½Ñ•ÌèMÑÉ¥¹œ¡É½Ü¹¹½Ñ•Ì€üü€œœ¤¹ÑÉ¥´ ¤ñð¹Õ±°°(€€€€€ôì(€€€ô¤ì((€€€½¹ÍÐ‘ÕÁ±¥…Ñ”€ô¹½Éµ…±¥é•‘1¥¹•Ì¹™¥¹ ¡±¥¹”°¥¹‘•à¤€ôø¹½Éµ…±¥é•‘1¥¹•Ì¹™¥¹‘%¹‘•à ¡½Ñ¡•È¤€ôø½Ñ¡•È¹Í¡…É•¡½±‘•É}¥€ôôô±¥¹”¹Í¡…É•¡½±‘•É}¥¤€„ôô¥¹‘•à¤ì(€€€¥˜€¡‘ÕÁ±¥…Ñ”¤ì(€€€€€Ñ¡É½Ü¹•Ü½¹™±¥Ñá•ÁÑ¥½¸ 1”·©µ”…Ñ¥½¹¹…¥É”¹”Á•ÕÐÁ…Ì…ÁÁ…É‡¹ÑÉ”‘•Õà™½¥Ì‘…¹Ì±”·©µ”±½Ð¸œ¤ì(€€€ô((€€€½¹ÍÐÑ½Ñ…±µ½Õ¹Ð€ô9Õµ‰•È¡¹½Éµ…±¥é•‘1¥¹•Ì¹É•‘Õ” ¡ÍÕ´°±¥¹”¤€ôøÍÕ´€¬±¥¹”¹…µ½Õ¹Ð°€À¤¹Ñ½¥á• È¤¤ì(€€€½¹ÍÐ¥‘•µÁ½Ñ•¹å-•ä€ôMÑÉ¥¹œ (€€€€€‰½‘ä¹¥‘•µÁ½Ñ•¹å}­•ä(€€€€€€üül(€€€€€€€€M!I!=1I}Ae=UPœ°(€€€€€€€Í½ÕÉ•I•¥ÍÑ•È°(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°(€€€€€€€Á…å½ÕÑ…Ñ”°(€€€€€€€ÕÉÉ•¹ä°(€€€€€€€½Á•É…Ñ¥½¹QåÁ”°(€€€€€€€Ñ½Ñ…±µ½Õ¹Ð¹Ñ½¥á• È¤°(€€€€€€€¹½Éµ…±¥é•‘1¥¹•Ì¹µ…À ¡±¥¹”¤€ôø€‘í±¥¹”¹Í¡…É•¡½±‘•É}¥‘ôè‘í±¥¹”¹…µ½Õ¹Ð¹Ñ½¥á• È¥õ€¤¹©½¥¸ ðœ¤°(€€€€€t¹©½¥¸ œèœ¤°(€€€€¤ì((€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä M1PÁ}…‘Ù¥Í½Éå}á…Ñ}±½¬¡¡…Í¡Ñ•áÐ Ä¤¤œ°mÍ¡…É•¡½±‘•ÈµÁ…å½ÕÐè‘íÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥ôè‘íÍ½ÕÉ•I•¥ÍÑ•Éôè‘í¥‘•µÁ½Ñ•¹å-•åõt¤ì(€€€½¹ÍÐ•á¥ÍÑ¥¹	…Ñ €ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P¥(€€€€€€I=4Í¡…É•¡½±‘•É}Á…å½ÕÑ}‰…Ñ¡•Ì(€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€9¥‘•µÁ½Ñ•¹å}­•ä€ô€È(€€€€€€1%5%P€Å€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°¥‘•µÁ½Ñ•¹å-•åt°(€€€€¤ì(€€€¥˜€¡•á¥ÍÑ¥¹	…Ñ ¹É½ÝÍlÁt¤ì(€€€€€É•ÑÕÉ¸Ñ¡¥Ì¹Í¡…É•¡½±‘•ÉA…å½ÕÑ	…Ñ ¡9Õµ‰•È¡•á¥ÍÑ¥¹	…Ñ ¹É½ÝÍlÁt¹¥¤¤ì(€€€ô((€€€½¹ÍÐÍ¡…É•¡½±‘•É%‘Ì€ô¹½Éµ…±¥é•‘1¥¹•Ì¹µ…À ¡±¥¹”¤€ôø±¥¹”¹Í¡…É•¡½±‘•É}¥¤ì(€€€½¹ÍÐÍ¡…É•¡½±‘•ÉI½ÝÌ€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P¥°‘¥ÍÁ±…å}¹…µ”°Í¡…É•¡½±‘•É}ÑåÁ”°ÍÑ…ÑÕÌ(€€€€€€I=4Í¡…É•¡½±‘•ÉÌ(€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€9¥€ô9d Èèé%9Qmt¥€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°Í¡…É•¡½±‘•É%‘Ít°(€€€€¤ì(€€€¥˜€¡Í¡…É•¡½±‘•ÉI½ÝÌ¹É½ÝÌ¹±•¹Ñ €„ôôÍ¡…É•¡½±‘•É%‘Ì¹±•¹Ñ ¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ U¸½ÔÁ±ÕÍ¥•ÕÉÌ…Ñ¥½¹¹…¥É•ÌÍ½¹Ð¥¹ÑÉ½ÕÙ…‰±•Ì‘…¹Ì•ÑÑ”½É…¹¥Í…Ñ¥½¸¸œ¤ì(€€€ô(€€€½¹ÍÐÍ¡…É•¡½±‘•É5…À€ô¹•Ü5…À¡Í¡…É•¡½±‘•ÉI½ÝÌ¹É½ÝÌ¹µ…À ¡É½Ü¤€ôøm9Õµ‰•È¡É½Ü¹¥¤°É½Ýt¤¤ì(€€€™½È€¡½¹ÍÐ±¥¹”½˜¹½Éµ…±¥é•‘1¥¹•Ì¤ì(€€€€€½¹ÍÐÍ¡…É•¡½±‘•È€ôÍ¡…É•¡½±‘•É5…À¹•Ð¡±¥¹”¹Í¡…É•¡½±‘•É}¥¤ì(€€€€€¥˜€ …Í¡…É•¡½±‘•È¤ì(€€€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ Ñ¥½¹¹…¥É”¥¹ÑÉ½ÕÙ…‰±”¸œ¤ì(€€€€€ô(€€€€€¥˜€¡MÑÉ¥¹œ¡Í¡…É•¡½±‘•È¹ÍÑ…ÑÕÌ¤€„ôô€Q%Yœ¤ì(€€€€€€€Ñ¡É½Ü¹•Ü½¹™±¥Ñá•ÁÑ¥½¸¡0…Ñ¥½¹¹…¥É”€‘íÍ¡…É•¡½±‘•È¹‘¥ÍÁ±…å}¹…µ•ô¸•ÍÐÁ…Ì…Ñ¥˜¹€¤ì(€€€€€ô(€€€ô((€€€±•Ð…Ù…¥±…‰±•	…±…¹”€ô€Àì(€€€¥˜€¡Í½ÕÉ•I•¥ÍÑ•È€ôôô€	9,œ¤ì(€€€€€…Ý…¥ÐÑ¡¥Ì¹•¹ÍÕÉ•	…¹­M¡•µ„ ¤ì(€€€ô(€€€½¹ÍÐ‰…¹­½Õ¹Ð€ôÍ½ÕÉ•I•¥ÍÑ•È€ôôô€	9,œ(€€€€€€ü…Ý…¥ÐÑ¡¥Ì¹Ù…±¥‘…Ñ•	…¹­½Õ¹Ñ½ÉM¡…É•¡½±‘•ÉA…å½ÕÐ¡±¥•¹Ð°9Õµ‰•È¡‰½‘ä¹‰…¹­}…½Õ¹Ñ}¥€üü€À¤°ÕÉÉ•¹ä¤(€€€€€€è¹Õ±°ì(€€€±•Ð•á¡…¹•I…Ñ•UÍ•è¹Õµ‰•Èð¹Õ±°€ô¹Õ±°ì(€€€±•Ð•á¡…¹•I…Ñ•…Ñ”èÍÑÉ¥¹œð¹Õ±°€ô¹Õ±°ì(€€€¥˜€¡ÕÉÉ•¹ä€ôôô€œ¤ì(€€€€€½¹ÍÐ•á¡…¹•I…Ñ”€ô…Ý…¥ÐÑ¡¥Ì¹•á¡…¹•I…Ñ” ¤ì(€€€€€•á¡…¹•I…Ñ•UÍ•€ô9Õµ‰•È¡‰½‘ä¹•á¡…¹•}É…Ñ•}ÕÍ•€üü•á¡…¹•I…Ñ”ü¹É…Ñ”€üü€À¤ñð¹Õ±°ì(€€€€€•á¡…¹•I…Ñ•…Ñ”€ôMÑÉ¥¹œ¡‰½‘ä¹•á¡…¹•}É…Ñ•}‘…Ñ”€üü•á¡…¹•I…Ñ”ü¹•™™•Ñ¥Ù•…Ñ”€üü€œœ¤ñð¹Õ±°ì(€€€€€¥˜€ …•á¡…¹•I…Ñ•UÍ•ñð•á¡…¹•I…Ñ•UÍ•€ðô€À¤ì(€€€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ Q…Õà‘”¡…¹”É•ÅÕ¥ÌÁ½ÕÈÕ¹”½Ã¥É…Ñ¥½¸•¸¸œ¤ì(€€€€€ô(€€€ô(€€€¥˜€¡Í½ÕÉ•I•¥ÍÑ•È€ôôô€5%9}M œ¤ì(€€€€€½¹ÍÐÍ•ÍÍ¥½¸€ô…Ý…¥ÐÑ¡¥Ì¹½Á•¹M•ÍÍ¥½¸¡±¥•¹Ð¤ì(€€€€€½¹ÍÐÑ½Ñ…±Ì€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€M1P=1M¡ÕÉÉ•¹ä°€UMœ¤LÕÉÉ•¹ä°(€€€€€€€€€€€€€€€=1M¡MU4¡M]!8ÑåÁ”€ô€%8œQ!8…µ½Õ¹Ð1M€µ…µ½Õ¹Ð9¤°€À¤èé9U5I% ÄÐ°È¤L‰…±…¹”(€€€€€€€€I=4…Í¡}µ½Ù•µ•¹ÑÌ(€€€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€€€9…Í¡}Í•ÍÍ¥½¹}¥€ô€È(€€€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€€€9…Ñ•½Éä9=P%8€ 1M}UI9Qœ°€1M}UI9Q}IU9œ¤(€€€€€€€€I=U@	d=1M¡ÕÉÉ•¹ä°€UMœ¥€°(€€€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°Í•ÍÍ¥½¸¹¥‘t°(€€€€€€¤ì(€€€€€…Ù…¥±…‰±•	…±…¹”€ôÕÉÉ•¹ä€ôôô€UMœ€ü9Õµ‰•È¡Í•ÍÍ¥½¸¹½Á•¹¥¹}‰…±…¹”€üü€À¤€è€Àì(€€€€€™½È€¡½¹ÍÐÉ½Ü½˜Ñ½Ñ…±Ì¹É½ÝÌ¤ì(€€€€€€€¥˜€¡MÑÉ¥¹œ¡É½Ü¹ÕÉÉ•¹ä€üü€UMœ¤¹Ñ½UÁÁ•É…Í” ¤€ôôôÕÉÉ•¹ä¤ì(€€€€€€€€€…Ù…¥±…‰±•	…±…¹”€¬ô9Õµ‰•È¡É½Ü¹‰…±…¹”€üü€À¤ì(€€€€€€€ô(€€€€€ô(€€€ô•±Í”¥˜€¡Í½ÕÉ•I•¥ÍÑ•È€ôôô€UI9Q}M œ¤ì(€€€€€…Ý…¥ÐÑ¡¥Ì¹•¹ÍÕÉ•Õ…É…¹Ñ••…Í¡M¡•µ„ ¤ì(€€€€€½¹ÍÐÑ½Ñ…±Ì€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€M1PÕÉÉ•¹ä°(€€€€€€€€€€€€€€€=1M¡MU4¡M]!8ÑåÁ”€ô€%8œQ!8…µ½Õ¹Ð1M€µ…µ½Õ¹Ð9¤°€À¤èé9U5I% ÄÐ°È¤L‰…±…¹”(€€€€€€€€I=4Õ…É…¹Ñ••}…Í¡}µ½Ù•µ•¹ÑÌ(€€€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€I=U@	dÕÉÉ•¹å€°(€€€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€€€¤ì(€€€€€™½È€¡½¹ÍÐÉ½Ü½˜Ñ½Ñ…±Ì¹É½ÝÌ¤ì(€€€€€€€¥˜€¡MÑÉ¥¹œ¡É½Ü¹ÕÉÉ•¹ä€üü€UMœ¤¹Ñ½UÁÁ•É…Í” ¤€ôôôÕÉÉ•¹ä¤ì(€€€€€€€€€…Ù…¥±…‰±•	…±…¹”€ô9Õµ‰•È¡É½Ü¹‰…±…¹”€üü€À¤ì(€€€€€€€ô(€€€€€ô(€€€ô•±Í”ì(€€€€€…Ù…¥±…‰±•	…±…¹”€ô9Õµ‰•È¡‰…¹­½Õ¹Ðü¹ÕÉÉ•¹Ñ}‰…±…¹”€üü€À¤ì(€€€ô((€€€¥˜€¡Ñ½Ñ…±µ½Õ¹Ð€ø9Õµ‰•È¡…Ù…¥±…‰±•	…±…¹”¹Ñ½¥á• È¤¤€¬€À¸ÀÀÀÄ¤ì(€€€€€Ñ¡É½Ü¹•Ü½¹™±¥Ñá•ÁÑ¥½¸ 1”Ñ½Ñ…°‘Ô±½Ð“¥Á…ÍÍ”±”Í½±‘”‘¥ÍÁ½¹¥‰±”‘…¹Ì±„‘•Ù¥Í”¡½¥Í¥”¸œ¤ì(€€€ô((€€€½¹ÍÐ‰…Ñ¡I•™•É•¹”€ôMÑÉ¥¹œ¡‰½‘ä¹É•™•É•¹”€üü€œœ¤¹ÑÉ¥´ ¤ñð…Ý…¥ÐÑ¡¥Ì¹¹•áÑM¡…É•¡½±‘•ÉA…å½ÕÑ	…Ñ¡I•™•É•¹”¡±¥•¹Ð¤ì(€€€½¹ÍÐ‰…Ñ¡%¹Í•ÉÐ€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€%9MIP%9Q<Í¡…É•¡½±‘•É}Á…å½ÕÑ}‰…Ñ¡•Ì(€€€€€€€€¡½É…¹¥é…Ñ¥½¹}¥°Í½ÕÉ•}É•¥ÍÑ•È°ÕÉÉ•¹ä°Á…å½ÕÑ}‘…Ñ”°½Á•É…Ñ¥½¹}ÑåÁ”°É•…Í½¸°É•™•É•¹”°¹½Ñ•Ì°‰…¹­}…½Õ¹Ñ}¥°(€€€€€€€€Ñ½Ñ…±}…µ½Õ¹Ð°‰•¹•™¥¥…Éå}½Õ¹Ð°ÍÑ…ÑÕÌ°¥‘•µÁ½Ñ•¹å}­•ä°É•…Ñ•‘}‰ä°É•…Ñ•‘}…Ð°Ù…±¥‘…Ñ•‘}…Ð¤(€€€€€€Y1UL(€€€€€€€€ Ä°€È°€Ì°€Ð°€Ô°€Ø°€Ü°€à°€ä°(€€€€€€€€€ÄÀ°€ÄÄ°€Y1%Qœ°€ÄÈ°€ÄÌ°9=\ ¤°9=\ ¤¤(€€€€€€IQUI9%9€©€°(€€€€€l(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°(€€€€€€€Í½ÕÉ•I•¥ÍÑ•È°(€€€€€€€ÕÉÉ•¹ä°(€€€€€€€Á…å½ÕÑ…Ñ”°(€€€€€€€½Á•É…Ñ¥½¹QåÁ”°(€€€€€€€É•…Í½¸°(€€€€€€€‰…Ñ¡I•™•É•¹”°(€€€€€€€MÑÉ¥¹œ¡‰½‘ä¹¹½Ñ•Ì€üü€œœ¤¹ÑÉ¥´ ¤ñð¹Õ±°°(€€€€€€€‰…¹­½Õ¹Ð€ü9Õµ‰•È¡‰…¹­½Õ¹Ð¹¥¤€è¹Õ±°°(€€€€€€€Ñ½Ñ…±µ½Õ¹Ð°(€€€€€€€¹½Éµ…±¥é•‘1¥¹•Ì¹±•¹Ñ °(€€€€€€€¥‘•µÁ½Ñ•¹å-•ä°(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•É% ¤€üü¹Õ±°°(€€€€€t°(€€€€¤ì(€€€½¹ÍÐ‰…Ñ €ôÉ•ÅÕ¥É•I½Ü¡‰…Ñ¡%¹Í•ÉÐ¹É½ÝÍlÁt°€M¡…É•¡½±‘•ÈÁ…å½ÕÐ‰…Ñ œ¤ì((€€€½¹ÍÐÉ•…Ñ•‘1¥¹•ÌèÉÉ…äñI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸øø€ômtì(€€€™½È€¡½¹ÍÐ±¥¹”½˜¹½Éµ…±¥é•‘1¥¹•Ì¤ì(€€€€€½¹ÍÐÍ¡…É•¡½±‘•È€ôÍ¡…É•¡½±‘•É5…À¹•Ð¡±¥¹”¹Í¡…É•¡½±‘•É}¥¤„ì(€€€€€½¹ÍÐÉ••¥ÁÑ9Õµ‰•È€ô…Ý…¥ÐÑ¡¥Ì¹¹•áÑM¡…É•¡½±‘•ÉA…å½ÕÑI••¥ÁÑ9Õµ‰•È¡±¥•¹Ð¤ì(€€€€€±•Ð…Í¡5½Ù•µ•¹Ñ%è¹Õµ‰•Èð¹Õ±°€ô¹Õ±°ì(€€€€€±•ÐÕ…É…¹Ñ••…Í¡5½Ù•µ•¹Ñ%è¹Õµ‰•Èð¹Õ±°€ô¹Õ±°ì(€€€€€±•Ð‰…¹­QÉ…¹Í…Ñ¥½¹%è¹Õµ‰•Èð¹Õ±°€ô¹Õ±°ì(€€€€€¥˜€¡Í½ÕÉ•I•¥ÍÑ•È€ôôô€5%9}M œ¤ì(€€€€€€€½¹ÍÐµ½Ù•µ•¹Ð€ô…Ý…¥ÐÑ¡¥Ì¹É•…Ñ•…Í¡5½Ù•µ•¹Ñ%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹Ð°ì(€€€€€€€€€ÑåÁ”è€=UPœ°(€€€€€€€€€…Ñ•½Éäè€M!I!=1I}Ae=UPœ°(€€€€€€€€€±…‰•°èI•µ‰½ÕÉÍ•µ•¹Ð…Ñ¥½¹¹…¥É”€´€‘íÍ¡…É•¡½±‘•È¹‘¥ÍÁ±…å}¹…µ•õ€°(€€€€€€€€€…µ½Õ¹Ðè±¥¹”¹…µ½Õ¹Ð°(€€€€€€€€€µ½Ù•µ•¹Ñ}‘…Ñ”èÁ…å½ÕÑ…Ñ”°(€€€€€€€€€‘•ÍÉ¥ÁÑ¥½¸èÉ•…Í½¸°(€€€€€€€€€É•™•É•¹”è±¥¹”¹É•™•É•¹”€üü‰…Ñ¡I•™•É•¹”°(€€€€€€€€€ÕÉÉ•¹ä°(€€€€€€€€€•á¡…¹•}É…Ñ•}ÕÍ•è•á¡…¹•I…Ñ•UÍ•°(€€€€€€€€€•á¡…¹•}É…Ñ•}‘…Ñ”è•á¡…¹•I…Ñ•…Ñ”°(€€€€€€€€€•ÅÕ¥Ù…±•¹Ñ}ÕÍèÕÉÉ•¹ä€ôôô€œ€˜˜•á¡…¹•I…Ñ•UÍ•€ü9Õµ‰•È ¡±¥¹”¹…µ½Õ¹Ð€¼•á¡…¹•I…Ñ•UÍ•¤¹Ñ½¥á• È¤¤€è±¥¹”¹…µ½Õ¹Ð°(€€€€€€€€€ÍÕÁÁ±¥•ÈèÍ¡…É•¡½±‘•È¹‘¥ÍÁ±…å}¹…µ”°(€€€€€€€ô¤ì(€€€€€€€…Í¡5½Ù•µ•¹Ñ%€ô9Õµ‰•È¡µ½Ù•µ•¹Ð¹¥¤ì(€€€€€ô•±Í”¥˜€¡Í½ÕÉ•I•¥ÍÑ•È€ôôô€UI9Q}M œ¤ì(€€€€€€€½¹ÍÐµ½Ù•µ•¹Ð€ô…Ý…¥ÐÑ¡¥Ì¹É•…Ñ•Õ…É…¹Ñ••…Í¡5½Ù•µ•¹Ñ%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹Ð°ì(€€€€€€€€€µ½Ù•µ•¹Ñ}ÑåÁ”è€M!I!=1I}Ae=UPœ°(€€€€€€€€€ÑåÁ”è€=UPœ°(€€€€€€€€€…µ½Õ¹Ðè±¥¹”¹…µ½Õ¹Ð°(€€€€€€€€€ÕÉÉ•¹ä°(€€€€€€€€€•ÅÕ¥Ù…±•¹Ñ}ÕÍèÕÉÉ•¹ä€ôôô€œ€˜˜•á¡…¹•I…Ñ•UÍ•€ü9Õµ‰•È ¡±¥¹”¹…µ½Õ¹Ð€¼•á¡…¹•I…Ñ•UÍ•¤¹Ñ½¥á• È¤¤€è±¥¹”¹…µ½Õ¹Ð°(€€€€€€€€€µ½Ù•µ•¹Ñ}‘…Ñ”èÁ…å½ÕÑ…Ñ”°(€€€€€€€€€É•™•É•¹”è±¥¹”¹É•™•É•¹”€üü‰…Ñ¡I•™•É•¹”°(€€€€€€€€€É•…Í½¸°(€€€€€€€€€¹½Ñ•Ìè±¥¹”¹¹½Ñ•Ì°(€€€€€€€€€•á¡…¹•}É…Ñ•}ÕÍ•è•á¡…¹•I…Ñ•UÍ•°(€€€€€€€€€•á¡…¹•}É…Ñ•}‘…Ñ”è•á¡…¹•I…Ñ•…Ñ”°(€€€€€€€ô¤ì(€€€€€€€Õ…É…¹Ñ••…Í¡5½Ù•µ•¹Ñ%€ô9Õµ‰•È¡µ½Ù•µ•¹Ð¹¥¤ì(€€€€€ô•±Í”ì(€€€€€€€½¹ÍÐ±¥¹•%€ô…Ý…¥ÐÑ¡¥Ì¹¹•áÑM¡…É•¡½±‘•ÉA…å½ÕÑ1¥¹•%¡±¥•¹Ð¤ì(€€€€€€€½¹ÍÐÑÉ…¹Í…Ñ¥½¹QåÁ”€ô…Ý…¥ÐÑ¡¥Ì¹‰…¹­Õ…É…¹Ñ••QÉ…¹Í…Ñ¥½¹QåÁ”¡±¥•¹Ð°€M!I!=1I}Ae=UPœ¤ì(€€€€€€€½¹ÍÐ‰…¹­QÉ…¹Í…Ñ¥½¸€ô…Ý…¥ÐÑ¡¥Ì¹É•…Ñ•Õ…É…¹Ñ••	…¹­QÉ…¹Í…Ñ¥½¹%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹Ð°ì(€€€€€€€€€‰…¹­½Õ¹Ðè‰…¹­½Õ¹Ð…Ìì¥è¹Õµ‰•Èì‰…¹­}¹…µ”üèÍÑÉ¥¹œð¹Õ±°ì…½Õ¹Ñ}¹…µ”üèÍÑÉ¥¹œð¹Õ±°ìÕÉÉ•¹äèÍÑÉ¥¹œô°(€€€€€€€€€…µ½Õ¹Ðè±¥¹”¹…µ½Õ¹Ð°(€€€€€€€€€ÕÉÉ•¹ä°(€€€€€€€€€É••¥ÁÑ9Õµ‰•È°(€€€€€€€€€É•™•É•¹”è±¥¹”¹É•™•É•¹”€üü‰…Ñ¡I•™•É•¹”°(€€€€€€€€€É•…Ñ•‘	äèÑ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•É% ¤€üü¹Õ±°°(€€€€€€€€€ÑÉ…¹Í…Ñ¥½¹QåÁ”°(€€€€€€€€€Í½ÕÉ•5½‘Õ±”è€M!I!=1I}Ae=UQLœ°(€€€€€€€€€‘¥É•Ñ¥½¸è€=UPœ°(€€€€€€€€€Í½ÕÉ•¹Ñ¥ÑåQåÁ”è€M!I!=1I}Ae=UQ}1%9œ°(€€€€€€€€€Í½ÕÉ•¹Ñ¥Ñå%è±¥¹•%°(€€€€€€€€€‘•ÍÉ¥ÁÑ¥½¸è€I•µ‰½ÕÉÍ•µ•¹Ð…Ñ¥½¹¹…¥É”œ°(€€€€€€€€€Ñ•¹…¹Ñ9…µ”èÍ¡…É•¡½±‘•È¹‘¥ÍÁ±…å}¹…µ”°(€€€€€€€€€±•…Í•9Õµ‰•Èè¹Õ±°°(€€€€€€€€€Õ¹¥Ñ9Õµ‰•Èè¹Õ±°°(€€€€€€€ô¤ì(€€€€€€€‰…¹­QÉ…¹Í…Ñ¥½¹%€ô9Õµ‰•È ¡‰…¹­QÉ…¹Í…Ñ¥½¸…ÌI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø¤¹¥€üü€À¤ì(€€€€€€€½¹ÍÐ¥¹Í•ÉÑ•‘1¥¹”€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€€€%9MIP%9Q<Í¡…É•¡½±‘•É}Á…å½ÕÑ}±¥¹•Ì(€€€€€€€€€€€€¡¥°½É…¹¥é…Ñ¥½¹}¥°‰…Ñ¡}¥°Í¡…É•¡½±‘•É}¥°…µ½Õ¹Ð°ÕÉÉ•¹ä°Á…åµ•¹Ñ}µ•Ñ¡½°É•™•É•¹”°¹½Ñ•Ì°(€€€€€€€€€€€€…Í¡}µ½Ù•µ•¹Ñ}¥°Õ…É…¹Ñ••}…Í¡}µ½Ù•µ•¹Ñ}¥°‰…¹­}ÑÉ…¹Í…Ñ¥½¹}¥°É••¥ÁÑ}¹Õµ‰•È¤(€€€€€€€€€€Y1UL(€€€€€€€€€€€€ Ä°€È°€Ì°€Ð°€Ô°€Ø°€Ü°€à°(€€€€€€€€€€€€€ä°€ÄÀ°€ÄÄ°€ÄÈ°€ÄÌ¤(€€€€€€€€€€IQUI9%9€©€°(€€€€€€€€€l(€€€€€€€€€€€±¥¹•%°(€€€€€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°(€€€€€€€€€€€‰…Ñ ¹¥°(€€€€€€€€€€€±¥¹”¹Í¡…É•¡½±‘•É}¥°(€€€€€€€€€€€±¥¹”¹…µ½Õ¹Ð°(€€€€€€€€€€€ÕÉÉ•¹ä°(€€€€€€€€€€€€	9,œ°(€€€€€€€€€€€±¥¹”¹É•™•É•¹”°(€€€€€€€€€€€±¥¹”¹¹½Ñ•Ì°(€€€€€€€€€€€¹Õ±°°(€€€€€€€€€€€¹Õ±°°(€€€€€€€€€€€‰…¹­QÉ…¹Í…Ñ¥½¹%°(€€€€€€€€€€€É••¥ÁÑ9Õµ‰•È°(€€€€€€€€€t°(€€€€€€€€¤ì(€€€€€€€É•…Ñ•‘1¥¹•Ì¹ÁÕÍ ¡ì(€€€€€€€€€€¸¸¹¥¹Í•ÉÑ•‘1¥¹”¹É½ÝÍlÁt°(€€€€€€€€€Í¡…É•¡½±‘•É}¹…µ”èÍ¡…É•¡½±‘•È¹‘¥ÍÁ±…å}¹…µ”°(€€€€€€€€€Í¡…É•¡½±‘•É}ÑåÁ”èÍ¡…É•¡½±‘•È¹Í¡…É•¡½±‘•É}ÑåÁ”°(€€€€€€€€€‰…¹­}ÑÉ…¹Í…Ñ¥½¹}¥è‰…¹­QÉ…¹Í…Ñ¥½¹%°(€€€€€€€ô¤ì(€€€€€€€½¹Ñ¥¹Õ”ì(€€€€€ô((€€€€€½¹ÍÐ¥¹Í•ÉÑ•‘1¥¹”€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€%9MIP%9Q<Í¡…É•¡½±‘•É}Á…å½ÕÑ}±¥¹•Ì(€€€€€€€€€€¡½É…¹¥é…Ñ¥½¹}¥°‰…Ñ¡}¥°Í¡…É•¡½±‘•É}¥°…µ½Õ¹Ð°ÕÉÉ•¹ä°Á…åµ•¹Ñ}µ•Ñ¡½°É•™•É•¹”°¹½Ñ•Ì°(€€€€€€€€€€…Í¡}µ½Ù•µ•¹Ñ}¥°Õ…É…¹Ñ••}…Í¡}µ½Ù•µ•¹Ñ}¥°‰…¹­}ÑÉ…¹Í…Ñ¥½¹}¥°É••¥ÁÑ}¹Õµ‰•È¤(€€€€€€€€Y1UL(€€€€€€€€€€ Ä°€È°€Ì°€Ð°€Ô°€Ø°€Ü°€à°(€€€€€€€€€€€ä°€ÄÀ°€ÄÄ°€ÄÈ¤(€€€€€€€€IQUI9%9€©€°(€€€€€€€l(€€€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°(€€€€€€€€€‰…Ñ ¹¥°(€€€€€€€€€±¥¹”¹Í¡…É•¡½±‘•É}¥°(€€€€€€€€€±¥¹”¹…µ½Õ¹Ð°(€€€€€€€€€ÕÉÉ•¹ä°(€€€€€€€€€±¥¹”¹Á…åµ•¹Ñ}µ•Ñ¡½°(€€€€€€€€€±¥¹”¹É•™•É•¹”°(€€€€€€€€€±¥¹”¹¹½Ñ•Ì°(€€€€€€€€€…Í¡5½Ù•µ•¹Ñ%°(€€€€€€€€€Õ…É…¹Ñ••…Í¡5½Ù•µ•¹Ñ%°(€€€€€€€€€¹Õ±°°(€€€€€€€€€É••¥ÁÑ9Õµ‰•È°(€€€€€€€t°(€€€€€€¤ì(€€€€€É•…Ñ•‘1¥¹•Ì¹ÁÕÍ ¡ì(€€€€€€€€¸¸¹¥¹Í•ÉÑ•‘1¥¹”¹É½ÝÍlÁt°(€€€€€€€Í¡…É•¡½±‘•É}¹…µ”èÍ¡…É•¡½±‘•È¹‘¥ÍÁ±…å}¹…µ”°(€€€€€€€Í¡…É•¡½±‘•É}ÑåÁ”èÍ¡…É•¡½±‘•È¹Í¡…É•¡½±‘•É}ÑåÁ”°(€€€€€ô¤ì(€€€ô((€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€%9MIP%9Q<…Õ‘¥Ñ}±½Ì€¡½É…¹¥é…Ñ¥½¹}¥°ÕÍ•É}¥°…Ñ¥½¸°É•Í½ÕÉ”°É•Í½ÕÉ•}¥°µ•Ñ¡½°Á…Ñ °ÍÑ…ÑÕÍ}½‘”°µ•Ñ…‘…Ñ„¤(€€€€€€Y1UL€ Ä°€È°€M!I!=1I}Ae=UQ}Y1%Qœ°€Í¡…É•¡½±‘•É}Á…å½ÕÑ}‰…Ñ¡•Ìœ°€Ì°€A=MPœ°€Ð°€ÈÀÄ°€Ôèé)M=9¥€°(€€€€€l(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•É% ¤€üü¹Õ±°°(€€€€€€€MÑÉ¥¹œ¡‰…Ñ ¹¥¤°(€€€€€€€Í½ÕÉ•I•¥ÍÑ•È€ôôô€5%9}M œ€ü€œ½…Á¤½…Í ½Í¡…É•¡½±‘•ÈµÁ…å½ÕÑÌœ€è€œ½…Á¤½Õ…É…¹Ñ•”µ…Í ½Í¡…É•¡½±‘•ÈµÁ…å½ÕÑÌœ°(€€€€€€€)M=8¹ÍÑÉ¥¹¥™ä¡ì(€€€€€€€€€‰…Ñ¡}¥è‰…Ñ ¹¥°(€€€€€€€€€Í½ÕÉ•}É•¥ÍÑ•ÈèÍ½ÕÉ•I•¥ÍÑ•È°(€€€€€€€€€ÕÉÉ•¹ä°(€€€€€€€€€Ñ½Ñ…±}…µ½Õ¹ÐèÑ½Ñ…±µ½Õ¹Ð°(€€€€€€€€€‰•¹•™¥¥…Éå}½Õ¹Ðè¹½Éµ…±¥é•‘1¥¹•Ì¹±•¹Ñ °(€€€€€€€€€½Á•É…Ñ¥½¹}ÑåÁ”è½Á•É…Ñ¥½¹QåÁ”°(€€€€€€€€€É•…Í½¸°(€€€€€€€€€±¥¹•ÌèÉ•…Ñ•‘1¥¹•Ì¹µ…À ¡±¥¹”¤€ôø€¡ì(€€€€€€€€€€€Í¡…É•¡½±‘•É}¥è±¥¹”¹Í¡…É•¡½±‘•É}¥°(€€€€€€€€€€€Í¡…É•¡½±‘•É}¹…µ”è±¥¹”¹Í¡…É•¡½±‘•É}¹…µ”°(€€€€€€€€€€€…µ½Õ¹Ðè±¥¹”¹…µ½Õ¹Ð°(€€€€€€€€€€€ÕÉÉ•¹äè±¥¹”¹ÕÉÉ•¹ä°(€€€€€€€€€€€É••¥ÁÑ}¹Õµ‰•Èè±¥¹”¹É••¥ÁÑ}¹Õµ‰•È°(€€€€€€€€€€€…Í¡}µ½Ù•µ•¹Ñ}¥è±¥¹”¹…Í¡}µ½Ù•µ•¹Ñ}¥°(€€€€€€€€€€€Õ…É…¹Ñ••}…Í¡}µ½Ù•µ•¹Ñ}¥è±¥¹”¹Õ…É…¹Ñ••}…Í¡}µ½Ù•µ•¹Ñ}¥°(€€€€€€€€€ô¤¤°(€€€€€€€ô¤°(€€€€€t°(€€€€¤ì((€€€É•ÑÕÉ¸ì(€€€€€€¸¸¹‰…Ñ °(€€€€€±¥¹•ÌèÉ•…Ñ•‘1¥¹•Ì°(€€€ôì(€ô((€ÁÉ¥Ù…Ñ”½µÁÕÑ•Q•¹…¹ÑÉ•‘¥Ñ	…±…¹•MÑ…Ñ”¡½É¥¥¹…±µ½Õ¹Ðè¹Õµ‰•È°…±±½…Ñ¥½¹ÍQ½Ñ…°è¹Õµ‰•È°É•™Õ¹‘ÍQ½Ñ…°è¹Õµ‰•È¤ì(€€€½¹ÍÐÉ•µ…¥¹¥¹µ½Õ¹Ð€ô9Õµ‰•È¡5…Ñ ¹µ…à¡½É¥¥¹…±µ½Õ¹Ð€´…±±½…Ñ¥½¹ÍQ½Ñ…°€´É•™Õ¹‘ÍQ½Ñ…°°€À¤¹Ñ½¥á• È¤¤ì(€€€½¹ÍÐ¡…Í±±½…Ñ¥½¹Ì€ô…±±½…Ñ¥½¹ÍQ½Ñ…°€ø€Àì(€€€½¹ÍÐ¡…ÍI•™Õ¹‘Ì€ôÉ•™Õ¹‘ÍQ½Ñ…°€ø€Àì(€€€½¹ÍÐ¹•áÑMÑ…ÑÕÌ€ô¡…Í±±½…Ñ¥½¹Ì(€€€€€€ü€¡É•µ…¥¹¥¹µ½Õ¹Ð€ðô€À€ü€UMœ€è€AIQ%11e}UMœ¤(€€€€€€è¡…ÍI•™Õ¹‘Ì(€€€€€€€€ü€¡É•µ…¥¹¥¹µ½Õ¹Ð€ðô€À€ü€IU9œ€è€AIQ%11e}UMœ¤(€€€€€€€€è€Y%1	1œì(€€€É•ÑÕÉ¸ìÉ•µ…¥¹¥¹µ½Õ¹Ð°¹•áÑMÑ…ÑÕÌôì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ±¥¹­•‘Q•¹…¹ÑÉ•‘¥Ñ…Í¡5½Ù•µ•¹Ñ%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹ÐèA½½±±¥•¹Ð°É•‘¥Ñ%è¹Õµ‰•È°Á…åµ•¹Ñ%è¹Õµ‰•Èð¹Õ±°¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P´¸¨°(€€€€€€€€€€€€€€¡M1PÌ¹ÍÑ…ÑÕÌI=4…Í¡}Í•ÍÍ¥½¹ÌÌ]!IÌ¹¥€ô´¹…Í¡}Í•ÍÍ¥½¹}¥¤LÍ•ÍÍ¥½¹}ÍÑ…ÑÕÌ(€€€€€€I=4…Í¡}µ½Ù•µ•¹ÑÌ´(€€€€€€]!I´¹½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€9´¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€9€¡´¹Ñ•¹…¹Ñ}É•‘¥Ñ}¥€ô€È=H€ Ìèé%9P%L9=P9U109´¹Á…åµ•¹Ñ}¥€ô€Ìèé%9P¤¤(€€€€€€=IH	dM]!8´¹Ñ•¹…¹Ñ}É•‘¥Ñ}¥€ô€ÈQ!8€À1M€Ä9°´¹¥M(€€€€€€1%5%P€Ä(€€€€€€=HUAQ€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°É•‘¥Ñ%°Á…åµ•¹Ñ%‘t°(€€€€¤ì(€€€É•ÑÕÉ¸É½ÝÍlÁt€üü¹Õ±°ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÕÁ‘…Ñ•Q•¹…¹ÑÉ•‘¥Ñ%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹ÐèA½½±±¥•¹Ð°¥è¹Õµ‰•È°‰½‘äèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø¤ì(€€€½¹ÍÐÉ•…Í½¸€ôMÑÉ¥¹œ¡‰½‘ä¹É•…Í½¸€üü‰½‘ä¹½ÉÉ•Ñ¥½¹}É•…Í½¸€üü€œœ¤¹ÑÉ¥´ ¤ì(€€€¥˜€ …É•…Í½¸¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1”µ½Ñ¥˜‘”½ÉÉ•Ñ¥½¸•ÍÐ½‰±¥…Ñ½¥É”¸œ¤ì(€€€ô((€€€½¹ÍÐÉ•‘¥ÑI•ÍÕ±Ð€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P€¨(€€€€€€I=4Ñ•¹…¹Ñ}É•‘¥ÑÌ(€€€€€€]!I¥€ô€Ä(€€€€€€€€9½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U10(€€€€€€=HUAQ€°(€€€€€m¥°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€½¹ÍÐÉ•‘¥Ð€ôÉ•ÅÕ¥É•I½Ü¡É•‘¥ÑI•ÍÕ±Ð¹É½ÝÍlÁt°€Q•¹…¹ÐÉ•‘¥Ðœ¤…ÌI•½ÉñÍÑÉ¥¹œ°…¹äøì((€€€¥˜€¡‰½‘ä¹ÕÉÉ•¹ä€„ôôÕ¹‘•™¥¹•€˜˜MÑÉ¥¹œ¡‰½‘ä¹ÕÉÉ•¹ä€üü€œœ¤¹ÑÉ¥´ ¤¹Ñ½UÁÁ•É…Í” ¤€„ôôMÑÉ¥¹œ¡É•‘¥Ð¹ÕÉÉ•¹ä€üü€UMœ¤¹Ñ½UÁÁ•É…Í” ¤¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1„‘•Ù¥Í”‘ÔË¥‘¥Ð±½…Ñ…¥É”¹”Á•ÕÐÁ…Ìƒ©ÑÉ”µ½‘¥™§¥”¸œ¤ì(€€€ô(€€€¥˜€¡‰½‘ä¹Ñ•¹…¹Ñ}¥€„ôôÕ¹‘•™¥¹•€˜˜9Õµ‰•È¡‰½‘ä¹Ñ•¹…¹Ñ}¥€üü€À¤€„ôô9Õµ‰•È¡É•‘¥Ð¹Ñ•¹…¹Ñ}¥€üü€À¤¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1”±½…Ñ…¥É”‘ÔË¥‘¥Ð±½…Ñ…¥É”¹”Á•ÕÐÁ…Ìƒ©ÑÉ”µ½‘¥™§¤¸œ¤ì(€€€ô(€€€¥˜€¡‰½‘ä¹½É…¹¥é…Ñ¥½¹}¥€„ôôÕ¹‘•™¥¹•€˜˜9Õµ‰•È¡‰½‘ä¹½É…¹¥é…Ñ¥½¹}¥€üü€À¤€„ôôÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 0½É…¹¥Í…Ñ¥½¸‘ÔË¥‘¥Ð±½…Ñ…¥É”¹”Á•ÕÐÁ…Ìƒ©ÑÉ”µ½‘¥™§¥”¸œ¤ì(€€€ô((€€€½¹ÍÐÁ…åµ•¹Ñ%€ô9Õµ‰•È¡É•‘¥Ð¹Í½ÕÉ•}Á…åµ•¹Ñ}¥€üü€À¤ñð¹Õ±°ì(€€€½¹ÍÐÁ…åµ•¹ÑI•ÍÕ±Ð€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P€¨(€€€€€€I=4Á…åµ•¹ÑÌ(€€€€€€]!I¥€ô€Ä(€€€€€€€€9½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U10(€€€€€€=HUAQ€°(€€€€€mÁ…åµ•¹Ñ%°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€½¹ÍÐÁ…åµ•¹Ð€ôÉ•ÅÕ¥É•I½Ü¡Á…åµ•¹ÑI•ÍÕ±Ð¹É½ÝÍlÁt°€Q•¹…¹ÐÉ•‘¥ÐÁ…åµ•¹Ðœ¤…ÌI•½ÉñÍÑÉ¥¹œ°…¹äøì((€€€½¹ÍÐ…±±½…Ñ¥½¹MÑ…ÑÌ€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P=U9P ¨¤èé%9PL½Õ¹Ð°(€€€€€€€€€€€€€=1M¡MU4¡…µ½Õ¹Ñ}…ÁÁ±¥•¤°€À¤èé9U5I% ÄÐ°È¤LÑ½Ñ…°(€€€€€€I=4Ñ•¹…¹Ñ}É•‘¥Ñ}…±±½…Ñ¥½¹Ì(€€€€€€]!IÑ•¹…¹Ñ}É•‘¥Ñ}¥€ô€Ä(€€€€€€€€9½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U11€°(€€€€€m¥°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€½¹ÍÐÉ•™Õ¹‘MÑ…ÑÌ€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P=U9P ¨¤èé%9PL½Õ¹Ð°(€€€€€€€€€€€€€=1M¡MU4¡…µ½Õ¹Ð¤°€À¤èé9U5I% ÄÐ°È¤LÑ½Ñ…°(€€€€€€I=4Ñ•¹…¹Ñ}É•‘¥Ñ}É•™Õ¹‘Ì(€€€€€€]!IÑ•¹…¹Ñ}É•‘¥Ñ}¥€ô€Ä(€€€€€€€€9½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U11€°(€€€€€m¥°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì((€€€½¹ÍÐ…±±½…Ñ¥½¹½Õ¹Ð€ô9Õµ‰•È¡…±±½…Ñ¥½¹MÑ…ÑÌ¹É½ÝÍlÁtü¹½Õ¹Ð€üü€À¤ì(€€€½¹ÍÐ…±±½…Ñ¥½¹ÍQ½Ñ…°€ô9Õµ‰•È¡…±±½…Ñ¥½¹MÑ…ÑÌ¹É½ÝÍlÁtü¹Ñ½Ñ…°€üü€À¤ì(€€€½¹ÍÐÉ•™Õ¹‘½Õ¹Ð€ô9Õµ‰•È¡É•™Õ¹‘MÑ…ÑÌ¹É½ÝÍlÁtü¹½Õ¹Ð€üü€À¤ì(€€€½¹ÍÐÉ•™Õ¹‘ÍQ½Ñ…°€ô9Õµ‰•È¡É•™Õ¹‘MÑ…ÑÌ¹É½ÝÍlÁtü¹Ñ½Ñ…°€üü€À¤ì(€€€½¹ÍÐ½¹ÍÕµ•‘Q½Ñ…°€ô9Õµ‰•È ¡…±±½…Ñ¥½¹ÍQ½Ñ…°€¬É•™Õ¹‘ÍQ½Ñ…°¤¹Ñ½¥á• È¤¤ì((€€€½¹ÍÐÕÉÉ•¹ä€ôMÑÉ¥¹œ¡É•‘¥Ð¹ÕÉÉ•¹ä€üüÁ…åµ•¹Ð¹ÕÉÉ•¹ä€üü€UMœ¤¹Ñ½UÁÁ•É…Í” ¤ì(€€€½¹ÍÐ½É¥¥¹…±µ½Õ¹Ð€ô9Õµ‰•È¡É•‘¥Ð¹½É¥¥¹…±}…µ½Õ¹Ð€üü€À¤ì(€€€½¹ÍÐÕÉÉ•¹ÑA…åµ•¹Ñ…Ñ”€ôMÑÉ¥¹œ¡É•‘¥Ð¹Á…åµ•¹Ñ}‘…Ñ”€üüÁ…åµ•¹Ð¹Á…åµ•¹Ñ}‘…Ñ”€üü€œœ¤¹Í±¥” À°€ÄÀ¤ì(€€€½¹ÍÐÕÉÉ•¹ÑI•™•É•¹”€ôMÑÉ¥¹œ¡É•‘¥Ð¹É•™•É•¹”€üüÁ…åµ•¹Ð¹É•™•É•¹”€üü€œœ¤¹ÑÉ¥´ ¤ì(€€€½¹ÍÐÕÉÉ•¹Ñ9½Ñ•Ì€ôMÑÉ¥¹œ¡É•‘¥Ð¹¹½Ñ•Ì€üüÁ…åµ•¹Ð¹¹½Ñ•Ì€üü€œœ¤¹ÑÉ¥´ ¤ì(€€€½¹ÍÐÕÉÉ•¹ÑA…åµ•¹Ñ5•Ñ¡½€ôMÑÉ¥¹œ¡Á…åµ•¹Ð¹Á…åµ•¹Ñ}µ•Ñ¡½€üü€M œ¤¹Ñ½UÁÁ•É…Í” ¤ì((€€€½¹ÍÐÉ•ÅÕ•ÍÑ•‘µ½Õ¹Ð€ô‰½‘ä¹½É¥¥¹…±}…µ½Õ¹Ð€ôôôÕ¹‘•™¥¹•€˜˜‰½‘ä¹…µ½Õ¹Ð€ôôôÕ¹‘•™¥¹•(€€€€€€ü½É¥¥¹…±µ½Õ¹Ð(€€€€€€è9Õµ‰•È¡‰½‘ä¹½É¥¥¹…±}…µ½Õ¹Ð€üü‰½‘ä¹…µ½Õ¹Ð€üü€À¤ì(€€€¥˜€ …9Õµ‰•È¹¥Í¥¹¥Ñ”¡É•ÅÕ•ÍÑ•‘µ½Õ¹Ð¤ñðÉ•ÅÕ•ÍÑ•‘µ½Õ¹Ð€ðô€À¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1”µ½¹Ñ…¹Ð‘ÔË¥‘¥Ð‘½¥Ðƒ©ÑÉ”ÍÑÉ¥Ñ•µ•¹ÐÁ½Í¥Ñ¥˜¸œ¤ì(€€€ô(€€€½¹ÍÐ¹½Éµ…±¥é•‘µ½Õ¹Ð€ô9Õµ‰•È¡É•ÅÕ•ÍÑ•‘µ½Õ¹Ð¹Ñ½¥á• È¤¤ì(€€€¥˜€¡¹½Éµ…±¥é•‘µ½Õ¹Ð€ð½¹ÍÕµ•‘Q½Ñ…°¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1”µ½¹Ñ…¹Ð¹”Á•ÕÐÁ…Ìƒ©ÑÉ”¥¹›¥É¥•ÕÈ…ÔÑ½Ñ…°“¥«€ÕÑ¥±¥Ï¤½ÔÉ•µ‰½ÕÉÏ¤¸œ¤ì(€€€ô((€€€½¹ÍÐ¹•áÑA…åµ•¹Ñ…Ñ”€ô‰½‘ä¹Á…åµ•¹Ñ}‘…Ñ”€ôôôÕ¹‘•™¥¹•(€€€€€€üÕÉÉ•¹ÑA…åµ•¹Ñ…Ñ”(€€€€€€èMÑÉ¥¹œ¡‰½‘ä¹Á…åµ•¹Ñ}‘…Ñ”€üü€œœ¤¹ÑÉ¥´ ¤ì(€€€¥˜€ „½yq‘ìÑôµq‘ìÉôµq‘ìÉô¼¹Ñ•ÍÐ¡¹•áÑA…åµ•¹Ñ…Ñ”¤¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1„‘…Ñ”‘ÔË¥‘¥Ð±½…Ñ…¥É”•ÍÐ¥¹Ù…±¥‘”¸œ¤ì(€€€ô((€€€½¹ÍÐ¹•áÑI•™•É•¹”€ô‰½‘ä¹É•™•É•¹”€ôôôÕ¹‘•™¥¹•(€€€€€€ü€¡ÕÉÉ•¹ÑI•™•É•¹”ñð¹Õ±°¤(€€€€€€è€¡MÑÉ¥¹œ¡‰½‘ä¹É•™•É•¹”€üü€œœ¤¹ÑÉ¥´ ¤ñð¹Õ±°¤ì(€€€½¹ÍÐ¹•áÑ9½Ñ•Ì€ô‰½‘ä¹¹½Ñ•Ì€ôôôÕ¹‘•™¥¹•(€€€€€€ü€¡ÕÉÉ•¹Ñ9½Ñ•Ìñð¹Õ±°¤(€€€€€€è€¡MÑÉ¥¹œ¡‰½‘ä¹¹½Ñ•Ì€üü€œœ¤¹ÑÉ¥´ ¤ñð¹Õ±°¤ì((€€€½¹ÍÐ¹•áÑA…åµ•¹Ñ5•Ñ¡½€ô‰½‘ä¹Á…åµ•¹Ñ}µ•Ñ¡½€ôôôÕ¹‘•™¥¹•(€€€€€€üÕÉÉ•¹ÑA…åµ•¹Ñ5•Ñ¡½(€€€€€€èMÑÉ¥¹œ¡‰½‘ä¹Á…åµ•¹Ñ}µ•Ñ¡½€üü€œœ¤¹ÑÉ¥´ ¤¹Ñ½UÁÁ•É…Í” ¤ì(€€€¥˜€ …lM œ°€	9,œ°€5=	%1}5=9dt¹¥¹±Õ‘•Ì¡¹•áÑA…åµ•¹Ñ5•Ñ¡½¤¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 5½‘”‘”Á…¥•µ•¹Ð¥¹Ù…±¥‘”¸œ¤ì(€€€ô(€€€¥˜€¡¹•áÑA…åµ•¹Ñ5•Ñ¡½€„ôôÕÉÉ•¹ÑA…åµ•¹Ñ5•Ñ¡½€˜˜m¹•áÑA…åµ•¹Ñ5•Ñ¡½°ÕÉÉ•¹ÑA…åµ•¹Ñ5•Ñ¡½‘t¹¥¹±Õ‘•Ì 	9,œ¤¤ì(€€€€€Ñ¡É½Ü¹•Ü½¹™±¥Ñá•ÁÑ¥½¸ 1„µ½‘¥™¥…Ñ¥½¸‘Ôµ½‘”‘”Á…¥•µ•¹Ð‰…¹…¥É”¸•ÍÐÁ…ÌÍÕÁÁ½ÉÓ¥”Á½ÕÈ”Ë¥‘¥Ð¸œ¤ì(€€€ô((€€€½¹ÍÐ…µ½Õ¹Ñ¡…¹•€ô¹½Éµ…±¥é•‘µ½Õ¹Ð€„ôô9Õµ‰•È¡½É¥¥¹…±µ½Õ¹Ð¹Ñ½¥á• È¤¤ì(€€€½¹ÍÐÁ…åµ•¹Ñ…Ñ•¡…¹•€ô¹•áÑA…åµ•¹Ñ…Ñ”€„ôôÕÉÉ•¹ÑA…åµ•¹Ñ…Ñ”ì(€€€½¹ÍÐÉ•™•É•¹•¡…¹•€ô€¡¹•áÑI•™•É•¹”€üü€œœ¤€„ôôÕÉÉ•¹ÑI•™•É•¹”ì((€€€½¹ÍÐ±¥¹­•‘5½Ù•µ•¹Ð€ô…Ý…¥ÐÑ¡¥Ì¹±¥¹­•‘Q•¹…¹ÑÉ•‘¥Ñ…Í¡5½Ù•µ•¹Ñ%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹Ð°¥°Á…åµ•¹Ñ%¤ì(€€€¥˜€¡…µ½Õ¹Ñ¡…¹•€˜˜€…±¥¹­•‘5½Ù•µ•¹Ð¤ì(€€€€€Ñ¡É½Ü¹•Ü½¹™±¥Ñá•ÁÑ¥½¸ 1„½ÉÉ•Ñ¥½¸µ½»¥Ñ…¥É”‘¥É•Ñ”¸•ÍÐÁ…Ì‘¥ÍÁ½¹¥‰±”Á½ÕÈ”Ë¥‘¥Ð¸UÑ¥±¥Í•èÕ¹”ƒ¥É¥ÑÕÉ”‘”½ÉÉ•Ñ¥½¸½ÔÕ¸É•µ‰½ÕÉÍ•µ•¹Ð¸œ¤ì(€€€ô(€€€¥˜€¡…µ½Õ¹Ñ¡…¹•€˜˜±¥¹­•‘5½Ù•µ•¹Ð€˜˜MÑÉ¥¹œ¡±¥¹­•‘5½Ù•µ•¹Ð¹Í•ÍÍ¥½¹}ÍÑ…ÑÕÌ€üü€œœ¤€„ôô€=A8œ¤ì(€€€€€Ñ¡É½Ü¹•Ü½¹™±¥Ñá•ÁÑ¥½¸ 1„…¥ÍÍ”±§¥”•ÍÐ³ÑÑÕË¥”¸UÑ¥±¥Í•èÕ¹”ƒ¥É¥ÑÕÉ”‘”½ÉÉ•Ñ¥½¸¸œ¤ì(€€€ô(€€€¥˜€¡Á…åµ•¹Ñ…Ñ•¡…¹•€˜˜±¥¹­•‘5½Ù•µ•¹Ð€˜˜MÑÉ¥¹œ¡±¥¹­•‘5½Ù•µ•¹Ð¹Í•ÍÍ¥½¹}ÍÑ…ÑÕÌ€üü€œœ¤€„ôô€=A8œ¤ì(€€€€€Ñ¡É½Ü¹•Ü½¹™±¥Ñá•ÁÑ¥½¸ 1„…¥ÍÍ”±§¥”•ÍÐ³ÑÑÕË¥”¸UÑ¥±¥Í•èÕ¹”ƒ¥É¥ÑÕÉ”‘”½ÉÉ•Ñ¥½¸¸œ¤ì(€€€ô((€€€½¹ÍÐ•á¡…¹•I…Ñ•UÍ•€ôÕÉÉ•¹ä€ôôô€œ(€€€€€€ü9Õµ‰•È¡Á…åµ•¹Ð¹•á¡…¹•}É…Ñ•}ÕÍ•€üü±¥¹­•‘5½Ù•µ•¹Ðü¹•á¡…¹•}É…Ñ•}ÕÍ•€üü€À¤(€€€€€€è¹Õ±°ì(€€€¥˜€¡ÕÉÉ•¹ä€ôôô€œ€˜˜…µ½Õ¹Ñ¡…¹•€˜˜€„¡9Õµ‰•È¡•á¡…¹•I…Ñ•UÍ•¤€ø€À¤¤ì(€€€€€Ñ¡É½Ü¹•Ü½¹™±¥Ñá•ÁÑ¥½¸ %µÁ½ÍÍ¥‰±”‘”½ÉÉ¥•È”Ë¥‘¥ÐÍ…¹ÌÑ…Õà‘”¡…¹”Í½ÕÉ”Ù…±¥‘”¸œ¤ì(€€€ô(€€€½¹ÍÐ•á¡…¹•I…Ñ•…Ñ”€ôÕÉÉ•¹ä€ôôô€œ(€€€€€€üMÑÉ¥¹œ¡Á…åµ•¹Ð¹•á¡…¹•}É…Ñ•}‘…Ñ”€üü±¥¹­•‘5½Ù•µ•¹Ðü¹•á¡…¹•}É…Ñ•}‘…Ñ”€üüÕÉÉ•¹ÑA…åµ•¹Ñ…Ñ”¤(€€€€€€è¹Õ±°ì(€€€½¹ÍÐÑ½Ñ…±ÅÕ¥Ù…±•¹ÑUÍ€ôÕÉÉ•¹ä€ôôô€œ(€€€€€€ü9Õµ‰•È ¡¹½Éµ…±¥é•‘µ½Õ¹Ð€¼9Õµ‰•È¡•á¡…¹•I…Ñ•UÍ•ñð€Ä¤¤¹Ñ½¥á• È¤¤(€€€€€€è¹½Éµ…±¥é•‘µ½Õ¹Ðì(€€€½¹ÍÐ¹•áÑµ½Õ¹ÑUÍ€ôÕÉÉ•¹ä€ôôô€UMœ€ü¹½Éµ…±¥é•‘µ½Õ¹Ð€è€Àì(€€€½¹ÍÐ¹•áÑµ½Õ¹Ñ‘˜€ôÕÉÉ•¹ä€ôôô€œ€ü¹½Éµ…±¥é•‘µ½Õ¹Ð€è€Àì((€€€½¹ÍÐ‰•™½É•M¹…ÁÍ¡½Ð€ôì(€€€€€½É¥¥¹…±}…µ½Õ¹Ðè9Õµ‰•È¡É•‘¥Ð¹½É¥¥¹…±}…µ½Õ¹Ð€üü€À¤°(€€€€€É•µ…¥¹¥¹}…µ½Õ¹Ðè9Õµ‰•È¡É•‘¥Ð¹É•µ…¥¹¥¹}…µ½Õ¹Ð€üü€À¤°(€€€€€Á…åµ•¹Ñ}‘…Ñ”èÕÉÉ•¹ÑA…åµ•¹Ñ…Ñ”°(€€€€€É•™•É•¹”èÉ•‘¥Ð¹É•™•É•¹”€üüÁ…åµ•¹Ð¹É•™•É•¹”€üü¹Õ±°°(€€€€€¹½Ñ•ÌèÉ•‘¥Ð¹¹½Ñ•Ì€üüÁ…åµ•¹Ð¹¹½Ñ•Ì€üü¹Õ±°°(€€€€€Á…åµ•¹Ñ}µ•Ñ¡½èÕÉÉ•¹ÑA…åµ•¹Ñ5•Ñ¡½°(€€€€€…±±½…Ñ¥½¹}½Õ¹Ðè…±±½…Ñ¥½¹½Õ¹Ð°(€€€€€…±±½…Ñ¥½¹Í}Ñ½Ñ…°è…±±½…Ñ¥½¹ÍQ½Ñ…°°(€€€€€É•™Õ¹‘}½Õ¹ÐèÉ•™Õ¹‘½Õ¹Ð°(€€€€€É•™Õ¹‘Í}Ñ½Ñ…°èÉ•™Õ¹‘ÍQ½Ñ…°°(€€€€€ÕÉÉ•¹ä°(€€€€€…Í¡}µ½Ù•µ•¹Ñ}¥è9Õµ‰•È¡±¥¹­•‘5½Ù•µ•¹Ðü¹¥€üü€À¤ñð¹Õ±°°(€€€€€…Í¡}Í•ÍÍ¥½¹}ÍÑ…ÑÕÌè±¥¹­•‘5½Ù•µ•¹Ðü¹Í•ÍÍ¥½¹}ÍÑ…ÑÕÌ€üü¹Õ±°°(€€€ôì((€€€½¹ÍÐìÉ•µ…¥¹¥¹µ½Õ¹Ð°¹•áÑMÑ…ÑÕÌô€ôÑ¡¥Ì¹½µÁÕÑ•Q•¹…¹ÑÉ•‘¥Ñ	…±…¹•MÑ…Ñ”¡¹½Éµ…±¥é•‘µ½Õ¹Ð°…±±½…Ñ¥½¹ÍQ½Ñ…°°É•™Õ¹‘ÍQ½Ñ…°¤ì((€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€UAQÁ…åµ•¹ÑÌ(€€€€€€MPÁ…åµ•¹Ñ}‘…Ñ”€ô€È°(€€€€€€€€€€Á…åµ•¹Ñ}µ•Ñ¡½€ô€Ì°(€€€€€€€€€€É•™•É•¹”€ô€Ð°(€€€€€€€€€€¹½Ñ•Ì€ô€Ô°(€€€€€€€€€€…µ½Õ¹Ð€ô€Ø°(€€€€€€€€€€…µ½Õ¹Ñ}ÕÍ€ô€Ü°(€€€€€€€€€€…µ½Õ¹Ñ}‘˜€ô€à°(€€€€€€€€€€‘™}•ÅÕ¥Ù…±•¹Ñ}ÕÍ€ô€ä°(€€€€€€€€€€Ñ½Ñ…±}•ÅÕ¥Ù…±•¹Ñ}ÕÍ€ô€ÄÀ(€€€€€€]!I¥€ô€Ä(€€€€€€€€9½É…¹¥é…Ñ¥½¹}¥€ô€ÄÄ(€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U11€°(€€€€€l(€€€€€€€Á…åµ•¹Ñ%°(€€€€€€€¹•áÑA…åµ•¹Ñ…Ñ”°(€€€€€€€¹•áÑA…åµ•¹Ñ5•Ñ¡½°(€€€€€€€¹•áÑI•™•É•¹”°(€€€€€€€¹•áÑ9½Ñ•Ì°(€€€€€€€Ñ½Ñ…±ÅÕ¥Ù…±•¹ÑUÍ°(€€€€€€€¹•áÑµ½Õ¹ÑUÍ°(€€€€€€€¹•áÑµ½Õ¹Ñ‘˜°(€€€€€€€ÕÉÉ•¹ä€ôôô€œ€üÑ½Ñ…±ÅÕ¥Ù…±•¹ÑUÍ€è€À°(€€€€€€€Ñ½Ñ…±ÅÕ¥Ù…±•¹ÑUÍ°(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°(€€€€€t°(€€€€¤ì((€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€UAQÑ•¹…¹Ñ}É•‘¥ÑÌ(€€€€€€MP½É¥¥¹…±}…µ½Õ¹Ð€ô€È°(€€€€€€€€€€É•µ…¥¹¥¹}…µ½Õ¹Ð€ô€Ì°(€€€€€€€€€€ÍÑ…ÑÕÌ€ô€Ð°(€€€€€€€€€€Á…åµ•¹Ñ}‘…Ñ”€ô€Ô°(€€€€€€€€€€É•™•É•¹”€ô€Ø°(€€€€€€€€€€¹½Ñ•Ì€ô€Ü°(€€€€€€€€€€ÕÁ‘…Ñ•‘}…Ð€ô9=\ ¤(€€€€€€]!I¥€ô€Ä(€€€€€€€€9½É…¹¥é…Ñ¥½¹}¥€ô€à(€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U11€°(€€€€€l(€€€€€€€¥°(€€€€€€€¹½Éµ…±¥é•‘µ½Õ¹Ð°(€€€€€€€É•µ…¥¹¥¹µ½Õ¹Ð°(€€€€€€€¹•áÑMÑ…ÑÕÌ°(€€€€€€€¹•áÑA…åµ•¹Ñ…Ñ”°(€€€€€€€¹•áÑI•™•É•¹”°(€€€€€€€¹•áÑ9½Ñ•Ì°(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°(€€€€€t°(€€€€¤ì((€€€¥˜€¡±¥¹­•‘5½Ù•µ•¹Ð€˜˜€¡…µ½Õ¹Ñ¡…¹•ñðÁ…åµ•¹Ñ…Ñ•¡…¹•ñðÉ•™•É•¹•¡…¹•¤¤ì(€€€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€UAQ…Í¡}µ½Ù•µ•¹ÑÌ(€€€€€€€€MP…µ½Õ¹Ð€ô€È°(€€€€€€€€€€€€µ½Ù•µ•¹Ñ}‘…Ñ”€ô€Ì°(€€€€€€€€€€€€É•™•É•¹”€ô€Ð°(€€€€€€€€€€€€•á¡…¹•}É…Ñ•}ÕÍ•€ô€Ô°(€€€€€€€€€€€€•á¡…¹•}É…Ñ•}‘…Ñ”€ô€Ø°(€€€€€€€€€€€€•ÅÕ¥Ù…±•¹Ñ}ÕÍ€ô€Ü(€€€€€€€€]!I¥€ô€Ä(€€€€€€€€€€9½É…¹¥é…Ñ¥½¹}¥€ô€à(€€€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U11€°(€€€€€€€l(€€€€€€€€€9Õµ‰•È¡±¥¹­•‘5½Ù•µ•¹Ð¹¥¤°(€€€€€€€€€¹½Éµ…±¥é•‘µ½Õ¹Ð°(€€€€€€€€€¹•áÑA…åµ•¹Ñ…Ñ”°(€€€€€€€€€¹•áÑI•™•É•¹”°(€€€€€€€€€ÕÉÉ•¹ä€ôôô€œ€ü9Õµ‰•È¡•á¡…¹•I…Ñ•UÍ•¤€è¹Õ±°°(€€€€€€€€€ÕÉÉ•¹ä€ôôô€œ€ü•á¡…¹•I…Ñ•…Ñ”€è¹Õ±°°(€€€€€€€€€Ñ½Ñ…±ÅÕ¥Ù…±•¹ÑUÍ°(€€€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°(€€€€€€€t°(€€€€€€¤ì(€€€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€%9MIP%9Q<…Õ‘¥Ñ}±½Ì€¡½É…¹¥é…Ñ¥½¹}¥°ÕÍ•É}¥°…Ñ¥½¸°É•Í½ÕÉ”°É•Í½ÕÉ•}¥°µ•Ñ¡½°Á…Ñ °ÍÑ…ÑÕÍ}½‘”°µ•Ñ…‘…Ñ„¤(€€€€€€€€Y1UL€ Ä°€È°€Q99Q}I%Q}M=UI}5=Y59Q}UAQœ°€…Í œ°€Ì°€AQ œ°€Ð°€ÈÀÀ°€Ôèé)M=9¥€°(€€€€€€€l(€€€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°(€€€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•É% ¤€üü¹Õ±°°(€€€€€€€€€MÑÉ¥¹œ¡±¥¹­•‘5½Ù•µ•¹Ð¹¥¤°(€€€€€€€€€€½…Á¤½…Í ½µ½Ù•µ•¹ÑÌ¼‘í9Õµ‰•È¡±¥¹­•‘5½Ù•µ•¹Ð¹¥¥õ€°(€€€€€€€€€)M=8¹ÍÑÉ¥¹¥™ä¡ì(€€€€€€€€€€€Ñ•¹…¹Ñ}É•‘¥Ñ}¥è¥°(€€€€€€€€€€€É•…Í½¸°(€€€€€€€€€€€‰•™½É”èì(€€€€€€€€€€€€€…µ½Õ¹Ðè9Õµ‰•È¡±¥¹­•‘5½Ù•µ•¹Ð¹…µ½Õ¹Ð€üü€À¤°(€€€€€€€€€€€€€µ½Ù•µ•¹Ñ}‘…Ñ”èMÑÉ¥¹œ¡±¥¹­•‘5½Ù•µ•¹Ð¹µ½Ù•µ•¹Ñ}‘…Ñ”€üü€œœ¤¹Í±¥” À°€ÄÀ¤°(€€€€€€€€€€€€€É•™•É•¹”è±¥¹­•‘5½Ù•µ•¹Ð¹É•™•É•¹”€üü¹Õ±°°(€€€€€€€€€€€€€•ÅÕ¥Ù…±•¹Ñ}ÕÍè9Õµ‰•È¡±¥¹­•‘5½Ù•µ•¹Ð¹•ÅÕ¥Ù…±•¹Ñ}ÕÍ€üü€À¤°(€€€€€€€€€€€ô°(€€€€€€€€€€€…™Ñ•Èèì(€€€€€€€€€€€€€…µ½Õ¹Ðè¹½Éµ…±¥é•‘µ½Õ¹Ð°(€€€€€€€€€€€€€µ½Ù•µ•¹Ñ}‘…Ñ”è¹•áÑA…åµ•¹Ñ…Ñ”°(€€€€€€€€€€€€€É•™•É•¹”è¹•áÑI•™•É•¹”°(€€€€€€€€€€€€€•ÅÕ¥Ù…±•¹Ñ}ÕÍèÑ½Ñ…±ÅÕ¥Ù…±•¹ÑUÍ°(€€€€€€€€€€€ô°(€€€€€€€€€ô¤°(€€€€€€€t°(€€€€€€¤ì(€€€ô((€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€%9MIP%9Q<…Õ‘¥Ñ}±½Ì€¡½É…¹¥é…Ñ¥½¹}¥°ÕÍ•É}¥°…Ñ¥½¸°É•Í½ÕÉ”°É•Í½ÕÉ•}¥°µ•Ñ¡½°Á…Ñ °ÍÑ…ÑÕÍ}½‘”°µ•Ñ…‘…Ñ„¤(€€€€€€Y1UL€ Ä°€È°€Q99Q}I%Q}UAQœ°€Ñ•¹…¹Ñ}É•‘¥ÑÌœ°€Ì°€AQ œ°€Ð°€ÈÀÀ°€Ôèé)M=9¥€°(€€€€€l(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•É% ¤€üü¹Õ±°°(€€€€€€€MÑÉ¥¹œ¡¥¤°(€€€€€€€€½…Á¤½Ñ•¹…¹ÐµÉ•‘¥ÑÌ¼‘í¥‘õ€°(€€€€€€€)M=8¹ÍÑÉ¥¹¥™ä¡ì(€€€€€€€€€É•…Í½¸°(€€€€€€€€€‰•™½É”è‰•™½É•M¹…ÁÍ¡½Ð°(€€€€€€€€€…™Ñ•Èèì(€€€€€€€€€€€½É¥¥¹…±}…µ½Õ¹Ðè¹½Éµ…±¥é•‘µ½Õ¹Ð°(€€€€€€€€€€€É•µ…¥¹¥¹}…µ½Õ¹ÐèÉ•µ…¥¹¥¹µ½Õ¹Ð°(€€€€€€€€€€€Á…åµ•¹Ñ}‘…Ñ”è¹•áÑA…åµ•¹Ñ…Ñ”°(€€€€€€€€€€€É•™•É•¹”è¹•áÑI•™•É•¹”°(€€€€€€€€€€€¹½Ñ•Ìè¹•áÑ9½Ñ•Ì°(€€€€€€€€€€€Á…åµ•¹Ñ}µ•Ñ¡½è¹•áÑA…åµ•¹Ñ5•Ñ¡½°(€€€€€€€€€€€ÍÑ…ÑÕÌè¹•áÑMÑ…ÑÕÌ°(€€€€€€€€€€€ÕÉÉ•¹ä°(€€€€€€€€€€€…±±½…Ñ¥½¹Í}Ñ½Ñ…°è…±±½…Ñ¥½¹ÍQ½Ñ…°°(€€€€€€€€€€€É•™Õ¹‘Í}Ñ½Ñ…°èÉ•™Õ¹‘ÍQ½Ñ…°°(€€€€€€€€€€€…Í¡}µ½Ù•µ•¹Ñ}¥è9Õµ‰•È¡±¥¹­•‘5½Ù•µ•¹Ðü¹¥€üü€À¤ñð¹Õ±°°(€€€€€€€€€€€…Í¡}Í•ÍÍ¥½¹}ÍÑ…ÑÕÌè±¥¹­•‘5½Ù•µ•¹Ðü¹Í•ÍÍ¥½¹}ÍÑ…ÑÕÌ€üü¹Õ±°°(€€€€€€€€€ô°(€€€€€€€ô¤°(€€€€€t°(€€€€¤ì((€€€É•ÑÕÉ¸¥ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ¹•áÑQ•¹…¹ÑÉ•‘¥ÑI•™Õ¹‘I••¥ÁÑ9Õµ‰•È¡±¥•¹ÐèA½½±±¥•¹Ð¤ì(€€€½¹ÍÐå•…È€ô¹•Ü…Ñ” ¤¹•ÑÕ±±e•…È ¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P=1M¡5` ¡MU	MQI%9¡É••¥ÁÑ}¹Õµ‰•ÈI=4€Ä¤¤èé%9P¤°€À¤€¬€ÄLÙ…±Õ”(€€€€€€I=4Ñ•¹…¹Ñ}É•‘¥Ñ}É•™Õ¹‘Ì(€€€€€€]!IÉ••¥ÁÑ}¹Õµ‰•È1%-€È(€€€€€€€€9½É…¹¥é…Ñ¥½¹}¥€ô€Í€°(€€€€€mQI´‘íå•…Éô´¡lÀ´åt¬¥€°QI´‘íå•…Éô´•€°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€É•ÑÕÉ¸QI´‘íå•…Éô´‘íMÑÉ¥¹œ¡É½ÝÍlÁt¹Ù…±Õ”¤¹Á…‘MÑ…ÉÐ Ð°€œÀœ¥õ€ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÉ•™Õ¹‘Q•¹…¹ÑÉ•‘¥Ñ%¹QÉ…¹Í…Ñ¥½¸ (€€€±¥•¹ÐèA½½±±¥•¹Ð°(€€€¥è¹Õµ‰•È°(€€€‰½‘äèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø°(€€€…¹•±]¡½±•É•‘¥Ðè‰½½±•…¸°(€€¤ì(€€€½¹ÍÐÉ•‘¥ÑI•ÍÕ±Ð€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P€¨(€€€€€€I=4Ñ•¹…¹Ñ}É•‘¥ÑÌ(€€€€€€]!I¥€ô€Ä(€€€€€€€€9½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U10(€€€€€€=HUAQ€°(€€€€€m¥°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€½¹ÍÐÉ•‘¥Ð€ôÉ•ÅÕ¥É•I½Ü¡É•‘¥ÑI•ÍÕ±Ð¹É½ÝÍlÁt°€Q•¹…¹ÐÉ•‘¥Ðœ¤ì(€€€½¹ÍÐÉ•µ…¥¹¥¹	•™½É”€ô9Õµ‰•È¡É•‘¥Ð¹É•µ…¥¹¥¹}…µ½Õ¹Ð€üü€À¤ì(€€€¥˜€ „¡É•µ…¥¹¥¹	•™½É”€ø€À¤¤ì(€€€€€Ñ¡É½Ü¹•Ü½¹™±¥Ñá•ÁÑ¥½¸ ÕÕ¸Í½±‘”‘¥ÍÁ½¹¥‰±”ƒ€É•µ‰½ÕÉÍ•ÈÁ½ÕÈ”Ë¥‘¥Ð±½…Ñ…¥É”¸œ¤ì(€€€ô((€€€½¹ÍÐ…±±½…Ñ¥½¹MÑ…ÑÌ€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P=U9P ¨¤èé%9PL½Õ¹Ð°(€€€€€€€€€€€€€=1M¡MU4¡…µ½Õ¹Ñ}…ÁÁ±¥•¤°€À¤èé9U5I% ÄÐ°È¤LÑ½Ñ…°(€€€€€€I=4Ñ•¹…¹Ñ}É•‘¥Ñ}…±±½…Ñ¥½¹Ì(€€€€€€]!IÑ•¹…¹Ñ}É•‘¥Ñ}¥€ô€Ä(€€€€€€€€9½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U11€°(€€€€€m¥°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€½¹ÍÐÉ•™Õ¹‘MÑ…ÑÌ€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P=U9P ¨¤èé%9PL½Õ¹Ð°(€€€€€€€€€€€€€=1M¡MU4¡…µ½Õ¹Ð¤°€À¤èé9U5I% ÄÐ°È¤LÑ½Ñ…°(€€€€€€I=4Ñ•¹…¹Ñ}É•‘¥Ñ}É•™Õ¹‘Ì(€€€€€€]!IÑ•¹…¹Ñ}É•‘¥Ñ}¥€ô€Ä(€€€€€€€€9½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U11€°(€€€€€m¥°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€½¹ÍÐ…±±½…Ñ¥½¹½Õ¹Ð€ô9Õµ‰•È¡…±±½…Ñ¥½¹MÑ…ÑÌ¹É½ÝÍlÁtü¹½Õ¹Ð€üü€À¤ì(€€€½¹ÍÐÉ•™Õ¹‘½Õ¹Ð€ô9Õµ‰•È¡É•™Õ¹‘MÑ…ÑÌ¹É½ÝÍlÁtü¹½Õ¹Ð€üü€À¤ì(€€€½¹ÍÐÍ½ÕÉ•A…åµ•¹Ð€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P•á¡…¹•}É…Ñ•}ÕÍ•°•á¡…¹•}É…Ñ•}‘…Ñ”°‘™}•ÅÕ¥Ù…±•¹Ñ}ÕÍ°Ñ½Ñ…±}•ÅÕ¥Ù…±•¹Ñ}ÕÍ(€€€€€€I=4Á…åµ•¹ÑÌ(€€€€€€]!I¥€ô€Ä(€€€€€€€€9½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U11€°(€€€€€mÉ•‘¥Ð¹Í½ÕÉ•}Á…åµ•¹Ñ}¥°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€½¹ÍÐÁ…åµ•¹ÑI½Ü€ôÍ½ÕÉ•A…åµ•¹Ð¹É½ÝÍlÁtì(€€€¥˜€¡MÑÉ¥¹œ¡É•‘¥Ð¹ÕÉÉ•¹ä€üü€UMœ¤€ôôô€œ€˜˜€„¡9Õµ‰•È¡Á…åµ•¹ÑI½Üü¹•á¡…¹•}É…Ñ•}ÕÍ•€üü€À¤€ø€À¤¤ì(€€€€€Ñ¡É½Ü¹•Ü½¹™±¥Ñá•ÁÑ¥½¸ %µÁ½ÍÍ¥‰±”‘”É•µ‰½ÕÉÍ•È”Ë¥‘¥ÐÍ…¹ÌÑ…Õà‘”¡…¹”Í½ÕÉ”Ù…±¥‘”¸œ¤ì(€€€ô((€€€½¹ÍÐÉ•™Õ¹‘…Ñ”€ôMÑÉ¥¹œ¡‰½‘ä¹É•™Õ¹‘}‘…Ñ”€üü¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤¹Í±¥” À°€ÄÀ¤¤ì(€€€½¹ÍÐÁ…åµ•¹Ñ5•Ñ¡½€ôMÑÉ¥¹œ¡‰½‘ä¹Á…åµ•¹Ñ}µ•Ñ¡½€üü€M œ¤¹Ñ½UÁÁ•É…Í” ¤ì(€€€½¹ÍÐÉ•™•É•¹”€ôMÑÉ¥¹œ¡‰½‘ä¹É•™•É•¹”€üüQH´‘í¥‘ô´‘íÉ•™Õ¹‘…Ñ•õ€¤¹ÑÉ¥´ ¤ì(€€€½¹ÍÐÉ•…Í½¸€ôMÑÉ¥¹œ¡‰½‘ä¹É•…Í½¸€üü€œœ¤¹ÑÉ¥´ ¤ì(€€€¥˜€ …É•…Í½¸¤Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1”µ½Ñ¥˜•ÍÐ½‰±¥…Ñ½¥É”¸œ¤ì(€€€¥˜€ …lM œ°€	9,œ°€5=	%1}5=9dt¹¥¹±Õ‘•Ì¡Á…åµ•¹Ñ5•Ñ¡½¤¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 5½‘”‘”É•µ‰½ÕÉÍ•µ•¹Ð¥¹Ù…±¥‘”¸œ¤ì(€€€ô((€€€¥˜€¡…¹•±]¡½±•É•‘¥Ð¤ì(€€€€€¥˜€¡…±±½…Ñ¥½¹½Õ¹Ð€ø€À¤ì(€€€€€€€Ñ¡É½Ü¹•Ü½¹™±¥Ñá•ÁÑ¥½¸ ”Ë¥‘¥Ð„“¥«€ƒ¥Ó¤ÕÑ¥±¥Ï¤¸M•Õ°±”Í½±‘”‘¥ÍÁ½¹¥‰±”Á•ÕÐƒ©ÑÉ”É•µ‰½ÕÉÏ¤¸œ¤ì(€€€€€ô(€€€€€¥˜€¡É•™Õ¹‘½Õ¹Ð€ø€À¤ì(€€€€€€€Ñ¡É½Ü¹•Ü½¹™±¥Ñá•ÁÑ¥½¸ ”Ë¥‘¥Ð„“¥«€™…¥Ð°½‰©•ÐÕ¸É•µ‰½ÕÉÍ•µ•¹Ð¸0…¹¹Õ±…Ñ¥½¸±½‰…±”¸•ÍÐÁ±ÕÌ…ÕÑ½É¥Ï¥”¸œ¤ì(€€€€€ô(€€€€€¥˜€¡9Õµ‰•È¡É•‘¥Ð¹½É¥¥¹…±}…µ½Õ¹Ð€üü€À¤€„ôôÉ•µ…¥¹¥¹	•™½É”¤ì(€€€€€€€Ñ¡É½Ü¹•Ü½¹™±¥Ñá•ÁÑ¥½¸ M•Õ°Õ¸Ë¥‘¥ÐÑ½Ñ…±•µ•¹Ð¥¹ÕÑ¥±¥Ï¤Á•ÕÐƒ©ÑÉ”…¹¹Õ³¤¸œ¤ì(€€€€€ô(€€€ô((€€€½¹ÍÐÉ•ÅÕ•ÍÑ•‘µ½Õ¹Ð€ô…¹•±]¡½±•É•‘¥Ð€üÉ•µ…¥¹¥¹	•™½É”€è9Õµ‰•È¡‰½‘ä¹…µ½Õ¹Ð€üü€À¤ì(€€€¥˜€ …9Õµ‰•È¹¥Í¥¹¥Ñ”¡É•ÅÕ•ÍÑ•‘µ½Õ¹Ð¤ñðÉ•ÅÕ•ÍÑ•‘µ½Õ¹Ð€ðô€À¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 5½¹Ñ…¹Ð‘”É•µ‰½ÕÉÍ•µ•¹Ð¥¹Ù…±¥‘”¸œ¤ì(€€€ô(€€€½¹ÍÐ…µ½Õ¹Ð€ô9Õµ‰•È¡É•ÅÕ•ÍÑ•‘µ½Õ¹Ð¹Ñ½¥á• È¤¤ì(€€€¥˜€¡…µ½Õ¹Ð€øÉ•µ…¥¹¥¹	•™½É”¤ì(€€€€€Ñ¡É½Ü¹•Ü½¹™±¥Ñá•ÁÑ¥½¸ 1”µ½¹Ñ…¹Ð‘•µ…¹“¤“¥Á…ÍÍ”±”Í½±‘”‘¥ÍÁ½¹¥‰±”‘ÔË¥‘¥Ð¸œ¤ì(€€€ô((€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä M1PÁ}…‘Ù¥Í½Éå}á…Ñ}±½¬¡¡…Í¡Ñ•áÐ Ä¤¤œ°mÑ•¹…¹ÐµÉ•‘¥ÐµÉ•™Õ¹è‘íÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥ôè‘í¥‘õt¤ì((€€€½¹ÍÐ¥‘•µÁ½Ñ•¹å-•ä€ôMÑÉ¥¹œ (€€€€€‰½‘ä¹¥‘•µÁ½Ñ•¹å}­•ä(€€€€€€üül(€€€€€€€…¹•±]¡½±•É•‘¥Ð€ü€Q99Q}I%Q}90œ€è€Q99Q}I%Q}IU9œ°(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°(€€€€€€€¥°(€€€€€€€É•™Õ¹‘…Ñ”°(€€€€€€€…µ½Õ¹Ð¹Ñ½¥á• È¤°(€€€€€€€Á…åµ•¹Ñ5•Ñ¡½°(€€€€€€€É•™•É•¹”°(€€€€€t¹©½¥¸ œèœ¤°(€€€€¤ì(€€€½¹ÍÐ•á¥ÍÑ¥¹I•™Õ¹€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P¥(€€€€€€I=4Ñ•¹…¹Ñ}É•‘¥Ñ}É•™Õ¹‘Ì(€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€9¥‘•µÁ½Ñ•¹å}­•ä€ô€È(€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U10(€€€€€€1%5%P€Å€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°¥‘•µÁ½Ñ•¹å-•åt°(€€€€¤ì(€€€¥˜€¡•á¥ÍÑ¥¹I•™Õ¹¹É½ÝÍlÁt¤ì(€€€€€Ñ¡É½Ü¹•Ü½¹™±¥Ñá•ÁÑ¥½¸ •ÑÑ”½Ã¥É…Ñ¥½¸‘”É•µ‰½ÕÉÍ•µ•¹Ð„“¥«€ƒ¥Ó¤•¹É•¥ÍÑË¥”¸œ¤ì(€€€ô((€€€½¹ÍÐÉ••¥ÁÑ9Õµ‰•È€ô…Ý…¥ÐÑ¡¥Ì¹¹•áÑQ•¹…¹ÑÉ•‘¥ÑI•™Õ¹‘I••¥ÁÑ9Õµ‰•È¡±¥•¹Ð¤ì(€€€½¹ÍÐÉ•™Õ¹‘%¹Í•ÉÐ€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€%9MIP%9Q<Ñ•¹…¹Ñ}É•‘¥Ñ}É•™Õ¹‘Ì(€€€€€€€€¡½É…¹¥é…Ñ¥½¹}¥°Ñ•¹…¹Ñ}É•‘¥Ñ}¥°Ñ•¹…¹Ñ}¥°±•…Í•}¥°…µ½Õ¹Ð°ÕÉÉ•¹ä°É•™Õ¹‘}‘…Ñ”°Á…åµ•¹Ñ}µ•Ñ¡½°(€€€€€€€€É•™•É•¹”°É•…Í½¸°…Í¡}µ½Ù•µ•¹Ñ}¥°É••¥ÁÑ}¹Õµ‰•È°ÍÑ…ÑÕÌ°É•…Ñ•‘}‰ä°¥‘•µÁ½Ñ•¹å}­•ä¤(€€€€€€Y1UL(€€€€€€€€ Ä°€È°€Ì°€Ð°€Ô°€Ø°€Ü°€à°(€€€€€€€€€ä°€ÄÀ°9U10°€ÄÄ°€ÄÈ°€ÄÌ°€ÄÐ¤(€€€€€€IQUI9%9€©€°(€€€€€l(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°(€€€€€€€¥°(€€€€€€€É•‘¥Ð¹Ñ•¹…¹Ñ}¥°(€€€€€€€É•‘¥Ð¹±•…Í•}¥€üü¹Õ±°°(€€€€€€€…µ½Õ¹Ð°(€€€€€€€MÑÉ¥¹œ¡É•‘¥Ð¹ÕÉÉ•¹ä€üü€UMœ¤°(€€€€€€€É•™Õ¹‘…Ñ”°(€€€€€€€Á…åµ•¹Ñ5•Ñ¡½°(€€€€€€€É•™•É•¹”ñð¹Õ±°°(€€€€€€€É•…Í½¸°(€€€€€€€É••¥ÁÑ9Õµ‰•È°(€€€€€€€…¹•±]¡½±•É•‘¥Ð€ü€911œ€è€IU9œ°(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•É% ¤€üü¹Õ±°°(€€€€€€€¥‘•µÁ½Ñ•¹å-•ä°(€€€€€t°(€€€€¤ì(€€€½¹ÍÐÉ•™Õ¹€ôÉ•ÅÕ¥É•I½Ü¡É•™Õ¹‘%¹Í•ÉÐ¹É½ÝÍlÁt°€Q•¹…¹ÐÉ•‘¥ÐÉ•™Õ¹œ¤ì((€€€½¹ÍÐµ½Ù•µ•¹Ð€ô…Ý…¥ÐÑ¡¥Ì¹É•…Ñ•…Í¡5½Ù•µ•¹Ñ%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹Ð°ì(€€€€€ÑåÁ”è€=UPœ°(€€€€€…Ñ•½Éäè€Q99Q}I%Q}IU9œ°(€€€€€±…‰•°è…¹•±]¡½±•É•‘¥Ð€ü€¹¹Õ±…Ñ¥½¸‘”Ë¥‘¥Ð±½…Ñ…¥É”œ€è€I•µ‰½ÕÉÍ•µ•¹Ð‘”Ë¥‘¥Ð±½…Ñ…¥É”œ°(€€€€€…µ½Õ¹Ð°(€€€€€µ½Ù•µ•¹Ñ}‘…Ñ”èÉ•™Õ¹‘…Ñ”°(€€€€€Ñ•¹…¹Ñ}¥èÉ•‘¥Ð¹Ñ•¹…¹Ñ}¥°(€€€€€‘•ÍÉ¥ÁÑ¥½¸è…¹•±]¡½±•É•‘¥Ð€ü€¹¹Õ±…Ñ¥½¸‘”Ë¥‘¥Ð±½…Ñ…¥É”œ€è€I•µ‰½ÕÉÍ•µ•¹Ð‘”Ë¥‘¥Ð±½…Ñ…¥É”œ°(€€€€€É•™•É•¹”èÉ•™•É•¹”ñðÉ••¥ÁÑ9Õµ‰•È°(€€€€€ÕÉÉ•¹äèMÑÉ¥¹œ¡É•‘¥Ð¹ÕÉÉ•¹ä€üü€UMœ¤°(€€€€€•á¡…¹•}É…Ñ•}ÕÍ•èÁ…åµ•¹ÑI½Üü¹•á¡…¹•}É…Ñ•}ÕÍ•€üü¹Õ±°°(€€€€€•á¡…¹•}É…Ñ•}‘…Ñ”èÁ…åµ•¹ÑI½Üü¹•á¡…¹•}É…Ñ•}‘…Ñ”€üü¹Õ±°°(€€€€€•ÅÕ¥Ù…±•¹Ñ}ÕÍè(€€€€€€€MÑÉ¥¹œ¡É•‘¥Ð¹ÕÉÉ•¹ä€üü€UMœ¤€ôôô€œ(€€€€€€€€€€ü9Õµ‰•È ¡…µ½Õ¹Ð€¼9Õµ‰•È¡Á…åµ•¹ÑI½Üü¹•á¡…¹•}É…Ñ•}ÕÍ•€üü€Ä¤¤¹Ñ½¥á• È¤¤(€€€€€€€€€€è…µ½Õ¹Ð°(€€€€€Ñ•¹…¹Ñ}É•‘¥Ñ}¥èÉ•‘¥Ð¹¥°(€€€ô¤ì(€€€¥˜€¡…Ý…¥ÐÑ¡¥Ì¹½±Õµ¹á¥ÍÑÌ …Í¡}µ½Ù•µ•¹ÑÌœ°€Ñ•¹…¹Ñ}É•‘¥Ñ}¥œ¤¤ì(€€€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€UAQ…Í¡}µ½Ù•µ•¹ÑÌ(€€€€€€€€MPÑ•¹…¹Ñ}É•‘¥Ñ}¥€ô€Ä(€€€€€€€€]!I¥€ô€È9½É…¹¥é…Ñ¥½¹}¥€ô€Í€°(€€€€€€€mÉ•‘¥Ð¹¥°µ½Ù•µ•¹Ð¹¥°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€€€¤ì(€€€ô(€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€UAQÑ•¹…¹Ñ}É•‘¥Ñ}É•™Õ¹‘Ì(€€€€€€MP…Í¡}µ½Ù•µ•¹Ñ}¥€ô€È(€€€€€€]!I¥€ô€Ä9½É…¹¥é…Ñ¥½¹}¥€ô€Í€°(€€€€€mÉ•™Õ¹¹¥°µ½Ù•µ•¹Ð¹¥°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì((€€€½¹ÍÐÉ•µ…¥¹¥¹™Ñ•È€ô9Õµ‰•È ¡É•µ…¥¹¥¹	•™½É”€´…µ½Õ¹Ð¤¹Ñ½¥á• È¤¤ì(€€€½¹ÍÐ¹•áÑMÑ…ÑÕÌ€ô…¹•±]¡½±•É•‘¥Ð(€€€€€€ü€911œ(€€€€€€èÉ•µ…¥¹¥¹™Ñ•È€ðô€À(€€€€€€€€ü€IU9œ(€€€€€€€€è€AIQ%11e}UMœì(€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€UAQÑ•¹…¹Ñ}É•‘¥ÑÌ(€€€€€€MPÉ•µ…¥¹¥¹}…µ½Õ¹Ð€ô€È°(€€€€€€€€€€ÍÑ…ÑÕÌ€ô€Ì°(€€€€€€€€€€ÕÁ‘…Ñ•‘}…Ð€ô9=\ ¤(€€€€€€]!I¥€ô€Ä(€€€€€€€€9½É…¹¥é…Ñ¥½¹}¥€ô€Ñ€°(€€€€€mÉ•‘¥Ð¹¥°É•µ…¥¹¥¹™Ñ•È°¹•áÑMÑ…ÑÕÌ°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€%9MIP%9Q<…Õ‘¥Ñ}±½Ì€¡½É…¹¥é…Ñ¥½¹}¥°ÕÍ•É}¥°…Ñ¥½¸°É•Í½ÕÉ”°É•Í½ÕÉ•}¥°µ•Ñ¡½°Á…Ñ °ÍÑ…ÑÕÍ}½‘”°µ•Ñ…‘…Ñ„¤(€€€€€€Y1UL€ Ä°€È°€Ì°€Ñ•¹…¹Ñ}É•‘¥ÑÌœ°€Ð°€A=MPœ°€Ô°€ÈÀÀ°€Ø¥€°(€€€€€l(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•É% ¤€üü¹Õ±°°(€€€€€€€…¹•±]¡½±•É•‘¥Ð€ü€Q99Q}I%Q}911œ€è€Q99Q}I%Q}IU9œ°(€€€€€€€MÑÉ¥¹œ¡É•‘¥Ð¹¥¤°(€€€€€€€…¹•±]¡½±•É•‘¥Ð€ü€½…Á¤½Ñ•¹…¹ÐµÉ•‘¥ÑÌ¼‘íÉ•‘¥Ð¹¥‘ô½…¹•±€€è€½…Á¤½Ñ•¹…¹ÐµÉ•‘¥ÑÌ¼‘íÉ•‘¥Ð¹¥‘ô½É•™Õ¹‘€°(€€€€€€€)M=8¹ÍÑÉ¥¹¥™ä¡ì(€€€€€€€€€Ñ•¹…¹Ñ}É•‘¥Ñ}¥èÉ•‘¥Ð¹¥°(€€€€€€€€€Ñ•¹…¹Ñ}¥èÉ•‘¥Ð¹Ñ•¹…¹Ñ}¥°(€€€€€€€€€±•…Í•}¥èÉ•‘¥Ð¹±•…Í•}¥°(€€€€€€€€€ÁÉ•Ù¥½ÕÍ}É•µ…¥¹¥¹}…µ½Õ¹ÐèÉ•µ…¥¹¥¹	•™½É”°(€€€€€€€€€É•™Õ¹‘•‘}…µ½Õ¹Ðè…µ½Õ¹Ð°(€€€€€€€€€¹•Ý}É•µ…¥¹¥¹}…µ½Õ¹ÐèÉ•µ…¥¹¥¹™Ñ•È°(€€€€€€€€€ÕÉÉ•¹äèÉ•‘¥Ð¹ÕÉÉ•¹ä°(€€€€€€€€€É•…Í½¸°(€€€€€€€€€É•™Õ¹‘}¥èÉ•™Õ¹¹¥°(€€€€€€€€€É••¥ÁÑ}¹Õµ‰•ÈèÉ••¥ÁÑ9Õµ‰•È°(€€€€€€€€€…Í¡}µ½Ù•µ•¹Ñ}¥èµ½Ù•µ•¹Ð¹¥°(€€€€€€€ô¤°(€€€€€t°(€€€€¤ì((€€€É•ÑÕÉ¸ì(€€€€€É•‘¥Ðè…Ý…¥ÐÑ¡¥Ì¹Ñ•¹…¹ÑÉ•‘¥Ñ•Ñ…¥±%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹Ð°É•‘¥Ð¹¥¤°(€€€€€É•™Õ¹èì€¸¸¹É•™Õ¹°…Í¡}µ½Ù•µ•¹Ñ}¥èµ½Ù•µ•¹Ð¹¥°É••¥ÁÑ}¹Õµ‰•ÈèÉ••¥ÁÑ9Õµ‰•Èô°(€€€€€…Í¡}µ½Ù•µ•¹Ðèµ½Ù•µ•¹Ð°(€€€ôì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÑ•¹…¹ÑÉ•‘¥Ñ•Ñ…¥±%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹ÐèA½½±±¥•¹Ð°¥è¹Õµ‰•È¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1PÑŒ¸¨(€€€€€€I=4Ñ•¹…¹Ñ}É•‘¥ÑÌÑŒ(€€€€€€]!IÑŒ¹¥€ô€Ä(€€€€€€€€9ÑŒ¹½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€9ÑŒ¹‘•±•Ñ•‘}…Ð%L9U11€°(€€€€€m¥°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€É•ÑÕÉ¸É•ÅÕ¥É•I½Ü¡É½ÝÍlÁt°€Q•¹…¹ÐÉ•‘¥Ðœ¤ì(€ô((€…Íå¹ŒÉ•™É•Í¡%¹Ù½¥•MÑ…ÑÕÍ%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹ÐèA½½±±¥•¹Ð°½É…¹¥é…Ñ¥½¹%è¹Õµ‰•È°¥¹Ù½¥•%è¹Õµ‰•È¤ì(€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€UAQ¥¹Ù½¥•Ì¤(€€€€€€MPÍÑ…ÑÕÌ€ôM(€€€€€€€€]!8¤¹ÍÑ…ÑÕÌ€ô€IPœQ!8€IPœ(€€€€€€€€]!8¤¹ÍÑ…ÑÕÌ€ô€911œQ!8€911œ(€€€€€€€€]!8Ì¹Á…¥‘}…µ½Õ¹Ð€ðô€ÀQ!8€U9A%œ(€€€€€€€€]!8Ì¹Á…¥‘}…µ½Õ¹Ð€ð¤¹Ñ½Ñ…°Q!8€AIQ%0œ(€€€€€€€€1M€A%œ(€€€€€€9(€€€€€€I=4¥¹Ù½¥•}Á…åµ•¹Ñ}ÍÕµµ…ÉäÌ(€€€€€€]!IÌ¹¥¹Ù½¥•}¥€ô¤¹¥(€€€€€€€€9¤¹¥€ô€Ä(€€€€€€€€9¤¹½É…¹¥é…Ñ¥½¹}¥€ô€É€°(€€€€€m¥¹Ù½¥•%°½É…¹¥é…Ñ¥½¹%‘t°(€€€€¤ì(€ô((€…Íå¹ŒÕ¹¥Ñ=ÕÁ…Ñ¥½¹!¥ÍÑ½Éä¡Õ¹¥Ñ%è¹Õµ‰•È¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1P°¸¨°=9P¡Ð¹™¥ÉÍÑ}¹…µ”°€œ€œ°Ð¹±…ÍÑ}¹…µ”¤LÑ•¹…¹Ñ}¹…µ”°œ¹…µ½Õ¹ÐLÕ…É…¹Ñ••}…µ½Õ¹Ð°œ¹ÍÑ…ÑÕÌLÕ…É…¹Ñ••}ÍÑ…ÑÕÌ(€€€€€€I=4±•…Í•Ì°(€€€€€€)=%8Ñ•¹…¹ÑÌÐ=8Ð¹¥€ô°¹Ñ•¹…¹Ñ}¥(€€€€€€1P)=%8±•…Í•}Õ…É…¹Ñ••Ìœ=8œ¹±•…Í•}¥€ô°¹¥9œ¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€]!I°¹Õ¹¥Ñ}¥€ô€Ä9°¹½É…¹¥é…Ñ¥½¹}¥€ô€È9°¹‘•±•Ñ•‘}…Ð%L9U109°¹…É¡¥Ù•‘}…Ð%L9U10(€€€€€€=IH	d°¹ÍÑ…ÉÑ}‘…Ñ”M°°¹¥M€°(€€€€€mÕ¹¥Ñ%°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€É•ÑÕÉ¸É½ÝÌì(€ô((€…Íå¹ŒÑ•¹…¹Ñ1•…Í•Ì¡Ñ•¹…¹Ñ%è¹Õµ‰•È¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1P°¸¨°Ô¹¹Õµ‰•ÈLÕ¹¥Ñ}¹Õµ‰•È°ˆ¹¹…µ”L‰Õ¥±‘¥¹}¹…µ”°œ¹…µ½Õ¹ÐLÕ…É…¹Ñ••}…µ½Õ¹Ð°œ¹ÍÑ…ÑÕÌLÕ…É…¹Ñ••}ÍÑ…ÑÕÌ(€€€€€€I=4±•…Í•Ì°(€€€€€€)=%8Õ¹¥ÑÌÔ=8Ô¹¥€ô°¹Õ¹¥Ñ}¥(€€€€€€)=%8‰Õ¥±‘¥¹Ìˆ=8ˆ¹¥€ôÔ¹‰Õ¥±‘¥¹}¥(€€€€€€1P)=%8±•…Í•}Õ…É…¹Ñ••Ìœ=8œ¹±•…Í•}¥€ô°¹¥9œ¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€]!I°¹Ñ•¹…¹Ñ}¥€ô€Ä9°¹½É…¹¥é…Ñ¥½¹}¥€ô€È9°¹‘•±•Ñ•‘}…Ð%L9U109°¹…É¡¥Ù•‘}…Ð%L9U10(€€€€€€=IH	d°¹ÍÑ…ÉÑ}‘…Ñ”M°°¹¥M€°(€€€€€mÑ•¹…¹Ñ%°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€É•ÑÕÉ¸É½ÝÌì(€ô((€…Íå¹Œ…Ñ¥Ù•1•…Í•Í	å	Õ¥±‘¥¹œ¡‰Õ¥±‘¥¹%üè¹Õµ‰•È¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1P°¸¨°=9P¡Ð¹™¥ÉÍÑ}¹…µ”°€œ€œ°Ð¹±…ÍÑ}¹…µ”¤LÑ•¹…¹Ñ}¹…µ”°Ô¹¹Õµ‰•ÈLÕ¹¥Ñ}¹Õµ‰•È°ˆ¹¹…µ”L‰Õ¥±‘¥¹}¹…µ”(€€€€€€I=4±•…Í•Ì°(€€€€€€)=%8Ñ•¹…¹ÑÌÐ=8Ð¹¥€ô°¹Ñ•¹…¹Ñ}¥(€€€€€€)=%8Õ¹¥ÑÌÔ=8Ô¹¥€ô°¹Õ¹¥Ñ}¥(€€€€€€)=%8‰Õ¥±‘¥¹Ìˆ=8ˆ¹¥€ôÔ¹‰Õ¥±‘¥¹}¥(€€€€€€]!I°¹½É…¹¥é…Ñ¥½¹}¥€ô€Ä9°¹‘•±•Ñ•‘}…Ð%L9U109°¹…É¡¥Ù•‘}…Ð%L9U109°¹ÍÑ…ÑÕÌ€ô€Q%Yœ(€€€€€€€€9€ Èèé%9P%L9U10=Hˆ¹¥€ô€È¤(€€€€€€=IH	dˆ¹¹…µ”°Ô¹¹Õµ‰•É€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°‰Õ¥±‘¥¹%€üü¹Õ±±t°(€€€€¤ì(€€€É•ÑÕÉ¸É½ÝÌì(€ô((€…Íå¹ŒÉ•¹Ñ…±U¹¥ÑÍÙ…¥±…‰¥±¥Ñä ¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1Pˆ¹¹…µ”L‰Õ¥±‘¥¹}¹…µ”°Ô¹¥LÕ¹¥Ñ}¥°Ô¹¹Õµ‰•È°Ô¹ÍÑ…ÑÕÌ°(€€€€€€€€€€€€€M]!8°¹¥%L9U10Q!8€1¥‰É”œ1M€=ÕÃ¥”œ9L½ÕÁ…¹ä(€€€€€€I=4Õ¹¥ÑÌÔ(€€€€€€)=%8‰Õ¥±‘¥¹Ìˆ=8ˆ¹¥€ôÔ¹‰Õ¥±‘¥¹}¥(€€€€€€1P)=%8±•…Í•Ì°=8°¹Õ¹¥Ñ}¥€ôÔ¹¥9°¹ÍÑ…ÑÕÌ€ô€Q%Yœ9°¹‘•±•Ñ•‘}…Ð%L9U109°¹…É¡¥Ù•‘}…Ð%L9U10(€€€€€€]!IÔ¹½É…¹¥é…Ñ¥½¹}¥€ô€Ä9Ô¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€=IH	dˆ¹¹…µ”°Ô¹¹Õµ‰•É€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€É•ÑÕÉ¸É½ÝÌì(€ô((€…Íå¹ŒÉ•…Ñ•1•…Í•%¹Ù½¥”¡¥è¹Õµ‰•È¤ì(€€€½¹ÍÐ¥¹Ù½¥”€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÑÉ…¹Í…Ñ¥½¸¡…Íå¹Œ€¡±¥•¹Ð¤€ôøì(€€€€€½¹ÍÐ±•…Í”€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€M1P°¸¨°Ô¹‰Õ¥±‘¥¹}¥I=4±•…Í•Ì°)=%8Õ¹¥ÑÌÔ=8Ô¹¥€ô°¹Õ¹¥Ñ}¥]!I°¹¥€ô€Ä9°¹½É…¹¥é…Ñ¥½¹}¥€ô€È9°¹‘•±•Ñ•‘}…Ð%L9U109°¹…É¡¥Ù•‘}…Ð%L9U11€°(€€€€€€€m¥°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€€€¤ì(€€€€€½¹ÍÐÉ½Ü€ôÉ•ÅÕ¥É•I½Ü¡±•…Í”¹É½ÝÍlÁt°€1•…Í”œ¤ì(€€€€€½¹ÍÐÍ•ÅÕ•¹”€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä¡M1P=1M¡5` ¡MU	MQI%9¡¥¹Ù½¥•}¹Õµ‰•ÈI=4€Ä¤¤èé%9P¤°€À¤€¬€ÄLÙ…±Õ”I=4¥¹Ù½¥•Ì]!I¥¹Ù½¥•}¹Õµ‰•È1%-€É€°l(€€€€€€€%9X´‘í¹•Ü…Ñ” ¤¹•ÑÕ±±e•…È ¥ô´¡lÀ´åt¬¥€°(€€€€€€€%9X´‘í¹•Ü…Ñ” ¤¹•ÑÕ±±e•…È ¥ô´•€°(€€€€€t¤ì(€€€€€½¹ÍÐ¹•áÑ%€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä¡M1P¹•áÑÙ…° ¥¹Ù½¥•Í}¥‘}Í•Äœ¤èé%9PLÙ…±Õ•€¤ì(€€€€€½¹ÍÐ¹Õµ‰•È€ô%9X´‘í¹•Ü…Ñ” ¤¹•ÑÕ±±e•…È ¥ô´‘íMÑÉ¥¹œ¡Í•ÅÕ•¹”¹É½ÝÍlÁt¹Ù…±Õ”¤¹Á…‘MÑ…ÉÐ Ð°€œÀœ¥õ€ì(€€€€€½¹ÍÐÑ½‘…ä€ô¹•Ü…Ñ” ¤ì(€€€€€½¹ÍÐ‘Õ”€ô¹•Ü…Ñ”¡Ñ½‘…ä¹•ÑÕ±±e•…È ¤°Ñ½‘…ä¹•Ñ5½¹Ñ  ¤°€ÄÀ¤ì(€€€€€½¹ÍÐÉ•¹Ñµ½Õ¹Ð€ô9Õµ‰•È¡É½Ü¹µ½¹Ñ¡±å}É•¹Ð€üü€À¤€¬9Õµ‰•È¡É½Ü¹µ…¥¹Ñ•¹…¹•}™••}…µ½Õ¹Ð€üü€À¤ì(€€€€€½¹ÍÐÍå¹‘¥µ½Õ¹Ð€ô9Õµ‰•È¡É½Ü¹µ½¹Ñ¡±å}Íå¹‘¥}…µ½Õ¹Ð€üü€À¤ì(€€€€€½¹ÍÐÑ½Ñ…±µ½Õ¹Ð€ôÉ•¹Ñµ½Õ¹Ð€¬Íå¹‘¥µ½Õ¹Ðì(€€€€€½¹ÍÐ¥¹Ù½¥”€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€%9MIP%9Q<¥¹Ù½¥•Ì€¡¥°Ñ•¹…¹Ñ}¥°±•…Í•}¥°Õ¹¥Ñ}¥°‰Õ¥±‘¥¹}¥°¥¹Ù½¥•}¹Õµ‰•È°µ½¹Ñ °å•…È°¥ÍÍÕ•}‘…Ñ”°‘Õ•}‘…Ñ”°ÍÑ…ÑÕÌ°Ñ½Ñ…°°½É…¹¥é…Ñ¥½¹}¥¤(€€€€€€€€Y1UL€ Ä°€È°€Ì°€Ð°€Ô°€Ø°€Ü°€à°UII9Q}Q°€ä°€U9A%œ°€ÄÀ°€ÄÄ¤IQUI9%9€©€°(€€€€€€€m¹•áÑ%¹É½ÝÍlÁt¹Ù…±Õ”°É½Ü¹Ñ•¹…¹Ñ}¥°É½Ü¹¥°É½Ü¹Õ¹¥Ñ}¥°É½Ü¹‰Õ¥±‘¥¹}¥°¹Õµ‰•È°Ñ½‘…ä¹•Ñ5½¹Ñ  ¤€¬€Ä°Ñ½‘…ä¹•ÑÕ±±e•…È ¤°‘Õ”¹Ñ½%M=MÑÉ¥¹œ ¤¹Í±¥” À°€ÄÀ¤°Ñ½Ñ…±µ½Õ¹Ð°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€€€¤ì(€€€€€¥˜€¡É•¹Ñµ½Õ¹Ð€ø€À¤ì(€€€€€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€€€€%9MIP%9Q<¥¹Ù½¥•}¥Ñ•µÌ€¡¥¹Ù½¥•}¥°¥Ñ•µ}ÑåÁ”°‘•ÍÉ¥ÁÑ¥½¸°…µ½Õ¹Ð°½É…¹¥é…Ñ¥½¹}¥¤Y1UL€ Ä°€È°€Ì°€Ð°€Ô¤œ°(€€€€€€€€€m¥¹Ù½¥”¹É½ÝÍlÁt¹¥°€5½¹Ñ¡±äÉ•¹Ðœ°Ñ¡¥Ì¹¥¹Ù½¥•A•É¥½‘•ÍÉ¥ÁÑ¥½¸ 1½å•Èœ°Ñ½‘…ä¹•Ñ5½¹Ñ  ¤€¬€Ä°Ñ½‘…ä¹•ÑÕ±±e•…È ¤¤°É•¹Ñµ½Õ¹Ð°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€€€€€¤ì(€€€€€ô(€€€€€¥˜€¡Íå¹‘¥µ½Õ¹Ð€ø€À¤ì(€€€€€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€€€€%9MIP%9Q<¥¹Ù½¥•}¥Ñ•µÌ€¡¥¹Ù½¥•}¥°¥Ñ•µ}ÑåÁ”°‘•ÍÉ¥ÁÑ¥½¸°…µ½Õ¹Ð°½É…¹¥é…Ñ¥½¹}¥¤Y1UL€ Ä°€È°€Ì°€Ð°€Ô¤œ°(€€€€€€€€€m¥¹Ù½¥”¹É½ÝÍlÁt¹¥°€Må¹‘¥Œœ°Ñ¡¥Ì¹¥¹Ù½¥•A•É¥½‘•ÍÉ¥ÁÑ¥½¸ Må¹‘¥Œœ°Ñ½‘…ä¹•Ñ5½¹Ñ  ¤€¬€Ä°Ñ½‘…ä¹•ÑÕ±±e•…È ¤¤°Íå¹‘¥µ½Õ¹Ð°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€€€€€¤ì(€€€€€ô(€€€€€É•ÑÕÉ¸¥¹Ù½¥”¹É½ÝÍlÁtì(€€€ô¤ì(€€€Ù½¥Ñ¡¥Ì¹Í•¹‘1•…Í•%¹Ù½¥•µ…¥±%™¹…‰±•¡¥¹Ù½¥”¤¹…Ñ  ¡•ÉÉ½È¤€ôøì(€€€€€Ñ¡¥Ì¹±½•È¹•ÉÉ½È (€€€€€€€m%9Y=%t…Íå¹ŒÉ••¥ÁÐ•µ…¥°™…¥±•¥¹Ù½¥•%ô‘í9Õµ‰•È¡¥¹Ù½¥”¹¥¥ô½É…¹¥é…Ñ¥½¹%ô‘íÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥ôµ•ÍÍ…”ô‘í•ÉÉ½È¥¹ÍÑ…¹•½˜ÉÉ½È€ü•ÉÉ½È¹µ•ÍÍ…”€èMÑÉ¥¹œ¡•ÉÉ½È¥õ€°(€€€€€€¤ì(€€€ô¤ì(€€€É•ÑÕÉ¸¥¹Ù½¥”ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ…ÁÁ•¹‘%¹Ù½¥•%Ñ•µMÕµµ…É¥•Ì¡É½ÝÌèI•½ÉñÍÑÉ¥¹œ°…¹äùmt¤èAÉ½µ¥Í”ñI•½ÉñÍÑÉ¥¹œ°…¹äùmtøì(€€€½¹ÍÐ¥¹Ù½¥•%‘Ì€ôÉ½ÝÌ¹µ…À ¡É½Ü¤€ôø9Õµ‰•È¡É½Ü¹¥¤¤¹™¥±Ñ•È¡9Õµ‰•È¹¥Í¥¹¥Ñ”¤ì(€€€¥˜€ …¥¹Ù½¥•%‘Ì¹±•¹Ñ ¤É•ÑÕÉ¸É½ÝÌì(€€€½¹ÍÐÍÕµµ…É¥•Ì€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1P¥¹Ù½¥•}¥°(€€€€€€€€€€€€€=1M¡MU4¡M]!8¥Ñ•µ}ÑåÁ”€ô€5½¹Ñ¡±äÉ•¹Ðœ=H‘•ÍÉ¥ÁÑ¥½¸€ô€5½¹Ñ¡±äÉ•¹Ðœ=H‘•ÍÉ¥ÁÑ¥½¸%1%-€1½å•È€”œQ!8…µ½Õ¹Ð1M€À9¤°€À¤èé1=PLÉ•¹Ñ}…µ½Õ¹Ð°(€€€€€€€€€€€€€=1M¡MU4¡M]!8¥Ñ•µ}ÑåÁ”€ô€Må¹‘¥Œœ=H‘•ÍÉ¥ÁÑ¥½¸€ô€Må¹‘¥Œœ=H‘•ÍÉ¥ÁÑ¥½¸%1%-€Må¹‘¥Œ€”œQ!8…µ½Õ¹Ð1M€À9¤°€À¤èé1=PLÍå¹‘¥}…µ½Õ¹Ð°(€€€€€€€€€€€€€=1M¡)M=9	}¡)M=9	}	U%1}=	)P (€€€€€€€€€€€€€€€€¥œ°¥°(€€€€€€€€€€€€€€€€¥Ñ•µ}ÑåÁ”œ°¥Ñ•µ}ÑåÁ”°(€€€€€€€€€€€€€€€€‘•ÍÉ¥ÁÑ¥½¸œ°‘•ÍÉ¥ÁÑ¥½¸°(€€€€€€€€€€€€€€€€…µ½Õ¹Ðœ°…µ½Õ¹Ð(€€€€€€€€€€€€€€¤=IH	d¥¤°€mtœèé)M=9¤L¥Ñ•µÌ(€€€€€€I=4¥¹Ù½¥•}¥Ñ•µÌ(€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€9¥¹Ù½¥•}¥€ô9d Èèé%9Qmt¤(€€€€€€I=U@	d¥¹Ù½¥•}¥‘€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°¥¹Ù½¥•%‘Ít°(€€€€¤ì(€€€½¹ÍÐÍÕµµ…Éå5…À€ô¹•Ü5…Àñ¹Õµ‰•È°I•½ÉñÍÑÉ¥¹œ°…¹äøø¡ÍÕµµ…É¥•Ì¹É½ÝÌ¹µ…À ¡É½Ü¤€ôøm9Õµ‰•È¡É½Ü¹¥¹Ù½¥•}¥¤°É½Ü…ÌI•½ÉñÍÑÉ¥¹œ°…¹äùt¤¤ì(€€€É•ÑÕÉ¸É½ÝÌ¹µ…À ¡É½Ü¤€ôøì(€€€€€½¹ÍÐÍÕµµ…Éä€ôÍÕµµ…Éå5…À¹•Ð¡9Õµ‰•È¡É½Ü¹¥¤¤ì(€€€€€É•ÑÕÉ¸ì(€€€€€€€€¸¸¹É½Ü°(€€€€€€€É•¹Ñ}…µ½Õ¹Ðè9Õµ‰•È¡ÍÕµµ…Éäü¹É•¹Ñ}…µ½Õ¹Ð€üü€À¤°(€€€€€€€Íå¹‘¥}…µ½Õ¹Ðè9Õµ‰•È¡ÍÕµµ…Éäü¹Íå¹‘¥}…µ½Õ¹Ð€üü€À¤°(€€€€€€€¥Ñ•µÌèÉÉ…ä¹¥ÍÉÉ…ä¡ÍÕµµ…Éäü¹¥Ñ•µÌ¤€üÍÕµµ…Éä¹¥Ñ•µÌ€èmt°(€€€€€ôì(€€€ô¤ì(€ô((€ÁÉ¥Ù…Ñ”¥¹Ù½¥•A•É¥½‘•ÍÉ¥ÁÑ¥½¸¡ÁÉ•™¥àèÍÑÉ¥¹œ°µ½¹Ñ è¹Õµ‰•È°å•…Èè¹Õµ‰•È¤ì(€€€½¹ÍÐµ½¹Ñ¡1…‰•°€ôl©…¹Ù¥•Èœ°€™•ÙÉ¥•Èœ°€µ…ÉÌœ°€…ÙÉ¥°œ°€µ…¤œ°€©Õ¥¸œ°€©Õ¥±±•Ðœ°€…½ÕÐœ°€Í•ÁÑ•µ‰É”œ°€½Ñ½‰É”œ°€¹½Ù•µ‰É”œ°€‘••µ‰É”umµ½¹Ñ €´€Åt€üüMÑÉ¥¹œ¡µ½¹Ñ ¤ì(€€€É•ÑÕÉ¸€‘íÁÉ•™¥áô€‘íµ½¹Ñ¡1…‰•±ô€‘íå•…Éõ€ì(€ô((€…Íå¹ŒÉ•Á½ÉÑÍ…Í¡‰½…É ¤ì(€€€½¹ÍÐ½É…¹¥é…Ñ¥½¹%€ôÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤ì(€€€½¹ÍÐm½ÕÁ…Ñ¥½¸°É•Ù•¹Õ”°Á…åµ•¹ÑÌ°½Ù•É‘Õ”°Õ…É…¹Ñ••Ì°…Í¡t€ô…Ý…¥ÐAÉ½µ¥Í”¹…±°¡l(€€€€€Ñ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€€€M1PÍÑ…ÑÕÌL¹…µ”°=U9P ¨¤èé%9PLÙ…±Õ”(€€€€€€€€I=4Õ¹¥ÑÌ(€€€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Ä9‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€I=U@	dÍÑ…ÑÕÌ(€€€€€€€€=IH	dÍÑ…ÑÕÍ€°(€€€€€€€m½É…¹¥é…Ñ¥½¹%‘t°(€€€€€€¤°(€€€€€Ñ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€€€M1Pˆ¹¹…µ”°=1M¡MU4¡¤¹Ñ½Ñ…°¤°€À¤èé1=PLÙ…±Õ”(€€€€€€€€I=4‰Õ¥±‘¥¹Ìˆ(€€€€€€€€1P)=%8¥¹Ù½¥•Ì¤=8¤¹‰Õ¥±‘¥¹}¥€ôˆ¹¥9¤¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€]!Iˆ¹½É…¹¥é…Ñ¥½¹}¥€ô€Ä9ˆ¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€I=U@	dˆ¹¥°ˆ¹¹…µ”(€€€€€€€€=IH	dˆ¹¹…µ•€°(€€€€€€€m½É…¹¥é…Ñ¥½¹%‘t°(€€€€€€¤°(€€€€€Ñ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€€€M1PQ=}!H¡Á…åµ•¹Ñ}‘…Ñ”°€eeedµ54œ¤L¹…µ”°=1M¡MU4¡…µ½Õ¹Ð¤°€À¤èé1=PLÙ…±Õ”(€€€€€€€€I=4Á…åµ•¹ÑÌ(€€€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Ä9‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€I=U@	dQ=}!H¡Á…åµ•¹Ñ}‘…Ñ”°€eeedµ54œ¤(€€€€€€€€=IH	d¹…µ•€°(€€€€€€€m½É…¹¥é…Ñ¥½¹%‘t°(€€€€€€¤°(€€€€€Ñ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€€€M1P=U9P ¨¤èé%9PL½Õ¹Ð°=1M¡MU4¡=1M¡Ì¹É•µ…¥¹¥¹}…µ½Õ¹Ð°¤¹Ñ½Ñ…°¤¤°€À¤èé1=PL…µ½Õ¹Ð(€€€€€€€€I=4¥¹Ù½¥•Ì¤(€€€€€€€€1P)=%8¥¹Ù½¥•}Á…åµ•¹Ñ}ÍÕµµ…ÉäÌ=8Ì¹¥¹Ù½¥•}¥€ô¤¹¥(€€€€€€€€]!I¤¹½É…¹¥é…Ñ¥½¹}¥€ô€Ä9¤¹‘•±•Ñ•‘}…Ð%L9U109¤¹ÍÑ…ÑÕÌ€ðø€A%œ9¤¹‘Õ•}‘…Ñ”€ðUII9Q}Q€°(€€€€€€€m½É…¹¥é…Ñ¥½¹%‘t°(€€€€€€¤°(€€€€€Ñ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€€€M1PÍÑ…ÑÕÌL¹…µ”°=U9P ¨¤èé%9PLÙ…±Õ”°=1M¡MU4¡…µ½Õ¹Ð¤°€À¤èé1=PL…µ½Õ¹Ð(€€€€€€€€I=4±•…Í•}Õ…É…¹Ñ••Ì(€€€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Ä9‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€I=U@	dÍÑ…ÑÕÌ(€€€€€€€€=IH	dÍÑ…ÑÕÍ€°(€€€€€€€m½É…¹¥é…Ñ¥½¹%‘t°(€€€€€€¤°(€€€€€Ñ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€€€M1P(€€€€€€€€€€=1M¡MU4¡M]!8ÑåÁ”€ô€%8œQ!8…µ½Õ¹Ð1M€À9¤°€À¤èé1=PLÑ½Ñ…±}¥¸°(€€€€€€€€€€=1M¡MU4¡M]!8ÑåÁ”€ô€=UPœQ!8…µ½Õ¹Ð1M€À9¤°€À¤èé1=PLÑ½Ñ…±}½ÕÐ(€€€€€€€€I=4…Í¡}µ½Ù•µ•¹ÑÌ(€€€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€€€9…Ñ•½Éä9=P%8€ 1M}UI9Qœ°€1M}UI9Q}IU9œ¥€°(€€€€€€€m½É…¹¥é…Ñ¥½¹%‘t°(€€€€€€¤°(€€€t¤ì(€€€É•ÑÕÉ¸ì(€€€€€½ÕÁ…Ñ¥½¸è½ÕÁ…Ñ¥½¸¹É½ÝÌ°(€€€€€É•Ù•¹Õ•}‰å}‰Õ¥±‘¥¹œèÉ•Ù•¹Õ”¹É½ÝÌ°(€€€€€µ½¹Ñ¡±å}Á…åµ•¹ÑÌèÁ…åµ•¹ÑÌ¹É½ÝÌ°(€€€€€½Ù•É‘Õ”è½Ù•É‘Õ”¹É½ÝÍlÁt°(€€€€€Õ…É…¹Ñ••ÌèÕ…É…¹Ñ••Ì¹É½ÝÌ°(€€€€€…Í¡}ÍÕµµ…Éäèì(€€€€€€€€¸¸¹…Í ¹É½ÝÍlÁt°(€€€€€€€‰…±…¹”è9Õµ‰•È¡…Í ¹É½ÝÍlÁtü¹Ñ½Ñ…±}¥¸€üü€À¤€´9Õµ‰•È¡…Í ¹É½ÝÍlÁtü¹Ñ½Ñ…±}½ÕÐ€üü€À¤°(€€€€€ô°(€€€ôì(€ô((€ÁÉ¥Ù…Ñ”É•Á½ÉÑA•É¥½¡™¥±Ñ•ÉÌèìµ½¹Ñ üèÍÑÉ¥¹œìå•…ÈüèÍÑÉ¥¹œìÍÑ…ÉÐüèÍÑÉ¥¹œì•¹üèÍÑÉ¥¹œô¤ì(€€€¥˜€¡™¥±Ñ•ÉÌ¹µ½¹Ñ €˜˜™¥±Ñ•ÉÌ¹å•…È¤ì(€€€€€½¹ÍÐµ½¹Ñ €ô9Õµ‰•È¡™¥±Ñ•ÉÌ¹µ½¹Ñ ¤ì(€€€€€½¹ÍÐå•…È€ô9Õµ‰•È¡™¥±Ñ•ÉÌ¹å•…È¤ì(€€€€€¥˜€¡µ½¹Ñ €øô€Ä€˜˜µ½¹Ñ €ðô€ÄÈ€˜˜å•…È€ø€ÄäÀÀ¤ì(€€€€€€€½¹ÍÐÁ…‘‘•‘5½¹Ñ €ôMÑÉ¥¹œ¡µ½¹Ñ ¤¹Á…‘MÑ…ÉÐ È°€œÀœ¤ì(€€€€€€€½¹ÍÐ±…ÍÑ…ä€ô¹•Ü…Ñ”¡…Ñ”¹UQ¡å•…È°µ½¹Ñ °€À¤¤¹Ñ½%M=MÑÉ¥¹œ ¤¹Í±¥” À°€ÄÀ¤ì(€€€€€€€É•ÑÕÉ¸ìÍÑ…ÉÐè€‘íå•…Éô´‘íÁ…‘‘•‘5½¹Ñ¡ô´ÀÅ€°•¹è±…ÍÑ…äôì(€€€€€ô(€€€ô(€€€É•ÑÕÉ¸ìÍÑ…ÉÐè™¥±Ñ•ÉÌ¹ÍÑ…ÉÐ€üü€œÈÀÀÀ´ÀÄ´ÀÄœ°•¹è™¥±Ñ•ÉÌ¹•¹€üü€œÈäää´ÄÈ´ÌÄœôì(€ô((€ÁÉ¥Ù…Ñ”¥¹Ù½¥•MÑ…ÑÕÍ±…ÕÍ”¡…±¥…ÌèÍÑÉ¥¹œ°Á…É…µ•Ñ•É%¹‘•àè¹Õµ‰•È¤ì(€€€É•ÑÕÉ¸€ ‘íÁ…É…µ•Ñ•É%¹‘•áôèéQaP%L9U10(€€€€€=H€ ‘íÁ…É…µ•Ñ•É%¹‘•áô€ô€=YIUœ9€‘í…±¥…Íô¹ÍÑ…ÑÕÌ€ðø€A%œ9€‘í…±¥…Íô¹‘Õ•}‘…Ñ”€ðUII9Q}Q¤(€€€€€=H€ ‘íÁ…É…µ•Ñ•É%¹‘•áô€ðø€=YIUœ9€‘í…±¥…Íô¹ÍÑ…ÑÕÌ€ô€‘íÁ…É…µ•Ñ•É%¹‘•áô¤¥€ì(€ô((€…Íå¹Œ‰Õ¥±‘¥¹I•Á½ÉÐ (€€€¥è¹Õµ‰•È°(€€€™¥±Ñ•ÉÌèìµ½¹Ñ üèÍÑÉ¥¹œìå•…ÈüèÍÑÉ¥¹œìÍÑ…ÉÐüèÍÑÉ¥¹œì•¹üèÍÑÉ¥¹œìÁ…åµ•¹ÑMÑ…ÑÕÌüèÍÑÉ¥¹œìÑ•¹…¹Ñ%üè¹Õµ‰•ÈìÕ¹¥Ñ%üè¹Õµ‰•Èô€ôíô°(€€¤ì(€€€½¹ÍÐ½É…¹¥é…Ñ¥½¹%€ôÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤ì(€€€½¹ÍÐÁ•É¥½€ôÑ¡¥Ì¹É•Á½ÉÑA•É¥½¡™¥±Ñ•ÉÌ¤ì(€€€½¹ÍÐÁ…É…µÌèÕ¹­¹½Ý¹mt€ôl(€€€€€¥°(€€€€€Á•É¥½¹ÍÑ…ÉÐ°(€€€€€Á•É¥½¹•¹°(€€€€€½É…¹¥é…Ñ¥½¹%°(€€€€€™¥±Ñ•ÉÌ¹Ñ•¹…¹Ñ%€üü¹Õ±°°(€€€€€™¥±Ñ•ÉÌ¹Õ¹¥Ñ%€üü¹Õ±°°(€€€€€™¥±Ñ•ÉÌ¹Á…åµ•¹ÑMÑ…ÑÕÌñð¹Õ±°°(€€€tì(€€€½¹ÍÐ‰Õ¥±‘¥¹œ€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä M1P€¨I=4‰Õ¥±‘¥¹Ì]!I¥€ô€Ä9½É…¹¥é…Ñ¥½¹}¥€ô€È9‘•±•Ñ•‘}…Ð%L9U10œ°m¥°½É…¹¥é…Ñ¥½¹%‘t¤ì(€€€½¹ÍÐÕ¹¥ÑÌ€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1P€¨I=4Õ¹¥ÑÌ(€€€€€€]!I‰Õ¥±‘¥¹}¥€ô€Ä9½É…¹¥é…Ñ¥½¹}¥€ô€È9‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€9€ Ìèé%9P%L9U10=H¥€ô€Ì¤(€€€€€€=IH	d¹Õµ‰•É€°(€€€€€m¥°½É…¹¥é…Ñ¥½¹%°™¥±Ñ•ÉÌ¹Õ¹¥Ñ%€üü¹Õ±±t°(€€€€¤ì(€€€½¹ÍÐÑ•¹…¹ÑÌ€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1P%MQ%9P=8€¡Ð¹¥¤(€€€€€€€€€€€€€Ð¹¥°=9P¡Ð¹™¥ÉÍÑ}¹…µ”°€œ€œ°Ð¹±…ÍÑ}¹…µ”¤LÑ•¹…¹Ñ}¹…µ”°Ð¹Á¡½¹”°Ð¹•µ…¥°°(€€€€€€€€€€€€€Ô¹¹Õµ‰•ÈLÕ¹¥Ñ}¹Õµ‰•È°°¹¥L±•…Í•}¥°°¹ÍÑ…ÑÕÌL±•…Í•}ÍÑ…ÑÕÌ°(€€€€€€€€€€€€€°¹µ½¹Ñ¡±å}É•¹Ð°°¹µ…¥¹Ñ•¹…¹•}™••}…µ½Õ¹Ð°°¹µ½¹Ñ¡±å}Íå¹‘¥}…µ½Õ¹Ð(€€€€€€I=4Ñ•¹…¹ÑÌÐ(€€€€€€)=%8±•…Í•Ì°=8°¹Ñ•¹…¹Ñ}¥€ôÐ¹¥9°¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€)=%8Õ¹¥ÑÌÔ=8Ô¹¥€ô°¹Õ¹¥Ñ}¥(€€€€€€]!IÔ¹‰Õ¥±‘¥¹}¥€ô€Ä9Ð¹½É…¹¥é…Ñ¥½¹}¥€ô€È9Ð¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€9€ Ìèé%9P%L9U10=HÐ¹¥€ô€Ì¤(€€€€€€€€9€ Ðèé%9P%L9U10=HÔ¹¥€ô€Ð¤(€€€€€€=IH	dÐ¹¥°°¹ÍÑ…ÑÕÌ€ô€Q%YœM°°¹ÍÑ…ÉÑ}‘…Ñ”M€°(€€€€€m¥°½É…¹¥é…Ñ¥½¹%°™¥±Ñ•ÉÌ¹Ñ•¹…¹Ñ%€üü¹Õ±°°™¥±Ñ•ÉÌ¹Õ¹¥Ñ%€üü¹Õ±±t°(€€€€¤ì(€€€½¹ÍÐ¥¹Ù½¥•Ì€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1P¤¹¥°¤¹Ñ•¹…¹Ñ}¥°¤¹¥¹Ù½¥•}¹Õµ‰•È°¤¹µ½¹Ñ °¤¹å•…È°¤¹¥ÍÍÕ•}‘…Ñ”°¤¹‘Õ•}‘…Ñ”°¤¹ÍÑ…ÑÕÌ°¤¹Ñ½Ñ…°°(€€€€€€€€€€€€€¤¹±…ÍÑ}É•µ¥¹‘•É}…Ð°=1M¡¤¹É•µ¥¹‘•É}½Õ¹Ð°€À¤èé%9PLÉ•µ¥¹‘•É}½Õ¹Ð°(€€€€€€€€€€€€€=9P¡Ð¹™¥ÉÍÑ}¹…µ”°€œ€œ°Ð¹±…ÍÑ}¹…µ”¤LÑ•¹…¹Ñ}¹…µ”°Ð¹Á¡½¹”°Ð¹•µ…¥°°(€€€€€€€€€€€€€Ô¹¹Õµ‰•ÈLÕ¹¥Ñ}¹Õµ‰•È°(€€€€€€€€€€€€€=1M¡Ì¹Á…¥‘}…µ½Õ¹Ð°€À¤èé1=PLÁ…¥‘}…µ½Õ¹Ð°(€€€€€€€€€€€€€=1M¡Ì¹É•µ…¥¹¥¹}…µ½Õ¹Ð°¤¹Ñ½Ñ…°¤èé1=PLÉ•µ…¥¹¥¹}…µ½Õ¹Ð(€€€€€€I=4¥¹Ù½¥•Ì¤(€€€€€€)=%8Ñ•¹…¹ÑÌÐ=8Ð¹¥€ô¤¹Ñ•¹…¹Ñ}¥(€€€€€€1P)=%8±•…Í•Ì°=8°¹¥€ô¤¹±•…Í•}¥(€€€€€€1P)=%8Õ¹¥ÑÌÔ=8Ô¹¥€ô=1M¡¤¹Õ¹¥Ñ}¥°°¹Õ¹¥Ñ}¥°Ð¹Õ¹¥Ñ}¥¤(€€€€€€1P)=%8¥¹Ù½¥•}Á…åµ•¹Ñ}ÍÕµµ…ÉäÌ=8Ì¹¥¹Ù½¥•}¥€ô¤¹¥(€€€€€€]!I=1M¡¤¹‰Õ¥±‘¥¹}¥°Ô¹‰Õ¥±‘¥¹}¥¤€ô€Ä(€€€€€€€€9¤¹¥ÍÍÕ•}‘…Ñ”	Q]8€È9€Ì(€€€€€€€€9¤¹½É…¹¥é…Ñ¥½¹}¥€ô€Ð(€€€€€€€€9¤¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€9€ Ôèé%9P%L9U10=H¤¹Ñ•¹…¹Ñ}¥€ô€Ô¤(€€€€€€€€9€ Øèé%9P%L9U10=H=1M¡¤¹Õ¹¥Ñ}¥°°¹Õ¹¥Ñ}¥°Ð¹Õ¹¥Ñ}¥¤€ô€Ø¤(€€€€€€€€9€‘íÑ¡¥Ì¹¥¹Ù½¥•MÑ…ÑÕÍ±…ÕÍ” ¤œ°€Ü¥ô(€€€€€€=IH	d¤¹¥ÍÍÕ•}‘…Ñ”M°¤¹¥¹Ù½¥•}¹Õµ‰•É€°(€€€€€Á…É…µÌ°(€€€€¤ì(€€€½¹ÍÐ¥¹Ù½¥•I½ÝÌ€ô…Ý…¥ÐÑ¡¥Ì¹…ÁÁ•¹‘%¹Ù½¥•%Ñ•µMÕµµ…É¥•Ì¡¥¹Ù½¥•Ì¹É½ÝÌ¤ì(€€€½¹ÍÐÁ…åµ•¹ÑÌ€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1PÀ¹¥°À¹Á…åµ•¹Ñ}‘…Ñ”°À¹…µ½Õ¹Ð°À¹Á…åµ•¹Ñ}µ•Ñ¡½°À¹É•™•É•¹”°(€€€€€€€€€€€€€¤¹¥¹Ù½¥•}¹Õµ‰•È°¤¹Ñ•¹…¹Ñ}¥°(€€€€€€€€€€€€€=9P¡Ð¹™¥ÉÍÑ}¹…µ”°€œ€œ°Ð¹±…ÍÑ}¹…µ”¤LÑ•¹…¹Ñ}¹…µ”°(€€€€€€€€€€€€€Ô¹¹Õµ‰•ÈLÕ¹¥Ñ}¹Õµ‰•È(€€€€€€I=4Á…åµ•¹ÑÌÀ(€€€€€€)=%8¥¹Ù½¥•Ì¤=8¤¹¥€ôÀ¹¥¹Ù½¥•}¥(€€€€€€)=%8Ñ•¹…¹ÑÌÐ=8Ð¹¥€ô¤¹Ñ•¹…¹Ñ}¥(€€€€€€1P)=%8±•…Í•Ì°=8°¹¥€ô¤¹±•…Í•}¥(€€€€€€1P)=%8Õ¹¥ÑÌÔ=8Ô¹¥€ô=1M¡¤¹Õ¹¥Ñ}¥°°¹Õ¹¥Ñ}¥°Ð¹Õ¹¥Ñ}¥¤(€€€€€€]!I=1M¡¤¹‰Õ¥±‘¥¹}¥°Ô¹‰Õ¥±‘¥¹}¥¤€ô€Ä(€€€€€€€€9À¹Á…åµ•¹Ñ}‘…Ñ”	Q]8€È9€Ì(€€€€€€€€9À¹½É…¹¥é…Ñ¥½¹}¥€ô€Ð(€€€€€€€€9À¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€9€ Ôèé%9P%L9U10=H¤¹Ñ•¹…¹Ñ}¥€ô€Ô¤(€€€€€€€€9€ Øèé%9P%L9U10=H=1M¡¤¹Õ¹¥Ñ}¥°°¹Õ¹¥Ñ}¥°Ð¹Õ¹¥Ñ}¥¤€ô€Ø¤(€€€€€€€€9€‘íÑ¡¥Ì¹¥¹Ù½¥•MÑ…ÑÕÍ±…ÕÍ” ¤œ°€Ü¥ô(€€€€€€=IH	dÀ¹Á…åµ•¹Ñ}‘…Ñ”M°À¹¥M€°(€€€€€Á…É…µÌ°(€€€€¤ì(€€€½¹ÍÐÁ…¥‘Q•¹…¹Ñ%‘Ì€ô¹•ÜM•Ð¡Á…åµ•¹ÑÌ¹É½ÝÌ¹µ…À ¡É½Ü¤€ôøÉ½Ü¹Ñ•¹…¹Ñ}¥¤¹™¥±Ñ•È¡	½½±•…¸¤¤ì(€€€½¹ÍÐÑ•¹…¹ÑÍA…¥€ôÉÉ…ä¹™É½´ (€€€€€¹•Ü5…À (€€€€€€€Á…åµ•¹ÑÌ¹É½ÝÌ(€€€€€€€€€€¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹Ñ•¹…¹Ñ}¥¤(€€€€€€€€€€¹µ…À ¡É½Ü¤€ôøì(€€€€€€€€€€€½¹ÍÐÑ•¹…¹Ð€ôÑ•¹…¹ÑÌ¹É½ÝÌ¹™¥¹ ¡¥Ñ•´¤€ôø9Õµ‰•È¡¥Ñ•´¹¥¤€ôôô9Õµ‰•È¡É½Ü¹Ñ•¹…¹Ñ}¥¤¤ì(€€€€€€€€€€€É•ÑÕÉ¸mÉ½Ü¹Ñ•¹…¹Ñ}¥°ìÑ•¹…¹Ñ}¥èÉ½Ü¹Ñ•¹…¹Ñ}¥°Ñ•¹…¹Ñ}¹…µ”èÉ½Ü¹Ñ•¹…¹Ñ}¹…µ”°Õ¹¥Ñ}¹Õµ‰•ÈèÉ½Ü¹Õ¹¥Ñ}¹Õµ‰•È°Á¡½¹”èÑ•¹…¹Ðü¹Á¡½¹”°•µ…¥°èÑ•¹…¹Ðü¹•µ…¥°õtì(€€€€€€€€€ô¤°(€€€€€€¤¹Ù…±Õ•Ì ¤°(€€€€¤ì(€€€½¹ÍÐÑ•¹…¹ÑÍU¹Á…¥€ôÉÉ…ä¹™É½´ (€€€€€¹•Ü5…À (€€€€€€€¥¹Ù½¥•I½ÝÌ(€€€€€€€€€€¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹Ñ•¹…¹Ñ}¥€˜˜€…Á…¥‘Q•¹…¹Ñ%‘Ì¹¡…Ì¡É½Ü¹Ñ•¹…¹Ñ}¥¤€˜˜É½Ü¹ÍÑ…ÑÕÌ€„ôô€A%œ¤(€€€€€€€€€€¹µ…À ¡É½Ü¤€ôøl(€€€€€€€€€€€É½Ü¹Ñ•¹…¹Ñ}¥°(€€€€€€€€€€€ì(€€€€€€€€€€€€€Ñ•¹…¹Ñ}¥èÉ½Ü¹Ñ•¹…¹Ñ}¥°(€€€€€€€€€€€€€Ñ•¹…¹Ñ}¹…µ”èÉ½Ü¹Ñ•¹…¹Ñ}¹…µ”°(€€€€€€€€€€€€€Á¡½¹”èÉ½Ü¹Á¡½¹”°(€€€€€€€€€€€€€•µ…¥°èÉ½Ü¹•µ…¥°°(€€€€€€€€€€€€€Õ¹¥Ñ}¹Õµ‰•ÈèÉ½Ü¹Õ¹¥Ñ}¹Õµ‰•È°(€€€€€€€€€€€€€¥¹Ù½¥•}¥èÉ½Ü¹¥°(€€€€€€€€€€€€€¥¹Ù½¥•}¹Õµ‰•ÈèÉ½Ü¹¥¹Ù½¥•}¹Õµ‰•È°(€€€€€€€€€€€€€É•µ…¥¹¥¹}…µ½Õ¹ÐèÉ½Ü¹É•µ…¥¹¥¹}…µ½Õ¹Ð°(€€€€€€€€€€€€€±…ÍÑ}É•µ¥¹‘•É}…ÐèÉ½Ü¹±…ÍÑ}É•µ¥¹‘•É}…Ð°(€€€€€€€€€€€€€É•µ¥¹‘•É}½Õ¹ÐèÉ½Ü¹É•µ¥¹‘•É}½Õ¹Ð°(€€€€€€€€€€€ô°(€€€€€€€€€t¤°(€€€€€€¤¹Ù…±Õ•Ì ¤°(€€€€¤ì(€€€½¹ÍÐÑ•¹…¹ÑM¥ÑÕ…Ñ¥½¹Ì€ôÑ•¹…¹ÑÌ¹É½ÝÌ¹µ…À ¡Ñ•¹…¹Ð¤€ôøì(€€€€€½¹ÍÐÑ•¹…¹Ñ%¹Ù½¥•Ì€ô¥¹Ù½¥•I½ÝÌ¹™¥±Ñ•È ¡¥¹Ù½¥”¤€ôø9Õµ‰•È¡¥¹Ù½¥”¹Ñ•¹…¹Ñ}¥¤€ôôô9Õµ‰•È¡Ñ•¹…¹Ð¹¥¤¤ì(€€€€€½¹ÍÐÑ½Ñ…±%¹Ù½¥•€ôÑ•¹…¹Ñ%¹Ù½¥•Ì¹É•‘Õ” ¡ÍÕ´°¥¹Ù½¥”¤€ôøÍÕ´€¬9Õµ‰•È¡¥¹Ù½¥”¹Ñ½Ñ…°¤°€À¤ì(€€€€€½¹ÍÐÑ½Ñ…±A…¥€ôÑ•¹…¹Ñ%¹Ù½¥•Ì¹É•‘Õ” ¡ÍÕ´°¥¹Ù½¥”¤€ôøÍÕ´€¬9Õµ‰•È¡¥¹Ù½¥”¹Á…¥‘}…µ½Õ¹Ð¤°€À¤ì(€€€€€½¹ÍÐÉ•µ…¥¹¥¹œ€ôÑ•¹…¹Ñ%¹Ù½¥•Ì¹É•‘Õ” ¡ÍÕ´°¥¹Ù½¥”¤€ôøÍÕ´€¬9Õµ‰•È¡¥¹Ù½¥”¹É•µ…¥¹¥¹}…µ½Õ¹Ð¤°€À¤ì(€€€€€½¹ÍÐÑ½Ñ…±I•¹Ñ%¹Ù½¥•€ôÑ•¹…¹Ñ%¹Ù½¥•Ì¹É•‘Õ” ¡ÍÕ´°¥¹Ù½¥”¤€ôøÍÕ´€¬9Õµ‰•È¡¥¹Ù½¥”¹É•¹Ñ}…µ½Õ¹Ð€üü€À¤°€À¤ì(€€€€€½¹ÍÐÑ½Ñ…±Må¹‘¥%¹Ù½¥•€ôÑ•¹…¹Ñ%¹Ù½¥•Ì¹É•‘Õ” ¡ÍÕ´°¥¹Ù½¥”¤€ôøÍÕ´€¬9Õµ‰•È¡¥¹Ù½¥”¹Íå¹‘¥}…µ½Õ¹Ð€üü€À¤°€À¤ì(€€€€€½¹ÍÐÁ…¥‘½Õ¹Ð€ôÑ•¹…¹Ñ%¹Ù½¥•Ì¹™¥±Ñ•È ¡¥¹Ù½¥”¤€ôø¥¹Ù½¥”¹ÍÑ…ÑÕÌ€ôôô€A%œ¤¹±•¹Ñ ì(€€€€€½¹ÍÐÁ…ÉÑ¥…±½Õ¹Ð€ôÑ•¹…¹Ñ%¹Ù½¥•Ì¹™¥±Ñ•È ¡¥¹Ù½¥”¤€ôø¥¹Ù½¥”¹ÍÑ…ÑÕÌ€ôôô€AIQ%0œ¤¹±•¹Ñ ì(€€€€€½¹ÍÐÕ¹Á…¥‘½Õ¹Ð€ôÑ•¹…¹Ñ%¹Ù½¥•Ì¹™¥±Ñ•È ¡¥¹Ù½¥”¤€ôø¥¹Ù½¥”¹ÍÑ…ÑÕÌ€ôôô€U9A%œ¤¹±•¹Ñ ì(€€€€€½¹ÍÐ½Ù•É‘Õ•½Õ¹Ð€ôÑ•¹…¹Ñ%¹Ù½¥•Ì¹™¥±Ñ•È ¡¥¹Ù½¥”¤€ôø¥¹Ù½¥”¹ÍÑ…ÑÕÌ€„ôô€A%œ€˜˜¹•Ü…Ñ”¡¥¹Ù½¥”¹‘Õ•}‘…Ñ”¤€ð¹•Ü…Ñ” ¤¤¹±•¹Ñ ì(€€€€€É•ÑÕÉ¸ì(€€€€€€€€¸¸¹Ñ•¹…¹Ð°(€€€€€€€Á…åµ•¹Ñ}ÍÑ…ÑÕÌèÑ•¹…¹Ñ%¹Ù½¥•Ì¹±•¹Ñ €ôôô€À€ü€9=Q}%9Y=%œ€è½Ù•É‘Õ•½Õ¹Ð€ø€À€˜˜É•µ…¥¹¥¹œ€ø€À€ü€=YIUœ€èÉ•µ…¥¹¥¹œ€ðô€À€ü€A%œ€èÑ½Ñ…±A…¥€ø€À€ü€AIQ%0œ€è€U9A%œ°(€€€€€€€Ñ½Ñ…±}¥¹Ù½¥•èÑ½Ñ…±%¹Ù½¥•°(€€€€€€€Ñ½Ñ…±}É•¹Ñ}¥¹Ù½¥•èÑ½Ñ…±I•¹Ñ%¹Ù½¥•°(€€€€€€€Ñ½Ñ…±}Íå¹‘¥}¥¹Ù½¥•èÑ½Ñ…±Må¹‘¥%¹Ù½¥•°(€€€€€€€Ñ½Ñ…±}Á…¥èÑ½Ñ…±A…¥°(€€€€€€€É•µ…¥¹¥¹}…µ½Õ¹ÐèÉ•µ…¥¹¥¹œ°(€€€€€€€Á…¥‘}¥¹Ù½¥•ÌèÁ…¥‘½Õ¹Ð°(€€€€€€€Á…ÉÑ¥…±}¥¹Ù½¥•ÌèÁ…ÉÑ¥…±½Õ¹Ð°(€€€€€€€Õ¹Á…¥‘}¥¹Ù½¥•ÌèÕ¹Á…¥‘½Õ¹Ð°(€€€€€€€½Ù•É‘Õ•}¥¹Ù½¥•Ìè½Ù•É‘Õ•½Õ¹Ð°(€€€€€ôì(€€€ô¤ì(€€€½¹ÍÐ‰Õ¥±‘¥¹I½Ü€ôÉ•ÅÕ¥É•I½Ü¡‰Õ¥±‘¥¹œ¹É½ÝÍlÁt°€	Õ¥±‘¥¹œœ¤ì(€€€½¹ÍÐÉ•…±U¹¥ÑÍQ½Ñ…°€ôÕ¹¥ÑÌ¹É½ÝÌ¹±•¹Ñ ì(€€€½¹ÍÐ™…±±‰…­U¹¥ÑÍQ½Ñ…°€ô9Õµ‰•È¡‰Õ¥±‘¥¹I½Ü¹Ñ½Ñ…±}Õ¹¥ÑÌ€üü€À¤ì(€€€½¹ÍÐ‘¥ÍÁ±…åU¹¥ÑÍQ½Ñ…°€ôÉ•…±U¹¥ÑÍQ½Ñ…°€ø€À€üÉ•…±U¹¥ÑÍQ½Ñ…°€è™…±±‰…­U¹¥ÑÍQ½Ñ…°ì(€€€½¹ÍÐ½ÕÁ¥•€ôÕ¹¥ÑÌ¹É½ÝÌ¹™¥±Ñ•È ¡Õ¹¥Ð¤€ôøÕ¹¥Ð¹ÍÑ…ÑÕÌ€ôôô€=UA%œ¤¹±•¹Ñ ì(€€€½¹ÍÐÙ……¹Ð€ôÉ•…±U¹¥ÑÍQ½Ñ…°€ø€À€üÉ•…±U¹¥ÑÍQ½Ñ…°€´½ÕÁ¥•€è™…±±‰…­U¹¥ÑÍQ½Ñ…°ì(€€€½¹ÍÐ™¥¹…¹•MÕµµ…Éä€ôì(€€€€€¥¹Ù½¥•Ìè¥¹Ù½¥•I½ÝÌ¹±•¹Ñ °(€€€€€Á…¥‘}¥¹Ù½¥•Ìè¥¹Ù½¥•I½ÝÌ¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹ÍÑ…ÑÕÌ€ôôô€A%œ¤¹±•¹Ñ °(€€€€€Á…ÉÑ¥…±}¥¹Ù½¥•Ìè¥¹Ù½¥•I½ÝÌ¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹ÍÑ…ÑÕÌ€ôôô€AIQ%0œ¤¹±•¹Ñ °(€€€€€Õ¹Á…¥‘}¥¹Ù½¥•Ìè¥¹Ù½¥•I½ÝÌ¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹ÍÑ…ÑÕÌ€„ôô€A%œ€˜˜É½Ü¹ÍÑ…ÑÕÌ€„ôô€911œ¤¹±•¹Ñ °(€€€€€½Ù•É‘Õ•}¥¹Ù½¥•Ìè¥¹Ù½¥•I½ÝÌ¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹ÍÑ…ÑÕÌ€„ôô€A%œ€˜˜¹•Ü…Ñ”¡É½Ü¹‘Õ•}‘…Ñ”¤€ð¹•Ü…Ñ” ¤¤¹±•¹Ñ °(€€€€€Ñ½Ñ…±}¥¹Ù½¥•è¥¹Ù½¥•I½ÝÌ¹É•‘Õ” ¡ÍÕ´°É½Ü¤€ôøÍÕ´€¬9Õµ‰•È¡É½Ü¹Ñ½Ñ…°€üü€À¤°€À¤°(€€€€€Ñ½Ñ…±}É•¹Ñ}¥¹Ù½¥•è¥¹Ù½¥•I½ÝÌ¹É•‘Õ” ¡ÍÕ´°É½Ü¤€ôøÍÕ´€¬9Õµ‰•È¡É½Ü¹É•¹Ñ}…µ½Õ¹Ð€üü€À¤°€À¤°(€€€€€Ñ½Ñ…±}Íå¹‘¥}¥¹Ù½¥•è¥¹Ù½¥•I½ÝÌ¹É•‘Õ” ¡ÍÕ´°É½Ü¤€ôøÍÕ´€¬9Õµ‰•È¡É½Ü¹Íå¹‘¥}…µ½Õ¹Ð€üü€À¤°€À¤°(€€€€€Ñ½Ñ…±}Á…¥è¥¹Ù½¥•I½ÝÌ¹É•‘Õ” ¡ÍÕ´°É½Ü¤€ôøÍÕ´€¬9Õµ‰•È¡É½Ü¹Á…¥‘}…µ½Õ¹Ð€üü€À¤°€À¤°(€€€€€É•µ…¥¹¥¹œè¥¹Ù½¥•I½ÝÌ¹É•‘Õ” ¡ÍÕ´°É½Ü¤€ôøÍÕ´€¬9Õµ‰•È¡É½Ü¹É•µ…¥¹¥¹}…µ½Õ¹Ð€üü€À¤°€À¤°(€€€ôì(€€€É•ÑÕÉ¸ì(€€€€€‰Õ¥±‘¥¹œè‰Õ¥±‘¥¹I½Ü°(€€€€€Á•É¥½°(€€€€€™¥±Ñ•ÉÌ°(€€€€€Õ¹¥ÑÍ}Ñ½Ñ…°è‘¥ÍÁ±…åU¹¥ÑÍQ½Ñ…°°(€€€€€½ÕÁ¥•‘}Õ¹¥ÑÌè½ÕÁ¥•°(€€€€€Ù……¹Ñ}Õ¹¥ÑÌèÙ……¹Ð°(€€€€€½ÕÁ…¹å}É…Ñ”è‘¥ÍÁ±…åU¹¥ÑÍQ½Ñ…°€ü5…Ñ ¹É½Õ¹ ¡½ÕÁ¥•€¼‘¥ÍÁ±…åU¹¥ÑÍQ½Ñ…°¤€¨€ÄÀÀ¤€è€À°(€€€€€Ñ•¹…¹ÑÌèÑ•¹…¹ÑÌ¹É½ÝÌ°(€€€€€Ñ•¹…¹Ñ}Í¥ÑÕ…Ñ¥½¹ÌèÑ•¹…¹ÑM¥ÑÕ…Ñ¥½¹Ì°(€€€€€™¥¹…¹•Ìè™¥¹…¹•MÕµµ…Éä°(€€€€€Õ¹¥ÑÌèÕ¹¥ÑÌ¹É½ÝÌ°(€€€€€Á…åµ•¹ÑÌèÁ…åµ•¹ÑÌ¹É½ÝÌ°(€€€€€Ñ•¹…¹ÑÍ}Á…¥èÑ•¹…¹ÑÍA…¥°(€€€€€Ñ•¹…¹ÑÍ}Õ¹Á…¥èÑ•¹…¹ÑÍU¹Á…¥°(€€€€€Á…¥‘}¥¹Ù½¥•Ìè¥¹Ù½¥•I½ÝÌ¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹ÍÑ…ÑÕÌ€ôôô€A%œ¤°(€€€€€Á…ÉÑ¥…±}¥¹Ù½¥•Ìè¥¹Ù½¥•I½ÝÌ¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹ÍÑ…ÑÕÌ€ôôô€AIQ%0œ¤°(€€€€€Õ¹Á…¥‘}¥¹Ù½¥•Ìè¥¹Ù½¥•I½ÝÌ¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹ÍÑ…ÑÕÌ€ôôô€U9A%œ¤°(€€€€€½Ù•É‘Õ•}¥¹Ù½¥•Ìè¥¹Ù½¥•I½ÝÌ¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹ÍÑ…ÑÕÌ€„ôô€A%œ€˜˜¹•Ü…Ñ”¡É½Ü¹‘Õ•}‘…Ñ”¤€ð¹•Ü…Ñ” ¤¤°(€€€ôì(€ô((€…Íå¹ŒÁ…åµ•¹ÑÍI•Á½ÉÐ¡™¥±Ñ•ÉÌèìÍÑ…ÉÐüèÍÑÉ¥¹œì•¹üèÍÑÉ¥¹œì‰Õ¥±‘¥¹%üè¹Õµ‰•ÈìÑ•¹…¹Ñ%üè¹Õµ‰•ÈìÍÑ…ÑÕÌüèÍÑÉ¥¹œìÁ…åµ•¹Ñ5•Ñ¡½üèÍÑÉ¥¹œô€ôíô¤ì(€€€½¹ÍÐÍÑ…ÉÐ€ô™¥±Ñ•ÉÌ¹ÍÑ…ÉÐ€üü€œÈÀÀÀ´ÀÄ´ÀÄœì(€€€½¹ÍÐ•¹€ô™¥±Ñ•ÉÌ¹•¹€üü€œÈäää´ÄÈ´ÌÄœì(€€€½¹ÍÐ½É…¹¥é…Ñ¥½¹%€ôÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤ì(€€€½¹ÍÐ¥¹Ù½¥•Ì€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1P¤¸¨°=9P¡Ð¹™¥ÉÍÑ}¹…µ”°€œ€œ°Ð¹±…ÍÑ}¹…µ”¤LÑ•¹…¹Ñ}¹…µ”°ˆ¹¹…µ”L‰Õ¥±‘¥¹}¹…µ”°Ô¹¹Õµ‰•ÈLÕ¹¥Ñ}¹Õµ‰•È°(€€€€€€€€€€€€€=1M¡Ì¹Á…¥‘}…µ½Õ¹Ð°€À¤èé1=PLÁ…¥‘}…µ½Õ¹Ð°(€€€€€€€€€€€€€=1M¡Ì¹É•µ…¥¹¥¹}…µ½Õ¹Ð°¤¹Ñ½Ñ…°¤èé1=PLÉ•µ…¥¹¥¹}…µ½Õ¹Ð(€€€€€€I=4¥¹Ù½¥•Ì¤(€€€€€€)=%8Ñ•¹…¹ÑÌÐ=8Ð¹¥€ô¤¹Ñ•¹…¹Ñ}¥(€€€€€€1P)=%8Õ¹¥ÑÌÔ=8Ô¹¥€ô¤¹Õ¹¥Ñ}¥(€€€€€€1P)=%8‰Õ¥±‘¥¹Ìˆ=8ˆ¹¥€ô¤¹‰Õ¥±‘¥¹}¥(€€€€€€1P)=%8¥¹Ù½¥•}Á…åµ•¹Ñ}ÍÕµµ…ÉäÌ=8Ì¹¥¹Ù½¥•}¥€ô¤¹¥(€€€€€€]!I¤¹¥ÍÍÕ•}‘…Ñ”	Q]8€Ä9€È(€€€€€€€€9¤¹½É…¹¥é…Ñ¥½¹}¥€ô€Ø(€€€€€€€€9¤¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€9€ Ìèé%9P%L9U10=Hˆ¹¥€ô€Ì¤(€€€€€€€€9€ Ðèé%9P%L9U10=HÐ¹¥€ô€Ð¤(€€€€€€€€9€ ÔèéQaP%L9U10=H¤¹ÍÑ…ÑÕÌ€ô€Ô¤(€€€€€€=IH	d¤¹¥ÍÍÕ•}‘…Ñ”M€°(€€€€€mÍÑ…ÉÐ°•¹°™¥±Ñ•ÉÌ¹‰Õ¥±‘¥¹%€üü¹Õ±°°™¥±Ñ•ÉÌ¹Ñ•¹…¹Ñ%€üü¹Õ±°°™¥±Ñ•ÉÌ¹ÍÑ…ÑÕÌñð¹Õ±°°½É…¹¥é…Ñ¥½¹%‘t°(€€€€¤ì(€€€½¹ÍÐÁ…åµ•¹ÑÌ€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1PÀ¸¨°¤¹Ñ•¹…¹Ñ}¥°=9P¡Ð¹™¥ÉÍÑ}¹…µ”°€œ€œ°Ð¹±…ÍÑ}¹…µ”¤LÑ•¹…¹Ñ}¹…µ”°¤¹¥¹Ù½¥•}¹Õµ‰•È°¤¹ÍÑ…ÑÕÌL¥¹Ù½¥•}ÍÑ…ÑÕÌ°ˆ¹¹…µ”L‰Õ¥±‘¥¹}¹…µ”(€€€€€€I=4Á…åµ•¹ÑÌÀ(€€€€€€1P)=%8¥¹Ù½¥•Ì¤=8¤¹¥€ôÀ¹¥¹Ù½¥•}¥(€€€€€€1P)=%8Ñ•¹…¹ÑÌÐ=8Ð¹¥€ô¤¹Ñ•¹…¹Ñ}¥(€€€€€€1P)=%8‰Õ¥±‘¥¹Ìˆ=8ˆ¹¥€ô¤¹‰Õ¥±‘¥¹}¥(€€€€€€]!IÀ¹Á…åµ•¹Ñ}‘…Ñ”	Q]8€Ä9€È(€€€€€€€€9À¹½É…¹¥é…Ñ¥½¹}¥€ô€Ø(€€€€€€€€9À¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€9€ Ìèé%9P%L9U10=Hˆ¹¥€ô€Ì¤(€€€€€€€€9€ Ðèé%9P%L9U10=HÐ¹¥€ô€Ð¤(€€€€€€€€9€ ÔèéQaP%L9U10=HÀ¹Á…åµ•¹Ñ}µ•Ñ¡½€ô€Ô¤(€€€€€€=IH	dÀ¹Á…åµ•¹Ñ}‘…Ñ”M°À¹¥M€°(€€€€€mÍÑ…ÉÐ°•¹°™¥±Ñ•ÉÌ¹‰Õ¥±‘¥¹%€üü¹Õ±°°™¥±Ñ•ÉÌ¹Ñ•¹…¹Ñ%€üü¹Õ±°°™¥±Ñ•ÉÌ¹Á…åµ•¹Ñ5•Ñ¡½ñð¹Õ±°°½É…¹¥é…Ñ¥½¹%‘t°(€€€€¤ì(€€€½¹ÍÐÉ½ÝÌ€ô¥¹Ù½¥•Ì¹É½ÝÌì(€€€½¹ÍÐÁ…¥‘Q•¹…¹Ñ%‘Ì€ô¹•ÜM•Ð¡Á…åµ•¹ÑÌ¹É½ÝÌ¹µ…À ¡É½Ü¤€ôøÉ½Ü¹Ñ•¹…¹Ñ}¥¤¹™¥±Ñ•È¡	½½±•…¸¤¤ì(€€€É•ÑÕÉ¸ì(€€€€€Á…åµ•¹ÑÍ}É••¥Ù•èÁ…åµ•¹ÑÌ¹É½ÝÌ°(€€€€€¥¹Ù½¥•ÌèÉ½ÝÌ°(€€€€€Ñ½Ñ…±}¥¹Ù½¥•èÉ½ÝÌ¹É•‘Õ” ¡ÍÕ´°É½Ü¤€ôøÍÕ´€¬9Õµ‰•È¡É½Ü¹Ñ½Ñ…°¤°€À¤°(€€€€€Ñ½Ñ…±}Á…¥èÁ…åµ•¹ÑÌ¹É½ÝÌ¹É•‘Õ” ¡ÍÕ´°É½Ü¤€ôøÍÕ´€¬9Õµ‰•È¡É½Ü¹…µ½Õ¹Ð¤°€À¤°(€€€€€É•µ…¥¹¥¹œèÉ½ÝÌ¹É•‘Õ” ¡ÍÕ´°É½Ü¤€ôøÍÕ´€¬9Õµ‰•È¡É½Ü¹É•µ…¥¹¥¹}…µ½Õ¹Ð¤°€À¤°(€€€€€Ñ•¹…¹ÑÍ}Á…¥èÉÉ…ä¹™É½´¡¹•Ü5…À¡Á…åµ•¹ÑÌ¹É½ÝÌ¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹Ñ•¹…¹Ñ}¥¤¹µ…À ¡É½Ü¤€ôømÉ½Ü¹Ñ•¹…¹Ñ}¥°ìÑ•¹…¹Ñ}¥èÉ½Ü¹Ñ•¹…¹Ñ}¥°Ñ•¹…¹Ñ}¹…µ”èÉ½Ü¹Ñ•¹…¹Ñ}¹…µ”õt¤¤¹Ù…±Õ•Ì ¤¤°(€€€€€Ñ•¹…¹ÑÍ}Õ¹Á…¥èÉ½ÝÌ(€€€€€€€€¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹Ñ•¹…¹Ñ}¥€˜˜€…Á…¥‘Q•¹…¹Ñ%‘Ì¹¡…Ì¡É½Ü¹Ñ•¹…¹Ñ}¥¤€˜˜É½Ü¹ÍÑ…ÑÕÌ€„ôô€A%œ¤(€€€€€€€€¹µ…À ¡É½Ü¤€ôø€¡ìÑ•¹…¹Ñ}¥èÉ½Ü¹Ñ•¹…¹Ñ}¥°Ñ•¹…¹Ñ}¹…µ”èÉ½Ü¹Ñ•¹…¹Ñ}¹…µ”°¥¹Ù½¥•}¹Õµ‰•ÈèÉ½Ü¹¥¹Ù½¥•}¹Õµ‰•È°É•µ…¥¹¥¹}…µ½Õ¹ÐèÉ½Ü¹É•µ…¥¹¥¹}…µ½Õ¹Ðô¤¤°(€€€€€Á…¥èÉ½ÝÌ¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹ÍÑ…ÑÕÌ€ôôô€A%œ¤°(€€€€€Á…ÉÑ¥…°èÉ½ÝÌ¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹ÍÑ…ÑÕÌ€ôôô€AIQ%0œ¤°(€€€€€Õ¹Á…¥èÉ½ÝÌ¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹ÍÑ…ÑÕÌ€ôôô€U9A%œ¤°(€€€€€½Ù•É‘Õ”èÉ½ÝÌ¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹ÍÑ…ÑÕÌ€„ôô€A%œ€˜˜¹•Ü…Ñ”¡É½Ü¹‘Õ•}‘…Ñ”¤€ð¹•Ü…Ñ” ¤¤°(€€€ôì(€ô((€…Íå¹ŒÑ•¹…¹ÑI•Á½ÉÐ (€€€¥è¹Õµ‰•È°(€€€™¥±Ñ•ÉÌèìµ½¹Ñ üèÍÑÉ¥¹œìå•…ÈüèÍÑÉ¥¹œìÍÑ…ÉÐüèÍÑÉ¥¹œì•¹üèÍÑÉ¥¹œì¥¹Ù½¥•MÑ…ÑÕÌüèÍÑÉ¥¹œì‰Õ¥±‘¥¹%üè¹Õµ‰•ÈìÕ¹¥Ñ%üè¹Õµ‰•Èì±•…Í•%üè¹Õµ‰•Èô€ôíô°(€€¤ì(€€€½¹ÍÐ½É…¹¥é…Ñ¥½¹%€ôÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤ì(€€€½¹ÍÐÁ•É¥½€ôÑ¡¥Ì¹É•Á½ÉÑA•É¥½¡™¥±Ñ•ÉÌ¤ì(€€€½¹ÍÐÑ•¹…¹Ð€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä M1P€¨I=4Ñ•¹…¹ÑÌ]!I¥€ô€Ä9½É…¹¥é…Ñ¥½¹}¥€ô€È9‘•±•Ñ•‘}…Ð%L9U10œ°m¥°½É…¹¥é…Ñ¥½¹%‘t¤ì(€€€½¹ÍÐ±•…Í•Ì€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1P°¸¨°Ô¹¹Õµ‰•ÈLÕ¹¥Ñ}¹Õµ‰•È°ˆ¹¥L‰Õ¥±‘¥¹}¥°ˆ¹¹…µ”L‰Õ¥±‘¥¹}¹…µ”°œ¹…µ½Õ¹ÐLÕ…É…¹Ñ••}…µ½Õ¹Ð°œ¹Á…¥‘}…µ½Õ¹ÐLÕ…É…¹Ñ••}Á…¥°œ¹ÍÑ…ÑÕÌLÕ…É…¹Ñ••}ÍÑ…ÑÕÌ(€€€€€€I=4±•…Í•Ì°(€€€€€€)=%8Õ¹¥ÑÌÔ=8Ô¹¥€ô°¹Õ¹¥Ñ}¥(€€€€€€)=%8‰Õ¥±‘¥¹Ìˆ=8ˆ¹¥€ôÔ¹‰Õ¥±‘¥¹}¥(€€€€€€1P)=%8±•…Í•}Õ…É…¹Ñ••Ìœ=8œ¹±•…Í•}¥€ô°¹¥9œ¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€]!I°¹Ñ•¹…¹Ñ}¥€ô€Ä9°¹½É…¹¥é…Ñ¥½¹}¥€ô€È9°¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€9€ Ìèé%9P%L9U10=Hˆ¹¥€ô€Ì¤(€€€€€€€€9€ Ðèé%9P%L9U10=HÔ¹¥€ô€Ð¤(€€€€€€€€9€ Ôèé%9P%L9U10=H°¹¥€ô€Ô¤(€€€€€€=IH	d°¹ÍÑ…ÉÑ}‘…Ñ”M€°(€€€€€m¥°½É…¹¥é…Ñ¥½¹%°™¥±Ñ•ÉÌ¹‰Õ¥±‘¥¹%€üü¹Õ±°°™¥±Ñ•ÉÌ¹Õ¹¥Ñ%€üü¹Õ±°°™¥±Ñ•ÉÌ¹±•…Í•%€üü¹Õ±±t°(€€€€¤ì(€€€½¹ÍÐ¥¹Ù½¥•Ì€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1P¤¸¨°ˆ¹¹…µ”L‰Õ¥±‘¥¹}¹…µ”°Ô¹¹Õµ‰•ÈLÕ¹¥Ñ}¹Õµ‰•È°(€€€€€€€€€€€€€=1M¡Ì¹Á…¥‘}…µ½Õ¹Ð°€À¤èé1=PLÁ…¥‘}…µ½Õ¹Ð°(€€€€€€€€€€€€€=1M¡Ì¹É•µ…¥¹¥¹}…µ½Õ¹Ð°¤¹Ñ½Ñ…°¤èé1=PLÉ•µ…¥¹¥¹}…µ½Õ¹Ð(€€€€€€I=4¥¹Ù½¥•Ì¤(€€€€€€1P)=%8Õ¹¥ÑÌÔ=8Ô¹¥€ô¤¹Õ¹¥Ñ}¥(€€€€€€1P)=%8‰Õ¥±‘¥¹Ìˆ=8ˆ¹¥€ô¤¹‰Õ¥±‘¥¹}¥(€€€€€€1P)=%8¥¹Ù½¥•}Á…åµ•¹Ñ}ÍÕµµ…ÉäÌ=8Ì¹¥¹Ù½¥•}¥€ô¤¹¥(€€€€€€]!I¤¹Ñ•¹…¹Ñ}¥€ô€Ä(€€€€€€€€9¤¹½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€9¤¹¥ÍÍÕ•}‘…Ñ”	Q]8€Ì9€Ð(€€€€€€€€9¤¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€9€ Ôèé%9P%L9U10=H¤¹‰Õ¥±‘¥¹}¥€ô€Ô¤(€€€€€€€€9€ Øèé%9P%L9U10=H¤¹Õ¹¥Ñ}¥€ô€Ø¤(€€€€€€€€9€ Üèé%9P%L9U10=H¤¹±•…Í•}¥€ô€Ü¤(€€€€€€€€9€‘íÑ¡¥Ì¹¥¹Ù½¥•MÑ…ÑÕÍ±…ÕÍ” ¤œ°€à¥ô(€€€€€€=IH	d¤¹¥ÍÍÕ•}‘…Ñ”M°¤¹¥¹Ù½¥•}¹Õµ‰•É€°(€€€€€m¥°½É…¹¥é…Ñ¥½¹%°Á•É¥½¹ÍÑ…ÉÐ°Á•É¥½¹•¹°™¥±Ñ•ÉÌ¹‰Õ¥±‘¥¹%€üü¹Õ±°°™¥±Ñ•ÉÌ¹Õ¹¥Ñ%€üü¹Õ±°°™¥±Ñ•ÉÌ¹±•…Í•%€üü¹Õ±°°™¥±Ñ•ÉÌ¹¥¹Ù½¥•MÑ…ÑÕÌñð¹Õ±±t°(€€€€¤ì(€€€½¹ÍÐ¥¹Ù½¥•I½ÝÌ€ô…Ý…¥ÐÑ¡¥Ì¹…ÁÁ•¹‘%¹Ù½¥•%Ñ•µMÕµµ…É¥•Ì¡¥¹Ù½¥•Ì¹É½ÝÌ¤ì(€€€½¹ÍÐÁ…åµ•¹ÑÌ€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1PÀ¸¨°¤¹Ñ•¹…¹Ñ}¥°¤¹¥¹Ù½¥•}¹Õµ‰•È°¤¹ÍÑ…ÑÕÌL¥¹Ù½¥•}ÍÑ…ÑÕÌ°ˆ¹¹…µ”L‰Õ¥±‘¥¹}¹…µ”°Ô¹¹Õµ‰•ÈLÕ¹¥Ñ}¹Õµ‰•È(€€€€€€I=4Á…åµ•¹ÑÌÀ(€€€€€€1P)=%8¥¹Ù½¥•Ì¤=8¤¹¥€ôÀ¹¥¹Ù½¥•}¥(€€€€€€1P)=%8‰Õ¥±‘¥¹Ìˆ=8ˆ¹¥€ô¤¹‰Õ¥±‘¥¹}¥(€€€€€€1P)=%8Õ¹¥ÑÌÔ=8Ô¹¥€ô¤¹Õ¹¥Ñ}¥(€€€€€€]!I¤¹Ñ•¹…¹Ñ}¥€ô€Ä(€€€€€€€€9À¹½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€9À¹Á…åµ•¹Ñ}‘…Ñ”	Q]8€Ì9€Ð(€€€€€€€€9À¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€9€ Ôèé%9P%L9U10=H¤¹‰Õ¥±‘¥¹}¥€ô€Ô¤(€€€€€€€€9€ Øèé%9P%L9U10=H¤¹Õ¹¥Ñ}¥€ô€Ø¤(€€€€€€€€9€ Üèé%9P%L9U10=H¤¹±•…Í•}¥€ô€Ü¤(€€€€€€€€9€‘íÑ¡¥Ì¹¥¹Ù½¥•MÑ…ÑÕÍ±…ÕÍ” ¤œ°€à¥ô(€€€€€€=IH	dÀ¹Á…åµ•¹Ñ}‘…Ñ”M€°(€€€€€m¥°½É…¹¥é…Ñ¥½¹%°Á•É¥½¹ÍÑ…ÉÐ°Á•É¥½¹•¹°™¥±Ñ•ÉÌ¹‰Õ¥±‘¥¹%€üü¹Õ±°°™¥±Ñ•ÉÌ¹Õ¹¥Ñ%€üü¹Õ±°°™¥±Ñ•ÉÌ¹±•…Í•%€üü¹Õ±°°™¥±Ñ•ÉÌ¹¥¹Ù½¥•MÑ…ÑÕÌñð¹Õ±±t°(€€€€¤ì(€€€½¹ÍÐ‘½Õµ•¹ÑÌ€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1P€¨(€€€€€€I=4€ (€€€€€€€€M1P(€€€€€€€€€€±¹¥°(€€€€€€€€€€±¹±•…Í•}¥°(€€€€€€€€€€±¹‘½Õµ•¹Ñ}ÑåÁ”°(€€€€€€€€€€±¹™¥±•}¹…µ”°(€€€€€€€€€€±¹™¥±•}ÕÉ°°(€€€€€€€€€€±¹ÕÁ±½…‘•‘}…ÐL‘½Õµ•¹Ñ}‘…Ñ”°(€€€€€€€€€€°¹ÍÑ…ÑÕÌL±•…Í•}ÍÑ…ÑÕÌ°(€€€€€€€€€€Ô¹¹Õµ‰•ÈLÕ¹¥Ñ}¹Õµ‰•È°(€€€€€€€€€€ˆ¹¹…µ”L‰Õ¥±‘¥¹}¹…µ”°(€€€€€€€€€€€1M}=U59PœèéQaPLÍ½ÕÉ•}ÑåÁ”(€€€€€€€€I=4±•…Í•}‘½Õµ•¹ÑÌ±(€€€€€€€€)=%8±•…Í•Ì°=8°¹¥€ô±¹±•…Í•}¥(€€€€€€€€)=%8Õ¹¥ÑÌÔ=8Ô¹¥€ô°¹Õ¹¥Ñ}¥(€€€€€€€€)=%8‰Õ¥±‘¥¹Ìˆ=8ˆ¹¥€ôÔ¹‰Õ¥±‘¥¹}¥(€€€€€€€€]!I°¹Ñ•¹…¹Ñ}¥€ô€Ä(€€€€€€€€€€9±¹½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€€€9±¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€€€9€ Ìèé%9P%L9U10=Hˆ¹¥€ô€Ì¤(€€€€€€€€€€9€ Ðèé%9P%L9U10=HÔ¹¥€ô€Ð¤(€€€€€€€€€€9€ Ôèé%9P%L9U10=H°¹¥€ô€Ô¤((€€€€€€€€U9%=810((€€€€€€€€M1P(€€€€€€€€€€œ¹¥°(€€€€€€€€€€œ¹±•…Í•}¥°(€€€€€€€€€€€1M}=9QIPœèéQaPL‘½Õµ•¹Ñ}ÑåÁ”°(€€€€€€€€€€=1M¡œ¹‘½á}™¥±•}¹…µ”°œ¹Á‘™}™¥±•}¹…µ”°œ¹Í¥¹•‘}½¹ÑÉ…Ñ}™¥±•}¹…µ”°€½¹ÑÉ…Ðœ¤L™¥±•}¹…µ”°(€€€€€€€€€€=1M¡œ¹‘½á}™¥±•}ÕÉ°°œ¹Á‘™}™¥±•}ÕÉ°°œ¹Í¥¹•‘}½¹ÑÉ…Ñ}™¥±•}ÕÉ°¤L™¥±•}ÕÉ°°(€€€€€€€€€€œ¹•¹•É…Ñ•‘}…ÐL‘½Õµ•¹Ñ}‘…Ñ”°(€€€€€€€€€€°¹ÍÑ…ÑÕÌL±•…Í•}ÍÑ…ÑÕÌ°(€€€€€€€€€€Ô¹¹Õµ‰•ÈLÕ¹¥Ñ}¹Õµ‰•È°(€€€€€€€€€€ˆ¹¹…µ”L‰Õ¥±‘¥¹}¹…µ”°(€€€€€€€€€€€1M}=9QIPœèéQaPLÍ½ÕÉ•}ÑåÁ”(€€€€€€€€I=4±•…Í•}½¹ÑÉ…Ñ}•¹•É…Ñ¥½¹Ìœ(€€€€€€€€)=%8±•…Í•Ì°=8°¹¥€ôœ¹±•…Í•}¥(€€€€€€€€)=%8Õ¹¥ÑÌÔ=8Ô¹¥€ô°¹Õ¹¥Ñ}¥(€€€€€€€€)=%8‰Õ¥±‘¥¹Ìˆ=8ˆ¹¥€ôÔ¹‰Õ¥±‘¥¹}¥(€€€€€€€€]!I°¹Ñ•¹…¹Ñ}¥€ô€Ä(€€€€€€€€€€9œ¹½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€€€9œ¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€€€9€ Ìèé%9P%L9U10=Hˆ¹¥€ô€Ì¤(€€€€€€€€€€9€ Ðèé%9P%L9U10=HÔ¹¥€ô€Ð¤(€€€€€€€€€€9€ Ôèé%9P%L9U10=H°¹¥€ô€Ô¤(€€€€€€€¤‘½Ì(€€€€€€=IH	d‘½Ì¹‘½Õµ•¹Ñ}‘…Ñ”M9U11L1MP°‘½Ì¹¥M€°(€€€€€m¥°½É…¹¥é…Ñ¥½¹%°™¥±Ñ•ÉÌ¹‰Õ¥±‘¥¹%€üü¹Õ±°°™¥±Ñ•ÉÌ¹Õ¹¥Ñ%€üü¹Õ±°°™¥±Ñ•ÉÌ¹±•…Í•%€üü¹Õ±±t°(€€€€¤ì(€€€½¹ÍÐÉ½ÝÌ€ô¥¹Ù½¥•I½ÝÌì(€€€½¹ÍÐÑ½Ñ…±%¹Ù½¥•€ôÉ½ÝÌ¹É•‘Õ” ¡ÍÕ´°É½Ü¤€ôøÍÕ´€¬9Õµ‰•È¡É½Ü¹Ñ½Ñ…°¤°€À¤ì(€€€½¹ÍÐÑ½Ñ…±I•¹Ñ%¹Ù½¥•€ôÉ½ÝÌ¹É•‘Õ” ¡ÍÕ´°É½Ü¤€ôøÍÕ´€¬9Õµ‰•È¡É½Ü¹É•¹Ñ}…µ½Õ¹Ð€üü€À¤°€À¤ì(€€€½¹ÍÐÑ½Ñ…±Må¹‘¥%¹Ù½¥•€ôÉ½ÝÌ¹É•‘Õ” ¡ÍÕ´°É½Ü¤€ôøÍÕ´€¬9Õµ‰•È¡É½Ü¹Íå¹‘¥}…µ½Õ¹Ð€üü€À¤°€À¤ì(€€€½¹ÍÐÑ½Ñ…±A…¥€ôÉ½ÝÌ¹É•‘Õ” ¡ÍÕ´°É½Ü¤€ôøÍÕ´€¬9Õµ‰•È¡É½Ü¹Á…¥‘}…µ½Õ¹Ð¤°€À¤ì(€€€½¹ÍÐÉ•µ…¥¹¥¹œ€ôÉ½ÝÌ¹É•‘Õ” ¡ÍÕ´°É½Ü¤€ôøÍÕ´€¬9Õµ‰•È¡É½Ü¹É•µ…¥¹¥¹}…µ½Õ¹Ð¤°€À¤ì(€€€½¹ÍÐÕÉÉ•¹Ñ1•…Í•Ì€ô±•…Í•Ì¹É½ÝÌ¹™¥±Ñ•È ¡±•…Í”¤€ôøÑ¡¥Ì¹¥ÍÑ¥Ù•1•…Í”¡±•…Í”¤¤ì(€€€½¹ÍÐ…Ñ¥Ù•1•…Í•%‘Ì€ô¹•ÜM•Ð¡ÕÉÉ•¹Ñ1•…Í•Ì¹µ…À ¡±•…Í”¤€ôø9Õµ‰•È¡±•…Í”¹¥¤¤¹™¥±Ñ•È ¡±•…Í•%¤€ôø9Õµ‰•È¹¥Í¥¹¥Ñ”¡±•…Í•%¤¤¤ì(€€€½¹ÍÐ…Ñ¥Ù•U¹¥Ñ%‘Ì€ô¹•ÜM•Ð¡ÕÉÉ•¹Ñ1•…Í•Ì¹µ…À ¡±•…Í”¤€ôø9Õµ‰•È¡±•…Í”¹Õ¹¥Ñ}¥¤¤¹™¥±Ñ•È ¡Õ¹¥Ñ%¤€ôø9Õµ‰•È¹¥Í¥¹¥Ñ”¡Õ¹¥Ñ%¤¤¤ì(€€€½¹ÍÐÑ½Ñ…±Ñ¥Ù•I•¹Ñµ½Õ¹Ð€ôÕÉÉ•¹Ñ1•…Í•Ì¹É•‘Õ” (€€€€€€¡ÍÕ´°±•…Í”¤€ôøÍÕ´€¬9Õµ‰•È¡±•…Í”¹µ½¹Ñ¡±å}É•¹Ð€üü€À¤€¬9Õµ‰•È¡±•…Í”¹µ…¥¹Ñ•¹…¹•}™••}…µ½Õ¹Ð€üü€À¤°(€€€€€€À°(€€€€¤ì(€€€½¹ÍÐÑ½Ñ…±Ñ¥Ù•Õ…É…¹Ñ••µ½Õ¹Ð€ôÕÉÉ•¹Ñ1•…Í•Ì¹É•‘Õ” (€€€€€€¡ÍÕ´°±•…Í”¤€ôøÍÕ´€¬Ñ¡¥Ì¹Ñ•¹…¹Ñ1•…Í•Õ…É…¹Ñ••µ½Õ¹Ð¡±•…Í”¤°(€€€€€€À°(€€€€¤ì(€€€½¹ÍÐÁ…¥‘%¹Ù½¥•ÌèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ùmt€ômtì(€€€½¹ÍÐÁ…ÉÑ¥…±%¹Ù½¥•ÌèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ùmt€ômtì(€€€½¹ÍÐÕ¹Á…¥‘%¹Ù½¥•ÌèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ùmt€ômtì(€€€½¹ÍÐ½Ù•É‘Õ•%¹Ù½¥•ÌèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ùmt€ômtì(€€€É½ÝÌ¹™½É…  ¡É½Ü¤€ôøì(€€€€€½¹ÍÐ…Ñ•½Éä€ôÑ¡¥Ì¹Ñ•¹…¹Ñ%¹Ù½¥•…Ñ•½Éä¡É½Ü¤ì(€€€€€¥˜€¡…Ñ•½Éä€ôôô€A%œ¤Á…¥‘%¹Ù½¥•Ì¹ÁÕÍ ¡É½Ü¤ì(€€€€€•±Í”¥˜€¡…Ñ•½Éä€ôôô€AIQ%0œ¤Á…ÉÑ¥…±%¹Ù½¥•Ì¹ÁÕÍ ¡É½Ü¤ì(€€€€€•±Í”¥˜€¡…Ñ•½Éä€ôôô€=YIUœ¤½Ù•É‘Õ•%¹Ù½¥•Ì¹ÁÕÍ ¡É½Ü¤ì(€€€€€•±Í”Õ¹Á…¥‘%¹Ù½¥•Ì¹ÁÕÍ ¡É½Ü¤ì(€€€ô¤ì(€€€É•ÑÕÉ¸ì(€€€€€Ñ•¹…¹ÐèÉ•ÅÕ¥É•I½Ü¡Ñ•¹…¹Ð¹É½ÝÍlÁt°€Q•¹…¹Ðœ¤°(€€€€€Á•É¥½°(€€€€€™¥±Ñ•ÉÌ°(€€€€€±•…Í•Ìè±•…Í•Ì¹É½ÝÌ°(€€€€€Ñ½Ñ…±}±•…Í•}½Õ¹Ðè¹•ÜM•Ð¡±•…Í•Ì¹É½ÝÌ¹µ…À ¡±•…Í”¤€ôø9Õµ‰•È¡±•…Í”¹¥¤¤¹™¥±Ñ•È ¡±•…Í•%¤€ôø9Õµ‰•È¹¥Í¥¹¥Ñ”¡±•…Í•%¤¤¤¹Í¥é”°(€€€€€…Ñ¥Ù•}±•…Í•}½Õ¹Ðè…Ñ¥Ù•1•…Í•%‘Ì¹Í¥é”°(€€€€€…Ñ¥Ù•}Õ¹¥Ñ}½Õ¹Ðè…Ñ¥Ù•U¹¥Ñ%‘Ì¹Í¥é”°(€€€€€Ñ½Ñ…±}…Ñ¥Ù•}É•¹Ñ}…µ½Õ¹ÐèÑ½Ñ…±Ñ¥Ù•I•¹Ñµ½Õ¹Ð°(€€€€€Ñ½Ñ…±}…Ñ¥Ù•}Õ…É…¹Ñ••}…µ½Õ¹ÐèÑ½Ñ…±Ñ¥Ù•Õ…É…¹Ñ••µ½Õ¹Ð°(€€€€€…Ñ¥Ù•}±•…Í•ÌèÕÉÉ•¹Ñ1•…Í•Ì°(€€€€€½±‘}±•…Í•Ìè±•…Í•Ì¹É½ÝÌ¹™¥±Ñ•È ¡±•…Í”¤€ôø€…ÕÉÉ•¹Ñ1•…Í•Ì¹¥¹±Õ‘•Ì¡±•…Í”¤¤°(€€€€€Õ…É…¹Ñ••Ìè±•…Í•Ì¹É½ÝÌ¹µ…À ¡±•…Í”¤€ôø€¡ì(€€€€€€€±•…Í•}¥è±•…Í”¹¥°(€€€€€€€‰Õ¥±‘¥¹}¹…µ”è±•…Í”¹‰Õ¥±‘¥¹}¹…µ”°(€€€€€€€Õ¹¥Ñ}¹Õµ‰•Èè±•…Í”¹Õ¹¥Ñ}¹Õµ‰•È°(€€€€€€€Õ…É…¹Ñ••}µ½¹Ñ¡Ìè±•…Í”¹Õ…É…¹Ñ••}µ½¹Ñ¡Ì°(€€€€€€€…µ½Õ¹ÐèÑ¡¥Ì¹Ñ•¹…¹Ñ1•…Í•Õ…É…¹Ñ••µ½Õ¹Ð¡±•…Í”¤°(€€€€€€€Á…¥‘}…µ½Õ¹Ðè±•…Í”¹Õ…É…¹Ñ••}Á…¥€üü±•…Í”¹É•¹Ñ…±}Õ…É…¹Ñ••}Á…¥€üü€À°(€€€€€€€É•µ…¥¹¥¹}…µ½Õ¹Ðè5…Ñ ¹µ…à (€€€€€€€€€Ñ¡¥Ì¹Ñ•¹…¹Ñ1•…Í•Õ…É…¹Ñ••µ½Õ¹Ð¡±•…Í”¤€´9Õµ‰•È¡±•…Í”¹Õ…É…¹Ñ••}Á…¥€üü±•…Í”¹É•¹Ñ…±}Õ…É…¹Ñ••}Á…¥€üü€À¤°(€€€€€€€€€€À°(€€€€€€€€¤°(€€€€€€€Á…åµ•¹Ñ}‘…Ñ”è±•…Í”¹É•¹Ñ…±}Õ…É…¹Ñ••}Á…åµ•¹Ñ}‘…Ñ”€üü¹Õ±°°(€€€€€€€ÍÑ…ÑÕÌè±•…Í”¹Õ…É…¹Ñ••}ÍÑ…ÑÕÌ€üü±•…Í”¹É•¹Ñ…±}Õ…É…¹Ñ••}ÍÑ…ÑÕÌ°(€€€€€ô¤¤°(€€€€€Á…åµ•¹ÑÌèÁ…åµ•¹ÑÌ¹É½ÝÌ°(€€€€€‘½Õµ•¹ÑÌè‘½Õµ•¹ÑÌ¹É½ÝÌ°(€€€€€Á…åµ•¹ÑÍ}É••¥Ù•èÁ…åµ•¹ÑÌ¹É½ÝÌ°(€€€€€¥¹Ù½¥•ÌèÉ½ÝÌ°(€€€€€Ñ½Ñ…±}¥¹Ù½¥•èÑ½Ñ…±%¹Ù½¥•°(€€€€€Ñ½Ñ…±}É•¹Ñ}¥¹Ù½¥•èÑ½Ñ…±I•¹Ñ%¹Ù½¥•°(€€€€€Ñ½Ñ…±}Íå¹‘¥}¥¹Ù½¥•èÑ½Ñ…±Må¹‘¥%¹Ù½¥•°(€€€€€Ñ½Ñ…±}Á…¥èÑ½Ñ…±A…¥°(€€€€€É•µ…¥¹¥¹œ°(€€€€€Ñ•¹…¹ÑÍ}Á…¥èÑ½Ñ…±A…¥€ø€À€ümìÑ•¹…¹Ñ}¥è¥°Ñ•¹…¹Ñ}¹…µ”è€‘íÑ•¹…¹Ð¹É½ÝÍlÁtü¹™¥ÉÍÑ}¹…µ”€üü€œô€‘íÑ•¹…¹Ð¹É½ÝÍlÁtü¹±…ÍÑ}¹…µ”€üü€œõ€¹ÑÉ¥´ ¤õt€èmt°(€€€€€Ñ•¹…¹ÑÍ}Õ¹Á…¥èÉ•µ…¥¹¥¹œ€ø€À€ümìÑ•¹…¹Ñ}¥è¥°Ñ•¹…¹Ñ}¹…µ”è€‘íÑ•¹…¹Ð¹É½ÝÍlÁtü¹™¥ÉÍÑ}¹…µ”€üü€œô€‘íÑ•¹…¹Ð¹É½ÝÍlÁtü¹±…ÍÑ}¹…µ”€üü€œõ€¹ÑÉ¥´ ¤°É•µ…¥¹¥¹}…µ½Õ¹ÐèÉ•µ…¥¹¥¹œõt€èmt°(€€€€€Á…¥èÁ…¥‘%¹Ù½¥•Ì°(€€€€€Á…ÉÑ¥…°èÁ…ÉÑ¥…±%¹Ù½¥•Ì°(€€€€€Õ¹Á…¥èÕ¹Á…¥‘%¹Ù½¥•Ì°(€€€€€½Ù•É‘Õ”è½Ù•É‘Õ•%¹Ù½¥•Ì°(€€€ôì(€ô((€…Íå¹ŒÑ•¹…¹ÑMÑ…Ñ•µ•¹Ð¡¥è¹Õµ‰•È°™¥±Ñ•ÉÌèìµ½¹Ñ üèÍÑÉ¥¹œìå•…ÈüèÍÑÉ¥¹œìÍÑ…ÉÐüèÍÑÉ¥¹œì•¹üèÍÑÉ¥¹œô€ôíô¤ì(€€€É•ÑÕÉ¸Ñ¡¥Ì¹…½Õ¹ÑMÑ…Ñ•µ•¹Ð Ñ•¹…¹Ðœ°¥°™¥±Ñ•ÉÌ¤ì(€ô((€…Íå¹ŒÕ¹¥ÑMÑ…Ñ•µ•¹Ð¡¥è¹Õµ‰•È°™¥±Ñ•ÉÌèìµ½¹Ñ üèÍÑÉ¥¹œìå•…ÈüèÍÑÉ¥¹œìÍÑ…ÉÐüèÍÑÉ¥¹œì•¹üèÍÑÉ¥¹œô€ôíô¤ì(€€€É•ÑÕÉ¸Ñ¡¥Ì¹…½Õ¹ÑMÑ…Ñ•µ•¹Ð Õ¹¥Ðœ°¥°™¥±Ñ•ÉÌ¤ì(€ô((€…Íå¹Œ‰Õ¥±‘¥¹MÑ…Ñ•µ•¹Ð¡¥è¹Õµ‰•È°™¥±Ñ•ÉÌèìµ½¹Ñ üèÍÑÉ¥¹œìå•…ÈüèÍÑÉ¥¹œìÍÑ…ÉÐüèÍÑÉ¥¹œì•¹üèÍÑÉ¥¹œô€ôíô¤ì(€€€É•ÑÕÉ¸Ñ¡¥Ì¹…½Õ¹ÑMÑ…Ñ•µ•¹Ð ‰Õ¥±‘¥¹œœ°¥°™¥±Ñ•ÉÌ¤ì(€ô((€ÁÉ¥Ù…Ñ”ÍÑ…Ñ•µ•¹ÑA•É¥½¡™¥±Ñ•ÉÌèìµ½¹Ñ üèÍÑÉ¥¹œìå•…ÈüèÍÑÉ¥¹œìÍÑ…ÉÐüèÍÑÉ¥¹œì•¹üèÍÑÉ¥¹œô¤ì(€€€É•ÑÕÉ¸Ñ¡¥Ì¹É•Á½ÉÑA•É¥½¡™¥±Ñ•ÉÌ¤ì(€ô((€ÁÉ¥Ù…Ñ”¥ÍÑ¥Ù•1•…Í”¡±•…Í”èI•½ÉñÍÑÉ¥¹œ°…¹äø¤ì(€€€½¹ÍÐÍÑ…ÉÑ…Ñ”€ôÑ¡¥Ì¹¹½Éµ…±¥é•1•…Í•…Ñ”¡±•…Í”¹ÍÑ…ÉÑ}‘…Ñ”¤ì(€€€½¹ÍÐ•¹‘…Ñ”€ôÑ¡¥Ì¹¹½Éµ…±¥é•1•…Í•…Ñ”¡±•…Í”¹•¹‘}‘…Ñ”¤ì(€€€½¹ÍÐÑ½‘…ä€ô¹•Ü…Ñ” ¤ì(€€€Ñ½‘…ä¹Í•Ñ!½ÕÉÌ À°€À°€À°€À¤ì(€€€½¹ÍÐÍÑ…ÑÕÌ€ôMÑÉ¥¹œ¡±•…Í”¹ÍÑ…ÑÕÌ€üü€œœ¤¹Ñ½UÁÁ•É…Í” ¤ì(€€€É•ÑÕÉ¸	½½±•…¸ (€€€€€ÍÑ…ÉÑ…Ñ”€˜˜(€€€€€€€ÍÑ…ÉÑ…Ñ”¹•ÑQ¥µ” ¤€ðôÑ½‘…ä¹•ÑQ¥µ” ¤€˜˜(€€€€€€€€ …•¹‘…Ñ”ñð•¹‘…Ñ”¹•ÑQ¥µ” ¤€øôÑ½‘…ä¹•ÑQ¥µ” ¤¤€˜˜(€€€€€€€€…lIPœ°€911œ°€QI5%9Qœ°€aA%It¹¥¹±Õ‘•Ì¡ÍÑ…ÑÕÌ¤°(€€€€¤ì(€ô((€ÁÉ¥Ù…Ñ”¹½Éµ…±¥é•1•…Í•…Ñ”¡Ù…±Õ”èÕ¹­¹½Ý¸¤ì(€€€¥˜€ …Ù…±Õ”¤É•ÑÕÉ¸¹Õ±°ì(€€€¥˜€¡Ù…±Õ”¥¹ÍÑ…¹•½˜…Ñ”€˜˜€…9Õµ‰•È¹¥Í9…8¡Ù…±Õ”¹•ÑQ¥µ” ¤¤¤ì(€€€€€É•ÑÕÉ¸¹•Ü…Ñ”¡Ù…±Õ”¹•ÑÕ±±e•…È ¤°Ù…±Õ”¹•Ñ5½¹Ñ  ¤°Ù…±Õ”¹•Ñ…Ñ” ¤¤ì(€€€ô(€€€½¹ÍÐÉ…Ü€ôMÑÉ¥¹œ¡Ù…±Õ”¤¹ÑÉ¥´ ¤ì(€€€¥˜€ …É…Ü¤É•ÑÕÉ¸¹Õ±°ì(€€€½¹ÍÐ¥Í½…Ñ”€ô€½yq‘ìÑôµq‘ìÉôµq‘ìÉô¼¹•á•Œ¡É…Ü¤ü¹lÁtì(€€€¥˜€¡¥Í½…Ñ”¤ì(€€€€€½¹ÍÐmå•…È°µ½¹Ñ °‘…åt€ô¥Í½…Ñ”¹ÍÁ±¥Ð œ´œ¤¹µ…À ¡Á…ÉÐ¤€ôø9Õµ‰•È¡Á…ÉÐ¤¤ì(€€€€€¥˜€¡må•…È°µ½¹Ñ °‘…åt¹•Ù•Éä ¡Á…ÉÐ¤€ôø9Õµ‰•È¹¥Í¥¹¥Ñ”¡Á…ÉÐ¤¤¤ì(€€€€€€€É•ÑÕÉ¸¹•Ü…Ñ”¡å•…È°µ½¹Ñ €´€Ä°‘…ä¤ì(€€€€€ô(€€€ô(€€€½¹ÍÐÁ…ÉÍ•€ô¹•Ü…Ñ”¡É…Ü¤ì(€€€¥˜€¡9Õµ‰•È¹¥Í9…8¡Á…ÉÍ•¹•ÑQ¥µ” ¤¤¤É•ÑÕÉ¸¹Õ±°ì(€€€É•ÑÕÉ¸¹•Ü…Ñ”¡Á…ÉÍ•¹•ÑÕ±±e•…È ¤°Á…ÉÍ•¹•Ñ5½¹Ñ  ¤°Á…ÉÍ•¹•Ñ…Ñ” ¤¤ì(€ô((€ÁÉ¥Ù…Ñ”Ñ•¹…¹Ñ1•…Í•Õ…É…¹Ñ••µ½Õ¹Ð¡±•…Í”èI•½ÉñÍÑÉ¥¹œ°…¹äø¤ì(€€€½¹ÍÐÁ•ÉÍ¥ÍÑ•¹Ñµ½Õ¹Ð€ô±•…Í”¹É•¹Ñ…±}Õ…É…¹Ñ••}…µ½Õ¹Ð€üü±•…Í”¹Õ…É…¹Ñ••}…µ½Õ¹Ð€üü±•…Í”¹…µ½Õ¹Ðì(€€€¥˜€¡Á•ÉÍ¥ÍÑ•¹Ñµ½Õ¹Ð€„ô¹Õ±°€˜˜Á•ÉÍ¥ÍÑ•¹Ñµ½Õ¹Ð€„ôô€œœ¤ì(€€€€€É•ÑÕÉ¸9Õµ‰•È¡Á•ÉÍ¥ÍÑ•¹Ñµ½Õ¹Ð€üü€À¤ì(€€€ô(€€€½¹ÍÐÕ…É…¹Ñ••5½¹Ñ¡Ì€ô9Õµ‰•È¡±•…Í”¹Õ…É…¹Ñ••}µ½¹Ñ¡Ì€üü€À¤ì(€€€½¹ÍÐÉ•¹Ñµ½Õ¹Ð€ô9Õµ‰•È¡±•…Í”¹µ½¹Ñ¡±å}É•¹Ð€üü€À¤€¬9Õµ‰•È¡±•…Í”¹µ…¥¹Ñ•¹…¹•}™••}…µ½Õ¹Ð€üü€À¤ì(€€€É•ÑÕÉ¸É•¹Ñµ½Õ¹Ð€¨5…Ñ ¹µ…à¡Õ…É…¹Ñ••5½¹Ñ¡Ì°€À¤ì(€ô((€ÁÉ¥Ù…Ñ”Ñ•¹…¹Ñ%¹Ù½¥•…Ñ•½Éä¡É½ÜèI•½ÉñÍÑÉ¥¹œ°…¹äø¤ì(€€€½¹ÍÐÍÑ…ÑÕÌ€ôMÑÉ¥¹œ¡É½Ü¹ÍÑ…ÑÕÌ€üü€œœ¤¹Ñ½UÁÁ•É…Í” ¤ì(€€€½¹ÍÐÁ…¥‘µ½Õ¹Ð€ô9Õµ‰•È¡É½Ü¹Á…¥‘}…µ½Õ¹Ð€üü€À¤ì(€€€½¹ÍÐÉ•µ…¥¹¥¹µ½Õ¹Ð€ô9Õµ‰•È¡É½Ü¹É•µ…¥¹¥¹}…µ½Õ¹Ð€üüÉ½Ü¹Ñ½Ñ…°€üü€À¤ì(€€€½¹ÍÐ‘Õ•…Ñ”€ôÉ½Ü¹‘Õ•}‘…Ñ”€ü¹•Ü…Ñ”¡€‘íMÑÉ¥¹œ¡É½Ü¹‘Õ•}‘…Ñ”¤¹Í±¥” À°€ÄÀ¥õPÈÌèÔäèÔå€¤€è¹Õ±°ì(€€€½¹ÍÐ¹½Ü€ô¹•Ü…Ñ” ¤ì((€€€¥˜€¡ÍÑ…ÑÕÌ€ôôô€A%œñðÉ•µ…¥¹¥¹µ½Õ¹Ð€ðô€À¤É•ÑÕÉ¸€A%œì(€€€¥˜€¡Á…¥‘µ½Õ¹Ð€ø€À€˜˜É•µ…¥¹¥¹µ½Õ¹Ð€ø€À¤É•ÑÕÉ¸€AIQ%0œì(€€€¥˜€¡‘Õ•…Ñ”€˜˜‘Õ•…Ñ”¹•ÑQ¥µ” ¤€ð¹½Ü¹•ÑQ¥µ” ¤¤É•ÑÕÉ¸€=YIUœì(€€€É•ÑÕÉ¸€U9A%œì(€ô((€ÁÉ¥Ù…Ñ”ÍÑ…Ñ•µ•¹Ñ5½Ù•µ•¹Ñ=É‘•È¡ÑåÁ”èÍÑÉ¥¹œ¤ì(€€€¥˜€¡ÑåÁ”€ôôô€%9Y=%œ¤É•ÑÕÉ¸€Äì(€€€¥˜€¡ÑåÁ”€ôôô€Q99Q}I%Pœ¤É•ÑÕÉ¸€Èì(€€€¥˜€¡ÑåÁ”€ôôô€Ae59Pœ¤É•ÑÕÉ¸€Ìì(€€€¥˜€¡ÑåÁ”€ôôô€Q99Q}I%Q}11=Q%=8œ¤É•ÑÕÉ¸€Ðì(€€€¥˜€¡ÑåÁ”€ôôô€Q99Q}I%Q}IU9œ¤É•ÑÕÉ¸€Ôì(€€€É•ÑÕÉ¸€Àì(€ô((€ÁÉ¥Ù…Ñ”ÍÑ…Ñ•µ•¹Ñ¹Ñ¥Ñå1…‰•°¡Í½Á”è€Ñ•¹…¹Ðœð€Õ¹¥Ðœð€‰Õ¥±‘¥¹œœ°É½ÜèI•½ÉñÍÑÉ¥¹œ°…¹äø¤ì(€€€¥˜€¡Í½Á”€ôôô€Ñ•¹…¹Ðœ¤ì(€€€€€É•ÑÕÉ¸É½Ü¹Ñ•¹…¹Ñ}ÑåÁ”€ôôô€=5A9dœ(€€€€€€€€üÉ½Ü¹½µÁ…¹å}¹…µ”(€€€€€€€€èmÉ½Ü¹™¥ÉÍÑ}¹…µ”°É½Ü¹±…ÍÑ}¹…µ”°É½Ü¹Á½ÍÑ}¹…µ•t¹™¥±Ñ•È¡	½½±•…¸¤¹©½¥¸ œ€œ¤¹ÑÉ¥´ ¤ì(€€€ô(€€€¥˜€¡Í½Á”€ôôô€Õ¹¥Ðœ¤ì(€€€€€É•ÑÕÉ¸€‘íÉ½Ü¹‰Õ¥±‘¥¹}¹…µ”€üü€œô‘íÉ½Ü¹‰Õ¥±‘¥¹}¹…µ”€˜˜É½Ü¹¹Õµ‰•È€ü€œ€´€œ€è€œô‘íÉ½Ü¹¹Õµ‰•È€üü€œõ€¹ÑÉ¥´ ¤ì(€€€ô(€€€É•ÑÕÉ¸É½Ü¹¹…µ”€üüÉ½Ü¹‰Õ¥±‘¥¹}¹…µ”€üü€Œ‘íÉ½Ü¹¥‘õ€ì(€ô((€ÁÉ¥Ù…Ñ”ÍÑ…Ñ•µ•¹Ñ¹Ñ¥ÑåMÕ‰Ñ¥Ñ±”¡Í½Á”è€Ñ•¹…¹Ðœð€Õ¹¥Ðœð€‰Õ¥±‘¥¹œœ°É½ÜèI•½ÉñÍÑÉ¥¹œ°…¹äø¤ì(€€€¥˜€¡Í½Á”€ôôô€Ñ•¹…¹Ðœ¤ì(€€€€€¥˜€¡É½Ü¹Ñ•¹…¹Ñ}ÑåÁ”€ôôô€=5A9dœ¤ì(€€€€€€€É•ÑÕÉ¸mÉ½Ü¹É´°É½Ü¹±•…±}É•ÁÉ•Í•¹Ñ…Ñ¥Ù•}¹…µ•t¹™¥±Ñ•È¡	½½±•…¸¤¹©½¥¸ œƒ
Ü€œ¤ñð¹Õ±°ì(€€€€€ô(€€€€€É•ÑÕÉ¸mÉ½Ü¹Á¡½¹”°É½Ü¹•µ…¥±t¹™¥±Ñ•È¡	½½±•…¸¤¹©½¥¸ œƒ
Ü€œ¤ñð¹Õ±°ì(€€€ô(€€€¥˜€¡Í½Á”€ôôô€Õ¹¥Ðœ¤ì(€€€€€É•ÑÕÉ¸mÉ½Ü¹‰Õ¥±‘¥¹}…‘‘É•ÍÌ°É½Ü¹…Ñ¥Ù•}±•…Í•}•¹‘}‘…Ñ”€ü¥¸‰…¥°€‘íÉ½Ü¹…Ñ¥Ù•}±•…Í•}•¹‘}‘…Ñ•õ€€è¹Õ±±t¹™¥±Ñ•È¡	½½±•…¸¤¹©½¥¸ œƒ
Ü€œ¤ñð¹Õ±°ì(€€€ô(€€€É•ÑÕÉ¸mÉ½Ü¹¥Ñä°É½Ü¹…‘‘É•ÍÍt¹™¥±Ñ•È¡	½½±•…¸¤¹©½¥¸ œƒ
Ü€œ¤ñð¹Õ±°ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ…½Õ¹ÑMÑ…Ñ•µ•¹Ð¡Í½Á”è€Ñ•¹…¹Ðœð€Õ¹¥Ðœð€‰Õ¥±‘¥¹œœ°¥è¹Õµ‰•È°™¥±Ñ•ÉÌèìµ½¹Ñ üèÍÑÉ¥¹œìå•…ÈüèÍÑÉ¥¹œìÍÑ…ÉÐüèÍÑÉ¥¹œì•¹üèÍÑÉ¥¹œô€ôíô¤ì(€€€½¹ÍÐ½É…¹¥é…Ñ¥½¹%€ôÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤ì(€€€½¹ÍÐÁ•É¥½€ôÑ¡¥Ì¹ÍÑ…Ñ•µ•¹ÑA•É¥½¡™¥±Ñ•ÉÌ¤ì(€€€½¹ÍÐÕÉÉ•¹ä€ô€UMœì(€€€½¹ÍÐÍ½ÕÉ”€ô…Ý…¥ÐÑ¡¥Ì¹ÍÑ…Ñ•µ•¹ÑM½ÕÉ”¡Í½Á”°¥°½É…¹¥é…Ñ¥½¹%¤ì(€€€½¹ÍÐ½Á•¹¥¹	…±…¹”€ô…Ý…¥ÐÑ¡¥Ì¹ÍÑ…Ñ•µ•¹Ñ=Á•¹¥¹	…±…¹”¡Í½Á”°¥°½É…¹¥é…Ñ¥½¹%°Á•É¥½¹ÍÑ…ÉÐ¤ì(€€€½¹ÍÐ¥¹Ù½¥•I½ÝÌ€ô…Ý…¥ÐÑ¡¥Ì¹ÍÑ…Ñ•µ•¹Ñ%¹Ù½¥•Ì¡Í½Á”°¥°½É…¹¥é…Ñ¥½¹%°Á•É¥½¹ÍÑ…ÉÐ°Á•É¥½¹•¹¤ì(€€€½¹ÍÐÁ…åµ•¹ÑI½ÝÌ€ô…Ý…¥ÐÑ¡¥Ì¹ÍÑ…Ñ•µ•¹ÑA…åµ•¹ÑÌ¡Í½Á”°¥°½É…¹¥é…Ñ¥½¹%°Á•É¥½¹ÍÑ…ÉÐ°Á•É¥½¹•¹¤ì(€€€½¹ÍÐÑ•¹…¹ÑÉ•‘¥ÑI½ÝÌ€ô…Ý…¥ÐÑ¡¥Ì¹ÍÑ…Ñ•µ•¹ÑQ•¹…¹ÑÉ•‘¥ÑÌ¡Í½Á”°¥°½É…¹¥é…Ñ¥½¹%°Á•É¥½¹ÍÑ…ÉÐ°Á•É¥½¹•¹¤ì(€€€½¹ÍÐÑ•¹…¹ÑÉ•‘¥ÑI•™Õ¹‘I½ÝÌ€ô…Ý…¥ÐÑ¡¥Ì¹ÍÑ…Ñ•µ•¹ÑQ•¹…¹ÑÉ•‘¥ÑI•™Õ¹‘Ì¡Í½Á”°¥°½É…¹¥é…Ñ¥½¹%°Á•É¥½¹ÍÑ…ÉÐ°Á•É¥½¹•¹¤ì(€€€½¹ÍÐÑ•¹…¹ÑÉ•‘¥Ñ±±½…Ñ¥½¹I½ÝÌ€ô…Ý…¥ÐÑ¡¥Ì¹ÍÑ…Ñ•µ•¹ÑQ•¹…¹ÑÉ•‘¥Ñ±±½…Ñ¥½¹Ì¡Í½Á”°¥°½É…¹¥é…Ñ¥½¹%°Á•É¥½¹ÍÑ…ÉÐ°Á•É¥½¹•¹¤ì(€€€½¹ÍÐÕ…É…¹Ñ••I½ÝÌ€ô…Ý…¥ÐÑ¡¥Ì¹ÍÑ…Ñ•µ•¹ÑÕ…É…¹Ñ••Ì¡Í½Á”°¥°½É…¹¥é…Ñ¥½¹%¤ì(€€€½¹ÍÐµ½Ù•µ•¹ÑÌ€ôÑ¡¥Ì¹ÍÑ…Ñ•µ•¹Ñ5½Ù•µ•¹ÑÌ (€€€€€½Á•¹¥¹	…±…¹”°(€€€€€¥¹Ù½¥•I½ÝÌ°(€€€€€Á…åµ•¹ÑI½ÝÌ°(€€€€€Ñ•¹…¹ÑÉ•‘¥ÑI½ÝÌ°(€€€€€Ñ•¹…¹ÑÉ•‘¥ÑI•™Õ¹‘I½ÝÌ°(€€€€€Ñ•¹…¹ÑÉ•‘¥Ñ±±½…Ñ¥½¹I½ÝÌ°(€€€€€ÕÉÉ•¹ä°(€€€€€Á•É¥½¹ÍÑ…ÉÐ°(€€€€¤ì(€€€½¹ÍÐ‘•‰¥ÑÌ€ô¥¹Ù½¥•I½ÝÌ¹É•‘Õ” ¡ÍÕ´°É½Ü¤€ôøÍÕ´€¬9Õµ‰•È¡É½Ü¹Ñ½Ñ…°€üü€À¤°€À¤(€€€€€€¬Ñ•¹…¹ÑÉ•‘¥ÑI•™Õ¹‘I½ÝÌ¹É•‘Õ” ¡ÍÕ´°É½Ü¤€ôøÍÕ´€¬9Õµ‰•È¡É½Ü¹…µ½Õ¹Ð€üü€À¤°€À¤ì(€€€½¹ÍÐÉ•‘¥ÑÌ€ôÁ…åµ•¹ÑI½ÝÌ¹É•‘Õ” ¡ÍÕ´°É½Ü¤€ôøÍÕ´€¬9Õµ‰•È¡É½Ü¹…µ½Õ¹Ð€üü€À¤°€À¤(€€€€€€¬Ñ•¹…¹ÑÉ•‘¥ÑI½ÝÌ¹É•‘Õ” ¡ÍÕ´°É½Ü¤€ôøÍÕ´€¬9Õµ‰•È¡É½Ü¹…µ½Õ¹Ð€üüÉ½Ü¹½É¥¥¹…±}…µ½Õ¹Ð€üü€À¤°€À¤ì(€€€½¹ÍÐ±½Í¥¹	…±…¹”€ô9Õµ‰•È¡½Á•¹¥¹	…±…¹”€üü€À¤€¬‘•‰¥ÑÌ€´É•‘¥ÑÌì(€€€É•ÑÕÉ¸ì(€€€€€­¥¹èÍ½Á”¹Ñ½UÁÁ•É…Í” ¤°(€€€€€•¹Ñ¥ÑäèÍ½ÕÉ”¹•¹Ñ¥Ñä°(€€€€€Á•É¥½°(€€€€€ÕÉÉ•¹ä°(€€€€€½Á•¹¥¹}‰…±…¹”è9Õµ‰•È¡½Á•¹¥¹	…±…¹”€üü€À¤°(€€€€€Ñ½Ñ…±Ìèì(€€€€€€€‘•‰¥ÑÌ°(€€€€€€€É•‘¥ÑÌ°(€€€€€€€±½Í¥¹}‰…±…¹”è9Õµ‰•È¡±½Í¥¹	…±…¹”¹Ñ½¥á• È¤¤°(€€€€€€€¥¹Ù½¥•Í}½Õ¹Ðè¥¹Ù½¥•I½ÝÌ¹±•¹Ñ °(€€€€€€€Á…åµ•¹ÑÍ}½Õ¹ÐèÁ…åµ•¹ÑI½ÝÌ¹±•¹Ñ €¬Ñ•¹…¹ÑÉ•‘¥ÑI½ÝÌ¹±•¹Ñ °(€€€€€€€É•™Õ¹‘Í}½Õ¹ÐèÑ•¹…¹ÑÉ•‘¥ÑI•™Õ¹‘I½ÝÌ¹±•¹Ñ °(€€€€€ô°(€€€€€µ½Ù•µ•¹ÑÌ°(€€€€€¥¹Ù½¥•Ìè¥¹Ù½¥•I½ÝÌ°(€€€€€Á…åµ•¹ÑÌèÁ…åµ•¹ÑI½ÝÌ°(€€€€€Ñ•¹…¹Ñ}É•‘¥ÑÌèÑ•¹…¹ÑÉ•‘¥ÑI½ÝÌ°(€€€€€Ñ•¹…¹Ñ}É•‘¥Ñ}É•™Õ¹‘ÌèÑ•¹…¹ÑÉ•‘¥ÑI•™Õ¹‘I½ÝÌ°(€€€€€Ñ•¹…¹Ñ}É•‘¥Ñ}…±±½…Ñ¥½¹ÌèÑ•¹…¹ÑÉ•‘¥Ñ±±½…Ñ¥½¹I½ÝÌ°(€€€€€Õ…É…¹Ñ••ÌèÕ…É…¹Ñ••I½ÝÌ°(€€€€€Õ…É…¹Ñ••}Ñ½Ñ…±Ìèì(€€€€€€€•áÁ•Ñ•èÕ…É…¹Ñ••I½ÝÌ¹É•‘Õ” ¡ÍÕ´°É½Ü¤€ôøÍÕ´€¬9Õµ‰•È¡É½Ü¹…µ½Õ¹Ð€üü€À¤°€À¤°(€€€€€€€Á…¥èÕ…É…¹Ñ••I½ÝÌ¹É•‘Õ” ¡ÍÕ´°É½Ü¤€ôøÍÕ´€¬9Õµ‰•È¡É½Ü¹Á…¥‘}…µ½Õ¹Ð€üü€À¤°€À¤°(€€€€€€€É•µ…¥¹¥¹œèÕ…É…¹Ñ••I½ÝÌ¹É•‘Õ” ¡ÍÕ´°É½Ü¤€ôøÍÕ´€¬5…Ñ ¹µ…à¡9Õµ‰•È¡É½Ü¹…µ½Õ¹Ð€üü€À¤€´9Õµ‰•È¡É½Ü¹Á…¥‘}…µ½Õ¹Ð€üü€À¤°€À¤°€À¤°(€€€€€ô°(€€€ôì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÍÑ…Ñ•µ•¹ÑM½ÕÉ”¡Í½Á”è€Ñ•¹…¹Ðœð€Õ¹¥Ðœð€‰Õ¥±‘¥¹œœ°¥è¹Õµ‰•È°½É…¹¥é…Ñ¥½¹%è¹Õµ‰•È¤ì(€€€¥˜€¡Í½Á”€ôôô€Ñ•¹…¹Ðœ¤ì(€€€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€€€M1PÐ¸¨°Ô¹¹Õµ‰•ÈLÕ¹¥Ñ}¹Õµ‰•È°ˆ¹¹…µ”L‰Õ¥±‘¥¹}¹…µ”°ˆ¹…‘‘É•ÍÌL‰Õ¥±‘¥¹}…‘‘É•ÍÌ(€€€€€€€€I=4Ñ•¹…¹ÑÌÐ(€€€€€€€€1P)=%8Õ¹¥ÑÌÔ=8Ô¹¥€ôÐ¹Õ¹¥Ñ}¥(€€€€€€€€1P)=%8‰Õ¥±‘¥¹Ìˆ=8ˆ¹¥€ôÔ¹‰Õ¥±‘¥¹}¥(€€€€€€€€]!IÐ¹¥€ô€Ä9Ð¹½É…¹¥é…Ñ¥½¹}¥€ô€È9Ð¹‘•±•Ñ•‘}…Ð%L9U11€°(€€€€€€€m¥°½É…¹¥é…Ñ¥½¹%‘t°(€€€€€€¤ì(€€€€€½¹ÍÐÉ½Ü€ôÉ•ÅÕ¥É•I½Ü¡É½ÝÍlÁt°€Q•¹…¹Ðœ¤ì(€€€€€É•ÑÕÉ¸ì(€€€€€€€•¹Ñ¥Ñäèì(€€€€€€€€€¥èÉ½Ü¹¥°(€€€€€€€€€•¹Ñ¥Ñå}ÑåÁ”è€Q99Pœ°(€€€€€€€€€Ñ¥Ñ±”èÑ¡¥Ì¹ÍÑ…Ñ•µ•¹Ñ¹Ñ¥Ñå1…‰•° Ñ•¹…¹Ðœ°É½Ü¤°(€€€€€€€€€ÍÕ‰Ñ¥Ñ±”èÑ¡¥Ì¹ÍÑ…Ñ•µ•¹Ñ¹Ñ¥ÑåMÕ‰Ñ¥Ñ±” Ñ•¹…¹Ðœ°É½Ü¤°(€€€€€€€€€Ñ•¹…¹ÐèÉ½Ü°(€€€€€€€ô°(€€€€€ôì(€€€ô(€€€¥˜€¡Í½Á”€ôôô€Õ¹¥Ðœ¤ì(€€€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€€€M1PÔ¸¨°ˆ¹¹…µ”L‰Õ¥±‘¥¹}¹…µ”°ˆ¹…‘‘É•ÍÌL‰Õ¥±‘¥¹}…‘‘É•ÍÌ°(€€€€€€€€€€€€€€€Ð¹¥LÑ•¹…¹Ñ}¥°=9P¡Ð¹™¥ÉÍÑ}¹…µ”°€œ€œ°Ð¹±…ÍÑ}¹…µ”¤LÑ•¹…¹Ñ}¹…µ”°(€€€€€€€€€€€€€€€Ð¹Á¡½¹”LÑ•¹…¹Ñ}Á¡½¹”°Ð¹•µ…¥°LÑ•¹…¹Ñ}•µ…¥°°(€€€€€€€€€€€€€€€°¹•¹‘}‘…Ñ”L…Ñ¥Ù•}±•…Í•}•¹‘}‘…Ñ”(€€€€€€€€I=4Õ¹¥ÑÌÔ(€€€€€€€€)=%8‰Õ¥±‘¥¹Ìˆ=8ˆ¹¥€ôÔ¹‰Õ¥±‘¥¹}¥(€€€€€€€€1P)=%8Ñ•¹…¹ÑÌÐ=8Ð¹Õ¹¥Ñ}¥€ôÔ¹¥9Ð¹ÍÑ…ÑÕÌ€ô€Q%Yœ9Ð¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€1P)=%8±•…Í•Ì°=8°¹Õ¹¥Ñ}¥€ôÔ¹¥9°¹ÍÑ…ÑÕÌ€ô€Q%Yœ9°¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€]!IÔ¹¥€ô€Ä9Ô¹½É…¹¥é…Ñ¥½¹}¥€ô€È9Ô¹‘•±•Ñ•‘}…Ð%L9U11€°(€€€€€€€m¥°½É…¹¥é…Ñ¥½¹%‘t°(€€€€€€¤ì(€€€€€½¹ÍÐÉ½Ü€ôÉ•ÅÕ¥É•I½Ü¡É½ÝÍlÁt°€U¹¥Ðœ¤ì(€€€€€É•ÑÕÉ¸ì(€€€€€€€•¹Ñ¥Ñäèì(€€€€€€€€€¥èÉ½Ü¹¥°(€€€€€€€€€•¹Ñ¥Ñå}ÑåÁ”è€U9%Pœ°(€€€€€€€€€Ñ¥Ñ±”èÑ¡¥Ì¹ÍÑ…Ñ•µ•¹Ñ¹Ñ¥Ñå1…‰•° Õ¹¥Ðœ°É½Ü¤°(€€€€€€€€€ÍÕ‰Ñ¥Ñ±”èÑ¡¥Ì¹ÍÑ…Ñ•µ•¹Ñ¹Ñ¥ÑåMÕ‰Ñ¥Ñ±” Õ¹¥Ðœ°É½Ü¤°(€€€€€€€€€Õ¹¥ÐèÉ½Ü°(€€€€€€€ô°(€€€€€ôì(€€€ô(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1Pˆ¸¨(€€€€€€I=4‰Õ¥±‘¥¹Ìˆ(€€€€€€]!Iˆ¹¥€ô€Ä9ˆ¹½É…¹¥é…Ñ¥½¹}¥€ô€È9ˆ¹‘•±•Ñ•‘}…Ð%L9U11€°(€€€€€m¥°½É…¹¥é…Ñ¥½¹%‘t°(€€€€¤ì(€€€½¹ÍÐÉ½Ü€ôÉ•ÅÕ¥É•I½Ü¡É½ÝÍlÁt°€	Õ¥±‘¥¹œœ¤ì(€€€É•ÑÕÉ¸ì(€€€€€•¹Ñ¥Ñäèì(€€€€€€€¥èÉ½Ü¹¥°(€€€€€€€•¹Ñ¥Ñå}ÑåÁ”è€	U%1%9œ°(€€€€€€€Ñ¥Ñ±”èÑ¡¥Ì¹ÍÑ…Ñ•µ•¹Ñ¹Ñ¥Ñå1…‰•° ‰Õ¥±‘¥¹œœ°É½Ü¤°(€€€€€€€ÍÕ‰Ñ¥Ñ±”èÑ¡¥Ì¹ÍÑ…Ñ•µ•¹Ñ¹Ñ¥ÑåMÕ‰Ñ¥Ñ±” ‰Õ¥±‘¥¹œœ°É½Ü¤°(€€€€€€€‰Õ¥±‘¥¹œèÉ½Ü°(€€€€€ô°(€€€ôì(€ô((€ÁÉ¥Ù…Ñ”ÍÑ…Ñ•µ•¹Ñ%¹Ù½¥•M½Á”¡Í½Á”è€Ñ•¹…¹Ðœð€Õ¹¥Ðœð€‰Õ¥±‘¥¹œœ¤ì(€€€¥˜€¡Í½Á”€ôôô€Ñ•¹…¹Ðœ¤É•ÑÕÉ¸€¤¹Ñ•¹…¹Ñ}¥€ô€Äœì(€€€¥˜€¡Í½Á”€ôôô€Õ¹¥Ðœ¤É•ÑÕÉ¸€=1M¡¤¹Õ¹¥Ñ}¥°°¹Õ¹¥Ñ}¥°Ð¹Õ¹¥Ñ}¥¤€ô€Äœì(€€€É•ÑÕÉ¸€=1M¡¤¹‰Õ¥±‘¥¹}¥°Ô¹‰Õ¥±‘¥¹}¥¤€ô€Äœì(€ô((€ÁÉ¥Ù…Ñ”ÍÑ…Ñ•µ•¹ÑA…åµ•¹ÑM½Á”¡Í½Á”è€Ñ•¹…¹Ðœð€Õ¹¥Ðœð€‰Õ¥±‘¥¹œœ¤ì(€€€¥˜€¡Í½Á”€ôôô€Ñ•¹…¹Ðœ¤É•ÑÕÉ¸€¤¹Ñ•¹…¹Ñ}¥€ô€Äœì(€€€¥˜€¡Í½Á”€ôôô€Õ¹¥Ðœ¤É•ÑÕÉ¸€=1M¡¤¹Õ¹¥Ñ}¥°°¹Õ¹¥Ñ}¥°Ð¹Õ¹¥Ñ}¥¤€ô€Äœì(€€€É•ÑÕÉ¸€=1M¡¤¹‰Õ¥±‘¥¹}¥°Ô¹‰Õ¥±‘¥¹}¥¤€ô€Äœì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÍÑ…Ñ•µ•¹Ñ=Á•¹¥¹	…±…¹”¡Í½Á”è€Ñ•¹…¹Ðœð€Õ¹¥Ðœð€‰Õ¥±‘¥¹œœ°¥è¹Õµ‰•È°½É…¹¥é…Ñ¥½¹%è¹Õµ‰•È°ÍÑ…ÉÐèÍÑÉ¥¹œ¤ì(€€€½¹ÍÐ¥¹Ù½¥•½¹‘¥Ñ¥½¸€ôÑ¡¥Ì¹ÍÑ…Ñ•µ•¹Ñ%¹Ù½¥•M½Á”¡Í½Á”¤ì(€€€½¹ÍÐÁ…åµ•¹Ñ½¹‘¥Ñ¥½¸€ôÑ¡¥Ì¹ÍÑ…Ñ•µ•¹ÑA…åµ•¹ÑM½Á”¡Í½Á”¤ì(€€€½¹ÍÐ¥¹Ù½¥•MÅ°€ôÍ½Á”€ôôô€Ñ•¹…¹Ðœ(€€€€€€üM1P=1M¡MU4¡¤¹Ñ½Ñ…°¤°€À¤èé1=PLÑ½Ñ…°(€€€€€€€€I=4¥¹Ù½¥•Ì¤(€€€€€€€€]!I€‘í¥¹Ù½¥•½¹‘¥Ñ¥½¹ô(€€€€€€€€€€9¤¹¥ÍÍÕ•}‘…Ñ”€ð€Ì(€€€€€€€€€€9¤¹½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€€€9¤¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€€€9¤¹ÍÑ…ÑÕÌ9=P%8€ IPœ°€911œ¥€(€€€€€€èÍ½Á”€ôôô€Õ¹¥Ðœ(€€€€€€€€üM1P=1M¡MU4¡¤¹Ñ½Ñ…°¤°€À¤èé1=PLÑ½Ñ…°(€€€€€€€€€€I=4¥¹Ù½¥•Ì¤(€€€€€€€€€€1P)=%8±•…Í•Ì°=8°¹¥€ô¤¹±•…Í•}¥9°¹½É…¹¥é…Ñ¥½¹}¥€ô¤¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€€€€€1P)=%8Ñ•¹…¹ÑÌÐ=8Ð¹¥€ô¤¹Ñ•¹…¹Ñ}¥9Ð¹½É…¹¥é…Ñ¥½¹}¥€ô¤¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€€€€€]!I€‘í¥¹Ù½¥•½¹‘¥Ñ¥½¹ô(€€€€€€€€€€€€9¤¹¥ÍÍÕ•}‘…Ñ”€ð€Ì(€€€€€€€€€€€€9¤¹½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€€€€€9¤¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€€€€€9¤¹ÍÑ…ÑÕÌ9=P%8€ IPœ°€911œ¥€(€€€€€€€€èM1P=1M¡MU4¡¤¹Ñ½Ñ…°¤°€À¤èé1=PLÑ½Ñ…°(€€€€€€€€€€I=4¥¹Ù½¥•Ì¤(€€€€€€€€€€1P)=%8±•…Í•Ì°=8°¹¥€ô¤¹±•…Í•}¥9°¹½É…¹¥é…Ñ¥½¹}¥€ô¤¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€€€€€1P)=%8Ñ•¹…¹ÑÌÐ=8Ð¹¥€ô¤¹Ñ•¹…¹Ñ}¥9Ð¹½É…¹¥é…Ñ¥½¹}¥€ô¤¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€€€€€1P)=%8Õ¹¥ÑÌÔ=8Ô¹¥€ô=1M¡¤¹Õ¹¥Ñ}¥°°¹Õ¹¥Ñ}¥°Ð¹Õ¹¥Ñ}¥¤9Ô¹½É…¹¥é…Ñ¥½¹}¥€ô¤¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€€€€€]!I€‘í¥¹Ù½¥•½¹‘¥Ñ¥½¹ô(€€€€€€€€€€€€9¤¹¥ÍÍÕ•}‘…Ñ”€ð€Ì(€€€€€€€€€€€€9¤¹½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€€€€€9¤¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€€€€€9¤¹ÍÑ…ÑÕÌ9=P%8€ IPœ°€911œ¥€ì(€€€½¹ÍÐÁ…åµ•¹ÑMÅ°€ô]%Q Í½Á•‘}Á…åµ•¹ÑÌL€ (€€€€€€M1PÁ„¹…µ½Õ¹Ðèé1=PL…µ½Õ¹Ð(€€€€€€I=4Á…åµ•¹Ñ}…±±½…Ñ¥½¹ÌÁ„(€€€€€€)=%8Á…åµ•¹ÑÌÀ=8À¹¥€ôÁ„¹Á…åµ•¹Ñ}¥(€€€€€€€€9À¹½É…¹¥é…Ñ¥½¹}¥€ôÁ„¹½É…¹¥é…Ñ¥½¹}¥9À¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€)=%8¥¹Ù½¥•Ì¤=8¤¹¥€ôÁ„¹¥¹Ù½¥•}¥(€€€€€€€€9¤¹½É…¹¥é…Ñ¥½¹}¥€ôÁ„¹½É…¹¥é…Ñ¥½¹}¥9¤¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€1P)=%8±•…Í•Ì°=8°¹¥€ô¤¹±•…Í•}¥9°¹½É…¹¥é…Ñ¥½¹}¥€ô¤¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€1P)=%8Ñ•¹…¹ÑÌÐ=8Ð¹¥€ô¤¹Ñ•¹…¹Ñ}¥9Ð¹½É…¹¥é…Ñ¥½¹}¥€ô¤¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€1P)=%8Õ¹¥ÑÌÔ=8Ô¹¥€ô=1M¡¤¹Õ¹¥Ñ}¥°°¹Õ¹¥Ñ}¥°Ð¹Õ¹¥Ñ}¥¤9Ô¹½É…¹¥é…Ñ¥½¹}¥€ô¤¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€]!I€‘íÁ…åµ•¹Ñ½¹‘¥Ñ¥½¹ô(€€€€€€€€9À¹Á…åµ•¹Ñ}‘…Ñ”€ð€Ì(€€€€€€€€9Á„¹½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€9Á„¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€9=1M¡À¹Á…åµ•¹Ñ}ÑåÁ”°€%9Y=%œ¤€ðø€Q99Q}I%Q}11=Q%=8œ((€€€€€€U9%=810((€€€€€€M1PÀ¹…µ½Õ¹Ðèé1=PL…µ½Õ¹Ð(€€€€€€I=4Á…åµ•¹ÑÌÀ(€€€€€€)=%8¥¹Ù½¥•Ì¤=8¤¹¥€ôÀ¹¥¹Ù½¥•}¥(€€€€€€€€9¤¹½É…¹¥é…Ñ¥½¹}¥€ôÀ¹½É…¹¥é…Ñ¥½¹}¥9¤¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€1P)=%8±•…Í•Ì°=8°¹¥€ô¤¹±•…Í•}¥9°¹½É…¹¥é…Ñ¥½¹}¥€ô¤¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€1P)=%8Ñ•¹…¹ÑÌÐ=8Ð¹¥€ô¤¹Ñ•¹…¹Ñ}¥9Ð¹½É…¹¥é…Ñ¥½¹}¥€ô¤¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€1P)=%8Õ¹¥ÑÌÔ=8Ô¹¥€ô=1M¡¤¹Õ¹¥Ñ}¥°°¹Õ¹¥Ñ}¥°Ð¹Õ¹¥Ñ}¥¤9Ô¹½É…¹¥é…Ñ¥½¹}¥€ô¤¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€]!I€‘íÁ…åµ•¹Ñ½¹‘¥Ñ¥½¹ô(€€€€€€€€9À¹Á…åµ•¹Ñ}‘…Ñ”€ð€Ì(€€€€€€€€9À¹½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€9À¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€9=1M¡À¹Á…åµ•¹Ñ}ÑåÁ”°€%9Y=%œ¤€ðø€Q99Q}I%Q}11=Q%=8œ(€€€€€€€€99=Pa%MQL€ (€€€€€€€€€€M1P€ÄI=4Á…åµ•¹Ñ}…±±½…Ñ¥½¹ÌÁ„(€€€€€€€€€€]!IÁ„¹Á…åµ•¹Ñ}¥€ôÀ¹¥9Á„¹½É…¹¥é…Ñ¥½¹}¥€ôÀ¹½É…¹¥é…Ñ¥½¹}¥9Á„¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€€¤(€€€€€¤(€€€€M1P=1M¡MU4¡…µ½Õ¹Ð¤°€À¤èé1=PLÑ½Ñ…°I=4Í½Á•‘}Á…åµ•¹ÑÍ€ì(€€€½¹ÍÐÉ•‘¥ÑM½Á”€ôÑ¡¥Ì¹ÍÑ…Ñ•µ•¹ÑQ•¹…¹ÑÉ•‘¥ÑM½Á”¡Í½Á”¤ì(€€€½¹ÍÐÑ•¹…¹ÑÉ•‘¥ÑMÅ°€ôM1P=1M¡MU4¡ÑŒ¹½É¥¥¹…±}…µ½Õ¹Ð¤°€À¤èé1=PLÑ½Ñ…°(€€€€€€I=4Ñ•¹…¹Ñ}É•‘¥ÑÌÑŒ(€€€€€€1P)=%8±•…Í•Ì°=8°¹¥€ôÑŒ¹±•…Í•}¥9°¹½É…¹¥é…Ñ¥½¹}¥€ôÑŒ¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€1P)=%8Õ¹¥ÑÌÔ=8Ô¹¥€ô°¹Õ¹¥Ñ}¥9Ô¹½É…¹¥é…Ñ¥½¹}¥€ôÑŒ¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€]!I€‘íÉ•‘¥ÑM½Á•ô(€€€€€€€€9ÑŒ¹½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€9ÑŒ¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€9ÑŒ¹Á…åµ•¹Ñ}‘…Ñ”€ð€ÌèéQ€ì(€€€½¹ÍÐÑ•¹…¹ÑÉ•‘¥ÑI•™Õ¹‘MÅ°€ôM1P=1M¡MU4¡ÑÈ¹…µ½Õ¹Ð¤°€À¤èé1=PLÑ½Ñ…°(€€€€€€I=4Ñ•¹…¹Ñ}É•‘¥Ñ}É•™Õ¹‘ÌÑÈ(€€€€€€)=%8Ñ•¹…¹Ñ}É•‘¥ÑÌÑŒ=8ÑŒ¹¥€ôÑÈ¹Ñ•¹…¹Ñ}É•‘¥Ñ}¥9ÑŒ¹½É…¹¥é…Ñ¥½¹}¥€ôÑÈ¹½É…¹¥é…Ñ¥½¹}¥9ÑŒ¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€1P)=%8±•…Í•Ì°=8°¹¥€ôÑŒ¹±•…Í•}¥9°¹½É…¹¥é…Ñ¥½¹}¥€ôÑŒ¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€1P)=%8Õ¹¥ÑÌÔ=8Ô¹¥€ô°¹Õ¹¥Ñ}¥9Ô¹½É…¹¥é…Ñ¥½¹}¥€ôÑŒ¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€]!I€‘íÉ•‘¥ÑM½Á•ô(€€€€€€€€9ÑÈ¹½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€9ÑÈ¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€9ÑÈ¹É•™Õ¹‘}‘…Ñ”€ð€ÌèéQ€ì(€€€½¹ÍÐm¥¹Ù½¥•	…±…¹”°Á…åµ•¹Ñ	…±…¹”°Ñ•¹…¹ÑÉ•‘¥Ñ	…±…¹”°Ñ•¹…¹ÑÉ•‘¥ÑI•™Õ¹‘	…±…¹•t€ô…Ý…¥ÐAÉ½µ¥Í”¹…±°¡l(€€€€€Ñ¡¥Ì¹‘ˆ¹ÅÕ•Éä¡¥¹Ù½¥•MÅ°°m¥°½É…¹¥é…Ñ¥½¹%°ÍÑ…ÉÑt¤°(€€€€€Ñ¡¥Ì¹‘ˆ¹ÅÕ•Éä¡Á…åµ•¹ÑMÅ°°m¥°½É…¹¥é…Ñ¥½¹%°ÍÑ…ÉÑt¤°(€€€€€Ñ¡¥Ì¹‘ˆ¹ÅÕ•Éä¡Ñ•¹…¹ÑÉ•‘¥ÑMÅ°°m¥°½É…¹¥é…Ñ¥½¹%°ÍÑ…ÉÑt¤°(€€€€€Ñ¡¥Ì¹‘ˆ¹ÅÕ•Éä¡Ñ•¹…¹ÑÉ•‘¥ÑI•™Õ¹‘MÅ°°m¥°½É…¹¥é…Ñ¥½¹%°ÍÑ…ÉÑt¤°(€€€t¤ì(€€€É•ÑÕÉ¸9Õµ‰•È¡¥¹Ù½¥•	…±…¹”¹É½ÝÍlÁtü¹Ñ½Ñ…°€üü€À¤(€€€€€€´9Õµ‰•È¡Á…åµ•¹Ñ	…±…¹”¹É½ÝÍlÁtü¹Ñ½Ñ…°€üü€À¤(€€€€€€´9Õµ‰•È¡Ñ•¹…¹ÑÉ•‘¥Ñ	…±…¹”¹É½ÝÍlÁtü¹Ñ½Ñ…°€üü€À¤(€€€€€€¬9Õµ‰•È¡Ñ•¹…¹ÑÉ•‘¥ÑI•™Õ¹‘	…±…¹”¹É½ÝÍlÁtü¹Ñ½Ñ…°€üü€À¤ì(€ô((€ÁÉ¥Ù…Ñ”ÍÑ…Ñ•µ•¹ÑQ•¹…¹ÑÉ•‘¥ÑM½Á”¡Í½Á”è€Ñ•¹…¹Ðœð€Õ¹¥Ðœð€‰Õ¥±‘¥¹œœ¤ì(€€€¥˜€¡Í½Á”€ôôô€Ñ•¹…¹Ðœ¤É•ÑÕÉ¸€ÑŒ¹Ñ•¹…¹Ñ}¥€ô€Äœì(€€€¥˜€¡Í½Á”€ôôô€Õ¹¥Ðœ¤É•ÑÕÉ¸€°¹Õ¹¥Ñ}¥€ô€Äœì(€€€É•ÑÕÉ¸€Ô¹‰Õ¥±‘¥¹}¥€ô€Äœì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÍÑ…Ñ•µ•¹ÑQ•¹…¹ÑÉ•‘¥ÑÌ¡Í½Á”è€Ñ•¹…¹Ðœð€Õ¹¥Ðœð€‰Õ¥±‘¥¹œœ°¥è¹Õµ‰•È°½É…¹¥é…Ñ¥½¹%è¹Õµ‰•È°ÍÑ…ÉÐèÍÑÉ¥¹œ°•¹èÍÑÉ¥¹œ¤ì(€€€½¹ÍÐ½¹‘¥Ñ¥½¸€ôÑ¡¥Ì¹ÍÑ…Ñ•µ•¹ÑQ•¹…¹ÑÉ•‘¥ÑM½Á”¡Í½Á”¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1PÑŒ¹¥°ÑŒ¹Á…åµ•¹Ñ}‘…Ñ”°ÑŒ¹É•™•É•¹”°ÑŒ¹ÕÉÉ•¹ä°ÑŒ¹½É¥¥¹…±}…µ½Õ¹Ð°ÑŒ¹É•µ…¥¹¥¹}…µ½Õ¹Ð°ÑŒ¹ÍÑ…ÑÕÌ°(€€€€€€€€€€€€€À¹É••¥ÁÑ}¹Õµ‰•È°À¹Á…åµ•¹Ñ}µ•Ñ¡½°À¹…µ½Õ¹Ñ}ÕÍ°À¹…µ½Õ¹Ñ}‘˜°À¹Ñ½Ñ…±}•ÅÕ¥Ù…±•¹Ñ}ÕÍ°(€€€€€€€€€€€€€ÑŒ¹Ñ•¹…¹Ñ}¥°(€€€€€€€€€€€€€M]!8Ð¹Ñ•¹…¹Ñ}ÑåÁ”€ô€=5A9dœQ!8=1M¡Ð¹½µÁ…¹å}¹…µ”°€œœ¤(€€€€€€€€€€€€€€€€€€1MQI%4¡=9P¡=1M¡Ð¹™¥ÉÍÑ}¹…µ”°€œœ¤°€œ€œ°=1M¡Ð¹±…ÍÑ}¹…µ”°€œœ¤°€œ€œ°=1M¡Ð¹Á½ÍÑ}¹…µ”°€œœ¤¤¤(€€€€€€€€€€€€€9LÑ•¹…¹Ñ}¹…µ”°(€€€€€€€€€€€€€°¹±•…Í•}¹Õµ‰•È°(€€€€€€€€€€€€€Ô¹¹Õµ‰•ÈLÕ¹¥Ñ}¹Õµ‰•È°(€€€€€€€€€€€€€ˆ¹¹…µ”L‰Õ¥±‘¥¹}¹…µ”(€€€€€€I=4Ñ•¹…¹Ñ}É•‘¥ÑÌÑŒ(€€€€€€)=%8Á…åµ•¹ÑÌÀ=8À¹¥€ôÑŒ¹Í½ÕÉ•}Á…åµ•¹Ñ}¥(€€€€€€€€9À¹½É…¹¥é…Ñ¥½¹}¥€ôÑŒ¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€€€9À¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€)=%8Ñ•¹…¹ÑÌÐ=8Ð¹¥€ôÑŒ¹Ñ•¹…¹Ñ}¥(€€€€€€€€9Ð¹½É…¹¥é…Ñ¥½¹}¥€ôÑŒ¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€€€9Ð¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€1P)=%8±•…Í•Ì°=8°¹¥€ôÑŒ¹±•…Í•}¥(€€€€€€€€9°¹½É…¹¥é…Ñ¥½¹}¥€ôÑŒ¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€€€9°¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€1P)=%8Õ¹¥ÑÌÔ=8Ô¹¥€ô°¹Õ¹¥Ñ}¥(€€€€€€€€9Ô¹½É…¹¥é…Ñ¥½¹}¥€ôÑŒ¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€€€9Ô¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€1P)=%8‰Õ¥±‘¥¹Ìˆ=8ˆ¹¥€ôÔ¹‰Õ¥±‘¥¹}¥(€€€€€€€€9ˆ¹½É…¹¥é…Ñ¥½¹}¥€ôÑŒ¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€€€9ˆ¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€]!I€‘í½¹‘¥Ñ¥½¹ô(€€€€€€€€9ÑŒ¹½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€9ÑŒ¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€9ÑŒ¹Á…åµ•¹Ñ}‘…Ñ”	Q]8€Ì9€Ð(€€€€€€=IH	dÑŒ¹Á…åµ•¹Ñ}‘…Ñ”M°ÑŒ¹¥M€°(€€€€€m¥°½É…¹¥é…Ñ¥½¹%°ÍÑ…ÉÐ°•¹‘t°(€€€€¤ì(€€€É•ÑÕÉ¸É½ÝÌì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÍÑ…Ñ•µ•¹ÑQ•¹…¹ÑÉ•‘¥ÑI•™Õ¹‘Ì¡Í½Á”è€Ñ•¹…¹Ðœð€Õ¹¥Ðœð€‰Õ¥±‘¥¹œœ°¥è¹Õµ‰•È°½É…¹¥é…Ñ¥½¹%è¹Õµ‰•È°ÍÑ…ÉÐèÍÑÉ¥¹œ°•¹èÍÑÉ¥¹œ¤ì(€€€½¹ÍÐ½¹‘¥Ñ¥½¸€ôÑ¡¥Ì¹ÍÑ…Ñ•µ•¹ÑQ•¹…¹ÑÉ•‘¥ÑM½Á”¡Í½Á”¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1PÑÈ¹¥°ÑÈ¹É•™Õ¹‘}‘…Ñ”°ÑÈ¹É•™•É•¹”°ÑÈ¹É••¥ÁÑ}¹Õµ‰•È°ÑÈ¹…µ½Õ¹Ð°ÑÈ¹ÕÉÉ•¹ä°(€€€€€€€€€€€€€ÑÈ¹Á…åµ•¹Ñ}µ•Ñ¡½°ÑÈ¹É•…Í½¸°ÑÈ¹ÍÑ…ÑÕÌ°ÑŒ¹Ñ•¹…¹Ñ}¥°ÑŒ¹±•…Í•}¥°(€€€€€€€€€€€€€M]!8Ð¹Ñ•¹…¹Ñ}ÑåÁ”€ô€=5A9dœQ!8=1M¡Ð¹½µÁ…¹å}¹…µ”°€œœ¤(€€€€€€€€€€€€€€€€€€1MQI%4¡=9P¡=1M¡Ð¹™¥ÉÍÑ}¹…µ”°€œœ¤°€œ€œ°=1M¡Ð¹±…ÍÑ}¹…µ”°€œœ¤°€œ€œ°=1M¡Ð¹Á½ÍÑ}¹…µ”°€œœ¤¤¤(€€€€€€€€€€€€€9LÑ•¹…¹Ñ}¹…µ”°(€€€€€€€€€€€€€°¹±•…Í•}¹Õµ‰•È°Ô¹¹Õµ‰•ÈLÕ¹¥Ñ}¹Õµ‰•È°ˆ¹¹…µ”L‰Õ¥±‘¥¹}¹…µ”(€€€€€€I=4Ñ•¹…¹Ñ}É•‘¥Ñ}É•™Õ¹‘ÌÑÈ(€€€€€€)=%8Ñ•¹…¹Ñ}É•‘¥ÑÌÑŒ=8ÑŒ¹¥€ôÑÈ¹Ñ•¹…¹Ñ}É•‘¥Ñ}¥(€€€€€€€€9ÑŒ¹½É…¹¥é…Ñ¥½¹}¥€ôÑÈ¹½É…¹¥é…Ñ¥½¹}¥9ÑŒ¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€)=%8Ñ•¹…¹ÑÌÐ=8Ð¹¥€ôÑŒ¹Ñ•¹…¹Ñ}¥(€€€€€€€€9Ð¹½É…¹¥é…Ñ¥½¹}¥€ôÑŒ¹½É…¹¥é…Ñ¥½¹}¥9Ð¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€1P)=%8±•…Í•Ì°=8°¹¥€ôÑŒ¹±•…Í•}¥(€€€€€€€€9°¹½É…¹¥é…Ñ¥½¹}¥€ôÑŒ¹½É…¹¥é…Ñ¥½¹}¥9°¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€1P)=%8Õ¹¥ÑÌÔ=8Ô¹¥€ô°¹Õ¹¥Ñ}¥(€€€€€€€€9Ô¹½É…¹¥é…Ñ¥½¹}¥€ôÑŒ¹½É…¹¥é…Ñ¥½¹}¥9Ô¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€1P)=%8‰Õ¥±‘¥¹Ìˆ=8ˆ¹¥€ôÔ¹‰Õ¥±‘¥¹}¥(€€€€€€€€9ˆ¹½É…¹¥é…Ñ¥½¹}¥€ôÑŒ¹½É…¹¥é…Ñ¥½¹}¥9ˆ¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€]!I€‘í½¹‘¥Ñ¥½¹ô(€€€€€€€€9ÑÈ¹½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€9ÑÈ¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€9ÑÈ¹É•™Õ¹‘}‘…Ñ”	Q]8€Ì9€Ð(€€€€€€=IH	dÑÈ¹É•™Õ¹‘}‘…Ñ”M°ÑÈ¹¥M€°(€€€€€m¥°½É…¹¥é…Ñ¥½¹%°ÍÑ…ÉÐ°•¹‘t°(€€€€¤ì(€€€É•ÑÕÉ¸É½ÝÌì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÍÑ…Ñ•µ•¹ÑQ•¹…¹ÑÉ•‘¥Ñ±±½…Ñ¥½¹Ì¡Í½Á”è€Ñ•¹…¹Ðœð€Õ¹¥Ðœð€‰Õ¥±‘¥¹œœ°¥è¹Õµ‰•È°½É…¹¥é…Ñ¥½¹%è¹Õµ‰•È°ÍÑ…ÉÐèÍÑÉ¥¹œ°•¹èÍÑÉ¥¹œ¤ì(€€€½¹ÍÐ½¹‘¥Ñ¥½¸€ôÑ¡¥Ì¹ÍÑ…Ñ•µ•¹ÑQ•¹…¹ÑÉ•‘¥ÑM½Á”¡Í½Á”¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1PÑ„¹¥°Ñ„¹É•…Ñ•‘}…ÐèéQL…±±½…Ñ¥½¹}‘…Ñ”°Ñ„¹…µ½Õ¹Ñ}…ÁÁ±¥•L…µ½Õ¹Ð°(€€€€€€€€€€€€€Ñ„¹ÕÉÉ•¹ä°ÑŒ¹Ñ•¹…¹Ñ}¥°ÑŒ¹±•…Í•}¥°ÑŒ¹É•™•É•¹”LÉ•‘¥Ñ}É•™•É•¹”°(€€€€€€€€€€€€€À¹É••¥ÁÑ}¹Õµ‰•È°¤¹¥L¥¹Ù½¥•}¥°¤¹¥¹Ù½¥•}¹Õµ‰•È°(€€€€€€€€€€€€€°¹±•…Í•}¹Õµ‰•È°Ô¹¹Õµ‰•ÈLÕ¹¥Ñ}¹Õµ‰•È°ˆ¹¹…µ”L‰Õ¥±‘¥¹}¹…µ”(€€€€€€I=4Ñ•¹…¹Ñ}É•‘¥Ñ}…±±½…Ñ¥½¹ÌÑ„(€€€€€€)=%8Ñ•¹…¹Ñ}É•‘¥ÑÌÑŒ=8ÑŒ¹¥€ôÑ„¹Ñ•¹…¹Ñ}É•‘¥Ñ}¥(€€€€€€€€9ÑŒ¹½É…¹¥é…Ñ¥½¹}¥€ôÑ„¹½É…¹¥é…Ñ¥½¹}¥9ÑŒ¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€)=%8Á…åµ•¹ÑÌÀ=8À¹¥€ôÑ„¹Á…åµ•¹Ñ}¥(€€€€€€€€9À¹½É…¹¥é…Ñ¥½¹}¥€ôÑ„¹½É…¹¥é…Ñ¥½¹}¥9À¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€)=%8¥¹Ù½¥•Ì¤=8¤¹¥€ôÑ„¹¥¹Ù½¥•}¥(€€€€€€€€9¤¹½É…¹¥é…Ñ¥½¹}¥€ôÑ„¹½É…¹¥é…Ñ¥½¹}¥9¤¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€1P)=%8±•…Í•Ì°=8°¹¥€ôÑŒ¹±•…Í•}¥(€€€€€€€€9°¹½É…¹¥é…Ñ¥½¹}¥€ôÑŒ¹½É…¹¥é…Ñ¥½¹}¥9°¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€1P)=%8Õ¹¥ÑÌÔ=8Ô¹¥€ô°¹Õ¹¥Ñ}¥(€€€€€€€€9Ô¹½É…¹¥é…Ñ¥½¹}¥€ôÑŒ¹½É…¹¥é…Ñ¥½¹}¥9Ô¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€1P)=%8‰Õ¥±‘¥¹Ìˆ=8ˆ¹¥€ôÔ¹‰Õ¥±‘¥¹}¥(€€€€€€€€9ˆ¹½É…¹¥é…Ñ¥½¹}¥€ôÑŒ¹½É…¹¥é…Ñ¥½¹}¥9ˆ¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€]!I€‘í½¹‘¥Ñ¥½¹ô(€€€€€€€€9Ñ„¹½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€9Ñ„¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€9Ñ„¹É•…Ñ•‘}…ÐèéQ	Q]8€ÌèéQ9€ÐèéQ(€€€€€€=IH	dÑ„¹É•…Ñ•‘}…ÐM°Ñ„¹¥M€°(€€€€€m¥°½É…¹¥é…Ñ¥½¹%°ÍÑ…ÉÐ°•¹‘t°(€€€€¤ì(€€€É•ÑÕÉ¸É½ÝÌì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÍÑ…Ñ•µ•¹ÑÕ…É…¹Ñ••Ì¡Í½Á”è€Ñ•¹…¹Ðœð€Õ¹¥Ðœð€‰Õ¥±‘¥¹œœ°¥è¹Õµ‰•È°½É…¹¥é…Ñ¥½¹%è¹Õµ‰•È¤ì(€€€½¹ÍÐ½¹‘¥Ñ¥½¸€ôÍ½Á”€ôôô€Ñ•¹…¹Ðœ(€€€€€€ü€°¹Ñ•¹…¹Ñ}¥€ô€Äœ(€€€€€€èÍ½Á”€ôôô€Õ¹¥Ðœ(€€€€€€€€ü€°¹Õ¹¥Ñ}¥€ô€Äœ(€€€€€€€€è€Ô¹‰Õ¥±‘¥¹}¥€ô€Äœì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1P±œ¹¥°±œ¹±•…Í•}¥°±œ¹…µ½Õ¹Ð°=1M¡±œ¹Á…¥‘}…µ½Õ¹Ð°€À¤LÁ…¥‘}…µ½Õ¹Ð°±œ¹Á…åµ•¹Ñ}‘…Ñ”°±œ¹ÍÑ…ÑÕÌ°(€€€€€€€€€€€€€°¹±•…Í•}¹Õµ‰•È°°¹Ñ•¹…¹Ñ}¥°Ô¹¹Õµ‰•ÈLÕ¹¥Ñ}¹Õµ‰•È°ˆ¹¹…µ”L‰Õ¥±‘¥¹}¹…µ”°(€€€€€€€€€€€€€M]!8Ð¹Ñ•¹…¹Ñ}ÑåÁ”€ô€=5A9dœQ!8=1M¡Ð¹½µÁ…¹å}¹…µ”°€œœ¤(€€€€€€€€€€€€€€€€€€1MQI%4¡=9P¡=1M¡Ð¹™¥ÉÍÑ}¹…µ”°€œœ¤°€œ€œ°=1M¡Ð¹±…ÍÑ}¹…µ”°€œœ¤°€œ€œ°=1M¡Ð¹Á½ÍÑ}¹…µ”°€œœ¤¤¤(€€€€€€€€€€€€€9LÑ•¹…¹Ñ}¹…µ”°(€€€€€€€€€€€€€IQMP¡±œ¹…µ½Õ¹Ð€´=1M¡±œ¹Á…¥‘}…µ½Õ¹Ð°€À¤°€À¤èé1=PLÉ•µ…¥¹¥¹}…µ½Õ¹Ð°(€€€€€€€€€€€€€=1M¡À¹Á…åµ•¹ÑÌ°€mtœèé)M=9¤LÁ…åµ•¹ÑÌ(€€€€€€I=4±•…Í•}Õ…É…¹Ñ••Ì±œ(€€€€€€)=%8±•…Í•Ì°=8°¹¥€ô±œ¹±•…Í•}¥(€€€€€€€€9°¹½É…¹¥é…Ñ¥½¹}¥€ô±œ¹½É…¹¥é…Ñ¥½¹}¥9°¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€)=%8Ñ•¹…¹ÑÌÐ=8Ð¹¥€ô°¹Ñ•¹…¹Ñ}¥(€€€€€€€€9Ð¹½É…¹¥é…Ñ¥½¹}¥€ô°¹½É…¹¥é…Ñ¥½¹}¥9Ð¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€)=%8Õ¹¥ÑÌÔ=8Ô¹¥€ô°¹Õ¹¥Ñ}¥(€€€€€€€€9Ô¹½É…¹¥é…Ñ¥½¹}¥€ô°¹½É…¹¥é…Ñ¥½¹}¥9Ô¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€1P)=%8‰Õ¥±‘¥¹Ìˆ=8ˆ¹¥€ôÔ¹‰Õ¥±‘¥¹}¥(€€€€€€€€9ˆ¹½É…¹¥é…Ñ¥½¹}¥€ô°¹½É…¹¥é…Ñ¥½¹}¥9ˆ¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€1P)=%81QI0€ (€€€€€€€€M1P)M=9	}¡)M=9	}	U%1}=	)P (€€€€€€€€€€€¥œ°À¹¥°(€€€€€€€€€€€É••¥ÁÑ}¹Õµ‰•Èœ°À¹É••¥ÁÑ}¹Õµ‰•È°(€€€€€€€€€€€Á…åµ•¹Ñ}‘…Ñ”œ°À¹Á…åµ•¹Ñ}‘…Ñ”°(€€€€€€€€€€€…µ½Õ¹Ðœ°À¹…µ½Õ¹Ð°(€€€€€€€€€€€ÕÉÉ•¹äœ°À¹ÕÉÉ•¹ä°(€€€€€€€€€€€Á…åµ•¹Ñ}µ•Ñ¡½œ°À¹Á…åµ•¹Ñ}µ•Ñ¡½°(€€€€€€€€€€€É•™•É•¹”œ°À¹É•™•É•¹”(€€€€€€€€€¤=IH	dÀ¹Á…åµ•¹Ñ}‘…Ñ”°À¹¥¤LÁ…åµ•¹ÑÌ(€€€€€€€€I=4Á…åµ•¹ÑÌÀ(€€€€€€€€]!IÀ¹±•…Í•}Õ…É…¹Ñ••}¥€ô±œ¹¥(€€€€€€€€€€9À¹½É…¹¥é…Ñ¥½¹}¥€ô±œ¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€€€€€9À¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€¤À=8QIU(€€€€€€]!I€‘í½¹‘¥Ñ¥½¹ô(€€€€€€€€9±œ¹½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€9±œ¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€=IH	d°¹ÍÑ…ÉÑ}‘…Ñ”M°±œ¹¥M€°(€€€€€m¥°½É…¹¥é…Ñ¥½¹%‘t°(€€€€¤ì(€€€É•ÑÕÉ¸É½ÝÌì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÍÑ…Ñ•µ•¹Ñ%¹Ù½¥•Ì¡Í½Á”è€Ñ•¹…¹Ðœð€Õ¹¥Ðœð€‰Õ¥±‘¥¹œœ°¥è¹Õµ‰•È°½É…¹¥é…Ñ¥½¹%è¹Õµ‰•È°ÍÑ…ÉÐèÍÑÉ¥¹œ°•¹èÍÑÉ¥¹œ¤ì(€€€½¹ÍÐ½¹‘¥Ñ¥½¸€ôÑ¡¥Ì¹ÍÑ…Ñ•µ•¹Ñ%¹Ù½¥•M½Á”¡Í½Á”¤ì(€€€½¹ÍÐÍÅ°€ôÍ½Á”€ôôô€Ñ•¹…¹Ðœ(€€€€€€üM1P¤¹¥°¤¹¥¹Ù½¥•}¹Õµ‰•È°¤¹µ½¹Ñ °¤¹å•…È°¤¹¥ÍÍÕ•}‘…Ñ”°¤¹‘Õ•}‘…Ñ”°¤¹ÍÑ…ÑÕÌ°¤¹Ñ½Ñ…°°(€€€€€€€€€€€€€¤¹±…ÍÑ}É•µ¥¹‘•É}…Ð°=1M¡¤¹É•µ¥¹‘•É}½Õ¹Ð°€À¤èé%9PLÉ•µ¥¹‘•É}½Õ¹Ð°(€€€€€€€€€€€€€¤¹Ñ•¹…¹Ñ}¥°M]!8Ð¹Ñ•¹…¹Ñ}ÑåÁ”€ô€=5A9dœQ!8=1M¡Ð¹½µÁ…¹å}¹…µ”°€œœ¤1MQI%4¡=9Q}]L œ€œ°Ð¹™¥ÉÍÑ}¹…µ”°Ð¹±…ÍÑ}¹…µ”°Ð¹Á½ÍÑ}¹…µ”¤¤9LÑ•¹…¹Ñ}¹…µ”°Ð¹Á¡½¹”°Ð¹•µ…¥°°(€€€€€€€€€€€€€Ô¹¹Õµ‰•ÈLÕ¹¥Ñ}¹Õµ‰•È°(€€€€€€€€€€€€€=1M¡Ì¹Á…¥‘}…µ½Õ¹Ð°€À¤èé1=PLÁ…¥‘}…µ½Õ¹Ð°(€€€€€€€€€€€€€=1M¡Ì¹É•µ…¥¹¥¹}…µ½Õ¹Ð°¤¹Ñ½Ñ…°¤èé1=PLÉ•µ…¥¹¥¹}…µ½Õ¹Ð(€€€€€€€€I=4¥¹Ù½¥•Ì¤(€€€€€€€€)=%8Ñ•¹…¹ÑÌÐ=8Ð¹¥€ô¤¹Ñ•¹…¹Ñ}¥9Ð¹½É…¹¥é…Ñ¥½¹}¥€ô¤¹½É…¹¥é…Ñ¥½¹}¥9Ð¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€1P)=%8±•…Í•Ì°=8°¹¥€ô¤¹±•…Í•}¥9°¹½É…¹¥é…Ñ¥½¹}¥€ô¤¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€€€1P)=%8Õ¹¥ÑÌÔ=8Ô¹¥€ô=1M¡¤¹Õ¹¥Ñ}¥°°¹Õ¹¥Ñ}¥°Ð¹Õ¹¥Ñ}¥¤9Ô¹½É…¹¥é…Ñ¥½¹}¥€ô¤¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€€€1P)=%8¥¹Ù½¥•}Á…åµ•¹Ñ}ÍÕµµ…ÉäÌ=8Ì¹¥¹Ù½¥•}¥€ô¤¹¥(€€€€€€€€]!I€‘í½¹‘¥Ñ¥½¹ô(€€€€€€€€€€9¤¹½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€€€9¤¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€€€9¤¹ÍÑ…ÑÕÌ9=P%8€ IPœ°€911œ¤(€€€€€€€€€€9¤¹¥ÍÍÕ•}‘…Ñ”	Q]8€Ì9€Ð(€€€€€€€€=IH	d¤¹¥ÍÍÕ•}‘…Ñ”M°¤¹¥M€(€€€€€€èÍ½Á”€ôôô€Õ¹¥Ðœ(€€€€€€€€üM1P¤¹¥°¤¹¥¹Ù½¥•}¹Õµ‰•È°¤¹µ½¹Ñ °¤¹å•…È°¤¹¥ÍÍÕ•}‘…Ñ”°¤¹‘Õ•}‘…Ñ”°¤¹ÍÑ…ÑÕÌ°¤¹Ñ½Ñ…°°(€€€€€€€€€€€€€¤¹±…ÍÑ}É•µ¥¹‘•É}…Ð°=1M¡¤¹É•µ¥¹‘•É}½Õ¹Ð°€À¤èé%9PLÉ•µ¥¹‘•É}½Õ¹Ð°(€€€€€€€€€€€€€¤¹Ñ•¹…¹Ñ}¥°M]!8Ð¹Ñ•¹…¹Ñ}ÑåÁ”€ô€=5A9dœQ!8=1M¡Ð¹½µÁ…¹å}¹…µ”°€œœ¤1MQI%4¡=9Q}]L œ€œ°Ð¹™¥ÉÍÑ}¹…µ”°Ð¹±…ÍÑ}¹…µ”°Ð¹Á½ÍÑ}¹…µ”¤¤9LÑ•¹…¹Ñ}¹…µ”°Ð¹Á¡½¹”°Ð¹•µ…¥°°(€€€€€€€€€€€€€Ô¹¹Õµ‰•ÈLÕ¹¥Ñ}¹Õµ‰•È°ˆ¹¹…µ”L‰Õ¥±‘¥¹}¹…µ”°(€€€€€€€€€€€€€=1M¡Ì¹Á…¥‘}…µ½Õ¹Ð°€À¤èé1=PLÁ…¥‘}…µ½Õ¹Ð°(€€€€€€€€€€€€€=1M¡Ì¹É•µ…¥¹¥¹}…µ½Õ¹Ð°¤¹Ñ½Ñ…°¤èé1=PLÉ•µ…¥¹¥¹}…µ½Õ¹Ð(€€€€€€€€I=4¥¹Ù½¥•Ì¤(€€€€€€€€)=%8Ñ•¹…¹ÑÌÐ=8Ð¹¥€ô¤¹Ñ•¹…¹Ñ}¥9Ð¹½É…¹¥é…Ñ¥½¹}¥€ô¤¹½É…¹¥é…Ñ¥½¹}¥9Ð¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€1P)=%8±•…Í•Ì°=8°¹¥€ô¤¹±•…Í•}¥9°¹½É…¹¥é…Ñ¥½¹}¥€ô¤¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€€€1P)=%8Õ¹¥ÑÌÔ=8Ô¹¥€ô=1M¡¤¹Õ¹¥Ñ}¥°°¹Õ¹¥Ñ}¥°Ð¹Õ¹¥Ñ}¥¤9Ô¹½É…¹¥é…Ñ¥½¹}¥€ô¤¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€€€1P)=%8‰Õ¥±‘¥¹Ìˆ=8ˆ¹¥€ôÔ¹‰Õ¥±‘¥¹}¥9ˆ¹½É…¹¥é…Ñ¥½¹}¥€ô¤¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€€€1P)=%8¥¹Ù½¥•}Á…åµ•¹Ñ}ÍÕµµ…ÉäÌ=8Ì¹¥¹Ù½¥•}¥€ô¤¹¥(€€€€€€€€]!I€‘í½¹‘¥Ñ¥½¹ô(€€€€€€€€€€9¤¹½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€€€9¤¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€€€9¤¹ÍÑ…ÑÕÌ9=P%8€ IPœ°€911œ¤(€€€€€€€€€€9¤¹¥ÍÍÕ•}‘…Ñ”	Q]8€Ì9€Ð(€€€€€€€€=IH	d¤¹¥ÍÍÕ•}‘…Ñ”M°¤¹¥M€(€€€€€€€€èM1P¤¹¥°¤¹¥¹Ù½¥•}¹Õµ‰•È°¤¹µ½¹Ñ °¤¹å•…È°¤¹¥ÍÍÕ•}‘…Ñ”°¤¹‘Õ•}‘…Ñ”°¤¹ÍÑ…ÑÕÌ°¤¹Ñ½Ñ…°°(€€€€€€€€€€€€€¤¹±…ÍÑ}É•µ¥¹‘•É}…Ð°=1M¡¤¹É•µ¥¹‘•É}½Õ¹Ð°€À¤èé%9PLÉ•µ¥¹‘•É}½Õ¹Ð°(€€€€€€€€€€€€€¤¹Ñ•¹…¹Ñ}¥°M]!8Ð¹Ñ•¹…¹Ñ}ÑåÁ”€ô€=5A9dœQ!8=1M¡Ð¹½µÁ…¹å}¹…µ”°€œœ¤1MQI%4¡=9Q}]L œ€œ°Ð¹™¥ÉÍÑ}¹…µ”°Ð¹±…ÍÑ}¹…µ”°Ð¹Á½ÍÑ}¹…µ”¤¤9LÑ•¹…¹Ñ}¹…µ”°Ð¹Á¡½¹”°Ð¹•µ…¥°°(€€€€€€€€€€€€€Ô¹¹Õµ‰•ÈLÕ¹¥Ñ}¹Õµ‰•È°ˆ¹¹…µ”L‰Õ¥±‘¥¹}¹…µ”°(€€€€€€€€€€€€€=1M¡Ì¹Á…¥‘}…µ½Õ¹Ð°€À¤èé1=PLÁ…¥‘}…µ½Õ¹Ð°(€€€€€€€€€€€€€=1M¡Ì¹É•µ…¥¹¥¹}…µ½Õ¹Ð°¤¹Ñ½Ñ…°¤èé1=PLÉ•µ…¥¹¥¹}…µ½Õ¹Ð(€€€€€€€€I=4¥¹Ù½¥•Ì¤(€€€€€€€€)=%8Ñ•¹…¹ÑÌÐ=8Ð¹¥€ô¤¹Ñ•¹…¹Ñ}¥9Ð¹½É…¹¥é…Ñ¥½¹}¥€ô¤¹½É…¹¥é…Ñ¥½¹}¥9Ð¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€1P)=%8±•…Í•Ì°=8°¹¥€ô¤¹±•…Í•}¥9°¹½É…¹¥é…Ñ¥½¹}¥€ô¤¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€€€1P)=%8Õ¹¥ÑÌÔ=8Ô¹¥€ô=1M¡¤¹Õ¹¥Ñ}¥°°¹Õ¹¥Ñ}¥°Ð¹Õ¹¥Ñ}¥¤9Ô¹½É…¹¥é…Ñ¥½¹}¥€ô¤¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€€€1P)=%8‰Õ¥±‘¥¹Ìˆ=8ˆ¹¥€ô=1M¡¤¹‰Õ¥±‘¥¹}¥°Ô¹‰Õ¥±‘¥¹}¥¤9ˆ¹½É…¹¥é…Ñ¥½¹}¥€ô¤¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€€€1P)=%8¥¹Ù½¥•}Á…åµ•¹Ñ}ÍÕµµ…ÉäÌ=8Ì¹¥¹Ù½¥•}¥€ô¤¹¥(€€€€€€€€]!I€‘í½¹‘¥Ñ¥½¹ô(€€€€€€€€€€9¤¹½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€€€9¤¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€€€9¤¹ÍÑ…ÑÕÌ9=P%8€ IPœ°€911œ¤(€€€€€€€€€€9¤¹¥ÍÍÕ•}‘…Ñ”	Q]8€Ì9€Ð(€€€€€€€€=IH	d¤¹¥ÍÍÕ•}‘…Ñ”M°¤¹¥M€ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä¡ÍÅ°°m¥°½É…¹¥é…Ñ¥½¹%°ÍÑ…ÉÐ°•¹‘t¤ì(€€€É•ÑÕÉ¸Ñ¡¥Ì¹…ÁÁ•¹‘%¹Ù½¥•%Ñ•µMÕµµ…É¥•Ì¡É½ÝÌ¤ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÍÑ…Ñ•µ•¹ÑA…åµ•¹ÑÌ¡Í½Á”è€Ñ•¹…¹Ðœð€Õ¹¥Ðœð€‰Õ¥±‘¥¹œœ°¥è¹Õµ‰•È°½É…¹¥é…Ñ¥½¹%è¹Õµ‰•È°ÍÑ…ÉÐèÍÑÉ¥¹œ°•¹èÍÑÉ¥¹œ¤ì(€€€½¹ÍÐ½¹‘¥Ñ¥½¸€ôÑ¡¥Ì¹ÍÑ…Ñ•µ•¹ÑA…åµ•¹ÑM½Á”¡Í½Á”¤ì(€€€½¹ÍÐÍÅ°€ô]%Q Í½Á•‘}Á…åµ•¹ÑÌL€ (€€€€€€M1PÀ¹¥°Á„¹¥L…±±½…Ñ¥½¹}¥°À¹Á…åµ•¹Ñ}‘…Ñ”°Á„¹…µ½Õ¹Ðèé1=PL…µ½Õ¹Ð°(€€€€€€€€€€€€€À¹…µ½Õ¹Ðèé1=PLÁ…åµ•¹Ñ}Ñ½Ñ…°°À¹Á…åµ•¹Ñ}µ•Ñ¡½°À¹É•™•É•¹”°À¹É••¥ÁÑ}¹Õµ‰•È°(€€€€€€€€€€€€€À¹ÕÉÉ•¹ä°À¹Ñ½Ñ…±}•ÅÕ¥Ù…±•¹Ñ}ÕÍ°¤¹¥¹Ù½¥•}¹Õµ‰•È°¤¹ÍÑ…ÑÕÌL¥¹Ù½¥•}ÍÑ…ÑÕÌ°(€€€€€€€€€€€€€¤¹¥L¥¹Ù½¥•}¥°¤¹Ñ•¹…¹Ñ}¥°(€€€€€€€€€€€€€M]!8Ð¹Ñ•¹…¹Ñ}ÑåÁ”€ô€=5A9dœQ!8=1M¡Ð¹½µÁ…¹å}¹…µ”°€œœ¤(€€€€€€€€€€€€€€€€€€1MQI%4¡=9P¡=1M¡Ð¹™¥ÉÍÑ}¹…µ”°€œœ¤°€œ€œ°=1M¡Ð¹±…ÍÑ}¹…µ”°€œœ¤°€œ€œ°=1M¡Ð¹Á½ÍÑ}¹…µ”°€œœ¤¤¤(€€€€€€€€€€€€€9LÑ•¹…¹Ñ}¹…µ”°(€€€€€€€€€€€€€Ô¹¹Õµ‰•ÈLÕ¹¥Ñ}¹Õµ‰•È°ˆ¹¹…µ”L‰Õ¥±‘¥¹}¹…µ”(€€€€€€I=4Á…åµ•¹Ñ}…±±½…Ñ¥½¹ÌÁ„(€€€€€€)=%8Á…åµ•¹ÑÌÀ=8À¹¥€ôÁ„¹Á…åµ•¹Ñ}¥(€€€€€€€€9À¹½É…¹¥é…Ñ¥½¹}¥€ôÁ„¹½É…¹¥é…Ñ¥½¹}¥9À¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€)=%8¥¹Ù½¥•Ì¤=8¤¹¥€ôÁ„¹¥¹Ù½¥•}¥(€€€€€€€€9¤¹½É…¹¥é…Ñ¥½¹}¥€ôÁ„¹½É…¹¥é…Ñ¥½¹}¥9¤¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€)=%8Ñ•¹…¹ÑÌÐ=8Ð¹¥€ô¤¹Ñ•¹…¹Ñ}¥(€€€€€€€€9Ð¹½É…¹¥é…Ñ¥½¹}¥€ô¤¹½É…¹¥é…Ñ¥½¹}¥9Ð¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€1P)=%8±•…Í•Ì°=8°¹¥€ô¤¹±•…Í•}¥9°¹½É…¹¥é…Ñ¥½¹}¥€ô¤¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€1P)=%8Õ¹¥ÑÌÔ=8Ô¹¥€ô=1M¡¤¹Õ¹¥Ñ}¥°°¹Õ¹¥Ñ}¥°Ð¹Õ¹¥Ñ}¥¤9Ô¹½É…¹¥é…Ñ¥½¹}¥€ô¤¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€1P)=%8‰Õ¥±‘¥¹Ìˆ=8ˆ¹¥€ô=1M¡¤¹‰Õ¥±‘¥¹}¥°Ô¹‰Õ¥±‘¥¹}¥¤9ˆ¹½É…¹¥é…Ñ¥½¹}¥€ô¤¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€]!I€‘í½¹‘¥Ñ¥½¹ô(€€€€€€€€9À¹Á…åµ•¹Ñ}‘…Ñ”	Q]8€Ì9€Ð(€€€€€€€€9Á„¹½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€9Á„¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€9=1M¡À¹Á…åµ•¹Ñ}ÑåÁ”°€%9Y=%œ¤€ðø€Q99Q}I%Q}11=Q%=8œ((€€€€€€U9%=810((€€€€€€M1PÀ¹¥°9U10èé%9PL…±±½…Ñ¥½¹}¥°À¹Á…åµ•¹Ñ}‘…Ñ”°À¹…µ½Õ¹Ðèé1=PL…µ½Õ¹Ð°(€€€€€€€€€€€€€À¹…µ½Õ¹Ðèé1=PLÁ…åµ•¹Ñ}Ñ½Ñ…°°À¹Á…åµ•¹Ñ}µ•Ñ¡½°À¹É•™•É•¹”°À¹É••¥ÁÑ}¹Õµ‰•È°(€€€€€€€€€€€€€À¹ÕÉÉ•¹ä°À¹Ñ½Ñ…±}•ÅÕ¥Ù…±•¹Ñ}ÕÍ°¤¹¥¹Ù½¥•}¹Õµ‰•È°¤¹ÍÑ…ÑÕÌL¥¹Ù½¥•}ÍÑ…ÑÕÌ°(€€€€€€€€€€€€€¤¹¥L¥¹Ù½¥•}¥°¤¹Ñ•¹…¹Ñ}¥°(€€€€€€€€€€€€€M]!8Ð¹Ñ•¹…¹Ñ}ÑåÁ”€ô€=5A9dœQ!8=1M¡Ð¹½µÁ…¹å}¹…µ”°€œœ¤(€€€€€€€€€€€€€€€€€€1MQI%4¡=9P¡=1M¡Ð¹™¥ÉÍÑ}¹…µ”°€œœ¤°€œ€œ°=1M¡Ð¹±…ÍÑ}¹…µ”°€œœ¤°€œ€œ°=1M¡Ð¹Á½ÍÑ}¹…µ”°€œœ¤¤¤(€€€€€€€€€€€€€9LÑ•¹…¹Ñ}¹…µ”°(€€€€€€€€€€€€€Ô¹¹Õµ‰•ÈLÕ¹¥Ñ}¹Õµ‰•È°ˆ¹¹…µ”L‰Õ¥±‘¥¹}¹…µ”(€€€€€€I=4Á…åµ•¹ÑÌÀ(€€€€€€)=%8¥¹Ù½¥•Ì¤=8¤¹¥€ôÀ¹¥¹Ù½¥•}¥(€€€€€€€€9¤¹½É…¹¥é…Ñ¥½¹}¥€ôÀ¹½É…¹¥é…Ñ¥½¹}¥9¤¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€)=%8Ñ•¹…¹ÑÌÐ=8Ð¹¥€ô¤¹Ñ•¹…¹Ñ}¥(€€€€€€€€9Ð¹½É…¹¥é…Ñ¥½¹}¥€ô¤¹½É…¹¥é…Ñ¥½¹}¥9Ð¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€1P)=%8±•…Í•Ì°=8°¹¥€ô¤¹±•…Í•}¥9°¹½É…¹¥é…Ñ¥½¹}¥€ô¤¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€1P)=%8Õ¹¥ÑÌÔ=8Ô¹¥€ô=1M¡¤¹Õ¹¥Ñ}¥°°¹Õ¹¥Ñ}¥°Ð¹Õ¹¥Ñ}¥¤9Ô¹½É…¹¥é…Ñ¥½¹}¥€ô¤¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€1P)=%8‰Õ¥±‘¥¹Ìˆ=8ˆ¹¥€ô=1M¡¤¹‰Õ¥±‘¥¹}¥°Ô¹‰Õ¥±‘¥¹}¥¤9ˆ¹½É…¹¥é…Ñ¥½¹}¥€ô¤¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€]!I€‘í½¹‘¥Ñ¥½¹ô(€€€€€€€€9À¹Á…åµ•¹Ñ}‘…Ñ”	Q]8€Ì9€Ð(€€€€€€€€9À¹½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€9À¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€9=1M¡À¹Á…åµ•¹Ñ}ÑåÁ”°€%9Y=%œ¤€ðø€Q99Q}I%Q}11=Q%=8œ(€€€€€€€€99=Pa%MQL€ (€€€€€€€€€€M1P€ÄI=4Á…åµ•¹Ñ}…±±½…Ñ¥½¹ÌÁ„(€€€€€€€€€€]!IÁ„¹Á…åµ•¹Ñ}¥€ôÀ¹¥9Á„¹½É…¹¥é…Ñ¥½¹}¥€ôÀ¹½É…¹¥é…Ñ¥½¹}¥9Á„¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€€¤(€€€€€¤(€€€€M1P€¨I=4Í½Á•‘}Á…åµ•¹ÑÌ=IH	dÁ…åµ•¹Ñ}‘…Ñ”M°¥M°…±±½…Ñ¥½¹}¥M9U11L1MQ€ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä¡ÍÅ°°m¥°½É…¹¥é…Ñ¥½¹%°ÍÑ…ÉÐ°•¹‘t¤ì(€€€É•ÑÕÉ¸É½ÝÌì(€ô((€ÁÉ¥Ù…Ñ”ÍÑ…Ñ•µ•¹Ñ5½Ù•µ•¹ÑÌ (€€€½Á•¹¥¹	…±…¹”è¹Õµ‰•È°(€€€¥¹Ù½¥•ÌèI•½ÉñÍÑÉ¥¹œ°…¹äùmt°(€€€Á…åµ•¹ÑÌèI•½ÉñÍÑÉ¥¹œ°…¹äùmt°(€€€Ñ•¹…¹ÑÉ•‘¥ÑÌèI•½ÉñÍÑÉ¥¹œ°…¹äùmt°(€€€Ñ•¹…¹ÑÉ•‘¥ÑI•™Õ¹‘ÌèI•½ÉñÍÑÉ¥¹œ°…¹äùmt°(€€€Ñ•¹…¹ÑÉ•‘¥Ñ±±½…Ñ¥½¹ÌèI•½ÉñÍÑÉ¥¹œ°…¹äùmt°(€€€ÕÉÉ•¹äèÍÑÉ¥¹œ°(€€€½Á•¹¥¹…Ñ”èÍÑÉ¥¹œ°(€€¤ì(€€€½¹ÍÐÉ½ÝÌ€ôl(€€€€€ì(€€€€€€€‘…Ñ”è½Á•¹¥¹…Ñ”°(€€€€€€€É•™•É•¹”è€=UYIQUIœ°(€€€€€€€µ½Ù•µ•¹Ñ}ÑåÁ”è€=A9%9œ°(€€€€€€€±…‰•°è€M½±‘”¥¹¥Ñ¥…°œ°(€€€€€€€‘•‰¥Ðè€À°(€€€€€€€É•‘¥Ðè€À°(€€€€€€€ÕÉÉ•¹ä°(€€€€€€€ÉÕ¹¹¥¹}‰…±…¹”è9Õµ‰•È¡½Á•¹¥¹	…±…¹”¹Ñ½¥á• È¤¤°(€€€€€ô°(€€€€€€¸¸¹¥¹Ù½¥•Ì¹µ…À ¡¥¹Ù½¥”¤€ôø€¡ì(€€€€€€€‘…Ñ”è¥¹Ù½¥”¹¥ÍÍÕ•}‘…Ñ”°(€€€€€€€É•™•É•¹”è¥¹Ù½¥”¹¥¹Ù½¥•}¹Õµ‰•È°(€€€€€€€µ½Ù•µ•¹Ñ}ÑåÁ”è€%9Y=%œ°(€€€€€€€±…‰•°è…ÑÕÉ”€‘í¥¹Ù½¥”¹¥¹Ù½¥•}¹Õµ‰•Éô‘íÉÉ…ä¹¥ÍÉÉ…ä¡¥¹Ù½¥”¹¥Ñ•µÌ¤€˜˜¥¹Ù½¥”¹¥Ñ•µÌ¹±•¹Ñ (€€€€€€€€€€ü€€´€‘í¥¹Ù½¥”¹¥Ñ•µÌ¹µ…À ¡¥Ñ•´èI•½ÉñÍÑÉ¥¹œ°…¹äø¤€ôø€‘í¥Ñ•´¹‘•ÍÉ¥ÁÑ¥½¸ñð¥Ñ•´¹¥Ñ•µ}ÑåÁ”ñð€1¥¹”ô€‘í9Õµ‰•È¡¥Ñ•´¹…µ½Õ¹Ð€üü€À¤¹Ñ½¥á• È¥õ€¤¹©½¥¸ œ€¼€œ¥õ€(€€€€€€€€€€è€œõ€°(€€€€€€€‘•‰¥Ðè9Õµ‰•È¡¥¹Ù½¥”¹Ñ½Ñ…°€üü€À¤°(€€€€€€€É•‘¥Ðè€À°(€€€€€€€ÕÉÉ•¹ä°(€€€€€€€Í½ÕÉ•}¥è¥¹Ù½¥”¹¥°(€€€€€ô¤¤°(€€€€€€¸¸¹Á…åµ•¹ÑÌ¹µ…À ¡Á…åµ•¹Ð¤€ôø€¡ì(€€€€€€€‘…Ñ”èÁ…åµ•¹Ð¹Á…åµ•¹Ñ}‘…Ñ”°(€€€€€€€É•™•É•¹”èÁ…åµ•¹Ð¹É••¥ÁÑ}¹Õµ‰•È€üüÁ…åµ•¹Ð¹É•™•É•¹”€üüÁ…åµ•¹Ð¹¥¹Ù½¥•}¹Õµ‰•È°(€€€€€€€µ½Ù•µ•¹Ñ}ÑåÁ”è€Ae59Pœ°(€€€€€€€±…‰•°èA…¥•µ•¹Ð€‘íÁ…åµ•¹Ð¹¥¹Ù½¥•}¹Õµ‰•È€üüÁ…åµ•¹Ð¹É••¥ÁÑ}¹Õµ‰•È€üüÁ…åµ•¹Ð¹É•™•É•¹”€üü€Œ‘íÁ…åµ•¹Ð¹¥‘õõ€°(€€€€€€€‘•‰¥Ðè€À°(€€€€€€€É•‘¥Ðè9Õµ‰•È¡Á…åµ•¹Ð¹…µ½Õ¹Ð€üü€À¤°(€€€€€€€ÕÉÉ•¹ä°(€€€€€€€Í½ÕÉ•}¥èÁ…åµ•¹Ð¹¥°(€€€€€ô¤¤°(€€€€€€¸¸¹Ñ•¹…¹ÑÉ•‘¥ÑÌ¹µ…À ¡É•‘¥Ð¤€ôø€¡ì(€€€€€€€‘…Ñ”èÉ•‘¥Ð¹Á…åµ•¹Ñ}‘…Ñ”°(€€€€€€€É•™•É•¹”èÉ•‘¥Ð¹É••¥ÁÑ}¹Õµ‰•È€üüÉ•‘¥Ð¹É•™•É•¹”€üü€Œ‘íÉ•‘¥Ð¹¥‘õ€°(€€€€€€€µ½Ù•µ•¹Ñ}ÑåÁ”è€Q99Q}I%Pœ°(€€€€€€€±…‰•°èË¥‘¥Ð±½…Ñ…¥É”€‘íÉ•‘¥Ð¹É••¥ÁÑ}¹Õµ‰•È€üüÉ•‘¥Ð¹É•™•É•¹”€üü€Œ‘íÉ•‘¥Ð¹¥‘õõ€°(€€€€€€€‘•‰¥Ðè€À°(€€€€€€€É•‘¥Ðè9Õµ‰•È¡É•‘¥Ð¹½É¥¥¹…±}…µ½Õ¹Ð€üüÉ•‘¥Ð¹…µ½Õ¹Ð€üü€À¤°(€€€€€€€ÕÉÉ•¹äèMÑÉ¥¹œ¡É•‘¥Ð¹ÕÉÉ•¹ä€üüÕÉÉ•¹ä¤°(€€€€€€€Í½ÕÉ•}¥èÉ•‘¥Ð¹¥°(€€€€€ô¤¤°(€€€€€€¸¸¹Ñ•¹…¹ÑÉ•‘¥Ñ±±½…Ñ¥½¹Ì¹µ…À ¡…±±½…Ñ¥½¸¤€ôø€¡ì(€€€€€€€‘…Ñ”è…±±½…Ñ¥½¸¹…±±½…Ñ¥½¹}‘…Ñ”°(€€€€€€€É•™•É•¹”è…±±½…Ñ¥½¸¹É••¥ÁÑ}¹Õµ‰•È€üü…±±½…Ñ¥½¸¹É•‘¥Ñ}É•™•É•¹”€üü€Œ‘í…±±½…Ñ¥½¸¹¥‘õ€°(€€€€€€€µ½Ù•µ•¹Ñ}ÑåÁ”è€Q99Q}I%Q}11=Q%=8œ°(€€€€€€€±…‰•°è™™•Ñ…Ñ¥½¸Ë¥‘¥ÐÙ•ÉÌ€‘í…±±½…Ñ¥½¸¹¥¹Ù½¥•}¹Õµ‰•È€üü™…ÑÕÉ”€Œ‘í…±±½…Ñ¥½¸¹¥¹Ù½¥•}¥‘õô€ ‘í9Õµ‰•È¡…±±½…Ñ¥½¸¹…µ½Õ¹Ð€üü€À¤¹Ñ½¥á• È¥ô€‘í…±±½…Ñ¥½¸¹ÕÉÉ•¹ä€üüÕÉÉ•¹åô¥€°(€€€€€€€‘•‰¥Ðè€À°(€€€€€€€É•‘¥Ðè€À°(€€€€€€€ÕÉÉ•¹äèMÑÉ¥¹œ¡…±±½…Ñ¥½¸¹ÕÉÉ•¹ä€üüÕÉÉ•¹ä¤°(€€€€€€€Í½ÕÉ•}¥è…±±½…Ñ¥½¸¹¥°(€€€€€€€¥¹™½Éµ…Ñ¥½¹…±}…µ½Õ¹Ðè9Õµ‰•È¡…±±½…Ñ¥½¸¹…µ½Õ¹Ð€üü€À¤°(€€€€€ô¤¤°(€€€€€€¸¸¹Ñ•¹…¹ÑÉ•‘¥ÑI•™Õ¹‘Ì¹µ…À ¡É•™Õ¹¤€ôø€¡ì(€€€€€€€‘…Ñ”èÉ•™Õ¹¹É•™Õ¹‘}‘…Ñ”°(€€€€€€€É•™•É•¹”èÉ•™Õ¹¹É••¥ÁÑ}¹Õµ‰•È€üüÉ•™Õ¹¹É•™•É•¹”€üü€Œ‘íÉ•™Õ¹¹¥‘õ€°(€€€€€€€µ½Ù•µ•¹Ñ}ÑåÁ”è€Q99Q}I%Q}IU9œ°(€€€€€€€±…‰•°è€‘íMÑÉ¥¹œ¡É•™Õ¹¹ÍÑ…ÑÕÌ€üü€œœ¤¹Ñ½UÁÁ•É…Í” ¤€ôôô€911œ€ü€¹¹Õ±…Ñ¥½¸œ€è€I•µ‰½ÕÉÍ•µ•¹ÐôË¥‘¥Ð±½…Ñ…¥É”‘íÉ•™Õ¹¹É•…Í½¸€ü€€´€‘íÉ•™Õ¹¹É•…Í½¹õ€€è€œõ€°(€€€€€€€‘•‰¥Ðè9Õµ‰•È¡É•™Õ¹¹…µ½Õ¹Ð€üü€À¤°(€€€€€€€É•‘¥Ðè€À°(€€€€€€€ÕÉÉ•¹äèMÑÉ¥¹œ¡É•™Õ¹¹ÕÉÉ•¹ä€üüÕÉÉ•¹ä¤°(€€€€€€€Í½ÕÉ•}¥èÉ•™Õ¹¹¥°(€€€€€ô¤¤°(€€€t¹Í½ÉÐ ¡„°ˆ¤€ôøì(€€€€€½¹ÍÐ‘…Ñ•¥™˜€ô¹•Ü…Ñ”¡MÑÉ¥¹œ¡„¹‘…Ñ”¤¤¹•ÑQ¥µ” ¤€´¹•Ü…Ñ”¡MÑÉ¥¹œ¡ˆ¹‘…Ñ”¤¤¹•ÑQ¥µ” ¤ì(€€€€€¥˜€¡‘…Ñ•¥™˜€„ôô€À¤É•ÑÕÉ¸‘…Ñ•¥™˜ì(€€€€€É•ÑÕÉ¸Ñ¡¥Ì¹ÍÑ…Ñ•µ•¹Ñ5½Ù•µ•¹Ñ=É‘•È¡MÑÉ¥¹œ¡„¹µ½Ù•µ•¹Ñ}ÑåÁ”¤¤€´Ñ¡¥Ì¹ÍÑ…Ñ•µ•¹Ñ5½Ù•µ•¹Ñ=É‘•È¡MÑÉ¥¹œ¡ˆ¹µ½Ù•µ•¹Ñ}ÑåÁ”¤¤ì(€€€ô¤ì(€€€±•ÐÉÕ¹¹¥¹œ€ô9Õµ‰•È¡½Á•¹¥¹	…±…¹”€üü€À¤ì(€€€É•ÑÕÉ¸É½ÝÌ¹µ…À ¡É½Ü°¥¹‘•à¤€ôøì(€€€€€¥˜€¡¥¹‘•à€ôôô€À€˜˜É½Ü¹µ½Ù•µ•¹Ñ}ÑåÁ”€ôôô€=A9%9œ¤É•ÑÕÉ¸É½Üì(€€€€€ÉÕ¹¹¥¹œ€¬ô9Õµ‰•È¡É½Ü¹‘•‰¥Ð€üü€À¤€´9Õµ‰•È¡É½Ü¹É•‘¥Ð€üü€À¤ì(€€€€€É•ÑÕÉ¸ì€¸¸¹É½Ü°ÉÕ¹¹¥¹}‰…±…¹”è9Õµ‰•È¡ÉÕ¹¹¥¹œ¹Ñ½¥á• È¤¤ôì(€€€ô¤ì(€ô((€…Íå¹Œ…Ù…¥±…‰¥±¥ÑåI•Á½ÉÐ ¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1Pˆ¹¥L‰Õ¥±‘¥¹}¥°ˆ¹¹…µ”L‰Õ¥±‘¥¹}¹…µ”°(€€€€€€€€€€€€=U9P¡Ô¹¥¤èé%9PLÑ½Ñ…±}Õ¹¥ÑÌ°(€€€€€€€€€€€€=U9P ¨¤%1QH€¡]!IÔ¹ÍÑ…ÑÕÌ€ô€=UA%œ¤èé%9PL½ÕÁ¥•‘}Õ¹¥ÑÌ°(€€€€€€€€€€€€=U9P ¨¤%1QH€¡]!IÔ¹ÍÑ…ÑÕÌ€ô€Y9Pœ¤èé%9PLÙ……¹Ñ}Õ¹¥ÑÌ°(€€€€€€€€€€€€=U9P ¨¤%1QH€¡]!IÔ¹ÍÑ…ÑÕÌ€ô€5%9Q99œ¤èé%9PLµ…¥¹Ñ•¹…¹•}Õ¹¥ÑÌ°(€€€€€€€€€€€€=U9P ¨¤%1QH€¡]!IÔ¹ÍÑ…ÑÕÌ€ô€	1=-œ¤èé%9PL‰±½­•‘}Õ¹¥ÑÌ°(€€€€€€€€€€€€=1M¡MU4¡M]!8Ô¹ÍÑ…ÑÕÌ€ô€Y9PœQ!8Ô¹µ½¹Ñ¡±å}É•¹Ð1M€À9¤°€À¤èé1=PLÙ……¹Ñ}Á½Ñ•¹Ñ¥…±}É•¹Ð°(€€€€€€€€€€€€M]!8=U9P¡Ô¹¥¤€ø€ÀQ!8I=U9 ¡=U9P ¨¤%1QH€¡]!IÔ¹ÍÑ…ÑÕÌ€ô€=UA%œ¤èé9U5I%€¼=U9P¡Ô¹¥¤èé9U5I%¤€¨€ÄÀÀ°€È¤èé1=P1M€À9L½ÕÁ…¹å}É…Ñ”(€€€€€I=4‰Õ¥±‘¥¹Ìˆ(€€€€€)=%8Õ¹¥ÑÌÔ=8Ô¹‰Õ¥±‘¥¹}¥€ôˆ¹¥(€€€€€]!Iˆ¹½É…¹¥é…Ñ¥½¹}¥€ô€Ä9ˆ¹‘•±•Ñ•‘}…Ð%L9U109Ô¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€I=U@	dˆ¹¥°ˆ¹¹…µ”(€€€€€=IH	dˆ¹¹…µ”(€€€€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€É•ÑÕÉ¸ì(€€€€€‰Õ¥±‘¥¹ÌèÉ½ÝÌ°(€€€€€Ñ½Ñ…±Ìèì(€€€€€€€Ñ½Ñ…±}Õ¹¥ÑÌèÉ½ÝÌ¹É•‘Õ” ¡ÍÕ´°É½Ü¤€ôøÍÕ´€¬9Õµ‰•È¡É½Ü¹Ñ½Ñ…±}Õ¹¥ÑÌ¤°€À¤°(€€€€€€€½ÕÁ¥•‘}Õ¹¥ÑÌèÉ½ÝÌ¹É•‘Õ” ¡ÍÕ´°É½Ü¤€ôøÍÕ´€¬9Õµ‰•È¡É½Ü¹½ÕÁ¥•‘}Õ¹¥ÑÌ¤°€À¤°(€€€€€€€Ù……¹Ñ}Õ¹¥ÑÌèÉ½ÝÌ¹É•‘Õ” ¡ÍÕ´°É½Ü¤€ôøÍÕ´€¬9Õµ‰•È¡É½Ü¹Ù……¹Ñ}Õ¹¥ÑÌ¤°€À¤°(€€€€€€€µ…¥¹Ñ•¹…¹•}Õ¹¥ÑÌèÉ½ÝÌ¹É•‘Õ” ¡ÍÕ´°É½Ü¤€ôøÍÕ´€¬9Õµ‰•È¡É½Ü¹µ…¥¹Ñ•¹…¹•}Õ¹¥ÑÌ¤°€À¤°(€€€€€€€‰±½­•‘}Õ¹¥ÑÌèÉ½ÝÌ¹É•‘Õ” ¡ÍÕ´°É½Ü¤€ôøÍÕ´€¬9Õµ‰•È¡É½Ü¹‰±½­•‘}Õ¹¥ÑÌ¤°€À¤°(€€€€€€€Ù……¹Ñ}Á½Ñ•¹Ñ¥…±}É•¹ÐèÉ½ÝÌ¹É•‘Õ” ¡ÍÕ´°É½Ü¤€ôøÍÕ´€¬9Õµ‰•È¡É½Ü¹Ù……¹Ñ}Á½Ñ•¹Ñ¥…±}É•¹Ð¤°€À¤°(€€€€€ô°(€€€ôì(€ô((€…Íå¹Œ½Ù•É‘Õ•I•Á½ÉÐ¡‰Õ¥±‘¥¹%üè¹Õµ‰•È°Ñ•¹…¹Ñ%üè¹Õµ‰•È¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1P¤¹¥¹Ù½¥•}¹Õµ‰•È°¤¹‘Õ•}‘…Ñ”°¤¹ÍÑ…ÑÕÌ°¤¹Ñ½Ñ…°°(€€€€€€€€€€€€€=1M¡Ì¹Á…¥‘}…µ½Õ¹Ð°€À¤èé1=PLÁ…¥‘}…µ½Õ¹Ð°(€€€€€€€€€€€€€=1M¡Ì¹É•µ…¥¹¥¹}…µ½Õ¹Ð°¤¹Ñ½Ñ…°¤èé1=PLÉ•µ…¥¹¥¹}…µ½Õ¹Ð°(€€€€€€€€€€€€€=9P¡Ð¹™¥ÉÍÑ}¹…µ”°€œ€œ°Ð¹±…ÍÑ}¹…µ”¤LÑ•¹…¹Ñ}¹…µ”°ˆ¹¹…µ”L‰Õ¥±‘¥¹}¹…µ”°Ô¹¹Õµ‰•ÈLÕ¹¥Ñ}¹Õµ‰•È(€€€€€€I=4¥¹Ù½¥•Ì¤(€€€€€€)=%8Ñ•¹…¹ÑÌÐ=8Ð¹¥€ô¤¹Ñ•¹…¹Ñ}¥(€€€€€€1P)=%8Õ¹¥ÑÌÔ=8Ô¹¥€ô¤¹Õ¹¥Ñ}¥(€€€€€€1P)=%8‰Õ¥±‘¥¹Ìˆ=8ˆ¹¥€ô¤¹‰Õ¥±‘¥¹}¥(€€€€€€1P)=%8¥¹Ù½¥•}Á…åµ•¹Ñ}ÍÕµµ…ÉäÌ=8Ì¹¥¹Ù½¥•}¥€ô¤¹¥(€€€€€€]!I¤¹½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€9¤¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€9¤¹ÍÑ…ÑÕÌ€ðø€A%œ(€€€€€€€€9¤¹‘Õ•}‘…Ñ”€ðUII9Q}Q(€€€€€€€€9€ Èèé%9P%L9U10=Hˆ¹¥€ô€È¤(€€€€€€€€9€ Ìèé%9P%L9U10=HÐ¹¥€ô€Ì¤(€€€€€€=IH	d¤¹‘Õ•}‘…Ñ”°¤¹¥¹Ù½¥•}¹Õµ‰•É€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°‰Õ¥±‘¥¹%€üü¹Õ±°°Ñ•¹…¹Ñ%€üü¹Õ±±t°(€€€€¤ì(€€€É•ÑÕÉ¸ì(€€€€€¥¹Ù½¥•ÌèÉ½ÝÌ°(€€€€€½Õ¹ÐèÉ½ÝÌ¹±•¹Ñ °(€€€€€Ñ½Ñ…±}É•µ…¥¹¥¹œèÉ½ÝÌ¹É•‘Õ” ¡ÍÕ´°É½Ü¤€ôøÍÕ´€¬9Õµ‰•È¡É½Ü¹É•µ…¥¹¥¹}…µ½Õ¹Ð¤°€À¤°(€€€ôì(€ô((€…Íå¹Œ•áÁ½ÉÑI•Á½ÉÐ¡ÑåÁ”èÍÑÉ¥¹œ°¥üè¹Õµ‰•È°ÍÑ…ÉÐüèÍÑÉ¥¹œ°•¹üèÍÑÉ¥¹œ¤ì(€€€¥˜€¡ÑåÁ”€ôôô€‰Õ¥±‘¥¹œœ€˜˜¥¤ì(€€€€€½¹ÍÐÉ•Á½ÉÐ€ô…Ý…¥ÐÑ¡¥Ì¹‰Õ¥±‘¥¹I•Á½ÉÐ¡¥°ìÍÑ…ÉÐ°•¹ô¤ì(€€€€€É•ÑÕÉ¸ì™¥±•¹…µ”è€É…ÁÁ½ÉÐµ¥µµ•Õ‰±”¹ÍØœ°É½ÝÌèl¸¸¹É•Á½ÉÐ¹Õ¹¥ÑÌ°€¸¸¹É•Á½ÉÐ¹Ñ•¹…¹ÑÍtôì(€€€ô(€€€¥˜€¡ÑåÁ”€ôôô€Ñ•¹…¹Ðœ€˜˜¥¤ì(€€€€€½¹ÍÐÉ•Á½ÉÐ€ô…Ý…¥ÐÑ¡¥Ì¹Ñ•¹…¹ÑI•Á½ÉÐ¡¥°ìÍÑ…ÉÐ°•¹ô¤ì(€€€€€É•ÑÕÉ¸ì™¥±•¹…µ”è€É…ÁÁ½ÉÐµ±½…Ñ…¥É”¹ÍØœ°É½ÝÌèl¸¸¹É•Á½ÉÐ¹±•…Í•Ì°€¸¸¹É•Á½ÉÐ¹¥¹Ù½¥•Ì°€¸¸¹É•Á½ÉÐ¹Á…åµ•¹ÑÍtôì(€€€ô(€€€¥˜€¡ÑåÁ”€ôôô€Á…åµ•¹ÑÌœ¤ì(€€€€€½¹ÍÐÉ•Á½ÉÐ€ô…Ý…¥ÐÑ¡¥Ì¹Á…åµ•¹ÑÍI•Á½ÉÐ¡ìÍÑ…ÉÐ°•¹ô¤ì(€€€€€É•ÑÕÉ¸ì™¥±•¹…µ”è€É…ÁÁ½ÉÐµÁ…¥•µ•¹ÑÌ¹ÍØœ°É½ÝÌèÉ•Á½ÉÐ¹Á…åµ•¹ÑÍ}É••¥Ù•ôì(€€€ô(€€€¥˜€¡ÑåÁ”€ôôô€½Ù•É‘Õ”œ¤ì(€€€€€½¹ÍÐÉ•Á½ÉÐ€ô…Ý…¥ÐÑ¡¥Ì¹½Ù•É‘Õ•I•Á½ÉÐ ¤ì(€€€€€É•ÑÕÉ¸ì™¥±•¹…µ”è€É…ÁÁ½ÉÐµ¥µÁ…å•Ì¹ÍØœ°É½ÝÌèÉ•Á½ÉÐ¹¥¹Ù½¥•Ìôì(€€€ô(€€€½¹ÍÐÉ•Á½ÉÐ€ô…Ý…¥ÐÑ¡¥Ì¹…Ù…¥±…‰¥±¥ÑåI•Á½ÉÐ ¤ì(€€€É•ÑÕÉ¸ì™¥±•¹…µ”è€É…ÁÁ½ÉÐµ‘¥ÍÁ½¹¥‰¥±¥Ñ”¹ÍØœ°É½ÝÌèÉ•Á½ÉÐ¹‰Õ¥±‘¥¹Ìôì(€ô((€…Íå¹Œ…Í¡I•Á½ÉÐ ¤ì(€€€½¹ÍÐÍ•ÍÍ¥½¹Ì€ô…Ý…¥ÐÑ¡¥Ì¹™¥¹‘±° …Í¡}Í•ÍÍ¥½¹Ìœ°€½Á•¹•‘}…ÐMœ¤ì(€€€½¹ÍÐµ½Ù•µ•¹ÑÌ€ô…Ý…¥ÐÑ¡¥Ì¹…Í¡5½Ù•µ•¹ÑÌ ¤ì(€€€½¹ÍÐ‰åÕÉÉ•¹ä€ô=‰©•Ð¹Ù…±Õ•Ì (€€€€€µ½Ù•µ•¹ÑÌ¹É•‘Õ”ñI•½ÉñÍÑÉ¥¹œ°ìÕÉÉ•¹äèÍÑÉ¥¹œì…µ½Õ¹Ñ}¥¸è¹Õµ‰•Èì…µ½Õ¹Ñ}½ÕÐè¹Õµ‰•Èì‰…±…¹”è¹Õµ‰•Èôøø ¡…Œ°µ½Ù•µ•¹Ð¤€ôøì(€€€€€€€½¹ÍÐÕÉÉ•¹ä€ôMÑÉ¥¹œ¡µ½Ù•µ•¹Ð¹ÕÉÉ•¹ä€üü€UMœ¤¹Ñ½UÁÁ•É…Í” ¤ì(€€€€€€€…mÕÉÉ•¹åt€üüôìÕÉÉ•¹ä°…µ½Õ¹Ñ}¥¸è€À°…µ½Õ¹Ñ}½ÕÐè€À°‰…±…¹”è€Àôì(€€€€€€€½¹ÍÐ…µ½Õ¹Ð€ô9Õµ‰•È¡µ½Ù•µ•¹Ð¹…µ½Õ¹Ð€üü€À¤ì(€€€€€€€¥˜€¡µ½Ù•µ•¹Ð¹ÑåÁ”€ôôô€%8œ¤…mÕÉÉ•¹åt¹…µ½Õ¹Ñ}¥¸€¬ô…µ½Õ¹Ðì(€€€€€€€¥˜€¡µ½Ù•µ•¹Ð¹ÑåÁ”€ôôô€=UPœ¤…mÕÉÉ•¹åt¹…µ½Õ¹Ñ}½ÕÐ€¬ô…µ½Õ¹Ðì(€€€€€€€…mÕÉÉ•¹åt¹‰…±…¹”€ô…mÕÉÉ•¹åt¹…µ½Õ¹Ñ}¥¸€´…mÕÉÉ•¹åt¹…µ½Õ¹Ñ}½ÕÐì(€€€€€€€É•ÑÕÉ¸…Œì(€€€€€ô°íô¤°(€€€€¤ì(€€€É•ÑÕÉ¸ì(€€€€€Í•ÍÍ¥½¹Ì°(€€€€€µ½Ù•µ•¹ÑÌ°(€€€€€Ñ½Ñ…±}¥¸èµ½Ù•µ•¹ÑÌ¹™¥±Ñ•È ¡´¤€ôø´¹ÑåÁ”€ôôô€%8œ¤¹É•‘Õ” ¡ÍÕ´°´¤€ôøÍÕ´€¬9Õµ‰•È¡´¹…µ½Õ¹Ð¤°€À¤°(€€€€€Ñ½Ñ…±}½ÕÐèµ½Ù•µ•¹ÑÌ¹™¥±Ñ•È ¡´¤€ôø´¹ÑåÁ”€ôôô€=UPœ¤¹É•‘Õ” ¡ÍÕ´°´¤€ôøÍÕ´€¬9Õµ‰•È¡´¹…µ½Õ¹Ð¤°€À¤°(€€€€€‰å}ÕÉÉ•¹äè‰åÕÉÉ•¹ä°(€€€€€‰å}…Ñ•½Éäè=‰©•Ð¹Ù…±Õ•Ì (€€€€€€€µ½Ù•µ•¹ÑÌ¹É•‘Õ”ñI•½ÉñÍÑÉ¥¹œ°ì…Ñ•½ÉäèÍÑÉ¥¹œì…µ½Õ¹Ðè¹Õµ‰•Èôøø ¡…Œ°µ½Ù•µ•¹Ð¤€ôøì(€€€€€€€€€…mµ½Ù•µ•¹Ð¹…Ñ•½Éåt€üüôì…Ñ•½Éäèµ½Ù•µ•¹Ð¹…Ñ•½Éä°…µ½Õ¹Ðè€Àôì(€€€€€€€€€…mµ½Ù•µ•¹Ð¹…Ñ•½Éåt¹…µ½Õ¹Ð€¬ô9Õµ‰•È¡µ½Ù•µ•¹Ð¹…µ½Õ¹Ð¤ì(€€€€€€€€€É•ÑÕÉ¸…Œì(€€€€€€€ô°íô¤°(€€€€€€¤°(€€€ôì(€ô((€…Íå¹ŒÍÑ½­I•Á½ÉÐ ¤ì(€€€½¹ÍÐ¥Ñ•µÌ€ô…Ý…¥ÐÑ¡¥Ì¹ÍÑ½­%Ñ•µÌ ¤ì(€€€½¹ÍÐµ½Ù•µ•¹ÑÌ€ô…Ý…¥ÐÑ¡¥Ì¹ÍÑ½­5½Ù•µ•¹ÑÌ ¤ì(€€€½¹ÍÐ¥¹Ù•¹Ñ½É¥•Ì€ô…Ý…¥ÐÑ¡¥Ì¹ÍÑ½­%¹Ù•¹Ñ½É¥•Ì ¤ì(€€€½¹ÍÐ…±•ÉÑÌ€ô…Ý…¥ÐÑ¡¥Ì¹ÍÑ½­±•ÉÑÌ ¤ì(€€€½¹ÍÐÁÕÉ¡…Í•Ì€ô…Ý…¥ÐÑ¡¥Ì¹ÍÑ½­AÕÉ¡…Í•Ì ¤ì(€€€½¹ÍÐ‰å…Ñ•½Éä€ô=‰©•Ð¹Ù…±Õ•Ì¡¥Ñ•µÌ¹É•‘Õ” ¡…ŒèI•½ÉñÍÑÉ¥¹œ°ì…Ñ•½ÉäèÍÑÉ¥¹œìÅÕ…¹Ñ¥Ñäè¹Õµ‰•ÈìÙ…±Õ”è¹Õµ‰•Èôø°¥Ñ•´¤€ôøì(€€€€€½¹ÍÐ­•ä€ôMÑÉ¥¹œ¡¥Ñ•´¹…Ñ•½Éä€üü€M…¹Ì…Ó¥½É¥”œ¤ì(€€€€€…m­•åt€üüôì…Ñ•½Éäè­•ä°ÅÕ…¹Ñ¥Ñäè€À°Ù…±Õ”è€Àôì(€€€€€…m­•åt¹ÅÕ…¹Ñ¥Ñä€¬ô9Õµ‰•È¡¥Ñ•´¹ÕÉÉ•¹Ñ}ÅÕ…¹Ñ¥Ñä€üü€À¤ì(€€€€€…m­•åt¹Ù…±Õ”€¬ô9Õµ‰•È¡¥Ñ•´¹ÕÉÉ•¹Ñ}ÅÕ…¹Ñ¥Ñä€üü€À¤€¨9Õµ‰•È¡¥Ñ•´¹…Ù•É…•}ÁÕÉ¡…Í•}ÁÉ¥”€üü¥Ñ•´¹ÁÕÉ¡…Í•}ÁÉ¥”€üü€À¤ì(€€€€€É•ÑÕÉ¸…Œì(€€€ô°íô¤¤ì(€€€½¹ÍÐ‰åMÑ½É”€ô=‰©•Ð¹Ù…±Õ•Ì¡¥Ñ•µÌ¹É•‘Õ” ¡…ŒèI•½ÉñÍÑÉ¥¹œ°ìÍÑ½É”èÍÑÉ¥¹œìÅÕ…¹Ñ¥Ñäè¹Õµ‰•ÈìÙ…±Õ”è¹Õµ‰•Èôø°¥Ñ•´¤€ôøì(€€€€€½¹ÍÐ­•ä€ôMÑÉ¥¹œ¡¥Ñ•´¹ÍÑ½É”€üü€9½¸É•¹Í•¥»¤œ¤ì(€€€€€…m­•åt€üüôìÍÑ½É”è­•ä°ÅÕ…¹Ñ¥Ñäè€À°Ù…±Õ”è€Àôì(€€€€€…m­•åt¹ÅÕ…¹Ñ¥Ñä€¬ô9Õµ‰•È¡¥Ñ•´¹ÕÉÉ•¹Ñ}ÅÕ…¹Ñ¥Ñä€üü€À¤ì(€€€€€…m­•åt¹Ù…±Õ”€¬ô9Õµ‰•È¡¥Ñ•´¹ÕÉÉ•¹Ñ}ÅÕ…¹Ñ¥Ñä€üü€À¤€¨9Õµ‰•È¡¥Ñ•´¹…Ù•É…•}ÁÕÉ¡…Í•}ÁÉ¥”€üü¥Ñ•´¹ÁÕÉ¡…Í•}ÁÉ¥”€üü€À¤ì(€€€€€É•ÑÕÉ¸…Œì(€€€ô°íô¤¤ì(€€€É•ÑÕÉ¸ì(€€€€€¥Ñ•µÌ°(€€€€€µ½Ù•µ•¹ÑÌ°(€€€€€¥¹Ù•¹Ñ½É¥•Ì°(€€€€€…±•ÉÑÌ°(€€€€€ÁÕÉ¡…Í•Ì°(€€€€€‰å}…Ñ•½Éäè‰å…Ñ•½Éä°(€€€€€‰å}ÍÑ½É”è‰åMÑ½É”°(€€€€€ÁÕÉ¡…Í•Í}‰å}ÍÕÁÁ±¥•Èè=‰©•Ð¹Ù…±Õ•Ì (€€€€€€€ÁÕÉ¡…Í•Ì¹É•‘Õ” ¡…ŒèI•½ÉñÍÑÉ¥¹œ°ìÍÕÁÁ±¥•ÈèÍÑÉ¥¹œì½Õ¹Ðè¹Õµ‰•Èì…µ½Õ¹Ðè¹Õµ‰•ÈìÁ…¥è¹Õµ‰•Èì½ÕÑÍÑ…¹‘¥¹œè¹Õµ‰•Èôø°ÁÕÉ¡…Í”¤€ôøì(€€€€€€€€€½¹ÍÐ­•ä€ôMÑÉ¥¹œ¡ÁÕÉ¡…Í”¹ÍÕÁÁ±¥•É}¹…µ”€üü€9½¸É•¹Í•¥¹”œ¤ì(€€€€€€€€€…m­•åt€üüôìÍÕÁÁ±¥•Èè­•ä°½Õ¹Ðè€À°…µ½Õ¹Ðè€À°Á…¥è€À°½ÕÑÍÑ…¹‘¥¹œè€Àôì(€€€€€€€€€…m­•åt¹½Õ¹Ð€¬ô€Äì(€€€€€€€€€…m­•åt¹…µ½Õ¹Ð€¬ô9Õµ‰•È¡ÁÕÉ¡…Í”¹Ñ½Ñ…±}…µ½Õ¹Ð€üü€À¤ì(€€€€€€€€€…m­•åt¹Á…¥€¬ô9Õµ‰•È¡ÁÕÉ¡…Í”¹Á…¥‘}…µ½Õ¹Ð€üü€À¤ì(€€€€€€€€€…m­•åt¹½ÕÑÍÑ…¹‘¥¹œ€¬ô9Õµ‰•È¡ÁÕÉ¡…Í”¹½ÕÑÍÑ…¹‘¥¹}…µ½Õ¹Ð€üü€À¤ì(€€€€€€€€€É•ÑÕÉ¸…Œì(€€€€€€€ô°íô¤°(€€€€€€¤°(€€€€€ÁÕÉ¡…Í•Í}‰å}µ½¹Ñ è=‰©•Ð¹Ù…±Õ•Ì (€€€€€€€ÁÕÉ¡…Í•Ì¹É•‘Õ” ¡…ŒèI•½ÉñÍÑÉ¥¹œ°ìÁ•É¥½èÍÑÉ¥¹œì…µ½Õ¹Ðè¹Õµ‰•ÈìÁ…¥è¹Õµ‰•Èì½Õ¹Ðè¹Õµ‰•Èôø°ÁÕÉ¡…Í”¤€ôøì(€€€€€€€€€½¹ÍÐ­•ä€ôMÑÉ¥¹œ¡ÁÕÉ¡…Í”¹ÁÕÉ¡…Í•}‘…Ñ”¤¹Í±¥” À°€Ü¤ì(€€€€€€€€€…m­•åt€üüôìÁ•É¥½è­•ä°…µ½Õ¹Ðè€À°Á…¥è€À°½Õ¹Ðè€Àôì(€€€€€€€€€…m­•åt¹…µ½Õ¹Ð€¬ô9Õµ‰•È¡ÁÕÉ¡…Í”¹Ñ½Ñ…±}…µ½Õ¹Ð€üü€À¤ì(€€€€€€€€€…m­•åt¹Á…¥€¬ô9Õµ‰•È¡ÁÕÉ¡…Í”¹Á…¥‘}…µ½Õ¹Ð€üü€À¤ì(€€€€€€€€€…m­•åt¹½Õ¹Ð€¬ô€Äì(€€€€€€€€€É•ÑÕÉ¸…Œì(€€€€€€€ô°íô¤°(€€€€€€¤¹Í½ÉÐ ¡„°ˆ¤€ôøMÑÉ¥¹œ¡„¹Á•É¥½¤¹±½…±•½µÁ…É”¡MÑÉ¥¹œ¡ˆ¹Á•É¥½¤¤¤°(€€€€€µ…¥¹Ñ•¹…¹•}½¹ÍÕµÁÑ¥½¸èµ½Ù•µ•¹ÑÌ¹™¥±Ñ•È ¡µ½Ù•µ•¹Ð¤€ôøµ½Ù•µ•¹Ð¹Í½ÕÉ”€ôôô€5%9Q99œ¤°(€€€€€Õ¹‘•É}µ¥¹¥µÕ´è¥Ñ•µÌ¹™¥±Ñ•È ¡¥Ñ•´¤€ôø¥Ñ•´¹ÍÑ…ÑÕÌ€ôôô€Q%Yœ€˜˜9Õµ‰•È¡¥Ñ•´¹ÕÉÉ•¹Ñ}ÅÕ…¹Ñ¥Ñä¤€ðô9Õµ‰•È¡¥Ñ•´¹µ¥¹¥µÕµ}ÅÕ…¹Ñ¥Ñä¤€˜˜9Õµ‰•È¡¥Ñ•´¹ÕÉÉ•¹Ñ}ÅÕ…¹Ñ¥Ñä¤€ø€À¤°(€€€€€½ÕÑ}½™}ÍÑ½¬è¥Ñ•µÌ¹™¥±Ñ•È ¡¥Ñ•´¤€ôø¥Ñ•´¹ÍÑ…ÑÕÌ€ôôô€Q%Yœ€˜˜9Õµ‰•È¡¥Ñ•´¹ÕÉÉ•¹Ñ}ÅÕ…¹Ñ¥Ñä¤€ðô€À¤°(€€€€€¥¹…Ñ¥Ù”è¥Ñ•µÌ¹™¥±Ñ•È ¡¥Ñ•´¤€ôø¥Ñ•´¹ÍÑ…ÑÕÌ€„ôô€Q%Yœ¤°(€€€€€Ù…±Õ…Ñ¥½¸è¥Ñ•µÌ¹É•‘Õ” ¡ÍÕ´°¥Ñ•´¤€ôøÍÕ´€¬9Õµ‰•È¡¥Ñ•´¹ÕÉÉ•¹Ñ}ÅÕ…¹Ñ¥Ñä¤€¨9Õµ‰•È¡¥Ñ•´¹…Ù•É…•}ÁÕÉ¡…Í•}ÁÉ¥”€üü¥Ñ•´¹ÁÕÉ¡…Í•}ÁÉ¥”€üü€À¤°€À¤°(€€€€€ÍÕÁÁ±¥•É}‘•‰ÐèÁÕÉ¡…Í•Ì¹É•‘Õ” ¡ÍÕ´°ÁÕÉ¡…Í”¤€ôøÍÕ´€¬9Õµ‰•È¡ÁÕÉ¡…Í”¹½ÕÑÍÑ…¹‘¥¹}…µ½Õ¹Ð€üü€À¤°€À¤°(€€€€€Á•¹‘¥¹}É••ÁÑ¥½¹ÌèÁÕÉ¡…Í•Ì¹™¥±Ñ•È ¡ÁÕÉ¡…Í”¤€ôøÁÕÉ¡…Í”¹É••ÁÑ¥½¹}ÍÑ…ÑÕÌ€„ôô€I%Yœ¤°(€€€€€Õ¹Á…¥‘}ÁÕÉ¡…Í•ÌèÁÕÉ¡…Í•Ì¹™¥±Ñ•È ¡ÁÕÉ¡…Í”¤€ôøÁÕÉ¡…Í”¹Á…åµ•¹Ñ}ÍÑ…ÑÕÌ€„ôô€A%œ¤°(€€€ôì(€ô((€…Íå¹ŒÍÑ…™™I•Á½ÉÐ¡ÍÑ…ÉÐ€ô€œÈÀÀÀ´ÀÄ´ÀÄœ°•¹€ô€œÈäää´ÄÈ´ÌÄœ°µ½¹Ñ üè¹Õµ‰•È°å•…Èüè¹Õµ‰•È¤ì(€€€½¹ÍÐ•µÁ±½å••Ì€ô…Ý…¥ÐÑ¡¥Ì¹™¥¹‘±° •µÁ±½å••Ìœ°€±…ÍÑ}¹…µ”°™¥ÉÍÑ}¹…µ”œ¤ì(€€€½¹ÍÐ…‘Ù…¹•Ì€ô…Ý…¥ÐÑ¡¥Ì¹Í…±…Éå‘Ù…¹•Ì ¤ì(€€€½¹ÍÐ±•…Ù•Ì€ô…Ý…¥ÐÑ¡¥Ì¹±•…Ù•Ì¡ÍÑ…ÉÐ°•¹¤ì(€€€½¹ÍÐÁ…åÉ½±±Ì€ô…Ý…¥ÐÑ¡¥Ì¹Á…åÉ½±±Ì¡ìµ½¹Ñ °å•…Èô¤ì(€€€É•ÑÕÉ¸ì(€€€€€•µÁ±½å••Ì°(€€€€€…‘Ù…¹•Ìè…‘Ù…¹•Ì¹™¥±Ñ•È ¡…‘Ù…¹”¤€ôøMÑÉ¥¹œ¡…‘Ù…¹”¹…‘Ù…¹•}‘…Ñ”¤¹Í±¥” À°€ÄÀ¤€øôÍÑ…ÉÐ€˜˜MÑÉ¥¹œ¡…‘Ù…¹”¹…‘Ù…¹•}‘…Ñ”¤¹Í±¥” À°€ÄÀ¤€ðô•¹¤°(€€€€€±•…Ù•Ì°(€€€€€Á…åÉ½±±Ì°(€€€€€ÍÕµµ…Éäèì(€€€€€€€…Ñ¥Ù•}•µÁ±½å••Ìè•µÁ±½å••Ì¹™¥±Ñ•È ¡•µÁ±½å•”¤€ôø•µÁ±½å•”¹ÍÑ…ÑÕÌ€ôôô€Q%Yœ¤¹±•¹Ñ °(€€€€€€€¥¹…Ñ¥Ù•}•µÁ±½å••Ìè•µÁ±½å••Ì¹™¥±Ñ•È ¡•µÁ±½å•”¤€ôø•µÁ±½å•”¹ÍÑ…ÑÕÌ€ôôô€%9Q%Yœ¤¹±•¹Ñ °(€€€€€€€…‘Ù…¹•Í}Ñ½Ñ…°è…‘Ù…¹•Ì¹É•‘Õ” ¡ÍÕ´°…‘Ù…¹”¤€ôøÍÕ´€¬9Õµ‰•È¡…‘Ù…¹”¹…µ½Õ¹Ð¤°€À¤°(€€€€€€€Á…åÉ½±±}¹•Ñ}Ñ½Ñ…°èÁ…åÉ½±±Ì¹É•‘Õ” ¡ÍÕ´°Á…åÉ½±°¤€ôøÍÕ´€¬9Õµ‰•È¡Á…åÉ½±°¹¹•Ñ}Í…±…Éä¤°€À¤°(€€€€€ô°(€€€ôì(€ô((€…Íå¹Œµ…¥¹Ñ•¹…¹•I•Á½ÉÐ¡™¥±Ñ•ÉÌèìÍÑ…ÉÐüèÍÑÉ¥¹œì•¹üèÍÑÉ¥¹œì‰Õ¥±‘¥¹%üè¹Õµ‰•Èì•µÁ±½å••%üè¹Õµ‰•Èô€ôíô¤ì(€€€½¹ÍÐÍÑ…ÉÐ€ô™¥±Ñ•ÉÌ¹ÍÑ…ÉÐ€üü€œÈÀÀÀ´ÀÄ´ÀÄœì(€€€½¹ÍÐ•¹€ô™¥±Ñ•ÉÌ¹•¹€üü€œÈäää´ÄÈ´ÌÄœì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1PµÈ¸¨°ˆ¹¹…µ”L‰Õ¥±‘¥¹}¹…µ”°Ô¹¹Õµ‰•ÈLÕ¹¥Ñ}¹Õµ‰•È°(€€€€€€€€€€€€€=9P¡”¹™¥ÉÍÑ}¹…µ”°€œ€œ°”¹±…ÍÑ}¹…µ”¤LÑ•¡¹¥¥…¹}¹…µ”°(€€€€€€€€€€€€€=1M¡•áÀ¹Ñ½Ñ…±}•áÁ•¹Í•Ì°€À¤èé1=PL•áÁ•¹Í•Í}Ñ½Ñ…°°(€€€€€€€€€€€€€=1M¡ÍÑ½¬¹Ñ½Ñ…±}ÍÑ½­}½ÍÐ°€À¤èé1=PLÍÑ½­}½ÍÑ}Ñ½Ñ…°°(€€€€€€€€€€€€€M]!8µÈ¹‘Õ•}‘…Ñ”%L9=P9U109µÈ¹ÍÑ…ÑÕÌ9=P%8€ IM=1Yœ°€Y1%Qœ°€1=Mœ°€911œ¤9µÈ¹‘Õ•}‘…Ñ”€ð9=\ ¤Q!8QIU1M1M9L¥Í}½Ù•É‘Õ”°(€€€€€€€€€€€€€M]!8µÈ¹É•Í½±Ù•‘}…Ð%L9=P9U10Q!8aQIP¡A= I=4€¡µÈ¹É•Í½±Ù•‘}…Ð€´µÈ¹É•Á½ÉÑ•‘}…Ð¤¤€¼€ÌØÀÀ1M9U109LÉ•Í½±ÕÑ¥½¹}¡½ÕÉÌ(€€€€€€I=4µ…¥¹Ñ•¹…¹•}É•ÅÕ•ÍÑÌµÈ(€€€€€€1P)=%8‰Õ¥±‘¥¹Ìˆ=8ˆ¹¥€ôµÈ¹‰Õ¥±‘¥¹}¥(€€€€€€1P)=%8Õ¹¥ÑÌÔ=8Ô¹¥€ôµÈ¹Õ¹¥Ñ}¥(€€€€€€1P)=%8•µÁ±½å••Ì”=8”¹¥€ôµÈ¹…ÍÍ¥¹•‘}•µÁ±½å••}¥(€€€€€€1P)=%8€ (€€€€€€€€M1Pµ…¥¹Ñ•¹…¹•}É•ÅÕ•ÍÑ}¥°MU4¡…µ½Õ¹Ð¤LÑ½Ñ…±}•áÁ•¹Í•Ì(€€€€€€€€I=4µ…¥¹Ñ•¹…¹•}•áÁ•¹Í•Ì(€€€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Ô9‘•±•Ñ•‘}…Ð%L9U109ÍÑ…ÑÕÌ€ðø€I)Qœ(€€€€€€€€I=U@	dµ…¥¹Ñ•¹…¹•}É•ÅÕ•ÍÑ}¥(€€€€€€€¤•áÀ=8•áÀ¹µ…¥¹Ñ•¹…¹•}É•ÅÕ•ÍÑ}¥€ôµÈ¹¥(€€€€€€1P)=%8€ (€€€€€€€€M1Pµ…¥¹Ñ•¹…¹•}É•ÅÕ•ÍÑ}¥°MU4¡ÅÕ…¹Ñ¥Ñä€¨Õ¹¥Ñ}ÁÉ¥”¤LÑ½Ñ…±}ÍÑ½­}½ÍÐ(€€€€€€€€I=4ÍÑ½­}µ½Ù•µ•¹ÑÌ(€€€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Ô9‘•±•Ñ•‘}…Ð%L9U109µ…¥¹Ñ•¹…¹•}É•ÅÕ•ÍÑ}¥%L9=P9U10(€€€€€€€€I=U@	dµ…¥¹Ñ•¹…¹•}É•ÅÕ•ÍÑ}¥(€€€€€€€¤ÍÑ½¬=8ÍÑ½¬¹µ…¥¹Ñ•¹…¹•}É•ÅÕ•ÍÑ}¥€ôµÈ¹¥(€€€€€€]!IµÈ¹½É…¹¥é…Ñ¥½¹}¥€ô€Ô9µÈ¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€9µÈ¹É•Á½ÉÑ•‘}…ÐèéQ	Q]8€ÄèéQ9€ÈèéQ(€€€€€€€€9€ Ìèé%9P%L9U10=HµÈ¹‰Õ¥±‘¥¹}¥€ô€Ì¤(€€€€€€€€9€ Ðèé%9P%L9U10=HµÈ¹…ÍÍ¥¹•‘}•µÁ±½å••}¥€ô€Ð¤(€€€€€€=IH	dµÈ¹É•Á½ÉÑ•‘}…ÐM€°(€€€€€mÍÑ…ÉÐ°•¹°™¥±Ñ•ÉÌ¹‰Õ¥±‘¥¹%€üü¹Õ±°°™¥±Ñ•ÉÌ¹•µÁ±½å••%€üü¹Õ±°°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€½¹ÍÐmÍÑ½­½¹ÍÕµ•°µ½¹Ñ¡±åáÁ•¹Í•Ít€ô…Ý…¥ÐAÉ½µ¥Í”¹…±°¡l(€€€€€Ñ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€€€M1PÍ¤¹½‘”°Í¤¹¹…µ”°MU4¡Í´¹ÅÕ…¹Ñ¥Ñä¤èé1=PLÅÕ…¹Ñ¥Ñä°(€€€€€€€€€€€€€€€MU4¡Í´¹ÅÕ…¹Ñ¥Ñä€¨Í´¹Õ¹¥Ñ}ÁÉ¥”¤èé1=PLÑ½Ñ…±}½ÍÐ(€€€€€€€€I=4ÍÑ½­}µ½Ù•µ•¹ÑÌÍ´(€€€€€€€€)=%8ÍÑ½­}¥Ñ•µÌÍ¤=8Í¤¹¥€ôÍ´¹ÍÑ½­}¥Ñ•µ}¥(€€€€€€€€)=%8µ…¥¹Ñ•¹…¹•}É•ÅÕ•ÍÑÌµÈ=8µÈ¹¥€ôÍ´¹µ…¥¹Ñ•¹…¹•}É•ÅÕ•ÍÑ}¥(€€€€€€€€]!IÍ´¹½É…¹¥é…Ñ¥½¹}¥€ô€Ì9Í´¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€€€9µÈ¹É•Á½ÉÑ•‘}…ÐèéQ	Q]8€ÄèéQ9€ÈèéQ(€€€€€€€€I=U@	dÍ¤¹¥°Í¤¹½‘”°Í¤¹¹…µ”(€€€€€€€€=IH	dÅÕ…¹Ñ¥ÑäM€°(€€€€€€€mÍÑ…ÉÐ°•¹°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€€€¤°(€€€€€Ñ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€€€M1PQ=}!H¡µ”¹•áÁ•¹Í•}‘…Ñ”°€eeedµ54œ¤Lµ½¹Ñ °MU4¡µ”¹…µ½Õ¹Ð¤èé1=PL…µ½Õ¹Ð(€€€€€€€€I=4µ…¥¹Ñ•¹…¹•}•áÁ•¹Í•Ìµ”(€€€€€€€€]!Iµ”¹½É…¹¥é…Ñ¥½¹}¥€ô€Ì9µ”¹‘•±•Ñ•‘}…Ð%L9U109µ”¹ÍÑ…ÑÕÌ€ðø€I)Qœ(€€€€€€€€€€9µ”¹•áÁ•¹Í•}‘…Ñ”	Q]8€ÄèéQ9€ÈèéQ(€€€€€€€€I=U@	dQ=}!H¡µ”¹•áÁ•¹Í•}‘…Ñ”°€eeedµ54œ¤(€€€€€€€€=IH	dµ½¹Ñ¡€°(€€€€€€€mÍÑ…ÉÐ°•¹°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€€€¤°(€€€t¤ì(€€€½¹ÍÐÍÕµµ…Éä€ôì(€€€€€½Á•¸èÉ½ÝÌ¹™¥±Ñ•È ¡É½Ü¤€ôø€…l1=Mœ°€911t¹¥¹±Õ‘•Ì¡É½Ü¹ÍÑ…ÑÕÌ¤¤¹±•¹Ñ °(€€€€€¥¹}ÁÉ½É•ÍÌèÉ½ÝÌ¹™¥±Ñ•È ¡É½Ü¤€ôølMM%9œ°€%9}AI=IMLœ°€=9}!=1t¹¥¹±Õ‘•Ì¡É½Ü¹ÍÑ…ÑÕÌ¤¤¹±•¹Ñ °(€€€€€É•Í½±Ù•èÉ½ÝÌ¹™¥±Ñ•È ¡É½Ü¤€ôølIM=1Yœ°€Y1%Qt¹¥¹±Õ‘•Ì¡É½Ü¹ÍÑ…ÑÕÌ¤¤¹±•¹Ñ °(€€€€€±½Í•èÉ½ÝÌ¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹ÍÑ…ÑÕÌ€ôôô€1=Mœ¤¹±•¹Ñ °(€€€€€ÕÉ•¹ÐèÉ½ÝÌ¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹ÁÉ¥½É¥Ñä€ôôô€UI9Pœ¤¹±•¹Ñ °(€€€€€½Ù•É‘Õ”èÉ½ÝÌ¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹¥Í}½Ù•É‘Õ”¤¹±•¹Ñ °(€€€€€½µÁ±•Ñ•èÉ½ÝÌ¹™¥±Ñ•È ¡É½Ü¤€ôølIM=1Yœ°€Y1%Qœ°€1=Mt¹¥¹±Õ‘•Ì¡É½Ü¹ÍÑ…ÑÕÌ¤¤¹±•¹Ñ °(€€€€€…Ù•É…•}É•Í½±ÕÑ¥½¹}¡½ÕÉÌèÉ½ÝÌ¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹É•Í½±ÕÑ¥½¹}¡½ÕÉÌ€„ôô¹Õ±°¤¹É•‘Õ” ¡ÍÕ´°É½Ü¤€ôøÍÕ´€¬9Õµ‰•È¡É½Ü¹É•Í½±ÕÑ¥½¹}¡½ÕÉÌ¤°€À¤€¼5…Ñ ¹µ…à¡É½ÝÌ¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹É•Í½±ÕÑ¥½¹}¡½ÕÉÌ€„ôô¹Õ±°¤¹±•¹Ñ °€Ä¤°(€€€€€Ñ½Ñ…±}½ÍÐèÉ½ÝÌ¹É•‘Õ” ¡ÍÕ´°É½Ü¤€ôøÍÕ´€¬9Õµ‰•È¡É½Ü¹•áÁ•¹Í•Í}Ñ½Ñ…°¤€¬9Õµ‰•È¡É½Ü¹ÍÑ½­}½ÍÑ}Ñ½Ñ…°¤°€À¤°(€€€€€É•Í½±ÕÑ¥½¹}É…Ñ”èÉ½ÝÌ¹±•¹Ñ €ü5…Ñ ¹É½Õ¹ ¡É½ÝÌ¹™¥±Ñ•È ¡É½Ü¤€ôølIM=1Yœ°€Y1%Qœ°€1=Mt¹¥¹±Õ‘•Ì¡É½Ü¹ÍÑ…ÑÕÌ¤¤¹±•¹Ñ €¼É½ÝÌ¹±•¹Ñ ¤€¨€ÄÀÀ¤€è€À°(€€€ôì(€€€É•ÑÕÉ¸ì(€€€€€É•ÅÕ•ÍÑÌèÉ½ÝÌ°(€€€€€‰å}‰Õ¥±‘¥¹œè=‰©•Ð¹Ù…±Õ•Ì¡É½ÝÌ¹É•‘Õ”ñI•½ÉñÍÑÉ¥¹œ°ì‰Õ¥±‘¥¹}¹…µ”èÍÑÉ¥¹œì½Õ¹Ðè¹Õµ‰•Èì½ÍÐè¹Õµ‰•Èôøø ¡…Œ°É½Ü¤€ôøì(€€€€€€€½¹ÍÐ­•ä€ôÉ½Ü¹‰Õ¥±‘¥¹}¹…µ”€üü€9½¸±§¤œì(€€€€€€€…m­•åt€üüôì‰Õ¥±‘¥¹}¹…µ”è­•ä°½Õ¹Ðè€À°½ÍÐè€Àôì(€€€€€€€…m­•åt¹½Õ¹Ð€¬ô€Äì(€€€€€€€…m­•åt¹½ÍÐ€¬ô9Õµ‰•È¡É½Ü¹•áÁ•¹Í•Í}Ñ½Ñ…°¤€¬9Õµ‰•È¡É½Ü¹ÍÑ½­}½ÍÑ}Ñ½Ñ…°¤ì(€€€€€€€É•ÑÕÉ¸…Œì(€€€€€ô°íô¤¤°(€€€€€‰å}Õ¹¥Ðè=‰©•Ð¹Ù…±Õ•Ì¡É½ÝÌ¹É•‘Õ”ñI•½ÉñÍÑÉ¥¹œ°ì‰Õ¥±‘¥¹}¹…µ”èÍÑÉ¥¹œìÕ¹¥Ñ}¹Õµ‰•ÈèÍÑÉ¥¹œì½Õ¹Ðè¹Õµ‰•Èì½ÍÐè¹Õµ‰•Èôøø ¡…Œ°É½Ü¤€ôøì(€€€€€€€½¹ÍÐ­•ä€ô€‘íÉ½Ü¹‰Õ¥±‘¥¹}¹…µ”€üü€9½¸±§¤ô€¼€‘íÉ½Ü¹Õ¹¥Ñ}¹Õµ‰•È€üü€M…¹ÌÕ¹¥Ó¤õ€ì(€€€€€€€…m­•åt€üüôì‰Õ¥±‘¥¹}¹…µ”èÉ½Ü¹‰Õ¥±‘¥¹}¹…µ”€üü€9½¸±§¤œ°Õ¹¥Ñ}¹Õµ‰•ÈèÉ½Ü¹Õ¹¥Ñ}¹Õµ‰•È€üü€M…¹ÌÕ¹¥Ó¤œ°½Õ¹Ðè€À°½ÍÐè€Àôì(€€€€€€€…m­•åt¹½Õ¹Ð€¬ô€Äì(€€€€€€€…m­•åt¹½ÍÐ€¬ô9Õµ‰•È¡É½Ü¹•áÁ•¹Í•Í}Ñ½Ñ…°¤€¬9Õµ‰•È¡É½Ü¹ÍÑ½­}½ÍÑ}Ñ½Ñ…°¤ì(€€€€€€€É•ÑÕÉ¸…Œì(€€€€€ô°íô¤¤°(€€€€€‰å}Ñ•¡¹¥¥…¸è=‰©•Ð¹Ù…±Õ•Ì¡É½ÝÌ¹É•‘Õ”ñI•½ÉñÍÑÉ¥¹œ°ìÑ•¡¹¥¥…¹}¹…µ”èÍÑÉ¥¹œì½Õ¹Ðè¹Õµ‰•Èì…Ù}¡½ÕÉÌè¹Õµ‰•Èôøø ¡…Œ°É½Ü¤€ôøì(€€€€€€€½¹ÍÐ­•ä€ôÉ½Ü¹Ñ•¡¹¥¥…¹}¹…µ”€üüÉ½Ü¹•áÑ•É¹…±}ÁÉ½Ù¥‘•È€üü€9½¸…™™•Ó¤œì(€€€€€€€…m­•åt€üüôìÑ•¡¹¥¥…¹}¹…µ”è­•ä°½Õ¹Ðè€À°…Ù}¡½ÕÉÌè€Àôì(€€€€€€€…m­•åt¹½Õ¹Ð€¬ô€Äì(€€€€€€€…m­•åt¹…Ù}¡½ÕÉÌ€¬ô9Õµ‰•È¡É½Ü¹É•Í½±ÕÑ¥½¹}¡½ÕÉÌ€üü€À¤ì(€€€€€€€É•ÑÕÉ¸…Œì(€€€€€ô°íô¤¤¹µ…À ¡É½Ü¤€ôø€¡ì(€€€€€€€€¸¸¹É½Ü°(€€€€€€€…Ù}¡½ÕÉÌèÉ½Ü¹½Õ¹Ð€üÉ½Ü¹…Ù}¡½ÕÉÌ€¼É½Ü¹½Õ¹Ð€è€À°(€€€€€€€Ñ½Ñ…±}½ÍÐèÉ½ÝÌ¹™¥±Ñ•È ¡ÕÉÉ•¹Ð¤€ôø€¡ÕÉÉ•¹Ð¹Ñ•¡¹¥¥…¹}¹…µ”€üüÕÉÉ•¹Ð¹•áÑ•É¹…±}ÁÉ½Ù¥‘•È€üü€9½¸…™™•Ó¤œ¤€ôôôÉ½Ü¹Ñ•¡¹¥¥…¹}¹…µ”¤¹É•‘Õ” ¡ÍÕ´°ÕÉÉ•¹Ð¤€ôøÍÕ´€¬9Õµ‰•È¡ÕÉÉ•¹Ð¹•áÁ•¹Í•Í}Ñ½Ñ…°¤€¬9Õµ‰•È¡ÕÉÉ•¹Ð¹ÍÑ½­}½ÍÑ}Ñ½Ñ…°¤°€À¤°(€€€€€ô¤¤°(€€€€€‰å}…Ñ•½Éäè=‰©•Ð¹Ù…±Õ•Ì¡É½ÝÌ¹É•‘Õ”ñI•½ÉñÍÑÉ¥¹œ°ì…Ñ•½ÉäèÍÑÉ¥¹œì½Õ¹Ðè¹Õµ‰•Èì½ÍÐè¹Õµ‰•Èôøø ¡…Œ°É½Ü¤€ôøì(€€€€€€€…mÉ½Ü¹…Ñ•½Éåt€üüôì…Ñ•½ÉäèÉ½Ü¹…Ñ•½Éä°½Õ¹Ðè€À°½ÍÐè€Àôì(€€€€€€€…mÉ½Ü¹…Ñ•½Éåt¹½Õ¹Ð€¬ô€Äì(€€€€€€€…mÉ½Ü¹…Ñ•½Éåt¹½ÍÐ€¬ô9Õµ‰•È¡É½Ü¹•áÁ•¹Í•Í}Ñ½Ñ…°¤€¬9Õµ‰•È¡É½Ü¹ÍÑ½­}½ÍÑ}Ñ½Ñ…°¤ì(€€€€€€€É•ÑÕÉ¸…Œì(€€€€€ô°íô¤¤°(€€€€€ÕÉ•¹Ñ}É•ÅÕ•ÍÑÌèÉ½ÝÌ¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹ÁÉ¥½É¥Ñä€ôôô€UI9Pœ¤°(€€€€€½Ù•É‘Õ•}É•ÅÕ•ÍÑÌèÉ½ÝÌ¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹¥Í}½Ù•É‘Õ”¤°(€€€€€ÍÑ½­}½¹ÍÕµ•èÍÑ½­½¹ÍÕµ•¹É½ÝÌ°(€€€€€µ½¹Ñ¡±å}•áÁ•¹Í•Ìèµ½¹Ñ¡±åáÁ•¹Í•Ì¹É½ÝÌ°(€€€€€É•Í½±ÕÑ¥½¹}Ñ¥µ•ÌèÉ½ÝÌ¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹É•Í½±ÕÑ¥½¹}¡½ÕÉÌ€„ôô¹Õ±°¤¹µ…À ¡É½Ü¤€ôø€¡ìÉ•ÅÕ•ÍÑ}¹Õµ‰•ÈèÉ½Ü¹É•ÅÕ•ÍÑ}¹Õµ‰•È°Ñ¥Ñ±”èÉ½Ü¹Ñ¥Ñ±”°Ñ•¡¹¥¥…¸èÉ½Ü¹Ñ•¡¹¥¥…¹}¹…µ”€üüÉ½Ü¹•áÑ•É¹…±}ÁÉ½Ù¥‘•È€üü€9½¸…™™•Ó¤œ°É•Í½±ÕÑ¥½¹}¡½ÕÉÌè9Õµ‰•È¡É½Ü¹É•Í½±ÕÑ¥½¹}¡½ÕÉÌ€üü€À¤ô¤¤°(€€€€€ÍÕµµ…Éä°(€€€ôì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÉ•…Ñ•MÑ½­5½Ù•µ•¹Ñ%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹ÐèA½½±±¥•¹Ð°‰½‘äèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø¤ì(€€€¥˜€¡‰½‘ä¹µ…¥¹Ñ•¹…¹•}É•ÅÕ•ÍÑ}¥¤ì(€€€€€…Ý…¥ÐÑ¡¥Ì¹…ÍÍ•ÉÑ5…¥¹Ñ•¹…¹•MÑ…ÑÕÌ¡±¥•¹Ð°9Õµ‰•È¡‰½‘ä¹µ…¥¹Ñ•¹…¹•}É•ÅÕ•ÍÑ}¥¤°l%9}AI=IMLt¤ì(€€€ô(€€€½¹ÍÐ¥Ñ•´€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P€¨I=4ÍÑ½­}¥Ñ•µÌ]!I¥€ô€Ä9½É…¹¥é…Ñ¥½¹}¥€ô€È9‘•±•Ñ•‘}…Ð%L9U10=HUAQ€°(€€€€€m‰½‘ä¹ÍÑ½­}¥Ñ•µ}¥°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€½¹ÍÐ¥Ñ•µI½Ü€ôÉ•ÅÕ¥É•I½Ü¡¥Ñ•´¹É½ÝÍlÁt°€MÑ½¬¥Ñ•´œ¤ì(€€€¥˜€¡¥Ñ•µI½Ü¹ÍÑ…ÑÕÌ€„ôô€Q%Yœ¤Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ ÉÑ¥±”ÍÑ½¬¥¹…Ñ¥˜œ¤ì(€€€½¹ÍÐÑåÁ”€ôMÑÉ¥¹œ¡‰½‘ä¹ÑåÁ”€üü€=UPœ¤ì(€€€½¹ÍÐÅÕ…¹Ñ¥Ñä€ô9Õµ‰•È¡‰½‘ä¹ÅÕ…¹Ñ¥Ñä€üü€À¤ì(€€€¥˜€¡ÅÕ…¹Ñ¥Ñä€ðô€À¤Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1„ÅÕ…¹Ñ¥Ó¤‘½¥Ðƒ©ÑÉ”Á½Í¥Ñ¥Ù”œ¤ì(€€€½¹ÍÐ‰•™½É”€ô9Õµ‰•È¡¥Ñ•µI½Ü¹ÕÉÉ•¹Ñ}ÅÕ…¹Ñ¥Ñä¤ì(€€€½¹ÍÐÍ¥¸€ôl%8œ°€%9Y9Q=Ie}%8œ°€%9Y9Q=Idt¹¥¹±Õ‘•Ì¡ÑåÁ”¤€ü€Ä€è€´Äì(€€€½¹ÍÐ…™Ñ•È€ô‰•™½É”€¬Í¥¸€¨ÅÕ…¹Ñ¥Ñäì(€€€¥˜€¡…™Ñ•È€ð€À¤Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ MÑ½¬¥¹ÍÕ™™¥Í…¹Ðœ¤ì(€€€½¹ÍÐÕ¹¥ÑAÉ¥”€ô9Õµ‰•È¡‰½‘ä¹Õ¹¥Ñ}ÁÉ¥”€üü‰½‘ä¹ÁÕÉ¡…Í•}ÁÉ¥”€üü¥Ñ•µI½Ü¹…Ù•É…•}ÁÕÉ¡…Í•}ÁÉ¥”€üü¥Ñ•µI½Ü¹ÁÕÉ¡…Í•}ÁÉ¥”€üü€À¤ì(€€€½¹ÍÐÍ•ÅÕ•¹•AÉ•™¥à€ôÍ¥¸€ø€À€ü€9Pœ€èÑåÁ”€ôôô€%9Y9Q=Ie}1=MLœ€ü€%9Xµ1=MLœ€è€M=Hœì(€€€½¹ÍÐµ½Ù•µ•¹Ñ9Õµ‰•È€ô‰½‘ä¹µ½Ù•µ•¹Ñ}¹Õµ‰•È€üü€‘íÍ•ÅÕ•¹•AÉ•™¥áô´‘í¹•Ü…Ñ” ¤¹•ÑÕ±±e•…È ¥ô´‘íMÑÉ¥¹œ¡…Ñ”¹¹½Ü ¤¤¹Í±¥” ´Ø¥õ€ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€%9MIP%9Q<ÍÑ½­}µ½Ù•µ•¹ÑÌ(€€€€€€€¡µ½Ù•µ•¹Ñ}¹Õµ‰•È°ÍÑ½­}¥Ñ•µ}¥°ÑåÁ”°ÅÕ…¹Ñ¥Ñä°µ½Ù•µ•¹Ñ}‘…Ñ”°Í½ÕÉ”°É•™•É•¹”°¹½Ñ•Ì°É•…Ñ•‘}‰ä°½É…¹¥é…Ñ¥½¹}¥°(€€€€€€€Õ¹¥Ñ}ÁÉ¥”°ÍÕÁÁ±¥•È°‘•ÍÑ¥¹…Ñ¥½¸°ÅÕ…¹Ñ¥Ñå}‰•™½É”°ÅÕ…¹Ñ¥Ñå}…™Ñ•È°µ…¥¹Ñ•¹…¹•}É•™•É•¹”°¥¹Ù•¹Ñ½Éå}½Õ¹Ñ}¥°(€€€€€€€µ…¥¹Ñ•¹…¹•}É•ÅÕ•ÍÑ}¥°ÍÑ½­}‘½Õµ•¹Ñ}¥°É•…Í½¸°…ÑÑ…¡µ•¹Ñ}™¥±•}¹…µ”°ÍÑ½­}ÁÕÉ¡…Í•}¥°ÍÑ½­}ÁÕÉ¡…Í•}É••¥ÁÑ}¥¤(€€€€€€Y1UL€ Ä°€È°€Ì°€Ð°€Ô°€Ø°€Ü°€à°€ä°€ÄÀ°€ÄÄ°€ÄÈ°€ÄÌ°€ÄÐ°€ÄÔ°€ÄØ°€ÄÜ°€Äà°€Ää°€ÈÀ°€ÈÄ°€ÈÈ°€ÈÌ¤(€€€€€€IQUI9%9€©€°(€€€€€l(€€€€€€€µ½Ù•µ•¹Ñ9Õµ‰•È°(€€€€€€€‰½‘ä¹ÍÑ½­}¥Ñ•µ}¥°(€€€€€€€ÑåÁ”°(€€€€€€€ÅÕ…¹Ñ¥Ñä°(€€€€€€€‰½‘ä¹µ½Ù•µ•¹Ñ}‘…Ñ”€üü¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤¹Í±¥” À°€ÄÀ¤°(€€€€€€€‰½‘ä¹Í½ÕÉ”€üü¹Õ±°°(€€€€€€€‰½‘ä¹É•™•É•¹”€üüµ½Ù•µ•¹Ñ9Õµ‰•È°(€€€€€€€‰½‘ä¹½µµ•¹Ð€üü‰½‘ä¹¹½Ñ•Ì€üü¹Õ±°°(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•É% ¤€üü‰½‘ä¹É•…Ñ•‘}‰ä€üü€Ä°(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°(€€€€€€€Õ¹¥ÑAÉ¥”°(€€€€€€€‰½‘ä¹ÍÕÁÁ±¥•È€üü¹Õ±°°(€€€€€€€‰½‘ä¹‘•ÍÑ¥¹…Ñ¥½¸€üü¹Õ±°°(€€€€€€€‰•™½É”°(€€€€€€€…™Ñ•È°(€€€€€€€‰½‘ä¹µ…¥¹Ñ•¹…¹•}É•™•É•¹”€üü¹Õ±°°(€€€€€€€‰½‘ä¹¥¹Ù•¹Ñ½Éå}½Õ¹Ñ}¥€üü¹Õ±°°(€€€€€€€‰½‘ä¹µ…¥¹Ñ•¹…¹•}É•ÅÕ•ÍÑ}¥€üü¹Õ±°°(€€€€€€€‰½‘ä¹ÍÑ½­}‘½Õµ•¹Ñ}¥€üü¹Õ±°°(€€€€€€€‰½‘ä¹É•…Í½¸€üü¹Õ±°°(€€€€€€€‰½‘ä¹…ÑÑ…¡µ•¹Ñ}™¥±•}¹…µ”€üü¹Õ±°°(€€€€€€€‰½‘ä¹ÍÑ½­}ÁÕÉ¡…Í•}¥€üü¹Õ±°°(€€€€€€€‰½‘ä¹ÍÑ½­}ÁÕÉ¡…Í•}É••¥ÁÑ}¥€üü¹Õ±°°(€€€€€t°(€€€€¤ì(€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€%9MIP%9Q<ÍÑ½­}µ½Ù•µ•¹Ñ}¡¥ÍÑ½Éä(€€€€€€€¡ÍÑ½­}µ½Ù•µ•¹Ñ}¥°…Ñ¥½¸°‘•ÍÉ¥ÁÑ¥½¸°Á•É™½Éµ•‘}‰ä°½É…¹¥é…Ñ¥½¹}¥¤(€€€€€€Y1UL€ Ä°€IQœ°€È°€Ì°€Ð¥€°(€€€€€mÉ½ÝÍlÁt¹¥°5½ÕÙ•µ•¹ÐË§¤‘•ÁÕ¥Ì€‘í‰½‘ä¹É•™•É•¹”€üüµ½Ù•µ•¹Ñ9Õµ‰•Éõ€°Ñ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•É% ¤€üü€Ä°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€½¹ÍÐ…Ù•É…•AÉ¥”€ô(€€€€€Í¥¸€ø€À€˜˜Õ¹¥ÑAÉ¥”€ø€À€˜˜…™Ñ•È€ø€À(€€€€€€€€ü€ ¡‰•™½É”€¨9Õµ‰•È¡¥Ñ•µI½Ü¹…Ù•É…•}ÁÕÉ¡…Í•}ÁÉ¥”€üü¥Ñ•µI½Ü¹ÁÕÉ¡…Í•}ÁÉ¥”€üü€À¤¤€¬€¡ÅÕ…¹Ñ¥Ñä€¨Õ¹¥ÑAÉ¥”¤¤€¼…™Ñ•È(€€€€€€€€è9Õµ‰•È¡¥Ñ•µI½Ü¹…Ù•É…•}ÁÕÉ¡…Í•}ÁÉ¥”€üü¥Ñ•µI½Ü¹ÁÕÉ¡…Í•}ÁÉ¥”€üü€À¤ì(€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€UAQÍÑ½­}¥Ñ•µÌ(€€€€€€MPÕÉÉ•¹Ñ}ÅÕ…¹Ñ¥Ñä€ô€È°(€€€€€€€€€€…Ù•É…•}ÁÕÉ¡…Í•}ÁÉ¥”€ô€Ì°(€€€€€€€€€€ÁÕÉ¡…Í•}ÁÉ¥”€ôM]!8€Ðèé9U5I%€ø€ÀQ!8€Ð1MÁÕÉ¡…Í•}ÁÉ¥”9°(€€€€€€€€€€ÕÁ‘…Ñ•‘}…Ð€ô9=\ ¤(€€€€€€]!I¥€ô€Ä9½É…¹¥é…Ñ¥½¹}¥€ô€Õ€°(€€€€€m‰½‘ä¹ÍÑ½­}¥Ñ•µ}¥°…™Ñ•È°…Ù•É…•AÉ¥”°Õ¹¥ÑAÉ¥”°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€…Ý…¥ÐÑ¡¥Ì¹Íå¹MÑ½­±•ÉÑÌ¡±¥•¹Ð°¥Ñ•µI½Ü°…™Ñ•È¤ì(€€€É•ÑÕÉ¸É½ÝÍlÁtì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÍå¹MÑ½­±•ÉÑÌ¡±¥•¹ÐèA½½±±¥•¹Ð°¥Ñ•´èI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø°ÅÕ…¹Ñ¥Ñäè¹Õµ‰•È¤ì(€€€½¹ÍÐ½É…¹¥é…Ñ¥½¹%€ôÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤ì(€€€½¹ÍÐµ¥¹¥µÕ´€ô9Õµ‰•È¡¥Ñ•´¹µ¥¹¥µÕµ}ÅÕ…¹Ñ¥Ñä€üü€À¤ì(€€€½¹ÍÐ±•Ù•°€ôÅÕ…¹Ñ¥Ñä€ðô€À€ü€=UQ}=}MQ=,œ€èÅÕ…¹Ñ¥Ñä€ðôµ¥¹¥µÕ´€ü€1=]}MQ=,œ€è¹Õ±°ì(€€€¥˜€ …±•Ù•°¤ì(€€€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€UAQÍÑ½­}…±•ÉÑÌMPÉ•Í½±Ù•‘}…Ð€ô9=\ ¤(€€€€€€€€]!IÍÑ½­}¥Ñ•µ}¥€ô€Ä9½É…¹¥é…Ñ¥½¹}¥€ô€È9É•Í½±Ù•‘}…Ð%L9U109‘•±•Ñ•‘}…Ð%L9U11€°(€€€€€€€m¥Ñ•´¹¥°½É…¹¥é…Ñ¥½¹%‘t°(€€€€€€¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô(€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€UAQÍÑ½­}…±•ÉÑÌMPÉ•Í½±Ù•‘}…Ð€ô9=\ ¤(€€€€€€]!IÍÑ½­}¥Ñ•µ}¥€ô€Ä9½É…¹¥é…Ñ¥½¹}¥€ô€È9±•Ù•°€ðø€Ì(€€€€€€€€9É•Í½±Ù•‘}…Ð%L9U109‘•±•Ñ•‘}…Ð%L9U11€°(€€€€€m¥Ñ•´¹¥°½É…¹¥é…Ñ¥½¹%°±•Ù•±t°(€€€€¤ì(€€€½¹ÍÐµ•ÍÍ…”€ô±•Ù•°€ôôô€=UQ}=}MQ=,œ(€€€€€€ü0…ÉÑ¥±”€‘í¥Ñ•´¹¹…µ•ô•ÍÐ•¸ÉÕÁÑÕÉ”‘”ÍÑ½¬¹€(€€€€€€è0…ÉÑ¥±”€‘í¥Ñ•´¹¹…µ•ô•ÍÐÍ½ÕÌ±”Í•Õ¥°‘”Ï¥ÕÉ¥Ó¤¸MÑ½¬…ÑÕ•°€è€‘íÅÕ…¹Ñ¥Ñåô€‘í¥Ñ•´¹Õ¹¥Ñô¸M•Õ¥°€è€‘íµ¥¹¥µÕµô¹€ì(€€€½¹ÍÐÉ•ÍÁ½¹Í¥‰±”€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P¥°•µ…¥°I=4…ÁÁ}ÕÍ•ÉÌ(€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Ä9‘•±•Ñ•‘}…Ð%L9U109ÍÑ…ÑÕÌ€ô€Q%Yœ(€€€€€€€€9É½±”%8€ 5%8œ°€=U9Q9Pœ¤(€€€€€€=IH	dM]!8É½±”€ô€5%8œQ!8€À1M€Ä9°¥1%5%P€Å€°(€€€€€m½É…¹¥é…Ñ¥½¹%‘t°(€€€€¤ì(€€€½¹ÍÐÉ•¥Á¥•¹Ð€ôÉ•ÍÁ½¹Í¥‰±”¹É½ÝÍlÁtü¹•µ…¥°€üü€I•ÍÁ½¹Í…‰±”ÍÑ½¬œì(€€€½¹ÍÐÉ•…Ñ•€ômtì(€€€™½È€¡½¹ÍÐ¡…¹¹•°½˜l%9QI90œ°€5%0œ°€]!QMA@t¤ì(€€€€€½¹ÍÐ¥¹Í•ÉÑ•€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€%9MIP%9Q<ÍÑ½­}…±•ÉÑÌ(€€€€€€€€€¡ÍÑ½­}¥Ñ•µ}¥°±•Ù•°°ÅÕ…¹Ñ¥Ñä°µ¥¹¥µÕµ}ÅÕ…¹Ñ¥Ñä°¡…¹¹•°°É•¥Á¥•¹Ð°µ•ÍÍ…”°ÍÑ…ÑÕÌ°É•…Ñ•‘}‰ä°½É…¹¥é…Ñ¥½¹}¥¤(€€€€€€€€Y1UL€ Ä°€È°€Ì°€Ð°€Ô°€Ø°€Ü°€M%5U1Qœ°€à°€ä¤(€€€€€€€€=8=91%P<9=Q!%9IQUI9%9¥‘€°(€€€€€€€m¥Ñ•´¹¥°±•Ù•°°ÅÕ…¹Ñ¥Ñä°µ¥¹¥µÕ´°¡…¹¹•°°¡…¹¹•°€ôôô€%9QI90œ€ü¹Õ±°€èÉ•¥Á¥•¹Ð°µ•ÍÍ…”°(€€€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•É% ¤€üü€Ä°½É…¹¥é…Ñ¥½¹%‘t°(€€€€€€¤ì(€€€€€¥˜€¡¥¹Í•ÉÑ•¹É½ÝÍlÁt¤É•…Ñ•¹ÁÕÍ ¡¡…¹¹•°¤ì(€€€ô(€€€¥˜€¡É•…Ñ•¹¥¹±Õ‘•Ì %9QI90œ¤¤ì(€€€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€%9MIP%9Q<¹½Ñ¥™¥…Ñ¥½¹Ì(€€€€€€€€€¡ÕÍ•É}¥°Ñ¥Ñ±”°µ•ÍÍ…”°ÁÉ¥½É¥Ñä°Í½ÕÉ”°É•±…Ñ•‘}•¹Ñ¥Ñå}ÑåÁ”°É•±…Ñ•‘}•¹Ñ¥Ñå}¥°(€€€€€€€€€±¥¹­}Á…Ñ °É•…Ñ•‘}‰ä°½É…¹¥é…Ñ¥½¹}¥¤(€€€€€€€€M1P…Ô¹¥°€Ä°€È°€Ì°€MQ=,œ°€MQ=-}%Q4œ°€Ð°€Ô°€Ø°€Ü(€€€€€€€€I=4…ÁÁ}ÕÍ•ÉÌ…Ô(€€€€€€€€]!I…Ô¹½É…¹¥é…Ñ¥½¹}¥€ô€Ü9…Ô¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€€€9…Ô¹É½±”%8€ 5%8œ°€=U9Q9Pœ¤(€€€€€€€€1%5%P€Õ€°(€€€€€€€m±•Ù•°€ôôô€=UQ}=}MQ=,œ€ü€IÕÁÑÕÉ”‘”ÍÑ½¬œ€è€MÑ½¬Í½ÕÌÍ•Õ¥°œ°µ•ÍÍ…”°(€€€€€€€€€±•Ù•°€ôôô€=UQ}=}MQ=,œ€ü€I%Q%0œ€è€!% œ°¥Ñ•´¹¥°€½ÍÑ½¬¼‘í¥Ñ•´¹¥‘õ€°(€€€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•É% ¤€üü€Ä°½É…¹¥é…Ñ¥½¹%‘t°(€€€€€€¤ì(€€€ô(€€€¥˜€¡É•…Ñ•¹¥¹±Õ‘•Ì 5%0œ¤¤ì(€€€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€%9MIP%9Q<•µ…¥±}±½Ì(€€€€€€€€€¡É•¥Á¥•¹Ð°ÍÕ‰©•Ð°µ•ÍÍ…”°ÍÑ…ÑÕÌ°É•±…Ñ•‘}•¹Ñ¥Ñå}ÑåÁ”°É•±…Ñ•‘}•¹Ñ¥Ñå}¥°Í•¹Ñ}…Ð°É•…Ñ•‘}‰ä°½É…¹¥é…Ñ¥½¹}¥¤(€€€€€€€€Y1UL€ Ä°€È°€Ì°€M%5U1Qœ°€MQ=-}%Q4œ°€Ð°9=\ ¤°€Ô°€Ø¥€°(€€€€€€€mÉ•¥Á¥•¹Ð°±•Ù•°€ôôô€=UQ}=}MQ=,œ€ü€IÕÁÑÕÉ”‘”ÍÑ½¬œ€è€MÑ½¬Í½ÕÌÍ•Õ¥°œ°µ•ÍÍ…”°(€€€€€€€€€¥Ñ•´¹¥°Ñ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•É% ¤€üü€Ä°½É…¹¥é…Ñ¥½¹%‘t°(€€€€€€¤ì(€€€ô(€€€¥˜€¡É•…Ñ•¹¥¹±Õ‘•Ì ]!QMA@œ¤¤ì(€€€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€%9MIP%9Q<Ý¡…ÑÍ…ÁÁ}±½Ì(€€€€€€€€€¡É•¥Á¥•¹Ð°µ•ÍÍ…”°ÍÑ…ÑÕÌ°É•±…Ñ•‘}•¹Ñ¥Ñå}ÑåÁ”°É•±…Ñ•‘}•¹Ñ¥Ñå}¥°Í•¹Ñ}…Ð°É•…Ñ•‘}‰ä°½É…¹¥é…Ñ¥½¹}¥¤(€€€€€€€€Y1UL€ Ä°€È°€M%5U1Qœ°€MQ=-}%Q4œ°€Ì°9=\ ¤°€Ð°€Ô¥€°(€€€€€€€mÉ•¥Á¥•¹Ð°µ•ÍÍ…”°¥Ñ•´¹¥°Ñ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•É% ¤€üü€Ä°½É…¹¥é…Ñ¥½¹%‘t°(€€€€€€¤ì(€€€ô(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÉ•…Ñ•5…¥¹Ñ•¹…¹•ÍÍ¥¹µ•¹Ñ½µµÕ¹¥…Ñ¥½¹Ì¡±¥•¹ÐèA½½±±¥•¹Ð°É•ÅÕ•ÍÐèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø°‰½‘äèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø¤ì(€€€¥˜€ …‰½‘ä¹•µÁ±½å••}¥¤É•ÑÕÉ¸ì(€€€½¹ÍÐ½¹Ñ…Ð€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P”¹•µ…¥°°”¹Á¡½¹”°ˆ¹¹…µ”L‰Õ¥±‘¥¹}¹…µ”°Ô¹¹Õµ‰•ÈLÕ¹¥Ñ}¹Õµ‰•È°(€€€€€€€€€€€€€=9P¡Ð¹™¥ÉÍÑ}¹…µ”°€œ€œ°Ð¹±…ÍÑ}¹…µ”¤LÑ•¹…¹Ñ}¹…µ”(€€€€€€I=4•µÁ±½å••Ì”(€€€€€€1P)=%8µ…¥¹Ñ•¹…¹•}É•ÅÕ•ÍÑÌµÈ=8µÈ¹¥€ô€Ä9µÈ¹½É…¹¥é…Ñ¥½¹}¥€ô€Ì(€€€€€€1P)=%8‰Õ¥±‘¥¹Ìˆ=8ˆ¹¥€ôµÈ¹‰Õ¥±‘¥¹}¥(€€€€€€1P)=%8Õ¹¥ÑÌÔ=8Ô¹¥€ôµÈ¹Õ¹¥Ñ}¥(€€€€€€1P)=%8Ñ•¹…¹ÑÌÐ=8Ð¹¥€ôµÈ¹Ñ•¹…¹Ñ}¥(€€€€€€]!I”¹¥€ô€È9”¹½É…¹¥é…Ñ¥½¹}¥€ô€Ì9”¹‘•±•Ñ•‘}…Ð%L9U11€°(€€€€€mÉ•ÅÕ•ÍÐ¹¥°‰½‘ä¹•µÁ±½å••}¥°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€½¹ÍÐÑ•¡¹¥¥…¸€ô½¹Ñ…Ð¹É½ÝÍlÁtì(€€€¥˜€ …Ñ•¡¹¥¥…¸¤É•ÑÕÉ¸ì(€€€½¹ÍÐµ•ÍÍ…”€ôl(€€€€€€‘íÉ•ÅÕ•ÍÐ¹É•ÅÕ•ÍÑ}¹Õµ‰•Éô€´€‘íÉ•ÅÕ•ÍÐ¹Ñ¥Ñ±•õ€°(€€€€€Ñ•¡¹¥¥…¸¹‰Õ¥±‘¥¹}¹…µ”€ü%µµ•Õ‰±”è€‘íÑ•¡¹¥¥…¸¹‰Õ¥±‘¥¹}¹…µ•õ€€è¹Õ±°°(€€€€€Ñ•¡¹¥¥…¸¹Õ¹¥Ñ}¹Õµ‰•È€üU¹¥Ó¤è€‘íÑ•¡¹¥¥…¸¹Õ¹¥Ñ}¹Õµ‰•Éõ€€è¹Õ±°°(€€€€€Ñ•¡¹¥¥…¸¹Ñ•¹…¹Ñ}¹…µ”€ü1½…Ñ…¥É”è€‘íÑ•¡¹¥¥…¸¹Ñ•¹…¹Ñ}¹…µ•õ€€è¹Õ±°°(€€€€€AÉ¥½É¥Ó¤è€‘íÉ•ÅÕ•ÍÐ¹ÁÉ¥½É¥Ñåõ€°(€€€€€‰½‘ä¹Á±…¹¹•‘}‘…Ñ”€üAË¥ÙÕ”è€‘í‰½‘ä¹Á±…¹¹•‘}‘…Ñ•ô€‘í‰½‘ä¹Á±…¹¹•‘}Ñ¥µ”€üü€œõ€€è¹Õ±°°(€€€€€‰½‘ä¹¹½Ñ•Ì€ü½µµ•¹Ñ…¥É”è€‘í‰½‘ä¹¹½Ñ•Íõ€€è¹Õ±°°(€€€t¹™¥±Ñ•È¡	½½±•…¸¤¹©½¥¸ q¸œ¤ì(€€€½¹ÍÐ½É…¹¥é…Ñ¥½¹%€ôÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤ì(€€€½¹ÍÐÉ•…Ñ•‘	ä€ôÑ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•É% ¤€üü€Äì(€€€¥˜€¡Ñ•¡¹¥¥…¸¹•µ…¥°¤ì(€€€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€%9MIP%9Q<¹½Ñ¥™¥…Ñ¥½¹Ì(€€€€€€€€€¡ÕÍ•É}¥°Ñ¥Ñ±”°µ•ÍÍ…”°ÁÉ¥½É¥Ñä°Í½ÕÉ”°É•±…Ñ•‘}•¹Ñ¥Ñå}ÑåÁ”°É•±…Ñ•‘}•¹Ñ¥Ñå}¥°±¥¹­}Á…Ñ °É•…Ñ•‘}‰ä°½É…¹¥é…Ñ¥½¹}¥¤(€€€€€€€€Y1UL€ (€€€€€€€€€€€¡M1P…Ô¹¥I=4…ÁÁ}ÕÍ•ÉÌ…Ô]!I…Ô¹½É…¹¥é…Ñ¥½¹}¥€ô€Ü9…Ô¹‘•±•Ñ•‘}…Ð%L9U1091=]H¡…Ô¹•µ…¥°¤€ô1=]H à¤1%5%P€Ä¤°(€€€€€€€€€€€È°€Ì°€Ð°€5%9Q99œ°€µ…¥¹Ñ•¹…¹•}É•ÅÕ•ÍÐœ°€Ä°€Ô°€Ø°€Ü(€€€€€€€€€¥€°(€€€€€€€mÉ•ÅÕ•ÍÐ¹¥°™™•Ñ…Ñ¥½¸€‘íÉ•ÅÕ•ÍÐ¹É•ÅÕ•ÍÑ}¹Õµ‰•Éõ€°µ•ÍÍ…”°É•ÅÕ•ÍÐ¹ÁÉ¥½É¥Ñä€ôôô€UI9Pœ€ü€I%Q%0œ€è€9=I50œ°€½µ…¥¹Ñ•¹…¹”¼‘íÉ•ÅÕ•ÍÐ¹¥‘õ€°É•…Ñ•‘	ä°½É…¹¥é…Ñ¥½¹%°Ñ•¡¹¥¥…¸¹•µ…¥±t°(€€€€€€¤ì(€€€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€%9MIP%9Q<•µ…¥±}±½Ì(€€€€€€€€€¡É•¥Á¥•¹Ð°ÍÕ‰©•Ð°µ•ÍÍ…”°ÍÑ…ÑÕÌ°ÁÉ½Ù¥‘•É}É•ÍÁ½¹Í”°É•±…Ñ•‘}•¹Ñ¥Ñå}ÑåÁ”°É•±…Ñ•‘}•¹Ñ¥Ñå}¥°Í•¹Ñ}…Ð°É•…Ñ•‘}‰ä°½É…¹¥é…Ñ¥½¹}¥¤(€€€€€€€€Y1UL€ Ä°€È°€Ì°€M%5U1Qœ°€Ð°€µ…¥¹Ñ•¹…¹•}É•ÅÕ•ÍÐœ°€Ô°9=\ ¤°€Ø°€Ü¥€°(€€€€€€€mÑ•¡¹¥¥…¸¹•µ…¥°°™™•Ñ…Ñ¥½¸€‘íÉ•ÅÕ•ÍÐ¹É•ÅÕ•ÍÑ}¹Õµ‰•Éõ€°µ•ÍÍ…”°)M=8¹ÍÑÉ¥¹¥™ä¡ìÁÉ½Ù¥‘•Èè€1=1}M%5U1Q=Hœô¤°É•ÅÕ•ÍÐ¹¥°É•…Ñ•‘	ä°½É…¹¥é…Ñ¥½¹%‘t°(€€€€€€¤ì(€€€ô(€€€¥˜€¡Ñ•¡¹¥¥…¸¹Á¡½¹”¤ì(€€€€€™½È€¡½¹ÍÐÑ…‰±”½˜lÍµÍ}±½Ìœ°€Ý¡…ÑÍ…ÁÁ}±½Ìt¤ì(€€€€€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€€€%9MIP%9Q<€‘íÑ…‰±•ô(€€€€€€€€€€€¡É•¥Á¥•¹Ð°µ•ÍÍ…”°ÍÑ…ÑÕÌ°ÁÉ½Ù¥‘•É}É•ÍÁ½¹Í”°É•±…Ñ•‘}•¹Ñ¥Ñå}ÑåÁ”°É•±…Ñ•‘}•¹Ñ¥Ñå}¥°Í•¹Ñ}…Ð°É•…Ñ•‘}‰ä°½É…¹¥é…Ñ¥½¹}¥¤(€€€€€€€€€€Y1UL€ Ä°€È°€M%5U1Qœ°€Ì°€µ…¥¹Ñ•¹…¹•}É•ÅÕ•ÍÐœ°€Ð°9=\ ¤°€Ô°€Ø¥€°(€€€€€€€€€mÑ•¡¹¥¥…¸¹Á¡½¹”°µ•ÍÍ…”°)M=8¹ÍÑÉ¥¹¥™ä¡ìÁÉ½Ù¥‘•Èè€1=1}M%5U1Q=Hœô¤°É•ÅÕ•ÍÐ¹¥°É•…Ñ•‘	ä°½É…¹¥é…Ñ¥½¹%‘t°(€€€€€€€€¤ì(€€€€€ô(€€€ô(€ô((€…Íå¹ŒÍ•¹‘5…¥¹Ñ•¹…¹•½µµÕ¹¥…Ñ¥½¸¡¥è¹Õµ‰•È°¡…¹¹•°èÍÑÉ¥¹œ°‰½‘äèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø¤ì(€€€É•ÑÕÉ¸Ñ¡¥Ì¹‘ˆ¹ÑÉ…¹Í…Ñ¥½¸¡…Íå¹Œ€¡±¥•¹Ð¤€ôøì(€€€€€½¹ÍÐÉ•ÅÕ•ÍÐ€ô…Ý…¥ÐÑ¡¥Ì¹•Ñ5…¥¹Ñ•¹…¹•½µµÕ¹¥…Ñ¥½¹½¹Ñ•áÐ¡±¥•¹Ð°¥¤ì(€€€€€½¹ÍÐ½µµÕ¹¥…Ñ¥½¹¡…¹¹•°€ôMÑÉ¥¹œ¡¡…¹¹•°€üü€œœ¤¹Ñ½UÁÁ•É…Í” ¤ì(€€€€€½¹ÍÐÑ…É•Ð€ôMÑÉ¥¹œ¡‰½‘ä¹Ñ…É•Ð€üü€Q99Pœ¤¹Ñ½UÁÁ•É…Í” ¤ì(€€€€€¥˜€ …l5%0œ°€M5Lœ°€]!QMA@t¹¥¹±Õ‘•Ì¡½µµÕ¹¥…Ñ¥½¹¡…¹¹•°¤¤Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ …¹…°‘”½µµÕ¹¥…Ñ¥½¸¥¹Ù…±¥‘”œ¤ì(€€€€€½¹ÍÐÉ•¥Á¥•¹Ð€ô(€€€€€€€Ñ…É•Ð€ôôô€Q!9%%8œ(€€€€€€€€€€ü½µµÕ¹¥…Ñ¥½¹¡…¹¹•°€ôôô€5%0œ(€€€€€€€€€€€€üÉ•ÅÕ•ÍÐ¹Ñ•¡¹¥¥…¹}•µ…¥°(€€€€€€€€€€€€èÉ•ÅÕ•ÍÐ¹Ñ•¡¹¥¥…¹}Á¡½¹”(€€€€€€€€€€è½µµÕ¹¥…Ñ¥½¹¡…¹¹•°€ôôô€5%0œ(€€€€€€€€€€€€üÉ•ÅÕ•ÍÐ¹Ñ•¹…¹Ñ}•µ…¥°(€€€€€€€€€€€€èÉ•ÅÕ•ÍÐ¹Ñ•¹…¹Ñ}Á¡½¹”ì(€€€€€¥˜€ …É•¥Á¥•¹Ð¤Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸¡Ñ…É•Ð€ôôô€Q!9%%8œ€ü€½½É‘½¹»¥”Ñ•¡¹¥¥•¸…‰Í•¹Ñ”œ€è€½½É‘½¹»¥”±½…Ñ…¥É”…‰Í•¹Ñ”œ¤ì(€€€€€½¹ÍÐµ•ÍÍ…”€ô‰½‘ä¹µ•ÍÍ…”€üMÑÉ¥¹œ¡‰½‘ä¹µ•ÍÍ…”¤€èÑ¡¥Ì¹‘•™…Õ±Ñ5…¥¹Ñ•¹…¹•5•ÍÍ…”¡½µµÕ¹¥…Ñ¥½¹¡…¹¹•°°É•ÅÕ•ÍÐ°MÑÉ¥¹œ¡‰½‘ä¹•Ù•¹Ð€üü€UAQœ¤¤ì(€€€€€½¹ÍÐÉ•ÍÕ±Ð€ô…Ý…¥ÐÑ¡¥Ì¹Í•¹‘½µµÕ¹¥…Ñ¥½¸¡½µµÕ¹¥…Ñ¥½¹¡…¹¹•°°ì(€€€€€€€É•¥Á¥•¹Ð°(€€€€€€€ÍÕ‰©•Ðè½µµÕ¹¥…Ñ¥½¹¡…¹¹•°€ôôô€5%0œ€ü€‘íÉ•ÅÕ•ÍÐ¹É•ÅÕ•ÍÑ}¹Õµ‰•Éô€´€‘íÉ•ÅÕ•ÍÐ¹Ñ¥Ñ±•õ€€èÕ¹‘•™¥¹•°(€€€€€€€µ•ÍÍ…”°(€€€€€€€É•±…Ñ•‘}•¹Ñ¥Ñå}ÑåÁ”è€µ…¥¹Ñ•¹…¹•}É•ÅÕ•ÍÐœ°(€€€€€€€É•±…Ñ•‘}•¹Ñ¥Ñå}¥è¥°(€€€€€ô¤ì(€€€€€…Ý…¥ÐÑ¡¥Ì¹…‘‘5…¥¹Ñ•¹…¹•Q¥µ•±¥¹”¡±¥•¹Ð°¥°€=55U9%Q%=8œ°½µµÕ¹¥…Ñ¥½¸€‘í½µµÕ¹¥…Ñ¥½¹¡…¹¹•±õ€°€‘íÑ…É•Ð€ôôô€Q!9%%8œ€ü€Q•¡¹¥¥•¸œ€è€1½…Ñ…¥É”ô½¹Ñ…Ó¥€¤ì(€€€€€É•ÑÕÉ¸É•ÍÕ±Ðì(€€€ô¤ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ…ÍÍ•ÉÑ5…¥¹Ñ•¹…¹•MÑ…ÑÕÌ¡±¥•¹ÐèA½½±±¥•¹Ð°¥è¹Õµ‰•È°…±±½Ý•èÍÑÉ¥¹mt¤ì(€€€½¹ÍÐÕÉÉ•¹Ð€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1PÍÑ…ÑÕÌI=4µ…¥¹Ñ•¹…¹•}É•ÅÕ•ÍÑÌ(€€€€€€]!I¥€ô€Ä9½É…¹¥é…Ñ¥½¹}¥€ô€È9‘•±•Ñ•‘}…Ð%L9U10=HUAQ€°(€€€€€m¥°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€½¹ÍÐÉ•ÅÕ•ÍÐ€ôÉ•ÅÕ¥É•I½Ü¡ÕÉÉ•¹Ð¹É½ÝÍlÁt°€5…¥¹Ñ•¹…¹”É•ÅÕ•ÍÐœ¤ì(€€€¥˜€ ……±±½Ý•¹¥¹±Õ‘•Ì¡MÑÉ¥¹œ¡É•ÅÕ•ÍÐ¹ÍÑ…ÑÕÌ¤¤¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸¡Ñ¥½¸¥µÁ½ÍÍ¥‰±”Á½ÕÈÕ¹”µ…¥¹Ñ•¹…¹”…ÔÍÑ…ÑÕÐ€‘íÉ•ÅÕ•ÍÐ¹ÍÑ…ÑÕÍõ€¤ì(€€€ô(€€€É•ÑÕÉ¸É•ÅÕ•ÍÐì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ¹½Ñ¥™å5…¥¹Ñ•¹…¹•I•Í½±ÕÑ¥½¸¡±¥•¹ÐèA½½±±¥•¹Ð°¥è¹Õµ‰•È°•Ù•¹Ðè€IM=1Yœð€1=Mœ°½µµ•¹ÐüèÍÑÉ¥¹œ¤ì(€€€½¹ÍÐÉ•ÅÕ•ÍÐ€ô…Ý…¥ÐÑ¡¥Ì¹•Ñ5…¥¹Ñ•¹…¹•½µµÕ¹¥…Ñ¥½¹½¹Ñ•áÐ¡±¥•¹Ð°¥¤ì(€€€½¹ÍÐ©½‰ÌèÉÉ…äñAÉ½µ¥Í”ñÕ¹­¹½Ý¸øø€ômtì(€€€¥˜€¡É•ÅÕ•ÍÐ¹Ñ•¹…¹Ñ}•µ…¥°¤ì(€€€€€©½‰Ì¹ÁÕÍ ¡Ñ¡¥Ì¹Í•¹‘½µµÕ¹¥…Ñ¥½¸ 5%0œ°ì(€€€€€€€É•¥Á¥•¹ÐèÉ•ÅÕ•ÍÐ¹Ñ•¹…¹Ñ}•µ…¥°°(€€€€€€€ÍÕ‰©•Ðè€‘íÉ•ÅÕ•ÍÐ¹É•ÅÕ•ÍÑ}¹Õµ‰•Éô€´€‘í•Ù•¹Ð€ôôô€IM=1Yœ€ü€%¹Ñ•ÉÙ•¹Ñ¥½¸É•Í½±Õ”œ€è€%¹Ñ•ÉÙ•¹Ñ¥½¸±½ÑÕÉ•”õ€°(€€€€€€€µ•ÍÍ…”èÑ¡¥Ì¹‘•™…Õ±Ñ5…¥¹Ñ•¹…¹•5•ÍÍ…” 5%0œ°É•ÅÕ•ÍÐ°•Ù•¹Ð°½µµ•¹Ð¤°(€€€€€€€É•±…Ñ•‘}•¹Ñ¥Ñå}ÑåÁ”è€µ…¥¹Ñ•¹…¹•}É•ÅÕ•ÍÐœ°(€€€€€€€É•±…Ñ•‘}•¹Ñ¥Ñå}¥è¥°(€€€€€ô¤¤ì(€€€ô(€€€¥˜€¡É•ÅÕ•ÍÐ¹Ñ•¹…¹Ñ}Á¡½¹”¤ì(€€€€€™½È€¡½¹ÍÐ¡…¹¹•°½˜lM5Lœ°€]!QMA@t¤ì(€€€€€€€©½‰Ì¹ÁÕÍ ¡Ñ¡¥Ì¹Í•¹‘½µµÕ¹¥…Ñ¥½¸¡¡…¹¹•°°ì(€€€€€€€€€É•¥Á¥•¹ÐèÉ•ÅÕ•ÍÐ¹Ñ•¹…¹Ñ}Á¡½¹”°(€€€€€€€€€µ•ÍÍ…”èÑ¡¥Ì¹‘•™…Õ±Ñ5…¥¹Ñ•¹…¹•5•ÍÍ…”¡¡…¹¹•°°É•ÅÕ•ÍÐ°•Ù•¹Ð°½µµ•¹Ð¤°(€€€€€€€€€É•±…Ñ•‘}•¹Ñ¥Ñå}ÑåÁ”è€µ…¥¹Ñ•¹…¹•}É•ÅÕ•ÍÐœ°(€€€€€€€€€É•±…Ñ•‘}•¹Ñ¥Ñå}¥è¥°(€€€€€€€ô¤¤ì(€€€€€ô(€€€ô(€€€…Ý…¥ÐAÉ½µ¥Í”¹…±°¡©½‰Ì¤ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ•Ñ5…¥¹Ñ•¹…¹•½µµÕ¹¥…Ñ¥½¹½¹Ñ•áÐ¡±¥•¹ÐèA½½±±¥•¹Ð°¥è¹Õµ‰•È¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1PµÈ¹¥°µÈ¹É•ÅÕ•ÍÑ}¹Õµ‰•È°µÈ¹Ñ¥Ñ±”°µÈ¹ÁÉ¥½É¥Ñä°µÈ¹ÍÑ…ÑÕÌ°µÈ¹‘Õ•}‘…Ñ”°µÈ¹É•Í½±Ù•‘}…Ð°(€€€€€€€€€€€€€ˆ¹¹…µ”L‰Õ¥±‘¥¹}¹…µ”°Ô¹¹Õµ‰•ÈLÕ¹¥Ñ}¹Õµ‰•È°(€€€€€€€€€€€€€=9P¡Ð¹™¥ÉÍÑ}¹…µ”°€œ€œ°Ð¹±…ÍÑ}¹…µ”¤LÑ•¹…¹Ñ}¹…µ”°Ð¹•µ…¥°LÑ•¹…¹Ñ}•µ…¥°°Ð¹Á¡½¹”LÑ•¹…¹Ñ}Á¡½¹”°(€€€€€€€€€€€€€=9P¡”¹™¥ÉÍÑ}¹…µ”°€œ€œ°”¹±…ÍÑ}¹…µ”¤LÑ•¡¹¥¥…¹}¹…µ”°”¹•µ…¥°LÑ•¡¹¥¥…¹}•µ…¥°°”¹Á¡½¹”LÑ•¡¹¥¥…¹}Á¡½¹”(€€€€€€I=4µ…¥¹Ñ•¹…¹•}É•ÅÕ•ÍÑÌµÈ(€€€€€€1P)=%8‰Õ¥±‘¥¹Ìˆ=8ˆ¹¥€ôµÈ¹‰Õ¥±‘¥¹}¥(€€€€€€1P)=%8Õ¹¥ÑÌÔ=8Ô¹¥€ôµÈ¹Õ¹¥Ñ}¥(€€€€€€1P)=%8Ñ•¹…¹ÑÌÐ=8Ð¹¥€ôµÈ¹Ñ•¹…¹Ñ}¥(€€€€€€1P)=%8•µÁ±½å••Ì”=8”¹¥€ôµÈ¹…ÍÍ¥¹•‘}•µÁ±½å••}¥(€€€€€€]!IµÈ¹¥€ô€Ä9µÈ¹½É…¹¥é…Ñ¥½¹}¥€ô€È9µÈ¹‘•±•Ñ•‘}…Ð%L9U11€°(€€€€€m¥°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€É•ÑÕÉ¸É•ÅÕ¥É•I½Ü¡É½ÝÍlÁt°€5…¥¹Ñ•¹…¹”É•ÅÕ•ÍÐœ¤ì(€ô((€ÁÉ¥Ù…Ñ”‘•™…Õ±Ñ5…¥¹Ñ•¹…¹•5•ÍÍ…”¡¡…¹¹•°èÍÑÉ¥¹œ°É•ÅÕ•ÍÐèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø°•Ù•¹ÐèÍÑÉ¥¹œ°½µµ•¹ÐüèÍÑÉ¥¹œ¤ì(€€€½¹ÍÐ™É…µ•¹ÑÌ€ôl(€€€€€€‘íÉ•ÅÕ•ÍÐ¹É•ÅÕ•ÍÑ}¹Õµ‰•Éô€´€‘íÉ•ÅÕ•ÍÐ¹Ñ¥Ñ±•õ€°(€€€€€É•ÅÕ•ÍÐ¹‰Õ¥±‘¥¹}¹…µ”€ü%µµ•Õ‰±”è€‘íÉ•ÅÕ•ÍÐ¹‰Õ¥±‘¥¹}¹…µ•õ€€è¹Õ±°°(€€€€€É•ÅÕ•ÍÐ¹Õ¹¥Ñ}¹Õµ‰•È€üU¹¥Ó¤è€‘íÉ•ÅÕ•ÍÐ¹Õ¹¥Ñ}¹Õµ‰•Éõ€€è¹Õ±°°(€€€€€AÉ¥½É¥Ó¤è€‘íÉ•ÅÕ•ÍÐ¹ÁÉ¥½É¥Ñåõ€°(€€€€€MÑ…ÑÕÐè€‘íÉ•ÅÕ•ÍÐ¹ÍÑ…ÑÕÍõ€°(€€€€€É•ÅÕ•ÍÐ¹Ñ•¡¹¥¥…¹}¹…µ”€üQ•¡¹¥¥•¸è€‘íÉ•ÅÕ•ÍÐ¹Ñ•¡¹¥¥…¹}¹…µ•õ€€è¹Õ±°°(€€€€€•Ù•¹Ð€ôôô€IM=1Yœ(€€€€€€€€ü…Ñ”Ë¥Í½±ÕÑ¥½¸è€‘íÉ•ÅÕ•ÍÐ¹É•Í½±Ù•‘}…Ð€üMÑÉ¥¹œ¡É•ÅÕ•ÍÐ¹É•Í½±Ù•‘}…Ð¤¹Í±¥” À°€ÄÀ¤€è¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤¹Í±¥” À°€ÄÀ¥õ€(€€€€€€€€èÉ•ÅÕ•ÍÐ¹‘Õ•}‘…Ñ”(€€€€€€€€€€ü…Ñ”ÁË¥ÙÕ”è€‘íMÑÉ¥¹œ¡É•ÅÕ•ÍÐ¹‘Õ•}‘…Ñ”¤¹Í±¥” À°€ÄÀ¥õ€(€€€€€€€€€€è¹Õ±°°(€€€€€½µµ•¹Ð€ü½µµ•¹Ñ…¥É”è€‘í½µµ•¹Ñõ€€è¹Õ±°°(€€€t¹™¥±Ñ•È¡	½½±•…¸¤ì(€€€É•ÑÕÉ¸¡…¹¹•°€ôôô€5%0œ€ü	½¹©½ÕÈ±q¸‘í™É…µ•¹ÑÌ¹©½¥¸ q¸œ¥õ€€è™É…µ•¹ÑÌ¹©½¥¸ œð€œ¤ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÉ•…Ñ•]½É­™±½Ý%¹ÍÑ…¹•%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹ÐèA½½±±¥•¹Ð°‰½‘äèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø¤ì(€€€½¹ÍÐÑåÁ”€ôMÑÉ¥¹œ¡‰½‘ä¹ÑåÁ”€üü€UMQ=4œ¤ì(€€€½¹ÍÐ‘•™¥¹¥Ñ¥½¸€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P€¨I=4Ý½É­™±½Ý}‘•™¥¹¥Ñ¥½¹Ì(€€€€€€]!IÑåÁ”€ô€Ä9½É…¹¥é…Ñ¥½¹}¥€ô€È9‘•±•Ñ•‘}…Ð%L9U10(€€€€€€=IH	d¥1%5%P€Å€°(€€€€€mÑåÁ”°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€½¹ÍÐ‘•™¥¹¥Ñ¥½¹%€ô‘•™¥¹¥Ñ¥½¸¹É½ÝÍlÁtü¹¥€üü¹Õ±°ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€%9MIP%9Q<Ý½É­™±½Ý}¥¹ÍÑ…¹•Ì(€€€€€€€¡Ý½É­™±½Ý}‘•™¥¹¥Ñ¥½¹}¥°ÑåÁ”°•¹Ñ¥Ñå}ÑåÁ”°•¹Ñ¥Ñå}¥°Ñ¥Ñ±”°É•ÅÕ•ÍÑ•É}¥°ÍÑ…ÑÕÌ°½µµ•¹Ð°½É…¹¥é…Ñ¥½¹}¥¤(€€€€€€Y1UL€ Ä°€È°€Ì°€Ð°€Ô°€Ø°€A9%9œ°€Ü°€à¤(€€€€€€IQUI9%9€©€°(€€€€€l(€€€€€€€‘•™¥¹¥Ñ¥½¹%°(€€€€€€€ÑåÁ”°(€€€€€€€‰½‘ä¹•¹Ñ¥Ñå}ÑåÁ”€üüÑåÁ”°(€€€€€€€‰½‘ä¹•¹Ñ¥Ñå}¥€üü¹Õ±°°(€€€€€€€‰½‘ä¹Ñ¥Ñ±”€üü€‘íÑåÁ•ô€Œ‘í‰½‘ä¹•¹Ñ¥Ñå}¥€üü€œõ€°(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•É% ¤€üü‰½‘ä¹É•ÅÕ•ÍÑ•É}¥€üü¹Õ±°°(€€€€€€€‰½‘ä¹½µµ•¹Ð€üü¹Õ±°°(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°(€€€€€t°(€€€€¤ì(€€€½¹ÍÐÍÑ•ÁÌ€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P€¨I=4Ý½É­™±½Ý}ÍÑ•Á}‘•™¥¹¥Ñ¥½¹Ì(€€€€€€]!IÝ½É­™±½Ý}‘•™¥¹¥Ñ¥½¹}¥€ô€Ä9½É…¹¥é…Ñ¥½¹}¥€ô€È9‘•±•Ñ•‘}…Ð%L9U10(€€€€€€=IH	dÍÑ•Á}½É‘•É€°(€€€€€m‘•™¥¹¥Ñ¥½¹%°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€½¹ÍÐÍÑ•ÁI½ÝÌ€ôÍÑ•ÁÌ¹É½ÝÌ¹±•¹Ñ €üÍÑ•ÁÌ¹É½ÝÌ€èmìÍÑ•Á}½É‘•Èè€Ä°¹…µ”è€Y…±¥‘…Ñ¥½¸œ°…ÁÁÉ½Ù•É}É½±”è€%IQ=Hœ°…ÁÁÉ½Ù•É}ÕÍ•É}¥è¹Õ±°õtì(€€€™½È€¡½¹ÍÐÍÑ•À½˜ÍÑ•ÁI½ÝÌ¤ì(€€€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€%9MIP%9Q<Ý½É­™±½Ý}ÍÑ•ÁÌ(€€€€€€€€€¡Ý½É­™±½Ý}¥¹ÍÑ…¹•}¥°ÍÑ•Á}½É‘•È°¹…µ”°…ÁÁÉ½Ù•É}É½±”°…ÁÁÉ½Ù•É}ÕÍ•É}¥°½É…¹¥é…Ñ¥½¹}¥¤(€€€€€€€€Y1UL€ Ä°€È°€Ì°€Ð°€Ô°€Ø¥€°(€€€€€€€mÉ½ÝÍlÁt¹¥°ÍÑ•À¹ÍÑ•Á}½É‘•È°ÍÑ•À¹¹…µ”°ÍÑ•À¹…ÁÁÉ½Ù•É}É½±”°ÍÑ•À¹…ÁÁÉ½Ù•É}ÕÍ•É}¥°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€€€¤ì(€€€ô(€€€…Ý…¥ÐÑ¡¥Ì¹…‘‘]½É­™±½ÝÑ¥½¸¡±¥•¹Ð°É½ÝÍlÁt¹¥°€IQœ°‰½‘ä¹½µµ•¹Ð€üMÑÉ¥¹œ¡‰½‘ä¹½µµ•¹Ð¤€è€]½É­™±½ÜË§¤œ¤ì(€€€É•ÑÕÉ¸É½ÝÍlÁtì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ…‘‘]½É­™±½ÝÑ¥½¸¡±¥•¹ÐèA½½±±¥•¹Ð°Ý½É­™±½Ý%¹ÍÑ…¹•%è¹Õµ‰•È°…Ñ¥½¸èÍÑÉ¥¹œ°½µµ•¹ÐüèÍÑÉ¥¹œ¤ì(€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€%9MIP%9Q<Ý½É­™±½Ý}…Ñ¥½¹Ì€¡Ý½É­™±½Ý}¥¹ÍÑ…¹•}¥°…Ñ¥½¸°½µµ•¹Ð°…Ñ•‘}‰ä°½É…¹¥é…Ñ¥½¹}¥¤(€€€€€€Y1UL€ Ä°€È°€Ì°€Ð°€Ô¥€°(€€€€€mÝ½É­™±½Ý%¹ÍÑ…¹•%°…Ñ¥½¸°½µµ•¹Ð€üü¹Õ±°°Ñ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•É% ¤€üü€Ä°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ•¹ÍÕÉ•]½É­™±½ÝMÑ•Á…¹Ð¡±¥•¹ÐèA½½±±¥•¹Ð°Ý½É­™±½Ý%¹ÍÑ…¹•%è¹Õµ‰•È¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1PÝÌ¸¨(€€€€€€I=4Ý½É­™±½Ý}ÍÑ•ÁÌÝÌ(€€€€€€)=%8Ý½É­™±½Ý}¥¹ÍÑ…¹•ÌÝ¤=8Ý¤¹¥€ôÝÌ¹Ý½É­™±½Ý}¥¹ÍÑ…¹•}¥(€€€€€€]!IÝÌ¹Ý½É­™±½Ý}¥¹ÍÑ…¹•}¥€ô€Ä9ÝÌ¹½É…¹¥é…Ñ¥½¹}¥€ô€È9Ý¤¹ÍÑ…ÑÕÌ€ô€A9%9œ9ÝÌ¹ÍÑ…ÑÕÌ€ô€A9%9œ(€€€€€€1%5%P€Å€°(€€€€€mÝ½É­™±½Ý%¹ÍÑ…¹•%°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€½¹ÍÐÍÑ•À€ôÉ•ÅÕ¥É•I½Ü¡É½ÝÍlÁt°€]½É­™±½ÜÍÑ•Àœ¤ì(€€€¥˜€¡ÍÑ•À¹…ÁÁÉ½Ù•É}ÕÍ•É}¥€˜˜9Õµ‰•È¡ÍÑ•À¹…ÁÁÉ½Ù•É}ÕÍ•É}¥¤€„ôôÑ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•É% ¤¤Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ Y½ÕÌ¹”Á½ÕÙ•èÁ…ÌÙ…±¥‘•È•ÑÑ”ƒ¥Ñ…Á”œ¤ì(€€€¥˜€¡ÍÑ•À¹…ÁÁÉ½Ù•É}É½±”€˜˜ÍÑ•À¹…ÁÁÉ½Ù•É}É½±”€„ôôÑ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•È ¤ü¹É½±”¤Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ KÑ±”…ÁÁÉ½‰…Ñ•ÕÈÉ•ÅÕ¥Ìœ¤ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ•¹ÍÕÉ•]½É­™±½ÝÁÁÉ½Ù•¡±¥•¹ÐèA½½±±¥•¹Ð°Ý½É­™±½Ý%¹ÍÑ…¹•%üèÕ¹­¹½Ý¸¤ì(€€€¥˜€ …Ý½É­™±½Ý%¹ÍÑ…¹•%¤É•ÑÕÉ¸ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1PÍÑ…ÑÕÌI=4Ý½É­™±½Ý}¥¹ÍÑ…¹•Ì]!I¥€ô€Ä9½É…¹¥é…Ñ¥½¹}¥€ô€È9‘•±•Ñ•‘}…Ð%L9U11€°(€€€€€mÝ½É­™±½Ý%¹ÍÑ…¹•%°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€½¹ÍÐÝ½É­™±½Ü€ôÉ•ÅÕ¥É•I½Ü¡É½ÝÍlÁt°€]½É­™±½Üœ¤ì(€€€¥˜€¡Ý½É­™±½Ü¹ÍÑ…ÑÕÌ€ôôô€I)Qœ¤Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ ]½É­™±½ÜÉ•©•Ó¤è…Ñ¥½¸‰±½Å×¥”œ¤ì(€€€¥˜€¡Ý½É­™±½Ü¹ÍÑ…ÑÕÌ€„ôô€AAI=Yœ¤Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ ]½É­™±½Ü•¸…ÑÑ•¹Ñ”è…Ñ¥½¸‰±½Å×¥”œ¤ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ…‘‘5…¥¹Ñ•¹…¹•Q¥µ•±¥¹”¡±¥•¹ÐèA½½±±¥•¹Ð°µ…¥¹Ñ•¹…¹•I•ÅÕ•ÍÑ%è¹Õµ‰•È°•Ù•¹ÑQåÁ”èÍÑÉ¥¹œ°Ñ¥Ñ±”èÍÑÉ¥¹œ°‘•Ñ…¥±ÌüèÍÑÉ¥¹œ¤ì(€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€%9MIP%9Q<µ…¥¹Ñ•¹…¹•}Ñ¥µ•±¥¹”€¡µ…¥¹Ñ•¹…¹•}É•ÅÕ•ÍÑ}¥°•Ù•¹Ñ}ÑåÁ”°Ñ¥Ñ±”°‘•Ñ…¥±Ì°É•…Ñ•‘}‰ä°½É…¹¥é…Ñ¥½¹}¥¤(€€€€€€Y1UL€ Ä°€È°€Ì°€Ð°€Ô°€Ø¥€°(€€€€€mµ…¥¹Ñ•¹…¹•I•ÅÕ•ÍÑ%°•Ù•¹ÑQåÁ”°Ñ¥Ñ±”°‘•Ñ…¥±Ì€üü¹Õ±°°Ñ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•É% ¤€üü€Ä°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ½Á•¹M•ÍÍ¥½¸¡±¥•¹ÐèA½½±±¥•¹Ð¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä¡M1P€¨I=4…Í¡}Í•ÍÍ¥½¹Ì]!IÍÑ…ÑÕÌ€ô€=A8œ9½É…¹¥é…Ñ¥½¹}¥€ô€Ä9‘•±•Ñ•‘}…Ð%L9U10=IH	d½Á•¹•‘}…ÐM1%5%P€Å€°l(€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°(€€€t¤ì(€€€¥˜€ …É½ÝÍlÁt¤Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ ÕÕ¹”…¥ÍÍ”½ÕÙ•ÉÑ”œ¤ì(€€€É•ÑÕÉ¸É½ÝÍlÁtì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ•¹ÍÕÉ•9½1•…Í•½¹™±¥Ð¡±¥•¹ÐèA½½±±¥•¹Ð°Õ¹¥Ñ%è¹Õµ‰•È°ÍÑ…ÉÑ…Ñ”èÍÑÉ¥¹œ°•¹‘…Ñ”èÍÑÉ¥¹œð¹Õ±°°¥¹½É•‘1•…Í•%üè¹Õµ‰•È¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P¥I=4±•…Í•Ì(€€€€€€]!IÕ¹¥Ñ}¥€ô€Ä(€€€€€€€€9½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€9…É¡¥Ù•‘}…Ð%L9U10(€€€€€€€€9ÍÑ…ÑÕÌ€ô€Q%Yœ(€€€€€€€€9€ Ôèé%9P%L9U10=H¥€ðø€Ô¤(€€€€€€€€9‘…Ñ•É…¹”¡ÍÑ…ÉÑ}‘…Ñ”°=1M¡•¹‘}‘…Ñ”°€œÈäää´ÄÈ´ÌÄœèéQ¤°€mtœ¤(€€€€€€€€€€€€€˜˜‘…Ñ•É…¹” ÌèéQ°=1M ÐèéQ°€œÈäää´ÄÈ´ÌÄœèéQ¤°€mtœ¤(€€€€€€1%5%P€Å€°(€€€€€mÕ¹¥Ñ%°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°ÍÑ…ÉÑ…Ñ”°•¹‘…Ñ”°¥¹½É•‘1•…Í•%€üü¹Õ±±t°(€€€€¤ì(€€€¥˜€¡É½ÝÍlÁt¤Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ U¸‰…¥°…Ñ¥˜•á¥ÍÑ”“¥«€ÍÕÈ•ÑÑ”Õ¹¥Ó¤Á½ÕÈ•ÑÑ”Ã¥É¥½‘”œ¤ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ…Ñ¥Ù…Ñ•1•…Í•%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹ÐèA½½±±¥•¹Ð°¥è¹Õµ‰•È¤ì(€€€½¹ÍÐ±•…Í”€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P€¨I=4±•…Í•Ì]!I¥€ô€Ä9½É…¹¥é…Ñ¥½¹}¥€ô€È9‘•±•Ñ•‘}…Ð%L9U109…É¡¥Ù•‘}…Ð%L9U11€°(€€€€€m¥°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€½¹ÍÐÉ½Ü€ôÉ•ÅÕ¥É•I½Ü¡±•…Í”¹É½ÝÍlÁt°€1•…Í”œ¤ì(€€€…Ý…¥ÐÑ¡¥Ì¹•¹ÍÕÉ•9½1•…Í•½¹™±¥Ð¡±¥•¹Ð°9Õµ‰•È¡É½Ü¹Õ¹¥Ñ}¥¤°É½Ü¹ÍÑ…ÉÑ}‘…Ñ”°É½Ü¹•¹‘}‘…Ñ”°¥¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€UAQ±•…Í•Ì(€€€€€€MPÍÑ…ÑÕÌ€ô€Q%Yœ°…Ñ¥Ù…Ñ•‘}…Ð€ô=1M¡…Ñ¥Ù…Ñ•‘}…Ð°9=\ ¤¤°ÕÁ‘…Ñ•‘}…Ð€ô9=\ ¤(€€€€€€]!I¥€ô€Ä9½É…¹¥é…Ñ¥½¹}¥€ô€ÈIQUI9%9€©€°(€€€€€m¥°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä UAQÕ¹¥ÑÌMPÍÑ…ÑÕÌ€ô€Ä]!I¥€ô€È9½É…¹¥é…Ñ¥½¹}¥€ô€Ì9‘•±•Ñ•‘}…Ð%L9U10œ°l(€€€€€€=UA%œ°(€€€€€É½Ü¹Õ¹¥Ñ}¥°(€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°(€€€t¤ì(€€€É•ÑÕÉ¸É½ÝÍlÁtì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ•¹•É…Ñ•%µµ•‘¥…Ñ•%¹¥Ñ¥…±I•¹Ñ%¹Ù½¥•%™9••‘•¡±•…Í•%è¹Õµ‰•È¤ì(€€€ÑÉäì(€€€€€½¹ÍÐÉ•ÍÕ±Ð€ô…Ý…¥ÐÑ¡¥Ì¹…ÕÑ½µ…Ñ¥½¹ÍM•ÉÙ¥”¹•¹•É…Ñ•%µµ•‘¥…Ñ•%¹¥Ñ¥…±I•¹Ñ%¹Ù½¥•½É1•…Í”¡±•…Í•%¤ì(€€€€€¥˜€¡É•ÍÕ±Ð¹ÍÑ…ÑÕÌ€ôôô€MUMLœ¤ì(€€€€€€€Ñ¡¥Ì¹±½•È¹±½œ¡%µµ•‘¥…Ñ”¥¹¥Ñ¥…°É•¹Ð¥¹Ù½¥”•¹•É…Ñ•™½È±•…Í”€‘í±•…Í•%‘ôè€‘íÉ•ÍÕ±Ð¹¥¹Ù½¥•}¹Õµ‰•Éõ€¤ì(€€€€€ô(€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€Ñ¡¥Ì¹±½•È¹•ÉÉ½È (€€€€€€€%µµ•‘¥…Ñ”¥¹¥Ñ¥…°É•¹Ð¥¹Ù½¥”™…¥±•™½È±•…Í”€‘í±•…Í•%‘ôè€‘í•ÉÉ½È¥¹ÍÑ…¹•½˜ÉÉ½È€ü•ÉÉ½È¹µ•ÍÍ…”€èMÑÉ¥¹œ¡•ÉÉ½È¥õ€°(€€€€€€€•ÉÉ½È¥¹ÍÑ…¹•½˜ÉÉ½È€ü•ÉÉ½È¹ÍÑ…¬€èÕ¹‘•™¥¹•°(€€€€€€¤ì(€€€ô(€ô((€ÁÉ¥Ù…Ñ”Í¡½Õ±‘•¹•É…Ñ•%µµ•‘¥…Ñ•%¹¥Ñ¥…±I•¹Ñ%¹Ù½¥•™Ñ•É1•…Í•UÁ‘…Ñ” (€€€ÕÉÉ•¹ÐèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø°(€€€¹½Éµ…±¥é•èìÍÑ…ÑÕÌèÍÑÉ¥¹œìÍÑ…ÉÑ…Ñ”èÍÑÉ¥¹œô°(€€€‰½‘äèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø°(€€¤ì(€€€¥˜€¡MÑÉ¥¹œ¡¹½Éµ…±¥é•¹ÍÑ…ÑÕÌ€üü€œœ¤¹Ñ½UÁÁ•É…Í” ¤€„ôô€Q%Yœ¤ì(€€€€€É•ÑÕÉ¸™…±Í”ì(€€€ô(€€€½¹ÍÐÁÉ•Ù¥½ÕÍMÑ…ÑÕÌ€ôMÑÉ¥¹œ¡ÕÉÉ•¹Ð¹ÍÑ…ÑÕÌ€üü€œœ¤¹Ñ½UÁÁ•É…Í” ¤ì(€€€¥˜€¡ÁÉ•Ù¥½ÕÍMÑ…ÑÕÌ€„ôô€Q%Yœ¤ì(€€€€€É•ÑÕÉ¸ÑÉÕ”ì(€€€ô(€€€¥˜€ …=‰©•Ð¹ÁÉ½Ñ½ÑåÁ”¹¡…Í=Ý¹AÉ½Á•ÉÑä¹…±°¡‰½‘ä°€ÍÑ…ÉÑ}‘…Ñ”œ¤¤ì(€€€€€É•ÑÕÉ¸™…±Í”ì(€€€ô(€€€É•ÑÕÉ¸MÑÉ¥¹œ¡ÕÉÉ•¹Ð¹ÍÑ…ÉÑ}‘…Ñ”€üü€œœ¤¹Í±¥” À°€ÄÀ¤€„ôô¹½Éµ…±¥é•¹ÍÑ…ÉÑ…Ñ”ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÕÁÍ•ÉÑ1•…Í•Õ…É…¹Ñ•”¡±¥•¹ÐèA½½±±¥•¹Ð°±•…Í•%è¹Õµ‰•È°Õ…É…¹Ñ•”èI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø¤ì(€€€½¹ÍÐ…µ½Õ¹Ð€ô9Õµ‰•È¡Õ…É…¹Ñ•”¹…µ½Õ¹Ð€üü€À¤ì(€€€½¹ÍÐÁ…¥‘µ½Õ¹Ð€ô9Õµ‰•È¡Õ…É…¹Ñ•”¹Á…¥‘}…µ½Õ¹Ð€üü€À¤ì(€€€½¹ÍÐÍÑ…ÑÕÌ€ôMÑÉ¥¹œ¡Õ…É…¹Ñ•”¹ÍÑ…ÑÕÌ€üü€¡Á…¥‘µ½Õ¹Ð€øô…µ½Õ¹Ð€˜˜…µ½Õ¹Ð€ø€À€ü€A%œ€èÁ…¥‘µ½Õ¹Ð€ø€À€ü€AIQ%0œ€è€9=Q}A%œ¤¤ì(€€€¥˜€¡…Ý…¥ÐÑ¡¥Ì¹Ñ…‰±•á¥ÍÑÌ ±•…Í•}Õ…É…¹Ñ••Ìœ¤¤ì(€€€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€%9MIP%9Q<±•…Í•}Õ…É…¹Ñ••Ì€¡±•…Í•}¥°…µ½Õ¹Ð°Á…¥‘}…µ½Õ¹Ð°Á…åµ•¹Ñ}‘…Ñ”°ÍÑ…ÑÕÌ°½É…¹¥é…Ñ¥½¹}¥¤(€€€€€€€€Y1UL€ Ä°€È°€Ì°€Ð°€Ô°€Ø¤(€€€€€€€€=8=91%P€¡±•…Í•}¥¤<UAQMP(€€€€€€€€€€…µ½Õ¹Ð€ôa1U¹…µ½Õ¹Ð°(€€€€€€€€€€Á…¥‘}…µ½Õ¹Ð€ôa1U¹Á…¥‘}…µ½Õ¹Ð°(€€€€€€€€€€Á…åµ•¹Ñ}‘…Ñ”€ôa1U¹Á…åµ•¹Ñ}‘…Ñ”°(€€€€€€€€€€ÍÑ…ÑÕÌ€ôa1U¹ÍÑ…ÑÕÌ°(€€€€€€€€€€ÕÁ‘…Ñ•‘}…Ð€ô9=\ ¥€°(€€€€€€€m±•…Í•%°…µ½Õ¹Ð°Á…¥‘µ½Õ¹Ð°Õ…É…¹Ñ•”¹Á…åµ•¹Ñ}‘…Ñ”€üü¹Õ±°°ÍÑ…ÑÕÌ°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€€€¤ì(€€€ô(€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€UAQ±•…Í•Ì(€€€€€€MPÉ•¹Ñ…±}Õ…É…¹Ñ••}…µ½Õ¹Ð€ô€È°(€€€€€€€€€€É•¹Ñ…±}Õ…É…¹Ñ••}Á…¥€ô€Ì°(€€€€€€€€€€É•¹Ñ…±}Õ…É…¹Ñ••}Á…åµ•¹Ñ}‘…Ñ”€ô€Ð°(€€€€€€€€€€É•¹Ñ…±}Õ…É…¹Ñ••}ÍÑ…ÑÕÌ€ô€Ô°(€€€€€€€€€€ÕÁ‘…Ñ•‘}…Ð€ô9=\ ¤(€€€€€€]!I¥€ô€Ä9½É…¹¥é…Ñ¥½¹}¥€ô€Ù€°(€€€€€m±•…Í•%°…µ½Õ¹Ð°Á…¥‘µ½Õ¹Ð°Õ…É…¹Ñ•”¹Á…åµ•¹Ñ}‘…Ñ”€üü¹Õ±°°ÍÑ…ÑÕÌ°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ±•…Í•Õ…É…¹Ñ••%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹ÐèA½½±±¥•¹Ð°±•…Í•%è¹Õµ‰•È¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P€¨I=4±•…Í•}Õ…É…¹Ñ••Ì]!I±•…Í•}¥€ô€Ä9½É…¹¥é…Ñ¥½¹}¥€ô€È9‘•±•Ñ•‘}…Ð%L9U11€°(€€€€€m±•…Í•%°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€É•ÑÕÉ¸É½ÝÍlÁt€üü¹Õ±°ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ¹•áÑMÑ½­AÕÉ¡…Í•9Õµ‰•È¡±¥•¹ÐèA½½±±¥•¹Ð¤ì(€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä¡M1PÁ}…‘Ù¥Í½Éå}á…Ñ}±½¬¡¡…Í¡Ñ•áÐ Ä¤¥€°mÍÑ½¬µÁÕÉ¡…Í”´‘íÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥õt¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P=1M¡5`¡9U11%¡É••áÁ}É•Á±…”¡ÁÕÉ¡…Í•}¹Õµ‰•È°€mxÀ´åtœ°€œœ°€œœ¤°€œœ¤èé%9P¤°€À¤€¬€ÄLÙ…±Õ”(€€€€€€I=4ÍÑ½­}ÁÕÉ¡…Í•Ì(€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Å€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€É•ÑÕÉ¸A<´‘íMÑÉ¥¹œ¡É½ÝÍlÁtü¹Ù…±Õ”€üü€Ä¤¹Á…‘MÑ…ÉÐ Ø°€œÀœ¥õ€ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ¹•áÑMÑ½­I••¥ÁÑ9Õµ‰•È¡±¥•¹ÐèA½½±±¥•¹Ð¤ì(€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä¡M1PÁ}…‘Ù¥Í½Éå}á…Ñ}±½¬¡¡…Í¡Ñ•áÐ Ä¤¥€°mÍÑ½¬µÉ••¥ÁÐ´‘íÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥õt¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P=1M¡5`¡9U11%¡É••áÁ}É•Á±…”¡É••¥ÁÑ}¹Õµ‰•È°€mxÀ´åtœ°€œœ°€œœ¤°€œœ¤èé%9P¤°€À¤€¬€ÄLÙ…±Õ”(€€€€€€I=4ÍÑ½­}ÁÕÉ¡…Í•}É••¥ÁÑÌ(€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Å€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€É•ÑÕÉ¸	H´‘íMÑÉ¥¹œ¡É½ÝÍlÁtü¹Ù…±Õ”€üü€Ä¤¹Á…‘MÑ…ÉÐ Ø°€œÀœ¥õ€ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ¹½Éµ…±¥é•MÑ½­AÕÉ¡…Í•1¥¹•Ì¡±¥•¹ÐèA½½±±¥•¹Ð°±¥¹•ÌèÉÉ…äñI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸øø¤ì(€€€½¹ÍÐ¹½Éµ…±¥é•èÉÉ…äñI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸øø€ômtì(€€€½¹ÍÐ™¥ÉÍÑ1¥¹•	å%Ñ•µ%€ô¹•Ü5…Àñ¹Õµ‰•È°¹Õµ‰•Èø ¤ì(€€€™½È€¡±•Ð¥¹‘•à€ô€Àì¥¹‘•à€ð±¥¹•Ì¹±•¹Ñ ì¥¹‘•à€¬ô€Ä¤ì(€€€€€½¹ÍÐ±¥¹”€ô±¥¹•Ím¥¹‘•átì(€€€€€½¹ÍÐÍÑ½­%Ñ•µ%€ô9Õµ‰•È¡±¥¹”¹ÍÑ½­}¥Ñ•µ}¥€üü€À¤ì(€€€€€½¹ÍÐÅÕ…¹Ñ¥Ñä€ô9Õµ‰•È¡±¥¹”¹ÅÕ…¹Ñ¥Ñä€üü€À¤ì(€€€€€½¹ÍÐÕ¹¥ÑAÉ¥”€ô9Õµ‰•È¡±¥¹”¹Õ¹¥Ñ}ÁÉ¥”€üü€À¤ì(€€€€€¥˜€ …ÍÑ½­%Ñ•µ%ñðÅÕ…¹Ñ¥Ñä€ðô€À¤Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸¡1¥¹”€‘í¥¹‘•à€¬€Åôè…ÉÑ¥±”½ÔÅÕ…¹Ñ¥Ñ”¥¹Ù…±¥‘•€¤ì(€€€€€½¹ÍÐ™¥ÉÍÑ1¥¹”€ô™¥ÉÍÑ1¥¹•	å%Ñ•µ%¹•Ð¡ÍÑ½­%Ñ•µ%¤ì(€€€€€¥˜€¡™¥ÉÍÑ1¥¹”¤ì(€€€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸¡ì(€€€€€€€€€½‘”è€AUI!M}%Q5}UA1%Qœ°(€€€€€€€€€µ•ÍÍ…”è•Ð…ÉÑ¥±”•ÍÐ‘•©„ÁÉ•Í•¹Ð„±„±¥¹”€‘í™¥ÉÍÑ1¥¹•ô¸Y•Õ¥±±•èµ½‘¥™¥•È±„ÅÕ…¹Ñ¥Ñ”ÍÕÈ•ÑÑ”±¥¹”…Ô±¥•Ô‘”°…©½ÕÑ•ÈÕ¹”Í•½¹‘”™½¥Ì¹€°(€€€€€€€€€ÍÑ½­}¥Ñ•µ}¥èÍÑ½­%Ñ•µ%°(€€€€€€€€€™¥ÉÍÑ}±¥¹”è™¥ÉÍÑ1¥¹”°(€€€€€€€€€‘ÕÁ±¥…Ñ•}±¥¹”è¥¹‘•à€¬€Ä°(€€€€€€€ô¤ì(€€€€€ô(€€€€€™¥ÉÍÑ1¥¹•	å%Ñ•µ%¹Í•Ð¡ÍÑ½­%Ñ•µ%°¥¹‘•à€¬€Ä¤ì(€€€€€½¹ÍÐ¥Ñ•´€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€M1P¥°¹…µ”°ÍÑ…ÑÕÌI=4ÍÑ½­}¥Ñ•µÌ]!I¥€ô€Ä9½É…¹¥é…Ñ¥½¹}¥€ô€È9‘•±•Ñ•‘}…Ð%L9U11€°(€€€€€€€mÍÑ½­%Ñ•µ%°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€€€¤ì(€€€€€½¹ÍÐ¥Ñ•µI½Ü€ôÉ•ÅÕ¥É•I½Ü¡¥Ñ•´¹É½ÝÍlÁt°ÉÑ¥±”±¥¹”€‘í¥¹‘•à€¬€Åõ€¤ì(€€€€€¥˜€¡¥Ñ•µI½Ü¹ÍÑ…ÑÕÌ€„ôô€Q%Yœ¤Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸¡1¥¹”€‘í¥¹‘•à€¬€Åôè…ÉÑ¥±”¥¹…Ñ¥™€¤ì(€€€€€¹½Éµ…±¥é•¹ÁÕÍ ¡ì(€€€€€€€ÍÑ½­}¥Ñ•µ}¥èÍÑ½­%Ñ•µ%°(€€€€€€€ÅÕ…¹Ñ¥Ñä°(€€€€€€€Õ¹¥Ñ}ÁÉ¥”èÕ¹¥ÑAÉ¥”°(€€€€€€€±¥¹•}Ñ½Ñ…°èÅÕ…¹Ñ¥Ñä€¨Õ¹¥ÑAÉ¥”°(€€€€€ô¤ì(€€€ô(€€€É•ÑÕÉ¸¹½Éµ…±¥é•ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÉ•™É•Í¡MÑ½­AÕÉ¡…Í•MÑ…ÑÕÌ¡±¥•¹ÐèA½½±±¥•¹Ð°ÁÕÉ¡…Í•%è¹Õµ‰•È¤ì(€€€½¹ÍÐ±¥¹•Ì€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1PÅÕ…¹Ñ¥Ñä°É••¥Ù•‘}ÅÕ…¹Ñ¥ÑäI=4ÍÑ½­}ÁÕÉ¡…Í•}±¥¹•Ì(€€€€€€]!IÍÑ½­}ÁÕÉ¡…Í•}¥€ô€Ä9½É…¹¥é…Ñ¥½¹}¥€ô€È9‘•±•Ñ•‘}…Ð%L9U11€°(€€€€€mÁÕÉ¡…Í•%°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€½¹ÍÐÁÕÉ¡…Í”€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1PÑ½Ñ…±}…µ½Õ¹Ð°Á…¥‘}…µ½Õ¹Ð°É••¥Ù•‘}…Ð°É••¥Ù•‘}‰äI=4ÍÑ½­}ÁÕÉ¡…Í•Ì(€€€€€€]!I¥€ô€Ä9½É…¹¥é…Ñ¥½¹}¥€ô€È9‘•±•Ñ•‘}…Ð%L9U11€°(€€€€€mÁÕÉ¡…Í•%°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€½¹ÍÐÁÕÉ¡…Í•I½Ü€ôÉ•ÅÕ¥É•I½Ü¡ÁÕÉ¡…Í”¹É½ÝÍlÁt°€MÑ½¬ÁÕÉ¡…Í”œ¤ì(€€€½¹ÍÐÑ½Ñ…±=É‘•É•€ô±¥¹•Ì¹É½ÝÌ¹É•‘Õ” ¡ÍÕ´°±¥¹”¤€ôøÍÕ´€¬9Õµ‰•È¡±¥¹”¹ÅÕ…¹Ñ¥Ñä€üü€À¤°€À¤ì(€€€½¹ÍÐÑ½Ñ…±I••¥Ù•€ô±¥¹•Ì¹É½ÝÌ¹É•‘Õ” ¡ÍÕ´°±¥¹”¤€ôøÍÕ´€¬9Õµ‰•È¡±¥¹”¹É••¥Ù•‘}ÅÕ…¹Ñ¥Ñä€üü€À¤°€À¤ì(€€€½¹ÍÐÉ••ÁÑ¥½¹MÑ…ÑÕÌ€ôÑ½Ñ…±I••¥Ù•€ðô€À€ü€A9%9œ€èÑ½Ñ…±I••¥Ù•€øôÑ½Ñ…±=É‘•É•€ü€I%Yœ€è€AIQ%0œì(€€€½¹ÍÐ½ÕÑÍÑ…¹‘¥¹µ½Õ¹Ð€ô5…Ñ ¹µ…à¡9Õµ‰•È¡ÁÕÉ¡…Í•I½Ü¹Ñ½Ñ…±}…µ½Õ¹Ð€üü€À¤€´9Õµ‰•È¡ÁÕÉ¡…Í•I½Ü¹Á…¥‘}…µ½Õ¹Ð€üü€À¤°€À¤ì(€€€½¹ÍÐÁ…åµ•¹ÑMÑ…ÑÕÌ€ô½ÕÑÍÑ…¹‘¥¹µ½Õ¹Ð€ðô€À€˜˜9Õµ‰•È¡ÁÕÉ¡…Í•I½Ü¹Ñ½Ñ…±}…µ½Õ¹Ð€üü€À¤€ø€À€ü€A%œ€è9Õµ‰•È¡ÁÕÉ¡…Í•I½Ü¹Á…¥‘}…µ½Õ¹Ð€üü€À¤€ø€À€ü€AIQ%0œ€è€U9A%œì(€€€½¹ÍÐÁÕÉ¡…Í•MÑ…ÑÕÌ€ôÉ••ÁÑ¥½¹MÑ…ÑÕÌ€ôôô€I%Yœ€˜˜Á…åµ•¹ÑMÑ…ÑÕÌ€ôôô€A%œ€ü€1=Mœ€è€=A8œì(€€€½¹ÍÐÉ••¥Ù•‘ÑY…±Õ”€ô(€€€€€É••ÁÑ¥½¹MÑ…ÑÕÌ€ôôô€I%Yœ(€€€€€€€€üÁÕÉ¡…Í•I½Ü¹É••¥Ù•‘}…Ð€üü¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤(€€€€€€€€è¹Õ±°ì(€€€½¹ÍÐÉ••¥Ù•‘	åY…±Õ”€ô(€€€€€É••ÁÑ¥½¹MÑ…ÑÕÌ€ôôô€I%Yœ(€€€€€€€€üÁÕÉ¡…Í•I½Ü¹É••¥Ù•‘}‰ä€üü€¡Ñ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•É% ¤€üü€Ä¤(€€€€€€€€è¹Õ±°ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€UAQÍÑ½­}ÁÕÉ¡…Í•Ì(€€€€€€MPÉ••ÁÑ¥½¹}ÍÑ…ÑÕÌ€ô€È°(€€€€€€€€€€Á…åµ•¹Ñ}ÍÑ…ÑÕÌ€ô€Ì°(€€€€€€€€€€½ÕÑÍÑ…¹‘¥¹}…µ½Õ¹Ð€ô€Ð°(€€€€€€€€€€ÁÕÉ¡…Í•}ÍÑ…ÑÕÌ€ô€Ô°(€€€€€€€€€€É••¥Ù•‘}…Ð€ô€Ø°(€€€€€€€€€€É••¥Ù•‘}‰ä€ô€Ü°(€€€€€€€€€€ÕÁ‘…Ñ•‘}…Ð€ô9=\ ¤(€€€€€€]!I¥€ô€Ä9½É…¹¥é…Ñ¥½¹}¥€ô€à(€€€€€€IQUI9%9€©€°(€€€€€l(€€€€€€€ÁÕÉ¡…Í•%°(€€€€€€€É••ÁÑ¥½¹MÑ…ÑÕÌ°(€€€€€€€Á…åµ•¹ÑMÑ…ÑÕÌ°(€€€€€€€½ÕÑÍÑ…¹‘¥¹µ½Õ¹Ð°(€€€€€€€ÁÕÉ¡…Í•MÑ…ÑÕÌ°(€€€€€€€É••¥Ù•‘ÑY…±Õ”°(€€€€€€€É••¥Ù•‘	åY…±Õ”°(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°(€€€€€t°(€€€€¤ì(€€€É•ÑÕÉ¸É½ÝÍlÁtì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ¹•áÑMÕÁÁ±¥•É½‘”¡±¥•¹ÐèA½½±±¥•¹Ð¤ì(€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä¡M1PÁ}…‘Ù¥Í½Éå}á…Ñ}±½¬¡¡…Í¡Ñ•áÐ Ä¤¥€°mÍÕÁÁ±¥•È´‘íÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥õt¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P=1M¡5`¡9U11%¡É••áÁ}É•Á±…”¡ÍÕÁÁ±¥•É}½‘”°€mxÀ´åtœ°€œœ°€œœ¤°€œœ¤èé%9P¤°€À¤€¬€ÄLÙ…±Õ”(€€€€€€I=4ÍÕÁÁ±¥•ÉÌ(€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Å€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€É•ÑÕÉ¸MU@´‘íMÑÉ¥¹œ¡É½ÝÍlÁtü¹Ù…±Õ”€üü€Ä¤¹Á…‘MÑ…ÉÐ Ô°€œÀœ¥õ€ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÉ•ÅÕ¥É•MÕÁÁ±¥•È¡±¥•¹ÐèA½½±±¥•¹Ð°ÍÕÁÁ±¥•É%è¹Õµ‰•È¤ì(€€€¥˜€ …ÍÕÁÁ±¥•É%¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ M•±•Ñ¥½¹¹•èÕ¸™½ÕÉ¹¥ÍÍ•ÕÈ¸œ¤ì(€€€ô(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P€¨(€€€€€€I=4ÍÕÁÁ±¥•ÉÌ(€€€€€€]!I¥€ô€Ä9½É…¹¥é…Ñ¥½¹}¥€ô€È9‘•±•Ñ•‘}…Ð%L9U109ÍÑ…ÑÕÌ€ô€Q%Y€°(€€€€€mÍÕÁÁ±¥•É%°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€É•ÑÕÉ¸É•ÅÕ¥É•I½Ü¡É½ÝÍlÁt°€MÕÁÁ±¥•Èœ¤ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÉ••¥Ù•MÑ½­AÕÉ¡…Í•%¹QÉ…¹Í…Ñ¥½¸ (€€€±¥•¹ÐèA½½±±¥•¹Ð°(€€€ÁÕÉ¡…Í•I½ÜèI•½ÉñÍÑÉ¥¹œ°…¹äø°(€€€‰½‘äèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø°(€€€±½­•‘1¥¹•ÌüèÉÉ…äñI•½ÉñÍÑÉ¥¹œ°…¹äøø°(€€¤ì(€€€¥˜€¡MÑÉ¥¹œ¡ÁÕÉ¡…Í•I½Ü¹É••ÁÑ¥½¹}ÍÑ…ÑÕÌ€üü€œœ¤¹Ñ½UÁÁ•É…Í” ¤€ôôô€I%Yœ¤ì(€€€€€Ñ¡É½Ü¹•Ü½¹™±¥Ñá•ÁÑ¥½¸ •Ð…¡…Ð„‘•©„•Ñ”É••ÁÑ¥½¹¹”œ¤ì(€€€ô(€€€½¹ÍÐÁÕÉ¡…Í•1¥¹•Ì€ô±½­•‘1¥¹•Ì(€€€€€€üìÉ½ÝÌè±½­•‘1¥¹•Ìô(€€€€€€è…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€€€M1PÍÁ°¸¨°Í¤¹¹…µ”L¥Ñ•µ}¹…µ”(€€€€€€€€€€I=4ÍÑ½­}ÁÕÉ¡…Í•}±¥¹•ÌÍÁ°(€€€€€€€€€€)=%8ÍÑ½­}¥Ñ•µÌÍ¤=8Í¤¹¥€ôÍÁ°¹ÍÑ½­}¥Ñ•µ}¥(€€€€€€€€€€]!IÍÁ°¹ÍÑ½­}ÁÕÉ¡…Í•}¥€ô€Ä9ÍÁ°¹½É…¹¥é…Ñ¥½¹}¥€ô€È9ÍÁ°¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€€€=IH	dÍÁ°¹¥(€€€€€€€€€€=HUAQ€°(€€€€€€€€€mÁÕÉ¡…Í•I½Ü¹¥°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€€€€€¤ì(€€€½¹ÍÐ±¥¹•Ì€ôÉÉ…ä¹¥ÍÉÉ…ä¡‰½‘ä¹±¥¹•Ì¤€ü€¡‰½‘ä¹±¥¹•Ì…ÌÉÉ…äñI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸øø¤€èmtì(€€€½¹ÍÐ±¥¹•Í	å%€ô¹•Ü5…Àñ¹Õµ‰•È°I•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸øø¡ÁÕÉ¡…Í•1¥¹•Ì¹É½ÝÌ¹µ…À ¡±¥¹”¤€ôøm9Õµ‰•È¡±¥¹”¹¥¤°±¥¹•t¤¤ì(€€€½¹ÍÐÉ••¥ÁÑ9Õµ‰•È€ô…Ý…¥ÐÑ¡¥Ì¹¹•áÑMÑ½­I••¥ÁÑ9Õµ‰•È¡±¥•¹Ð¤ì(€€€½¹ÍÐÉ••¥ÁÐ€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€%9MIP%9Q<ÍÑ½­}ÁÕÉ¡…Í•}É••¥ÁÑÌ(€€€€€€€¡ÍÑ½­}ÁÕÉ¡…Í•}¥°É••¥ÁÑ}¹Õµ‰•È°É••¥ÁÑ}‘…Ñ”°É••¥Ù•É}¹…µ”°ÍÑ½É”°¹½Ñ•Ì°É•…Ñ•‘}‰ä°½É…¹¥é…Ñ¥½¹}¥¤(€€€€€€Y1UL€ Ä°€È°€Ì°€Ð°€Ô°€Ø°€Ü°€à¤(€€€€€€IQUI9%9€©€°(€€€€€l(€€€€€€€ÁÕÉ¡…Í•I½Ü¹¥°(€€€€€€€É••¥ÁÑ9Õµ‰•È°(€€€€€€€‰½‘ä¹É••¥ÁÑ}‘…Ñ”€üü¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤¹Í±¥” À°€ÄÀ¤°(€€€€€€€‰½‘ä¹É••¥Ù•É}¹…µ”€üü¹Õ±°°(€€€€€€€‰½‘ä¹ÍÑ½É”€üüÁÕÉ¡…Í•I½Ü¹ÍÑ½É”€üü¹Õ±°°(€€€€€€€‰½‘ä¹¹½Ñ•Ì€üü¹Õ±°°(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•É% ¤€üü€Ä°(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°(€€€€€t°(€€€€¤ì((€€€™½È€¡±•Ð¥¹‘•à€ô€Àì¥¹‘•à€ð±¥¹•Ì¹±•¹Ñ ì¥¹‘•à€¬ô€Ä¤ì(€€€€€½¹ÍÐ•¹ÑÉä€ô±¥¹•Ím¥¹‘•átì(€€€€€½¹ÍÐÁÕÉ¡…Í•1¥¹•%€ô9Õµ‰•È¡•¹ÑÉä¹ÍÑ½­}ÁÕÉ¡…Í•}±¥¹•}¥€üü€À¤ì(€€€€€½¹ÍÐÅÕ…¹Ñ¥ÑåI••¥Ù•€ô9Õµ‰•È¡•¹ÑÉä¹ÅÕ…¹Ñ¥Ñå}É••¥Ù•€üü€À¤ì(€€€€€¥˜€ …ÁÕÉ¡…Í•1¥¹•%ñðÅÕ…¹Ñ¥ÑåI••¥Ù•€ðô€À¤ì(€€€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸¡1¥¹”€‘í¥¹‘•à€¬€ÅôèÅÕ…¹Ñ¥Ñ”É•Õ”¥¹Ù…±¥‘•€¤ì(€€€€€ô(€€€€€½¹ÍÐÁÕÉ¡…Í•1¥¹”€ô±¥¹•Í	å%¹•Ð¡ÁÕÉ¡…Í•1¥¹•%¤ì(€€€€€¥˜€ …ÁÕÉ¡…Í•1¥¹”¤Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸¡1¥¹”€‘í¥¹‘•à€¬€Åôè…ÉÑ¥±”…¡…Ð¥¹ÑÉ½ÕÙ…‰±•€¤ì(€€€€€½¹ÍÐÉ•µ…¥¹¥¹œ€ô9Õµ‰•È¡ÁÕÉ¡…Í•1¥¹”¹ÅÕ…¹Ñ¥Ñä¤€´9Õµ‰•È¡ÁÕÉ¡…Í•1¥¹”¹É••¥Ù•‘}ÅÕ…¹Ñ¥Ñä€üü€À¤ì(€€€€€¥˜€¡ÅÕ…¹Ñ¥ÑåI••¥Ù•€øÉ•µ…¥¹¥¹œ¤ì(€€€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸¡1¥¹”€‘í¥¹‘•à€¬€ÅôèÅÕ…¹Ñ¥Ñ”É•Õ”ÍÕÁ•É¥•ÕÉ”…ÔÉ•ÍÑ”„É••Ù½¥È€ ‘íÉ•µ…¥¹¥¹ô¥€¤ì(€€€€€ô(€€€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€%9MIP%9Q<ÍÑ½­}ÁÕÉ¡…Í•}É••¥ÁÑ}±¥¹•Ì(€€€€€€€€€¡ÍÑ½­}ÁÕÉ¡…Í•}É••¥ÁÑ}¥°ÍÑ½­}ÁÕÉ¡…Í•}±¥¹•}¥°ÍÑ½­}¥Ñ•µ}¥°ÅÕ…¹Ñ¥Ñå}É••¥Ù•°Õ¹¥Ñ}ÁÉ¥”°±¥¹•}Ñ½Ñ…°°½É…¹¥é…Ñ¥½¹}¥¤(€€€€€€€€Y1UL€ Ä°€È°€Ì°€Ð°€Ô°€Ø°€Ü¥€°(€€€€€€€l(€€€€€€€€€É••¥ÁÐ¹É½ÝÍlÁt¹¥°(€€€€€€€€€ÁÕÉ¡…Í•1¥¹•%°(€€€€€€€€€ÁÕÉ¡…Í•1¥¹”¹ÍÑ½­}¥Ñ•µ}¥°(€€€€€€€€€ÅÕ…¹Ñ¥ÑåI••¥Ù•°(€€€€€€€€€ÁÕÉ¡…Í•1¥¹”¹Õ¹¥Ñ}ÁÉ¥”°(€€€€€€€€€ÅÕ…¹Ñ¥ÑåI••¥Ù•€¨9Õµ‰•È¡ÁÕÉ¡…Í•1¥¹”¹Õ¹¥Ñ}ÁÉ¥”€üü€À¤°(€€€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°(€€€€€€€t°(€€€€€€¤ì(€€€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€UAQÍÑ½­}ÁÕÉ¡…Í•}±¥¹•Ì(€€€€€€€€MPÉ••¥Ù•‘}ÅÕ…¹Ñ¥Ñä€ôÉ••¥Ù•‘}ÅÕ…¹Ñ¥Ñä€¬€Ì°ÕÁ‘…Ñ•‘}…Ð€ô9=\ ¤(€€€€€€€€]!I¥€ô€Ä9ÍÑ½­}ÁÕÉ¡…Í•}¥€ô€È9½É…¹¥é…Ñ¥½¹}¥€ô€Ñ€°(€€€€€€€mÁÕÉ¡…Í•1¥¹•%°ÁÕÉ¡…Í•I½Ü¹¥°ÅÕ…¹Ñ¥ÑåI••¥Ù•°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€€€¤ì(€€€€€…Ý…¥ÐÑ¡¥Ì¹É•…Ñ•MÑ½­5½Ù•µ•¹Ñ%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹Ð°ì(€€€€€€€ÍÑ½­}¥Ñ•µ}¥èÁÕÉ¡…Í•1¥¹”¹ÍÑ½­}¥Ñ•µ}¥°(€€€€€€€ÑåÁ”è€%8œ°(€€€€€€€ÅÕ…¹Ñ¥ÑäèÅÕ…¹Ñ¥ÑåI••¥Ù•°(€€€€€€€µ½Ù•µ•¹Ñ}‘…Ñ”èÉ••¥ÁÐ¹É½ÝÍlÁt¹É••¥ÁÑ}‘…Ñ”°(€€€€€€€Í½ÕÉ”è€AUI!M}I%APœ°(€€€€€€€É•™•É•¹”èÉ••¥ÁÑ9Õµ‰•È°(€€€€€€€¹½Ñ•Ìè‰½‘ä¹¹½Ñ•Ì€üüI••ÁÑ¥½¸…¡…Ð€‘íÁÕÉ¡…Í•I½Ü¹ÁÕÉ¡…Í•}¹Õµ‰•Éõ€°(€€€€€€€Õ¹¥Ñ}ÁÉ¥”è9Õµ‰•È¡ÁÕÉ¡…Í•1¥¹”¹Õ¹¥Ñ}ÁÉ¥”€üü€À¤°(€€€€€€€ÍÑ½­}ÁÕÉ¡…Í•}¥èÁÕÉ¡…Í•I½Ü¹¥°(€€€€€€€ÍÑ½­}ÁÕÉ¡…Í•}É••¥ÁÑ}¥èÉ••¥ÁÐ¹É½ÝÍlÁt¹¥°(€€€€€ô¤ì(€€€ô((€€€…Ý…¥ÐÑ¡¥Ì¹É•™É•Í¡MÑ½­AÕÉ¡…Í•MÑ…ÑÕÌ¡±¥•¹Ð°9Õµ‰•È¡ÁÕÉ¡…Í•I½Ü¹¥¤¤ì(€€€…Ý…¥ÐÑ¡¥Ì¹…‘‘MÑ½­AÕÉ¡…Í•Q¥µ•±¥¹”¡±¥•¹Ð°9Õµ‰•È¡ÁÕÉ¡…Í•I½Ü¹¥¤°€I%APœ°€I••ÁÑ¥½¸‘”µ…É¡…¹‘¥Í•Ìœ°	½¸€‘íÉ••¥ÁÑ9Õµ‰•Éô•¹É•¥ÍÑÉ•€¤ì(€€€É•ÑÕÉ¸É••¥ÁÐ¹É½ÝÍlÁtì(€ô((€ÁÉ¥Ù…Ñ”Ù…±¥‘…Ñ•AÕÉ¡…Í•ÑÑ…¡µ•¹Ñ¥±”¡™¥±”èìµ¥µ•ÑåÁ”èÍÑÉ¥¹œìÍ¥é”è¹Õµ‰•Èô¤ì(€€€¥˜€¡9Õµ‰•È¡™¥±”¹Í¥é”€üü€À¤€ø€ÄÀ€¨€ÄÀÈÐ€¨€ÄÀÈÐ¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1”™¥¡¥•È¹”Á•ÕÐÁ…Ì‘•Á…ÍÍ•È€ÄÀ5¼œ¤ì(€€€ô(€€€½¹ÍÐµ¥µ•QåÁ”€ôMÑÉ¥¹œ¡™¥±”¹µ¥µ•ÑåÁ”€üü€œœ¤¹Ñ½1½Ý•É…Í” ¤ì(€€€¥˜€ …Ñ¡¥Ì¹…±±½Ý•‘AÕÉ¡…Í•ÑÑ…¡µ•¹Ñ5¥µ•QåÁ•Ì¹¡…Ì¡µ¥µ•QåÁ”¤¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ ½Éµ…Ð‘”™¥¡¥•È¹½¸…ÕÑ½É¥Í”œ¤ì(€€€ô(€ô((€ÁÉ¥Ù…Ñ”ÁÕÉ¡…Í•ÑÑ…¡µ•¹ÑMÑ½É…•A…Ñ ¡ÁÕÉ¡…Í•%è¹Õµ‰•È°™¥±•9…µ”èÍÑÉ¥¹œ¤ì(€€€½¹ÍÐÑ¥µ•ÍÑ…µÀ€ô¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤¹É•Á±…” ½l´ét½œ°€œœ¤¹É•Á±…” ½p¹q‘ìÍõh¼°€hœ¤ì(€€€É•ÑÕÉ¸ÁÕÉ¡…Í•Ì¼‘íÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥ô¼‘íÁÕÉ¡…Í•%‘ô¼‘íÑ¥µ•ÍÑ…µÁô´‘íÑ¡¥Ì¹Í…¹¥Ñ¥é•MÑ½É…•¥±•9…µ”¡™¥±•9…µ”¥õ€ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÕÁ±½…‘AÕÉ¡…Í•ÑÑ…¡µ•¹ÑQ½MÑ½É…”¡ÍÑ½É…•A…Ñ èÍÑÉ¥¹œ°™¥±”èìµ¥µ•ÑåÁ”èÍÑÉ¥¹œì‰Õ™™•Èè	Õ™™•Èô¤ì(€€€½¹ÍÐìÍÕÁ…‰…Í•UÉ°°Í•ÉÙ¥•I½±•-•äô€ôÑ¡¥Ì¹ÍÑ½É…•½¹™¥œ ¤ì(€€€½¹ÍÐÉ•ÍÁ½¹Í”€ô…Ý…¥Ð™•Ñ ¡€‘íÍÕÁ…‰…Í•UÉ±ô½ÍÑ½É…”½ØÄ½½‰©•Ð¼‘íÑ¡¥Ì¹ÁÕÉ¡…Í•ÑÑ…¡µ•¹ÑMÑ½É…•	Õ­•Ñô¼‘íÑ¡¥Ì¹•¹½‘•MÑ½É…•A…Ñ ¡ÍÑ½É…•A…Ñ ¥õ€°ì(€€€€€µ•Ñ¡½è€A=MPœ°(€€€€€¡•…‘•ÉÌèì(€€€€€€€ÕÑ¡½É¥é…Ñ¥½¸è	•…É•È€‘íÍ•ÉÙ¥•I½±•-•åõ€°(€€€€€€€…Á¥­•äèÍ•ÉÙ¥•I½±•-•ä°(€€€€€€€€àµÕÁÍ•ÉÐœè€™…±Í”œ°(€€€€€€€€½¹Ñ•¹ÐµÑåÁ”œè™¥±”¹µ¥µ•ÑåÁ”°(€€€€€ô°(€€€€€‰½‘äè™¥±”¹‰Õ™™•È¹‰Õ™™•È¹Í±¥”¡™¥±”¹‰Õ™™•È¹‰åÑ•=™™Í•Ð°™¥±”¹‰Õ™™•È¹‰åÑ•=™™Í•Ð€¬™¥±”¹‰Õ™™•È¹‰åÑ•1•¹Ñ ¤…ÌÉÉ…å	Õ™™•È°(€€€ô¤ì(€€€¥˜€ …É•ÍÁ½¹Í”¹½¬¤ì(€€€€€½¹ÍÐ‘•Ñ…¥±Ì€ô…Ý…¥ÐÉ•ÍÁ½¹Í”¹Ñ•áÐ ¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸¡‘•Ñ…¥±Ìñð%µÁ½ÍÍ¥‰±”‘”Ñ•±•Ù•ÉÍ•È±„Á¥•”©½¥¹Ñ”€ ‘íÉ•ÍÁ½¹Í”¹ÍÑ…ÑÕÍô¥€¤ì(€€€ô(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ‘•±•Ñ•AÕÉ¡…Í•ÑÑ…¡µ•¹ÑMÑ½É…”¡ÍÑ½É…•A…Ñ èÍÑÉ¥¹œ¤ì(€€€¥˜€ …Ñ¡¥Ì¹¡…ÍMÑ½É…•½¹™¥œ ¤¤É•ÑÕÉ¸ì(€€€½¹ÍÐìÍÕÁ…‰…Í•UÉ°°Í•ÉÙ¥•I½±•-•äô€ôÑ¡¥Ì¹ÍÑ½É…•½¹™¥œ ¤ì(€€€½¹ÍÐÉ•ÍÁ½¹Í”€ô…Ý…¥Ð™•Ñ ¡€‘íÍÕÁ…‰…Í•UÉ±ô½ÍÑ½É…”½ØÄ½½‰©•Ð¼‘íÑ¡¥Ì¹ÁÕÉ¡…Í•ÑÑ…¡µ•¹ÑMÑ½É…•	Õ­•Ñô¼‘íÑ¡¥Ì¹•¹½‘•MÑ½É…•A…Ñ ¡ÍÑ½É…•A…Ñ ¥õ€°ì(€€€€€µ•Ñ¡½è€1Qœ°(€€€€€¡•…‘•ÉÌèì(€€€€€€€ÕÑ¡½É¥é…Ñ¥½¸è	•…É•È€‘íÍ•ÉÙ¥•I½±•-•åõ€°(€€€€€€€…Á¥­•äèÍ•ÉÙ¥•I½±•-•ä°(€€€€€ô°(€€€ô¤ì(€€€¥˜€ …É•ÍÁ½¹Í”¹½¬€˜˜É•ÍÁ½¹Í”¹ÍÑ…ÑÕÌ€„ôô€ÐÀÐ¤ì(€€€€€½¹ÍÐ‘•Ñ…¥±Ì€ô…Ý…¥ÐÉ•ÍÁ½¹Í”¹Ñ•áÐ ¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸¡‘•Ñ…¥±Ìñð%µÁ½ÍÍ¥‰±”‘”ÍÕÁÁÉ¥µ•È±„Á¥•”©½¥¹Ñ”€ ‘íÉ•ÍÁ½¹Í”¹ÍÑ…ÑÕÍô¥€¤ì(€€€ô(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ‘½Ý¹±½…‘AÕÉ¡…Í•ÑÑ…¡µ•¹ÑMÑ½É…”¡ÍÑ½É…•A…Ñ èÍÑÉ¥¹œ°™¥±•9…µ”èÍÑÉ¥¹œ°µ¥µ•QåÁ”èÍÑÉ¥¹œ¤ì(€€€½¹ÍÐìÍÕÁ…‰…Í•UÉ°°Í•ÉÙ¥•I½±•-•äô€ôÑ¡¥Ì¹ÍÑ½É…•½¹™¥œ ¤ì(€€€½¹ÍÐÉ•ÍÁ½¹Í”€ô…Ý…¥Ð™•Ñ ¡€‘íÍÕÁ…‰…Í•UÉ±ô½ÍÑ½É…”½ØÄ½½‰©•Ð¼‘íÑ¡¥Ì¹ÁÕÉ¡…Í•ÑÑ…¡µ•¹ÑMÑ½É…•	Õ­•Ñô¼‘íÑ¡¥Ì¹•¹½‘•MÑ½É…•A…Ñ ¡ÍÑ½É…•A…Ñ ¥õ€°ì(€€€€€¡•…‘•ÉÌèì(€€€€€€€ÕÑ¡½É¥é…Ñ¥½¸è	•…É•È€‘íÍ•ÉÙ¥•I½±•-•åõ€°(€€€€€€€…Á¥­•äèÍ•ÉÙ¥•I½±•-•ä°(€€€€€ô°(€€€ô¤ì(€€€¥˜€ …É•ÍÁ½¹Í”¹½¬¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸¡A¥•”©½¥¹Ñ”¥¹ÑÉ½ÕÙ…‰±”€ ‘íÉ•ÍÁ½¹Í”¹ÍÑ…ÑÕÍô¥€¤ì(€€€ô(€€€É•ÑÕÉ¸ì(€€€€€‰Õ™™•Èè	Õ™™•È¹™É½´¡…Ý…¥ÐÉ•ÍÁ½¹Í”¹…ÉÉ…å	Õ™™•È ¤¤°(€€€€€µ¥µ•QåÁ”èÉ•ÍÁ½¹Í”¹¡•…‘•ÉÌ¹•Ð ½¹Ñ•¹ÐµÑåÁ”œ¤€üüµ¥µ•QåÁ”€üü€…ÁÁ±¥…Ñ¥½¸½½Ñ•ÐµÍÑÉ•…´œ°(€€€€€‘½Ý¹±½…‘9…µ”è™¥±•9…µ”°(€€€ôì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ…‘‘MÑ½­AÕÉ¡…Í•Q¥µ•±¥¹”¡±¥•¹ÐèA½½±±¥•¹Ð°ÁÕÉ¡…Í•%è¹Õµ‰•È°•Ù•¹ÑQåÁ”èÍÑÉ¥¹œ°Ñ¥Ñ±”èÍÑÉ¥¹œ°‘•Ñ…¥±ÌüèÍÑÉ¥¹œ¤ì(€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€%9MIP%9Q<ÍÑ½­}ÁÕÉ¡…Í•}Ñ¥µ•±¥¹”(€€€€€€€¡ÍÑ½­}ÁÕÉ¡…Í•}¥°•Ù•¹Ñ}ÑåÁ”°Ñ¥Ñ±”°‘•Ñ…¥±Ì°É•…Ñ•‘}‰ä°½É…¹¥é…Ñ¥½¹}¥¤(€€€€€€Y1UL€ Ä°€È°€Ì°€Ð°€Ô°€Ø¥€°(€€€€€mÁÕÉ¡…Í•%°•Ù•¹ÑQåÁ”°Ñ¥Ñ±”°‘•Ñ…¥±Ì€üü¹Õ±°°Ñ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•É% ¤€üü€Ä°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÉ•½É‘MÑ½­AÕÉ¡…Í•A…åµ•¹Ñ%¹QÉ…¹Í…Ñ¥½¸ (€€€±¥•¹ÐèA½½±±¥•¹Ð°(€€€ÁÕÉ¡…Í•%è¹Õµ‰•È°(€€€‰½‘äèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø°(€€€É•™É•Í¡MÑ…ÑÕÌ€ôÑÉÕ”°(€€¤ì(€€€½¹ÍÐÁÕÉ¡…Í”€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P€¨I=4ÍÑ½­}ÁÕÉ¡…Í•Ì(€€€€€€]!I¥€ô€Ä9½É…¹¥é…Ñ¥½¹}¥€ô€È9‘•±•Ñ•‘}…Ð%L9U10(€€€€€€=HUAQ€°(€€€€€mÁÕÉ¡…Í•%°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€½¹ÍÐÁÕÉ¡…Í•I½Ü€ôÉ•ÅÕ¥É•I½Ü¡ÁÕÉ¡…Í”¹É½ÝÍlÁt°€MÑ½¬ÁÕÉ¡…Í”œ¤ì(€€€½¹ÍÐ…µ½Õ¹Ð€ô9Õµ‰•È¡‰½‘ä¹…µ½Õ¹Ð€üü€À¤ì(€€€¥˜€¡…µ½Õ¹Ð€ðô€À¤Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1”µ½¹Ñ…¹Ð‘ÔÁ…¥•µ•¹Ð™½ÕÉ¹¥ÍÍ•ÕÈ‘½¥Ð•ÑÉ”Á½Í¥Ñ¥˜œ¤ì(€€€½¹ÍÐ½ÕÑÍÑ…¹‘¥¹œ€ô5…Ñ ¹µ…à¡9Õµ‰•È¡ÁÕÉ¡…Í•I½Ü¹Ñ½Ñ…±}…µ½Õ¹Ð€üü€À¤€´9Õµ‰•È¡ÁÕÉ¡…Í•I½Ü¹Á…¥‘}…µ½Õ¹Ð€üü€À¤°€À¤ì(€€€¥˜€¡…µ½Õ¹Ð€ø½ÕÑÍÑ…¹‘¥¹œ¤Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸¡1”Á…¥•µ•¹Ð‘•Á…ÍÍ”±”Í½±‘”É•ÍÑ…¹Ð€ ‘í½ÕÑÍÑ…¹‘¥¹œ¹Ñ½¥á• È¥ôUM¥€¤ì(€€€½¹ÍÐ…Í¡5½Ù•µ•¹Ð€ô…Ý…¥ÐÑ¡¥Ì¹É•…Ñ•…Í¡5½Ù•µ•¹Ñ%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹Ð°ì(€€€€€ÑåÁ”è€=UPœ°(€€€€€…Ñ•½Éäè€MQ=-}AUI!Mœ°(€€€€€…µ½Õ¹Ð°(€€€€€µ½Ù•µ•¹Ñ}‘…Ñ”è‰½‘ä¹Á…åµ•¹Ñ}‘…Ñ”€üü¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤¹Í±¥” À°€ÄÀ¤°(€€€€€ÍÕÁÁ±¥•ÈèÁÕÉ¡…Í•I½Ü¹ÍÕÁÁ±¥•É}¹…µ”°(€€€€€‘•ÍÉ¥ÁÑ¥½¸è‰½‘ä¹¹½Ñ•Ì€üüA…¥•µ•¹Ð™½ÕÉ¹¥ÍÍ•ÕÈ€‘íÁÕÉ¡…Í•I½Ü¹ÁÕÉ¡…Í•}¹Õµ‰•Éõ€°(€€€€€±…‰•°è¡…ÐÍÑ½¬€‘íÁÕÉ¡…Í•I½Ü¹ÁÕÉ¡…Í•}¹Õµ‰•Éõ€°(€€€€€É•™•É•¹”è‰½‘ä¹É•™•É•¹”€üüÁÕÉ¡…Í•I½Ü¹ÁÕÉ¡…Í•}¹Õµ‰•È°(€€€€€ÍÑ½­}ÁÕÉ¡…Í•}¥èÁÕÉ¡…Í•%°(€€€ô¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€%9MIP%9Q<ÍÑ½­}ÁÕÉ¡…Í•}Á…åµ•¹ÑÌ(€€€€€€€¡ÍÑ½­}ÁÕÉ¡…Í•}¥°Á…åµ•¹Ñ}‘…Ñ”°…µ½Õ¹Ð°Á…åµ•¹Ñ}µ•Ñ¡½°É•™•É•¹”°¹½Ñ•Ì°…Í¡}µ½Ù•µ•¹Ñ}¥°É•…Ñ•‘}‰ä°½É…¹¥é…Ñ¥½¹}¥¤(€€€€€€Y1UL€ Ä°€È°€Ì°€Ð°€Ô°€Ø°€Ü°€à°€ä¤(€€€€€€IQUI9%9€©€°(€€€€€l(€€€€€€€ÁÕÉ¡…Í•%°(€€€€€€€‰½‘ä¹Á…åµ•¹Ñ}‘…Ñ”€üü¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤¹Í±¥” À°€ÄÀ¤°(€€€€€€€…µ½Õ¹Ð°(€€€€€€€‰½‘ä¹Á…åµ•¹Ñ}µ•Ñ¡½€üüÁÕÉ¡…Í•I½Ü¹Á…åµ•¹Ñ}µ•Ñ¡½€üü¹Õ±°°(€€€€€€€‰½‘ä¹É•™•É•¹”€üüÁÕÉ¡…Í•I½Ü¹ÁÕÉ¡…Í•}¹Õµ‰•È°(€€€€€€€‰½‘ä¹¹½Ñ•Ì€üü¹Õ±°°(€€€€€€€…Í¡5½Ù•µ•¹Ð¹¥°(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•É% ¤€üü€Ä°(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°(€€€€€t°(€€€€¤ì(€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€UAQÍÑ½­}ÁÕÉ¡…Í•Ì(€€€€€€MPÁ…¥‘}…µ½Õ¹Ð€ôÁ…¥‘}…µ½Õ¹Ð€¬€È°(€€€€€€€€€€ÕÁ‘…Ñ•‘}…Ð€ô9=\ ¤(€€€€€€]!I¥€ô€Ä9½É…¹¥é…Ñ¥½¹}¥€ô€Í€°(€€€€€mÁÕÉ¡…Í•%°…µ½Õ¹Ð°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€¥˜€¡É•™É•Í¡MÑ…ÑÕÌ¤ì(€€€€€…Ý…¥ÐÑ¡¥Ì¹É•™É•Í¡MÑ½­AÕÉ¡…Í•MÑ…ÑÕÌ¡±¥•¹Ð°ÁÕÉ¡…Í•%¤ì(€€€ô•±Í”ì(€€€€€½¹ÍÐÁ…¥‘µ½Õ¹Ð€ô9Õµ‰•È¡ÁÕÉ¡…Í•I½Ü¹Á…¥‘}…µ½Õ¹Ð€üü€À¤€¬…µ½Õ¹Ðì(€€€€€½¹ÍÐ½ÕÑÍÑ…¹‘¥¹µ½Õ¹Ð€ô5…Ñ ¹µ…à¡9Õµ‰•È¡ÁÕÉ¡…Í•I½Ü¹Ñ½Ñ…±}…µ½Õ¹Ð€üü€À¤€´Á…¥‘µ½Õ¹Ð°€À¤ì(€€€€€½¹ÍÐÁ…åµ•¹ÑMÑ…ÑÕÌ€ô½ÕÑÍÑ…¹‘¥¹µ½Õ¹Ð€ðô€À€˜˜9Õµ‰•È¡ÁÕÉ¡…Í•I½Ü¹Ñ½Ñ…±}…µ½Õ¹Ð€üü€À¤€ø€À€ü€A%œ€èÁ…¥‘µ½Õ¹Ð€ø€À€ü€AIQ%0œ€è€U9A%œì(€€€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€UAQÍÑ½­}ÁÕÉ¡…Í•Ì(€€€€€€€€MPÁ…åµ•¹Ñ}ÍÑ…ÑÕÌ€ô€È°½ÕÑÍÑ…¹‘¥¹}…µ½Õ¹Ð€ô€Ì°ÕÁ‘…Ñ•‘}…Ð€ô9=\ ¤(€€€€€€€€]!I¥€ô€Ä9½É…¹¥é…Ñ¥½¹}¥€ô€Ñ€°(€€€€€€€mÁÕÉ¡…Í•%°Á…åµ•¹ÑMÑ…ÑÕÌ°½ÕÑÍÑ…¹‘¥¹µ½Õ¹Ð°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€€€¤ì(€€€ô(€€€É•ÑÕÉ¸ì€¸¸¹É½ÝÍlÁt°…Í¡}µ½Ù•µ•¹Ñ}¥è…Í¡5½Ù•µ•¹Ð¹¥ôì(€ô((€ÁÉ¥Ù…Ñ”¹½Éµ…±¥é•Y…É¥…‰±•Ì¡Ù…±Õ”èÕ¹­¹½Ý¸¤ì(€€€¥˜€¡ÉÉ…ä¹¥ÍÉÉ…ä¡Ù…±Õ”¤¤É•ÑÕÉ¸)M=8¹ÍÑÉ¥¹¥™ä¡Ù…±Õ”¤ì(€€€¥˜€¡ÑåÁ•½˜Ù…±Õ”€ôôô€ÍÑÉ¥¹œœ¤ì(€€€€€ÑÉäì(€€€€€€€½¹ÍÐÁ…ÉÍ•€ô)M=8¹Á…ÉÍ”¡Ù…±Õ”¤ì(€€€€€€€É•ÑÕÉ¸)M=8¹ÍÑÉ¥¹¥™ä¡ÉÉ…ä¹¥ÍÉÉ…ä¡Á…ÉÍ•¤€üÁ…ÉÍ•€èmt¤ì(€€€€€ô…Ñ ì(€€€€€€€É•ÑÕÉ¸)M=8¹ÍÑÉ¥¹¥™ä¡Ù…±Õ”¹ÍÁ±¥Ð œ°œ¤¹µ…À ¡¥Ñ•´¤€ôø¥Ñ•´¹ÑÉ¥´ ¤¤¹™¥±Ñ•È¡	½½±•…¸¤¤ì(€€€€€ô(€€€ô(€€€É•ÑÕÉ¸)M=8¹ÍÑÉ¥¹¥™ä¡mt¤ì(€ô((€ÁÉ¥Ù…Ñ”½‰©•ÑY…±Õ”¡Ù…±Õ”èÕ¹­¹½Ý¸¤ì(€€€¥˜€ …Ù…±Õ”¤É•ÑÕÉ¸íôì(€€€¥˜€¡ÑåÁ•½˜Ù…±Õ”€ôôô€ÍÑÉ¥¹œœ¤ì(€€€€€ÑÉäì(€€€€€€€É•ÑÕÉ¸)M=8¹Á…ÉÍ”¡Ù…±Õ”¤…ÌI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸øì(€€€€€ô…Ñ ì(€€€€€€€É•ÑÕÉ¸íôì(€€€€€ô(€€€ô(€€€¥˜€¡ÑåÁ•½˜Ù…±Õ”€ôôô€½‰©•Ðœ¤É•ÑÕÉ¸Ù…±Õ”…ÌI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸øì(€€€É•ÑÕÉ¸íôì(€ô((€ÁÉ¥Ù…Ñ”±½Q…‰±•½È¡¡…¹¹•°èÍÑÉ¥¹œ¤ì(€€€½¹ÍÐ­•ä€ô¡…¹¹•°¹Ñ½UÁÁ•É…Í” ¤ì(€€€¥˜€¡­•ä€ôôô€5%0œ¤É•ÑÕÉ¸€•µ…¥±}±½Ìœì(€€€¥˜€¡­•ä€ôôô€M5Lœ¤É•ÑÕÉ¸€ÍµÍ}±½Ìœì(€€€¥˜€¡­•ä€ôôô€]!QMA@œ¤É•ÑÕÉ¸€Ý¡…ÑÍ…ÁÁ}±½Ìœì(€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ …¹…°¹½¸ÍÕÁÁ½ÉÑ”œ¤ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ…Ñ¥Ù•Q•µÁ±…Ñ”¡½‘”èÍÑÉ¥¹œ°¡…¹¹•°èÍÑÉ¥¹œ¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1P€¨I=4µ•ÍÍ…•}Ñ•µÁ±…Ñ•Ì(€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Ä9‘•±•Ñ•‘}…Ð%L9U109ÍÑ…ÑÕÌ€ô€Q%Yœ9½‘”€ô€È9¡…¹¹•°€ô€Í€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°½‘”°¡…¹¹•°¹Ñ½UÁÁ•É…Í” ¥t°(€€€€¤ì(€€€É•ÑÕÉ¸É•ÅÕ¥É•I½Ü¡É½ÝÍlÁt°€5•ÍÍ…”Ñ•µÁ±…Ñ”œ¤ì(€ô((€ÁÉ¥Ù…Ñ”É•¹‘•ÉQ•µÁ±…Ñ”¡Ñ•µÁ±…Ñ”èÍÑÉ¥¹œ°Ù…É¥…‰±•ÌèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø¤ì(€€€É•ÑÕÉ¸Ñ•µÁ±…Ñ”¹É•Á±…” ½qíqíqÌ¨¡m„µéµhÀ´å}t¬¥qÌ©qõqô½œ°€¡|°­•ä¤€ôøMÑÉ¥¹œ¡Ù…É¥…‰±•Ím­•åt€üü€œœ¤¤ì(€ô((€ÁÉ¥Ù…Ñ”¹½Éµ…±¥é•1•…Í•A…å±½…¡‰½‘äèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø°½ÁÑ¥½¹ÌüèìÉ•ÅÕ¥É•	ÕÍ¥¹•ÍÍÑ¥Ù¥Ñäüè‰½½±•…¸ì™½É•%¹¥Ñ¥…±Õ…É…¹Ñ••U¹Á…¥üè‰½½±•…¸ô¤ì(€€€½¹ÍÐÑ•¹…¹Ñ%€ô9Õµ‰•È¡‰½‘ä¹Ñ•¹…¹Ñ}¥€üü‰½‘ä¹Ñ•¹…¹Ñ%€üü€À¤ì(€€€½¹ÍÐÕ¹¥Ñ%€ô9Õµ‰•È¡‰½‘ä¹Õ¹¥Ñ}¥€üü‰½‘ä¹Õ¹¥Ñ%€üü€À¤ì(€€€½¹ÍÐÍÑ…ÉÑ…Ñ”€ôÑ¡¥Ì¹¹½Éµ…±¥é•1•…Í•A…å±½…‘…Ñ”¡‰½‘ä¹ÍÑ…ÉÑ}‘…Ñ”°€ÍÑ…ÉÑ}‘…Ñ”œ°ÑÉÕ”¤ì(€€€½¹ÍÐ•¹‘…Ñ•Y…±Õ”€ôÑ¡¥Ì¹¹½Éµ…±¥é•1•…Í•A…å±½…‘…Ñ”¡‰½‘ä¹•¹‘}‘…Ñ”°€•¹‘}‘…Ñ”œ¤ì(€€€¥˜€ …Ñ•¹…¹Ñ%¤Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1½…Ñ…¥É”É•ÅÕ¥Ìœ¤ì(€€€¥˜€ …Õ¹¥Ñ%¤Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ U¹¥Ñ”É•ÅÕ¥Í”œ¤ì(€€€¥˜€ …ÍÑ…ÉÑ…Ñ”¤Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ …Ñ”‘”‘•‰ÕÐÉ•ÅÕ¥Í”œ¤ì((€€€½¹ÍÐµ½¹Ñ¡±åI•¹Ð€ô9Õµ‰•È¡‰½‘ä¹µ½¹Ñ¡±å}É•¹Ð€üü€À¤ì(€€€½¹ÍÐµ…¥¹Ñ•¹…¹•••µ½Õ¹Ð€ô9Õµ‰•È¡‰½‘ä¹µ…¥¹Ñ•¹…¹•}™••}…µ½Õ¹Ð€üü€À¤ì(€€€½¹ÍÐµ½¹Ñ¡±åMå¹‘¥µ½Õ¹Ð€ô9Õµ‰•È¡‰½‘ä¹µ½¹Ñ¡±å}Íå¹‘¥}…µ½Õ¹Ð€üü€À¤ì(€€€½¹ÍÐ½Ñ¡•É¡…É•Íµ½Õ¹Ð€ô9Õµ‰•È¡‰½‘ä¹½Ñ¡•É}¡…É•Í}…µ½Õ¹Ð€üü€À¤ì(€€€½¹ÍÐÕ…É…¹Ñ••5½¹Ñ¡Ì€ô9Õµ‰•È¡‰½‘ä¹Õ…É…¹Ñ••}µ½¹Ñ¡Ì€üü€À¤ì(€€€½¹ÍÐÉ•¹ÑÕ…É…¹Ñ••	…Í•µ½Õ¹Ð€ôµ½¹Ñ¡±åI•¹Ð€¬µ…¥¹Ñ•¹…¹•••µ½Õ¹Ðì(€€€½¹ÍÐ±•…Í•Q½Ñ…±µ½Õ¹Ð€ôµ½¹Ñ¡±åI•¹Ð€¬µ…¥¹Ñ•¹…¹•••µ½Õ¹Ð€¬µ½¹Ñ¡±åMå¹‘¥µ½Õ¹Ð€¬½Ñ¡•É¡…É•Íµ½Õ¹Ðì(€€€½¹ÍÐÕ…É…¹Ñ••µ½Õ¹Ð€ôÉ•¹ÑÕ…É…¹Ñ••	…Í•µ½Õ¹Ð€¨Õ…É…¹Ñ••5½¹Ñ¡Ìì(€€€½¹ÍÐ™½É•%¹¥Ñ¥…±Õ…É…¹Ñ••U¹Á…¥€ô½ÁÑ¥½¹Ìü¹™½É•%¹¥Ñ¥…±Õ…É…¹Ñ••U¹Á…¥€ôôôÑÉÕ”ì(€€€½¹ÍÐÕ…É…¹Ñ••A…¥€ô™½É•%¹¥Ñ¥…±Õ…É…¹Ñ••U¹Á…¥€ü€À€è9Õµ‰•È¡‰½‘ä¹É•¹Ñ…±}Õ…É…¹Ñ••}Á…¥€üü‰½‘ä¹Õ…É…¹Ñ••}Á…¥€üü€À¤ì(€€€½¹ÍÐ±•…Í•UÍ…”€ôÑ¡¥Ì¹¹½Éµ…±¥é•1•…Í•UÍ…•½‘”¡‰½‘ä¹±•…Í•}ÕÍ…”¤ì(€€€½¹ÍÐ±•…Í•Ñ¥Ù¥Ñå•ÍÉ¥ÁÑ¥½¸€ô‰½‘ä¹±•…Í•}…Ñ¥Ù¥Ñå}‘•ÍÉ¥ÁÑ¥½¸€üMÑÉ¥¹œ¡‰½‘ä¹±•…Í•}…Ñ¥Ù¥Ñå}‘•ÍÉ¥ÁÑ¥½¸¤¹ÑÉ¥´ ¤€è¹Õ±°ì(€€€½¹ÍÐ½¹ÑÉ…Ñ9½Ñ”€ôÑ¡¥Ì¹¹½Éµ…±¥é•=ÁÑ¥½¹…±5Õ±Ñ¥±¥¹•Q•áÐ¡‰½‘ä¹½¹ÑÉ…Ñ}¹½Ñ”¤ì(€€€½¹ÍÐ‰¥±±¥¹É•ÅÕ•¹å5½¹Ñ¡Ì€ôÑ¡¥Ì¹¹½Éµ…±¥é•1•…Í•	¥±±¥¹É•ÅÕ•¹ä¡‰½‘ä¹‰¥±±¥¹}™É•ÅÕ•¹å}µ½¹Ñ¡Ì¤ì(€€€½¹ÍÐÕ…É…¹Ñ••A…åµ•¹Ñ…Ñ•Y…±Õ”€ô™½É•%¹¥Ñ¥…±Õ…É…¹Ñ••U¹Á…¥(€€€€€€ü¹Õ±°(€€€€€€èÑ¡¥Ì¹¹½Éµ…±¥é•1•…Í•A…å±½…‘…Ñ”¡‰½‘ä¹É•¹Ñ…±}Õ…É…¹Ñ••}Á…åµ•¹Ñ}‘…Ñ”€üü‰½‘ä¹Õ…É…¹Ñ••}Á…åµ•¹Ñ}‘…Ñ”°€É•¹Ñ…±}Õ…É…¹Ñ••}Á…åµ•¹Ñ}‘…Ñ”œ¤ì(€€€½¹ÍÐÉ…ÝÕ…É…¹Ñ••MÑ…ÑÕÌ€ô™½É•%¹¥Ñ¥…±Õ…É…¹Ñ••U¹Á…¥€ü€9=Q}A%œ€èMÑÉ¥¹œ¡‰½‘ä¹É•¹Ñ…±}Õ…É…¹Ñ••}ÍÑ…ÑÕÌ€üü‰½‘ä¹Õ…É…¹Ñ••}ÍÑ…ÑÕÌ€üü€œœ¤¹ÑÉ¥´ ¤¹Ñ½UÁÁ•É…Í” ¤ì(€€€½¹ÍÐÕ…É…¹Ñ••5…É­•‘A…¥€ôÉ…ÝÕ…É…¹Ñ••MÑ…ÑÕÌ€ôôô€A%œñðÕ…É…¹Ñ••A…¥€ø€Àì((€€€½¹ÍÐÉ•ÅÕ¥É•	ÕÍ¥¹•ÍÍÑ¥Ù¥Ñä€ô½ÁÑ¥½¹Ìü¹É•ÅÕ¥É•	ÕÍ¥¹•ÍÍÑ¥Ù¥Ñä€üüÑÉÕ”ì(€€€¥˜€¡É•ÅÕ¥É•	ÕÍ¥¹•ÍÍÑ¥Ù¥Ñä€˜˜€¡±•…Í•UÍ…”€ôôô€=55I%0œñð±•…Í•UÍ…”€ôôô€AI=MM%=90œñð±•…Í•UÍ…”€ôôô€5%aœ¤€˜˜€…±•…Í•Ñ¥Ù¥Ñå•ÍÉ¥ÁÑ¥½¸¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ ‰Ñ¥Ù¥Ñ”½Ô‘•ÍÑ¥¹…Ñ¥½¸‘•Ì±¥•ÕàÉ•ÅÕ¥Í”ˆ¤ì(€€€ô((€€€¥˜€¡Õ…É…¹Ñ••5…É­•‘A…¥€˜˜€…Õ…É…¹Ñ••A…åµ•¹Ñ…Ñ•Y…±Õ”¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ …Ñ”‘”Á…¥•µ•¹Ð‘”±„…É…¹Ñ¥”É•ÅÕ¥Í”œ¤ì(€€€ô((€€€½¹ÍÐÕ…É…¹Ñ••A…åµ•¹Ñ…Ñ”€ôÕ…É…¹Ñ••5…É­•‘A…¥€üÕ…É…¹Ñ••A…åµ•¹Ñ…Ñ•Y…±Õ”€è¹Õ±°ì(€€€½¹ÍÐÕ…É…¹Ñ••MÑ…ÑÕÌ€ôÕ…É…¹Ñ••5…É­•‘A…¥(€€€€€€ü€¡Õ…É…¹Ñ••A…¥€øôÕ…É…¹Ñ••µ½Õ¹Ð€ü€A%œ€è€AIQ%0œ¤(€€€€€€è€9=Q}A%œì((€€€É•ÑÕÉ¸ì(€€€€€Ñ•¹…¹Ñ%°(€€€€€Õ¹¥Ñ%°(€€€€€ÍÑ…ÉÑ…Ñ”°(€€€€€•¹‘…Ñ”è•¹‘…Ñ•Y…±Õ”°(€€€€€µ½¹Ñ¡±åI•¹Ð°(€€€€€µ…¥¹Ñ•¹…¹•••µ½Õ¹Ð°(€€€€€µ½¹Ñ¡±åMå¹‘¥µ½Õ¹Ð°(€€€€€½Ñ¡•É¡…É•Íµ½Õ¹Ð°(€€€€€±•…Í•Q½Ñ…±µ½Õ¹Ð°(€€€€€Õ…É…¹Ñ••5½¹Ñ¡Ì°(€€€€€Õ…É…¹Ñ••µ½Õ¹Ð°(€€€€€Õ…É…¹Ñ••A…¥èÕ…É…¹Ñ••5…É­•‘A…¥€üÕ…É…¹Ñ••A…¥€è€À°(€€€€€Õ…É…¹Ñ••A…åµ•¹Ñ…Ñ”°(€€€€€Õ…É…¹Ñ••MÑ…ÑÕÌ°(€€€€€¹½Ñ¥•5½¹Ñ¡Ìè9Õµ‰•È¡‰½‘ä¹¹½Ñ¥•}µ½¹Ñ¡Ì€üü€À¤°(€€€€€Í¥¹…ÑÕÉ•A±…”è‰½‘ä¹Í¥¹…ÑÕÉ•}Á±…”€üMÑÉ¥¹œ¡‰½‘ä¹Í¥¹…ÑÕÉ•}Á±…”¤¹ÑÉ¥´ ¤€è¹Õ±°°(€€€€€Í¥¹…ÑÕÉ•…Ñ”èÑ¡¥Ì¹¹½Éµ…±¥é•1•…Í•A…å±½…‘…Ñ”¡‰½‘ä¹Í¥¹…ÑÕÉ•}‘…Ñ”°€Í¥¹…ÑÕÉ•}‘…Ñ”œ¤°(€€€€€±•…Í•UÍ…”°(€€€€€±•…Í•Ñ¥Ù¥Ñå•ÍÉ¥ÁÑ¥½¸°(€€€€€½¹ÑÉ…ÑQ•µÁ±…Ñ•½‘”èÑ¡¥Ì¹É•Í½±Ù•1•…Í•Q•µÁ±…Ñ•½‘•½ÉA•ÉÍ¥ÍÑ•¹”¡±•…Í•UÍ…”°‰½‘ä¹½¹ÑÉ…Ñ}Ñ•µÁ±…Ñ•}½‘”¤°(€€€€€½¹ÑÉ…Ñ¥±•9…µ”è‰½‘ä¹½¹ÑÉ…Ñ}™¥±•}¹…µ”€üMÑÉ¥¹œ¡‰½‘ä¹½¹ÑÉ…Ñ}™¥±•}¹…µ”¤¹ÑÉ¥´ ¤€è¹Õ±°°(€€€€€½¹ÑÉ…Ñ¥±•UÉ°è‰½‘ä¹½¹ÑÉ…Ñ}™¥±•}ÕÉ°€üMÑÉ¥¹œ¡‰½‘ä¹½¹ÑÉ…Ñ}™¥±•}ÕÉ°¤¹ÑÉ¥´ ¤€è¹Õ±°°(€€€€€¹½Ñ•Ìè‰½‘ä¹¹½Ñ•Ì€üMÑÉ¥¹œ¡‰½‘ä¹¹½Ñ•Ì¤€è¹Õ±°°(€€€€€½¹ÑÉ…Ñ9½Ñ”°(€€€€€‰¥±±¥¹É•ÅÕ•¹å5½¹Ñ¡Ì°(€€€€€ÍÑ…ÑÕÌèMÑÉ¥¹œ¡‰½‘ä¹ÍÑ…ÑÕÌ€üü€IPœ¤°(€€€ôì(€ô((€ÁÉ¥Ù…Ñ”¹½Éµ…±¥é•1•…Í•	¥±±¥¹É•ÅÕ•¹ä¡Ù…±Õ”èÕ¹­¹½Ý¸¤ì(€€€½¹ÍÐÉ…Ü€ôÙ…±Õ”€ôôôÕ¹‘•™¥¹•ñðÙ…±Õ”€ôôô¹Õ±°ñðÙ…±Õ”€ôôô€œœ€ü€Ä€è9Õµ‰•È¡Ù…±Õ”¤ì(€€€¥˜€ …9Õµ‰•È¹¥Í%¹Ñ••È¡É…Ü¤ñðÉ…Ü€ð€ÄñðÉ…Ü€ø€ÄÈ¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ A•É¥½‘¥¥Ñ”‘”Á…¥•µ•¹Ð‘Ô±½å•È¥¹Ù…±¥‘”œ¤ì(€€€ô(€€€É•ÑÕÉ¸É…Üì(€ô((€ÁÉ¥Ù…Ñ”¹½Éµ…±¥é•=ÁÑ¥½¹…±5Õ±Ñ¥±¥¹•Q•áÐ¡Ù…±Õ”èÕ¹­¹½Ý¸¤ì(€€€¥˜€¡Ù…±Õ”€ôôôÕ¹‘•™¥¹•ñðÙ…±Õ”€ôôô¹Õ±°¤É•ÑÕÉ¸¹Õ±°ì(€€€½¹ÍÐ¹½Éµ…±¥é•€ôMÑÉ¥¹œ¡Ù…±Õ”¤¹É•Á±…” ½qÉq¸½œ°€q¸œ¤¹É•Á±…” ½qÈ½œ°€q¸œ¤¹ÑÉ¥´ ¤ì(€€€É•ÑÕÉ¸¹½Éµ…±¥é•€ü¹½Éµ…±¥é•€è¹Õ±°ì(€ô((€ÁÉ¥Ù…Ñ”¹½Éµ…±¥é•1•…Í•A…å±½…‘…Ñ”¡Ù…±Õ”èÕ¹­¹½Ý¸°™¥•±‘9…µ”èÍÑÉ¥¹œ°É•ÅÕ¥É•€ô™…±Í”¤ì(€€€¥˜€¡Ù…±Õ”€ôôôÕ¹‘•™¥¹•ñðÙ…±Õ”€ôôô¹Õ±°ñðÙ…±Õ”€ôôô€œœ¤ì(€€€€€¥˜€¡É•ÅÕ¥É•¤Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸¡…Ñ”É•ÅÕ¥Í”Á½ÕÈ€‘í™¥•±‘9…µ•õ€¤ì(€€€€€É•ÑÕÉ¸¹Õ±°ì(€€€ô((€€€¥˜€¡Ù…±Õ”¥¹ÍÑ…¹•½˜…Ñ”¤ì(€€€€€¥˜€¡9Õµ‰•È¹¥Í9…8¡Ù…±Õ”¹•ÑQ¥µ” ¤¤¤ì(€€€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸¡…Ñ”¥¹Ù…±¥‘”Á½ÕÈ€‘í™¥•±‘9…µ•õ€¤ì(€€€€€ô(€€€€€É•ÑÕÉ¸Ù…±Õ”¹Ñ½%M=MÑÉ¥¹œ ¤¹Í±¥” À°€ÄÀ¤ì(€€€ô((€€€½¹ÍÐÉ…Ü€ôMÑÉ¥¹œ¡Ù…±Õ”¤¹ÑÉ¥´ ¤ì(€€€¥˜€ …É…Ü¤ì(€€€€€¥˜€¡É•ÅÕ¥É•¤Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸¡…Ñ”É•ÅÕ¥Í”Á½ÕÈ€‘í™¥•±‘9…µ•õ€¤ì(€€€€€É•ÑÕÉ¸¹Õ±°ì(€€€ô((€€€½¹ÍÐ¥Í½…Ñ”€ô€½yq‘ìÑôµq‘ìÉôµq‘ìÉô¼¹•á•Œ¡É…Ü¤ü¹lÁtì(€€€¥˜€¡¥Í½…Ñ”¤É•ÑÕÉ¸¥Í½…Ñ”ì((€€€½¹ÍÐÁ…ÉÍ•€ô¹•Ü…Ñ”¡É…Ü¤ì(€€€¥˜€¡9Õµ‰•È¹¥Í9…8¡Á…ÉÍ•¹•ÑQ¥µ” ¤¤¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸¡…Ñ”¥¹Ù…±¥‘”Á½ÕÈ€‘í™¥•±‘9…µ•õ€¤ì(€€€ô((€€€É•ÑÕÉ¸Á…ÉÍ•¹Ñ½%M=MÑÉ¥¹œ ¤¹Í±¥” À°€ÄÀ¤ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ…Ñ¥Ù•1•…Í•½¹ÑÉ…ÑQ•µÁ±…Ñ”¡±¥•¹ÐèA½½±±¥•¹Ð°½‘”èÍÑÉ¥¹œ¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P€¨(€€€€€€I=4±•…Í•}½¹ÑÉ…Ñ}Ñ•µÁ±…Ñ•Ì(€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€9½‘”€ô€È(€€€€€€€€9¥Í}…Ñ¥Ù”€ôQIU(€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U10(€€€€€€=IH	dÙ•ÉÍ¥½¸M°¥M(€€€€€€1%5%P€Å€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°½‘•t°(€€€€¤ì(€€€¥˜€ …É½ÝÍlÁt¤ì(€€€ÍÝ¥Ñ €¡MÑÉ¥¹œ¡½‘”¤¹ÑÉ¥´ ¤¹Ñ½UÁÁ•É…Í” ¤¤ì(€€€€€€€…Í”€1M}=55I%0œè(€€€€€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ ‰1”µ½“¡±”‘”½¹ÑÉ…Ð½µµ•É¥…°¸•ÍÐÁ…Ì½¹™¥ÕË¤Á½ÕÈ•ÑÑ”½É…¹¥Í…Ñ¥½¸¸ˆ¤ì(€€€€€€€…Í”€1M}AI=MM%=90œè(€€€€€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ ‰1”µ½“¡±”‘”½¹ÑÉ…ÐÁÉ½™•ÍÍ¥½¹¹•°¸•ÍÐÁ…Ì½¹™¥ÕË¤Á½ÕÈ•ÑÑ”½É…¹¥Í…Ñ¥½¸¸ˆ¤ì(€€€€€€€…Í”€1M}5%aœè(€€€€€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ ‰1”µ½“¡±”‘”½¹ÑÉ…Ðµ¥áÑ”¸•ÍÐÁ…Ì½¹™¥ÕË¤Á½ÕÈ•ÑÑ”½É…¹¥Í…Ñ¥½¸¸ˆ¤ì(€€€€€€€…Í”€1M}IM%9Q%0œè(€€€€€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ ‰1”µ½“¡±”‘”½¹ÑÉ…ÐË¥Í¥‘•¹Ñ¥•°¸•ÍÐÁ…Ì½¹™¥ÕË¤Á½ÕÈ•ÑÑ”½É…¹¥Í…Ñ¥½¸¸ˆ¤ì(€€€€€€€‘•™…Õ±Ðè(€€€€€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸¡ÕÕ¸µ½‘•±”‘”½¹ÑÉ…Ð…Ñ¥˜€‘í½‘•ô¸•ÍÐ½¹™¥ÕÉ”Á½ÕÈ°½É…¹¥Í…Ñ¥½¸€‘íÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥ô¹€¤ì(€€€€€ô(€€€ô(€€€É•ÑÕÉ¸É½ÝÍlÁtì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ…Ñ¥Ù•1•…Í•½¹ÑÉ…ÑQ•µÁ±…Ñ•Y•ÉÍ¥½¸¡½‘”èÍÑÉ¥¹œ¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1PÙ•ÉÍ¥½¸(€€€€€€I=4±•…Í•}½¹ÑÉ…Ñ}Ñ•µÁ±…Ñ•Ì(€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€9½‘”€ô€È(€€€€€€€€9¥Í}…Ñ¥Ù”€ôQIU(€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U10(€€€€€€=IH	dÙ•ÉÍ¥½¸M°¥M(€€€€€€1%5%P€Å€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°½‘•t°(€€€€¤ì(€€€É•ÑÕÉ¸É½ÝÍlÁtü¹Ù•ÉÍ¥½¸€üü¹Õ±°ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÑ…‰±•!…Í½±Õµ¸¡±¥•¹ÐèA½½±±¥•¹Ð°Ñ…‰±•9…µ”èÍÑÉ¥¹œ°½±Õµ¹9…µ”èÍÑÉ¥¹œ¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P€Ä(€€€€€€I=4¥¹™½Éµ…Ñ¥½¹}Í¡•µ„¹½±Õµ¹Ì(€€€€€€]!IÑ…‰±•}Í¡•µ„€ô€ÁÕ‰±¥Œœ(€€€€€€€€9Ñ…‰±•}¹…µ”€ô€Ä(€€€€€€€€9½±Õµ¹}¹…µ”€ô€È(€€€€€€1%5%P€Å€°(€€€€€mÑ…‰±•9…µ”°½±Õµ¹9…µ•t°(€€€€¤ì(€€€É•ÑÕÉ¸	½½±•…¸¡É½ÝÍlÁt¤ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÑ…‰±•á¥ÍÑÌ¡Ñ…‰±•9…µ”èÍÑÉ¥¹œ¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1P€Ä(€€€€€€I=4¥¹™½Éµ…Ñ¥½¹}Í¡•µ„¹Ñ…‰±•Ì(€€€€€€]!IÑ…‰±•}Í¡•µ„€ô€ÁÕ‰±¥Œœ(€€€€€€€€9Ñ…‰±•}¹…µ”€ô€Ä(€€€€€€1%5%P€Å€°(€€€€€mÑ…‰±•9…µ•t°(€€€€¤ì(€€€É•ÑÕÉ¸	½½±•…¸¡É½ÝÍlÁt¤ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ½±Õµ¹á¥ÍÑÌ¡Ñ…‰±•9…µ”èÍÑÉ¥¹œ°½±Õµ¹9…µ”èÍÑÉ¥¹œ¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1P€Ä(€€€€€€I=4¥¹™½Éµ…Ñ¥½¹}Í¡•µ„¹½±Õµ¹Ì(€€€€€€]!IÑ…‰±•}Í¡•µ„€ô€ÁÕ‰±¥Œœ(€€€€€€€€9Ñ…‰±•}¹…µ”€ô€Ä(€€€€€€€€9½±Õµ¹}¹…µ”€ô€È(€€€€€€1%5%P€Å€°(€€€€€mÑ…‰±•9…µ”°½±Õµ¹9…µ•t°(€€€€¤ì(€€€É•ÑÕÉ¸	½½±•…¸¡É½ÝÍlÁt¤ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ½ÁÑ¥½¹…±½±Õµ¹áÁÉ•ÍÍ¥½¸¡Ñ…‰±•9…µ”èÍÑÉ¥¹œ°½±Õµ¹9…µ”èÍÑÉ¥¹œ°…±¥…ÌèÍÑÉ¥¹œ¤ì(€€€É•ÑÕÉ¸€¡…Ý…¥ÐÑ¡¥Ì¹½±Õµ¹á¥ÍÑÌ¡Ñ…‰±•9…µ”°½±Õµ¹9…µ”¤¤€ü€‘í…±¥…Íô¸‘í½±Õµ¹9…µ•õ€€è€9U10œì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ½ÁÑ¥½¹…±½±Õµ¹M•±•ÑÌ¡Ñ…‰±•9…µ”èÍÑÉ¥¹œ°½±Õµ¹9…µ•ÌèÍÑÉ¥¹mt°…±¥…ÌèÍÑÉ¥¹œ¤ì(€€€½¹ÍÐ•¹ÑÉ¥•Ì€ô…Ý…¥ÐAÉ½µ¥Í”¹…±°¡½±Õµ¹9…µ•Ì¹µ…À¡…Íå¹Œ€¡½±Õµ¹9…µ”¤€ôøl(€€€€€½±Õµ¹9…µ”°(€€€€€€¡…Ý…¥ÐÑ¡¥Ì¹½±Õµ¹á¥ÍÑÌ¡Ñ…‰±•9…µ”°½±Õµ¹9…µ”¤¤€ü€‘í…±¥…Íô¸‘í½±Õµ¹9…µ•ôL€‘í½±Õµ¹9…µ•õ€€è9U10L€‘í½±Õµ¹9…µ•õ€°(€€€t…Ì½¹ÍÐ¤¤ì(€€€É•ÑÕÉ¸=‰©•Ð¹™É½µ¹ÑÉ¥•Ì¡•¹ÑÉ¥•Ì¤…ÌI•½ÉñÍÑÉ¥¹œ°ÍÑÉ¥¹œøì(€ô((€ÁÉ¥Ù…Ñ”É•Í½±Ù•1•…Í•Q•µÁ±…Ñ•½‘•½ÉUÍ…”¡Ù…±Õ”èÕ¹­¹½Ý¸¤ì(€€€ÍÝ¥Ñ €¡Ñ¡¥Ì¹¹½Éµ…±¥é•1•…Í•UÍ…•½‘”¡Ù…±Õ”¤¤ì(€€€€€…Í”€=55I%0œè(€€€€€€€É•ÑÕÉ¸€1M}=55I%0œì(€€€€€…Í”€AI=MM%=90œè(€€€€€€€É•ÑÕÉ¸€1M}AI=MM%=90œì(€€€€€…Í”€5%aœè(€€€€€€€É•ÑÕÉ¸€1M}5%aœì(€€€€€…Í”€IM%9Q%0œè(€€€€€‘•™…Õ±Ðè(€€€€€€€É•ÑÕÉ¸€1M}IM%9Q%0œì(€€€ô(€ô((€ÁÉ¥Ù…Ñ”É•Í½±Ù•1•…Í•Q•µÁ±…Ñ•½‘•½ÉA•ÉÍ¥ÍÑ•¹”¡ÕÍ…”èÍÑÉ¥¹œ°•áÁ±¥¥ÑY…±Õ”èÕ¹­¹½Ý¸¤ì(€€€½¹ÍÐµ…ÁÁ•‘½‘”€ôÑ¡¥Ì¹É•Í½±Ù•1•…Í•Q•µÁ±…Ñ•½‘•½ÉUÍ…”¡ÕÍ…”¤ì(€€€¥˜€¡µ…ÁÁ•‘½‘”¤É•ÑÕÉ¸µ…ÁÁ•‘½‘”ì(€€€½¹ÍÐ•áÁ±¥¥Ñ½‘”€ô•áÁ±¥¥ÑY…±Õ”€üMÑÉ¥¹œ¡•áÁ±¥¥ÑY…±Õ”¤¹ÑÉ¥´ ¤€è€œœì(€€€É•ÑÕÉ¸•áÁ±¥¥Ñ½‘”ñð¹Õ±°ì(€ô((€ÁÉ¥Ù…Ñ”µ¥ÍÍ¥¹1•…Í•Q•µÁ±…Ñ•5•ÍÍ…”¡ÕÍ…”èÕ¹­¹½Ý¸¤ì(€€€ÍÝ¥Ñ €¡Ñ¡¥Ì¹¹½Éµ…±¥é•1•…Í•UÍ…•½‘”¡ÕÍ…”¤¤ì(€€€€€…Í”€=55I%0œè(€€€€€€€É•ÑÕÉ¸€‰1”µ½“¡±”‘”½¹ÑÉ…Ð½µµ•É¥…°¸•ÍÐÁ…Ì½¹™¥ÕË¤Á½ÕÈ•ÑÑ”½É…¹¥Í…Ñ¥½¸¸ˆì(€€€€€…Í”€AI=MM%=90œè(€€€€€€€É•ÑÕÉ¸€‰1”µ½“¡±”‘”½¹ÑÉ…ÐÁÉ½™•ÍÍ¥½¹¹•°¸•ÍÐÁ…Ì½¹™¥ÕË¤Á½ÕÈ•ÑÑ”½É…¹¥Í…Ñ¥½¸¸ˆì(€€€€€…Í”€5%aœè(€€€€€€€É•ÑÕÉ¸€‰ÕÕ¸µ½“¡±”‘”½¹ÑÉ…Ðµ¥áÑ”¸•ÍÐ•¹½É”½¹™¥ÕË¤Á½ÕÈ•ÑÑ”½É…¹¥Í…Ñ¥½¸¸ˆì(€€€€€…Í”€IM%9Q%0œè(€€€€€‘•™…Õ±Ðè(€€€€€€€É•ÑÕÉ¸€‰1”µ½“¡±”‘”½¹ÑÉ…ÐË¥Í¥‘•¹Ñ¥•°¸•ÍÐÁ…Ì½¹™¥ÕË¤Á½ÕÈ•ÑÑ”½É…¹¥Í…Ñ¥½¸¸ˆì(€€€ô(€ô((€ÁÉ¥Ù…Ñ”±•…Í•A‘™Xå¹…‰±• ¤ì(€€€É•ÑÕÉ¸MÑÉ¥¹œ¡ÁÉ½•ÍÌ¹•¹Ø¹1M}A}Xå}9	1€üü€ÑÉÕ”œ¤¹ÑÉ¥´ ¤¹Ñ½1½Ý•É…Í” ¤€„ôô€™…±Í”œì(€ô((€ÁÉ¥Ù…Ñ”±½1•…Í•A‘™Xä¡ÍÑ•ÀèÍÑÉ¥¹œ°Á…å±½…èI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø¤ì(€€€Ñ¡¥Ì¹±½•È¹±½œ¡m1M}A}Xåt€‘íÍÑ•Áô€‘í)M=8¹ÍÑÉ¥¹¥™ä¡Á…å±½…¥õ€¤ì(€ô((€ÁÉ¥Ù…Ñ”µ…Á1•…Í•A‘™XåÉÉ½È¡•ÉÉ½Èè…¹ä¤ì(€€€¥˜€¡•ÉÉ½È¥¹ÍÑ…¹•½˜!ÑÑÁá•ÁÑ¥½¸¤ì(€€€€€É•ÑÕÉ¸•ÉÉ½Èì(€€€ô(€€€½¹ÍÐÁ•ÉÍ¥ÍÑÉÉ½È€ô¹•Ü%¹Ñ•É¹…±M•ÉÙ•ÉÉÉ½Éá•ÁÑ¥½¸¡ì(€€€€€½‘”è€A}9IQ%=9}AIM%MQ}%1œ°(€€€€€µ•ÍÍ…”è•ÉÉ½Èü¹µ•ÍÍ…”ñð€1•…Í”A•¹•É…Ñ¥½¸™…¥±•œ°(€€€ô¤ì(€€€€¡Á•ÉÍ¥ÍÑÉÉ½È…Ì…¹ä¤¹…ÕÍ”€ô•ÉÉ½Èì(€€€É•ÑÕÉ¸Á•ÉÍ¥ÍÑÉÉ½Èì(€ô((€ÁÉ¥Ù…Ñ”‰Õ¥±‘1•…Í•½¹ÑÉ…ÑM¹…ÁÍ¡½Ð¡±•…Í”èI•½ÉñÍÑÉ¥¹œ°…¹äø°½µÁ…¹äèI•½ÉñÍÑÉ¥¹œ°…¹äø°•¹•É…Ñ•‘Ð€ô¹•Ü…Ñ” ¤¤ì(€€€½¹ÍÐÑ½Ñ…±5½¹Ñ¡±ä€ô9Õµ‰•È¡±•…Í”¹±•…Í•}Ñ½Ñ…±}…µ½Õ¹Ð€üü€À¤ì(€€€½¹ÍÐÕ…É…¹Ñ••5½¹Ñ¡Ì€ô9Õµ‰•È¡±•…Í”¹Õ…É…¹Ñ••}µ½¹Ñ¡Ì€üü½µÁ…¹ä¹‘•™…Õ±Ñ}Õ…É…¹Ñ••}µ½¹Ñ¡Ì€üü€À¤ì(€€€½¹ÍÐÕ…É…¹Ñ••µ½Õ¹Ð€ô9Õµ‰•È¡±•…Í”¹É•¹Ñ…±}Õ…É…¹Ñ••}…µ½Õ¹Ð€üü±•…Í”¹Õ…É…¹Ñ•”ü¹…µ½Õ¹Ð€üü€À¤ì(€€€½¹ÍÐÉ•¹Ñµ½Õ¹Ð€ô9Õµ‰•È¡±•…Í”¹µ½¹Ñ¡±å}É•¹Ð€üü€À¤ì(€€€½¹ÍÐµ…¥¹Ñ•¹…¹•••µ½Õ¹Ð€ô9Õµ‰•È¡±•…Í”¹µ…¥¹Ñ•¹…¹•}™••}…µ½Õ¹Ð€üü€À¤ì(€€€½¹ÍÐ½¹ÑÉ…Ñ9½Ñ”€ôÑ¡¥Ì¹¹½Éµ…±¥é•=ÁÑ¥½¹…±5Õ±Ñ¥±¥¹•Q•áÐ¡±•…Í”¹½¹ÑÉ…Ñ}¹½Ñ”¤ì(€€€½¹ÍÐÕ…É…¹Ñ••	…Í•µ½Õ¹Ð€ôÉ•¹Ñµ½Õ¹Ð€¬µ…¥¹Ñ•¹…¹•••µ½Õ¹Ðì(€€€½¹ÍÐ‘ÕÉ…Ñ¥½¹5½¹Ñ¡Ì€ôÑ¡¥Ì¹±•…Í•ÕÉ…Ñ¥½¹5½¹Ñ¡Ì¡±•…Í”¹ÍÑ…ÉÑ}‘…Ñ”°±•…Í”¹•¹‘}‘…Ñ”¤ñð9Õµ‰•È¡½µÁ…¹ä¹‘•™…Õ±Ñ}±•…Í•}‘ÕÉ…Ñ¥½¹}µ½¹Ñ¡Ì€üü€À¤ì(€€€½¹ÍÐÕÍ…•½‘”€ôÑ¡¥Ì¹¹½Éµ…±¥é•1•…Í•UÍ…•½‘”¡±•…Í”¹±•…Í•}ÕÍ…”€üü½µÁ…¹ä¹‘•™…Õ±Ñ}±•…Í•}ÕÍ…”€üü±•…Í”¹ÕÍ…•}ÑåÁ”¤ì(€€€½¹ÍÐÕÍ…•1…‰•°€ôÑ¡¥Ì¹±•…Í•UÍ…•1…‰•°¡ÕÍ…•½‘”¤ì(€€€½¹ÍÐ…Ñ¥Ù¥Ñå•ÍÉ¥ÁÑ¥½¸€ôMÑÉ¥¹œ¡±•…Í”¹±•…Í•}…Ñ¥Ù¥Ñå}‘•ÍÉ¥ÁÑ¥½¸€üü€œœ¤¹ÑÉ¥´ ¤ì(€€€½¹ÍÐ‘•ÍÑ¥¹…Ñ¥½¹A¡É…Í”€ô…Ñ¥Ù¥Ñå•ÍÉ¥ÁÑ¥½¸(€€€€€€ü1•Ì±¥•Õà±½×¥ÌÍ½¹Ð•á±ÕÍ¥Ù•µ•¹Ð‘•ÍÑ¥»¥Ìƒ€°•á•É¥”‘”€‘íÕÍ…•½‘”€ôôô€=55I%0œ€ü€‰°…Ñ¥Ù¥Ó¤½µµ•É¥…±”ˆ€èÕÍ…•½‘”€ôôô€AI=MM%=90œ€ü€‰°…Ñ¥Ù¥Ó¤ÁÉ½™•ÍÍ¥½¹¹•±±”ˆ€èÕÍ…•½‘”€ôôô€5%aœ€ü€‰°…Ñ¥Ù¥Ó¤µ¥áÑ”ˆ€è€‰°ÕÍ…”‰ô“¥±…Ë¥”Á…È±”AÉ•¹•ÕÈ€è€‘í…Ñ¥Ù¥Ñå•ÍÉ¥ÁÑ¥½¹ô¹€(€€€€€€è1•Ì±¥•Õà±½×¥ÌÍ½¹Ð‘•ÍÑ¥»¥Ìƒ€Õ¸ÕÍ…”€‘íÕÍ…•1…‰•°¹Ñ½1½Ý•É…Í” ¥ô¹€ì(€€€½¹ÍÐ¥Í½µÁ…¹åQ•¹…¹Ð€ôMÑÉ¥¹œ¡±•…Í”¹Ñ•¹…¹Ñ}ÑåÁ”€üü€A!eM%0œ¤€ôôô€=5A9dœì(€€€½¹ÍÐ‰•‘É½½µ½Õ¹Ð€ô9Õµ‰•È¡±•…Í”¹‰•‘É½½µÍ}½Õ¹Ð€üü€À¤ì(€€€½¹ÍÐÁ…É­¥¹½Õ¹Ð€ô9Õµ‰•È¡±•…Í”¹Á…É­¥¹}ÍÁ…•Í}½Õ¹Ð€üü€¡±•…Í”¹¡…Í}Á…É­¥¹œ€ü€Ä€è€À¤¤ì(€€€½¹ÍÐ±•ÍÍ½É9…µ”€ô½µÁ…¹ä¹½µÁ…¹å}±•…±}¹…µ”€üü½µÁ…¹ä¹±•…±}¹…µ”€üü½µÁ…¹ä¹½µÁ…¹å}¹…µ”€üü€9AÉ½Á•ÉÑäI@œì(€€€½¹ÍÐÉ•ÁÉ•Í•¹Ñ…Ñ¥Ù•Õ±±9…µ”€ôm½µÁ…¹ä¹±•…±}É•ÁÉ•Í•¹Ñ…Ñ¥Ù•}¹…µ•t¹™¥±Ñ•È¡	½½±•…¸¤¹©½¥¸ œ€œ¤¹ÑÉ¥´ ¤ì(€€€½¹ÍÐÑ•¹…¹ÑI•ÁÉ•Í•¹Ñ…Ñ¥Ù”€ôl(€€€€€±•…Í”¹±•…±}É•ÁÉ•Í•¹Ñ…Ñ¥Ù•}¹…µ”°(€€€€€±•…Í”¹É•ÁÉ•Í•¹Ñ…Ñ¥Ù•}Á½ÍÑ}¹…µ”°(€€€€€±•…Í”¹É•ÁÉ•Í•¹Ñ…Ñ¥Ù•}™¥ÉÍÑ}¹…µ”°(€€€t¹™¥±Ñ•È¡	½½±•…¸¤¹©½¥¸ œ€œ¤¹ÑÉ¥´ ¤ì(€€€½¹ÍÐÑ•¹…¹ÑÕ±±9…µ”€ôm±•…Í”¹™¥ÉÍÑ}¹…µ”°±•…Í”¹±…ÍÑ}¹…µ”°±•…Í”¹Á½ÍÑ}¹…µ•t¹™¥±Ñ•È¡	½½±•…¸¤¹©½¥¸ œ€œ¤¹ÑÉ¥´ ¤ì(€€€½¹ÍÐ‰Õ¥±‘¥¹‘‘É•ÍÍA…ÉÑÌ€ôm±•…Í”¹‰Õ¥±‘¥¹}…‘‘É•ÍÌ°±•…Í”¹‰Õ¥±‘¥¹}½µµÕ¹”°±•…Í”¹‰Õ¥±‘¥¹}¹•¥¡‰½É¡½½°±•…Í”¹‰Õ¥±‘¥¹}¥Ñåt¹™¥±Ñ•È¡	½½±•…¸¤ì(€€€½¹ÍÐ½µÁ…¹å‘‘É•ÍÍA…ÉÑÌ€ôm½µÁ…¹ä¹½µÁ…¹å}…‘‘É•ÍÌ€üü½µÁ…¹ä¹…‘‘É•ÍÌ€üü€œœ°½µÁ…¹ä¹½µÁ…¹å}½µµÕ¹”€üü€œœ°½µÁ…¹ä¹½µÁ…¹å}¥Ñä€üü€œœ°½µÁ…¹ä¹½µÁ…¹å}½Õ¹ÑÉä€üü€œt¹™¥±Ñ•È¡	½½±•…¸¤ì(€€€½¹ÍÐÑ•¹…¹Ñ‘‘É•ÍÍA…ÉÑÌ€ôm±•…Í”¹Ñ•¹…¹Ñ}…‘‘É•ÍÌ€üü€œœ°±•…Í”¹Ñ•¹…¹Ñ}½µµÕ¹”€üü€œœ°±•…Í”¹Ñ•¹…¹Ñ}¥Ñä€üü€œœ°±•…Í”¹Ñ•¹…¹Ñ}½Õ¹ÑÉä€üü€œt¹™¥±Ñ•È¡	½½±•…¸¤ì(€€€½¹ÍÐÁ¡åÍ¥…±AÉ•Í•¹Ñ…Ñ¥½¸€ôl(€€€€€5½¹Í¥•ÕÈ½5…‘…µ”€‘íÑ•¹…¹ÑÕ±±9…µ”ñð±•…Í”¹Ñ•¹…¹Ñ}¹…µ•õ€°(€€€€€±•…Í”¹¥‘}‘½Õµ•¹Ñ}ÑåÁ”€üÑ¥ÑÕ±…¥É”‘”±„Á¥•”¥‘•¹Ñ¥Ñ”€‘í±•…Í”¹¥‘}‘½Õµ•¹Ñ}ÑåÁ•õ€€è¹Õ±°°(€€€€€±•…Í”¹¥‘}¹Õµ‰•È€ü¹Õµ•É¼€‘í±•…Í”¹¥‘}¹Õµ‰•Éõ€€è¹Õ±°°(€€€€€±•…Í”¹Ñ•¹…¹Ñ}…‘‘É•ÍÌ€ü‘½µ¥¥±¥”¡”¤„€‘í±•…Í”¹Ñ•¹…¹Ñ}…‘‘É•ÍÍõ€€è¹Õ±°°(€€€€€±•…Í”¹Ñ•¹…¹Ñ}½µµÕ¹”€ü½µµÕ¹”€‘í±•…Í”¹Ñ•¹…¹Ñ}½µµÕ¹•õ€€è¹Õ±°°(€€€€€±•…Í”¹Ñ•¹…¹Ñ}¥Ñä€üÙ¥±±”€‘í±•…Í”¹Ñ•¹…¹Ñ}¥Ñåõ€€è¹Õ±°°(€€€€€±•…Í”¹Ñ•¹…¹Ñ}½Õ¹ÑÉä€üÁ…åÌ€‘í±•…Í”¹Ñ•¹…¹Ñ}½Õ¹ÑÉåõ€€è¹Õ±°°(€€€t¹™¥±Ñ•È¡	½½±•…¸¤¹©½¥¸ œ°€œ¤ì(€€€½¹ÍÐ½µÁ…¹åAÉ•Í•¹Ñ…Ñ¥½¸€ôl(€€€€€€‘í±•…Í”¹½µÁ…¹å}¹…µ”ñð±•…Í”¹Ñ•¹…¹Ñ}¹…µ”ñð€œô°€‘í±•…Í”¹±•…±}™½É´ñð€œô€¼¥¹ÍÉ¥Ñ”…ÔI•¥ÍÑÉ”‘Ô½µµ•É”•Ð‘ÔË¥‘¥Ð5½‰¥±¥•È‘”±„Y¥±±”‘”-¥¹Í¡…Í„Í½ÕÌ±”¹Õ·¥É¼I4€è€‘í±•…Í”¹É´ñð€œô°…¥¹Í¤Å×Še…ÔI•¥ÍÑÉ”‘Ô5¥¹¥ÍÓ¡É”‘”³Še½¹½µ¥”9…Ñ¥½¹…±”Í½ÕÌ±”¹Õ·¥É¼%¸9…Ð¸€è€‘í±•…Í”¹¹…Ñ¥½¹…±}¥‘}¹Õµ‰•Èñð€œô°‘½¹Ð±”M§¡”Í½¥…°•ÍÐÍ¥Ì°€‘í±•…Í”¹Ñ•¹…¹Ñ}…‘‘É•ÍÌñð€œô‘…¹Ì±„½µµÕ¹”‘”€‘í±•…Í”¹Ñ•¹…¹Ñ}½µµÕ¹”ñð€œô°ƒ€€‘í±•…Í”¹Ñ•¹…¹Ñ}¥Ñäñð€œô•¸K¥ÁÕ‰±¥ÅÕ”¥µ½É…Ñ¥ÅÕ”‘Ô½¹¼¥¤É•ÁË¥Í•¹Ó¥”Á…È5½¹Í¥•ÕÈ€‘íÑ•¹…¹ÑI•ÁÉ•Í•¹Ñ…Ñ¥Ù”ñð€œôÍ½¸€‘í±•…Í”¹±•…±}É•ÁÉ•Í•¹Ñ…Ñ¥Ù•}É½±”ñð€œôí€°(€€€t¹™¥±Ñ•È¡	½½±•…¸¤¹©½¥¸ œ€œ¤ì(€€€½¹ÍÐ…Á…ÉÑµ•¹Ñ1…‰•°€ô±•…Í”¹¥Í}™ÕÉ¹¥Í¡•€ü€5•Õ‰³¤œ€è€9½¸5•Õ‰³¤œì(€€€½¹ÍÐÑ•¹…¹ÑA¡åÍ¥…±9½Ñ”€ô€œœì(€€€½¹ÍÐÍ¥¹…ÑÕÉ•…Ñ”€ô±•…Í”¹Í¥¹…ÑÕÉ•}‘…Ñ”(€€€€€€üÑ¡¥Ì¹™½Éµ…Ñ…Ñ”¡±•…Í”¹Í¥¹…ÑÕÉ•}‘…Ñ”¤(€€€€€€è™½Éµ…Ñ…Ñ•%¹Q¥µ•i½¹”¡•¹•É…Ñ•‘Ð°€™É¥„½-¥¹Í¡…Í„œ¤ì(€€€½¹ÍÐ±•…Í•MÑ…ÉÑ…Ñ”€ôÑ¡¥Ì¹™½Éµ…Ñ…Ñ”¡±•…Í”¹ÍÑ…ÉÑ}‘…Ñ”¤ì(€€€½¹ÍÐ±•…Í•¹‘…Ñ”€ôÑ¡¥Ì¹™½Éµ…Ñ…Ñ”¡±•…Í”¹•¹‘}‘…Ñ”¤ñðÑ¡¥Ì¹™½Éµ…Ñ…Ñ”¡¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤¹Í±¥” À°€ÄÀ¤¤ì(€€€½¹ÍÐ½Ñ¡•É¡…É•Íµ½Õ¹Ð€ô9Õµ‰•È¡±•…Í”¹½Ñ¡•É}¡…É•Í}…µ½Õ¹Ð€üü€À¤ì(€€€½¹ÍÐÉ•¹Ñ	É•…­‘½Ý¸€ôl(€€€€€É•¹Ñµ½Õ¹Ð€ø€À€üƒŠˆ€‘íÑ¡¥Ì¹™½Éµ…Ñ5½¹•ä¡É•¹Ñµ½Õ¹Ð¥ôUM±½å•È‘”‰…Í•€€è¹Õ±°°(€€€€€µ…¥¹Ñ•¹…¹•••µ½Õ¹Ð€ø€À€üƒŠˆ€‘íÑ¡¥Ì¹™½Éµ…Ñ5½¹•ä¡µ…¥¹Ñ•¹…¹•••µ½Õ¹Ð¥ôUM™É…¥Ì•¹ÑÉ•Ñ¥•¹€€è¹Õ±°°(€€€€€9Õµ‰•È¡±•…Í”¹µ½¹Ñ¡±å}Íå¹‘¥}…µ½Õ¹Ð€üü€À¤€ø€À€üƒŠˆ€‘íÑ¡¥Ì¹™½Éµ…Ñ5½¹•ä¡±•…Í”¹µ½¹Ñ¡±å}Íå¹‘¥}…µ½Õ¹Ð¥ôUMÍå¹‘¥€€è¹Õ±°°(€€€€€½Ñ¡•É¡…É•Íµ½Õ¹Ð€ø€À€üƒŠˆ€‘íÑ¡¥Ì¹™½Éµ…Ñ5½¹•ä¡½Ñ¡•É¡…É•Íµ½Õ¹Ð¥ôUM…ÕÑÉ•Ì¡…É•Í€€è¹Õ±°°(€€€t¹™¥±Ñ•È¡	½½±•…¸¤¹©½¥¸ q¸œ¤ì(€€€½¹ÍÐ±•…Í•ÕÉ…Ñ¥½¹Q•áÐ€ô‘ÕÉ…Ñ¥½¹5½¹Ñ¡Ì€ø€À€ü€‘í‘ÕÉ…Ñ¥½¹5½¹Ñ¡Íôµ½¥Í€€è€‘ÕÉ•”•¸½ÕÉÌœì(€€€½¹ÍÐ‰•‘É½½µ½Õ¹ÑQ•áÐ€ôÑ¡¥Ì¹™É•¹¡9Õµ‰•É]½É¡‰•‘É½½µ½Õ¹Ð¤ì(€€€½¹ÍÐµ½¹Ñ¡±åM•Ñ¥½¹1¥¹•Ì€ôl(€€€€€1”±½å•Èµ•¹ÍÕ•°‘Ô±½…°•ÍÐ½¹ÍÑ¥Ñ×¤‘”€‘íÑ¡¥Ì¹™½Éµ…Ñ5½¹•ä¡Ñ½Ñ…±5½¹Ñ¡±ä¥ôUM±”µ½¥Ì‘½¹Ð€é€°(€€€€€É•¹Ñµ½Õ¹Ð€ø€À€ü€‘íÑ¡¥Ì¹™½Éµ…Ñ5½¹•ä¡É•¹Ñµ½Õ¹Ð¥ôUM±½å•È‘”‰…Í•€€è¹Õ±°°(€€€€€µ…¥¹Ñ•¹…¹•••µ½Õ¹Ð€ø€À€ü€‘íÑ¡¥Ì¹™½Éµ…Ñ5½¹•ä¡µ…¥¹Ñ•¹…¹•••µ½Õ¹Ð¥ôUM™É…¥Ì•¹ÑÉ•Ñ¥•¹€€è¹Õ±°°(€€€€€9Õµ‰•È¡±•…Í”¹µ½¹Ñ¡±å}Íå¹‘¥}…µ½Õ¹Ð€üü€À¤€ø€À€ü€‘íÑ¡¥Ì¹™½Éµ…Ñ5½¹•ä¡±•…Í”¹µ½¹Ñ¡±å}Íå¹‘¥}…µ½Õ¹Ð¥ôUMÍå¹‘¥€€è¹Õ±°°(€€€€€½Ñ¡•É¡…É•Íµ½Õ¹Ð€ø€À€ü€‘íÑ¡¥Ì¹™½Éµ…Ñ5½¹•ä¡½Ñ¡•É¡…É•Íµ½Õ¹Ð¥ôUM…ÕÑÉ•Ì¡…É•Í€€è¹Õ±°°(€€€t¹™¥±Ñ•È¡	½½±•…¸¤¹©½¥¸ q¸œ¤ì(€€€½¹ÍÐÕ…É…¹Ñ••M•Ñ¥½¸€ô1„…É…¹Ñ¥”±½…Ñ¥Ù”ƒ¥ÅÕ¥Ù…ÕÐƒ€€‘íÕ…É…¹Ñ••5½¹Ñ¡Íôµ½¥Ì€ ô€ ‘íÑ¡¥Ì¹™½Éµ…Ñ5½¹•ä¡É•¹Ñµ½Õ¹Ð¥ô€¬€‘íÑ¡¥Ì¹™½Éµ…Ñ5½¹•ä¡µ…¥¹Ñ•¹…¹•••µ½Õ¹Ð¥ô¤à€‘íÕ…É…¹Ñ••5½¹Ñ¡Íô¥€ì(€€€½¹ÍÐ…ÕÑÉ•Í¡…É•Í1¥¹”€ô½Ñ¡•É¡…É•Íµ½Õ¹Ð€ø€À€ü€´ÕÑÉ•Ì¡…É•Ì€è€‘íÑ¡¥Ì¹™½Éµ…Ñ5½¹•ä¡½Ñ¡•É¡…É•Íµ½Õ¹Ð¥ôUM€€è€œœì(€€€½¹ÍÐ±…¹‘±½É‘M¥±”€ôMÑÉ¥¹œ¡½µÁ…¹ä¹½µÁ…¹å}…É½¹å´€üü€œœ¤¹ÑÉ¥´ ¤ì(€€€½¹ÍÐ±…¹‘±½É‘1•…±½É´€ôMÑÉ¥¹œ¡½µÁ…¹ä¹½µÁ…¹å}±•…±}™½É´€üü€œœ¤¹ÑÉ¥´ ¤ì(€€€½¹ÍÐÑ•¹…¹Ñ1•…±½É´€ôMÑÉ¥¹œ¡±•…Í”¹±•…±}™½É´€üü€œœ¤¹ÑÉ¥´ ¤ì(€€€½¹ÍÐÑ•¹…¹Ñ½µÁ…¹å9…µ”€ôMÑÉ¥¹œ¡±•…Í”¹½µÁ…¹å}¹…µ”€üü±•…Í”¹Ñ•¹…¹Ñ}¹…µ”€üü€œœ¤¹ÑÉ¥´ ¤ì(€€€½¹ÍÐ¹½µ‰É•A…É­¥¹ÍA¡É…Í”€ôÁ…É­¥¹½Õ¹Ð€ø€À(€€€€€€üU¸Ñ½Ñ…°‘”€‘íÁ…É­¥¹½Õ¹Ñô•µÁ±…•µ•¹Ð¡Ì¤‘”Á…É­¥¹œ•ÍÐË¥Í•ÉÛ¤…ÔAÉ•¹•ÕÈ¹€(€€€€€€è€ÕÕ¸•µÁ±…•µ•¹Ð‘”Á…É­¥¹œ»Še•ÍÐË¥Í•ÉÛ¤…ÔÑ¥ÑÉ”‘ÔÁË¥Í•¹Ð‰…¥°°Í…Õ˜…½É½¹ÑÉ…¥É”ƒ¥É¥Ð‘•ÌA…ÉÑ¥•Ì¸œì(€€€½¹ÍÐÑ•¹…¹Ñ%‘•¹Ñ¥™¥…Ñ¥½¹A…É…É…Á €ô¥Í½µÁ…¹åQ•¹…¹Ð(€€€€€€üƒ
¬€‘íÑ•¹…¹Ñ½µÁ…¹å9…µ•ô‘íÑ•¹…¹Ñ1•…±½É´€ü€°€‘íÑ•¹…¹Ñ1•…±½Éµõ€€è€œô‘í±•…Í”¹É´€ü€°¥µµ…ÑÉ¥Õ³¥”…ÔI•¥ÍÑÉ”‘Ô½µµ•É”•Ð‘ÔË¥‘¥Ð5½‰¥±¥•ÈÍ½ÕÌ±”¹Õ·¥É¼€‘í±•…Í”¹Éµõ€€è€œô‘í±•…Í”¹¹…Ñ¥½¹…±}¥‘}¹Õµ‰•È€ü€°•¹É•¥ÍÑË¥”ƒ€³Še%‘•¹Ñ¥™¥…Ñ¥½¸9…Ñ¥½¹…±”Í½ÕÌ±”¹Õ·¥É¼€‘í±•…Í”¹¹…Ñ¥½¹…±}¥‘}¹Õµ‰•Éõ€€è€œô‘íÑ•¹…¹Ñ‘‘É•ÍÍA…ÉÑÌ¹±•¹Ñ €ü€°‘½¹Ð±”Í§¡”Í½¥…°•ÍÐƒ¥Ñ…‰±¤ƒ€€‘íÑ•¹…¹Ñ‘‘É•ÍÍA…ÉÑÌ¹©½¥¸ œ°€œ¥õ€€è€œô‘íÑ•¹…¹ÑI•ÁÉ•Í•¹Ñ…Ñ¥Ù”€ü€°É•ÁË¥Í•¹Ó¥”Á…È€‘íÑ•¹…¹ÑI•ÁÉ•Í•¹Ñ…Ñ¥Ù•õ€€è€œô‘í±•…Í”¹±•…±}É•ÁÉ•Í•¹Ñ…Ñ¥Ù•}É½±”€ü€°…¥ÍÍ…¹Ð•¸ÅÕ…±¥Ó¤‘”€‘í±•…Í”¹±•…±}É•ÁÉ•Í•¹Ñ…Ñ¥Ù•}É½±•õ€€è€œôƒ
í€(€€€€€€èƒ
¬5½¹Í¥•ÕÈ½5…‘…µ”€‘íÑ•¹…¹ÑÕ±±9…µ”ñð±•…Í”¹Ñ•¹…¹Ñ}¹…µ•ô‘í±•…Í”¹¥‘}‘½Õµ•¹Ñ}ÑåÁ”€ü€°Ñ¥ÑÕ±…¥É”‘”€‘í±•…Í”¹¥‘}‘½Õµ•¹Ñ}ÑåÁ•õ€€è€œô‘í±•…Í”¹¥‘}¹Õµ‰•È€ü€¹Õ·¥É¼€‘í±•…Í”¹¥‘}¹Õµ‰•Éõ€€è€œô‘íÑ•¹…¹Ñ‘‘É•ÍÍA…ÉÑÌ¹±•¹Ñ €ü€°‘½µ¥¥±§¤¡”¤ƒ€€‘íÑ•¹…¹Ñ‘‘É•ÍÍA…ÉÑÌ¹©½¥¸ œ°€œ¥õ€€è€œôƒ
í€ì((€€€É•ÑÕÉ¸ì(€€€€€191=I}95è±•ÍÍ½É9…µ”°(€€€€€191=I}I=9e4è½µÁ…¹ä¹½µÁ…¹å}…É½¹å´€üü€œœ°(€€€€€191=I}11}=I4è½µÁ…¹ä¹½µÁ…¹å}±•…±}™½É´€üü€œœ°(€€€€€191=I}I4è½µÁ…¹ä¹½µÁ…¹å}É´€üü€œœ°(€€€€€191=I}9Q%=91}%è½µÁ…¹ä¹½µÁ…¹å}¹…Ñ¥½¹…±}¥€üü€œœ°(€€€€€191=I}Qa}%è½µÁ…¹ä¹½µÁ…¹å}Ñ…á}¥€üü€œœ°(€€€€€191=I}IMLè½µÁ…¹ä¹½µÁ…¹å}…‘‘É•ÍÌ€üü½µÁ…¹ä¹…‘‘É•ÍÌ€üü€œœ°(€€€€€191=I}=55U9è½µÁ…¹ä¹½µÁ…¹å}½µµÕ¹”€üü€œœ°(€€€€€191=I}%Qdè½µÁ…¹ä¹½µÁ…¹å}¥Ñä€üü€œœ°(€€€€€191=I}=U9QIdè½µÁ…¹ä¹½µÁ…¹å}½Õ¹ÑÉä€üü€œœ°(€€€€€191=I}IAIM9QQ%Y}95èÉ•ÁÉ•Í•¹Ñ…Ñ¥Ù•Õ±±9…µ”°(€€€€€191=I}IAIM9QQ%YèÉ•ÁÉ•Í•¹Ñ…Ñ¥Ù•Õ±±9…µ”°(€€€€€191=I}IAIM9QQ%Y}%Y%1%Qdè½µÁ…¹ä¹±•…±}É•ÁÉ•Í•¹Ñ…Ñ¥Ù•}¥Ù¥±¥Ñä€üü€œœ°(€€€€€191=I}IAIM9QQ%Y}Q%Q1è½µÁ…¹ä¹±•…±}É•ÁÉ•Í•¹Ñ…Ñ¥Ù•}Ñ¥Ñ±”€üü€œœ°(€€€€€191=I}AIM9QQ%=8èl(€€€€€€€±•ÍÍ½É9…µ”°(€€€€€€€½µÁ…¹ä¹½µÁ…¹å}±•…±}™½É´€ü€‘í½µÁ…¹ä¹½µÁ…¹å}±•…±}™½Éµõ€€è¹Õ±°°(€€€€€€€½µÁ…¹ä¹½µÁ…¹å}É´€üI4€‘í½µÁ…¹ä¹½µÁ…¹å}Éµõ€€è¹Õ±°°(€€€€€€€½µÁ…¹ä¹½µÁ…¹å}¹…Ñ¥½¹…±}¥€ü%9…Ð€‘í½µÁ…¹ä¹½µÁ…¹å}¹…Ñ¥½¹…±}¥‘õ€€è¹Õ±°°(€€€€€€€€¡½µÁ…¹ä¹½µÁ…¹å}…‘‘É•ÍÌ€üü½µÁ…¹ä¹…‘‘É•ÍÌ¤€ü…‘É•ÍÍ”€‘í½µÁ…¹ä¹½µÁ…¹å}…‘‘É•ÍÌ€üü½µÁ…¹ä¹…‘‘É•ÍÍõ€€è¹Õ±°°(€€€€€€€É•ÁÉ•Í•¹Ñ…Ñ¥Ù•Õ±±9…µ”€üÉ•ÁÉ•Í•¹Ñ•”Á…È€‘íÉ•ÁÉ•Í•¹Ñ…Ñ¥Ù•Õ±±9…µ•õ€€è¹Õ±°°(€€€€€€€½µÁ…¹ä¹±•…±}É•ÁÉ•Í•¹Ñ…Ñ¥Ù•}Ñ¥Ñ±”€ü•¸ÅÕ…±¥Ñ”‘”€‘í½µÁ…¹ä¹±•…±}É•ÁÉ•Í•¹Ñ…Ñ¥Ù•}Ñ¥Ñ±•õ€€è¹Õ±°°(€€€€€t¹™¥±Ñ•È¡	½½±•…¸¤¹©½¥¸ œ°€œ¤°(€€€€€Q99Q}95è¥Í½µÁ…¹åQ•¹…¹Ð€ü€¡±•…Í”¹½µÁ…¹å}¹…µ”€üü±•…Í”¹Ñ•¹…¹Ñ}¹…µ”¤€è€¡Ñ•¹…¹ÑÕ±±9…µ”ñð±•…Í”¹Ñ•¹…¹Ñ}¹…µ”¤°(€€€€€Q99Q}%Y%1%Qdè±•…Í”¹¥Ù¥±¥Ñä€üü€œœ°(€€€€€Q99Q}11}=I4è±•…Í”¹±•…±}™½É´€üü€œœ°(€€€€€Q99Q}I4è±•…Í”¹É´€üü€œœ°(€€€€€Q99Q}%è±•…Í”¹¹…Ñ¥½¹…±}¥‘}¹Õµ‰•È€üü±•…Í”¹¥‘}¹Õµ‰•È€üü€œœ°(€€€€€Q99Q}IMLè±•…Í”¹Ñ•¹…¹Ñ}…‘‘É•ÍÌ€üü€œœ°(€€€€€Q99Q}=55U9è±•…Í”¹Ñ•¹…¹Ñ}½µµÕ¹”€üü€œœ°(€€€€€Q99Q}%Qdè±•…Í”¹Ñ•¹…¹Ñ}¥Ñä€üü€œœ°(€€€€€Q99Q}=U9QIdè±•…Í”¹Ñ•¹…¹Ñ}½Õ¹ÑÉä€üü€œœ°(€€€€€Q99Q}IAIM9QQ%Y}95èÑ•¹…¹ÑI•ÁÉ•Í•¹Ñ…Ñ¥Ù”°(€€€€€Q99Q}IAIM9QQ%Y}%Y%1%Qdè±•…Í”¹±•…±}É•ÁÉ•Í•¹Ñ…Ñ¥Ù•}¥Ù¥±¥Ñä€üü€œœ°(€€€€€Q99Q}IAIM9QQ%Y}Q%Q1è±•…Í”¹±•…±}É•ÁÉ•Í•¹Ñ…Ñ¥Ù•}É½±”€üü€œœ°(€€€€€Q99Q}AIM9QQ%=8è¥Í½µÁ…¹åQ•¹…¹Ð€ü½µÁ…¹åAÉ•Í•¹Ñ…Ñ¥½¸€èÁ¡åÍ¥…±AÉ•Í•¹Ñ…Ñ¥½¸°(€€€€€Q99Q}A!eM%1}9=QèÑ•¹…¹ÑA¡åÍ¥…±9½Ñ”°(€€€€€	U%1%9}95è±•…Í”¹‰Õ¥±‘¥¹}¹…µ”€üü€œœ°(€€€€€	U%1%9}IMLè±•…Í”¹‰Õ¥±‘¥¹}…‘‘É•ÍÌ€üü€œœ°(€€€€€	U%1%9}=55U9è±•…Í”¹‰Õ¥±‘¥¹}½µµÕ¹”€üü€œœ°(€€€€€	U%1%9}9%!	=I!==è±•…Í”¹‰Õ¥±‘¥¹}¹•¥¡‰½É¡½½€üü€œœ°(€€€€€	U%1%9}%Qdè±•…Í”¹‰Õ¥±‘¥¹}¥Ñä€üü€œœ°(€€€€€U9%Q}9U5	Hè±•…Í”¹Õ¹¥Ñ}¹Õµ‰•È€üü€œœ°(€€€€€U9%Q}UI9%M!%9è…Á…ÉÑµ•¹Ñ1…‰•°°(€€€€€AIQ59Q}1	0è…Á…ÉÑµ•¹Ñ1…‰•°°(€€€€€	I==5}=U9PèMÑÉ¥¹œ¡‰•‘É½½µ½Õ¹Ð¤°(€€€€€AI-%9}=U9PèMÑÉ¥¹œ¡Á…É­¥¹½Õ¹Ð¤°(€€€€€	I==5}=U9Q}QaPè‰•‘É½½µ½Õ¹ÑQ•áÐ°(€€€€€MQIQ}Qè±•…Í•MÑ…ÉÑ…Ñ”°(€€€€€9}Qè±•…Í•¹‘…Ñ”°(€€€€€1M}UIQ%=9}QaPè±•…Í•ÕÉ…Ñ¥½¹Q•áÐ°(€€€€€9=Q%}5=9Q!LèMÑÉ¥¹œ¡±•…Í”¹¹½Ñ¥•}µ½¹Ñ¡Ì€üü½µÁ…¹ä¹‘•™…Õ±Ñ}¹½Ñ¥•}µ½¹Ñ¡Ì€üü€À¤°(€€€€€5=9Q!1e}I9PèÑ¡¥Ì¹™½Éµ…Ñ5½¹•ä¡±•…Í”¹µ½¹Ñ¡±å}É•¹Ð¤°(€€€€€5%9Q99}5=U9PèÑ¡¥Ì¹™½Éµ…Ñ5½¹•ä¡±•…Í”¹µ…¥¹Ñ•¹…¹•}™••}…µ½Õ¹Ð¤°(€€€€€Me9%}5=U9PèÑ¡¥Ì¹™½Éµ…Ñ5½¹•ä¡±•…Í”¹µ½¹Ñ¡±å}Íå¹‘¥}…µ½Õ¹Ð¤°(€€€€€=Q!I}!IM}5=U9PèÑ¡¥Ì¹™½Éµ…Ñ5½¹•ä¡±•…Í”¹½Ñ¡•É}¡…É•Í}…µ½Õ¹Ð¤°(€€€€€=Q!I}!IM}1%9è½Ñ¡•É¡…É•Íµ½Õ¹Ð€ø€À€ü€‘íÑ¡¥Ì¹™½Éµ…Ñ5½¹•ä¡½Ñ¡•É¡…É•Íµ½Õ¹Ð¥ôUM…ÕÑÉ•Ì¡…É•Í€€è€œœ°(€€€€€=9QIQ}9=Qè½¹ÑÉ…Ñ9½Ñ”€üü€œœ°(€€€€€5=9Q!1e}MQ%=8èµ½¹Ñ¡±åM•Ñ¥½¹1¥¹•Ì°(€€€€€I9Q}	I-=]8èÉ•¹Ñ	É•…­‘½Ý¸°(€€€€€5=9Q!1e}Q=Q0èÑ¡¥Ì¹™½Éµ…Ñ5½¹•ä¡Ñ½Ñ…±5½¹Ñ¡±ä¤°(€€€€€5=9Q!1e}Q=Q1}I\èÑ¡¥Ì¹™½Éµ…Ñ5½¹•ä¡Ñ½Ñ…±5½¹Ñ¡±ä¤°(€€€€€UII9dè€UMœ°(€€€€€UI9Q}5=9Q!LèMÑÉ¥¹œ¡Õ…É…¹Ñ••5½¹Ñ¡Ì¤°(€€€€€UI9Q}Q=Q0èÑ¡¥Ì¹™½Éµ…Ñ5½¹•ä¡Õ…É…¹Ñ••µ½Õ¹Ð¤°(€€€€€UI9Q}MQ%=8èÕ…É…¹Ñ••M•Ñ¥½¸°(€€€€€9IQ}Pè•¹•É…Ñ•‘Ð¹Ñ½%M=MÑÉ¥¹œ ¤°(€€€€€M%9QUI}A1è±•…Í”¹Í¥¹…ÑÕÉ•}Á±…”€üü½µÁ…¹ä¹‘•™…Õ±Ñ}Í¥¹…ÑÕÉ•}Á±…”€üü½µÁ…¹ä¹½µÁ…¹å}¥Ñä€üü€-¥¹Í¡…Í„œ°(€€€€€M%9QUI}QèÍ¥¹…ÑÕÉ•…Ñ”°(€€€€€1M}II9èÑ¡¥Ì¹±•…Í•I•™•É•¹•½‘”¡±•…Í”¹¥¤°(€€€€€½µÁ…¹å}Á¡½¹”è½µÁ…¹ä¹Á¡½¹”€üü½µÁ…¹ä¹ÁÉ¥µ…Éå}Á¡½¹”€üü€œœ°(€€€€€½µÁ…¹å}•µ…¥°è½µÁ…¹ä¹•µ…¥°€üü½µÁ…¹ä¹ÁÉ¥µ…Éå}•µ…¥°€üü€œœ°(€€€€€½µÁ…¹å}±½½}™¥±•}ÕÉ°è½µÁ…¹ä¹±½½}™¥±•}ÕÉ°€üü½µÁ…¹ä¹±½½}ÕÉ°€üü¹Õ±°°(€€€€€½µÁ…¹å}Í¥¹…ÑÕÉ•}™¥±•}ÕÉ°è½µÁ…¹ä¹Í¥¹…ÑÕÉ•}™¥±•}ÕÉ°€üü½µÁ…¹ä¹Í¥¹…ÑÕÉ•}ÕÉ°€üü¹Õ±°°(€€€€€½µÁ…¹å}ÍÑ…µÁ}™¥±•}ÕÉ°è½µÁ…¹ä¹ÍÑ…µÁ}™¥±•}ÕÉ°€üü½µÁ…¹ä¹ÍÑ…µÁ}ÕÉ°€üü¹Õ±°°(€€€€€‰…¥±±•ÕÈèì(€€€€€€€É…¥Í½¹}Í½¥…±”è±•ÍÍ½É9…µ”°(€€€€€€€Í¥±”è½µÁ…¹ä¹½µÁ…¹å}…É½¹å´€üü€œœ°(€€€€€€€Í¥±•}Á¡É…Í”è±…¹‘±½É‘M¥±”€ü€€ ‘í±…¹‘±½É‘M¥±•ô¥€€è€œœ°(€€€€€€€™½Éµ•}©ÕÉ¥‘¥ÅÕ”è±…¹‘±½É‘1•…±½É´°(€€€€€€€™½Éµ•}©ÕÉ¥‘¥ÅÕ•}Á¡É…Í”è±…¹‘±½É‘1•…±½É´€ü€‘í±…¹‘±½É‘1•…±½Éµô€€è€œœ°(€€€€€€€É´è½µÁ…¹ä¹½µÁ…¹å}É´€üü€œœ°(€€€€€€€¥‘•¹Ñ¥™¥…Ñ¥½¹}¹…Ñ¥½¹…±”è½µÁ…¹ä¹½µÁ…¹å}¹…Ñ¥½¹…±}¥€üü€œœ°(€€€€€€€¹Õµ•É½}™¥Í…°è½µÁ…¹ä¹½µÁ…¹å}Ñ…á}¥€üü€œœ°(€€€€€€€…‘É•ÍÍ”è½µÁ…¹ä¹½µÁ…¹å}…‘‘É•ÍÌ€üü½µÁ…¹ä¹…‘‘É•ÍÌ€üü€œœ°(€€€€€€€…‘É•ÍÍ•}½µÁ±•Ñ”è½µÁ…¹å‘‘É•ÍÍA…ÉÑÌ¹©½¥¸ œ°€œ¤°(€€€€€€€½µµÕ¹”è½µÁ…¹ä¹½µÁ…¹å}½µµÕ¹”€üü€œœ°(€€€€€€€Ù¥±±”è½µÁ…¹ä¹½µÁ…¹å}¥Ñä€üü€œœ°(€€€€€€€Á…åÌè½µÁ…¹ä¹½µÁ…¹å}½Õ¹ÑÉä€üü€œœ°(€€€€€€€É•ÁÉ•Í•¹Ñ…¹Ñ}¹½´èÉ•ÁÉ•Í•¹Ñ…Ñ¥Ù•Õ±±9…µ”°(€€€€€€€É•ÁÉ•Í•¹Ñ…¹Ñ}¥Ù¥±¥Ñ”è½µÁ…¹ä¹±•…±}É•ÁÉ•Í•¹Ñ…Ñ¥Ù•}¥Ù¥±¥Ñä€üü€œœ°(€€€€€€€É•ÁÉ•Í•¹Ñ…¹Ñ}™½¹Ñ¥½¸è½µÁ…¹ä¹±•…±}É•ÁÉ•Í•¹Ñ…Ñ¥Ù•}Ñ¥Ñ±”€üü€œœ°(€€€€€€€Í¥¹…ÑÕÉ•}¹½´èÉ•ÁÉ•Í•¹Ñ…Ñ¥Ù•Õ±±9…µ”ñð±•ÍÍ½É9…µ”°(€€€€€€€ÁÉ•Í•¹Ñ…Ñ¥½¸èl(€€€€€€€€€±•ÍÍ½É9…µ”°(€€€€€€€€€½µÁ…¹ä¹½µÁ…¹å}±•…±}™½É´€ü€‘í½µÁ…¹ä¹½µÁ…¹å}±•…±}™½Éµõ€€è¹Õ±°°(€€€€€€€€€½µÁ…¹ä¹½µÁ…¹å}É´€üI4€‘í½µÁ…¹ä¹½µÁ…¹å}Éµõ€€è¹Õ±°°(€€€€€€€€€½µÁ…¹ä¹½µÁ…¹å}¹…Ñ¥½¹…±}¥€ü%9…Ð€‘í½µÁ…¹ä¹½µÁ…¹å}¹…Ñ¥½¹…±}¥‘õ€€è¹Õ±°°(€€€€€€€€€€¡½µÁ…¹ä¹½µÁ…¹å}…‘‘É•ÍÌ€üü½µÁ…¹ä¹…‘‘É•ÍÌ¤€ü…‘É•ÍÍ”€‘í½µÁ…¹ä¹½µÁ…¹å}…‘‘É•ÍÌ€üü½µÁ…¹ä¹…‘‘É•ÍÍõ€€è¹Õ±°°(€€€€€€€€€É•ÁÉ•Í•¹Ñ…Ñ¥Ù•Õ±±9…µ”€üÉ•ÁÉ•Í•¹Ñ•”Á…È€‘íÉ•ÁÉ•Í•¹Ñ…Ñ¥Ù•Õ±±9…µ•õ€€è¹Õ±°°(€€€€€€€€€½µÁ…¹ä¹±•…±}É•ÁÉ•Í•¹Ñ…Ñ¥Ù•}Ñ¥Ñ±”€ü•¸ÅÕ…±¥Ñ”‘”€‘í½µÁ…¹ä¹±•…±}É•ÁÉ•Í•¹Ñ…Ñ¥Ù•}Ñ¥Ñ±•õ€€è¹Õ±°°(€€€€€€€t¹™¥±Ñ•È¡	½½±•…¸¤¹©½¥¸ œ°€œ¤°(€€€€€ô°(€€€€€±½…Ñ…¥É”èì(€€€€€€€ÑåÁ”è¥Í½µÁ…¹åQ•¹…¹Ð€ü€AIM=99}5=I1œ€è€AIM=99}A!eM%EUœ°(€€€€€€€¥Ù¥±¥Ñ”è±•…Í”¹¥Ù¥±¥Ñä€üü€œœ°(€€€€€€€¹½µ}½µÁ±•ÐèÑ•¹…¹ÑÕ±±9…µ”ñð±•…Í”¹Ñ•¹…¹Ñ}¹…µ”°(€€€€€€€É…¥Í½¹}Í½¥…±”è±•…Í”¹½µÁ…¹å}¹…µ”€üü€œœ°(€€€€€€€™½Éµ•}©ÕÉ¥‘¥ÅÕ”è±•…Í”¹±•…±}™½É´€üü€œœ°(€€€€€€€É´è±•…Í”¹É´€üü€œœ°(€€€€€€€¥‘•¹Ñ¥™¥…Ñ¥½¹}¹…Ñ¥½¹…±”è±•…Í”¹¹…Ñ¥½¹…±}¥‘}¹Õµ‰•È€üü€œœ°(€€€€€€€ÑåÁ•}Á¥••}¥‘•¹Ñ¥Ñ”è±•…Í”¹¥‘}‘½Õµ•¹Ñ}ÑåÁ”€üü€œœ°(€€€€€€€¹Õµ•É½}Á¥••}¥‘•¹Ñ¥Ñ”è±•…Í”¹¥‘}¹Õµ‰•È€üü€œœ°(€€€€€€€…‘É•ÍÍ”è±•…Í”¹Ñ•¹…¹Ñ}…‘‘É•ÍÌ€üü€œœ°(€€€€€€€…‘É•ÍÍ•}½µÁ±•Ñ”èÑ•¹…¹Ñ‘‘É•ÍÍA…ÉÑÌ¹©½¥¸ œ°€œ¤°(€€€€€€€½µµÕ¹”è±•…Í”¹Ñ•¹…¹Ñ}½µµÕ¹”€üü€œœ°(€€€€€€€Ù¥±±”è±•…Í”¹Ñ•¹…¹Ñ}¥Ñä€üü€œœ°(€€€€€€€Á…åÌè±•…Í”¹Ñ•¹…¹Ñ}½Õ¹ÑÉä€üü€œœ°(€€€€€€€É•ÁÉ•Í•¹Ñ…¹Ñ}¹½´èÑ•¹…¹ÑI•ÁÉ•Í•¹Ñ…Ñ¥Ù”°(€€€€€€€É•ÁÉ•Í•¹Ñ…¹Ñ}¹½µ}½µÁ±•ÐèÑ•¹…¹ÑI•ÁÉ•Í•¹Ñ…Ñ¥Ù”°(€€€€€€€É•ÁÉ•Í•¹Ñ…¹Ñ}¥Ù¥±¥Ñ”è±•…Í”¹±•…±}É•ÁÉ•Í•¹Ñ…Ñ¥Ù•}¥Ù¥±¥Ñä€üü€œœ°(€€€€€€€É•ÁÉ•Í•¹Ñ…¹Ñ}™½¹Ñ¥½¸è±•…Í”¹±•…±}É•ÁÉ•Í•¹Ñ…Ñ¥Ù•}É½±”€üü€œœ°(€€€€€€€Í¥¹…ÑÕÉ•}¹½´è¥Í½µÁ…¹åQ•¹…¹Ð€ü€¡±•…Í”¹½µÁ…¹å}¹…µ”€üü±•…Í”¹Ñ•¹…¹Ñ}¹…µ”¤€è€¡Ñ•¹…¹ÑÕ±±9…µ”ñð±•…Í”¹Ñ•¹…¹Ñ}¹…µ”¤°(€€€€€€€Á…É…É…Á¡•}¥‘•¹Ñ¥™¥…Ñ¥½¸èÑ•¹…¹Ñ%‘•¹Ñ¥™¥…Ñ¥½¹A…É…É…Á °(€€€€€€€ÁÉ•Í•¹Ñ…Ñ¥½¸è¥Í½µÁ…¹åQ•¹…¹Ð€ü½µÁ…¹åAÉ•Í•¹Ñ…Ñ¥½¸€èÁ¡åÍ¥…±AÉ•Í•¹Ñ…Ñ¥½¸°(€€€€€ô°(€€€€€‰¥•¸èì(€€€€€€€¹Õµ•É½}Õ¹¥Ñ”è±•…Í”¹Õ¹¥Ñ}¹Õµ‰•È€üü€œœ°(€€€€€€€¥µµ•Õ‰±”è±•…Í”¹‰Õ¥±‘¥¹}¹…µ”€üü€œœ°(€€€€€€€…‘É•ÍÍ”è±•…Í”¹‰Õ¥±‘¥¹}…‘‘É•ÍÌ€üü€œœ°(€€€€€€€½µµÕ¹”è±•…Í”¹‰Õ¥±‘¥¹}½µµÕ¹”€üü€œœ°(€€€€€€€ÅÕ…ÉÑ¥•Èè±•…Í”¹‰Õ¥±‘¥¹}¹•¥¡‰½É¡½½€üü€œœ°(€€€€€€€Ù¥±±”è±•…Í”¹‰Õ¥±‘¥¹}¥Ñä€üü€œœ°(€€€€€€€¹½µ‰É•}¡…µ‰É•ÌèMÑÉ¥¹œ¡‰•‘É½½µ½Õ¹Ð¤°(€€€€€€€¹½µ‰É•}Á…É­¥¹ÌèMÑÉ¥¹œ¡Á…É­¥¹½Õ¹Ð¤°(€€€€€€€¹½µ‰É•}Á…É­¥¹Í}Á¡É…Í”è¹½µ‰É•A…É­¥¹ÍA¡É…Í”°(€€€€€€€µ•Õ‰±•}±…‰•°è±•…Í”¹¥Í}™ÕÉ¹¥Í¡•€ü€5•Õ‰±”œ€è€9½¸µ•Õ‰±”œ°(€€€€€€€…ÁÁ…ÉÑ•µ•¹Ñ}±…‰•°è…Á…ÉÑµ•¹Ñ1…‰•°°(€€€€€€€ÕÍ…”èÕÍ…•1…‰•°°(€€€€€€€…‘É•ÍÍ•}½µÁ±•Ñ”è‰Õ¥±‘¥¹‘‘É•ÍÍA…ÉÑÌ¹©½¥¸ œ°€œ¤°(€€€€€€€‘•ÍÉ¥ÁÑ¥½¹}‘•Ñ…¥°èl(€€€€€€€€€°Õ¹¥Ñ”€‘í±•…Í”¹Õ¹¥Ñ}¹Õµ‰•È€üü€œõ€¹ÑÉ¥´ ¤°(€€€€€€€€€±•…Í”¹ÍÕÉ™…•}…É•„€ü€‘í±•…Í”¹ÍÕÉ™…•}…É•…ô´É€€è¹Õ±°°(€€€€€€€€€‰•‘É½½µ½Õ¹Ð€ü€‘í‰•‘É½½µ½Õ¹Ñô¡…µ‰É”¡Ì¥€€è¹Õ±°°(€€€€€€€€€MÑÉ¥¹œ¡Á…É­¥¹½Õ¹Ð¤€„ôô€œÀœ(€€€€€€€€€€€€ü€‘íÁ…É­¥¹½Õ¹ÑôÁ…É­¥¹œ¡Ì¥€(€€€€€€€€€€€€è¹Õ±°°(€€€€€€€€€±•…Í”¹¥Í}™ÕÉ¹¥Í¡•€ü€µ•Õ‰±•”œ€è€¹½¸µ•Õ‰±•”œ°(€€€€€€€t¹™¥±Ñ•È¡	½½±•…¸¤¹©½¥¸ œ°€œ¤°(€€€€€ô°(€€€€€‰…¥°èì(€€€€€€€‘…Ñ•}‘•‰ÕÐè±•…Í•MÑ…ÉÑ…Ñ”°(€€€€€€€‘…Ñ•}™¥¸è±•…Í•¹‘…Ñ”°(€€€€€€€‘ÕÉ••}Ñ•áÑ”è±•…Í•ÕÉ…Ñ¥½¹Q•áÐ°(€€€€€€€ÁÉ•…Ù¥Í}µ½¥ÌèMÑÉ¥¹œ¡±•…Í”¹¹½Ñ¥•}µ½¹Ñ¡Ì€üü½µÁ…¹ä¹‘•™…Õ±Ñ}¹½Ñ¥•}µ½¹Ñ¡Ì€üü€À¤°(€€€€€€€±½å•É}‰…Í”èÑ¡¥Ì¹™½Éµ…Ñ5½¹•ä¡±•…Í”¹µ½¹Ñ¡±å}É•¹Ð¤°(€€€€€€€±½å•É}‰…Í•}™½Éµ…Ñ”è€‘íÑ¡¥Ì¹™½Éµ…Ñ5½¹•ä¡±•…Í”¹µ½¹Ñ¡±å}É•¹Ð¥ôUM€°(€€€€€€€™É…¥Í}•¹ÑÉ•Ñ¥•¸èÑ¡¥Ì¹™½Éµ…Ñ5½¹•ä¡±•…Í”¹µ…¥¹Ñ•¹…¹•}™••}…µ½Õ¹Ð¤°(€€€€€€€™É…¥Í}•¹ÑÉ•Ñ¥•¹}™½Éµ…Ñ”è€‘íÑ¡¥Ì¹™½Éµ…Ñ5½¹•ä¡±•…Í”¹µ…¥¹Ñ•¹…¹•}™••}…µ½Õ¹Ð¥ôUM€°(€€€€€€€™É…¥Í}Íå¹‘¥ŒèÑ¡¥Ì¹™½Éµ…Ñ5½¹•ä¡±•…Í”¹µ½¹Ñ¡±å}Íå¹‘¥}…µ½Õ¹Ð¤°(€€€€€€€™É…¥Í}Íå¹‘¥}™½Éµ…Ñ”è€‘íÑ¡¥Ì¹™½Éµ…Ñ5½¹•ä¡±•…Í”¹µ½¹Ñ¡±å}Íå¹‘¥}…µ½Õ¹Ð¥ôUM€°(€€€€€€€…ÕÑÉ•Í}¡…É•ÌèÑ¡¥Ì¹™½Éµ…Ñ5½¹•ä¡±•…Í”¹½Ñ¡•É}¡…É•Í}…µ½Õ¹Ð¤°(€€€€€€€…ÕÑÉ•Í}¡…É•Í}™½Éµ…Ñ”è€‘íÑ¡¥Ì¹™½Éµ…Ñ5½¹•ä¡±•…Í”¹½Ñ¡•É}¡…É•Í}…µ½Õ¹Ð¥ôUM€°(€€€€€€€…ÕÑÉ•Í}¡…É•Í}±¥¹”è…ÕÑÉ•Í¡…É•Í1¥¹”°(€€€€€€€±½å•É}Ñ½Ñ…°èÑ¡¥Ì¹™½Éµ…Ñ5½¹•ä¡Ñ½Ñ…±5½¹Ñ¡±ä¤°(€€€€€€€±½å•É}Ñ½Ñ…±}™½Éµ…Ñ”è€‘íÑ¡¥Ì¹™½Éµ…Ñ5½¹•ä¡Ñ½Ñ…±5½¹Ñ¡±ä¥ôUM€°(€€€€€€€…É…¹Ñ¥•}¹½µ‰É•}µ½¥ÌèMÑÉ¥¹œ¡Õ…É…¹Ñ••5½¹Ñ¡Ì¤°(€€€€€€€…É…¹Ñ¥•}µ½¹Ñ…¹ÐèÑ¡¥Ì¹™½Éµ…Ñ5½¹•ä¡Õ…É…¹Ñ••µ½Õ¹Ð¤°(€€€€€€€…É…¹Ñ¥•}µ½¹Ñ…¹Ñ}™½Éµ…Ñ”è€‘íÑ¡¥Ì¹™½Éµ…Ñ5½¹•ä¡Õ…É…¹Ñ••µ½Õ¹Ð¥ôUM€°(€€€€€€€…É…¹Ñ¥•}‰…Í•}µ½¹Ñ…¹ÐèÑ¡¥Ì¹™½Éµ…Ñ5½¹•ä¡Õ…É…¹Ñ••	…Í•µ½Õ¹Ð¤°(€€€€€€€‘•Ù¥Í”è€UMœ°(€€€€€€€±¥•Õ}Í¥¹…ÑÕÉ”è±•…Í”¹Í¥¹…ÑÕÉ•}Á±…”€üü½µÁ…¹ä¹‘•™…Õ±Ñ}Í¥¹…ÑÕÉ•}Á±…”€üü½µÁ…¹ä¹½µÁ…¹å}¥Ñä€üü€-¥¹Í¡…Í„œ°(€€€€€€€‘…Ñ•}Í¥¹…ÑÕÉ”èÍ¥¹…ÑÕÉ•…Ñ”°(€€€€€€€ÕÍ…•}±…‰•°èÕÍ…•1…‰•°°(€€€€€€€ÕÍ…•}±…‰•±}ÕÁÁ•ÈèÕÍ…•1…‰•°¹Ñ½UÁÁ•É…Í” ¤°(€€€€€€€ÕÍ…•}±…‰•±}±½Ý•ÈèÕÍ…•1…‰•°¹Ñ½1½Ý•É…Í” ¤°(€€€€€€€…Ñ¥Ù¥Ñ•}‘•ÍÑ¥¹…Ñ¥½¸è…Ñ¥Ù¥Ñå•ÍÉ¥ÁÑ¥½¸°(€€€€€€€‘•ÍÑ¥¹…Ñ¥½¹}Á¡É…Í”è‘•ÍÑ¥¹…Ñ¥½¹A¡É…Í”°(€€€€€€€¹½Ñ•}½¹ÑÉ…Ðè½¹ÑÉ…Ñ9½Ñ”°(€€€€€€€ÑåÁ•}½¹ÑÉ…Ðè±•…Í”¹½¹ÑÉ…Ñ}Ñ•µÁ±…Ñ•}½‘”€üü½µÁ…¹ä¹‘•™…Õ±Ñ}½¹ÑÉ…Ñ}Ñ•µÁ±…Ñ•}½‘”€üü€1M}IM%9Q%0œ°(€€€€€ô°(€€€ôì(€ô((€ÁÉ¥Ù…Ñ”¹½Éµ…±¥é•1•…Í•UÍ…•½‘”¡Ù…±Õ”èÕ¹­¹½Ý¸¤ì(€€€½¹ÍÐ¹½Éµ…±¥é•€ôMÑÉ¥¹œ¡Ù…±Õ”€üü€œœ¤¹ÑÉ¥´ ¤¹Ñ½UÁÁ•É…Í” ¤ì(€€€¥˜€¡¹½Éµ…±¥é•€ôôô€=55I%0œ¤É•ÑÕÉ¸€=55I%0œì(€€€¥˜€¡¹½Éµ…±¥é•€ôôô€AI=MM%=90œñð¹½Éµ…±¥é•€ôôô€AI=MM%=990œ¤É•ÑÕÉ¸€AI=MM%=90œì(€€€¥˜€¡¹½Éµ…±¥é•€ôôô€5%aœñð¹½Éµ…±¥é•€ôôô€5%aQœ¤É•ÑÕÉ¸€5%aœì(€€€É•ÑÕÉ¸€IM%9Q%0œì(€ô((€ÁÉ¥Ù…Ñ”±•…Í•UÍ…•1…‰•°¡Ù…±Õ”èÕ¹­¹½Ý¸¤ì(€€€ÍÝ¥Ñ €¡Ñ¡¥Ì¹¹½Éµ…±¥é•1•…Í•UÍ…•½‘”¡Ù…±Õ”¤¤ì(€€€€€…Í”€=55I%0œè(€€€€€€€É•ÑÕÉ¸€½µµ•É¥…°œì(€€€€€…Í”€AI=MM%=90œè(€€€€€€€É•ÑÕÉ¸€AÉ½™•ÍÍ¥½¹¹•°œì(€€€€€…Í”€5%aœè(€€€€€€€É•ÑÕÉ¸€5¥áÑ”œì(€€€€€…Í”€IM%9Q%0œè(€€€€€‘•™…Õ±Ðè(€€€€€€€É•ÑÕÉ¸€K¥Í¥‘•¹Ñ¥•°œì(€€€ô(€ô((€ÁÉ¥Ù…Ñ”±•…Í•ÕÉ…Ñ¥½¹5½¹Ñ¡Ì¡ÍÑ…ÉÑY…±Õ”üèÍÑÉ¥¹œ°•¹‘Y…±Õ”üèÍÑÉ¥¹œð¹Õ±°¤ì(€€€¥˜€ …ÍÑ…ÉÑY…±Õ”¤É•ÑÕÉ¸€Àì(€€€½¹ÍÐÍÑ…ÉÐ€ô¹•Ü…Ñ”¡ÍÑ…ÉÑY…±Õ”¤ì(€€€½¹ÍÐ•¹€ô¹•Ü…Ñ”¡•¹‘Y…±Õ”€üü¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤¹Í±¥” À°€ÄÀ¤¤ì(€€€½¹ÍÐµ½¹Ñ¡Ì€ô€¡•¹¹•ÑÕ±±e•…È ¤€´ÍÑ…ÉÐ¹•ÑÕ±±e•…È ¤¤€¨€ÄÈ€¬•¹¹•Ñ5½¹Ñ  ¤€´ÍÑ…ÉÐ¹•Ñ5½¹Ñ  ¤ì(€€€É•ÑÕÉ¸5…Ñ ¹µ…à¡µ½¹Ñ¡Ì°€À¤ì(€ô((€ÁÉ¥Ù…Ñ”™½Éµ…Ñ5½¹•ä¡Ù…±Õ”èÕ¹­¹½Ý¸¤ì(€€€É•ÑÕÉ¸9Õµ‰•È¡Ù…±Õ”€üü€À¤¹Ñ½1½…±•MÑÉ¥¹œ ™ÈµHœ°ì(€€€€€µ¥¹¥µÕµÉ…Ñ¥½¹¥¥ÑÌè€È°(€€€€€µ…á¥µÕµÉ…Ñ¥½¹¥¥ÑÌè€È°(€€€ô¤ì(€ô((€ÁÉ¥Ù…Ñ”™É•¹¡9Õµ‰•É]½É¡Ù…±Õ”è¹Õµ‰•È¤ì(€€€½¹ÍÐ¹½Éµ…±¥é•€ô5…Ñ ¹µ…à À°5…Ñ ¹™±½½È¡9Õµ‰•È¡Ù…±Õ”€üü€À¤¤¤ì(€€€½¹ÍÐ‘¥Ñ¥½¹…ÉäèI•½Éñ¹Õµ‰•È°ÍÑÉ¥¹œø€ôì(€€€€€€Àè€i•É¼œ°(€€€€€€Äè€U¸œ°(€€€€€€Èè€•Õàœ°(€€€€€€Ìè€QÉ½¥Ìœ°(€€€€€€Ðè€EÕ…ÑÉ”œ°(€€€€€€Ôè€¥¹Äœ°(€€€€€€Øè€M¥àœ°(€€€€€€Üè€M•ÁÐœ°(€€€€€€àè€!Õ¥Ðœ°(€€€€€€äè€9•Õ˜œ°(€€€€€€ÄÀè€¥àœ°(€€€ôì(€€€É•ÑÕÉ¸‘¥Ñ¥½¹…Éåm¹½Éµ…±¥é•‘t€üüMÑÉ¥¹œ¡¹½Éµ…±¥é•¤ì(€ô((€ÁÉ¥Ù…Ñ”™½Éµ…Ñ…Ñ”¡Ù…±Õ”üèÍÑÉ¥¹œð¹Õ±°¤ì(€€€¥˜€ …Ù…±Õ”¤É•ÑÕÉ¸€œœì(€€€½¹ÍÐ¥Í½…Ñ”€ô€½x¡q‘ìÑô¤´¡q‘ìÉô¤´¡q‘ìÉô¤¼¹•á•Œ¡MÑÉ¥¹œ¡Ù…±Õ”¤¤ì(€€€¥˜€¡¥Í½…Ñ”¤ì(€€€€€É•ÑÕÉ¸€‘í¥Í½…Ñ•lÍuô¼‘í¥Í½…Ñ•lÉuô¼‘í¥Í½…Ñ•lÅuõ€ì(€€€ô(€€€½¹ÍÐ‘…Ñ”€ô¹•Ü…Ñ”¡Ù…±Õ”¤ì(€€€¥˜€¡9Õµ‰•È¹¥Í9…8¡‘…Ñ”¹•ÑQ¥µ” ¤¤¤É•ÑÕÉ¸MÑÉ¥¹œ¡Ù…±Õ”¤ì(€€€É•ÑÕÉ¸‘…Ñ”¹Ñ½1½…±•…Ñ•MÑÉ¥¹œ ™ÈµHœ°ìÑ¥µ•i½¹”è€™É¥„½-¥¹Í¡…Í„œô¤ì(€ô((€ÁÉ¥Ù…Ñ”Í±Õ¥™ä¡Ù…±Õ”èÍÑÉ¥¹œ¤ì(€€€É•ÑÕÉ¸Ù…±Õ”(€€€€€€¹¹½Éµ…±¥é” 9œ¤(€€€€€€¹É•Á±…” ½mqÔÀÌÀÀµqÔÀÌÙ™t½œ°€œœ¤(€€€€€€¹É•Á±…” ½my„µéµhÀ´åt¬½œ°€|œ¤(€€€€€€¹É•Á±…” ½y|­ñ|¬½œ°€œœ¤(€€€€€€¹Í±¥” À°€àÀ¤ñð€‘½Õµ•¹Ðœì(€ô((€ÁÉ¥Ù…Ñ”±•…Í•I•™•É•¹•½‘”¡¥è¹Õµ‰•È¤ì(€€€É•ÑÕÉ¸´‘íMÑÉ¥¹œ¡¥¤¹Á…‘MÑ…ÉÐ Ø°€œÀœ¥õ€ì(€ô((€ÁÉ¥Ù…Ñ”±•…Í•I•™•É•¹•½‘•É½µ9Õµ‰•È¡Ù…±Õ”èÕ¹­¹½Ý¸¤ì(€€€½¹ÍÐ¹Õµ•É¥Œ€ô9Õµ‰•È¡Ù…±Õ”¤ì(€€€¥˜€¡9Õµ‰•È¹¥Í%¹Ñ••È¡¹Õµ•É¥Œ¤€˜˜¹Õµ•É¥Œ€ø€À¤ì(€€€€€É•ÑÕÉ¸´‘íMÑÉ¥¹œ¡¹Õµ•É¥Œ¤¹Á…‘MÑ…ÉÐ Ø°€œÀœ¥õ€ì(€€€ô(€€€É•ÑÕÉ¸€	…¥±}Í…¹Í}É•™•É•¹”œì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ¹•áÑ1•…Í•9Õµ‰•È¡±¥•¹ÐèA½½±±¥•¹Ð°½É…¹¥é…Ñ¥½¹%è¹Õµ‰•È¤ì(€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä M1PÁ}…‘Ù¥Í½Éå}á…Ñ}±½¬¡¡…Í¡Ñ•áÐ Ä¤¤œ°m±•…Í”µ¹Õµ‰•È´‘í½É…¹¥é…Ñ¥½¹%‘õt¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1PIQMP (€€€€€€€€=1M¡5`¡±•…Í•}¹Õµ‰•È¤°€À¤°(€€€€€€€€=U9P ¨¤%1QH€¡]!I±•…Í•}¹Õµ‰•È%L9U10¤(€€€€€€€¤€¬€ÄLÙ…±Õ”(€€€€€€I=4±•…Í•Ì(€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Å€°(€€€€€m½É…¹¥é…Ñ¥½¹%‘t°(€€€€¤ì(€€€É•ÑÕÉ¸9Õµ‰•È¡É½ÝÍlÁtü¹Ù…±Õ”€üü€Ä¤ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ…É¡¥Ù•1•…Í•%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹ÐèA½½±±¥•¹Ð°¥è¹Õµ‰•È°É•…Í½¸üèÍÑÉ¥¹œ¤ì(€€€½¹ÍÐ½É…¹¥é…Ñ¥½¹%€ôÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤ì(€€€½¹ÍÐ…É¡¥Ù•I•…Í½¸€ôMÑÉ¥¹œ¡É•…Í½¸€üü€œœ¤¹ÑÉ¥´ ¤ñð€É¡¥Ù…”‘•™¥¹¥Ñ¥˜œì(€€€½¹ÍÐ±•…Í•I•ÍÕ±Ð€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P¥(€€€€€€I=4±•…Í•Ì(€€€€€€]!I¥€ô€Ä(€€€€€€€€9½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€9‘•±•Ñ•‘}…Ð%L9=P9U10(€€€€€€€€9…É¡¥Ù•‘}…Ð%L9U11€°(€€€€€m¥°½É…¹¥é…Ñ¥½¹%‘t°(€€€€¤ì(€€€É•ÅÕ¥É•I½Ü¡±•…Í•I•ÍÕ±Ð¹É½ÝÍlÁt°€1•…Í”œ¤ì(€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€UAQ±•…Í•Ì(€€€€€€MP‘•±•Ñ•‘}…Ð€ô9U10°(€€€€€€€€€€‘•±•Ñ•‘}‰ä€ô9U10°(€€€€€€€€€€‘•±•Ñ¥½¹}É•…Í½¸€ô9U10°(€€€€€€€€€€…É¡¥Ù•‘}…Ð€ô9=\ ¤°(€€€€€€€€€€…É¡¥Ù•‘}‰ä€ô€È°(€€€€€€€€€€…É¡¥Ù•}É•…Í½¸€ô€Ì°(€€€€€€€€€€ÕÁ‘…Ñ•‘}…Ð€ô9=\ ¤(€€€€€€]!I¥€ô€Ä9½É…¹¥é…Ñ¥½¹}¥€ô€Ñ€°(€€€€€m¥°Ñ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•É% ¤€üü¹Õ±°°…É¡¥Ù•I•…Í½¸°½É…¹¥é…Ñ¥½¹%‘t°(€€€€¤ì(€€€…Ý…¥ÐÑ¡¥Ì¹ÝÉ¥Ñ•1•…Í•Õ‘¥Ð¡±¥•¹Ð°€1M}I!%Yœ°¥°ì…É¡¥Ù•}É•…Í½¸è…É¡¥Ù•I•…Í½¸ô¤ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ±•…Í••±•Ñ¥½¹%µÁ…Ñ%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹ÐèA½½±±¥•¹Ð°¥è¹Õµ‰•È¤ì(€€€½¹ÍÐ½É…¹¥é…Ñ¥½¹%€ôÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤ì(€€€½¹ÍÐ±•…Í•I•ÍÕ±Ð€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P¥°ÍÑ…ÑÕÌ°‘•±•Ñ•‘}…Ð°…É¡¥Ù•‘}…Ð(€€€€€€I=4±•…Í•Ì(€€€€€€]!I¥€ô€Ä9½É…¹¥é…Ñ¥½¹}¥€ô€É€°(€€€€€m¥°½É…¹¥é…Ñ¥½¹%‘t°(€€€€¤ì(€€€½¹ÍÐ±•…Í”€ôÉ•ÅÕ¥É•I½Ü¡±•…Í•I•ÍÕ±Ð¹É½ÝÍlÁt°€1•…Í”œ¤…ÌI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸øì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€(€€€€€€€]%Q ¥¹Ù½¥•}¥‘ÌL€ (€€€€€€€€€M1P¥(€€€€€€€€€I=4¥¹Ù½¥•Ì(€€€€€€€€€]!I±•…Í•}¥€ô€Ä(€€€€€€€€€€€9½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€¤°(€€€€€€€Á…åµ•¹Ñ}¥‘ÌL€ (€€€€€€€€€M1P%MQ%9PÀ¹¥(€€€€€€€€€I=4Á…åµ•¹ÑÌÀ(€€€€€€€€€1P)=%8Á…åµ•¹Ñ}…±±½…Ñ¥½¹ÌÁ„(€€€€€€€€€€€=8Á„¹Á…åµ•¹Ñ}¥€ôÀ¹¥(€€€€€€€€€€9Á„¹½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€€€9Á„¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€€]!IÀ¹½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€€€€9À¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€€€€9€ (€€€€€€€€€€€€€À¹¥¹Ù½¥•}¥%8€¡M1P¥I=4¥¹Ù½¥•}¥‘Ì¤(€€€€€€€€€€€€€=HÁ„¹¥¹Ù½¥•}¥%8€¡M1P¥I=4¥¹Ù½¥•}¥‘Ì¤(€€€€€€€€€€€€¤(€€€€€€€€¤(€€€€€€€M1P(€€€€€€€€€€¡M1P=U9P ¨¤èé%9PI=4¥¹Ù½¥•}¥‘Ì¤L¥¹Ù½¥•Í}½Õ¹Ð°(€€€€€€€€€€¡M1P=U9P ¨¤èé%9PI=4Á…åµ•¹Ñ}¥‘Ì¤LÁ…åµ•¹ÑÍ}½Õ¹Ð°(€€€€€€€€€€ (€€€€€€€€€€€M1P=U9P ¨¤èé%9P(€€€€€€€€€€€I=4…Í¡}µ½Ù•µ•¹ÑÌ´(€€€€€€€€€€€]!I´¹½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€€€€€€9´¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€€€€€€9€ (€€€€€€€€€€€€€€€´¹¥¹Ù½¥•}¥%8€¡M1P¥I=4¥¹Ù½¥•}¥‘Ì¤(€€€€€€€€€€€€€€€=H´¹Á…åµ•¹Ñ}¥%8€¡M1P¥I=4Á…åµ•¹Ñ}¥‘Ì¤(€€€€€€€€€€€€€€¤(€€€€€€€€€€¤L…Í¡}µ½Ù•µ•¹ÑÍ}½Õ¹Ð°(€€€€€€€€€€ (€€€€€€€€€€€M1P=U9P ¨¤èé%9P(€€€€€€€€€€€I=4±•…Í•}Õ…É…¹Ñ••Ìœ(€€€€€€€€€€€]!Iœ¹±•…Í•}¥€ô€Ä(€€€€€€€€€€€€€9œ¹½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€€€€€€9œ¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€€€¤LÕ…É…¹Ñ••Í}½Õ¹Ð°(€€€€€€€€€€ (€€€€€€€€€€€M1P=U9P ¨¤èé%9P(€€€€€€€€€€€I=4±•…Í•}‘½Õµ•¹ÑÌ(€€€€€€€€€€€]!I¹±•…Í•}¥€ô€Ä(€€€€€€€€€€€€€9¹½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€€€€€€9¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€€€¤L‘½Õµ•¹ÑÍ}½Õ¹Ð°(€€€€€€€€€€ (€€€€€€€€€€€M1P=U9P ¨¤èé%9P(€€€€€€€€€€€I=4±•…Í•}½¹ÑÉ…Ñ}•¹•É…Ñ¥½¹Ìœ(€€€€€€€€€€€]!Iœ¹±•…Í•}¥€ô€Ä(€€€€€€€€€€€€€9œ¹½É…¹¥é…Ñ¥½¹}¥€ô€È(€€€€€€€€€€€€€9œ¹‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€€€¤L½¹ÑÉ…Ñ}•¹•É…Ñ¥½¹Í}½Õ¹Ð(€€€€€€°(€€€€€m¥°½É…¹¥é…Ñ¥½¹%‘t°(€€€€¤ì(€€€½¹ÍÐ½Õ¹ÑÌ€ôÉ½ÝÍlÁt€üüíôì(€€€½¹ÍÐ‘•Á•¹‘•¹¥•Ì€ôl(€€€€€ìÑåÁ”è€¥¹Ù½¥•Ìœ°½Õ¹Ðè9Õµ‰•È¡½Õ¹ÑÌ¹¥¹Ù½¥•Í}½Õ¹Ð€üü€À¤ô°(€€€€€ìÑåÁ”è€Á…åµ•¹ÑÌœ°½Õ¹Ðè9Õµ‰•È¡½Õ¹ÑÌ¹Á…åµ•¹ÑÍ}½Õ¹Ð€üü€À¤ô°(€€€€€ìÑåÁ”è€…Í¡}µ½Ù•µ•¹ÑÌœ°½Õ¹Ðè9Õµ‰•È¡½Õ¹ÑÌ¹…Í¡}µ½Ù•µ•¹ÑÍ}½Õ¹Ð€üü€À¤ô°(€€€€€ìÑåÁ”è€±•…Í•}Õ…É…¹Ñ••Ìœ°½Õ¹Ðè9Õµ‰•È¡½Õ¹ÑÌ¹Õ…É…¹Ñ••Í}½Õ¹Ð€üü€À¤ô°(€€€€€ìÑåÁ”è€±•…Í•}‘½Õµ•¹ÑÌœ°½Õ¹Ðè9Õµ‰•È¡½Õ¹ÑÌ¹‘½Õµ•¹ÑÍ}½Õ¹Ð€üü€À¤ô°(€€€€€ìÑåÁ”è€±•…Í•}½¹ÑÉ…Ñ}•¹•É…Ñ¥½¹Ìœ°½Õ¹Ðè9Õµ‰•È¡½Õ¹ÑÌ¹½¹ÑÉ…Ñ}•¹•É…Ñ¥½¹Í}½Õ¹Ð€üü€À¤ô°(€€€t¹™¥±Ñ•È ¡•¹ÑÉä¤€ôø•¹ÑÉä¹½Õ¹Ð€ø€À¤ì(€€€½¹ÍÐ¡…Í¥¹…¹¥…±!¥ÍÑ½Éä€ô‘•Á•¹‘•¹¥•Ì¹Í½µ” ¡•¹ÑÉä¤€ôø(€€€€€•¹ÑÉä¹ÑåÁ”€ôôô€¥¹Ù½¥•Ìœ(€€€€€ñð•¹ÑÉä¹ÑåÁ”€ôôô€Á…åµ•¹ÑÌœ(€€€€€ñð•¹ÑÉä¹ÑåÁ”€ôôô€…Í¡}µ½Ù•µ•¹ÑÌœ(€€€€€ñð•¹ÑÉä¹ÑåÁ”€ôôô€±•…Í•}Õ…É…¹Ñ••Ìœ°(€€€€¤ì(€€€É•ÑÕÉ¸ì(€€€€€±•…Í•}¥è¥°(€€€€€±•…Í•}ÍÑ…ÑÕÌèMÑÉ¥¹œ¡±•…Í”¹ÍÑ…ÑÕÌ€üü€œœ¤°(€€€€€‘•±•Ñ•‘}…Ðè±•…Í”¹‘•±•Ñ•‘}…Ð€üü¹Õ±°°(€€€€€…É¡¥Ù•‘}…Ðè±•…Í”¹…É¡¥Ù•‘}…Ð€üü¹Õ±°°(€€€€€…¹!…É‘•±•Ñ”è‘•Á•¹‘•¹¥•Ì¹±•¹Ñ €ôôô€À°(€€€€€¡…Í¥¹…¹¥…±!¥ÍÑ½Éä°(€€€€€‘•Á•¹‘•¹¥•Ì°(€€€ôì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÝÉ¥Ñ•1•…Í•Õ‘¥Ð¡±¥•¹ÐèA½½±±¥•¹Ð°…Ñ¥½¸èÍÑÉ¥¹œ°±•…Í•%è¹Õµ‰•È°µ•Ñ…‘…Ñ„èI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø¤ì(€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€%9MIP%9Q<…Õ‘¥Ñ}±½Ì€¡½É…¹¥é…Ñ¥½¹}¥°ÕÍ•É}¥°…Ñ¥½¸°É•Í½ÕÉ”°É•Í½ÕÉ•}¥°µ•Ñ¡½°Á…Ñ °ÍÑ…ÑÕÍ}½‘”°µ•Ñ…‘…Ñ„¤(€€€€€€Y1UL€ Ä°€È°€Ì°€±•…Í•Ìœ°€Ð°€AQ œ°€Ô°€ÈÀÀ°€Ø¥€°(€€€€€l(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•É% ¤€üü¹Õ±°°(€€€€€€€…Ñ¥½¸°(€€€€€€€MÑÉ¥¹œ¡±•…Í•%¤°(€€€€€€€€½…Á¤½±•…Í•Ì¼‘í±•…Í•%‘õ€°(€€€€€€€)M=8¹ÍÑÉ¥¹¥™ä¡µ•Ñ…‘…Ñ„¤°(€€€€€t°(€€€€¤ì(€ô((€ÁÉ¥Ù…Ñ”‰Õ¥±‘1•…Í•A‘™¥±•9…µ”¡±•…Í•%è¹Õµ‰•È°½¹ÑÉ…Ñ%è¹Õµ‰•È°Ñ•µÁ±…Ñ•Y•ÉÍ¥½¸è¹Õµ‰•È¤ì(€€€½¹ÍÐ±•…Í•I•™•É•¹”€ôÑ¡¥Ì¹±•…Í•I•™•É•¹•½‘”¡±•…Í•%¤ì(€€€½¹ÍÐ™¥±•9…µ”€ô€‘í±•…Í•I•™•É•¹•ôµ‘í½¹ÑÉ…Ñ%‘ôµX‘íÑ•µÁ±…Ñ•Y•ÉÍ¥½¹ô¹Á‘™€ì(€€€É•ÑÕÉ¸™¥±•9…µ”¹±•¹Ñ €ðô€ÔÀ€ü™¥±•9…µ”€è±•…Í”´‘í±•…Í•%‘ôµ‘í½¹ÑÉ…Ñ%‘ôµX‘íÑ•µÁ±…Ñ•Y•ÉÍ¥½¹ô¹Á‘™€ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÉ•…Ñ••™…Õ±Ñ½µÁ…¹åM•ÑÑ¥¹Ì ¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€%9MIP%9Q<½µÁ…¹å}Í•ÑÑ¥¹Ì€ (€€€€€€€€½É…¹¥é…Ñ¥½¹}¥°½µÁ…¹å}¹…µ”°±•…±}¹…µ”°½µÁ…¹å}±•…±}¹…µ”°…‘‘É•ÍÌ°½µÁ…¹å}…‘‘É•ÍÌ°½µÁ…¹å}¥Ñä°½µÁ…¹å}½Õ¹ÑÉä°(€€€€€€€€ÕÉÉ•¹ä°±…¹Õ…”°Ñ¥µ•é½¹”°¥¹Ù½¥•}™½½Ñ•È°¥¹Ù½¥•}‰½ÑÑ½µ}Ñ•áÐ°(€€€€€€€€‘•™…Õ±Ñ}±•…Í•}‘ÕÉ…Ñ¥½¹}µ½¹Ñ¡Ì°‘•™…Õ±Ñ}¹½Ñ¥•}µ½¹Ñ¡Ì°‘•™…Õ±Ñ}Õ…É…¹Ñ••}µ½¹Ñ¡Ì°(€€€€€€€€‘•™…Õ±Ñ}Í¥¹…ÑÕÉ•}Á±…”°‘•™…Õ±Ñ}±•…Í•}ÕÍ…”°‘•™…Õ±Ñ}½¹ÑÉ…Ñ}Ñ•µÁ±…Ñ•}½‘”°É•…Ñ•‘}‰ä(€€€€€€€¤(€€€€€€Y1UL€ (€€€€€€€€€Ä°€•µ¼AÉ½Á•ÉÑäI@œ°€•µ¼AÉ½Á•ÉÑäI@œ°€•µ¼AÉ½Á•ÉÑäI@œ°€œÈÈÙ•¹Õ”‘•Ìƒ%ÕÉ¥•Ìœ°€œÈÈÙ•¹Õ”‘•Ìƒ%ÕÉ¥•Ìœ°€-¥¹Í¡…Í„œ°€Iœ°(€€€€€€€€€UMœ°€™Èœ°€™É¥„½-¥¹Í¡…Í„œ°€5•É¤Á½ÕÈÙ½ÑÉ”½¹™¥…¹”¸œ°€…ÑÕÉ”•¹•É•”Á…ÈAÉ½Á•ÉÑäI@¸œ°(€€€€€€€€€ÄÈ°€Ä°€Ì°€-¥¹Í¡…Í„œ°€IM%9Q%0œ°€1M}IM%9Q%0œ°€È(€€€€€€€¤(€€€€€€=8=91%P€¡½É…¹¥é…Ñ¥½¹}¥¤<UAQMP½É…¹¥é…Ñ¥½¹}¥€ôa1U¹½É…¹¥é…Ñ¥½¹}¥(€€€€€€IQUI9%9€©€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°Ñ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•É% ¤€üü€Åt°(€€€€¤ì(€€€É•ÑÕÉ¸É½ÝÍlÁtì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ½µÁ…¹åM•ÑÑ¥¹ÍI…Ü ¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1P€¨(€€€€€€I=4½µÁ…¹å}Í•ÑÑ¥¹Ì(€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Ä9‘•±•Ñ•‘}…Ð%L9U11€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€É•ÑÕÉ¸É½ÝÍlÁt€üü¹Õ±°ì(€ô((€ÁÉ¥Ù…Ñ”½µÁ…¹åM•ÑÑ¥¹ÍI½Ü¡É½ÜèI•½ÉñÍÑÉ¥¹œ°…¹äø¤ì(€€€É•ÑÕÉ¸ì(€€€€€€¸¸¹É½Ü°(€€€€€±½½}™¥±•}¹…µ”èÉ½Ü¹±½½}™¥±•}¹…µ”€üüÑ¡¥Ì¹±•…å¥±•9…µ”¡É½Ü¹±½½}ÕÉ°¤°(€€€€€±½½}™¥±•}ÕÉ°èÉ½Ü¹±½½}™¥±•}ÕÉ°€üüÉ½Ü¹±½½}ÕÉ°€üü€¡É½Ü¹±½½}™¥±•}¹…µ”€üÑ¡¥Ì¹½µÁ…¹å¥±•I½ÕÑ” ±½¼œ¤€è¹Õ±°¤°(€€€€€Í¥¹…ÑÕÉ•}™¥±•}¹…µ”èÉ½Ü¹Í¥¹…ÑÕÉ•}™¥±•}¹…µ”€üüÑ¡¥Ì¹±•…å¥±•9…µ”¡É½Ü¹Í¥¹…ÑÕÉ•}ÕÉ°¤°(€€€€€Í¥¹…ÑÕÉ•}™¥±•}ÕÉ°è(€€€€€€€É½Ü¹Í¥¹…ÑÕÉ•}™¥±•}ÕÉ°€üüÉ½Ü¹Í¥¹…ÑÕÉ•}ÕÉ°€üü€¡É½Ü¹Í¥¹…ÑÕÉ•}™¥±•}¹…µ”€üÑ¡¥Ì¹½µÁ…¹å¥±•I½ÕÑ” Í¥¹…ÑÕÉ”œ¤€è¹Õ±°¤°(€€€€€ÍÑ…µÁ}™¥±•}¹…µ”èÉ½Ü¹ÍÑ…µÁ}™¥±•}¹…µ”€üüÑ¡¥Ì¹±•…å¥±•9…µ”¡É½Ü¹ÍÑ…µÁ}ÕÉ°¤°(€€€€€ÍÑ…µÁ}™¥±•}ÕÉ°èÉ½Ü¹ÍÑ…µÁ}™¥±•}ÕÉ°€üüÉ½Ü¹ÍÑ…µÁ}ÕÉ°€üü€¡É½Ü¹ÍÑ…µÁ}™¥±•}¹…µ”€üÑ¡¥Ì¹½µÁ…¹å¥±•I½ÕÑ” ÍÑ…µÀœ¤€è¹Õ±°¤°(€€€€€±½½}ÕÉ°èÉ½Ü¹±½½}ÕÉ°€üüÉ½Ü¹±½½}™¥±•}ÕÉ°€üü¹Õ±°°(€€€€€Í¥¹…ÑÕÉ•}ÕÉ°èÉ½Ü¹Í¥¹…ÑÕÉ•}ÕÉ°€üüÉ½Ü¹Í¥¹…ÑÕÉ•}™¥±•}ÕÉ°€üü¹Õ±°°(€€€€€ÍÑ…µÁ}ÕÉ°èÉ½Ü¹ÍÑ…µÁ}ÕÉ°€üüÉ½Ü¹ÍÑ…µÁ}™¥±•}ÕÉ°€üü¹Õ±°°(€€€€€½µÁ…¹å}±•…±}¹…µ•}É•Í½±Ù•èÉ½Ü¹½µÁ…¹å}±•…±}¹…µ”€üüÉ½Ü¹±•…±}¹…µ”€üüÉ½Ü¹½µÁ…¹å}¹…µ”€üü€œœ°(€€€€€½µÁ…¹å}…‘‘É•ÍÍ}É•Í½±Ù•èÉ½Ü¹½µÁ…¹å}…‘‘É•ÍÌ€üüÉ½Ü¹…‘‘É•ÍÌ€üü€œœ°(€€€ôì(€ô((€ÁÉ¥Ù…Ñ”¹½Éµ…±¥é•½µÁ…¹å¥±•-¥¹¡­¥¹èÍÑÉ¥¹œ¤ì(€€€½¹ÍÐ¹½Éµ…±¥é•€ôMÑÉ¥¹œ¡­¥¹€üü€œœ¤¹ÑÉ¥´ ¤¹Ñ½1½Ý•É…Í” ¤ì(€€€¥˜€ …Ñ¡¥Ì¹…±±½Ý•‘½µÁ…¹å¥±•-¥¹‘Ì¹¡…Ì¡¹½Éµ…±¥é•¤¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ QåÁ”‘”™¥¡¥•È¥¹Ù…±¥‘”œ¤ì(€€€ô(€€€É•ÑÕÉ¸¹½Éµ…±¥é•ì(€ô((€ÁÉ¥Ù…Ñ”½µÁ…¹å¥±•I½ÕÑ”¡­¥¹èÍÑÉ¥¹œ¤ì(€€€É•ÑÕÉ¸€½…Á¤½Í•ÑÑ¥¹Ì½½µÁ…¹äµ™¥±•Ì¼‘í­¥¹‘õ€ì(€ô((€ÁÉ¥Ù…Ñ”½µÁ…¹åMÑ½É…•A…Ñ ¡­¥¹èÍÑÉ¥¹œ°™¥±•9…µ”èÍÑÉ¥¹œ¤ì(€€€É•ÑÕÉ¸½µÁ…¹ä¼‘íÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥ô¼‘í­¥¹‘ô¼‘íÑ¡¥Ì¹Í…¹¥Ñ¥é•MÑ½É…•¥±•9…µ”¡™¥±•9…µ”¥õ€ì(€ô((€ÁÉ¥Ù…Ñ”Í…¹¥Ñ¥é•MÑ½É…•¥±•9…µ”¡™¥±•9…µ”èÍÑÉ¥¹œ¤ì(€€€½¹ÍÐ‰…Í”€ôMÑÉ¥¹œ¡™¥±•9…µ”€üü€œœ¤¹É•Á±…” ½mqp½t½œ°€|œ¤¹ÑÉ¥´ ¤ì(€€€É•ÑÕÉ¸‰…Í”¹É•Á±…” ½qÌ¬½œ°€|œ¤¹É•Á±…” ½my„µéµhÀ´å|¸µt½œ°€|œ¤ñð€™¥±”œì(€ô((€ÁÉ¥Ù…Ñ”½É¥¥¹…±¥±•9…µ”¡™¥±•9…µ”èÍÑÉ¥¹œ¤ì(€€€½¹ÍÐÑÉ¥µµ•€ôMÑÉ¥¹œ¡™¥±•9…µ”€üü€œœ¤¹ÑÉ¥´ ¤ì(€€€É•ÑÕÉ¸ÑÉ¥µµ•ñð€™¥±”œì(€ô((€ÁÉ¥Ù…Ñ”±•…å¥±•9…µ”¡Ù…±Õ”èÕ¹­¹½Ý¸¤ì(€€€¥˜€ …Ù…±Õ”¤É•ÑÕÉ¸¹Õ±°ì(€€€½¹ÍÐÑ•áÐ€ôMÑÉ¥¹œ¡Ù…±Õ”¤¹ÑÉ¥´ ¤ì(€€€¥˜€ …Ñ•áÐ¤É•ÑÕÉ¸¹Õ±°ì(€€€½¹ÍÐ±…ÍÐ€ôÑ•áÐ¹ÍÁ±¥Ð œüœ¥lÁt¹ÍÁ±¥Ð œ¼œ¤¹Á½À ¤ü¹ÑÉ¥´ ¤ì(€€€É•ÑÕÉ¸±…ÍÐñð¹Õ±°ì(€ô((€ÁÉ¥Ù…Ñ”ÍÑ½É…•½¹™¥œ ¤ì(€€€½¹ÍÐÍÕÁ…‰…Í•UÉ°€ôÁÉ½•ÍÌ¹•¹Ø¹MUA	M}UI0ì(€€€½¹ÍÐÍ•ÉÙ¥•I½±•-•ä€ôÁÉ½•ÍÌ¹•¹Ø¹MUA	M}MIY%}I=1}-dì(€€€¥˜€ …ÍÕÁ…‰…Í•UÉ°ñð€…Í•ÉÙ¥•I½±•-•ä¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ ½¹™¥ÕÉ…Ñ¥½¸MÕÁ…‰…Í”µ…¹ÅÕ…¹Ñ”œ¤ì(€€€ô(€€€É•ÑÕÉ¸ì(€€€€€ÍÕÁ…‰…Í•UÉ°èÍÕÁ…‰…Í•UÉ°¹É•Á±…” ½p¼¼°€œœ¤°(€€€€€Í•ÉÙ¥•I½±•-•ä°(€€€ôì(€ô((€ÁÉ¥Ù…Ñ”¡…ÍMÑ½É…•½¹™¥œ ¤ì(€€€É•ÑÕÉ¸	½½±•…¸¡ÁÉ½•ÍÌ¹•¹Ø¹MUA	M}UI0€˜˜ÁÉ½•ÍÌ¹•¹Ø¹MUA	M}MIY%}I=1}-d¤ì(€ô((€ÁÉ¥Ù…Ñ”Ù…±¥‘…Ñ•½µÁ…¹å¥±”¡™¥±”èìµ¥µ•ÑåÁ”èÍÑÉ¥¹œìÍ¥é”è¹Õµ‰•Èô¤ì(€€€¥˜€¡™¥±”¹Í¥é”€ø€Ô€¨€ÄÀÈÐ€¨€ÄÀÈÐ¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1”™¥¡¥•È¹”Á•ÕÐÁ…Ì‘•Á…ÍÍ•È€Ô5¼œ¤ì(€€€ô(€€€½¹ÍÐµ¥µ•QåÁ”€ôMÑÉ¥¹œ¡™¥±”¹µ¥µ•ÑåÁ”€üü€œœ¤¹Ñ½1½Ý•É…Í” ¤ì(€€€¥˜€ …Ñ¡¥Ì¹…±±½Ý•‘½µÁ…¹å¥±•5¥µ•QåÁ•Ì¹¡…Ì¡µ¥µ•QåÁ”¤¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ ½Éµ…Ð‘”™¥¡¥•È¹½¸…ÕÑ½É¥Í”œ¤ì(€€€ô(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÕÁ±½…‘Q½½µÁ…¹åMÑ½É…”¡­¥¹èÍÑÉ¥¹œ°™¥±•9…µ”èÍÑÉ¥¹œ°™¥±”èìµ¥µ•ÑåÁ”èÍÑÉ¥¹œì‰Õ™™•Èè	Õ™™•Èô¤ì(€€€½¹ÍÐìÍÕÁ…‰…Í•UÉ°°Í•ÉÙ¥•I½±•-•äô€ôÑ¡¥Ì¹ÍÑ½É…•½¹™¥œ ¤ì(€€€½¹ÍÐÍÑ½É…•A…Ñ €ôÑ¡¥Ì¹½µÁ…¹åMÑ½É…•A…Ñ ¡­¥¹°™¥±•9…µ”¤ì(€€€½¹ÍÐÉ•ÍÁ½¹Í”€ô…Ý…¥Ð™•Ñ ¡€‘íÍÕÁ…‰…Í•UÉ±ô½ÍÑ½É…”½ØÄ½½‰©•Ð¼‘íÑ¡¥Ì¹½µÁ…¹åMÑ½É…•	Õ­•Ñô¼‘íÑ¡¥Ì¹•¹½‘•MÑ½É…•A…Ñ ¡ÍÑ½É…•A…Ñ ¥õ€°ì(€€€€€µ•Ñ¡½è€A=MPœ°(€€€€€¡•…‘•ÉÌèì(€€€€€€€ÕÑ¡½É¥é…Ñ¥½¸è	•…É•È€‘íÍ•ÉÙ¥•I½±•-•åõ€°(€€€€€€€…Á¥­•äèÍ•ÉÙ¥•I½±•-•ä°(€€€€€€€€àµÕÁÍ•ÉÐœè€ÑÉÕ”œ°(€€€€€€€€½¹Ñ•¹ÐµÑåÁ”œè™¥±”¹µ¥µ•ÑåÁ”°(€€€€€ô°(€€€€€‰½‘äè™¥±”¹‰Õ™™•È¹‰Õ™™•È¹Í±¥”¡™¥±”¹‰Õ™™•È¹‰åÑ•=™™Í•Ð°™¥±”¹‰Õ™™•È¹‰åÑ•=™™Í•Ð€¬™¥±”¹‰Õ™™•È¹‰åÑ•1•¹Ñ ¤…ÌÉÉ…å	Õ™™•È°(€€€ô¤ì(€€€¥˜€ …É•ÍÁ½¹Í”¹½¬¤ì(€€€€€½¹ÍÐ‘•Ñ…¥±Ì€ô…Ý…¥ÐÉ•ÍÁ½¹Í”¹Ñ•áÐ ¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸¡‘•Ñ…¥±Ìñð%µÁ½ÍÍ¥‰±”‘”Ñ•±•Ù•ÉÍ•È±”™¥¡¥•È€ ‘íÉ•ÍÁ½¹Í”¹ÍÑ…ÑÕÍô¥€¤ì(€€€ô(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ‘•±•Ñ•É½µ½µÁ…¹åMÑ½É…”¡­¥¹èÍÑÉ¥¹œ°™¥±•9…µ”èÍÑÉ¥¹œ¤ì(€€€½¹ÍÐìÍÕÁ…‰…Í•UÉ°°Í•ÉÙ¥•I½±•-•äô€ôÑ¡¥Ì¹ÍÑ½É…•½¹™¥œ ¤ì(€€€½¹ÍÐÍÑ½É…•A…Ñ €ôÑ¡¥Ì¹½µÁ…¹åMÑ½É…•A…Ñ ¡­¥¹°™¥±•9…µ”¤ì(€€€½¹ÍÐÉ•ÍÁ½¹Í”€ô…Ý…¥Ð™•Ñ ¡€‘íÍÕÁ…‰…Í•UÉ±ô½ÍÑ½É…”½ØÄ½½‰©•Ð¼‘íÑ¡¥Ì¹½µÁ…¹åMÑ½É…•	Õ­•Ñô¼‘íÑ¡¥Ì¹•¹½‘•MÑ½É…•A…Ñ ¡ÍÑ½É…•A…Ñ ¥õ€°ì(€€€€€µ•Ñ¡½è€1Qœ°(€€€€€¡•…‘•ÉÌèì(€€€€€€€ÕÑ¡½É¥é…Ñ¥½¸è	•…É•È€‘íÍ•ÉÙ¥•I½±•-•åõ€°(€€€€€€€…Á¥­•äè€‘íÍ•ÉÙ¥•I½±•-•åõ€°(€€€€€ô°(€€€ô¤ì(€€€¥˜€ …É•ÍÁ½¹Í”¹½¬€˜˜É•ÍÁ½¹Í”¹ÍÑ…ÑÕÌ€„ôô€ÐÀÐ¤ì(€€€€€½¹ÍÐ‘•Ñ…¥±Ì€ô…Ý…¥ÐÉ•ÍÁ½¹Í”¹Ñ•áÐ ¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸¡‘•Ñ…¥±Ìñð%µÁ½ÍÍ¥‰±”‘”ÍÕÁÁÉ¥µ•È±”™¥¡¥•È€ ‘íÉ•ÍÁ½¹Í”¹ÍÑ…ÑÕÍô¥€¤ì(€€€ô(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ‘½Ý¹±½…‘½µÁ…¹åMÑ½É…”¡­¥¹èÍÑÉ¥¹œ°™¥±•9…µ”èÍÑÉ¥¹œ¤ì(€€€½¹ÍÐìÍÕÁ…‰…Í•UÉ°°Í•ÉÙ¥•I½±•-•äô€ôÑ¡¥Ì¹ÍÑ½É…•½¹™¥œ ¤ì(€€€½¹ÍÐÍÑ½É…•A…Ñ €ôÑ¡¥Ì¹½µÁ…¹åMÑ½É…•A…Ñ ¡­¥¹°™¥±•9…µ”¤ì(€€€½¹ÍÐÉ•ÍÁ½¹Í”€ô…Ý…¥Ð™•Ñ ¡€‘íÍÕÁ…‰…Í•UÉ±ô½ÍÑ½É…”½ØÄ½½‰©•Ð¼‘íÑ¡¥Ì¹½µÁ…¹åMÑ½É…•	Õ­•Ñô¼‘íÑ¡¥Ì¹•¹½‘•MÑ½É…•A…Ñ ¡ÍÑ½É…•A…Ñ ¥õ€°ì(€€€€€¡•…‘•ÉÌèì(€€€€€€€ÕÑ¡½É¥é…Ñ¥½¸è	•…É•È€‘íÍ•ÉÙ¥•I½±•-•åõ€°(€€€€€€€…Á¥­•äèÍ•ÉÙ¥•I½±•-•ä°(€€€€€ô°(€€€ô¤ì(€€€¥˜€ …É•ÍÁ½¹Í”¹½¬¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸¡¥¡¥•È¥¹ÑÉ½ÕÙ…‰±”€ ‘íÉ•ÍÁ½¹Í”¹ÍÑ…ÑÕÍô¥€¤ì(€€€ô(€€€½¹ÍÐ‰Õ™™•È€ô	Õ™™•È¹™É½´¡…Ý…¥ÐÉ•ÍÁ½¹Í”¹…ÉÉ…å	Õ™™•È ¤¤ì(€€€É•ÑÕÉ¸ì(€€€€€‰Õ™™•È°(€€€€€µ¥µ•QåÁ”èÉ•ÍÁ½¹Í”¹¡•…‘•ÉÌ¹•Ð ½¹Ñ•¹ÐµÑåÁ”œ¤€üü€…ÁÁ±¥…Ñ¥½¸½½Ñ•ÐµÍÑÉ•…´œ°(€€€€€‘½Ý¹±½…‘9…µ”è™¥±•9…µ”°(€€€ôì(€ô((€ÁÉ¥Ù…Ñ”±•…Í•½¹ÑÉ…Ñ½Ý¹±½…‘I½ÕÑ”¡±•…Í•%è¹Õµ‰•È°½¹ÑÉ…Ñ%è¹Õµ‰•È¤ì(€€€É•ÑÕÉ¸€½…Á¤½±•…Í•Ì¼‘í±•…Í•%‘ô½½¹ÑÉ…ÑÌ¼‘í½¹ÑÉ…Ñ%‘ô½‘½Ý¹±½…‘€ì(€ô((€ÁÉ¥Ù…Ñ”±•…Í•½¹ÑÉ…ÑMÑ½É…•A…Ñ ¡±•…Í•%è¹Õµ‰•È°½¹ÑÉ…Ñ%è¹Õµ‰•È°Ñ•µÁ±…Ñ•Y•ÉÍ¥½¸è¹Õµ‰•È°•¹•É…Ñ•‘Ðè…Ñ”°™¥±•9…µ”èÍÑÉ¥¹œ¤ì(€€€½¹ÍÐÑ¥µ•ÍÑ…µÀ€ô•¹•É…Ñ•‘Ð¹Ñ½%M=MÑÉ¥¹œ ¤¹É•Á±…” ½l´ét½œ°€œœ¤¹É•Á±…” ½p¹q‘ìÍõh¼°€hœ¤ì(€€€É•ÑÕÉ¸½¹ÑÉ…ÑÌ¼‘íÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥ô½±•…Í•Ì¼‘í±•…Í•%‘ô½½¹ÑÉ…Ð´‘í½¹ÑÉ…Ñ%‘ôµØ‘íÑ•µÁ±…Ñ•Y•ÉÍ¥½¹ô´‘íÑ¥µ•ÍÑ…µÁô´‘íÑ¡¥Ì¹Í…¹¥Ñ¥é•MÑ½É…•¥±•9…µ”¡™¥±•9…µ”¥õ€ì(€ô((€ÁÉ¥Ù…Ñ”±•…å1•…Í•½¹ÑÉ…ÑMÑ½É…•A…Ñ ¡±•…Í•%è¹Õµ‰•È°½¹ÑÉ…Ñ%è¹Õµ‰•È°™¥±•9…µ”èÍÑÉ¥¹œ¤ì(€€€É•ÑÕÉ¸±•…Í•Ì¼‘íÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥ô½½¹ÑÉ…ÑÌ¼‘í±•…Í•%‘ô¼‘í½¹ÑÉ…Ñ%‘ô¼‘íÑ¡¥Ì¹Í…¹¥Ñ¥é•MÑ½É…•¥±•9…µ”¡™¥±•9…µ”¥õ€ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ™¥¹‘1•…Í•½¹ÑÉ…ÑMÑ½É…•A…Ñ¡	åAÉ•™¥à (€€€±•…Í•%è¹Õµ‰•È°(€€€½¹ÑÉ…Ñ%è¹Õµ‰•È°(€€€Ñ•µÁ±…Ñ•Y•ÉÍ¥½¸è¹Õµ‰•È°(€€€™¥±•9…µ”èÍÑÉ¥¹œ°(€€¤ì(€€€¥˜€ …Ñ¡¥Ì¹¡…ÍMÑ½É…•½¹™¥œ ¤¤É•ÑÕÉ¸¹Õ±°ì(€€€½¹ÍÐìÍÕÁ…‰…Í•UÉ°°Í•ÉÙ¥•I½±•-•äô€ôÑ¡¥Ì¹ÍÑ½É…•½¹™¥œ ¤ì(€€€½¹ÍÐ™½±‘•È€ô½¹ÑÉ…ÑÌ¼‘íÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥ô½±•…Í•Ì¼‘í±•…Í•%‘õ€ì(€€€½¹ÍÐÉ•ÍÁ½¹Í”€ô…Ý…¥Ð™•Ñ ¡€‘íÍÕÁ…‰…Í•UÉ±ô½ÍÑ½É…”½ØÄ½½‰©•Ð½±¥ÍÐ¼‘íÑ¡¥Ì¹±•…Í•½¹ÑÉ…ÑMÑ½É…•	Õ­•Ñõ€°ì(€€€€€µ•Ñ¡½è€A=MPœ°(€€€€€¡•…‘•ÉÌèì(€€€€€€€ÕÑ¡½É¥é…Ñ¥½¸è	•…É•È€‘íÍ•ÉÙ¥•I½±•-•åõ€°(€€€€€€€…Á¥­•äèÍ•ÉÙ¥•I½±•-•ä°(€€€€€€€€½¹Ñ•¹ÐµÑåÁ”œè€…ÁÁ±¥…Ñ¥½¸½©Í½¸œ°(€€€€€ô°(€€€€€‰½‘äè)M=8¹ÍÑÉ¥¹¥™ä¡ì(€€€€€€€ÁÉ•™¥àè™½±‘•È°(€€€€€€€±¥µ¥Ðè€ÄÀÀ°(€€€€€€€½™™Í•Ðè€À°(€€€€€€€Í½ÉÑ	äèì½±Õµ¸è€¹…µ”œ°½É‘•Èè€‘•ÍŒœô°(€€€€€ô¤°(€€€ô¤ì(€€€¥˜€ …É•ÍÁ½¹Í”¹½¬¤ì(€€€€€É•ÑÕÉ¸¹Õ±°ì(€€€ô(€€€½¹ÍÐ½‰©•ÑÌ€ô€¡…Ý…¥ÐÉ•ÍÁ½¹Í”¹©Í½¸ ¤¤…ÌÉÉ…äñì¹…µ”üèÍÑÉ¥¹œìÕÁ‘…Ñ•‘}…ÐüèÍÑÉ¥¹œìÉ•…Ñ•‘}…ÐüèÍÑÉ¥¹œôøð¹Õ±°ì(€€€½¹ÍÐÁÉ•™¥à€ô½¹ÑÉ…Ð´‘í½¹ÑÉ…Ñ%‘ôµØ‘íÑ•µÁ±…Ñ•Y•ÉÍ¥½¹ôµ€ì(€€€½¹ÍÐÍ…¹¥Ñ¥é•‘¥±•9…µ”€ôÑ¡¥Ì¹Í…¹¥Ñ¥é•MÑ½É…•¥±•9…µ”¡™¥±•9…µ”¤ì(€€€½¹ÍÐ…¹‘¥‘…Ñ•Ì€ô€¡½‰©•ÑÌ€üümt¤(€€€€€€¹™¥±Ñ•È ¡•¹ÑÉä¤€ôøì(€€€€€€€½¹ÍÐ¹…µ”€ôMÑÉ¥¹œ¡•¹ÑÉäü¹¹…µ”€üü€œœ¤ì(€€€€€€€É•ÑÕÉ¸¹…µ”¹ÍÑ…ÉÑÍ]¥Ñ ¡ÁÉ•™¥à¤€˜˜¹…µ”¹Ñ½1½Ý•É…Í” ¤¹•¹‘Í]¥Ñ  œ¹Á‘˜œ¤ì(€€€€€ô¤(€€€€€€¹Í½ÉÐ ¡±•™Ð°É¥¡Ð¤€ôøì(€€€€€€€½¹ÍÐ±•™Ñ…Ñ”€ô¹•Ü…Ñ”¡MÑÉ¥¹œ¡±•™Ð¹ÕÁ‘…Ñ•‘}…Ð€üü±•™Ð¹É•…Ñ•‘}…Ð€üü€œœ¤¤¹•ÑQ¥µ” ¤ì(€€€€€€€½¹ÍÐÉ¥¡Ñ…Ñ”€ô¹•Ü…Ñ”¡MÑÉ¥¹œ¡É¥¡Ð¹ÕÁ‘…Ñ•‘}…Ð€üüÉ¥¡Ð¹É•…Ñ•‘}…Ð€üü€œœ¤¤¹•ÑQ¥µ” ¤ì(€€€€€€€É•ÑÕÉ¸É¥¡Ñ…Ñ”€´±•™Ñ…Ñ”ì(€€€€€ô¤ì(€€€½¹ÍÐ•á…Ñ5…Ñ €ô…¹‘¥‘…Ñ•Ì¹™¥¹ ¡•¹ÑÉä¤€ôøMÑÉ¥¹œ¡•¹ÑÉä¹¹…µ”¤¹•¹‘Í]¥Ñ ¡€´‘íÍ…¹¥Ñ¥é•‘¥±•9…µ•õ€¤¤ì(€€€½¹ÍÐÍ•±•Ñ•€ô•á…Ñ5…Ñ €üü…¹‘¥‘…Ñ•ÍlÁtì(€€€É•ÑÕÉ¸Í•±•Ñ•€ü€‘í™½±‘•Éô¼‘íMÑÉ¥¹œ¡Í•±•Ñ•¹¹…µ”¥õ€€è¹Õ±°ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÕÁ±½…‘1•…Í•½¹ÑÉ…Ñ½áQ½MÑ½É…”¡ÍÑ½É…•A…Ñ èÍÑÉ¥¹œ°‰Õ™™•Èè	Õ™™•È¤ì(€€€½¹ÍÐìÍÕÁ…‰…Í•UÉ°°Í•ÉÙ¥•I½±•-•äô€ôÑ¡¥Ì¹ÍÑ½É…•½¹™¥œ ¤ì(€€€½¹ÍÐÉ•ÍÁ½¹Í”€ô…Ý…¥Ð™•Ñ ¡€‘íÍÕÁ…‰…Í•UÉ±ô½ÍÑ½É…”½ØÄ½½‰©•Ð¼‘íÑ¡¥Ì¹±•…Í•½¹ÑÉ…ÑMÑ½É…•	Õ­•Ñô¼‘íÑ¡¥Ì¹•¹½‘•MÑ½É…•A…Ñ ¡ÍÑ½É…•A…Ñ ¥õ€°ì(€€€€€µ•Ñ¡½è€A=MPœ°(€€€€€¡•…‘•ÉÌèì(€€€€€€€ÕÑ¡½É¥é…Ñ¥½¸è	•…É•È€‘íÍ•ÉÙ¥•I½±•-•åõ€°(€€€€€€€…Á¥­•äèÍ•ÉÙ¥•I½±•-•ä°(€€€€€€€€½¹Ñ•¹ÐµÑåÁ”œè€…ÁÁ±¥…Ñ¥½¸½Ù¹¹½Á•¹áµ±™½Éµ…ÑÌµ½™™¥•‘½Õµ•¹Ð¹Ý½É‘ÁÉ½•ÍÍ¥¹µ°¹‘½Õµ•¹Ðœ°(€€€€€ô°(€€€€€‰½‘äè‰Õ™™•È¹‰Õ™™•È¹Í±¥”¡‰Õ™™•È¹‰åÑ•=™™Í•Ð°‰Õ™™•È¹‰åÑ•=™™Í•Ð€¬‰Õ™™•È¹‰åÑ•1•¹Ñ ¤…ÌÉÉ…å	Õ™™•È°(€€€ô¤ì(€€€¥˜€ …É•ÍÁ½¹Í”¹½¬¤ì(€€€€€½¹ÍÐ‘•Ñ…¥±Ì€ô…Ý…¥ÐÉ•ÍÁ½¹Í”¹Ñ•áÐ ¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸¡‘•Ñ…¥±Ìñð%µÁ½ÍÍ¥‰±”‘”Ñ•±•Ù•ÉÍ•È±”½¹ÑÉ…Ð]½É€ ‘íÉ•ÍÁ½¹Í”¹ÍÑ…ÑÕÍô¥€¤ì(€€€ô(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÕÁ±½…‘1•…Í•½¹ÑÉ…ÑA‘™Q½MÑ½É…”¡ÍÑ½É…•A…Ñ èÍÑÉ¥¹œ°‰Õ™™•Èè	Õ™™•È¤ì(€€€½¹ÍÐìÍÕÁ…‰…Í•UÉ°°Í•ÉÙ¥•I½±•-•äô€ôÑ¡¥Ì¹ÍÑ½É…•½¹™¥œ ¤ì(€€€½¹ÍÐÉ•ÍÁ½¹Í”€ô…Ý…¥Ð™•Ñ ¡€‘íÍÕÁ…‰…Í•UÉ±ô½ÍÑ½É…”½ØÄ½½‰©•Ð¼‘íÑ¡¥Ì¹±•…Í•½¹ÑÉ…ÑMÑ½É…•	Õ­•Ñô¼‘íÑ¡¥Ì¹•¹½‘•MÑ½É…•A…Ñ ¡ÍÑ½É…•A…Ñ ¥õ€°ì(€€€€€µ•Ñ¡½è€A=MPœ°(€€€€€¡•…‘•ÉÌèì(€€€€€€€ÕÑ¡½É¥é…Ñ¥½¸è	•…É•È€‘íÍ•ÉÙ¥•I½±•-•åõ€°(€€€€€€€…Á¥­•äèÍ•ÉÙ¥•I½±•-•ä°(€€€€€€€€½¹Ñ•¹ÐµÑåÁ”œè1M}A}5%5}QeA°(€€€€€ô°(€€€€€‰½‘äè‰Õ™™•È¹‰Õ™™•È¹Í±¥”¡‰Õ™™•È¹‰åÑ•=™™Í•Ð°‰Õ™™•È¹‰åÑ•=™™Í•Ð€¬‰Õ™™•È¹‰åÑ•1•¹Ñ ¤…ÌÉÉ…å	Õ™™•È°(€€€ô¤ì(€€€¥˜€ …É•ÍÁ½¹Í”¹½¬¤ì(€€€€€½¹ÍÐ‘•Ñ…¥±Ì€ô…Ý…¥ÐÉ•ÍÁ½¹Í”¹Ñ•áÐ ¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸¡ì(€€€€€€€½‘”è€A}MQ=I}UA1=}%1œ°(€€€€€€€µ•ÍÍ…”è‘•Ñ…¥±Ìñð%µÁ½ÍÍ¥‰±”‘”Ñ•±•Ù•ÉÍ•È±”½¹ÑÉ…ÐA€ ‘íÉ•ÍÁ½¹Í”¹ÍÑ…ÑÕÍô¥€°(€€€€€ô¤ì(€€€ô(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ‘•±•Ñ•UÁ±½…‘•‘1•…Í•½¹ÑÉ…ÑMÑ½É…”¡ÍÑ½É…•A…Ñ èÍÑÉ¥¹œ¤ì(€€€¥˜€ …Ñ¡¥Ì¹¡…ÍMÑ½É…•½¹™¥œ ¤¤É•ÑÕÉ¸ì(€€€½¹ÍÐìÍÕÁ…‰…Í•UÉ°°Í•ÉÙ¥•I½±•-•äô€ôÑ¡¥Ì¹ÍÑ½É…•½¹™¥œ ¤ì(€€€½¹ÍÐÉ•ÍÁ½¹Í”€ô…Ý…¥Ð™•Ñ ¡€‘íÍÕÁ…‰…Í•UÉ±ô½ÍÑ½É…”½ØÄ½½‰©•Ð¼‘íÑ¡¥Ì¹±•…Í•½¹ÑÉ…ÑMÑ½É…•	Õ­•Ñô¼‘íÑ¡¥Ì¹•¹½‘•MÑ½É…•A…Ñ ¡ÍÑ½É…•A…Ñ ¥õ€°ì(€€€€€µ•Ñ¡½è€1Qœ°(€€€€€¡•…‘•ÉÌèì(€€€€€€€ÕÑ¡½É¥é…Ñ¥½¸è	•…É•È€‘íÍ•ÉÙ¥•I½±•-•åõ€°(€€€€€€€…Á¥­•äèÍ•ÉÙ¥•I½±•-•ä°(€€€€€ô°(€€€ô¤ì(€€€¥˜€ …É•ÍÁ½¹Í”¹½¬€˜˜É•ÍÁ½¹Í”¹ÍÑ…ÑÕÌ€„ôô€ÐÀÐ¤ì(€€€€€½¹ÍÐ‘•Ñ…¥±Ì€ô…Ý…¥ÐÉ•ÍÁ½¹Í”¹Ñ•áÐ ¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸¡ì(€€€€€€€½‘”è€A}MQ=I}=IA!9}19UA}%1œ°(€€€€€€€µ•ÍÍ…”è‘•Ñ…¥±Ìñð%µÁ½ÍÍ¥‰±”‘”ÍÕÁÁÉ¥µ•È±”½¹ÑÉ…ÐA½ÉÁ¡•±¥¸€ ‘íÉ•ÍÁ½¹Í”¹ÍÑ…ÑÕÍô¥€°(€€€€€ô¤ì(€€€ô(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ‘½Ý¹±½…‘1•…Í•½¹ÑÉ…ÑMÑ½É…”¡ÍÑ½É…•A…Ñ èÍÑÉ¥¹œ°™¥±•9…µ”èÍÑÉ¥¹œ°™…±±‰…­5¥µ•QåÁ”€ô€…ÁÁ±¥…Ñ¥½¸½Ù¹¹½Á•¹áµ±™½Éµ…ÑÌµ½™™¥•‘½Õµ•¹Ð¹Ý½É‘ÁÉ½•ÍÍ¥¹µ°¹‘½Õµ•¹Ðœ¤ì(€€€½¹ÍÐìÍÕÁ…‰…Í•UÉ°°Í•ÉÙ¥•I½±•-•äô€ôÑ¡¥Ì¹ÍÑ½É…•½¹™¥œ ¤ì(€€€½¹ÍÐÉ•ÍÁ½¹Í”€ô…Ý…¥Ð™•Ñ ¡€‘íÍÕÁ…‰…Í•UÉ±ô½ÍÑ½É…”½ØÄ½½‰©•Ð¼‘íÑ¡¥Ì¹±•…Í•½¹ÑÉ…ÑMÑ½É…•	Õ­•Ñô¼‘íÑ¡¥Ì¹•¹½‘•MÑ½É…•A…Ñ ¡ÍÑ½É…•A…Ñ ¥õ€°ì(€€€€€¡•…‘•ÉÌèì(€€€€€€€ÕÑ¡½É¥é…Ñ¥½¸è	•…É•È€‘íÍ•ÉÙ¥•I½±•-•åõ€°(€€€€€€€…Á¥­•äèÍ•ÉÙ¥•I½±•-•ä°(€€€€€ô°(€€€ô¤ì(€€€¥˜€ …É•ÍÁ½¹Í”¹½¬¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸¡½¹ÑÉ…Ð]½É¥¹ÑÉ½ÕÙ…‰±”€ ‘íÉ•ÍÁ½¹Í”¹ÍÑ…ÑÕÍô¥€¤ì(€€€ô(€€€½¹ÍÐ‰Õ™™•È€ô	Õ™™•È¹™É½´¡…Ý…¥ÐÉ•ÍÁ½¹Í”¹…ÉÉ…å	Õ™™•È ¤¤ì(€€€É•ÑÕÉ¸ì(€€€€€‰Õ™™•È°(€€€€€µ¥µ•QåÁ”èÉ•ÍÁ½¹Í”¹¡•…‘•ÉÌ¹•Ð ½¹Ñ•¹ÐµÑåÁ”œ¤€üü™…±±‰…­5¥µ•QåÁ”°(€€€€€‘½Ý¹±½…‘9…µ”è™¥±•9…µ”°(€€€ôì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÁ•ÉÍ¥ÍÑ1•…Í•½¹ÑÉ…Ñ½à (€€€±•…Í•%è¹Õµ‰•È°(€€€½¹ÑÉ…Ñ%è¹Õµ‰•È°(€€€Ñ•µÁ±…Ñ•Y•ÉÍ¥½¸è¹Õµ‰•È°(€€€•¹•É…Ñ•‘Ðè…Ñ”°(€€€™¥±•9…µ”èÍÑÉ¥¹œ°(€€€‰Õ™™•Èè	Õ™™•È°(€€¤ì(€€€½¹ÍÐÍÑ½É…•A…Ñ €ôÑ¡¥Ì¹±•…Í•½¹ÑÉ…ÑMÑ½É…•A…Ñ ¡±•…Í•%°½¹ÑÉ…Ñ%°Ñ•µÁ±…Ñ•Y•ÉÍ¥½¸°•¹•É…Ñ•‘Ð°™¥±•9…µ”¤ì(€€€¥˜€ …Ñ¡¥Ì¹¡…ÍMÑ½É…•½¹™¥œ ¤¤ì(€€€€€É•ÑÕÉ¸ì(€€€€€€€™¥±•9…µ”°(€€€€€€€ÍÑ½É…•A…Ñ °(€€€€€€€µ¥µ•QåÁ”è€…ÁÁ±¥…Ñ¥½¸½Ù¹¹½Á•¹áµ±™½Éµ…ÑÌµ½™™¥•‘½Õµ•¹Ð¹Ý½É‘ÁÉ½•ÍÍ¥¹µ°¹‘½Õµ•¹Ðœ°(€€€€€€€™¥±•UÉ°è‘…Ñ„é…ÁÁ±¥…Ñ¥½¸½Ù¹¹½Á•¹áµ±™½Éµ…ÑÌµ½™™¥•‘½Õµ•¹Ð¹Ý½É‘ÁÉ½•ÍÍ¥¹µ°¹‘½Õµ•¹Ðí‰…Í”ØÐ°‘í‰Õ™™•È¹Ñ½MÑÉ¥¹œ ‰…Í”ØÐœ¥õ€°(€€€€€ôì(€€€ô(€€€…Ý…¥ÐÑ¡¥Ì¹ÕÁ±½…‘1•…Í•½¹ÑÉ…Ñ½áQ½MÑ½É…”¡ÍÑ½É…•A…Ñ °‰Õ™™•È¤ì(€€€É•ÑÕÉ¸ì(€€€€€™¥±•9…µ”°(€€€€€ÍÑ½É…•A…Ñ °(€€€€€µ¥µ•QåÁ”è€…ÁÁ±¥…Ñ¥½¸½Ù¹¹½Á•¹áµ±™½Éµ…ÑÌµ½™™¥•‘½Õµ•¹Ð¹Ý½É‘ÁÉ½•ÍÍ¥¹µ°¹‘½Õµ•¹Ðœ°(€€€€€™¥±•UÉ°èÑ¡¥Ì¹±•…Í•½¹ÑÉ…Ñ½Ý¹±½…‘I½ÕÑ”¡±•…Í•%°½¹ÑÉ…Ñ%¤°(€€€ôì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÁ•ÉÍ¥ÍÑ1•…Í•½¹ÑÉ…ÑA‘˜ (€€€±•…Í•%è¹Õµ‰•È°(€€€½¹ÑÉ…Ñ%è¹Õµ‰•È°(€€€Ñ•µÁ±…Ñ•Y•ÉÍ¥½¸è¹Õµ‰•È°(€€€•¹•É…Ñ•‘Ðè…Ñ”°(€€€™¥±•9…µ”èÍÑÉ¥¹œ°(€€€‰Õ™™•Èè	Õ™™•È°(€€¤ì(€€€½¹ÍÐÍÑ½É…•A…Ñ €ôÑ¡¥Ì¹±•…Í•½¹ÑÉ…ÑMÑ½É…•A…Ñ ¡±•…Í•%°½¹ÑÉ…Ñ%°Ñ•µÁ±…Ñ•Y•ÉÍ¥½¸°•¹•É…Ñ•‘Ð°™¥±•9…µ”¤ì(€€€¥˜€ …Ñ¡¥Ì¹¡…ÍMÑ½É…•½¹™¥œ ¤¤ì(€€€€€É•ÑÕÉ¸ì(€€€€€€€™¥±•9…µ”°(€€€€€€€ÍÑ½É…•A…Ñ °(€€€€€€€µ¥µ•QåÁ”è1M}A}5%5}QeA°(€€€€€€€™¥±•UÉ°è‘…Ñ„è‘í1M}A}5%5}QeAôí‰…Í”ØÐ°‘í‰Õ™™•È¹Ñ½MÑÉ¥¹œ ‰…Í”ØÐœ¥õ€°(€€€€€ôì(€€€ô(€€€…Ý…¥ÐÑ¡¥Ì¹ÕÁ±½…‘1•…Í•½¹ÑÉ…ÑA‘™Q½MÑ½É…”¡ÍÑ½É…•A…Ñ °‰Õ™™•È¤ì(€€€É•ÑÕÉ¸ì(€€€€€™¥±•9…µ”°(€€€€€ÍÑ½É…•A…Ñ °(€€€€€µ¥µ•QåÁ”è1M}A}5%5}QeA°(€€€€€™¥±•UÉ°èÑ¡¥Ì¹±•…Í•½¹ÑÉ…Ñ½Ý¹±½…‘I½ÕÑ”¡±•…Í•%°½¹ÑÉ…Ñ%¤°(€€€ôì(€ô((€ÁÉ¥Ù…Ñ”‘…Ñ…UÉ±¥±”¡™¥±•UÉ°èÍÑÉ¥¹œ°™¥±•9…µ”èÍÑÉ¥¹œ¤ì(€€€½¹ÍÐµ…Ñ €ô™¥±•UÉ°¹µ…Ñ  ½y‘…Ñ„è¡mxít¬¤í‰…Í”ØÐ° ¸¬¤¼¤ì(€€€¥˜€ …µ…Ñ ¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ ½Õµ•¹Ð¥¹Ù…±¥‘”œ¤ì(€€€ô(€€€É•ÑÕÉ¸ì(€€€€€‰Õ™™•Èè	Õ™™•È¹™É½´¡µ…Ñ¡lÉt°€‰…Í”ØÐœ¤°(€€€€€µ¥µ•QåÁ”èµ…Ñ¡lÅt°(€€€€€‘½Ý¹±½…‘9…µ”è™¥±•9…µ”°(€€€ôì(€ô((€ÁÉ¥Ù…Ñ”•¹½‘•MÑ½É…•A…Ñ ¡Á…Ñ èÍÑÉ¥¹œ¤ì(€€€É•ÑÕÉ¸Á…Ñ ¹ÍÁ±¥Ð œ¼œ¤¹µ…À ¡Í•µ•¹Ð¤€ôø•¹½‘•UI%½µÁ½¹•¹Ð¡Í•µ•¹Ð¤¤¹©½¥¸ œ¼œ¤ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ…Õ‘¥ÑI•…¡…Ñ¥½¸èÍÑÉ¥¹œ°É•Í½ÕÉ”èÍÑÉ¥¹œ°É•Í½ÕÉ•%èÍÑÉ¥¹œ¤ì(€€€…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€%9MIP%9Q<…Õ‘¥Ñ}±½Ì€¡½É…¹¥é…Ñ¥½¹}¥°ÕÍ•É}¥°…Ñ¥½¸°É•Í½ÕÉ”°É•Í½ÕÉ•}¥°µ•Ñ¡½°Á…Ñ °ÍÑ…ÑÕÍ}½‘”°µ•Ñ…‘…Ñ„¤(€€€€€€Y1UL€ Ä°€È°€Ì°€Ð°€Ô°€Pœ°€Ø°€ÈÀÀ°€Ü¥€°(€€€€€l(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•É% ¤€üü¹Õ±°°(€€€€€€€…Ñ¥½¸°(€€€€€€€É•Í½ÕÉ”°(€€€€€€€É•Í½ÕÉ•%°(€€€€€€€€½…Á¤¼‘íÉ•Í½ÕÉ•ô¼‘íÉ•Í½ÕÉ•%‘õ€°(€€€€€€€)M=8¹ÍÑÉ¥¹¥™ä¡ìÉ•Í•ÉÙ•èÑÉÕ”ô¤°(€€€€€t°(€€€€¤ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÉ•…Ñ•…Í¡5½Ù•µ•¹Ñ%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹ÐèA½½±±¥•¹Ð°‰½‘äèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø¤ì(€€€½¹ÍÐÍ•ÍÍ¥½¸€ô…Ý…¥ÐÑ¡¥Ì¹½Á•¹M•ÍÍ¥½¸¡±¥•¹Ð¤ì(€€€½¹ÍÐÑåÁ”€ôMÑÉ¥¹œ¡‰½‘ä¹ÑåÁ”€üü€=UPœ¤ì(€€€½¹ÍÐ…Ñ•½Éä€ôMÑÉ¥¹œ¡‰½‘ä¹…Ñ•½Éä€üü€¡ÑåÁ”€ôôô€%8œ€ü€=Q!I}%9=5œ€è€=Q!I}aA9Mœ¤¤ì(€€€½¹ÍÐÁ¥••9Õµ‰•È€ô‰½‘ä¹Á¥••}¹Õµ‰•È€üü…Ý…¥ÐÑ¡¥Ì¹¹•áÑ…Í¡A¥••9Õµ‰•È¡±¥•¹Ð°ÑåÁ”¤ì(€€€½¹ÍÐÕÉÉ•¹ä€ôMÑÉ¥¹œ¡‰½‘ä¹ÕÉÉ•¹ä€üü€UMœ¤¹Ñ½UÁÁ•É…Í” ¤ì(€€€½¹ÍÐ•á¡…¹•I…Ñ•UÍ•€ô9Õµ‰•È¡‰½‘ä¹•á¡…¹•}É…Ñ•}ÕÍ•€üü€À¤ñð¹Õ±°ì(€€€½¹ÍÐ…µ½Õ¹Ð€ô9Õµ‰•È¡‰½‘ä¹…µ½Õ¹Ð€üü€À¤ì(€€€½¹ÍÐ•ÅÕ¥Ù…±•¹ÑUÍ€ô9Õµ‰•È¡‰½‘ä¹•ÅÕ¥Ù…±•¹Ñ}ÕÍ€üü€¡ÕÉÉ•¹ä€ôôô€œ€˜˜•á¡…¹•I…Ñ•UÍ•€ü…µ½Õ¹Ð€¼•á¡…¹•I…Ñ•UÍ•€è…µ½Õ¹Ð¤¤ì(€€€½¹ÍÐÍÕÁÁ½ÉÑÍA¥••9Õµ‰•È€ô…Ý…¥ÐÑ¡¥Ì¹½±Õµ¹á¥ÍÑÌ …Í¡}µ½Ù•µ•¹ÑÌœ°€Á¥••}¹Õµ‰•Èœ¤ì(€€€½¹ÍÐÍÕÁÁ½ÉÑÍMÑ½­AÕÉ¡…Í•%€ô…Ý…¥ÐÑ¡¥Ì¹½±Õµ¹á¥ÍÑÌ …Í¡}µ½Ù•µ•¹ÑÌœ°€ÍÑ½­}ÁÕÉ¡…Í•}¥œ¤ì(€€€½¹ÍÐÍÕÁÁ½ÉÑÍÕÉÉ•¹å¥•±‘Ì€ô…Ý…¥ÐÑ¡¥Ì¹½±Õµ¹á¥ÍÑÌ …Í¡}µ½Ù•µ•¹ÑÌœ°€ÕÉÉ•¹äœ¤(€€€€€ñð…Ý…¥ÐÑ¡¥Ì¹½±Õµ¹á¥ÍÑÌ …Í¡}µ½Ù•µ•¹ÑÌœ°€•á¡…¹•}É…Ñ•}ÕÍ•œ¤(€€€€€ñð…Ý…¥ÐÑ¡¥Ì¹½±Õµ¹á¥ÍÑÌ …Í¡}µ½Ù•µ•¹ÑÌœ°€•á¡…¹•}É…Ñ•}‘…Ñ”œ¤(€€€€€ñð…Ý…¥ÐÑ¡¥Ì¹½±Õµ¹á¥ÍÑÌ …Í¡}µ½Ù•µ•¹ÑÌœ°€•ÅÕ¥Ù…±•¹Ñ}ÕÍœ¤ì(€€€½¹ÍÐ¥¹Í•ÉÑ½±Õµ¹Ì€ôl(€€€€€€…Í¡}Í•ÍÍ¥½¹}¥œ°(€€€€€€ÑåÁ”œ°(€€€€€€±…‰•°œ°(€€€€€€…Ñ•½Éäœ°(€€€€€€…µ½Õ¹Ðœ°(€€€€€€µ½Ù•µ•¹Ñ}‘…Ñ”œ°(€€€€€€Á…åµ•¹Ñ}¥œ°(€€€€€€¥¹Ù½¥•}¥œ°(€€€€€€Ñ•¹…¹Ñ}¥œ°(€€€€€€•µÁ±½å••}¥œ°(€€€€€€ÍÕÁÁ±¥•Èœ°(€€€€€€‘•ÍÉ¥ÁÑ¥½¸œ°(€€€€€€É•™•É•¹”œ°(€€€€€€…ÑÑ…¡µ•¹Ñ}™¥±•}¹…µ”œ°(€€€€€€…ÑÑ…¡µ•¹Ñ}™¥±•}ÕÉ°œ°(€€€€€€É•…Ñ•‘}‰äœ°(€€€€€€½É…¹¥é…Ñ¥½¹}¥œ°(€€€tì(€€€¥˜€¡ÍÕÁÁ½ÉÑÍA¥••9Õµ‰•È¤ì(€€€€€¥¹Í•ÉÑ½±Õµ¹Ì¹ÍÁ±¥” Ä°€À°€Á¥••}¹Õµ‰•Èœ¤ì(€€€ô(€€€¥˜€¡ÍÕÁÁ½ÉÑÍMÑ½­AÕÉ¡…Í•%¤ì(€€€€€¥¹Í•ÉÑ½±Õµ¹Ì¹ÍÁ±¥”¡¥¹Í•ÉÑ½±Õµ¹Ì¹¥¹‘•á=˜ É•…Ñ•‘}‰äœ¤°€À°€ÍÑ½­}ÁÕÉ¡…Í•}¥œ¤ì(€€€ô(€€€½¹ÍÐ¥¹Í•ÉÑY…±Õ•ÌèÕ¹­¹½Ý¹mt€ôl(€€€€€Í•ÍÍ¥½¸¹¥°(€€€€€ÑåÁ”°(€€€€€MÑÉ¥¹œ¡‰½‘ä¹±…‰•°€üü‰½‘ä¹‘•ÍÉ¥ÁÑ¥½¸€üü‰½‘ä¹…Ñ•½Éä€üü€5½ÕÙ•µ•¹Ð‘”…¥ÍÍ”œ¤°(€€€€€…Ñ•½Éä°(€€€€€9Õµ‰•È¡‰½‘ä¹…µ½Õ¹Ð€üü€À¤°(€€€€€‰½‘ä¹µ½Ù•µ•¹Ñ}‘…Ñ”€üü¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤¹Í±¥” À°€ÄÀ¤°(€€€€€‰½‘ä¹Á…åµ•¹Ñ}¥€üü¹Õ±°°(€€€€€‰½‘ä¹¥¹Ù½¥•}¥€üü¹Õ±°°(€€€€€‰½‘ä¹Ñ•¹…¹Ñ}¥€üü¹Õ±°°(€€€€€‰½‘ä¹•µÁ±½å••}¥€üü¹Õ±°°(€€€€€‰½‘ä¹ÍÕÁÁ±¥•È€üü¹Õ±°°(€€€€€‰½‘ä¹‘•ÍÉ¥ÁÑ¥½¸€üü¹Õ±°°(€€€€€‰½‘ä¹É•™•É•¹”€üü¹Õ±°°(€€€€€‰½‘ä¹…ÑÑ…¡µ•¹Ñ}™¥±•}¹…µ”€üü¹Õ±°°(€€€€€‰½‘ä¹…ÑÑ…¡µ•¹Ñ}™¥±•}ÕÉ°€üü¹Õ±°°(€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•É% ¤€üü‰½‘ä¹É•…Ñ•‘}‰ä€üü€Ä°(€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°(€€€tì(€€€¥˜€¡ÍÕÁÁ½ÉÑÍA¥••9Õµ‰•È¤ì(€€€€€¥¹Í•ÉÑY…±Õ•Ì¹ÍÁ±¥” Ä°€À°Á¥••9Õµ‰•È¤ì(€€€ô(€€€¥˜€¡ÍÕÁÁ½ÉÑÍMÑ½­AÕÉ¡…Í•%¤ì(€€€€€¥¹Í•ÉÑY…±Õ•Ì¹ÍÁ±¥”¡¥¹Í•ÉÑY…±Õ•Ì¹±•¹Ñ €´€È°€À°‰½‘ä¹ÍÑ½­}ÁÕÉ¡…Í•}¥€üü¹Õ±°¤ì(€€€ô(€€€¥˜€ ¡‰½‘ä¹ÑÉ•…ÍÕÉå}ÑÉ…¹Í™•É}¥€üü¹Õ±°¤€„ôô¹Õ±°€˜˜…Ý…¥ÐÑ¡¥Ì¹½±Õµ¹á¥ÍÑÌ …Í¡}µ½Ù•µ•¹ÑÌœ°€ÑÉ•…ÍÕÉå}ÑÉ…¹Í™•É}¥œ¤¤ì(€€€€€¥¹Í•ÉÑ½±Õµ¹Ì¹ÁÕÍ  ÑÉ•…ÍÕÉå}ÑÉ…¹Í™•É}¥œ¤ì(€€€€€¥¹Í•ÉÑY…±Õ•Ì¹ÁÕÍ ¡9Õµ‰•È¡‰½‘ä¹ÑÉ•…ÍÕÉå}ÑÉ…¹Í™•É}¥€üü€À¤ñð¹Õ±°¤ì(€€€ô(€€€½¹ÍÐÁ±…•¡½±‘•ÉÌ€ô¥¹Í•ÉÑY…±Õ•Ì¹µ…À ¡|°¥¹‘•à¤€ôø€‘í¥¹‘•à€¬€Åõ€¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€%9MIP%9Q<…Í¡}µ½Ù•µ•¹ÑÌ(€€€€€€€ ‘í¥¹Í•ÉÑ½±Õµ¹Ì¹©½¥¸ œ°€œ¥ô¤(€€€€€€Y1UL€ ‘íÁ±…•¡½±‘•ÉÌ¹©½¥¸ œ°€œ¥ô¤(€€€€€€IQUI9%9€©€°(€€€€€¥¹Í•ÉÑY…±Õ•Ì°(€€€€¤ì(€€€¥˜€¡ÍÕÁÁ½ÉÑÍÕÉÉ•¹å¥•±‘Ì¤ì(€€€€€½¹ÍÐÕÁ‘…Ñ•M•ÑÌèÍÑÉ¥¹mt€ômtì(€€€€€½¹ÍÐÕÁ‘…Ñ•Y…±Õ•ÌèÕ¹­¹½Ý¹mt€ômÉ½ÝÍlÁt¹¥‘tì(€€€€€¥˜€¡…Ý…¥ÐÑ¡¥Ì¹½±Õµ¹á¥ÍÑÌ …Í¡}µ½Ù•µ•¹ÑÌœ°€ÕÉÉ•¹äœ¤¤ì(€€€€€€€ÕÁ‘…Ñ•Y…±Õ•Ì¹ÁÕÍ ¡ÕÉÉ•¹ä¤ì(€€€€€€€ÕÁ‘…Ñ•M•ÑÌ¹ÁÕÍ ¡ÕÉÉ•¹ä€ô€‘íÕÁ‘…Ñ•Y…±Õ•Ì¹±•¹Ñ¡õ€¤ì(€€€€€ô(€€€€€¥˜€¡…Ý…¥ÐÑ¡¥Ì¹½±Õµ¹á¥ÍÑÌ …Í¡}µ½Ù•µ•¹ÑÌœ°€•á¡…¹•}É…Ñ•}ÕÍ•œ¤¤ì(€€€€€€€ÕÁ‘…Ñ•Y…±Õ•Ì¹ÁÕÍ ¡•á¡…¹•I…Ñ•UÍ•¤ì(€€€€€€€ÕÁ‘…Ñ•M•ÑÌ¹ÁÕÍ ¡•á¡…¹•}É…Ñ•}ÕÍ•€ô€‘íÕÁ‘…Ñ•Y…±Õ•Ì¹±•¹Ñ¡õ€¤ì(€€€€€ô(€€€€€¥˜€¡…Ý…¥ÐÑ¡¥Ì¹½±Õµ¹á¥ÍÑÌ …Í¡}µ½Ù•µ•¹ÑÌœ°€•á¡…¹•}É…Ñ•}‘…Ñ”œ¤¤ì(€€€€€€€ÕÁ‘…Ñ•Y…±Õ•Ì¹ÁÕÍ ¡‰½‘ä¹•á¡…¹•}É…Ñ•}‘…Ñ”€üü¹Õ±°¤ì(€€€€€€€ÕÁ‘…Ñ•M•ÑÌ¹ÁÕÍ ¡•á¡…¹•}É…Ñ•}‘…Ñ”€ô€‘íÕÁ‘…Ñ•Y…±Õ•Ì¹±•¹Ñ¡õ€¤ì(€€€€€ô(€€€€€¥˜€¡…Ý…¥ÐÑ¡¥Ì¹½±Õµ¹á¥ÍÑÌ …Í¡}µ½Ù•µ•¹ÑÌœ°€•ÅÕ¥Ù…±•¹Ñ}ÕÍœ¤¤ì(€€€€€€€ÕÁ‘…Ñ•Y…±Õ•Ì¹ÁÕÍ ¡•ÅÕ¥Ù…±•¹ÑUÍ¤ì(€€€€€€€ÕÁ‘…Ñ•M•ÑÌ¹ÁÕÍ ¡•ÅÕ¥Ù…±•¹Ñ}ÕÍ€ô€‘íÕÁ‘…Ñ•Y…±Õ•Ì¹±•¹Ñ¡õ€¤ì(€€€€€ô(€€€€€¥˜€¡ÕÁ‘…Ñ•M•ÑÌ¹±•¹Ñ €ø€À¤ì(€€€€€€€ÕÁ‘…Ñ•Y…±Õ•Ì¹ÁÕÍ ¡Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤¤ì(€€€€€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€€€€€UAQ…Í¡}µ½Ù•µ•¹ÑÌ(€€€€€€€€€€MP€‘íÕÁ‘…Ñ•M•ÑÌ¹©½¥¸ œ°€œ¥ô(€€€€€€€€€€]!I¥€ô€Ä9½É…¹¥é…Ñ¥½¹}¥€ô€‘íÕÁ‘…Ñ•Y…±Õ•Ì¹±•¹Ñ¡õ€°(€€€€€€€€€ÕÁ‘…Ñ•Y…±Õ•Ì°(€€€€€€€€¤ì(€€€€€ô(€€€ô(€€€½¹ÍÐÉ•™É•Í¡•€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P€¨(€€€€€€I=4…Í¡}µ½Ù•µ•¹ÑÌ(€€€€€€]!I¥€ô€Ä9½É…¹¥é…Ñ¥½¹}¥€ô€È9‘•±•Ñ•‘}…Ð%L9U11€°(€€€€€mÉ½ÝÍlÁt¹¥°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€É•ÑÕÉ¸É•™É•Í¡•¹É½ÝÍlÁt€üüÉ½ÝÍlÁtì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÉ•…Ñ•Õ…É…¹Ñ••…Í¡5½Ù•µ•¹Ñ%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹ÐèA½½±±¥•¹Ð°‰½‘äèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø¤ì(€€€½¹ÍÐÕÉÉ•¹ä€ôMÑÉ¥¹œ¡‰½‘ä¹ÕÉÉ•¹ä€üü€UMœ¤¹Ñ½UÁÁ•É…Í” ¤ì(€€€½¹ÍÐ•á¡…¹•I…Ñ•UÍ•€ô9Õµ‰•È¡‰½‘ä¹•á¡…¹•}É…Ñ•}ÕÍ•€üü€À¤ñð¹Õ±°ì(€€€½¹ÍÐ…µ½Õ¹Ð€ô9Õµ‰•È¡‰½‘ä¹…µ½Õ¹Ð€üü€À¤ì(€€€½¹ÍÐ•ÅÕ¥Ù…±•¹ÑUÍ€ô9Õµ‰•È¡‰½‘ä¹•ÅÕ¥Ù…±•¹Ñ}ÕÍ€üü€¡ÕÉÉ•¹ä€ôôô€œ€˜˜•á¡…¹•I…Ñ•UÍ•€ü…µ½Õ¹Ð€¼•á¡…¹•I…Ñ•UÍ•€è…µ½Õ¹Ð¤¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€%9MIP%9Q<Õ…É…¹Ñ••}…Í¡}µ½Ù•µ•¹ÑÌ(€€€€€€€¡½É…¹¥é…Ñ¥½¹}¥°µ½Ù•µ•¹Ñ}ÑåÁ”°ÑåÁ”°…µ½Õ¹Ð°ÕÉÉ•¹ä°•á¡…¹•}É…Ñ•}ÕÍ•°•á¡…¹•}É…Ñ•}‘…Ñ”°•ÅÕ¥Ù…±•¹Ñ}ÕÍ°(€€€€€€€µ½Ù•µ•¹Ñ}‘…Ñ”°±•…Í•}¥°±•…Í•}Õ…É…¹Ñ••}¥°Á…åµ•¹Ñ}¥°Ñ•¹…¹Ñ}¥°É•™•É•¹”°É•…Í½¸°¹½Ñ•Ì°É•…Ñ•‘}‰ä¤(€€€€€€Y1UL€ Ä°€È°€Ì°€Ð°€Ô°€Ø°€Ü°€à°(€€€€€€€€€€€€€€€ä°€ÄÀ°€ÄÄ°€ÄÈ°€ÄÌ°€ÄÐ°€ÄÔ°€ÄØ°€ÄÜ¤(€€€€€€IQUI9%9€©€°(€€€€€l(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°(€€€€€€€MÑÉ¥¹œ¡‰½‘ä¹µ½Ù•µ•¹Ñ}ÑåÁ”€üü€I9Qe}aA9Mœ¤°(€€€€€€€MÑÉ¥¹œ¡‰½‘ä¹ÑåÁ”€üü€=UPœ¤°(€€€€€€€…µ½Õ¹Ð°(€€€€€€€ÕÉÉ•¹ä°(€€€€€€€•á¡…¹•I…Ñ•UÍ•°(€€€€€€€‰½‘ä¹•á¡…¹•}É…Ñ•}‘…Ñ”€üü¹Õ±°°(€€€€€€€9Õµ‰•È¹¥Í¥¹¥Ñ”¡•ÅÕ¥Ù…±•¹ÑUÍ¤€ü9Õµ‰•È¡•ÅÕ¥Ù…±•¹ÑUÍ¹Ñ½¥á• È¤¤€è…µ½Õ¹Ð°(€€€€€€€‰½‘ä¹µ½Ù•µ•¹Ñ}‘…Ñ”€üü¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤¹Í±¥” À°€ÄÀ¤°(€€€€€€€‰½‘ä¹±•…Í•}¥€üü¹Õ±°°(€€€€€€€‰½‘ä¹±•…Í•}Õ…É…¹Ñ••}¥€üü¹Õ±°°(€€€€€€€‰½‘ä¹Á…åµ•¹Ñ}¥€üü¹Õ±°°(€€€€€€€‰½‘ä¹Ñ•¹…¹Ñ}¥€üü¹Õ±°°(€€€€€€€‰½‘ä¹É•™•É•¹”€üü¹Õ±°°(€€€€€€€‰½‘ä¹É•…Í½¸€üü¹Õ±°°(€€€€€€€‰½‘ä¹¹½Ñ•Ì€üü¹Õ±°°(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•É% ¤€üü€Ä°(€€€€€t°(€€€€¤ì(€€€É•ÑÕÉ¸É½ÝÍlÁtì(€ô((€ÁÉ¥Ù…Ñ”Õ…É…¹Ñ••…Í¡]¡•É”¡™¥±Ñ•ÉÌèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø€ôíô¤ì(€€€½¹ÍÐÙ…±Õ•ÌèÕ¹­¹½Ý¹mt€ômÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥tì(€€€½¹ÍÐ±…ÕÍ•Ì€ôl´¹½É…¹¥é…Ñ¥½¹}¥€ô€Äœ°€´¹‘•±•Ñ•‘}…Ð%L9U10tì(€€€½¹ÍÐ…‘€ô€¡ÍÅ°èÍÑÉ¥¹œ°Ù…±Õ”èÕ¹­¹½Ý¸¤€ôøì(€€€€€Ù…±Õ•Ì¹ÁÕÍ ¡Ù…±Õ”¤ì(€€€€€±…ÕÍ•Ì¹ÁÕÍ ¡ÍÅ°¹É•Á±…” œüœ°€‘íÙ…±Õ•Ì¹±•¹Ñ¡õ€¤¤ì(€€€ôì(€€€¥˜€¡™¥±Ñ•ÉÌ¹‘…Ñ•}™É½´¤…‘ ´¹µ½Ù•µ•¹Ñ}‘…Ñ”€øô€üèéQœ°MÑÉ¥¹œ¡™¥±Ñ•ÉÌ¹‘…Ñ•}™É½´¤¤ì(€€€¥˜€¡™¥±Ñ•ÉÌ¹‘…Ñ•}Ñ¼¤…‘ ´¹µ½Ù•µ•¹Ñ}‘…Ñ”€ðô€üèéQœ°MÑÉ¥¹œ¡™¥±Ñ•ÉÌ¹‘…Ñ•}Ñ¼¤¤ì(€€€¥˜€¡™¥±Ñ•ÉÌ¹ÕÉÉ•¹ä¤…‘ ´¹ÕÉÉ•¹ä€ô€üœ°MÑÉ¥¹œ¡™¥±Ñ•ÉÌ¹ÕÉÉ•¹ä¤¹Ñ½UÁÁ•É…Í” ¤¤ì(€€€¥˜€¡™¥±Ñ•ÉÌ¹ÑåÁ”¤…‘ ´¹µ½Ù•µ•¹Ñ}ÑåÁ”€ô€üœ°MÑÉ¥¹œ¡™¥±Ñ•ÉÌ¹ÑåÁ”¤¹Ñ½UÁÁ•É…Í” ¤¤ì(€€€¥˜€¡™¥±Ñ•ÉÌ¹±•…Í•}¥¤…‘ ´¹±•…Í•}¥€ô€üèé%9Pœ°9Õµ‰•È¡™¥±Ñ•ÉÌ¹±•…Í•}¥¤¤ì(€€€¥˜€¡™¥±Ñ•ÉÌ¹Ñ•¹…¹Ñ}¥¤…‘ ´¹Ñ•¹…¹Ñ}¥€ô€üèé%9Pœ°9Õµ‰•È¡™¥±Ñ•ÉÌ¹Ñ•¹…¹Ñ}¥¤¤ì(€€€¥˜€¡™¥±Ñ•ÉÌ¹ÕÍ•É}¥¤…‘ ´¹É•…Ñ•‘}‰ä€ô€üèé%9Pœ°9Õµ‰•È¡™¥±Ñ•ÉÌ¹ÕÍ•É}¥¤¤ì(€€€¥˜€¡™¥±Ñ•ÉÌ¹Á…åµ•¹Ñ}¥¤…‘ ´¹Á…åµ•¹Ñ}¥€ô€üèé%9Pœ°9Õµ‰•È¡™¥±Ñ•ÉÌ¹Á…åµ•¹Ñ}¥¤¤ì(€€€É•ÑÕÉ¸ìÝ¡•É”è]!I€‘í±…ÕÍ•Ì¹©½¥¸ œ9€œ¥õ€°Ù…±Õ•Ìôì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ•¹ÍÕÉ•Õ…É…¹Ñ••…Í¡M¡•µ„ ¤ì(€€€¥˜€ „¡…Ý…¥ÐÑ¡¥Ì¹Ñ…‰±•á¥ÍÑÌ Õ…É…¹Ñ••}…Í¡}µ½Ù•µ•¹ÑÌœ¤¤ñð€„¡…Ý…¥ÐÑ¡¥Ì¹½±Õµ¹á¥ÍÑÌ Á…åµ•¹ÑÌœ°€Õ…É…¹Ñ••}…Í¡}µ½Ù•µ•¹Ñ}¥œ¤¤¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1„…¥ÍÍ”‘•Ì…É…¹Ñ¥•Ì±½…Ñ¥Ù•Ì¸•ÍÐÁ…Ì•¹½É”½¹™¥ÕÉ•”¸œ¤ì(€€€ô(€ô((€ÁÉ¥Ù…Ñ”Íå¹‘¥…Í¡]¡•É”¡™¥±Ñ•ÉÌèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø€ôíô¤ì(€€€½¹ÍÐÙ…±Õ•ÌèÕ¹­¹½Ý¹mt€ômÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥tì(€€€½¹ÍÐ±…ÕÍ•Ì€ôlÍ´¹½É…¹¥é…Ñ¥½¹}¥€ô€Äœ°€Í´¹‘•±•Ñ•‘}…Ð%L9U10tì(€€€½¹ÍÐ…‘€ô€¡ÍÅ°èÍÑÉ¥¹œ°Ù…±Õ”èÕ¹­¹½Ý¸¤€ôøì(€€€€€Ù…±Õ•Ì¹ÁÕÍ ¡Ù…±Õ”¤ì(€€€€€±…ÕÍ•Ì¹ÁÕÍ ¡ÍÅ°¹É•Á±…” œüœ°€‘íÙ…±Õ•Ì¹±•¹Ñ¡õ€¤¤ì(€€€ôì(€€€¥˜€¡™¥±Ñ•ÉÌ¹‘…Ñ•}™É½´¤…‘ Í´¹µ½Ù•µ•¹Ñ}‘…Ñ”€øô€üèéQœ°MÑÉ¥¹œ¡™¥±Ñ•ÉÌ¹‘…Ñ•}™É½´¤¤ì(€€€¥˜€¡™¥±Ñ•ÉÌ¹‘…Ñ•}Ñ¼¤…‘ Í´¹µ½Ù•µ•¹Ñ}‘…Ñ”€ðô€üèéQœ°MÑÉ¥¹œ¡™¥±Ñ•ÉÌ¹‘…Ñ•}Ñ¼¤¤ì(€€€¥˜€¡™¥±Ñ•ÉÌ¹ÕÉÉ•¹ä¤…‘ Í´¹ÕÉÉ•¹ä€ô€üœ°MÑÉ¥¹œ¡™¥±Ñ•ÉÌ¹ÕÉÉ•¹ä¤¹Ñ½UÁÁ•É…Í” ¤¤ì(€€€¥˜€¡™¥±Ñ•ÉÌ¹Á…åµ•¹Ñ}µ•Ñ¡½¤…‘ Í´¹Á…åµ•¹Ñ}µ•Ñ¡½€ô€üœ°MÑÉ¥¹œ¡™¥±Ñ•ÉÌ¹Á…åµ•¹Ñ}µ•Ñ¡½¤¹Ñ½UÁÁ•É…Í” ¤¤ì(€€€¥˜€¡™¥±Ñ•ÉÌ¹ÑÉ•…ÍÕÉå}±½…Ñ¥½¸¤…‘ Í´¹ÑÉ•…ÍÕÉå}±½…Ñ¥½¸€ô€üœ°MÑÉ¥¹œ¡™¥±Ñ•ÉÌ¹ÑÉ•…ÍÕÉå}±½…Ñ¥½¸¤¹Ñ½UÁÁ•É…Í” ¤¤ì(€€€¥˜€¡™¥±Ñ•ÉÌ¹Á…åµ•¹Ñ}¥¤…‘ Í´¹Á…åµ•¹Ñ}¥€ô€üèé%9Pœ°9Õµ‰•È¡™¥±Ñ•ÉÌ¹Á…åµ•¹Ñ}¥¤¤ì(€€€¥˜€¡™¥±Ñ•ÉÌ¹¥¹Ù½¥•}¥¤…‘ Í´¹¥¹Ù½¥•}¥€ô€üèé%9Pœ°9Õµ‰•È¡™¥±Ñ•ÉÌ¹¥¹Ù½¥•}¥¤¤ì(€€€¥˜€¡™¥±Ñ•ÉÌ¹Ñ•¹…¹Ñ}¥¤…‘ Í´¹Ñ•¹…¹Ñ}¥€ô€üèé%9Pœ°9Õµ‰•È¡™¥±Ñ•ÉÌ¹Ñ•¹…¹Ñ}¥¤¤ì(€€€É•ÑÕÉ¸ìÝ¡•É”è]!I€‘í±…ÕÍ•Ì¹©½¥¸ œ9€œ¥õ€°Ù…±Õ•Ìôì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ•¹ÍÕÉ•Må¹‘¥…Í¡M¡•µ„¡±¥•¹ÐüèA½½±±¥•¹Ð¤ì(€€€½¹ÍÐÅÕ•Éä€ôM1P€Ä(€€€€€€I=4¥¹™½Éµ…Ñ¥½¹}Í¡•µ„¹Ñ…‰±•Ì(€€€€€€]!IÑ…‰±•}Í¡•µ„€ô€ÁÕ‰±¥Œœ(€€€€€€€€9Ñ…‰±•}¹…µ”€ô€Íå¹‘¥}…Í¡}µ½Ù•µ•¹ÑÌœ(€€€€€€1%5%P€Å€ì(€€€½¹ÍÐÉ•ÍÕ±Ð€ô±¥•¹Ð(€€€€€€ü…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä¡ÅÕ•Éä¤(€€€€€€è…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä¡ÅÕ•Éä¤ì(€€€½¹ÍÐìÉ½ÝÌô€ôÉ•ÍÕ±Ðì(€€€¥˜€ …É½ÝÍlÁt¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1„…¥ÍÍ”Íå¹‘¥Œ¸•ÍÐÁ…Ì•¹½É”½¹™¥ÕÉ•”¸œ¤ì(€€€ô(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ…Õ‘¥ÑÕ…É…¹Ñ••…Í ¡±¥•¹ÐèA½½±±¥•¹Ð°…Ñ¥½¸èÍÑÉ¥¹œ°µ½Ù•µ•¹Ñ%è¹Õµ‰•È°µ•Ñ…‘…Ñ„èI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø¤ì(€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€%9MIP%9Q<…Õ‘¥Ñ}±½Ì€¡½É…¹¥é…Ñ¥½¹}¥°ÕÍ•É}¥°…Ñ¥½¸°É•Í½ÕÉ”°É•Í½ÕÉ•}¥°µ•Ñ¡½°Á…Ñ °ÍÑ…ÑÕÍ}½‘”°µ•Ñ…‘…Ñ„¤(€€€€€€Y1UL€ Ä°€È°€Ì°€Õ…É…¹Ñ••}…Í œ°€Ð°€A=MPœ°€Ô°€ÈÀÄ°€Øèé)M=9¥€°(€€€€€l(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°(€€€€€€€Ñ¡¥Ì¹½¹Ñ•áÐ¹ÕÍ•É% ¤€üü¹Õ±°°(€€€€€€€…Ñ¥½¸°(€€€€€€€MÑÉ¥¹œ¡µ½Ù•µ•¹Ñ%¤°(€€€€€€€€½…Á¤½Õ…É…¹Ñ•”µ…Í ½µ½Ù•µ•¹ÑÌ¼‘íµ½Ù•µ•¹Ñ%‘õ€°(€€€€€€€)M=8¹ÍÑÉ¥¹¥™ä¡µ•Ñ…‘…Ñ„¤°(€€€€€t°(€€€€¤ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ¹•áÑ…Í¡A¥••9Õµ‰•È¡±¥•¹ÐèA½½±±¥•¹Ð°ÑåÁ”èÍÑÉ¥¹œ¤ì(€€€½¹ÍÐÁÉ•™¥à€ôÑåÁ”€ôôô€%8œ€ü€œ€è€œì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P=1M¡5`¡9U11%¡MU	MQI%9¡Á¥••}¹Õµ‰•ÈI=4€œ¡lÀ´åt¬¤œ¤°€œœ¤èé%9P¤°€À¤€¬€ÄLÙ…±Õ”(€€€€€€I=4…Í¡}µ½Ù•µ•¹ÑÌ(€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Ä9‘•±•Ñ•‘}…Ð%L9U109Á¥••}¹Õµ‰•È1%-€É€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°€‘íÁÉ•™¥áô´•t°(€€€€¤ì(€€€É•ÑÕÉ¸€‘íÁÉ•™¥áô´‘íMÑÉ¥¹œ¡É½ÝÍlÁtü¹Ù…±Õ”€üü€Ä¤¹Á…‘MÑ…ÉÐ Ð°€œÀœ¥õ€ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ¥¹Í•ÉÑ%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹ÐèA½½±±¥•¹Ð°Ñ…‰±”èÍÑÉ¥¹œ°‰½‘äèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø°…±±½Ý•èÍÑÉ¥¹mt¤ì(€€€½¹ÍÐÁ…å±½…èI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø€ôì€¸¸¹‰½‘ä°½É…¹¥é…Ñ¥½¹}¥èÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤ôì(€€€½¹ÍÐ­•åÌ€ôl¸¸¹…±±½Ý•°€½É…¹¥é…Ñ¥½¹}¥t¹™¥±Ñ•È ¡­•ä°¥¹‘•à°…ÉÈ¤€ôø…ÉÈ¹¥¹‘•á=˜¡­•ä¤€ôôô¥¹‘•à€˜˜Á…å±½…‘m­•åt€„ôôÕ¹‘•™¥¹•¤ì(€€€¥˜€ …­•åÌ¹±•¹Ñ ¤Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 9¼‘…Ñ„ÁÉ½Ù¥‘•œ¤ì(€€€½¹ÍÐÙ…±Õ•Ì€ô­•åÌ¹µ…À ¡­•ä¤€ôøÁ…å±½…‘m­•åt¤ì(€€€½¹ÍÐÁ±…•¡½±‘•ÉÌ€ô­•åÌ¹µ…À ¡|°¥¹‘•à¤€ôø€‘í¥¹‘•à€¬€Åõ€¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€%9MIP%9Q<€‘íÑ…‰±•ô€ ‘í­•åÌ¹©½¥¸ œ°€œ¥ô¤Y1UL€ ‘íÁ±…•¡½±‘•ÉÌ¹©½¥¸ œ°€œ¥ô¤IQUI9%9€©€°(€€€€€Ù…±Õ•Ì°(€€€€¤ì(€€€É•ÑÕÉ¸É½ÝÍlÁtì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ¹•áÑµÁ±½å••9Õµ‰•È¡±¥•¹ÐèA½½±±¥•¹Ð¤ì(€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä¡M1PÁ}…‘Ù¥Í½Éå}á…Ñ}±½¬¡¡…Í¡Ñ•áÐ Ä¤¥€°m•µÁ±½å•”µ¹Õµ‰•È´‘íÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥õt¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P=1M¡5`¡9U11%¡É••áÁ}É•Á±…”¡•µÁ±½å••}¹Õµ‰•È°€mxÀ´åtœ°€œœ°€œœ¤°€œœ¤èé%9P¤°€À¤€¬€ÄLÙ…±Õ”(€€€€€€I=4•µÁ±½å••Ì(€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Å€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€É•ÑÕÉ¸5@´‘íMÑÉ¥¹œ¡É½ÝÍlÁtü¹Ù…±Õ”€üü€Ä¤¹Á…‘MÑ…ÉÐ Ø°€œÀœ¥õ€ì(€ô((€ÁÉ¥Ù…Ñ”¹½Éµ…±¥é•=ÁÑ¥½¹…±A½Í¥Ñ¥Ù•%¹Ð¡Ù…±Õ”èÕ¹­¹½Ý¸¤ì(€€€¥˜€¡Ù…±Õ”€ôôôÕ¹‘•™¥¹•ñðÙ…±Õ”€ôôô¹Õ±°ñðÙ…±Õ”€ôôô€œœ¤É•ÑÕÉ¸¹Õ±°ì(€€€½¹ÍÐÁ…ÉÍ•€ô9Õµ‰•È¡Ù…±Õ”¤ì(€€€¥˜€ …9Õµ‰•È¹¥Í%¹Ñ••È¡Á…ÉÍ•¤ñðÁ…ÉÍ•€ðô€À¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ %‘•¹Ñ¥™¥…¹Ð‘”Ë¥›¥É•¹Ñ¥•°I ¥¹Ù…±¥‘”¸œ¤ì(€€€ô(€€€É•ÑÕÉ¸Á…ÉÍ•ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÉ•Í½±Ù•!É…Ñ…±½9…µ” (€€€±¥•¹ÐèA¥¬ñ…Ñ…‰…Í•M•ÉÙ¥”°€ÅÕ•ÉäœøðA½½±±¥•¹Ð°(€€€Ñ…‰±”è€¡É}Í•ÉÙ¥•Ìœð€¡É}Á½Í¥Ñ¥½¹Ìœ°(€€€¥è¹Õµ‰•Èð¹Õ±°°(€€€™…±±‰…­Y…±Õ”èÕ¹­¹½Ý¸°(€€¤ì(€€€¥˜€¡¥¤ì(€€€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð€¡±¥•¹Ð…Ì…¹ä¤¹ÅÕ•Éä (€€€€€€€M1P¹…µ”(€€€€€€€€I=4€‘íÑ…‰±•ô(€€€€€€€€]!I¥€ô€Ä9½É…¹¥é…Ñ¥½¹}¥€ô€È9‘•±•Ñ•‘}…Ð%L9U11€°(€€€€€€€m¥°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€€€¤ì(€€€€€¥˜€ …É½ÝÍlÁtü¹¹…µ”¤ì(€€€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸¡Ñ…‰±”€ôôô€¡É}Í•ÉÙ¥•Ìœ€ü€M•ÉÙ¥”¥¹ÑÉ½ÕÙ…‰±”¸œ€è€½¹Ñ¥½¸¥¹ÑÉ½ÕÙ…‰±”¸œ¤ì(€€€€€ô(€€€€€É•ÑÕÉ¸MÑÉ¥¹œ¡É½ÝÍlÁt¹¹…µ”¤ì(€€€ô(€€€½¹ÍÐ™…±±‰…¬€ôMÑÉ¥¹œ¡™…±±‰…­Y…±Õ”€üü€œœ¤¹ÑÉ¥´ ¤ì(€€€É•ÑÕÉ¸™…±±‰…¬ñð¹Õ±°ì(€ô((€ÁÉ¥Ù…Ñ”¹½Éµ…±¥é•!É…Ñ…±½A…å±½…¡‰½‘äèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø¤ì(€€€½¹ÍÐ¹…µ”€ôMÑÉ¥¹œ¡‰½‘ä¹¹…µ”€üü€œœ¤¹ÑÉ¥´ ¤ì(€€€¥˜€ …¹…µ”¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1”¹½´•ÍÐ½‰±¥…Ñ½¥É”¸œ¤ì(€€€ô(€€€½¹ÍÐÍÑ…ÑÕÌ€ôMÑÉ¥¹œ¡‰½‘ä¹ÍÑ…ÑÕÌ€üü€Q%Yœ¤¹ÑÉ¥´ ¤¹Ñ½UÁÁ•É…Í” ¤ñð€Q%Yœì(€€€¥˜€ …lQ%Yœ°€%9Q%Yt¹¥¹±Õ‘•Ì¡ÍÑ…ÑÕÌ¤¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ MÑ…ÑÕÐI ¥¹Ù…±¥‘”¸œ¤ì(€€€ô(€€€½¹ÍÐ½‘”€ôMÑÉ¥¹œ¡‰½‘ä¹½‘”€üü€œœ¤¹ÑÉ¥´ ¤¹Ñ½UÁÁ•É…Í” ¤ì(€€€É•ÑÕÉ¸ì(€€€€€½‘”è½‘”ñð¹Õ±°°(€€€€€¹…µ”°(€€€€€‘•ÍÉ¥ÁÑ¥½¸èMÑÉ¥¹œ¡‰½‘ä¹‘•ÍÉ¥ÁÑ¥½¸€üü€œœ¤¹ÑÉ¥´ ¤ñð¹Õ±°°(€€€€€ÍÑ…ÑÕÌ°(€€€ôì(€ô((€ÁÉ¥Ù…Ñ”¹½Éµ…±¥é•%¹¥Ñ¥…±µÁ±½å••½¹ÑÉ…ÑA…å±½…¡‰½‘äèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø°Ù…±Õ•Ìèì(€€€½¹ÑÉ…ÑQåÁ”èÕ¹­¹½Ý¸ì(€€€ÍÑ…ÉÑ…Ñ”èÕ¹­¹½Ý¸ì(€€€•¹‘…Ñ”èÕ¹­¹½Ý¸ì(€€€Í…±…Éåµ½Õ¹ÐèÕ¹­¹½Ý¸ì(€€€ÕÉÉ•¹äèÕ¹­¹½Ý¸ì(€€€©½‰Q¥Ñ±”èÕ¹­¹½Ý¸ì(€€€‘•Á…ÉÑµ•¹ÐèÕ¹­¹½Ý¸ì(€€€½‰Í•ÉÙ…Ñ¥½¹ÌèÕ¹­¹½Ý¸ì(€€€ÍÑ…ÑÕÌèÕ¹­¹½Ý¸ì(€ô¤ì(€€€½¹ÍÐ½¹ÑÉ…ÑQåÁ”€ôMÑÉ¥¹œ¡Ù…±Õ•Ì¹½¹ÑÉ…ÑQåÁ”€üü€œœ¤¹ÑÉ¥´ ¤ì(€€€¥˜€ …½¹ÑÉ…ÑQåÁ”¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ QåÁ”‘”½¹ÑÉ…ÐÉ•ÅÕ¥Ì¸œ¤ì(€€€ô(€€€½¹ÍÐÍÑ…ÉÑ…Ñ”€ôÑ¡¥Ì¹¹½Éµ…±¥é•!É…Ñ”¡Ù…±Õ•Ì¹ÍÑ…ÉÑ…Ñ”°€‘…Ñ”‘”“¥‰ÕÐ‘Ô½¹ÑÉ…Ðœ°ÑÉÕ”¤ì(€€€½¹ÍÐ•¹‘…Ñ”€ôÑ¡¥Ì¹¹½Éµ…±¥é•!É…Ñ”¡Ù…±Õ•Ì¹•¹‘…Ñ”°€‘…Ñ”‘”™¥¸‘Ô½¹ÑÉ…Ðœ¤ì(€€€¥˜€¡½¹ÑÉ…ÑQåÁ”¹Ñ½UÁÁ•É…Í” ¤€ôôô€œ€˜˜€…•¹‘…Ñ”¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ …Ñ”‘”™¥¸½‰±¥…Ñ½¥É”Á½ÕÈÕ¸¸œ¤ì(€€€ô(€€€¥˜€¡•¹‘…Ñ”€˜˜ÍÑ…ÉÑ…Ñ”€˜˜•¹‘…Ñ”€ðôÍÑ…ÉÑ…Ñ”¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1„‘…Ñ”‘”™¥¸‘Ô½¹ÑÉ…Ð‘½¥Ðƒ©ÑÉ”Á½ÍÓ¥É¥•ÕÉ”ƒ€±„‘…Ñ”‘”“¥‰ÕÐ¸œ¤ì(€€€ô(€€€½¹ÍÐÍ…±…Éåµ½Õ¹Ð€ô9Õµ‰•È¡Ù…±Õ•Ì¹Í…±…Éåµ½Õ¹Ð€üü€À¤ì(€€€¥˜€ …9Õµ‰•È¹¥Í¥¹¥Ñ”¡Í…±…Éåµ½Õ¹Ð¤ñðÍ…±…Éåµ½Õ¹Ð€ð€À¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ M…±…¥É”‘”½¹ÑÉ…Ð¥¹Ù…±¥‘”¸œ¤ì(€€€ô(€€€½¹ÍÐÕÉÉ•¹ä€ôMÑÉ¥¹œ¡Ù…±Õ•Ì¹ÕÉÉ•¹ä€üü€UMœ¤¹ÑÉ¥´ ¤¹Ñ½UÁÁ•É…Í” ¤ì(€€€¥˜€¡Í…±…Éåµ½Õ¹Ð€ø€À€˜˜€…ÕÉÉ•¹ä¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ •Ù¥Í”½‰±¥…Ñ½¥É”Á½ÕÈ±”½¹ÑÉ…Ð¸œ¤ì(€€€ô(€€€½¹ÍÐÍÑ…ÑÕÌ€ôMÑÉ¥¹œ¡Ù…±Õ•Ì¹ÍÑ…ÑÕÌ€üü€Q%Yœ¤¹ÑÉ¥´ ¤¹Ñ½UÁÁ•É…Í” ¤ñð€Q%Yœì(€€€¥˜€ …lQ%Yœ°€IPœ°€A9%9œ°€UQUIœ°€QI5%9Qt¹¥¹±Õ‘•Ì¡ÍÑ…ÑÕÌ¤¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ MÑ…ÑÕÐ‘”½¹ÑÉ…Ð¥¹Ù…±¥‘”¸œ¤ì(€€€ô(€€€É•ÑÕÉ¸ì(€€€€€½¹ÑÉ…Ñ}ÑåÁ”è½¹ÑÉ…ÑQåÁ”°(€€€€€ÍÑ…ÉÑ}‘…Ñ”èÍÑ…ÉÑ…Ñ”°(€€€€€•¹‘}‘…Ñ”è½¹ÑÉ…ÑQåÁ”¹Ñ½UÁÁ•É…Í” ¤€ôôô€$œ€ü¹Õ±°€è•¹‘…Ñ”°(€€€€€Í…±…Éå}…µ½Õ¹ÐèÍ…±…Éåµ½Õ¹Ð°(€€€€€ÕÉÉ•¹äèÕÉÉ•¹äñð€UMœ°(€€€€€©½‰}Ñ¥Ñ±”èMÑÉ¥¹œ¡Ù…±Õ•Ì¹©½‰Q¥Ñ±”€üü€œœ¤¹ÑÉ¥´ ¤ñð¹Õ±°°(€€€€€‘•Á…ÉÑµ•¹ÐèMÑÉ¥¹œ¡Ù…±Õ•Ì¹‘•Á…ÉÑµ•¹Ð€üü€œœ¤¹ÑÉ¥´ ¤ñð¹Õ±°°(€€€€€½‰Í•ÉÙ…Ñ¥½¹ÌèMÑÉ¥¹œ¡Ù…±Õ•Ì¹½‰Í•ÉÙ…Ñ¥½¹Ì€üü€œœ¤¹ÑÉ¥´ ¤ñð¹Õ±°°(€€€€€ÍÑ…ÑÕÌ°(€€€ôì(€ô((€ÁÉ¥Ù…Ñ”¹½Éµ…±¥é•!É…Ñ”¡Ù…±Õ”èÕ¹­¹½Ý¸°™¥•±‘9…µ”èÍÑÉ¥¹œ°É•ÅÕ¥É•€ô™…±Í”¤ì(€€€¥˜€¡Ù…±Õ”€ôôôÕ¹‘•™¥¹•ñðÙ…±Õ”€ôôô¹Õ±°ñðÙ…±Õ”€ôôô€œœ¤ì(€€€€€¥˜€¡É•ÅÕ¥É•¤Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸¡…Ñ”É•ÅÕ¥Í”Á½ÕÈ€‘í™¥•±‘9…µ•ô¹€¤ì(€€€€€É•ÑÕÉ¸¹Õ±°ì(€€€ô(€€€½¹ÍÐÉ…Ü€ôMÑÉ¥¹œ¡Ù…±Õ”¤¹ÑÉ¥´ ¤ì(€€€¥˜€ …É…Ü¤ì(€€€€€¥˜€¡É•ÅÕ¥É•¤Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸¡…Ñ”É•ÅÕ¥Í”Á½ÕÈ€‘í™¥•±‘9…µ•ô¹€¤ì(€€€€€É•ÑÕÉ¸¹Õ±°ì(€€€ô(€€€½¹ÍÐ¥Í½…Ñ”€ô€½yq‘ìÑôµq‘ìÉôµq‘ìÉô¼¹•á•Œ¡É…Ü¤ü¹lÁtì(€€€¥˜€¡¥Í½…Ñ”¤É•ÑÕÉ¸¥Í½…Ñ”ì(€€€½¹ÍÐÁ…ÉÍ•€ô¹•Ü…Ñ”¡É…Ü¤ì(€€€¥˜€¡9Õµ‰•È¹¥Í9…8¡Á…ÉÍ•¹•ÑQ¥µ” ¤¤¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸¡…Ñ”¥¹Ù…±¥‘”Á½ÕÈ€‘í™¥•±‘9…µ•ô¹€¤ì(€€€ô(€€€É•ÑÕÉ¸Á…ÉÍ•¹Ñ½%M=MÑÉ¥¹œ ¤¹Í±¥” À°€ÄÀ¤ì(€ô((€ÁÉ¥Ù…Ñ”¹½Éµ…±¥é•…Í¡áÁ•¹Í•…Ñ•½ÉåA…å±½…¡‰½‘äèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø¤ì(€€€½¹ÍÐ¹…µ”€ôMÑÉ¥¹œ¡‰½‘ä¹¹…µ”€üü€œœ¤¹ÑÉ¥´ ¤ì(€€€¥˜€ …¹…µ”¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ 1”¹½´‘”±„…Ó¥½É¥”•ÍÐ½‰±¥…Ñ½¥É”¸œ¤ì(€€€ô(€€€½¹ÍÐÍÑ…ÑÕÌ€ôMÑÉ¥¹œ¡‰½‘ä¹ÍÑ…ÑÕÌ€üü€Q%Yœ¤¹ÑÉ¥´ ¤¹Ñ½UÁÁ•É…Í” ¤ñð€Q%Yœì(€€€¥˜€ …lQ%Yœ°€%9Q%Yt¹¥¹±Õ‘•Ì¡ÍÑ…ÑÕÌ¤¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ MÑ…ÑÕÐ‘”…Ó¥½É¥”‘”“¥Á•¹Í”¥¹Ù…±¥‘”¸œ¤ì(€€€ô(€€€É•ÑÕÉ¸ì(€€€€€½‘”èÑ¡¥Ì¹‰Õ¥±‘…Í¡áÁ•¹Í•…Ñ•½Éå½‘”¡‰½‘ä¹½‘”°¹…µ”¤°(€€€€€¹…µ”°(€€€€€‘•ÍÉ¥ÁÑ¥½¸èMÑÉ¥¹œ¡‰½‘ä¹‘•ÍÉ¥ÁÑ¥½¸€üü€œœ¤¹ÑÉ¥´ ¤ñð¹Õ±°°(€€€€€ÍÑ…ÑÕÌ°(€€€ôì(€ô((€ÁÉ¥Ù…Ñ”‰Õ¥±‘…Í¡áÁ•¹Í•…Ñ•½Éå½‘”¡Ù…±Õ”èÕ¹­¹½Ý¸°™…±±‰…­9…µ”èÍÑÉ¥¹œ¤ì(€€€½¹ÍÐÉ…Ü€ôMÑÉ¥¹œ¡Ù…±Õ”€üü€œœ¤¹ÑÉ¥´ ¤ñð™…±±‰…­9…µ”ì(€€€½¹ÍÐ¹½Éµ…±¥é•€ôÉ…Ü(€€€€€€¹¹½Éµ…±¥é” 9œ¤(€€€€€€¹É•Á±…” ½mqÔÀÌÀÀµqÔÀÌÙ™t½œ°€œœ¤(€€€€€€¹Ñ½UÁÁ•É…Í” ¤(€€€€€€¹É•Á±…” ½myµhÀ´åt¬½œ°€|œ¤(€€€€€€¹É•Á±…” ½y|­ñ|¬½œ°€œœ¤(€€€€€€¹Í±¥” À°€ÐÀ¤ì(€€€¥˜€ …¹½Éµ…±¥é•¤ì(€€€€€Ñ¡É½Ü¹•Ü	…‘I•ÅÕ•ÍÑá•ÁÑ¥½¸ ½‘”‘”…Ó¥½É¥”‘”“¥Á•¹Í”¥¹Ù…±¥‘”¸œ¤ì(€€€ô(€€€É•ÑÕÉ¸¹½Éµ…±¥é•ì(€ô((€ÁÉ¥Ù…Ñ”¡…¹‘±•…Í¡áÁ•¹Í•…Ñ•½ÉåM¡•µ…ÉÉ½È¡•ÉÉ½Èè…¹ä¤ì(€€€¥˜€¡•ÉÉ½Èü¹½‘”€ôôô€œÐÉ@ÀÄœñð•ÉÉ½Èü¹½‘”€ôôô€œÐÈÜÀÌœ¤ì(€€€€€Ñ¡É½Ü¹•ÜM•ÉÙ¥•U¹…Ù…¥±…‰±•á•ÁÑ¥½¸ (€€€€€€€€1”Ë¥›¥É•¹Ñ¥•°‘•Ì…Ó¥½É¥•Ì‘”“¥Á•¹Í”»Še•ÍÐÁ…Ì‘¥ÍÁ½¹¥‰±”¸ÁÁ±¥ÅÕ•è±„µ¥É…Ñ¥½¸€ÈÀÈØÀÜÄÝ}…Í¡}•áÁ•¹Í•}…Ñ•½É¥•Ì¹ÍÅ°¸œ°(€€€€€€¤ì(€€€ô(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ™¥¹‘…Í¡áÁ•¹Í•…Ñ•½Éå½ÉQÉ…Í ¡½‘”èÍÑÉ¥¹œ¤ì(€€€½¹ÍÐ¹½Éµ…±¥é•‘½‘”€ôMÑÉ¥¹œ¡½‘”€üü€œœ¤¹ÑÉ¥´ ¤¹Ñ½UÁÁ•É…Í” ¤ì(€€€½¹ÍÐÍÕÁÁ½ÉÑÍ%ÍÑ¥Ù”€ô…Ý…¥ÐÑ¡¥Ì¹½±Õµ¹á¥ÍÑÌ …Í¡}•áÁ•¹Í•}…Ñ•½É¥•Ìœ°€¥Í}…Ñ¥Ù”œ¤ì(€€€½¹ÍÐÍÕÁÁ½ÉÑÍMÑ…ÑÕÌ€ô…Ý…¥ÐÑ¡¥Ì¹½±Õµ¹á¥ÍÑÌ …Í¡}•áÁ•¹Í•}…Ñ•½É¥•Ìœ°€ÍÑ…ÑÕÌœ¤ì(€€€½¹ÍÐ…Ñ¥Ù•áÁÉ•ÍÍ¥½¸€ôÍÕÁÁ½ÉÑÍ%ÍÑ¥Ù”(€€€€€€ü€=1M¡¥Í}…Ñ¥Ù”°QIU¤€ôQIUœ(€€€€€€èÍÕÁÁ½ÉÑÍMÑ…ÑÕÌ(€€€€€€€€ü=1M¡UAAH¡ÍÑ…ÑÕÌ¤°€Q%Yœ¤€ô€Q%Y€(€€€€€€€€è€QIUœì(€€€½¹ÍÐÍ•±•Ñ•‘½±Õµ¹Ì€ôl(€€€€€€¥œ°(€€€€€€½‘”œ°(€€€€€ÍÕÁÁ½ÉÑÍ%ÍÑ¥Ù”(€€€€€€€€ü€=1M¡¥Í}…Ñ¥Ù”°QIU¤L¥Í}…Ñ¥Ù”œ(€€€€€€€€èÍÕÁÁ½ÉÑÍMÑ…ÑÕÌ(€€€€€€€€€€üM]!8=1M¡UAAH¡ÍÑ…ÑÕÌ¤°€Q%Yœ¤€ô€Q%YœQ!8QIU1M1M9L¥Í}…Ñ¥Ù•€(€€€€€€€€€€è€QIUL¥Í}…Ñ¥Ù”œ°(€€€t¹©½¥¸ œ°€œ¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€M1P€‘íÍ•±•Ñ•‘½±Õµ¹Íô(€€€€€€I=4…Í¡}•áÁ•¹Í•}…Ñ•½É¥•Ì(€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€9‘•±•Ñ•‘}…Ð%L9U10(€€€€€€€€9UAAH¡QI%4¡½‘”¤¤€ô€È(€€€€€€€€9€‘í…Ñ¥Ù•áÁÉ•ÍÍ¥½¹ô(€€€€€€1%5%P€Å€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°¹½Éµ…±¥é•‘½‘•t°(€€€€¤ì(€€€É•ÑÕÉ¸ì(€€€€€µ…Ñ¡•‘…Ñ•½ÉäèÉ½ÝÍlÁt€üü¹Õ±°°(€€€€€¹½Éµ…±¥é•‘½‘”°(€€€€€•á¥ÍÑÌè	½½±•…¸¡É½ÝÍlÁt¤°(€€€ôì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÉ•…Ñ•!É…Ñ…±½I½Ü¡Ñ…‰±”è€¡É}Í•ÉÙ¥•Ìœð€¡É}Á½Í¥Ñ¥½¹Ìœ°‰½‘äèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø¤ì(€€€½¹ÍÐÁ…å±½…€ôÑ¡¥Ì¹¹½Éµ…±¥é•!É…Ñ…±½A…å±½…¡‰½‘ä¤ì(€€€ÑÉäì(€€€€€É•ÑÕÉ¸…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÑÉ…¹Í…Ñ¥½¸¡…Íå¹Œ€¡±¥•¹Ð¤€ôøì(€€€€€€€Á…å±½…¹½‘”€ô…Ý…¥ÐÑ¡¥Ì¹¹•áÑ!É…Ñ…±½½‘”¡±¥•¹Ð°Ñ…‰±”¤ì(€€€€€€€É•ÑÕÉ¸Ñ¡¥Ì¹¥¹Í•ÉÑ%¹QÉ…¹Í…Ñ¥½¸¡±¥•¹Ð°Ñ…‰±”°Á…å±½…°l½‘”œ°€¹…µ”œ°€‘•ÍÉ¥ÁÑ¥½¸œ°€ÍÑ…ÑÕÌt¤ì(€€€€€ô¤ì(€€€ô…Ñ €¡•ÉÉ½Èè…¹ä¤ì(€€€€€¥˜€¡•ÉÉ½Èü¹½‘”€ôôô€œÈÌÔÀÔœ¤ì(€€€€€€€Ñ¡É½Ü¹•Ü½¹™±¥Ñá•ÁÑ¥½¸ •ÑÑ”Ù…±•ÕÈ•á¥ÍÑ”“¥«€‘…¹Ì±”Ë¥›¥É•¹Ñ¥•°I ¸œ¤ì(€€€€€ô(€€€€€Ñ¡É½Ü•ÉÉ½Èì(€€€ô(€ô((€ÁÉ¥Ù…Ñ”…Íå¹ŒÕÁ‘…Ñ•!É…Ñ…±½I½Ü¡Ñ…‰±”è€¡É}Í•ÉÙ¥•Ìœð€¡É}Á½Í¥Ñ¥½¹Ìœ°¥è¹Õµ‰•È°‰½‘äèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø¤ì(€€€½¹ÍÐÁ…å±½…€ôÑ¡¥Ì¹¹½Éµ…±¥é•!É…Ñ…±½A…å±½…¡‰½‘ä¤ì(€€€‘•±•Ñ”€¡Á…å±½……ÌI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø¤¹½‘”ì(€€€ÑÉäì(€€€€€É•ÑÕÉ¸…Ý…¥ÐÑ¡¥Ì¹ÕÁ‘…Ñ•	å%¡Ñ…‰±”°¥°Á…å±½…°l¹…µ”œ°€‘•ÍÉ¥ÁÑ¥½¸œ°€ÍÑ…ÑÕÌt¤ì(€€€ô…Ñ €¡•ÉÉ½Èè…¹ä¤ì(€€€€€¥˜€¡•ÉÉ½Èü¹½‘”€ôôô€œÈÌÔÀÔœ¤ì(€€€€€€€Ñ¡É½Ü¹•Ü½¹™±¥Ñá•ÁÑ¥½¸ •ÑÑ”Ù…±•ÕÈ•á¥ÍÑ”“¥«€‘…¹Ì±”Ë¥›¥É•¹Ñ¥•°I ¸œ¤ì(€€€€€ô(€€€€€Ñ¡É½Ü•ÉÉ½Èì(€€€ô(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ‘•…Ñ¥Ù…Ñ•!É…Ñ…±½I½Ü¡Ñ…‰±”è€¡É}Í•ÉÙ¥•Ìœð€¡É}Á½Í¥Ñ¥½¹Ìœ°¥è¹Õµ‰•È¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥ÐÑ¡¥Ì¹‘ˆ¹ÅÕ•Éä (€€€€€UAQ€‘íÑ…‰±•ô(€€€€€€MPÍÑ…ÑÕÌ€ô€%9Q%Yœ°(€€€€€€€€€€ÕÁ‘…Ñ•‘}…Ð€ô9=\ ¤(€€€€€€]!I¥€ô€Ä9½É…¹¥é…Ñ¥½¹}¥€ô€È9‘•±•Ñ•‘}…Ð%L9U10(€€€€€€IQUI9%9€©€°(€€€€€m¥°Ñ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€É•ÑÕÉ¸É•ÅÕ¥É•I½Ü¡É½ÝÍlÁt°Ñ…‰±”¤ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ¹•áÑµÁ±½å••½¹ÑÉ…Ñ9Õµ‰•È¡±¥•¹ÐèA½½±±¥•¹Ð¤ì(€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä¡M1PÁ}…‘Ù¥Í½Éå}á…Ñ}±½¬¡¡…Í¡Ñ•áÐ Ä¤¥€°m•µÁ±½å•”µ½¹ÑÉ…Ð´‘íÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥õt¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P=1M¡5`¡9U11%¡É••áÁ}É•Á±…”¡½¹ÑÉ…Ñ}¹Õµ‰•È°€mxÀ´åtœ°€œœ°€œœ¤°€œœ¤èé%9P¤°€À¤€¬€ÄLÙ…±Õ”(€€€€€€I=4•µÁ±½å••}½¹ÑÉ…ÑÌ(€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Å€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥t°(€€€€¤ì(€€€É•ÑÕÉ¸QH´‘íMÑÉ¥¹œ¡É½ÝÍlÁtü¹Ù…±Õ”€üü€Ä¤¹Á…‘MÑ…ÉÐ Ø°€œÀœ¥õ€ì(€ô((€ÁÉ¥Ù…Ñ”…Íå¹Œ¹•áÑ!É…Ñ…±½½‘”¡±¥•¹ÐèA½½±±¥•¹Ð°Ñ…‰±”è€¡É}Í•ÉÙ¥•Ìœð€¡É}Á½Í¥Ñ¥½¹Ìœ¤ì(€€€½¹ÍÐÁÉ•™¥à€ôÑ…‰±”€ôôô€¡É}Í•ÉÙ¥•Ìœ€ü€MIXœ€è€Pœì(€€€…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä¡M1PÁ}…‘Ù¥Í½Éå}á…Ñ}±½¬¡¡…Í¡Ñ•áÐ Ä¤¥€°m€‘íÑ…‰±•ôµ½‘”´‘íÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¥õt¤ì(€€€½¹ÍÐìÉ½ÝÌô€ô…Ý…¥Ð±¥•¹Ð¹ÅÕ•Éä (€€€€€M1P=1M¡5`¡9U11%¡MU	MQI%9¡½‘”I=4€œ¡lÀ´åt¬¤œ¤°€œœ¤èé%9P¤°€À¤€¬€ÄLÙ…±Õ”(€€€€€€I=4€‘íÑ…‰±•ô(€€€€€€]!I½É…¹¥é…Ñ¥½¹}¥€ô€Ä(€€€€€€€€9½‘”1%-€É€°(€€€€€mÑ¡¥Ì¹½¹Ñ•áÐ¹½É…¹¥é…Ñ¥½¹% ¤°€‘íÁÉ•™¥áô´•t°(€€€€¤ì(€€€É•ÑÕÉ¸€‘íÁÉ•™¥áô´‘íMÑÉ¥¹œ¡É½ÝÍlÁtü¹Ù…±Õ”€üü€Ä¤¹Á…‘MÑ…ÉÐ Ð°€œÀœ¥õ€ì(€ô)ô