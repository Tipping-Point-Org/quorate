// The panel's runtime — which model, at which effort, in which sandbox — is asserted OFFLINE.
//
// It has to be. Every path that would prove these flags for real costs money and sits behind an
// explicit QUORATE_LIVE opt-in, so without a pure argv builder a wrong flag is only discovered by
// paying for it. reviewerArgv exists to make the command line a testable decision rather than a
// side effect of spawning.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
// A filesystem root that is absolute on THIS platform. Fixtures written as 'F:/repo' are not absolute on POSIX,
// so every Linux CI run failed them (diagnosed 2026-10-06, run 37552051536).
const FS_ROOT = path.parse(process.cwd()).root;
import os from 'node:os';
import { spawnSync } from 'node:child_process';

import { reviewerArgv } from '../scripts/lib/decisions.mjs';
import { builtinReviewers, adapterErrors, declaredReviewers } from '../scripts/io/reviewers.mjs';
import { confined } from '../scripts/io/confined-path.mjs';

// THE ADAPTERS ARE DATA NOW (scripts/reviewers.json), and these tests pin the SHIPPED table plus the
// renderer together: the argv expectations below are byte-identical to the ones that pinned the old
// hardcoded switch, which is the proof that moving the vendors into data changed no command line.
const ADAPTERS = builtinReviewers();
const argvFor = (reviewer, opts = {}) => reviewerArgv({ adapter: ADAPTERS[reviewer], reviewer, ...opts });
import { reviewSchema, proposeSchema, validateStrict } from '../scripts/lib/reviewer-schemas.mjs';
import { REPO_ROOT, runScript, withTempDir, seedReviewerProbe } from './helpers.mjs';
import { ARGV_SPECS } from '../scripts/lib/argv-specs.mjs';

test('a pinned codex arm sends model, effort, read-only sandbox and ephemeral, prompt on stdin', () => {
  const { cmd, argv } = argvFor('codex', { model: 'gpt-5.6-sol', effort: 'high' });
  assert.equal(cmd, 'codex');
  assert.deepEqual(argv, [
    'exec',
    '--model', 'gpt-5.6-sol',
    '-c', 'model_reasoning_effort="high"',
    '--sandbox', 'read-only',
    '--ephemeral',
    // --json makes stdout a JSONL event stream carrying turn.completed.usage, the only way this
    // framework learns what an arm consumed. Safe because the ANSWER comes from
    // --output-last-message, a file, not from stdout.
    '--json',
    '-',
  ]);
  // The trailing '-' is what routes the prompt through stdin; codex escapes the inline-argv limit
  // only because of it. Losing it would silently send the prompt nowhere.
  assert.equal(argv.at(-1), '-');
});

test('an unpinned arm sends NO model or effort flag rather than a guessed default', () => {
  const { argv } = argvFor('codex');
  assert.equal(argv.includes('--model'), false);
  assert.equal(argv.includes('-c'), false);
  assert.deepEqual(argv, ['exec', '--sandbox', 'read-only', '--ephemeral', '--json', '-']);
});

test('agy takes --effort, not the codex -c form: the two CLIs are not interchangeable', () => {
  const { cmd, argv } = argvFor('agy', { model: 'some-model', effort: 'high' });
  assert.equal(cmd, 'agy');
  // Stream-json both ways since decision-panel-seats.plan.md stage 3: the prompt is an NDJSON line on stdin, not argv.
  assert.deepEqual(argv, [
    '--input-format', 'stream-json', '--output-format', 'stream-json', '--print=',
    '--disable-slash-commands',
    '--model', 'some-model',
    '--effort', 'high',
    '--sandbox',
  ]);
  assert.equal(argv.includes('-c'), false);
});

test('regression: the dormant codex-review path is left exactly as it was', () => {
  // No skill or panel arm calls `codex exec review`, and its output has never been mapped to the
  // framework contract. Adding runtime flags to a path nothing exercises would be an unverifiable
  // change — and flag placement around a subcommand is what a dormant path cannot warn you about.
  const { cmd, argv } = argvFor('codex-review', { model: 'gpt-5.6-sol', effort: 'high' });
  assert.equal(cmd, 'codex');
  assert.deepEqual(argv, ['exec', 'review']);
});

test('an unknown reviewer throws rather than producing a plausible wrong command line', () => {
  // The table is data now, so "unknown" means "no adapter declared it" — the renderer refuses rather
  // than emitting a command line assembled from defaults, which is how a typo in a contract would
  // otherwise become a spawn of something plausible-looking.
  assert.throws(() => reviewerArgv({ adapter: ADAPTERS.gemini, reviewer: 'gemini' }), /no adapter/);
});

// EVERY SHIPPED ADAPTER MUST BE USABLE. The validation that runs at mint for a consumer-declared
// vendor is the same validation applied here to the built-ins: an adapter this table cannot describe
// is a vendor the engine cannot spawn, and finding that out at mint beats finding it out at the
// moment an arm would have transmitted something.
test('the shipped adapter table describes every vendor completely', () => {
  const table = builtinReviewers();
  assert.ok(Object.keys(table).length >= 3, 'the table must carry the vendors this project actually uses');
  for (const [name, adapter] of Object.entries(table)) {
    assert.deepEqual(adapterErrors(name, adapter), [], `adapter '${name}' is incomplete`);
  }
});

test('an adapter that cannot say where its answer comes from is refused', () => {
  // The fields are not decoration: agy's wrapper carries its own transport `status` beside the
  // reviewer's answer, so an adapter that does not name the field would let a refusal be read as a
  // verdict — which is the failure the whole panel exists to make visible.
  assert.match(adapterErrors('x', { cmd: 'x', response: { from: 'stdout-wrapper' } }).join(' '), /response\.field/);
  assert.match(adapterErrors('x', { cmd: 'x', prompt: { via: 'argv' } }).join(' '), /placeholder/);
  assert.match(adapterErrors('x', { cmd: 'x', effort: { style: 'config-kv' } }).join(' '), /effort\.flag/);
  assert.match(adapterErrors('x', {}).join(' '), /declares no cmd/);
  assert.deepEqual(adapterErrors('codex', builtinReviewers().codex), []);
});

test('the declared panel arms pin their runtime in CONFIG, not in any script', () => {
  const roster = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lens-roster.json'), 'utf8'));
  const arms = roster.panel_arms ?? [];
  assert.ok(arms.length, 'the roster must declare at least one panel arm');
  for (const arm of arms) {
    assert.ok(arm.model, `${arm.id} must declare a model`);
    assert.ok(arm.effort, `${arm.id} must declare an effort`);
  }
  // The point of the config file is that no script names a model. A literal in a script would let
  // the value drift from the one the run records, which is the whole failure being prevented.
  const adapter = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'external-review.mjs'), 'utf8');
  const graph = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  for (const arm of arms) {
    assert.equal(adapter.includes(arm.model), false, 'external-review.mjs must not hardcode a model');
    assert.equal(graph.includes(arm.model), false, 'run-graph.mjs must not hardcode a model');
  }
});

test('regression: the direct-caller timeout fallback matches the graph, not a shorter one', () => {
  const adapter = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'external-review.mjs'), 'utf8');
  // A shorter fallback made the same reviewer on the same prompt time out from candidate-pool and
  // succeed from a run, which reads as a property of the reviewer rather than of the caller.
  // The fallback is now the owner's node default, read with no literal of its own (code-index-d1-part-a.plan.md stage 2).
  assert.match(adapter, /minutes\('flag --timeout-minutes', args\.timeoutMinutes, minutes\('review\.node_timeout_minutes', undefined\)\)/);
});

test('regression: an unpinned run is named in not_checked[], never passed over', () => {
  withTempDir((dir) => {
    const binDir = fakeCodex(dir, `{"candidates":[{"name":"x"}]}`);
    const response = JSON.parse(propose(binDir, writePrompt(dir)).stdout);

    const items = response.not_checked.map((n) => n.item).join(' ');
    assert.match(items, /codex model/);
    assert.match(items, /reasoning effort/);
    assert.equal(response.model, null);
    assert.equal(response.effort, null);
  });
});

test('regression: an empty candidate is dropped and counted, not served as an option', () => {
  withTempDir((dir) => {
    const binDir = fakeCodex(dir, `{"candidates":[{"name":"real"},{},null,[]]}`);
    const response = JSON.parse(propose(binDir, writePrompt(dir)).stdout);

    // Review mode normalises every field before emitting; proposal mode passed candidates through
    // raw, so a batch of empty objects looked like a full pool.
    assert.deepEqual(response.candidates, [{ name: 'real' }]);
    assert.ok(
      response.not_checked.some((n) => n.item.startsWith('3 candidate(s)')),
      'the dropped candidates must be counted, not silently discarded',
    );
  });
});

test('regression: a failure with no run directory cites no evidence file, because none was written', () => {
  withTempDir((dir) => {
    const binDir = fakeCodex(dir, 'not json at all');
    const response = JSON.parse(propose(binDir, writePrompt(dir)).stdout);

    const reason = response.not_checked.map((n) => n.reason).join(' ');
    assert.equal(/evidence\/.*raw\.log/.test(reason), false, 'no output directory means no raw.log to cite');
    // Names BOTH flags since G-8 split the overloaded one: `--run-dir` asserts a minted run whose
    // contract is frozen, `--evidence-dir` asserts only a place to write. What this test pins is
    // unchanged — with neither, the failure says the raw output was not kept rather than citing a
    // file that does not exist.
    assert.match(reason, /neither --run-dir nor --evidence-dir was given/);
  });
});

// G-7 of 20261016-204040-sp-bugs-remediation-review: the test above pins the FAILURE path; a sinkless review that
// SUCCEEDED with findings still cited evidence/<node>/raw.log, set before the `if (outDir)` that writes it — a citation of
// a file that was never created. With no sink a finding cites no evidence, and the envelope says why.
test('G-7: a successful review with no run directory cites no evidence file for its findings', () => {
  withTempDir((dir) => {
    const binDir = fakeCodex(dir, JSON.stringify({
      status: 'ok', verdict: 'RISK', findings: [{ severity: 'LOW', file: 'a.mjs', line: 1, claim: 'a claim' }],
    }));
    const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
    const r = runScript('external-review.mjs', [
      '--reviewer', 'codex', '--prompt-file', writePrompt(dir), '--schema', '{"verdict":"PASS|RISK|FAIL"}',
    ], { env: { [pathKey]: `${binDir}${path.delimiter}${process.env[pathKey] ?? ''}`, ...probed(binDir) } });
    const env = JSON.parse(r.stdout);
    assert.equal(env.findings.length, 1, r.stdout);
    assert.equal(env.findings[0].evidence_path, null, 'no output directory means no raw.log to cite');
    assert.match(env.not_checked.map((n) => `${n.item}: ${n.reason}`).join(' | '),
      /raw log: not kept[^|]*neither --run-dir nor --evidence-dir was given/);
  });
});

