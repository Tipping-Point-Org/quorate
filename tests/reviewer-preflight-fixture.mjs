// reviewer-preflight-fixture.mjs — the fixture and helpers regression-reviewer-preflight.test.mjs and its siblings
// share, moved out unchanged when the file was split (split-slow-test-files.md). Every top-level name is exported.


import { defaultReviewsRoot } from '../scripts/lib/reviews-root.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adapterErrors } from '../scripts/lib/reviewers.mjs';

// ------------------------------------------------------------------ stage 1: the adapter declares its probe data
// The version command and the probe's limits are configuration (reviewers.json), never literals in a script; a
// malformed value is refused at mint like every other adapter field. At HEAD adapterErrors ignores all four.
const base = { cmd: 'x', roles: ['reviewer'], prompt: { via: 'stdin' }, response: { from: 'file' } };



// Stage 1's modules are NEW, so nothing below can be red before they exist: written with the code, labelled. The
// adapterErrors tests above were red first (evidence/pf-s1-red.txt).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { probeKey, KEY_FIELDS, recordCounts, probePassed, probeLimits, maxAgeHoursOf, adapterHash, PROBE_REVIEW_SCHEMA } from '../scripts/lib/reviewer-probe.mjs';
import { cliVersion, readProbeRecord, writeProbeRecord } from '../scripts/io/reviewer-probe.mjs';

const combo = { adapter: 'codex', adapter_hash: 'h', model: 'm', effort: 'high', mode: 'review', route: 'native', cli_version: '1', host: 'H' };
const tmpHome = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'q-probe-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };










// Two PROCESSES, because a lock between threads of one process proves nothing. Each runs the same script: take the
// key's lock, re-read the record, and probe (append to a log, write the record) only when there is none.
const worker = (home, key, log) => [
  `import { withProbeLock, readProbeRecord, writeProbeRecord, probeLimits } from ${JSON.stringify(new URL('../scripts/io/reviewer-probe.mjs', import.meta.url).href)};`,
  'import fs from "node:fs";',
  'const lim = probeLimits({ probe_timeout_minutes: 0.1, version_timeout_seconds: 1, check_margin_seconds: 1 }, {});',
  `withProbeLock(${JSON.stringify(home)}, ${JSON.stringify(key)}, lim, () => {`,
  `  if (readProbeRecord(${JSON.stringify(home)}, ${JSON.stringify(key)})) return;`,
  `  fs.appendFileSync(${JSON.stringify(log)}, "probe\\n");`,
  '  const until = Date.now() + 400; while (Date.now() < until) {}',
  `  writeProbeRecord(${JSON.stringify(home)}, { key: ${JSON.stringify(key)}, state: "passed", checked_at: new Date().toISOString() });`,
  '});',
].join('\n');
const run = (code) => new Promise((resolve) => {
  const c = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: 'inherit' });
  c.on('exit', resolve);
});




// ------------------------------------------------------------------ stage 2 (D2): the egress check and on-demand probe
// RED FIRST: all seven failed against a932b22d's external-review.mjs, for the reason they exist — exit 0 where 5 was
// expected, no probe invocation logged, no record directory written. Nothing was checked, probed or refused there; a call
// went straight to the reviewer.
import { REPO_ROOT, runScript, seedReviewerProbe, noRealReviewers } from './helpers.mjs';
import { classifyPanelProbe } from '../scripts/lib/decisions.mjs';

// The PATH directories a fixture keeps: node's own, any holding git (new-run and external-review call it), and the OS
// directories a shell needs. Nothing a reviewer CLI is installed in, unless it happens to share one of those.
function safePathDirs() {
  const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
  const sys = process.env.SystemRoot ? [path.join(process.env.SystemRoot, 'System32'), process.env.SystemRoot] : ['/usr/bin', '/bin'];
  const git = String(process.env[pathKey] ?? '').split(path.delimiter).filter((d) => d
    && ['git', 'git.exe'].some((g) => fs.existsSync(path.join(d, g))));
  const dirs = [path.dirname(process.execPath), ...git, ...sys];
  for (const d of dirs) {
    for (const v of ['codex', 'codex.cmd', 'codex.exe', 'agy', 'agy.exe', 'agy.cmd']) {
      if (fs.existsSync(path.join(d, v))) throw new Error(`a real reviewer CLI sits in a directory the fixture keeps: ${path.join(d, v)}`);
    }
  }
  return [...new Set(dirs)];
}

