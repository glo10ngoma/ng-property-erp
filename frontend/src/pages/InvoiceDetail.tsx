import { ArrowLeft, Ban, Copy, CreditCard, Download, Eye, FileCheck, FileSpreadsheet, FileText, MessageCircle, Pencil, Plus, Printer, Send, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useParams, useSearchParams } from 'react-router-dom';
import { api, exportCsv, exportXlsxWorkbook, invoiceDisplayStatus, itemLabel, money, paymentMethodLabel, shortDate } from '../api';
import { useAuth } from '../auth';
import { Modal, StatusBadge, SuccessMessage } from '../components';

type Invoice = {
  id: number; tenant_id?: number; lease_id?: number; lease_start_date?: string; lease_end_date?: string; invoice_number: string; issue_date: string; due_date: string; month: number; year: number; total: number; status: string;
  tenant_name?: string; first_name: string; last_name: string; phone: string; email: string; building_name: string; building_address: string; building_city: string; unit_number: string; paid_amount: number; remaining_amount: number; discount_amount?: number; public_notes?: string; internal_notes?: string; attachment_file_name?: string;
  items: { id: number; description: string; amount: number }[];
  payments: { id: number; payment_date: string; amount: number; payment_method: string; receipt_number?: string; reference?: string; notes?: string; created_by?: number }[];
  reminders: { id: number; channel: string; message: string; status: string; reminded_at: string; reminded_by?: number }[];
};
const lineTypes = ['Monthly rent', 'Water', 'Electricity', 'Maintenance', 'Parking', 'Internet', 'Common charges', 'Penalty', 'Other'];

