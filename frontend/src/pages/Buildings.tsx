import { Eye, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api, exportCsv, includesText } from '../api';
import { useAuth } from '../auth';
import { EmptyState, Modal, PageHeader, SuccessMessage, TableToolbar } from '../components';
import { useApiList } from '../hooks';

type Building = { id: number; name: string; address: string; city: string; unit_count: number; description?: string };

export function Buildings() {
  const { can } = useAuth();
  const { data, reload } = useApiList<Building>('/buildings');
  const [editing, setEditing] = useState<Partial<Building> | null>(null);
  const [viewing, setViewing] = useState<Building | null>(null);
  const [query, setQuery] = useState('');
  const [success, setSuccess] = useState('');
  const filtered = data.filter((building) => includesText(building, query));

  async function save(form: FormData) {
    const payload = Object.fromEntries(form) as Record<string, string>;
    if (editing?.id) await api.put(`/buildings/${editing.id}`, payload);
    else await api.post('/buildings', payload);
    setSuccess(editing?.id ? 'Immeuble modifié avec succès.' : 'Immeuble créé avec succès.');
    setEditing(null);
    reload();
  }

  async function remove(id: number) {
    await api.delete(`/buildings/${id}`);
    setSuccess('Immeuble supprimé avec succès.');
    reload();
  }

  return (
    <section>
      <PageHeader title="Immeubles" action={can('buildings.create') ? <button onClick={() => setEditing({})}><Plus size={16} />Nouvel immeuble</button> : undefined} />
      <SuccessMessage message={success} />
      <TableToolbar
        query={query}
        onQueryChange={setQuery}
        onExport={() => exportCsv('immeubles.csv', filtered.map(({ id, name, address, city, unit_count }) => ({
          id,
          nom: name,
          adresse: address,
          ville: city,
          appartements: unit_count,
        })))}
      />
      <div className="table-wrap">
        <table>
          <thead><tr><th>Nom</th><th>Adresse</th><th>Ville</th><th>Appartements</th><th>Actions</th></tr></thead>
          <tbody>
            {filtered.map((building) => (
              <tr key={building.id}>
                <td>{building.name}</td><td>{building.address}</td><td>{building.city}</td><td>{building.unit_count}</td>
                <td className="actions">
                  <button className="icon-btn" title="Voir" onClick={() => setViewing(building)}><Eye size={16} /></button>
                  {can('buildings.update') && <button className="icon-btn" title="Modifier" onClick={() => setEditing(building)}><Pencil size={16} /></button>}
                  {can('buildings.delete') && <button className="icon-btn danger" title="Supprimer" onClick={() => remove(building.id)}><Trash2 size={16} /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.length && <EmptyState />}
      </div>
      {editing && (
        <Modal title={editing.id ? 'Modifier l’immeuble' : 'Nouvel immeuble'} onClose={() => setEditing(null)}>
          <form
            className="form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              save(new FormData(event.currentTarget));
            }}
          >
            <input name="name" placeholder="Nom" defaultValue={editing.name} required />
            <input name="address" placeholder="Adresse" defaultValue={editing.address} required />
            <input name="city" placeholder="Ville" defaultValue={editing.city} required />
            <textarea name="description" placeholder="Description" defaultValue={editing.description} />
            <button>Enregistrer</button>
          </form>
        </Modal>
      )}
      {viewing && (
        <Modal title="Détail immeuble" onClose={() => setViewing(null)}>
          <div className="detail-list">
            <span>Nom</span><strong>{viewing.name}</strong>
            <span>Adresse</span><strong>{viewing.address}</strong>
            <span>Ville</span><strong>{viewing.city}</strong>
            <span>Appartements</span><strong>{viewing.unit_count}</strong>
            <span>Description</span><strong>{viewing.description || '-'}</strong>
          </div>
        </Modal>
      )}
    </section>
  );
}
