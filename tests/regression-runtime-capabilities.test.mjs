// What a node may claim is DERIVED from what its runtime can substantiate — not assigned because
// of who supplies it.
//
// Two facts were literals in run-graph.mjs, applied to every external arm unconditionally:
//
//   allowed_basis: ['convention']
//   severity_ceiling: 'MEDIUM', verdict_ceiling: 'RISK'
//
// They are the correct values for every adapter that ships, and they were unreachable by any
// adapter — so the framework could not distinguish "this runtime cannot produce verifiable
// evidence" from "this runtime is not ours". Only the first is a property of anything, and the
// difference matters the moment someone asks why a third party's finding is worth less.
//
// It is worth less for one reason, and the reason applies to a Claude lens identically: without a
// way to run capture.mjs inside the run directory and cite what it printed, a finding rests on
// `convention`, which §4 caps at MEDIUM FOR ANY REPORTER. A FAIL on an evidence path nobody can
// verify would promote the whole gate.
//
// shared/adapter-contract.md owns the reasoning: what each capability is for, what meeting it
// achieves, and what is lost without it. These tests pin the derivation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO_ROOT, runScript, mintedRunDir } from './helpers.mjs';
import { builtinReviewers, servesRole } from '../scripts/io/reviewers.mjs';
import {
  CAPABILITIES, ROLE_REQUIREMENTS, adapterCapabilities, unknownCapabilities,
  roleGaps, allowedBasisFor, capsFor, runtimeContract, unbackedCapabilities,
  grantRules as grantRulesOf, shellToolsOf as shellToolsOfLocal, contentToolsOf as contentToolsOfLocal,
} from '../scripts/lib/capabilities.mjs';

// THE LADDER THE ENGINE ACTUALLY USES. These tests called capsFor() with no ladder, which now means
// "conservative floor" — absent configuration must not read as permission — so they were exercising
// a shape no caller has. run-graph passes roster.basis_ceilings; so do they.
const LADDER = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lens-roster.json'), 'utf8')).basis_ceilings;

const promptOnly = { cmd: 'x', capabilities: ['structured_output', 'credential_scoping'] };
const fullLens = {
  cmd: 'y',
  capabilities: ['structured_output', 'evidence_capture', 'path_scoped_read',
    'content_tool_denial', 'no_write', 'budget_bound', 'wall_clock_bound', 'credential_scoping'],
};

test('the shipped adapters derive exactly the caps they used to be assigned', () => {
  // NO BEHAVIOUR CHANGE, and that is the point of this one: the same MEDIUM/RISK/convention, now as
  // a consequence with a stated reason rather than as two literals nothing could reach.
  // REVIEWER-ROLE ENTRIES ONLY. The table also holds node runtimes now, and a runtime that CAN
  // capture evidence is correctly not capped — asserting MEDIUM across every entry would have been
  // asserting that the derivation does nothing.
  for (const [name, adapter] of Object.entries(builtinReviewers())) {
    if (!servesRole(adapter, 'reviewer')) continue;
    const caps = capsFor(adapter, LADDER);
    assert.equal(caps.severity_ceiling, 'MEDIUM', `${name} must still cap findings at MEDIUM`);
    assert.equal(caps.verdict_ceiling, 'RISK', `${name} must still cap its verdict at RISK`);
    assert.match(caps.reason, /evidence_capture/, 'and the cap must say what it rests on');
    assert.deepEqual(allowedBasisFor(adapter, ['convention', 'invariant', 'measurement'], LADDER), ['convention'],
      `${name} cannot substantiate anything above convention`);
  }
});

test('an adapter that can capture evidence is not capped', () => {
  // THE PROPERTY THAT MAKES THIS REAL rather than decorative. If no declaration could ever change
  // the outcome, the derivation would be an elaborate way of writing a constant.
  const caps = capsFor(fullLens, LADDER);
  assert.equal(caps.severity_ceiling, null, 'a runtime that can produce verifiable evidence is not capped');
  assert.equal(caps.verdict_ceiling, null);
  assert.deepEqual(allowedBasisFor(fullLens, ['convention', 'invariant', 'measurement'], LADDER),
    ['convention', 'invariant', 'measurement'], 'the whole basis ladder is available');
});

