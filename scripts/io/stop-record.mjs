// lib/stop-record.mjs, BOUND TO THIS HOST (consumer-owned-configuration.md AC2). The stop guard's block messages are the
// prompt library's (prompts/_templates/stop-guard-blocks.json), since the session reading them is a model; a pure module
// cannot read a file, so they are read here, once, and given to guardDecision. Everything else is the pure module's.
import * as pure from '../lib/stop-record.mjs';
import { readTemplate } from './template.mjs';

export * from '../lib/stop-record.mjs';

export const STOP_BLOCK_MESSAGES = Object.freeze(JSON.parse(readTemplate('stop-guard-blocks.json')));
export const guardDecision = (input, opts = {}) => pure.guardDecision(input, { messages: STOP_BLOCK_MESSAGES, ...opts });
