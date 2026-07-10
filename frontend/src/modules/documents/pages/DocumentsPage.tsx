import { Download, FileText } from 'lucide-react';
import { useMemo } from 'react';
import { PageHeader, EmptyState } from '../../../components';
import { shortDate } from '../../../api';
import { useApiList } from '../../../hooks';
import { openOrDownloadDocument } from '../../../core/utils/documentActions';

export function DocumentsPage() {
  const leases = useApiList<Record<string, unknown>>('/leases');
  const invoices = useApiList<Record<string, unknown>>('/invoices');
  const employees = useApiList<Record<string, unknown>>('/employees');
  const items = useApiList<Record<string, unknown>>('/stock/items');

  const rows = useMemo(() => {
    const leaseRows = leases.data
      .filter((row) => row.contract_file_name)
      .map((row) => ({
        id: `lease-${row.id}`,
        module: 'Baux',
        type: 'Contrat',
        name: String(row.contract_file_name),
        context: `Bail ${row.contract_number ?? `#${row.id}`}`,
        date: row.start_date ? shortDate(String(row.start_date)) : '-',
      }));

    const invoiceRows = invoices.data
      .filter((row) => row.attachment_file_name)
      .map((row) => ({
        id: `invoice-${row.id}`,
        module: 'Factures',
        type: 'Pièce jointe',
        name: String(row.attachment_file_name),
        context: `Facture ${row.invoice_number ?? `#${row.id}`}`,
        date: row.issue_date ? shortDate(String(row.issue_date)) : '-',
      }));

    const employeeRows = employees.data.flatMap((row) => {
      const employeeName = [row.first_name, row.last_name].filter(Boolean).join(' ') || `#${row.id}`;
      return [
        row.identity_attachment_name ? { key: 'identity', type: "Pièce d'identité", name: String(row.identity_attachment_name) } : null,
        row.cv_attachment_name ? { key: 'cv', type: 'CV', name: String(row.cv_attachment_name) } : null,
        row.signed_contract_attachment_name ? { key: 'contract', type: 'Contrat signé', name: String(row.signed_contract_attachment_name) } : null,
      ]
        .filter(Boolean)
        .map((doc) => ({
          id: `employee-${row.id}-${doc!.key}`,
          module: 'Personnel',
          type: doc!.type,
          name: doc!.name,
          context: `Employé ${employeeName}`,
          date: row.hire_date ? shortDate(String(row.hire_date)) : '-',
        }));
    });

    const stockRows = items.data
      .filter((row) => row.attachment_file_name)
      .map((row) => ({
        id: `stock-${row.id}`,
        module: 'Stock',
        type: 'Pièce jointe',
        name: String(row.attachment_file_name),
        context: `Article ${row.name ?? `#${row.id}`}`,
        date: '-',
      }));

    return [...leaseRows, ...invoiceRows, ...employeeRows, ...stockRows];
  }, [employees.data, invoices.data, items.data, leases.data]);

  return (
    <section>
      <PageHeader title="Documents" />
      <div className="detail-section">
        <h4>Documents liés aux modules</h4>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Module</th>
                <th>Type</th>
                <th>Document</th>
                <th>Contexte</th>
                <th>Date</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.module}</td>
                  <td>{row.type}</td>
                  <td>{row.name}</td>
                  <td>{row.context}</td>
                  <td>{row.date}</td>
                  <td className="actions actions-compact">
                    <button type="button" className="icon-btn" title="Télécharger" onClick={() => openOrDownloadDocument({ fileName: row.name, title: row.type, context: row.context })}>
                      <Download size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <EmptyState message="Aucun document disponible pour le moment." />}
        </div>
      </div>
      {!!rows.length && (
        <div className="compact-empty" style={{ marginTop: 12 }}>
          <FileText size={16} /> Les documents enregistrés uniquement par nom de fichier restent téléchargeables sous forme de référence locale.
        </div>
      )}
    </section>
  );
}
