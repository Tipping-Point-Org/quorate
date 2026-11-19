// Remediation of review 20260928-232013-ltb-review-r2 (operator: "1 yes, 2 A, 3 ledger, 4 as suggested, 5 fingerprint").
// Fixed: G-17 with its symptom G-8, G-18, G-19 (the benchmark reader); G-12, G-13 and the push-scan rule for
// unquoted values (2 A); G-9, G-14, G-15, G-21 (pulled forward).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { redactClaim } from '../scripts/lib/redact.mjs';
import { collectRun } from '../scripts/io/run-artifacts.mjs';
import { mergeRun, markFixed } from '../scripts/lib/ledger.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const PW = 'pass' + 'word';                 // credential names built at runtime (operator: "build at runtime")
const KEYN = 'api' + '_key';

function tmp(t) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-ltbr2-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}
function runDir(t, nodes, { runJson = true } = {}) {
  const r = path.join(tmp(t), 'run');
  fs.mkdirSync(path.join(r, 'nodes'), { recursive: true });
  if (runJson) fs.writeFileSync(path.join(r, 'run.json'), JSON.stringify({ run_id: '20260101-000000-x' }));
  for (const [id, { status, findings }] of Object.entries(nodes)) {
    fs.mkdirSync(path.join(r, 'evidence', id), { recursive: true });
    fs.writeFileSync(path.join(r, 'nodes', `${id}.status.json`), JSON.stringify({ node_id: id, ...status }));
    fs.writeFileSync(path.join(r, 'evidence', id, 'verdict.kept.json'), JSON.stringify({ findings }));
  }
  return r;
}
const F = (claim = 'a defect') => ({ file: 'a.mjs', line: 1, severity: 'LOW', claim });

test('G-17, G-8: a run with no readable run.json is not scored as a run', (t) => {
  const r = runDir(t, { 'code-audit': { status: { state: 'OK', findings_count: 1 }, findings: [F()] } }, { runJson: false });
  // Since secret-shapes-and-refusals 2a the refusal is THROWN (G-4 of ltb-review-r4: callers ignored the map), so no
  // findings can be scored from it at all.
  assert.throws(() => collectRun(r, { warn: () => {} }), (e) => e?.name === 'RunRefused' && /not scored/.test(e.message),
    'a directory with no run record was read as a run');
});

test('G-18: the benchmark scores findings only from nodes that reported OK, as the fold does', (t) => {
  const r = runDir(t, {
    'code-audit': { status: { state: 'OK', findings_count: 1 }, findings: [F('kept')] },
    'panel-codex-code': { status: { state: 'DEGRADED' }, findings: [F('from a degraded arm')] },
  });
  const c = collectRun(r, { warn: () => {} });
  assert.deepEqual(Object.keys(c.findingsByNode), ['code-audit'], 'a DEGRADED node\'s findings were scored');
});

test('G-19: claim text carried into benchmark results is redacted', (t) => {
  const r = runDir(t, { 'code-audit': { status: { state: 'OK', findings_count: 1 }, findings: [F(`leaks {"${PW}": "Tr0ub4dor&3xq9Zk"}`)] } });
  const c = collectRun(r, { warn: () => {} });
  assert.ok(!c.findingsByNode['code-audit'][0].claim.includes('Tr0ub4dor&3xq9Zk'), 'a raw claim reached the scoring payload');
});

test('G-13, G-12: a quoted key with an unquoted value, a short quoted value, and an escaped quote are redacted', () => {
  const cases = [
    [`'${PW}': hunter2secret9`, 'hunter2secret9'],
    [`"${KEYN}": 9f8e7d6c5b4a3`, '9f8e7d6c5b4a3'],
    [`${PW}: "ab12"`, 'ab12'],
    [`${PW} = 'ab\\'cd\\'efgh'`, "cd\\'efgh"],
  ];
  for (const [text, secret] of cases) {
    const out = redactClaim(text);
    assert.ok(!out.includes(secret), `${text} -> ${out}`);
  }
  // Still not prose: an unquoted word after a credential name, or an empty or placeholder value.
  assert.equal(redactClaim('every token: short-flag clusters'), 'every token: short-flag clusters');
  assert.equal(redactClaim(`${PW}: ""`), `${PW}: ""`);
});

const gitleaks = spawnSync('gitleaks', ['version'], { encoding: 'utf8' });
test('2 A: the shipped push-scan rule catches unquoted generated values and short quoted ones, not ordinary code', { skip: gitleaks.status !== 0 && 'gitleaks is not installed; CI installs it' }, (t) => {
  const d = tmp(t);
  fs.writeFileSync(path.join(d, 'a.yml'), `${PW}: hunter2secret9\n`);
  fs.writeFileSync(path.join(d, 'b.json'), `{"${PW}": "ab12x"}\n`);
  fs.writeFileSync(path.join(d, 'c.js'), `const token = getToken();\nconst ${KEYN} = process.env.X;\nhooks:\n  secret_scan: required\n`);
  const rep = path.join(d, 'r.json');
  spawnSync('gitleaks', ['dir', d, '--no-banner', '--redact', '--report-format', 'json', '--report-path', rep, '--config', path.join(REPO, '.claude', 'hooks', 'gitleaks.toml')], { encoding: 'utf8' });
  const found = [...new Set(JSON.parse(fs.readFileSync(rep, 'utf8')).map((x) => path.basename(x.File)))].sort();
  assert.deepEqual(found, ['a.yml', 'b.json']);
});

test('G-9: a claim with no reason leaves no older reason standing as the entry\'s latest', () => {
  let { ledger } = mergeRun(null, { run_id: '20260901-000000-r', at: '2026-09-01T00:00:00.000Z', findings: [{ ...F(), node: 'code-audit' }] });
  const key = Object.keys(ledger.entries)[0];
  ledger = markFixed(ledger, [key], 'r2', { disposition: 'open', reason: 'deferred earlier', at: '2026-09-02T00:00:00.000Z' }).ledger;
  ledger = markFixed(ledger, [key], 'r3', { disposition: 'fixed_claimed', at: '2026-09-03T00:00:00.000Z' }).ledger;
  assert.equal(ledger.entries[key].reason ?? null, null, 'the deferral\'s reason still reads as the latest');
  assert.equal(ledger.entries[key].decisions[0].reason, 'deferred earlier', 'the history lost it');
});

test('G-14, G-15, G-21: the reader\'s docstrings and the element shape match what the code does', () => {
  const ra = fs.readFileSync(path.join(REPO, 'scripts', 'lib', 'run-artifacts.mjs'), 'utf8');
  assert.doesNotMatch(ra, /findings` \(if present\)/, 'readKeptVerdict\'s docstring still says findings is optional');
  assert.match(ra, /review node/i, 'readNodeStatus\'s docstring does not say the count is a review node\'s');
  const lt = fs.readFileSync(path.join(REPO, 'shared', 'ledger-transitions.md'), 'utf8');
  assert.match(lt, /`quote_by`/, 'the element fields do not name quote_by');
});
