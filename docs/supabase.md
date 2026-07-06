# Supabase

Supabase fournit PostgreSQL et Storage. L'application conserve son auth NestJS/JWT.

## Base PostgreSQL

Executer dans Supabase SQL editor:

```sql
-- 1. Schema complet
-- Copier/coller le contenu de database/supabase_schema.sql

-- 2. Donnees demo
-- Copier/coller le contenu de database/supabase_seed.sql
```

Le schema active:

- `pgcrypto`
- `uuid-ossp`
- IDs entiers conserves pour compatibilite locale
- colonnes `public_id UUID` ajoutees aux tables principales
- `organization_id` sur les tables metier
- index et contraintes issus des migrations locales

## Storage

Buckets crees par `database/supabase_schema.sql`:

- `contracts`
- `tenant-documents`
- `maintenance`
- `employees`
- `exports`
- `company`

Structure recommandee:

```text
contracts/{organization_id}/leases/{lease_id}/{filename}
tenant-documents/{organization_id}/tenants/{tenant_id}/{filename}
maintenance/{organization_id}/requests/{request_id}/{before|after|invoice|report}/{filename}
employees/{organization_id}/employees/{employee_id}/{filename}
exports/{organization_id}/{module}/{yyyy}/{filename}
company/{organization_id}/{logo|invoice-logo|signature|stamp}/{filename}
```

## Policies

Les policies preparees autorisent:

- `service_role` pour l'ecriture/lecture serveur;
- `authenticated` en lecture preparee pour les futurs flux de liens signes.

En V1, le backend Railway doit utiliser `SUPABASE_SERVICE_ROLE_KEY` pour operations serveur. Ne jamais exposer cette cle dans Vercel.

## Documents

Les champs existants `file_url`, `contract_file_url`, `logo_url`, `invoice_logo_url`, `signature_url`, `stamp_url` doivent stocker soit:

- une URL signee Supabase;
- ou un chemin Storage qui sera converti en URL par le backend dans une iteration suivante.
