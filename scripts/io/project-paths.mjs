// lib/project-paths.mjs, BOUND TO THIS HOST (os-platform-adapters stage 3). See
// scripts/io/finding-scope.mjs for why this layer exists. Injected readers still win, as in lib/.
import * as pure from '../lib/project-paths.mjs';
import { hostPlatform } from '../platform/index.mjs';

export * from '../lib/project-paths.mjs';

export const resolvedRequestsDir = (repoRoot, opts = {}) => pure.resolvedRequestsDir(repoRoot, { ...opts, io: hostPlatform() });
export const shadowedSkills = (opts = {}) => pure.shadowedSkills({ io: hostPlatform(), ...opts });
