BEGIN;

WITH target_orgs AS (
  SELECT id AS organization_id, slug
  FROM organizations
  WHERE (id = 1 AND slug = 'catalyse')
     OR (id = 5 AND slug = 'magic-construction')
     OR (id = 6 AND slug = 'ng-property-sandbox')
)
INSERT INTO lease_contract_templates (
  organization_id,
  name,
  code,
  version,
  lease_type,
  content,
  is_active,
  created_by
)
SELECT
  organization_id,
  CASE
    WHEN slug = 'ng-property-sandbox' THEN 'Contrat de bail Ã  usage mixte - SANDBOX'
    WHEN slug = 'magic-construction' THEN 'Contrat de bail Ã  usage mixte - MAGIC CONSTRUCTION'
    ELSE 'Contrat de bail Ã  usage mixte'
  END,
  'LEASE_MIXED',
  1,
  'MIXED',
  $$CONTRAT DE BAIL Ã€ USAGE MIXTE

ENTRE LES SOUSSIGNÃ‰S :

{{bailleur.raison_sociale}}{{bailleur.sigle_phrase}}, {{bailleur.forme_juridique_phrase}}immatriculÃ©e au Registre du Commerce et du CrÃ©dit Mobilier sous le numÃ©ro {{bailleur.rccm}}, enregistrÃ©e Ã  lâ€™Identification Nationale sous le numÃ©ro {{bailleur.identification_nationale}}, dont le siÃ¨ge social est Ã©tabli Ã  {{bailleur.adresse_complete}}, reprÃ©sentÃ©e par {{bailleur.representant_nom}}, agissant en qualitÃ© de {{bailleur.representant_fonction}}, ci-aprÃ¨s dÃ©nommÃ©e Â« le Bailleur Â» ;

Dâ€™une part,

{{locataire.paragraphe_identification}}

Ci-aprÃ¨s dÃ©nommÃ©(e) Â« le Preneur Â» ;

Dâ€™autre part,

Le Bailleur et le Preneur Ã©tant ci-aprÃ¨s collectivement dÃ©nommÃ©s Â« les Parties Â».

PRÃ‰CISIONS SUR LE BIEN LOUÃ‰

Type | Bien Ã  usage mixte
Appartement | {{bien.numero_unite}}
Immeuble | {{bien.immeuble}}
Adresse | {{bien.adresse_complete}}
Commune | {{bien.commune}}
Ville | {{bien.ville}}
Usage | {{bail.usage_label}}
ActivitÃ© / destination | {{bail.activite_destination}}
Date de dÃ©but du bail | {{bail.date_debut}}

ARTICLE 01 â€” DESCRIPTION DES LIEUX

Le Bailleur donne Ã  bail au Preneur, qui accepte, lâ€™unitÃ© {{bien.numero_unite}}, situÃ©e dans lâ€™immeuble {{bien.immeuble}}, Ã  lâ€™adresse suivante : {{bien.adresse_complete}}.

Les lieux louÃ©s sont destinÃ©s Ã  un usage mixte, incluant les affectations dÃ©clarÃ©es par le Preneur et les stipulations particuliÃ¨res convenues entre les Parties.

{{bail.destination_phrase}}

Un Ã©tat des lieux contradictoire sera Ã©tabli avant la remise des clÃ©s au Preneur.

ARTICLE 02 â€” DURÃ‰E DU BAIL ET LOYER

a) DurÃ©e du bail

Le prÃ©sent contrat est conclu pour une durÃ©e de {{bail.duree_texte}}, prenant effet le {{bail.date_debut}} et arrivant Ã  Ã©chÃ©ance le {{bail.date_fin}}.

Il peut Ãªtre renouvelÃ© avec lâ€™accord Ã©crit du Bailleur.

Chacune des Parties peut y mettre fin moyennant un prÃ©avis Ã©crit de {{bail.preavis_mois}} mois ou par accord mutuel.

b) Composition du loyer mensuel

Le montant mensuel total dÃ» par le Preneur sâ€™Ã©lÃ¨ve Ã  {{bail.loyer_total_formate}}, composÃ© comme suit :

- Loyer de base : {{bail.loyer_base_formate}}
- Entretien et maintenance : {{bail.frais_entretien_formate}}
- Frais de syndic : {{bail.frais_syndic_formate}}
{{bail.autres_charges_ligne}}

c) Services compris

Le montant convenu comprend les services communs, les Ã©quipements collectifs et les prestations expressÃ©ment prÃ©vues par les Parties.

