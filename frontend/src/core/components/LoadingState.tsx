export function LoadingState({ message = 'Chargement...' }: { message?: string }) {
  return (
    <div className="loading-state">
      <span className="spinner" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
