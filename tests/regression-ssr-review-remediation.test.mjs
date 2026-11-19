// Remediation of review 20260929-124952-ssr-review (operator, 2026-09-29: "1 A, 2 fix, 3 as suggested, 4 as suggested").
// Fixed: G-8 with its symptom G-12, and the dropped G-1 (text reaching tracked bench results unredacted), G-4 (a
// refusal that never reaches the result file), G-13 (more kept findings than recorded), and the LOWs pulled forward:
// G-15 (a non-list `groups`), G-9 (a run record with no run_id), G-11 (nodes/ enumerated before containment).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectRun } from '../scripts/io/run-artifacts.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const F = { file: 'a.mjs', line: 1, severity: 'LOW', claim: 'x' };
const quiet = { warn: () => {} };

function run(t, nodes, { record = { run_id: '20260101-000000-x' } } = {}) {
  const r = path.join(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-ssr-'))), 'run');
  t.after(() => fs.rmSync(path.dirname(r), { recursive: true, force: true }));
  fs.mkdirSync(path.join(r, 'nodes'), { recursive: true });
  if (record) fs.writeFileSync(path.join(r, 'run.json'), JSON.stringify(record));
  for (const [id, { status, findings }] of Object.entries(nodes)) {
    if (status) fs.writeFileSync(path.join(r, 'nodes', `${id}.status.json`), JSON.stringify({ node_id: id, ...status }));
    if (findings !== undefined) {
      fs.mkdirSync(path.join(r, 'evidence', id), { recursive: true });
      fs.writeFileSync(path.join(r, 'evidence', id, 'verdict.kept.json'), JSON.stringify({ findings }));
    }
  }
  return r;
}
const src = (f) => fs.readFileSync(path.join(REPO, 'scripts', f), 'utf8');

// G-8, G-12, G-1 — option A: the whole result object is redacted at the one place each benchmark writes it, so a
// refusal reason quoting a malformed file, a node_id, a judge's verbatim quote, or anything added later is covered.
test('G-8, G-12, G-1: every benchmark result bound for bench/results is redacted as a whole where it is written', () => {
  const sites = [
    ['bench-lenses.mjs', /fs\.writeFileSync\(outFile,\s*JSON\.stringify\(redactTree\(result\)/],
    ['bench-lenses.mjs', /process\.stdout\.write\(JSON\.stringify\(redactTree\(\{/],
    ['bench-second-opinion.mjs', /fs\.writeFileSync\(forgePath,\s*JSON\.stringify\(redactTree\(\{/],
    ['bench-second-opinion.mjs', /fs\.writeFileSync\(outPath,\s*JSON\.stringify\(redactTree\(\{/],
  ];
  const missing = sites.filter(([f, re]) => !re.test(src(f))).map(([f, re]) => `${f}: ${re}`);
  assert.deepEqual(missing, [], 'a result write that does not pass through redactTree');
});

// G-4: the refusal reaches the result file, not only the console.
test('G-4: a run-level refusal is recorded in not_run, and the spend path records refusals in its entry', () => {
  for (const f of ['bench-lenses.mjs', 'bench-second-opinion.mjs']) {
    assert.match(src(f), /notRun\.push\(\{[^\n]*\brefused\b/, `${f}: NOT RUN records no refused field`);
  }
  const lenses = src('bench-lenses.mjs');
  assert.match(lenses, /unscoredSpend\.push\(\{[^\n]*\brefused\b/, 'the spend path drops node-level refusals from its entry');
  const i = lenses.indexOf('spend not recorded');
  assert.ok(i > 0, 'the spend path no longer says the refusal');
  assert.match(lenses.slice(i - 600, i + 300), /unscoredSpend\.push\(\{[^\n]*\brefused\b/, 'a refused spend read reaches the console only');
});

// G-13: the status file is the durable record, and both writers set the count from what was kept; more is not sound.
test('G-13: a verdict holding MORE findings than its status records is refused, and not scored', (t) => {
  const r = run(t, { 'code-audit': { status: { state: 'OK', findings_count: 1 }, findings: [F, { ...F, line: 2 }] } });
  const c = collectRun(r, quiet);
  assert.ok(c.refused['code-audit'], `an appended finding was scored: ${JSON.stringify(c.refused)}`);
  assert.equal(c.findingsByNode['code-audit'], undefined);
});

// G-15: a present artifact whose `groups` is not a list is malformed, not absent.
test('G-15: a reconcile payload or finding-groups file whose groups is not a list is refused', (t) => {
  const r = run(t, {});
  fs.mkdirSync(path.join(r, 'evidence', 'reconcile'), { recursive: true });
  fs.writeFileSync(path.join(r, 'evidence', 'reconcile', 'payload.json'), JSON.stringify({ groups: 'G-1' }));
  fs.writeFileSync(path.join(r, 'finding-groups.json'), JSON.stringify({ groups: { 'G-1': {} } }));
  const keys = Object.keys(collectRun(r, quiet).refused).join(' ');
  assert.match(keys, /payload\.json/, 'a non-list groups in payload.json read as empty');
  assert.match(keys, /finding-groups\.json/, 'a non-list groups in finding-groups.json read as empty');
});

// G-9: a run record is a run's only if it names the run.
test('G-9: a run.json with no run_id is refused as a run record', (t) => {
  for (const record of [{}, { run_id: '' }, { run_id: 7 }]) {
    const r = run(t, { 'code-audit': { status: { state: 'OK', findings_count: 1 }, findings: [F] } }, { record });
    assert.throws(() => collectRun(r, quiet), (e) => e?.name === 'RunRefused' && /run_id/.test(e.message), JSON.stringify(record));
  }
});

// G-11: nodes/ and evidence/ are enumerated only when their real paths stay inside the run.
test('G-11: a nodes/ or evidence/ directory that leads outside the run is refused, and nothing in it is listed', (t) => {
  for (const which of ['nodes', 'evidence']) {
    const r = run(t, {});
    fs.rmSync(path.join(r, which), { recursive: true, force: true });
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'q-ssr-outside-'));
    t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
    fs.writeFileSync(path.join(outside, 'outside-name.status.json'), '{ not json');
    fs.mkdirSync(path.join(outside, 'outside-node'));
    fs.symlinkSync(outside, path.join(r, which), process.platform === 'win32' ? 'junction' : 'dir');
    const c = collectRun(r, quiet);
    const text = JSON.stringify(c.refused);
    assert.match(Object.keys(c.refused).join(' '), new RegExp(`^${which}$|\\b${which}\\b`), `${which}/ outside the run was enumerated: ${text}`);
    assert.doesNotMatch(text, /outside-name|outside-node/, `a name from outside the run reached refused: ${text}`);
  }
});
