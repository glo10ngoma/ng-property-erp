import type { ReactNode } from 'react';

export function EmptyState({
  title,
  message,
  action,
}: {
  title?: string;
  message?: string;
  action?: ReactNode;
}) {
  const resolvedTitle = title ?? (message ? undefined : 'Aucun element trouve.');
  const resolvedMessage = message ?? 'Ajustez les filtres ou creez le premier element si vous avez les droits.';

  return (
    <div className="empty">
      {resolvedTitle && <strong>{resolvedTitle}</strong>}
      <span>{resolvedMessage}</span>
      {action}
    </div>
  );
}
