// THE REMEDIATION RUNNER'S run.json IS REDACTED (G-23 of 20261121-204740-m3s7-b1-remediation-review; I-8 of
// .claude/requests/m3-stage7-fixes.md): saveRun wrote the merged run record with a bare JSON.stringify, so model prose in
// its commit_check entries, which can quote a credential, reached run.json verbatim, and run.json is archived into
// .claude/reviews and tracked. It is written through the redaction owner, as run-graph's tracked writes are.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// THE PATCH, NOT THE WHOLE RECORD (G-9 of 20261121-214741-m3s7-b1-remediation-2-review): redacting the merged record
// rewrote machine fields new-run wrote, such as repo_root, whenever a path segment was credential-shaped. So the patch
// saveRun is given goes through redactTree, and what loadRun read back is spread in as it was. Updated by hand on the
// operator's word ("I update the 2 tests, then retry (Recommended)"): this test pinned the whole-record form, G-9's defect.
// THROUGH patchRunJson since G-11 of 20261124-180917-gsw-remediation-4-review-b: saveRun hands redactTree to the owner as
// the patch's transform, and the owner applies it to the patch alone, which is exercised below rather than read.
test('remediate.mjs redacts the patch saveRun writes into run.json, not the record it read back', async (t) => {
  const src = fs.readFileSync(new URL('../scripts/remediate.mjs', import.meta.url), 'utf8');
  const at = src.indexOf('const saveRun = ');
  assert.ok(at >= 0, 'saveRun is gone');
  const body = src.slice(at, at + 600);
  assert.match(body, /=> patchRunJson\([^,]+,\s*patch,\s*\{\s*transform: \(p\) => redactTree\(\{ \.\.\.p\b/,
    'the patch must go through redactTree, as patchRunJson\'s transform');
  assert.match(src, /^import \{[^}]*\bredactTree\b[^}]*\} from '\.\/lib\/redact\.mjs';$/m, 'redactTree is not imported from the owner');
  const { patchRunJson } = await import('../scripts/lib/reviews-root.mjs');
  const { confined } = await import('../scripts/io/confined-path.mjs');
  const os = await import('node:os');
  const path = await import('node:path');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'saverun-redacted-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'run.json'), JSON.stringify({ run_id: 'r', repo_root: '/kept/as/written' }));
  patchRunJson(confined(root), { why: 'secret' }, { transform: (p) => ({ ...p, why: '[REDACTED]' }) });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'run.json'), 'utf8')),
    { run_id: 'r', repo_root: '/kept/as/written', why: '[REDACTED]' }, 'the transform reached the record read back: G-9');
});

test('G-9: redacting a record whose repo_root has a credential-shaped segment changes that machine field', async () => {
  // Why the record new-run wrote is not redacted again: redactTree rewrites such a path, so a run would record a
  // repository root that is not its own. Shown on the owner itself, with a key shape redaction is built to mask.
  const { redactTree } = await import('../scripts/lib/redact.mjs');
  const root = `/home/ci/sk-ant-api03-${'A'.repeat(40)}/repo`;
  assert.notEqual(redactTree({ repo_root: root }).repo_root, root,
    'redactTree leaves this root alone, so the reason for redacting only the patch needs re-checking');
});

test('redactTree, the owner saveRun uses, redacts a secret quoted in a nested commit_check entry', async () => {
  const { redactTree } = await import('../scripts/lib/redact.mjs');
  const key = ['ghp', '_', 'A'.repeat(36)].join('');
  const out = JSON.stringify(redactTree({ commit_check: [{ cluster: 'c1', why: `hook printed ${key}` }] }));
  assert.ok(!out.includes(key), `the token survived: ${out}`);
});
