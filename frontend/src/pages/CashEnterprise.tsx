import { ArrowLeft, Eye, FileSpreadsheet, Pencil, Printer } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, exportXlsxWorkbook, includesText, shortDate } from '../api';
import { useAuth } from '../auth';
import { EmptyState, Modal, PageHeader, SuccessMessage } from '../components';
import { useApiList } from '../hooks';

type CashMovement = {
  id: number;
  piece_number?: string;
  type: string;
  label?: string;
  category: string;
  amount: number;
  currency?: string;
  exchange_rate_used?: number;
  exchange_rate_date?: string;
  equivalent_usd?: number;
  movement_date: string;
  invoice_number?: string;
  tenant_name?: string;
  supplier?: string;
  reference?: string;
  attachment_file_name?: string;
  attachment_file_url?: string;
};

type CashMovementDetail = CashMovement & {
  description?: string;
  payment_method?: string;
  user_name?: string;
  employee_name?: string;
  building_name?: string;
  unit_number?: string;
  tenant_phone?: string;
  tenant_email?: string;
  opening_balance?: number;
  closing_balance?: number;
  expected_balance?: number;
  difference_amount?: number;
  opened_at?: string;
  closed_at?: string;
  timeline?: Array<Record<string, unknown>>;
  documents?: Array<{ name: string; exists: boolean; detail: string }>;
  history?: Array<Record<string, unknown>>;
};

type CashSession = {
  id: number;
  status: string;
  opening_balance: number;
  closing_balance?: number;
  opened_at: string;
  closed_at?: string;
  expected_balance?: number;
  difference_amount?: number;
};

function formatCashAmount(value: number | string | null | undefined, currency: string) {
  const amount = Number(value ?? 0);
  const formatted = new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
  return `${formatted} ${String(currency ?? 'USD').toUpperCase() === 'CDF' ? 'CDF' : '$US'}`;
}

