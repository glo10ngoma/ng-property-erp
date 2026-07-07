# Property ERP Prototype V1

Prototype local haut de gamme pour la gestion immobiliere: buildings, appartements, locataires, factures, paiements et impression de factures.

## Stack

- Backend: NestJS, TypeScript, PostgreSQL local
- Frontend: React, Vite, TypeScript, React Router, Axios
- Database: scripts SQL locaux dans `database/`

## Prerequis

- Node.js 20+
- npm
- PostgreSQL 15+

## Installation PostgreSQL

1. Installer PostgreSQL localement.
2. Creer une base:

```bash
createdb property_erp
```

3. Importer le schema:

```bash
psql -d property_erp -f database/schema.sql
```

4. Importer les donnees de demo:

```bash
psql -d property_erp -f database/seed.sql
```

Sur Windows, si `psql` n'est pas disponible dans le PATH, utiliser le chemin complet installe par PostgreSQL:

```powershell
$env:PGPASSWORD='postgres'
& 'C:\Program Files\PostgreSQL\18\bin\createdb.exe' -U postgres -h 127.0.0.1 -p 5433 property_erp
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -U postgres -h 127.0.0.1 -p 5433 -d property_erp -f database\schema.sql
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -U postgres -h 127.0.0.1 -p 5433 -d property_erp -f database\seed.sql
```

Pour une base deja existante, appliquer aussi les migrations incrementales utiles:

```powershell
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -U postgres -h 127.0.0.1 -p 5433 -d property_erp -f database\20260707_building_type.sql
```

## Corrections UX V1

- Les listes affichent tous les resultats dans une zone defilante, sans pagination 10/25/50/100 visible.
- Les entetes de tableaux restent figes via les conteneurs `table-wrap`.
- Les rapports immeuble et situation locataire sont des pages dediees: `/buildings/:id/report` et `/tenants/:id/situation`.
- Les tableaux separent les colonnes `Montant` et `Devise`; les cartes KPI peuvent rester compactes.
- La creation d'un bail se fait sur `/leases/new`, avec sections metier et champ contrat pret pour Supabase Storage bucket `contracts`.
- Les immeubles portent maintenant un `building_type`; appliquer `database/20260707_building_type.sql` sur les bases existantes.

## Demo enterprise

Un seed de demonstration plus credible est disponible:

```sql
database/demo_enterprise_seed.sql
```

Il prepare l'organisation `NG ERP Demo Property` avec immeubles, unites, locataires, baux, garanties, factures, paiements, caisse, personnel, stock, maintenance, workflows, notifications et communications simulees.

Les comptes enterprise utilisent le mot de passe `demo` avec hash `scrypt`:

- `admin@ng-erp-demo.local`
- `comptable@ng-erp-demo.local`
- `agent@ng-erp-demo.local`
- `directeur@ng-erp-demo.local`

Les comptes historiques `@property-erp.local` restent supportes par les seeds standards.

## Variables d'environnement

Copier `backend/.env.example` vers `backend/.env`, puis ajuster:

```env
PORT=3000
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/property_erp
FRONTEND_URL=http://127.0.0.1:5173,http://localhost:5173
```

Copier `frontend/.env.example` vers `frontend/.env`, puis ajuster si besoin:

```env
VITE_API_URL=http://localhost:3000
```

## Installation

```bash
npm run install:all
```

## Lancement

Terminal 1:

```bash
npm run dev:backend
```

Terminal 2:

```bash
npm run dev:frontend
```

Frontend: `http://localhost:5173`

Backend: `http://localhost:3000`

## Build

```bash
npm run build
```

## Fonctionnalites incluses

- Dashboard financier et operationnel
- CRUD buildings
- CRUD appartements
- CRUD locataires
- Creation et detail des factures avec lignes dynamiques
- Calcul automatique des totaux
- Enregistrement des paiements
- Mise a jour automatique du statut facture: `UNPAID`, `PARTIAL`, `PAID`
- Page facture imprimable professionnelle
- Fondations SaaS V1: utilisateurs, roles, permissions, personnel, caisse, stock, baux, rapports avances
- Migration SaaS locale: `database/saas_v1.sql`
- Preparation Supabase Storage: bucket cible `lease-contracts`
- Preparation Railway/Vercel via variables d'environnement

## Notes prototype

La version courante reste executable localement, mais elle contient maintenant les fondations de la V1 SaaS client. Les credentials Supabase/Railway/Vercel ne sont pas inclus et doivent etre ajoutes dans les `.env` de deploiement.

## Roadmap Codex

