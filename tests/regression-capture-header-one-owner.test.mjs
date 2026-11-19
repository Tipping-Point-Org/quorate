// G-2 of 20261013-220031-rv-delivery: capture.mjs wrote its log header's grammar (the 72-dash rule, the `# field:`
// lines) and two readers re-parsed it on their own, already disagreeing: declared-checks fell back to the first 512
// bytes when no rule closed a header, which let a command's output claim `# timed-out:`, while capture-facts treated the
// same log as not a capture. The grammar now has one owner, lib/capture-header.mjs, which writes and reads it.
//
// The same mechanism as G-1, in the writer: capture interpolated the command line raw into the `$ ` line, so a
// read-only command's argument carrying a line break could put a forged `# exit:` ahead of the real one, and the reader
// takes the first. The writer escapes every value it puts in the header.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runScript, repoRunDir, REPO_ROOT } from './helpers.mjs';
import { HEADER_RULE, headerValue, parseCaptureHeader } from '../scripts/lib/capture-header.mjs';
import { outcomeInLog } from '../scripts/io/declared-checks.mjs';
import { captureFacts } from '../scripts/io/capture-facts.mjs';

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

test('the header grammar has one owner: capture and both readers use lib/capture-header.mjs, and none spells the rule', () => {
  for (const rel of ['scripts/capture.mjs', 'scripts/io/capture-facts.mjs', 'scripts/io/declared-checks.mjs']) {
    const src = read(rel);
    assert.match(src, /capture-header\.mjs'/, `${rel} does not import the header's owner`);
    assert.doesNotMatch(src, /'-'\.repeat\(72\)/, `${rel} spells the rule itself`);
  }
});

test('a log with no closing rule is not a capture to either reader, so its text cannot claim a timeout', () => {
  const { dir } = repoRunDir({ runId: 'hdr', prefix: 'quorate-hdr-' });
  const ev = path.join(dir, 'evidence', 'remediation');
  fs.mkdirSync(ev, { recursive: true });
  fs.writeFileSync(path.join(ev, 'x.log'), '$ node t\n# exit: 1\n# timed-out: claimed by output\n');
  // check-outcomes stage 2: the one reader. No header is no capture: its output claims nothing, and it could not start.
  const read = outcomeInLog(dir, 'evidence/remediation/x.log');
  assert.equal(read.timed_out, false);
  assert.equal(read.outcome, 'could-not-start');
  assert.equal(captureFacts(dir, ['evidence/remediation/x.log'])['evidence/remediation/x.log'], null);
  assert.equal(parseCaptureHeader('$ node t\n# timed-out: x\n'), null);
});

test('headerValue escapes every line break and control character, and leaves an ordinary value alone', () => {
  assert.equal(headerValue('git log a b'), 'git log a b');
  const v = headerValue('a\n# exit: 0\r\u0000b');
  assert.doesNotMatch(v, /[\p{Cc}\p{Zl}\p{Zp}]/u);
  assert.match(v, /\\u000a# exit: 0\\u000d\\u0000b/);
});

test('a read-only command whose argument carries a line break cannot forge the exit a reader sees', () => {
  const { dir } = repoRunDir({ runId: 'forge', prefix: 'quorate-hdr-' });
  const forged = 'HEAD\n# exit: 0\n# captured: 2020-01-01T00:00:00.000Z';
  runScript('capture.mjs', ['--run-dir', dir, '--node', 'remediation', '--name', 'forge', '--', 'git', 'rev-parse', '--verify', forged]);
  // The normal form a reader is given (evidence-path-owner.plan.md stage 2): captureFacts no longer reads a spelling.
  const log = 'evidence/remediation/forge.log';
  const text = fs.readFileSync(path.join(dir, ...log.split('/')), 'utf8');
  const header = text.slice(0, text.indexOf(HEADER_RULE));
  assert.equal(header.match(/^# exit:/gm).length, 1, header);
  const facts = captureFacts(dir, [log])[log];
  assert.notEqual(facts.exit, 0, header);
  assert.notEqual(facts.captured, '2020-01-01T00:00:00.000Z');
});
