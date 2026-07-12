BEGIN;

UPDATE lease_contract_templates
SET is_active = FALSE
WHERE code = 'LEASE_RESIDENTIAL'
  AND deleted_at IS NULL;

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
  'Contrat de bail a usage residentiel - modele Word v6',
  'LEASE_RESIDENTIAL',
  6,
  'RESIDENTIAL',
  $$CONTRAT DE BAIL A USAGE RESIDENTIEL

ENTRE : sociÃ©tÃ© {{LANDLORD_NAME}}, immatriculÃ©e au Registre du commerce et du CrÃ©dit Mobilier de Kinshasa sous le numÃ©ro {{LANDLORD_RCCM}} (RCCM), enregistrÃ©e Ã  lâ€™indentification Nationale au {{LANDLORD_NATIONAL_ID}}, dont le siÃ¨ge social est Ã©tabli Ã  {{LANDLORD_ADDRESS}}, reprÃ©sentÃ©e par son {{LANDLORD_REPRESENTATIVE_TITLE}}, Monsieur {{LANDLORD_REPRESENTATIVE}}. Ci-aprÃ¨s dÃ©nommÃ©e Le Bailleur dâ€™une part ;

{{TENANT_PRESENTATION}}

{{TENANT_PHYSICAL_NOTE}}

PrÃ©cisions

Appartement {{UNIT_FURNISHING}}    {{UNIT_NUMBER}}
Nombre de Chambre    {{BEDROOM_COUNT}}
Nombre de Parking    {{PARKING_COUNT}}
Date de DÃ©but de Contrat    {{START_DATE}}

Article 01 : DE LA DESCRIPTION DU LIEU

Le Bailleur donne Ã  bail au preneur qui accepte la location dâ€™un appartement N {{UNIT_NUMBER}} Immeuble {{BUILDING_NAME}} situÃ© sur {{BUILDING_ADDRESS}}. {{BUILDING_COMMUNE}}, {{BUILDING_NEIGHBORHOOD}}, dans la Ville de {{BUILDING_CITY}}, RÃ©publique DÃ©mocratique du Congo. Le Preneur connaÃ®t avoir visitÃ© les biens louÃ©s quâ€™il connaÃ®t parfaitement sans quâ€™il soit nÃ©cessaire dâ€™en faire de plus amples descriptions.

Toutefois, un Ã©tat des lieux contradictoire avec ou sans tÃ©moin sera dressÃ© avant la remise des clÃ©s au preneur. Les biens louÃ©s sont destinÃ©s Ã  lâ€™usage rÃ©sidentiel.

Article 02 : DE LA DUREE DU BAIL ET DU LOYER

a) Sâ€™agissant de la durÃ©e, le prÃ©sent contrat de bail est conclus pour une durÃ©e de {{LEASE_DURATION_TEXT}} et entre en vigueur Ã  la date de sa signature. Il est renouvelable avec lâ€™accord du bailleur par Ã©crit. Chacune des deux parties peut y mettre fin moyennant un prÃ©avis de {{NOTICE_MONTHS}} mois ou par convention mutuelle. Dans ce cas, la partie qui prend lâ€™initiative de mettre fin au contrat devra notifier Ã  lâ€™autre son intention Ã©crite, transmise par la lettre recommandÃ©e ou par lettre avec accusÃ© de rÃ©ceptions sous peine dâ€™indemnitÃ©s pour rupture abusive.

b) Le loyer mensuel du local est constituÃ© de {{MONTHLY_TOTAL}} {{CURRENCY}} le mois dont :

{{RENT_BREAKDOWN}}

c) Le loyer ainsi convenu comprend lâ€™entretien des parties communes, les factures dâ€™eau et dâ€™Ã©lectricitÃ©, les camÃ©ras de surveillance et tout autre espace en commun Ã  lâ€™exclusion des services dâ€™entretien des climatiseurs ou de rÃ©paration de tout autre accessoire.

d) Les parties conviennent que le loyer pourra Ãªtre revu par la Direction du bailleur eu Ã©gard aux fluctuations Ã©conomique liÃ©es aux rÃ©alitÃ©s du marchÃ© immobilier.

Article 03 : DE LA GARANTIE LOCATIVE ET PREMIER PAIEMENT

a) La garantie locative Ã©quivaut Ã  {{GUARANTEE_MONTHS}} mois (= {{MONTHLY_TOTAL_RAW}} x {{GUARANTEE_MONTHS}})

b) Le preneur est tenu de verser la totalitÃ© de la garantie au bailleur Ã  la signature du prÃ©sent contrat moyennant quittance.

c) La garantie locative nâ€™est pas productive dâ€™intÃ©rÃªt, elle est remboursable Ã  la fin du bail aprÃ¨s dÃ©duction faite de toutes sommes dues au bailleur Ã  quelque titre que ce soit.

d) Le preneur a lâ€™obligation de payer le loyer sans rÃ©fÃ©rence aucune Ã  la garantie locative.

En dâ€™autres termes, la garantie locative ne peut servir de paiement de loyer, de quelque maniÃ¨re que ce soit, elle ne peut en aucun cas Ãªtre consommÃ©e durant la pÃ©riode de bail.

Article 04 : IMPOTS ET TAXES

Le locataire nâ€™est pas tenu de retenir lâ€™impÃ´t sur le Revenu Locative (IRL) ou de payer toutes autres taxes liÃ©es Ã  ce bail, en tant que le loyer constitue le chiffre dâ€™affaires de la SociÃ©tÃ© {{LANDLORD_NAME}}, en tant que telle comme le stipule son objectif social.

