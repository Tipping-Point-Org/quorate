// Does this push need the full declared check set, or is it work in progress?
//
// git hands a pre-push hook one line per ref on stdin:
//
//     <local ref> <local sha> <remote ref> <remote sha>
//
// The gate charges the full set only when work is entering a protected branch. A feature-branch
// push is free, because taxing the cheap frequent operation — saving work in progress — to protect
// the rare expensive one is how people learn to reach for --no-verify, and a gate that is routed
// around protects nothing.
//
// This lives here rather than in the hook because it is a DECISION, and decisions in this project
// are extracted so they can be tested. The hook that first carried it was a three-line shim; adding
// ref parsing, protected-ref matching and fail-closed handling to it put twenty lines of branching
// logic in the one language in this repository that has no unit tests — and the fail-closed half
// was wrong when written, which is exactly the class a test catches in milliseconds.
//
// It does NOT cover a merge performed on the forge. A GitHub PR merge runs server-side where no
// local hook executes, and no arrangement of hooks substitutes for CI.

/** Refs whose contents are protected. A literal list, not a config lookup: a guard that must
 *  resolve configuration before deciding whether to run can fail open when the lookup fails. */
export const PROTECTED_REFS = ['refs/heads/main', 'refs/heads/master'];

const ZERO_SHA = '0000000000000000000000000000000000000000';

/**
 * @param {string|null} stdin  the raw ref lines git supplied, or null when there were none
 * @returns {{gate: boolean, reason: string}}
 */
