import { ArrowLeft, FileText, Plus, Printer, RefreshCw, Search } from 'lucide-react';
import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, money, paymentMethodLabel, shortDate } from '../api';
import { useAuth } from '../auth';
import { Modal, SuccessMessage } from '../components';
import { formatLeaseReference } from '../utils/lease-reference';

type TenantCredit = {
  id: number;
  tenant_id: number;
  lease_id?: number;
  source_payment_id: number;
  currency: 'USD' | 'CDF';
  original_amount: number;
  remaining_amount: number;
  status: string;
  payment_date: string;
  reference?: string;
  notes?: string;
  receipt_number?: string;
  payment_method?: string;
  tenant_name?: string;
  unit_number?: string;
  building_name?: string;
  lease_number?: number;
  amount_usd?: number;
  amount_cdf?: number;
  total_equivalent_usd?: number;
};

type FormDataPayload = {
  tenants: Array<{ id: number; name: string; tenant_number?: string }>;
  leases: Array<{ id: number; tenant_id: number; lease_number?: number; unit_number?: string; building_name?: string; status: string }>;
};

const today = () => new Date().toISOString().slice(0, 10);

export function TenantCredits() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { can } = useAuth();
  const [credits, setCredits] = useState<TenantCredit[]>([]);
  const [formData, setFormData] = useState<FormDataPayload>({ tenants: [], leases: [] });
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [filters, setFilters] = useState({ search: '', status: '', currency: '', lease_id: searchParams.get('lease_id') ?? '' });
  const [form, setForm] = useState({
    tenant_id: '',
    lease_id: '',
    payment_date: today(),
    currency: 'USD',
    amount: '',
    payment_method: 'CASH',
    exchange_rate_used: '',
    reference: '',
    notes: '',
  });

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [creditResponse, formResponse] = await Promise.all([
        api.get<TenantCredit[]>('/tenant-credits', { params: Object.fromEntries(Object.entries(filters).filter(([, value]) => value)) }),
        api.get<FormDataPayload>('/tenant-credits/form-data'),
      ]);
      setCredits(creditResponse.data);
      setFormData(formResponse.data);
    } catch (loadError: any) {
      setError(loadError?.response?.data?.message ?? 'Impossible de charger les crédits locataires.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filteredLeases = useMemo(
    () => formData.leases.filter((lease) => !form.tenant_id || Number(lease.tenant_id) === Number(form.tenant_id)),
    [form.tenant_id, formData.leases],
  );
  const totals = useMemo(() => ({
    usd: credits.filter((credit) => credit.currency === 'USD').reduce((sum, credit) => sum + Number(credit.remaining_amount ?? 0), 0),
    cdf: credits.filter((credit) => credit.currency === 'CDF').reduce((sum, credit) => sum + Number(credit.remaining_amount ?? 0), 0),
    count: credits.length,
  }), [credits]);
  const cdfEquivalent = useMemo(() => {
    const amount = Number(form.amount || 0);
    const rate = Number(form.exchange_rate_used || 0);
    if (form.currency !== 'CDF' || amount <= 0 || rate <= 0) return 0;
    return Number((amount / rate).toFixed(2));
  }, [form.amount, form.currency, form.exchange_rate_used]);

  const updateFilter = (key: keyof typeof filters, value: string) => setFilters((current) => ({ ...current, [key]: value }));
  const updateForm = (key: keyof typeof form, value: string) => {
    setForm((current) => ({
      ...current,
      [key]: value,
      ...(key === 'tenant_id' ? { lease_id: '' } : {}),
    }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await api.post('/tenant-credits', {
        tenant_id: Number(form.tenant_id),
        lease_id: form.lease_id ? Number(form.lease_id) : null,
        payment_date: form.payment_date,
        currency: form.currency,
        amount: Number(form.amount),
        payment_method: form.payment_method,
        exchange_rate_used: form.currency === 'CDF' ? Number(form.exchange_rate_used) : null,
        reference: form.reference || null,
        notes: form.notes || null,
        idempotency_key: `tenant-credit:${form.tenant_id}:${form.lease_id || 'none'}:${form.payment_date}:${form.currency}:${form.amount}:${form.reference || 'noref'}`,
      });
      setSuccess('Crédit locataire enregistré.');
      setModalOpen(false);
      setForm({ tenant_id: '', lease_id: '', payment_date: today(), currency: 'USD', amount: '', payment_method: 'CASH', exchange_rate_used: '', reference: '', notes: '' });
      await load();
    } catch (submitError: any) {
      setError(submitError?.response?.data?.message ?? 'Impossible d’enregistrer le crédit locataire.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section>
      <div className="page-header">
        <div>
          <button type="button" className="link-button" onClick={() => navigate('/payments')}><ArrowLeft size={15} />Retour paiements</button>
          <h2>Crédits locataires</h2>
          <p>Paiements anticipés disponibles, sans création de factures futures.</p>
        </div>
        <div className="actions">
          <button type="button" className="secondary" onClick={load}><RefreshCw size={16} />Actualiser</button>
          {can('payments.create') ? <button type="button" onClick={() => setModalOpen(true)}><Plus size={16} />Nouveau crédit locataire</button> : null}
        </div>
      </div>

      <SuccessMessage message={success} />
      {error && <div className="error">{error}</div>}

      <div className="summary-grid tenant-credit-kpis">
        <div className="summary-card"><span>Crédits disponibles</span><strong>{totals.count}</strong></div>
        <div className="summary-card"><span>Disponible USD</span><strong>{money(totals.usd)}</strong></div>
        <div className="summary-card"><span>Disponible CDF</span><strong>{totals.cdf.toLocaleString('fr-FR')} CDF</strong></div>
      </div>

      <div className="toolbar tenant-credit-toolbar">
        <label><Search size={15} /><input value={filters.search} onChange={(event) => updateFilter('search', event.target.value)} placeholder="Recherche" /></label>
        <select value={filters.status} onChange={(event) => updateFilter('status', event.target.value)}>
          <option value="">Tous les statuts</option>
          <option value="AVAILABLE">Disponible</option>
          <option value="PARTIALLY_USED">Partiellement utilisé</option>
          <option value="USED">Utilisé</option>
          <option value="CANCELLED">Annulé</option>
        </select>
        <select value={filters.currency} onChange={(event) => updateFilter('currency', event.target.value)}>
          <option value="">Toutes devises</option>
          <option value="USD">USD</option>
          <option value="CDF">CDF</option>
        </select>
        <button type="button" className="secondary" onClick={load}>Filtrer</button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Locataire</th>
              <th>Bail</th>
              <th>Reçu</th>
              <th>Mode</th>
              <th className="right">Montant initial</th>
              <th className="right">Disponible</th>
              <th>Statut</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {credits.map((credit) => (
              <tr key={credit.id}>
                <td>{shortDate(credit.payment_date)}</td>
                <td><strong>{credit.tenant_name ?? '-'}</strong><small>{credit.building_name ?? ''} {credit.unit_number ? `- ${credit.unit_number}` : ''}</small></td>
                <td>{credit.lease_id ? formatLeaseReference(credit.lease_number, credit.lease_id) : '-'}</td>
                <td>{credit.receipt_number ?? '-'}</td>
                <td>{paymentMethodLabel(credit.payment_method ?? '')}</td>
                <td className="right">{formatCreditAmount(credit.original_amount, credit.currency)}</td>
                <td className="right">{formatCreditAmount(credit.remaining_amount, credit.currency)}</td>
                <td><span className={`badge ${credit.status.toLowerCase()}`}>{creditStatusLabel(credit.status)}</span></td>
                <td>
                  <button type="button" className="icon-button" title="Ouvrir le reçu" onClick={() => navigate(`/payments/${credit.source_payment_id}`)}><Printer size={15} /></button>
                </td>
              </tr>
            ))}
            {!loading && credits.length === 0 && <tr><td colSpan={9} className="empty">Aucun crédit locataire.</td></tr>}
            {loading && <tr><td colSpan={9} className="empty">Chargement...</td></tr>}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <Modal title="Nouveau crédit locataire" onClose={() => setModalOpen(false)}>
          <form className="form-grid" onSubmit={submit}>
            <label>Locataire<select required value={form.tenant_id} onChange={(event) => updateForm('tenant_id', event.target.value)}>
              <option value="">Sélectionner</option>
              {formData.tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
            </select></label>
            <label>Bail actif<select value={form.lease_id} onChange={(event) => updateForm('lease_id', event.target.value)}>
              <option value="">Aucun bail lié</option>
              {filteredLeases.map((lease) => (
                <option key={lease.id} value={lease.id}>{formatLeaseReference(lease.lease_number, lease.id)} - {lease.building_name ?? '-'} / {lease.unit_number ?? '-'}</option>
              ))}
            </select></label>
            <label>Date<input type="date" required value={form.payment_date} onChange={(event) => updateForm('payment_date', event.target.value)} /></label>
            <label>Devise<select value={form.currency} onChange={(event) => updateForm('currency', event.target.value)}>
              <option value="USD">USD</option>
              <option value="CDF">CDF</option>
            </select></label>
            <label>Montant<input type="number" min="0.01" step="0.01" required value={form.amount} onChange={(event) => updateForm('amount', event.target.value)} /></label>
            <label>Mode de paiement<select value={form.payment_method} onChange={(event) => updateForm('payment_method', event.target.value)}>
              <option value="CASH">Espèces</option>
              <option value="BANK">Banque</option>
              <option value="MOBILE_MONEY">Mobile Money</option>
            </select></label>
            {form.currency === 'CDF' && (
              <>
                <label>Taux USD/CDF<input type="number" min="0.000001" step="0.000001" required value={form.exchange_rate_used} onChange={(event) => updateForm('exchange_rate_used', event.target.value)} /></label>
                <label>Équivalent USD<input readOnly value={money(cdfEquivalent)} /></label>
              </>
            )}
            <label>Référence<input value={form.reference} onChange={(event) => updateForm('reference', event.target.value)} /></label>
            <label className="full">Notes<textarea value={form.notes} onChange={(event) => updateForm('notes', event.target.value)} /></label>
            <div className="form-actions full">
              <button type="button" className="secondary" onClick={() => setModalOpen(false)}>Annuler</button>
              <button type="submit" disabled={submitting}><FileText size={16} />{submitting ? 'Enregistrement...' : 'Enregistrer le crédit'}</button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}

function formatCreditAmount(value: number, currency: 'USD' | 'CDF') {
  return currency === 'USD' ? money(value) : `${Number(value ?? 0).toLocaleString('fr-FR')} CDF`;
}

function creditStatusLabel(status: string) {
  return ({
    AVAILABLE: 'Disponible',
    PARTIALLY_USED: 'Partiellement utilisé',
    USED: 'Utilisé',
    CANCELLED: 'Annulé',
  } as Record<string, string>)[status] ?? status;
}
