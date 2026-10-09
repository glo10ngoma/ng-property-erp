import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  createBtpExpense,
  createBtpPhase,
  createBtpProject,
  getBtpDashboard,
  getBtpProject,
  listBtpExpenses,
  listBtpProjects,
  updateBtpProject,
} from "../api/btp.api";
import type { BtpDashboard, BtpExpense, BtpPhase, BtpProject } from "../types";
import {
  BtpDataTable,
  BtpEmptyState,
  BtpField,
  BtpFilterBar,
  BtpFormActions,
  BtpFormSection,
  BtpInfoList,
  BtpKpiCard,
  BtpKpiGrid,
  BtpModulePage,
  BtpNotice,
  BtpSection,
  BtpStatusBadge,
  type BtpTab,
} from "../components/BtpUi";

const projectLabels: Record<string, string> = {
  DRAFT: "Brouillon",
  ACTIVE: "Actif",
  PAUSED: "En pause",
  COMPLETED: "Terminé",
  ARCHIVED: "Archivé",
};
const phaseLabels: Record<string, string> = {
  NOT_STARTED: "Non démarrée",
  IN_PROGRESS: "En cours",
  BLOCKED: "Bloquée",
  COMPLETED: "Terminée",
  CANCELLED: "Annulée",
};
const expenseLabels: Record<string, string> = {
  DRAFT: "Brouillon",
  APPROVED: "Approuvée",
  PAID: "Payée",
  CANCELLED: "Annulée",
};
const categoryLabels: Record<string, string> = {
  MATERIALS: "Matériaux",
  LABOR: "Main-d’œuvre",
  SUBCONTRACTING: "Sous-traitance",
  TRANSPORT: "Transport",
  EQUIPMENT: "Équipement",
  OTHER: "Autre",
};
const tone = (status: string) =>
  status === "ACTIVE" ||
  status === "COMPLETED" ||
  status === "PAID" ||
  status === "APPROVED"
    ? "success"
    : status === "PAUSED" || status === "IN_PROGRESS"
      ? "warning"
      : status === "BLOCKED" || status === "CANCELLED"
        ? "danger"
        : "info";
