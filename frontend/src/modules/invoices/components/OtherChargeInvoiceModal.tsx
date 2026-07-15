import { Plus, Trash2 } from 'lucide-react';
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

type ChargeTypeCode = 'MAINTENANCE' | 'MAINTENANCE_SERVICE' | 'REPAIR' | 'PENALTY' | 'ADMIN_FEE' | 'OTHER';

type OtherChargeLine = {
  id: string;
  chargeType: ChargeTypeCode | '';
  description: string;
  quantity: string;
  unitPrice: string;
};

const chargeTypeOptions: Array<{ value: ChargeTypeCode; label: string }> = [
  { value: 'MAINTENANCE', label: 'Maintenance' },
  { value: 'MAINTENANCE_SERVICE', label: 'Entretien' },
  { value: 'REPAIR', label: 'Reparation' },
  { value: 'PENALTY', label: 'Penalite' },
  { value: 'ADMIN_FEE', label: 'Frais administratifs' },
  { value: 'OTHER', label: 'Autre' },
];

export function OtherChargeInvoiceModal({
  open,
  onClose,
  tenants,
  leases,
}: OtherChargeInvoiceModalProps) {
  const navigate = useNavigate();
  const [tenantId, setTenantId] = useState<number | null>(null);
  const [leaseId, setLeaseId] = useState<number | null>(null);
  const [issueDate, setIssueDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [status, setStatus] = useState('UNPAID');
  const [currency, setCurrency] = useState('USD');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<OtherChargeLine[]>([createEmptyLine()]);
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
  const lineTotals = lines.map((line) => normalizePositive(line.quantity) * normalizePositive(line.unitPrice));
  const subtotal = lineTotals.reduce((sum, value) => sum + value, 0);
  const total = subtotal;

  useEffect(() => {
    if (!open) return;
    const today = new Date().toISOString().slice(0, 10);
    setTenantId(null);
    setLeaseId(null);
    setIssueDate(today);
    setDueDate(today);
    setStatus('UNPAID');
    setCurrency('USD');
    setNotes('');
    setLines([createEmptyLine()]);
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

    const normalizedLines = lines.map((line) => ({
      chargeType: line.chargeType,
      description: line.description.trim(),
      quantity: normalizePositive(line.quantity),
      unitPrice: normalizePositive(line.unitPrice),
    }));

    if (normalizedLines.some((line) => !line.chargeType)) {
      setError('Chaque ligne doit avoir un type de charge.');
      return;
    }
    if (normalizedLines.some((line) => !line.description)) {
      setError('Chaque ligne doit avoir une description.');
      return;
    }
    if (normalizedLines.some((line) => line.quantity <= 0)) {
      setError('Chaque ligne doit avoir une quantite strictement superieure a 0.');
      return;
    }
    if (normalizedLines.some((line) => line.unitPrice < 0)) {
      setError('Le prix unitaire doit etre superieur ou egal a 0.');
      return;
    }
    if (normalizedLines.every((line) => line.quantity * line.unitPrice <= 0)) {
      setError('La facture doit contenir au moins une ligne avec un montant superieur a 0.');
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
        public_notes: notes.trim() || null,
        internal_notes: null,
        attachment_file_name: null,
        attachment_file_url: null,
        items: normalizedLines.map((line) => ({
          item_type: chargeTypeToItemType(line.chargeType as ChargeTypeCode),
          charge_type: line.chargeType as ChargeTypeCode,
          description: line.description,
          quantity: line.quantity,
          unit_price: line.unitPrice,
          amount: Number((line.quantity * line.unitPrice).toFixed(2)),
        })),
      });
      onClose();
      navigate(`/invoices/${response.data.id}`);
    } catch (nextError) {
      setError((nextError as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Impossible de creer la facture autres charges.');
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Nouvelle facture autres charges" onClose={onClose}>
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

          <div className="invoice-field-full invoice-charge-lines">
            <div className="invoice-charge-lines-head">
              <strong>Lignes de charges</strong>
              <button
                type="button"
                className="secondary"
                onClick={() => setLines((current) => [...current, createEmptyLine()])}
              >
                <Plus size={16} />Ajouter une ligne
              </button>
            </div>
            <div className="invoice-charge-lines-table">
              <table>
                <thead>
                  <tr>
                    <th>Type de charge</th>
                    <th>Description</th>
                    <th className="right">Quantite</th>
                    <th className="right">Prix unitaire</th>
                    <th className="right">Total</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => (
                    <tr key={line.id}>
                      <td>
                        <select
                          aria-label={`Type de charge ligne ${index + 1}`}
                          value={line.chargeType}
                          onChange={(event) => updateLine(line.id, 'chargeType', event.target.value)}
                        >
                          <option value="">Selectionner</option>
                          {chargeTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      </td>
                      <td>
                        <input
                          aria-label={`Description ligne ${index + 1}`}
                          value={line.description}
                          onChange={(event) => updateLine(line.id, 'description', event.target.value)}
                          placeholder="Description de la charge"
                        />
                      </td>
                      <td className="right">
                        <input
                          aria-label={`Quantite ligne ${index + 1}`}
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={line.quantity}
                          onChange={(event) => updateLine(line.id, 'quantity', event.target.value)}
                        />
                      </td>
                      <td className="right">
                        <input
                          aria-label={`Prix unitaire ligne ${index + 1}`}
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.unitPrice}
                          onChange={(event) => updateLine(line.id, 'unitPrice', event.target.value)}
                        />
                      </td>
                      <td className="right invoice-charge-line-total">
                        {formatMoney(lineTotals[index], currency)}
                      </td>
                      <td className="actions actions-compact">
                        <button
                          type="button"
                          className="icon-btn danger"
                          aria-label={`Supprimer la ligne ${index + 1}`}
                          title="Supprimer la ligne"
                          onClick={() => removeLine(line.id)}
                          disabled={lines.length === 1}
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <label className="invoice-field-full">Notes<textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Notes visibles sur la facture" /></label>

          <div className="total-row invoice-field-full">
            <span>Sous-total {formatMoney(subtotal, currency)}</span>
            <strong>Total general {formatMoney(total, currency)}</strong>
          </div>
          {error ? <div className="error-message invoice-field-full">{error}</div> : null}
        </div>
      </div>
      <div className="modal-sticky-actions">
        <button className="secondary" type="button" onClick={onClose}>Annuler</button>
        <button
          type="button"
          aria-label="Nouvelle facture autres charges"
          onClick={() => void save()}
          disabled={submitting}
        >
          {submitting ? 'Creation…' : 'Creer la facture'}
        </button>
      </div>
    </Modal>
  );

  function updateLine(lineId: string, field: keyof OtherChargeLine, value: string) {
    setLines((current) => current.map((line) => (line.id === lineId ? { ...line, [field]: value } : line)));
  }

  function removeLine(lineId: string) {
    setLines((current) => {
      if (current.length <= 1) return [createEmptyLine()];
      return current.filter((line) => line.id !== lineId);
    });
  }
}

function createEmptyLine(): OtherChargeLine {
  return {
    id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    chargeType: '',
    description: '',
    quantity: '1',
    unitPrice: '0',
  };
}

function normalizePositive(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value: number, currency: string) {
  return `${value.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function chargeTypeToItemType(chargeType: ChargeTypeCode) {
  return ({
    MAINTENANCE: 'Maintenance',
    MAINTENANCE_SERVICE: 'Common charges',
    REPAIR: 'Other',
    PENALTY: 'Penalty',
    ADMIN_FEE: 'Other',
    OTHER: 'Other',
  } as Record<ChargeTypeCode, string>)[chargeType];
}
