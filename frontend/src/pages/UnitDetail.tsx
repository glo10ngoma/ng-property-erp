import { ArrowLeft, FileSpreadsheet, FileText, Printer } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, exportCsv, exportXlsxWorkbook, invoiceDisplayStatus, paymentMethodLabel, shortDate, statusLabel } from '../api';
import { EmptyState, PageHeader, StatusBadge } from '../components';
import { LeaseEndBadge } from './Units';

type UnitDetailData = {
  id: number;
  building_name: string;
  building_address?: string;
  number: string;
  floor: number;
  type: string;
  monthly_rent: number;
  monthly_syndic_amount?: number;
  syndic_currency?: string;
  status: string;
  tenant_id?: number;
  tenant_name?: string;
  tenant_phone?: string;
  tenant_email?: string;
  active_lease_end_date?: string;
  created_at?: string;
  updated_at?: string;
  surface_area?: number;
  bedrooms_count?: number;
  bathrooms_count?: number;
  has_balcony?: boolean;
  has_parking?: boolean;
  is_furnished?: boolean;
  has_air_conditioning?: boolean;
  has_equipped_kitchen?: boolean;
  has_internet?: boolean;
  has_water_meter?: boolean;
  water_meter_number?: string;
  has_electricity_meter?: boolean;
  electricity_meter_number?: string;
  description?: string;
  observations?: string;
  situation?: string;
  tenants: Array<{ id: number; first_name: string; last_name: string; post_name?: string; phone?: string; secondary_phone?: string; email?: string; profession?: string; nationality?: string; address?: string; id_number?: string; id_document_file_name?: string; move_in_date?: string; status: string }>;
  leases: Array<{ id: number; tenant_name: string; phone?: string; email?: string; start_date: string; end_date?: string; monthly_rent: number; monthly_syndic_amount?: number; guarantee_amount?: number; status: string }>;
  invoices: Array<{ id: number; invoice_number: string; tenant_name: string; month?: number; year?: number; issue_date: string; due_date: string; total: number; paid_amount: number; remaining_amount: number; rent_amount?: number; syndic_amount?: number; status: string }>;
  payments: Array<{ id: number; invoice_number: string; tenant_name: string; payment_date: string; amount: number; payment_method: string; receipt_number?: string; reference?: string; payer_name?: string }>;
  rent_history: Array<{ id: number; start_date: string; end_date?: string; monthly_rent: number; monthly_syndic_amount?: number; tenant_name: string }>;
  maintenance: Array<{ id: number; request_number?: string; title?: string; description?: string; status: string; priority?: string; reported_at: string; resolved_at?: string; external_provider?: string; cost?: number; resolution_comments?: string }>;
  documents: Array<{ id: number; name: string; type?: string; created_at?: string; author?: string }>;
  photos: Array<{ id: number; name: string; created_at?: string }>;
  timeline: Array<{ date: string; title: string }>;
};

