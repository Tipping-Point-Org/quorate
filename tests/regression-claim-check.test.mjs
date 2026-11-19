// claim-check (.claude/requests/claim-check.md, approved 2026-09-26). The operator, after five issues
// in one session dissolved under a single question each: "running a task is easier than remebering a
// set of rules". The checker is a model; these tests pin the half that is NOT left to it — the shape
// its answer must have, and the rules it cannot be trusted to apply to itself (AC2, AC3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { CLAIM_KINDS, applyClaimRules, resultShapeErrors, resolveCitation } from '../scripts/lib/claim-check.mjs';
import { REPO_ROOT } from './helpers.mjs';

const ROOT = path.resolve('/virtual/repo');
/** A repository holding one file, `src/a.mjs`, of three lines. */
const IO = { fs: {
  existsSync: (p) => path.resolve(p) === path.join(ROOT, 'src', 'a.mjs'),
  realpathSync: (p) => path.resolve(p),
  statSync: (p) => ({ isFile: () => path.resolve(p) === path.join(ROOT, 'src', 'a.mjs') }),
  readFileSync: (p) => { if (path.resolve(p) !== path.join(ROOT, 'src', 'a.mjs')) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return 'one\ntwo\nthree\n'; },
} };

const claim = (over = {}) => ({
  id: 'C1', text: 'the lock loop can spin forever', kind: 'defect', grade: 'observed', verdict: 'stands',
  search: { looked_for: 'a sleep or deadline on the retry path', where: ['src/a.mjs'], found: 'neither' },
  citations: [{ file: 'src/a.mjs', lines: '2-3' }],
  counter_question: { question: 'what makes the lock unreadable?', answer: 'a directory at the lock path' },
  ...over,
});
const apply = (claims) => applyClaimRules({ schema_version: 1, claims, not_checked: [] }, { repoRoot: ROOT, io: IO });

test('a result of the wrong shape is refused, not half-applied', () => {
  assert.ok(resultShapeErrors(null).length);
  assert.ok(resultShapeErrors({ claims: [] }).some((e) => /empty/.test(e)), 'a check that found no claim did not read the draft');
  const errs = resultShapeErrors({ claims: [{ id: 'C1', text: 'x', kind: 'rumour', grade: 'sure', verdict: 'fine' }] });
  for (const f of ['kind', 'grade', 'verdict', 'search', 'citations', 'counter_question']) {
    assert.ok(errs.some((e) => e.includes(f)), `${f} is checked: ${errs.join(' | ')}`);
  }
  const r = applyClaimRules({ claims: [] }, { repoRoot: ROOT, io: IO });
  assert.equal(r.ok, false);
  assert.deepEqual(r.claims, []);
});

test('AC3: observed survives only with a citation that resolves', () => {
  assert.equal(apply([claim()]).claims[0].grade, 'observed', 'a real file and real lines');
  for (const bad of [[], [{ file: 'src/none.mjs' }], [{ file: 'src/a.mjs', lines: '2-9' }], [{ file: '../../etc/passwd' }], [{ file: 'src/a.mjs', lines: 'two' }]]) {
    const c = apply([claim({ citations: bad })]).claims[0];
    assert.equal(c.grade, 'inferred', `recomputed for ${JSON.stringify(bad)}`);
    assert.ok(c.notes.some((n) => /recomputed as inferred/.test(n)), 'and the downgrade is recorded, not silent');
  }
  assert.equal(apply([claim({ citations: [{ command: 'git grep -n spin' }] })]).claims[0].grade, 'observed',
    'a command is an instrument a reader can re-run');
  assert.equal(resolveCitation({ file: 'src/a.mjs', lines: '3' }, { repoRoot: ROOT, io: IO }).ok, true);
  assert.throws(() => resolveCitation({ file: 'x' }, { repoRoot: ROOT }), /resolveCitation: an io/);
});

test('a claim about the operator becomes a question, and a risk with no trigger does not stand', () => {
  const op = apply([claim({ operator_only: true, text: 'this cannot be tested on Windows' })]).claims[0];
  assert.equal(op.verdict, 'ask-operator');
  const risk = apply([claim({ kind: 'risk', trigger: '' })]).claims[0];
  assert.equal(risk.verdict, 'downgrade');
  assert.ok(risk.notes.some((n) => /no realistic trigger/.test(n)));
  assert.equal(apply([claim({ kind: 'risk', trigger: 'a committed link to ~/.aws/credentials' })]).claims[0].verdict, 'stands');
});

