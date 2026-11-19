// Remediation of review 20261001-022902-contract-glob-grammar-review (operator's answers: "Fix all six (Recommended)",
// "Ledger, but fix G-15 (Recommended)"): G-4, G-16, G-27, G-12, G-22, G-1 and G-15.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as cg from '../scripts/lib/contract-glob.mjs';
import { CONTRACT_VERSION } from '../scripts/lib/contract-version.mjs';
import { worktreeSha } from '../scripts/io/worktree.mjs';
import { REPO_ROOT } from './helpers.mjs';

const read = (...p) => fs.readFileSync(path.join(REPO_ROOT, ...p), 'utf8');
const tmp = (t) => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-cggr-'))); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };

// G-27: the plan's case table — every form through EVERY function, and parseGlob directly. Each accepted form must parse,
// validate, root, prefix and match consistently; each refused form must be refused by all of them alike.
const ACCEPTED = {
  // glob: [walkRoot base, coverPrefix, a path it matches, a path it does not]
  'docs/**': ['docs', 'docs', 'docs/a/b.md', 'other/a.md'],
  'docs/*.md': ['docs', 'docs', 'docs/a.md', 'docs/s/a.md'],
  'docs/README*': ['docs', 'docs/README', 'docs/README.md', 'docs/x/README.md'],
  '**/*.test.*': ['', '', 'lib/a.test.js', 'lib/a.js'],
  '**/**': ['', '', 'a', null],                                  // G-15: `**/**` matched nothing
  'x/**/**': ['x', 'x', 'x/a', 'y/a'],
  'README.md': ['README.md', 'README.md', 'README.md', 'docs/README.md'],
  'docs': ['docs', 'docs', 'docs/s/b.md', 'docsx/a.md'],
};
const REFUSED = ['docs/?.md', 'docs/[ab].md', 'docs/{a,b}.md', '../x/**', '/abs/**', '', '!docs/**', 'a**b'];

test('G-27: every accepted form goes through every function, consistently', () => {
  for (const [g, [root, prefix, yes, no]] of Object.entries(ACCEPTED)) {
    const p = cg.parseGlob(g);
    assert.equal(p.ok, true, `parseGlob refused ${g}: ${p.why}`);
    assert.equal(cg.validateGlob(g), null, `validateGlob refused ${g}`);
    assert.equal(cg.walkRoot(g).base, root, `walkRoot(${g})`);
    assert.equal(cg.coverPrefix(g), prefix, `coverPrefix(${g})`);
    assert.equal(cg.matchesGlob(g, yes), true, `matchesGlob(${g}, ${yes})`);
    if (no !== null) assert.equal(cg.matchesGlob(g, no), false, `matchesGlob(${g}, ${no})`);
  }
});

test('G-27: every refused form is refused by every function alike', () => {
  for (const g of REFUSED) {
    assert.equal(cg.parseGlob(g).ok, false, `parseGlob accepted ${JSON.stringify(g)}`);
    assert.ok(cg.validateGlob(g), `validateGlob accepted ${JSON.stringify(g)}`);
    for (const fn of [() => cg.walkRoot(g), () => cg.coverPrefix(g), () => cg.matchesGlob(g, 'a'), () => cg.isLiteralGlob(g)]) {
      assert.throws(fn, undefined, `a function read the refused glob ${JSON.stringify(g)}`);
    }
  }
});

// G-15, by name.
test('G-15: consecutive ** segments match like one', () => {
  assert.equal(cg.matchesGlob('**/**', 'a'), true);
  assert.equal(cg.matchesGlob('**/**', 'a/b'), true);
});

// G-16: a key whose value is not a list skipped validation and threw later.
test('G-16: a glob key that is not a list, or a doc_roles value that is not a string, is refused by name', () => {
  const errs = cg.contractGlobErrors({ source_globs: 'src/**', review: { preflight_inputs: 'x/**' }, doc_roles: { architecture: ['A.md'] } });
  const keys = errs.map((e) => e.split(':')[0]).sort();
  assert.deepEqual(keys, ['doc_roles.architecture', 'review.preflight_inputs', 'source_globs'], `got: ${errs.join(' | ')}`);
});

// G-12: the worktree hash pruned generated globs by covering prefix, so `scripts/**/*.txt` hid every edit under scripts/.
test('G-12: a narrow generated glob does not hide an edit to a file it does not match', (t) => {
  const d = tmp(t);
  fs.mkdirSync(path.join(d, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(d, 'scripts', 'x.mjs'), 'one');
  fs.writeFileSync(path.join(d, 'scripts', 'n.txt'), 'note');
  const sha = () => worktreeSha({ repoRoot: d, paths: ['scripts'], generatedGlobs: ['scripts/**/*.txt'] });
  const before = sha();
  fs.writeFileSync(path.join(d, 'scripts', 'x.mjs'), 'two');
  assert.notEqual(sha(), before, 'an edit to scripts/x.mjs did not move the hash');
  const mid = sha();
  fs.writeFileSync(path.join(d, 'scripts', 'n.txt'), 'changed');
  assert.equal(sha(), mid, 'a generated file the glob matches still moves the hash');
});

// G-22: the owning document stated the wrong current version.
test('G-22: the contract doc states the version the engine implements', () => {
  const m = /currently `(\d+)`/.exec(read('shared', 'claude-md-contract.md'));
  assert.ok(m, 'the doc states no current version');
  assert.equal(Number(m[1]), CONTRACT_VERSION);
});

// G-1: the doc-sync hook looked for `graph_contract` only, so it did nothing on a contract written with the new key.
test('G-1: the doc-sync hook reminds on a contract that declares graph_contract_version', (t) => {
  const d = tmp(t);
  const git = (...a) => spawnSync('git', a, { cwd: d, encoding: 'utf8' });
  git('init', '-q', '.');
  fs.mkdirSync(path.join(d, 'src'), { recursive: true });
  fs.writeFileSync(path.join(d, 'CLAUDE.md'), '# t\n\n```yaml\ngraph_contract_version: 5\nproject: t\ncommands:\n  build: ""\n  test: ""\n'
    + 'source_globs: ["src/**"]\ndoc_paths: ["docs/**"]\n```\n');
  fs.writeFileSync(path.join(d, 'src', 'a.js'), 'x');
  git('add', 'src/a.js');
  const r = spawnSync(process.execPath, [path.join(REPO_ROOT, '.claude', 'hooks', 'doc-sync-check.mjs')], { cwd: d, encoding: 'utf8' });
  assert.match(`${r.stdout}${r.stderr}`, /Source changed but no declared doc is staged/, 'the hook stayed silent on a v5 contract');
});

// G-4: the live probe launched the node with the operator's whole environment. Its test here matched source text, and
// G-24 of 20261001-034021-cgg-remediation-review said why that was not enough: it passed while the scrubbed result could
// be discarded. REMOVED; the environment is now built by lib/decisions.mjs's subscriptionProbeEnv, and
// regression-cgg-r2-remediation.test.mjs asserts what that function returns.