test('the prompt gives the reviewer a legal way to say it could not do the job', () => {
  // "Silence is not a verdict" was enforced for THIS script, which always emits, and never for the
  // reviewer it calls. A schema describing only success leaves a stuck model two options: violate
  // the schema, or invent a pass. The words are the prompt library's since G-3 of 20261105-212751-sogsr-delivery, and
  // external-review must still send them with every schema.
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'external-review.mjs'), 'utf8');
  assert.match(src, /args\.schema\s*\?\s*'\\n\\n' \+ renderTemplate\(readTemplate\('reviewer-reply-contract\.md'\)/,
    'external-review does not send the reply contract with the schema');
  const adapter = fs.readFileSync(path.join(REPO_ROOT, 'prompts', '_templates', 'reviewer-reply-contract.md'), 'utf8');
  assert.match(adapter, /"status": one of "ok" \| "refused" \| "incomplete"/);
  assert.match(adapter, /REQUIRED whenever status is not "ok"/);
  assert.match(adapter, /still reply with exactly one object/);
});

test('regression: a SOFT failure is reported as a failure, not as a verdict', () => {
  withTempDir((dir) => {
    // The reviewer answered, in the right shape, and said it could not do the job.
    const binDir = fakeCodex(dir, JSON.stringify({
      status: 'refused', reason: 'the declared scope was not readable', verdict: 'PASS', findings: [],
    }));
    const promptPath = writePrompt(dir);
    const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
    const r = runScript('external-review.mjs', [
      '--reviewer', 'codex',
      '--prompt-file', promptPath,
      '--schema', '{"verdict":"PASS|RISK|FAIL"}',
    ], { env: { [pathKey]: `${binDir}${path.delimiter}${process.env[pathKey] ?? ''}`, ...probed(binDir) } });

    const env = JSON.parse(r.stdout);
    // Its own `verdict: PASS` must NOT survive: it told us in the same breath that it refused.
    assert.equal(env.verdict, 'RISK');
    const reasons = env.not_checked.map((n) => n.reason).join(' ');
    assert.match(reasons, /status 'refused'/);
    assert.match(reasons, /scope was not readable/, 'the reviewer own words must survive');
  });
});

test('regression: a soft failure in propose mode empties the pool visibly', () => {
  withTempDir((dir) => {
    const binDir = fakeCodex(dir, JSON.stringify({
      status: 'incomplete', reason: 'cut short before finishing', candidates: [{ name: 'partial' }],
    }));
    const response = JSON.parse(propose(binDir, writePrompt(dir)).stdout);

    // A partial pool presented as complete is the proposal-mode form of a false PASS.
    assert.deepEqual(response.candidates, []);
    assert.match(response.not_checked.map((n) => n.reason).join(' '), /cut short before finishing/);
  });
});

// THE PARTIAL POOL IS KEPT, OUTSIDE `candidates` (ledger scripts/external-review.mjs:1050; operator, 2026-10-08: "fix
// them now"). story-pipeline's codex proposer ran 514 s, said 'incomplete', and whatever it had proposed was discarded
// with no raw log kept, so nobody could tell whether it proposed anything. `candidates` stays empty (a partial pool
// must not read as complete); what the proposer returned goes in `incomplete_candidates`, counted in not_checked[].
test('regression: an incomplete proposer keeps what it proposed, outside the candidates a caller counts', () => {
  withTempDir((dir) => {
    const binDir = fakeCodex(dir, JSON.stringify({
      status: 'incomplete', reason: 'cut short before finishing', candidates: [{ name: 'partial' }, {}],
      not_checked: [{ item: 'licence of partial', reason: 'primary source not reached' }],
    }));
    const response = JSON.parse(propose(binDir, writePrompt(dir)).stdout);
    assert.deepEqual(response.candidates, [], 'still not presented as a complete pool');
    assert.deepEqual(response.incomplete_candidates, [{ name: 'partial' }], 'kept, and an empty one still dropped');
    const notes = response.not_checked.map((n) => `${n.item}: ${n.reason}`).join(' | ');
    assert.match(notes, /1 candidate\(s\) [^|]*incomplete_candidates/);
    // G-8 of 20261008-175234-cpool-and-design-step: the empty one is counted, and the proposer's own caveats survive.
    assert.match(notes, /1 candidate\(s\) [^|]*returned with no fields/);
    assert.match(notes, /licence of partial: primary source not reached/);
  });
});

// --out WITH EXCLUSIVE CREATE (same ledger entry): two proposer runs redirected to one file interleaved undetected
// (story-pipeline, 2026-10-08). --out refuses a path that exists BEFORE the vendor is called, and writes the response
// there.
test('regression: --out writes the response to a new file and refuses one that already exists, before calling the vendor', () => {
  withTempDir((dir) => {
    const binDir = fakeCodex(dir, JSON.stringify({ status: 'ok', candidates: [{ name: 'real-option' }] }));
    // Inside the evidence sink, which a temp engine home makes valid without touching the repository (G-3).
    const home = path.join(dir, 'home');
    const ev = path.join(home, 'ev');
    fs.mkdirSync(ev, { recursive: true });
    const out = path.join(ev, 'codex.json');
    // Seeded ONCE, before the fake is replaced: seeding runs the fake's --version, which the marker fake below would
    // record as a vendor call.
    const seeded = probed(binDir, { mode: 'propose', route: 'prompt-and-scan' });
    const first = propose(binDir, writePrompt(dir), ['--evidence-dir', ev, '--out', out], { QUORATE_HOME: home, ...seeded });
    assert.equal(first.status, 0, first.output);
    assert.deepEqual(JSON.parse(fs.readFileSync(out, 'utf8')).candidates, [{ name: 'real-option' }]);
    const marker = path.join(dir, 'called.txt');
    fs.rmSync(path.join(binDir, 'fake-codex.mjs'));
    fs.writeFileSync(path.join(binDir, 'fake-codex.mjs'), `import fsx from 'node:fs'; fsx.writeFileSync(${JSON.stringify(marker)}, 'x');`);
    const second = propose(binDir, writePrompt(dir), ['--evidence-dir', ev, '--out', out], { QUORATE_HOME: home, ...seeded });
    assert.notEqual(second.status, 0, 'a second writer to the same file is refused');
    assert.match(second.output, /already exists.*\(OUT-6\)/);
    assert.equal(fs.existsSync(marker), false, 'refused before the vendor ran');
  });
});

// G-3 of 20261008-175234-cpool-and-design-step: --out skipped the containment and git-ignore checks the evidence sink
// gets, so a raw vendor response could land on tracked or out-of-repository paths.
test('regression: --out is refused without an evidence sink, and outside it', () => {
  withTempDir((dir) => {
    const binDir = fakeCodex(dir, JSON.stringify({ status: 'ok', candidates: [{ name: 'x' }] }));
    const bare = propose(binDir, writePrompt(dir), ['--out', path.join(dir, 'a.json')]);
    assert.equal(bare.status, 2, bare.output);
    assert.match(bare.output, /--out needs --evidence-dir or --run-dir[\s\S]*\(OUT-1\)/);
    const home = path.join(dir, 'home');
    const ev = path.join(home, 'ev');
    fs.mkdirSync(ev, { recursive: true });
    const outside = propose(binDir, writePrompt(dir), ['--evidence-dir', ev, '--out', path.join(dir, 'b.json')], { QUORATE_HOME: home });
    assert.equal(outside.status, 2, outside.output);
    assert.match(outside.output, /must be inside --evidence-dir[\s\S]*\(OUT-2\)/);
    assert.equal(fs.existsSync(path.join(dir, 'b.json')), false, 'nothing written outside the sink');
    // G-1 of 20261008-181148-cpool-r2: a missing folder is refused, never created before the containment check.
    const missing = propose(binDir, writePrompt(dir), ['--evidence-dir', ev, '--out', path.join(ev, 'sub', 'c.json')], { QUORATE_HOME: home });
    assert.equal(missing.status, 2, missing.output);
    assert.match(missing.output, /its folder does not exist.*\(OUT-3\)/);
    assert.equal(fs.existsSync(path.join(ev, 'sub')), false, 'nothing created');
  });
});

test('status "ok" passes through untouched, so the contract costs a healthy run nothing', () => {
  withTempDir((dir) => {
    const binDir = fakeCodex(dir, JSON.stringify({
      status: 'ok', candidates: [{ name: 'real-option' }],
    }));
    const response = JSON.parse(propose(binDir, writePrompt(dir)).stdout);
    assert.deepEqual(response.candidates, [{ name: 'real-option' }]);
  });
});

// --------------------------------------------------------------------------------- fake reviewer
// A shim on PATH, not a mock: this exercises the real adapter end to end, which is what makes the
// proposal contract a fact about the shipped script rather than about the test.
function fakeCodex(dir, stdout) {
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  // Honours --output-last-message the way the real CLI does. Without that the shim would exercise
  // a transport the adapter no longer uses, and a native run reading stdout is precisely the
  // guessing the schema was adopted to remove.
  fs.writeFileSync(
    path.join(binDir, 'fake-codex.mjs'),
    [
      `import fsx from 'node:fs';`,
      `const a = process.argv;`,
      `const i = a.indexOf('--output-last-message');`,
      `const body = ${JSON.stringify(stdout)};`,
      `if (i !== -1 && a[i + 1]) fsx.writeFileSync(a[i + 1], body);`,
      `process.stdout.write(body);`,
      ``,
    ].join('\n'),
  );
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(binDir, 'codex.cmd'), `@"${process.execPath}" "%~dp0fake-codex.mjs" %*\r\n`);
  } else {
    const shim = path.join(binDir, 'codex');
    fs.writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/fake-codex.mjs" "$@"\n`);
    fs.chmodSync(shim, 0o755);
  }
  return binDir;
}

function writePrompt(dir) {
  const p = path.join(dir, 'prompt.md');
  fs.writeFileSync(p, 'Propose options for the declared goal.');
  return p;
}

// THE TESTS HERE ARE ABOUT THE MAIN CALL (reviewer-preflight stage 2). A fake that answers oddly on purpose — a soft
// refusal, a missing file, no candidates — would now fail its probe and be refused before the call, and a test asserting
// only the outcome would pass on the REFUSAL for the wrong reason. So these tests record the fake as a reviewer that
// passed its preflight; the preflight itself is tested in regression-reviewer-preflight*.test.mjs.
function probed(binDir, { mode = 'review', route = 'native' } = {}) {
  const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
  const probes = fs.mkdtempSync(path.join(path.dirname(binDir), 'probes-'));
  seedReviewerProbe(probes, { mode, route, pathValue: `${binDir}${path.delimiter}${process.env[pathKey] ?? ''}` });
  return { QUORATE_REVIEWER_PROBES: probes };
}

function propose(binDir, promptPath, extra = [], extraEnv = {}) {
  const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
  const seeded = extraEnv.QUORATE_REVIEWER_PROBES ? {} : probed(binDir, { mode: 'propose', route: extra.includes('--candidate-fields') ? 'native' : 'prompt-and-scan' });
  return runScript('external-review.mjs', [
    '--reviewer', 'codex',
    '--mode', 'propose',
    '--prompt-file', promptPath,
    '--schema', '{"candidates":"array"}',
    ...extra,
  ], { env: { [pathKey]: `${binDir}${path.delimiter}${process.env[pathKey] ?? ''}`, ...seeded, ...extraEnv } });
}