export function pushNeedsGate(stdin, protectedRefs = PROTECTED_REFS) {
  const lines = String(stdin ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  // FAIL CLOSED. No readable ref list means "I could not tell what you are pushing", which must
  // never resolve to "no gate". The first version of this logic let an empty stdin fall through the
  // read loop and concluded 'no protected ref, skip' from having read nothing at all.
  if (!lines.length) return { gate: true, reason: 'no readable ref list — gating rather than guessing' };

  let sawRef = false;
  for (const line of lines) {
    const [, localSha, remoteRef] = line.split(/\s+/);
    if (!remoteRef) continue;
    sawRef = true;
    // A deletion pushes the zero sha. There is nothing to build or test in removing a ref, so it
    // does not RAISE the gate — but it must not lower one another line already raised, which is
    // why this continues rather than assigning.
    if (localSha === ZERO_SHA) continue;
    if (protectedRefs.includes(remoteRef)) {
      return { gate: true, reason: `pushing to ${remoteRef}` };
    }
  }

  if (!sawRef) return { gate: true, reason: 'no usable ref line — gating rather than guessing' };
  return { gate: false, reason: 'no protected ref in this push' };
}

// ---------------------------------------------------------------- the secret scan
//
// Runs on EVERY push, not only protected ones: a secret pushed to any branch on the remote has
// already left the machine, and scanning only the commits a push adds takes well under a second.
// The feature-branch exemption above exists to keep an EXPENSIVE gate from being routed around; this
// one is cheap, and what it guards cannot be undone.

/** gitleaks' exit code for "leaks found", set explicitly so it cannot be confused with a scanner
 *  that failed (gitleaks' own default for both is 1). */
export const SECRET_LEAK_EXIT = 99;

/**
 * The commit ranges a push adds, as `git log` options for the scanner. `all: true` when the ref list
 * cannot be read: scanning the whole history is the fail-closed answer, and it is still fast.
 * @returns {{all: boolean, ranges: string[]}}
 */
export function secretScanRanges(stdin) {
  const lines = String(stdin ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const ranges = [];
  let sawRef = false;
  for (const line of lines) {
    const [, localSha, remoteRef, remoteSha] = line.split(/\s+/);
    if (!remoteRef || !/^[0-9a-f]{40,64}$/.test(localSha ?? '') || !/^[0-9a-f]{40,64}$/.test(remoteSha ?? '')) continue;
    sawRef = true;
    if (localSha === ZERO_SHA) continue;   // a deletion adds nothing
    // A new branch: everything on it that no remote already has.
    ranges.push(remoteSha === ZERO_SHA ? `${localSha} --not --remotes` : `${remoteSha}..${localSha}`);
  }
  return sawRef ? { all: false, ranges } : { all: true, ranges: [] };
}

/** The scanner's argv for one range (null = the whole history). Redacted, so a found secret is
 *  never printed into a terminal or a CI log. */
export function secretScanArgv(repoRoot, range, { config = null } = {}) {
  return ['git', repoRoot, ...SCAN_FLAGS(),
    ...(range ? ['--log-opts', range] : []),
    ...(config ? ['--config', config] : [])];
}
const SCAN_FLAGS = () => ['--redact', '--no-banner', '--exit-code', String(SECRET_LEAK_EXIT)];

/**
 * The release snapshot's scan of a directory (scripts/publish.mjs): the same flags and exit code as the push scan, so the
 * two cannot drift (A-1; G-10 of 20261116-231613-m2-9a2-remediation-review), plus a JSON report every finding is read
 * from and an ignore path that holds no .gitleaksignore.
 */
export function secretScanDirArgv(dir, { config = null, reportPath, ignorePath }) {
  return ['dir', dir, ...SCAN_FLAGS(), '--report-format', 'json', '--report-path', reportPath,
    '--gitleaks-ignore-path', ignorePath, ...(config ? ['--config', config] : [])];
}

/**
 * WHICH gitleaks configuration the scan uses (ledger-trust-boundaries, 1b): the one shipped with the framework,
 * which extends gitleaks' default rules with a key-value rule — the JSON and spaced `password: "…"` shapes the
 * defaults miss (measured on gitleaks 8.30.1: one of six planted secrets found). A consumer's own
 * `.gitleaks.toml` takes precedence: a project's secret policy is its own call, and silently overriding it would
 * be worse than the gap — `check-install` says when the shipped rule is therefore not in force.
 * `exists` is injected, so this stays a pure decision (ARCHITECTURE §2). Returns null when the consumer's governs.
 */
export function secretScanConfig({ repoRoot, frameworkRoot, exists }) {
  const join = (a, b) => `${String(a).replace(/[\\/]+$/, '')}/${b}`;
  if (exists(join(repoRoot, '.gitleaks.toml'))) return null;
  return join(frameworkRoot, '.claude/hooks/gitleaks.toml');
}

/**
 * What one scan outcome means for the push. Only reached when the policy is `required` — an `off`
 * scan never runs — so a missing scanner BLOCKS, in any repository (G-9 of 20260926-002850-m0-close:
 * the first version let a consumer's push through unscanned, "absent treated as pass").
 * @param {{missing?: boolean, status?: number|null}} o
 * @returns {{block: boolean, message: string}}
 */
export function secretScanOutcome({ missing = false, status = null }) {
  if (missing) {
    return {
      block: true,
      message: 'gitleaks is not installed and this repository requires the secret scan '
        + '(hooks.secret_scan: required, or absent) — install gitleaks, or declare hooks.secret_scan: off '
        + 'in the graph_contract to turn the scan off deliberately',
    };
  }
  if (status === 0) return { block: false, message: 'no secrets found in the commits scanned' };
  if (status === SECRET_LEAK_EXIT) return { block: true, message: 'gitleaks found a secret in the commits scanned (redacted above)' };
  return { block: true, message: `gitleaks failed (exit ${status}) — a scan that did not run is not a scan that passed` };
}

/**
 * Whether the secret scan is required, as the graph_contract declares it (G-9 of
 * 20260926-002850-m0-close; operator, 2026-09-25): `hooks.secret_scan: required | off`, absent meaning
 * required. Anything else — a typo, an empty string — is REFUSED, never read as either: an empty key
 * elsewhere in the contract means "skipped and named", and for a safety switch a silent empty would
 * be exactly the unscanned push this key exists to prevent. The ONE owner of what the flag means; the
 * hook and CI (through scripts/check-secrets.mjs) both ask it.
 * @returns {{mode: 'required'|'off', declared: boolean} | {error: string}}
 */
export function secretScanPolicy(contract) {
  const raw = contract?.hooks?.secret_scan;
  if (raw === undefined || raw === null) return { mode: 'required', declared: false };
  if (raw === 'required' || raw === 'off') return { mode: raw, declared: true };
  return { error: `hooks.secret_scan must be "required" or "off" (absent means required), got ${JSON.stringify(raw)}` };
}

