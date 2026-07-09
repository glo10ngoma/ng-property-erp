import { ArrowLeft, FileSpreadsheet, Printer } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, exportXlsxWorkbook, money, shortDate } from '../api';
import { EmptyState, PageHeader } from '../components';
import { StockNav } from '../modules/stock/StockNav';
import type { InventoryLine, StockItem, StockMovement } from '../modules/stock/stock.types';
import { exportMovement, exportStockItem, movementLabel, stockStatusLabel } from '../modules/stock/stock.utils';

type Alert = { id: number; level: string; quantity: number; minimum_quantity: number; channel: string; status: string; created_at: string; resolved_at?: string };
type InventoryHistory = Pick<InventoryLine, 'theoretical_quantity' | 'physical_quantity' | 'difference_quantity' | 'difference_cost'> & { inventory_number: string; count_date: string; status: string };
type Detail = StockItem & { movements: StockMovement[]; inventories: InventoryHistory[]; alerts: Alert[] };

export function StockDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [item, setItem] = useState<Detail | null>(null);
  useEffect(() => { if (id) api.get<Detail>(`/stock/items/${id}`).then((response) => setItem(response.data)); }, [id]);
  const value = useMemo(() => Number(item?.current_quantity ?? 0) * Number(item?.average_purchase_price ?? item?.purchase_price ?? 0), [item]);
  if (!item) return <section><PageHeader title="Fiche article" /><EmptyState message="Chargement de l'article..." /></section>;
  const maintenance = item.movements.filter((row) => row.source === 'MAINTENANCE');
  const exportAll = () => exportXlsxWorkbook(`Article_${item.code ?? item.id}.xlsx`, [
    { name: 'Résumé', rows: [exportStockItem(item)] },
    { name: 'Mouvements', rows: item.movements.map(exportMovement) },
    { name: 'Maintenance', rows: maintenance.map(exportMovement) },
    { name: 'Inventaires', rows: item.inventories },
    { name: 'Alertes', rows: item.alerts },
    { name: 'Documents', rows: [{ piece_jointe: item.attachment_file_name ?? 'Non disponible' }] },
  ]);
  return <section>
    <PageHeader title={`Fiche article - ${item.name}`} /><StockNav />
    <div className="actions-row"><button className="secondary" onClick={() => navigate('/stock')}><ArrowLeft size={16} />Retour</button><button className="secondary" onClick={() => window.print()}><Printer size={16} />Imprimer</button><button onClick={exportAll}><FileSpreadsheet size={16} />Excel</button></div>
    <div className="mini-stats"><Kpi label="Stock actuel" value={`${item.current_quantity ?? 0} ${item.unit ?? ''}`} /><Kpi label="Valeur stock" value={`${money(value)} USD`} /><Kpi label="Seuil sécurité" value={item.minimum_quantity ?? 0} /><Kpi label="Statut" value={stockStatusLabel(item)} /></div>
    <div className="detail-section"><h4>Informations article</h4><div className="detail-list">
      <span>Code</span><strong>{item.code ?? '—'}</strong><span>Catégorie</span><strong>{item.category ?? '—'}</strong><span>Magasin</span><strong>{item.store ?? '—'}</strong><span>Marque / modèle</span><strong>{[item.brand, item.model].filter(Boolean).join(' ') || '—'}</strong>
      <span>Fournisseur</span><strong>{item.supplier_name ?? item.supplier_reference ?? '—'}</strong><span>Code-barres</span><strong>{item.barcode ?? '—'}</strong><span>Description</span><strong>{item.description ?? '—'}</strong><span>Observations</span><strong>{item.observations ?? '—'}</strong>
    </div></div>
    <Section title="Historique des mouvements"><table><thead><tr><th>Date</th><th>Type</th><th className="right">Quantité</th><th className="right">Coût</th><th>Référence</th><th>Utilisateur</th></tr></thead><tbody>{item.movements.map((row) => <tr key={row.id}><td>{shortDate(row.movement_date)}</td><td>{movementLabel(row)}</td><td className="right">{row.quantity}</td><td className="right">{money(row.unit_price ?? 0)}</td><td>{row.reference ?? '—'}</td><td>{row.user_name ?? '—'}</td></tr>)}</tbody></table></Section>
    <Section title="Maintenances ayant consommé cet article">{maintenance.length ? <table><thead><tr><th>Date</th><th>Référence</th><th className="right">Quantité</th><th>Observation</th></tr></thead><tbody>{maintenance.map((row) => <tr key={row.id}><td>{shortDate(row.movement_date)}</td><td>{row.reference ?? '—'}</td><td className="right">{row.quantity}</td><td>{row.notes ?? '—'}</td></tr>)}</tbody></table> : <div className="compact-empty">Aucune consommation maintenance.</div>}</Section>
    <Section title="Inventaires concernés">{item.inventories.length ? <table><thead><tr><th>Inventaire</th><th>Date</th><th className="right">Théorique</th><th className="right">Physique</th><th className="right">Écart</th></tr></thead><tbody>{item.inventories.map((row) => <tr key={`${row.inventory_number}-${row.count_date}`}><td>{row.inventory_number}</td><td>{shortDate(row.count_date)}</td><td className="right">{row.theoretical_quantity}</td><td className="right">{row.physical_quantity}</td><td className="right">{row.difference_quantity}</td></tr>)}</tbody></table> : <div className="compact-empty">Aucun inventaire lié.</div>}</Section>
    <Section title="Alertes">{item.alerts.length ? <table><thead><tr><th>Date</th><th>Niveau</th><th>Canal</th><th>Statut</th></tr></thead><tbody>{item.alerts.map((row) => <tr key={row.id}><td>{shortDate(row.created_at)}</td><td>{row.level === 'OUT_OF_STOCK' ? 'Rupture' : 'Sous seuil'}</td><td>{row.channel}</td><td>{row.status}</td></tr>)}</tbody></table> : <div className="compact-empty">Aucune alerte.</div>}</Section>
    <Section title="Documents"><div className="compact-empty">{item.attachment_file_name ?? 'Aucun document enregistré.'}</div></Section>
  </section>;
}
function Kpi({ label, value }: { label: string; value: string | number }) { return <div className="mini-stat"><span>{label}</span><strong>{value}</strong></div>; }
function Section({ title, children }: { title: string; children: React.ReactNode }) { return <div className="detail-section"><h4>{title}</h4>{children}</div>; }
