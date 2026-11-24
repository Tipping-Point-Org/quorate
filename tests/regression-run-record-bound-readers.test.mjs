// G-3 (and its symptom G-8) of 20261124-160743-gsw-remediation-2-review-b: the 8 MiB bound on a run.json lived only in
// admitRun, so the readers that enumerate sibling runs without admitting them (archive-run's citation sweep, telemetry
// backfill) still read and parsed a record of any size whole. Each now reads a run.json through readRunJson, which reads
// at most one byte past RUN_RECORD_MAX_BYTES and refuses a record larger than the bound.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript, SCRIPTS_DIR } from './helpers.mjs';
import * as reviewsRoot from '../scripts/lib/reviews-root.mjs';

const { RUN_RECORD_MAX_BYTES } = reviewsRoot;
import { confined } from '../scripts/io/confined-path.mjs';

function base(t) {
  const b = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'q-run-record-bound-')));
  t.after(() => fs.rmSync(b, { recursive: true, force: true }));
  return b;
}
const write = (dir, rec, files = {}) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(rec));
  for (const [n, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), body);
};
// A VALID record, one byte over the bound: what was refused must be its size, never its syntax.
const oversized = (dir, runId, extra = {}) => {
  fs.mkdirSync(dir, { recursive: true });
  const head = JSON.stringify({ run_id: runId, ...extra, pad: '' });
  const pad = 'x'.repeat(RUN_RECORD_MAX_BYTES + 1 - Buffer.byteLength(head));
  const body = `${head.slice(0, -2)}${pad}"}`;
  assert.ok(Buffer.byteLength(body) > RUN_RECORD_MAX_BYTES);
  JSON.parse(body);
  fs.writeFileSync(path.join(dir, 'run.json'), body);
};

test('readRunJson parses a record within the bound and refuses one larger than it', (t) => {
  const b = base(t);
  write(path.join(b, 'small'), { run_id: 'small' });
  oversized(path.join(b, 'big'), 'big');
  const own = confined(b);
  const { readRunJson } = reviewsRoot;
  assert.equal(typeof readRunJson, 'function', 'no bounded run.json reader is exported');
  assert.equal(readRunJson(own, ['small', 'run.json']).run_id, 'small');
  assert.throws(() => readRunJson(own, ['big', 'run.json']), (e) => e.code === 'EFBIG' && /larger than/.test(e.message));
});

test('lib/run-artifacts readRunRecord refuses a run.json larger than the bound, by name', async (t) => {
  const b = base(t);
  const runId = '20261124-000001-big';
  oversized(path.join(b, runId), runId);
  const { readRunRecord } = await import('../scripts/io/run-artifacts.mjs');
  const r = readRunRecord(path.join(b, runId));
  assert.equal(r.ok, false, 'an oversized record was read whole and admitted');
  assert.match(r.why, /larger than/);
});

test('archive-run: a sibling run.json larger than the bound is named unread, and no all-clear is given', (t) => {
  const b = base(t);
  const repo = path.join(b, 'repo');
  const reviews = path.join(repo, '.claude', 'reviews');
  const dead = '20260920-065201-dead';
  write(path.join(reviews, dead), { run_id: dead, repo_root: repo, archive_to: reviews });
  const big = path.join(reviews, '20260920-070634-big');
  oversized(big, '20260920-070634-big');
  const r = runScript('archive-run.mjs', ['--repo-root', repo, '--run-dir', path.join(reviews, dead)], { env: { QUORATE_HOME: path.join(b, 'home') } });
  assert.equal(r.status, 1, r.output);
  assert.doesNotMatch(r.output, /cited by no review/, `an oversized record was read whole and counted: ${r.output}`);
  assert.match(r.output, /could not read/);
  assert.ok(r.output.includes(big), `names the oversized record: ${r.output}`);
});