test('the cap follows the capability, not the vendor', () => {
  // Same two adapters, names swapped. Nothing about the answer may move.
  const a = capsFor({ ...promptOnly, cmd: 'codex' }, LADDER);
  const b = capsFor({ ...promptOnly, cmd: 'a-vendor-nobody-has-heard-of' }, LADDER);
  assert.deepEqual(a, b, 'two runtimes with identical capabilities must be capped identically');
  const c = capsFor({ ...fullLens, cmd: 'codex' }, LADDER);
  assert.notDeepEqual(a, c, 'and the same vendor with more capability must not be capped the same');
});

test('a role refusal names the missing capability', () => {
  // "Unsupported reviewer" is a wall. A named gap is a specification someone can build against.
  const gaps = roleGaps(promptOnly, 'lens');
  assert.ok(gaps.length, 'a prompt-only runtime cannot be a lens');
  assert.ok(gaps.includes('evidence_capture'));
  assert.ok(gaps.includes('path_scoped_read'));
  assert.ok(gaps.includes('content_tool_denial'));
  assert.deepEqual(roleGaps(promptOnly, 'arm'), [], 'but it can be an arm — that is the floor');
  assert.deepEqual(roleGaps(fullLens, 'lens'), [], 'a fully capable runtime can be a lens');
});

test('intent does NOT require an execution channel', () => {
  // Requiring the wrong thing is its own defect. intent-capture reads declared documents and writes
  // criteria; it must not execute anything, so demanding evidence_capture would bar the runtime
  // best suited to the role.
  assert.ok(!ROLE_REQUIREMENTS.intent.includes('evidence_capture'));
  for (const c of ['path_scoped_read', 'content_tool_denial', 'no_write']) {
    assert.ok(ROLE_REQUIREMENTS.intent.includes(c), `Rule 2 needs ${c}`);
  }
});

test('an unknown role is refused, never silently granted', () => {
  const gaps = roleGaps(fullLens, 'sudo');
  assert.ok(gaps.length, 'answering "no requirements" for an unknown role would grant everything');
  assert.match(gaps[0], /unknown role/);
});

test('a misspelled capability is absent, and reported', () => {
  // A typo would otherwise be a silently weaker node: declared, ignored, and never mentioned.
  const typo = { cmd: 'z', capabilities: ['structured_output', 'evidence_captur'] };
  assert.equal(adapterCapabilities(typo).has('evidence_captur'), false);
  assert.deepEqual(unknownCapabilities(typo), ['evidence_captur']);
  assert.equal(capsFor(typo, LADDER).severity_ceiling, 'MEDIUM', 'a typo must not grant the capability');
  assert.deepEqual(runtimeContract(typo, 'arm').unknown_capabilities, ['evidence_captur'],
    'and the run must record it, or the author never learns');
});

test('the contract recorded in a run explains the cap', () => {
  const rc = runtimeContract(builtinReviewers().codex, 'arm', { ladder: LADDER });
  assert.equal(rc.eligible, true);
  assert.equal(rc.severity_ceiling, 'MEDIUM');
  assert.match(rc.cap_reason, /convention/,
    'an auditor must be able to answer "why was this capped" from the artifact, not from the engine');
});

test('every capability the adapters declare is one quorate knows how to ask for', () => {
  for (const [name, adapter] of Object.entries(builtinReviewers())) {
    assert.deepEqual(unknownCapabilities(adapter), [], `${name} declares a capability that is not in the catalogue`);
  }
  // And the node runtime is the one entry that must NOT be capped — it can capture evidence, which
  // is the whole basis of the derivation.
  assert.equal(capsFor(builtinReviewers().claude, LADDER).severity_ceiling, null,
    'a runtime that can substantiate a finding is not capped, whoever supplies it');
  // And the doctrine must document each one, or an adapter author is guessing at what to provide.
  const doc = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'adapter-contract.md'), 'utf8');
  for (const c of CAPABILITIES) {
    assert.match(doc, new RegExp(`\`${c}\``),
      `shared/adapter-contract.md must state what ${c} is for and what is lost without it`);
  }
});

