import { Outlet } from 'react-router-dom';
import { PlatformSidebar } from './PlatformSidebar';
import { Topbar } from './Topbar';

export function PlatformLayout() {
  return (
    <div className="app-shell">
      <PlatformSidebar />
      <main className="main">
        <Topbar />
        <Outlet />
      </main>
    </div>
  );
}
