// EVERY TIE-BREAK THE ORCHESTRATOR EVER SPAWNED WAS REFUSED BEFORE THE VENDOR WAS CONTACTED.
//
// run-graph composes the adjudicator's node id as `tiebreak-${group.group_id}`. Group ids are
// minted as `G-${n}` and the schema pins that shape (`^G-[0-9]{1,3}$`), so the id is `tiebreak-G-17`
// -- and NODE_ID_RE was `/^[a-z0-9-]+$/`. external-review refused it at argument-parse time: exit 2,
// nothing on stdout, no envelope, 0.1 seconds, before any reviewer was reached.
//
// Downstream that read as DEGRADED with `ruling: null`, which is indistinguishable from a vendor
// that was unreachable -- and three separate `try { JSON.parse(r.stdout) } catch` blocks threw the
// exit code and the stderr away, so nothing recorded the refusal. Both disputes in the first
// consumer-mount run came back that way.
//
// It survived because the path is the rarest in the system -- this repository has produced a
// genuine dispute twice in its entire history -- and because check-tiebreak.mjs, written precisely
// because "nothing else ever does", passes its own LOWERCASE node id. It exercised the prompt, the
// argv, the transport and the envelope, and the one thing it could not see was the id the
// orchestrator would really have sent.
//
// The lowercase restriction was incidental: the rule exists to refuse `.`, `/` and `\`, and every
// node id anyone had in mind when it was written happened to be lowercase.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from './helpers.mjs';
import { NODE_ID_RE, GROUP_ID_RE } from '../scripts/lib/decisions.mjs';
import { adjudicationBrief } from '../scripts/lib/adjudication.mjs';

test('regression: the node id run-graph composes for a tie-break is one external-review accepts', () => {
  // ASKED OF THE OWNER, BY RUNNING IT. This used to match the template literal in run-graph, which
  // meant the assertion went red for the RIGHT change — moving the format into one helper the probe
  // and the orchestrator both call — while it could never have gone red for a format the engine
  // actually composed at runtime. The id is now derived here the way both call sites derive it.
  const graph = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  assert.match(graph, /brief\.nodeId\(judgeId\)/,
    'run-graph must take the id from the shared brief, not compose its own');
  assert.equal(adjudicationBrief({ group: { group_id: 'G-17' } }).nodeId('agy'), 'adjudicate-G-17-agy');
  // THE DECLARED ID, NOT THE TRANSPORT NAME. Built from `judge.reviewer`, two judges on one adapter
  // collided on the node id, the evidence directory and the merge key -- silently one judge.
  assert.match(graph, /const judgeId = judge\.id \?\? judge\.reviewer;/,
    'the roster declares an id per judge and it must be what names the node');

  // THE SCHEMA RENDERS THE OWNER'S PATTERN (G-38). This read the literal out of spawn-node, which is
  // the copy that existed because the shape was typed three times — schema, runtime re-validation,
  // renderer. The schema is built from GROUP_ID_RE now, so the assertion is that it is.
  const spawnNode = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'spawn-node.mjs'), 'utf8');
  assert.match(spawnNode, /group_id: \{ type: 'string', pattern: GROUP_ID_RE\.source \}/,
    'the envelope schema must pin the shape the engine validates, not a second copy of it');
  assert.equal(GROUP_ID_RE.source, '^G-[0-9]{1,3}$', 'and the shape itself is still what runs are minted with');

  for (const n of [1, 17, 32, 999]) {
    const groupId = `G-${n}`;
    assert.ok(NODE_ID_RE.test(adjudicationBrief({ group: { group_id: groupId } }).nodeId('agy')),
      `external-review refuses --node-id adjudicate-${groupId}-agy, so this adjudication never reaches a `
      + 'reviewer and reads downstream as an unreachable one');
  }
});

test('widening to uppercase did not widen it to anything dangerous', () => {
  // The rule's actual job. `A-Z` carries no separator and no dot, which is the whole refusal.
  for (const bad of [
    '../escape', 'a/b', 'a\b', '.', '..', 'a.b', 'a b', '', 'a/../b', 'C:/x', 'a\u0000b',
  ]) {
    assert.equal(NODE_ID_RE.test(bad), false, `${JSON.stringify(bad)} must still be refused`);
  }
  // And the ids the system actually uses all pass, in both cases.
  for (const ok of ['code-audit', 'panel-codex-arch', 'adjudicate-G-1-agy', 'second-opinion', 'G-17']) {
    assert.ok(NODE_ID_RE.test(ok), `${ok} must be accepted`);
  }
});

