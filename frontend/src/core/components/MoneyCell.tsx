import { formatCurrency } from '../utils/formatCurrency';

export function MoneyCell({ value }: { value: number | string | null | undefined }) {
  return <span className="right">{formatCurrency(value)}</span>;
}
