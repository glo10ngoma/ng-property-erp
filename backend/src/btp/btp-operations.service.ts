import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { RequestContext } from "../auth/request-context";
import { DatabaseService } from "../database/database.service";
import {
  BtpScopeQueryDto,
  CreateBtpBudgetLineDto,
  CreateBtpClientContractDto,
  CreateBtpClientTransactionDto,
  CreateBtpPurchaseDto,
  CreateBtpSiteLogDto,
  CreateBtpStockMovementDto,
} from "./btp-operations.dto";

@Injectable()
export class BtpOperationsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly context: RequestContext,
  ) {}
  private org() {
    return this.context.organizationId();
  }
  private user() {
    return this.context.userId();
  }

  private async assertProject(projectId: number, phaseId?: number) {
    const project = await this.db.query(
      `SELECT id,currency FROM btp_projects WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`,
      [projectId, this.org()],
    );
    if (!project.rows[0]) throw new NotFoundException("Chantier introuvable.");
    if (phaseId) {
      const phase = await this.db.query(
        `SELECT id FROM btp_phases WHERE id=$1 AND project_id=$2 AND organization_id=$3 AND deleted_at IS NULL`,
        [phaseId, projectId, this.org()],
      );
      if (!phase.rows[0])
        throw new BadRequestException(
          "Le lot ne correspond pas à ce chantier.",
        );
    }
    return project.rows[0];
  }

  async budget(query: BtpScopeQueryDto) {
    const params: unknown[] = [this.org()];
    const projectFilter = query.project_id
      ? (params.push(query.project_id), ` AND b.project_id=$${params.length}`)
      : "";
    const rows = await this.db.query(
      `SELECT b.*,p.name AS project_name,ph.name AS phase_name,
      COALESCE((SELECT SUM(x.amount) FROM btp_expenses x WHERE x.organization_id=b.organization_id AND x.project_id=b.project_id AND x.deleted_at IS NULL AND x.status IN ('APPROVED','PAID') AND x.currency=b.currency AND x.category=b.category),0)::FLOAT AS spent,
      COALESCE((SELECT SUM(x.amount) FROM btp_purchases x WHERE x.organization_id=b.organization_id AND x.project_id=b.project_id AND x.deleted_at IS NULL AND x.status IN ('APPROVED','ORDERED','PARTIAL','RECEIVED') AND x.currency=b.currency AND x.category=b.category),0)::FLOAT AS committed
      FROM btp_budget_lines b JOIN btp_projects p ON p.id=b.project_id AND p.organization_id=b.organization_id LEFT JOIN btp_phases ph ON ph.id=b.phase_id AND ph.organization_id=b.organization_id
      WHERE b.organization_id=$1 AND b.deleted_at IS NULL${projectFilter} ORDER BY p.name,b.category,b.label`,
      params,
    );
    return { items: rows.rows, total: rows.rowCount };
  }
  async createBudget(dto: CreateBtpBudgetLineDto) {
    const project = await this.assertProject(dto.project_id, dto.phase_id);
    const r = await this.db.query(
      `INSERT INTO btp_budget_lines (organization_id,project_id,phase_id,category,label,planned_amount,currency,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        this.org(),
        dto.project_id,
        dto.phase_id ?? null,
        dto.category,
        dto.label,
        dto.planned_amount,
        dto.currency ?? project.currency,
        this.user(),
      ],
    );
    return r.rows[0];
  }

  async purchases(query: BtpScopeQueryDto) {
    return this.list("btp_purchases", query, "document_date");
  }
  async createPurchase(dto: CreateBtpPurchaseDto) {
    const project = await this.assertProject(dto.project_id, dto.phase_id);
    const r = await this.db.query(
      `INSERT INTO btp_purchases (organization_id,project_id,phase_id,document_type,reference,supplier_name,category,description,document_date,expected_date,amount,currency,status,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14) RETURNING *`,
      [
        this.org(),
        dto.project_id,
        dto.phase_id ?? null,
        dto.document_type,
        dto.reference,
        dto.supplier_name ?? null,
        dto.category,
        dto.description,
        dto.document_date,
        dto.expected_date ?? null,
        dto.amount ?? 0,
        dto.currency ?? project.currency,
        dto.status ?? "DRAFT",
        this.user(),
      ],
    );
    return r.rows[0];
  }

  async stock(query: BtpScopeQueryDto) {
    return this.list("btp_stock_movements", query, "movement_date");
  }
  async createStock(dto: CreateBtpStockMovementDto) {
    await this.assertProject(dto.project_id, dto.phase_id);
    const r = await this.db.query(
      `INSERT INTO btp_stock_movements (organization_id,project_id,phase_id,movement_type,movement_date,material_name,quantity,unit,reference,notes,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        this.org(),
        dto.project_id,
        dto.phase_id ?? null,
        dto.movement_type,
        dto.movement_date,
        dto.material_name,
        dto.quantity,
        dto.unit,
        dto.reference ?? null,
        dto.notes ?? null,
        this.user(),
      ],
    );
    return r.rows[0];
  }

  async logs(query: BtpScopeQueryDto) {
    return this.list("btp_site_logs", query, "event_date");
  }
  async createLog(dto: CreateBtpSiteLogDto) {
    await this.assertProject(dto.project_id, dto.phase_id);
    const r = await this.db.query(
      `INSERT INTO btp_site_logs (organization_id,project_id,phase_id,log_type,event_date,title,content,status,attachment_url,progress_percent,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING *`,
      [
        this.org(),
        dto.project_id,
        dto.phase_id ?? null,
        dto.log_type,
        dto.event_date,
        dto.title,
        dto.content ?? null,
        dto.status ?? "OPEN",
        dto.attachment_url ?? null,
        dto.progress_percent ?? null,
        this.user(),
      ],
    );
    return r.rows[0];
  }

  async contracts(query: BtpScopeQueryDto) {
    return this.list("btp_client_contracts", query, "created_at");
  }
  async createContract(dto: CreateBtpClientContractDto) {
    const project = await this.assertProject(dto.project_id);
    const r = await this.db.query(
      `INSERT INTO btp_client_contracts (organization_id,project_id,reference,client_name,description,start_date,end_date,contract_amount,currency,status,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING *`,
      [
        this.org(),
        dto.project_id,
        dto.reference,
        dto.client_name,
        dto.description ?? null,
        dto.start_date ?? null,
        dto.end_date ?? null,
        dto.contract_amount,
        dto.currency ?? project.currency,
        dto.status ?? "DRAFT",
        this.user(),
      ],
    );
    return r.rows[0];
  }

  async transactions(query: BtpScopeQueryDto) {
    return this.list("btp_client_transactions", query, "transaction_date");
  }
  async createTransaction(dto: CreateBtpClientTransactionDto) {
    const project = await this.assertProject(dto.project_id);
    if (dto.contract_id) {
      const c = await this.db.query(
        `SELECT id FROM btp_client_contracts WHERE id=$1 AND project_id=$2 AND organization_id=$3 AND deleted_at IS NULL`,
        [dto.contract_id, dto.project_id, this.org()],
      );
      if (!c.rows[0])
        throw new BadRequestException(
          "Le contrat ne correspond pas à ce chantier.",
        );
    }
    const r = await this.db.query(
      `INSERT INTO btp_client_transactions (organization_id,project_id,contract_id,transaction_type,reference,transaction_date,due_date,description,amount,currency,status,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING *`,
      [
        this.org(),
        dto.project_id,
        dto.contract_id ?? null,
        dto.transaction_type,
        dto.reference,
        dto.transaction_date,
        dto.due_date ?? null,
        dto.description,
        dto.amount,
        dto.currency ?? project.currency,
        dto.status ?? (dto.transaction_type === "PAYMENT" ? "PAID" : "ISSUED"),
        this.user(),
      ],
    );
    return r.rows[0];
  }

  async reports(query: BtpScopeQueryDto) {
    const params: unknown[] = [this.org()];
    const filter = query.project_id
      ? (params.push(query.project_id), ` AND p.id=$${params.length}`)
      : "";
    const rows = await this.db.query(
      `SELECT p.id,p.project_ref,p.name,p.status,p.progress_percent,p.planned_budget,p.currency,
      COALESCE((SELECT SUM(e.amount) FROM btp_expenses e WHERE e.organization_id=p.organization_id AND e.project_id=p.id AND e.deleted_at IS NULL AND e.status IN ('APPROVED','PAID') AND e.currency=p.currency),0)::FLOAT AS spent,
      COALESCE((SELECT SUM(x.amount) FROM btp_purchases x WHERE x.organization_id=p.organization_id AND x.project_id=p.id AND x.deleted_at IS NULL AND x.status IN ('APPROVED','ORDERED','PARTIAL','RECEIVED') AND x.currency=p.currency),0)::FLOAT AS committed,
      COALESCE((SELECT SUM(t.amount) FROM btp_client_transactions t WHERE t.organization_id=p.organization_id AND t.project_id=p.id AND t.deleted_at IS NULL AND t.transaction_type='INVOICE' AND t.status<>'CANCELLED' AND t.currency=p.currency),0)::FLOAT AS invoiced,
      COALESCE((SELECT SUM(t.amount) FROM btp_client_transactions t WHERE t.organization_id=p.organization_id AND t.project_id=p.id AND t.deleted_at IS NULL AND t.transaction_type='PAYMENT' AND t.status<>'CANCELLED' AND t.currency=p.currency),0)::FLOAT AS collected
      FROM btp_projects p WHERE p.organization_id=$1 AND p.deleted_at IS NULL${filter} ORDER BY p.name`,
      params,
    );
    return { items: rows.rows, total: rows.rowCount };
  }

  private async list(table: string, query: BtpScopeQueryDto, order: string) {
    const allowed = new Set([
      "btp_purchases",
      "btp_stock_movements",
      "btp_site_logs",
      "btp_client_contracts",
      "btp_client_transactions",
    ]);
    if (!allowed.has(table)) throw new BadRequestException();
    const params: unknown[] = [this.org()];
    let filter = "";
    if (query.project_id) {
      params.push(query.project_id);
      filter += ` AND x.project_id=$${params.length}`;
    }
    if (
      query.status &&
      [
        "btp_purchases",
        "btp_site_logs",
        "btp_client_contracts",
        "btp_client_transactions",
      ].includes(table)
    ) {
      params.push(query.status);
      filter += ` AND x.status=$${params.length}`;
    }
    const hasPhase = [
      "btp_purchases",
      "btp_stock_movements",
      "btp_site_logs",
    ].includes(table);
    const phaseSelect = hasPhase ? ",ph.name AS phase_name" : "";
    const phaseJoin = hasPhase
      ? " LEFT JOIN btp_phases ph ON ph.id=x.phase_id AND ph.organization_id=x.organization_id"
      : "";
    const r = await this.db.query(
      `SELECT x.*,p.name AS project_name${phaseSelect} FROM ${table} x JOIN btp_projects p ON p.id=x.project_id AND p.organization_id=x.organization_id${phaseJoin} WHERE x.organization_id=$1 AND x.deleted_at IS NULL${filter} ORDER BY x.${order} DESC,x.id DESC`,
      params,
    );
    return { items: r.rows, total: r.rowCount };
  }
}