test('regression: the tie-break probe sends an id of the shape run-graph really sends', async () => {
  // The probe exists because nothing else exercises this path, and it used a lowercase id of its
  // own -- so it covered the prompt, the argv, the transport and the envelope, and could not see
  // the one thing that was broken. A probe whose input differs from production in the one dimension
  // that fails is worse than no probe: it reports the path as exercised.
  // The probe was check-tiebreak.mjs; since reviewer-preflight stage 4 it is external-review's tie-break probe.
  const er = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'external-review.mjs'), 'utf8');
  // From probeInput, which builds the probe's input for runProbe and for a --probe-run child's check (G-2 of
  // 20261020-172345-argv-remediation-review), through the end of runProbe.
  const src = er.slice(er.indexOf('function probeInput('), er.indexOf('\n}\n', er.indexOf('function runProbe(')));
  // NOT A LITERAL AND NOT A TEMPLATE — THE SHARED OWNER. Both earlier versions of this guard read
  // the id out of the probe's source, which is only ever evidence that the two spellings agreed on
  // the day someone typed them. The probe now calls the same helper run-graph calls, so the guard is
  // that it does, plus the helper's own behaviour above.
  assert.match(src, /'--node-id', brief\.nodeId\(/,
    'the probe must take its node id from the shared brief, not spell one of its own');
  assert.match(src, /const brief = adjudicationBrief\(\{ group, excerpt: group\.excerpt \}\)/,
    'and the brief must be built from the probe group, so a missing group_id throws instead of defaulting');

  // THE GROUP OBJECT IS PRODUCTION-SHAPED. It spelled the key `groupId`, the prompt builder's
  // parameter name, so the brief helper found no group id and used its own default — which happened
  // to be the same string. The probe agreed with production by coincidence, inside the helper added
  // to stop them diverging.
  const { probeDispute } = await import('../scripts/lib/reviewer-probe.mjs');
  assert.match(probeDispute({ armSource: 'codex', armNodeId: 'panel-codex-code' }).group_id ?? '', /^G-\d+$/,
    'the probe group must carry group_id, the key a real finding-group carries');
  assert.throws(() => adjudicationBrief({ group: { groupId: 'G-3' } }).nodeId('agy'), /group_id is required/,
    'a group that cannot name itself must not be given a default name: two of them would collide '
    + 'on one evidence directory and merge as one judge');
  assert.throws(() => adjudicationBrief({ group: { group_id: 'G-3' } }).nodeId(), /judge id is required/);
});

test("regression: a tie-break's record can tell a refusal from a slow answer", () => {
  // Investigating the two DEGRADED adjudications, the record gave `ended_at` and nothing else. Two
  // timestamps three milliseconds apart read equally well as two concurrent calls finishing
  // together and as two processes refused instantly -- and it was the second. The exit code, which
  // said `2` and would have named the problem outright, was discarded with everything else.
  const graph = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  const block = graph.slice(graph.indexOf('const nodeId = brief.nodeId('));
  assert.match(block, /const tbStartedAt = new Date\(\)\.toISOString\(\)/);
  assert.match(block, /started_at: tbStartedAt, ended_at:/,
    'without a start there is no duration, and duration is what separates the two failures');
  assert.match(block, /exit_code: r\.status/,
    'a non-zero exit means it refused before reaching a reviewer -- a different problem entirely');
});

// RETIRED WITH check-tiebreak.mjs (reviewer-preflight stage 4): `.claude/tiebreak-check.json` was machine-local and
// ignored. A judge's probe is now a record per combination under the engine's home, outside every repository, keyed by
// host among the rest (scripts/io/reviewer-probe.mjs).

