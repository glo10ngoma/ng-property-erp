# Railway Backend

Railway heberge l'API NestJS.

## Configuration

Dans Railway, creer un service depuis GitHub avec:

- root directory: `backend/`
- build: `npm install && npm run build`
- start: `npm run start:prod`
- healthcheck: `/api/health`

## Variables

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

## CORS

`CORS_ORIGIN` accepte une liste separee par virgules. En production, garder uniquement:

- URL Vercel publique;
- `http://127.0.0.1:5173`;
- `http://localhost:5173`.

## Verification

Tester apres deploiement:

```text
GET https://your-backend.up.railway.app/api/health
GET https://your-backend.up.railway.app/api/dashboard
POST https://your-backend.up.railway.app/api/auth/login
```

Le endpoint `/api/health` ne depend pas d'un role utilisateur.