export function InvoiceDetail() {
  const { can } = useAuth();
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editLines, setEditLines] = useState<Array<{ description: string; amount: number }>>([]);
  const [editDiscount, setEditDiscount] = useState(0);
  const [editPublicNotes, setEditPublicNotes] = useState('');
  const [editInternalNotes, setEditInternalNotes] = useState('');
  const [editAttachmentName, setEditAttachmentName] = useState('');
  const [success, setSuccess] = useState('');

  const reload = () => api.get<Invoice>(`/invoices/${id}`).then((response) => setInvoice(response.data));
  useEffect(() => {
    reload();
  }, [id]);

  useEffect(() => {
    if (invoice && searchParams.get('edit') === '1') openEdit();
  }, [invoice?.id, searchParams]);

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
    await api.put(`/invoices/${id}`, {
      month: Number(form.get('month')),
      year: Number(form.get('year')),
      issue_date: form.get('issue_date'),
      due_date: form.get('due_date'),
      discount_amount: Number(editDiscount || 0),
      public_notes: editPublicNotes || null,
      internal_notes: editInternalNotes || null,
      attachment_file_name: editAttachmentName || null,
      attachment_file_url: null,
      items: editLines.filter((line) => line.description && Number(line.amount) >= 0),
    });
    setSuccess('Facture modifiée avec succès.');
    setEditOpen(false);
    reload();
  }

  async function sendReminder(channel: 'EMAIL' | 'SMS' | 'WHATSAPP') {
    if (!invoice) return;
    const label = channel === 'EMAIL' ? 'Email' : channel === 'SMS' ? 'SMS' : 'WhatsApp';
    if (!window.confirm(`Envoyer une relance ${label} pour la facture ${invoice.invoice_number} ?`)) return;
    await api.post(`/reports/invoices/${invoice.id}/remind`, { channel });
    setSuccess(`Relance ${label} envoyee.`);
    reload();
  }

  function confirmAction(label: string) {
    return window.confirm(`${label} pour la facture ${invoice?.invoice_number} ?`);
  }

  function printInvoice(label = 'Imprimer') {
    if (!confirmAction(label)) return;
    window.print();
  }

  async function duplicateInvoice() {
    if (!invoice || !confirmAction('Dupliquer')) return;
    const response = await api.post('/invoices', {
      tenant_id: invoice.tenant_id,
      lease_id: invoice.lease_id ?? null,
      month: invoice.month,
      year: invoice.year,
      issue_date: new Date().toISOString().slice(0, 10),
      due_date: invoice.due_date,
      discount_amount: Number(invoice.discount_amount ?? 0),
      public_notes: invoice.public_notes ?? null,
      internal_notes: invoice.internal_notes ?? null,
      attachment_file_name: invoice.attachment_file_name ?? null,
      attachment_file_url: null,
      items: invoice.items.map((item) => ({ description: item.description, amount: Number(item.amount) })),
    });
    setSuccess('Facture dupliquee avec succes.');
    navigate(`/invoices/${response.data.id}`);
  }

  async function cancelInvoice() {
    if (!invoice || !confirmAction('Annuler')) return;
    await api.post(`/invoices/${invoice.id}/cancel`, { reason: 'Annulation depuis la fiche facture' });
    setSuccess('Facture annulee avec succes.');
    reload();
  }

  if (!invoice) return <div className="empty">Chargement de la facture...</div>;
  const displayStatus = invoiceDisplayStatus(invoice.status, invoice.due_date);
  const stats = invoiceStats(invoice);
  const risk = invoiceRisk(invoice, stats);
  const timeline = invoiceTimeline(invoice);
  const schedule = reminderSchedule(invoice);
  const paymentInfo = invoicePaymentInfo(invoice, schedule);
  const documents = invoiceDocuments(invoice);
  const dashboardRows = invoiceDashboardRows(invoice);

  function openEdit() {
    if (!invoice) return;
    setEditLines(invoice.items.map((item) => ({ description: item.description, amount: Number(item.amount) })));
    setEditDiscount(Number(invoice.discount_amount ?? 0));
    setEditPublicNotes(invoice.public_notes ?? '');
    setEditInternalNotes(invoice.internal_notes ?? '');
    setEditAttachmentName(invoice.attachment_file_name ?? '');
    setEditOpen(true);
  }

  return (
    <section>
      <div className="page-header no-print">
        <h2>{invoice.invoice_number}</h2>
        <div className="actions">
          <button className="secondary" onClick={() => navigate('/invoices')}><ArrowLeft size={16} />Retour</button>
          {can('invoices.update') && <button onClick={openEdit}><Pencil size={16} />Modifier</button>}
          <button onClick={() => printInvoice('Imprimer')}><Printer size={16} />Imprimer</button>
          <button className="secondary" onClick={() => printInvoice('Generer le PDF')}><FileText size={16} />PDF</button>
          <button className="secondary" onClick={() => { if (confirmAction('Exporter en CSV')) exportCsv(`facture-${invoice.invoice_number}.csv`, invoiceExportRows(invoice)); }}><Download size={16} />CSV</button>
          <button className="secondary" onClick={() => { if (confirmAction('Exporter en Excel')) exportInvoiceExcel(invoice, stats, risk, timeline, schedule, documents); }}><FileSpreadsheet size={16} />Excel</button>
          <button className="secondary" onClick={() => sendReminder('EMAIL')}><Send size={16} />Envoyer Email</button>
          <button className="secondary" onClick={() => sendReminder('WHATSAPP')}><MessageCircle size={16} />Envoyer WhatsApp</button>
          {can('payments.create') && <button onClick={() => { if (confirmAction('Enregistrer un paiement')) setPaymentOpen(true); }}><CreditCard size={16} />Enregistrer paiement</button>}
          <button className="secondary" onClick={() => sendReminder('SMS')}><Send size={16} />Relancer</button>
          {can('invoices.create') && <button className="secondary" onClick={duplicateInvoice}><Copy size={16} />Dupliquer</button>}
          {can('invoices.update') && <button className="secondary danger" onClick={cancelInvoice}><Ban size={16} />Annuler facture</button>}
        </div>
      </div>
      <div className="no-print"><SuccessMessage message={success} /></div>
      <div className="summary-band no-print">
        <div className="summary-item"><span>Statut</span><strong>{displayStatus === 'PAID' ? 'FACTURE ACQUITTEE' : displayStatus === 'OVERDUE' ? 'EN RETARD' : displayStatusLabel(displayStatus)}</strong></div>
        <div className="summary-item"><span>Total</span><strong>{money(invoice.total)}</strong></div>
        <div className="summary-item"><span>Paye</span><strong>{money(invoice.paid_amount)}</strong></div>
        <div className="summary-item"><span>Restant</span><strong>{money(invoice.remaining_amount)}</strong></div>
        <div className="summary-item"><span>Risque</span><strong>{risk.level}</strong></div>
        <div className="summary-item"><span>Recouvrement</span><strong>{risk.probability}%</strong></div>
        <div className="summary-item"><span>Anciennete dette</span><strong>{stats.debtAgeDays} j</strong></div>
      </div>
      <div className="mini-stats no-print">
        <div className="mini-stat"><span>Temps moyen paiement</span><strong>{stats.averagePaymentDays}</strong></div>
        <div className="mini-stat"><span>Nombre paiements</span><strong>{stats.paymentCount}</strong></div>
        <div className="mini-stat"><span>Nombre relances</span><strong>{stats.reminderCount}</strong></div>
        <div className="mini-stat"><span>Montant restant</span><strong>{money(invoice.remaining_amount)}</strong></div>
      </div>
      <div className="detail-section no-print report-section">
        <h4>Informations de paiement</h4>
        <div className="summary-band invoice-payment-info">
          <div className="summary-item"><span>Mode de paiement</span><strong>{paymentInfo.method}</strong></div>
          <div className="summary-item"><span>Nombre de paiements</span><strong>{paymentInfo.paymentCount}</strong></div>
          <div className="summary-item"><span>Dernier paiement</span><strong>{paymentInfo.lastPayment}</strong></div>
          <div className="summary-item"><span>Prochaine relance</span><strong>{paymentInfo.nextReminder}</strong></div>
          <div className="summary-item"><span>Derniere relance</span><strong>{paymentInfo.lastReminder}</strong></div>
          <div className="summary-item"><span>Nombre de relances</span><strong>{paymentInfo.reminderCount}</strong></div>
          <div className="summary-item"><span>Solde restant</span><strong>{money(invoice.remaining_amount)}</strong></div>
        </div>
      </div>
      <div className="detail-section no-print report-section">
        <h4>Dashboard facture</h4>
        <div className="invoice-mini-chart">
          {dashboardRows.map((row) => (
            <div className="invoice-chart-row" key={row.label}>
              <span>{row.label}</span>
              <div className="bar-track"><div className={`bar-fill ${row.kind}`} style={{ width: `${row.percent}%` }} /></div>
              <strong>{row.value}</strong>
            </div>
          ))}
        </div>
      </div>
      <article className="print-invoice">
        <header>
          <div className="invoice-logo">NG</div>
          <div>
            <h2>NG Property ERP</h2>
            <p>Gestion Immobiliere - NG ERP Platform</p>
            <p>RCCM: CD/KIN/RCCM/26-B-0001 | NIF: A2600001Z</p>
            <p>12 Avenue Lumumba, Kinshasa</p>
            <p>+243 89 000 0000 | billing@property-erp.local</p>
            <p>Banque: NG Bank | IBAN: CD00 0000 0000 0000 0000 0000</p>
          </div>
          <div className="invoice-meta">
            <strong>Facture {invoice.invoice_number}</strong>
            <span>Date: {shortDate(invoice.issue_date)}</span>
            <span>Échéance: {shortDate(invoice.due_date)}</span>
            <span>Periode: {periodLabel(invoice.month, invoice.year)}</span>
            <StatusBadge value={invoiceDisplayStatus(invoice.status, invoice.due_date)} />
          </div>
        </header>
        <div className="invoice-print-codes">
          <div><span>QR Code paiement</span><strong>QR</strong></div>
          <div><span>Code barre facture</span><strong>{barcode(invoice.invoice_number)}</strong></div>
        </div>
        <div className={displayStatus === 'PAID' ? 'invoice-stamp paid' : displayStatus === 'OVERDUE' ? 'invoice-stamp overdue' : 'invoice-stamp'}>{displayStatus === 'PAID' ? 'FACTURE ACQUITTEE' : displayStatus === 'OVERDUE' ? 'FACTURE EN RETARD' : displayStatusLabel(displayStatus)}</div>
        <div className="summary-band no-print">
          <div className="summary-item"><span>Date de facture</span><strong>{shortDate(invoice.issue_date)}</strong></div>
          <div className="summary-item"><span>Date d'echeance</span><strong>{shortDate(invoice.due_date)}</strong></div>
          <div className="summary-item"><span>Mois du loyer</span><strong>{monthLabel(invoice.month)}</strong></div>
          <div className="summary-item"><span>Annee du loyer</span><strong>{invoice.year}</strong></div>
          <div className="summary-item summary-item-wide"><span>Periode facturee</span><strong>{periodLabel(invoice.month, invoice.year)}</strong></div>
        </div>
        <div className="invoice-parties">
          <div><span>Locataire</span><strong>{invoice.tenant_name || `${invoice.first_name} ${invoice.last_name}`}</strong><p>{invoice.phone}</p><p>{invoice.email}</p></div>
          <div><span>Appartement</span><strong>{invoice.unit_number}</strong><p>{invoice.building_name}</p><p>{invoice.building_address}, {invoice.building_city}</p></div>
        </div>
        <table>
          <thead><tr><th>Description</th><th className="right">Montant</th></tr></thead>
          <tbody>{invoice.items.map((item) => <tr key={item.id}><td>{itemLabel(item.description)}</td><td className="right">{money(item.amount)}</td></tr>)}</tbody>
          <tfoot>{Number(invoice.discount_amount ?? 0) > 0 && <tr><td>Remise</td><td className="right">- {money(invoice.discount_amount)}</td></tr>}<tr><td>Total</td><td className="right">{money(invoice.total)}</td></tr></tfoot>
        </table>
        {invoice.public_notes && <p className="thanks">{invoice.public_notes}</p>}
        <div className="invoice-conditions">
          <strong>Conditions de paiement</strong>
          <p>Paiement attendu au plus tard a la date d'echeance indiquee. Merci d'indiquer le numero de facture dans toute reference de paiement.</p>
        </div>
        <div className="payment-summary">
          <span>Payé: {money(invoice.paid_amount)}</span>
          <strong>Restant dû: {money(invoice.remaining_amount)}</strong>
        </div>
        <div className="invoice-signature-row">
          <div><span>Signature</span></div>
          <div><span>Tampon</span></div>
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
        {(invoice.internal_notes || invoice.attachment_file_name) && (
          <div className="detail-section no-print">
            <h4>Informations internes</h4>
            <div className="compact-list">
              {invoice.internal_notes && <div className="compact-item"><span>Notes internes</span><strong>{invoice.internal_notes}</strong></div>}
              {invoice.attachment_file_name && <div className="compact-item"><span>Piece jointe prevue</span><strong>{invoice.attachment_file_name}</strong></div>}
            </div>
          </div>
        )}
        <div className="detail-section no-print report-section">
          <h4>Historique des paiements</h4>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Reference</th><th>Mode de paiement</th><th className="right">Montant</th><th>Utilisateur</th><th>Observation</th><th>Actions</th></tr></thead>
              <tbody>{invoice.payments.map((payment) => <tr key={payment.id}><td>{shortDate(payment.payment_date)}</td><td>{payment.receipt_number ?? payment.reference ?? '-'}</td><td>{paymentMethodLabel(payment.payment_method)}</td><td className="right">{amount(payment.amount)} USD</td><td>{payment.created_by ? `Utilisateur #${payment.created_by}` : 'Systeme'}</td><td>{payment.notes ?? '-'}</td><td><button type="button" className="icon-btn" title="Voir" onClick={() => navigate(`/payments/${payment.id}`)}><Eye size={16} /></button></td></tr>)}</tbody>
            </table>
            {!invoice.payments.length && <div className="compact-empty">Aucun paiement enregistre.</div>}
          </div>
        </div>
        <div className="detail-section no-print report-section">
          <h4>Historique des relances</h4>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Canal</th><th>Statut</th><th>Utilisateur</th><th>Message envoye</th><th>Action</th></tr></thead>
              <tbody>{invoice.reminders.map((reminder) => <tr key={reminder.id}><td>{shortDate(reminder.reminded_at)}</td><td>{channelLabel(reminder.channel)}</td><td><StatusBadge value={reminder.status} /></td><td>{reminder.reminded_by ? `Utilisateur #${reminder.reminded_by}` : 'Systeme'}</td><td>{reminder.message}</td><td><button type="button" className="icon-btn" title="Voir" onClick={() => window.alert(reminder.message)}><Eye size={16} /></button></td></tr>)}</tbody>
            </table>
            {!invoice.reminders.length && <div className="compact-empty">Aucune relance envoyee.</div>}
          </div>
        </div>
        <div className="detail-section no-print report-section">
          <h4>Documents</h4>
          <div className="document-grid">
            {documents.map((document) => (
              <div className={document.exists ? 'document-tile available' : 'document-tile'} key={document.name}>
                {document.exists ? <FileCheck size={18} /> : <FileText size={18} />}
                <span>{document.name}</span>
                <strong>{document.exists ? 'Disponible' : 'Non disponible'}</strong>
              </div>
            ))}
          </div>
        </div>
        <div className="detail-section no-print report-section">
          <h4>Programmation relances</h4>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Etape</th><th>Date prevue</th><th>Statut</th></tr></thead>
              <tbody>{schedule.map((row) => <tr key={row.Etape}><td>{row.Etape}</td><td>{row.Date}</td><td><StatusBadge value={row.Statut} /></td></tr>)}</tbody>
            </table>
          </div>
        </div>
        <div className="detail-section no-print report-section">
          <h4>Timeline</h4>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Evenement</th><th>Description</th><th>Utilisateur</th></tr></thead>
              <tbody>{timeline.map((row, index) => <tr key={index}><td>{row.Date}</td><td>{row.Evenement}</td><td>{row.Description}</td><td>{row.Utilisateur}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
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
            <div className="lease-section-grid">
              <label>Date de facture<input name="issue_date" type="date" required defaultValue={invoice.issue_date.slice(0, 10)} /></label>
              <label>Date d'echeance<input name="due_date" type="date" required defaultValue={invoice.due_date.slice(0, 10)} /></label>
              <label>Mois du loyer<input name="month" type="number" min="1" max="12" required defaultValue={invoice.month} /></label>
              <label>Annee du loyer<input name="year" type="number" min="2000" required defaultValue={invoice.year} /></label>
              <label>Periode debut<input type="date" value={periodStart(String(invoice.month), String(invoice.year))} readOnly /></label>
              <label>Periode fin<input type="date" value={periodEnd(String(invoice.month), String(invoice.year))} readOnly /></label>
            </div>
            {editLines.map((item, index) => (
              <div className="invoice-line" key={index}>
                <select value={item.description} onChange={(event) => setEditLines((lines) => lines.map((line, i) => i === index ? { ...line, description: event.target.value } : line))}>{lineTypes.map((type) => <option key={type} value={type}>{itemLabel(type)}</option>)}</select>
                <input type="number" step="0.01" value={item.amount} onChange={(event) => setEditLines((lines) => lines.map((line, i) => i === index ? { ...line, amount: Number(event.target.value) } : line))} required />
                <button type="button" className="icon-btn danger" onClick={() => setEditLines((lines) => lines.filter((_, i) => i !== index))}><X size={16} /></button>
              </div>
            ))}
            <button type="button" className="secondary" onClick={() => setEditLines([...editLines, { description: 'Other', amount: 0 }])}><Plus size={16} />Ajouter un item</button>
            <label>Remise<input type="number" min="0" value={editDiscount} onChange={(event) => setEditDiscount(Number(event.target.value))} /></label>
            <label>Notes visibles<textarea rows={2} value={editPublicNotes} onChange={(event) => setEditPublicNotes(event.target.value)} /></label>
            <label>Notes internes<textarea rows={2} value={editInternalNotes} onChange={(event) => setEditInternalNotes(event.target.value)} /></label>
            <label>Piece jointe prevue<input type="file" accept="application/pdf,image/*" onChange={(event) => setEditAttachmentName(event.target.files?.[0]?.name ?? editAttachmentName)} /></label>
            <label>Nom fichier<input className="locked-field" value={editAttachmentName} readOnly placeholder="Aucun fichier selectionne" /></label>
            <div className="total-row">Total <strong>{money(Math.max(0, editLines.reduce((sum, line) => sum + Number(line.amount || 0), 0) - Number(editDiscount || 0)))}</strong></div>
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

function amount(value: unknown) {
  return Number(value ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}

function displayStatusLabel(status: string) {
  return ({ PAID: 'Payee', PARTIAL: 'Paiement partiel', UNPAID: 'Non payee', OVERDUE: 'En retard', DRAFT: 'Brouillon', CANCELLED: 'Annulee' } as Record<string, string>)[status] ?? status;
}

function invoiceStats(invoice: Invoice) {
  const paymentDays = invoice.payments
    .map((payment) => daysBetween(invoice.issue_date, payment.payment_date))
    .filter((value) => Number.isFinite(value) && value >= 0);
  const average = paymentDays.length ? Math.round(paymentDays.reduce((sum, value) => sum + value, 0) / paymentDays.length) : 0;
  const remaining = Number(invoice.remaining_amount ?? 0);
  return {
    averagePaymentDays: paymentDays.length ? `${average} j` : 'Non disponible',
    paymentCount: invoice.payments.length,
    reminderCount: invoice.reminders.length,
    debtAgeDays: remaining > 0 ? Math.max(0, daysBetween(invoice.due_date, new Date().toISOString())) : 0,
    remaining,
  };
}

function invoiceRisk(invoice: Invoice, stats: ReturnType<typeof invoiceStats>) {
  const status = invoiceDisplayStatus(invoice.status, invoice.due_date);
  const reminderCount = stats.reminderCount;
  const debtAge = stats.debtAgeDays;
  if (status === 'PAID') return { level: 'Faible', probability: 100 };
  if (status === 'OVERDUE' && (debtAge >= 15 || reminderCount >= 3)) return { level: 'Eleve', probability: 30 };
  if (status === 'OVERDUE' || reminderCount >= 1 || Number(invoice.remaining_amount) > Number(invoice.total) * 0.5) return { level: 'Moyen', probability: 55 };
  return { level: 'Faible', probability: 80 };
}

function reminderSchedule(invoice: Invoice) {
  return [
    { Etape: '3 jours avant echeance', Date: shiftedDate(invoice.due_date, -3) },
    { Etape: 'Jour J', Date: shiftedDate(invoice.due_date, 0) },
    { Etape: '3 jours apres', Date: shiftedDate(invoice.due_date, 3) },
    { Etape: '7 jours apres', Date: shiftedDate(invoice.due_date, 7) },
    { Etape: '15 jours apres', Date: shiftedDate(invoice.due_date, 15) },
  ].map((row) => ({ ...row, Statut: new Date(row.Date).getTime() <= Date.now() ? 'A traiter' : 'Programme' }));
}

function invoicePaymentInfo(invoice: Invoice, schedule: ReturnType<typeof reminderSchedule>) {
  const lastPayment = invoice.payments[0];
  const lastReminder = invoice.reminders[0];
  const nextReminder = schedule.find((row) => row.Statut === 'Programme') ?? schedule[schedule.length - 1];
  return {
    method: lastPayment ? paymentMethodLabel(lastPayment.payment_method) : 'Non disponible',
    paymentCount: invoice.payments.length,
    lastPayment: lastPayment ? `${shortDate(lastPayment.payment_date)} - ${money(lastPayment.amount)}` : 'Aucun paiement',
    nextReminder: nextReminder ? nextReminder.Date : 'Non disponible',
    lastReminder: lastReminder ? `${shortDate(lastReminder.reminded_at)} - ${channelLabel(lastReminder.channel)}` : 'Jamais relance',
    reminderCount: invoice.reminders.length,
  };
}

function invoiceDocuments(invoice: Invoice) {
  return [
    { name: 'Facture PDF', exists: true, detail: `Facture_${invoice.invoice_number}.pdf` },
    { name: 'Piece jointe', exists: Boolean(invoice.attachment_file_name), detail: invoice.attachment_file_name ?? 'Non disponible' },
    { name: 'Contrat lie', exists: Boolean(invoice.lease_id), detail: invoice.lease_id ? `B-${invoice.lease_id}` : 'Non disponible' },
    { name: 'Documents bail', exists: Boolean(invoice.lease_id), detail: invoice.lease_id ? 'Voir bail lie' : 'Non disponible' },
  ];
}

function invoiceDashboardRows(invoice: Invoice) {
  const total = Math.max(Number(invoice.total ?? 0), 1);
  const paid = Number(invoice.paid_amount ?? 0);
  const remaining = Number(invoice.remaining_amount ?? 0);
  const overdue = invoiceDisplayStatus(invoice.status, invoice.due_date) === 'OVERDUE' ? remaining : 0;
  return [
    { label: 'Evolution des paiements', value: money(paid), percent: Math.min(100, Math.round((paid / total) * 100)), kind: 'paid' },
    { label: 'Evolution des impayes', value: money(remaining), percent: Math.min(100, Math.round((remaining / total) * 100)), kind: 'unpaid' },
    { label: 'Evolution des retards', value: money(overdue), percent: Math.min(100, Math.round((overdue / total) * 100)), kind: 'overdue' },
  ];
}

function invoiceTimeline(invoice: Invoice) {
  return [
    { Date: shortDate(invoice.issue_date), Evenement: 'Creation', Description: invoice.invoice_number, Utilisateur: 'Systeme' },
    { Date: shortDate(invoice.issue_date), Evenement: 'Validation', Description: displayStatusLabel(invoice.status), Utilisateur: 'Systeme' },
    { Date: shortDate(invoice.due_date), Evenement: 'Echeance', Description: displayStatusLabel(invoiceDisplayStatus(invoice.status, invoice.due_date)), Utilisateur: 'Systeme' },
    ...invoice.payments.map((payment) => ({ Date: shortDate(payment.payment_date), Evenement: Number(invoice.remaining_amount) > 0 ? 'Paiement partiel' : 'Paiement', Description: `${paymentMethodLabel(payment.payment_method)} - ${money(payment.amount)}`, Utilisateur: payment.created_by ? `Utilisateur #${payment.created_by}` : 'Systeme' })),
    ...invoice.reminders.map((reminder) => ({ Date: shortDate(reminder.reminded_at), Evenement: `Relance ${channelLabel(reminder.channel)}`, Description: reminder.status, Utilisateur: reminder.reminded_by ? `Utilisateur #${reminder.reminded_by}` : 'Systeme' })),
    ...(invoice.status === 'CANCELLED' ? [{ Date: shortDate(new Date().toISOString()), Evenement: 'Annulation', Description: 'Facture annulee', Utilisateur: 'Systeme' }] : []),
    { Date: shortDate(new Date().toISOString()), Evenement: 'Telechargement PDF', Description: 'Disponible via action PDF', Utilisateur: 'Utilisateur' },
    { Date: shortDate(new Date().toISOString()), Evenement: 'Impression', Description: 'Disponible via action Imprimer', Utilisateur: 'Utilisateur' },
  ].sort((a, b) => new Date(toIsoDate(b.Date)).getTime() - new Date(toIsoDate(a.Date)).getTime());
}

function invoiceExportRows(invoice: Invoice) {
  return [
    { section: 'Resume', champ: 'Facture', valeur: invoice.invoice_number },
    { section: 'Resume', champ: 'Statut', valeur: displayStatusLabel(invoiceDisplayStatus(invoice.status, invoice.due_date)) },
    { section: 'Resume', champ: 'Total', valeur: amount(invoice.total), devise: 'USD' },
    { section: 'Resume', champ: 'Paye', valeur: amount(invoice.paid_amount), devise: 'USD' },
    { section: 'Resume', champ: 'Restant', valeur: amount(invoice.remaining_amount), devise: 'USD' },
  ];
}

function exportInvoiceExcel(invoice: Invoice, stats: ReturnType<typeof invoiceStats>, risk: ReturnType<typeof invoiceRisk>, timeline: ReturnType<typeof invoiceTimeline>, schedule: ReturnType<typeof reminderSchedule>, documents: ReturnType<typeof invoiceDocuments>) {
  exportXlsxWorkbook(`Facture_${invoice.invoice_number}.xlsx`, [
    { name: 'Resume', rows: [{ facture: invoice.invoice_number, statut: displayStatusLabel(invoiceDisplayStatus(invoice.status, invoice.due_date)), total: amount(invoice.total), paye: amount(invoice.paid_amount), restant: amount(invoice.remaining_amount), devise: 'USD', risque: risk.level, probabilite_recouvrement: `${risk.probability}%` }] },
    { name: 'Informations', rows: [{ numero: invoice.invoice_number, emission: shortDate(invoice.issue_date), echeance: shortDate(invoice.due_date), periode: periodLabel(invoice.month, invoice.year), remise: amount(invoice.discount_amount), notes_visibles: invoice.public_notes ?? '', notes_internes: invoice.internal_notes ?? '', piece_jointe: invoice.attachment_file_name ?? '' }] },
    { name: 'Locataire', rows: [{ nom: invoice.tenant_name || `${invoice.first_name} ${invoice.last_name}`, telephone: invoice.phone, email: invoice.email }] },
    { name: 'Bail', rows: [{ bail: invoice.lease_id ? `B-${invoice.lease_id}` : '', debut: invoice.lease_start_date ? shortDate(invoice.lease_start_date) : '', fin: invoice.lease_end_date ? shortDate(invoice.lease_end_date) : '' }] },
    { name: 'Appartement', rows: [{ immeuble: invoice.building_name, adresse: invoice.building_address, ville: invoice.building_city, unite: invoice.unit_number }] },
    { name: 'Lignes', rows: invoice.items.map((item) => ({ description: itemLabel(item.description), montant: amount(item.amount), devise: 'USD' })) },
    { name: 'Paiements', rows: invoice.payments.map((payment) => ({ date: shortDate(payment.payment_date), reference: payment.receipt_number ?? payment.reference ?? '', mode: paymentMethodLabel(payment.payment_method), montant: amount(payment.amount), devise: 'USD', utilisateur: payment.created_by ? `Utilisateur #${payment.created_by}` : 'Systeme', observation: payment.notes ?? '' })) },
    { name: 'Relances', rows: invoice.reminders.map((reminder) => ({ date: shortDate(reminder.reminded_at), canal: channelLabel(reminder.channel), statut: reminder.status, utilisateur: reminder.reminded_by ? `Utilisateur #${reminder.reminded_by}` : 'Systeme', message: reminder.message })) },
    { name: 'Documents', rows: documents.map((document) => ({ document: document.name, statut: document.exists ? 'Disponible' : 'Non disponible', detail: document.detail })) },
    { name: 'Timeline', rows: [...timeline, ...schedule.map((row) => ({ Date: row.Date, Evenement: row.Etape, Description: row.Statut, Utilisateur: 'Systeme' }))] },
    { name: 'Audit', rows: [{ temps_moyen_avant_paiement: stats.averagePaymentDays, nombre_paiements: stats.paymentCount, nombre_relances: stats.reminderCount, anciennete_dette_jours: stats.debtAgeDays, montant_restant: amount(stats.remaining), devise: 'USD', exporte_le: shortDate(new Date().toISOString()) }] },
  ]);
}

function channelLabel(channel: string) {
  return ({ EMAIL: 'Email', SMS: 'SMS', WHATSAPP: 'WhatsApp' } as Record<string, string>)[channel] ?? channel;
}

function barcode(value: string) {
  return value.split('').map((char) => (char.charCodeAt(0) % 2 ? '|' : '||')).join(' ');
}

function shiftedDate(value: string, days: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  return Math.round((endDate.getTime() - startDate.getTime()) / 86400000);
}

function toIsoDate(value: string) {
  const parts = value.split('/');
  if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
  return value;
}

function periodLabel(month: number, year: number) {
  if (!month || !year) return '-';
  const start = new Date(Number(year), Number(month) - 1, 1);
  const end = new Date(Number(year), Number(month), 0);
  return `${monthLabel(month)} ${year} (${shortDate(start.toISOString())} - ${shortDate(end.toISOString())})`;
}

function periodStart(month: string, year: string) {
  if (!month || !year) return '';
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

function periodEnd(month: string, year: string) {
  if (!month || !year) return '';
  return new Date(Number(year), Number(month), 0).toISOString().slice(0, 10);
}