// ------------------------------------------------------------------ native structured output
// codex enforces the schema through OpenAI structured outputs in STRICT mode. Probed 2026-08-31:
// a schema missing `additionalProperties: false` is rejected with HTTP 400 and no output file, so
// these builders being wrong costs a whole arm. They are pure, so that is a test, not a surprise.

test('the generated schemas satisfy strict mode, which is what the API actually enforces', () => {
  assert.deepEqual(validateStrict(reviewSchema()), []);
  assert.deepEqual(validateStrict(proposeSchema('name,why,source_url')), []);
});

test('validateStrict catches both rules the API rejects on', () => {
  assert.match(
    validateStrict({ type: 'object', properties: { a: { type: 'string' } }, required: ['a'] }).join(' '),
    /additionalProperties must be present and false/,
  );
  assert.match(
    validateStrict({
      type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } },
      required: ['a'], additionalProperties: false,
    }).join(' '),
    /strict mode has no optional fields/,
  );
});

test('every schema object carries a failure value, so refusing is always expressible', () => {
  for (const schema of [reviewSchema(), proposeSchema('name')]) {
    assert.deepEqual(schema.properties.status.enum, ['ok', 'refused', 'incomplete']);
    assert.ok(schema.required.includes('status') && schema.required.includes('reason'));
  }
});

test('a proposal with no declared candidate fields yields NO schema, rather than a narrowed one', () => {
  // Strict mode cannot express "an object with whatever keys you like", and a permissive schema is
  // rejected outright. Silently narrowing the caller's fields would answer a different question.
  assert.equal(proposeSchema(''), null);
  assert.equal(proposeSchema([]), null);
});

test('declared candidate fields all reach the schema as required properties', () => {
  const s = proposeSchema('name,why,source_url');
  const item = s.properties.candidates.items;
  assert.deepEqual(Object.keys(item.properties), ['name', 'why', 'source_url']);
  assert.deepEqual(item.required, ['name', 'why', 'source_url']);
  assert.equal(item.additionalProperties, false);
});

test('the schema flags reach each CLI in its own spelling', () => {
  const codex = argvFor('codex', { schemaFile: '/s.json', outFile: '/o.json' }).argv;
  assert.ok(codex.includes('--output-schema') && codex.includes('--output-last-message'));
  assert.equal(codex.at(-1), '-', 'the stdin marker must stay last');

  // agy has no --output-last-message: the answer rides in the stream's final result event (decision-panel-seats.plan.md
  // stage 3), so --json-schema travels alone; a second --output-format (json) would override the stream.
  const agy = argvFor('agy', { schemaFile: '/s.json' }).argv;
  assert.ok(agy.includes('--json-schema'));
  assert.equal(agy[agy.indexOf('--json-schema') + 1], '/s.json');
  assert.equal(agy.filter((a) => a === '--output-format').length, 1);
  assert.equal(agy[agy.indexOf('--output-format') + 1], 'stream-json');
});

test('regression: a native run that wrote no response file is a HARD failure, never a stdout scan', () => {
  withTempDir((dir) => {
    // A shim that ignores --output-last-message but prints a perfectly good envelope on stdout.
    // The old scanner would have found it. Accepting it would reintroduce exactly the guessing the
    // schema was adopted to remove — and would mask a transport failure as a result.
    const binDir = path.join(dir, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(
      path.join(binDir, 'fake-codex.mjs'),
      `process.stdout.write(${JSON.stringify(JSON.stringify({ status: 'ok', verdict: 'PASS', findings: [] }))});\n`,
    );
    fs.writeFileSync(path.join(binDir, 'codex.cmd'), `@"${process.execPath}" "%~dp0fake-codex.mjs" %*\r\n`);
    if (process.platform !== 'win32') {
      const shim = path.join(binDir, 'codex');
      fs.writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/fake-codex.mjs" "$@"\n`);
      fs.chmodSync(shim, 0o755);
    }

    const promptPath = writePrompt(dir);
    const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
    const r = runScript('external-review.mjs', [
      '--reviewer', 'codex', '--prompt-file', promptPath, '--schema', '{"verdict":"PASS|RISK|FAIL"}',
    ], { env: { [pathKey]: `${binDir}${path.delimiter}${process.env[pathKey] ?? ''}`, ...probed(binDir) } });

    const env = JSON.parse(r.stdout);
    assert.equal(env.verdict, 'RISK', 'a PASS recovered from stdout on a native run is not a PASS');
    assert.match(
      env.not_checked.map((n) => n.reason).join(' '),
      /response file was never written/,
    );
  });
});

test('regression: proposal mode without candidate fields falls back, and SAYS it fell back', () => {
  withTempDir((dir) => {
    const binDir = fakeCodex(dir, JSON.stringify({ status: 'ok', candidates: [{ name: 'x' }] }));
    const response = JSON.parse(propose(binDir, writePrompt(dir)).stdout);
    assert.deepEqual(response.candidates, [{ name: 'x' }]);
    assert.match(
      response.not_checked.map((n) => n.reason).join(' '),
      /no --candidate-fields given/,
      'a downgrade from the enforced path must be visible, not silent',
    );
  });
});

test('regression: the temp schema directory is cleaned up when there is no run directory', () => {
  withTempDir((dir) => {
    const binDir = fakeCodex(dir, JSON.stringify({ status: 'ok', verdict: 'PASS', findings: [] }));
    const promptPath = writePrompt(dir);
    const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
    // The adapter gets a PRIVATE tmpdir (os.tmpdir() honours TMP/TEMP/TMPDIR), so this asserts on
    // a directory nothing else writes to. Counting quorate-schema-* in the global tmpdir raced:
    // the suite now runs nested inside check-counted-facts, and a concurrent adapter invocation
    // elsewhere in either suite could mint a schema dir between this test's before and after.
    const privateTmp = path.join(dir, 'tmp');
    fs.mkdirSync(privateTmp);
    runScript('external-review.mjs', [
      '--reviewer', 'codex', '--prompt-file', promptPath, '--schema', '{"verdict":"PASS|RISK|FAIL"}',
    ], { env: {
      [pathKey]: `${binDir}${path.delimiter}${process.env[pathKey] ?? ''}`,
      TMP: privateTmp, TEMP: privateTmp, TMPDIR: privateTmp,
    } });
    const leftover = fs.readdirSync(privateTmp).filter((f) => f.startsWith('quorate-schema-'));
    assert.deepEqual(leftover, [], 'a call with no run directory must not leave a schema dir behind');
  });
});

test('run-graph threads the arm runtime through to the adapter, and records what ran', () => {
  // The panel path cannot be exercised without a full run, so this pins the wiring at the source
  // level: the value must travel from lens-roster.json to the adapter, and be recorded on the
  // status file. `source: codex` and `model: gpt-5.6-sol` are different facts, and recording only
  // the first left a finding unreproducible the moment a developer changed their local default.
  const graph = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  assert.match(graph, /armModel \? \['--model', armModel\] : \[\]/);
  assert.match(graph, /armEffort \? \['--effort', armEffort\] : \[\]/);
  assert.match(graph, /model: armModel \|\| null, effort: armEffort \|\| null/);
});

test('regression: a response with no candidates array empties the pool instead of crashing', () => {
  withTempDir((dir) => {
    // The fallback path screens for an array before this point; the native path takes whatever the
    // reviewer's structured output held. An unhandled throw would break the one guarantee this
    // script makes — that it ALWAYS prints exactly one structured response.
    const binDir = fakeCodex(dir, JSON.stringify({ status: 'ok', candidates: 'not-an-array' }));
    // --candidate-fields is what makes a strict schema buildable, which is what puts this on the
    // NATIVE path. Without it the run falls back to the scan, which screens for an array earlier.
    const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
    const r = runScript('external-review.mjs', [
      '--reviewer', 'codex', '--mode', 'propose', '--prompt-file', writePrompt(dir),
      '--schema', '{"candidates":"array"}', '--candidate-fields', 'name',
    ], { env: { [pathKey]: `${binDir}${path.delimiter}${process.env[pathKey] ?? ''}`, ...probed(binDir, { mode: 'propose', route: 'native' }) } });
    assert.equal(r.status, 0, r.output);
    const response = JSON.parse(r.stdout);
    assert.deepEqual(response.candidates, []);
    assert.match(response.not_checked.map((n) => n.reason).join(' '), /no candidates array/);
  });
});

test('regression: an external reviewer inherits ONLY the allow-listed environment (G-36)', async () => {
  const { reviewerEnv } = await import('../scripts/lib/decisions.mjs');
  // The panel-arm spawn and the tie-break spawn are the same third-party child; the boundary must
  // have one owner, or the second call site ships without it and leaks the operator's shell —
  // which is exactly what the tie-break did (a BLOCKER, credential_exposure, non-waivable).
  // Prefixes RESOLVED FROM THE ADAPTER TABLE, the way all three engine callers do it. This used to
  // pass none and rely on a hardcoded vendor map inside decisions.mjs — a second copy of the
  // credential allow-list that no production caller reached, in the module deciding which secrets
  // cross a process boundary. The map is gone; the boundary is checked where it is now decided.
  const { builtinReviewers, envPrefixesOf } = await import('../scripts/io/reviewers.mjs');
  const { env, passed } = reviewerEnv('codex', {
    PATH: '/usr/bin', CODEX_HOME: '/c', OPENAI_API_KEY: 'sk-vendor',
    GITHUB_TOKEN: 'ghp_secret', AWS_SECRET_ACCESS_KEY: 'aws', DATABASE_URL: 'postgres://x',
    ANTHROPIC_API_KEY: 'sk-ant', CLAUDE_CODE_OAUTH_TOKEN: 'oauth',
  }, { depth: 1, prefixes: envPrefixesOf(builtinReviewers().codex) });
  for (const leaked of ['GITHUB_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'DATABASE_URL', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN']) {
    assert.equal(leaked in env, false, `${leaked} must never reach a third-party reviewer CLI`);
    assert.equal(passed.includes(leaked), false);
  }
  assert.equal(env.PATH, '/usr/bin', 'execution basics cross');
  assert.equal(env.CODEX_HOME, '/c', "the vendor's own config crosses — it is their CLI");
  assert.equal(env.OPENAI_API_KEY, 'sk-vendor', "the vendor's own auth crosses");
  // DEPTH + 1, not 0. A hardcoded '0' told the vendor process it was an ORIGIN run, so an arm that
  // invoked new-run.mjs / run-graph.mjs / bench-lenses.mjs would have found the recursion guard
  // satisfied and started an unbounded fan-out with a bill attached (G-26, panel-codex-contract).
  // The arms are agentic CLIs running with the repository as their working directory.
  assert.equal(env.GRAPH_NODE_DEPTH, '1', 'a vendor spawned from depth 0 is a child at depth 1');
});

// THE DEPTH IS THE CALLER'S, AND THE TWO CALLERS NEED DIFFERENT ANSWERS. Getting this wrong took
// the whole panel down for a full run: G-26's fix incremented the depth inside reviewerEnv, which
// also produces the env for external-review.mjs ITSELF — and that script guards with "a graph node
// may not spawn panel arms", so all six arms exited 3 before doing anything and every one recorded
// DEGRADED. The finding said "assigns GRAPH_NODE_DEPTH=0 to the VENDOR process" and was right; the
// fix applied it one layer too high.
test('regression: the panel spawner runs at depth 0 while the vendor runs at depth + 1', async () => {
  const { reviewerEnv } = await import('../scripts/lib/decisions.mjs');

  // run-graph -> external-review.mjs. Its own guard REFUSES any depth above 0.
  assert.equal(reviewerEnv('codex', { GRAPH_NODE_DEPTH: '0' }, { depth: 0 }).env.GRAPH_NODE_DEPTH, '0',
    'external-review is the orchestrator panel spawner; hand it 1 and every arm exits 3');

  // external-review.mjs -> codex/agy. §8 requires a spawned child to be nested.
  assert.equal(reviewerEnv('codex', { GRAPH_NODE_DEPTH: '0' }, { depth: 1 }).env.GRAPH_NODE_DEPTH, '1',
    'the vendor is an agentic CLI in the repo root; at 0 it could start a run of its own');

  // NEITHER IS IMPLICIT. One hardcoded value cannot be correct for both callers, so the parameter
  // is required — omitting it must fail loudly rather than pick a default that breaks one side.
  for (const bad of [undefined, null, -1, '0', 1.5]) {
    assert.throws(() => reviewerEnv('codex', {}, { depth: bad }), /explicit non-negative integer depth/,
      `depth ${JSON.stringify(bad)} must be refused, not defaulted`);
  }
});

// Every reviewerEnv call in run-graph's source passes depth 0. G-11 of 20261107-072037-split-delivery-3: the loop ran
// over `?? []`, so a source with no call at all passed it, and the test constrained nothing once every call was removed.
function assertGraphCallsAtDepth0(graph) {
  const calls = graph.match(/reviewerEnv\([^)]*\)/g) ?? [];
  assert.ok(calls.length > 0, 'run-graph has no reviewerEnv call: the depth it passes is no longer checked');
  for (const m of calls) {
    assert.match(m, /depth: 0/,
      `run-graph spawns external-review.mjs, which refuses depth > 0: ${m}`);
  }
}

