# Property ERP SaaS - Plan des sprints Codex

Ce document sert de feuille de route technique pour faire evoluer le prototype local vers NG ERP Property SaaS V1 sans casser le socle valide par le client.

## Principes de conduite

- Conserver le design actuel et l'identite visuelle validee.
- Prioriser la stabilite metier avant les optimisations cosmetiques.
- Garder le backend comme autorite finale pour les permissions.
- Valider chaque sprint par `npm run build` backend et frontend.
- Tester les 4 comptes demo apres toute evolution de permissions.
- Eviter les migrations destructives: preserver les donnees locales existantes.

## Correction UX transverse - listes, filtres, baux

Decision client appliquee apres les sprints metier:

- suppression de la pagination visible 10/25/50/100 au profit de listes scrollables;
- entetes de tableaux sticky conserves;
- filtres avances prioritaires sur les listes metier;
- rapports immeuble et locataire en pages dediees;
- `building_type` ajoute aux immeubles avec migration incrementale;
- creation de bail deplacee vers `/leases/new`;
- formulaires rapides avec labels visibles;
- separation `Montant` / `Devise` dans les tableaux.

## Sprint 11.5 - Enterprise hardening & demo data

Objectif: stabiliser la V1 SaaS pour demonstration client.

Livrables:

- authentification durcie avec hash `scrypt` natif Node.js;
- compatibilite temporaire documentee pour anciens mots de passe en clair;
- seeds standard mis a jour avec password hashes;
- seed enterprise `database/demo_enterprise_seed.sql`;
- checklist production `docs/production-validation-checklist.md`;
- suivi securite `docs/security-todo.md`.

## Comptes de reference

- `admin@property-erp.local` / `demo`
- `comptable@property-erp.local` / `demo`
- `agent@property-erp.local` / `demo`
- `directeur@property-erp.local` / `demo`

## Sprint 1 - Stabilisation Core

Objectif: figer le socle applicatif.

### Perimetre

- Authentification locale.
- Utilisateurs.
- Roles.
- Permissions backend.
- Permissions frontend.
- Routes protegees.
- Guards de permissions.
- Audit logs.
- isolation SaaS via `organization_id`.
- README technique.

### Critere OK

- Les 4 comptes demo se connectent correctement.
- Les permissions backend refusent les actions interdites.
- Les boutons frontend d'ecriture sont masques selon les permissions.
- `npm run build` backend/frontend passe.
- Les audit logs couvrent les actions sensibles.
- Les tables metier principales sont filtrees par `organization_id`.

### Etat actuel

Realise localement: auth, comptes demo, `/auth/me`, roles, guards backend, protected routes frontend, permission buttons, tables RBAC, audit logs, soft delete sur flux critiques, isolation `organization_id` et build OK.

Decision technique: `tenant_id` reste reserve au locataire metier existant. L'isolation SaaS utilise `organization_id` pour eviter toute confusion dans les factures, paiements et baux.

## Sprint 2 - Migration modele Bail

Objectif: placer le bail au centre du modele.

### Perimetre

- `rental_units`.
- `leases`.
- `lease_guarantees`.
- `tenant_people`.
- Documents lies au bail.
- Historique occupation.

### Critere OK

- Un locataire peut avoir plusieurs baux.
- Une unite peut avoir un historique de baux.
- La garantie locative est liee au bail.
- Les factures futures peuvent pointer vers un bail sans ambiguite.

### Etat actuel

Realise localement: vues `rental_units` et `tenant_people`, tables `lease_guarantees` et `lease_documents`, creation/modification/activation/resiliation de bail, garantie liee au bail, historique occupation unite, baux par locataire, baux actifs par immeuble, disponibilite unites, controle de conflit d'activation et builds OK.

## Sprint 3 - Facturation / Paiement / Caisse

Objectif: fiabiliser le flux financier.

### Perimetre

- Facture liee au bail.
- Paiement avec allocation.
- Mouvement caisse automatique.
- Garantie locative encaissee/remboursee.
- Recu paiement.
- Facture imprimable.

### Critere OK

- Le flux Bail -> Facture -> Paiement -> Caisse fonctionne.
- Une garantie peut etre encaissee et remboursee avec mouvement caisse.
- Les recus et factures imprimables restent professionnels.

### Etat actuel

