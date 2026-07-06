# Checklist deploiement GitHub -> Railway / Vercel

Objectif: deployer Property ERP SaaS V1 depuis le repository GitHub, sans changer le comportement fonctionnel ni le design.

## 1. Repository GitHub

- Pousser le repository complet sur GitHub.
- Verifier que les fichiers suivants sont presents:
  - `railway.json`
  - `vercel.json`
  - `backend/package.json`
  - `frontend/package.json`
  - `.env.example`
  - `database/supabase_schema.sql`
  - `database/supabase_seed.sql`

## 2. Supabase

- Creer un projet Supabase.
- Executer `database/supabase_schema.sql` dans SQL Editor.
- Executer `database/supabase_seed.sql` dans SQL Editor.
- Recuperer:
  - `DATABASE_URL`
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`

## 3. Railway - Backend

Creer un service Railway depuis GitHub.

Configuration Railway:

- Root directory: `backend/`
- Build command: `npm install && npm run build`
- Start command: `npm run start:prod`
- Healthcheck path: `/api/health`

Variables Railway:

```env
DATABASE_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres?sslmode=require
JWT_SECRET=change-me-long-random-secret
JWT_REFRESH_SECRET=change-me-long-random-refresh-secret
SUPABASE_URL=https://[PROJECT_REF].supabase.co
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
CORS_ORIGIN=https://your-frontend.vercel.app,http://127.0.0.1:5173,http://localhost:5173
NODE_ENV=production
PORT=3000
```

Verification Railway:

- `GET https://your-backend.up.railway.app/api/health`
- Reponse attendue: `{"status":"ok", ...}`

## 4. Vercel - Frontend

Creer un projet Vercel depuis GitHub.

Configuration Vercel:

- Root directory: `frontend/`
- Framework preset: Vite
- Build command: `npm install && npm run build`
- Output directory: `dist`

Variables Vercel:

```env
VITE_API_URL=https://your-backend.up.railway.app
VITE_SUPABASE_URL=https://[PROJECT_REF].supabase.co
VITE_SUPABASE_ANON_KEY=
```

Important: `VITE_API_URL` ne doit pas finir par `/api`; le frontend ajoute deja `/api`.

## 5. CORS

Apres creation de l'URL Vercel, mettre a jour Railway:

```env
CORS_ORIGIN=https://your-frontend.vercel.app,http://127.0.0.1:5173,http://localhost:5173
```

Redeployer le backend Railway apres modification.

## 6. Tests post-deploiement

- Connexion avec les 4 comptes demo.
- Activity Center.
- Dashboard.
- Immeubles.
- Appartements.
- Locataires.
- Baux et garanties.
- Factures.
- Paiements.
- Caisse.
- Personnel.
- Stock.
- Maintenance.
- Rapports.
- Workflows.
- Communications.
- Documents.
- Parametres.
- Exports.
- Permissions par role.
- Audit logs.

## 7. Comptes demo

```text
admin@property-erp.local / demo
comptable@property-erp.local / demo
agent@property-erp.local / demo
directeur@property-erp.local / demo
```
