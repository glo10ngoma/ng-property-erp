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
      WHEN target_orgs.organization_id = 6 THEN 'Contrat de bail Ã  usage rÃ©sidentiel - modÃ¨le UTF-8 v7 SANDBOX'
      ELSE 'Contrat de bail Ã  usage rÃ©sidentiel - modÃ¨le UTF-8 v7'
    END,
    'LEASE_RESIDENTIAL',
    7,
    'RESIDENTIAL',
    $$CONTRAT DE BAIL Ã€ USAGE {{bail.usage_label_upper}}

ENTRE LES SOUSSIGNÃ‰S :

{{bailleur.raison_sociale}}{{bailleur.sigle_phrase}}, {{bailleur.forme_juridique_phrase}}immatriculÃ©e au Registre du Commerce et du CrÃ©dit Mobilier sous le numÃ©ro {{bailleur.rccm}}, enregistrÃ©e Ã  lâ€™Identification Nationale sous le numÃ©ro {{bailleur.identification_nationale}}, dont le siÃ¨ge social est Ã©tabli Ã  {{bailleur.adresse_complete}}, reprÃ©sentÃ©e par {{bailleur.representant_nom}}, agissant en qualitÃ© de {{bailleur.representant_fonction}}, ci-aprÃ¨s dÃ©nommÃ©e Â« le Bailleur Â» ;

Dâ€™une part,

{{locataire.paragraphe_identification}}

Ci-aprÃ¨s dÃ©nommÃ©(e) Â« le Preneur Â» ;

Dâ€™autre part,

Le Bailleur et le Preneur Ã©tant ci-aprÃ¨s collectivement dÃ©nommÃ©s Â« les Parties Â».

PRÃ‰CISIONS SUR LE BIEN LOUÃ‰

Type | Appartement {{bien.meuble_label}}
Appartement | {{bien.numero_unite}}
Immeuble | {{bien.immeuble}}
Nombre de chambres | {{bien.nombre_chambres}}
Nombre de parkings | {{bien.nombre_parkings}}
Date de dÃ©but du bail | {{bail.date_debut}}

ARTICLE 01 â€” DESCRIPTION DES LIEUX

Le Bailleur donne Ã  bail au Preneur, qui accepte, lâ€™appartement {{bien.numero_unite}}, situÃ© dans lâ€™immeuble {{bien.immeuble}}, Ã  lâ€™adresse suivante : {{bien.adresse_complete}}.

Le Preneur reconnaÃ®t avoir visitÃ© les lieux louÃ©s et les connaÃ®tre parfaitement, sans quâ€™il soit nÃ©cessaire dâ€™en faire une description plus dÃ©taillÃ©e.

Toutefois, un Ã©tat des lieux contradictoire, dressÃ© avec ou sans tÃ©moin, sera Ã©tabli avant la remise des clÃ©s au Preneur.

Les lieux louÃ©s sont destinÃ©s Ã  un usage {{bail.usage_label_lower}}.

ARTICLE 02 â€” DURÃ‰E DU BAIL ET LOYER

a) DurÃ©e du bail

Le prÃ©sent contrat est conclu pour une durÃ©e de {{bail.duree_texte}}, prenant effet le {{bail.date_debut}} et arrivant Ã  Ã©chÃ©ance le {{bail.date_fin}}.

Il peut Ãªtre renouvelÃ© avec lâ€™accord Ã©crit du Bailleur.

Chacune des Parties peut y mettre fin moyennant un prÃ©avis Ã©crit de {{bail.preavis_mois}} mois ou par accord mutuel.

La Partie qui prend lâ€™initiative de mettre fin au contrat doit notifier son intention Ã  lâ€™autre Partie par lettre recommandÃ©e ou par lettre avec accusÃ© de rÃ©ception, sous peine des indemnitÃ©s Ã©ventuellement dues pour rupture abusive.

b) Composition du loyer mensuel

Le montant mensuel total dÃ» par le Preneur sâ€™Ã©lÃ¨ve Ã  {{bail.loyer_total_formate}}, composÃ© comme suit :

