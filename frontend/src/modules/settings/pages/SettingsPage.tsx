import { ReactNode, useEffect, useState } from 'react';
import { api, exportCsv, includesText } from '../../../api';
import { useAuth } from '../../../auth';
import { EmptyState, PageHeader, SuccessMessage, TableToolbar } from '../../../components';

type Tab = 'company' | 'references' | 'printing' | 'services' | 'restricted';
type CompanySettings = {
  logo_url?: string;
  invoice_logo_url?: string;
  signature_url?: string;
  stamp_url?: string;
  company_name: string;
  legal_name?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  currency: string;
  language: string;
  timezone: string;
  invoice_footer?: string;
  paper_format: string;
  invoice_bottom_text?: string;
};
type ReferenceData = { id: number; type: string; code: string; label: string; description?: string; sort_order: number; status: string };
type PublisherService = { title: string; action: string };
type RestrictedSetting = { label: string; status: string };

const tabs: Array<{ key: Tab; label: string }> = [
  { key: 'company', label: 'Entreprise' },
  { key: 'references', label: 'Referentiels' },
  { key: 'printing', label: 'Impression' },
  { key: 'services', label: 'Services complementaires' },
  { key: 'restricted', label: 'Reserve editeur' },
];

const referenceTypes = [
  ['charge_types', 'Types de charges'],
  ['expense_categories', 'Categories depenses'],
  ['stock_categories', 'Categories stock'],
  ['document_types', 'Types documents'],
  ['staff_positions', 'Fonctions personnel'],
  ['leave_types', 'Types conges'],
  ['payment_methods', 'Modes paiement'],
  ['banks', 'Banques'],
  ['cities', 'Villes'],
];

