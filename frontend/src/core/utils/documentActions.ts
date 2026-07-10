type DocumentActionOptions = {
  fileName?: string | null;
  fileUrl?: string | null;
  title?: string;
  context?: string;
};

function unavailableMessage(fileName?: string) {
  return fileName ? 'Document non téléversé.' : 'Aucun document disponible.';
}

export function openDocument(options: DocumentActionOptions) {
  const fileUrl = String(options.fileUrl ?? '').trim();
  if (!fileUrl) {
    window.alert(unavailableMessage(options.fileName ?? undefined));
    return;
  }
  window.open(fileUrl, '_blank', 'noopener,noreferrer');
}

export async function downloadDocument(options: DocumentActionOptions) {
  const fileName = String(options.fileName ?? '').trim();
  const fileUrl = String(options.fileUrl ?? '').trim();

  if (!fileUrl) {
    window.alert(unavailableMessage(fileName));
    return;
  }

  try {
    const response = await fetch(fileUrl, { credentials: 'include' });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error('Accès refusé au document.');
      }
      if (response.status === 404) {
        throw new Error('Document introuvable.');
      }
      throw new Error(`Téléchargement impossible (${response.status}).`);
    }

    const blob = await response.blob();
    const objectUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName || 'document';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(objectUrl);
  } catch (error) {
    console.error('Document download failed', {
      fileName,
      fileUrl,
      title: options.title,
      context: options.context,
      error,
    });
    window.alert(error instanceof Error ? error.message : 'Téléchargement impossible.');
  }
}

export function openOrDownloadDocument(options: DocumentActionOptions) {
  openDocument(options);
}