export function CashPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const movements = useApiList<CashMovement>('/cash/movements');
  const sessions = useApiList<CashSession>('/cash/sessions');
  const [query, setQuery] = useState('');
  const [success, setSuccess] = useState('');
  const [filters, setFilters] = useState({ type: '', category: '', period: '', currency: '' });

  const filtered = useMemo(
    () =>
      movements.data.filter(
        (item) =>
          includesText(item, query) &&
          (!filters.type || item.type === filters.type) &&
          (!filters.category || item.category === filters.category) &&
          (!filters.period || String(item.movement_date).slice(0, 7) === filters.period) &&
          (!filters.currency || String(item.currency ?? 'USD') === filters.currency),
      ),
    [movements.data, query, filters],
  );

  const stats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const month = today.slice(0, 7);
    const inByCurrency = (currency: string, dateCheck?: (movement: CashMovement) => boolean) =>
      movements.data
        .filter((m) => m.type === 'IN' && String(m.currency ?? 'USD') === currency && (!dateCheck || dateCheck(m)))
        .reduce((sum, m) => sum + Number(m.amount), 0);
    const outByCurrency = (currency: string, dateCheck?: (movement: CashMovement) => boolean) =>
      movements.data
        .filter((m) => m.type === 'OUT' && String(m.currency ?? 'USD') === currency && (!dateCheck || dateCheck(m)))
        .reduce((sum, m) => sum + Number(m.amount), 0);
    return {
      usd: {
        balance: inByCurrency('USD') - outByCurrency('USD'),
        todayIn: inByCurrency('USD', (movement) => String(movement.movement_date).slice(0, 10) === today),
        todayOut: outByCurrency('USD', (movement) => String(movement.movement_date).slice(0, 10) === today),
        monthIn: inByCurrency('USD', (movement) => String(movement.movement_date).slice(0, 7) === month),
        monthOut: outByCurrency('USD', (movement) => String(movement.movement_date).slice(0, 7) === month),
      },
      cdf: {
        balance: inByCurrency('CDF') - outByCurrency('CDF'),
        todayIn: inByCurrency('CDF', (movement) => String(movement.movement_date).slice(0, 10) === today),
        todayOut: outByCurrency('CDF', (movement) => String(movement.movement_date).slice(0, 10) === today),
        monthIn: inByCurrency('CDF', (movement) => String(movement.movement_date).slice(0, 7) === month),
        monthOut: outByCurrency('CDF', (movement) => String(movement.movement_date).slice(0, 7) === month),
      },
      count: movements.data.length,
    };
  }, [movements.data]);

  const nextPieceNumber = useMemo(() => {
    const expenses = movements.data
      .map((movement) => movement.piece_number ?? '')
      .filter((value) => value.startsWith('D-'))
      .map((value) => Number(value.replace(/^D-/, '')))
      .filter((value) => Number.isFinite(value));
    const next = expenses.length ? Math.max(...expenses) + 1 : 1;
    return `D-${String(next).padStart(4, '0')}`;
  }, [movements.data]);

  async function expense(form: FormData) {
    await api.post('/cash/expenses', Object.fromEntries(form));
    setSuccess('Mouvement de caisse enregistre.');
    movements.reload();
    sessions.reload();
  }

  function exportRows() {
    return filtered.map((movement) => ({
      date: shortDate(movement.movement_date),
      piece: movement.piece_number ?? '-',
      type: movementTypeLabel(movement.type),
      libelle: movement.label ?? movement.reference ?? '-',
      categorie: cashCategoryLabel(movement.category),
      montant: formatCashAmount(movement.amount, movement.currency ?? 'USD'),
      devise: movement.currency ?? 'USD',
      taux: movement.exchange_rate_used ?? '-',
      equivalent_usd: formatCashAmount(movement.equivalent_usd ?? movement.amount, 'USD'),
      facture: movement.invoice_number ?? '-',
      locataire_ou_fournisseur: movement.tenant_name ?? movement.supplier ?? '-',
      reference: movement.reference ?? '-',
      statut: movement.type === 'IN' ? 'Entree' : 'Depense',
    }));
  }

  return (
    <section>
      <PageHeader title="Caisse" />
      <SuccessMessage message={success} />
      <div className="mini-stats">
        <div className="mini-stat"><span>Solde USD</span><strong>{formatCashAmount(stats.usd.balance, 'USD')}</strong></div>
        <div className="mini-stat"><span>Entrees USD aujourd'hui</span><strong>{formatCashAmount(stats.usd.todayIn, 'USD')}</strong></div>
        <div className="mini-stat"><span>Depenses USD aujourd'hui</span><strong>{formatCashAmount(stats.usd.todayOut, 'USD')}</strong></div>
        <div className="mini-stat"><span>Entrees USD du mois</span><strong>{formatCashAmount(stats.usd.monthIn, 'USD')}</strong></div>
        <div className="mini-stat"><span>Depenses USD du mois</span><strong>{formatCashAmount(stats.usd.monthOut, 'USD')}</strong></div>
        <div className="mini-stat"><span>Solde CDF</span><strong>{formatCashAmount(stats.cdf.balance, 'CDF')}</strong></div>
        <div className="mini-stat"><span>Entrees CDF aujourd'hui</span><strong>{formatCashAmount(stats.cdf.todayIn, 'CDF')}</strong></div>
        <div className="mini-stat"><span>Depenses CDF aujourd'hui</span><strong>{formatCashAmount(stats.cdf.todayOut, 'CDF')}</strong></div>
        <div className="mini-stat"><span>Entrees CDF du mois</span><strong>{formatCashAmount(stats.cdf.monthIn, 'CDF')}</strong></div>
        <div className="mini-stat"><span>Depenses CDF du mois</span><strong>{formatCashAmount(stats.cdf.monthOut, 'CDF')}</strong></div>
        <div className="mini-stat"><span>Nombre de mouvements</span><strong>{stats.count}</strong></div>
      </div>

      <div className="table-toolbar">
        <div className="toolbar-main">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher" />
        </div>
        <div className="toolbar-actions">
          <button type="button" className="secondary" onClick={() => setFilters({ type: '', category: '', period: '', currency: '' })}>Reinitialiser</button>
          <button
            type="button"
            className="secondary"
            onClick={() =>
              exportXlsxWorkbook('Caisse.xlsx', [
                { name: 'Resume', rows: [{ solde_usd: formatCashAmount(stats.usd.balance, 'USD'), entrees_usd_aujourdhui: formatCashAmount(stats.usd.todayIn, 'USD'), depenses_usd_aujourdhui: formatCashAmount(stats.usd.todayOut, 'USD'), entrees_usd_du_mois: formatCashAmount(stats.usd.monthIn, 'USD'), depenses_usd_du_mois: formatCashAmount(stats.usd.monthOut, 'USD'), solde_cdf: formatCashAmount(stats.cdf.balance, 'CDF'), entrees_cdf_aujourdhui: formatCashAmount(stats.cdf.todayIn, 'CDF'), depenses_cdf_aujourdhui: formatCashAmount(stats.cdf.todayOut, 'CDF'), entrees_cdf_du_mois: formatCashAmount(stats.cdf.monthIn, 'CDF'), depenses_cdf_du_mois: formatCashAmount(stats.cdf.monthOut, 'CDF'), nombre_mouvements: stats.count }] },
                { name: 'Mouvements', rows: exportRows() },
                { name: 'Entrees', rows: filtered.filter((movement) => movement.type === 'IN').map(cashExportRow) },
                { name: 'Depenses', rows: filtered.filter((movement) => movement.type === 'OUT').map(cashExportRow) },
                { name: 'Categories', rows: Array.from(new Set(filtered.map((movement) => movement.category))).map((category) => ({ categorie: cashCategoryLabel(category), nombre: filtered.filter((movement) => movement.category === category).length })) },
                { name: 'Documents', rows: [] },
                { name: 'Timeline', rows: filtered.map((movement) => ({ date: shortDate(movement.movement_date), evenement: movementTypeLabel(movement.type), description: movement.label ?? movement.reference ?? '-', utilisateur: '-' })) },
                { name: 'Audit', rows: filtered.map((movement) => ({ piece: movement.piece_number ?? '-', reference: movement.reference ?? '-', statut: 'Disponible' })) },
              ])
            }
          >
            Export
          </button>
        </div>
      </div>

        <div className="quick-form compact-grid cash-filters-row">
        <select value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value })}>
          <option value="">Type</option>
          <option value="IN">Entree</option>
          <option value="OUT">Depense</option>
        </select>
        <select value={filters.category} onChange={(event) => setFilters({ ...filters, category: event.target.value })}>
          <option value="">Categorie</option>
          {Array.from(new Set(movements.data.map((movement) => movement.category))).map((category) => (
            <option key={category} value={category}>
              {cashCategoryLabel(category)}
            </option>
          ))}
        </select>
        <input type="month" value={filters.period} onChange={(event) => setFilters({ ...filters, period: event.target.value })} />
        <select value={filters.currency} onChange={(event) => setFilters({ ...filters, currency: event.target.value })}>
          <option value="">Devise</option>
          <option value="USD">USD</option>
          <option value="CDF">CDF</option>
        </select>
      </div>

      {can('cash.create') && <CashExpenseForm onSubmit={expense} nextPieceNumber={nextPieceNumber} />}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>N° piece</th>
              <th>Type</th>
              <th>Libelle</th>
              <th>Categorie</th>
              <th className="right">Montant</th>
              <th>Devise</th>
              <th>Taux</th>
              <th className="right">Eq. USD</th>
              <th>Facture</th>
              <th>Locataire / Fournisseur</th>
              <th>Reference</th>
              <th>Statut</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((movement) => (
              <tr key={movement.id} className="clickable-row" onClick={() => navigate(`/cash/${movement.id}`)}>
                <td>{shortDate(movement.movement_date)}</td>
                <td>{movement.piece_number ?? '-'}</td>
                <td>{movementTypeLabel(movement.type)}</td>
                <td>{movement.label ?? movement.reference ?? '-'}</td>
                <td>{cashCategoryLabel(movement.category)}</td>
                <td className="right">{formatCashAmount(movement.amount, movement.currency ?? 'USD')}</td>
                <td>{movement.currency ?? 'USD'}</td>
                <td>{movement.exchange_rate_used ? movement.exchange_rate_used.toLocaleString('fr-FR') : '-'}</td>
                <td className="right">{formatCashAmount(movement.equivalent_usd ?? movement.amount, 'USD')}</td>
                <td>{movement.invoice_number ?? '-'}</td>
                <td>{movement.tenant_name ?? movement.supplier ?? '-'}</td>
                <td>{movement.reference ?? '-'}</td>
                <td>
                  <span className={`badge ${movement.type === 'IN' ? 'paid' : 'unpaid'}`}>{movement.type === 'IN' ? 'Entree' : 'Depense'}</span>
                </td>
                <td>
                  <div className="row-actions">
                    <button
                      type="button"
                      className="icon-btn"
                      title="Voir"
                      onClick={(event) => {
                        event.stopPropagation();
                        navigate(`/cash/${movement.id}`);
                      }}
                    >
                      <Eye size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && <EmptyState />}
      </div>
    </section>
  );
}

