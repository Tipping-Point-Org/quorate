// lib/finding-scope.mjs, BOUND TO THIS HOST (os-platform-adapters stage 3).
//
// lib/ does no I/O of its own: its functions that must ask the filesystem take the platform
// implementation as `io`. The orchestration scripts import from here instead, where that parameter
// is supplied once — so their call sites read exactly as before, and the operating system is still
// tested only where the implementation is instantiated (criterion 7). Everything that needs no I/O is
// re-exported unchanged; only the I/O functions are wrapped.
import * as pure from '../lib/finding-scope.mjs';
import { hostPlatform } from '../platform/index.mjs';

export * from '../lib/finding-scope.mjs';

export const countLines = (p) => pure.countLines(p, hostPlatform());
export const escapesAfterRealpath = (root, abs) => pure.escapesAfterRealpath(root, abs, hostPlatform());
export const evidenceOwnershipError = (runDir, nodeId, evidencePath) =>
  pure.evidenceOwnershipError(runDir, nodeId, evidencePath, hostPlatform());
export const escapesBeforeCreate =(root, abs) => pure.escapesBeforeCreate(root, abs, hostPlatform());
export const findingScopeErrors = (f, opts) => pure.findingScopeErrors(f, { ...opts, io: hostPlatform() });
export const isWithin = (parent, child) => pure.isWithin(parent, child, { caseInsensitive: hostPlatform().caseInsensitiveFs });
// By the host's case rule, as isWithin is (G-2 of 20261105-154708-crsf-remediation-5-review).
export const relativeBelow = (parent, child) => pure.relativeBelow(parent, child, { caseInsensitive: hostPlatform().caseInsensitiveFs });
export const firstLeadingOut = (dir, mode) => pure.firstLeadingOut(dir, mode, hostPlatform());
export const LEADS_OUT_KIND = pure.LEADS_OUT_KIND;
export const firstLinkLeaving = (dir) => pure.firstLinkLeaving(dir, hostPlatform());
export const firstLinkInto = (dir, into) => pure.firstLinkInto(dir, into, hostPlatform());
export const firstLinkOnto = (dir, onto) => pure.firstLinkOnto(dir, onto, hostPlatform());
export const linkForms =(p) => pure.linkForms(p, hostPlatform());
export const canonicalSpelling = (p) => pure.canonicalSpelling(p, hostPlatform());
export const rootSpelling = (p) => pure.rootSpelling(p, hostPlatform());
export const belowRoot = (root, p) => pure.belowRoot(root, p, hostPlatform());
export const isBelowRoot = (root, p) => pure.isBelowRoot(root, p, hostPlatform());
export const withinThroughLinks = (parent, child) => pure.withinThroughLinks(parent, child, hostPlatform());
