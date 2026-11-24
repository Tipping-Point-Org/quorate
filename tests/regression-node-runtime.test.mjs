// Why does the orchestrator need to know the CLI's name? It does not, and now it does not.
//
// spawn-node built eleven Claude-shaped flags inline — `-p`, `--model`, `--output-format`,
// `--effort`, `--json-schema`, `--settings`, `--setting-sources`, `--add-dir`, `--disallowedTools`,
// `--permission-mode`, `--max-budget-usd`, `--session-id`, `--no-chrome`. The vendor's NAME appeared
// only twice, which made the coupling look small; the coupling was the whole invocation.
//
// It is a table entry now. `node_runtime` in an adapter declares how that runtime spells each slot,
// lib/decisions.mjs renders the sequence, and spawn-node decides only WHAT the node gets — which
// paths, which denials, which budget. The requirement/mechanism split from
// shared/adapter-contract.md is the point: quorate asks for `path_scoped_read`, and a runtime
// answers with whatever flag delivers it.
//
// WHAT THESE TESTS ARE FOR. The refactor must not have changed a single argument (proven against
// captured baselines when it landed), and a foreign runtime must actually work — otherwise this is
// indirection that only ever renders one thing, which is the shape of a capability nobody has.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runScript, REPO_ROOT, repoRunDir } from './helpers.mjs';
import { nodeArgv } from '../scripts/lib/decisions.mjs';
import { builtinReviewers } from '../scripts/io/reviewers.mjs';
import { roleGaps } from '../scripts/lib/capabilities.mjs';

// A runtime with a deliberately alien vocabulary: not one flag it shares with Claude Code. If any
// part of the spawner still assumes a spelling, this is where it shows.
const ZED = {
  cmd: 'zed',
  capabilities: ['structured_output', 'evidence_capture', 'path_scoped_read',
    'content_tool_denial', 'no_write', 'budget_bound', 'wall_clock_bound', 'credential_scoping'],
  node_runtime: {
    prompt: { flag: '--ask' }, model: { flag: '-m' },
    output_format: { flag: '--fmt', value: 'json' },
    schema: { flag: '--shape' }, settings: { flag: '--policy' },
    add_dir: { flag: '--allow', repeat: 'varargs' },
    deny_tools: { flag: '--forbid', repeat: 'varargs' },
    // ITS OWN TOOL NAMES. A runtime that declares content_tool_denial and names no content-reading
    // tool is claiming something it gives no mechanism for — the deny list renders empty and the
    // spawn looks ordinary. spawn-node refuses that now, which this fixture would otherwise trip.
    // TWO LISTS, because the difference is the sandbox (G-54): `lens_allow` is what a LENS gets
    // besides a scoped read and may hold a content tool; `name_tools` is what the INTENT node gets
    // and may not. This fixture declared one key named `intent_allow` holding the lens's list,
    // which is exactly the confusion that let the intent policy keep a hardcoded `Glob`.
    tools: {
      // `Exec`, the shell tool its grants declare: `Shell` named no tool of this runtime, so the intent node kept its
      // shell, and the fixture passed only while a non-empty deny list counted as proof (G-1 of
      // 20261026-174311-rct-remediation-review).
      deny_always: ['Modify', 'Fetch'], deny_intent: ['Exec', 'Search'],
      lens_allow: ['Search', 'List'], name_tools: ['List'],
    },
    // And its own grant vocabulary, for the same reason: `evidence_capture` is a claim, and the
    // orchestrator cannot write a policy from a claim. A runtime that declares the capability and
    // no way to spell a grant is refused by name rather than silently given an empty allow-list.
    grants: { shell_tools: { default: ['Exec'] }, content_tools: ['Search'], command_rule: 'permit {{tool}} {{command}}' },
    permission_mode: { flag: '--mode', sandboxed: 'strict', unsandboxed: 'open' },
    budget: { flag: '--cap' },
    // Its own deadline flag. `wall_clock_bound` is declared above, and a declared capability with
    // no mechanism is refused by name (G-18) — the shipped Claude entry stopped declaring it
    // because that CLI has none, and this fixture keeps the slot exercised by a foreign vocabulary.
    timeout: { flag: '--deadline' },
    session: { flag: '--sid' }, always: ['--quiet'],
  },
};

