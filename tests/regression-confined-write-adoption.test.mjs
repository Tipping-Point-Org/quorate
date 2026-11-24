// run-dir-descendants.plan.md stage 4 (D-D3 A): every write-family fs call in scripts/ is allowed only in a named place.
// A path below an admitted run directory is written only through the one owner (lib/confined-path.mjs, A-30); this list
// is the ONE statement of which writes are outside it, each with its reason. A new raw write anywhere fails here until
// it goes through the owner or is named below; a named line allowance that stops matching fails too, so the list cannot
// go stale; and the count of write calls found has a floor, so a pattern that stops matching cannot pass vacuously.
//
// THE RESIDUAL, stated as A-29's test states its own: a write through an aliased fs (a destructured writeFileSync, a
// module that re-exports fs under another name) is not seen by a source scan.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from './helpers.mjs';

// The write-family names: the census regex of run-dir-descendants.design.md, kept here. The second alternative is the
// same family spelled as a promise or a callback (G-13 of 20261105-070121-crsf-remediation-2-review), held to an fs-named
// receiver so a stream's or a process's write is not counted.
const WRITE = /\b(mkdirSync|writeFileSync|appendFileSync|copyFileSync|cpSync|renameSync|rmSync|unlinkSync|rmdirSync|openSync|symlinkSync|linkSync|writeJsonAtomic|writeTextAtomic|appendTextAtomic|durableRename|createWriteStream|mkdtempSync|acquireFileLock|utimesSync|writeSync|truncateSync|ftruncateSync)\(|\b(?:fs|fsp|hostFs|promises)\.(?:promises\.)?(?:writeFile|appendFile|copyFile|cp|rename|rm|unlink|rmdir|mkdir|open|symlink|link|mkdtemp|utimes|write|truncate)\(/;

// Files that write nothing below an admitted run directory: what they write, and where.
const WHOLE_FILE = {
  'scripts/lib/confined-path.mjs': 'the owner itself',
  'scripts/io/confined-path.mjs': 'the owner bound to this host (durableRename as its last step)',
  'scripts/io/atomic.mjs': 'the durable-write primitives every writer, the owner included, is built on',
  // G-4 and G-8 of 20261112-050334-hl-review-b: --out's answer and the transcript copy are written through it.
  'scripts/io/write-all.mjs': 'every byte through a descriptor its caller opened (stdout, --out, the transcript copy); it opens and names no path',
  // capture-interactive.plan.md stage 4-5: the caller's own --evidence-dir (refused where git tracks it), never a run
  // directory: each label folder and file made by the owner first, then appended through its descriptor; and the files
  // a command's own `>` and `<` name, which the command was asked to write and read.
  'scripts/io/capture-interactive.mjs': "the caller's --evidence-dir (each file made by the owner, then appended) and the files a command's own redirections name",
  'scripts/bench-second-opinion.mjs': 'bench results, and the bench\'s own copy of a run that it stages and removes itself',
  'scripts/bench-lenses.mjs': 'bench results and the bench\'s own temporary worktrees',
  'scripts/claim-check.mjs': 'claim-check folders under .claude/claim-checks and their snapshot surface',
  'scripts/code-index.mjs': 'the code index cache under the engine\'s home',
  'scripts/decide.mjs': 'the revote claim\'s exclusive mkdir after the owner walks its levels, and the engine\'s home itself (every other write below .claude/decisions and decision-surfaces through confined, decision-records.plan.md stage 6)',
  'scripts/io/decision-run.mjs': 'the scratch removed once the record holds it (the record itself through confined, decision-records.plan.md stage 6)',
  'scripts/check-intent-grant.mjs': 'a temporary probe repository and the probe run it mints there and removes',
  'scripts/io/snapshot.mjs': 'the arms\' directory (a snapshot of the repository, not a run)',
  'scripts/io/worktree.mjs': 'the framework copied into the arms\' directory',
  'scripts/io/reviewer-probe.mjs': 'the reviewer probe records under the engine\'s home',
  'scripts/io/repo-lock.mjs': 'the repository lock under the engine\'s home',
  'scripts/io/intent-cache.mjs': 'the intent cache under the engine\'s home',
  'scripts/io/transcript-copy.mjs': 'the redacted transcript copy into a claim-check folder',
  'scripts/extract-sessions.mjs': 'the session digests under blog/sessions',
  'scripts/check-install.mjs': 'a temporary copy of the template, removed',
  // G-33 of 20261117-013640-m2-9a-final: the kept check logs under the engine's home and the published contract that
  // --write-public-contract writes into the repository were written here and unnamed.
  'scripts/publish.mjs': "the release snapshot in a throwaway folder, removed; the --out public clone; each snapshot check's log, kept under the engine's home in publish/<stamp>-<commit>/; and with --write-public-contract, the published contract the manifest names, in the repository (never a run directory)",
  'scripts/spawn-subagent.mjs': 'the caller\'s --out and --result (a plan-review round or a claim check)',
  'scripts/lib/project-profile.mjs': 'an openSync for READING a profile, not a write',
  'scripts/io/stop-child.mjs': 'the kill log a QUORATE_KILL_LOG variable names, a diagnostic',
  'scripts/gen-rule-text.mjs': 'the documents whose marked regions it writes',
  'scripts/gen-gitleaks-config.mjs': 'the push scan\'s generated rules',
  'scripts/io/stdin-file.mjs': 'the engine home made for its stdin/ folder, everything below it through confined, outside every run (stdin-folder-owner.plan.md)',
};

// Lines in files that also write runs: [pattern, exactly how many lines it matches, why it is outside the owner].
const LINES = {
  // Held line by line since contract-runtime-and-session-files.plan.md stage 3 (CR-D3 A): the run state and the freshness
  // cache are written through the engine home's owner; these two are its root and the lock on a name it checked.
  'scripts/io/run-state.mjs': [
    [/fs\.mkdirSync\(home, \{ recursive: true \}\)/, 1, 'the engine\'s home itself, the owner\'s root (a link there is refused by the owner)'],
    [/acquireFileLock\(own\.resolve\(\[\.\.\.segs, 'run-state\.json\.bind'\]\)/, 1, 'the bind lock, on a name the owner checked (CR-D4 A)'],
    // G-5 of 20261105-052942-crsf-delivery: the census did not see linkSync (G-22). The owner offers no hard link.
    [/fs\.linkSync\(own\.resolve\(tmp\), own\.resolve\(\[\.\.\.segs, 'run-state\.json'\]\)\)/, 1, 'the exclusive publish: a hard link between two names the owner checked, which it does not offer (A-30\'s residual)'],
  ],
  // Held line by line, not whole (G-23 of 20261105-052942-crsf-delivery): whole, its raw lock read and stat passed unseen.
  // Every path is checked through confined, rooted at the engine's home, before these calls; the owner offers none of them.
  'scripts/io/stop-log.mjs': [
    [/fs\.mkdirSync\(home, \{ recursive: true \}\)/, 1, 'the engine\'s home itself, the owner\'s root'],
    // The stale lock's rename and removal and the lock's release go through the owner (G-4 of
    // 20261105-061926-crsf-remediation-review): they were raw here, allowed by name. The emptied folder's removal goes
    // through the owner too (G-3 of 20261105-070121-crsf-remediation-2-review: a raw rmdirSync on a path resolved before
    // the lock was taken), by its empty-only remove.
    // One append since G-2 of 20261106-013812-stoplog-g8-remediation-review: the report and the event in one write, on a
    // line of their own, so the newline check reads the file's last byte through a raw descriptor at the same path.
    // The append goes through io/torn-tail.mjs's appendOwnFile since G-8 of 20261114-022647-m2-7b-review, which refuses a
    // hard link, so stop-log no longer writes the file here.
    // The appended file's last byte is read by io/torn-tail.mjs, the one owner of that check (G-3, G-4 of
    // 20261106-022028-stoplog-g8-remediation-2-review), so stop-log no longer opens it here.
    [/fs\.openSync\(own\.resolve\(fsegs\), 'r'\)/, 1, 'an openSync that READS: the tail read\'s descriptor, at a name the owner resolved'],
  ],
  // THE RECORD LOCK (stop-record-bounds-and-kill-log.plan.md stage 1, KL-D1 B), moved out of io/stop-log.mjs: the lock is
  // resolved through the caller's confined owner, which offers no exclusive create with a held descriptor.
  'scripts/io/record-lock.mjs': [
    [/fs\.openSync\(lock, 'wx'\)/, 1, 'the lock created exclusively, at a name the owner resolved'],
    // The lock's content is written through io/write-all.mjs (WHOLE_FILE above) since G-2 of
    // 20261114-042824-m2-7b-remediation-2-review, every byte or a throw, so it needs no allowance here.
  ],
  // The one owner of a JSONL file's torn-tail check (G-3, G-4 of 20261106-022028-stoplog-g8-remediation-2-review).
  'scripts/io/torn-tail.mjs': [
    [/fsImpl\.openSync\(file, 'r'\)/, 1, 'an openSync that READS: the last byte of the file its caller resolved and appends to'],
    // appendRecord (G-3 of 20261106-035103-stoplog-g8-remediation-3-review): the check and the append under the record
    // lock (KL-D1 B), at a name the confined owner rooted at the file's folder resolved; the owner offers no append.
    // appendOwnFile, which appendRecord calls under the record lock at a name the owner resolved (G-8 of 20261114-022647-m2-7b-review): one descriptor, its name count fstat'ed, then the write.
    [/fsImpl\.openSync\(file, 'a'\)/, 1, "appendOwnFile's descriptor, at the path its caller resolved"],
    // The append's writeSync left with G-1 of 20261114-032609-m2-7b-remediation-review: every byte now goes through
    // io/write-all.mjs (WHOLE_FILE above), on the descriptor whose name count was judged.
  ],
  // Held line by line rather than whole (G-23 of 20261029-190658-rdr-delivery): it reads runs.
  'scripts/findings-ledger.mjs': [
    [/acquireFileLock\(`\$\{ledgerPath\}\.lock`\)/, 1, 'the ledger\'s lock'],
    [/fs\.mkdirSync\(path\.dirname\(ledgerPath\), \{ recursive: true \}\)/, 1, 'the ledger\'s folder'],
    [/writeJsonAtomic\(ledgerPath, ledger\)/, 1, 'the ledger'],
    [/fs\.mkdirSync\(container, \{ recursive: true \}\)/, 1, 'the folder the migration report is allowed in'],
    [/fs\.mkdirSync\(path\.dirname\(report\), \{ recursive: true \}\)/, 1, 'the migration report\'s folder'],
    [/fs\.writeFileSync\(report, md, \{ flag: 'wx' \}\)/, 2, 'the migration report, created exclusively'],
    [/fs\.unlinkSync\(report\)/, 2, 'a failed attempt\'s migration report, removed'],
  ],
  'scripts/run-graph.mjs': [
    [/fs\.rmSync\(dir, \{ recursive: true, force: true \}\)/, 1, 'the arms\' directory, removed after the panel'],
    [/fs\.rmdirSync\(path\.dirname\(dir\)\)/, 1, 'the arms\' directory\'s parent, when it is left empty'],
    [/^\s*fs\.mkdirSync\(dir, \{ recursive: true \}\);$/, 1, 'the requests folder an inferred request is written to'],
    [/fs\.mkdirSync\(path\.dirname\(armCensus\)/, 1, 'the census copied into the arms\' directory'],
    // Read through the egress owner since G-6 of 20261114-195905-m2-pred1-remediation-2-review: the copy is what the arm
    // reads, so a second name is refused as well as a link. The write is into the arms' directory, outside the run.
    // Read first, into censusBytes, since G-6 of 20261115-022835-pbr-1b-remediation-review: a refusal leaves the census out
    // of the surface, named, instead of skipping every arm.
    [/fs\.writeFileSync\(armCensus, censusBytes\)/, 1, 'the same copy, read from the run through egressRunReader (prompt-bound-run-reads.plan.md)'],
    [/writeTextAtomic\(path\.join\(path\.dirname\(finalDir\), 'latest\.txt'\)/, 1, 'the reviews folder\'s latest-run pointer'],
  ],
  'scripts/new-run.mjs': [
    [/fs\.mkdirSync\(reviewsAllowed\.container, \{ recursive: true \}\)/, 1, 'the reviews container under the engine\'s home'],
    [/fs\.mkdirSync\(path\.dirname\(runDir\), \{ recursive: true \}\)/, 1, 'the reviews folder the run is minted in'],
    [/fs\.mkdirSync\(runDir\);/, 1, 'the run itself, claimed by one exclusive non-recursive mkdir; the owner is rooted here'],
    [/writeTextAtomic\(path\.join\(reviewsDir, 'latest\.txt'\)/, 1, 'the reviews folder\'s latest-run pointer'],
  ],
  'scripts/preflight.mjs': [
    // Made before the link check, as new-run makes it (G-16 of 20261121-193516-m3s7-b1-review): escapesBeforeCreate
    // resolves the container, so it must exist first.
    [/fs\.mkdirSync\(allowed\.container, \{ recursive: true \}\)/, 1, 'the reviews container under the engine\'s home'],
    [/fs\.mkdirSync\(path\.dirname\(runDir\), \{ recursive: true \}\)/, 1, 'the reviews root the seed run is made in'],
    [/fs\.mkdirSync\(runDir\);/, 1, 'the seed run, claimed exclusively; the owner is rooted here'],
    [/fs\.rmSync\(runDir, \{ recursive: true, force: true \}\)/, 1, 'the seed run removed whole when the checks end'],
  ],
  'scripts/external-review.mjs': [
    [/fs\.rmSync\(path\.resolve\(args\.out\)/, 1, '--out, the caller\'s answer file (OUT-1 to OUT-8)'],
    [/fs\.openSync\(path\.resolve\(args\.out\), 'wx'\)/, 1, '--out, created exclusively'],
    [/fs\.mkdtempSync\(path\.join\(os\.tmpdir\(\), 'quorate-probe-run-'\)\)/, 1, 'the probe child\'s temporary run folder'],
    [/fs\.mkdtempSync\(path\.join\(os\.tmpdir\(\), 'quorate-probe-'\)\)/, 1, 'the probe\'s temporary surface'],
    [/fs\.rmSync\(dir, \{ recursive: true, force: true \}\)/, 2, 'those two temporary folders, removed'],
    [/fs\.mkdirSync\(surface\)/, 1, 'the probe\'s empty surface repository'],
    [/fs\.writeFileSync\(promptFile, probePrompt\)/, 1, 'the probe\'s prompt, in its temporary folder'],
    [/fs\.mkdtempSync\(path\.join\(os\.tmpdir\(\), 'quorate-schema-'\)\)/, 1, 'the schema\'s temporary folder when there is no evidence sink'],
    [/if \(!evidenceSink\) fs\.mkdirSync\(schemaDir/, 1, 'that temporary folder, only without a sink'],
    [/else fs\.writeFileSync\(schemaFile/, 1, 'the schema into that temporary folder, only without a sink'],
    [/fs\.unlinkSync\(path\.join\(schemaDir, f\)\)/, 1, 'the temporary schema folder emptied'],
    [/fs\.rmdirSync\(schemaDir\)/, 1, 'and removed'],
  ],
  'scripts/io/preflight-cache.mjs': [
    // Every other write of the cache goes through the reviews folder's owner since G-4 of
    // 20261122-204359-llo-remediation-review: the folder, the staged evidence, the entry and each eviction.
    [/fs\.mkdirSync\(path\.resolve\(reviewsDir\), \{ recursive: true \}\)/, 1, 'the reviews folder itself, the owner\'s root, made when missing (a link there is refused by the owner)'],
    // Injectable since G-3 of 20261122-214154-llo-remediation-2-review, so a test can fail the rename: the default is the
    // one raw rename, and writePreflightCache calls it only on names cache.resolve checked (the old evidence aside, the
    // staged copy into place, and the aside put back after a failed rename).
    [/rename = \(a, b\) => fs\.renameSync\(a, b\)/, 1, 'the staged evidence folder renamed into place (and the old one aside and back), every name checked by the owner, which renames files only (G-5 of 20261122-204359-llo-remediation-review)'],
    [/fs\.utimesSync\(preflightCachePath\(reviewsDir, hash\), now, now\)/, 1, 'a cache entry\'s recency, for the size cap\'s eviction order'],
  ],
  'scripts/io/run-child.mjs': [
    // openChildOutput (G-8 of 20261121-233915-m3s7-b2-review): the child's stdout and stderr, each entry lstat'ed and a
    // link, a non-file or a second name refused before the open, the open file held to the entry judged.
    [/fsImpl\.openSync\(file, 'w'\)/, 1, "openChildOutput's descriptor, after the leaf is judged no link"],
  ],
  'scripts/io/reviews-root.mjs': [
    [/hostFs\.mkdirSync\(dir, \{ recursive: true \}\)/, 1, 'a reviews folder, for its .gitignore'],
    [/writeTextAtomic\(ignorePath, pure\.REVIEWS_IGNORE_TEXT\)/, 1, 'the reviews folder\'s .gitignore'],
    [/hostFs\.mkdirSync\(path\.dirname\(plan\.tmp\), \{ recursive: true \}\)/, 2, 'the archive\'s destination, outside the run'],
    [/hostFs\.cpSync\(plan\.from, plan\.tmp,/, 1, 'the archive: a finished run copied whole to its destination'],
    [/hostFs\.renameSync\(plan\.tmp, plan\.to\)/, 1, 'the archive\'s copy moved into place'],
    [/hostFs\.rmSync\(path\.join\(plan\.from, name\)/, 1, 'the archived run\'s staged copy removed, its kept evidence aside'],
    [/hostFs\.rmSync\(plan\.from, \{ recursive: true, force: true \}\)/, 1, 'the staged copy removed whole once archived'],
  ],
  // G-5 of 20261112-050334-hl-review-b: egressReadDeclared opens a document read-only, to fstat and read one descriptor.
  'scripts/io/egress-read.mjs': [
    [/fs\.openSync\(file, 'r'\)/, 1, 'a read-only open of a document bound for the intent sandbox: it writes nothing'],
  ],
  'scripts/io/doc-snapshot.mjs': [
    [/fs\.mkdirSync\(snapDir, \{ recursive: true \}\)/, 1, 'the copier\'s own write when no write hook is given (the grant probe\'s temporary sandbox); run-graph and new-run pass the run owner\'s'],
    // G-5 of 20261112-050334-hl-review-b: the content read from the checked descriptor, no longer a copy of the path.
    [/fs\.writeFileSync\(path\.join\(snapDir, name\), content\)/, 1, 'likewise'],
  ],
};

const codeLines = (src) => src.split(/\r?\n/).map((l, i) => ({ l, n: i + 1 })).filter(({ l }) => !/^\s*(\/\/|\*|\/\*)/.test(l));

// The scan, over { path: source }: the writes found, those neither in an allowed file nor on a named line, and how many
// lines each named allowance matched.
function scan(sources) {
  const offenders = [];
  const used = new Map();
  let found = 0;
  for (const [f, src] of Object.entries(sources)) {
    for (const { l, n } of codeLines(src)) {
      if (!WRITE.test(l)) continue;
      found++;
      if (WHOLE_FILE[f]) continue;
      // Each allowance clears the write it names, and only that one (G-21): the line passes only when no write is left.
      let rest = l;
      for (const allowance of LINES[f] ?? []) {
        const m = allowance[0].exec(rest);
        if (!m) continue;
        used.set(allowance, (used.get(allowance) ?? 0) + 1);
        rest = rest.slice(0, m.index) + rest.slice(m.index + m[0].length);
      }
      if (WRITE.test(rest)) offenders.push(`${f}:${n}: ${l.trim().slice(0, 110)}`);
    }
  }
  return { found, offenders, used };
}

test('run-dir-descendants stage 4: the scan reports a raw write into a run, and a raw write on a named line\'s file', () => {
  const r = scan({
    'scripts/scratch.mjs': "import fs from 'node:fs';\nfs.writeFileSync(path.join(runDir, 'nodes', 'x.json'), body);\n",
    'scripts/run-graph.mjs': "fs.mkdirSync(path.join(runDir, 'evidence', id), { recursive: true });\n",
  });
  assert.equal(r.found, 2);
  assert.deepEqual(r.offenders.map((o) => o.split(':')[0]), ['scripts/scratch.mjs', 'scripts/run-graph.mjs'],
    'a raw write below a run is reported, in a new file and in a file with named lines alike');
  assert.equal(scan({ 'scripts/scratch.mjs': "// fs.writeFileSync(path.join(runDir, 'x'), b);\n" }).found, 0, 'a comment is not a write');
});

// G-23 of 20261029-190658-rdr-delivery (panel-codex-arch): a file allowed whole had none of its writes scanned, so a raw
// write below a run added to findings-ledger.mjs, which reads runs, passed. It is held line by line, as run-graph.mjs is.
test('G-23: a raw write below a run added to findings-ledger.mjs is reported', () => {
  const f = 'scripts/findings-ledger.mjs';
  const src = fs.readFileSync(path.join(REPO_ROOT, f), 'utf8') + "fs.writeFileSync(path.join(runDir, 'nodes', 'x.json'), body);\n";
  assert.deepEqual(scan({ [f]: src }).offenders.map((o) => o.split(':')[0]), [f], 'the planted write is reported');
});

// G-21 of 20261029-235315-rdr-remediation-4-review (panel-codex-docs): one allowance matching a line exempted the whole
// line, so a second, unnamed write after an allowed one passed. Each write on a line is held to its own allowance.
test('G-21: a second write on a line an allowance names is reported', () => {
  const f = 'scripts/preflight.mjs';
  const r = scan({ [f]: "fs.rmSync(runDir, { recursive: true, force: true }); fs.writeFileSync(path.join(runDir, 'nodes', 'x.json'), b);\n" });
  assert.equal(r.offenders.length, 1, 'the unnamed second write on an allowed line passed');
  assert.equal(scan({ [f]: "fs.rmSync(runDir, { recursive: true, force: true });\n" }).offenders.length, 0, 'the allowed write alone is not reported');
});

// G-23 of 20261105-052942-crsf-delivery (panel-codex-contract): stop-log.mjs was allowed whole, so a raw write added to it
// could not fail the census. It is held line by line.
test('G-23: a raw write added to stop-log.mjs is reported', () => {
  const f = 'scripts/io/stop-log.mjs';
  const src = fs.readFileSync(path.join(REPO_ROOT, f), 'utf8') + "fs.writeFileSync(path.join(dir, 'current.jsonl'), body);\n";
  assert.deepEqual(scan({ [f]: src }).offenders.map((o) => o.split(':')[0]), [f], 'the planted write is reported');
});

// G-22 of 20261105-052942-crsf-delivery (panel-codex-arch): the census omitted linkSync, so a raw hard link passed.
test('G-22: a raw hard link is a write the census sees', () => {
  const r = scan({ 'scripts/scratch.mjs': "fs.linkSync(a, path.join(runDir, 'run.json'));\n" });
  assert.equal(r.found, 1, 'linkSync is not counted as a write');
  assert.equal(r.offenders.length, 1, 'the raw hard link is not reported');
});

// G-11 of 20261105-061926-crsf-remediation-review (panel-codex-arch, panel-codex-code): the census omitted utimesSync,
// which preflight-cache.mjs and code-index.mjs call, so a raw timestamp write passed unseen; writeSync, a write through a
// descriptor, likewise.
test('G-11: utimesSync and writeSync are writes the census sees', () => {
  const r = scan({ 'scripts/scratch.mjs': "fs.utimesSync(path.join(runDir, 'run.json'), now, now);\nfs.writeSync(fd, body);\n" });
  assert.equal(r.found, 2, 'utimesSync or writeSync is not counted as a write');
  assert.equal(r.offenders.length, 2, 'the raw timestamp write or descriptor write is not reported');
});

// G-13 of 20261105-070121-crsf-remediation-2-review (panel-codex-arch): the census saw only synchronous names, so a write
// through fs.promises, a promises import, or a callback-style fs call passed unseen (bench-lenses.mjs already held an
// fs.promises.cp). Each spelling is a write the census counts and reports.
test('G-13: promise and callback writes are writes the census sees', () => {
  const lines = [
    "await fs.promises.writeFile(path.join(runDir, 'run.json'), body);",
    "await fsp.rm(path.join(runDir, 'nodes'), { recursive: true });",
    "fs.writeFile(path.join(runDir, 'run.json'), body, cb);",
    "fs.appendFile(path.join(runDir, 'log'), line, cb);",
    "await promises.mkdir(path.join(runDir, 'evidence'));",
    "fs.promises.cp(a, path.join(runDir, 'x'), { recursive: true });",
  ];
  const r = scan({ 'scripts/scratch.mjs': `${lines.join('\n')}\n` });
  assert.equal(r.found, lines.length, 'a promise or callback write is not counted as a write');
  assert.equal(r.offenders.length, lines.length, 'a raw promise or callback write is not reported');
  // A stream's or a process's write is not an fs write.
  assert.equal(scan({ 'scripts/scratch.mjs': "process.stdout.write(text);\nstream.write(chunk);\n" }).found, 0);
});

test('run-dir-descendants stage 4: every write in scripts/ goes through the owner or is named, with its reason', () => {
  const files = spawnSync('git', ['ls-files', 'scripts/*.mjs', 'scripts/**/*.mjs'], { cwd: REPO_ROOT, encoding: 'utf8' })
    .stdout.split(/\r?\n/).filter(Boolean);
  const { found, offenders, used } = scan(Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join(REPO_ROOT, f), 'utf8')])));
  assert.deepEqual(offenders, [], `writes neither through the owner nor named here:\n${offenders.join('\n')}`);
  const stale = Object.entries(LINES).flatMap(([f, list]) => list.filter((a) => (used.get(a) ?? 0) !== a[1])
    .map(([re, count]) => `${f}: ${re} matched ${used.get(list.find((x) => x[0] === re)) ?? 0} line(s), named for ${count}`));
  assert.deepEqual(stale, [], `allowances that no longer match what they name:\n${stale.join('\n')}`);
  for (const f of Object.keys(WHOLE_FILE)) assert.ok(files.includes(f), `${f} is allowed whole but no longer exists`);
  // Dated, indicative: 2026-10-29 the scan found 200 write calls in 158 files. A floor well below it, so a pattern that stops matching
  // (a rename of the names above, a change of quoting) fails here instead of passing on nothing.
  assert.ok(found >= 150, `only ${found} write call(s) found: the pattern has stopped matching`);
});
