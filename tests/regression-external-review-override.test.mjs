// reviewer-credential-routing.plan.md stage 3 (D1 = A, A-26): external-review is the one egress, so it
// names an override of the built-in it calls. One stderr line per call, and `reviewer_override` on EVERY
// response shape (review, propose, tie-break, and the unavailable form each of them writes), so a caller
// that reads only the record — candidate-pool, /request, a judge — still has it. Absent when nothing is
// overridden. The --preflight-only success record does not gain it: run.json freezes that record.
//
// The run's frozen contract keeps the panel off, so each call is refused on CONSENT and answers through
// its mode's own emitter with no reviewer spawned (tests/regression-declared-reviewers.test.mjs's route).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runScript, repoRunDir } from './helpers.mjs';

function withContract(contract, fn) {
  const { base, dir } = repoRunDir({ runId: '20260101-000000-ovrrev', json: { contract } });
  try {
    fs.writeFileSync(path.join(dir, 'p.md'), 'review this');
    return fn(dir);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
}

const MODES = {
  review: [],
  propose: ['--schema', '{"candidates":"array"}'],
  'tie-break': [],
};

const call = (dir, mode) => runScript('external-review.mjs', [
  '--reviewer', 'codex', '--mode', mode, '--prompt-file', path.join(dir, 'p.md'), '--run-dir', dir, ...MODES[mode],
]);

for (const mode of Object.keys(MODES)) {
  test(`--mode ${mode}: an overridden built-in is named on stderr and in the response`, () => {
    withContract({ reviewers: { codex: { cmd: 'other-codex' } }, review: { external_panel: false } }, (dir) => {
      const r = call(dir, mode);
      const env = JSON.parse(r.stdout);
      assert.match(env.egress_basis ?? '', /external_panel is not true/, `precondition: refused on consent\n${r.output}`);
      assert.deepEqual(env.reviewer_override,
        { name: 'codex', roles: ['reviewer'], fields: ['cmd'], prefixes: ['CODEX_', 'OPENAI_'] });
      assert.match(r.stderr, /codex — cmd set by the contract; CODEX_\*, OPENAI_\* go to it/);
    });
  });

  test(`--mode ${mode}: no override, no field and no line`, () => {
    withContract({ review: { external_panel: false } }, (dir) => {
      const r = call(dir, mode);
      const env = JSON.parse(r.stdout);
      assert.equal('reviewer_override' in env, false);
      assert.doesNotMatch(r.stderr, /set by the contract/);
    });
  });
}