// ---------------------------------------------------------------------------------------------
// GRANTS: the mechanism, not the claim.
//
// A capability list tells the orchestrator that a runtime CAN run capture.mjs. It does not tell it
// how to SAY so in a policy file — and new-run has to write that policy before any node exists. The
// tool names (`Bash`, `PowerShell`) and the rule shape (`Tool(command:*)`) were hardcoded there, in
// Claude Code's vocabulary, so a second runtime would have been granted nothing and denied nothing
// while declaring both capabilities. The adapter's documentation has to carry everything the
// orchestrator needs to run it.

test('the grant vocabulary comes from the runtime, not from the engine', async () => {
  const { shellToolsOf, contentToolsOf, grantRules } = await import('../scripts/lib/capabilities.mjs');
  const claude = builtinReviewers().claude;
  assert.deepEqual(shellToolsOf(claude, 'win32'), ['Bash', 'PowerShell'],
    'Claude Code exposes a separate PowerShell tool on Windows');
  assert.deepEqual(shellToolsOf(claude, 'linux'), ['Bash'],
    'and does not on POSIX — a rule for a tool the host cannot expose is dead weight');
  assert.ok(contentToolsOf(claude, 'win32').includes('Grep'),
    'content_tool_denial must cover search as well as shells');
  for (const shell of ['Bash', 'PowerShell']) {
    assert.ok(contentToolsOf(claude, 'win32').includes(shell),
      `${shell} reads file content (Get-Content, Select-String) and must be denied with the rest`);
  }
});

test('a runtime with its own vocabulary gets its own policy', () => {
  const zed = {
    cmd: 'zed',
    node_runtime: { grants: { shell_tools: { default: ['Exec'] }, content_tools: ['Find'], command_rule: 'allow:{{tool}}:{{command}}' } },
  };
  // A platform id is required since os-platform-adapters stage 2; `default` answers for any of them.
  assert.deepEqual(grantRulesOf(zed, ['run x'], 'linux'), ['allow:Exec:run x']);
  assert.deepEqual(contentToolsOfLocal(zed, 'linux'), ['Exec', 'Find']);
});

test('the quoted spelling wraps the PATH, not the whole command', () => {
  // A REGRESSION CAUGHT BY COMPARING, not by a test — this function generated the second spelling
  // itself and produced `Tool("node <path>":*)` where the tree has `Tool(node "<path>":*)`. Same
  // length, different rule, and the case the quoted form exists for — a checkout under a directory
  // with a space in it — would have silently lost its evidence channel on every run.
  const rules = grantRulesOf(builtinReviewers().claude, ['node p/capture.mjs', 'node "p/capture.mjs"'], 'win32');
  assert.ok(rules.includes('Bash(node p/capture.mjs:*)'));
  assert.ok(rules.includes('Bash(node "p/capture.mjs":*)'), 'the path is what gets quoted');
  assert.ok(!rules.some((r) => r.startsWith('Bash("node ')), 'never the whole command');
});

test('a runtime that declares no grant vocabulary gets no rules, rather than guessed ones', () => {
  // Fail closed: inventing a spelling would produce a policy that grants nothing while looking
  // complete, which is the worst of the three possible outcomes.
  assert.deepEqual(grantRulesOf({ cmd: 'x' }, ['anything'], 'linux'), []);
  assert.deepEqual(shellToolsOfLocal({ cmd: 'x' }, 'linux'), []);
});

// ---------------------------------------------------------------------------------------------
// Found by the 2026-09-10 sweep, in the checks added the day before. A validation with a hole is
// worse than none: it reports that something was checked.

