// EVERY ENTRYPOINT PARSES ITS COMMAND LINE THROUGH ONE PARSER (entrypoint-argv.plan.md stages 3 and 4).
//
// 23 scripts read a flag's value as `a[++i]`, so a trailing `--only` deselected every lens and `--base --dry-run` took the
// next flag as its value; 9 let an unknown flag pass (G-7 of 20261020-122714-ciss-remediation-4b-review). Each script now
// parses through lib/argv.mjs's parseArgv against its spec in lib/argv-specs.mjs. This file holds four things to that:
//   (a) every converted script refuses a trailing value-taking flag (or an unknown one) naming it, before any work;
//   (b) the source scan of stage 4: no `[++i]`, every process.argv reader calls parseArgv, at least 26 of them;
//   (c) every documented invocation a person or a node reads parses against its script's spec;
//   (d) every argv the engine builds for another quorate script parses against that script's spec.
// (c) and (d) are the consumers the plan names: the new rule must not refuse a command the docs or the engine give.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript, withTempDir, REPO_ROOT, SCRIPTS_DIR } from './helpers.mjs';
import { parseArgv } from '../scripts/lib/argv.mjs';
import { ARGV_SPECS } from '../scripts/lib/argv-specs.mjs';
import { matchesGlob } from '../scripts/lib/contract-glob.mjs';
import { readContract } from '../scripts/io/contract-reader.mjs';
import { preflightArgv, PROBE_REVIEW_SCHEMA, PROBE_PROPOSE_SCHEMA, PROBE_CANDIDATE_FIELDS } from '../scripts/lib/reviewer-probe.mjs';

// The two top-level scripts that read no command line, and so have no spec.
const NO_ARGV = ['check-syntax', 'gen-gitleaks-config'];
const topLevelScripts = () => fs.readdirSync(SCRIPTS_DIR).filter((f) => f.endsWith('.mjs')).sort();

// ----------------------------------------------------------------------------------------------------------- (a)
// One row per converted script: an argv ending in a value-taking flag with no value (check-secrets takes none, so an
// unknown flag), and the flag the refusal must name. GRAPH_NODE_DEPTH is unset by runScript.
const TRAILING = {
  'new-run': { argv: ['--no-verify-reviewers', '--slug'], flag: '--slug' },
  'run-graph': { argv: ['--skip-panel', '--run-dir'], flag: '--run-dir', opts: { mayFanOut: true } },
  remediate: { argv: ['--run-dir'], flag: '--run-dir' },
  'spawn-node': { argv: ['--run-dir'], flag: '--run-dir' },
  'spawn-subagent': { argv: ['--prompt-file'], flag: '--prompt-file' },
  // Before the `--` its command follows.
  capture: { argv: ['--run-dir', '--', 'node', '-v'], flag: '--run-dir' },
  'archive-run': { argv: ['--run-dir'], flag: '--run-dir' },
  'stop-log': { argv: ['--summary', '--repo-root'], flag: '--repo-root' },
  telemetry: { argv: ['backfill', '--repo-root'], flag: '--repo-root' },
  'stop-guard': { argv: ['--repo-root'], flag: '--repo-root' },
  'command-log': { argv: ['--summary', '--repo-root'], flag: '--repo-root' },
  'gen-rule-text': { argv: ['--root'], flag: '--root' },
  'run-checks': { argv: ['--run-dir'], flag: '--run-dir' },
  preflight: { argv: ['--run', '--repo-root'], flag: '--repo-root' },
  'claim-check': { argv: ['--new'], flag: '--new' },
  decide: { argv: ['--question'], flag: '--question' },
  'run-session': { argv: ['start', '--plan'], flag: '--plan' },
  'resume-run': { argv: ['--repo-root'], flag: '--repo-root' },
  'external-review': { argv: ['--reviewer'], flag: '--reviewer' },
  publish: { argv: ['--ref'], flag: '--ref' },
  'pr-comments': { argv: ['--run-dir'], flag: '--run-dir' },
  'check-reviewers': { argv: ['--reviewer'], flag: '--reviewer' },
  'check-plan-verdict': { argv: ['--verdict'], flag: '--verdict' },
  'check-intent-grant': { argv: ['--out'], flag: '--out' },
  'check-install': { argv: ['--repo-root'], flag: '--repo-root' },
  'check-counted-facts': { argv: ['--doc'], flag: '--doc' },
  'check-secrets': { argv: ['--no-such-flag'], flag: '--no-such-flag' },
  'code-index': { argv: ['build', '--repo-root'], flag: '--repo-root' },
  'find-inert-features': { argv: ['--repo-root'], flag: '--repo-root' },
  'findings-ledger': { argv: ['--run-dir'], flag: '--run-dir' },
  'usage-report': { argv: ['--since'], flag: '--since' },
  'bench-admit': { argv: ['--current'], flag: '--current' },
  'bench-lenses': { argv: ['--seed'], flag: '--seed' },
  'bench-repair-pass': { argv: ['--case'], flag: '--case' },
  'bench-second-opinion': { argv: ['--from'], flag: '--from' },
  'extract-sessions': { argv: ['--project'], flag: '--project' },
  'check-quotes': { argv: ['--page'], flag: '--page' },
};

