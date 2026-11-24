// A FINISHED REVIEW'S FINDINGS AS PULL-REQUEST COMMENTS (.claude/requests/pr-review-comments.md, AC1-AC6).
//
// Preferring quorate over /code-review lost one thing: findings posted to a pull request. pr-comments.mjs posts them as
// one GitHub review, by an explicit command after the gate. Every rule is held here without the network: the real
// command runs against a run directory in a throwaway repository, with a fake `gh` that records each call and answers
// from a state file beside it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SCRIPTS_DIR, makeLink } from './helpers.mjs';
import { buildReview, rightSideLines, postRefusal } from '../scripts/lib/pr-comments.mjs';
import { confirmedGroupIds } from '../scripts/lib/run-artifacts.mjs';

const RUN = '20261120-000000-prc';
const HEAD = 'a'.repeat(40);
const PATCH = '@@ -1,2 +1,3 @@\n line one\n+line two\n line three';

const FAKE_GH = `import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const state = JSON.parse(fs.readFileSync(path.join(here, 'state.json'), 'utf8'));
const args = process.argv.slice(2);
let input = ''; try { input = fs.readFileSync(0, 'utf8'); } catch {}
fs.appendFileSync(path.join(here, 'calls.jsonl'), JSON.stringify({ args, input, token: (process.env.GITHUB_TOKEN ?? null), tokens: ['GH_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN'].filter((k) => k in process.env), secrets: ['AWS_SECRET_ACCESS_KEY', 'DATABASE_URL', 'OPENAI_API_KEY'].filter((k) => k in process.env), gitConfig: Object.keys(process.env).filter((k) => /^GIT_CONFIG_(PARAMETERS|COUNT|KEY_\\d+|VALUE_\\d+)$/i.test(k)), path: 'PATH' in process.env || 'Path' in process.env }) + '\\n');
const out = (s) => { process.stdout.write(s); process.exit(0); };
if (args[0] === 'auth') { if (state.loggedOut) { process.stderr.write('You are not logged into any GitHub hosts.'); process.exit(1); } out(''); }
if (args[0] === 'pr') out(JSON.stringify({ headRefOid: state.head, url: 'https://github.com/o/r/pull/7' }));
if (args[0] === 'repo') out(JSON.stringify({ nameWithOwner: 'o/r' }));
if (args[0] === 'api' && args[1].endsWith('/files')) out(state.files.map((f) => JSON.stringify(f)).join('\\n') + '\\n');
if (args[0] === 'api' && args[1].endsWith('/reviews')) out(JSON.stringify({ html_url: 'https://github.com/o/r/pull/7#review' }));
process.stderr.write('unexpected: ' + args.join(' ')); process.exit(3);
`;

