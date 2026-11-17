#!/usr/bin/env node
// Zahlen-Abgleich: Testzahlen und Release-Versionen der Nachbar-Repos für die Startseite.
//
//   node tools/zahlen.mjs              misst neu (origin/main jedes Repos) und schreibt tools/zahlen.json
//   node tools/zahlen.mjs --pruefen    vergleicht die Seite mit tools/zahlen.json, ohne Netz
//                                      Exit 0 = Seite passt, 1 = Funde (auch Teil von tools/check.mjs)
//
// Gemessen wird immer der Stand von origin/main (nach git fetch), nie ein lokaler Branch:
//   - Node-Repos: `node --test` (wie im test-Skript der package.json) in einem frischen,
//     losgelösten Worktree; gezählt wird "# tests" aus der TAP-Ausgabe.
//   - Jarvis (privat, Python): nur statisch gezählt (Testmethoden "def test…" in test_*.py),
//     die Suite wird dafür nicht gestartet.
//   - Version: die höchste Release-Marke (Tag vX.Y.Z) auf origin, nicht package.json. Ein
//     gemergter, aber noch nicht getaggter Stand gilt also noch nicht als Release.
// Auf der Seite steht "über N": N ist die Testzahl, abgerundet auf Zehner (ab 1.000 auf
// Hunderter), und immer echt kleiner als die gemessene Zahl.
//
// Die Repos werden lokal gesucht: $ZAHLEN_REPOS (Ordner mit den Klonen), sonst das Home-Verzeichnis.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pruefeZahlen } from './check.mjs';

// id = Name in data-zahl="id.tests" und in zahlen.json; ordner = mögliche lokale Klon-Namen.
export const PROJEKTE = [
  { id: 'agent-board', repo: 'agent-board', ordner: ['agent-board'], release: true },
  { id: 'jarvis', repo: 'jarvis', ordner: ['jarvis'], privat: true },
  { id: 'detention', repo: 'detention', ordner: ['detention', 'nachsitzen'] },
  { id: 'injection-bench', repo: 'injection-bench', ordner: ['injection-bench', 'pruefstand'] },
  { id: 'pr-airlock', repo: 'pr-airlock', ordner: ['pr-airlock', 'schleuse'] },
  { id: 'unanswered', repo: 'unanswered', ordner: ['unanswered', 'ungeloest'] },
];
const BESITZER = 'Stefan-Paun';

// "über N": auf Zehner (ab 1.000 auf Hunderter) abrunden, immer echt kleiner als die Zahl.
export function anzeige(tests) {
  const schritt = tests >= 1000 ? 100 : 10;
  return Math.floor((tests - 1) / schritt) * schritt;
}

const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function findeRepo(projekt) {
  const basis = process.env.ZAHLEN_REPOS ? resolve(process.env.ZAHLEN_REPOS) : homedir();
  for (const name of projekt.ordner) {
    const pfad = join(basis, name);
    if (!existsSync(join(pfad, '.git'))) continue;
    let url = '';
    try { url = git(pfad, 'remote', 'get-url', 'origin'); } catch { continue; }
    if (new RegExp(`[/:]${BESITZER}/${projekt.repo}(\\.git)?$`, 'i').test(url)) return pfad;
  }
  throw new Error(`${projekt.id}: kein lokaler Klon von ${BESITZER}/${projekt.repo} gefunden (gesucht: ${projekt.ordner.join(', ')})`);
}

function hoechsteRelease(repo) {
  const marken = git(repo, 'ls-remote', '--tags', 'origin')
    .split('\n').map((z) => z.split('refs/tags/')[1] ?? '')
    .filter((t) => /^v\d+\.\d+\.\d+$/.test(t));
  const zahl = (t) => t.slice(1).split('.').map(Number);
  marken.sort((a, b) => { const [x, y] = [zahl(a), zahl(b)]; return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; });
  return marken.at(-1) ?? null;
}

