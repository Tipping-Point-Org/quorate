// THE GITHUB CLI, CALLED ONE WAY (.claude/requests/pr-review-comments.md AC4).
//
// quorate holds no GitHub credentials: every call goes through `gh`, which uses its own stored login. Every token
// variable gh prefers over the stored login is removed for the call: a stale one fails every call (the same rule
// tests/tools/ci-watch.mjs keeps), and a live one posts as whichever account it names (G-4 of
// 20261120-231702-prc-delivery). `bin` replaces `gh` (a fixture's fake); a `.mjs`/`.js` one runs under this node, as a
// fake runtime does.
import { spawnSync } from 'node:child_process';
import { runtimeLaunch } from '../lib/argv-specs.mjs';
import { isGitConfigCarrier, isSecretShapedName } from '../lib/decisions.mjs';

/** The environment variables gh reads a token from before its stored login (gh help environment). */
export const GH_TOKEN_VARS = Object.freeze(['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']);

/** Run `gh <args>`: `{ ok, status, stdout, stderr, missing }`. `missing` is true when no `gh` could be started. */
export function gh(args, { bin = null, cwd, input } = {}) {
  const env = { ...process.env };
  // Case-insensitively: on Windows the environment's names are, and a spread copy keeps the spelling it was given.
  // EVERY CREDENTIAL, NOT ONLY GITHUB'S (G-5 of 20261121-001829-prc-remediation-review; operator: "I fix it by hand, then a
  // review (Recommended)"): gh needs no variable to authenticate, its login being in its own config, so every name the
  // engine's one secret test matches is removed, the GitHub token names among them; PATH, HOME and gh's config stay.
  // Git's environment config too (G-1 of 20261123-174149-m3s9-remediation-review-b): GIT_CONFIG_PARAMETERS and the
  // COUNT/KEY_n/VALUE_n tuple can carry an Authorization header that no secret-shaped name marks, as scrubChildEnv knows.
  for (const k of Object.keys(env)) if (GH_TOKEN_VARS.includes(k.toUpperCase()) || isSecretShapedName(k) || isGitConfigCarrier(k)) delete env[k];
  // The script-wrapping rule's one owner (runtimeLaunch): a `.mjs`/`.js` bin runs under this node.
  const { cmd, prefix } = runtimeLaunch(bin, 'gh', process.execPath);
  const r = spawnSync(cmd, [...prefix, ...args], { cwd, env, input, encoding: 'utf8', maxBuffer: 1 << 28, windowsHide: true });
  if (r.error) return { ok: false, status: null, stdout: '', stderr: String(r.error.message), missing: r.error.code === 'ENOENT' };
  return { ok: r.status === 0, status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', missing: false };
}
