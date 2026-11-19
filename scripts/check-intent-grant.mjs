#!/usr/bin/env node
// check-intent-grant — does the intent node read exactly what each doc glob declares, and nothing else?
//
// contract-glob-grammar.plan.md, stage 2b, re-run after stage 4. Its first run (commit 9c1ddb6; report
// .claude/requests/contract-glob-grammar.s2b-grant-probe.json) measured the mechanism that was then in place: the intent
// node's Read rules, rendered `Read(/F:\...)`, granted nothing on Windows, and `--add-dir` on a live doc directory
// granted everything below it. The operator chose to replace the mechanism (2026-10-01: "B: copy only matched docs
// (Recommended)"): the node reads only its sandbox, which holds copies of exactly what matchesGlob admits. This probe
// now measures THAT, as production builds it — io/doc-snapshot.mjs fills the sandbox, nodeArgv launches the node with the
// generated intent-settings.json, the runtime's intent deny list, the sandbox as cwd and its only --add-dir — and asks
// the node to read every copy, and the ORIGINAL of one matched and one unmatched file.
//
// Agreement means: the copies are exactly the documents the glob matches; every copy is readable; and each original's
// read was REFUSED — a recorded denial, not merely an answer without its content (lib/grant-probe.mjs).
//
// LIVE: it spawns the runtime, so it refuses unless QUORATE_LIVE=1, like check-reviewers. Exit 0 all agree, 1 a
// disagreement, 2 refused or could not run. The report goes to stdout as JSON, and to --out when given.
import fs from 'node:fs';
import { parseArgv, ArgvError } from './lib/argv.mjs';
import { ARGV_SPECS, runtimeCommand } from './lib/argv-specs.mjs';
import { runtimeBinArg, runtimeBinArgv } from './io/runtime-bin.mjs';
import { nodeDepth } from './lib/node-depth.mjs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { spawnSyncFrom } from './io/stdin-file.mjs';
import { fileURLToPath } from 'node:url';
import { matchesGlob } from './lib/contract-glob.mjs';
import { nodeArgv, denyToolsFor, subscriptionProbeEnv, withRuntimeOverride } from './lib/decisions.mjs';
import { judgeOriginalRead, originalsRefused } from './lib/grant-probe.mjs';
import { selectAdapters, overrideLine } from './io/reviewers.mjs';
import { callEntry, runtimeAnswered } from './lib/call-entry.mjs';
import { createSnapshot, snapshotIntentDocs } from './io/doc-snapshot.mjs';
import { hostPlatform } from './platform/index.mjs';
import { readContract } from './io/contract-reader.mjs';
import { gitSync } from './io/git.mjs';

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const die = (msg, code = 2) => { console.error(`check-intent-grant: ${msg}`); process.exit(code); };
// THE RECURSION GUARD, FIRST (G-2 of 20261001-034021-cgg-remediation-review): this probe mints runs, and it handed
// new-run GRAPH_NODE_DEPTH=0 whatever its own depth was — so a graph node running it laundered the guard. The same
// fail-closed block every spawning script carries (check-reviewers.mjs, for one); below it the depth is known to be 0, which is
// what the reset to '0' then truthfully passes on.
const { raw: RAW_DEPTH, depth: PARSED_DEPTH } = nodeDepth(process.env);
const DEPTH = PARSED_DEPTH ?? NaN;
if (!Number.isInteger(DEPTH) || DEPTH < 0) {
  console.error(`ABORT: GRAPH_NODE_DEPTH=${JSON.stringify(RAW_DEPTH)} is not a non-negative integer — refusing to guess whether this is nested (§8).`);
  process.exit(3);
}
if (DEPTH > 0) {
  console.error(`ABORT: GRAPH_NODE_DEPTH=${DEPTH} — a graph node may not run the intent grant probe (§8).`);
  process.exit(3);
}
// EVERY ARGUMENT IS KNOWN, OR THE PROBE REFUSES (20261001-155615-cgg-review-r3 remediation). It read --out by position and
// ignored the rest, so a fixture passing the override before the probe knew that flag ran the REAL runtime, live — the
// one probe that spends tokens silently dropping the argument meant to stop it.
// Parsed BEFORE the QUORATE_LIVE check, so a bad command line is refused naming its flag whether or not the probe was
// armed. ONE PARSER, lib/argv.mjs's, against this script's spec in lib/argv-specs.mjs (entrypoint-argv.plan.md).
// --runtime-bin is the runtime command override spawn-node, run-graph and new-run take: a fixture's fake runtime, run under
// node when it is a .mjs. QUORATE_LIVE is still required — a real CLI passed here spends exactly as the default does.
const cli = { out: null, runtimeBin: null };
try {
  const { values } = parseArgv(process.argv.slice(2), ARGV_SPECS['check-intent-grant']);
  if (values.out !== undefined) cli.out = values.out;
  // The owner's refusal (two spellings disagreeing, an empty value) is a plain Error, refused here like every other entry
  // script refuses it, not rethrown as a crash (G-4 of 20261111-184046-runtime-bin-delivery).
  try { cli.runtimeBin = runtimeBinArg(values); } catch (e) { die(e.message); }
} catch (e) {
  if (!(e instanceof ArgvError)) throw e;
  die(`${e.message} (this probe takes --out <path> and --runtime-bin <path>)`);
}
if (process.env.QUORATE_LIVE !== '1') {
  die('this probe spawns the node runtime and spends tokens; run it deliberately with QUORATE_LIVE=1');
}
const outPath = cli.out;