function printCmd(extra, { contract = {} } = {}) {
  const { base, dir } = repoRunDir({ runId: '20260101-000000-runtime', json: { contract } });
  try {
    fs.writeFileSync(path.join(dir, 'node-settings.json'), JSON.stringify({ permissions: { allow: [], deny: [] } }));
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
    const r = runScript('spawn-node.mjs', [
      '--run-dir', dir, '--repo-root', REPO_ROOT, '--prompt', 'P',
      '--node-id', 'code-audit', '--mode', 'lens', '--allowed-basis', 'convention',
      '--settings', path.join(dir, 'node-settings.json'), '--add-dir', path.join(dir, 'docs'),
      '--print-cmd', ...extra,
    ]);
    return { r, cmd: r.status === 0 ? JSON.parse(r.stdout) : null };
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

// NAMED FOR WHAT IT PINS (G-47, panel-codex-arch). This was called "a node SPAWNS on a runtime the
// engine has never heard of", and it spawns nothing: the helper passes --print-cmd and exits before
// executing anything. A test's name is a claim, and that one could not fail if the runtime were
// dropped downstream or if the generated policy were incompatible — only if the argv rendering
// changed.
//
// The rendering is worth pinning on its own: it is where eleven Claude-shaped flags used to live.
// What the name promised is covered elsewhere, deliberately split: run-graph forwarding the declared
// runtime is asserted below ("the runtime the contract declares reaches the nodes that run under
// it"), and the policy files' vocabulary in "the tool vocabulary comes from the runtime, in both
// policy files". Executing `zed` would test nothing — there is no such binary — so the honest
// decomposition is three checks that can each fail, rather than one name that cannot.
test('the argv for a runtime the engine has never heard of is rendered from its adapter', () => {
  // THE ANSWER TO "what does yet mean". Declared only in the run's contract, never in the engine.
  const { r, cmd } = printCmd(['--model', 'some-model', '--runtime', 'zed', '--timeout-minutes', '7'],
    { contract: { reviewers: { zed: ZED } } });
  assert.equal(r.status, 0, `spawn refused a declared runtime:\n${r.output.slice(0, 400)}`);
  assert.equal(cmd[0], 'zed', 'the runtime supplies the binary');
  const flat = cmd.map(String);
  // `--deadline` among them (G-15 of 20261122-055431-m3s7-b3-remediation-2-review): the timeout slot was validated and
  // never rendered, so a runtime declaring wall_clock_bound received no deadline.
  for (const own of ['--ask', '-m', '--fmt', '--shape', '--policy', '--allow', '--forbid', '--mode', '--cap', '--deadline', '--sid', '--quiet']) {
    assert.ok(flat.includes(own), `the runtime's own flag ${own} must be rendered`);
  }
  assert.equal(flat[flat.indexOf('--deadline') + 1], '420', 'the deadline is the node\'s own timeout, in whole seconds');
  for (const claudeism of ['-p', '--json-schema', '--settings', '--add-dir', '--disallowedTools', '--permission-mode', '--no-chrome']) {
    assert.ok(!flat.includes(claudeism), `${claudeism} leaked into a foreign runtime's argv`);
  }
  assert.equal(flat[flat.indexOf('--mode') + 1], 'strict', 'the sandboxed spelling is the runtime\'s own');
  // G-18 of 20261122-144505-m3s7-b3-remediation-3-review: a sub-second timeout floored to a deadline of 0, which a
  // runtime may read as expire now or as no deadline. Whole seconds, never below one.
  const sub = printCmd(['--model', 'some-model', '--runtime', 'zed', '--timeout-minutes', '0.005'], { contract: { reviewers: { zed: ZED } } });
  assert.equal(sub.r.status, 0, `spawn refused a sub-second timeout:\n${sub.r.output.slice(0, 400)}`);
  const subFlat = sub.cmd.map(String);
  assert.equal(subFlat[subFlat.indexOf('--deadline') + 1], '1', 'a sub-second timeout rendered a deadline below one second');
  // G-15 of the same review: every --add-dir stat failure was reported as "does not exist". A path through a file, or a
  // component past the name limit, fails with another code where the platform says so, and the refusal names that code.
  const codeOf = (p) => { try { fs.statSync(p); return null; } catch (e) { return e.code; } };
  const tooLong = [path.join(REPO_ROOT, 'CLAUDE.md', 'x'), path.join(REPO_ROOT, 'x'.repeat(300))]
    .find((p) => codeOf(p) !== 'ENOENT') ?? path.join(REPO_ROOT, 'x'.repeat(300));
  const code = codeOf(tooLong);
  const bad = printCmd(['--add-dir', tooLong]);
  assert.notEqual(bad.r.status, 0, 'an unreadable --add-dir was accepted');
  if (code === 'ENOENT') assert.match(bad.r.output, /--add-dir path does not exist/);
  else assert.match(bad.r.output, new RegExp(`--add-dir path cannot be read \\(${code}\\)`), `stat failed with ${code}:\n${bad.r.output.slice(0, 400)}`);
});

test('the default runtime is a lookup, not a literal', () => {
  const { r, cmd } = printCmd(['--model', 'opus']);
  assert.equal(r.status, 0, r.output.slice(0, 300));
  assert.equal(cmd[0], builtinReviewers().claude.cmd,
    'the shipped default comes from the table like any other runtime');
});

test('a runtime that cannot serve the role is refused BY NAMED CAPABILITY', () => {
  // "Unsupported" is a wall. A named gap is something an adapter author can build against — the
  // whole reason shared/adapter-contract.md states what each requirement achieves.
  // Its one declared capability is BACKED (a schema flag), so the refusal is the role's, not unbackedCapabilities': this
  // fixture declared structured_output with no flag to carry it, and passed only while that guard never fired (G-9 of
  // 20261026-080302-rct-delivery).
  const promptOnly = { cmd: 'thin', capabilities: ['structured_output'], node_runtime: { prompt: { flag: '-p' }, schema: { flag: '--shape' } } };
  const { r } = printCmd(['--runtime', 'thin'], { contract: { reviewers: { thin: promptOnly } } });
  assert.equal(r.status, 2);
  assert.match(r.output, /cannot serve the lens role/);
  assert.match(r.output, /evidence_capture/, 'the refusal names what is missing');
  assert.match(r.output, /adapter-contract\.md/, 'and where to read what it achieves');
});

test('an unknown runtime name is refused, not silently defaulted', () => {
  const { r } = printCmd(['--runtime', 'nosuchruntime']);
  assert.equal(r.status, 2);
  assert.match(r.output, /not in the adapter table/);
});

test('the shipped runtime declares every capability the lens role requires', () => {
  // If this ever fails, the framework is spawning lenses on a runtime its own contract says cannot
  // hold them — which would mean the contract is decorative.
  assert.deepEqual(roleGaps(builtinReviewers().claude, 'lens'), []);
  assert.deepEqual(roleGaps(builtinReviewers().claude, 'intent'), []);
});

test('every slot is optional: a runtime omits what it has no concept of', () => {
  const minimal = { cmd: 'tiny', node_runtime: { prompt: { flag: '-p' } } };
  const { cmd, argv } = nodeArgv(minimal, { prompt: 'hello', model: 'ignored', budgetUsd: '2.00' });
  assert.equal(cmd, 'tiny');
  assert.deepEqual(argv, ['-p', 'hello'],
    'a runtime with no model or budget flag renders neither, rather than inventing one');
});

test('a runtime with no cmd is a configuration error, not an empty spawn', () => {
  assert.throws(() => nodeArgv({ node_runtime: {} }, { prompt: 'x' }), /declares no cmd/);
});

test('the unsandboxed spelling is the runtime\'s, and is only used when asked', () => {
  const { argv: strict } = nodeArgv(ZED, { prompt: 'x', sandboxed: true });
  const { argv: open } = nodeArgv(ZED, { prompt: 'x', sandboxed: false });
  assert.equal(strict[strict.indexOf('--mode') + 1], 'strict');
  assert.equal(open[open.indexOf('--mode') + 1], 'open');
});

test('a capability with no mechanism is refused by name', () => {
  // A DECLARATION THE RUNTIME CANNOT KEEP is worse than one it never made: the framework grants the
  // role, writes a policy that denies nothing, and reports a sandboxed node. Found by this file's
  // own fixture, which claimed content_tool_denial and named no content-reading tool — the deny
  // list rendered empty and the spawn looked ordinary.
  const hollow = {
    cmd: 'hollow',
    capabilities: ['structured_output', 'evidence_capture', 'path_scoped_read',
      'content_tool_denial', 'no_write'],
    node_runtime: { prompt: { flag: '-p' } },   // claims everything, provides nothing
  };
  const { r } = printCmd(['--runtime', 'hollow'], { contract: { reviewers: { hollow } } });
  assert.equal(r.status, 2);
  assert.match(r.output, /declares capabilities it gives no mechanism for/);
  assert.match(r.output, /content_tool_denial/, 'and names which claim is hollow');
  assert.match(r.output, /deny_intent/, 'and the key that would back it');
});

test('the default runtime name is declared by the table, not by the spawner', () => {
  // "Claude is the only runtime that works today" is a fact about the world. "The spawner names
  // Claude" was a fact about this codebase, and only the second was ours to fix.
  const raw = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'reviewers.json'), 'utf8'));
  assert.equal(typeof raw.default_node_runtime, 'string', 'the table must declare its own default');
  const code = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'spawn-node.mjs'), 'utf8')
    .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.ok(!/'claude'/.test(code), 'no vendor name may appear in a decision in the spawner');
  const newRun = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'new-run.mjs'), 'utf8')
    .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.ok(!/'claude'/.test(newRun), 'nor in the script that writes the policy it runs under');
});

