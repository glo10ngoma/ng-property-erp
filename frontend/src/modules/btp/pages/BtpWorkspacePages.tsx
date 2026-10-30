import { FormEvent, ReactNode, useCallback, useEffect, useState } from "react";
import {
  createBtpWorkspace,
  getBtpReports,
  listBtpProjects,
  listBtpWorkspace,
} from "../api/btp.api";
import type { BtpOperationalRecord, BtpProject, BtpReportRow } from "../types";
import {
  BtpEmptyState,
  BtpField,
  BtpFormActions,
  BtpFormSection,
  BtpKpiCard,
  BtpKpiGrid,
  BtpModulePage,
  BtpNotice,
  BtpSection,
  type BtpTab,
} from "../components/BtpUi";

const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Kinshasa",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const money = (v: unknown, c = "USD") =>
  `${Number(v ?? 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`;
const message = (e: unknown) =>
  (e as { response?: { data?: { message?: string } } })?.response?.data
    ?.message || "Une erreur est survenue.";
const labels: Record<string, string> = {
  MATERIALS: "Matériaux",
  LABOR: "Main-d’œuvre",
  SUBCONTRACTING: "Sous-traitance",
  TRANSPORT: "Transport",
  EQUIPMENT: "Équipement",
  OTHER: "Autre",
  REQUEST: "Demande",
  ORDER: "Commande",
  DELIVERY: "Livraison",
  IN: "Entrée",
  OUT: "Sortie",
  RETURN: "Retour",
  ADJUSTMENT: "Écart/Ajustement",
  JOURNAL: "Journal",
  PHOTO: "Photo",
  DOCUMENT: "Document",
  INCIDENT: "Incident",
  TASK: "Tâche",
  OBSERVATION: "Observation",
  INVOICE: "Facture",
  PAYMENT: "Encaissement",
};

