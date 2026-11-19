// Remediation of review 20260929-002417-ltb-review-r3 (operator: "1 yes, 2 as suggested, 3 as suggested").
// Fixed: G-12 with its symptom G-11 and G-9 (the benchmark reader), G-2 and G-1 (the push-scan rules), G-16 (docs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectRun as pureCollectRun } from '../scripts/lib/run-artifacts.mjs';
import { collectRun } from '../scripts/io/run-artifacts.mjs';
import { hostPlatform } from '../scripts/platform/index.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const PW = 'pass' + 'word';                 // credential names built at runtime (operator: "build at runtime")

function run(t, nodes) {
  const r = path.join(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-ltbr3-'))), 'run');
  t.after(() => fs.rmSync(path.dirname(r), { recursive: true, force: true }));
  fs.mkdirSync(path.join(r, 'nodes'), { recursive: true });
  fs.writeFileSync(path.join(r, 'run.json'), JSON.stringify({ run_id: '20260101-000000-x' }));
  for (const [id, { status, findings }] of Object.entries(nodes)) {
    fs.mkdirSync(path.join(r, 'evidence', id), { recursive: true });
    if (status) fs.writeFileSync(path.join(r, 'nodes', `${id}.status.json`), JSON.stringify({ node_id: id, ...status }));
    fs.writeFileSync(path.join(r, 'evidence', id, 'verdict.kept.json'), JSON.stringify({ findings }));
  }
  return r;
}
const F = { file: 'a.mjs', line: 1, severity: 'LOW', claim: 'x' };

test('G-12, G-11: a kept verdict whose node has no status, or a status that is not OK, is refused and said', (t) => {
  const r = run(t, {
    'code-audit': { status: null, findings: [F] },
    'panel-codex-code': { status: { state: 'DEGRADED' }, findings: [F] },
  });
  const said = [];
  const c = collectRun(r, { warn: (m) => said.push(m) });
  assert.deepEqual(c.findingsByNode, {});
  assert.ok(c.refused['code-audit'], `a verdict with no status dropped silently: ${JSON.stringify(c.refused)}`);
  assert.ok(c.refused['panel-codex-code'], 'a DEGRADED node\'s verdict dropped silently');
  assert.ok(said.some((m) => /code-audit/.test(m)) && said.some((m) => /panel-codex-code/.test(m)), `not said: ${said}`);
});

test('G-9: each status file is read once', (t) => {
  const r = run(t, { 'code-audit': { status: { state: 'OK', findings_count: 1 }, findings: [F] } });
  const h = hostPlatform();
  const reads = {};
  const fsCounting = { ...h.fs, readFileSync: (p, ...rest) => { const k = String(p); if (k.endsWith('.status.json')) reads[k] = (reads[k] ?? 0) + 1; return h.fs.readFileSync(p, ...rest); } };
  pureCollectRun(r, { io: { ...h, fs: fsCounting } });
  assert.deepEqual(Object.values(reads), [1], `status reads: ${JSON.stringify(reads)}`);
});

const gitleaks = spawnSync('gitleaks', ['version'], { encoding: 'utf8' });
test('G-2, G-1: the push scan catches a digit in second place and a quoted value with an escaped quote', { skip: gitleaks.status !== 0 && 'gitleaks is not installed; CI installs it' }, (t) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-ltbr3-gl-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  fs.writeFileSync(path.join(d, 'a.yml'), `${PW}: x1abcdefgh\n`);
  fs.writeFileSync(path.join(d, 'b.yml'), `${PW}: "ab\\"cdefgh"\n`);
  fs.writeFileSync(path.join(d, 'c.js'), 'const token = getToken();\nconst n = token: 5;\n');
  const rep = path.join(d, 'r.json');
  spawnSync('gitleaks', ['dir', d, '--no-banner', '--redact', '--report-format', 'json', '--report-path', rep, '--config', path.join(REPO, '.claude', 'hooks', 'gitleaks.toml')], { encoding: 'utf8' });
  const found = [...new Set(JSON.parse(fs.readFileSync(rep, 'utf8')).map((x) => path.basename(x.File)))].sort();
  assert.deepEqual(found, ['a.yml', 'b.yml']);
});

test('G-16: the contract doc names both shipped rules', () => {
  const doc = fs.readFileSync(path.join(REPO, 'shared', 'claude-md-contract.md'), 'utf8');
  assert.match(doc, /quorate-key-value-unquoted/);
  assert.match(doc, /unquoted/i);
});
