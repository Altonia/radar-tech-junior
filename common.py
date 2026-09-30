import os, re, json, time, urllib.request, urllib.parse, unicodedata

ROOT = os.path.dirname(os.path.abspath(__file__))


def load_env():
    for p in (os.path.join(ROOT, ".env"), os.path.join(ROOT, "..", ".env")):
        if os.path.exists(p):
            for line in open(p):
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip('"\''))


def http(url, data=None, headers=None, retries=5):
    for i in range(retries):
        try:
            req = urllib.request.Request(url, data=data, headers=headers or {})
            with urllib.request.urlopen(req, timeout=40) as r:
                body = r.read()
                return r.status, (json.loads(body) if body else None), dict(r.headers)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and i < retries - 1:
                time.sleep(2 * (i + 1)); continue
            if e.code == 204:
                return 204, None, {}
            raise RuntimeError(f"{e.code} {url}\n{e.read()[:500]}")
        except Exception:
            if i == retries - 1: raise
            time.sleep(2 * (i + 1))


def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9+#]", " ", s)).strip()


# --- Classification des postes (cible Bac+5) ---
EXCLU = re.compile(r"\b(technicien|tech support|support|helpdesk|help desk|hotline|hotliner|assistance utilisateur|"
                   r"administrateur (systeme|reseau)|admin sys|exploitation|pupitreur|cablage|cableur|installateur|"
                   r"deploiement de postes|proximite|n1|n2|niveau 1|niveau 2|maintenance informatique|"
                   r"electricien|electrotechni|automaticien|commercial|vendeur|business developer|sales|teleconseil|"
                   r"formateur|enseignant|professeur|stagiaire|stage)\b")
SENIOR = re.compile(r"\b(senior|sr|confirme|experimente|expert|lead|principal|staff|head|directeur|director|"
                    r"manager|responsable|chief|cto|vp|architecte)\b")
FAMILLES = [
    ("IA / Data", r"\b(ia|ai|intelligence artificielle|machine learning|ml|deep learning|llm|genai|gen ai|nlp|"
                  r"computer vision|data scien\w*|data engineer\w*|data analyst|ingenieur data|mlops|rag)\b"),
    ("Consultant ERP / CRM", r"\b(erp|crm|sap|salesforce|dynamics|odoo|hubspot|sage|oracle|workday|servicenow|"
                             r"netsuite|sylob|divalto|cegid|pgi)\b"),
    ("E-commerce", r"\b(e ?commerce|shopify|magento|adobe commerce|prestashop|woocommerce|sylius|salesforce commerce)\b"),
    ("Chef de projet / PO", r"\b(chef de projet|cheffe de projet|chef(fe)? de projets|project manager|product owner|po|"
                            r"product manager|scrum master|pmo|chargee? de projet)\b"),
    ("AMOA / Consultant SI", r"\b(amoa|moa|business analyst|analyste fonctionnel\w*|consultant\w* fonctionnel\w*|"
                             r"consultant\w* si|consultant\w* (en )?systemes? d information|consultant\w* it|"
                             r"consultant\w* digital|consultant\w* transformation|ingenieur d affaires? si)\b"),
    ("Développement", r"\b(developpeu\w*|developer|dev|ingenieur logiciel|software engineer|full ?stack|back ?end|"
                      r"front ?end|java|python|php|symfony|laravel|react|angular|vue|node|net|c#|golang|devops|"
                      r"ingenieur (etudes? et )?developpement|integrateur web|mobile|ios|android|flutter)\b"),
]
FAMILLES = [(n, re.compile(p)) for n, p in FAMILLES]


def classer_poste(titre, description=""):
    """Renvoie (famille|None, est_junior_compatible)."""
    t = norm(titre)
    if EXCLU.search(t):
        return None, False
    fam = next((n for n, rx in FAMILLES if rx.search(t)), None)
    return fam, not SENIOR.search(t)
