// adapter-tool-lists.plan.md (design decided, operator 2026-10-26: "C B"): an adapter's node_runtime tool lists have one
// declared shape, a check that refuses any other by name, and one accessor that never throws. Each reader used to decide
// shape itself, and runtime-call-telemetry's remediations fixed one list per round while the review found the next (G-1
// of 20261026-174311, G-4 and G-6 of -190950, G-3 of 20261026-194518-rct-remediation-3-review).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_LISTS, PLATFORM_IDS, isToolList, toolListErrors, toolList, shellToolKeys } from '../scripts/lib/tool-lists.mjs';
import { IMPLEMENTATIONS } from '../scripts/platform/index.mjs';
import { builtinReviewers } from '../scripts/io/reviewers.mjs';

const MALFORMED = [['not an array', 1], ['a string', 'Bash'], ['an object', { a: 1 }], ['a non-string entry', ['Bash', 3]],
  ['an empty string entry', ['Bash', '']], ['a blank entry', ['  ']]];

const withList = (key, value) => ({ cmd: 'x', node_runtime: { [TOOL_LISTS[key]]: { [key]: value } } });

test('stage 1: PLATFORM_IDS is the platform layer\'s set of implementations', () => {
  assert.deepEqual([...PLATFORM_IDS].sort(), Object.keys(IMPLEMENTATIONS).sort());
});

test('stage 1: a list is an array of non-empty strings, and nothing else is', () => {
  assert.ok(isToolList([]) && isToolList(['Bash', 'Grep']));
  for (const [what, v] of MALFORMED) assert.ok(!isToolList(v), what);
});

test('stage 1: every declared list refuses every malformed shape by name, and reads it as empty', () => {
  for (const key of Object.keys(TOOL_LISTS)) {
    for (const [what, bad] of MALFORMED) {
      const value = key === 'shell_tools' ? { default: bad } : bad;
      const a = withList(key, value);
      const errs = toolListErrors('zed', a);
      assert.ok(errs.length && errs.every((e) => e.includes('zed') && e.includes(key)), `${key}, ${what}: ${JSON.stringify(errs)}`);
      assert.doesNotThrow(() => toolList(a, key, 'linux'), `${key}, ${what}`);
      assert.deepEqual(toolList(a, key, 'linux'), [], `${key}, ${what} reads as empty`);
    }
  }
});

test('stage 1: shell_tools is an object keyed by a platform id, default, or a $ comment', () => {
  assert.deepEqual(toolListErrors('zed', withList('shell_tools', { win32: ['PowerShell'], default: ['Bash'], $note: 'x' })), []);
  for (const bad of [['Bash'], 'Bash', 1]) {
    assert.ok(toolListErrors('zed', withList('shell_tools', bad)).some((e) => /shell_tools must be an object/.test(e)), JSON.stringify(bad));
  }
  const misspelt = toolListErrors('zed', withList('shell_tools', { windows: ['PowerShell'] }));
  assert.ok(misspelt.some((e) => /key 'windows'/.test(e)), 'a misspelt platform key is refused, not left to fall to default');
});

test('stage 1: shell_tools resolves the platform\'s own list, else default\'s', () => {
  const a = withList('shell_tools', { win32: ['Bash', 'PowerShell'], default: ['Bash'], $note: 'x' });
  assert.deepEqual(toolList(a, 'shell_tools', 'win32'), ['Bash', 'PowerShell']);
  assert.deepEqual(toolList(a, 'shell_tools', 'linux'), ['Bash']);
  assert.deepEqual(shellToolKeys(a).sort(), ['default', 'win32']);
  assert.deepEqual(shellToolKeys({}), ['default']);
});

test('stage 1: an absent list is not malformed, and reads as empty', () => {
  assert.deepEqual(toolListErrors('zed', { cmd: 'x' }), []);
  for (const key of Object.keys(TOOL_LISTS)) assert.deepEqual(toolList({ cmd: 'x' }, key, 'linux'), []);
});

test('stage 1: the accessor returns a copy, so a reader cannot change the adapter', () => {
  const a = withList('deny_always', ['Edit']);
  toolList(a, 'deny_always').push('Write');
  assert.deepEqual(a.node_runtime.tools.deny_always, ['Edit']);
});

test('stage 1: an undeclared key is a programming error, refused loudly', () => {
  assert.throws(() => toolList({}, 'deny_sometimes'), /not a declared tool list/);
});

test('stage 1: the shipped adapters\' tool lists are well-formed', () => {
  for (const [name, a] of Object.entries(builtinReviewers())) assert.deepEqual(toolListErrors(name, a), [], name);
});

// ---------------------------------------------------------------------------- stage 2: every reader through toolList

