import { Eye, KeyRound, Pencil, Power, RotateCcw, UserPlus, type LucideIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api, exportExcel, includesText, shortDate, statusLabel } from '../../../api';
import { useAuth } from '../../../auth';
import { EmptyState, Modal, PageHeader, SuccessMessage } from '../../../components';
import { useApiList } from '../../../hooks';

type UserRow = {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  status: string;
  organization_id?: number;
  organization_name?: string;
  last_login_at?: string;
};

type CreateUserPayload =
  | {
      first_name: string;
      last_name: string;
      email: string;
      password: string;
      role: string;
      status: string;
    }
  | {
      error: string;
    };

export function UsersPage() {
  const { can, user } = useAuth();
  const { data, reload } = useApiList<UserRow>('/users');
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [viewing, setViewing] = useState<UserRow | null>(null);
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(
    () =>
      data.filter((item) => {
        if (!includesText(item, query)) return false;
        if (roleFilter !== 'ALL' && normalizeRole(item.role) !== roleFilter) return false;
        if (statusFilter !== 'ALL' && item.status !== statusFilter) return false;
        return true;
      }),
    [data, query, roleFilter, statusFilter],
  );

  async function create(form: FormData) {
    setError('');
    const payload = buildCreatePayload(form);
    if ('error' in payload) {
      setError(payload.error);
      return;
    }

    try {
      await api.post('/users', payload);
      setSuccess('Utilisateur créé avec succès.');
      setCreating(false);
      reload();
    } catch (err) {
      setError(extractApiError(err));
    }
  }

  async function update(form: FormData) {
    if (!editing) return;
    setError('');
    try {
      await api.put(`/users/${editing.id}`, Object.fromEntries(form));
      setSuccess('Utilisateur mis à jour.');
      setEditing(null);
      reload();
    } catch (err) {
      setError(extractApiError(err));
    }
  }

  async function toggleStatus(target: UserRow) {
    setError('');
    try {
      await api.put(`/users/${target.id}`, { status: target.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' });
      setSuccess(target.status === 'ACTIVE' ? 'Utilisateur désactivé.' : 'Utilisateur réactivé.');
      reload();
    } catch (err) {
      setError(extractApiError(err));
    }
  }

  return (
    <section>
      <PageHeader title="Utilisateurs & rôles" />
      <SuccessMessage message={success} />
      {error ? <div className="error-message">{error}</div> : null}

      <div className="mini-stats">
        <div className="mini-stat"><span>Total utilisateurs</span><strong>{data.length}</strong></div>
        <div className="mini-stat"><span>Actifs</span><strong>{data.filter((item) => item.status === 'ACTIVE').length}</strong></div>
        <div className="mini-stat"><span>Inactifs</span><strong>{data.filter((item) => item.status !== 'ACTIVE').length}</strong></div>
        <div className="mini-stat"><span>Administrateurs</span><strong>{data.filter((item) => normalizeRole(item.role) === 'ADMIN').length}</strong></div>
        <div className="mini-stat"><span>Utilisateurs en écriture</span><strong>{data.filter((item) => normalizeRole(item.role) === 'EDITOR').length}</strong></div>
        <div className="mini-stat"><span>Lecture seule</span><strong>{data.filter((item) => normalizeRole(item.role) === 'VIEWER').length}</strong></div>
      </div>

      <div className="table-toolbar">
        <div className="toolbar-main">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Recherche" />
          <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
            <option value="ALL">Rôle</option>
            <option value="ADMIN">Administrateur</option>
            <option value="EDITOR">Utilisateur en écriture</option>
            <option value="VIEWER">Lecture seule</option>
          </select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="ALL">Statut</option>
            <option value="ACTIVE">Actif</option>
            <option value="INACTIVE">Inactif</option>
          </select>
        </div>
        <div className="toolbar-actions">
          <button className="secondary" onClick={() => { setQuery(''); setRoleFilter('ALL'); setStatusFilter('ALL'); }}>Réinitialiser</button>
          <button className="secondary" onClick={() => exportExcel('utilisateurs.xlsx', filtered)}>Excel</button>
          {can('users.create') && (
            <button onClick={() => setCreating(true)}>
              <UserPlus size={16} /> Nouvel utilisateur
            </button>
          )}
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nom</th>
              <th>Email</th>
              <th>Rôle</th>
              <th>Organisation</th>
              <th>Dernière connexion</th>
              <th>Statut</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.id} onClick={() => setViewing(row)} style={{ cursor: 'pointer' }}>
                <td>{`${row.first_name} ${row.last_name}`.trim()}</td>
                <td>{row.email}</td>
                <td>{roleLabel(row.role)}</td>
                <td>{row.organization_name ?? `Organisation ${row.organization_id ?? user?.organization_id ?? 1}`}</td>
                <td>{row.last_login_at ? shortDate(row.last_login_at) : '—'}</td>
                <td>{statusLabel(row.status)}</td>
                <td className="actions actions-compact" onClick={(event) => event.stopPropagation()}>
                  <ActionIconButton icon={Eye} title="Voir" onClick={() => setViewing(row)} />
                  {can('users.update') && <ActionIconButton icon={Pencil} title="Modifier" onClick={() => setEditing(row)} />}
                  <ActionIconButton icon={KeyRound} title="Réinitialisation bientôt disponible" disabled />
                  {can('users.update') && (
                    <ActionIconButton
                      icon={row.status === 'ACTIVE' ? Power : RotateCcw}
                      title={row.status === 'ACTIVE' ? 'Désactiver' : 'Réactiver'}
                      onClick={() => toggleStatus(row)}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && <EmptyState message="Aucun utilisateur trouvé." />}
      </div>

      <div className="pagination-bar">
        <span className="table-meta">{filtered.length} utilisateur(s) affiché(s)</span>
      </div>

      {creating && (
        <Modal title="Créer utilisateur" onClose={() => { setCreating(false); setError(''); }}>
          <CreateUserForm organizationName={user?.organization_name ?? `Organisation ${user?.organization_id ?? 1}`} error={error} onSubmit={create} />
        </Modal>
      )}

      {editing && (
        <Modal title="Modifier utilisateur" onClose={() => { setEditing(null); setError(''); }}>
          <form className="form-grid" onSubmit={(event) => { event.preventDefault(); update(new FormData(event.currentTarget)); }}>
            <label>Prénom<input name="first_name" defaultValue={editing.first_name} required /></label>
            <label>Nom<input name="last_name" defaultValue={editing.last_name} required /></label>
            <label>Adresse e-mail<input name="email" type="email" defaultValue={editing.email} required /></label>
            <label>Rôle
              <select name="role" defaultValue={normalizeRole(editing.role)}>
                <option value="ADMIN">Administrateur</option>
                <option value="EDITOR">Utilisateur en écriture</option>
                <option value="VIEWER">Lecture seule</option>
              </select>
            </label>
            <label>Statut
              <select name="status" defaultValue={editing.status}>
                <option value="ACTIVE">Actif</option>
                <option value="INACTIVE">Inactif</option>
              </select>
            </label>
            <button>Enregistrer</button>
          </form>
        </Modal>
      )}

      {viewing && (
        <Modal title="Fiche utilisateur" onClose={() => setViewing(null)}>
          <div className="detail-list">
            <span>Nom</span><strong>{`${viewing.first_name} ${viewing.last_name}`.trim()}</strong>
            <span>Adresse e-mail</span><strong>{viewing.email}</strong>
            <span>Rôle</span><strong>{roleLabel(viewing.role)}</strong>
            <span>Organisation</span><strong>{viewing.organization_name ?? `Organisation ${viewing.organization_id ?? user?.organization_id ?? 1}`}</strong>
            <span>Dernière connexion</span><strong>{viewing.last_login_at ? shortDate(viewing.last_login_at) : 'Non disponible'}</strong>
            <span>Statut</span><strong>{statusLabel(viewing.status)}</strong>
          </div>
        </Modal>
      )}
    </section>
  );
}

function CreateUserForm({
  organizationName,
  error,
  onSubmit,
}: {
  organizationName: string;
  error: string;
  onSubmit: (form: FormData) => Promise<void>;
}) {
  return (
    <form
      className="form-grid"
      onSubmit={async (event) => {
        event.preventDefault();
        await onSubmit(new FormData(event.currentTarget));
      }}
    >
      <div className="detail-section" style={{ gridColumn: '1 / -1' }}>
        <h4>Identité</h4>
        <div className="form-grid">
          <label>Nom complet *<input name="full_name" placeholder="Nom complet" required /></label>
          <label>Adresse e-mail *<input name="email" type="email" placeholder="Adresse e-mail" required /></label>
          <label>Téléphone<input value="Bientôt" disabled /></label>
          <label>Statut
            <select name="status" defaultValue="ACTIVE">
              <option value="ACTIVE">Actif</option>
              <option value="INACTIVE">Inactif</option>
            </select>
          </label>
        </div>
      </div>

      <div className="detail-section" style={{ gridColumn: '1 / -1' }}>
        <h4>Accès</h4>
        <div className="form-grid">
          <label>Rôle *<select name="role" defaultValue="EDITOR"><option value="ADMIN">Administrateur</option><option value="EDITOR">Utilisateur en écriture</option><option value="VIEWER">Lecture seule</option></select></label>
          <label>Organisation *<input value={organizationName} disabled /></label>
          <label>Site<input value="Bientôt" disabled /></label>
          <label>Permissions spécifiques<input value="Bientôt" disabled /></label>
        </div>
      </div>

      <div className="detail-section" style={{ gridColumn: '1 / -1' }}>
        <h4>Sécurité</h4>
        <div className="form-grid">
          <label>Mot de passe temporaire *<input name="password" type="password" minLength={4} required /></label>
          <label>Confirmer mot de passe *<input name="confirm_password" type="password" minLength={4} required /></label>
          <label>Changement à la première connexion<input value="Bientôt" disabled /></label>
          <label>Envoyer les identifiants<input value="Simulation bientôt disponible" disabled /></label>
        </div>
      </div>

      {error ? <div className="error-message" style={{ gridColumn: '1 / -1' }}>{error}</div> : null}
      <button>Enregistrer</button>
    </form>
  );
}

function ActionIconButton({
  icon: Icon,
  title,
  onClick,
  disabled,
}: {
  icon: LucideIcon;
  title: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button type="button" className="icon-btn" title={title} onClick={onClick} disabled={disabled}>
      <Icon size={16} />
    </button>
  );
}

function buildCreatePayload(form: FormData): CreateUserPayload {
  const fullName = String(form.get('full_name') ?? '').trim();
  const email = String(form.get('email') ?? '').trim();
  const password = String(form.get('password') ?? '');
  const confirmPassword = String(form.get('confirm_password') ?? '');
  const role = String(form.get('role') ?? 'EDITOR');
  const status = String(form.get('status') ?? 'ACTIVE');

  if (!fullName || !email || !password) {
    return { error: 'Les champs Nom complet, Adresse e-mail et Mot de passe sont obligatoires.' };
  }
  if (password.length < 4) {
    return { error: 'Le mot de passe temporaire doit contenir au moins 4 caractères.' };
  }
  if (password !== confirmPassword) {
    return { error: 'La confirmation du mot de passe ne correspond pas.' };
  }

  const parts = fullName.split(/\s+/).filter(Boolean);
  const firstName = parts.shift() ?? '';
  const lastName = parts.join(' ') || firstName;

  return {
    first_name: firstName,
    last_name: lastName,
    email,
    password,
    role,
    status,
  };
}

function extractApiError(error: unknown) {
  const response = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data;
  if (Array.isArray(response?.message)) return response.message.join(' | ');
  if (typeof response?.message === 'string') return response.message;
  return 'Impossible d’enregistrer les modifications utilisateur.';
}

function roleLabel(role: string) {
  return ({
    ADMIN: 'Administrateur',
    EDITOR: 'Utilisateur en écriture',
    VIEWER: 'Lecture seule',
    ACCOUNTANT: 'Utilisateur en écriture',
    STAFF: 'Utilisateur en écriture',
    AGENT: 'Utilisateur en écriture',
    GESTIONNAIRE: 'Utilisateur en écriture',
    DIRECTOR: 'Lecture seule',
    DIRECTEUR: 'Lecture seule',
    COMPTABLE: 'Utilisateur en écriture',
  })[normalizeRole(role)] ?? role;
}

function normalizeRole(role: string) {
  const value = role.toUpperCase();
  if (value === 'ADMIN') return 'ADMIN';
  if (['EDITOR', 'ACCOUNTANT', 'STAFF', 'AGENT', 'GESTIONNAIRE', 'COMPTABLE'].includes(value)) return 'EDITOR';
  return 'VIEWER';
}
