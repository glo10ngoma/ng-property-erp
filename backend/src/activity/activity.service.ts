import { Injectable } from '@nestjs/common';
import { RequestContext } from '../auth/request-context';
import { DatabaseService } from '../database/database.service';
import { normalizeRole } from '../saas/permissions';

@Injectable()
export class ActivityService {
  constructor(private readonly db: DatabaseService, private readonly context: RequestContext) {}

  async overview() {
    const [validations, tasks, alerts, recent, kpis, today, week] = await Promise.all([
      this.validations(),
      this.tasks(),
      this.alerts(),
      this.recent(),
      this.kpis(),
      this.today(),
      this.week(),
    ]);
    return { validations, tasks, alerts, recent, kpis, today, week, progress: this.progress(tasks, validations) };
  }

  async validations() {
    const { rows } = await this.db.query(
      `SELECT wi.id, wi.type, wi.title AS object, wi.entity_type, wi.entity_id, wi.status, wi.created_at AS date,
              wi.comment, ws.name AS step_name, ws.approver_role, ws.approver_user_id,
              CONCAT(u.first_name, ' ', u.last_name) AS requester
       FROM workflow_instances wi
       JOIN workflow_steps ws ON ws.workflow_instance_id = wi.id
       LEFT JOIN app_users u ON u.id = wi.requester_id
       WHERE wi.organization_id = $1 AND wi.deleted_at IS NULL
         AND wi.status = 'PENDING' AND ws.status = 'PENDING'
         AND (ws.approver_role = $2 OR ws.approver_user_id = $3)
       ORDER BY wi.created_at`,
      [this.context.organizationId(), this.context.user()?.role ?? null, this.context.userId()],
    );
    return rows.map((row) => ({ ...row, priority: this.priorityForWorkflow(row.type) }));
  }

  async tasks() {
    const organizationId = this.context.organizationId();
    const role = normalizeRole(this.context.user()?.role);
    const tasks = [];
    if (role === 'ADMIN' || role === 'EDITOR') {
      const invoices = await this.db.query(
        `SELECT i.id, i.invoice_number, i.due_date, i.status
         FROM invoices i
         LEFT JOIN invoice_payment_summary s ON s.invoice_id = i.id
         WHERE i.organization_id = $1
           AND i.deleted_at IS NULL
           AND i.status NOT IN ('PAID', 'CANCELLED')
           AND COALESCE(s.remaining_amount, i.total) > 0
         ORDER BY i.due_date LIMIT 8`,
        [organizationId],
      );
      tasks.push(...invoices.rows.map((row) => this.task(`invoice-${row.id}`, 'Facture à traiter', row.invoice_number, 'Facturation', row.due_date, row.status, '/invoices')));
      const cash = await this.db.query(
        `SELECT id, opened_at FROM cash_sessions WHERE organization_id = $1 AND deleted_at IS NULL AND status = 'OPEN' ORDER BY opened_at DESC LIMIT 1`,
        [organizationId],
      );
      if (cash.rows[0]) tasks.push(this.task(`cash-${cash.rows[0].id}`, 'Caisse à fermer', 'Session ouverte', 'Caisse', cash.rows[0].opened_at, 'PENDING', '/cash', 'HIGH'));
    }
    if (role === 'ADMIN' || role === 'EDITOR') {
      const maintenance = await this.db.query(
        `SELECT id, request_number, title, due_date, priority, status FROM maintenance_requests
         WHERE organization_id = $1
           AND deleted_at IS NULL
           AND status IN ('ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'DIAGNOSIS', 'APPROVED')
         ORDER BY due_date NULLS LAST, reported_at DESC LIMIT 8`,
        [organizationId],
      );
      tasks.push(...maintenance.rows.map((row) => this.task(`maintenance-${row.id}`, 'Intervention maintenance', `${row.request_number} - ${row.title}`, 'Maintenance', row.due_date, row.status, '/maintenance', row.priority)));
      const leases = await this.db.query(
        `SELECT id, lease_number, end_date FROM leases
         WHERE organization_id = $1 AND deleted_at IS NULL AND status = 'ACTIVE' AND end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
         ORDER BY end_date LIMIT 8`,
        [organizationId],
      );
      tasks.push(...leases.rows.map((row) => this.task(`lease-${row.id}`, 'Contrat à renouveler', this.leaseReference(row.id, row.lease_number), 'Baux', row.end_date, 'PENDING', '/leases')));
    }
    if (role === 'ADMIN') {
      const inventories = await this.db.query(
        `SELECT id, inventory_number, count_date, status FROM inventory_counts
         WHERE organization_id = $1 AND deleted_at IS NULL AND status = 'DRAFT'
         ORDER BY count_date LIMIT 8`,
        [organizationId],
      );
      tasks.push(...inventories.rows.map((row) => this.task(`inventory-${row.id}`, 'Inventaire à réaliser', row.inventory_number, 'Stock', row.count_date, row.status, '/stock')));
    }
    return tasks.sort((a, b) => String(a.due_date ?? '').localeCompare(String(b.due_date ?? ''))).slice(0, 18);
  }

