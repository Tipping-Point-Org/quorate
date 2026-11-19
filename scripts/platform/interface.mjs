// THE PLATFORM INTERFACE — what every operating-system implementation provides, and the one check
// that it does. .claude/requests/os-platform-adapters.md.
//
// The engine outside scripts/platform/ reaches the filesystem, processes, the environment and the
// clock only through an object of this shape, so it never needs to know which operating system it
// is on. The members are the operations the engine actually performs (inventoried in
// os-platform-adapters.plan.md), not everything Node offers: an interface nobody calls is surface
// with nothing holding it honest.
//
// ALL I/O, not only what differs between operating systems today (criterion 6): "only what diuffers
// is a decision that is not sure to be hold in the future". Most members are implemented once in
// common/; the per-OS folders supply what genuinely differs.

/** Identity and the per-OS facts callers decide on. */
export const PLATFORM_FACTS = Object.freeze({
  id: 'string',                    // Node's name — win32 | linux | darwin. reviewers.json keys grants by it.
  name: 'string',                  // the folder — win32 | linux | macos
  caseInsensitiveFs: 'boolean',    // do two names differing only in case land on one file?
  needsShellForShims: 'boolean',   // must an npm .cmd/.ps1 shim be run through a shell?
  transientRenameCodes: 'set',     // rename errors worth retrying (a scanner holding the file)
  maxArgBytes: 'number',           // a conservative budget for one command line's arguments (contract-glob-grammar stage 5)
  // The environment names a command needs to START here, and only those (candidate-check-boundaries.plan.md stage 2):
  // the allow-list a candidate check begins from. Exact names, or a `NAME_*` prefix.
  processEnvBasics: 'array',
  caseInsensitiveEnv: 'boolean',   // are `Path` and `PATH` one environment variable?
  // How a command name is found on PATH with no shell (G-5 of 20261116-221234-m2-9a-high-2): the path rules (`win32` or
  // `posix`, a node:path flavour), PATH's separator, the executable extensions tried when PATHEXT is unset (none: a name is
  // taken as written), and the extensions that are shims, run through the shell where needsShellForShims says so.
  pathFlavor: 'string',
  pathListDelimiter: 'string',
  executableExts: 'array',
  shimExts: 'array',
});

/** Synchronous filesystem primitives, named as Node names them so a call site reads the same. */
export const FS_MEMBERS = Object.freeze([
  'readFileSync', 'writeFileSync', 'existsSync', 'statSync', 'lstatSync', 'realpathSync',
  'readdirSync', 'readlinkSync', 'mkdirSync', 'rmSync', 'renameSync', 'copyFileSync', 'cpSync',
  'symlinkSync', 'openSync', 'readSync', 'fsyncSync', 'closeSync', 'appendFileSync', 'utimesSync',
  // An empty directory's removal, which rmSync does not offer without recursive (G-3 of 20261105-070121-crsf-remediation-2-review).
  'rmdirSync',
  // A replaced file's mode, set on its temporary file before the rename (G-8 of 20261107-195640-co-remediation-2-review).
  'chmodSync',
]);

/**
 * Starting and stopping processes. killTree ends a child AND everything it started, and answers with a promise (delivered
 * true, refused false, not confirmed null), so a caller stopping several starts every kill before it waits for any;
 * killTreeNow is the same act answered synchronously, for an exit hook, which cannot wait (non-blocking-kill.plan.md
 * stage 1, NB-D1 B). isAlive(pid)
 * says whether a process still exists (a lock's holder, G-6). boundedLaunch(cmd, args) returns the
 * command to spawn so that what it writes is bounded on disk, and the ceiling that bounds it — null
 * where none applies (stopping-a-child stage 5, design 4B).
 */
export const PROC_MEMBERS = Object.freeze(['spawn', 'spawnSync', 'killableSpawnOptions', 'killTree', 'killTreeNow', 'isAlive', 'boundedLaunch', 'startedAt']);

/** The ambient values the pure layer must receive rather than read (criterion 5). */
export const AMBIENT_MEMBERS = Object.freeze(['env', 'now', 'cwd', 'homedir', 'tmpdir', 'execPath']);

/**
 * Every way `impl` fails to implement the interface; empty when it does. Returned rather than thrown
 * so a test can name all the gaps at once — one missing member at a time is how a half-built
 * implementation takes three rounds to finish.
 */
export function interfaceGaps(impl) {
  if (!impl || typeof impl !== 'object') return ['not an object'];
  const gaps = [];
  for (const [k, type] of Object.entries(PLATFORM_FACTS)) {
    const v = impl[k];
    const ok = type === 'set' ? v instanceof Set : type === 'array' ? Array.isArray(v) : typeof v === type;
    if (!ok) gaps.push(`${k}: expected ${type}`);
  }
  for (const k of FS_MEMBERS) if (typeof impl.fs?.[k] !== 'function') gaps.push(`fs.${k}`);
  for (const k of PROC_MEMBERS) if (typeof impl.proc?.[k] !== 'function') gaps.push(`proc.${k}`);
  for (const k of AMBIENT_MEMBERS) if (typeof impl[k] !== 'function') gaps.push(k);
  return gaps;
}
