import { CreditCard, Pencil, Printer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, invoiceDisplayStatus, itemLabel, money, paymentMethodLabel, shortDate } from '../api';
import { useAuth } from '../auth';
import { Modal, StatusBadge, SuccessMessage } from '../components';

type Invoice = {
  id: number; invoice_number: string; issue_date: string; due_date: string; month: number; year: number; total: number; status: string;
  first_name: string; last_name: string; phone: string; email: string; building_name: string; building_address: string; building_city: string; unit_number: string; paid_amount: number; remaining_amount: number;
  items: { id: number; description: string; amount: number }[];
  payments: { id: number; payment_date: string; amount: number; payment_method: string; receipt_number?: string; reference?: string }[];
};

export function InvoiceDetail() {
  const { can } = useAuth();
  const { id } = useParams();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [success, setSuccess] = useState('');

  const reload = () => api.get<Invoice>(`/invoices/${id}`).then((response) => setInvoice(response.data));
  useEffect(() => {
    reload();
  }, [id]);

  async function pay(form: FormData) {
    await api.post('/payments', {
      invoice_id: Number(id),
      payment_date: form.get('payment_date'),
      amount: Number(form.get('amount')),
      payment_method: form.get('payment_method'),
      reference: form.get('reference'),
      notes: form.get('notes'),
    });
    setSuccess('Paiement enregistré avec succès.');
    setPaymentOpen(false);
    reload();
  }

  async function saveEdit(form: FormData) {
    const descriptions = form.getAll('description').map(String);
    const amounts = form.getAll('amount').map(Number);
    await api.put(`/invoices/${id}`, {
      issue_date: form.get('issue_date'),
      due_date: form.get('due_date'),
      items: descriptions.map((description, index) => ({
        description,
        amount: amounts[index],
      })),
    });
    setSuccess('Facture modifiée avec succès.');
    setEditOpen(false);
    reload();
  }

  if (!invoice) return <div className="empty">Chargement de la facture...</div>;

  return (
    <section>
      <div className="page-header no-print">
        <h2>{invoice.invoice_number}</h2>
        <div className="actions">
          {can('invoices.update') && <button onClick={() => setEditOpen(true)}><Pencil size={16} />Modifier</button>}
          <button onClick={() => window.print()}><Printer size={16} />Imprimer</button>
          {can('payments.create') && <button onClick={() => setPaymentOpen(true)}><CreditCard size={16} />Enregistrer un paiement</button>}
        </div>
      </div>
      <div className="no-print"><SuccessMessage message={success} /></div>
      <article className="print-invoice">
        <header>
          <div className="invoice-logo">PE</div>
          <div>
            <h2>Property ERP Management</h2>
            <p>12 Avenue Lumumba, Kinshasa</p>
            <p>+243 89 000 0000 | billing@property-erp.local</p>
          </div>
          <div className="invoice-meta">
            <strong>Facture {invoice.invoice_number}</strong>
            <span>Date: {shortDate(invoice.issue_date)}</span>
            <span>Échéance: {shortDate(invoice.due_date)}</span>
            <span>Periode: {periodLabel(invoice.month, invoice.year)}</span>
            <StatusBadge value={invoiceDisplayStatus(invoice.status, invoice.due_date)} />
          </div>
        </header>
        <div className="summary-band no-print">
          <div className="summary-item"><span>Date de facture</span><strong>{shortDate(invoice.issue_date)}</strong></div>
          <div className="summary-item"><span>Date d'echeance</span><strong>{shortDate(invoice.due_date)}</strong></div>
          <div className="summary-item"><span>Mois du loyer</span><strong>{monthLabel(invoice.month)}</strong></div>
          <div className="summary-item"><span>Annee du loyer</span><strong>{invoice.year}</strong></div>
          <div className="summary-item summary-item-wide"><span>Periode facturee</span><strong>{periodLabel(invoice.month, invoice.year)}</strong></div>
        </div>
        <div className="invoice-parties">
          <div><span>Locataire</span><strong>{invoice.first_name} {invoice.last_name}</strong><p>{invoice.phone}</p><p>{invoice.email}</p></div>
          <div><span>Appartement</span><strong>{invoice.unit_number}</strong><p>{invoice.building_name}</p><p>{invoice.building_address}, {invoice.building_city}</p></div>
        </div>
        <table>
          <thead><tr><th>Description</th><th className="right">Montant</th></tr></thead>
          <tbody>{invoice.items.map((item) => <tr key={item.id}><td>{itemLabel(item.description)}</td><td className="right">{money(item.amount)}</td></tr>)}</tbody>
          <tfoot><tr><td>Total</td><td className="right">{money(invoice.total)}</td></tr></tfoot>
        </table>
        <div className="payment-summary">
          <span>Payé: {money(invoice.paid_amount)}</span>
          <strong>Restant dû: {money(invoice.remaining_amount)}</strong>
        </div>
        {!!invoice.payments?.length && (
          <div className="detail-section no-print">
            <h4>Reçus de paiement</h4>
            <div className="compact-list">
              {invoice.payments.map((payment) => (
                <div className="compact-item" key={payment.id}>
                  <span>{payment.receipt_number ?? 'Reçu'} · {shortDate(payment.payment_date)} · {paymentMethodLabel(payment.payment_method)}</span>
                  <strong>{money(payment.amount)}</strong>
                </div>
              ))}
            </div>
          </div>
        )}
        <p className="thanks">Merci pour votre confiance.</p>
      </article>
      {editOpen && (
        <Modal title="Modifier la facture" onClose={() => setEditOpen(false)}>
          <form
            className="form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              saveEdit(new FormData(event.currentTarget));
            }}
          >
            <input name="issue_date" type="date" required defaultValue={invoice.issue_date.slice(0, 10)} />
            <input name="due_date" type="date" required defaultValue={invoice.due_date.slice(0, 10)} />
            {invoice.items.map((item) => (
              <div className="invoice-line" key={item.id}>
                <input name="description" defaultValue={item.description} required />
                <input name="amount" type="number" step="0.01" defaultValue={item.amount} required />
              </div>
            ))}
            <button>Enregistrer</button>
          </form>
        </Modal>
      )}
      {paymentOpen && (
        <Modal title="Enregistrer un paiement" onClose={() => setPaymentOpen(false)}>
          <form
            className="form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              pay(new FormData(event.currentTarget));
            }}
          >
            <input name="payment_date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
            <input name="amount" type="number" step="0.01" required defaultValue={invoice.remaining_amount} />
            <select name="payment_method"><option value="CASH">{paymentMethodLabel('CASH')}</option><option value="BANK">{paymentMethodLabel('BANK')}</option><option value="MOBILE_MONEY">{paymentMethodLabel('MOBILE_MONEY')}</option></select>
            <input name="reference" placeholder="Référence" />
            <textarea name="notes" placeholder="Notes" />
            <button>Enregistrer le paiement</button>
          </form>
        </Modal>
      )}
    </section>
  );
}

function monthLabel(month: number) {
  return ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'][Number(month) - 1] ?? String(month ?? '-');
}

function periodLabel(month: number, year: number) {
  if (!month || !year) return '-';
  const start = new Date(Number(year), Number(month) - 1, 1);
  const end = new Date(Number(year), Number(month), 0);
  return `${monthLabel(month)} ${year} (${shortDate(start.toISOString())} - ${shortDate(end.toISOString())})`;
}
