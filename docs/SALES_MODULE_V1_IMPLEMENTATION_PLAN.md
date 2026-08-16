# PHASE V1.0 — PLAN D'IMPLEMENTATION DES FONDATIONS DU MODULE VENTES

Date: 2026-08-15
Projet: Property ERP SaaS
Portée: plan d'implémentation uniquement
Statut: prêt pour exécution contrôlée

## 1. Objectif de V1

V1 doit poser les fondations techniques du module Ventes immobilières sans déployer encore tout le cycle métier complet. L'objectif est de préparer un module multi-tenant, activable par organisation, compatible avec l'architecture existante, et extensible vers les réservations, contrats, échéanciers, encaissements, relances, documents et reporting.

Cette phase ne doit pas :

- casser Auth, Patrimoine, Locataires, Baux, Finance, Maintenance, Personnel ou Rapports ;
- réutiliser de manière ambiguë les tables locatives existantes comme si elles étaient des tables ventes ;
- créer une dépendance forte entre le module Ventes et `saas.service.ts` ;
- déployer de migration destructive ;
- modifier des données de production.

## 2. Décisions finales d'architecture

### 2.1 Activation modulaire par organisation

Choix final retenu : **table dédiée `organization_modules`**.

Raison :

- plus propre qu'un booléen ajouté à `organizations` ;
- extensible à d'autres modules futurs ;
- compatible avec une logique de feature flag par organisation ;
- permet audit, dates d'activation, désactivation et pilotage commercial ;
- évite de multiplier les colonnes techniques dans `organizations`.

Structure cible V1 :

- `organization_id`
- `module_code`
- `is_enabled`
- `enabled_at`
- `disabled_at`
- `enabled_by`
- `disabled_by`
- `created_at`
- `updated_at`

Contrainte logique :

- unicité sur (`organization_id`, `module_code`)
- `module_code = 'sales'` pour ce module en V1

### 2.2 Modélisation du catalogue commercial

Choix final retenu : **catalogue commercial indépendant avec références optionnelles vers le patrimoine**.

Concrètement :

- une entité commerciale `sales_property_catalog` représente l'objet vendable ;
- elle peut référencer un `building_id` et/ou un `unit_id` existants ;
- elle peut aussi exister sans lien direct immédiat si le produit commercial est préparé avant rattachement final ;
- le statut commercial reste propre au module Ventes ;
- le patrimoine locatif existant n'est pas détourné pour porter des champs commerciaux.

Ce choix évite :

- de polluer `units` avec des champs de vente spécifiques ;
- de mélanger cycle locatif et cycle de vente ;
- de dépendre d'une structure patrimoine qui peut évoluer pour d'autres usages.

## 3. Tables V1 retenues

Les tables suivantes sont retenues pour V1.

### 3.1 `organization_modules`

Rôle :

- activer ou non le module Ventes par organisation ;
- servir de garde technique côté backend et frontend.

### 3.2 `sales_settings`

Rôle :

- stocker les paramètres métier par organisation ;
- devises par défaut ;
- préfixes de références ;
- règles documentaires ;
- options de réservation et d'échéancier.

Champs indicatifs :

- `organization_id`
- `default_currency`
- `secondary_currency`
- `quotation_prefix`
- `reservation_prefix`
- `contract_prefix`
- `receipt_prefix`
- `invoice_prefix`
- `settings_json`
- `created_at`
- `updated_at`

### 3.3 `sales_buyers`

Rôle :

- stocker les acquéreurs du module Ventes ;
- séparer clairement acquéreur et locataire ;
- préparer les dossiers individuels ou société.

Champs indicatifs :

- `organization_id`
- `buyer_type`
- `full_name`
- `company_name`
- `phone`
- `email`
- `id_number`
- `tax_number`
- `address`
- `city`
- `country`
- `notes`
- `status`
- `created_by`
- `updated_by`
- `deleted_at`
- `deleted_by`

### 3.4 `sales_projects`

Rôle :

- regrouper programmes, tranches, opérations ou ensembles commerciaux ;
- préparer la lecture par projet avant même les transactions.

