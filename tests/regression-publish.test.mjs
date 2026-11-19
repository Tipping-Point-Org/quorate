// THE RELEASE SNAPSHOT (m2-public-release.plan.md stage 2; ROADMAP D2 and D4). The public repository receives one
// squashed commit per release, and nothing private or machine-local may ride in it. Written red first, before
// scripts/publish.mjs existed: each case below is a way a publish could ship what it must not, or commit as the wrong
// person.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript, REPO_ROOT, publishedForm } from './helpers.mjs';
import { planSnapshot, changelogEntry, parseIdentity, validateManifest, contractDrift, scanText, applyAllowances, lineSha256, publicContractText, validateLocalPatterns } from '../scripts/lib/publish.mjs';
import * as lib from '../scripts/lib/publish.mjs';
import { contractBlocks } from '../scripts/lib/contract-source.mjs';
import { parseContractYaml } from '../scripts/lib/contract-yaml.mjs';

const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const id = (cwd) => { git(cwd, 'config', 'user.email', 'fixture@example.invalid'); git(cwd, 'config', 'user.name', 'fixture'); };
// A stand-in for gitleaks that finds nothing: the scan's own refusal is tested against the real binary, below.
const CLEAN_SCANNER = JSON.stringify([process.execPath, '-e', 'process.exit(0)']);
// Built at run time: this file ships, and the marker written out here would stop the publish of this repository itself.
const MARKER = ['PUBLISH', 'PLACEHOLDER'].join('-');
// A stand-in that reports one finding in src/fixture-secret.js, as gitleaks' JSON report does, and exits 99.
const FINDING_SCANNER = JSON.stringify([process.execPath, '-e', [
  'const a = process.argv; const p = a[a.indexOf("--report-path") + 1]; const d = a[a.indexOf("dir") + 1];',
  'require("fs").writeFileSync(p, JSON.stringify([{ File: require("path").join(d, "src", "fixture-secret.js"), StartLine: 1, RuleID: "generic-api-key" }]));',
  'process.exit(99);'].join(' ')]);

const contract = (request) => ['```yaml', 'graph_contract_version: 6', 'project: fixture', 'commands:', '  build: ""',
  '  test: ""', 'source_globs: ["src/**"]', 'doc_paths: []', 'doc_roles:', `  request: "${request}"`, '```', ''].join('\n');

function fixture(t, { files = {}, manifest = {}, local = { patterns: [{ name: 'operator', regex: 'opname', flags: 'i' }, { name: 'private-repo-owner', regex: 'privowner', flags: 'i' }] } } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'q-publish-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repo = path.join(base, 'repo');
  const all = {
    'VERSION': '0.3.0\n',
    'CHANGELOG.md': '# Changelog\n\n## 0.3.0 · the first release\n\nWhat a consumer must change: nothing.\n\n## 2026-09-02 · older\n\nold\n',
    'src/a.js': 'export const a = 1;\n',
    '.claude/reviews/run/gate.json': '{"private": true}\n',
    'publish/manifest.json': JSON.stringify({ version: 1, exclude: ['.claude/reviews'], replace: {},
      patterns: [{ name: 'windows-drive-path', regex: '(^|[^A-Za-z0-9])[A-Za-z]:\\\\[A-Za-z0-9_.-]' }],
      markers: [MARKER], ...manifest }),
    '.gitignore': '.claude/publish.local.json\n',
    // The snapshot's own checks, as stand-ins that pass: a committing publish always runs them (G-29).
    'scripts/check-syntax.mjs': 'process.exit(0);\n',
    'tests/run-all.mjs': 'process.exit(0);\n',
    'scripts/new-run.mjs': 'process.exit(0);\n',
    ...files,
  };
  for (const [rel, text] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), text);
  }
  git(repo, 'init', '-q', '-b', 'master'); id(repo); git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'source');
  if (local) fs.writeFileSync(path.join(repo, '.claude', 'publish.local.json'), JSON.stringify(local));
  const out = path.join(base, 'public');
  fs.mkdirSync(out);
  git(out, 'init', '-q'); id(out);
  fs.writeFileSync(path.join(out, 'stale.txt'), 'from an earlier release\n');
  git(out, 'add', '-A'); git(out, 'commit', '-qm', 'earlier release');
  const publish = (extra = [], env = {}) => runScript('publish.mjs', ['--repo-root', repo, '--ref', 'HEAD', ...extra],
    { cwd: repo, env: { QUORATE_PUBLISH_GITLEAKS: CLEAN_SCANNER, ...env } });
  const commit = (extra = []) => publish(['--out', out, '--identity', 'New Account <123+newacct@users.noreply.github.com>', ...extra]);
  return { repo, out, publish, commit };
}

test('a clean snapshot is committed into the public clone: exclusions gone, earlier content replaced, never pushed', (t) => {
  const f = fixture(t);
  const r = f.commit();
  assert.equal(r.status, 0, r.output);
  assert.ok(fs.existsSync(path.join(f.out, 'src', 'a.js')));
  assert.ok(!fs.existsSync(path.join(f.out, '.claude', 'reviews')), 'an excluded path reached the public clone');
  assert.ok(!fs.existsSync(path.join(f.out, 'stale.txt')), "the earlier release's file survived the snapshot");
  assert.equal(git(f.out, 'rev-list', '--count', 'HEAD').stdout.trim(), '2');
  assert.match(r.output, /not pushed/);
});

test('the commit message is the release CHANGELOG entry, with the source commit', (t) => {
  const f = fixture(t);
  assert.equal(f.commit().status, 0);
  const msg = git(f.out, 'log', '-1', '--format=%B').stdout;
  assert.match(msg, /^quorate 0\.3\.0: the first release/);
  assert.match(msg, /What a consumer must change: nothing\./);
  assert.doesNotMatch(msg, /old/, 'the next section leaked into the message');
  assert.match(msg, new RegExp(`source commit ${git(f.repo, 'rev-parse', 'HEAD').stdout.trim()}`));
});

