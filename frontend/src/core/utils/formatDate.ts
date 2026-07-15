export const formatDate = (value: string) => {
  if (!value) return '';
  const isoDate = value.slice(0, 10);
  const [yearText, monthText, dayText] = isoDate.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return new Intl.DateTimeFormat('fr-FR').format(new Date(value));
  }
  return new Intl.DateTimeFormat('fr-FR').format(new Date(year, month - 1, day));
};
