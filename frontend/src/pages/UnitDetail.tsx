import { ArrowLeft, FileSpreadsheet, FileText, Printer } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, exportCsv, exportExcel, invoiceDisplayStatus, paymentMethodLabel, shortDate } from '../api';
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
  status: string;
  tenant_id?: number;
  tenant_name?: string;
  tenant_phone?: string;
  tenant_email?: string;
  active_lease_end_date?: string;
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
  tenants: Array<{ id: number; first_name: string; last_name: string; phone?: string; email?: string; move_in_date?: string; status: string }>;
  leases: Array<{ id: number; tenant_name: string; phone?: string; email?: string; start_date: string; end_date?: string; monthly_rent: number; status: string }>;
  invoices: Array<{ id: number; invoice_number: string; tenant_name: string; issue_date: string; due_date: string; total: number; paid_amount: number; remaining_amount: number; status: string }>;
  payments: Array<{ id: number; invoice_number: string; tenant_name: string; payment_date: string; amount: number; payment_method: string; receipt_number?: string }>;
  rent_history: Array<{ id: number; start_date: string; end_date?: string; monthly_rent: number; tenant_name: string }>;
  maintenance: Array<{ id: number; request_number?: string; title?: string; status: string; priority?: string; reported_at: string; resolved_at?: string }>;
  documents: Array<{ id: number; name: string; type?: string; created_at?: string }>;
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
            <button className="secondary" onClick={() => exportExcel(`appartement-${unit.number}.xls`, exportRows)}><FileSpreadsheet size={15} />Excel</button>
            <button className="secondary" onClick={() => window.print()}><Printer size={15} />PDF</button>
          </div>
        }
      />

      <div className="summary-band">
        <SummaryItem label="Immeuble" value={unit.building_name} />
        <SummaryItem label="Appartement" value={unit.number} />
        <SummaryItem label="Type" value={unit.type} />
        <SummaryItem label="Statut" value={<StatusBadge value={unit.status} />} />
        <SummaryItem label="Loyer" value={`${amount(unit.monthly_rent)} USD`} />
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
          headers={['Locataire', 'Debut', 'Fin', 'Loyer', 'Devise', 'Statut']}
          rows={unit.leases.map((lease) => [lease.tenant_name, dateText(lease.start_date), dateText(lease.end_date), amount(lease.monthly_rent), 'USD', <StatusBadge value={lease.status} />])}
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
          headers={['Locataire', 'Debut', 'Fin', 'Loyer', 'Devise']}
          rows={unit.rent_history.map((row) => [row.tenant_name, dateText(row.start_date), dateText(row.end_date), amount(row.monthly_rent), 'USD'])}
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
          headers={['Facture', 'Locataire', 'Emission', 'Echeance', 'Total', 'Devise', 'Paye', 'Devise', 'Reste', 'Devise', 'Statut']}
          rows={unit.invoices.map((invoice) => [
            invoice.invoice_number,
            invoice.tenant_name,
            dateText(invoice.issue_date),
            dateText(invoice.due_date),
            amount(invoice.total),
            'USD',
            amount(invoice.paid_amount),
            'USD',
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
