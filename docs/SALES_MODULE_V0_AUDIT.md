# SALES MODULE V0 AUDIT — Property ERP

## 1. Résumé exécutif

Le dépôt audité est `C:\Users\Esther\Documents\ERP IMMO PROTO`.

Constat principal : l'application web et l'API backend sont déjà structurées par modules métier, avec une isolation multi-tenant effective côté backend via un token signé, une résolution d'organisation côté serveur et un filtrage systématique par `organization_id` dans les requêtes métier. Cette base est compatible avec l'ajout d'un module `Ventes immobilières`, à condition de conserver une approche strictement additive : nouvelles tables, nouvelles permissions, nouveau feature flag, aucune réutilisation abusive des entités locatives pour représenter une vente, aucun changement implicite de rôle, aucun couplage destructif avec les flux Finance actuels.

Verdict préliminaire : `GO` pour V1, sous conditions strictes de livraison progressive, de feature flag désactivé par défaut et de tests de non-régression ciblés sur CATALYSE et Magic Construction.

## 2. État Git initial

- Dépôt : `C:\Users\Esther\Documents\ERP IMMO PROTO`
- Branche active : `main`
- Remote Git : `https://github.com/glo10ngoma/ng-property-erp.git`
- Dernier commit : `67c302c fix(export): populate every exceljs worksheet`
- `git status --short` au début de l'audit : propre
- `git diff --check` pendant la phase : aucun changement métier appliqué

## 3. Architecture frontend existante

### Stack observée

- Framework UI : React 18.3.1
- Build tool : Vite 6.0.3
- Routing : `react-router-dom` 7.0.2
- HTTP client : Axios
- Icônes : `lucide-react`
- Export Excel/XLSX : `exceljs` + export HTML `.xls`
- PDF côté frontend : `jspdf` / `jspdf-autotable`

### Fichiers structurants observés

- App racine : `frontend/src/app/App.tsx`
- Provider router : `frontend/src/app/providers.tsx`
- Routing principal : `frontend/src/app/router.tsx`
- Configuration applicative : `frontend/src/app/config.ts`
- Layout principal : `frontend/src/core/layout/AppLayout.tsx`
- Sidebar principale : `frontend/src/core/layout/Sidebar.tsx`
- Topbar : `frontend/src/core/layout/Topbar.tsx`
- Header de page partagé : `frontend/src/core/layout/PageHeader.tsx`
- Layout plateforme : `frontend/src/core/layout/PlatformLayout.tsx`
- Client HTTP : `frontend/src/core/api/axios.ts`
- Types auth/API : `frontend/src/core/api/api.types.ts`
- Contexte auth : `frontend/src/core/auth/AuthContext.tsx`
- Garde auth : `frontend/src/core/auth/ProtectedRoute.tsx`
- Garde permissions : `frontend/src/core/auth/PermissionGuard.tsx`
- Garde plateforme : `frontend/src/core/auth/PlatformRoute.tsx`
- Persistance session/auth : `frontend/src/core/auth/auth.service.ts`
- Table partagée : `frontend/src/core/components/DataTable.tsx`
- Modale partagée : `frontend/src/core/components/Modal.tsx`
- Export XLS : `frontend/src/core/utils/exportExcel.ts`
- Export XLSX : `frontend/src/core/utils/exportXlsx.ts`

### Shell, navigation, thème, responsive

- Le shell web actuel est stable et centralisé dans `AppLayout` avec `Sidebar + Topbar + Outlet`.
- La navigation métier existante est déclarative dans `Sidebar.tsx`, regroupée par domaines (`Tableau de bord`, `Gestion immobilière`, `Finance`, `Opérations`, `Stock`, `Ressources humaines`, `Administration`).
- Aucun système de thème applicatif typé ou tokenisé n'a été identifié dans les fichiers inspectés. Le thème semble principalement géré par CSS global.
- Le responsive existe, mais l'audit de cette phase n'a pas révélé de système dédié type design tokens ou feature flags responsive.
- Aucun moteur de feature flags frontend n'a été observé.

### Permissions, auth et organisation active côté frontend

