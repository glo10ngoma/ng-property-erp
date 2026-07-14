BEGIN;

WITH target_orgs AS (
  SELECT id AS organization_id
  FROM organizations
  WHERE slug IN ('catalyse', 'ng-property-sandbox')
),
inserted AS (
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
    target_orgs.organization_id,
    CASE
      WHEN target_orgs.organization_id = 6 THEN 'Contrat de bail à usage résidentiel - modèle UTF-8 v7 SANDBOX'
      ELSE 'Contrat de bail à usage résidentiel - modèle UTF-8 v7'
    END,
    'LEASE_RESIDENTIAL',
    7,
    'RESIDENTIAL',
    $$CONTRAT DE BAIL À USAGE {{bail.usage_label_upper}}

ENTRE LES SOUSSIGNÉS :

{{bailleur.raison_sociale}}{{bailleur.sigle_phrase}}, {{bailleur.forme_juridique_phrase}}immatriculée au Registre du Commerce et du Crédit Mobilier sous le numéro {{bailleur.rccm}}, enregistrée à l’Identification Nationale sous le numéro {{bailleur.identification_nationale}}, dont le siège social est établi à {{bailleur.adresse_complete}}, représentée par {{bailleur.representant_nom}}, agissant en qualité de {{bailleur.representant_fonction}}, ci-après dénommée « le Bailleur » ;

D’une part,

{{locataire.paragraphe_identification}}

Ci-après dénommé(e) « le Preneur » ;

D’autre part,

Le Bailleur et le Preneur étant ci-après collectivement dénommés « les Parties ».

PRÉCISIONS SUR LE BIEN LOUÉ

Type | Appartement {{bien.meuble_label}}
Appartement | {{bien.numero_unite}}
Immeuble | {{bien.immeuble}}
Nombre de chambres | {{bien.nombre_chambres}}
Nombre de parkings | {{bien.nombre_parkings}}
Date de début du bail | {{bail.date_debut}}

ARTICLE 01 — DESCRIPTION DES LIEUX

Le Bailleur donne à bail au Preneur, qui accepte, l’appartement {{bien.numero_unite}}, situé dans l’immeuble {{bien.immeuble}}, à l’adresse suivante : {{bien.adresse_complete}}.

Le Preneur reconnaît avoir visité les lieux loués et les connaître parfaitement, sans qu’il soit nécessaire d’en faire une description plus détaillée.

Toutefois, un état des lieux contradictoire, dressé avec ou sans témoin, sera établi avant la remise des clés au Preneur.

Les lieux loués sont destinés à un usage {{bail.usage_label_lower}}.

ARTICLE 02 — DURÉE DU BAIL ET LOYER

a) Durée du bail

Le présent contrat est conclu pour une durée de {{bail.duree_texte}}, prenant effet le {{bail.date_debut}} et arrivant à échéance le {{bail.date_fin}}.

Il peut être renouvelé avec l’accord écrit du Bailleur.

Chacune des Parties peut y mettre fin moyennant un préavis écrit de {{bail.preavis_mois}} mois ou par accord mutuel.

La Partie qui prend l’initiative de mettre fin au contrat doit notifier son intention à l’autre Partie par lettre recommandée ou par lettre avec accusé de réception, sous peine des indemnités éventuellement dues pour rupture abusive.

b) Composition du loyer mensuel

Le montant mensuel total dû par le Preneur s’élève à {{bail.loyer_total_formate}}, composé comme suit :

- Loyer de base : {{bail.loyer_base_formate}}
- Entretien et maintenance : {{bail.frais_entretien_formate}}
- Frais de syndic : {{bail.frais_syndic_formate}}
{{bail.autres_charges_ligne}}

c) Services compris

Le montant convenu comprend l’entretien des parties communes, les factures d’eau et d’électricité lorsque celles-ci sont expressément incluses, les caméras de surveillance ainsi que les autres services communs prévus par le Bailleur.

Il ne comprend pas l’entretien des climatiseurs ni la réparation ou le remplacement des accessoires privatifs, sauf disposition contraire expressément convenue entre les Parties.

d) Révision

Les Parties conviennent que les montants prévus au présent contrat peuvent être révisés par accord écrit, notamment en fonction des fluctuations économiques et des réalités du marché immobilier.

ARTICLE 03 — GARANTIE LOCATIVE ET PREMIER PAIEMENT

a) La garantie locative correspond à {{bail.garantie_nombre_mois}} mois de loyer de base, soit :

{{bail.loyer_base_formate}} × {{bail.garantie_nombre_mois}} = {{bail.garantie_montant_formate}}.

b) Le Preneur est tenu de verser la totalité de la garantie locative au Bailleur lors de la signature du présent contrat, contre quittance.

c) La garantie locative ne produit aucun intérêt. Elle est remboursable à la fin du bail, après déduction de toutes les sommes restant dues au Bailleur, à quelque titre que ce soit.

d) Le Preneur demeure tenu de payer régulièrement le loyer, indépendamment de la garantie locative.

