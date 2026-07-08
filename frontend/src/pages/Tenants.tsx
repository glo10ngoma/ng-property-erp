import { BarChart3, Eye, FilePlus, FileSpreadsheet, FileText, Pencil, Plus, ScrollText } from 'lucide-react';
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, exportCsv, exportXlsxWorkbook, includesText, shortDate, statusLabel } from '../api';
import { useAuth } from '../auth';
import { EmptyState, Modal, PageHeader, StatusBadge, SuccessMessage } from '../components';
import { useApiList } from '../hooks';

type Tenant = {
  id: number;
  client_reference?: string;
  tenant_type?: string;
  first_name?: string;
  last_name?: string;
  post_name?: string;
  company_name?: string;
  rccm?: string;
  tax_number?: string;
  business_sector?: string;
  legal_representative_name?: string;
  legal_representative_role?: string;
  legal_representative_phone?: string;
  legal_representative_email?: string;
  company_document_name?: string;
  phone: string;
  secondary_phone?: string;
  email?: string;
  profession?: string;
  address?: string;
  id_document_type?: string;
  id_number?: string;
  id_document_file_name?: string;
  nationality?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  notes?: string;
  unit_number?: string;
  building_name?: string;
  monthly_rent?: number;
  active_lease_id?: number;
  active_lease_end_date?: string;
  active_lease_status?: string;
  last_payment_date?: string;
  remaining_amount?: number;
  last_reminder_at?: string;
  reminder_count?: number;
  overdue_invoices?: number;
  created_at?: string;
  status: string;
};

const tenantStatuses = [
  { value: 'ACTIVE', label: 'Actif' },
  { value: 'NOTICE', label: 'Preavis' },
  { value: 'LEFT', label: 'Parti' },
  { value: 'SUSPENDED', label: 'Suspendu' },
  { value: 'ARCHIVED', label: 'Archive' },
];

const idDocumentTypes = ['Carte d identite', 'Passeport', 'Permis de conduire', 'Carte d electeur', 'Autre'];