- Loyer de base : {{bail.loyer_base_formate}}
- Entretien et maintenance : {{bail.frais_entretien_formate}}
- Frais de syndic : {{bail.frais_syndic_formate}}
{{bail.autres_charges_ligne}}

c) Services compris

Le montant convenu comprend lâ€™entretien des parties communes, les factures dâ€™eau et dâ€™Ã©lectricitÃ© lorsque celles-ci sont expressÃ©ment incluses, les camÃ©ras de surveillance ainsi que les autres services communs prÃ©vus par le Bailleur.

Il ne comprend pas lâ€™entretien des climatiseurs ni la rÃ©paration ou le remplacement des accessoires privatifs, sauf disposition contraire expressÃ©ment convenue entre les Parties.

d) RÃ©vision

Les Parties conviennent que les montants prÃ©vus au prÃ©sent contrat peuvent Ãªtre rÃ©visÃ©s par accord Ã©crit, notamment en fonction des fluctuations Ã©conomiques et des rÃ©alitÃ©s du marchÃ© immobilier.

ARTICLE 03 â€” GARANTIE LOCATIVE ET PREMIER PAIEMENT

a) La garantie locative correspond Ã  {{bail.garantie_nombre_mois}} mois de loyer de base, soit :

{{bail.loyer_base_formate}} Ã— {{bail.garantie_nombre_mois}} = {{bail.garantie_montant_formate}}.

b) Le Preneur est tenu de verser la totalitÃ© de la garantie locative au Bailleur lors de la signature du prÃ©sent contrat, contre quittance.

c) La garantie locative ne produit aucun intÃ©rÃªt. Elle est remboursable Ã  la fin du bail, aprÃ¨s dÃ©duction de toutes les sommes restant dues au Bailleur, Ã  quelque titre que ce soit.

d) Le Preneur demeure tenu de payer rÃ©guliÃ¨rement le loyer, indÃ©pendamment de la garantie locative.

La garantie locative ne peut servir au paiement du loyer ni Ãªtre consommÃ©e pendant la durÃ©e du bail.

ARTICLE 04 â€” IMPÃ”TS ET TAXES

Le Preneur nâ€™est pas tenu de retenir lâ€™ImpÃ´t sur les Revenus Locatifs ni de supporter les taxes qui, conformÃ©ment Ã  la lÃ©gislation applicable, sont Ã  la charge du Bailleur.

Lâ€™impÃ´t foncier demeure Ã  la charge du Bailleur.

ARTICLE 05 â€” INTERDICTION DE CESSION, DE SOUS-LOCATION ET DE MODIFICATION

a) Il est interdit au Preneur de cÃ©der tout ou partie du prÃ©sent contrat ou de sous-louer tout ou partie des lieux louÃ©s Ã  un tiers sans lâ€™autorisation Ã©crite prÃ©alable du Bailleur.

b) Il est interdit au Preneur de modifier tout ou partie des lieux louÃ©s, y compris dâ€™enfoncer des clous dans les murs ou dâ€™effectuer des travaux, sans lâ€™autorisation Ã©crite prÃ©alable du Bailleur.

ARTICLE 06 â€” ENTRETIEN DES LIEUX ET NOMBRE Dâ€™OCCUPANTS

1. Le Preneur maintient les lieux louÃ©s, leurs amÃ©nagements et leurs accessoires en bon Ã©tat dâ€™entretien, de fonctionnement, de propretÃ© et de rÃ©paration locative. Il jouit des lieux louÃ©s de maniÃ¨re paisible et responsable.

2. En cas de besoin, le Preneur procÃ¨de, Ã  ses frais, au remplacement des accessoires Ã©lectriques et de plomberie relevant de lâ€™usage courant, notamment les ampoules, prises, douilles, interrupteurs et robinets, sous le contrÃ´le du Bailleur pendant toute la durÃ©e du bail.