test('G-11: the run-graph caller check refuses a source with no reviewerEnv call, rather than passing vacuously', () => {
  assert.throws(() => assertGraphCallsAtDepth0('const env = process.env;\n'), /no reviewerEnv call/);
});

test('the two live callers pass the depth their side of the boundary needs', () => {
  const graph = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  const ext = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'external-review.mjs'), 'utf8');

  assertGraphCallsAtDepth0(graph);
  // The call now also passes the adapter's credential prefixes, so the assertion pins the DEPTH it
  // carries rather than the exact argument list — the property is "external-review nests", not "the
  // call has two arguments".
  assert.match(ext, /reviewerEnv\(args\.reviewer, process\.env, \{\s*depth: DEPTH \+ 1/,
    'external-review spawns the vendor and must nest it (§8)');
});

// SUPERSEDED by the depth-boundary test above: reviewerEnv no longer DERIVES a depth, because one
// derived value cannot be right for both callers (external-review needs 0, the vendor needs > 0).
// What survives is the guarantee that neither caller can end up at 0 by accident — the vendor side
// is asserted above, and the parameter is mandatory so nothing silently defaults.

// G-21 (found by panel-codex-security): reviewerEnv applied ALL of CODEX_/AGY_/OPENAI_ to EVERY
// reviewer, so an agy process received the operator's OpenAI/Codex keys and a codex process
// received AGY keys — a credential crossing a vendor boundary it has no business crossing.
test('regression: each reviewer inherits ONLY its own vendor credentials, never another vendor\'s', async () => {
  const { reviewerEnv } = await import('../scripts/lib/decisions.mjs');
  // THE ADAPTER TABLE IS THE ALLOW-LIST, and this test now reads it from there. It previously
  // exercised a hardcoded vendor map inside decisions.mjs that no caller reached — so the thing
  // under test was a copy, and scripts/reviewers.json could have disagreed with it indefinitely
  // while this stayed green.
  const { builtinReviewers, envPrefixesOf } = await import('../scripts/io/reviewers.mjs');
  const table = builtinReviewers();
  const forVendor = (name) => ({ depth: 1, prefixes: envPrefixesOf(table[name]) });
  const shell = {
    PATH: '/usr/bin',
    CODEX_HOME: '/c', OPENAI_API_KEY: 'sk-openai',
    AGY_TOKEN: 'agy-secret', AGY_HOME: '/a',
  };
  const codex = reviewerEnv('codex', shell, forVendor('codex')).env;
  assert.equal(codex.CODEX_HOME, '/c', 'codex gets its own config');
  assert.equal(codex.OPENAI_API_KEY, 'sk-openai', 'codex IS the OpenAI CLI, so OPENAI_ crosses');
  assert.equal('AGY_TOKEN' in codex, false, "codex must NOT receive agy's credentials");
  assert.equal('AGY_HOME' in codex, false);

  const agy = reviewerEnv('agy', shell, forVendor('agy')).env;
  assert.equal(agy.AGY_TOKEN, 'agy-secret', 'agy gets its own credentials');
  assert.equal('CODEX_HOME' in agy, false, "agy must NOT receive codex's credentials");
  assert.equal('OPENAI_API_KEY' in agy, false, "agy must NOT receive the operator's OpenAI key");

  // Fail closed, by BOTH routes to an empty allow-list: a reviewer the adapter table does not know,
  // and a caller that resolved no adapter at all. The second used to land on a built-in vendor map;
  // now it lands on nothing, which is the direction that leaks no keys.
  const noPrefixes = reviewerEnv('codex', shell, { depth: 1 }).env;
  for (const k of ['CODEX_HOME', 'OPENAI_API_KEY', 'AGY_TOKEN', 'AGY_HOME']) {
    assert.equal(k in noPrefixes, false,
      `a caller that resolves no adapter must pass no vendor credential (${k}) — there is no `
      + 'built-in vendor table left to fall back on');
  }
  const unknown = reviewerEnv('mystery', shell, forVendor('mystery')).env;
  for (const k of ['CODEX_HOME', 'OPENAI_API_KEY', 'AGY_TOKEN', 'AGY_HOME']) {
    assert.equal(k in unknown, false, `an unknown reviewer must receive no vendor credential (${k})`);
  }
  assert.equal(unknown.PATH, '/usr/bin', 'but execution basics still cross');
});

