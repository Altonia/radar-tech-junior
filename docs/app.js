"use strict";
const $ = s => document.querySelector(s);
const fmt = n => n.toLocaleString("fr-FR");
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const norm = s => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const REGIONS = ["Île-de-France", "Pays de la Loire", "Bretagne"];
const PAGE = 30;

let DATA = [], OFFRES = [], META = {}, REF = new Date();
const done = { ent: new Set(store.get("done", [])), off: new Set(store.get("done_offres", [])) };
const S = { view: "ent", q: "", n: PAGE, hideDone: false, open: new Set(), f: { ent: {}, off: {} }, tri: { ent: "score", off: "date" } };

const size = tr => !tr ? "" : tr <= "11" ? "s" : tr <= "31" ? "m" : "l";
const jours = d => d ? Math.max(0, Math.round((REF - new Date(d)) / 864e5)) : null;
const kind = x => x.al ? "alt" : /cdi|permanent/i.test(x.k || "") ? "cdi" : "autre";
const contratLabel = x => x.al ? "Alternance" : kind(x) === "cdi" ? "CDI" : ({ contract: "Contrat", CDD: "CDD" }[x.k] || x.k || "Contrat non précisé");
const dept = cp => (cp || "").slice(0, 2);
const uniq = a => [...new Set(a.filter(Boolean))].sort((x, y) => x.localeCompare(y, "fr"));

// Filtres : les 2 premiers sont visibles, les suivants dans « Plus de filtres ».
const FILTERS = {
  ent: [
    { id: "seg", label: "Type d'entreprise", all: "Tous les types", opts: () => uniq(DATA.map(d => d.s)).map(s => [s, s]), test: (d, v) => d.s === v },
    { id: "sig", label: "Signal", all: "Tous les signaux", opts: () => [["alt", "Prend des alternants"], ["pot", "Potentiel d'embauche"], ["off", "A des offres en cours"], ["site", "Site vérifié"]],
      test: (d, v) => v === "alt" ? !!d.lba : v === "pot" ? !!d.pot : v === "off" ? d._o.length > 0 : !!(d.w && !d.wp) },
    { id: "taille", label: "Taille", all: "Toutes les tailles", opts: () => [["s", "3 à 19 salariés"], ["m", "20 à 249 salariés"], ["l", "250 salariés et plus"]], test: (d, v) => size(d.tr) === v },
    { id: "dep", label: "Département", all: "Tous les départements", opts: () => uniq(DATA.map(d => dept(d.c))).map(x => [x, x]), test: (d, v) => dept(d.c) === v },
  ],
  off: [
    { id: "fam", label: "Type de poste", all: "Tous les postes", opts: () => META.familles.map(s => [s, s]), test: (x, v) => x.f === v },
    { id: "contrat", label: "Contrat", all: "Tous les contrats", opts: () => [["alt", "Alternance"], ["cdi", "CDI"], ["autre", "Autres (CDD, intérim…)"]], test: (x, v) => kind(x) === v },
    { id: "age", label: "Publiée", all: "Toutes les dates", opts: () => [["7", "Il y a moins de 7 jours"], ["14", "Il y a moins de 14 jours"]], test: (x, v) => x._j !== null && x._j < +v },
    { id: "src", label: "Source", all: "Toutes les sources", opts: () => uniq(OFFRES.map(x => x.src)).map(s => [s, s]), test: (x, v) => x.src === v },
  ],
};
const TRIS = {
  ent: [["score", "Plus pertinentes d'abord"], ["nom", "Nom (A → Z)"], ["taille", "Plus grandes d'abord"]],
  off: [["date", "Plus récentes d'abord"], ["ent", "Entreprise (A → Z)"]],
};

function selectHTML(f, v) {
  return `<option value="">${esc(f.all)}</option>` + f.opts().map(([k, l]) => `<option value="${esc(k)}"${k === v ? " selected" : ""}>${esc(l)}</option>`).join("");
}

