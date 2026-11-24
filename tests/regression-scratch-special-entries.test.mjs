// G-3 of 20261122-204359-llo-remediation-review (panel-codex-code): moveScratchIntoRecord's walk handled links,
// directories and regular files, and any other entry (a FIFO, a socket, a device node) was neither refused nor copied,
// so the move succeeded without it and then removed the scratch: the entry was lost and the move reported success. A
// scratch holding such an entry is now refused whole, the scratch kept. Only a POSIX host can make a socket file; on any
// other the test skips by name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { runDecision } from '../scripts/io/decision-run.mjs';
import { restorePreflightEvidence, preflightEvidenceDir } from '../scripts/io/preflight-cache.mjs';
import { confined } from '../scripts/io/confined-path.mjs';

const ask = (extra) => runDecision({ grounding: { floor: 'convention', basisOf: () => 'convention' },
  question: { question: 'q', options: [{ label: 'A' }, { label: 'B' }] }, seed: 'x', seats: ['s1'],
  context: '', caps: { cap: 1, hardCap: 1 }, runModerator: async () => null, ...extra });

// A socket file at `at` (a POSIX host only: win32 listens on named pipes, not files).
async function socketAt(t, at) {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(at, resolve); });
  t.after(() => server.close());
  return server;
}

test('G-3: a seat scratch holding a socket is refused whole, the scratch kept and nothing copied', async (t) => {
  if (process.platform === 'win32') { t.skip('this platform makes no socket file (a path listens as a named pipe), so the special-entry check did not run'); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsx-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'scratch'));
  const outcome = ask({ recordDir: path.join(root, 'rec'), scratchRoot: path.join(root, 'scratch'),
    runSeat: async (s, p, r, scratch) => {
      fs.writeFileSync(path.join(scratch, 'a.txt'), 'ok');
      await socketAt(t, path.join(scratch, 's.sock'));
      return null;
    } });
  const err = await outcome.then(() => null, (e) => e);
  assert.ok(err, 'the move reported success over an entry it did not copy');
  assert.match(String(err?.message), /not a regular file/);
  assert.equal(fs.existsSync(path.join(root, 'rec', 'evidence-r1-s1', 'a.txt')), false, 'part of a refused scratch was copied');
  assert.equal(fs.existsSync(path.join(root, 'scratch', 'r1-s1', 's.sock')), true, 'the scratch holding the socket was deleted');
});

// The same rule in the pre-flight cache's restore walk, which removes the run's old evidence once the walk passes: an
// entry that is not a regular file, a directory or a link was dropped and the restore went on. `cacheFs` is the walk's
// seam, so this runs on every host.
test('G-3: the pre-flight restore refuses a cached entry that is not a regular file, and keeps the run\'s evidence', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dsx-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const reviews = path.join(base, 'reviews');
  const run = path.join(base, 'run');
  const hash = '7'.repeat(64);
  const src = preflightEvidenceDir(reviews, hash);
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'a.log'), 'cached\n');
  fs.writeFileSync(path.join(src, 'fifo'), '');
  fs.mkdirSync(path.join(run, 'evidence', 'pre-flight'), { recursive: true });
  fs.writeFileSync(path.join(run, 'evidence', 'pre-flight', 'old.log'), 'old\n');
  const special = path.join(src, 'fifo');
  const cacheFs = { ...fs, lstatSync: (p) => {
    const st = fs.lstatSync(p);
    return p === special ? Object.assign(Object.create(Object.getPrototypeOf(st)), st, { isFile: () => false, isDirectory: () => false, isSymbolicLink: () => false, isFIFO: () => true }) : st;
  } };
  assert.throws(() => restorePreflightEvidence(reviews, hash, confined(run), { cacheFs }), /not a regular file/);
  assert.equal(fs.readFileSync(path.join(run, 'evidence', 'pre-flight', 'old.log'), 'utf8'), 'old\n',
    'the run\'s evidence was removed for a restore that dropped an entry');
});

test('a scratch of files and folders is still moved whole', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsx-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'scratch'));
  await ask({ recordDir: path.join(root, 'rec'), scratchRoot: path.join(root, 'scratch'),
    runSeat: async (s, p, r, scratch) => { fs.mkdirSync(path.join(scratch, 'd')); fs.writeFileSync(path.join(scratch, 'd', 'a.txt'), 'ok'); return null; } });
  assert.equal(fs.readFileSync(path.join(root, 'rec', 'evidence-r1-s1', 'd', 'a.txt'), 'utf8'), 'ok');
  assert.equal(fs.existsSync(path.join(root, 'scratch', 'r1-s1')), false);
});