test('a declared capability needs the MECHANISM THAT DELIVERS IT, not just the names', () => {
  // G-19 (security-audit). The first version accepted `add_dir.flag` as the whole mechanism for
  // path_scoped_read — while §3 states, as verified empirically, that "`--add-dir` alone does NOT
  // confine a node": an unscoped tool rule in the settings file OUTRANKS the directory sandbox. An
  // intent node whose policy allowed a bare `Read` read straight into the source tree with NO
  // denial recorded at all. The POLICY FILE is what scopes a read.
  //
  // So a runtime could declare path_scoped_read, pass every check, be granted the lens and intent
  // roles, and spawn with the policy written into the run directory and never handed to the
  // process: a node reported as sandboxed whose sandbox was never applied.
  const noPolicy = {
    cmd: 'z',
    capabilities: ['path_scoped_read', 'content_tool_denial', 'no_write'],
    node_runtime: { add_dir: { flag: '--allow' }, tools: { deny_intent: ['S'], deny_always: ['W'] } },
  };
  const missing = unbackedCapabilities(noPolicy).join(' | ');
  assert.match(missing, /path_scoped_read .*settings names no flag/,
    'the policy file is the mechanism; the directory flag is not');
  assert.match(missing, /--add-dir alone does not confine/, 'and the refusal must say why');

  // The same hole, on the deny lists: names nothing carries to the process deny nothing.
  assert.match(missing, /content_tool_denial .*deny_tools names no flag/);
  assert.match(missing, /no_write .*deny_tools names no flag/);

  // And the shipped runtime still passes, or the check would be refusing the only adapter there is.
  assert.deepEqual(unbackedCapabilities(builtinReviewers().claude), []);
});

test('a node runtime claiming structured_output needs node_runtime.schema.flag (G-9)', () => {
  // G-9 of 20261026-080302-rct-delivery: the guard read `nr.node_runtime` where `nr` already IS the node_runtime
  // object, so it was never defined and the check never fired: a runtime could claim structured_output, be granted
  // the role, and spawn without the schema ever reaching the process.
  const noSchema = { cmd: 'z', capabilities: ['structured_output'], node_runtime: { settings: { flag: '--s' } } };
  assert.match(unbackedCapabilities(noSchema).join(' | '), /structured_output .*schema names no flag/);
  // An external reviewer carries its schema at the top level, not under node_runtime: not a node runtime, not refused.
  assert.deepEqual(unbackedCapabilities(builtinReviewers().codex).filter((m) => /structured_output/.test(m)), []);
});

test('every lens is validated on its EFFECTIVE model and effort', async () => {
  // G-20 (panel-codex-contract). validateRoster checked a lens only when that lens carried its OWN
  // model or effort — and 7 of this repository's 8 lenses inherit review.models.judgment and
  // review.effort.judgment. So the preflight checked one lens out of eight, and a bad DEFAULT, the
  // single value that reaches almost every node, was the one thing it could not catch.
  const { validateRoster } = await import('../scripts/lib/capabilities.mjs');
  const roster = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lens-roster.json'), 'utf8'));
  const resolve = (n) => builtinReviewers()[n];

  const good = validateRoster(roster, resolve, {
    defaultRuntime: 'claude', defaults: { model: 'opus', effort: 'xhigh' },
  });
  assert.deepEqual(good.errors, [], 'the shipped defaults must be valid');

  const bad = validateRoster(roster, resolve, {
    defaultRuntime: 'claude', defaults: { model: 'opus', effort: 'turbo' },
  });
  // EVERY ASSIGNABLE NODE THAT INHERITS IT, not every lens (G-30). validateRoster now covers
  // barrier_nodes as well, because `rosterNodeSetting` resolves an override over them and run-graph
  // applies it at spawn — a bad default reaches `reconcile` exactly as it reaches `code-audit`.
  // The claim is unchanged; the set it ranges over is the one the runtime actually uses. Bare-string
  // entries are legal in barrier_nodes and carry nothing to inherit.
  const inherits = (e) => e && typeof e === 'object' && !e.effort;
  const inheriting = [...roster.lenses, ...(roster.barrier_nodes ?? [])].filter(inherits).length;
  assert.equal(bad.errors.length, inheriting,
    `a bad default must fail every node that inherits it (${inheriting}), not just the one that `
    + 'declares its own');
  assert.match(bad.errors[0], /is not an effort 'claude' accepts/);
});

