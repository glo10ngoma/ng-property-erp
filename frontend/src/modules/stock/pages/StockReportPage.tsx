import { FileSpreadsheet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, exportXlsxWorkbook, money } from '../../../api';
import { PageHeader } from '../../../components';
import { StockNav } from '../StockNav';
import type { StockInventory, StockItem, StockMovement } from '../stock.types';
import { exportMovement, exportStockItem } from '../stock.utils';

type StockAlert = { id: number; item_code?: string; item_name: string; level: string; quantity: number; minimum_quantity: number; channel: string; status: string; created_at: string };
type StockReport = {
  items: StockItem[]; movements: StockMovement[]; inventories: StockInventory[]; alerts: StockAlert[];
  under_minimum: StockItem[]; out_of_stock: StockItem[]; valuation: number;
  by_category: Array<{ category: string; quantity: number; value: number }>;
  by_store: Array<{ store: string; quantity: number; value: number }>;
  maintenance_consumption: StockMovement[];
};

export function StockReportPage() {
  const [report, setReport] = useState<StockReport | null>(null);
  useEffect(() => { api.get<StockReport>('/stock/report').then((response) => setReport(response.data)); }, []);
  if (!report) return <section><PageHeader title="Rapport Stock" /><StockNav /></section>;
  const exportAll = () => exportXlsxWorkbook('Rapport_stock_avance.xlsx', [
    { name: 'Résumé', rows: [{ valeur_totale: report.valuation, articles: report.items.length, ruptures: report.out_of_stock.length, sous_seuil: report.under_minimum.length }] },
    { name: 'État stock', rows: report.items.map(exportStockItem) },
    { name: 'Ruptures', rows: report.out_of_stock.map(exportStockItem) },
    { name: 'Sous seuil', rows: report.under_minimum.map(exportStockItem) },
    { name: 'Mouvements', rows: report.movements.map(exportMovement) },
    { name: 'Consommation maintenance', rows: report.maintenance_consumption.map(exportMovement) },
    { name: 'Inventaires', rows: report.inventories },
    { name: 'Écarts inventaire', rows: report.inventories.map((item) => ({ numero: item.inventory_number, ecart_positif: item.positive_difference ?? 0, ecart_negatif: item.negative_difference ?? 0, valeur_ecart: item.difference_value ?? 0 })) },
    { name: 'Valorisation', rows: report.items.map(exportStockItem) },
    { name: 'Alertes', rows: report.alerts },
  ]);
  return <section>
    <PageHeader title="Rapport Stock" /><StockNav />
    <div className="actions-row"><button onClick={exportAll}><FileSpreadsheet size={16} />Exporter Excel</button></div>
    <div className="mini-stats"><Kpi label="Valeur totale" value={`${money(report.valuation)} USD`} /><Kpi label="Articles" value={report.items.length} /><Kpi label="Ruptures" value={report.out_of_stock.length} /><Kpi label="Sous seuil" value={report.under_minimum.length} /><Kpi label="Alertes" value={report.alerts.length} /></div>
    <div className="detail-section"><h4>Stock par catégorie</h4><table><thead><tr><th>Catégorie</th><th className="right">Quantité</th><th className="right">Valeur</th></tr></thead><tbody>{report.by_category.map((row) => <tr key={row.category}><td>{row.category}</td><td className="right">{row.quantity}</td><td className="right">{money(row.value)} USD</td></tr>)}</tbody></table></div>
    <div className="detail-section"><h4>Stock par magasin</h4><table><thead><tr><th>Magasin</th><th className="right">Quantité</th><th className="right">Valeur</th></tr></thead><tbody>{report.by_store.map((row) => <tr key={row.store}><td>{row.store}</td><td className="right">{row.quantity}</td><td className="right">{money(row.value)} USD</td></tr>)}</tbody></table></div>
    <div className="detail-section"><h4>Alertes stock</h4><table><thead><tr><th>Article</th><th>Niveau</th><th className="right">Stock</th><th className="right">Seuil</th><th>Canal</th><th>Statut</th></tr></thead><tbody>{report.alerts.map((row) => <tr key={row.id}><td>{row.item_code} - {row.item_name}</td><td>{row.level === 'OUT_OF_STOCK' ? 'Rupture' : 'Sous seuil'}</td><td className="right">{row.quantity}</td><td className="right">{row.minimum_quantity}</td><td>{row.channel}</td><td>{row.status}</td></tr>)}</tbody></table></div>
  </section>;
}
function Kpi({ label, value }: { label: string; value: string | number }) { return <div className="mini-stat"><span>{label}</span><strong>{value}</strong></div>; }