test('telemetry backfill: a run.json larger than the bound fails that run, and no record is built from it', (t) => {
  const b = base(t);
  const repo = path.join(b, 'repo');
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), ['# fixture', '', '```yaml', 'graph_contract_version: 6', 'project: tel-fixture',
    'commands:', '  build: ""', '  test: ""', 'source_globs: ["src/**"]', 'doc_paths: []', 'ui:', '  surface: none', 'review:',
    '  models: { judgment: opus }', '  effort: { judgment: low }', '```', ''].join('\n'));
  const git = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 'x@x'); git('config', 'user.name', 'x');
  git('add', '-A'); git('commit', '-qm', 'fixture');
  const runId = '20261124-000000-big';
  const dir = path.join(repo, '.claude', 'reviews', runId);
  oversized(dir, runId);
  fs.writeFileSync(path.join(dir, 'gate.json'), '{"gate":"RISK"}');
  const env = { ...process.env, QUORATE_HOME: path.join(b, 'home') };
  delete env.GRAPH_NODE_DEPTH;
  const r = spawnSync(process.execPath, [path.join(SCRIPTS_DIR, 'telemetry.mjs'), 'backfill', '--repo-root', repo], { cwd: repo, env, encoding: 'utf8' });
  const out = `${r.stdout}${r.stderr}`;
  assert.equal(fs.existsSync(path.join(dir, 'telemetry.json')), false, `a record was built from an oversized run.json:\n${out}`);
  assert.match(out, /larger than/, out);
  assert.equal(r.status, 1, out);
});

// G-6, G-10, G-8, G-4 and G-5 of 20261124-170802-gsw-remediation-3-review-b: the census of G-3 left five readers parsing a
// run.json read whole (writeRunRecord's fallback, remediate's loadRun, declaredReviewers, and the two bench harnesses).
// THE CENSUS AS A RATCHET: no engine source parses a run.json it read whole; each goes through readRunJson.
test('no engine source parses a run.json read whole, outside readRunJson', () => {
  const shapes = [/JSON\.parse\([^;]*run\.json/, /ownJson\([^)]*run\.json/];
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.mjs')) {
        fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach((line, i) => {
          if (shapes.some((s) => s.test(line))) hits.push(`${path.relative(SCRIPTS_DIR, p)}:${i + 1}: ${line.trim()}`);
        });
      }
    }
  };
  walk(SCRIPTS_DIR);
  assert.deepEqual(hits, [], `run.json parsed whole, without the bound:\n${hits.join('\n')}`);
});

test('writeRunRecord (G-6): a run.json larger than the bound writes no record and says why', async (t) => {
  const b = base(t);
  const repo = path.join(b, 'repo');
  const runId = '20261124-000002-big';
  const dir = path.join(repo, '.claude', 'reviews', runId);
  oversized(dir, runId);
  const { writeRunRecord } = await import('../scripts/io/telemetry-record.mjs');
  const r = writeRunRecord(dir, { recordKind: 'review', repoRoot: repo });
  assert.equal(r.ok, false, 'a record was built from an oversized run.json read whole');
  assert.match(r.note, /larger than/);
  assert.equal(fs.existsSync(path.join(dir, 'telemetry.json')), false);
});

test('declaredReviewers (G-8): a run.json larger than the bound extends nothing', async (t) => {
  const b = base(t);
  const runId = '20261124-000003-big';
  oversized(path.join(b, runId), runId, { contract: { reviewers: { planted: { argv: ['x'] } } } });
  const { declaredReviewers } = await import('../scripts/lib/reviewers.mjs');
  assert.deepEqual(declaredReviewers({ run: confined(path.join(b, runId)) }), {}, 'an oversized record was read whole and its reviewers used');
});

test('readRunRecord (G-9): its bound is readRunJson\'s, the one owner of the run.json bound', async (t) => {
  const b = base(t);
  const runId = '20261124-000004-big';
  oversized(path.join(b, runId), runId);
  const { readRunRecord } = await import('../scripts/io/run-artifacts.mjs');
  let thrown = null;
  try { reviewsRoot.readRunJson(confined(b), [runId, 'run.json']); } catch (e) { thrown = e; }
  const r = readRunRecord(path.join(b, runId));
  assert.equal(r.ok, false);
  assert.ok(r.why.includes(thrown.message), `readRunRecord refuses by its own rule, not readRunJson's: ${r.why}`);
});
