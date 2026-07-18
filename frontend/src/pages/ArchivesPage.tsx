import { Eye } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { includesText, shortDate } from '../api';
import { useAuth } from '../auth';
import { EmptyState, PageHeader, SuccessMessage } from '../components';
import {
  type ArchiveListItem,
  type LifecycleObjectFilter,
  archiveEntityProviders,
  lifecycleEntityLabel,
  lifecycleObjectOptions,
} from './recordLifecycle';

export function ArchivesPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<ArchiveListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [objectType, setObjectType] = useState<LifecycleObjectFilter>('all');
  const [archivedByFilter, setArchivedByFilter] = useState('');
  const [archivedDateFilter, setArchivedDateFilter] = useState('');
  const [success] = useState('');
  const canReadArchives = can('leases.archives.read');

  const enabledProviders = useMemo(
    () => (canReadArchives ? [archiveEntityProviders.lease] : []),
    [canReadArchives],
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
        .filter((item) => !archivedByFilter || String(item.archivedBy ?? '').toLowerCase().includes(archivedByFilter.toLowerCase()))
        .filter((item) => !archivedDateFilter || String(item.archivedAt ?? '').slice(0, 10) === archivedDateFilter),
    [rows, objectType, query, archivedByFilter, archivedDateFilter],
  );

  return (
    <section>
      <PageHeader title="Archives" />
      <p style={{ margin: '-4px 0 12px', color: '#637783' }}>
        Consultez les éléments archivés et leur historique.
      </p>
      <SuccessMessage message={success} />

      <div className="quick-form">
        <input placeholder="Recherche" value={query} onChange={(event) => setQuery(event.target.value)} />
        <select value={objectType} onChange={(event) => setObjectType(event.target.value as LifecycleObjectFilter)}>
          {lifecycleObjectOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <input placeholder="Archivé par" value={archivedByFilter} onChange={(event) => setArchivedByFilter(event.target.value)} />
        <input type="date" value={archivedDateFilter} onChange={(event) => setArchivedDateFilter(event.target.value)} />
        <div className="filter-actions">
          <button type="button" className="secondary" onClick={() => { setQuery(''); setObjectType('all'); setArchivedByFilter(''); setArchivedDateFilter(''); }}>
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
              <th>Date d’archivage</th>
              <th>Archivé par</th>
              <th>Motif</th>
              <th>Historique</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => {
              const provider = archiveEntityProviders[item.entityType];
              return (
                <tr key={`${item.entityType}-${item.recordId}`}>
                  <td>{lifecycleEntityLabel(item.entityType)}</td>
                  <td>{item.reference}</td>
                  <td>{item.designation}</td>
                  <td>{item.associatedInfo || '-'}</td>
                  <td>{item.archivedAt ? shortDate(item.archivedAt) : '-'}</td>
                  <td>{item.archivedBy || '-'}</td>
                  <td>{item.reason || '-'}</td>
                  <td>{item.hasHistory ? 'Oui' : 'Non'}</td>
                  <td className="actions actions-compact">
                    <button className="icon-btn" title="Consulter" onClick={() => navigate(provider.buildDetailPath(item.recordId))}>
                      <Eye size={16} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!filtered.length ? (
          <EmptyState
            title={loading ? 'Chargement...' : 'Aucune archive'}
            message={loading ? 'Chargement des éléments archivés...' : 'Aucun élément archivé n’est disponible pour votre organisation.'}
          />
        ) : null}
      </div>
    </section>
  );
}
