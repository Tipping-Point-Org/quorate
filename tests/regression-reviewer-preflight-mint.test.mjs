// Part 2 of 6 of regression-reviewer-preflight.test.mjs: the age limit and the mint check. Split by
// split-slow-test-files.md; the fixture is reviewer-preflight-fixture.mjs.

// The host-bound one, as new-run mints with it: it keys the repository as the filesystem spells it (8.3, CI run 43281517496).
import { defaultReviewsRoot } from '../scripts/io/reviews-root.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adapterErrors } from '../scripts/lib/reviewers.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { probeKey, KEY_FIELDS, recordCounts, probePassed, probeLimits, maxAgeHoursOf, adapterHash, PROBE_REVIEW_SCHEMA } from '../scripts/lib/reviewer-probe.mjs';
import { cliVersion, readProbeRecord, writeProbeRecord } from '../scripts/io/reviewer-probe.mjs';
import { REPO_ROOT, runScript, seedReviewerProbe, noRealReviewers } from './helpers.mjs';
import { classifyPanelProbe } from '../scripts/lib/decisions.mjs';
import { CAPPING_STAMPS } from '../scripts/lib/decisions.mjs';
import { base, combo, tmpHome, worker, run, safePathDirs, fakeReviewer, REVIEW_OK, setup2, calls, UNIVERSAL_OK, FAST_LIMITS, BOUND_MS, agyIsTheFake, mintFixture } from './reviewer-preflight-fixture.mjs';