export function SettingsPage() {
  const { can } = useAuth();
  const [active, setActive] = useState<Tab>('company');
  const [company, setCompany] = useState<CompanySettings | null>(null);
  const [references, setReferences] = useState<ReferenceData[]>([]);
  const [services, setServices] = useState<PublisherService[]>([]);
  const [restricted, setRestricted] = useState<RestrictedSetting[]>([]);
  const [query, setQuery] = useState('');
  const [success, setSuccess] = useState('');
  const [editingReference, setEditingReference] = useState<ReferenceData | null>(null);

  async function load() {
    const [companyResponse, referencesResponse, servicesResponse] = await Promise.all([
      api.get<CompanySettings>('/settings/company'),
      api.get<ReferenceData[]>('/reference-data'),
      api.get<PublisherService[]>('/settings/publisher-services'),
    ]);
    setCompany(companyResponse.data);
    setReferences(referencesResponse.data);
    setServices(servicesResponse.data);
  }

  async function loadRestricted() {
    if (!can('publisher_settings.read') || restricted.length) return;
    const response = await api.get<RestrictedSetting[]>('/settings/restricted');
    setRestricted(response.data);
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (active === 'restricted') loadRestricted();
  }, [active]);

  const filteredReferences = references.filter((item) => includesText(item, query));

  async function updateCompany(form: FormData) {
    await api.patch('/settings/company', Object.fromEntries(form));
    setSuccess('Parametres entreprise enregistres.');
    load();
  }

  async function saveReference(form: FormData) {
    const payload = Object.fromEntries(form);
    if (editingReference) {
      await api.patch(`/reference-data/${editingReference.id}`, payload);
      setSuccess('Referentiel modifie.');
      setEditingReference(null);
    } else {
      await api.post('/reference-data', payload);
      setSuccess('Referentiel ajoute.');
    }
    load();
  }

  async function deactivateReference(id: number) {
    await api.delete(`/reference-data/${id}`);
    setSuccess('Referentiel desactive.');
    load();
  }

  return (
    <section>
      <PageHeader title="Parametres" />
      <SuccessMessage message={success} />

      <div className="table-toolbar">
        <div className="actions">
          {tabs.map((tab) => (
            <button key={tab.key} className={active === tab.key ? '' : 'secondary'} onClick={() => setActive(tab.key)}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {active === 'company' && company && (
        <SettingsSection title="Entreprise">
          <CompanyForm company={company} canUpdate={can('settings.update')} onSubmit={updateCompany} mode="company" />
        </SettingsSection>
      )}

      {active === 'printing' && company && (
        <SettingsSection title="Impression">
          <CompanyForm company={company} canUpdate={can('settings.update')} onSubmit={updateCompany} mode="printing" />
        </SettingsSection>
      )}

      {active === 'references' && (
        <SettingsSection title="Referentiels simples">
          {(can('reference_data.create') || editingReference) && (
            <form className="quick-form" onSubmit={(event) => { event.preventDefault(); saveReference(new FormData(event.currentTarget)); event.currentTarget.reset(); }}>
              <select name="type" defaultValue={editingReference?.type ?? 'charge_types'}>
                {referenceTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <input name="code" placeholder="Code" defaultValue={editingReference?.code ?? ''} required />
              <input name="label" placeholder="Libelle" defaultValue={editingReference?.label ?? ''} required />
              <input name="description" placeholder="Description" defaultValue={editingReference?.description ?? ''} />
              <input name="sort_order" type="number" placeholder="Ordre" defaultValue={editingReference?.sort_order ?? 0} />
              <select name="status" defaultValue={editingReference?.status ?? 'ACTIVE'}>
                <option value="ACTIVE">Actif</option>
                <option value="INACTIVE">Inactif</option>
              </select>
              <button>{editingReference ? 'Enregistrer' : 'Ajouter'}</button>
              {editingReference && <button type="button" className="secondary" onClick={() => setEditingReference(null)}>Annuler</button>}
            </form>
          )}
          <TableToolbar query={query} onQueryChange={setQuery} onExport={() => exportCsv('referentiels.csv', filteredReferences)} />
          <DataTable
            headers={['Type', 'Code', 'Libelle', 'Statut', 'Actions']}
            empty="Aucun referentiel."
            rows={filteredReferences.map((item) => [
              referenceTypeLabel(item.type),
              item.code,
              item.label,
              <Badge key="status" value={item.status} />,
              <span className="actions" key="actions">
                {can('reference_data.update') && <button className="secondary" onClick={() => setEditingReference(item)}>Modifier</button>}
                {can('reference_data.delete') && item.status !== 'INACTIVE' && <button className="secondary" onClick={() => deactivateReference(item.id)}>Desactiver</button>}
              </span>,
            ])}
          />
        </SettingsSection>
      )}

      {active === 'services' && (
        <SettingsSection title="Services complementaires">
          <div className="chart-grid">
            {services.map((service) => (
              <article className="chart-card" key={service.title}>
                <h3>{service.title}</h3>
                <button className="secondary">{service.action}</button>
              </article>
            ))}
          </div>
        </SettingsSection>
      )}

      {active === 'restricted' && (
        <SettingsSection title="Reserve editeur">
          {!can('publisher_settings.read') ? (
            <EmptyState message="Acces reserve." />
          ) : (
            <DataTable
              headers={['Parametre avance', 'Statut']}
              empty="Aucun parametre reserve."
              rows={restricted.map((item) => [item.label, <Badge key="status" value={item.status} />])}
            />
          )}
        </SettingsSection>
      )}
    </section>
  );
}

function CompanyForm({ company, canUpdate, mode, onSubmit }: { company: CompanySettings; canUpdate: boolean; mode: 'company' | 'printing'; onSubmit: (form: FormData) => void }) {
  return (
    <form className="quick-form" onSubmit={(event) => { event.preventDefault(); onSubmit(new FormData(event.currentTarget)); }}>
      {mode === 'company' ? (
        <>
          <input name="logo_url" placeholder="Logo" defaultValue={company.logo_url ?? ''} disabled={!canUpdate} />
          <input name="company_name" placeholder="Nom entreprise" defaultValue={company.company_name} disabled={!canUpdate} required />
          <input name="legal_name" placeholder="Raison sociale" defaultValue={company.legal_name ?? ''} disabled={!canUpdate} />
          <input name="address" placeholder="Adresse" defaultValue={company.address ?? ''} disabled={!canUpdate} />
          <input name="phone" placeholder="Telephone" defaultValue={company.phone ?? ''} disabled={!canUpdate} />
          <input name="email" placeholder="Email" defaultValue={company.email ?? ''} disabled={!canUpdate} />
          <input name="website" placeholder="Site web" defaultValue={company.website ?? ''} disabled={!canUpdate} />
          <input name="currency" placeholder="Devise" defaultValue={company.currency} disabled={!canUpdate} />
          <input name="language" placeholder="Langue" defaultValue={company.language} disabled={!canUpdate} />
          <input name="timezone" placeholder="Fuseau horaire" defaultValue={company.timezone} disabled={!canUpdate} />
          <textarea name="invoice_footer" placeholder="Pied de page facture" defaultValue={company.invoice_footer ?? ''} disabled={!canUpdate} />
        </>
      ) : (
        <>
          <input name="invoice_logo_url" placeholder="Logo facture" defaultValue={company.invoice_logo_url ?? ''} disabled={!canUpdate} />
          <input name="signature_url" placeholder="Signature" defaultValue={company.signature_url ?? ''} disabled={!canUpdate} />
          <input name="stamp_url" placeholder="Cachet" defaultValue={company.stamp_url ?? ''} disabled={!canUpdate} />
          <select name="paper_format" defaultValue={company.paper_format} disabled={!canUpdate}>
            <option value="A4">A4</option>
            <option value="A5">A5</option>
            <option value="LETTER">Letter</option>
          </select>
          <textarea name="invoice_bottom_text" placeholder="Texte bas de facture" defaultValue={company.invoice_bottom_text ?? ''} disabled={!canUpdate} />
        </>
      )}
      {canUpdate && <button>Enregistrer</button>}
    </form>
  );
}

function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="detail-section">
      <h4>{title}</h4>
      {children}
    </div>
  );
}

function DataTable({ headers, rows, empty }: { headers: string[]; rows: ReactNode[][]; empty: string }) {
  if (!rows.length) return <EmptyState message={empty} />;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
        <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function Badge({ value }: { value: string }) {
  const normalized = value.toUpperCase();
  const className = normalized.includes('RESERVE') || normalized === 'INACTIVE' ? 'partial' : 'paid';
  return <span className={`badge ${className}`}>{label(value)}</span>;
}

function label(value: string) {
  const labels: Record<string, string> = {
    ACTIVE: 'Actif',
    INACTIVE: 'Inactif',
    'Reserve editeur': 'Reserve editeur',
  };
  return labels[value] ?? value;
}

function referenceTypeLabel(type: string) {
  return Object.fromEntries(referenceTypes)[type] ?? type;
}
