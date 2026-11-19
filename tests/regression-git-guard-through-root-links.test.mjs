// regression-git-guard-through-root-links.test.mjs — G-3 and G-4 of 20261118-112631-cpi-review.
//
// external-review admits an --evidence-dir, and an --out below its sink, through the root's own links (belowRoot,
// ci-path-identity.plan.md stage 1c), but its git-tracked guard stayed lexical: git reports its toplevel on its real
// path, so a path spelled through a link ABOVE the repository was in no git root lexically, `check-ignore` was never
// asked, and a raw vendor response could land on tracked surface. Before stage 1c the same input was refused; a
// fail-closed refusal had become a fail-open skip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScript, REPO_ROOT, noRealReviewers } from './helpers.mjs';

const LINK = process.platform === 'win32' ? 'junction' : 'dir';

function aboveRepo(t) {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'q-git-guard-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const up = path.join(base, 'up');
  fs.symlinkSync(path.dirname(fs.realpathSync.native(REPO_ROOT)), up, LINK);   // a link strictly above the repository
  const prompt = path.join(base, 'arm-prompt.md');
  fs.writeFileSync(prompt, 'review the declared scope');
  return { via: path.join(up, path.basename(fs.realpathSync.native(REPO_ROOT))), prompt };
}

test('an --evidence-dir on tracked surface, spelled through a link above the repository, is refused (G-3)', (t) => {
  const { via, prompt } = aboveRepo(t);
  assert.ok(fs.existsSync(path.join(via, 'shared')), 'the fixture must name a tracked directory that exists');
  const r = runScript('external-review.mjs',
    ['--evidence-dir', path.join(via, 'shared'), '--node-id', 'gp', '--reviewer', 'codex', '--prompt-file', prompt]);
  assert.notEqual(r.status, 0);
  assert.match(r.output, /inside git's tracked surface/, r.output.slice(0, 400));
});

test('an --out on tracked surface below an in-tree sink, spelled through a link above the repository, is refused (G-4)', (t) => {
  const { via, prompt } = aboveRepo(t);
  // An in-tree sink whose evidence/ is ignored (.claude/reviews/*/evidence/) and whose own folder is not.
  const name = `q-g4-${process.pid}-${Date.now()}`;
  const sink = path.join(REPO_ROOT, '.claude', 'reviews', name);
  fs.mkdirSync(sink, { recursive: true });
  t.after(() => fs.rmSync(sink, { recursive: true, force: true }));
  const out = path.join(via, '.claude', 'reviews', name, 'resp.json');
  const r = runScript('external-review.mjs',
    ['--evidence-dir', sink, '--node-id', 'gp', '--reviewer', 'codex', '--prompt-file', prompt, '--out', out]);
  assert.notEqual(r.status, 0);
  assert.match(r.output, /OUT-5/, r.output.slice(0, 400));
  assert.equal(fs.existsSync(path.join(sink, 'resp.json')), false, 'nothing written on tracked surface');
});

// G-1 of 20261118-131040-cpi-remediation-review: the bytes are written through the sink's REAL path (evidenceRoot), but
// check-ignore was asked about the caller's spelling of it. A link at an ignored .claude/reviews/<id> leading to an
// unignored directory of the repository passed the guard, and the raw vendor response landed on tracked surface.
test('an --evidence-dir that is a link at an ignored path leading to tracked surface is refused (G-1)', (t) => {
  const tag = `${process.pid}-${Date.now()}`;
  const target = path.join(REPO_ROOT, `q-g1-target-${tag}`);   // inside the repository, ignored by no rule
  const alias = path.join(REPO_ROOT, '.claude', 'reviews', `q-g1-alias-${tag}`);
  fs.mkdirSync(target, { recursive: true });
  fs.mkdirSync(path.dirname(alias), { recursive: true });
  fs.symlinkSync(target, alias, LINK);
  t.after(() => {
    try { fs.unlinkSync(alias); } catch { try { fs.rmdirSync(alias); } catch { /* gone */ } }
    fs.rmSync(target, { recursive: true, force: true });
  });
  const prompt = path.join(target, 'arm-prompt.md');
  fs.writeFileSync(prompt, 'review the declared scope');
  const r = runScript('external-review.mjs',
    ['--evidence-dir', alias, '--node-id', 'gp', '--reviewer', 'codex', '--prompt-file', prompt],
    { env: noRealReviewers() });
  assert.notEqual(r.status, 0);
  assert.match(r.output, /inside git's tracked surface/, r.output.slice(0, 600));
  assert.equal(fs.existsSync(path.join(target, 'evidence')), false, 'nothing written on tracked surface');
});