test('the CLI applies the rules in a check directory and writes both artifacts', (t) => {
  const script = path.join(REPO_ROOT, 'scripts', 'claim-check.mjs');
  const made = spawnSync(process.execPath, [script, '--new', 'test-cli'], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);
  const dir = made.stdout.trim();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.ok(dir.includes(path.join('.claude', 'claim-checks')), 'under the gitignored directory');
  fs.writeFileSync(path.join(dir, 'draft.md'), 'The lock loop can spin forever.\n');
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ claims: [claim({ citations: [{ file: 'scripts/io/atomic.mjs', lines: '1' }] }), claim({ id: 'C2', citations: [] })], not_checked: [] }));
  const r = spawnSync(process.execPath, [script, dir], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const checked = JSON.parse(fs.readFileSync(path.join(dir, 'checked.json'), 'utf8'));
  assert.deepEqual(checked.claims.map((c) => c.grade), ['observed', 'inferred']);
  assert.match(fs.readFileSync(path.join(dir, 'checked.md'), 'utf8'), /recomputed as inferred/);
  fs.writeFileSync(path.join(dir, 'result.json'), '{"claims": []}');
  assert.equal(spawnSync(process.execPath, [script, dir], { cwd: REPO_ROOT, encoding: 'utf8' }).status, 1, 'a refused result exits 1');
});

// AC4: the rule to remember is one — run it — so the skills whose report raises issues say so AT their
// reporting step. plan-review is deliberately absent: it emits one JSON verdict and may not spawn
// (amended in the request, found by reading its output contract before wiring it).
test('AC4: the reporting skills require claim-check at the step where they report', () => {
  for (const [skill, heading] of [['full-review', '## What you report back'], ['invoke', '## Reporting back'], ['remediate', '## Output']]) {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'skills', skill, 'SKILL.md'), 'utf8');
    const at = src.indexOf(heading);
    assert.ok(at > -1, `${skill} has its reporting section`);
    assert.match(src.slice(at, at + 700), /quorate:claim-check/, `${skill} requires it there, not somewhere a reader may not reach`);
  }
  const pr = fs.readFileSync(path.join(REPO_ROOT, 'skills', 'plan-review', 'SKILL.md'), 'utf8');
  assert.doesNotMatch(pr, /quorate:claim-check/, 'plan-review writes no prose report and may not spawn a checker');
});

// Found by AC5's first replay: the checker verified the count in "every group came from two codex
// arms — one family agreeing with itself, which shares its blind spots" and let the generalisation
// through, the very clause the operator had challenged. The brief now splits compound claims and asks
// a generalisation for evidence of itself. Model instructions cannot be unit-tested; their presence can.
test('the checker brief splits compound claims and asks a generalisation for its own evidence', () => {
  const brief = fs.readFileSync(path.join(REPO_ROOT, 'skills', 'claim-check', 'CHECKER.md'), 'utf8');
  assert.match(brief, /Split a compound sentence into its assertions/);
  assert.match(brief, /needs evidence\s+for the generalisation itself/);
});

// Scope widened (request amendment, operator 2026-09-26: "A is fine"). The survey of dissolved claims
// found 37 across the interactive sessions, and issue reports were 2 of them: decision requests,
// recommendations and capability claims led, then cost estimates, attributions, explanations of how
// the code behaves, and "all of it needs you". The trigger is the CLAIM, not the kind of message, so
// the checker must be able to name each of those kinds rather than filing them under `other`.
test('the claim kinds cover what the survey found dissolving, and the brief offers every one', () => {
  for (const k of ['capability', 'cost', 'attribution', 'behaviour', 'status']) {
    assert.ok(resultShapeErrors({ claims: [claim({ kind: k })], not_checked: [] }).length === 0, `${k} is a kind the checker may use`);
  }
  const brief = fs.readFileSync(path.join(REPO_ROOT, 'skills', 'claim-check', 'CHECKER.md'), 'utf8');
  const line = /"kind": "([^"]+)"/.exec(brief)?.[1] ?? '';
  const offered = line.split('|').map((s) => s.trim());
  assert.deepEqual([...offered].sort(), [...CLAIM_KINDS].sort(), 'the brief and the validator name the same kinds');
});

