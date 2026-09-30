"""Couche 2 : La Bonne Boîte v2 (France Travail) — entreprises à potentiel d'embauche, par métier et département."""
import os, json, time, urllib.parse
from common import load_env, http, ROOT
from fetch_offres_ft import ROME_FAMILLE, DEPTS, REGIONS

load_env()
URL = "https://api.francetravail.io/partenaire/labonneboite/v2/recherche"
ROMES = ["M1855", "M1805", "M1861", "M1818", "M1811", "M1889", "M1853", "M1828", "M1864", "M1806", "M1881", "M1813", "M1827"]


def token():
    body = urllib.parse.urlencode({"grant_type": "client_credentials", "client_id": os.environ["FT_CLIENT_ID"],
                                   "client_secret": os.environ["FT_CLIENT_SECRET"],
                                   "scope": "api_labonneboitev2 search office"}).encode()
    return http("https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire", body,
                {"Content-Type": "application/x-www-form-urlencoded"})[1]["access_token"]


if __name__ == "__main__":
    tok, out = token(), {}
    for reg, deps in DEPTS.items():
        for dep in deps.split():
            for rome in ROMES:
                page = 1
                while True:
                    q = {"rome": rome, "department_number": dep, "page": page, "page_size": 100}
                    try:
                        _, d, _ = http(URL + "?" + urllib.parse.urlencode(q),
                                       headers={"Authorization": f"Bearer {tok}", "Accept": "application/json"})
                    except RuntimeError as e:
                        if "401" in str(e)[:4]: tok = token(); continue
                        print("ERR", dep, rome, str(e)[:200]); break
                    items = (d or {}).get("items", [])
                    for it in items:
                        k = it["siret"]
                        e = out.setdefault(k, {"siret": k, "siren": k[:9], "nom": it.get("company_name"),
                                               "enseigne": it.get("office_name"), "naf": it.get("naf"),
                                               "naf_label": it.get("naf_label"), "ville": it.get("city"),
                                               "cp": it.get("postcode"), "region": REGIONS[reg],
                                               "effectif": f'{it.get("headcount_min")}-{it.get("headcount_max")}',
                                               "potentiel": 0, "haut_potentiel": False, "familles": []})
                        e["potentiel"] = max(e["potentiel"], it.get("hiring_potential") or 0)
                        e["haut_potentiel"] |= bool(it.get("is_high_potential"))
                        f = ROME_FAMILLE[rome]
                        if f not in e["familles"]: e["familles"].append(f)
                    if len(items) < 100: break
                    page += 1
                    time.sleep(0.3)
                time.sleep(0.3)
            print(REGIONS[reg], dep, "→", len(out), flush=True)
    json.dump(list(out.values()), open(os.path.join(ROOT, "data/lbb.json"), "w"), ensure_ascii=False)
    print("TOTAL", len(out))