function fixture(t, { dirty = false, gated = true, head = HEAD, loggedOut = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-prc-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-prchome-'));
  t.after(() => { for (const d of [dir, home]) fs.rmSync(d, { recursive: true, force: true }); });
  spawnSync('git', ['init', '-q', '.'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# t\n\n```yaml\ngraph_contract_version: 6\nproject: t\ncommands:\n  build: ""\n```\n');
  const run = path.join(dir, '.claude', 'reviews', RUN);
  fs.mkdirSync(path.join(run, 'evidence', 'reconcile'), { recursive: true });
  fs.writeFileSync(path.join(run, 'run.json'), JSON.stringify({ run_id: RUN, head_commit: HEAD, dirty }));
  if (gated) fs.writeFileSync(path.join(run, 'gate.json'), JSON.stringify({ gate: 'RISK', buckets: { did_not_report: [{ node_id: 'panel-x', why: 'arm unavailable' }] } }));
  fs.writeFileSync(path.join(run, 'finding-groups.json'), JSON.stringify({ run_id: RUN, groups: [
    { group_id: 'G-1', file: 'src/a.js', line: 2 }, { group_id: 'G-2', file: 'src/b.js', line: 9 }, { group_id: 'G-3', file: 'src/a.js', line: 3 }, { group_id: 'G-4', file: 'src/a.js', line: 40 }] }));
  fs.writeFileSync(path.join(run, 'evidence', 'reconcile', 'payload.json'), JSON.stringify({ run_id: RUN, groups: [
    { group_id: 'G-1', decision: 'confirmed', severity: 'MEDIUM', rationale: 'on the diff' },
    { group_id: 'G-2', decision: 'confirmed', severity: 'LOW', rationale: 'not on the diff' },
    { group_id: 'G-3', decision: 'dropped', severity: 'LOW', rationale: 'dropped, never posted' },
    { group_id: 'G-4', decision: 'confirmed', severity: 'LOW', rationale: 'in a diffed file, off its hunks' }] }));
  const fake = path.join(home, 'gh');
  fs.mkdirSync(fake);
  fs.writeFileSync(path.join(fake, 'gh.mjs'), FAKE_GH);
  fs.writeFileSync(path.join(fake, 'state.json'), JSON.stringify({ head, loggedOut, files: [{ filename: 'src/a.js', patch: PATCH }] }));
  return { dir, home, run, fake };
}

// Each fake built through a call (operator, 2026-11-19: "Build the fakes at runtime (Recommended)"): a credential-shaped
// name followed by a literal is what the public CI's secret scan flags, whatever the value is.
const fake = (s) => s;

function prComments(f, extra = []) {
  const r = spawnSync(process.execPath, [path.join(SCRIPTS_DIR, 'pr-comments.mjs'), '--run-dir', f.run, '--pr', '7',
    '--repo-root', f.dir, '--gh-bin', path.join(f.fake, 'gh.mjs'), ...extra],
  { cwd: f.dir, encoding: 'utf8', env: { ...process.env, QUORATE_HOME: f.home, GITHUB_TOKEN: fake('stale-token'), GH_TOKEN: fake('other-account'),
    GH_ENTERPRISE_TOKEN: fake('other-enterprise'), GITHUB_ENTERPRISE_TOKEN: fake('other-enterprise-2'),
    AWS_SECRET_ACCESS_KEY: fake('a-cloud-key'), DATABASE_URL: 'postgres://u:p@h/d', OPENAI_API_KEY: fake('a-vendor-key'),
    GIT_CONFIG_PARAMETERS: fake(`'http.extraheader=Authorization: Basic eDp5'`), GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.extraheader', GIT_CONFIG_VALUE_0: fake('Authorization: Basic eDp5') } });
  const log = path.join(f.fake, 'calls.jsonl');
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
  return { status: r.status, out: `${r.stdout}${r.stderr}`, calls };
}
const posted = (calls) => calls.filter((c) => c.args[0] === 'api' && c.args[1].endsWith('/reviews'));

test('AC3: without --post it prints the review and sends nothing; with --post it sends that same review', (t) => {
  const f = fixture(t);
  const dry = prComments(f);
  assert.equal(dry.status, 0, dry.out);
  assert.equal(posted(dry.calls).length, 0, 'a dry run posted');
  assert.match(dry.out, /1 inline comment\(s\), 2 in the summary/);
  const printed = JSON.parse(dry.out.slice(dry.out.indexOf('{'), dry.out.lastIndexOf('}') + 1));
  const sent = prComments(f, ['--post']);
  assert.equal(sent.status, 0, sent.out);
  const p = posted(sent.calls);
  assert.equal(p.length, 1, 'one review is posted');
  assert.deepEqual(JSON.parse(p[0].input), printed, 'what was posted is not what the dry run printed');
});

test('AC2: a confirmed finding on the diff is inline, one off it is in the summary, a dropped one is nowhere', (t) => {
  const f = fixture(t);
  const r = prComments(f, ['--post']);
  const review = JSON.parse(posted(r.calls)[0].input);
  assert.deepEqual(review.comments.map((c) => [c.path, c.line, c.side]), [['src/a.js', 2, 'RIGHT']]);
  assert.equal(review.commit_id, HEAD);
  assert.equal(review.event, 'COMMENT');
  assert.match(review.body, /gate RISK/);
  assert.match(review.body, /G-2 · LOW\*\* `src\/b\.js:9`/);
  assert.match(review.body, /G-4 · LOW\*\* `src\/a\.js:40`/, 'a line of a diffed file outside its hunks was placed inline');
  assert.match(review.body, /`panel-x`: arm unavailable/, 'the lens that did not report is not named');
  assert.doesNotMatch(JSON.stringify(review), /G-3|dropped, never posted/);
});

test('AC1, AC5: refused before any gh call when the run has not gated or its tree was not clean', (t) => {
  for (const [opts, why] of [[{ gated: false }, /has not gated/], [{ dirty: true }, /dirty tree/], [{ dirty: null }, /could not tell/]]) {
    const f = fixture(t, opts);
    const r = prComments(f, ['--post']);
    assert.equal(r.status, 2, r.out);
    assert.match(r.out, why);
    assert.equal(r.calls.length, 0, `gh was called for a refused run (${JSON.stringify(opts)})`);
  }
});

test('AC5: refused, naming both commits, when the pull request\'s head is not the commit the run reviewed', (t) => {
  const f = fixture(t, { head: 'b'.repeat(40) });
  const r = prComments(f, ['--post']);
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, new RegExp(`head is ${'b'.repeat(40)}, the run reviewed ${HEAD}`));
  assert.equal(posted(r.calls).length, 0);
});

test('AC4: gh\'s own login is used, a stale GITHUB_TOKEN is not passed, and a logged-out gh is refused with what to do', (t) => {
  const f = fixture(t);
  const r = prComments(f);
  assert.ok(r.calls.length > 0 && r.calls.every((c) => c.token === null), 'GITHUB_TOKEN reached gh');
  // G-4 of 20261120-231702-prc-delivery: gh prefers GH_TOKEN and the enterprise tokens over its stored login too, so any
  // one of them reaching gh posts as whichever account it names.
  assert.deepEqual([...new Set(r.calls.flatMap((c) => c.tokens))], [], 'a token gh prefers over its stored login reached gh');
  // G-5 of 20261121-001829-prc-remediation-review (operator: "G-3, G-1, G-8 and G-5 (Recommended)"; fixed by hand, "I fix it
  // by hand, then a review (Recommended)"): gh got every other credential in the operator's environment too. It needs
  // none: its login is in its own config. Every secret-shaped name is scrubbed; what gh runs on (PATH) stays.
  assert.deepEqual([...new Set(r.calls.flatMap((c) => c.secrets))], [], 'an unrelated credential reached gh');
  // G-1 of 20261123-174149-m3s9-remediation-review-b: git's environment config (GIT_CONFIG_PARAMETERS, the
  // COUNT/KEY_n/VALUE_n tuple) can carry an Authorization header, which SECRET_NAME does not match. gh needs none of it.
  assert.deepEqual([...new Set(r.calls.flatMap((c) => c.gitConfig))], [], 'git\'s environment config reached gh');
  assert.ok(r.calls.every((c) => c.path), 'gh lost PATH, which it needs to run');
  const out = fixture(t, { loggedOut: true });
  const refused = prComments(out, ['--post']);
  assert.equal(refused.status, 2, refused.out);
  assert.match(refused.out, /not logged in.*gh auth login/);
  assert.equal(posted(refused.calls).length, 0);
});

// G-8 of 20261121-001829-prc-remediation-review: the run's files were read through the run owner, which refuses a link
// but cannot see a hard link, and what they hold is posted to GitHub. A run file with a second name may hold content from
// outside the run, so each one whose content is posted is refused, before gh is called at all.
test('G-8: a hard-linked run file whose content would be posted is refused before any gh call', (t) => {
  for (const rel of [['evidence', 'reconcile', 'payload.json'], ['finding-groups.json'], ['gate.json']]) {
    const f = fixture(t);
    const file = path.join(f.run, ...rel);
    const outside = path.join(f.home, `outside-${rel.at(-1)}`);
    fs.renameSync(file, outside);
    if (!makeLink(t, { target: outside, at: file, type: 'hard' })) return;
    const r = prComments(f, ['--post']);
    assert.equal(r.status, 2, `${rel.join('/')}: ${r.out}`);
    assert.match(r.out, /refused|second name|more than one name|hard/i, `${rel.join('/')}: ${r.out}`);
    assert.equal(r.calls.length, 0, `gh was called for a run whose ${rel.join('/')} has a second name`);
  }
});

// A RUN THAT GATED WITHOUT REVIEWING SAYS WHY (pr-review-comments.md AC1; operator, 2026-11-20, to G-5 of
// 20261121-010435-prc-remediation-2-review: "Summary with the reason"). A pre-flight failure gates BLOCKED with no
// reconcile artifacts; its summary said "gate BLOCKED" and nothing else, which on a pull request reads as nothing found.
test('a BLOCKED run with nothing reconciled posts its verdict, the gate\'s reason and what was not checked', () => {
  const review = buildReview({
    runId: 'r', commitId: HEAD, payload: null, groups: null, files: [],
    gate: { gate: 'BLOCKED', reason: 'pre-flight barrier failed (build); nothing was spawned',
      buckets: { did_not_report: [], not_checked: [{ node_id: 'test', why: 'the build failed, so no test ran' }] } },
  });
  assert.deepEqual(review.comments, []);
  assert.match(review.body, /gate BLOCKED/);
  assert.match(review.body, /pre-flight barrier failed \(build\); nothing was spawned/, 'the gate\'s reason is missing');
  assert.match(review.body, /`test`: the build failed, so no test ran/, 'the not-checked list is missing');
});

test('the pure rules: which lines a patch lets a comment sit on, the refusals, the one confirmed set', () => {
  assert.deepEqual([...rightSideLines(PATCH)], [1, 2, 3]);
  assert.deepEqual([...rightSideLines('@@ -5,3 +7,2 @@\n ctx\n-gone\n+new\n')], [7, 8], 'a removed line takes no new-file number');
  assert.deepEqual([...rightSideLines(undefined)], [], 'a file GitHub gives no patch for has no line');
  assert.equal(postRefusal({ gated: true, record: { dirty: false, head_commit: HEAD }, prHead: HEAD }), null);
  assert.match(postRefusal({ gated: true, record: { dirty: false }, prHead: HEAD }), /no head_commit/);
  assert.deepEqual(confirmedGroupIds({ groups: [{ group_id: 'A', decision: 'confirmed' }, null, { group_id: 'B', decision: 'symptom' }] }), ['A']);
  assert.deepEqual(confirmedGroupIds(null), []);
  const big = buildReview({ runId: 'r', gate: { gate: 'PASS' }, payload: { groups: [{ group_id: 'G-1', decision: 'confirmed', rationale: 'x'.repeat(20000) }] },
    groups: { groups: [{ group_id: 'G-1', file: 'a', line: 1 }] }, files: [{ filename: 'a', patch: '@@ -0,0 +1 @@\n+x' }], commitId: HEAD });
  assert.ok(big.comments[0].body.length <= 8000 && /cut at 8000/.test(big.comments[0].body), 'a long comment is not cut, or not said to be');
});

// G-13 of 20261123-161216-m3s9-review: the summary was cut at 60000 characters after the whole unplaced list was built,
// so trailing findings fell off (one could be split mid-item) while the CLI still reported them all as in the summary.
test('G-13: a summary too long to post still names every unplaced finding, none split', () => {
  const n = 120;
  const ids = Array.from({ length: n }, (_, i) => `G-${i + 1}`);
  const review = buildReview({ runId: 'r', gate: { gate: 'RISK' }, commitId: HEAD, files: [],
    payload: { groups: ids.map((id) => ({ group_id: id, decision: 'confirmed', severity: 'LOW', rationale: 'y'.repeat(1000) })) },
    groups: { groups: ids.map((id) => ({ group_id: id, file: 'off.mjs', line: 1 })) } });
  assert.equal(review.unplaced.length, n);
  assert.ok(review.body.length <= 60000, 'the summary exceeds GitHub\'s bound');
  const missing = ids.filter((id) => !new RegExp(`\\b${id}\\b(?!\\d)`).test(review.body));
  assert.deepEqual(missing, [], 'these unplaced findings are counted as in the summary and absent from its body');
});

// G-6 of 20261120-231702-prc-delivery: a rationale is model prose that can quote an evidence log, and with --post it is
// published to a pull request. Every body is redacted by the one owner of secret shapes (lib/redact.mjs), inline and in
// the summary. The token is built at run time so the push scan does not read one in this file.
test('G-6: a credential quoted in a rationale is redacted in the inline comment and in the summary', () => {
  const token = `ghp_${'A1b2C3d4E5'.repeat(4)}`;
  const review = buildReview({ runId: 'r', gate: { gate: 'RISK', buckets: { did_not_report: [{ node_id: 'n', why: `failed with ${token}` }] } },
    payload: { groups: [{ group_id: 'G-1', decision: 'confirmed', rationale: `the log shows ${token}` },
      { group_id: 'G-2', decision: 'confirmed', rationale: `off the diff: ${token}` }] },
    groups: { groups: [{ group_id: 'G-1', file: 'a', line: 1 }, { group_id: 'G-2', file: 'b', line: 1 }] },
    files: [{ filename: 'a', patch: '@@ -0,0 +1 @@\n+x' }], commitId: HEAD });
  assert.equal(review.comments.length, 1);
  assert.doesNotMatch(JSON.stringify(review), new RegExp(token), 'a credential reached the review to be posted');
  assert.match(review.comments[0].body, /\[redacted: GitHub token\]/);
  assert.match(review.body, /\[redacted: GitHub token\]/);
});

// G-6 of 20261123-174149-m3s9-remediation-review-b: an unplaced finding's line was cut to its item bound BEFORE it was
// redacted, so a quoted credential whose closing quote fell past the cut escaped the quote-anchored pattern.
test('G-6: a quoted credential cut by the summary item bound is still redacted', () => {
  const pw = 'pass' + 'word';
  const value = 'hunter two '.repeat(10);
  // 970 + 13 characters before the value, so the cut at 1000 keeps "hunter two hunter" and drops the closing quote.
  const rationale = `${'x'.repeat(970)} ${pw}: "${value}"`;
  const review = buildReview({ runId: 'r', gate: { gate: 'RISK' }, commitId: HEAD, files: [],
    payload: { groups: [{ group_id: 'G-1', decision: 'confirmed', severity: 'LOW', rationale }] },
    groups: { groups: [{ group_id: 'G-1', file: 'off.mjs', line: 1 }] } });
  assert.doesNotMatch(review.body, /hunter two/, 'a quoted credential cut at the item bound reached the summary');
});

// G-2 of 20261120-231702-prc-delivery: the public CLAUDE.md named .claude/requests/pr-review-comments.md as the owner of
// pr-comments' rules, and publish/manifest.json excludes .claude/requests, so a reader of the public repository followed
// it to nothing. A file the published contract cites must be one the snapshot ships.
test('G-2: the published CLAUDE.md cites no file under a path the publish manifest excludes', () => {
  const root = path.resolve(SCRIPTS_DIR, '..');
  const { exclude } = JSON.parse(fs.readFileSync(path.join(root, 'publish', 'manifest.json'), 'utf8'));
  // Whichever file is the public CLAUDE.md (operator, 2026-11-24: "Tests read whichever is the public CLAUDE.md
  // (Recommended)"): the snapshot ships publish/CLAUDE.public.md as its CLAUDE.md.
  const pub = fs.existsSync(path.join(root, 'publish', 'CLAUDE.public.md')) ? path.join('publish', 'CLAUDE.public.md') : 'CLAUDE.md';
  const text = fs.readFileSync(path.join(root, pub), 'utf8');
  // A cited DOCUMENT (.md): a path the engine writes in a project, as `.claude/reviews/ledger.json`, is not a citation.
  const cited = [...text.matchAll(/(?<![\w./-])(\.?[\w-]+(?:\/[\w.-]+)+\.md)\b/g)].map((m) => m[1]);
  const bad = cited.filter((p) => exclude.some((e) => p === e || p.startsWith(`${e}/`)));
  assert.deepEqual(bad, [], 'the published contract cites a file the snapshot does not ship');
});

// A TREE DIRTY ONLY IN GENERATED FILES IS POSTED (operator, 2026-11-23: "Fix the rule, post this run (Recommended)"): this
// repository's finished runs sit untracked under .claude/reviews/ (generated_globs), so every review of it was refused.
// A change outside generated_globs, or a record that predates the field or could not establish it, still refuses.
test('postRefusal posts a tree dirty only under generated_globs, and refuses one dirty anywhere else', () => {
  const rec = (extra) => ({ dirty: true, head_commit: HEAD, ...extra });
  assert.equal(postRefusal({ gated: true, record: rec({ dirty_outside_generated: [] }), prHead: HEAD }), null);
  assert.match(postRefusal({ gated: true, record: rec({ dirty_outside_generated: ['scripts/a.mjs'] }), prHead: HEAD }), /dirty tree/);
  assert.match(postRefusal({ gated: true, record: rec({}), prHead: HEAD }), /dirty tree/, 'a record from before the field');
  assert.match(postRefusal({ gated: true, record: rec({ dirty_outside_generated: null }), prHead: HEAD }), /dirty tree/);
  assert.match(postRefusal({ gated: true, record: { dirty: null, dirty_outside_generated: [], head_commit: HEAD }, prHead: HEAD }), /could not tell/);
});
