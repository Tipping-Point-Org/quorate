// Remediation of 20261106-022028-stoplog-g8-remediation-2-review, three confirmed MEDIUMs on the hooks' fault notices.
// G-8: run-session.mjs's SessionStart hook still wrote the run-state-unreadable sentence as an inline literal while
// stop-guard rendered it from prompts/_templates/run-state-unreadable.md: two owners of one sentence (I-9).
// G-9: stop-guard's turn start loaded and rendered the unreadable-lines template BEFORE appending the turn-start events,
// with nothing catching it between, so a template fault lost the involuntary-end and turn-start records exactly when
// the stop record was already torn.
// G-10: the run-state notice's catch wrapped the whole turn-start print, so any fault after a successful read was said
// as "run state could not be read", and the catch's own template load could throw.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('G-8: the SessionStart hook prints the run-state fault from the template, not from a literal', () => {
  const s = src('scripts/run-session.mjs');
  // The hook's sentence; the commands' own `die(the run state could not be read: ...)` lines are stderr to the operator.
  assert.ok(!/quorate run state could not be read:/.test(s), 'run-session.mjs writes the sentence inline');
  assert.match(s, /noticeText\('run-state-unreadable\.md'/, 'run-session.mjs renders run-state-unreadable.md');
});

test('G-9: the turn start appends its events before any notice is rendered', () => {
  const s = src('scripts/stop-guard.mjs');
  const append = s.indexOf('turnStartEvents(input');
  const notice = s.indexOf("'stop-record-unreadable.md'");
  assert.ok(append > 0 && notice > 0, 'both sites are present');
  assert.ok(append < notice, 'the unreadable-lines notice is rendered before the turn-start events are appended');
  assert.ok(!/renderTemplate\(readTemplate\(/.test(s), 'a notice is rendered by a call that can throw into the hook');
});

test('G-10: only a failed read of the run state is said as one; a later fault prints nothing', () => {
  const s = src('scripts/stop-guard.mjs');
  const fn = s.slice(s.indexOf('async function turnStartRunLinesOf'), s.indexOf('// THE CONTRACT, READ ONCE'));
  assert.match(fn, /try \{ state = readRunState\(repoRoot\); \} catch \(e\) \{ return noticeText\('run-state-unreadable\.md'/,
    'the run-state notice is tied to the read alone');
  assert.ok(!/catch \(e\) \{\s*const \{ readTemplate/.test(s), 'the whole print\'s catch still renders the run-state notice');
});

test('G-9, G-10: a notice that cannot be rendered is an empty print and a stderr line, never a throw', async () => {
  const { noticeText } = await import('../scripts/io/template.mjs');
  const said = [];
  assert.equal(noticeText('no-such-notice.md', {}, { say: (l) => said.push(l) }), '');
  assert.equal(said.length, 1);
  assert.match(said[0], /no-such-notice\.md/);
  assert.equal(noticeText('run-state-unreadable.md', {}, { say: (l) => said.push(l) }), '', 'a slot mismatch is not a throw');
  assert.equal(noticeText('run-state-unreadable.md', { message: 'boom' }), 'quorate run state could not be read: boom\n');
});
