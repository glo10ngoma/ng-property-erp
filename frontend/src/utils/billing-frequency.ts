export const BILLING_FREQUENCY_OPTIONS = [
  { value: 1, label: 'Chaque mois' },
  { value: 2, label: 'Tous les 2 mois' },
  { value: 3, label: 'Tous les 3 mois - Trimestriel' },
  { value: 4, label: 'Tous les 4 mois' },
  { value: 5, label: 'Tous les 5 mois' },
  { value: 6, label: 'Tous les 6 mois - Semestriel' },
  { value: 7, label: 'Tous les 7 mois' },
  { value: 8, label: 'Tous les 8 mois' },
  { value: 9, label: 'Tous les 9 mois' },
  { value: 10, label: 'Tous les 10 mois' },
  { value: 11, label: 'Tous les 11 mois' },
  { value: 12, label: 'Tous les 12 mois - Annuel' },
];

export function billingFrequencyLabel(value: unknown) {
  const frequency = Number(value);
  return BILLING_FREQUENCY_OPTIONS.find((option) => option.value === frequency)?.label ?? BILLING_FREQUENCY_OPTIONS[0].label;
}
