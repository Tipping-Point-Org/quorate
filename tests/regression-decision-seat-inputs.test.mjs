// decision-records.plan.md stage 5 (design DR-D1 A): a seat receives nothing the asking session wrote as prose, and no
// Claude subagent of the panel runs where it could read the record. Three rules, each held here:
//   - a question's `stage` names a heading of the declared plan, by number or text, and the seat gets the PLAN's heading;
//   - the revote's note is written by a fresh subagent given only the question, its options and the work context (the
//     session's own note.md is never read, and blindText, the pattern filter it needed, is gone);
//   - every Claude call of the panel (seat, moderator, note author) runs with its cwd in an empty directory outside the
//     repository: spawn-subagent's --cwd, the contract still read from --repo-root by the spawner, not the model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from './helpers.mjs';
import * as panel from '../scripts/lib/decision-panel.mjs';
import { buildRevoteAuthorPrompt } from '../scripts/io/review-prompts.mjs';

const PLAN = '# Plan\n\n## Items\n\n### Stage 0 — bookkeeping\n\ntext\n\n### Stage 3 — the record\'s rules (R2)\n\nmore\n';

test('a stage names a heading the plan has, by number or text; the seat gets the plan\'s heading', () => {
  assert.equal(panel.stageHeading(PLAN, '3'), 'Stage 3 — the record\'s rules (R2)');
  assert.equal(panel.stageHeading(PLAN, 'Stage 0'), 'Stage 0 — bookkeeping');
  assert.equal(panel.stageHeading(PLAN, 'the record\'s rules'), 'Stage 3 — the record\'s rules (R2)');
  assert.equal(panel.stageHeading(PLAN, 'Stage 9'), null, 'a stage the plan does not have is not found');
  assert.equal(panel.stageHeading(PLAN, 'The earlier panel leaned to E2'), null, 'prose is not a stage');
  assert.equal(panel.stageHeading(PLAN, ''), null);
});

test('the revote author is given only the question, its options and the work context', () => {
  const p = buildRevoteAuthorPrompt({
    question: 'Which bound?', options: [{ label: 'Size cap' }, { label: 'Age cap' }], context: 'Request: x.plan.md',
    round1: 'Judge A chose E2', transcript: 'C:/Users/x/.claude/projects/p/s.jsonl', note: 'the earlier panel leaned to E2',
  });
  assert.match(p, /Which bound\?/);
  assert.match(p, /Size cap/);
  assert.match(p, /Request: x\.plan\.md/);
  for (const leak of [/Judge A chose/, /\.jsonl/, /leaned to E2/]) assert.doesNotMatch(p, leak);
  assert.equal(typeof panel.blindText, 'undefined', 'the pattern filter for the session\'s note is removed with the note');
});

test('every node-runtime call of the panel runs in an empty directory outside the repository', () => {
  const surface = path.join(os.tmpdir(), 'decision-surface-x');
  const call = panel.runtimeCall({ scripts: '/s', promptFile: '/rec/p.md', out: '/rec/o.json', result: '/rec/r.json', repoRoot: REPO_ROOT, surface });
  assert.equal(call.cwd, surface);
  assert.ok(!path.resolve(call.cwd).startsWith(path.resolve(REPO_ROOT)), 'the cwd is outside the repository');
  const i = call.argv.indexOf('--cwd');
  assert.ok(i > 0 && call.argv[i + 1] === surface, 'the model\'s own cwd is the surface');
  assert.equal(call.argv[call.argv.indexOf('--repo-root') + 1], REPO_ROOT, 'the spawner still reads the pins from the repository');
  assert.throws(() => panel.runtimeCall({ scripts: '/s', promptFile: '/p', out: '/o', result: '/r', repoRoot: REPO_ROOT, surface: path.join(REPO_ROOT, 'x') }), /outside the repository/);
});

test('spawn-subagent --cwd runs the model there, and the pins still come from --repo-root', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-cwd-'));
  const surface = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-surface-'));
  try {
    const bin = path.join(dir, 'fake.mjs');
    fs.writeFileSync(bin, "process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(JSON.stringify({type:'result',is_error:false,result:JSON.stringify({cwd:process.cwd()})})));");
    const prompt = path.join(dir, 'p.md'); fs.writeFileSync(prompt, 'hello');
    const env = { ...process.env }; delete env.GRAPH_NODE_DEPTH;
    const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'spawn-subagent.mjs'), '--prompt-file', prompt, '--out', path.join(dir, 'e.json'),
      '--result', path.join(dir, 'r.json'), '--repo-root', REPO_ROOT, '--cwd', surface, '--runtime-bin', bin], { encoding: 'utf8', env });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.realpathSync(JSON.parse(fs.readFileSync(path.join(dir, 'r.json'), 'utf8')).cwd), fs.realpathSync(surface));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(surface, { recursive: true, force: true }); }
});

test('decide.mjs reads no note.md and routes every node-runtime call through runtimeCall', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'decide.mjs'), 'utf8');
  assert.doesNotMatch(src, /[\/'"`]note\.md/, 'the session\'s note.md is never read');
  assert.match(src, /runtimeCall\(/);
  // The call is run exactly as runtimeCall built it: its argv (with --cwd) and its cwd, never edited on the way.
  assert.match(src, /await run\(call\.argv, call\.cwd\)/);
  assert.equal((src.match(/spawn-subagent\.mjs/g) ?? []).length, 0, 'decide.mjs names spawn-subagent only through runtimeCall');
  assert.doesNotMatch(src, /'spawn-subagent\.mjs'\)[^\n]*'--repo-root', repoRoot[^\n]*\], repoRoot\)/, 'no Claude call is spawned with the repository as its cwd');
});
