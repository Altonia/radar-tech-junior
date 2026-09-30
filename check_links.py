"""Vérifie les URL d'offres et de sites présentes dans l'annuaire (statut HTTP, en parallèle)."""
import json, collections, urllib.request, concurrent.futures as cf, os
from common import ROOT
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
      "Accept": "text/html,*/*", "Accept-Language": "fr-FR,fr"}

def check(u):
    try:
        with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=20) as r:
            return u, r.status, r.geturl()
    except urllib.error.HTTPError as e:
        return u, e.code, ""
    except Exception as e:
        return u, "ERR " + type(e).__name__, ""

rows = json.load(open(os.path.join(ROOT, "data/annuaire.json")))
libres = json.load(open(os.path.join(ROOT, "data/offres_libres.json")))
urls = {}
for r in rows:
    for o in r["offres"]: urls[o["url"]] = "offre " + o["source"]
    if r["site"]: urls[r["site"]] = "site"
for o in libres: urls[o["url"]] = "offre " + o["source"]
res = {}
with cf.ThreadPoolExecutor(16) as ex:
    for u, st, final in ex.map(check, list(urls)):
        res[u] = {"type": urls[u], "status": st, "final": final}
json.dump(res, open(os.path.join(ROOT, "data/liens.json"), "w"), ensure_ascii=False)
c = collections.Counter((v["type"], v["status"]) for v in res.values())
for k, n in sorted(c.items(), key=lambda x: (x[0][0], str(x[0][1]))): print(k, n)
