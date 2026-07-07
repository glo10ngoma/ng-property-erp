import { ArrowLeft, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, money, statusLabel } from '../api';
import { PageHeader, SearchableSelect, SuccessMessage, TenantSearchSelect } from '../components';
import { useApiList } from '../hooks';

type Building = { id: number; name: string; city?: string; building_type?: string };
type Unit = { id: number; building_id: number; building_name: string; number: string; monthly_rent: number; status: string };
type Tenant = { id: number; first_name: string; last_name: string; phone?: string; building_name?: string; unit_number?: string };

export function LeaseNew() {
  const navigate = useNavigate();
  const buildings = useApiList<Building>('/buildings');
  const units = useApiList<Unit>('/units');
  const tenants = useApiList<Tenant>('/tenants');
  const [buildingId, setBuildingId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [tenantId, setTenantId] = useState<number | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [durationMonths, setDurationMonths] = useState('');
  const [rent, setRent] = useState(0);
  const [message, setMessage] = useState('');
  const [contractName, setContractName] = useState('');

  const availableUnits = useMemo(
    () => units.data.filter((unit) => !buildingId || Number(unit.building_id) === Number(buildingId)),
    [units.data, buildingId],
  );
  const selectedUnit = availableUnits.find((unit) => Number(unit.id) === Number(unitId)) ?? availableUnits[0];
  const buildingOptions = buildings.data.map((building) => ({
    value: building.id,
    label: building.name,
    meta: [building.city, building.building_type].filter(Boolean).join(' - '),
  }));
  const unitOptions = availableUnits.map((unit) => ({
    value: unit.id,
    label: unit.number,
    meta: `${unit.building_name} - ${money(unit.monthly_rent)} - ${statusLabel(unit.status)}`,
  }));

  useEffect(() => {
    if (selectedUnit) setRent(Number(selectedUnit.monthly_rent ?? 0));
  }, [selectedUnit?.id]);

  function updateStartDate(value: string) {
    setStartDate(value);
    if (value && durationMonths) setEndDate(addMonths(value, Number(durationMonths)));
    else if (value && endDate) setDurationMonths(String(monthDiff(value, endDate)));
  }

  function updateEndDate(value: string) {
    setEndDate(value);
    if (startDate && value) setDurationMonths(String(monthDiff(startDate, value)));
  }

  function updateDuration(value: string) {
    setDurationMonths(value);
    if (startDate && Number(value) > 0) setEndDate(addMonths(startDate, Number(value)));
  }

  async function save(form: FormData) {
    if (!Number(form.get('tenant_id'))) {
      setMessage('Selectionnez un locataire avant de creer le bail.');
      return;
    }
    if (!Number(form.get('unit_id'))) {
      setMessage('Selectionnez une unite avant de creer le bail.');
      return;
    }
    const payload = {
      tenant_id: Number(form.get('tenant_id')),
      unit_id: Number(form.get('unit_id')),
      start_date: form.get('start_date'),
      end_date: form.get('end_date') || null,
      monthly_rent: rent,
      rental_guarantee_amount: Number(form.get('rental_guarantee_amount') ?? 0),
      rental_guarantee_paid: Number(form.get('rental_guarantee_paid') ?? 0),
      rental_guarantee_payment_date: form.get('rental_guarantee_payment_date') || null,
      rental_guarantee_status: form.get('rental_guarantee_status'),
      contract_file_name: contractName || form.get('contract_file_name') || null,
      contract_file_url: null,
      status: form.get('status') || 'DRAFT',
      notes: form.get('notes') || null,
    };
    await api.post('/leases', payload);
    setMessage('Bail cree avec succes. Le contrat sera stocke dans le bucket contracts lorsque Supabase Storage sera active.');
    setTimeout(() => navigate('/leases'), 700);
  }

  return (
    <section>
      <PageHeader title="Nouveau bail" action={<button className="secondary" onClick={() => navigate('/leases')}><ArrowLeft size={16} />Retour</button>} />
      <SuccessMessage message={message} />
      <form className="lease-form" onSubmit={(event) => { event.preventDefault(); save(new FormData(event.currentTarget)); }}>
        <div className="detail-section">
          <h4>Informations generales</h4>
          <div className="lease-section-grid">
            <label className="lease-field-wide">Immeuble<SearchableSelect options={buildingOptions} value={buildingId ? Number(buildingId) : null} onChange={(value) => { setBuildingId(value ? String(value) : ''); setUnitId(''); }} placeholder="Rechercher un immeuble" emptyMessage="Aucun immeuble trouve" /></label>
            <label className="lease-field-wide">Unite / Appartement<SearchableSelect options={unitOptions} value={unitId ? Number(unitId) : selectedUnit?.id ?? null} onChange={(value) => setUnitId(value ? String(value) : '')} placeholder="Rechercher une unite" emptyMessage="Aucune unite trouve" /><input name="unit_id" value={unitId || selectedUnit?.id || ''} readOnly type="hidden" /></label>
            <label className="lease-field-wide">Locataire<TenantSearchSelect tenants={tenants.data} value={tenantId} onChange={setTenantId} required /></label>
          </div>
        </div>

        <div className="detail-section">
          <h4>Informations du bail</h4>
          <div className="lease-section-grid">
            <label>Date debut<input name="start_date" type="date" value={startDate} onChange={(event) => updateStartDate(event.target.value)} required /></label>
            <label>Date fin<input name="end_date" type="date" value={endDate} onChange={(event) => updateEndDate(event.target.value)} /></label>
            <label>Duree du bail (mois)<input name="duration" type="number" min="1" value={durationMonths} onChange={(event) => updateDuration(event.target.value)} placeholder="12" /></label>
            <label className="lease-field-wide">Jour limite de paiement du loyer<input name="due_day" type="number" min="1" max="31" defaultValue="5" /><small>Exemple : 5 signifie que le loyer doit etre paye au plus tard le 5 de chaque mois.</small></label>
            <label>Loyer<input name="monthly_rent" type="number" required value={rent} onChange={(event) => setRent(Number(event.target.value))} /></label>
            <label>Devise<input name="currency" value="USD" readOnly /></label>
            <label>Statut<select name="status" defaultValue="DRAFT"><option value="DRAFT">Brouillon</option><option value="ACTIVE">Actif</option><option value="TERMINATED">Resilie</option></select></label>
          </div>
        </div>

        <div className="detail-section">
          <h4>Garantie locative</h4>
          <div className="lease-section-grid">
            <label>Montant<input name="rental_guarantee_amount" type="number" defaultValue="0" /></label>
            <label>Devise<input name="guarantee_currency" value="USD" readOnly /></label>
            <label>Montant paye<input name="rental_guarantee_paid" type="number" defaultValue="0" /></label>
            <label>Statut garantie<select name="rental_guarantee_status" defaultValue="NOT_PAID"><option value="NOT_PAID">Non payee</option><option value="PARTIAL">Paiement partiel</option><option value="PAID">Payee</option></select></label>
            <label>Date paiement<input name="rental_guarantee_payment_date" type="date" /></label>
          </div>
        </div>

        <div className="detail-section">
          <h4>Contrat scanne</h4>
          <div className="lease-section-grid">
            <label className="lease-field-wide">Piece jointe contrat<input type="file" accept="application/pdf,image/*" onChange={(event) => setContractName(event.target.files?.[0]?.name ?? '')} /></label>
            <label className="lease-field-wide">Nom du fichier<input name="contract_file_name" value={contractName} onChange={(event) => setContractName(event.target.value)} placeholder="contrat-bail.pdf" /></label>
          </div>
          <p className="empty">Stockage cible : Supabase Storage / bucket contracts. En local, le nom du fichier est enregistre pour conserver la trace du contrat.</p>
        </div>

        <div className="detail-section">
          <h4>Observations</h4>
          <div className="lease-section-grid">
            <label className="lease-field-full">Notes<textarea name="notes" placeholder="Observations internes" /></label>
          </div>
        </div>

        <div className="actions">
          <button><Save size={16} />Enregistrer le bail</button>
          <button type="button" className="secondary" onClick={() => navigate('/leases')}>Annuler</button>
        </div>
      </form>
    </section>
  );
}

function addMonths(dateValue: string, months: number) {
  const date = new Date(dateValue);
  date.setMonth(date.getMonth() + months);
  return date.toISOString().slice(0, 10);
}

function monthDiff(startValue: string, endValue: string) {
  const start = new Date(startValue);
  const end = new Date(endValue);
  const diff = (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth();
  return Math.max(diff, 0);
}
