import { ReactNode } from 'react';

export function PageHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="page-header">
      <h2>{title}</h2>
      {action}
    </div>
  );
}
