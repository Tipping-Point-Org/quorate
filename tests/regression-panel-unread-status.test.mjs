// AN UNREADABLE STATUS DEGRADES ONLY THE PANEL IT BELONGS TO (G-18 of 20261029-201447-rdr-remediation-review,
// panel-codex-arch + panel-codex-code, MEDIUM). run-graph stamped PANEL-DEGRADED, capping the gate at RISK, whenever any
// *.status.json could not be read, a lens's included, and whether or not the mint promised a panel at all: a second
// copy of the stamp rule beside panelDegraded. The decision now has one owner, panelUnread, beside panelDegraded.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const passed = [{ adapter: 'codex', model: 'm', effort: 'e', mode: 'review', route: null, state: 'passed' }];

test('G-18: an unreadable lens status does not degrade the panel; an arm, a judge or the listing does', async () => {
  const mod = await import('../scripts/lib/reviewer-probe.mjs');
  assert.equal(typeof mod.panelUnread, 'function', 'no owner decides whether an unread status degrades the panel');
  const unread = [
    { node: 'code-review', label: 'nodes/code-review.status.json' },
    { node: 'panel-codex-code', label: 'nodes/panel-codex-code.status.json' },
    { node: 'adjudicate-codex', label: 'nodes/adjudicate-codex.status.json' },
    { node: null, label: 'nodes/ (refused)' },
  ];
  const panel = (id) => id === 'panel-codex-code' || id.startsWith('adjudicate-');
  assert.deepEqual(mod.panelUnread({ preflight: passed, unread, panel }),
    ['nodes/panel-codex-code.status.json', 'nodes/adjudicate-codex.status.json', 'nodes/ (refused)']);
});

// A POSITIVE LIST, NOT A NEGATIVE ONE (G-14 of 20261029-224143-rdr-remediation-3-review): nonPanel was derived from the
// lens rows in `expected`, so a node absent from it -- reconcile, reconcile-reask, second-opinion -- counted as a panel
// node when its status could not be read, and spuriously capped the run at RISK as PANEL-DEGRADED.
test('G-14: an unread status of a node that is neither an arm nor a judge does not degrade the panel', async () => {
  const { panelUnread } = await import('../scripts/lib/reviewer-probe.mjs');
  const unread = ['reconcile', 'reconcile-reask', 'second-opinion', 'panel-codex-code']
    .map((n) => ({ node: n, label: `nodes/${n}.status.json` }));
  const panel = (id) => id === 'panel-codex-code' || id.startsWith('adjudicate-');
  assert.deepEqual(panelUnread({ preflight: passed, unread, panel }), ['nodes/panel-codex-code.status.json'],
    'an auxiliary node\'s unread status is counted against the panel');
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  assert.doesNotMatch(src, /nonPanel/, 'run-graph still derives a negative non-panel list');
});

test('G-18: with no panel promised at mint, nothing unread degrades it', async () => {
  const { panelUnread } = await import('../scripts/lib/reviewer-probe.mjs');
  const unread = [{ node: 'panel-codex-code', label: 'nodes/panel-codex-code.status.json' }];
  assert.deepEqual(panelUnread({ preflight: undefined, unread }), []);
  assert.deepEqual(panelUnread({ preflight: [{ ...passed[0], state: 'failed' }], unread }), []);
});

test('G-18: run-graph stamps PANEL-DEGRADED from the owners, never from the raw unread list', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  assert.doesNotMatch(src, /degraded\.length \|\| unread\.length/, 'the raw unread list still stamps the panel');
  assert.match(src, /panelUnread\(\{ preflight: runJson\.reviewer_preflight/);
});
