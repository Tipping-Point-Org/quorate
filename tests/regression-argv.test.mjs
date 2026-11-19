// entrypoint-argv.plan.md stage 1: one parser for every entry script, over Node's util.parseArgs. The case table is one
// row per shape the plan names; every refusal names the flag, so a caller's die() can say which one was wrong.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgv, ArgvError } from '../scripts/lib/argv.mjs';

const SPEC = { options: { base: 'string', slug: 'string', 'full-sweep': 'list', 'mark-fixed': 'repeat', 'dry-run': 'boolean' } };

test('parseArgv: each shape the plan names, accepted or refused by name', () => {
  const ok = [
    ['a string value', ['--base', 'HEAD~2'], { base: 'HEAD~2' }],
    ['the = form, even for a value that starts with --', ['--base=--x'], { base: '--x' }],
    ['a boolean', ['--dry-run'], { 'dry-run': true }],
    ['a list with one value', ['--full-sweep', 'a'], { 'full-sweep': ['a'] }],
    ['a list with several values', ['--full-sweep', 'a', 'b', 'c'], { 'full-sweep': ['a', 'b', 'c'] }],
    ['a list followed by a flag', ['--full-sweep', 'a', 'b', '--dry-run'], { 'full-sweep': ['a', 'b'], 'dry-run': true }],
    ['a repeat flag once', ['--mark-fixed', 'k1'], { 'mark-fixed': ['k1'] }],
    ['a repeat flag twice', ['--mark-fixed', 'k1', '--mark-fixed', 'k2'], { 'mark-fixed': ['k1', 'k2'] }],
    // G-8 of 20261020-151402-argv-delivery: a list value starting with '-' takes the = form, as a string's does.
    ['a list value starting with - in the = form', ['--full-sweep=-x'], { 'full-sweep': ['-x'] }],
  ];
  for (const [why, argv, want] of ok) assert.deepEqual({ ...parseArgv(argv, SPEC).values }, want, why);
  const refused = [
    ['a missing value at the end', ['--base'], /--base needs a value/],
    ['a flag in a value\'s place', ['--base', '--slug', 'x'], /--base needs a value/],
    ['an unknown flag', ['--zzz'], /unknown flag --zzz/],
    ['a list with no value at the end', ['--full-sweep'], /--full-sweep needs at least one value/],
    ['a list with no value before a flag', ['--full-sweep', '--dry-run'], /--full-sweep needs at least one value/],
    ['a list whose value starts with - without =', ['--full-sweep', '-x'], /--full-sweep needs at least one value/],
    ['a list ending at a short flag', ['--full-sweep', 'a', '-x'], /unknown flag -x/],
    ['a string flag given twice', ['--slug', 'a', '--slug', 'b'], /--slug is given more than once/],
    ['a positional where none is allowed', ['stray'], /unexpected argument stray/],
  ];
  for (const [why, argv, re] of refused) {
    assert.throws(() => parseArgv(argv, SPEC), (e) => e instanceof ArgvError && re.test(e.message), why);
  }
});

test('parseArgv: passthrough keeps everything after -- untouched, flags included', () => {
  const r = parseArgv(['--run-dir', 'r', '--', 'node', '--test', 'x', '--zzz'], { options: { 'run-dir': 'string' }, passthrough: true });
  assert.equal(r.values['run-dir'], 'r');
  assert.deepEqual(r.rest, ['node', '--test', 'x', '--zzz']);
});

test('parseArgv: positionals when the spec allows them', () => {
  const r = parseArgv(['--needs', 'x', 'the', 'question'], { options: { needs: 'string' }, positionals: true });
  assert.deepEqual(r.positionals, ['the', 'question']);
});

test('parseArgv: a spec with an unknown type is a programming error, not a refusal', () => {
  assert.throws(() => parseArgv([], { options: { x: 'count' } }), (e) => !(e instanceof ArgvError) && /unknown type/.test(e.message));
});
