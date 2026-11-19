// `$per_lens_overrides` promised a mechanism half the graph did not have.
//
// The roster says: "Any entry may carry an optional 'model' and/or 'effort' that overrides
// review.models.judgment / review.effort.judgment for that lens alone. Resolution is
// narrowest-first: call site, then this file, then the contract." Two of those sentences were false
// for every BARRIER node:
//
//   - `roster.barrier_nodes` was read in exactly one place in run-graph and only for `.id`, so an
//     override on reconcile, intent-capture, request-capture, reconcile-b or second-opinion was read
//     by nothing at all.
//   - `spawnNode` resolved `effort ?? JUDGMENT_EFFORT` — call site, then contract. The middle rung
//     its own comment described did not exist. Lenses appeared to work only because their override
//     is baked into expected.json upstream and arrives as a CALL-SITE value.
//
// Found by trying to USE it: a measured, operator-approved `effort: low` on second-opinion would
// have sat in the roster reading as adopted while every run continued at the contract's setting.
// An inert declaration is worse than an absent one — it answers "was this adopted?" with a yes that
// nothing enforces.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rosterNodeSetting } from '../scripts/lib/capabilities.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const ROSTER = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'lens-roster.json'), 'utf8'));

test('a barrier node\'s override is readable, not just declarable', () => {
  const roster = {
    lenses: [{ id: 'code-audit' }, { id: 'perf-audit', effort: 'high', model: 'sonnet' }],
    barrier_nodes: [{ id: 'reconcile' }, { id: 'second-opinion', effort: 'low' }],
  };
  assert.deepEqual(rosterNodeSetting(roster, 'second-opinion'), { model: null, effort: 'low' },
    'a barrier node is an entry like any other — this returned nothing for all five of them');
  assert.deepEqual(rosterNodeSetting(roster, 'perf-audit'), { model: 'sonnet', effort: 'high' });
  assert.deepEqual(rosterNodeSetting(roster, 'reconcile'), { model: null, effort: null });
  assert.deepEqual(rosterNodeSetting(roster, 'code-audit'), { model: null, effort: null });
});

test('an unknown node, a bare-string entry and an empty override are all "no override"', () => {
  // Bare ids are legal in barrier_nodes (`n.id ?? n` at the one read site), and carry nothing.
  const roster = { barrier_nodes: ['request-capture', { id: 'reconcile', effort: '   ' }] };
  assert.deepEqual(rosterNodeSetting(roster, 'request-capture'), { model: null, effort: null });
  assert.deepEqual(rosterNodeSetting(roster, 'reconcile'), { model: null, effort: null },
    'whitespace is not a setting; it must fall through to the contract rather than spawn with "   "');
  assert.deepEqual(rosterNodeSetting(roster, 'nobody'), { model: null, effort: null });
  assert.deepEqual(rosterNodeSetting(null, 'x'), { model: null, effort: null });
});

// ADOPTED 2026-09-23 on second-opinion alone, then RETIRED 2026-09-24 when the lens corpus was
// measured and the CONTRACT moved to `low`. Both steps were right in their moment, and the second
// is why the override is gone: this roster's own convention, stated for code-audit, is that once
// the contract carries a value a per-lens override repeating it is "a second owner of one fact".
//
// The test survives the retirement because what it guards is not the override — it is that an
// adopted setting CITES the run that measured it. A value nobody can trace to a result file is an
// assertion, whichever file it lives in.
test('no effort override duplicates the contract, and the retired one kept its evidence', () => {
  const overridden = [...(ROSTER.lenses ?? []), ...(ROSTER.barrier_nodes ?? [])]
    .filter((e) => typeof e === 'object' && e.effort)
    .map((e) => e.id);
  assert.deepEqual(overridden, [],
    'the contract carries the value now; an override repeating it is a second owner of one fact');

  // THE EVIDENCE OUTLIVES THE PIN. second-opinion was measured on the seeded RECONCILIATION-error
  // corpus, which is a different corpus from the lenses' — so if the contract ever rises again,
  // this node's own result is still the reason to re-pin it rather than re-measure from scratch.
  const so = (ROSTER.barrier_nodes ?? []).find((n) => (n.id ?? n) === 'second-opinion');
  const why = String(so.$effort ?? '');
  assert.match(why, /bench\/results\//, 'an adopted setting cites the runs that measured it');
  assert.match(why, /RE-PIN HERE if the contract ever rises/,
    'the retirement must say what would bring the override back, or the evidence is orphaned');

  const contract = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');
  assert.match(contract, /effort: \{ judgment: low \}/,
    'measured 2026-09-24 on the lens corpus: 7/7 both settings, fp 7 -> 1, ADMITTED by dominance');
  assert.match(contract, /bench-admit\.mjs --position lenses/,
    'the contract cites the gate that ruled on it');
});

test('run-graph resolves narrowest-first: call site, then roster, then contract', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  // Not a proxy for behaviour — the resolution ORDER is the behaviour, and it is one expression.
  // It read `effort ?? JUDGMENT_EFFORT` under a comment describing three rungs.
  assert.match(src, /const resolvedEffort = effort \?\? rosterOverride\.effort \?\? JUDGMENT_EFFORT;/);
  assert.match(src, /'--model', model \?\? rosterNodeSetting\(roster, nodeId\)\.model \?\? JUDGMENT_MODEL,/);
});

// The same comment carried a THIRD false sentence, found while verifying the second fix: "Both are
// recorded on nodes/expected.json and on each status file." expected.json is built from
// roster.lenses plus the selected arms — a real run's held 14 rows, 8 lenses and 6 arms, and no
// barrier node. So for reconcile, intent-capture, request-capture, reconcile-b and second-opinion
// the settings live on the status file alone, and the promise of two independent records was half
// true. Corrected rather than implemented: adding barrier nodes to expected.json would change what
// the gate treats as an expected reporter, which is not a comment fix.
test('expected.json covers lenses and arms; barrier nodes are recorded on their status file alone', (t) => {
  const doc = String(ROSTER.$per_lens_overrides ?? '');
  assert.match(doc, /BARRIER NODES ARE NOT IN expected\.json/,
    'the comment must not promise a record that only half the graph has');

  // Against a REAL run rather than the claim's own words — the fixture rule this session earned.
  const dir = path.join(ROOT, '.claude', 'reviews', '20260923-144706-session-bench', 'nodes');
  if (!fs.existsSync(path.join(dir, 'expected.json'))) { t.skip('the real run 20260923-144706-session-bench is absent'); return; }
  const ids = new Set(JSON.parse(fs.readFileSync(path.join(dir, 'expected.json'), 'utf8'))
    .expected.map((n) => n.id ?? n.node_id ?? n.lens ?? ''));
  for (const barrier of ['second-opinion', 'reconcile', 'intent-capture']) {
    assert.ok(!ids.has(barrier), `${barrier} is a barrier node and is not in expected.json`);
  }
  assert.ok(fs.existsSync(path.join(dir, 'second-opinion.status.json')),
    'the status file is the ONLY place a barrier node\'s model and effort are recorded');
});
