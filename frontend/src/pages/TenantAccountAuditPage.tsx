import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, RefreshCw } from 'lucide-react';
import { api, exportCsv, money } from '../api';
import { PageHeader } from '../components';

type AuditRow = {
  tenant_id: number;
  tenant_name: string;
  active_lease_count: number;
  active_lease_refs: string[];
  monthly_count: number;
  quarterly_count: number;
  other_frequency_count: number;
  monthly_contract_total: number;
  valid_invoice_count: number;
  invoiced_total: number;
  paid_total: number;
  outstanding_total: number;
  available_credit_usd: number;
  available_credit_cdf: number;
  guarantee_expected: number;
  guarantee_paid: number;
  guarantee_remaining: number;
  guarantee_status: 'AUCUNE' | 'REGLEE' | 'PARTIELLE' | 'NON_REGLEE';
  financial_status: 'A_JOUR' | 'SOLDE_DU';
  audit_status: 'OK' | 'A_VERIFIER';
  anomalies: string[];
};

type AuditReport = {
  generated_at: string;
  summary: {
    total_tenants: number;
    active_tenants: number;
    ok_accounts: number;
    accounts_to_review: number;
    outstanding_total: number;
    available_credit_usd: number;
    available_credit_cdf: number;
    guarantee_expected: number;
    guarantee_paid: number;
    guarantee_remaining: number;
  };
  rows: AuditRow[];
};

const anomalyLabels: Record<string, string> = {
  INVOICE_STATUS_MISMATCH: 'Statut facture incohérent',
  DUPLICATE_INVOICE_PERIOD: 'Factures en double sur une période',
  MISSING_CURRENT_INVOICE: 'Facture de la période courante absente',
  INVOICE_OUTSIDE_LEASE: 'Facture hors période du bail',
  INACTIVE_LEASE_OUTSTANDING: 'Solde ouvert sur un bail inactif',
  GUARANTEE_OVERPAID: 'Garantie surpayée',
  GUARANTEE_STATUS_MISMATCH: 'Statut de garantie incohérent',
};

