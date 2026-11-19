// claim-check-cross-family.plan.md stage 2 (operator, 2026-10-18: "Cross-family when the panel is on (Recommended)").
// With the panel on, claim-check's checker runs in the other family through `external-review --mode claim-check`. The
// mode's native schema is the result shape claim-check.mjs already validates, one owner for its kinds, grades and
// verdicts; its prompt is CHECKER.md unchanged with one override, since an arm cannot write the result file; and like
// every mode it is probed before its first use, or the call would be refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, runScript, withTempDir, seedReviewerProbe } from './helpers.mjs';
import * as schemas from '../scripts/lib/reviewer-schemas.mjs';
import { CLAIM_KINDS, GRADES, VERDICTS, resultShapeErrors } from '../scripts/lib/claim-check.mjs';
import { supportsMode } from '../scripts/lib/reviewers.mjs';
import { probePassed, schemaRoute, unavailableSubject } from '../scripts/lib/reviewer-probe.mjs';
import { UNAVAILABLE_ROLES } from '../scripts/lib/decisions.mjs';

const { validateStrict } = schemas;
const claimCheckSchema = (...a) => {
  assert.equal(typeof schemas.claimCheckSchema, 'function', 'lib/reviewer-schemas.mjs has no claimCheckSchema');
  return schemas.claimCheckSchema(...a);
};

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const claim = (over = {}) => ({
  id: 'C1', text: 'the claim', kind: 'behaviour',
  search: { looked_for: 'a reason it is not so', where: ['scripts/x.mjs'], found: 'nothing' },
  grade: 'observed', citations: [{ file: 'CLAUDE.md', lines: '1', command: '' }], trigger: '',
  counter_question: { question: 'is it?', answer: '' }, operator_only: false, verdict: 'stands', ...over,
});
const answer = (over = {}) => ({ status: 'ok', reason: '', schema_version: 1, claims: [claim()], not_checked: [], ...over });

test('claimCheckSchema is strict, and its enums are the ones resultShapeErrors checks', () => {
  const s = claimCheckSchema();
  assert.deepEqual(validateStrict(s), []);
  const item = s.properties.claims.items;
  assert.deepEqual(item.properties.kind.enum, CLAIM_KINDS);
  assert.deepEqual(item.properties.grade.enum, GRADES);
  assert.deepEqual(item.properties.verdict.enum, VERDICTS);
  for (const k of ['id', 'text', 'kind', 'grade', 'verdict', 'search', 'citations', 'counter_question']) {
    assert.ok(item.required.includes(k), `the schema does not require ${k}, which resultShapeErrors does`);
  }
  assert.ok(s.required.includes('not_checked'), 'a result without not_checked is refused by claim-check.mjs, so the schema must require it');
});

test('a schema-shaped answer passes resultShapeErrors, and one without not_checked fails it', () => {
  assert.deepEqual(resultShapeErrors(answer()), []);
  const { not_checked, ...without } = answer();
  assert.ok(resultShapeErrors(without).length > 0);
});

test('the mode exists, and an adapter whose modes list omits it is refused', () => {
  assert.match(read('scripts/external-review.mjs'), /const MODES = \[[^\]]*'claim-check'/);
  const table = JSON.parse(read('scripts/reviewers.json')).reviewers;
  assert.equal(supportsMode(table['codex-review'], 'claim-check'), false);
  assert.equal(supportsMode(table.codex, 'claim-check'), true);
});

test('the arm prompt carries CHECKER.md byte for byte, the paths, and the one override', async () => {
  const { buildClaimCheckArmPrompt } = await import('../scripts/io/review-prompts.mjs');
  assert.equal(typeof buildClaimCheckArmPrompt, 'function', 'io/review-prompts.mjs has no buildClaimCheckArmPrompt');
  const checker = read('skills/claim-check/CHECKER.md');
  const p = buildClaimCheckArmPrompt({ checker, draftPath: 'D:/d/draft.md', repoRoot: 'D:/repo', transcriptPath: null });
  assert.ok(p.includes(checker), 'CHECKER.md is not carried unchanged');
  assert.match(p, /D:\/d\/draft\.md/);
  assert.match(p, /D:\/repo/);
  assert.match(p, /return the JSON as your whole answer/i);
  assert.doesNotMatch(p, /transcript:/i, 'no transcript was given, and the prompt names one');
  const withT = buildClaimCheckArmPrompt({ checker, draftPath: 'a', repoRoot: 'b', transcriptPath: 'D:/d/transcript.redacted.jsonl' });
  assert.match(withT, /D:\/d\/transcript\.redacted\.jsonl/);
});