Realise localement: facture liee au bail, lignes typées, validation facture, `payment_allocations`, paiement partiel/solde, recu paiement, mouvements caisse automatiques pour paiement facture, paiement garantie et remboursement garantie, fermeture caisse coherente, permissions directeur/comptable validees et builds OK.

## Sprint 4 - Rapports BI prioritaires

Objectif: satisfaire la priorite client.

### Perimetre

- Rapport immeuble.
- Rapport locataire.
- Rapport paiements periode.
- Rapport impayes.
- Rapport disponibilite.
- Exports Excel/CSV/PDF.

### Critere OK

- Le directeur obtient les rapports demandes en demo.
- Les exports sont complets et exploitables.
- Les montants et statuts sont coherents avec les donnees source.

### Etat actuel

Realise localement: endpoints `/reports/dashboard`, `/reports/buildings/:id`, `/reports/tenants/:id`, `/reports/payments`, `/reports/availability`, `/reports/overdue` et `/reports/export`; filtres periode/immeuble/locataire/statut/mode de paiement; exports CSV et Excel cote frontend; rapports immeuble, locataire, paiements, disponibilite et impayes valides avec isolation `organization_id`. Le directeur peut consulter les rapports et reste bloque en ecriture par le backend.

## Sprint 5 - Personnel / Paie

Objectif: gerer une RH simple.

### Perimetre

- Employes.
- Avances salaire.
- Conges.
- Paie.
- Mouvement caisse sortant pour avance/paiement salaire.

### Critere OK

- Le flux avance salaire -> validation -> caisse OUT fonctionne.
- L'historique employe montre avances, conges et paie.

### Etat actuel

Realise localement: liste/detail/creation/modification/desactivation employe, avances avec statuts `DRAFT`, `PENDING`, `APPROVED`, `REJECTED`, `PAID`, paiement avance avec mouvement caisse OUT, demandes conges avec approbation/rejet/annulation, generation paie mensuelle avec avances et retenues, validation/paiement salaire avec mouvement caisse OUT, rapport RH simple via `/reports/staff`, exports CSV/Excel cote frontend, permissions directeur/comptable/agent validees et builds OK.

## Sprint 6 - Stock

Objectif: rendre le stock operationnel.

### Perimetre

- Articles.
- Entrees.
- Sorties.
- Mouvements.
- Inventaires.
- Seuil minimum.

### Critere OK

- Une entree augmente la quantite.
- Une sortie diminue la quantite.
- L'historique des mouvements reste fiable.
- Les alertes de seuil minimum sont visibles.

### Etat actuel

Realise localement: categories paramétrables, codes article automatiques, articles enrichis, entrees et sorties stock via mouvements obligatoires, quantite avant/apres, prix moyen d'achat, inventaires avec lignes et validation generant les ajustements, alertes stock dans Dashboard et Centre d'activite, rapport stock enrichi, exports CSV/Excel, endpoint maintenance de consommation stock, permissions directeur/comptable/agent validees et builds OK.

## Sprint 7 - Maintenance corrective

Objectif: gerer les interventions.

### Perimetre

- Demande maintenance.
- Affectation personnel.
- Couts.
- Consommation stock.
- Depense caisse.
- Cloture intervention.

### Critere OK

- Le flux maintenance -> stock/caisse/personnel est coherent.
- Une intervention cloturee garde son cout total et ses consommations.

### Etat actuel

Realise localement: tables maintenance categories/demandes/assignations/timeline/documents/depenses, cycle complet signalement -> diagnostic -> validation -> affectation -> intervention -> consommation stock -> depense -> resolution -> validation finale -> cloture, consommation stock via `stock_movements`, depense approuvee via `cash_movements` OUT, SLA/retards, timeline, rapport maintenance, indicateurs dashboard, frontend compact avec recherche/exports/actions, permissions et audit logs valides, builds OK.

## Sprint 8 - Communication

Objectif: preparer les notifications client.

### Perimetre

- Notifications internes.
- Modeles messages.
- Logs email/SMS/WhatsApp.
- Envoi simule en local.
- Architecture provider prete.

### Critere OK

- Facture, retard et paiement generent une notification ou un log.
- Le provider local peut etre remplace par un provider reel plus tard.

### Etat actuel

Traite comme Sprint 10 Communication dans la sequence courante. Le Workflow Engine a ete livre avant le Centre d'Activite pour soutenir les validations.

## Sprint 9 - Workflow & Centre d'Activite

Objectif: piloter le travail quotidien.

### Perimetre