// shared/unverified-claims.md: an attribution is available only where the operator's words can be
// quoted. The checker may find them in the session transcript; when it cannot, "you asked" does not
// stand — it becomes a question, and the note says what would make it stand.
// G-7 of 20260926-060936-m0-close-r3 (panel-codex-contract): it was only downgraded, so the revised
// report still carried "you asked" as a statement, labelled unverified. I-11's contract is a quoted
// citation or the claim rewritten as a QUESTION — the one form that cannot borrow the operator's
// authority. `ask-operator` is the verdict the skill turns into a question.
test('an attribution with no resolvable citation does not stand', () => {
  const unquoted = apply([claim({ kind: 'attribution', text: 'you asked for a byte cap', grade: 'inferred', citations: [] })]).claims[0];
  assert.equal(unquoted.verdict, 'ask-operator');
  assert.ok(unquoted.notes.some((n) => /operator's words/.test(n)));
  const quoted = apply([claim({ kind: 'attribution', text: 'you asked for a byte cap', citations: [{ command: 'grep -n "limit the cache based on size" session.jsonl' }] })]).claims[0];
  assert.equal(quoted.verdict, 'stands', 'a quote found by a re-runnable command is the evidence the rule asks for');
});

test('the skill triggers on the claim, not on the kind of message', () => {
  const skill = fs.readFileSync(path.join(REPO_ROOT, 'skills', 'claim-check', 'SKILL.md'), 'utf8');
  const when = skill.slice(skill.indexOf('## When'), skill.indexOf('## How'));
  for (const w of [/decision/, /cost|estimate/, /attribution|who asked/i, /behaves/, /waiting on/]) assert.match(when, w);
});

// G-11 of 20260926-044637-m0-close-r2 (panel-codex-code): only the GRADE was recomputed when no citation
// resolved, so a `dissolved` verdict with nothing behind it survived and the claim was removed from the
// report without ever being disproved. A dissolution is a claim too; without evidence it is kept,
// labelled unverified.
test('a dissolution with no citation that resolves does not remove the claim', () => {
  const c = apply([claim({ verdict: 'dissolved', citations: [] })]).claims[0];
  assert.equal(c.verdict, 'downgrade');
  assert.ok(c.notes.some((n) => /dissolved -> downgrade/.test(n)));
  assert.equal(apply([claim({ verdict: 'dissolved' })]).claims[0].verdict, 'dissolved', 'with a citation it may dissolve');
});

// G-13 of the same run (panel-codex-arch): a missing `not_checked` became [], so a checker that omitted
// its gaps read exactly like one that had none. The list is required; empty is a statement, absent is not.
test('a result without not_checked is refused, not read as "no gaps"', () => {
  assert.ok(resultShapeErrors({ claims: [claim()] }).some((e) => /not_checked/.test(e)));
  assert.ok(resultShapeErrors({ claims: [claim()], not_checked: 'none' }).some((e) => /not_checked/.test(e)));
  assert.deepEqual(resultShapeErrors({ claims: [claim()], not_checked: [] }), []);
});

// G-2 of 20260926-044637-m0-close-r2 (panel-codex-code): `--new` named the directory to the second and
// created it with a recursive mkdir, which does not fail on an existing directory — so two same-slug
// checks in one second shared a draft and a result. Pre-creating the names the next seconds would get
// makes the collision certain rather than a race.
test('--new never hands out a directory that already exists', (t) => {
  const script = path.join(REPO_ROOT, 'scripts', 'claim-check.mjs');
  const root = path.join(REPO_ROOT, '.claude', 'claim-checks');
  const two = (n) => String(n).padStart(2, '0');
  const stampOf = (d) => `${d.getUTCFullYear()}${two(d.getUTCMonth() + 1)}${two(d.getUTCDate())}`
    + `-${two(d.getUTCHours())}${two(d.getUTCMinutes())}${two(d.getUTCSeconds())}`;
  const slug = `collide-${process.pid}`;
  const taken = [];
  for (let s = 0; s < 60; s++) {
    const d = path.join(root, `${stampOf(new Date(Date.now() + s * 1000))}-${slug}`);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'draft.md'), 'someone else\'s draft\n');
    taken.push(d);
  }
  const made = [];
  t.after(() => { for (const d of [...taken, ...made]) fs.rmSync(d, { recursive: true, force: true }); });
  const r = spawnSync(process.execPath, [script, '--new', slug], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  made.push(r.stdout.trim());
  assert.ok(!taken.includes(made[0]), `handed out an existing directory: ${made[0]}`);
  assert.deepEqual(fs.readdirSync(made[0]), [], 'and it is empty');
});

// A CONSUMER'S REPOSITORY HAS NO RULE FOR THIS DIRECTORY. "Gitignored" held only in quorate's own tree:
// in story-pipeline nothing ignored .claude/claim-checks/, and a draft and a checker's answer sat one
// `git add` from a commit (2026-10-06). The directory now ignores itself.
test('--new leaves its directory ignored by git in a repository with no rule for it', () => {
  const script = path.join(REPO_ROOT, 'scripts', 'claim-check.mjs');
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'q-cc-consumer-'));
  try {
    assert.equal(spawnSync('git', ['init', '-q'], { cwd: repo }).status, 0);
    const made = spawnSync(process.execPath, [script, '--new', 'consumer'], { cwd: repo, encoding: 'utf8' });
    assert.equal(made.status, 0, made.stderr);
    const dir = made.stdout.trim();
    fs.writeFileSync(path.join(dir, 'draft.md'), 'model text\n');
    const ignored = spawnSync('git', ['check-ignore', '-q', path.join(dir, 'draft.md')], { cwd: repo });
    assert.equal(ignored.status, 0, 'the draft must be ignored by git in a consumer');
    assert.doesNotMatch(made.stderr, /NOT ignored/, 'and --new must not warn when it is');
    const untracked = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: repo, encoding: 'utf8' });
    assert.doesNotMatch(untracked.stdout, /claim-checks/, 'nothing under claim-checks shows as untracked');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
