"""Couche 1 : entreprises IT actives (>= 3 salariés) en IDF, Pays de la Loire, Bretagne.
Source : API Recherche d'entreprises (recherche-entreprises.api.gouv.fr), sans clé."""
import json, time, sys, urllib.request, urllib.parse

API = "https://recherche-entreprises.api.gouv.fr/search"
REGIONS = {"11": "Île-de-France", "52": "Pays de la Loire", "53": "Bretagne"}
NAF = {
    "62.01Z": "Programmation informatique",
    "62.02A": "Conseil en systèmes et logiciels",
    "62.02B": "Tierce maintenance",
    "62.03Z": "Gestion d'installations informatiques",
    "62.09Z": "Autres activités informatiques",
    "58.29A": "Édition de logiciels système et réseau",
    "58.29B": "Édition de logiciels outils de développement",
    "58.29C": "Édition de logiciels applicatifs",
    "63.11Z": "Traitement de données, hébergement",
    "63.12Z": "Portails Internet",
    "73.11Z": "Agence de publicité (agences web possibles)",
}
# >= 3 salariés (exclut freelances 00/01/NN)
TRANCHES = ["02", "03", "11", "12", "21", "22", "31", "32", "41", "42", "51", "52", "53"]
TRANCHE_LABEL = {"02": "3-5", "03": "6-9", "11": "10-19", "12": "20-49", "21": "50-99", "22": "100-199",
                 "31": "200-249", "32": "250-499", "41": "500-999", "42": "1000-1999", "51": "2000-4999",
                 "52": "5000-9999", "53": "10000+"}


def get(params, retries=5):
    url = API + "?" + urllib.parse.urlencode(params)
    for i in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                return json.load(r)
        except Exception as e:
            time.sleep(2 * (i + 1))
    raise RuntimeError(url)


def fetch(naf, region, tranches):
    page, out = 1, []
    while True:
        d = get({"activite_principale": naf, "region": region, "tranche_effectif_salarie": ",".join(tranches),
                 "etat_administratif": "A", "per_page": 25, "page": page})
        out += d["results"]
        if page >= d["total_pages"]:
            return out, d["total_results"]
        page += 1
        time.sleep(0.16)


def slim(r, region):
    etabs = [e for e in r.get("matching_etablissements", []) if e.get("etat_administratif") == "A"]
    return {
        "siren": r["siren"],
        "nom": r["nom_complet"],
        "sigle": r.get("sigle"),
        "naf": r["activite_principale"],
        "naf_label": NAF.get(r["activite_principale"], ""),
        "tranche": r.get("tranche_effectif_salarie"),
        "effectif": TRANCHE_LABEL.get(r.get("tranche_effectif_salarie"), "?"),
        "categorie": r.get("categorie_entreprise"),
        "date_creation": r.get("date_creation"),
        "idcc": (r.get("complements") or {}).get("liste_idcc"),
        "siege_ville": r["siege"].get("libelle_commune"),
        "siege_cp": r["siege"].get("code_postal"),
        "region_code": region,
        "region": REGIONS[region],
        "etablissements": [{"siret": e["siret"], "adresse": e.get("adresse"), "cp": e.get("code_postal"),
                            "ville": e.get("libelle_commune"), "lat": e.get("latitude"), "lon": e.get("longitude"),
                            "siege": e.get("est_siege")} for e in etabs],
        "finances": r.get("finances"),
        # dirigeants personnes physiques : prénom usuel, nom et rôle seulement (pas de date de naissance)
        "dirigeants": [{"prenom": (d.get("prenoms") or "").split()[0].title() if d.get("prenoms") else "",
                        "nom": (d.get("nom") or "").title(), "role": d.get("qualite") or ""}
                       for d in (r.get("dirigeants") or []) if d.get("type_dirigeant") == "personne physique" and d.get("nom")][:3],
    }


if __name__ == "__main__":
    res = {}
    for region in REGIONS:
        for naf in NAF:
            # 73.11Z : seulement les petites structures (sinon trop de bruit pub/média)
            tr = TRANCHES[:5] if naf == "73.11Z" else TRANCHES
            rows, total = fetch(naf, region, tr)
            for r in rows:
                key = (r["siren"], region)
                res.setdefault(key, slim(r, region))
            print(f"{REGIONS[region]:18} {naf}  {len(rows)}/{total}", flush=True)
    with open("data/entreprises.json", "w") as f:
        json.dump(list(res.values()), f, ensure_ascii=False)
    print("TOTAL", len(res))