test('regression: no reviewer subprocess is spawned with the full process.env inline', () => {
  // G-66: the prior version of this test read ONLY run-graph.mjs and asserted a regex against a
  // slice of it, so it could never fail for the leak that actually shipped — G-10, in
  // check-panel.mjs and external-review.mjs, two files it never opened. It even computed a `spawns`
  // variable it never asserted on. It reported green while the credential leak was live. The real
  // boundary is the LAST hop before the vendor CLI, which lives in external-review.mjs, so that is
  // what this now checks — along with the two callers that reach it.
  const read = (f) => fs.readFileSync(path.join(REPO_ROOT, 'scripts', f), 'utf8');
  const extReview = read('external-review.mjs');
  const graph = read('run-graph.mjs');
  const checkReviewers = read('check-reviewers.mjs');

  // 1. external-review is where the reviewer CLI is actually launched. Its spawnOpts MUST carry an
  //    env scrubbed by reviewerEnv, so the boundary holds no matter which caller reached it (this
  //    is the durable fix; check-panel spawns external-review WITHOUT scrubbing, and must be safe
  //    anyway because external-review re-derives the scrub at the final hop).
  assert.match(extReview, /reviewerEnv\(args\.reviewer,/,
    'external-review must scope the reviewer CLI env to the selected vendor via reviewerEnv');
  // G-8 of 20261016-214749-sp-bugs-remediation-2-review wraps the scrubbed env in shellLaunchEnv, which adds
  // NoDefaultCurrentDirectoryInExePath for a shell launch and filters PATH (reviewer-path-entries.md): the env is still
  // the scrubbed one.
  assert.match(extReview, /const launch = shellLaunchEnv\(reviewerScrubbedEnv,[\s\S]*?const spawnOpts = \{[\s\S]*?env:\s*launch\.env/,
    'the reviewer spawnOpts must set env from reviewerEnv, not inherit the full environment');

  // 2. external-review.mjs launches the vendor CLI, so IT must never spread the full process.env
  //    into that spawn. (run-graph's pre-flight spawn legitimately spreads process.env into its own
  //    Claude child, and check-panel hands its env to external-review — our own tool, which
  //    re-scrubs at the final hop — so the blanket ban applies only where the vendor process runs.)
  assert.equal(/env:\s*\{\s*\.\.\.process\.env/.test(extReview), false,
    'external-review must not spread process.env into the reviewer CLI spawn');

  // 3. run-graph's TWO reviewer spawn sites — the panel arm and the tie-break — both route their
  //    env through reviewerEnv. The tie-break is the one that once shipped without the owner.
  assert.match(graph, /reviewerEnv\(arm\.reviewer,/, 'the panel arm spawn must route env through reviewerEnv');
  assert.match(graph.slice(graph.indexOf('tie-break')), /reviewerEnv\(/,
    'the tie-break must route its env through reviewerEnv');
  // check-panel is read to assert it exists and is the sanctioned probe path; its safety now rests
  // on external-review re-scrubbing, verified above.
  assert.match(checkReviewers, /external-review\.mjs/, 'check-reviewers reaches the reviewer via external-review');
});

// AN ARM'S COST WAS RECORDED AS ZERO, WHICH READ AS FREE.
//
// The arms are billed to the vendor's own account, so the status wrote total_cost_usd: 0 and no
// usage at all. The 2026-09-06 sweep therefore reported $47.88 while six arms spent real money
// nobody could see — and then --resume spent them a second time. Absent is not zero; that is the
// rule this framework applies to every other missing measurement.
test('an external arm reports UNKNOWN cost and its real token usage', async () => {
  const { nodeSpend } = await import('../scripts/lib/decisions.mjs');

  const arm = {
    node_id: 'panel-codex-arch', launched: true, auth_mode: 'external-vendor',
    total_cost_usd: null, usage: { input_tokens: 14901, output_tokens: 38 },
  };

  // The fallback charges an unknown-cost node the full node cap. Without an explicit branch, every
  // arm would be billed against the run budget on a project with finite ceilings — six times a run,
  // for money this account never spends.
  assert.equal(nodeSpend(arm, { budgetNode: 4, budgetBarrier: 7 }), 0,
    'an externally billed arm must not be charged this account\'s node cap');

  // A normal node with an unknown cost still IS charged the cap — that behaviour must survive.
  assert.equal(
    nodeSpend({ node_id: 'code-audit', launched: true, total_cost_usd: null }, { budgetNode: 4, budgetBarrier: 7 }),
    4, 'the unknown-cost fallback still applies to nodes billed to this account');
});

test('the codex argv requests the event stream that carries usage', async () => {
  const { argv } = argvFor('codex', {
    model: 'm', effort: 'high', schemaFile: 's.json', outFile: 'o.txt', sandbox: true,
  });
  assert.ok(argv.includes('--json'),
    'codex reports usage only on the --json event stream; without it an arm cannot say what it spent');
  // The ANSWER must still come from the file, which is what makes --json safe to add.
  assert.ok(argv.includes('--output-last-message'),
    'the answer comes from a file, so turning stdout into an event stream cannot lose it');
});

// THE PANEL'S OWN SILENCE, which nothing reported until the run that hit it.
//
// On the 2026-09-07 sweep all six arms exited 3 before doing any work — a regression in the depth
// boundary — and the gate emitted FAIL from the lens half alone. Its Not-checked table named
// ui-audit, feature-verify and five empty commands, and said nothing about six dead arms. The
// failure existed in six status files and in none of the places a reader looks.
test('a panel that was enabled and produced nothing is named and caps the verdict', async () => {
  const { panelSilent } = await import('../scripts/lib/decisions.mjs');

  assert.match(panelSilent({ enabled: true, armStates: ['DEGRADED', 'DEGRADED', 'DEGRADED'] }) ?? '',
    /no cross-family review/, 'every arm failing must be reported');

  // TOTAL absence only. One arm of six failing is a named gap, not a run-wide ceiling — a partial
  // panel still disagreed with the lenses somewhere, and a ceiling that fires on a non-problem
  // teaches readers to ignore ceilings.
  assert.equal(panelSilent({ enabled: true, armStates: ['OK', 'DEGRADED', 'DEGRADED'] }), null);

  // Off by choice is not silence — that is stamped PANEL-ABSENT elsewhere. Nor is "nothing was
  // scheduled": no claim of cross-family review was made, so none was broken.
  assert.equal(panelSilent({ enabled: false, armStates: ['DEGRADED'] }), null);
  assert.equal(panelSilent({ enabled: true, armStates: [] }), null);
});

test('the gate applies the panel ceiling beside the others, not inside a lens scope', () => {
  const graph = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  // First attempt assigned `verdictCeiling`, which is a PER-LENS variable in another function —
  // it would have set a lens's ceiling, or nothing at all, and never reached the gate.
  assert.match(graph, /if \(panelWasSilent\) ceiling = 'RISK';/,
    'the panel ceiling must be applied where every other gate ceiling is');
  assert.match(graph, /if \(secondOpinionWasSilent\) ceiling = 'RISK';[\s\S]{0,400}if \(panelWasSilent\)/,
    'and beside secondOpinionSilent, whose reasoning it shares');
});

// RETIRED WITH check-panel.mjs (reviewer-preflight stage 4): panelProbeGap described `.claude/panel-check.json` in not_checked[] with an age. A reviewer is now checked before every call
// and at mint against a record per combination (scripts/io/reviewer-probe.mjs), held by regression-reviewer-preflight.

// THE OPT-IN GOVERNED ONLY THE GRAPH, AND THE DOCUMENT SAID OTHERWISE.
//
// external-review.mjs is the one place source or conversation leaves the machine, and it never read
// `review.external_panel` — only run-graph and new-run did. So the opt-in covered the graph path
// while /request's cross-family critique (default ON) and candidate-pool called this script
// directly. A project that deliberately set external_panel: false still transmitted the operator's
// CONVERSATION to a vendor cloud, and QUORATE.md told them the panel was "optional, OFF by
// default". Found by doc-consistency-review, basis: invariant (G-23).
//
// Enforced here so the document becomes TRUE, rather than softening the document to match the code.
test('the sole egress point refuses without recorded consent', () => {
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'),
      '# p\n\n```yaml\ngraph_contract: 1\nproject: p\ncommands:\n  build: ""\n  test: ""\n' +
      'source_globs: ["src/**"]\nreview:\n  external_panel: false\n```\n');
    fs.writeFileSync(path.join(dir, 'p.txt'), 'say ok\n');
    // A spy reviewer first on PATH, recorded as probed, so a call made before the refusal is seen (G-12 of
    // 20261107-072037-split-delivery-3: the envelope alone could not tell a refusal from a send followed by one).
    const binDir = fakeCodex(dir, JSON.stringify({ status: 'ok', verdict: 'PASS', findings: [] }));
    const marker = path.join(dir, 'invoked');
    // `--version` carries no prompt and is no egress: external-review reads the CLI's version before the consent check.
    fs.appendFileSync(path.join(binDir, 'fake-codex.mjs'),
      `if (!a.includes('--version')) fsx.writeFileSync(${JSON.stringify(marker)}, JSON.stringify(a.slice(2)));\n`);
    const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';

    const r = runScript('external-review.mjs',
      ['--reviewer', 'codex', '--mode', 'review', '--prompt-file', path.join(dir, 'p.txt')],
      { cwd: dir, env: { [pathKey]: `${binDir}${path.delimiter}${process.env[pathKey] ?? ''}`, ...probed(binDir) } });
    assert.equal(fs.existsSync(marker), false,
      `the reviewer was invoked although the contract withholds consent: ${fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : ''}`);
    // The spy is live: run, it leaves the marker, so its absence above is the refusal's and not an inert spy's.
    spawnSync(process.execPath, [path.join(binDir, 'fake-codex.mjs')], { encoding: 'utf8' });
    assert.equal(fs.existsSync(marker), true, 'the spy reviewer writes no marker when run');

    // It must still EMIT — a refusal the caller cannot see is the same defect as a reviewer that
    // dies quietly, because the caller reads "no findings" either way.
    const env = JSON.parse(r.stdout);
    assert.equal(r.status, 0, 'this script always exits 0 and always prints one envelope');
    const why = (env.not_checked ?? []).map((n) => n.reason).join(' ');
    assert.match(why, /refusing to send anything to codex/);
    assert.match(why, /external_panel is not true/);
    assert.notEqual(env.verdict, 'PASS', 'a refusal must not read as a clean review');
  });
});

test('an unreadable contract is not consent, and --consent is recorded', () => {
  withTempDir((dir) => {
    // No contract at all: fails closed. The refusal costs a review; guessing costs an egress that
    // cannot be undone.
    fs.writeFileSync(path.join(dir, 'p.txt'), 'say ok\n');
    const r = runScript('external-review.mjs',
      ['--reviewer', 'codex', '--mode', 'review', '--prompt-file', path.join(dir, 'p.txt')],
      { cwd: dir });
    const why = (JSON.parse(r.stdout).not_checked ?? []).map((n) => n.reason).join(' ');
    assert.match(why, /no readable graph_contract/);
  });

  // The PROBE is the one deliberate egress that cannot require the egress to be enabled first — exercising the
  // transport IS its job. It was check-panel; since reviewer-preflight stage 4 it is external-review's own probe run.
  const er = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'external-review.mjs'), 'utf8');
  const probe = er.slice(er.indexOf('function runProbe('), er.indexOf('\n}\n', er.indexOf('function runProbe(')));
  assert.match(probe, /'--consent', 'transport-probe'/,
    'the probe must declare its consent explicitly rather than being exempted by name');
});

// THE TIE-BREAKER WAS THE ONE NODE WHOSE RUNTIME NOBODY RECORDED.
//
// Every lens is pinned to opus/xhigh and every arm to gpt-5.6-sol/high, while the node that decides
// disputes BETWEEN them ran on the agy CLI's ambient default. agy also offers Claude Sonnet 4.6 and
// Claude Opus 4.6 — either would make the "third family" the SAME family as the lenses, which is
// the one thing it exists not to be, and nothing would have said so.
test('the tie-breaker pins its model in config, and the spawn reads it', () => {
  const roster = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lens-roster.json'), 'utf8'));

  // EVERY JUDGE PINS ITS MODEL. The singleton became a set, so the claim is now about all of them:
  // an unpinned judge cannot promise it is a different family from the lens it is voting about,
  // which is the only reason a panel is worth anything.
  const judges = roster.adjudicators ?? [];
  assert.ok(judges.length >= 2,
    'a judge SET, not a tie-breaker: one vote cannot say how often it is wrong');
  for (const j of judges) {
    assert.ok(j.model, `adjudicator ${j.id} must declare a model like every other node`);
  }
  // AT LEAST TWO FAMILIES. A panel of one vendor's models is one opinion counted twice, whatever
  // the models are named.
  assert.ok(new Set(judges.map((j) => j.reviewer)).size >= 2,
    'the judges must be different vendors, or the panel measures nothing');
  assert.ok(!judges.some((j) => /claude|opus|sonnet|haiku/i.test(j.model)),
    'a Claude model here would make a judge the same family as the lenses it votes about');
  // agy encodes effort in the model LABEL and rejects --effort for those names, so its pin must
  // carry the effort; codex takes a separate key. Checked per vendor rather than as one rule.
  const agy = judges.find((j) => j.reviewer === 'agy');
  if (agy) {
    assert.match(agy.model, /\((High|Low|Medium)\)/,
      'agy encodes the effort in the label, so the pin must include it');
    assert.equal(agy.effort, undefined, 'and agy REJECTS --effort for those names');
  }

  const graph = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  assert.match(graph, /judge\.model \? \['--model', judge\.model\]/,
    'the spawn must pass each judge\'s pinned model, or the config is decoration');
  assert.equal(graph.includes("'--reviewer', 'agy'"), false,
    'the reviewer comes from config too — a literal here is how a swappable seam stops being one');
});

// shared/external-reviewers.md promises "the tie-breaker receives the specific excerpt under
// dispute". It received a file:line and nothing else, while the prompt asked it to rule "in terms
// of what is actually in the cited file" — so the adjudicator had to OPEN the file, and headless agy
// cannot: a tool needing the `command` permission is auto-denied with nobody to prompt, so agy
// returned an empty response while reporting SUCCESS. Both real tie-breaks in this repository's
// history came back DEGRADED, and 9 of 10 replays across 5 Gemini configurations produced nothing.
// With the excerpt supplied: 8 of 8 ruled.
test('the tie-break prompt ships the disputed excerpt and does not tell agy to go read files', async () => {
  const { buildTieBreakPrompt, EXTERNAL_ARM_CONSTRAINTS } =
    await import('../scripts/io/review-prompts.mjs');

  const p = buildTieBreakPrompt({
    groupId: 'G-1', file: 'a.mjs', line: 10, rationale: 'r',
    findings: [{ node_id: 'code-audit', claim: 'x' }],
    excerpt: { ok: true, from: 5, to: 15, of: 100, body: '  5   const a = 1;' },
  });
  assert.match(p, /## The disputed excerpt/);
  assert.match(p, /const a = 1;/, 'the code itself must travel, not just its coordinates');

  // The shared arm constraints tell a reviewer to read the repo "by WHATEVER means", including
  // shell commands. Correct for codex in a read-only sandbox; fatal for headless agy.
  assert.equal(p.includes(EXTERNAL_ARM_CONSTRAINTS), false,
    'the tie-break must not inherit the constraints that instruct a reviewer to go read the tree');
  assert.match(p, /Vote from what is supplied in this prompt/);   // 'Rule' before G-17

  // An ABSENT excerpt is stated, never left blank: a tie-breaker that cannot see the code must know
  // that is why, so it can decline instead of guessing at a file it was never shown.
  const missing = buildTieBreakPrompt({ groupId: 'G-1', excerpt: { ok: false, why: 'could not read a.mjs: ENOENT' } });
  assert.match(missing, /NOT AVAILABLE — could not read a\.mjs/);
  assert.match(missing, /Do not open files to compensate/);
});

// A RULING IS NOT A VERDICT. The tie-break was answering in the review envelope, so every measured
// ruling came back `verdict: PASS, findings: 0` and rendered into reconciled.md as "no finding
// upheld". The adjudication existed in the model's prose and nowhere the graph could read it —
// which is why the model comparison could score availability and latency but never correctness.
test('the tie-break schema has a field for which position won', async () => {
  const { tieBreakSchema, validateStrict } = await import('../scripts/lib/reviewer-schemas.mjs');
  const s = tieBreakSchema();

  assert.ok(s.properties.supports, 'the ruling must be able to name the position it upholds');
  assert.ok(s.properties.rationale, 'and say why');
  assert.deepEqual(s.properties.confidence.enum, ['high', 'medium', 'low']);
  assert.ok(s.required.includes('supports'));

  // `supports` is free text, not an enum: node ids are per-run, and the schema does not have them.
  // The CALLER validates it against the group's actual participants.
  assert.equal(s.properties.supports.type, 'string');
  assert.equal('enum' in s.properties.supports, false);

  assert.deepEqual(validateStrict(s), [], 'the schema must satisfy the strict-mode rules');
});

test('an unanswered tie-break is distinguishable from a ruling of "neither"', () => {
  const graph = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  // The first means nobody adjudicated; the second means somebody did and found the evidence
  // insufficient. Collapsing them lets an absent adjudicator read as a considered draw — which is
  // the same false-corroboration this panel exists to prevent, one layer in.
  assert.match(graph, /claimed == null/,
    'a null supports must render as NO VOTE, never as a decision');
  assert.match(graph, /NO VOTE/);
  // AND A THIRD STATE THE SINGLETON COULD NOT EXPRESS: the panel answered and SPLIT. A tie is
  // not an absence and not a considered `neither` from one judge -- it is two judges
  // disagreeing, which is the finding rather than something to resolve.
  // FOUR STATES, and this assertion used to claim three of them while checking two. It matched
  // `**Panel: UNDECIDED**` and said "distinct from a silent one" — which was not true: a panel that
  // never reported rendered with that same string, so the sentence in the assertion message was a
  // promise the assertion did not keep. contract-audit raised it as a HIGH.
  assert.match(graph, /\*\*Panel: UNDECIDED \(tied\)\*\*/,
    'judges reported and split — a measured tie');
  assert.match(graph, /\*\*Panel: NOT ADJUDICATED\*\*/,
    'no judge reported at all — silence, which is not a tie and not a verdict');
  assert.match(graph, /m\.outcome === 'absent'/,
    'and the two are told apart by a machine value, not by their reason prose');
  // And a ruling naming something that was not in the dispute is not a ruling either.
  assert.match(graph, /NOT a participant in this dispute/,
    'the caller validates supports against the group participants, because the schema cannot');
});

// A FAILED TIE-BREAK WAS RECORDED AS OK. classifyPanelProbe matched `^external (reviewer|proposer)
// '<name>'$` — a literal alternation — while external-review grew a third mode whose failure marker
// reads `tie-breaker '<name>'`. So a tie-break whose reviewer was missing, refused, timed out or was
// denied egress classified as reachable, and a silent adjudication read exactly like one that
// happened (G-44: contract-audit, panel-codex-code and arch-review, independently).
test('every mode\'s unavailable marker is recognised, from one shared list', async () => {
  const { classifyPanelProbe, UNAVAILABLE_ROLES } = await import('../scripts/lib/decisions.mjs');

  for (const role of UNAVAILABLE_ROLES) {
    const env = {
      schema_version: 1, source: 'agy',
      not_checked: [{ item: `${role} 'agy'`, reason: 'exited 1 with no output' }],
    };
    assert.equal(classifyPanelProbe(env, 'agy').state, 'unavailable',
      `${role} is an emitter's failure marker and the classifier must know it`);
  }
  assert.ok(UNAVAILABLE_ROLES.includes('tie-breaker'), 'the mode that shipped without it');

  // The original defect this regex replaced must stay fixed: an item merely MENTIONING the reviewer
  // is not proof it never ran. `agy reasoning effort` is emitted by a perfectly reachable arm.
  const reachable = {
    schema_version: 1, source: 'agy',
    not_checked: [{ item: 'agy reasoning effort', reason: 'not pinned' }],
  };
  assert.equal(classifyPanelProbe(reachable, 'agy').state, 'reachable');
});

// "The vendor is a parameter, never a literal. arm.reviewer reaches the adapter flag, the
// credential allow-list, the probe, the source tag and the status record" — shared/external-
// reviewers.md. The tie-break read config for --reviewer and hardcoded 'agy' for the other five
// (G-41, G-55). A seam swappable in one place and fixed in five is not a seam.
test('the tie-break threads its vendor from config through every use', () => {
  const graph = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  const block = graph.slice(graph.indexOf('const JUDGES ='));

  // THE VENDOR MUST REACH EACH USE — which is the claim. The classifier entry used to spell out
  // `classifyPanelProbe(JSON.parse(r.stdout), TIE_BREAKER)`, pinning the argument's SHAPE as well
  // as the vendor, and it went red when the three duplicated parses of that same string were
  // collapsed into one named envelope — a refactor that changed nothing about where the vendor
  // comes from. A test that fails on a change it does not care about teaches the next reader to
  // edit the assertion rather than believe it.
  for (const use of ['reviewer: judge.reviewer', 'source: judge.reviewer',
    'reviewerEnv(judge.reviewer', 'classifyPanelProbe(tbEnvelope, judge.reviewer)']) {
    assert.ok(block.includes(use), `the vendor must reach ${use}`);
  }
  // NO vendor literal survives in code now. The last one was `?? 'agy'` in this declaration — a
  // default that silently spawned a specific CLI when the roster declared none, which is the
  // opposite of "the vendor is a parameter, never a literal". Nothing declared means no
  // adjudication, recorded in not_checked[]. Comment lines are excluded, because the prose
  // explaining the fix necessarily quotes the literal it removed.
  const code = graph.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  assert.equal((code.match(/'agy'/g) ?? []).length, 0,
    'the vendor reaches this file from config only');
  assert.match(block, /\(roster\.adjudicators \?\? \[\]\)\.filter\(\(j\) => j\?\.reviewer\)/,
    'an undeclared judge set resolves to nothing, not to a vendor');
  assert.match(block, /no adjudicators declared in lens-roster\.json/,
    'and the gap is named, since unadjudicated contradictions are a fact the gate must carry');
  // A ONE-JUDGE PANEL IS ALSO A GAP, and a new one: the set makes it expressible where the singleton
  // made it the design. Every ruling from a lone judge is a vote that cannot say how often it is
  // wrong, which is the sentence this whole topology exists to answer.
  assert.match(block, /every ruling this run is single-judge/,
    'a panel of one must be named at the gate, not silently treated as a panel');

  // And each judge's pinned runtime is RECORDED. These were null/null while the spawn passed
  // --model, so the artifact denied the pin it had just used.
  assert.match(block, /model: judge\.model \?\? null/);
});

// writeGate() is reachable from the pre-flight failure path, which runs long before the barrier.
// The file hoists every flag it reads into one block and says why; `panelWasSilent` was declared at
// the barrier instead, putting it in the temporal dead zone for that call and turning a clean
// "barrier failed; nothing was spawned" exit into a ReferenceError (G-40).
test('every flag writeGate reads is declared before the pre-flight failure path can call it', () => {
  const lines = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8').split('\n');
  const declaredAt = lines.findIndex((l) => /^let panelWasSilent = false;/.test(l));
  const earliestCall = lines.findIndex((l) => /writeGate\('BLOCKED'/.test(l));
  assert.ok(declaredAt >= 0 && earliestCall >= 0, 'both the declaration and the early call must exist');
  assert.ok(declaredAt < earliestCall,
    `panelWasSilent is declared at line ${declaredAt + 1} but writeGate is called at line ` +
    `${earliestCall + 1} — a temporal dead zone on the barrier-failure path`);
});

// THE EGRESS GATE I SHIPPED WAS BYPASSABLE BY ANY STRING. `--consent` existed for one caller —
// check-panel, whose job is to exercise the transport and which therefore cannot require the
// transport to be enabled first — and the check was `if (args.consent)`. A switch any caller can set
// to any value is not a switch; it is a documented bypass of the project's egress opt-in, in the one
// script where anything leaves the machine (G-11). And the basis was computed then dropped on the
// success path, so no artifact could say WHY an egress had been allowed (G-14).
test('only a recognised consent basis opens the egress gate, and it is recorded', () => {
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'),
      '# p\n\n```yaml\ngraph_contract: 1\nproject: p\ncommands:\n  build: ""\n  test: ""\n' +
      'source_globs: ["src/**"]\nreview:\n  external_panel: false\n```\n');
    fs.writeFileSync(path.join(dir, 'p.txt'), 'say ok\n');
    const run = (...extra) => JSON.parse(runScript('external-review.mjs',
      ['--reviewer', 'codex', '--mode', 'review', '--prompt-file', path.join(dir, 'p.txt'), ...extra],
      { cwd: dir }).stdout);

    const bogus = run('--consent', 'whatever');
    assert.match((bogus.not_checked ?? []).map((n) => n.reason).join(' '), /not a recognised basis/,
      'an arbitrary consent string must not authorise an egress');
    assert.match(bogus.egress_basis ?? '', /not a recognised basis/,
      'and the refusal basis is recorded on the envelope');

    // The refusal path must still name the panel switch as the real answer.
    const none = run();
    assert.match(none.egress_basis ?? '', /external_panel is not true/);
  });
});

