import { ArrowLeft, CreditCard, FileSpreadsheet, Mail, MessageCircle, Pencil, Plus, Printer, Smartphone, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, exportXlsxWorkbook, invoiceDisplayStatus, itemLabel, money, paymentMethodLabel, shortDate } from '../api';
import { useAuth } from '../auth';
import { Modal, SuccessMessage } from '../components';
import { openOrDownloadDocument } from '../core/utils/documentActions';
import { formatLeaseReference } from '../utils/lease-reference';

type Invoice = {
  id: number;
  tenant_id?: number;
  lease_id?: number;
  lease_number?: number;
  lease_start_date?: string;
  lease_end_date?: string;
  invoice_number: string;
  issue_date: string;
  due_date: string;
  month: number;
  year: number;
  billing_month?: number;
  billing_year?: number;
  period_start?: string;
  period_end?: string;
  total: number;
  status: string;
  invoice_type?: string;
  generated_automatically?: boolean;
  generation_source?: string;
  email_delivery_status?: string;
  email_delivery_reason?: string;
  whatsapp_delivery_status?: string;
  whatsapp_delivery_reason?: string;
  automation_run_id?: number;
  tenant_name?: string;
  tenant_type?: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  building_name: string;
  building_address: string;
  building_city: string;
  unit_number: string;
  monthly_rent?: number;
  monthly_syndic_amount?: number;
  paid_amount: number;
  remaining_amount: number;
  discount_amount?: number;
  public_notes?: string;
  internal_notes?: string;
  attachment_file_name?: string;
  attachment_file_url?: string;
  items: { id: number; item_type?: string; description: string; amount: number }[];
  payments: { id: number; payment_date: string; amount: number; payment_method: string; receipt_number?: string; reference?: string; notes?: string; created_by?: number }[];
  reminders: { id: number; channel: string; message: string; status: string; reminded_at: string; reminded_by?: number }[];
  email_logs: { id: number; recipient: string; subject?: string; message: string; status: string; sent_at?: string; created_at: string }[];
  whatsapp_logs: { id: number; recipient: string; message: string; status: string; sent_at?: string; created_at: string }[];
  automation_run?: { id: number; automation_code: string; execution_mode: string; billing_month: number; billing_year: number; status: string; started_at: string; completed_at?: string | null } | null;
};

type ExchangeRate = {
  rate: number;
  effectiveDate?: string;
};

type CompanySettingsHeader = {
  logo_url?: string;
  logo_file_url?: string;
  company_name?: string;
  legal_name?: string;
  company_legal_name?: string;
  company_legal_name_resolved?: string;
  address?: string;
  company_address?: string;
  company_address_resolved?: string;
  phone?: string;
  email?: string;
};

const lineTypes = ['Monthly rent', 'Syndic', 'Water', 'Electricity', 'Maintenance', 'Parking', 'Internet', 'Common charges', 'Penalty', 'Other'];

