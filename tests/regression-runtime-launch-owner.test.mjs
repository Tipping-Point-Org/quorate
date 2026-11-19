// G-6 of 20261111-192009-runtime-bin-remediation-review: lib/argv-specs.mjs's runtimeCommand was called the one owner of
// the runtime command, yet decisions.mjs withRuntimeOverride made the override-versus-adapter choice again, and the rule
// that a `.mjs`/`.js` command runs under this node's execPath was written three times (withRuntimeOverride, spawn-node,
// spawn-subagent). The paths that execute the runtime and the ones that report it could drift. One owner now decides
// both, runtimeLaunch, and every other site goes through it. Held here: the owner's answer, withRuntimeOverride agreeing
// with it, and a census that no script spells the script-wrapping rule itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as specs from '../scripts/lib/argv-specs.mjs';
import { withRuntimeOverride } from '../scripts/lib/decisions.mjs';
import { REPO_ROOT } from './helpers.mjs';

test('one owner decides the runtime launch: the command, and whether a script runs under execPath', () => {
  assert.equal(typeof specs.runtimeLaunch, 'function', 'no owner decides how the runtime is launched');
  assert.deepEqual(specs.runtimeLaunch('/f/fake.mjs', 'claude', '/node'), { cmd: '/node', prefix: ['/f/fake.mjs'], command: '/f/fake.mjs' });
  assert.deepEqual(specs.runtimeLaunch('/f/fake.JS', 'claude', '/node'), { cmd: '/node', prefix: ['/f/fake.JS'], command: '/f/fake.JS' });
  assert.deepEqual(specs.runtimeLaunch('/bin/fake', 'claude', '/node'), { cmd: '/bin/fake', prefix: [], command: '/bin/fake' });
  assert.deepEqual(specs.runtimeLaunch(null, 'claude', '/node'), { cmd: 'claude', prefix: [], command: 'claude' });
});

test('withRuntimeOverride launches exactly as the owner says', () => {
  const spec = { cmd: 'claude', argv: ['-p'], input: 'x' };
  for (const o of ['/f/fake.mjs', '/f/fake.js', '/bin/fake']) {
    const l = specs.runtimeLaunch(o, spec.cmd, '/node');
    assert.deepEqual(withRuntimeOverride(spec, o, '/node'), { cmd: l.cmd, argv: [...l.prefix, ...spec.argv], input: 'x' });
  }
  assert.deepEqual(withRuntimeOverride(spec, null, '/node'), spec);
});

// G-10 of 20261111-195536-runtime-bin-remediation-2-review: with no --runtime-bin, withRuntimeOverride returned the
// adapter's command unchanged, so a contract adapter whose `cmd` is a `.mjs`/`.js` script was run directly by new-run,
// check-intent-grant and forgeLaunch, while spawn-node ran the same command under execPath. No override still goes
// through the owner.
test('withRuntimeOverride with no override wraps an adapter cmd that is a script, as spawn-node does', () => {
  for (const cmd of ['/a/runtime.mjs', '/a/runtime.JS', 'claude']) {
    const spec = { cmd, argv: ['-p'], input: null };
    const l = specs.runtimeLaunch(null, cmd, '/node');
    for (const none of [null, undefined]) {
      assert.deepEqual(withRuntimeOverride(spec, none, '/node'), { cmd: l.cmd, argv: [...l.prefix, '-p'], input: null },
        `no override, adapter cmd ${cmd}`);
    }
  }
});

// The census: the wrapping rule, a `.mjs`/`.js` test on a command, is spelled only in the owner. Matched by its shapes
// (a regex literal `\.m?js$` or `\.(m?js)$`, or `endsWith('.mjs')`/`endsWith('.js')`) applied to a runtime or bin name.
test('census: no script spells the script-wrapping rule outside lib/argv-specs.mjs', () => {
  const hits = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(REPO_ROOT, rel), { withFileTypes: true })) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) { walk(r); continue; }
      if (!/\.mjs$/.test(e.name) || r === 'scripts/lib/argv-specs.mjs') continue;
      fs.readFileSync(path.join(REPO_ROOT, r), 'utf8').split(/\r?\n/).forEach((l, i) => {
        const code = l.replace(/^\s*\/\/.*$/, '');
        if (/\\\.m\?js\$\/i?\.test\((?!file\b)/.test(code) || /(bin|override|runtime\w*)\.endsWith\(['"]\.m?js['"]\)/i.test(code)) {
          hits.push(`${r}:${i + 1}: ${l.trim()}`);
        }
      });
    }
  };
  walk('scripts');
  assert.deepEqual(hits, [], 'a script decides itself whether the runtime runs under execPath');
});
