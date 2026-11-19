// Remediation 20261029-062951-rdd-remediation-2 of review 20261029-055946-rdd-remediation-review: the run-descendant
// confinement's remaining gaps, each held here by the defect it exists to prevent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { confined } from '../scripts/io/confined-path.mjs';

const KIND = process.platform === 'win32' ? 'junction' : 'dir';

// G-23: spawn-node checked the policy path through the owner only when its directory was string-equal to the run, so on
// a case-insensitive filesystem a differently cased spelling skipped the check and a linked policy reached the node.
test('G-23: a differently cased spelling of the run\'s policy path is still checked, and a link there refused',
  { skip: process.platform !== 'win32' && 'needs a case-insensitive filesystem' }, async () => {
    const { repoRunDir, runScript, REPO_ROOT } = await import('./helpers.mjs');
    // A panel node, whose --settings is not pinned to one spelling as intent's and remediate's are: the owner's check
    // is the only one between the path and the runtime.
    const { dir } = repoRunDir({ prefix: 'quorate-rdd2-policy-' });
    const elsewhere = path.join(dir, 'elsewhere');
    fs.mkdirSync(elsewhere);
    fs.symlinkSync(elsewhere, path.join(dir, 'node-settings.json'), 'junction');
    const recased = path.join(dir.toUpperCase(), 'node-settings.json');
    assert.notEqual(path.dirname(recased), dir, 'the fixture must spell the run differently');
    const r = runScript('spawn-node.mjs', [
      '--print-cmd', '--run-dir', dir, '--repo-root', REPO_ROOT, '--node-id', 'second-opinion', '--mode', 'panel',
      '--schema-variant', 'none', '--skill-command', '/second-opinion', '--settings', recased,
    ]);
    assert.notEqual(r.status, 0, `spawn-node accepted a linked policy path spelled in another case: ${r.output.slice(-400)}`);
    assert.match(r.output, /link or junction/);
  });

// G-16: the CHAIN-BROKEN scan read every sibling directory's run.json with readRun before admitting it, so a counterfeit
// directory under a scanned root supplied the fields that decide the chain. A source check, because the scan sits behind
// a full remediation mint no fixture here reaches: each sibling is admitted, and only the admitted directory is read.
test('G-16: the CHAIN-BROKEN scan admits each sibling run before reading it', () => {
  const s = fs.readFileSync(new URL('../scripts/remediate.mjs', import.meta.url), 'utf8');
  const from = s.indexOf('// CHAIN-BROKEN:');
  // Ends where the census is reported: the sort it ended at went with G-12 of 20261105-173030-crsf-d1-remediation-review.
  const end = s.indexOf('if (censusUnread.length)', from);
  const block = s.slice(from, end);
  assert.ok(from > 0 && end > from && block.length > 0, 'the CHAIN-BROKEN scan was not found');
  assert.doesNotMatch(block, /readRun\(\s*path\.join\(/, 'a sibling directory is read before it is admitted');
  assert.match(block, /admit\(\s*path\.join\(\s*root\s*,\s*e\.name\s*\)\s*\)/, 'each sibling is admitted');
});

// G-2: contractConsent resolved the caller's --run-dir again after admission rather than naming the admitted directory.
test('G-2: contractConsent names the admitted run directory, not the caller\'s spelling', () => {
  const s = fs.readFileSync(new URL('../scripts/external-review.mjs', import.meta.url), 'utf8');
  const from = s.indexOf('if (args.runDir) {', s.indexOf('THE ADMITTED RECORD, never a reread'));
  const block = s.slice(from, s.indexOf('const r = liveContract();', from));
  assert.ok(from > 0 && block.length > 0, 'the consent block was not found');
  assert.doesNotMatch(block, /path\.resolve\(\s*args\.runDir\s*\)/, 'the caller\'s spelling is resolved again after admission');
  assert.match(block, /admittedRunDir/);
});

// G-5: restorePreflightEvidence refused a link below the cache entry but tested the entry root itself with existsSync and
// read through it, so a link or junction at <hash>.evidence installed its target's files in the run.
test('G-5: a link at the cached evidence entry\'s own root is refused and nothing is copied', async (t) => {
  const { restorePreflightEvidence } = await import('../scripts/io/preflight-cache.mjs');
  const { preflightEvidenceDir } = await import('../scripts/lib/preflight-cache.mjs');
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-rdd2-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const run = path.join(base, 'run');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(run);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'secret.log'), 'not the cache\'s\n');
  const reviews = path.join(base, 'reviews');
  const src = preflightEvidenceDir(reviews, 'b'.repeat(64));
  fs.mkdirSync(path.dirname(src), { recursive: true });
  fs.symlinkSync(outside, src, KIND);
  assert.throws(() => restorePreflightEvidence(reviews, 'b'.repeat(64), confined(run)), (e) => e.code === 'ECONFINED' && /link or junction/.test(e.message));
  assert.equal(fs.existsSync(path.join(run, 'evidence', 'pre-flight', 'secret.log')), false, 'the link\'s target was copied into the run');
});
