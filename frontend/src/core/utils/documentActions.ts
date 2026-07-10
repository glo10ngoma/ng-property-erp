export function openOrDownloadDocument(options: {
  fileName?: string | null;
  fileUrl?: string | null;
  title?: string;
  context?: string;
}) {
  const fileName = String(options.fileName ?? '').trim();
  const fileUrl = String(options.fileUrl ?? '').trim();
  if (fileUrl) {
    const link = document.createElement('a');
    link.href = fileUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    if (fileName) {
      link.download = fileName;
    }
    document.body.appendChild(link);
    link.click();
    link.remove();
    return;
  }
  window.alert(fileName ? 'Document indisponible. Le fichier reel n’a pas ete televerse.' : 'Aucun document disponible.');
}