// A fake reviewer that tells its invocations apart: `version` (--version), `probe` (the probe prompts are recognisable),
// `call` (anything else). It logs `<kind> <cwd>` per invocation and answers `body` (or `probeBody` to a probe) the way its
// vendor does: codex through --output-last-message, agy (`name: 'agy'`) as a stream-json reply whose final result event
// carries structured_output, its prompt one NDJSON user line on stdin (decision-panel-seats.plan.md stage 3). Several fakes may share one directory; each keeps its own log.
// `needsGit`: refuse outside a git repository, as the real codex does ("Not inside a trusted directory and
// --skip-git-repo-check was not specified", exit 1, before any model call) — the requirement the first live mint met.
// `jsonl`: stdout is an event stream with the answer string-escaped inside an agent_message, as the real codex prints
// under --json; the answer itself reaches only --output-last-message (story-pipeline, 2026-10-16).
// `schemaAware`: on a probe given --output-schema, answer one candidate whose FIRST required field is "probe", as a real
// model obeying "exactly one candidate" against whatever schema it was handed does.
function fakeReviewer(dir, { name = 'codex', body, probeBody = body, version = `fake-${name} 1.0`, needsGit = false, jsonl = false, schemaAware = false }) {
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const log = path.join(dir, name === 'codex' ? 'invocations.log' : `invocations-${name}.log`);
  const wrap = name === 'agy';
  fs.writeFileSync(path.join(binDir, `fake-${name}.mjs`), [
    "import fs from 'node:fs';",
    'const a = process.argv;',
    `const log = ${JSON.stringify(log)};`,
    // QUORATE_TEST_SECRET, if it reaches the version command, shows in the version it reports (G-4 of r1).
    `if (a.includes('--version')) { fs.appendFileSync(log, 'version ' + process.cwd() + '\\n'); process.stdout.write(${JSON.stringify(version)} + (process.env.QUORATE_TEST_SECRET ? ' saw:' + process.env.QUORATE_TEST_SECRET : '') + '\\n'); process.exit(0); }`,
    "import path from 'node:path';",
    `if (${needsGit}) { let d = process.cwd(); let inRepo = false; for (;;) { if (fs.existsSync(path.join(d, '.git'))) { inRepo = true; break; } const up = path.dirname(d); if (up === d) break; d = up; }`
      + " if (!inRepo) { fs.appendFileSync(log, 'refused ' + process.cwd() + '\\n'); process.stderr.write('Not inside a trusted directory and --skip-git-repo-check was not specified.\\n'); process.exit(1); } }",
    "let input = ''; try { input = fs.readFileSync(0, 'utf8'); } catch {}",
    `if (${wrap}) { try { input = JSON.parse(input.trim().split('\\n')[0]).message.content; } catch { input = ''; } }`,
    "const isProbe = /transport check|whether the loop stops at the first match/.test(input + a.join(' '));",
    "fs.appendFileSync(log, (isProbe ? 'probe ' : 'call ') + process.cwd() + '\\n');",
    `let out = isProbe ? ${JSON.stringify(probeBody)} : ${JSON.stringify(body)};`,
    `if (${schemaAware} && isProbe && a.indexOf('--output-schema') !== -1) { const s = JSON.parse(fs.readFileSync(a[a.indexOf('--output-schema') + 1], 'utf8')); const req = s.properties.candidates.items.required; const c = Object.fromEntries(req.map((k, n) => [k, n === 0 ? 'probe' : ''])); out = JSON.stringify({ status: 'ok', reason: '', candidates: [c], not_checked: [] }); }`,
    "const i = a.indexOf('--output-last-message');",
    'if (i !== -1 && a[i + 1]) fs.writeFileSync(a[i + 1], out);',
    `let shown = out; if (${wrap}) { let so; if (a.includes('--json-schema')) { try { so = JSON.parse(out); } catch {} } shown = [JSON.stringify({ event: 'init', init: {} }), JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: out, ...(so ? { structured_output: so } : {}), usage: { input_tokens: 1, output_tokens: 1 } } })].join('\\n') + '\\n'; }`,
    `if (${jsonl}) shown = [JSON.stringify({ type: 'turn.started' }), JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: out } }), JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } })].join('\\n') + '\\n';`,
    'process.stdout.write(shown);',
    '',
  ].join('\n'));
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(binDir, `${name}.cmd`), `@"${process.execPath}" "%~dp0fake-${name}.mjs" %*\r\n`);
  } else {
    const shim = path.join(binDir, name);
    fs.writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/fake-${name}.mjs" "$@"\n`);
    fs.chmodSync(shim, 0o755);
  }
  const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
  // ONLY THE FAKES, node, git and the system's own directories — never the rest of the developer's PATH. With the whole
  // PATH appended, the real agy (an .exe, spawned without a shell, so a fake .cmd is invisible to the lookup) answered
  // every probe these tests meant for the fake, and billed for it. A fake that is not found must fail, not fall through.
  const pathValue = [binDir, ...safePathDirs()].join(path.delimiter);
  const kinds = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []);
  return { binDir, pathKey, pathValue, log, kinds, script: path.join(binDir, `fake-${name}.mjs`) };
}
const REVIEW_OK = JSON.stringify({ status: 'ok', verdict: 'PASS', findings: [], checked_clean: [], not_checked: [] });

