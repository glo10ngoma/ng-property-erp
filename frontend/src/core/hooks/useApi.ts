import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/axios';

export function useApiList<T>(path: string) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const response = await api.get<T[]>(path);
    setData(response.data);
    setLoading(false);
  }, [path]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, loading, reload };
}
