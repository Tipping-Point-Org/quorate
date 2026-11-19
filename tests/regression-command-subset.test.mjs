// THE COMMAND-STRING SUBSET (capture-interactive.plan.md stage 4; ROADMAP.md M2 item 7; the operator's decisions of
// 2026-10-19 and 2026-11-15 recorded in the plan). scripts/lib/command-subset.mjs parses with the vendored unbash and
// decides what is inside. The probes are the handover's (H#L637-L647) and the stage-1 bench's: each in-subset string
// yields the plan capture will run, and each out-of-subset construct is refused by name, never read as plain words.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyCommand } from '../scripts/lib/command-subset.mjs';

const lit = (...s) => ({ parts: s.map((literal) => ({ literal })) });
const argvOf = (plan, i = 0) => plan.stages[i].argv.map((w) => w.parts.map((p) => p.literal ?? '<subst>').join(''));
const ok = (src) => {
  const r = classifyCommand(src);
  assert.equal(r.ok, true, `${JSON.stringify(src)} was refused: ${JSON.stringify(r.refusals)}`);
  return r.plan;
};

test('quoting: a pipe inside double quotes, single quotes or after a backslash is a literal, not a stage', () => {
  assert.deepEqual(argvOf(ok('echo "a | b"')), ['echo', 'a | b']);
  assert.deepEqual(argvOf(ok("echo 'c | d'")), ['echo', 'c | d']);
  const p = ok('echo e \\| f');
  assert.equal(p.stages.length, 1);
  assert.deepEqual(argvOf(p), ['echo', 'e', '|', 'f']);
});

test('comments start only at a word, and double-quote escapes are decoded', () => {
  assert.deepEqual(argvOf(ok('echo a#b')), ['echo', 'a#b']);
  assert.deepEqual(argvOf(ok('echo g # c')), ['echo', 'g']);
  assert.deepEqual(argvOf(ok('echo "x\\\\y \\"q\\""')), ['echo', 'x\\y "q"']);
  assert.deepEqual(argvOf(ok(`a 'q'b"c"`)), ['a', 'qbc']);
});

test('pipelines and the redirections the subset admits', () => {
  assert.equal(ok('a | b | c').stages.length, 3);
  assert.deepEqual(ok('echo h >/dev/null 2>&1').stages[0].redirects,
    [{ fd: 1, op: '>', target: lit('/dev/null') }, { fd: 2, op: 'dup', target: 1 }]);
  assert.deepEqual(ok('cat < in.txt > out.txt').stages[0].redirects,
    [{ fd: 0, op: '<', target: lit('in.txt') }, { fd: 1, op: '>', target: lit('out.txt') }]);
  assert.deepEqual(ok('a 2>err >>log').stages[0].redirects,
    [{ fd: 2, op: '>', target: lit('err') }, { fd: 1, op: '>>', target: lit('log') }]);
});

test('"$( )" inside double quotes is a substitution, nested ones too; the pipe beside it stays literal', () => {
  const p = ok('echo "subst=$(echo yes) pipe=| literal"');
  const parts = p.stages[0].argv[1].parts;
  assert.equal(parts[0].literal, 'subst=');
  assert.deepEqual(argvOf(parts[1].subst), ['echo', 'yes']);
  assert.equal(parts[2].literal, ' pipe=| literal');
  const deep = ok('echo "$(echo "$(echo deep)")"').stages[0].argv[1].parts[0].subst;
  assert.deepEqual(argvOf(deep.stages[0].argv[1].parts[0].subst), ['echo', 'deep']);
});

// Every construct outside the subset, with the words its refusal must carry.
const REFUSED = [
  ['echo $(echo deep)', /unquoted substitution/],
  ['echo `echo inner`', /backtick/],
  ['echo "x`y`"', /backtick/],
  ['a && b', /&&/], ['a || b', /\|\|/], ['a ; b', /;/], ['a &', /`&`/], ['! a', /`!`/],
  ['for x in a; do echo x; done', /for/], ['if true; then a; fi', /if/], ['(a)', /subshell/], ['{ a; }', /bracegroup/],
  ['f() { a; }', /function/], ['[[ a ]]', /\[\[ \]\]/],
  ['echo $VAR', /parameter expansion/], ['echo "$VAR"', /parameter expansion/], ['echo ${X}', /parameter expansion/],
  ['echo $?', /parameter expansion/],
  ['echo *.js', /glob/], ['a ~/x', /tilde/],
  ["echo $'tab\\t'", /ANSI-C/], ['echo $((1+2))', /arithmetic/],
  ['true |& cat', /\|&/], ["cat <<< 'x'", /here-string/], ['cat <<EOF\nbody\nEOF', /here-document/], ['cat <(ls)', /process substitution/],
  ['A=1 b', /assignment/], ['arr=(a b)', /assignment/], ['a &> f', /redirection/],
];

for (const [src, words] of REFUSED) {
  test(`refused, and named: ${JSON.stringify(src)}`, () => {
    const r = classifyCommand(src);
    assert.equal(r.ok, false, `${JSON.stringify(src)} was admitted as ${JSON.stringify(r.plan)}`);
    const said = r.refusals.map((x) => `${x.construct}: ${x.why}`).join(' | ');
    assert.match(said, words, `${JSON.stringify(src)}: the refusal does not name it: ${said}`);
    assert.ok(r.refusals.every((x) => x.why && x.why.length > 10), `a refusal without its reason: ${said}`);
  });
}

test('an empty string and one the parser rejects are refused, not admitted as nothing', () => {
  assert.equal(classifyCommand('').ok, false);
});

// unbash RECOVERS from a syntax error and lists it in `errors`; its recovered words are a guess, and were admitted as a
// plain command before this check (measured 2026-11-15 while writing this file).
for (const src of ['echo "unterminated', "echo 'x", 'echo $(a', 'echo "a $(b"']) {
  test(`a string the parser recovered from is refused: ${JSON.stringify(src)}`, () => {
    const r = classifyCommand(src);
    assert.equal(r.ok, false, `${JSON.stringify(src)} was admitted as ${JSON.stringify(r.plan)}`);
    assert.match(r.refusals.map((x) => x.construct).join(' '), /syntax error/);
  });
}
