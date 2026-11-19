// stopping-a-child-vocabulary.design.md (decided 2026-10-03: 1A, 2A, 3A) — ONE OWNER FOR WHAT A STOP SAYS. Three consecutive
// remediations each missed one of the places that turn a stop outcome into a status field or a sentence (D1's cap; G-1 of
// 20261003-020052, G-7/G-1 of 20261003-025056, G-7 of 20261003-032341). scripts/lib/stop-vocabulary.mjs owns both; this file
// renders every outcome in every context (2A), and a lock test refuses the fields and the outcome phrases anywhere else (3A),
// so the next drift fails a test instead of a review.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const vocab = await import('../scripts/lib/stop-vocabulary.mjs').catch(() => ({}));
const SCRIPTS = path.join(import.meta.dirname, '..', 'scripts');
const OWNER = 'lib/stop-vocabulary.mjs';
const CONTEXTS = ['node', 'orchestrator', 'gate-held', 'gate-recorded', 'captured', 'phrase'];

test('vocabulary: one owner exists, with the outcome clauses and stopRecord', () => {
  assert.equal(typeof vocab.stopRecord, 'function', 'nothing owns what a stop says');
  assert.equal(typeof vocab.UNCONFIRMED_CLAUSE, 'string');
  assert.equal(typeof vocab.REFUSED_CLAUSE, 'string');
  assert.deepEqual([...vocab.STOP_CONTEXTS].sort(), [...CONTEXTS].sort());
});

test('vocabulary: every context says an unconfirmed stop in the one clause, names the pid, never "accepted" or "killed"', () => {
  for (const context of CONTEXTS) {
    const { sentence } = vocab.stopRecord({ outcome: 'unconfirmed', pid: 4242, reason: 'timeout', context, recorded: 'unconfirmed' });
    assert.ok(sentence.includes(vocab.UNCONFIRMED_CLAUSE), `${context}: "${sentence}"`);
    assert.match(sentence, /4242/, `${context} does not name the process`);
    assert.doesNotMatch(sentence, /accepted|was killed/, `${context} claims a kill took effect: "${sentence}"`);
  }
});

test('vocabulary: every context says a refusal in the one clause and names the pid', () => {
  for (const context of CONTEXTS) {
    const { sentence } = vocab.stopRecord({ outcome: 'refused', pid: 5151, reason: 'timeout', context, recorded: 'refused' });
    assert.ok(sentence.includes(vocab.REFUSED_CLAUSE), `${context}: "${sentence}"`);
    assert.match(sentence, /5151/);
  }
});

test('vocabulary: the fields — a refusal keeps its reason, unconfirmed is flagged, both name the pid, an exit adds none', () => {
  assert.deepEqual(vocab.stopRecord({ outcome: 'refused', pid: 1, reason: 'interrupt', context: 'orchestrator' }).fields,
    { orphan_pid: 1, kill_refused: 'interrupt' });
  assert.deepEqual(vocab.stopRecord({ outcome: 'unconfirmed', pid: 2, reason: 'timeout', context: 'captured' }).fields,
    { orphan_pid: 2, kill_unconfirmed: true });
  assert.deepEqual(vocab.stopRecord({ outcome: 'exited', pid: 3, reason: 'timeout', context: 'node' }).fields, {});
});

// G-1 of 20261003-052823-stop-child-vocabulary-confirm-2 (doc-consistency-review and panel-codex-docs): A-25 said every stop
// sentence is built "from one clause per outcome", while the recorded-pid sentences ("no longer answers", "recorded no
// outcome") are built in the owner without one. The promise is one PLACE, which the lock holds; the documents say that.
test('G-1: A-25 and CLAUDE.md promise one place for what a stop says — not one clause per outcome', () => {
  for (const doc of ['ARCHITECTURE.md', 'CLAUDE.md']) {
    const text = fs.readFileSync(path.join(import.meta.dirname, '..', doc), 'utf8');
    assert.doesNotMatch(text, /one clause per outcome/, `${doc} still promises one clause per outcome`);
  }
});

test('vocabulary: A-25 names the owner, and the owner it names exists', () => {
  const arch = fs.readFileSync(path.join(import.meta.dirname, '..', 'ARCHITECTURE.md'), 'utf8');
  const a25 = arch.slice(arch.indexOf('### A-25'), arch.indexOf('## 7.'));
  assert.match(a25, /`scripts\/lib\/stop-vocabulary\.mjs`/, 'A-25 does not say who owns what a stop says');
  assert.ok(fs.existsSync(path.join(SCRIPTS, 'lib', 'stop-vocabulary.mjs')));
});

