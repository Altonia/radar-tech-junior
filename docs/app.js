"use strict";
const $ = s => document.querySelector(s);
const fmt = n => n.toLocaleString("fr-FR");
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const norm = s => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const ls = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const PAGE = 40;
const REGIONS = ["Île-de-France", "Pays de la Loire", "Bretagne"];
const STATUTS = [["a_contacter", "À contacter"], ["candidate", "Candidaté"], ["relance", "Relancé"], ["entretien", "Entretien"], ["refus", "Refusé"], ["accepte", "Accepté"]];
const STATUT = Object.fromEntries(STATUTS);

let DATA = [], OFFRES = [], META = {}, REF = new Date(), ENT_BY_ID = new Map(), OFF_BY_ID = new Map(), ENT_OF_OFF = new Map();
const S = { view: "ent", q: "", n: PAGE, f: { ent: {}, off: {}, suivi: {} }, tri: { ent: "score", off: "date", suivi: "date" }, cur: null, showAll: {} };

/* ---------- utilitaires ---------- */
const size = tr => !tr ? "?" : tr <= "11" ? "s" : tr <= "31" ? "m" : "l";
const jours = d => d ? Math.max(0, Math.round((REF - new Date(d)) / 864e5)) : null;
const ago = j => j === null ? "" : j === 0 ? "aujourd'hui" : j === 1 ? "hier" : `il y a ${j} jours`;
const kind = x => x.al ? "alt" : /cdi|permanent/i.test(x.k || "") ? "cdi" : "autre";
const contratLabel = x => ({ alt: "Alternance", cdi: "CDI" }[kind(x)]) || ({ contract: "Contrat", CDD: "CDD" }[x.k] || x.k || "Contrat non précisé");
const dept = cp => (cp || "").slice(0, 2);
const clean = n => n.replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim();
// « VITAL INGENIERIE » → « Vital Ingenierie » ; garde les sigles (SAS, IT, MP) et les mots avec chiffres
const PETITS = new Set(["de", "du", "des", "la", "le", "les", "et", "en", "au", "aux", "sur", "sous", "l", "d"]);
const SIGLES = new Set("sas sasu sarl eurl sa sca scop snc esn ssii erp crm sap si it ia ai rh bi ibm ux ui po cdi cdd qa dsi amoa moa moe pme eti tpe hr seo sirh".split(" "));
const tc = s => {
  if (!s || /[a-zà-ÿ]/.test(s)) return s || "";
  return s.toLowerCase().replace(/[a-zà-ÿ0-9]+/g, (w, i) => {
    if (SIGLES.has(w) || /\d/.test(w) || (w.length <= 3 && !PETITS.has(w) && !/[aeiouyàâéèêîôû]/.test(w))) return w.toUpperCase();
    if (i > 0 && PETITS.has(w)) return w;
    return w[0].toUpperCase() + w.slice(1);
  });
};
const nomAff = n => tc(clean(n)) || tc(n);
const alias = n => { const m = [...n.matchAll(/\(([^)]*)\)/g)].map(x => x[1].trim()).filter(x => x && x.toLowerCase() !== clean(n).toLowerCase()); return m.length ? tc(m.join(", ")) : ""; };
const dateFr = iso => iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : "";
// contact : le dirigeant s'il est connu (petites et moyennes boîtes), les recruteurs pour les grosses, sinon CTO/fondateurs de CETTE boîte
const g = q => `https://www.google.com/search?q=${encodeURIComponent(q)}`;
const contactOf = d => {
  const boite = `"${clean(d.n)}"`, dg = (d.dg || [])[0];
  if (size(d.tr) === "l") return { url: g(`site:linkedin.com/in ${boite} ("talent acquisition" OR recruteur OR recruteuse OR "chargé de recrutement")`), label: "les recruteurs" };
  if (dg) return { url: g(`site:linkedin.com/in "${dg[0]}" ${boite}`), label: dg[0], role: dg[1] };
  return { url: g(`site:linkedin.com/in ${boite} (CTO OR fondateur OR fondatrice OR dirigeant OR "directeur technique")`), label: "CTO et fondateurs" };
};
const contactUrl = d => contactOf(d).url;