- Les routes sont protégées par `ProtectedRoute`, `PermissionGuard` et `PlatformRoute`.
- Les permissions sont évaluées côté frontend via `useAuth().can(permission)`.
- L'organisation active est stockée dans `localStorage` via la clé `property_erp_active_organization`.
- Le frontend stocke aussi un marqueur `property_erp_organization_selection_required`.
- Le client Axios injecte :
  - `Authorization: Bearer <token>`
  - `x-organization-id: <activeOrganizationId>`
- Les erreurs `401` provoquent un nettoyage local de session et un événement `property-erp:auth-error`.
- Les erreurs `403` ne sont pas absorbées globalement : elles remontent et sont traitées au niveau des écrans/guards.

### Composants et patterns réutilisables

Réutilisables pour Ventes :

- routing modulaire via `router.tsx`
- shell `AppLayout`
- `Sidebar` / `Topbar`
- `PageHeader`
- `Modal`
- `DataTable`
- intercepteur Axios
- `AuthContext`
- exports `exportExcel` / `exportXlsxWorkbook`
- patterns d'écrans détaillés déjà en place sur Locataires, Stock, Personnel, Finance

Absences notables à prendre en compte :

- pas de feature flags frontend existants
- pas de moteur de formulaires partagé identifié
- pas de système toast dédié clairement observé dans les fichiers structurants inspectés
- pas de système charting clairement observé dans les fichiers inspectés

## 4. Architecture backend existante

### Stack observée

- Framework : NestJS 10.4.15
- Validation : `class-validator` + `class-transformer`
- Base SQL : PostgreSQL via `pg`
- Gestion documentaire : `docxtemplater`, `pizzip`, services documents dédiés
- Scheduling : `@nestjs/schedule`

### Fichiers structurants observés

- Module racine : `backend/src/app.module.ts`
- Service DB : `backend/src/database/database.service.ts`
- Auth controller : `backend/src/auth/auth.controller.ts`
- Résolution multi-tenant : `backend/src/auth/organization-access.service.ts`
- Contexte requête : `backend/src/auth/request-context.ts`
- Intercepteur de contexte : `backend/src/auth/request-context.interceptor.ts`
- Guard permissions : `backend/src/auth/permissions.guard.ts`
- Audit interceptor : `backend/src/auth/audit.interceptor.ts`
- Permissions canoniques : `backend/src/saas/permissions.ts`
- Contrôleurs agrégés métier : `backend/src/saas/saas.controllers.ts`
- Stockage documents : `backend/src/documents/document-storage.service.ts`
- Rendu documents : `backend/src/documents/document-renderer.service.ts`
- Paiements : `backend/src/payments/payments.controller.ts`, `backend/src/payments/payments.service.ts`
- Factures : `backend/src/invoices/invoices.controller.ts`, `backend/src/invoices/invoices.service.ts`
- Dashboard : `backend/src/dashboard/dashboard.controller.ts`, `backend/src/dashboard/dashboard.service.ts`

### Organisation modulaire observée

Modules Nest distincts observés :

- `activity`
- `auth`
- `automations`
- `buildings`
- `communication`
- `dashboard`
- `documents`
- `health`
- `invoices`
- `payments`
- `saas`
- `tenants`
- `units`

Constat important : une partie substantielle de la logique métier transverse et des sous-domaines avancés est centralisée dans `backend/src/saas/saas.service.ts` et `backend/src/saas/saas.controllers.ts`. Cela signifie que le futur module Ventes devra éviter de grossir encore ce service monolithique et gagnera à être livré comme module dédié `sales`, même s'il consomme des services/utilitaires existants.

### Guards, validation, transactions, audit

- Le backend est l'autorité finale via `PermissionsGuard` global (`APP_GUARD`).
- Le contexte requête est injecté via `AsyncLocalStorage` (`RequestContext`).
- Les DTO Nest avec `class-validator` existent au moins pour les modules dédiés et l'auth.
- Les transactions sont gérées par `DatabaseService.transaction(...)` avec `BEGIN / COMMIT / ROLLBACK`.
- Les écritures sensibles sont auditées via `AuditInterceptor` dans `audit_logs`.
- Des verrous applicatifs `pg_advisory_xact_lock(...)` sont déjà utilisés pour certains numéros métier et flux critiques.