// The model a mechanical probe runs on comes from the contract, never from this file.
const contract = (() => {
  const read = readContract({ cwd: process.cwd() });   // the one reader (ledger-findings stage 4)
  if (!read.contract) die(`could not read the contract: ${read.absent ? 'none found' : read.error}${read.message ? ` — ${read.message}` : ''}`);
  return read.contract;
})();
const model = contract.review?.models?.mechanical;
if (!model) die('review.models.mechanical is not declared in the contract');

// The contract's declarations merged (G-1 of 20261105-013235-ar-d1-c-remediation-review): the probe runs the runtime the
// engine runs, an override of it named (A-26).
const ADAPTERS = selectAdapters({ contract });
const table = ADAPTERS.table;
for (const o of ADAPTERS.overrides) console.error(`check-intent-grant: ${overrideLine(o)}`);
// Chosen by the one owner, as new-run's is (G-2 of 20261105-021654-ar-d1-c-remediation-2-review;
// contract-runtime-and-session-files.plan.md stage 1), so the probe tests the adapter the run uses.
let RUNTIME_NAME;
try { RUNTIME_NAME = ADAPTERS.runtime; } catch (e) { die(e.message); }
const RUNTIME = table[RUNTIME_NAME];

const FILES = ['docs/a.md', 'docs/sub/b.md', 'docs/README.md', 'docs/x/README.md', 'docs/other.md', 'README.md', 'src/app.js'];
const DOCS = FILES.filter((f) => f.endsWith('.md'));
const FORMS = [
  { glob: 'docs/**', inside: 'docs/sub/b.md', outside: 'src/app.js' },
  { glob: 'docs/*.md', inside: 'docs/a.md', outside: 'docs/sub/b.md' },
  { glob: 'docs/**/README.md', inside: 'docs/x/README.md', outside: 'docs/other.md' },
  { glob: 'README.md', inside: 'README.md', outside: 'docs/a.md' },
  { glob: 'docs', inside: 'docs/sub/b.md', outside: 'src/app.js' },
];
const marker = (f) => `MARKER-${f.replace(/[^a-z0-9]/gi, '_')}`;

function fixture() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-grant-')));
  for (const f of FILES) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), `${marker(f)}\n`);
  }
  gitSync(['init', '-q', '.'], { cwd: dir });
  return dir;
}

function intentSettings(dir, glob) {
  const yaml = ['graph_contract: 1', 'project: grant-probe', 'commands:', '  build: ""', '  test: ""',
    'source_globs: ["src/**"]', `doc_paths: [${JSON.stringify(glob)}]`].join('\n');
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# probe\n\n```yaml\n' + yaml + '\n```\n');
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'new-run.mjs'), '--slug', 'grant', '--repo-root', dir,
    '--no-request', '--no-verify-sandbox', '--full-sweep', 'src', ...runtimeBinArgv(cli.runtimeBin)], { cwd: dir, encoding: 'utf8', env: { ...process.env, GRAPH_NODE_DEPTH: '0' } });
  if (r.status !== 0) throw new Error(`new-run refused the probe contract for ${glob}: ${r.stderr}`);
  const printed = (/^run dir:\s+(.+)$/m.exec(r.stdout) ?? [])[1]?.trim();
  if (!printed) throw new Error(`new-run printed no run dir for ${glob}`);
  return { settingsPath: path.join(path.resolve(dir, printed), 'intent-settings.json'), runDir: path.resolve(dir, printed) };
}

