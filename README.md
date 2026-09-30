# Radar Tech Junior

Annuaire d'entreprises du numérique et d'offres junior ou alternance pour des profils Bac+5
(dev, IA et data, chef de projet, AMOA, consultant ERP, CRM ou e-commerce) en Île-de-France,
Pays de la Loire et Bretagne. Le site est dans `docs/` (GitHub Pages), avec un export Excel.

## Mettre à jour

```sh
./maj.sh          # offres, potentiel d'embauche, alternance, vérification des liens, site + Excel
git add docs && git commit -m "Mise à jour des données" && git push
```

La base entreprises (`fetch_entreprises.py`), les partenaires Odoo (`partenaires/odoo.py`) et les sites web
(`fetch_sites_wikidata.py`, `fetch_sites_guess.py`) changent peu : à relancer une fois par mois.

Les clés d'API se mettent dans `.env` (jamais commité) : `FT_CLIENT_ID`, `FT_CLIENT_SECRET`, `LBA_TOKEN`,
`ADZUNA_APP_ID`, `ADZUNA_APP_KEY`.

## Sources

Base SIRENE (API Recherche d'entreprises), France Travail (Offres d'emploi v2, La Bonne Boîte),
La Bonne Alternance, Adzuna, annuaire des partenaires Odoo, Wikidata.
