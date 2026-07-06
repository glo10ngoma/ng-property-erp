export const formatCurrency = (value: number | string | null | undefined) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD' }).format(Number(value ?? 0));
