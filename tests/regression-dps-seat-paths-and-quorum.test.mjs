// Two LOWs of 20261109-232630-dps-delivery, in the decision panel's seat handling.
//   G-12  seatCopyPaths deduplicated paths case-sensitively, so on a case-insensitive filesystem two spellings of one file
//         both reached copyIntoSeatDir, whose exclusive create of the second failed and aborted the whole decision.
//   G-3   decide.mjs's seats-unavailable sentence hard-coded "fewer than two" beside QUORUM, its owner in
//         lib/decision-panel.mjs, so a change to the owner would leave the operator told a different quorum.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { seatCopyPaths } from '../scripts/lib/decision-panel.mjs';
import { REPO_ROOT } from './helpers.mjs';

test('G-12: on a case-insensitive filesystem two spellings of one path are copied once, in the first spelling', () => {
  const r = seatCopyPaths({ request: '.claude/requests/Ask.md', files: ['src/App.js', 'src/app.js'],
    evidence: [{ inRepo: true, rel: '.claude/requests/ask.md' }], caseInsensitive: true });
  assert.deepEqual(r.copy, ['.claude/requests/Ask.md', 'src/App.js'], 'a second spelling of one file would fail its exclusive create');
  assert.deepEqual(r.refused, []);
});

test('G-12: on a case-sensitive filesystem the two spellings are two files, and both are copied', () => {
  const r = seatCopyPaths({ files: ['src/App.js', 'src/app.js'], caseInsensitive: false });
  assert.deepEqual(r.copy, ['src/App.js', 'src/app.js']);
});

test('G-12: decide.mjs hands seatCopyPaths the platform\'s case rule', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'decide.mjs'), 'utf8');
  assert.match(src, /seatCopyPaths\(\{[^}]*caseInsensitive: IO\.caseInsensitiveFs[^}]*\}\)/, 'the seat copies are deduplicated without the filesystem\'s case rule');
});

test('G-3: the seats-unavailable sentence states the quorum from QUORUM, never a number of its own', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'decide.mjs'), 'utf8');
  const line = src.split(/\r?\n/).find((l) => /seats unavailable after/.test(l));
  assert.ok(line, 'the seats-unavailable sentence was not found');
  assert.doesNotMatch(line, /fewer than (two|2)\b/, `the quorum is hard-coded: ${line.trim()}`);
  assert.match(line, /\$\{QUORUM\}/, `the sentence does not read QUORUM: ${line.trim()}`);
  assert.match(src, /import \{[^}]*\bQUORUM\b[^}]*\} from '\.\/lib\/decision-panel\.mjs'/, 'decide.mjs does not import QUORUM from its owner');
});
