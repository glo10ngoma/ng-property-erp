import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { RequestContext } from '../auth/request-context';
import { hashPassword } from '../auth/password';
import { requireRow } from '../common/not-found';
import { DatabaseService } from '../database/database.service';
import {
  buildLeaseContractHtml,
  buildLeaseContractPdfBase64,
  renderLeaseContractTemplate,
  unresolvedPlaceholders,
} from '../leases/lease-contracts';
import { normalizeRole } from './permissions';

@Injectable()
export class SaasService {
  private readonly companyStorageBucket = 'company';
  private readonly allowedCompanyFileKinds = new Set(['logo', 'signature', 'stamp']);
  private readonly allowedCompanyFileMimeTypes = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml']);

  constructor(private readonly db: DatabaseService, private readonly context: RequestContext) {}

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

  async createUser(body: Record<string, unknown>) {
    const password = String(body.password ?? body.password_hash ?? 'demo');
    return this.insert('app_users', { status: 'ACTIVE', ...body, role: normalizeRole(String(body.role ?? 'EDITOR')), password_hash: await hashPassword(password) }, [
      'first_name',
      'last_name',
      'email',
      'password_hash',
      'role',
      'status',
    ]);
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
    const { rows } = await this.db.query(
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
      const providedEmployeeNumber = String(body.employee_number ?? '').trim();
      const employeeNumber = providedEmployeeNumber && !providedEmployeeNumber.toLowerCase().includes('automatique')
        ? providedEmployeeNumber
        : await this.nextEmployeeNumber(client);
      const payload = {
        ...body,
        employee_number: employeeNumber,
        monthly_salary: Number(body.monthly_salary ?? 0),
        status: body.status ?? 'ACTIVE',
      };
      const employee = await this.insertInTransaction(client, 'employees', payload, [
        'employee_number', 'first_name', 'last_name', 'post_name', 'gender', 'birth_date', 'nationality', 'marital_status',
        'phone', 'secondary_phone', 'email', 'address', 'job_title', 'department', 'hire_date', 'contract_type',
        'assigned_site', 'manager_name', 'status', 'monthly_salary', 'payment_method', 'bank_name', 'account_number',
        'mobile_money_number', 'id_document_type', 'id_document_number', 'identity_attachment_name', 'cv_attachment_name',
        'signed_contract_attachment_name', 'emergency_contact_name', 'emergency_contact_phone', 'internal_notes',
      ]);
      return employee;
    });
  }

  async updateEmployee(id: number, body: Record<string, unknown>) {
    const payload = {
      ...body,
      monthly_salary: body.monthly_salary !== undefined ? Number(body.monthly_salary ?? 0) : undefined,
    };
    return this.updateById('employees', id, payload, [
      'employee_number', 'first_name', 'last_name', 'post_name', 'gender', 'birth_date', 'nationality', 'marital_status',
      'phone', 'secondary_phone', 'email', 'address', 'job_title', 'department', 'hire_date', 'contract_type',
      'assigned_site', 'manager_name', 'status', 'monthly_salary', 'payment_method', 'bank_name', 'account_number',
      'mobile_money_number', 'id_document_type', 'id_document_number', 'identity_attachment_name', 'cv_attachment_name',
      'signed_contract_attachment_name', 'emergency_contact_name', 'emergency_contact_phone', 'internal_notes',
    ]);
  }

  async employeeDetail(id: number) {
    const organizationId = this.context.organizationId();
    const employee = await this.queryOptionalRows(
      `SELECT e.*, CONCAT(e.first_name, ' ', COALESCE(e.post_name || ' ', ''), e.last_name) AS full_name
       FROM employees e
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
      row.identity_attachment_name ? { type: 'Pièce identité', file_name: row.identity_attachment_name } : null,
      row.cv_attachment_name ? { type: 'CV', file_name: row.cv_attachment_name } : null,
      row.signed_contract_attachment_name ? { type: 'Contrat signé', file_name: row.signed_contract_attachment_name } : null,
      ...contracts.filter((contract) => contract.contract_file_name).map((contract) => ({ type: 'Contrat RH', file_name: contract.contract_file_name })),
    ].filter(Boolean);
    const timeline = [
      { date: row.created_at, event: 'Création employé', description: row.full_name },
      ...contracts.map((contract) => ({ date: contract.start_date, event: 'Contrat', description: `${contract.contract_number} - ${contract.contract_type}` })),
      ...advances.map((advance) => ({ date: advance.advance_date, event: 'Avance', description: `Montant ${advance.amount}` })),
      ...leaves.map((leave) => ({ date: leave.start_date, event: 'Congé', description: `${leave.leave_type} - ${leave.status}` })),
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
      if (row.status === 'PAID') throw new BadRequestException('Cette avance est dÃƒÂ©jÃƒÂ  payÃƒÂ©e');
      await this.ensureWorkflowApproved(client, row.workflow_instance_id);
      if (!['APPROVED', 'PENDING', 'DRAFT'].includes(row.status)) throw new BadRequestException('Cette avance ne peut pas ÃƒÂªtre payÃƒÂ©e');
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
          title: `Demande congÃƒÂ© #${rows[0].id}`,
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
      if (row.status === 'PAID') throw new BadRequestException('Cette paie est dÃƒÂ©jÃƒÂ  payÃƒÂ©e');
      if (!['VALIDATED', 'DRAFT'].includes(row.status)) throw new BadRequestException('Cette paie ne peut pas ÃƒÂªtre payÃƒÂ©e');
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
    if (exists.rows[0]) throw new BadRequestException('Une caisse est dÃƒÂ©jÃƒÂ  ouverte');
    return this.insert('cash_sessions', { opened_by: this.context.userId() ?? 1, opening_balance: 0, status: 'OPEN', ...body }, [
      'opened_by',
      'opening_balance',
      'status',
    ]);
  }

  async closeCash(closingBalance: number) {
    return this.db.transaction(async (client) => {
      const session = await this.openSession(client);
      const totals = await client.query(
        `SELECT
           COALESCE(SUM(CASE WHEN type = 'IN' THEN amount ELSE 0 END), 0)::NUMERIC(12,2) AS total_in,
           COALESCE(SUM(CASE WHEN type = 'OUT' THEN amount ELSE 0 END), 0)::NUMERIC(12,2) AS total_out
         FROM cash_movements WHERE cash_session_id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
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
      if (body.workflow_required) {
        return this.createWorkflowInstanceInTransaction(client, {
          type: 'EXPENSE_APPROVAL',
          entity_type: 'cash_movements',
          entity_id: null,
          title: `Demande dÃƒÂ©pense ${body.category ?? 'caisse'} - ${Number(body.amount ?? 0)}`,
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

  async cashMovements() {
    const { rows } = await this.db.query(`
      SELECT cm.*, cs.status AS session_status, i.invoice_number,
             CONCAT(t.first_name, ' ', t.last_name) AS tenant_name,
             CONCAT(e.first_name, ' ', e.last_name) AS employee_name
      FROM cash_movements cm
      JOIN cash_sessions cs ON cs.id = cm.cash_session_id
      LEFT JOIN invoices i ON i.id = cm.invoice_id
      LEFT JOIN tenants t ON t.id = cm.tenant_id
      LEFT JOIN employees e ON e.id = cm.employee_id
      WHERE cm.organization_id = $1 AND cm.deleted_at IS NULL
      ORDER BY cm.movement_date DESC, cm.id DESC
    `, [this.context.organizationId()]);
    return rows;
  }

  async cashMovementDetail(id: number) {
    const { rows } = await this.db.query(
      `SELECT cm.*, cs.status AS session_status, cs.opened_at, cs.closed_at, cs.opening_balance, cs.closing_balance,
              cs.expected_balance, cs.difference_amount,
              i.invoice_number, i.total AS invoice_total, i.status AS invoice_status,
              CONCAT(t.first_name, ' ', t.last_name) AS tenant_name,
              t.phone AS tenant_phone, t.email AS tenant_email,
              CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
              u.number AS unit_number, b.name AS building_name,
              al.action AS audit_action, al.created_at AS audit_date, al.metadata AS audit_metadata
       FROM cash_movements cm
       JOIN cash_sessions cs ON cs.id = cm.cash_session_id
       LEFT JOIN invoices i ON i.id = cm.invoice_id
       LEFT JOIN tenants t ON t.id = cm.tenant_id
       LEFT JOIN employees e ON e.id = cm.employee_id
       LEFT JOIN units u ON u.id = i.unit_id
       LEFT JOIN buildings b ON b.id = u.building_id
       LEFT JOIN LATERAL (
         SELECT action, created_at, metadata
         FROM audit_logs
         WHERE organization_id = $2 AND resource = 'cash' AND resource_id = cm.id::TEXT
         ORDER BY created_at DESC
         LIMIT 1
       ) al ON TRUE
       WHERE cm.id = $1 AND cm.organization_id = $2 AND cm.deleted_at IS NULL`,
      [id, this.context.organizationId()],
    );
    const movement = requireRow(rows[0], 'Cash movement');
    const timeline = await this.db.query(
      `SELECT id, created_at AS date, action, resource, method, path, status_code, metadata
       FROM audit_logs
       WHERE organization_id = $1 AND resource = 'cash' AND resource_id = $2::TEXT
       ORDER BY created_at DESC`,
      [this.context.organizationId(), String(id)],
    );
    const documents = [
      { name: 'ReÃƒÂ§u PDF', exists: true, detail: `Mouvement_${movement.id}.pdf` },
      { name: 'PiÃƒÂ¨ce jointe', exists: Boolean((movement as Record<string, unknown>).attachment_file_name), detail: String((movement as Record<string, unknown>).attachment_file_name ?? 'Non disponible') },
      { name: 'QR Code', exists: true, detail: 'Placeholder' },
      { name: 'Code barre', exists: true, detail: 'Placeholder' },
    ];
    return { ...movement, timeline: timeline.rows, documents, history: timeline.rows };
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
    const [lines, receipts, payments, timeline, stockMovements, cashMovements] = await Promise.all([
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
    };
  }

  async createStockPurchase(body: Record<string, unknown>) {
    const lines = Array.isArray(body.lines) ? (body.lines as Array<Record<string, unknown>>) : [];
    if (!lines.length) throw new BadRequestException('Ajoutez au moins un article');
    return this.db.transaction(async (client) => {
      const paymentType = String(body.payment_type ?? 'DEFERRED').toUpperCase();
      if (!['CASH', 'PARTIAL', 'DEFERRED'].includes(paymentType)) {
        throw new BadRequestException('Type de paiement invalide');
      }
      const purchaseNumber = await this.nextStockPurchaseNumber(client);
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
         (purchase_number, purchase_date, supplier_name, supplier_reference, store, payment_terms, payment_method,
          payment_type, due_date, subtotal_amount, tax_amount, discount_amount, total_amount, paid_amount,
          outstanding_amount, purchase_status, reception_status, payment_status, observations, created_by, organization_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'OPEN', 'PENDING', $16, $17, $18, $19)
         RETURNING *`,
        [
          purchaseNumber,
          body.purchase_date ?? new Date().toISOString().slice(0, 10),
          body.supplier_name,
          body.supplier_reference ?? null,
          body.store ?? null,
          body.payment_terms ?? null,
          body.payment_method ?? null,
          paymentType,
          body.due_date ?? null,
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
      for (const line of normalizedLines) {
        await client.query(
          `INSERT INTO stock_purchase_lines
           (stock_purchase_id, stock_item_id, quantity, received_quantity, unit_price, line_total, organization_id)
           VALUES ($1, $2, $3, 0, $4, $5, $6)`,
          [purchase.id, line.stock_item_id, line.quantity, line.unit_price, line.line_total, this.context.organizationId()],
        );
      }
      await this.addStockPurchaseTimeline(client, purchase.id, 'CREATED', 'Achat fournisseur', `Bon ${purchaseNumber} cree`);
      if (initialPaidAmount > 0) {
        const payment = await this.recordStockPurchasePaymentInTransaction(client, purchase.id, {
          amount: initialPaidAmount,
          payment_date: body.purchase_date ?? new Date().toISOString().slice(0, 10),
          payment_method: body.payment_method ?? null,
          reference: purchaseNumber,
          notes: paymentType === 'CASH' ? 'Paiement comptant achat fournisseur' : 'Paiement partiel achat fournisseur',
        }, false);
        await this.addStockPurchaseTimeline(client, purchase.id, 'PAYMENT', 'Paiement fournisseur', `Paiement initial ${initialPaidAmount.toFixed(2)} USD`);
        return { ...purchase, payments: [payment] };
      }
      return purchase;
    });
  }

  async receiveStockPurchase(id: number, body: Record<string, unknown>) {
    const lines = Array.isArray(body.lines) ? (body.lines as Array<Record<string, unknown>>) : [];
    if (!lines.length) throw new BadRequestException('Ajoutez au moins une ligne de reception');
    return this.db.transaction(async (client) => {
      const purchase = await client.query(
        `SELECT * FROM stock_purchases
         WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
         FOR UPDATE`,
        [id, this.context.organizationId()],
      );
      const purchaseRow = requireRow(purchase.rows[0], 'Stock purchase');
      if (purchaseRow.purchase_status === 'CANCELLED') throw new BadRequestException('Cet achat est annule');
      const purchaseLines = await client.query(
        `SELECT spl.*, si.name AS item_name
         FROM stock_purchase_lines spl
         JOIN stock_items si ON si.id = spl.stock_item_id
         WHERE spl.stock_purchase_id = $1 AND spl.organization_id = $2 AND spl.deleted_at IS NULL
         ORDER BY spl.id
         FOR UPDATE`,
        [id, this.context.organizationId()],
      );
      const linesById = new Map<number, Record<string, unknown>>(purchaseLines.rows.map((line) => [Number(line.id), line]));
      const receiptNumber = await this.nextStockReceiptNumber(client);
      const receipt = await client.query(
        `INSERT INTO stock_purchase_receipts
         (stock_purchase_id, receipt_number, receipt_date, receiver_name, store, notes, created_by, organization_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          id,
          receiptNumber,
          body.receipt_date ?? new Date().toISOString().slice(0, 10),
          body.receiver_name ?? null,
          body.store ?? purchaseRow.store ?? null,
          body.notes ?? null,
          this.context.userId() ?? 1,
          this.context.organizationId(),
        ],
      );

      for (let index = 0; index < lines.length; index += 1) {
        const entry = lines[index];
        const purchaseLineId = Number(entry.stock_purchase_line_id ?? 0);
        const quantityReceived = Number(entry.quantity_received ?? 0);
        if (!purchaseLineId || quantityReceived <= 0) {
          throw new BadRequestException(`Ligne ${index + 1}: quantite recue invalide`);
        }
        const purchaseLine = linesById.get(purchaseLineId);
        if (!purchaseLine) throw new BadRequestException(`Ligne ${index + 1}: article achat introuvable`);
        const remaining = Number(purchaseLine.quantity) - Number(purchaseLine.received_quantity ?? 0);
        if (quantityReceived > remaining) {
          throw new BadRequestException(`Ligne ${index + 1}: quantite recue superieure au reste a recevoir (${remaining})`);
        }
        await client.query(
          `INSERT INTO stock_purchase_receipt_lines
           (stock_purchase_receipt_id, stock_purchase_line_id, stock_item_id, quantity_received, unit_price, line_total, organization_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            receipt.rows[0].id,
            purchaseLineId,
            purchaseLine.stock_item_id,
            quantityReceived,
            purchaseLine.unit_price,
            quantityReceived * Number(purchaseLine.unit_price ?? 0),
            this.context.organizationId(),
          ],
        );
        await client.query(
          `UPDATE stock_purchase_lines
           SET received_quantity = received_quantity + $3, updated_at = NOW()
           WHERE id = $1 AND stock_purchase_id = $2 AND organization_id = $4`,
          [purchaseLineId, id, quantityReceived, this.context.organizationId()],
        );
        await this.createStockMovementInTransaction(client, {
          stock_item_id: purchaseLine.stock_item_id,
          type: 'IN',
          quantity: quantityReceived,
          movement_date: receipt.rows[0].receipt_date,
          source: 'PURCHASE_RECEIPT',
          reference: receiptNumber,
          notes: body.notes ?? `Reception achat ${purchaseRow.purchase_number}`,
          unit_price: Number(purchaseLine.unit_price ?? 0),
          stock_purchase_id: id,
          stock_purchase_receipt_id: receipt.rows[0].id,
        });
      }

      await this.refreshStockPurchaseStatus(client, id);
      await this.addStockPurchaseTimeline(client, id, 'RECEIPT', 'Reception de marchandises', `Bon ${receiptNumber} enregistre`);
      return this.stockPurchaseDetail(id);
    });
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
    if (lines?.length) {
      return this.db.transaction(async (client) => {
        const movements: Record<string, unknown>[] = [];
        for (const line of lines) {
          movements.push(await this.createStockMovementInTransaction(client, {
            ...line,
            type: 'OUT',
            source: 'MAINTENANCE',
            destination: 'Maintenance',
            maintenance_reference: body.maintenance_reference ?? body.reference ?? null,
            maintenance_request_id: body.maintenance_request_id ?? null,
            notes: line.comment ?? line.notes ?? line.reason ?? body.comment ?? body.notes ?? 'Consommation maintenance',
          }));
        }
        if (body.maintenance_request_id) {
          const totalCost = movements.reduce((sum, movement) => sum + Number((movement as Record<string, unknown>).quantity ?? 0) * Number((movement as Record<string, unknown>).unit_price ?? 0), 0);
          await this.addMaintenanceTimeline(client, Number(body.maintenance_request_id), 'STOCK', 'Consommation de stock', `${movements.length} article(s) consommÃƒÂ©(s) pour ${totalCost.toFixed(2)} USD`);
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

  maintenanceCategories() {
    return this.findAll('maintenance_categories', 'name');
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
          body.title,
          body.description ?? null,
          body.category ?? 'Autre',
          body.priority ?? 'NORMAL',
          body.building_id ?? null,
          body.unit_id ?? null,
          body.lease_id ?? null,
          body.tenant_id ?? null,
          body.reported_by_name ?? null,
          body.reported_at ?? null,
          body.due_date ?? null,
          body.attachment_file_name ?? null,
          body.attachment_file_url ?? null,
          body.internal_notes ?? null,
          this.context.userId() ?? 1,
          this.context.organizationId(),
        ],
      );
      await this.addMaintenanceTimeline(client, rows[0].id, 'REPORT', 'Signalement', body.description ? String(body.description) : 'Signalement crÃƒÂ©ÃƒÂ©');
      return rows[0];
    });
  }

  async updateMaintenanceRequest(id: number, body: Record<string, unknown>) {
    const updated = await this.updateById('maintenance_requests', id, body, [
      'title',
      'description',
      'category',
      'priority',
      'status',
      'building_id',
      'unit_id',
      'lease_id',
      'tenant_id',
      'reported_by_name',
      'due_date',
      'attachment_file_name',
      'attachment_file_url',
      'internal_notes',
    ]);
    await this.db.transaction((client) => this.addMaintenanceTimeline(client, id, 'UPDATE', 'Modification', 'Demande mise ÃƒÂ  jour'));
    return updated;
  }

  async diagnoseMaintenanceRequest(id: number, body: Record<string, unknown>) {
    return this.db.transaction(async (client) => {
      await this.assertMaintenanceStatus(client, id, ['NEW', 'DIAGNOSIS']);
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
          Number(body.estimated_cost ?? 0),
          Number(body.estimated_hours ?? 0),
          body.recommended_technician ?? null,
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
      await this.addMaintenanceTimeline(client, id, 'DIAGNOSIS', 'Diagnostic', body.diagnostic ? String(body.diagnostic) : 'Diagnostic enregistrÃƒÂ©');
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
      const { rows } = await client.query(
        `UPDATE maintenance_requests
         SET status = 'ASSIGNED', assigned_employee_id = $3, external_provider = $4, updated_at = NOW()
         WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL RETURNING *`,
        [id, this.context.organizationId(), body.employee_id ?? null, body.external_provider ?? null],
      );
      const request = requireRow(rows[0], 'Maintenance request');
      await client.query(
        `INSERT INTO maintenance_assignments
         (maintenance_request_id, employee_id, external_provider, assigned_by, notes, planned_date, planned_time, organization_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, body.employee_id ?? null, body.external_provider ?? null, this.context.userId() ?? 1, body.notes ?? null, body.planned_date ?? null, body.planned_time ?? null, this.context.organizationId()],
      );
      await this.createMaintenanceAssignmentCommunications(client, request, body);
      await this.addMaintenanceTimeline(client, id, 'ASSIGNMENT', 'Assignation', body.notes ? String(body.notes) : 'Intervention affectÃƒÂ©e');
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
      const { rows } = await client.query(
        `UPDATE maintenance_requests
         SET status = 'RESOLVED',
             resolved_at = COALESCE($3::TIMESTAMP, NOW()),
             actual_hours = $4,
             resolution_comments = $5,
             updated_at = NOW()
         WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL RETURNING *`,
        [id, this.context.organizationId(), body.resolved_at ?? null, Number(body.actual_hours ?? 0), body.resolution_comments ?? body.comments ?? null],
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
      const lines = Array.isArray(body.lines) ? body.lines as Array<Record<string, unknown>> : [body];
      if (!lines.length) throw new BadRequestException('Aucune ligne de dÃ©pense fournie');
      const created: Record<string, unknown>[] = [];
      for (const line of lines) {
        const amount = Number(line.amount ?? 0);
        if (amount <= 0) throw new BadRequestException('Le montant doit etre superieur a zero');
        let cashMovementId = null;
        const status = String(line.status ?? body.status ?? 'APPROVED');
        if (status !== 'REJECTED') {
          const movement = await this.createCashMovementInTransaction(client, {
            type: 'OUT',
            category: 'MAINTENANCE_EXPENSE',
            amount,
            movement_date: line.expense_date ?? body.expense_date ?? new Date().toISOString().slice(0, 10),
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
            line.expense_date ?? body.expense_date ?? new Date().toISOString().slice(0, 10),
            line.category ?? body.category ?? 'Autre',
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
      await this.addMaintenanceTimeline(client, id, 'EXPENSE', 'DÃ©pense', `${created.length} ligne(s) de coÃ»t enregistrÃ©e(s)`);
      return created.length === 1 ? created[0] : { lines: created, total_amount: created.reduce((sum, row) => sum + Number((row as Record<string, unknown>).amount ?? 0), 0) };
    });
  }

  async createMaintenanceDocument(id: number, body: Record<string, unknown>) {
    const { rows } = await this.db.query(
      `INSERT INTO maintenance_documents (maintenance_request_id, document_type, file_name, file_url, uploaded_by, organization_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [id, body.document_type ?? 'OTHER', body.file_name, body.file_url ?? null, this.context.userId() ?? 1, this.context.organizationId()],
    );
    await this.db.transaction((client) => this.addMaintenanceTimeline(client, id, 'DOCUMENT', 'Document', String(body.file_name ?? 'Document ajoutÃƒÂ©')));
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
      if (inventoryRow.status === 'VALIDATED') throw new BadRequestException('Inventaire dÃƒÂ©jÃƒÂ  validÃƒÂ©');
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

  async leases() {
    const { rows } = await this.db.query(`
      SELECT l.*,
             CASE WHEN t.tenant_type = 'COMPANY' THEN COALESCE(t.company_name, '')
                  ELSE TRIM(CONCAT(COALESCE(t.first_name, ''), ' ', COALESCE(t.last_name, ''), ' ', COALESCE(t.post_name, '')))
             END AS tenant_name,
             u.number AS unit_number, b.name AS building_name,
             latest_contract.id AS latest_contract_id,
             latest_contract.status AS latest_contract_status,
             COALESCE(g.amount, l.rental_guarantee_amount, 0)::FLOAT AS guarantee_amount,
             COALESCE(g.paid_amount, l.rental_guarantee_paid, 0)::FLOAT AS guarantee_paid,
             COALESCE(g.status, l.rental_guarantee_status) AS guarantee_status,
             COALESCE(
               latest_contract.signed_contract_file_name,
               latest_contract.pdf_file_name,
               l.signed_contract_file_name,
               l.generated_contract_file_name,
               l.contract_file_name
             ) AS contract_file_name,
             COALESCE(
               latest_contract.signed_contract_file_url,
               latest_contract.pdf_file_url,
               l.signed_contract_url,
               l.generated_contract_url,
               l.contract_file_url
             ) AS contract_file_url
      FROM leases l
      JOIN tenants t ON t.id = l.tenant_id
      JOIN units u ON u.id = l.unit_id
      JOIN buildings b ON b.id = u.building_id
      LEFT JOIN lease_guarantees g ON g.lease_id = l.id AND g.deleted_at IS NULL
      LEFT JOIN LATERAL (
        SELECT cg.id, cg.status, cg.pdf_file_name, cg.pdf_file_url, cg.signed_contract_file_name, cg.signed_contract_file_url
        FROM lease_contract_generations cg
        WHERE cg.lease_id = l.id
          AND cg.organization_id = l.organization_id
          AND cg.deleted_at IS NULL
        ORDER BY cg.generated_at DESC, cg.id DESC
        LIMIT 1
      ) latest_contract ON TRUE
      WHERE l.organization_id = $1 AND l.deleted_at IS NULL
      ORDER BY l.start_date DESC, l.id DESC
    `, [this.context.organizationId()]);
    return rows;
  }

  async leaseDetail(id: number) {
    const lease = await this.db.query(
      `SELECT l.*,
              CASE WHEN t.tenant_type = 'COMPANY' THEN COALESCE(t.company_name, '')
                   ELSE TRIM(CONCAT(COALESCE(t.first_name, ''), ' ', COALESCE(t.last_name, ''), ' ', COALESCE(t.post_name, '')))
              END AS tenant_name,
              t.tenant_type,
              t.first_name, t.last_name, t.post_name, t.company_name, t.legal_form, t.rccm, t.national_id_number,
              t.tax_number, t.address AS tenant_address, t.commune AS tenant_commune, t.city AS tenant_city, t.country AS tenant_country,
              t.id_document_type, t.id_number, t.legal_representative_name, t.legal_representative_role,
              t.representative_post_name, t.representative_first_name,
              t.phone AS tenant_phone,
              t.email AS tenant_email,
              u.number AS unit_number, u.status AS unit_status, u.type AS unit_type, u.surface_area, u.bedrooms_count,
              u.parking_spaces_count, u.has_parking, u.is_furnished, u.usage_type,
              b.name AS building_name, b.address AS building_address, b.commune AS building_commune,
              b.city AS building_city, b.neighborhood AS building_neighborhood
       FROM leases l
       JOIN tenants t ON t.id = l.tenant_id
       JOIN units u ON u.id = l.unit_id
       JOIN buildings b ON b.id = u.building_id
       WHERE l.id = $1 AND l.organization_id = $2 AND l.deleted_at IS NULL`,
      [id, this.context.organizationId()],
    );
    const row = requireRow(lease.rows[0], 'Lease');
    return {
      ...row,
      guarantee: await this.leaseGuarantee(id),
      documents: await this.leaseDocuments(id),
      history: await this.unitOccupationHistory(lease.rows[0]?.unit_id ?? 0),
      latest_contract: await this.latestLeaseContract(id),
    };
  }

  async createLease(body: Record<string, unknown>) {
    return this.db.transaction(async (client) => {
      const organizationId = this.context.organizationId();
      const normalized = this.normalizeLeasePayload(body);
      if (normalized.status === 'ACTIVE') {
        await this.ensureNoLeaseConflict(client, normalized.unitId, normalized.startDate, normalized.endDate);
      }
      const { rows } = await client.query(
        `INSERT INTO leases
         (tenant_id, unit_id, start_date, end_date, monthly_rent, monthly_syndic_amount, rental_guarantee_amount, rental_guarantee_paid,
          rental_guarantee_payment_date, rental_guarantee_status, contract_file_url, contract_file_name, status,
          maintenance_fee_amount, other_charges_amount, lease_total_amount, guarantee_months, notice_months,
          signature_place, signature_date, lease_usage, contract_template_code, organization_id, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
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
          normalized.contractTemplateCode,
          organizationId,
          normalized.notes,
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
  }

  async updateLease(id: number, body: Record<string, unknown>) {
    const current = await this.leaseDetail(id);
    return this.db.transaction(async (client) => {
      const normalized = this.normalizeLeasePayload({ ...current, ...body });
      if (normalized.status === 'ACTIVE') {
        await this.ensureNoLeaseConflict(client, normalized.unitId, normalized.startDate, normalized.endDate, id);
      }
      await client.query(
        `UPDATE leases
         SET tenant_id = $2,
             unit_id = $3,
             start_date = $4,
             end_date = $5,
             monthly_rent = $6,
             monthly_syndic_amount = $7,
             rental_guarantee_amount = $8,
             rental_guarantee_paid = $9,
             rental_guarantee_payment_date = $10,
             rental_guarantee_status = $11,
             contract_file_url = $12,
             contract_file_name = $13,
             status = $14,
             maintenance_fee_amount = $15,
             other_charges_amount = $16,
             lease_total_amount = $17,
             guarantee_months = $18,
             notice_months = $19,
             signature_place = $20,
             signature_date = $21,
             lease_usage = $22,
             contract_template_code = $23,
             notes = $24,
             updated_at = NOW()
         WHERE id = $1 AND organization_id = $25 AND deleted_at IS NULL`,
        [
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
          normalized.contractTemplateCode,
          normalized.notes,
          this.context.organizationId(),
        ],
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
  }

  async activateLease(id: number) {
    return this.db.transaction((client) => this.activateLeaseInTransaction(client, id));
  }

  async terminateLease(id: number, reason: string) {
    return this.db.transaction(async (client) => {
      const lease = await client.query(
        `SELECT * FROM leases WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
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
           WHERE unit_id = $1 AND organization_id = $2 AND status = 'ACTIVE' AND deleted_at IS NULL AND id <> $3
         )`,
        [row.unit_id, this.context.organizationId(), id],
      );
      return rows[0];
    });
  }

  async leaseGuarantee(id: number) {
    const { rows } = await this.db.query(
      `SELECT * FROM lease_guarantees WHERE lease_id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [id, this.context.organizationId()],
    );
    return rows[0] ?? null;
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

  async generateLeaseContract(id: number) {
    return this.db.transaction(async (client) => {
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
      const template = await this.activeLeaseContractTemplate(client, lease.contract_template_code ?? 'LEASE_RESIDENTIAL');
      const snapshot = this.buildLeaseContractSnapshot(lease, company);
      const renderedContent = renderLeaseContractTemplate(template.content, snapshot);
      const placeholders = unresolvedPlaceholders(renderedContent);
      if (placeholders.length) {
        throw new BadRequestException(`Variables de contrat non resolues: ${placeholders.join(', ')}`);
      }
      const renderedHtml = buildLeaseContractHtml(renderedContent);
      const safeTenant = this.slugify(snapshot.locataire.signature_nom || lease.tenant_name || `locataire-${lease.id}`);
      const generatedDate = new Date().toISOString().slice(0, 10);
      const pdfFileName = `CONTRAT_BAIL_${this.leaseReferenceCode(lease.id)}_${safeTenant}_${generatedDate}.pdf`;
      const pdfFileUrl = `data:application/pdf;base64,${buildLeaseContractPdfBase64(renderedContent, template.name)}`;
      const { rows } = await client.query(
        `INSERT INTO lease_contract_generations
         (organization_id, lease_id, template_id, template_version, generated_content, generated_html, snapshot_json,
          pdf_file_name, pdf_file_url, generated_by, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7::JSONB, $8, $9, $10, 'GENERATED')
         RETURNING *`,
        [
          this.context.organizationId(),
          id,
          template.id,
          template.version,
          renderedContent,
          renderedHtml,
          JSON.stringify(snapshot),
          pdfFileName,
          pdfFileUrl,
          this.context.userId() ?? 1,
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
        [id, pdfFileName, pdfFileUrl, template.code, this.context.organizationId()],
      );
      await client.query(
        `INSERT INTO lease_documents (lease_id, document_type, file_name, file_url, uploaded_by, organization_id)
         VALUES ($1, 'GENERATED_CONTRACT', $2, $3, $4, $5)`,
        [id, pdfFileName, pdfFileUrl, this.context.userId() ?? 1, this.context.organizationId()],
      );
      return rows[0];
    });
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
    if (!body.recipient) throw new BadRequestException('Destinataire requis');
    if (!message.trim()) throw new BadRequestException('Message requis');
    const columns =
      target === 'email_logs'
        ? ['recipient', 'subject', 'message', 'status', 'provider_response', 'related_entity_type', 'related_entity_id', 'sent_at', 'created_by', 'organization_id']
        : ['recipient', 'message', 'status', 'provider_response', 'related_entity_type', 'related_entity_id', 'sent_at', 'created_by', 'organization_id'];
    const commonValues = [
      body.recipient,
      message,
      'SIMULATED',
      JSON.stringify({ provider: 'LOCAL_SIMULATOR', channel: channel.toUpperCase(), template_code: body.template_code ?? null }),
      body.related_entity_type ?? null,
      body.related_entity_id ?? null,
      new Date(),
      this.context.userId() ?? body.created_by ?? 1,
      this.context.organizationId(),
    ];
    const values = target === 'email_logs' ? [body.recipient, subject, ...commonValues.slice(1)] : commonValues;
    const placeholders = columns.map((_, index) => `$${index + 1}`);
    const { rows } = await this.db.query(`INSERT INTO ${target} (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`, values);
    return { success: true, simulated: true, log: rows[0] };
  }

  async remindInvoice(id: number, body: Record<string, unknown>) {
    const organizationId = this.context.organizationId();
    const channel = String(body.channel ?? '').toUpperCase();
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
    if (!recipient) throw new BadRequestException(channel === 'EMAIL' ? 'Adresse email locataire absente' : 'TÃƒÂ©lÃƒÂ©phone locataire absent');

    const message = body.message
      ? String(body.message)
      : this.defaultReminderMessage(channel, {
          tenant_name: invoice.tenant_name,
          invoice_number: invoice.invoice_number,
          amount: Number(invoice.total).toLocaleString('fr-FR', { maximumFractionDigits: 2 }),
          currency: 'USD',
        });

    const communication = await this.sendCommunication(channel, {
      recipient,
      subject: channel === 'EMAIL' ? `Relance facture ${invoice.invoice_number}` : undefined,
      message,
      related_entity_type: 'invoice',
      related_entity_id: id,
    });
    const status = communication?.log?.status === 'FAILED' ? 'FAILED' : communication?.log?.status === 'SENT' ? 'SENT' : 'SIMULATED';
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
      return `Bonjour ${variables.tenant_name},\nSauf erreur de notre part, votre facture ${variables.invoice_number} d'un montant de ${variables.amount} ${variables.currency} reste impayÃƒÂ©e.\nMerci de rÃƒÂ©gulariser votre situation.`;
    }
    return `Bonjour ${variables.tenant_name}, votre facture ${variables.invoice_number} de ${variables.amount} ${variables.currency} reste impayÃƒÂ©e. Merci de rÃƒÂ©gulariser.`;
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

  async payLeaseGuarantee(id: number, amount: number, reference?: string) {
    return this.db.transaction(async (client) => {
      const lease = await client.query(
        `SELECT * FROM leases WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
        [id, this.context.organizationId()],
      );
      const row = requireRow(lease.rows[0], 'Lease');
      const guarantee = await this.leaseGuarantee(id);
      const guaranteeAmount = Number(guarantee?.amount ?? row.rental_guarantee_amount ?? 0);
      const paidAmount = Number(guarantee?.paid_amount ?? row.rental_guarantee_paid ?? 0) + amount;
      const status = paidAmount >= guaranteeAmount ? 'PAID' : paidAmount > 0 ? 'PARTIAL' : 'NOT_PAID';
      await this.upsertLeaseGuarantee(client, id, {
        amount: guaranteeAmount,
        paid_amount: paidAmount,
        payment_date: new Date().toISOString().slice(0, 10),
        status,
      });
      const movement = await this.createCashMovementInTransaction(client, {
        type: 'IN',
        category: 'LEASE_GUARANTEE',
        amount,
        movement_date: new Date().toISOString().slice(0, 10),
        tenant_id: row.tenant_id,
        description: 'Paiement garantie locative',
        reference: reference ?? `GAR-${id}`,
      });
      return { guarantee: await this.leaseGuaranteeInTransaction(client, id), movement };
    });
  }

  async refundLeaseGuarantee(id: number, amount: number, reference?: string) {
    return this.db.transaction(async (client) => {
      const lease = await client.query(
        `SELECT * FROM leases WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
        [id, this.context.organizationId()],
      );
      const row = requireRow(lease.rows[0], 'Lease');
      const guarantee = await this.leaseGuarantee(id);
      const guaranteeAmount = Number(guarantee?.amount ?? row.rental_guarantee_amount ?? 0);
      const paidAmount = Math.max(Number(guarantee?.paid_amount ?? row.rental_guarantee_paid ?? 0) - amount, 0);
      const status = paidAmount >= guaranteeAmount ? 'PAID' : paidAmount > 0 ? 'PARTIAL' : 'REFUNDED';
      await this.upsertLeaseGuarantee(client, id, {
        amount: guaranteeAmount,
        paid_amount: paidAmount,
        payment_date: guarantee?.payment_date ?? null,
        status,
      });
      const movement = await this.createCashMovementInTransaction(client, {
        type: 'OUT',
        category: 'LEASE_GUARANTEE_REFUND',
        amount,
        movement_date: new Date().toISOString().slice(0, 10),
        tenant_id: row.tenant_id,
        description: 'Remboursement garantie locative',
        reference: reference ?? `GAR-REF-${id}`,
      });
      return { guarantee: await this.leaseGuaranteeInTransaction(client, id), movement };
    });
  }

  async unitOccupationHistory(unitId: number) {
    const { rows } = await this.db.query(
      `SELECT l.*, CONCAT(t.first_name, ' ', t.last_name) AS tenant_name, g.amount AS guarantee_amount, g.status AS guarantee_status
       FROM leases l
       JOIN tenants t ON t.id = l.tenant_id
       LEFT JOIN lease_guarantees g ON g.lease_id = l.id AND g.deleted_at IS NULL
       WHERE l.unit_id = $1 AND l.organization_id = $2 AND l.deleted_at IS NULL
       ORDER BY l.start_date DESC, l.id DESC`,
      [unitId, this.context.organizationId()],
    );
    return rows;
  }

  async tenantLeases(tenantId: number) {
    const { rows } = await this.db.query(
      `SELECT l.*, u.number AS unit_number, b.name AS building_name, g.amount AS guarantee_amount, g.status AS guarantee_status
       FROM leases l
       JOIN units u ON u.id = l.unit_id
       JOIN buildings b ON b.id = u.building_id
       LEFT JOIN lease_guarantees g ON g.lease_id = l.id AND g.deleted_at IS NULL
       WHERE l.tenant_id = $1 AND l.organization_id = $2 AND l.deleted_at IS NULL
       ORDER BY l.start_date DESC, l.id DESC`,
      [tenantId, this.context.organizationId()],
    );
    return rows;
  }

  async activeLeasesByBuilding(buildingId?: number) {
    const { rows } = await this.db.query(
      `SELECT l.*, CONCAT(t.first_name, ' ', t.last_name) AS tenant_name, u.number AS unit_number, b.name AS building_name
       FROM leases l
       JOIN tenants t ON t.id = l.tenant_id
       JOIN units u ON u.id = l.unit_id
       JOIN buildings b ON b.id = u.building_id
       WHERE l.organization_id = $1 AND l.deleted_at IS NULL AND l.status = 'ACTIVE'
         AND ($2::INT IS NULL OR b.id = $2)
       ORDER BY b.name, u.number`,
      [this.context.organizationId(), buildingId ?? null],
    );
    return rows;
  }

  async rentalUnitsAvailability() {
    const { rows } = await this.db.query(
      `SELECT b.name AS building_name, u.id AS unit_id, u.number, u.status,
              CASE WHEN l.id IS NULL THEN 'Libre' ELSE 'OccupÃƒÂ©e' END AS occupancy
       FROM units u
       JOIN buildings b ON b.id = u.building_id
       LEFT JOIN leases l ON l.unit_id = u.id AND l.status = 'ACTIVE' AND l.deleted_at IS NULL
       WHERE u.organization_id = $1 AND u.deleted_at IS NULL
       ORDER BY b.name, u.number`,
      [this.context.organizationId()],
    );
    return rows;
  }

  async createLeaseInvoice(id: number) {
    return this.db.transaction(async (client) => {
      const lease = await client.query(
        `SELECT l.*, u.building_id FROM leases l JOIN units u ON u.id = l.unit_id WHERE l.id = $1 AND l.organization_id = $2 AND l.deleted_at IS NULL`,
        [id, this.context.organizationId()],
      );
      const row = requireRow(lease.rows[0], 'Lease');
      const sequence = await client.query(`SELECT COALESCE(MAX((SUBSTRING(invoice_number FROM $1))::INT), 0) + 1 AS value FROM invoices WHERE invoice_number LIKE $2`, [
        `INV-${new Date().getFullYear()}-([0-9]+)`,
        `INV-${new Date().getFullYear()}-%`,
      ]);
      const nextId = await client.query(`SELECT nextval('invoices_id_seq')::INT AS value`);
      const number = `INV-${new Date().getFullYear()}-${String(sequence.rows[0].value).padStart(4, '0')}`;
      const today = new Date();
      const due = new Date(today.getFullYear(), today.getMonth(), 10);
      const rentAmount = Number(row.monthly_rent ?? 0);
      const syndicAmount = Number(row.monthly_syndic_amount ?? 0);
      const totalAmount = rentAmount + syndicAmount;
      const invoice = await client.query(
        `INSERT INTO invoices (id, tenant_id, lease_id, unit_id, building_id, invoice_number, month, year, issue_date, due_date, status, total, organization_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_DATE, $9, 'UNPAID', $10, $11) RETURNING *`,
        [nextId.rows[0].value, row.tenant_id, row.id, row.unit_id, row.building_id, number, today.getMonth() + 1, today.getFullYear(), due.toISOString().slice(0, 10), totalAmount, this.context.organizationId()],
      );
      if (rentAmount > 0) {
        await client.query(
          'INSERT INTO invoice_items (invoice_id, item_type, description, amount, organization_id) VALUES ($1, $2, $3, $4, $5)',
          [invoice.rows[0].id, 'Monthly rent', this.invoicePeriodDescription('Loyer', today.getMonth() + 1, today.getFullYear()), rentAmount, this.context.organizationId()],
        );
      }
      if (syndicAmount > 0) {
        await client.query(
          'INSERT INTO invoice_items (invoice_id, item_type, description, amount, organization_id) VALUES ($1, $2, $3, $4, $5)',
          [invoice.rows[0].id, 'Syndic', this.invoicePeriodDescription('Syndic', today.getMonth() + 1, today.getFullYear()), syndicAmount, this.context.organizationId()],
        );
      }
      return invoice.rows[0];
    });
  }

  private async appendInvoiceItemSummaries(rows: Record<string, any>[]): Promise<Record<string, any>[]> {
    const invoiceIds = rows.map((row) => Number(row.id)).filter(Number.isFinite);
    if (!invoiceIds.length) return rows;
    const summaries = await this.db.query(
      `SELECT invoice_id,
              COALESCE(SUM(CASE WHEN item_type = 'Monthly rent' OR description = 'Monthly rent' OR description ILIKE 'Loyer %' THEN amount ELSE 0 END), 0)::FLOAT AS rent_amount,
              COALESCE(SUM(CASE WHEN item_type = 'Syndic' OR description = 'Syndic' OR description ILIKE 'Syndic %' THEN amount ELSE 0 END), 0)::FLOAT AS syndic_amount
       FROM invoice_items
       WHERE organization_id = $1
         AND deleted_at IS NULL
         AND invoice_id = ANY($2::INT[])
       GROUP BY invoice_id`,
      [this.context.organizationId(), invoiceIds],
    );
    const summaryMap = new Map<number, Record<string, any>>(summaries.rows.map((row) => [Number(row.invoice_id), row as Record<string, any>]));
    return rows.map((row) => {
      const summary = summaryMap.get(Number(row.id));
      return {
        ...row,
        rent_amount: Number(summary?.rent_amount ?? 0),
        syndic_amount: Number(summary?.syndic_amount ?? 0),
      };
    });
  }

  private invoicePeriodDescription(prefix: string, month: number, year: number) {
    const monthLabel = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'][month - 1] ?? String(month);
    return `${prefix} ${monthLabel} ${year}`;
  }

  async reportsDashboard() {
    const organizationId = this.context.organizationId();
    const [occupation, revenue, payments, overdue, guarantees, cash] = await Promise.all([
      this.db.query(
        `SELECT status AS name, COUNT(*)::INT AS value
         FROM units
         WHERE organization_id = $1 AND deleted_at IS NULL
         GROUP BY status
         ORDER BY status`,
        [organizationId],
      ),
      this.db.query(
        `SELECT b.name, COALESCE(SUM(i.total), 0)::FLOAT AS value
         FROM buildings b
         LEFT JOIN invoices i ON i.building_id = b.id AND i.deleted_at IS NULL
         WHERE b.organization_id = $1 AND b.deleted_at IS NULL
         GROUP BY b.id, b.name
         ORDER BY b.name`,
        [organizationId],
      ),
      this.db.query(
        `SELECT TO_CHAR(payment_date, 'YYYY-MM') AS name, COALESCE(SUM(amount), 0)::FLOAT AS value
         FROM payments
         WHERE organization_id = $1 AND deleted_at IS NULL
         GROUP BY TO_CHAR(payment_date, 'YYYY-MM')
         ORDER BY name`,
        [organizationId],
      ),
      this.db.query(
        `SELECT COUNT(*)::INT AS count, COALESCE(SUM(COALESCE(s.remaining_amount, i.total)), 0)::FLOAT AS amount
         FROM invoices i
         LEFT JOIN invoice_payment_summary s ON s.invoice_id = i.id
         WHERE i.organization_id = $1 AND i.deleted_at IS NULL AND i.status <> 'PAID' AND i.due_date < CURRENT_DATE`,
        [organizationId],
      ),
      this.db.query(
        `SELECT status AS name, COUNT(*)::INT AS value, COALESCE(SUM(amount), 0)::FLOAT AS amount
         FROM lease_guarantees
         WHERE organization_id = $1 AND deleted_at IS NULL
         GROUP BY status
         ORDER BY status`,
        [organizationId],
      ),
      this.db.query(
        `SELECT
           COALESCE(SUM(CASE WHEN type = 'IN' THEN amount ELSE 0 END), 0)::FLOAT AS total_in,
           COALESCE(SUM(CASE WHEN type = 'OUT' THEN amount ELSE 0 END), 0)::FLOAT AS total_out
         FROM cash_movements
         WHERE organization_id = $1 AND deleted_at IS NULL`,
        [organizationId],
      ),
    ]);
    return {
      occupation: occupation.rows,
      revenue_by_building: revenue.rows,
      monthly_payments: payments.rows,
      overdue: overdue.rows[0],
      guarantees: guarantees.rows,
      cash_summary: {
        ...cash.rows[0],
        balance: Number(cash.rows[0]?.total_in ?? 0) - Number(cash.rows[0]?.total_out ?? 0),
      },
    };
  }

  private reportPeriod(filters: { month?: string; year?: string; start?: string; end?: string }) {
    if (filters.month && filters.year) {
      const month = Number(filters.month);
      const year = Number(filters.year);
      if (month >= 1 && month <= 12 && year > 1900) {
        const paddedMonth = String(month).padStart(2, '0');
        const lastDay = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
        return { start: `${year}-${paddedMonth}-01`, end: lastDay };
      }
    }
    return { start: filters.start ?? '2000-01-01', end: filters.end ?? '2999-12-31' };
  }

  private invoiceStatusClause(alias: string, parameterIndex: number) {
    return `($${parameterIndex}::TEXT IS NULL
      OR ($${parameterIndex} = 'OVERDUE' AND ${alias}.status <> 'PAID' AND ${alias}.due_date < CURRENT_DATE)
      OR ($${parameterIndex} <> 'OVERDUE' AND ${alias}.status = $${parameterIndex}))`;
  }

  async buildingReport(
    id: number,
    filters: { month?: string; year?: string; start?: string; end?: string; paymentStatus?: string; tenantId?: number; unitId?: number } = {},
  ) {
    const organizationId = this.context.organizationId();
    const period = this.reportPeriod(filters);
    const params: unknown[] = [
      id,
      period.start,
      period.end,
      organizationId,
      filters.tenantId ?? null,
      filters.unitId ?? null,
      filters.paymentStatus || null,
    ];
    const building = await this.db.query('SELECT * FROM buildings WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL', [id, organizationId]);
    const units = await this.db.query(
      `SELECT * FROM units
       WHERE building_id = $1 AND organization_id = $2 AND deleted_at IS NULL
         AND ($3::INT IS NULL OR id = $3)
       ORDER BY number`,
      [id, organizationId, filters.unitId ?? null],
    );
    const tenants = await this.db.query(
      `SELECT DISTINCT ON (t.id)
              t.id, CONCAT(t.first_name, ' ', t.last_name) AS tenant_name, t.phone, t.email,
              u.number AS unit_number, l.id AS lease_id, l.status AS lease_status, l.monthly_rent, l.monthly_syndic_amount
       FROM tenants t
       JOIN leases l ON l.tenant_id = t.id AND l.deleted_at IS NULL
       JOIN units u ON u.id = l.unit_id
       WHERE u.building_id = $1 AND t.organization_id = $2 AND t.deleted_at IS NULL
         AND ($3::INT IS NULL OR t.id = $3)
         AND ($4::INT IS NULL OR u.id = $4)
       ORDER BY t.id, l.status = 'ACTIVE' DESC, l.start_date DESC`,
      [id, organizationId, filters.tenantId ?? null, filters.unitId ?? null],
    );
    const invoices = await this.db.query(
      `SELECT i.id, i.tenant_id, i.invoice_number, i.month, i.year, i.issue_date, i.due_date, i.status, i.total,
              i.last_reminder_at, COALESCE(i.reminder_count, 0)::INT AS reminder_count,
              CONCAT(t.first_name, ' ', t.last_name) AS tenant_name, t.phone, t.email,
              u.number AS unit_number,
              COALESCE(s.paid_amount, 0)::FLOAT AS paid_amount,
              COALESCE(s.remaining_amount, i.total)::FLOAT AS remaining_amount
       FROM invoices i
       JOIN tenants t ON t.id = i.tenant_id
       LEFT JOIN leases l ON l.id = i.lease_id
       LEFT JOIN units u ON u.id = COALESCE(i.unit_id, l.unit_id, t.unit_id)
       LEFT JOIN invoice_payment_summary s ON s.invoice_id = i.id
       WHERE COALESCE(i.building_id, u.building_id) = $1
         AND i.issue_date BETWEEN $2 AND $3
         AND i.organization_id = $4
         AND i.deleted_at IS NULL
         AND ($5::INT IS NULL OR i.tenant_id = $5)
         AND ($6::INT IS NULL OR COALESCE(i.unit_id, l.unit_id, t.unit_id) = $6)
         AND ${this.invoiceStatusClause('i', 7)}
       ORDER BY i.issue_date DESC, i.invoice_number`,
      params,
    );
    const invoiceRows = await this.appendInvoiceItemSummaries(invoices.rows);
    const payments = await this.db.query(
      `SELECT p.id, p.payment_date, p.amount, p.payment_method, p.reference,
              i.invoice_number, i.tenant_id,
              CONCAT(t.first_name, ' ', t.last_name) AS tenant_name,
              u.number AS unit_number
       FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
       JOIN tenants t ON t.id = i.tenant_id
       LEFT JOIN leases l ON l.id = i.lease_id
       LEFT JOIN units u ON u.id = COALESCE(i.unit_id, l.unit_id, t.unit_id)
       WHERE COALESCE(i.building_id, u.building_id) = $1
         AND p.payment_date BETWEEN $2 AND $3
         AND p.organization_id = $4
         AND p.deleted_at IS NULL
         AND ($5::INT IS NULL OR i.tenant_id = $5)
         AND ($6::INT IS NULL OR COALESCE(i.unit_id, l.unit_id, t.unit_id) = $6)
         AND ${this.invoiceStatusClause('i', 7)}
       ORDER BY p.payment_date DESC, p.id DESC`,
      params,
    );
    const paidTenantIds = new Set(payments.rows.map((row) => row.tenant_id).filter(Boolean));
    const tenantsPaid = Array.from(
      new Map(
        payments.rows
          .filter((row) => row.tenant_id)
          .map((row) => {
            const tenant = tenants.rows.find((item) => Number(item.id) === Number(row.tenant_id));
            return [row.tenant_id, { tenant_id: row.tenant_id, tenant_name: row.tenant_name, unit_number: row.unit_number, phone: tenant?.phone, email: tenant?.email }];
          }),
      ).values(),
    );
    const tenantsUnpaid = Array.from(
      new Map(
        invoiceRows
          .filter((row) => row.tenant_id && !paidTenantIds.has(row.tenant_id) && row.status !== 'PAID')
          .map((row) => [
            row.tenant_id,
            {
              tenant_id: row.tenant_id,
              tenant_name: row.tenant_name,
              phone: row.phone,
              email: row.email,
              unit_number: row.unit_number,
              invoice_id: row.id,
              invoice_number: row.invoice_number,
              remaining_amount: row.remaining_amount,
              last_reminder_at: row.last_reminder_at,
              reminder_count: row.reminder_count,
            },
          ]),
      ).values(),
    );
    const tenantSituations = tenants.rows.map((tenant) => {
      const tenantInvoices = invoiceRows.filter((invoice) => Number(invoice.tenant_id) === Number(tenant.id));
      const totalInvoiced = tenantInvoices.reduce((sum, invoice) => sum + Number(invoice.total), 0);
      const totalPaid = tenantInvoices.reduce((sum, invoice) => sum + Number(invoice.paid_amount), 0);
      const remaining = tenantInvoices.reduce((sum, invoice) => sum + Number(invoice.remaining_amount), 0);
      const totalRentInvoiced = tenantInvoices.reduce((sum, invoice) => sum + Number(invoice.rent_amount ?? 0), 0);
      const totalSyndicInvoiced = tenantInvoices.reduce((sum, invoice) => sum + Number(invoice.syndic_amount ?? 0), 0);
      const paidCount = tenantInvoices.filter((invoice) => invoice.status === 'PAID').length;
      const partialCount = tenantInvoices.filter((invoice) => invoice.status === 'PARTIAL').length;
      const unpaidCount = tenantInvoices.filter((invoice) => invoice.status === 'UNPAID').length;
      const overdueCount = tenantInvoices.filter((invoice) => invoice.status !== 'PAID' && new Date(invoice.due_date) < new Date()).length;
      return {
        ...tenant,
        payment_status: tenantInvoices.length === 0 ? 'NOT_INVOICED' : overdueCount > 0 && remaining > 0 ? 'OVERDUE' : remaining <= 0 ? 'PAID' : totalPaid > 0 ? 'PARTIAL' : 'UNPAID',
        total_invoiced: totalInvoiced,
        total_rent_invoiced: totalRentInvoiced,
        total_syndic_invoiced: totalSyndicInvoiced,
        total_paid: totalPaid,
        remaining_amount: remaining,
        paid_invoices: paidCount,
        partial_invoices: partialCount,
        unpaid_invoices: unpaidCount,
        overdue_invoices: overdueCount,
      };
    });
    const buildingRow = requireRow(building.rows[0], 'Building');
    const realUnitsTotal = units.rows.length;
    const fallbackUnitsTotal = Number(buildingRow.total_units ?? 0);
    const displayUnitsTotal = realUnitsTotal > 0 ? realUnitsTotal : fallbackUnitsTotal;
    const occupied = units.rows.filter((unit) => unit.status === 'OCCUPIED').length;
    const vacant = realUnitsTotal > 0 ? realUnitsTotal - occupied : fallbackUnitsTotal;
    const financeSummary = {
      invoices: invoiceRows.length,
      paid_invoices: invoiceRows.filter((row) => row.status === 'PAID').length,
      partial_invoices: invoiceRows.filter((row) => row.status === 'PARTIAL').length,
      unpaid_invoices: invoiceRows.filter((row) => row.status !== 'PAID' && row.status !== 'CANCELLED').length,
      overdue_invoices: invoiceRows.filter((row) => row.status !== 'PAID' && new Date(row.due_date) < new Date()).length,
      total_invoiced: invoiceRows.reduce((sum, row) => sum + Number(row.total ?? 0), 0),
      total_rent_invoiced: invoiceRows.reduce((sum, row) => sum + Number(row.rent_amount ?? 0), 0),
      total_syndic_invoiced: invoiceRows.reduce((sum, row) => sum + Number(row.syndic_amount ?? 0), 0),
      total_paid: invoiceRows.reduce((sum, row) => sum + Number(row.paid_amount ?? 0), 0),
      remaining: invoiceRows.reduce((sum, row) => sum + Number(row.remaining_amount ?? 0), 0),
    };
    return {
      building: buildingRow,
      period,
      filters,
      units_total: displayUnitsTotal,
      occupied_units: occupied,
      vacant_units: vacant,
      occupancy_rate: displayUnitsTotal ? Math.round((occupied / displayUnitsTotal) * 100) : 0,
      tenants: tenants.rows,
      tenant_situations: tenantSituations,
      finances: financeSummary,
      units: units.rows,
      payments: payments.rows,
      tenants_paid: tenantsPaid,
      tenants_unpaid: tenantsUnpaid,
      paid_invoices: invoiceRows.filter((row) => row.status === 'PAID'),
      partial_invoices: invoiceRows.filter((row) => row.status === 'PARTIAL'),
      unpaid_invoices: invoiceRows.filter((row) => row.status === 'UNPAID'),
      overdue_invoices: invoiceRows.filter((row) => row.status !== 'PAID' && new Date(row.due_date) < new Date()),
    };
  }

  async paymentsReport(filters: { start?: string; end?: string; buildingId?: number; tenantId?: number; status?: string; paymentMethod?: string } = {}) {
    const start = filters.start ?? '2000-01-01';
    const end = filters.end ?? '2999-12-31';
    const organizationId = this.context.organizationId();
    const invoices = await this.db.query(
      `SELECT i.*, CONCAT(t.first_name, ' ', t.last_name) AS tenant_name, b.name AS building_name, u.number AS unit_number,
              COALESCE(s.paid_amount, 0)::FLOAT AS paid_amount,
              COALESCE(s.remaining_amount, i.total)::FLOAT AS remaining_amount
       FROM invoices i
       JOIN tenants t ON t.id = i.tenant_id
       LEFT JOIN units u ON u.id = i.unit_id
       LEFT JOIN buildings b ON b.id = i.building_id
       LEFT JOIN invoice_payment_summary s ON s.invoice_id = i.id
       WHERE i.issue_date BETWEEN $1 AND $2
         AND i.organization_id = $6
         AND i.deleted_at IS NULL
         AND ($3::INT IS NULL OR b.id = $3)
         AND ($4::INT IS NULL OR t.id = $4)
         AND ($5::TEXT IS NULL OR i.status = $5)
       ORDER BY i.issue_date DESC`,
      [start, end, filters.buildingId ?? null, filters.tenantId ?? null, filters.status || null, organizationId],
    );
    const payments = await this.db.query(
      `SELECT p.*, i.tenant_id, CONCAT(t.first_name, ' ', t.last_name) AS tenant_name, i.invoice_number, i.status AS invoice_status, b.name AS building_name
       FROM payments p
       LEFT JOIN invoices i ON i.id = p.invoice_id
       LEFT JOIN tenants t ON t.id = i.tenant_id
       LEFT JOIN buildings b ON b.id = i.building_id
       WHERE p.payment_date BETWEEN $1 AND $2
         AND p.organization_id = $6
         AND p.deleted_at IS NULL
         AND ($3::INT IS NULL OR b.id = $3)
         AND ($4::INT IS NULL OR t.id = $4)
         AND ($5::TEXT IS NULL OR p.payment_method = $5)
       ORDER BY p.payment_date DESC, p.id DESC`,
      [start, end, filters.buildingId ?? null, filters.tenantId ?? null, filters.paymentMethod || null, organizationId],
    );
    const rows = invoices.rows;
    const paidTenantIds = new Set(payments.rows.map((row) => row.tenant_id).filter(Boolean));
    return {
      payments_received: payments.rows,
      invoices: rows,
      total_invoiced: rows.reduce((sum, row) => sum + Number(row.total), 0),
      total_paid: payments.rows.reduce((sum, row) => sum + Number(row.amount), 0),
      remaining: rows.reduce((sum, row) => sum + Number(row.remaining_amount), 0),
      tenants_paid: Array.from(new Map(payments.rows.filter((row) => row.tenant_id).map((row) => [row.tenant_id, { tenant_id: row.tenant_id, tenant_name: row.tenant_name }])).values()),
      tenants_unpaid: rows
        .filter((row) => row.tenant_id && !paidTenantIds.has(row.tenant_id) && row.status !== 'PAID')
        .map((row) => ({ tenant_id: row.tenant_id, tenant_name: row.tenant_name, invoice_number: row.invoice_number, remaining_amount: row.remaining_amount })),
      paid: rows.filter((row) => row.status === 'PAID'),
      partial: rows.filter((row) => row.status === 'PARTIAL'),
      unpaid: rows.filter((row) => row.status === 'UNPAID'),
      overdue: rows.filter((row) => row.status !== 'PAID' && new Date(row.due_date) < new Date()),
    };
  }

  async tenantReport(
    id: number,
    filters: { month?: string; year?: string; start?: string; end?: string; invoiceStatus?: string; buildingId?: number; unitId?: number; leaseId?: number } = {},
  ) {
    const organizationId = this.context.organizationId();
    const period = this.reportPeriod(filters);
    const tenant = await this.db.query('SELECT * FROM tenants WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL', [id, organizationId]);
    const leases = await this.db.query(
      `SELECT l.*, u.number AS unit_number, b.id AS building_id, b.name AS building_name, g.amount AS guarantee_amount, g.paid_amount AS guarantee_paid, g.status AS guarantee_status
       FROM leases l
       JOIN units u ON u.id = l.unit_id
       JOIN buildings b ON b.id = u.building_id
       LEFT JOIN lease_guarantees g ON g.lease_id = l.id AND g.deleted_at IS NULL
       WHERE l.tenant_id = $1 AND l.organization_id = $2 AND l.deleted_at IS NULL
         AND ($3::INT IS NULL OR b.id = $3)
         AND ($4::INT IS NULL OR u.id = $4)
         AND ($5::INT IS NULL OR l.id = $5)
       ORDER BY l.start_date DESC`,
      [id, organizationId, filters.buildingId ?? null, filters.unitId ?? null, filters.leaseId ?? null],
    );
    const invoices = await this.db.query(
      `SELECT i.*, b.name AS building_name, u.number AS unit_number,
              COALESCE(s.paid_amount, 0)::FLOAT AS paid_amount,
              COALESCE(s.remaining_amount, i.total)::FLOAT AS remaining_amount
       FROM invoices i
       LEFT JOIN units u ON u.id = i.unit_id
       LEFT JOIN buildings b ON b.id = i.building_id
       LEFT JOIN invoice_payment_summary s ON s.invoice_id = i.id
       WHERE i.tenant_id = $1
         AND i.organization_id = $2
         AND i.issue_date BETWEEN $3 AND $4
         AND i.deleted_at IS NULL
         AND ($5::INT IS NULL OR i.building_id = $5)
         AND ($6::INT IS NULL OR i.unit_id = $6)
         AND ($7::INT IS NULL OR i.lease_id = $7)
         AND ${this.invoiceStatusClause('i', 8)}
       ORDER BY i.issue_date DESC, i.invoice_number`,
      [id, organizationId, period.start, period.end, filters.buildingId ?? null, filters.unitId ?? null, filters.leaseId ?? null, filters.invoiceStatus || null],
    );
    const invoiceRows = await this.appendInvoiceItemSummaries(invoices.rows);
    const payments = await this.db.query(
      `SELECT p.*, i.tenant_id, i.invoice_number, i.status AS invoice_status, b.name AS building_name, u.number AS unit_number
       FROM payments p
       LEFT JOIN invoices i ON i.id = p.invoice_id
       LEFT JOIN buildings b ON b.id = i.building_id
       LEFT JOIN units u ON u.id = i.unit_id
       WHERE i.tenant_id = $1
         AND p.organization_id = $2
         AND p.payment_date BETWEEN $3 AND $4
         AND p.deleted_at IS NULL
         AND ($5::INT IS NULL OR i.building_id = $5)
         AND ($6::INT IS NULL OR i.unit_id = $6)
         AND ($7::INT IS NULL OR i.lease_id = $7)
         AND ${this.invoiceStatusClause('i', 8)}
       ORDER BY p.payment_date DESC`,
      [id, organizationId, period.start, period.end, filters.buildingId ?? null, filters.unitId ?? null, filters.leaseId ?? null, filters.invoiceStatus || null],
    );
    const documents = await this.db.query(
      `SELECT ld.*, l.status AS lease_status, u.number AS unit_number, b.name AS building_name
       FROM lease_documents ld
       JOIN leases l ON l.id = ld.lease_id
       JOIN units u ON u.id = l.unit_id
       JOIN buildings b ON b.id = u.building_id
       WHERE l.tenant_id = $1 AND ld.organization_id = $2 AND ld.deleted_at IS NULL
         AND ($3::INT IS NULL OR b.id = $3)
         AND ($4::INT IS NULL OR u.id = $4)
         AND ($5::INT IS NULL OR l.id = $5)
       ORDER BY ld.uploaded_at DESC, ld.id DESC`,
      [id, organizationId, filters.buildingId ?? null, filters.unitId ?? null, filters.leaseId ?? null],
    );
    const rows = invoiceRows;
    const totalInvoiced = rows.reduce((sum, row) => sum + Number(row.total), 0);
    const totalRentInvoiced = rows.reduce((sum, row) => sum + Number(row.rent_amount ?? 0), 0);
    const totalSyndicInvoiced = rows.reduce((sum, row) => sum + Number(row.syndic_amount ?? 0), 0);
    const totalPaid = rows.reduce((sum, row) => sum + Number(row.paid_amount), 0);
    const remaining = rows.reduce((sum, row) => sum + Number(row.remaining_amount), 0);
    return {
      tenant: requireRow(tenant.rows[0], 'Tenant'),
      period,
      filters,
      leases: leases.rows,
      active_leases: leases.rows.filter((lease) => lease.status === 'ACTIVE'),
      old_leases: leases.rows.filter((lease) => lease.status !== 'ACTIVE'),
      guarantees: leases.rows.map((lease) => ({
        lease_id: lease.id,
        building_name: lease.building_name,
        unit_number: lease.unit_number,
        amount: lease.guarantee_amount,
        paid_amount: lease.guarantee_paid,
        status: lease.guarantee_status,
      })),
      payments: payments.rows,
      documents: documents.rows,
      payments_received: payments.rows,
      invoices: rows,
      total_invoiced: totalInvoiced,
      total_rent_invoiced: totalRentInvoiced,
      total_syndic_invoiced: totalSyndicInvoiced,
      total_paid: totalPaid,
      remaining,
      tenants_paid: totalPaid > 0 ? [{ tenant_id: id, tenant_name: `${tenant.rows[0]?.first_name ?? ''} ${tenant.rows[0]?.last_name ?? ''}`.trim() }] : [],
      tenants_unpaid: remaining > 0 ? [{ tenant_id: id, tenant_name: `${tenant.rows[0]?.first_name ?? ''} ${tenant.rows[0]?.last_name ?? ''}`.trim(), remaining_amount: remaining }] : [],
      paid: rows.filter((row) => row.status === 'PAID'),
      partial: rows.filter((row) => row.status === 'PARTIAL'),
      unpaid: rows.filter((row) => row.status === 'UNPAID'),
      overdue: rows.filter((row) => row.status !== 'PAID' && new Date(row.due_date) < new Date()),
    };
  }

  async tenantStatement(id: number, filters: { month?: string; year?: string; start?: string; end?: string } = {}) {
    return this.accountStatement('tenant', id, filters);
  }

  async unitStatement(id: number, filters: { month?: string; year?: string; start?: string; end?: string } = {}) {
    return this.accountStatement('unit', id, filters);
  }

  async buildingStatement(id: number, filters: { month?: string; year?: string; start?: string; end?: string } = {}) {
    return this.accountStatement('building', id, filters);
  }

  private statementPeriod(filters: { month?: string; year?: string; start?: string; end?: string }) {
    return this.reportPeriod(filters);
  }

  private statementMovementOrder(type: string) {
    return type === 'INVOICE' ? 1 : type === 'PAYMENT' ? 2 : 0;
  }

  private statementEntityLabel(scope: 'tenant' | 'unit' | 'building', row: Record<string, any>) {
    if (scope === 'tenant') {
      return row.tenant_type === 'COMPANY'
        ? row.company_name
        : [row.first_name, row.last_name, row.post_name].filter(Boolean).join(' ').trim();
    }
    if (scope === 'unit') {
      return `${row.building_name ?? ''}${row.building_name && row.number ? ' - ' : ''}${row.number ?? ''}`.trim();
    }
    return row.name ?? row.building_name ?? `#${row.id}`;
  }

  private statementEntitySubtitle(scope: 'tenant' | 'unit' | 'building', row: Record<string, any>) {
    if (scope === 'tenant') {
      if (row.tenant_type === 'COMPANY') {
        return [row.rccm, row.legal_representative_name].filter(Boolean).join(' · ') || null;
      }
      return [row.phone, row.email].filter(Boolean).join(' · ') || null;
    }
    if (scope === 'unit') {
      return [row.building_address, row.active_lease_end_date ? `Fin bail ${row.active_lease_end_date}` : null].filter(Boolean).join(' · ') || null;
    }
    return [row.city, row.address].filter(Boolean).join(' · ') || null;
  }

  private async accountStatement(scope: 'tenant' | 'unit' | 'building', id: number, filters: { month?: string; year?: string; start?: string; end?: string } = {}) {
    const organizationId = this.context.organizationId();
    const period = this.statementPeriod(filters);
    const currency = 'USD';
    const source = await this.statementSource(scope, id, organizationId);
    const openingBalance = await this.statementOpeningBalance(scope, id, organizationId, period.start);
    const invoiceRows = await this.statementInvoices(scope, id, organizationId, period.start, period.end);
    const paymentRows = await this.statementPayments(scope, id, organizationId, period.start, period.end);
    const movements = this.statementMovements(openingBalance, invoiceRows, paymentRows, currency, period.start);
    const debits = invoiceRows.reduce((sum, row) => sum + Number(row.total ?? 0), 0);
    const credits = paymentRows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
    const closingBalance = Number(openingBalance ?? 0) + debits - credits;
    return {
      kind: scope.toUpperCase(),
      entity: source.entity,
      period,
      currency,
      opening_balance: Number(openingBalance ?? 0),
      totals: {
        debits,
        credits,
        closing_balance: Number(closingBalance.toFixed(2)),
        invoices_count: invoiceRows.length,
        payments_count: paymentRows.length,
      },
      movements,
      invoices: invoiceRows,
      payments: paymentRows,
    };
  }

  private async statementSource(scope: 'tenant' | 'unit' | 'building', id: number, organizationId: number) {
    if (scope === 'tenant') {
      const { rows } = await this.db.query(
        `SELECT t.*, u.number AS unit_number, b.name AS building_name, b.address AS building_address
         FROM tenants t
         LEFT JOIN units u ON u.id = t.unit_id
         LEFT JOIN buildings b ON b.id = u.building_id
         WHERE t.id = $1 AND t.organization_id = $2 AND t.deleted_at IS NULL`,
        [id, organizationId],
      );
      const row = requireRow(rows[0], 'Tenant');
      return {
        entity: {
          id: row.id,
          entity_type: 'TENANT',
          title: this.statementEntityLabel('tenant', row),
          subtitle: this.statementEntitySubtitle('tenant', row),
          tenant: row,
        },
      };
    }
    if (scope === 'unit') {
      const { rows } = await this.db.query(
        `SELECT u.*, b.name AS building_name, b.address AS building_address,
                t.id AS tenant_id, CONCAT(t.first_name, ' ', t.last_name) AS tenant_name,
                t.phone AS tenant_phone, t.email AS tenant_email,
                l.end_date AS active_lease_end_date
         FROM units u
         JOIN buildings b ON b.id = u.building_id
         LEFT JOIN tenants t ON t.unit_id = u.id AND t.status = 'ACTIVE' AND t.deleted_at IS NULL
         LEFT JOIN leases l ON l.unit_id = u.id AND l.status = 'ACTIVE' AND l.deleted_at IS NULL
         WHERE u.id = $1 AND u.organization_id = $2 AND u.deleted_at IS NULL`,
        [id, organizationId],
      );
      const row = requireRow(rows[0], 'Unit');
      return {
        entity: {
          id: row.id,
          entity_type: 'UNIT',
          title: this.statementEntityLabel('unit', row),
          subtitle: this.statementEntitySubtitle('unit', row),
          unit: row,
        },
      };
    }
    const { rows } = await this.db.query(
      `SELECT b.*
       FROM buildings b
       WHERE b.id = $1 AND b.organization_id = $2 AND b.deleted_at IS NULL`,
      [id, organizationId],
    );
    const row = requireRow(rows[0], 'Building');
    return {
      entity: {
        id: row.id,
        entity_type: 'BUILDING',
        title: this.statementEntityLabel('building', row),
        subtitle: this.statementEntitySubtitle('building', row),
        building: row,
      },
    };
  }

  private statementInvoiceScope(scope: 'tenant' | 'unit' | 'building') {
    if (scope === 'tenant') return 'i.tenant_id = $1';
    if (scope === 'unit') return 'COALESCE(i.unit_id, l.unit_id, t.unit_id) = $1';
    return 'COALESCE(i.building_id, u.building_id) = $1';
  }

  private statementPaymentScope(scope: 'tenant' | 'unit' | 'building') {
    if (scope === 'tenant') return 'i.tenant_id = $1';
    if (scope === 'unit') return 'COALESCE(i.unit_id, l.unit_id, t.unit_id) = $1';
    return 'COALESCE(i.building_id, u.building_id) = $1';
  }

  private async statementOpeningBalance(scope: 'tenant' | 'unit' | 'building', id: number, organizationId: number, start: string) {
    const invoiceCondition = this.statementInvoiceScope(scope);
    const paymentCondition = this.statementPaymentScope(scope);
    const invoiceSql = scope === 'tenant'
      ? `SELECT COALESCE(SUM(i.total), 0)::FLOAT AS total
         FROM invoices i
         WHERE ${invoiceCondition}
           AND i.issue_date < $3
           AND i.organization_id = $2
           AND i.deleted_at IS NULL`
      : scope === 'unit'
        ? `SELECT COALESCE(SUM(i.total), 0)::FLOAT AS total
           FROM invoices i
           LEFT JOIN leases l ON l.id = i.lease_id
           LEFT JOIN tenants t ON t.id = i.tenant_id
           WHERE ${invoiceCondition}
             AND i.issue_date < $3
             AND i.organization_id = $2
             AND i.deleted_at IS NULL`
        : `SELECT COALESCE(SUM(i.total), 0)::FLOAT AS total
           FROM invoices i
           LEFT JOIN leases l ON l.id = i.lease_id
           LEFT JOIN tenants t ON t.id = i.tenant_id
           LEFT JOIN units u ON u.id = COALESCE(i.unit_id, l.unit_id, t.unit_id)
           WHERE ${invoiceCondition}
             AND i.issue_date < $3
             AND i.organization_id = $2
             AND i.deleted_at IS NULL`;
    const paymentSql = scope === 'tenant'
      ? `SELECT COALESCE(SUM(p.amount), 0)::FLOAT AS total
         FROM payments p
         JOIN invoices i ON i.id = p.invoice_id
         WHERE ${paymentCondition}
           AND p.payment_date < $3
           AND p.organization_id = $2
           AND p.deleted_at IS NULL`
      : scope === 'unit'
        ? `SELECT COALESCE(SUM(p.amount), 0)::FLOAT AS total
           FROM payments p
           JOIN invoices i ON i.id = p.invoice_id
           LEFT JOIN leases l ON l.id = i.lease_id
           LEFT JOIN tenants t ON t.id = i.tenant_id
           WHERE ${paymentCondition}
             AND p.payment_date < $3
             AND p.organization_id = $2
             AND p.deleted_at IS NULL`
        : `SELECT COALESCE(SUM(p.amount), 0)::FLOAT AS total
           FROM payments p
           JOIN invoices i ON i.id = p.invoice_id
           LEFT JOIN leases l ON l.id = i.lease_id
           LEFT JOIN tenants t ON t.id = i.tenant_id
           LEFT JOIN units u ON u.id = COALESCE(i.unit_id, l.unit_id, t.unit_id)
           WHERE ${paymentCondition}
             AND p.payment_date < $3
             AND p.organization_id = $2
             AND p.deleted_at IS NULL`;
    const [invoiceBalance, paymentBalance] = await Promise.all([
      this.db.query(invoiceSql, [id, organizationId, start]),
      this.db.query(paymentSql, [id, organizationId, start]),
    ]);
    return Number(invoiceBalance.rows[0]?.total ?? 0) - Number(paymentBalance.rows[0]?.total ?? 0);
  }

  private async statementInvoices(scope: 'tenant' | 'unit' | 'building', id: number, organizationId: number, start: string, end: string) {
    const condition = this.statementInvoiceScope(scope);
    const sql = scope === 'tenant'
      ? `SELECT i.id, i.invoice_number, i.month, i.year, i.issue_date, i.due_date, i.status, i.total,
              i.last_reminder_at, COALESCE(i.reminder_count, 0)::INT AS reminder_count,
              i.tenant_id, CONCAT(t.first_name, ' ', t.last_name) AS tenant_name, t.phone, t.email,
              u.number AS unit_number,
              COALESCE(s.paid_amount, 0)::FLOAT AS paid_amount,
              COALESCE(s.remaining_amount, i.total)::FLOAT AS remaining_amount
         FROM invoices i
         JOIN tenants t ON t.id = i.tenant_id
         LEFT JOIN leases l ON l.id = i.lease_id
         LEFT JOIN units u ON u.id = COALESCE(i.unit_id, l.unit_id, t.unit_id)
         LEFT JOIN invoice_payment_summary s ON s.invoice_id = i.id
         WHERE ${condition}
           AND i.organization_id = $2
           AND i.deleted_at IS NULL
           AND i.issue_date BETWEEN $3 AND $4
         ORDER BY i.issue_date ASC, i.id ASC`
      : scope === 'unit'
        ? `SELECT i.id, i.invoice_number, i.month, i.year, i.issue_date, i.due_date, i.status, i.total,
              i.last_reminder_at, COALESCE(i.reminder_count, 0)::INT AS reminder_count,
              i.tenant_id, CONCAT(t.first_name, ' ', t.last_name) AS tenant_name, t.phone, t.email,
              u.number AS unit_number, b.name AS building_name,
              COALESCE(s.paid_amount, 0)::FLOAT AS paid_amount,
              COALESCE(s.remaining_amount, i.total)::FLOAT AS remaining_amount
         FROM invoices i
         JOIN tenants t ON t.id = i.tenant_id
         LEFT JOIN leases l ON l.id = i.lease_id
         LEFT JOIN units u ON u.id = COALESCE(i.unit_id, l.unit_id, t.unit_id)
         LEFT JOIN buildings b ON b.id = u.building_id
         LEFT JOIN invoice_payment_summary s ON s.invoice_id = i.id
         WHERE ${condition}
           AND i.organization_id = $2
           AND i.deleted_at IS NULL
           AND i.issue_date BETWEEN $3 AND $4
         ORDER BY i.issue_date ASC, i.id ASC`
        : `SELECT i.id, i.invoice_number, i.month, i.year, i.issue_date, i.due_date, i.status, i.total,
              i.last_reminder_at, COALESCE(i.reminder_count, 0)::INT AS reminder_count,
              i.tenant_id, CONCAT(t.first_name, ' ', t.last_name) AS tenant_name, t.phone, t.email,
              u.number AS unit_number, b.name AS building_name,
              COALESCE(s.paid_amount, 0)::FLOAT AS paid_amount,
              COALESCE(s.remaining_amount, i.total)::FLOAT AS remaining_amount
         FROM invoices i
         JOIN tenants t ON t.id = i.tenant_id
         LEFT JOIN leases l ON l.id = i.lease_id
         LEFT JOIN units u ON u.id = COALESCE(i.unit_id, l.unit_id, t.unit_id)
         LEFT JOIN buildings b ON b.id = COALESCE(i.building_id, u.building_id)
         LEFT JOIN invoice_payment_summary s ON s.invoice_id = i.id
         WHERE ${condition}
           AND i.organization_id = $2
           AND i.deleted_at IS NULL
           AND i.issue_date BETWEEN $3 AND $4
         ORDER BY i.issue_date ASC, i.id ASC`;
    const { rows } = await this.db.query(sql, [id, organizationId, start, end]);
    return this.appendInvoiceItemSummaries(rows);
  }

  private async statementPayments(scope: 'tenant' | 'unit' | 'building', id: number, organizationId: number, start: string, end: string) {
    const condition = this.statementPaymentScope(scope);
    const sql = scope === 'tenant'
      ? `SELECT p.id, p.payment_date, p.amount, p.payment_method, p.reference, p.receipt_number,
              i.invoice_number, i.status AS invoice_status, i.id AS invoice_id, i.tenant_id,
              CONCAT(t.first_name, ' ', t.last_name) AS tenant_name,
              u.number AS unit_number
         FROM payments p
         JOIN invoices i ON i.id = p.invoice_id
         JOIN tenants t ON t.id = i.tenant_id
         LEFT JOIN leases l ON l.id = i.lease_id
         LEFT JOIN units u ON u.id = COALESCE(i.unit_id, l.unit_id, t.unit_id)
         WHERE ${condition}
           AND p.payment_date BETWEEN $3 AND $4
           AND p.organization_id = $2
           AND p.deleted_at IS NULL
         ORDER BY p.payment_date ASC, p.id ASC`
      : scope === 'unit'
        ? `SELECT p.id, p.payment_date, p.amount, p.payment_method, p.reference, p.receipt_number,
              i.invoice_number, i.status AS invoice_status, i.id AS invoice_id, i.tenant_id,
              CONCAT(t.first_name, ' ', t.last_name) AS tenant_name,
              u.number AS unit_number, b.name AS building_name
         FROM payments p
         JOIN invoices i ON i.id = p.invoice_id
         JOIN tenants t ON t.id = i.tenant_id
         LEFT JOIN leases l ON l.id = i.lease_id
         LEFT JOIN units u ON u.id = COALESCE(i.unit_id, l.unit_id, t.unit_id)
         LEFT JOIN buildings b ON b.id = u.building_id
         WHERE ${condition}
           AND p.payment_date BETWEEN $3 AND $4
           AND p.organization_id = $2
           AND p.deleted_at IS NULL
         ORDER BY p.payment_date ASC, p.id ASC`
        : `SELECT p.id, p.payment_date, p.amount, p.payment_method, p.reference, p.receipt_number,
              i.invoice_number, i.status AS invoice_status, i.id AS invoice_id, i.tenant_id,
              CONCAT(t.first_name, ' ', t.last_name) AS tenant_name,
              u.number AS unit_number, b.name AS building_name
         FROM payments p
         JOIN invoices i ON i.id = p.invoice_id
         JOIN tenants t ON t.id = i.tenant_id
         LEFT JOIN leases l ON l.id = i.lease_id
         LEFT JOIN units u ON u.id = COALESCE(i.unit_id, l.unit_id, t.unit_id)
         LEFT JOIN buildings b ON b.id = COALESCE(i.building_id, u.building_id)
         WHERE ${condition}
           AND p.payment_date BETWEEN $3 AND $4
           AND p.organization_id = $2
           AND p.deleted_at IS NULL
         ORDER BY p.payment_date ASC, p.id ASC`;
    const { rows } = await this.db.query(sql, [id, organizationId, start, end]);
    return rows;
  }

  private statementMovements(openingBalance: number, invoices: Record<string, any>[], payments: Record<string, any>[], currency: string, openingDate: string) {
    const rows = [
      {
        date: openingDate,
        reference: 'OUVERTURE',
        movement_type: 'OPENING',
        label: 'Solde initial',
        debit: 0,
        credit: 0,
        currency,
        running_balance: Number(openingBalance.toFixed(2)),
      },
      ...invoices.map((invoice) => ({
        date: invoice.issue_date,
        reference: invoice.invoice_number,
        movement_type: 'INVOICE',
        label: `Facture ${invoice.invoice_number}${invoice.rent_amount || invoice.syndic_amount ? ` - Loyer ${Number(invoice.rent_amount ?? 0).toFixed(2)} / Syndic ${Number(invoice.syndic_amount ?? 0).toFixed(2)}` : ''}`,
        debit: Number(invoice.total ?? 0),
        credit: 0,
        currency,
        source_id: invoice.id,
      })),
      ...payments.map((payment) => ({
        date: payment.payment_date,
        reference: payment.receipt_number ?? payment.reference ?? payment.invoice_number,
        movement_type: 'PAYMENT',
        label: `Paiement ${payment.invoice_number ?? payment.receipt_number ?? payment.reference ?? `#${payment.id}`}`,
        debit: 0,
        credit: Number(payment.amount ?? 0),
        currency,
        source_id: payment.id,
      })),
    ].sort((a, b) => {
      const dateDiff = new Date(String(a.date)).getTime() - new Date(String(b.date)).getTime();
      if (dateDiff !== 0) return dateDiff;
      return this.statementMovementOrder(String(a.movement_type)) - this.statementMovementOrder(String(b.movement_type));
    });
    let running = Number(openingBalance ?? 0);
    return rows.map((row, index) => {
      if (index === 0 && row.movement_type === 'OPENING') return row;
      running += Number(row.debit ?? 0) - Number(row.credit ?? 0);
      return { ...row, running_balance: Number(running.toFixed(2)) };
    });
  }

  async availabilityReport() {
    const { rows } = await this.db.query(
      `SELECT b.id AS building_id, b.name AS building_name,
             COUNT(u.id)::INT AS total_units,
             COUNT(*) FILTER (WHERE u.status = 'OCCUPIED')::INT AS occupied_units,
             COUNT(*) FILTER (WHERE u.status = 'VACANT')::INT AS vacant_units,
             COUNT(*) FILTER (WHERE u.status = 'MAINTENANCE')::INT AS maintenance_units,
             COUNT(*) FILTER (WHERE u.status = 'BLOCKED')::INT AS blocked_units,
             COALESCE(SUM(CASE WHEN u.status = 'VACANT' THEN u.monthly_rent ELSE 0 END), 0)::FLOAT AS vacant_potential_rent,
             CASE WHEN COUNT(u.id) > 0 THEN ROUND((COUNT(*) FILTER (WHERE u.status = 'OCCUPIED')::NUMERIC / COUNT(u.id)::NUMERIC) * 100, 2)::FLOAT ELSE 0 END AS occupancy_rate
      FROM buildings b
      JOIN units u ON u.building_id = b.id
      WHERE b.organization_id = $1 AND b.deleted_at IS NULL AND u.deleted_at IS NULL
      GROUP BY b.id, b.name
      ORDER BY b.name
    `,
      [this.context.organizationId()],
    );
    return {
      buildings: rows,
      totals: {
        total_units: rows.reduce((sum, row) => sum + Number(row.total_units), 0),
        occupied_units: rows.reduce((sum, row) => sum + Number(row.occupied_units), 0),
        vacant_units: rows.reduce((sum, row) => sum + Number(row.vacant_units), 0),
        maintenance_units: rows.reduce((sum, row) => sum + Number(row.maintenance_units), 0),
        blocked_units: rows.reduce((sum, row) => sum + Number(row.blocked_units), 0),
        vacant_potential_rent: rows.reduce((sum, row) => sum + Number(row.vacant_potential_rent), 0),
      },
    };
  }

  async overdueReport(buildingId?: number, tenantId?: number) {
    const { rows } = await this.db.query(
      `SELECT i.invoice_number, i.due_date, i.status, i.total,
              COALESCE(s.paid_amount, 0)::FLOAT AS paid_amount,
              COALESCE(s.remaining_amount, i.total)::FLOAT AS remaining_amount,
              CONCAT(t.first_name, ' ', t.last_name) AS tenant_name, b.name AS building_name, u.number AS unit_number
       FROM invoices i
       JOIN tenants t ON t.id = i.tenant_id
       LEFT JOIN units u ON u.id = i.unit_id
       LEFT JOIN buildings b ON b.id = i.building_id
       LEFT JOIN invoice_payment_summary s ON s.invoice_id = i.id
       WHERE i.organization_id = $1
         AND i.deleted_at IS NULL
         AND i.status <> 'PAID'
         AND i.due_date < CURRENT_DATE
         AND ($2::INT IS NULL OR b.id = $2)
         AND ($3::INT IS NULL OR t.id = $3)
       ORDER BY i.due_date, i.invoice_number`,
      [this.context.organizationId(), buildingId ?? null, tenantId ?? null],
    );
    return {
      invoices: rows,
      count: rows.length,
      total_remaining: rows.reduce((sum, row) => sum + Number(row.remaining_amount), 0),
    };
  }

  async exportReport(type: string, id?: number, start?: string, end?: string) {
    if (type === 'building' && id) {
      const report = await this.buildingReport(id, { start, end });
      return { filename: 'rapport-immeuble.csv', rows: [...report.units, ...report.tenants] };
    }
    if (type === 'tenant' && id) {
      const report = await this.tenantReport(id, { start, end });
      return { filename: 'rapport-locataire.csv', rows: [...report.leases, ...report.invoices, ...report.payments] };
    }
    if (type === 'payments') {
      const report = await this.paymentsReport({ start, end });
      return { filename: 'rapport-paiements.csv', rows: report.payments_received };
    }
    if (type === 'overdue') {
      const report = await this.overdueReport();
      return { filename: 'rapport-impayes.csv', rows: report.invoices };
    }
    const report = await this.availabilityReport();
    return { filename: 'rapport-disponibilite.csv', rows: report.buildings };
  }

  async cashReport() {
    const sessions = await this.findAll('cash_sessions', 'opened_at DESC');
    const movements = await this.cashMovements();
    const byCurrency = Object.values(
      movements.reduce<Record<string, { currency: string; amount_in: number; amount_out: number; balance: number }>>((acc, movement) => {
        const currency = String(movement.currency ?? 'USD').toUpperCase();
        acc[currency] ??= { currency, amount_in: 0, amount_out: 0, balance: 0 };
        const amount = Number(movement.amount ?? 0);
        if (movement.type === 'IN') acc[currency].amount_in += amount;
        if (movement.type === 'OUT') acc[currency].amount_out += amount;
        acc[currency].balance = acc[currency].amount_in - acc[currency].amount_out;
        return acc;
      }, {}),
    );
    return {
      sessions,
      movements,
      total_in: movements.filter((m) => m.type === 'IN').reduce((sum, m) => sum + Number(m.amount), 0),
      total_out: movements.filter((m) => m.type === 'OUT').reduce((sum, m) => sum + Number(m.amount), 0),
      by_currency: byCurrency,
      by_category: Object.values(
        movements.reduce<Record<string, { category: string; amount: number }>>((acc, movement) => {
          acc[movement.category] ??= { category: movement.category, amount: 0 };
          acc[movement.category].amount += Number(movement.amount);
          return acc;
        }, {}),
      ),
    };
  }

  async stockReport() {
    const items = await this.stockItems();
    const movements = await this.stockMovements();
    const inventories = await this.stockInventories();
    const alerts = await this.stockAlerts();
    const purchases = await this.stockPurchases();
    const byCategory = Object.values(items.reduce((acc: Record<string, { category: string; quantity: number; value: number }>, item) => {
      const key = String(item.category ?? 'Sans catÃ©gorie');
      acc[key] ??= { category: key, quantity: 0, value: 0 };
      acc[key].quantity += Number(item.current_quantity ?? 0);
      acc[key].value += Number(item.current_quantity ?? 0) * Number(item.average_purchase_price ?? item.purchase_price ?? 0);
      return acc;
    }, {}));
    const byStore = Object.values(items.reduce((acc: Record<string, { store: string; quantity: number; value: number }>, item) => {
      const key = String(item.store ?? 'Non renseignÃ©');
      acc[key] ??= { store: key, quantity: 0, value: 0 };
      acc[key].quantity += Number(item.current_quantity ?? 0);
      acc[key].value += Number(item.current_quantity ?? 0) * Number(item.average_purchase_price ?? item.purchase_price ?? 0);
      return acc;
    }, {}));
    return {
      items,
      movements,
      inventories,
      alerts,
      purchases,
      by_category: byCategory,
      by_store: byStore,
      purchases_by_supplier: Object.values(
        purchases.reduce((acc: Record<string, { supplier: string; count: number; amount: number; paid: number; outstanding: number }>, purchase) => {
          const key = String(purchase.supplier_name ?? 'Non renseigne');
          acc[key] ??= { supplier: key, count: 0, amount: 0, paid: 0, outstanding: 0 };
          acc[key].count += 1;
          acc[key].amount += Number(purchase.total_amount ?? 0);
          acc[key].paid += Number(purchase.paid_amount ?? 0);
          acc[key].outstanding += Number(purchase.outstanding_amount ?? 0);
          return acc;
        }, {}),
      ),
      purchases_by_month: Object.values(
        purchases.reduce((acc: Record<string, { period: string; amount: number; paid: number; count: number }>, purchase) => {
          const key = String(purchase.purchase_date).slice(0, 7);
          acc[key] ??= { period: key, amount: 0, paid: 0, count: 0 };
          acc[key].amount += Number(purchase.total_amount ?? 0);
          acc[key].paid += Number(purchase.paid_amount ?? 0);
          acc[key].count += 1;
          return acc;
        }, {}),
      ).sort((a, b) => String(a.period).localeCompare(String(b.period))),
      maintenance_consumption: movements.filter((movement) => movement.source === 'MAINTENANCE'),
      under_minimum: items.filter((item) => item.status === 'ACTIVE' && Number(item.current_quantity) <= Number(item.minimum_quantity) && Number(item.current_quantity) > 0),
      out_of_stock: items.filter((item) => item.status === 'ACTIVE' && Number(item.current_quantity) <= 0),
      inactive: items.filter((item) => item.status !== 'ACTIVE'),
      valuation: items.reduce((sum, item) => sum + Number(item.current_quantity) * Number(item.average_purchase_price ?? item.purchase_price ?? 0), 0),
      supplier_debt: purchases.reduce((sum, purchase) => sum + Number(purchase.outstanding_amount ?? 0), 0),
      pending_receptions: purchases.filter((purchase) => purchase.reception_status !== 'RECEIVED'),
      unpaid_purchases: purchases.filter((purchase) => purchase.payment_status !== 'PAID'),
    };
  }

  async staffReport(start = '2000-01-01', end = '2999-12-31', month?: number, year?: number) {
    const employees = await this.findAll('employees', 'last_name, first_name');
    const advances = await this.salaryAdvances();
    const leaves = await this.leaves(start, end);
    const payrolls = await this.payrolls({ month, year });
    return {
      employees,
      advances: advances.filter((advance) => String(advance.advance_date).slice(0, 10) >= start && String(advance.advance_date).slice(0, 10) <= end),
      leaves,
      payrolls,
      summary: {
        active_employees: employees.filter((employee) => employee.status === 'ACTIVE').length,
        inactive_employees: employees.filter((employee) => employee.status === 'INACTIVE').length,
        advances_total: advances.reduce((sum, advance) => sum + Number(advance.amount), 0),
        payroll_net_total: payrolls.reduce((sum, payroll) => sum + Number(payroll.net_salary), 0),
      },
    };
  }

  async maintenanceReport(filters: { start?: string; end?: string; buildingId?: number; employeeId?: number } = {}) {
    const start = filters.start ?? '2000-01-01';
    const end = filters.end ?? '2999-12-31';
    const { rows } = await this.db.query(
      `SELECT mr.*, b.name AS building_name, u.number AS unit_number,
              CONCAT(e.first_name, ' ', e.last_name) AS technician_name,
              COALESCE(exp.total_expenses, 0)::FLOAT AS expenses_total,
              COALESCE(stock.total_stock_cost, 0)::FLOAT AS stock_cost_total,
              CASE WHEN mr.due_date IS NOT NULL AND mr.status NOT IN ('RESOLVED', 'VALIDATED', 'CLOSED', 'CANCELLED') AND mr.due_date < NOW() THEN TRUE ELSE FALSE END AS is_overdue,
              CASE WHEN mr.resolved_at IS NOT NULL THEN EXTRACT(EPOCH FROM (mr.resolved_at - mr.reported_at)) / 3600 ELSE NULL END AS resolution_hours
       FROM maintenance_requests mr
       LEFT JOIN buildings b ON b.id = mr.building_id
       LEFT JOIN units u ON u.id = mr.unit_id
       LEFT JOIN employees e ON e.id = mr.assigned_employee_id
       LEFT JOIN (
         SELECT maintenance_request_id, SUM(amount) AS total_expenses
         FROM maintenance_expenses
         WHERE organization_id = $5 AND deleted_at IS NULL AND status <> 'REJECTED'
         GROUP BY maintenance_request_id
       ) exp ON exp.maintenance_request_id = mr.id
       LEFT JOIN (
         SELECT maintenance_request_id, SUM(quantity * unit_price) AS total_stock_cost
         FROM stock_movements
         WHERE organization_id = $5 AND deleted_at IS NULL AND maintenance_request_id IS NOT NULL
         GROUP BY maintenance_request_id
       ) stock ON stock.maintenance_request_id = mr.id
       WHERE mr.organization_id = $5 AND mr.deleted_at IS NULL
         AND mr.reported_at::DATE BETWEEN $1::DATE AND $2::DATE
         AND ($3::INT IS NULL OR mr.building_id = $3)
         AND ($4::INT IS NULL OR mr.assigned_employee_id = $4)
       ORDER BY mr.reported_at DESC`,
      [start, end, filters.buildingId ?? null, filters.employeeId ?? null, this.context.organizationId()],
    );
    const [stockConsumed, monthlyExpenses] = await Promise.all([
      this.db.query(
        `SELECT si.code, si.name, SUM(sm.quantity)::FLOAT AS quantity,
                SUM(sm.quantity * sm.unit_price)::FLOAT AS total_cost
         FROM stock_movements sm
         JOIN stock_items si ON si.id = sm.stock_item_id
         JOIN maintenance_requests mr ON mr.id = sm.maintenance_request_id
         WHERE sm.organization_id = $3 AND sm.deleted_at IS NULL
           AND mr.reported_at::DATE BETWEEN $1::DATE AND $2::DATE
         GROUP BY si.id, si.code, si.name
         ORDER BY quantity DESC`,
        [start, end, this.context.organizationId()],
      ),
      this.db.query(
        `SELECT TO_CHAR(me.expense_date, 'YYYY-MM') AS month, SUM(me.amount)::FLOAT AS amount
         FROM maintenance_expenses me
         WHERE me.organization_id = $3 AND me.deleted_at IS NULL AND me.status <> 'REJECTED'
           AND me.expense_date BETWEEN $1::DATE AND $2::DATE
         GROUP BY TO_CHAR(me.expense_date, 'YYYY-MM')
         ORDER BY month`,
        [start, end, this.context.organizationId()],
      ),
    ]);
    const summary = {
      open: rows.filter((row) => !['CLOSED', 'CANCELLED'].includes(row.status)).length,
      in_progress: rows.filter((row) => ['ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'].includes(row.status)).length,
      resolved: rows.filter((row) => ['RESOLVED', 'VALIDATED'].includes(row.status)).length,
      closed: rows.filter((row) => row.status === 'CLOSED').length,
      urgent: rows.filter((row) => row.priority === 'URGENT').length,
      overdue: rows.filter((row) => row.is_overdue).length,
      completed: rows.filter((row) => ['RESOLVED', 'VALIDATED', 'CLOSED'].includes(row.status)).length,
      average_resolution_hours: rows.filter((row) => row.resolution_hours !== null).reduce((sum, row) => sum + Number(row.resolution_hours), 0) / Math.max(rows.filter((row) => row.resolution_hours !== null).length, 1),
      total_cost: rows.reduce((sum, row) => sum + Number(row.expenses_total) + Number(row.stock_cost_total), 0),
      resolution_rate: rows.length ? Math.round((rows.filter((row) => ['RESOLVED', 'VALIDATED', 'CLOSED'].includes(row.status)).length / rows.length) * 100) : 0,
    };
    return {
      requests: rows,
      by_building: Object.values(rows.reduce<Record<string, { building_name: string; count: number; cost: number }>>((acc, row) => {
        const key = row.building_name ?? 'Non liÃƒÂ©';
        acc[key] ??= { building_name: key, count: 0, cost: 0 };
        acc[key].count += 1;
        acc[key].cost += Number(row.expenses_total) + Number(row.stock_cost_total);
        return acc;
      }, {})),
      by_unit: Object.values(rows.reduce<Record<string, { building_name: string; unit_number: string; count: number; cost: number }>>((acc, row) => {
        const key = `${row.building_name ?? 'Non lie'} / ${row.unit_number ?? 'Sans unite'}`;
        acc[key] ??= { building_name: row.building_name ?? 'Non lie', unit_number: row.unit_number ?? 'Sans unite', count: 0, cost: 0 };
        acc[key].count += 1;
        acc[key].cost += Number(row.expenses_total) + Number(row.stock_cost_total);
        return acc;
      }, {})),
      by_technician: Object.values(rows.reduce<Record<string, { technician_name: string; count: number; avg_hours: number }>>((acc, row) => {
        const key = row.technician_name ?? row.external_provider ?? 'Non affectÃƒÂ©';
        acc[key] ??= { technician_name: key, count: 0, avg_hours: 0 };
        acc[key].count += 1;
        acc[key].avg_hours += Number(row.resolution_hours ?? 0);
        return acc;
      }, {})).map((row) => ({
        ...row,
        avg_hours: row.count ? row.avg_hours / row.count : 0,
        total_cost: rows.filter((current) => (current.technician_name ?? current.external_provider ?? 'Non affectÃƒÂ©') === row.technician_name).reduce((sum, current) => sum + Number(current.expenses_total) + Number(current.stock_cost_total), 0),
      })),
      by_category: Object.values(rows.reduce<Record<string, { category: string; count: number; cost: number }>>((acc, row) => {
        acc[row.category] ??= { category: row.category, count: 0, cost: 0 };
        acc[row.category].count += 1;
        acc[row.category].cost += Number(row.expenses_total) + Number(row.stock_cost_total);
        return acc;
      }, {})),
      urgent_requests: rows.filter((row) => row.priority === 'URGENT'),
      overdue_requests: rows.filter((row) => row.is_overdue),
      stock_consumed: stockConsumed.rows,
      monthly_expenses: monthlyExpenses.rows,
      resolution_times: rows.filter((row) => row.resolution_hours !== null).map((row) => ({ request_number: row.request_number, title: row.title, technician: row.technician_name ?? row.external_provider ?? 'Non affectÃƒÂ©', resolution_hours: Number(row.resolution_hours ?? 0) })),
      summary,
    };
  }

  private async createStockMovementInTransaction(client: PoolClient, body: Record<string, unknown>) {
    if (body.maintenance_request_id) {
      await this.assertMaintenanceStatus(client, Number(body.maintenance_request_id), ['IN_PROGRESS']);
    }
    const item = await client.query(
      `SELECT * FROM stock_items WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [body.stock_item_id, this.context.organizationId()],
    );
    const itemRow = requireRow(item.rows[0], 'Stock item');
    if (itemRow.status !== 'ACTIVE') throw new BadRequestException('Article stock inactif');
    const type = String(body.type ?? 'OUT');
    const quantity = Number(body.quantity ?? 0);
    if (quantity <= 0) throw new BadRequestException('La quantitÃƒÂ© doit ÃƒÂªtre positive');
    const before = Number(itemRow.current_quantity);
    const sign = ['IN', 'INVENTORY_GAIN', 'INVENTORY'].includes(type) ? 1 : -1;
    const after = before + sign * quantity;
    if (after < 0) throw new BadRequestException('Stock insuffisant');
    const unitPrice = Number(body.unit_price ?? body.purchase_price ?? itemRow.average_purchase_price ?? itemRow.purchase_price ?? 0);
    const sequencePrefix = sign > 0 ? 'ENT' : type === 'INVENTORY_LOSS' ? 'INV-LOSS' : 'SOR';
    const movementNumber = body.movement_number ?? `${sequencePrefix}-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    const { rows } = await client.query(
      `INSERT INTO stock_movements
       (movement_number, stock_item_id, type, quantity, movement_date, source, reference, notes, created_by, organization_id,
        unit_price, supplier, destination, quantity_before, quantity_after, maintenance_reference, inventory_count_id,
        maintenance_request_id, stock_document_id, reason, attachment_file_name, stock_purchase_id, stock_purchase_receipt_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
       RETURNING *`,
      [
        movementNumber,
        body.stock_item_id,
        type,
        quantity,
        body.movement_date ?? new Date().toISOString().slice(0, 10),
        body.source ?? null,
        body.reference ?? movementNumber,
        body.comment ?? body.notes ?? null,
        this.context.userId() ?? body.created_by ?? 1,
        this.context.organizationId(),
        unitPrice,
        body.supplier ?? null,
        body.destination ?? null,
        before,
        after,
        body.maintenance_reference ?? null,
        body.inventory_count_id ?? null,
        body.maintenance_request_id ?? null,
        body.stock_document_id ?? null,
        body.reason ?? null,
        body.attachment_file_name ?? null,
        body.stock_purchase_id ?? null,
        body.stock_purchase_receipt_id ?? null,
      ],
    );
    await client.query(
      `INSERT INTO stock_movement_history
       (stock_movement_id, action, description, performed_by, organization_id)
       VALUES ($1, 'CREATED', $2, $3, $4)`,
      [rows[0].id, `Mouvement crÃ©Ã© depuis ${body.reference ?? movementNumber}`, this.context.userId() ?? 1, this.context.organizationId()],
    );
    const averagePrice =
      sign > 0 && unitPrice > 0 && after > 0
        ? ((before * Number(itemRow.average_purchase_price ?? itemRow.purchase_price ?? 0)) + (quantity * unitPrice)) / after
        : Number(itemRow.average_purchase_price ?? itemRow.purchase_price ?? 0);
    await client.query(
      `UPDATE stock_items
       SET current_quantity = $2,
           average_purchase_price = $3,
           purchase_price = CASE WHEN $4::NUMERIC > 0 THEN $4 ELSE purchase_price END,
           updated_at = NOW()
       WHERE id = $1 AND organization_id = $5`,
      [body.stock_item_id, after, averagePrice, unitPrice, this.context.organizationId()],
    );
    await this.syncStockAlerts(client, itemRow, after);
    return rows[0];
  }

  private async syncStockAlerts(client: PoolClient, item: Record<string, unknown>, quantity: number) {
    const organizationId = this.context.organizationId();
    const minimum = Number(item.minimum_quantity ?? 0);
    const level = quantity <= 0 ? 'OUT_OF_STOCK' : quantity <= minimum ? 'LOW_STOCK' : null;
    if (!level) {
      await client.query(
        `UPDATE stock_alerts SET resolved_at = NOW()
         WHERE stock_item_id = $1 AND organization_id = $2 AND resolved_at IS NULL AND deleted_at IS NULL`,
        [item.id, organizationId],
      );
      return;
    }
    await client.query(
      `UPDATE stock_alerts SET resolved_at = NOW()
       WHERE stock_item_id = $1 AND organization_id = $2 AND level <> $3
         AND resolved_at IS NULL AND deleted_at IS NULL`,
      [item.id, organizationId, level],
    );
    const message = level === 'OUT_OF_STOCK'
      ? `L'article ${item.name} est en rupture de stock.`
      : `L'article ${item.name} est sous le seuil de sÃ©curitÃ©. Stock actuel : ${quantity} ${item.unit}. Seuil : ${minimum}.`;
    const responsible = await client.query(
      `SELECT id, email FROM app_users
       WHERE organization_id = $1 AND deleted_at IS NULL AND status = 'ACTIVE'
         AND role IN ('ADMIN', 'ACCOUNTANT')
       ORDER BY CASE WHEN role = 'ADMIN' THEN 0 ELSE 1 END, id LIMIT 1`,
      [organizationId],
    );
    const recipient = responsible.rows[0]?.email ?? 'Responsable stock';
    const created = [];
    for (const channel of ['INTERNAL', 'EMAIL', 'WHATSAPP']) {
      const inserted = await client.query(
        `INSERT INTO stock_alerts
         (stock_item_id, level, quantity, minimum_quantity, channel, recipient, message, status, created_by, organization_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'SIMULATED', $8, $9)
         ON CONFLICT DO NOTHING RETURNING id`,
        [item.id, level, quantity, minimum, channel, channel === 'INTERNAL' ? null : recipient, message,
          this.context.userId() ?? 1, organizationId],
      );
      if (inserted.rows[0]) created.push(channel);
    }
    if (created.includes('INTERNAL')) {
      await client.query(
        `INSERT INTO notifications
         (user_id, title, message, priority, source, related_entity_type, related_entity_id,
          link_path, created_by, organization_id)
         SELECT au.id, $1, $2, $3, 'STOCK', 'STOCK_ITEM', $4, $5, $6, $7
         FROM app_users au
         WHERE au.organization_id = $7 AND au.deleted_at IS NULL
           AND au.role IN ('ADMIN', 'ACCOUNTANT')
         LIMIT 5`,
        [level === 'OUT_OF_STOCK' ? 'Rupture de stock' : 'Stock sous seuil', message,
          level === 'OUT_OF_STOCK' ? 'CRITICAL' : 'HIGH', item.id, `/stock/${item.id}`,
          this.context.userId() ?? 1, organizationId],
      );
    }
    if (created.includes('EMAIL')) {
      await client.query(
        `INSERT INTO email_logs
         (recipient, subject, message, status, related_entity_type, related_entity_id, sent_at, created_by, organization_id)
         VALUES ($1, $2, $3, 'SIMULATED', 'STOCK_ITEM', $4, NOW(), $5, $6)`,
        [recipient, level === 'OUT_OF_STOCK' ? 'Rupture de stock' : 'Stock sous seuil', message,
          item.id, this.context.userId() ?? 1, organizationId],
      );
    }
    if (created.includes('WHATSAPP')) {
      await client.query(
        `INSERT INTO whatsapp_logs
         (recipient, message, status, related_entity_type, related_entity_id, sent_at, created_by, organization_id)
         VALUES ($1, $2, 'SIMULATED', 'STOCK_ITEM', $3, NOW(), $4, $5)`,
        [recipient, message, item.id, this.context.userId() ?? 1, organizationId],
      );
    }
  }

  private async createMaintenanceAssignmentCommunications(client: PoolClient, request: Record<string, unknown>, body: Record<string, unknown>) {
    if (!body.employee_id) return;
    const contact = await client.query(
      `SELECT e.email, e.phone, b.name AS building_name, u.number AS unit_number,
              CONCAT(t.first_name, ' ', t.last_name) AS tenant_name
       FROM employees e
       LEFT JOIN maintenance_requests mr ON mr.id = $1 AND mr.organization_id = $3
       LEFT JOIN buildings b ON b.id = mr.building_id
       LEFT JOIN units u ON u.id = mr.unit_id
       LEFT JOIN tenants t ON t.id = mr.tenant_id
       WHERE e.id = $2 AND e.organization_id = $3 AND e.deleted_at IS NULL`,
      [request.id, body.employee_id, this.context.organizationId()],
    );
    const technician = contact.rows[0];
    if (!technician) return;
    const message = [
      `${request.request_number} - ${request.title}`,
      technician.building_name ? `Immeuble: ${technician.building_name}` : null,
      technician.unit_number ? `Unite: ${technician.unit_number}` : null,
      technician.tenant_name ? `Locataire: ${technician.tenant_name}` : null,
      `Priorite: ${request.priority}`,
      body.planned_date ? `Prevue: ${body.planned_date} ${body.planned_time ?? ''}` : null,
      body.notes ? `Commentaire: ${body.notes}` : null,
    ].filter(Boolean).join('\n');
    const organizationId = this.context.organizationId();
    const createdBy = this.context.userId() ?? 1;
    if (technician.email) {
      await client.query(
        `INSERT INTO notifications
         (user_id, title, message, priority, source, related_entity_type, related_entity_id, link_path, created_by, organization_id)
         VALUES (
           (SELECT au.id FROM app_users au WHERE au.organization_id = $7 AND au.deleted_at IS NULL AND LOWER(au.email) = LOWER($8) LIMIT 1),
           $2, $3, $4, 'MAINTENANCE', 'maintenance_request', $1, $5, $6, $7
         )`,
        [request.id, `Affectation ${request.request_number}`, message, request.priority === 'URGENT' ? 'CRITICAL' : 'NORMAL', `/maintenance/${request.id}`, createdBy, organizationId, technician.email],
      );
      await client.query(
        `INSERT INTO email_logs
         (recipient, subject, message, status, provider_response, related_entity_type, related_entity_id, sent_at, created_by, organization_id)
         VALUES ($1, $2, $3, 'SIMULATED', $4, 'maintenance_request', $5, NOW(), $6, $7)`,
        [technician.email, `Affectation ${request.request_number}`, message, JSON.stringify({ provider: 'LOCAL_SIMULATOR' }), request.id, createdBy, organizationId],
      );
    }
    if (technician.phone) {
      for (const table of ['sms_logs', 'whatsapp_logs']) {
        await client.query(
          `INSERT INTO ${table}
           (recipient, message, status, provider_response, related_entity_type, related_entity_id, sent_at, created_by, organization_id)
           VALUES ($1, $2, 'SIMULATED', $3, 'maintenance_request', $4, NOW(), $5, $6)`,
          [technician.phone, message, JSON.stringify({ provider: 'LOCAL_SIMULATOR' }), request.id, createdBy, organizationId],
        );
      }
    }
  }

  async sendMaintenanceCommunication(id: number, channel: string, body: Record<string, unknown>) {
    return this.db.transaction(async (client) => {
      const request = await this.getMaintenanceCommunicationContext(client, id);
      const communicationChannel = String(channel ?? '').toUpperCase();
      const target = String(body.target ?? 'TENANT').toUpperCase();
      if (!['EMAIL', 'SMS', 'WHATSAPP'].includes(communicationChannel)) throw new BadRequestException('Canal de communication invalide');
      const recipient =
        target === 'TECHNICIAN'
          ? communicationChannel === 'EMAIL'
            ? request.technician_email
            : request.technician_phone
          : communicationChannel === 'EMAIL'
            ? request.tenant_email
            : request.tenant_phone;
      if (!recipient) throw new BadRequestException(target === 'TECHNICIAN' ? 'Coordonnee technicien absente' : 'Coordonnee locataire absente');
      const message = body.message ? String(body.message) : this.defaultMaintenanceMessage(communicationChannel, request, String(body.event ?? 'UPDATE'));
      const result = await this.sendCommunication(communicationChannel, {
        recipient,
        subject: communicationChannel === 'EMAIL' ? `${request.request_number} - ${request.title}` : undefined,
        message,
        related_entity_type: 'maintenance_request',
        related_entity_id: id,
      });
      await this.addMaintenanceTimeline(client, id, 'COMMUNICATION', `Communication ${communicationChannel}`, `${target === 'TECHNICIAN' ? 'Technicien' : 'Locataire'} contacte`);
      return result;
    });
  }

  private async assertMaintenanceStatus(client: PoolClient, id: number, allowed: string[]) {
    const current = await client.query(
      `SELECT status FROM maintenance_requests
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [id, this.context.organizationId()],
    );
    const request = requireRow(current.rows[0], 'Maintenance request');
    if (!allowed.includes(String(request.status))) {
      throw new BadRequestException(`Action impossible pour une maintenance au statut ${request.status}`);
    }
    return request;
  }

  private async notifyMaintenanceResolution(client: PoolClient, id: number, event: 'RESOLVED' | 'CLOSED', comment?: string) {
    const request = await this.getMaintenanceCommunicationContext(client, id);
    const jobs: Array<Promise<unknown>> = [];
    if (request.tenant_email) {
      jobs.push(this.sendCommunication('EMAIL', {
        recipient: request.tenant_email,
        subject: `${request.request_number} - ${event === 'RESOLVED' ? 'Intervention resolue' : 'Intervention cloturee'}`,
        message: this.defaultMaintenanceMessage('EMAIL', request, event, comment),
        related_entity_type: 'maintenance_request',
        related_entity_id: id,
      }));
    }
    if (request.tenant_phone) {
      for (const channel of ['SMS', 'WHATSAPP']) {
        jobs.push(this.sendCommunication(channel, {
          recipient: request.tenant_phone,
          message: this.defaultMaintenanceMessage(channel, request, event, comment),
          related_entity_type: 'maintenance_request',
          related_entity_id: id,
        }));
      }
    }
    await Promise.all(jobs);
  }

  private async getMaintenanceCommunicationContext(client: PoolClient, id: number) {
    const { rows } = await client.query(
      `SELECT mr.id, mr.request_number, mr.title, mr.priority, mr.status, mr.due_date, mr.resolved_at,
              b.name AS building_name, u.number AS unit_number,
              CONCAT(t.first_name, ' ', t.last_name) AS tenant_name, t.email AS tenant_email, t.phone AS tenant_phone,
              CONCAT(e.first_name, ' ', e.last_name) AS technician_name, e.email AS technician_email, e.phone AS technician_phone
       FROM maintenance_requests mr
       LEFT JOIN buildings b ON b.id = mr.building_id
       LEFT JOIN units u ON u.id = mr.unit_id
       LEFT JOIN tenants t ON t.id = mr.tenant_id
       LEFT JOIN employees e ON e.id = mr.assigned_employee_id
       WHERE mr.id = $1 AND mr.organization_id = $2 AND mr.deleted_at IS NULL`,
      [id, this.context.organizationId()],
    );
    return requireRow(rows[0], 'Maintenance request');
  }

  private defaultMaintenanceMessage(channel: string, request: Record<string, unknown>, event: string, comment?: string) {
    const fragments = [
      `${request.request_number} - ${request.title}`,
      request.building_name ? `Immeuble: ${request.building_name}` : null,
      request.unit_number ? `Unite: ${request.unit_number}` : null,
      `Priorite: ${request.priority}`,
      `Statut: ${request.status}`,
      request.technician_name ? `Technicien: ${request.technician_name}` : null,
      event === 'RESOLVED'
        ? `Date resolution: ${request.resolved_at ? String(request.resolved_at).slice(0, 10) : new Date().toISOString().slice(0, 10)}`
        : request.due_date
          ? `Date prevue: ${String(request.due_date).slice(0, 10)}`
          : null,
      comment ? `Commentaire: ${comment}` : null,
    ].filter(Boolean);
    return channel === 'EMAIL' ? `Bonjour,\n${fragments.join('\n')}` : fragments.join(' | ');
  }

  private async createWorkflowInstanceInTransaction(client: PoolClient, body: Record<string, unknown>) {
    const type = String(body.type ?? 'CUSTOM');
    const definition = await client.query(
      `SELECT * FROM workflow_definitions
       WHERE type = $1 AND organization_id = $2 AND deleted_at IS NULL
       ORDER BY id LIMIT 1`,
      [type, this.context.organizationId()],
    );
    const definitionId = definition.rows[0]?.id ?? null;
    const { rows } = await client.query(
      `INSERT INTO workflow_instances
       (workflow_definition_id, type, entity_type, entity_id, title, requester_id, status, comment, organization_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7, $8)
       RETURNING *`,
      [
        definitionId,
        type,
        body.entity_type ?? type,
        body.entity_id ?? null,
        body.title ?? `${type} #${body.entity_id ?? ''}`,
        this.context.userId() ?? body.requester_id ?? null,
        body.comment ?? null,
        this.context.organizationId(),
      ],
    );
    const steps = await client.query(
      `SELECT * FROM workflow_step_definitions
       WHERE workflow_definition_id = $1 AND organization_id = $2 AND deleted_at IS NULL
       ORDER BY step_order`,
      [definitionId, this.context.organizationId()],
    );
    const stepRows = steps.rows.length ? steps.rows : [{ step_order: 1, name: 'Validation', approver_role: 'DIRECTOR', approver_user_id: null }];
    for (const step of stepRows) {
      await client.query(
        `INSERT INTO workflow_steps
         (workflow_instance_id, step_order, name, approver_role, approver_user_id, organization_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [rows[0].id, step.step_order, step.name, step.approver_role, step.approver_user_id, this.context.organizationId()],
      );
    }
    await this.addWorkflowAction(client, rows[0].id, 'CREATED', body.comment ? String(body.comment) : 'Workflow crÃƒÂ©ÃƒÂ©');
    return rows[0];
  }

  private async addWorkflowAction(client: PoolClient, workflowInstanceId: number, action: string, comment?: string) {
    await client.query(
      `INSERT INTO workflow_actions (workflow_instance_id, action, comment, acted_by, organization_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [workflowInstanceId, action, comment ?? null, this.context.userId() ?? 1, this.context.organizationId()],
    );
  }

  private async ensureWorkflowStepCanAct(client: PoolClient, workflowInstanceId: number) {
    const { rows } = await client.query(
      `SELECT ws.*
       FROM workflow_steps ws
       JOIN workflow_instances wi ON wi.id = ws.workflow_instance_id
       WHERE ws.workflow_instance_id = $1 AND ws.organization_id = $2 AND wi.status = 'PENDING' AND ws.status = 'PENDING'
       LIMIT 1`,
      [workflowInstanceId, this.context.organizationId()],
    );
    const step = requireRow(rows[0], 'Workflow step');
    if (step.approver_user_id && Number(step.approver_user_id) !== this.context.userId()) throw new BadRequestException('Vous ne pouvez pas valider cette ÃƒÂ©tape');
    if (step.approver_role && step.approver_role !== this.context.user()?.role) throw new BadRequestException('RÃƒÂ´le approbateur requis');
  }

  private async ensureWorkflowApproved(client: PoolClient, workflowInstanceId?: unknown) {
    if (!workflowInstanceId) return;
    const { rows } = await client.query(
      `SELECT status FROM workflow_instances WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [workflowInstanceId, this.context.organizationId()],
    );
    const workflow = requireRow(rows[0], 'Workflow');
    if (workflow.status === 'REJECTED') throw new BadRequestException('Workflow rejetÃƒÂ©: action bloquÃƒÂ©e');
    if (workflow.status !== 'APPROVED') throw new BadRequestException('Workflow en attente: action bloquÃƒÂ©e');
  }

  private async addMaintenanceTimeline(client: PoolClient, maintenanceRequestId: number, eventType: string, title: string, details?: string) {
    await client.query(
      `INSERT INTO maintenance_timeline (maintenance_request_id, event_type, title, details, created_by, organization_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [maintenanceRequestId, eventType, title, details ?? null, this.context.userId() ?? 1, this.context.organizationId()],
    );
  }

  private async openSession(client: PoolClient) {
    const { rows } = await client.query(`SELECT * FROM cash_sessions WHERE status = 'OPEN' AND organization_id = $1 AND deleted_at IS NULL ORDER BY opened_at DESC LIMIT 1`, [
      this.context.organizationId(),
    ]);
    if (!rows[0]) throw new BadRequestException('Aucune caisse ouverte');
    return rows[0];
  }

  private async ensureNoLeaseConflict(client: PoolClient, unitId: number, startDate: string, endDate: string | null, ignoredLeaseId?: number) {
    const { rows } = await client.query(
      `SELECT id FROM leases
       WHERE unit_id = $1
         AND organization_id = $2
         AND deleted_at IS NULL
         AND status = 'ACTIVE'
         AND ($5::INT IS NULL OR id <> $5)
         AND daterange(start_date, COALESCE(end_date, '2999-12-31'::DATE), '[]')
             && daterange($3::DATE, COALESCE($4::DATE, '2999-12-31'::DATE), '[]')
       LIMIT 1`,
      [unitId, this.context.organizationId(), startDate, endDate, ignoredLeaseId ?? null],
    );
    if (rows[0]) throw new BadRequestException('Un bail actif existe dÃƒÂ©jÃƒÂ  sur cette unitÃƒÂ© pour cette pÃƒÂ©riode');
  }

  private async activateLeaseInTransaction(client: PoolClient, id: number) {
    const lease = await client.query(
      `SELECT * FROM leases WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [id, this.context.organizationId()],
    );
    const row = requireRow(lease.rows[0], 'Lease');
    await this.ensureNoLeaseConflict(client, Number(row.unit_id), row.start_date, row.end_date, id);
    const { rows } = await client.query(
      `UPDATE leases
       SET status = 'ACTIVE', activated_at = COALESCE(activated_at, NOW()), updated_at = NOW()
       WHERE id = $1 AND organization_id = $2 RETURNING *`,
      [id, this.context.organizationId()],
    );
    await client.query('UPDATE units SET status = $1 WHERE id = $2 AND organization_id = $3 AND deleted_at IS NULL', [
      'OCCUPIED',
      row.unit_id,
      this.context.organizationId(),
    ]);
    return rows[0];
  }

  private async upsertLeaseGuarantee(client: PoolClient, leaseId: number, guarantee: Record<string, unknown>) {
    const amount = Number(guarantee.amount ?? 0);
    const paidAmount = Number(guarantee.paid_amount ?? 0);
    const status = String(guarantee.status ?? (paidAmount >= amount && amount > 0 ? 'PAID' : paidAmount > 0 ? 'PARTIAL' : 'NOT_PAID'));
    await client.query(
      `INSERT INTO lease_guarantees (lease_id, amount, paid_amount, payment_date, status, organization_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (lease_id) DO UPDATE SET
         amount = EXCLUDED.amount,
         paid_amount = EXCLUDED.paid_amount,
         payment_date = EXCLUDED.payment_date,
         status = EXCLUDED.status,
         updated_at = NOW()`,
      [leaseId, amount, paidAmount, guarantee.payment_date ?? null, status, this.context.organizationId()],
    );
    await client.query(
      `UPDATE leases
       SET rental_guarantee_amount = $2,
           rental_guarantee_paid = $3,
           rental_guarantee_payment_date = $4,
           rental_guarantee_status = $5,
           updated_at = NOW()
       WHERE id = $1 AND organization_id = $6`,
      [leaseId, amount, paidAmount, guarantee.payment_date ?? null, status, this.context.organizationId()],
    );
  }

  private async leaseGuaranteeInTransaction(client: PoolClient, leaseId: number) {
    const { rows } = await client.query(
      `SELECT * FROM lease_guarantees WHERE lease_id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [leaseId, this.context.organizationId()],
    );
    return rows[0] ?? null;
  }

  private async nextStockPurchaseNumber(client: PoolClient) {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`stock-purchase-${this.context.organizationId()}`]);
    const { rows } = await client.query(
      `SELECT COALESCE(MAX(NULLIF(regexp_replace(purchase_number, '[^0-9]', '', 'g'), '')::INT), 0) + 1 AS value
       FROM stock_purchases
       WHERE organization_id = $1`,
      [this.context.organizationId()],
    );
    return `PO-${String(rows[0]?.value ?? 1).padStart(6, '0')}`;
  }

  private async nextStockReceiptNumber(client: PoolClient) {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`stock-receipt-${this.context.organizationId()}`]);
    const { rows } = await client.query(
      `SELECT COALESCE(MAX(NULLIF(regexp_replace(receipt_number, '[^0-9]', '', 'g'), '')::INT), 0) + 1 AS value
       FROM stock_purchase_receipts
       WHERE organization_id = $1`,
      [this.context.organizationId()],
    );
    return `BR-${String(rows[0]?.value ?? 1).padStart(6, '0')}`;
  }

  private async normalizeStockPurchaseLines(client: PoolClient, lines: Array<Record<string, unknown>>) {
    const normalized: Array<Record<string, unknown>> = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const stockItemId = Number(line.stock_item_id ?? 0);
      const quantity = Number(line.quantity ?? 0);
      const unitPrice = Number(line.unit_price ?? 0);
      if (!stockItemId || quantity <= 0) throw new BadRequestException(`Ligne ${index + 1}: article ou quantite invalide`);
      const item = await client.query(
        `SELECT id, name, status FROM stock_items WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
        [stockItemId, this.context.organizationId()],
      );
      const itemRow = requireRow(item.rows[0], `Article ligne ${index + 1}`);
      if (itemRow.status !== 'ACTIVE') throw new BadRequestException(`Ligne ${index + 1}: article inactif`);
      normalized.push({
        stock_item_id: stockItemId,
        quantity,
        unit_price: unitPrice,
        line_total: quantity * unitPrice,
      });
    }
    return normalized;
  }

  private async refreshStockPurchaseStatus(client: PoolClient, purchaseId: number) {
    const lines = await client.query(
      `SELECT quantity, received_quantity FROM stock_purchase_lines
       WHERE stock_purchase_id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [purchaseId, this.context.organizationId()],
    );
    const purchase = await client.query(
      `SELECT total_amount, paid_amount FROM stock_purchases
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [purchaseId, this.context.organizationId()],
    );
    const purchaseRow = requireRow(purchase.rows[0], 'Stock purchase');
    const totalOrdered = lines.rows.reduce((sum, line) => sum + Number(line.quantity ?? 0), 0);
    const totalReceived = lines.rows.reduce((sum, line) => sum + Number(line.received_quantity ?? 0), 0);
    const receptionStatus = totalReceived <= 0 ? 'PENDING' : totalReceived >= totalOrdered ? 'RECEIVED' : 'PARTIAL';
    const outstandingAmount = Math.max(Number(purchaseRow.total_amount ?? 0) - Number(purchaseRow.paid_amount ?? 0), 0);
    const paymentStatus = outstandingAmount <= 0 && Number(purchaseRow.total_amount ?? 0) > 0 ? 'PAID' : Number(purchaseRow.paid_amount ?? 0) > 0 ? 'PARTIAL' : 'UNPAID';
    const purchaseStatus = receptionStatus === 'RECEIVED' && paymentStatus === 'PAID' ? 'CLOSED' : 'OPEN';
    const { rows } = await client.query(
      `UPDATE stock_purchases
       SET reception_status = $2,
           payment_status = $3,
           outstanding_amount = $4,
           purchase_status = $5,
           updated_at = NOW()
       WHERE id = $1 AND organization_id = $6
       RETURNING *`,
      [purchaseId, receptionStatus, paymentStatus, outstandingAmount, purchaseStatus, this.context.organizationId()],
    );
    return rows[0];
  }

  private async addStockPurchaseTimeline(client: PoolClient, purchaseId: number, eventType: string, title: string, details?: string) {
    await client.query(
      `INSERT INTO stock_purchase_timeline
       (stock_purchase_id, event_type, title, details, created_by, organization_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [purchaseId, eventType, title, details ?? null, this.context.userId() ?? 1, this.context.organizationId()],
    );
  }

  private async recordStockPurchasePaymentInTransaction(
    client: PoolClient,
    purchaseId: number,
    body: Record<string, unknown>,
    refreshStatus = true,
  ) {
    const purchase = await client.query(
      `SELECT * FROM stock_purchases
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
       FOR UPDATE`,
      [purchaseId, this.context.organizationId()],
    );
    const purchaseRow = requireRow(purchase.rows[0], 'Stock purchase');
    const amount = Number(body.amount ?? 0);
    if (amount <= 0) throw new BadRequestException('Le montant du paiement fournisseur doit etre positif');
    const outstanding = Math.max(Number(purchaseRow.total_amount ?? 0) - Number(purchaseRow.paid_amount ?? 0), 0);
    if (amount > outstanding) throw new BadRequestException(`Le paiement depasse le solde restant (${outstanding.toFixed(2)} USD)`);
    const cashMovement = await this.createCashMovementInTransaction(client, {
      type: 'OUT',
      category: 'STOCK_PURCHASE',
      amount,
      movement_date: body.payment_date ?? new Date().toISOString().slice(0, 10),
      supplier: purchaseRow.supplier_name,
      description: body.notes ?? `Paiement fournisseur ${purchaseRow.purchase_number}`,
      label: `Achat stock ${purchaseRow.purchase_number}`,
      reference: body.reference ?? purchaseRow.purchase_number,
      stock_purchase_id: purchaseId,
    });
    const { rows } = await client.query(
      `INSERT INTO stock_purchase_payments
       (stock_purchase_id, payment_date, amount, payment_method, reference, notes, cash_movement_id, created_by, organization_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        purchaseId,
        body.payment_date ?? new Date().toISOString().slice(0, 10),
        amount,
        body.payment_method ?? purchaseRow.payment_method ?? null,
        body.reference ?? purchaseRow.purchase_number,
        body.notes ?? null,
        cashMovement.id,
        this.context.userId() ?? 1,
        this.context.organizationId(),
      ],
    );
    await client.query(
      `UPDATE stock_purchases
       SET paid_amount = paid_amount + $2,
           updated_at = NOW()
       WHERE id = $1 AND organization_id = $3`,
      [purchaseId, amount, this.context.organizationId()],
    );
    if (refreshStatus) {
      await this.refreshStockPurchaseStatus(client, purchaseId);
    } else {
      const paidAmount = Number(purchaseRow.paid_amount ?? 0) + amount;
      const outstandingAmount = Math.max(Number(purchaseRow.total_amount ?? 0) - paidAmount, 0);
      const paymentStatus = outstandingAmount <= 0 && Number(purchaseRow.total_amount ?? 0) > 0 ? 'PAID' : paidAmount > 0 ? 'PARTIAL' : 'UNPAID';
      await client.query(
        `UPDATE stock_purchases
         SET payment_status = $2, outstanding_amount = $3, updated_at = NOW()
         WHERE id = $1 AND organization_id = $4`,
        [purchaseId, paymentStatus, outstandingAmount, this.context.organizationId()],
      );
    }
    return { ...rows[0], cash_movement_id: cashMovement.id };
  }

  private normalizeVariables(value: unknown) {
    if (Array.isArray(value)) return JSON.stringify(value);
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return JSON.stringify(Array.isArray(parsed) ? parsed : []);
      } catch {
        return JSON.stringify(value.split(',').map((item) => item.trim()).filter(Boolean));
      }
    }
    return JSON.stringify([]);
  }

  private objectValue(value: unknown) {
    if (!value) return {};
    if (typeof value === 'string') {
      try {
        return JSON.parse(value) as Record<string, unknown>;
      } catch {
        return {};
      }
    }
    if (typeof value === 'object') return value as Record<string, unknown>;
    return {};
  }

  private logTableFor(channel: string) {
    const key = channel.toUpperCase();
    if (key === 'EMAIL') return 'email_logs';
    if (key === 'SMS') return 'sms_logs';
    if (key === 'WHATSAPP') return 'whatsapp_logs';
    throw new BadRequestException('Canal non supporte');
  }

  private async activeTemplate(code: string, channel: string) {
    const { rows } = await this.db.query(
      `SELECT * FROM message_templates
       WHERE organization_id = $1 AND deleted_at IS NULL AND status = 'ACTIVE' AND code = $2 AND channel = $3`,
      [this.context.organizationId(), code, channel.toUpperCase()],
    );
    return requireRow(rows[0], 'Message template');
  }

  private renderTemplate(template: string, variables: Record<string, unknown>) {
    return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => String(variables[key] ?? ''));
  }

  private normalizeLeasePayload(body: Record<string, unknown>) {
    const tenantId = Number(body.tenant_id ?? body.tenantId ?? 0);
    const unitId = Number(body.unit_id ?? body.unitId ?? 0);
    const startDate = String(body.start_date ?? '').trim();
    const endDateValue = String(body.end_date ?? '').trim();
    if (!tenantId) throw new BadRequestException('Locataire requis');
    if (!unitId) throw new BadRequestException('Unite requise');
    if (!startDate) throw new BadRequestException('Date de debut requise');

    const monthlyRent = Number(body.monthly_rent ?? 0);
    const maintenanceFeeAmount = Number(body.maintenance_fee_amount ?? 0);
    const monthlySyndicAmount = Number(body.monthly_syndic_amount ?? 0);
    const otherChargesAmount = Number(body.other_charges_amount ?? 0);
    const guaranteeMonths = Number(body.guarantee_months ?? 0);
    const leaseTotalAmount = Number(body.lease_total_amount ?? (monthlyRent + maintenanceFeeAmount + monthlySyndicAmount + otherChargesAmount));
    const guaranteeAmount = Number(body.rental_guarantee_amount ?? body.guarantee_amount ?? (leaseTotalAmount * guaranteeMonths));
    const guaranteePaid = Number(body.rental_guarantee_paid ?? body.guarantee_paid ?? 0);

    return {
      tenantId,
      unitId,
      startDate,
      endDate: endDateValue || null,
      monthlyRent,
      maintenanceFeeAmount,
      monthlySyndicAmount,
      otherChargesAmount,
      leaseTotalAmount,
      guaranteeMonths,
      guaranteeAmount,
      guaranteePaid,
      guaranteePaymentDate: body.rental_guarantee_payment_date ?? body.guarantee_payment_date ?? null,
      guaranteeStatus: String(body.rental_guarantee_status ?? body.guarantee_status ?? (guaranteePaid <= 0 ? 'NOT_PAID' : guaranteePaid >= guaranteeAmount ? 'PAID' : 'PARTIAL')),
      noticeMonths: Number(body.notice_months ?? 0),
      signaturePlace: body.signature_place ? String(body.signature_place).trim() : null,
      signatureDate: body.signature_date ? String(body.signature_date).trim() : null,
      leaseUsage: body.lease_usage ? String(body.lease_usage).trim() : null,
      contractTemplateCode: body.contract_template_code ? String(body.contract_template_code).trim() : 'LEASE_RESIDENTIAL',
      contractFileName: body.contract_file_name ? String(body.contract_file_name).trim() : null,
      contractFileUrl: body.contract_file_url ? String(body.contract_file_url).trim() : null,
      notes: body.notes ? String(body.notes) : null,
      status: String(body.status ?? 'DRAFT'),
    };
  }

  private async activeLeaseContractTemplate(client: PoolClient, code: string) {
    const { rows } = await client.query(
      `SELECT *
       FROM lease_contract_templates
       WHERE organization_id = $1
         AND code = $2
         AND is_active = TRUE
         AND deleted_at IS NULL
       ORDER BY version DESC, id DESC
       LIMIT 1`,
      [this.context.organizationId(), code],
    );
    return requireRow(rows[0], 'Lease contract template');
  }

  private buildLeaseContractSnapshot(lease: Record<string, any>, company: Record<string, any>) {
    const totalMonthly = Number(lease.lease_total_amount ?? 0);
    const guaranteeMonths = Number(lease.guarantee_months ?? company.default_guarantee_months ?? 0);
    const guaranteeAmount = Number(lease.rental_guarantee_amount ?? lease.guarantee?.amount ?? 0);
    const durationMonths = this.leaseDurationMonths(lease.start_date, lease.end_date) || Number(company.default_lease_duration_months ?? 0);
    const isCompanyTenant = String(lease.tenant_type ?? 'PHYSICAL') === 'COMPANY';
    const lessorName = company.company_legal_name ?? company.legal_name ?? company.company_name ?? 'NG Property ERP';
    const representativeFullName = [company.legal_representative_name].filter(Boolean).join(' ').trim();
    const tenantRepresentative = [
      lease.legal_representative_name,
      lease.representative_post_name,
      lease.representative_first_name,
    ].filter(Boolean).join(' ').trim();
    const tenantFullName = [lease.first_name, lease.last_name, lease.post_name].filter(Boolean).join(' ').trim();
    const buildingAddressParts = [lease.building_address, lease.building_commune, lease.building_neighborhood, lease.building_city].filter(Boolean);
    const physicalPresentation = [
      `Monsieur/Madame ${tenantFullName || lease.tenant_name}`,
      lease.id_document_type ? `titulaire de la piece d'identite ${lease.id_document_type}` : null,
      lease.id_number ? `numero ${lease.id_number}` : null,
      lease.tenant_address ? `domicilie(e) a ${lease.tenant_address}` : null,
      lease.tenant_commune ? `commune ${lease.tenant_commune}` : null,
      lease.tenant_city ? `ville ${lease.tenant_city}` : null,
      lease.tenant_country ? `pays ${lease.tenant_country}` : null,
    ].filter(Boolean).join(', ');
    const companyPresentation = [
      lease.company_name,
      lease.legal_form ? `${lease.legal_form}` : null,
      lease.rccm ? `immatriculee au RCCM sous le numero ${lease.rccm}` : null,
      lease.national_id_number ? `identification nationale ${lease.national_id_number}` : null,
      lease.tax_number ? `numero fiscal ${lease.tax_number}` : null,
      lease.tenant_address ? `siege social etabli a ${lease.tenant_address}` : null,
      tenantRepresentative ? `representee par ${tenantRepresentative}` : null,
      lease.legal_representative_role ? `agissant en qualite de ${lease.legal_representative_role}` : null,
    ].filter(Boolean).join(', ');
    const apartmentLabel = lease.is_furnished ? 'Appartement Meuble' : 'Appartement Non Meuble';
    const signatureDate = this.formatDate(lease.signature_date ?? new Date().toISOString().slice(0, 10));
    const leaseStartDate = this.formatDate(lease.start_date);
    const leaseEndDate = this.formatDate(lease.end_date) || this.formatDate(new Date().toISOString().slice(0, 10));

    return {
      LANDLORD_NAME: lessorName,
      LANDLORD_ACRONYM: company.company_acronym ?? '',
      LANDLORD_LEGAL_FORM: company.company_legal_form ?? '',
      LANDLORD_RCCM: company.company_rccm ?? '',
      LANDLORD_NATIONAL_ID: company.company_national_id ?? '',
      LANDLORD_TAX_ID: company.company_tax_id ?? '',
      LANDLORD_ADDRESS: company.company_address ?? company.address ?? '',
      LANDLORD_COMMUNE: company.company_commune ?? '',
      LANDLORD_CITY: company.company_city ?? '',
      LANDLORD_COUNTRY: company.company_country ?? '',
      LANDLORD_REPRESENTATIVE_NAME: representativeFullName,
      LANDLORD_REPRESENTATIVE_TITLE: company.legal_representative_title ?? '',
      LANDLORD_PRESENTATION: [
        lessorName,
        company.company_legal_form ? `${company.company_legal_form}` : null,
        company.company_rccm ? `RCCM ${company.company_rccm}` : null,
        company.company_national_id ? `ID Nat ${company.company_national_id}` : null,
        (company.company_address ?? company.address) ? `adresse ${company.company_address ?? company.address}` : null,
        representativeFullName ? `representee par ${representativeFullName}` : null,
        company.legal_representative_title ? `en qualite de ${company.legal_representative_title}` : null,
      ].filter(Boolean).join(', '),
      TENANT_NAME: isCompanyTenant ? (lease.company_name ?? lease.tenant_name) : (tenantFullName || lease.tenant_name),
      TENANT_LEGAL_FORM: lease.legal_form ?? '',
      TENANT_RCCM: lease.rccm ?? '',
      TENANT_ID: lease.national_id_number ?? lease.id_number ?? '',
      TENANT_ADDRESS: lease.tenant_address ?? '',
      TENANT_COMMUNE: lease.tenant_commune ?? '',
      TENANT_CITY: lease.tenant_city ?? '',
      TENANT_COUNTRY: lease.tenant_country ?? '',
      TENANT_REPRESENTATIVE_NAME: tenantRepresentative,
      TENANT_REPRESENTATIVE_TITLE: lease.legal_representative_role ?? '',
      TENANT_PRESENTATION: isCompanyTenant ? companyPresentation : physicalPresentation,
      BUILDING_NAME: lease.building_name ?? '',
      BUILDING_ADDRESS: lease.building_address ?? '',
      BUILDING_COMMUNE: lease.building_commune ?? '',
      BUILDING_NEIGHBORHOOD: lease.building_neighborhood ?? '',
      BUILDING_CITY: lease.building_city ?? '',
      UNIT_NUMBER: lease.unit_number ?? '',
      APARTMENT_LABEL: apartmentLabel,
      START_DATE: leaseStartDate,
      END_DATE: leaseEndDate,
      MONTHLY_RENT: this.formatMoney(lease.monthly_rent),
      MAINTENANCE_AMOUNT: this.formatMoney(lease.maintenance_fee_amount),
      SYNDIC_AMOUNT: this.formatMoney(lease.monthly_syndic_amount),
      OTHER_CHARGES_AMOUNT: this.formatMoney(lease.other_charges_amount),
      MONTHLY_TOTAL: this.formatMoney(totalMonthly),
      GUARANTEE_MONTHS: String(guaranteeMonths),
      GUARANTEE_TOTAL: this.formatMoney(guaranteeAmount),
      SIGNATURE_PLACE: lease.signature_place ?? company.default_signature_place ?? company.company_city ?? 'Kinshasa',
      SIGNATURE_DATE: signatureDate,
      bailleur: {
        raison_sociale: lessorName,
        sigle: company.company_acronym ?? '',
        rccm: company.company_rccm ?? '',
        identification_nationale: company.company_national_id ?? '',
        numero_fiscal: company.company_tax_id ?? '',
        adresse: company.company_address ?? company.address ?? '',
        commune: company.company_commune ?? '',
        ville: company.company_city ?? '',
        pays: company.company_country ?? '',
        representant_nom: representativeFullName,
        representant_fonction: company.legal_representative_title ?? '',
        signature_nom: representativeFullName || lessorName,
        presentation: [
          lessorName,
          company.company_legal_form ? `${company.company_legal_form}` : null,
          company.company_rccm ? `RCCM ${company.company_rccm}` : null,
          company.company_national_id ? `ID Nat ${company.company_national_id}` : null,
          (company.company_address ?? company.address) ? `adresse ${company.company_address ?? company.address}` : null,
          representativeFullName ? `representee par ${representativeFullName}` : null,
          company.legal_representative_title ? `en qualite de ${company.legal_representative_title}` : null,
        ].filter(Boolean).join(', '),
      },
      locataire: {
        type: isCompanyTenant ? 'PERSONNE_MORALE' : 'PERSONNE_PHYSIQUE',
        nom_complet: tenantFullName || lease.tenant_name,
        raison_sociale: lease.company_name ?? '',
        forme_juridique: lease.legal_form ?? '',
        rccm: lease.rccm ?? '',
        identification_nationale: lease.national_id_number ?? '',
        numero_piece_identite: lease.id_number ?? '',
        adresse: lease.tenant_address ?? '',
        commune: lease.tenant_commune ?? '',
        ville: lease.tenant_city ?? '',
        pays: lease.tenant_country ?? '',
        representant_nom_complet: tenantRepresentative,
        representant_fonction: lease.legal_representative_role ?? '',
        signature_nom: isCompanyTenant ? (lease.company_name ?? lease.tenant_name) : (tenantFullName || lease.tenant_name),
        presentation: isCompanyTenant ? companyPresentation : physicalPresentation,
      },
      bien: {
        numero_unite: lease.unit_number ?? '',
        immeuble: lease.building_name ?? '',
        adresse: lease.building_address ?? '',
        commune: lease.building_commune ?? '',
        quartier: lease.building_neighborhood ?? '',
        ville: lease.building_city ?? '',
        nombre_chambres: String(lease.bedrooms_count ?? 0),
        nombre_parkings: String(lease.parking_spaces_count ?? (lease.has_parking ? 1 : 0)),
        meuble_label: lease.is_furnished ? 'Meuble' : 'Non meuble',
        appartement_label: apartmentLabel,
        usage: lease.usage_type ?? lease.lease_usage ?? company.default_lease_usage ?? 'residentiel',
        adresse_complete: buildingAddressParts.join(', '),
        description_detail: [
          `l'unite ${lease.unit_number ?? ''}`.trim(),
          lease.surface_area ? `${lease.surface_area} m2` : null,
          lease.bedrooms_count ? `${lease.bedrooms_count} chambre(s)` : null,
          String(lease.parking_spaces_count ?? (lease.has_parking ? 1 : 0)) !== '0'
            ? `${lease.parking_spaces_count ?? 1} parking(s)`
            : null,
          lease.is_furnished ? 'meublee' : 'non meublee',
        ].filter(Boolean).join(', '),
      },
      bail: {
        date_debut: leaseStartDate,
        date_fin: leaseEndDate,
        duree_texte: durationMonths > 0 ? `${durationMonths} mois` : 'duree en cours',
        preavis_mois: String(lease.notice_months ?? company.default_notice_months ?? 0),
        loyer_base: this.formatMoney(lease.monthly_rent),
        frais_entretien: this.formatMoney(lease.maintenance_fee_amount),
        frais_syndic: this.formatMoney(lease.monthly_syndic_amount),
        autres_charges: this.formatMoney(lease.other_charges_amount),
        loyer_total: this.formatMoney(totalMonthly),
        garantie_nombre_mois: String(guaranteeMonths),
        garantie_montant: this.formatMoney(guaranteeAmount),
        devise: 'USD',
        lieu_signature: lease.signature_place ?? company.default_signature_place ?? company.company_city ?? 'Kinshasa',
        date_signature: signatureDate,
        usage_label: lease.lease_usage ?? company.default_lease_usage ?? lease.usage_type ?? 'residentiel',
        type_contrat: lease.contract_template_code ?? company.default_contract_template_code ?? 'LEASE_RESIDENTIAL',
      },
    };
  }

  private leaseDurationMonths(startValue?: string, endValue?: string | null) {
    if (!startValue) return 0;
    const start = new Date(startValue);
    const end = new Date(endValue ?? new Date().toISOString().slice(0, 10));
    const months = (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth();
    return Math.max(months, 0);
  }

  private formatMoney(value: unknown) {
    return Number(value ?? 0).toLocaleString('fr-FR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  private formatDate(value?: string | null) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString('fr-FR');
  }

  private slugify(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80) || 'document';
  }

  private leaseReferenceCode(id: number) {
    return `B-${String(id).padStart(6, '0')}`;
  }

  private async createDefaultCompanySettings() {
    const { rows } = await this.db.query(
      `INSERT INTO company_settings (
         organization_id, company_name, legal_name, company_legal_name, address, company_address, company_city, company_country,
         currency, language, timezone, invoice_footer, invoice_bottom_text,
         default_lease_duration_months, default_notice_months, default_guarantee_months,
         default_signature_place, default_lease_usage, default_contract_template_code, created_by
       )
       VALUES (
         $1, 'Demo Property ERP', 'Demo Property ERP', 'Demo Property ERP', '22 Avenue des Écuries', '22 Avenue des Écuries', 'Kinshasa', 'RDC',
         'USD', 'fr', 'Africa/Kinshasa', 'Merci pour votre confiance.', 'Facture generee par Property ERP.',
         12, 1, 3, 'Kinshasa', 'RESIDENTIAL', 'LEASE_RESIDENTIAL', $2
       )
       ON CONFLICT (organization_id) DO UPDATE SET organization_id = EXCLUDED.organization_id
       RETURNING *`,
      [this.context.organizationId(), this.context.userId() ?? 1],
    );
    return rows[0];
  }

  private async companySettingsRaw() {
    const { rows } = await this.db.query(
      `SELECT *
       FROM company_settings
       WHERE organization_id = $1 AND deleted_at IS NULL`,
      [this.context.organizationId()],
    );
    return rows[0] ?? null;
  }

  private companySettingsRow(row: Record<string, any>) {
    return {
      ...row,
      logo_file_name: row.logo_file_name ?? this.legacyFileName(row.logo_url),
      logo_file_url: row.logo_file_url ?? row.logo_url ?? (row.logo_file_name ? this.companyFileRoute('logo') : null),
      signature_file_name: row.signature_file_name ?? this.legacyFileName(row.signature_url),
      signature_file_url:
        row.signature_file_url ?? row.signature_url ?? (row.signature_file_name ? this.companyFileRoute('signature') : null),
      stamp_file_name: row.stamp_file_name ?? this.legacyFileName(row.stamp_url),
      stamp_file_url: row.stamp_file_url ?? row.stamp_url ?? (row.stamp_file_name ? this.companyFileRoute('stamp') : null),
      logo_url: row.logo_url ?? row.logo_file_url ?? null,
      signature_url: row.signature_url ?? row.signature_file_url ?? null,
      stamp_url: row.stamp_url ?? row.stamp_file_url ?? null,
      company_legal_name_resolved: row.company_legal_name ?? row.legal_name ?? row.company_name ?? '',
      company_address_resolved: row.company_address ?? row.address ?? '',
    };
  }

  private normalizeCompanyFileKind(kind: string) {
    const normalized = String(kind ?? '').trim().toLowerCase();
    if (!this.allowedCompanyFileKinds.has(normalized)) {
      throw new BadRequestException('Type de fichier invalide');
    }
    return normalized;
  }

  private companyFileRoute(kind: string) {
    return `/api/settings/company-files/${kind}`;
  }

  private companyStoragePath(kind: string, fileName: string) {
    return `company/${this.context.organizationId()}/${kind}/${this.sanitizeStorageFileName(fileName)}`;
  }

  private sanitizeStorageFileName(fileName: string) {
    const base = String(fileName ?? '').replace(/[\\/]/g, '_').trim();
    return base.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_.-]/g, '_') || 'file';
  }

  private originalFileName(fileName: string) {
    const trimmed = String(fileName ?? '').trim();
    return trimmed || 'file';
  }

  private legacyFileName(value: unknown) {
    if (!value) return null;
    const text = String(value).trim();
    if (!text) return null;
    const last = text.split('?')[0].split('/').pop()?.trim();
    return last || null;
  }

  private storageConfig() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      throw new BadRequestException('Configuration Supabase manquante');
    }
    return {
      supabaseUrl: supabaseUrl.replace(/\/$/, ''),
      serviceRoleKey,
    };
  }

  private validateCompanyFile(file: { mimetype: string; size: number }) {
    if (file.size > 5 * 1024 * 1024) {
      throw new BadRequestException('Le fichier ne peut pas depasser 5 Mo');
    }
    const mimeType = String(file.mimetype ?? '').toLowerCase();
    if (!this.allowedCompanyFileMimeTypes.has(mimeType)) {
      throw new BadRequestException('Format de fichier non autorise');
    }
  }

  private async uploadToCompanyStorage(kind: string, fileName: string, file: { mimetype: string; buffer: Buffer }) {
    const { supabaseUrl, serviceRoleKey } = this.storageConfig();
    const storagePath = this.companyStoragePath(kind, fileName);
    const response = await fetch(`${supabaseUrl}/storage/v1/object/${this.companyStorageBucket}/${this.encodeStoragePath(storagePath)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        'x-upsert': 'true',
        'content-type': file.mimetype,
      },
      body: file.buffer.buffer.slice(file.buffer.byteOffset, file.buffer.byteOffset + file.buffer.byteLength) as ArrayBuffer,
    });
    if (!response.ok) {
      const details = await response.text();
      throw new BadRequestException(details || `Impossible de televerser le fichier (${response.status})`);
    }
  }

  private async deleteFromCompanyStorage(kind: string, fileName: string) {
    const { supabaseUrl, serviceRoleKey } = this.storageConfig();
    const storagePath = this.companyStoragePath(kind, fileName);
    const response = await fetch(`${supabaseUrl}/storage/v1/object/${this.companyStorageBucket}/${this.encodeStoragePath(storagePath)}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: `${serviceRoleKey}`,
      },
    });
    if (!response.ok && response.status !== 404) {
      const details = await response.text();
      throw new BadRequestException(details || `Impossible de supprimer le fichier (${response.status})`);
    }
  }

  private async downloadCompanyStorage(kind: string, fileName: string) {
    const { supabaseUrl, serviceRoleKey } = this.storageConfig();
    const storagePath = this.companyStoragePath(kind, fileName);
    const response = await fetch(`${supabaseUrl}/storage/v1/object/${this.companyStorageBucket}/${this.encodeStoragePath(storagePath)}`, {
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
      },
    });
    if (!response.ok) {
      throw new BadRequestException(`Fichier introuvable (${response.status})`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      buffer,
      mimeType: response.headers.get('content-type') ?? 'application/octet-stream',
      downloadName: fileName,
    };
  }

  private encodeStoragePath(path: string) {
    return path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  }

  private async auditRead(action: string, resource: string, resourceId: string) {
    await this.db.query(
      `INSERT INTO audit_logs (organization_id, user_id, action, resource, resource_id, method, path, status_code, metadata)
       VALUES ($1, $2, $3, $4, $5, 'GET', $6, 200, $7)`,
      [
        this.context.organizationId(),
        this.context.userId() ?? null,
        action,
        resource,
        resourceId,
        `/api/${resource}/${resourceId}`,
        JSON.stringify({ reserved: true }),
      ],
    );
  }

  private async createCashMovementInTransaction(client: PoolClient, body: Record<string, unknown>) {
    const session = await this.openSession(client);
    const type = String(body.type ?? 'OUT');
    const category = String(body.category ?? (type === 'IN' ? 'OTHER_INCOME' : 'OTHER_EXPENSE'));
    const pieceNumber = body.piece_number ?? await this.nextCashPieceNumber(client, type);
    const currency = String(body.currency ?? 'USD').toUpperCase();
    const exchangeRateUsed = Number(body.exchange_rate_used ?? 0) || null;
    const amount = Number(body.amount ?? 0);
    const equivalentUsd = Number(body.equivalent_usd ?? (currency === 'CDF' && exchangeRateUsed ? amount / exchangeRateUsed : amount));
    const { rows } = await client.query(
      `INSERT INTO cash_movements
       (cash_session_id, piece_number, type, label, category, amount, movement_date, payment_id, invoice_id, tenant_id, employee_id, supplier, description, reference, attachment_file_name, attachment_file_url, stock_purchase_id, created_by, organization_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       RETURNING *`,
      [
        session.id,
        pieceNumber,
        type,
        String(body.label ?? body.description ?? body.category ?? 'Mouvement de caisse'),
        category,
        Number(body.amount ?? 0),
        body.movement_date ?? new Date().toISOString().slice(0, 10),
        body.payment_id ?? null,
        body.invoice_id ?? null,
        body.tenant_id ?? null,
        body.employee_id ?? null,
        body.supplier ?? null,
        body.description ?? null,
        body.reference ?? null,
        body.attachment_file_name ?? null,
        body.attachment_file_url ?? null,
        body.stock_purchase_id ?? null,
        this.context.userId() ?? body.created_by ?? 1,
        this.context.organizationId(),
      ],
    );
    await client.query(
      `UPDATE cash_movements
       SET currency = $2,
           exchange_rate_used = $3,
           exchange_rate_date = $4,
           equivalent_usd = $5
       WHERE id = $1 AND organization_id = $6`,
      [rows[0].id, currency, exchangeRateUsed, body.exchange_rate_date ?? null, equivalentUsd, this.context.organizationId()],
    );
    const refreshed = await client.query(
      `SELECT *
       FROM cash_movements
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [rows[0].id, this.context.organizationId()],
    );
    return refreshed.rows[0] ?? rows[0];
  }

  private async nextCashPieceNumber(client: PoolClient, type: string) {
    const prefix = type === 'IN' ? 'E' : 'D';
    const { rows } = await client.query(
      `SELECT COALESCE(MAX(NULLIF(SUBSTRING(piece_number FROM '([0-9]+)$'), '')::INT), 0) + 1 AS value
       FROM cash_movements
       WHERE organization_id = $1 AND deleted_at IS NULL AND piece_number LIKE $2`,
      [this.context.organizationId(), `${prefix}-%`],
    );
    return `${prefix}-${String(rows[0]?.value ?? 1).padStart(4, '0')}`;
  }

  private async insertInTransaction(client: PoolClient, table: string, body: Record<string, unknown>, allowed: string[]) {
    const payload: Record<string, unknown> = { ...body, organization_id: this.context.organizationId() };
    const keys = [...allowed, 'organization_id'].filter((key, index, arr) => arr.indexOf(key) === index && payload[key] !== undefined);
    if (!keys.length) throw new BadRequestException('No data provided');
    const values = keys.map((key) => payload[key]);
    const placeholders = keys.map((_, index) => `$${index + 1}`);
    const { rows } = await client.query(
      `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
      values,
    );
    return rows[0];
  }

  private async nextEmployeeNumber(client: PoolClient) {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`employee-number-${this.context.organizationId()}`]);
    const { rows } = await client.query(
      `SELECT COALESCE(MAX(NULLIF(regexp_replace(employee_number, '[^0-9]', '', 'g'), '')::INT), 0) + 1 AS value
       FROM employees
       WHERE organization_id = $1`,
      [this.context.organizationId()],
    );
    return `EMP-${String(rows[0]?.value ?? 1).padStart(6, '0')}`;
  }

  private async nextEmployeeContractNumber(client: PoolClient) {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`employee-contract-${this.context.organizationId()}`]);
    const { rows } = await client.query(
      `SELECT COALESCE(MAX(NULLIF(regexp_replace(contract_number, '[^0-9]', '', 'g'), '')::INT), 0) + 1 AS value
       FROM employee_contracts
       WHERE organization_id = $1`,
      [this.context.organizationId()],
    );
    return `CTR-${String(rows[0]?.value ?? 1).padStart(6, '0')}`;
  }
}