## 5. Schéma de données pertinent

### Type de base et conventions

- Base observée : PostgreSQL
- Schémas/migrations inspectés : `database/schema.sql`, `database/saas_v1.sql`, `database/supabase_schema.sql`, migrations additives `database/2026*.sql`
- Convention d'identifiants : `SERIAL` / entier
- Convention multi-tenant : `organization_id` non nul sur les tables métier
- Soft delete répandu : `deleted_at`, `deleted_by`
- Audit centralisé : `audit_logs`
- Montants SQL : `NUMERIC(12,2)` ou `NUMERIC(14,2)` selon les domaines
- Documents : stockage structuré par bucket / chemins organisés par `organization_id`

### Tables existantes directement pertinentes pour Ventes

Réutilisables ou liées :

- `organizations`
- `app_users`
- `user_organizations`
- `roles`
- `permissions`
- `user_roles`
- `role_permissions`
- `buildings`
- `units`
- `tenants`
- `leases`
- `lease_guarantees`
- `lease_documents`
- `invoices`
- `invoice_items`
- `payments`
- `payment_allocations`
- `cash_sessions`
- `cash_movements`
- `tenant_credits`
- `tenant_credit_allocations`
- `tenant_credit_refunds`
- `bank_accounts`
- `bank_transactions`
- `treasury_transfers`
- `documents` / buckets de stockage associés
- `audit_logs`
- `reference_data`
- `company_settings`

### Contraintes et patterns déjà en place

- `organization_id` indexé massivement
- contraintes uniques par organisation déjà présentes sur plusieurs tables métier
- paiements ventilés via `payment_allocations`
- séparation des devises existante dans plusieurs zones (paiements, caisse, banque, garanties)
- historique et corbeille par soft delete dans plusieurs modules

## 6. Isolation multi-tenant actuelle

### Mécanisme prouvé

L'isolation multi-tenant actuelle est réelle et ne repose pas uniquement sur le frontend.

Preuves observées :

1. Le token signé maison contient `organization_id` et `organization_confirmed`.
2. Le `PermissionsGuard` valide le token et reconstruit le contexte utilisateur via `OrganizationAccessService.resolveUserContext(...)`.
3. Si `organization_confirmed` est faux, tout endpoint métier hors pré-sélection retourne `403` avec obligation de sélectionner une organisation.
4. `RequestContext.organizationId()` est ensuite utilisé dans les services métier.
5. Les requêtes SQL métier inspectées filtrent explicitement par `organization_id = $...`.
6. L'intercepteur d'audit écrit `organization_id` dans `audit_logs`.

### Risques actuels à garder en tête

- `RequestContext.organizationId()` retombe sur `1` si aucun utilisateur n'est présent. Cela est acceptable pour certains cas internes, mais tout nouveau module devra éviter les chemins qui pourraient écrire sans utilisateur authentifié.
- Le frontend envoie `x-organization-id`, mais le backend ne lui fait pas confiance seul : il résout bien la session côté serveur. Il faut conserver cette discipline.
- Les rôles dynamiques en base existent, mais la source d'autorité applicative actuelle reste `backend/src/saas/permissions.ts`.

## 7. Risques pour CATALYSE

- confusion entre biens locatifs (`units`, `leases`, `tenants`) et biens à vendre si le modèle Ventes réutilise directement les mêmes statuts
- altération des dashboards Finance si les montants de vente sont injectés dans les rapports locatifs existants sans séparation fonctionnelle
- régression de permissions si `sales.*` est automatiquement accordé à des rôles existants
- activation involontaire du module dans la navigation si aucun feature flag strict n'est introduit
- pollution comptable si paiements de vente et paiements de loyer partagent des catégories sans séparation d'origine métier

## 8. Risques pour Magic Construction