export function InvoiceDetail() {
  const { can, user } = useAuth();
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editLines, setEditLines] = useState<Array<{ item_type: string; description: string; amount: number }>>([]);
  const [editDiscount, setEditDiscount] = useState(0);
  const [editPublicNotes, setEditPublicNotes] = useState('');
  const [editInternalNotes, setEditInternalNotes] = useState('');
  const [editAttachmentName, setEditAttachmentName] = useState('');
  const [success, setSuccess] = useState('');
  const [exchangeRate, setExchangeRate] = useState<ExchangeRate | null>(null);
  const [companySettings, setCompanySettings] = useState<CompanySettingsHeader | null>(null);
  const [paymentCurrency, setPaymentCurrency] = useState<'USD' | 'CDF' | 'MIXED'>('USD');
  const [usdAmount, setUsdAmount] = useState('');
  const [cdfAmount, setCdfAmount] = useState('');
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [paymentError, setPaymentError] = useState('');

  async function reload() {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const response = await api.get<Invoice>(`/invoices/${id}`);
      setInvoice(response.data);
    } catch (err) {
      setInvoice(null);
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, [id]);

  useEffect(() => {
    api.get<ExchangeRate | null>('/settings/exchange-rate').then((response) => setExchangeRate(response.data ?? null)).catch(() => setExchangeRate(null));
  }, []);

  useEffect(() => {
    api.get<CompanySettingsHeader>('/settings/company').then((response) => setCompanySettings(response.data ?? null)).catch(() => setCompanySettings(null));
  }, []);

  useEffect(() => {
    if (invoice) setUsdAmount(String(Number(invoice.remaining_amount ?? 0).toFixed(2)));
  }, [invoice]);

  useEffect(() => {
    if (invoice && searchParams.get('edit') === '1') openEdit();
  }, [invoice, searchParams]);

  async function pay(form: FormData) {
    setPaymentError('');
    const paymentCurrency = String(form.get('payment_currency') ?? 'USD');
    const amountUsd = Number(form.get('amount_usd') ?? 0);
    const amountCdf = Number(form.get('amount_cdf') ?? 0);
    const rate = Number(form.get('exchange_rate_used') ?? exchangeRate?.rate ?? 0) || null;
    const amount = Number(form.get('amount') ?? 0);
    if (!Number.isFinite(amountUsd) || !Number.isFinite(amountCdf) || !Number.isFinite(amount)) {
      setPaymentError('Montant de paiement invalide.');
      return;
    }
    if (amountUsd <= 0 && amountCdf <= 0) {
      setPaymentError('Le paiement doit contenir au moins un montant USD ou CDF.');
      return;
    }
    if ((paymentCurrency === 'CDF' || amountCdf > 0) && !rate) {
      setPaymentError('Aucun taux de change n\'est configure. Veuillez definir le taux dans Parametres.');
      return;
    }
    if (amount > Number(invoice?.remaining_amount ?? 0) + 0.01) {
      setPaymentError(`Le montant doit etre compris entre 0 et ${money(invoice?.remaining_amount ?? 0)}.`);
      return;
    }
    setPaymentSubmitting(true);
    try {
      await api.post('/payments', {
        invoice_id: Number(id),
        payment_date: form.get('payment_date'),
        amount,
        payment_currency: paymentCurrency,
        amount_usd: amountUsd,
        amount_cdf: amountCdf,
        exchange_rate_used: rate ?? undefined,
        exchange_rate_date: form.get('exchange_rate_date'),
        payment_method: form.get('payment_method'),
        reference: form.get('reference'),
        notes: form.get('notes'),
        payer_name: form.get('payer_name'),
      });
      setSuccess('Paiement enregistre avec succes.');
      setPaymentOpen(false);
      void reload().catch((refreshError) => {
        console.error('[PAYMENT] post-success refresh failed', refreshError);
      });
    } catch (err) {
      setPaymentError(apiErrorMessage(err));
    } finally {
      setPaymentSubmitting(false);
    }
  }

  async function saveEdit(form: FormData) {
    await api.put(`/invoices/${id}`, {
      invoice_type: invoice?.invoice_type ?? 'RENT',
      month: Number(form.get('month')),
      year: Number(form.get('year')),
      billing_month: Number(form.get('month')),
      billing_year: Number(form.get('year')),
      issue_date: form.get('issue_date'),
      due_date: form.get('due_date'),
      period_start: periodStart(String(form.get('month')), String(form.get('year'))),
      period_end: periodEnd(String(form.get('month')), String(form.get('year'))),
      discount_amount: Number(editDiscount || 0),
      public_notes: editPublicNotes || null,
      internal_notes: editInternalNotes || null,
      attachment_file_name: editAttachmentName || null,
      attachment_file_url: null,
      items: editLines
        .filter((line) => line.item_type && Number(line.amount) >= 0)
        .map((line) => ({
          item_type: line.item_type,
          description: buildInvoiceLineDescription(line.item_type, Number(form.get('month')), Number(form.get('year'))),
          amount: Number(line.amount),
        })),
    });
    setSuccess('Facture modifiee avec succes.');
    setEditOpen(false);
    reload();
  }

  async function sendReminder(channel: 'EMAIL' | 'SMS' | 'WHATSAPP') {
    const label = channelLabel(channel);
    if (!window.confirm(`Envoyer une relance ${label} pour la facture ${invoice?.invoice_number} ?`)) return;

    await api.post(`/reports/invoices/${id}/remind`, { channel });
    setSuccess(`Relance ${label} envoyee avec succes.`);
    await reload();
  }

  function openEdit() {
    if (!invoice) return;
    setEditLines(invoice.items.map((item) => ({ item_type: item.item_type ?? inferInvoiceItemType(item.description), description: item.description, amount: Number(item.amount) })));
    setEditDiscount(Number(invoice.discount_amount ?? 0));
    setEditPublicNotes(invoice.public_notes ?? '');
    setEditInternalNotes(invoice.internal_notes ?? '');
    setEditAttachmentName(invoice.attachment_file_name ?? '');
    setEditOpen(true);
  }

  if (loading) return <div className="empty">Chargement de la facture...</div>;
  if (error) {
    return (
      <section>
        <div className="page-header no-print">
          <h2>Facture</h2>
          <div className="actions invoice-detail-actions">
            <button className="secondary" onClick={() => navigate('/invoices')}><ArrowLeft size={16} />Retour</button>
          </div>
        </div>
        <div className="empty">{error}</div>
      </section>
    );
  }
  if (!invoice) return <div className="empty">Facture introuvable</div>;

  const displayStatus = invoiceDisplayStatus(invoice.status, invoice.due_date);
  const stats = invoiceStats(invoice);
  const risk = invoiceRisk(invoice, stats);
  const timeline = invoiceTimeline(invoice);
  const schedule = reminderSchedule(invoice);
  const documents = invoiceDocuments(invoice);
  const billingMonth = invoice.billing_month ?? invoice.month;
  const billingYear = invoice.billing_year ?? invoice.year;
  const sendHistoryCount = (invoice.email_logs?.length ?? 0) + (invoice.whatsapp_logs?.length ?? 0);
  const isRentInvoice = String(invoice.invoice_type ?? 'RENT').toUpperCase() === 'RENT';
  const organizationName = companyDisplayName(companySettings, user?.organization_name);
  const organizationAddress = companyAddressLine(companySettings);
  const organizationContact = companyContactLine(companySettings);
  const issueMonthLabel = issueDateMonthLabel(invoice.issue_date);
  const issueMonthYearLabel = issueDateMonthYearLabel(invoice.issue_date);
  const issueYearLabel = issueDateYearLabel(invoice.issue_date);
  const logoUrl = cleanPrintValue(companySettings?.logo_file_url ?? companySettings?.logo_url);
  const titleOnlyInvoiceHeader = isTitleOnlyInvoiceHeaderOrganization(user?.organization_slug);
  const invoicePrintTitle = isRentInvoice ? 'FACTURE LOYER' : 'FACTURE MAINTENANCE ET AUTRES CHARGES';

  return (
    <section>
      <div className="page-header no-print">
        <h2>{invoice.invoice_number}</h2>
        <div className="actions invoice-detail-actions">
          <button className="secondary" onClick={() => navigate('/invoices')}><ArrowLeft size={16} />Retour</button>
          {can('invoices.update') && <button onClick={openEdit}><Pencil size={16} />Modifier</button>}
          <button onClick={() => window.print()}><Printer size={16} />Imprimer</button>
          {can('payments.create') && <button title="Enregistrer un paiement" onClick={() => setPaymentOpen(true)}><CreditCard size={16} />Paiement</button>}
          {can('communication.send') && <button className="secondary" title="Envoyer par WhatsApp" onClick={() => sendReminder('WHATSAPP')}><MessageCircle size={16} />WhatsApp</button>}
          {can('communication.send') && <button className="secondary" title="Envoyer par e-mail" onClick={() => sendReminder('EMAIL')}><Mail size={16} />Email</button>}
          {can('communication.send') && <button className="secondary" title="Envoyer par SMS" onClick={() => sendReminder('SMS')}><Smartphone size={16} />SMS</button>}
          <button className="secondary" onClick={() => exportInvoiceExcel(invoice, stats, risk, timeline, schedule, documents)}><FileSpreadsheet size={16} />Excel</button>
        </div>
      </div>

      <div className="no-print"><SuccessMessage message={success} /></div>

      <article className="print-invoice">
        <header className={titleOnlyInvoiceHeader ? 'invoice-header-title-only' : undefined}>
          {titleOnlyInvoiceHeader ? (
            <div className="invoice-title-only">
              <h2>{invoicePrintTitle}</h2>
            </div>
          ) : (
            <>
              <div className="invoice-logo">
                {logoUrl ? (
                  <img src={logoUrl} alt={organizationName ? `Logo ${organizationName}` : 'Logo organisation'} className="invoice-logo-image" />
                ) : (
                  <span>{companyInitials(companySettings, user?.organization_name)}</span>
                )}
              </div>
              <div>
                <h2>{organizationName || '—'}</h2>
                {organizationAddress && <p>{organizationAddress}</p>}
                {organizationContact && <p>{organizationContact}</p>}
              </div>
            </>
          )}
          <div className="invoice-meta">
            <strong>Facture {invoice.invoice_number}</strong>
            <span>Date: {shortDate(invoice.issue_date)}</span>
            <span>Echeance: {shortDate(invoice.due_date)}</span>
            {isRentInvoice && <span>Periode: {periodLabel(billingMonth, billingYear)}</span>}
            {!isRentInvoice && <span>Mois de facture: {issueMonthYearLabel}</span>}
            <span className={`badge ${displayStatus.toLowerCase()}`}>{clientInvoiceStatusLabel(displayStatus)}</span>
          </div>
        </header>

        <div className="summary-band no-print">
          <div className="summary-item"><span>Date de facture</span><strong>{shortDate(invoice.issue_date)}</strong></div>
          <div className="summary-item"><span>Date d'echeance</span><strong>{shortDate(invoice.due_date)}</strong></div>
          <div className="summary-item"><span>Type</span><strong>{invoiceTypeLabel(invoice.invoice_type)}</strong></div>
          {isRentInvoice && <div className="summary-item"><span>Mois du loyer</span><strong>{monthLabel(billingMonth)}</strong></div>}
          {!isRentInvoice && <div className="summary-item"><span>Mois de facture</span><strong>{issueMonthLabel}</strong></div>}
          {isRentInvoice && <div className="summary-item"><span>Annee du loyer</span><strong>{billingYear}</strong></div>}
          {!isRentInvoice && <div className="summary-item"><span>Annee de facture</span><strong>{issueYearLabel}</strong></div>}
          <div className="summary-item"><span>Email</span><strong>{deliveryStatus(invoice.email_delivery_status)}</strong></div>
          <div className="summary-item"><span>WhatsApp</span><strong>{deliveryStatus(invoice.whatsapp_delivery_status)}</strong></div>
          {isRentInvoice && <div className="summary-item summary-item-wide"><span>Periode facturee</span><strong>{periodLabel(billingMonth, billingYear)}</strong></div>}
          <div className="summary-item summary-item-wide"><span>Origine</span><strong>{invoice.generated_automatically ? 'Generation automatique de fin de mois' : 'Creation manuelle'}</strong></div>
        </div>

        <div className="invoice-parties">
          <div>
            <span>Locataire</span>
            <strong>{invoice.tenant_name || `${invoice.first_name} ${invoice.last_name}`}</strong>
            <p>Telephone: {invoice.phone || '-'}</p>
            <p>Email: {invoice.email || '-'}</p>
            <p>Reference client: CL-{String(invoice.tenant_id ?? invoice.id).padStart(4, '0')}</p>
            <p>Type: {invoice.tenant_type === 'COMPANY' ? 'Societe' : 'Personne physique'}</p>
          </div>
          <div>
            <span>Appartement</span>
            <strong>{invoice.unit_number}</strong>
            <p>Bail: {invoice.lease_id ? formatLeaseReference(invoice.lease_number, invoice.lease_id) : '-'}</p>
            <p>Immeuble: {invoice.building_name}</p>
            <p>Appartement: {invoice.unit_number}</p>
            <p>Adresse: {invoice.building_address}, {invoice.building_city}</p>
          </div>
        </div>

        <table>
          <thead><tr><th>Description</th><th className="right">Montant</th></tr></thead>
          <tbody>{invoice.items.map((item) => <tr key={item.id}><td>{itemLabel(item.description)}</td><td className="right">{money(item.amount)}</td></tr>)}</tbody>
          <tfoot>
            {Number(invoice.discount_amount ?? 0) > 0 && <tr><td>Remise</td><td className="right">- {money(invoice.discount_amount)}</td></tr>}
            <tr><td>Total</td><td className="right">{money(invoice.total)}</td></tr>
          </tfoot>
        </table>

        {invoice.public_notes && <p className="thanks">{invoice.public_notes}</p>}
        <p className="thanks">Merci pour votre confiance.</p>
      </article>

      <details className="detail-section no-print invoice-collapsible">
        <summary>Informations complementaires</summary>
        <div className="invoice-accordion-grid">
          <details>
            <summary>Paiements ({invoice.payments.length})</summary>
            <div className="compact-list">
              {!!invoice.payments?.length && invoice.payments.map((payment) => (
                <div className="compact-item" key={payment.id}>
                  <span>{payment.receipt_number ?? 'Recu'} - {shortDate(payment.payment_date)} - {paymentMethodLabel(payment.payment_method)}</span>
                  <strong>{money(payment.amount)}</strong>
                </div>
              ))}
              {!invoice.payments.length && <div className="compact-empty">Aucun paiement enregistre.</div>}
            </div>
          </details>
          <details>
            <summary>Relances ({invoice.reminders.length})</summary>
            <div className="compact-list">
              {!!invoice.reminders.length && invoice.reminders.map((reminder) => (
                <div className="compact-item" key={reminder.id}>
                  <span>Relance {channelLabel(reminder.channel)} - {shortDate(reminder.reminded_at)}</span>
                  <strong>{reminder.status}</strong>
                </div>
              ))}
              {!invoice.reminders.length && <div className="compact-empty">Aucune relance enregistree.</div>}
            </div>
          </details>
          <details>
            <summary>Envois ({sendHistoryCount})</summary>
            <div className="compact-list">
              <div className="compact-item">
                <span>Email courant</span>
                <strong>{deliveryStatus(invoice.email_delivery_status)}</strong>
              </div>
              <div className="compact-item">
                <span>WhatsApp courant</span>
                <strong>{deliveryStatus(invoice.whatsapp_delivery_status)}</strong>
              </div>
              {invoice.email_logs?.map((log) => (
                <div className="compact-item" key={`email-${log.id}`}>
                  <span>Email - {shortDate(log.sent_at || log.created_at)} - {log.recipient}</span>
                  <strong>{deliveryStatus(log.status)}</strong>
                </div>
              ))}
              {invoice.whatsapp_logs?.map((log) => (
                <div className="compact-item" key={`wa-${log.id}`}>
                  <span>WhatsApp - {shortDate(log.sent_at || log.created_at)} - {log.recipient}</span>
                  <strong>{deliveryStatus(log.status)}</strong>
                </div>
              ))}
              {!sendHistoryCount && <div className="compact-empty">Aucun envoi enregistre.</div>}
            </div>
          </details>
          <details>
            <summary>Documents ({documents.filter((document) => document.exists).length})</summary>
            <div className="compact-list">
              {documents.map((document) => (
                <div className="compact-item" key={document.name}>
                  <span>{document.name}</span>
                  <strong>{document.exists ? <button type="button" className="link-button" onClick={() => openOrDownloadDocument({ fileName: document.fileName, fileUrl: document.fileUrl, title: document.name, context: `Facture ${invoice.invoice_number}` })}>{document.detail}</button> : 'Non disponible'}</strong>
                </div>
              ))}
              {invoice.internal_notes && <div className="compact-item"><span>Notes internes</span><strong>{invoice.internal_notes}</strong></div>}
            </div>
          </details>
          <details>
            <summary>Timeline ({timeline.length + schedule.length + (invoice.automation_run ? 1 : 0)})</summary>
            <div className="compact-list">
              {invoice.automation_run ? (
                <div className="compact-item">
                  <span>Automatisation #{invoice.automation_run.id}</span>
                  <strong>{invoice.automation_run.status}</strong>
                </div>
              ) : null}
              {[...timeline, ...schedule.map((row) => ({ Date: row.Date, Evenement: row.Etape, Description: row.Statut }))].map((row, index) => (
                <div className="compact-item" key={index}>
                  <span>{row.Date} - {row.Evenement}</span>
                  <strong>{row.Description}</strong>
                </div>
              ))}
            </div>
          </details>
        </div>
      </details>

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
                <select value={item.item_type} onChange={(event) => setEditLines((lines) => lines.map((line, i) => i === index ? { ...line, item_type: event.target.value } : line))}>{lineTypes.map((type) => <option key={type} value={type}>{itemLabel(type)}</option>)}</select>
                <input type="number" step="0.01" value={item.amount} onChange={(event) => setEditLines((lines) => lines.map((line, i) => i === index ? { ...line, amount: Number(event.target.value) } : line))} required />
                <button type="button" className="icon-btn danger" onClick={() => setEditLines((lines) => lines.filter((_, i) => i !== index))}><X size={16} /></button>
              </div>
            ))}
            <button type="button" className="secondary" onClick={() => setEditLines([...editLines, { item_type: 'Other', description: 'Other', amount: 0 }])}><Plus size={16} />Ajouter un item</button>
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
          <form className="form-grid payment-modal" onSubmit={(event) => { event.preventDefault(); void pay(new FormData(event.currentTarget)); }}>
            <div className="detail-section compact-modal-section">
              <summary>Informations paiement</summary>
              <div className="lease-section-grid">
                <label>
                  Mode de règlement
                  <select
                    name="payment_currency"
                    value={paymentCurrency}
                    onChange={(event) => {
                      const next = event.target.value as 'USD' | 'CDF' | 'MIXED';
                      setPaymentCurrency(next);
                      if (next === 'USD') {
                        setUsdAmount(String(Number(invoice.remaining_amount ?? 0).toFixed(2)));
                        setCdfAmount('');
                      }
                      if (next === 'CDF') {
                        setUsdAmount('');
                      }
                    }}
                  >
                    <option value="USD">USD uniquement</option>
                    <option value="CDF">CDF uniquement</option>
                    <option value="MIXED">Mixte USD + CDF</option>
                  </select>
                </label>
                <label>
                  Facture
                  <input
                    readOnly
                    className="locked-field"
                    value={`${invoice.invoice_number} | ${invoice.tenant_name || `${invoice.first_name} ${invoice.last_name}`} | ${invoice.unit_number ?? '-'} | Facture: ${money(invoice.total)} USD | Payé: ${money(invoice.paid_amount)} USD | Reste: ${money(invoice.remaining_amount)} USD`}
                  />
                </label>
                <label>Locataire<input readOnly className="locked-field" value={invoice.tenant_name || `${invoice.first_name} ${invoice.last_name}`} /></label>
                <label>Bail<input readOnly className="locked-field" value={invoice.lease_id ? formatLeaseReference(invoice.lease_number, invoice.lease_id) : '-'} /></label>
                <label>Appartement<input readOnly className="locked-field" value={invoice.unit_number ?? '-'} /></label>
              </div>
            </div>
            <div className="detail-section compact-modal-section">
              <summary>Paiement</summary>
              <div className="lease-section-grid">
                <label>Date<input name="payment_date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
                <label>Montant USD<input name="amount_usd" type="number" step="0.01" min="0" value={paymentCurrency === 'CDF' ? '' : usdAmount} onChange={(event) => setUsdAmount(event.target.value)} disabled={paymentCurrency === 'CDF'} /></label>
                <label>Montant CDF<input name="amount_cdf" type="number" step="1" min="0" value={paymentCurrency === 'USD' ? '' : cdfAmount} onChange={(event) => setCdfAmount(event.target.value)} disabled={paymentCurrency === 'USD'} /></label>
                <label>Taux appliqué<input name="exchange_rate_used" type="number" step="0.000001" min="0" defaultValue={exchangeRate?.rate ?? ''} /></label>
                <label>Équivalent USD du CDF<input readOnly className="locked-field" value={exchangeRate?.rate && cdfAmount ? money(Number(cdfAmount || 0) / Number(exchangeRate.rate)) : money(0)} /></label>
                <label>Total équivalent USD<input name="amount" type="number" readOnly className="locked-field" value={Number(
                  (
                    paymentCurrency === 'USD'
                      ? Number(usdAmount || 0)
                      : paymentCurrency === 'CDF'
                        ? (exchangeRate?.rate && cdfAmount ? Number(cdfAmount || 0) / Number(exchangeRate.rate) : 0)
                        : Number(usdAmount || 0) + (exchangeRate?.rate && cdfAmount ? Number(cdfAmount || 0) / Number(exchangeRate.rate) : 0)
                  ).toFixed(2),
                )} /></label>
                <label>Mode de paiement<select name="payment_method"><option value="CASH">{paymentMethodLabel('CASH')}</option><option value="BANK">{paymentMethodLabel('BANK')}</option><option value="MOBILE_MONEY">{paymentMethodLabel('MOBILE_MONEY')}</option></select></label>
                <label>Reference<input name="reference" placeholder="Reference" /></label>
              </div>
            </div>
            <div className="detail-section compact-modal-section">
              <summary>Informations complementaires</summary>
              <div className="lease-section-grid">
                <label>Banque / payeur<input name="payer_name" placeholder="Banque / payeur" /></label>
                <label>Numero transaction<input name="transaction_number" placeholder="Numero transaction" /></label>
                <label>Cheque<input name="check_number" placeholder="Cheque" /></label>
                <label>Observations<textarea name="notes" rows={2} placeholder="Observations" /></label>
                <input type="hidden" name="exchange_rate_date" value={exchangeRate?.effectiveDate ?? new Date().toISOString().slice(0, 10)} />
              </div>
            </div>
            {paymentError ? <div className="error-message">{paymentError}</div> : null}
            <button disabled={paymentSubmitting}>{paymentSubmitting ? 'Enregistrement...' : 'Enregistrer le paiement'}</button>
          </form>
        </Modal>
      )}
    </section>
  );
}

