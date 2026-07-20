import { ArrowLeft, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, money, statusLabel } from '../api';
import { PageHeader, SearchableSelect, SuccessMessage, TenantSearchSelect } from '../components';
import type { TenantSearchOption } from '../components';
import { useApiList } from '../hooks';
import { BILLING_FREQUENCY_OPTIONS } from '../utils/billing-frequency';

type Building = { id: number; name: string; city?: string; commune?: string; building_type?: string; address?: string };
type Unit = {
  id: number;
  building_id: number;
  building_name: string;
  number: string;
  monthly_rent: number;
  monthly_syndic_amount?: number;
  status: string;
  usage_type?: string;
};
type Tenant = {
  id: number;
  first_name?: string;
  last_name?: string;
  post_name?: string;
  company_name?: string;
  tenant_type?: string;
  phone?: string;
  building_name?: string;
  unit_number?: string;
};

type CompanySettingsDefaults = {
  default_lease_duration_months?: number;
  default_notice_months?: number;
  default_guarantee_months?: number;
  default_signature_place?: string;
  default_lease_usage?: string;
};

const LEASE_USAGE_OPTIONS = [
  { value: 'RESIDENTIAL', label: 'Residentiel' },
  { value: 'COMMERCIAL', label: 'Commercial' },
  { value: 'PROFESSIONAL', label: 'Professionnel' },
  { value: 'MIXED', label: 'Mixte' },
] as const;

