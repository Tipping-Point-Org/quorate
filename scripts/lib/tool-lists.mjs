// An adapter's node_runtime TOOL LISTS: their one declared shape, the check that refuses any other, and the one accessor
// every reader goes through (adapter-tool-lists.plan.md stage 1; design decided, operator 2026-10-26: "C B").
//
// WHY ONE OWNER. Each reader decided shape itself — a local listOf, an Array.isArray, a bare spread — so each remediation
// of runtime-call-telemetry fixed one list and the next review found the one beside it: deny_intent's completeness, then
// deny_intent's and deny_always's type, then shell_tools, whose bare spread threw a TypeError on `{ default: 1 }` instead
// of refusing the adapter by name (G-3 of 20261026-194518-rct-remediation-3-review). Here the shape is declared once:
// adapterErrors refuses anything else where it runs, and toolList never throws, for a reader reached any other way.
//
// Pure: no I/O. The platform ids are the platform layer's (scripts/platform/index.mjs, IMPLEMENTATIONS), which lib/ may
// not import; a test holds the two equal.

/** The platform ids a `shell_tools` key may name, besides `default` and a `$` comment key. */
export const PLATFORM_IDS = Object.freeze(['win32', 'linux', 'darwin']);

/** Every tool list, by the block of `node_runtime` it lives in. A list absent here is read by no one. */
export const TOOL_LISTS = Object.freeze({
  deny_always: 'tools', deny_intent: 'tools', edit_tools: 'tools', lens_allow: 'tools', name_tools: 'tools',
  content_tools: 'grants', shell_tools: 'grants',
});

/** AT-D2 B: a list is an array of non-empty strings. */
export const isToolList = (v) => Array.isArray(v) && v.every((t) => typeof t === 'string' && t.trim() !== '');

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isComment = (k) => k.startsWith('$');

function rawOf(adapter, key) {
  const block = TOOL_LISTS[key];
  if (!block) throw new Error(`tool-lists: '${key}' is not a declared tool list (${Object.keys(TOOL_LISTS).join(', ')})`);
  return adapter?.node_runtime?.[block]?.[key];
}

/**
 * Every malformed tool list of this adapter, as a named reason, or []. An absent list is not malformed: a capability that
 * needs it says so (unbackedCapabilities).
 */
export function toolListErrors(name, adapter) {
  const errs = [];
  for (const [key, block] of Object.entries(TOOL_LISTS)) {
    const v = rawOf(adapter, key);
    if (v === undefined) continue;
    const at = `node_runtime.${block}.${key}`;
    if (key !== 'shell_tools') {
      if (!isToolList(v)) errs.push(`runtime '${name}': ${at} must be an array of non-empty strings, got ${JSON.stringify(v)}`);
      continue;
    }
    if (!isPlainObject(v)) {
      errs.push(`runtime '${name}': ${at} must be an object keyed by platform id (${PLATFORM_IDS.join(', ')}) or default, got ${JSON.stringify(v)}`);
      continue;
    }
    for (const [k, list] of Object.entries(v)) {
      if (isComment(k)) continue;
      if (k !== 'default' && !PLATFORM_IDS.includes(k)) {
        errs.push(`runtime '${name}': ${at} has key '${k}', which is no platform id (${PLATFORM_IDS.join(', ')}) and not default`);
      } else if (!isToolList(list)) {
        errs.push(`runtime '${name}': ${at}.${k} must be an array of non-empty strings, got ${JSON.stringify(list)}`);
      }
    }
  }
  return errs;
}

/**
 * The tool list `key` of this adapter, as a fresh array of strings. NEVER THROWS: a malformed or absent list reads as
 * empty, so a reader the refusal did not reach cannot crash or split a string into characters. `shell_tools` needs the
 * platform, whose list is used if it has one, else `default`'s.
 */
export function toolList(adapter, key, platform) {
  const v = rawOf(adapter, key);
  if (key !== 'shell_tools') return isToolList(v) ? [...v] : [];
  if (!isPlainObject(v)) return [];
  const own = typeof platform === 'string' && PLATFORM_IDS.includes(platform) && Object.hasOwn(v, platform) ? v[platform] : undefined;
  const list = own !== undefined ? own : v.default;
  return isToolList(list) ? [...list] : [];
}

/** The platform keys `shell_tools` declares (well-formed ones, comments dropped), or ['default'] when it declares none. */
export function shellToolKeys(adapter) {
  const v = rawOf(adapter, 'shell_tools');
  const keys = isPlainObject(v) ? Object.keys(v).filter((k) => !isComment(k) && (k === 'default' || PLATFORM_IDS.includes(k))) : [];
  return keys.length ? keys : ['default'];
}