function setup2(t, fakeOpts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'q-pf2-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fake = fakeReviewer(dir, fakeOpts);
  const probes = path.join(dir, 'probes');
  const prompt = path.join(dir, 'prompt.md');
  fs.writeFileSync(prompt, 'Review the declared scope.\n');
  // A caller's own --schema REPLACES the default rather than following it: a value flag given twice is refused
  // (entrypoint-argv.plan.md stage 1), where it used to be silently its last value.
  const call = (args = [], env = {}) => runScript('external-review.mjs', [
    '--reviewer', 'codex', '--prompt-file', prompt, ...(args.includes('--schema') ? [] : ['--schema', '{"verdict":"PASS|RISK|FAIL"}']),
    '--consent', 'transport-probe', ...args,
  ], { env: { [fake.pathKey]: fake.pathValue, QUORATE_REVIEWER_PROBES: probes, ...env } });
  return { dir, fake, probes, prompt, call };
}
const calls = (fake) => fake.kinds().map((l) => l.split(' ')[0]).filter((k) => k !== 'version');













// ------------------------------------------------------------------ stage 3 (D2): the mint check, recorded in run.json
// With the panel on, new-run checks every panel arm and adjudicator combination of the roster before it creates the run
// directory, through `external-review.mjs --preflight-only`, and refuses the mint on any failure — a failed probe, a
// child that exits otherwise, crashes, or overruns its bound. The roster's reviewers are codex (the arms, one judge) and
// agy (the other judge), so a fixture fakes both.
import { CAPPING_STAMPS } from '../scripts/lib/decisions.mjs';

const UNIVERSAL_OK = JSON.stringify({
  status: 'ok', reason: '', verdict: 'PASS', findings: [], checked_clean: [], not_checked: [],
  supports: 'neither', confidence: 'high', rationale: 'probe', candidates: [{ name: 'probe' }],
  // The decide probe's answer (autonomous-run.plan.md stage 4): entry E1, its rationale "probe".
  choice: 'E1', other_text: '', change_of: '', what_would_change: 'probe', citations: ['probe'],
  // The claim-check probe's answer (claim-check-cross-family.plan.md stage 6): one claim whose id is "probe", every field as
  // the template prescribes it (G-13 of 20261103-191032-dr-remediation-3-review).
  schema_version: 1,
  claims: [{ id: 'probe', text: 'probe', kind: 'other', search: { looked_for: 'probe', where: [], found: '' }, grade: 'inferred',
    citations: [], trigger: '', counter_question: { question: 'probe', answer: '' }, operator_only: false, verdict: 'stands' }],
});
// FRACTIONAL LIMITS for both fakes, so a bound is a minute or so rather than twelve: stale = 10 s + 0.5 min = 40 s, and
// the child's bound is 10 + (42 + 2) + 42 + 2 = 98 s (G-4's formula, computed below rather than restated). Wider than the plan's 1 s / 0.05 min / 0.5 s, measured: one check of the three
// fixture combinations took ~13 s on an idle machine, so a one-second version limit, or a bound of under a minute with half of it stalled
// on top, would refuse a mint under suite load for a reason no test here is about.
const FAST_LIMITS = ['    probe_timeout_minutes: 0.5', '    version_timeout_seconds: 10', '    check_margin_seconds: 2'];
const BOUND_MS = probeLimits({ probe_timeout_minutes: 0.5, version_timeout_seconds: 10, check_margin_seconds: 2 }, {}).checkBoundMs;

