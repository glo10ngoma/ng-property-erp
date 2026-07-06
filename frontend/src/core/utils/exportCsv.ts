export function exportCsv(filename: string, rows: Array<Record<string, unknown>>) {
  if (!rows.length) {
    const blob = new Blob(['\uFEFFAucune donnée\n'], { type: 'text/csv;charset=utf-8;' });
    downloadBlob(filename, blob);
    return;
  }

  const headers = Object.keys(rows[0]);
  const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csv = [headers.join(';'), ...rows.map((row) => headers.map((header) => escape(row[header])).join(';'))].join('\n');
  downloadBlob(filename, new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' }));
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
