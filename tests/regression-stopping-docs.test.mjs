// stopping-a-child.plan.md stage 6 — the documents that say how a child is stopped, each statement held to the code. A
// doc test per statement, because a sentence in ARCHITECTURE.md can raise a finding above RISK and a CHANGELOG entry is
// what a consumer reads before pinning a commit: a number or a name there that the code no longer has is an inert
// guarantee. And the wording fix: spawn-node's timeout and overflow sentences said "the kill was refused" for an accepted
// kill whose exit was merely not seen (ledger spawn-node.mjs:1520), driven here through spawn-node's --test-stop seam.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, runScript, repoRunDir, privateRecord } from './helpers.mjs';
import * as owner from '../scripts/io/stop-child.mjs';
import { FILE_SIZE_CEILING_BYTES } from '../scripts/platform/posix/index.mjs';
import { PROC_MEMBERS } from '../scripts/platform/interface.mjs';

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const ARCH = read('ARCHITECTURE.md');
const A25 = ARCH.slice(ARCH.indexOf('### A-25'), ARCH.indexOf('## 7.'));
const CHANGELOG = read('CHANGELOG.md');
const ENTRY = (() => {
  const at = CHANGELOG.indexOf('### ⚠ BEHAVIOUR — one owner stops a child');
  return CHANGELOG.slice(at, CHANGELOG.indexOf('\n### ', at + 5));
})();
const PROTOCOL = read('shared/disk-first-protocol.md');
const scriptsSrc = (rel) => read(path.join('scripts', rel));
const allScripts = () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.mjs$/.test(e.name) ? [path.join(d, e.name)] : []));
  return walk(path.join(REPO_ROOT, 'scripts')).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
};

test('stage 6: A-25 exists, in §6, and names an owner that exists', () => {
  assert.ok(A25.length > 200, 'ARCHITECTURE.md has no A-25');
  assert.ok(ARCH.indexOf('### A-25') > ARCH.indexOf('## 6.') && ARCH.indexOf('### A-25') < ARCH.indexOf('## 7.'), 'A-25 is not in §6');
  assert.match(A25, /scripts\/io\/stop-child\.mjs/);
  assert.ok(fs.existsSync(path.join(REPO_ROOT, 'scripts', 'io', 'stop-child.mjs')));
});

test('stage 6: the three outcomes the documents name are the three the owner returns', () => {
  for (const word of ['exited', 'refused', 'unconfirmed']) {
    assert.match(A25, new RegExp(`\`${word}\``), `A-25 does not name the outcome ${word}`);
    assert.match(ENTRY, new RegExp(`\`${word}\``), `the CHANGELOG entry does not name the outcome ${word}`);
    assert.match(scriptsSrc('io/stop-child.mjs'), new RegExp(`settle\\('${word}'\\)|outcome: '${word}'|'${word}'`), `the owner never returns ${word}`);
  }
  assert.match(A25, /no\s+fourth/);
});

test('stage 6: every status field the documents name is one the code writes', () => {
  const code = allScripts();
  for (const field of ['orphan_pid', 'kill_refused', 'kill_unconfirmed', 'file_size_ceiling_bytes']) {
    assert.ok(A25.includes(field) || ENTRY.includes(field), `${field} is in neither document`);
    assert.match(code, new RegExp(`\\b${field}\\b\\s*[:=]|\\.${field}\\s*=`), `the documents name ${field}, which no script writes`);
  }
  const row = PROTOCOL.split('\n').find((l) => l.startsWith('| `BLOCKED` |'));
  assert.ok(row, 'the protocol has no BLOCKED row');
  for (const field of ['orphan_pid', 'kill_refused', 'kill_unconfirmed']) assert.ok(row.includes(field), `the BLOCKED row does not name ${field}`);
  assert.match(row, /interrupted/);
  assert.match(row, /A-25/);
});

