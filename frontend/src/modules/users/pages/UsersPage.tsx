import { Eye, EyeOff, KeyRound, Pencil, Power, RotateCcw, UserPlus, type LucideIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api, exportExcel, includesText, shortDate, statusLabel } from '../../../api';
import { useAuth } from '../../../auth';
import { EmptyState, Modal, PageHeader, SuccessMessage } from '../../../components';
import { useApiList } from '../../../hooks';

type UserRow = {
  id: number;
  full_name?: string;
  name?: string;
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

  const activeOrganizationName = user?.organization_name ?? `Organisation ${user?.organization_id ?? 1}`;
  const isSuperAdmin = String(user?.platform_role ?? user?.role ?? '').trim().toUpperCase() === 'SUPER_ADMIN';

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
        <div className="mini-stat"><span>Administrateurs client</span><strong>{data.filter((item) => normalizeRole(item.role) === 'ADMIN').length}</strong></div>
        <div className="mini-stat"><span>Utilisateurs en écriture</span><strong>{data.filter((item) => normalizeRole(item.role) === 'EDITOR').length}</strong></div>
        <div className="mini-stat"><span>Lecture seule</span><strong>{data.filter((item) => normalizeRole(item.role) === 'VIEWER').length}</strong></div>
      </div>

      <div className="table-toolbar">
        <div className="toolbar-main">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Recherche" />
          <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
            <option value="ALL">Rôle</option>
            <option value="ADMIN">Administrateur client</option>
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
          {can('users.create') && isSuperAdmin && (
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
                <td>{displayUserName(row)}</td>
                <td>{row.email}</td>
                <td>{roleLabel(row.role)}</td>
                <td>{row.organization_name ?? activeOrganizationName}</td>
                <td>{row.last_login_at ? shortDate(row.last_login_at) : '—'}</td>
                <td>{statusLabel(row.status)}</td>
                <td className="actions actions-compact" onClick={(event) => event.stopPropagation()}>
                  <ActionIconButton icon={Eye} title="Voir" onClick={() => setViewing(row)} />
                  {can('users.update') && !isPlatformAccount(row.role) && <ActionIconButton icon={Pencil} title="Modifier" onClick={() => setEditing(row)} />}
                  <ActionIconButton icon={KeyRound} title="Réinitialisation bientôt disponible" disabled />
                  {can('users.update') && !isPlatformAccount(row.role) && (
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
        <Modal
          title="Créer utilisateur"
          className="user-modal"
          onClose={() => {
            setCreating(false);
            setError('');
          }}
        >
          <CreateUserForm
            organizationName={activeOrganizationName}
            error={error}
            onCancel={() => {
              setCreating(false);
              setError('');
            }}
            onSubmit={create}
          />
        </Modal>
      )}

      {editing && (
        <Modal title="Modifier utilisateur" onClose={() => { setEditing(null); setError(''); }}>
          <form
            className="form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              update(new FormData(event.currentTarget));
            }}
          >
            <label>Prénom<input name="first_name" defaultValue={editing.first_name} required /></label>
            <label>Nom<input name="last_name" defaultValue={editing.last_name} required /></label>
            <label>Adresse e-mail<input name="email" type="email" defaultValue={editing.email} required /></label>
            <label>Rôle
              <select name="role" defaultValue={normalizeScopedRole(editing.role)}>
                <option value="ADMIN_CLIENT">Administrateur client</option>
                <option value="EDITOR_CLIENT">Utilisateur en écriture</option>
                <option value="VIEWER_CLIENT">Lecture seule</option>
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
            <span>Nom</span><strong>{displayUserName(viewing)}</strong>
            <span>Adresse e-mail</span><strong>{viewing.email}</strong>
            <span>Rôle</span><strong>{roleLabel(viewing.role)}</strong>
            <span>Organisation</span><strong>{viewing.organization_name ?? activeOrganizationName}</strong>
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
  onCancel,
  onSubmit,
}: {
  organizationName: string;
  error: string;
  onCancel: () => void;
  onSubmit: (form: FormData) => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  return (
    <form
      id="create-user-form"
      className="user-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setSubmitting(true);
        try {
          await onSubmit(new FormData(event.currentTarget));
        } finally {
          setSubmitting(false);
        }
      }}
    >
      {error ? <div className="error-message user-form-error">{error}</div> : null}

      <div className="detail-section user-form-section">
        <h4>Identité</h4>
        <div className="user-form-grid">
          <label className="user-form-wide">Nom complet *<input name="full_name" placeholder="Nom complet" required autoComplete="name" /></label>
          <label className="user-form-wide">Adresse e-mail *<input name="email" type="email" placeholder="Adresse e-mail" required autoComplete="email" /></label>
          <label>Rôle *
            <select name="role" defaultValue="EDITOR_CLIENT" required>
              <option value="ADMIN_CLIENT">Administrateur client</option>
              <option value="EDITOR_CLIENT">Utilisateur en écriture</option>
              <option value="VIEWER_CLIENT">Lecture seule</option>
            </select>
          </label>
          <label>Statut
            <select name="status" defaultValue="ACTIVE">
              <option value="ACTIVE">Actif</option>
              <option value="INACTIVE">Inactif</option>
            </select>
          </label>
        </div>
      </div>

      <div className="detail-section user-form-section">
        <h4>Accès</h4>
        <div className="user-form-grid">
          <label className="user-form-wide">Organisation active *<input value={organizationName} disabled /></label>
          <div className="user-form-hint user-form-wide">
            <span>Portée</span>
            <strong>Le nouvel utilisateur sera rattaché à l’organisation actuellement sélectionnée.</strong>
          </div>
        </div>
      </div>

      <div className="detail-section user-form-section">
        <h4>Sécurité</h4>
        <div className="user-form-grid">
          <label>
            Mot de passe temporaire *
            <div className="password-input">
              <input
                name="password"
                type={showPassword ? 'text' : 'password'}
                minLength={4}
                required
                autoComplete="new-password"
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                title={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>
          <label>
            Confirmer mot de passe *
            <div className="password-input">
              <input
                name="confirm_password"
                type={showConfirmPassword ? 'text' : 'password'}
                minLength={4}
                required
                autoComplete="new-password"
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowConfirmPassword((value) => !value)}
                aria-label={showConfirmPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                title={showConfirmPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
              >
                {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>
        </div>
      </div>

      <div className="modal-footer modal-footer-sticky user-form-footer">
        <button className="secondary" type="button" onClick={onCancel} disabled={submitting}>
          Annuler
        </button>
        <button type="submit" disabled={submitting}>
          {submitting ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
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
  const role = normalizeScopedRole(String(form.get('role') ?? 'EDITOR_CLIENT'));
  const status = String(form.get('status') ?? 'ACTIVE');

  if (!fullName || !email || !password) {
    return { error: 'Les champs Nom complet, Adresse e-mail et Mot de passe sont obligatoires.' };
  }
  if (!role) {
    return { error: 'Le rôle est obligatoire.' };
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
  return (
    {
      SUPER_ADMIN: 'Super administrateur',
      ADMIN: 'Administrateur plateforme',
      ADMIN_PLATFORM: 'Administrateur plateforme',
      ADMIN_CLIENT: 'Administrateur client',
      EDITOR: 'Utilisateur en écriture',
      EDITOR_CLIENT: 'Utilisateur en écriture',
      VIEWER: 'Lecture seule',
      VIEWER_CLIENT: 'Lecture seule',
      ACCOUNTANT: 'Utilisateur en écriture',
      STAFF: 'Utilisateur en écriture',
      AGENT: 'Utilisateur en écriture',
      GESTIONNAIRE: 'Utilisateur en écriture',
      DIRECTOR: 'Lecture seule',
      DIRECTEUR: 'Lecture seule',
      COMPTABLE: 'Utilisateur en écriture',
    }[role.toUpperCase()] ?? role
  );
}

function normalizeRole(role: string) {
  const value = role.toUpperCase();
  if (value === 'SUPER_ADMIN' || value === 'ADMIN' || value === 'ADMIN_PLATFORM' || value === 'ADMIN_CLIENT') return 'ADMIN';
  if (['EDITOR', 'EDITOR_CLIENT', 'ACCOUNTANT', 'STAFF', 'AGENT', 'GESTIONNAIRE', 'COMPTABLE'].includes(value)) return 'EDITOR';
  return 'VIEWER';
}

function normalizeScopedRole(role: string) {
  const value = role.toUpperCase();
  if (value === 'ADMIN' || value === 'ADMIN_CLIENT') return 'ADMIN_CLIENT';
  if (['EDITOR', 'EDITOR_CLIENT', 'ACCOUNTANT', 'STAFF', 'AGENT', 'GESTIONNAIRE', 'COMPTABLE'].includes(value)) return 'EDITOR_CLIENT';
  return 'VIEWER_CLIENT';
}

function isPlatformAccount(role: string) {
  const value = role.toUpperCase();
  return value === 'ADMIN' || value === 'ADMIN_PLATFORM' || value === 'SUPER_ADMIN';
}

function displayUserName(user: Pick<UserRow, 'first_name' | 'last_name' | 'full_name' | 'name' | 'email'>) {
  const fullName = user.full_name?.trim();
  if (fullName) return fullName;

  const fallbackName = user.name?.trim();
  if (fallbackName) return fallbackName;

  const firstName = user.first_name?.trim();
  const lastName = user.last_name?.trim();
  if (firstName && lastName && firstName !== lastName) return `${firstName} ${lastName}`;
  if (firstName) return firstName;
  if (lastName) return lastName;
  return user.email;
}