export function Tenants() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { data, reload } = useApiList<Tenant>('/tenants');
  const [editing, setEditing] = useState<Partial<Tenant> | null>(null);
  const [identityFileName, setIdentityFileName] = useState('');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState({ status: '', building: '', unit: '', leaseType: '', paymentStatus: '', leaseExpiry: '', profession: '', nationality: '', reminder: '' });
  const [success, setSuccess] = useState('');

  const buildings = uniqueValues(data.map((tenant) => tenant.building_name));
  const units = uniqueValues(data.map((tenant) => tenant.unit_number));
  const professions = uniqueValues(data.map((tenant) => tenant.profession ?? tenant.business_sector));
  const nationalities = uniqueValues(data.map((tenant) => tenant.nationality));

  const filtered = data
    .filter((tenant) => includesText(tenant, query))
    .filter((tenant) => !filters.status || tenant.status === filters.status)
    .filter((tenant) => !filters.building || tenant.building_name === filters.building)
    .filter((tenant) => !filters.unit || tenant.unit_number === filters.unit)
    .filter((tenant) => !filters.leaseType || leaseType(tenant) === filters.leaseType)
    .filter((tenant) => !filters.paymentStatus || paymentStatus(tenant) === filters.paymentStatus)
    .filter((tenant) => !filters.leaseExpiry || matchesLeaseExpiry(tenant, filters.leaseExpiry))
    .filter((tenant) => !filters.profession || tenant.profession === filters.profession || tenant.business_sector === filters.profession)
    .filter((tenant) => !filters.nationality || tenant.nationality === filters.nationality)
    .filter((tenant) => !filters.reminder || matchesReminder(tenant, filters.reminder));

  const sorted = [...filtered].sort((a, b) => tenantName(a).localeCompare(tenantName(b)));
  const kpis = useMemo(() => ({
    total: data.length,
    active: data.filter((tenant) => tenant.status === 'ACTIVE').length,
    notice: data.filter((tenant) => tenant.status === 'NOTICE').length,
    left: data.filter((tenant) => tenant.status === 'LEFT' || tenant.status === 'INACTIVE').length,
    withoutLease: data.filter((tenant) => !tenant.active_lease_id).length,
    withDebt: data.filter((tenant) => Number(tenant.remaining_amount ?? 0) > 0).length,
    totalRents: data.reduce((sum, tenant) => sum + Number(tenant.monthly_rent ?? 0), 0),
  }), [data]);

  async function save(form: FormData) {
    const tenantType = textValue(form.get('tenant_type')) || 'PHYSICAL';
    const payload = {
      tenant_type: tenantType,
      first_name: optionalText(form.get('first_name')),
      last_name: optionalText(form.get('last_name')),
      post_name: optionalText(form.get('post_name')),
      company_name: optionalText(form.get('company_name')),
      rccm: optionalText(form.get('rccm')),
      tax_number: optionalText(form.get('tax_number')),
      business_sector: optionalText(form.get('business_sector')),
      legal_representative_name: optionalText(form.get('legal_representative_name')),
      legal_representative_role: optionalText(form.get('legal_representative_role')),
      legal_representative_phone: optionalText(form.get('legal_representative_phone')),
      legal_representative_email: optionalText(form.get('legal_representative_email')),
      company_document_name: tenantType === 'COMPANY' ? identityFileName || null : null,
      phone: textValue(form.get('phone')),
      secondary_phone: optionalText(form.get('secondary_phone')),
      email: optionalText(form.get('email')),
      profession: optionalText(form.get('profession')),
      address: optionalText(form.get('address')),
      id_document_type: optionalText(form.get('id_document_type')),
      id_number: optionalText(form.get('id_number')),
      id_document_file_name: tenantType === 'PHYSICAL' ? identityFileName || null : null,
      id_document_file_url: null,
      nationality: optionalText(form.get('nationality')),
      emergency_contact_name: optionalText(form.get('emergency_contact_name')),
      emergency_contact_phone: optionalText(form.get('emergency_contact_phone')),
      notes: optionalText(form.get('notes')),
      status: textValue(form.get('status')) || 'ACTIVE',
    };
    if (editing?.id) await api.put(`/tenants/${editing.id}`, payload);
    else await api.post('/tenants', payload);
    setSuccess(editing?.id ? 'Locataire modifie avec succes.' : 'Locataire cree avec succes.');
    setEditing(null);
    reload();
  }

  async function createInvoice(tenant: Tenant) {
    const now = new Date();
    const response = await api.post('/invoices', {
      tenant_id: tenant.id,
      lease_id: tenant.active_lease_id,
      month: now.getMonth() + 1,
      year: now.getFullYear(),
      issue_date: now.toISOString().slice(0, 10),
      due_date: new Date(now.getFullYear(), now.getMonth(), 10).toISOString().slice(0, 10),
      items: [{ description: 'Loyer mensuel', amount: Number(tenant.monthly_rent ?? 0) }],
    });
    navigate(`/invoices/${response.data.id}`);
  }

  function openForm(tenant?: Tenant) {
    setIdentityFileName(tenant?.tenant_type === 'COMPANY' ? tenant.company_document_name ?? '' : tenant?.id_document_file_name ?? '');
    setEditing(tenant ?? { tenant_type: 'PHYSICAL' });
  }

  return (
    <section>
      <PageHeader title="Locataires" action={can('tenants.create') ? <button onClick={() => openForm()}><Plus size={16} />Nouveau locataire</button> : undefined} />
      <SuccessMessage message={success} />

      <div className="mini-stats">
        <div className="mini-stat"><span>Total locataires</span><strong>{kpis.total}</strong></div>
        <div className="mini-stat"><span>Actifs</span><strong>{kpis.active}</strong></div>
        <div className="mini-stat"><span>Preavis</span><strong>{kpis.notice}</strong></div>
        <div className="mini-stat"><span>Partis</span><strong>{kpis.left}</strong></div>
        <div className="mini-stat"><span>Sans bail</span><strong>{kpis.withoutLease}</strong></div>
        <div className="mini-stat"><span>Avec impayes</span><strong>{kpis.withDebt}</strong></div>
        <div className="mini-stat"><span>Total loyers</span><strong>{amount(kpis.totalRents)} USD</strong></div>
      </div>

      <div className="table-toolbar">
        <div className="toolbar-main"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher" /></div>
        <div className="toolbar-actions">
          <button className="secondary" onClick={() => exportCsv('locataires.csv', exportTenantRows(sorted))}><FileText size={15} />CSV</button>
          <button className="secondary" onClick={() => exportTenantListWorkbook(sorted)}><FileSpreadsheet size={15} />Excel</button>
        </div>
      </div>

      <div className="quick-form tenants-filter-bar">
        <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">Statut</option>{tenantStatuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}</select>
        <select value={filters.building} onChange={(event) => setFilters({ ...filters, building: event.target.value })}><option value="">Immeuble</option>{buildings.map((building) => <option key={building} value={building}>{building}</option>)}</select>
        <select value={filters.unit} onChange={(event) => setFilters({ ...filters, unit: event.target.value })}><option value="">Appartement</option>{units.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select>
        <select value={filters.leaseType} onChange={(event) => setFilters({ ...filters, leaseType: event.target.value })}><option value="">Type bail</option><option value="ACTIVE">Actif</option><option value="NONE">Sans bail</option></select>
        <select value={filters.paymentStatus} onChange={(event) => setFilters({ ...filters, paymentStatus: event.target.value })}><option value="">Statut paiement</option><option value="PAID">Paye</option><option value="UNPAID">Impaye</option><option value="OVERDUE">En retard</option><option value="NONE">Non facture</option></select>
        <select value={filters.leaseExpiry} onChange={(event) => setFilters({ ...filters, leaseExpiry: event.target.value })}><option value="">Bail echeance</option><option value="30">Moins de 30 jours</option><option value="60">Moins de 60 jours</option><option value="90">Moins de 90 jours</option></select>
        <select value={filters.profession} onChange={(event) => setFilters({ ...filters, profession: event.target.value })}><option value="">Profession</option>{professions.map((profession) => <option key={profession} value={profession}>{profession}</option>)}</select>
        <select value={filters.nationality} onChange={(event) => setFilters({ ...filters, nationality: event.target.value })}><option value="">Nationalite</option>{nationalities.map((item) => <option key={item} value={item}>{item}</option>)}</select>
        <select value={filters.reminder} onChange={(event) => setFilters({ ...filters, reminder: event.target.value })}><option value="">Derniere relance</option><option value="NEVER">Jamais</option><option value="YES">Deja relance</option><option value="30">Moins de 30 jours</option></select>
        <button type="button" className="secondary" onClick={() => setFilters({ status: '', building: '', unit: '', leaseType: '', paymentStatus: '', leaseExpiry: '', profession: '', nationality: '', reminder: '' })}>Reinitialiser</button>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Reference client</th><th>Type</th><th>Nom</th><th>Telephone</th><th>Appartement</th><th>Immeuble</th><th className="right">Loyer</th><th>Devise</th><th>Fin du bail</th><th>Dernier paiement</th><th className="right">Solde restant</th><th>Devise</th><th>Derniere relance</th><th>Statut</th><th>Actions</th></tr></thead>
          <tbody>
            {sorted.map((tenant) => (
              <tr key={tenant.id} className="clickable-row" onClick={() => navigate(`/tenants/${tenant.id}/situation`)}>
                <td>{tenant.client_reference ?? clientReference(tenant.id)}</td>
                <td>{tenantTypeLabel(tenant.tenant_type)}</td>
                <td>{tenantName(tenant)}</td>
                <td>{tenant.phone}</td>
                <td>{tenant.unit_number ?? '-'}</td>
                <td>{tenant.building_name ?? '-'}</td>
                <td className="right">{amount(tenant.monthly_rent)}</td>
                <td>USD</td>
                <td>{dateText(tenant.active_lease_end_date)}</td>
                <td>{dateText(tenant.last_payment_date)}</td>
                <td className="right">{amount(tenant.remaining_amount)}</td>
                <td>USD</td>
                <td>{tenant.last_reminder_at ? dateText(tenant.last_reminder_at) : 'Jamais'}</td>
                <td><StatusBadge value={tenant.status} /></td>
                <td className="actions actions-compact" onClick={(event) => event.stopPropagation()}>
                  <button className="icon-btn" title="Voir" onClick={() => navigate(`/tenants/${tenant.id}/situation`)}><Eye size={16} /></button>
                  <button className="icon-btn" title="Situation" onClick={() => navigate(`/tenants/${tenant.id}/situation`)}><BarChart3 size={16} /></button>
                  {can('tenants.update') && <button className="icon-btn" title="Modifier" onClick={() => openForm(tenant)}><Pencil size={16} /></button>}
                  {can('documents.upload') && <button className="icon-btn" title="Nouveau bail" onClick={() => navigate(`/leases/new?tenantId=${tenant.id}`)}><ScrollText size={16} /></button>}
                  {can('invoices.create') && <button className="icon-btn" title="Nouvelle facture" onClick={() => createInvoice(tenant)}><FilePlus size={16} /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!sorted.length && <EmptyState title="Aucun locataire trouve." />}
      </div>
      <div className="pagination-bar"><span className="table-meta">{sorted.length} locataires affiches</span></div>

      {editing && (
        <Modal title={editing.id ? 'Modifier le locataire' : 'Nouveau locataire'} onClose={() => setEditing(null)}>
          <TenantForm editing={editing} identityFileName={identityFileName} onIdentityFile={setIdentityFileName} onSubmit={save} />
        </Modal>
      )}
    </section>
  );
}

function TenantForm({ editing, identityFileName, onIdentityFile, onSubmit }: { editing: Partial<Tenant>; identityFileName: string; onIdentityFile: (value: string) => void; onSubmit: (form: FormData) => void }) {
  const [tenantType, setTenantType] = useState(editing.tenant_type ?? 'PHYSICAL');
  const isCompany = tenantType === 'COMPANY';
  return (
    <form className="tenant-form" onSubmit={(event) => { event.preventDefault(); onSubmit(new FormData(event.currentTarget)); }}>
      <FormSection title="Identite">
        <label><span>Type de locataire <em>*</em></span><select name="tenant_type" value={tenantType} onChange={(event) => setTenantType(event.target.value)}><option value="PHYSICAL">Personne physique</option><option value="COMPANY">Personne morale / Societe</option></select></label>
        {!isCompany && <label><span>Prenom <em>*</em></span><input name="first_name" defaultValue={editing.first_name ?? ''} required /></label>}
        {!isCompany && <label><span>Nom <em>*</em></span><input name="last_name" defaultValue={editing.last_name ?? ''} required /></label>}
        {!isCompany && <label><span>Post-nom <small>(optionnel)</small></span><input name="post_name" defaultValue={editing.post_name ?? ''} /></label>}
        {isCompany && <label><span>Raison sociale <em>*</em></span><input name="company_name" defaultValue={editing.company_name ?? ''} required /></label>}
        {isCompany && <label><span>RCCM <small>(optionnel)</small></span><input name="rccm" defaultValue={editing.rccm ?? ''} /></label>}
        {isCompany && <label><span>ID Nat / Numero fiscal <small>(optionnel)</small></span><input name="tax_number" defaultValue={editing.tax_number ?? ''} /></label>}
        <label><span>Statut <em>*</em></span><select name="status" defaultValue={editing.status ?? 'ACTIVE'} required>{tenantStatuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}</select></label>
      </FormSection>
      <FormSection title={isCompany ? 'Societe' : 'Contact'}>
        {isCompany && <label><span>Secteur d'activite <small>(optionnel)</small></span><input name="business_sector" defaultValue={editing.business_sector ?? ''} /></label>}
        <label><span>{isCompany ? 'Telephone societe' : 'Telephone'} <em>*</em></span><input name="phone" defaultValue={editing.phone ?? ''} required /></label>
        {!isCompany && <label><span>Telephone secondaire <small>(optionnel)</small></span><input name="secondary_phone" defaultValue={editing.secondary_phone ?? ''} /></label>}
        <label><span>{isCompany ? 'Email societe' : 'Email'} <small>(optionnel)</small></span><input name="email" placeholder="exemple@email.com" type="email" defaultValue={editing.email ?? ''} /></label>
        {isCompany && <label><span>Adresse societe <small>(optionnel)</small></span><input name="address" defaultValue={editing.address ?? ''} /></label>}
      </FormSection>
      {!isCompany && <FormSection title="Profil">
        <label><span>Profession <small>(optionnel)</small></span><input name="profession" defaultValue={editing.profession ?? ''} /></label>
        <label><span>Nationalite <small>(optionnel)</small></span><input name="nationality" placeholder="Congolaise" defaultValue={editing.nationality ?? ''} /></label>
        <label><span>Adresse <small>(optionnel)</small></span><input name="address" defaultValue={editing.address ?? ''} /></label>
      </FormSection>}
      {isCompany && <FormSection title="Representant">
        <label><span>Representant legal <small>(optionnel)</small></span><input name="legal_representative_name" defaultValue={editing.legal_representative_name ?? ''} /></label>
        <label><span>Fonction du representant <small>(optionnel)</small></span><input name="legal_representative_role" defaultValue={editing.legal_representative_role ?? ''} /></label>
        <label><span>Telephone representant <small>(optionnel)</small></span><input name="legal_representative_phone" defaultValue={editing.legal_representative_phone ?? ''} /></label>
        <label><span>Email representant <small>(optionnel)</small></span><input name="legal_representative_email" type="email" defaultValue={editing.legal_representative_email ?? ''} /></label>
      </FormSection>}
      <FormSection title={isCompany ? 'Document societe' : "Piece d'identite"}>
        {!isCompany && <label><span>Type de piece <small>(optionnel)</small></span><select name="id_document_type" defaultValue={editing.id_document_type ?? ''}><option value="">Choisir</option>{idDocumentTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>}
        {!isCompany && <label><span>Numero de piece <small>(optionnel)</small></span><input name="id_number" defaultValue={editing.id_number ?? ''} /></label>}
        <label><span>{isCompany ? 'Document societe / RCCM scanne' : 'Piece jointe identite'} <small>(optionnel)</small></span><input type="file" accept="application/pdf,image/*" onChange={(event) => onIdentityFile(event.target.files?.[0]?.name ?? '')} /></label>
        {identityFileName && <div className="locked-file-name"><span>Fichier selectionne</span><strong>{identityFileName}</strong></div>}
      </FormSection>
      {!isCompany && <FormSection title="Contact d'urgence">
        <label><span>Contact d'urgence <small>(optionnel)</small></span><input name="emergency_contact_name" defaultValue={editing.emergency_contact_name ?? ''} /></label>
        <label><span>Telephone contact d'urgence <small>(optionnel)</small></span><input name="emergency_contact_phone" defaultValue={editing.emergency_contact_phone ?? ''} /></label>
      </FormSection>}
      <FormSection title="Observations">
        <label className="form-field-full"><span>Observations <small>(optionnel)</small></span><textarea name="notes" defaultValue={editing.notes ?? ''} /></label>
      </FormSection>
      <button>Enregistrer</button>
    </form>
  );
}

function FormSection({ title, children }: { title: string; children: ReactNode }) {
  const className = title === 'Identite' ? 'tenant-form-section cols-4' : title === 'Observations' ? 'tenant-form-section cols-1' : 'tenant-form-section cols-3';
  return <fieldset className={className}><legend>{title}</legend>{children}</fieldset>;
}

function exportTenantRows(rows: Tenant[]) {
  return rows.map((tenant) => ({
    reference_client: tenant.client_reference ?? clientReference(tenant.id),
    type: tenantTypeLabel(tenant.tenant_type),
    nom: tenantName(tenant),
    telephone: tenant.phone,
    email: tenant.email ?? '',
    profession: tenant.profession ?? tenant.business_sector ?? '',
    nationalite: tenant.nationality ?? '',
    immeuble: tenant.building_name ?? '',
    appartement: tenant.unit_number ?? '',
    loyer: tenant.monthly_rent ?? 0,
    devise: 'USD',
    statut: statusLabel(tenant.status),
    fin_bail: dateText(tenant.active_lease_end_date),
    dernier_paiement: dateText(tenant.last_payment_date),
    solde_restant: tenant.remaining_amount ?? 0,
    derniere_relance: tenant.last_reminder_at ? dateText(tenant.last_reminder_at) : 'Jamais',
  }));
}

function exportTenantListWorkbook(rows: Tenant[]) {
  const totalInvoiced = rows.reduce((sum, tenant) => sum + Number(tenant.monthly_rent ?? 0), 0);
  const totalUnpaid = rows.reduce((sum, tenant) => sum + Number(tenant.remaining_amount ?? 0), 0);
  exportXlsxWorkbook('Locataires.xlsx', [
    { name: 'Informations locataire', rows: exportTenantRows(rows) },
    { name: 'Baux', rows: rows.map((tenant) => ({ reference_client: tenant.client_reference ?? clientReference(tenant.id), type: tenantTypeLabel(tenant.tenant_type), nom: tenantName(tenant), bail: tenant.active_lease_id ? `B-${tenant.active_lease_id}` : 'Sans bail', fin_bail: dateText(tenant.active_lease_end_date), statut: tenant.active_lease_status ?? '' })) },
    { name: 'Factures', rows: rows.map((tenant) => ({ reference_client: tenant.client_reference ?? clientReference(tenant.id), nom: tenantName(tenant), solde_restant: tenant.remaining_amount ?? 0, factures_retard: tenant.overdue_invoices ?? 0 })) },
    { name: 'Paiements', rows: rows.map((tenant) => ({ reference_client: tenant.client_reference ?? clientReference(tenant.id), nom: tenantName(tenant), dernier_paiement: dateText(tenant.last_payment_date) })) },
    { name: 'Garanties', rows: [] },
    { name: 'Relances', rows: rows.map((tenant) => ({ reference_client: tenant.client_reference ?? clientReference(tenant.id), nom: tenantName(tenant), derniere_relance: tenant.last_reminder_at ? dateText(tenant.last_reminder_at) : 'Jamais', nombre_relances: tenant.reminder_count ?? 0 })) },
    { name: 'Documents', rows: rows.filter((tenant) => tenant.id_document_file_name || tenant.company_document_name).map((tenant) => ({ reference_client: tenant.client_reference ?? clientReference(tenant.id), nom: tenantName(tenant), document: tenant.id_document_file_name ?? tenant.company_document_name })) },
    { name: 'Timeline', rows: rows.map((tenant) => ({ date: dateText(tenant.created_at), evenement: 'Locataire cree', description: tenantName(tenant), utilisateur: '' })) },
    { name: 'Rentabilite', rows: [{ total_loyers_factures: totalInvoiced, total_encaisse: 'Non disponible', total_impayes: totalUnpaid, nombre_baux: rows.filter((tenant) => tenant.active_lease_id).length, nombre_relances: rows.reduce((sum, tenant) => sum + Number(tenant.reminder_count ?? 0), 0), date_dernier_paiement: latestDate(rows.map((tenant) => tenant.last_payment_date)), solde_restant: totalUnpaid }] },
  ]);
}

function uniqueValues(values: Array<string | undefined>) {
  return Array.from(new Set(values.filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b));
}

function tenantName(tenant: Tenant) {
  if (tenant.tenant_type === 'COMPANY') return tenant.company_name || 'Societe sans nom';
  return `${tenant.first_name ?? ''} ${tenant.last_name ?? ''}${tenant.post_name ? ` ${tenant.post_name}` : ''}`.trim() || 'Locataire sans nom';
}

function tenantTypeLabel(value?: string) {
  return value === 'COMPANY' ? 'Societe' : 'Physique';
}

function clientReference(id: number) {
  return `CLI-${String(id).padStart(6, '0')}`;
}

function leaseType(tenant: Tenant) {
  return tenant.active_lease_id ? 'ACTIVE' : 'NONE';
}

function paymentStatus(tenant: Tenant) {
  if (!tenant.monthly_rent && !tenant.remaining_amount) return 'NONE';
  if (Number(tenant.overdue_invoices ?? 0) > 0) return 'OVERDUE';
  return Number(tenant.remaining_amount ?? 0) > 0 ? 'UNPAID' : 'PAID';
}

function matchesLeaseExpiry(tenant: Tenant, days: string) {
  if (!tenant.active_lease_end_date) return false;
  return daysUntil(tenant.active_lease_end_date) <= Number(days);
}

function matchesReminder(tenant: Tenant, value: string) {
  if (value === 'NEVER') return !tenant.last_reminder_at;
  if (value === 'YES') return Boolean(tenant.last_reminder_at);
  if (value === '30') return Boolean(tenant.last_reminder_at) && daysUntil(tenant.last_reminder_at) >= -30;
  return true;
}

function daysUntil(date?: string) {
  if (!date) return Number.POSITIVE_INFINITY;
  return Math.ceil((new Date(`${date.slice(0, 10)}T00:00:00`).getTime() - new Date().getTime()) / 86400000);
}

function latestDate(values: Array<string | undefined>) {
  const valid = values.filter(Boolean) as string[];
  if (!valid.length) return 'Non disponible';
  return dateText(valid.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]);
}

function dateText(value?: string) {
  return value ? shortDate(String(value)) : '-';
}

function textValue(value: FormDataEntryValue | null) {
  return String(value ?? '').trim();
}

function optionalText(value: FormDataEntryValue | null) {
  const text = textValue(value);
  return text ? text : null;
}

function amount(value: unknown) {
  return Number(value ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}
