// secret-shapes-and-refusals, 2a (operator, 2026-09-29: "2a", "2 as suggested"): a run whose record is refused
// cannot be scored; a node's refusal travels with the score; a node that kept fewer findings than its status
// records is refused — the node, not the run.
//
// Resolves G-4 (callers ignored `refused` and scored a refused run as zero findings), G-8 (a missing verdict was
// dropped silently), and the LOWs G-7 (two identities for one node) and G-9 (reconcile artifacts read outside the
// reader) of 20260929-010407-ltb-review-r4.
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
const F = { file: 'a.mjs', line: 1, severity: 'LOW', claim: 'x' };
const quiet = { warn: () => {} };

// A run directory: `nodes` maps an id to its status (written as nodes/<id>.status.json unless null) and its kept
// findings (written as evidence/<id>/verdict.kept.json unless undefined).
function run(t, nodes, { record = true } = {}) {
  const r = path.join(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-refusals-'))), 'run');
  t.after(() => fs.rmSync(path.dirname(r), { recursive: true, force: true }));
  fs.mkdirSync(path.join(r, 'nodes'), { recursive: true });
  if (record) fs.writeFileSync(path.join(r, 'run.json'), JSON.stringify({ run_id: '20260101-000000-x' }));
  for (const [id, { status, findings }] of Object.entries(nodes)) {
    if (status) fs.writeFileSync(path.join(r, 'nodes', `${id}.status.json`), JSON.stringify({ node_id: id, ...status }));
    if (findings !== undefined) {
      fs.mkdirSync(path.join(r, 'evidence', id), { recursive: true });
      fs.writeFileSync(path.join(r, 'evidence', id, 'verdict.kept.json'), JSON.stringify({ findings }));
    }
  }
  return r;
}
const isRunRefused = (e) => e?.name === 'RunRefused';

test('G-4: a run with no readable run.json throws RunRefused, and nothing of it can be scored', (t) => {
  const r = run(t, { 'code-audit': { status: { state: 'OK', findings_count: 1 }, findings: [F] } }, { record: false });
  assert.throws(() => pureCollectRun(r, { io: hostPlatform() }), isRunRefused, 'the pure reader returned a refused run');
  assert.throws(() => collectRun(r, quiet), (e) => isRunRefused(e) && /not scored/.test(e.message),
    'the host-bound reader returned a refused run, or its refusal does not say the run is not scored');
});

test('G-4: bench-lenses --score-only refuses a run with no run.json instead of scoring it as zero findings', (t) => {
  const r = run(t, { 'code-audit': { status: { state: 'OK', findings_count: 1 }, findings: [F] } }, { record: false });
  const res = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'bench-lenses.mjs'),
    '--score-only', '--run-dir', r,
    '--manifest', path.join(REPO, 'bench', 'corpus', 'probe-substring-match', 'manifest.json'),
    '--defect-line', '270'], { encoding: 'utf8', env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'GRAPH_NODE_DEPTH')) });
  assert.notEqual(res.status, 0, `scored a refused run: ${res.stdout}`);
  assert.match(res.stderr, /run\.json/, `the refusal is not named: ${res.stderr}`);
});

test('G-8: an OK review node that kept fewer findings than its status records is refused — the node, not the run', (t) => {
  const r = run(t, {
    'code-audit': { status: { state: 'OK', findings_count: 2 }, findings: [F] },
    'security-audit': { status: { state: 'OK', findings_count: 1 } },           // no verdict file at all
    'perf-audit': { status: { state: 'OK', findings_count: 1 }, findings: [F] }, // sound
  });
  const c = collectRun(r, quiet);
  assert.ok(c.refused['code-audit'], `a short collection scored silently: ${JSON.stringify(c.refused)}`);
  assert.ok(c.refused['security-audit'], `a missing verdict dropped silently: ${JSON.stringify(c.refused)}`);
  assert.equal(c.findingsByNode['code-audit'], undefined, 'a refused node\'s partial findings were scored');
  assert.deepEqual(Object.keys(c.findingsByNode), ['perf-audit'], 'the sound node was not scored');
});

test('G-8: a node recording no findings, and the gate variant, are not refused for having no verdict file', (t) => {
  const r = run(t, {
    reconcile: { status: { state: 'OK', mode: 'reconcile', findings_count: 0 } },
    'second-opinion': { status: { state: 'OK', mode: 'panel', kind: 'panel', findings_count: 0 } },
    'plan-review': { status: { state: 'OK', mode: 'gate', findings_count: 3 } },
  });
  assert.deepEqual(collectRun(r, quiet).refused, {});
});

test('G-7: a status whose node_id differs from its file name is refused, and nothing is keyed by the embedded id', (t) => {
  const r = run(t, { 'code-audit': { status: { state: 'OK', findings_count: 1, total_cost_usd: 1 }, findings: [F] } });
  fs.writeFileSync(path.join(r, 'nodes', 'code-audit.status.json'),
    JSON.stringify({ node_id: 'security-audit', state: 'OK', findings_count: 1, total_cost_usd: 1 }));
  const c = collectRun(r, quiet);
  assert.ok(Object.keys(c.refused).some((k) => /code-audit/.test(k)), `a mismatched status was accepted: ${JSON.stringify(c.refused)}`);
  assert.equal(c.costsByNode['security-audit'], undefined, 'spend was attributed to the embedded id');
  assert.equal(c.findingsByNode['code-audit'], undefined, 'a verdict was authorised by another node\'s status');
});