test('stage 2: the age limit reaches the check from the contract — live, frozen, and under --consent; that consent is a probe\'s only (G-3)', (t) => {
  const { fake, dir } = setup2(t, { body: REVIEW_OK });
  const repo = path.join(dir, 'repo');
  const home = path.join(dir, 'home'); // a run under the engine's home is the only kind --run-dir accepts (G-9)
  fs.mkdirSync(repo, { recursive: true });
  spawnSync('git', ['init', '-q', repo]); // --run-dir is confined to a tree, and the live contract is read from one
  const contract = (age) => ['# fixture', '', '```yaml', 'graph_contract_version: 5', 'project: pf', 'commands:', '  build: ""', '  test: ""',
    'source_globs: ["src/**"]', 'doc_paths: []', 'ui:', '  surface: none', '  static_bundle: ""', 'review:', '  external_panel: true',
    ...(age === undefined ? [] : [`  reviewer_probe_max_age_hours: ${age === '' ? '""' : age}`]), '```', ''].join('\n');
  const prompt = path.join(dir, 'prompt.md');
  // A record `hours` old, for exactly the combination this call uses.
  const seedAged = (probes, hours) => {
    const rec = seedReviewerProbe(probes, { mode: 'review', route: 'native', pathValue: fake.pathValue });
    rec.checked_at = new Date(Date.now() - hours * 3_600_000).toISOString();
    fs.writeFileSync(path.join(probes, `${rec.key}.json`), JSON.stringify(rec));
  };
  const probedAfter = (age, hours, extra = []) => {
    fs.writeFileSync(path.join(repo, 'CLAUDE.md'), contract(age));
    const probes = fs.mkdtempSync(path.join(dir, 'p-'));
    seedAged(probes, hours);
    fs.rmSync(fake.log, { force: true });
    const r = runScript('external-review.mjs', ['--reviewer', 'codex', '--prompt-file', prompt, '--schema', '{"verdict":"PASS|RISK|FAIL"}', ...extra],
      { cwd: repo, env: { [fake.pathKey]: fake.pathValue, QUORATE_REVIEWER_PROBES: probes, QUORATE_HOME: home } });
    // The reviewer must have been CALLED: a call refused for any other reason probes nothing either, and would pass the
    // "not re-probed" cases for the wrong reason (the frozen case did, before its run moved under the engine's home).
    assert.equal(r.status, 0, r.output);
    assert.equal(calls(fake).at(-1), 'call', r.output);
    return calls(fake).includes('probe');
  };
  fs.writeFileSync(prompt, 'Review.\n');
  assert.equal(probedAfter(undefined, 25), true, 'absent: 24 h, so a 25 h record is re-probed');
  assert.equal(probedAfter('', 25), false, '"": no age limit');
  assert.equal(probedAfter(1, 2), true, '1: a 2 h record is re-probed');
  assert.equal(probedAfter(1, 2, ['--consent', 'transport-probe']), true, 'under --consent the limit is still read from the live contract');
  // A run's FROZEN contract: what the run was minted with decides, not what the live file says now.
  // Staged where this repository's runs are, naming it, so external-review admits it (ARCHITECTURE A-28).
  const run = path.join(defaultReviewsRoot({ project: 'pf', repoRoot: repo, home }), 'pf-frozen');
  fs.mkdirSync(run, { recursive: true });
  const frozen = (age) => fs.writeFileSync(path.join(run, 'run.json'), JSON.stringify({
    run_id: 'pf-frozen', repo_root: repo, contract: { review: { external_panel: true, ...(age === undefined ? {} : { reviewer_probe_max_age_hours: age }) } },
  }));
  frozen('');
  assert.equal(probedAfter(1, 2, ['--run-dir', run, '--node-id', 'panel-codex-code']), false, 'frozen "" wins over a live 1');
  frozen(1);
  assert.equal(probedAfter('', 2, ['--run-dir', run, '--node-id', 'panel-codex-code']), true, 'frozen 1 wins over a live ""');

  // G-3 of 20261020-151402-argv-delivery (panel-codex-security): `--consent transport-probe` opened the egress gate in
  // every mode, so an ordinary review passing it sent its prompt out under external_panel: false. It is the PROBE's
  // consent: it opens the gate for --probe-run and --preflight-only, and a call is decided by the contract. Here rather
  // than in a test of its own, so the suite's stated count (CLAUDE.md, outside a remediation's reach) still holds.
  const off = path.join(dir, 'repo-off');
  fs.mkdirSync(off, { recursive: true });
  spawnSync('git', ['init', '-q', off]);
  fs.writeFileSync(path.join(off, 'CLAUDE.md'), contract(undefined).replace('external_panel: true', 'external_panel: false'));
  const env = { [fake.pathKey]: fake.pathValue, QUORATE_REVIEWER_PROBES: fs.mkdtempSync(path.join(dir, 'p-')), QUORATE_HOME: home };
  fs.rmSync(fake.log, { force: true });
  const r = runScript('external-review.mjs', ['--reviewer', 'codex', '--prompt-file', prompt, '--schema', '{"verdict":"PASS|RISK|FAIL"}',
    '--consent', 'transport-probe'], { cwd: off, env });
  assert.deepEqual(calls(fake), [], `G-3: a call under the probe's consent reached the reviewer\n${r.output}`);
  const out = JSON.parse(r.stdout);
  assert.match(out.egress_basis ?? '', /external_panel is not true/, 'G-3: refused on the contract');
  assert.match(out.egress_basis ?? '', /--consent transport-probe opens the gate only for a probe/, 'G-3: and the refusal says why');
  // The probe's own path still runs with the panel off: check-reviewers checks a panel before it is enabled (G-1 below).
  const p = runScript('external-review.mjs', ['--preflight-only', '--reviewer', 'codex', '--mode', 'review', '--consent', 'transport-probe'],
    { cwd: off, env });
  assert.equal(p.status, 0, p.output);
  assert.deepEqual(calls(fake), ['probe'], 'G-3: the preflight probed, under the consent it exists for');

  // G-2 of 20261020-172345-argv-remediation-review: --probe-run is a public flag, so a caller could pass it beside the
  // probe's consent with a prompt, schema and directory of its own and send them out under external_panel: false. Under
  // --probe-run the input is the probe's own or the call is refused, before anything is sent (exit 2).
  const probeSchema = PROBE_REVIEW_SCHEMA;
  const probePrompt = path.join(dir, 'probe-own.md');
  fs.writeFileSync(probePrompt, fs.readFileSync(path.join(REPO_ROOT, 'prompts', '_templates', 'reviewer-probe-review.md'), 'utf8'));
  const emptyRepo = fs.mkdtempSync(path.join(dir, 'surface-'));
  spawnSync('git', ['init', '-q', '--template='], { cwd: emptyRepo });
  const forged = {
    'its own prompt': ['--prompt-file', prompt, '--schema', probeSchema, '--surface', emptyRepo],
    'its own schema': ['--prompt-file', probePrompt, '--schema', '{"verdict":"PASS|RISK|FAIL"}', '--surface', emptyRepo],
    'a directory with files in it': ['--prompt-file', probePrompt, '--schema', probeSchema, '--surface', off],
    'no directory, so the reviewer starts here': ['--prompt-file', probePrompt, '--schema', probeSchema],
  };
  for (const [what, extra] of Object.entries(forged)) {
    fs.rmSync(fake.log, { force: true });
    const f = runScript('external-review.mjs', ['--probe-run', '--reviewer', 'codex', '--consent', 'transport-probe', ...extra],
      { cwd: off, env });
    assert.deepEqual(calls(fake), [], `G-2: a --probe-run call with ${what} reached the reviewer\n${f.output}`);
    assert.equal(f.status, 2, `G-2: refused as a usage error (${what})\n${f.output}`);
    assert.match(f.stderr, /--probe-run/, `G-2: the refusal names the flag (${what})`);
  }
  // The probe's own input is still sent: the preflight above spawned exactly this child and it reached the reviewer.

  // G-3 of 20261020-190617-argv-remediation-4-review: the guard checked the prompt file and the surface once, then the
  // prompt was read again and the reviewer started in the caller's surface, so a caller who swapped the file or filled
  // the directory in between sent its own content under the probe's consent. A preload hook does exactly that on the
  // second read of the prompt; the reviewer must still get the probe's prompt, in a directory the caller does not own.
  const hook = path.join(dir, 'swap-hook.mjs');
  fs.writeFileSync(hook, [
    "import fs from 'node:fs';",
    'const orig = fs.readFileSync; let n = 0;',
    'fs.readFileSync = function (p, ...a) {',
    '  if (String(p) === process.env.Q_SWAP_PROMPT && n++ > 0) {',
    "    fs.writeFileSync(process.env.Q_SWAP_SURFACE + '/secret.txt', 'caller source');",
    "    return 'FORGED caller instructions';",
    '  }',
    '  return orig.call(this, p, ...a);',
    '};',
    '',
  ].join('\n'));
  const raced = fs.mkdtempSync(path.join(dir, 'surface-'));
  spawnSync('git', ['init', '-q', '--template='], { cwd: raced });
  fs.rmSync(fake.log, { force: true });
  const s = runScript('external-review.mjs', ['--probe-run', '--reviewer', 'codex', '--consent', 'transport-probe',
    '--prompt-file', probePrompt, '--schema', probeSchema, '--surface', raced],
  { cwd: off, env: { ...env, NODE_OPTIONS: `--import=${pathToFileURL(hook).href}`, Q_SWAP_PROMPT: probePrompt, Q_SWAP_SURFACE: raced } });
  const seen = fake.kinds().filter((l) => !l.startsWith('version'));
  assert.equal(seen.length, 1, `G-3: the probe reached the reviewer once\n${s.output}`);
  assert.match(seen[0], /^probe /, `G-3: a prompt swapped after the check reached the reviewer\n${s.output}`);
  assert.notEqual(path.resolve(seen[0].slice('probe '.length)), path.resolve(raced),
    `G-3: the reviewer started in the caller's surface, which the caller can fill after the check\n${s.output}`);
});

