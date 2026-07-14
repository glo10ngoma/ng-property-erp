BEGIN;

ALTER TABLE leases
  ADD COLUMN IF NOT EXISTS lease_activity_description TEXT;

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
    WHEN slug = 'ng-property-sandbox' THEN 'Contrat de bail à usage commercial - SANDBOX'
    WHEN slug = 'magic-construction' THEN 'Contrat de bail à usage commercial - MAGIC CONSTRUCTION'
    ELSE 'Contrat de bail à usage commercial'
  END,
  'LEASE_COMMERCIAL',
  1,
  'COMMERCIAL',
  $$CONTRAT DE BAIL À USAGE COMMERCIAL

ENTRE LES SOUSSIGNÉS :

{{bailleur.raison_sociale}}{{bailleur.sigle_phrase}}, {{bailleur.forme_juridique_phrase}}immatriculée au Registre du Commerce et du Crédit Mobilier sous le numéro {{bailleur.rccm}}, enregistrée à l’Identification Nationale sous le numéro {{bailleur.identification_nationale}}, dont le siège social est établi à {{bailleur.adresse_complete}}, représentée par {{bailleur.representant_nom}}, agissant en qualité de {{bailleur.representant_fonction}}, ci-après dénommée « le Bailleur » ;

D’une part,

{{locataire.paragraphe_identification}}

Ci-après dénommé(e) « le Preneur » ;

D’autre part,

Le Bailleur et le Preneur étant ci-après collectivement dénommés « les Parties ».

PRÉCISIONS SUR LE BIEN LOUÉ

Type | Local commercial
Unité | {{bien.numero_unite}}
Immeuble | {{bien.immeuble}}
Adresse | {{bien.adresse_complete}}
Destination commerciale | {{bail.activite_destination}}
Date de début du bail | {{bail.date_debut}}

ARTICLE 01 — DESCRIPTION DES LIEUX

Le Bailleur donne à bail au Preneur, qui accepte, l’unité {{bien.numero_unite}}, située dans l’immeuble {{bien.immeuble}}, à l’adresse suivante : {{bien.adresse_complete}}.

Le Preneur reconnaît avoir visité les lieux loués et les connaître parfaitement.

Un état des lieux contradictoire sera établi avant la remise des clés au Preneur.

{{bail.destination_phrase}}

ARTICLE 02 — DURÉE DU BAIL ET LOYER

a) Durée du bail

Le présent contrat est conclu pour une durée de {{bail.duree_texte}}, prenant effet le {{bail.date_debut}} et arrivant à échéance le {{bail.date_fin}}.

Il peut être renouvelé avec l’accord écrit du Bailleur.

Chacune des Parties peut y mettre fin moyennant un préavis écrit de {{bail.preavis_mois}} mois ou par accord mutuel.

b) Composition du loyer mensuel

Le montant mensuel total dû par le Preneur s’élève à {{bail.loyer_total_formate}}, composé comme suit :

- Loyer de base : {{bail.loyer_base_formate}}
- Entretien et maintenance : {{bail.frais_entretien_formate}}
- Frais de syndic : {{bail.frais_syndic_formate}}
{{bail.autres_charges_ligne}}

c) Services compris

Le montant convenu comprend les services communs assurés par le Bailleur selon les équipements de l’immeuble et les stipulations convenues entre les Parties.

d) Révision

Les Parties conviennent que les montants prévus au présent contrat peuvent être révisés par accord écrit, notamment en fonction des fluctuations économiques et des réalités du marché immobilier.

ARTICLE 03 — GARANTIE LOCATIVE ET PREMIER PAIEMENT

a) La garantie locative correspond à {{bail.garantie_nombre_mois}} mois de loyer de base, soit :

{{bail.loyer_base_formate}} × {{bail.garantie_nombre_mois}} = {{bail.garantie_montant_formate}}.

b) Le Preneur est tenu de verser la totalité de la garantie locative au Bailleur lors de la signature du présent contrat, contre quittance.

c) La garantie locative ne produit aucun intérêt. Elle est remboursable à la fin du bail, après déduction des sommes restant dues au Bailleur.

ARTICLE 04 — IMPÔTS ET TAXES

Chaque Partie supporte les impôts, taxes et obligations légales mis à sa charge par la réglementation applicable.

ARTICLE 05 — DESTINATION COMMERCIALE, CESSION ET SOUS-LOCATION

Le Preneur exerce dans les lieux l’activité commerciale déclarée suivante : {{bail.activite_destination}}.