export function LeaseNew() {
  const navigate = useNavigate();
  const location = useLocation();
  const buildings = useApiList<Building>('/buildings');
  const units = useApiList<Unit>('/units');
  const tenants = useApiList<Tenant>('/tenants');

  const [buildingId, setBuildingId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [tenantId, setTenantId] = useState<number | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [durationMonths, setDurationMonths] = useState('12');
  const [rent, setRent] = useState(0);
  const [maintenanceFee, setMaintenanceFee] = useState(0);
  const [syndicAmount, setSyndicAmount] = useState(0);
  const [otherCharges, setOtherCharges] = useState(0);
  const [guaranteeMonths, setGuaranteeMonths] = useState('3');
  const [noticeMonths, setNoticeMonths] = useState('1');
  const [billingFrequencyMonths, setBillingFrequencyMonths] = useState('1');
  const [signaturePlace, setSignaturePlace] = useState('Kinshasa');
  const [signatureDate, setSignatureDate] = useState(new Date().toISOString().slice(0, 10));
  const [leaseUsage, setLeaseUsage] = useState('RESIDENTIAL');
  const [leaseActivityDescription, setLeaseActivityDescription] = useState('');
  const [contractNote, setContractNote] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const availableUnits = useMemo(
    () => units.data.filter((unit) => !buildingId || Number(unit.building_id) === Number(buildingId)),
    [units.data, buildingId],
  );
  const selectedUnit = availableUnits.find((unit) => Number(unit.id) === Number(unitId));
  const selectedBuilding = buildings.data.find((building) => Number(building.id) === Number(buildingId));
  const rentAmount = Number(rent || 0) + Number(maintenanceFee || 0);
  const totalMonthly = rentAmount + Number(syndicAmount || 0) + Number(otherCharges || 0);
  const guaranteeAmount = rentAmount * Number(guaranteeMonths || 0);
  const contractTemplateCode = leaseTemplateCode(leaseUsage);
  const contractTemplateLabel = leaseTemplateLabel(leaseUsage);
  const activityLabel = leaseUsage === 'COMMERCIAL'
    ? 'Activite ou destination commerciale'
    : leaseUsage === 'PROFESSIONAL'
      ? 'Activite ou destination professionnelle'
      : 'Activite ou destination mixte';
  const activityPlaceholder = leaseUsage === 'COMMERCIAL'
    ? 'Ex: Boutique de vente, restaurant, depot'
    : leaseUsage === 'PROFESSIONAL'
      ? 'Ex: Cabinet de conseil, bureau administratif, agence'
      : 'Ex: Activites commerciales et professionnelles';
  const requiresActivity = leaseUsage === 'COMMERCIAL' || leaseUsage === 'PROFESSIONAL' || leaseUsage === 'MIXED';

  const buildingOptions = buildings.data.map((building) => ({
    value: building.id,
    label: building.name,
    meta: [building.city, building.commune, building.building_type].filter(Boolean).join(' - '),
  }));
  const unitOptions = availableUnits.map((unit) => ({
    value: unit.id,
    label: unit.number,
    meta: `${unit.building_name} - Loyer ${money(unit.monthly_rent)} - Syndic ${money(unit.monthly_syndic_amount ?? 0)} - ${statusLabel(unit.status)}`,
  }));
  const tenantOptions: TenantSearchOption[] = tenants.data.map((tenant) => ({
    id: tenant.id,
    tenant_type: tenant.tenant_type,
    company_name: tenant.company_name,
    first_name: tenant.first_name ?? '',
    last_name: tenant.last_name ?? '',
    post_name: tenant.post_name,
    phone: tenant.phone,
    building_name: tenant.building_name,
    unit_number: tenant.unit_number,
  }));

  useEffect(() => {
    let active = true;
    api.get<CompanySettingsDefaults>('/settings/company')
      .then((response) => {
        if (!active) return;
        const defaults = response.data;
        if (defaults.default_lease_duration_months) setDurationMonths(String(defaults.default_lease_duration_months));
        if (defaults.default_notice_months !== undefined) setNoticeMonths(String(defaults.default_notice_months));
        if (defaults.default_guarantee_months !== undefined) setGuaranteeMonths(String(defaults.default_guarantee_months));
        if (defaults.default_signature_place) setSignaturePlace(defaults.default_signature_place);
        if (defaults.default_lease_usage) setLeaseUsage(normalizeLeaseUsage(defaults.default_lease_usage));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (selectedUnit) {
      setRent(Number(selectedUnit.monthly_rent ?? 0));
      setSyndicAmount(Number(selectedUnit.monthly_syndic_amount ?? 0));
      return;
    }
    setRent(0);
    setSyndicAmount(0);
  }, [selectedUnit?.id]);

  useEffect(() => {
    if (selectedBuilding?.city && !signaturePlace) {
      setSignaturePlace(selectedBuilding.city);
    }
  }, [selectedBuilding?.city, signaturePlace]);

  useEffect(() => {
    if (leaseUsage !== 'COMMERCIAL' && leaseUsage !== 'PROFESSIONAL' && leaseUsage !== 'MIXED') {
      setLeaseActivityDescription('');
    }
  }, [leaseUsage]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tenantParam = params.get('tenantId');
    if (tenantParam) setTenantId(Number(tenantParam));
  }, [location.search]);

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
    const tenantValue = Number(form.get('tenant_id') ?? 0);
    const unitValue = Number(form.get('unit_id') ?? 0);
    const startValue = String(form.get('start_date') ?? '').trim();
    const activityDescriptionValue = requiresActivity ? leaseActivityDescription.trim() : '';

    if (!tenantValue) return setError('Selectionnez un locataire avant de creer le bail.');
    if (!unitValue) return setError('Selectionnez une unite avant de creer le bail.');
    if (!startValue) return setError('Selectionnez une date de debut.');
    if (requiresActivity && !activityDescriptionValue) {
      return setError('Renseignez l activite ou la destination des lieux.');
    }

    const payload = {
      tenant_id: tenantValue,
      unit_id: unitValue,
      start_date: startValue,
      end_date: form.get('end_date') || null,
      monthly_rent: rent,
      maintenance_fee_amount: maintenanceFee,
      monthly_syndic_amount: syndicAmount,
      other_charges_amount: otherCharges,
      lease_total_amount: totalMonthly,
      guarantee_months: Number(guaranteeMonths || 0),
      rental_guarantee_amount: guaranteeAmount,
      rental_guarantee_paid: 0,
      rental_guarantee_payment_date: null,
      rental_guarantee_status: 'NOT_PAID',
      notice_months: Number(noticeMonths || 0),
      billing_frequency_months: Number(billingFrequencyMonths || 1),
      signature_place: signaturePlace || null,
      signature_date: signatureDate || null,
      lease_usage: leaseUsage || null,
      lease_activity_description: activityDescriptionValue || null,
      contract_template_code: contractTemplateCode || null,
      status: form.get('status') || 'DRAFT',
      notes: form.get('notes') || null,
      contract_note: contractNote.trim() ? contractNote.trim() : null,
    };

    setSubmitting(true);
    setError('');
    try {
      const response = await api.post('/leases', payload);
      setMessage('Bail cree avec succes.');
      setTimeout(() => navigate(`/leases/${response.data.id}`), 350);
    } catch (err: any) {
      const responseMessage = err?.response?.data?.message;
      const details = Array.isArray(responseMessage) ? responseMessage.filter(Boolean).map(String).join(' | ') : responseMessage;
      setError(details || 'Impossible de creer le bail.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section>
      <PageHeader title="Nouveau bail" action={<button className="secondary" onClick={() => navigate('/leases')}><ArrowLeft size={16} />Retour</button>} />
      <SuccessMessage message={message} />
      {error && <div className="error-banner">{error}</div>}
      <form className="lease-form" onSubmit={(event) => { event.preventDefault(); void save(new FormData(event.currentTarget)); }}>
        <div className="detail-section report-section">
          <h4>Parties concernees</h4>
          <div className="lease-section-grid">
            <label className="lease-field-wide">Immeuble<SearchableSelect options={buildingOptions} value={buildingId ? Number(buildingId) : null} onChange={(value) => { setBuildingId(value ? String(value) : ''); setUnitId(''); }} placeholder="Rechercher un immeuble" emptyMessage="Aucun immeuble trouve" /></label>
            <label className="lease-field-wide">Unite / Appartement<SearchableSelect options={unitOptions} value={unitId ? Number(unitId) : null} onChange={(value) => setUnitId(value ? String(value) : '')} placeholder="Selectionner un appartement" emptyMessage="Aucune unite trouvee" /><input name="unit_id" value={unitId || ''} readOnly type="hidden" /></label>
            <label className="lease-field-wide">Locataire<TenantSearchSelect tenants={tenantOptions} value={tenantId} onChange={setTenantId} required /></label>
            <input name="tenant_id" value={tenantId ?? ''} readOnly type="hidden" />
          </div>
        </div>

        <div className="detail-section report-section">
          <h4>Informations du bail</h4>
          <div className="lease-section-grid">
            <label>Date debut<input name="start_date" type="date" value={startDate} onChange={(event) => updateStartDate(event.target.value)} required /></label>
            <label>Date fin<input name="end_date" type="date" value={endDate} onChange={(event) => updateEndDate(event.target.value)} /></label>
            <label>Duree du bail (mois)<input name="duration" type="number" min="1" value={durationMonths} onChange={(event) => updateDuration(event.target.value)} placeholder="12" /></label>
            <label>Preavis (mois)<input name="notice_months" type="number" min="0" value={noticeMonths} onChange={(event) => setNoticeMonths(event.target.value)} /></label>
            <label className="lease-field-wide">
              Periodicite de paiement du loyer
              <select name="billing_frequency_months" value={billingFrequencyMonths} onChange={(event) => setBillingFrequencyMonths(event.target.value)} required>
                {BILLING_FREQUENCY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <small>Determine le nombre de mois regroupes dans chaque cycle de facturation.</small>
            </label>
            <label>Loyer de base<input name="monthly_rent" type="number" required value={rent} onChange={(event) => setRent(Number(event.target.value))} /></label>
            <label>Frais d'entretien<input name="maintenance_fee_amount" type="number" min="0" value={maintenanceFee} onChange={(event) => setMaintenanceFee(Number(event.target.value))} /></label>
            <label>Frais syndic<input name="monthly_syndic_amount" type="number" min="0" value={syndicAmount} onChange={(event) => setSyndicAmount(Number(event.target.value))} /></label>
            <label>Autres charges<input name="other_charges_amount" type="number" min="0" value={otherCharges} onChange={(event) => setOtherCharges(Number(event.target.value))} /></label>
            <label>Loyer<input className="locked-field" value={money(rentAmount)} readOnly /></label>
            <label>Total mensuel<input className="locked-field" name="lease_total_amount" value={money(totalMonthly)} readOnly /></label>
            <label>Devise<input className="locked-field" value="USD" readOnly /></label>
            <label>Usage du bail<select name="lease_usage" value={leaseUsage} onChange={(event) => setLeaseUsage(normalizeLeaseUsage(event.target.value))}>{LEASE_USAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            {requiresActivity ? (
              <label className="lease-field-wide">{activityLabel}<input name="lease_activity_description" value={leaseActivityDescription} onChange={(event) => setLeaseActivityDescription(event.target.value)} placeholder={activityPlaceholder} required /></label>
            ) : null}
            <label>Statut<select name="status" defaultValue="DRAFT"><option value="DRAFT">Brouillon</option><option value="ACTIVE">Actif</option></select></label>
          </div>
        </div>

        <div className="detail-section report-section">
          <h4>Garantie locative</h4>
          <div className="lease-section-grid">
            <label>Garantie (nombre de mois)<input name="guarantee_months" type="number" min="0" value={guaranteeMonths} onChange={(event) => setGuaranteeMonths(event.target.value)} /></label>
            <label>Montant garantie<input className="locked-field" name="rental_guarantee_amount" value={money(guaranteeAmount)} readOnly /></label>
            <label>Statut garantie<input className="locked-field" value="Non payee" readOnly /></label>
            <label>Date de paiement<input className="locked-field" value="" placeholder="Renseignee apres paiement trace" readOnly /></label>
            <label>Devise<input className="locked-field" value="USD" readOnly /></label>
            <label className="lease-field-full">Garantie locative<input className="locked-field" value={money(guaranteeAmount)} readOnly /></label>
          </div>
        </div>

        <div className="detail-section report-section">
          <h4>Signature et contrat</h4>
          <div className="lease-section-grid">
            <label>Lieu signature<input name="signature_place" value={signaturePlace} onChange={(event) => setSignaturePlace(event.target.value)} /></label>
            <label>Date signature<input name="signature_date" type="date" value={signatureDate} onChange={(event) => setSignatureDate(event.target.value)} /></label>
            <label>Modele<input className="locked-field" name="contract_template_code" value={contractTemplateCode} readOnly /></label>
            <label className="lease-field-wide">Contrat prevu<input className="locked-field" value={contractTemplateLabel} readOnly /></label>
          </div>
        </div>

        <div className="detail-section report-section">
          <h4>Observations</h4>
          <div className="lease-section-grid">
            <label className="lease-field-full">Notes<textarea name="notes" rows={3} placeholder="Observations internes" /></label>
            <label className="lease-field-full">
              Note sur le contrat
              <textarea
                name="contract_note"
                rows={4}
                value={contractNote}
                onChange={(event) => setContractNote(event.target.value)}
                placeholder="Cette note apparaîtra dans le contrat imprimé sous la section « Observations »."
              />
            </label>
          </div>
        </div>

        <div className="actions">
          <button type="submit" disabled={submitting}><Save size={16} />{submitting ? 'Enregistrement...' : 'Enregistrer le bail'}</button>
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

function normalizeLeaseUsage(value?: string | null) {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (normalized === 'COMMERCIAL') return 'COMMERCIAL';
  if (normalized === 'PROFESSIONAL' || normalized === 'PROFESSIONNEL') return 'PROFESSIONAL';
  if (normalized === 'MIXED' || normalized === 'MIXTE') return 'MIXED';
  return 'RESIDENTIAL';
}

function leaseTemplateCode(value?: string | null) {
  switch (normalizeLeaseUsage(value)) {
    case 'COMMERCIAL':
      return 'LEASE_COMMERCIAL';
    case 'PROFESSIONAL':
      return 'LEASE_PROFESSIONAL';
    case 'MIXED':
      return 'LEASE_MIXED';
    case 'RESIDENTIAL':
    default:
      return 'LEASE_RESIDENTIAL';
  }
}

function leaseTemplateLabel(value?: string | null) {
  switch (normalizeLeaseUsage(value)) {
    case 'COMMERCIAL':
      return 'Contrat commercial';
    case 'PROFESSIONAL':
      return 'Contrat professionnel';
    case 'MIXED':
      return 'Contrat mixte';
    case 'RESIDENTIAL':
    default:
      return 'Contrat residentiel';
  }
}
