import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import '../sales.css';

export type SalesTabKey = 'overview' | 'buyers' | 'projects' | 'catalog' | 'reservations' | 'subscriptions';
export type SalesStatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export function SalesModulePage({
  title,
  subtitle,
  activeTab,
  action,
  children,
}: {
  title: string;
  subtitle: string;
  activeTab: SalesTabKey;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="sales-v21-page">
      <div className="sales-v21-shell">
        <header className="sales-v21-header">
          <div>
            <p className="sales-v21-overline">Module Ventes</p>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          {action ? <div className="sales-v21-header-action">{action}</div> : null}
        </header>

        <SalesNavigation activeTab={activeTab} />

        <div className="sales-v21-content">{children}</div>
      </div>
    </div>
  );
}

export function SalesNavigation({ activeTab }: { activeTab: SalesTabKey }) {
  const tabs: Array<{ key: SalesTabKey; label: string; to: string }> = [
    { key: 'overview', label: "Vue d'ensemble", to: '/sales' },
    { key: 'buyers', label: 'Acquéreurs', to: '/sales/buyers' },
    { key: 'projects', label: 'Projets', to: '/sales/projects' },
    { key: 'catalog', label: 'Biens à vendre', to: '/sales/catalog' },
    { key: 'reservations', label: 'Réservations', to: '/sales/reservations' },
    { key: 'subscriptions', label: 'Souscriptions', to: '/sales/subscriptions' },
  ];

  return (
    <nav className="sales-v21-nav" aria-label="Navigation ventes">
      {tabs.map((tab) => (
        <NavLink
          key={tab.key}
          to={tab.to}
          className={({ isActive }) =>
            ['sales-v21-nav-link', isActive || activeTab === tab.key ? 'is-active' : '']
              .filter(Boolean)
              .join(' ')
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}

export function SalesSection({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="sales-v21-section">
      <div className="sales-v21-section-head">
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {action ? <div>{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function SalesKpiGrid({ children }: { children: ReactNode }) {
  return <div className="sales-v21-kpi-grid">{children}</div>;
}

export function SalesKpiCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: ReactNode;
  helper?: ReactNode;
}) {
  return (
    <article className="sales-v21-kpi-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {helper ? <small>{helper}</small> : null}
    </article>
  );
}

export function SalesFilterBar({ children }: { children: ReactNode }) {
  return <div className="sales-v21-filter-bar">{children}</div>;
}

export function SalesStatusBadge({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: SalesStatusTone;
}) {
  return <span className={`sales-v21-status sales-v21-status-${tone}`}>{label}</span>;
}

export function SalesEmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="sales-v21-empty">
      <strong>{title}</strong>
      <p>{description}</p>
      {action ? <div>{action}</div> : null}
    </div>
  );
}

export function SalesInfoList({
  items,
}: {
  items: Array<{ label: string; value: ReactNode }>;
}) {
  return (
    <dl className="sales-v21-info-list">
      {items.map((item) => (
        <div key={item.label} className="sales-v21-info-item">
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SalesEntityCard({
  title,
  subtitle,
  status,
  children,
  footer,
  to,
  onClick,
  ariaLabel,
}: {
  title: string;
  subtitle?: string;
  status?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  to?: string;
  onClick?: () => void;
  ariaLabel?: string;
}) {
  const navigate = useNavigate();
  const interactive = Boolean(to || onClick);

  const activate = () => {
    if (to) {
      navigate(to);
      return;
    }
    onClick?.();
  };

  const handleClick = (event: MouseEvent<HTMLElement>) => {
    if (!interactive) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-row-action="true"]')) return;
    activate();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!interactive) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-row-action="true"]')) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate();
    }
  };

  return (
    <article
      className={['sales-v21-entity-card', interactive ? 'is-interactive' : ''].filter(Boolean).join(' ')}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role={interactive ? 'link' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? ariaLabel ?? title : undefined}
    >
      <div className="sales-v21-entity-head">
        <div>
          <h3>{title}</h3>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {status ? <div>{status}</div> : null}
      </div>
      <div className="sales-v21-entity-body">{children}</div>
      {footer ? <div className="sales-v21-entity-footer">{footer}</div> : null}
    </article>
  );
}

export function SalesFormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="sales-v21-form-section">
      <div className="sales-v21-form-section-head">
        <h3>{title}</h3>
        {description ? <p>{description}</p> : null}
      </div>
      <div className="sales-v21-form-grid">{children}</div>
    </section>
  );
}

export function SalesField({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="sales-v21-field">
      <span className="sales-v21-field-label">{label}</span>
      {children}
      {hint ? <small className="sales-v21-field-hint">{hint}</small> : null}
      {error ? <small className="sales-v21-field-error">{error}</small> : null}
    </label>
  );
}

export function SalesFormActions({ children }: { children: ReactNode }) {
  return <div className="sales-v21-form-actions">{children}</div>;
}

export function SalesInlineNotice({
  tone = 'info',
  children,
}: {
  tone?: SalesStatusTone;
  children: ReactNode;
}) {
  return <div className={`sales-v21-inline-notice sales-v21-inline-notice-${tone}`}>{children}</div>;
}

export function SalesDataTable<T>({
  columns,
  rows,
  rowKey,
  rowHref,
  onRowClick,
  rowClassName,
  rowAriaLabel,
}: {
  columns: Array<{ key: string; label: string; render: (row: T) => ReactNode; className?: string }>;
  rows: T[];
  rowKey: (row: T) => string | number;
  rowHref?: (row: T) => string | undefined;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  rowAriaLabel?: (row: T) => string | undefined;
}) {
  const navigate = useNavigate();

  const activateRow = (row: T) => {
    const href = rowHref?.(row);
    if (href) {
      navigate(href);
      return;
    }
    onRowClick?.(row);
  };

  return (
    <div className="sales-v21-table-wrap">
      <table className="sales-v21-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={column.className}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const href = rowHref?.(row);
            const interactive = Boolean(href || onRowClick);
            const className = ['sales-v21-table-row', interactive ? 'is-interactive' : '', rowClassName?.(row) ?? '']
              .filter(Boolean)
              .join(' ');

            const handleRowClick = (event: MouseEvent<HTMLTableRowElement>) => {
              if (!interactive) return;
              const target = event.target as HTMLElement | null;
              if (target?.closest('[data-row-action="true"]')) return;
              activateRow(row);
            };

            const handleRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
              if (!interactive) return;
              const target = event.target as HTMLElement | null;
              if (target?.closest('[data-row-action="true"]')) return;
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                activateRow(row);
              }
            };

            return (
            <tr
              key={rowKey(row)}
              className={className}
              onClick={handleRowClick}
              onKeyDown={handleRowKeyDown}
              role={interactive ? 'link' : undefined}
              tabIndex={interactive ? 0 : undefined}
              aria-label={interactive ? rowAriaLabel?.(row) : undefined}
            >
              {columns.map((column) => (
                <td key={column.key} className={column.className}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          );
          })}
        </tbody>
      </table>
    </div>
  );
}
