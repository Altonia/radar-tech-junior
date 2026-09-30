"""Couche 3 bis : La Bonne Alternance (api.apprentissage.beta.gouv.fr) — offres d'alternance + recruteurs d'alternants.
Nécessite LBA_TOKEN. L'API utilise encore les codes ROME v3."""
import os, re, json, time, urllib.parse
from common import load_env, http, classer_poste, norm, EXCLU, ROOT
from build import DEPT2REG

load_env()
URL = "https://api.apprentissage.beta.gouv.fr/api/job/v1/search"
ROMES = {"M1805": "Développement", "M1806": "AMOA / Consultant SI", "M1803": "Chef de projet / PO", "M1802": None}
VILLES = {  # centre, rayon km
    "Paris": (48.8566, 2.3522, 10), "La Défense": (48.8918, 2.2380, 10), "Saint-Denis": (48.9362, 2.3574, 10),
    "Versailles": (48.8049, 2.1204, 15), "Massy": (48.7309, 2.2713, 15), "Créteil": (48.7904, 2.4556, 15),
    "Cergy": (49.0364, 2.0761, 20), "Marne-la-Vallée": (48.8420, 2.6500, 20), "Évry": (48.6290, 2.4410, 20),
    "Nantes": (47.2184, -1.5536, 30), "Saint-Nazaire": (47.2735, -2.2138, 25), "Angers": (47.4784, -0.5632, 35),
    "Le Mans": (48.0061, 0.1996, 35), "Laval": (48.0707, -0.7734, 35), "La Roche-sur-Yon": (46.6705, -1.4260, 40),
    "Cholet": (47.0600, -0.8790, 25), "Rennes": (48.1173, -1.6778, 35), "Brest": (48.3904, -4.4861, 35),
    "Quimper": (47.9960, -4.1020, 30), "Lorient": (47.7483, -3.3700, 25), "Vannes": (47.6582, -2.7608, 25),
    "Saint-Brieuc": (48.5140, -2.7650, 30), "Lannion": (48.7326, -3.4566, 25), "Saint-Malo": (48.6493, -2.0257, 25),
}
cp_of = lambda addr: (re.search(r"\b(\d{5})\b", addr or "") or [None, None])[1]

if __name__ == "__main__":
    h = {"Authorization": "Bearer " + os.environ["LBA_TOKEN"], "Accept": "application/json"}
    jobs, recr = {}, {}
    for ville, (lat, lon, rad) in VILLES.items():
        for rome, fam_rome in ROMES.items():
            q = {"latitude": lat, "longitude": lon, "radius": rad, "romes": rome}
            _, d, _ = http(URL + "?" + urllib.parse.urlencode(q), headers=h)
            for j in d.get("jobs", []):
                w, off, c = j["workplace"], j["offer"], j.get("contract") or {}
                cp = cp_of((w.get("location") or {}).get("address")); reg = DEPT2REG.get((cp or "")[:2])
                if not reg: continue
                fam, _ = classer_poste(off["title"])
                if fam is None and rome == "M1805" and not EXCLU.search(norm(off["title"])): fam = fam_rome
                niveau = (off.get("target_diploma") or {}).get("european")
                if not fam or (niveau and niveau < "6"): continue  # Bac+2 et moins : hors cible
                jobs[j["identifier"]["id"]] = {
                    "source": "La Bonne Alternance", "id": j["identifier"]["id"], "titre": off["title"],
                    "famille": fam, "junior_ok": True, "alternance": True,
                    "contrat": ", ".join(c.get("type") or []) or "Alternance",
                    "diplome": (off.get("target_diploma") or {}).get("label"),
                    "entreprise": w.get("brand") or w.get("legal_name") or w.get("name"),
                    "siret": w.get("siret"), "naf": ((w.get("domain") or {}).get("naf") or {}).get("code"),
                    "lieu": ville, "cp": cp, "region": reg, "date": (c.get("start") or "")[:10],
                    "url": (j.get("apply") or {}).get("url"), "description": (off.get("description") or "")[:1500]}
            for r in d.get("recruiters", []):
                w = r["workplace"]; cp = cp_of((w.get("location") or {}).get("address"))
                reg = DEPT2REG.get((cp or "")[:2]); naf = ((w.get("domain") or {}).get("naf") or {}).get("code") or ""
                if not reg or not w.get("siret"): continue
                e = recr.setdefault(w["siret"], {"siret": w["siret"], "siren": w["siret"][:9], "region": reg,
                                                 "nom": w.get("brand") or w.get("legal_name"), "naf": naf,
                                                 "naf_label": ((w.get("domain") or {}).get("naf") or {}).get("label"),
                                                 "effectif": w.get("size"), "cp": cp, "adresse": w["location"].get("address"),
                                                 "url": (r.get("apply") or {}).get("url"), "romes": []})
                if rome not in e["romes"]: e["romes"].append(rome)
            time.sleep(0.3)
        print(ville, "offres", len(jobs), "recruteurs", len(recr), flush=True)
    json.dump(list(jobs.values()), open(os.path.join(ROOT, "data/offres_lba.json"), "w"), ensure_ascii=False)
    json.dump(list(recr.values()), open(os.path.join(ROOT, "data/lba_recruteurs.json"), "w"), ensure_ascii=False)
    print("TOTAL offres", len(jobs), "recruteurs", len(recr))
