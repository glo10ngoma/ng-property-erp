import { BarChart3, Eye, FileSpreadsheet, FileText, Pencil, Plus, Printer, RotateCcw, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, exportCsv, exportExcel, includesText } from '../api';
import { useAuth } from '../auth';
import { EmptyState, Modal, PageHeader, SearchableSelect, SuccessMessage } from '../components';
import { useApiList } from '../hooks';

type Building = {
  id: number;
  name: string;
  address: string;
  city: string;
  commune?: string;
  building_type?: string;
  state?: string;
  status?: string;
  unit_count: number;
  occupied_count?: number;
  vacant_count?: number;
  floors_count?: number;
  total_units?: number;
  manager_name?: string;
  manager_phone?: string;
  manager_email?: string;
  observations?: string;
  description?: string;
  created_at?: string;
};

type SortKey = 'name' | 'city' | 'commune' | 'building_type' | 'unit_count' | 'state' | 'address' | 'status';
type SortState = { key: SortKey; direction: 'asc' | 'desc' };

const DEFAULT_BUILDING_TYPES = [
  'Maison individuelle',
  'Villa',
  'Immeuble R+1',
  'Immeuble R+2',
  'Immeuble R+3',
  'Immeuble R+4',
  'Immeuble R+5',
  'Immeuble R+10',
  'Centre commercial',
  'Immeuble de bureaux',
  'Résidence',
  'Mixte',
  'Autre',
];

const BUILDING_STATES = [
  { value: 'EXPLOITED', label: 'Exploité' },
  { value: 'MAINTENANCE', label: 'Maintenance' },
  { value: 'CONSTRUCTION', label: 'Construction' },
  { value: 'CLOSED', label: 'Fermé' },
];

const STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Actif' },
  { value: 'INACTIVE', label: 'Inactif' },
];

const OCCUPATION_OPTIONS = [
  { value: 'OCCUPIED', label: 'Avec unités occupées' },
  { value: 'VACANT', label: 'Avec unités libres' },
  { value: 'NO_UNITS', label: 'Sans unité' },
];

const initialFilters = {
  city: '',
  commune: '',
  building_type: '',
  status: '',
  state: '',
  occupation: '',
  units_min: '',
  units_max: '',
  start: '',
  end: '',
};

