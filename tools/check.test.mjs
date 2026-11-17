// Selbsttest für tools/check.mjs: baut eine kleine Seite in einem Temp-Ordner und prüft,
// dass sie grün ist und dass jede eingebaute Lücke gemeldet wird.   node --test tools/check.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { formatiere, normal, pruefe, pruefeZahlen, tags, unlesbar, zahlen } from './check.mjs';
import { anzeige } from './zahlen.mjs';

const BASIS = 'https://beispiel.test';
const kopf = (pfad, extra = '') => `<!doctype html><html><head><title>t</title><link rel="canonical" href="${BASIS}${pfad}">${extra}</head>`;
const start = (praefix, zahl, sprache) => `${kopf(sprache === 'en' ? '/en/' : '/')}<body>
<main id="top"><h1 id="titel">Seite</h1>
<span class="num">${zahl}</span> Tests, Version 1.5.0, <time datetime="2026-10-31">${sprache === 'en' ? '31 October' : '31. Oktober'}</time>
<a href="#titel">hoch</a> <a href="${praefix}notiz.html#abschnitt">Notiz</a> <a href="${BASIS}/stackworks/">Projekt</a>
<picture><source srcset="${praefix}img/bild.webp 720w"><img src="${praefix}img/bild.webp" width="10" height="10" alt="Bild"></picture>
<script>const html = '<img src="gibt-es-nicht.png"> 999';</script>
</main></body></html>`;

function gutesRepo() {
  return {
    'CNAME': 'beispiel.test\n',
    'robots.txt': `User-agent: *\nAllow: /\n\nSitemap: ${BASIS}/sitemap.xml\n`,
    'sitemap.xml': `<urlset>
<url><loc>${BASIS}/</loc><xhtml:link rel="alternate" hreflang="en" href="${BASIS}/en/"/></url>
<url><loc>${BASIS}/en/</loc></url>
<url><loc>${BASIS}/notiz.html</loc></url>
<url><loc>${BASIS}/stackworks/</loc></url>
</urlset>`,
    'index.html': start('', '3.619', 'de'),
    'en/index.html': start('../', '3,619', 'en'),
    'notiz.html': `${kopf('/notiz.html')}<body><h2 id="abschnitt">A</h2><a href="./">Start</a></body></html>`,
    '404.html': '<!doctype html><html><head><title>404</title><meta name="robots" content="noindex"></head><body><a href="/">Start</a></body></html>',
    'img/bild.webp': '',
  };
}

