import { formatDate } from '../utils/formatDate';

export function DateCell({ value }: { value: string }) {
  return <span>{formatDate(value)}</span>;
}
