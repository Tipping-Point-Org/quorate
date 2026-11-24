// G-8 of 20261111-224124-runtime-bin-d1-review: claim-check --check took draft.md through existsSync and copyFileSync, both
// of which follow a standing link, so a draft.md linked at any file the operator can read was copied into the surface
// the cross-family checker reads, and left the machine. A draft.md that is a link is refused before anything reads it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SCRIPTS_DIR, withTempDir, makeLink } from './helpers.mjs';

const SCRIPT = path.join(SCRIPTS_DIR, 'claim-check.mjs');
const env = () => { const e = { ...process.env }; delete e.GRAPH_NODE_DEPTH; return e; };

test('G-8: --check refuses a draft.md that is a link, naming it, before any checker starts', (t) => {
  withTempDir((dir) => {
    const repo = path.join(dir, 'repo');
    fs.mkdirSync(repo);
    assert.equal(spawnSync('git', ['init', '-q'], { cwd: repo }).status, 0);
    const secret = path.join(dir, 'secret.txt');
    fs.writeFileSync(secret, 'operator secret\n');
    const check = path.join(repo, '.claude', 'claim-checks', 'linked');
    fs.mkdirSync(check, { recursive: true });
    // A file link where the host can make one; where it cannot (Windows without the privilege), a junction to a
    // directory, which existsSync follows the same way: the refusal is of any link at draft.md, whatever it points at.
    fs.mkdirSync(path.join(dir, 'secrets'));
    if (!makeLink(t, { target: secret, at: path.join(check, 'draft.md'), type: 'file', fallback: { dir: path.join(dir, 'secrets') } })) return;
    const r = spawnSync(process.execPath, [SCRIPT, check, '--check'], { cwd: repo, env: env(), encoding: 'utf8' });
    assert.equal(r.status, 2, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /draft\.md.*link/);
  });
});

// G-4 of 20261111-232547-runtime-bin-remediation-4-review: lstat sees a hard link as a plain file, so a draft.md
// hard-linked to another local file passed the guard above and its contents were copied to the cross-family checker. A
// plain file with more than one link is refused the same way, before any checker starts.
test('G-4: --check refuses a draft.md that is a hard link (nlink > 1), naming it, before any checker starts', (t) => {
  withTempDir((dir) => {
    const repo = path.join(dir, 'repo');
    fs.mkdirSync(repo);
    assert.equal(spawnSync('git', ['init', '-q'], { cwd: repo }).status, 0);
    const secret = path.join(dir, 'secret.txt');
    fs.writeFileSync(secret, 'operator secret\n');
    const check = path.join(repo, '.claude', 'claim-checks', 'hardlinked');
    fs.mkdirSync(check, { recursive: true });
    const draft = path.join(check, 'draft.md');
    if (!makeLink(t, { target: secret, at: draft, type: 'hard' })) return;
    const st = fs.lstatSync(draft);
    assert.ok(st.isFile() && !st.isSymbolicLink() && st.nlink > 1, `fixture: draft.md is a plain file with nlink ${st.nlink}`);
    const r = spawnSync(process.execPath, [SCRIPT, check, '--check'], { cwd: repo, env: env(), encoding: 'utf8' });
    assert.equal(r.status, 2, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /draft\.md.*link/);
    // Refused before anything was written into the check directory for a checker to read.
    assert.deepEqual(fs.readdirSync(check).sort(), ['draft.md']);
  });
});
