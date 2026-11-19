// hardlink-egress.plan.md stages 1-3 (design HL-D1 B, HL-D2 A, HL-D3 A, operator 2026-11-12). A file with a second name
// (`nlink > 1`) passed every check that refuses only symbolic links, so its content, another file's, could leave the
// machine or enter the intent sandbox under a name the check accepted: the intent sandbox copied a hard-linked document
// (G-2 of 20261111-235524-runtime-bin-remediation-5-review), the seat copy-in read one (G-3, G-4 its symptom), and only
// claim-check's draft refused one, by a rule of its own (G-1). One owner (lib/egress-read.mjs) now refuses a hard-linked
// file wherever content leaves or enters the sandbox, each refusal reported the way the site reports a refused path.
// Held here by a driven test per class of site: the owner, a seat copy, the intent sandbox, the prompt files
// (spawn-subagent, external-review, decide), and claim-check's draft and transcript. Real hard links (fs.linkSync); a
// test skips, with its reason, where the filesystem cannot make one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { egress, egressReadFile } from '../scripts/io/egress-read.mjs';
import { copyIntoSeatDir } from '../scripts/io/seat-copies.mjs';
import { confined } from '../scripts/io/confined-path.mjs';
import { snapshotIntentDocs, createSnapshot } from '../scripts/io/doc-snapshot.mjs';
import { REPO_ROOT, SCRIPTS_DIR, noRealReviewers } from './helpers.mjs';

const tmp = (t, p) => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p))); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
/** A second name for `existing` at `link`, or the reason none can be made here (the caller skips with it). */
const hardLink = (existing, link) => { try { fs.linkSync(existing, link); return null; } catch (e) { return `this filesystem made no hard link (${e.code ?? e.message})`; } };
const env = () => { const e = { ...process.env }; delete e.GRAPH_NODE_DEPTH; return e; };