test('the tool vocabulary comes from the runtime, in both policy files', async () => {
  const { denyToolsFor } = await import('../scripts/lib/decisions.mjs');
  const zedDeny = denyToolsFor('intent', ZED);
  assert.deepEqual(zedDeny, ['Modify', 'Fetch', 'Exec', 'Search'],
    'an intent node is denied the runtime\'s writers AND its content readers');
  // An ordinary node keeps the shell (it is not behind Rule 2) but loses the runtime's content tools, which no rule can
  // confine to the repository (G-7 of 20261105-212751-sogsr-delivery; G-17, the operator's B).
  assert.deepEqual(denyToolsFor('node', ZED), ['Modify', 'Fetch', 'Search'],
    'an ordinary node keeps the shell and is denied the content readers');
  // A runtime that declares no vocabulary gets nothing, and the caller refuses the spawn. Returning
  // a Claude-shaped list here would be the hardcoding one level down.
  assert.deepEqual(denyToolsFor('intent', { cmd: 'x' }), []);
});

// THE DURABLE ARTIFACT NAMED A VENDOR, AND READ A FIELD THAT NO LONGER EXISTS (G-53, raised by
// contract-audit, panel-codex-arch and contract-audit again on I-26).
//
// Two lines of the node report survived the runtime seam: `claude --resume <id>`, and a host line
// reading `host.claude_version` after new-run had renamed that field to `runtime_version` for
// exactly this reason. So every node report in the run that found this printed ``claude `unknown` ``
// while run.json recorded 2.1.265 — and 'unknown' is indistinguishable from a version that could not
// be probed, which makes a stale read worse here than a crash. The report is what a consuming
// project keeps; it is the last place a vendor name should outlive the seam.
test('the node report renders its resume hint from the adapter and its version from the field that exists', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'spawn-node.mjs'), 'utf8');
  const render = src.slice(src.indexOf('function renderReport('));

  assert.ok(!/`claude --resume \$\{/.test(render),
    'the report must not name a CLI — a node spawned on another runtime prints a binary it never used');
  assert.ok(!/host\.claude_version/.test(render),
    'new-run records runtime_version; reading the old name yields `unknown` in every report');
  assert.match(render, /host\.runtime_version/);
  assert.match(render, /resumeHint\(/);

  // The shipped runtime declares the entrypoint, so the hint is real rather than always-absent.
  const claude = builtinReviewers().claude;
  assert.deepEqual(claude.node_runtime.resume_argv, ['--resume', '{{session}}'],
    'the resume command belongs to the runtime, beside the flags it already declares');

  // ...and an adapter without one must produce a report that SAYS so. A runtime that cannot reopen
  // a session leaves attribution mitigated rather than solved, and that is a fact worth printing —
  // inventing a command for it is the defect, and so is printing nothing.
  assert.equal(ZED.node_runtime.resume_argv, undefined, 'ZED is the no-resume case this asserts');
  const hint = src.slice(src.indexOf('function resumeHint('), src.indexOf('function renderReport('));
  assert.match(hint, /required: false/, 'a missing resume path must not throw at render time');
  assert.match(hint, /declares no way to reopen a session/);
});

// AND THE DOCTRINE THAT PRESCRIBED THE LITERAL. I-60 requires that no script contradict a doctrine
// document and that a residual conflict be REPORTED rather than left standing. Appendix A of the
// protocol printed `claude --resume <session_id>` verbatim while adapter-contract.md forbade the
// orchestrator naming a CLI, so a maintainer reading either document reached the opposite conclusion
// about whether the vendor seam was closed — and nothing recorded that they disagreed.
test('no doctrine document prescribes a vendor command for the node runtime', () => {
  for (const doc of ['disk-first-protocol.md', 'graph-topologies.md', 'claude-md-contract.md']) {
    const text = fs.readFileSync(path.join(REPO_ROOT, 'shared', doc), 'utf8');
    assert.ok(!/`claude --resume/.test(text), `${doc} still prescribes a vendor resume command`);
    assert.ok(!/claude_version, cwd/.test(text), `${doc} still documents the pre-seam host field`);
  }
});