  async alerts() {
    const organizationId = this.context.organizationId();
    const alerts = [];
    const overdue = await this.db.query(
      `SELECT i.id, i.invoice_number, i.due_date
       FROM invoices i
       LEFT JOIN invoice_payment_summary s ON s.invoice_id = i.id
       WHERE i.organization_id = $1
         AND i.deleted_at IS NULL
         AND i.status NOT IN ('PAID', 'CANCELLED')
         AND i.due_date < CURRENT_DATE
         AND COALESCE(s.remaining_amount, i.total) > 0
       ORDER BY i.due_date LIMIT 10`,
      [organizationId],
    );
    alerts.push(...overdue.rows.map((row) => ({ id: `invoice-${row.id}`, level: 'CRITICAL', title: 'Facture en retard', detail: row.invoice_number, due_date: row.due_date, path: '/invoices' })));
    const stock = await this.db.query(
      `SELECT id, code, name, current_quantity, minimum_quantity FROM stock_items
       WHERE organization_id = $1 AND deleted_at IS NULL AND status = 'ACTIVE' AND current_quantity <= minimum_quantity
       ORDER BY current_quantity LIMIT 10`,
      [organizationId],
    );
    alerts.push(...stock.rows.map((row) => ({ id: `stock-${row.id}`, level: Number(row.current_quantity) <= 0 ? 'CRITICAL' : 'HIGH', title: 'Stock critique', detail: `${row.code ?? ''} ${row.name}`, path: '/stock' })));
    const guarantees = await this.db.query(
      `SELECT g.id, g.lease_id, l.lease_number, g.status
       FROM lease_guarantees g
       LEFT JOIN leases l ON l.id = g.lease_id
       WHERE g.organization_id = $1
         AND g.deleted_at IS NULL
         AND l.deleted_at IS NULL
         AND COALESCE(g.amount, 0) > 0
         AND COALESCE(g.paid_amount, 0) < COALESCE(g.amount, 0)
       ORDER BY g.id DESC LIMIT 10`,
      [organizationId],
    );
    alerts.push(...guarantees.rows.map((row) => ({ id: `guarantee-${row.id}`, level: 'NORMAL', title: 'Garantie non payée', detail: this.leaseReference(row.lease_id, row.lease_number), path: '/leases' })));
    const maintenance = await this.db.query(
      `SELECT id, request_number, title, due_date, priority, status FROM maintenance_requests
       WHERE organization_id = $1
         AND deleted_at IS NULL
         AND status NOT IN ('RESOLVED', 'VALIDATED', 'CLOSED', 'CANCELLED')
         AND (priority = 'URGENT' OR due_date < NOW() OR status = 'WAITING_APPROVAL')
       ORDER BY due_date NULLS LAST LIMIT 10`,
      [organizationId],
    );
    alerts.push(...maintenance.rows.map((row) => ({ id: `maintenance-${row.id}`, level: row.priority === 'URGENT' ? 'CRITICAL' : 'HIGH', title: row.status === 'WAITING_APPROVAL' ? 'Maintenance en attente de validation' : row.due_date && new Date(row.due_date) < new Date() ? 'Maintenance en retard' : 'Maintenance urgente', detail: `${row.request_number} - ${row.title}`, due_date: row.due_date, path: `/maintenance/${row.id}` })));
    const notifications = await this.db.query(
      `SELECT id, title, message, priority, link_path FROM notifications
       WHERE organization_id = $1
         AND deleted_at IS NULL
         AND status = 'UNREAD'
         AND priority IN ('HIGH', 'CRITICAL')
         AND (user_id IS NULL OR user_id = $2)
       ORDER BY created_at DESC LIMIT 10`,
      [organizationId, this.context.userId()],
    );
    alerts.push(
      ...notifications.rows.map((row) => ({
        id: `notification-${row.id}`,
        level: row.priority,
        title: row.title,
        detail: row.message,
        path: row.link_path ?? '/communications',
      })),
    );
    return alerts;
  }