- modèle plus orienté promotion/commercial pouvant nécessiter plusieurs types de biens (villas, terrains, bureaux, lots) que les entités locatives actuelles ne couvrent pas proprement
- risque de collision de numéros métier si les ventes réutilisent les mêmes séquences que baux/factures/paiements sans namespace dédié
- risque documentaire si contrats de vente et baux partagent sans isolation les mêmes templates/buckets/versions
- risque multi-devise plus fort si les ventes utilisent des modalités CDF/USD avec acomptes, remises et échéanciers personnalisés

## 9. Éléments réutilisables

### Frontend

- shell `AppLayout`
- navigation latérale regroupée par domaine
- guards `ProtectedRoute`, `PermissionGuard`, `PlatformRoute`
- `AuthContext` et sélection d'organisation
- `PageHeader`, `Modal`, `DataTable`
- patterns de listes/détails/modules déjà présents dans Finance, Stock, Personnel, Locataires
- exports Excel/XLSX

### Backend

- `DatabaseService.transaction`
- `RequestContext`
- `PermissionsGuard`
- `AuditInterceptor`
- pattern `organization_id + deleted_at`
- pattern de numéros métier protégés par `pg_advisory_xact_lock`
- génération documentaire via services `documents`
- pattern de relevés / statements existant
- paiement ventilé via `payment_allocations`
- crédit/remboursement déjà modélisés pour les locataires, réutilisables conceptuellement mais pas directement pour les acheteurs

## 10. Nouvelles tables proposées

> Noms conceptuels à aligner avec les conventions finales du dépôt au sprint V1.

### `sales_buyers`

- Objectif : référentiel acheteurs particuliers/entreprises
- Colonnes essentielles : `id`, `organization_id`, `buyer_type`, `full_name`, `company_name`, `phone`, `email`, `id_document_type`, `id_document_number`, `tax_number`, `address`, `status`, `notes`, `created_by`, `updated_by`, `deleted_at`, `deleted_by`
- Contraintes : index `(organization_id, status)`, unicité métier à préciser sur un identifiant stable si disponible
- Sensibilité : pièces d'identité, coordonnées, documents justificatifs

### `sales_projects`

- Objectif : programmes/projets commerciaux si la notion n'existe pas déjà
- Colonnes : `organization_id`, `name`, `code`, `description`, `status`, `currency`, `start_date`, `end_date`
- Contraintes : unique `(organization_id, code)`

### `sales_property_catalog`

- Objectif : couche commerciale séparée des `units`, pour exposer un bien vendable sans déformer l'entité locative
- Colonnes : `organization_id`, `project_id`, `building_id`, `unit_id`, `property_type`, `commercial_label`, `listing_status`, `base_price`, `currency`, `availability_status`, `metadata_json`
- Contraintes : unique `(organization_id, unit_id)` si un `unit_id` est lié

### `sales_reservations`

- Objectif : réservations commerciales
- Colonnes : `organization_id`, `reservation_number`, `buyer_id`, `catalog_property_id`, `status`, `reservation_amount`, `currency`, `start_date`, `expiration_date`, `extended_until`, `cancel_reason`, `converted_sale_id`
- Contraintes : unique `(organization_id, reservation_number)`
- Index : `(organization_id, status)`, `(organization_id, expiration_date)`

### `sales_contracts`

- Objectif : vente/souscription principale
- Colonnes : `organization_id`, `contract_number`, `buyer_id`, `catalog_property_id`, `reservation_id`, `contract_type`, `status`, `contract_date`, `currency`, `contract_price`, `discount_amount`, `fees_amount`, `down_payment_amount`, `balance_amount`, `cancelled_at`, `cancel_reason`
- Contraintes : unique `(organization_id, contract_number)`
- Risque : forte criticité métier et comptable

### `sales_contract_items`

- Objectif : décomposition financière d'un contrat
- Colonnes : `organization_id`, `contract_id`, `line_type`, `label`, `amount`, `currency`, `sort_order`

### `sales_schedules`

- Objectif : entête d'échéancier
- Colonnes : `organization_id`, `contract_id`, `schedule_mode`, `installments_count`, `first_due_date`, `status`, `generated_at`, `generated_by`, `regeneration_count`