Toute modification substantielle de cette destination doit faire l’objet d’un accord écrit préalable du Bailleur.

La cession du bail, la sous-location totale ou partielle, ainsi que la mise à disposition des lieux à un tiers, sont interdites sans l’autorisation écrite préalable du Bailleur.

ARTICLE 06 — ENTRETIEN, AMÉNAGEMENTS ET EXPLOITATION

Le Preneur maintient les lieux loués, leurs aménagements et leurs accessoires en bon état d’entretien, de fonctionnement et de propreté.

Les travaux d’aménagement, d’enseigne, d’installation technique ou de transformation ne peuvent être exécutés sans autorisation écrite préalable du Bailleur.

Le Preneur répond des dégradations causées par lui-même, son personnel, ses préposés, ses clients ou ses fournisseurs.

ARTICLE 07 — ASSURANCE ET RESPONSABILITÉ

Le Preneur souscrit les assurances nécessaires à l’exploitation de son activité et à la couverture des risques liés à son occupation des lieux.

ARTICLE 08 — NON-RESPECT DES CLAUSES

En cas de non-respect des obligations du présent contrat, la Partie lésée peut mettre en demeure l’autre Partie d’y remédier, sans préjudice des droits et actions prévus par la loi.

ARTICLE 09 — MODIFICATION DU CONTRAT

Toute modification du présent contrat fait l’objet d’un avenant écrit signé par les deux Parties.

ARTICLE 10 — RÈGLEMENT DES LITIGES ET DISPOSITIONS FINALES

Les Parties s’engagent à rechercher un règlement amiable de tout différend relatif à l’exécution ou à l’interprétation du présent contrat avant toute saisine judiciaire.

À défaut de règlement amiable, les juridictions compétentes de Kinshasa sont seules compétentes, sous réserve des règles légales de compétence applicables.

Le présent contrat est établi à {{bail.lieu_signature}}, en deux exemplaires originaux, un pour chacune des Parties.

Fait à {{bail.lieu_signature}}, le {{bail.date_signature}}.

LE PRENEUR                                      LE BAILLEUR

Nom : ____________________                      Nom : ____________________

Signature : ______________                     Signature : ______________$$,
  TRUE,
  1
FROM target_orgs
WHERE NOT EXISTS (
  SELECT 1
  FROM lease_contract_templates existing
  WHERE existing.organization_id = target_orgs.organization_id
    AND existing.code = 'LEASE_COMMERCIAL'
    AND existing.version = 1
    AND existing.deleted_at IS NULL
);

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
    WHEN slug = 'ng-property-sandbox' THEN 'Contrat de bail à usage professionnel - SANDBOX'
    WHEN slug = 'magic-construction' THEN 'Contrat de bail à usage professionnel - MAGIC CONSTRUCTION'
    ELSE 'Contrat de bail à usage professionnel'
  END,
  'LEASE_PROFESSIONAL',
  1,
  'PROFESSIONAL',
  $$CONTRAT DE BAIL À USAGE PROFESSIONNEL

ENTRE LES SOUSSIGNÉS :

{{bailleur.raison_sociale}}{{bailleur.sigle_phrase}}, {{bailleur.forme_juridique_phrase}}immatriculée au Registre du Commerce et du Crédit Mobilier sous le numéro {{bailleur.rccm}}, enregistrée à l’Identification Nationale sous le numéro {{bailleur.identification_nationale}}, dont le siège social est établi à {{bailleur.adresse_complete}}, représentée par {{bailleur.representant_nom}}, agissant en qualité de {{bailleur.representant_fonction}}, ci-après dénommée « le Bailleur » ;

D’une part,

{{locataire.paragraphe_identification}}

Ci-après dénommé(e) « le Preneur » ;

D’autre part,

Le Bailleur et le Preneur étant ci-après collectivement dénommés « les Parties ».

PRÉCISIONS SUR LE BIEN LOUÉ

Type | Local professionnel
Unité | {{bien.numero_unite}}
Immeuble | {{bien.immeuble}}
Adresse | {{bien.adresse_complete}}
Activité professionnelle | {{bail.activite_destination}}
Date de début du bail | {{bail.date_debut}}

ARTICLE 01 — DESCRIPTION DES LIEUX

Le Bailleur donne à bail au Preneur, qui accepte, l’unité {{bien.numero_unite}}, située dans l’immeuble {{bien.immeuble}}, à l’adresse suivante : {{bien.adresse_complete}}.

