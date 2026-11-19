// lib/review-prompts.mjs, BOUND TO THIS HOST. See scripts/io/finding-scope.mjs for why this layer
// exists. Renamed from codex-prompts.mjs (G-21 of 20260925-015614-platform-review): it builds the
// prompts every external reviewer and every judge receives, whichever vendor runs them, so it is named
// for the review operation (consumer-owned-configuration AC 7). Template loading and stamp notes left
// it first, for io/template.mjs and io/stamp-notes.mjs (AC 6: cut the coupling, then rename).
//
// Also the home of the three template constants lib/ used to read AT LOAD TIME. A module load cannot
// be handed `io`, so they are read here, once, for the host — the same text, and still one owner:
// the templates under prompts/_templates/.
import * as pure from '../lib/review-prompts.mjs';
import { hostPlatform } from '../platform/index.mjs';
import { readTemplate } from './template.mjs';

export * from '../lib/review-prompts.mjs';

export const schemaField = (name) => pure.schemaField(name, hostPlatform());
export const vendorLabel = (reviewer, table = null) => pure.vendorLabel(reviewer, table, hostPlatform());
export const stripCaptureSection = (brief) => pure.stripCaptureSection(brief, hostPlatform());
export const inlineIntentSection = (brief, criteria, opts = {}) =>
  pure.inlineIntentSection(brief, criteria, { ...opts, io: hostPlatform() });
export const buildArmShadowPrompt = (opts) => pure.buildArmShadowPrompt({ ...opts, io: hostPlatform() });
export const buildTieBreakPrompt = (opts) => pure.buildTieBreakPrompt({ ...opts, io: hostPlatform() });
export const buildClaimCheckArmPrompt = (opts) => pure.buildClaimCheckArmPrompt({ ...opts, io: hostPlatform() });
export const buildDecisionSeatPrompt = (opts) => pure.buildDecisionSeatPrompt({ ...opts, io: hostPlatform() });
export const buildDecisionModeratorPrompt = (opts) => pure.buildDecisionModeratorPrompt({ ...opts, io: hostPlatform() });
export const buildRevoteAuthorPrompt = (opts) => pure.buildRevoteAuthorPrompt({ ...opts, io: hostPlatform() });
export const buildClaimCheckSameFamilyBrief = (opts) => pure.buildClaimCheckSameFamilyBrief({ ...opts, io: hostPlatform() });
export const censusSection = (opts) => pure.censusSection({ ...opts, io: hostPlatform() });

export const BRIEF_FEEDBACK = readTemplate('brief-feedback.md');
export const EXTERNAL_ARM_CONSTRAINTS = readTemplate('external-arm-constraints.md');
export const TIE_BREAK_CONSTRAINTS = readTemplate('tie-break-constraints.md');
