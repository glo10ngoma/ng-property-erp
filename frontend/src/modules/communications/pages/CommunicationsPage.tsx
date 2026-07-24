import { ReactNode, useEffect, useMemo, useState } from 'react';
import { api, exportCsv, exportExcel, includesText, shortDate } from '../../../api';
import { useAuth } from '../../../auth';
import { EmptyState, Modal, PageHeader, SuccessMessage, TableToolbar } from '../../../components';

type Template = { id: number; code: string; name: string; channel: string; subject?: string; body: string; variables?: string[]; status: string };
type CommunicationLog = { id: number; recipient: string; subject?: string; message: string; status: string; sent_at?: string; created_at: string; related_entity_type?: string };
type Notification = { id: number; title: string; message: string; priority: string; status: string; link_path?: string; created_at: string; user_name?: string };
type CommunicationHistoryRow = {
  id: number;
  organization_id: number;
  organization_name: string | null;
  channel: string;
  provider: string | null;
  recipient: string;
  subject: string | null;
  status: string;
  document_type: string | null;
  document_id: number | null;
  document_reference: string | null;
  invoice_reference: string | null;
  document_label: string | null;
  delivery_trigger: string | null;
  idempotency_key: string | null;
  external_message_id: string | null;
  error: string | null;
  created_by: number | null;
  created_by_name: string | null;
  actor_label: string | null;
  attempt_count: number;
  created_at: string;
};

