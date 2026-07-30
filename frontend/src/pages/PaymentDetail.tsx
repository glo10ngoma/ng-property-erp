import { ArrowLeft, FileSpreadsheet, Mail, MessageCircle, Pencil, Printer, Smartphone, Trash2, Wallet } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, exportXlsxWorkbook, money, paymentMethodLabel, shortDate } from '../api';
import { useAuth } from '../auth';
import { DocumentEmailModal, Modal, SuccessMessage } from '../components';
import { formatLeaseReference } from '../utils/lease-reference';
import { getPaymentsBranding } from '../core/utils/payments-branding';

type PaymentDetailData = {
  id: number;
  organization_id?: number;
  invoice_id?: number;
  invoice_number?: string;
  invoice_type?: string;
  payment_type?: string;
  lease_guarantee_id?: number;
  cash_movement_id?: number;
  invoice_status?: string;
  payment_date: string;
  amount: number;
  payment_method: string;
  reference?: string;
  notes?: string;
  receipt_number?: string;
  payer_name?: string;
  currency?: string;
  amount_usd?: number;
  amount_cdf?: number;
  exchange_rate_used?: number;
  exchange_rate_date?: string;
  cdf_equivalent_usd?: number;
  total_equivalent_usd?: number;
  tenant_name?: string;
  tenant_type?: string;
  tenant_phone?: string;
  tenant_secondary_phone?: string;
  tenant_email?: string;
  company_name?: string;
  rccm?: string;
  tax_number?: string;
  business_sector?: string;
  unit_number?: string;
  unit_status?: string;
  monthly_rent?: number;
  building_name?: string;
  building_address?: string;
  building_city?: string;
  building_commune?: string;
  lease_id?: number;
  lease_number?: number;
  lease_start_date?: string;
  lease_end_date?: string;
  lease_status?: string;
  invoice_total?: number;
  guarantee_amount?: number;
  guarantee_paid_amount?: number;
  guarantee_status?: string;
  tenant_credit_id?: number;
  tenant_credit_currency?: string;
  tenant_credit_original_amount?: number;
  tenant_credit_remaining_amount?: number;
  tenant_credit_status?: string;
  created_by_user_id?: number;
  created_by_name?: string;
  allocations?: { id: number; invoice_id: number; invoice_number: string; amount: number }[];
  reminders?: { id: number; channel: string; message: string; status: string; reminded_at: string; reminded_by?: number }[];
  audit?: { id: number; date: string; action: string; resource: string; method: string; path: string; status_code?: number; metadata?: Record<string, unknown>; user_name?: string }[];
};

const CUSTOM_RECEIPT_ORGANIZATION_IDS = new Set([1, 5]);

