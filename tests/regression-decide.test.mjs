// autonomous-run.plan.md stage 5: scripts/decide.mjs, the one entry to the decision panel, and io/decision-run.mjs, its
// loop. Every seat here is a stub injected into runDecision, or the entry is refused before any seat is called: no
// reviewer and no model is reached from this file. What is held: each outcome (a round-1 majority, a majority after the
// moderator extended, no majority sending the question to a revote, no majority on the revote postponing it), a seat that
// fails is silence, the reserved and unknown categories refused flag on or off, the depth and the flag refused, the
// operator's overrule recorded and nothing redone, the attribution never the operator's, the work context built from four
// named fields only, the spend bound, and the session rules' reserved list written from its owner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runDecision, finalOutcome } from '../scripts/io/decision-run.mjs';
import { RESERVED_CATEGORIES, workContextText, panelAttribution, renderReservedRules } from '../scripts/lib/decision-panel.mjs';
import * as panel from '../scripts/lib/decision-panel.mjs';
import { writeRunState, clearRunState } from '../scripts/io/run-state.mjs';
import { newRunState } from '../scripts/lib/run-state.mjs';
import { builtinReviewers, defaultNodeRuntime, rawTable } from '../scripts/io/reviewers.mjs';
import { runScript, REPO_ROOT } from './helpers.mjs';

const Q = { question: 'Which bound?', options: [{ label: 'Size cap (Recommended)' }, { label: 'Age cap' }], category: 'delegable' };
const SEATS = ['s1', 's2', 's3'];
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const answer = (choice, extra = {}) => ({ status: 'ok', choice, rationale: `because ${choice}`, other_text: '', change_of: '', what_would_change: `if not ${choice}`, citations: [], ...extra });
/** A seat runner from a table: votes[round][seat] → the seat's raw answer; a function value is called. */
const seatsFrom = (votes) => async (seat, prompt, round) => {
  const v = votes[round]?.[seat];
  return typeof v === 'function' ? v(prompt) : v ?? null;
};

