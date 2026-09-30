#!/bin/sh
# Mise à jour des offres et du potentiel d'embauche, puis régénération de la page.
# La base entreprises (fetch_entreprises.py) et les partenaires Odoo bougent peu : à relancer une fois par mois.
set -e
cd "$(dirname "$0")"
python3 fetch_offres_ft.py
python3 fetch_offres_adzuna.py
python3 fetch_lba.py
python3 fetch_lbb.py
python3 build.py
python3 check_links.py   # repère les offres déjà pourvues (lien mort)
python3 build.py
.venv/bin/python make_site.py
