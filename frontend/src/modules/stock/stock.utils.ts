import { money, shortDate } from '../../api';
import type { StockItem, StockMovement } from './stock.types';

export function stockStatusLabel(item: StockItem) {
  return ({ OK: 'Disponible', LOW_STOCK: 'Sous seuil', OUT_OF_STOCK: 'Rupture', INACTIVE: 'Inactif' } as Record<string, string>)[item.stock_alert ?? ''] ?? item.status;
}

export function movementLabel(movement: StockMovement | string) {
  const type = typeof movement === 'string' ? movement : movement.type;
  const source = typeof movement === 'string' ? '' : movement.source;
  if (source === 'MAINTENANCE') return 'Consommation maintenance';
  return ({ IN: 'Entrée', OUT: 'Sortie', ENTRY: 'Entrée', EXIT: 'Sortie', INVENTORY: 'Stock initial',
    INVENTORY_GAIN: 'Ajustement inventaire', INVENTORY_LOSS: 'Ajustement inventaire',
    INVENTORY_ADJUSTMENT: 'Ajustement inventaire', RETURN: 'Retour', CANCELLED: 'Annulé' } as Record<string, string>)[type] ?? type;
}

export function exportStockItem(item: StockItem) {
  const unitCost = Number(item.average_purchase_price ?? item.purchase_price ?? 0);
  return {
    code: item.code ?? '—', article: item.name, categorie: item.category ?? '—', magasin: item.store ?? '—',
    stock_actuel: Number(item.current_quantity ?? 0), seuil_securite: Number(item.minimum_quantity ?? 0),
    unite: item.unit ?? '—', cout_moyen: unitCost, valeur_stock: Number(item.current_quantity ?? 0) * unitCost,
    statut: stockStatusLabel(item), derniere_entree: item.last_entry_date ? shortDate(item.last_entry_date) : '—',
    derniere_sortie: item.last_exit_date ? shortDate(item.last_exit_date) : '—',
  };
}

export function exportMovement(item: StockMovement) {
  return { date: shortDate(item.movement_date), type: movementLabel(item), article: item.item_name,
    quantite: item.quantity, cout_unitaire: Number(item.unit_price ?? 0), valeur: money(Number(item.quantity) * Number(item.unit_price ?? 0)),
    reference: item.reference ?? '—', source: item.source ?? '—', utilisateur: item.user_name ?? '—', observation: item.notes ?? '—' };
}
