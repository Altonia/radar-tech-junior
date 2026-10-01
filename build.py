"""Fusion : entreprises + partenaires + offres → segments, score, exports (json/csv/xlsx)."""
import json, os, re, csv, glob, datetime, collections, html
from common import norm, ROOT

D = lambda f: os.path.join(ROOT, "data", f)
DEPTS = {"Île-de-France": {"75", "77", "78", "91", "92", "93", "94", "95"},
         "Pays de la Loire": {"44", "49", "53", "72", "85"}, "Bretagne": {"22", "29", "35", "56"}}
DEPT2REG = {d: r for r, ds in DEPTS.items() for d in ds}
FORMES = r"\b(sas|sasu|sarl|eurl|sa|sca|sci|snc|scop|groupe|group|france|holding|societe|ste|et cie|the)\b"


def cle_nom(s):
    s = norm(s)
    s = re.sub(r"\(.*?\)", " ", s)
    return re.sub(r"\s+", " ", re.sub(FORMES, " ", s)).strip()


KW = {
    "IA / Data": r"\b(ia|ai|intelligence|intelligent|machine learning|deep learning|neural|cognitiv\w*|data|datas|"
                 r"analytics|predict\w*|computer vision|bot|bots|gpt|llm|genai|algo\w*|deep\w*|semantic\w*|nlp)\b",
    "Intégrateur ERP / CRM / e-commerce": r"\b(erp|crm|odoo|sap|salesforce|sage|dynamics|cegid|divalto|"
                 r"netsuite|hubspot|shopify|magento|prestashop|ecommerce|e commerce|commerce|shop|pgi)\b",
    "Agence web / digitale": r"\b(web|digital|digitale|agence|studio|creati\w*|design|interactive|media|"
                 r"communication|marketing|seo|site|sites|app|apps|mobile|lab)\b",
    "ESN / Conseil IT": r"\b(consulting|conseil|consultants?|esn|ssii|services|solutions|partners|ingenierie|"
                 r"engineering|technologies|systems|systemes)\b",
}
KW = {k: re.compile(v) for k, v in KW.items()}
POIDS_SEG = {"IA / Data": 16, "Intégrateur ERP / CRM / e-commerce": 16, "Éditeur de logiciels": 13,
             "ESN / Conseil IT": 13, "Agence web / digitale": 12, "Dev / studio logiciel": 10,
             "Agence com / pub": 4, "Cabinet de recrutement": 4, "Infra / hébergement": 4, "Recruteur (DSI, autre secteur)": 12}


def segment(e, odoo_keys):
    n, naf = norm(e["nom"]), e["naf"]
    tags = []
    if KW["IA / Data"].search(n): tags.append("IA / Data")
    if KW["Intégrateur ERP / CRM / e-commerce"].search(n) or cle_nom(e["nom"]) in odoo_keys:
        tags.append("Intégrateur ERP / CRM / e-commerce")
    if naf.startswith("58.29"): seg = "Éditeur de logiciels"
    elif naf in ("63.11Z", "62.03Z", "62.02B"): seg = "Infra / hébergement"
    elif naf == "73.11Z": seg = "Agence web / digitale" if KW["Agence web / digitale"].search(n) else "Agence com / pub"
    elif naf == "62.02A": seg = "ESN / Conseil IT"
    elif naf == "63.12Z": seg = "Agence web / digitale"
    else:  # 62.01Z, 62.09Z
        seg = ("Agence web / digitale" if KW["Agence web / digitale"].search(n) else
               "ESN / Conseil IT" if (e.get("tranche") or "00") >= "21" or KW["ESN / Conseil IT"].search(n) else
               "Dev / studio logiciel")
    if tags:  # un tag spécialisé prime pour le segment affiché
        seg = tags[0]
    return seg, tags