test('the commit is authored and committed as --identity, never the machine\'s git identity', (t) => {
  const f = fixture(t);
  assert.equal(f.commit().status, 0);
  assert.equal(git(f.out, 'log', '-1', '--format=%an <%ae>|%cn <%ce>').stdout.trim(),
    'New Account <123+newacct@users.noreply.github.com>|New Account <123+newacct@users.noreply.github.com>');
});

test('a machine-local path in a shipped file is named, and nothing is committed', (t) => {
  const f = fixture(t, { files: { 'docs/setup.md': 'line one\nclone into F:\\work\\thing\n' } });
  const r = f.commit();
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, /docs\/setup\.md:2 windows-drive-path/);
  assert.equal(git(f.out, 'rev-list', '--count', 'HEAD').stdout.trim(), '1', 'a refused snapshot was committed');
});

test('the operator\'s identity, from the untracked local file, is named wherever it ships', (t) => {
  const f = fixture(t, { files: { 'src/b.js': '// written by OpName\n' } });
  const r = f.commit();
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, /src\/b\.js:1 local:operator/);
});

test('an identity in an EXCLUDED file is not a finding: only what ships is scanned', (t) => {
  const f = fixture(t, { files: { '.claude/reviews/run/note.md': 'opname was here\n' } });
  assert.equal(f.commit().status, 0);
});

test('no local identity file refuses the publish rather than scanning without it', (t) => {
  const f = fixture(t, { local: null });
  const r = f.publish(['--dry-run', '--no-suite']);
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, /publish\.local\.json is missing/);
});

test('a placeholder marker refuses the publish (NOTICE before the holder\'s name is known)', (t) => {
  const f = fixture(t, { files: { NOTICE: `Copyright 2026 ${MARKER}\n` } });
  const r = f.publish(['--dry-run', '--no-suite']);
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, /NOTICE:1 placeholder/);
});

test('a tracked change in the working tree refuses the publish', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.repo, 'src', 'a.js'), 'changed\n');
  const r = f.publish(['--dry-run', '--no-suite']);
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, /tracked changes/);
});

// G-5 of 20261119-000606-m2-9c-d1: the check passed --untracked-files=no, so a new, unignored file at a path that ships
// was accepted, and the commit published was not the tree the operator was looking at. An untracked file under an
// excluded path (a review run left in .claude/reviews) is not refused: it could never ship.
test('an untracked, unignored file at a path that ships refuses the publish; one under an excluded path does not', (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.repo, '.claude', 'reviews', 'later'), { recursive: true });
  fs.writeFileSync(path.join(f.repo, '.claude', 'reviews', 'later', 'gate.json'), '{}\n');
  const excludedOnly = f.publish(['--dry-run', '--no-suite']);
  assert.equal(excludedOnly.status, 0, excludedOnly.output);
  fs.writeFileSync(path.join(f.repo, 'src', 'new.js'), 'export const n = 1;\n');
  const r = f.publish(['--dry-run', '--no-suite']);
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, /untracked/);
  assert.match(r.output, /src\/new\.js/);
  assert.doesNotMatch(r.output, /\.claude\/reviews\/later/);
});

test('a release with no CHANGELOG section of its version is refused', (t) => {
  const f = fixture(t, { files: { VERSION: '0.4.0\n' } });
  const r = f.publish(['--dry-run', '--no-suite']);
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, /no "## 0\.4\.0" section/);
});

test('the snapshot\'s own suite failing refuses the publish', (t) => {
  const f = fixture(t, { files: {
    'scripts/check-syntax.mjs': 'process.exit(0);\n',
    'tests/run-all.mjs': 'console.log("1 failing"); process.exit(1);\n',
    'scripts/new-run.mjs': 'process.exit(0);\n',
  } });
  const r = f.publish(['--dry-run']);
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, /snapshot tests: exit 1/);
  assert.match(r.output, /tests check failed/);
});

// G-25 of 20261116-221234-m2-9a-high-2 (I-31): the snapshot's checks and the secret scanner were given process.env whole,
// so the run pin, the runtime's auth and every secret-shaped variable reached code from the snapshot.
test('the snapshot\'s checks and the secret scanner get no run pin, runtime auth or secret-shaped variable', (t) => {
  const leaks = 'const n = ["QUORATE_RUN_ID", "ANTHROPIC_API_KEY", "FIXTURE_SECRET_TOKEN"].filter((k) => process.env[k]);'
    + ' if (n.length) { console.log("LEAKED " + n.join(",")); process.exit(1); }';
  const f = fixture(t, { files: {
    'scripts/check-syntax.mjs': `${leaks} process.exit(0);\n`,
    'tests/run-all.mjs': `${leaks} process.exit(0);\n`,
    'scripts/new-run.mjs': `${leaks} process.exit(0);\n`,
  } });
  // Made-up values, built at runtime so no literal in this file matches the push scan (.gitleaksignore's convention;
  // operator, 2026-11-16: "Fingerprint both, fix the fixture (Recommended)").
  const FAKE_AUTH = ['fixture', 'auth'].join('-');
  const FAKE_TOKEN = ['fixture', 'token'].join('-');
  const env = { QUORATE_RUN_ID: 'r-fixture', ANTHROPIC_API_KEY: FAKE_AUTH, FIXTURE_SECRET_TOKEN: FAKE_TOKEN,
    QUORATE_PUBLISH_GITLEAKS: JSON.stringify([process.execPath, '-e', `${leaks} process.exit(0);`]) };
  const r = f.publish(['--dry-run'], env);
  assert.doesNotMatch(r.output, /^LEAKED /m, r.output);
  assert.equal(r.status, 0, r.output);
});

