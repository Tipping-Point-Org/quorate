// G-14 of 20261024-224631-arp-remediation-review (G-1 its symptom): the stop record was bounded, the oldest events
// dropped past two capped files, while its owner, shared/session-rules.md, still said every turn is recorded and
// `stop-log --summary` reports them, and the summary gave no sign that what it added up was only what was kept.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { appendStopEvent } from '../scripts/io/stop-log.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('regression: the owner of the session rules states what the stop record keeps', () => {
  const text = fs.readFileSync(path.join(ROOT, 'shared', 'session-rules.md'), 'utf8');
  assert.match(text, /4 MiB/, 'the cap is stated');
  assert.match(text, /older events are dropped/, 'and that the oldest are dropped past it');
});

test('regression: the summary says which span of the record it adds up', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stoplog-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'stoplog-repo-'));
  try {
    appendStopEvent(repo, { at: Date.UTC(2026, 9, 1), event: 'start' }, { home });
    appendStopEvent(repo, { at: Date.UTC(2026, 9, 2), event: 'end', kind: 'named', reason: 'done' }, { home });
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'stop-log.mjs'), '--summary', '--repo-root', repo], {
      encoding: 'utf8', env: { ...process.env, QUORATE_HOME: home }, windowsHide: true,
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /kept: 2 events since 2026-10-01/);
    assert.match(r.stdout, /older events are dropped/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
