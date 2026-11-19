// Can this framework actually run on vendors it was not written for?
//
// The claim "adding a vendor is an entry, not a code change" has been made three times in this
// repository and been wrong twice. The first pass left a credential-prefix map hardcoded in
// lib/decisions.mjs. The second left three `reviewer === 'codex-review'` branches in
// external-review.mjs. Both times the claim was checked by grepping for vendor names — which
// answers a question about spelling, not about behaviour.
//
// So this asks the behavioural question instead: rename every vendor in the shipped configuration
// and see whether the engine still resolves a complete panel. It is the offline half of the
// experiment that was run by hand — the roster's arms swapped to `grok`, the tie-breaker to
// `astra` — which passed 473 tests and proved the SUITE is not vendor-bound. This keeps that
// property from quietly decaying.
//
// WHAT IT CANNOT SHOW, stated because the gap is the point: no offline test exercises a transport.
// A vendor that resolves here may still fail to launch, mangle its argv on Windows, or answer in a
// shape nothing parses — every panel defect found so far has been exactly that class.
// `QUORATE_LIVE=1 node scripts/check-panel.mjs` is the paid check that covers it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import {
  builtinReviewers, mergeReviewers, adapterErrors, envPrefixesOf,
  supportsMode, needsPrompt, needsShell,
} from '../scripts/io/reviewers.mjs';
import { reviewerArgv, reviewerEnv } from '../scripts/lib/decisions.mjs';
import { win32 } from '../scripts/platform/win32/index.mjs';
import { linux } from '../scripts/platform/linux/index.mjs';

const roster = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lens-roster.json'), 'utf8'));

// Two vendors this framework has never heard of, modelled on the two shapes it does know: one that
// takes a schema flag and a model flag, one that carries effort inside the model label.
const FOREIGN = {
  grok: {
    cmd: 'grok', base_argv: ['review'], model_flag: '--model',
    effort: { style: 'flag', flag: '--effort' },
    // The real vocabulary, read from lib/decisions.mjs rather than invented: `output-schema-file`
    // names the flags, `json-schema-inline-wrapper` is the other shape. A fixture that made up
    // field names would have tested nothing and passed.
    schema: { style: 'output-schema-file', schema_flag: '--output-schema', out_flag: '--out' },
    prompt: { via: 'stdin' }, response: { from: 'file' },
    env_prefixes: ['GROK_'], needs_shell_on_windows: false,
  },
  astra: {
    cmd: 'astra', base_argv: ['ask'], model_flag: '-m',
    effort: { style: 'none' },
    schema: { style: 'none' },
    prompt: { via: 'argv', placeholder: '<PROMPT>' },
    response: { from: 'stdout-wrapper', field: 'answer' },
    // False, as an inline-argv vendor must declare (G-4 of 20261111-011856-dps-remediation-9-review).
    env_prefixes: ['ASTRA_'], needs_shell_on_windows: false,
  },
};

const TABLE = mergeReviewers(builtinReviewers(), FOREIGN);

test('a vendor the framework has never seen is usable without editing the engine', () => {
  for (const name of Object.keys(FOREIGN)) {
    assert.deepEqual(adapterErrors(name, TABLE[name]), [], `${name} must validate as an adapter`);
    const { cmd, argv } = reviewerArgv({
      adapter: TABLE[name], reviewer: name, model: 'some-model', effort: 'high',
      schemaFile: 'S.json', outFile: 'O.json',
    });
    assert.equal(cmd, TABLE[name].cmd, `${name} must launch its own binary`);
    assert.ok(Array.isArray(argv) && argv.length, `${name} must render a runnable argv`);
    assert.ok(!argv.includes(undefined), `${name} rendered an undefined argument`);
    assert.ok(argv.includes('some-model'), `${name} must carry the model it was given — an unpinned `
      + 'reviewer cannot promise which family answered');
  }
});

