import { Archive, Download, Eye, FileDown, FilePlus, Pencil, Receipt, RotateCcw, ScrollText, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, exportCsv, exportXlsxWorkbook, includesText, shortDate, statusLabel } from '../../../api';
import { useAuth } from '../../../auth';
import { EmptyState, Modal, PageHeader, SearchableSelect, StatusBadge, SuccessMessage, TenantSearchSelect } from '../../../components';
import { useApiList } from '../../../hooks';
import { openOrDownloadDocument } from '../../../core/utils/documentActions';
import { formatLeaseReference } from '../../../utils/lease-reference';

type Lease = {
  id: number;
  lease_number?: number;
  tenant_id: number;
  unit_id: number;
  tenant_name: string;
  building_name: string;
  unit_number: string;
  start_date: string;
  end_date?: string;
  monthly_rent: number;
  monthly_syndic_amount?: number;
  rental_guarantee_amount: number;
  rental_guarantee_paid: number;
  rental_guarantee_payment_date?: string;
  rental_guarantee_status: string;
  guarantee_months?: number;
  guarantee_amount?: number;
  guarantee_paid?: number;
  guarantee_status?: string;
  lease_usage?: string;
  lease_activity_description?: string;
  maintenance_fee_amount?: number;
  other_charges_amount?: number;
  notice_months?: number;
  signature_place?: string;
  signature_date?: string;
  contract_file_name?: string;
  contract_file_url?: string;
  notes?: string;
  status: string;
  deleted_at?: string | null;
  deleted_by?: number | null;
  deleted_by_name?: string | null;
  deletion_reason?: string | null;
  archived_at?: string | null;
  archived_by?: number | null;
  archived_by_name?: string | null;
  archive_reason?: string | null;
};

type LeaseDetail = Lease & {
  guarantee?: { amount?: number; paid_amount?: number; payment_date?: string; status?: string } | null;
};

type LeaseDeletionImpact = {
  canHardDelete: boolean;
  hasFinancialHistory: boolean;
  dependencies: Array<{ type: string; count: number }>;
};
const permanentDeleteConfirmationText = 'SUPPRIMER DÉFINITIVEMENT';

type Building = { id: number; name: string; city?: string; building_type?: string };
type Unit = { id: number; building_id: number; building_name: string; number: string; monthly_rent: number; monthly_syndic_amount?: number; status: string };
type Tenant = { id: number; first_name: string; last_name: string; phone?: string; building_name?: string; unit_number?: string; company_name?: string; tenant_type?: string };

const emptyFilters = { building: '', unit: '', tenant: '', status: '', guarantee: '', start: '', end: '', contract: '', expiring: '' };
type LeaseView = 'active' | 'trash' | 'archive';

