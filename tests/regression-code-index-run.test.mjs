// RUNNING AN EXTRACTOR, AND TRUSTING ITS CACHED FACTS (code-index.plan.md stage 6).
//
// The pure decisions are in scripts/lib/code-index-cache.mjs:
// - the extractor's environment is exactly the process basics plus the declared `env`, so no operator credential, no
//   git identity and no QUORATE_HOME reaches a command a consumer declared;
// - the cache key changes with every part that decides the facts;
// - a child's result maps to check-outcomes' process outcomes, a signal reading `incomplete`, not `failed`;
// - the two new keys each have three states.
// spawnCapture now reports the signal a child closed with, which that last rule needs: it reported only the status, so
// a signal-killed child read as a failure of its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawnCapture } from '../scripts/io/spawn-capture.mjs';
import { extractorEnvFor, cacheKey, childFailure, timeoutMinutes, cacheCapBytes, namedPaths, indexDirName } from '../scripts/lib/code-index-cache.mjs';

test('spawnCapture reports the signal a child closed with', async () => {
  const fake = () => {
    const c = new EventEmitter();
    c.stdout = new PassThrough();
    c.stderr = new PassThrough();
    c.pid = 4242;
    setImmediate(() => c.emit('close', null, 'SIGKILL'));
    return c;
  };
  const r = await spawnCapture('x', [], {}, { spawn: fake });
  assert.equal(r.signal, 'SIGKILL');
  assert.equal(r.status, null);
});

const basics = ['PATH', 'SYSTEMROOT', 'TEMP'];
const source = { PATH: '/bin', Path: '/bin2', SYSTEMROOT: 'C:\\Windows', TEMP: '/t', PYTHONPATH: 'src', ANTHROPIC_API_KEY: 'x',
  ANTHROPIC_BASE_URL: 'u', CLAUDE_CODE_OAUTH_TOKEN: 'y', GIT_AUTHOR_EMAIL: 'me@example.invalid', QUORATE_HOME: '/q', HOME: '/h' };

test('the extractor environment is exactly basics plus the declared env, nothing else', () => {
  const posix = extractorEnvFor(source, { basics, declared: ['PYTHONPATH'], caseInsensitiveEnv: false });
  assert.deepEqual(Object.keys(posix).sort(), ['PATH', 'PYTHONPATH', 'SYSTEMROOT', 'TEMP']);
  const win = extractorEnvFor(source, { basics, declared: [], caseInsensitiveEnv: true });
  assert.deepEqual(Object.keys(win).sort(), ['PATH', 'Path', 'SYSTEMROOT', 'TEMP']);
  for (const env of [posix, win]) {
    for (const k of Object.keys(env)) assert.ok(!/^(ANTHROPIC_|CLAUDE_CODE_|GIT_|QUORATE_)/i.test(k), `${k} reached the extractor`);
  }
  assert.throws(() => extractorEnvFor(source, { declared: [] }), /basics/);
});

// G-1 of 20261020-051530-code-index-remediation-review: the depth was stripped with everything else, so an extractor run
// from a depth-1 node saw depth 0 and could start a run of its own. It crosses as it was, and a declared name cannot add it.
test('the extractor keeps the caller\'s GRAPH_NODE_DEPTH, and has none when the caller has none', () => {
  for (const caseInsensitiveEnv of [false, true]) {
    const env = extractorEnvFor({ ...source, GRAPH_NODE_DEPTH: '1' }, { basics, declared: [], caseInsensitiveEnv });
    assert.equal(env.GRAPH_NODE_DEPTH, '1', `the depth was stripped (caseInsensitiveEnv ${caseInsensitiveEnv})`);
    const none = extractorEnvFor(source, { basics, declared: ['GRAPH_NODE_DEPTH'], caseInsensitiveEnv });
    assert.ok(!('GRAPH_NODE_DEPTH' in none), 'a depth appeared from nowhere');
  }
});