// G-23 of 20261116-221234-m2-9a-high-2 (I-2): suppression comes from the manifest only. The scan named no ignore path and
// scanned a tree holding the shipped .gitleaksignore, so either copy of it could suppress a snapshot finding.
test('the secret scan honours no .gitleaksignore: not the shipped one, not the working directory\'s', (t) => {
  const f = fixture(t, { files: { '.gitleaksignore': 'abc:src/a.js:generic-api-key:1\n' } });
  const probe = [
    'const a = process.argv; const d = a[a.indexOf("dir") + 1]; const i = a.indexOf("--gitleaks-ignore-path");',
    'const fs = require("fs"); const p = require("path");',
    'if (fs.existsSync(p.join(d, ".gitleaksignore"))) { console.log("HONOURED shipped"); process.exit(1); }',
    'if (i < 0) { console.log("HONOURED cwd"); process.exit(1); }',
    'const ip = a[i + 1]; const f = fs.existsSync(ip) && fs.statSync(ip).isDirectory() ? p.join(ip, ".gitleaksignore") : ip;',
    'if (fs.existsSync(f)) { console.log("HONOURED " + f); process.exit(1); }',
    'process.exit(0);'].join(' ');
  const r = f.publish(['--dry-run', '--no-suite'], { QUORATE_PUBLISH_GITLEAKS: JSON.stringify([process.execPath, '-e', probe]) });
  assert.doesNotMatch(r.output, /^HONOURED /m, r.output);
  assert.equal(r.status, 0, r.output);
});

// G-22 of 20261116-221234-m2-9a-high-2: a shipped file with a NUL byte skipped every text pattern, and gitleaks is never
// given the identity or machine-local patterns, so a UTF-16 or binary file carrying the operator's name shipped unreported.
test('an identity in a UTF-16 or binary file is still named, and nothing is committed', (t) => {
  for (const [rel, bytes] of [['docs/notes-utf16.txt', Buffer.from('﻿written by OpName here\n', 'utf16le')],
    ['assets/blob.bin', Buffer.concat([Buffer.from([0, 1, 2, 0]), Buffer.from('meta: opname', 'latin1'), Buffer.from([0])])]]) {
    const f = fixture(t, { files: { [rel]: bytes } });
    const r = f.publish(['--dry-run', '--no-suite']);
    assert.equal(r.status, 1, r.output);
    assert.match(r.output, new RegExp(`${rel.replace(/[.]/g, '\\.')}:\\d+ local:operator`), r.output);
  }
});

test('the published contract may differ from the private one only in doc_roles.request', (t) => {
  // The public file as the generator makes it (its keys are checked, and a key behind the private one is refused, tested below).
  const generated = publicContractText(privateClaude()).text;
  const ok = fixture(t, { files: { 'CLAUDE.md': privateClaude(), 'publish/CLAUDE.public.md': generated },
    manifest: { replace: { 'CLAUDE.md': 'publish/CLAUDE.public.md' } } });
  const r = ok.commit();
  assert.equal(r.status, 0, r.output);
  assert.equal(fs.readFileSync(path.join(ok.out, 'CLAUDE.md'), 'utf8'), generated);
  assert.ok(!fs.existsSync(path.join(ok.out, 'publish', 'CLAUDE.public.md')), 'the replacement also shipped under its own name');

  const drifted = contract('').replace('project: fixture', 'project: other');
  const bad = fixture(t, { files: { 'CLAUDE.md': contract('.claude/requests/x.md'), 'publish/CLAUDE.public.md': drifted },
    manifest: { replace: { 'CLAUDE.md': 'publish/CLAUDE.public.md' } } });
  const r2 = bad.commit();
  assert.equal(r2.status, 1, r2.output);
  assert.match(r2.output, /differs from the private one at project/);
});

test('a scanner override is said; a missing scanner refuses', (t) => {
  const f = fixture(t);
  assert.match(f.publish(['--dry-run', '--no-suite']).output, /OVERRIDDEN by QUORATE_PUBLISH_GITLEAKS/);
  const r = f.publish(['--dry-run', '--no-suite'], { QUORATE_PUBLISH_GITLEAKS: JSON.stringify(['no-such-scanner-q7x']) });
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, /never runs without the secret scan/);
});

const hasGitleaks = spawnSync('gitleaks', ['version'], { encoding: 'utf8' }).status === 0;
test('a planted secret fails the real gitleaks scan', { skip: hasGitleaks ? false : 'gitleaks is not installed here (CI installs it in the secrets job only)' }, (t) => {
  // Built at run time, so this file never carries a secret-shaped literal for the repository's own scan to find.
  const token = ['gh', 'p_', 'R8xQ2vLm9TbK4wZs7NcJ1hYd6FgP3aUe5Vk0'].join('');
  const f = fixture(t, { files: { 'src/config.js': `export const token = "${token}";\n` } });
  const r = f.publish(['--dry-run', '--no-suite'], { QUORATE_PUBLISH_GITLEAKS: '' });
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, /gitleaks: a secret was found/);
});

