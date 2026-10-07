import { Download, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, exportCsv, money, shortDate } from '../api';
import { PageHeader } from '../components';

type OverdueTenantRow = {
  tenant_id: number;
  tenant_name: string;
  active_lease_refs: string[];
  overdue_invoice_count: number;
  overdue_invoice_refs: string[];
  oldest_due_date: string;
  maximum_days_overdue: number;
  overdue_total: number;
};

type OverdueReport = {
  generated_at: string;
  summary: {
    overdue_tenant_count: number;
    overdue_invoice_count: number;
    overdue_total: number;
  };
  rows: OverdueTenantRow[];
};

export function OverdueTenantsReportPage() {
  const [report, setReport] = useState<OverdueReport | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const response = await api.get<OverdueReport>('/reports/tenant-accounts/overdue');
      setReport(response.data);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.message ?? 'Impossible de charger les locataires en retard.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const rows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('fr');
    return (report?.rows ?? []).filter((row) => !normalized
      || row.tenant_name.toLocaleLowerCase('fr').includes(normalized)
      || row.active_lease_refs.some((reference) => reference.toLocaleLowerCase('fr').includes(normalized))
      || row.overdue_invoice_refs.some((reference) => reference.toLocaleLowerCase('fr').includes(normalized)));
  }, [query, report]);

  function exportReport() {
    exportCsv('locataires-en-retard.csv', rows.map((row) => ({
      locataire: row.tenant_name,
      baux_actifs: row.active_lease_refs.join(', '),
      factures_en_retard: row.overdue_invoice_refs.join(', '),
      nombre_factures: row.overdue_invoice_count,
      plus_ancienne_echeance: row.oldest_due_date,
      jours_de_retard_maximum: row.maximum_days_overdue,
      solde_en_retard_usd: row.overdue_total,
    })));
  }

  return (
    <section>
      <PageHeader
        title="Locataires en retard de paiement"
        action={(
          <div className="page-header-actions">
            <button type="button" className="secondary" onClick={() => void load()} disabled={loading}>
              <RefreshCw size={16} /> Actualiser
            </button>
            <button type="button" onClick={exportReport} disabled={!rows.length}>
              <Download size={16} /> Exporter CSV
            </button>
          </div>
        )}
      />
      <p className="page-subtitle">
        Factures non soldées dont la date d’échéance est dépassée. Cliquez sur un locataire pour ouvrir son relevé complet.
      </p>

      {error && <div className="error-message">{error}</div>}
      {report && (
        <>
          <div className="mini-stats">
            <Kpi label="Locataires en retard" value={report.summary.overdue_tenant_count} />
            <Kpi label="Factures en retard" value={report.summary.overdue_invoice_count} />
            <Kpi label="Solde total en retard" value={`${money(report.summary.overdue_total)} USD`} />
          </div>

          <div className="table-toolbar">
            <div className="toolbar-main">
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher un locataire, un bail ou une facture" />
            </div>
            <div className="toolbar-actions">
              <button type="button" className="secondary" onClick={() => setQuery('')}>Réinitialiser</button>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Locataire</th>
                  <th>Baux actifs</th>
                  <th>Factures en retard</th>
                  <th>Plus ancienne échéance</th>
                  <th className="right">Retard maximum</th>
                  <th className="right">Solde dû</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.tenant_id}>
                    <td><Link to={`/statements/tenant/${row.tenant_id}`}><strong>{row.tenant_name}</strong></Link></td>
                    <td>{row.active_lease_refs.length ? row.active_lease_refs.join(', ') : '—'}</td>
                    <td>{row.overdue_invoice_refs.join(', ')} <small>({row.overdue_invoice_count})</small></td>
                    <td>{shortDate(row.oldest_due_date)}</td>
                    <td className="right"><span className="badge overdue">{row.maximum_days_overdue} jour{row.maximum_days_overdue > 1 ? 's' : ''}</span></td>
                    <td className="right"><strong>{money(row.overdue_total)} USD</strong></td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr><td colSpan={6}>{loading ? 'Chargement…' : 'Aucun locataire en retard de paiement.'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="page-subtitle">Dernière analyse : {new Date(report.generated_at).toLocaleString('fr-CD')}</p>
        </>
      )}
      {loading && !report && <p>Chargement des retards de paiement…</p>}
    </section>
  );
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return <div className="mini-stat"><span>{label}</span><strong>{value}</strong></div>;
}
