#!/usr/bin/env node
// Prüfskript für die Portfolio-Seite. Reines Node (>= 20), keine Abhängigkeiten, kein Netz.
//
//   node tools/check.mjs [ordner]     Exit-Code 0 = alles in Ordnung, 1 = Funde
//   node --test tools/check.test.mjs   Selbsttest des Skripts
//
// Geprüft wird:
//   1. Sitemap: jede indexierbare HTML-Datei (ohne noindex) steht in sitemap.xml und umgekehrt.
//   2. Bilder: jedes <img> hat width, height und alt.
//   3. Links: relative href/src/srcset (und Links auf die eigene Domain) zeigen auf vorhandene
//      Dateien, Sprungziele (#id) gibt es auf der Zielseite.
//   4. DE/EN: index.html und en/index.html haben dieselben id-Attribute und dieselben Zahlen
//      (3.619 und 3,619 gelten als gleich; Datumsangaben in <time> zählen nicht).
//   5. Canonical: stimmt bei indexierbaren Seiten mit der eigenen (Sitemap-)URL überein.
//   6. Domain: robots.txt nennt die Sitemap der eigenen Domain, nirgends steht die alte Adresse.
//
// Nur Entwicklungswerkzeug: Die Seite selbst lädt nichts aus tools/.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Unterordner der Domain, die aus anderen Repos kommen (eigene GitHub-Pages-Projekte).
// Links und Sitemap-Einträge dorthin lassen sich lokal nicht prüfen.
export const FREMDE_PFADE = ['agent-board', 'resonanz', 'stapelwerk'];
const ALTE_DOMAIN = ['stefan-paun', 'github', 'io'].join('.');
const UEBERSPRINGEN = new Set(['.git', '.github', '.claude', 'node_modules', 'tools']);
const STARTSEITEN = ['index.html', 'en/index.html'];

function alleDateien(wurzel, ordner = '') {
  const liste = [];
  for (const name of readdirSync(join(wurzel, ordner)).sort()) {
    if (UEBERSPRINGEN.has(name)) continue;
    const rel = ordner ? `${ordner}/${name}` : name;
    if (statSync(join(wurzel, rel)).isDirectory()) liste.push(...alleDateien(wurzel, rel));
    else liste.push(rel);
  }
  return liste;
}

const zeileVon = (text, index) => text.slice(0, index).split('\n').length;