def taille_ent(tr):
    """Page entreprises : priorité aux PME, les grands groupes (1 000 salariés et plus) passent derrière."""
    return {None: 4, "02": 8, "03": 8, "11": 12, "12": 12, "21": 10, "22": 10, "31": 4, "32": 4, "41": 0}.get(tr, -25)


def taille_pts(tr):
    tr = tr or "00"
    return 4 if tr in ("02", "03") else 10 if tr in ("11", "12", "21", "22", "31") else 8 if tr >= "32" else 0


def load(f, default):
    return json.load(open(D(f))) if os.path.exists(D(f)) else default


if __name__ == "__main__":
    ents = load("entreprises.json", [])
    odoo = [dict(p, nom=html.unescape(p["nom"])) for p in load("partenaires_odoo.json", []) if (p.get("cp") or "")[:2] in DEPT2REG]
    odoo_keys = {cle_nom(p["nom"]): p for p in odoo}
    offres = [o for f in sorted(glob.glob(D("offres_*.json"))) if not f.endswith("offres_libres.json") for o in json.load(open(f))]
    # écoles qui publient des « offres » pour recruter des étudiants, plateformes freelance
    ECOLE = re.compile(r"\b(school|ecole|academy|academie|campus|iscod|kaischool|igf|openclassrooms|studi|ifocop|"
                       r"simplon|wild code|formation|formations|cfa|institut|aurlom|bts|arcesi|apprentissage|ifcv)\b")
    NIVEAU_BAS = re.compile(r"\b(bts|but|dut|bac ?\+ ?[1-3]|sio|licence pro\w*|titre pro\w*)\b")
    PUB_ECOLE = re.compile(r"(frais (d )?inscription|inscription gratuite|suivi pedagogique|rejoins notre (ecole|formation)|"
                           r"frais de scolarite)")
    FREELANCE = re.compile(r"\b(collective|lehibou|le hibou|mon consultant independant|propulse it|w hub|isupplier|"
                           r"malt|free work|freework|creme de la creme|comet|hiway|freelance\w*|"
                           r"portage|missions? independant\w*)\b")
    n0 = len(offres)
    offres = [o for o in offres if not ((o.get("naf") or "").startswith("85.59") or ECOLE.search(norm(o.get("entreprise")))
                                        or FREELANCE.search(norm(o.get("entreprise"))) or FREELANCE.search(norm(o["titre"]))
                                        or NIVEAU_BAS.search(norm(o["titre"])) or PUB_ECOLE.search(norm(o.get("description"))))]
    print("offres écartées (écoles, freelance, niveau < Bac+5) :", n0 - len(offres))
    # contrôle a posteriori : titre hors cible, ou sans aucun indice numérique
    from common import EXCLU, IT_HINT, classer_poste
    n0 = len(offres)
    def dans_la_cible(o):
        t = norm(o["titre"])
        if EXCLU.search(t): return False
        fam = classer_poste(o["titre"])[0]
        if (fam == "Chef de projet / PO" and o["source"] == "Adzuna"
                and not re.search(r"\b(product owner|po|scrum|pmo|product manager)\b", t)):
            return bool(IT_HINT.search(t))  # « chef de projet » seul sur Adzuna : marketing, BTP, retail…
        return bool(fam or IT_HINT.search(t))
    offres = [o for o in offres if dans_la_cible(o)]
    print("offres écartées (hors cible) :", n0 - len(offres))
    # doublons (même titre, même entreprise, même région) : on garde la plus récente
    vus, uniq = set(), []
    for o in sorted(offres, key=lambda o: o.get("date") or "", reverse=True):
        k = (norm(o["titre"]), norm(o.get("entreprise")), o["region"]) if o.get("entreprise") else o["id"]
        if k not in vus: vus.add(k); uniq.append(o)
    print("doublons retirés :", len(offres) - len(uniq)); offres = uniq
    morts = {u for u, v in load("liens.json", {}).items() if v["status"] in (404, 410)}
    n0 = len(offres); offres = [o for o in offres if o.get("url") not in morts]
    print("offres retirées (lien mort) :", n0 - len(offres))
    lbb = {}
    for x in load("lbb.json", []):
        k = (x["siren"], x["region"]); cur = lbb.get(k)
        if not cur or x["potentiel"] > cur["potentiel"]: lbb[k] = x
    INTERIM = re.compile(r"^78\.")
    lba_recr = {(x["siren"], x["region"]): x for x in load("lba_recruteurs.json", [])}

    # index offres par (nom normalisé, région)
    idx, idx_siren = collections.defaultdict(list), collections.defaultdict(list)
    for o in offres:
        if o.get("siret"):
            idx_siren[(o["siret"][:9], o["region"])].append(o); continue
        o["via_cabinet"] = bool(INTERIM.match(o.get("naf") or ""))
        if o.get("entreprise") and not o["via_cabinet"]:
            idx[(cle_nom(o["entreprise"]), o["region"])].append(o)

    rows, used = [], set()
    n_hors = 0
    for e in ents:
        if not e["etablissements"]:  # aucun établissement ACTIF dans la région : pas vraiment sur place
            n_hors += 1; continue
        seg, tags = segment(e, odoo_keys)
        k = cle_nom(e["nom"]); ks = {k} | ({cle_nom(e["sigle"])} if e.get("sigle") else set())
        mo = [o for kk in ks for o in idx.get((kk, e["region"]), [])] + idx_siren.pop((e["siren"], e["region"]), [])
        used |= {(kk, e["region"]) for kk in ks}
        etab = next((x for x in e["etablissements"] if x.get("siege")), None) or (e["etablissements"] or [{}])[0]
        rows.append({"siren": e["siren"], "nom": e["nom"], "segment": seg, "tags": tags, "naf": e["naf_label"],
                     "effectif": e["effectif"], "tranche": e.get("tranche"), "categorie": e.get("categorie"),
                     "creation": (e.get("date_creation") or "")[:4], "region": e["region"],
                     "ville": etab.get("ville") or e.get("siege_ville"), "cp": etab.get("cp") or e.get("siege_cp"),
                     "adresse": etab.get("adresse"), "nb_sites_region": len(e["etablissements"]),
                     "syntec": "1486" in (e.get("idcc") or []), "site": (odoo_keys.get(k) or {}).get("site"),
                     "odoo": (odoo_keys.get(k) or {}).get("niveau"), "offres": mo, "dirigeants": e.get("dirigeants") or [],
                     "lbb": lbb.pop((e["siren"], e["region"]), None),
                     "lba": lba_recr.get((e["siren"], e["region"]))})

    print("entreprises sans établissement actif dans la région, écartées :", n_hors)
    # entreprises vues seulement via les offres (DSI d'autres secteurs, groupes…)
    extra = collections.defaultdict(list)
    for key, lst in idx.items():
        if key not in used: extra[key] += lst
    for (siren, reg), lst in idx_siren.items():
        extra[(cle_nom(lst[0]["entreprise"] or siren), reg)] += lst
    for (k, reg), lst in extra.items():
        o0 = lst[0]; naf = next((o["naf"] for o in lst if o.get("naf")), "") or ""
        seg = ("Éditeur de logiciels" if naf.startswith("58") else "ESN / Conseil IT" if naf.startswith(("62", "63"))
               else "Cabinet de recrutement" if naf.startswith("70.22") or re.search(r"\b(rh|hr|recrutement|talents?)\b", k)
               else "Recruteur (DSI, autre secteur)")
        rows.append({"siren": None, "nom": o0["entreprise"], "segment": seg, "tags": [],
                     "naf": o0.get("secteur") or "", "effectif": o0.get("tranche_effectif") or "?", "tranche": None,
                     "categorie": None, "creation": "", "region": reg, "ville": o0.get("lieu"), "cp": o0.get("cp"),
                     "adresse": None, "nb_sites_region": None, "syntec": False, "site": o0.get("entreprise_url"),
                     "odoo": None, "offres": lst, "lbb": None, "lba": None})
    # partenaires Odoo absents de SIRENE-IT (NAF différent)
    known = {cle_nom(r["nom"]) for r in rows}
    for p in odoo:
        if cle_nom(p["nom"]) not in known:
            rows.append({"siren": None, "nom": p["nom"], "segment": "Intégrateur ERP / CRM / e-commerce",
                         "tags": ["Intégrateur ERP / CRM / e-commerce"], "naf": "Partenaire Odoo", "effectif": "?",
                         "tranche": None, "categorie": None, "creation": "", "region": DEPT2REG[p["cp"][:2]],
                         "ville": p["ville"], "cp": p["cp"], "adresse": p["adresse"], "nb_sites_region": None,
                         "syntec": False, "site": p["site"], "odoo": p["niveau"], "offres": [], "lbb": None, "lba": None})
    # recruteurs La Bonne Boîte hors base IT (DSI d'autres secteurs, etc.)
    TR = {"1-2": None, "3-5": "02", "6-9": "03", "10-19": "11", "20-49": "12", "50-99": "21", "100-199": "22",
          "200-249": "31", "250-499": "32", "500-999": "41", "1000-1999": "42", "2000-4999": "51"}
    for (siren, reg), x in lbb.items():
        tr = TR.get(x["effectif"], "52" if x["effectif"].startswith(("5000", "10000")) else None)
        seg = "Recruteur (DSI, autre secteur)" if not (x["naf"] or "").startswith(("62", "58", "63")) else "ESN / Conseil IT"
        rows.append({"siren": siren, "nom": x["nom"], "segment": seg, "tags": [], "naf": x["naf_label"] or "",
                     "effectif": x["effectif"].replace("-", " à "), "tranche": tr, "categorie": None, "creation": "",
                     "region": reg, "ville": (x["ville"] or "").upper(), "cp": x["cp"], "adresse": None,
                     "nb_sites_region": None, "syntec": False, "site": None, "odoo": None, "offres": [], "lbb": x, "lba": lba_recr.get((siren, reg))})

    # recruteurs d'alternants (La Bonne Alternance) du numérique absents de la base
    vus = {(r["siren"], r["region"]) for r in rows if r["siren"]}
    for (siren, reg), x in lba_recr.items():
        if (siren, reg) in vus or not x["naf"].startswith(("62", "58", "63")): continue
        tr = {"3-5": "02", "6-9": "03", "10-19": "11", "20-49": "12", "50-99": "21", "100-199": "22",
              "200-249": "31", "250-499": "32", "500-999": "41"}.get(x.get("effectif"))
        seg = "Éditeur de logiciels" if x["naf"].startswith("58") else "ESN / Conseil IT"
        rows.append({"siren": siren, "nom": x["nom"], "segment": seg, "tags": [], "naf": x["naf_label"] or "",
                     "effectif": x.get("effectif") or "?", "tranche": tr, "categorie": None, "creation": "",
                     "region": reg, "ville": re.sub(r"^.*\d{5}\s*", "", x["adresse"] or ""), "cp": x["cp"],
                     "adresse": x["adresse"], "nb_sites_region": None, "syntec": False, "site": None, "odoo": None,
                     "offres": [], "lbb": None, "lba": x}); vus.add((siren, reg))

    # sites web : Odoo/Wikidata > vérifié par SIREN > URL donnée dans une offre > probable
    wd, guess = load("sites_wikidata.json", {}), load("sites_verifies.json", {})
    for r in rows:
        r["site_niveau"] = "verifie" if r["site"] else None
        if r["site"]: continue
        g = guess.get(r["siren"]) if r["siren"] else None
        off_url = next((o.get("entreprise_url") for o in r["offres"] if o.get("entreprise_url")), None)
        if r["siren"] and r["siren"] in wd: r["site"], r["site_niveau"] = wd[r["siren"]], "verifie"
        elif g and g[1] == "verifie": r["site"], r["site_niveau"] = g
        elif off_url: r["site"], r["site_niveau"] = off_url, "verifie"
        elif g: r["site"], r["site_niveau"] = g

    liens = load("liens.json", {})
    def site_mort(u):
        st = (liens.get(u) or {}).get("status", 200)
        return st in (404, 410) or (isinstance(st, int) and st >= 500) or str(st).startswith("ERR URLError")
    for r in rows:
        if r["site"] and site_mort(r["site"]): r["site"], r["site_niveau"] = None, None

    this_year = datetime.date.today().year
    for r in rows:
        oj = [o for o in r["offres"] if o.get("junior_ok")]
        r["nb_offres"], r["nb_offres_junior"] = len(r["offres"]), len(oj)
        r["nb_alternance"] = sum(1 for o in r["offres"] if o.get("alternance"))
        r["familles"] = sorted({o["famille"] for o in r["offres"]})
        s = POIDS_SEG.get(r["segment"], 8) + 4 * (len(r["tags"]) > 1) + taille_pts(r["tranche"])
        s_off = min(40, 12 * len(oj) + 3 * (len(r["offres"]) - len(oj))) + min(12, 6 * r["nb_alternance"])
        s += 3 * r["syntec"] + 5 * bool(r["odoo"])
        if r.get("lba"):
            s += 6; r["tags"] = r["tags"] + ["Prend des alternants"]
        if r["lbb"]:
            s += min(14, round(r["lbb"]["potentiel"] / 6)) + 4 * r["lbb"]["haut_potentiel"]
            r["tags"] = r["tags"] + ["Fort potentiel d'embauche" if r["lbb"]["haut_potentiel"] else "Potentiel d'embauche"]
        if r["creation"] and this_year - int(r["creation"]) <= 4 and r["tranche"] and r["tranche"] >= "03":
            s += 3; r["tags"] = r["tags"] + ["Jeune pousse"]
        r["score"] = min(100, s + s_off)
        s_ent = s - taille_pts(r["tranche"]) + taille_ent(r["tranche"])
        # une boîte dont on a le site est bien plus facile à contacter : elle passe devant
        s_ent += 10 if r.get("site_niveau") == "verifie" else 6 if r.get("site") else 0
        r["score_ent"] = max(0, min(100, round(s_ent * 100 / 77)))  # page entreprises : sans les offres, sur 100
    rows.sort(key=lambda r: -r["score"])
    json.dump(rows, open(D("annuaire.json"), "w"), ensure_ascii=False)
    rattachees = {o["id"] for r in rows for o in r["offres"]}
    json.dump([o for o in offres if o["id"] not in rattachees], open(D("offres_libres.json"), "w"), ensure_ascii=False)

    with open(D("annuaire.csv"), "w", newline="") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(["score", "nom", "segment", "tags", "region", "ville", "cp", "effectif", "activite", "siren",
                    "site", "offres_junior", "offres_alternance", "offres_total", "familles_postes", "liens_offres"])
        for r in rows:
            w.writerow([r["score"], r["nom"], r["segment"], ", ".join(r["tags"]), r["region"], r["ville"], r["cp"],
                        r["effectif"], r["naf"], r["siren"] or "", r["site"] or "", r["nb_offres_junior"],
                        r["nb_alternance"], r["nb_offres"], ", ".join(r["familles"]),
                        " | ".join(o["url"] for o in r["offres"][:5] if o.get("url"))])
    c = collections.Counter((r["region"], r["segment"]) for r in rows)
    for k, v in sorted(c.items()): print(k, v)
    print("TOTAL", len(rows), "avec offres:", sum(1 for r in rows if r["offres"]))