function apiErrorMessage(error: unknown) {
  const response = (error as { response?: { data?: { message?: unknown } } })?.response;
  const message = response?.data?.message;
  if (Array.isArray(message)) return message.filter(Boolean).map(String).join(' ');
  if (typeof message === 'string' && message.trim()) return message;
  if (message != null) return String(message);
  return 'Impossible de charger la facture.';
}

function monthLabel(month: number) {
  return ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'][Number(month) - 1] ?? String(month ?? '-');
}

function issueDateMonthLabel(value?: string) {
  const parsed = parseDateParts(value);
  if (!parsed) return '-';
  return monthLabel(parsed.month);
}

function issueDateYearLabel(value?: string) {
  const parsed = parseDateParts(value);
  if (!parsed) return '-';
  return String(parsed.year);
}

function issueDateMonthYearLabel(value?: string) {
  const parsed = parseDateParts(value);
  if (!parsed) return '-';
  return `${monthLabel(parsed.month)} ${parsed.year}`;
}

function parseDateParts(value?: string) {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function cleanPrintValue(value?: string | null) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed || trimmed.toLowerCase() === 'null' || trimmed.toLowerCase() === 'undefined') {
    return '';
  }
  return trimmed;
}

function isTitleOnlyInvoiceHeaderOrganization(slug?: string | null) {
  return ['catalyse', 'magic-construction'].includes(String(slug ?? '').trim().toLowerCase());
}

