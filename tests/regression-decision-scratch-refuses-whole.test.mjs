// G-8 of 20261122-193909-llo-delivery (panel-codex-contract): moveScratchIntoRecord listed a link or a hard-linked file
// in links-refused.json, copied the rest, then removed the whole scratch, so the refused entries were lost and the
// decision went on as though the move had succeeded. A scratch holding a link or a hard-linked file is now refused
// whole, before anything is written: the record holds none of it, and the scratch stays where it was.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runDecision } from '../scripts/io/decision-run.mjs';
import { makeLink } from './helpers.mjs';

const ask = (extra) => runDecision({ grounding: { floor: 'convention', basisOf: () => 'convention' },
  question: { question: 'q', options: [{ label: 'A' }, { label: 'B' }] }, seed: 'x', seats: ['s1'],
  context: '', caps: { cap: 1, hardCap: 1 }, runModerator: async () => null, ...extra });

test('G-8: a seat scratch holding a hard-linked file is refused whole, the scratch kept and nothing copied', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'decide-whole-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'scratch'));
  fs.writeFileSync(path.join(root, 'secret.txt'), 'secret');
  let linked = true;
  const outcome = ask({ recordDir: path.join(root, 'rec'), scratchRoot: path.join(root, 'scratch'),
    runSeat: async (s, p, r, scratch) => {
      fs.writeFileSync(path.join(scratch, 'a.txt'), 'ok');
      if (!makeLink(t, { target: path.join(root, 'secret.txt'), at: path.join(scratch, 'z.txt'), type: 'hard' })) linked = false;
      return null;
    } });
  if (!linked) { await outcome.catch(() => {}); return; }
  await assert.rejects(outcome, /hard.link/, 'the move reported success over a refused entry');
  assert.equal(fs.existsSync(path.join(root, 'rec', 'evidence-r1-s1', 'a.txt')), false, 'part of a refused scratch was copied');
  assert.equal(fs.existsSync(path.join(root, 'scratch', 'r1-s1', 'z.txt')), true, 'the refused scratch was deleted');
});

test('a clean seat scratch is still moved into the record', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'decide-whole-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'scratch'));
  await ask({ recordDir: path.join(root, 'rec'), scratchRoot: path.join(root, 'scratch'),
    runSeat: async (s, p, r, scratch) => { fs.mkdirSync(path.join(scratch, 'd')); fs.writeFileSync(path.join(scratch, 'd', 'a.txt'), 'ok'); return null; } });
  assert.equal(fs.readFileSync(path.join(root, 'rec', 'evidence-r1-s1', 'd', 'a.txt'), 'utf8'), 'ok');
  assert.equal(fs.existsSync(path.join(root, 'scratch', 'r1-s1')), false);
});
