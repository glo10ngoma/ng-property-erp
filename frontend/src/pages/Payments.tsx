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
  const [success, setSuccess] = useState('');
  const filtered = data.filter((payment) =>
    includesText({ ...payment, payment_method_label: paymentMethodLabel(payment.payment_method) }, query),
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
      <div className="table-wrap">
        <table>
          <thead><tr><th>Facture</th><th>Locataire</th><th>Date</th><th>Montant</th><th>Mode</th><th>Reçu</th><th>Référence</th></tr></thead>
          <tbody>{filtered.map((payment) => <tr key={payment.id}><td>{payment.invoice_number}</td><td>{payment.tenant_name}</td><td>{shortDate(payment.payment_date)}</td><td className="right">{money(payment.amount)}</td><td>{paymentMethodLabel(payment.payment_method)}</td><td>{payment.receipt_number ?? '-'}</td><td>{payment.reference}</td></tr>)}</tbody>
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
