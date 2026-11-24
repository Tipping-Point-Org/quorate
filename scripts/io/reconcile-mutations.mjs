// lib/reconcile-mutations.mjs, BOUND TO THIS HOST (consumer-owned-configuration.md AC2). The bench forge's mutation prose
// is the prompt library's (prompts/_templates/forge-slots.json), since the forge reading it is a model; a pure module
// cannot read a file, so it is read here and given to forgeSlots and forgeFileRule.
//
// ON FIRST USE, NOT AT IMPORT: the bench's no-spend paths import this module and never forge, and a framework copy made
// for them (tests/tools/bench-fixture.mjs) carries no prompts/; reading the template at load failed those paths for a
// file they never use.
import * as pure from '../lib/reconcile-mutations.mjs';
import { readTemplate } from './template.mjs';

export * from '../lib/reconcile-mutations.mjs';

let texts = null;
/** The forge's texts, read once on first use. */
export const forgeTexts = () => (texts ??= Object.freeze(JSON.parse(readTemplate('forge-slots.json'))));
export const forgeSlots = (opts) => pure.forgeSlots(opts, forgeTexts());
export const forgeFileRule = (opts) => pure.forgeFileRule(opts, forgeTexts());

// THE GROUND-TRUTH STATEMENTS, the same way (G-1 of 20261121-043112-ac2-delivery): each is shown to the judge, a model, so
// its words are prompts/_templates/ground-truth-statements.json's, read on the first mutation applied.
let statements = null;
const statementTexts = () => (statements ??= Object.freeze(JSON.parse(readTemplate('ground-truth-statements.json'))));
export const applyMisanchor = (opts) => pure.applyMisanchor(opts, statementTexts());
export const applyDeflate = (opts) => pure.applyDeflate(opts, statementTexts());
export const applyDrop = (opts) => pure.applyDrop(opts, statementTexts());