test('vocabulary: a context or outcome it does not know is refused, not rendered as something', () => {
  assert.throws(() => vocab.stopRecord({ outcome: 'unconfirmed', pid: 1, context: 'somewhere' }), /context/);
  assert.throws(() => vocab.stopRecord({ outcome: 'stopped', pid: 1, context: 'node' }), /outcome/);
});

// --------------------------------------------------------------------------------------------- the lock (3A)
// Comments excluded, as in stage 4b's single-owner test: they name the history. A READ of a field (`s.orphan_pid`,
// `own.kill_refused`) is allowed; a WRITE — an object key or an assignment — and the outcome clauses in a string are not.
function code(src) {
  return src.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
}
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.m?js$/.test(e.name) ? [p] : [];
  });
}
const FILES = walk(SCRIPTS).map((f) => ({ file: path.relative(SCRIPTS, f).split(path.sep).join('/'), src: code(fs.readFileSync(f, 'utf8')) }));
const hits = (re) => FILES.filter(({ file }) => file !== OWNER).flatMap(({ file, src }) =>
  src.split('\n').flatMap((l, i) => (re.test(l) ? [`${file}:${i + 1}`] : [])));

// The two patterns the lock holds the tree to. WIDENED (G-15, G-14 of 20261003-041945-stop-child-vocabulary-review): the
// clause pattern knew only the refused and unconfirmed phrases, so "process tree killed", "killed by orchestrator" and
// "stopped its child" — a stop worded outside the owner, the last two false for a survivor — passed it.
const FIELD_WRITE = /(\b|\.)(orphan_pid|kill_refused|kill_unconfirmed)\s*(:(?!:)|=(?!=))/;
// "killed by orchestrator", not "killed by": spawn-node's "killed by signal N" reports how the child ENDED (an exit status),
// and capture's "killed by capture" is the synchronous child design §5 leaves to spawnSync — neither is a stop this owner words.
const OUTCOME_WORDS = /not seen to exit|refused to be killed|was accepted but|kill was refused|tree killed|killed by orchestrator|stopped its child|exited after its stop/;

// THE LOCK BITES, IN THIS FILE (G-14): each form the lock must refuse, planted in synthetic source and run through the same
// comment stripping and the same patterns. A pattern that cannot match what it guards against fails here, not silently.
test('lock: the patterns catch every planted form, and a comment mentioning them is not a hit', () => {
  const planted = {
    'an object key': 'export const x = { kill_unconfirmed: true };',
    'an assignment': 'status.orphan_pid = 4;',
    'a refused write': "out.kill_refused = 'timeout';",
    'the unconfirmed clause': 'const s = `pid ${p} was not seen to exit after its stop`;',
    'the refused clause': "const s = 'it refused to be killed';",
    'a killed claim': "stderr += '[killed by orchestrator after 5ms]';",
    'a tree claim': "return 'process tree killed';",
    'a stopped claim': "push('the runner received SIGTERM and stopped its child');",
    'the exit clause': 'const s = `the child exited after its stop`;',
    'an accepted claim': "const s = 'the kill was accepted but nothing came';",
    'a refused claim': "const s = 'the kill was refused (pid 3)';",
  };
  for (const [what, line] of Object.entries(planted)) {
    const src = code(line);
    assert.ok(FIELD_WRITE.test(src) || OUTCOME_WORDS.test(src), `the lock does not catch ${what}: ${line}`);
  }
  // EVERY ALTERNATIVE IS PLANTED (G-10 of 20261003-045647-stop-child-vocabulary-confirm): the exit clause was added to the
  // pattern without a planted line, so removing it again would have left this test green. Each alternative of the pattern
  // must be exercised by some planted line, so the next phrase added to the lock cannot go unguarded either.
  for (const alt of OUTCOME_WORDS.source.split('|')) {
    const re = new RegExp(alt);
    assert.ok(Object.values(planted).some((line) => re.test(code(line))), `no planted line exercises the lock's /${alt}/`);
  }
  const commented = code("// the old text said 'process tree killed' and set kill_unconfirmed: true\nconst ok = 1;");
  assert.ok(!FIELD_WRITE.test(commented) && !OUTCOME_WORDS.test(commented), 'a comment about the history is read as a hit');
  // Reads are not writes.
  assert.ok(!FIELD_WRITE.test(code('if (s.orphan_pid && s.kill_refused === "timeout") go();')), 'a read is read as a write');
});

