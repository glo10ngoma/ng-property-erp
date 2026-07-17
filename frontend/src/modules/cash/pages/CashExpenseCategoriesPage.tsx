import { ArrowLeft, Pencil, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../api';
import { useAuth } from '../../../auth';
import { EmptyState, LoadingState, Modal, PageHeader, SuccessMessage } from '../../../components';
import { useApiList } from '../../../hooks';

type CashExpenseCategory = {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  status: 'ACTIVE' | 'INACTIVE';
};

export function CashExpenseCategoriesPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const list = useApiList<CashExpenseCategory>('/cash/expense-categories');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<CashExpenseCategory | null>(null);
  const [success, setSuccess] = useState('');

  const ordered = useMemo(
    () =>
      [...list.data].sort((left, right) => {
        if (left.status !== right.status) return left.status === 'ACTIVE' ? -1 : 1;
        return left.name.localeCompare(right.name, 'fr', { sensitivity: 'base' });
      }),
    [list.data],
  );

  async function save(form: FormData, current?: CashExpenseCategory | null) {
    const payload = {
      code: String(form.get('code') ?? '').trim(),
      name: String(form.get('name') ?? '').trim(),
      description: String(form.get('description') ?? '').trim() || null,
      status: String(form.get('status') ?? 'ACTIVE').trim().toUpperCase(),
    };
    if (current?.id) {
      await api.patch(`/cash/expense-categories/${current.id}`, payload);
      setEditing(null);
      setSuccess('Categorie de depense modifiee.');
    } else {
      await api.post('/cash/expense-categories', payload);
      setCreateOpen(false);
      setSuccess('Categorie de depense creee.');
    }
    await list.reload();
  }

  return (
    <section>
      <PageHeader
        title="Categories de depenses"
        action={
          <div className="actions-row">
            <button type="button" className="secondary" onClick={() => navigate('/cash')}>
              <ArrowLeft size={16} />
              Retour caisse
            </button>
            {can('cash.create') ? (
              <button type="button" onClick={() => setCreateOpen(true)}>
                <Plus size={16} />
                Nouvelle categorie
              </button>
            ) : null}
          </div>
        }
      />
      <SuccessMessage message={success} />
      {list.loading ? (
        <LoadingState />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Nom</th>
                <th>Description</th>
                <th>Statut</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((row) => (
                <tr key={row.id}>
                  <td>{row.code}</td>
                  <td>{row.name}</td>
                  <td>{row.description ?? '-'}</td>
                  <td>{row.status === 'ACTIVE' ? 'Actif' : 'Inactif'}</td>
                  <td className="actions actions-compact">
                    {can('cash.update') ? (
                      <button type="button" className="icon-btn" title="Modifier" onClick={() => setEditing(row)}>
                        <Pencil size={15} />
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!ordered.length ? <EmptyState message="Aucune categorie de depense." /> : null}
        </div>
      )}

      {createOpen ? (
        <CashExpenseCategoryModal
          title="Nouvelle categorie"
          onClose={() => setCreateOpen(false)}
          onSubmit={(form) => save(form, null)}
        />
      ) : null}
      {editing ? (
        <CashExpenseCategoryModal
          title="Modifier categorie"
          category={editing}
          onClose={() => setEditing(null)}
          onSubmit={(form) => save(form, editing)}
        />
      ) : null}
    </section>
  );
}

function CashExpenseCategoryModal({
  title,
  category,
  onClose,
  onSubmit,
}: {
  title: string;
  category?: CashExpenseCategory | null;
  onClose: () => void;
  onSubmit: (form: FormData) => Promise<void>;
}) {
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(form: HTMLFormElement) {
    setSubmitting(true);
    setError('');
    try {
      await onSubmit(new FormData(form));
    } catch (err: any) {
      const message = err?.response?.data?.message;
      setError(Array.isArray(message) ? message.join(' | ') : message || 'Impossible d enregistrer la categorie.');
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="cash-modal-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(event.currentTarget);
        }}
      >
        <div className="modal-section">
          <h3>Referentiel</h3>
          <div className="lease-section-grid">
            <label>
              Code
              <input name="code" defaultValue={category?.code ?? ''} placeholder="AUTRE_DEPENSE" />
            </label>
            <label>
              Nom *
              <input name="name" required defaultValue={category?.name ?? ''} placeholder="Autre depense" />
            </label>
            <label>
              Statut
              <select name="status" defaultValue={category?.status ?? 'ACTIVE'}>
                <option value="ACTIVE">Actif</option>
                <option value="INACTIVE">Inactif</option>
              </select>
            </label>
            <label className="lease-field-full">
              Description
              <textarea name="description" rows={3} defaultValue={category?.description ?? ''} placeholder="Description" />
            </label>
          </div>
          {error ? <div className="error-message">{error}</div> : null}
        </div>
        <div className="modal-footer-sticky">
          <button type="button" className="secondary" onClick={onClose} disabled={submitting}>
            Annuler
          </button>
          <button type="submit" disabled={submitting}>
            {submitting ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
