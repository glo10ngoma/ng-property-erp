export const statusLabel = (value: string) =>
  ({
    PAID: 'Payée',
    UNPAID: 'Non payée',
    PARTIAL: 'Paiement partiel',
    PENDING: 'En attente',
    APPROVED: 'Approuvée',
    REJECTED: 'Rejetée',
    OVERDUE: 'En retard',
    DRAFT: 'Brouillon',
    VALIDATED: 'Validée',
    CANCELLED: 'Annulée',
    NEW: 'Nouveau',
    DIAGNOSIS: 'Diagnostic',
    WAITING_APPROVAL: 'Validation attendue',
    ASSIGNED: 'Affectée',
    IN_PROGRESS: 'En cours',
    ON_HOLD: 'En pause',
    RESOLVED: 'Résolue',
    CLOSED: 'Clôturée',
    REFUNDED: 'Remboursée',
    NOT_PAID: 'Non payée',
    ACTIVE: 'Actif',
    INACTIVE: 'Inactif',
    OCCUPIED: 'Occupé',
    VACANT: 'Libre',
    MAINTENANCE: 'Maintenance',
  })[value] ?? value;

export const paymentMethodLabel = (value: string) =>
  ({
    CASH: 'Espèces',
    BANK: 'Banque',
    MOBILE_MONEY: 'Mobile Money',
  })[value] ?? value;

export const itemLabel = (value: string) =>
  ({
    'Monthly rent': 'Loyer mensuel',
    Water: 'Eau',
    Electricity: 'Électricité',
    Maintenance: 'Maintenance',
    Parking: 'Parking',
    Internet: 'Internet',
    'Common charges': 'Charges communes',
    Other: 'Autres',
  })[value] ?? value;