// DECLARED ALLOWANCES (operator, 2026-11-13: "Declared allowances (Recommended)"): a hit the manifest accepts, by file
// and pattern, with its reason; never a marker or the operator's identity, and never one that matches nothing.
test('an allowance covers its hit by file, pattern and line; the same hit in another file still stops the publish', (t) => {
  const allow = [{ path: 'tests/win.test.mjs', pattern: 'windows-drive-path', line_sha256: lineSha256('const p = "C:\\work\\x";'), reason: 'tests a Windows path' }];
  const ok = fixture(t, { files: { 'tests/win.test.mjs': 'const p = "C:\\work\\x";\n' }, manifest: { allow } });
  const r = ok.commit();
  assert.equal(r.status, 0, r.output);
  assert.match(r.output, /0 finding\(s\), 1 allowed by the manifest/);
  const other = fixture(t, { files: { 'tests/win.test.mjs': 'const p = "C:\\work\\x";\n', 'docs/a.md': 'C:\\work\\x\n' },
    manifest: { allow } });
  const r2 = other.commit();
  assert.equal(r2.status, 1, r2.output);
  assert.match(r2.output, /docs\/a\.md:1 windows-drive-path/);
});

test('an allowance that matches nothing is stale and refuses the publish', (t) => {
  const f = fixture(t, { manifest: { allow: [{ path: 'gone.md', pattern: 'windows-drive-path', line_sha256: lineSha256('C:\\x'), reason: 'was an example' }] } });
  const r = f.publish(['--dry-run', '--no-suite']);
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, /allowance matched nothing, so it is stale: gone\.md windows-drive-path/);
});

test('a gitleaks finding is allowed only through its report, by file and rule', (t) => {
  const allowed = fixture(t, { files: { 'src/fixture-secret.js': 'planted\n' },
    manifest: { allow: [{ path: 'src/fixture-secret.js', pattern: 'gitleaks:generic-api-key', line_sha256: lineSha256('planted'), reason: 'a test plants it' }] } });
  const r = allowed.publish(['--dry-run', '--no-suite'], { QUORATE_PUBLISH_GITLEAKS: FINDING_SCANNER });
  assert.equal(r.status, 0, r.output);
  assert.match(r.output, /gitleaks: every finding allowed by the manifest/);
  const not = fixture(t, { files: { 'src/fixture-secret.js': 'planted\n' } });
  const r2 = not.publish(['--dry-run', '--no-suite'], { QUORATE_PUBLISH_GITLEAKS: FINDING_SCANNER });
  assert.equal(r2.status, 1, r2.output);
  assert.match(r2.output, /src\/fixture-secret\.js:1 gitleaks:generic-api-key/);
});

test('an allowance can name neither a marker nor an identity pattern', () => {
  assert.match(validateManifest({ version: 1, markers: ['M'], allow: [{ path: 'a', pattern: 'M', line_sha256: lineSha256('M'), reason: 'r' }] }).error,
    /never allowed/);
  assert.match(validateManifest({ version: 1, allow: [{ path: 'a', pattern: 'local:operator', line_sha256: lineSha256('x'), reason: 'r' }] }).error,
    /never allowed/);
  assert.match(validateManifest({ version: 1, allow: [{ path: 'a', pattern: 'gitleaks:x', reason: ' ' }] }).error, /a reason/);
  const { kept } = applyAllowances([{ path: 'a', line: 1, marker: 'M' }], [{ path: 'a', pattern: 'M', reason: 'r' }]);
  assert.equal(kept.length, 1, 'a marker hit was allowed');
});

// THE PUBLISHED CONTRACT IS GENERATED (Q12, "Declared replacement"): CLAUDE.md with the private history above
// doc_roles.request replaced and the key empty. A hand-kept copy would go stale under every check that reads it.
const privateClaude = (body = '') => ['# fixture', body, '```yaml', 'graph_contract_version: 6', 'project: fixture', 'commands:',
  '  build: ""', '  test: ""', 'source_globs: ["src/**"]', 'doc_paths: []', 'doc_roles:', '  # MOVED 2026-01-01 to x (operator: "yes")',
  '  # MOVED 2026-01-02 to y', '  request: ".claude/requests/y.md"', '```', ''].join('\n');

test('publicContractText drops the comment above doc_roles.request and empties the key, and nothing else', () => {
  const made = publicContractText(privateClaude('the prose stays'));
  assert.equal(made.error, undefined);
  assert.doesNotMatch(made.text, /MOVED|requests\/y\.md/);
  assert.match(made.text, /^ {2}request: {6}""$/m);
  assert.match(made.text, /the prose stays/);
  assert.deepEqual(contractDrift(
    parseContractYaml(contractBlocks(privateClaude())[0]), parseContractYaml(contractBlocks(made.text)[0])), []);
  assert.ok(publicContractText('no contract here').error);
});

test('a stale published contract refuses the publish, naming the key it is stale at', (t) => {
  // Stale is a KEY behind the private contract's; a comment is the reader's (G-32 of 20261117-013640-m2-9a-final).
  const priv = privateClaude('version one');
  const stale = publicContractText(privateClaude('version zero')).text.replace('build: ""', 'build: "old"');
  const f = fixture(t, { files: { 'CLAUDE.md': priv, 'publish/CLAUDE.public.md': stale },
    manifest: { replace: { 'CLAUDE.md': 'publish/CLAUDE.public.md' } } });
  const r = f.publish(['--dry-run', '--no-suite']);
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, /differs from the private one at commands\.build/);
  // THE MANIFEST OWNS THE PUBLISHED PATH (G-25 of 20261117-013640-m2-9a-final; A-1): a replacement moved to another path
  // in the manifest alone is still checked, not silently skipped.
  const moved = fixture(t, { files: { 'CLAUDE.md': priv, 'pub/C.public.md': stale },
    manifest: { replace: { 'CLAUDE.md': 'pub/C.public.md' } } });
  const m = moved.publish(['--dry-run', '--no-suite']);
  assert.equal(m.status, 1, `a published contract moved in the manifest skipped the check:
${m.output}`);
  assert.match(m.output, /differs from the private one at commands\.build/);
});

