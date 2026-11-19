// run-dir-reads.plan.md stage 3 (design run-dir-reads.design.md, R-D2 A and R-D3 A; operator, 2026-10-29: "Approve"): the
// read helpers took a joined path below the run and, where they checked anything, checked it by REAL path. A link that
// resolves back inside the run therefore passed: the ledger fold read a reconcile payload through one, the evidence gate
// admitted a capture through one, and a lens finding cited evidence through one. What a link resolves to can change, so
// A-30 refuses a link at any level below a run whatever it leads to, and the helpers now read through the owner.
//
// Each case plants a junction (Windows) or a directory symlink (elsewhere) INSIDE the run, pointing elsewhere inside it,
// or out of it where the helper used to follow one. Every one was red before the helpers read through the owner.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readReconcileArtifacts, readNodeStatus, collectRun } from '../scripts/io/run-artifacts.mjs';
import { captureFacts } from '../scripts/io/capture-facts.mjs';
import { evidenceOwnershipError } from '../scripts/io/finding-scope.mjs';
import { evidenceIgnoredByGit } from '../scripts/io/reviews-root.mjs';
import { writePreflightCache, preflightEvidenceDir } from '../scripts/io/preflight-cache.mjs';
import { leftoversOf } from '../scripts/io/reap.mjs';
import { freeEvidenceName } from '../scripts/io/atomic.mjs';
import { confined } from '../scripts/io/confined-path.mjs';

const KIND = process.platform === 'win32' ? 'junction' : 'dir';
function setup(t) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-rdr-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const run = path.join(base, 'run');
  fs.mkdirSync(run);
  fs.writeFileSync(path.join(run, 'run.json'), JSON.stringify({ run_id: '20261029-000000-rdr' }));
  return { base, run };
}
const put = (p, text) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const link = (target, at) => { fs.mkdirSync(path.dirname(at), { recursive: true }); fs.symlinkSync(target, at, KIND); };
const groups = JSON.stringify({ groups: [{ group_id: 'G-1', decision: 'confirmed' }] });

test('the ledger fold refuses a reconcile payload reached through a link that resolves inside the run', (t) => {
  const { run } = setup(t);
  put(path.join(run, 'evidence', 'real', 'payload.json'), groups);
  link(path.join(run, 'evidence', 'real'), path.join(run, 'evidence', 'reconcile'));
  const r = readReconcileArtifacts(run);
  assert.equal(r.payload, null, 'the payload was read through a link');
  assert.match(r.refused['evidence/reconcile/payload.json'] ?? '', /link or junction/);
  assert.doesNotMatch(JSON.stringify(r.refused), new RegExp(run.replace(/[\\]/g, '\\\\')), 'a refusal names no absolute path');
});

// G-11 of 20261030-033642-rdr-remediation-7-review (panel-codex-contract; LOW): the case above calls the helper, so it
// could not fail if the ledger caught the refusal and folded anyway. The fold itself is run here.
test('findings-ledger refuses to fold a run whose reconcile payload is reached through a link, and the ledger is untouched', (t) => {
  const { base } = setup(t);
  const home = path.join(base, 'home');
  const run = path.join(home, 'reviews', 'p', '20261029-000000-rdr');
  put(path.join(run, 'run.json'), JSON.stringify({ run_id: '20261029-000000-rdr', scope: { paths: ['scripts'] } }));
  put(path.join(run, 'finding-groups.json'), JSON.stringify({ run_id: '20261029-000000-rdr', groups: [
    { group_id: 'G-1', file: 'scripts/a.mjs', line: 1, findings: [{ node_id: 'code-audit', severity: 'MEDIUM', claim: 'x' }] }] }));
  put(path.join(run, 'evidence', 'real', 'payload.json'),
    JSON.stringify({ run_id: '20261029-000000-rdr', groups: [{ group_id: 'G-1', decision: 'confirmed', severity: 'MEDIUM' }] }));
  link(path.join(run, 'evidence', 'real'), path.join(run, 'evidence', 'reconcile'));
  const ledgerPath = path.join(base, 'ledger.json');
  const before = JSON.stringify({ schema_version: 1, runs_folded: [], entries: {} });
  fs.writeFileSync(ledgerPath, before);
  const cli = new URL('../scripts/findings-ledger.mjs', import.meta.url);
  const r = spawnSync(process.execPath, [fileURLToPath(cli), '--run-dir', run, '--ledger', ledgerPath, '--repo-root', base],
    { encoding: 'utf8', cwd: base, env: { ...process.env, QUORATE_HOME: home } });
  assert.equal(r.status, 1, `the fold did not stop on the refusal: ${r.stderr}`);
  assert.match(r.stderr, /evidence\/reconcile\/payload\.json refused — .*link or junction/);
  assert.equal(fs.readFileSync(ledgerPath, 'utf8'), before, 'the run was folded through the link');
});

