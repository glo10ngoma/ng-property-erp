# Security TODO

## Etat actuel

- Le login ne compare plus uniquement le mot de passe en clair.
- Les nouveaux mots de passe sont hashes avec `crypto.scrypt` natif Node.js.
- Les seeds demo utilisent le mot de passe `demo`, stocke sous forme:
  `scrypt|N|r|p|salt|hash`.
- Une compatibilite temporaire accepte encore les anciens `password_hash` en clair pour eviter de bloquer une base deja deployee avant migration.

## Actions avant client final

- Executer les seeds/migrations qui remplacent les anciens `password_hash = 'demo'`.
- Verifier qu'aucun utilisateur production ne garde un mot de passe en clair:

```sql
SELECT email
FROM app_users
WHERE password_hash NOT LIKE 'scrypt|%';
```

- Apres migration de toutes les bases, retirer le fallback legacy dans `backend/src/auth/password.ts`.
- Mettre en place une politique de rotation de `JWT_SECRET` et `JWT_REFRESH_SECRET`.
- Ajouter une expiration de token et un vrai refresh token si requis pour la V1 client.
- Forcer des secrets differents entre local, staging et production.
- Ajouter une limite de tentatives de login si l'application est exposee publiquement.

## Commande SQL de migration des comptes demo

```sql
UPDATE app_users
SET password_hash = 'scrypt|16384|8|1|property-erp-demo-v1|zAYcJ3nmtuQlcwQxiAzyQVNhlAvGSF1c-taJwKkEs-1HNKkwaPDWULImFCjGAaFGMjehxkPqe3YH-9-JZYqg8Q'
WHERE email IN (
  'admin@property-erp.local',
  'comptable@property-erp.local',
  'agent@property-erp.local',
  'directeur@property-erp.local'
);
```
