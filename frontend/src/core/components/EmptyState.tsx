export function EmptyState({ message = 'Aucune donnée trouvée.' }: { message?: string }) {
  return <div className="empty">{message}</div>;
}
