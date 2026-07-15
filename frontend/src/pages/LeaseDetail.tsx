import { ArrowLeft, Download, FileSpreadsheet, Printer, Receipt, RefreshCcw, ScrollText, ShieldCheck, Upload } from 'lucide-react';
import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, exportCsv, exportXlsxWorkbook, money, shortDate, statusLabel } from '../api';
import { EmptyState, Modal, PageHeader, StatusBadge, SuccessMessage } from '../components';
import { useAuth } from '../core/auth/AuthContext';

type Lease = Record<string, any>;

type LeaseContractGeneration = {
  id: number;
  template_version?: number;
  template_code?: string;
  template_hash?: string;
  generated_content?: string;
  generated_html?: string;
  docx_file_name?: string;
  docx_file_url?: string;
  docx_storage_path?: string;
  docx_file_hash?: string;
  docx_mime_type?: string;
  pdf_file_name?: string;
  pdf_file_url?: string;
  signed_contract_file_name?: string;
  signed_contract_file_url?: string;
  generated_at?: string;
  printed_at?: string;
  signed_at?: string;
  status?: string;
};

type LeaseDetailData = Lease & {
  guarantee?: { amount: number; paid_amount: number; status: string; payment_date?: string };
  documents: Array<{ id: number; document_type: string; file_name: string; file_url?: string; uploaded_at?: string }>;
  history: Lease[];
  latest_contract?: LeaseContractGeneration | null;
  active_contract_template_version?: number | null;
};