// AGY IS AN .EXE, launched without a shell, so a fake agy.cmd on PATH is never found: the lookup tries .com and .exe
// only. The fixture therefore declares agy's command as node itself, with the fake script as its first argument — the
// argv then reaches the fake exactly as it reaches the real binary, prompt included, and no shell is involved.
// Forward slashes: the contract's strings are YAML, and a Windows path's backslashes would be escapes there.
const agyIsTheFake = (agy) => {
  const fwd = (p) => p.split(path.sep).join('/');
  return [`    cmd: "${fwd(process.execPath)}"`, `    version_argv: ["${fwd(agy.script)}", "--version"]`,
    `    base_argv: ["${fwd(agy.script)}", "--input-format", "stream-json", "--output-format", "stream-json", "--print=", "--disable-slash-commands"]`];
};

function mintFixture(t, { panel = true, body = UNIVERSAL_OK, agyBody = body, contractExtra = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'q-pf3-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const codex = fakeReviewer(dir, { name: 'codex', body });
  const agy = fakeReviewer(dir, { name: 'agy', body: agyBody });
  const repo = path.join(dir, 'repo');
  const home = path.join(dir, 'home');
  const probes = path.join(dir, 'probes');
  fs.mkdirSync(repo, { recursive: true });
  const git = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
  git('init', '-q', '.');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'T');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), ['# t', '', '```yaml', 'graph_contract_version: 5', 'project: t', 'commands:',
    '  build: ""', '  test: ""', 'review:', `  external_panel: ${panel}`, 'reviewers:', '  codex:', ...FAST_LIMITS,
    '  agy:', ...FAST_LIMITS, ...agyIsTheFake(agy), ...contractExtra, '```', ''].join('\n'));
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
  git('add', '-A');
  git('commit', '-qm', 'init');
  const env = { [codex.pathKey]: codex.pathValue, QUORATE_HOME: home, QUORATE_REVIEWER_PROBES: probes };
  const mint = (extra = []) => runScript('new-run.mjs',
    ['--slug', 'pf', '--no-verify-sandbox', '--no-request', '--full-sweep', '.', ...extra],
    { cwd: repo, mayProbe: true, env });
  // Every run directory under the home, where a run is staged: <home>/reviews/<repo key>/<run id>. One level shallower
  // found nothing ever, so "no run directory" held vacuously until the minted case showed the layout.
  const runs = () => {
    const root = path.join(home, 'reviews');
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root).flatMap((k) => {
      const d = path.join(root, k);
      return fs.statSync(d).isDirectory() ? fs.readdirSync(d).filter((r) => r.endsWith('-pf')).map((r) => path.join(d, r)) : [];
    });
  };
  const runJson = () => JSON.parse(fs.readFileSync(path.join(runs()[0], 'run.json'), 'utf8'));
  const probed = () => [...codex.kinds(), ...agy.kinds()].filter((l) => !l.startsWith('version '));
  return { mint, runs, runJson, probed, probes, repo, env, codex, agy };
}
















































export { base, combo, tmpHome, worker, run, safePathDirs, fakeReviewer, REVIEW_OK, setup2, calls, UNIVERSAL_OK, FAST_LIMITS, BOUND_MS, agyIsTheFake, mintFixture };