test('lock: no file but the owner writes orphan_pid, kill_refused or kill_unconfirmed', () => {
  const found = hits(FIELD_WRITE);
  assert.deepEqual(found, [], `a stop field is written outside ${OWNER}: ${found.join(', ')}`);
});

test('lock: no file but the owner words a stop outcome', () => {
  const found = hits(OUTCOME_WORDS);
  assert.deepEqual(found, [], `a stop outcome is worded outside ${OWNER}: ${found.join(', ')}`);
});

// G-8 (HIGH), G-6 and G-5 of 20261003-041945-stop-child-vocabulary-review: a SEEN exit is a stop outcome too, and it was
// worded in three places of their own — "process tree killed" (stopPhrase), "[killed by orchestrator]" (spawnCapture, for
// EVERY timed-out capture, the refused and unconfirmed survivors included), "stopped its child" (an interrupted node, even
// when its child survived). The owner words it, per context, and claims no kill the stop did not establish.
test('G-5/G-6: an interrupted node names the signal, then says its stop\'s outcome — never "stopped its child" for a survivor', async () => {
  const { recordRunOutcome, stopPhrase } = await import('../scripts/io/run-child.mjs');
  const base = { exitCode: null, timedOut: false, overflowed: false, spawnError: null };
  const refused = recordRunOutcome({ validator_errors: [] },
    { ...base, signal: 'SIGKILL-REFUSED', interrupted: 'SIGTERM', killRefused: 'interrupt', orphanPid: 9, exitUnconfirmed: false, killedTree: false });
  assert.ok(refused.validator_errors.some((e) => e.includes('SIGTERM')), 'the signal is not named');
  assert.ok(refused.validator_errors.some((e) => e.includes(vocab.REFUSED_CLAUSE)), 'the refusal is not said');
  assert.ok(!refused.validator_errors.some((e) => /stopped its child|was killed|killed by|tree killed/.test(e)), `a survivor is said to have been stopped: ${refused.validator_errors}`);
  const exited = recordRunOutcome({ validator_errors: [] },
    { ...base, signal: 'SIGTERM', interrupted: 'SIGTERM', killRefused: null, orphanPid: null, exitUnconfirmed: false, killedTree: true });
  assert.ok(exited.validator_errors.some((e) => e.includes(vocab.EXITED_CLAUSE)), `a seen exit is not said: ${exited.validator_errors}`);
  // stopPhrase's seen exit is the owner's too (G-6): it said "process tree killed" in words of its own.
  assert.ok(stopPhrase({ killedTree: true }).includes(vocab.EXITED_CLAUSE));
});

test('vocabulary: every context the run stopped words a seen exit, and claims no kill', () => {
  for (const context of CONTEXTS.filter((c) => c !== 'gate-recorded')) {
    const { sentence, fields } = vocab.stopRecord({ outcome: 'exited', pid: 6161, reason: 'timeout', context });
    assert.equal(typeof sentence, 'string', `${context} has no sentence for a seen exit`);
    assert.ok(sentence.includes(vocab.EXITED_CLAUSE), `${context}: "${sentence}"`);
    assert.doesNotMatch(sentence, /killed/, `${context} claims a kill: "${sentence}"`);
    assert.deepEqual(fields, {}, 'a seen exit adds no survivor fields');
  }
});

// G-8 of 20261003-045647-stop-child-vocabulary-confirm: a RECORDED pid is watched, never stopped (design 2A) — the run may
// not even hold the process the pid now names. "exited after its stop" claimed a stop the run never made.
test('G-8: a recorded pid that is gone is not said to have exited after a stop the run never made', () => {
  const { sentence } = vocab.stopRecord({ outcome: 'exited', pid: 7070, context: 'gate-recorded' });
  assert.ok(!sentence.includes(vocab.EXITED_CLAUSE), `a watched pid is said to have been stopped: "${sentence}"`);
  assert.match(sentence, /7070/);
  assert.match(sentence, /no longer answers/);
});

// G-9 of 20261003-045647-stop-child-vocabulary-confirm (flagged as G-13 a round earlier): a recorded pid whose node said
// nothing about its stop was worded as if the node had recorded an unconfirmed stop.
test('G-9: a recorded pid whose node recorded no outcome is said to have none, not an unconfirmed one', () => {
  const { sentence } = vocab.stopRecord({ outcome: 'unconfirmed', pid: 8080, context: 'gate-recorded', recorded: null });
  assert.doesNotMatch(sentence, /recorded that it/, `a record the node never made is claimed: "${sentence}"`);
  assert.match(sentence, /recorded no outcome/);
  assert.match(sentence, /8080/);
});