### `sales_installments`

- Objectif : échéances individuelles
- Colonnes : `organization_id`, `schedule_id`, `contract_id`, `installment_number`, `due_date`, `expected_amount`, `paid_amount_cached`, `currency`, `status`, `late_days`, `penalty_amount`
- Contraintes : unique `(organization_id, contract_id, installment_number)`
- Note : `paid_amount_cached` doit être dérivé/reconcilié depuis les allocations valides

### `sales_payments`

- Objectif : paiements acheteur source
- Colonnes : `organization_id`, `payment_number`, `buyer_id`, `contract_id`, `payment_date`, `amount`, `currency`, `payment_method`, `reference`, `status`, `cash_movement_id`, `bank_transaction_id`, `receipt_document_id`, `idempotency_key`
- Contraintes : unique `(organization_id, payment_number)`
- Contraintes métier : somme allocations <= montant paiement

### `sales_payment_allocations`

- Objectif : ventilation d'un paiement sur plusieurs échéances
- Colonnes : `organization_id`, `payment_id`, `installment_id`, `amount_allocated`, `allocated_at`, `deleted_at`, `deleted_by`
- Index : `(organization_id, payment_id)`, `(organization_id, installment_id)`

### `sales_buyer_credits`

- Objectif : avoirs/crédits acheteur
- Colonnes : `organization_id`, `buyer_id`, `source_payment_id`, `contract_id`, `currency`, `original_amount`, `remaining_amount`, `status`

### `sales_refunds`

- Objectif : remboursements acheteur
- Colonnes : `organization_id`, `buyer_credit_id`, `buyer_id`, `amount`, `currency`, `refund_date`, `payment_method`, `reference`, `cash_movement_id`, `bank_transaction_id`, `status`

### `sales_documents`

- Objectif : documents du domaine ventes
- Colonnes : `organization_id`, `contract_id`, `reservation_id`, `buyer_id`, `document_type`, `file_name`, `storage_path`, `mime_type`, `version_number`, `signature_status`, `uploaded_by`

### `sales_reminders`

- Objectif : relances commerciales/recouvrement ventes
- Colonnes : `organization_id`, `contract_id`, `installment_id`, `buyer_id`, `channel`, `status`, `sent_at`, `template_code`, `payload_json`

### `sales_status_history`

- Objectif : traçabilité statutaire
- Colonnes : `organization_id`, `entity_type`, `entity_id`, `from_status`, `to_status`, `changed_by`, `changed_at`, `reason`

### `sales_settings`

- Objectif : paramètres métier du module par organisation
- Colonnes : `organization_id`, `default_currency`, `default_down_payment_rate`, `reservation_duration_days`, `penalty_rules_json`, `numbering_rules_json`, `contract_template_config_json`
- Contrainte : unique `(organization_id)`

### `sales_audit_events`

- Objectif : audit fin du domaine ventes si `audit_logs` générique ne suffit pas
- Colonnes : `organization_id`, `entity_type`, `entity_id`, `event_type`, `metadata_json`, `created_by`, `created_at`

## 11. Endpoints proposés

> Proposition conceptuelle seulement, non implémentée.

- `GET /sales/dashboard`
- `GET /sales/projects`
- `POST /sales/projects`
- `GET /sales/properties`
- `POST /sales/properties`
- `GET /sales/buyers`
- `POST /sales/buyers`
- `GET /sales/buyers/:id`
- `GET /sales/reservations`
- `POST /sales/reservations`
- `POST /sales/reservations/:id/extend`
- `POST /sales/reservations/:id/cancel`
- `POST /sales/reservations/:id/convert`
- `GET /sales/contracts`
- `POST /sales/contracts`
- `GET /sales/contracts/:id`
- `POST /sales/contracts/:id/cancel`
- `POST /sales/contracts/:id/schedule/regenerate`
- `GET /sales/contracts/:id/statement`
- `POST /sales/payments`
- `POST /sales/payments/:id/cancel`
- `POST /sales/credits/:id/refund`
- `GET /sales/reports/aging`
- `GET /sales/reports/recovery`
- `GET /sales/reports/export`
- `GET /sales/documents/:id/download`

