// G-3 of 20261122-154951-m3s7-b3-remediation-4-review (panel-codex-security): extract-sessions sliced a session's title
// to 120 characters BEFORE redacting it, so a cut that removed a quoted credential's closing quote left the value
// unredacted, and it was written into nodes.json. Driven through the real script over a fixture home.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'extract-sessions.mjs');

// The key built at runtime (operator, 2026-11-19: "Build the fakes at runtime (Recommended)"): the literal
// `password: "..."` is what the public CI's secret scan flags, whatever the value is.
const PASS_KEY = ['pass', 'word'].join('');

test('a credential cut by the title limit is still redacted (G-3)', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'xs-title-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const src = path.join(home, '.claude', 'projects', 'fixture');
  fs.mkdirSync(src, { recursive: true });
  const lead = 'w'.repeat(90) + ' ';
  const title = `${lead}${PASS_KEY}: "correct horse battery staple"`;   // the 120-character cut falls inside the quotes
  assert.ok(title.length > 120 && title.slice(0, 120).includes('correct horse') && !title.slice(0, 120).endsWith('"'));
  const lines = [
    { type: 'ai-title', aiTitle: title, sessionId: 'n1', entrypoint: 'sdk-cli', timestamp: '2026-11-01T00:00:00Z' },
    { type: 'assistant', sessionId: 'n1', timestamp: '2026-11-01T00:00:01Z', message: { content: [{ type: 'tool_use', name: 'Read' }] } },
  ];
  fs.writeFileSync(path.join(src, 's1.jsonl'), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  const out = path.join(home, 'out');
  const r = spawnSync(process.execPath, [SCRIPT, '--project', 'fixture', '--out', out, '--nodes-only'], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  assert.equal(r.status, 0, r.stderr);
  const written = fs.readFileSync(path.join(out, 'nodes.json'), 'utf8');
  assert.match(written, /wwww/, 'the title reached nodes.json');
  assert.doesNotMatch(written, /correct horse/);
  assert.doesNotMatch(r.stdout, /correct horse/);
});

test('a credential cut by the turn text limit is still redacted in the digest (G-3, same class)', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'xs-turn-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const src = path.join(home, '.claude', 'projects', 'fixture');
  fs.mkdirSync(src, { recursive: true });
  const lead = 'w'.repeat(3970) + ' ';   // TEXT_CAP is 4000: the cut falls inside the quoted value
  const text = `${lead}${PASS_KEY}: "correct horse battery staple"`;
  assert.ok(text.slice(0, 4000).includes('correct horse') && !text.slice(0, 4000).endsWith('"'));
  const lines = [{ type: 'user', sessionId: 'h1', entrypoint: 'cli', timestamp: '2026-11-01T00:00:00Z', message: { content: text } }];
  fs.writeFileSync(path.join(src, 's1.jsonl'), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  const out = path.join(home, 'out');
  const r = spawnSync(process.execPath, [SCRIPT, '--project', 'fixture', '--out', out, '--human-only'], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  assert.equal(r.status, 0, r.stderr);
  const digest = fs.readdirSync(out).filter((f) => f.endsWith('.md')).map((f) => fs.readFileSync(path.join(out, f), 'utf8')).join('\n');
  assert.match(digest, /wwww/, 'the turn reached the digest');
  assert.doesNotMatch(digest, /correct horse/);
});