test('a node status reached through a linked nodes/ level is refused, and collectRun scores nothing through it', (t) => {
  const { run } = setup(t);
  put(path.join(run, 'elsewhere', 'lens.status.json'), JSON.stringify({ node_id: 'lens', state: 'OK', findings_count: 0 }));
  link(path.join(run, 'elsewhere'), path.join(run, 'nodes'));
  const s = readNodeStatus(run, 'lens');
  assert.equal(s.ok, false, 'a status was read through a link at nodes/');
  assert.match(s.why, /link or junction/);
  const warned = [];
  const out = collectRun(run, { warn: (m) => warned.push(m) });
  assert.match(out.refused.nodes ?? '', /link or junction/, 'nodes/ reached through a link is refused whole');
});

test('the evidence gate does not admit a capture reached through a link inside evidence/remediation', (t) => {
  const { run } = setup(t);
  const capture = '# admitted: test_one\n# exit: 1\n# timed-out: false\n# captured: 2026-10-29T00:00:00Z\n' + '-'.repeat(72) + '\nnot ok 1\n';
  put(path.join(run, 'evidence', 'remediation', 'real', 'red.log'), capture);
  put(path.join(run, 'evidence', 'remediation', 'direct.log'), capture);
  link(path.join(run, 'evidence', 'remediation', 'real'), path.join(run, 'evidence', 'remediation', 'via'));
  const facts = captureFacts(run, ['evidence/remediation/via/red.log', 'evidence/remediation/direct.log']);
  assert.equal(facts['evidence/remediation/via/red.log'], null, 'a capture was admitted through a link');
  assert.notEqual(facts['evidence/remediation/direct.log'], null, 'the capture standing in the folder itself is read');
});

test('a lens finding cannot cite its evidence through a link inside evidence/<node>/', (t) => {
  const { run } = setup(t);
  put(path.join(run, 'evidence', 'lens', 'real', 'a.log'), 'x');
  link(path.join(run, 'evidence', 'lens', 'real'), path.join(run, 'evidence', 'lens', 'via'));
  assert.match(evidenceOwnershipError(run, 'lens', 'evidence/lens/via/a.log') ?? '', /link or junction/);
  assert.equal(evidenceOwnershipError(run, 'lens', 'evidence/lens/real/a.log'), null);
});

test('the archive asks git about no file reached through a link in evidence/: unknown, so withheld', (t) => {
  const { base, run } = setup(t);
  const archive = path.join(base, 'archive');
  fs.mkdirSync(archive);
  spawnSync('git', ['init', '-q', archive]);
  fs.writeFileSync(path.join(archive, '.gitignore'), '*\n');
  put(path.join(base, 'outside', 'secret.log'), 'x');
  put(path.join(run, 'evidence', 'lens', 'a.log'), 'x');
  link(path.join(base, 'outside'), path.join(run, 'evidence', 'via'));
  assert.equal(evidenceIgnoredByGit(archive, 'rdr', confined(run)), null);
});