  async recent() {
    const { rows } = await this.db.query(
      `SELECT *
       FROM (
         SELECT DISTINCT ON (al.resource, al.resource_id, al.action, DATE_TRUNC('second', al.created_at))
                al.id, al.created_at AS date, al.resource AS module, al.action, al.path,
                CONCAT(u.first_name, ' ', u.last_name) AS user_name
         FROM audit_logs al
         LEFT JOIN app_users u ON u.id = al.user_id
         WHERE al.organization_id = $1
         ORDER BY al.resource, al.resource_id, al.action, DATE_TRUNC('second', al.created_at), al.id DESC
       ) recent_events
       ORDER BY date DESC, id DESC
       LIMIT 20`,
      [this.context.organizationId()],
    );
    return rows;
  }

  async kpis() {
    const role = normalizeRole(this.context.user()?.role);
    const organizationId = this.context.organizationId();
    const { rows } = await this.db.query(
      `SELECT
        (SELECT COALESCE(SUM(COALESCE(s.remaining_amount, i.total)), 0)::FLOAT FROM invoices i LEFT JOIN invoice_payment_summary s ON s.invoice_id = i.id WHERE i.organization_id = $1 AND i.deleted_at IS NULL AND i.status NOT IN ('PAID', 'CANCELLED') AND COALESCE(s.remaining_amount, i.total) > 0) AS unpaid_amount,
        (SELECT COALESCE(SUM(CASE WHEN type='IN' THEN amount ELSE -amount END),0)::FLOAT FROM cash_movements WHERE organization_id = $1 AND deleted_at IS NULL) AS cash_balance,
        (SELECT CASE WHEN COUNT(*) > 0 THEN ROUND((COUNT(*) FILTER (WHERE status='OCCUPIED')::NUMERIC / COUNT(*)::NUMERIC) * 100, 2)::FLOAT ELSE 0 END FROM units WHERE organization_id = $1 AND deleted_at IS NULL) AS occupancy_rate,
        (SELECT COUNT(*)::INT FROM stock_items WHERE organization_id = $1 AND deleted_at IS NULL AND status='ACTIVE' AND current_quantity <= minimum_quantity) AS stock_critical,
        (SELECT COUNT(*)::INT FROM maintenance_requests WHERE organization_id = $1 AND deleted_at IS NULL AND status NOT IN ('RESOLVED','VALIDATED','CLOSED','CANCELLED')) AS maintenance_open,
        (SELECT COALESCE(SUM(amount),0)::FLOAT FROM payments WHERE organization_id = $1 AND deleted_at IS NULL AND payment_date = CURRENT_DATE) AS payments_today,
        (SELECT COALESCE(SUM(amount),0)::FLOAT FROM cash_movements WHERE organization_id = $1 AND deleted_at IS NULL AND type='OUT' AND movement_date = CURRENT_DATE) AS expenses_today,
        (SELECT COUNT(*)::INT FROM invoices i LEFT JOIN invoice_payment_summary s ON s.invoice_id = i.id WHERE i.organization_id = $1 AND i.deleted_at IS NULL AND i.status IN ('DRAFT','UNPAID','PARTIAL') AND COALESCE(s.remaining_amount, i.total) > 0) AS pending_invoices,
        (SELECT COUNT(*)::INT FROM leases WHERE organization_id = $1 AND deleted_at IS NULL AND created_at::DATE = CURRENT_DATE) AS new_leases_today,
        (SELECT COUNT(*)::INT FROM leases WHERE organization_id = $1 AND deleted_at IS NULL AND status = 'ACTIVE' AND end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days') AS contracts_due,
        (SELECT COUNT(*)::INT FROM tenants WHERE organization_id = $1 AND deleted_at IS NULL AND status='ACTIVE') AS active_tenants,
        (SELECT COUNT(*)::INT FROM units WHERE organization_id = $1 AND deleted_at IS NULL AND status='VACANT') AS vacant_units`,
      [organizationId],
    );
    const all = rows[0];
    if (role === 'VIEWER') return this.pickKpis(all, ['unpaid_amount', 'cash_balance', 'occupancy_rate', 'stock_critical', 'maintenance_open']);
    if (role === 'EDITOR') return this.pickKpis(all, ['payments_today', 'expenses_today', 'cash_balance', 'pending_invoices', 'new_leases_today', 'contracts_due', 'active_tenants', 'vacant_units']);
    return all;
  }

