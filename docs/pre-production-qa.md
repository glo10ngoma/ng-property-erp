# Pré-production QA — NG Property ERP

## Date QA
- 2026-07-09

## Environnement testé
- Workspace local Windows
- Backend NestJS
- Frontend React/Vite
- Vérifications techniques exécutées localement
- Revue statique des routes frontend principales
- Revue de configuration cloud à partir du repo et des `.env` locaux

## Résumé
- Builds backend, frontend et racine : OK
- `git diff --check` : OK
- Routage frontend principal : cohérent côté code
- Régression RH récente : corrigée sur la navigation et la saisie mensuelle dédiée
- Vérification cloud complète : non finalisable depuis le repo seul

## Checklist modules

| Module / contrôle | Statut | Notes |
|---|---|---|
| Build backend | OK | `npm run build --prefix backend` |
| Build frontend | OK | `npm run build --prefix frontend` |
| Build racine | OK | `npm run build` |
| `git diff --check` | OK | warnings CRLF uniquement |
| Routes frontend principales | OK | présentes dans `frontend/src/app/router.tsx` |
| TypeScript bloquant | OK | aucun blocage après build |
| Navigation RH | OK | libellés RH visibles corrigés |
| Pointage mensuel RH | OK | route dédiée présente et compile |
| Paie RH | OK | compile, branchement présent |
| Vérification cloud Railway/Vercel | BLOQUÉ | aucune URL publique réelle dans le repo |
| Vérification login cloud | BLOQUÉ | non testable sans URL + environnement déployé |
| Vérification Supabase migrations appliquées | PARTIEL | scripts présents, état réel cloud non vérifiable depuis le repo |
| Vérification CORS cloud | BLOQUÉ | environnement cloud non visible ; `.env` local backend reste sur `http://localhost:5173` |
| Parcours admin complet en navigateur | PARTIEL | non finalisé en session QA, serveurs non maintenus en sandbox |
| Permissions multi-rôles en exécution | PARTIEL | logique présente côté code, QA runtime non complète |
| Exports / impressions | PARTIEL | surfaces présentes, non rejouées toutes en session navigateur |

## Bugs trouvés

### Corrigés
1. Libellés cassés dans la navigation RH
   - `Employés`
   - `Congés`

### Restants bloquants
1. Vérification cloud impossible à clôturer
   - aucune URL publique Railway/Vercel réelle trouvée dans le repo
   - impossible de confirmer backend online, frontend online, login cloud, CORS réel, ou variables Railway/Vercel actives

2. Validation fonctionnelle pré-production incomplète en exécution réelle
   - le parcours admin complet demandé n’a pas pu être rejoué de bout en bout dans cette session
   - conséquence : absence de preuve QA réelle sur certains workflows critiques en UI

### Restants non bloquants
1. Plusieurs chaînes mal encodées subsistent côté backend
   - exemples dans `backend/src/saas/saas.service.ts`
   - impact probable sur certains messages d’erreur ou libellés secondaires

2. Bundle frontend volumineux
   - warning Vite > 500 kB après minification
   - non bloquant pour la mise en ligne immédiate, mais à surveiller

## Bugs corrigés pendant cette QA
- `frontend/src/modules/staff/StaffNav.tsx`
  - correction des libellés RH mal encodés

## Vérifications techniques exécutées
- `npm run build --prefix backend`
- `npm run build --prefix frontend`
- `npm run build`
- `git diff --check`

## Vérifications de code / configuration
- Routes principales présentes :
  - `/activity`
  - `/dashboard`
  - `/buildings`
  - `/buildings/:id/report`
  - `/rental-units`
  - `/tenants`
  - `/tenants/:id/situation`
  - `/leases`
  - `/invoices`
  - `/payments`
  - `/cash`
  - `/maintenance`
  - `/stock`
  - `/personnel/employees`
  - `/personnel/attendance`
  - `/personnel/attendance/monthly-entry`
  - `/personnel/payroll`
- Config cloud présente :
  - `railway.json`
  - `vercel.json`
  - `database/supabase_schema.sql`
  - `database/supabase_seed.sql`
- Limite relevée :
  - `.env` backend local observé avec `CORS_ORIGIN=http://localhost:5173`
  - `frontend/.env` et `frontend/.env.local` pointent encore vers des URLs locales

## Recommandation finale
- **Statut : NO GO**

## Motif du statut
- Les builds sont verts et la base code est globalement cohérente.
- En revanche, la QA pré-production demandée n’est pas complètement prouvée sur :
  - le cloud réel Railway / Vercel / Supabase,
  - le login cloud,
  - le parcours utilisateur admin complet en exécution réelle,
  - certains workflows critiques métiers en UI.

## Conditions pour passer en GO
1. Fournir les URLs publiques Railway et Vercel réelles.
2. Vérifier `/api/health`, login cloud, CORS réel et liaison frontend/backend cloud.
3. Rejouer au minimum en navigateur :
   - login
   - Activity Center
   - Dashboard
   - Immeubles / Rapport immeuble
   - Appartements / fiche appartement
   - Locataires / situation locataire
   - Baux / nouveau bail
   - Factures / nouvelle facture / détail facture
   - Paiements
   - Caisse
   - Maintenance
   - Stock / achats fournisseurs
   - Personnel / pointage mensuel / paie
4. Nettoyer les messages mal encodés encore présents côté backend.