test('regression: the tie-break status object EVALUATES — a scope error made it write nothing', () => {
  // `tbStartedAt` was declared in the PREPARATION loop and read inside the runPool worker, a sibling
  // scope, and not carried in the prepared payload. Every tie-break threw `ReferenceError:
  // tbStartedAt is not defined`; runPool rethrew, the enclosing catch printed "tie-break failed"
  // and NO status file was written for any disputed group -- strictly worse than the
  // DEGRADED-with-null-ruling it replaced, because a promised node left no artifact at all.
  //
  // My own regression for that change asserted `/started_at: tbStartedAt/` against the source and
  // passed, because nothing offline executes this path and a source-shape assertion cannot see a
  // scope error. check-syntax parses it; a ReferenceError is not a parse error. code-audit caught it
  // on the sweep of the very commit that introduced it.
  //
  // So this test EVALUATES the object literal, with the same names bound the worker binds, and
  // nothing else. It fails on a name the worker cannot see.
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  const worker = src.slice(src.indexOf('await runPool(prepared,'), src.indexOf('let ruling ='));
  assert.ok(worker.length > 200, 'could not isolate the tie-break worker');

  // Every identifier the status literal reads must be bound inside the worker or be a parameter of
  // it. Declared-in-the-worker is what the fix changed; the prep loop is NOT in scope here.
  assert.match(worker, /const tbStartedAt = new Date\(\)\.toISOString\(\)/,
    'the start timestamp must be captured in the worker, where the spawn happens');

  const prepLoop = src.slice(src.indexOf('const prepared = []'), src.indexOf('await runPool(prepared,'));
  assert.ok(!/const tbStartedAt =/.test(prepLoop),
    'a value the worker reads cannot be declared in the preparation loop -- that is the sibling '
    + 'scope whose ReferenceError left every disputed group with no status file');

  // EVERY PER-DISPUTE VALUE THE WORKER READS MUST BE BOUND IN THE WORKER. Narrowed to the `tb*`
  // family on purpose: those are precisely the values computed once per adjudication, which is the
  // class that can be written in the prep loop and read here. A whole-identifier sweep over this
  // block reads every word out of its comments and proves nothing.
  const code = worker
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
    .replace(/`(?:[^`\\]|\\.)*`|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, "''");
  const params = /async \(\{([^}]*)\}\)/.exec(worker)?.[1] ?? '';
  const declared = new Set([
    ...[...code.matchAll(/\bconst\s+([a-zA-Z_$][\w$]*)/g)].map((m) => m[1]),
    ...params.split(',').map((x) => x.trim()).filter(Boolean),
  ]);
  // DERIVED FROM THE PREPARATION LOOP, NOT ENUMERATED. This was a hand-written list — first the `tb*`
  // family, then widened to name `judge`, `participants` and `party` — and a hand-written list omits
  // the next name by construction. It omitted `judgeId`, which is declared in the prep loop and read
  // four times in the worker, so every adjudication in a live consumer run threw
  // `ReferenceError: judgeId is not defined` before it could write a status, three workers at a time,
  // while this guard stayed green. The third occurrence of one defect class, each time in a name the
  // previous fix had not thought of.
  //
  // So the list IS the prep loop's own `const` declarations: anything it computes per (group, judge)
  // and the worker reads must be bound in the worker. That cannot fall behind the code, because it is
  // read out of the code.
  // THE LOOP BODY, not the block around it. `prepLoop` starts at `const prepared = []` and therefore
  // also contains the SHARED accumulators declared beside it — `votesByGroup`, `adjudicationCost`,
  // `prepared` itself — which the worker reads on purpose. A per-dispute value is one declared INSIDE
  // the iteration, which is where this slice starts.
  const prepCode = src.slice(src.indexOf('for (const g of toAdjudicate)'), src.indexOf('prepared.push({'))
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const perDispute = [
    ...new Set([
      ...[...prepCode.matchAll(/\bconst\s+([a-zA-Z_$][\w$]*)\s*=/g)].map((m) => m[1]),
      // Destructured in the prep loop too, e.g. `const { env: tbEnv, passed: tbPassed } = ...`.
      ...[...prepCode.matchAll(/\bconst\s*\{([^}]*)\}\s*=/g)]
        .flatMap((m) => m[1].split(',').map((x) => x.split(':').pop().trim()))
        .filter(Boolean),
      'g', 'src', 'judge', // the loop variables themselves
    ]),
  ];
  assert.ok(perDispute.length > 8,
    `only ${perDispute.length} per-dispute names found — the prep loop slice stopped matching`);
  const read = new Set(perDispute.filter((n) => new RegExp(`\\b${n}\\b`).test(code)));
  const unbound = [...read].filter((n) => !declared.has(n)).sort();
  assert.deepEqual(unbound, [],
    `the worker reads ${unbound.join(', ')} without binding it — that is the ReferenceError shape: `
    + 'declared in the preparation loop, read in a sibling scope, and invisible to check-syntax');
});
