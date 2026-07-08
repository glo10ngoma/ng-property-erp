import { BadRequestException, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { RequestContext } from '../auth/request-context';
import { hashPassword } from '../auth/password';
import { requireRow } from '../common/not-found';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class SaasService {
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

  async createUser(body: Record<string, unknown>) {
    const password = String(body.password ?? body.password_hash ?? 'demo');
    return this.insert('app_users', { status: 'ACTIVE', ...body, password_hash: await hashPassword(password) }, [
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

  async employeeDetail(id: number) {
    const organizationId = this.context.organizationId();
    const employee = await this.db.query('SELECT * FROM employees WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL', [id, organizationId]);
    const advances = await this.db.query('SELECT * FROM salary_advances WHERE employee_id = $1 AND organization_id = $2 AND deleted_at IS NULL ORDER BY advance_date DESC', [id, organizationId]);
    const leaves = await this.db.query('SELECT * FROM leaves WHERE employee_id = $1 AND organization_id = $2 AND deleted_at IS NULL ORDER BY start_date DESC', [id, organizationId]);
    const payrolls = await this.db.query('SELECT * FROM payrolls WHERE employee_id = $1 AND organization_id = $2 AND deleted_at IS NULL ORDER BY year DESC, month DESC', [id, organizationId]);
    return { ...requireRow(employee.rows[0], 'Employee'), advances: advances.rows, leaves: leaves.rows, payrolls: payrolls.rows };
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
        `INSERT INTO salary_advances (employee_id, amount, advance_date, reason, status, created_by, organization_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [
          body.employee_id,
          Number(body.amount ?? 0),
          body.advance_date ?? new Date().toISOString().slice(0, 10),
          body.reason ?? null,
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
      if (row.status === 'PAID') throw new BadRequestException('Cette avance est déjà payée');
      await this.ensureWorkflowApproved(client, row.workflow_instance_id);
      if (!['APPROVED', 'PENDING', 'DRAFT'].includes(row.status)) throw new BadRequestException('Cette avance ne peut pas être payée');
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
        `INSERT INTO leaves (employee_id, start_date, end_date, leave_type, reason, status, organization_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          body.employee_id,
          body.start_date,
          body.end_date,
          body.leave_type,
          body.reason ?? null,
          body.workflow_required ? 'PENDING' : body.status ?? 'PENDING',
          this.context.organizationId(),
        ],
      );
      if (body.workflow_required) {
        const workflow = await this.createWorkflowInstanceInTransaction(client, {
          type: 'LEAVE_APPROVAL',
          entity_type: 'leaves',
          entity_id: rows[0].id,
          title: `Demande congé #${rows[0].id}`,
          comment: body.reason ?? null,
        });
        await client.query('UPDATE leaves SET workflow_instance_id = $2 WHERE id = $1', [rows[0].id, workflow.id]);
        rows[0].workflow_instance_id = workflow.id;
      }
      return rows[0];
    });
  }

  async updateLeave(id: number, body: Record<string, unknown>) {
    return this.updateById('leaves', id, body, ['employee_id', 'start_date', 'end_date', 'leave_type', 'reason', 'status']);
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

  async payrolls(month?: number, year?: number) {
    const { rows } = await this.db.query(
      `SELECT p.*, CONCAT(e.first_name, ' ', e.last_name) AS employee_name, e.job_title
       FROM payrolls p
       JOIN employees e ON e.id = p.employee_id
       WHERE p.organization_id = $1 AND p.deleted_at IS NULL
         AND ($2::INT IS NULL OR p.month = $2)
         AND ($3::INT IS NULL OR p.year = $3)
       ORDER BY p.year DESC, p.month DESC, p.id DESC`,
      [this.context.organizationId(), month ?? null, year ?? null],
    );
    return rows;
  }

  async generatePayroll(body: Record<string, unknown>) {
    const employeeId = Number(body.employee_id);
    const month = Number(body.month ?? new Date().getMonth() + 1);
    const year = Number(body.year ?? new Date().getFullYear());
    const organizationId = this.context.organizationId();
    return this.db.transaction(async (client) => {
      const employee = await client.query(
        `SELECT * FROM employees WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
        [employeeId, organizationId],
      );
      const employeeRow = requireRow(employee.rows[0], 'Employee');
      const advances = await client.query(
        `SELECT COALESCE(SUM(amount), 0)::NUMERIC(12,2) AS total
         FROM salary_advances
         WHERE employee_id = $1 AND organization_id = $2 AND deleted_at IS NULL AND status = 'PAID'
           AND EXTRACT(MONTH FROM advance_date) = $3 AND EXTRACT(YEAR FROM advance_date) = $4`,
        [employeeId, organizationId, month, year],
      );
      const gross = Number(body.gross_salary ?? employeeRow.monthly_salary ?? 0);
      const advancesTotal = Number(body.advances_total ?? advances.rows[0].total ?? 0);
      const deductions = Number(body.deductions_total ?? 0);
      const net = Number(body.net_salary ?? Math.max(gross - advancesTotal - deductions, 0));
      const { rows } = await client.query(
        `INSERT INTO payrolls (employee_id, month, year, gross_salary, advances_total, deductions_total, net_salary, status, organization_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (organization_id, employee_id, year, month) WHERE deleted_at IS NULL
         DO UPDATE SET gross_salary = EXCLUDED.gross_salary,
                       advances_total = EXCLUDED.advances_total,
                       deductions_total = EXCLUDED.deductions_total,
                       net_salary = EXCLUDED.net_salary,
                       status = EXCLUDED.status
         RETURNING *`,
        [employeeId, month, year, gross, advancesTotal, deductions, net, body.status ?? 'DRAFT', organizationId],
      );
      return rows[0];
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
      if (row.status === 'PAID') throw new BadRequestException('Cette paie est déjà payée');
      if (!['VALIDATED', 'DRAFT'].includes(row.status)) throw new BadRequestException('Cette paie ne peut pas être payée');
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
    if (exists.rows[0]) throw new BadRequestException('Une caisse est déjà ouverte');
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
          title: `Demande dépense ${body.category ?? 'caisse'} - ${Number(body.amount ?? 0)}`,
          comment: body.description ?? body.notes ?? null,
        });
      }
      await this.ensureWorkflowApproved(client, body.workflow_instance_id);
      return this.createCashMovementInTransaction(client, body);
    });
  }

  async createInvoicePaymentMovement(client: PoolClient, paymentId: number, invoiceId: number, amount: number, reference?: string | null) {
    const session = await this.openSession(client);
    const invoice = await client.query('SELECT tenant_id FROM invoices WHERE id = $1 AND organization_id = $2', [invoiceId, this.context.organizationId()]);
    await client.query(
      `INSERT INTO cash_movements (cash_session_id, type, category, amount, movement_date, payment_id, invoice_id, tenant_id, description, reference, created_by, organization_id)
       VALUES ($1, 'IN', 'INVOICE_PAYMENT', $2, CURRENT_DATE, $3, $4, $5, 'Paiement facture', $6, $7, $8)`,
      [session.id, amount, paymentId, invoiceId, invoice.rows[0]?.tenant_id ?? null, reference ?? null, this.context.userId() ?? 1, this.context.organizationId()],
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

  async stockCategories() {
    return this.findAll('stock_categories', 'name');
  }

  async createStockCategory(body: Record<string, unknown>) {
    return this.insert('stock_categories', { status: 'ACTIVE', ...body }, ['name', 'description', 'status']);
  }

  async stockItems() {
    const { rows } = await this.db.query(`
      SELECT si.*,
             CASE
               WHEN si.status <> 'ACTIVE' THEN 'INACTIVE'
               WHEN si.current_quantity <= 0 THEN 'OUT_OF_STOCK'
               WHEN si.current_quantity <= si.minimum_quantity THEN 'LOW_STOCK'
               ELSE 'OK'
             END AS stock_alert
      FROM stock_items si
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
      `SELECT * FROM stock_movements WHERE stock_item_id = $1 AND organization_id = $2 AND deleted_at IS NULL ORDER BY movement_date DESC, id DESC`,
      [id, this.context.organizationId()],
    );
    return { ...requireRow(item.rows[0], 'Stock item'), movements: movements.rows };
  }

  async createStockItem(body: Record<string, unknown>) {
    return this.db.transaction(async (client) => {
      const nextId = await client.query(`SELECT nextval('stock_items_id_seq')::INT AS value`);
      const id = nextId.rows[0].value;
      const code = body.code ?? `ART-${String(id).padStart(5, '0')}`;
      const initialQuantity = Number(body.current_quantity ?? 0);
      const { rows } = await client.query(
        `INSERT INTO stock_items
         (id, code, name, description, category, unit, current_quantity, minimum_quantity, purchase_price, average_purchase_price, observations, status, organization_id)
         VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8, $8, $9, $10, $11)
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
    const keys = ['code', 'name', 'description', 'category', 'unit', 'minimum_quantity', 'purchase_price', 'average_purchase_price', 'observations', 'status'].filter(
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

  createStockEntry(body: Record<string, unknown>) {
    return this.createStockMovement({ ...body, type: 'IN', source: 'STOCK_ENTRY' });
  }

  createStockExit(body: Record<string, unknown>) {
    return this.createStockMovement({ ...body, type: 'OUT', source: 'STOCK_EXIT' });
  }

  createMaintenanceStockConsumption(body: Record<string, unknown>) {
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
              CASE WHEN mr.due_date IS NOT NULL AND mr.status NOT IN ('RESOLVED', 'VALIDATED', 'CLOSED', 'CANCELLED') AND mr.due_date < NOW() THEN TRUE ELSE FALSE END AS is_overdue,
              CASE WHEN mr.resolved_at IS NOT NULL THEN EXTRACT(EPOCH FROM (mr.resolved_at - mr.reported_at)) / 3600 ELSE NULL END AS resolution_hours
       FROM maintenance_requests mr
       LEFT JOIN buildings b ON b.id = mr.building_id
       LEFT JOIN units u ON u.id = mr.unit_id
       LEFT JOIN tenants t ON t.id = mr.tenant_id
       LEFT JOIN employees e ON e.id = mr.assigned_employee_id
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
              CONCAT(e.first_name, ' ', e.last_name) AS assigned_employee_name
       FROM maintenance_requests mr
       LEFT JOIN buildings b ON b.id = mr.building_id
       LEFT JOIN units u ON u.id = mr.unit_id
       LEFT JOIN tenants t ON t.id = mr.tenant_id
       LEFT JOIN employees e ON e.id = mr.assigned_employee_id
       WHERE mr.id = $1 AND mr.organization_id = $2 AND mr.deleted_at IS NULL`,
      [id, this.context.organizationId()],
    );
    const row = requireRow(request.rows[0], 'Maintenance request');
    const [assignments, timeline, documents, expenses, stock] = await Promise.all([
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
    ]);
    return { ...row, assignments: assignments.rows, timeline: timeline.rows, documents: documents.rows, expenses: expenses.rows, stock_movements: stock.rows };
  }

  async createMaintenanceRequest(body: Record<string, unknown>) {
    return this.db.transaction(async (client) => {
      const sequence = await client.query(`SELECT COALESCE(MAX(id), 0) + 1 AS value FROM maintenance_requests WHERE organization_id = $1`, [
        this.context.organizationId(),
      ]);
      const requestNumber = body.request_number ?? `MNT-${new Date().getFullYear()}-${String(sequence.rows[0].value).padStart(4, '0')}`;
      const { rows } = await client.query(
        `INSERT INTO maintenance_requests
         (request_number, title, description, category, priority, status, building_id, unit_id, lease_id, tenant_id,
          reported_by_name, reported_at, due_date, created_by, organization_id)
         VALUES ($1, $2, $3, $4, $5, 'NEW', $6, $7, $8, $9, $10, COALESCE($11::TIMESTAMP, NOW()), $12, $13, $14)
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
          this.context.userId() ?? 1,
          this.context.organizationId(),
        ],
      );
      await this.addMaintenanceTimeline(client, rows[0].id, 'REPORT', 'Signalement', body.description ? String(body.description) : 'Signalement créé');
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
    ]);
    await this.db.transaction((client) => this.addMaintenanceTimeline(client, id, 'UPDATE', 'Modification', 'Demande mise à jour'));
    return updated;
  }

  async diagnoseMaintenanceRequest(id: number, body: Record<string, unknown>) {
    return this.db.transaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE maintenance_requests
         SET status = 'WAITING_APPROVAL',
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
      await this.addMaintenanceTimeline(client, id, 'DIAGNOSIS', 'Diagnostic', body.diagnostic ? String(body.diagnostic) : 'Diagnostic enregistré');
      return requireRow(rows[0], 'Maintenance request');
    });
  }

  async transitionMaintenanceRequest(id: number, status: string, title: string, details: string) {
    if (status === 'APPROVED') {
      const wf = await this.db.query('SELECT workflow_instance_id FROM maintenance_requests WHERE id = $1 AND organization_id = $2', [id, this.context.organizationId()]);
      await this.db.transaction((client) => this.ensureWorkflowApproved(client, wf.rows[0]?.workflow_instance_id));
    }
    const { rows } = await this.db.query(
      `UPDATE maintenance_requests SET status = $3, updated_at = NOW()
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL RETURNING *`,
      [id, this.context.organizationId(), status],
    );
    await this.db.transaction((client) => this.addMaintenanceTimeline(client, id, status, title, details));
    return requireRow(rows[0], 'Maintenance request');
  }

  async assignMaintenanceRequest(id: number, body: Record<string, unknown>) {
    return this.db.transaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE maintenance_requests
         SET status = 'ASSIGNED', assigned_employee_id = $3, external_provider = $4, updated_at = NOW()
         WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL RETURNING *`,
        [id, this.context.organizationId(), body.employee_id ?? null, body.external_provider ?? null],
      );
      const request = requireRow(rows[0], 'Maintenance request');
      await client.query(
        `INSERT INTO maintenance_assignments (maintenance_request_id, employee_id, external_provider, assigned_by, notes, organization_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, body.employee_id ?? null, body.external_provider ?? null, this.context.userId() ?? 1, body.notes ?? null, this.context.organizationId()],
      );
      await this.addMaintenanceTimeline(client, id, 'ASSIGNMENT', 'Assignation', body.notes ? String(body.notes) : 'Intervention affectée');
      return request;
    });
  }

  async startMaintenanceRequest(id: number, body: Record<string, unknown>) {
    const { rows } = await this.db.query(
      `UPDATE maintenance_requests
       SET status = 'IN_PROGRESS', started_at = COALESCE(started_at, COALESCE($3::TIMESTAMP, NOW())), updated_at = NOW()
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL RETURNING *`,
      [id, this.context.organizationId(), body.started_at ?? null],
    );
    await this.db.transaction((client) => this.addMaintenanceTimeline(client, id, 'INTERVENTION', 'Intervention', body.comments ? String(body.comments) : 'Intervention démarrée'));
    return requireRow(rows[0], 'Maintenance request');
  }

  async resolveMaintenanceRequest(id: number, body: Record<string, unknown>) {
    const { rows } = await this.db.query(
      `UPDATE maintenance_requests
       SET status = 'RESOLVED',
           resolved_at = COALESCE($3::TIMESTAMP, NOW()),
           actual_hours = $4,
           resolution_comments = $5,
           updated_at = NOW()
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL RETURNING *`,
      [id, this.context.organizationId(), body.resolved_at ?? null, Number(body.actual_hours ?? 0), body.resolution_comments ?? body.comments ?? null],
    );
    await this.db.transaction((client) => this.addMaintenanceTimeline(client, id, 'RESOLUTION', 'Résolution', body.resolution_comments ? String(body.resolution_comments) : 'Intervention résolue'));
    return requireRow(rows[0], 'Maintenance request');
  }

  async validateMaintenanceRequest(id: number, body: Record<string, unknown>) {
    const { rows } = await this.db.query(
      `UPDATE maintenance_requests
       SET status = 'VALIDATED', validated_by = $3, validated_at = NOW(), final_validation_comments = $4, updated_at = NOW()
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL RETURNING *`,
      [id, this.context.organizationId(), this.context.userId() ?? 1, body.comments ?? null],
    );
    await this.db.transaction((client) => this.addMaintenanceTimeline(client, id, 'VALIDATION', 'Validation finale', body.comments ? String(body.comments) : 'Résolution validée'));
    return requireRow(rows[0], 'Maintenance request');
  }

  async closeMaintenanceRequest(id: number) {
    const { rows } = await this.db.query(
      `UPDATE maintenance_requests
       SET status = 'CLOSED', closed_by = $3, closed_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL RETURNING *`,
      [id, this.context.organizationId(), this.context.userId() ?? 1],
    );
    await this.db.transaction((client) => this.addMaintenanceTimeline(client, id, 'CLOSURE', 'Clôture', 'Demande clôturée'));
    return requireRow(rows[0], 'Maintenance request');
  }

  async createMaintenanceExpense(id: number, body: Record<string, unknown>) {
    return this.db.transaction(async (client) => {
      let cashMovementId = null;
      const status = String(body.status ?? 'APPROVED');
      if (status !== 'REJECTED') {
        const movement = await this.createCashMovementInTransaction(client, {
          type: 'OUT',
          category: 'MAINTENANCE_EXPENSE',
          amount: Number(body.amount ?? 0),
          movement_date: body.expense_date ?? new Date().toISOString().slice(0, 10),
          description: body.description ?? 'Dépense maintenance',
          reference: body.reference ?? `MNT-EXP-${id}`,
        });
        cashMovementId = movement.id;
      }
      const { rows } = await client.query(
        `INSERT INTO maintenance_expenses
         (maintenance_request_id, amount, expense_date, category, description, status, cash_movement_id, created_by, organization_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [
          id,
          Number(body.amount ?? 0),
          body.expense_date ?? new Date().toISOString().slice(0, 10),
          body.category ?? 'Autre',
          body.description ?? null,
          status,
          cashMovementId,
          this.context.userId() ?? 1,
          this.context.organizationId(),
        ],
      );
      await this.addMaintenanceTimeline(client, id, 'EXPENSE', 'Dépense', status === 'REJECTED' ? 'Dépense rejetée' : 'Dépense enregistrée');
      return rows[0];
    });
  }

  async createMaintenanceDocument(id: number, body: Record<string, unknown>) {
    const { rows } = await this.db.query(
      `INSERT INTO maintenance_documents (maintenance_request_id, document_type, file_name, file_url, uploaded_by, organization_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [id, body.document_type ?? 'OTHER', body.file_name, body.file_url ?? null, this.context.userId() ?? 1, this.context.organizationId()],
    );
    await this.db.transaction((client) => this.addMaintenanceTimeline(client, id, 'DOCUMENT', 'Document', String(body.file_name ?? 'Document ajouté')));
    return rows[0];
  }

  async createStockMovement(body: Record<string, unknown>) {
    return this.db.transaction((client) => this.createStockMovementInTransaction(client, body));
  }

  async stockMovements() {
    const { rows } = await this.db.query(`
      SELECT sm.*, si.code AS item_code, si.name AS item_name, si.category,
             CONCAT(u.first_name, ' ', u.last_name) AS user_name
      FROM stock_movements sm
      JOIN stock_items si ON si.id = sm.stock_item_id
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
             COALESCE(SUM(ABS(icl.difference_quantity)), 0)::FLOAT AS total_difference
      FROM inventory_counts ic
      LEFT JOIN inventory_count_lines icl ON icl.inventory_count_id = ic.id AND icl.deleted_at IS NULL
      WHERE ic.organization_id = $1 AND ic.deleted_at IS NULL
      GROUP BY ic.id
      ORDER BY ic.count_date DESC, ic.id DESC
    `, [this.context.organizationId()]);
    return rows;
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
      const lines = Array.isArray(body.lines) ? (body.lines as Array<Record<string, unknown>>) : [];
      for (const line of lines) {
        const item = await client.query(
          `SELECT current_quantity FROM stock_items WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
          [line.stock_item_id, this.context.organizationId()],
        );
        const theoretical = Number(line.theoretical_quantity ?? item.rows[0]?.current_quantity ?? 0);
        const physical = Number(line.physical_quantity ?? theoretical);
        await client.query(
          `INSERT INTO inventory_count_lines
           (inventory_count_id, stock_item_id, theoretical_quantity, physical_quantity, difference_quantity, notes, organization_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [inventory.rows[0].id, line.stock_item_id, theoretical, physical, physical - theoretical, line.notes ?? null, this.context.organizationId()],
        );
      }
      return inventory.rows[0];
    });
  }

  async validateStockInventory(id: number) {
    return this.db.transaction(async (client) => {
      const inventory = await client.query(
        `SELECT * FROM inventory_counts WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
        [id, this.context.organizationId()],
      );
      const inventoryRow = requireRow(inventory.rows[0], 'Inventory');
      if (inventoryRow.status === 'VALIDATED') throw new BadRequestException('Inventaire déjà validé');
      const lines = await client.query(
        `SELECT * FROM inventory_count_lines WHERE inventory_count_id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
        [id, this.context.organizationId()],
      );
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

  async leases() {
    const { rows } = await this.db.query(`
      SELECT l.*, CONCAT(t.first_name, ' ', t.last_name) AS tenant_name, u.number AS unit_number, b.name AS building_name,
             COALESCE(g.amount, l.rental_guarantee_amount, 0)::FLOAT AS guarantee_amount,
             COALESCE(g.paid_amount, l.rental_guarantee_paid, 0)::FLOAT AS guarantee_paid,
             COALESCE(g.status, l.rental_guarantee_status) AS guarantee_status
      FROM leases l
      JOIN tenants t ON t.id = l.tenant_id
      JOIN units u ON u.id = l.unit_id
      JOIN buildings b ON b.id = u.building_id
      LEFT JOIN lease_guarantees g ON g.lease_id = l.id AND g.deleted_at IS NULL
      WHERE l.organization_id = $1 AND l.deleted_at IS NULL
      ORDER BY l.start_date DESC, l.id DESC
    `, [this.context.organizationId()]);
    return rows;
  }

  async leaseDetail(id: number) {
    const lease = await this.db.query(
      `SELECT l.*, CONCAT(t.first_name, ' ', t.last_name) AS tenant_name, t.phone AS tenant_phone,
              u.number AS unit_number, u.status AS unit_status, b.name AS building_name
       FROM leases l
       JOIN tenants t ON t.id = l.tenant_id
       JOIN units u ON u.id = l.unit_id
       JOIN buildings b ON b.id = u.building_id
       WHERE l.id = $1 AND l.organization_id = $2 AND l.deleted_at IS NULL`,
      [id, this.context.organizationId()],
    );
    return {
      ...requireRow(lease.rows[0], 'Lease'),
      guarantee: await this.leaseGuarantee(id),
      documents: await this.leaseDocuments(id),
      history: await this.unitOccupationHistory(lease.rows[0]?.unit_id ?? 0),
    };
  }

  async createLease(body: Record<string, unknown>) {
    return this.db.transaction(async (client) => {
      const organizationId = this.context.organizationId();
      if (body.status === 'ACTIVE') {
        await this.ensureNoLeaseConflict(client, Number(body.unit_id), String(body.start_date), body.end_date ? String(body.end_date) : null);
      }
      const { rows } = await client.query(
        `INSERT INTO leases
         (tenant_id, unit_id, start_date, end_date, monthly_rent, rental_guarantee_amount, rental_guarantee_paid,
          rental_guarantee_payment_date, rental_guarantee_status, contract_file_url, contract_file_name, status, organization_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING *`,
        [
          body.tenant_id,
          body.unit_id,
          body.start_date,
          body.end_date ?? null,
          Number(body.monthly_rent ?? 0),
          Number(body.rental_guarantee_amount ?? body.guarantee_amount ?? 0),
          Number(body.rental_guarantee_paid ?? body.guarantee_paid ?? 0),
          body.rental_guarantee_payment_date ?? body.guarantee_payment_date ?? null,
          body.rental_guarantee_status ?? body.guarantee_status ?? 'NOT_PAID',
          body.contract_file_url ?? null,
          body.contract_file_name ?? null,
          body.status ?? 'DRAFT',
          organizationId,
        ],
      );
      await this.upsertLeaseGuarantee(client, rows[0].id, {
        amount: Number(body.rental_guarantee_amount ?? body.guarantee_amount ?? 0),
        paid_amount: Number(body.rental_guarantee_paid ?? body.guarantee_paid ?? 0),
        payment_date: body.rental_guarantee_payment_date ?? body.guarantee_payment_date ?? null,
        status: body.rental_guarantee_status ?? body.guarantee_status ?? 'NOT_PAID',
      });
      if (body.contract_file_name) {
        await client.query(
          `INSERT INTO lease_documents (lease_id, document_type, file_name, file_url, uploaded_by, organization_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [rows[0].id, 'CONTRACT', body.contract_file_name, body.contract_file_url ?? null, this.context.userId(), organizationId],
        );
      }
      if (rows[0].status === 'ACTIVE') await this.activateLeaseInTransaction(client, rows[0].id);
      return rows[0];
    });
  }

  async updateLease(id: number, body: Record<string, unknown>) {
    await this.leaseDetail(id);
    return this.db.transaction(async (client) => {
      const keys = ['tenant_id', 'unit_id', 'start_date', 'end_date', 'monthly_rent', 'contract_file_url', 'contract_file_name', 'status'].filter((key) => body[key] !== undefined);
      let lease = null;
      if (keys.length) {
        const assignments = keys.map((key, index) => `${key} = $${index + 2}`);
        const { rows } = await client.query(
          `UPDATE leases SET ${assignments.join(', ')}, updated_at = NOW()
           WHERE id = $1 AND organization_id = $${keys.length + 2} AND deleted_at IS NULL RETURNING *`,
          [id, ...keys.map((key) => body[key]), this.context.organizationId()],
        );
        lease = rows[0];
      }
      if (
        body.rental_guarantee_amount !== undefined ||
        body.guarantee_amount !== undefined ||
        body.rental_guarantee_paid !== undefined ||
        body.guarantee_paid !== undefined ||
        body.rental_guarantee_status !== undefined ||
        body.guarantee_status !== undefined
      ) {
        await this.upsertLeaseGuarantee(client, id, {
          amount: Number(body.rental_guarantee_amount ?? body.guarantee_amount ?? 0),
          paid_amount: Number(body.rental_guarantee_paid ?? body.guarantee_paid ?? 0),
          payment_date: body.rental_guarantee_payment_date ?? body.guarantee_payment_date ?? null,
          status: body.rental_guarantee_status ?? body.guarantee_status ?? 'NOT_PAID',
        });
      }
      return lease ?? this.leaseDetail(id);
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
      `SELECT * FROM company_settings
       WHERE organization_id = $1 AND deleted_at IS NULL`,
      [this.context.organizationId()],
    );
    return rows[0] ?? this.createDefaultCompanySettings();
  }

  async updateCompanySettings(body: Record<string, unknown>) {
    await this.companySettings();
    const allowed = [
      'logo_url',
      'invoice_logo_url',
      'signature_url',
      'stamp_url',
      'company_name',
      'legal_name',
      'address',
      'phone',
      'email',
      'website',
      'currency',
      'language',
      'timezone',
      'invoice_footer',
      'paper_format',
      'invoice_bottom_text',
    ];
    const keys = allowed.filter((key) => body[key] !== undefined);
    if (!keys.length) throw new BadRequestException('No data provided');
    const assignments = keys.map((key, index) => `${key} = $${index + 2}`);
    const { rows } = await this.db.query(
      `UPDATE company_settings
       SET ${assignments.join(', ')}, updated_by = $${keys.length + 2}, updated_at = NOW()
       WHERE organization_id = $1 AND deleted_at IS NULL
       RETURNING *`,
      [this.context.organizationId(), ...keys.map((key) => body[key]), this.context.userId() ?? 1],
    );
    return requireRow(rows[0], 'Company settings');
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
              CASE WHEN l.id IS NULL THEN 'Libre' ELSE 'Occupée' END AS occupancy
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
      const invoice = await client.query(
        `INSERT INTO invoices (id, tenant_id, lease_id, unit_id, building_id, invoice_number, month, year, issue_date, due_date, status, total, organization_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_DATE, $9, 'UNPAID', $10, $11) RETURNING *`,
        [nextId.rows[0].value, row.tenant_id, row.id, row.unit_id, row.building_id, number, today.getMonth() + 1, today.getFullYear(), due.toISOString().slice(0, 10), row.monthly_rent, this.context.organizationId()],
      );
      await client.query('INSERT INTO invoice_items (invoice_id, description, amount, organization_id) VALUES ($1, $2, $3, $4)', [
        invoice.rows[0].id,
        'Monthly rent',
        row.monthly_rent,
        this.context.organizationId(),
      ]);
      return invoice.rows[0];
    });
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
              u.number AS unit_number, l.id AS lease_id, l.status AS lease_status, l.monthly_rent
       FROM tenants t
       JOIN leases l ON l.tenant_id = t.id AND l.deleted_at IS NULL
       JOIN units u ON u.id = l.unit_id
       WHERE u.building_id = $1 AND t.organization_id = $2 AND t.deleted_at IS NULL
         AND ($3::INT IS NULL OR t.id = $3)
         AND ($4::INT IS NULL OR u.id = $4)
       ORDER BY t.id, l.status = 'ACTIVE' DESC, l.start_date DESC`,
      [id, organizationId, filters.tenantId ?? null, filters.unitId ?? null],
    );
    const finances = await this.db.query(
      `SELECT
         COUNT(i.id)::INT AS invoices,
         COUNT(*) FILTER (WHERE i.status = 'PAID')::INT AS paid_invoices,
         COUNT(*) FILTER (WHERE i.status = 'PARTIAL')::INT AS partial_invoices,
         COUNT(*) FILTER (WHERE i.status NOT IN ('PAID', 'CANCELLED'))::INT AS unpaid_invoices,
         COUNT(*) FILTER (WHERE i.status <> 'PAID' AND i.due_date < CURRENT_DATE)::INT AS overdue_invoices,
         COALESCE(SUM(i.total), 0)::FLOAT AS total_invoiced,
         COALESCE(SUM(s.paid_amount), 0)::FLOAT AS total_paid,
         COALESCE(SUM(s.remaining_amount), 0)::FLOAT AS remaining
       FROM invoices i
       LEFT JOIN leases l ON l.id = i.lease_id
       LEFT JOIN tenants t ON t.id = i.tenant_id
       LEFT JOIN units iu ON iu.id = i.unit_id
       LEFT JOIN units lu ON lu.id = l.unit_id
       LEFT JOIN units tu ON tu.id = t.unit_id
       LEFT JOIN invoice_payment_summary s ON s.invoice_id = i.id
       WHERE COALESCE(i.building_id, iu.building_id, lu.building_id, tu.building_id) = $1 AND i.issue_date BETWEEN $2 AND $3 AND i.organization_id = $4 AND i.deleted_at IS NULL
         AND ($5::INT IS NULL OR i.tenant_id = $5)
         AND ($6::INT IS NULL OR COALESCE(i.unit_id, l.unit_id, t.unit_id) = $6)
         AND ${this.invoiceStatusClause('i', 7)}`,
      params,
    );
    const invoices = await this.db.query(
      `SELECT i.id, i.tenant_id, i.invoice_number, i.issue_date, i.due_date, i.status, i.total,
              CONCAT(t.first_name, ' ', t.last_name) AS tenant_name,
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
      new Map(payments.rows.filter((row) => row.tenant_id).map((row) => [row.tenant_id, { tenant_id: row.tenant_id, tenant_name: row.tenant_name, unit_number: row.unit_number }])).values(),
    );
    const tenantsUnpaid = Array.from(
      new Map(
        invoices.rows
          .filter((row) => row.tenant_id && !paidTenantIds.has(row.tenant_id) && row.status !== 'PAID')
          .map((row) => [row.tenant_id, { tenant_id: row.tenant_id, tenant_name: row.tenant_name, unit_number: row.unit_number, remaining_amount: row.remaining_amount }]),
      ).values(),
    );
    const tenantSituations = tenants.rows.map((tenant) => {
      const tenantInvoices = invoices.rows.filter((invoice) => Number(invoice.tenant_id) === Number(tenant.id));
      const totalInvoiced = tenantInvoices.reduce((sum, invoice) => sum + Number(invoice.total), 0);
      const totalPaid = tenantInvoices.reduce((sum, invoice) => sum + Number(invoice.paid_amount), 0);
      const remaining = tenantInvoices.reduce((sum, invoice) => sum + Number(invoice.remaining_amount), 0);
      const paidCount = tenantInvoices.filter((invoice) => invoice.status === 'PAID').length;
      const partialCount = tenantInvoices.filter((invoice) => invoice.status === 'PARTIAL').length;
      const unpaidCount = tenantInvoices.filter((invoice) => invoice.status === 'UNPAID').length;
      const overdueCount = tenantInvoices.filter((invoice) => invoice.status !== 'PAID' && new Date(invoice.due_date) < new Date()).length;
      return {
        ...tenant,
        payment_status: remaining <= 0 && totalInvoiced > 0 ? 'PAID' : totalPaid > 0 ? 'PARTIAL' : 'UNPAID',
        total_invoiced: totalInvoiced,
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
      finances: finances.rows[0],
      units: units.rows,
      payments: payments.rows,
      tenants_paid: tenantsPaid,
      tenants_unpaid: tenantsUnpaid,
      paid_invoices: invoices.rows.filter((row) => row.status === 'PAID'),
      partial_invoices: invoices.rows.filter((row) => row.status === 'PARTIAL'),
      unpaid_invoices: invoices.rows.filter((row) => row.status === 'UNPAID'),
      overdue_invoices: invoices.rows.filter((row) => row.status !== 'PAID' && new Date(row.due_date) < new Date()),
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
    const rows = invoices.rows;
    const totalInvoiced = rows.reduce((sum, row) => sum + Number(row.total), 0);
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
    return {
      sessions,
      movements,
      total_in: movements.filter((m) => m.type === 'IN').reduce((sum, m) => sum + Number(m.amount), 0),
      total_out: movements.filter((m) => m.type === 'OUT').reduce((sum, m) => sum + Number(m.amount), 0),
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
    return {
      items,
      movements,
      inventories,
      under_minimum: items.filter((item) => item.status === 'ACTIVE' && Number(item.current_quantity) <= Number(item.minimum_quantity) && Number(item.current_quantity) > 0),
      out_of_stock: items.filter((item) => item.status === 'ACTIVE' && Number(item.current_quantity) <= 0),
      inactive: items.filter((item) => item.status !== 'ACTIVE'),
      valuation: items.reduce((sum, item) => sum + Number(item.current_quantity) * Number(item.average_purchase_price ?? item.purchase_price ?? 0), 0),
    };
  }

  async staffReport(start = '2000-01-01', end = '2999-12-31', month?: number, year?: number) {
    const employees = await this.findAll('employees', 'last_name, first_name');
    const advances = await this.salaryAdvances();
    const leaves = await this.leaves(start, end);
    const payrolls = await this.payrolls(month, year);
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
      `SELECT mr.*, b.name AS building_name,
              CONCAT(e.first_name, ' ', e.last_name) AS technician_name,
              COALESCE(exp.total_expenses, 0)::FLOAT AS expenses_total,
              COALESCE(stock.total_stock_cost, 0)::FLOAT AS stock_cost_total,
              CASE WHEN mr.due_date IS NOT NULL AND mr.status NOT IN ('RESOLVED', 'VALIDATED', 'CLOSED', 'CANCELLED') AND mr.due_date < NOW() THEN TRUE ELSE FALSE END AS is_overdue,
              CASE WHEN mr.resolved_at IS NOT NULL THEN EXTRACT(EPOCH FROM (mr.resolved_at - mr.reported_at)) / 3600 ELSE NULL END AS resolution_hours
       FROM maintenance_requests mr
       LEFT JOIN buildings b ON b.id = mr.building_id
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
    return {
      requests: rows,
      by_building: Object.values(rows.reduce<Record<string, { building_name: string; count: number; cost: number }>>((acc, row) => {
        const key = row.building_name ?? 'Non lié';
        acc[key] ??= { building_name: key, count: 0, cost: 0 };
        acc[key].count += 1;
        acc[key].cost += Number(row.expenses_total) + Number(row.stock_cost_total);
        return acc;
      }, {})),
      by_technician: Object.values(rows.reduce<Record<string, { technician_name: string; count: number; avg_hours: number }>>((acc, row) => {
        const key = row.technician_name ?? row.external_provider ?? 'Non affecté';
        acc[key] ??= { technician_name: key, count: 0, avg_hours: 0 };
        acc[key].count += 1;
        acc[key].avg_hours += Number(row.resolution_hours ?? 0);
        return acc;
      }, {})).map((row) => ({ ...row, avg_hours: row.count ? row.avg_hours / row.count : 0 })),
      by_category: Object.values(rows.reduce<Record<string, { category: string; count: number; cost: number }>>((acc, row) => {
        acc[row.category] ??= { category: row.category, count: 0, cost: 0 };
        acc[row.category].count += 1;
        acc[row.category].cost += Number(row.expenses_total) + Number(row.stock_cost_total);
        return acc;
      }, {})),
      summary: {
        open: rows.filter((row) => !['CLOSED', 'CANCELLED'].includes(row.status)).length,
        urgent: rows.filter((row) => row.priority === 'URGENT').length,
        overdue: rows.filter((row) => row.is_overdue).length,
        completed: rows.filter((row) => ['RESOLVED', 'VALIDATED', 'CLOSED'].includes(row.status)).length,
        average_resolution_hours: rows.filter((row) => row.resolution_hours !== null).reduce((sum, row) => sum + Number(row.resolution_hours), 0) / Math.max(rows.filter((row) => row.resolution_hours !== null).length, 1),
        total_cost: rows.reduce((sum, row) => sum + Number(row.expenses_total) + Number(row.stock_cost_total), 0),
      },
    };
  }

  private async createStockMovementInTransaction(client: PoolClient, body: Record<string, unknown>) {
    const item = await client.query(
      `SELECT * FROM stock_items WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [body.stock_item_id, this.context.organizationId()],
    );
    const itemRow = requireRow(item.rows[0], 'Stock item');
    if (itemRow.status !== 'ACTIVE') throw new BadRequestException('Article stock inactif');
    const type = String(body.type ?? 'OUT');
    const quantity = Number(body.quantity ?? 0);
    if (quantity <= 0) throw new BadRequestException('La quantité doit être positive');
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
        unit_price, supplier, destination, quantity_before, quantity_after, maintenance_reference, inventory_count_id, maintenance_request_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
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
      ],
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
    return rows[0];
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
    await this.addWorkflowAction(client, rows[0].id, 'CREATED', body.comment ? String(body.comment) : 'Workflow créé');
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
    if (step.approver_user_id && Number(step.approver_user_id) !== this.context.userId()) throw new BadRequestException('Vous ne pouvez pas valider cette étape');
    if (step.approver_role && step.approver_role !== this.context.user()?.role) throw new BadRequestException('Rôle approbateur requis');
  }

  private async ensureWorkflowApproved(client: PoolClient, workflowInstanceId?: unknown) {
    if (!workflowInstanceId) return;
    const { rows } = await client.query(
      `SELECT status FROM workflow_instances WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [workflowInstanceId, this.context.organizationId()],
    );
    const workflow = requireRow(rows[0], 'Workflow');
    if (workflow.status === 'REJECTED') throw new BadRequestException('Workflow rejeté: action bloquée');
    if (workflow.status !== 'APPROVED') throw new BadRequestException('Workflow en attente: action bloquée');
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
    if (rows[0]) throw new BadRequestException('Un bail actif existe déjà sur cette unité pour cette période');
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

  private async createDefaultCompanySettings() {
    const { rows } = await this.db.query(
      `INSERT INTO company_settings (organization_id, company_name, legal_name, currency, language, timezone, invoice_footer, invoice_bottom_text, created_by)
       VALUES ($1, 'Demo Property ERP', 'Demo Property ERP', 'USD', 'fr', 'Africa/Kinshasa', 'Merci pour votre confiance.', 'Facture generee par Property ERP.', $2)
       ON CONFLICT (organization_id) DO UPDATE SET organization_id = EXCLUDED.organization_id
       RETURNING *`,
      [this.context.organizationId(), this.context.userId() ?? 1],
    );
    return rows[0];
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
    const { rows } = await client.query(
      `INSERT INTO cash_movements
       (cash_session_id, type, category, amount, movement_date, payment_id, invoice_id, tenant_id, employee_id, description, reference, created_by, organization_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        session.id,
        type,
        category,
        Number(body.amount ?? 0),
        body.movement_date ?? new Date().toISOString().slice(0, 10),
        body.payment_id ?? null,
        body.invoice_id ?? null,
        body.tenant_id ?? null,
        body.employee_id ?? null,
        body.description ?? null,
        body.reference ?? null,
        this.context.userId() ?? body.created_by ?? 1,
        this.context.organizationId(),
      ],
    );
    return rows[0];
  }
}
