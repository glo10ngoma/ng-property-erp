import { NavLink } from 'react-router-dom';

const links = [
  ['/stock/articles', 'Articles'],
  ['/stock', 'Stock'],
  ['/stock/movements', 'Mouvements'],
  ['/stock/inventories', 'Inventaires'],
  ['/stock/report', 'Rapports'],
];

export function StockNav() {
  return <nav className="tabs compact-tabs" aria-label="Navigation Stock">
    {links.map(([to, label]) => <NavLink key={to} to={to} end={to === '/stock'} className={({ isActive }) => isActive ? 'active' : ''}>{label}</NavLink>)}
  </nav>;
}
