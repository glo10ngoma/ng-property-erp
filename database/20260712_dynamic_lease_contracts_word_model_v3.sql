BEGIN;

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
  'Contrat de bail a usage residentiel - modele Word v3',
  'LEASE_RESIDENTIAL',
  3,
  'RESIDENTIAL',
  $$CONTRAT DE BAIL A USAGE RESIDENTIEL

Entre les soussignes :

LE BAILLEUR
{{LANDLORD_PRESENTATION}}

ET

LE PRENEUR
{{TENANT_PRESENTATION}}

Il a ete convenu ce qui suit :

Nom et numeropiece d identite au cas ouc était une personne
Précisions

Article 01 : DE LA DESCRIPTION DU LIEU
Le Bailleur donne à bail au preneur qui accepte la location d’un appartement {{UNIT_NUMBER}} Immeuble {{BUILDING_NAME}} situé sur {{BUILDING_ADDRESS}}. {{BUILDING_COMMUNE}}, {{BUILDING_NEIGHBORHOOD}}, dans la Ville de {{BUILDING_CITY}}, République Démocratique du Congo. Le Preneur connaît avoir visité les biens loués qu’il connaît parfaitement sans qu’il soit nécessaire d’en faire de plus amples descriptions.
Toutefois, un état des lieux contradictoire avec ou sans témoin sera dressé avant la remise des clés au preneur. Les biens loués sont destinés à l’usage résidentiel.

Article 02 : DE LA DUREE DU BAIL ET DU LOYER
S’agissant de la durée, le présent contrat de bail est conclus pour une durée d’une année et entre en vigueur à la date de sa signature. Il est renouvelable avec l’accord du bailleur par écrit. Chacune des deux parties peut y mettre fin moyennant un préavis de 3 mois ou par convention mutuelle. Dans ce cas, la partie qui prend l’initiative de mettre fin au contrat devra notifier à l’autre son intention écrite, transmise par la lettre recommandée ou par lettre avec accusé de réceptions sous peine d’indemnités pour rupture abusive.

Le loyer mensuel du local est constitué de {{MONTHLY_TOTAL}} USD le mois dont :

{{MONTHLY_RENT}} USD loyer
{{MAINTENANCE_AMOUNT}} USD Entretien et Maintenance
{{SYNDIC_AMOUNT}} USD syndic

Le loyer ainsi convenu comprend l’entretien des parties communes, les factures d’eau et d’électricité, les caméras de surveillance et tout autre espace en commun à l’exclusion des services d’entretien des climatiseurs ou de réparation de tout autre accessoire.
Les parties conviennent que le loyer pourra être revu par la Direction du bailleur eu égard aux fluctuations économique liées aux réalités du marché immobilier.

Article 03 : DE LA GARANTIE LOCATIVE ET PREMIER PAIEMENT

La garantie locative équivaut à {{GUARANTEE_MONTHS}} mois (= {{MONTHLY_RENT}} x {{GUARANTEE_MONTHS}})
Le preneur est tenu de verser la totalité de la garantie au bailleur à la signature du présent contrat moyennant quittance.
La garantie locative n’est pas productive d’intérêt, elle est remboursable à la fin du bail après déduction faite de toutes sommes dues au bailleur à quelque titre que ce soit.
Le preneur a l’obligation de payer le loyer sans référence aucune à la garantie locative.
En d’autres termes, la garantie locative ne peut servir de paiement de loyer, de quelque manière que ce soit, elle ne peut en aucun cas être consommée durant la période de bail.

Article 04 : IMPOTS ET TAXES
Le locataire n’est pas tenu de retenir l’impôt sur le Revenu Locative (IRL) ou de payer toutes autres taxes liées à ce bail, en tant que le loyer constitue le chiffre d’affaires de la Société Catalyse, en tant que telle comme le stipule son objectif social.
L’impôt Foncier est à la charge du bailleur.

Article 05 : DE L’INTERDICTION DE LA CESSION, DE LA SOUS-LOCALISATION ET DE LA MODIFICATION
Il est interdit au preneur de céder en tout ou en partie du présent contrat ni de sous-louer tout ou une partie des biens loués à un tiers.
Il est interdit au preneur de modifier tout ou une partie des biens loués, ni même d’enforcer un clou dans le mur sauf autorisation écrite préalable du bailleur.

