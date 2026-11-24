// belowRoot's MEMOISED ANCESTOR WALK IS A LOOP, NOT A RECURSION (G-6 of 20261121-204740-m3s7-b1-remediation-review; I-14 of
// .claude/requests/m3-stage7-fixes.md): ancestorSpelling's memo branch placed each missing ancestor by calling itself on
// the parent, so the call-stack depth grew with the path's depth and a deep path that does not exist raised RangeError
// out of belowRoot instead of answering. Run in a child with a small stack so the recursion shows at a depth any
// platform's path length allows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

test('belowRoot answers for a missing path thousands of levels deep, with no RangeError', (t) => {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'q-below-iter-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  // Named as the deep path's last level: only that ancestor is placed, and its parent's thousands of levels with it.
  const root = path.join(base, 'zzroot');
  fs.mkdirSync(root);
  const mod = pathToFileURL(path.resolve('scripts/lib/finding-scope.mjs')).href;
  const plat = pathToFileURL(path.resolve('scripts/platform/index.mjs')).href;
  const script = `
    const { belowRoot } = await import(${JSON.stringify(mod)});
    const { hostPlatform } = await import(${JSON.stringify(plat)});
    const deep = [${JSON.stringify(path.join(base, 'elsewhere'))}, ...Array(3000).fill('a'), 'zzroot'].join(${JSON.stringify(path.sep)});
    try { const r = belowRoot(${JSON.stringify(root)}, deep, hostPlatform()); console.log('ANSWER ' + JSON.stringify(r)); }
    catch (e) { console.log('THREW ' + e.name + ': ' + e.message); process.exit(3); }
  `;
  const res = spawnSync(process.execPath, ['--stack-size=200', '--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(res.status, 0, `belowRoot did not answer: ${res.stdout}${res.stderr}`);
  assert.match(res.stdout, /^ANSWER null$/m);
});
