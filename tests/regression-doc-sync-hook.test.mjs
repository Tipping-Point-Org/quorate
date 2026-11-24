// G-2 (G-1 its symptom), G-4, G-5 and G-6 of 20261122-232627-m3s7-b4-review: the doc-sync pre-commit hook.
//   G-2: findNewRun fell back to the REVIEWED repository's scripts/new-run.mjs and imported its io/contract-reader.mjs, so
//        a consumer's module ran in the operator's pre-commit hook. The reader is the framework's own, beside the hook.
//   G-4: a missing reader fell through to "no contract" with nothing said.
//   G-5: a `## §2` heading gave no number, and an unreadable target skipped its references, both silently.
//   G-6: the cross-reference scan read the working tree, not the bytes the commit holds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from './helpers.mjs';

const HOOK = path.join(REPO_ROOT, '.claude', 'hooks', 'doc-sync-check.mjs');
const git = (cwd, ...a) => {
  const r = spawnSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false', ...a], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
};
function repo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-doc-sync-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, 'init', '-q');
  return dir;
}
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const runHook = (hook, cwd) => spawnSync(process.execPath, [hook], { cwd, encoding: 'utf8', env: { ...process.env, GRAPH_NODE_DEPTH: undefined } });

test('G-2/G-4: the hook never imports the reviewed repository\'s contract reader, and says when its own is missing', (t) => {
  // A framework copy whose scripts/ lacks new-run.mjs and the reader, so the old search went on to the repository's.
  const fw = repo(t);
  fs.cpSync(path.join(REPO_ROOT, 'scripts'), path.join(fw, 'scripts'), { recursive: true });
  fs.rmSync(path.join(fw, 'scripts', 'new-run.mjs'));
  fs.rmSync(path.join(fw, 'scripts', 'io', 'contract-reader.mjs'));
  write(fw, '.claude/hooks/doc-sync-check.mjs', fs.readFileSync(HOOK, 'utf8'));
  const r = repo(t);
  const marker = path.join(r, 'IMPORTED');
  write(r, 'scripts/new-run.mjs', '');
  write(r, 'scripts/io/contract-reader.mjs',
    `import fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(marker)}, 'x');\nexport function readContract() { return { contract: {} }; }\n`);
  write(r, 'a.md', 'x\n');
  git(r, 'add', 'a.md');
  const out = runHook(path.join(fw, '.claude', 'hooks', 'doc-sync-check.mjs'), r);
  assert.equal(out.status, 0, out.stderr);
  assert.equal(fs.existsSync(marker), false, 'the hook imported the reviewed repository\'s io/contract-reader.mjs');
  assert.match(out.stderr, /contract reader/, `a missing reader fell through with nothing said:\n${out.stderr}`);
});

test('G-5/G-6: references are checked in the staged bytes, a `## §N` heading counts, an unreadable target is named', (t) => {
  const r = repo(t);
  write(r, 'CLAUDE.md', '# x\n\n```yaml\ngraph_contract_version: 6\nproject: fx\ndoc_paths: ["docs/**"]\nsource_globs: ["src/**"]\n'
    + 'doc_roles:\n  architecture: "docs/arch.md"\n```\n');
  write(r, 'docs/arch.md', '# Arch\n\n## §2 Two\n');
  write(r, 'docs/a.md', '# A\n\n## 1 One\n\nsee §1 and arch §2 and arch §3\n');
  git(r, 'add', '.');
  // After staging, the working tree breaks a reference the commit does not hold.
  write(r, 'docs/a.md', '# A\n\n## 1 One\n\nsee §7 and arch §2 and arch §3\n');
  const out = runHook(HOOK, r);
  assert.equal(out.status, 0, out.stderr);
  assert.doesNotMatch(out.stderr, /section 7/, `the scan read the working tree, not the index:\n${out.stderr}`);
  assert.doesNotMatch(out.stderr, /section 2 -> docs\/arch\.md has no such section/, `a "## §2" heading was not counted:\n${out.stderr}`);
  // G-20 of 20261123-003125-m3s7-b4-remediation-review-b: the line above alone passes when no heading parses at all, since
  // an empty heading set skips the comparison. A reference to a section the target lacks must be named, which happens only
  // when its `## §2` heading was read as a number.
  assert.match(out.stderr, /section 3 -> docs\/arch\.md has no such section/, `the "## §2" heading set was empty, so nothing was compared:\n${out.stderr}`);
  // A target role the index does not hold cannot be checked, and the hook says so.
  write(r, 'CLAUDE.md', fs.readFileSync(path.join(r, 'CLAUDE.md'), 'utf8').replace('docs/arch.md', 'docs/gone.md'));
  git(r, 'add', 'CLAUDE.md');
  const gone = runHook(HOOK, r);
  assert.match(gone.stderr, /could not read docs\/gone\.md/, `an unreadable target was skipped silently:\n${gone.stderr}`);
});

// G-1 of 20261123-003125-m3s7-b4-remediation-review-b: the framework beside the hook was trusted by location alone. A reader
// standing at ../../scripts/io in a directory that is not a quorate checkout (no .claude-plugin/plugin.json) is not imported.
test('G-1: a reader beside the hook in a directory that is not the engine is never imported', (t) => {
  const fw = repo(t);
  const marker = path.join(fw, 'IMPORTED');
  write(fw, 'scripts/io/contract-reader.mjs',
    `import fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(marker)}, 'x');\nexport function readContract() { return { contract: {} }; }\n`);
  write(fw, '.claude/hooks/doc-sync-check.mjs', fs.readFileSync(HOOK, 'utf8'));
  fs.cpSync(path.join(REPO_ROOT, 'scripts', 'lib'), path.join(fw, 'scripts', 'lib'), { recursive: true });
  const r = repo(t);
  write(r, 'a.md', 'x\n');
  git(r, 'add', 'a.md');
  const out = runHook(path.join(fw, '.claude', 'hooks', 'doc-sync-check.mjs'), r);
  assert.equal(out.status, 0, out.stderr);
  assert.equal(fs.existsSync(marker), false, 'a reader in a directory with no plugin manifest was imported');
  assert.match(out.stderr, /not a quorate checkout/);
});
