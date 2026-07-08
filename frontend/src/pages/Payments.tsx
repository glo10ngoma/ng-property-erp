import { ChevronRight, FileSpreadsheet, Filter, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, exportXlsxWorkbook, includesText, money, paymentMethodLabel, shortDate } from '../api';
import { useAuth } from '../auth';
import { EmptyState, Modal, PageHeader, SuccessMessage } from '../components';
import { useApiList } from '../hooks';

type Payment = {
  id: number;
  invoice_id?: number;
  invoice_number: string;
  invoice_status?: string;
  tenant_id?: number;
  tenant_name: string;
  tenant_phone?: string;
  tenant_email?: string;
  unit_number?: string;
  building_name?: string;
  payment_date: string;
  amount: number;
  payment_method: string;
  reference?: string;
  notes?: string;
  receipt_number?: string;
  payer_name?: string;
  status?: string;
};

type Invoice = {
  id: number;
  invoice_number: string;
  tenant_id: number;
  tenant_name: string;
  remaining_amount: number;
  total: number;
  status: string;
  unit_number?: string;
  building_name?: string;
  lease_id?: number;
  tenant_phone?: string;
  tenant_email?: string;
  paid_amount?: number;
};

const paymentMethods = [
  ['CASH', 'Espèces'],
  ['BANK', 'Banque'],
  ['MOBILE_MONEY', 'Mobile Money'],
];

