# Production Validation Checklist

Checklist avant demonstration client ou mise en ligne.

## Acces

- Login admin OK.
- Login comptable OK.
- Login agent OK.
- Login directeur OK.
- `/auth/me` retourne le bon role et les bonnes permissions.
- Logout OK.
- 401 propre sans token.
- 403 propre sur action interdite.
- Directeur en lecture seule: aucun ajout, modification ou suppression possible.

## Navigation

- Activity Center charge apres connexion.
- Dashboard BI charge sans erreur.
- Sidebar et routes principales OK.
- Aucun lien mort sur les modules visibles.
- Aucune erreur console navigateur.
- Aucune erreur Network inattendue.

## Modules metier

- Immeubles: liste, filtres, creation, modification, rapport dedie.
- Appartements: liste, filtres, type en liste deroulante, disponibilite.
- Locataires: liste, filtres, situation dediee.
- Baux: liste, filtres, page `/leases/new`, activation, resiliation.
- Factures: liste, filtres periode/statut, detail, impression.
- Paiements: paiement total et partiel, recu, lien facture.
- Caisse: mouvements IN/OUT, sessions, depenses.
- Personnel: employes, avances, conges, paie.
- Stock: articles, entrees, sorties, inventaires, seuil minimum.
- Maintenance: signalement, diagnostic, assignation, resolution.
- Workflows: validations visibles et actions approuver/rejeter.
- Communication: notifications, templates, logs simules.
- Parametres: entreprise, referentiels, services, reserve editeur.

## Rapports

- Rapport immeuble: occupants, payes/non payes, factures, totaux.
- Situation locataire: baux, garanties, factures, paiements, solde.
- Rapport paiements periode: filtres et totaux.
- Rapport disponibilite: libres/occupes/maintenance.
- Rapport stock: etat, mouvements, sous seuil.
- Rapport maintenance: statut, priorite, cout.
- Exports CSV/Excel ouvrables.
- Impression facture et rapports OK.

## Donnees et securite

- `organization_id` filtre toutes les donnees metier.
- Aucune donnee d'une autre organisation visible.
- Soft delete respecte dans les listes.
- Audit logs sur actions sensibles.
- Mots de passe stockes sous forme de hash.
- Variables Railway/Vercel/Supabase presentes.
- CORS limite aux origines attendues.
- Healthcheck `/api/health` OK.

## Uploads et cloud

- Bucket `contracts` disponible.
- Upload contrat bail teste ou message local clair.
- Buckets documents Supabase disponibles.
- Vercel SPA routing OK.
- Railway start command OK.
- Supabase schema applique sans erreur.

## Builds

- `cd backend && npm run build` OK.
- `cd frontend && npm run build` OK.
- `npm run build` a la racine OK.
