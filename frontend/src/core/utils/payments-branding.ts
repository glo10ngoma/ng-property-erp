const CUSTOM_PAYMENT_LABEL_ORGANIZATION_IDS = new Set([1, 5]);

export type PaymentsBranding = {
  modulePlural: string;
  moduleSingular: string;
  listTitle: string;
  detailTitle: string;
  newActionLabel: string;
  recordedMessage: string;
  receiptTitle: string;
  receiptDocumentLabel: string;
  receiptPrefix: string;
  emptyStateTitle: string;
  emptyStateDescription: string;
  loadingMessage: string;
  cancelConfirm: string;
  errorLoading: string;
};

export function getPaymentsBranding(organizationId?: number | null): PaymentsBranding {
  const customized = organizationId !== null && organizationId !== undefined && CUSTOM_PAYMENT_LABEL_ORGANIZATION_IDS.has(Number(organizationId));
  if (customized) {
    return {
      modulePlural: 'Encaissements',
      moduleSingular: 'Encaissement',
      listTitle: 'Liste des encaissements',
      detailTitle: "Détail de l'encaissement",
      newActionLabel: 'Nouvel encaissement',
      recordedMessage: 'Encaissement enregistré avec succès.',
      receiptTitle: 'Reçu d’encaissement',
      receiptDocumentLabel: 'Reçu d’encaissement',
      receiptPrefix: 'REÇU ENCAISSEMENT',
      emptyStateTitle: 'Aucun encaissement trouvé.',
      emptyStateDescription: 'Ajustez les filtres ou enregistrez le premier encaissement si vous avez les droits.',
      loadingMessage: 'Chargement des encaissements...',
      cancelConfirm: 'Annuler cet encaissement ?',
      errorLoading: 'Impossible de charger les encaissements. Veuillez réessayer ou contacter l’administrateur.',
    };
  }

  return {
    modulePlural: 'Paiements',
    moduleSingular: 'Paiement',
    listTitle: 'Liste des paiements',
    detailTitle: 'Détail du paiement',
    newActionLabel: 'Nouveau paiement',
    recordedMessage: 'Paiement enregistré avec succès.',
    receiptTitle: 'Reçu de paiement',
    receiptDocumentLabel: 'Reçu de paiement',
    receiptPrefix: 'REÇU PAIEMENT',
    emptyStateTitle: 'Aucun paiement trouvé.',
    emptyStateDescription: 'Ajustez les filtres ou créez le premier paiement si vous avez les droits.',
    loadingMessage: 'Chargement des paiements...',
    cancelConfirm: 'Annuler ce paiement ?',
    errorLoading: 'Impossible de charger les paiements. Veuillez réessayer ou contacter l’administrateur.',
  };
}
