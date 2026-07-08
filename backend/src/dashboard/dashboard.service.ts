import { Injectable } from '@nestjs/common';
import { RequestContext } from '../auth/request-context';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class DashboardService {
  constructor(private readonly db: DatabaseService, private readonly context: RequestContext) {}

  async summary(filters: { period?: string; buildingId?: number; city?: string; manager?: string; currency?: string } = {}) {
    const organizationId = this.context.organizationId();
    const buildingFilter = filters.buildingId ?? null;
    const cityFilter = filters.city || null;
    const { rows } = await this.db.query(`
      SELECT
        (SELECT COUNT(*)::INT FROM buildings WHERE organization_id = $1 AND deleted_at IS NULL AND ($2::INT IS NULL OR id = $2) AND ($3::TEXT IS NULL OR city = $3)) AS buildings,
        (SELECT COUNT(*)::INT FROM tenants WHERE organization_id = $1 AND deleted_at IS NULL AND status = 'ACTIVE') AS tenants,
        (SELECT COUNT(*)::INT FROM units u JOIN buildings b ON b.id = u.building_id WHERE u.organization_id = $1 AND u.deleted_at IS NULL AND ($2::INT IS NULL OR b.id = $2) AND ($3::TEXT IS NULL OR b.city = $3)) AS units,
        (SELECT COUNT(*)::INT FROM invoices i LEFT JOIN buildings b ON b.id = i.building_id WHERE i.organization_id = $1 AND i.deleted_at IS NULL AND ($2::INT IS NULL OR b.id = $2) AND ($3::TEXT IS NULL OR b.city = $3)) AS invoices,
        (SELECT COUNT(*)::INT FROM payments WHERE organization_id = $1 AND deleted_at IS NULL) AS payments,
        (SELECT COALESCE(SUM(total), 0)::FLOAT FROM invoices i LEFT JOIN buildings b ON b.id = i.building_id WHERE i.organization_id = $1 AND i.deleted_at IS NULL AND ($2::INT IS NULL OR b.id = $2) AND ($3::TEXT IS NULL OR b.city = $3)) AS total_invoiced,
        (SELECT COALESCE(SUM(amount), 0)::FLOAT FROM payments WHERE organization_id = $1 AND deleted_at IS NULL) AS total_collected,
        (SELECT COALESCE(SUM(total), 0)::FLOAT FROM invoices i LEFT JOIN buildings b ON b.id = i.building_id WHERE i.organization_id = $1 AND i.deleted_at IS NULL AND ($2::INT IS NULL OR b.id = $2) AND ($3::TEXT IS NULL OR b.city = $3)) -
          (SELECT COALESCE(SUM(amount), 0)::FLOAT FROM payments WHERE organization_id = $1 AND deleted_at IS NULL) AS total_remaining,
        (SELECT COUNT(*)::INT FROM invoices i LEFT JOIN buildings b ON b.id = i.building_id WHERE i.organization_id = $1 AND i.deleted_at IS NULL AND i.status <> 'PAID' AND ($2::INT IS NULL OR b.id = $2) AND ($3::TEXT IS NULL OR b.city = $3)) AS unpaid_invoices,
        (SELECT COUNT(*)::INT FROM invoices i LEFT JOIN buildings b ON b.id = i.building_id WHERE i.organization_id = $1 AND i.deleted_at IS NULL AND i.status <> 'PAID' AND i.due_date < CURRENT_DATE AND ($2::INT IS NULL OR b.id = $2) AND ($3::TEXT IS NULL OR b.city = $3)) AS overdue_invoices,
        (SELECT COUNT(*)::INT FROM stock_items WHERE organization_id = $1 AND deleted_at IS NULL AND status = 'ACTIVE' AND current_quantity <= minimum_quantity) AS stock_alerts,
        (SELECT COUNT(*)::INT FROM maintenance_requests WHERE organization_id = $1 AND deleted_at IS NULL AND status NOT IN ('CLOSED', 'CANCELLED')) AS maintenance_open,
        (SELECT COUNT(*)::INT FROM maintenance_requests WHERE organization_id = $1 AND deleted_at IS NULL AND priority = 'URGENT' AND status NOT IN ('CLOSED', 'CANCELLED')) AS maintenance_urgent,
        (SELECT COUNT(*)::INT FROM maintenance_requests WHERE organization_id = $1 AND deleted_at IS NULL AND due_date < NOW() AND status NOT IN ('RESOLVED', 'VALIDATED', 'CLOSED', 'CANCELLED')) AS maintenance_overdue,
        (SELECT COUNT(*)::INT FROM maintenance_requests WHERE organization_id = $1 AND deleted_at IS NULL AND status IN ('RESOLVED', 'VALIDATED', 'CLOSED')) AS maintenance_completed,
        (SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (resolved_at - reported_at)) / 3600), 0)::FLOAT FROM maintenance_requests WHERE organization_id = $1 AND deleted_at IS NULL AND resolved_at IS NOT NULL) AS maintenance_avg_resolution_hours,
        (SELECT COALESCE(SUM(amount), 0)::FLOAT FROM maintenance_expenses WHERE organization_id = $1 AND deleted_at IS NULL AND status <> 'REJECTED' AND DATE_TRUNC('month', expense_date) = DATE_TRUNC('month', CURRENT_DATE)) AS maintenance_month_cost,
        (SELECT COALESCE(SUM(amount), 0)::FLOAT FROM maintenance_expenses WHERE organization_id = $1 AND deleted_at IS NULL AND status <> 'REJECTED' AND DATE_TRUNC('year', expense_date) = DATE_TRUNC('year', CURRENT_DATE)) AS maintenance_year_cost
    `, [organizationId, buildingFilter, cityFilter]);

    const revenueByBuilding = await this.db.query(`
      SELECT b.id, b.name, b.city, COALESCE(SUM(i.total), 0)::FLOAT AS value,
             CASE WHEN COUNT(u.id) > 0 THEN ROUND((COUNT(*) FILTER (WHERE u.status = 'OCCUPIED')::NUMERIC / COUNT(u.id)::NUMERIC) * 100, 2)::FLOAT ELSE 0 END AS occupancy_rate
      FROM buildings b
      LEFT JOIN units u ON u.building_id = b.id
      LEFT JOIN tenants t ON t.unit_id = u.id
      LEFT JOIN invoices i ON i.tenant_id = t.id
      WHERE b.organization_id = $1 AND b.deleted_at IS NULL
        AND ($2::INT IS NULL OR b.id = $2)
        AND ($3::TEXT IS NULL OR b.city = $3)
      GROUP BY b.id, b.name, b.city
      ORDER BY b.name
    `, [organizationId, buildingFilter, cityFilter]);
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
      WITH months AS (
        SELECT TO_CHAR(month_date, 'YYYY-MM') AS name, month_date
        FROM generate_series(date_trunc('month', CURRENT_DATE) - INTERVAL '11 months', date_trunc('month', CURRENT_DATE), INTERVAL '1 month') AS month_date
      )
      SELECT m.name, COALESCE(SUM(p.amount), 0)::FLOAT AS value
      FROM months m
      LEFT JOIN payments p ON TO_CHAR(p.payment_date, 'YYYY-MM') = m.name AND p.organization_id = $1 AND p.deleted_at IS NULL
      GROUP BY m.name, m.month_date
      ORDER BY m.month_date
    `, [organizationId]);
    const buildings = await this.db.query(`SELECT id, name, city, building_type FROM buildings WHERE organization_id = $1 AND deleted_at IS NULL ORDER BY name`, [organizationId]);
    const cities = await this.db.query(`SELECT DISTINCT city FROM buildings WHERE organization_id = $1 AND deleted_at IS NULL AND city IS NOT NULL ORDER BY city`, [organizationId]);
    const currentMonth = await this.db.query(`SELECT
      (SELECT COALESCE(SUM(total),0)::FLOAT FROM invoices WHERE organization_id=$1 AND deleted_at IS NULL AND date_trunc('month', issue_date)=date_trunc('month', CURRENT_DATE)) AS invoiced,
      (SELECT COALESCE(SUM(amount),0)::FLOAT FROM payments WHERE organization_id=$1 AND deleted_at IS NULL AND date_trunc('month', payment_date)=date_trunc('month', CURRENT_DATE)) AS collected`, [organizationId]);
    const previousMonth = await this.db.query(`SELECT
      (SELECT COALESCE(SUM(total),0)::FLOAT FROM invoices WHERE organization_id=$1 AND deleted_at IS NULL AND date_trunc('month', issue_date)=date_trunc('month', CURRENT_DATE - INTERVAL '1 month')) AS invoiced,
      (SELECT COALESCE(SUM(amount),0)::FLOAT FROM payments WHERE organization_id=$1 AND deleted_at IS NULL AND date_trunc('month', payment_date)=date_trunc('month', CURRENT_DATE - INTERVAL '1 month')) AS collected`, [organizationId]);

    return {
      ...rows[0],
      revenue_by_building: revenueByBuilding.rows,
      invoice_statuses: invoiceStatuses.rows,
      unit_occupancy: unitOccupancy.rows,
      collections_by_month: collectionsByMonth.rows,
      buildings_options: buildings.rows,
      cities: cities.rows.map((row) => row.city),
      trends: {
        total_invoiced: this.percentChange(Number(previousMonth.rows[0]?.invoiced ?? 0), Number(currentMonth.rows[0]?.invoiced ?? 0)),
        total_collected: this.percentChange(Number(previousMonth.rows[0]?.collected ?? 0), Number(currentMonth.rows[0]?.collected ?? 0)),
        total_remaining: 0,
      },
      last_updated_at: new Date().toISOString(),
    };
  }

  private percentChange(previous: number, current: number) {
    if (!previous && !current) return 0;
    if (!previous) return 100;
    return Math.round(((current - previous) / previous) * 100);
  }
}
