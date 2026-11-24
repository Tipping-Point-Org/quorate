
// G-63 IN THE POSITIVE ARM. The negative arm was taught, in this same file's sibling, that a
// canary has THREE outcomes and that blaming node-settings.json "was the wrong subsystem every
// time it fired, because the file had loaded fine and the probe had simply taken a route that
// records nothing." The positive arm one `if` later still blamed it unconditionally.
//
// Measured 2026-09-23: three of seven lens-bench seeds refused to mint on that message while their
// own sandbox-canary.json recorded TWO DENIALS apiece — which is proof the policy loaded, since an
// unread policy cannot refuse anything. The probe had been told to run one allow-listed command,
// ran `ls -la` first "to check that capture.mjs and the run directory exist", was correctly denied
// twice, and never reached the real one. A working sandbox reported as a broken one, and about $5
// of sweep lost to seeds that never spawned a lens.
//
// The FLAKINESS is not fixed here and the message says so: it sends the reader to the probe. Only
// the diagnosis is corrected, which is the part that was actively misleading.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sandboxCanaryFailures, briefArg } from '../scripts/lib/decisions.mjs';

test('a recorded denial proves the policy loaded, so the message must not blame it', () => {
  const [why] = sandboxCanaryFailures({ sawDenial: true, allowWorked: false });
  assert.ok(why, 'this combination is still a failure — enforcement is proven, the probe is not');
  assert.doesNotMatch(why, /node-settings\.json was probably not loaded/,
    'a denial cannot be recorded by a policy that was never read; saying this sent three seeds\' '
    + 'worth of diagnosis at the one subsystem the evidence had already cleared');
  assert.match(why, /the policy loaded and was enforced/);
  assert.match(why, /this is the probe rather than the sandbox/);
  assert.match(why, /G-63/, 'it names the class, so the next reader does not re-derive it');
});

test('with no denial AND no allow-listed run, blaming the policy is still right', () => {
  const f = sandboxCanaryFailures({ sawDenial: false, allowWorked: false });
  assert.equal(f.length, 2, 'both arms failed, and both are worth saying');
  assert.ok(f.every((x) => /not loaded/.test(x)),
    'nothing ran and nothing was refused — the policy genuinely may never have been read');
});

test('the other two outcomes are unchanged', () => {
  const [enforcement] = sandboxCanaryFailures({ sawDenial: false, allowWorked: true });
  assert.match(enforcement, /The policy DID load/);
  assert.match(enforcement, /Enforcement is unproven/,
    'the allow-listed command ran, so the file loaded; nothing was refused, so nothing is proven');

  assert.deepEqual(sandboxCanaryFailures({ sawDenial: true, allowWorked: true }), [],
    'both arms did their job — this is the only combination that mints');
});

// G-7 of 20261124-160743-gsw-remediation-2-review-b: with no denial and the allow-listed command run, the message said "no
// file was created either" and that the probe "neither ran the denied command", then that a command ran. It is not told
// whether the denied copy wrote its file (new-run reports that beside it, as `the copy SUCCEEDED`), so it claims neither.
test('G-7: the no-denial diagnosis claims no file was absent and no command was not run', () => {
  const [enforcement] = sandboxCanaryFailures({ sawDenial: false, allowWorked: true });
  assert.doesNotMatch(enforcement, /no file was created/, 'it contradicts the allow-listed command that ran');
  assert.doesNotMatch(enforcement, /neither ran the denied command/, 'whether the copy ran is new-run\'s wroteFile, not known here');
  assert.match(enforcement, /the allow-listed command ran/);
});

// ---------------------------------------------------------------- the retry, and its boundaries
// The probe gets ONE second draw, and only for `sawDenial && !allowWorked && !wroteFile`. That
// combination is not a guess about what went wrong — it is checkable: a denial was RECORDED, which
// an unread policy cannot produce, so the settings file loaded AND the deny rules are enforced, and
// the single unproven thing is whether the probe ran the allow-listed command.
//
// The SCOPE is the security property, not the retry. Each exclusion is deliberate:
//
//   wroteFile   a probe that COPIED the file found a real enforcement hole. Never re-roll that.
//   !sawDenial  nothing was refused, so the policy may genuinely not have loaded — a fault to
//               surface, not to re-draw until it goes away.
//
// And a retry that also fails still refuses the mint, which is why one extra draw cannot weaken
// what the canary proves.
import fsx from 'node:fs';
import pathx from 'node:path';
import { fileURLToPath as furl } from 'node:url';

const NEW_RUN = fsx.readFileSync(
  pathx.join(pathx.dirname(furl(import.meta.url)), '..', 'scripts', 'new-run.mjs'), 'utf8',
);