test('(a) the table covers every script with a spec, and every spec belongs to a script', () => {
  const scripts = topLevelScripts().map((f) => f.replace(/\.mjs$/, '')).filter((n) => !NO_ARGV.includes(n));
  assert.deepEqual(Object.keys(ARGV_SPECS).sort(), scripts, 'a spec for each script that reads its command line');
  assert.deepEqual(Object.keys(TRAILING).sort(), scripts, 'a refusal row for each');
});

for (const [name, row] of Object.entries(TRAILING)) {
  test(`(a) ${name} refuses ${row.argv.join(' ')}, naming ${row.flag}, before doing any work`, () => {
    // The row's flag is what the spec says it is: a value-taking flag, or (check-secrets) not a flag at all.
    const type = ARGV_SPECS[name].options[row.flag.slice(2)];
    if (name === 'check-secrets') assert.equal(type, undefined);
    else assert.ok(['string', 'repeat', 'list'].includes(type), `${row.flag} takes a value in ${name}'s spec`);
    withTempDir((dir) => {
      const r = runScript(`${name}.mjs`, row.argv, { cwd: dir, ...(row.opts ?? {}) });
      assert.notEqual(r.status, 0, `${name} accepted ${row.argv.join(' ')}:\n${r.output}`);
      assert.ok(r.output.includes(row.flag), `${name}'s refusal names ${row.flag}:\n${r.output}`);
      assert.match(r.output, /needs a value|needs at least one value|unknown flag/, `${name} refused at its parser:\n${r.output}`);
      // Nothing written where it stood: the refusal came before any work.
      assert.deepEqual(fs.readdirSync(dir), [], `${name} wrote into its working directory before refusing`);
    });
  });
}

// ----------------------------------------------------------------------------------------------------------- (b)
test('(b) no top-level script reads a value by position, and every one that reads process.argv calls parseArgv', () => {
  const files = topLevelScripts();
  const src = Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join(SCRIPTS_DIR, f), 'utf8')]));
  const withIncrement = files.filter((f) => src[f].includes('[++i]'));
  assert.deepEqual(withIncrement, [], 'a value read as a[++i] bypasses the parser');
  const readers = files.filter((f) => src[f].includes('process.argv'));
  const callers = files.filter((f) => /\bparseArgv\(/.test(src[f]));
  assert.deepEqual(readers.filter((f) => !callers.includes(f)), [], 'reads process.argv without parseArgv');
  assert.ok(callers.length >= 26, `${callers.length} scripts call parseArgv; the floor is the 26 converted`);
  for (const f of NO_ARGV) assert.ok(!src[`${f}.mjs`].includes('process.argv'), `${f}.mjs reads no command line`);
  // Each caller parses against ITS OWN spec, so a test parsing against that spec tests what the script accepts.
  for (const f of callers) {
    const name = f.replace(/\.mjs$/, '');
    assert.ok(src[f].includes(`ARGV_SPECS['${name}']`) || src[f].includes(`ARGV_SPECS.${name}`), `${f} parses against ARGV_SPECS['${name}']`);
  }
});

