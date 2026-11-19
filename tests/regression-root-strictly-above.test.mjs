// regression-root-strictly-above.test.mjs — G-2 (with its symptom G-6) and G-12 (with its symptom G-1) of
// 20261118-112631-cpi-review, under the rule the operator decided on 2026-11-18 ("Strictly above the root
// (Recommended)"; .claude/requests/ci-path-identity.rule-decision.md).
//
// G-2: rootSpelling followed a link standing AT a root, so a home that is itself a junction was replaced by its target
// before any confined owner saw it, and A-30's refusal of a link at the root (restored for the home by G-4 of
// 20261102-220302-rbr-remediation-5-review) was silently gone. Only links STRICTLY ABOVE a root are followed now.
//
// G-12: admitRun passed the run directory itself through rootSpelling, so the lexical half of A-28's containment
// compared two real paths, and a --run-dir named through a link outside both the repository and the home was admitted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rootSpelling } from '../scripts/io/finding-scope.mjs';
import { admitRun } from '../scripts/lib/reviews-root.mjs';
import { hostPlatform } from '../scripts/platform/index.mjs';

const LINK = process.platform === 'win32' ? 'junction' : 'dir';

function layout(t) {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'q-root-above-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const real = path.join(base, 'real');
  const run = path.join(real, 'home', 'runs', '20261118-000000-r1');
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'run.json'), JSON.stringify({ run_id: '20261118-000000-r1' }));
  const link = path.join(base, 'link');
  fs.symlinkSync(real, link, LINK);
  return { base, real, link, home: path.join(real, 'home'), run };
}

test('rootSpelling keeps a link standing AT the root, for A-30 to refuse (G-2)', (t) => {
  const { base, home } = layout(t);
  const atHome = path.join(base, 'home-link');
  fs.symlinkSync(home, atHome, LINK);
  assert.equal(rootSpelling(atHome), atHome, 'a home that is a link was replaced by its target');
});

test('rootSpelling still follows a link strictly above the root', (t) => {
  const { link, home } = layout(t);
  assert.equal(rootSpelling(path.join(link, 'home')), home);
  assert.equal(rootSpelling(path.join(link, 'home', 'not-yet')), path.join(home, 'not-yet'));
});

test('admitRun refuses a run directory named through a link outside both roots (G-12)', (t) => {
  const { base, home, run } = layout(t);
  const alias = path.join(base, 'alias');
  fs.symlinkSync(run, alias, LINK);
  const r = admitRun({ runDir: alias, repoRoot: null, home, io: hostPlatform(), noRepository: true });
  assert.equal(r.ok, false, `a run named through an outside alias was admitted: ${JSON.stringify(r)}`);
  assert.equal(r.check, 'containment');
});

test('admitRun admits a run directory spelled through a link above the home, as macOS /var is', (t) => {
  const { link, home, run } = layout(t);
  const r = admitRun({ runDir: path.join(link, 'home', 'runs', path.basename(run)), repoRoot: null, home, io: hostPlatform(), noRepository: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.dir, run);
});
