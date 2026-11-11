// Selbsttest für tools/check.mjs: baut eine kleine Seite in einem Temp-Ordner und prüft,
// dass sie grün ist und dass jede eingebaute Lücke gemeldet wird.   node --test tools/check.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { normal, pruefe, tags, zahlen } from './check.mjs';

const BASIS = 'https://beispiel.test';
const kopf = (pfad, extra = '') => `<!doctype html><html><head><title>t</title><link rel="canonical" href="${BASIS}${pfad}">${extra}</head>`;
const start = (praefix, zahl, sprache) => `${kopf(sprache === 'en' ? '/en/' : '/')}<body>
<main id="top"><h1 id="titel">Seite</h1>
<span class="num">${zahl}</span> Tests, Version 1.5.0, <time datetime="2026-10-31">${sprache === 'en' ? '31 October' : '31. Oktober'}</time>
<a href="#titel">hoch</a> <a href="${praefix}notiz.html#abschnitt">Notiz</a> <a href="${BASIS}/stapelwerk/">Projekt</a>
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
<url><loc>${BASIS}/stapelwerk/</loc></url>
</urlset>`,
    'index.html': start('', '3.619', 'de'),
    'en/index.html': start('../', '3,619', 'en'),
    'notiz.html': `${kopf('/notiz.html')}<body><h2 id="abschnitt">A</h2><a href="./">Start</a></body></html>`,
    '404.html': '<!doctype html><html><head><title>404</title><meta name="robots" content="noindex"></head><body><a href="/">Start</a></body></html>',
    'img/bild.webp': '',
  };
}

function laufe(aendere = () => {}) {
  const dateien = gutesRepo();
  aendere(dateien);
  const ordner = mkdtempSync(join(tmpdir(), 'check-'));
  try {
    for (const [pfad, inhalt] of Object.entries(dateien)) {
      if (inhalt === null) continue;
      mkdirSync(dirname(join(ordner, pfad)), { recursive: true });
      writeFileSync(join(ordner, pfad), inhalt);
    }
    return pruefe(ordner).funde;
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

test('tags: Attribute mit > und Zeilennummern, zahlen: ohne Skript und <time>', () => {
  const liste = tags('<p>\n<img alt="a > b" src=x.png>\n<!-- <img src="y.png"> --></p>');
  assert.deepEqual(liste.map((t) => [t.name, t.zeile]), [['p', 1], ['img', 2]]);
  assert.equal(liste[1].attribute.alt, 'a > b');
  assert.deepEqual(zahlen('<p data-x="7">3.619 und 1,5 <time datetime="2026-11-01">1. November</time><script>42</script></p>'), ['3.619', '1,5']);
  assert.equal(normal('3.619'), normal('3,619'));
});