/* ---------- suivi : navigateur, synchronisé avec Supabase une fois connecté ---------- */
const Suivi = {
  map: new Map(), client: null, user: null,
  key: () => "rtj_suivi_" + (Suivi.user ? Suivi.user.id : "local"),
  load() { this.map = new Map(Object.entries(ls.get(this.key(), {}))); },
  persist() { ls.set(this.key(), Object.fromEntries(this.map)); },
  get: k => Suivi.map.get(k),
  async set(k, patch) {
    const prev = this.map.get(k) || { item: k, type: k.slice(0, 3), statut: "a_contacter", note: "" };
    const row = { ...prev, ...patch, updated_at: new Date().toISOString() };
    this.map.set(k, row); this.persist(); refreshCounts(); paintRow(k);
    if (this.client && this.user) {
      const { error } = await this.client.from("suivi").upsert({ item: row.item, type: row.type, label: row.label, statut: row.statut, note: row.note, updated_at: row.updated_at });
      return error ? "Pas synchronisé : vérifie ta connexion" : "C'est noté";
    }
    return "C'est noté (sur cet appareil)";
  },
  async remove(k) {
    this.map.delete(k); this.persist(); refreshCounts(); paintRow(k);
    if (this.client && this.user) await this.client.from("suivi").delete().eq("item", k);
  },
  async pull() {
    const { data, error } = await this.client.from("suivi").select("item,type,label,statut,note,updated_at");
    if (error) { this.load(); return; }
    const local = new Map(Object.entries(ls.get("rtj_suivi_local", {})));
    this.map = new Map(data.map(r => [r.item, r]));
    const toPush = [];
    for (const [k, r] of local) {  // suivi fait avant la connexion : ajouté au compte
      const rr = this.map.get(k);
      if (!rr || rr.updated_at < r.updated_at) { this.map.set(k, r); toPush.push(r); }
    }
    if (toPush.length) await this.client.from("suivi").upsert(toPush.map(r => ({ item: r.item, type: r.type, label: r.label, statut: r.statut, note: r.note, updated_at: r.updated_at })));
    ls.set("rtj_suivi_local", {}); this.persist();
  },
};
function migrateOld() {  // anciennes cases « Candidaté »
  const old = [...ls.get("done", []).map(id => "ent:" + id), ...ls.get("done_offres", []).map(id => "off:" + id)];
  if (!old.length) return;
  const m = ls.get("rtj_suivi_local", {}), now = new Date().toISOString();
  for (const k of old) if (!m[k]) m[k] = { item: k, type: k.slice(0, 3), label: labelOf(k), statut: "candidate", note: "", updated_at: now };
  ls.set("rtj_suivi_local", m); try { localStorage.removeItem("done"); localStorage.removeItem("done_offres"); } catch {}
}
function labelOf(k) {
  const [t, id] = [k.slice(0, 3), k.slice(4)];
  if (t === "ent") { const d = ENT_BY_ID.get(id); return d ? nomAff(d.n) : "Entreprise"; }
  const x = OFF_BY_ID.get(id); return x ? `${tc(x.t)} — ${x.e ? nomAff(x.e) : "entreprise non précisée"}` : "Offre";
}
let syncTimer;
function showSync(msg) { const el = $("#saved"); if (el) { el.textContent = msg; clearTimeout(syncTimer); syncTimer = setTimeout(() => { if ($("#saved")) $("#saved").textContent = ""; }, 3000); } }

async function initAuth() {
  const cfg = window.RTJ_SUPABASE || {};
  if (!cfg.url || !cfg.key || !window.supabase) { Suivi.load(); renderAccount(); return; }
  Suivi.client = window.supabase.createClient(cfg.url, cfg.key, { auth: { persistSession: true, detectSessionInUrl: true, flowType: "pkce" } });
  const { data } = await Suivi.client.auth.getSession();
  Suivi.user = data.session?.user || null;
  if (Suivi.user) await Suivi.pull(); else Suivi.load();
  Suivi.client.auth.onAuthStateChange((ev, session) => {
    const u = session?.user || null;
    if (u?.id === Suivi.user?.id) return;
    setTimeout(async () => {  // hors du rappel d'authentification, comme le recommande Supabase
      Suivi.user = u;
      if (u) await Suivi.pull(); else Suivi.load();
      renderAccount(); refreshCounts(); render();
    });
  });
  renderAccount();
}
function renderAccount() {
  const el = $("#account");
  if (!Suivi.client) { el.innerHTML = ""; return; }
  el.innerHTML = Suivi.user
    ? `<span title="Ton suivi est synchronisé">${esc(Suivi.user.email)}</span><button class="btn small ghost" id="logout">Déconnexion</button>`
    : `<button class="btn" id="login-open">Se connecter</button>`;
  $("#logout")?.addEventListener("click", () => Suivi.client.auth.signOut());
  $("#login-open")?.addEventListener("click", () => { $("#login-msg").textContent = ""; $("#login").showModal(); });
}
function bindLogin() {
  $("#login-cancel").addEventListener("click", () => $("#login").close());
  $("#login-form").addEventListener("submit", async e => {
    e.preventDefault();
    const email = $("#email").value.trim(); if (!email) return;
    $("#login-send").disabled = true; $("#login-msg").textContent = "Envoi en cours…";
    const { error } = await Suivi.client.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
    $("#login-send").disabled = false;
    $("#login-msg").textContent = error
      ? (/rate|limit/i.test(error.message) ? "Trop de demandes en ce moment. Réessaie dans une heure." : "L'envoi a raté. Vérifie l'adresse et réessaie.")
      : `C'est parti : lien envoyé à ${email}. Ouvre-le sur cet appareil (et jette un œil aux spams).`;
  });
}

