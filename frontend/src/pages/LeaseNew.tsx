import { ArrowLeft, Save } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, money, statusLabel } from '../api';
import { PageHeader, SuccessMessage, TenantSearchSelect } from '../components';
import { useApiList } from '../hooks';

type Building = { id: number; name: string };
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
  const [message, setMessage] = useState('');
  const [contractName, setContractName] = useState('');

  const availableUnits = useMemo(
    () => units.data.filter((unit) => !buildingId || Number(unit.building_id) === Number(buildingId)),
    [units.data, buildingId],
  );
  const selectedUnit = availableUnits.find((unit) => Number(unit.id) === Number(unitId)) ?? availableUnits[0];

  async function save(form: FormData) {
    if (!Number(form.get('tenant_id'))) {
      setMessage('Selectionnez un locataire avant de creer le bail.');
      return;
    }
    const payload = {
      tenant_id: Number(form.get('tenant_id')),
      unit_id: Number(form.get('unit_id')),
      start_date: form.get('start_date'),
      end_date: form.get('end_date') || null,
      monthly_rent: Number(form.get('monthly_rent')),
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
            <label className="lease-field-wide">Immeuble<select value={buildingId} onChange={(event) => { setBuildingId(event.target.value); setUnitId(''); }} required><option value="">Selectionner un immeuble</option>{buildings.data.map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}</select></label>
            <label className="lease-field-wide">Unite / Appartement<select name="unit_id" value={unitId || selectedUnit?.id || ''} onChange={(event) => setUnitId(event.target.value)} required>{availableUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.building_name} / {unit.number} - {statusLabel(unit.status)} - {money(unit.monthly_rent)}</option>)}</select></label>
            <label className="lease-field-wide">Locataire<TenantSearchSelect tenants={tenants.data} value={tenantId} onChange={setTenantId} required /></label>
          </div>
        </div>

        <div className="detail-section">
          <h4>Informations du bail</h4>
          <div className="lease-section-grid">
            <label>Date debut<input name="start_date" type="date" required /></label>
            <label>Date fin<input name="end_date" type="date" /></label>
            <label>Duree<input name="duration" placeholder="12 mois" /></label>
            <label>Jour d'echeance<input name="due_day" type="number" min="1" max="31" defaultValue="10" /></label>
            <label>Loyer<input name="monthly_rent" type="number" required defaultValue={selectedUnit?.monthly_rent ?? 0} /></label>
            <label>Devise<select name="currency" defaultValue="USD"><option value="USD">USD</option><option value="CDF">CDF</option></select></label>
            <label>Statut<select name="status" defaultValue="DRAFT"><option value="DRAFT">Brouillon</option><option value="ACTIVE">Actif</option><option value="TERMINATED">Resilie</option></select></label>
          </div>
        </div>

        <div className="detail-section">
          <h4>Garantie locative</h4>
          <div className="lease-section-grid">
            <label>Montant<input name="rental_guarantee_amount" type="number" defaultValue="0" /></label>
            <label>Devise<select name="guarantee_currency" defaultValue="USD"><option value="USD">USD</option><option value="CDF">CDF</option></select></label>
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