// ------------------------------------------------------------------------------------------------ the owner
test('the owner refuses a hard-linked file, naming the path and its count; reads a single-named one; refuses a link', (t) => {
  const d = tmp(t, 'hl-owner-');
  fs.writeFileSync(path.join(d, 'secret.txt'), 'another file\'s content\n');
  const why = hardLink(path.join(d, 'secret.txt'), path.join(d, 'draft.md'));
  if (why) { t.skip(why); return; }
  assert.equal(fs.statSync(path.join(d, 'draft.md')).nlink, 2, 'the platform reports no second name');
  assert.throws(() => egress(d).read(['draft.md']), (e) => e.code === 'ECONFINED' && e.refusal === 'hard-link'
    && e.message.includes(path.join(d, 'draft.md')) && /2 names/.test(e.message), 'a hard-linked file was read');
  assert.throws(() => egressReadFile(path.join(d, 'draft.md')), (e) => e.refusal === 'hard-link');
  fs.writeFileSync(path.join(d, 'plain.md'), 'mine\n');
  assert.equal(egress(d).read(['plain.md']), 'mine\n');
  fs.mkdirSync(path.join(d, 'real'));
  fs.writeFileSync(path.join(d, 'real', 'f.md'), 'x\n');
  fs.symlinkSync(path.join(d, 'real'), path.join(d, 'j'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => egress(d).read(['j', 'f.md']), (e) => e.code === 'ECONFINED' && e.refusal === 'link', 'a junction was followed');
});

// ------------------------------------------------------------------------------------------------ a seat copy
test('a seat copy refuses a hard-linked file, named with why, and copies nothing for it', (t) => {
  const repo = tmp(t, 'hl-seat-repo-');
  const home = tmp(t, 'hl-seat-home-');
  fs.mkdirSync(path.join(repo, 'docs'));
  fs.writeFileSync(path.join(repo, 'outside-the-question.txt'), 'not cited\n');
  fs.writeFileSync(path.join(repo, 'docs', 'ok.md'), 'ok\n');
  const why = hardLink(path.join(repo, 'outside-the-question.txt'), path.join(repo, 'docs', 'cited.md'));
  if (why) { t.skip(why); return; }
  const owner = confined(home);
  const segs = ['seat', '1'];
  owner.dir(segs);
  const r = copyIntoSeatDir({ repoRoot: repo, owner, segs, paths: ['docs/ok.md', 'docs/cited.md'], refused: [],
    tracked: ['docs/ok.md', 'docs/cited.md'], caseInsensitive: process.platform === 'win32' });
  assert.deepEqual(r.copied, ['docs/ok.md']);
  const refused = r.refused.find((x) => x.path === 'docs/cited.md');
  assert.ok(refused, `a hard-linked file was not refused: ${JSON.stringify(r)}`);
  assert.match(refused.why, /hard link/);
  assert.equal(fs.existsSync(path.join(home, 'seat', '1', 'docs', 'cited.md')), false, 'the hard-linked file reached the seat');
});

// ------------------------------------------------------------------------------------------------ the intent sandbox
test('the intent sandbox refuses a hard-linked document, recorded as a skip, and copies the others', (t) => {
  const repo = tmp(t, 'hl-intent-');
  fs.mkdirSync(path.join(repo, 'docs'));
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src', 'impl.js'), 'export const secret = 1;\n');
  fs.writeFileSync(path.join(repo, 'docs', 'a.md'), '# a\n');
  const why = hardLink(path.join(repo, 'src', 'impl.js'), path.join(repo, 'docs', 'b.md'));
  if (why) { t.skip(why); return; }
  const snapDir = path.join(repo, '..', `${path.basename(repo)}-snap`);
  t.after(() => fs.rmSync(snapDir, { recursive: true, force: true }));
  const skips = [];
  const snap = createSnapshot(snapDir, { onSkip: (s) => skips.push(s) });
  snapshotIntentDocs({ repoRoot: repo, docPaths: ['docs/*.md'], snap, onSkip: (s) => skips.push(s) });
  const copied = fs.existsSync(snapDir) ? fs.readdirSync(snapDir) : [];
  assert.ok(copied.some((n) => n.endsWith('a.md')), `the single-named document was not copied: ${copied}`);
  assert.ok(!copied.some((n) => n.endsWith('b.md')), 'the hard-linked document entered the intent sandbox');
  const skip = skips.find((s) => /b\.md/.test(s.item));
  assert.ok(skip, `no skip recorded for the hard-linked document: ${JSON.stringify(skips)}`);
  assert.match(skip.reason, /hard link/);
});

// ------------------------------------------------------------------------------------------------ the prompt files
test('spawn-subagent refuses a hard-linked prompt file, before anything is spawned', (t) => {
  const d = tmp(t, 'hl-subagent-');
  fs.writeFileSync(path.join(d, 'secret.txt'), 'not the prompt\n');
  const why = hardLink(path.join(d, 'secret.txt'), path.join(d, 'p.md'));
  if (why) { t.skip(why); return; }
  const bin = path.join(d, 'fake.mjs');
  fs.writeFileSync(bin, "import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';\nfs.writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'ran'), 'x');\n");
  const r = spawnSync(process.execPath, [path.join(SCRIPTS_DIR, 'spawn-subagent.mjs'), '--prompt-file', path.join(d, 'p.md'),
    '--out', path.join(d, 'e.json'), '--repo-root', REPO_ROOT, '--runtime-bin', bin], { encoding: 'utf8', env: env() });
  assert.notEqual(r.status, 0, 'a hard-linked prompt was sent');
  assert.match(r.stderr, /hard link/, r.stderr);
  assert.equal(fs.existsSync(path.join(d, 'ran')), false, 'the runtime was started');
});

test('external-review refuses a hard-linked prompt file outside a run with its unavailable envelope, before any probe', (t) => {
  const d = tmp(t, 'hl-review-');
  fs.writeFileSync(path.join(d, 'secret.txt'), 'not the prompt\n');
  const why = hardLink(path.join(d, 'secret.txt'), path.join(d, 'prompt.md'));
  if (why) { t.skip(why); return; }
  const home = path.join(d, 'home');
  const ev = path.join(home, 'ev');
  fs.mkdirSync(ev, { recursive: true });
  const r = spawnSync(process.execPath, [path.join(SCRIPTS_DIR, 'external-review.mjs'), '--reviewer', 'codex', '--prompt-file', path.join(d, 'prompt.md'),
    '--schema', '{"verdict":"PASS|RISK|FAIL"}', '--evidence-dir', ev, '--out', path.join(ev, 'out.json')],
  { cwd: REPO_ROOT, encoding: 'utf8', env: { ...env(), ...noRealReviewers(), QUORATE_HOME: home, QUORATE_REVIEWER_PROBES: path.join(d, 'probes') } });
  const out = JSON.parse(fs.readFileSync(path.join(ev, 'out.json'), 'utf8'));
  const reason = (out.not_checked ?? []).map((n) => n.reason).join(' | ');
  assert.match(reason, /prompt file refused/, `${reason}\n${r.stderr}`);
  assert.match(reason, /hard link/, reason);
  assert.equal(fs.existsSync(path.join(d, 'probes')) && fs.readdirSync(path.join(d, 'probes')).length > 0, false, 'a probe ran');
});

// A FIXTURE REPOSITORY WITH THE PANEL OFF, never this one's (the first red run of this test, against the plan's start
// commit, read the hard-linked question and asked this repository's live panel): decide reads --question before it
// reads the contract, so the refusal is seen there, and a decide that does not refuse stops at the panel switch,
// spawning nothing.
test('decide refuses a hard-linked --question file before any record is made', (t) => {
  const d = tmp(t, 'hl-decide-');
  const repo = path.join(d, 'repo');
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), ['# t', '', '```yaml', 'graph_contract_version: 5', 'project: t', 'commands:',
    '  build: ""', '  test: ""', 'review:', '  external_panel: false', '  decision_panel: off', '```', ''].join('\n'));
  spawnSync('git', ['init', '-q', '.'], { cwd: repo });
  spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=T', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: repo });
  fs.writeFileSync(path.join(d, 'other.json'), JSON.stringify({ question: 'Which?', options: [{ label: 'A' }, { label: 'B' }], category: 'delegable' }));
  const why = hardLink(path.join(d, 'other.json'), path.join(d, 'q.json'));
  if (why) { t.skip(why); return; }
  const r = spawnSync(process.execPath, [path.join(SCRIPTS_DIR, 'decide.mjs'), '--repo-root', repo, '--question', path.join(d, 'q.json')],
    { cwd: repo, encoding: 'utf8', env: { ...env(), ...noRealReviewers(), QUORATE_HOME: path.join(d, 'home') } });
  assert.notEqual(r.status, 0, 'a hard-linked question reached the panel');
  assert.match(r.stderr, /hard link/, r.stderr);
});

