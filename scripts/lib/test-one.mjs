// THE NARROW CHECK A REMEDIATION NODE RUNS (remediation-verification.plan.md, stage 1; operator, 2026-10-13: "Declared
// test_one key (Recommended)"). capture admits a declared command only on an exact argv match, so a node could capture
// nothing narrower than the whole suite: 5.8–12 minutes a run, which nodes backgrounded, ended their own sessions on,
// or skipped (the ledger-identity rounds, 2026-10-13). `commands.test_one` is a declared TEMPLATE with one `{file}`
// placeholder that capture fills with one admissible test file, so a node's red and green take seconds.
//
// Pure: the template's grammar, matching an argv against it, and whether a file is admissible given facts the caller
// read (its classification, git's file list, whether it leads out through a link). The I/O is the caller's
// (ARCHITECTURE §2).

import { hasHeaderUnsafe } from './capture-header.mjs';

export const TEST_ONE_PLACEHOLDER = '{file}';

/**
 * The declared template, parsed. `{ok:true, argv:null}` when none is declared; `{ok:true, argv, index}` for a valid one;
 * `{ok:false, why}` otherwise. The placeholder must be exactly one whole whitespace-split token, once. A declared
 * `commands.shell` refuses it: the command would be one shell string, and filling a placeholder inside it is shell
 * interpolation of a file name a remediator can choose.
 */
export function testOneTemplate(contract) {
  const raw = String(contract?.commands?.test_one ?? '').trim();
  if (!raw) return { ok: true, argv: null };
  if (String(contract?.commands?.shell ?? '').trim()) {
    return { ok: false, why: 'commands.test_one cannot be used with a declared commands.shell: its {file} would be interpolated into a shell string' };
  }
  const argv = raw.split(/\s+/);
  const whole = argv.flatMap((t, i) => (t === TEST_ONE_PLACEHOLDER ? [i] : []));
  if (argv.some((t) => t !== TEST_ONE_PLACEHOLDER && t.includes(TEST_ONE_PLACEHOLDER))) {
    return { ok: false, why: `commands.test_one has ${TEST_ONE_PLACEHOLDER} inside another token; it must be a token of its own` };
  }
  if (whole.length === 0) return { ok: false, why: `commands.test_one has no ${TEST_ONE_PLACEHOLDER} placeholder` };
  if (whole.length > 1) return { ok: false, why: `commands.test_one has more than one ${TEST_ONE_PLACEHOLDER} placeholder` };
  return { ok: true, argv, index: whole[0] };
}

/** `{file}` when `cmd` is the template with only its placeholder filled, else null. */
export function matchTestOne(cmd, template) {
  if (!template?.ok || !template.argv) return null;
  const { argv, index } = template;
  if (!Array.isArray(cmd) || cmd.length !== argv.length) return null;
  for (let i = 0; i < argv.length; i++) if (i !== index && cmd[i] !== argv[i]) return null;
  return { file: cmd[index] };
}

/**
 * Why `file` may not fill the placeholder, or null when it may. `facts` supplies what only I/O can know:
 * `classify(path)` (the one classifier, classifyPath), `listed` (git's file list: tracked, or untracked and not
 * ignored, so an ignored tree such as .sandbox/ is never a target) and `linksOut(path)`.
 */
export function testOneFileRefusal(file, { classify, listed, linksOut }) {
  if (typeof file !== 'string' || !file) return 'no file was given for {file}';
  if (file.startsWith('-')) return `${JSON.stringify(file)} is a flag, not a file`;
  // capture writes the admitted name into its line-oriented header, so a line break in it could forge `# exit:` (G-1 of
  // 20261013-220031-rv-delivery). No control character, nor a Unicode line or paragraph separator, belongs in a name.
  if (hasHeaderUnsafe(file)) return `${JSON.stringify(file)} contains a control character`;
  // A runner may treat its argument as a pattern (`node --test` does), so a glob would run more than one file.
  if (/[*?[\]{}]/.test(file)) return `${JSON.stringify(file)} contains a glob character`;
  if (file.includes('\\') || file.startsWith('/') || /^[A-Za-z]:/.test(file)
    || file.split('/').some((s) => s === '..' || s === '.' || s === '')) {
    return `${JSON.stringify(file)} is not a repository-relative path written with forward slashes`;
  }
  if (classify(file) !== 'test') return `${JSON.stringify(file)} is not a test file under the contract's test_globs`;
  if (!listed.has(file)) return `${JSON.stringify(file)} is not in git's file list (missing, or ignored)`;
  if (linksOut(file)) return `${JSON.stringify(file)} is reached through a link out of the repository`;
  return null;
}
