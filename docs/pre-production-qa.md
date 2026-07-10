# Pre-production QA - NG Property ERP

## Date QA
- 2026-07-10 12:50 (Africa/Kinshasa)

## Environnement teste
- Workspace local Windows
- Frontend local: `http://127.0.0.1:5173`
- Backend local: source rebuild testee sur `dist/main.js`
- Base de donnees attendue: Supabase PostgreSQL via `DATABASE_URL`
- Verification cloud publique: non finalisable depuis ce repo seul

## URLs / environnement reel disponibles
- Frontend Vercel public: non fourni dans le repo
- Backend Railway public: non fourni dans le repo
- URL Supabase: presente en configuration locale backend

## Resume
- Build backend: OK
- Build frontend: OK
- Build racine: OK
- `git diff --check`: OK hors warnings CRLF
- Bug reel reproduit et corrige: CORS local entre `127.0.0.1:5173` et le backend
- QA cloud complete: bloquee par absence d'URLs publiques et par l'impossibilite de valider les appels BD distants depuis cet environnement

## Parcours testes reellement

| Parcours | Statut | Resultat |
|---|---|---|
| Frontend local accessible | OK | `http://127.0.0.1:5173` repond |
| Login UI local | BUG REPRODUIT | echec CORS sur `POST /api/auth/login` depuis `127.0.0.1:5173` |
| Hotfix CORS local | CORRIGE | backend accepte maintenant automatiquement les alias `localhost` / `127.0.0.1` |
| Retest login apres hotfix | PARTIEL | le CORS est corrige dans le code compile, mais la validation complete reste bloquee par l'acces BD distant durant cette session |
| Fiche employe en erreur de chargement | CORRIGE | retour utilisateur explicite au lieu d'un ecran vide / chargeur bloquant |
| Libelle contrat employe auto | CORRIGE | suppression de `Automatique (...)` dans l'affichage verrouille |

## Bugs reproduits

1. Login local bloque par CORS
   - Reproduction:
     - frontend sur `http://127.0.0.1:5173`
     - appel `POST http://127.0.0.1:3000/api/auth/login`
   - Erreur navigateur:
     - `No 'Access-Control-Allow-Origin' header is present on the requested resource`
   - Cause:
     - configuration backend limitee a `localhost` alors que le frontend tourne sur `127.0.0.1`
   - Correction:
     - ajout automatique des alias loopback dans [backend/src/main.ts](</C:/Users/Esther/Documents/ERP IMMO PROTO/backend/src/main.ts>)

## Bugs corriges pendant cette QA

1. CORS local `localhost` / `127.0.0.1`
   - Fichier: [backend/src/main.ts](</C:/Users/Esther/Documents/ERP IMMO PROTO/backend/src/main.ts>)

2. Fiche employe sans message exploitable si chargement impossible
   - Fichier: [frontend/src/modules/staff/pages/StaffPages.tsx](</C:/Users/Esther/Documents/ERP IMMO PROTO/frontend/src/modules/staff/pages/StaffPages.tsx>)

3. Affichage contrat employe auto trop verbeux
   - Fichier: [frontend/src/modules/staff/pages/StaffPages.tsx](</C:/Users/Esther/Documents/ERP IMMO PROTO/frontend/src/modules/staff/pages/StaffPages.tsx>)

## Bugs restants bloquants

1. URLs cloud publiques absentes
   - impossible de tester Railway / Vercel reels
   - impossible de confirmer refresh profond Vercel, CORS cloud, login cloud, ou navigation cloud

2. Verification fonctionnelle complete bloquee par l'acces runtime a la base distante
   - le backend local demarre et expose ses routes
   - les parcours metier dependants de la base distante ne sont pas prouvables de bout en bout dans cette session
   - symptome observe pendant le retest login: `500 Internal Server Error` avec `AggregateError` cote backend lors de l'appel authentification

## Bugs restants non bloquants

1. Warning bundle frontend > 500 kB apres minification
2. Warnings CRLF dans `git diff --check`

## Commandes executees
- `npm run build --prefix backend`
- `npm run build --prefix frontend`
- `npm run build`
- `git diff --check`

## Statut final
- **NO GO**

## Motif
- Le correctif CORS local est en place et les builds sont verts.
- En revanche, la QA manuelle ciblee demandee n'est pas completement prouvee sur l'environnement reel Vercel + Railway + Supabase, faute d'URLs publiques disponibles et de validation runtime complete des flux bases sur la base distante.
