// lib/project-profile.mjs, BOUND TO THIS HOST (os-platform-adapters stage 3c). See scripts/io/finding-scope.mjs
// for why this layer exists: lib/ takes `io` as a parameter, and orchestration imports it bound here.
import * as pure from '../lib/project-profile.mjs';
import { hostPlatform } from '../platform/index.mjs';

export * from '../lib/project-profile.mjs';

export const readProfile = (opts = {}) => pure.readProfile({ io: hostPlatform(), ...opts });
export const profileSection = (opts = {}) => pure.profileSection({ io: hostPlatform(), ...opts });
export const listProfiles = (opts = {}) => pure.listProfiles({ io: hostPlatform(), ...opts });
