// G-7 of run 20260925-015614-platform-review, settled by the operator's rule on 2026-09-25: "move pure
// logic out of lib/ is ok if the logic is not os-agnostic. if the logic is not related to an OS then
// there is no need to be moved unless the reasoning is different".
//
// Stage 4 moved glob-walk, intent-cache, atomic and worktree out of lib/ WHOLESALE, and OS-agnostic
// decisions went with the I/O: where a glob's walk starts, which directories are never walked, how a
// link is represented in a digest, the order and framing of the cache-key digest, the temp-file naming
// rule and the rename-retry decision. They are rules, not I/O, so they return to lib/walk-rules.mjs,
// and the io/ modules keep only the reading. Two of them were ALSO duplicated: the skip set lived in
// glob-walk inline and in worktree as SKIP_DIRS.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as rules from '../scripts/lib/walk-rules.mjs';
import { walkRoot, coverPrefix } from '../scripts/lib/contract-glob.mjs';

test('the skip set has one owner', () => {
  assert.equal(rules.isSkippedDir('node_modules'), true);
  assert.equal(rules.isSkippedDir('.git'), true);
  assert.equal(rules.isSkippedDir('src'), false);
  const io = path.join(import.meta.dirname, '..', 'scripts', 'io');
  for (const f of ['glob-walk.mjs', 'worktree.mjs']) {
    const src = fs.readFileSync(path.join(io, f), 'utf8');
    assert.match(src, /isSkippedDir\(/, `${f} asks the owner`);
    assert.doesNotMatch(src, /['"]node_modules['"]/, `${f} carries no private copy`);
  }
});

// The walk root moved to lib/contract-glob.mjs's walkRoot (contract-glob-grammar stage 3). Two expectations changed by
// the design's decisions: the base carries no trailing slash, and `?` and an empty glob are refused, not read.
test('where a glob walk starts — a directory, cut at the first wildcard', () => {
  assert.deepEqual(walkRoot('shared/**'), { base: 'shared', wildcard: true });
  assert.deepEqual(walkRoot('shared/foo*.md'), { base: 'shared', wildcard: true },
    'a partial segment is not a directory; coverPrefix answers a DIFFERENT question and keeps it');
  assert.equal(coverPrefix('shared/foo*.md'), 'shared/foo');
  assert.deepEqual(walkRoot('CLAUDE.md'), { base: 'CLAUDE.md', wildcard: false });
  assert.throws(() => walkRoot('docs/a?.md'), /`\?`/);
  assert.throws(() => walkRoot('  '), /empty/);
});

test('the digest framing is fixed and ordered, so a cache key is the same on every machine', () => {
  const entries = [{ rel: 'b.md', body: 'B' }, { rel: 'a.md', body: Buffer.from('A') }];
  const got = rules.digestInputs(crypto.createHash('sha256'), entries).digest('hex');
  const expected = crypto.createHash('sha256').update('a.md').update('\0').update(Buffer.from('A')).update('\0')
    .update('b.md').update('\0').update('B').update('\0').digest('hex');
  assert.equal(got, expected, 'relative path, NUL, body, NUL — in relative-path order');
  assert.equal(rules.linkBody('../target'), 'symlink:../target', 'a link is hashed as its target, never followed');
});

test('temp naming and the rename retry are rules, with everything ambient passed in', () => {
  assert.equal(rules.tempNameFor('/r/run.json', { pid: 7, rand: 'abcdef' }), '/r/run.json.7.abcdef.tmp');
  assert.throws(() => rules.tempNameFor('/r/x', {}), /pid/);
  const codes = new Set(['EBUSY']);
  assert.deepEqual(rules.renameRetry({ code: 'EBUSY', attempt: 1, transientCodes: codes }), { retry: true, waitMs: rules.RENAME_BACKOFF_MS });
  assert.equal(rules.renameRetry({ code: 'EBUSY', attempt: rules.RENAME_ATTEMPTS, transientCodes: codes }).retry, false, 'bounded');
  assert.equal(rules.renameRetry({ code: 'ENOSPC', attempt: 1, transientCodes: codes }).retry, false);
});

test('which inputs make up the intent key is a rule, not a walk', () => {
  const spec = rules.intentInputSpec({ docPaths: ['shared/**', 'CLAUDE.md'], docRoles: { architecture: 'ARCHITECTURE.md', roadmap: '' }, requestPath: '.claude/requests/x.md', skillPath: null });
  assert.deepEqual(spec, { globs: ['shared/**', 'CLAUDE.md', 'ARCHITECTURE.md'], files: ['.claude/requests/x.md'] });
});

test('the io modules delegate to the rules rather than restating them', () => {
  const io = path.join(import.meta.dirname, '..', 'scripts', 'io');
  const read = (f) => fs.readFileSync(path.join(io, f), 'utf8');
  assert.match(read('glob-walk.mjs'), /walkRoot\(/);
  assert.match(read('glob-walk.mjs'), /digestInputs\(/);
  assert.match(read('intent-cache.mjs'), /intentInputSpec\(/);
  assert.match(read('atomic.mjs'), /tempNameFor\(/);
  assert.match(read('atomic.mjs'), /renameRetry\(/);
});

// G-8 of run 20260925-200721-platform-remediated (perf-audit and panel-codex-perf, two families):
// C8 moved the framing into digestInputs and hashFiles began READING EVERY FILE into an array before
// hashing any of them — peak memory the whole input set, where the base commit hashed one file at a
// time. Bodies are now pulled lazily, each just before it is hashed, and the digest is unchanged.
test('G-8: each body is read only when its turn comes, never all of them up front', () => {
  const log = [];
  const hash = { update: (x) => { log.push(`hash ${typeof x === 'string' ? x : x.toString()}`); return hash; } };
  const lazy = (rel, text) => ({ rel, body: () => { log.push(`read ${rel}`); return Buffer.from(text); } });
  rules.digestInputs(hash, [lazy('b.md', 'B'), lazy('a.md', 'A'), { rel: 'gone.md', body: () => { log.push('read gone.md'); return null; } }]);
  assert.deepEqual(log, [
    'read a.md', 'hash a.md', 'hash \0', 'hash A', 'hash \0',
    'read b.md', 'hash b.md', 'hash \0', 'hash B', 'hash \0',
    'read gone.md',
  ], 'read, then hashed, one at a time in path order; an unreadable body (null) is left out entirely');
});
