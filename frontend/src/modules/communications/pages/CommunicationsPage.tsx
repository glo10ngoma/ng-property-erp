import { ReactNode, useEffect, useState } from 'react';
import { api, exportCsv, exportExcel, includesText, shortDate } from '../../../api';
import { useAuth } from '../../../auth';
import { EmptyState, PageHeader, SuccessMessage, TableToolbar } from '../../../components';

type Template = { id: number; code: string; name: string; channel: string; subject?: string; body: string; variables?: string[]; status: string };
type CommunicationLog = { id: number; recipient: string; subject?: string; message: string; status: string; sent_at?: string; created_at: string; related_entity_type?: string };
type Notification = { id: number; title: string; message: string; priority: string; status: string; link_path?: string; created_at: string; user_name?: string };

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
  const simulatedCount = emailLogs.length + smsLogs.length + whatsappLogs.length;

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
    setSuccess('Envoi simule enregistre.');
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
          <SendCard title="Email simule" channel="email" templates={templates.filter((item) => item.channel === 'EMAIL' && item.status === 'ACTIVE')} onSend={send} />
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
  };
  return labels[value] ?? value;
}

function channelLabel(value: string) {
  return ({ EMAIL: 'Email', SMS: 'SMS', WHATSAPP: 'WhatsApp', INTERNAL: 'Interne' } as Record<string, string>)[value] ?? value;
}

function badgeClass(value: string) {
  if (['ACTIVE', 'READ', 'SIMULATED', 'SENT'].includes(value)) return 'paid';
  if (['NORMAL', 'PENDING', 'UNREAD'].includes(value)) return 'partial';
  if (['HIGH', 'CRITICAL', 'FAILED'].includes(value)) return 'overdue';
  return '';
}
