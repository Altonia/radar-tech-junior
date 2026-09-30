"""Couche 3 : offres France Travail (API Offres d'emploi v2), 3 régions, métiers IT Bac+5.
Nécessite FT_CLIENT_ID / FT_CLIENT_SECRET (francetravail.io, API « Offres d'emploi v2 »)."""
import os, json, time, urllib.parse
import re
from common import load_env, http, classer_poste, norm, EXCLU, SENIOR, ROOT

load_env()
TOKEN_URL = "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire"
SEARCH = "https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search"
REGIONS = {"11": "Île-de-France", "52": "Pays de la Loire", "53": "Bretagne"}
# ROME 4.0 retenus pour des Bac+5 (pas de technicien / admin / archi / direction)
ROME_FAMILLE = {
    "IA / Data": "M1889 M1873 M1811 M1405 M1824 M1851 M1872",
    "Développement": "M1805 M1855 M1861 M1818 M1836 M1841 M1852 M1848 M1821 M1827 M1879 M1892 M1831 M1877 M1865 M1815",
    "Chef de projet / PO": "M1853 M1828 M1858 M1859 M1864 M1814 M1886 M1825 M1887",
    "AMOA / Consultant SI": "M1806 M1881 M1875 M1823",
    "Consultant ERP / CRM": "M1813",
}
ROME_FAMILLE = {c: f for f, cs in ROME_FAMILLE.items() for c in cs.split()}
DEPTS = {"11": "75 77 78 91 92 93 94 95", "52": "44 49 53 72 85", "53": "22 29 35 56"}


def token():
    body = urllib.parse.urlencode({"grant_type": "client_credentials", "client_id": os.environ["FT_CLIENT_ID"],
                                   "client_secret": os.environ["FT_CLIENT_SECRET"],
                                   "scope": "api_offresdemploiv2 o2dsoffre"}).encode()
    _, d, _ = http(TOKEN_URL, body, {"Content-Type": "application/x-www-form-urlencoded"})
    return d["access_token"]


def search(tok, params):
    out, start = [], 0
    while start <= 3000:
        p = dict(params, range=f"{start}-{start + 149}")
        status, d, h = http(SEARCH + "?" + urllib.parse.urlencode(p), headers={"Authorization": f"Bearer {tok}",
                                                                              "Accept": "application/json"})
        if not d: break
        out += d.get("resultats", [])
        total = int((h.get("Content-Range") or "/0").split("/")[-1] or 0)
        start += 150
        if start >= total: break
        time.sleep(0.25)
    return out


if __name__ == "__main__":
    tok, offres, vus = token(), {}, 0
    codes = list(ROME_FAMILLE)
    for reg, lab in REGIONS.items():
        for dep in DEPTS[reg].split():
          for i in range(0, len(codes), 20):
            rows = search(tok, {"departement": dep, "codeROME": ",".join(codes[i:i + 20]), "publieeDepuis": 31})
            vus += len(rows)
            for o in rows:
                titre = o.get("intitule", "")
                fam, junior_ok = classer_poste(titre)
                if fam is None and not EXCLU.search(norm(titre)):  # titre ambigu → famille du code métier
                    fam, junior_ok = ROME_FAMILLE.get(o.get("romeCode")), not SENIOR.search(norm(titre))
                if not fam: continue
                alt = bool(o.get("alternance")) or o.get("natureContrat") in ("Contrat apprentissage", "Cont. professionnalisation")
                ans = re.search(r"(\d+)\s*An", o.get("experienceLibelle") or "")
                exp_ok = o.get("experienceExige") == "D" or (ans and int(ans.group(1)) <= 2) or (
                    o.get("experienceExige") == "S" and not ans and "Mois" in (o.get("experienceLibelle") or ""))
                if not (alt or (exp_ok and junior_ok)): continue  # hors cible junior
                ent = o.get("entreprise") or {}
                offres[o["id"]] = {
                    "source": "France Travail", "id": o["id"], "titre": o.get("intitule"), "famille": fam,
                    "junior_ok": True, "rome": o.get("romeCode"),
                    "experience": o.get("experienceLibelle"), "contrat": o.get("typeContratLibelle"),
                    "alternance": alt,
                    "entreprise": ent.get("nom"), "entreprise_url": ent.get("url"), "naf": o.get("codeNAF"),
                    "secteur": o.get("secteurActiviteLibelle"), "tranche_effectif": o.get("trancheEffectifEtab"),
                    "lieu": (o.get("lieuTravail") or {}).get("libelle"),
                    "cp": (o.get("lieuTravail") or {}).get("codePostal"), "region": lab,
                    "date": o.get("dateCreation"), "salaire": (o.get("salaire") or {}).get("libelle"),
                    "url": (o.get("origineOffre") or {}).get("urlOrigine")
                           or f"https://candidat.francetravail.fr/offres/recherche/detail/{o['id']}",
                    "description": (o.get("description") or "")[:1500],
                }
            print(lab, dep, i, len(rows), "→ gardées cumulées", len(offres), flush=True)
    json.dump(list(offres.values()), open(os.path.join(ROOT, "data/offres_ft.json"), "w"), ensure_ascii=False)
    print("TOTAL vues", vus, "gardées", len(offres))
