// secret-shapes-and-refusals, 1a (operator, 2026-09-29: "1a"): one definition of the secret shapes, both guards
// generated from it, and one case table — scripts/lib/secret-shapes.mjs CASES — that is their scope.
//
// Resolves G-2 (the keyword lists missed accesskey, access-key, privatekey, private-key), G-3 (the unquoted push rule
// excluded `.`, `$` and `?`) and G-10 (two owners of the rules) of 20260929-010407-ltb-review-r4.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as shapes from '../scripts/lib/secret-shapes.mjs';
import { redactClaim } from '../scripts/lib/redact.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const SHIPPED = path.join(REPO, '.claude', 'hooks', 'gitleaks.toml');
const { CASES } = shapes;

test('1a: the table has rows that must be caught and rows that must pass, each with its reason', () => {
  assert.ok(CASES.some((c) => c.catch) && CASES.some((c) => !c.catch));
  for (const c of CASES) {
    assert.ok(typeof c.text === 'string' && c.text && typeof c.why === 'string' && c.why, JSON.stringify(c));
    if (c.catch) assert.ok(typeof c.value === 'string' && c.text.includes(c.value), `a caught row names its value: ${JSON.stringify(c)}`);
  }
});

test('1a: redaction catches every row that must be caught, and leaves every other row untouched', () => {
  const wrong = [];
  for (const c of CASES) {
    const out = redactClaim(c.text);
    if (c.catch && (out.includes(c.value) || !out.includes('[redacted'))) wrong.push(`missed (${c.why}): ${out}`);
    if (!c.catch && out !== c.text) wrong.push(`altered (${c.why}): ${out}`);
  }
  assert.deepEqual(wrong, []);
});

const gitleaks = spawnSync('gitleaks', ['version'], { encoding: 'utf8' });
test('1a: the push scan, with the shipped config, catches every row that must be caught and no other', { skip: gitleaks.status !== 0 && 'gitleaks is not installed; CI installs it' }, (t) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-shapes-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const rows = path.join(d, 'rows');
  fs.mkdirSync(rows);
  CASES.forEach((c, i) => fs.writeFileSync(path.join(rows, `row-${i}.txt`), `${c.text}\n`));
  const rep = path.join(d, 'report.json');
  spawnSync('gitleaks', ['dir', rows, '--no-banner', '--redact', '--report-format', 'json', '--report-path', rep, '--config', SHIPPED], { encoding: 'utf8' });
  const found = new Set(JSON.parse(fs.readFileSync(rep, 'utf8')).map((x) => Number(/row-(\d+)\.txt$/.exec(x.File)[1])));
  const wrong = CASES.flatMap((c, i) => (c.catch === found.has(i) ? [] : [`${c.catch ? 'missed' : 'flagged'} (${c.why}): ${c.text}`]));
  assert.deepEqual(wrong, []);
});

// Every credential-name spelling the shipped rules' regexes accept must also pass their keyword prefilter:
// gitleaks runs a rule only when one of its keywords appears, so a spelling the regex accepts and no keyword admits
// is never scanned (G-2). The spellings are tried against the regexes themselves, so a word the regex gains is
// checked without editing this list.
test('G-2: every credential name the shipped rules accept is admitted by their keyword prefilter', () => {
  const toml = fs.readFileSync(SHIPPED, 'utf8');
  const rules = [...toml.matchAll(/\[\[rules\]\][\s\S]*?regex = '''\(\?i\)([\s\S]*?)'''[\s\S]*?keywords = \[([^\]]*)\]/g)]
    .map(([, re, kw]) => ({ re: new RegExp(re, 'i'), keywords: [...kw.matchAll(/"([^"]+)"/g)].map((m) => m[1].toLowerCase()) }));
  assert.ok(rules.length >= 2, `rules not found in ${SHIPPED}`);
  const words = ['password', 'passwd', 'pwd', 'secret', 'token'];
  for (const [a, b] of [['api', 'key'], ['access', 'key'], ['private', 'key'], ['client', 'secret']]) {
    for (const sep of ['', '_', '-']) words.push(a + sep + b);
  }
  const unadmitted = [];
  for (const { re, keywords } of rules) {
    for (const w of words) {
      if (re.test(`${w}: "Zq8Pw2LmX9ab"`) || re.test(`${w}: Zq8Pw2LmX9ab`)) {
        if (!keywords.some((k) => w.includes(k))) unadmitted.push(w);
      }
    }
  }
  assert.deepEqual([...new Set(unadmitted)], []);
});

// ONE SOURCE (G-10): the shipped config is generated from the definition, and the committed copy is what the
// generator writes today. Before 1a there is no definition to generate from — the two sets were kept by hand.
test('G-10: the shipped gitleaks config is generated from the one definition, and the committed copy is fresh', () => {
  assert.equal(typeof shapes.renderGitleaksToml, 'function',
    'lib/secret-shapes.mjs renders no gitleaks config: the push rules are a second, hand-kept copy of the shapes');
  assert.equal(fs.readFileSync(SHIPPED, 'utf8').replace(/\r\n/g, '\n'), shapes.renderGitleaksToml(),
    '.claude/hooks/gitleaks.toml is stale: run node scripts/gen-gitleaks-config.mjs');
});

test('G-5: check-install\'s note on a consumer\'s own gitleaks config names every shipped rule and where their scope is', () => {
  const src = fs.readFileSync(path.join(REPO, 'scripts', 'check-install.mjs'), 'utf8');
  const note = src.slice(src.indexOf('has its own .gitleaks.toml'), src.indexOf('has its own .gitleaks.toml') + 600);
  const ids = [...fs.readFileSync(SHIPPED, 'utf8').matchAll(/^id = "(quorate-key-value(?:-unquoted)?)"/gm)].map((m) => m[1]);
  assert.deepEqual(ids, ['quorate-key-value', 'quorate-key-value-unquoted']);
  for (const id of ids) assert.match(note, new RegExp(`${id}\\b`), `the note does not name ${id}`);
  assert.match(note, /quorate-<token>/, 'the note does not name the token rules');
  assert.match(note, /secret-shapes\.mjs/, 'the note does not say where the rules\' scope is');
});

test('G-10: redaction builds its patterns from the same definition', () => {
  const src = fs.readFileSync(path.join(REPO, 'scripts', 'lib', 'redact.mjs'), 'utf8');
  assert.match(src, /from '\.\/secret-shapes\.mjs'/, 'redact.mjs keeps its own copy of the credential words');
});
