import { ArrowLeft, FileDown, FileSpreadsheet, Printer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, exportXlsxWorkbook, money, shortDate } from '../../../api';
import { EmptyState, PageHeader } from '../../../components';
import { StockNav } from '../StockNav';
import type { StockMovement } from '../stock.types';
import { movementLabel } from '../stock.utils';

type MovementHistory = {
  id: number;
  action: string;
  description?: string;
  user_name?: string;
  created_at: string;
};

type MovementDetail = StockMovement & {
  history: MovementHistory[];
  document_reference?: string;
  document_observations?: string;
};

export function StockMovementDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [movement, setMovement] = useState<MovementDetail | null>(null);

  useEffect(() => {
    if (id) api.get<MovementDetail>(`/stock/movements/${id}`).then((response) => setMovement(response.data));
  }, [id]);

  if (!movement) return <section><PageHeader title="Fiche mouvement" /><EmptyState message="Chargement du mouvement..." /></section>;

  const value = Number(movement.quantity) * Number(movement.unit_price ?? 0);
  const exportExcel = () => exportXlsxWorkbook(`Mouvement_${movement.movement_number ?? movement.id}.xlsx`, [
    { name: 'Mouvement', rows: [{
      numero: movement.movement_number,
      type: movementLabel(movement),
      document_origine: movement.document_number ?? '—',
      date: shortDate(movement.movement_date),
      utilisateur: movement.user_name ?? '—',
      article: movement.item_name,
      magasin: movement.store ?? '—',
      quantite: movement.quantity,
      cout_unitaire: movement.unit_price ?? 0,
      valeur: value,
      stock_avant: movement.quantity_before ?? 0,
      stock_apres: movement.quantity_after ?? 0,
      reference: movement.document_reference ?? movement.reference ?? '—',
      motif: movement.document_reason ?? '—',
      observations: movement.document_observations ?? movement.notes ?? '—',
      piece_jointe: movement.attachment_file_name ?? 'Non disponible',
    }] },
    { name: 'Historique', rows: movement.history.map((row) => ({ date: shortDate(row.created_at), action: row.action, description: row.description ?? '—', utilisateur: row.user_name ?? '—' })) },
  ]);

  return (
    <section className="stock-movement-detail">
      <PageHeader title={`Mouvement ${movement.movement_number ?? `#${movement.id}`}`} />
      <StockNav />
      <div className="actions-row no-print">
        <button className="secondary" onClick={() => navigate('/stock/movements')}><ArrowLeft size={16} />Retour</button>
        <button className="secondary" onClick={() => window.print()}><Printer size={16} />Imprimer</button>
        <button className="secondary" onClick={() => window.print()}><FileDown size={16} />Exporter PDF</button>
        <button onClick={exportExcel}><FileSpreadsheet size={16} />Exporter Excel</button>
      </div>
      <div className="compact-detail-banner">
        <span><small>N° mouvement</small><strong>{movement.movement_number ?? `#${movement.id}`}</strong></span>
        <span><small>Type</small><strong>{movementLabel(movement)}</strong></span>
        <span><small>Document d’origine</small><strong>{movement.document_number ?? '—'}</strong></span>
        <span><small>Date</small><strong>{shortDate(movement.movement_date)}</strong></span>
        <span><small>Utilisateur</small><strong>{movement.user_name ?? '—'}</strong></span>
      </div>
      <div className="mini-stats">
        <Kpi label="Quantité" value={`${movement.quantity} ${movement.unit ?? ''}`} />
        <Kpi label="Coût unitaire" value={`${money(movement.unit_price ?? 0)} USD`} />
        <Kpi label="Valeur" value={`${money(value)} USD`} />
        <Kpi label="Stock avant" value={movement.quantity_before ?? 0} />
        <Kpi label="Stock après" value={movement.quantity_after ?? 0} />
      </div>
      <div className="detail-section"><h4>Informations générales</h4><div className="detail-list">
        <span>Article</span><strong>{movement.item_name}</strong>
        <span>Code article</span><strong>{movement.item_code ?? '—'}</strong>
        <span>Magasin</span><strong>{movement.store ?? '—'}</strong>
        <span>Référence</span><strong>{movement.document_reference ?? movement.reference ?? '—'}</strong>
        <span>Motif</span><strong>{movement.document_reason ?? '—'}</strong>
        <span>Observations</span><strong>{movement.document_observations ?? movement.notes ?? '—'}</strong>
        <span>Pièce jointe</span><strong>{movement.attachment_file_name ?? 'Aucune pièce jointe'}</strong>
      </div></div>
      <div className="detail-section"><h4>Historique des modifications</h4>
        {movement.history.length ? <table><thead><tr><th>Date</th><th>Action</th><th>Description</th><th>Utilisateur</th></tr></thead><tbody>
          {movement.history.map((row) => <tr key={row.id}><td>{shortDate(row.created_at)}</td><td>{row.action === 'CREATED' ? 'Création' : row.action}</td><td>{row.description ?? '—'}</td><td>{row.user_name ?? '—'}</td></tr>)}
        </tbody></table> : <div className="compact-empty">Aucun historique disponible.</div>}
      </div>
    </section>
  );
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return <div className="mini-stat"><span>{label}</span><strong>{value}</strong></div>;
}
