"""Couche 3 ter : offres Adzuna (agrégateur), catégorie IT, 3 régions.
Nécessite ADZUNA_APP_ID / ADZUNA_APP_KEY (developer.adzuna.com)."""
import os, json, time, urllib.parse
import re
from common import load_env, http, classer_poste, norm, ROOT

load_env()
BASE = "https://api.adzuna.com/v1/api/jobs/fr/search/{page}"
WHERE = {"Île-de-France": "Île-de-France", "Pays de la Loire": "Pays de la Loire", "Bretagne": "Bretagne"}
REQUETES = ["developpeur", "data", "intelligence artificielle", "chef de projet", "product owner", "AMOA",
            "consultant fonctionnel", "ERP", "CRM", "e-commerce", "alternance informatique"]

if __name__ == "__main__":
    offres = {}
    for region, where in WHERE.items():
        for q in REQUETES:
            for page in range(1, 11):  # 50 x 10 max par requête
                p = {"app_id": os.environ["ADZUNA_APP_ID"], "app_key": os.environ["ADZUNA_APP_KEY"],
                     "what": q, "where": where, "category": "it-jobs", "results_per_page": 50,
                     "max_days_old": 31, "content-type": "application/json"}
                _, d, _ = http(BASE.format(page=page) + "?" + urllib.parse.urlencode(p))
                rows = d.get("results", [])
                for o in rows:
                    fam, junior_ok = classer_poste(o.get("title", ""))
                    area = (o.get("location") or {}).get("area") or []
                    if not fam or (len(area) > 1 and norm(area[1]) != norm(region)): continue
                    t, desc = o.get("title", "").lower(), norm(o.get("description"))
                    alt = any(k in t for k in ("alternan", "apprenti", "apprentissage"))
                    ans = [int(a) for a in re.findall(r"(\d+) ans? (?:minimum )?d experience", desc)]
                    if not alt and (not junior_ok or (ans and min(ans) >= 3)): continue  # hors cible junior
                    offres[o["id"]] = {
                        "source": "Adzuna", "id": o["id"], "titre": o.get("title"), "famille": fam,
                        "junior_ok": True, "contrat": o.get("contract_type"),
                        "alternance": alt,
                        "entreprise": (o.get("company") or {}).get("display_name"),
                        "lieu": (o.get("location") or {}).get("display_name"), "region": region,
                        "date": o.get("created"), "url": o.get("redirect_url"),
                        "description": (o.get("description") or "")[:1500],
                    }
                if len(rows) < 50: break
                time.sleep(0.4)
            print(region, q, "→ cumulées", len(offres), flush=True)
    json.dump(list(offres.values()), open(os.path.join(ROOT, "data/offres_adzuna.json"), "w"), ensure_ascii=False)
    print("TOTAL", len(offres))
