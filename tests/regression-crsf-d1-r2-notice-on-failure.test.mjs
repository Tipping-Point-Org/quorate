// G-6 (and its symptom G-5) of 20261105-173030-crsf-d1-remediation-review: decide's runtime seat relayed
// spawn-subagent's contract-override notice only when the seat exited 0, and claim-check's same-family call threw on a
// nonzero exit before its relay ran. A failing call through an overridden adapter therefore never named the override
// (A-26: every path running an overridden built-in names it). A source check, as in the round before it: a call through
// a live runtime is what no offline fixture provides. The relay runs before the exit status is looked at.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = (f) => fs.readFileSync(new URL(`../scripts/${f}`, import.meta.url), 'utf8');

test('G-5: claim-check relays the checker\'s notices before it throws on a failing exit', () => {
  const s = src('claim-check.mjs');
  const from = s.indexOf("runStep('same-family-call'");
  const block = s.slice(from, s.indexOf("runStep('same-family-answer'", from));
  assert.ok(from > 0 && block.length > 0, 'the same-family call was not found');
  const relay = block.search(/relaySubagentNotices\(\s*r\.stderr\s*\)/);
  const thrown = block.search(/if \(r\.status !== 0\) throw/);
  assert.ok(relay >= 0 && thrown >= 0, 'the relay or the failure branch was not found');
  assert.ok(relay < thrown, 'a failing checker throws before its override notice is relayed');
});

test('G-6: decide relays a runtime seat\'s notices whatever its exit', () => {
  const s = src('decide.mjs');
  const from = s.indexOf('const subagent = async');
  const block = s.slice(from, s.indexOf('\n};', from));
  assert.ok(from > 0 && block.length > 0, 'the runtime seat call was not found');
  assert.match(block, /relaySubagentNotices\(\s*r\.err\s*\)/, 'the seat\'s override notice is never relayed');
  assert.doesNotMatch(block, /if \(r\.code === 0\) relaySubagentNotices/, 'a failing seat drops its override notice');
});
