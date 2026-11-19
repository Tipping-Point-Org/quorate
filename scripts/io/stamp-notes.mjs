// lib/stamp-notes.mjs, BOUND TO THIS HOST. See scripts/io/finding-scope.mjs for why this layer exists.
import * as pure from '../lib/stamp-notes.mjs';
import { hostPlatform } from '../platform/index.mjs';

export * from '../lib/stamp-notes.mjs';

export const stampConsequence = (stamp) => pure.stampConsequence(stamp, hostPlatform());
export const explainedStamps = () => pure.explainedStamps(hostPlatform());