const base = () => ({
  language: 'python',
  spec: { extractor: 'python x.py', globs: ['src/**/*.py'], options: { import_roots: ['src'] } },
  manifest: [{ path: 'src/a.py', sha256: 'a1' }, { path: 'src/b.py', sha256: 'b1' }],
  named: [{ path: 'x.py', sha256: 'e1' }],
  identity: { name: 'quorate-python', version: '1', runtime: 'python 3.12.4', parser: 'ast (stdlib)', modules: { 'extract.py': 'm1' } },
});

test('the cache key changes with every part that decides the facts, and not with order', () => {
  const k = cacheKey(base());
  const changed = (mutate, why) => { const b = base(); mutate(b); assert.notEqual(cacheKey(b), k, `${why} did not change the key`); };
  changed((b) => { b.manifest[0].sha256 = 'a2'; }, "a file's content");
  changed((b) => { b.manifest.push({ path: 'src/c.py', sha256: 'c1' }); }, 'a file added to the manifest');
  changed((b) => { b.named[0].sha256 = 'e2'; }, 'the extractor script');
  changed((b) => { b.identity.runtime = 'python 3.13.0'; }, 'the runtime version');
  changed((b) => { b.identity.parser = 'acorn 8.15.0'; }, 'the parser version');
  changed((b) => { b.identity.modules['extract.py'] = 'm2'; }, 'a module the extractor loads');
  changed((b) => { b.spec.options.import_roots = ['lib']; }, 'the options');
  changed((b) => { b.spec.extractor = 'python3 x.py'; }, 'the command');
  changed((b) => { b.language = 'javascript'; }, 'the language');
  const reordered = base();
  reordered.manifest.reverse();
  reordered.spec = { options: { import_roots: ['src'] }, globs: ['src/**/*.py'], extractor: 'python x.py' };
  assert.equal(cacheKey(reordered), k, 'the same inputs in another order gave another key');
});

test('a command\'s file arguments are what the key hashes as "the files it names"', () => {
  assert.deepEqual(namedPaths(['python', '.claude/skills/quorate/extractors/python/extract.py', '--flag']),
    ['.claude/skills/quorate/extractors/python/extract.py']);
  assert.deepEqual(namedPaths(['my-indexer', '--fast']), []);
});

test('a child result maps to its process outcome, a signal reading incomplete', () => {
  assert.equal(childFailure({ status: 0 }), null);
  assert.equal(childFailure({ status: 3 }).detail, 'failed');
  assert.equal(childFailure({ status: null, timedOut: true }).detail, 'timed-out');
  assert.equal(childFailure({ status: null, error: Object.assign(new Error('nope'), { code: 'ENOENT' }) }).detail, 'could-not-start');
  assert.equal(childFailure({ status: null, signal: 'SIGKILL' }).detail, 'incomplete');
  assert.equal(childFailure({ status: 0, capped: { stdout: 10 } }).detail, 'incomplete', 'an overflowed response is not a pass');
});

test('the timeout and the cache cap each have three states', () => {
  assert.deepEqual(timeoutMinutes(undefined), { ok: true, minutes: 10 });
  assert.equal(timeoutMinutes('').ok, false, 'an empty timeout would let an extractor hold a query forever');
  assert.equal(timeoutMinutes(-1).ok, false);
  assert.deepEqual(timeoutMinutes(3), { ok: true, minutes: 3 });
  assert.deepEqual(cacheCapBytes(undefined), { ok: true, maxBytes: 256 * 1024 * 1024 });
  assert.deepEqual(cacheCapBytes(''), { ok: true, maxBytes: null });
  assert.deepEqual(cacheCapBytes(1), { ok: true, maxBytes: 1024 * 1024 });
  assert.equal(cacheCapBytes('lots').ok, false);
});

test('the index directory is named by the repository\'s path, the same path always giving the same name', () => {
  assert.equal(indexDirName('/a/repo'), indexDirName('/a/repo'));
  assert.notEqual(indexDirName('/a/repo'), indexDirName('/b/repo'));
  assert.match(indexDirName('/a/repo'), /^[0-9a-f]{24}$/);
});
