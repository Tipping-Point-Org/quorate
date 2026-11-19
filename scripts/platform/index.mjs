// THE ONE PLACE THE OPERATING SYSTEM IS TESTED (os-platform-adapters, criteria 2, 7 and 8).
//
// An entry point calls loadPlatform() once and passes the result down; nothing outside
// scripts/platform/ reads `process.platform`. An operating system with no implementation is an error
// naming it — never a fallback to the nearest one, because a wrong guess about how to kill a process
// tree or whether two filenames are one file is exactly the kind of silent error this engine refuses
// everywhere else.
import { interfaceGaps, FS_MEMBERS, PROC_MEMBERS } from './interface.mjs';
import { win32 } from './win32/index.mjs';
import { linux } from './linux/index.mjs';
import { macos } from './macos/index.mjs';

/** Keyed by Node's `process.platform` value; the value's `name` is its folder. */
export const IMPLEMENTATIONS = Object.freeze({ win32, linux, darwin: macos });

export class UnsupportedPlatformError extends Error {
  constructor(id) {
    const known = Object.values(IMPLEMENTATIONS).map((p) => `${p.name} (${p.id})`).join(', ');
    super(`quorate does not support the operating system '${id}' — implemented: ${known}. `
      + 'Support is added by an implementation under scripts/platform/, not by a fallback.');
    this.name = 'UnsupportedPlatformError';
    this.platform = id;
  }
}

/**
 * The implementation for `id` (default: this host), checked against the interface. Throws
 * UnsupportedPlatformError for an id with none, and a plain Error naming every gap for one that is
 * incomplete — an implementation missing a member would otherwise fail at first use, mid-run.
 */
export function loadPlatform(id = process.platform) {
  const impl = Object.hasOwn(IMPLEMENTATIONS, id) ? IMPLEMENTATIONS[id] : null;
  if (!impl) throw new UnsupportedPlatformError(id);
  const gaps = interfaceGaps(impl);
  if (gaps.length) throw new Error(`platform '${id}' does not implement the interface: ${gaps.join(', ')}`);
  return impl;
}

/**
 * THIS PROCESS'S implementation, instantiated on first use and returned as-is after (criterion 7).
 * The operating system is tested once per process, here; every later caller gets the same object and
 * tests nothing. Each script is its own process, so a check made in the pre-flight cannot be
 * inherited — which is why check-install and preflight make it FIRST, and every other entry point
 * reaches the same function on its first use.
 */
let host = null;
export function hostPlatform() {
  if (!host) host = loadPlatform();
  return host;
}

/**
 * The facts of the platform named by `id` (Node's name), for a decision asked about another operating system than the
 * host's, as capture-interactive's command search is tested for Windows on any host (G-5 of
 * 20261116-221234-m2-9a-high-2). The host's id returns hostPlatform() itself; an id with no implementation throws
 * UnsupportedPlatformError.
 */
export function platformFor(id) {
  if (id === process.platform) return hostPlatform();
  return loadPlatform(id);
}

/**
 * THE HOST'S fs AND proc, RESOLVED AT CALL TIME (os-platform-adapters stage 4).
 *
 * For the orchestration-side I/O modules under scripts/io/, so a call reads `fs.readFileSync(...)`
 * exactly as before. Each member looks the implementation up when it is CALLED, never when the module
 * is imported: preflight and check-install import these modules before they check the operating
 * system, and an import that instantiated the platform would crash with a stack trace on an
 * unsupported one ahead of the clean error (criterion 11). Built from the interface's member lists,
 * so a function the interface does not declare is simply absent here — a loud undefined, not a
 * silent reach past the layer to node:fs.
 */
const lazy = (members, pick) => Object.freeze(Object.fromEntries(
  members.map((k) => [k, (...args) => pick(hostPlatform())[k](...args)]),
));
export const hostFs = lazy(FS_MEMBERS, (p) => p.fs);
export const hostProc = lazy(PROC_MEMBERS, (p) => p.proc);
