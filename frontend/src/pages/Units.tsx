import { Eye, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { api, exportCsv, includesText, invoiceDisplayStatus, money, paymentMethodLabel, shortDate } from '../api';
import { useAuth } from '../auth';
import { EmptyState, Modal, PageHeader, StatusBadge, SuccessMessage, TableToolbar } from '../components';
import { useApiList } from '../hooks';

type Unit = { id: number; building_id: number; building_name: string; number: string; floor: number; type: string; monthly_rent: number; status: string; tenant_name?: string; tenant_phone?: string };
type Building = { id: number; name: string };
type UnitDetail = Unit & {
  building_address?: string;
  tenant_email?: string;
  situation: string;
  tenants: Array<{ id: number; first_name: string; last_name: string; phone: string; status: string; move_in_date: string }>;
  invoices: Array<{ id: number; invoice_number: string; tenant_name: string; total: number; paid_amount: number; remaining_amount: number; due_date: string; status: string }>;
  payments: Array<{ id: number; invoice_number: string; tenant_name: string; payment_date: string; amount: number; payment_method: string }>;
};

const DEFAULT_UNIT_TYPES = [
  'Studio',
  'Chambre',
  'Appartement 1 chambre',
  'Appartement 2 chambres',
  'Appartement 3 chambres',
  'Appartement 4 chambres',
  'Appartement 5 chambres',
  'Duplex',
  'Penthouse',
  'Bureau',
  'Local commercial',
  'Magasin',
  'Entrepot',
  'Parking',
  'Autre',
];

export function Units() {
  const { can } = useAuth();
  const { data, reload } = useApiList<Unit>('/units');
  const buildings = useApiList<Building>('/buildings');
  const [editing, setEditing] = useState<Partial<Unit> | null>(null);
  const [viewing, setViewing] = useState<UnitDetail | null>(null);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState({ building_id: '', type: '', status: '', rent_min: '', rent_max: '', floor: '', availability: '' });
  const [success, setSuccess] = useState('');
  const filtered = data
    .filter((unit) => includesText(unit, query))
    .filter((unit) => !filters.building_id || Number(unit.building_id) === Number(filters.building_id))
    .filter((unit) => !filters.type || unit.type === filters.type)
    .filter((unit) => !filters.status || unit.status === filters.status)
    .filter((unit) => !filters.rent_min || Number(unit.monthly_rent) >= Number(filters.rent_min))
    .filter((unit) => !filters.rent_max || Number(unit.monthly_rent) <= Number(filters.rent_max))
    .filter((unit) => !filters.floor || Number(unit.floor) === Number(filters.floor))
    .filter((unit) => !filters.availability || unit.status === filters.availability);
  const occupied = data.filter((unit) => unit.status === 'OCCUPIED').length;
  const vacant = data.filter((unit) => unit.status === 'VACANT').length;
  const occupancyRate = data.length ? Math.round((occupied / data.length) * 100) : 0;

  async function save(form: FormData) {
    const payload = {
      building_id: Number(form.get('building_id')),
      number: form.get('number'),
      floor: Number(form.get('floor')),
      type: form.get('type'),
      monthly_rent: Number(form.get('monthly_rent')),
      status: form.get('status'),
    };
    if (editing?.id) await api.put(`/units/${editing.id}`, payload);
    else await api.post('/units', payload);
    setSuccess(editing?.id ? 'Appartement modifié avec succès.' : 'Appartement créé avec succès.');
    setEditing(null);
    reload();
  }

  async function openDetail(unit: Unit) {
    const response = await api.get<UnitDetail>(`/units/${unit.id}`);
    setViewing(response.data);
  }

  return (
    <section>
      <PageHeader title="Appartements" action={can('units.create') ? <button onClick={() => setEditing({})}><Plus size={16} />Nouvel appartement</button> : undefined} />
      <SuccessMessage message={success} />
      <div className="mini-stats">
        <div className="mini-stat"><span>Total</span><strong>{data.length}</strong></div>
        <div className="mini-stat"><span>Occupés</span><strong>{occupied}</strong></div>
        <div className="mini-stat"><span>Libres</span><strong>{vacant}</strong></div>
        <div className="mini-stat"><span>Taux d’occupation</span><strong>{occupancyRate}%</strong></div>
      </div>
      <TableToolbar
        query={query}
        onQueryChange={setQuery}
        onExport={() => exportCsv('appartements.csv', filtered.map((unit) => ({
          immeuble: unit.building_name,
          numero: unit.number,
          etage: unit.floor,
          type: unit.type,
          loyer: unit.monthly_rent,
          statut: unit.status,
          locataire: unit.tenant_name ?? '',
          telephone: unit.tenant_phone ?? '',
        })))}
      />
      <div className="quick-form">
        <select value={filters.building_id} onChange={(event) => setFilters({ ...filters, building_id: event.target.value })}><option value="">Tous les immeubles</option>{buildings.data.map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}</select>
        <select value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value })}><option value="">Tous les types</option>{DEFAULT_UNIT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select>
        <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">Tous les statuts</option><option value="VACANT">Libre</option><option value="OCCUPIED">Occupe</option><option value="MAINTENANCE">Maintenance</option><option value="BLOCKED">Bloque</option></select>
        <input type="number" placeholder="Loyer min." value={filters.rent_min} onChange={(event) => setFilters({ ...filters, rent_min: event.target.value })} />
        <input type="number" placeholder="Loyer max." value={filters.rent_max} onChange={(event) => setFilters({ ...filters, rent_max: event.target.value })} />
        <input type="number" placeholder="Etage" value={filters.floor} onChange={(event) => setFilters({ ...filters, floor: event.target.value })} />
        <select value={filters.availability} onChange={(event) => setFilters({ ...filters, availability: event.target.value })}><option value="">Occupation</option><option value="OCCUPIED">Occupe</option><option value="VACANT">Libre</option></select>
        <button type="button" className="secondary" onClick={() => setFilters({ building_id: '', type: '', status: '', rent_min: '', rent_max: '', floor: '', availability: '' })}>Reinitialiser filtres</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Immeuble</th><th>Numéro</th><th>Étage</th><th>Type</th><th className="right">Montant</th><th>Devise</th><th>Statut</th><th>Locataire actuel</th><th>Téléphone</th><th>Actions</th></tr></thead>
          <tbody>
            {filtered.map((unit) => (
              <tr key={unit.id}>
                <td>{unit.building_name}</td><td>{unit.number}</td><td>{unit.floor}</td><td>{unit.type}</td><td className="right">{amount(unit.monthly_rent)}</td><td>USD</td><td><StatusBadge value={unit.status} /></td><td>{unit.tenant_name || '-'}</td><td>{unit.tenant_phone || '-'}</td>
                <td className="actions">
                  <button className="icon-btn" title="Voir" onClick={() => openDetail(unit)}><Eye size={16} /></button>
                  {can('units.update') && <button className="icon-btn" title="Modifier" onClick={() => setEditing(unit)}><Pencil size={16} /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.length && <EmptyState />}
      </div>
      {editing && (
        <Modal title={editing.id ? 'Modifier l’appartement' : 'Nouvel appartement'} onClose={() => setEditing(null)}>
          <form
            className="form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              save(new FormData(event.currentTarget));
            }}
          >
            <label>Immeuble<select name="building_id" required defaultValue={editing.building_id}>{buildings.data.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
            <label>Numero<input name="number" placeholder="A-01" defaultValue={editing.number} required /></label>
            <label>Etage<input name="floor" placeholder="0" type="number" defaultValue={editing.floor} required /></label>
            <label>Type<select name="type" defaultValue={editing.type ?? 'Studio'}>{DEFAULT_UNIT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
            <label>Loyer mensuel<input name="monthly_rent" placeholder="1000" type="number" defaultValue={editing.monthly_rent} required /></label>
            <label>Statut<select name="status" defaultValue={editing.status ?? 'VACANT'}>
              <option value="VACANT">Libre</option>
              <option value="OCCUPIED">Occupe</option>
              <option value="MAINTENANCE">Maintenance</option>
              <option value="BLOCKED">Bloque</option>
            </select></label>
            <button>Enregistrer</button>
          </form>
        </Modal>
      )}
      {viewing && (
        <Modal title="Détail appartement" onClose={() => setViewing(null)}>
          <div className="detail-list">
            <span>Appartement</span><strong>{viewing.number}</strong>
            <span>Immeuble</span><strong>{viewing.building_name}</strong>
            <span>Loyer</span><strong>{money(viewing.monthly_rent)}</strong>
            <span>Statut</span><strong>{viewing.status}</strong>
            <span>Locataire actuel</span><strong>{viewing.tenant_name || '-'}</strong>
            <span>Situation</span><strong>{viewing.situation}</strong>
          </div>
          <div className="detail-section">
            <h4>Historique locataires</h4>
            <div className="compact-list">{viewing.tenants.map((tenant) => <div className="compact-item" key={tenant.id}><span>{tenant.first_name} {tenant.last_name}</span><strong>{tenant.phone}</strong></div>)}</div>
          </div>
          <div className="detail-section">
            <h4>Factures liées</h4>
            <div className="compact-list">{viewing.invoices.map((invoice) => <div className="compact-item" key={invoice.id}><span>{invoice.invoice_number} · {shortDate(invoice.due_date)} · <StatusBadge value={invoiceDisplayStatus(invoice.status, invoice.due_date)} /></span><strong>{money(invoice.remaining_amount)}</strong></div>)}</div>
          </div>
          <div className="detail-section">
            <h4>Paiements liés</h4>
            <div className="compact-list">{viewing.payments.map((payment) => <div className="compact-item" key={payment.id}><span>{payment.invoice_number} · {shortDate(payment.payment_date)} · {paymentMethodLabel(payment.payment_method)}</span><strong>{money(payment.amount)}</strong></div>)}</div>
          </div>
        </Modal>
      )}
    </section>
  );
}

function amount(value: unknown) {
  return Number(value ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}