// THE RULE 2 SANDBOX HAD A CLAUDE CODE TOOL NAME WRITTEN INTO IT (G-54, doc-consistency-review).
//
// adapter-contract.md says in terms that a runtime declaring no grant vocabulary gets NO rules, not
// guessed ones — and the intent policy's allow list was `[...docReadRules(), 'Glob']`, a literal, in
// the ONE policy file §5 calls the Rule 2 sandbox. The lens policy read the adapter's list; the
// intent policy did not. So a second runtime got a rule for a tool it does not have, and its own
// declared name-lister was never granted there at all.
//
// The fix is TWO keys, not a shared one: the lens list contains `Grep`, and a content tool in the
// intent policy is the hole path-scoped Read exists to close. Relying on the deny list to catch it
// would make the sandbox depend on two lists disagreeing correctly.
test('the intent policy grants the runtime name-listing tools and no content tool', async () => {
  const { builtinReviewers } = await import('../scripts/io/reviewers.mjs');
  const tools = builtinReviewers().claude.node_runtime.tools;

  assert.deepEqual(tools.name_tools, ['Glob'], 'names only — a name is not content');
  // The lens list carried Grep until stop-owner-grep-state-roots.plan.md stage 3 (operator, 2026-10-22, B): neither list
  // holds a content tool now, and regression-lens-no-grep holds the lens side.
  assert.ok(!tools.lens_allow.includes('Grep'), 'no lens is granted a content tool it cannot be confined in');
  for (const t of tools.name_tools) {
    assert.ok(!tools.deny_intent.includes(t),
      `${t} is granted to the intent node and denied to it — one of the two lists is wrong`);
  }

  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'new-run.mjs'), 'utf8');
  const fn = src.slice(src.indexOf('function buildIntentSettings('));
  assert.ok(!/allow: \[\.\.\.docReadRules\(\), 'Glob'\]/.test(fn),
    'a tool name in the orchestrator is the defect, whatever the name happens to be');
  // Read through the one accessor of an adapter's tool lists (adapter-tool-lists.plan.md stage 2).
  assert.match(fn, /toolList\(NODE_RUNTIME, 'name_tools'\)/);
  assert.ok(!/lens_allow/.test(fn.slice(0, fn.indexOf('}'))),
    'the intent policy must not reuse the lens list — it contains Grep');
});