## 12. Permissions proposées

En cohérence avec le schéma actuel `resource.action` :

- `sales.view`
- `sales.create`
- `sales.update`
- `sales.cancel`
- `sales.settings.manage`
- `sales.properties.view`
- `sales.properties.manage`
- `sales.buyers.view`
- `sales.buyers.manage`
- `sales.reservations.view`
- `sales.reservations.create`
- `sales.reservations.update`
- `sales.reservations.cancel`
- `sales.contracts.view`
- `sales.contracts.create`
- `sales.contracts.update`
- `sales.contracts.cancel`
- `sales.schedules.view`
- `sales.schedules.manage`
- `sales.payments.view`
- `sales.payments.create`
- `sales.payments.cancel`
- `sales.documents.view`
- `sales.documents.manage`
- `sales.recovery.view`
- `sales.recovery.manage`
- `sales.reports.view`
- `sales.reports.export`

Remarque : le dépôt actuel privilégie déjà le format `resource.action`. Une variante encore plus homogène serait de nommer le domaine `sales_*` ou `sales.resource.action`, mais la première option ci-dessus reste lisible et cohérente.

## 13. Feature flag proposé

Aucun mécanisme de feature flag n'a été observé dans le code inspecté.

### Recommandation

Introduire un mécanisme dédié, additif, et **séparé** des permissions :

- table future recommandée : `organization_modules` ou `organization_feature_flags`
- colonnes conceptuelles : `organization_id`, `module_code`, `is_enabled`, `enabled_at`, `enabled_by`
- contrainte : unique `(organization_id, module_code)`

### Politique recommandée

- `SALES` désactivé par défaut pour toutes les organisations
- activation explicite par organisation uniquement
- contrôle backend obligatoire avant toute route/module ventes
- contrôle frontend secondaire pour masquer navigation et routes
- aucune permission `sales.*` n'accorde à elle seule l'accès si le module n'est pas activé
- aucun rôle existant CATALYSE ou Magic Construction modifié automatiquement

Pourquoi ne pas surcharger `reference_data` :

- `reference_data` existe, mais il est conçu comme référentiel applicatif, pas comme drapeau d'activation critique
- pour un module aussi sensible, un stockage dédié est plus sûr, plus lisible et plus contrôlable

## 14. Stratégie de migration

### Séquence recommandée

1. audit et sauvegarde
2. migrations additives uniquement
3. backend `sales` livré mais inactif par feature flag
4. tests isolation multi-tenant backend
5. frontend livré avec routes/navigation masquées
6. activation sur organisation sandbox dédiée
7. non-régression CATALYSE
8. non-régression Magic Construction
9. activation pilote sur une seule organisation
10. observation logs/audit
11. activation progressive éventuelle

### Principes clés

- jamais de réutilisation destructive des tables locatives pour les ventes
- jamais de migration qui transforme des baux en ventes
- jamais de suppression de colonnes existantes
- séparation stricte des documents de vente et des contrats de bail
- séparation stricte des paiements de vente et des paiements de loyer, même si les flux comptables réutilisent caisse/banque

## 15. Stratégie de retour arrière

- désactivation immédiate du feature flag `SALES`
- routes frontend invisibles sans redeploiement destructif si le flag est lu côté backend et renvoyé au frontend
- conservation des migrations additives sans rollback destructif à chaud
- isolation des nouvelles écritures dans des tables `sales_*` uniquement
- logs d'audit permettant d'identifier toute écriture pilote
- aucun impact sur modules historiques si le module Ventes n'écrit pas dans les tables locatives existantes hors liaisons contrôlées

## 16. Plan de sprints

### V0 — audit et architecture

- Backend : audit modules, auth, multi-tenant, finance
- Frontend : audit shell, routing, permissions
- DB : audit schémas, conventions, migrations
- Tests : contrôles non destructifs uniquement
- Risques : mauvaise réutilisation d'entités locatives
- Validation : rapport V0 complet

