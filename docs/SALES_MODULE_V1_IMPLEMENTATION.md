# PHASE V1.2 — FONDATIONS DU MODULE VENTES VALIDÉES SUR SALES-SANDBOX

## Sandbox validé

- environnement utilisé : `backend/.env.sales-sandbox`
- project ref validé : `zogdhdirfskrujevfuuk`
- production explicitement exclue : `dtvteqlgpiwacmyxanrt`
- aucune migration exécutée pendant la recette V1.2
- aucune donnée CATALYSE ou Magic Construction utilisée, modifiée ou exposée

## Portée livrée

Cette livraison crée les fondations techniques du module Ventes immobilières sans l’activer pour les organisations existantes.

## Migrations créées

- `database/20260815_organization_modules.sql`
- `database/20260815_sales_v1_foundations.sql`

## Tables créées

- `organization_modules`
- `sales_settings`
- `sales_buyers`
- `sales_projects`
- `sales_property_catalog`
- `sales_audit_events`

## Permissions ajoutées

- `sales.read`
- `sales.admin`
- `sales.settings.read`
- `sales.settings.manage`
- `sales_buyers.read`
- `sales_buyers.create`
- `sales_buyers.update`
- `sales_buyers.archive`
- `sales_projects.read`
- `sales_projects.create`
- `sales_projects.update`
- `sales_projects.archive`
- `sales_catalog.read`
- `sales_catalog.create`
- `sales_catalog.update`
- `sales_catalog.archive`
- permissions futures `sales_reservations.*`, `sales_contracts.*`, `sales_schedules.*`, `sales_payments.*`, `sales_recovery.*`, `sales_documents.*`, `sales_reports.read`

Aucune permission n’a été attribuée automatiquement à un rôle existant.

## Endpoints créés

- `GET /api/sales/bootstrap`
- `GET /api/sales/settings`
- `PATCH /api/sales/settings`
- `GET /api/sales/buyers`
- `GET /api/sales/buyers/:id`
- `POST /api/sales/buyers`
- `PATCH /api/sales/buyers/:id`
- `PATCH /api/sales/buyers/:id/archive`
- `GET /api/sales/projects`
- `GET /api/sales/projects/:id`
- `POST /api/sales/projects`
- `PATCH /api/sales/projects/:id`
- `PATCH /api/sales/projects/:id/archive`
- `GET /api/sales/catalog`
- `GET /api/sales/catalog/:id`
- `POST /api/sales/catalog`
- `PATCH /api/sales/catalog/:id`
- `PATCH /api/sales/catalog/:id/status`
- `PATCH /api/sales/catalog/:id/archive`

## Feature flag

Le contrôle backend repose sur :

- la table `organization_modules`
- le décorateur `RequireOrganizationModule`
- le service `OrganizationModulesService`
- le code stable `MODULE_NOT_ENABLED`

Règle :

- absence de ligne = module désactivé
- ligne `is_enabled = false` = module désactivé
- aucune organisation réelle n’a été activée automatiquement

## Frontend livré

- types et helper de module actif
- API Sales minimale
- guard frontend
- page temporaire sobre
- route et sidebar masquées tant que `SALES` n’est pas actif et autorisé

## Comportement par défaut

- CATALYSE : aucun changement visible
- Magic Construction : aucun changement visible
- accès direct à `/sales` : refus propre si module inactif ou permission absente

## Rollback

- désactiver `SALES` dans `organization_modules`
- retirer temporairement l’entrée frontend si nécessaire
- conserver les migrations additives
- éviter tout rollback destructif

## Résultats Auth et feature flag

### Authentification sandbox

- `POST /api/auth/login` : `201`
- utilisateur fictif sandbox visible uniquement avec les organisations :
  - `SALES Sandbox Enabled`
  - `SALES Sandbox Disabled`
  - `SALES Sandbox Other`
- aucun tenant réel visible dans la recette

### Module désactivé

Organisation testée : `SALES Sandbox Disabled`

- `POST /api/auth/switch-organization` : `201`
- `GET /api/sales/bootstrap` : `403`
- code backend observé : `MODULE_NOT_ENABLED`
- message observé : `Module SALES is not enabled for the current organization.`

### Organisation activée sans permission Sales

Organisation testée : `SALES Sandbox Enabled`
Rôle test : `VIEWER_CLIENT`

- `POST /api/auth/switch-organization` : `201`
- `GET /api/sales/bootstrap` : `403`
- refus observé : `Permission required: sales.read`

### Organisation activée avec permission

Organisation testée : `SALES Sandbox Enabled`
Rôle test : `ADMIN_CLIENT`

- `POST /api/auth/switch-organization` : `201`
- `GET /api/sales/bootstrap` : `200`
- `GET /api/auth/me` : `200`
- `active_modules` confirmé : `["SALES"]`
- permissions confirmées : `["*"]`

## CRUD réellement validé sur sandbox

### Buyers

- `POST /api/sales/buyers` : `201`
- `GET /api/sales/buyers/:id` : `200`
- `PATCH /api/sales/buyers/:id` : `200`
- `PATCH /api/sales/buyers/:id/archive` : `200`
- statut archivé observé : `ARCHIVED`

### Projects

- `POST /api/sales/projects` : `201`
- `GET /api/sales/projects/:id` : `200`
- `PATCH /api/sales/projects/:id` : `200`
- `PATCH /api/sales/projects/:id/archive` : `200`

### Catalog

- `POST /api/sales/catalog` : `201`
- `GET /api/sales/catalog/:id` : `200`
- `PATCH /api/sales/catalog/:id` : `200`
- `PATCH /api/sales/catalog/:id/status` : `200`
- `PATCH /api/sales/catalog/:id/archive` : `200`
- statut validé : `AVAILABLE`

## Contraintes USD / CDF validées

- devise obligatoire dès qu’un prix est renseigné
- `400` confirmé si `currency` est absente avec un prix
- `400` confirmé pour devise invalide
- `400` confirmé pour montant négatif
- contrôle métier validé : `minimum_price <= list_price`
- aucune conversion automatique inventée pendant la recette

## Isolation multi-tenant validée

- données créées uniquement dans `SALES Sandbox Enabled`
- bascule vers `SALES Sandbox Other` : les données créées deviennent invisibles
- accès direct par ID sur l’autre organisation :
  - buyer : `404 Buyer not found`
  - project : `404 Project not found`
  - catalog : `404 Catalog item not found`
- tentative de lier un item catalogue à un projet d’une autre organisation :
  - rejet observé : `404 Project not found`
- aucune fuite inter-organisation observée

## Non-régression validée

- `GET /api/auth/me` : `200`
- `GET /api/buildings` : `200`
- `GET /api/units` : `200`
- `GET /api/tenants` : `200`
- `GET /api/dashboard` : `200`

## Tests et contrôles

- script backend non destructif : `backend/scripts/test-sales-foundations.js`
- script backend permissions V2.0 : `backend/scripts/test-sales-permissions.js`
- script backend sandbox V2.0 : `backend/scripts/test-sales-sandbox-v2.js`
- build backend
- lint backend
- build frontend
- contrôle UTF-8
- `git diff --check`
- audit des migrations contre `DROP`, `TRUNCATE`, suppressions et changements destructifs

## Limites restantes

- aucune UI d’activation plateforme livrée
- aucune attribution automatique aux rôles existants hors sandbox
- aucun seed sandbox automatique de production
- réservations, contrats, échéanciers, paiements, recouvrement et rapports complets reportés à V2+
