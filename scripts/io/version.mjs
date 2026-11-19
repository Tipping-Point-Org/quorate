// lib/version.mjs, BOUND TO THIS HOST (os-platform-adapters stage 3c). See scripts/io/finding-scope.mjs
// for why this layer exists: lib/ takes `io` as a parameter, and orchestration imports it bound here.
import * as pure from '../lib/version.mjs';
import { hostPlatform } from '../platform/index.mjs';
import { gitSync } from './git.mjs';

export * from '../lib/version.mjs';

export const frameworkStamp = (root, opts = {}) => pure.frameworkStamp(root, { ...opts, io: { ...hostPlatform(), git: gitSync } });
