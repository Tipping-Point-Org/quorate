// A PATH IN A BRIEF IS SHELL INPUT, and one of the three in the same command was not treated as it.
//
// The rendered evidence instruction carried the run directory raw:
//
//   node scripts/capture.mjs --run-dir C:\Users\someone\.quorate\reviews\...\20260924-004905 --node code-audit ...
//
// A POSIX shell eats each backslash as an escape, so capture.mjs receives a garbled relative path
// and exits 2 — the identical defect fixed in the sandbox canary hours earlier, one layer up and
// still live. Raised by `panel-codex-security` against run 20260924-004905-today-review as an
// OUT-OF-SCOPE observation: nobody had scoped run-graph's brief, so no lens was obliged to look.
//
// IT IS ONE LINE AND IT WAS ALREADY UNDERSTOOD. `capture_rel` and `detector_abs` in the same slot
// object both normalised separators, under a comment saying "one spelling in the brief is one thing
// to get right" — and `run_dir`, on the command between them, did not. Three independent copies of
// one rule is how two came to agree and the third to drift, which is why the fix is a single owner
// rather than a third copy.
//
// Impact is a wasted turn rather than a dead run: the archived brief below carries the bug and that
// run still produced 23 evidence logs, because a node whose first capture fails adapts. But a
// finding above LOW requires an evidence path, so the cost is paid in the one currency this system
// grades nodes on.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { briefArg } from '../scripts/lib/decisions.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BS = String.fromCharCode(92);   // a literal backslash, built rather than escaped

test('briefArg makes an argument safe for the shell a node happens to pick', () => {
  assert.equal(briefArg(`C:${BS}Users${BS}someone${BS}.quorate${BS}r-1`), '"C:/Users/someone/.quorate/r-1"');
  assert.equal(briefArg(`scripts${BS}capture.mjs`), '"scripts/capture.mjs"');
  // Idempotent, so a caller that already normalised is not punished for it.
  assert.equal(briefArg('C:/Users/someone/x'), '"C:/Users/someone/x"');
  // QUOTED TOO, not merely slashed. A username with a space is ordinary, and an unquoted path
  // containing one splits into two arguments in every shell.
  assert.equal(briefArg(`C:${BS}Users${BS}Ada Lovelace${BS}r`), '"C:/Users/Ada Lovelace/r"');
  assert.equal(briefArg(''), '""');
});

// AND NOT THE COMMAND HEADS. The first attempt at this fix routed all three paths on that command
// through the helper, which QUOTED the detector — and capture.mjs matches it as a PREFIX, so it
// refused the command outright and the mandatory §8 sweep became unrunnable. The repo's own
// regression-detector-path-resolved test caught it before it shipped.
//
// "Shell-safe" is two rules, not one: an argument wants quoting, a head matched by an allow-list
// must not be quoted at all. Applying the argument rule to a head is how a fix becomes a defect.
test('the run directory goes through briefArg, and the command heads deliberately do not', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  assert.ok(src.includes('run_dir: briefArg('), 'the argument is the path a shell can mangle');
  assert.ok(!src.includes('run_dir: runDir,'), 'the raw run directory is the defect');

  for (const head of ['capture_rel', 'detector_abs']) {
    assert.ok(!src.includes(`${head}: briefArg(`),
      `${head} is a command head matched as a prefix by an allow-list; quoting it changes the prefix`);
    const normalises = src.split('\n').some((l) => l.includes(`${head}:`) && l.includes('split(path.sep)'));
    assert.ok(normalises,
      `${head} must still normalise separators — one spelling in the brief is one thing to get right`);
  }
});

test('the archived brief that exposed it is kept as the before-state', (t) => {
  const brief = path.join(ROOT, '.claude', 'reviews', '20260924-004905-today-review',
    'nodes', 'code-audit-brief.md');
  if (!fs.existsSync(brief)) { t.skip('the run may be pruned; the rule above still holds'); return; }
  const line = fs.readFileSync(brief, 'utf8').split('\n').find((l) => l.includes('capture.mjs --run-dir'));
  assert.ok(line, 'the evidence instruction should be in the brief');
  // THE DEFECT, PRESERVED. A real brief that shipped a raw Windows path to every lens in the run —
  // the fixture rule this session kept paying to learn: build it FROM the artifact.
  assert.ok(new RegExp(`--run-dir [A-Za-z]:${BS}${BS}`).test(line),
    'the archived brief should still show the unquoted, backslashed path that caused this');
});

