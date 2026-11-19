// THE SET-ASIDE IS A MODULE A TEST CAN RUN (runner-test-seam.plan.md stage 1, design RT-D1 A, RT-D2 B). Its functions were
// private to the 2,083-line runner, so every review of set-aside-identity found a property held only by a source read or by
// one more argv seam. They now live in scripts/io/set-aside.mjs, take their capabilities as one argument, refuse with a
// SetAsideError where they died, and publish on diagnostics channels. The defects these tests prevent: a moved function
// declared again in the runner (two copies that drift); a guard's refusal inside the put-back buried in the put-back's own
// message by its catch; and the order of the two messages when the put-back and then the write-back both fail.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import diagnosticsChannel from 'node:diagnostics_channel';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT } from './helpers.mjs';
import { confined } from '../scripts/io/confined-path.mjs';
import { setAsideCapabilities, setAsideRefused, SetAsideError, SET_ASIDE_CHANNELS } from '../scripts/io/set-aside.mjs';
import { runRem, readRem, remAt, checkedFixture } from './remediate-runner-fixture.mjs';

// ------------------------------------------------------------------------------------------- the declaration census
// The set the plan moves (runner-test-seam.plan.md stage 1, "What moves, and what stays"): the markers' content at
// 5fd6dc53 less const tree, setAsideFinisher, writeBackFailure and editKeepingStat. editKeepingStat served the
// --test-edit-after-classify seam and went with it (stage 2), so it is declared in neither file; withoutBytes and
// stateWithoutBytes went in stage 3, since no state holds bytes there. atHead went to lib as setAsideAtHead, a rule over values
// already read (G-2 of 20261108-222629-rts-delivery).
const MOVED = ['treeSegs', 'pathStat', 'pathState', 'headFacts', 'kindsOfPaths',
  'setAsideRefused', 'copyOneAside', 'writeBackSetAside', 'writeCopyBack'];
const STAYS = ['setAsideFinisher', 'writeBackFailure'];
const GONE = ['editKeepingStat', 'withoutBytes', 'stateWithoutBytes', 'atHead'];
const read = (...p) => fs.readFileSync(path.join(REPO_ROOT, ...p), 'utf8');
const declares = (text, name) => new RegExp(`^(?:export )?(?:(?:async )?function\\*? ${name}\\(|(?:const|let|var) ${name}\\b)`, 'm').test(text);
const declarationCensus = (runner, module) => {
  const out = [];
  for (const fn of MOVED) {
    if (declares(runner, fn)) out.push(`scripts/remediate.mjs declares ${fn}, which lives in scripts/io/set-aside.mjs`);
    if (!declares(module, fn)) out.push(`scripts/io/set-aside.mjs does not declare ${fn}`);
  }
  for (const fn of STAYS) {
    if (!declares(runner, fn)) out.push(`scripts/remediate.mjs does not declare ${fn}, which stays with the runner`);
    if (declares(module, fn)) out.push(`scripts/io/set-aside.mjs declares ${fn}, which is the runner's`);
  }
  for (const fn of GONE) {
    if (declares(runner, fn) || declares(module, fn)) out.push(`${fn} is declared again: stage 2 or 3 removed it`);
  }
  return out;
};

test('census: scripts/remediate.mjs declares none of the moved set-aside functions, and scripts/io/set-aside.mjs declares each', () => {
  assert.deepEqual(declarationCensus(read('scripts', 'remediate.mjs'), read('scripts', 'io', 'set-aside.mjs')), []);
});

test('census: a moved function declared again in the runner, or one dropped from the module, is refused', () => {
  const runner = read('scripts', 'remediate.mjs');
  const module = read('scripts', 'io', 'set-aside.mjs');
  assert.match(declarationCensus(`${runner}\nfunction pathState(p) { return p; }\n`, module).join('\n'), /remediate\.mjs declares pathState/);
  assert.match(declarationCensus(`${runner}\nconst treeSegs = (p) => p;\n`, module).join('\n'), /remediate\.mjs declares treeSegs/);
  assert.match(declarationCensus(runner, `${module}\nconst withoutBytes = (s) => s;\n`).join('\n'), /withoutBytes is declared again/);
  assert.match(declarationCensus(runner, module.replace('\nfunction kindsOfPaths(', '\nfunction kindsOfPathsElsewhere(')).join('\n'), /set-aside\.mjs does not declare kindsOfPaths/);
});

