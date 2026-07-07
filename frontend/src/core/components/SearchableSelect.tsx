import { useMemo, useState } from 'react';

export type SearchableSelectOption<TValue extends string | number = string | number> = {
  value: TValue;
  label: string;
  meta?: string;
};

export function SearchableSelect<TValue extends string | number = string | number>({
  options,
  value,
  onChange,
  placeholder = 'Rechercher',
  emptyMessage = 'Aucun resultat trouve',
}: {
  options: SearchableSelectOption<TValue>[];
  value: TValue | null;
  onChange: (value: TValue | null) => void;
  placeholder?: string;
  emptyMessage?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value) ?? null;
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return options.slice(0, 12);
    return options.filter((option) => `${option.label} ${option.meta ?? ''}`.toLowerCase().includes(term)).slice(0, 12);
  }, [options, query]);

  return (
    <div className="search-select">
      <input
        value={open ? query : selected?.label ?? ''}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setQuery('');
          setOpen(true);
        }}
        placeholder={selected ? selected.label : placeholder}
      />
      {open && (
        <div className="search-select-list">
          {filtered.map((option) => (
            <button
              className={option.value === value ? 'search-select-option active' : 'search-select-option'}
              key={String(option.value)}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(option.value);
                setQuery('');
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
              {option.meta && <small>{option.meta}</small>}
            </button>
          ))}
          {!filtered.length && <div className="search-select-empty">{emptyMessage}</div>}
        </div>
      )}
    </div>
  );
}
