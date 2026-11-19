// Whether a CLI the engine runs has been due an update for days (autonomous-run.plan.md stage 7; autonomous-run.md
// criterion 13: "report if CLI needs to be updated after a few days without it"). It only REPORTS: updating a CLI
// changes the operator's environment (shared/session-rules.md, "What waits for the operator"), and a pinned CLI stays
// pinned until the operator moves it. The CLIs checked are derived from the adapter table and the roster, never listed
// here (A-9).
//
// Pure: no I/O, no clock (ARCHITECTURE §2). The installed and published versions, and today's date, are arguments.

/** Days a CLI must have been behind before it is reported. Stated in shared/session-rules.md, "A long run". */
export const DUE_AFTER_DAYS = 3;

/**
 * How long a started refresh is taken as in flight (G-2 of 20261105-013235-ar-d1-c-remediation-review): a turn start in
 * that window starts none, and a refresh that died before writing the cache is retried after it, never on every turn.
 */
export const REFRESH_RETRY_MINUTES = 10;

/** The adapter declarations a cache was computed for, as one comparable string: a cache answers only for its own table. */
// A declared review.runtime is part of the key (contract-runtime-and-session-files.plan.md stage 1): it changes which
// adapter is the node runtime, so a cache computed under another one does not answer. Absent, the key is unchanged.
export const tableKey = (declared, runtime = null) => {
  const base = JSON.stringify(Object.keys(declared ?? {}).sort().map((k) => [k, declared[k]]));
  return typeof runtime === 'string' && runtime ? `${base}|runtime=${runtime}` : base;
};

/** Whether a cache is today's answer for this table. A cache from before the key was recorded served the bare table. */
export const cacheTableKey = (cache) => cache?.table_key ?? tableKey({});
export const freshnessCurrent = (cache, { today, key }) => cache?.checked_day === today && cacheTableKey(cache) === key;

/** Whether a hook should start a refresh: the cache is not current, and no refresh of this table started recently. */
export function refreshWanted(cache, { today, key, nowMs }) {
  if (freshnessCurrent(cache, { today, key })) return false;
  const started = Date.parse(cache?.refresh_started_at ?? '');
  return !(Number.isFinite(started) && cache.refresh_key === key && nowMs - started >= 0 && nowMs - started < REFRESH_RETRY_MINUTES * 60_000);
}

/** The first `x.y.z` in a CLI's output (`2.1.316 (Claude Code)`, `codex-cli 0.163.0`, `1.4.12`), or null. */
export function parseVersion(output) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(output ?? ''));
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
}

/** -1, 0 or 1, numerically per part. */
export function compareVersions(a, b) {
  const pa = a.split('.').map(Number); const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  return 0;
}

/**
 * One adapter's entry after today's check. `installed` and `latest` are raw outputs (or null when the command is not
 * declared or failed). Behind is dated the first day it is seen, and the date is kept while it stays behind; either
 * version unknown is `not-checked`, never `current`.
 */
export function freshnessStep(prev, { installed, latest, today }) {
  const i = parseVersion(installed); const l = parseVersion(latest);
  // A day that could not compare keeps the date it was behind since (G-8 of 20261105-004603-ar-d1-c-review): one failed
  // query must not restart the clock, or a query failing every few days keeps the CLI from ever being reported.
  const kept = (prev?.state === 'behind' || prev?.state === 'not-checked') && prev.behind_since ? prev.behind_since : null;
  if (!i || !l) return { installed: i, latest: l, state: 'not-checked', ...(kept ? { behind_since: kept } : {}) };
  if (compareVersions(i, l) >= 0) return { installed: i, latest: l, state: 'current' };
  const since = kept ?? today;
  return { installed: i, latest: l, state: 'behind', behind_since: since };
}

const dayNumber = (d) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86_400_000);

/** The adapters behind for at least DUE_AFTER_DAYS on `today`, with how many days. */
export function dueClis(cache, today, days = DUE_AFTER_DAYS) {
  return Object.entries(cache?.adapters ?? {})
    .filter(([, e]) => e?.state === 'behind' && e.behind_since)
    .map(([name, e]) => ({ name, installed: e.installed, latest: e.latest, since: e.behind_since, days: dayNumber(today) - dayNumber(e.behind_since) }))
    .filter((d) => d.days >= days);
}

/**
 * THE CLIs TO CHECK: the node runtime, then every reviewer the roster calls — panel arms, adjudicators, proposers, the
 * claim checker and the decision panel's seats — each once, in that order.
 */
export function freshnessAdapters({ defaultNodeRuntime, roster }) {
  const names = [defaultNodeRuntime];
  const r = roster ?? {};
  for (const a of r.panel_arms ?? []) names.push(a?.reviewer);
  for (const a of r.adjudicators ?? []) names.push(a?.reviewer);
  for (const name of Object.keys(r.proposers ?? {})) if (!name.startsWith('$')) names.push(name);
  names.push(r.claim_checker?.reviewer);
  for (const s of r.decision_panel?.seats ?? []) names.push(s?.reviewer);
  return [...new Set(names.filter((n) => typeof n === 'string' && n))];
}