  async today() {
    const tasks = await this.tasks();
    const today = new Date().toISOString().slice(0, 10);
    const notifications = await this.db.query(
      `SELECT id, created_at AS due_date, title, 'Communications' AS module, message AS object, priority, status, COALESCE(link_path, '/communications') AS path
       FROM notifications
       WHERE organization_id = $1
         AND deleted_at IS NULL
         AND status = 'UNREAD'
         AND created_at::DATE = CURRENT_DATE
         AND (user_id IS NULL OR user_id = $2)
       ORDER BY created_at DESC LIMIT 8`,
      [this.context.organizationId(), this.context.userId()],
    );
    const assignments = await this.db.query(
      `SELECT ma.id, ma.planned_date AS due_date, 'Intervention affectee' AS title, 'Maintenance' AS module,
              CONCAT(mr.request_number, ' - ', mr.title) AS object, mr.priority, mr.status,
              CONCAT('/maintenance/', mr.id) AS path
       FROM maintenance_assignments ma
       JOIN maintenance_requests mr ON mr.id = ma.maintenance_request_id
       WHERE ma.organization_id = $1 AND ma.deleted_at IS NULL AND ma.planned_date = CURRENT_DATE
       ORDER BY ma.planned_time NULLS LAST`,
      [this.context.organizationId()],
    );
    return [...tasks.filter((task) => String(task.due_date ?? '').slice(0, 10) === today), ...assignments.rows, ...notifications.rows];
  }

  async week() {
    const organizationId = this.context.organizationId();
    const [leases, guarantees, leaves, inventories, maintenance] = await Promise.all([
      this.db.query(`SELECT id, end_date AS due_date, 'Contrat à échéance' AS title, 'Baux' AS module FROM leases WHERE organization_id=$1 AND deleted_at IS NULL AND status = 'ACTIVE' AND end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'`, [organizationId]),
      this.db.query(`SELECT id, payment_date AS due_date, 'Garantie à suivre' AS title, 'Baux' AS module FROM lease_guarantees WHERE organization_id=$1 AND deleted_at IS NULL AND COALESCE(amount, 0) > 0 AND COALESCE(paid_amount, 0) < COALESCE(amount, 0) LIMIT 10`, [organizationId]),
      this.db.query(`SELECT id, start_date AS due_date, 'Congé prévu' AS title, 'Personnel' AS module FROM leaves WHERE organization_id=$1 AND deleted_at IS NULL AND start_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'`, [organizationId]),
      this.db.query(`SELECT id, count_date AS due_date, 'Inventaire en attente' AS title, 'Stock' AS module FROM inventory_counts WHERE organization_id=$1 AND deleted_at IS NULL AND status='DRAFT'`, [organizationId]),
      this.db.query(`SELECT id, due_date, 'Intervention programmée' AS title, 'Maintenance' AS module FROM maintenance_requests WHERE organization_id=$1 AND deleted_at IS NULL AND status NOT IN ('RESOLVED', 'VALIDATED', 'CLOSED', 'CANCELLED') AND due_date BETWEEN NOW() AND NOW() + INTERVAL '7 days'`, [organizationId]),
    ]);
    return [...leases.rows, ...guarantees.rows, ...leaves.rows, ...inventories.rows, ...maintenance.rows];
  }