// ---------------------------------------- G-18: quoting is not escaping, and two shells disagree
// `panel-codex-code` and `panel-codex-security` raised this separately against run
// 20260924-021736-post-remediation, and the reconciler verified it in source: briefArg wrapped the
// path in double quotes and swapped separators, and escaped nothing.
//
//   $(whoami)  survives inside double quotes  -> command substitution
//   `id`       survives                       -> command substitution
//   a"b        TERMINATES THE QUOTE EARLY     -> a malformed --run-dir, or worse
//
// The brief is handed to a model that pastes it into a shell of its own choosing, so this is
// execution, not just a broken capture.
//
// ESCAPED WOULD BE WRONG. POSIX wants \$ and \` inside double quotes; PowerShell uses the backtick
// AS its escape character and would read \$ literally. One string cannot be correctly escaped for
// both, and inventing a two-shell scheme here would be a fresh source of the exact class of bug
// this helper was written to end.
//
// So it REFUSES. The run directory is MINTED by this engine — <home>/reviews/<key>/<stamp>-<slug> —
// and a shell-active character can only arrive through a hostile home or a crafted slug. Refusing
// loudly at brief-assembly beats emitting a command that might execute something.
test('briefArg refuses a path it cannot quote safely for every shell', () => {
  // THE APOSTROPHE WAS HERE AND SHOULD NOT HAVE BEEN (G-10). It is inert inside double quotes in
  // every shell, so refusing it only broke valid installations — /home/O'Brien could not start a
  // graph. Removed from the set, and the case below pins the corrected behaviour rather than
  // leaving this list to encode the mistake.
  for (const hostile of ['C:/Users/x/$(whoami)/r', 'C:/Users/x/`id`/r', 'C:/Users/x/a"b/r']) {
    assert.throws(() => briefArg(hostile), /cannot be quoted safely/,
      `${hostile} carries a shell-active character and must not reach a brief`);
  }
  assert.equal(briefArg("C:/Users/O'Brien/r"), `"C:/Users/O'Brien/r"`,
    'an apostrophe is neutralised by the quoting this helper already applies');
  // A newline would end the command and start another one.
  assert.throws(() => briefArg('C:/Users/x/a\nrm -rf/r'), /cannot be quoted safely/);

  // ORDINARY PATHS ARE UNAFFECTED, including the ones that motivated quoting in the first place.
  assert.equal(briefArg('C:/Users/Ada Lovelace/r'), '"C:/Users/Ada Lovelace/r"');
  assert.equal(briefArg('C:/Users/someone/.quorate/reviews/q-1/20260924-x'), '"C:/Users/someone/.quorate/reviews/q-1/20260924-x"');
  assert.equal(briefArg('scripts/capture.mjs'), '"scripts/capture.mjs"');
  // Parentheses and hyphens are not shell-active inside quotes and are common in real paths.
  assert.equal(briefArg('C:/Program Files (x86)/tool/x'), '"C:/Program Files (x86)/tool/x"');
});

// ------------------------------------- G-10: the refusal was broader than the danger it guards
// `panel-codex-code` and `panel-codex-security` against run 20260924-123916-verbatim-guards, and
// the reconciler noted they are the same model family — one opinion counted twice — then verified
// it in source anyway.
//
// An APOSTROPHE is inert inside double quotes in bash, PowerShell and cmd alike. It was in the
// hostile set with `$`, backtick, `"` and newline, which are not. So a perfectly ordinary home —
// /home/O'Brien, C:/Users/O'Brien — threw during brief assembly and the graph never started.
//
// A guard whose false positives break valid installations is not conservative; it is broken in the
// direction that looks responsible. The characters that stay are the ones that DO something inside
// double quotes: `$` and backtick expand, `"` terminates the quoting, and a newline ends the
// command and begins another.
test('an apostrophe is not hostile, because double quotes already neutralise it', () => {
  assert.equal(briefArg("C:/Users/O'Brien/r"), '"C:/Users/O\'Brien/r"');
  assert.equal(briefArg("/home/O'Brien/.quorate/reviews/q/20260924-x"), '"/home/O\'Brien/.quorate/reviews/q/20260924-x"');

  // AND THE REAL ONES STILL REFUSE.
  for (const hostile of ['C:/Users/x/$(whoami)/r', 'C:/Users/x/`id`/r', 'C:/Users/x/a"b/r', 'C:/x/a\nrm -rf/r']) {
    assert.throws(() => briefArg(hostile), /cannot be quoted safely/,
      `${JSON.stringify(hostile)} does something inside double quotes and must still refuse`);
  }
});