test('the pre-flight cache copies nothing out of a run through a link in its evidence', (t) => {
  const { base, run } = setup(t);
  const reviews = path.join(base, 'reviews');
  fs.mkdirSync(reviews);
  put(path.join(base, 'outside', 'secret.log'), 'secret');
  put(path.join(run, 'evidence', 'pre-flight', 'test.log'), 'ok');
  link(path.join(base, 'outside'), path.join(run, 'evidence', 'pre-flight', 'via'));
  const hash = 'c'.repeat(64);
  assert.throws(() => writePreflightCache(reviews, hash, { run_id: 'r', results: [] }, { evidenceFrom: { owner: confined(run), segs: ['evidence', 'pre-flight'] } }),
    (e) => e.code === 'ECONFINED');
  assert.equal(fs.existsSync(path.join(preflightEvidenceDir(reviews, hash), 'via', 'secret.log')), false, 'a file outside the run reached the cache');
});

// G-10 of 20261029-224143-rdr-remediation-3-review (panel-codex-contract): the helper took a raw evidence path and built
// its owner from dirname calls, so its owner was never the admitted run's. It takes the caller's owner, and a raw path
// is refused rather than wrapped.
test('G-10: the pre-flight cache copies evidence only through an owner the caller passes, never a raw path', (t) => {
  const { base, run } = setup(t);
  const reviews = path.join(base, 'reviews');
  fs.mkdirSync(reviews);
  put(path.join(run, 'evidence', 'pre-flight', 'test.log'), 'ok');
  const hash = 'd'.repeat(64);
  assert.throws(() => writePreflightCache(reviews, hash, { run_id: 'r', results: [] }, { evidenceFrom: path.join(run, 'evidence', 'pre-flight') }),
    TypeError, 'a raw evidence path is still accepted, its owner rebuilt from dirname');
  writePreflightCache(reviews, hash, { run_id: 'r', results: [] }, { evidenceFrom: { owner: confined(run), segs: ['evidence', 'pre-flight'] } });
  assert.equal(fs.readFileSync(path.join(preflightEvidenceDir(reviews, hash), 'test.log'), 'utf8'), 'ok');
});

test('the reap polls no pid recorded in a status reached through a link at nodes/', (t) => {
  const { base, run } = setup(t);
  put(path.join(base, 'outside', 'x.status.json'), JSON.stringify({ node_id: 'x', orphan_pid: 424242 }));
  link(path.join(base, 'outside'), path.join(run, 'nodes'));
  assert.throws(() => leftoversOf(new Map(), path.join(run, 'nodes')), (e) => e.code === 'ECONFINED');
});

test('G-2: freeEvidenceName tests each name through the owner, so a link at the folder is refused', (t) => {
  const { base, run } = setup(t);
  fs.mkdirSync(path.join(base, 'outside'));
  link(path.join(base, 'outside'), path.join(run, 'evidence'));
  const owner = confined(run);
  assert.throws(() => freeEvidenceName({ owner, segments: ['evidence', 'lens'] }, 'raw', '.log'), (e) => e.code === 'ECONFINED');
  fs.rmSync(path.join(run, 'evidence'));
  owner.dir(['evidence', 'lens']);
  owner.create(['evidence', 'lens', 'raw.log'], 'x');
  assert.equal(path.basename(freeEvidenceName({ owner, segments: ['evidence', 'lens'] }, 'raw', '.log')), 'raw.2.log');
});

// G-10 of 20261029-190658-rdr-delivery (panel-codex-contract): the owner form was optional; a raw folder was still taken
// and tested by an lstat of a joined path. Only an owner and the names below it are accepted.
test('G-10: freeEvidenceName refuses a raw folder, so a name is chosen only through an owner', (t) => {
  const { run } = setup(t);
  assert.throws(() => freeEvidenceName(run, 'raw', '.log'), TypeError);
  assert.throws(() => freeEvidenceName(path.join(run, 'evidence'), 'raw', '.log', () => false), TypeError);
});