test('--write-public-contract writes the generated file, and a publish then passes', (t) => {
  const f = fixture(t, { files: { 'CLAUDE.md': privateClaude('current') }, manifest: { replace: { 'CLAUDE.md': 'publish/CLAUDE.public.md' } } });
  const w = runScript('publish.mjs', ['--write-public-contract', '--repo-root', f.repo], { cwd: f.repo });
  assert.equal(w.status, 0, w.output);
  git(f.repo, 'add', '-A'); git(f.repo, 'commit', '-qm', 'public contract');
  const r = f.commit();
  assert.equal(r.status, 0, r.output);
  assert.match(fs.readFileSync(path.join(f.out, 'CLAUDE.md'), 'utf8'), /^ {2}request: {6}""$/m);
  // It writes where the manifest says the published contract is (G-25 of 20261117-013640-m2-9a-final).
  const moved = fixture(t, { files: { 'CLAUDE.md': privateClaude('current') }, manifest: { replace: { 'CLAUDE.md': 'pub/C.public.md' } } });
  const mw = runScript('publish.mjs', ['--write-public-contract', '--repo-root', moved.repo], { cwd: moved.repo });
  assert.equal(mw.status, 0, mw.output);
  assert.ok(fs.existsSync(path.join(moved.repo, 'pub', 'C.public.md')), `--write-public-contract ignored the manifest's path:\n${mw.output}`);
});

// The decisions, directly.
// A REPLACEMENT'S SOURCE IS HELD TO THE EXCLUSIONS (G-11 of 20261117-031403-m2-9a-d1; operator: "Fix both; every
// occurrence is a hit (Recommended)"): only the published path was checked, so an excluded private file's bytes could
// ship under a public name.
test('planSnapshot: a replacement whose source is excluded is an error and ships nothing', () => {
  const m = validateManifest({ version: 1, exclude: ['private'], replace: { 'NOTES.md': 'private/notes.md' } }).manifest;
  const p = planSnapshot(['NOTES.md', 'private/notes.md', 'b'], m);
  assert.match(p.errors.join(), /replace NOTES\.md: its source private\/notes\.md is excluded/);
  assert.ok(!p.ship.some((s) => s.from === 'private/notes.md'), 'an excluded source shipped under a public name');
});

test('planSnapshot: a replacement source does not ship under its own name; a missing source is an error', () => {
  const m = validateManifest({ version: 1, exclude: ['private'], replace: { 'CLAUDE.md': 'pub/C.md', 'X': 'gone.md' } }).manifest;
  const p = planSnapshot(['CLAUDE.md', 'pub/C.md', 'private/a', 'b'], m);
  assert.deepEqual(p.ship, [{ path: 'b', from: 'b' }, { path: 'CLAUDE.md', from: 'pub/C.md' }].sort((x, y) => x.path.localeCompare(y.path)));
  assert.deepEqual(p.excluded, ['private/a']);
  assert.match(p.errors.join(), /gone\.md is not tracked/);
  // THE RELEASE'S GATE RULES ARE PURE DECISIONS, IN THIS MODULE (G-31 of 20261117-013640-m2-9a-final; ARCHITECTURE §2):
  // the gitleaks pass rule and the regular-file mode rule sat inline in scripts/publish.mjs, testable only end to end.
  assert.equal(typeof lib.secretScanPasses, 'function', 'the gitleaks pass rule is not a decision of lib/publish.mjs');
  assert.equal(typeof lib.shipsAsRegularFile, 'function', 'the regular-file mode rule is not a decision of lib/publish.mjs');
  const base = { missing: false, reportRead: true, kept: false, allowed: true };
  assert.equal(lib.secretScanPasses({ ...base, status: 0, allowed: false }), true, 'a clean scan does not pass');
  assert.equal(lib.secretScanPasses({ ...base, status: 99 }), true, 'a leak exit whose every finding is allowed does not pass');
  assert.equal(lib.secretScanPasses({ ...base, status: 99, kept: true }), false, 'a kept gitleaks finding passes');
  assert.equal(lib.secretScanPasses({ ...base, status: 99, reportRead: false }), false, 'an unread report passes');
  assert.equal(lib.secretScanPasses({ ...base, status: 99, allowed: false }), false, 'a leak exit with nothing allowed passes');
  assert.equal(lib.secretScanPasses({ ...base, missing: true, status: null }), false, 'a missing gitleaks passes');
  assert.equal(lib.secretScanPasses({ ...base, status: 2 }), false, 'a failed scan passes');
  for (const [mode, ok] of [['100644', true], ['100755', true], ['120000', false], ['160000', false], ['040000', false]]) {
    assert.equal(lib.shipsAsRegularFile(mode), ok, `mode ${mode}`);
  }
});

test('validateManifest refuses unknown keys, bad globs, g flags and paths leaving the repository', () => {
  assert.match(validateManifest({ version: 1, extra: 1 }).error, /unknown keys: extra/);
  assert.match(validateManifest({ version: 2 }).error, /version/);
  assert.match(validateManifest({ version: 1, patterns: [{ name: 'x', regex: 'a', flags: 'g' }] }).error, /g and y/);
  assert.match(validateManifest({ version: 1, replace: { 'a': '../b' } }).error, /leaves the repository/);
});

