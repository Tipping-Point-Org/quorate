// Two findings of 20261110-025747-dps-remediation-5-review, both in scripts/decide.mjs, each driven through the script.
//
// G-2: doc_roles.request was read through path.join(repoRoot, requestPath) with neither the grammar the mint holds it to
// (contractGlobErrors) nor the confined owner, so a `../` value read a file outside the repository and put a matching
// heading into the work context sent to the external seats; and with no stage the path itself was still named to them.
//
// G-4: runSeat discarded run()'s {code, err}, so an external seat whose process died before writing an envelope was
// recorded only as "it wrote no envelope", and the failure itself, which the plan's stage 4 says a round records, was lost.
//
// external-review.mjs is stubbed through NODE_OPTIONS, in the child only: decide.mjs spawns the real path beside itself,
// and a reviewer fake cannot make that script die before its envelope.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from './helpers.mjs';

const STUB_LINE = 'external-review stub: the seat could not start';
const HEADING = 'Stage 1 — the words only this plan holds';
const ID = /^\d{8}-\d{6}-[0-9a-f]{6}$/;

function fixture(t, request, { stage = 1 } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dps-rb-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(path.join(repo, '.claude', 'requests'), { recursive: true });
  const git = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
  git('init', '-q', '.');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'T');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), ['# t', '', '```yaml', 'graph_contract_version: 5', 'project: t', 'commands:',
    '  build: ""', '  test: ""', 'doc_roles:', `  request: "${request}"`, 'review:', '  external_panel: true', '  decision_panel: on',
    '  grounding_floor: convention', '  models: { judgment: opus, mechanical: sonnet }', '  effort: { judgment: low }', '```', ''].join('\n'));
  fs.writeFileSync(path.join(repo, '.gitignore'), '.claude/decisions/\n');
  fs.writeFileSync(path.join(repo, '.claude', 'requests', 'p.md'), `# Plan\n\n## ${HEADING}\n`);
  git('add', '-A');
  git('commit', '-qm', 'init');

  const stub = path.join(dir, 'stub.mjs');
  fs.writeFileSync(stub, ["import fs from 'node:fs';", 'if (/external-review\\.mjs$/.test(process.argv[1] ?? \'\')) {',
    `  fs.writeSync(2, ${JSON.stringify(`${STUB_LINE}\n`)});`, '  process.exit(7);', '}'].join('\n'));
  const runtime = path.join(dir, 'fake-runtime.mjs');
  const seat = { status: 'ok', choice: 'E1', rationale: 'r', other_text: '', change_of: '', what_would_change: 'w', citations: [] };
  fs.writeFileSync(runtime, ["import fs from 'node:fs';", "try { fs.readFileSync(0, 'utf8'); } catch {}",
    `process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0, result: ${JSON.stringify(JSON.stringify(seat))} }));`].join('\n'));

  const q = path.join(dir, 'question.json');
  fs.writeFileSync(q, JSON.stringify({ question: 'Which bound?', options: [{ label: 'Size cap' }, { label: 'Age cap' }], category: 'delegable', ...(stage === null ? {} : { stage }) }));
  const env = { ...process.env, QUORATE_HOME: path.join(dir, 'home'), QUORATE_REVIEWER_PROBES: path.join(dir, 'probes'), NODE_OPTIONS: `--import=${pathToFileURL(stub).href}` };
  delete env.GRAPH_NODE_DEPTH;
  const decide = () => spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'decide.mjs'), '--repo-root', repo, '--question', q, '--runtime-bin', runtime],
    { cwd: repo, encoding: 'utf8', env, timeout: 240_000 });
  const decisions = path.join(repo, '.claude', 'decisions');
  const records = () => (fs.existsSync(decisions) ? fs.readdirSync(decisions).filter((n) => ID.test(n)) : []);
  return { dir, repo, decide, decisions, records };
}

for (const [name, request, stage] of [
  ['a `..` value with a stage', '../outside.md', 1],
  ['a `..` value with no stage, whose path would still be named to the seats', '../outside.md', null],
  ['an absolute value', '/outside.md', 1],
]) {
  test(`G-2: doc_roles.request is refused as the mint refuses it: ${name}`, (t) => {
    const f = fixture(t, request, { stage });
    fs.writeFileSync(path.join(f.dir, 'outside.md'), `# Outside\n\n## ${HEADING}\n`);
    const r = f.decide();
    assert.equal(r.status, 2, `the request was not refused:\n${r.stderr}\n${r.stdout}`);
    assert.match(r.stderr, /doc_roles\.request/, r.stderr);
    assert.deepEqual(f.records(), [], 'a record was made, so the panel was asked');
  });
}

test('G-2: a request reached through a link inside the repository is refused, its heading never sent', (t) => {
  const f = fixture(t, 'plans/outside.md');
  const outside = path.join(f.dir, 'elsewhere');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'outside.md'), `# Outside\n\n## ${HEADING}\n`);
  fs.symlinkSync(outside, path.join(f.repo, 'plans'), 'junction');
  const r = f.decide();
  assert.equal(r.status, 2, `the link was followed:\n${r.stderr}\n${r.stdout}`);
  assert.match(r.stderr, /link or junction/, r.stderr);
  assert.deepEqual(f.records(), [], 'a record was made, so the panel was asked');
});

test('G-2: a declared request inside the repository still gives its heading, and a leading ./ reaches the seat\'s copy', (t) => {
  const f = fixture(t, './.claude/requests/p.md');
  const r = f.decide();
  assert.equal(r.status, 0, `${r.stderr}\n${r.stdout}`);
  const [id] = f.records();
  const names = fs.readdirSync(path.join(f.decisions, id));
  const brief = names.find((n) => /^seat-.*-brief\.md$/.test(n));
  assert.ok(brief, `no seat brief among ${names.join(', ')}`);
  assert.match(fs.readFileSync(path.join(f.decisions, id, brief), 'utf8'), new RegExp(HEADING), 'the stage heading did not reach the seat');
  const copies = JSON.parse(fs.readFileSync(path.join(f.decisions, id, names.find((n) => /-copies\.json$/.test(n))), 'utf8'));
  assert.ok(copies.copied.includes('.claude/requests/p.md'), `the request was not copied for the seat: ${JSON.stringify(copies)}`);
});

test('G-4: an external seat whose process dies before an envelope keeps its exit and last line in the record and the outcome', (t) => {
  const f = fixture(t, '.claude/requests/p.md');
  const r = f.decide();
  assert.equal(r.status, 0, `${r.stderr}\n${r.stdout}`);
  const [id] = f.records();
  const outcome = JSON.parse(fs.readFileSync(path.join(f.decisions, id, 'outcome.json'), 'utf8'));
  assert.equal(outcome.outcome, 'seats-unavailable');
  const round = JSON.parse(fs.readFileSync(path.join(f.decisions, id, 'round-1-seats.json'), 'utf8'));
  for (const [where, silent] of [['the outcome', outcome.silent], ['the round', round.silent]]) {
    assert.equal(silent.length, 2, `${where} does not name both silent seats`);
    for (const s of silent) {
      assert.match(s.why, /wrote no envelope/, `${where}: ${s.seat}: ${s.why}`);
      assert.match(s.why, /exit 7/, `${where}: ${s.seat}'s exit was lost: ${s.why}`);
      assert.ok(s.why.includes(STUB_LINE), `${where}: ${s.seat}'s failure was lost: ${s.why}`);
    }
  }
});
