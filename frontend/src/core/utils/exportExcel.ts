export function exportExcel(filename: string, rows: Array<Record<string, unknown>>) {
  const headers = rows[0] ? Object.keys(rows[0]) : ['Information'];
  const bodyRows = rows.length ? rows : [{ Information: 'Aucune donnée' }];
  const cell = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = `
    <table>
      <thead><tr>${headers.map((header) => `<th>${cell(header)}</th>`).join('')}</tr></thead>
      <tbody>${bodyRows.map((row) => `<tr>${headers.map((header) => `<td>${cell(row[header])}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>
  `;
  const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.xls') ? filename : `${filename}.xls`;
  link.click();
  URL.revokeObjectURL(url);
}