// ----------------------------------------------------------------------------------------------------------- shared
// The tokens of one command line: a `<placeholder>`, a quoted string or `{{slot}}` is one value, and may run into text
// (`<dir>/opus.envelope.json`). Usage brackets are dropped; `...` stands for a value after a flag and is dropped after a
// value (`[--group ...]`, `--mark-fixed <key> ...`).
function tokensOf(s) {
  const raw = [...s.matchAll(/(?:<[^>]*>|"[^"]*"|'[^']*'|[^\s<"'])+/g)].map((m) => m[0].replace(/^\[+/, '').replace(/\]+$/, ''))
    .filter(Boolean);
  const out = [];
  for (const t of raw) {
    if (t === '...' || t === '…') {
      const prev = out[out.length - 1];
      if (prev && prev.startsWith('--') && !prev.includes('=')) out.push(t);
      continue;
    }
    out.push(t);
  }
  return out;
}

// ----------------------------------------------------------------------------------------------------------- (c)
// `node <anything>scripts/<name>.mjs <args>`, the args up to a backtick, pipe, `&&`, `;`, `#`, `)` or the line's end,
// outside quotes and `<placeholders>` (a quoted schema carries `|`). A line ending in `\` continues on the next. `.mjs`
// must end the word, so a permission rule (`capture.mjs:*`) is not one.
const INVOCATION = /node\s+(?:"[^"\n]*?|'[^'\n]*?|[^\s`|;&#]*?)scripts\/([a-z0-9-]+)\.mjs(?=["'\s`)]|$)["']?/g;

function argsUntilStop(s) {
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === '\'') { quote = c; continue; }
    if (c === '<') { const end = s.indexOf('>', i); if (end > i) { i = end; continue; } }
    if ('`|;#)'.includes(c) || (c === '&' && s[i + 1] === '&')) return s.slice(0, i);
  }
  return s;
}

function documentedFiles() {
  const { contract } = readContract({ repoRoot: REPO_ROOT });
  assert.ok(contract, 'the contract is readable');
  const tracked = spawnSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  assert.equal(tracked.status, 0, tracked.stderr);
  const docs = contract.doc_paths ?? [];
  const sources = (contract.source_globs ?? []);
  return tracked.stdout.split('\n').filter(Boolean).filter((f) => f === 'README.md' || f.startsWith('.github/')
    || docs.some((g) => matchesGlob(g, f))
    || (!f.startsWith('scripts/') && sources.some((g) => matchesGlob(g, f))));
}

test('(c) every documented invocation of a quorate script parses against that script\'s spec', (t) => {
  const files = documentedFiles();
  const found = [];
  const refused = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(REPO_ROOT, f), 'utf8').replace(/\\\r?\n[ \t]*/g, ' ');
    for (const line of text.split(/\r?\n/)) {
      for (const m of line.matchAll(INVOCATION)) {
        const name = m[1];
        const rest = argsUntilStop(line.slice(m.index + m[0].length));
        const argv = tokensOf(rest);
        found.push(`${f}: ${name}`);
        if (!ARGV_SPECS[name]) {
          // A script with no spec reads no command line: documented with arguments, it would ignore them.
          if (!NO_ARGV.includes(name)) refused.push(`${f}: scripts/${name}.mjs is not a script with a spec`);
          else if (argv.length) refused.push(`${f}: ${name} takes no arguments, given ${argv.join(' ')}`);
          continue;
        }
        try { parseArgv(argv, ARGV_SPECS[name]); } catch (e) { refused.push(`${f}: node scripts/${name}.mjs ${argv.join(' ')}\n    ${e.message}`); }
      }
    }
  }
  t.diagnostic(`${files.length} documented files read, ${found.length} invocations found`);
  assert.ok(files.length >= 20, `${files.length} documented files read; a missing glob reads as nothing to check`);
  assert.ok(found.length >= 30, `${found.length} documented invocations found`);
  assert.deepEqual(refused, [], 'a documented command the parser refuses');
});

// ----------------------------------------------------------------------------------------------------------- (d)
// Every place a script names another quorate script by path, found by scanning scripts/*.mjs and scripts/io/*.mjs. Each
// is a spawn (or a command printed or rendered for someone to run) and has a case below, or is listed here as not one.
const NOT_A_SPAWN = {
  'new-run.mjs:run-graph': 'intentTarget: a path the intent canary must NOT read, never run',
};

