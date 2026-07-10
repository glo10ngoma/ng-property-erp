import { Download, Eye, FileText } from 'lucide-react';
import { useMemo } from 'react';
import { shortDate } from '../../../api';
import { EmptyState, PageHeader } from '../../../components';
import { downloadDocument, openDocument } from '../../../core/utils/documentActions';
import { useApiList } from '../../../hooks';

type DocumentRow = {
  id: string;
  module: string;
  type: string;
  name: string;
  fileUrl: string;
  reference: string;
  date: string;
  size: string;
  status: 'Disponible' | 'Document non téléversé';
};

export function DocumentsPage() {
  const leases = useApiList<Record<string, unknown>>('/leases');
  const invoices = useApiList<Record<string, unknown>>('/invoices');
  const employees = useApiList<Record<string, unknown>>('/employees');
  const items = useApiList<Record<string, unknown>>('/stock/items');

  const rows = useMemo<DocumentRow[]>(() => {
    const leaseRows: DocumentRow[] = leases.data
      .filter((row) => row.contract_file_name || row.contract_file_url)
      .map((row) => buildRow({
        id: `lease-${row.id}`,
        module: 'Baux',
        type: 'Contrat',
        name: String(row.contract_file_name ?? 'Contrat de bail'),
        fileUrl: String(row.contract_file_url ?? ''),
        reference: `Bail ${row.contract_number ?? `#${row.id}`}`,
        date: row.start_date ? shortDate(String(row.start_date)) : '-',
      }));

    const invoiceRows: DocumentRow[] = invoices.data
      .filter((row) => row.attachment_file_name || row.attachment_file_url)
      .map((row) => buildRow({
        id: `invoice-${row.id}`,
        module: 'Factures',
        type: 'Pièce jointe',
        name: String(row.attachment_file_name ?? 'Pièce jointe facture'),
        fileUrl: String(row.attachment_file_url ?? ''),
        reference: `Facture ${row.invoice_number ?? `#${row.id}`}`,
        date: row.issue_date ? shortDate(String(row.issue_date)) : '-',
      }));

    const employeeRows: DocumentRow[] = employees.data.flatMap((row) => {
      const employeeName = [row.first_name, row.last_name].filter(Boolean).join(' ') || `#${row.id}`;
      return [
        row.identity_attachment_name
          ? buildRow({
              id: `employee-${row.id}-identity`,
              module: 'Personnel',
              type: "Pièce d'identité",
              name: String(row.identity_attachment_name),
              fileUrl: String(row.identity_attachment_url ?? ''),
              reference: `Employé ${employeeName}`,
              date: row.hire_date ? shortDate(String(row.hire_date)) : '-',
            })
          : null,
        row.cv_attachment_name
          ? buildRow({
              id: `employee-${row.id}-cv`,
              module: 'Personnel',
              type: 'CV',
              name: String(row.cv_attachment_name),
              fileUrl: String(row.cv_attachment_url ?? ''),
              reference: `Employé ${employeeName}`,
              date: row.hire_date ? shortDate(String(row.hire_date)) : '-',
            })
          : null,
        row.signed_contract_attachment_name
          ? buildRow({
              id: `employee-${row.id}-contract`,
              module: 'Personnel',
              type: 'Contrat signé',
              name: String(row.signed_contract_attachment_name),
              fileUrl: String(row.signed_contract_attachment_url ?? ''),
              reference: `Employé ${employeeName}`,
              date: row.hire_date ? shortDate(String(row.hire_date)) : '-',
            })
          : null,
      ].filter(Boolean) as DocumentRow[];
    });

    const stockRows: DocumentRow[] = items.data
      .filter((row) => row.attachment_file_name || row.attachment_file_url)
      .map((row) => buildRow({
        id: `stock-${row.id}`,
        module: 'Stock',
        type: 'Pièce jointe',
        name: String(row.attachment_file_name ?? 'Document article'),
        fileUrl: String(row.attachment_file_url ?? ''),
        reference: `Article ${row.name ?? `#${row.id}`}`,
        date: '-',
      }));

    return [...leaseRows, ...invoiceRows, ...employeeRows, ...stockRows];
  }, [employees.data, invoices.data, items.data, leases.data]);

  return (
    <section>
      <PageHeader title="Documents" />

      <div className="mini-stats">
        <div className="mini-stat"><span>Total</span><strong>{rows.length}</strong></div>
        <div className="mini-stat"><span>Disponibles</span><strong>{rows.filter((row) => row.status === 'Disponible').length}</strong></div>
        <div className="mini-stat"><span>Non téléversés</span><strong>{rows.filter((row) => row.status !== 'Disponible').length}</strong></div>
      </div>

      <div className="detail-section">
        <h4>Documents liés aux modules</h4>
        {!rows.length ? (
          <EmptyState message="Aucun document disponible pour le moment." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Type</th>
                  <th>Module</th>
                  <th>Référence</th>
                  <th>Date</th>
                  <th>Taille</th>
                  <th>Statut</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const available = row.status === 'Disponible';
                  return (
                    <tr key={row.id}>
                      <td>{row.name}</td>
                      <td>{row.type}</td>
                      <td>{row.module}</td>
                      <td>{row.reference}</td>
                      <td>{row.date}</td>
                      <td>{row.size}</td>
                      <td>{row.status}</td>
                      <td className="actions actions-compact">
                        <button
                          type="button"
                          className="icon-btn"
                          title={available ? 'Voir le document' : 'Document non téléversé'}
                          disabled={!available}
                          onClick={() => openDocument({ fileName: row.name, fileUrl: row.fileUrl, title: row.type, context: row.reference })}
                        >
                          <Eye size={16} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          title={available ? 'Télécharger le document' : 'Document non téléversé'}
                          disabled={!available}
                          onClick={() => downloadDocument({ fileName: row.name, fileUrl: row.fileUrl, title: row.type, context: row.reference })}
                        >
                          <Download size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!!rows.length && (
        <div className="compact-empty" style={{ marginTop: 12 }}>
          <FileText size={16} /> Les actions Voir et Télécharger restent actives uniquement lorsque l’URL réelle du fichier est disponible.
        </div>
      )}
    </section>
  );
}

function buildRow(input: Omit<DocumentRow, 'size' | 'status'>): DocumentRow {
  const available = Boolean(String(input.fileUrl ?? '').trim());
  return {
    ...input,
    size: '—',
    status: available ? 'Disponible' : 'Document non téléversé',
  };
}