const money = (value: unknown, currency = "USD") =>
  `${Number(value ?? 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
const date = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(
        new Date(`${value.slice(0, 10)}T12:00:00`),
      )
    : "—";
const todayInKinshasa = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Kinshasa",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const err = (error: unknown) => {
  const e = error as { response?: { data?: { message?: string | string[] } } };
  const m = e?.response?.data?.message;
  return Array.isArray(m) ? m.join(" ") : m || "Une erreur est survenue.";
};

export function BtpDashboardPage() {
  const [data, setData] = useState<BtpDashboard | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    getBtpDashboard()
      .then(setData)
      .catch((e) => setError(err(e)));
  }, []);
  return (
    <BtpModulePage
      title="Pilotage BTP"
      subtitle="Suivez les chantiers, les budgets, les dépenses et l’avancement depuis un espace unique."
      activeTab="overview"
      action={
        <Link
          className="sales-v21-btn sales-v21-btn-primary"
          to="/btp/projects/new"
        >
          Nouveau chantier
        </Link>
      }
    >
      {error ? <BtpNotice tone="danger">{error}</BtpNotice> : null}
      {data ? (
        <>
          <BtpKpiGrid>
            <BtpKpiCard label="Chantiers" value={data.total} />
            <BtpKpiCard label="Actifs" value={data.active} />
            <BtpKpiCard
              label="Avancement moyen"
              value={`${Number(data.progress).toFixed(1)} %`}
            />
            <BtpKpiCard label="Budget prévu" value={money(data.budget_usd)} />
            <BtpKpiCard label="Dépensé USD" value={money(data.spent_usd)} />
            <BtpKpiCard
              label="Dépensé CDF"
              value={money(data.spent_cdf, "CDF")}
            />
          </BtpKpiGrid>
          <BtpSection
            title="Chantiers récents"
            description="Lecture rapide des opérations en cours."
          >
            {data.recent_projects.length ? (
              <ProjectTable rows={data.recent_projects} />
            ) : (
              <BtpEmptyState
                title="Aucun chantier"
                description="Créez le premier chantier pour commencer le pilotage."
                action={
                  <Link
                    className="sales-v21-btn sales-v21-btn-primary"
                    to="/btp/projects/new"
                  >
                    Créer un chantier
                  </Link>
                }
              />
            )}
          </BtpSection>
        </>
      ) : !error ? (
        <BtpEmptyState
          title="Chargement"
          description="Préparation du tableau de bord BTP…"
        />
      ) : null}
    </BtpModulePage>
  );
}

export function BtpProjectsPage() {
  const [rows, setRows] = useState<BtpProject[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    listBtpProjects({
      search: search || undefined,
      status: status || undefined,
      pageSize: 100,
    })
      .then((r) => setRows(r.items))
      .catch((e) => setError(err(e)));
  }, [search, status]);
  return (
    <BtpModulePage
      title="Chantiers"
      subtitle="Gérez chaque opération, son budget, son responsable et son avancement."
      activeTab="projects"
      action={
        <Link
          className="sales-v21-btn sales-v21-btn-primary"
          to="/btp/projects/new"
        >
          Nouveau chantier
        </Link>
      }
    >
      <BtpFilterBar>
        <input
          placeholder="Rechercher un chantier…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Tous les statuts</option>
          {Object.entries(projectLabels).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </BtpFilterBar>
      {error ? (
        <BtpNotice tone="danger">{error}</BtpNotice>
      ) : rows.length ? (
        <ProjectTable rows={rows} />
      ) : (
        <BtpEmptyState
          title="Aucun chantier trouvé"
          description="Modifiez les filtres ou créez un nouveau chantier."
        />
      )}
    </BtpModulePage>
  );
}

function ProjectTable({ rows }: { rows: BtpProject[] }) {
  return (
    <BtpDataTable
      rows={rows}
      rowKey={(r) => r.id}
      rowHref={(r) => `/btp/projects/${r.id}`}
      columns={[
        {
          key: "ref",
          label: "Référence",
          render: (r) => <strong>{r.project_ref}</strong>,
        },
        {
          key: "name",
          label: "Chantier",
          render: (r) => (
            <>
              <strong>{r.name}</strong>
              <div className="table-secondary">
                {r.client_name || "Client non renseigné"}
              </div>
            </>
          ),
        },
        {
          key: "location",
          label: "Localisation",
          render: (r) => r.location_label || "—",
        },
        {
          key: "manager",
          label: "Responsable",
          render: (r) => r.manager_name || "—",
        },
        {
          key: "progress",
          label: "Avancement",
          render: (r) => `${Number(r.progress_percent).toFixed(1)} %`,
        },
        {
          key: "budget",
          label: "Budget",
          className: "right",
          render: (r) => money(r.planned_budget, r.currency),
        },
        {
          key: "spent",
          label: "Dépensé",
          className: "right",
          render: (r) => money(r.spent, r.currency),
        },
        {
          key: "status",
          label: "Statut",
          render: (r) => (
            <BtpStatusBadge
              label={projectLabels[r.status] || r.status}
              tone={tone(r.status) as any}
            />
          ),
        },
      ]}
    />
  );
}

type ProjectForm = {
  project_ref: string;
  name: string;
  client_name: string;
  location_label: string;
  description: string;
  status: string;
  start_date: string;
  planned_end_date: string;
  manager_name: string;
  planned_budget: string;
  currency: string;
  progress_percent: string;
};
const emptyProject: ProjectForm = {
  project_ref: "",
  name: "",
  client_name: "",
  location_label: "",
  description: "",
  status: "DRAFT",
  start_date: "",
  planned_end_date: "",
  manager_name: "",
  planned_budget: "0",
  currency: "USD",
  progress_percent: "0",
};
export function BtpProjectFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState(emptyProject);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (id)
      getBtpProject(Number(id))
        .then((p) =>
          setForm({
            project_ref: p.project_ref,
            name: p.name,
            client_name: p.client_name || "",
            location_label: p.location_label || "",
            description: p.description || "",
            status: p.status,
            start_date: p.start_date?.slice(0, 10) || "",
            planned_end_date: p.planned_end_date?.slice(0, 10) || "",
            manager_name: p.manager_name || "",
            planned_budget: String(p.planned_budget || 0),
            currency: p.currency || "USD",
            progress_percent: String(p.progress_percent || 0),
          }),
        )
        .catch((e) => setError(err(e)));
  }, [id]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.project_ref.trim() || !form.name.trim()) {
      setError("La référence et le nom du chantier sont obligatoires.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const payload = {
        ...form,
        client_name: form.client_name || undefined,
        location_label: form.location_label || undefined,
        description: form.description || undefined,
        start_date: form.start_date || undefined,
        planned_end_date: form.planned_end_date || undefined,
        manager_name: form.manager_name || undefined,
        planned_budget: Number(form.planned_budget || 0),
        progress_percent: Number(form.progress_percent || 0),
      };
      const saved = id
        ? await updateBtpProject(Number(id), payload)
        : await createBtpProject(payload);
      navigate(`/btp/projects/${saved.id}`);
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  };
  const field = (key: keyof ProjectForm) => (e: any) =>
    setForm({ ...form, [key]: e.target.value });
  return (
    <BtpModulePage
      title={id ? "Modifier le chantier" : "Nouveau chantier"}
      subtitle="Informations générales, calendrier, budget et pilotage."
      activeTab="projects"
    >
      <form onSubmit={submit}>
        <BtpFormSection
          title="Identification"
          description="Les informations reprises dans les listes et rapports BTP."
        >
          <BtpField label="Référence *">
            <input value={form.project_ref} onChange={field("project_ref")} />
          </BtpField>
          <BtpField label="Nom du chantier *">
            <input value={form.name} onChange={field("name")} />
          </BtpField>
          <BtpField label="Client">
            <input value={form.client_name} onChange={field("client_name")} />
          </BtpField>
          <BtpField label="Localisation">
            <input
              value={form.location_label}
              onChange={field("location_label")}
            />
          </BtpField>
          <BtpField label="Responsable">
            <input value={form.manager_name} onChange={field("manager_name")} />
          </BtpField>
          <BtpField label="Statut">
            <select value={form.status} onChange={field("status")}>
              {Object.entries(projectLabels).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </BtpField>
          <BtpField label="Description">
            <textarea
              rows={4}
              value={form.description}
              onChange={field("description")}
            />
          </BtpField>
        </BtpFormSection>
        <BtpFormSection title="Calendrier et budget">
          <BtpField label="Date de début">
            <input
              type="date"
              value={form.start_date}
              onChange={field("start_date")}
            />
          </BtpField>
          <BtpField label="Fin prévue">
            <input
              type="date"
              value={form.planned_end_date}
              onChange={field("planned_end_date")}
            />
          </BtpField>
          <BtpField label="Budget prévu">
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.planned_budget}
              onChange={field("planned_budget")}
            />
          </BtpField>
          <BtpField label="Devise">
            <select value={form.currency} onChange={field("currency")}>
              <option>USD</option>
              <option>CDF</option>
            </select>
          </BtpField>
          <BtpField label="Avancement (%)">
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={form.progress_percent}
              onChange={field("progress_percent")}
            />
          </BtpField>
        </BtpFormSection>
        {error ? <BtpNotice tone="danger">{error}</BtpNotice> : null}
        <BtpFormActions>
          <Link
            className="sales-v21-btn sales-v21-btn-secondary"
            to={id ? `/btp/projects/${id}` : "/btp/projects"}
          >
            Annuler
          </Link>
          <button
            className="sales-v21-btn sales-v21-btn-primary"
            disabled={busy}
          >
            {busy ? "Enregistrement…" : "Enregistrer"}
          </button>
        </BtpFormActions>
      </form>
    </BtpModulePage>
  );
}

export function BtpProjectDetailPage() {
  const { id } = useParams();
  const [project, setProject] = useState<BtpProject | null>(null);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState({
    phase_ref: "",
    name: "",
    planned_budget: "0",
  });
  const [expense, setExpense] = useState({
    expense_date: todayInKinshasa(),
    category: "MATERIALS",
    description: "",
    amount: "",
    currency: "USD",
    phase_id: "",
  });
  const load = () => {
    if (!id) return Promise.resolve();
    return getBtpProject(Number(id))
      .then(setProject)
      .catch((e) => setError(err(e)));
  };
  useEffect(() => {
    void load();
  }, [id]);
  const addPhase = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await createBtpPhase({
        project_id: Number(id),
        phase_ref: phase.phase_ref,
        name: phase.name,
        planned_budget: Number(phase.planned_budget || 0),
      });
      setPhase({ phase_ref: "", name: "", planned_budget: "0" });
      void load();
    } catch (e) {
      setError(err(e));
    }
  };
  const addExpense = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await createBtpExpense({
        project_id: Number(id),
        phase_id: expense.phase_id ? Number(expense.phase_id) : undefined,
        expense_date: expense.expense_date,
        category: expense.category,
        description: expense.description,
        amount: Number(expense.amount),
        currency: expense.currency,
      });
      setExpense({ ...expense, description: "", amount: "", phase_id: "" });
      void load();
    } catch (e) {
      setError(err(e));
    }
  };
  if (!project)
    return (
      <BtpModulePage
        title="Détail chantier"
        subtitle="Chargement du chantier…"
        activeTab="projects"
      >
        {error ? (
          <BtpNotice tone="danger">{error}</BtpNotice>
        ) : (
          <BtpEmptyState
            title="Chargement"
            description="Préparation de la fiche chantier…"
          />
        )}
      </BtpModulePage>
    );
  return (
    <BtpModulePage
      title={project.name}
      subtitle={`${project.project_ref} · ${project.location_label || "Localisation non renseignée"}`}
      activeTab="projects"
      action={
        <Link
          className="sales-v21-btn sales-v21-btn-primary"
          to={`/btp/projects/${project.id}/edit`}
        >
          Modifier
        </Link>
      }
    >
      {error ? <BtpNotice tone="danger">{error}</BtpNotice> : null}
      <BtpKpiGrid>
        <BtpKpiCard
          label="Avancement"
          value={`${Number(project.progress_percent).toFixed(1)} %`}
        />
        <BtpKpiCard
          label="Budget"
          value={money(project.planned_budget, project.currency)}
        />
        <BtpKpiCard
          label="Dépensé"
          value={money(project.spent, project.currency)}
        />
        <BtpKpiCard
          label="Disponible"
          value={money(
            Number(project.planned_budget) - Number(project.spent || 0),
            project.currency,
          )}
        />
      </BtpKpiGrid>
      <BtpSection title="Informations">
        <BtpInfoList
          items={[
            { label: "Client", value: project.client_name || "—" },
            { label: "Responsable", value: project.manager_name || "—" },
            { label: "Début", value: date(project.start_date) },
            { label: "Fin prévue", value: date(project.planned_end_date) },
            {
              label: "Statut",
              value: projectLabels[project.status] || project.status,
            },
            { label: "Description", value: project.description || "—" },
          ]}
        />
      </BtpSection>
      <BtpSection
        title="Phases du chantier"
        description="Découpage opérationnel et budgétaire."
      >
        {project.phases?.length ? (
          <BtpDataTable
            rows={project.phases}
            rowKey={(r) => r.id}
            columns={[
              { key: "ref", label: "Référence", render: (r) => r.phase_ref },
              {
                key: "name",
                label: "Phase",
                render: (r) => <strong>{r.name}</strong>,
              },
              {
                key: "dates",
                label: "Période",
                render: (r) =>
                  `${date(r.start_date)} — ${date(r.planned_end_date)}`,
              },
              {
                key: "progress",
                label: "Avancement",
                render: (r) => `${r.progress_percent}%`,
              },
              {
                key: "budget",
                label: "Budget",
                className: "right",
                render: (r) => money(r.planned_budget, project.currency),
              },
              {
                key: "status",
                label: "Statut",
                render: (r) => (
                  <BtpStatusBadge
                    label={phaseLabels[r.status] || r.status}
                    tone={tone(r.status) as any}
                  />
                ),
              },
            ]}
          />
        ) : (
          <BtpEmptyState
            title="Aucune phase"
            description="Ajoutez les lots ou étapes du chantier."
          />
        )}
        <form className="sales-v21-filter-bar" onSubmit={addPhase}>
          <input
            required
            placeholder="Référence phase"
            value={phase.phase_ref}
            onChange={(e) => setPhase({ ...phase, phase_ref: e.target.value })}
          />
          <input
            required
            placeholder="Nom de la phase"
            value={phase.name}
            onChange={(e) => setPhase({ ...phase, name: e.target.value })}
          />
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="Budget"
            value={phase.planned_budget}
            onChange={(e) =>
              setPhase({ ...phase, planned_budget: e.target.value })
            }
          />
          <button className="sales-v21-btn sales-v21-btn-primary">
            Ajouter la phase
          </button>
        </form>
      </BtpSection>
      <BtpSection
        title="Dépenses"
        description="Les montants approuvés et payés alimentent le réalisé."
      >
        {project.expenses?.length ? (
          <ExpenseTable rows={project.expenses} />
        ) : (
          <BtpEmptyState
            title="Aucune dépense"
            description="Enregistrez la première dépense du chantier."
          />
        )}
        <form className="sales-v21-filter-bar" onSubmit={addExpense}>
          <input
            type="date"
            required
            value={expense.expense_date}
            onChange={(e) =>
              setExpense({ ...expense, expense_date: e.target.value })
            }
          />
          <select
            value={expense.phase_id}
            onChange={(e) =>
              setExpense({ ...expense, phase_id: e.target.value })
            }
          >
            <option value="">Sans phase</option>
            {project.phases?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            value={expense.category}
            onChange={(e) =>
              setExpense({ ...expense, category: e.target.value })
            }
          >
            {Object.entries(categoryLabels).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <input
            required
            placeholder="Description"
            value={expense.description}
            onChange={(e) =>
              setExpense({ ...expense, description: e.target.value })
            }
          />
          <input
            required
            type="number"
            min="0.01"
            step="0.01"
            placeholder="Montant"
            value={expense.amount}
            onChange={(e) => setExpense({ ...expense, amount: e.target.value })}
          />
          <select
            value={expense.currency}
            onChange={(e) =>
              setExpense({ ...expense, currency: e.target.value })
            }
          >
            <option>USD</option>
            <option>CDF</option>
          </select>
          <button className="sales-v21-btn sales-v21-btn-primary">
            Ajouter
          </button>
        </form>
      </BtpSection>
    </BtpModulePage>
  );
}

export function BtpExpensesPage() {
  const [rows, setRows] = useState<BtpExpense[]>([]);
  const [projects, setProjects] = useState<BtpProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    listBtpProjects({ pageSize: 100 })
      .then((r) => setProjects(r.items))
      .catch((e) => setError(err(e)));
  }, []);
  useEffect(() => {
    listBtpExpenses({
      project_id: projectId || undefined,
      status: status || undefined,
    })
      .then((r) => setRows(r.items))
      .catch((e) => setError(err(e)));
  }, [projectId, status]);
  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => {
          if (r.status !== "CANCELLED")
            acc[r.currency] = (acc[r.currency] || 0) + Number(r.amount);
          return acc;
        },
        {} as Record<string, number>,
      ),
    [rows],
  );
  return (
    <BtpModulePage
      title="Dépenses BTP"
      subtitle="Contrôlez les coûts engagés chantier par chantier."
      activeTab="expenses"
    >
      <BtpKpiGrid>
        <BtpKpiCard label="Total USD" value={money(totals.USD)} />
        <BtpKpiCard label="Total CDF" value={money(totals.CDF, "CDF")} />
        <BtpKpiCard label="Nombre de dépenses" value={rows.length} />
      </BtpKpiGrid>
      <BtpFilterBar>
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        >
          <option value="">Tous les chantiers</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.project_ref} — {p.name}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Tous les statuts</option>
          {Object.entries(expenseLabels).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </BtpFilterBar>
      {error ? (
        <BtpNotice tone="danger">{error}</BtpNotice>
      ) : rows.length ? (
        <ExpenseTable rows={rows} />
      ) : (
        <BtpEmptyState
          title="Aucune dépense"
          description="Les dépenses saisies depuis les chantiers apparaîtront ici."
        />
      )}
    </BtpModulePage>
  );
}
function ExpenseTable({ rows }: { rows: BtpExpense[] }) {
  return (
    <BtpDataTable
      rows={rows}
      rowKey={(r) => r.id}
      columns={[
        { key: "date", label: "Date", render: (r) => date(r.expense_date) },
        {
          key: "project",
          label: "Chantier",
          render: (r) => (
            <>
              <strong>{r.project_name || "—"}</strong>
              <div className="table-secondary">
                {r.phase_name || "Sans phase"}
              </div>
            </>
          ),
        },
        {
          key: "category",
          label: "Catégorie",
          render: (r) => categoryLabels[r.category] || r.category,
        },
        {
          key: "description",
          label: "Description",
          render: (r) => r.description,
        },
        {
          key: "supplier",
          label: "Fournisseur",
          render: (r) => r.supplier_name || "—",
        },
        {
          key: "amount",
          label: "Montant",
          className: "right",
          render: (r) => money(r.amount, r.currency),
        },
        {
          key: "status",
          label: "Statut",
          render: (r) => (
            <BtpStatusBadge
              label={expenseLabels[r.status] || r.status}
              tone={tone(r.status) as any}
            />
          ),
        },
      ]}
    />
  );
}
