// The tail guard for the read-only git set — capture.mjs's node-containment boundary.
//
// capture.mjs is the ONLY sanctioned way a node produces evidence, and `git diff`/`git log` were
// deliberately removed from the direct Bash grant so they would pass through here instead. That
// makes this list the thing standing between a review node and the operator's filesystem.
//
// Three families are refused: flags that WRITE a file, flags that READ OUTSIDE the repository, and
// flags that LAUNCH A PROGRAM.
//
// The bundling defect that forced this extraction: `/^-O/` matched only a token STARTING with -O,
// but git's parse-options BUNDLES short flags, so `-nOcat` is `-n -O cat` and reached
// `--open-files-in-pager` unexamined. git runs that pager through a SHELL (child.use_shell = 1 in
// builtin/grep.c run_pager), so the primitive is arbitrary command execution rather than merely
// launching a named program. Demonstrated live: the command exited 0 and wrote the contents of a
// file outside the repository into the run's own evidence directory.
//
// The general lesson, and the reason this is now a function rather than a list of regexes: a
// deny-list that matches whole tokens cannot see a flag hiding inside a bundle. Long options cannot
// bundle, so they stay exact-matched; short flags must be decomposed.

/**
 * Long-form escapes, BY NAME rather than by spelling.
 *
 * These were regexes anchored on the full option name, which is not how git reads a command line:
 * parse-options accepts any UNAMBIGUOUS PREFIX. `--op` resolves to `--open-files-in-pager`, sailed
 * past `/^--open-files-in-pager/`, and reached the pager — which git runs through a shell.
 * Demonstrated live through capture.mjs, the sanctioned channel:
 *
 *     git grep --op=echo SHELL_METACHARS_EXECUTED; hostname
 *     -> exit 0, printed SHELL_METACHARS_EXECUTED and the machine's hostname
 *
 * That is the same primitive the short-flag bundling defect gave up, reached by a different road,
 * and the same lesson a third time: a deny-list must model how the TARGET parses its input, not how
 * the option is spelled in documentation.
 */
export const FORBIDDEN_LONG_NAMES = [
  'output',               // git diff/log --output[=<path>]: writes a file at any path
  'open-files-in-pager',  // git grep: launches an arbitrary program, through a shell
  'ext-diff',             // git diff: runs the configured external diff program
  'textconv',             // git diff/show: runs configured textconv filters
  'upload-pack',          // transport program override
  'receive-pack',         // transport program override
  'no-index',             // git diff/grep: compares/searches arbitrary filesystem paths
  'contents',             // git blame --contents <path>: prints an arbitrary file's lines
  'ignore-revs-file',     // git blame --ignore-revs-file <path>: reads a file at any path (G-6, rdt-remediation-2-review)
  'exclude-from',         // git ls-files --exclude-from=<path>: reads a file at any path (same family)
];

/**
 * Options that are a PROPER PREFIX of a forbidden name but are themselves real, safe options.
 *
 * git resolves an EXACT match before considering abbreviations, so `--text` is `--text` and never
 * an abbreviation of `--textconv`. Mirroring that rule keeps the guard from refusing a legitimate
 * flag — and a guard that fires on correct input is one people learn to route around, which this
 * project's own doctrine names as the way a guard stops protecting anything.
 */
const EXACT_ALLOW = new Set(['text', 'ignore-rev', 'exclude']);

/**
 * Short flags that are dangerous ANYWHERE in a bundle.
 *
 * `O` is `git grep -O<pager>` — the same launch as --open-files-in-pager, in one character. It is
 * value-taking, so everything after it in the token is the pager, which is why scanning the whole
 * cluster is necessary rather than checking only the first character.
 */
const FORBIDDEN_SHORT = new Set(['O']);