// ------------------------------------------------------------------------------------------------ claim-check
function claimFixture(t) {
  const dir = tmp(t, 'hl-claim-');
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), ['# fixture', '', '```yaml', 'graph_contract_version: 6', 'project: hl', 'commands:',
    '  build: ""', '  test: ""', 'source_globs: ["src/**"]', 'doc_paths: []', 'ui:', '  surface: none', 'review:',
    '  models: { judgment: opus }', '  effort: { judgment: low }', '```', ''].join('\n'));
  const git = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 'x@x'); git('config', 'user.name', 'x');
  git('add', '-A'); git('commit', '-qm', 'fixture');
  const check = path.join(repo, '.claude', 'claim-checks', 'c1');
  fs.mkdirSync(check, { recursive: true });
  fs.writeFileSync(path.join(repo, '.claude', 'claim-checks', '.gitignore'), '*\n');
  const bin = path.join(dir, 'fake.mjs');
  fs.writeFileSync(bin, "import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';\nfs.writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'ran'), 'x');\n");
  const run = (extra) => spawnSync(process.execPath, [path.join(SCRIPTS_DIR, 'claim-check.mjs'), check, '--check', '--runtime-bin', bin, ...extra],
    { cwd: repo, encoding: 'utf8', env: { ...env(), QUORATE_HOME: path.join(dir, 'home') } });
  return { dir, repo, check, run, ran: () => fs.existsSync(path.join(dir, 'ran')) };
}

test('claim-check refuses a hard-linked draft through the owner, exit 2, before a checker starts', (t) => {
  const f = claimFixture(t);
  fs.writeFileSync(path.join(f.dir, 'secret.txt'), 'another file\n');
  const why = hardLink(path.join(f.dir, 'secret.txt'), path.join(f.check, 'draft.md'));
  if (why) { t.skip(why); return; }
  const r = f.run([]);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /hard link/, r.stderr);
  assert.equal(f.ran(), false);
});

test('claim-check refuses a hard-linked --transcript, exit 2, before a checker starts', (t) => {
  const f = claimFixture(t);
  fs.writeFileSync(path.join(f.check, 'draft.md'), 'The build passes.\n');
  fs.writeFileSync(path.join(f.dir, 'secret.jsonl'), `${JSON.stringify({ type: 'user', message: { content: 'x' } })}\n`);
  const why = hardLink(path.join(f.dir, 'secret.jsonl'), path.join(f.dir, 'session.jsonl'));
  if (why) { t.skip(why); return; }
  const r = f.run(['--transcript', path.join(f.dir, 'session.jsonl')]);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /hard link/, r.stderr);
  assert.equal(f.ran(), false);
});
