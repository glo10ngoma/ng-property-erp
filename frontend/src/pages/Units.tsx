import { AlertTriangle, Eye, FileSpreadsheet, FileText, Pencil, Plus, Printer } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, exportCsv, exportExcel, includesText, shortDate } from '../api';
import { useAuth } from '../auth';
import { EmptyState, Modal, PageHeader, StatusBadge, SuccessMessage } from '../components';
import { useApiList } from '../hooks';

type Unit = {
  id: number;
  building_id: number;
  building_name: string;
  number: string;
  floor: number;
  type: string;
  monthly_rent: number;
  status: string;
  tenant_name?: string;
  tenant_phone?: string;
  active_lease_end_date?: string;
  surface_area?: number;
  bedrooms_count?: number;
  bathrooms_count?: number;
  has_balcony?: boolean;
  has_parking?: boolean;
  is_furnished?: boolean;
  has_air_conditioning?: boolean;
  has_equipped_kitchen?: boolean;
  has_internet?: boolean;
  has_water_meter?: boolean;
  water_meter_number?: string;
  has_electricity_meter?: boolean;
  electricity_meter_number?: string;
  description?: string;
  observations?: string;
};

type Building = { id: number; name: string };

const UNIT_TYPES = [
  'Studio',
  'Appartement 1 chambre',
  'Appartement 2 chambres',
  'Appartement 3 chambres',
  'Appartement 4 chambres',
  'Penthouse',
  'Duplex',
  'Villa',
  'Bureau',
  'Commerce',
  'Autre',
];

const UNIT_STATUSES = [
  { value: 'VACANT', label: 'Libre' },
  { value: 'OCCUPIED', label: 'Occupé' },
  { value: 'RESERVED', label: 'Réservé' },
  { value: 'MAINTENANCE', label: 'Maintenance' },
  { value: 'BLOCKED', label: 'Bloqué' },
];

const RENT_RANGES = [
  { value: 'lt500', label: '<500', min: 0, max: 499.999 },
  { value: '500-1000', label: '500-1000', min: 500, max: 1000 },
  { value: '1000-2000', label: '1000-2000', min: 1000, max: 2000 },
  { value: 'gt2000', label: '>2000', min: 2000.001, max: Number.POSITIVE_INFINITY },
];

