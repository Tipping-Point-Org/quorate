// LOW HYGIENE FROM 20261121-214741-m3s7-b1-remediation-2-review, each pinned where it was found.
// G-2: classifyPanelProbe built a RegExp from the reviewer name unescaped, so `x(y` threw and `a.b` over-matched.
// G-3: reviewerEnv folded names to upper case on every platform, so on POSIX a `Home` crossed as the allow-listed `HOME`.
// G-4: windowsShellArgv passed `%NAME%` through untouched, and cmd.exe expands it, quoted or not.
// G-1: archive-run's lock diagnostics spelled the lock's name as a literal beside the imported owner of that name.
// G-10: remediate.mjs put the operator's --operator-quote into the tracked brief unredacted.
// G-13: run-graph's request recovery read every lstat failure as a vanished entry, with no word.
// G-16: run-graph sorted findings with its own comparator before groupFindings, which owns that sort.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classifyPanelProbe, reviewerEnv, windowsShellArgv } from '../scripts/lib/decisions.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('G-2: a reviewer name is matched literally in the unavailable marker', () => {
  const env = (name, source = name) => ({ schema_version: 1, source, not_checked: [{ item: `external reviewer '${name}'`, reason: 'r' }] });
  assert.equal(classifyPanelProbe(env('codex'), 'codex').state, 'unavailable', 'the envelope shape is not one the classifier reads');
  assert.doesNotThrow(() => classifyPanelProbe(env('x(y'), 'x(y'));
  assert.equal(classifyPanelProbe(env('x(y'), 'x(y').state, 'unavailable');
  assert.notEqual(classifyPanelProbe(env('aXb', 'a.b'), 'a.b').state, 'unavailable', 'a.b matched aXb');
});

test('G-3: names are folded on Windows only', () => {
  const src = { Home: 'h', HOME: 'H', OpenAI_API_KEY: 'o' };
  const posix = reviewerEnv('codex', src, { depth: 0, prefixes: [], names: ['OPENAI_API_KEY'], caseFold: false });
  assert.ok(!posix.passed.includes('Home'), `POSIX passed a differently-cased variable: ${posix.passed}`);
  assert.ok(!posix.passed.includes('OpenAI_API_KEY'), `POSIX matched a declared name case-insensitively: ${posix.passed}`);
  const win = reviewerEnv('codex', src, { depth: 0, prefixes: [], names: ['OPENAI_API_KEY'], caseFold: true });
  assert.ok(win.passed.includes('OpenAI_API_KEY'), `Windows lost the stored-case credential: ${win.passed}`);
  for (const f of ['scripts/external-review.mjs', 'scripts/run-graph.mjs', 'scripts/bench-second-opinion.mjs']) {
    const calls = [...read(f).matchAll(/reviewerEnv\(([\s\S]*?)\}\)/g)].map((m) => m[1]);
    assert.ok(calls.length > 0, f);
    for (const c of calls) assert.match(c, /caseFold:/, `${f}: a reviewerEnv call does not say whether names fold`);
  }
});

test('G-4: windowsShellArgv refuses an argument holding %NAME%', () => {
  assert.throws(() => windowsShellArgv(['--x', 'a%PATH%b']), /%PATH%/);
  assert.deepEqual(windowsShellArgv(['50%', 'a b']), ['50%', '"a b"']);
});

test('G-1: archive-run names the lock through REMEDIATE_LOCK in every diagnostic', () => {
  const lines = read('scripts/archive-run.mjs').split('\n').filter((l) => !l.trimStart().startsWith('//'));
  const bare = lines.filter((l) => l.includes('remediate.lock'));
  assert.deepEqual(bare, [], 'a diagnostic spells the lock name as a literal');
});

test('G-10: the operator quote reaches the brief redacted', () => {
  assert.match(read('scripts/remediate.mjs'), /quote: redactClaim\(frame\.scope_quote\)/);
});

test('G-13: request recovery skips only a vanished entry, and names any other lstat failure', () => {
  const src = read('scripts/run-graph.mjs');
  const start = src.indexOf('function newestRequestDoc()');
  const body = src.slice(start, src.indexOf('candidates.sort', start));
  assert.ok(!/lstatSync\(abs\); \} catch \{ continue; \}/.test(body), 'every lstat failure is a silent skip');
  assert.match(body, /ENOENT/, 'only a vanished entry may be skipped silently');
});

test('G-16: findings reach groupFindings unsorted by run-graph, which does not own that order', () => {
  assert.ok(!/collectFindings\(\)\.sort\(/.test(read('scripts/run-graph.mjs')), 'run-graph keeps its own comparator');
});