Le plan de livraison par sprints est documente dans `docs/codex-sprints.md`.

## Migration SaaS V1

Appliquer apres `schema.sql` et `seed.sql`:

```powershell
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -U postgres -h 127.0.0.1 -p 5433 -d property_erp -f database\saas_v1.sql
```

Puis appliquer la stabilisation Core Sprint 1:

```powershell
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -U postgres -h 127.0.0.1 -p 5433 -d property_erp -f database\sprint1_core.sql
```

Sprint 1 ajoute l'isolation SaaS par `organization_id`, les tables RBAC, les audit logs et le soft delete sur les tables metier principales. Dans le modele existant, `tenant_id` reste le locataire metier.

Puis appliquer le modele Bail Sprint 2:

```powershell
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -U postgres -h 127.0.0.1 -p 5433 -d property_erp -f database\sprint2_leases.sql
```

Sprint 2 place le bail au centre du modele: `rental_units` et `tenant_people` exposent les entites metier, `lease_guarantees` porte la garantie locative, et `lease_documents` porte les documents du bail.

Puis appliquer le flux financier Sprint 3:

```powershell
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -U postgres -h 127.0.0.1 -p 5433 -d property_erp -f database\sprint3_finance.sql
```

Sprint 3 ajoute les allocations de paiement, les recus, les statuts financiers enrichis et la synthese facture/paiement basee sur `payment_allocations`.

Sprint 4 ne necessite pas de migration SQL. Il stabilise les rapports BI prioritaires: dashboard rapports, immeuble, locataire, paiements par periode, disponibilite, impayes et exports CSV/Excel.

Puis appliquer la stabilisation Personnel / Paie Sprint 5:

```powershell
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -U postgres -h 127.0.0.1 -p 5433 -d property_erp -f database\sprint5_staff_payroll.sql
```

Sprint 5 normalise les statuts RH, ajoute l'unicite paie employe/mois et stabilise les flux employe, avance, conge, paie et sorties caisse associees.

Puis appliquer le module Stock Enterprise Sprint 6:

```powershell
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -U postgres -h 127.0.0.1 -p 5433 -d property_erp -f database\sprint6_stock_enterprise.sql
```

Sprint 6 ajoute les categories stock, codes articles, champs ERP generiques, quantites avant/apres dans les mouvements, inventaires enrichis et rapports de valorisation.

Puis appliquer le workflow Maintenance Enterprise Sprint 7:

```powershell
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -U postgres -h 127.0.0.1 -p 5433 -d property_erp -f database\sprint7_maintenance_enterprise.sql
```

Sprint 7 ajoute les demandes maintenance, categories, assignations, timeline, documents, depenses, SLA, rapports et le cycle complet jusqu'a cloture.

Puis appliquer le moteur Workflow Sprint 8:

```powershell
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -U postgres -h 127.0.0.1 -p 5433 -d property_erp -f database\sprint8_workflow_engine.sql
```

Sprint 8 ajoute le moteur d'approbation generique, les validations direction, la page Workflows et les integrations caisse, avances, conges et maintenance.

Sprint 9 ne necessite pas de migration SQL. Il transforme le Centre d'Activite en cockpit quotidien et redirige l'utilisateur vers `/activity` apres connexion. Le Dashboard reste disponible comme tableau de bord BI.

Puis appliquer le module Communication Sprint 10:

```powershell
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -U postgres -h 127.0.0.1 -p 5433 -d property_erp -f database\sprint10_communications.sql
```

Sprint 10 ajoute les notifications internes, les modeles de messages, les logs email/SMS/WhatsApp, les envois simules en local et la page `/communications`. Les notifications critiques sont remontees dans le Centre d'Activite.

Puis appliquer le module Parametrage & Administration Sprint 11:

```powershell
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -U postgres -h 127.0.0.1 -p 5433 -d property_erp -f database\sprint11_settings_admin.sql
```

Sprint 11 ajoute les parametres entreprise/impression, les referentiels simples, les services complementaires, les parametres reserves editeur et la page `/settings`.

Pour preparer le cloud Sprint 12, utiliser:

- `database/supabase_schema.sql`
- `database/supabase_seed.sql`
- `railway.json`
- `vercel.json`
- `docs/deployment.md`
- `docs/supabase.md`
- `docs/railway.md`
- `docs/vercel.md`

Comptes demo:

- `admin@property-erp.local` / `demo`
- `comptable@property-erp.local` / `demo`
- `agent@property-erp.local` / `demo`
- `directeur@property-erp.local` / `demo`
