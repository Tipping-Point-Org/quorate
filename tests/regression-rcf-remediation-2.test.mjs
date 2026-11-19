// THE rcf-delivery REVIEW'S STOP-REASON, INHERITED-REQUEST AND STAGE-6 DOC FINDINGS (20261021-014056-rcf-delivery; the
// operator's work list: "Decline G-9, keep the order (Recommended)").
//
// G-6   stopReasonChecks accepted a `partial` group with stop_reason `not-attempted`: never reached, and partly fixed.
// G-8   new-run re-read an inherited request by path and recorded a fresh hash, so a request edited after the review was
//       accepted as the one the review was judged against.
// G-16  the remediation schema left stop_reason, limit_kind and stop_cause optional and string-only; the request has every
//       group carry all three, nullable.
// G-1   the remediation prompt named the limit_kind values without saying what each means, and called a stopped group
//       `blocked`, which reads as a disposition the schema rejects.
// G-18  the contract's remediation payload row did not name the three stop fields.
// G-19  the contract's remediate.mjs row named only the run lock and exits 6 and 7, not the repository lock and exit 8.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

test('G-6: a partial group cannot claim it was never reached', async () => {
  const { stopReasonChecks } = await import('../scripts/lib/remediation-chain.mjs');
  const out = stopReasonChecks([{ group_id: 'G-1', disposition: 'partial', stop_reason: 'not-attempted' }], {}, {});
  assert.match(out.join(), /G-1: partial .*not-attempted/, JSON.stringify(out));
  assert.deepEqual(stopReasonChecks([{ group_id: 'G-1', disposition: 'not-fixed', stop_reason: 'not-attempted' }], {}, {}), []);
});

test('G-8: an inherited request edited since the review is refused, not re-recorded', async () => {
  const mod = await import('../scripts/lib/request-inheritance.mjs');
  assert.equal(typeof mod.inheritedRequestChanged, 'function', 'nothing compares the inherited request with its recorded hash');
  const source = { run_id: 'R1', request: { path: '.claude/requests/a.md', sha256: 'a'.repeat(64) } };
  assert.match(mod.inheritedRequestChanged(source, 'b'.repeat(64)), /\.claude\/requests\/a\.md has changed since R1/);
  assert.equal(mod.inheritedRequestChanged(source, 'a'.repeat(64)), null);
  assert.equal(mod.inheritedRequestChanged({ run_id: 'R1', request: { path: 'a.md' } }, 'b'.repeat(64)), null);
  assert.match(read('scripts/new-run.mjs'), /inheritedRequestChanged\(inheritFrom,/, 'new-run does not call the check');
});

test('G-16: every remediation group carries the three stop fields, nullable', () => {
  const src = read('scripts/spawn-node.mjs');
  const block = src.slice(src.indexOf("if (variant === 'remediation')"));
  const required = block.slice(block.indexOf('required: [\'group_id\''), block.indexOf('properties:', block.indexOf('required: [\'group_id\'')));
  for (const f of ['stop_reason', 'limit_kind', 'stop_cause']) {
    assert.ok(required.includes(`'${f}'`), `${f} is not in the group's required list`);
    assert.match(block, new RegExp(`\\n\\s*${f}: \\{ type: \\['string', 'null'\\]`), `${f} is not nullable`);
  }
  assert.match(block, /stop_reason: \{[^\n]*enum: \['not-attempted', 'blocked', 'limit', null\]/);
  assert.match(block, /limit_kind: \{[^\n]*enum: \['session-time', 'turns', 'budget', null\]/);
});

test('G-1: the prompt defines each limit_kind and keeps blocked a stop_reason', () => {
  const p = read('prompts/remediation/PROMPT.md');
  assert.match(p, /`session-time`[^.]*\bsession\b/, 'session-time is not defined');
  assert.match(p, /`turns`[^.]*\bturn limit\b/, 'turns is not defined');
  assert.match(p, /`budget`[^.]*\bbudget\b/, 'budget is not defined');
  assert.doesNotMatch(p, /is `blocked` with/, 'blocked reads as a disposition');
  assert.match(p, /`stop_reason: blocked`/);
});

test('G-18 and G-19: the contract names the stop fields and the repository lock', () => {
  const c = read('shared/claude-md-contract.md');
  const row = (name) => c.split('\n').find((l) => l.startsWith(`| \`${name}\``)) ?? '';
  const prompt = row('remediation/PROMPT.md');
  for (const f of ['stop_reason', 'limit_kind', 'stop_cause']) assert.ok(prompt.includes(f), `the payload row omits ${f}`);
  const runner = row('scripts/remediate.mjs');
  assert.match(runner, /repository lock/, 'the remediate.mjs row omits the repository lock');
  assert.match(runner, /exit 8/, 'the remediate.mjs row omits exit 8');
  assert.match(runner, /common dir/, 'the remediate.mjs row does not say linked worktrees share the lock');
});