function companyDisplayName(companySettings?: CompanySettingsHeader | null, organizationName?: string) {
  return (
    cleanPrintValue(companySettings?.company_legal_name)
    || cleanPrintValue(companySettings?.company_name)
    || cleanPrintValue(companySettings?.company_legal_name_resolved)
    || cleanPrintValue(companySettings?.legal_name)
    || cleanPrintValue(organizationName)
  );
}

function companyAddressLine(companySettings?: CompanySettingsHeader | null) {
  return cleanPrintValue(companySettings?.company_address) || cleanPrintValue(companySettings?.company_address_resolved) || cleanPrintValue(companySettings?.address);
}

function companyContactLine(companySettings?: CompanySettingsHeader | null) {
  const parts = [cleanPrintValue(companySettings?.phone), cleanPrintValue(companySettings?.email)].filter(Boolean);
  return parts.join(' | ');
}

function companyInitials(companySettings?: CompanySettingsHeader | null, organizationName?: string) {
  const label = companyDisplayName(companySettings, organizationName);
  if (!label) return '—';
  const parts = label.split(/\s+/).filter(Boolean).slice(0, 2);
  const initials = parts.map((part) => part[0]?.toUpperCase() ?? '').join('');
  return initials || label.slice(0, 2).toUpperCase();
}