test('the probe: native route, a pass rule of its own, and a subject run-graph recognises', () => {
  assert.equal(schemaRoute('claim-check'), 'native');
  // The answer the probe template prescribes, field for field (G-13 of 20261103-191032-dr-remediation-3-review).
  const probeClaim = claim({ id: 'probe', text: 'probe', kind: 'other', grade: 'inferred', citations: [],
    search: { looked_for: 'probe', where: [], found: '' }, counter_question: { question: 'probe', answer: '' } });
  const ok = { result: { claims: [probeClaim], not_checked: [] }, not_checked: [] };
  assert.equal(probePassed('claim-check', ok), true);
  assert.equal(probePassed('claim-check', { result: { claims: [claim()], not_checked: [] }, not_checked: [] }), false);
  assert.equal(probePassed('claim-check', { result: null, not_checked: [] }), false);
  assert.equal(unavailableSubject('claim-check', 'codex'), "claim checker 'codex'");
  assert.ok(UNAVAILABLE_ROLES.includes('claim checker'));
  assert.ok(fs.existsSync(path.join(REPO_ROOT, 'prompts', '_templates', 'reviewer-probe-claim-check.md')));
});

// FOUND LIVE (2026-10-18, the first real call): the probe asked for "one claim whose id is probe" and named only some of
// its fields; codex answered the strict schema with `search.looked_for` and `counter_question.question` empty, which
// resultShapeErrors refuses, so every claim-check call was refused at its preflight. The probe names every value the
// shape check requires to be non-empty.
test('the probe prompt asks for a value in every field resultShapeErrors requires non-empty', () => {
  const p = read('prompts/_templates/reviewer-probe-claim-check.md');
  for (const field of ['looked_for', 'question', 'text', 'id']) {
    assert.match(p, new RegExp(`\`${field}\` "probe"`), `the probe does not ask for a non-empty ${field}`);
  }
});

function fakeCodex(dir, body) {
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, 'fake-codex.mjs'), [
    "import fsx from 'node:fs';",
    'const a = process.argv;',
    "const i = a.indexOf('--output-last-message');",
    `const body = ${JSON.stringify(body)};`,
    'if (i !== -1 && a[i + 1]) fsx.writeFileSync(a[i + 1], body);',
    'process.stdout.write(body);',
    '',
  ].join('\n'));
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(binDir, 'codex.cmd'), `@"${process.execPath}" "%~dp0fake-codex.mjs" %*\r\n`);
  } else {
    const shim = path.join(binDir, 'codex');
    fs.writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/fake-codex.mjs" "$@"\n`);
    fs.chmodSync(shim, 0o755);
  }
  return binDir;
}

function launch(dir, body) {
  const binDir = fakeCodex(dir, JSON.stringify(body));
  const home = path.join(dir, 'home');
  const sink = path.join(home, 'ev');
  fs.mkdirSync(sink, { recursive: true });
  const prompt = path.join(dir, 'prompt.md');
  fs.writeFileSync(prompt, 'Check the draft.');
  const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
  const pathValue = `${binDir}${path.delimiter}${process.env[pathKey] ?? ''}`;
  const probes = path.join(dir, 'probes');
  seedReviewerProbe(probes, { mode: 'claim-check', route: 'native', pathValue });
  const out = path.join(sink, 'arm.json');
  const r = runScript('external-review.mjs', ['--reviewer', 'codex', '--mode', 'claim-check', '--prompt-file', prompt,
    '--evidence-dir', sink, '--out', out], { env: { [pathKey]: pathValue, QUORATE_HOME: home, QUORATE_REVIEWER_PROBES: probes } });
  return { r, out };
}

test('end to end: the arm\'s result is recorded with its source, settings and egress basis', () => {
  withTempDir((dir) => {
    const { r, out } = launch(dir, answer());
    assert.equal(r.status, 0, r.output);
    const rec = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(rec.source, 'codex');
    assert.equal(rec.result.claims[0].id, 'C1');
    assert.deepEqual(rec.result.not_checked, []);
    assert.equal('status' in rec.result, false, 'the adapter\'s status field leaked into the checker\'s result');
    assert.ok('egress_basis' in rec);
  });
});

test('end to end: a result claim-check.mjs would refuse is not passed on as one', () => {
  withTempDir((dir) => {
    const { r, out } = launch(dir, answer({ claims: [] }));
    const rec = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(rec.result, null, `a refused shape was passed on: ${r.output}`);
    assert.ok(rec.not_checked.some((n) => /^claim checker 'codex'/.test(n.item)), JSON.stringify(rec.not_checked));
  });
});
