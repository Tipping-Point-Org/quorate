// arch-review's degraded reason said "reviewed against observed conventions only" while its degraded_basis is
// [convention, invariant], so not_checked[] told the reader the lens was narrower than it is (G-32 of
// 20261122-035227-m3s7-b3-review). The reason must name every basis the degraded lens may still cite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const roster = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'lens-roster.json'), 'utf8'));

test("arch-review's degraded reason names every degraded basis and claims no 'only' it does not hold", () => {
  const arch = roster.lenses.find((l) => l.id === 'arch-review');
  assert.ok(arch, 'arch-review is in the roster');
  const reason = arch.degraded_not_checked.reason;
  for (const b of arch.degraded_basis) assert.match(reason, new RegExp(b), `reason omits degraded basis ${b}: ${reason}`);
  assert.doesNotMatch(reason, /conventions only/);
});

test("the contract owner's degraded arch-review sentence names the invariant basis the roster keeps", () => {
  // G-20 of 20261122-044843-m3s7-b3-remediation-review: shared/claude-md-contract.md still said "observed conventions
  // only" after the roster kept [convention, invariant], so the owner doc hid the non-waivable invariant path.
  const doc = fs.readFileSync(path.join(ROOT, 'shared', 'claude-md-contract.md'), 'utf8');
  const para = doc.match(/\*\*Degradation is explicit and never silent\.\*\*[\s\S]*?\r?\n\r?\n/);
  assert.ok(para, 'the degradation paragraph was not found');
  assert.doesNotMatch(para[0], /conventions only/, para[0]);
  const arch = roster.lenses.find((l) => l.id === 'arch-review');
  for (const b of arch.degraded_basis) assert.match(para[0], new RegExp(b), `the owner omits degraded basis ${b}:\n${para[0]}`);
});
