// G-2 of 20261111-024650-dps-remediation-11-review (panel-codex-security, LOW). external-review promises one structured
// response for a refusal, but a --probe-run call checks its prompt file before `consent` is bound, and the envelope reads
// `consent`: a link below the run made the prompt's read refuse, and the refusal died on a temporal-dead-zone
// ReferenceError instead of reporting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { repoRunDir, runScript } from './helpers.mjs';

test('G-2: a --probe-run prompt file behind a link below the run is refused with the structured response', (t) => {
  const { base, dir } = repoRunDir({ prefix: 'quorate-probe-prompt-' });
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const outside = path.join(base, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'prompt.md'), 'Review.\n');
  fs.symlinkSync(outside, path.join(dir, 'linked'), 'junction');

  const r = runScript('external-review.mjs', ['--probe-run', '--reviewer', 'codex', '--consent', 'transport-probe',
    '--run-dir', dir, '--node-id', 'probe-codex-review', '--prompt-file', path.join(dir, 'linked', 'prompt.md'),
    '--schema', '{"verdict":"PASS|RISK|FAIL"}']);

  assert.doesNotMatch(r.output, /ReferenceError/, r.output);
  const out = JSON.parse(r.stdout);
  assert.equal(out.verdict, 'RISK', r.output);
  assert.match(JSON.stringify(out.not_checked), /prompt file refused/, r.output);
  assert.equal(out.egress_basis, null, 'nothing was decided about egress, so none is claimed');
});

// G-4 of 20261111-042301-dps-a5-review (panel-codex-code, MEDIUM): a prompt file outside the admitted run was read with no
// guard after an existence check, so a directory, an unreadable file or a read race threw instead of reporting.
test('G-4: a --prompt-file outside the run that cannot be read is reported through the structured response', (t) => {
  const { base, dir } = repoRunDir({ prefix: 'quorate-prompt-unreadable-' });
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const notAFile = path.join(base, 'a-directory');
  fs.mkdirSync(notAFile);

  const r = runScript('external-review.mjs', ['--probe-run', '--reviewer', 'codex', '--consent', 'transport-probe',
    '--run-dir', dir, '--node-id', 'probe-codex-review', '--prompt-file', notAFile,
    '--schema', '{"verdict":"PASS|RISK|FAIL"}']);

  assert.doesNotMatch(r.output, /EISDIR[\s\S]*at /, r.output);
  const out = JSON.parse(r.stdout);
  assert.equal(out.verdict, 'RISK', r.output);
  assert.match(JSON.stringify(out.not_checked), /prompt file refused/, r.output);
});