test('the canary retries only the failure that proves the policy loaded', () => {
  // The guard condition is the behaviour, and it is one expression. A widened condition is exactly
  // how this becomes a probe that retries until a real enforcement hole looks like a flake.
  assert.match(NEW_RUN, /if \(attempt\.sawDenial && !attempt\.allowWorked && !attempt\.wroteFile\) \{/,
    'retry only when a denial was recorded, the allow-listed command did not run, and nothing was copied');

  // ONE draw, not a loop. `while` here would turn a refusal into a wait.
  assert.doesNotMatch(NEW_RUN, /while \([^)]*attempt\.(sawDenial|allowWorked)/,
    'a canary that retries in a loop cannot refuse');
  assert.match(NEW_RUN, /canaryAttempts = 2;/);

  // A FRESH SESSION, because a retry must be an independent draw rather than a continuation of a
  // conversation that has already concluded it is stuck.
  const retryBlock = NEW_RUN.slice(NEW_RUN.indexOf('canaryAttempts = 2;'));
  assert.match(retryBlock.slice(0, 600), /sessionId: crypto\.randomUUID\(\)/);
});

test('a retry is recorded, so it cannot hide an intermittency', () => {
  assert.match(NEW_RUN, /attempts: canaryAttempts,/,
    'sandbox-canary.json is tracked; the attempt count belongs in it');
  assert.match(NEW_RUN, /first_attempt_failures: firstAttemptFailures,/,
    'the first attempt\'s diagnosis travels too — a mint that needed two goes must be '
    + 'distinguishable from one that needed none');
});

// The canary's words live in prompts/_templates/sandbox-canary.md since G-17 of
// 20260925-015614-platform-review; these read the template, which is where the prompt now is.
const CANARY = fsx.readFileSync(pathx.join(import.meta.dirname, '..', 'prompts', '_templates', 'sandbox-canary.md'), 'utf8');

test('the prompt forbids the reconnaissance that caused the flake', () => {
  assert.match(CANARY, /Do not inspect the filesystem/,
    'the measured failure was the probe running `ls -la` first and being refused');
  assert.match(CANARY, /that is an EXPECTED outcome of this probe/,
    'step 2 is deny-listed ON PURPOSE, so a probe treating its first refusal as failure abandons '
    + 'the run before proving anything — this is the load-bearing half');
  assert.match(CANARY, /Do not stop, do not retry it/);
});

// ------------------------------------------- the real cause: a Windows path in a POSIX shell
// The prompt's step 1 carried `--run-dir C:\Users\...` UNQUOTED. A POSIX shell reads each backslash
// as an escape and hands capture.mjs `C:Userssomeone.quoratereviews...` — a relative path that does
// not exist, so capture exits 2, no gitstatus.log appears, and the positive arm fails against a
// policy that is working perfectly.
//
// THAT IS WHY IT LOOKED INTERMITTENT. node-settings.json permits the command under BOTH Bash and
// PowerShell and the two disagree about backslashes, so the outcome was decided by which shell the
// model reached for. The tell that this is not a flaky model: BOTH retry attempts on the seed that
// exposed it failed identically, and a retry cannot fix a deterministic mangling.
//
// The probe said it itself, once its answer was recorded: "the backslash Windows path was mangled
// by the POSIX shell, so capture.mjs looked for the run dir under a garbled relative path".

test('every path the canary prompt interpolates is shell-safe', () => {
  // THROUGH briefArg, THE ONE OWNER (G-7 of 20261121-214741-m3s7-b1-remediation-2-review): the inline quote-and-slash rule
  // this test pinned left `%NAME%`, `$` and a backtick live. Updated by hand on the operator's word ("I update the 2
  // tests, then retry (Recommended)").
  assert.match(NEW_RUN, /const sh = briefArg;/, 'the canary quotes its paths through briefArg, the shared owner');
  // What that owner does, driven: forward slashes and quotes, and a refusal of what quotes do not neutralise.
  assert.equal(briefArg('C:\\Users\\a b\\run'), '"C:/Users/a b/run"', 'forward slashes AND quotes');
  for (const hostile of ['C:/x/%PATH%/r', '/x/$(id)/r', '/x/`id`/r', '/x/"/r']) {
    assert.throws(() => briefArg(hostile), /cannot be quoted safely/, `${hostile} must be refused, not quoted`);
  }

  for (const arg of ['sh(CAPTURE_REL)', 'sh(runDir)', 'sh(settingsPath)', 'sh(canaryPath)']) {
    assert.ok(NEW_RUN.includes(arg), `${arg} must go through the shell-safe helper`);
  }
  // The raw forms are what broke it.
  assert.doesNotMatch(NEW_RUN, /--run-dir \$\{runDir\}/, 'an unquoted Windows run dir is the defect');
  assert.doesNotMatch(NEW_RUN, /cp \$\{settingsPath\} \$\{canaryPath\}/);
});

test('the quoted command the canary sends is one the policy actually allows', () => {
  // THE COUPLING THAT WOULD BREAK SILENTLY. Quoting the script path only works because the
  // allow-list grants the quoted form too. Drop that grant — reasonably, it looks redundant — and
  // the positive arm fails on every mint while the policy looks fine.
  assert.match(NEW_RUN, /grantRules\(NODE_RUNTIME, \[`node \$\{CAPTURE_REL\}`, `node "\$\{CAPTURE_REL\}"`\], hostPlatform\(\)\.id\)/,
    'both the bare and the quoted invocation must be granted');

  // And CAPTURE_REL is already forward-slashed at its source, so `sh()` cannot desync it from the
  // rule by rewriting separators the allow-list did not rewrite.
  assert.match(NEW_RUN, /\.split\(path\.sep\)\s*\n\s*\.join\('\/'\);/,
    'CAPTURE_REL normalises separators where it is derived, which is what makes the two agree');
});
