import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../core/api/axios';

type CashExpenseCategory = {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  status: 'ACTIVE' | 'INACTIVE';
};

type CashExpenseCategoryResponse =
  | CashExpenseCategory[]
  | {
      data?: CashExpenseCategory[];
    };

function normalizeCashExpenseCategories(payload: CashExpenseCategoryResponse) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

export function useCashExpenseCategories() {
  const [data, setData] = useState<CashExpenseCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.get<CashExpenseCategoryResponse>('/cash/expense-categories');
      setData(normalizeCashExpenseCategories(response.data));
    } catch (err: any) {
      const message = err?.response?.data?.message;
      setData([]);
      setError(
        Array.isArray(message)
          ? message.join(' | ')
          : message || 'Impossible de charger les cat\u00e9gories de d\u00e9pense.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, loading, error, reload };
}

export type { CashExpenseCategory };