// WHAT BOUNDS A THIRD-PARTY REVIEWER'S AUTHORITY, and where that bound is written down.
//
// It was two literals inside external-review.mjs — capSeverity's MEDIUM and
// `verdict === 'PASS' ? 'PASS' : 'RISK'` — while run-graph and finding-scope both carried comments
// saying the ROSTER capped the arm, and no arm entry in lens-roster.json carried a ceiling at all.
// An auditor asking what limits an external reviewer looked in the declared place and found nothing,
// and changing a cap meant editing a script (G-14). shared/claude-md-contract.md states the rule for
// exactly these per-arm parameters: declared per arm in the roster, never defaulted in a script.
test('every panel arm declares its own ceilings, and the orchestrator passes them down', async () => {
  const roster = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lens-roster.json'), 'utf8'));
  assert.ok(roster.panel_arms.length >= 6, 'no arms to check — this test would pass vacuously');

  for (const arm of roster.panel_arms) {
    assert.ok(arm.severity_ceiling, `${arm.id} declares no severity_ceiling`);
    assert.ok(arm.verdict_ceiling, `${arm.id} declares no verdict_ceiling`);
  }

  const graph = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  // ...AND WHAT IT PASSES IS THE DERIVED VALUE, not the roster entry it was read from (G-15). The
  // spawn took `arm.severity_ceiling` straight from the roster while armLimits derived a ceiling
  // from what the adapter can substantiate, tightened it by that same roster entry, and wrote the
  // result into nodes/expected.json — so the derivation governed the ARTIFACT and nothing else, and
  // an adapter declaring evidence_capture was capped anyway. Identical values today, because the
  // roster happens to declare what the derivation computes; that is precisely what makes the defect
  // invisible without an assertion on which of the two reaches the process.
  assert.match(graph, /'--severity-ceiling', String\(armCaps\.severity_ceiling\)/,
    'a ceiling declared in config and never passed to the adapter is a decoration');
  assert.match(graph, /'--verdict-ceiling', String\(armCaps\.verdict_ceiling\)/);
  assert.doesNotMatch(graph, /'--severity-ceiling', String\(arm\.severity_ceiling\)/,
    'the raw roster entry reaching the arm means armLimits governs nothing');
  // The basis enum travels the same path, for the same reason: external-review stamped `convention`
  // as a literal on every finding while the derived allowed_basis sat in the artifact.
  assert.match(graph, /'--allowed-basis', armCaps\.allowed_basis\.join/);

  const arm = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'external-review.mjs'), 'utf8');
  assert.equal(ARGV_SPECS['external-review'].options['allowed-basis'], 'string', 'the flag is passed to a script that ignores it');
  assert.match(arm, /'allowed-basis': 'allowedBasis'/, 'the parsed flag reaches args.allowedBasis');
  assert.doesNotMatch(arm, /basis: 'convention'/,
    'a literal basis cannot be governed by a derived permission');
});

