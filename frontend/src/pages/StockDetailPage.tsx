import { ArrowLeft, FileSpreadsheet, History, Pencil, Printer } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, exportExcel, money, shortDate, statusLabel } from '../api';
import { EmptyState, PageHeader, SuccessMessage } from '../components';

type StockMovement = {
  id: number;
  movement_number?: string;
  item_name: string;
  type: string;
  quantity: number;
  movement_date: string;
  reference?: string;
  destination?: string;
  quantity_before?: number;
  quantity_after?: number;
  user_name?: string;
  notes?: string;
};

type StockItemDetail = {
  id: number;
  code?: string;
  name: string;
  category?: string;
  store?: string;
  unit?: string;
  current_quantity?: number;
  minimum_quantity?: number;
  purchase_price?: number;
  average_purchase_price?: number;
  description?: string;
  observations?: string;
  barcode?: string;
  supplier_reference?: string;
  brand?: string;
  model?: string;
  status: string;
  movements: StockMovement[];
};

export function StockDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [item, setItem] = useState<StockItemDetail | null>(null);
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (!id) return;
    api.get<StockItemDetail>(`/stock/items/${id}`).then((response) => setItem(response.data));
  }, [id]);

  const value = useMemo(() => Number(item?.current_quantity ?? 0) * Number(item?.average_purchase_price ?? item?.purchase_price ?? 0), [item]);

  if (!item) {
    return <section><PageHeader title="Fiche article" /><EmptyState /></section>;
  }

  return (
    <section>
      <PageHeader title={`Fiche article - ${item.name}`} />
      <SuccessMessage message={success} />
      <div className="actions-row">
        <button className="secondary" onClick={() => navigate('/stock')}><ArrowLeft size={16} />Retour</button>
        <button className="secondary" onClick={() => navigate('/stock')}><Pencil size={16} />Modifier</button>
        <button className="secondary" onClick={() => window.print()}><Printer size={16} />Imprimer</button>
        <button className="secondary" onClick={() => exportExcel(`stock-${item.code ?? item.id}.xls`, [{ code: item.code ?? '-', article: item.name, categorie: item.category ?? '-', magasin: item.store ?? '-', stock_actuel: item.current_quantity ?? 0, seuil_min: item.minimum_quantity ?? 0, unite: item.unit ?? '-', cout: money(item.average_purchase_price ?? item.purchase_price ?? 0), valeur_stock: money(value) }])}><FileSpreadsheet size={16} />Excel</button>
      </div>
      <div className="mini-stats">
        <div className="mini-stat"><span>Stock actuel</span><strong>{item.current_quantity ?? 0}</strong></div>
        <div className="mini-stat"><span>Valeur</span><strong>{money(value)}</strong></div>
        <div className="mini-stat"><span>Seuil mini</span><strong>{item.minimum_quantity ?? 0}</strong></div>
      </div>
      <div className="detail-list">
        <span>Code</span><strong>{item.code ?? '-'}</strong>
        <span>Article</span><strong>{item.name}</strong>
        <span>Catégorie</span><strong>{item.category ?? '-'}</strong>
        <span>Magasin</span><strong>{item.store ?? '-'}</strong>
        <span>Unité</span><strong>{item.unit ?? '-'}</strong>
        <span>Coût unitaire</span><strong>{money(item.average_purchase_price ?? item.purchase_price ?? 0)}</strong>
        <span>Statut</span><strong>{statusLabel(item.status)}</strong>
        <span>Observations</span><strong>{item.observations ?? '-'}</strong>
      </div>
      <div className="detail-section" id="history">
        <h4>Historique mouvements</h4>
        <table>
          <thead>
            <tr><th>Date</th><th>Type</th><th className="right">Quantité</th><th className="right">Avant</th><th className="right">Après</th><th>Référence</th></tr>
          </thead>
          <tbody>
            {item.movements.map((movement) => (
              <tr key={movement.id}>
                <td>{shortDate(movement.movement_date)}</td>
                <td>{movementTypeLabel(movement.type)}</td>
                <td className="right">{movement.quantity}</td>
                <td className="right">{movement.quantity_before ?? '-'}</td>
                <td className="right">{movement.quantity_after ?? '-'}</td>
                <td>{movement.reference ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="detail-section">
        <h4>Dernières entrées / sorties</h4>
        <div className="compact-list">
          {item.movements.slice(0, 6).map((movement) => <div className="compact-item" key={movement.id}><span>{shortDate(movement.movement_date)} | {movementTypeLabel(movement.type)} | {movement.quantity}</span></div>)}
        </div>
      </div>
      <div className="detail-section">
        <h4>Maintenances ayant consommé cet article</h4>
        <div className="compact-empty">Aucune donnée disponible pour le moment.</div>
      </div>
      <div className="detail-section">
        <h4>Documents</h4>
        <div className="compact-empty">Aucun document enregistré.</div>
      </div>
      <div className="detail-section">
        <h4>Informations complémentaires</h4>
        <div className="detail-list">
          <span>Code-barres</span><strong>{item.barcode ?? '-'}</strong>
          <span>Référence fournisseur</span><strong>{item.supplier_reference ?? '-'}</strong>
          <span>Marque</span><strong>{item.brand ?? '-'}</strong>
          <span>Modèle</span><strong>{item.model ?? '-'}</strong>
          <span>Description</span><strong>{item.description ?? '-'}</strong>
        </div>
      </div>
    </section>
  );
}

function movementTypeLabel(value: string) {
  return ({ IN: 'Entrée', OUT: 'Sortie', INVENTORY: 'Inventaire', ADJUSTMENT: 'Correction' } as Record<string, string>)[value] ?? value;
}