Champs indicatifs :

- `organization_id`
- `code`
- `name`
- `description`
- `building_id` optionnel
- `status`
- `launch_date`
- `closing_date`
- `currency`
- `created_by`
- `updated_by`
- `deleted_at`

### 3.5 `sales_property_catalog`

Rôle :

- référencer les lots, appartements, villas, parcelles ou locaux vendables ;
- conserver les données commerciales propres ;
- rattacher optionnellement le bien à `buildings` ou `units`.

Champs indicatifs :

- `organization_id`
- `project_id`
- `building_id` nullable
- `unit_id` nullable
- `reference`
- `title`
- `property_type`
- `commercial_status`
- `surface_area`
- `bedrooms`
- `floor_label`
- `list_price`
- `minimum_price`
- `currency`
- `is_published`
- `availability_date`
- `metadata_json`
- `created_by`
- `updated_by`
- `deleted_at`

### 3.6 `sales_audit_events` optionnelle mais recommandée

Rôle :

- journal applicatif spécifique au module Ventes ;
- complément lisible des `audit_logs` existants ;
- utile pour diagnostic métier sans surcharger les audits globaux.

Si la création est jugée trop ambitieuse pour la toute première sous-phase, elle peut être reportée, mais le plan recommande sa préparation dès V1.

## 4. Permissions retenues

Permissions V1 retenues :

- `sales.read`
- `sales.admin`
- `sales.settings.read`
- `sales.settings.update`
- `sales_buyers.read`
- `sales_buyers.create`
- `sales_buyers.update`
- `sales_buyers.delete`
- `sales_projects.read`
- `sales_projects.create`
- `sales_projects.update`
- `sales_projects.delete`
- `sales_catalog.read`
- `sales_catalog.create`
- `sales_catalog.update`
- `sales_catalog.delete`
- `sales_reservations.read`
- `sales_reservations.create`
- `sales_reservations.update`
- `sales_reservations.cancel`
- `sales_contracts.read`
- `sales_contracts.create`
- `sales_contracts.update`
- `sales_contracts.approve`
- `sales_schedules.read`
- `sales_schedules.create`
- `sales_schedules.update`
- `sales_payments.read`
- `sales_payments.create`
- `sales_payments.allocate`
- `sales_recovery.read`
- `sales_recovery.create`
- `sales_documents.read`
- `sales_documents.create`
- `sales_documents.download`
- `sales_reports.read`

Principe :

- granularité proche du modèle existant ;
- capacité future d'exposer le module seulement à certains rôles ;
- possibilité d'attribuer un pack initial minimal puis d'affiner par rôle.

## 5. Fichiers futurs à créer ou modifier

## 5.1 Backend

Créations prévues :

- `C:\Users\Esther\Documents\ERP IMMO PROTO\backend\src\sales\sales.module.ts`
- `C:\Users\Esther\Documents\ERP IMMO PROTO\backend\src\sales\sales.controller.ts`
- `C:\Users\Esther\Documents\ERP IMMO PROTO\backend\src\sales\sales.service.ts`
- `C:\Users\Esther\Documents\ERP IMMO PROTO\backend\src\sales\sales.repository.ts`
- `C:\Users\Esther\Documents\ERP IMMO PROTO\backend\src\sales\types.ts`
- `C:\Users\Esther\Documents\ERP IMMO PROTO\backend\src\sales\dto\create-sales-buyer.dto.ts`
- `C:\Users\Esther\Documents\ERP IMMO PROTO\backend\src\sales\dto\update-sales-buyer.dto.ts`
- `C:\Users\Esther\Documents\ERP IMMO PROTO\backend\src\sales\dto\create-sales-project.dto.ts`
- `C:\Users\Esther\Documents\ERP IMMO PROTO\backend\src\sales\dto\update-sales-project.dto.ts`
- `C:\Users\Esther\Documents\ERP IMMO PROTO\backend\src\sales\dto\create-sales-catalog-item.dto.ts`
- `C:\Users\Esther\Documents\ERP IMMO PROTO\backend\src\sales\dto\update-sales-catalog-item.dto.ts`
- `C:\Users\Esther\Documents\ERP IMMO PROTO\backend\src\sales\organization-modules.service.ts`
- `C:\Users\Esther\Documents\ERP IMMO PROTO\backend\src\sales\guards\sales-module-enabled.guard.ts`
- `C:\Users\Esther\Documents\ERP IMMO PROTO\backend\src\sales\decorators\sales-module-enabled.decorator.ts`