// G-18 of 20261002-215002-stop-child-review: the row called such a child "stopped and not seen to exit" — stopped is
// exactly what A-25 says it may not be called.
test('G-18: the protocol never calls a child stopped that was not seen to exit', () => {
  const row = PROTOCOL.split('\n').find((l) => l.startsWith('| `BLOCKED` |'));
  assert.doesNotMatch(row, /\bstopped and not seen to exit/, 'the row calls an unconfirmed child "stopped"');
  assert.match(row, /not seen to exit/, 'the row no longer names the case at all');
});

// G-5 of 20261003-012557-stop-child-refusal-review, declined by the operator with the limit stated: "exited" is the held
// child's exit, not its tree's. A-25 must say so, or a reader takes "exited" as "nothing of it survives".
test('G-5: A-25 states that exited is the child\'s exit, not its tree\'s, and why the window is bounded', () => {
  assert.match(A25, /`exited` is the \*\*child's\*\* exit/);
  assert.match(A25, /not its tree's/);
  assert.match(A25, /ended by the runtime's job when its parent\s+exits/);
  assert.match(A25, /stated limit, not a guarantee/);
});

// G-1 and G-2 of 20261003-020052-stop-child-refusal-confirm: after the exit hook began reporting a failed kill on a process
// no longer there as `unconfirmed` (c1d27cd), A-25 and the owner's header still defined `unconfirmed` as an ACCEPTED kill
// with no exit seen, and A-25 said the hook records every child as unconfirmed although it can also say `refused`.
test('G-1/G-2: A-25 and the owner define unconfirmed to include a failed kill on a process no longer there, and the hook\'s refusal', () => {
  const header = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'io', 'stop-child.mjs'), 'utf8').split('\n').slice(0, 20).join('\n');
  for (const [where, text] of [['A-25', A25], ['the owner\'s header', header]]) {
    assert.match(text, /no longer there/, `${where} does not say unconfirmed covers a failed kill on a process no longer there`);
  }
  assert.doesNotMatch(A25, /records each child as unconfirmed\./, 'A-25 still says the hook records every child as unconfirmed');
  assert.match(A25, /a child still\s+there whose kill failed as `refused`/);
});

// THE WORDING SWEEP (operator, 2026-10-03: "One sweep, then review"; G-1 with G-2, G-4, G-5, G-6, and G-7 of
// 20261003-025056-stop-child-refusal-confirm-2). Since c1d27cd `unconfirmed` covers a failed kill on a process no longer
// there as well as an accepted one, and each review since found another text still saying "accepted". Every message an
// operator reads for an unconfirmed stop is rendered here through its owner and held to one wording — not seen to exit
// after its stop — so the next text that drifts fails this test instead of a review.
test('sweep: no operator-facing message calls an unconfirmed stop an accepted kill, and each says it was not seen to exit', async () => {
  const { stopOutcomeFields } = await import('../scripts/io/stop-on-exit.mjs');
  const { recordRunOutcome, stopPhrase } = await import('../scripts/io/run-child.mjs');
  const { survivorNote } = await import('../scripts/lib/reap.mjs');
  const status = { validator_errors: [] };
  recordRunOutcome(status, { exitCode: null, signal: 'KILL-UNCONFIRMED', timedOut: true, killedTree: false, overflowed: false,
    killRefused: null, orphanPid: 77, exitUnconfirmed: true, interrupted: null });
  const messages = {
    'stop-on-exit note': stopOutcomeFields({ outcome: 'unconfirmed', pid: 77 }).note,
    'run-child status': status.validator_errors.find((e) => e.includes('77')),
    'run-child stopPhrase': stopPhrase({ killedTree: false, exitUnconfirmed: true, killRefused: null, orphanPid: 77 }),
    'reaper, held': survivorNote({ pid: 77, held: true, outcome: 'unconfirmed' }),
    'reaper, recorded': survivorNote({ pid: 77, held: false, outcome: 'unconfirmed', recorded: 'unconfirmed' }),
  };
  for (const [where, text] of Object.entries(messages)) {
    assert.ok(text, `${where}: no message was produced`);
    assert.doesNotMatch(text, /accepted|was killed/, `${where} claims a kill took effect: "${text}"`);
    assert.match(text, /not seen to exit/, `${where} does not say the exit was not seen: "${text}"`);
    assert.match(text, /77/, `${where} does not name the process`);
  }
});

test('sweep: the protocol\'s BLOCKED row says what each outcome covers, and names A-25 as their owner', () => {
  const row = PROTOCOL.split('\n').find((l) => l.startsWith('| `BLOCKED` |'));
  assert.match(row, /`kill_refused`[^|]*still there/, 'the row does not say what a refusal covers');
  assert.match(row, /`kill_unconfirmed`[^|]*not seen to exit/, 'the row does not say what unconfirmed covers');
  assert.match(row, /A-25/);
});

test('stage 6: "up to 5 seconds" is the owner\'s signal deadline', () => {
  assert.equal(owner.SIGNAL_EXIT_DEADLINE_MS, 5_000, 'the CHANGELOG promises a 5 s wait the owner no longer has');
  assert.match(ENTRY, /up to 5 seconds/);
  assert.match(A25, /at\s+most one deadline/);
});

test('stage 6: the 4 GiB ceiling the CHANGELOG states is the one the platform declares, and A-25 names its member', () => {
  assert.equal(FILE_SIZE_CEILING_BYTES, 4 * 1024 ** 3);
  assert.match(ENTRY, /4 GiB file-size ceiling/);
  assert.match(A25, /`proc\.boundedLaunch`/);
  assert.ok(PROC_MEMBERS.includes('boundedLaunch'), 'A-25 names a platform member the interface does not have');
  assert.match(A25, /bounds a \*\*runaway\*\*, not the node's output/);
  assert.match(A25, /file_size_ceiling_bytes:\s*null/);
});

test('stage 6: what the documents say is NOT covered is in fact outside the owner', { skip: privateRecord('.claude/requests/stopping-a-child.design.md') }, () => {
  // capture runs its command through spawnCapture since capture-interactive.plan.md stage 3, as external-review's
  // reviewer probe AND its vendor call do (G-3 of 20261010-071234; stop-owner-grep-state-roots.plan.md stage 1, G-11 of
  // 20261022-200543-ciss-d1-review-2) — A-25 says each. Its deadline is held by running it:
  // tests/regression-capture-tree-deadline.test.mjs.
  const capture = scriptsSrc('capture.mjs');
  assert.doesNotMatch(capture, /\bspawnSync\(/, 'capture runs a synchronous child again — A-25 says its command is covered');
  assert.match(capture, /await spawnCapture\(/, 'capture\'s command no longer goes through the owner — A-25 says it does');
  assert.match(A25, /`capture` is covered/);
  const er = scriptsSrc('external-review.mjs');
  assert.doesNotMatch(er, /\bspawnSync\(/, 'external-review runs a synchronous child again — A-25 says its calls are covered');
  assert.match(er, /r = await capture\(/, 'external-review\'s vendor call no longer goes through the owner — A-25 says it does');
  assert.match(er, /await spawnCapture\(process\.execPath/, 'its probe no longer goes through the owner — A-25 says it does');
  assert.match(A25, /reviewer \*\*probe\*\* runs through `spawnCapture`/);
  assert.match(A25, /\*\*vendor call\*\*/);
  assert.match(A25, /`capture`/);
  assert.match(A25, /`external-review`/);
  assert.match(ENTRY, /Not covered/);
  // The design it points to for the case to revisit exists and has that section.
  const design = read('.claude/requests/stopping-a-child.design.md');
  assert.match(A25, /stopping-a-child\.design\.md` §5/);
  assert.match(design, /^### 5\. What is in scope/m);
});

test('stage 6: the test A-25 says checks it exists', () => {
  const m = A25.match(/`(tests\/[\w.-]+\.test\.mjs)`/);
  assert.ok(m, 'A-25 names no test');
  assert.ok(fs.existsSync(path.join(REPO_ROOT, m[1])), `${m[1]} does not exist`);
});

// ------------------------------------------------------------------------------------------------- the wording
test('stage 6: a stop is worded as its outcome — killed, refused, or accepted and not seen to exit', async () => {
  const { stopPhrase } = await import('../scripts/io/run-child.mjs');
  assert.equal(typeof stopPhrase, 'function', 'the stop sentence has no owner');
  // A seen exit in the owner's words since stopping-a-child-vocabulary (G-6): no kill claimed, the exit seen.
  assert.equal(stopPhrase({ killedTree: true }), 'the child exited after its stop');
  // The wording sweep (2026-10-03): not seen to exit after its stop, and no longer "accepted", which is not always true.
  assert.match(stopPhrase({ killedTree: false, exitUnconfirmed: true, orphanPid: 41 }), /pid 41.* not seen to exit/);
  assert.doesNotMatch(stopPhrase({ killedTree: false, exitUnconfirmed: true, orphanPid: 41 }), /accepted/);
  assert.doesNotMatch(stopPhrase({ killedTree: false, exitUnconfirmed: true, orphanPid: 41 }), /refused/);
  // The shape run-child produces for a refusal carries killRefused; this input used to omit it — a shape the engine never
  // makes — and so pinned the fall-through G-4 found (A-16: a fixture invented, not taken from the code).
  // The wording is lib/stop-vocabulary.mjs's since stopping-a-child-vocabulary: the pid, and the one refusal clause.
  assert.match(stopPhrase({ killedTree: false, exitUnconfirmed: false, killRefused: 'timeout', orphanPid: 42 }), /pid 42\) refused to be killed/);
});

// G-4 of 20261002-215002-stop-child-review: a child that wrote past the cap and exited on its own between two samples is
// reported as overflowed with no kill at all — and stopPhrase, seeing neither killedTree nor exitUnconfirmed, worded it
// "the kill was refused (pid null)", sending the reader after a kill failure that never happened.
test('G-4: an exit past the cap with no kill attempted is not worded as a refused kill', async (t) => {
  const { runChild, stopPhrase } = await import('../scripts/io/run-child.mjs');
  const os = await import('node:os');
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-g4-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  // Writes 64 KiB past a 1 KiB cap and exits. The sampler is set past the test's life (pollMs), so only the final check at
  // exit can see the overflow: under full-suite load the child once took long enough that the 100 ms sampler caught it and
  // killed it, and the test read "process tree killed" — a timing flake, not the behaviour under test.
  const res = await runChild({
    cmd: process.execPath, args: ['-e', "process.stdout.write('x'.repeat(65536))"], cwd: d, env: process.env,
    stdoutPath: path.join(d, 'out'), stderrPath: path.join(d, 'err'), timeoutMs: 20_000, outputCapBytes: 1024, pollMs: 60_000,
  });
  assert.equal(res.overflowed, true, 'the final size check did not see the overflow, so nothing is tested');
  assert.equal(res.killRefused, null, 'a kill was refused — this is not the case under test');
  const phrase = stopPhrase(res);
  assert.doesNotMatch(phrase, /refused/, `an exit with no kill is worded as a refusal: "${phrase}"`);
  assert.doesNotMatch(phrase, /pid null/);
  assert.match(phrase, /exited/);
});

const reallyKill = (pid) => { try { process.kill(pid, 'SIGKILL'); } catch {} };
function driveSeam(t, { fakeSource, extra }) {
  const { base, dir } = repoRunDir({ runId: '20260101-000000-wording' });
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'node-settings.json'), JSON.stringify({ permissions: { defaultMode: 'manual', allow: [], deny: [] } }));
  const fake = path.join(base, 'fake-claude.mjs');
  fs.writeFileSync(fake, fakeSource);
  runScript('spawn-node.mjs', ['--run-dir', dir, '--repo-root', REPO_ROOT, '--node-id', 'code-audit', '--mode', 'lens',
    '--prompt', 'x', '--allowed-basis', 'convention', '--runtime-bin', fake, '--test-stop', 'unconfirmed', ...extra]);
  const status = JSON.parse(fs.readFileSync(path.join(dir, 'nodes', 'code-audit.status.json'), 'utf8'));
  if (Number.isInteger(status.orphan_pid)) t.after(() => reallyKill(status.orphan_pid));
  return status;
}

test('stage 6: a timed-out node whose kill was accepted but not seen to take effect is not called refused', (t) => {
  const status = driveSeam(t, { fakeSource: 'setInterval(() => {}, 1000);\n', extra: ['--timeout-minutes', '0.02'] });
  const sentence = status.validator_errors.find((e) => e.startsWith('timed out after'));
  assert.ok(sentence, `no timeout sentence: ${JSON.stringify(status.validator_errors)}`);
  assert.match(sentence, /not seen to exit/);
  assert.doesNotMatch(sentence, /refused/, 'an unconfirmed kill is misdiagnosed as a refusal');
});

// G-17 of 20261002-215002-stop-child-review claimed a runChild rejection leaves the status RUNNING, read as orchestrator
// death. Measured, it does not: the rejection reaches spawn-node's last-resort handler, which writes a terminal BLOCKED
// naming the error. Declined as a defect; pinned here, green from the start, so the handler cannot be removed unseen.
test('G-17: a launch that fails before the child exists still leaves a terminal status naming why', (t) => {
  const { base, dir } = repoRunDir({ runId: '20260101-000000-launchfail' });
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'node-settings.json'), JSON.stringify({ permissions: { defaultMode: 'manual', allow: [], deny: [] } }));
  fs.mkdirSync(path.join(dir, 'evidence', 'code-audit', 'stdout.json'), { recursive: true });   // opening it for write fails
  const fake = path.join(base, 'fake-claude.mjs');
  fs.writeFileSync(fake, 'process.stdout.write("{}");\n');
  const r = runScript('spawn-node.mjs', ['--run-dir', dir, '--repo-root', REPO_ROOT, '--node-id', 'code-audit', '--mode', 'lens',
    '--prompt', 'x', '--allowed-basis', 'convention', '--timeout-minutes', '1', '--runtime-bin', fake]);
  const status = JSON.parse(fs.readFileSync(path.join(dir, 'nodes', 'code-audit.status.json'), 'utf8'));
  assert.notEqual(r.status, 0);
  assert.equal(status.state, 'BLOCKED', 'a failed launch left a non-terminal status');
  assert.ok(status.validator_errors.some((e) => /EISDIR|stdout\.json/.test(e)), `the cause is not named: ${JSON.stringify(status.validator_errors)}`);
});

test('stage 6: an overflowed node whose kill was accepted but not seen to take effect is not called refused (ledger spawn-node.mjs:1520)', (t) => {
  // 2 MiB past a 1 MiB cap, then idle: the cap fires, the seam accepts the kill without effect.
  const flood = "const c = 'x'.repeat(256 * 1024); let n = 0; const w = () => { if (n++ < 8) process.stdout.write(c, w); }; w(); setInterval(() => {}, 1000);\n";
  const status = driveSeam(t, { fakeSource: flood, extra: ['--timeout-minutes', '1', '--output-cap-mb', '1'] });
  const sentence = status.validator_errors.find((e) => e.startsWith('output exceeded'));
  assert.ok(sentence, `no overflow sentence: ${JSON.stringify(status.validator_errors)}`);
  assert.match(sentence, /not seen to exit/);
  assert.doesNotMatch(sentence, /refused/, 'an unconfirmed kill is misdiagnosed as a refusal, beside its own kill_unconfirmed');
  assert.equal(status.kill_unconfirmed, true);
});
