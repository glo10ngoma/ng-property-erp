import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function AppLayout() {
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main">
        <Topbar />
        <Outlet />
      </main>
    </div>
  );
}