test('the module reads no process, argv, clock or environment, and starts no process itself', () => {
  const code = read('scripts', 'io', 'set-aside.mjs').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.doesNotMatch(code, /\bprocess\./, 'it reads process');
  assert.doesNotMatch(code, /\bargs\./, 'it reads the runner\'s argv');
  assert.doesNotMatch(code, /Date\.now\(\)|new Date\(/, 'it reads the clock');
  assert.doesNotMatch(code, /node:child_process|node:fs['"]|node:os['"]|\/git\.mjs['"]/, 'it can spawn or touch the disk itself');
  assert.doesNotMatch(code, /\bconsole\./, 'it prints other than through log');
});

// ------------------------------------------------------------------------------------- the module, run on a real repo
function moduleFixture(t, { failCheckout = null, throwRemove = null } = {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-set-aside-module-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repo = path.join(base, 'repo');
  const runDir = path.join(base, 'run');
  fs.mkdirSync(path.join(repo, 'tests'), { recursive: true });
  fs.mkdirSync(runDir);
  const g = (...a) => spawnSync('git', ['-c', 'user.email=x@x', '-c', 'user.name=x', '-c', 'core.autocrlf=false', ...a], { cwd: repo, encoding: 'utf8' });
  g('init', '-q');
  g('config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(repo, 'tests', 'b.js'), 'committed\n');
  g('add', '.');
  g('commit', '-qm', 'base');
  fs.writeFileSync(path.join(repo, 'tests', 'b.js'), 'b, from the node\n');      // modified: put back by checkout
  fs.writeFileSync(path.join(repo, 'tests', 'c.js'), 'c, from the node\n');      // new: put back by removal
  const tree = confined(repo);
  const record = {};
  const lines = [];
  const caps = setAsideCapabilities({
    tree: throwRemove ? { ...tree, remove(segs, ...rest) {
      if (segs.join('/') === throwRemove) throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
      return tree.remove(segs, ...rest);
    } } : tree,
    owner: confined(runDir),
    git: (argv, { input } = {}) => {
      if (failCheckout && argv[0] === 'checkout') return { status: 1, stdout: '', stderr: `${failCheckout}\n` };
      return spawnSync('git', argv, { cwd: repo, encoding: 'utf8', ...(input === undefined ? {} : { input }) });
    },
    run: { dir: runDir, read: () => ({ ...record }), save: (fields) => Object.assign(record, fields) },
    firstFree: (taken) => { for (let n = 1; n <= 100; n += 1) if (!taken(n)) return n; throw new Error('no free number'); },
    log: (line) => lines.push(line),
  });
  const clusters = [{ id: 'c1', committable: true, accepted: ['src/x.js'] }, { id: 'c2', committable: false, accepted: ['tests/b.js', 'tests/c.js'] }];
  return { repo, runDir, caps, clusters, record, lines };
}
const thrown = (fn) => { try { fn(); } catch (err) { return err; } return null; };

test('a guard\'s refusal inside the put-back passes its catch unchanged: a SetAsideError, its own message, not wrapped', (t) => {
  const f = moduleFixture(t, { failCheckout: 'refused by the test' });
  const holder = {};
  const err = thrown(() => setAsideRefused(f.caps, f.clusters, holder));
  assert.ok(err instanceof SetAsideError, `not a SetAsideError: ${err?.stack ?? err}`);
  assert.equal(err.message, 'could not put tests/b.js back to HEAD for the full check (refused by the test); its bytes are kept under '
    + 'evidence/remediation-runner/set-aside-1 and the next run of this command writes them back');
  assert.doesNotMatch(err.message, /full check \(could not put/, 'the guard\'s refusal was wrapped in the put-back\'s message');
  assert.ok(holder.record, 'the record was not handed to the finisher before the put-back');
});

test('a throw that is not a refusal, during the put-back, becomes one SetAsideError naming the path and the code', (t) => {
  const f = moduleFixture(t, { throwRemove: 'tests/c.js' });
  const err = thrown(() => setAsideRefused(f.caps, f.clusters, {}));
  assert.ok(err instanceof SetAsideError, `not a SetAsideError: ${err?.stack ?? err}`);
  assert.equal(err.message, 'could not put tests/c.js back to HEAD for the full check (EBUSY); its bytes are kept under '
    + 'evidence/remediation-runner/set-aside-1 and the next run of this command writes them back');
});

test('the channels: `classified` once, before the first copy, naming the files set aside; every git call on `git`', (t) => {
  const f = moduleFixture(t);
  const seen = [];
  const on = (k) => (m) => seen.push([k, m]);
  const subs = [['classified', on('classified')], ['copy', on('copy')], ['git', on('git')]];
  for (const [k, fn] of subs) diagnosticsChannel.subscribe(SET_ASIDE_CHANNELS[k], fn);
  t.after(() => { for (const [k, fn] of subs) diagnosticsChannel.unsubscribe(SET_ASIDE_CHANNELS[k], fn); });
  const r = setAsideRefused(f.caps, f.clusters, {});
  assert.deepEqual(r.record.entries.map((e) => [e.path, e.kind]), [['tests/b.js', 'modified'], ['tests/c.js', 'new']]);
  const kinds = seen.map(([k]) => k);
  assert.equal(kinds.filter((k) => k === 'classified').length, 1, 'classified was not published once');
  assert.ok(kinds.indexOf('classified') < kinds.indexOf('copy'), 'classified came after a copy');
  const classified = seen.find(([k]) => k === 'classified')[1];
  assert.deepEqual(classified.files, ['tests/b.js', 'tests/c.js']);
  assert.ok(classified.states.get('tests/b.js').worktree_blob, 'classified came before the batched hash-object filled the worktree blob');
  const gitArgs = seen.filter(([k]) => k === 'git').map(([, m]) => m.args[0]);
  assert.deepEqual(gitArgs.slice(0, 2), ['ls-tree', 'hash-object'], `classification's git calls: ${gitArgs.join(', ')}`);
  assert.ok(gitArgs.includes('checkout'), 'the put-back\'s checkout was not published');
  assert.equal(fs.readFileSync(path.join(f.repo, 'tests', 'b.js'), 'utf8'), 'committed\n', 'the modified file was not put back to HEAD');
  assert.ok(!fs.existsSync(path.join(f.repo, 'tests', 'c.js')), 'the new file was not removed');
});

// ------------------------------------------------------------------------- the double failure, through the whole runner
const PROBE = path.join(REPO_ROOT, 'tests', 'tools', 'remediate-fs-probe.mjs');
const twoGroups = (f) => fs.writeFileSync(path.join(f.reviewed, 'evidence', 'reconcile', 'payload.json'), JSON.stringify({ groups: [
  { group_id: 'G-1', decision: 'confirmed', severity: 'MEDIUM' }, { group_id: 'G-2', decision: 'confirmed', severity: 'MEDIUM' }] }));

test('the put-back fails, then the write-back fails too: both messages print, the set-aside\'s reason first, and the bytes stay in their copy', (t) => {
  const f = checkedFixture(t, { test: 'node check.cjs' });
  twoGroups(f);
  const r = runRem(f, ['--test-fail-write-back'], { NODE_OPTIONS: `--import=${pathToFileURL(PROBE).href}`, PROBE_THROW_RM: 'tests/c.test.js',
    FAKE_WRITE: JSON.stringify({ 'tests/b.test.js': 'b, from the node\n', 'tests/c.test.js': 'c, from the node\n' }),
    FAKE_SECOND_FILES: JSON.stringify(['tests/b.test.js', 'tests/c.test.js']) });
  assert.equal(r.status, 2, r.output.slice(-1200));
  const reason = r.output.indexOf('remediate: could not put tests/c.test.js back to HEAD for the full check (EBUSY)');
  const writeBack = r.output.indexOf('remediate: could not write back tests/b.test.js (ETEST), set aside for the full check');
  assert.ok(reason >= 0, `the set-aside's reason was not printed:\n${r.output.slice(-1200)}`);
  assert.ok(writeBack >= 0, `the write-back's failure was not printed:\n${r.output.slice(-1200)}`);
  assert.ok(reason < writeBack, `the write-back's failure came before the reason:\n${r.output.slice(-1200)}`);
  assert.match(r.output, /--retry-commits/, 'the restoring command was not printed');
  assert.doesNotMatch(r.output, /^\s+at .*(remediate|set-aside)\.mjs/m, 'the operator got a stack');
  const rem = readRem(f);
  assert.ok((rem.commit_check ?? []).some((e) => e.kind === 'set-aside-unrestored'), 'set-aside-unrestored was not recorded');
  assert.deepEqual(rem.set_aside.map((e) => [e.path, e.restored]), [['tests/b.test.js', false], ['tests/c.test.js', true]]);
  const files = path.join(remAt(f), ...rem.set_aside_dir.split('/'), 'files');
  assert.equal(fs.readFileSync(path.join(files, '1'), 'utf8'), 'b, from the node\n', 'the bytes not written back are not kept in their copy');
});
