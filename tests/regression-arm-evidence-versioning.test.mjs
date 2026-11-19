// A SECOND ATTEMPT MUST NOT ERASE THE FIRST ONE'S EVIDENCE.
//
// external-review wrote raw.log and envelope.json at a fixed name keyed on the node id, and
// /request's critique retries once under that SAME node id — so the retry destroyed the two
// artifacts that say why it was needed (G-15). Evidence a later write can silently replace is not
// evidence; it is a cache.
//
// This test exists because the first fix shipped a `freeEvidencePath` helper that NOTHING CALLED:
// the edit that was supposed to route both writes through it never landed, the function sat dead in
// the file, and the next sweep found it (G-12, G-13). A source grep for the helper would have passed
// on that tree. So this runs the script twice and looks at the directory.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScript, repoRunDir, REPO_ROOT } from './helpers.mjs';

test('a retried arm versions its envelope instead of overwriting it', () => {
  // INSIDE the repository, like capture's fixtures: external-review now confines --run-dir to the
  // tree it is running in, because that directory's run.json decides whether source may leave the
  // machine (G-9). A fixture under os.tmpdir() was testing a shape no caller has.
  const { base: tmp, dir: runDir } = repoRunDir({ runId: 'arm-evidence', prefix: 'quorate-arm-' });
  try {
    const prompt = path.join(tmp, 'prompt.md');
    fs.writeFileSync(prompt, 'a prompt that is never sent\n');

    // The run's OWN frozen contract declares no external_panel, so the egress gate refuses: the
    // script emits an "unavailable" envelope and NOTHING leaves the machine. That is the cheap way
    // to exercise the evidence writer twice without invoking a vendor CLI.
    // THROUGH runScript, which clears GRAPH_NODE_DEPTH (helpers.mjs) — the one place this suite
    // decides how a script is spawned. Spawning directly inherited the ambient depth, and at depth
    // >= 1 external-review's §8 guard exits 3 before writing any envelope: this test went red for
    // recursion, not for evidence versioning, which is the only thing it claims to constrain. A test
    // whose failure means something other than its title is worse than no test (G-50).
    const invoke = () => runScript('external-review.mjs', [
      '--run-dir', runDir, '--node-id', 'panel-x', '--reviewer', 'codex', '--prompt-file', prompt,
    ]);

    const first = invoke();
    assert.equal(first.status, 0, 'this script always exits 0 with a structured response');
    const second = invoke();
    assert.equal(second.status, 0);

    const written = fs.readdirSync(path.join(runDir, 'evidence', 'panel-x')).sort();
    assert.deepEqual(written, ['envelope.2.json', 'envelope.json'],
      'the first attempt keeps the plain name; the retry lands beside it, never on top of it');

    // Both must be readable envelopes — a versioned name holding a truncated or empty file would
    // preserve the path and lose the evidence.
    for (const f of written) {
      const env = JSON.parse(fs.readFileSync(path.join(runDir, 'evidence', 'panel-x', f), 'utf8'));
      assert.equal(env.node_id, 'panel-x');
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// A RETRY'S FINDINGS MUST CITE THE RETRY'S LOG. Retries version the raw log (raw.2.log, raw.3.log)
// while every finding kept naming `raw.log`, so a second attempt's findings pointed at the FIRST
// attempt's artifact — a citation to evidence that does not support it (G-13).
//
// THE FIRST VERSION OF THIS TEST PASSED WITH THE FIX STASHED. It drove the script through the
// egress-refusal path, which emits an envelope carrying no findings at all, so "no field names
// raw.log" was vacuously true — the I-16 defect this project rejects in every other test file,
// written here by the same hand that had just fixed it elsewhere. What follows tests the naming rule
// where it can actually fail: the pure function, and the one line that must consume it.
test('the name a second write gets is a NEW name, and a hundredth is refused outright', async () => {
  const { freeEvidenceName } = await import('../scripts/io/atomic.mjs');
  const taken = new Set();
  // An owner over a folder 'd' whose taken names are the set (G-10 of 20261029-190658-rdr-delivery: only an owner is accepted).
  const at = (isFree) => ({ owner: { root: 'd', isFree }, segments: [] });
  const free = at((segs) => !taken.has(path.join('d', ...segs)));

  const first = freeEvidenceName(free, 'raw', '.log');
  assert.match(first, /raw\.log$/, 'the first write keeps the plain name, so existing readers are unaffected');
  taken.add(first);

  const second = freeEvidenceName(free, 'raw', '.log');
  assert.match(second, /raw\.2\.log$/);
  assert.notEqual(second, first, 'a retry that lands on the first log destroys the record of why it retried');
  taken.add(second);
  assert.match(freeEvidenceName(free, 'raw', '.log'), /raw\.3\.log$/);

  // A BOUND THAT FAILS INTO THE DEFECT IT GUARDS. The loop used to stop at `n < 100` while still
  // returning the taken `.99` path, so the hundredth attempt overwrote the ninety-ninth (G-10).
  assert.throws(() => freeEvidenceName(at(() => false), 'raw', '.log'), /retrying without bound/);
});

test('the arm cites the log it was given, never a literal', () => {
  // The citation itself is one line in external-review, and reaching it needs a live reviewer. What
  // a test CAN pin is that the line reads the variable the writer set: a literal here is exactly how
  // a retry came to cite the previous attempt's file.
  const src = fs.readFileSync(
    path.join(import.meta.dirname, '..', 'scripts', 'external-review.mjs'), 'utf8');
  assert.match(src, /evidence_path: rawLogRel,/,
    'findings must cite the path this attempt actually wrote');
  assert.match(src, /rawLogRel = `evidence\/\$\{nodeId\}\/\$\{path\.basename\(at\)\}`/,
    'and that variable must be set from the name freeEvidenceName returned');
  assert.doesNotMatch(src, /evidence_path: `evidence\/\$\{nodeId\}\/raw\.log`/,
    'the literal is what made a retry cite the attempt before it');
});

// OWNERSHIP AND EXISTENCE WERE THE WHOLE PROVENANCE CHECK (G-51, panel-codex-contract).
//
// A finding's evidence_path had to sit under the node's own evidence directory and exist — and a
// file gets there without this node ever seeing it printed: `--resume` re-enters a run whose earlier
// attempt already captured under this very node id. §4's `measurement` basis rests on "cite exactly
// the path capture.mjs printed", so a log from an attempt this node did not make is a citation of
// somebody else's work: the same failure as citing another node's evidence, one directory down.
test('evidence written before the node started is not that node\'s evidence', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'spawn-node.mjs'), 'utf8');
  const block = src.slice(src.indexOf('const evAbs = path.resolve(runDir'), src.indexOf('// CONTAINMENT and location bounds'));

  assert.match(block, /predates this node/,
    'existence is not provenance — a resumed run leaves the earlier attempt behind');
  assert.match(block, /Date\.parse\(status\.started_at/, 'the node\'s own start is the boundary');

  // The slack is deliberate and must stay: file mtimes are coarser than the ISO timestamp, and a
  // check that rejects a log written in the same second would reject real evidence.
  assert.match(block, /startedMs - 1000/);

  // The arithmetic itself, since the source assertion alone cannot show the comparison is the right
  // way round — an inverted one would reject every genuine capture and keep every stale one.
  const started = Date.parse('2026-09-10T12:00:00.000Z');
  const stale = (mtime) => mtime < started - 1000;
  assert.equal(stale(Date.parse('2026-09-10T11:59:00.000Z')), true, 'a log from the earlier attempt');
  assert.equal(stale(Date.parse('2026-09-10T12:00:30.000Z')), false, 'a log this node captured');
  assert.equal(stale(Date.parse('2026-09-10T11:59:59.500Z')), false, 'within the granularity slack');
});