test('changelogEntry, parseIdentity, contractDrift and scanText', () => {
  assert.match(changelogEntry('## Unreleased\nx\n', '0.3.0').error, /no "## 0\.3\.0" section/);
  assert.equal(changelogEntry('## 0.3.0\n\nbody\n## 0.2.0\nold\n', '0.3.0').body, 'body');
  assert.deepEqual(parseIdentity('A B <a@b.c>'), { name: 'A B', email: 'a@b.c' });
  assert.ok(parseIdentity('no email').error);
  assert.deepEqual(contractDrift({ a: 1, doc_roles: { request: 'x' } }, { a: 1, doc_roles: { request: '' } }), []);
  assert.deepEqual(contractDrift({ a: 1 }, { a: 2 }), ['a']);
  const hits = scanText('f', 'ok\nsee F:\\x\n', { patterns: [{ name: 'drive', regex: '[A-Z]:\\\\' }] });
  assert.deepEqual(hits.map((h) => [h.line, h.name]), [[2, 'drive']]);
});

// G-18 of 20261116-200635-m2-9a-high: a manifest pattern NAMED local:<x> made the allow check accept local:<x>, so an
// allowance could suppress a renamed identity hit. The local: prefix belongs to the identity patterns alone.
test('validateManifest refuses a manifest pattern named with the local: prefix the identity patterns are renamed to', () => {
  const r = validateManifest({ version: 1, patterns: [{ name: 'local:operator', regex: 'x' }],
    allow: [{ path: 'a', pattern: 'local:operator', reason: 'r' }] });
  assert.ok(r.error, 'a manifest pattern named local:operator must be refused');
  assert.match(r.error, /local:/);
});

// G-17 of 20261116-200635-m2-9a-high: a replace target under .git passed isUnsafeRel and was copied over the public
// clone's git configuration. No published or source path may name a .git component.
test('validateManifest refuses a replace path with a .git component', () => {
  assert.match(validateManifest({ version: 1, replace: { '.git/config': 'pub/x' } }).error ?? '', /\.git/);
  assert.match(validateManifest({ version: 1, replace: { 'sub/.GIT/hooks/pre-commit': 'pub/x' } }).error ?? '', /\.git/);
  assert.match(validateManifest({ version: 1, replace: { 'a': '.git/config' } }).error ?? '', /\.git/);
});

// G-5 of 20261117-122032-m2-9a-d1-2: the component was compared literally, so a name Windows resolves to .git passed:
// trailing dots and spaces are stripped, an NTFS stream suffix names the same entry, and GIT~1 is its short name. The
// same literal compare let a '..' spelled '.. ' or '...' past the escape check.
test('validateManifest refuses a replace path naming .git or .. by a Windows alias', () => {
  for (const to of ['.git./hooks/pre-commit', '.git /hooks/pre-commit', 'sub/.GIT.. /config', '.git::$INDEX_ALLOCATION/config', 'GIT~1/config']) {
    assert.match(validateManifest({ version: 1, replace: { [to]: 'pub/x' } }).error ?? '', /\.git|leaves/, `${to} must be refused`);
  }
  assert.match(validateManifest({ version: 1, replace: { 'a': '.git./config' } }).error ?? '', /\.git/);
  for (const to of ['.. /x', '... /x', 'a/../../x', 'a/.. ./x']) {
    assert.match(validateManifest({ version: 1, replace: { [to]: 'pub/x' } }).error ?? '', /leaves/, `${to} must be refused`);
  }
  assert.equal(validateManifest({ version: 1, replace: { 'docs/.gitkeep': 'pub/x', 'a.git/b': 'pub/y' } }).error, undefined);
});

// G-22 of 20261116-200635-m2-9a-high: --ref was resolved to any commit and never compared with master, while stage 9c
// takes the snapshot from exactly the master commit, refusing any other ref.
test('a publish of a commit that is not master\'s tip is refused, and nothing is committed', (t) => {
  const f = fixture(t);
  git(f.repo, 'branch', '-f', 'master', 'HEAD');
  git(f.repo, 'checkout', '-q', '-b', 'side');
  fs.writeFileSync(path.join(f.repo, 'src', 'side.js'), 'export const s = 1;\n');
  git(f.repo, 'add', '-A'); git(f.repo, 'commit', '-qm', 'side work');
  const r = f.commit();
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, /master/);
  assert.equal(git(f.out, 'rev-list', '--count', 'HEAD').stdout.trim(), '1', 'a non-master commit was published');
});

// G-27 of 20261116-200635-m2-9a-high: gitleaks exiting 99 with an empty report passed as "every finding allowed".
test('a secret-scan exit of 99 with no finding in its report refuses the publish', (t) => {
  const empty99 = JSON.stringify([process.execPath, '-e', [
    'const a = process.argv; require("fs").writeFileSync(a[a.indexOf("--report-path") + 1], "[]"); process.exit(99);'].join(' ')]);
  const f = fixture(t);
  const r = f.publish(['--dry-run', '--no-suite'], { QUORATE_PUBLISH_GITLEAKS: empty99 });
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, /not publishable/);
});

// G-28 of 20261116-200635-m2-9a-high: with no replace['CLAUDE.md'] the private CLAUDE.md shipped as itself.
test('a tracked CLAUDE.md shipped as itself, unreplaced, refuses the publish', (t) => {
  const f = fixture(t, { files: { 'CLAUDE.md': contract('.claude/requests/x.md') } });
  const r = f.publish(['--dry-run', '--no-suite']);
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, /CLAUDE\.md/);
});

// G-29 of 20261116-200635-m2-9a-high: --no-suite is for a dry run only (I-5); a committing publish honoured it.
test('--no-suite without --dry-run is refused, and nothing is committed', (t) => {
  const f = fixture(t);
  const r = f.publish(['--out', f.out, '--identity', 'New Account <1+n@users.noreply.github.com>', '--no-suite']);
  assert.notEqual(r.status, 0, r.output);
  assert.match(r.output, /--no-suite/);
  assert.equal(git(f.out, 'rev-list', '--count', 'HEAD').stdout.trim(), '1');
});