test('G-9: a malformed or link-escaped reconcile artifact is refused; an absent one stays absent', (t) => {
  const bad = run(t, {});
  fs.mkdirSync(path.join(bad, 'evidence', 'reconcile'), { recursive: true });
  fs.writeFileSync(path.join(bad, 'evidence', 'reconcile', 'payload.json'), '{ not json');
  fs.writeFileSync(path.join(bad, 'finding-groups.json'), '{ not json');
  const c = collectRun(bad, quiet);
  const keys = Object.keys(c.refused).join(' ');
  assert.match(keys, /payload\.json/, `a malformed payload.json read as absent: ${JSON.stringify(c.refused)}`);
  assert.match(keys, /finding-groups\.json/, `a malformed finding-groups.json read as absent: ${JSON.stringify(c.refused)}`);

  const escaped = run(t, {});
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'q-refusals-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, 'payload.json'), JSON.stringify({ groups: [{ group_id: 'G-1', decision: 'confirmed' }] }));
  fs.mkdirSync(path.join(escaped, 'evidence'), { recursive: true });
  fs.symlinkSync(outside, path.join(escaped, 'evidence', 'reconcile'), process.platform === 'win32' ? 'junction' : 'dir');
  const e = collectRun(escaped, quiet);
  assert.deepEqual(e.reconcileDecisions, {}, 'decisions were read through a link leading outside the run');
  assert.match(Object.keys(e.refused).join(' '), /payload\.json/, `a link-escaped payload.json was not refused: ${JSON.stringify(e.refused)}`);

  assert.deepEqual(collectRun(run(t, {}), quiet).refused, {}, 'an absent reconcile artifact was refused');
});

test('refusal reasons name files relative to the run directory, never by an absolute path', (t) => {
  const r = run(t, { 'code-audit': { status: { state: 'OK', findings_count: 1 }, findings: [F] } });
  fs.writeFileSync(path.join(r, 'nodes', 'security-audit.status.json'), '{ not json');
  const c = collectRun(r, quiet);
  const reasons = Object.values(c.refused);
  assert.ok(reasons.length, 'nothing was refused');
  for (const why of reasons) {
    assert.ok(!why.includes(r) && !why.includes(os.tmpdir()), `an absolute path in a refusal bound for a tracked result: ${why}`);
  }
});

// The live benchmark paths spawn real models, so they cannot run offline. What each one DOES with a refusal is held
// here by the code itself: every scored call reads `refused` and writes it into the record it pushes, and the spend
// path, which may not score, says a refusal instead of swallowing it.
const src = (f) => fs.readFileSync(path.join(REPO, 'scripts', f), 'utf8').split('\n');
function callSites(lines) {
  return lines.flatMap((l, i) => (/\bcollectRun\(/.test(l) && !/^\s*(import|\/\/|\*)/.test(l) ? [i] : []));
}

test('G-4: every scored collectRun call in the benchmarks reads refused, and the records they write carry it', () => {
  for (const [file, record] of [['bench-lenses.mjs', /perSeedRuns\.push\(\{[^\n]*\brefused\b/], ['bench-second-opinion.mjs', /perSeed\.push\(\{[\s\S]{0,200}?\brefused:/]]) {
    const lines = src(file);
    const sites = callSites(lines);
    assert.ok(sites.length >= 2, `${file}: no call sites found`);
    for (const i of sites) {
      const window = lines.slice(Math.max(0, i - 4), i + 6).join('\n');
      const spend = /unscoredSpend/.test(lines.slice(i, i + 4).join('\n'));
      if (!spend) assert.match(window, /\brefused\b/, `${file}:${i + 1} ignores refused`);
    }
    assert.match(lines.join('\n'), record, `${file}: the result record does not carry refused`);
  }
});

test('G-4: the spend path says a refusal instead of swallowing it in an empty catch', () => {
  const lines = src('bench-lenses.mjs');
  const i = callSites(lines).find((n) => /unscoredSpend/.test(lines.slice(n, n + 4).join('\n')));
  assert.ok(i !== undefined, 'the spend call site was not found');
  const after = lines.slice(i, i + 8).join('\n');
  assert.doesNotMatch(after, /catch\s*\{/, `bench-lenses.mjs:${i + 1}: an empty catch swallows RunRefused`);
  assert.match(after, /catch\s*\((\w+)\)[\s\S]*\b(say|warn|process\.stderr)\b/, `bench-lenses.mjs:${i + 1}: the refusal is not said`);
});

test('G-4: --score-only writes the refused nodes into its output', () => {
  const lines = src('bench-lenses.mjs');
  const i = callSites(lines)[0];
  assert.match(lines.slice(i, i + 25).join('\n'), /\brefused\b[\s\S]*JSON\.stringify|JSON\.stringify[\s\S]*\brefused\b/,
    'bench-lenses.mjs --score-only drops refused from its output');
});