La garantie locative ne peut servir au paiement du loyer ni être consommée pendant la durée du bail.

ARTICLE 04 — IMPÔTS ET TAXES

Le Preneur n’est pas tenu de retenir l’Impôt sur les Revenus Locatifs ni de supporter les taxes qui, conformément à la législation applicable, sont à la charge du Bailleur.

L’impôt foncier demeure à la charge du Bailleur.

ARTICLE 05 — INTERDICTION DE CESSION, DE SOUS-LOCATION ET DE MODIFICATION

a) Il est interdit au Preneur de céder tout ou partie du présent contrat ou de sous-louer tout ou partie des lieux loués à un tiers sans l’autorisation écrite préalable du Bailleur.

b) Il est interdit au Preneur de modifier tout ou partie des lieux loués, y compris d’enfoncer des clous dans les murs ou d’effectuer des travaux, sans l’autorisation écrite préalable du Bailleur.

ARTICLE 06 — ENTRETIEN DES LIEUX ET NOMBRE D’OCCUPANTS

1. Le Preneur maintient les lieux loués, leurs aménagements et leurs accessoires en bon état d’entretien, de fonctionnement, de propreté et de réparation locative. Il jouit des lieux loués de manière paisible et responsable.

2. En cas de besoin, le Preneur procède, à ses frais, au remplacement des accessoires électriques et de plomberie relevant de l’usage courant, notamment les ampoules, prises, douilles, interrupteurs et robinets, sous le contrôle du Bailleur pendant toute la durée du bail.

3. Le Preneur autorise le Bailleur ou son représentant à visiter les lieux, à condition d’en être informé au moins deux jours à l’avance, sauf situation d’urgence.

4. Pour un appartement de {{bien.nombre_chambres}} chambre(s), l’occupation autorisée correspond à une seule famille. En cas d’occupation individuelle partagée, le nombre d’occupants doit rester conforme aux conditions convenues entre les Parties et aux capacités du logement.

5. {{bien.nombre_parkings_phrase}}

À la fin du bail, après établissement de l’état des lieux de sortie, le Preneur est tenu de restituer l’appartement dans l’état dans lequel il l’a reçu, sous réserve de l’usure normale.

Les réparations rendues nécessaires par des dégradations imputables au Preneur sont effectuées à ses frais.

À défaut, le Bailleur peut retenir sur la garantie locative les frais correspondants, après expertise et évaluation du coût des travaux.

La fin du bail ne devient effective qu’après la remise au Bailleur de toutes les clés des lieux loués.

ARTICLE 07 — ASSURANCE ET RESPONSABILITÉ RELATIVE AUX ÉQUIPEMENTS

Avec l’accord des Parties, le Preneur souscrit une assurance incendie auprès d’une compagnie d’assurance de son choix légalement établie, afin de couvrir les lieux loués contre les risques concernés.

Les réparations et le remplacement des climatiseurs, ampoules, prises et autres accessoires relevant de l’usage du Preneur restent à sa charge lorsqu’ils résultent de son utilisation ou d’un défaut d’entretien.

Le Preneur doit informer le Bailleur dès qu’il constate un dysfonctionnement.

Après évaluation du coût par un expert désigné par le Bailleur, le Preneur verse les sommes nécessaires à la remise en état dans le délai convenu entre les Parties.

ARTICLE 08 — NON-RESPECT DES CLAUSES

a) En cas de non-respect de l’une des clauses du présent contrat, le Bailleur peut engager la procédure de résiliation du bail moyennant le préavis prévu, sauf faute grave justifiant une mesure immédiate conformément à la loi.

b) Pour toute disposition non prévue par le présent contrat, les Parties conviennent de se référer à la législation congolaise applicable aux baux à loyer non professionnels, notamment la loi n° 15/025 du 31 décembre 2015, sous réserve de son applicabilité au présent bail.

c) En cas de manquement grave, le Bailleur peut demander la résiliation immédiate du contrat dans les conditions prévues par la loi.

ARTICLE 09 — MODIFICATION DU CONTRAT

Toute modification du présent contrat fait l’objet d’un avenant écrit, signé par les deux Parties et annexé au présent contrat de bail.

ARTICLE 10 — RÈGLEMENT DES LITIGES ET DISPOSITIONS FINALES

Les Parties s’engagent à fournir leurs meilleurs efforts afin de régler à l’amiable tout différend relatif à l’exécution ou à l’interprétation du présent contrat avant toute saisine judiciaire.

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
      AND existing.code = 'LEASE_RESIDENTIAL'
      AND existing.version = 7
      AND existing.deleted_at IS NULL
  )
  RETURNING organization_id, code, version
)
UPDATE lease_contract_templates previous
SET is_active = FALSE
FROM inserted
WHERE previous.organization_id = inserted.organization_id
  AND previous.code = inserted.code
  AND previous.version < inserted.version
  AND previous.deleted_at IS NULL;

COMMIT;