export function PaymentDetail() {
  const { can } = useAuth();
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const trashScope = searchParams.get('scope') === 'trash';
  const isTrashMode = trashScope;
  const [payment, setPayment] = useState<PaymentDetailData | null>(null);
  const [success, setSuccess] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);

  const load = async () => {
    if (!id) return;
    const endpoint = trashScope ? `/payments/trash/${id}` : `/payments/${id}`;
    const response = await api.get<PaymentDetailData>(endpoint);
    setPayment(response.data);
  };

  useEffect(() => {
    load();
  }, [id, trashScope]);

  useEffect(() => {
    if (searchParams.get('edit') === '1') setEditOpen(true);
  }, [searchParams]);

  const summary = useMemo(() => {
    if (!payment) return null;
    const totalEquivalent = Number(payment.total_equivalent_usd ?? payment.amount ?? 0);
    const remaining = Math.max(Number(payment.invoice_total ?? totalEquivalent) - totalEquivalent, 0);
    return {
      total: Number(payment.invoice_total ?? totalEquivalent),
      paid: totalEquivalent,
      remaining,
      invoiceStatus: payment.invoice_status ?? 'PAID',
    };
  }, [payment]);
  const useCustomReceipt = payment ? CUSTOM_RECEIPT_ORGANIZATION_IDS.has(Number(payment.organization_id)) : false;
  const paymentsBranding = getPaymentsBranding(payment?.organization_id);
  const receiptTitle = payment ? paymentReceiptTitle(payment, paymentsBranding) : paymentsBranding.receiptTitle;
  const isGuaranteeReceipt = payment ? isGuaranteePayment(payment) : false;
  const isTenantCreditReceipt = payment ? isTenantCreditPayment(payment) : false;
  const displayReference = payment ? displayValue(payment.reference) : '—';
  const displayCreator = payment ? displayValue(payment.created_by_name) : '—';

  async function send(channel: 'EMAIL' | 'SMS' | 'WHATSAPP') {
    if (!payment) return;
    const message = `${payment.tenant_name ?? 'Client'}, votre ${paymentsBranding.moduleSingular.toLowerCase()} ${payment.receipt_number ?? payment.id} a bien été pris en compte.`;
    const title = channel === 'EMAIL' ? 'Email' : channel === 'SMS' ? 'SMS' : 'WhatsApp';
    if (!window.confirm(`Envoyer par ${title} ?`)) return;
    await api.post(`/communications/send-${channel.toLowerCase()}`, {
      to: payment.tenant_email ?? payment.tenant_phone ?? '',
      subject: `${paymentsBranding.moduleSingular} ${payment.receipt_number ?? payment.id}`,
      message,
      related_entity_type: 'payments',
      related_entity_id: payment.id,
    });
    setSuccess(`${title} envoyé avec succès.`);
  }

  async function saveEdit(form: FormData) {
    if (!payment) return;
    await api.put(`/payments/${payment.id}`, {
      invoice_id: payment.invoice_id,
      payment_date: form.get('payment_date'),
      amount: Number(form.get('amount')),
      payment_method: form.get('payment_method'),
      reference: form.get('reference'),
      notes: form.get('notes'),
    });
    setEditOpen(false);
    setSearchParams({});
    setSuccess('Paiement modifié avec succès.');
    await load();
  }

  async function refund() {
    if (!payment) return;
    if (!window.confirm('Rembourser ce paiement ?')) return;
    await api.post('/cash/movements', {
      type: 'OUT',
      category: 'PAYMENT_REFUND',
      amount: Number(payment.amount),
      payment_id: payment.id,
      invoice_id: payment.invoice_id,
      tenant_id: payment.invoice_id ? undefined : undefined,
      description: `Remboursement paiement ${payment.receipt_number ?? payment.id}`,
      reference: payment.reference ?? payment.receipt_number ?? `PAY-${payment.id}`,
    });
    setSuccess('Remboursement enregistré.');
  }

  async function deletePayment(reason: string) {
    if (!payment) return;
    await api.delete(`/payments/${payment.id}`, { data: { reason } });
    navigate('/payments');
  }

  async function sendDocumentEmail(payload: { recipient: string; cc: string; subject: string; message: string }) {
    if (!payment) return;
    setEmailSending(true);
    setEmailError('');
    try {
      await api.post('/communications/send-document', {
        documentType: 'PAYMENT_RECEIPT',
        documentId: payment.id,
        to: payload.recipient,
        cc: payload.cc,
        subject: payload.subject,
        message: payload.message,
      });
      setEmailOpen(false);
      setSuccess('Reçu envoyé par email avec succès.');
    } catch (error: any) {
      setEmailError(String(error?.response?.data?.message ?? error?.message ?? 'Impossible d’envoyer le reçu.'));
    } finally {
      setEmailSending(false);
    }
  }

  if (!payment) return <div className="empty">Chargement du paiement...</div>;

  return (
    <section>
      <div className="page-header no-print">
        <h2>Fiche {paymentsBranding.moduleSingular.toLowerCase()}</h2>
        <div className="actions invoice-detail-actions">
          <button className="secondary" onClick={() => navigate('/payments')}><ArrowLeft size={16} />Retour</button>
          {can('payments.update') && !isTrashMode && !isGuaranteeReceipt && !isTenantCreditReceipt && <button onClick={() => setEditOpen(true)}><Pencil size={16} />Modifier</button>}
          <button onClick={() => window.print()}><Printer size={16} />Imprimer le reçu</button>
          <button className="secondary" onClick={() => window.print()}><FileSpreadsheet size={16} />PDF</button>
          {can('communication.send') && !isTrashMode && <button className="secondary" onClick={() => setEmailOpen(true)}><Mail size={16} />Envoyer le reçu</button>}
          {can('communication.send') && !isTrashMode && <button className="secondary" onClick={() => send('WHATSAPP')}><MessageCircle size={16} />WhatsApp</button>}
          {can('communication.send') && !isTrashMode && <button className="secondary" onClick={() => send('EMAIL')}><Mail size={16} />Email</button>}
          {can('communication.send') && !isTrashMode && <button className="secondary" onClick={() => send('SMS')}><Smartphone size={16} />SMS</button>}
          <button className="secondary" onClick={() => exportPaymentExcel(payment)}>Excel</button>
          {can('payments.update') && !isTrashMode && !isGuaranteeReceipt && !isTenantCreditReceipt && <button className="secondary" onClick={refund}><Wallet size={16} />Rembourser</button>}
          {can('payments.delete') && !isTrashMode && !isGuaranteeReceipt && !isTenantCreditReceipt && <button className="secondary danger" onClick={() => setDeleteOpen(true)}><Trash2 size={16} />Annuler</button>}
        </div>
      </div>

      <SuccessMessage message={success} />

      <article className="print-invoice">
        <header className={useCustomReceipt ? 'receipt-header-custom' : undefined}>
          {useCustomReceipt ? (
            <div className="receipt-title-block">
              <h2>{receiptTitle}</h2>
            </div>
          ) : (
            <>
          <div className="invoice-logo">PE</div>
          <div>
            <h2>NG Property ERP</h2>
            <p>{paymentsBranding.receiptTitle}</p>
            <p>Merci pour votre confiance.</p>
          </div>
            </>
          )}
          <div className="invoice-meta">
            <strong>Reçu {payment.receipt_number ?? `PAY-${payment.id}`}</strong>
            <span>{paymentSubjectLabel(payment)}</span>
            <span>Date: {shortDate(payment.payment_date)}</span>
            <span>Mode: {paymentMethodLabel(payment.payment_method)}</span>
            <span className={`badge ${(payment.invoice_status ?? 'PAID').toLowerCase()}`}>{statusLabel(payment.invoice_status ?? 'PAID')}</span>
          </div>
        </header>

        <div className="receipt-amount-summary">
          <div><span>Montant payé (USD)</span><strong>{money(payment.amount_usd ?? payment.amount)}</strong></div>
          <div><span>Montant payé (CDF)</span><strong>{Number(payment.amount_cdf ?? 0).toLocaleString('fr-FR')} CDF</strong></div>
          <div><span>Équivalent total (USD)</span><strong>{money(summary?.paid ?? 0)}</strong></div>
        </div>

        <div className="invoice-parties">
          <div>
            <span>Locataire</span>
            <strong>{payment.tenant_name ?? '-'}</strong>
            <p>Type: {payment.tenant_type === 'COMPANY' ? 'Société' : 'Personne physique'}</p>
            <p>Téléphone: {payment.tenant_phone || '-'}</p>
            <p>Email: {payment.tenant_email || '-'}</p>
            <p>Référence client: {payment.payer_name || '-'}</p>
            <p>Taux appliqué: {payment.exchange_rate_used ? `1 USD = ${money(payment.exchange_rate_used)} CDF` : '-'}</p>
          </div>
          <div>
            <span>Appartement</span>
            <strong>{payment.unit_number || '-'}</strong>
            <p>Immeuble: {payment.building_name || '-'}</p>
            <p>Adresse: {payment.building_address || '-'}, {payment.building_city || '-'}</p>
            <p>Bail: {payment.lease_id ? formatLeaseReference(payment.lease_number, payment.lease_id) : '-'}</p>
            {!useCustomReceipt && <p>Loyer contractuel: {payment.monthly_rent ? money(payment.monthly_rent) : '-'}</p>}
          </div>
        </div>

        <table>
          <thead><tr><th>Référence</th><th>Facture</th><th>Mode</th><th className="right">Montant</th><th>Devise</th><th>Utilisateur</th></tr></thead>
        <tbody>
            <tr>
              <td>{displayReference}</td>
              <td>{paymentSubjectLabel(payment)}</td>
              <td>{paymentMethodLabel(payment.payment_method)}</td>
              <td className="right">{money(payment.amount)}</td>
              <td>USD</td>
              <td>{displayCreator}</td>
            </tr>
          </tbody>
        </table>

        {payment.notes && <p className="thanks">{payment.notes}</p>}
        <p className="thanks">Merci pour votre confiance.</p>
      </article>

      <DocumentEmailModal
        title={useCustomReceipt ? 'Envoyer le reçu d’encaissement par email' : 'Envoyer le reçu par email'}
        open={emailOpen}
        defaultRecipient={payment.tenant_email ?? ''}
        defaultSubject={useCustomReceipt ? 'Votre reçu d’encaissement' : 'Votre reçu de paiement'}
        defaultMessage={`Bonjour ${payment.tenant_name ?? ''},\n\nVeuillez trouver ci-joint votre ${useCustomReceipt ? 'reçu d’encaissement' : 'reçu de paiement'}.\n\nCordialement.`}
        attachmentName={payment.receipt_number ? `Recu_${payment.receipt_number}.pdf` : 'Recu.pdf'}
        sending={emailSending}
        error={emailError}
        onClose={() => {
          setEmailOpen(false);
          setEmailError('');
        }}
        onSubmit={sendDocumentEmail}
      />

      <div className="invoice-accordion-grid no-print">
        <details open={false}><summary>Informations generales</summary><SimpleBlock rows={generalRows(payment)} /></details>
        <details open={false}><summary>Facture liee</summary><SimpleBlock rows={invoiceRows(payment)} /></details>
        <details open={false}><summary>Timeline</summary><SimpleBlock rows={timelineRows(payment)} /></details>
        <details open={false}><summary>Documents</summary><SimpleBlock rows={documentRows(payment)} /></details>
        <details open={false}><summary>Historique modifications</summary><SimpleBlock rows={auditRows(payment)} /></details>
        <details open={false}><summary>{paymentsBranding.modulePlural} liés ({payment.allocations?.length ?? 0})</summary><SimpleBlock rows={(payment.allocations ?? []).map((allocation) => ({ Reference: allocation.invoice_number, Montant: money(allocation.amount), Devise: 'USD' }))} /></details>
        <details open={false}><summary>Relances ({payment.reminders?.length ?? 0})</summary><SimpleBlock rows={(payment.reminders ?? []).map((reminder) => ({ Date: shortDate(reminder.reminded_at), Canal: reminder.channel, Statut: reminder.status, Message: reminder.message }))} /></details>
      </div>

      {editOpen && (
        <Modal title={`Modifier ${paymentsBranding.moduleSingular.toLowerCase()}`} onClose={() => { setEditOpen(false); setSearchParams({}); }}>
          <form className="form-grid" onSubmit={(event) => { event.preventDefault(); saveEdit(new FormData(event.currentTarget)); }}>
            <label>Date<input name="payment_date" type="date" defaultValue={payment.payment_date.slice(0, 10)} /></label>
            <label>Montant<input name="amount" type="number" step="0.01" defaultValue={payment.amount} /></label>
            <label>Mode de paiement<select name="payment_method" defaultValue={payment.payment_method}><option value="CASH">Espèces</option><option value="BANK">Banque</option><option value="MOBILE_MONEY">Mobile Money</option></select></label>
            <label>Référence<input name="reference" defaultValue={payment.reference ?? ''} /></label>
            <label>Observations<textarea name="notes" defaultValue={payment.notes ?? ''} /></label>
            <button type="submit">Enregistrer</button>
          </form>
        </Modal>
      )}
      {deleteOpen ? (
        <PaymentDeleteModal
          payment={payment}
          onClose={() => setDeleteOpen(false)}
          onConfirm={async (reason) => {
            await deletePayment(reason);
            setDeleteOpen(false);
          }}
        />
      ) : null}
    </section>
  );
}

