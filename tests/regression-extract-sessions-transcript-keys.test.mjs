// extract-sessions reads strings a transcript controls and used them as object keys and file names (G-22, G-24, G-26,
// G-28 of 20261122-035227-m3s7-b3-review):
//   - a tool named `constructor` or `__proto__` resolved a prototype member of the per-session tool counter (G-22);
//   - a node title whose first word is `constructor` made `(byLens[k] ??= []).push` throw (G-28);
//   - a turn timestamp such as `../../x` became the digest's file name and escaped --out (G-24);
//   - an invalid --since compared lexically and produced a successful, empty digest (G-26).
// Each is driven through the real script over a fixture transcript directory under a fixture home.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'extract-sessions.mjs');

function fixture(lines) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'xs-keys-'));
  const src = path.join(home, '.claude', 'projects', 'fixture');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 's1.jsonl'), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  const out = path.join(home, 'deep', 'a', 'out');
  return { home, out };
}

function run({ home, out }, extra = []) {
  return spawnSync(process.execPath, [SCRIPT, '--project', 'fixture', '--out', out, ...extra], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home },
  });
}

test('a node session whose tools and title are prototype names is counted, not corrupted (G-22, G-28)', (t) => {
  const fx = fixture([
    { type: 'ai-title', aiTitle: 'constructor of things', sessionId: 'n1', entrypoint: 'sdk-cli', timestamp: '2026-11-01T00:00:00Z' },
    { type: 'assistant', sessionId: 'n1', timestamp: '2026-11-01T00:00:01Z',
      message: { content: [{ type: 'tool_use', name: 'constructor' }, { type: 'tool_use', name: '__proto__' }, { type: 'tool_use', name: 'Read' }] } },
  ]);
  t.after(() => fs.rmSync(fx.home, { recursive: true, force: true }));
  const r = run(fx, ['--nodes-only']);
  assert.equal(r.status, 0, r.stderr);
  const nodes = JSON.parse(fs.readFileSync(path.join(fx.out, 'nodes.json'), 'utf8'));
  const row = nodes.rows[0];
  assert.deepEqual(Object.entries(row.tools).sort(), [['Read', 1], ['__proto__', 1], ['constructor', 1]]);
  assert.equal(row.tool_calls, 3);
  assert.match(r.stdout, /constructor/);
});

test('a turn timestamp that is not a date cannot name a file outside --out (G-24)', (t) => {
  const fx = fixture([
    { type: 'user', sessionId: 'h1', entrypoint: 'cli', timestamp: '../../x', message: { content: 'hello there' } },
  ]);
  t.after(() => fs.rmSync(fx.home, { recursive: true, force: true }));
  const r = run(fx, ['--human-only']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(path.join(fx.out, '..', '..', 'x.md')), false, 'a digest was written outside --out');
  const written = fs.readdirSync(fx.out).filter((f) => f.endsWith('.md'));
  assert.deepEqual(written, ['undated.md']);
});

test('a git log that fails is reported, not written as a day with no commits (G-23)', (t) => {
  const fx = fixture([
    { type: 'user', sessionId: 'h1', entrypoint: 'cli', timestamp: '2026-11-01T00:00:00Z', message: { content: 'hello there' } },
  ]);
  t.after(() => fs.rmSync(fx.home, { recursive: true, force: true }));
  // GIT_DIR names no repository, so `git log` fails whatever directory the script runs in.
  const r = spawnSync(process.execPath, [SCRIPT, '--project', 'fixture', '--out', fx.out, '--human-only'], {
    cwd: ROOT, encoding: 'utf8',
    env: { ...process.env, HOME: fx.home, USERPROFILE: fx.home, GIT_DIR: path.join(fx.home, 'no-such-repo') },
  });
  assert.notEqual(r.status, 0, 'a failed git log produced a successful digest');
  assert.match(r.stderr, /git log/);
});

test('an invalid --since is refused, not read as a window that excludes everything (G-26)', (t) => {
  const fx = fixture([
    { type: 'user', sessionId: 'h1', entrypoint: 'cli', timestamp: '2026-11-01T00:00:00Z', message: { content: 'hello there' } },
  ]);
  t.after(() => fs.rmSync(fx.home, { recursive: true, force: true }));
  const r = run(fx, ['--since', 'banana']);
  assert.notEqual(r.status, 0, 'an invalid --since produced a successful digest');
  assert.match(r.stderr, /--since/);
});

test('an impossible calendar date for --since is refused, not rolled over by Date.parse (G-9)', (t) => {
  // G-9 of 20261122-044843-m3s7-b3-remediation-review: V8 parses 2026-02-31 as 2026-03-03, so the regex and the NaN
  // check both passed and the window compared lexically against a date that does not exist.
  const fx = fixture([
    { type: 'user', sessionId: 'h1', entrypoint: 'cli', timestamp: '2026-11-01T00:00:00Z', message: { content: 'hello there' } },
  ]);
  t.after(() => fs.rmSync(fx.home, { recursive: true, force: true }));
  const r = run(fx, ['--since', '2026-02-31']);
  assert.notEqual(r.status, 0, 'an impossible --since produced a successful digest');
  assert.match(r.stderr, /--since/);
});

