"""Devine le site d'une entreprise (nom.fr, nom.com, …) et ne le garde que si son SIREN y figure
(page d'accueil ou mentions légales) : vérification stricte, pas de faux positifs."""
import json, os, re, sys, socket, urllib.request, urllib.parse, concurrent.futures as cf, unicodedata
from common import ROOT, norm
from build import FORMES

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0", "Accept": "text/html"}
OUT = os.path.join(ROOT, "data/sites_verifies.json")


def fetch(url, n=400_000):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=8) as r:
            if "html" not in (r.headers.get("Content-Type") or ""): return None, None
            return r.read(n).decode("utf-8", "ignore"), r.geturl()
    except Exception:
        return None, None


def has_siren(html, siren):
    flat = re.sub(r"(?<=\d)[\s.  -]+(?=\d)", "", html.replace("&nbsp;", " "))
    return siren in flat


def slugs(nom, sigle):
    base = re.sub(r"\(.*?\)", " ", nom)
    words = [w for w in re.sub(FORMES, " ", norm(base)).split() if w not in ("et", "de", "la", "le", "les", "des", "du")]
    out = []
    if words:
        out += ["".join(words), "-".join(words)] if len(words) > 1 else [words[0]]
        if len(words) > 2: out.append("".join(words[:2]))
    if sigle: out.append(norm(sigle).replace(" ", ""))
    return [s for s in dict.fromkeys(out) if 2 < len(s) <= 40]


def find_site(r):
    """→ [url, "verifie"] (SIREN trouvé sur le site), [url, "probable"] (domaine = nom exact et nom dans le titre), ou None."""
    probable = None
    sls = slugs(r["nom"], r.get("sigle"))
    for sl in sls:
        for tld in ("fr", "com", "io", "ai"):
            try: socket.getaddrinfo(f"{sl}.{tld}", 443)
            except OSError: continue  # domaine inexistant : pas de requête HTTP
            html, final = fetch(f"https://{sl}.{tld}/")
            if not html: continue
            if has_siren(html, r["siren"]): return [final, "verifie"]
            links = re.findall(r'href="([^"]*(?:mention|legal|imprint|cgu|cgv|a-propos|about)[^"]*)"', html, flags=re.I)
            for l in list(dict.fromkeys(links))[:3]:
                h2, _ = fetch(urllib.parse.urljoin(final, l))
                if h2 and has_siren(h2, r["siren"]): return [final, "verifie"]
            title = norm((re.search(r"<title[^>]*>(.*?)</title>", html, flags=re.S | re.I) or [None, ""])[1])
            host = urllib.parse.urlparse(final).netloc.lower()
            if (not probable and sl == sls[0] and len(sl) >= 5 and sl.replace("-", "") in title.replace(" ", "")
                    and sl in host):
                probable = [final, "probable"]
    return probable


if __name__ == "__main__":
    rows = json.load(open(os.path.join(ROOT, "data/annuaire.json")))
    ents = {e["siren"]: e for e in json.load(open(os.path.join(ROOT, "data/entreprises.json")))}
    done = json.load(open(OUT)) if os.path.exists(OUT) else {}
    todo, seen = [], set()
    for r in rows:  # déjà triés par score
        if r["siren"] and not r["site"] and r["siren"] not in done and r["siren"] not in seen:
            seen.add(r["siren"]); todo.append({"siren": r["siren"], "nom": r["nom"], "sigle": (ents.get(r["siren"]) or {}).get("sigle")})
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else len(todo)
    todo = todo[:limit]
    print("à tester", len(todo), flush=True)
    socket.setdefaulttimeout(8)
    with cf.ThreadPoolExecutor(64) as ex:
        futs = {ex.submit(find_site, r): r for r in todo}
        for i, fu in enumerate(cf.as_completed(futs), 1):
            r, site = futs[fu], fu.result()
            done[r["siren"]] = site
            if i % 250 == 0:
                json.dump(done, open(OUT, "w"))
                print(i, "testées,", sum(1 for v in done.values() if v), "sites trouvés", flush=True)
    json.dump(done, open(OUT, "w"))
    print("FIN", sum(1 for v in done.values() if v), "sites trouvés sur", len(done))