function PaymentDeleteModal({
  payment,
  onClose,
  onConfirm,
}: {
  payment: PaymentDetailData;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setError('Le motif de suppression est obligatoire.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await onConfirm(trimmedReason);
    } catch (nextError: any) {
      setError(String(nextError?.response?.data?.message ?? nextError?.message ?? 'Impossible de supprimer ce paiement.'));
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
  }

  return (
    <Modal title="Mettre le paiement dans la corbeille" onClose={onClose}>
      <div className="modal-section">
        <h3>Impact</h3>
        <p>Cette suppression placera le paiement et les mouvements liés dans la corbeille, puis recalculera la facture associée.</p>
        <div className="mini-stats">
          <div className="mini-stat"><span>Reçu</span><strong>{payment.receipt_number ?? `PAY-${payment.id}`}</strong></div>
          <div className="mini-stat"><span>Facture</span><strong>{payment.invoice_number ?? '-'}</strong></div>
          <div className="mini-stat"><span>Date</span><strong>{shortDate(payment.payment_date)}</strong></div>
          <div className="mini-stat"><span>Montant</span><strong>{money(payment.amount)}</strong></div>
        </div>
        <label className="form-field-full">
          Motif de suppression *
          <textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ex. mauvaise facture sélectionnée" />
        </label>
        {error ? <div className="error-message">{error}</div> : null}
      </div>
      <div className="modal-footer-sticky">
        <button type="button" className="secondary" onClick={onClose} disabled={submitting}>Annuler</button>
        <button type="button" className="danger" onClick={() => void submit()} disabled={submitting}>
          {submitting ? 'Suppression...' : 'Mettre dans la corbeille'}
        </button>
      </div>
    </Modal>
  );
}

function exportPaymentExcel(payment: PaymentDetailData) {
  exportXlsxWorkbook(`Paiement_${payment.receipt_number ?? payment.id}.xlsx`, [
    { name: 'Resume', rows: [{ reference: payment.receipt_number ?? `PAY-${payment.id}`, facture: paymentSubjectLabel(payment), date: shortDate(payment.payment_date), mode: paymentMethodLabel(payment.payment_method), montant: money(payment.amount), devise: 'USD', statut: statusLabel(payment.invoice_status ?? 'PAID') }] },
    { name: 'Informations paiement', rows: [paymentInfo(payment)] },
    { name: 'Facture', rows: [{ numero: payment.invoice_number, statut: payment.invoice_status ?? 'PAID', total: money(payment.invoice_total ?? payment.amount), montant_paye: money(payment.amount), reste: money(Math.max(Number(payment.invoice_total ?? payment.amount) - Number(payment.amount), 0)), devise: 'USD' }] },
    { name: 'Locataire', rows: [tenantInfo(payment)] },
    { name: 'Appartement', rows: [unitInfo(payment)] },
    { name: 'Bail', rows: [leaseInfo(payment)] },
    { name: 'Historique', rows: payment.audit ?? [] },
    { name: 'Documents', rows: documentRows(payment) },
    { name: 'Timeline', rows: timelineRows(payment) },
    { name: 'Audit', rows: auditRows(payment) },
  ]);
}

function paymentInfo(payment: PaymentDetailData) {
  return {
    reference: displayValue(payment.reference),
    facture: paymentSubjectLabel(payment),
    date: shortDate(payment.payment_date),
    montant: money(payment.amount),
    devise: 'USD',
    mode: paymentMethodLabel(payment.payment_method),
    banque: displayValue(payment.created_by_name),
    notes: payment.notes ?? '',
  };
}

function tenantInfo(payment: PaymentDetailData) {
  return {
    nom: payment.tenant_name ?? '',
    type: payment.tenant_type === 'COMPANY' ? 'Societe' : 'Personne physique',
    telephone: payment.tenant_phone ?? '',
    telephone_secondaire: payment.tenant_secondary_phone ?? '',
    email: payment.tenant_email ?? '',
    rccm: payment.rccm ?? '',
    secteur: payment.business_sector ?? '',
  };
}

function unitInfo(payment: PaymentDetailData) {
  return {
    immeuble: payment.building_name ?? '',
    adresse: payment.building_address ?? '',
    ville: payment.building_city ?? '',
    appartement: payment.unit_number ?? '',
    loyer_contractuel: payment.monthly_rent ? money(payment.monthly_rent) : '',
  };
}

function leaseInfo(payment: PaymentDetailData) {
  return {
    bail: payment.lease_id ? formatLeaseReference(payment.lease_number, payment.lease_id) : '',
    debut: payment.lease_start_date ? shortDate(payment.lease_start_date) : '',
    fin: payment.lease_end_date ? shortDate(payment.lease_end_date) : '',
    statut: payment.lease_status ?? '',
  };
}

function timelineRows(payment: PaymentDetailData) {
  return [
    { Date: shortDate(payment.payment_date), Evenement: 'Paiement', Description: payment.receipt_number ?? payment.id, Utilisateur: displayValue(payment.created_by_name) },
    ...(payment.reminders ?? []).map((reminder) => ({ Date: shortDate(reminder.reminded_at), Evenement: `Relance ${reminder.channel}`, Description: reminder.status, Utilisateur: reminder.reminded_by ? `Utilisateur #${reminder.reminded_by}` : '-' })),
  ];
}

function documentRows(payment: PaymentDetailData) {
  return [
    { Document: 'Recu PDF', Statut: 'Disponible', Detail: payment.receipt_number ? `Recu_${payment.receipt_number}.pdf` : 'Non disponible' },
    { Document: 'Piece jointe', Statut: payment.notes ? 'Disponible' : 'Non disponible', Detail: payment.notes ? 'Voir paiement' : 'Non disponible' },
    { Document: 'Contrat lie', Statut: payment.lease_id ? 'Disponible' : 'Non disponible', Detail: payment.lease_id ? formatLeaseReference(payment.lease_number, payment.lease_id) : 'Non disponible' },
  ];
}

function auditRows(payment: PaymentDetailData) {
  return (payment.audit ?? []).map((row) => ({
    Date: shortDate(row.date),
    Action: row.action,
    Utilisateur: row.user_name ?? '-',
    Statut: row.status_code ?? '-',
  }));
}

function generalRows(payment: PaymentDetailData) {
  return [{
    reference: payment.receipt_number ?? `PAY-${payment.id}`,
    facture: paymentSubjectLabel(payment),
    date: shortDate(payment.payment_date),
    montant: money(payment.amount),
    devise: 'USD',
    mode: paymentMethodLabel(payment.payment_method),
    utilisateur: displayValue(payment.created_by_name),
    observations: payment.notes ?? '-',
  }];
}

function invoiceRows(payment: PaymentDetailData) {
  if (isTenantCreditAllocationPayment(payment)) {
    return [{
      facture: payment.invoice_number ?? 'Facture de loyer',
      statut: 'Réglée par crédit locataire',
      total: money(payment.invoice_total ?? payment.amount),
      paye: money(payment.amount),
      restant: money(Math.max(Number(payment.invoice_total ?? payment.amount) - Number(payment.amount), 0)),
      devise: 'USD',
    }];
  }
  if (isTenantCreditPayment(payment)) {
    return [{
      facture: 'Crédit locataire',
      statut: tenantCreditStatusLabel(payment.tenant_credit_status ?? 'AVAILABLE'),
      total: payment.tenant_credit_currency === 'CDF'
        ? `${Number(payment.tenant_credit_original_amount ?? payment.amount_cdf ?? 0).toLocaleString('fr-FR')} CDF`
        : money(payment.tenant_credit_original_amount ?? payment.amount),
      paye: money(payment.total_equivalent_usd ?? payment.amount),
      restant: payment.tenant_credit_currency === 'CDF'
        ? `${Number(payment.tenant_credit_remaining_amount ?? 0).toLocaleString('fr-FR')} CDF`
        : money(payment.tenant_credit_remaining_amount ?? 0),
      devise: payment.tenant_credit_currency ?? payment.currency ?? 'USD',
    }];
  }
  if (isGuaranteePayment(payment)) {
    return [{
      facture: 'Garantie locative',
      statut: statusLabel(payment.guarantee_status ?? 'PAID'),
      total: money(payment.guarantee_amount ?? payment.amount),
      paye: money(payment.amount),
      restant: money(Math.max(Number(payment.guarantee_amount ?? payment.amount) - Number(payment.guarantee_paid_amount ?? payment.amount), 0)),
      devise: 'USD',
    }];
  }
  return [{
    facture: payment.invoice_number,
    statut: statusLabel(payment.invoice_status ?? 'PAID'),
    total: money(payment.invoice_total ?? payment.amount),
    paye: money(payment.amount),
    restant: money(Math.max(Number(payment.invoice_total ?? payment.amount) - Number(payment.amount), 0)),
    devise: 'USD',
  }];
}

function SimpleBlock({ rows }: { rows: Array<Record<string, unknown>> }) {
  return (
    <div className="compact-list">
      {rows.map((row, index) => (
        <div className="compact-item" key={index}>
          <span>{Object.entries(row).map(([key, value]) => `${label(key)}: ${value ?? '-'}`).join(' | ')}</span>
        </div>
      ))}
      {!rows.length && <div className="compact-empty">Aucune donnée.</div>}
    </div>
  );
}

function label(key: string) {
  return ({ reference: 'Référence', facture: 'Facture', date: 'Date', montant: 'Montant', devise: 'Devise', mode: 'Mode', utilisateur: 'Utilisateur', observations: 'Observations', statut: 'Statut', total: 'Total', paye: 'Payé', restant: 'Restant', nom: 'Nom', type: 'Type', telephone: 'Téléphone', telephone_secondaire: 'Téléphone secondaire', email: 'Email', rccm: 'RCCM', secteur: 'Secteur', immeuble: 'Immeuble', adresse: 'Adresse', ville: 'Ville', appartement: 'Appartement', loyer_contractuel: 'Loyer contractuel', bail: 'Bail', debut: 'Début', fin: 'Fin', action: 'Action', } as Record<string, string>)[key] ?? key;
}

function isGuaranteePayment(payment: PaymentDetailData) {
  return String(payment.payment_type ?? '').toUpperCase() === 'GUARANTEE';
}

function isTenantCreditPayment(payment: PaymentDetailData) {
  return String(payment.payment_type ?? '').toUpperCase() === 'TENANT_CREDIT';
}

function isTenantCreditAllocationPayment(payment: PaymentDetailData) {
  return String(payment.payment_type ?? '').toUpperCase() === 'TENANT_CREDIT_ALLOCATION';
}

function paymentSubjectLabel(payment: PaymentDetailData) {
  if (isTenantCreditAllocationPayment(payment)) return payment.invoice_number ?? '-';
  if (isTenantCreditPayment(payment)) return 'Crédit locataire';
  if (isGuaranteePayment(payment)) return 'Garantie locative';
  return payment.invoice_number ?? '-';
}

function displayValue(value: unknown) {
  const normalized = String(value ?? '').trim();
  return normalized || '—';
}

function paymentReceiptTitle(payment: PaymentDetailData, branding: { receiptPrefix: string }) {
  if (isTenantCreditAllocationPayment(payment)) return 'AFFECTATION CRÉDIT LOCATAIRE';
  if (isGuaranteePayment(payment)) return `${branding.receiptPrefix} GARANTIE`;
  if (isTenantCreditPayment(payment)) return `${branding.receiptPrefix} CRÉDIT LOCATAIRE`;
  if (String(payment.invoice_type ?? '').toUpperCase() === 'OTHER_CHARGE') return `${branding.receiptPrefix} AUTRES CHARGES`;
  return `${branding.receiptPrefix} LOYER`;
}

function tenantCreditStatusLabel(value: string) {
  return ({ AVAILABLE: 'Disponible', PARTIALLY_USED: 'Partiellement utilisé', USED: 'Utilisé', CANCELLED: 'Annulé' } as Record<string, string>)[value] ?? value;
}

function statusLabel(value: string) {
  return ({ PAID: 'Facture acquittée', PARTIAL: 'Paiement partiel', UNPAID: 'À payer', OVERDUE: 'En retard', DRAFT: 'Brouillon', CANCELLED: 'Annulée' } as Record<string, string>)[value] ?? value;
}