test('an adapter is validated for the role it serves, not just for having a cmd', async () => {
  // G-28 (panel-codex-contract). `cmd` was the entire requirement, so an adapter with no prompt
  // channel and no response mapping passed — and the cost lands late: the arm spawns, spends, and
  // returns "no parseable verdict envelope", which reads as a broken vendor rather than a broken
  // entry.
  const { adapterErrors } = await import('../scripts/io/reviewers.mjs');
  const bare = adapterErrors('x', { cmd: 'x' }).join(' | ');
  assert.match(bare, /declares no response\.from/, 'nothing says where its answer comes from');
  assert.match(bare, /declares no prompt\.via/, 'nothing says how to hand it the prompt');

  // A NODE runtime has no response mapping and needs none — requiring one would refuse the only
  // adapter that ships.
  for (const [name, a] of Object.entries(builtinReviewers())) {
    assert.deepEqual(adapterErrors(name, a), [], `${name} must still validate`);
  }
  // And the declared exception survives: that adapter supplies its own subject.
  const diffReviewer = { cmd: 'z', roles: ['reviewer'], prompt: { required: false }, response: { from: 'file' } };
  assert.deepEqual(adapterErrors('z', diffReviewer), []);
});

// THE FOURTH ROLE WAS DECLARED AND NEVER ASKED ABOUT (G-47, arch-review + contract-audit on I-20).
//
// `ROLE_REQUIREMENTS['tie-break']` sat in the table while roleGaps' only two call sites asked about
// 'arm' and 'intent'. So the tie-break row in nodes/expected.json carried `['convention']`, 'MEDIUM'
// and 'RISK' as inline literals — the assigned-not-derived pattern this module's own header names as
// the defect it was written to remove — and two things followed silently: `basis_ceilings` in
// lens-roster.json, the file declared to OWN those numbers, never reached the tie-breaker, and a
// tie-breaker whose adapter declares no structured_output was spawned rather than refused, coming
// back as "no parseable verdict envelope" — a broken vendor's shape, not a broken table entry's.
test('the tie-break role is derived and checked like every other', async () => {
  const { roleGaps, ROLE_REQUIREMENTS, runtimeContract } = await import('../scripts/lib/capabilities.mjs');
  const { builtinReviewers } = await import('../scripts/io/reviewers.mjs');
  const roster = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lens-roster.json'), 'utf8'));

  // The declared tie-breaker must actually meet the role — otherwise this repository ships a roster
  // whose adjudicator cannot adjudicate.
  // EVERY declared judge must meet the role. The singleton became a set, and a roster whose SECOND
  // judge cannot adjudicate ships a panel that is quietly narrower than it claims.
  const judges = (roster.adjudicators ?? []).map((j) => j.reviewer);
  assert.ok(judges.length >= 2, 'no judge set declared — this test would pass vacuously');
  for (const declared of judges) {
    assert.deepEqual(roleGaps(builtinReviewers()[declared], 'tie-break'), [],
      `${declared} is declared as an adjudicator but cannot serve the role`);
  }
  const declared = judges[0];

  // ...and an adapter that does NOT is refused BY NAME, before it spends anything.
  const hollow = { cmd: 'hollow', capabilities: [] };
  assert.deepEqual(roleGaps(hollow, 'tie-break'), ROLE_REQUIREMENTS['tie-break']);

  // The derived values reproduce the literals that were there — which is the point: the numbers were
  // never wrong, they were simply unreachable from the file that declares them.
  const c = runtimeContract(builtinReviewers()[declared], 'tie-break', { ladder: roster.basis_ceilings });
  assert.equal(c.severity_ceiling, 'MEDIUM');
  assert.equal(c.verdict_ceiling, 'RISK');
  assert.ok(c.cap_reason && c.cap_reason.includes('evidence_capture'),
    'the artifact must answer "why was this capped" for the tie-breaker too');

  const graph = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  // ANCHORED ON THE SPAWNED JUDGE'S ROW, not on the first mention of the kind. `kind:
  // NODE_KIND.adjudication` now also appears on the row written for a judge REFUSED for a role gap
  // (G-43), which comes first in the file and carries no limits at all — so a window opened there
  // ended before the fields this checks, and the test failed for a reason that was not a defect.
  const rowAt = graph.indexOf('node_id: nodeId, skill: null, kind: NODE_KIND.adjudication');
  assert.ok(rowAt !== -1, 'could not find the spawned adjudicator\'s expected row');
  const row = graph.slice(rowAt, rowAt + 1600);
  assert.ok(!/allowed_basis: \['convention'\]/.test(row), 'the tie-break row still assigns literals');
  assert.match(row, /allowed_basis: tbLimits\.allowed_basis/);
  assert.match(row, /runtime: tbLimits\.runtime/, 'the runtime contract carries cap_reason into the artifact');
  // PER JUDGE, because the set can be mixed: one unusable vendor must not erase the votes the
  // others can cast, and the surviving panel being narrower is itself reportable.
  assert.match(graph, /roleGaps\(REVIEWER_TABLE\[j\.reviewer\], 'tie-break'\)/);

  // A refusal must not erase what it refused to look at: the disputes are still disputed and still
  // counted, they are simply unadjudicated and said to be.
  // With a judge SET the condition inverted: adjudicate while ANY judge is eligible, rather than
  // refuse when one has a gap. A single unusable vendor must not erase the votes the others can
  // cast — and `disputed` is still what carries through, never an emptied list.
  assert.match(graph, /const toAdjudicate = eligible\.length \? disputed : \[\];/);
  assert.match(graph, /no declared adjudicator can serve the role/,
    'and a panel where nobody is eligible is named, not silently empty');
  assert.ok(!/disputed\.length = 0/.test(graph), 'emptying the dispute list hides the contradictions');
});

