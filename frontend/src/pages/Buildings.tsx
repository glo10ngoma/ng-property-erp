import { BarChart3, Eye, FileSpreadsheet, FileText, Pencil, Plus, Printer, RotateCcw, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, exportCsv, exportExcel, includesText } from '../api';
import { useAuth } from '../auth';
import { EmptyState, Modal, PageHeader, SuccessMessage } from '../components';
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
  observations?: string;
  description?: string;
};

type SortKey = 'name' | 'city' | 'commune' | 'building_type' | 'unit_count' | 'state' | 'address' | 'status';
type SortState = { key: SortKey; direction: 'asc' | 'desc' };

const DEFAULT_BUILDING_TYPES = [
  'Résidence',
  'Immeuble R+1',
  'Immeuble R+2',
  'Immeuble R+3',
  'Immeuble R+4',
  'Immeuble R+5',
  'Immeuble R+10',
  'Centre commercial',
  'Immeuble de bureaux',
  'Villa',
  'Maison individuelle',
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
  const [error, setError] = useState('');

  const cities = useMemo(() => uniqueValues(data.map((building) => building.city)), [data]);
  const communes = useMemo(() => uniqueValues(data.map((building) => building.commune)), [data]);
  const typeValues = useMemo(() => uniqueValues([...DEFAULT_BUILDING_TYPES, ...data.map((building) => building.building_type)]), [data]);

  const filtered = data
    .filter((building) => includesText(building, query))
    .filter((building) => !filters.city || building.city === filters.city)
    .filter((building) => !filters.commune || building.commune === filters.commune)
    .filter((building) => !filters.building_type || building.building_type === filters.building_type)
    .filter((building) => !filters.status || (building.status ?? 'ACTIVE') === filters.status)
    .filter((building) => !filters.state || (building.state ?? 'EXPLOITED') === filters.state)
    .filter((building) => !filters.occupation || matchesOccupation(building, filters.occupation));

  const sorted = [...filtered].sort((a, b) => compareBuildings(a, b, sort));
  const summary = summarizeBuildings(filtered);

  async function save(form: FormData) {
    const payload = cleanPayload(Object.fromEntries(form) as Record<string, string>);
    setError('');
    try {
      if (editing?.id) await api.put(`/buildings/${editing.id}`, payload);
      else await api.post('/buildings', payload);
      setSuccess(editing?.id ? 'Immeuble modifié avec succès.' : 'Immeuble créé avec succès.');
      setEditing(null);
      await reload();
    } catch (err) {
      console.error(err);
      setError("Impossible d'enregistrer l'immeuble. Vérifiez les champs obligatoires.");
    }
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
    }));
  }

  return (
    <section>
      <PageHeader title="Immeubles" action={can('buildings.create') ? <button onClick={() => { setError(''); setEditing({}); }}><Plus size={16} />Nouvel immeuble</button> : undefined} />
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
        <select value={filters.city} onChange={(event) => setFilters({ ...filters, city: event.target.value })}>
          <option value="">Ville</option>
          {cities.map((city) => <option key={city} value={city}>{city}</option>)}
        </select>
        <select value={filters.commune} onChange={(event) => setFilters({ ...filters, commune: event.target.value })}>
          <option value="">Commune</option>
          {communes.map((commune) => <option key={commune} value={commune}>{commune}</option>)}
        </select>
        <select value={filters.building_type} onChange={(event) => setFilters({ ...filters, building_type: event.target.value })}>
          <option value="">Type</option>
          {typeValues.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
        <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
          <option value="">Statut</option>
          {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <select value={filters.state} onChange={(event) => setFilters({ ...filters, state: event.target.value })}>
          <option value="">État</option>
          {BUILDING_STATES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <select value={filters.occupation} onChange={(event) => setFilters({ ...filters, occupation: event.target.value })}>
          <option value="">Occupation</option>
          {OCCUPATION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <div className="filter-actions">
          <button type="button" className="secondary" title="Réinitialiser" onClick={() => { setFilters(initialFilters); setQuery(''); }}><RotateCcw size={15} />Réinitialiser</button>
          <div className="export-group">
            <button type="button" className="secondary" title="Exporter CSV" onClick={() => exportCsv('immeubles.csv', exportRows())}><FileText size={15} />CSV</button>
            <button type="button" className="secondary" title="Exporter Excel" onClick={() => exportExcel('immeubles.xls', exportRows())}><FileSpreadsheet size={15} />Excel</button>
            <button type="button" className="secondary" title="Exporter PDF" onClick={() => window.print()}><Printer size={15} />PDF</button>
          </div>
        </div>
      </div>

      <div className="table-wrap buildings-table">
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
              <th className="actions-col">Actions</th>
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
                <td className="actions actions-compact" onClick={(event) => event.stopPropagation()}>
                  <button className="icon-btn" title="Voir" onClick={() => openReport(building)}><Eye size={16} /></button>
                  <button className="icon-btn" title="Rapport" onClick={() => openReport(building)}><BarChart3 size={16} /></button>
                  {can('buildings.update') && <button className="icon-btn" title="Modifier" onClick={() => { setError(''); setEditing(building); }}><Pencil size={16} /></button>}
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
          {error && <div className="error-message">{error}</div>}
          <BuildingForm editing={editing} onSubmit={save} />
        </Modal>
      )}
    </section>
  );
}

function BuildingForm({ editing, onSubmit }: { editing: Partial<Building>; onSubmit: (form: FormData) => void }) {
  return (
    <form className="form-grid building-form" onSubmit={(event) => { event.preventDefault(); onSubmit(new FormData(event.currentTarget)); }}>
      <label>Nom<input name="name" placeholder="Résidence Lumumba" defaultValue={editing.name ?? ''} required /></label>
      <label>Type<select name="building_type" defaultValue={editing.building_type ?? 'Résidence'}>{DEFAULT_BUILDING_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
      <label>État<select name="state" defaultValue={editing.state ?? 'EXPLOITED'}>{BUILDING_STATES.map((state) => <option key={state.value} value={state.value}>{state.label}</option>)}</select></label>
      <label>Ville<input name="city" placeholder="Kinshasa" defaultValue={editing.city ?? ''} required /></label>
      <label>Commune <span>optionnel</span><input name="commune" placeholder="Gombe" defaultValue={editing.commune ?? ''} /></label>
      <label>Adresse<input name="address" placeholder="Adresse complète" defaultValue={editing.address ?? ''} required /></label>
      <label>Nombre d'étages <span>optionnel</span><input type="number" min="0" name="floors_count" defaultValue={editing.floors_count ?? ''} /></label>
      <label>Nombre total d'unités <span>optionnel</span><input type="number" min="0" name="total_units" defaultValue={editing.total_units ?? ''} /></label>
      <label className="form-field-full">Observations <span>optionnel</span><textarea name="observations" placeholder="Notes internes" defaultValue={editing.observations ?? editing.description ?? ''} /></label>
      <button type="submit" className="form-submit">Enregistrer</button>
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

function uniqueValues(values: Array<string | undefined>) {
  return Array.from(new Set(values.filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b));
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

function cleanPayload(payload: Record<string, string>) {
  return Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, value === '' ? undefined : value]));
}
