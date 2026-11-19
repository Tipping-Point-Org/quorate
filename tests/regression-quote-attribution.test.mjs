// A quotation attributed to a person must exist, verbatim, in the record.
//
// Found in the field, by the operator reading the page. blog/build-log.html states in its own
// method note that nothing on it is paraphrase; four of its eight quotations were wrong anyway:
//
//   * TWICE the assistant's own words were put in the operator's mouth. The operator writes turns
//     as `<context>: <reply>`, where the context is a phrase copied out of the assistant's
//     previous message. Reading the line naively attributes that phrase to them. The operator's
//     report was exact: "Clean answer looks like it was your answer."
//   * ONCE a quotation was lifted from a continuation SUMMARY — the assistant's account of an
//     earlier conversation — so it was never said by anyone.
//   * ONCE two separate turns were merged into a single block, and once a turn was dated a day early.
//
// The guarantee behind the page was "the assistant read it carefully", which is the exact shape
// this project rejects: a stated fact with no check behind it. check-quotes.mjs is the check.
//
// These tests pin the two properties that make it worth having. Both were confirmed RED against
// the real page before the checker was trusted: the misattribution case reproduces the operator's
// own finding, and the stitching case fails on a quotation assembled out of order.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SCRIPTS_DIR } from './helpers.mjs';

const CHECKER = path.join(SCRIPTS_DIR, 'check-quotes.mjs');

// Fixtures live under the repo's .sandbox/, not os.tmpdir(): scripts that confine themselves to
// the git root refuse a path outside it, and a fixture that only passes outside the tree tests a
// shape no caller has. (Learned when confinement broke ten capture tests at once.)
function fixture(pageHtml, digest) {
  const dir = fs.mkdtempSync(path.join(process.cwd(), '.sandbox', 'quotes-'));
  const digests = path.join(dir, 'sessions');
  fs.mkdirSync(digests, { recursive: true });
  fs.writeFileSync(path.join(digests, '2026-09-01.md'), digest, 'utf8');
  const page = path.join(dir, 'page.html');
  fs.writeFileSync(page, pageHtml, 'utf8');
  return { dir, page, digests };
}

const run = (page, digests) => spawnSync(
  process.execPath, [CHECKER, '--page', page, '--digests', digests],
  { encoding: 'utf8' },
);

const say = (text) => `<div class="said"><span class="who">Project owner</span><p>${text}</p></div>`;

test('regression: a quotation present in the record passes', () => {
  const f = fixture(say('audit should use the same proccess review does'),
    '> audit should use the same proccess review does\n');
  const r = run(f.page, f.digests);
  assert.equal(r.status, 0, r.stderr);
  fs.rmSync(f.dir, { recursive: true, force: true });
});

test("regression: the assistant's own words quoted back are refused", () => {
  // THE FIELD DEFECT. `Clean answer:` is the assistant's phrase; the operator only typed what
  // follows the colon. The digest holds the operator's half alone, so the merged line is absent.
  const f = fixture(say('Clean answer: audit should use the same proccess review does'),
    '> audit should use the same proccess review does\n');
  const r = run(f.page, f.digests);
  assert.equal(r.status, 1, 'a quoted-back assistant prefix must fail the check');
  assert.match(r.stderr, /not in the record/);
  fs.rmSync(f.dir, { recursive: true, force: true });
});

test('regression: whitespace differences are not misquotes', () => {
  // The operator's own note: "when the text is about 2 lines, xxxx\nyyyy it'll show as xxxx yyyy
  // (number of space may vary)". Line wrapping must not be reported as a fabricated quotation, or
  // the checker cries wolf and stops being read.
  const f = fixture(say('alpha beta\n   gamma'), '> alpha  beta gamma\n');
  const r = run(f.page, f.digests);
  assert.equal(r.status, 0, r.stderr);
  fs.rmSync(f.dir, { recursive: true, force: true });
});

test('regression: an elision may shorten a quotation but may not reorder it', () => {
  const digest = '> alpha beta gamma\n\n> delta epsilon zeta\n';
  const honest = fixture(say('alpha beta…delta epsilon'), digest);
  assert.equal(run(honest.page, honest.digests).status, 0);
  fs.rmSync(honest.dir, { recursive: true, force: true });

  // Same two fragments, reversed. Both appear in the record; the sentence does not. Without the
  // order check, `…` would license stitching any two remarks into a quotation nobody made.
  const stitched = fixture(say('delta epsilon…alpha beta'), digest);
  const r = run(stitched.page, stitched.digests);
  assert.equal(r.status, 1, 'fragments must be verified in order');
  fs.rmSync(stitched.dir, { recursive: true, force: true });
});

