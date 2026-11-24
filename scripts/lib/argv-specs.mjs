// EVERY ENTRYPOINT'S COMMAND LINE, IN ONE PLACE (entrypoint-argv.plan.md stage 3).
//
// Each top-level script that reads process.argv parses it through lib/argv.mjs's parseArgv against its entry here, so
// a test can parse a documented command, or an argv the engine builds for a child, against the same spec the script
// itself uses. A flag missing here is refused by its script; a flag here that the script does not read is a flag
// nobody can use, so the two are kept together by the adoption test (tests/regression-argv-adoption.test.mjs).
//
// Types (lib/argv.mjs): `string` one value, given once · `repeat` one value per use, any number of uses · `boolean` no
// value · `list` the values up to the next `--flag`, one or more. `positionals: true` admits bare arguments, a number at most that many;
// `passthrough: true` keeps everything after `--` untouched. Pure data: no I/O.

// THE RUNTIME BINARY OVERRIDE, ONE PAIR FOR EVERY SCRIPT THAT TAKES IT (operator, 2026-11-11: "A. Rename, keep an alias
// (Recommended)", decision 20261111-172326-aaa7f7): `--runtime-bin <path>` replaces the node runtime's command (a fixture's
// fake runtime; a `.mjs`/`.js` runs under this node), named for the runtime rather than a vendor (ARCHITECTURE A-9).
// `--claude-bin`, its alias for one release, is REMOVED in 0.3.0 (operator, 2026-11-13: "0.3.0, remove the alias
// (Recommended)"). It stays in the spec only so that its refusal names the new spelling, where an unknown-flag error would
// not. Read only through runtimeBinFrom, below, or io/runtime-bin.mjs: a census refuses the old spelling anywhere else.
export const RUNTIME_BIN_FLAG = 'runtime-bin';
export const RUNTIME_BIN_ALIAS = 'claude-bin';
export const RUNTIME_BIN = Object.freeze({ [RUNTIME_BIN_FLAG]: 'string', [RUNTIME_BIN_ALIAS]: 'string' });

/**
 * The override a parsed command line names, `{ bin }`: the path or null. The removed alias is refused (Error), naming the
 * flag that replaced it, so a caller still passing it learns the new spelling.
 */
export function runtimeBinFrom(values = {}) {
  if (values[RUNTIME_BIN_ALIAS] !== undefined) {
    throw new Error(`--${RUNTIME_BIN_ALIAS} was renamed --${RUNTIME_BIN_FLAG} in 0.3.0: pass --${RUNTIME_BIN_FLAG} <path>`);
  }
  const now = values[RUNTIME_BIN_FLAG];
  // An EMPTY value is refused here (G-5 of 20261111-184046-runtime-bin-delivery): accepted, it was kept by one reader's
  // `??` and dropped by every forwarder's truthiness check, so the child ran the real runtime.
  if (now === '') throw new Error(`--${RUNTIME_BIN_FLAG} is empty: it takes the path of the runtime to run instead of the adapter's`);
  return { bin: now ?? null };
}

/** The command a script runs: the override runtimeBinFrom gave, or the adapter's own `cmd` (G-10 of
 *  20261111-184046-runtime-bin-delivery: one owner, where three scripts each resolved it). */
export const runtimeCommand = (bin, cmd) => bin ?? cmd;

/** How that command is launched, `{ cmd, prefix, command }`: a `.mjs`/`.js` command runs under `execPath` with itself as
 *  the first argument (a script is not an executable on Windows, and resolving it by name could find the installed CLI
 *  instead); anything else runs as itself. `command` is the resolved command, for messages. The one owner of both
 *  choices (G-6 of 20261111-192009-runtime-bin-remediation-review: the wrapping was written in three places). */
export function runtimeLaunch(bin, cmd, execPath) {
  const command = runtimeCommand(bin, cmd);
  return /\.m?js$/i.test(command) ? { cmd: execPath, prefix: [command], command } : { cmd: command, prefix: [], command };
}