export function CashDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [movement, setMovement] = useState<CashMovementDetail | null>(null);

  useEffect(() => {
    if (!id) return;
    api.get<CashMovementDetail>(`/cash/movements/${id}`).then((response) => setMovement(response.data));
  }, [id]);

  if (!movement) return <div className="empty">Chargement du mouvement...</div>;

  const rows = [
    {
      piece: movement.piece_number ?? '-',
      date: shortDate(movement.movement_date),
      type: movementTypeLabel(movement.type),
      category: cashCategoryLabel(movement.category),
      amount: formatCashAmount(movement.amount, movement.currency ?? 'USD'),
      devise: movement.currency ?? 'USD',
      taux: movement.exchange_rate_used ?? '-',
      equivalent_usd: formatCashAmount(movement.equivalent_usd ?? movement.amount, 'USD'),
      reference: movement.reference ?? '-',
      tenant: movement.tenant_name ?? '-',
      attachment: movement.attachment_file_name ?? '-',
    },
  ];

  return (
    <section>
      <div className="page-header no-print">
        <h2>Mouvement de caisse</h2>
        <div className="actions">
          <button className="secondary" onClick={() => navigate('/cash')}>
            <ArrowLeft size={16} />
            Retour
          </button>
          {can('cash.update') && (
            <button>
              <Pencil size={16} />
              Modifier
            </button>
          )}
          <button onClick={() => window.print()}>
            <Printer size={16} />
            Imprimer
          </button>
          <button
            className="secondary"
            onClick={() =>
              exportXlsxWorkbook(`Caisse_${movement.id}.xlsx`, [
                { name: 'Resume', rows },
                { name: 'Mouvements', rows },
                { name: 'Entrees', rows: movement.type === 'IN' ? rows : [] },
                { name: 'Depenses', rows: movement.type === 'OUT' ? rows : [] },
                { name: 'Categories', rows: [{ categorie: cashCategoryLabel(movement.category), nombre: 1 }] },
                { name: 'Documents', rows: movement.documents ?? [] },
                { name: 'Timeline', rows: movement.timeline ?? [] },
                { name: 'Audit', rows: movement.history ?? [] },
              ])
            }
          >
            <FileSpreadsheet size={16} />
            Exporter Excel
          </button>
        </div>
      </div>

      <article className="print-invoice">
        <header>
          <div className="invoice-logo">PE</div>
          <div>
            <h2>NG Property ERP</h2>
            <p>Reçu de mouvement de caisse</p>
            <p>Merci pour votre confiance.</p>
          </div>
          <div className="invoice-meta">
            <strong>
              {movement.type === 'IN' ? 'Entrée' : 'Dépense'} #{movement.id}
            </strong>
            <span>N° pièce: {movement.piece_number ?? '-'}</span>
            <span>Date: {shortDate(movement.movement_date)}</span>
            <span>Montant: {formatCashAmount(movement.amount, movement.currency ?? 'USD')}</span>
            <span>Référence: {movement.reference ?? '-'}</span>
          </div>
        </header>

        <div className="invoice-parties">
          <div>
            <span>Informations générales</span>
            <strong>{cashCategoryLabel(movement.category)}</strong>
            <p>Libellé: {movement.label ?? movement.description ?? '-'}</p>
            <p>Facture: {movement.invoice_number ?? '-'}</p>
            <p>Locataire: {movement.tenant_name ?? '-'}</p>
            <p>Téléphone: {movement.tenant_phone ?? '-'}</p>
            <p>Email: {movement.tenant_email ?? '-'}</p>
          </div>
          <div>
            <span>Détails</span>
            <strong>{movement.building_name ?? '-'}</strong>
            <p>Appartement: {movement.unit_number ?? '-'}</p>
            <p>Utilisateur: {movement.user_name ?? movement.employee_name ?? '-'}</p>
            <p>Mode de paiement: {movement.payment_method ?? '-'}</p>
            <p>Observations: {movement.description ?? '-'}</p>
          </div>
        </div>

            <div className="cash-summary-grid">
              <div className="mini-stat">
                <span>Type</span>
                <strong>{movementTypeLabel(movement.type)}</strong>
          </div>
          <div className="mini-stat">
                <span>Catégorie</span>
                <strong>{cashCategoryLabel(movement.category)}</strong>
          </div>
          <div className="mini-stat">
            <span>Montant</span>
            <strong>{formatCashAmount(movement.amount, movement.currency ?? 'USD')}</strong>
          </div>
              <div className="mini-stat">
                <span>Facture</span>
                <strong>{movement.invoice_number ?? '-'}</strong>
              </div>
            </div>

            <div className="detail-section no-print">
              <h4>Pièce jointe</h4>
              {movement.attachment_file_name ? (
                <div className="actions-row">
                  <span className="info-message">{movement.attachment_file_name}</span>
                  {movement.attachment_file_url ? (
                    <a className="secondary" href={movement.attachment_file_url} target="_blank" rel="noreferrer">
                      Voir / Télécharger
                    </a>
                  ) : (
                    <span className="compact-empty">Aucune URL de fichier disponible.</span>
                  )}
                </div>
              ) : (
                <div className="compact-empty">Aucune pièce jointe.</div>
              )}
            </div>
          </article>

      <div className="invoice-accordion-grid no-print">
        <details>
          <summary>Timeline ({movement.timeline?.length ?? 0})</summary>
          <SimpleBlock rows={movement.timeline ?? []} />
        </details>
        <details>
          <summary>Documents ({movement.documents?.length ?? 0})</summary>
          <SimpleBlock rows={movement.documents ?? []} />
        </details>
        <details>
          <summary>Historique ({movement.history?.length ?? 0})</summary>
          <SimpleBlock rows={movement.history ?? []} />
        </details>
      </div>
    </section>
  );
}