test('regression: a missing record fails loudly instead of passing vacuously', () => {
  // The digests are gitignored raw conversation, so a fresh checkout HAS none. Exiting 0 there
  // would report a guarantee that was never tested — the failure mode of the first attempt at a
  // G-13 test, which passed with its fix stashed.
  const f = fixture(say('anything at all'), '> anything at all\n');
  const r = run(f.page, path.join(f.dir, 'no-such-dir'));
  assert.equal(r.status, 2, 'absent evidence is not a pass');
  assert.match(r.stderr, /extract-sessions/, 'it must say how to regenerate the record');
  // G-3 of 20261023-205906-ger-delivery: on a machine with no ~/.claude/projects at all, extract-sessions listed that
  // directory inside its own diagnostic and died of an uncaught ENOENT instead. Inside this test, so the suite's count,
  // which CLAUDE.md states, is unchanged.
  const home = path.join(f.dir, 'home');
  fs.mkdirSync(home);
  const x = spawnSync(process.execPath, [path.join(SCRIPTS_DIR, 'extract-sessions.mjs'), '--out', path.join(f.dir, 'out')],
    { encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } });
  assert.equal(x.status, 1, `no transcripts is exit 1, with the diagnostic: ${x.stderr}`);
  assert.match(x.stderr, /extract-sessions: no transcript directory at/);
  assert.doesNotMatch(x.stderr, /ENOENT/);
  // G-4 of the same run: a record that does not parse (a truncated live transcript) was dropped in silence, so the digest
  // read as complete. It is counted and named.
  const proj = path.join(home, '.claude', 'projects', 'fixture');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 's.jsonl'), [JSON.stringify({ type: 'user', entrypoint: 'cli', timestamp: '2026-09-01T00:00:00Z',
    message: { role: 'user', content: 'hello' } }), '{"type":"user","mess', ''].join('\n'));
  const y = spawnSync(process.execPath, [path.join(SCRIPTS_DIR, 'extract-sessions.mjs'), '--project', 'fixture', '--out', path.join(f.dir, 'out')],
    { encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } });
  assert.equal(y.status, 0, y.stderr);
  assert.match(y.stderr, /1 unparseable record\(s\) skipped in s\.jsonl/, `a dropped record was not named: ${y.stderr}`);
  // G-2 of 20261023-214545-ger-remediation-review: a line not starting with `{` was dropped before the counter saw it, so a
  // malformed line went unnamed and a valid record with leading whitespace was lost. The valid one is read, the bad one counted.
  fs.writeFileSync(path.join(proj, 's.jsonl'), ['  ' + JSON.stringify({ type: 'user', entrypoint: 'cli', timestamp: '2026-09-01T00:00:00Z',
    message: { role: 'user', content: 'indented hello' } }), 'garbage', '{"type":"user","mess', ''].join('\n'));
  const z = spawnSync(process.execPath, [path.join(SCRIPTS_DIR, 'extract-sessions.mjs'), '--project', 'fixture', '--out', path.join(f.dir, 'out2')],
    { encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } });
  assert.equal(z.status, 0, z.stderr);
  assert.match(z.stderr, /2 unparseable record\(s\) skipped in s\.jsonl/, `a line not starting with { was dropped unnamed: ${z.stderr}`);
  const day = fs.readdirSync(path.join(f.dir, 'out2')).filter((n) => n.endsWith('.md')).map((n) => fs.readFileSync(path.join(f.dir, 'out2', n), 'utf8')).join('');
  assert.match(day, /indented hello/, 'a valid record with leading whitespace must be read');
  // G-1 and G-5 of the same run: a transcript directory that exists but cannot be listed threw a raw exception past `die`.
  const fileProj = path.join(home, '.claude', 'projects', 'notadir');
  fs.writeFileSync(fileProj, 'x');
  const w = spawnSync(process.execPath, [path.join(SCRIPTS_DIR, 'extract-sessions.mjs'), '--project', 'notadir', '--out', path.join(f.dir, 'out3')],
    { encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } });
  assert.equal(w.status, 1, `an unlistable transcript directory is exit 1, with the diagnostic: ${w.stderr}`);
  assert.match(w.stderr, /extract-sessions: cannot list/);
  const home2 = path.join(f.dir, 'home2');
  fs.mkdirSync(path.join(home2, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home2, '.claude', 'projects'), 'x');
  const v = spawnSync(process.execPath, [path.join(SCRIPTS_DIR, 'extract-sessions.mjs'), '--project', 'fixture', '--out', path.join(f.dir, 'out4')],
    { encoding: 'utf8', env: { ...process.env, HOME: home2, USERPROFILE: home2 } });
  assert.equal(v.status, 1, `an unlistable projects directory is exit 1, with the diagnostic: ${v.stderr}`);
  assert.match(v.stderr, /extract-sessions: no transcript directory at/);
  fs.rmSync(f.dir, { recursive: true, force: true });
});

test('regression: a page with no quotations is a broken selector, not a clean bill', () => {
  const f = fixture('<p>no quotations here</p>', '> anything\n');
  const r = run(f.page, f.digests);
  assert.equal(r.status, 2, 'finding nothing to check must not report success');
  fs.rmSync(f.dir, { recursive: true, force: true });
});
