// G-1 of 20261109-232630-dps-delivery: decide.mjs copied every untracked file git does not ignore (ls-files --others
// --exclude-standard) into the node-runtime seat's directory, where its vendor may read it, with no screen, so a scratch
// credentials file someone forgot to ignore went to a cloud model. An untracked file holding a token's shape (the shapes
// redaction applies, lib/secret-shapes.mjs) is now refused, named, and not copied; a tracked file is not screened.
//
// G-2, G-5, G-6, G-7 of 20261110-001436-dps-remediation-review: the screen was a list of the untracked files git does not
// ignore, so an IGNORED file a question cited (`.env`) was never screened (G-2), and a cited spelling cased unlike git's
// missed the list on a case-insensitive file system (G-7); only token shapes were screened, so a `password: "..."` file
// was copied (G-5); and a refused credential file spent the call's total copy budget, so a clean file after it was refused
// (G-6). The screen now passes only what git tracks, and screens everything else with every redaction shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { copyIntoSeatDir } from '../scripts/io/seat-copies.mjs';
import { confined } from '../scripts/io/confined-path.mjs';

// Built at run time, so no token's shape stands in this file for the secret scan to find.
const TOKEN = ['gh', 'p_', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'].join('');
const NAMED = ['pass', 'word: "', 'hunter2', 'hunter2"'].join('');

function fixture(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dps-screen-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repo = path.join(dir, 'repo');
  const home = path.join(dir, 'home');
  fs.mkdirSync(path.join(repo, 'scratch'), { recursive: true });
  fs.mkdirSync(path.join(home, 'seat'), { recursive: true });
  return { repo, home, owner: confined(home) };
}

test('an untracked file holding a token\'s shape is refused with why, and not copied; a clean one is', (t) => {
  const { repo, home, owner } = fixture(t);
  fs.writeFileSync(path.join(repo, 'scratch', 'creds.txt'), `token=${TOKEN}\n`);
  fs.writeFileSync(path.join(repo, 'scratch', 'notes.txt'), 'nothing secret here\n');
  fs.writeFileSync(path.join(repo, 'tracked.txt'), `a fixture with ${TOKEN}\n`);
  const r = copyIntoSeatDir({ repoRoot: repo, owner, segs: ['seat'],
    paths: ['scratch/creds.txt', 'scratch/notes.txt', 'tracked.txt'], tracked: ['tracked.txt'] });
  assert.ok(!fs.existsSync(path.join(home, 'seat', 'scratch', 'creds.txt')), 'an untracked credentials file was copied for the seat\'s vendor');
  assert.deepEqual(r.refused.map((x) => x.path), ['scratch/creds.txt']);
  assert.match(r.refused[0].why, /credential/);
  assert.deepEqual(r.copied, ['scratch/notes.txt', 'tracked.txt']);
});

test('G-2: an ignored file a question cites (.env) is screened like any file git does not track', (t) => {
  const { repo, home, owner } = fixture(t);
  fs.writeFileSync(path.join(repo, '.env'), `GITHUB_TOKEN=${TOKEN}\n`);
  const r = copyIntoSeatDir({ repoRoot: repo, owner, segs: ['seat'], paths: ['.env'], tracked: [] });
  assert.ok(!fs.existsSync(path.join(home, 'seat', '.env')), 'an ignored credentials file was copied for the seat\'s vendor');
  assert.deepEqual(r.refused.map((x) => x.path), ['.env']);
});

test('G-7: a cited spelling cased unlike git\'s is still screened on a case-insensitive file system', (t) => {
  const { repo, home, owner } = fixture(t);
  fs.writeFileSync(path.join(repo, 'scratch', 'creds.txt'), `token=${TOKEN}\n`);
  if (!fs.existsSync(path.join(repo, 'SCRATCH', 'CREDS.TXT'))) { t.skip('this file system is case-sensitive'); return; }
  const r = copyIntoSeatDir({ repoRoot: repo, owner, segs: ['seat'], paths: ['SCRATCH/CREDS.TXT'], tracked: ['tracked.txt'], caseInsensitive: true });
  assert.deepEqual(r.copied, [], 'a differently cased spelling of an untracked credentials file was copied unscreened');
  assert.deepEqual(r.refused.map((x) => x.path), ['SCRATCH/CREDS.TXT']);
});

test('G-7: a tracked file cited in another casing is passed where the file system folds case', (t) => {
  const { repo, owner } = fixture(t);
  fs.writeFileSync(path.join(repo, 'Tracked.txt'), `a fixture with ${TOKEN}\n`);
  if (!fs.existsSync(path.join(repo, 'TRACKED.TXT'))) { t.skip('this file system is case-sensitive'); return; }
  const r = copyIntoSeatDir({ repoRoot: repo, owner, segs: ['seat'], paths: ['tracked.txt'], tracked: ['Tracked.txt'], caseInsensitive: true });
  assert.deepEqual(r.copied, ['tracked.txt']);
});

test('G-5: an untracked file holding a named credential value is refused, not only a token\'s shape', (t) => {
  const { repo, home, owner } = fixture(t);
  fs.writeFileSync(path.join(repo, 'scratch', 'db.yml'), `${NAMED}\n`);
  const r = copyIntoSeatDir({ repoRoot: repo, owner, segs: ['seat'], paths: ['scratch/db.yml'], tracked: [] });
  assert.ok(!fs.existsSync(path.join(home, 'seat', 'scratch', 'db.yml')), 'a named credential value was copied for the seat\'s vendor');
  assert.deepEqual(r.refused.map((x) => x.path), ['scratch/db.yml']);
});

test('G-6: a refused credential file does not spend the total a clean file after it needs', (t) => {
  const { repo, owner } = fixture(t);
  fs.writeFileSync(path.join(repo, 'scratch', 'creds.txt'), `token=${TOKEN}\n`);
  fs.writeFileSync(path.join(repo, 'scratch', 'notes.txt'), `${'clean '.repeat(30)}\n`);
  const total = fs.statSync(path.join(repo, 'scratch', 'notes.txt')).size + 10;
  const r = copyIntoSeatDir({ repoRoot: repo, owner, segs: ['seat'], paths: ['scratch/creds.txt', 'scratch/notes.txt'], tracked: [], maxTotalBytes: total });
  assert.deepEqual(r.copied, ['scratch/notes.txt'], 'the clean file was refused for a budget the refused credential file spent');
});

test('decide.mjs passes what git tracks, and the file system\'s case rule, to the screen', () => {
  const src = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..', 'scripts', 'decide.mjs'), 'utf8');
  // Read NUL-delimited since G-1 of 20261110-010058-dps-remediation-2-review.
  assert.match(src, /gitOut\(\['ls-files', '-z'\]\)/, 'decide.mjs does not list what git tracks');
  assert.match(src, /tracked: trackedFiles, caseInsensitive: IO\.caseInsensitiveFs/, 'the seat copies are not screened against what git tracks');
});
