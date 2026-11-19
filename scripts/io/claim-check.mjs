// lib/claim-check.mjs, BOUND TO THIS HOST: a citation is resolved against the real filesystem.
import * as pure from '../lib/claim-check.mjs';
import { hostPlatform } from '../platform/index.mjs';

export * from '../lib/claim-check.mjs';

export const resolveCitation = (citation, opts) => pure.resolveCitation(citation, { ...opts, io: hostPlatform() });
export const applyClaimRules = (result, opts) => pure.applyClaimRules(result, { ...opts, io: hostPlatform() });