test('stage 2: G-3 — a malformed shell_tools is a named gap, not a TypeError', async () => {
  // G-3 of 20261026-194518-rct-remediation-3-review: unbackedCapabilities spread `shell_tools.default` through
  // shellToolsOf with no check, so `{ default: 1 }` threw `not iterable` instead of naming the gap.
  const { unbackedCapabilities } = await import('../scripts/lib/capabilities.mjs');
  const a = { cmd: 'x', capabilities: ['content_tool_denial'],
    node_runtime: { tools: { deny_intent: ['Grep'] }, deny_tools: { flag: '--deny' }, grants: { shell_tools: { default: 1 }, content_tools: ['Grep'] } } };
  let missing;
  assert.doesNotThrow(() => { missing = unbackedCapabilities(a); });
  assert.deepEqual(missing, [], 'the malformed list reads as empty here; adapterErrors is what refuses it by name');
});

test('stage 2: no file under scripts/ reads a tool-list key except through toolList', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { REPO_ROOT } = await import('./helpers.mjs');
  const keys = Object.keys(TOOL_LISTS).join('|');
  // Strip what cannot be a read: string and template text (a template's ${...} is kept), then comments. Newlines are kept,
  // so an offender's line number is its line in the file.
  const lines = (t) => t.replace(/[^\n]/g, '');
  const code = (src) => src
    .replace(/`(?:\\[\s\S]|[^`\\])*`/g, (t) => (t.match(/\$\{[^}]*\}/g) ?? []).join(' ') + lines(t))
    .replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, "''")
    .replace(/\/\*[\s\S]*?\*\//g, lines)
    .replace(/\/\/.*$/gm, '');
  const read = new RegExp(`(?:\\?\\.|\\.)(?:${keys})\\b`);
  const bracket = new RegExp(`\\[\\s*['"](?:${keys})['"]\\s*\\]`);
  const offenders = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith('.mjs') && !p.endsWith(path.join('lib', 'tool-lists.mjs'))) {
        const raw = fs.readFileSync(p, 'utf8');
        if (bracket.test(raw)) offenders.push(`${path.relative(REPO_ROOT, p)}: bracket read`);
        code(raw).split('\n').forEach((line, i) => {
          if (read.test(line)) offenders.push(`${path.relative(REPO_ROOT, p)}:${i + 1}: ${line.trim()}`);
        });
      }
    }
  };
  walk(path.join(REPO_ROOT, 'scripts'));
  assert.deepEqual(offenders, [], 'a tool list read outside lib/tool-lists.mjs decides its own shape');
});

// ---------------------------------------------------------------------------- stage 4: the document names every list

test('stage 4: shared/adapter-contract.md names every declared tool list and states the shape', async () => {
  // G-4 of 20261026-194518-rct-remediation-3-review: the vocabulary example omitted edit_tools, which the code reads.
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { REPO_ROOT } = await import('./helpers.mjs');
  const doc = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'adapter-contract.md'), 'utf8');
  for (const key of Object.keys(TOOL_LISTS)) assert.match(doc, new RegExp(`"${key}"`), `${key} is not in the document's examples`);
  assert.match(doc, /array of non-empty strings/, 'the document does not state a list\'s shape');
  for (const id of PLATFORM_IDS) assert.ok(doc.includes(`\`${id}\``), `the platform id ${id} is not named`);
});

// ---------------------------------------------------------------------------- stage 3: refused in adapterErrors

test('stage 3: adapterErrors refuses every malformed tool list by name', async () => {
  const { adapterErrors } = await import('../scripts/lib/reviewers.mjs');
  for (const key of Object.keys(TOOL_LISTS)) {
    for (const [what, bad] of MALFORMED) {
      const a = withList(key, key === 'shell_tools' ? { default: bad } : bad);
      assert.ok(adapterErrors('zed', a).some((e) => e.includes('zed') && e.includes(key)), `${key}, ${what}`);
    }
  }
  for (const [name, a] of Object.entries(builtinReviewers())) {
    assert.deepEqual(adapterErrors(name, a).filter((e) => Object.keys(TOOL_LISTS).some((k) => e.includes(k))), [], name);
  }
});

test('stage 3: a contract adapter with a malformed tool list stops the mint, naming the list', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { runScript, repoRunDir } = await import('./helpers.mjs');
  const { base, dir } = repoRunDir({ runId: '20260101-000000-toollists' });
  try {
    const tree = path.join(dir, 'tree');
    fs.mkdirSync(tree, { recursive: true });
    fs.writeFileSync(path.join(tree, 'CLAUDE.md'),
      '# t\n\n```yaml\ngraph_contract: 1\nproject: t\ncommands:\n  build: ""\n  test: ""\n'
      + 'reviewers:\n  zed:\n    cmd: "zed"\n    node_runtime:\n      prompt: { flag: "--ask" }\n'
      + '      grants:\n        shell_tools: { windows: ["PowerShell"] }\n```\n');
    const r = runScript('new-run.mjs', ['--repo-root', tree, '--dry-run']);
    assert.notEqual(r.status, 0, 'a malformed tool list must stop the mint');
    assert.match(r.output, /shell_tools has key 'windows'/, r.output.slice(-800));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
