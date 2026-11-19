// G-9 of review 20261019-053230-review-review (panel-codex-security, panel-codex-code): resolveCitation checked lexical
// containment and existence only. A directory (`{file: '.'}`) or an in-repository link to a file outside the repository
// resolved, and could keep an `observed` grade or a `dissolved` verdict with no real evidence behind it; with `lines`,
// countLines read the external target. A citation must be a real FILE inside the repository after following links.
// Virtual io, because links cannot be created unprivileged on every machine this suite runs on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { applyClaimRules, resolveCitation } from '../scripts/lib/claim-check.mjs';

const ROOT = path.resolve('/virtual/repo');
const OUT = path.resolve('/elsewhere/secret.txt');
const FILE = path.join(ROOT, 'src', 'a.mjs');
const DIRS = new Set([ROOT, path.join(ROOT, 'src')]);
const LINK = path.join(ROOT, 'src', 'out.mjs');
const real = (p) => {
  const r = path.resolve(p);
  if (r === LINK) return OUT;
  if (r === FILE || DIRS.has(r)) return r;
  throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
};
const read = [];
const IO = { fs: {
  existsSync: (p) => { try { real(p); return true; } catch { return false; } },
  realpathSync: real,
  statSync: (p) => { const r = real(p); return { isFile: () => r === FILE || r === OUT, isDirectory: () => DIRS.has(r) }; },
  lstatSync: (p) => ({ isSymbolicLink: () => path.resolve(p) === LINK }),
  readFileSync: (p) => { read.push(real(p)); return 'one\ntwo\nthree\n'; },
} };
const at = (citation) => resolveCitation(citation, { repoRoot: ROOT, io: IO });

test('a real file inside the repository still resolves', () => {
  assert.equal(at({ file: 'src/a.mjs', lines: '' }).ok, true);
  assert.equal(at({ file: 'src/a.mjs', lines: '2-3' }).ok, true);
});

test('a directory is not a citation', () => {
  for (const file of ['.', 'src']) {
    const r = at({ file, lines: '' });
    assert.equal(r.ok, false, `${file} resolved as a citation`);
    assert.match(r.why, /not a file/);
  }
});

test('a link that resolves outside the repository is not a citation, and its target is not read', () => {
  read.length = 0;
  for (const lines of ['', '1']) {
    const r = at({ file: 'src/out.mjs', lines });
    assert.equal(r.ok, false, `a link out resolved (lines ${JSON.stringify(lines)})`);
    assert.match(r.why, /outside the repository/);
  }
  assert.ok(!read.includes(OUT), 'countLines read the file outside the repository');
});

test('an observed claim cited only to a directory is recomputed as inferred', () => {
  const c = {
    id: 'C1', text: 'the lock loop spins', kind: 'defect', grade: 'observed', verdict: 'dissolved',
    search: { looked_for: 'x', where: ['.'], found: 'y' }, citations: [{ file: '.', lines: '' }],
    counter_question: { question: 'q?' },
  };
  const applied = applyClaimRules({ claims: [c], not_checked: [] }, { repoRoot: ROOT, io: IO }).claims[0];
  assert.equal(applied.grade, 'inferred');
  assert.equal(applied.verdict, 'downgrade');
});
