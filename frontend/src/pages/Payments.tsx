import { Plus } from 'lucide-react';
import { useState } from 'react';
import { api, exportCsv, includesText, money, paymentMethodLabel, shortDate } from '../api';
import { useAuth } from '../auth';
import { EmptyState, Modal, PageHeader, SuccessMessage, TableToolbar } from '../components';
import { useApiList } from '../hooks';

type Payment = { id: number; invoice_number: string; tenant_name: string; payment_date: string; amount: number; payment_method: string; reference?: string; receipt_number?: string };
type Invoice = { id: number; invoice_number: string; first_name: string; last_name: string; remaining_amount: number; status: string };

export function Payments() {
  const { can } = useAuth();
  const { data, reload } = useApiList<Payment>('/payments');
  const invoices = useApiList<Invoice>('/invoices');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState({ start: '', end: '', month: '', year: '', payment_method: '', tenant: '', invoice: '', min: '', max: '' });
  const [success, setSuccess] = useState('');
  const tenantOptions = Array.from(new Set(data.map((payment) => payment.tenant_name).filter(Boolean)));
  const filtered = data.filter((payment) =>
    includesText({ ...payment, payment_method_label: paymentMethodLabel(payment.payment_method) }, query)
      && (!filters.start || payment.payment_date.slice(0, 10) >= filters.start)
      && (!filters.end || payment.payment_date.slice(0, 10) <= filters.end)
      && (!filters.month || new Date(payment.payment_date).getMonth() + 1 === Number(filters.month))
      && (!filters.year || new Date(payment.payment_date).getFullYear() === Number(filters.year))
      && (!filters.payment_method || payment.payment_method === filters.payment_method)
      && (!filters.tenant || payment.tenant_name === filters.tenant)
      && (!filters.invoice || payment.invoice_number?.toLowerCase().includes(filters.invoice.toLowerCase()))
      && (!filters.min || Number(payment.amount) >= Number(filters.min))
      && (!filters.max || Number(payment.amount) <= Number(filters.max)),
  );

  async function save(form: FormData) {
    await api.post('/payments', {
      invoice_id: Number(form.get('invoice_id')),
      payment_date: form.get('payment_date'),
      amount: Number(form.get('amount')),
      payment_method: form.get('payment_method'),
      reference: form.get('reference'),
      notes: form.get('notes'),
    });
    setSuccess('Paiement enregistré avec succès.');
    setOpen(false);
    reload();
    invoices.reload();
  }

  return (
    <section>
      <PageHeader title="Paiements" action={can('payments.create') ? <button onClick={() => setOpen(true)}><Plus size={16} />Nouveau paiement</button> : undefined} />
      <SuccessMessage message={success} />
      <TableToolbar
        query={query}
        onQueryChange={setQuery}
        onExport={() => exportCsv('paiements.csv', filtered.map((payment) => ({
          facture: payment.invoice_number,
          locataire: payment.tenant_name,
          date: payment.payment_date,
          montant: payment.amount,
          mode: paymentMethodLabel(payment.payment_method),
          reference: payment.reference ?? '',
          recu: payment.receipt_number ?? '',
        })))}
      />
      <div className="quick-form">
        <input type="date" value={filters.start} onChange={(event) => setFilters({ ...filters, start: event.target.value })} />
        <input type="date" value={filters.end} onChange={(event) => setFilters({ ...filters, end: event.target.value })} />
        <input type="number" min="1" max="12" placeholder="Mois" value={filters.month} onChange={(event) => setFilters({ ...filters, month: event.target.value })} />
        <input type="number" placeholder="Annee" value={filters.year} onChange={(event) => setFilters({ ...filters, year: event.target.value })} />
        <select value={filters.payment_method} onChange={(event) => setFilters({ ...filters, payment_method: event.target.value })}><option value="">Tous modes</option><option value="CASH">Especes</option><option value="BANK">Banque</option><option value="MOBILE_MONEY">Mobile Money</option></select>
        <select value={filters.tenant} onChange={(event) => setFilters({ ...filters, tenant: event.target.value })}><option value="">Tous les locataires</option>{tenantOptions.map((tenant) => <option key={tenant} value={tenant}>{tenant}</option>)}</select>
        <input placeholder="Facture" value={filters.invoice} onChange={(event) => setFilters({ ...filters, invoice: event.target.value })} />
        <input type="number" placeholder="Montant min." value={filters.min} onChange={(event) => setFilters({ ...filters, min: event.target.value })} />
        <input type="number" placeholder="Montant max." value={filters.max} onChange={(event) => setFilters({ ...filters, max: event.target.value })} />
        <button type="button" className="secondary" onClick={() => setFilters({ start: '', end: '', month: '', year: '', payment_method: '', tenant: '', invoice: '', min: '', max: '' })}>Reinitialiser filtres</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Facture</th><th>Locataire</th><th>Date</th><th className="right">Montant</th><th>Devise</th><th>Mode</th><th>Reçu</th><th>Référence</th></tr></thead>
          <tbody>{filtered.map((payment) => <tr key={payment.id}><td>{payment.invoice_number}</td><td>{payment.tenant_name}</td><td>{shortDate(payment.payment_date)}</td><td className="right">{amount(payment.amount)}</td><td>USD</td><td>{paymentMethodLabel(payment.payment_method)}</td><td>{payment.receipt_number ?? '-'}</td><td>{payment.reference}</td></tr>)}</tbody>
        </table>
        {!data.length && <EmptyState />}
      </div>
      {open && (
        <Modal title="Nouveau paiement" onClose={() => setOpen(false)}>
          <form
            className="form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              save(new FormData(event.currentTarget));
            }}
          >
            <select name="invoice_id" required>{invoices.data.filter((i) => i.status !== 'PAID').map((i) => <option key={i.id} value={i.id}>{i.invoice_number} - {i.first_name} {i.last_name} ({money(i.remaining_amount)})</option>)}</select>
            <input name="payment_date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
            <input name="amount" type="number" step="0.01" required />
            <select name="payment_method"><option value="CASH">Espèces</option><option value="BANK">Banque</option><option value="MOBILE_MONEY">Mobile Money</option></select>
            <input name="reference" placeholder="Référence" />
            <textarea name="notes" placeholder="Notes" />
            <button>Enregistrer le paiement</button>
          </form>
        </Modal>
      )}
    </section>
  );
}

function amount(value: unknown) {
  return Number(value ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}