function amount(value: unknown) {
  return Number(value ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}

function invoiceTypeLabel(type?: string) {
  const normalized = String(type ?? 'OTHER').toUpperCase();
  if (normalized === 'RENT') return 'Facture de loyer';
  return 'Facture autres charges';
}

function deliveryStatus(status?: string) {
  return String(status ?? 'NON ENVOYE').toUpperCase();
}

function displayStatusLabel(status: string) {
  return ({ PAID: 'Payee', PARTIAL: 'Paiement partiel', UNPAID: 'Non payee', OVERDUE: 'En retard', DRAFT: 'Brouillon', CANCELLED: 'Annulee' } as Record<string, string>)[status] ?? status;
}

function clientInvoiceStatusLabel(status: string) {
  return ({
    PAID: 'Facture acquittée',
    PARTIAL: 'Paiement partiel',
    UNPAID: 'À payer',
    OVERDUE: 'En retard',
    DRAFT: 'Brouillon',
    CANCELLED: 'Annulée',
  } as Record<string, string>)[status] ?? status;
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

function invoiceDocuments(invoice: Invoice) {
  const reference = invoice.lease_id ? formatLeaseReference(invoice.lease_number, invoice.lease_id) : '';
  return [
    { name: 'Facture PDF', exists: true, detail: `Facture_${invoice.invoice_number}.pdf`, fileName: `Facture_${invoice.invoice_number}.pdf`, fileUrl: '' },
    { name: 'Piece jointe', exists: Boolean(invoice.attachment_file_name && invoice.attachment_file_url), detail: invoice.attachment_file_name ?? 'Non disponible', fileName: invoice.attachment_file_name ?? '', fileUrl: invoice.attachment_file_url ?? '' },
    { name: 'Contrat lie', exists: Boolean(invoice.lease_id), detail: reference || 'Non disponible', fileName: reference, fileUrl: '' },
    { name: 'Documents bail', exists: Boolean(invoice.lease_id), detail: invoice.lease_id ? 'Voir bail lie' : 'Non disponible', fileName: reference ? `Documents_bail_${reference}` : '', fileUrl: '' },
  ];
}

function invoiceTimeline(invoice: Invoice) {
  return [
    { Date: shortDate(invoice.issue_date), Evenement: 'Creation', Description: invoice.invoice_number, Utilisateur: 'Systeme' },
    { Date: shortDate(invoice.issue_date), Evenement: 'Validation', Description: displayStatusLabel(invoice.status), Utilisateur: 'Systeme' },
    { Date: shortDate(invoice.due_date), Evenement: 'Echeance', Description: displayStatusLabel(invoiceDisplayStatus(invoice.status, invoice.due_date)), Utilisateur: 'Systeme' },
    ...invoice.payments.map((payment) => ({ Date: shortDate(payment.payment_date), Evenement: Number(invoice.remaining_amount) > 0 ? 'Paiement partiel' : 'Paiement', Description: `${paymentMethodLabel(payment.payment_method)} - ${money(payment.amount)}`, Utilisateur: payment.created_by ? `Utilisateur #${payment.created_by}` : 'Systeme' })),
    ...invoice.reminders.map((reminder) => ({ Date: shortDate(reminder.reminded_at), Evenement: `Relance ${channelLabel(reminder.channel)}`, Description: reminder.status, Utilisateur: reminder.reminded_by ? `Utilisateur #${reminder.reminded_by}` : 'Systeme' })),
  ].sort((a, b) => new Date(toIsoDate(b.Date)).getTime() - new Date(toIsoDate(a.Date)).getTime());
}

function exportInvoiceExcel(invoice: Invoice, stats: ReturnType<typeof invoiceStats>, risk: ReturnType<typeof invoiceRisk>, timeline: ReturnType<typeof invoiceTimeline>, schedule: ReturnType<typeof reminderSchedule>, documents: ReturnType<typeof invoiceDocuments>) {
  exportXlsxWorkbook(`Facture_${invoice.invoice_number}.xlsx`, [
    { name: 'Resume', rows: [{ facture: invoice.invoice_number, statut: displayStatusLabel(invoiceDisplayStatus(invoice.status, invoice.due_date)), total: amount(invoice.total), paye: amount(invoice.paid_amount), restant: amount(invoice.remaining_amount), devise: 'USD', risque: risk.level, probabilite_recouvrement: `${risk.probability}%` }] },
    { name: 'Informations', rows: [{ numero: invoice.invoice_number, emission: shortDate(invoice.issue_date), echeance: shortDate(invoice.due_date), periode: periodLabel(invoice.month, invoice.year), remise: amount(invoice.discount_amount), notes_visibles: invoice.public_notes ?? '', notes_internes: invoice.internal_notes ?? '', piece_jointe: invoice.attachment_file_name ?? '' }] },
    { name: 'Locataire', rows: [{ nom: invoice.tenant_name || `${invoice.first_name} ${invoice.last_name}`, telephone: invoice.phone, email: invoice.email }] },
    { name: 'Bail', rows: [{ bail: invoice.lease_id ? formatLeaseReference(invoice.lease_number, invoice.lease_id) : '', debut: invoice.lease_start_date ? shortDate(invoice.lease_start_date) : '', fin: invoice.lease_end_date ? shortDate(invoice.lease_end_date) : '' }] },
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

function inferInvoiceItemType(description: string) {
  if (!description) return 'Other';
  if (description === 'Monthly rent' || description.startsWith('Loyer ')) return 'Monthly rent';
  if (description === 'Syndic' || description.startsWith('Syndic ')) return 'Syndic';
  return lineTypes.find((type) => type === description) ?? 'Other';
}

function buildInvoiceLineDescription(itemType: string, month: number, year: number) {
  if (itemType === 'Monthly rent') return `Loyer ${monthLabel(month).toLowerCase()} ${year}`;
  if (itemType === 'Syndic') return `Syndic ${monthLabel(month).toLowerCase()} ${year}`;
  return itemLabel(itemType);
}