function useProjects() {
  const [projects, setProjects] = useState<BtpProject[]>([]);
  useEffect(() => {
    listBtpProjects({ pageSize: 100 })
      .then((r) => setProjects(r.items))
      .catch(() => setProjects([]));
  }, []);
  return projects;
}
function ProjectSelect({
  projects,
  value,
  onChange,
}: {
  projects: BtpProject[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select required value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choisir un chantier</option>
      {projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.project_ref} — {p.name}
        </option>
      ))}
    </select>
  );
}
function RecordsTable({
  rows,
  columns,
}: {
  rows: BtpOperationalRecord[];
  columns: Array<{
    key: string;
    label: string;
    render?: (r: BtpOperationalRecord) => ReactNode;
  }>;
}) {
  if (!rows.length)
    return (
      <BtpEmptyState
        title="Aucune donnée"
        description="La première écriture apparaîtra ici."
      />
    );
  return (
    <div className="sales-v21-table-wrap">
      <table className="sales-v21-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              {columns.map((c) => (
                <td key={c.key}>
                  {c.render ? c.render(r) : String(r[c.key] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WorkspacePage({
  tab,
  title,
  subtitle,
  endpoint,
  fields,
  columns,
}: {
  tab: BtpTab;
  title: string;
  subtitle: string;
  endpoint: "budgets" | "purchases" | "stock-movements" | "site-logs";
  fields: (ctx: {
    form: Record<string, string>;
    set: (k: string, v: string) => void;
    projects: BtpProject[];
  }) => React.ReactNode;
  columns: Array<{
    key: string;
    label: string;
    render?: (r: BtpOperationalRecord) => React.ReactNode;
  }>;
}) {
  const projects = useProjects();
  const [rows, setRows] = useState<BtpOperationalRecord[]>([]);
  const [form, setForm] = useState<Record<string, string>>({
    project_id: "",
    currency: "USD",
    document_date: today(),
    movement_date: today(),
    event_date: today(),
  });
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [saving, setSaving] = useState(false);
  const load = useCallback(
    () =>
      listBtpWorkspace(endpoint)
        .then((r) => setRows(r.items))
        .catch((e) => setError(message(e))),
    [endpoint],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const set = (k: string, v: string) => setForm((s) => ({ ...s, [k]: v }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setOk("");
    try {
      const payload: Record<string, unknown> = { ...form };
      for (const k of [
        "project_id",
        "phase_id",
        "planned_amount",
        "amount",
        "quantity",
        "progress_percent",
      ])
        if (payload[k] !== undefined && payload[k] !== "")
          payload[k] = Number(payload[k]);
      await createBtpWorkspace(endpoint, payload);
      setOk("Enregistrement effectué.");
      setForm((s) => ({
        project_id: "",
        currency: s.currency || "USD",
        document_date: today(),
        movement_date: today(),
        event_date: today(),
      }));
      await load();
    } catch (x) {
      setError(message(x));
    } finally {
      setSaving(false);
    }
  };
  return (
    <BtpModulePage title={title} subtitle={subtitle} activeTab={tab}>
      <BtpFormSection title={`Nouvelle écriture — ${title}`}>
        <form onSubmit={submit}>
          <div className="sales-v21-form-grid">
            {fields({ form, set, projects })}
          </div>
          <BtpFormActions>
            <button
              className="sales-v21-btn sales-v21-btn-primary"
              disabled={saving}
            >
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </BtpFormActions>
        </form>
      </BtpFormSection>
      {error ? <BtpNotice tone="danger">{error}</BtpNotice> : null}
      {ok ? <BtpNotice tone="success">{ok}</BtpNotice> : null}
      <BtpSection
        title={title}
        description={`${rows.length} élément(s) enregistré(s).`}
      >
        <RecordsTable rows={rows} columns={columns} />
      </BtpSection>
    </BtpModulePage>
  );
}

const projectField = (ctx: {
  form: Record<string, string>;
  set: (k: string, v: string) => void;
  projects: BtpProject[];
}) => (
  <BtpField label="Chantier">
    <ProjectSelect
      projects={ctx.projects}
      value={ctx.form.project_id || ""}
      onChange={(v) => ctx.set("project_id", v)}
    />
  </BtpField>
);
const currencyField = (
  f: Record<string, string>,
  set: (k: string, v: string) => void,
) => (
  <BtpField label="Devise">
    <select
      value={f.currency || "USD"}
      onChange={(e) => set("currency", e.target.value)}
    >
      <option>USD</option>
      <option>CDF</option>
    </select>
  </BtpField>
);

export function BtpBudgetsPage() {
  return (
    <WorkspacePage
      tab="budgets"
      title="Budget du chantier"
      subtitle="Comparez le prévu, l’engagé, le dépensé et le restant par catégorie."
      endpoint="budgets"
      fields={({ form, set, projects }) => (
        <>
          {projectField({ form, set, projects })}
          <BtpField label="Catégorie">
            <select
              required
              value={form.category || ""}
              onChange={(e) => set("category", e.target.value)}
            >
              <option value="">Choisir</option>
              {[
                "MATERIALS",
                "LABOR",
                "SUBCONTRACTING",
                "TRANSPORT",
                "EQUIPMENT",
                "OTHER",
              ].map((v) => (
                <option key={v} value={v}>
                  {labels[v]}
                </option>
              ))}
            </select>
          </BtpField>
          <BtpField label="Libellé">
            <input
              required
              value={form.label || ""}
              onChange={(e) => set("label", e.target.value)}
            />
          </BtpField>
          <BtpField label="Montant prévu">
            <input
              required
              type="number"
              min="0"
              step="0.01"
              value={form.planned_amount || ""}
              onChange={(e) => set("planned_amount", e.target.value)}
            />
          </BtpField>
          {currencyField(form, set)}
        </>
      )}
      columns={[
        { key: "project_name", label: "Chantier" },
        { key: "label", label: "Poste" },
        {
          key: "category",
          label: "Catégorie",
          render: (r) => labels[String(r.category)] || String(r.category),
        },
        {
          key: "planned_amount",
          label: "Prévu",
          render: (r) => money(r.planned_amount, String(r.currency)),
        },
        {
          key: "committed",
          label: "Engagé",
          render: (r) => money(r.committed, String(r.currency)),
        },
        {
          key: "spent",
          label: "Dépensé",
          render: (r) => money(r.spent, String(r.currency)),
        },
        {
          key: "remaining",
          label: "Restant",
          render: (r) =>
            money(
              Number(r.planned_amount) - Number(r.spent),
              String(r.currency),
            ),
        },
      ]}
    />
  );
}

export function BtpPurchasesPage() {
  return (
    <WorkspacePage
      tab="purchases"
      title="Achats et fournisseurs"
      subtitle="Suivez les demandes, commandes et livraisons affectées aux chantiers."
      endpoint="purchases"
      fields={({ form, set, projects }) => (
        <>
          {projectField({ form, set, projects })}
          <BtpField label="Type">
            <select
              required
              value={form.document_type || ""}
              onChange={(e) => set("document_type", e.target.value)}
            >
              <option value="">Choisir</option>
              {["REQUEST", "ORDER", "DELIVERY"].map((v) => (
                <option key={v} value={v}>
                  {labels[v]}
                </option>
              ))}
            </select>
          </BtpField>
          <BtpField label="Référence">
            <input
              required
              value={form.reference || ""}
              onChange={(e) => set("reference", e.target.value)}
            />
          </BtpField>
          <BtpField label="Fournisseur">
            <input
              value={form.supplier_name || ""}
              onChange={(e) => set("supplier_name", e.target.value)}
            />
          </BtpField>
          <BtpField label="Catégorie">
            <select
              required
              value={form.category || ""}
              onChange={(e) => set("category", e.target.value)}
            >
              <option value="">Choisir</option>
              {[
                "MATERIALS",
                "LABOR",
                "SUBCONTRACTING",
                "TRANSPORT",
                "EQUIPMENT",
                "OTHER",
              ].map((v) => (
                <option key={v} value={v}>
                  {labels[v]}
                </option>
              ))}
            </select>
          </BtpField>
          <BtpField label="Date">
            <input
              required
              type="date"
              value={form.document_date || today()}
              onChange={(e) => set("document_date", e.target.value)}
            />
          </BtpField>
          <BtpField label="Montant">
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.amount || ""}
              onChange={(e) => set("amount", e.target.value)}
            />
          </BtpField>
          {currencyField(form, set)}
          <BtpField label="Description">
            <input
              required
              value={form.description || ""}
              onChange={(e) => set("description", e.target.value)}
            />
          </BtpField>
        </>
      )}
      columns={[
        { key: "document_date", label: "Date" },
        { key: "reference", label: "Référence" },
        {
          key: "document_type",
          label: "Type",
          render: (r) => labels[String(r.document_type)],
        },
        { key: "project_name", label: "Chantier" },
        { key: "supplier_name", label: "Fournisseur" },
        {
          key: "category",
          label: "Catégorie",
          render: (r) => labels[String(r.category)],
        },
        {
          key: "amount",
          label: "Montant",
          render: (r) => money(r.amount, String(r.currency)),
        },
        { key: "status", label: "Statut" },
      ]}
    />
  );
}

export function BtpStockPage() {
  return (
    <WorkspacePage
      tab="stock"
      title="Matériaux et stock"
      subtitle="Enregistrez les entrées, sorties et retours de matériaux avec contrôle du disponible."
      endpoint="stock-movements"
      fields={({ form, set, projects }) => (
        <>
          {projectField({ form, set, projects })}
          <BtpField label="Mouvement">
            <select
              required
              value={form.movement_type || ""}
              onChange={(e) => set("movement_type", e.target.value)}
            >
              <option value="">Choisir</option>
              {["IN", "OUT", "RETURN", "ADJUSTMENT"].map((v) => (
                <option key={v} value={v}>
                  {labels[v]}
                </option>
              ))}
            </select>
          </BtpField>
          <BtpField label="Date">
            <input
              required
              type="date"
              value={form.movement_date || today()}
              onChange={(e) => set("movement_date", e.target.value)}
            />
          </BtpField>
          <BtpField label="Matériau">
            <input
              required
              value={form.material_name || ""}
              onChange={(e) => set("material_name", e.target.value)}
            />
          </BtpField>
          <BtpField label="Quantité">
            <input
              required
              type="number"
              min="0.001"
              step="0.001"
              value={form.quantity || ""}
              onChange={(e) => set("quantity", e.target.value)}
            />
          </BtpField>
          <BtpField label="Unité">
            <input
              required
              placeholder="sac, m³, pièce…"
              value={form.unit || ""}
              onChange={(e) => set("unit", e.target.value)}
            />
          </BtpField>
          <BtpField label="Référence">
            <input
              value={form.reference || ""}
              onChange={(e) => set("reference", e.target.value)}
            />
          </BtpField>
        </>
      )}
      columns={[
        { key: "movement_date", label: "Date" },
        { key: "project_name", label: "Chantier" },
        { key: "material_name", label: "Matériau" },
        {
          key: "movement_type",
          label: "Mouvement",
          render: (r) => labels[String(r.movement_type)],
        },
        {
          key: "quantity",
          label: "Quantité",
          render: (r) => `${r.quantity} ${r.unit}`,
        },
        { key: "reference", label: "Référence" },
      ]}
    />
  );
}

export function BtpOperationsPage() {
  return (
    <WorkspacePage
      tab="operations"
      title="Suivi opérationnel"
      subtitle="Centralisez journal, documents, incidents, tâches et avancement physique."
      endpoint="site-logs"
      fields={({ form, set, projects }) => (
        <>
          {projectField({ form, set, projects })}
          <BtpField label="Type">
            <select
              required
              value={form.log_type || ""}
              onChange={(e) => set("log_type", e.target.value)}
            >
              <option value="">Choisir</option>
              {[
                "JOURNAL",
                "PHOTO",
                "DOCUMENT",
                "INCIDENT",
                "TASK",
                "OBSERVATION",
              ].map((v) => (
                <option key={v} value={v}>
                  {labels[v]}
                </option>
              ))}
            </select>
          </BtpField>
          <BtpField label="Date">
            <input
              required
              type="date"
              value={form.event_date || today()}
              onChange={(e) => set("event_date", e.target.value)}
            />
          </BtpField>
          <BtpField label="Titre">
            <input
              required
              value={form.title || ""}
              onChange={(e) => set("title", e.target.value)}
            />
          </BtpField>
          <BtpField label="Détail">
            <input
              value={form.content || ""}
              onChange={(e) => set("content", e.target.value)}
            />
          </BtpField>
          <BtpField label="Lien photo/document">
            <input
              type="url"
              value={form.attachment_url || ""}
              onChange={(e) => set("attachment_url", e.target.value)}
            />
          </BtpField>
          <BtpField label="Avancement physique %">
            <input
              type="number"
              min="0"
              max="100"
              value={form.progress_percent || ""}
              onChange={(e) => set("progress_percent", e.target.value)}
            />
          </BtpField>
        </>
      )}
      columns={[
        { key: "event_date", label: "Date" },
        { key: "project_name", label: "Chantier" },
        {
          key: "log_type",
          label: "Type",
          render: (r) => labels[String(r.log_type)],
        },
        { key: "title", label: "Objet" },
        {
          key: "progress_percent",
          label: "Avancement",
          render: (r) =>
            r.progress_percent == null ? "—" : `${r.progress_percent} %`,
        },
        { key: "status", label: "Statut" },
      ]}
    />
  );
}

function FinanceBlock({
  endpoint,
  title,
  type,
}: {
  endpoint: "client-contracts" | "client-transactions";
  title: string;
  type: "contract" | "transaction";
}) {
  const projects = useProjects();
  const [rows, setRows] = useState<BtpOperationalRecord[]>([]);
  const [form, setForm] = useState<Record<string, string>>({
    project_id: "",
    currency: "USD",
    transaction_date: today(),
  });
  const [notice, setNotice] = useState("");
  const load = useCallback(
    () => listBtpWorkspace(endpoint).then((r) => setRows(r.items)),
    [endpoint],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const set = (k: string, v: string) => setForm((s) => ({ ...s, [k]: v }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const payload: Record<string, unknown> = {
        ...form,
        project_id: Number(form.project_id),
      };
      for (const k of ["contract_amount", "amount"])
        if (form[k]) payload[k] = Number(form[k]);
      await createBtpWorkspace(endpoint, payload);
      setNotice("Enregistrement effectué.");
      setForm({ project_id: "", currency: "USD", transaction_date: today() });
      await load();
    } catch (x) {
      setNotice(message(x));
    }
  };
  return (
    <BtpSection title={title}>
      <form onSubmit={submit}>
        <div className="sales-v21-form-grid">
          {projectField({ form, set, projects })}
          <BtpField label="Référence">
            <input
              required
              value={form.reference || ""}
              onChange={(e) => set("reference", e.target.value)}
            />
          </BtpField>
          {type === "contract" ? (
            <>
              <BtpField label="Client">
                <input
                  required
                  value={form.client_name || ""}
                  onChange={(e) => set("client_name", e.target.value)}
                />
              </BtpField>
              <BtpField label="Montant du contrat">
                <input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.contract_amount || ""}
                  onChange={(e) => set("contract_amount", e.target.value)}
                />
              </BtpField>
            </>
          ) : (
            <>
              <BtpField label="Type">
                <select
                  required
                  value={form.transaction_type || ""}
                  onChange={(e) => set("transaction_type", e.target.value)}
                >
                  <option value="">Choisir</option>
                  <option value="INVOICE">Facture</option>
                  <option value="PAYMENT">Encaissement</option>
                </select>
              </BtpField>
              <BtpField label="Date">
                <input
                  required
                  type="date"
                  value={form.transaction_date || today()}
                  onChange={(e) => set("transaction_date", e.target.value)}
                />
              </BtpField>
              <BtpField label="Montant">
                <input
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={form.amount || ""}
                  onChange={(e) => set("amount", e.target.value)}
                />
              </BtpField>
              <BtpField label="Description">
                <input
                  required
                  value={form.description || ""}
                  onChange={(e) => set("description", e.target.value)}
                />
              </BtpField>
            </>
          )}
          {currencyField(form, set)}
        </div>
        <BtpFormActions>
          <button className="sales-v21-btn sales-v21-btn-primary">
            Enregistrer
          </button>
        </BtpFormActions>
      </form>
      {notice ? (
        <BtpNotice tone={notice.includes("effectué") ? "success" : "danger"}>
          {notice}
        </BtpNotice>
      ) : null}
      <RecordsTable
        rows={rows}
        columns={
          type === "contract"
            ? [
                { key: "reference", label: "Référence" },
                { key: "project_name", label: "Chantier" },
                { key: "client_name", label: "Client" },
                {
                  key: "contract_amount",
                  label: "Montant",
                  render: (r) => money(r.contract_amount, String(r.currency)),
                },
                { key: "status", label: "Statut" },
              ]
            : [
                { key: "transaction_date", label: "Date" },
                { key: "reference", label: "Référence" },
                { key: "project_name", label: "Chantier" },
                {
                  key: "transaction_type",
                  label: "Type",
                  render: (r) => labels[String(r.transaction_type)],
                },
                {
                  key: "amount",
                  label: "Montant",
                  render: (r) => money(r.amount, String(r.currency)),
                },
                { key: "status", label: "Statut" },
              ]
        }
      />
    </BtpSection>
  );
}
export function BtpFinancePage() {
  return (
    <BtpModulePage
      title="Finance BTP"
      subtitle="Suivez contrats clients, facturation, encaissements, dépenses et rentabilité."
      activeTab="finance"
    >
      <FinanceBlock
        endpoint="client-contracts"
        title="Contrats clients"
        type="contract"
      />
      <FinanceBlock
        endpoint="client-transactions"
        title="Factures et encaissements"
        type="transaction"
      />
    </BtpModulePage>
  );
}

export function BtpReportsPage() {
  const [rows, setRows] = useState<BtpReportRow[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    getBtpReports()
      .then((r) => setRows(r.items))
      .catch((e) => setError(message(e)));
  }, []);
  const total = (k: keyof BtpReportRow) =>
    rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  return (
    <BtpModulePage
      title="Rapports BTP"
      subtitle="Analysez l’avancement physique, financier, les dépassements et la rentabilité."
      activeTab="reports"
    >
      {error ? <BtpNotice tone="danger">{error}</BtpNotice> : null}
      <BtpKpiGrid>
        <BtpKpiCard
          label="Budget total"
          value={money(total("planned_budget"))}
        />
        <BtpKpiCard label="Engagé" value={money(total("committed"))} />
        <BtpKpiCard label="Dépensé" value={money(total("spent"))} />
        <BtpKpiCard label="Facturé" value={money(total("invoiced"))} />
        <BtpKpiCard label="Encaissé" value={money(total("collected"))} />
      </BtpKpiGrid>
      <BtpSection title="Avancement physique contre financier">
        <div className="sales-v21-table-wrap">
          <table className="sales-v21-table">
            <thead>
              <tr>
                <th>Chantier</th>
                <th>Physique</th>
                <th>Budget</th>
                <th>Engagé</th>
                <th>Dépensé</th>
                <th>Restant</th>
                <th>Rentabilité</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.project_ref}</strong>
                    <br />
                    {r.name}
                  </td>
                  <td>{Number(r.progress_percent).toFixed(1)} %</td>
                  <td>{money(r.planned_budget, r.currency)}</td>
                  <td>{money(r.committed, r.currency)}</td>
                  <td>{money(r.spent, r.currency)}</td>
                  <td>
                    {money(
                      Number(r.planned_budget) - Number(r.spent),
                      r.currency,
                    )}
                  </td>
                  <td>
                    {money(Number(r.collected) - Number(r.spent), r.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </BtpSection>
    </BtpModulePage>
  );
}