const R = path.join(REPO_ROOT, '.claude', 'reviews', '20261020-000000-x');
const SITES = [
  // run-graph.mjs:1201 spawnNode, every option it can push (its comments name each).
  { at: 'run-graph.mjs:spawn-node', child: 'spawn-node', argv: ['--run-dir', R, '--repo-root', REPO_ROOT, '--node-id', 'code-audit',
    '--mode', 'lens', '--schema-variant', 'code', '--model', 'opus', '--timeout-minutes', '30', '--runtime-bin', 'fake.mjs',
    '--runtime', 'claude', '--budget-usd', 'none', '--effort', 'low', '--severity-ceiling', 'MEDIUM', '--verdict-ceiling', 'RISK',
    '--severity-floor', 'LOW', '--skill-command', '/code-audit', '--allowed-basis', 'convention,invariant', '--inline-skill',
    '--instructions', 'lenses/x.md', '--add-dir', REPO_ROOT, R] },
  // run-graph.mjs:1621 runPreflight.
  { at: 'run-graph.mjs:run-checks', child: 'run-checks', argv: ['--run-dir', R, '--repo-root', REPO_ROOT, '--input-hash', 'abc123', '--inputs-inferred'] },
  // run-graph.mjs:2463 a panel arm.
  { at: 'run-graph.mjs:external-review', child: 'external-review', argv: ['--run-dir', R, '--node-id', 'panel-codex-code', '--reviewer', 'codex',
    '--prompt-file', 'p.md', '--schema', JSON.stringify({ verdict: 'PASS|RISK|FAIL', findings: '[{severity,file,line,claim}]' }),
    '--timeout-minutes', '30', '--model', 'm', '--effort', 'high', '--severity-ceiling', 'MEDIUM', '--verdict-ceiling', 'RISK',
    '--allowed-basis', 'convention', '--surface', 'arms'] },
  // run-graph.mjs:3980 an adjudicator.
  { at: 'run-graph.mjs:external-review', child: 'external-review', argv: ['--run-dir', R, '--node-id', 'adjudicate-codex-G-1',
    '--reviewer', 'codex', '--model', 'm', '--effort', 'high', '--mode', 'tie-break', '--participants', 'lens,arm',
    '--prompt-file', 'p.md', '--timeout-minutes', '30', '--surface', 'arms'] },
  // run-graph.mjs:966 and :1001 capture_rel and detector_abs, rendered into prompts/_templates/run-brief.md; and new-run.mjs:248
  // CAPTURE_REL into sandbox-canary.md. The lines are read from the templates below.
  { at: 'run-graph.mjs:capture', child: 'capture', template: 'run-brief.md' },
  { at: 'run-graph.mjs:find-inert-features', child: 'find-inert-features', argv: [] },
  // capture.mjs:42 DETECTOR_ABS, the one framework script capture runs, as the brief gives it (`-- node {{detector_abs}}`).
  { at: 'capture.mjs:find-inert-features', child: 'find-inert-features', argv: [] },
  // The interactive front end's read-only set, the same entry by the same owner (capture-interactive.plan.md stage 4).
  { at: 'io/capture-interactive.mjs:find-inert-features', child: 'find-inert-features', argv: [] },
  { at: 'new-run.mjs:capture', child: 'capture', template: 'sandbox-canary.md' },
  // new-run.mjs:1174 the reviewer preflight at mint, with both test seams.
  { at: 'new-run.mjs:external-review', child: 'external-review',
    argv: preflightArgv('x', { reviewer: 'codex', model: 'm', effort: 'high', mode: 'propose', route: 'native' }, ['--test-stall-ms', '10', '--test-crash']).slice(1) },
  // check-reviewers.mjs:126 the same, with the probe's consent and --force's --reprobe.
  { at: 'check-reviewers.mjs:external-review', child: 'external-review',
    argv: preflightArgv('x', { reviewer: 'agy', model: '', effort: '', mode: 'review' }, ['--consent', 'transport-probe', '--reprobe']).slice(1) },
  // external-review.mjs:911 the probe child, review and propose-native routes, with the caller's evidence directory.
  { at: 'external-review.mjs:self', child: 'external-review', argv: ['--probe-run', '--reviewer', 'codex', '--model', 'm', '--effort', 'high',
    '--mode', 'review', '--prompt-file', 'p.md', '--surface', 's', '--consent', 'transport-probe', '--probe-timeout-ms', '1000',
    '--schema', PROBE_REVIEW_SCHEMA, '--evidence-dir', 'ev', '--node-id', 'probe-codex-review'] },
  { at: 'external-review.mjs:self', child: 'external-review', argv: ['--probe-run', '--reviewer', 'codex', '--mode', 'propose',
    '--prompt-file', 'p.md', '--surface', 's', '--consent', 'transport-probe', '--probe-timeout-ms', '1000',
    '--schema', PROBE_PROPOSE_SCHEMA, '--candidate-fields', PROBE_CANDIDATE_FIELDS, '--run-dir', R, '--node-id', 'probe-codex-propose'] },
  { at: 'external-review.mjs:self', child: 'external-review', argv: ['--probe-run', '--reviewer', 'agy', '--mode', 'tie-break',
    '--prompt-file', 'p.md', '--surface', 's', '--consent', 'transport-probe', '--probe-timeout-ms', '1000',
    '--participants', 'lens,arm', '--node-id', 'adjudicate-agy-G-1', '--evidence-dir', 'ev'] },
  // remediate.mjs:805 the remediation node.
  { at: 'remediate.mjs:spawn-node', child: 'spawn-node', argv: ['--run-dir', R, '--repo-root', REPO_ROOT, '--node-id', 'remediation',
    '--mode', 'remediate', '--schema-variant', 'remediation', '--skill-command', '/remediation', '--inline-skill',
    '--add-dir', REPO_ROOT, R, '--timeout-minutes', '30', '--budget-usd', 'none', '--runtime', 'claude', '--unsandboxed', '--runtime-bin', 'fake.mjs'] },
  // remediate.mjs nodeSpawnArgv: a repair pass (remediation-repair-pass.plan.md stage 2).
  { at: 'remediate.mjs:spawn-node', child: 'spawn-node', argv: ['--run-dir', R, '--repo-root', REPO_ROOT, '--node-id', 'remediation-repair-1',
    '--mode', 'remediate', '--schema-variant', 'remediation-repair', '--skill-command', '/remediation', '--inline-skill',
    '--add-dir', REPO_ROOT, R, '--timeout-minutes', '30', '--budget-usd', 'none', '--runtime-bin', 'fake.mjs'] },
  // remediate.mjs:1077 the follow-up mint; :415 and :1050 print the same command for an operator.
  { at: 'remediate.mjs:new-run', child: 'new-run', argv: ['--repo-root', REPO_ROOT, '--slug', 'x-review', '--base', 'abc123',
    '--follows-remediation', R, '--no-verify-sandbox', '--no-verify-reviewers', '--runtime-bin', 'fake.mjs'] },
  // remediate.mjs:728 the capture command the node is told.
  { at: 'remediate.mjs:capture', child: 'capture', argv: ['--run-dir', R, '--node', 'remediation', '--name', '<slug>', '--', 'node', '--test', 'x'] },
  // remediate.mjs:1042 the retry it prints.
  { at: 'remediate.mjs:self', child: 'remediate', argv: ['--repo-root', R, '--run-dir', R, '--retry-commits', '--commit-trailer', 'Key: value', '--commit-trailer', 'K2: v'] },
  // --repair with it (remediation-repair-pass.plan.md stage 3): the repair pass on a run its full check refused.
  { at: 'remediate.mjs:self', child: 'remediate', argv: ['--repo-root', R, '--run-dir', R, '--retry-commits', '--repair'] },
  // remediate.mjs:1094 the follow-up review it prints.
  // --repo-root since run-dir-descendants.plan.md stage 5 (G-22): the printed follow-up command keeps the repository.
  { at: 'remediate.mjs:run-graph', child: 'run-graph', argv: ['--run-dir', R, '--repo-root', R] },
  // preflight.mjs:240.
  { at: 'preflight.mjs:run-checks', child: 'run-checks', argv: ['--run-dir', R, '--repo-root', REPO_ROOT, '--input-hash', 'abc', '--inputs-inferred'] },
  // claim-check.mjs:209 the same-family checker; :278 the cross-family one.
  { at: 'claim-check.mjs:spawn-subagent', child: 'spawn-subagent', argv: ['--prompt-file', 'b.md', '--out', 'e.json', '--result', 'r.json',
    '--repo-root', REPO_ROOT, '--runtime-bin', 'fake.mjs'] },
  { at: 'claim-check.mjs:external-review', child: 'external-review', argv: ['--reviewer', 'codex', '--model', 'm', '--effort', 'high',
    '--mode', 'claim-check', '--prompt-file', 'p.md', '--evidence-dir', 'd', '--out', 'arm.json', '--surface', 's'] },
  // decide.mjs: the node-runtime seat and the moderator; the external seats (autonomous-run.plan.md stage 5).
  { at: 'decide.mjs:spawn-subagent', child: 'spawn-subagent', argv: ['--prompt-file', 'b.md', '--out', 'e.json', '--result', 'r.json',
    '--repo-root', REPO_ROOT, '--runtime-bin', 'fake.mjs'] },
  { at: 'decide.mjs:external-review', child: 'external-review', argv: ['--reviewer', 'codex', '--model', 'm', '--effort', 'high',
    '--mode', 'decide', '--prompt-file', 'p.md', '--evidence-dir', 'd', '--out', 'd/seat.json', '--surface', 's'] },
  // check-intent-grant.mjs:108.
  { at: 'check-intent-grant.mjs:new-run', child: 'new-run', argv: ['--slug', 'grant', '--repo-root', REPO_ROOT, '--no-request', '--no-verify-sandbox',
    '--full-sweep', 'src'] },
  // bench-repair-pass.mjs (remediation-repair-pass.plan.md stage 4): the scratch review and remediation it mints in the
  // case's worktree, and the two runner invocations, the reproduction and the repair passes, both --measure-only.
  { at: 'bench-repair-pass.mjs:new-run', child: 'new-run', argv: ['--repo-root', REPO_ROOT, '--no-verify-sandbox', '--no-verify-reviewers',
    '--slug', 'bench-rev', '--no-request', '--full-sweep', 'scripts'] },
  { at: 'bench-repair-pass.mjs:new-run', child: 'new-run', argv: ['--repo-root', REPO_ROOT, '--no-verify-sandbox', '--no-verify-reviewers',
    '--slug', 'bench-fix', '--remediates', R] },
  { at: 'bench-repair-pass.mjs:remediate', child: 'remediate', argv: ['--repo-root', REPO_ROOT, '--run-dir', R, '--runtime-bin', 'b.mjs',
    '--no-verify-sandbox', '--no-verify-reviewers', '--test-repair-passes', '0', '--measure-only'] },
  { at: 'bench-repair-pass.mjs:remediate', child: 'remediate', argv: ['--repo-root', REPO_ROOT, '--run-dir', R, '--runtime-bin', 'b.mjs',
    '--no-verify-sandbox', '--no-verify-reviewers', '--retry-commits', '--repair', '--test-repair-passes', '3', '--measure-only'] },
  // bench-lenses.mjs:351 and :376.
  { at: 'bench-lenses.mjs:new-run', child: 'new-run', argv: ['--repo-root', REPO_ROOT, '--slug', 'bench-s1', '--no-request', '--full-sweep', 'scripts', 'tests'] },
  // A contract-audit seed names its request instead (the source's flag check found this case missing: G-17).
  { at: 'bench-lenses.mjs:new-run', child: 'new-run', argv: ['--repo-root', REPO_ROOT, '--slug', 'bench-s2', '--request', '.claude/requests/x.md', '--full-sweep', 'src'] },
  { at: 'bench-lenses.mjs:run-graph', child: 'run-graph', argv: ['--run-dir', R, '--repo-root', REPO_ROOT, '--only', 'code-audit,arch-review'] },
  // bench-second-opinion.mjs:541, :969 and :1042.
  { at: 'bench-second-opinion.mjs:external-review', child: 'external-review', argv: ['--run-dir', R, '--node-id', 'so-judge-a', '--reviewer', 'codex',
    '--model', 'm', '--effort', 'high', '--mode', 'tie-break', '--participants', 'a,b', '--prompt-file', 'p.md', '--timeout-minutes', '20'] },
  { at: 'bench-second-opinion.mjs:capture', child: 'capture', argv: ['--run-dir', R, '--node', 'pre-flight', '--name', 'dry-run-probe', '--cwd', REPO_ROOT,
    '--', process.execPath, '--quorate-dry-run-undeclared-probe'] },
  { at: 'bench-second-opinion.mjs:spawn-node', child: 'spawn-node', argv: ['--run-dir', R, '--repo-root', REPO_ROOT, '--node-id', 'second-opinion',
    '--mode', 'panel', '--schema-variant', 'none', '--model', 'opus', '--timeout-minutes', '30', '--budget-usd', 'none',
    '--skill-command', '/second-opinion', '--inline-skill', '--effort', 'low', '--runtime', 'claude', '--add-dir', REPO_ROOT, R] },
  // io/declared-checks.mjs:24 captureArgv, the barrier's every check.
  { at: 'io/declared-checks.mjs:capture', child: 'capture', argv: ['--run-dir', R, '--node', 'pre-flight', '--name', 'test', '--cwd', REPO_ROOT,
    '--timeout-minutes', '15', '--', 'node', 'tests/run-all.mjs'] },
  // io/cli-freshness.mjs refreshFreshnessDetached: the hook's detached refresh of the daily CLI check (autonomous-run.plan.md
  // stage 7, amended 2026-11-04, operator "C").
  { at: 'io/cli-freshness.mjs:run-session', child: 'run-session', argv: ['freshness', '--repo-root', REPO_ROOT] },
  // io/contract-reader.mjs:20 the one contract reader.
  { at: 'io/contract-reader.mjs:new-run', child: 'new-run', argv: ['--print-contract', '--repo-root', REPO_ROOT] },
  // publish.mjs: the public CI's secret scan, the published tree's check-secrets run in --out with no arguments (M2 stage
  // 9c, 2026-11-19).
  { at: 'publish.mjs:check-secrets', child: 'check-secrets', argv: [] },
];