// THE ORCHESTRATOR NEVER FORWARDED THE DECLARED RUNTIME (G-28, panel-codex-arch).
//
// new-run reads `review.runtime` to pick the adapter it writes both policy files and both canaries
// under. run-graph's spawnNode neither accepted nor forwarded it, and spawn-node falls back to
// `default_node_runtime` when --runtime is absent — so a project declaring a runtime got its
// mint-time policy generated for THAT one and its lenses spawned under another, with every run
// recording the mint's answer as though it were the lenses'.
test('the runtime the contract declares reaches the nodes that run under it', () => {
  // Since contract-runtime-and-session-files.plan.md stage 1 the runtime is chosen by the one owner, selectAdapters, from
  // the FROZEN contract (`contract` here is run.json's), and forwarded to every node.
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  assert.match(src, /argv\.push\('--runtime', NODE_RUNTIME\)/,
    'a runtime chosen at mint and not forwarded is two halves of one boundary disagreeing');
  assert.match(src, /const ADAPTERS = selectAdapters\(\{ contract \}\)/, 'the runtime must come from the run, not from the live file');
  assert.match(src, /NODE_RUNTIME = ADAPTERS\.runtime/);

  // And spawn-node still honours the flag it is handed, through the same owner.
  const spawn = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'spawn-node.mjs'), 'utf8');
  assert.match(spawn, /'--runtime': 'runtime'/);
  assert.match(spawn, /selectAdapters\(\{ contract: runJson\?\.contract \?\? null, runtimeArg: args\.runtime \?\? null \}\)/,
    'absent stays a lookup, never a literal');
});