function setupFilters() {
  const fs = FILTERS[S.view], cur = S.f[S.view];
  $("#region").innerHTML = `<option value="">Toutes les régions</option>` + REGIONS.map(r => `<option${cur.region === r ? " selected" : ""}>${r}</option>`).join("");
  ["f1", "f2"].forEach((id, i) => { const el = $("#" + id); el.dataset.f = fs[i].id; el.setAttribute("aria-label", fs[i].label); el.innerHTML = selectHTML(fs[i], cur[fs[i].id]); });
  $("#more-panel").innerHTML = fs.slice(2).map(f => `<select data-f="${f.id}" aria-label="${esc(f.label)}">${selectHTML(f, cur[f.id])}</select>`).join("");
  $("#tri").innerHTML = TRIS[S.view].map(([k, l]) => `<option value="${k}"${S.tri[S.view] === k ? " selected" : ""}>${l}</option>`).join("");
  $("#q").placeholder = S.view === "ent" ? "Rechercher une entreprise, une ville, une activité…" : "Rechercher un intitulé, une entreprise, une techno…";
  markSelects();
}
function markSelects() {
  document.querySelectorAll(".filters select").forEach(el => el.classList.toggle("on", !!el.value));
  const nMore = FILTERS[S.view].slice(2).filter(f => S.f[S.view][f.id]).length;
  $("#more-toggle").textContent = nMore ? `Plus de filtres (${nMore})` : "Plus de filtres";
}

function renderActive() {
  const cur = S.f[S.view], parts = [];
  if (S.q) parts.push(["q", `« ${$("#q").value.trim()} »`]);
  if (cur.region) parts.push(["region", cur.region]);
  for (const f of FILTERS[S.view]) if (cur[f.id]) parts.push([f.id, (f.opts().find(o => o[0] === cur[f.id]) || [, cur[f.id]])[1]]);
  $("#active").innerHTML = parts.map(([k, l]) => `<button class="pillx" data-clear="${k}" aria-label="Retirer le filtre ${esc(l)}">${esc(l)}</button>`).join("") +
    (parts.length > 1 ? `<button class="linkbtn" data-clear="*">Tout effacer</button>` : "");
}

function filtered() {
  const cur = S.f[S.view], fs = FILTERS[S.view];
  if (S.view === "off") {
    const r = OFFRES.filter(x => (!S.q || x._q.includes(S.q)) && (!cur.region || x.r === cur.region) &&
      fs.every(f => !cur[f.id] || f.test(x, cur[f.id])) && (!S.hideDone || !done.off.has(x.id)));
    if (S.tri.off === "ent") r.sort((a, b) => (a.e || "~").localeCompare(b.e || "~", "fr"));
    return r;
  }
  const r = DATA.filter(d => (!S.q || d._q.includes(S.q)) && (!cur.region || d.r === cur.region) &&
    fs.every(f => !cur[f.id] || f.test(d, cur[f.id])) && (!S.hideDone || !done.ent.has(d.id)));
  if (S.tri.ent === "nom") r.sort((a, b) => a.n.localeCompare(b.n, "fr"));
  else if (S.tri.ent === "taille") r.sort((a, b) => (b.tr || "").localeCompare(a.tr || "") || b.sc - a.sc);
  return r;
}

