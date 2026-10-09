import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import "../../sales/sales.css";
export {
  SalesDataTable as BtpDataTable,
  SalesEmptyState as BtpEmptyState,
  SalesField as BtpField,
  SalesFilterBar as BtpFilterBar,
  SalesFormActions as BtpFormActions,
  SalesFormSection as BtpFormSection,
  SalesInfoList as BtpInfoList,
  SalesInlineNotice as BtpNotice,
  SalesKpiCard as BtpKpiCard,
  SalesKpiGrid as BtpKpiGrid,
  SalesSection as BtpSection,
  SalesStatusBadge as BtpStatusBadge,
} from "../../sales/components/SalesUi";
export type BtpTab = "overview" | "projects" | "expenses";
export function BtpModulePage({
  title,
  subtitle,
  activeTab,
  action,
  children,
}: {
  title: string;
  subtitle: string;
  activeTab: BtpTab;
  action?: ReactNode;
  children: ReactNode;
}) {
  const tabs = [
    { key: "overview", label: "Vue d’ensemble", to: "/btp" },
    { key: "projects", label: "Chantiers", to: "/btp/projects" },
    { key: "expenses", label: "Dépenses", to: "/btp/expenses" },
  ] as const;
  return (
    <div className="sales-v21-page">
      <div className="sales-v21-shell">
        <header className="sales-v21-header">
          <div>
            <p className="sales-v21-overline">Module BTP</p>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          {action ? (
            <div className="sales-v21-header-action">{action}</div>
          ) : null}
        </header>
        <nav className="sales-v21-nav" aria-label="Navigation BTP">
          {tabs.map((tab) => (
            <NavLink
              key={tab.key}
              to={tab.to}
              end={tab.key === "overview"}
              className={({ isActive }) =>
                `sales-v21-nav-link${isActive || activeTab === tab.key ? " is-active" : ""}`
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
        <div className="sales-v21-content">{children}</div>
      </div>
    </div>
  );
}