- Workflow engine.
- Approbations depenses.
- Approbations conges.
- Taches utilisateur.
- Activite recente.

### Critere OK

- Le directeur voit les validations a faire.
- Le comptable voit les taches financieres.
- Les actions recentes sont journalisees.

### Etat actuel

Realise localement: Activity Center devient la page d'accueil apres connexion, Dashboard conserve son role BI, endpoints `/activity`, `/activity/tasks`, `/activity/alerts`, `/activity/recent`, `/activity/kpis`, `/activity/today`, `/activity/week`, `/activity/search`, validations workflow visibles par role, taches et alertes agregées, KPI par role, acces rapides sous permissions, progression journee, recherche globale, timeline basee sur `audit_logs`, builds OK.

## Sprint 10 - Communication

Objectif: mettre en place les notifications internes, les modeles de messages et les envois simules email/SMS/WhatsApp.

### Perimetre

- Notifications internes utilisateur.
- Modeles de messages par canal.
- Logs email, SMS et WhatsApp.
- Envoi simule en local.
- Integration Activity Center.
- Permissions communication et notifications.

### Critere OK

- Les envois locaux creent des logs `SIMULATED`.
- Les notifications critiques remontent dans les alertes du Centre d'Activite.
- Les modeles sont geres selon les permissions.
- Le backend reste pret pour brancher des providers reels.

### Etat actuel

Realise localement: migration `database/sprint10_communications.sql`, tables `notifications`, `message_templates`, `email_logs`, `sms_logs`, `whatsapp_logs`, endpoints `/communications/*` et `/notifications/*`, page `/communications`, envois simules, logs consultables/exportables, notifications marquees lues, Activity Center alimente par notifications importantes, permissions et audit logs valides, builds OK.

## Sprint 11 - Parametrage & Administration

Objectif: separer les parametres modifiables par le client des parametres reserves a l'editeur.

### Perimetre

- Parametres entreprise.
- Parametres impression.
- Referentiels simples.
- Services complementaires.
- Parametres reserves editeur.
- Permissions settings/reference data.

### Critere OK

- Le client admin gere les parametres courants.
- Les roles non autorises sont bloques en ecriture.
- Les parametres avances restent reserves editeur.
- Les changements sont audites.

### Etat actuel

Realise localement: migration `database/sprint11_settings_admin.sql`, tables `company_settings` et `reference_data`, endpoints `/settings/company`, `/reference-data`, `/settings/publisher-services`, `/settings/restricted`, page `/settings` avec onglets Entreprise, Referentiels, Impression, Services complementaires et Reserve editeur, permissions dediees, audit des modifications et consultation reservee, builds OK.

## Sprint 12 - Deploiement Cloud

Objectif: preparer et documenter le deploiement Supabase/Railway/Vercel sans changer le comportement local.

### Perimetre

- `.env` staging/prod.
- Schema Supabase.
- Supabase Storage.
- Railway config.
- Vercel config.
- CORS prod.
- Health check.
- Documentation deploiement.

### Critere OK

- Le backend peut tourner sur Railway avec Supabase PostgreSQL.
- Le frontend peut pointer vers Railway depuis Vercel.
- Les variables sensibles restent hors repository.
- Les scripts SQL cloud sont rejouables sur un projet Supabase frais.

### Etat actuel

Realise cote code/config: `database/supabase_schema.sql`, `database/supabase_seed.sql`, buckets Storage et policies prepares, `railway.json`, `vercel.json`, CORS via `CORS_ORIGIN`, endpoint `/api/health`, `.env.example`, docs Supabase/Railway/Vercel/deployment, builds OK. Le deploiement public effectif reste a lancer avec les comptes et secrets cloud du client.

## Sprint 13 - Deploiement SaaS

Objectif: livrer une premiere V1 cloud.

### Perimetre

- Deploiement Railway.
- Deploiement Vercel.
- Test complet.
- Seed client.
- Sauvegardes.
- Documentation exploitation.

### Critere OK

- Le client peut acceder en ligne.
- Les workflows principaux sont valides.
- La procedure d'exploitation est documentee.

## Definition of Done par sprint

- Migration SQL documentee et rejouable si necessaire.
- API testee avec comptes autorises et non autorises.
- UI testee avec les roles concernes.
- Aucune regression volontaire du design.
- Build backend OK.
- Build frontend OK.
- README ou documentation mis a jour si le comportement change.
