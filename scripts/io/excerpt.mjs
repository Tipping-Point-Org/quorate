// lib/excerpt.mjs, BOUND TO THIS HOST (os-platform-adapters stage 3). See scripts/io/finding-scope.mjs
// for why this layer exists: lib/ takes `io` as a parameter, and orchestration imports it bound here.
import * as pure from '../lib/excerpt.mjs';
import { hostPlatform } from '../platform/index.mjs';

export * from '../lib/excerpt.mjs';

export const readExcerpt = (opts) => pure.readExcerpt({ ...opts, io: hostPlatform() });
