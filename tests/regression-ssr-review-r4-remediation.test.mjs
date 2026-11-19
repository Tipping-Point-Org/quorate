// Remediation of review 20260929-171706-ssr-review-r4 (operator, 2026-09-29: "1 A, 2 as suggested, 3 yes, 4 as
// suggested"). Option A answers each CLASS, not the instance, because the round before fixed one case of each and left
// its sibling:
// - presence (G-10, with G-11): one owner decides "is this path there"; the module calls existsSync nowhere, and a
//   dangling link or an unreadable path is refused, never read as absent;
// - setup (G-6): nothing in a seed's setup, before its try, can throw — the rule round 2 wrote and did not finish.
// And G-9, pulled forward: a seed that throws late keeps the refusals it already had.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectRun as pureCollectRun } from '../scripts/lib/run-artifacts.mjs';
import { collectRun } from '../scripts/io/run-artifacts.mjs';
import { hostPlatform } from '../scripts/platform/index.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const code = (f) => fs.readFileSync(path.join(REPO, 'scripts', ...f.split('/')), 'utf8')
  .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const quiet = { warn: () => {} };

function run(t) {
  const r = path.join(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-ssr4-'))), 'run');
  t.after(() => fs.rmSync(path.dirname(r), { recursive: true, force: true }));
  fs.mkdirSync(path.join(r, 'nodes'), { recursive: true });
  fs.writeFileSync(path.join(r, 'run.json'), JSON.stringify({ run_id: '20260101-000000-x' }));
  return r;
}

// The class: existsSync answers false for absence AND for any stat error, so every check built on it can read an
// unreadable path as absent. One owner, built on lstat, decides presence for the whole module.
test('presence: the run reader calls existsSync nowhere', () => {
  assert.doesNotMatch(code('lib/run-artifacts.mjs'), /existsSync/, 'an existence check that cannot tell absent from unreadable');
});

test('G-10: an artifact file whose stat fails for any reason but absence is refused, not read as absent', (t) => {
  const r = run(t);
  fs.mkdirSync(path.join(r, 'evidence', 'reconcile'), { recursive: true });
  const payload = path.join(r, 'evidence', 'reconcile', 'payload.json');
  fs.writeFileSync(payload, JSON.stringify({ groups: [] }));
  const h = hostPlatform();
  const hit = (p) => path.resolve(String(p)) === payload;
  const denied = () => { throw Object.assign(new Error(`EACCES: permission denied, stat '${payload}'`), { code: 'EACCES' }); };
  const io = { ...h, fs: { ...h.fs,
    existsSync: (p) => (hit(p) ? false : h.fs.existsSync(p)),
    lstatSync: (p, ...a) => (hit(p) ? denied() : h.fs.lstatSync(p, ...a)),
    statSync: (p, ...a) => (hit(p) ? denied() : h.fs.statSync(p, ...a)),
  } };
  const c = pureCollectRun(r, { io });
  assert.match(Object.keys(c.refused).join(' '), /payload\.json/, `an unreadable payload.json read as absent: ${JSON.stringify(c.refused)}`);
  assert.ok(!JSON.stringify(c.refused).includes(r), 'the refusal carries an absolute path');
});

test('G-11: a nodes/ that is a link leading nowhere is refused, not read as an empty directory', (t) => {
  const r = run(t);
  fs.rmSync(path.join(r, 'nodes'), { recursive: true, force: true });
  const gone = path.join(path.dirname(r), 'gone');
  fs.mkdirSync(gone);
  fs.symlinkSync(gone, path.join(r, 'nodes'), process.platform === 'win32' ? 'junction' : 'dir');
  fs.rmSync(gone, { recursive: true, force: true });                   // the link now leads nowhere
  const c = collectRun(r, quiet);
  assert.ok(Object.keys(c.refused).includes('nodes'), `a dangling nodes/ read as empty: ${JSON.stringify(c.refused)}`);
});

// G-6, the class: every line of runSeed before its own try that can throw — a directory made, a file read or written,
// a parse — must be guarded on the line, or the benchmark's serial loop ends at the first failing seed.
test('G-6: nothing in a seed\'s setup, before its try, can throw', () => {
  const src = fs.readFileSync(path.join(REPO, 'scripts', 'bench-second-opinion.mjs'), 'utf8');
  const start = src.indexOf('async function runSeed(');
  const setup = src.slice(start, src.indexOf('\n  try {\n', start));
  assert.ok(start > 0 && setup.length > 0, 'runSeed not found');
  const risky = /fs\.(mkdtempSync|mkdirSync|readFileSync|writeFileSync|cpSync|rmSync|readdirSync)\(|JSON\.parse\(/;
  const unguarded = setup.split('\n').filter((l) => risky.test(l) && !/\btry \{/.test(l) && !/^\s*\/\//.test(l));
  assert.deepEqual(unguarded, [], 'setup that can throw before the seed\'s try');
});

// G-9: the catch records what the seed already knew, not only the refusal that ended it.
test('G-9: a seed that throws late keeps the node refusals it had already collected', () => {
  const src = fs.readFileSync(path.join(REPO, 'scripts', 'bench-second-opinion.mjs'), 'utf8');
  const start = src.indexOf('async function runSeed(');
  // runSeed ends before the serial loop that calls it (re-anchored when that loop gained its own catch, ssr-review-r5).
  const body = src.slice(start, src.indexOf('await runSeed(c)', start));
  const catchAt = body.lastIndexOf('} catch (err) {');
  const push = body.slice(catchAt, body.indexOf('say(`NOT RUN', catchAt));
  assert.match(push, /knownRefused/, 'the late catch drops the refusals collected before it');
});