Modifications prévues :

- `C:\Users\Esther\Documents\ERP IMMO PROTO\backend\src\app.module.ts`
- `C:\Users\Esther\Documents\ERP IMMO PROTO\backend\src\saas\permissions.ts`

## 5.2 Frontend

Créations prévues :

- `C:\Users\Esther\Documents\ERP IMMO PROTO\frontend\src\modules\sales\pages\SalesHomePage.tsx`
- `C:\Users\Esther\Documents\ERP IMMO PROTO\frontend\src\modules\sales\pages\SalesBuyersPage.tsx`
- `C:\Users\Esther\Documents\ERP IMMO PROTO\frontend\src\modules\sales\pages\SalesProjectsPage.tsx`
- `C:\Users\Esther\Documents\ERP IMMO PROTO\frontend\src\modules\sales\pages\SalesCatalogPage.tsx`
- `C:\Users\Esther\Documents\ERP IMMO PROTO\frontend\src\modules\sales\api\sales.api.ts`
- `C:\Users\Esther\Documents\ERP IMMO PROTO\frontend\src\modules\sales\types.ts`
- `C:\Users\Esther\Documents\ERP IMMO PROTO\frontend\src\modules\sales\components\SalesModuleGuard.tsx`

Modifications prévues :

- `C:\Users\Esther\Documents\ERP IMMO PROTO\frontend\src\app\router.tsx`
- `C:\Users\Esther\Documents\ERP IMMO PROTO\frontend\src\core\layout\Sidebar.tsx`
- `C:\Users\Esther\Documents\ERP IMMO PROTO\frontend\src\core\auth\AuthContext.tsx`
- `C:\Users\Esther\Documents\ERP IMMO PROTO\frontend\src\core\api\api.types.ts`

## 5.3 Documentation

Références à conserver :

- `C:\Users\Esther\Documents\ERP IMMO PROTO\docs\SALES_MODULE_V0_AUDIT.md`
- `C:\Users\Esther\Documents\ERP IMMO PROTO\docs\SALES_MODULE_V1_IMPLEMENTATION_PLAN.md`

Références visuelles futures hors bundle :

