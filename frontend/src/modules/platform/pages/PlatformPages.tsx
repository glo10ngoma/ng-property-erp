import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../core/api/axios';
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
                  <td>{item.name}</td>
                  <td>{item.slug}</td>
                  <td>{item.status}</td>
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
  const [items, setItems] = useState<PlatformOrganization[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    const response = await api.get<PlatformOrganization[]>('/platform/organizations', { params: { search: search || undefined, status: status === 'ALL' ? undefined : status } });
    setItems(response.data);
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
            <option value="ALL">Statut</option>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspendue</option>
            <option value="ARCHIVED">Archivée</option>
          </select>
        </div>
        <div className="toolbar-actions">
          <button className="secondary" onClick={() => { setSearch(''); setStatus('ALL'); void load(); }}>Réinitialiser</button>
          <button onClick={() => void load()}>Actualiser</button>
        </div>
      </div>
      {loading ? <div className="loading-state"><span className="spinner" />Chargement...</div> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Nom</th><th>Slug</th><th>Statut</th><th>Ville</th><th>Pays</th><th>Utilisateurs</th><th>Adhésions</th><th>Créée le</th></tr></thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td>{item.slug}</td>
                  <td>{item.status}</td>
                  <td>{item.city ?? '—'}</td>
                  <td>{item.country ?? '—'}</td>
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
      {creating && (
        <Modal title="Créer une organisation" onClose={() => { setCreating(false); setError(''); }}>
          <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void submit(new FormData(event.currentTarget)); }}>
            <label>Nom<input name="name" required /></label>
            <label>Slug<input name="slug" required /></label>
            <label>Statut
              <select name="status" defaultValue="ACTIVE">
                <option value="ACTIVE">Active</option>
                <option value="SUSPENDED">Suspendue</option>
              </select>
            </label>
            <div className="modal-footer modal-footer-sticky">
              <button type="button" className="secondary" onClick={() => setCreating(false)}>Annuler</button>
              <button type="submit">Créer</button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}

export function PlatformUsersPage() {
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
      <PageHeader title="Utilisateurs plateforme" action={<button onClick={() => setCreating(true)}>Créer utilisateur</button>} />
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
      {creating && (
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
      )}
    </section>
  );
}

export function PlatformMembershipsPage() {
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
      <EmptyState message="La gestion des abonnements et paramètres plateforme est prête pour l’étape suivante." />
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: unknown }) {
  return <div className="mini-stat"><span>{label}</span><strong>{String(value ?? 0)}</strong></div>;
}

function formatDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('fr-FR');
}

function extractApiError(error: unknown) {
  const response = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data;
  if (Array.isArray(response?.message)) return response.message.join(' | ');
  if (typeof response?.message === 'string') return response.message;
  return 'Impossible d’enregistrer les modifications.';
}
