import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { EmptyState } from '../../../core/components/EmptyState';
import { PageHeader } from '../../../core/layout/PageHeader';
import { useAuth } from '../../../core/auth/AuthContext';

function devLog(message: string, payload: Record<string, unknown>) {
  if (!import.meta.env.DEV) return;
  console.info(message, payload);
}

export function SalesModuleGuard({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { user, isBootstrapping } = useAuth();
  const activeModules = user?.active_modules ?? [];
  const permissions = user?.permissions ?? [];
  const hasSalesModule = activeModules.includes('SALES');
  const hasSalesRead = permissions.includes('*') || permissions.includes('sales.read');
  const canAccessSales = hasSalesModule && hasSalesRead;

  devLog('[SALES_GUARD_DEV]', {
    pathname: location.pathname,
    authStatus: isBootstrapping ? 'loading' : user ? 'authenticated' : 'unauthenticated',
    organizationId: user?.organization_id ?? null,
    activeModules,
    permissionsCount: permissions.length,
    canAccessSales,
  });

  if (isBootstrapping) {
    return (
      <section>
        <PageHeader title="Ventes immobilières" />
        <EmptyState message="Vérification des accès au module Ventes…" />
      </section>
    );
  }

  if (!hasSalesModule) {
    return (
      <section>
        <PageHeader title="Ventes immobilières" />
        <EmptyState message="Le module Ventes immobilières n’est pas activé pour votre organisation." />
      </section>
    );
  }

  if (!hasSalesRead) {
    return (
      <section>
        <PageHeader title="Ventes immobilières" />
        <EmptyState message="Accès non autorisé pour ce profil." />
      </section>
    );
  }

  return <>{children}</>;
}
