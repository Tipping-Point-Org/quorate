// Regression tests for the set-aside write-back (remediation 20261107-201824-co-remediation-3, remediating
// 20261107-195640-co-remediation-2-review). Each test names the group it exists for.
//
// G-8 (G-6 its symptom): the write-back restored a file through confined(repo).replace, which writes a fresh temporary
// file and renames it, so the original POSIX mode was lost and an executable came back without its exec bit.
// G-7: writeBackSetAside read run.json's set_aside itself, a second reader beside lib's setAsideRecovery that knew only
// the array shape, so a 85f45c55-shaped record's written_sha256 was ignored.
// G-10: stopOnUnrecorded ends in die(), whose process.exit skips the pending finally { finishSetAside(); }, so the
// set-aside files were not written back on that refusal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { confined } from '../scripts/lib/confined-path.mjs';
import * as chain from '../scripts/lib/remediation-chain.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const remediateSrc = () => fs.readFileSync(path.join(here, '..', 'scripts', 'remediate.mjs'), 'utf8');
// THE SET-ASIDE MOVED to scripts/io/set-aside.mjs (runner-test-seam.plan.md stage 1): what the runner must not restate, the
// module must not either.
const setAsideSrc = () => fs.readFileSync(path.join(here, '..', 'scripts', 'io', 'set-aside.mjs'), 'utf8');

test('G-8: confined replace sets the mode it is given on the file before the rename, so an exec bit survives', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'q-replace-mode-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const chmods = [];
  const renames = [];
  const wrapped = new Proxy(fs, { get(target, prop) {
    if (prop === 'chmodSync') return (p, m) => { chmods.push({ p, m, renamed: renames.length > 0 }); return fs.chmodSync(p, m); };
    if (prop === 'renameSync') return (a, b) => { renames.push([a, b]); return fs.renameSync(a, b); };
    const v = target[prop];
    return typeof v === 'function' ? v.bind(target) : v;
  } });
  const owner = confined({ root, io: { fs: wrapped } });
  fs.writeFileSync(path.join(root, 'run.sh'), 'old\n');
  const abs = owner.replace(['run.sh'], 'new\n', { mode: 0o755 });
  assert.equal(fs.readFileSync(abs, 'utf8'), 'new\n');
  assert.equal(chmods.length, 1, 'the mode it was given is set exactly once');
  assert.equal(chmods[0].m, 0o755);
  assert.equal(chmods[0].renamed, false, 'set on the temporary file, before the rename, so the target never holds the default mode');
  if (process.platform !== 'win32') assert.equal(fs.statSync(abs).mode & 0o777, 0o755);
  // Without a mode, nothing is changed, as before.
  owner.replace(['other.txt'], 'x\n');
  assert.equal(chmods.length, 1);
});

test('G-8: the host platform\'s fs offers chmodSync, so the bound owner can set the mode it is given', async () => {
  const { hostPlatform } = await import('../scripts/platform/index.mjs');
  const { FS_MEMBERS } = await import('../scripts/platform/interface.mjs');
  assert.equal(typeof hostPlatform().fs.chmodSync, 'function');
  assert.ok(FS_MEMBERS.includes('chmodSync'), 'the interface names it');
});

// "G-8: the set-aside records each file's mode and the write-back hands it to replace" matched scripts/io/set-aside.mjs's
// source. REPLACED (runner-test-seam.plan.md stage 4) by tests/regression-set-aside-behaviour.test.mjs "G-8 of
// 20261107-195640-co-remediation-2-review: each entry records its file's mode, and the write-back hands that mode to replace".

test('G-7: the written bytes of a failed write-back are read through lib\'s one set-aside reader, in both record shapes', () => {
  assert.equal(typeof chain.setAsideWrittenBytes, 'function', 'lib owns reading written_sha256 beside setAsideRecovery');
  const dir = 'evidence/remediation-runner/set-aside-1';
  const cur = chain.setAsideWrittenBytes({ set_aside_dir: dir, set_aside: [{ path: 'a', restored: false, written_sha256: 'h1' }, { path: 'b', restored: true }] });
  assert.deepEqual([...cur], [['a', 'h1']]);
  const legacy = chain.setAsideWrittenBytes({ set_aside: { dir, entries: [{ path: 'a', restored: false, written_sha256: 'h2' }] } });
  assert.deepEqual([...legacy], [['a', 'h2']], 'the 85f45c55 record is read as setAsideRecovery reads it');
  assert.deepEqual([...chain.setAsideWrittenBytes({})], []);
  assert.doesNotMatch(remediateSrc(), /readRun\(runDir\)\.set_aside\b/, 'remediate.mjs no longer decodes the set-aside record itself');
  // The module's half is run (runner-test-seam.plan.md stage 4): tests/regression-set-aside-behaviour.test.mjs "G-7 of
  // 20261107-195640-co-remediation-2-review: a failed write-back left in the older record shape is still overwritten".
});

test('G-11: the remediation stamps are named once, in lib, and remediate.mjs spells neither', () => {
  assert.equal(chain.COMMIT_CHECK_STAMP, 'COMMIT-CHECK');
  assert.equal(chain.REPORT_CHECK_STAMP, 'REPORT-CHECK');
  for (const [name, src] of [['remediate.mjs', remediateSrc()], ['io/set-aside.mjs', setAsideSrc()]]) {
    assert.doesNotMatch(src, /['"`]COMMIT-CHECK['"`]/, `${name} spells the COMMIT-CHECK stamp itself`);
    assert.doesNotMatch(src, /['"`]REPORT-CHECK['"`]/, `${name} spells the REPORT-CHECK stamp itself`);
  }
});

test('G-5: whether git diff --raw reports a mode change is a pure decision in lib, not a regex in remediate.mjs', () => {
  assert.equal(typeof chain.rawDiffModeChanged, 'function');
  assert.equal(chain.rawDiffModeChanged(''), false, 'no diff, no mode change');
  assert.equal(chain.rawDiffModeChanged(':100644 100644 aaaaaaa bbbbbbb M\tf.txt\n'), false, 'content only');
  assert.equal(chain.rawDiffModeChanged(':100644 100755 aaaaaaa aaaaaaa M\tf.sh\n'), true, 'a chmod');
  assert.doesNotMatch(remediateSrc(), /match\(\/\^:\(\\d\+\) \(\\d\+\) \/m\)/, 'remediate.mjs parses the raw diff itself');
  assert.doesNotMatch(setAsideSrc(), /match\(\/\^:\(\\d\+\) \(\\d\+\) \/m\)/, 'scripts/io/set-aside.mjs parses the raw diff itself');
});

test('G-10: die() writes back a pending set-aside before process.exit, so a refusal that dies does not skip it', () => {
  const src = remediateSrc();
  const die = src.match(/^const die = [^\n]*$/m);
  assert.ok(die, 'die is one line');
  assert.match(die[0], /beforeExit|atDie/, 'die runs the registered write-backs before it exits');
  assert.match(src, /atDie\.push\(/, 'the set-aside finisher registers itself to run on die');
});
