// regression-capture-evidence-link-and-cwd.test.mjs — G-4 and G-6 of 20261023-014400-rdt-delivery.
//
// G-4: capture joined evidence/<node> under the admitted run and wrote there without resolving links, so a junction or
// symlink planted at evidence/<node> sent the log wherever it pointed.
// G-6: with no --cwd the command ran at the admitted repository, but the evidence header recorded process.cwd(), so a
// capture made from a subdirectory recorded a working directory the command never ran in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO_ROOT, repoRunDir, runScript } from './helpers.mjs';

test('G-4: an evidence/<node> link out of the run is refused, and nothing is written through it', (t) => {
  const { dir } = repoRunDir({ prefix: 'quorate-capture-link-' });
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-capture-outside-')));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'evidence'), { recursive: true });
  fs.symlinkSync(outside, path.join(dir, 'evidence', 'lens'), 'junction');
  const r = runScript('capture.mjs', ['--run-dir', dir, '--node', 'lens', '--name', 'probe', '--', 'git', 'rev-parse', 'HEAD']);
  assert.notEqual(r.status, 0, `the capture was written through the link: ${r.output.slice(-400)}`);
  assert.deepEqual(fs.readdirSync(outside), [], 'a log landed outside the run');
});

// run-dir-descendants.plan.md stage 2 (D-D2 A): a link that resolves back INSIDE the run passed the realpath check, so
// what it resolved to could be swapped later. Through the one owner, a link at any level below the run is refused.
test('run-dir-descendants stage 2: an evidence link that resolves inside the run is refused too', (t) => {
  const { dir } = repoRunDir({ prefix: 'quorate-capture-inner-link-' });
  fs.mkdirSync(path.join(dir, 'elsewhere'), { recursive: true });
  fs.symlinkSync(path.join(dir, 'elsewhere'), path.join(dir, 'evidence'), 'junction');
  const r = runScript('capture.mjs', ['--run-dir', dir, '--node', 'lens', '--name', 'probe', '--', 'git', 'rev-parse', 'HEAD']);
  assert.notEqual(r.status, 0, `the capture was written through the link: ${r.output.slice(-400)}`);
  assert.match(r.output, /link or junction/);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'elsewhere')), [], 'nothing was created through the link');
});

test('G-6: the header records the directory the command ran in, not the caller\'s', () => {
  const { dir } = repoRunDir({ prefix: 'quorate-capture-cwd-' });
  const r = runScript('capture.mjs', ['--run-dir', dir, '--node', 'lens', '--name', 'cwd', '--', 'git', 'rev-parse', 'HEAD'],
    { cwd: path.join(REPO_ROOT, 'tests') });
  assert.equal(r.status, 0, r.output.slice(-600));
  const log = fs.readdirSync(path.join(dir, 'evidence', 'lens')).find((n) => n.startsWith('cwd'));
  const header = fs.readFileSync(path.join(dir, 'evidence', 'lens', log), 'utf8');
  const cwd = (/^# cwd: (.+)$/m.exec(header) ?? [])[1];
  assert.equal(fs.realpathSync.native(cwd).toLowerCase(), fs.realpathSync.native(REPO_ROOT).toLowerCase(),
    `the header names ${cwd}; the command ran at the repository`);
});

// run-dir-descendants.plan.md stage 5 (G-5 of 20261024-122231-rdt-remediation-3-review): the cited path was rebuilt from the
// node id rather than taken from the file written. It is the written file's path relative to the run, and it resolves.
test('G-5: capture cites the file it wrote, and the citation resolves to it', () => {
  const { dir } = repoRunDir({ prefix: 'quorate-capture-cite-' });
  const r = runScript('capture.mjs', ['--run-dir', dir, '--node', 'lens', '--name', 'cite', '--', 'git', 'rev-parse', 'HEAD']);
  assert.equal(r.status, 0, r.output.slice(-600));
  const cited = (/evidence\/lens\/cite[^\s]*\.log/.exec(r.stdout) ?? [])[0];
  assert.ok(cited, `no citation printed: ${r.stdout.slice(-300)}`);
  assert.ok(fs.statSync(path.join(dir, ...cited.split('/'))).isFile(), 'the cited path is the file written');
});
