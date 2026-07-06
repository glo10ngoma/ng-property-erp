# Rapports

## Rapport Immeuble

Endpoint:

```text
GET /api/reports/buildings/:id?start=YYYY-MM-DD&end=YYYY-MM-DD
```

Contenu:

- immeuble
- appartements
- occupation
- locataires
- facturation periode
- total facture, paye, restant

## Rapport Paiements

Endpoint:

```text
GET /api/reports/payments?start=YYYY-MM-DD&end=YYYY-MM-DD&building_id=1&tenant_id=1&status=PAID&payment_method=CASH
```

Filtres:

- periode
- immeuble
- locataire
- statut facture
- mode paiement

Contenu:

- paiements recus
- locataires ayant paye
- locataires sans paiement
- factures payees, partielles, non payees et en retard
- total facture, encaisse et restant

## Rapport Locataire

Endpoint:

```text
GET /api/reports/tenants/:id
```

Contenu:

- locataire
- baux
- factures
- paiements
- solde restant

## Rapport Disponibilite

Endpoint:

```text
GET /api/reports/availability
```

Contenu:

- total unites
- occupees
- libres
- maintenance
- bloquees
- loyer potentiel des unites libres
- taux occupation par immeuble

## Rapport Impayes

Endpoint:

```text
GET /api/reports/overdue?building_id=1&tenant_id=1
```

Contenu:

- factures en retard
- locataire
- immeuble
- appartement
- montant facture
- montant paye
- reste a payer

## Dashboard BI

Endpoint:

```text
GET /api/reports/dashboard
```

Contenu:

- occupation
- revenus par immeuble
- paiements mensuels
- impayes
- garanties locatives
- resume caisse

## Export normalise

Endpoint:

```text
GET /api/reports/export?type=availability
```

Types supportes:

- `availability`
- `building`
- `tenant`
- `payments`
- `overdue`

## Rapport Caisse

Endpoint:

```text
GET /api/reports/cash
```

## Rapport Stock

Endpoint:

```text
GET /api/reports/stock
```

Contenu:

- etat stock
- historique mouvements
- inventaires
- articles sous seuil
- ruptures
- articles inactifs
- valorisation du stock

## Rapport Personnel / Paie

Endpoint:

```text
GET /api/reports/staff?start=YYYY-MM-DD&end=YYYY-MM-DD&month=7&year=2026
```

Contenu:

- liste employes
- avances par periode
- conges par periode
- paie par mois
- resume actifs/inactifs, avances et net a payer

## Rapport Maintenance

Endpoint:

```text
GET /api/reports/maintenance?start=YYYY-MM-DD&end=YYYY-MM-DD&building_id=1&employee_id=1
```

Contenu:

- demandes par periode
- interventions ouvertes, urgentes, en retard et terminees
- temps moyen de resolution
- couts maintenance
- rapport par immeuble
- rapport par technicien
- rapport par categorie

Les exports CSV et Excel sont disponibles cote frontend sur les pages de rapports.
