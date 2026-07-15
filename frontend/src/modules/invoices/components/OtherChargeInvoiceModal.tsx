import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../api';
import { Modal, SearchableSelect, TenantSearchSelect } from '../../../components';

type Tenant = {
  id: number;
  tenant_type?: string;
  company_name?: string;
  first_name: string;
  last_name: string;
  post_name?: string;
  building_name: string;
  unit_number: string;
};

type Lease = {
  id: number;
  tenant_id: number;
  building_name: string;
  unit_number: string;
  status: string;
};

type OtherChargeInvoiceModalProps = {
  open: boolean;
  onClose: () => void;
  tenants: Tenant[];
  leases: Lease[];
};

const chargeTypeOptions = [
  'Maintenance',
  'Entretien',
  'Reparation',
  'Penalite',
  'Frais administratifs',
  'Autre',
] as const;

export function OtherChargeInvoiceModal({
  open,
  onClose,
  tenants,
  leases,
}: OtherChargeInvoiceModalProps) {
  const navigate = useNavigate();
  const now = new Date();
  const [tenantId, setTenantId] = useState<number | null>(null);
  const [leaseId, setLeaseId] = useState<number | null>(null);
  const [issueDate, setIssueDate] = useState(now.toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState(now.toISOString().slice(0, 10));
  const [status, setStatus] = useState('UNPAID');
  const [currency, setCurrency] = useState('USD');
  const [chargeType, setChargeType] = useState<(typeof chargeTypeOptions)[number]>('Maintenance');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('0');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const selectedTenant = tenants.find((item) => item.id === tenantId) ?? null;
  const selectedLeaseId = leaseId ?? null;
  const tenantLeases = useMemo(
    () => leases.filter((lease) => Number(lease.tenant_id) === Number(tenantId) && lease.status === 'ACTIVE'),
    [leases, tenantId],
  );
  const leaseOptions = tenantLeases.map((lease) => ({
    value: lease.id,
    label: `${lease.building_name} - ${lease.unit_number}`,
    meta: `Appartement ${lease.unit_number}`,
  }));
  const total = Math.max(Number(amount || 0), 0);

  useEffect(() => {
    if (!open) return;
    setTenantId(null);
    setLeaseId(null);
    setIssueDate(now.toISOString().slice(0, 10));
    setDueDate(now.toISOString().slice(0, 10));
    setStatus('UNPAID');
    setCurrency('USD');
    setChargeType('Maintenance');
    setDescription('');
    setAmount('0');
    setNotes('');
    setSubmitting(false);
    setError('');
  }, [open]);

  if (!open) return null;

  async function save() {
    if (!selectedTenant) {
      setError('Selectionnez un locataire.');
      return;
    }
    if (!selectedLeaseId) {
      setError('Selectionnez un appartement actif.');
      return;
    }
    const parsedAmount = Number(amount || 0);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError('Le montant doit etre superieur a 0.');
      return;
    }

    const issue = new Date(`${issueDate}T00:00:00`);
    const month = issue.getMonth() + 1;
    const year = issue.getFullYear();

    setSubmitting(true);
    setError('');
    try {
      const response = await api.post('/invoices', {
        tenant_id: selectedTenant.id,
        lease_id: selectedLeaseId,
        invoice_type: 'OTHER_CHARGE',
        month,
        year,
        billing_month: month,
        billing_year: year,
        issue_date: issueDate,
        due_date: dueDate,
        status,
        public_notes: notes || null,
        internal_notes: null,
        attachment_file_name: null,
        attachment_file_url: null,
        items: [
          {
            item_type: chargeTypeToItemType(chargeType),
            description: description.trim() || chargeType,
            amount: parsedAmount,
          },
        ],
      });
      onClose();
      navigate(`/invoices/${response.data.id}`);
    } catch (nextError) {
      setError((nextError as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Impossible de creer la facture autres charges.');
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Nouvelle autres charges" onClose={onClose}>
      <div className="invoice-modal-body">
        <div className="form-grid invoice-form-grid">
          <label className="invoice-field-full">
            Locataire
            <TenantSearchSelect
              tenants={tenants}
              value={tenantId}
              onChange={(value) => {
                setTenantId(value);
                setLeaseId(null);
              }}
              required
            />
          </label>
          <label className="invoice-field-full">
            Appartement
            <SearchableSelect
              options={leaseOptions}
              value={selectedLeaseId}
              onChange={(value) => setLeaseId(value ? Number(value) : null)}
              placeholder="Rechercher un appartement actif"
              emptyMessage={tenantId ? 'Aucun appartement actif trouve' : 'Selectionnez d abord un locataire'}
            />
          </label>
          <div className="invoice-compact-grid invoice-field-full">
            <label>Date de facture<input type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} required /></label>
            <label>Date d'echeance<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} required /></label>
            <label>Devise
              <select value={currency} onChange={(event) => setCurrency(event.target.value)}>
                <option value="USD">USD</option>
              </select>
            </label>
            <label>Statut
              <select value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="UNPAID">Non payee</option>
                <option value="DRAFT">Brouillon</option>
              </select>
            </label>
          </div>
          <div className="invoice-compact-grid invoice-field-full">
            <label>Type de charge
              <select value={chargeType} onChange={(event) => setChargeType(event.target.value as (typeof chargeTypeOptions)[number])}>
                {chargeTypeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="invoice-field-span-2">Description<input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Description de la charge" /></label>
            <label>Montant<input type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required /></label>
          </div>
          <label className="invoice-field-full">Notes<textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Notes visibles sur la facture" /></label>
          <div className="total-row invoice-field-full">
            <span>Locataire {selectedTenant ? tenantLabel(selectedTenant) : '-'}</span>
            <strong>Total {total.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currency}</strong>
          </div>
          {error ? <div className="error-message invoice-field-full">{error}</div> : null}
        </div>
      </div>
      <div className="modal-sticky-actions">
        <button className="secondary" type="button" onClick={onClose}>Annuler</button>
        <button type="button" onClick={() => void save()} disabled={submitting}>
          {submitting ? 'Creation…' : 'Creer la facture'}
        </button>
      </div>
    </Modal>
  );
}

function tenantLabel(tenant: Tenant) {
  if (tenant.tenant_type === 'COMPANY') return tenant.company_name ?? 'Locataire';
  return `${tenant.first_name ?? ''} ${tenant.last_name ?? ''}`.trim();
}

function chargeTypeToItemType(chargeType: (typeof chargeTypeOptions)[number]) {
  return ({
    Maintenance: 'Maintenance',
    Entretien: 'Common charges',
    Reparation: 'Other',
    Penalite: 'Penalty',
    'Frais administratifs': 'Other',
    Autre: 'Other',
  } as Record<(typeof chargeTypeOptions)[number], string>)[chargeType];
}