### V1 — fondations DB, permissions et feature flag

- Backend : module `sales` minimal + guards + feature flag
- Frontend : navigation masquée + placeholders sous flag
- DB : tables fondation `sales_*` + `organization_modules`
- Tests : isolation org, permissions, flag off par défaut
- Risques : activation accidentelle
- Validation : module inaccessible sans flag

### V2 — catalogue commercial et biens à vendre

- Backend : projets, catalogue commercial, disponibilité
- Frontend : listes/filtres catalogue
- DB : `sales_projects`, `sales_property_catalog`
- Tests : cohérence avec buildings/units
- Risques : collision avec gestion locative
- Validation : lecture/édition catalogue sans impact baux

### V3 — acheteurs et réservations

- Backend : buyers, reservations
- Frontend : fiches acheteurs, réservations
- DB : `sales_buyers`, `sales_reservations`
- Tests : expiration, prolongation, annulation
- Risques : données sensibles acheteur
- Validation : réservation traçable et isolée

### V4 — ventes et souscriptions

- Backend : contrats de vente
- Frontend : création/consultation contrat
- DB : `sales_contracts`, `sales_contract_items`
- Tests : conversion réservation → vente
- Risques : numéros métier / annulation
- Validation : contrat stable, historique complet

### V5 — échéanciers

- Backend : génération contrôlée des échéanciers
- Frontend : vue planning / échéances
- DB : `sales_schedules`, `sales_installments`
- Tests : échéances libres et mensuelles
- Risques : recalcul destructif
- Validation : régénération auditée

### V6 — paiements et allocations

- Backend : paiements, allocations, crédits, remboursements
- Frontend : saisie et détail paiement
- DB : `sales_payments`, `sales_payment_allocations`, `sales_buyer_credits`, `sales_refunds`
- Tests : invariants comptables, transactionnalité
- Risques : corruption financière
- Validation : somme allocations <= paiement

### V7 — créances et recouvrement

- Backend : balance âgée, retards, relances
- Frontend : suivi recouvrement
- DB : `sales_reminders`, vues/agrégats
- Tests : montants attendus / encaissés / restants
- Risques : mauvais calcul multi-devise
- Validation : rapports cohérents USD/CDF séparés

### V8 — documents et relevés

- Backend : génération contrats, relevés, pièces acheteur
- Frontend : téléchargement / consultation
- DB : `sales_documents`
- Tests : stockage, versions, signature
- Risques : confusion avec contrats de bail
- Validation : buckets/paths séparés

### V9 — rapports et paramètres

- Backend : tableaux de bord, exports, settings ventes
- Frontend : reporting métier
- DB : `sales_settings`
- Tests : exports, filtres, sécurité
- Risques : exposition inter-organisations
- Validation : rapports bornés à l'organisation

### V10 — intégration Stitch et responsive

- Backend : aucun changement majeur
- Frontend : intégration design validé
- DB : aucune nouvelle contrainte majeure
- Tests : UX desktop/tablette/mobile web
- Risques : divergence shell existant
- Validation : shell actuel conservé

### V11 — stabilisation, sécurité et déploiement pilote

- Backend : hardening, logs, audit
- Frontend : non-régression finale
- DB : revue indexes/perf
- Tests : sandbox + pilote + prod protégée
- Risques : activation trop large
- Validation : pilote contrôlé, rollback prêt

## 17. Questions métier encore ouvertes

- un `unit` peut-il être à la fois louable et vendable, ou faut-il une abstraction produit indépendante ?
- faut-il gérer la vente de biens non locatifs (terrain, villa autonome, bureau hors immeuble) sans `unit_id` ?
- une réservation expire-t-elle automatiquement ou après validation manuelle ?
- la réservation doit-elle générer un reçu, une facture, ou seulement un encaissement ?
- l'acompte initial doit-il toujours créer une échéance dédiée ?
- la cession de contrat de vente entre acheteurs est-elle un vrai flux métier du MVP ?
- comment distinguer comptablement un paiement de vente d'un paiement locatif dans les caisses/banques et rapports consolidés ?
- les documents de vente devront-ils être Word + PDF, comme les contrats de bail actuels ?
- existe-t-il des règles réglementaires spécifiques RDC sur annulation, remboursement, pénalités et conservation des pièces ?