export function Units() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { data, reload } = useApiList<Unit>('/units');
  const buildings = useApiList<Building>('/buildings');
  const [editing, setEditing] = useState<Partial<Unit> | null>(null);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState({ building_id: '', type: '', status: '', availability: '', rent_range: '' });
  const [success, setSuccess] = useState('');

  const buildingOptions = useMemo(() => {
    const merged = [...buildings.data, ...data.map((unit) => ({ id: unit.building_id, name: unit.building_name }))];
    return Array.from(new Map(merged.map((building) => [building.id, building])).values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [buildings.data, data]);

  const filtered = data
    .filter((unit) => includesText(unit, query))
    .filter((unit) => !filters.building_id || Number(unit.building_id) === Number(filters.building_id))
    .filter((unit) => !filters.type || unit.type === filters.type)
    .filter((unit) => !filters.status || unit.status === filters.status)
    .filter((unit) => !filters.availability || unit.status === filters.availability)
    .filter((unit) => matchesRentRange(unit, filters.rent_range));

  const occupied = data.filter((unit) => unit.status === 'OCCUPIED').length;
  const vacant = data.filter((unit) => unit.status === 'VACANT').length;
  const occupancyRate = data.length ? Math.round((occupied / data.length) * 100) : 0;
  const averageRent = useMemo(() => data.length ? data.reduce((sum, unit) => sum + Number(unit.monthly_rent ?? 0), 0) / data.length : 0, [data]);

  async function save(form: FormData) {
    const buildingId = Number(form.get('building_id'));
    const createMultiple = form.get('create_multiple') === 'on';
    const payload = {
      building_id: buildingId,
      number: String(form.get('number') ?? ''),
      floor: Number(form.get('floor') ?? 0),
      type: String(form.get('type') ?? 'Studio'),
      monthly_rent: Number(form.get('monthly_rent') ?? 0),
      status: String(form.get('status') ?? 'VACANT'),
      surface_area: optionalNumber(form.get('surface_area')),
      bedrooms_count: optionalNumber(form.get('bedrooms_count')),
      bathrooms_count: optionalNumber(form.get('bathrooms_count')),
      has_balcony: form.has('has_balcony'),
      has_parking: form.has('has_parking'),
      is_furnished: form.has('is_furnished'),
      has_air_conditioning: form.has('has_air_conditioning'),
      has_equipped_kitchen: form.has('has_equipped_kitchen'),
      has_internet: form.has('has_internet'),
      has_water_meter: form.has('has_water_meter'),
      water_meter_number: optionalText(form.get('water_meter_number')),
      has_electricity_meter: form.has('has_electricity_meter'),
      electricity_meter_number: optionalText(form.get('electricity_meter_number')),
      description: optionalText(form.get('description')),
      observations: optionalText(form.get('observations')),
    };

    if (editing?.id) {
      await api.put(`/units/${editing.id}`, payload);
      setSuccess('Appartement modifié avec succès.');
    } else if (createMultiple) {
      const start = String(form.get('range_start') ?? '').trim();
      const end = String(form.get('range_end') ?? '').trim();
      const generated = generateUnitNumbers(start, end);
      if (!generated.length) throw new Error('La plage de numéros est invalide.');
      const existing = new Set(data.filter((unit) => Number(unit.building_id) === buildingId).map((unit) => unit.number.toLowerCase()));
      const duplicates = generated.filter((value) => existing.has(value.toLowerCase()));
      if (duplicates.length) throw new Error(`Numéros déjà existants : ${duplicates.join(', ')}`);
      for (const number of generated) {
        await api.post('/units', { ...payload, number });
      }
      setSuccess(`${generated.length} appartements créés avec succès.`);
    } else {
      await api.post('/units', payload);
      setSuccess('Appartement créé avec succès.');
    }

    setEditing(null);
    reload();
  }

  function exportRows() {
    return filtered.map((unit) => ({
      immeuble: unit.building_name,
      numero: unit.number,
      etage: unit.floor,
      type: unit.type,
      loyer: unit.monthly_rent,
      devise: 'USD',
      statut: unit.status,
      locataire: unit.tenant_name ?? '',
      telephone: unit.tenant_phone ?? 'Non occupé',
      fin_bail: unit.active_lease_end_date ? shortDate(unit.active_lease_end_date) : '',
    }));
  }

  return (
    <section>
      <PageHeader title="Appartements" action={can('units.create') ? <button onClick={() => setEditing({})}><Plus size={16} />Nouvel appartement</button> : undefined} />
      <SuccessMessage message={success} />
      <div className="mini-stats">
        <div className="mini-stat"><span>Total</span><strong>{data.length}</strong></div>
        <div className="mini-stat"><span>Occupés</span><strong>{occupied}</strong></div>
        <div className="mini-stat"><span>Libres</span><strong>{vacant}</strong></div>
        <div className="mini-stat"><span>Taux d'occupation</span><strong>{occupancyRate}%</strong></div>
        <div className="mini-stat"><span>Loyer moyen</span><strong>{amount(averageRent)} USD</strong></div>
      </div>
      <div className="table-toolbar">
        <div className="toolbar-main"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher" /></div>
        <div className="toolbar-actions">
          <button className="secondary" onClick={() => exportCsv('appartements.csv', exportRows())}><FileText size={15} />CSV</button>
          <button className="secondary" onClick={() => exportExcel('appartements.xls', exportRows())}><FileSpreadsheet size={15} />Excel</button>
          <button className="secondary" onClick={() => window.print()}><Printer size={15} />PDF</button>
        </div>
      </div>
      <div className="quick-form">
        <select value={filters.building_id} onChange={(event) => setFilters({ ...filters, building_id: event.target.value })}><option value="">Tous les immeubles</option>{buildingOptions.map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}</select>
        <select value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value })}><option value="">Tous les types</option>{UNIT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select>
        <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">Tous les statuts</option>{UNIT_STATUSES.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}</select>
        <select value={filters.availability} onChange={(event) => setFilters({ ...filters, availability: event.target.value })}><option value="">Occupation</option><option value="OCCUPIED">Occupé</option><option value="VACANT">Libre</option></select>
        <select value={filters.rent_range} onChange={(event) => setFilters({ ...filters, rent_range: event.target.value })}><option value="">Tranche de loyer</option>{RENT_RANGES.map((range) => <option key={range.value} value={range.value}>{range.label}</option>)}</select>
        <button type="button" className="secondary" onClick={() => setFilters({ building_id: '', type: '', status: '', availability: '', rent_range: '' })}>Réinitialiser filtres</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Immeuble</th><th>Numéro</th><th>Étage</th><th>Type</th><th className="right">Loyer</th><th>Devise</th><th>Statut</th><th>Locataire actuel</th><th>Téléphone</th><th>Fin du bail</th><th>Actions</th></tr></thead>
          <tbody>
            {filtered.map((unit) => (
              <tr key={unit.id} className="clickable-row" onClick={() => navigate(`/rental-units/${unit.id}`)}>
                <td>{unit.building_name}</td>
                <td>{unit.number}</td>
                <td>{unit.floor}</td>
                <td>{unit.type}</td>
                <td className="right">{amount(unit.monthly_rent)}</td>
                <td>USD</td>
                <td><StatusBadge value={unit.status} /></td>
                <td>{unit.tenant_name || '-'}</td>
                <td>{unit.tenant_phone || 'Non occupé'}</td>
                <td><LeaseEndBadge date={unit.active_lease_end_date} /></td>
                <td className="actions" onClick={(event) => event.stopPropagation()}>
                  <button className="icon-btn" title="Voir" onClick={() => navigate(`/rental-units/${unit.id}`)}><Eye size={16} /></button>
                  {can('units.update') && <button className="icon-btn" title="Modifier" onClick={() => setEditing(unit)}><Pencil size={16} /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && <EmptyState />}
      </div>
      {editing && (
        <Modal title={editing.id ? "Modifier l'appartement" : 'Nouvel appartement'} onClose={() => setEditing(null)}>
          <UnitForm editing={editing} buildings={buildingOptions} onSubmit={save} />
        </Modal>
      )}
    </section>
  );
}

function UnitForm({ editing, buildings, onSubmit }: { editing: Partial<Unit>; buildings: Building[]; onSubmit: (form: FormData) => void }) {
  const [createMultiple, setCreateMultiple] = useState(false);

  return (
    <form className="form-grid unit-form" onSubmit={(event) => { event.preventDefault(); onSubmit(new FormData(event.currentTarget)); }}>
      <label>Immeuble<select name="building_id" required defaultValue={editing.building_id ?? ''}><option value="" disabled>Choisir</option>{buildings.map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}</select></label>
      <label>Numéro<input name="number" placeholder="A-01" defaultValue={editing.number ?? ''} required /></label>
      {!editing.id && (
        <label className="check-line form-field-full">
          <input type="checkbox" name="create_multiple" checked={createMultiple} onChange={(event) => setCreateMultiple(event.target.checked)} />
          Créer plusieurs appartements
        </label>
      )}
      {!editing.id && createMultiple && (
        <>
          <label>Début<input name="range_start" placeholder="A-01" required={createMultiple} /></label>
          <label>Fin<input name="range_end" placeholder="A-20" required={createMultiple} /></label>
          <div className="compact-empty form-field-full"><AlertTriangle size={15} /> La plage sera générée automatiquement à partir du préfixe et du numéro final.</div>
        </>
      )}
      <label>Type<select name="type" defaultValue={editing.type ?? 'Studio'}>{UNIT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
      <label>Étage<input name="floor" type="number" defaultValue={editing.floor ?? 0} required /></label>
      <label>Surface (m²)<input name="surface_area" type="number" step="0.01" defaultValue={editing.surface_area ?? ''} /></label>
      <label>Nombre de chambres<input name="bedrooms_count" type="number" min="0" defaultValue={editing.bedrooms_count ?? ''} /></label>
      <label>Loyer<input name="monthly_rent" type="number" min="0" step="0.01" defaultValue={editing.monthly_rent ?? ''} required /></label>
      <label>Devise<input className="locked-field" value="USD" readOnly /></label>
      <label>Nombre de salles de bain<input name="bathrooms_count" type="number" min="0" defaultValue={editing.bathrooms_count ?? ''} /></label>
      <label>Statut<select name="status" defaultValue={editing.status ?? 'VACANT'}>{UNIT_STATUSES.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}</select></label>
      <div className="form-field-full unit-options">
        {[
          ['has_balcony', 'Balcon', editing.has_balcony],
          ['has_parking', 'Parking', editing.has_parking],
          ['is_furnished', 'Meublé', editing.is_furnished],
          ['has_air_conditioning', 'Climatisation', editing.has_air_conditioning],
          ['has_equipped_kitchen', 'Cuisine équipée', editing.has_equipped_kitchen],
          ['has_internet', 'Internet', editing.has_internet],
          ['has_water_meter', 'Compteur eau', editing.has_water_meter],
          ['has_electricity_meter', 'Compteur électricité', editing.has_electricity_meter],
        ].map(([name, label, checked]) => <label className="check-line" key={String(name)}><input type="checkbox" name={String(name)} defaultChecked={Boolean(checked)} />{label}</label>)}
      </div>
      <label>Numéro compteur eau<input name="water_meter_number" defaultValue={editing.water_meter_number ?? ''} /></label>
      <label>Numéro compteur électricité<input name="electricity_meter_number" defaultValue={editing.electricity_meter_number ?? ''} /></label>
      <label className="form-field-full">Description<textarea name="description" defaultValue={editing.description ?? ''} /></label>
      <label className="form-field-full">Observations<textarea name="observations" defaultValue={editing.observations ?? ''} /></label>
      <button>Enregistrer</button>
    </form>
  );
}

export function LeaseEndBadge({ date }: { date?: string }) {
  if (!date) return <span>—</span>;
  const today = new Date();
  const end = new Date(`${date.slice(0, 10)}T00:00:00`);
  const days = Math.ceil((end.getTime() - today.getTime()) / 86400000);
  const className = days < 30 ? 'overdue' : days < 60 ? 'partial' : 'paid';
  return <span className={`badge ${className}`}>{shortDate(date)}</span>;
}

function matchesRentRange(unit: Unit, rangeValue: string) {
  if (!rangeValue) return true;
  const range = RENT_RANGES.find((item) => item.value === rangeValue);
  if (!range) return true;
  const rent = Number(unit.monthly_rent ?? 0);
  return rent >= range.min && rent <= range.max;
}

function optionalNumber(value: FormDataEntryValue | null) {
  return value === null || value === '' ? undefined : Number(value);
}

function optionalText(value: FormDataEntryValue | null) {
  return value === null || value === '' ? undefined : String(value);
}

function amount(value: unknown) {
  return Number(value ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}

function generateUnitNumbers(start: string, end: string) {
  const startMatch = start.match(/^(.*?)(\d+)$/);
  const endMatch = end.match(/^(.*?)(\d+)$/);
  if (!startMatch || !endMatch || startMatch[1] !== endMatch[1]) return [];
  const prefix = startMatch[1];
  const startValue = Number(startMatch[2]);
  const endValue = Number(endMatch[2]);
  const width = Math.max(startMatch[2].length, endMatch[2].length);
  if (!Number.isFinite(startValue) || !Number.isFinite(endValue) || endValue < startValue) return [];
  return Array.from({ length: endValue - startValue + 1 }, (_, index) => `${prefix}${String(startValue + index).padStart(width, '0')}`);
}
