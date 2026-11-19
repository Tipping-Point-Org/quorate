// G-11 and G-13 of 20261002-215002-stop-child-review (panel-codex-arch, panel-codex-contract). spawnCapture hands back
// what happened to a captured child — a SURVIVOR whose stop was refused or unconfirmed (stopping-a-child stage 2), and the
// bytes it DROPPED past 32 MiB — and no status writer kept either. An arm or adjudicator could outlive its node holding the
// operator's credentials while its tracked status said only "degraded" (A-25: such a child is named with orphan_pid and
// kill_refused or kill_unconfirmed), and a truncated envelope read as complete. The plan promised "its 32 MiB truncation is
// recorded", and the count reached only stderr and the in-memory result.
//
// One owner, capturedStatusFields, turns a captured result into those fields; it is driven below with real captured
// results. The four writers that receive one in run-graph — the two degraded arm stubs, the arm's own status and the
// adjudicator's — are held to calling it, which is source-shaped by necessity: they are run-graph's, and the behaviour they
// carry is the owner's, asserted here directly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { hostPlatform } from '../scripts/platform/index.mjs';

const mod = await import('../scripts/io/spawn-capture.mjs');
const KILLABLE = hostPlatform().proc.killableSpawnOptions();
const node = (code) => [process.execPath, ['-e', code], { ...KILLABLE }];
const fields = (r) => { assert.equal(typeof mod.capturedStatusFields, 'function', 'a captured result has no owner for what a status keeps of it'); return mod.capturedStatusFields(r); };

for (const [outcome, field] of [['refused', 'kill_refused'], ['unconfirmed', 'kill_unconfirmed']]) {
  test(`G-11: a captured child whose stop was ${outcome} is named in the status with its pid and ${field}`, async (t) => {
    const pids = [];
    t.after(() => { for (const p of pids) { try { process.kill(p, 'SIGKILL'); } catch {} } });
    const r = await mod.spawnCapture(...node('setInterval(() => {}, 1000)'), {
      timeoutMs: 200, onSpawn: (c) => pids.push(c.pid), stop: async (child) => ({ outcome, pid: child.pid }),
    });
    const f = fields(r);
    assert.equal(f.orphan_pid, r.survivor.pid, 'the survivor\'s pid is not in the status');
    assert.ok(f[field], `${field} is not in the status: ${JSON.stringify(f)}`);
    assert.equal(f[field === 'kill_refused' ? 'kill_unconfirmed' : 'kill_refused'], undefined, 'both outcomes said at once');
  });
}

test('G-13: output dropped past the cap is recorded in the status, per stream, with the byte counts', async () => {
  const r = await mod.spawnCapture(...node("process.stdout.write('x'.repeat(5000)); process.stderr.write('y'.repeat(3000))"), {
    timeoutMs: 10_000, maxBytes: 1000,
  });
  const f = fields(r);
  assert.equal(f.output_capped, true);
  assert.deepEqual(f.output_dropped_bytes, { stdout: r.capped.stdout, stderr: r.capped.stderr });
  assert.ok(f.output_dropped_bytes.stdout >= 4000 && f.output_dropped_bytes.stderr >= 2000, JSON.stringify(f));
});

test('G-11/G-13: a child that exited whole adds nothing to its status', async () => {
  const r = await mod.spawnCapture(...node("process.stdout.write('ok')"), { timeoutMs: 10_000 });
  assert.deepEqual(fields(r), {});
});

// G-12 of 20261002-215002-stop-child-review: an unavailable arm's reason — which can quote the vendor CLI's stderr — was
// printed to the console unredacted, so a token a vendor echoed into an error reached terminal and CI logs. Deferred at
// first as unrelated, and wrongly: the remediation of G-11/G-13 changed spawnPanelArm, the function it sits in, which makes
// it related under D1. SOURCE-SHAPED by necessity: the line is reached only with a live vendor CLI, and run-graph refuses a
// fake runtime with the panel on. The redaction itself is redactClaim's, tested where it is owned.
test('G-12: no console write in run-graph carries a probe\'s reason unredacted', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'scripts', 'run-graph.mjs'), 'utf8');
  const writes = src.split('\n').filter((l) => /console\.(log|error)\(/.test(l) && /[pP]robe\.reason/.test(l));
  assert.ok(writes.length >= 1, 'the probe-reason console write was not found, so nothing is checked');
  const bare = writes.filter((l) => !/redactClaim\([\w.]*[pP]robe\.reason/.test(l));
  assert.deepEqual(bare, [], `a probe reason reaches the console unredacted:\n${bare.join('\n')}`);
});

test('G-11/G-13: every run-graph status writer that receives a captured result keeps what the owner says', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'scripts', 'run-graph.mjs'), 'utf8');
  const calls = src.split('...capturedStatusFields(r)').length - 1;
  assert.equal(calls, 4, `expected the two degraded arm stubs, the arm's status and the adjudicator's status; found ${calls}`);
  // Each captured result's own writers, by anchor: the spread must sit inside each.
  const between = (from, to) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));
  const noEnvelope = between("writeStatusStub(arm.id, 'DEGRADED', {\n      launched: true, started_at: started, reviewer_answered: false,\n      validator_errors: [`external-review.mjs produced no parseable envelope", 'return;');
  assert.match(noEnvelope, /\.\.\.capturedStatusFields\(r\)/, 'the no-envelope arm stub drops the survivor and the truncation');
});