export function Buildings() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { data, reload } = useApiList<Building>('/buildings');
  const [editing, setEditing] = useState<Partial<Building> | null>(null);
  const [filters, setFilters] = useState(initialFilters);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortState>({ key: 'name', direction: 'asc' });
  const [success, setSuccess] = useState('');

  const cities = useMemo(() => uniqueOptions(data.map((building) => building.city)), [data]);
  const communes = useMemo(() => uniqueOptions(data.map((building) => building.commune)), [data]);
  const typeOptions = useMemo(() => uniqueOptions([...DEFAULT_BUILDING_TYPES, ...data.map((building) => building.building_type)]), [data]);

  const filtered = data
    .filter((building) => includesText(building, query))
    .filter((building) => !filters.city || building.city === filters.city)
    .filter((building) => !filters.commune || building.commune === filters.commune)
    .filter((building) => !filters.building_type || building.building_type === filters.building_type)
    .filter((building) => !filters.status || (building.status ?? 'ACTIVE') === filters.status)
    .filter((building) => !filters.state || (building.state ?? 'EXPLOITED') === filters.state)
    .filter((building) => !filters.occupation || matchesOccupation(building, filters.occupation))
    .filter((building) => !filters.units_min || Number(building.unit_count) >= Number(filters.units_min))
    .filter((building) => !filters.units_max || Number(building.unit_count) <= Number(filters.units_max))
    .filter((building) => !filters.start || !building.created_at || building.created_at.slice(0, 10) >= filters.start)
    .filter((building) => !filters.end || !building.created_at || building.created_at.slice(0, 10) <= filters.end);

  const sorted = [...filtered].sort((a, b) => compareBuildings(a, b, sort));
  const summary = summarizeBuildings(filtered);

  async function save(form: FormData) {
    const payload = Object.fromEntries(form) as Record<string, string>;
    if (editing?.id) await api.put(`/buildings/${editing.id}`, payload);
    else await api.post('/buildings', payload);
    setSuccess(editing?.id ? 'Immeuble modifié avec succès.' : 'Immeuble créé avec succès.');
    setEditing(null);
    reload();
  }

  async function remove(id: number) {
    await api.delete(`/buildings/${id}`);
    setSuccess('Immeuble supprimé avec succès.');
    reload();
  }

  function openReport(building: Building) {
    navigate(`/buildings/${building.id}/report`);
  }

  function toggleSort(key: SortKey) {
    setSort((current) => ({ key, direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc' }));
  }

  function exportRows() {
    return filtered.map((building) => ({
      id: building.id,
      nom: building.name,
      type: building.building_type ?? 'Résidence',
      etat: stateLabel(building.state),
      statut: building.status ?? 'ACTIVE',
      ville: building.city,
      commune: building.commune ?? '',
      adresse: building.address,
      unites: building.unit_count,
      occupees: building.occupied_count ?? 0,
      libres: building.vacant_count ?? 0,
      gestionnaire: building.manager_name ?? '',
      telephone: building.manager_phone ?? '',
      email: building.manager_email ?? '',
    }));
  }

  return (
    <section>
      <PageHeader title="Immeubles" action={can('buildings.create') ? <button onClick={() => setEditing({})}><Plus size={16} />Nouvel immeuble</button> : undefined} />
      <SuccessMessage message={success} />

      <div className="summary-band buildings-summary">
        <SummaryItem label="Immeubles" value={summary.buildings} />
        <SummaryItem label="Unités" value={summary.units} />
        <SummaryItem label="Occupées" value={summary.occupied} />
        <SummaryItem label="Libres" value={summary.vacant} />
        <SummaryItem label="Taux d'occupation" value={`${summary.occupancyRate}%`} />
      </div>

      <div className="buildings-filter-bar">
        <input className="filter-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher" />
        <SearchableSelect options={cities} value={filters.city || null} onChange={(value) => setFilters({ ...filters, city: String(value ?? '') })} placeholder="Ville" emptyMessage="Aucune ville" />
        <SearchableSelect options={communes} value={filters.commune || null} onChange={(value) => setFilters({ ...filters, commune: String(value ?? '') })} placeholder="Commune" emptyMessage="Aucune commune" />
        <SearchableSelect options={typeOptions} value={filters.building_type || null} onChange={(value) => setFilters({ ...filters, building_type: String(value ?? '') })} placeholder="Type" emptyMessage="Aucun type" />
        <SearchableSelect options={STATUS_OPTIONS} value={filters.status || null} onChange={(value) => setFilters({ ...filters, status: String(value ?? '') })} placeholder="Statut" emptyMessage="Aucun statut" />
        <SearchableSelect options={OCCUPATION_OPTIONS} value={filters.occupation || null} onChange={(value) => setFilters({ ...filters, occupation: String(value ?? '') })} placeholder="Occupation" emptyMessage="Aucune option" />
        <input type="number" placeholder="Unités min" value={filters.units_min} onChange={(event) => setFilters({ ...filters, units_min: event.target.value })} />
        <input type="number" placeholder="Unités max" value={filters.units_max} onChange={(event) => setFilters({ ...filters, units_max: event.target.value })} />
        <input type="date" value={filters.start} onChange={(event) => setFilters({ ...filters, start: event.target.value })} />
        <input type="date" value={filters.end} onChange={(event) => setFilters({ ...filters, end: event.target.value })} />
        <button type="button" className="secondary" title="Réinitialiser" onClick={() => { setFilters(initialFilters); setQuery(''); }}><RotateCcw size={15} />Réinitialiser</button>
        <div className="export-group">
          <button type="button" className="secondary" title="Exporter CSV" onClick={() => exportCsv('immeubles.csv', exportRows())}><FileText size={15} />CSV</button>
          <button type="button" className="secondary" title="Exporter Excel" onClick={() => exportExcel('immeubles.xls', exportRows())}><FileSpreadsheet size={15} />Excel</button>
          <button type="button" className="secondary" title="Exporter PDF" onClick={() => window.print()}><Printer size={15} />PDF</button>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <SortableTh label="Nom" column="name" sort={sort} onSort={toggleSort} />
              <SortableTh label="Type" column="building_type" sort={sort} onSort={toggleSort} />
              <SortableTh label="État" column="state" sort={sort} onSort={toggleSort} />
              <SortableTh label="Adresse" column="address" sort={sort} onSort={toggleSort} />
              <SortableTh label="Ville" column="city" sort={sort} onSort={toggleSort} />
              <SortableTh label="Commune" column="commune" sort={sort} onSort={toggleSort} />
              <SortableTh label="Unités" column="unit_count" sort={sort} onSort={toggleSort} alignRight />
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((building) => (
              <tr key={building.id} className="clickable-row" onClick={() => openReport(building)}>
                <td>{building.name}</td>
                <td>{building.building_type ?? 'Résidence'}</td>
                <td><span className={`badge ${stateClass(building.state)}`}>{stateLabel(building.state)}</span></td>
                <td className="truncate-cell" title={building.address}>{building.address}</td>
                <td>{building.city}</td>
                <td>{building.commune ?? '-'}</td>
                <td className="right">{building.unit_count}</td>
                <td className="actions" onClick={(event) => event.stopPropagation()}>
                  <button className="icon-btn" title="Voir" onClick={() => openReport(building)}><Eye size={16} /></button>
                  <button className="icon-btn" title="Rapport" onClick={() => openReport(building)}><BarChart3 size={16} /></button>
                  {can('buildings.update') && <button className="icon-btn" title="Modifier" onClick={() => setEditing(building)}><Pencil size={16} /></button>}
                  {can('buildings.delete') && <button className="icon-btn danger" title="Supprimer" onClick={() => remove(building.id)}><Trash2 size={16} /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!sorted.length && <EmptyState />}
      </div>
      <div className="pagination-bar"><span className="table-meta">{sorted.length} immeubles affichés</span></div>

      {editing && (
        <Modal title={editing.id ? 'Modifier immeuble' : 'Nouvel immeuble'} onClose={() => setEditing(null)}>
          <BuildingForm editing={editing} typeOptions={typeOptions} onSubmit={save} />
        </Modal>
      )}
    </section>
  );
}

function BuildingForm({ editing, typeOptions, onSubmit }: { editing: Partial<Building>; typeOptions: Array<{ value: string; label: string }>; onSubmit: (form: FormData) => void }) {
  const [type, setType] = useState(editing.building_type ?? 'Résidence');
  const [state, setState] = useState(editing.state ?? 'EXPLOITED');

  return (
    <form className="form-grid building-form" onSubmit={(event) => { event.preventDefault(); onSubmit(new FormData(event.currentTarget)); }}>
      <label>Nom<input name="name" placeholder="Résidence Lumumba" defaultValue={editing.name} required /></label>
      <label>Type<SearchableSelect options={typeOptions} value={type} onChange={(value) => setType(String(value ?? ''))} placeholder="Type" /><input type="hidden" name="building_type" value={type} /></label>
      <label>État<SearchableSelect options={BUILDING_STATES} value={state} onChange={(value) => setState(String(value ?? ''))} placeholder="État" /><input type="hidden" name="state" value={state} /></label>
      <label>Ville<input name="city" placeholder="Kinshasa" defaultValue={editing.city} required /></label>
      <label>Commune <span>optionnel</span><input name="commune" placeholder="Gombe" defaultValue={editing.commune} /></label>
      <label>Adresse<input name="address" placeholder="Adresse complète" defaultValue={editing.address} required /></label>
      <label>Nombre d'étages <span>optionnel</span><input type="number" min="0" name="floors_count" defaultValue={editing.floors_count} /></label>
      <label>Nombre total d'unités <span>optionnel</span><input type="number" min="0" name="total_units" defaultValue={editing.total_units} /></label>
      <label>Gestionnaire <span>optionnel</span><input name="manager_name" defaultValue={editing.manager_name} /></label>
      <label>Téléphone <span>optionnel</span><input name="manager_phone" defaultValue={editing.manager_phone} /></label>
      <label>Email <span>optionnel</span><input type="email" name="manager_email" defaultValue={editing.manager_email} /></label>
      <label className="form-field-full">Observations <span>optionnel</span><textarea name="observations" placeholder="Notes internes" defaultValue={editing.observations ?? editing.description} /></label>
      <button>Enregistrer</button>
    </form>
  );
}

function SortableTh({ label, column, sort, onSort, alignRight }: { label: string; column: SortKey; sort: SortState; onSort: (key: SortKey) => void; alignRight?: boolean }) {
  const marker = sort.key === column ? (sort.direction === 'asc' ? '▲' : '▼') : '';
  return <th className={alignRight ? 'right' : undefined}><button type="button" className="table-sort" onClick={() => onSort(column)}>{label} {marker}</button></th>;
}

function SummaryItem({ label, value }: { label: string; value: string | number }) {
  return <span className="summary-item"><span>{label}</span><strong>{value}</strong></span>;
}

function uniqueOptions(values: Array<string | undefined>) {
  return Array.from(new Set(values.filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b)).map((value) => ({ value, label: value }));
}

function matchesOccupation(building: Building, occupation: string) {
  if (occupation === 'OCCUPIED') return Number(building.occupied_count ?? 0) > 0;
  if (occupation === 'VACANT') return Number(building.vacant_count ?? 0) > 0;
  if (occupation === 'NO_UNITS') return Number(building.unit_count ?? 0) === 0;
  return true;
}

function summarizeBuildings(buildings: Building[]) {
  const units = buildings.reduce((sum, building) => sum + Number(building.unit_count ?? 0), 0);
  const occupied = buildings.reduce((sum, building) => sum + Number(building.occupied_count ?? 0), 0);
  const vacant = buildings.reduce((sum, building) => sum + Number(building.vacant_count ?? 0), 0);
  return {
    buildings: buildings.length,
    units,
    occupied,
    vacant,
    occupancyRate: units ? Math.round((occupied / units) * 100) : 0,
  };
}

function compareBuildings(a: Building, b: Building, sort: SortState) {
  const first = valueForSort(a, sort.key);
  const second = valueForSort(b, sort.key);
  const result = typeof first === 'number' && typeof second === 'number'
    ? first - second
    : String(first).localeCompare(String(second));
  return sort.direction === 'asc' ? result : -result;
}

function valueForSort(building: Building, key: SortKey) {
  if (key === 'unit_count') return Number(building.unit_count ?? 0);
  return String(building[key] ?? '');
}

function stateLabel(value?: string) {
  return BUILDING_STATES.find((state) => state.value === value)?.label ?? value ?? 'Exploité';
}

function stateClass(value?: string) {
  return String(value ?? 'EXPLOITED').toLowerCase();
}