test('stage 3: with the panel on, a reviewer that fails its probe refuses the mint — named, and no run directory', (t) => {
  const f = mintFixture(t, { body: 'not json' });
  const r = f.mint();
  assert.notEqual(r.status, 0, r.output);
  assert.match(r.output, /reviewer preflight failed for codex\/gpt-5\.6-sol\/high\/review\/native/, r.output);
  assert.match(r.output, /tie-break/, 'every failed combination is named, the judges too');
  assert.deepEqual(f.runs(), [], 'refused before the run directory exists');
});

test('stage 3: passing reviewers mint, and run.json freezes each combination\'s outcome', (t) => {
  const f = mintFixture(t);
  const r = f.mint();
  assert.equal(r.status, 0, r.output);
  const rp = f.runJson().reviewer_preflight;
  assert.ok(Array.isArray(rp), JSON.stringify(rp));
  // The roster's seven arms are one combination; its two judges are two more.
  assert.deepEqual(rp.map((e) => `${e.adapter}/${e.mode}`).sort(), ['agy/tie-break', 'codex/review', 'codex/tie-break']);
  for (const e of rp) {
    assert.equal(e.state, 'passed');
    assert.equal(e.route, 'native');
    assert.ok(fs.existsSync(path.join(f.probes, `${e.probe_record}.json`)), `the record's hash names its file: ${e.probe_record}`);
    // THE FAKE answered, not the vendor: the real agy once answered these probes from further down PATH, billed.
    assert.match(JSON.parse(fs.readFileSync(path.join(f.probes, `${e.probe_record}.json`), 'utf8')).cli_version, /^fake-/, e.adapter);
    assert.ok(!Number.isNaN(Date.parse(e.checked_at)));
  }
});

test('stage 3: the panel off probes nothing, and --dry-run probes nothing', (t) => {
  const off = mintFixture(t, { panel: false, body: 'not json' });
  assert.equal(off.mint().status, 0);
  assert.deepEqual(off.probed(), [], 'no reviewer is checked for a run that will call none');
  const dry = mintFixture(t, { body: 'not json' });
  assert.equal(dry.mint(['--dry-run']).status, 0);
  assert.deepEqual(dry.probed(), []);
});

test('stage 3: --no-verify-reviewers skips the check, stamps REVIEWERS-UNVERIFIED, and that stamp caps', (t) => {
  const f = mintFixture(t, { body: 'not json' });
  const r = f.mint(['--no-verify-reviewers']);
  assert.equal(r.status, 0, r.output);
  assert.deepEqual(f.probed(), []);
  const run = f.runJson();
  assert.equal(run.reviewer_preflight, 'skipped');
  assert.ok(run.stamps.includes('REVIEWERS-UNVERIFIED'), run.stamps.join(','));
  assert.ok(CAPPING_STAMPS.includes?.('REVIEWERS-UNVERIFIED') ?? CAPPING_STAMPS.has('REVIEWERS-UNVERIFIED'));
  const consequences = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'prompts', '_templates', 'stamp-consequences.json'), 'utf8'));
  assert.ok(JSON.stringify(consequences).includes('REVIEWERS-UNVERIFIED'));
});
