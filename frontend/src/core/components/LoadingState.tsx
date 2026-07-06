export function LoadingState({ message = 'Chargement...' }: { message?: string }) {
  return <div className="empty">{message}</div>;
}
