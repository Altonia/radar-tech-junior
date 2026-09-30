"""Partenaires Odoo France (annuaire public odoo.com) : nom, niveau, adresse, site."""
import re, json, time, os, urllib.request

UA = {"User-Agent": "Mozilla/5.0 (annuaire emploi junior; contact perso)"}
BASE = "https://www.odoo.com"


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        return r.read().decode("utf-8", "ignore")


def props(html):
    d = {k: v.strip() for k, v in re.findall(r'itemprop="(website|telephone)"[^>]*>\s*([^<]{1,120}?)\s*<', html)}
    m = re.search(r'itemprop="streetAddress">(.*?)</span>', html, flags=re.S)
    lines = [l.strip() for l in re.split(r"<br\s*/?>", m.group(1))] if m else []
    cp = next((l for l in lines if re.match(r"\d{5}\b", l)), "")
    d.update(streetAddress=", ".join(l for l in lines if l not in (cp, "France")),
             postalCode=cp[:5], addressLocality=cp[5:].strip())
    return d


if __name__ == "__main__":
    seen, out = set(), []
    for page in range(1, 20):
        url = f"{BASE}/fr_FR/partners/country/france-74" + (f"/page/{page}" if page > 1 else "")
        html = get(url)
        items = re.findall(r'href="/fr_FR/partners/([a-z0-9-]+-(\d+))\?country_id=74">.*?<span>([^<]+)</span>\s*'
                           r'(?:<span class="badge[^"]*bg_(\w+)")?', html, flags=re.S)
        new = [i for i in items if i[1] not in seen]
        if not new: break
        for slug, pid, name, grade in new:
            seen.add(pid)
            time.sleep(1)
            p = props(get(f"{BASE}/fr_FR/partners/{slug}"))
            out.append({"nom": name.strip(), "niveau": (grade or "ready").capitalize(), "odoo_id": pid,
                        "adresse": p.get("streetAddress"), "cp": p.get("postalCode"), "ville": p.get("addressLocality"),
                        "site": p.get("website"), "fiche": f"{BASE}/fr_FR/partners/{slug}", "techno": "Odoo"})
        print("page", page, len(out), flush=True)
    json.dump(out, open(os.path.join(os.path.dirname(__file__), "../data/partenaires_odoo.json"), "w"), ensure_ascii=False, indent=0)
    print("TOTAL", len(out))
