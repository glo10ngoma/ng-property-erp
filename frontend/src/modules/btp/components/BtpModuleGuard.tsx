import type { ReactNode } from "react";
import { useAuth } from "../../../core/auth/AuthContext";
import { EmptyState } from "../../../core/components/EmptyState";
import { PageHeader } from "../../../core/layout/PageHeader";
export function BtpModuleGuard({ children }: { children: ReactNode }) {
  const { user, isBootstrapping } = useAuth();
  if (isBootstrapping)
    return (
      <section>
        <PageHeader title="BTP & chantiers" />
        <EmptyState message="Vérification des accès au module BTP…" />
      </section>
    );
  if (!user?.active_modules?.includes("BTP"))
    return (
      <section>
        <PageHeader title="BTP & chantiers" />
        <EmptyState message="Le module BTP n’est pas activé pour votre organisation." />
      </section>
    );
  if (!user.permissions.includes("*") && !user.permissions.includes("btp.read"))
    return (
      <section>
        <PageHeader title="BTP & chantiers" />
        <EmptyState message="Accès non autorisé pour ce profil." />
      </section>
    );
  return <>{children}</>;
}
