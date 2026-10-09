import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { RequestContext } from "../auth/request-context";
import {
  BtpListQueryDto,
  CreateBtpExpenseDto,
  CreateBtpPhaseDto,
  CreateBtpProjectDto,
  UpdateBtpExpenseDto,
  UpdateBtpPhaseDto,
  UpdateBtpProjectDto,
} from "./btp.dto";

@Injectable()
export class BtpService {
  constructor(
    private readonly db: DatabaseService,
    private readonly context: RequestContext,
  ) {}

  async dashboard() {
    const organizationId = this.context.organizationId();
    const [projects, expenses] = await Promise.all([
      this.db.query(
        `SELECT COUNT(*)::INT AS total,
        COUNT(*) FILTER (WHERE status='ACTIVE')::INT AS active,
        COUNT(*) FILTER (WHERE status='PAUSED')::INT AS paused,
        COUNT(*) FILTER (WHERE status='COMPLETED')::INT AS completed,
        COALESCE(SUM(planned_budget) FILTER (WHERE currency='USD'),0)::FLOAT AS budget_usd,
        COALESCE(AVG(progress_percent) FILTER (WHERE status <> 'ARCHIVED'),0)::FLOAT AS progress
        FROM btp_projects WHERE organization_id=$1 AND deleted_at IS NULL`,
        [organizationId],
      ),
      this.db.query(
        `SELECT
        COALESCE(SUM(amount) FILTER (WHERE currency='USD' AND status IN ('APPROVED','PAID')),0)::FLOAT AS spent_usd,
        COALESCE(SUM(amount) FILTER (WHERE currency='CDF' AND status IN ('APPROVED','PAID')),0)::FLOAT AS spent_cdf,
        COUNT(*) FILTER (WHERE status='DRAFT')::INT AS pending
        FROM btp_expenses WHERE organization_id=$1 AND deleted_at IS NULL`,
        [organizationId],
      ),
    ]);
    const recent = await this.db.query(
      `SELECT p.id,p.project_ref,p.name,p.client_name,p.location_label,p.status,p.progress_percent,p.planned_budget,p.currency,
      COALESCE(x.spent,0)::FLOAT AS spent
      FROM btp_projects p LEFT JOIN LATERAL (
        SELECT SUM(e.amount) AS spent FROM btp_expenses e WHERE e.organization_id=p.organization_id AND e.project_id=p.id AND e.deleted_at IS NULL AND e.status IN ('APPROVED','PAID') AND e.currency=p.currency
      ) x ON TRUE WHERE p.organization_id=$1 AND p.deleted_at IS NULL ORDER BY p.updated_at DESC LIMIT 6`,
      [organizationId],
    );
    return {
      ...projects.rows[0],
      ...expenses.rows[0],
      recent_projects: recent.rows,
    };
  }