export function LeaseDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { can } = useAuth();
  const [lease, setLease] = useState<LeaseDetailData | null>(null);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [contractBusy, setContractBusy] = useState(false);
  const [autoPreviewHandled, setAutoPreviewHandled] = useState(false);
  const [signedFileName, setSignedFileName] = useState('');
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState('');

  const previewRequested = useMemo(() => new URLSearchParams(location.search).get('previewContract') === '1', [location.search]);
  const activeTemplateVersion = Number(lease?.active_contract_template_version ?? 0);
  const currentContractVersion = Number(lease?.latest_contract?.template_version ?? 0);
  const contractVersionOutdated = Boolean(lease?.latest_contract && activeTemplateVersion > 0 && currentContractVersion < activeTemplateVersion);
  const canManageLeaseContract = can('documents.upload');
  const canReadLeaseContract = can('documents.read');
  const hasGeneratedDocx = Boolean(lease?.latest_contract?.docx_file_name);
  const hasGeneratedPdf = Boolean(lease?.latest_contract?.pdf_file_name);

  async function load() {
    if (!id) return;
    setLoading(true);
    try {
      const response = await api.get<LeaseDetailData>(`/leases/${id}`);
      setLease(response.data);
      setSignedFileName(response.data.latest_contract?.signed_contract_file_name ?? response.data.signed_contract_file_name ?? '');
      setError('');
    } catch (err: any) {
      const responseMessage = err?.response?.data?.message;
      const message = Array.isArray(responseMessage) ? responseMessage.join(' | ') : responseMessage;
      setError(message || 'Impossible de charger le bail.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!previewOpen || !lease?.latest_contract?.id || !hasGeneratedPdf) {
      if (pdfPreviewUrl) {
        window.URL.revokeObjectURL(pdfPreviewUrl);
        setPdfPreviewUrl('');
      }
      return;
    }
    let cancelled = false;
    const previousUrl = pdfPreviewUrl;
    api.get(`/leases/${lease.id}/contracts/${lease.latest_contract.id}/download`, { responseType: 'blob' })
      .then((response) => {
        if (cancelled) return;
        const nextUrl = window.URL.createObjectURL(response.data);
        setPdfPreviewUrl(nextUrl);
        if (previousUrl) window.URL.revokeObjectURL(previousUrl);
      })
      .catch((err: any) => {
        const responseMessage = err?.response?.data?.message;
        setError(Array.isArray(responseMessage) ? responseMessage.join(' | ') : responseMessage || 'Impossible de charger le PDF.');
      });
    return () => {
      cancelled = true;
    };
  }, [previewOpen, lease?.latest_contract?.id, hasGeneratedPdf]);

  async function loadLatestDocx() {
    if (!id) return null;
    const response = await api.get<LeaseContractGeneration | null>(`/leases/${id}/contracts/latest-docx`);
    const latestDocx = response.data;
    setLease((current) => {
      if (!current) return current;
      const shouldMerge = Boolean(current.latest_contract && latestDocx && current.latest_contract.id === latestDocx.id);
      const nextLatestContract: LeaseContractGeneration | null = shouldMerge && current.latest_contract && latestDocx
        ? { ...current.latest_contract, ...latestDocx }
        : (latestDocx ?? null);
      return {
        ...current,
        latest_contract: nextLatestContract,
      };
    });
    return latestDocx;
  }

  useEffect(() => {
    void load();
  }, [id]);

  useEffect(() => {
    if (!previewRequested || autoPreviewHandled || !lease) return;
    setAutoPreviewHandled(true);
    if (lease.latest_contract && !contractVersionOutdated) {
      setPreviewOpen(true);
      return;
    }
    void generateContract(true);
  }, [previewRequested, autoPreviewHandled, lease?.id, lease?.latest_contract?.id, contractVersionOutdated]);

  async function invoice() {
    if (!lease) return;
    const response = await api.post(`/leases/${lease.id}/invoice`);
    setSuccess(`Facture ${response.data.invoice_number} creee depuis le bail.`);
  }

  async function generateContract(openPreview = false) {
    if (!lease) return;
    setContractBusy(true);
    setError('');
    try {
      const generatedResponse = await api.post<LeaseContractGeneration>(`/leases/${lease.id}/contracts/generate`);
      const generatedContractId = generatedResponse.data?.id;
      await load();
      setSuccess(
        generatedContractId
          ? `Contrat PDF genere avec succes. ID ${generatedContractId}.`
          : 'Contrat genere avec succes.',
      );
      if (openPreview) setPreviewOpen(true);
    } catch (err: any) {
      const responseMessage = err?.response?.data?.message;
      const message = Array.isArray(responseMessage) ? responseMessage.join(' | ') : (responseMessage || err?.message);
      setError(message || 'Impossible de generer le contrat.');
    } finally {
      setContractBusy(false);
    }
  }

  async function markPrinted() {
    if (!lease?.latest_contract) return;
    await api.post(`/leases/${lease.id}/contracts/${lease.latest_contract.id}/printed`);
    await load();
  }

  async function markSigned() {
    if (!lease?.latest_contract) return;
    setContractBusy(true);
    try {
      await api.post(`/leases/${lease.id}/contracts/${lease.latest_contract.id}/sign`);
      await load();
      setSuccess('Contrat marque comme signe.');
    } catch (err: any) {
      const responseMessage = err?.response?.data?.message;
      setError(Array.isArray(responseMessage) ? responseMessage.join(' | ') : responseMessage || 'Impossible de marquer le contrat comme signe.');
    } finally {
      setContractBusy(false);
    }
  }

  async function uploadSignedContract() {
    if (!lease?.latest_contract || !signedFileName.trim()) return;
    setContractBusy(true);
    try {
      await api.post(`/leases/${lease.id}/contracts/${lease.latest_contract.id}/upload-signed`, {
        file_name: signedFileName.trim(),
        file_url: null,
      });
      await load();
      setSuccess('Contrat signe enregistre.');
    } catch (err: any) {
      const responseMessage = err?.response?.data?.message;
      setError(Array.isArray(responseMessage) ? responseMessage.join(' | ') : responseMessage || 'Impossible d enregistrer le contrat signe.');
    } finally {
      setContractBusy(false);
    }
  }

  async function downloadGeneratedPdf() {
    if (!lease?.latest_contract?.id) return;
    await api.post(`/leases/${lease.id}/contracts/${lease.latest_contract.id}/printed`);
    const response = await api.get(`/leases/${lease.id}/contracts/${lease.latest_contract.id}/download`, { responseType: 'blob' });
    const objectUrl = window.URL.createObjectURL(response.data);
    downloadFile(objectUrl, lease.latest_contract.pdf_file_name || `Contrat_bail_${leaseReference(lease)}.pdf`);
    window.URL.revokeObjectURL(objectUrl);
    await load();
  }

  async function downloadGeneratedDocx() {
    if (!lease) return;
    try {
      const latestDocx = await loadLatestDocx();
      if (!latestDocx?.id) {
        setError('Aucun contrat Word genere pour ce bail.');
        return;
      }
      await api.post(`/leases/${lease.id}/contracts/${latestDocx.id}/printed`);
      const response = await api.get(`/leases/${lease.id}/contracts/${latestDocx.id}/download`, { responseType: 'blob' });
      const objectUrl = window.URL.createObjectURL(response.data);
      downloadFile(objectUrl, `Contrat_bail_${leaseReference(lease)}.docx`);
      window.URL.revokeObjectURL(objectUrl);
      await load();
    } catch (err: any) {
      const responseMessage = err?.response?.data?.message;
      const message = Array.isArray(responseMessage) ? responseMessage.join(' | ') : responseMessage;
      setError(message || 'Impossible de telecharger le contrat Word.');
    }
  }

  async function printGeneratedPreview() {
    const contract = lease?.latest_contract;
    if (!lease) return;
    if (contract?.pdf_file_name) {
      await markPrinted();
      const response = await api.get(`/leases/${lease.id}/contracts/${contract.id}/download`, { responseType: 'blob' });
      const objectUrl = window.URL.createObjectURL(response.data);
      window.open(objectUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    if (!contract?.generated_html) return;
    await markPrinted();
    const printWindow = window.open('', '_blank', 'noopener,noreferrer');
    if (!printWindow) return;
    printWindow.document.write(`<!doctype html><html><head><meta charset="UTF-8" /><title>Contrat ${leaseReference(lease!)}</title><style>body{font-family:"Times New Roman",serif;margin:24px;color:#111}.lease-contract-preview-html{max-width:900px;margin:0 auto}.lease-contract-preview-html .contract-header{margin-bottom:12px}.lease-contract-preview-html .contract-header .contract-logo{display:flex;justify-content:center;margin:0 0 10px}.lease-contract-preview-html .contract-header .contract-logo img{max-width:120px;max-height:64px;object-fit:contain}.lease-contract-preview-html .contract-header-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 14px;border:1px solid #9aa7b1;padding:10px 12px;border-radius:6px}.lease-contract-preview-html .contract-header-item{display:grid;gap:2px}.lease-contract-preview-html .contract-header-item span,.lease-contract-preview-html .contract-footer span{color:#637783;font-size:10pt;font-weight:700;text-transform:uppercase}.lease-contract-preview-html .contract-header-item strong{font-size:10.5pt;font-weight:700;line-height:1.15}.lease-contract-preview-html table{width:100%;border-collapse:collapse;table-layout:fixed}.lease-contract-preview-html th,.lease-contract-preview-html td{border:1px solid #444;padding:6px 8px;vertical-align:top}.lease-contract-preview-html h1,.lease-contract-preview-html h3{text-align:center}.lease-contract-preview-html p{line-height:1.4;text-align:justify}.lease-contract-preview-html .lease-signatures{display:grid;gap:8px;margin-top:8px;break-inside:avoid;page-break-inside:avoid}.lease-contract-preview-html .lease-signature-table{width:100%;border-collapse:collapse;table-layout:fixed;break-inside:avoid;page-break-inside:avoid}.lease-contract-preview-html .lease-signature-table th,.lease-contract-preview-html .lease-signature-table td{border:1px solid #9aa7b1;text-align:center;vertical-align:top}.lease-contract-preview-html .lease-signature-title-table th,.lease-contract-preview-html .lease-signature-title-table td{padding:8px 8px}.lease-contract-preview-html .lease-signature-title-table th{font-size:11pt;font-weight:700;text-transform:uppercase;letter-spacing:0;color:#111827}.lease-contract-preview-html .lease-signature-body-table td{padding:6px 8px;height:38px}.lease-contract-preview-html .lease-signature-space{min-height:38px;width:100%}.lease-contract-preview-html .contract-footer{display:flex;gap:12px;justify-content:space-between;align-items:center;border-top:1px solid #dce5eb;padding-top:10px;margin-top:16px;color:#637783;font-size:10pt;font-weight:700;text-transform:uppercase}</style></head><body><div class="lease-contract-preview-html">${contract.generated_html}</div></body></html>`); // eslint-disable-line @typescript-eslint/no-non-null-assertion
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }

  if (loading) return <EmptyState message="Chargement..." />;
  if (!lease) return <EmptyState message={error || 'Bail introuvable.'} />;

  const totalMonthly = Number(lease.lease_total_amount ?? (Number(lease.monthly_rent ?? 0) + Number(lease.maintenance_fee_amount ?? 0) + Number(lease.monthly_syndic_amount ?? 0) + Number(lease.other_charges_amount ?? 0)));
  const exportRows = [
    {
      section: 'Bail',
      reference: leaseReference(lease),
      locataire: lease.tenant_name,
      type_locataire: lease.tenant_type === 'COMPANY' ? 'Personne morale' : 'Personne physique',
      immeuble: lease.building_name,
      unite: lease.unit_number,
      loyer_base: money(lease.monthly_rent),
      entretien: money(lease.maintenance_fee_amount ?? 0),
      syndic: money(lease.monthly_syndic_amount ?? 0),
      autres_charges: money(lease.other_charges_amount ?? 0),
      total_mensuel: money(totalMonthly),
      garantie: money(lease.guarantee?.amount ?? lease.rental_guarantee_amount),
      statut: statusLabel(lease.status),
    },
    ...lease.history.map((row) => ({ section: 'Historique occupation', reference: leaseReference(row), locataire: row.tenant_name, debut: shortDate(row.start_date), fin: row.end_date ? shortDate(row.end_date) : '', statut: statusLabel(row.status) })),
    ...lease.documents.map((document) => ({ section: 'Document', type: document.document_type, fichier: document.file_name, date: document.uploaded_at ? shortDate(document.uploaded_at) : '' })),
  ];

  return (
    <section>
      <PageHeader
        title={`Detail bail ${leaseReference(lease)}`}
        action={(
          <div className="page-actions">
            <button className="secondary" onClick={() => navigate('/leases')}><ArrowLeft size={16} />Retour</button>
            {canManageLeaseContract && (
              <button className="secondary" onClick={() => { if (lease.latest_contract && !contractVersionOutdated) setPreviewOpen(true); else void generateContract(true); }} disabled={contractBusy}>
                <ScrollText size={16} />
                {lease.latest_contract && !contractVersionOutdated ? 'Previsualiser contrat' : 'Generer contrat PDF'}
              </button>
            )}
            {canReadLeaseContract && hasGeneratedPdf ? <button className="secondary" onClick={() => void downloadGeneratedPdf()} disabled={contractBusy}><Download size={16} />Telecharger PDF</button> : null}
            {canReadLeaseContract && !hasGeneratedPdf && hasGeneratedDocx ? <button className="secondary" onClick={() => void downloadGeneratedDocx()} disabled={contractBusy}><Download size={16} />Ancien format Word</button> : null}
            {can('invoices.create') && <button className="secondary" onClick={invoice}><Receipt size={16} />Facturer</button>}
            <button className="secondary" onClick={() => exportCsv(`bail-${lease.id}.csv`, exportRows)}><Download size={16} />CSV</button>
            <button className="secondary" onClick={() => exportLeaseDetail(lease, totalMonthly)}><FileSpreadsheet size={16} />Excel</button>
            <button className="secondary" onClick={() => window.print()}><Printer size={16} />Imprimer</button>
          </div>
        )}
      />
      <SuccessMessage message={success} />
      {error && <div className="error-banner">{error}</div>}

      <div className="summary-band">
        <SummaryItem label="Locataire" value={lease.tenant_name} />
        <SummaryItem label="Type" value={lease.tenant_type === 'COMPANY' ? 'Personne morale' : 'Personne physique'} />
        <SummaryItem label="Immeuble" value={lease.building_name} />
        <SummaryItem label="Unite" value={lease.unit_number} />
        <SummaryItem label="Usage" value={leaseUsageLabel(lease.lease_usage ?? lease.usage_type)} />
        <SummaryItem label="Activite / destination" value={lease.lease_activity_description || '-'} />
        <SummaryItem label="Loyer de base" value={money(lease.monthly_rent)} />
        <SummaryItem label="Total mensuel" value={money(totalMonthly)} />
        <SummaryItem label="Garantie" value={`${money(lease.guarantee?.paid_amount ?? lease.rental_guarantee_paid)} / ${money(lease.guarantee?.amount ?? lease.rental_guarantee_amount)}`} />
        <SummaryItem label="Contrat" value={lease.latest_contract ? contractStatusLabel(lease.latest_contract.status) : 'Non genere'} />
        <SummaryItem label="Statut" value={statusLabel(lease.status)} />
      </div>

      <div className="detail-section report-section">
        <h4>Informations bail</h4>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Reference</th><th>Debut</th><th>Fin</th><th className="right">Loyer base</th><th className="right">Entretien</th><th className="right">Syndic</th><th className="right">Autres</th><th className="right">Total</th><th>Devise</th><th>Statut</th></tr></thead>
            <tbody><tr><td>{leaseReference(lease)}</td><td>{shortDate(lease.start_date)}</td><td>{lease.end_date ? shortDate(lease.end_date) : 'En cours'}</td><td className="right">{amount(lease.monthly_rent)}</td><td className="right">{amount(lease.maintenance_fee_amount)}</td><td className="right">{amount(lease.monthly_syndic_amount)}</td><td className="right">{amount(lease.other_charges_amount)}</td><td className="right">{amount(totalMonthly)}</td><td>USD</td><td><StatusBadge value={lease.status} /></td></tr></tbody>
          </table>
        </div>
      </div>

      <div className="detail-section report-section">
        <h4>Parties et bien loue</h4>
        <div className="summary-band">
          <SummaryItem label="Locataire" value={lease.tenant_name} />
          <SummaryItem label="Telephone" value={lease.tenant_phone || '-'} />
          <SummaryItem label="Email" value={lease.tenant_email || '-'} />
          <SummaryItem label="Adresse bien" value={lease.building_address || '-'} />
          <SummaryItem label="Commune" value={lease.building_commune || '-'} />
          <SummaryItem label="Quartier" value={lease.building_neighborhood || '-'} />
          <SummaryItem label="Ville" value={lease.building_city || '-'} />
          <SummaryItem label="Destination" value={lease.lease_activity_description || '-'} />
          <SummaryItem label="Chambres" value={lease.bedrooms_count ?? 0} />
          <SummaryItem label="Parkings" value={lease.parking_spaces_count ?? (lease.has_parking ? 1 : 0)} />
          <SummaryItem label="Meuble" value={lease.is_furnished ? 'Oui' : 'Non'} />
        </div>
      </div>

      <div className="detail-section report-section">
        <h4>Garantie locative</h4>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Statut</th><th className="right">Nombre de mois</th><th className="right">Montant</th><th className="right">Paye</th><th>Devise</th><th>Date paiement</th></tr></thead>
            <tbody><tr><td><StatusBadge value={lease.guarantee?.status ?? lease.rental_guarantee_status} /></td><td className="right">{lease.guarantee_months ?? 0}</td><td className="right">{amount(lease.guarantee?.amount ?? lease.rental_guarantee_amount)}</td><td className="right">{amount(lease.guarantee?.paid_amount ?? lease.rental_guarantee_paid)}</td><td>USD</td><td>{lease.guarantee?.payment_date ? shortDate(lease.guarantee.payment_date) : '-'}</td></tr></tbody>
          </table>
        </div>
      </div>

      <SimpleSection title="Contrat genere" empty="Aucun contrat genere pour ce bail.">
        {lease.latest_contract ? (
          <div className="compact-list">
            <div className="compact-item"><span>Modele</span><strong>{contractTemplateLabel(lease.latest_contract.template_code)} v{lease.latest_contract.template_version ?? 1}</strong></div>
            <div className="compact-item"><span>Genere le</span><strong>{dateText(lease.latest_contract.generated_at)}</strong></div>
            <div className="compact-item"><span>Statut</span><strong>{contractStatusLabel(lease.latest_contract.status)}</strong></div>
            <div className="compact-item"><span>PDF</span><strong>{lease.latest_contract.pdf_file_name ?? '-'}</strong></div>
            {lease.latest_contract.docx_file_name ? <div className="compact-item"><span>Ancien format Word</span><strong>{lease.latest_contract.docx_file_name}</strong></div> : null}
            <div className="compact-item"><span>Contrat signe</span><strong>{lease.latest_contract.signed_contract_file_name ?? 'Non televerse'}</strong></div>
          </div>
        ) : null}
      </SimpleSection>

      <div className="detail-section report-section">
        <h4>Contrat de bail</h4>
        <div className="compact-list">
          <div className="compact-item">
            <span>PDF officiel</span>
            <strong>{hasGeneratedPdf ? (lease.latest_contract?.pdf_file_name ?? `Contrat_bail_${leaseReference(lease)}.pdf`) : 'Aucun PDF genere'}</strong>
          </div>
          {lease.latest_contract ? (
            <>
              <div className="compact-item"><span>ID</span><strong>{lease.latest_contract.id}</strong></div>
              <div className="compact-item"><span>Modele</span><strong>{contractTemplateLabel(lease.latest_contract.template_code)} v{lease.latest_contract.template_version ?? 1}</strong></div>
              <div className="compact-item"><span>Genere le</span><strong>{dateText(lease.latest_contract.generated_at)}</strong></div>
              <div className="compact-item"><span>Fichier</span><strong>{lease.latest_contract.pdf_file_name ?? lease.latest_contract.docx_file_name ?? '-'}</strong></div>
            </>
          ) : null}
          <div className="actions" style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {canManageLeaseContract && (
              <button type="button" className="secondary" onClick={() => void generateContract(false)} disabled={contractBusy}>
                {contractBusy ? <RefreshCcw size={16} /> : <ScrollText size={16} />}
                {hasGeneratedPdf ? 'Regenerer le contrat PDF' : 'Generer le contrat PDF'}
              </button>
            )}
            {canReadLeaseContract && hasGeneratedPdf ? (
              <button type="button" className="secondary" onClick={() => void downloadGeneratedPdf()} disabled={contractBusy}>
                <Download size={16} />
                Telecharger PDF
              </button>
            ) : null}
            {canReadLeaseContract && hasGeneratedDocx ? (
              <button type="button" className="secondary" onClick={() => void downloadGeneratedDocx()} disabled={!hasGeneratedDocx || contractBusy}>
                <Download size={16} />
                Ancien format Word
              </button>
            ) : null}
            {canReadLeaseContract && (hasGeneratedPdf || lease.latest_contract?.generated_html) ? (
              <button type="button" className="secondary" onClick={() => setPreviewOpen(true)} disabled={contractBusy}>
                <ScrollText size={16} />
                Voir l'aperçu
              </button>
            ) : null}
            {canReadLeaseContract && (hasGeneratedPdf || lease.latest_contract?.generated_html) ? (
              <button type="button" className="secondary" onClick={() => void printGeneratedPreview()} disabled={contractBusy}>
                <Printer size={16} />
                Imprimer
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <SimpleSection title="Documents" empty="Aucun document trouve.">
        {lease.documents.map((document) => <div className="compact-item" key={document.id}><span>{document.document_type}</span><strong>{document.file_name}</strong></div>)}
      </SimpleSection>

      <SimpleSection title="Historique occupation" empty="Aucun historique trouve.">
        {lease.history.map((row) => <div className="compact-item" key={row.id}><span>{row.tenant_name} - {shortDate(row.start_date)}</span><strong>{statusLabel(row.status)}</strong></div>)}
      </SimpleSection>

      <SimpleSection title="Factures / paiements / relances" empty="Les historiques financiers sont consultables depuis les fiches Factures et Situation locataire." />

      {previewOpen && (
        <Modal
          title={`Contrat de bail ${leaseReference(lease)}`}
          className="lease-contract-modal"
          onClose={() => setPreviewOpen(false)}
          footer={
            <>
              <button type="button" className="secondary" onClick={() => setPreviewOpen(false)}>Retour au bail</button>
              <button type="button" className="secondary" onClick={() => void generateContract(true)} disabled={contractBusy}><RefreshCcw size={16} />Regenerer PDF</button>
              {hasGeneratedPdf ? <button type="button" className="secondary" onClick={() => void downloadGeneratedPdf()} disabled={contractBusy}><Download size={16} />Telecharger PDF</button> : null}
              {!hasGeneratedPdf && hasGeneratedDocx ? <button type="button" className="secondary" onClick={() => void downloadGeneratedDocx()} disabled={contractBusy}><Download size={16} />Ancien format Word</button> : null}
              <button type="button" className="secondary" onClick={() => void printGeneratedPreview()} disabled={!hasGeneratedPdf && !lease.latest_contract?.generated_html}><Printer size={16} />Imprimer</button>
              <button type="button" className="secondary" onClick={() => void markSigned()} disabled={!lease.latest_contract}><ShieldCheck size={16} />Marquer comme signe</button>
            </>
          }
        >
          {!lease.latest_contract || contractVersionOutdated ? (
            <div className="compact-empty">Aucun brouillon genere pour ce bail.</div>
          ) : (
            <div className="lease-contract-preview-wrap">
              <div className="summary-band">
                <SummaryItem label="Modele" value={`${contractTemplateLabel(lease.latest_contract.template_code)} v${lease.latest_contract.template_version ?? 1}${contractVersionOutdated ? ' (obsolete)' : ''}`} />
                <SummaryItem label="Genere le" value={dateText(lease.latest_contract.generated_at)} />
                <SummaryItem label="Statut" value={contractStatusLabel(lease.latest_contract.status)} />
                <SummaryItem label="PDF" value={lease.latest_contract.pdf_file_name ?? '-'} />
                {lease.latest_contract.docx_file_name ? <SummaryItem label="Ancien format Word" value={lease.latest_contract.docx_file_name} /> : null}
              </div>

              {hasGeneratedPdf ? (
                pdfPreviewUrl ? <iframe className="lease-contract-pdf-frame" title="Apercu PDF du contrat" src={pdfPreviewUrl} /> : <div className="compact-empty">Chargement du PDF...</div>
              ) : (
                <div className="lease-contract-preview-html" dangerouslySetInnerHTML={{ __html: lease.latest_contract.generated_html ?? '<p>Apercu indisponible.</p>' }} />
              )}

              <div className="detail-section report-section">
                <h4>Contrat signe</h4>
                <div className="lease-section-grid">
                  <label className="lease-field-wide">Televerser le contrat signe
                    <input type="file" accept="application/pdf,image/*" onChange={(event) => setSignedFileName(event.target.files?.[0]?.name ?? '')} />
                  </label>
                  <label className="lease-field-wide">Nom du fichier
                    <input className="locked-field" value={signedFileName || lease.latest_contract.signed_contract_file_name || 'Aucun fichier'} readOnly />
                  </label>
                </div>
                <div className="actions" style={{ marginTop: 10 }}>
                  <button type="button" onClick={() => void uploadSignedContract()} disabled={!signedFileName || contractBusy}><Upload size={16} />Televerser le contrat signe</button>
                </div>
              </div>
            </div>
          )}
        </Modal>
      )}
    </section>
  );
}

function SummaryItem({ label, value }: { label: string; value: unknown }) {
  return <div className="summary-item"><span>{label}</span><strong>{String(value ?? '-')}</strong></div>;
}

function SimpleSection({ title, empty, children }: { title: string; empty: string; children?: React.ReactNode }) {
  return (
    <div className="detail-section report-section">
      <h4>{title}</h4>
      <div className="compact-list">{children || <div className="compact-empty">{empty}</div>}</div>
    </div>
  );
}

function leaseReference(lease: Lease) {
  return `B-${String(lease.id).padStart(4, '0')}`;
}

function amount(value: unknown) {
  return Number(value ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}

function dateText(value?: string) {
  return value ? shortDate(String(value)) : '-';
}

function contractStatusLabel(status?: string) {
  switch (status) {
    case 'DRAFT':
      return 'Brouillon';
    case 'GENERATED':
      return 'Genere';
    case 'PRINTED':
      return 'Imprime';
    case 'SIGNED':
      return 'Signe';
    case 'CANCELLED':
      return 'Annule';
    default:
      return status || '-';
  }
}

function leaseUsageLabel(value?: string | null) {
  switch (String(value ?? '').trim().toUpperCase()) {
    case 'COMMERCIAL':
      return 'Commercial';
    case 'PROFESSIONAL':
    case 'PROFESSIONNEL':
      return 'Professionnel';
    case 'MIXED':
    case 'MIXTE':
      return 'Mixte';
    case 'RESIDENTIAL':
    default:
      return 'Residentiel';
  }
}

function contractTemplateLabel(value?: string | null) {
  switch (String(value ?? '').trim().toUpperCase()) {
    case 'LEASE_COMMERCIAL':
      return 'Commercial';
    case 'LEASE_PROFESSIONAL':
      return 'Professionnel';
    case 'LEASE_MIXED':
      return 'Mixte';
    case 'LEASE_RESIDENTIAL':
      return 'Residentiel';
    default:
      return String(value ?? '-') || '-';
  }
}

function downloadDataUrl(url: string, fileName: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function downloadFile(url: string, fileName: string) {
  if (url.startsWith('data:')) {
    downloadDataUrl(url, fileName);
    return;
  }
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function exportLeaseDetail(lease: LeaseDetailData, totalMonthly: number) {
  exportXlsxWorkbook(`Bail_${leaseReference(lease)}.xlsx`, [
    {
      name: 'Informations',
      rows: [{
        reference: leaseReference(lease),
        locataire: lease.tenant_name,
        type_locataire: lease.tenant_type === 'COMPANY' ? 'Personne morale' : 'Personne physique',
        immeuble: lease.building_name,
        unite: lease.unit_number,
        loyer_base: amount(lease.monthly_rent),
        entretien: amount(lease.maintenance_fee_amount),
        syndic: amount(lease.monthly_syndic_amount),
        autres_charges: amount(lease.other_charges_amount),
        total_mensuel: amount(totalMonthly),
        devise: 'USD',
        statut: statusLabel(lease.status),
      }],
    },
    {
      name: 'Garanties',
      rows: [{
        montant: amount(lease.guarantee?.amount ?? lease.rental_guarantee_amount),
        paye: amount(lease.guarantee?.paid_amount ?? lease.rental_guarantee_paid),
        devise: 'USD',
        statut: statusLabel(lease.guarantee?.status ?? lease.rental_guarantee_status),
      }],
    },
    {
      name: 'Contrat',
      rows: [{
        statut: contractStatusLabel(lease.latest_contract?.status),
        pdf_genere: lease.latest_contract?.pdf_file_name ?? '',
        date_generation: dateText(lease.latest_contract?.generated_at),
        contrat_signe: lease.latest_contract?.signed_contract_file_name ?? '',
        date_signature: dateText(lease.latest_contract?.signed_at),
      }],
    },
    { name: 'Documents', rows: lease.documents },
    { name: 'Historique', rows: lease.history },
  ]);
}
