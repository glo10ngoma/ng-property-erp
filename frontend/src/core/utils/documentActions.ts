export function openOrDownloadDocument(options: {
  fileName?: string | null;
  fileUrl?: string | null;
  title?: string;
  context?: string;
}) {
  const fileName = String(options.fileName ?? '').trim();
  const fileUrl = String(options.fileUrl ?? '').trim();
  if (fileUrl) {
    window.open(fileUrl, '_blank', 'noopener,noreferrer');
    return;
  }
  if (!fileName) {
    window.alert('Aucun document disponible.');
    return;
  }

  const lines = [
    options.title ?? 'Reference document',
    `Fichier: ${fileName}`,
    options.context ? `Contexte: ${options.context}` : null,
    '',
    "Le stockage distant n'est pas encore relie a ce document.",
    'Le nom du fichier a bien ete conserve pour la demonstration.',
  ].filter(Boolean);

  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${fileName}.txt`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}
