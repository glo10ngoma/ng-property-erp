import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../../core/api/axios';
import { useAuth } from '../../../core/auth/AuthContext';
import { EmptyState, Modal, PageHeader, SuccessMessage } from '../../../components';

type PlatformOrganization = {
  id: number;
  name: string;
  slug: string;
  status: string;
  company_name?: string;
  primary_email?: string;
  phone?: string;
  country?: string;
  city?: string;
  users_count?: number;
  memberships_count?: number;
  created_at?: string;
  updated_at?: string;
  suspended_at?: string | null;
  suspension_reason?: string | null;
  reactivated_at?: string | null;
  reactivation_reason?: string | null;
  active_modules?: string[];
};

type PlatformOrganizationDetail = PlatformOrganization & {
  legal_name?: string;
  currency?: string;
  language?: string;
  timezone?: string;
};

type PlatformModule = {
  code: string;
  label: string;
  category: string;
  description?: string | null;
};

type PlatformOrganizationModule = PlatformModule & {
  organization_id: number;
  module_code: string;
  is_enabled: boolean;
  enabled_at?: string | null;
  disabled_at?: string | null;
  disable_reason?: string | null;
};

type PlatformUser = {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  status: string;
  role?: string;
  platform_role?: string | null;
  default_membership_role?: string | null;
  organization_name?: string | null;
  organizations_count?: number;
  created_at?: string;
};

type PlatformMembership = {
  id: number;
  user_id: number;
  organization_id: number;
  user_name: string;
  email: string;
  organization_name: string;
  role_code: string;
  is_active: boolean;
  is_default: boolean;
  created_at?: string;
};

type PlatformOverviewResponse = {
  stats: Record<string, number | string>;
  latestOrganizations: PlatformOrganization[];
  latestActivity: Array<Record<string, unknown>>;
};

type PlatformActivityEntry = Record<string, unknown>;
type DetailTabKey = 'overview' | 'modules' | 'activity';

function useIsSuperAdmin() {
  const { user } = useAuth();
  return String(user?.platform_role ?? user?.role ?? '').trim().toUpperCase() === 'SUPER_ADMIN';
}

