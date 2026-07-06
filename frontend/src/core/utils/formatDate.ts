export const formatDate = (value: string) => new Intl.DateTimeFormat('fr-FR').format(new Date(value));
