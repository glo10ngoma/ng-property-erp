import { Archive, Eye, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { includesText, shortDate } from '../api';
import { useAuth } from '../auth';
import { EmptyState, Modal, PageHeader, SuccessMessage } from '../components';
import {
  type LifecycleObjectFilter,
  type LeaseDeletionImpact,
  type TrashListItem,
  lifecycleEntityLabel,
  lifecycleObjectOptions,
  trashEntityProviders,
} from './recordLifecycle';

const permanentDeleteConfirmationText = 'SUPPRIMER DÉFINITIVEMENT';

type DeleteTarget = {
  item: TrashListItem;
  impact: LeaseDeletionImpact | null;
  error: string;
};

export function TrashPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<TrashListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [objectType, setObjectType] = useState<LifecycleObjectFilter>('all');
  const [deletedByFilter, setDeletedByFilter] = useState('');
  const [deletedDateFilter, setDeletedDateFilter] = useState('');
  const [success, setSuccess] = useState('');
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [archiveReason, setArchiveReason] = useState('');
  const canReadTrash = can('leases.trash.read');
  const canRestore = can('leases.restore');
  const canArchive = can('leases.archive');
  const canHardDelete = can('leases.hard_delete');

  const enabledProviders = useMemo(
    () => (canReadTrash ? [trashEntityProviders.lease] : []),
    [canReadTrash],
  );

  async function loadRows() {
    setLoading(true);
    try {
      const loaded = await Promise.all(enabledProviders.map((provider) => provider.load()));
      setRows(loaded.flat());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRows();
  }, [enabledProviders]);

  const filtered = useMemo(
    () =>
      rows
        .filter((item) => objectType === 'all' || item.entityType === objectType)
        .filter((item) => includesText(item, query))
        .filter((item) => !deletedByFilter || String(item.deletedBy ?? '').toLowerCase().includes(deletedByFilter.toLowerCase()))
        .filter((item) => !deletedDateFilter || String(item.deletedAt ?? '').slice(0, 10) === deletedDateFilter),
    [rows, objectType, query, deletedByFilter, deletedDateFilter],
  );

  async function restoreItem(item: TrashListItem) {
    const provider = trashEntityProviders[item.entityType];
    const actionId = `${item.entityType}-${item.recordId}-restore`;
    setActionKey(actionId);
    try {
      await provider.restore(item.recordId);
      setSuccess('Élément restauré avec succès.');
      await loadRows();
    } catch (err: any) {
      const message = err?.response?.data?.message;
      window.alert(Array.isArray(message) ? message.join(' | ') : message || 'Impossible de restaurer cet élément.');
    } finally {
      setActionKey(null);
    }
  }

  async function openPermanentDelete(item: TrashListItem) {
    const provider = trashEntityProviders[item.entityType];
    setDeleteTarget({ item, impact: null, error: '' });
    setDeleteReason('');
    setDeleteConfirmation('');
    setArchiveReason('');
    try {
      const impact = await provider.loadDeletionImpact(item.recordId);
      setDeleteTarget({ item, impact, error: '' });
    } catch (err: any) {
      const message = err?.response?.data?.message;
      setDeleteTarget({
        item,
        impact: null,
        error: Array.isArray(message) ? message.join(' | ') : message || 'Impossible de charger les dépendances.',
      });
    }
  }

  async function confirmPermanentDelete() {
    if (!deleteTarget) return;
    const provider = trashEntityProviders[deleteTarget.item.entityType];
    const actionId = `${deleteTarget.item.entityType}-${deleteTarget.item.recordId}-permanent`;
    setActionKey(actionId);
    try {
      const result = await provider.permanentDelete(deleteTarget.item.recordId, deleteReason);
      setSuccess(result.archived ? 'L’élément a été archivé définitivement.' : 'L’élément a été supprimé définitivement.');
      setDeleteTarget(null);
      await loadRows();
    } catch (err: any) {
      const message = err?.response?.data?.message;
      setDeleteTarget((current) => current ? {
        ...current,
        error: Array.isArray(message) ? message.join(' | ') : message || 'Impossible de finaliser cette suppression.',
      } : current);
    } finally {
      setActionKey(null);
    }
  }

  async function archiveItem() {
    if (!deleteTarget) return;
    const provider = trashEntityProviders[deleteTarget.item.entityType];
    const actionId = `${deleteTarget.item.entityType}-${deleteTarget.item.recordId}-archive`;
    setActionKey(actionId);
    try {
      await provider.archive(deleteTarget.item.recordId, archiveReason);
      setSuccess('Élément archivé avec succès.');
      setDeleteTarget(null);
      await loadRows();
    } catch (err: any) {
      const message = err?.response?.data?.message;
      setDeleteTarget((current) => current ? {
        ...current,
        error: Array.isArray(message) ? message.join(' | ') : message || 'Impossible d’archiver cet élément.',
      } : current);
    } finally {
      setActionKey(null);
    }
  }

  return (
    <section>
      <PageHeader title="Corbeille" />
      <p style={{ margin: '-4px 0 12px', color: '#637783' }}>
        Consultez, restaurez ou traitez les éléments supprimés de votre organisation.
      </p>
      <SuccessMessage message={success} />

      <div className="quick-form">
        <input placeholder="Recherche" value={query} onChange={(event) => setQuery(event.target.value)} />
        <select value={objectType} onChange={(event) => setObjectType(event.target.value as LifecycleObjectFilter)}>
          {lifecycleObjectOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <input placeholder="Supprimé par" value={deletedByFilter} onChange={(event) => setDeletedByFilter(event.target.value)} />
        <input type="date" value={deletedDateFilter} onChange={(event) => setDeletedDateFilter(event.target.value)} />
        <div className="filter-actions">
          <button type="button" className="secondary" onClick={() => { setQuery(''); setObjectType('all'); setDeletedByFilter(''); setDeletedDateFilter(''); }}>
            Réinitialiser
          </button>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Référence</th>
              <th>Désignation</th>
              <th>Informations associées</th>
              <th>Date de suppression</th>
              <th>Supprimé par</th>
              <th>Motif</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => {
              const provider = trashEntityProviders[item.entityType];
              const restoreAction = `${item.entityType}-${item.recordId}-restore`;
              const deleteAction = `${item.entityType}-${item.recordId}-permanent`;
              const archiveAction = `${item.entityType}-${item.recordId}-archive`;

              return (
                <tr key={`${item.entityType}-${item.recordId}`}>
                  <td>{lifecycleEntityLabel(item.entityType)}</td>
                  <td>{item.reference}</td>
                  <td>{item.designation}</td>
                  <td>{item.associatedInfo || '-'}</td>
                  <td>{item.deletedAt ? shortDate(item.deletedAt) : '-'}</td>
                  <td>{item.deletedBy || '-'}</td>
                  <td>{item.reason || '-'}</td>
                  <td className="actions actions-compact">
                    <button className="icon-btn" title="Consulter" onClick={() => navigate(provider.buildDetailPath(item.recordId))}>
                      <Eye size={16} />
                    </button>
                    {canRestore ? (
                      <button className="icon-btn" title="Restaurer" onClick={() => void restoreItem(item)} disabled={actionKey === restoreAction}>
                        <RotateCcw size={16} />
                      </button>
                    ) : null}
                    {canArchive ? (
                      <button className="icon-btn" title="Archiver définitivement" onClick={() => void openPermanentDelete(item)} disabled={actionKey === archiveAction}>
                        <Archive size={16} />
                      </button>
                    ) : null}
                    {canHardDelete ? (
                      <button className="icon-btn danger" title="Supprimer définitivement" onClick={() => void openPermanentDelete(item)} disabled={actionKey === deleteAction}>
                        <Trash2 size={16} />
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!filtered.length ? (
          <EmptyState
            title={loading ? 'Chargement...' : 'La corbeille est vide'}
            message={loading ? 'Chargement des éléments supprimés...' : 'Aucun élément supprimé n’est disponible pour votre organisation.'}
          />
        ) : null}
      </div>

      {deleteTarget ? (
        <Modal
          title="Traitement définitif"
          onClose={() => setDeleteTarget(null)}
          footer={(
            <>
              <button type="button" className="secondary" onClick={() => setDeleteTarget(null)}>Annuler</button>
              {canArchive ? (
                <button type="button" className="secondary" onClick={() => void archiveItem()} disabled={actionKey === `${deleteTarget.item.entityType}-${deleteTarget.item.recordId}-archive`}>
                  Archiver définitivement
                </button>
              ) : null}
              {canHardDelete ? (
                <button
                  type="button"
                  onClick={() => void confirmPermanentDelete()}
                  disabled={
                    actionKey === `${deleteTarget.item.entityType}-${deleteTarget.item.recordId}-permanent`
                    || !deleteTarget.impact
                    || deleteConfirmation !== permanentDeleteConfirmationText
                  }
                >
                  Supprimer définitivement
                </button>
              ) : null}
            </>
          )}
        >
          <p>Le backend existant reste la source de vérité pour l’analyse d’impact, la suppression physique et l’archivage définitif.</p>
          {deleteTarget.impact ? (
            <div className="compact-list">
              <div className="compact-item"><span>Suppression physique possible</span><strong>{deleteTarget.impact.canHardDelete ? 'Oui' : 'Non'}</strong></div>
              <div className="compact-item"><span>Historique financier</span><strong>{deleteTarget.impact.hasFinancialHistory ? 'Oui' : 'Non'}</strong></div>
              <div className="compact-item" style={{ alignItems: 'flex-start' }}>
                <span>Dépendances</span>
                <strong>{deleteTarget.impact.dependencies.length ? deleteTarget.impact.dependencies.map((entry) => `${entry.type} (${entry.count})`).join(' · ') : 'Aucune'}</strong>
              </div>
            </div>
          ) : (
            <div className="compact-empty">Chargement de l’analyse d’impact...</div>
          )}
          <label style={{ display: 'grid', gap: 6, marginTop: 12 }}>
            Commentaire suppression
            <textarea rows={3} value={deleteReason} onChange={(event) => setDeleteReason(event.target.value)} placeholder="Commentaire facultatif" />
          </label>
          <label style={{ display: 'grid', gap: 6, marginTop: 12 }}>
            Motif d’archivage
            <textarea rows={3} value={archiveReason} onChange={(event) => setArchiveReason(event.target.value)} placeholder="Motif facultatif" />
          </label>
          <label style={{ display: 'grid', gap: 6, marginTop: 12 }}>
            Confirmation obligatoire
            <input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} placeholder={permanentDeleteConfirmationText} />
          </label>
          {deleteTarget.error ? <div className="error-banner" style={{ marginTop: 10 }}>{deleteTarget.error}</div> : null}
        </Modal>
      ) : null}
    </section>
  );
}
