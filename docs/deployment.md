# Deploiement Cloud Property ERP SaaS V1

Architecture cible:

Frontend Vercel -> Backend Railway -> Supabase PostgreSQL -> Supabase Storage.

L'authentification reste geree par NestJS avec JWT. Supabase Auth n'est pas utilise.

## Ordre de deploiement

1. Creer le projet Supabase.
2. Executer `database/supabase_schema.sql`.
3. Executer `database/supabase_seed.sql` pour les donnees demo.
4. Creer le service backend Railway depuis le repository.
5. Configurer les variables Railway.
6. Verifier `GET /api/health`.
7. Creer le projet frontend Vercel depuis le repository.
8. Configurer les variables Vercel.
9. Tester l'URL publique Vercel avec les 4 comptes demo.

## Variables Railway

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

## Variables Vercel

```env
VITE_API_URL=https://your-backend.up.railway.app
VITE_SUPABASE_URL=https://[PROJECT_REF].supabase.co
VITE_SUPABASE_ANON_KEY=
```

## Tests de validation

- Connexion: admin, comptable, agent, directeur.
- Modules: Activity Center, Dashboard, immeubles, unites, locataires, baux, garanties, factures, paiements, caisse, personnel, stock, maintenance, rapports, workflows, communications, documents, settings.
- Exports CSV/Excel.
- Uploads et telechargements via URLs Supabase Storage.
- Permissions par role.
- Isolation par `organization_id`.
- Audit logs apres actions sensibles.

## Non-regression

Aucun changement de design n'est requis pour le cloud. Les variables d'environnement changent uniquement les endpoints et le stockage cible.