test('every shipped panel role resolves through the table, whatever the vendor is called', () => {
  // THE EXPERIMENT, as a test. Rename the vendors in the shipped roster and require every arm and
  // the tie-breaker to still resolve to a usable adapter. A name that leaked into a decision shows
  // up here as an arm that cannot be built.
  const rename = (v) => ({ codex: 'grok', 'codex-review': 'grok', agy: 'astra' }[v] ?? v);
  const roles = [
    ...(roster.panel_arms ?? []).map((a) => ({ role: a.id, reviewer: rename(a.reviewer), model: a.model, effort: a.effort })),
    // EVERY judge, renamed. A set means a vendor name could leak into a decision about the second
    // judge while the first still resolved — exactly the half-swappable seam this test exists for.
    ...(roster.adjudicators ?? []).map((j) => ({
      role: `adjudicator ${j.id}`, reviewer: rename(j.reviewer), model: j.model, effort: j.effort,
    })),
  ];
  assert.ok(roles.length > 1, 'the roster must declare arms and a judge set');
  assert.ok((roster.adjudicators ?? []).length >= 2,
    'and the judge set must have at least two members, or the rename proves nothing about a panel');

  for (const r of roles) {
    const adapter = TABLE[r.reviewer];
    assert.ok(adapter, `${r.role} names '${r.reviewer}', which resolves to no adapter`);
    assert.deepEqual(adapterErrors(r.reviewer, adapter), [], `${r.role}'s adapter is unusable`);
    const { cmd, argv } = reviewerArgv({
      adapter, reviewer: r.reviewer, model: r.model ?? '', effort: r.effort ?? '',
      schemaFile: 'S.json', outFile: 'O.json',
    });
    assert.ok(cmd, `${r.role} produced no command`);
    assert.ok(argv.length, `${r.role} produced no argv`);
    // The credential boundary must follow the vendor, not a name the engine knows.
    const { env } = reviewerEnv(r.reviewer, { PATH: '/p', GROK_KEY: 'g', ASTRA_KEY: 'a', CODEX_HOME: 'c' },
      { depth: 1, prefixes: envPrefixesOf(adapter) });
    assert.equal('CODEX_HOME' in env, false, `${r.role} must not inherit another vendor's credentials`);
  }
});

test('capability questions are answered by the adapter, never by its name', () => {
  // The three branches this replaced were `reviewer === 'codex-review'`. A foreign adapter with the
  // same properties must get the same treatment without the engine knowing it exists.
  const diffReviewer = { cmd: 'zed', modes: ['review'], prompt: { via: 'stdin', required: false }, response: { from: 'file' } };
  assert.equal(supportsMode(diffReviewer, 'review'), true);
  assert.equal(supportsMode(diffReviewer, 'propose'), false, 'a declared mode list is exhaustive');
  assert.equal(needsPrompt(diffReviewer), false, 'an adapter that supplies its own subject needs no prompt file');

  // And the defaults stay permissive: an adapter that declares neither is asked for everything.
  assert.equal(supportsMode({ cmd: 'x' }, 'tie-break'), true);
  assert.equal(needsPrompt({ cmd: 'x' }), true);
  assert.equal(needsShell({ cmd: 'x' }, win32), false, 'a shell is opt-in, per vendor');
  // And both halves are needed: the vendor's declaration AND an operating system that runs shims so.
  assert.equal(needsShell({ cmd: 'x', needs_shell_on_windows: true }, win32), true);
  assert.equal(needsShell({ cmd: 'x', needs_shell_on_windows: true }, linux), false);
  assert.throws(() => needsShell({ cmd: 'x' }), /platform implementation/, 'no silent default for the host');
});

// G-4 of 20261111-011856-dps-remediation-9-review: the argv branch passes the prompt unquoted, and a declared shell then
// hands it to cmd.exe to re-parse. Nothing refused the pairing, so a consumer's adapter could reach it.
test('G-4: a reviewer whose prompt goes inline in argv may not declare a shell', () => {
  const argvReviewer = { cmd: 'x', prompt: { via: 'argv', placeholder: '<P>' }, response: { from: 'stdout-wrapper', field: 'answer' } };
  const errs = adapterErrors('x', { ...argvReviewer, needs_shell_on_windows: true });
  assert.ok(errs.some((e) => /needs_shell_on_windows/.test(e) && /argv/.test(e)), `the pairing was not refused: ${JSON.stringify(errs)}`);
  assert.deepEqual(adapterErrors('x', { ...argvReviewer, needs_shell_on_windows: false }), [], 'an argv reviewer with no shell is usable');
  assert.deepEqual(adapterErrors('x', { ...argvReviewer, prompt: { via: 'stdin' }, needs_shell_on_windows: true }), [],
    'a stdin reviewer may have a shell: the prompt is not on the command line');
});

test('no vendor name decides anything in external-review.mjs', () => {
  // The grep that was wrong twice, kept as a floor rather than as the whole check. Comments are
  // stripped: the file records what the branches were, and forbidding that would forbid saying so.
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'external-review.mjs'), 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  for (const vendor of ['codex', 'agy', 'codex-review']) {
    assert.ok(!new RegExp(`args\\.reviewer\\s*[!=]==\\s*'${vendor}'`).test(code),
      `a decision still turns on the name '${vendor}' — that is what the adapter table exists to end`);
  }
});

