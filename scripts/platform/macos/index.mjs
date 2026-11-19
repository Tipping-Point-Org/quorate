// MACOS (os-platform-adapters, criterion 3): common + posix. Node calls it `darwin`; the folder is
// named for the operating system a person would look for.
import { commonFs, commonProc, commonAmbient } from '../common/index.mjs';
import { posixProc, POSIX_ENV_BASICS, boundedLaunchFor } from '../posix/index.mjs';

// macOS's /bin/sh counts `ulimit -f` in 1024-byte blocks, not POSIX's 512 (measured on CI run 44220656481; see
// posix/index.mjs): with 512 the 4 GiB disk ceiling was 8 GiB here.
const MACOS_ULIMIT_BLOCK_BYTES = 1024;

export const macos = Object.freeze({
  id: 'darwin',
  name: 'macos',
  // APFS and HFS+ default to case-insensitive. A case-sensitive volume is possible and would read a
  // harmless coexistence as a replacement — recording too much rather than too little.
  caseInsensitiveFs: true,
  // ARG_MAX is 1 MiB on current macOS and counts the environment too; a conservative share of it.
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
  proc: Object.freeze({ ...commonProc, ...posixProc, boundedLaunch: boundedLaunchFor(MACOS_ULIMIT_BLOCK_BYTES) }),
  ...commonAmbient,
});