// The node-runtime seat runs in the repository, where the record lives. A reply written while another seat of the same
// round is still answering is a file that seat could read, and round 1 would not be blind (criterion 7).
test('no seat can see another seat\'s reply of the same round: replies reach the record after the round', async () => {
  const dir = tmp('decide-blind-');
  try {
    const seen = [];
    const late = (seat) => async () => {
      await new Promise((r) => setTimeout(r, seat === 's3' ? 30 : 0));
      seen.push(fs.readdirSync(dir).filter((f) => /^round-1-.*-reply\.json$/.test(f)));
      return answer('E1');
    };
    await runDecision({ grounding: { floor: 'convention', basisOf: () => 'convention' },
      question: Q, recordDir: dir, seed: 'x', seats: SEATS, context: '', caps: { cap: 3, hardCap: 6 },
      runSeat: (seat) => late(seat)(),
    });
    assert.deepEqual(seen, [[], [], []], 'a seat saw a reply file of its own round');
    assert.equal(fs.readdirSync(dir).filter((f) => /^round-1-.*-reply\.json$/.test(f)).length, 3);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// G-11 of 20261101-005402-ar-delivery: an external seat's evidence (its envelope, its answer) was written under the
// record as soon as that seat finished, where the node-runtime seat, still answering in the repository, could read it.
test('a seat\'s evidence is written outside the record during its round and reaches the record after the round', async () => {
  const dir = tmp('decide-scratch-');
  const scratchRoot = tmp('decide-scratch-root-');
  try {
    const seenInRecord = [];
    const scratches = [];
    await runDecision({ grounding: { floor: 'convention', basisOf: () => 'convention' },
      question: Q, recordDir: dir, seed: 'x', seats: SEATS, context: '', caps: { cap: 3, hardCap: 6 }, scratchRoot,
      runSeat: async (seat, prompt, round, scratch) => {
        scratches.push(scratch);
        if (seat !== 's3') fs.writeFileSync(path.join(scratch, `${seat}.json`), '{}');
        else {
          await new Promise((r) => setTimeout(r, 30));
          seenInRecord.push(fs.readdirSync(dir).filter((f) => f.startsWith('evidence-')));
        }
        return answer('E1');
      },
    });
    for (const s of scratches) {
      assert.ok(typeof s === 'string' && s, 'a seat is given no directory outside the record for its evidence');
      assert.ok(!path.resolve(s).startsWith(path.resolve(dir)), 'the seat\'s scratch is inside the record');
    }
    assert.deepEqual(seenInRecord, [[]], 'a peer\'s evidence reached the record while a seat of its round was answering');
    assert.ok(fs.existsSync(path.join(dir, 'evidence-r1-s1', 's1.json')), 'the evidence reaches the record after the round');
    assert.deepEqual(fs.readdirSync(scratchRoot), [], 'nothing is left in the scratch once moved');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(scratchRoot, { recursive: true, force: true }); }
});

test('a round-1 majority decides, and the record holds the blinded question, every prompt and reply, and the outcome', async () => {
  const dir = tmp('decide-maj-');
  try {
    const prompts = [];
    const { outcome } = await runDecision({ grounding: { floor: 'convention', basisOf: () => 'convention' },
      question: Q, recordDir: dir, seed: 'x', seats: SEATS, context: 'ctx', caps: { cap: 3, hardCap: 6 },
      runSeat: seatsFrom({ 1: { s1: (p) => { prompts.push(p); return answer('E1'); }, s2: answer('E1'), s3: answer('E2') } }),
      runModerator: async () => assert.fail('no moderator below the cap'),
    });
    assert.equal(outcome.outcome, 'majority');
    assert.equal(outcome.entry, 'E1');
    assert.equal(outcome.label, 'Size cap', 'the label is the blinded one');
    assert.doesNotMatch(prompts[0], /Recommended/i, 'a seat never sees the recommendation marker');
    for (const f of ['blinded.json', 'outcome.json', 'state.json', 'round-1-s1-prompt.md', 'round-1-s3-reply.json']) {
      assert.ok(fs.existsSync(path.join(dir, f)), f);
    }
    assert.equal(finalOutcome(dir).entry, 'E1');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('at the cap the moderator is asked, its extension runs one more round, and that round can decide', async () => {
  const dir = tmp('decide-mod-');
  try {
    let asked = 0;
    const split = { s1: answer('E1'), s2: answer('E2'), s3: null };
    const { outcome } = await runDecision({ grounding: { floor: 'convention', basisOf: () => 'convention' },
      question: Q, recordDir: dir, seed: 'x', seats: SEATS, context: '', caps: { cap: 2, hardCap: 3 },
      runSeat: seatsFrom({ 1: split, 2: split, 3: { s1: answer('E2'), s2: answer('E2'), s3: answer('E1') } }),
      runModerator: async (p) => { asked += 1; assert.match(p, /Round 2/); return { extend: true, reason: 'B is moving to E2' }; },
    });
    assert.equal(asked, 1);
    assert.deepEqual([outcome.outcome, outcome.entry, outcome.agreement, outcome.rounds], ['majority', 'E2', 'moderator-extended', 3]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('no majority sends the question to a revote; no majority on the revote postpones it; a failing seat is silence', async () => {
  const dir = tmp('decide-none-');
  try {
    const split = { s1: answer('E1'), s2: answer('E2'), s3: async () => { throw new Error('transport died'); } };
    // A seat that says it did not complete is silence even when its choice would have made a majority.
    const refused = { s1: answer('E1'), s2: answer('E2'), s3: answer('E1', { status: 'refused', reason: 'unsure' }) };
    const first = await runDecision({ grounding: { floor: 'convention', basisOf: () => 'convention' },
      question: Q, recordDir: dir, seed: 'x', seats: SEATS, context: '', caps: { cap: 1, hardCap: 1 },
      runSeat: seatsFrom({ 1: refused }), runModerator: async () => ({ extend: true, reason: 'r' }),
    });
    assert.equal(first.outcome.outcome, 'revote');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'round-1-s3-reply.json'), 'utf8')).result, null,
      'a seat that reported status refused casts no vote');
    const again = await runDecision({ grounding: { floor: 'convention', basisOf: () => 'convention' },
      question: Q, recordDir: path.join(dir, 'revote'), seed: 'x', seats: SEATS, context: 'note', caps: { cap: 1, hardCap: 1 },
      runSeat: seatsFrom({ 1: split }), runModerator: async () => assert.fail('the revote has no moderator'), phase: 'revote',
    });
    assert.equal(again.outcome.outcome, 'postponed');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'revote', 'round-1-s3-reply.json'), 'utf8')).result, null,
      'a seat whose call threw casts no vote');
    assert.equal(finalOutcome(dir).outcome, 'postponed', 'the revote\'s outcome is the decision\'s');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const writeQuestion = (dir, q) => { const f = path.join(dir, 'q.json'); fs.writeFileSync(f, JSON.stringify(q)); return f; };

test('the entry refuses every reserved category, a missing one and an unknown one, before reading any contract', () => {
  const dir = tmp('decide-cat-');
  try {
    for (const category of [...RESERVED_CATEGORIES, undefined, 'maybe']) {
      const r = runScript('decide.mjs', ['--question', writeQuestion(dir, { ...Q, category })]);
      assert.equal(r.status, 2, `${category}: ${r.output}`);
      assert.match(r.output, category === undefined ? /no category/ : category === 'maybe' ? /unknown category/ : /reserved for the operator/);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// The flag-off case runs against a fixture repository whose contract declares the panel off. It used this repository's
// own contract, which held `decision_panel: off` until autonomous-run.plan.md stage 9 turned it on (2026-11-05); from
// then the test asked the real panel, started the real Claude CLI and wrote into .claude/decisions here.
test('the entry refuses inside a graph node, and with the flag off', () => {
  const dir = tmp('decide-flag-');
  const { dir: repo } = repoWithDecision({ contract: '# t\n\n```yaml\ngraph_contract_version: 6\nproject: t\ncommands:\n'
    + '  build: ""\n  test: ""\nreview:\n  decision_panel: off\nui:\n  surface: none\n```\n' });
  try {
    const f = writeQuestion(dir, Q);
    const nested = runScript('decide.mjs', ['--question', f, '--repo-root', repo], { env: { GRAPH_NODE_DEPTH: '1' } });
    assert.equal(nested.status, 3);
    assert.match(nested.output, /graph node may not ask the decision panel/);
    const off = runScript('decide.mjs', ['--question', f, '--repo-root', repo]);
    assert.equal(off.status, 2, off.output);
    assert.match(off.output, /review\.decision_panel is off/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

/** A git repository with one decision already recorded, and optionally a contract. */
function repoWithDecision({ contract = null, outcome = { outcome: 'postponed' } } = {}) {
  const dir = tmp('decide-repo-');
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, '.gitignore'), '.claude/decisions/\n');
  if (contract) fs.writeFileSync(path.join(dir, 'CLAUDE.md'), contract);
  const id = '20261031-120000-abcdef';
  const rec = path.join(dir, '.claude', 'decisions', id);
  fs.mkdirSync(rec, { recursive: true });
  fs.writeFileSync(path.join(rec, 'question.json'), JSON.stringify(Q));
  fs.writeFileSync(path.join(rec, 'outcome.json'), JSON.stringify(outcome));
  git('add', '-A'); git('commit', '-qm', 'init');
  return { dir, id, rec };
}

test('--pending lists a postponed decision; --overrule records the operator\'s words and redoes nothing', () => {
  const { dir, id, rec } = repoWithDecision();
  try {
    const p = runScript('decide.mjs', ['--pending', '--repo-root', dir]);
    assert.equal(p.status, 0, p.output);
    assert.match(p.stdout, new RegExp(`${id}\\s+Which bound`));
    const noQuote = runScript('decide.mjs', ['--overrule', id, '--repo-root', dir]);
    assert.equal(noQuote.status, 2, 'only the operator reverses, so their words are required');
    const o = runScript('decide.mjs', ['--overrule', id, '--operator-quote', 'use the age cap', '--repo-root', dir]);
    assert.equal(o.status, 0, o.output);
    assert.equal(JSON.parse(fs.readFileSync(path.join(rec, 'overrule.json'), 'utf8')).operator_quote, 'use the age cap');
    assert.match(o.stdout, /nothing is redone/);
    assert.match(runScript('decide.mjs', ['--pending', '--repo-root', dir]).stdout, /0 postponed/, 'an overruled decision is no longer pending');
    assert.equal(runScript('decide.mjs', ['--overrule', '../x', '--operator-quote', 'q', '--repo-root', dir]).status, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const SPEND_CONTRACT = '# t\n\n```yaml\ngraph_contract_version: 6\nproject: t\ncommands:\n  build: ""\n  test: ""\n'
  + 'review:\n  run_spend_max: 1\nui:\n  surface: none\n```\n';
/** An engine home of its own, outside the repository, with the active run's state written as run-session writes it. */
function startRun(repo, home, startedAt) {
  writeRunState(repo, newRunState({ plan: '.claude/requests/p.plan.md', startedAt, limitHours: null }), { home });
}

test('--count-spend counts against review.run_spend_max and refuses at the bound', () => {
  const { dir, id } = repoWithDecision({ contract: SPEND_CONTRACT, outcome: { outcome: 'majority', entry: 'E1' } });
  const home = tmp('decide-home-');
  try {
    startRun(dir, home, Date.parse('2026-10-31T10:00:00Z'));
    const env = { QUORATE_HOME: home };
    const one = runScript('decide.mjs', ['--count-spend', id, '--repo-root', dir], { env });
    assert.equal(one.status, 0, one.output);
    assert.match(one.stdout, /spend 1 of 1/);
    const two = runScript('decide.mjs', ['--count-spend', id, '--repo-root', dir], { env });
    assert.equal(two.status, 4, two.output);
    assert.match(two.output, /run_spend_max \(1\) is reached/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); }
});

// G-3 of 20261101-005402-ar-delivery: the bound is per RUN. Counted per UTC day, a second run the same day found the
// first run's spends and was refused at its first spend, and a run crossing midnight had its count reset.
test('--count-spend counts per active run: a new run starts its own count, and no run is refused', () => {
  const { dir, id } = repoWithDecision({ contract: SPEND_CONTRACT, outcome: { outcome: 'majority', entry: 'E1' } });
  const home = tmp('decide-home-');
  try {
    const env = { QUORATE_HOME: home };
    startRun(dir, home, Date.parse('2026-10-31T10:00:00Z'));
    assert.equal(runScript('decide.mjs', ['--count-spend', id, '--repo-root', dir], { env }).status, 0);
    assert.equal(runScript('decide.mjs', ['--count-spend', id, '--repo-root', dir], { env }).status, 4, 'the first run is at its bound');
    startRun(dir, home, Date.parse('2026-10-31T11:00:00Z'));
    const next = runScript('decide.mjs', ['--count-spend', id, '--repo-root', dir], { env });
    assert.equal(next.status, 0, `a second run the same day shares no count with the first: ${next.output}`);
    clearRunState(dir, { home });
    const none = runScript('decide.mjs', ['--count-spend', id, '--repo-root', dir], { env });
    assert.equal(none.status, 2, `a spend outside any run is refused: ${none.output}`);
    assert.match(none.output, /no active run/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); }
});

// G-4: a spends record that cannot be read was taken as empty, and the next spend overwrote it.
test('--count-spend refuses a spends record it cannot read, and leaves it as it was', () => {
  const { dir, id } = repoWithDecision({ contract: SPEND_CONTRACT, outcome: { outcome: 'majority', entry: 'E1' } });
  const home = tmp('decide-home-');
  try {
    startRun(dir, home, Date.parse('2026-10-31T10:00:00Z'));
    const file = path.join(dir, '.claude', 'decisions', 'spends.json');
    fs.writeFileSync(file, '{"truncated": [');
    const r = runScript('decide.mjs', ['--count-spend', id, '--repo-root', dir], { env: { QUORATE_HOME: home } });
    assert.equal(r.status, 1, `a corrupt record is refused, not reset: ${r.output}`);
    assert.equal(fs.readFileSync(file, 'utf8'), '{"truncated": [', 'the record of earlier spends is untouched');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); }
});

// G-6: --revote read only the first outcome, so a second --revote overwrote a finished revote's record.
test('--revote is refused once the revote has an outcome', () => {
  const { dir, id, rec } = repoWithDecision({ outcome: { outcome: 'revote' } });
  try {
    fs.writeFileSync(path.join(rec, 'note.md'), 'note');
    fs.mkdirSync(path.join(rec, 'revote'));
    fs.writeFileSync(path.join(rec, 'revote', 'outcome.json'), JSON.stringify({ outcome: 'postponed' }));
    const r = runScript('decide.mjs', ['--revote', id, '--repo-root', dir]);
    assert.equal(r.status, 2, r.output);
    assert.match(r.output, /already revoted/, 'refused for the finished revote, not for some later reason');
    assert.equal(JSON.parse(fs.readFileSync(path.join(rec, 'revote', 'outcome.json'), 'utf8')).outcome, 'postponed');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// G-8: the seats were held distinct by reviewer id only, so two adapters of one family counted as two votes.
test('the panel\'s seats must be of distinct families, the runtime included, each family known', () => {
  assert.equal(typeof panel.seatFamilyErrors, 'function', 'decision-panel has no owner for the seats\' families');
  const table = { a: { family: 'one' }, b: { family: 'two' }, c: { family: 'three' }, a2: { family: 'one' },
    multi: { family: [{ model: 'x-', family: 'four' }] } };
  assert.equal(panel.seatFamilyErrors([{ reviewer: 'a' }, { reviewer: 'b' }, { reviewer: 'c' }], table), null);
  assert.match(panel.seatFamilyErrors([{ reviewer: 'a' }, { reviewer: 'b' }, { reviewer: 'a2' }], table), /same family.*one/);
  assert.match(panel.seatFamilyErrors([{ reviewer: 'a' }, { reviewer: 'b' }, { reviewer: 'multi', model: 'y' }], table), /no family/);
  assert.equal(panel.seatFamilyErrors([{ reviewer: 'a' }, { reviewer: 'b' }, { reviewer: 'multi', model: 'x-1' }], table), null);
  // The shipped panel passes: three families, the runtime's included.
  const shipped = builtinReviewers();
  const seats = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lens-roster.json'), 'utf8')).decision_panel.seats;
  assert.equal(panel.seatFamilyErrors([{ reviewer: defaultNodeRuntime(shipped, rawTable()), model: 'opus' }, ...seats], shipped), null);
});

// G-9: the seats' and the moderator's children were spawned raw, held by no stop owner, so an interrupted decide left
// them running with the operator's credentials (ARCHITECTURE A-25). Held as code-index's is: by its source.
test('decide registers every child it spawns with the stop-on-exit owner', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'decide.mjs'), 'utf8');
  assert.match(src, /stopHeldOnExit\(\{/, 'decide.mjs installs no stop-on-exit owner');
  assert.match(src, /live\.set\(key, child\)/, 'decide.mjs does not register the child it spawns');
  assert.match(src, /live\.delete\(key\)/, 'decide.mjs never lets go of a child that exited');
});

// G-7: a question's `since` reached `git diff` as written, so `--output=<path>` was an option, not a revision.
test('a question\'s since is refused when git would read it as an option, and is passed after --', () => {
  assert.equal(typeof panel.sinceGitArgs, 'function', 'decision-panel has no owner for how since reaches git');
  assert.throws(() => panel.sinceGitArgs('--output=/tmp/x'), /not a revision/);
  assert.throws(() => panel.sinceGitArgs('-p'), /not a revision/);
  assert.deepEqual(panel.sinceGitArgs('HEAD~2'), ['HEAD~2', '--']);
  assert.deepEqual(panel.sinceGitArgs(''), ['HEAD', '--']);
  assert.deepEqual(panel.sinceGitArgs(undefined), ['HEAD', '--']);
});

test('a delegated answer is attributed to the panel, never the operator', () => {
  assert.equal(panelAttribution('20261031-120000-abcdef'), 'decided by the panel (`20261031-120000-abcdef`)');
  assert.doesNotMatch(panelAttribution('x'), /operator|you/i);
});

test('the work context takes four named fields, so nothing else in a question file can reach a seat', () => {
  const q = { ...Q, transcript_path: 'C:/Users/u/.claude/projects/p/s.jsonl', conversation: 'the operator said keep it' };
  const text = workContextText({ ...q, request: '.claude/requests/x.plan.md', stage: 'Stage 5', diffStat: ' a | 1 +', files: ['a.mjs'] });
  assert.match(text, /x\.plan\.md/);
  assert.match(text, /Stage 5/);
  assert.match(text, /`a\.mjs`/);
  assert.doesNotMatch(text, /jsonl|projects|operator said/);
});

test('the session rules\' reserved list is written from its owner, and gen-rule-text --check finds it current', () => {
  const doc = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'session-rules.md'), 'utf8').split('\r\n').join('\n');
  assert.ok(doc.includes(`<!-- rule:reserved-decisions -->\n${renderReservedRules()}\n<!-- /rule:reserved-decisions -->`));
  for (const c of RESERVED_CATEGORIES) assert.ok(renderReservedRules().includes(`(\`${c}\`)`), c);
  const r = runScript('gen-rule-text.mjs', ['--check']);
  assert.equal(r.status, 0, r.output);
});
