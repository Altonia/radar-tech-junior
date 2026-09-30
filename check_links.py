"""Vérifie les URL d'offres et de sites présentes dans l'annuaire (statut HTTP, en parallèle)."""
import json, collections, urllib.request, urllib.parse, concurrent.futures as cf, os, sys
from common import ROOT
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
      "Accept": "text/html,*/*", "Accept-Language": "fr-FR,fr"}

def check(orig):
    u = urllib.parse.quote(orig, safe=":/?&=#%+,@;~!$'()*[]")
    try:
        with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=20) as r:
            return orig, r.status, r.geturl()
    except urllib.error.HTTPError as e:
        return orig, e.code, ""
    except Exception as e:
        return orig, "ERR " + type(e).__name__, ""

if __name__ == "__main__":
    if "--retry" in sys.argv:  # repasser seulement les erreurs du dernier fichier
        res = json.load(open(os.path.join(ROOT, "data/liens.json")))
        retry = [u for u, v in res.items() if str(v["status"]).startswith("ERR") or v["status"] in (429, 502, 503, 504)]
        print("repasse sur", len(retry), flush=True)
        with cf.ThreadPoolExecutor(3) as ex:
            for i, (u, st, final) in enumerate(ex.map(check, retry), 1):
                res[u]["status"], res[u]["final"] = st, final
                if i % 200 == 0: print(i, flush=True); json.dump(res, open(os.path.join(ROOT, "data/liens.json"), "w"), ensure_ascii=False)
        json.dump(res, open(os.path.join(ROOT, "data/liens.json"), "w"), ensure_ascii=False)
        c = collections.Counter((v["type"], v["status"]) for v in res.values())
        for k, n in sorted(c.items(), key=lambda x: (x[0][0], str(x[0][1]))): print(k, n)
        sys.exit()
    rows = json.load(open(os.path.join(ROOT, "data/annuaire.json")))
    libres = json.load(open(os.path.join(ROOT, "data/offres_libres.json")))
    urls = {}
    for r in rows:
        for o in r["offres"]: urls[o["url"]] = "offre " + o["source"]
        if r["site"]: urls[r["site"]] = "site"
        if r.get("lba") and r["lba"].get("url"): urls[urllib.parse.quote(r["lba"]["url"], safe=":/?&=#%+,@;~!$'()*[]")] = "alternance LBA"
    for o in libres: urls[o["url"]] = "offre " + o["source"]
    res = {}
    with cf.ThreadPoolExecutor(int(sys.argv[1]) if len(sys.argv) > 1 else 16) as ex:
        for u, st, final in ex.map(check, list(urls)):
            res[u] = {"type": urls[u], "status": st, "final": final}
    # 2e passage lent sur les erreurs réseau : évite de retirer un lien valide à cause d'un blocage passager
    import time
    retry = [u for u, v in res.items() if str(v["status"]).startswith("ERR") or v["status"] in (429, 502, 503, 504)]
    print("2e passage sur", len(retry), "liens en erreur", flush=True)
    with cf.ThreadPoolExecutor(3) as ex:
        for u, st, final in ex.map(check, retry):
            res[u] = {"type": urls[u], "status": st, "final": final}
    json.dump(res, open(os.path.join(ROOT, "data/liens.json"), "w"), ensure_ascii=False)
    c = collections.Counter((v["type"], v["status"]) for v in res.values())
    for k, n in sorted(c.items(), key=lambda x: (x[0][0], str(x[0][1]))): print(k, n)