3. Le Preneur autorise le Bailleur ou son reprÃ©sentant Ã  visiter les lieux, Ã  condition dâ€™en Ãªtre informÃ© au moins deux jours Ã  lâ€™avance, sauf situation dâ€™urgence.

4. Pour un appartement de {{bien.nombre_chambres}} chambre(s), lâ€™occupation autorisÃ©e correspond Ã  une seule famille. En cas dâ€™occupation individuelle partagÃ©e, le nombre dâ€™occupants doit rester conforme aux conditions convenues entre les Parties et aux capacitÃ©s du logement.

5. {{bien.nombre_parkings_phrase}}

Ã€ la fin du bail, aprÃ¨s Ã©tablissement de lâ€™Ã©tat des lieux de sortie, le Preneur est tenu de restituer lâ€™appartement dans lâ€™Ã©tat dans lequel il lâ€™a reÃ§u, sous rÃ©serve de lâ€™usure normale.

Les rÃ©parations rendues nÃ©cessaires par des dÃ©gradations imputables au Preneur sont effectuÃ©es Ã  ses frais.

Ã€ dÃ©faut, le Bailleur peut retenir sur la garantie locative les frais correspondants, aprÃ¨s expertise et Ã©valuation du coÃ»t des travaux.

La fin du bail ne devient effective quâ€™aprÃ¨s la remise au Bailleur de toutes les clÃ©s des lieux louÃ©s.

ARTICLE 07 â€” ASSURANCE ET RESPONSABILITÃ‰ RELATIVE AUX Ã‰QUIPEMENTS

Avec lâ€™accord des Parties, le Preneur souscrit une assurance incendie auprÃ¨s dâ€™une compagnie dâ€™assurance de son choix lÃ©galement Ã©tablie, afin de couvrir les lieux louÃ©s contre les risques concernÃ©s.

Les rÃ©parations et le remplacement des climatiseurs, ampoules, prises et autres accessoires relevant de lâ€™usage du Preneur restent Ã  sa charge lorsquâ€™ils rÃ©sultent de son utilisation ou dâ€™un dÃ©faut dâ€™entretien.

Le Preneur doit informer le Bailleur dÃ¨s quâ€™il constate un dysfonctionnement.

AprÃ¨s Ã©valuation du coÃ»t par un expert dÃ©signÃ© par le Bailleur, le Preneur verse les sommes nÃ©cessaires Ã  la remise en Ã©tat dans le dÃ©lai convenu entre les Parties.

ARTICLE 08 â€” NON-RESPECT DES CLAUSES

a) En cas de non-respect de lâ€™une des clauses du prÃ©sent contrat, le Bailleur peut engager la procÃ©dure de rÃ©siliation du bail moyennant le prÃ©avis prÃ©vu, sauf faute grave justifiant une mesure immÃ©diate conformÃ©ment Ã  la loi.

b) Pour toute disposition non prÃ©vue par le prÃ©sent contrat, les Parties conviennent de se rÃ©fÃ©rer Ã  la lÃ©gislation congolaise applicable aux baux Ã  loyer non professionnels, notamment la loi nÂ° 15/025 du 31 dÃ©cembre 2015, sous rÃ©serve de son applicabilitÃ© au prÃ©sent bail.

c) En cas de manquement grave, le Bailleur peut demander la rÃ©siliation immÃ©diate du contrat dans les conditions prÃ©vues par la loi.

ARTICLE 09 â€” MODIFICATION DU CONTRAT

Toute modification du prÃ©sent contrat fait lâ€™objet dâ€™un avenant Ã©crit, signÃ© par les deux Parties et annexÃ© au prÃ©sent contrat de bail.

ARTICLE 10 â€” RÃˆGLEMENT DES LITIGES ET DISPOSITIONS FINALES

Les Parties sâ€™engagent Ã  fournir leurs meilleurs efforts afin de rÃ©gler Ã  lâ€™amiable tout diffÃ©rend relatif Ã  lâ€™exÃ©cution ou Ã  lâ€™interprÃ©tation du prÃ©sent contrat avant toute saisine judiciaire.

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