export function Payments() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { data, reload } = useApiList<Payment>('/payments');
  const invoices = useApiList<Invoice>('/invoices');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState({
    month: '',
    year: '',
    payment_method: '',
    tenant: '',
    status: '',
    invoice: '',
    start: '',
    end: '',
    min: '',
    max: '',
    receipt: '',
    reference: '',
  });
  const [success, setSuccess] = useState('');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(null);

  const invoiceOptions = useMemo(
    () => invoices.data.filter((invoice) => invoice.status !== 'PAID'),
    [invoices.data],
  );

  const selectedInvoice = useMemo(
    () => invoiceOptions.find((invoice) => invoice.id === selectedInvoiceId) ?? null,
    [invoiceOptions, selectedInvoiceId],
  );

  const filtered = data.filter((payment) => {
    const date = payment.payment_date.slice(0, 10);
    return (
      includesText(
        {
          ...payment,
          payment_method_label: paymentMethodLabel(payment.payment_method),
          invoice_status_label: payment.status ?? payment.invoice_status ?? '',
        },
        query,
      )
      && (!filters.month || new Date(payment.payment_date).getMonth() + 1 === Number(filters.month))
      && (!filters.year || new Date(payment.payment_date).getFullYear() === Number(filters.year))
      && (!filters.payment_method || payment.payment_method === filters.payment_method)
      && (!filters.tenant || payment.tenant_name === filters.tenant)
      && (!filters.status || (payment.status ?? payment.invoice_status ?? '') === filters.status)
      && (!filters.invoice || payment.invoice_number?.toLowerCase().includes(filters.invoice.toLowerCase()))
      && (!filters.start || date >= filters.start)
      && (!filters.end || date <= filters.end)
      && (!filters.min || Number(payment.amount) >= Number(filters.min))
      && (!filters.max || Number(payment.amount) <= Number(filters.max))
      && (!filters.receipt || String(payment.receipt_number ?? '').toLowerCase().includes(filters.receipt.toLowerCase()))
      && (!filters.reference || String(payment.reference ?? '').toLowerCase().includes(filters.reference.toLowerCase()))
    );
  });

  const totals = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const month = new Date().getMonth() + 1;
    const year = new Date().getFullYear();
    return {
      total: data.length,
      today: data.filter((payment) => payment.payment_date.slice(0, 10) === today).length,
      month: data.filter((payment) => new Date(payment.payment_date).getMonth() + 1 === month && new Date(payment.payment_date).getFullYear() === year).length,
      cash: data.filter((payment) => payment.payment_method === 'CASH').length,
      bank: data.filter((payment) => payment.payment_method === 'BANK').length,
      mobile: data.filter((payment) => payment.payment_method === 'MOBILE_MONEY').length,
      partial: data.filter((payment) => payment.status === 'PARTIAL' || payment.invoice_status === 'PARTIAL').length,
      collected: data.reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0),
    };
  }, [data]);

  async function save(form: FormData) {
    const payload = {
      invoice_id: Number(form.get('invoice_id')),
      payment_date: form.get('payment_date'),
      amount: Number(form.get('amount')),
      payment_method: form.get('payment_method'),
      reference: form.get('reference'),
      notes: form.get('notes'),
      payer_name: form.get('payer_name'),
    };
    await api.post('/payments', payload);
    setSuccess('Paiement enregistre avec succes.');
    setOpen(false);
    setSelectedInvoiceId(null);
    reload();
    invoices.reload();
  }

  function exportRows() {
    return filtered.map((payment) => ({
      reference_paiement: payment.receipt_number ?? `PAY-${payment.id}`,
      facture: payment.invoice_number,
      locataire: payment.tenant_name,
      appartement: payment.unit_number ?? '-',
      immeuble: payment.building_name ?? '-',
      date: shortDate(payment.payment_date),
      montant: money(payment.amount),
      devise: 'USD',
      mode: paymentMethodLabel(payment.payment_method),
      reference_externe: payment.reference ?? '-',
      utilisateur: payment.payer_name ?? '-',
      statut: payment.status ?? payment.invoice_status ?? '-',
    }));
  }

  const quickStats = [
    ['Total paiements', totals.total],
    ['Paiements aujourd\'hui', totals.today],
    ['Ce mois', totals.month],
    ['Espèces', totals.cash],
    ['Banque', totals.bank],
    ['Mobile Money', totals.mobile],
    ['Paiements partiels', totals.partial],
    ['Total encaissé', money(totals.collected)],
  ] as const;

  return (
    <section>
      <PageHeader title="Paiements" action={can('payments.create') ? <button onClick={() => setOpen(true)}><Plus size={16} />Nouveau paiement</button> : undefined} />
      <SuccessMessage message={success} />

      <div className="summary-band">
        {quickStats.map(([label, value]) => (
          <div key={label} className="summary-item">
            <span>{label}</span>
            <strong>{String(value)}</strong>
          </div>
        ))}
      </div>

      <div className="table-toolbar">
        <div className="toolbar-main">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher" />
        </div>
        <div className="toolbar-actions">
          <button type="button" className="secondary" onClick={() => setFilters({ month: '', year: '', payment_method: '', tenant: '', status: '', invoice: '', start: '', end: '', min: '', max: '', receipt: '', reference: '' })}>Réinitialiser</button>
          <button type="button" className="secondary" onClick={() => exportXlsxWorkbook('Paiements.xlsx', [{ name: 'Paiements', rows: exportRows() }])}><FileSpreadsheet size={16} />Exporter</button>
        </div>
      </div>

      <details className="detail-section" open>
        <summary><Filter size={16} />Filtres avancés</summary>
        <div className="quick-form compact-grid">
          <input type="number" min="1" max="12" placeholder="Mois" value={filters.month} onChange={(event) => setFilters({ ...filters, month: event.target.value })} />
          <input type="number" min="2000" max="2100" placeholder="Année" value={filters.year} onChange={(event) => setFilters({ ...filters, year: event.target.value })} />
          <select value={filters.payment_method} onChange={(event) => setFilters({ ...filters, payment_method: event.target.value })}>
            <option value="">Mode de paiement</option>
            {paymentMethods.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select value={filters.tenant} onChange={(event) => setFilters({ ...filters, tenant: event.target.value })}>
            <option value="">Locataire</option>
            {Array.from(new Set(invoices.data.map((invoice) => invoice.tenant_name).filter(Boolean))).map((tenant) => (
              <option key={tenant} value={tenant}>{tenant}</option>
            ))}
          </select>
          <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
            <option value="">Statut</option>
            <option value="PAID">Payée</option>
            <option value="PARTIAL">Paiement partiel</option>
            <option value="UNPAID">Non payée</option>
          </select>
          <input placeholder="Facture" value={filters.invoice} onChange={(event) => setFilters({ ...filters, invoice: event.target.value })} />
        <button type="button" className="secondary" onClick={() => setFilters({ ...filters, month: '', year: '', payment_method: '', tenant: '', status: '', invoice: '', start: '', end: '', min: '', max: '', receipt: '', reference: '' })}>Réinitialiser</button>
        </div>
        <div className="quick-form compact-grid advanced-grid">
          <input type="date" value={filters.start} onChange={(event) => setFilters({ ...filters, start: event.target.value })} />
          <input type="date" value={filters.end} onChange={(event) => setFilters({ ...filters, end: event.target.value })} />
          <input type="number" placeholder="Montant min." value={filters.min} onChange={(event) => setFilters({ ...filters, min: event.target.value })} />
          <input type="number" placeholder="Montant max." value={filters.max} onChange={(event) => setFilters({ ...filters, max: event.target.value })} />
          <input placeholder="Reçu" value={filters.receipt} onChange={(event) => setFilters({ ...filters, receipt: event.target.value })} />
          <input placeholder="Référence" value={filters.reference} onChange={(event) => setFilters({ ...filters, reference: event.target.value })} />
        </div>
      </details>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Référence paiement</th>
              <th>Facture</th>
              <th>Locataire</th>
              <th>Appartement</th>
              <th>Immeuble</th>
              <th>Date</th>
              <th className="right">Montant</th>
              <th>Devise</th>
              <th>Mode</th>
              <th>Référence externe</th>
              <th>Utilisateur</th>
              <th>Statut</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((payment) => {
              const status = payment.status ?? payment.invoice_status ?? 'PAID';
              return (
                <tr key={payment.id} className="clickable-row" onClick={() => navigate(`/payments/${payment.id}`)}>
                  <td>{payment.receipt_number ?? `PAY-${payment.id}`}</td>
                  <td>{payment.invoice_number}</td>
                  <td>{payment.tenant_name}</td>
                  <td>{payment.unit_number ?? '-'}</td>
                  <td>{payment.building_name ?? '-'}</td>
                  <td>{shortDate(payment.payment_date)}</td>
                  <td className="right">{money(payment.amount)}</td>
                  <td>USD</td>
                  <td>{paymentMethodLabel(payment.payment_method)}</td>
                  <td>{payment.reference ?? '-'}</td>
                  <td>{payment.payer_name ?? '-'}</td>
                  <td><span className={`badge ${String(status).toLowerCase()}`}>{statusLabel(status)}</span></td>
                  <td>
                    <div className="row-actions">
                      <button type="button" className="icon-btn" title="Voir" onClick={(event) => { event.stopPropagation(); navigate(`/payments/${payment.id}`); }}><ChevronRight size={16} /></button>
                      {can('payments.update') && <button type="button" className="icon-btn" title="Modifier" onClick={(event) => { event.stopPropagation(); navigate(`/payments/${payment.id}?edit=1`); }}><Pencil size={16} /></button>}
                      {can('payments.delete') && <button type="button" className="icon-btn danger" title="Supprimer" onClick={(event) => { event.stopPropagation(); cancelPayment(payment.id); }}><Trash2 size={16} /></button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!data.length && <EmptyState />}
      </div>

      {open && (
        <PaymentModal
          invoices={invoiceOptions}
          selectedInvoice={selectedInvoice}
          selectedInvoiceId={selectedInvoiceId}
          onSelectInvoice={setSelectedInvoiceId}
          onClose={() => setOpen(false)}
          onSubmit={save}
        />
      )}
    </section>
  );

  async function cancelPayment(paymentId: number) {
    if (!window.confirm('Annuler ce paiement ?')) return;
    await api.delete(`/payments/${paymentId}`);
    reload();
    invoices.reload();
  }
}

function PaymentModal({
  invoices,
  selectedInvoice,
  selectedInvoiceId,
  onSelectInvoice,
  onClose,
  onSubmit,
}: {
  invoices: Invoice[];
  selectedInvoice: Invoice | null;
  selectedInvoiceId: number | null;
  onSelectInvoice: (value: number | null) => void;
  onClose: () => void;
  onSubmit: (form: FormData) => Promise<void>;
}) {
  const remaining = Number(selectedInvoice?.remaining_amount ?? 0);
  return (
    <Modal title="Nouveau paiement" onClose={onClose}>
      <form
        className="form-grid payment-modal"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(new FormData(event.currentTarget));
        }}
      >
        <div className="detail-section compact-modal-section">
          <summary>Informations paiement</summary>
          <div className="lease-section-grid">
            <label>
              Facture
              <select
                name="invoice_id"
                required
                value={selectedInvoiceId ?? ''}
                onChange={(event) => onSelectInvoice(event.target.value ? Number(event.target.value) : null)}
              >
                <option value="">Choisir une facture</option>
                {invoices.map((invoice) => (
                  <option key={invoice.id} value={invoice.id}>
                    {invoice.invoice_number} - {invoice.tenant_name} ({money(invoice.remaining_amount)})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Locataire
              <input value={selectedInvoice?.tenant_name ?? ''} readOnly className="locked-field" />
            </label>
            <label>
              Bail
              <input value={selectedInvoice?.lease_id ? `B-${selectedInvoice.lease_id}` : '-'} readOnly className="locked-field" />
            </label>
            <label>
              Appartement
              <input value={selectedInvoice?.unit_number ?? '-'} readOnly className="locked-field" />
            </label>
          </div>
          {selectedInvoice && (
            <div className="payment-summary-strip">
              <span>Facture : <strong>{selectedInvoice.invoice_number}</strong></span>
              <span>Montant facture : <strong>{money(selectedInvoice.total)}</strong></span>
              <span>Déjà payé : <strong>{money(selectedInvoice.paid_amount ?? Math.max(0, Number(selectedInvoice.total) - Number(selectedInvoice.remaining_amount)))}</strong></span>
              <span>Reste à payer : <strong>{money(remaining)}</strong></span>
            </div>
          )}
        </div>

        <div className="detail-section compact-modal-section">
          <summary>Paiement</summary>
          <div className="lease-section-grid">
            <label>Date<input name="payment_date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
            <label>Montant<input name="amount" type="number" step="0.01" required defaultValue={remaining || undefined} /></label>
            <label>Devise<input value="USD" readOnly className="locked-field" /></label>
            <label>Mode de paiement
              <select name="payment_method">
                <option value="CASH">Espèces</option>
                <option value="BANK">Banque</option>
                <option value="MOBILE_MONEY">Mobile Money</option>
              </select>
            </label>
            <label>Référence<input name="reference" placeholder="Référence" /></label>
          </div>
        </div>

        <div className="detail-section compact-modal-section">
          <summary>Informations complémentaires</summary>
          <div className="lease-section-grid">
            <label>Banque<input name="payer_name" placeholder="Banque / payeur" /></label>
            <label>Numéro transaction<input name="transaction_number" placeholder="Numéro transaction" /></label>
            <label>Chèque<input name="check_number" placeholder="Chèque" /></label>
            <label>Observations<textarea name="notes" rows={2} placeholder="Observations" /></label>
          </div>
        </div>

        <button type="submit">Enregistrer</button>
      </form>
    </Modal>
  );
}

function statusLabel(value: string) {
  return ({ PAID: 'Payee', PARTIAL: 'Paiement partiel', UNPAID: 'Non payee', OVERDUE: 'En retard', DRAFT: 'Brouillon', CANCELLED: 'Annulee' } as Record<string, string>)[value] ?? value;
}