function laufe(aendere = () => {}, mitOrdner = (ordner) => pruefe(ordner).funde) {
  const dateien = gutesRepo();
  aendere(dateien);
  const ordner = mkdtempSync(join(tmpdir(), 'check-'));
  try {
    for (const [pfad, inhalt] of Object.entries(dateien)) {
      if (inhalt === null) continue;
      mkdirSync(dirname(join(ordner, pfad)), { recursive: true });
      writeFileSync(join(ordner, pfad), inhalt);
    }
    return mitOrdner(ordner);
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

const genauEiner = (funde, muster) => {
  assert.equal(funde.length, 1, funde.join('\n'));
  assert.match(funde[0], muster);
};

test('saubere Seite ist grün', () => {
  assert.deepEqual(laufe(), []);
});

test('indexierbare Seite fehlt in der Sitemap', () => {
  genauEiner(laufe((d) => { d['sitemap.xml'] = d['sitemap.xml'].replace(`<url><loc>${BASIS}/notiz.html</loc></url>\n`, ''); }), /^notiz\.html .*nicht in sitemap\.xml/);
});

test('Sitemap-Eintrag ohne Datei', () => {
  genauEiner(laufe((d) => { d['sitemap.xml'] = d['sitemap.xml'].replace('</urlset>', `<url><loc>${BASIS}/weg.html</loc></url></urlset>`); }), /^sitemap\.xml:6 .*weg\.html hat keine Datei/);
});

test('noindex-Seite in der Sitemap', () => {
  genauEiner(laufe((d) => { d['sitemap.xml'] = d['sitemap.xml'].replace('</urlset>', `<url><loc>${BASIS}/404.html</loc></url></urlset>`); }), /noindex/);
});

test('Bild ohne width und ohne alt', () => {
  const funde = laufe((d) => { d['notiz.html'] = d['notiz.html'].replace('<a href', '<img src="img/bild.webp" height="1">\n<a href'); });
  assert.equal(funde.length, 2, funde.join('\n'));
  assert.match(funde[0], /^notiz\.html:1 .*ohne width/);
  assert.match(funde[1], /ohne alt/);
});

test('leeres alt ist erlaubt (Schmuckbild)', () => {
  assert.deepEqual(laufe((d) => { d['notiz.html'] = d['notiz.html'].replace('<a href', '<img src="img/bild.webp" width="1" height="1" alt=""><a href'); }), []);
});

test('toter Link, totes srcset und totes Sprungziel', () => {
  genauEiner(laufe((d) => { d['notiz.html'] = d['notiz.html'].replace('href="./"', 'href="fehlt.html"'); }), /Link fehlt\.html zeigt auf keine vorhandene Datei/);
  genauEiner(laufe((d) => { d['img/bild.webp'] = null; d['en/index.html'] = d['en/index.html'].replace(/<picture>.*<\/picture>/, ''); d['index.html'] = d['index.html'].replace(/<img [^>]*>/, ''); }), /^index\.html:5 .*img\/bild\.webp/);
  genauEiner(laufe((d) => { d['notiz.html'] = d['notiz.html'].replace('id="abschnitt"', 'id="anders"'); }).filter((f) => f.startsWith('index.html')), /Sprungziel notiz\.html#abschnitt/);
});

test('Link aus dem Repo heraus wird nicht verfolgt', () => {
  genauEiner(laufe((d) => { d['notiz.html'] = d['notiz.html'].replace('href="./"', 'href="../../etc/hosts"'); }), /zeigt auf keine vorhandene Datei/);
});

test('DE und EN: ids und Zahlen müssen gleich sein', () => {
  genauEiner(laufe((d) => { d['en/index.html'] = d['en/index.html'].replace(' id="titel"', '').replace('href="#titel"', 'href="#top"'); d['index.html'] = d['index.html'].replace('href="#titel"', 'href="#top"'); }), /^en\/index\.html .*id="titel" fehlt/);
  genauEiner(laufe((d) => { d['en/index.html'] = d['en/index.html'].replace('3,619', '3,620'); }).filter((f) => f.includes('3.619')), /Zahl 3\.619 steht 1-mal im Text, in en\/index\.html 0-mal/);
});

test('falsches oder fehlendes canonical', () => {
  genauEiner(laufe((d) => { d['notiz.html'] = d['notiz.html'].replace('/notiz.html">', '/">'); }), /^notiz\.html:1 .*canonical/);
  genauEiner(laufe((d) => { d['notiz.html'] = d['notiz.html'].replace(/<link rel="canonical"[^>]*>/, ''); }), /kein <link rel="canonical">/);
});

test('robots.txt und alte Adresse', () => {
  const alt = ['stefan-paun', 'github', 'io'].join('.');
  const funde = laufe((d) => { d['robots.txt'] = d['robots.txt'].replace('beispiel.test', alt); });
  assert.equal(funde.length, 2, funde.join('\n'));
  assert.match(funde[0], /^robots\.txt:4 .*Sitemap sollte/);
  assert.match(funde[1], /^robots\.txt:4 .*alte Adresse/);
});

test('CSP: Inline-Skript ohne Hash, style-Attribut, Seite ohne CSP', () => {
  const skript = `const html = '<img src="gibt-es-nicht.png"> 999';`;
  const hash = `'sha256-${createHash('sha256').update(skript).digest('base64')}'`;
  const mitCsp = (quellen) => (d) => {
    for (const datei of ['index.html', 'en/index.html', 'notiz.html', '404.html']) {
      d[datei] = d[datei].replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${quellen}; style-src 'self'">`);
    }
  };
  assert.deepEqual(laufe(mitCsp(`'self' ${hash}`)), []);
  const ohneHash = laufe(mitCsp("'self'"));
  assert.equal(ohneHash.length, 2, ohneHash.join('\n'));
  assert.match(ohneHash[0], /^en\/index\.html:6 .*Inline-<script> fehlt in der CSP/);
  assert.match(ohneHash[1], /^index\.html:6 .*Inline-<script> fehlt in der CSP/);
  genauEiner(laufe((d) => { mitCsp(`'self' ${hash}`)(d); d['notiz.html'] = d['notiz.html'].replace('<h2 ', '<h2 style="color:red" '); }), /^notiz\.html:1 .*style-Attribut an <h2>/);
  genauEiner(laufe((d) => { mitCsp(`'self' ${hash}`)(d); d['notiz.html'] = d['notiz.html'].replace(/<meta http-equiv[^>]*>/, ''); }), /^notiz\.html .*keine Content-Security-Policy/);
});

test('tags: Attribute mit > und Zeilennummern, zahlen: ohne Skript und <time>', () => {
  const liste = tags('<p>\n<img alt="a > b" src=x.png>\n<!-- <img src="y.png"> --></p>');
  assert.deepEqual(liste.map((t) => [t.name, t.zeile]), [['p', 1], ['img', 2]]);
  assert.equal(liste[1].attribute.alt, 'a > b');
  assert.deepEqual(zahlen('<p data-x="7">3.619 und 1,5 <time datetime="2026-11-01">1. November</time><script>42</script></p>'), ['3.619', '1,5']);
  assert.equal(normal('3.619'), normal('3,619'));
});

test('unlesbare Tags werden gemeldet statt verschluckt', () => {
  assert.deepEqual(unlesbar('<p>ok</p>\n<img src="x.png"class="y">'), [2]);
  genauEiner(laufe((d) => { d['notiz.html'] = d['notiz.html'].replace('<a href', '<img src="fehlt.png"class="x"><a href'); }), /^notiz\.html:1 .*Tag nicht lesbar/);
});

test('Kommentarzeichen im Skript verschluckt kein HTML', () => {
  assert.deepEqual(tags('<script>var a="<!--";</script>\n<img src="x.png">\n<!-- Fuss -->').map((t) => t.name), ['script', 'img']);
});

test('id fehlt in der DE-Seite, doppelte id, Entities sind keine Zahlen', () => {
  genauEiner(laufe((d) => { d['en/index.html'] = d['en/index.html'].replace('<h1 ', '<i id="nur-en"></i><h1 '); }), /^index\.html .*id="nur-en" fehlt/);
  genauEiner(laufe((d) => { d['notiz.html'] = d['notiz.html'].replace('<a href', '<i id="abschnitt"></i><a href'); }), /id="abschnitt" kommt 2-mal vor/);
  assert.deepEqual(zahlen('<p>a&#8211;b &nbsp; 7</p>'), ['7']);
});

test('Kommandozeile: Exit-Code 0 bzw. 1, auch über einen verlinkten Pfad, Symlinks im Baum werden übersprungen', () => {
  const skript = fileURLToPath(new URL('./check.mjs', import.meta.url));
  const starte = (pfad, ordner) => spawnSync(process.execPath, [pfad, ordner], { encoding: 'utf8' });
  laufe(() => {}, (ordner) => {
    symlinkSync(tmpdir(), join(ordner, 'hinaus'));
    const gut = starte(skript, ordner);
    assert.equal(gut.status, 0, gut.stderr);
    assert.match(gut.stdout, /Alles in Ordnung: 4 Seiten/);
    const verlinkt = join(ordner, 'img', 'werkzeug');
    symlinkSync(dirname(skript), verlinkt);
    assert.equal(starte(join(verlinkt, 'check.mjs'), ordner).status, 0);
    writeFileSync(join(ordner, 'robots.txt'), 'User-agent: *\n');
    const rot = starte(join(verlinkt, 'check.mjs'), ordner);
    assert.equal(rot.status, 1);
    assert.match(rot.stderr, /robots\.txt  nennt keine Sitemap/);
  });
});

// --- 8. Zahlen-Abgleich (tools/zahlen.json) ---

const ZAHLEN = { stand: '2026-11-17', projekte: {
  'agent-board': { repo: 'Stefan-Paun/agent-board', release: 'v1.6.0', tests: 304, anzeige: 300 },
  jarvis: { repo: 'privat', tests: 4451, anzeige: 4400 },
} };
const mitZahlen = (aenderung = {}) => (d) => {
  d['tools/zahlen.json'] = JSON.stringify(ZAHLEN);
  const block = (en) => `<p>Release <span data-zahl="agent-board.version">v1.6.0</span>, ${en ? 'over' : 'über'} <span data-zahl="agent-board.tests">300</span> Tests</p>
<table><tr><th>Tests</th><td class="c-typ v" data-zahl="jarvis.tests"><span class="q">${en ? 'over' : 'über'}</span>${en ? '4,400' : '4.400'}</td></tr></table>`;
  d['index.html'] = d['index.html'].replace('<html>', '<html lang="de">').replace('</main>', block(false) + '</main>');
  d['en/index.html'] = d['en/index.html'].replace('<html>', '<html lang="en">').replace('</main>', block(true) + '</main>');
  for (const [datei, f] of Object.entries(aenderung)) d[datei] = f(d[datei]);
};

test('Zahlen: anzeige rundet ab und bleibt echt kleiner, formatiere je Sprache', () => {
  assert.deepEqual([304, 300, 137, 149, 4451, 4400, 1000, 9].map(anzeige), [300, 290, 130, 140, 4400, 4300, 900, 0]);
  assert.equal(formatiere(4400, 'de'), '4.400');
  assert.equal(formatiere(4400, 'en'), '4,400');
  assert.equal(formatiere(300, 'en'), '300');
});

test('Zahlen: passende Seite ist grün, ohne zahlen.json wird nichts verlangt', () => {
  assert.deepEqual(laufe(mitZahlen()), []);
  assert.deepEqual(laufe((d) => { d['index.html'] = d['index.html'].replace('</main>', 'über 5 Tests</main>'); d['en/index.html'] = d['en/index.html'].replace('</main>', 'over 5 Tests</main>'); }), []);
});

test('Zahlen: falsche Testzahl, falsche Version, unmarkierte Zahl, fehlendes Projekt', () => {
  genauEiner(laufe(mitZahlen({ 'en/index.html': (h) => h.replace('4,400', '4,300') })).filter((f) => f.includes('jarvis')), /^en\/index\.html:\d+ .*jarvis: Testzahl "over 4,300" passt nicht, laut zahlen\.json "über 4,400"/);
  genauEiner(laufe(mitZahlen({ 'index.html': (h) => h.replace('4.400', '4,400'), 'en/index.html': (h) => h })).filter((f) => f.includes('jarvis')), /Testzahl "über 4,400" passt nicht/);
  const version = laufe(mitZahlen({ 'index.html': (h) => h.replace('>v1.6.0<', '>v1.7.0<'), 'en/index.html': (h) => h.replace('>v1.6.0<', '>v1.7.0<') }));
  assert.equal(version.length, 2, version.join('\n'));
  assert.match(version[0], /agent-board: Version "v1\.7\.0" passt nicht, aktuelles Release ist v1\.6\.0/);
  genauEiner(laufe(mitZahlen({ 'notiz.html': (h) => h.replace('</body>', 'über 3.600 automatische Tests</body>') })), /^notiz\.html .*"über 3\.600 automatische Tests" steht ohne data-zahl/);
  const fehlt = laufe(mitZahlen({ 'index.html': (h) => h.replace(' data-zahl="jarvis.tests"', ''), 'en/index.html': (h) => h.replace(' data-zahl="jarvis.tests"', '') }));
  assert.ok(fehlt.some((f) => /^index\.html .*jarvis: keine Stelle mit data-zahl/.test(f)), fehlt.join('\n'));
});

test('Zahlen: unstimmige zahlen.json und unbekanntes Projekt werden gemeldet', () => {
  const kaputt = structuredClone(ZAHLEN);
  kaputt.projekte.jarvis.anzeige = 4451;
  kaputt.projekte['agent-board'].fehlgeschlagen = 2;
  const funde = laufe((d) => { mitZahlen()(d); d['tools/zahlen.json'] = JSON.stringify(kaputt); }).filter((f) => f.startsWith('tools/zahlen.json'));
  assert.equal(funde.length, 2, funde.join('\n'));
  assert.match(funde.join('\n'), /agent-board: 2 rote Tests/);
  assert.match(funde.join('\n'), /jarvis: anzeige 4451 ist nicht kleiner als 4451/);
  genauEiner(laufe(mitZahlen({ 'notiz.html': (h) => h.replace('</body>', '<b data-zahl="glas.tests">1</b></body>') })), /Projekt glas fehlt in tools\/zahlen\.json/);
});

test('Kommandozeile: zahlen.mjs --pruefen gibt Exit 0 bei passender und Exit 1 bei falscher Zahl', () => {
  const skript = fileURLToPath(new URL('./zahlen.mjs', import.meta.url));
  const starte = (ordner) => spawnSync(process.execPath, [skript, '--pruefen', ordner], { encoding: 'utf8' });
  laufe(mitZahlen(), (ordner) => {
    const gut = starte(ordner);
    assert.equal(gut.status, 0, gut.stderr);
    assert.match(gut.stdout, /Zahlen-Abgleich in Ordnung/);
    const pfad = join(ordner, 'index.html');
    writeFileSync(pfad, readFileSync(pfad, 'utf8').replace('>300<', '>310<'));
    const rot = starte(ordner);
    assert.equal(rot.status, 1);
    assert.match(rot.stderr, /agent-board: Testzahl "310" passt nicht, laut zahlen\.json "über 300"/);
  });
});
