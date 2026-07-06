import { Injectable } from '@nestjs/common';
import { RequestContext } from '../auth/request-context';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class DashboardService {
  constructor(private readonly db: DatabaseService, private readonly context: RequestContext) {}

  async summary() {
    const organizationId = this.context.organizationId();
    const { rows } = await this.db.query(`
      SELECT
        (SELECT COUNT(*)::INT FROM buildings WHERE organization_id = $1 AND deleted_at IS NULL) AS buildings,
        (SELECT COUNT(*)::INT FROM tenants WHERE organization_id = $1 AND deleted_at IS NULL AND status = 'ACTIVE') AS tenants,
        (SELECT COUNT(*)::INT FROM units WHERE organization_id = $1 AND deleted_at IS NULL) AS units,
        (SELECT COUNT(*)::INT FROM invoices WHERE organization_id = $1 AND deleted_at IS NULL) AS invoices,
        (SELECT COUNT(*)::INT FROM payments WHERE organization_id = $1 AND deleted_at IS NULL) AS payments,
        (SELECT COALESCE(SUM(total), 0)::FLOAT FROM invoices WHERE organization_id = $1 AND deleted_at IS NULL) AS total_invoiced,
        (SELECT COALESCE(SUM(amount), 0)::FLOAT FROM payments WHERE organization_id = $1 AND deleted_at IS NULL) AS total_collected,
        (SELECT COALESCE(SUM(total), 0)::FLOAT FROM invoices WHERE organization_id = $1 AND deleted_at IS NULL) -
          (SELECT COALESCE(SUM(amount), 0)::FLOAT FROM payments WHERE organization_id = $1 AND deleted_at IS NULL) AS total_remaining,
        (SELECT COUNT(*)::INT FROM invoices WHERE organization_id = $1 AND deleted_at IS NULL AND status <> 'PAID') AS unpaid_invoices,
        (SELECT COUNT(*)::INT FROM invoices WHERE organization_id = $1 AND deleted_at IS NULL AND status <> 'PAID' AND due_date < CURRENT_DATE) AS overdue_invoices,
        (SELECT COUNT(*)::INT FROM stock_items WHERE organization_id = $1 AND deleted_at IS NULL AND status = 'ACTIVE' AND current_quantity <= minimum_quantity) AS stock_alerts,
        (SELECT COUNT(*)::INT FROM maintenance_requests WHERE organization_id = $1 AND deleted_at IS NULL AND status NOT IN ('CLOSED', 'CANCELLED')) AS maintenance_open,
        (SELECT COUNT(*)::INT FROM maintenance_requests WHERE organization_id = $1 AND deleted_at IS NULL AND priority = 'URGENT' AND status NOT IN ('CLOSED', 'CANCELLED')) AS maintenance_urgent,
        (SELECT COUNT(*)::INT FROM maintenance_requests WHERE organization_id = $1 AND deleted_at IS NULL AND due_date < NOW() AND status NOT IN ('RESOLVED', 'VALIDATED', 'CLOSED', 'CANCELLED')) AS maintenance_overdue,
        (SELECT COUNT(*)::INT FROM maintenance_requests WHERE organization_id = $1 AND deleted_at IS NULL AND status IN ('RESOLVED', 'VALIDATED', 'CLOSED')) AS maintenance_completed,
        (SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (resolved_at - reported_at)) / 3600), 0)::FLOAT FROM maintenance_requests WHERE organization_id = $1 AND deleted_at IS NULL AND resolved_at IS NOT NULL) AS maintenance_avg_resolution_hours,
        (SELECT COALESCE(SUM(amount), 0)::FLOAT FROM maintenance_expenses WHERE organization_id = $1 AND deleted_at IS NULL AND status <> 'REJECTED' AND DATE_TRUNC('month', expense_date) = DATE_TRUNC('month', CURRENT_DATE)) AS maintenance_month_cost,
        (SELECT COALESCE(SUM(amount), 0)::FLOAT FROM maintenance_expenses WHERE organization_id = $1 AND deleted_at IS NULL AND status <> 'REJECTED' AND DATE_TRUNC('year', expense_date) = DATE_TRUNC('year', CURRENT_DATE)) AS maintenance_year_cost
    `, [organizationId]);

    const revenueByBuilding = await this.db.query(`
      SELECT b.name, COALESCE(SUM(i.total), 0)::FLOAT AS value
      FROM buildings b
      LEFT JOIN units u ON u.building_id = b.id
      LEFT JOIN tenants t ON t.unit_id = u.id
      LEFT JOIN invoices i ON i.tenant_id = t.id
      WHERE b.organization_id = $1 AND b.deleted_at IS NULL
      GROUP BY b.id, b.name
      ORDER BY b.name
    `, [organizationId]);
    const invoiceStatuses = await this.db.query(`
      SELECT status AS name, COUNT(*)::INT AS value
      FROM invoices
      WHERE organization_id = $1 AND deleted_at IS NULL
      GROUP BY status
      ORDER BY status
    `, [organizationId]);
    const unitOccupancy = await this.db.query(`
      SELECT status AS name, COUNT(*)::INT AS value
      FROM units
      WHERE organization_id = $1 AND deleted_at IS NULL
      GROUP BY status
      ORDER BY status
    `, [organizationId]);
    const collectionsByMonth = await this.db.query(`
      SELECT TO_CHAR(payment_date, 'YYYY-MM') AS name, COALESCE(SUM(amount), 0)::FLOAT AS value
      FROM payments
      WHERE organization_id = $1 AND deleted_at IS NULL
      GROUP BY TO_CHAR(payment_date, 'YYYY-MM')
      ORDER BY name
    `, [organizationId]);

    return {
      ...rows[0],
      revenue_by_building: revenueByBuilding.rows,
      invoice_statuses: invoiceStatuses.rows,
      unit_occupancy: unitOccupancy.rows,
      collections_by_month: collectionsByMonth.rows,
    };
  }
}