  async search(query = '') {
    const q = `%${query}%`;
    if (!query.trim()) return [];
    const organizationId = this.context.organizationId();
    const [tenants, leases, invoices, buildings, units, employees] = await Promise.all([
      this.db.query(`SELECT id, CONCAT(first_name,' ',last_name) AS label, 'Locataire' AS type, '/tenants' AS path FROM tenants WHERE organization_id=$1 AND deleted_at IS NULL AND CONCAT(first_name,' ',last_name,' ',COALESCE(phone,'')) ILIKE $2 LIMIT 8`, [organizationId, q]),
      this.db.query(`SELECT id, CONCAT('B-', LPAD(COALESCE(lease_number, id)::TEXT, 5, '0')) AS label, 'Bail' AS type, '/leases' AS path FROM leases WHERE organization_id=$1 AND deleted_at IS NULL AND (id::TEXT ILIKE $2 OR COALESCE(lease_number, id)::TEXT ILIKE $2) LIMIT 8`, [organizationId, q]),
      this.db.query(`SELECT id, invoice_number AS label, 'Facture' AS type, CONCAT('/invoices/', id) AS path FROM invoices WHERE organization_id=$1 AND deleted_at IS NULL AND invoice_number ILIKE $2 LIMIT 8`, [organizationId, q]),
      this.db.query(`SELECT id, name AS label, 'Immeuble' AS type, '/buildings' AS path FROM buildings WHERE organization_id=$1 AND deleted_at IS NULL AND name ILIKE $2 LIMIT 8`, [organizationId, q]),
      this.db.query(`SELECT id, number AS label, 'Appartement' AS type, '/rental-units' AS path FROM units WHERE organization_id=$1 AND deleted_at IS NULL AND number ILIKE $2 LIMIT 8`, [organizationId, q]),
      this.db.query(`SELECT id, CONCAT(first_name,' ',last_name) AS label, 'Employé' AS type, '/staff' AS path FROM employees WHERE organization_id=$1 AND deleted_at IS NULL AND CONCAT(first_name,' ',last_name,' ',COALESCE(job_title,'')) ILIKE $2 LIMIT 8`, [organizationId, q]),
    ]);
    return [...tenants.rows, ...leases.rows, ...invoices.rows, ...buildings.rows, ...units.rows, ...employees.rows].slice(0, 25);
  }

  private task(id: string, title: string, object: string, module: string, dueDate: string | null, status: string, path: string, priority = 'NORMAL') {
    return { id, title, object, module, due_date: dueDate, status, path, priority };
  }

  private leaseReference(leaseId: number, leaseNumber?: number | null) {
    return `B-${String(leaseNumber ?? leaseId).padStart(5, '0')}`;
  }

  private progress(tasks: Array<Record<string, unknown>>, validations: Array<Record<string, unknown>>) {
    const done = tasks.filter((task) => ['DONE', 'CLOSED', 'PAID', 'APPROVED'].includes(String(task.status))).length;
    const remaining = Math.max(tasks.length - done, 0);
    return { done, remaining, validations_done: 0, total: tasks.length + validations.length, percent: tasks.length ? Math.round((done / tasks.length) * 100) : 0 };
  }

  private canSee(roles: string[], role: string) {
    return role === 'ADMIN' || roles.includes(role);
  }

  private priorityForWorkflow(type: string) {
    return ['EXPENSE_APPROVAL', 'MAINTENANCE_APPROVAL'].includes(type) ? 'HIGH' : 'NORMAL';
  }

  private pickKpis(values: Record<string, unknown>, keys: string[]) {
    return keys.reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = values[key];
      return acc;
    }, {});
  }
}
