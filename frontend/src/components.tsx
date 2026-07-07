export { PageHeader } from './core/layout/PageHeader';
export { Modal } from './core/components/Modal';
export { StatusBadge } from './core/components/StatusBadge';
export { EmptyState } from './core/components/EmptyState';
export { LoadingState } from './core/components/LoadingState';
export { SearchableSelect } from './core/components/SearchableSelect';
export type { SearchableSelectOption } from './core/components/SearchableSelect';
export { TenantSearchSelect } from './core/components/TenantSearchSelect';
export type { TenantSearchOption } from './core/components/TenantSearchSelect';

export function TableToolbar({
  query,
  onQueryChange,
  onExport,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onExport: () => void;
}) {
  return (
    <div className="table-toolbar">
      <div className="toolbar-main">
        <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Rechercher" />
      </div>
      <div className="toolbar-actions">
        <button className="secondary" onClick={() => onQueryChange('')}>Reinitialiser</button>
        <button className="secondary" onClick={onExport}>Exporter</button>
      </div>
    </div>
  );
}

export function SuccessMessage({ message }: { message?: string }) {
  if (!message) return null;
  return <div className="success-message">{message}</div>;
}