export function UnitDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [unit, setUnit] = useState<UnitDetailData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get<UnitDetailData>(`/units/${id}`).then((response) => setUnit(response.data)).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <section><PageHeader title="Fiche appartement" /></section>;
  if (!unit) return <section><PageHeader title="Fiche appartement" /><EmptyState title="Appartement introuvable." /></section>;

  const oldTenants = unit.tenants.filter((tenant) => tenant.id !== unit.tenant_id);
  const exportRows = unit.leases.map((lease) => ({
    section: 'Historique des baux',
    locataire: lease.tenant_name,
    debut: dateText(lease.start_date),
    fin: dateText(lease.end_date),
    loyer: amount(lease.monthly_rent),
    syndic: amount(lease.monthly_syndic_amount),
    total_mensuel: amount(Number(lease.monthly_rent ?? 0) + Number(lease.monthly_syndic_amount ?? 0)),
    devise: 'USD',
    statut: lease.status,
  }));

  return (
    <section>
      <PageHeader
        title="Fiche appartement"
        action={
          <div className="toolbar-actions">
            <button className="secondary" onClick={() => navigate('/rental-units')}><ArrowLeft size={15} />Retour</button>
            <button className="secondary" onClick={() => exportCsv(`appartement-${unit.number}.csv`, exportRows)}><FileText size={15} />CSV</button>
            <button className="secondary" onClick={() => exportUnitWorkbook(unit)}><FileSpreadsheet size={15} />Excel</button>
            <button className="secondary" onClick={() => window.print()}><Printer size={15} />PDF</button>
          </div>
        }
      />

      <div className="summary-band">
        <SummaryItem label="Immeuble" value={unit.building_name} />
        <SummaryItem label="Appartement" value={unit.number} />
        <SummaryItem label="Type" value={unit.type} />
        <SummaryItem label="Statut" value={<StatusBadge value={unit.status} />} />
        <SummaryItem label="Loyer mensuel" value={`${amount(unit.monthly_rent)} USD`} />
        <SummaryItem label="Syndic mensuel" value={`${amount(unit.monthly_syndic_amount)} USD`} />
        <SummaryItem label="Total mensuel" value={`${amount(Number(unit.monthly_rent ?? 0) + Number(unit.monthly_syndic_amount ?? 0))} USD`} />
        <SummaryItem label="Surface" value={unit.surface_area ? `${unit.surface_area} m2` : '-'} />
        <SummaryItem label="Chambres" value={text(unit.bedrooms_count)} />
        <SummaryItem label="SDB" value={text(unit.bathrooms_count)} />
        <SummaryItem label="Fin bail" value={<LeaseEndBadge date={unit.active_lease_end_date} />} />
      </div>

      <Section title="Informations appartement">
        <div className="summary-band">
          <SummaryItem label="Etage" value={text(unit.floor)} />
          <SummaryItem label="Balcon" value={yesNo(unit.has_balcony)} />
          <SummaryItem label="Parking" value={yesNo(unit.has_parking)} />
          <SummaryItem label="Meuble" value={yesNo(unit.is_furnished)} />
          <SummaryItem label="Climatisation" value={yesNo(unit.has_air_conditioning)} />
          <SummaryItem label="Cuisine equipee" value={yesNo(unit.has_equipped_kitchen)} />
          <SummaryItem label="Internet" value={yesNo(unit.has_internet)} />
          <SummaryItem label="Compteur eau" value={meterLabel(unit.has_water_meter, unit.water_meter_number)} />
          <SummaryItem label="Compteur electricite" value={meterLabel(unit.has_electricity_meter, unit.electricity_meter_number)} />
        </div>
        {(unit.description || unit.observations) && (
          <div className="compact-list">
            {unit.description && <div className="compact-item"><span>Description</span><strong>{unit.description}</strong></div>}
            {unit.observations && <div className="compact-item"><span>Observations</span><strong>{unit.observations}</strong></div>}
          </div>
        )}
      </Section>

      <Section title="Locataire actuel">
        {unit.tenant_name ? (
          <div className="summary-band">
            <SummaryItem label="Nom" value={unit.tenant_name} />
            <SummaryItem label="Telephone" value={unit.tenant_phone || '-'} />
            <SummaryItem label="Email" value={unit.tenant_email || '-'} />
            <SummaryItem label="Situation" value={unit.situation || '-'} />
          </div>
        ) : <EmptyState title="Appartement non occupe." />}
      </Section>

      <Section title="Historique des baux">
        <Table
          headers={['Locataire', 'Debut', 'Fin', 'Loyer', 'Syndic', 'Total mensuel', 'Devise', 'Statut']}
          rows={unit.leases.map((lease) => [lease.tenant_name, dateText(lease.start_date), dateText(lease.end_date), amount(lease.monthly_rent), amount(lease.monthly_syndic_amount), amount(Number(lease.monthly_rent ?? 0) + Number(lease.monthly_syndic_amount ?? 0)), 'USD', <StatusBadge value={lease.status} />])}
        />
      </Section>

      <Section title="Anciens locataires">
        <Table
          headers={['Locataire', 'Telephone', 'Email', 'Entree', 'Statut']}
          rows={oldTenants.map((tenant) => [`${tenant.first_name} ${tenant.last_name}`, tenant.phone || '-', tenant.email || '-', dateText(tenant.move_in_date), <StatusBadge value={tenant.status} />])}
          emptyLabel="Aucun ancien locataire."
        />
      </Section>

      <Section title="Historique des loyers">
        <Table
          headers={['Locataire', 'Debut', 'Fin', 'Loyer', 'Syndic', 'Total mensuel', 'Devise']}
          rows={unit.rent_history.map((row) => [row.tenant_name, dateText(row.start_date), dateText(row.end_date), amount(row.monthly_rent), amount(row.monthly_syndic_amount), amount(Number(row.monthly_rent ?? 0) + Number(row.monthly_syndic_amount ?? 0)), 'USD'])}
          emptyLabel="Aucun historique de loyer."
        />
      </Section>

      <Section title="Historique des paiements">
        <Table
          headers={['Facture', 'Locataire', 'Date', 'Montant', 'Devise', 'Mode', 'Recu']}
          rows={unit.payments.map((payment) => [payment.invoice_number, payment.tenant_name, dateText(payment.payment_date), amount(payment.amount), 'USD', paymentMethodLabel(payment.payment_method), payment.receipt_number || '-'])}
          emptyLabel="Aucun paiement."
        />
      </Section>

      <Section title="Factures liees">
        <Table
          headers={['Facture', 'Locataire', 'Emission', 'Echeance', 'Loyer', 'Syndic', 'Total', 'Paye', 'Reste', 'Devise', 'Statut']}
          rows={unit.invoices.map((invoice) => [
            invoice.invoice_number,
            invoice.tenant_name,
            dateText(invoice.issue_date),
            dateText(invoice.due_date),
            amount(invoice.rent_amount),
            amount(invoice.syndic_amount),
            amount(invoice.total),
            amount(invoice.paid_amount),
            amount(invoice.remaining_amount),
            'USD',
            <StatusBadge value={invoiceDisplayStatus(invoice.status, invoice.due_date)} />,
          ])}
          emptyLabel="Aucune facture."
        />
      </Section>

      <Section title="Historique maintenance">
        <Table
          headers={['Reference', 'Titre', 'Priorite', 'Date', 'Resolution', 'Statut']}
          rows={unit.maintenance.map((item) => [item.request_number || `#${item.id}`, item.title || '-', item.priority || '-', dateText(item.reported_at), dateText(item.resolved_at), <StatusBadge value={item.status} />])}
          emptyLabel="Aucune intervention maintenance."
        />
      </Section>

      <Section title="Documents">
        <Table
          headers={['Document', 'Type', 'Date']}
          rows={unit.documents.map((document) => [document.name, document.type || '-', dateText(document.created_at)])}
          emptyLabel="Aucun document lie."
        />
      </Section>

      <Section title="Photos (prevu)">
        <Table
          headers={['Photo', 'Date']}
          rows={unit.photos.map((photo) => [photo.name, dateText(photo.created_at)])}
          emptyLabel="Aucune photo pour le moment."
        />
      </Section>

      <Section title="Timeline">
        {unit.timeline.length ? (
          <div className="timeline-list">
            {unit.timeline.map((event, index) => (
              <div className="timeline-item" key={`${event.date}-${index}`}>
                <span>{dateText(event.date)}</span>
                <strong>{event.title}</strong>
              </div>
            ))}
          </div>
        ) : <EmptyState title="Aucun evenement." />}
      </Section>
    </section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <div className="report-section"><h4>{title}</h4>{children}</div>;
}