export const ARGV_SPECS = {
  // ------------------------------------------------------------------------------------------------ the graph engine
  'new-run': {
    options: {
      'repo-root': 'string', slug: 'string', base: 'string',
      // The paths of a sweep, as many as follow the flag; none is refused (G-4 of 20261020-122714-ciss-remediation-4b-review).
      'full-sweep': 'list',
      'dry-run': 'boolean', 'print-contract': 'boolean',
      request: 'string', 'no-request': 'boolean', 'validate-settings': 'string',
      'verify-sandbox': 'boolean', 'no-verify-sandbox': 'boolean',
      'no-verify-reviewers': 'boolean', 'test-preflight-stall-ms': 'string', 'test-preflight-crash': 'boolean',
      ...RUNTIME_BIN, now: 'string',
      remediates: 'string', groups: 'string', 'operator-quote': 'string', 'follows-remediation': 'string',
    },
  },
  'run-graph': {
    options: {
      'run-dir': 'string', 'repo-root': 'string', only: 'string',
      preflight: 'string', 'skip-preflight': 'boolean',
      'no-archive': 'boolean', 'skip-intent': 'boolean', 'fresh-intent': 'boolean', resume: 'boolean',
      'skip-panel': 'boolean', ...RUNTIME_BIN, 'reconcile-twice': 'boolean',
    },
  },
  remediate: {
    options: {
      'run-dir': 'string', 'repo-root': 'string', unsandboxed: 'boolean', ...RUNTIME_BIN,
      'no-verify-sandbox': 'boolean', 'no-verify-reviewers': 'boolean',
      // One trailer line per use, on every cluster commit (remediation-commit-recovery).
      'commit-trailer': 'repeat', 'retry-commits': 'boolean', repair: 'boolean', 'readmit-evidence': 'boolean',
      'test-fail-reset': 'boolean', 'test-fail-unmark': 'boolean', 'test-fail-after-node': 'string', 'test-fail-unlink': 'boolean',
      'test-fail-rev-list': 'boolean', 'test-fail-rev-parse': 'boolean', 'test-die-after-cluster': 'string',
      'test-die-after-commit': 'string', 'test-fail-runner-log': 'boolean', 'test-fail-start-head': 'boolean', 'test-fail-write-back': 'boolean', 'test-first-free-max': 'string', 'test-mismatch-write-back': 'boolean',
      'test-repair-passes': 'string', 'measure-only': 'boolean', 'replay-node': 'string',
    },
  },
  'spawn-node': {
    options: {
      'run-dir': 'string', 'repo-root': 'string', 'node-id': 'string', 'skill-command': 'string', prompt: 'string',
      mode: 'string', model: 'string', 'timeout-minutes': 'string', 'output-cap-mb': 'string', ...RUNTIME_BIN,
      runtime: 'string', 'budget-usd': 'string', 'schema-variant': 'string', 'allowed-basis': 'string',
      settings: 'string', auth: 'string', effort: 'string', 'severity-ceiling': 'string', 'severity-floor': 'string',
      'verdict-ceiling': 'string', 'test-stop': 'string',
      // Mirrors the runtime's own `--add-dir <directories...>`: every path up to the next flag.
      'add-dir': 'list',
      unsandboxed: 'boolean', 'inline-skill': 'boolean', instructions: 'string', 'print-cmd': 'boolean',
    },
  },
  'spawn-subagent': {
    options: {
      'prompt-file': 'string', out: 'string', result: 'string', 'repo-root': 'string', ...RUNTIME_BIN,
      effort: 'string', cwd: 'string',
    },
  },
  // `-- <command>`: everything after the separator is the command, untouched.
  capture: {
    // The interactive front end's flags beside the lens's (capture-interactive.plan.md stage 4): capture.mjs refuses each
    // mode's flags in the other, so one spec serves the one entry.
    options: { 'run-dir': 'string', node: 'string', 'timeout-minutes': 'string', name: 'string', cwd: 'string',
      interactive: 'boolean', mode: 'string', 'evidence-dir': 'string', 'preview-lines': 'string', quiet: 'boolean',
      'stdin-file': 'string', fetch: 'string', strict: 'boolean' },
    passthrough: true,
  },
  'archive-run': { options: { 'run-dir': 'string', 'repo-root': 'string' } },
  // The stop record's summary and the stop guard (autonomous-run-pauses.plan.md stages 2-3).
  'stop-log': { options: { summary: 'boolean', 'repo-root': 'string' } },
  'stop-guard': { options: { 'turn-start': 'boolean', 'stop-failure': 'boolean', 'repo-root': 'string' } },
  'command-log': { options: { summary: 'boolean', after: 'boolean', last: 'string', 'repo-root': 'string' } },
  // The run records' command (telemetry-records.plan.md): a subcommand, then its options.
  telemetry: { options: { 'repo-root': 'string', since: 'string', kind: 'string', fields: 'boolean', rebuild: 'boolean' }, positionals: 1 },
  // Marked rule regions from their one owner (code-index-d1-part-a.plan.md stage 4).
  'gen-rule-text': { options: { check: 'boolean', root: 'string' } },
  'run-checks': {
    options: { 'run-dir': 'string', 'repo-root': 'string', 'input-hash': 'string', 'inputs-inferred': 'boolean' },
  },
  preflight: { options: { run: 'boolean', 'repo-root': 'string' } },
  // `--new <slug>`, or `<check-dir>` with or without `--check`.
  'claim-check': {
    options: { new: 'string', check: 'boolean', transcript: 'string', ...RUNTIME_BIN },
    positionals: 1,
  },

  // ----------------------------------------------------------------------------------------- reviewers and checks
  'external-review': {
    options: {
      'run-dir': 'string', 'evidence-dir': 'string', surface: 'string', 'node-id': 'string', reviewer: 'string',
      mode: 'string', model: 'string', effort: 'string', 'candidate-fields': 'string', 'prompt-file': 'string',
      participants: 'string', schema: 'string', 'timeout-minutes': 'string', consent: 'string',
      'severity-ceiling': 'string', 'verdict-ceiling': 'string', 'allowed-basis': 'string', out: 'string',
      'preflight-only': 'boolean', reprobe: 'boolean', 'probe-run': 'boolean', 'probe-timeout-ms': 'string',
      'test-stall-ms': 'string', 'test-crash': 'boolean',
    },
  },
  'check-reviewers': { options: { reviewer: 'string', force: 'boolean' } },
  // The decision panel's one entry (autonomous-run.plan.md stage 5): exactly one action per call.
  decide: {
    options: {
      question: 'string', revote: 'string', pending: 'boolean', overrule: 'string', 'operator-quote': 'string',
      'count-spend': 'string', json: 'boolean', 'repo-root': 'string', ...RUNTIME_BIN,
      // `--sample` takes no value, so its default size applies; `--size <n>` sets another (G-19 of
      // 20261101-014615-ar-delivery-remediation-review: a required value meant the default was never used).
      sample: 'boolean', size: 'string', 'sample-mark': 'string', mark: 'string',
    },
  },
  // A long run's state and its hooks (autonomous-run.plan.md stage 7).
  'run-session': {
    options: { plan: 'string', until: 'string', 'repo-root': 'string', 'session-start': 'boolean' },
    positionals: true,
  },
  'resume-run': { options: { exec: 'boolean', 'repo-root': 'string' } },
  'check-plan-verdict': { options: { verdict: 'string', model: 'string', effort: 'string' } },
  'check-intent-grant': { options: { out: 'string', ...RUNTIME_BIN } },
  'check-install': { options: { 'repo-root': 'string' } },
  'check-counted-facts': { options: { 'tests-count': 'string', doc: 'string' } },
  'check-secrets': { options: { mode: 'boolean' } },
  // A finished review posted to a pull request (pr-review-comments.md): --run-dir and --pr required, --post sends; --gh-bin
  // replaces `gh` with a fixture's fake and is not documented.
  'pr-comments': { options: { 'run-dir': 'string', pr: 'string', post: 'boolean', 'repo-root': 'string', 'gh-bin': 'string' } },
  // One release snapshot (m2-public-release.plan.md stage 2): --ref is required, --out and --identity unless --dry-run.
  publish: {
    options: {
      ref: 'string', out: 'string', identity: 'string', local: 'string', 'dry-run': 'boolean', 'no-suite': 'boolean',
      'write-public-contract': 'boolean',
      'repo-root': 'string',
    },
  },
  // `<command> [args...]`: the command is the first argument, and only the arguments after it are parsed here.
  'code-index': {
    options: {
      'repo-root': 'string', language: 'string', args: 'string', needs: 'string', extractor: 'string',
      fixtures: 'string', answers: 'string',
    },
    positionals: true,
  },
  'find-inert-features': { options: { 'repo-root': 'string', json: 'boolean' } },

  // -------------------------------------------------------------------------------------------- ledger and reports
  'findings-ledger': {
    options: {
      'run-dir': 'string', 'repo-root': 'string', ledger: 'string', summary: 'boolean', stale: 'boolean',
      'mark-fixed': 'repeat', disposition: 'string', evidence: 'string', reason: 'string', 'operator-quote': 'string',
      // The review groups a disposition concerns, as <run>:<G-n> (3b); repeatable.
      group: 'repeat',
      add: 'boolean', 'migrate-transitions': 'boolean', 'migrate-identity': 'boolean',
      report: 'string', file: 'string', line: 'string', severity: 'string', claim: 'string', 'found-by': 'string',
      onto: 'string',
    },
  },
  'usage-report': { options: { since: 'string', transcripts: 'string', json: 'boolean' } },

  // ------------------------------------------------------------------------------------------ bench and blog tools
  'bench-admit': {
    options: {
      current: 'string', candidate: 'string', 'fp-tolerance': 'string', position: 'string', json: 'boolean',
      'allow-incomparable': 'boolean',
    },
  },
  // The repair pass measured on real refusals (remediation-repair-pass.plan.md stage 4). --runtime-bin is TEST-ONLY: the
  // runtime a repair pass is forwarded to, in place of the adapter's own command. It was its own --node-bin, a third
  // spelling taking neither of the pair (G-7 of 20261111-184046-runtime-bin-delivery).
  'bench-repair-pass': {
    options: { case: 'repeat', cap: 'string', results: 'string', 'repo-root': 'string', ...RUNTIME_BIN },
  },
  'bench-lenses': {
    options: {
      seed: 'string', tolerance: 'string', 'score-only': 'boolean', 'run-dir': 'string', manifest: 'string',
      concurrency: 'string', 'defect-line': 'string', effort: 'string', model: 'string', 'no-panel': 'boolean',
    },
  },
  'bench-second-opinion': {
    options: {
      from: 'string',
      // One comma-separated value, not a list: the seeds scored in one invocation.
      seed: 'string',
      judge: 'string', tolerance: 'string', keep: 'boolean', 'dry-run': 'boolean', rule: 'string',
      'forge-only': 'boolean', rejudge: 'string', mutation: 'string', forged: 'string', model: 'string',
      effort: 'string',
    },
  },
  'extract-sessions': {
    options: { project: 'string', out: 'string', since: 'string', 'nodes-only': 'boolean', 'human-only': 'boolean' },
  },
  'check-quotes': { options: { page: 'string', digests: 'string' } },
};