// THE DEADLINE REACHED ONE PROMPT CHANNEL IN THREE, AND ARRIVED AFTER THE BUILDER (G-11, arch-review).
//
// `timeout_flag` is documented in reviewers.json as a general adapter key. external-review appended
// it inside the `prompt.via === 'argv'` branch only — the stdin and no-schema branches dropped it
// without a word — and appended it AFTER reviewerArgv returned, the one builder declared pure "so
// the exact command line can be asserted offline", precisely because the panel is where a wrong flag
// costs real money to discover. It held together by coincidence: agy was both the sole declarer of
// the key and the sole argv-prompt vendor.
test('the vendor-side deadline is built into the argv, for every prompt channel', async () => {
  const { reviewerArgv } = await import('../scripts/lib/decisions.mjs');

  const base = { cmd: 'x', timeout_flag: '--deadline' };
  const channels = [
    ['argv', { ...base, prompt: { via: 'argv', placeholder: '<P>' }, base_argv: ['<P>'] }],
    ['stdin', { ...base, prompt: { via: 'stdin', argv_marker: '-' } }],
    ['none', { ...base, schema: { style: 'none' } }],
  ];
  for (const [label, adapter] of channels) {
    const { argv } = reviewerArgv({ adapter, reviewer: 'v', timeoutMinutes: 15 });
    const at = argv.indexOf('--deadline');
    assert.ok(at !== -1, `the ${label} channel drops the declared deadline`);
    assert.equal(argv[at + 1], '15m');
  }

  // An adapter that declares no flag gets none — a deadline invented for a CLI that has no such
  // option is an unknown argument, and the arm fails as a broken vendor.
  const { argv: bare } = reviewerArgv({ adapter: { cmd: 'x' }, reviewer: 'v', timeoutMinutes: 15 });
  assert.equal(bare.includes('--deadline'), false);
  // ...and neither does a caller that states no deadline.
  const { argv: undated } = reviewerArgv({ adapter: base, reviewer: 'v' });
  assert.equal(undated.includes('--deadline'), false);

  // And the spawner no longer appends it itself: a flag added after the builder returned cannot be
  // asserted by any offline test over that builder, which is the half that made this invisible.
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'external-review.mjs'), 'utf8');
  assert.ok(!/concat\(\[ADAPTER\.timeout_flag/.test(src),
    'the deadline is part of the command line, so the command-line builder owns it');
});

// A CALLER-ARGUMENT ERROR THAT WOULD HAVE DISCARDED A PAID REVIEW (G-13, arch-review).
//
// The --allowed-basis refusal sat 260 lines below the vendor spawn, after the review had completed
// and its usage been harvested — so had it fired it would have thrown away work already billed, and
// run-graph would have recorded "produced no parseable envelope" with no usage: a usage error
// reported as a broken transport. Its own comment claimed it "refuses at spawn". This module's
// contract says exit 2 means a usage error with NOTHING PRINTED, which is only true of a check that
// runs before anything is spent.
test('the basis refusal happens before the vendor is spawned', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'external-review.mjs'), 'utf8');
  const check = src.indexOf('const ALLOWED_BASIS =');
  const spawn = src.indexOf('launched = true;');
  assert.ok(check !== -1 && spawn !== -1);
  assert.ok(check < spawn,
    'a refusal after the spawn discards a completed, paid review and mislabels it as a transport failure');

  // And it is among the other argument refusals, not merely somewhere earlier.
  const modeCheck = src.indexOf("if (!MODES.includes(args.mode))");
  assert.ok(modeCheck < check && check - modeCheck < 2000,
    'it belongs with the usage checks, which is what makes exit 2 honest');
});

// PROPOSAL MODE REPORTED NOTHING ABOUT WHAT IT SPENT (G-10, code-audit).
//
// `reviewerUsage` is harvested for every mode and emitted by envelope() and emitRuling();
// emitProposal()'s object literal carried no `usage` key at all. That is the gap the accounting work
// was written to close — "six arms' worth of tokens nobody could see" — left open on one mode of
// three, and /request's candidate pool is a real billed vendor call.
test('every emitter reports what the vendor consumed', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'external-review.mjs'), 'utf8');
  for (const [name, end] of [
    ['function envelope(', 'function emit('],
    ['function emitProposal(', 'function emitRuling('],
    ['function emitRuling(', 'function unavailable('],
  ]) {
    const body = src.slice(src.indexOf(name), src.indexOf(end));
    assert.match(body, /usage: reviewerUsage/,
      `${name.replace('function ', '')} spends the operator's quota and records nothing`);
  }
});
