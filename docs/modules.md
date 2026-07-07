# Modules SaaS V1

## Immobilier

Modules conserves du prototype valide:

- Tableau de bord
- Immeubles
- Appartements
- Locataires
- Factures
- Paiements

Corrections UX appliquees:

- les listes n'affichent plus de pagination 10/25/50/100;
- les tableaux utilisent des entetes sticky dans une zone defilante;
- les filtres compactes restent en haut des listes avec action de reinitialisation sur les pages prioritaires;
- les montants des tableaux sont separes en colonnes `Montant` et `Devise`;
- le rapport immeuble plein ecran est disponible via `/buildings/:id/report`;
- la situation locataire plein ecran est disponible via `/tenants/:id/situation`.

## Utilisateurs

Le module `Users` prepare les roles `ADMIN`, `ACCOUNTANT`, `STAFF`, `DIRECTOR` et expose les permissions metier.

## Personnel

Tables: `employees`, `salary_advances`, `leaves`, `payrolls`.

Sprint 5 stabilise le module Personnel:

- employes actifs/inactifs avec fiche detaillee;
- avances sur salaire avec approbation et paiement;
- paiement avance lie a une sortie caisse `SALARY_ADVANCE`;
- demandes de conges avec statuts `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`;
- paie mensuelle avec salaire brut, avances, retenues, net et paiement;
- paiement salaire lie a une sortie caisse `SALARY_PAYMENT`;
- rapport RH simple expose par `GET /api/reports/staff`.

Fonctions disponibles localement:

- liste employes
- creation employe
- fiche employee via API
- structure avances, conges et paie

## Caisse

Tables: `cash_sessions`, `cash_movements`.

Regles:

- une seule caisse ouverte
- les paiements de facture creent un mouvement `IN`
- les depenses creent un mouvement `OUT`
- fermeture avec solde attendu et difference

## Stock

Tables: `stock_items`, `stock_movements`, `inventory_counts`, `inventory_count_lines`.

Fonctions:

- articles
- entrees/sorties stock
- mouvements
- base inventaire

Sprint 6 rend le module Stock generique NG ERP Platform:

- categories parametrables;
- code article automatique;
- entrees, sorties, inventaire et correction via historique unique `stock_movements`;
- quantite avant/apres par mouvement;
- prix d'achat moyen;
- inventaires avec lignes et ajustements automatiques;
- alertes sous minimum, rupture et article inactif;
- integration maintenance par sortie stock automatique;
- rapport stock avec etat, mouvements, inventaires, seuils et valorisation.

## Baux Et Contrats

Table: `leases`.

Le bail relie `tenant_id` + `unit_id` et porte:

- contrat scanne
- garantie locative
- loyer contractuel
- historique d'occupation

Le stockage fichier cible est Supabase Storage bucket `lease-contracts`.

Depuis la correction UX, la creation se fait sur une page dediee `/leases/new`.
Le formulaire est organise en sections: informations generales, informations du bail, garantie locative, contrat scanne et observations.
Le stockage cible du contrat est le bucket Supabase Storage `contracts`; en local, le nom du fichier est conserve si l'upload reel n'est pas encore branche.

## Immeubles

Le champ `building_type` est persiste en base et expose dans:

- creation/modification immeuble;
- liste et filtres immeubles;
- rapport immeuble;
- exports.

Migration pour bases existantes: `database/20260707_building_type.sql`.

## Maintenance

Tables: `maintenance_categories`, `maintenance_requests`, `maintenance_assignments`, `maintenance_timeline`, `maintenance_documents`, `maintenance_expenses`.

Sprint 7 transforme Maintenance en workflow complet:

- signalement lie a immeuble, appartement, bail ou locataire;
- diagnostic, cause, solution, cout et temps estimes;
- validation simple;
- assignation employe ou prestataire externe avec historique;
- intervention, pause/reprise, resolution, validation finale et cloture;
- consommation stock via `stock_movements`;
- depenses approuvees via `cash_movements` OUT;
- documents maintenance: photo avant/apres, facture, rapport, autre;
- SLA, retard et temps de resolution;
- timeline complete et rapport maintenance.

## Workflows

Tables: `workflow_definitions`, `workflow_step_definitions`, `workflow_instances`, `workflow_steps`, `workflow_actions`.

Sprint 8 ajoute un moteur d'approbation generique:

- types `EXPENSE_APPROVAL`, `SALARY_ADVANCE_APPROVAL`, `LEAVE_APPROVAL`, `MAINTENANCE_APPROVAL`, `PAYMENT_APPROVAL`, `CUSTOM`;
- approbateurs par role ou utilisateur;
- statuts `DRAFT`, `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`;
- historique actions/commentaires;
- page Workflows et Mes validations;
- integration caisse, avances, conges et maintenance.

## Centre d'Activite

Sprint 9 fait du Centre d'Activite le cockpit quotidien:

- page d'accueil apres connexion;
- validations workflow en attente;
- taches agregees par role;
- alertes factures, stock, garanties, maintenance, caisse et inventaires;
- activite recente basee sur `audit_logs`;
- KPI adaptes au role;
- acces rapides selon permissions;
- progression de la journee;
- actions d'aujourd'hui et de la semaine;
- recherche globale multi-modules.

## Communications

Tables: `notifications`, `message_templates`, `email_logs`, `sms_logs`, `whatsapp_logs`.

Sprint 10 ajoute le module Communication:

- notifications internes utilisateur avec statuts `UNREAD`, `READ`, `ARCHIVED`;
- priorites `LOW`, `NORMAL`, `HIGH`, `CRITICAL`;
- modeles de messages par canal `EMAIL`, `SMS`, `WHATSAPP`, `INTERNAL`;
- variables supportees dans les modeles, par exemple `{{tenant_full_name}}`, `{{invoice_number}}`, `{{amount}}`;
- envois email, SMS et WhatsApp simules en local;
- logs par canal avec statut `SIMULATED`;
- creation, modification et desactivation de modeles selon permissions;
- marquage des notifications comme lues;
- integration Activity Center pour les notifications importantes.

## Parametrage

Tables: `company_settings`, `reference_data`.

Sprint 11 ajoute le module Parametrage & Administration:

- informations entreprise: logo, nom, raison sociale, adresse, telephone, email, site web, devise, langue, fuseau horaire;
- impression: logo facture, signature, cachet, format papier, texte bas de facture;
- referentiels simples: types de charges, categories depenses, categories stock, types documents, fonctions personnel, types conges, modes paiement, banques et villes;
- services complementaires avec action "Contacter l editeur";
- parametres reserves editeur pour numerotation avancee, workflows, permissions, PDF, rapports, automatisations, cloud, securite, sauvegardes et providers reels;
- audit des modifications client et consultation des parametres reserves.