## 18. Verdict GO / NO-GO pour V1

### Verdict

`GO` pour V1.

### Conditions impératives

- module `sales` séparé et additif
- feature flag `SALES` désactivé par défaut
- aucune activation automatique pour CATALYSE ou Magic Construction
- aucune réutilisation directe des entités locatives comme entités de vente
- aucune modification implicite des rôles existants
- migrations additives uniquement
- tests d'isolation multi-tenant obligatoires avant toute activation pilote

### Motif

L'architecture actuelle fournit déjà :

- une authentification multi-tenant robuste
- une base modulaire exploitable
- des patterns financiers/documentaires réutilisables
- un audit trail
- un shell frontend stable

Le principal risque n'est pas technique mais de **modélisation** : si la vente est forcée à rentrer dans les objets de location existants, la régression fonctionnelle et comptable deviendra probable.

## Fichiers inspectés

### Git / structure

- `package.json`
- `frontend/package.json`
- `backend/package.json`
- `docs/roles-permissions.md`
- `database/schema.sql`
- `database/saas_v1.sql`
- `database/supabase_schema.sql`
- `database/20260713_user_organizations.sql`

### Frontend

- `frontend/src/app/App.tsx`
- `frontend/src/app/config.ts`
- `frontend/src/app/providers.tsx`
- `frontend/src/app/router.tsx`
- `frontend/src/core/layout/AppLayout.tsx`
- `frontend/src/core/layout/Sidebar.tsx`
- `frontend/src/core/layout/Topbar.tsx`
- `frontend/src/core/layout/PageHeader.tsx`
- `frontend/src/core/layout/PlatformLayout.tsx`
- `frontend/src/core/api/axios.ts`
- `frontend/src/core/api/api.types.ts`
- `frontend/src/core/auth/AuthContext.tsx`
- `frontend/src/core/auth/auth.service.ts`
- `frontend/src/core/auth/ProtectedRoute.tsx`
- `frontend/src/core/auth/PermissionGuard.tsx`
- `frontend/src/core/auth/PlatformRoute.tsx`
- `frontend/src/core/components/Modal.tsx`
- `frontend/src/core/components/DataTable.tsx`
- `frontend/src/core/utils/exportExcel.ts`
- `frontend/src/core/utils/exportXlsx.ts`

### Backend

- `backend/src/app.module.ts`
- `backend/src/auth/auth.controller.ts`
- `backend/src/auth/organization-access.service.ts`
- `backend/src/auth/request-context.ts`
- `backend/src/auth/request-context.interceptor.ts`
- `backend/src/auth/permissions.guard.ts`
- `backend/src/auth/audit.interceptor.ts`
- `backend/src/database/database.service.ts`
- `backend/src/saas/permissions.ts`
- `backend/src/saas/saas.controllers.ts`
- `backend/src/documents/document-renderer.service.ts`
- `backend/src/documents/document-storage.service.ts`
- `backend/src/payments/payments.controller.ts`
- `backend/src/payments/payments.service.ts`
- `backend/src/invoices/invoices.controller.ts`
- `backend/src/invoices/invoices.service.ts`
- `backend/src/dashboard/dashboard.service.ts`
- `backend/src/buildings/buildings.service.ts`
- `backend/src/units/units.service.ts`
- `backend/src/tenants/tenants.service.ts`

## Références Stitch

Aucune référence Stitch trouvée dans le dépôt audité :

- pas de `stitch-reference-sales`
- pas de `stitch-reference`
- pas de `design-reference`
- pas des archives nommées `7e4cd76e-41dd-4e50-b3a3-72c11bf6fc35.zip` ou `194b3064-bbe2-409a-9f71-f9bcbe5e7661.zip`

L'absence de ces références ne bloque pas V0, mais bloque la conception visuelle finale des écrans Ventes.
