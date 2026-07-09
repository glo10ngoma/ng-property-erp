import { FileSpreadsheet } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { api, exportXlsxWorkbook, money } from '../../../api';
import { PageHeader } from '../../../components';
import { StockNav } from '../StockNav';
import type { StockInventory, StockItem, StockMovement, StockPurchase } from '../stock.types';
import { exportMovement, exportStockItem, paymentStatusLabel, receptionStatusLabel } from '../stock.utils';

type StockAlert = {
  id: number;
  item_code?: string;
  item_name: string;
  level: string;
  quantity: number;
  minimum_quantity: number;
  channel: string;
  status: string;
  created_at: string;
};

type StockReport = {
  items: StockItem[];
  movements: StockMovement[];
  inventories: StockInventory[];
  alerts: StockAlert[];
  purchases: StockPurchase[];
  under_minimum: StockItem[];
  out_of_stock: StockItem[];
  valuation: number;
  by_category: Array<{ category: string; quantity: number; value: number }>;
  by_store: Array<{ store: string; quantity: number; value: number }>;
  maintenance_consumption: StockMovement[];
  purchases_by_supplier: Array<{ supplier: string; count: number; amount: number; paid: number; outstanding: number }>;
  purchases_by_month: Array<{ period: string; amount: number; paid: number; count: number }>;
  supplier_debt: number;
  pending_receptions: StockPurchase[];
  unpaid_purchases: StockPurchase[];
};

export function StockReportPage() {
  const [report, setReport] = useState<StockReport | null>(null);

  useEffect(() => {
    api.get<StockReport>('/stock/report').then((response) => setReport(response.data));
  }, []);

  if (!report) return <section><PageHeader title="Rapport Stock" /><StockNav /></section>;

  const exportAll = () => exportXlsxWorkbook('Rapport_stock_avance.xlsx', [
    { name: 'Resume', rows: [{ valeur_totale: report.valuation, articles: report.items.length, ruptures: report.out_of_stock.length, sous_seuil: report.under_minimum.length, dette_fournisseurs: report.supplier_debt }] },
    { name: 'Etat stock', rows: report.items.map(exportStockItem) },
    { name: 'Ruptures', rows: report.out_of_stock.map(exportStockItem) },
    { name: 'Sous seuil', rows: report.under_minimum.map(exportStockItem) },
    { name: 'Mouvements', rows: report.movements.map(exportMovement) },
    { name: 'Consommation maintenance', rows: report.maintenance_consumption.map(exportMovement) },
    { name: 'Inventaires', rows: report.inventories },
    { name: 'Alertes', rows: report.alerts },
    { name: 'Achats fournisseurs', rows: report.purchases.map(exportPurchaseRow) },
    { name: 'Dettes fournisseurs', rows: report.unpaid_purchases.map(exportPurchaseRow) },
  ]);

  return <section>
    <PageHeader title="Rapport Stock" /><StockNav />
    <div className="actions-row"><button onClick={exportAll}><FileSpreadsheet size={16} />Exporter Excel</button></div>
    <div className="mini-stats">
      <Kpi label="Valeur totale" value={`${money(report.valuation)} USD`} />
      <Kpi label="Articles" value={report.items.length} />
      <Kpi label="Ruptures" value={report.out_of_stock.length} />
      <Kpi label="Sous seuil" value={report.under_minimum.length} />
      <Kpi label="Alertes" value={report.alerts.length} />
      <Kpi label="Dette fournisseurs" value={`${money(report.supplier_debt)} USD`} />
    </div>
    <Section title="Stock par categorie">
      <table><thead><tr><th>Categorie</th><th className="right">Quantite</th><th className="right">Valeur</th></tr></thead>
        <tbody>{report.by_category.map((row) => <tr key={row.category}><td>{row.category}</td><td className="right">{row.quantity}</td><td className="right">{money(row.value)} USD</td></tr>)}</tbody>
      </table>
    </Section>
    <Section title="Stock par magasin">
      <table><thead><tr><th>Magasin</th><th className="right">Quantite</th><th className="right">Valeur</th></tr></thead>
        <tbody>{report.by_store.map((row) => <tr key={row.store}><td>{row.store}</td><td className="right">{row.quantity}</td><td className="right">{money(row.value)} USD</td></tr>)}</tbody>
      </table>
    </Section>
    <Section title="Achats par fournisseur">
      <table><thead><tr><th>Fournisseur</th><th className="right">Achats</th><th className="right">Montant</th><th className="right">Paye</th><th className="right">Dette</th></tr></thead>
        <tbody>{report.purchases_by_supplier.map((row) => <tr key={row.supplier}><td>{row.supplier}</td><td className="right">{row.count}</td><td className="right">{money(row.amount)} USD</td><td className="right">{money(row.paid)} USD</td><td className="right">{money(row.outstanding)} USD</td></tr>)}</tbody>
      </table>
    </Section>
    <Section title="Achats non receptionnes">
      <table><thead><tr><th>N° achat</th><th>Date</th><th>Fournisseur</th><th>Reception</th><th className="right">Montant</th></tr></thead>
        <tbody>{report.pending_receptions.map((row) => <tr key={row.id}><td>{row.purchase_number}</td><td>{row.purchase_date}</td><td>{row.supplier_name}</td><td>{receptionStatusLabel(row.reception_status)}</td><td className="right">{money(row.total_amount)} USD</td></tr>)}</tbody>
      </table>
    </Section>
    <Section title="Dettes fournisseurs">
      <table><thead><tr><th>N° achat</th><th>Fournisseur</th><th>Echeance</th><th>Paiement</th><th className="right">Reste</th></tr></thead>
        <tbody>{report.unpaid_purchases.map((row) => <tr key={row.id}><td>{row.purchase_number}</td><td>{row.supplier_name}</td><td>{row.due_date ?? '-'}</td><td>{paymentStatusLabel(row.payment_status)}</td><td className="right">{money(row.outstanding_amount)} USD</td></tr>)}</tbody>
      </table>
    </Section>
    <Section title="Alertes stock">
      <table><thead><tr><th>Article</th><th>Niveau</th><th className="right">Stock</th><th className="right">Seuil</th><th>Canal</th><th>Statut</th></tr></thead>
        <tbody>{report.alerts.map((row) => <tr key={row.id}><td>{row.item_code} - {row.item_name}</td><td>{row.level === 'OUT_OF_STOCK' ? 'Rupture' : 'Sous seuil'}</td><td className="right">{row.quantity}</td><td className="right">{row.minimum_quantity}</td><td>{row.channel}</td><td>{row.status}</td></tr>)}</tbody>
      </table>
    </Section>
  </section>;
}

function exportPurchaseRow(purchase: StockPurchase) {
  return {
    numero: purchase.purchase_number,
    date: purchase.purchase_date,
    fournisseur: purchase.supplier_name,
    montant: purchase.total_amount,
    paye: purchase.paid_amount,
    reste: purchase.outstanding_amount,
    reception: receptionStatusLabel(purchase.reception_status),
    paiement: paymentStatusLabel(purchase.payment_status),
  };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <div className="detail-section"><h4>{title}</h4>{children}</div>;
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return <div className="mini-stat"><span>{label}</span><strong>{value}</strong></div>;
}
