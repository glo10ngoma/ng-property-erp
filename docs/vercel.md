# Vercel Frontend

Vercel heberge l'application React/Vite.

## Configuration

Dans Vercel, creer un projet depuis GitHub avec:

- root directory: `frontend/`
- install: `npm install`
- build: `npm install && npm run build`
- output: `dist`
- rewrites SPA vers `/index.html`

## Variables

```env
VITE_API_URL=https://your-backend.up.railway.app
VITE_SUPABASE_URL=https://[PROJECT_REF].supabase.co
VITE_SUPABASE_ANON_KEY=
```

`VITE_API_URL` ne doit pas contenir `/api`; le frontend ajoute deja `/api`.

## Verification

Tester apres deploiement:

- ouvrir l'URL Vercel;
- se connecter avec `admin@property-erp.local` / `demo`;
- verifier que le menu s'ouvre sur le Centre d'Activite;
- rafraichir une route interne comme `/invoices` pour confirmer le routing SPA.
