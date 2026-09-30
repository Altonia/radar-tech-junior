"""Sites officiels via Wikidata (SIREN P1616 → site officiel P856)."""
import json, os, time, urllib.parse
from common import http, ROOT

rows = json.load(open(os.path.join(ROOT, "data/annuaire.json")))
sirens = sorted({r["siren"] for r in rows if r["siren"]})
out = {}
for i in range(0, len(sirens), 2500):
    vals = " ".join(f'"{s}"' for s in sirens[i:i + 2500])
    q = f'SELECT ?siren ?site WHERE {{ VALUES ?siren {{ {vals} }} ?e wdt:P1616 ?siren ; wdt:P856 ?site . }}'
    _, d, _ = http("https://query.wikidata.org/sparql", urllib.parse.urlencode({"query": q, "format": "json"}).encode(),
                   headers={"Content-Type": "application/x-www-form-urlencoded","User-Agent": "RadarTechJunior/1.0 (annuaire emploi non commercial)",
                            "Accept": "application/sparql-results+json"})
    for b in d["results"]["bindings"]:
        out.setdefault(b["siren"]["value"], b["site"]["value"])
    print(i, len(out), flush=True)
    time.sleep(65)  # limite actuelle : 1 requête / minute
json.dump(out, open(os.path.join(ROOT, "data/sites_wikidata.json"), "w"), indent=0)
print(len(out), "sites sur", len(sirens), "SIREN")