// Kommentare, Skripte und Styles durch gleich viele Leerzeichen ersetzen: Darin stehen keine
// echten Tags, und die Zeilennummern der Funde bleiben richtig.
function ohneCode(html) {
  const leer = (stueck) => stueck.replace(/[^\n]/g, ' ');
  return html
    .replace(/<!--[\s\S]*?-->/g, leer)
    .replace(/(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi, (_, auf, _n, innen, zu) => auf + leer(innen) + zu);
}

const TAG = /<([a-zA-Z][\w-]*)((?:\s+[^\s"'<>=\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>]+))?|\s*\/)*)\s*>/g;
const ATTRIBUT = /([^\s"'<>=\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>]+)))?/g;

export function tags(html) {
  const sauber = ohneCode(html);
  const liste = [];
  for (const t of sauber.matchAll(TAG)) {
    const attribute = {};
    for (const a of t[2].matchAll(ATTRIBUT)) {
      const name = a[1].toLowerCase();
      if (!(name in attribute)) attribute[name] = entschluessle(a[2] ?? a[3] ?? a[4] ?? '');
    }
    liste.push({ name: t[1].toLowerCase(), attribute, zeile: zeileVon(sauber, t.index) });
  }
  return liste;
}

const entschluessle = (wert) => wert.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

// Zahlen aus dem sichtbaren Text, so wie sie dastehen (für den Vergleich: normal()).
export function zahlen(html) {
  const text = ohneCode(html)
    .replace(/<(script|style|svg|time)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(TAG, ' ')
    .replace(/<\/[a-zA-Z][\w-]*\s*>/g, ' ');
  return text.match(/\d+(?:[.,]\d+)*/g) ?? [];
}

// 3.619 und 3,619 sind dieselbe Zahl, nur anders geschrieben.
export const normal = (zahl) => zahl.replace(/[.,]/g, '');

function zaehle(liste) {
  const anzahl = new Map();
  for (const eintrag of liste) anzahl.set(eintrag, (anzahl.get(eintrag) ?? 0) + 1);
  return anzahl;
}

// Pfad auf der Domain ("/en/", "/jarvis.html") -> Datei im Repo, oder null.
function dateiZuPfad(pfad, dateien) {
  let rel;
  try { rel = decodeURIComponent(pfad); } catch { return null; }
  rel = posix.normalize(rel).replace(/^\/+/, '');
  if (rel.startsWith('..')) return null;
  if (rel === '' || rel === '.') rel = 'index.html';
  else if (rel.endsWith('/')) rel += 'index.html';
  if (dateien.has(rel)) return rel;
  if (dateien.has(`${rel}/index.html`)) return `${rel}/index.html`;
  return null;
}

const urlZuDatei = (datei) => '/' + datei.replace(/(^|\/)index\.html$/, '$1');
const istFremd = (pfad) => FREMDE_PFADE.includes(pfad.split('/').filter(Boolean)[0]);

export function pruefe(wurzel) {
  const funde = [];
  const fund = (datei, zeile, text) => funde.push(`${datei}${zeile ? ':' + zeile : ''}  ${text}`);

  const dateiListe = alleDateien(wurzel);
  const dateien = new Set(dateiListe);
  const lies = (rel) => readFileSync(join(wurzel, rel), 'utf8');
  const domain = dateien.has('CNAME') ? lies('CNAME').trim() : '';
  if (!domain) fund('CNAME', 0, 'fehlt oder ist leer, die eigene Domain ist unbekannt');
  const basis = `https://${domain}`;

  const seiten = new Map();
  for (const datei of dateiListe.filter((d) => d.endsWith('.html'))) {
    const html = lies(datei);
    const alleTags = tags(html);
    const robots = alleTags.find((t) => t.name === 'meta' && (t.attribute.name ?? '').toLowerCase() === 'robots');
    seiten.set(datei, {
      html,
      tags: alleTags,
      ids: alleTags.filter((t) => t.attribute.id).map((t) => t.attribute.id),
      noindex: /noindex/i.test(robots?.attribute.content ?? ''),
      canonical: alleTags.find((t) => t.name === 'link' && (t.attribute.rel ?? '').toLowerCase() === 'canonical'),
    });
  }

  // 1. Sitemap <-> indexierbare Seiten
  const inSitemap = new Set();
  if (!dateien.has('sitemap.xml')) fund('sitemap.xml', 0, 'fehlt');
  else {
    const xml = lies('sitemap.xml');
    const adressen = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => [m[1], m.index]);
    for (const m of xml.matchAll(/<xhtml:link\b[^>]*\bhref="([^"]+)"/g)) adressen.push([m[1], m.index, true]);
    for (const [adresse, index, nurVerweis] of adressen) {
      const zeile = zeileVon(xml, index);
      if (adresse !== basis && !adresse.startsWith(basis + '/')) { fund('sitemap.xml', zeile, `${adresse} liegt nicht auf ${basis}`); continue; }
      const pfad = adresse.slice(basis.length) || '/';
      if (istFremd(pfad)) continue;
      const datei = dateiZuPfad(pfad, dateien);
      if (!datei || !seiten.has(datei)) { fund('sitemap.xml', zeile, `${adresse} hat keine Datei im Repo`); continue; }
      if (pfad !== urlZuDatei(datei)) fund('sitemap.xml', zeile, `${adresse} sollte ${basis}${urlZuDatei(datei)} heißen`);
      if (seiten.get(datei).noindex) fund('sitemap.xml', zeile, `${adresse} ist noindex und gehört nicht in die Sitemap`);
      if (nurVerweis) continue;
      if (inSitemap.has(datei)) fund('sitemap.xml', zeile, `${adresse} steht doppelt in der Sitemap`);
      inSitemap.add(datei);
    }
  }
  for (const [datei, seite] of seiten) {
    if (!seite.noindex && !inSitemap.has(datei)) fund(datei, 0, 'ist indexierbar, steht aber nicht in sitemap.xml');
  }

  for (const [datei, seite] of seiten) {
    // 5. Canonical
    const eigene = basis + urlZuDatei(datei);
    if (!seite.noindex) {
      if (!seite.canonical) fund(datei, 0, 'hat kein <link rel="canonical">');
      else if (seite.canonical.attribute.href !== eigene) fund(datei, seite.canonical.zeile, `canonical ${seite.canonical.attribute.href} passt nicht zu ${eigene}`);
    }

    for (const tag of seite.tags) {
      // 2. Bilder
      if (tag.name === 'img') {
        for (const noetig of ['width', 'height', 'alt']) {
          if (!(noetig in tag.attribute)) fund(datei, tag.zeile, `<img src="${tag.attribute.src ?? ''}"> ohne ${noetig}`);
        }
      }
      // 3. Links
      const ziele = [];
      if (tag.name !== 'base' && 'href' in tag.attribute && !(tag.name === 'link' && /canonical|alternate/i.test(tag.attribute.rel ?? ''))) ziele.push(tag.attribute.href);
      for (const name of ['src', 'poster']) if (name in tag.attribute) ziele.push(tag.attribute[name]);
      if ('srcset' in tag.attribute) for (const teil of tag.attribute.srcset.split(',')) ziele.push(teil.trim().split(/\s+/)[0]);
      for (const ziel of ziele) {
        const fehler = pruefeLink(ziel.trim(), datei);
        if (fehler) fund(datei, tag.zeile, fehler);
      }
    }
  }

  function pruefeLink(ziel, vonDatei) {
    if (ziel === '') return 'leerer Link';
    let pfad;
    if (ziel === basis || ziel.startsWith(basis + '/') || ziel.startsWith(basis + '#') || ziel.startsWith(basis + '?')) pfad = ziel.slice(basis.length) || '/';
    else if (/^[a-z][a-z0-9+.-]*:/i.test(ziel) || ziel.startsWith('//')) return null; // fremde Seite, mailto:, data: …
    else pfad = ziel;
    const raute = pfad.indexOf('#');
    const anker = raute < 0 ? '' : pfad.slice(raute + 1);
    pfad = (raute < 0 ? pfad : pfad.slice(0, raute)).split('?')[0];
    let zielDatei = vonDatei;
    if (pfad !== '') {
      const absolut = pfad.startsWith('/') ? pfad : posix.join('/', posix.dirname(vonDatei), pfad);
      if (istFremd(absolut)) return null;
      zielDatei = dateiZuPfad(absolut, dateien);
      if (!zielDatei) return `Link ${ziel} zeigt auf keine vorhandene Datei`;
    }
    if (anker && seiten.has(zielDatei)) {
      let id = anker;
      try { id = decodeURIComponent(anker); } catch { /* bleibt roh */ }
      if (!seiten.get(zielDatei).ids.includes(id)) return `Sprungziel ${ziel} gibt es in ${zielDatei} nicht`;
    }
    return null;
  }

  // doppelte ids (ein Sprungziel wäre sonst mehrdeutig)
  for (const [datei, seite] of seiten) {
    for (const [id, anzahl] of zaehle(seite.ids)) if (anzahl > 1) fund(datei, 0, `id="${id}" kommt ${anzahl}-mal vor`);
  }

  // 4. DE/EN-Gleichstand der Startseiten
  const [de, en] = STARTSEITEN.map((d) => seiten.get(d));
  if (!de || !en) fund(STARTSEITEN[de ? 1 : 0], 0, 'fehlt, DE/EN-Vergleich nicht möglich');
  else {
    const idsDe = new Set(de.ids), idsEn = new Set(en.ids);
    for (const id of idsDe) if (!idsEn.has(id)) fund(STARTSEITEN[1], 0, `id="${id}" fehlt (in ${STARTSEITEN[0]} vorhanden)`);
    for (const id of idsEn) if (!idsDe.has(id)) fund(STARTSEITEN[0], 0, `id="${id}" fehlt (in ${STARTSEITEN[1]} vorhanden)`);
    const roh = [zahlen(de.html), zahlen(en.html)];
    const zDe = zaehle(roh[0].map(normal)), zEn = zaehle(roh[1].map(normal));
    for (const zahl of [...new Set([...zDe.keys(), ...zEn.keys()])].sort((a, b) => a - b)) {
      const a = zDe.get(zahl) ?? 0, b = zEn.get(zahl) ?? 0;
      const geschrieben = roh.flat().find((z) => normal(z) === zahl);
      if (a !== b) fund(STARTSEITEN[0], 0, `Zahl ${geschrieben} steht ${a}-mal im Text, in ${STARTSEITEN[1]} ${b}-mal`);
    }
  }

  // 6. Domain
  if (!dateien.has('robots.txt')) fund('robots.txt', 0, 'fehlt');
  else {
    const robots = lies('robots.txt');
    const zeilen = robots.split('\n');
    const nr = zeilen.findIndex((z) => /^sitemap:/i.test(z.trim()));
    if (nr < 0) fund('robots.txt', 0, 'nennt keine Sitemap');
    else if (zeilen[nr].trim().replace(/^sitemap:\s*/i, '') !== `${basis}/sitemap.xml`) fund('robots.txt', nr + 1, `Sitemap sollte ${basis}/sitemap.xml sein`);
  }
  for (const datei of dateiListe.filter((d) => /\.(html|css|js|mjs|txt|xml|json|md|webmanifest)$/.test(d))) {
    lies(datei).split('\n').forEach((zeile, i) => {
      if (zeile.toLowerCase().includes(ALTE_DOMAIN)) fund(datei, i + 1, `alte Adresse ${ALTE_DOMAIN} (läuft über eine Weiterleitung)`);
    });
  }

  return { funde, seiten: seiten.size, dateien: dateiListe.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const wurzel = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
  const anzeige = relative(process.cwd(), wurzel).split(sep).join('/') || '.';
  const { funde, seiten, dateien } = pruefe(wurzel);
  for (const zeile of funde) console.error(zeile);
  if (funde.length) {
    console.error(`\n${funde.length} Fund(e) in ${anzeige} (${seiten} Seiten, ${dateien} Dateien).`);
    process.exitCode = 1;
  } else {
    console.log(`Alles in Ordnung: ${seiten} Seiten, ${dateien} Dateien in ${anzeige} geprüft.`);
  }
}