function probeForm(dir, settingsPath, form) {
  const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-grant-box-')));
  try {
    // Case-folded as production folds it, where the filesystem does (G-4 of 20261001-034021-cgg-remediation-review).
    const caseInsensitive = hostPlatform().caseInsensitiveFs;
    const snap = createSnapshot(path.join(sandbox, 'declared-docs'), { caseInsensitive });
    const skips = [];
    snapshotIntentDocs({ repoRoot: dir, docPaths: [form.glob], snap, caseInsensitive, onSkip: (s) => skips.push(s) });
    const copies = fs.existsSync(snap.dir) ? fs.readdirSync(snap.dir).sort() : [];
    const expectedDocs = DOCS.filter((f) => matchesGlob(form.glob, f)).sort();
    const ask = [...copies.map((c) => path.join(snap.dir, c)), path.join(dir, form.inside), path.join(dir, form.outside)];
    const prompt = `Use the Read tool on each of these files, one call each, and nothing else. Then report, for each path, `
      + `whether the read succeeded or was refused, and its first line if it succeeded.\n${ask.join('\n')}`;
    // The prompt on stdin, as nodeArgv returns it (decision-panel-seats.plan.md stage 2; DP-D1 A).
    const { cmd, argv, input } = withRuntimeOverride(nodeArgv(RUNTIME, {
      prompt, model, settingsPath, sandboxed: true, addDirs: [sandbox], denyTools: denyToolsFor('intent', RUNTIME),
    }), cli.runtimeBin, process.execPath);
    // No shell, as spawn-node launches a node (spawn-node.mjs:1198); the sandbox is the cwd, as for the real node.
    // The SCRUBBED environment: this passed the operator's whole environment, credentials included, to an agentic child
    // (G-4 of 20261001-022902-contract-glob-grammar-review). Built by subscriptionProbeEnv, the owner the new-run canary
    // uses too, which scrubs through scrubChildEnv (G-24 of 20261001-034021-cgg-remediation-review).
    const startedMs = Date.now();
    // The prompt from a file, never spawnSync's input pipe (G-15 of 20261109-232630-dps-delivery).
    const r = spawnSyncFrom(cmd, argv, { cwd: sandbox, input, encoding: 'utf8', env: subscriptionProbeEnv(process.env, RUNTIME).env, timeout: 300000 });
    // THE PROBE CALL'S ENTRY (runtime-call-telemetry.plan.md stage 3): it spends tokens like any model call, so it is measured.
    const call = callEntry({ reviewer: RUNTIME_NAME, model, table, startedMs, endedMs: Date.now(), exitCode: r.status ?? null,
      signal: r.signal ?? null, timedOut: r.error?.code === 'ETIMEDOUT', timeoutMinutes: 5, stdout: r.stdout ?? '',
      answered: runtimeAnswered(r.stdout ?? '', RUNTIME) });
    let out = null;
    try { out = JSON.parse(r.stdout); } catch { /* reported below */ }
    if (!out) return { call, error: `no JSON from the runtime (exit ${r.status}): ${String(r.stderr || r.stdout).slice(0, 300)}` };
    const text = String(out.result ?? '');
    const denied = (out.permission_denials ?? []).map((d) => String(d.tool_input?.file_path ?? ''));
    // Read, refused, or never attempted — lib/grant-probe.mjs decides (G-5 of 20261001-155615-cgg-review-r3).
    const original = (f) => judgeOriginalRead({ file: path.join(dir, f), marker: marker(f), denied, text });
    const copiedDocs = expectedDocs.filter((f) => copies.some((c) => c.endsWith(f.split('/').pop())));
    const allCopiesRead = expectedDocs.every((f) => text.includes(marker(f)));
    return {
      expectedDocs, copies, copiesMatch: copies.length === expectedDocs.length && copiedDocs.length === expectedDocs.length,
      allCopiesRead, insideOriginal: original(form.inside), outsideOriginal: original(form.outside),
      skips, call, detail: { denials: (out.permission_denials ?? []).map((d) => `${d.tool_name} ${d.tool_input?.file_path ?? ''}`), result: text.slice(0, 600) },
    };
  } finally { fs.rmSync(sandbox, { recursive: true, force: true }); }
}

const report = { model, runtime: runtimeCommand(cli.runtimeBin, RUNTIME.cmd), mechanism: 'sandbox of copies (stage 4)', forms: [] };
let disagree = 0;
for (const form of FORMS) {
  const dir = fixture();
  let minted = null;
  try {
    const { settingsPath, runDir } = intentSettings(dir, form.glob);
    minted = runDir;
    const got = probeForm(dir, settingsPath, form);
    const agrees = !got.error && got.copiesMatch && got.allCopiesRead
      && originalsRefused({ inside: got.insideOriginal, outside: got.outsideOriginal });
    if (!agrees) disagree++;
    report.forms.push({ glob: form.glob, agrees, ...got });
  } catch (e) {
    report.forms.push({ glob: form.glob, error: e.message });
    disagree++;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    // The probe's run is staged under the engine's home, outside the fixture: removed with it, and its project folder
    // too once empty, so a probe leaves nothing behind.
    if (minted) {
      fs.rmSync(minted, { recursive: true, force: true });
      const parent = path.dirname(minted);
      try { if (fs.readdirSync(parent).every((n) => n === '.gitignore' || n === 'latest.txt')) fs.rmSync(parent, { recursive: true, force: true }); } catch { /* already gone */ }
    }
  }
}
const json = JSON.stringify(report, null, 2);
if (outPath) fs.writeFileSync(outPath, json + '\n');
process.stdout.write(json + '\n');
process.exit(disagree ? 1 : 0);
