import { statusLabel } from '../utils/statusLabels';

export function StatusBadge({ value }: { value: string }) {
  return <span className={`badge ${value.toLowerCase()}`}>{statusLabel(value)}</span>;
}