// A PROMPT THAT BEGINS WITH A DASH WAS READ AS AN OPTION (found 2026-10-20, plan-review round 1 of code-index): the brief
// is SKILL.md, whose front matter starts `---`, and claude -p answered "error: unknown option '---\nname: plan-review...".
// The prompt travels as a flag's value, and a CLI's option parser takes a value starting with "-" for another flag.
// Since decision-panel-seats.plan.md stage 2 the shipped runtime takes its prompt on stdin, where no option parser reads
// it: the guard is held for a runtime that still takes the prompt in argv, and the stdin path is held to carry the text
// raw, with nothing after the bare -p.
test('nodeArgv: a prompt beginning with a dash cannot be read as an option', () => {
  const argvRuntime = { cmd: 'rt', node_runtime: { prompt: { flag: '-p' } } };
  const { argv } = nodeArgv(argvRuntime, { prompt: '---\nname: plan-review\n' });
  const value = argv[argv.indexOf('-p') + 1];
  assert.ok(!value.startsWith('-'), `the prompt value starts with a dash: ${JSON.stringify(value.slice(0, 10))}`);
  assert.ok(value.includes('---\nname: plan-review'), 'the prompt text was changed beyond its first character');
  const claude = builtinReviewers().claude;
  const stdin = nodeArgv(claude, { prompt: '---\nname: plan-review\n', model: 'opus' });
  assert.equal(stdin.input, '---\nname: plan-review\n', 'the stdin prompt was changed');
  assert.ok(!stdin.argv.some((a) => a.includes('name: plan-review')), 'the prompt is in argv too');
});