export function TenantAccountAuditPage() {
  const [report, setReport] = useState<AuditReport | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const response = await api.get<AuditReport>('/reports/tenant-accounts');
      setReport(response.data);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.message ?? 'Impossible de charger le contrôle des comptes locataires.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('fr');
    return (report?.rows ?? []).filter((row) => {
      const matchesQuery = !normalized
        || row.tenant_name.toLocaleLowerCase('fr').includes(normalized)
        || row.active_lease_refs.some((reference) => reference.toLocaleLowerCase('fr').includes(normalized));
      const matchesFilter = filter === 'ALL'
        || row.audit_status === filter
        || row.financial_status === filter
        || row.guarantee_status === filter;
      return matchesQuery && matchesFilter;
    });
  }, [filter, query, report]);

  function exportReport() {
    exportCsv('controle-comptes-locataires.csv', filteredRows.map((row) => ({
      locataire: row.tenant_name,
      baux_actifs: row.active_lease_refs.join(', '),
      periodicite: frequencyLabel(row),
      total_mensuel_usd: row.monthly_contract_total,
      total_facture_usd: row.invoiced_total,
      total_paye_usd: row.paid_total,
      solde_du_usd: row.outstanding_total,
      credit_disponible_usd: row.available_credit_usd,
      credit_disponible_cdf: row.available_credit_cdf,
      garantie_attendue_usd: row.guarantee_expected,
      garantie_payee_usd: row.guarantee_paid,
      garantie_restante_usd: row.guarantee_remaining,
      situation_financiere: row.financial_status,
      controle: row.audit_status,
      anomalies: row.anomalies.map((code) => anomalyLabels[code] ?? code).join(' | '),
    })));
  }

  return (
    <section>
      <PageHeader
        title="Contrôle des comptes locataires"
        action={(
          <div className="page-header-actions">
            <button type="button" className="secondary" onClick={() => void load()} disabled={loading}>
              <RefreshCw size={16} /> Actualiser
            </button>
            <button type="button" onClick={exportReport} disabled={!filteredRows.length}>
              <Download size={16} /> Exporter CSV
            </button>
          </div>
        )}
      />
      <p className="page-subtitle">
        Vue en lecture seule : facturation, paiements, crédits, garanties et anomalies par locataire.
      </p>

      {error && <div className="error-message">{error}</div>}
      {report && (
        <>
          <div className="mini-stats">
            <Kpi label="Locataires" value={report.summary.total_tenants} />
            <Kpi label="Comptes conformes" value={report.summary.ok_accounts} />
            <Kpi label="À vérifier" value={report.summary.accounts_to_review} />
            <Kpi label="Solde total dû" value={`${money(report.summary.outstanding_total)} USD`} />
            <Kpi label="Crédits disponibles" value={`${money(report.summary.available_credit_usd)} USD`} detail={`${money(report.summary.available_credit_cdf)} CDF`} />
            <Kpi label="Garanties restantes" value={`${money(report.summary.guarantee_remaining)} USD`} detail={`${money(report.summary.guarantee_paid)} / ${money(report.summary.guarantee_expected)} payés`} />
          </div>

          <div className="table-toolbar">
            <div className="toolbar-main">
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher un locataire ou un bail" />
              <select value={filter} onChange={(event) => setFilter(event.target.value)}>
                <option value="ALL">Toutes les situations</option>
                <option value="A_VERIFIER">Anomalies à vérifier</option>
                <option value="OK">Contrôles conformes</option>
                <option value="SOLDE_DU">Avec solde dû</option>
                <option value="A_JOUR">À jour</option>
                <option value="NON_REGLEE">Garantie non réglée</option>
                <option value="PARTIELLE">Garantie partielle</option>
              </select>
            </div>
            <div className="toolbar-actions">
              <button type="button" className="secondary" onClick={() => { setQuery(''); setFilter('ALL'); }}>Réinitialiser</button>
            </div>
          </div>

          <div className="table-wrap tenant-account-audit-table">
            <table>
              <thead>
                <tr>
                  <th>Locataire</th>
                  <th>Baux actifs</th>
                  <th>Périodicité</th>
                  <th className="right">Mensuel</th>
                  <th className="right">Facturé</th>
                  <th className="right">Payé</th>
                  <th className="right">Solde dû</th>
                  <th className="right">Crédit</th>
                  <th>Garantie</th>
                  <th>Situation</th>
                  <th>Contrôle</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr key={row.tenant_id}>
                    <td><Link to={`/statements/tenant/${row.tenant_id}`}><strong>{row.tenant_name}</strong></Link></td>
                    <td>{row.active_lease_refs.length ? row.active_lease_refs.join(', ') : '—'}</td>
                    <td>{frequencyLabel(row)}</td>
                    <td className="right">{money(row.monthly_contract_total)} USD</td>
                    <td className="right">{money(row.invoiced_total)} USD</td>
                    <td className="right">{money(row.paid_total)} USD</td>
                    <td className="right"><strong>{money(row.outstanding_total)} USD</strong></td>
                    <td className="right">
                      <span>{money(row.available_credit_usd)} USD</span>
                      {row.available_credit_cdf > 0 && <small>{money(row.available_credit_cdf)} CDF</small>}
                    </td>
                    <td>
                      <span className={`badge ${guaranteeBadge(row.guarantee_status)}`}>{guaranteeLabel(row)}</span>
                    </td>
                    <td><span className={`badge ${row.financial_status === 'A_JOUR' ? 'paid' : 'unpaid'}`}>{row.financial_status === 'A_JOUR' ? 'À jour' : 'Solde dû'}</span></td>
                    <td>
                      <span className={`badge ${row.audit_status === 'OK' ? 'paid' : 'overdue'}`}>{row.audit_status === 'OK' ? 'Conforme' : 'À vérifier'}</span>
                      {row.anomalies.length > 0 && (
                        <details>
                          <summary>{row.anomalies.length} anomalie{row.anomalies.length > 1 ? 's' : ''}</summary>
                          <ul>{row.anomalies.map((code) => <li key={code}>{anomalyLabels[code] ?? code}</li>)}</ul>
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
                {!filteredRows.length && (
                  <tr><td colSpan={11}>{loading ? 'Chargement…' : 'Aucun compte ne correspond aux filtres.'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="page-subtitle">Dernière analyse : {new Date(report.generated_at).toLocaleString('fr-CD')}</p>
        </>
      )}
      {loading && !report && <p>Chargement du contrôle global…</p>}
    </section>
  );
}

function Kpi({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return <div className="mini-stat"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>;
}

function frequencyLabel(row: AuditRow) {
  const labels = [
    row.monthly_count > 0 ? `${row.monthly_count} mensuel${row.monthly_count > 1 ? 's' : ''}` : '',
    row.quarterly_count > 0 ? `${row.quarterly_count} trimestriel${row.quarterly_count > 1 ? 's' : ''}` : '',
    row.other_frequency_count > 0 ? `${row.other_frequency_count} autre${row.other_frequency_count > 1 ? 's' : ''}` : '',
  ].filter(Boolean);
  return labels.join(' · ') || '—';
}

function guaranteeLabel(row: AuditRow) {
  if (row.guarantee_status === 'AUCUNE') return 'Aucune';
  if (row.guarantee_status === 'REGLEE') return `Réglée · ${money(row.guarantee_paid)} USD`;
  return `${money(row.guarantee_paid)} / ${money(row.guarantee_expected)} USD`;
}

function guaranteeBadge(status: AuditRow['guarantee_status']) {
  if (status === 'REGLEE') return 'paid';
  if (status === 'PARTIELLE') return 'partial';
  if (status === 'NON_REGLEE') return 'unpaid';
  return 'not_invoiced';
}
