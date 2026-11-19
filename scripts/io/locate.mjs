// lib/locate.mjs, BOUND TO THIS HOST (os-platform-adapters stage 3). See scripts/io/finding-scope.mjs
// for why this layer exists. An injected `exists` still wins, exactly as it does in lib/.
import * as pure from '../lib/locate.mjs';
import { hostPlatform } from '../platform/index.mjs';

export * from '../lib/locate.mjs';

export const resolveFrameworkDirs = (dir, opts = {}) => pure.resolveFrameworkDirs(dir, { io: hostPlatform(), ...opts });
export const nodeInstructions = (dirs, nodeId, opts = {}) => pure.nodeInstructions(dirs, nodeId, { io: hostPlatform(), ...opts });
