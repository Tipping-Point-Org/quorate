// LINUX (os-platform-adapters, criterion 3): common + posix, with case-sensitive filenames.
import { commonFs, commonProc, commonAmbient } from '../common/index.mjs';
import { posixProc, POSIX_ENV_BASICS } from '../posix/index.mjs';

export const linux = Object.freeze({
  id: 'linux',
  name: 'linux',
  caseInsensitiveFs: false,
  // ARG_MAX is typically 2 MiB but counts the environment too; a conservative share of it.
  maxArgBytes: 100_000,
  needsShellForShims: false,
  processEnvBasics: POSIX_ENV_BASICS,
  caseInsensitiveEnv: false,
  pathFlavor: 'posix',
  pathListDelimiter: ':',
  executableExts: Object.freeze([]),
  shimExts: Object.freeze([]),
  transientRenameCodes: new Set(),
  fs: commonFs,
  proc: Object.freeze({ ...commonProc, ...posixProc }),
  ...commonAmbient,
});