const initials = n => n.replace(/\(.*?\)/g, "").replace(/\b(SAS|SASU|SARL|SA|GROUPE|FRANCE)\b/gi, "").trim().split(/[\s\-&']+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?";
const hue = n => { let h = 0; for (const c of n) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const ago = j => j === 0 ? "aujourd'hui" : j === 1 ? "hier" : `il y a ${j} jours`;
const ageBadge = j => j === null ? "" : `<span class="badge${j < 7 ? " fresh" : ""}">${ago(j)}</span>`;
const ICON_EXT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M19 14v5H5V5h5"/></svg>`;

function entCard(d) {
  const clean = d.n.replace(/\(.*?\)/g, "").trim(), q = encodeURIComponent(clean);
  const contact = encodeURIComponent(clean + (size(d.tr) === "l" ? " recrutement" : " CTO OR fondateur OR dirigeant"));
  const badges = [`<span class="badge seg">${esc(d.s)}</span>`];
  if (d.lba) badges.push(`<span class="badge alt">Prend des alternants</span>`);
  if (d.pot) badges.push(`<span class="badge hire">Potentiel d'embauche</span>`);
  for (const t of d.t || []) if (!/alternants|potentiel/i.test(t) && t !== d.s) badges.push(`<span class="badge">${esc(t)}</span>`);
  const n = d._o.length, open = S.open.has(d.id);
  const menu = [
    `<a href="https://www.linkedin.com/search/results/companies/?keywords=${q}" target="_blank" rel="noopener">Page LinkedIn</a>`,
    `<a href="https://www.google.com/search?q=${q}+${encodeURIComponent(d.v || "")}" target="_blank" rel="noopener">Rechercher sur Google</a>`,
    `<a href="https://www.welcometothejungle.com/fr/jobs?query=${q}" target="_blank" rel="noopener">Welcome to the Jungle</a>`,
    d.si && `<a href="https://annuaire-entreprises.data.gouv.fr/entreprise/${d.si}" target="_blank" rel="noopener">Fiche officielle (SIREN ${d.si})</a>`,
  ].filter(Boolean).join("");
  return `<article class="card${done.ent.has(d.id) ? " done" : ""}">
    <div class="avatar" style="--h:${hue(d.n)}" aria-hidden="true">${esc(initials(d.n))}</div>
    <span class="name">${esc(d.n)}</span>
    <div class="sub"><span>${esc(d.v || "Ville inconnue")}${d.c ? ` (${esc(dept(d.c))})` : ""}</span><span>${esc(d.e)} salariés</span>${d.a ? `<span>${esc(d.a)}</span>` : ""}</div>
    <div class="badges">${badges.join("")}</div>
    <div class="actions">
      ${d.w ? `<a class="btn small primary" href="${esc(d.w)}" target="_blank" rel="noopener" title="${d.wp ? "Domaine correspondant au nom, non vérifié par SIREN" : "Site vérifié"}">${ICON_EXT}${d.wp ? "Site (probable)" : "Site"}</a>` : ""}
      ${d.lba ? `<a class="btn small" href="${esc(d.lba)}" target="_blank" rel="noopener">Candidater en alternance</a>` : ""}
      <a class="btn small" href="https://www.linkedin.com/search/results/people/?keywords=${contact}" target="_blank" rel="noopener">Trouver un contact</a>
      <details class="menu"><summary class="btn small">Plus</summary><div class="menu-list">${menu}</div></details>
      ${n ? `<button class="btn small" data-open="${d.id}" aria-expanded="${open}">${open ? "Masquer les offres" : `${n} offre${n > 1 ? "s" : ""} en cours`}</button>` : ""}
      <span class="spacer"></span>
      <label class="check"><input type="checkbox" data-done="${d.id}"${done.ent.has(d.id) ? " checked" : ""}> Candidaté</label>
    </div>
    ${open ? `<div class="offres">${d._o.map(x => `<div class="offre"><a href="${esc(x.u)}" target="_blank" rel="noopener">${esc(x.t)}</a>
      <span>${esc([contratLabel(x), x.l, x._j !== null ? ago(x._j) : ""].filter(Boolean).join(" · "))}</span></div>`).join("")}</div>` : ""}
  </article>`;
}

function offCard(x) {
  const q = encodeURIComponent(x.e || "");
  return `<article class="card o${done.off.has(x.id) ? " done" : ""}">
    <a class="name" href="${esc(x.u)}" target="_blank" rel="noopener">${esc(x.t)}</a>
    <div class="sub"><span><b>${esc(x.e || "Entreprise non précisée")}</b>${x.cab ? " (via un cabinet)" : ""}</span><span>${esc(x.l || x.r)}</span><span>via ${esc(x.src)}</span></div>
    <div class="badges"><span class="badge seg">${esc(x.f)}</span><span class="badge${x.al ? " alt" : ""}">${esc(contratLabel(x))}</span>${ageBadge(x._j)}</div>
    <div class="actions">
      <a class="btn small primary" href="${esc(x.u)}" target="_blank" rel="noopener">${ICON_EXT}Voir l'offre</a>
      ${x.w ? `<a class="btn small" href="${esc(x.w)}" target="_blank" rel="noopener">Site de l'entreprise</a>` : ""}
      ${x.e && !x.cab ? `<a class="btn small" href="https://www.linkedin.com/search/results/companies/?keywords=${q}" target="_blank" rel="noopener">LinkedIn</a>` : ""}
      <span class="spacer"></span>
      <label class="check"><input type="checkbox" data-done-off="${esc(x.id)}"${done.off.has(x.id) ? " checked" : ""}> Candidaté</label>
    </div>
  </article>`;
}

function render() {
  const r = filtered();
  const what = S.view === "ent" ? "entreprise" : "offre";
  $("#count").textContent = `${fmt(r.length)} ${what}${r.length > 1 ? "s" : ""}`;
  $("#list").innerHTML = r.length ? r.slice(0, S.n).map(S.view === "ent" ? entCard : offCard).join("")
    : `<p class="empty">Aucun résultat avec ces filtres. Retirez-en un pour élargir la recherche.</p>`;
  $("#more").hidden = r.length <= S.n;
  if (!$("#more").hidden) $("#more").textContent = `Afficher plus (${fmt(r.length - S.n)} restants)`;
  renderActive(); markSelects();
}

function setView(v) {
  S.view = v; S.n = PAGE;
  $("#tab-ent").setAttribute("aria-selected", v === "ent"); $("#tab-off").setAttribute("aria-selected", v === "off");
  $("#help-ent").hidden = v !== "ent"; $("#help-off").hidden = v !== "off";
  try { history.replaceState(null, "", v === "off" ? "#offres" : "#entreprises"); } catch {}
  setupFilters(); render();
}

function bind() {
  $("#tab-ent").addEventListener("click", () => setView("ent"));
  $("#tab-off").addEventListener("click", () => setView("off"));
  let t; $("#q").addEventListener("input", e => { clearTimeout(t); t = setTimeout(() => { S.q = norm(e.target.value.trim()); S.n = PAGE; render(); }, 150); });
  $(".filters").addEventListener("change", e => {
    const el = e.target; if (el.tagName !== "SELECT") return;
    const key = el.id === "region" ? "region" : el.dataset.f;
    S.f[S.view][key] = el.value; S.n = PAGE; render();
  });
  $("#more-toggle").addEventListener("click", () => {
    const p = $("#more-panel"); p.hidden = !p.hidden; $("#more-toggle").setAttribute("aria-expanded", !p.hidden);
  });
  $("#active").addEventListener("click", e => {
    const k = e.target.dataset.clear; if (!k) return;
    if (k === "*" || k === "q") { S.q = ""; $("#q").value = ""; }
    if (k === "*") S.f[S.view] = {}; else if (k !== "q") delete S.f[S.view][k];
    S.n = PAGE; setupFilters(); render();
  });
  $("#tri").addEventListener("change", e => { S.tri[S.view] = e.target.value; S.n = PAGE; render(); });
  $("#hide-done").addEventListener("change", e => { S.hideDone = e.target.checked; S.n = PAGE; render(); });
  $("#more").addEventListener("click", () => { S.n += PAGE * 2; render(); });
  $("#list").addEventListener("click", e => {
    const b = e.target.closest("[data-open]"); if (!b) return;
    const id = b.dataset.open; S.open.has(id) ? S.open.delete(id) : S.open.add(id);
    b.closest(".card").outerHTML = entCard(DATA.find(x => x.id === id));
  });
  $("#list").addEventListener("change", e => {
    const ide = e.target.dataset.done, ido = e.target.dataset.doneOff;
    if (ide) { e.target.checked ? done.ent.add(ide) : done.ent.delete(ide); store.set("done", [...done.ent]); }
    else if (ido) { e.target.checked ? done.off.add(ido) : done.off.delete(ido); store.set("done_offres", [...done.off]); }
    else return;
    e.target.closest(".card").classList.toggle("done", e.target.checked);
  });
  // ferme les menus « Plus » ouverts quand on clique ailleurs
  document.addEventListener("click", e => document.querySelectorAll("details.menu[open]").forEach(m => { if (!m.contains(e.target)) m.open = false; }));
}

fetch("data.json").then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).then(j => {
  META = j.meta; REF = new Date(META.ref); OFFRES = j.offres; DATA = j.entreprises;
  const byId = new Map(OFFRES.map(x => [x.id, x]));
  OFFRES.forEach(x => { x._q = norm([x.t, x.e, x.l, x.f].join(" ")); x._j = jours(x.d); });
  DATA.forEach(d => { d._q = norm([d.n, d.v, d.c, d.s, d.a, (d.t || []).join(" ")].join(" ")); d._o = (d.o || []).map(id => byId.get(id)).filter(Boolean); });
  $("#n-ent").textContent = fmt(DATA.length); $("#n-off").textContent = fmt(OFFRES.length);
  $("#maj").textContent = `Mis à jour le ${META.maj}.`;
  $("#foot").textContent = `Sources : base SIRENE (API Recherche d'entreprises), France Travail (offres et La Bonne Boîte), La Bonne Alternance, Adzuna, annuaire des partenaires Odoo, Wikidata. Offres publiées depuis 31 jours au plus. « Site » est vérifié par le SIREN affiché sur le site ; « Site (probable) » signale un domaine qui correspond au nom, sans preuve formelle. Les cases « Candidaté » restent dans votre navigateur.`;
  bind(); setView(location.hash === "#offres" ? "off" : "ent");
}).catch(() => { $("#list").innerHTML = `<p class="empty">Les données n'ont pas pu être chargées. Rechargez la page ; si le problème continue, téléchargez l'Excel.</p>`; });