Le Preneur reconnaît avoir visité les lieux loués et les connaître parfaitement.

Un état des lieux contradictoire sera établi avant la remise des clés au Preneur.

{{bail.destination_phrase}}

ARTICLE 02 — DURÉE DU BAIL ET LOYER

a) Durée du bail

Le présent contrat est conclu pour une durée de {{bail.duree_texte}}, prenant effet le {{bail.date_debut}} et arrivant à échéance le {{bail.date_fin}}.

Il peut être renouvelé avec l’accord écrit du Bailleur.

Chacune des Parties peut y mettre fin moyennant un préavis écrit de {{bail.preavis_mois}} mois ou par accord mutuel.

b) Composition du loyer mensuel

Le montant mensuel total dû par le Preneur s’élève à {{bail.loyer_total_formate}}, composé comme suit :

- Loyer de base : {{bail.loyer_base_formate}}
- Entretien et maintenance : {{bail.frais_entretien_formate}}
- Frais de syndic : {{bail.frais_syndic_formate}}
{{bail.autres_charges_ligne}}

ARTICLE 03 — GARANTIE LOCATIVE ET PREMIER PAIEMENT

a) La garantie locative correspond à {{bail.garantie_nombre_mois}} mois de loyer de base, soit :

{{bail.loyer_base_formate}} × {{bail.garantie_nombre_mois}} = {{bail.garantie_montant_formate}}.

b) Le Preneur est tenu de verser la totalité de la garantie locative au Bailleur lors de la signature du présent contrat, contre quittance.

c) La garantie locative ne produit aucun intérêt. Elle est remboursable à la fin du bail, après déduction des sommes restant dues au Bailleur.

ARTICLE 04 — DESTINATION PROFESSIONNELLE

Les lieux loués sont affectés à l’activité professionnelle déclarée suivante : {{bail.activite_destination}}.

Toute modification de cette destination professionnelle requiert l’accord écrit préalable du Bailleur.

ARTICLE 05 — PERSONNEL, VISITEURS, SOUS-LOCATION ET MODIFICATIONS

Le Preneur demeure responsable de son personnel, de ses visiteurs, de ses préposés et de toute personne qu’il introduit dans les lieux.

La cession, la sous-location totale ou partielle ainsi que la mise à disposition à un tiers sont interdites sans l’autorisation écrite préalable du Bailleur.

Les travaux, aménagements et transformations des lieux nécessitent également l’accord écrit préalable du Bailleur.

ARTICLE 06 — ENTRETIEN, ASSURANCE ET RESPONSABILITÉ

Le Preneur maintient les lieux loués, leurs aménagements et leurs accessoires en bon état d’entretien, de fonctionnement et de propreté.

Il souscrit les assurances nécessaires à l’exercice de son activité professionnelle.

ARTICLE 07 — IMPÔTS, TAXES ET CHARGES LÉGALES

Chaque Partie supporte les impôts, taxes et obligations légales mis à sa charge par la réglementation applicable.

ARTICLE 08 — NON-RESPECT DES CLAUSES

En cas de non-respect des obligations du présent contrat, la Partie lésée peut mettre en demeure l’autre Partie d’y remédier, sans préjudice des droits et actions prévus par la loi.

ARTICLE 09 — MODIFICATION DU CONTRAT

Toute modification du présent contrat fait l’objet d’un avenant écrit signé par les deux Parties.

ARTICLE 10 — RÈGLEMENT DES LITIGES ET DISPOSITIONS FINALES

Les Parties s’engagent à rechercher un règlement amiable de tout différend relatif à l’exécution ou à l’interprétation du présent contrat avant toute saisine judiciaire.

À défaut de règlement amiable, les juridictions compétentes de Kinshasa sont seules compétentes, sous réserve des règles légales de compétence applicables.

Le présent contrat est établi à {{bail.lieu_signature}}, en deux exemplaires originaux, un pour chacune des Parties.

Fait à {{bail.lieu_signature}}, le {{bail.date_signature}}.

LE PRENEUR                                      LE BAILLEUR

Nom : ____________________                      Nom : ____________________

Signature : ______________                     Signature : ______________$$,
  TRUE,
  1
FROM target_orgs
WHERE NOT EXISTS (
  SELECT 1
  FROM lease_contract_templates existing
  WHERE existing.organization_id = target_orgs.organization_id
    AND existing.code = 'LEASE_PROFESSIONAL'
    AND existing.version = 1
    AND existing.deleted_at IS NULL
);

COMMIT;
