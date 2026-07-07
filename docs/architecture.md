# Architecture

## Backend

Le backend NestJS est organise par domaine:

- `auth`: authentification locale de demonstration
- `dashboard`: indicateurs operationnels et financiers
- `buildings`: immeubles
- `units`: appartements
- `tenants`: locataires
- `invoices`: factures et lignes de facture
- `payments`: paiements et mise a jour automatique des statuts

La couche database utilise `pg` et des transactions explicites pour les operations financieres. Les DTO appliquent la validation d'entree avec `class-validator`.

## Frontend

Le frontend React/Vite utilise:

- React Router pour les pages metier
- Axios pour l'API locale
- Lucide React pour les actions et la navigation
- CSS applicatif dans `src/styles.css`

Les pages principales sont Dashboard, Buildings, Apartments, Tenants, Invoices, Invoice Detail et Payments.

## SaaS V1

La V1 ajoute progressivement:

- `organizations` pour isoler les donnees SaaS client par client
- `app_users` pour utilisateurs et roles
- `roles`, `permissions`, `user_roles`, `role_permissions` pour normaliser le modele RBAC
- `audit_logs` pour tracer les actions sensibles
- `leases` pour relier locataire + appartement + contrat + garantie
- `employees`, `salary_advances`, `leaves`, `payrolls`
- `cash_sessions`, `cash_movements`
- `stock_items`, `stock_movements`, `inventory_counts`
- endpoints rapports avances sous `/api/reports`

Le prototype reste local, mais les variables et migrations preparent Supabase, Railway et Vercel.

## Isolation SaaS

Le champ technique d'isolation multi-client est `organization_id`.

Important: dans le modele metier existant, `tenant_id` designe deja le locataire. Pour eviter une confusion dangereuse, Sprint 1 conserve `tenant_id` pour les locataires et utilise `organization_id` pour le tenant SaaS. Le frontend ne doit jamais envoyer `organization_id`; il vient du token et du contexte backend.

Les requetes backend des modules critiques filtrent par `organization_id` et excluent `deleted_at IS NOT NULL`.

## Audit et soft delete

Les actions sensibles passent par `audit_logs`:

- creation
- modification
- suppression logique
- paiement
- actions caisse
- creation utilisateur
- changement role/permission

Les donnees metier critiques ne sont plus supprimees physiquement dans les flux stabilises: elles sont marquees par `deleted_at` et `deleted_by`, puis exclues des listes.

## Database

Les scripts SQL sont dans `database/`:

- `schema.sql`: tables, contraintes, index et vue de synthese paiement/facture
- `seed.sql`: 4 buildings, 40 appartements, 40 locataires, factures et paiements de demonstration
- `saas_v1.sql`: fondations SaaS metier
- `sprint1_core.sql`: organisations, RBAC normalise, audit logs, soft delete et isolation `organization_id`
- `sprint2_leases.sql`: vues `rental_units`/`tenant_people`, garanties et documents de bail, contraintes d'activation
- `sprint3_finance.sql`: allocations de paiement, recus, statuts facture enrichis et vue de synthese financiere

## Modele bail Sprint 2

Le flux immobilier cible devient:

`Rental Unit -> Lease -> Tenant Person -> Guarantee`

Implementation locale:

- `rental_units`: vue compatible sur `units`.
- `tenant_people`: vue compatible sur `tenants`.
- `leases`: source centrale d'occupation.
- `lease_guarantees`: garantie locative rattachee au bail.
- `lease_documents`: documents rattaches au bail.

Regles appliquees cote backend:

- un locataire peut avoir plusieurs baux;
- une unite locative conserve un historique de baux;
- activer un bail marque l'unite comme occupee;
- resilier un bail libere l'unite s'il n'existe aucun autre bail actif;
- un bail actif conflictuel sur la meme unite et la meme periode est refuse;
- la garantie est lue via le bail, pas directement depuis le locataire.

## Flux financier Sprint 3

Le flux financier valide est:

`Bail -> Facture -> Paiement -> Caisse`

Implementation locale:

- Les factures peuvent etre liees a un bail via `lease_id` tout en gardant la compatibilite `tenant_id`.
- Les lignes de facture portent un `item_type`: loyer, eau, electricite, maintenance, parking, charges communes, autres frais, penalites.
- Les paiements peuvent utiliser l'ancien mode `invoice_id` ou le nouveau mode `payment_allocations`.
- Les recus de paiement utilisent `receipt_number`.
- La caisse genere automatiquement un mouvement entrant lors d'un paiement facture.
- Le paiement de garantie locative genere un mouvement caisse entrant.
- Le remboursement de garantie genere un mouvement caisse sortant.
- La fermeture caisse calcule entrees, sorties, solde attendu et difference.

Statuts facture supportes:

- `DRAFT`
- `UNPAID`
- `PARTIAL`
- `PAID`
- `OVERDUE` cote affichage
- `CANCELLED`

La regle "un appartement possede au maximum un locataire actif" est garantie par un index unique partiel sur `tenants(unit_id)` lorsque `status = 'ACTIVE'`.

## Polish UX Sprint 12.5

Le Sprint 12.5 reste volontairement hors fonctionnalites metier. Il renforce les composants d'experience transverses:

- login professionnel centre avec bascule d'affichage du mot de passe;
- topbar avec identite utilisateur, role, organisation et deconnexion explicite;
- Centre d'Activite comme accueil quotidien apres connexion;
- etats vides et chargements reutilisables;
- documentation et changelog de preparation demo.

Ces ajustements ne changent pas la sidebar, la palette, les routes cloud ni le comportement des API.
