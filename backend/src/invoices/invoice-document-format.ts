export function formatInvoiceDocumentDate(value?: string | Date | null) {
  const raw = String(value ?? '').trim();
  if (!raw || raw.toLowerCase() === 'null' || raw.toLowerCase() === 'undefined') {
    return '—';
  }

  const isoDate = raw.slice(0, 10);
  const isoParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  const date = isoParts
    ? new Date(Number(isoParts[1]), Number(isoParts[2]) - 1, Number(isoParts[3]))
    : new Date(raw);

  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return new Intl.DateTimeFormat('fr-FR').format(date);
}
