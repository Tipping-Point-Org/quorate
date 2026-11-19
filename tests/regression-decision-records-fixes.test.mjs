// decision-records.plan.md stage 7: four defects of review 20261101-042446-ar-remediation-4-review, and `--sample`'s
// spelling (design DR-D3 A). No seat and no model is reached: every call here is refused, or reads only, before a panel.
//   G-10: --revote never checked the saved question's category, so a reserved, missing or unknown one reached the panel.
//   G-14: the revote's claim was taken before the saved question was validated, so a malformed record left a claim that
//         held every later revote until it was removed by hand.
//   G-4:  finalOutcome refuses an unreadable outcome, and its callers let the throw escape as a stack trace.
//   G-7:  the documents said spends were counted per UTC day; they are counted per active run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript, REPO_ROOT, privateRecord } from './helpers.mjs';
import { ARGV_SPECS } from '../scripts/lib/argv-specs.mjs';

const ID = '20261101-010101-abcdef';
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
function repo() {
  const dir = tmp('decide-fix-');
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, '.gitignore'), '.claude/decisions/\n');
  git('add', '-A'); git('commit', '-qm', 'init');
  return dir;
}
function decision(dir, question, outcome) {
  const d = path.join(dir, '.claude', 'decisions', ID);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'question.json'), JSON.stringify(question));
  fs.writeFileSync(path.join(d, 'outcome.json'), typeof outcome === 'string' ? outcome : JSON.stringify(outcome));
  return d;
}

test('G-10: --revote refuses a reserved, missing or unknown category before anything else', () => {
  for (const category of ['approval', undefined, 'maybe']) {
    const dir = repo();
    try {
      decision(dir, { question: 'q', options: [{ label: 'A' }, { label: 'B' }], category }, { outcome: 'revote' });
      const r = runScript('decide.mjs', ['--revote', ID, '--repo-root', dir]);
      assert.equal(r.status, 2, r.output);
      assert.match(r.output, /reserved|category/, `${category}: ${r.output}`);
      assert.doesNotMatch(r.output, /contract/, 'refused before the contract is read');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('G-14: a malformed saved question is refused before the revote takes its claim', () => {
  const dir = repo();
  try {
    const d = decision(dir, { question: 'q', options: [{ label: 'only one' }], category: 'delegable' }, { outcome: 'revote' });
    const r = runScript('decide.mjs', ['--revote', ID, '--repo-root', dir]);
    assert.equal(r.status, 2, r.output);
    assert.match(r.output, /cannot be asked|two options/);
    assert.equal(fs.existsSync(path.join(d, 'revote')), false, 'no claim was left behind');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('G-4: an unreadable outcome stops --pending, --overrule and --sample with its reason, never a stack trace', () => {
  const dir = repo();
  try {
    decision(dir, { question: 'q', options: [{ label: 'A' }, { label: 'B' }], category: 'delegable' }, '{ not json');
    for (const args of [['--pending'], ['--overrule', ID, '--operator-quote', 'no'], ['--sample']]) {
      const r = runScript('decide.mjs', [...args, '--repo-root', dir]);
      assert.equal(r.status, 1, `${args[0]}: ${r.output}`);
      assert.match(r.output, /not JSON/, args[0]);
      assert.doesNotMatch(r.output, /\n\s+at .+:\d+:\d+/, `${args[0]} printed a stack trace`);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('G-7: the documents count spends per active run, nowhere per UTC day', () => {
  const doc = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'claude-md-contract.md'), 'utf8');
  const at = doc.indexOf('**`run_spend_max`');
  assert.ok(at >= 0);
  assert.match(doc.slice(at, at + 1200), /active run|per run/);
  for (const f of ['shared/claude-md-contract.md', 'shared/session-rules.md', 'QUORATE.md']) {
    assert.doesNotMatch(fs.readFileSync(path.join(REPO_ROOT, f), 'utf8'), /spends?[^\n]{0,80}per UTC day|UTC day[^\n]{0,80}spends?/i, f);
  }
});

test('--sample is a switch with --size <n>, in the argv table, the usage and the plan', { skip: privateRecord('.claude/requests/autonomous-run.plan.md') }, () => {
  const spec = ARGV_SPECS.decide.options;
  assert.equal(spec.sample, 'boolean');
  assert.equal(spec.size, 'string');
  assert.match(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'decide.mjs'), 'utf8'), /--sample \[--size <n>\]/);
  const plan = fs.readFileSync(path.join(REPO_ROOT, '.claude', 'requests', 'autonomous-run.plan.md'), 'utf8');
  assert.match(plan, /decide\.mjs --sample \[--size <n>\]/);
  assert.doesNotMatch(plan.slice(plan.indexOf('### Stage 8 — the measure')), /^- An after-the-fact sample: `decide\.mjs --sample <n>`/m);
});
