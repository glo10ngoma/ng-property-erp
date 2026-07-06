export function SearchInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <input value={value} onChange={(event) => onChange(event.target.value)} placeholder="Rechercher" />;
}
