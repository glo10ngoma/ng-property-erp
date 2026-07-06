# Roles Et Permissions

## Roles

- `ADMIN`: acces complet.
- `ACCOUNTANT`: factures, paiements, caisse, rapports, lecture personnel/paie.
- `STAFF`: operations terrain sur immeubles, appartements, locataires, factures, paiements, documents.
- `DIRECTOR`: lecture seule, dashboard, rapports, exports.

## Permissions

- users.read/create/update/delete
- buildings.read/create/update/delete
- units.read/create/update/delete
- tenants.read/create/update/delete
- invoices.read/create/update/delete/print
- payments.read/create/update/delete
- cash.read/create/update/close
- staff.read/create/update/delete
- payroll.read/create/update/delete
- stock.read/create/update/delete
- reports.read/export
- documents.read/upload/download/delete

Les permissions sont centralisees dans `backend/src/saas/permissions.ts`.

## Enforcement

- Le backend reste l'autorite finale via `PermissionsGuard`.
- Le frontend masque les boutons d'ecriture avec `useAuth().can(...)` et `PermissionGuard`.
- Les routes protegees passent par `ProtectedRoute`.
- Un acces direct non autorise retourne un message propre cote frontend et un `403` cote backend.

## Modele RBAC Sprint 1

Sprint 1 ajoute les tables:

- `roles`
- `permissions`
- `user_roles`
- `role_permissions`

La source applicative courante reste `backend/src/saas/permissions.ts` pour garder le prototype simple et stable. Les tables RBAC servent de base de migration vers une administration dynamique des roles dans les prochains sprints.

## Isolation organisation

Les utilisateurs appartiennent a une `organization_id`. Le token contient cette organisation, et les requetes metier sont filtrees cote backend. Le frontend ne doit jamais envoyer `organization_id`.