d) RÃ©vision

Les Parties conviennent que les montants prÃ©vus au prÃ©sent contrat peuvent Ãªtre rÃ©visÃ©s par accord Ã©crit, notamment en fonction des fluctuations Ã©conomiques et des rÃ©alitÃ©s du marchÃ© immobilier.

ARTICLE 03 â€” GARANTIE LOCATIVE ET PREMIER PAIEMENT

a) La garantie locative correspond Ã  {{bail.garantie_nombre_mois}} mois de loyer de base, soit :

{{bail.loyer_base_formate}} Ã— {{bail.garantie_nombre_mois}} = {{bail.garantie_montant_formate}}.

b) Le Preneur est tenu de verser la totalitÃ© de la garantie locative au Bailleur lors de la signature du prÃ©sent contrat, contre quittance.

c) La garantie locative ne produit aucun intÃ©rÃªt. Elle est remboursable Ã  la fin du bail, aprÃ¨s dÃ©duction des sommes restant dues au Bailleur.

d) Le Preneur demeure tenu de payer rÃ©guliÃ¨rement le loyer, indÃ©pendamment de la garantie locative.

ARTICLE 04 â€” OBLIGATIONS GÃ‰NÃ‰RALES

Le Preneur sâ€™engage Ã  utiliser les lieux conformÃ©ment Ã  la destination dÃ©clarÃ©e, Ã  respecter la rÃ©glementation applicable et Ã  prÃ©server la bonne jouissance des autres occupants.

ARTICLE 05 â€” CESSION, SOUS-LOCATION ET MODIFICATIONS

La cession du bail, la sous-location totale ou partielle ainsi que la mise Ã  disposition des lieux Ã  un tiers sont interdites sans lâ€™autorisation Ã©crite prÃ©alable du Bailleur.

Les travaux, amÃ©nagements, enseignes ou transformations nÃ©cessitent Ã©galement lâ€™accord Ã©crit prÃ©alable du Bailleur.

ARTICLE 06 â€” ENTRETIEN ET RESPONSABILITÃ‰

Le Preneur maintient les lieux louÃ©s, leurs amÃ©nagements et leurs accessoires en bon Ã©tat dâ€™entretien, de fonctionnement et de propretÃ©.

Il rÃ©pond des dÃ©gradations causÃ©es par lui-mÃªme, ses prÃ©posÃ©s, son personnel, ses visiteurs ou toute personne quâ€™il introduit dans les lieux.

ARTICLE 07 â€” ASSURANCE

Le Preneur souscrit les assurances nÃ©cessaires Ã  lâ€™exercice de ses activitÃ©s et Ã  la couverture des risques liÃ©s Ã  son occupation des lieux.

ARTICLE 08 â€” NON-RESPECT DES CLAUSES

En cas de non-respect des obligations du prÃ©sent contrat, la Partie lÃ©sÃ©e peut mettre en demeure lâ€™autre Partie dâ€™y remÃ©dier, sans prÃ©judice des droits et actions prÃ©vus par la loi.

ARTICLE 09 â€” MODIFICATION DU CONTRAT

Toute modification du prÃ©sent contrat fait lâ€™objet dâ€™un avenant Ã©crit signÃ© par les deux Parties.

ARTICLE 10 â€” RÃˆGLEMENT DES LITIGES ET DISPOSITIONS FINALES

Les Parties sâ€™engagent Ã  rechercher un rÃ¨glement amiable de tout diffÃ©rend relatif Ã  lâ€™exÃ©cution ou Ã  lâ€™interprÃ©tation du prÃ©sent contrat avant toute saisine judiciaire.

Ã€ dÃ©faut de rÃ¨glement amiable, les juridictions compÃ©tentes de Kinshasa sont seules compÃ©tentes, sous rÃ©serve des rÃ¨gles lÃ©gales de compÃ©tence applicables.

Le prÃ©sent contrat est Ã©tabli Ã  {{bail.lieu_signature}}, en deux exemplaires originaux, un pour chacune des Parties.

Fait Ã  {{bail.lieu_signature}}, le {{bail.date_signature}}.

$$,
  TRUE,
  1
FROM target_orgs
WHERE NOT EXISTS (
  SELECT 1
  FROM lease_contract_templates existing
  WHERE existing.organization_id = target_orgs.organization_id
    AND existing.code = 'LEASE_MIXED'
    AND existing.version = 1
    AND existing.deleted_at IS NULL
);

COMMIT;
