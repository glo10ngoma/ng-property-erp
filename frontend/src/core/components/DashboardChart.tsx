import { ReactNode } from 'react';

export function DashboardChart({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="chart-card">
      <h3>{title}</h3>
      {children}
    </article>
  );
}
