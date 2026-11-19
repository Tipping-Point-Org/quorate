// G-6 and G-7 of 20261105-163851-crsf-d1-review: claim-check's same-family checker and decide's runtime seat both ran
// spawn-subagent with its stderr captured, and read that stderr only when the child failed. On success, spawn-subagent's
// contract-override notice (A-26: every path running an overridden built-in names it) was dropped. A source check, because
// a successful runtime call needs a live runtime no offline fixture provides: on success the child's own notices are
// relayed to this process's stderr.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = (f) => fs.readFileSync(new URL(`../scripts/${f}`, import.meta.url), 'utf8');

test('G-6: claim-check relays spawn-subagent\'s notices when the same-family checker succeeds', () => {
  const s = src('claim-check.mjs');
  const from = s.indexOf("runStep('same-family-call'");
  const block = s.slice(from, s.indexOf("runStep('same-family-answer'", from));
  assert.ok(from > 0 && block.length > 0, 'the same-family call was not found');
  assert.match(block, /relaySubagentNotices\(\s*r\.stderr\s*\)/, 'a successful call drops the child\'s override notice');
});

test('G-7: decide relays spawn-subagent\'s notices when a runtime seat succeeds', () => {
  const s = src('decide.mjs');
  const from = s.indexOf('const subagent = async');
  const block = s.slice(from, s.indexOf('\n};', from));
  assert.ok(from > 0 && block.length > 0, 'the runtime seat call was not found');
  assert.match(block, /relaySubagentNotices\(\s*r\.err\s*\)/, 'a successful seat drops the child\'s override notice');
});

test('G-6, G-7: the relay keeps spawn-subagent\'s own lines and nothing else', async () => {
  const { subagentNotices } = await import('../scripts/lib/reviewers.mjs');
  assert.deepEqual(subagentNotices('noise\nspawn-subagent: the contract overrides x\nmore\r\nspawn-subagent: y\n'),
    ['spawn-subagent: the contract overrides x', 'spawn-subagent: y']);
  assert.deepEqual(subagentNotices(''), []);
  assert.deepEqual(subagentNotices(null), []);
});