  async listProjects(query: BtpListQueryDto) {
    const organizationId = this.context.organizationId();
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const params: any[] = [organizationId];
    const filters = ["p.organization_id=$1", "p.deleted_at IS NULL"];
    if (query.search) {
      params.push(`%${query.search.replace(/[%_]/g, "\\$&")}%`);
      filters.push(
        `(p.project_ref ILIKE $${params.length} ESCAPE '\\' OR p.name ILIKE $${params.length} ESCAPE '\\' OR COALESCE(p.client_name,'') ILIKE $${params.length} ESCAPE '\\')`,
      );
    }
    if (query.status) {
      params.push(query.status);
      filters.push(`p.status=$${params.length}`);
    }
    const count = await this.db.query(
      `SELECT COUNT(*)::INT AS total FROM btp_projects p WHERE ${filters.join(" AND ")}`,
      params,
    );
    params.push(pageSize, (page - 1) * pageSize);
    const rows = await this.db.query(
      `SELECT p.*, COALESCE(ph.phase_count,0)::INT AS phase_count, COALESCE(ex.spent,0)::FLOAT AS spent
      FROM btp_projects p
      LEFT JOIN LATERAL (SELECT COUNT(*) AS phase_count FROM btp_phases bp WHERE bp.organization_id=p.organization_id AND bp.project_id=p.id AND bp.deleted_at IS NULL) ph ON TRUE
      LEFT JOIN LATERAL (SELECT SUM(be.amount) AS spent FROM btp_expenses be WHERE be.organization_id=p.organization_id AND be.project_id=p.id AND be.deleted_at IS NULL AND be.status IN ('APPROVED','PAID') AND be.currency=p.currency) ex ON TRUE
      WHERE ${filters.join(" AND ")} ORDER BY p.updated_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return {
      items: rows.rows,
      total: Number(count.rows[0]?.total ?? 0),
      page,
      pageSize,
    };
  }

  async getProject(id: number) {
    const organizationId = this.context.organizationId();
    const project = await this.db.query(
      `SELECT p.*, COALESCE(ex.spent,0)::FLOAT AS spent FROM btp_projects p
      LEFT JOIN LATERAL (SELECT SUM(e.amount) AS spent FROM btp_expenses e WHERE e.organization_id=p.organization_id AND e.project_id=p.id AND e.deleted_at IS NULL AND e.status IN ('APPROVED','PAID') AND e.currency=p.currency) ex ON TRUE
      WHERE p.id=$1 AND p.organization_id=$2 AND p.deleted_at IS NULL`,
      [id, organizationId],
    );
    if (!project.rows[0]) throw new NotFoundException("Chantier introuvable.");
    const [phases, expenses] = await Promise.all([
      this.db.query(
        `SELECT * FROM btp_phases WHERE project_id=$1 AND organization_id=$2 AND deleted_at IS NULL ORDER BY sort_order,name`,
        [id, organizationId],
      ),
      this.db.query(
        `SELECT e.*, p.name AS phase_name FROM btp_expenses e LEFT JOIN btp_phases p ON p.id=e.phase_id AND p.organization_id=e.organization_id WHERE e.project_id=$1 AND e.organization_id=$2 AND e.deleted_at IS NULL ORDER BY e.expense_date DESC,e.id DESC`,
        [id, organizationId],
      ),
    ]);
    return { ...project.rows[0], phases: phases.rows, expenses: expenses.rows };
  }

  async createProject(dto: CreateBtpProjectDto) {
    const organizationId = this.context.organizationId();
    const userId = this.context.userId();
    const { rows } = await this.db.query(
      `INSERT INTO btp_projects (organization_id,project_ref,name,client_name,location_label,description,status,start_date,planned_end_date,actual_end_date,manager_name,planned_budget,currency,progress_percent,created_by,updated_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15) RETURNING *`,
      [
        organizationId,
        dto.project_ref,
        dto.name,
        dto.client_name ?? null,
        dto.location_label ?? null,
        dto.description ?? null,
        dto.status ?? "DRAFT",
        dto.start_date ?? null,
        dto.planned_end_date ?? null,
        dto.actual_end_date ?? null,
        dto.manager_name ?? null,
        dto.planned_budget ?? 0,
        dto.currency ?? "USD",
        dto.progress_percent ?? 0,
        userId,
      ],
    );
    return rows[0];
  }

  async updateProject(id: number, dto: UpdateBtpProjectDto) {
    const current = await this.getProject(id);
    const organizationId = this.context.organizationId();
    const next = { ...current, ...dto };
    const { rows } = await this.db.query(
      `UPDATE btp_projects SET project_ref=$3,name=$4,client_name=$5,location_label=$6,description=$7,status=$8,start_date=$9,planned_end_date=$10,actual_end_date=$11,manager_name=$12,planned_budget=$13,currency=$14,progress_percent=$15,updated_by=$16,updated_at=NOW() WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL RETURNING *`,
      [
        id,
        organizationId,
        next.project_ref,
        next.name,
        next.client_name ?? null,
        next.location_label ?? null,
        next.description ?? null,
        next.status,
        next.start_date ?? null,
        next.planned_end_date ?? null,
        next.actual_end_date ?? null,
        next.manager_name ?? null,
        next.planned_budget,
        next.currency,
        next.progress_percent,
        this.context.userId(),
      ],
    );
    return rows[0];
  }

  async createPhase(dto: CreateBtpPhaseDto) {
    await this.getProject(dto.project_id);
    const organizationId = this.context.organizationId();
    const { rows } = await this.db.query(
      `INSERT INTO btp_phases (organization_id,project_id,phase_ref,name,description,status,start_date,planned_end_date,planned_budget,progress_percent,sort_order,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING *`,
      [
        organizationId,
        dto.project_id,
        dto.phase_ref,
        dto.name,
        dto.description ?? null,
        dto.status ?? "NOT_STARTED",
        dto.start_date ?? null,
        dto.planned_end_date ?? null,
        dto.planned_budget ?? 0,
        dto.progress_percent ?? 0,
        dto.sort_order ?? 100,
        this.context.userId(),
      ],
    );
    return rows[0];
  }

  async updatePhase(id: number, dto: UpdateBtpPhaseDto) {
    const organizationId = this.context.organizationId();
    const found = await this.db.query(
      `SELECT * FROM btp_phases WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`,
      [id, organizationId],
    );
    if (!found.rows[0]) throw new NotFoundException("Phase introuvable.");
    const next = { ...found.rows[0], ...dto };
    if (Number(next.project_id) !== Number(found.rows[0].project_id))
      throw new BadRequestException(
        "Le chantier d’une phase ne peut pas être remplacé.",
      );
    const { rows } = await this.db.query(
      `UPDATE btp_phases SET phase_ref=$3,name=$4,description=$5,status=$6,start_date=$7,planned_end_date=$8,planned_budget=$9,progress_percent=$10,sort_order=$11,updated_by=$12,updated_at=NOW() WHERE id=$1 AND organization_id=$2 RETURNING *`,
      [
        id,
        organizationId,
        next.phase_ref,
        next.name,
        next.description ?? null,
        next.status,
        next.start_date ?? null,
        next.planned_end_date ?? null,
        next.planned_budget,
        next.progress_percent,
        next.sort_order,
        this.context.userId(),
      ],
    );
    return rows[0];
  }

  async listExpenses(query: BtpListQueryDto) {
    const organizationId = this.context.organizationId();
    const params: any[] = [organizationId];
    const filters = ["e.organization_id=$1", "e.deleted_at IS NULL"];
    if (query.project_id) {
      params.push(query.project_id);
      filters.push(`e.project_id=$${params.length}`);
    }
    if (query.status) {
      params.push(query.status);
      filters.push(`e.status=$${params.length}`);
    }
    const { rows } = await this.db.query(
      `SELECT e.*,p.name AS project_name,ph.name AS phase_name FROM btp_expenses e JOIN btp_projects p ON p.id=e.project_id AND p.organization_id=e.organization_id LEFT JOIN btp_phases ph ON ph.id=e.phase_id AND ph.organization_id=e.organization_id WHERE ${filters.join(" AND ")} ORDER BY e.expense_date DESC,e.id DESC`,
      params,
    );
    return { items: rows, total: rows.length };
  }

  async createExpense(dto: CreateBtpExpenseDto) {
    const project: any = await this.getProject(dto.project_id);
    const organizationId = this.context.organizationId();
    if (
      dto.phase_id &&
      !project.phases.some(
        (phase: any) => Number(phase.id) === Number(dto.phase_id),
      )
    )
      throw new BadRequestException(
        "La phase ne correspond pas à ce chantier.",
      );
    const { rows } = await this.db.query(
      `INSERT INTO btp_expenses (organization_id,project_id,phase_id,expense_date,reference,category,description,supplier_name,amount,currency,status,payment_method,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) RETURNING *`,
      [
        organizationId,
        dto.project_id,
        dto.phase_id ?? null,
        dto.expense_date,
        dto.reference ?? null,
        dto.category,
        dto.description,
        dto.supplier_name ?? null,
        dto.amount,
        dto.currency ?? project.currency,
        dto.status ?? "DRAFT",
        dto.payment_method ?? null,
        this.context.userId(),
      ],
    );
    return rows[0];
  }

  async updateExpense(id: number, dto: UpdateBtpExpenseDto) {
    const organizationId = this.context.organizationId();
    const found = await this.db.query(
      `SELECT * FROM btp_expenses WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`,
      [id, organizationId],
    );
    if (!found.rows[0]) throw new NotFoundException("Dépense introuvable.");
    const next = { ...found.rows[0], ...dto };
    if (Number(next.project_id) !== Number(found.rows[0].project_id))
      throw new BadRequestException(
        "Le chantier d’une dépense ne peut pas être remplacé.",
      );
    const { rows } = await this.db.query(
      `UPDATE btp_expenses SET phase_id=$3,expense_date=$4,reference=$5,category=$6,description=$7,supplier_name=$8,amount=$9,currency=$10,status=$11,payment_method=$12,updated_by=$13,updated_at=NOW() WHERE id=$1 AND organization_id=$2 RETURNING *`,
      [
        id,
        organizationId,
        next.phase_id ?? null,
        next.expense_date,
        next.reference ?? null,
        next.category,
        next.description,
        next.supplier_name ?? null,
        next.amount,
        next.currency,
        next.status,
        next.payment_method ?? null,
        this.context.userId(),
      ],
    );
    return rows[0];
  }
}