// AND THE DERIVED CEILING IS TIGHTENED BY THE BASIS THE ARM ACTUALLY STANDS ON.
//
// capsFor answers "the strongest rung this runtime could reach" — right for a lens, which picks a
// basis per finding; wrong for an arm, which stamps `convention` on every one of them because its
// evidence path is a raw vendor log the run cannot re-derive. Without this tightening, an adapter
// declaring evidence_capture lifts the arm's ceiling above what §4 allows a convention finding, and
// validateVerdict REJECTS the finding outright: a raised cap becoming a silent drop.
test('an evidence-capable arm is still held to what a convention finding may claim', async () => {
  const { capsFor, allowedBasisFor } = await import('../scripts/lib/capabilities.mjs');
  const roster = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lens-roster.json'), 'utf8'));
  const ladder = roster.basis_ceilings;

  // An adapter that CAN substantiate measurement: the derivation lifts its ceiling, as designed.
  const capable = { cmd: 'x', capabilities: ['evidence_capture'] };
  const derived = capsFor(capable, ladder);
  const conventionCap = ladder.convention.severity_ceiling;
  assert.notEqual(derived.severity_ceiling, conventionCap,
    'this test proves nothing unless the derivation actually lifts the ceiling for such an adapter');

  // ...and `convention` stays in the enum it may claim, which is the rung the arm emits.
  assert.ok(allowedBasisFor(capable, ['convention', 'invariant', 'measurement'], ladder).includes('convention'));

  // The rule the arm spawn applies, stated here as the property rather than as a source match: the
  // ceiling that reaches an arm is never above what its emitted basis supports.
  // `null` is UNCAPPED, not "the weakest rung" — the same trap armLimits' `stricter` is written
  // around, and the reason this is asserted rather than assumed: an index comparison against null
  // silently reads as -1 and picks the uncapped side.
  const SEV = ['LOW', 'MEDIUM', 'HIGH', 'BLOCKER'];
  const stricter = (a, b) => (!a ? b : !b ? a : (SEV.indexOf(a) < SEV.indexOf(b) ? a : b));
  assert.equal(stricter(derived.severity_ceiling, conventionCap), conventionCap);
  assert.equal(stricter(null, conventionCap), conventionCap, 'an uncapped derivation must not win');
});

test('the arm severity cap normalises foreign rungs and then holds the declared ceiling', async () => {
  const { capArmSeverity } = await import('../scripts/lib/decisions.mjs');

  // Foreign rungs are MAPPED, not flattened: a model saying CRITICAL means BLOCKER, and dropping it
  // to LOW would silently discard the strongest claim an arm can make.
  assert.equal(capArmSeverity('CRITICAL', 'BLOCKER'), 'BLOCKER');
  assert.equal(capArmSeverity('severe', 'BLOCKER'), 'BLOCKER');
  assert.equal(capArmSeverity('nonsense', 'BLOCKER'), 'LOW', 'an unreadable rung is the weakest, never the strongest');

  // ...and then held at the declared ceiling.
  assert.equal(capArmSeverity('CRITICAL', 'MEDIUM'), 'MEDIUM');
  assert.equal(capArmSeverity('HIGH', 'LOW'), 'LOW');
  assert.equal(capArmSeverity('LOW', 'MEDIUM'), 'LOW', 'a cap lowers; it never raises');

  // MEDIUM is the fallback for a caller outside the graph, because an arm's basis is `convention`
  // and §4 caps that at MEDIUM whatever any config says.
  assert.equal(capArmSeverity('BLOCKER'), 'MEDIUM');
  assert.equal(capArmSeverity('HIGH', 'not-a-rung'), 'MEDIUM');
});

// AN ARM GETS THE CLOCK ITS SHADOWED LENS GETS.
//
// Every arm was launched with the global node timeout while the lens it shadows may declare its own:
// contract-audit and security-audit both declare 30 minutes, with a roster note recording the
// measurement that forced it — their cost scales with the SOURCE SURFACE they audit, not with diff
// size. An arm reviews that same surface against those same criteria, so 15 minutes was never its
// budget. panel-codex-contract took 12 minutes in one run and was killed at exactly 15:00 in the
// next, two runs in a row, reported as a spawn error rather than a timeout.
test('a panel arm inherits its shadowed lens\'s timeout, and may override it', () => {
  const roster = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lens-roster.json'), 'utf8'));
  const NODE_TIMEOUT = 15;
  const clockFor = (arm) => Number(
    arm.timeout_minutes
    ?? roster.lenses.find((l) => l.id === arm.shadows)?.timeout_minutes
    ?? NODE_TIMEOUT,
  );

  const contractArm = roster.panel_arms.find((a) => a.shadows === 'contract-audit');
  const contractLens = roster.lenses.find((l) => l.id === 'contract-audit');
  assert.ok(contractArm && contractLens?.timeout_minutes, 'fixture gone: nothing here declares a longer clock');
  assert.equal(clockFor(contractArm), contractLens.timeout_minutes,
    'the arm auditing the same surface must get the same minutes the lens was given');

  // An arm shadowing a lens with no declared clock still gets the global one — inheritance, not a
  // blanket raise.
  const plain = roster.panel_arms.find((a) => !roster.lenses.find((l) => l.id === a.shadows)?.timeout_minutes);
  if (plain) assert.equal(clockFor(plain), NODE_TIMEOUT);

  // ...and an arm's own declaration wins over what it inherits.
  assert.equal(clockFor({ ...contractArm, timeout_minutes: 45 }), 45);

  // The orchestrator must actually USE it — for the child's own deadline and for the parent-side
  // backstop, or one of the two still cuts the arm off at the wrong minute.
  const graph = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  assert.match(graph, /'--timeout-minutes', String\(armTimeout\)/);
  assert.match(graph, /timeoutMs: timerMs\(armTimeout, 2\)/);
});

