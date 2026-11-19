// FORBIDDEN_TAIL is capture.mjs's whole node-containment boundary: it is what makes `git grep` and
// `git diff` safe to expose as the only sanctioned evidence channel. Hours before this was found,
// `git diff` and `git log` were REMOVED from the direct Bash grant precisely so they would go
// through this guard instead — which means this guard had just become more load-bearing, not less.
//
// The entry `/^-O/` matches only a token that STARTS with -O. But git's parse-options BUNDLES short
// flags, so `-nOcat` is `-n -O cat` and reaches --open-files-in-pager unexamined. git runs that
// pager through a SHELL (child.use_shell = 1 in builtin/grep.c run_pager), so the primitive is
// arbitrary command execution, not merely launching a named program — the '#' comment character in
// the demonstrated payload is what proves shell interpretation.
//
// security-audit demonstrated it live: the command exited 0 and wrote the contents of a file
// OUTSIDE the repository into the run's own evidence directory, through the channel whose header
// calls itself the containment boundary and names credential_exposure as one of its arms.
//
// The general lesson, which is why this is tested by SHAPE rather than by one string: a deny-list
// matching whole tokens cannot see a flag hiding inside a bundle.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forbiddenTailToken } from '../scripts/lib/forbidden-tail.mjs';

test('regression: a dangerous short flag BUNDLED with others is refused', () => {
  // The exact shape that got through.
  assert.ok(forbiddenTailToken('-nOcat'), '-nOcat bundles -O and must be refused');
  assert.ok(forbiddenTailToken('-inO/bin/sh'), 'position within the bundle must not matter');
  assert.ok(forbiddenTailToken('-O'), 'the bare flag stays refused');
  assert.ok(forbiddenTailToken('-Ocat'), 'the unbundled form stays refused');
});

// THE SAME DEFECT, ONE LAYER DOWN, in the module extracted to close it. The first fix decided
// what counted as a bundle with /^-[A-Za-z]/ — a LETTER after the dash — so a cluster opening with
// a DIGIT was returned non-forbidden with its characters never scanned. git grep declares
// OPT_NUMBER_CALLBACK (-<num> is shorthand for -C NUM) and parse_short_opt keeps parsing the SAME
// token after consuming the digits, so `-2Ocat` is `-2 -O cat` and reaches --open-files-in-pager,
// which run_pager launches with child.use_shell = 1.
//
// Demonstrated live by the lens, twice: `-nOecho` was correctly refused while
// `-2Oecho PWNED_BY_NUMERIC_BUNDLE` exited 0 and printed the string, and a second capture wrote
// C:/Windows/win.ini — outside the repository — into that run's own evidence directory at exit 0.
//
// The lesson is about the shape of the guard, not the character class: deciding WHETHER to scan
// from the first character means every unanticipated opener is a bypass. Scan any single-dash
// token.
test('regression: a digit-opening bundle is scanned too (git -<num> is a real flag)', () => {
  assert.ok(forbiddenTailToken('-2Ocat'), '-2Ocat is -2 -O cat and must be refused');
  assert.ok(forbiddenTailToken('-12Oecho'), 'multi-digit counts bundle the same way');
  assert.ok(forbiddenTailToken('-2Oecho PWNED'), 'the exact demonstrated payload');
  assert.ok(forbiddenTailToken('-5nOcat'), 'digits and letters mixed in one cluster');
});

test('a single-dash token is scanned whatever it opens with', () => {
  // Written as a PROPERTY: the previous fix enumerated openers and missed one. Anything after a
  // single dash is a short-flag cluster as far as this guard is concerned.
  for (const t of ['-O', '-2O', '-_O', '-.O']) {
    assert.ok(forbiddenTailToken(t), `${t} contains a bundled -O and must be refused`);
  }
});

test('digit-only and ordinary short flags still pass', () => {
  // git grep -2 is a legitimate context shortcut; over-refusing it would break real captures.
  for (const t of ['-2', '-12', '-n', '-in', '-5n']) {
    assert.equal(forbiddenTailToken(t), false, `${t} is legitimate and must pass`);
  }
});

test('the long-form escapes stay refused', () => {
  for (const t of ['--open-files-in-pager', '--output=/tmp/x', '--ext-diff', '--textconv',
                   '--no-index', '--contents=/etc/passwd', '--upload-pack=x']) {
    assert.ok(forbiddenTailToken(t), `${t} must be refused`);
  }
});

// G-6 of 20261023-040306-rdt-remediation-2-review: `git blame --ignore-revs-file <path>` and `git ls-files
// --exclude-from=<path>` read a file at any path, the read-outside family, and passed the tail check. Their safe neighbours
// (`--ignore-rev <rev>`, `--exclude=<pattern>`) are exact names git resolves before any abbreviation, and stay admitted.
test('flags that read a file at a caller-chosen path are refused, their exact neighbours are not', () => {
  for (const t of ['--ignore-revs-file', '--ignore-revs-file=/etc/passwd', '--ignore-revs', '--exclude-from=/etc/passwd']) {
    assert.ok(forbiddenTailToken(t), `${t} must be refused`);
  }
  for (const t of ['--ignore-rev', '--ignore-rev=HEAD', '--exclude=*.log', '--exclude-standard']) {
    assert.equal(forbiddenTailToken(t), false, `${t} is legitimate and must pass`);
  }
});

test('ordinary arguments and safe short flags still pass', () => {
  // Over-refusing would break every legitimate capture, which is its own kind of failure: a lens
  // that cannot produce evidence stops emitting findings and reads as a weak reviewer.
  for (const t of ['-n', '-i', '-in', 'FORBIDDEN_TAIL', '--', 'scripts/capture.mjs',
                   'HEAD~1', '--name-only', '-e', 'pattern']) {
    assert.equal(forbiddenTailToken(t), false, `${t} is legitimate and must pass`);
  }
});

test('a long option is not treated as a short-flag bundle', () => {
  // "--Only" contains O but is a long option; bundling rules do not apply to it, and it is not one
  // of the named escapes.
  assert.equal(forbiddenTailToken('--name-Only'), false);
});