// THE POLICY FILE STILL SPOKE ONE VENDOR'S VOCABULARY (G-36/G-37, panel-codex-contract +
// contract-audit on I-22).
//
// The adapter table lifted the FLAGS out of the spawner and left the RULES behind: declared-command
// grants were assembled as `${sh}(${c})` in the orchestrator, the read-only git set was three
// `Bash(...)` literals, and the deny list was a Bash block plus a PowerShell block behind a
// `process.platform === 'win32'` test — two hand-kept copies of one list, which is the shape that
// let PowerShell go missing from the intent deny list for months (G-28).
test('every generated permission rule is rendered from the runtime, not spelled here', async () => {
  const { grantRules } = await import('../scripts/lib/capabilities.mjs');
  const { builtinReviewers } = await import('../scripts/io/reviewers.mjs');
  const claude = builtinReviewers().claude;

  // PREFIX and EXACT are different rules, and the difference is a security property: a declared
  // build command is granted as written, while a capture invocation needs the open tail because
  // its arguments vary per node.
  assert.deepEqual(grantRules(claude, ['npm run build'], 'win32', { exact: true }),
    ['Bash(npm run build)', 'PowerShell(npm run build)']);
  assert.deepEqual(grantRules(claude, ['git status'], 'linux'), ['Bash(git status:*)']);

  // An adapter declaring only the prefix form gets NO exact rules rather than a widened one: a
  // fallback that grants more than the caller asked for is the wrong kind of fallback.
  const prefixOnly = { cmd: 'x', node_runtime: { grants: { command_rule: '{{tool}}({{command}}:*)', shell_tools: { default: ['Sh'] } } } };
  assert.deepEqual(grantRules(prefixOnly, ['make'], 'linux', { exact: true }), []);
  assert.deepEqual(grantRules(prefixOnly, ['make'], 'linux'), ['Sh(make:*)']);

  // G-7 of 20261023-214545-ger-remediation-review: these rules were filled by chained String.replace, not the one template
  // renderer, so `$&` in a command was a replacement pattern and a misspelled slot was emitted literally into the policy.
  assert.deepEqual(grantRules(prefixOnly, ['echo $& $1'], 'linux'), ['Sh(echo $& $1:*)'], 'a $ in a command is literal');
  const typo = { cmd: 'x', node_runtime: { grants: { command_rule: '{{tool}}({{comand}}:*)', shell_tools: { default: ['Sh'] } } } };
  assert.throws(() => grantRules(typo, ['make'], 'linux'), /comand|no value|supplied/, 'a misspelled slot is a configuration error');
  const { pathRules } = await import('../scripts/lib/capabilities.mjs');
  const edits = { cmd: 'x', node_runtime: { grants: { path_rule: '{{tool}}({{path}})' }, tools: { edit_tools: ['Edit'] } } };
  assert.deepEqual(pathRules(edits, ['a/$&/**']).rules, ['Edit(a/$&/**)'], 'a $ in a glob is literal');
  const pathTypo = { cmd: 'x', node_runtime: { grants: { path_rule: '{{tool}}({{paht}})' }, tools: { edit_tools: ['Edit'] } } };
  assert.throws(() => pathRules(pathTypo, ['src/**']), /paht|no value|supplied/, 'a misspelled slot is a configuration error');

  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'new-run.mjs'), 'utf8');
  const policy = src.slice(src.indexOf('function buildNodeSettings('), src.indexOf('function buildIntentSettings('));
  assert.ok(!/\$\{sh\}\(\$\{c/.test(policy), 'a rule assembled from a tool name in the orchestrator');
  assert.ok(!/'Bash\(git status:\*\)'/.test(policy), 'the git set must come from the runtime');
  // Comments in this function DISCUSS the platform test that used to be here, so the check is for
  // the code shape — a conditional spread guarded by the platform — not for the string.
  assert.ok(!/\.\.\.\(process\.platform === 'win32'/.test(policy),
    'a platform test here is the vendor vocabulary by another name — and the two lists it kept apart drifted');
  assert.ok(!/'PowerShell\(/.test(policy), 'no runtime tool name is spelled in this file');
});

// A SUFFIX-RESTRICTED doc_paths GLOB BECAME A RECURSIVE DIRECTORY GRANT (G-34, panel-codex-security).
//
// `docs/*.md` was reduced to its directory prefix and granted as `Read(//docs/**)`, so the intent
// node — the one node that may not see the implementation — got every descendant of docs/, however
// narrow the operator wrote the glob. coveredByGlobs already treats a trailing `*.ext` as binding
// for SCOPE (G-16); the grant side is the stronger of the two surfaces and had the weaker rule.
test('a doc_paths glob is never granted in place, so nothing widens its suffix', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-docglob-'));
  try {
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
    const yaml = [
      'graph_contract: 1', 'project: t', 'commands:', '  build: ""', '  test: ""',
      'doc_paths: ["docs/*.md", "CLAUDE.md"]',
    ].join('\n');
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# t\n\n```yaml\n' + yaml + '\n```\n');

    const r = runScript('new-run.mjs',
      ['--slug', 'docglob', '--repo-root', dir, '--no-request', '--no-verify-sandbox', '--full-sweep', 'docs'],
      { cwd: dir });
    assert.equal(r.status, 0, r.output);
    // FROM new-run's OWN OUTPUT, not from a rebuilt path. This test is about a doc_paths glob keeping
    // its suffix; it rebuilt `<project>/.claude/reviews/<id>` and so silently also pinned WHERE runs
    // live, which is how it broke on a change it has nothing to do with.
    const runPath = mintedRunDir(r.output);
    const allow = JSON.parse(fs.readFileSync(path.join(runPath, 'intent-settings.json'), 'utf8')).permissions.allow;

    // NO GRANT AT ALL since contract-glob-grammar stage 4 (operator, 2026-10-01: "B: copy only matched docs
    // (Recommended)"): the grant this asserted — a Read rule keeping the glob's suffix — granted nothing on Windows (stage
    // 2b's probe), and the intent node now reads only a sandbox of copies of exactly what the glob matches. The claim of
    // G-34, that `docs/*.md` gives no more than `docs/*.md`, is held by tests/regression-doc-snapshot.test.mjs on a real
    // repository; here, that no rule hands over anything in place.
    const docRule = allow.find((a) => a.includes('docs'));
    assert.equal(docRule, undefined, `a doc glob is still granted in place: ${docRule}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