export function PlatformOverviewPage() {
  const [data, setData] = useState<PlatformOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void api.get<PlatformOverviewResponse>('/platform/overview').then((response) => {
      setData(response.data);
      setLoading(false);
    });
  }, []);

  if (loading) return <section><PageHeader title="Vue d’ensemble plateforme" /><div className="loading-state"><span className="spinner" />Chargement...</div></section>;
  if (!data) return <section><PageHeader title="Vue d’ensemble plateforme" /><EmptyState message="Aucune donnée plateforme." /></section>;

  const stats = data.stats ?? {};

  return (
    <section>
      <PageHeader title="Vue d’ensemble plateforme" />
      <div className="mini-stats">
        <StatCard label="Organisations" value={stats.total_organizations} />
        <StatCard label="Actives" value={stats.active_organizations} />
        <StatCard label="Suspendues" value={stats.suspended_organizations} />
        <StatCard label="Utilisateurs" value={stats.total_users} />
        <StatCard label="Utilisateurs actifs" value={stats.active_users} />
        <StatCard label="Multi-organisations" value={stats.multi_organization_users} />
        <StatCard label="Adhésions actives" value={stats.active_memberships} />
      </div>
      <div className="detail-section">
        <h4>Dernières organisations créées</h4>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Nom</th><th>Slug</th><th>Statut</th><th>Créée le</th></tr></thead>
            <tbody>
              {data.latestOrganizations.map((item) => (
                <tr key={item.id}>
                  <td><Link to={`/platform/organizations/${item.id}`}>{item.name}</Link></td>
                  <td>{item.slug}</td>
                  <td><StatusBadge status={item.status} /></td>
                  <td>{formatDate(item.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="detail-section">
        <h4>Dernières activités administratives</h4>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Action</th><th>Organisation</th><th>Utilisateur cible</th><th>Date</th></tr></thead>
            <tbody>
              {data.latestActivity.map((item, index) => (
                <tr key={String(item.id ?? index)}>
                  <td>{String(item.action ?? '—')}</td>
                  <td>{String(item.organization_name ?? '—')}</td>
                  <td>{String(item.target_name ?? '—')}</td>
                  <td>{formatDate(String(item.created_at ?? ''))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export function PlatformOrganizationsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<PlatformOrganization[]>([]);
  const [modules, setModules] = useState<PlatformModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [moduleCode, setModuleCode] = useState('ALL');
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    const [organizationsResponse, modulesResponse] = await Promise.all([
      api.get<PlatformOrganization[]>('/platform/organizations', {
        params: {
          search: search || undefined,
          status: status === 'ALL' ? undefined : status,
          moduleCode: moduleCode === 'ALL' ? undefined : moduleCode,
        },
      }),
      api.get<PlatformModule[]>('/platform/modules'),
    ]);
    setItems(organizationsResponse.data);
    setModules(modulesResponse.data);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function submit(form: FormData) {
    setError('');
    try {
      await api.post('/platform/organizations', Object.fromEntries(form));
      setSuccess('Organisation créée.');
      setCreating(false);
      await load();
    } catch (err) {
      setError(extractApiError(err));
    }
  }

  return (
    <section>
      <PageHeader title="Organisations" action={<button onClick={() => setCreating(true)}>Nouvelle organisation</button>} />
      <SuccessMessage message={success} />
      {error ? <div className="error-message">{error}</div> : null}
      <div className="table-toolbar">
        <div className="toolbar-main">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Recherche" />
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="ALL">Tous les statuts</option>
            <option value="ACTIVE">Active</option>
            <option value="TEST">Test</option>
            <option value="SUSPENDED">Suspendue</option>
            <option value="INACTIVE">Inactive</option>
            <option value="ARCHIVED">Archivée</option>
          </select>
          <select value={moduleCode} onChange={(event) => setModuleCode(event.target.value)}>
            <option value="ALL">Tous les modules</option>
            {modules.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
          </select>
        </div>
        <div className="toolbar-actions">
          <button className="secondary" onClick={() => { setSearch(''); setStatus('ALL'); setModuleCode('ALL'); void load(); }}>Réinitialiser</button>
          <button onClick={() => void load()}>Actualiser</button>
        </div>
      </div>
      {loading ? <div className="loading-state"><span className="spinner" />Chargement...</div> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Organisation</th><th>Statut</th><th>Localisation</th><th>Modules</th><th>Utilisateurs</th><th>Adhésions</th><th>Créée le</th></tr></thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="clickable-row" onClick={() => navigate(`/platform/organizations/${item.id}`)}>
                  <td>
                    <strong>{item.name}</strong>
                    <div className="table-secondary">{item.slug}</div>
                  </td>
                  <td><StatusBadge status={item.status} /></td>
                  <td>{[item.city, item.country].filter(Boolean).join(', ') || '—'}</td>
                  <td><ModuleBadgeList modules={item.active_modules ?? []} /></td>
                  <td>{item.users_count ?? 0}</td>
                  <td>{item.memberships_count ?? 0}</td>
                  <td>{formatDate(item.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!items.length && <EmptyState message="Aucune organisation trouvée." />}
        </div>
      )}
      {creating ? (
        <Modal title="Créer une organisation" onClose={() => { setCreating(false); setError(''); }}>
          <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void submit(new FormData(event.currentTarget)); }}>
            <label>Nom<input name="name" required /></label>
            <label>Slug<input name="slug" required /></label>
            <label>Statut
              <select name="status" defaultValue="ACTIVE">
                <option value="ACTIVE">Active</option>
                <option value="TEST">Test</option>
                <option value="SUSPENDED">Suspendue</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </label>
            <div className="modal-footer modal-footer-sticky">
              <button type="button" className="secondary" onClick={() => setCreating(false)}>Annuler</button>
              <button type="submit">Créer</button>
            </div>
          </form>
        </Modal>
      ) : null}
    </section>
  );
}

export function PlatformOrganizationDetailPage() {
  const { id } = useParams();
  const organizationId = Number(id);
  const canManage = useIsSuperAdmin();
  const [detail, setDetail] = useState<PlatformOrganizationDetail | null>(null);
  const [modules, setModules] = useState<PlatformOrganizationModule[]>([]);
  const [activity, setActivity] = useState<PlatformActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [suspending, setSuspending] = useState(false);
  const [reactivating, setReactivating] = useState(false);
  const [activeTab, setActiveTab] = useState<DetailTabKey>('overview');

  async function load() {
    setLoading(true);
    try {
      const [detailResponse, modulesResponse, activityResponse] = await Promise.all([
        api.get<PlatformOrganizationDetail>(`/platform/organizations/${organizationId}`),
        api.get<PlatformOrganizationModule[]>(`/platform/organizations/${organizationId}/modules`),
        api.get<PlatformActivityEntry[]>(`/platform/organizations/${organizationId}/activity`),
      ]);
      setDetail(detailResponse.data);
      setModules(modulesResponse.data);
      setActivity(activityResponse.data);
      setError('');
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!organizationId) return;
    void load();
  }, [organizationId]);

  async function updateOrganization(form: FormData) {
    try {
      await api.patch(`/platform/organizations/${organizationId}`, Object.fromEntries(form));
      setSuccess('Organisation mise à jour.');
      setEditing(false);
      await load();
    } catch (err) {
      setError(extractApiError(err));
    }
  }

  async function suspendOrganization(form: FormData) {
    try {
      await api.post(`/platform/organizations/${organizationId}/suspend`, Object.fromEntries(form));
      setSuccess('Organisation suspendue.');
      setSuspending(false);
      await load();
    } catch (err) {
      setError(extractApiError(err));
    }
  }

  async function reactivateOrganization(form: FormData) {
    try {
      await api.post(`/platform/organizations/${organizationId}/reactivate`, Object.fromEntries(form));
      setSuccess('Organisation réactivée.');
      setReactivating(false);
      await load();
    } catch (err) {
      setError(extractApiError(err));
    }
  }

  async function toggleModule(moduleCode: string, enable: boolean) {
    try {
      await api.post(`/platform/organizations/${organizationId}/modules/${moduleCode}/${enable ? 'enable' : 'disable'}`);
      setSuccess(enable ? 'Module activé.' : 'Module désactivé.');
      await load();
    } catch (err) {
      setError(extractApiError(err));
    }
  }

  const enabledModules = useMemo(
    () => modules.filter((item) => item.is_enabled).map((item) => item.module_code),
    [modules],
  );

  if (loading) return <section><PageHeader title="Organisation" /><div className="loading-state"><span className="spinner" />Chargement...</div></section>;
  if (!detail) return <section><PageHeader title="Organisation" /><EmptyState message={error || 'Organisation introuvable.'} /></section>;

  return (
    <section>
      <PageHeader
        title={detail.name}
        action={
          canManage ? (
            <div className="page-header-actions">
              <button className="secondary" onClick={() => setEditing(true)}>Modifier</button>
              {detail.status === 'SUSPENDED'
                ? <button onClick={() => setReactivating(true)}>Réactiver</button>
                : <button className="danger" onClick={() => setSuspending(true)}>Suspendre</button>}
            </div>
          ) : undefined
        }
      />
      <div className="table-secondary" style={{ marginTop: -8, marginBottom: 16 }}>
        Slug : {detail.slug}
      </div>
      <SuccessMessage message={success} />
      {error ? <div className="error-message">{error}</div> : null}

      <div className="mini-stats">
        <StatCard label="Statut" value={detail.status} />
        <StatCard label="Utilisateurs" value={detail.users_count ?? 0} />
        <StatCard label="Adhésions" value={detail.memberships_count ?? 0} />
        <StatCard label="Modules actifs" value={enabledModules.length} />
      </div>

      <div className="detail-tabs">
        <DetailTab label="Vue d’ensemble" active={activeTab === 'overview'} onClick={() => setActiveTab('overview')} />
        <DetailTab label="Modules" active={activeTab === 'modules'} onClick={() => setActiveTab('modules')} />
        <DetailTab label="Activité" active={activeTab === 'activity'} onClick={() => setActiveTab('activity')} />
      </div>

      {activeTab === 'overview' ? (
        <div className="settings-grid">
          <div className="detail-section">
            <h4>Identité</h4>
            <dl className="detail-list">
              <div><dt>Nom</dt><dd>{detail.name}</dd></div>
              <div><dt>Slug</dt><dd>{detail.slug}</dd></div>
              <div><dt>Entreprise</dt><dd>{detail.company_name ?? '—'}</dd></div>
              <div><dt>Statut</dt><dd><StatusBadge status={detail.status} /></dd></div>
            </dl>
          </div>
          <div className="detail-section">
            <h4>Contact</h4>
            <dl className="detail-list">
              <div><dt>Email</dt><dd>{detail.primary_email ?? '—'}</dd></div>
              <div><dt>Téléphone</dt><dd>{detail.phone ?? '—'}</dd></div>
              <div><dt>Ville</dt><dd>{detail.city ?? '—'}</dd></div>
              <div><dt>Pays</dt><dd>{detail.country ?? '—'}</dd></div>
            </dl>
          </div>
          <div className="detail-section">
            <h4>Configuration</h4>
            <dl className="detail-list">
              <div><dt>Devise</dt><dd>{detail.currency ?? '—'}</dd></div>
              <div><dt>Langue</dt><dd>{detail.language ?? '—'}</dd></div>
              <div><dt>Fuseau</dt><dd>{detail.timezone ?? '—'}</dd></div>
              <div><dt>Créée le</dt><dd>{formatDate(detail.created_at)}</dd></div>
            </dl>
          </div>
          <div className="detail-section">
            <h4>État plateforme</h4>
            <dl className="detail-list">
              <div><dt>Suspendue le</dt><dd>{formatDate(detail.suspended_at ?? undefined)}</dd></div>
              <div><dt>Motif suspension</dt><dd>{detail.suspension_reason ?? '—'}</dd></div>
              <div><dt>Réactivée le</dt><dd>{formatDate(detail.reactivated_at ?? undefined)}</dd></div>
              <div><dt>Motif réactivation</dt><dd>{detail.reactivation_reason ?? '—'}</dd></div>
            </dl>
          </div>
        </div>
      ) : null}

      {activeTab === 'modules' ? (
        <div className="detail-section">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Module</th><th>Catégorie</th><th>Description</th><th>État</th><th>Mis à jour</th><th>Action</th></tr></thead>
              <tbody>
                {modules.map((item) => (
                  <tr key={item.module_code}>
                    <td><strong>{item.label}</strong><div className="table-secondary">{item.module_code}</div></td>
                    <td>{item.category}</td>
                    <td>{item.description ?? '—'}</td>
                    <td>{item.is_enabled ? 'Activé' : 'Désactivé'}</td>
                    <td>{formatDate(item.is_enabled ? item.enabled_at ?? undefined : item.disabled_at ?? undefined)}</td>
                    <td>
                      {canManage ? (
                        item.is_enabled
                          ? <button className="secondary" onClick={() => void toggleModule(item.module_code, false)}>Désactiver</button>
                          : <button onClick={() => void toggleModule(item.module_code, true)}>Activer</button>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {activeTab === 'activity' ? (
        <div className="detail-section">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Action</th><th>Avant</th><th>Après</th><th>Date</th></tr></thead>
              <tbody>
                {activity.map((item, index) => (
                  <tr key={String(item.id ?? index)}>
                    <td>{String(item.action ?? '—')}</td>
                    <td>{compactJson(item.before_json)}</td>
                    <td>{compactJson(item.after_json)}</td>
                    <td>{formatDate(String(item.created_at ?? ''))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!activity.length && <EmptyState message="Aucune activité organisation." />}
          </div>
        </div>
      ) : null}

      {editing ? (
        <Modal title="Modifier l’organisation" onClose={() => setEditing(false)}>
          <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void updateOrganization(new FormData(event.currentTarget)); }}>
            <label>Nom<input name="name" defaultValue={detail.name} required /></label>
            <label>Slug<input name="slug" defaultValue={detail.slug} required /></label>
            <label>Statut
              <select name="status" defaultValue={detail.status}>
                <option value="ACTIVE">Active</option>
                <option value="TEST">Test</option>
                <option value="SUSPENDED">Suspendue</option>
                <option value="INACTIVE">Inactive</option>
                <option value="ARCHIVED">Archivée</option>
              </select>
            </label>
            <div className="modal-footer modal-footer-sticky">
              <button type="button" className="secondary" onClick={() => setEditing(false)}>Annuler</button>
              <button type="submit">Enregistrer</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {suspending ? (
        <Modal title="Suspendre l’organisation" onClose={() => setSuspending(false)}>
          <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void suspendOrganization(new FormData(event.currentTarget)); }}>
            <label>Motif<textarea name="reason" rows={4} required /></label>
            <div className="modal-footer modal-footer-sticky">
              <button type="button" className="secondary" onClick={() => setSuspending(false)}>Annuler</button>
              <button type="submit" className="danger">Suspendre</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {reactivating ? (
        <Modal title="Réactiver l’organisation" onClose={() => setReactivating(false)}>
          <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void reactivateOrganization(new FormData(event.currentTarget)); }}>
            <label>Motif (optionnel)<textarea name="reason" rows={4} /></label>
            <div className="modal-footer modal-footer-sticky">
              <button type="button" className="secondary" onClick={() => setReactivating(false)}>Annuler</button>
              <button type="submit">Réactiver</button>
            </div>
          </form>
        </Modal>
      ) : null}
    </section>
  );
}

export function PlatformModulesPage() {
  const [modules, setModules] = useState<PlatformModule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void api.get<PlatformModule[]>('/platform/modules').then((response) => {
      setModules(response.data);
      setLoading(false);
    });
  }, []);

  return (
    <section>
      <PageHeader title="Catalogue des modules" />
      {loading ? <div className="loading-state"><span className="spinner" />Chargement...</div> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Module</th><th>Catégorie</th><th>Description</th></tr></thead>
            <tbody>
              {modules.map((item) => (
                <tr key={item.code}>
                  <td><strong>{item.label}</strong><div className="table-secondary">{item.code}</div></td>
                  <td>{item.category}</td>
                  <td>{item.description ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!modules.length && <EmptyState message="Aucun module déclaré." />}
        </div>
      )}
    </section>
  );
}

export function PlatformUsersPage() {
  const isSuperAdmin = useIsSuperAdmin();
  const [items, setItems] = useState<PlatformUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    const response = await api.get<PlatformUser[]>('/platform/users');
    setItems(response.data);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function submit(form: FormData) {
    setError('');
    try {
      await api.post('/platform/users', Object.fromEntries(form));
      setSuccess('Utilisateur plateforme créé.');
      setCreating(false);
      await load();
    } catch (err) {
      setError(extractApiError(err));
    }
  }

  return (
    <section>
      <PageHeader title="Utilisateurs plateforme" action={isSuperAdmin ? <button onClick={() => setCreating(true)}>Créer utilisateur</button> : undefined} />
      <SuccessMessage message={success} />
      {error ? <div className="error-message">{error}</div> : null}
      {loading ? <div className="loading-state"><span className="spinner" />Chargement...</div> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Nom</th><th>Email</th><th>Rôle plateforme</th><th>Rôle par défaut</th><th>Organisation par défaut</th><th>Organisations</th><th>Statut</th></tr></thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{`${item.first_name ?? ''} ${item.last_name ?? ''}`.trim() || item.email}</td>
                  <td>{item.email}</td>
                  <td>{item.platform_role ?? '—'}</td>
                  <td>{item.default_membership_role ?? '—'}</td>
                  <td>{item.organization_name ?? '—'}</td>
                  <td>{item.organizations_count ?? 0}</td>
                  <td>{item.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!items.length && <EmptyState message="Aucun utilisateur trouvé." />}
        </div>
      )}
      {creating && isSuperAdmin ? (
        <Modal title="Créer un utilisateur plateforme" onClose={() => { setCreating(false); setError(''); }}>
          <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void submit(new FormData(event.currentTarget)); }}>
            <label>Prénom<input name="first_name" required /></label>
            <label>Nom<input name="last_name" required /></label>
            <label>Adresse e-mail<input name="email" type="email" required /></label>
            <label>Mot de passe<input name="password" type="password" minLength={4} required /></label>
            <label>Rôle plateforme
              <select name="platform_role" defaultValue="">
                <option value="">Aucun</option>
                <option value="SUPER_ADMIN">SUPER_ADMIN</option>
                <option value="ADMIN_PLATFORM">ADMIN_PLATFORM</option>
              </select>
            </label>
            <label>Statut
              <select name="status" defaultValue="ACTIVE">
                <option value="ACTIVE">Actif</option>
                <option value="INACTIVE">Inactif</option>
              </select>
            </label>
            <div className="modal-footer modal-footer-sticky">
              <button type="button" className="secondary" onClick={() => setCreating(false)}>Annuler</button>
              <button type="submit">Créer</button>
            </div>
          </form>
        </Modal>
      ) : null}
    </section>
  );
}

export function PlatformMembershipsPage() {
  const isSuperAdmin = useIsSuperAdmin();
  const [items, setItems] = useState<PlatformMembership[]>([]);
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [organizations, setOrganizations] = useState<PlatformOrganization[]>([]);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  async function load() {
    const [membershipResponse, userResponse, organizationResponse] = await Promise.all([
      api.get<PlatformMembership[]>('/platform/memberships'),
      api.get<PlatformUser[]>('/platform/users'),
      api.get<PlatformOrganization[]>('/platform/organizations'),
    ]);
    setItems(membershipResponse.data);
    setUsers(userResponse.data);
    setOrganizations(organizationResponse.data);
  }

  useEffect(() => { void load(); }, []);

  async function submit(form: FormData) {
    setError('');
    try {
      await api.post('/platform/memberships', {
        user_id: Number(form.get('user_id')),
        organization_id: Number(form.get('organization_id')),
        role_code: String(form.get('role_code')),
        is_active: true,
        is_default: form.get('is_default') === 'on',
      });
      setSuccess('Adhésion enregistrée.');
      await load();
    } catch (err) {
      setError(extractApiError(err));
    }
  }

  return (
    <section>
      <PageHeader title="Adhésions" />
      <SuccessMessage message={success} />
      {error ? <div className="error-message">{error}</div> : null}
      {isSuperAdmin ? (
        <div className="detail-section">
          <h4>Ajouter ou mettre à jour une adhésion</h4>
          <form className="quick-form" onSubmit={(event) => { event.preventDefault(); void submit(new FormData(event.currentTarget)); }}>
            <label>Utilisateur
              <select name="user_id" required defaultValue="">
                <option value="" disabled>Sélectionner</option>
                {users.map((item) => <option key={item.id} value={item.id}>{`${item.first_name} ${item.last_name}`.trim()} - {item.email}</option>)}
              </select>
            </label>
            <label>Organisation
              <select name="organization_id" required defaultValue="">
                <option value="" disabled>Sélectionner</option>
                {organizations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label>Rôle
              <select name="role_code" defaultValue="VIEWER_CLIENT">
                <option value="ADMIN_CLIENT">ADMIN_CLIENT</option>
                <option value="EDITOR_CLIENT">EDITOR_CLIENT</option>
                <option value="VIEWER_CLIENT">VIEWER_CLIENT</option>
              </select>
            </label>
            <label><span>Organisation par défaut</span><input name="is_default" type="checkbox" /></label>
            <button type="submit">Enregistrer</button>
          </form>
        </div>
      ) : null}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Utilisateur</th><th>Email</th><th>Organisation</th><th>Rôle</th><th>Active</th><th>Défaut</th><th>Créée le</th></tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.user_name}</td>
                <td>{item.email}</td>
                <td>{item.organization_name}</td>
                <td>{item.role_code}</td>
                <td>{item.is_active ? 'Oui' : 'Non'}</td>
                <td>{item.is_default ? 'Oui' : 'Non'}</td>
                <td>{formatDate(item.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && <EmptyState message="Aucune adhésion trouvée." />}
      </div>
    </section>
  );
}

export function PlatformRolesPage() {
  const [data, setData] = useState<{ platformRoles: Array<{ code: string; label: string }>; organizationRoles: Array<{ code: string; label: string }> } | null>(null);
  useEffect(() => {
    void api.get('/platform/roles').then((response) => setData(response.data));
  }, []);

  return (
    <section>
      <PageHeader title="Rôles et permissions" />
      {!data ? <div className="loading-state"><span className="spinner" />Chargement...</div> : (
        <div className="settings-grid">
          <div className="detail-section">
            <h4>Rôles plateforme</h4>
            <ul>
              {data.platformRoles.map((item) => <li key={item.code}><strong>{item.code}</strong> - {item.label}</li>)}
            </ul>
          </div>
          <div className="detail-section">
            <h4>Rôles organisation</h4>
            <ul>
              {data.organizationRoles.map((item) => <li key={item.code}><strong>{item.code}</strong> - {item.label}</li>)}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

export function PlatformActivityPage() {
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  useEffect(() => {
    void api.get('/platform/activity').then((response) => setItems(response.data));
  }, []);
  return (
    <section>
      <PageHeader title="Activité plateforme" />
      <div className="table-wrap">
        <table>
          <thead><tr><th>Action</th><th>Acteur</th><th>Utilisateur cible</th><th>Organisation</th><th>Date</th></tr></thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={String(item.id ?? index)}>
                <td>{String(item.action ?? '—')}</td>
                <td>{String(item.actor_name ?? '—')}</td>
                <td>{String(item.target_name ?? '—')}</td>
                <td>{String(item.organization_name ?? '—')}</td>
                <td>{formatDate(String(item.created_at ?? ''))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && <EmptyState message="Aucune activité plateforme." />}
      </div>
    </section>
  );
}

export function PlatformSettingsPage() {
  return (
    <section>
      <PageHeader title="Paramètres plateforme" />
      <EmptyState message="La gestion avancée plateforme est prête pour l’étape suivante." />
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: unknown }) {
  return <div className="mini-stat"><span>{label}</span><strong>{String(value ?? 0)}</strong></div>;
}

function DetailTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button className={active ? 'detail-tab active' : 'detail-tab'} onClick={onClick}>{label}</button>;
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`status-chip status-${String(status ?? '').toLowerCase()}`}>{status}</span>;
}

function ModuleBadgeList({ modules }: { modules: string[] }) {
  if (!modules.length) return <span>—</span>;
  return (
    <div className="inline-badges">
      {modules.slice(0, 4).map((item) => <span key={item} className="inline-badge">{item}</span>)}
      {modules.length > 4 ? <span className="inline-badge">+{modules.length - 4}</span> : null}
    </div>
  );
}

function formatDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('fr-FR');
}

function compactJson(value: unknown) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return '—';
  }
}

function extractApiError(error: unknown) {
  const response = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data;
  if (Array.isArray(response?.message)) return response.message.join(' | ');
  if (typeof response?.message === 'string') return response.message;
  return 'Impossible d’enregistrer les modifications.';
}