// Jarvis: Testmethoden in test_*.py zählen (wie die Suite sie sammelt, test_text.py ausgenommen).
function zaehleStatisch(repo) {
  const r = spawnSync('git', ['-C', repo, 'grep', '-c', '-E', '^[[:space:]]+(async[[:space:]]+)?def test', 'origin/main', '--', 'test_*.py'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git grep in ${repo} fehlgeschlagen`);
  let summe = 0;
  for (const zeile of r.stdout.split('\n').filter(Boolean)) {
    if (/(^|[/:])test_text\.py:/.test(zeile)) continue;
    summe += Number(zeile.split(':').at(-1));
  }
  return { tests: summe, fehlgeschlagen: null, gezaehlt: 'statisch: Testmethoden in test_*.py, Suite nicht gestartet' };
}

// Node-Repos: test-Skript aus package.json in einem frischen Worktree von origin/main laufen lassen.
function zaehleNode(repo) {
  const paket = JSON.parse(git(repo, 'show', 'origin/main:package.json'));
  const skript = paket.scripts?.test ?? '';
  if (!/^node --test(\s|$)/.test(skript)) throw new Error(`${repo}: test-Skript "${skript}" ist nicht "node --test …"`);
  const ordner = mkdtempSync(join(tmpdir(), 'zahlen-'));
  try {
    git(repo, 'worktree', 'add', '--detach', '--quiet', ordner, 'origin/main');
    const befehl = skript.replace(/^node --test/, 'node --test --test-reporter=tap');
    const r = spawnSync('sh', ['-c', befehl], { cwd: ordner, encoding: 'utf8', env: { ...process.env, CI: '1' }, maxBuffer: 64 * 1024 * 1024, timeout: 15 * 60 * 1000 });
    const wert = (name) => { const m = r.stdout.match(new RegExp(`^# ${name} (\\d+)$`, 'm')); return m ? Number(m[1]) : null; };
    const tests = wert('tests');
    if (tests === null) throw new Error(`${repo}: keine "# tests"-Zeile in der Ausgabe (Exit ${r.status})\n${(r.stderr || '').slice(-800)}`);
    return { tests, fehlgeschlagen: wert('fail') ?? 0, gezaehlt: 'node --test auf origin/main' };
  } finally {
    try { git(repo, 'worktree', 'remove', '--force', ordner); } catch { /* unten aufräumen */ }
    rmSync(ordner, { recursive: true, force: true });
    try { git(repo, 'worktree', 'prune'); } catch { /* egal */ }
  }
}

export function miss(projekte = PROJEKTE, log = console.error) {
  const ergebnis = {};
  for (const p of projekte) {
    const repo = findeRepo(p);
    git(repo, 'fetch', '--quiet', 'origin', 'main');
    const eintrag = { repo: p.privat ? 'privat' : `${BESITZER}/${p.repo}` };
    if (!p.privat) eintrag.commit = git(repo, 'rev-parse', '--short=7', 'origin/main');
    if (p.release) eintrag.release = hoechsteRelease(repo);
    log(`${p.id}: zähle …`);
    const z = p.privat ? zaehleStatisch(repo) : zaehleNode(repo);
    Object.assign(eintrag, { tests: z.tests, anzeige: anzeige(z.tests) });
    if (z.fehlgeschlagen !== null) eintrag.fehlgeschlagen = z.fehlgeschlagen;
    eintrag.gezaehlt = z.gezaehlt;
    log(`${p.id}: ${z.tests} Tests${z.fehlgeschlagen ? `, ${z.fehlgeschlagen} rot` : ''}${eintrag.release ? `, Release ${eintrag.release}` : ''}`);
    ergebnis[p.id] = eintrag;
  }
  return ergebnis;
}

const direktGestartet = () => {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
};

if (direktGestartet()) {
  const hier = dirname(fileURLToPath(import.meta.url));
  const args = process.argv.slice(2);
  if (args[0] === '--pruefen') {
    const wurzel = resolve(args[1] ?? join(hier, '..'));
    const funde = pruefeZahlen(wurzel);
    for (const f of funde) console.error(f);
    if (funde.length) { console.error(`\n${funde.length} Fund(e) beim Zahlen-Abgleich.`); process.exitCode = 1; }
    else console.log('Zahlen-Abgleich in Ordnung: Seite passt zu tools/zahlen.json.');
  } else if (args.length === 0) {
    const projekte = miss();
    const daten = {
      hinweis: 'Erzeugt von tools/zahlen.mjs aus origin/main der Repos. Nicht von Hand ändern, neu messen.',
      stand: new Date().toISOString().slice(0, 10),
      projekte,
    };
    writeFileSync(join(hier, 'zahlen.json'), JSON.stringify(daten, null, 2) + '\n');
    const rot = Object.entries(projekte).filter(([, e]) => e.fehlgeschlagen);
    for (const [id, e] of rot) console.error(`Achtung: ${id} hat ${e.fehlgeschlagen} rote Tests auf origin/main.`);
    console.log(`tools/zahlen.json geschrieben (${Object.keys(projekte).length} Projekte).`);
  } else {
    console.error('Aufruf: node tools/zahlen.mjs [--pruefen [ordner]]');
    process.exitCode = 2;
  }
}
