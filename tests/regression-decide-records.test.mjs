// Review 20261101-014615-ar-delivery-remediation-review, remediated in 20261101-021612-ar-remediation-2: what decide.mjs
// and its loop do to the records the operator and the panel leave. No seat and no model is reached from this file: every
// entry call below is refused or completes before the panel is asked, and runDecision runs with stub seats.
//   G-19: `--sample` took a required value, so the documented default size was never used.
//   G-12: a `since` git could not read gave the panel an empty work context, silently.
//   G-18: a seat's scratch was copied into the record with an unfiltered cpSync, links copied as links.
//   G-7, G-8: a second --overrule or --sample-mark replaced the operator's first words.
//   G-9: a spends record whose run value was not a list was counted as empty and overwritten.
//   G-23: nothing told the session to count a spend before starting it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runDecision } from '../scripts/io/decision-run.mjs';
import { blindQuestion } from '../scripts/lib/decision-panel.mjs';
import { writeRunState } from '../scripts/io/run-state.mjs';
import { newRunState } from '../scripts/lib/run-state.mjs';
import { runScript, REPO_ROOT } from './helpers.mjs';

const Q = { question: 'Which bound?', options: [{ label: 'Size cap' }, { label: 'Age cap' }], category: 'delegable' };
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

function repoWithDecision({ contract = null, outcome = { outcome: 'postponed' } } = {}) {
  const dir = tmp('decide-rec-');
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

test('G-19: a bare --sample uses the default size, and --size sets another', () => {
  const { dir } = repoWithDecision({ outcome: { outcome: 'majority', entry: 'E1', label: 'Size cap', agreement: '2 of 3' } });
  try {
    const bare = runScript('decide.mjs', ['--sample', '--repo-root', dir]);
    assert.equal(bare.status, 0, `a bare --sample is refused, so its default is never used: ${bare.output}`);
    assert.match(bare.stdout, /1 decision\(s\) to sample/);
    const sized = runScript('decide.mjs', ['--sample', '--size', '1', '--repo-root', dir]);
    assert.equal(sized.status, 0, sized.output);
    assert.equal(runScript('decide.mjs', ['--sample', '--size', '0', '--repo-root', dir]).status, 2, 'a size below 1 is refused');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('G-12: a since git cannot read as a commit is refused before anything else, never an empty work context', () => {
  const { dir } = repoWithDecision();
  try {
    const f = path.join(dir, 'q.json');
    fs.writeFileSync(f, JSON.stringify({ ...Q, since: 'no-such-revision-xyz' }));
    // The contract here has the panel off, so a since that is not checked first reaches the flag's refusal instead.
    const r = runScript('decide.mjs', ['--question', f, '--repo-root', dir]);
    assert.equal(r.status, 2, r.output);
    assert.match(r.output, /since .*no-such-revision-xyz.* is not a commit/, `the bad since was not named: ${r.output}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('G-18: a link in a seat\'s scratch is not carried into the record, and the real files are', async () => {
  const dir = tmp('decide-link-rec-');
  const scratchRoot = tmp('decide-link-scratch-');
  const outside = tmp('decide-link-outside-');
  try {
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside');
    await runDecision({ grounding: { floor: 'convention', basisOf: () => 'convention' },
      question: Q, recordDir: dir, seed: 'x', seats: ['s1', 's2', 's3'], context: '', caps: { cap: 1, hardCap: 1 }, scratchRoot,
      runSeat: async (seat, prompt, round, scratch) => {
        fs.writeFileSync(path.join(scratch, `${seat}.json`), '{}');
        if (seat === 's1') fs.symlinkSync(outside, path.join(scratch, 'lead'), 'junction');
        return { status: 'ok', choice: 'E1', rationale: 'r', other_text: '', change_of: '', what_would_change: 'w', citations: [] };
      },
      runModerator: async () => null,
    });
    const ev = path.join(dir, 'evidence-r1-s1');
    assert.ok(fs.existsSync(path.join(ev, 's1.json')), 'the seat\'s real evidence reaches the record');
    let st = null;
    try { st = fs.lstatSync(path.join(ev, 'lead')); } catch { /* absent, as it should be */ }
    assert.equal(st, null, 'a link from the seat\'s scratch was carried into the record');
    assert.ok(fs.existsSync(path.join(outside, 'secret.txt')), 'the link\'s target is untouched');
  } finally {
    for (const d of [dir, scratchRoot, outside]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('G-7: a second --overrule is refused and the operator\'s first words stay', () => {
  const { dir, id, rec } = repoWithDecision();
  try {
    assert.equal(runScript('decide.mjs', ['--overrule', id, '--operator-quote', 'first', '--repo-root', dir]).status, 0);
    const again = runScript('decide.mjs', ['--overrule', id, '--operator-quote', 'second', '--repo-root', dir]);
    assert.equal(again.status, 2, `a second overrule replaced the first: ${again.output}`);
    assert.equal(JSON.parse(fs.readFileSync(path.join(rec, 'overrule.json'), 'utf8')).operator_quote, 'first');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('G-8: a second --sample-mark is refused and the operator\'s first mark stays', () => {
  const { dir, id, rec } = repoWithDecision({ outcome: { outcome: 'majority', entry: 'E1' } });
  try {
    assert.equal(runScript('decide.mjs', ['--sample-mark', id, '--mark', 'agree', '--operator-quote', 'first', '--repo-root', dir]).status, 0);
    const again = runScript('decide.mjs', ['--sample-mark', id, '--mark', 'differ', '--operator-quote', 'second', '--repo-root', dir]);
    assert.equal(again.status, 2, `a second mark replaced the first: ${again.output}`);
    assert.equal(JSON.parse(fs.readFileSync(path.join(rec, 'sample.json'), 'utf8')).operator_quote, 'first');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const SPEND_CONTRACT = '# t\n\n```yaml\ngraph_contract_version: 6\nproject: t\ncommands:\n  build: ""\n  test: ""\n'
  + 'review:\n  run_spend_max: 1\nui:\n  surface: none\n```\n';

test('G-9: a spends record whose run value is not a list is refused, never counted as empty', () => {
  const { dir, id } = repoWithDecision({ contract: SPEND_CONTRACT, outcome: { outcome: 'majority', entry: 'E1' } });
  const home = tmp('decide-rec-home-');
  try {
    const startedAt = Date.parse('2026-10-31T10:00:00Z');
    const state = newRunState({ plan: '.claude/requests/p.plan.md', startedAt, limitHours: null });
    writeRunState(dir, state, { home });
    const file = path.join(dir, '.claude', 'decisions', 'spends.json');
    const before = JSON.stringify({ [`${state.plan}@${state.started_at}`]: { at: 'x' } });
    fs.writeFileSync(file, before);
    const r = runScript('decide.mjs', ['--count-spend', id, '--repo-root', dir], { env: { QUORATE_HOME: home } });
    assert.equal(r.status, 1, `a malformed run entry was counted as empty: ${r.output}`);
    assert.equal(fs.readFileSync(file, 'utf8'), before, 'the record of earlier spends is untouched');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); }
});

// G-21: the parenthesized markers were removed from option labels only, so a description or the question that carried
// "(Recommended)" or "(suggested)" reached every seat with the cue in it.
test('G-21: a recommendation marker is removed from the question and every description, not only the labels', () => {
  const b = blindQuestion({
    question: 'Which bound (suggested: the size cap)? Pick one (Recommended)',
    options: [
      { label: 'Size cap (Recommended)', description: 'Caps the cache by size (Recommended) — suggested' },
      { label: 'Age cap', description: 'Caps by age (suggested)' },
    ],
  });
  const all = [b.question, ...b.options.flatMap((o) => [o.label, o.description])].join('\n');
  assert.doesNotMatch(all, /recommended|suggested/i, `a cue reached the seats: ${all}`);
  assert.equal(b.options[0].description, 'Caps the cache by size', 'the substance of a description is kept');
});

// G-11: only a FINISHED revote was refused, so a second --revote started while one was running passed and wrote the same
// record. The running one is its directory, with no outcome yet.
test('G-11: a revote is refused while another holds the decision\'s revote directory', () => {
  const { dir, id, rec } = repoWithDecision({ outcome: { outcome: 'revote' } });
  try {
    fs.writeFileSync(path.join(rec, 'note.md'), 'the note');
    fs.mkdirSync(path.join(rec, 'revote'));
    const r = runScript('decide.mjs', ['--revote', id, '--repo-root', dir]);
    assert.equal(r.status, 2, r.output);
    assert.match(r.output, /already being revoted/, `a revote in progress was not what refused it: ${r.output}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// G-13: the revote's model-facing prose was a literal in decide.mjs, where a prompt author does not look.
test('G-13: the revote note reaches the seats through a prompt template, not a literal in decide.mjs', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'decide.mjs'), 'utf8');
  assert.doesNotMatch(src, /earlier talk reached no majority/, 'decide.mjs still carries the revote prose itself');
  const file = path.join(REPO_ROOT, 'prompts', '_templates', 'decision-revote-note.md');
  assert.ok(fs.existsSync(file), 'no template holds the revote prose');
  assert.match(fs.readFileSync(file, 'utf8'), /\{\{note\}\}/, 'the template has no slot for the note');
  assert.match(src, /decision-revote-note\.md/, 'decide.mjs does not render the template');
});

test('G-23: the session rules tell the session to count a spend with decide.mjs --count-spend before starting it', () => {
  const text = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'session-rules.md'), 'utf8');
  const at = text.indexOf('### With the decision panel on');
  const section = text.slice(at, text.indexOf('\n### ', at + 1));
  assert.match(section, /decide\.mjs --count-spend <[^>]+>/, 'the panel section never tells the session to count a spend');
  assert.match(section, /spend bound/, 'the panel section does not say what the bound\'s refusal ends the run with');
});

// G-2 of 20261102-211111-rbr-remediation-4-review: decide.mjs realpathed --repo-root into REPO_REAL and rooted its owner
// there, so a link or junction at the named repository root was resolved away before the owner's root check could see it.
test('G-2: a link or junction at --repo-root is refused, not resolved away', (t) => {
  const { dir, id } = repoWithDecision();
  const holder = tmp('decide-link-');
  t.after(() => { fs.rmSync(holder, { recursive: true, force: true }); fs.rmSync(dir, { recursive: true, force: true }); });
  const linked = path.join(holder, 'linked');
  fs.symlinkSync(dir, linked, process.platform === 'win32' ? 'junction' : 'dir');
  const r = runScript('decide.mjs', ['--overrule', id, '--operator-quote', 'first', '--repo-root', linked]);
  assert.notEqual(r.status, 0, `a repository behind a link was used: ${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /link or junction/, r.stderr);
  assert.equal(fs.existsSync(path.join(dir, '.claude', 'decisions', id, 'overrule.json')), false, 'a record was written through the link');
});