/**
 * FLAGS THAT READ A FILE AT ANY PATH IN ONE SUBCOMMAND ONLY (run-dir-descendants.plan.md stage 5; G-17, with G-16 and G-28,
 * of 20261024-122231-rdt-remediation-3-review). The same letter means something harmless elsewhere (`-f` is not a file
 * in `git log`), so these are refused only for the subcommand that reads with them:
 *   git grep -f <file> / --file <file>   reads the patterns from a file at any path
 *   git blame -S <revs-file>             reads the revisions from a file at any path
 *   git ls-files -X <file>               is --exclude-from, read from a file at any path
 */
const SUBCOMMAND_SHORT = { grep: new Set(['f']), blame: new Set(['S']), 'ls-files': new Set(['X']) };
const SUBCOMMAND_LONG = { grep: ['file'] };

/**
 * The first token of a git command's tail that escapes the read-only set, or null: every global escape
 * (forbiddenTailToken), then the escapes particular to `subcommand`.
 */
export function forbiddenTail(subcommand, tail) {
  const short = SUBCOMMAND_SHORT[subcommand] ?? new Set();
  const long = SUBCOMMAND_LONG[subcommand] ?? [];
  for (const raw of tail ?? []) {
    const t = String(raw ?? '');
    if (forbiddenTailToken(t)) return t;
    if (t.startsWith('--')) {
      const name = t.slice(2).split('=')[0];
      // An exact name, or an abbreviation of one (git would expand it, or reject it as ambiguous: refused either way).
      if (name && long.some((f) => f === name || f.startsWith(name))) return t;
      continue;
    }
    if (/^-[^-]/.test(t) && [...t.slice(1)].some((ch) => short.has(ch))) return t;
  }
  return null;
}

/**
 * Is this argument an escape from the read-only set? Returns the reason-bearing token, or false.
 *
 * A bundle is a token that starts with exactly one `-` followed by letters. Every character up to
 * (and not including) a value is a separate flag, so each is checked. `--` and long options are not
 * bundles and are matched exactly.
 */
export function forbiddenTailToken(token) {
  const t = String(token ?? '');

  // Long options: resolve the way git does, then refuse in BOTH directions.
  //
  //   name is a prefix of a forbidden name  -> an abbreviation git would expand to it (`--op`)
  //   name starts with a forbidden name     -> an extension of it (`--output-indicator-new`)
  //
  // An ambiguous abbreviation (`--o` matches both `output` and `open-files-in-pager`) is refused
  // too. git would reject it as ambiguous, so refusing costs nothing and failing closed on a token
  // whose meaning cannot be determined is the rule everywhere else in this framework.
  if (t.startsWith('--')) {
    const name = t.slice(2).split('=')[0];
    if (name && !EXACT_ALLOW.has(name)) {
      if (FORBIDDEN_LONG_NAMES.some((f) => f.startsWith(name) || name.startsWith(f))) return true;
    }
  }

  // Not a short-flag bundle: `--long`, a bare `-`, or an ordinary argument.
  //
  // ANY single-dash token is scanned, whatever it opens with. The first version of this guard
  // required a LETTER (`/^-[A-Za-z]/`), which meant a cluster opening with a DIGIT was returned
  // non-forbidden without its characters ever being examined — and git grep declares
  // OPT_NUMBER_CALLBACK, so `-<num>` is shorthand for `-C NUM` and parse_short_opt keeps parsing
  // the SAME token afterwards. `-2Ocat` is therefore `-2 -O cat`, reaching --open-files-in-pager,
  // which run_pager launches through a shell. Demonstrated live: `-nOecho` was refused while
  // `-2Oecho PWNED` exited 0 and printed, and a second capture wrote a file from outside the
  // repository into the run's own evidence directory.
  //
  // The lesson is about SHAPE, not about adding digits to a character class. Deciding whether to
  // scan from the first character makes every unanticipated opener a bypass, and this module was
  // itself extracted to close exactly this defect one layer up. Scan first, decide after.
  if (!/^-[^-]/.test(t)) return false;

  // Scan the cluster. A value-taking flag swallows the rest of the token, so stopping at the first
  // forbidden character is enough — and scanning past it cannot produce a false NEGATIVE.
  for (const ch of t.slice(1)) {
    if (FORBIDDEN_SHORT.has(ch)) return true;
  }
  return false;
}