Lâ€™impÃ´t Foncier est Ã  la charge du bailleur.

Article 05 : DE Lâ€™INTERDICTION DE LA CESSION, DE LA SOUS-LOCALISATION ET DE LA MODIFICATION

a) Il a interdit au preneur de cÃ©der en tout ou en partie du prÃ©sent contrat ni de sous-louer tout ou une partie des biens louÃ©s Ã  un tiers.

b) Il est interdit au preneur de modifier tout ou une partie des biens louÃ©s, ni mÃªme dâ€™enforcer un clou dans le mur sauf autorisation Ã©crite prÃ©alable du bailleur.

Article 06 : DE Lâ€™ENTRETIEN ET DE NOMBRE Dâ€™0CCUPANTS

1. Le Preneur tiendra les lieux louÃ©s, leurs amÃ©nagements et leurs accessoires en bon Ã©tat dâ€™entretien, de fonctionnement, de propriÃ©tÃ© et de rÃ©paration locative et jouira du bien louÃ© en bon pÃ¨re de famille ;

2. En cas de besoin, le tenant devra procÃ©der au remplacement des accessoires Ã©lectriques (ampoules, prises, sockets, interrupteur, et de plomberie (robinets) et ce, sous le contrÃ´le et la surveillance du bailleur durant toute la pÃ©riode de bail.

3. Il laissera visiter les lieux Ã  tout moment par le Bailleur ou son reprÃ©sentant et ce, aux Ã©poques que celui-ci jugera convenablement Ã  condition dâ€™en prÃ©venir le Preneur deux jours Ã  lâ€™avance et le preneur ne pourra sâ€™opposer Ã  cette visite.

4. Pour occuper un (1) appartement de {{BEDROOM_COUNT_TEXT}} chambres, il nâ€™est autorisÃ© quâ€™une seule famille. Pour des cas dâ€™occupation individuelle, 2 Ã  3 personnes cÃ©libataires peuvent partager un mÃªme appartement.

5. Un parking est ordinairement rÃ©servÃ© Ã  chaque appartement.

A la fin du bail, aprÃ¨s constat de lâ€™Ã©tat des lieux, le preneur est tenu de remettre lâ€™appartement dans lâ€™Ã©tat oÃ¹ il avait pris. En espÃ¨ce, le Bailleur devra rafraÃ®chir les murs des lieux louÃ©s ainsi que la rÃ©paration des tous dÃ©gÃ¢t que pourra subir lâ€™appartement du fait du preneur aux frais exclusifs du preneur.

A dÃ©faut, le bailleur sera obligÃ© de retenir automatiquement les frais y relatifs aprÃ¨s expertise et Ã©valuation du coÃ»t des travaux sur la garantie locative mÃªme sans lâ€™accord prÃ©alable du preneur. La fin du bail ne sera effective que par la remise par la remise par le preneur au bailleur de toutes les clÃ©s de lâ€™appartement occupÃ©.

Article 08 : DE Lâ€™ASSURANCE

Sur accord des parties, le preneur souscrit lâ€™assurance-incendie devant une compagnie dâ€™assurance de son choix Ã©tablie Ã  Kinshasa devant couvrir son appartement contre les Ã©ventuels risques.

Toutes fois, les rÃ©parations ainsi que le remplacement des climatiseurs, ampoules, prises seront Ã  la charge du preneur qui est tenu dâ€™informer au bailleur aussitÃ´t quâ€™il constatera leur dysfonctionnement.

AprÃ¨s Ã©valuation du coÃ»t par lâ€™expert du bailleur commis Ã  cet effet, le preneur remettra au bailleur le jour suivant les frais nÃ©cessaires pour leur mise en Ã©tat.

Article 09 : DU NON-RESPECT DES CLAUSES

a) En cas de non-respect de lâ€™une des clauses, le bailleur peut rÃ©silier le contrat de bail moyennant un prÃ©avis de {{NOTICE_MONTHS}} mois ;

b) Si lâ€™une des dispositions nâ€™a pas Ã©tÃ© prise en compte dans le prÃ©sent contrat, les parties conviennent de se rÃ©fÃ©rer Ã  la loi nÂ° 15/025 du 31 dÃ©cembre 2015 relative aux baux Ã  loyer non professionnels.

c) En cas dâ€™abus grave, le bailleur a le droit de rÃ©silier le contrat avec un effet immÃ©diat.

Article 10 : DE LA MODIFICATION DU CONTRAT

Toute modification du prÃ©sent contrat de bail fera lâ€™objectif dâ€™un avenant signÃ© par les deux parties et sera annexÃ© au prÃ©sent Contrat de bail.

Article 11 : DE LA CONCLUSION

Les parties fourniront leurs meilleurs efforts en vue du rÃ¨glement Ã  lâ€™amiable de tout litige qui pourrait surgir ou qui serait en relation avec lâ€™exÃ©cution ou lâ€™interprÃ©tation du, prÃ©sent bail avant toute saisine judiciaire.

Tous les litiges entre les parties seront rÃ¨gles a lâ€™amiable, a dÃ©fauts seuls les Cours et Tribunaux de Kinshasa sont compÃ©tents pour leurs rÃ©solutions.

Ainsi, fait Ã  Kinshasa en deux exemplaires, les parties reconnaissent le sein en date de signature.

Fait Ã  {{SIGNATURE_PLACE}}, le {{SIGNATURE_DATE}}

LE PRENEUR                                                                                                              LE BAILLEUR

--- FIN DU MODÃˆLE ---$$,
  TRUE,
  1
FROM company_settings
ON CONFLICT (organization_id, code, version) DO NOTHING;

COMMIT;