export function LeasesPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { data, reload } = useApiList<Lease>('/leases');
  const buildings = useApiList<Building>('/buildings');
  const units = useApiList<Unit>('/units');
  const tenants = useApiList<Tenant>('/tenants');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState(emptyFilters);
  const [editing, setEditing] = useState<LeaseDetail | null>(null);
  const [success, setSuccess] = useState('');
  const [view, setView] = useState<LeaseView>('active');
  const [trashData, setTrashData] = useState<Lease[]>([]);
  const [archiveData, setArchiveData] = useState<Lease[]>([]);
  const [secondaryLoading, setSecondaryLoading] = useState(false);
  const [actionLeaseId, setActionLeaseId] = useState<number | null>(null);
  const [trashTarget, setTrashTarget] = useState<Lease | null>(null);
  const [trashReason, setTrashReason] = useState('');
  const [trashError, setTrashError] = useState('');
  const [permanentTarget, setPermanentTarget] = useState<Lease | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deletionImpact, setDeletionImpact] = useState<LeaseDeletionImpact | null>(null);

  const canTrashRead = can('leases.trash.read');
  const canArchiveRead = can('leases.archives.read');
  const canTrashLease = can('leases.delete');
  const canRestoreLease = can('leases.restore');
  const canHardDeleteLease = can('leases.hard_delete');

  const currentRows = view === 'active' ? data : view === 'trash' ? trashData : archiveData;
  const buildingOptions = useMemo(() => Array.from(new Set(currentRows.map((lease) => lease.building_name).filter(Boolean))).sort(), [currentRows]);
  const filtered = useMemo(
    () => currentRows
      .filter((lease) => includesText(lease, query))
      .filter((lease) => !filters.building || lease.building_name === filters.building)
      .filter((lease) => !filters.unit || String(lease.unit_number ?? '').toLowerCase().includes(filters.unit.toLowerCase()))
      .filter((lease) => !filters.tenant || String(lease.tenant_name ?? '').toLowerCase().includes(filters.tenant.toLowerCase()))
      .filter((lease) => !filters.status || lease.status === filters.status)
      .filter((lease) => !filters.guarantee || guaranteeStatus(lease) === filters.guarantee)
      .filter((lease) => !filters.start || String(lease.start_date).slice(0, 10) >= filters.start)
      .filter((lease) => !filters.end || String(lease.end_date ?? lease.start_date).slice(0, 10) <= filters.end)
      .filter((lease) => !filters.contract || (filters.contract === 'PRESENT' ? Boolean(lease.contract_file_name) : !lease.contract_file_name))
      .filter((lease) => !filters.expiring || leaseExpiringSoon(lease)),
    [currentRows, filters, query],
  );

  const kpis = useMemo(() => ({
    total: filtered.length,
    active: filtered.filter(isCurrentActiveLease).length,
    expired: filtered.filter((lease) => lease.status === 'EXPIRED' || leaseExpired(lease)).length,
    terminated: filtered.filter((lease) => lease.status === 'TERMINATED').length,
    guaranteePaid: filtered.filter((lease) => guaranteeStatus(lease) === 'PAID').length,
    guaranteeUnpaid: filtered.filter((lease) => guaranteeStatus(lease) !== 'PAID').length,
    missingContracts: filtered.filter((lease) => !lease.contract_file_name).length,
    totalGuarantees: filtered.reduce((sum, lease) => sum + guaranteeAmount(lease), 0),
    totalActiveRents: filtered.filter(isCurrentActiveLease).reduce((sum, lease) => sum + leaseRentAmount(lease), 0),
  }), [filtered]);

  async function openEdit(leaseId: number) {
    const response = await api.get<LeaseDetail>(`/leases/${leaseId}`);
    setEditing({
      ...response.data,
      rental_guarantee_amount: Number(response.data.guarantee?.amount ?? response.data.rental_guarantee_amount ?? 0),
      rental_guarantee_paid: Number(response.data.guarantee?.paid_amount ?? response.data.rental_guarantee_paid ?? 0),
      rental_guarantee_payment_date: response.data.guarantee?.payment_date ?? response.data.rental_guarantee_payment_date,
      rental_guarantee_status: String(response.data.guarantee?.status ?? response.data.rental_guarantee_status ?? 'NOT_PAID'),
    });
  }

  async function terminate(id: number) {
    if (!window.confirm('Resilier ce bail ?')) return;
    await api.post(`/leases/${id}/terminate`, { reason: 'Resiliation depuis interface' });
    setSuccess('Bail resilie avec succes.');
    await reload();
  }

  async function invoice(id: number) {
    const response = await api.post(`/leases/${id}/invoice`);
    setSuccess(`Facture ${response.data.invoice_number} creee depuis le bail.`);
  }

  async function loadTrash() {
    if (!canTrashRead) return;
    setSecondaryLoading(true);
    try {
      const response = await api.get<Lease[]>('/leases/trash');
      setTrashData(response.data);
    } finally {
      setSecondaryLoading(false);
    }
  }

  async function loadArchives() {
    if (!canArchiveRead) return;
    setSecondaryLoading(true);
    try {
      const response = await api.get<Lease[]>('/leases/archives');
      setArchiveData(response.data);
    } finally {
      setSecondaryLoading(false);
    }
  }

  useEffect(() => {
    if (view === 'trash') {
      void loadTrash();
    }
    if (view === 'archive') {
      void loadArchives();
    }
  }, [view]);

  async function refreshCurrentView(nextView = view) {
    await reload();
    if (nextView === 'trash') await loadTrash();
    if (nextView === 'archive') await loadArchives();
  }

  async function confirmTrashLease() {
    if (!trashTarget) return;
    if (!trashReason.trim()) {
      setTrashError('Le motif de suppression est obligatoire.');
      return;
    }
    setActionLeaseId(trashTarget.id);
    setTrashError('');
    try {
      await api.patch(`/leases/${trashTarget.id}/trash`, { reason: trashReason.trim() });
      setSuccess('Le bail a ete deplace dans la corbeille.');
      setTrashTarget(null);
      setTrashReason('');
      await refreshCurrentView('active');
    } catch (err: any) {
      const message = err?.response?.data?.message;
      setTrashError(Array.isArray(message) ? message.join(' | ') : message || 'Impossible de placer ce bail dans la corbeille.');
    } finally {
      setActionLeaseId(null);
    }
  }

  async function restoreLease(id: number) {
    setActionLeaseId(id);
    try {
      await api.post(`/leases/${id}/restore`);
      setSuccess('Le bail a ete restaure.');
      await refreshCurrentView('trash');
    } catch (err: any) {
      const message = err?.response?.data?.message;
      window.alert(Array.isArray(message) ? message.join(' | ') : message || 'Impossible de restaurer ce bail.');
    } finally {
      setActionLeaseId(null);
    }
  }

  async function openPermanentDelete(lease: Lease) {
    setPermanentTarget(lease);
    setDeleteReason('');
    setDeleteConfirmation('');
    setDeleteError('');
    setDeletionImpact(null);
    try {
      const response = await api.get<LeaseDeletionImpact>(`/leases/${lease.id}/deletion-impact`);
      setDeletionImpact(response.data);
    } catch (err: any) {
      const message = err?.response?.data?.message;
      setDeleteError(Array.isArray(message) ? message.join(' | ') : message || 'Impossible de charger les dependances de ce bail.');
    }
  }

  async function confirmPermanentDelete() {
    if (!permanentTarget) return;
    setActionLeaseId(permanentTarget.id);
    setDeleteError('');
    try {
      const response = await api.delete(`/leases/${permanentTarget.id}/permanent`, { data: { reason: deleteReason.trim() || null } });
      if (response.data?.archived) {
        setSuccess('Le bail n a pas pu etre supprime physiquement et a ete archive definitivement.');
      } else {
        setSuccess('Le bail a ete supprime definitivement.');
      }
      setPermanentTarget(null);
      setDeletionImpact(null);
      setDeleteReason('');
      setDeleteConfirmation('');
      await refreshCurrentView('trash');
    } catch (err: any) {
      const message = err?.response?.data?.message;
      setDeleteError(Array.isArray(message) ? message.join(' | ') : message || 'Impossible de finaliser cette suppression.');
    } finally {
      setActionLeaseId(null);
    }
  }

  function exportExcel() {
    exportXlsxWorkbook('Baux_contrats.xlsx', [
      { name: 'Liste baux', rows: filtered.map(leaseExportRow) },
      { name: 'Garanties', rows: filtered.map((lease) => ({ reference: leaseReference(lease), locataire: lease.tenant_name, garantie: amount(guaranteeAmount(lease)), paye: amount(guaranteePaid(lease)), devise: 'USD', statut: statusLabel(guaranteeStatus(lease)) })) },
      { name: 'Contrats absents', rows: filtered.filter((lease) => !lease.contract_file_name).map(leaseExportRow) },
      { name: 'Baux expirant bientot', rows: filtered.filter(leaseExpiringSoon).map(leaseExportRow) },
      { name: 'Baux resilies', rows: filtered.filter((lease) => lease.status === 'TERMINATED').map(leaseExportRow) },
    ]);
  }

  return (
    <section>
      <PageHeader title="Baux & contrats" action={can('documents.upload') ? <button onClick={() => navigate('/leases/new')}><FilePlus size={16} />Creer bail</button> : undefined} />
      <SuccessMessage message={success} />

      <div className="segmented-control" style={{ marginBottom: 12 }}>
        <button type="button" className={view === 'active' ? 'active' : ''} onClick={() => setView('active')}>Liste des contrats</button>
        {canTrashRead ? <button type="button" className={view === 'trash' ? 'active' : ''} onClick={() => setView('trash')}>Corbeille</button> : null}
        {canArchiveRead ? <button type="button" className={view === 'archive' ? 'active' : ''} onClick={() => setView('archive')}>Archives</button> : null}
      </div>

      <div className="mini-stats">
        <div className="mini-stat"><span>Total baux</span><strong>{kpis.total}</strong></div>
        <div className="mini-stat"><span>Baux actifs</span><strong>{kpis.active}</strong></div>
        <div className="mini-stat"><span>Baux expires</span><strong>{kpis.expired}</strong></div>
        <div className="mini-stat"><span>Baux resilies</span><strong>{kpis.terminated}</strong></div>
        <div className="mini-stat"><span>Total garanties</span><strong>{amount(kpis.totalGuarantees)} USD</strong></div>
        <div className="mini-stat"><span>Total loyers actifs</span><strong>{amount(kpis.totalActiveRents)} USD</strong></div>
        <div className="mini-stat"><span>Garanties payees</span><strong>{kpis.guaranteePaid}</strong></div>
        <div className="mini-stat"><span>Garanties non payees</span><strong>{kpis.guaranteeUnpaid}</strong></div>
        <div className="mini-stat"><span>Sans contrat scanne</span><strong>{kpis.missingContracts}</strong></div>
        {view === 'trash' ? <div className="mini-stat"><span>En corbeille</span><strong>{filtered.length}</strong></div> : null}
        {view === 'archive' ? <div className="mini-stat"><span>Archives</span><strong>{filtered.length}</strong></div> : null}
      </div>

      <div className="quick-form leases-filter-bar">
        <input placeholder="Recherche" value={query} onChange={(event) => setQuery(event.target.value)} />
        <select value={filters.building} onChange={(event) => setFilters({ ...filters, building: event.target.value })}><option value="">Immeuble</option>{buildingOptions.map((building) => <option key={building} value={building}>{building}</option>)}</select>
        <input placeholder="Unite" value={filters.unit} onChange={(event) => setFilters({ ...filters, unit: event.target.value })} />
        <input placeholder="Locataire" value={filters.tenant} onChange={(event) => setFilters({ ...filters, tenant: event.target.value })} />
        <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">Statut</option><option value="DRAFT">Brouillon</option><option value="ACTIVE">Actif</option><option value="TERMINATED">Resilie</option><option value="EXPIRED">Expire</option></select>
        <select value={filters.guarantee} onChange={(event) => setFilters({ ...filters, guarantee: event.target.value })}><option value="">Garantie</option><option value="PAID">Payee</option><option value="PARTIAL">Partielle</option><option value="NOT_PAID">Non payee</option></select>
        <input type="date" value={filters.start} onChange={(event) => setFilters({ ...filters, start: event.target.value })} />
        <input type="date" value={filters.end} onChange={(event) => setFilters({ ...filters, end: event.target.value })} />
        <select value={filters.contract} onChange={(event) => setFilters({ ...filters, contract: event.target.value })}><option value="">Contrat</option><option value="PRESENT">Present</option><option value="ABSENT">Absent</option></select>
        <select value={filters.expiring} onChange={(event) => setFilters({ ...filters, expiring: event.target.value })}><option value="">Echeance</option><option value="SOON">Expire bientot</option></select>
        <div className="filter-actions">
          <button type="button" className="secondary" onClick={() => { setQuery(''); setFilters(emptyFilters); }}>Reinitialiser</button>
          <button type="button" className="secondary" onClick={() => exportCsv('baux.csv', filtered.map(leaseExportRow))}><Download size={16} />CSV</button>
          <button type="button" className="secondary" onClick={exportExcel}><FileDown size={16} />Exporter</button>
        </div>
      </div>

      <div className="table-wrap">
        {view === 'active' ? (
          <table>
            <thead>
              <tr><th>Reference bail</th><th>Locataire</th><th>Immeuble</th><th>Unite</th><th>Debut</th><th>Fin</th><th>Duree</th><th className="right">Loyer</th><th>Devise</th><th className="right">Garantie</th><th className="right">Paye</th><th>Devise</th><th>Contrat</th><th>Statut</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {filtered.map((lease) => (
                <tr key={lease.id} className="clickable-row" onClick={() => navigate(`/leases/${lease.id}`)}>
                  <td>{leaseReference(lease)}</td>
                  <td>{lease.tenant_name}</td>
                  <td>{lease.building_name}</td>
                  <td>{lease.unit_number}</td>
                  <td>{shortDate(lease.start_date)}</td>
                  <td>{lease.end_date ? shortDate(lease.end_date) : '-'}</td>
                  <td>{leaseDurationLabel(lease)}</td>
                  <td className="right">{amount(leaseRentAmount(lease))}</td>
                  <td>USD</td>
                  <td className="right">{amount(guaranteeAmount(lease))}</td>
                  <td className="right">{amount(guaranteePaid(lease))}</td>
                  <td>USD</td>
                  <td><span className={lease.contract_file_name ? 'badge active' : 'badge'}>{lease.contract_file_name ? 'Present' : 'Absent'}</span></td>
                  <td><StatusBadge value={leaseDeadlineStatus(lease)} /></td>
                  <td className="actions actions-compact" onClick={(event) => event.stopPropagation()}>
                    <button className="icon-btn" title="Voir" onClick={() => navigate(`/leases/${lease.id}`)}><Eye size={16} /></button>
                    {can('documents.upload') && <button className="icon-btn" title="Modifier" onClick={() => void openEdit(lease.id)}><Pencil size={16} /></button>}
                    {can('documents.upload') && lease.status === 'ACTIVE' && <button className="icon-btn danger" title="Resilier" onClick={() => void terminate(lease.id)}><Trash2 size={16} /></button>}
                    {canTrashLease && (
                      <button
                        className="icon-btn danger"
                        title={actionLeaseId === lease.id ? 'Suppression en cours' : 'Supprimer'}
                        onClick={() => { setTrashTarget(lease); setTrashReason(''); setTrashError(''); }}
                        disabled={actionLeaseId === lease.id}
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                    {can('invoices.create') && <button className="icon-btn" title="Facturer" onClick={() => void invoice(lease.id)}><Receipt size={16} /></button>}
                    {lease.contract_file_name && <button className="icon-btn" title="Telecharger contrat" onClick={() => downloadContract(lease)}><ScrollText size={16} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : view === 'trash' ? (
          <table>
            <thead>
              <tr><th>Reference bail</th><th>Locataire</th><th>Immeuble</th><th>Unite</th><th>Statut avant suppression</th><th>Supprime le</th><th>Supprime par</th><th>Motif</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {filtered.map((lease) => (
                <tr key={lease.id}>
                  <td>{leaseReference(lease)}</td>
                  <td>{lease.tenant_name}</td>
                  <td>{lease.building_name}</td>
                  <td>{lease.unit_number}</td>
                  <td><StatusBadge value={lease.status} /></td>
                  <td>{lease.deleted_at ? shortDate(lease.deleted_at) : '-'}</td>
                  <td>{lease.deleted_by_name || '-'}</td>
                  <td>{lease.deletion_reason || '-'}</td>
                  <td className="actions actions-compact">
                    <button className="icon-btn" title="Consulter" onClick={() => navigate(`/leases/${lease.id}?scope=trash`)}><Eye size={16} /></button>
                    {canRestoreLease ? <button className="icon-btn" title="Restaurer" onClick={() => void restoreLease(lease.id)} disabled={actionLeaseId === lease.id}><RotateCcw size={16} /></button> : null}
                    {canHardDeleteLease ? <button className="icon-btn danger" title="Supprimer definitivement" onClick={() => void openPermanentDelete(lease)} disabled={actionLeaseId === lease.id}><Trash2 size={16} /></button> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table>
            <thead>
              <tr><th>Reference bail</th><th>Locataire</th><th>Immeuble</th><th>Unite</th><th>Statut</th><th>Archive le</th><th>Archive par</th><th>Motif archive</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {filtered.map((lease) => (
                <tr key={lease.id}>
                  <td>{leaseReference(lease)}</td>
                  <td>{lease.tenant_name}</td>
                  <td>{lease.building_name}</td>
                  <td>{lease.unit_number}</td>
                  <td><StatusBadge value={lease.status} /></td>
                  <td>{lease.archived_at ? shortDate(lease.archived_at) : '-'}</td>
                  <td>{lease.archived_by_name || '-'}</td>
                  <td>{lease.archive_reason || '-'}</td>
                  <td className="actions actions-compact">
                    <button className="icon-btn" title="Consulter" onClick={() => navigate(`/leases/${lease.id}?scope=archive`)}><Eye size={16} /></button>
                    <button className="icon-btn" title="Archive definitive" disabled><Archive size={16} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!filtered.length && <EmptyState message={secondaryLoading ? 'Chargement...' : undefined} />}
      </div>

      {editing && (
        <LeaseEditModal
          lease={editing}
          buildings={buildings.data}
          units={units.data}
          tenants={tenants.data}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            setSuccess('Bail modifie avec succes.');
            await reload();
          }}
        />
      )}

      {trashTarget ? (
        <Modal
          title="Supprimer ce contrat ?"
          onClose={() => { setTrashTarget(null); setTrashReason(''); setTrashError(''); }}
          footer={(
            <>
              <button type="button" className="secondary" onClick={() => { setTrashTarget(null); setTrashReason(''); setTrashError(''); }}>Annuler</button>
              <button type="button" onClick={() => void confirmTrashLease()} disabled={actionLeaseId === trashTarget.id}>Confirmer la suppression</button>
            </>
          )}
        >
          <p>Le contrat sera deplace dans la corbeille. Il pourra etre restaure tant qu il n aura pas ete supprime definitivement ou archive.</p>
          <label style={{ display: 'grid', gap: 6 }}>
            Motif de suppression
            <textarea rows={4} value={trashReason} onChange={(event) => setTrashReason(event.target.value)} placeholder="Motif obligatoire" />
          </label>
          {trashError ? <div className="error-banner" style={{ marginTop: 10 }}>{trashError}</div> : null}
        </Modal>
      ) : null}

      {permanentTarget ? (
        <Modal
          title="Suppression definitive du contrat"
          onClose={() => { setPermanentTarget(null); setDeletionImpact(null); setDeleteReason(''); setDeleteError(''); }}
          footer={(
            <>
              <button type="button" className="secondary" onClick={() => { setPermanentTarget(null); setDeletionImpact(null); setDeleteReason(''); setDeleteConfirmation(''); setDeleteError(''); }}>Annuler</button>
              <button type="button" onClick={() => void confirmPermanentDelete()} disabled={actionLeaseId === permanentTarget.id || !deletionImpact || deleteConfirmation !== permanentDeleteConfirmationText}>Supprimer definitivement</button>
            </>
          )}
        >
          <p>Le systeme verifie d abord si ce bail peut etre supprime physiquement. En presence d un historique, il sera archive definitivement en lecture seule.</p>
          {deletionImpact ? (
            <div className="compact-list">
              <div className="compact-item"><span>Suppression physique possible</span><strong>{deletionImpact.canHardDelete ? 'Oui' : 'Non'}</strong></div>
              <div className="compact-item"><span>Historique financier</span><strong>{deletionImpact.hasFinancialHistory ? 'Oui' : 'Non'}</strong></div>
              {deletionImpact.dependencies.length ? (
                <div className="compact-item" style={{ alignItems: 'flex-start' }}>
                  <span>Dependances</span>
                  <strong>{deletionImpact.dependencies.map((entry) => `${entry.type} (${entry.count})`).join(' · ')}</strong>
                </div>
              ) : (
                <div className="compact-item"><span>Dependances</span><strong>Aucune</strong></div>
              )}
            </div>
          ) : (
            <div className="compact-empty">Chargement de l analyse d impact...</div>
          )}
          <label style={{ display: 'grid', gap: 6, marginTop: 12 }}>
            Commentaire
            <textarea rows={3} value={deleteReason} onChange={(event) => setDeleteReason(event.target.value)} placeholder="Commentaire facultatif" />
          </label>
          <label style={{ display: 'grid', gap: 6, marginTop: 12 }}>
            Confirmation obligatoire
            <input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} placeholder={permanentDeleteConfirmationText} />
          </label>
          {deleteError ? <div className="error-banner" style={{ marginTop: 10 }}>{deleteError}</div> : null}
        </Modal>
      ) : null}
    </section>
  );
}

function LeaseEditModal({
  lease,
  buildings,
  units,
  tenants,
  onClose,
  onSaved,
}: {
  lease: LeaseDetail;
  buildings: Building[];
  units: Unit[];
  tenants: Tenant[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [buildingId, setBuildingId] = useState('');
  const [unitId, setUnitId] = useState(String(lease.unit_id));
  const [tenantId, setTenantId] = useState<number | null>(lease.tenant_id);
  const [startDate, setStartDate] = useState(lease.start_date?.slice(0, 10) ?? '');
  const [endDate, setEndDate] = useState(lease.end_date?.slice(0, 10) ?? '');
  const [durationMonths, setDurationMonths] = useState(leaseDurationNumber(lease));
  const [rent, setRent] = useState(Number(lease.monthly_rent ?? 0));
  const [maintenanceFeeAmount, setMaintenanceFeeAmount] = useState(
    lease.maintenance_fee_amount != null ? String(lease.maintenance_fee_amount) : '',
  );
  const [syndicAmount, setSyndicAmount] = useState(Number(lease.monthly_syndic_amount ?? 0));
  const [leaseUsage, setLeaseUsage] = useState(normalizeLeaseUsageCode(lease.lease_usage));
  const [leaseActivityDescription, setLeaseActivityDescription] = useState(String(lease.lease_activity_description ?? ''));
  const [guaranteeMonths, setGuaranteeMonths] = useState(String(Number(lease.guarantee_months ?? 0)));
  const [guaranteeAmountValue, setGuaranteeAmountValue] = useState(String(guaranteeAmount(lease)));
  const [guaranteePaidValue, setGuaranteePaidValue] = useState(String(guaranteePaid(lease)));
  const [guaranteeStatusValue, setGuaranteeStatusValue] = useState(guaranteeStatus(lease));
  const [guaranteePaymentDate, setGuaranteePaymentDate] = useState(lease.rental_guarantee_payment_date?.slice(0, 10) ?? '');
  const [contractName, setContractName] = useState(lease.contract_file_name ?? '');
  const [notes, setNotes] = useState(lease.notes ?? '');
  const [leaseStatus, setLeaseStatus] = useState(lease.status ?? 'DRAFT');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const building = buildings.find((entry) => entry.name === lease.building_name);
    if (building) setBuildingId(String(building.id));
  }, [buildings, lease.building_name]);

  const availableUnits = useMemo(
    () => units.filter((unit) => !buildingId || Number(unit.building_id) === Number(buildingId)),
    [units, buildingId],
  );
  const selectedUnit = availableUnits.find((unit) => Number(unit.id) === Number(unitId));
  const rentAmount = Number(rent || 0) + Number(maintenanceFeeAmount || 0);
  const totalMonthly = rentAmount + Number(syndicAmount ?? 0) + Number(lease.other_charges_amount ?? 0);
  const buildingOptions = buildings.map((building) => ({
    value: building.id,
    label: building.name,
    meta: [building.city, building.building_type].filter(Boolean).join(' - '),
  }));
  const unitOptions = availableUnits.map((unit) => ({
    value: unit.id,
    label: unit.number,
    meta: `${unit.building_name} - Loyer ${amount(unit.monthly_rent)} USD - Syndic ${amount(unit.monthly_syndic_amount)} USD - ${statusLabel(unit.status)}`,
  }));

  useEffect(() => {
    const amountValue = Number(guaranteeAmountValue || 0);
    const paidValue = Number(guaranteePaidValue || 0);
    if (paidValue <= 0) setGuaranteeStatusValue('NOT_PAID');
    else if (paidValue >= amountValue && amountValue > 0) setGuaranteeStatusValue('PAID');
    else setGuaranteeStatusValue('PARTIAL');
  }, [guaranteeAmountValue, guaranteePaidValue]);

  useEffect(() => {
    const monthsValue = Number(guaranteeMonths || 0);
    setGuaranteeAmountValue(String(rentAmount * monthsValue));
  }, [rentAmount, guaranteeMonths]);

  useEffect(() => {
    const calculatedAmount = String(rentAmount * Number(guaranteeMonths || 0));
    if (guaranteeStatusValue === 'PAID') {
      setGuaranteePaidValue(calculatedAmount);
      return;
    }
    if (guaranteeStatusValue === 'NOT_PAID') {
      setGuaranteePaidValue('0');
    }
  }, [rentAmount, guaranteeMonths, guaranteeStatusValue]);

  useEffect(() => {
    if (leaseUsage !== 'COMMERCIAL' && leaseUsage !== 'PROFESSIONAL') {
      setLeaseActivityDescription('');
    }
  }, [leaseUsage]);

  function updateStartDate(value: string) {
    setStartDate(value);
    if (value && durationMonths) setEndDate(addMonths(value, Number(durationMonths)));
    else if (value && endDate) setDurationMonths(String(monthDiff(value, endDate)));
  }

  function updateEndDate(value: string) {
    setEndDate(value);
    if (startDate && value) setDurationMonths(String(monthDiff(startDate, value)));
  }

  function updateDuration(value: string) {
    setDurationMonths(value);
    if (startDate && Number(value) > 0) setEndDate(addMonths(startDate, Number(value)));
  }

  async function submit() {
    if (!tenantId) return setError('Selectionnez un locataire.');
    if (!unitId) return setError('Selectionnez une unite.');
    if ((leaseUsage === 'COMMERCIAL' || leaseUsage === 'PROFESSIONAL' || leaseUsage === 'MIXED') && !leaseActivityDescription.trim()) {
      return setError('Renseignez l activite ou la destination des lieux.');
    }
    if (guaranteeStatusValue === 'PAID' && !guaranteePaymentDate) {
      return setError('Renseignez la date de paiement de la garantie.');
    }
    const guaranteeMonthsValue = Number(guaranteeMonths || 0);
    const calculatedGuaranteeAmount = rentAmount * guaranteeMonthsValue;
    const normalizedMaintenanceFeeAmount = Number(maintenanceFeeAmount === '' ? 0 : maintenanceFeeAmount);
    const normalizedGuaranteeStatus = guaranteeStatusValue === 'PAID' ? 'PAID' : Number(guaranteePaidValue || 0) <= 0 ? 'NOT_PAID' : guaranteeStatusValue;
    const normalizedGuaranteePaid = normalizedGuaranteeStatus === 'PAID' ? calculatedGuaranteeAmount : 0;
    setSubmitting(true);
    setError('');
    try {
      await api.put(`/leases/${lease.id}`, {
        tenant_id: tenantId,
        unit_id: Number(unitId),
        start_date: startDate,
        end_date: endDate || null,
        monthly_rent: rent,
        monthly_syndic_amount: syndicAmount,
        maintenance_fee_amount: normalizedMaintenanceFeeAmount,
        other_charges_amount: Number(lease.other_charges_amount ?? 0),
        guarantee_months: guaranteeMonthsValue,
        lease_usage: leaseUsage,
        lease_activity_description: (leaseUsage === 'COMMERCIAL' || leaseUsage === 'PROFESSIONAL' || leaseUsage === 'MIXED') ? leaseActivityDescription.trim() : null,
        rental_guarantee_amount: calculatedGuaranteeAmount,
        rental_guarantee_paid: normalizedGuaranteePaid,
        rental_guarantee_payment_date: normalizedGuaranteeStatus === 'PAID' ? (guaranteePaymentDate || null) : null,
        rental_guarantee_status: normalizedGuaranteeStatus,
        notice_months: Number(lease.notice_months ?? 0),
        signature_place: lease.signature_place || null,
        signature_date: lease.signature_date ? String(lease.signature_date).slice(0, 10) : null,
        contract_file_name: contractName || null,
        contract_file_url: lease.contract_file_url ?? null,
        status: leaseStatus,
        notes: notes || null,
      });
      await onSaved();
    } catch (err: any) {
      const message = err?.response?.data?.message;
      setError(Array.isArray(message) ? message.join(' | ') : message || 'Impossible de modifier le bail.');
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
  }

  return (
    <Modal title="Modifier bail" onClose={onClose}>
      <form className="lease-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <div className="detail-section report-section">
          <h4>Parties concernees</h4>
          <div className="lease-section-grid">
            <label className="lease-field-wide">Immeuble<SearchableSelect options={buildingOptions} value={buildingId ? Number(buildingId) : null} onChange={(value) => { setBuildingId(value ? String(value) : ''); setUnitId(''); }} placeholder="Rechercher un immeuble" emptyMessage="Aucun immeuble trouve" /></label>
            <label className="lease-field-wide">Unite / Appartement<SearchableSelect options={unitOptions} value={unitId ? Number(unitId) : null} onChange={(value) => setUnitId(value ? String(value) : '')} placeholder="Rechercher une unite" emptyMessage="Aucune unite trouvee" /></label>
            <label className="lease-field-wide">Locataire<TenantSearchSelect tenants={tenants} value={tenantId} onChange={setTenantId} required /></label>
          </div>
        </div>

        <div className="detail-section report-section">
          <h4>Informations du bail</h4>
          <div className="lease-section-grid">
            <label>Date debut<input type="date" value={startDate} onChange={(event) => updateStartDate(event.target.value)} required /></label>
            <label>Date fin<input type="date" value={endDate} onChange={(event) => updateEndDate(event.target.value)} /></label>
            <label>Duree du bail (mois)<input type="number" min="1" value={durationMonths} onChange={(event) => updateDuration(event.target.value)} placeholder="12" /></label>
            <label>Jour limite paiement<input type="number" min="1" max="31" defaultValue="5" /></label>
            <label>Loyer de base<input type="number" value={rent} onChange={(event) => setRent(Number(event.target.value))} required /></label>
            <label>Frais d'entretien<input type="number" min="0" step="0.01" value={maintenanceFeeAmount} onChange={(event) => setMaintenanceFeeAmount(event.target.value)} /></label>
            <label>Montant syndic<input type="number" min="0" value={syndicAmount} onChange={(event) => setSyndicAmount(Number(event.target.value))} /></label>
            <label>Usage du bail<select value={leaseUsage} onChange={(event) => setLeaseUsage(normalizeLeaseUsageCode(event.target.value))}><option value="RESIDENTIAL">Residentiel</option><option value="COMMERCIAL">Commercial</option><option value="PROFESSIONAL">Professionnel</option><option value="MIXED">Mixte</option></select></label>
            {(leaseUsage === 'COMMERCIAL' || leaseUsage === 'PROFESSIONAL' || leaseUsage === 'MIXED') ? (
              <label className="lease-field-wide">{leaseUsage === 'COMMERCIAL' ? 'Activite ou destination commerciale' : leaseUsage === 'PROFESSIONAL' ? 'Activite ou destination professionnelle' : 'Activite ou destination mixte'}<input value={leaseActivityDescription} onChange={(event) => setLeaseActivityDescription(event.target.value)} placeholder={leaseUsage === 'COMMERCIAL' ? 'Ex: Boutique de vente' : leaseUsage === 'PROFESSIONAL' ? 'Ex: Cabinet de conseil' : 'Ex: Activites commerciales et professionnelles'} /></label>
            ) : null}
            <label>Loyer<input className="locked-field" value={`${amount(rentAmount)} USD`} readOnly /></label>
            <label>Total mensuel<input className="locked-field" value={`${amount(totalMonthly)} USD`} readOnly /></label>
            <label>Devise<input className="locked-field" value="USD" readOnly /></label>
            <label>Statut<select value={leaseStatus} onChange={(event) => setLeaseStatus(event.target.value)}><option value="DRAFT">Brouillon</option><option value="ACTIVE">Actif</option><option value="TERMINATED">Resilie</option></select></label>
          </div>
        </div>

        <div className="detail-section report-section">
          <h4>Garantie locative</h4>
          <div className="lease-section-grid">
            <label>Garantie (mois)<input type="number" min="0" value={guaranteeMonths} onChange={(event) => setGuaranteeMonths(event.target.value)} /></label>
            <label>Montant garantie<input className="locked-field" value={guaranteeAmountValue} readOnly /></label>
            <label>Devise<input className="locked-field" value="USD" readOnly /></label>
            <label>Garantie payee<select value={guaranteeStatusValue === 'PAID' ? 'YES' : 'NO'} onChange={(event) => {
              const nextPaid = event.target.value === 'YES';
              setGuaranteeStatusValue(nextPaid ? 'PAID' : 'NOT_PAID');
              setGuaranteePaidValue(nextPaid ? String(rentAmount * Number(guaranteeMonths || 0)) : '0');
              if (!nextPaid) setGuaranteePaymentDate('');
            }}><option value="NO">Non</option><option value="YES">Oui</option></select></label>
            <label>Date paiement<input type="date" value={guaranteePaymentDate} onChange={(event) => setGuaranteePaymentDate(event.target.value)} disabled={guaranteeStatusValue !== 'PAID'} /></label>
          </div>
        </div>

        <div className="detail-section report-section">
          <h4>Contrat scanne</h4>
          <div className="lease-section-grid">
            <label className="lease-field-wide">Piece jointe contrat<input type="file" accept="application/pdf,image/*" onChange={(event) => setContractName(event.target.files?.[0]?.name ?? lease.contract_file_name ?? '')} /></label>
            <label className="lease-field-wide">Nom du fichier<input className="locked-field" value={contractName || 'Aucun fichier'} readOnly /></label>
          </div>
        </div>

        <div className="detail-section report-section">
          <h4>Observations</h4>
          <div className="lease-section-grid">
            <label className="lease-field-full">Notes<textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Observations internes" /></label>
          </div>
        </div>

        {error && <div className="error-banner">{error}</div>}
        <div className="actions">
          <button disabled={submitting}>{submitting ? 'Enregistrement...' : 'Enregistrer le bail'}</button>
          <button type="button" className="secondary" onClick={onClose}>Annuler</button>
        </div>
      </form>
    </Modal>
  );
}

function leaseReference(lease: Lease) {
  return formatLeaseReference(lease.lease_number, lease.id);
}

function guaranteeStatus(lease: Lease | LeaseDetail) {
  const detailGuarantee = 'guarantee' in lease ? lease.guarantee : undefined;
  return String(lease.guarantee_status ?? lease.rental_guarantee_status ?? detailGuarantee?.status ?? 'NOT_PAID');
}

function guaranteeAmount(lease: Lease | LeaseDetail) {
  const detailGuarantee = 'guarantee' in lease ? lease.guarantee : undefined;
  const persistedAmount = lease.guarantee_amount ?? lease.rental_guarantee_amount ?? detailGuarantee?.amount;
  if (persistedAmount != null) {
    return Number(persistedAmount);
  }
  return leaseRentAmount(lease) * Number(lease.guarantee_months ?? 0);
}

function guaranteePaid(lease: Lease | LeaseDetail) {
  const detailGuarantee = 'guarantee' in lease ? lease.guarantee : undefined;
  return Number(lease.guarantee_paid ?? lease.rental_guarantee_paid ?? detailGuarantee?.paid_amount ?? 0);
}

function amount(value: unknown) {
  return Number(value ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}

function leaseExpired(lease: Lease) {
  return Boolean(lease.end_date && new Date(lease.end_date).getTime() < startOfToday());
}

function isCurrentActiveLease(lease: Lease) {
  const startDate = lease.start_date ? new Date(`${String(lease.start_date).slice(0, 10)}T00:00:00`) : null;
  const endDate = lease.end_date ? new Date(`${String(lease.end_date).slice(0, 10)}T00:00:00`) : null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Boolean(
    startDate &&
    startDate.getTime() <= today.getTime() &&
    (!endDate || endDate.getTime() >= today.getTime()) &&
    !['DRAFT', 'CANCELLED', 'TERMINATED', 'EXPIRED'].includes(String(lease.status ?? '').toUpperCase()),
  );
}

function leaseExpiringSoon(lease: Lease) {
  if (!lease.end_date || lease.status !== 'ACTIVE') return false;
  const days = daysUntil(lease.end_date);
  return days >= 0 && days <= 60;
}

function leaseDeadlineStatus(lease: Lease) {
  if (lease.status === 'TERMINATED') return 'Resilie';
  if (leaseExpired(lease) || lease.status === 'EXPIRED') return 'Expire';
  if (leaseExpiringSoon(lease)) return 'Expire bientot';
  return statusLabel(lease.status);
}

function leaseDurationLabel(lease: Lease) {
  if (!lease.start_date || !lease.end_date) return '-';
  const start = new Date(lease.start_date);
  const end = new Date(lease.end_date);
  const months = Math.max(0, (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth());
  return `${months} mois`;
}

function leaseDurationNumber(lease: Lease) {
  if (!lease.start_date || !lease.end_date) return '';
  const start = new Date(lease.start_date);
  const end = new Date(lease.end_date);
  return String(Math.max(0, (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth()));
}

function daysUntil(value: string) {
  return Math.ceil((new Date(value).getTime() - startOfToday()) / 86400000);
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today.getTime();
}

function leaseExportRow(lease: Lease) {
  return {
    reference: leaseReference(lease),
    locataire: lease.tenant_name,
    immeuble: lease.building_name,
    unite: lease.unit_number,
    debut: shortDate(lease.start_date),
    fin: lease.end_date ? shortDate(lease.end_date) : '',
    duree: leaseDurationLabel(lease),
    loyer: amount(leaseRentAmount(lease)),
    syndic: amount(lease.monthly_syndic_amount),
    total_mensuel: amount(leaseRentAmount(lease) + Number(lease.monthly_syndic_amount ?? 0)),
    devise: 'USD',
    garantie: amount(guaranteeAmount(lease)),
    paye: amount(guaranteePaid(lease)),
    contrat: lease.contract_file_name ? 'Present' : 'Absent',
    statut: leaseDeadlineStatus(lease),
  };
}

function leaseRentAmount(lease: Pick<Lease, 'monthly_rent' | 'maintenance_fee_amount'>) {
  return Number(lease.monthly_rent ?? 0) + Number(lease.maintenance_fee_amount ?? 0);
}

function downloadContract(lease: Lease) {
  openOrDownloadDocument({
    fileName: lease.contract_file_name,
    fileUrl: lease.contract_file_url,
    title: 'Contrat de bail',
    context: `Bail ${leaseReference(lease)}`,
  });
}

function addMonths(dateValue: string, months: number) {
  const date = new Date(dateValue);
  date.setMonth(date.getMonth() + months);
  return date.toISOString().slice(0, 10);
}

function monthDiff(startValue: string, endValue: string) {
  const start = new Date(startValue);
  const end = new Date(endValue);
  const diff = (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth();
  return Math.max(diff, 0);
}

function normalizeLeaseUsageCode(value?: string | null) {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (normalized === 'COMMERCIAL') return 'COMMERCIAL';
  if (normalized === 'PROFESSIONAL' || normalized === 'PROFESSIONNEL') return 'PROFESSIONAL';
  if (normalized === 'MIXED' || normalized === 'MIXTE') return 'MIXED';
  return 'RESIDENTIAL';
}