// G-31 of 20261116-200635-m2-9a-high: --out naming the source repository deleted its tracked files and committed there.
test('--out naming the source repository is refused before anything in it is touched', (t) => {
  const f = fixture(t);
  const r = f.publish(['--out', f.repo, '--identity', 'New Account <1+n@users.noreply.github.com>']);
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, /source repository/);
  assert.ok(fs.existsSync(path.join(f.repo, 'src', 'a.js')), 'a tracked file of the source was deleted');
  assert.equal(git(f.repo, 'rev-list', '--count', 'HEAD').stdout.trim(), '1');
});

// G-33 of 20261116-200635-m2-9a-high: the snapshot's own checks ran after the scan, in the scanned tree, and a file
// they rewrote was copied out unscanned.
test('a snapshot check that changes a shipped file refuses the publish', (t) => {
  const f = fixture(t, { files: { 'tests/run-all.mjs': 'import fs from "node:fs"; fs.writeFileSync("src/a.js", "changed\\n");\n' } });
  const r = f.publish(['--dry-run']);
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, /src\/a\.js/);
});

// G-24 of 20261116-200635-m2-9a-high: copyFileSync follows a symbolic link, so a tracked link (mode 120000) would ship
// its target's bytes from outside the commit. Made with update-index, so the case needs no link privilege.
test('a tracked symbolic link refuses the publish: only regular files ship', (t) => {
  const f = fixture(t);
  const blob = spawnSync('git', ['hash-object', '-w', '--stdin'], { cwd: f.repo, input: '../../outside', encoding: 'utf8' }).stdout.trim();
  git(f.repo, 'update-index', '--add', '--cacheinfo', `120000,${blob},src/link`);
  git(f.repo, 'commit', '-qm', 'a link');
  git(f.repo, 'config', 'core.symlinks', 'false');
  git(f.repo, 'checkout', '-q', 'HEAD', '--', 'src/link');
  const r = f.publish(['--dry-run', '--no-suite']);
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, /src\/link is a symbolic link/);
});

// G-19 of 20261116-200635-m2-9a-high: --identity was checked for shape only, never against the operator's identity
// patterns that every shipped file is held to (I-6: neither identity appears in the published commit's metadata).
test('an --identity matching a local identity pattern is refused, and nothing is committed', (t) => {
  const f = fixture(t);
  const r = f.publish(['--out', f.out, '--identity', 'OpName <opname@example.invalid>']);
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, /--identity/);
  assert.equal(git(f.out, 'rev-list', '--count', 'HEAD').stdout.trim(), '1', 'a commit was made as the operator');
});

// G-26 of 20261116-200635-m2-9a-high: the secret scanner's command line, the --config it was given included, was printed
// only when the scanner was overridden, so a real publish left no line saying how its scan ran (I-2).
test('the secret scanner\'s whole command line is printed on every publish', (t) => {
  const f = fixture(t);
  const r = f.publish(['--dry-run', '--no-suite']);
  assert.equal(r.status, 0, r.output);
  assert.match(r.output, /publish: secret scan command: .* dir .* --report-format json --report-path /);
});

// G-11 of 20261116-231613-m2-9a2-remediation-review (I-5): the snapshot's checks ran with inherited stdio and their working
// folder was removed, so their output reached the terminal only. Each check's output is kept in the engine's home
// (operator: "In the engine's home (Recommended)"), and the publish names the file.
test('each snapshot check\'s output is recorded in a log under the engine\'s home, named in the output', (t) => {
  // On its real path (ci-path-identity.plan.md stage 3b): the engine resolves its home (rootSpelling), and os.tmpdir() on the
  // Windows runner is 8.3 short (RUNNER~1), so the log, spelled long, was "not under" the short spelling (PR #3).
  const home = (fs.realpathSync.native ?? fs.realpathSync)(fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-publish-home-')));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const f = fixture(t, { files: { 'tests/run-all.mjs': 'console.log("SUITE-OUTPUT-G11"); process.exit(0);\n' } });
  const r = f.publish(['--dry-run'], { QUORATE_HOME: home });
  assert.equal(r.status, 0, r.output);
  const m = /publish: snapshot tests: exit 0; output recorded in (.+)$/m.exec(r.output);
  assert.ok(m, `no recorded-output line for the tests check:\n${r.output}`);
  const log = m[1].trim();
  assert.ok(path.resolve(log).startsWith(path.resolve(home) + path.sep), `the log ${log} is not under the engine's home ${home}`);
  assert.match(fs.readFileSync(log, 'utf8'), /SUITE-OUTPUT-G11/);
});

// G-10 of 20261116-231613-m2-9a2-remediation-review: a shipped .gitleaksignore was renamed for the scan onto a fixed name
// without looking there first, so a tracked .gitleaksignore.publish-scan was overwritten and its own bytes never reached
// gitleaks, while the publish passed.
test('a shipped file at the scan\'s aside name for .gitleaksignore refuses the publish rather than being overwritten', (t) => {
  const f = fixture(t, { files: { '.gitleaksignore': 'abc:def:1\n', '.gitleaksignore.publish-scan': 'shipped content\n' } });
  const r = f.publish(['--dry-run', '--no-suite']);
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, /\.gitleaksignore\.publish-scan/);
  assert.match(r.output, /refus|not publishable|nothing was committed/);
});

