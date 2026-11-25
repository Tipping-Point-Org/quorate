// THE PUBLISHED CLAUDE.md CITES NO EXCLUDED FILE BY ITS BARE NAME (G-1 of 20261121-001829-prc-remediation-review).
//
// publish/CLAUDE.public.md named `remediation-repair-pass.plan.md` and `autonomous-run-pauses.md`, both under
// .claude/requests, which publish/manifest.json excludes; a reader of the public repository followed them to nothing. The
// check in regression-pr-comments (G-2) requires a folder in the citation, so it could not see a bare name. A bare
// document name is an excluded citation when the file of that name stands in an excluded folder of this checkout, or,
// since the public mirror has no excluded folder and ships this same text, when no file of that name ships at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SCRIPTS_DIR, publishedFormIn } from './helpers.mjs';
import { gitSync } from '../scripts/io/git.mjs';

// Every file name the snapshot ships from `root`: what git tracks there (the snapshot is made from a commit's tracked
// files, lib/publish.mjs planSnapshot), outside the manifest's exclusions, with each replace source shipped only under the
// name it replaces. An untracked or ignored file ships nothing (G-3 of 20261125-013403-m3-pr10-remediation-review).
function shippedNames(root, { exclude = [], replace = {} }) {
  const r = gitSync(['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(r.status, 0, `git ls-files in ${root}: ${r.stderr}`);
  const sources = new Set(Object.values(replace));
  const under = (f, e) => f === e || f.startsWith(`${e}/`);
  const names = new Set();
  for (const f of r.stdout.split('\0').filter(Boolean)) {
    if (sources.has(f) || exclude.some((e) => under(f, e))) continue;
    names.add(path.posix.basename(f));
  }
  for (const to of Object.keys(replace)) names.add(path.posix.basename(to));
  return names;
}

// A bare name the published CLAUDE.md cites is an excluded citation when a file of that name stands in an excluded folder
// (a source tree), or when no file of that name ships at all (the snapshot, where no excluded folder stands: G-3 of
// 20261125-004142-m3-pr10-review). Whichever file is the public CLAUDE.md (operator, 2026-11-24: "Tests read whichever is
// the public CLAUDE.md (Recommended)") is helpers.mjs's publishedFormIn to say.
function excludedCitations(root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'publish', 'manifest.json'), 'utf8'));
  const { exclude } = manifest;
  const text = fs.readFileSync(path.join(root, publishedFormIn(root, 'CLAUDE.md')), 'utf8');
  const bare = [...new Set([...text.matchAll(/`([\w-][\w.-]*\.md)`/g)].map((m) => m[1]))];
  assert.ok(bare.length > 0, 'the pattern found no bare document name at all, so it checks nothing');
  const shipped = shippedNames(root, manifest);
  return bare.filter((n) => exclude.some((e) => fs.existsSync(path.join(root, e, n))) || !shipped.has(n));
}

test('G-1: the published CLAUDE.md cites, by its bare name, no file under a folder the publish manifest excludes', () => {
  // G-3 of 20261125-004142-m3-pr10-review: in the snapshot no excluded folder stands, so a check that looks a name up in
  // one found nothing and passed. A snapshot-shaped fixture citing a name the snapshot does not ship must be reported.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'q-bare-cite-'));
  try {
    fs.mkdirSync(path.join(tmp, 'publish'));
    fs.writeFileSync(path.join(tmp, 'publish', 'manifest.json'),
      JSON.stringify({ exclude: ['.claude/requests'], replace: { 'CLAUDE.md': 'publish/CLAUDE.public.md' } }));
    fs.mkdirSync(path.join(tmp, 'shared'));
    fs.writeFileSync(path.join(tmp, 'shared', 'disk-first-protocol.md'), '# x\n');
    fs.writeFileSync(path.join(tmp, 'CLAUDE.md'), 'see `disk-first-protocol.md` and `autonomous-run-pauses.md`\n');
    for (const args of [['init', '-q'], ['add', '-A']]) assert.equal(gitSync(args, { cwd: tmp, encoding: 'utf8' }).status, 0, `git ${args[0]}`);
    assert.deepEqual(excludedCitations(tmp), ['autonomous-run-pauses.md'],
      'the snapshot cites a bare name it does not ship, and the check must see it there too');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  // G-3 of 20261125-013403-m3-pr10-remediation-review: shippedNames walked the disk, so an untracked or ignored file of
  // the cited name (bench/results holds hundreds) and the replace source itself, which never ships under its own name,
  // read as shipped, and the check passed on a citation the snapshot would not resolve. Only what git tracks ships.
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'q-bare-cite-src-'));
  const git = (...args) => { const r = gitSync(args, { cwd: src, encoding: 'utf8' }); assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`); };
  try {
    git('init', '-q');
    fs.mkdirSync(path.join(src, 'publish'));
    fs.writeFileSync(path.join(src, 'publish', 'manifest.json'),
      JSON.stringify({ exclude: ['.claude/requests'], replace: { 'CLAUDE.md': 'publish/CLAUDE.public.md' } }));
    fs.mkdirSync(path.join(src, 'shared'));
    fs.writeFileSync(path.join(src, 'shared', 'disk-first-protocol.md'), '# x\n');
    fs.writeFileSync(path.join(src, 'CLAUDE.md'), '# private\n');
    fs.writeFileSync(path.join(src, 'publish', 'CLAUDE.public.md'),
      'see `disk-first-protocol.md`, `autonomous-run-pauses.md` and `CLAUDE.public.md`\n');
    git('add', '-A');
    fs.mkdirSync(path.join(src, 'bench', 'results'), { recursive: true });
    fs.writeFileSync(path.join(src, 'bench', 'results', 'autonomous-run-pauses.md'), 'untracked\n');
    assert.deepEqual(excludedCitations(src).sort(), ['CLAUDE.public.md', 'autonomous-run-pauses.md'],
      'an untracked file of the cited name and the replace source do not ship, so neither resolves the citation');
  } finally { fs.rmSync(src, { recursive: true, force: true }); }
  assert.deepEqual(excludedCitations(path.resolve(SCRIPTS_DIR, '..')), [],
    'the published contract cites, by its bare name, a file under a folder the snapshot does not ship');
});
