// A FINDING CANNOT CITE WHAT THE SPAWNER WROTE (G-34 of 20261121-193516-m3s7-b1-review). Evidence validation checked that
// a cited path was below evidence/<node>/, a plain file, and written during the node's life, and nothing else, so the
// node's own runtime transcript (stdout.json, stderr.log) and its validated payload (payload.json), which spawn-node
// writes there and capture.mjs never produced, satisfied it: a finding with no captured evidence entered reconciliation
// as evidence-backed. The owner of the ownership rule now refuses those names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evidenceOwnershipError } from '../scripts/io/finding-scope.mjs';

function run(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'q-ev-reserved-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ev = path.join(root, 'evidence', 'lens');
  fs.mkdirSync(path.join(ev, 'sub'), { recursive: true });
  for (const n of [...SPAWNER_WRITES, 'capture.log']) fs.writeFileSync(path.join(ev, n), 'x\n');
  fs.writeFileSync(path.join(ev, 'sub', 'stdout.json'), 'x\n');
  return root;
}

// denials.json and verdict.kept.json too (G-5 of 20261121-204740-m3s7-b1-remediation-review): spawn-node writes the
// permission denials there before it validates the findings, so a node that provoked a denial could cite that file.
const SPAWNER_WRITES = ['stdout.json', 'stderr.log', 'payload.json', 'denials.json', 'verdict.kept.json'];

test('every file spawn-node writes directly in evidence/<node>/ is one the ownership rule refuses', async () => {
  const src = fs.readFileSync(new URL('../scripts/spawn-node.mjs', import.meta.url), 'utf8');
  const written = [...src.matchAll(/evidenceWrite\(\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(written.length >= 3, `found only ${written.length} evidenceWrite calls: the pattern no longer matches`);
  const { SPAWNER_EVIDENCE_FILES } = await import('../scripts/lib/finding-scope.mjs');
  for (const n of written) assert.ok(SPAWNER_EVIDENCE_FILES.includes(n), `spawn-node writes evidence/<node>/${n}, not refused`);
});

for (const name of SPAWNER_WRITES) {
  test(`evidence/<node>/${name}, written by the spawner, is refused as evidence`, (t) => {
    const root = run(t);
    const why = evidenceOwnershipError(root, 'lens', `evidence/lens/${name}`);
    assert.match(why ?? '', /written by the spawner, not captured/, `accepted: ${why}`);
  });
}

test('a spelling in another case is refused too', (t) => {
  const root = run(t);
  if (!fs.existsSync(path.join(root, 'evidence', 'lens', 'STDOUT.JSON'))) { t.skip('a case-sensitive file system has no such file'); return; }
  assert.match(evidenceOwnershipError(root, 'lens', 'evidence/lens/STDOUT.JSON') ?? '', /written by the spawner/);
});

test('a capture log, and a same-named file in a subfolder, are still admitted', (t) => {
  const root = run(t);
  assert.equal(evidenceOwnershipError(root, 'lens', 'evidence/lens/capture.log'), null);
  assert.equal(evidenceOwnershipError(root, 'lens', 'evidence/lens/sub/stdout.json'), null);
});
