import { Eye, Pencil, Plus, RefreshCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, money, shortDate } from '../api';
import { useAuth } from '../auth';
import { EmptyState, Modal, PageHeader, SuccessMessage } from '../components';

type Shareholder = {
  id: number;
  shareholder_type: 'INDIVIDUAL' | 'COMPANY';
  display_name: string;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  phone?: string | null;
  email?: string | null;
  ownership_percentage?: number | null;
  notes?: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  total_received_usd?: number;
  total_received_cdf?: number;
  payout_count?: number;
};

type ShareholderHistoryRow = {
  id: number;
  batch_id: number;
  batch_reference?: string | null;
  payout_date: string;
  source_register: 'MAIN_CASH' | 'GUARANTEE_CASH';
  operation_type: string;
  amount: number;
  currency: string;
  receipt_number: string;
  reason: string;
};

const emptyShareholder = {
  shareholder_type: 'INDIVIDUAL',
  display_name: '',
  first_name: '',
  last_name: '',
  company_name: '',
  phone: '',
  email: '',
  ownership_percentage: '',
  notes: '',
  status: 'ACTIVE',
};

export function ShareholdersPage() {
  const { can } = useAuth();
  const [shareholders, setShareholders] = useState<Shareholder[]>([]);
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selected, setSelected] = useState<Shareholder | null>(null);
  const [history, setHistory] = useState<ShareholderHistoryRow[]>([]);
  const [form, setForm] = useState({ ...emptyShareholder });
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const params = Object.fromEntries(
        Object.entries({ search: search.trim(), status: statusFilter }).filter(([, value]) => value),
      );
      const response = await api.get<Shareholder[]>('/shareholders', { params });
      setShareholders(response.data);
    } catch (loadError: any) {
      setError(apiErrorMessage(loadError, 'Impossible de charger les actionnaires.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return shareholders.filter((shareholder) => {
      if (statusFilter && shareholder.status !== statusFilter) return false;
      if (!query) return true;
      return [shareholder.display_name, shareholder.phone, shareholder.email]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [search, shareholders, statusFilter]);

  function openCreate() {
    setSelected(null);
    setForm({ ...emptyShareholder });
    setModalOpen(true);
  }

  function openEdit(shareholder: Shareholder) {
    setSelected(shareholder);
    setForm({
      shareholder_type: shareholder.shareholder_type,
      display_name: shareholder.display_name ?? '',
      first_name: shareholder.first_name ?? '',
      last_name: shareholder.last_name ?? '',
      company_name: shareholder.company_name ?? '',
      phone: shareholder.phone ?? '',
      email: shareholder.email ?? '',
      ownership_percentage: shareholder.ownership_percentage == null ? '' : String(shareholder.ownership_percentage),
      notes: shareholder.notes ?? '',
      status: shareholder.status,
    });
    setModalOpen(true);
  }

  async function openHistory(shareholder: Shareholder) {
    setSelected(shareholder);
    setHistoryOpen(true);
    setHistory([]);
    try {
      const response = await api.get<ShareholderHistoryRow[]>(`/shareholders/${shareholder.id}/history`);
      setHistory(response.data);
    } catch (loadError: any) {
      setError(apiErrorMessage(loadError, 'Impossible de charger l’historique des remboursements.'));
    }
  }

  async function submit() {
    setSubmitting(true);
    setError('');
    try {
      if (selected) {
        await api.patch(`/shareholders/${selected.id}`, {
          ...form,
          ownership_percentage: form.ownership_percentage === '' ? null : Number(form.ownership_percentage),
        });
        setSuccess('Actionnaire mis à jour.');
      } else {
        await api.post('/shareholders', {
          ...form,
          ownership_percentage: form.ownership_percentage === '' ? null : Number(form.ownership_percentage),
        });
        setSuccess('Actionnaire créé.');
      }
      setModalOpen(false);
      await load();
    } catch (submitError: any) {
      setError(apiErrorMessage(submitError, 'Impossible d’enregistrer l’actionnaire.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section>
      <PageHeader
        title="Actionnaires"
        action={can('shareholders.create') ? <button onClick={openCreate}><Plus size={16} />Nouvel actionnaire</button> : undefined}
      />
      <p className="page-subtitle">Référentiel des actionnaires et historique des remboursements enregistrés.</p>
      <SuccessMessage message={success} />
      {error ? <div className="error-message">{error}</div> : null}

      <div className="mini-stats">
        <div className="mini-stat"><span>Actionnaires visibles</span><strong>{filtered.length}</strong></div>
        <div className="mini-stat"><span>Actifs</span><strong>{filtered.filter((item) => item.status === 'ACTIVE').length}</strong></div>
        <div className="mini-stat"><span>Total reçu USD</span><strong>{money(filtered.reduce((sum, item) => sum + Number(item.total_received_usd ?? 0), 0))} $US</strong></div>
        <div className="mini-stat"><span>Total reçu CDF</span><strong>{Number(filtered.reduce((sum, item) => sum + Number(item.total_received_cdf ?? 0), 0)).toLocaleString('fr-FR')} CDF</strong></div>
      </div>

      <div className="quick-form shareholder-toolbar">
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher un actionnaire..." />
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="">Tous les statuts</option>
          <option value="ACTIVE">Actif</option>
          <option value="INACTIVE">Inactif</option>
          <option value="ARCHIVED">Archivé</option>
        </select>
        <div className="filter-actions">
          <button type="button" className="secondary" onClick={() => { setSearch(''); setStatusFilter(''); }}>Réinitialiser</button>
          <button type="button" className="secondary" onClick={() => void load()}><RefreshCcw size={15} />Actualiser</button>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Actionnaire</th>
              <th>Type</th>
              <th>Téléphone</th>
              <th>Email</th>
              <th className="right">Pourcentage</th>
              <th>Statut</th>
              <th className="right">Total reçu USD</th>
              <th className="right">Total reçu CDF</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((shareholder) => (
              <tr key={shareholder.id}>
                <td>{shareholder.display_name}</td>
                <td>{shareholder.shareholder_type === 'COMPANY' ? 'Société' : 'Individuel'}</td>
                <td>{shareholder.phone || '-'}</td>
                <td>{shareholder.email || '-'}</td>
                <td className="right">{shareholder.ownership_percentage == null ? '-' : `${Number(shareholder.ownership_percentage).toLocaleString('fr-FR')} %`}</td>
                <td><span className={`badge ${shareholder.status === 'ACTIVE' ? 'paid' : shareholder.status === 'ARCHIVED' ? 'draft' : 'partial'}`}>{shareholder.status}</span></td>
                <td className="right">{money(shareholder.total_received_usd ?? 0)} $US</td>
                <td className="right">{Number(shareholder.total_received_cdf ?? 0).toLocaleString('fr-FR')} CDF</td>
                <td>
                  <div className="row-actions">
                    <button type="button" className="icon-btn" title="Historique" onClick={() => void openHistory(shareholder)}><Eye size={16} /></button>
                    {can('shareholders.update') ? (
                      <button type="button" className="icon-btn" title="Modifier" onClick={() => openEdit(shareholder)}><Pencil size={16} /></button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length ? <EmptyState title={loading ? 'Chargement...' : 'Aucun actionnaire'} /> : null}
      </div>

      {modalOpen ? (
        <Modal title={selected ? 'Modifier l’actionnaire' : 'Nouvel actionnaire'} onClose={() => setModalOpen(false)}>
          <form
            className="shareholder-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <div className="shareholder-form-grid">
              <label>
                Type
                <select value={form.shareholder_type} onChange={(event) => setForm({ ...form, shareholder_type: event.target.value })}>
                  <option value="INDIVIDUAL">Individuel</option>
                  <option value="COMPANY">Société</option>
                </select>
              </label>
              <label>
                Nom affiché
                <input value={form.display_name} onChange={(event) => setForm({ ...form, display_name: event.target.value })} required />
              </label>
              <label>
                Prénom
                <input value={form.first_name} onChange={(event) => setForm({ ...form, first_name: event.target.value })} />
              </label>
              <label>
                Nom
                <input value={form.last_name} onChange={(event) => setForm({ ...form, last_name: event.target.value })} />
              </label>
              <label>
                Société
                <input value={form.company_name} onChange={(event) => setForm({ ...form, company_name: event.target.value })} />
              </label>
              <label>
                Téléphone
                <input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
              </label>
              <label>
                Email
                <input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
              </label>
              <label>
                Pourcentage
                <input type="number" min="0" max="100" step="0.01" value={form.ownership_percentage} onChange={(event) => setForm({ ...form, ownership_percentage: event.target.value })} />
              </label>
              <label>
                Statut
                <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
                  <option value="ACTIVE">Actif</option>
                  <option value="INACTIVE">Inactif</option>
                  <option value="ARCHIVED">Archivé</option>
                </select>
              </label>
              <label className="form-field-full">
                Notes
                <textarea rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
              </label>
            </div>
            <div className="modal-footer-sticky">
              <button type="button" className="secondary" onClick={() => setModalOpen(false)} disabled={submitting}>Annuler</button>
              <button type="submit" disabled={submitting}>{submitting ? 'Enregistrement...' : 'Enregistrer'}</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {historyOpen && selected ? (
        <Modal title={`Historique - ${selected.display_name}`} onClose={() => setHistoryOpen(false)} className="shareholder-history-modal">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Source</th>
                  <th>Type</th>
                  <th className="right">Montant</th>
                  <th>Reçu</th>
                  <th>Lot</th>
                  <th>Motif</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.id}>
                    <td>{shortDate(row.payout_date)}</td>
                    <td>{row.source_register === 'MAIN_CASH' ? 'Caisse principale' : 'Caisse garanties locatives'}</td>
                    <td>{row.operation_type}</td>
                    <td className="right">{money(row.amount)} {row.currency}</td>
                    <td><button type="button" className="link-button" onClick={() => window.open(`/shareholder-payout-lines/${row.id}/receipt`, '_blank', 'noopener')}>{row.receipt_number}</button></td>
                    <td><button type="button" className="link-button" onClick={() => window.open(`/shareholder-payouts/${row.batch_id}`, '_blank', 'noopener')}>{row.batch_reference ?? `Lot #${row.batch_id}`}</button></td>
                    <td>{row.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!history.length ? <EmptyState title="Aucun remboursement" /> : null}
          </div>
        </Modal>
      ) : null}
    </section>
  );
}

function apiErrorMessage(error: unknown, fallback: string) {
  const message = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  if (Array.isArray(message)) return message.join(' | ');
  return message || fallback;
}