Article 06 : DE L’ENTRETIEN ET DE NOMBRE D’0CCUPANTS

Le Preneur tiendra les lieux loués, leurs aménagements et leurs accessoires en bon état d’entretien, de fonctionnement, de propriété et de réparation locative et jouira du bien loué en bon père de famille ;
En cas de besoin, le tenant devra procéder au remplacement des accessoires électriques (ampoules, prises, sockets, interrupteur, et de plomberie (robinets) et ce, sous le contrôle et la surveillance du bailleur durant toute la période de bail.
Il laissera visiter les lieux à tout moment par le Bailleur ou son représentant et ce, aux époques que celui-ci jugera convenablement à condition d’en prévenir le Preneur deux jours à l’avance et le preneur ne pourra s’opposer à cette visite.
Pour occuper un (1) appartement de Deux chambres, il n’est autorisé qu’une seule famille. Pour des cas d’occupation individuelle, 2 à 3 personnes célibataires peuvent partager un même appartement.
Un parking est ordinairement réservé à chaque appartement.
A la fin du bail, après constat de l’état des lieux, le preneur est tenu de remettre l’appartement dans l’état où il avait pris. En espèce, le Bailleur devra rafraîchir les murs des lieux loués ainsi que la réparation des tous dégât que pourra subir l’appartement du fait du preneur aux frais exclusifs du preneur.
A défaut, le bailleur sera obligé de retenir automatiquement les frais y relatifs après expertise et évaluation du coût des travaux sur la garantie locative même sans l’accord préalable du preneur. La fin du bail ne sera effective que par la remise par la remise par le preneur au bailleur de toutes les clés de l’appartement occupé.

Article 08 : DE L’ASSURANCE
Sur accord des parties, le preneur souscrit l’assurance-incendie devant une compagnie d’assurance de son choix établie à Kinshasa devant couvrir son appartement contre les éventuels risques.
Toutes fois, les réparations ainsi que le remplacement des climatiseurs, ampoules, prises seront à la charge du preneur qui est tenu d’informer au bailleur aussitôt qu’il constatera leur dysfonctionnement.
Après évaluation du coût par l’expert du bailleur commis à cet effet, le preneur remettra au bailleur le jour suivant les frais nécessaires pour leur mise en état.

Article 09 : DU NON-RESPECT DES CLAUSES
En cas de non-respect de l’une des clauses, le bailleur peut résilier le contrat de bail moyennant un préavis de 3 mois ;
Si l’une des dispositions n’a pas été prise en compte dans le présent contrat, les parties conviennent de se référer à la loi n° 15/025 du 31 décembre 2015 relative aux baux à loyer non professionnels.
En cas d’abus grave, le bailleur a le droit de résilier le contrat avec un effet immédiat.

Article 10 : DE LA MODIFICATION DU CONTRAT
Toute modification du présent contrat de bail fera l’objet d’un avenant signé par les deux parties et sera annexé au présent Contrat de bail.

Article 11 : DE LA CONCLUSION
Les parties fourniront leurs meilleurs efforts en vue du règlement à l’amiable de tout litige qui pourrait surgir ou qui serait en relation avec l’exécution ou l’interprétation du présent bail avant toute saisine judiciaire.
Tous les litiges entre les parties seront réglés à l’amiable, à défaut seuls les Cours et Tribunaux de Kinshasa sont compétents pour leurs résolutions.
Ainsi, fait à Kinshasa en deux exemplaires, les parties reconnaissent le sien en date de signature.

Fait à Kinshasa, le {{SIGNATURE_DATE}}


LE PRENEUR                                                                                                              LE BAILLEUR

Appartement Non Meublé | {{UNIT_NUMBER}}
Nombre de Chambre | {{bien.nombre_chambres}}
Nombre de Parking  | {{bien.nombre_parkings}}
Date de Début de Contrat | {{START_DATE}}
$$,
  TRUE,
  1
FROM company_settings
ON CONFLICT (organization_id, code, version) DO NOTHING;

COMMIT;