/* ---------- facettes ---------- */
function uniqCount(arr) {
  const c = new Map(); for (const v of arr) if (v) c.set(v, (c.get(v) || 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => [v, v]);
}
const FACETS = {
  ent: [
    { id: "region", title: "Région", of: d => [d.r], opts: () => REGIONS.map(r => [r, r]) },
    { id: "seg", title: "Type de boîte", of: d => [d.s], opts: () => uniqCount(DATA.map(d => d.s)), limit: 6 },
    { id: "sig", title: "Ça recrute ?", of: d => [d.lba && "alt", d.pot && "pot", d._o.length && "off", d.w && !d.wp && "site"].filter(Boolean),
      opts: () => [["alt", "Prend des alternants"], ["pot", "Potentiel d'embauche"], ["off", "A des offres en ce moment"], ["site", "Site vérifié"]] },
    { id: "taille", title: "Taille", of: d => [size(d.tr)], opts: () => [["s", "Petite (3 à 19)"], ["m", "Moyenne (20 à 249)"], ["l", "Grosse (250 et plus)"], ["?", "Taille inconnue"]] },
    { id: "dep", title: "Département", of: d => [dept(d.c)], opts: () => uniqCount(DATA.map(d => dept(d.c)).filter(Boolean)), limit: 6 },
  ],
  off: [
    { id: "fam", title: "Type de poste", of: x => [x.f], opts: () => META.familles.map(f => [f, f]) },
    { id: "contrat", title: "Contrat", of: x => [kind(x)], opts: () => [["alt", "Alternance"], ["cdi", "CDI"], ["autre", "Autres (CDD, intérim…)"]] },
    { id: "age", title: "Fraîcheur", of: x => [x._j === null ? "old" : x._j < 7 ? "7" : x._j < 14 ? "14" : "old"],
      opts: () => [["7", "Moins d'une semaine"], ["14", "1 à 2 semaines"], ["old", "Plus de 2 semaines"]] },
    { id: "region", title: "Région", of: x => [x.r], opts: () => REGIONS.map(r => [r, r]) },
    { id: "src", title: "Source", of: x => [x.src], opts: () => uniqCount(OFFRES.map(x => x.src)) },
  ],
  suivi: [
    { id: "statut", title: "Statut", of: s => [s.statut], opts: () => STATUTS },
    { id: "type", title: "Type", of: s => [s.type], opts: () => [["ent", "Boîtes"], ["off", "Offres"]] },
  ],
};
const items = () => S.view === "ent" ? DATA : S.view === "off" ? OFFRES : [...Suivi.map.values()];
const qOf = it => S.view === "suivi" ? norm((it.label || "") + " " + (it.note || "")) : it._q;
function matches(it, skip) {
  if (S.q && !qOf(it).includes(S.q)) return false;
  const cur = S.f[S.view];
  for (const f of FACETS[S.view]) {
    if (f.id === skip) continue;
    const sel = cur[f.id]; if (!sel || !sel.size) continue;
    if (!f.of(it).some(v => sel.has(v))) return false;
  }
  return true;
}
function renderFacets() {
  const all = items(), cur = S.f[S.view];
  $("#facets").innerHTML = FACETS[S.view].map(f => {
    const counts = new Map();
    for (const it of all) if (matches(it, f.id)) for (const v of f.of(it)) counts.set(v, (counts.get(v) || 0) + 1);
    const opts = f.opts(), sel = cur[f.id] || new Set();
    const lim = f.limit && !S.showAll[S.view + f.id] ? f.limit : Infinity;
    const shown = opts.filter((o, i) => i < lim || sel.has(o[0]));
    return `<section class="facet"><h3>${esc(f.title)}</h3>${shown.map(([v, l]) => {
      const n = counts.get(v) || 0;
      return `<label class="opt${n ? "" : " zero"}"><input type="checkbox" data-f="${f.id}" value="${esc(v)}"${sel.has(v) ? " checked" : ""}><span>${esc(l)}</span><i>${fmt(n)}</i></label>`;
    }).join("")}${opts.length > shown.length ? `<button class="more-opts" data-all="${f.id}">Voir les ${opts.length}</button>` : ""}</section>`;
  }).join("");
  const nSel = Object.values(cur).reduce((a, s) => a + (s ? s.size : 0), 0) + (S.q ? 1 : 0);
  $("#clear").hidden = !nSel; $("#n-filters").textContent = nSel ? `(${nSel})` : "";
  const nRes = all.filter(it => matches(it)).length;
  $("#see-results").textContent = `Voir les ${fmt(nRes)} résultat${nRes > 1 ? "s" : ""}`;
}

/* ---------- liste ---------- */
const TRIS = {
  ent: [["score", "Les plus prometteuses"], ["petites", "Les plus petites d'abord"], ["nom", "Par nom (A → Z)"]],
  off: [["date", "Les plus fraîches"], ["ent", "Par entreprise (A → Z)"]],
  suivi: [["date", "Modifiées récemment"], ["statut", "Par statut"]],
};
function sorted(r) {
  const t = S.tri[S.view];
  if (S.view === "ent") {
    if (t === "nom") r.sort((a, b) => a.n.localeCompare(b.n, "fr"));
    else if (t === "petites") r.sort((a, b) => (a.tr || "99").localeCompare(b.tr || "99") || b.sc - a.sc);
  } else if (S.view === "off") {
    if (t === "ent") r.sort((a, b) => (a.e || "~").localeCompare(b.e || "~", "fr"));
  } else if (t === "statut") r.sort((a, b) => STATUTS.findIndex(s => s[0] === a.statut) - STATUTS.findIndex(s => s[0] === b.statut));
  else r.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
  return r;
}
// sélecteur de statut rapide, directement sur la ligne
function stSelect(k, label) {
  const s = Suivi.get(k);
  return `<select class="stsel${s ? " on" : ""}" data-k="${esc(k)}" data-label="${esc(label)}" aria-label="Statut de suivi">
    <option value=""${s ? "" : " selected"}>${s ? "Retirer du suivi" : "+ Suivre"}</option>
    ${STATUTS.map(([v, l]) => `<option value="${v}"${s?.statut === v ? " selected" : ""}>${l}</option>`).join("")}</select>`;
}
const hlAttr = k => { const s = Suivi.get(k); return s ? ` data-hl="${s.statut}"` : ""; };
// couleur par type de boîte (classes .t-*)
const SEG_COL = { "ESN / Conseil IT": "blue", "Dev / studio logiciel": "violet", "Éditeur de logiciels": "cyan", "IA / Data": "pink",
  "Intégrateur ERP / CRM / e-commerce": "amber", "Agence web / digitale": "green", "Agence com / pub": "rose", "Infra / hébergement": "slate",
  "Recruteur (DSI, autre secteur)": "teal", "Cabinet de recrutement": "slate" };
const FAM_COL = { "Développement": "violet", "IA / Data": "pink", "Chef de projet / PO": "blue", "AMOA / Consultant SI": "cyan", "Consultant ERP / CRM": "amber", "E-commerce": "green" };
const domain = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
function rowEnt(d) {
  const k = "ent:" + d.id;
  const tags = [`<span class="tag t-${SEG_COL[d.s] || "slate"}">${esc(d.s)}</span>`,
    d.lba && `<span class="tag t-amber">Prend des alternants</span>`, d.pot && `<span class="tag t-green">Recrute</span>`,
    d._o.length && `<span class="tag t-blue">${d._o.length} offre${d._o.length > 1 ? "s" : ""} en cours</span>`,
    ...(d.t || []).filter(t => /jeune pousse/i.test(t)).map(() => `<span class="tag t-pink">Jeune pousse</span>`)].filter(Boolean).join("");
  return `<li class="row${S.cur === k ? " sel" : ""}"${hlAttr(k)} data-k="${k}">
    <button class="r-main" data-open="${k}">
      <span class="score" style="--s:${d.sc}" data-n="${d.sc}" title="Score de pertinence : ${d.sc} sur 100"></span>
      <span class="r-title">${esc(nomAff(d.n))}</span>
      <span class="r-meta"><span>${esc([d.v && `${tc(d.v)}${d.c ? ` (${dept(d.c)})` : ""}`, d.e !== "?" && `${d.e} salariés`, d.w && domain(d.w)].filter(Boolean).join(" · "))}</span></span>
      <span class="r-tags">${tags}</span>
    </button>
    <div class="r-act">
      ${d.w ? `<a class="btn small c-blue" href="${esc(d.w)}" target="_blank" rel="noopener">Site</a>` : ""}
      ${d.lba ? `<a class="btn small c-amber" href="${esc(d.lba)}" target="_blank" rel="noopener">Alternance</a>` : ""}
      <a class="btn small c-violet" href="${contactUrl(d)}" target="_blank" rel="noopener" title="Chercher ${esc(contactOf(d).label)} sur LinkedIn">Contact</a>
      ${stSelect(k, nomAff(d.n))}
    </div></li>`;
}
function rowOff(x) {
  const k = "off:" + x.id;
  const tags = [`<span class="tag t-${FAM_COL[x.f] || "slate"}">${esc(x.f)}</span>`, `<span class="tag t-${x.al ? "amber" : "slate"}">${esc(contratLabel(x))}</span>`,
    x._j !== null && `<span class="tag t-${x._j < 7 ? "green" : "slate"}">${ago(x._j)}</span>`].filter(Boolean).join("");
  return `<li class="row o${S.cur === k ? " sel" : ""}"${hlAttr(k)} data-k="${k}">
    <button class="r-main" data-open="${k}">
      <span class="r-title">${esc(tc(x.t))}</span>
      <span class="r-meta"><span>${esc([x.e ? nomAff(x.e) : "Entreprise non précisée", x.l || x.r, `via ${x.src}`].filter(Boolean).join(" · "))}</span></span>
      <span class="r-tags">${tags}</span>
    </button>
    <div class="r-act">
      <a class="btn small c-blue" href="${esc(x.u)}" target="_blank" rel="noopener">Voir l'offre</a>
      ${x.w ? `<a class="btn small c-violet" href="${esc(x.w)}" target="_blank" rel="noopener">Site</a>` : ""}
      ${stSelect(k, labelOf(k))}
    </div></li>`;
}
function rowSuivi(s) {
  return `<li class="row o${S.cur === s.item ? " sel" : ""}" data-hl="${s.statut}" data-k="${esc(s.item)}">
    <button class="r-main" data-open="${esc(s.item)}">
      <span class="r-title">${esc(s.label || labelOf(s.item))}</span>
      <span class="r-meta"><span>${esc([s.type === "ent" ? "Boîte" : "Offre", `modifié le ${dateFr(s.updated_at)}`, s.note].filter(Boolean).join(" · "))}</span></span>
    </button>
    <div class="r-act">${stSelect(s.item, s.label || labelOf(s.item))}</div></li>`;
}
// met à jour une ligne après un changement de statut, sans tout redessiner
function paintRow(k) {
  const li = document.querySelector(`.row[data-k="${CSS.escape(k)}"]`); if (!li) return;
  const s = Suivi.get(k);
  if (s) li.dataset.hl = s.statut; else delete li.dataset.hl;
  const sel = li.querySelector(".stsel");
  if (sel) sel.outerHTML = stSelect(k, sel.dataset.label);
}

const INTRO = {
  ent: `Les boîtes où envoyer une candidature spontanée. Les PME et les intégrateurs passent devant, les grands groupes ferment la marche.
    <details><summary>Nos conseils pour une spontanée qui marche</summary><ul>
    <li>Écris à une vraie personne plutôt qu'à un formulaire. Dans une boîte de moins de 50 personnes, vise le dirigeant ou le CTO : le bouton « Contact » ouvre la bonne recherche LinkedIn.</li>
    <li>Fais court : 5 à 8 lignes. Ce que tu sais faire, pourquoi eux, le contrat visé (rythme d'alternance ou CDI junior) et quand tu peux commencer.</li>
    <li>Alternance fin septembre : pas de panique, un contrat peut en général démarrer jusqu'à environ 3 mois après le début de la formation.</li>
    <li><b>Alternants</b> : la boîte en prend régulièrement (La Bonne Alternance). <b>Recrute</b> : grosses chances d'embauche dans ces métiers (La Bonne Boîte, France Travail). Le rond, c'est le score de pertinence sur 100.</li></ul></details>`,
  off: `Les offres ouvertes aux juniors (2 ans d'expérience max) et les alternances des 31 derniers jours.
    <details><summary>Avant de postuler</summary><ul>
    <li>Si tu peux, postule sur le site carrières de la boîte : Adzuna reprend des offres publiées ailleurs.</li>
    <li>Au-delà de 2 semaines, l'offre est peut-être déjà pourvue. Les plus fraîches sont en vert.</li>
    <li>Les ESN publient beaucoup d'offres, dont une partie sert juste à remplir leur vivier de CV.</li>
    <li>On a déjà viré : postes seniors, fausses offres d'écoles, niveaux BTS ou Bac+3, missions freelance, doublons et liens morts.</li></ul></details>`,
  suivi: `Toutes les boîtes et offres que tu suis. Change le statut direct sur la ligne, ou ouvre-la pour ajouter une note.`,
};

function render() {
  const r = sorted(items().filter(it => matches(it)));
  const what = S.view === "ent" ? ["boîte", "boîtes"] : S.view === "off" ? ["offre", "offres"] : ["élément suivi", "éléments suivis"];
  $("#count").textContent = `${fmt(r.length)} ${what[r.length > 1 ? 1 : 0]}`;
  const row = S.view === "ent" ? rowEnt : S.view === "off" ? rowOff : rowSuivi;
  let empty = "Rien avec ces filtres. Enlève-en un pour élargir.";
  if (S.view === "suivi" && !Suivi.map.size) empty = "Rien pour l'instant. Choisis « + Suivre » sur une boîte ou une offre : elle atterrit ici.";
  $("#rows").innerHTML = r.length ? r.slice(0, S.n).map(row).join("") : `<li class="state">${empty}</li>`;
  $("#more").hidden = r.length <= S.n;
  $("#more").textContent = `Afficher la suite (${fmt(Math.max(0, r.length - S.n))})`;
  $("#export").hidden = S.view !== "suivi" || !Suivi.map.size;
  renderFacets();
}
function refreshCounts() {
  $("#n-suivi").textContent = Suivi.map.size ? fmt(Suivi.map.size) : "";
  if (S.view === "suivi") render();
}

/* ---------- fiche détaillée ---------- */
function suiviBlock(k, label) {
  const s = Suivi.get(k);
  return `<section class="d-sec"><h3>Mon suivi</h3>
    <div class="steps" role="group" aria-label="Statut">${STATUTS.map(([v, l]) =>
      `<button class="step" data-hl="${v}" data-statut="${v}" data-k="${esc(k)}" data-label="${esc(label)}" aria-pressed="${s?.statut === v}">${l}</button>`).join("")}</div>
    <textarea class="note" id="note" data-k="${esc(k)}" data-label="${esc(label)}" placeholder="Une note : le contact, la date de relance, ce qu'ils t'ont répondu…">${esc(s?.note || "")}</textarea>
    <div class="saved" id="saved">${s ? `Modifié le ${dateFr(s.updated_at)}` : "Choisis un statut pour l'ajouter à ton suivi."}</div>
    ${s ? `<button class="link" data-remove="${esc(k)}">Retirer du suivi</button>` : ""}
    ${Suivi.client && !Suivi.user ? `<p class="hint">Connecte-toi pour retrouver ton suivi sur ton téléphone et ton ordi.</p>` : ""}</section>`;
}
function detailEnt(d) {
  const c = clean(d.n), q = encodeURIComponent(c), al = alias(d.n);
  const sigs = [d.lba && `<span class="sig warm">Prend des alternants : elle en recrute régulièrement, d'après La Bonne Alternance.</span>`,
    d.pot && `<span class="sig go">Grosses chances d'embauche dans ces métiers, d'après La Bonne Boîte (France Travail).</span>`,
    ...(d.t || []).filter(t => !/alternants|potentiel/i.test(t)).map(t => `<span class="sig muted">${esc(t)}</span>`)].filter(Boolean);
  return `<p class="d-kicker"><span class="tag t-${SEG_COL[d.s] || "slate"}">${esc(d.s)}</span></p><h2 class="d-title">${esc(nomAff(d.n))}</h2>
    <p class="d-meta">${esc([d.v && `${tc(d.v)}${d.c ? ` (${d.c})` : ""}`, d.r, d.e !== "?" && `${d.e} salariés`].filter(Boolean).join(" · "))}${al ? `<br>Aussi connue sous : ${esc(al)}` : ""}</p>
    <div class="d-score"><span class="score" style="--s:${d.sc}" data-n="${d.sc}"></span><span>Score de pertinence sur 100 : type de boîte, taille et signaux de recrutement.</span></div>
    <div class="d-actions">
      ${d.w ? `<a class="btn primary" href="${esc(d.w)}" target="_blank" rel="noopener">${d.wp ? "Site (probable)" : "Site web"}</a>` : ""}
      ${d.lba ? `<a class="btn c-amber" href="${esc(d.lba)}" target="_blank" rel="noopener">Candidater en alternance</a>` : ""}
      <a class="btn c-violet" href="${contactUrl(d)}" target="_blank" rel="noopener">${(() => { const c = contactOf(d); return c.role ? `Trouver ${esc(c.label)} (${esc(c.role.toLowerCase())})` : `Trouver ${esc(c.label)}`; })()}</a>
    </div>
    ${suiviBlock("ent:" + d.id, nomAff(d.n))}
    ${sigs.length ? `<section class="d-sec"><h3>Pourquoi elle est là</h3><div class="d-sigs">${sigs.join("")}</div></section>` : ""}
    ${d._o.length ? `<section class="d-sec"><h3>Ses offres du moment (${d._o.length})</h3><ul class="d-offres">${d._o.map(x =>
      `<li><a href="#" data-open="off:${x.id}">${esc(tc(x.t))}</a><span>${esc([contratLabel(x), x.l, ago(x._j)].filter(Boolean).join(" · "))}</span></li>`).join("")}</ul></section>` : ""}
    <section class="d-sec"><h3>Infos</h3><dl class="facts">
      ${(d.dg || []).length ? `<dt>Dirigeant${d.dg.length > 1 ? "s" : ""}</dt><dd>${d.dg.map(([n, r]) => `<a href="${g(`site:linkedin.com/in "${n}" "${clean(d.n)}"`)}" target="_blank" rel="noopener">${esc(n)}</a>${r ? ` (${esc(r.toLowerCase())})` : ""}`).join("<br>")}</dd>` : ""}
      <dt>Activité</dt><dd>${esc(d.a || "Non précisée")}</dd>
      ${d.y ? `<dt>Création</dt><dd>${d.y}</dd>` : ""}
      ${d.si ? `<dt>SIREN</dt><dd>${d.si}</dd>` : ""}
      ${d.w ? `<dt>Site</dt><dd>${d.wp ? "Domaine qui colle au nom, pas vérifié à 100 %" : "Vérifié (son SIREN est sur le site)"}</dd>` : ""}</dl></section>
    <section class="d-sec"><h3>Creuser</h3><div class="links">
      <a href="https://www.linkedin.com/search/results/companies/?keywords=${q}" target="_blank" rel="noopener">Sa page LinkedIn</a>
      <a href="https://www.welcometothejungle.com/fr/jobs?query=${q}" target="_blank" rel="noopener">Ses offres sur Welcome to the Jungle</a>
      <a href="https://www.google.com/search?q=${q}+${encodeURIComponent(d.v || "")}" target="_blank" rel="noopener">La chercher sur Google</a>
      ${d.si ? `<a href="https://annuaire-entreprises.data.gouv.fr/entreprise/${d.si}" target="_blank" rel="noopener">Sa fiche officielle</a>` : ""}</div></section>`;
}
function detailOff(x) {
  const ent = ENT_OF_OFF.get(x.id);
  return `<p class="d-kicker"><span class="tag t-${FAM_COL[x.f] || "slate"}">${esc(x.f)}</span></p><h2 class="d-title">${esc(tc(x.t))}</h2>
    <p class="d-meta">${esc([x.e ? nomAff(x.e) : "Entreprise non précisée", x.l || x.r].filter(Boolean).join(" · "))}${x.cab ? " · via un cabinet" : ""}</p>
    <div class="d-actions">
      <a class="btn primary" href="${esc(x.u)}" target="_blank" rel="noopener">Voir l'offre</a>
      ${x.w ? `<a class="btn c-violet" href="${esc(x.w)}" target="_blank" rel="noopener">Site de la boîte</a>` : ""}
      ${ent ? `<button class="btn c-cyan" data-open="ent:${ent.id}">Fiche de la boîte</button>` : ""}
    </div>
    ${suiviBlock("off:" + x.id, labelOf("off:" + x.id))}
    <section class="d-sec"><h3>Infos</h3><dl class="facts">
      <dt>Contrat</dt><dd>${esc(contratLabel(x))}</dd>
      <dt>Publiée</dt><dd>${x.d ? `${new Date(x.d).toLocaleDateString("fr-FR")} (${ago(x._j)})` : "Date inconnue"}</dd>
      <dt>Région</dt><dd>${esc(x.r)}</dd>
      <dt>Source</dt><dd>${esc(x.src)}</dd></dl>
      ${x.src === "Adzuna" ? `<p class="hint">Adzuna reprend des offres publiées ailleurs : si tu peux, retrouve-la sur le site carrières de la boîte.</p>` : ""}</section>`;
}
function openItem(k, keepScroll) {
  const [t, id] = [k.slice(0, 3), k.slice(4)];
  const it = t === "ent" ? ENT_BY_ID.get(id) : OFF_BY_ID.get(id);
  const top = $("#drawer").scrollTop, wasOpen = !$("#drawer").hidden;
  $("#detail").innerHTML = !it
    ? `<h2 class="d-title">Plus dans la liste</h2><p class="d-meta">Elle a disparu à la dernière mise à jour (offre pourvue ou expirée).</p>${suiviBlock(k, Suivi.get(k)?.label || "")}`
    : t === "ent" ? detailEnt(it) : detailOff(it);
  S.cur = k; $("#drawer").hidden = false; $("#scrim").hidden = false;
  $("#drawer").scrollTop = keepScroll ? top : 0;
  document.querySelectorAll(".row").forEach(r => r.classList.toggle("sel", r.dataset.k === k));
  if (!wasOpen) $("#close-drawer").focus();
}
function closeItem() { $("#drawer").hidden = true; $("#scrim").hidden = true; S.cur = null; document.querySelectorAll(".row.sel").forEach(r => r.classList.remove("sel")); }

/* ---------- événements ---------- */
function setView(v) {
  S.view = v; S.n = PAGE; closeItem(); $("#side").classList.remove("open");
  document.querySelectorAll(".view").forEach(b => b.setAttribute("aria-selected", b.dataset.view === v));
  $("#intro").innerHTML = INTRO[v];
  $("#tri").innerHTML = TRIS[v].map(([k, l]) => `<option value="${k}"${S.tri[v] === k ? " selected" : ""}>${l}</option>`).join("");
  $("#q").value = S.q = ""; $("#q").placeholder = v === "ent" ? "Une boîte, une ville, une activité…" : v === "off" ? "Un poste, une boîte, une techno…" : "Un nom, une note…";
  try { history.replaceState(null, "", { ent: "#boites", off: "#offres", suivi: "#suivi" }[v]); } catch {}
  render();
}
function exportSuivi() {
  const rows = [["Élément", "Type", "Statut", "Note", "Modifié le"], ...[...Suivi.map.values()].map(s =>
    [s.label || labelOf(s.item), s.type === "ent" ? "Boîte" : "Offre", STATUT[s.statut], s.note || "", (s.updated_at || "").slice(0, 10)])];
  const csv = "﻿" + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\n");
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })), download: "mon-suivi-le-filon.csv" });
  document.body.append(a); a.click(); a.remove();
}
let noteTimer;
function bind() {
  document.querySelectorAll(".view").forEach(b => b.addEventListener("click", () => setView(b.dataset.view)));
  let t; $("#q").addEventListener("input", e => { clearTimeout(t); t = setTimeout(() => { S.q = norm(e.target.value.trim()); S.n = PAGE; render(); }, 150); });
  $("#facets").addEventListener("change", e => {
    const f = e.target.dataset.f; if (!f) return;
    const cur = S.f[S.view]; cur[f] = cur[f] || new Set();
    e.target.checked ? cur[f].add(e.target.value) : cur[f].delete(e.target.value);
    S.n = PAGE; render();
  });
  $("#facets").addEventListener("click", e => { const f = e.target.dataset.all; if (f) { S.showAll[S.view + f] = true; renderFacets(); } });
  $("#clear").addEventListener("click", () => { S.f[S.view] = {}; S.q = ""; $("#q").value = ""; S.n = PAGE; render(); });
  $("#tri").addEventListener("change", e => { S.tri[S.view] = e.target.value; S.n = PAGE; render(); });
  $("#more").addEventListener("click", () => { S.n += PAGE * 2; render(); });
  $("#open-side").addEventListener("click", () => $("#side").classList.add("open"));
  $("#close-side").addEventListener("click", () => $("#side").classList.remove("open"));
  $("#see-results").addEventListener("click", () => { $("#side").classList.remove("open"); window.scrollTo(0, 0); });
  $(".toolbar").insertAdjacentHTML("beforeend", `<button class="btn small" id="export" hidden>Exporter mon suivi</button>`);
  $("#export").addEventListener("click", exportSuivi);
  // statut rapide sur une ligne
  $("#rows").addEventListener("change", async e => {
    const sel = e.target.closest(".stsel"); if (!sel) return;
    const k = sel.dataset.k;
    if (sel.value) await Suivi.set(k, { statut: sel.value, label: sel.dataset.label, note: Suivi.get(k)?.note || "" });
    else await Suivi.remove(k);
    if (S.cur === k) openItem(k, true);
  });
  document.addEventListener("click", async e => {
    const o = e.target.closest("[data-open]"); if (o) { e.preventDefault(); openItem(o.dataset.open); return; }
    const st = e.target.closest("[data-statut]");
    if (st) {
      const k = st.dataset.k;
      const msg = await Suivi.set(k, { statut: st.dataset.statut, label: st.dataset.label, note: $("#note")?.value || "" });
      openItem(k, true); showSync(msg); return;
    }
    const rm = e.target.closest("[data-remove]");
    if (rm) { const k = rm.dataset.remove; await Suivi.remove(k); if (S.view === "suivi") closeItem(); else openItem(k, true); }
  });
  $("#detail").addEventListener("input", e => {
    if (e.target.id !== "note") return;
    const k = e.target.dataset.k, label = e.target.dataset.label, v = e.target.value;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(async () => showSync(await Suivi.set(k, { note: v, label, statut: Suivi.get(k)?.statut || "a_contacter" })), 700);
  });
  $("#scrim").addEventListener("click", closeItem);
  $("#close-drawer").addEventListener("click", closeItem);
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#drawer").hidden) closeItem(); });
  if (Suivi.client) bindLogin();
}