test('a --project that leaves the transcript root is refused, and nothing is read or written (G-7)', (t) => {
  // G-7 of 20261122-055431-m3s7-b3-remediation-2-review: --project was joined below ~/.claude/projects with no check, so
  // `..` reached any directory of JSONL files and copied it into the digest.
  const fx = fixture([]);
  t.after(() => fs.rmSync(fx.home, { recursive: true, force: true }));
  const outside = path.join(fx.home, '.claude', 'escaped');
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 's1.jsonl'), `${JSON.stringify({ type: 'user', sessionId: 'h1', entrypoint: 'cli', timestamp: '2026-11-01T00:00:00Z', message: { content: 'outside the root' } })}\n`);
  for (const project of ['../escaped', '..', '.', path.join(fx.home, '.claude', 'escaped')]) {
    const r = spawnSync(process.execPath, [SCRIPT, '--project', project, '--out', fx.out, '--human-only'], {
      cwd: ROOT, encoding: 'utf8', env: { ...process.env, HOME: fx.home, USERPROFILE: fx.home },
    });
    assert.equal(r.status, 2, `--project ${project} was not refused:\n${r.stderr}`);
    assert.match(r.stderr, /--project/);
    assert.equal(fs.existsSync(fx.out), false, `--project ${project} wrote a digest`);
  }
});

test('a credential the operator pasted into a turn is redacted in the digest (G-8)', (t) => {
  // G-8 of 20261122-055431-m3s7-b3-remediation-2-review: operator turns were copied verbatim, so a pasted token was
  // duplicated into the digest files. Built at run time, so no literal here matches the push scan.
  const token = ['gh', 'p_', 'Q7'.repeat(18)].join('');
  const fx = fixture([
    { type: 'user', sessionId: 'h1', entrypoint: 'cli', timestamp: '2026-11-01T00:00:00Z', message: { content: `try this one ${token} please` } },
  ]);
  t.after(() => fs.rmSync(fx.home, { recursive: true, force: true }));
  const r = run(fx, ['--human-only']);
  assert.equal(r.status, 0, r.stderr);
  const text = fs.readdirSync(fx.out).filter((f) => f.endsWith('.md')).map((f) => fs.readFileSync(path.join(fx.out, f), 'utf8')).join('\n');
  assert.match(text, /try this one/, 'the turn itself was not written');
  assert.ok(!text.includes(token), 'the pasted token was copied into the digest');
  assert.match(text, /\[redacted: GitHub token\]/);

  // G-6 of 20261122-144505-m3s7-b3-remediation-3-review: a node session's title, cwd and branch went into nodes.json, and
  // the run's summary, verbatim.
  const nx = fixture([
    { type: 'ai-title', aiTitle: `code-audit ${token}`, sessionId: 'n1', entrypoint: 'sdk-cli', timestamp: '2026-11-01T00:00:00Z',
      cwd: `/work/${token}`, gitBranch: `feature/${token}` },
    { type: 'assistant', sessionId: 'n1', timestamp: '2026-11-01T00:00:01Z', message: { content: [{ type: 'tool_use', name: 'Read' }] } },
  ]);
  t.after(() => fs.rmSync(nx.home, { recursive: true, force: true }));
  const n = run(nx, ['--nodes-only']);
  assert.equal(n.status, 0, n.stderr);
  const nodes = fs.readFileSync(path.join(nx.out, 'nodes.json'), 'utf8');
  assert.ok(!nodes.includes(token), `a node's metadata carried the token into nodes.json:\n${nodes}`);
  assert.ok(!n.stdout.includes(token), 'the token was printed in the summary');
  assert.match(nodes, /code-audit \[redacted: GitHub token\]/);
});

test('a transcript that cannot be read is named and the run exits nonzero, not presented as a full digest (G-13)', (t) => {
  // G-13 of 20261122-044843-m3s7-b3-remediation-review: the unreadable transcript was printed and the run still exited 0.
  const fx = fixture([
    { type: 'user', sessionId: 'h1', entrypoint: 'cli', timestamp: '2026-11-01T00:00:00Z', message: { content: 'hello there' } },
  ]);
  t.after(() => fs.rmSync(fx.home, { recursive: true, force: true }));
  // A directory with a transcript's name: listed as one, and its read fails (EISDIR).
  fs.mkdirSync(path.join(fx.home, '.claude', 'projects', 'fixture', 's2.jsonl'));
  const r = run(fx, ['--nodes-only']);
  assert.match(r.stderr, /unreadable: s2\.jsonl/);
  assert.notEqual(r.status, 0, 'a digest missing an unreadable transcript exited 0');
});