export function CommunicationsPage() {
  const { can } = useAuth();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [emailLogs, setEmailLogs] = useState<CommunicationLog[]>([]);
  const [smsLogs, setSmsLogs] = useState<CommunicationLog[]>([]);
  const [whatsappLogs, setWhatsappLogs] = useState<CommunicationLog[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [query, setQuery] = useState('');
  const [success, setSuccess] = useState('');
  const [editing, setEditing] = useState<Template | null>(null);

  async function load() {
    const requests = [
      api.get<Template[]>('/communications/templates'),
      can('communication.logs.read') ? api.get<CommunicationLog[]>('/communications/email-logs') : Promise.resolve({ data: [] }),
      can('communication.logs.read') ? api.get<CommunicationLog[]>('/communications/sms-logs') : Promise.resolve({ data: [] }),
      can('communication.logs.read') ? api.get<CommunicationLog[]>('/communications/whatsapp-logs') : Promise.resolve({ data: [] }),
      api.get<Notification[]>('/notifications'),
    ] as const;
    const [templateResponse, emailResponse, smsResponse, whatsappResponse, notificationResponse] = await Promise.all(requests);
    setTemplates(templateResponse.data);
    setEmailLogs(emailResponse.data);
    setSmsLogs(smsResponse.data);
    setWhatsappLogs(whatsappResponse.data);
    setNotifications(notificationResponse.data);
  }

  useEffect(() => {
    load();
  }, []);

  const filteredTemplates = templates.filter((item) => includesText(item, query));
  const filteredNotifications = notifications.filter((item) => includesText(item, query));
  const filteredEmailLogs = emailLogs.filter((item) => includesText(item, query));
  const filteredSmsLogs = smsLogs.filter((item) => includesText(item, query));
  const filteredWhatsappLogs = whatsappLogs.filter((item) => includesText(item, query));
  const unreadCount = notifications.filter((item) => item.status === 'UNREAD').length;
  const simulatedCount = [...emailLogs, ...smsLogs, ...whatsappLogs].filter((item) => item.status === 'SIMULATED').length;

  async function createTemplate(form: FormData) {
    await api.post('/communications/templates', Object.fromEntries(form));
    setSuccess('Modele cree avec succes.');
    load();
  }

  async function updateTemplate(form: FormData) {
    if (!editing) return;
    await api.patch(`/communications/templates/${editing.id}`, Object.fromEntries(form));
    setEditing(null);
    setSuccess('Modele modifie avec succes.');
    load();
  }

  async function deactivateTemplate(id: number) {
    await api.delete(`/communications/templates/${id}`);
    setSuccess('Modele desactive.');
    load();
  }

  async function send(channel: 'email' | 'sms' | 'whatsapp', form: FormData) {
    await api.post(`/communications/send-${channel}`, Object.fromEntries(form));
    setSuccess(channel === 'email' ? 'Envoi email traite.' : 'Envoi simule enregistre.');
    load();
  }

  async function createNotification(form: FormData) {
    await api.post('/notifications', Object.fromEntries(form));
    setSuccess('Notification interne creee.');
    load();
  }

  async function markRead(id: number) {
    await api.post(`/notifications/${id}/read`);
    setSuccess('Notification marquee comme lue.');
    load();
  }

  return (
    <section>
      <PageHeader title="Communications" />
      <SuccessMessage message={success} />

      <div className="mini-stats">
        <div className="mini-stat"><span>Modeles actifs</span><strong>{templates.filter((item) => item.status === 'ACTIVE').length}</strong></div>
        <div className="mini-stat"><span>Notifications non lues</span><strong>{unreadCount}</strong></div>
        <div className="mini-stat"><span>Envois simules</span><strong>{simulatedCount}</strong></div>
        <div className="mini-stat"><span>Canaux</span><strong>3</strong></div>
      </div>

      <TableToolbar query={query} onQueryChange={setQuery} onExport={() => exportCsv('communications-modeles.csv', filteredTemplates)} />

      {(can('communication.template.create') || editing) && (
        <form className="quick-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); editing ? updateTemplate(form) : createTemplate(form); }}>
          <input name="code" placeholder="Code modele" defaultValue={editing?.code} required />
          <input name="name" placeholder="Nom" defaultValue={editing?.name} required />
          <select name="channel" defaultValue={editing?.channel ?? 'EMAIL'}>
            <option value="EMAIL">Email</option>
            <option value="SMS">SMS</option>
            <option value="WHATSAPP">WhatsApp</option>
            <option value="INTERNAL">Interne</option>
          </select>
          <input name="subject" placeholder="Sujet" defaultValue={editing?.subject ?? ''} />
          <textarea name="body" placeholder="Corps du message" defaultValue={editing?.body} required />
          <input name="variables" placeholder="Variables, separees par virgule" defaultValue={Array.isArray(editing?.variables) ? editing?.variables.join(',') : ''} />
          <select name="status" defaultValue={editing?.status ?? 'ACTIVE'}>
            <option value="ACTIVE">Actif</option>
            <option value="INACTIVE">Inactif</option>
          </select>
          <button>{editing ? 'Enregistrer' : 'Creer modele'}</button>
          {editing && <button className="secondary" type="button" onClick={() => setEditing(null)}>Annuler</button>}
        </form>
      )}

      <Section title="Modeles de messages">
        <DataTable
          headers={['Code', 'Nom', 'Canal', 'Sujet', 'Statut', 'Actions']}
          empty="Aucun modele."
          rows={filteredTemplates.map((template) => [
            template.code,
            template.name,
            channelLabel(template.channel),
            template.subject ?? '-',
            <Badge key="status" value={template.status} />,
            <span className="actions" key="actions">
              {can('communication.template.update') && <button className="secondary" onClick={() => setEditing(template)}>Modifier</button>}
              {can('communication.template.delete') && template.status !== 'INACTIVE' && <button className="secondary" onClick={() => deactivateTemplate(template.id)}>Desactiver</button>}
            </span>,
          ])}
        />
      </Section>

      {can('communication.send') && (
        <div className="chart-grid">
          <SendCard title="Email transactionnel" channel="email" templates={templates.filter((item) => item.channel === 'EMAIL' && item.status === 'ACTIVE')} onSend={send} />
          <SendCard title="SMS simule" channel="sms" templates={templates.filter((item) => item.channel === 'SMS' && item.status === 'ACTIVE')} onSend={send} />
          <SendCard title="WhatsApp simule" channel="whatsapp" templates={templates.filter((item) => item.channel === 'WHATSAPP' && item.status === 'ACTIVE')} onSend={send} />
          {can('notifications.update') && (
            <article className="chart-card">
              <h3>Notification interne</h3>
              <form className="form-grid" onSubmit={(event) => { event.preventDefault(); createNotification(new FormData(event.currentTarget)); event.currentTarget.reset(); }}>
                <input name="title" placeholder="Titre" required />
                <textarea name="message" placeholder="Message" required />
                <select name="priority" defaultValue="NORMAL">
                  <option value="LOW">Basse</option>
                  <option value="NORMAL">Normale</option>
                  <option value="HIGH">Haute</option>
                  <option value="CRITICAL">Critique</option>
                </select>
                <input name="link_path" placeholder="Lien interne, ex. /invoices" />
                <button>Creer notification</button>
              </form>
            </article>
          )}
        </div>
      )}

      <Section title="Notifications internes">
        <DataTable
          headers={['Titre', 'Priorite', 'Statut', 'Date', 'Message', 'Actions']}
          empty="Aucune notification."
          rows={filteredNotifications.map((notification) => [
            notification.title,
            <Badge key="priority" value={notification.priority} />,
            <Badge key="status" value={notification.status} />,
            shortDate(notification.created_at),
            notification.message,
            <span className="actions" key="actions">
              {notification.link_path && <a className="secondary" href={notification.link_path}>Ouvrir</a>}
              {can('notifications.update') && notification.status === 'UNREAD' && <button className="secondary" onClick={() => markRead(notification.id)}>Marquer lue</button>}
            </span>,
          ])}
        />
      </Section>

      {can('communication.logs.read') && (
        <>
          <CommunicationHistorySection />
          <LogsSection title="Logs email" filename="communications-email.csv" logs={filteredEmailLogs} />
          <LogsSection title="Logs SMS" filename="communications-sms.csv" logs={filteredSmsLogs} />
          <LogsSection title="Logs WhatsApp" filename="communications-whatsapp.csv" logs={filteredWhatsappLogs} />
        </>
      )}
    </section>
  );
}

function SendCard({ title, channel, templates, onSend }: { title: string; channel: 'email' | 'sms' | 'whatsapp'; templates: Template[]; onSend: (channel: 'email' | 'sms' | 'whatsapp', form: FormData) => void }) {
  return (
    <article className="chart-card">
      <h3>{title}</h3>
      <form className="form-grid" onSubmit={(event) => { event.preventDefault(); onSend(channel, new FormData(event.currentTarget)); event.currentTarget.reset(); }}>
        <input name="recipient" placeholder={channel === 'email' ? 'Destinataire email' : 'Numero destinataire'} required />
        {channel === 'email' && <input name="subject" placeholder="Sujet" />}
        <select name="template_code" defaultValue="">
          <option value="">Sans modele</option>
          {templates.map((template) => <option key={template.id} value={template.code}>{template.name}</option>)}
        </select>
        <textarea name="message" placeholder="Message libre si aucun modele" />
        <textarea name="variables" placeholder='Variables JSON, ex. {"tenant_full_name":"Client","amount":"100 USD"}' />
        <button>Tester envoi</button>
      </form>
    </article>
  );
}

function LogsSection({ title, filename, logs }: { title: string; filename: string; logs: CommunicationLog[] }) {
  return (
    <Section title={title} action={<button className="secondary" onClick={() => exportExcel(filename.replace('.csv', '.xls'), logs)}>Exporter Excel</button>}>
      <div className="table-toolbar">
        <span className="eyebrow">{logs.length} entree(s)</span>
        <button className="secondary" onClick={() => exportCsv(filename, logs)}>Exporter</button>
      </div>
      <DataTable
        headers={['Destinataire', 'Sujet', 'Statut', 'Date', 'Message']}
        empty="Aucun log."
        rows={logs.map((log) => [log.recipient, log.subject ?? '-', <Badge key="status" value={log.status} />, shortDate(log.sent_at ?? log.created_at), log.message])}
      />
    </Section>
  );
}

function CommunicationHistorySection() {
  const [rows, setRows] = useState<CommunicationHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<CommunicationHistoryRow | null>(null);
  const [filters, setFilters] = useState({
    from: '',
    to: '',
    status: '',
    trigger: '',
    documentType: '',
    recipient: '',
    search: '',
  });

  async function loadHistory(nextFilters = filters) {
    setLoading(true);
    setError('');
    try {
      const params = {
        limit: 100,
        from: nextFilters.from || undefined,
        to: nextFilters.to || undefined,
        status: nextFilters.status || undefined,
        trigger: nextFilters.trigger || undefined,
        documentType: nextFilters.documentType || undefined,
        recipient: nextFilters.recipient || undefined,
        search: nextFilters.search || undefined,
      };
      const response = await api.get<CommunicationHistoryRow[]>('/communications/email/logs', { params });
      setRows(response.data ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Impossible de charger l'historique des communications.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openDetail(id: number) {
    setError('');
    try {
      const response = await api.get<CommunicationHistoryRow>(`/communications/email/logs/${id}`);
      setSelected(response.data);
    } catch (detailError) {
      setError(detailError instanceof Error ? detailError.message : 'Impossible de charger le détail.');
    }
  }

  function updateFilter<K extends keyof typeof filters>(key: K, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  const exportRows = useMemo(() => rows.map((row) => ({
    Date: formatDateTime(row.created_at),
    Organisation: row.organization_name ?? `Organisation ${row.organization_id}`,
    Destinataire: row.recipient,
    Canal: channelLabel(row.channel),
    'Type de document': documentTypeLabel(row.document_type),
    Référence: row.document_reference ?? row.invoice_reference ?? '—',
    Déclencheur: triggerLabel(row.delivery_trigger),
    Statut: statusLabel(row.status),
    Erreur: row.error ?? '',
    Utilisateur: row.actor_label ?? row.created_by_name ?? '—',
  })), [rows]);

  return (
    <Section
      title="Historique des communications"
      action={
        <span className="actions">
          <button className="secondary" onClick={() => void loadHistory()} disabled={loading}>{loading ? 'Chargement...' : 'Actualiser'}</button>
          <button className="secondary" onClick={() => exportExcel('communications-historique.xls', exportRows)}>Exporter Excel</button>
        </span>
      }
    >
      {error ? <div className="error-message">{error}</div> : null}
      <div className="table-toolbar communication-history-toolbar">
        <div className="toolbar-main communication-history-filters">
          <input type="date" value={filters.from} onChange={(event) => updateFilter('from', event.target.value)} placeholder="Début" />
          <input type="date" value={filters.to} onChange={(event) => updateFilter('to', event.target.value)} placeholder="Fin" />
          <select value={filters.status} onChange={(event) => updateFilter('status', event.target.value)}>
            <option value="">Tous les statuts</option>
            <option value="SENT">Envoyé</option>
            <option value="FAILED">Échec</option>
            <option value="PENDING">En attente</option>
            <option value="SKIPPED">Ignoré</option>
          </select>
          <select value={filters.trigger} onChange={(event) => updateFilter('trigger', event.target.value)}>
            <option value="">Tous les déclencheurs</option>
            <option value="MANUAL">Manuel</option>
            <option value="AUTO">Automatique</option>
            <option value="SYSTEM">Système</option>
          </select>
          <select value={filters.documentType} onChange={(event) => updateFilter('documentType', event.target.value)}>
            <option value="">Tous les documents</option>
            <option value="INVOICE">Facture</option>
            <option value="PAYMENT_RECEIPT">Reçu de paiement</option>
            <option value="TENANT_CREDIT_RECEIPT">Reçu de crédit locataire</option>
          </select>
          <input value={filters.recipient} onChange={(event) => updateFilter('recipient', event.target.value)} placeholder="Destinataire" />
          <input value={filters.search} onChange={(event) => updateFilter('search', event.target.value)} placeholder="Recherche" />
        </div>
      <div className="toolbar-actions">
          <button className="secondary" onClick={() => {
            const nextFilters = { from: '', to: '', status: '', trigger: '', documentType: '', recipient: '', search: '' };
            setFilters(nextFilters);
            void loadHistory(nextFilters);
          }}>Réinitialiser</button>
          <button className="secondary" onClick={() => void loadHistory()}>Filtrer</button>
          <button className="secondary" onClick={() => exportCsv('communications-historique.csv', exportRows)}>CSV</button>
        </div>
      </div>

      <DataTable
        headers={['Date / heure', 'Organisation', 'Destinataire', 'Canal', 'Document', 'Référence', 'Déclencheur', 'Statut', 'Utilisateur / Processus', 'Actions']}
        empty="Aucune communication."
        rows={rows.map((row) => [
          formatDateTime(row.created_at),
          row.organization_name ?? `Organisation ${row.organization_id}`,
          row.recipient,
          channelLabel(row.channel),
          documentTypeLabel(row.document_type),
          row.document_reference ?? row.invoice_reference ?? '—',
          triggerLabel(row.delivery_trigger),
          <Badge key={`status-${row.id}`} value={row.status} />,
          row.actor_label ?? row.created_by_name ?? '—',
          <button key={`detail-${row.id}`} className="secondary" type="button" onClick={() => void openDetail(row.id)}>Détail</button>,
        ])}
      />

      {selected ? (
        <Modal title={`Détail - ${selected.document_reference ?? selected.invoice_reference ?? `Log ${selected.id}`}`} onClose={() => setSelected(null)}>
          <div className="detail-grid communication-history-detail">
            <div><span>Destinataire</span><strong>{selected.recipient}</strong></div>
            <div><span>Sujet</span><strong>{selected.subject ?? '—'}</strong></div>
            <div><span>Document concerné</span><strong>{selected.document_label ?? documentTypeLabel(selected.document_type)}</strong></div>
            <div><span>Référence du document</span><strong>{selected.document_reference ?? '—'}</strong></div>
            <div><span>Facture concernée</span><strong>{selected.invoice_reference ?? '—'}</strong></div>
            <div><span>Date d'envoi</span><strong>{formatDateTime(selected.created_at)}</strong></div>
            <div><span>Fournisseur email</span><strong>{selected.provider ?? '—'}</strong></div>
            <div><span>Identifiant fournisseur</span><strong>{selected.external_message_id ?? '—'}</strong></div>
            <div><span>Statut</span><strong>{statusLabel(selected.status)}</strong></div>
            <div><span>Déclencheur</span><strong>{triggerLabel(selected.delivery_trigger)}</strong></div>
            <div><span>Nombre de tentatives</span><strong>{selected.attempt_count}</strong></div>
            <div><span>Organisation</span><strong>{selected.organization_name ?? `Organisation ${selected.organization_id}`}</strong></div>
            <div><span>Utilisateur / Processus</span><strong>{selected.actor_label ?? selected.created_by_name ?? '—'}</strong></div>
            <div className="detail-full"><span>Erreur</span><strong>{selected.error ?? '—'}</strong></div>
          </div>
        </Modal>
      ) : null}
    </Section>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="detail-section">
      <div className="page-header">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function DataTable({ headers, rows, empty }: { headers: string[]; rows: ReactNode[][]; empty: string }) {
  if (!rows.length) return <EmptyState message={empty} />;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
        <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function Badge({ value }: { value: string }) {
  return <span className={`badge ${badgeClass(value)}`}>{statusLabel(value)}</span>;
}

function statusLabel(value: string) {
  const labels: Record<string, string> = {
    ACTIVE: 'Actif',
    INACTIVE: 'Inactif',
    UNREAD: 'Non lue',
    READ: 'Lue',
    ARCHIVED: 'Archivee',
    LOW: 'Basse',
    NORMAL: 'Normale',
    HIGH: 'Haute',
    CRITICAL: 'Critique',
    SIMULATED: 'Simule',
    SENT: 'Envoye',
    FAILED: 'Echec',
    PENDING: 'En attente',
    SKIPPED: 'Ignoré',
  };
  return labels[value] ?? value;
}

function channelLabel(value: string) {
  return ({ EMAIL: 'Email', SMS: 'SMS', WHATSAPP: 'WhatsApp', INTERNAL: 'Interne' } as Record<string, string>)[value] ?? value;
}

function documentTypeLabel(value?: string | null) {
  return ({
    INVOICE: 'Facture',
    PAYMENT_RECEIPT: 'Reçu de paiement',
    TENANT_CREDIT_RECEIPT: 'Reçu de crédit locataire',
  } as Record<string, string>)[String(value ?? '')] ?? String(value ?? '—');
}

function triggerLabel(value?: string | null) {
  return ({
    MANUAL: 'Manuel',
    AUTO: 'Automatique',
    SYSTEM: 'Système',
  } as Record<string, string>)[String(value ?? '')] ?? String(value ?? '—');
}

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  return new Date(String(value)).toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa' });
}

function badgeClass(value: string) {
  if (['ACTIVE', 'READ', 'SIMULATED', 'SENT'].includes(value)) return 'paid';
  if (['NORMAL', 'PENDING', 'UNREAD'].includes(value)) return 'partial';
  if (['HIGH', 'CRITICAL', 'FAILED'].includes(value)) return 'overdue';
  return '';
}