/** The template lines that run the script: `node {{capture_rel}} ...`, each a command a node is told to run. */
function templateArgvs(file) {
  const text = fs.readFileSync(path.join(REPO_ROOT, 'prompts', '_templates', file), 'utf8');
  return [...text.matchAll(/node \{\{capture_rel\}\}([^\n`]*)/g)].map((m) => tokensOf(m[1]));
}

test('(d) every argv the engine builds for another quorate script parses against that script\'s spec', () => {
  const refused = [];
  for (const site of SITES) {
    const argvs = site.template ? templateArgvs(site.template) : [site.argv];
    assert.ok(argvs.length, `${site.at}: no command found in ${site.template}`);
    for (const argv of argvs) {
      try { parseArgv(argv, ARGV_SPECS[site.child]); } catch (e) { refused.push(`${site.at}: ${argv.join(' ')}\n    ${e.message}`); }
    }
  }
  assert.deepEqual(refused, []);
});

/**
 * THE FLAGS THE SOURCE ITSELF BUILDS at one spawn site (G-17 of 20261020-151402-argv-delivery): the SITES above are
 * copies, so a builder that changed a flag left its copy passing. Read from the source: for an argv array, every quoted
 * '--flag' from the script's path to the array's end, plus `<name>.push('--flag', ...)` when the array is assigned to a
 * name; for a printed command (a template literal), every --flag up to the literal's end. Nothing after a '--'.
 */
function sourceFlags(text, at) {
  const lineStart = text.lastIndexOf('\n', at) + 1;
  const before = text.slice(lineStart, at);
  let region;
  if (/`/.test(before) && /\$\{/.test(before)) {
    region = text.slice(at, text.indexOf('`', at));
    region = region.split(/\s--(?=\s|$)/)[0];
    return [...region.matchAll(/(?:^|[\s[])--([a-z][a-z0-9-]*)/g)].map((m) => m[1]);
  }
  let i = text.indexOf(')', at) + 1;
  const start = i;
  let depth = 0;
  for (; i < text.length && i - start < 6000; i++) {
    const c = text[i];
    if (c === '\'' || c === '"' || c === '`') { const close = text.indexOf(c, i + 1); i = close < 0 ? text.length : close; continue; }
    if (c === '/' && text[i + 1] === '/') { const nl = text.indexOf('\n', i); i = nl < 0 ? text.length : nl; continue; }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) { if (--depth < 0) break; } else if (c === ';' && depth === 0) break;
  }
  region = text.slice(start, i).replace(/^\s*\/\/.*$/gm, '').split(/'--'/)[0];
  const named = /(?:const|let)\s+(\w+)\s*=\s*\[\s*$/.exec(text.slice(Math.max(0, lineStart - 200), lineStart));
  if (named) {
    const after = text.slice(i, i + 8000).split(/\r?\n/).slice(0, 80);
    region += after.filter((l) => l.includes(`${named[1]}.push(`)).join('\n');
  }
  return [...region.matchAll(/'--([a-z][a-z0-9-]*)'/g)].map((m) => m[1]);
}

// Every place a source names a child script inside a path.join / path.resolve call, and every self re-run: { name, index,
// probe }. G-13 of 20261023-214545-ger-remediation-review: this scanned one line at a time, so a call split across lines
// (`path.join(\n  DIR,\n  'x.mjs')`) was invisible and the test passed with that spawn uncased.
function childScriptSites(text, nameRe) {
  const lineOf = (i) => text.slice(text.lastIndexOf('\n', i - 1) + 1, (text.indexOf('\n', i) + 1 || text.length + 1) - 1);
  const commented = (i) => /^\s*\/\//.test(lineOf(i));
  // The path.join / path.resolve call still open at `i`, or -1: its parenthesis counted from the call to `i`.
  const openCall = (i) => {
    let best = -1;
    for (const c of text.slice(Math.max(0, i - 600), i).matchAll(/path\.(?:join|resolve)\(/g)) {
      const at = Math.max(0, i - 600) + c.index;
      let depth = 0;
      let open = true;
      for (let k = at + c[0].length - 1; k < i; k++) {
        if (text[k] === '(') depth++;
        else if (text[k] === ')' && --depth === 0) { open = false; break; }
      }
      if (open) best = at;
    }
    return best;
  };
  const out = [];
  for (const p of text.matchAll(/fileURLToPath\(import\.meta\.url\),\s*'--probe-run'/g)) {
    if (!commented(p.index)) out.push({ probe: true, index: p.index });
  }
  for (const m of text.matchAll(nameRe)) {
    if (commented(m.index)) continue;
    const call = openCall(m.index);
    if (call < 0) continue;
    // An existence check names a script without spawning it: judged on the lines the call spans.
    const lineStart = text.lastIndexOf('\n', call - 1) + 1;
    if (/existsSync/.test(text.slice(lineStart, m.index))) continue;
    out.push({ name: m[1], index: m.index });
  }
  return out.sort((a, b) => a.index - b.index);
}

test('(d) the scan finds every place a script names another, each has a case, and the source\'s flags are the case\'s', (t) => {
  const dirs = [['', SCRIPTS_DIR], ['io/', path.join(SCRIPTS_DIR, 'io')]];
  const names = Object.keys(ARGV_SPECS).join('|');
  const nameRe = new RegExp(`'(${names})\\.mjs'`, 'g');
  // The scan sees a call however it is wrapped, and still skips a comment and an existence check.
  const synthetic = "const a = path.join(\n  SCRIPTS_DIR,\n  'new-run.mjs',\n);\nspawnSync(process.execPath, [\n  fileURLToPath(import.meta.url),\n  '--probe-run']);\n"
    + "// path.join(DIR, 'run-graph.mjs')\nif (fs.existsSync(path.join(\n  DIR, 'capture.mjs'))) {}\n";
  assert.deepEqual(childScriptSites(synthetic, nameRe).map((s) => s.name ?? 'probe'), ['new-run', 'probe'],
    'a child script or self re-run named across lines was not found');
  const found = new Set();
  const built = []; // [at, child, flag], from the source
  for (const [prefix, dir] of dirs) {
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.mjs'))) {
      const self = f.replace(/\.mjs$/, '');
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      for (const site of childScriptSites(text, nameRe)) {
        if (site.probe) {
          found.add(`${prefix}${f}:self`);
          for (const flag of sourceFlags(text, site.index)) built.push([`${prefix}${f}:self`, self, flag]);
          continue;
        }
        // An import.meta.url path to this very script is the script re-running itself.
        const at = `${prefix}${f}:${site.name === self ? 'self' : site.name}`;
        found.add(at);
        if (!NOT_A_SPAWN[at]) for (const flag of sourceFlags(text, site.index)) built.push([at, site.name, flag]);
      }
    }
  }
  const covered = new Set(SITES.map((s) => s.at));
  const uncovered = [...found].filter((at) => !covered.has(at) && !NOT_A_SPAWN[at]);
  assert.deepEqual(uncovered, [], 'a script names another with no case here: add its argv to SITES');
  // Each flag the source builds is one the child declares, and one the site's case carries, so the case's parse above
  // speaks for what the engine sends.
  const caseFlags = (at) => new Set(SITES.filter((s) => s.at === at && s.argv).flatMap((s) => s.argv)
    .filter((a) => /^--[a-z]/.test(a)).map((a) => a.slice(2).split('=')[0]));
  const unknown = built.filter(([, child, flag]) => !(flag in (ARGV_SPECS[child]?.options ?? {})))
    .map(([at, child, flag]) => `${at}: --${flag} is not a flag ${child}.mjs declares`);
  assert.deepEqual(unknown, [], 'the engine builds a flag its child refuses');
  const uncopied = built.filter(([at]) => SITES.some((s) => s.at === at && s.argv)).filter(([at, , flag]) => !caseFlags(at).has(flag))
    .map(([at, , flag]) => `${at}: --${flag}`);
  assert.deepEqual([...new Set(uncopied)], [], 'the source builds a flag its SITES case does not carry, so the case\'s parse does not cover it');
  t.diagnostic(`${found.size} spawn sites found, ${built.length} source flags read: ${[...found].sort().join(', ')}`);
  // FLOORS at the counts measured on 2026-10-20, the plan's 27 sites (G-17: the floor was 5) and 140 flags read, so a scan
  // that stopped matching fails.
  assert.ok(found.size >= 27, `${found.size} spawn sites found`);
  assert.ok(built.length >= 140, `${built.length} source flags read`);
});
