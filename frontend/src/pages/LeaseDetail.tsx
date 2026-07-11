import { ArrowLeft, Download, FileSpreadsheet, Printer, Receipt } from 'lucide-react';
import type React from 'react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, exportCsv, exportXlsxWorkbook, money, shortDate, statusLabel } from '../api';
import { EmptyState, PageHeader, StatusBadge, SuccessMessage } from '../components';
import { useAuth } from '../core/auth/AuthContext';

type Lease = Record<string, any>;
type LeaseDetailData = Lease & {
  guarantee?: { amount: number; paid_amount: number; status: string; payment_date?: string };
  documents: Array<{ id: number; document_type: string; file_name: string; file_url?: string; uploaded_at?: string }>;
  history: Lease[];
};

export function LeaseDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [lease, setLease] = useState<LeaseDetailData | null>(null);
  const [success, setSuccess] = useState('');

  async function load() {
    if (!id) return;
    const response = await api.get<LeaseDetailData>(`/leases/${id}`);
    setLease(response.data);
  }

  useEffect(() => {
    load();
  }, [id]);

  async function invoice() {
    if (!lease) return;
    const response = await api.post(`/leases/${lease.id}/invoice`);
    setSuccess(`Facture ${response.data.invoice_number} creee depuis le bail.`);
  }

  if (!lease) return <EmptyState message="Chargement..." />;

  const exportRows = [
    { section: 'Bail', reference: leaseReference(lease), locataire: lease.tenant_name, immeuble: lease.building_name, unite: lease.unit_number, loyer: money(lease.monthly_rent), syndic: money(lease.monthly_syndic_amount), total_mensuel: money(Number(lease.monthly_rent ?? 0) + Number(lease.monthly_syndic_amount ?? 0)), statut: statusLabel(lease.status) },
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
            {can('invoices.create') && <button className="secondary" onClick={invoice}><Receipt size={16} />Facturer</button>}
            <button className="secondary" onClick={() => exportCsv(`bail-${lease.id}.csv`, exportRows)}><Download size={16} />CSV</button>
            <button className="secondary" onClick={() => exportLeaseDetail(lease)}><FileSpreadsheet size={16} />Excel</button>
            <button className="secondary" onClick={() => window.print()}><Printer size={16} />Imprimer</button>
          </div>
        )}
      />
      <SuccessMessage message={success} />

      <div className="summary-band">
        <SummaryItem label="Locataire" value={lease.tenant_name} />
        <SummaryItem label="Immeuble" value={lease.building_name} />
        <SummaryItem label="Unite" value={lease.unit_number} />
        <SummaryItem label="Loyer" value={money(lease.monthly_rent)} />
        <SummaryItem label="Syndic" value={money(lease.monthly_syndic_amount)} />
        <SummaryItem label="Total mensuel" value={money(Number(lease.monthly_rent ?? 0) + Number(lease.monthly_syndic_amount ?? 0))} />
        <SummaryItem label="Garantie" value={`${money(lease.guarantee?.paid_amount ?? lease.rental_guarantee_paid)} / ${money(lease.guarantee?.amount ?? lease.rental_guarantee_amount)}`} />
        <SummaryItem label="Contrat" value={lease.contract_file_name ? 'Present' : 'Absent'} />
        <SummaryItem label="Statut" value={statusLabel(lease.status)} />
      </div>

      <div className="detail-section report-section">
        <h4>Informations bail</h4>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Reference</th><th>Debut</th><th>Fin</th><th className="right">Loyer</th><th className="right">Syndic</th><th className="right">Total mensuel</th><th>Devise</th><th>Statut</th></tr></thead>
            <tbody><tr><td>{leaseReference(lease)}</td><td>{shortDate(lease.start_date)}</td><td>{lease.end_date ? shortDate(lease.end_date) : 'En cours'}</td><td className="right">{amount(lease.monthly_rent)}</td><td className="right">{amount(lease.monthly_syndic_amount)}</td><td className="right">{amount(Number(lease.monthly_rent ?? 0) + Number(lease.monthly_syndic_amount ?? 0))}</td><td>USD</td><td><StatusBadge value={lease.status} /></td></tr></tbody>
          </table>
        </div>
      </div>

      <div className="detail-section report-section">
        <h4>Garantie locative</h4>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Statut</th><th className="right">Montant</th><th className="right">Paye</th><th>Devise</th><th>Date paiement</th></tr></thead>
            <tbody><tr><td><StatusBadge value={lease.guarantee?.status ?? lease.rental_guarantee_status} /></td><td className="right">{amount(lease.guarantee?.amount ?? lease.rental_guarantee_amount)}</td><td className="right">{amount(lease.guarantee?.paid_amount ?? lease.rental_guarantee_paid)}</td><td>USD</td><td>{lease.guarantee?.payment_date ? shortDate(lease.guarantee.payment_date) : '-'}</td></tr></tbody>
          </table>
        </div>
      </div>

      <SimpleSection title="Documents" empty="Aucun document trouve.">
        {lease.documents.map((document) => <div className="compact-item" key={document.id}><span>{document.document_type}</span><strong>{document.file_name}</strong></div>)}
      </SimpleSection>

      <SimpleSection title="Historique occupation" empty="Aucun historique trouve.">
        {lease.history.map((row) => <div className="compact-item" key={row.id}><span>{row.tenant_name} - {shortDate(row.start_date)}</span><strong>{statusLabel(row.status)}</strong></div>)}
      </SimpleSection>

      <SimpleSection title="Factures / paiements / relances" empty="Les historiques financiers sont consultables depuis les fiches Factures et Situation locataire." />
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

function exportLeaseDetail(lease: LeaseDetailData) {
  exportXlsxWorkbook(`Bail_${leaseReference(lease)}.xlsx`, [
    { name: 'Informations', rows: [{ reference: leaseReference(lease), locataire: lease.tenant_name, immeuble: lease.building_name, unite: lease.unit_number, loyer: amount(lease.monthly_rent), syndic: amount(lease.monthly_syndic_amount), total_mensuel: amount(Number(lease.monthly_rent ?? 0) + Number(lease.monthly_syndic_amount ?? 0)), devise: 'USD', statut: statusLabel(lease.status) }] },
    { name: 'Garanties', rows: [{ montant: amount(lease.guarantee?.amount ?? lease.rental_guarantee_amount), paye: amount(lease.guarantee?.paid_amount ?? lease.rental_guarantee_paid), devise: 'USD', statut: statusLabel(lease.guarantee?.status ?? lease.rental_guarantee_status) }] },
    { name: 'Documents', rows: lease.documents },
    { name: 'Historique', rows: lease.history },
  ]);
}
