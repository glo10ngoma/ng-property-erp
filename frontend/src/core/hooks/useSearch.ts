import { useMemo, useState } from 'react';

export function includesText(record: unknown, query: string) {
  return JSON.stringify(record ?? '').toLowerCase().includes(query.trim().toLowerCase());
}

export function useSearch<T>(data: T[]) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => data.filter((item) => includesText(item, query)), [data, query]);
  return { query, setQuery, filtered };
}
