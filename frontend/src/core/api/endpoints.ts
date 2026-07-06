export const endpoints = {
  auth: {
    login: '/auth/login',
  },
  dashboard: '/dashboard',
  users: '/users',
  buildings: '/buildings',
  units: '/units',
  tenants: '/tenants',
  invoices: '/invoices',
  payments: '/payments',
  leases: '/leases',
  cash: {
    movements: '/cash/movements',
    expenses: '/cash/expenses',
    report: '/cash/report',
  },
  staff: '/employees',
  salaryAdvances: '/salary-advances',
  stock: {
    items: '/stock/items',
    movements: '/stock/movements',
  },
  reports: {
    availability: '/reports/availability',
    payments: '/reports/payments',
    cash: '/reports/cash',
    stock: '/reports/stock',
    buildings: (id: number | string) => `/reports/buildings/${id}`,
    tenants: (id: number | string) => `/reports/tenants/${id}`,
  },
};