// G-28 of 20261117-013640-m2-9a-final (operator: "Require a named owner pattern (Recommended)"): the local identity file
// was accepted with any one pattern, so a file without the private repository's owner let that name ship unnamed (I-3).
test('a local identity file without the private-repo-owner pattern refuses the publish, naming the pattern', (t) => {
  const f = fixture(t, { local: { patterns: [{ name: 'operator', regex: 'opname', flags: 'i' }] },
    files: { 'src/b.js': '// see github.com/privowner/quorate\n' } });
  const r = f.publish(['--dry-run', '--no-suite']);
  assert.equal(r.status, 1, `a local file with no owner pattern was accepted:\n${r.output}`);
  assert.match(r.output, /no pattern named "private-repo-owner"/);
  assert.match(validateLocalPatterns({ patterns: [{ name: 'operator', regex: 'x' }] }).error ?? '', /private-repo-owner/);
  assert.equal(validateLocalPatterns({ patterns: [{ name: 'private-repo-owner', regex: 'x' }] }).error, undefined);
});

// G-32 of 20261117-013640-m2-9a-final (operator: "Check keys, allow reader comments (Recommended)"): the published contract
// had to equal CLAUDE.md made public byte for byte, so no comment could be written for readers (I-5). Its keys are what
// is checked: the same as the private contract's, with doc_roles.request empty.
test('the published contract may carry comments written for readers; its keys are what is checked', (t) => {
  const priv = privateClaude('the private prose');
  const forReaders = publicContractText(priv).text.replace('the private prose', 'prose written for readers')
    .replace('graph_contract_version: 6', '# a comment for readers\ngraph_contract_version: 6');
  const ok = fixture(t, { files: { 'CLAUDE.md': priv, 'publish/CLAUDE.public.md': forReaders },
    manifest: { replace: { 'CLAUDE.md': 'publish/CLAUDE.public.md' } } });
  const r = ok.publish(['--dry-run', '--no-suite']);
  assert.equal(r.status, 0, `a comment-only difference was refused:\n${r.output}`);
  // A published contract that still names a request is refused: the key must be empty in a copy.
  const named = publicContractText(priv).text.replace('request:      ""', 'request:      ".claude/requests/y.md"');
  const bad = fixture(t, { files: { 'CLAUDE.md': priv, 'publish/CLAUDE.public.md': named },
    manifest: { replace: { 'CLAUDE.md': 'publish/CLAUDE.public.md' } } });
  const b = bad.publish(['--dry-run', '--no-suite']);
  assert.equal(b.status, 1, b.output);
  assert.match(b.output, /differs from the private one at doc_roles\.request \(not empty\)/);
});

// G-1 of 20261117-122032-m2-9a-d1-2: the published contract's comments carried the development repository's private
// history (dated operator decisions, finding and run ids, plans that do not ship), which the plan names a failure
// (I-5). The comments of the published contract block are for a reader of the public repository.
test('the published contract block carries no private development history in its comments', () => {
  // publish/CLAUDE.public.md here, CLAUDE.md in the published snapshot (the same text: publish/manifest.json's replace).
  const published = publishedForm('CLAUDE.md');
  const text = fs.readFileSync(path.join(REPO_ROOT, published), 'utf8');
  const block = text.match(/```yaml\n([\s\S]*?)\n```/);
  assert.ok(block, `${published} has no yaml contract block`);
  const history = [
    [/\b20\d\d-\d\d-\d\d\b/, 'a date'],
    [/\b\d{8}-\d{6}\b/, 'a run id'],
    [/\bG-\d+\b/, 'a finding id'],
    [/\b[A-Z]{2}-D\d\b|\bAC\d+\b|\bQ\d\b/, 'a design decision id'],
    [/\(operator\b|\boperator[,:]|operator's (word|decision|ruling)|operator choice|Recommended/, 'an operator decision'],
    // A design record named bare (no directory) is a request or plan under .claude/requests/, which does not ship; a
    // shipped document is cited with its directory (shared/claude-md-contract.md).
    [/\.(plan|design|followup)\.md\b|(^|[\s(`"])[a-z]+(-[a-z0-9]+)+\.md\b/, 'a private design record'],
    [/\bcommit [0-9a-f]{7,}\b|\bbranch explore\//, 'a commit or branch of the development repository'],
  ];
  const bad = [];
  block[1].split('\n').forEach((line, i) => {
    const hash = line.search(/(^|\s)#/);
    if (hash < 0) return;
    const comment = line.slice(hash);
    for (const [re, what] of history) if (re.test(comment)) bad.push(`block line ${i + 1} (${what}): ${line.trim()}`);
  });
  assert.deepEqual(bad, []);
});

// ci-path-identity.plan.md stage 2: PR #3's Windows job refused every committing publish, "--out ... is not the top of its
// repository", because --out (C:\Users\RUNNER~1\..., 8.3 short) was compared with git's long --show-toplevel by
// path.resolve alone. Both are now resolved to their real path. A link above --out, as /var on macOS or a junction here,
// is the same respelling.
test('stage 2: --out spelled through a link commits, as its real path does', (t) => {
  const f = fixture(t);
  const link = `${f.out}-link`;
  fs.symlinkSync(f.out, link, process.platform === 'win32' ? 'junction' : 'dir');
  t.after(() => fs.rmSync(link, { force: true, recursive: false }));
  const r = f.publish(['--out', link, '--identity', 'New Account <123+newacct@users.noreply.github.com>']);
  assert.equal(r.status, 0, r.output);
  assert.equal(git(f.out, 'rev-list', '--count', 'HEAD').stdout.trim(), '2');
});

test('stage 2: an --out below its repository\'s top is still refused, and nothing is committed', (t) => {
  const f = fixture(t);
  const below = path.join(f.out, 'sub');
  fs.mkdirSync(below);
  const r = f.publish(['--out', below, '--identity', 'New Account <123+newacct@users.noreply.github.com>']);
  assert.notEqual(r.status, 0, r.output);
  assert.match(r.output, /is not the top of its repository/);
  assert.equal(git(f.out, 'rev-list', '--count', 'HEAD').stdout.trim(), '1');
});