// A TIMEOUT MUST READ AS A TIMEOUT, on the platform this framework is developed on.
//
// external-review tested `r.signal === 'SIGTERM'`, which is how POSIX reports it. Windows surfaces a
// spawnSync timeout as an ERROR with code ETIMEDOUT, so the generic error branch caught it first and
// wrote "spawn error: spawnSync cmd.exe ETIMEDOUT" — which reads as a broken transport. Two
// consecutive runs looked like a flaky vendor CLI when an arm was simply being cut off.
// Since stop-owner-grep-state-roots.plan.md stage 1 the call runs through spawnCapture, which says `timedOut` itself on
// every platform (its own timer fired), so the classification is that flag; the platform's spellings are spawnCapture's.
test('a timed-out arm says it timed out, whichever way the platform reports it', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'external-review.mjs'), 'utf8');
  const at = src.indexOf('if (r.timedOut)');
  assert.notEqual(at, -1, 'the timeout classification must exist');
  assert.match(src.slice(at, at + 200), /unavailable\(`timed out after/, 'a timeout must be said as one');

  // BEFORE the generic error branch, because on Windows the timeout ARRIVES as an error — checking
  // it second is exactly how this was misreported. Anchored on the branch's CODE, not on the string
  // it prints, which also appears in the comment explaining the fix.
  const genericBranch = src.indexOf("unavailable(r.error.code === 'ENOENT'");
  assert.notEqual(genericBranch, -1, 'the generic spawn-error branch must still exist');
  assert.ok(at < genericBranch, 'the timeout test must precede the generic error branch');
});

// MASS REJECTION IS NOT A SUCCESSFUL REVIEW (G-32). spawn-node fails a LENS whose findings were more
// than half rejected on scope — "the review was not performed" — while the arm path wrote state OK
// regardless, so an arm whose every finding was thrown out still counted as a delivered second
// family: panelSilent saw a reporting arm, and the gate could claim cross-family corroboration
// nobody supplied.
//
// And `report_sha256` meant two different things (G-33): the sha of a rendered file for a lens, the
// sha of a findings array for an arm, under one key that version-gate reads.
test('an arm whose findings were mostly rejected is DEGRADED, and its report is a real file', () => {
  const graph = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  const spawn = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'spawn-node.mjs'), 'utf8');

  // The same threshold on both writers — a rule one path enforces and the other does not is the
  // one-owner-two-writers shape this file keeps finding.
  assert.match(spawn, /rejected\.length \/ total > 0\.5/, 'the lens rule must still exist to be mirrored');
  assert.match(graph, /armRejected\.length \/ armTotal > 0\.5/);
  assert.match(graph, /state: armUnusable \? 'DEGRADED' : 'OK'/,
    'an unusable arm must not report the state a delivered review reports');
  assert.match(graph, /validator_errors: armUnusable/,
    'and it must say why, or DEGRADED is a state with no reason attached');

  // report_sha256 hashes a FILE, the same as every other node.
  // Read through the run's owner since run-dir-reads.plan.md stage 4 (runRead), still the report it wrote.
  assert.match(graph, /report_sha256: crypto\.createHash\('sha256'\)\.update\(runRead\(armReportPath, null\)\)/);
  assert.match(graph, /report_path: path\.relative\(runDir, armReportPath\)/,
    'a hash of a report nobody can open is not verifiable');
  assert.doesNotMatch(graph, /update\(JSON\.stringify\(env\.findings/,
    'hashing the findings array under the report key is what made one field mean two things');
});

// THE PRE-COMMITMENT RECORD MUST PRECEDE THE SPAWN (G-38). run-graph's own opening line says
// expected.json is written BEFORE anything launches — that is what makes a node which never reports
// detectable rather than merely absent — and the tie-break row was pushed AFTER its reviewer had
// been launched. An interruption inside that window left work that ran, spent tokens, and appeared
// in no pre-commitment record: the one shape "silence is not a verdict" cannot catch, because the
// run never promised the node existed.
test('a tie-break node is promised in expected.json before its reviewer is launched', () => {
  const graph = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  // `toAdjudicate` since G-55: a tie-breaker whose adapter cannot serve the role is refused, and the
  // disputes stay in `disputed` as unadjudicated rather than being emptied to skip the spawn.
  const loop = graph.slice(graph.indexOf('for (const g of toAdjudicate)'));
  const row = loop.indexOf('node_id: nodeId, skill: null, kind: NODE_KIND.adjudication');
  const write = loop.indexOf("writeJson(path.join(nodesDir, 'expected.json')");
  const spawn = loop.indexOf('await spawnCapture(');

  assert.ok(row !== -1 && write !== -1 && spawn !== -1, 'the tie-break loop must still do all three');
  assert.ok(row < spawn, 'the row is pushed before the launch');
  assert.ok(write < spawn, 'and the FILE is rewritten before it too — an in-memory array is not a record');
});

// NODE DOES NOT QUOTE ARGV UNDER `shell: true` (G-11). codex ships as an npm .ps1/.cmd shim on
// Windows, which CreateProcess cannot execute directly, so the arm is spawned through a shell — and
// in that mode Node joins the arguments with spaces and lets cmd.exe split them again. Every path
// this arm passes is absolute and built from the run directory, so a consumer whose checkout sits
// under a path with a space had --output-schema split in half; the reviewer then read a schema file
// that does not exist and answered something unparseable, reported honestly and uselessly as
// "returned no parseable verdict envelope".
test('an argument with a space survives the shell that codex needs', async () => {
  const { windowsShellArgv } = await import('../scripts/lib/decisions.mjs');
  const spaced = ['C:', 'Users', 'Jane Smith', 'proj', 'run.json'].join(String.fromCharCode(92));

  assert.deepEqual(windowsShellArgv(['--output-schema', spaced]), ['--output-schema', `"${spaced}"`]);
  assert.deepEqual(windowsShellArgv(['--model', 'gpt-5.6-sol']), ['--model', 'gpt-5.6-sol'],
    'an argument that needs no quoting is left exactly as it was');
  assert.deepEqual(windowsShellArgv(['--effort', 'high', 'a&b']), ['--effort', 'high', '"a&b"'],
    'cmd.exe metacharacters are as dangerous as spaces');

  // An embedded quote is REFUSED rather than escaped: Windows forbids it in a filename, so an
  // argument carrying one is a thing to notice rather than to paper over.
  assert.throws(() => windowsShellArgv(['a"b c']), /double quote/);
});

test('the arm quotes only when a shell is actually in the way', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'external-review.mjs'), 'utf8');
  assert.match(src, /const shellArgv = \(a\) => \(useShell \? windowsShellArgv\(a\) : a\)/,
    'without a shell, argv goes straight to CreateProcess and must not be touched');
  // agy MUST NOT be quoted: it takes no shell, and its prompt rides inline in argv — quoting that
  // would corrupt the one argument the reviewer actually reads.
  // G-13 of 20261105-212751-sogsr-delivery: the slice was between two vendor branches that no longer exist, so it was
  // empty and this passed whatever the code did. The inline-argv branch is the adapter's `prompt.via === 'argv'` now, and
  // both of its ends must be found before its body is read.
  // Through the accessor since decision-panel-seats.plan.md stage 2 (no module reads prompt.via itself).
  const from = src.indexOf("if (reviewerPromptVia(ADAPTER) === 'argv') {");
  const to = src.indexOf("} else if (ADAPTER.schema?.style === 'none') {");
  assert.ok(from !== -1 && to > from, 'the inline-argv spawn branch must exist, or this check reads nothing');
  const agyBranch = src.slice(from, to);
  assert.match(agyBranch, /capture\(/, 'the branch read is the one that spawns');
  assert.doesNotMatch(agyBranch, /shellArgv/, 'agy is spawned without a shell, so nothing is re-parsed');
});

// RETIRED WITH check-panel.mjs (reviewer-preflight stage 4): panelProbePath was the one owner of that file's location. A reviewer is now checked before every call
// and at mint against a record per combination (scripts/io/reviewer-probe.mjs), held by regression-reviewer-preflight.

// AN ARM COULD END ABOVE ITS OWN VERDICT CEILING (G-45, code-audit).
//
// The ceiling was applied in the CHILD — external-review caps its verdict before returning — and
// run-graph then RAISED that verdict to the findings floor and capped nothing. So an arm whose kept
// findings reached the FAIL floor ended at FAIL, above a declared `verdict_ceiling: RISK`, and
// writeGate promotes any FAIL to a FAIL gate: the cheap-reviewer cascade the ceiling exists to
// prevent, arriving from an evidence path this run cannot verify. The lens path had it right —
// spawn-node computes the floor and THEN caps, so a capped node ends at its cap.
test('the arm verdict ceiling is applied after the floor, not before it', async () => {
  const { verdictFloorFromFindings, raiseVerdict, capVerdict } = await import('../scripts/lib/decisions.mjs');

  // A BLOCKER finding floors the verdict at FAIL. (The arm's own severity cap normally prevents
  // one; the ordering must be right regardless, because that cap is derived and can change.)
  const floor = verdictFloorFromFindings([{ severity: 'BLOCKER', basis: 'convention' }]);
  assert.equal(floor, 'FAIL', 'this test proves nothing unless the floor actually reaches FAIL');

  const wrongOrder = raiseVerdict('PASS', floor);
  assert.equal(wrongOrder, 'FAIL', 'the old path ended here — above the declared ceiling');
  assert.equal(capVerdict(wrongOrder, 'RISK'), 'RISK', 'floor first, then ceiling, and the cap binds');

  // ...and the floor still does its job under the ceiling: an arm reporting PASS beside its own
  // MEDIUM findings must be raised, just never past what its runtime may claim.
  const medium = verdictFloorFromFindings([{ severity: 'MEDIUM', basis: 'convention' }]);
  assert.equal(capVerdict(raiseVerdict('PASS', medium), 'RISK'), 'RISK');

  const graph = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  assert.match(graph, /capVerdict\(raiseVerdict\(env\.verdict, armFloor\), armCaps\.verdict_ceiling/,
    'the order is the contract; a comment asserting the ceiling "still caps it" is not the cap');
});

// RETIRED WITH check-panel.mjs (reviewer-preflight stage 4): the probe file was machine-local and ignored; the records now live under the engine's home, outside every repository. A reviewer is now checked before every call
// and at mint against a record per combination (scripts/io/reviewer-probe.mjs), held by regression-reviewer-preflight.

// THE CONSUMER EXTENSION POINT WAS WIRED IN TWO OF FOUR PLACES.
//
// lib/reviewers.mjs has promised since it was written that "a CONSUMER may extend the table without
// touching the engine: `reviewers:` in the graph_contract". run-graph and external-review honoured it;
// `check-tiebreak` and `bench-lenses` passed `{}`. So a project that declared its own adapter and used
// it as an adjudicator had that judge REFUSED by the probe written to exercise that exact path — "not
// in the adapter table" — while the real run accepted it. The probe-diverges-from-production defect,
// third location, in the mechanism whose whole purpose is that a mounted engine can be extended
// without being edited.
//
// The reader was duplicated too: `declaredReviewers()` existed in external-review AND check-panel,
// with different fallback behaviour — frozen-then-live in one, live-only in the other.
test('regression: every reader of consumer-declared adapters asks the same owner', () => {
  const files = ['external-review', 'check-reviewers', 'bench-lenses'];
  for (const f of files) {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', `${f}.mjs`), 'utf8');
    if (f === 'bench-lenses') {
      // bench-lenses reads ONCE, at its framework root, through lib/bench-settings' benchContract, whose declared
      // adapters come from the owner declaredReviewers also asks, lib/reviewers' reviewersFromOutcome
      // (bench-contract-root D3).
      assert.match(src, /benchContract\(readContract\(/, `${f} must read through the one decision`);
      const settings = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lib', 'bench-settings.mjs'), 'utf8');
      assert.match(settings, /reviewersFromOutcome\(outcome/, 'benchContract must ask the owner');
    } else {
      // From the owner or its host-bound re-export under scripts/io/ (os-platform-adapters stage 3c).
      assert.match(src, /declaredReviewers,?\s*\}? from '\.\/(lib|io)\/reviewers\.mjs'|declaredReviewers \} from/,
        `${f} must import the owner`);
      assert.match(src, /declaredReviewers\(\{/, `${f} must call it`);
    }
    assert.ok(!/function declaredReviewers\(\)/.test(src),
      `${f} carries its own copy — two readers of one contract key is how they come to disagree`);
    assert.ok(!/mergeReviewers\(builtinReviewers\(\), \{\}\)/.test(src),
      `${f} ignores the consumer's declarations, so it reports on a table the run does not use`);
  }
});

test('declared adapters come from the FROZEN contract inside a run, the live one outside', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-declared-'));
  try {
    // Inside a run: run.json is the contract as it was when the run started, which is what every
    // other decision in that run is made against.
    fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({
      run_id: 'x', contract: { reviewers: { housecli: { cmd: 'housecli' } } },
    }));
    assert.deepEqual(declaredReviewers({ run: confined(dir) }), { housecli: { cmd: 'housecli' } });

    // An unreadable run.json keeps the built-ins unextended rather than adding a second failure
    // message — the egress check already refuses the paths that transmit.
    fs.writeFileSync(path.join(dir, 'run.json'), 'not json');
    assert.deepEqual(declaredReviewers({ run: confined(dir) }), {});

    // Outside a run, with no way to ask: empty, never a guess.
    assert.deepEqual(declaredReviewers(), {});
    // Outside a run, with a contract to ask for: the LIVE one, through the injected reader.
    const readContract = () => ({ contract: { reviewers: { live: { cmd: 'l' } } } });
    assert.deepEqual(declaredReviewers({ readContract }), { live: { cmd: 'l' } });
    // A contract that will not print is not a declaration of nothing: refused (G-5 of 20261014-193710-lf-remediation-review).
    assert.throws(() => declaredReviewers({ readContract: () => ({ error: 'exit 1' }) }), /contract could not be read/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// G-8 of run 20260924-123916-verbatim-guards — `panel-codex-contract`, verified in source.
//
// `reviewerEnv(reviewer, sourceEnv = process.env, ...)` put the machine's environment into the pure
// decision layer through a default parameter. I-1 says inputs arrive as explicit caller-supplied
// values, and ARCHITECTURE §2 calls that layer "no I/O, no clock, no environment".
//
// The cost is not theoretical and arch-review described it for the sibling case (G-19, quorateHome):
// "a test that forgets the argument gets the machine's real environment instead of failing." For a
// function whose entire job is deciding WHICH CREDENTIALS reach a third-party reviewer, silently
// reading the real environment is the worst available default.
//
// Every caller — four in scripts/, every one in tests/ — already passed it explicitly, so the
// default was reachable only by a mistake.
test('reviewerEnv takes its environment as an argument, never from the machine', async () => {
  // Imported here like every other test in this file — the module is loaded per test, not at top.
  const { reviewerEnv } = await import('../scripts/lib/decisions.mjs');
  assert.throws(() => reviewerEnv('codex'), /sourceEnv/,
    'omitting the environment must fail loudly rather than silently reading process.env');

  // An explicit empty environment is a legitimate input and must still work.
  const { env } = reviewerEnv('codex', {}, { depth: 0 });
  assert.equal(typeof env, 'object', 'an empty environment is an answer, not a mistake');
});
