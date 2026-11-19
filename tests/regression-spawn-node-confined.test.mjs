// run-dir-descendants.plan.md stage 2 (D-D3 A, D-D2 A): spawn-node made nodes/ and evidence/<node> recursively with no
// check, and checked sandbox/<node> only after creating it, so a link planted at any of them carried the node's status,
// report, output or working directory wherever it led — and a link resolving back inside the run passed the realpath
// check. Every write below the run now goes through the one owner, which refuses a link at any level.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { repoRunDir, runScript, REPO_ROOT } from './helpers.mjs';

function run() {
  const { dir } = repoRunDir({ prefix: 'quorate-spawn-confined-', json: { contract: { source_globs: ['scripts/**'] }, stamps: [] } });
  fs.writeFileSync(path.join(dir, 'intent-settings.json'), JSON.stringify({ permissions: { deny: ['Grep'] } }));
  return dir;
}
const spawnIntent = (dir) => runScript('spawn-node.mjs', [
  '--run-dir', dir, '--repo-root', REPO_ROOT, '--node-id', 'intent-capture', '--mode', 'intent', '--prompt', 'x',
  '--settings', path.join(dir, 'intent-settings.json'), '--print-cmd',
]);

for (const level of ['nodes', 'evidence', 'sandbox']) {
  test(`run-dir-descendants stage 2: a link at ${level}/ resolving inside the run is refused, nothing created through it`, () => {
    const dir = run();
    const inner = path.join(dir, `inner-${level}`);
    fs.mkdirSync(inner);
    fs.rmSync(path.join(dir, level), { recursive: true, force: true });   // the fixture may already hold it
    fs.symlinkSync(inner, path.join(dir, level), 'junction');
    const r = spawnIntent(dir);
    assert.notEqual(r.status, 0, `spawn-node wrote through the ${level} link: ${r.output.slice(-400)}`);
    assert.match(r.output, /link or junction/);
    assert.deepEqual(fs.readdirSync(inner), [], `nothing was created through the ${level} link`);
  });
}
