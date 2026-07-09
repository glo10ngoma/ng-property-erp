import { NavLink } from 'react-router-dom';

const links = [
  ['/personnel/employees', 'Employés'],
  ['/personnel/contracts', 'Contrats'],
  ['/personnel/attendance', 'Pointage'],
  ['/personnel/advances', 'Avances'],
  ['/personnel/leaves', 'Congés'],
  ['/personnel/payroll', 'Paie'],
  ['/personnel/reports', 'Rapports'],
];

export function StaffNav() {
  return <nav className="tabs compact-tabs" aria-label="Navigation Personnel">
    {links.map(([to, label]) => <NavLink key={to} to={to} end className={({ isActive }) => isActive ? 'active' : ''}>{label}</NavLink>)}
  </nav>;
}