function CashExpenseForm({ onSubmit, nextPieceNumber }: { onSubmit: (form: FormData) => void; nextPieceNumber: string }) {
  const [open, setOpen] = useState(false);
  const [attachmentName, setAttachmentName] = useState('');
  const [currency, setCurrency] = useState<'USD' | 'CDF'>('USD');
  return (
    <>
      <div className="actions-row">
        <button type="button" onClick={() => setOpen(true)}>
          Enregistrer depense
        </button>
      </div>
      {open && (
        <Modal title="Enregistrer depense" onClose={() => setOpen(false)}>
          <form
            className="cash-modal-form"
            onSubmit={(event) => {
              event.preventDefault();
              const formData = new FormData(event.currentTarget);
              const file = formData.get('attachment_file');
              if (file instanceof File && file.name) {
                formData.set('attachment_file_name', file.name);
              }
              formData.delete('attachment_file');
              formData.set('currency', currency);
              onSubmit(formData);
              event.currentTarget.reset();
              setAttachmentName('');
              setCurrency('USD');
              setOpen(false);
            }}
          >
            <div className="modal-section">
              <h3>Informations principales</h3>
              <div className="lease-section-grid">
                <label>
                  N° piece
                  <input value={nextPieceNumber} readOnly className="locked-field" />
                </label>
                <label>
                  Libelle *
                  <input name="label" required placeholder="Libelle" />
                </label>
                <label>
                  Categorie *
                  <input name="category" required placeholder="Categorie" />
                </label>
                <label>
                  Montant *
                  <input name="amount" type="number" required step="0.01" />
                </label>
                <label>
                  Date *
                  <input name="movement_date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
                </label>
                <label>
                  Devise
                  <select name="currency" value={currency} onChange={(event) => setCurrency(event.target.value as 'USD' | 'CDF')}>
                    <option value="USD">USD</option>
                    <option value="CDF">CDF</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="modal-section">
              <h3>Paiement / fournisseur</h3>
              <div className="lease-section-grid">
                <label>
                  Fournisseur
                  <input name="supplier" placeholder="Fournisseur" />
                </label>
                <label>
                  Moyen de paiement
                  <select name="payment_method">
                    <option value="">-</option>
                    <option value="CASH">Especes</option>
                    <option value="BANK">Banque</option>
                    <option value="MOBILE_MONEY">Mobile Money</option>
                  </select>
                </label>
                <label>
                  Reference
                  <input name="reference" placeholder="Reference" />
                </label>
                <label>
                  Pièce jointe
                  <input
                    name="attachment_file"
                    type="file"
                    accept=".pdf,image/jpeg,image/png"
                    onChange={(event) => setAttachmentName(event.target.files?.[0]?.name ?? '')}
                  />
                </label>
                <label>
                  Fichier sélectionné
                  <input value={attachmentName || '-'} readOnly className="locked-field" />
                </label>
              </div>
            </div>

            <div className="modal-section">
              <h3>Notes</h3>
              <div className="lease-section-grid">
                <label>
                  Description
                  <textarea name="description" rows={2} placeholder="Description" />
                </label>
                <label>
                  Observations internes
                  <textarea name="notes" rows={2} placeholder="Observations internes" />
                </label>
              </div>
            </div>

            <div className="modal-footer-sticky">
              <button type="submit">Enregistrer</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

function cashExportRow(movement: CashMovement) {
  return {
    date: shortDate(movement.movement_date),
    piece: movement.piece_number ?? '-',
    type: movementTypeLabel(movement.type),
    libelle: movement.label ?? movement.reference ?? '-',
    categorie: cashCategoryLabel(movement.category),
    montant: formatCashAmount(movement.amount, movement.currency ?? 'USD'),
    devise: movement.currency ?? 'USD',
    taux: movement.exchange_rate_used ?? '-',
    equivalent_usd: formatCashAmount(movement.equivalent_usd ?? movement.amount, 'USD'),
    facture: movement.invoice_number ?? '-',
    locataire_ou_fournisseur: movement.tenant_name ?? movement.supplier ?? '-',
    reference: movement.reference ?? '-',
    piece_jointe: movement.attachment_file_name ?? '-',
  };
}

function cashCategoryLabel(value: string) {
  return (
    {
      INVOICE_PAYMENT: 'Paiement facture',
      SALARY_ADVANCE: 'Avance salaire',
      OTHER_INCOME: 'Autre entree',
      OTHER_EXPENSE: 'Autre depense',
      LEASE_GUARANTEE: 'Garantie locative',
      LEASE_GUARANTEE_REFUND: 'Remboursement garantie',
      SALARY_PAYMENT: 'Paiement salaire',
      MAINTENANCE_EXPENSE: 'Depense maintenance',
      PAYMENT_REFUND: 'Remboursement paiement',
    } as Record<string, string>
  )[value] ?? value;
}

function movementTypeLabel(value: string) {
  return ({ IN: 'Entree', OUT: 'Depense' } as Record<string, string>)[value] ?? value;
}

function SimpleBlock({ rows }: { rows: Array<Record<string, unknown>> }) {
  return (
    <div className="compact-list">
      {rows.length ? rows.map((row, index) => <div className="compact-item" key={index}><span>{Object.entries(row).map(([key, value]) => `${key}: ${String(value ?? '-')}`).join(' | ')}</span></div>) : <div className="empty-inline">Aucune donnee.</div>}
    </div>
  );
}