/* ---------- thème clair / sombre ---------- */
const SUN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>`;
const MOON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/></svg>`;
const themeNow = () => document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
function paintTheme() {
  const t = themeNow();
  $("#theme").innerHTML = t === "dark" ? SUN : MOON;
  $("#theme").setAttribute("aria-label", t === "dark" ? "Passer en mode clair" : "Passer en mode sombre");
}
$("#theme").addEventListener("click", () => {
  const t = themeNow() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = t; try { localStorage.setItem("theme", t); } catch {}
  paintTheme();
});
matchMedia("(prefers-color-scheme: light)").addEventListener?.("change", paintTheme);
paintTheme();

/* ---------- démarrage ---------- */
fetch("data.json").then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).then(async j => {
  META = j.meta; REF = new Date(META.ref); OFFRES = j.offres; DATA = j.entreprises;
  OFFRES.forEach(x => { x._q = norm([x.t, x.e, x.l, x.f].join(" ")); x._j = jours(x.d); OFF_BY_ID.set(x.id, x); });
  DATA.forEach(d => {
    d._q = norm([d.n, d.v, d.c, d.s, d.a, (d.t || []).join(" ")].join(" "));
    d._o = (d.o || []).map(id => OFF_BY_ID.get(id)).filter(Boolean);
    d._o.forEach(x => ENT_OF_OFF.set(x.id, d)); ENT_BY_ID.set(d.id, d);
  });
  migrateOld();
  await initAuth();
  $("#n-ent").textContent = fmt(DATA.length); $("#n-off").textContent = fmt(OFFRES.length);
  const fresh = OFFRES.filter(x => x._j !== null && x._j < 7).length;
  $("#pulse").innerHTML = `<span><b>${fmt(DATA.filter(d => d.lba).length)}</b> boîtes prennent des alternants</span>
    <span><b>${fmt(fresh)}</b> offres de moins d'une semaine</span><span><b>${fmt(DATA.filter(d => d.w).length)}</b> avec leur site</span>`;
  $("#maj-badge").textContent = `Données du ${META.maj}`;
  $("#foot").textContent = "Sources : base SIRENE (API Recherche d'entreprises), France Travail (offres et La Bonne Boîte), La Bonne Alternance, Adzuna, partenaires Odoo, Wikidata. « Site web » est vérifié par le SIREN affiché sur le site ; « Site (probable) » : le domaine colle au nom, sans preuve formelle.";
  bind(); refreshCounts();
  setView(location.hash === "#offres" ? "off" : location.hash === "#suivi" ? "suivi" : "ent");
}).catch(err => { console.error(err); $("#rows").innerHTML = `<li class="state">Les données n'ont pas voulu charger. Recharge la page ; si ça continue, prends l'Excel en haut.</li>`; });