function SummaryItem({ label, value }: { label: string; value: ReactNode }) {
  return <div className="summary-item"><span>{label}</span><strong>{value}</strong></div>;
}

function Table({ headers, rows, emptyLabel = 'Aucun element.' }: { headers: string[]; rows: ReactNode[][]; emptyLabel?: string }) {
  if (!rows.length) return <EmptyState title={emptyLabel} />;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{headers.map((header, index) => <th key={`${header}-${index}`}>{header}</th>)}</tr></thead>
        <tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function amount(value: unknown) {
  return Number(value ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}

function dateText(value?: string) {
  return value ? shortDate(value) : '-';
}

function text(value: unknown) {
  return value === null || value === undefined || value === '' ? '-' : String(value);
}

function yesNo(value?: boolean) {
  return value ? 'Oui' : 'Non';
}

function meterLabel(enabled?: boolean, number?: string) {
  if (!enabled) return 'Non';
  return number ? `Oui - ${number}` : 'Oui';
}

function exportUnitWorkbook(unit: UnitDetailData) {
  const currentTenant = unit.tenants.find((tenant) => tenant.id === unit.tenant_id);
  const profitability = unitProfitability(unit);
  const filename = `Appartement_${safeFilePart(unit.number)}_${safeFilePart(unit.building_name)}.xlsx`;
  exportXlsxWorkbook(filename, [
    {
      name: 'Informations appartement',
      rows: [{
        Immeuble: unit.building_name,
        Appartement: unit.number,
        'Reference interne': unit.id,
        Type: unit.type,
        Surface: unit.surface_area ?? '',
        'Nombre chambres': unit.bedrooms_count ?? '',
        'Nombre salles de bain': unit.bathrooms_count ?? '',
        Etage: unit.floor,
        Loyer: amount(unit.monthly_rent),
        'Syndic mensuel': amount(unit.monthly_syndic_amount),
        'Total mensuel contractuel': amount(Number(unit.monthly_rent ?? 0) + Number(unit.monthly_syndic_amount ?? 0)),
        Devise: 'USD',
        Statut: statusLabel(unit.status),
        Meuble: yesNo(unit.is_furnished),
        Balcon: yesNo(unit.has_balcony),
        Parking: yesNo(unit.has_parking),
        Climatisation: yesNo(unit.has_air_conditioning),
        'Cuisine equipee': yesNo(unit.has_equipped_kitchen),
        Internet: yesNo(unit.has_internet),
        'Compteur eau': yesNo(unit.has_water_meter),
        'Compteur electricite': yesNo(unit.has_electricity_meter),
        'Numero compteur eau': unit.water_meter_number ?? '',
        'Numero compteur electricite': unit.electricity_meter_number ?? '',
        'Date creation': dateText(unit.created_at),
        'Derniere modification': dateText(unit.updated_at),
        Observations: unit.observations ?? '',
      }],
    },
    {
      name: 'Locataire actuel',
      rows: currentTenant ? [{
        Nom: currentTenant.last_name,
        'Post-nom': currentTenant.post_name ?? '',
        Prenom: currentTenant.first_name,
        Telephone: currentTenant.phone ?? '',
        'Telephone secondaire': currentTenant.secondary_phone ?? '',
        Email: currentTenant.email ?? '',
        Profession: currentTenant.profession ?? '',
        Nationalite: currentTenant.nationality ?? '',
        Adresse: currentTenant.address ?? '',
        "Piece d'identite": currentTenant.id_document_file_name ?? currentTenant.id_number ?? '',
        'Date entree': dateText(currentTenant.move_in_date),
        'Date sortie prevue': dateText(unit.active_lease_end_date),
      }] : [],
    },
    {
      name: 'Historique des baux',
      rows: unit.leases.map((lease) => ({
        'Numero bail': `B-${String(lease.id).padStart(6, '0')}`,
        Debut: dateText(lease.start_date),
        Fin: dateText(lease.end_date),
        Duree: leaseDuration(lease.start_date, lease.end_date),
        Loyer: amount(lease.monthly_rent),
        Syndic: amount(lease.monthly_syndic_amount),
        'Total mensuel': amount(Number(lease.monthly_rent ?? 0) + Number(lease.monthly_syndic_amount ?? 0)),
        Garantie: amount(lease.guarantee_amount),
        Statut: statusLabel(lease.status),
      })),
    },
    {
      name: 'Historique des loyers',
      rows: unit.rent_history.map((row, index) => ({
        Date: dateText(row.start_date),
        'Ancien loyer': index < unit.rent_history.length - 1 ? amount(unit.rent_history[index + 1].monthly_rent) : '',
        'Nouveau loyer': amount(row.monthly_rent),
        'Ancien syndic': index < unit.rent_history.length - 1 ? amount(unit.rent_history[index + 1].monthly_syndic_amount) : '',
        'Nouveau syndic': amount(row.monthly_syndic_amount),
        Motif: index < unit.rent_history.length - 1 ? 'Revision du loyer' : 'Loyer initial',
      })),
    },
    {
      name: 'Factures',
      rows: unit.invoices.map((invoice) => ({
        Numero: invoice.invoice_number,
        Periode: invoice.month && invoice.year ? `${String(invoice.month).padStart(2, '0')}/${invoice.year}` : '',
        Emission: dateText(invoice.issue_date),
        Echeance: dateText(invoice.due_date),
        Montant: amount(invoice.total),
        Loyer: amount(invoice.rent_amount),
        Syndic: amount(invoice.syndic_amount),
        Devise: 'USD',
        Paye: amount(invoice.paid_amount),
        Reste: amount(invoice.remaining_amount),
        Statut: statusLabel(invoiceDisplayStatus(invoice.status, invoice.due_date)),
      })),
    },
    {
      name: 'Paiements',
      rows: unit.payments.map((payment) => ({
        Date: dateText(payment.payment_date),
        Reference: payment.reference ?? payment.receipt_number ?? payment.invoice_number,
        'Mode paiement': paymentMethodLabel(payment.payment_method),
        Montant: amount(payment.amount),
        Devise: 'USD',
        Utilisateur: payment.payer_name ?? '',
      })),
    },
    {
      name: 'Maintenance',
      rows: unit.maintenance.map((item) => ({
        Date: dateText(item.reported_at),
        Intervention: item.title ?? item.request_number ?? `#${item.id}`,
        Prestataire: item.external_provider ?? '',
        Cout: amount(item.cost),
        Statut: statusLabel(item.status),
        Observations: item.resolution_comments ?? item.description ?? '',
      })),
    },
    {
      name: 'Documents',
      rows: unit.documents.map((document) => ({
        Nom: document.name,
        Type: document.type ?? '',
        Date: dateText(document.created_at),
        Auteur: document.author ?? '',
      })),
    },
    {
      name: 'Timeline',
      rows: unit.timeline.map((event) => ({
        Date: dateText(event.date),
        Evenement: event.title,
        Description: event.title,
        Utilisateur: '',
      })),
    },
    {
      name: 'Rentabilite',
      rows: [{
        'Total loyers factures': amount(profitability.totalRentInvoiced),
        'Total syndic facture': amount(profitability.totalSyndicInvoiced),
        'Total mensuel contractuel': amount(Number(unit.monthly_rent ?? 0) + Number(unit.monthly_syndic_amount ?? 0)),
        'Total encaisse': amount(profitability.totalCollected),
        'Total impayes': amount(profitability.totalUnpaid),
        'Total depenses maintenance': amount(profitability.totalMaintenanceExpenses),
        'Revenu net': amount(profitability.netRevenue),
        "Taux d'occupation": profitability.occupancyRate,
        'Nombre de changements de locataires': profitability.tenantChanges,
        'Nombre interventions maintenance': profitability.maintenanceCount,
        'Nombre de factures en retard': profitability.overdueInvoices,
        "Duree moyenne d'occupation": profitability.averageOccupancyDuration,
        'Dernier loyer applique': profitability.lastRent,
        'Date dernier paiement': profitability.lastPaymentDate,
      }],
    },
  ]);
}

function unitProfitability(unit: UnitDetailData) {
  const totalInvoiced = unit.invoices.reduce((sum, invoice) => sum + Number(invoice.total ?? 0), 0);
  const totalRentInvoiced = unit.invoices.reduce((sum, invoice) => sum + Number(invoice.rent_amount ?? 0), 0);
  const totalSyndicInvoiced = unit.invoices.reduce((sum, invoice) => sum + Number(invoice.syndic_amount ?? 0), 0);
  const totalCollected = unit.payments.reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0);
  const totalUnpaid = unit.invoices.reduce((sum, invoice) => sum + Number(invoice.remaining_amount ?? 0), 0);
  const totalMaintenanceExpenses = unit.maintenance.reduce((sum, item) => sum + Number(item.cost ?? 0), 0);
  const sortedLeases = [...unit.leases].sort((a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime());
  const latestRent = [...unit.rent_history].sort((a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime())[0]?.monthly_rent ?? unit.monthly_rent;
  const lastPayment = [...unit.payments].sort((a, b) => new Date(b.payment_date).getTime() - new Date(a.payment_date).getTime())[0];
  const occupancyDurations = sortedLeases
    .map((lease) => occupancyMonths(lease.start_date, lease.end_date))
    .filter((duration) => duration > 0);
  return {
    totalInvoiced,
    totalRentInvoiced,
    totalSyndicInvoiced,
    totalCollected,
    totalUnpaid,
    totalMaintenanceExpenses,
    netRevenue: totalCollected - totalMaintenanceExpenses,
    occupancyRate: occupancyRateLabel(sortedLeases),
    tenantChanges: Math.max(0, new Set(sortedLeases.map((lease) => lease.tenant_name)).size - 1),
    maintenanceCount: unit.maintenance.length,
    overdueInvoices: unit.invoices.filter((invoice) => invoiceDisplayStatus(invoice.status, invoice.due_date) === 'OVERDUE').length,
    averageOccupancyDuration: occupancyDurations.length ? `${Math.round(occupancyDurations.reduce((sum, value) => sum + value, 0) / occupancyDurations.length)} mois` : 'Non disponible',
    lastRent: latestRent !== undefined && latestRent !== null ? `${amount(latestRent)} USD` : 'Non disponible',
    lastPaymentDate: lastPayment ? dateText(lastPayment.payment_date) : 'Non disponible',
  };
}

function occupancyRateLabel(leases: Array<{ start_date: string; end_date?: string }>) {
  if (!leases.length) return '0%';
  const starts = leases.map((lease) => new Date(lease.start_date).getTime()).filter(Number.isFinite);
  if (!starts.length) return 'Non disponible';
  const periodStart = new Date(Math.min(...starts));
  const today = new Date();
  const totalMonths = Math.max(1, occupancyMonths(periodStart.toISOString(), today.toISOString()));
  const occupiedMonths = leases.reduce((sum, lease) => sum + occupancyMonths(lease.start_date, lease.end_date ?? today.toISOString()), 0);
  return `${Math.min(100, Math.round((occupiedMonths / totalMonths) * 100))}%`;
}

function occupancyMonths(startDate?: string, endDate?: string) {
  if (!startDate) return 0;
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : new Date();
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0;
  return Math.max(1, (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth() + 1);
}

function leaseDuration(startDate?: string, endDate?: string) {
  if (!startDate || !endDate) return endDate ? '-' : 'En cours';
  const start = new Date(startDate);
  const end = new Date(endDate);
  const months = Math.max(0, (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth());
  return `${months} mois`;
}

function safeFilePart(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'Appartement';
}