- `C:\Users\Esther\Documents\ERP IMMO PROTO\stitch-reference-sales\`

Ce dossier doit rester ignoré par Git et ne pas être importé dans le code applicatif.

## 6. Migrations futures

Migrations futures prévues :

- `C:\Users\Esther\Documents\ERP IMMO PROTO\database\20260815_organization_modules.sql`
- `C:\Users\Esther\Documents\ERP IMMO PROTO\database\20260815_sales_v1_foundations.sql`

Contenu attendu de la première :

- création de `organization_modules`
- index et contraintes
- seed idempotent éventuel des permissions Ventes

Contenu attendu de la seconde :

- création de `sales_settings`
- création de `sales_buyers`
- création de `sales_projects`
- création de `sales_property_catalog`
- création éventuelle de `sales_audit_events`
- index multi-tenant et clés étrangères

Règles d'écriture :

- SQL additif ;
- compatible PostgreSQL ;
- idempotence si possible ;
- pas de drop destructif ;
- pas de migration métier locative impactée.

## 7. Stratégie d'implémentation recommandée

Ordre recommandé :

1. créer `organization_modules` et les permissions ;
2. créer le module backend `sales` avec garde d'activation ;
3. exposer un endpoint minimal `GET /sales/health` ou `GET /sales/bootstrap` protégé ;
4. créer les tables fondation V1 ;
5. exposer CRUD minimal Buyers, Projects et Catalog ;
6. ajouter les routes frontend et les guards ;
7. brancher le menu latéral seulement si module actif + permission ;
8. terminer par tests de non-régression inter-modules.

Ce séquencement réduit le risque de casser les parcours existants tout en gardant un découpage lisible.

## 8. Stratégie de rollback

Rollback recommandé :

- ne pas supprimer les tables nouvellement créées en cas d'incident initial ;
- désactiver le module via `organization_modules.is_enabled = false` ;
- retirer temporairement les routes/frontend de navigation si nécessaire ;
- conserver les migrations comme historique auditables ;
- revenir à un état neutre sans perte de données.

Le rollback doit être **fonctionnel**, pas destructif.

## 9. Matrice de tests recommandée

## 9.1 Tests backend

- activation module désactivé -> accès refusé ;
- activation module activé + permission absente -> accès refusé ;
- activation module activé + permission présente -> accès autorisé ;
- isolement strict par `organization_id` ;
- impossibilité d'accéder aux acheteurs/projets/catalogues d'une autre organisation ;
- compatibilité des rôles existants ;
- non-régression `PermissionsGuard` ;
- non-régression `RequestContext`.

## 9.2 Tests frontend

- module non activé -> aucun menu Ventes ;
- module activé sans permission -> menu masqué ou page interdite ;
- module activé avec permission -> menu visible ;
- changement d'organisation -> recalcul des modules et permissions ;
- navigation web intacte pour Patrimoine, Locataires, Baux, Finance, Maintenance, Personnel, Rapports ;
- absence de crash si le module Ventes n'est pas encore entièrement configuré.

## 9.3 Tests de données

- organisation sandbox dédiée Ventes ;
- organisation CATALYSE sans contamination croisée ;
- organisation Magic Construction sans régression ;
- vérification des devises et montants ;
- soft delete cohérent ;
- audit des créations/modifications.

## 10. Risques bloquants

Risques principaux :

- réutilisation abusive des tables `tenants`, `leases` ou `units` comme socle direct des ventes ;
- garde de module absente côté backend, laissant apparaître un module inactif ;
- permissions créées sans stratégie d'attribution contrôlée ;
- confusion entre encaissements locatifs et encaissements de vente ;
- polymorphisme trop complexe dès V1 ;
- dépendance trop forte à `saas.service.ts` ;
- exposition frontend avant activation réelle du module ;
- Stitch intégré trop tôt comme source de code au lieu de simple référence visuelle.

## 11. Verdict GO / NO-GO

Verdict : **GO** pour implémenter V1, sous réserve des garde-fous suivants :

- module activable par `organization_modules` ;
- catalogue commercial indépendant du patrimoine locatif ;
- migrations additives uniquement ;
- garde backend obligatoire avant exposition UI ;
- aucun couplage destructif avec les modules existants ;
- exécution par sous-phases courtes avec validation après chaque étape.

Le projet est techniquement prêt pour une V1 fondation, mais il ne faut pas sauter directement au cycle complet de vente sans passer par ces fondations.

## 12. Résumé exécutif

- choix final table module : `organization_modules`
- choix final modélisation commerciale : `sales_property_catalog` indépendant avec liens optionnels vers `buildings` et `units`
- tables V1 retenues : `organization_modules`, `sales_settings`, `sales_buyers`, `sales_projects`, `sales_property_catalog`, `sales_audit_events` optionnelle recommandée
- permissions retenues : famille `sales.*`, `sales_buyers.*`, `sales_projects.*`, `sales_catalog.*`, `sales_reservations.*`, `sales_contracts.*`, `sales_schedules.*`, `sales_payments.*`, `sales_recovery.*`, `sales_documents.*`, `sales_reports.*`
- migrations futures : `20260815_organization_modules.sql`, `20260815_sales_v1_foundations.sql`
- rollback : désactivation fonctionnelle du module, sans destruction des tables
- test matrix : backend, frontend, multi-tenant, permissions, non-régression transverse
- risques bloquants : couplage locatif, absence de garde module, confusion des flux financiers, sur-complexité prématurée
- décision : GO contrôlé
