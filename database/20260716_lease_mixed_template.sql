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
    WHEN slug = 'ng-property-sandbox' THEN 'Contrat de bail à usage mixte - SANDBOX'
    WHEN slug = 'magic-construction' THEN 'Contrat de bail à usage mixte - MAGIC CONSTRUCTION'
    ELSE 'Contrat de bail à usage mixte'
  END,
  'LEASE_MIXED',
  1,
  'MIXED',
  $$CONTRAT DE BAIL À USAGE MIXTE

ENTRE LES SOUSSIGNÉS :

{{bailleur.raison_sociale}}{{bailleur.sigle_phrase}}, {{bailleur.forme_juridique_phrase}}immatriculée au Registre du Commerce et du Crédit Mobilier sous le numéro {{bailleur.rccm}}, enregistrée à l’Identification Nationale sous le numéro {{bailleur.identification_nationale}}, dont le siège social est établi à {{bailleur.adresse_complete}}, représentée par {{bailleur.representant_nom}}, agissant en qualité de {{bailleur.representant_fonction}}, ci-après dénommée « le Bailleur » ;

D’une part,

{{locataire.paragraphe_identification}}

Ci-après dénommé(e) « le Preneur » ;

D’autre part,

Le Bailleur et le Preneur étant ci-après collectivement dénommés « les Parties ».

PRÉCISIONS SUR LE BIEN LOUÉ

Type | Bien à usage mixte
Appartement | {{bien.numero_unite}}
Immeuble | {{bien.immeuble}}
Adresse | {{bien.adresse_complete}}
Commune | {{bien.commune}}
Ville | {{bien.ville}}
Usage | {{bail.usage_label}}
Activité / destination | {{bail.activite_destination}}
Date de début du bail | {{bail.date_debut}}

ARTICLE 01 — DESCRIPTION DES LIEUX

Le Bailleur donne à bail au Preneur, qui accepte, l’unité {{bien.numero_unite}}, située dans l’immeuble {{bien.immeuble}}, à l’adresse suivante : {{bien.adresse_complete}}.

Les lieux loués sont destinés à un usage mixte, incluant les affectations déclarées par le Preneur et les stipulations particulières convenues entre les Parties.

{{bail.destination_phrase}}

Un état des lieux contradictoire sera établi avant la remise des clés au Preneur.

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

Le montant convenu comprend les services communs, les équipements collectifs et les prestations expressément prévues par les Parties.

d) Révision

Les Parties conviennent que les montants prévus au présent contrat peuvent être révisés par accord écrit, notamment en fonction des fluctuations économiques et des réalités du marché immobilier.

ARTICLE 03 — GARANTIE LOCATIVE ET PREMIER PAIEMENT

a) La garantie locative correspond à {{bail.garantie_nombre_mois}} mois de loyer de base, soit :

{{bail.loyer_base_formate}} × {{bail.garantie_nombre_mois}} = {{bail.garantie_montant_formate}}.

b) Le Preneur est tenu de verser la totalité de la garantie locative au Bailleur lors de la signature du présent contrat, contre quittance.

c) La garantie locative ne produit aucun intérêt. Elle est remboursable à la fin du bail, après déduction des sommes restant dues au Bailleur.

d) Le Preneur demeure tenu de payer régulièrement le loyer, indépendamment de la garantie locative.

ARTICLE 04 — OBLIGATIONS GÉNÉRALES

Le Preneur s’engage à utiliser les lieux conformément à la destination déclarée, à respecter la réglementation applicable et à préserver la bonne jouissance des autres occupants.

ARTICLE 05 — CESSION, SOUS-LOCATION ET MODIFICATIONS

La cession du bail, la sous-location totale ou partielle ainsi que la mise à disposition des lieux à un tiers sont interdites sans l’autorisation écrite préalable du Bailleur.

Les travaux, aménagements, enseignes ou transformations nécessitent également l’accord écrit préalable du Bailleur.

ARTICLE 06 — ENTRETIEN ET RESPONSABILITÉ

Le Preneur maintient les lieux loués, leurs aménagements et leurs accessoires en bon état d’entretien, de fonctionnement et de propreté.

Il répond des dégradations causées par lui-même, ses préposés, son personnel, ses visiteurs ou toute personne qu’il introduit dans les lieux.

ARTICLE 07 — ASSURANCE

Le Preneur souscrit les assurances nécessaires à l’exercice de ses activités et à la couverture des risques liés à son occupation des lieux.

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
    AND existing.code = 'LEASE_MIXED'
    AND existing.version = 1
    AND existing.deleted_at IS NULL
);

COMMIT;
