import { useState } from 'react';
import { api, exportCsv, includesText, shortDate, statusLabel } from '../../../api';
import { EmptyState, Modal, PageHeader, SuccessMessage, TableToolbar } from '../../../components';
import { useAuth } from '../../../auth';
import { useApiList } from '../../../hooks';

type Workflow = {
  id: number;
  type: string;
  entity_type: string;
  entity_id?: number;
  title: string;
  requester_name?: string;
  status: string;
  created_at: string;
  step_name?: string;
};

type WorkflowDetail = Workflow & {
  steps: Array<{ id: number; name: string; approver_role?: string; status: string; comment?: string }>;
  actions: Array<{ id: number; action: string; comment?: string; actor_name?: string; acted_at: string }>;
};

export function WorkflowsPage() {
  const { can } = useAuth();
  const workflows = useApiList<Workflow>('/workflows');
  const approvals = useApiList<Workflow>('/workflows/my-approvals');
  const [query, setQuery] = useState('');
  const [success, setSuccess] = useState('');
  const [viewing, setViewing] = useState<WorkflowDetail | null>(null);
  const filtered = workflows.data.filter((workflow) => includesText(workflow, query));

  async function open(id: number) {
    const response = await api.get<WorkflowDetail>(`/workflows/${id}`);
    setViewing(response.data);
  }

  async function act(id: number, action: 'approve' | 'reject', comment: string) {
    await api.post(`/workflows/${id}/${action}`, { comment });
    setSuccess(action === 'approve' ? 'Workflow approuvé.' : 'Workflow rejeté.');
    workflows.reload();
    approvals.reload();
    if (viewing?.id === id) open(id);
  }

  return (
    <section>
      <PageHeader title="Workflows" />
      <SuccessMessage message={success} />
      <div className="mini-stats">
        <div className="mini-stat"><span>En attente</span><strong>{workflows.data.filter((w) => w.status === 'PENDING').length}</strong></div>
        <div className="mini-stat"><span>Mes validations</span><strong>{approvals.data.length}</strong></div>
        <div className="mini-stat"><span>Approuvés</span><strong>{workflows.data.filter((w) => w.status === 'APPROVED').length}</strong></div>
        <div className="mini-stat"><span>Rejetés</span><strong>{workflows.data.filter((w) => w.status === 'REJECTED').length}</strong></div>
      </div>
      <div className="detail-section">
        <h4>Mes validations</h4>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Titre</th><th>Type</th><th>Étape</th><th>Création</th><th>Actions</th></tr></thead>
            <tbody>{approvals.data.map((workflow) => <tr key={workflow.id}><td>{workflow.title}</td><td>{workflow.type}</td><td>{workflow.step_name ?? '-'}</td><td>{shortDate(workflow.created_at)}</td><td className="actions"><button className="secondary" onClick={() => open(workflow.id)}>Voir</button>{can('workflow.approve') && <button className="secondary" onClick={() => act(workflow.id, 'approve', 'Approuvé depuis l’interface')}>Approuver</button>}{can('workflow.reject') && <button className="secondary" onClick={() => act(workflow.id, 'reject', 'Rejeté depuis l’interface')}>Rejeter</button>}</td></tr>)}</tbody>
          </table>
          {!approvals.data.length && <EmptyState />}
        </div>
      </div>
      <TableToolbar query={query} onQueryChange={setQuery} onExport={() => exportCsv('workflows.csv', filtered)} />
      <div className="table-wrap">
        <table>
          <thead><tr><th>Titre</th><th>Type</th><th>Entité</th><th>Demandeur</th><th>Statut</th><th>Création</th><th>Actions</th></tr></thead>
          <tbody>{filtered.map((workflow) => <tr key={workflow.id}><td>{workflow.title}</td><td>{workflow.type}</td><td>{workflow.entity_type} #{workflow.entity_id ?? '-'}</td><td>{workflow.requester_name ?? '-'}</td><td>{statusLabel(workflow.status)}</td><td>{shortDate(workflow.created_at)}</td><td className="actions"><button className="secondary" onClick={() => open(workflow.id)}>Voir</button></td></tr>)}</tbody>
        </table>
        {!filtered.length && <EmptyState />}
      </div>
      {viewing && (
        <Modal title="Détail workflow" onClose={() => setViewing(null)}>
          <div className="detail-list">
            <span>Titre</span><strong>{viewing.title}</strong>
            <span>Type</span><strong>{viewing.type}</strong>
            <span>Entité</span><strong>{viewing.entity_type} #{viewing.entity_id ?? '-'}</strong>
            <span>Statut</span><strong>{statusLabel(viewing.status)}</strong>
          </div>
          <div className="detail-section"><h4>Étapes</h4><div className="compact-list">{viewing.steps.map((step) => <div className="compact-item" key={step.id}><span>{step.name} · {step.approver_role ?? '-'}</span><strong>{statusLabel(step.status)}</strong></div>)}</div></div>
          <div className="detail-section"><h4>Historique</h4><div className="compact-list">{viewing.actions.map((action) => <div className="compact-item" key={action.id}><span>{action.action} · {shortDate(action.acted_at)}</span><strong>{action.comment ?? action.actor_name ?? '-'}</strong></div>)}</div></div>
        </Modal>
      )}
    </section>
  );
}
