// Review 20261101-032931-ar-remediation-3-review, remediated in 20261101-040217-ar-remediation-4. No seat and no model is
// reached from this file: every call is refused before the panel is asked.
//   G-9 (its link half): --revote read its record's files with a raw readFileSync, so a file that is a link sent whatever
//        it led to into the prompts of the external seats. A link is refused (ARCHITECTURE A-30), whatever it leads to.
//   G-10: a new decision's question was validated by runDecision, after its record directory was made, so a question
//        with fewer than two options left a record the panel was never asked about. It is refused before anything else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript } from './helpers.mjs';

const Q = { question: 'Which bound?', options: [{ label: 'Size cap' }, { label: 'Age cap' }], category: 'delegable' };
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

function repo() {
  const dir = tmp('decide-note-');
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, '.gitignore'), '.claude/decisions/\n');
  git('add', '-A'); git('commit', '-qm', 'init');
  return dir;
}

// G-9's note.md half is gone with the note itself: decision-records.plan.md stage 5 has a fresh blind subagent write the
// revote's note, and decide.mjs reads no note.md (tests/regression-decision-seat-inputs.test.mjs holds that).

test('G-9: a question.json that is a link is refused before the revote reads it', () => {
  const dir = repo();
  const outside = tmp('decide-q-outside-');
  try {
    const id = '20261031-120000-abcdef';
    const rec = path.join(dir, '.claude', 'decisions', id);
    fs.mkdirSync(rec, { recursive: true });
    const real = path.join(outside, 'question.json');
    fs.writeFileSync(real, JSON.stringify(Q));
    fs.writeFileSync(path.join(rec, 'outcome.json'), JSON.stringify({ outcome: 'revote' }));
    fs.writeFileSync(path.join(rec, 'note.md'), 'the note');
    // A file link where the platform allows one; otherwise a junction, which is a link to lstat all the same.
    try { fs.symlinkSync(real, path.join(rec, 'question.json'), 'file'); } catch { fs.symlinkSync(outside, path.join(rec, 'question.json'), 'junction'); }
    const r = runScript('decide.mjs', ['--revote', id, '--repo-root', dir]);
    assert.equal(r.status, 2, r.output);
    // Refused by the one owner since decision-records.plan.md stage 6, in its words (ARCHITECTURE A-30).
    assert.match(r.output, /question\.json.*(is a link|a link or junction stands here)/, `a linked question was not what refused the revote: ${r.output}`);
  } finally { for (const d of [dir, outside]) fs.rmSync(d, { recursive: true, force: true }); }
});

test('G-10: a question with fewer than two options is refused first, and no record is made', () => {
  const dir = repo();
  try {
    const f = path.join(dir, 'q.json');
    fs.writeFileSync(f, JSON.stringify({ ...Q, options: [{ label: 'Only one' }] }));
    const r = runScript('decide.mjs', ['--question', f, '--repo-root', dir]);
    assert.equal(r.status, 2, r.output);
    assert.match(r.output, /at least two options/, `the malformed question was not what refused it: ${r.output}`);
    const root = path.join(dir, '.claude', 'decisions');
    const made = fs.existsSync(root) ? fs.readdirSync(root).filter((n) => /^\d{8}-\d{6}-/.test(n)) : [];
    assert.deepEqual(made, [], 'a refused question left a decision record');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
