// "I synced the submodule" and "my install is current" are different claims, and until this script
// existed nothing could tell them apart.
//
// Moving the pointer is an UPDATE: it refreshes the engine, and hook BEHAVIOUR too, because
// installed hooks are two-line shims pointing back into the submodule. It does not add a hook the
// project never installed, and it does not touch the graph_contract block copied into the project's
// own CLAUDE.md -- whose MEANING can change underneath it. budget_usd_per_node: "" once meant
// Number("") === 0, a $0 cap that blocked every node, and now means uncapped: same text, opposite
// behaviour, no signal.
//
// It compares OBSERVABLE STATE rather than a version recorded at install time, deliberately: a
// stamp is a claim that can go stale or be wrong, artifacts cannot. Same reasoning as `host` being
// recorded rather than declared.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { runScript, REPO_ROOT } from './helpers.mjs';
import { frameworkStamp } from '../scripts/io/version.mjs';
import { PROFILE_DIR } from '../scripts/io/project-profile.mjs';

test('a contract missing keys the framework knows about is reported STALE', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-ci-'));
  try {
    // A minimal but VALID contract: parses, and is missing most of what the template declares.
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'),
      '# t\n\n```yaml\ngraph_contract: 1\nproject: t\ncommands:\n  build: ""\n  test: ""\n```\n');
    const r = runScript('check-install.mjs', ['--repo-root', dir]);
    assert.equal(r.status, 1, 'a contract missing declared keys is not current');
    assert.match(r.output, /missing \d+ key\(s\)/);
    // The distinction that matters, stated to the reader rather than implied.
    assert.match(r.output, /Absent is not the same as empty/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('regression: it names the hooks it ships but that are not installed', () => {
  // The exact case found on this repository the first time it ran: quorate ships a blocking
  // pre-push gate, CLAUDE.md says the counted facts are "verified against the tree on every push",
  // and .git/hooks held nothing but samples -- so that verification had never run here.
  const r = runScript('check-install.mjs', ['--repo-root', REPO_ROOT]);

  // DETERMINE THE STATE, THEN ASSERT THE MESSAGE FOR IT. This was `/hook 'pre-push'|hooks match/`,
  // an alternation satisfied whichever way reality went — including by output that claimed "hooks
  // match" while pre-push was uninstalled and never mentioned, which is the case the test exists to
  // catch. An assertion that cannot fail is not a test; it is a comment that costs a process spawn.
  const hp = spawnSync('git', ['config', '--get', 'core.hooksPath'], { cwd: REPO_ROOT, encoding: 'utf8' });
  const hooksDir = hp.status === 0 && hp.stdout.trim()
    ? path.resolve(REPO_ROOT, hp.stdout.trim())
    : path.join(REPO_ROOT, '.git', 'hooks');
  const installed = fs.existsSync(path.join(hooksDir, 'pre-push'));

  if (installed) {
    // THIS BRANCH HAD NEVER RUN. quorate's own hooks were shipped and not installed in quorate for
    // the whole life of this test, so only the `else` half was ever exercised — and the regex here
    // still said `installed hooks match`, a phrasing check-install stopped using when it split the
    // summary into three honest states ("no hooks installed" / "N of M installed, and those match" /
    // "hooks match"). A test whose live branch is the one nobody runs is the same shape as the
    // uninstalled hook it was written to catch.
    assert.match(r.output, /hooks match|hook 'pre-push' differs/,
      'pre-push IS installed, so the report must say whether it is current or drifted');
    assert.doesNotMatch(r.output, /hook 'pre-push' is shipped but not installed/,
      'it must not report an installed hook as absent');
  } else {
    assert.match(r.output, /hook 'pre-push' is shipped but not installed/,
      'pre-push is NOT installed, and this repository ships a blocking gate whose absence means ' +
      'the counted facts CLAUDE.md calls "verified on every push" have never been verified here');
    // Found by this very assertion: with NOTHING installed the summary said "installed hooks
    // match" — vacuously true over an empty set, printed one line under "hook 'pre-push' is
    // shipped but not installed". A summary that overstates what it checked is the same defect as
    // a stamp that does.
    assert.doesNotMatch(r.output, /hooks match\./,
      'with no hooks installed the summary must not claim any matched');
    assert.match(r.output, /no hooks installed/,
      'it must say plainly that none are installed, not describe the empty set as agreeing');
  }
});

test('it reads the contract through the ONE parser rather than re-parsing CLAUDE.md', () => {
  // A second contract parser is how two components come to disagree about the same file.
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'check-install.mjs'), 'utf8');
  // Through the one reader of `new-run --print-contract` (ledger-findings stage 4).
  assert.match(src, /readContract\(/);
  assert.doesNotMatch(src, /graph_contract:\s*1/, 'must not carry its own parser');
});

test('it compares observable state, not a version stamp written at install time', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'check-install.mjs'), 'utf8');
  // The hook check must reconstruct what the installer WOULD write and diff it, so a changed body
  // or a stale baked-in path offset is caught -- neither of which a pointer move can fix.
  // It reads the COMMITTED body and diffs it against what is installed. This asserted the path
  // substitution that used to happen here -- `split('/.claude/hooks/')` -- which was the mechanism,
  // not the claim, and went red when that substitution was removed for corrupting the shims' second
  // probe. The claim is that the comparison is over content.
  assert.match(src, /const want = fs\.readFileSync\(src, 'utf8'\)/,
    'it must compare against the committed body, not against a recorded version');
  assert.match(src, /sha\(want\) !== sha\(have\)/, 'and compare them by content');
  assert.doesNotMatch(src, /installed_version|quorate-install\.json/,
    'a recorded version is a claim that can be wrong; artifacts cannot');
});

// A project that never installed the hooks made a CHOICE -- QUORATE.md calls them "optional but
// recommended", the review engine has no dependency on them whatsoever (the barrier runs
// run-checks directly), and a consumer with its own pre-commit/pre-push has every reason to
// decline. Reporting that as STALE tells someone their install is broken when it is exactly as
// they configured it.
//
// That is the failure this project's own doctrine names: a ceiling that fires on a non-problem
// teaches readers to ignore ceilings. Uninstalled is a NOTE; installed-and-drifted is the defect,
// because a shim whose baked-in path or body no longer matches cannot be fixed by moving the
// submodule pointer.
test('regression: hooks that were never installed are a note, not staleness', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-nohooks-'));
  try {
    // A complete contract, copied from the template, so ONLY the hook question is under test.
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'),
      fs.readFileSync(path.join(REPO_ROOT, 'CLAUDE.template.md'), 'utf8').replace(/<[^>\n]*>/g, ''));
    execFileSync('git', ['init', '--quiet'], { cwd: dir });
    const r = runScript('check-install.mjs', ['--repo-root', dir]);
    assert.doesNotMatch(r.output, /STALE: hook/,
      'declining an optional component is not a stale install');
    assert.match(r.output, /not installed/i, 'but it must still be VISIBLE, not silently ignored');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("regression: an uninstalled hook's note states the CONSEQUENCE, not just 'optional'", () => {
  // The word was 'optional'. True about the install's status, useless about the decision: it
  // answers "must I?" when the only question worth asking is "what do I lose?". Read on this very
  // repository it meant "you don't need this", and a red suite reached the remote behind a gate
  // that was shipped, present, and never installed -- for a whole day, past every run of this
  // script. Declining is still allowed; it now has to be declined against a stated cost.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-ci-'));
  try {
    // A git repository with NO hooks installed, so both notes are reached.
    execFileSync('git', ['init', '--quiet'], { cwd: dir });
    fs.copyFileSync(path.join(REPO_ROOT, 'CLAUDE.md'), path.join(dir, 'CLAUDE.md'));
    const out = runScript('check-install.mjs', ['--repo-root', dir]).output;

    assert.match(out, /hook 'pre-push' is shipped but not installed/);
    // The specific loss, per hook -- and they are different losses, which is why the text is not
    // one blanket sentence. pre-push is the quality gate; pre-commit is a question about intent.
    assert.match(out, /pre-push.*nothing runs the contract's declared build and test commands/);
    assert.match(out, /pre-commit.*commits on the default branch are not refused/);

    // And the reassuring word is gone from where it described the hook. Asserted as an absence
    // because its presence is what the reader stopped at.
    assert.doesNotMatch(out, /not installed \(optional/,
      "'optional' answered the wrong question and was read as 'you do not need this'");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('regression: the mount stamp reports a dirty framework tree, not the commit alone', () => {
  // `@ <sha>` came from a bare `git rev-parse --short HEAD`, so a mount carrying edits on top of
  // that commit reported the commit and nothing else -- an attribution to code that was
  // demonstrably not what ran. CLAUDE.md records the run this already cost: feature-verify
  // "appeared still broken" when the clone was one commit from its fix, the information present
  // and unread. frameworkStamp is the function every other caller uses for exactly this.
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'check-install.mjs'), 'utf8');
  assert.match(src, /frameworkStamp\(/,
    'the shared stamp helper carries the dirty flag; a local rev-parse does not');
  assert.doesNotMatch(src, /rev-parse', \['--short'/, 'the bare rev-parse dropped dirty on the floor');

  // Behaviour, in a throwaway repository rather than in this one. The first version of this test
  // created a marker file under scripts/ to dirty the framework tree -- and `check-counted-facts`
  // spawns an inner `node --test` over the whole suite, so two copies run concurrently and that
  // marker would appear under another copy's feet, in the tree every other test reads. A test that
  // writes into the tree it is testing is the hazard this suite already has a comment about.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-dirty-'));
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 't'], { cwd: dir });
    fs.writeFileSync(path.join(dir, 'VERSION'), '9.9.9\n');
    execFileSync('git', ['add', '-A'], { cwd: dir });
    execFileSync('git', ['commit', '--quiet', '-m', 'x'], { cwd: dir });
    assert.equal(frameworkStamp(dir).dirty, false, 'a committed tree is clean');

    fs.writeFileSync(path.join(dir, 'VERSION'), '9.9.10\n');
    assert.equal(frameworkStamp(dir).dirty, true,
      'a commit reported beside an edited tree attributes behaviour to code that did not run');

    // And the renderer turns that into something a reader sees. Asserted on the source, because the
    // rendering lives in check-install and only a real dirty mount reaches it -- which is precisely
    // what this test refuses to manufacture inside the shared tree.
    assert.match(src, /DIRTY — edits on top of this commit/);
    assert.match(src, /fstamp\.dirty === null \? ' \(clean\/dirty unknown\)'/,
      "null means nobody could check, which is not the same as clean");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// A MOUNTED TEST WRITER IS NOT A LOCALISED ONE — this file's subject, one layer up.
//
// Found while answering whether quorate's portable `unit-test-writer` can replace a consumer's own
// (C:\work\story-pipeline has both names). The portable skills read the runner and locations from the
// contract and everything else — assertion idiom, fixture convention, how an expensive boundary is
// faked, and where the project declares WHAT IS WORTH TESTING — from `.claude/quorate/test-profile.md`,
// which ADAPT.md produces once per repository. Neither that project nor this one has the file.
//
// Absent, the skills degrade honestly: they name the gap in not_checked[] and infer conventions from
// existing tests. What was missing is that nobody was TOLD, so the degradation surfaced at the moment
// a test was being written rather than at install time — the same shape as a mounted-but-unreconciled
// contract, which is the thing this script exists to catch.
//
// A NOTE, never a problem: the derivation needs a model reading the project's own architecture
// documents, so quorate cannot write the file, and it will not fail a consumer's install over a
// document it cannot produce. Gated on the contract declaring a suite, because a project with no
// tests has nothing to localise against.
test('a project with a test suite and no test-profile is told its test writers are unlocalised', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-profile-'));
  try {
    const contract = (test) => '# t\n\n```yaml\ngraph_contract: 1\nproject: t\ncommands:\n'
      + `  build: ""\n  test: ${JSON.stringify(test)}\n\`\`\`\n`;
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), contract('python -m pytest -q'));

    const missing = runScript('check-install.mjs', ['--repo-root', dir]);
    assert.match(missing.output, /no \.claude\/quorate\/test-profile\.md/,
      'a consumer whose contract declares a suite must be told the writers are not localised');
    assert.match(missing.output, /ADAPT\.md/, 'and told what produces the file');
    assert.match(missing.output, /what is worth testing/,
      'including the half the contract cannot carry, which is why the file exists at all');
    assert.ok(!/STALE: .*test-profile/.test(missing.output),
      'quorate must not fail an install over a document only a model can write');

    // Present: stated as localised, and still not a problem either way.
    //
    // AT `.claude/quorate/`, WHICH IS WHERE EVERY DOCUMENT SAYS IT LIVES. This wrote
    // `.claude/test-profile.md` — the same wrong path check-install itself probed — so the test and
    // the defect agreed with each other, and the check for the localisation feature could not see
    // the feature. A test that asserts the IMPLEMENTATION rather than the documented contract
    // cannot fail when the implementation is the thing that is wrong.
    fs.mkdirSync(path.join(dir, PROFILE_DIR), { recursive: true });
    fs.writeFileSync(path.join(dir, PROFILE_DIR, 'test-profile.md'), '# profile\n\n## Runner\n`pytest`\n');
    const present = runScript('check-install.mjs', ['--repo-root', dir]);
    assert.match(present.output, /test-profile\.md present/);
    assert.ok(!/no \.claude\/quorate\/test-profile\.md/.test(present.output));

    // NO SUITE, NO NAG. A project that declares no test command has nothing to localise, and a
    // note it cannot act on is noise that teaches the reader to skip the notes.
    fs.rmSync(path.join(dir, PROFILE_DIR, 'test-profile.md'));
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), contract(''));
    const noSuite = runScript('check-install.mjs', ['--repo-root', dir]);
    assert.ok(!/test-profile/.test(noSuite.output),
      'an empty commands.test means there is no suite to write tests against');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// THE INSTALL STEP COULD NOT SEE TWO THINGS AN OPERATOR ACTS ON AT INSTALL TIME.
//
// Asked directly: "are the reviewers still colliding, or does the install procedure solve it?" It did
// not, and it did not even mention them. `new-run` warned on every mint and stamped SKILLS-SHADOWED;
// this script, whose whole job is saying what about an install is not current, said nothing. Measured
// against the project quorate grew out of: EIGHT colliding names plus two legacy engine directories on
// the doctrine-probe path.
//
// The note has to get the DIFFERENCE right, because the halves are not equivalent: an orchestrated
// lens is safe by construction (`--inline-skill` hands the model the framework's text whatever shares
// its name), while a skill a PERSON invokes resolves to whichever the runtime picks.
test('regression: the install reports shadowed skills, split by what the collision costs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-shadow-'));
  try {
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'),
      '# t\n\n```yaml\ngraph_contract: 1\nproject: t\ncommands:\n  build: ""\n  test: ""\n```\n');
    // One of each: a lens the engine spawns, a person-invoked skill, and a legacy engine directory.
    for (const name of ['arch-review', 'unit-test-writer', 'shared', 'entirely-their-own']) {
      fs.mkdirSync(path.join(dir, '.claude', 'skills', name), { recursive: true });
    }
    const r = runScript('check-install.mjs', ['--repo-root', dir]);
    assert.match(r.output, /skill name\(s\) collide with this quorate/);
    // NOT "AMBIGUOUS — whichever the runtime picks wins", which this pinned and which is FALSE.
    // quorate's skills are NAMESPACED by the plugin (`quorate:unit-test-writer`); a project's own
    // sits at `.claude/skills/<name>/SKILL.md` and is invoked bare. Two different strings, nothing
    // resolves between them — and QUORATE.md stated the namespacing 65 lines from where it claimed
    // the opposite. This test held the wrong half in place, which is how the sentence survived long
    // enough to send a real consumer off to rename six skills that could never be mis-resolved.
    //
    // What IS at risk is selection: two descriptions answering one request, and the model choosing.
    assert.match(r.output, /person-invoked[^\n]*unit-test-writer/,
      'the person-invoked half must still be named — it is the half worth acting on');
    assert.match(r.output, /SELECTION/,
      'and named for the right reason: descriptions competing, not names resolving');
    assert.ok(!/AMBIGUOUS — whichever the runtime picks wins/.test(r.output),
      'the claim that the runtime resolves between them describes a mechanism that does not exist');
    assert.match(r.output, /ADAPT\.md derives the profile; then delete your copy/,
      'and the remedy is to MIGRATE and drop the copy, not to rename and keep two');
    assert.match(r.output, /safe by construction[^\n]*arch-review/,
      'a lens the engine spawns is not ambiguous, and saying so is the difference that matters');
    // REPORTED SEPARATELY AND NO LONGER AS A PROBLEM (G-64). This asserted the legacy directory
    // appeared in the collision note, which is where it stamped the run — on the stated ground
    // that it "sits on the doctrine-probe path". It does not: the intent sandbox now snapshots
    // DOCTRINE_DIR, the same resolution a node's brief is told, which probes the documented mount
    // `.claude/skills/quorate/shared` and never the ancestor's `.claude/skills/shared`. Nothing
    // reads `.claude/skills/scripts` at all.
    //
    // Measured on a real consumer: the check fired on a LIVE adjudication panel — a script invoked
    // by that project's own skill and pinned by a passing test — because it reads directory names
    // and never contents. There was no action that project could take short of renaming a working
    // subsystem, and a stamp nobody can clear is one people learn to skip.
    assert.match(r.output, /\.claude\/skills\/shared is where the ancestor engine kept its own files/,
      'the directory is still worth mentioning once to someone migrating off the ancestor engine');
    assert.match(r.output, /nothing to change/i,
      'and must be phrased so it is not read as work to do');
    assert.ok(!/legacy: /.test(r.output),
      'but not listed beside the name collisions, which are a different thing with a real remedy');
    assert.ok(!/entirely-their-own/.test(r.output), 'a project skill that collides with nothing is not its business');
    assert.ok(!/STALE: .*collide/.test(r.output),
      'a collision is the project\'s decision; quorate reports it and does not fail an install over it');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// AN EMPTY doc_roles KEY IS HONEST AND CAN STILL BE WRONG ABOUT THE PROJECT. Measured on the consuming
// project: the contract said `architecture: ""` with the comment "no single architecture document
// declared" while `docs/architecture.md` sat in the repository — so arch-review had been running
// convention-only, capped, unable to FAIL, on a project that had the document. Both facts were true and
// nothing put them side by side. The candidates are reported; filling the key stays the operator's call.
test('regression: an empty doc_role whose document is sitting in the repo is reported', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-docroles-'));
  try {
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'),
      '# t\n\n```yaml\ngraph_contract: 1\nproject: t\ncommands:\n  build: ""\n  test: ""\n'
      + 'doc_paths: ["docs/**"]\ndoc_roles:\n  architecture: ""\n  spec: ""\n  roadmap: ""\n```\n');
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
    for (const f of ['architecture.md', 'notes-that-mention-architecture.md', 'readme.md']) {
      fs.writeFileSync(path.join(dir, 'docs', f), '# x\n');
    }
    // git ls-files is the source, so the files must be tracked to count — which is the right rule: an
    // untracked draft is not a document the project governs itself by.
    execFileSync('git', ['init', '--quiet', '.'], { cwd: dir });
    execFileSync('git', ['add', '-A'], { cwd: dir });

    const r = runScript('check-install.mjs', ['--repo-root', dir]);
    assert.match(r.output, /doc_roles\.architecture is empty[^\n]*cannot FAIL/,
      'the consequence must be named, not just the gap');
    assert.match(r.output, /docs\/architecture\.md/);
    assert.ok(!/notes-that-mention-architecture/.test(r.output),
      'matched on the basename: a heuristic that reaches further starts proposing files that merely '
      + 'mention the word, and a note that proposes noise is a note that gets skipped');
    assert.ok(!/doc_roles\.spec is empty/.test(r.output),
      'no candidate means no note — an empty key with nothing to point at is a legitimate declaration');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// G-2 of 20261025-092319-srf-review-amended: a failed `git ls-files` read as "no documents", so the candidate check
// above was skipped in silence and the install still read as current.
test('regression: a doc_role check that could not list the tracked files says so', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-docroles-nogit-'));
  try {
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'),
      '# t\n\n```yaml\ngraph_contract: 1\nproject: t\ncommands:\n  build: ""\n  test: ""\n'
      + 'doc_paths: ["docs/**"]\ndoc_roles:\n  architecture: ""\n  spec: ""\n  roadmap: ""\n```\n');
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs', 'architecture.md'), '# x\n');
    // No `git init`: the directory is not a repository, so `git ls-files` fails.
    const r = runScript('check-install.mjs', ['--repo-root', dir]);
    assert.match(r.output, /doc_roles candidate check did not run[^\n]*git ls-files/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('one owner decides what collides, so the mint and the install cannot disagree', () => {
  const nr = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'new-run.mjs'), 'utf8');
  const ci = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'check-install.mjs'), 'utf8');
  for (const [name, src] of [['new-run', nr], ['check-install', ci]]) {
    assert.match(src, /shadowedSkills\(\{/, `${name} must ask the owner`);
  }
  assert.ok(!/theirs\.filter\(\(n\) => ours\.includes\(n\)\)/.test(nr),
    'the inline comparison is what left the install silent about eight colliding names');
});

// THE DEV INSTALL — the third layer, and the one that was missing for months.
//
// Raised by the operator, twice: "a stable version should be installed here so quorate itself can take
// advantage of quorate orchestrator during development... This could have prevented issues in the
// past." It was right and it was not done.
//
// quorate ships its ten person-invoked skills from `skills/` — the PLUGIN convention — while Claude
// Code discovers a project's skills under `.claude/skills/`. Those are different paths, so inside
// quorate's own repository `/request`, `/full-review` and `/remediate` resolved to NOTHING. The tools
// this project ships were the only ones it never used, and what that cost is on disk: nine
// `.inferred.md` requests, and a `/request` skill built to remove exactly that, unreachable the whole
// time.
//
// Reported with its DISTANCE from the working tree, because "I have a dev install" and "my dev install
// runs the logic I am editing" are different claims — this script's whole subject, one layer in.
test('the install reports a dev mount and how far behind the working tree it is', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-dev-'));
  try {
    // A fake framework repo: the script treats frameworkRoot === repoRoot as "inside the framework",
    // which is the only case where a dev install means anything.
    // BOTH WORLDS, because the install is OPTIONAL and gitignored. The first version asserted the note
    // unconditionally, so it could only pass on a machine that had one — and the pre-push hook failed
    // it the moment the file went missing. A test that requires machine-local state is the same defect
    // as shipping that state, pointed the other way: a fresh clone and a CI runner must go green too.
    const devPresent = fs.existsSync(path.join(REPO_ROOT, '.claude', 'skills', 'quorate'));
    const r = runScript('check-install.mjs', ['--repo-root', REPO_ROOT]);
    if (devPresent) {
      assert.match(r.output, /dev install at \.claude\/skills\/quorate @ [0-9a-f]{7}/,
        'the pin must be named: an install whose version is unknown is the staleness CLAUDE.md '
        + 'complains nothing records');
      assert.match(r.output, /level with this working tree|commit\(s\) BEHIND this working tree/,
        'distance, not mere presence');
      assert.match(r.output, /dev-install\.json/, 'and where the pin is recorded');
    } else {
      assert.ok(!/dev install at/.test(r.output),
        'with no install mounted there is nothing to report, and a note about an absent optional thing '
        + 'is noise that teaches the reader to skip the notes');
    }
    assert.ok(!/STALE: .*dev install/.test(r.output),
      'either way a dev install is optional and being behind is its normal state — never a failure');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('regression: the dev install is ignored by git, not merely untracked', () => {
  // Untracked-but-unignored is the WORST of the three states: `git add -A` would commit a second engine
  // into the engine, and mirrorWorkingTree copies untracked files into the arms' checkout — so a whole
  // second copy would ride into the tree the external reviewers read.
  const ignored = spawnSync('git', ['check-ignore', '-q', '.claude/skills/quorate/scripts/run-graph.mjs'],
    { cwd: REPO_ROOT });
  assert.equal(ignored.status, 0, '.claude/skills/ must be gitignored');
  const tracked = spawnSync('git', ['ls-files', '--error-unmatch', '.claude/skills/quorate/scripts/run-graph.mjs'],
    { cwd: REPO_ROOT });
  assert.notEqual(tracked.status, 0, 'and it must not be in the index');

  // AND NEITHER IS THE PIN RECORD, which this test asserted the OPPOSITE of first — "the record of
  // what is installed belongs in git" — because I had committed it. It does not: it says which commit
  // THIS machine pinned and when, and a clone has no dev install for it to describe. Shipping it is
  // the defect this repository already fixed twice, for `.claude/panel-check.json` and
  // `.claude/tiebreak-check.json`: "a probe of THIS machine must not ship to every consumer."
  //
  // The import line is the same class and was the worse half: committed to the tracked CLAUDE.md, it
  // pointed every fresh clone at `.claude/skills/quorate/QUORATE.md` — a path .gitignore hides from
  // that clone. It lives in CLAUDE.local.md now, which git does not carry either.
  for (const local of ['.claude/dev-install.json', 'CLAUDE.local.md']) {
    const ig = spawnSync('git', ['check-ignore', '-q', local], { cwd: REPO_ROOT });
    assert.equal(ig.status, 0, `${local} describes one machine and must be gitignored`);
    const tr = spawnSync('git', ['ls-files', '--error-unmatch', local], { cwd: REPO_ROOT });
    assert.notEqual(tr.status, 0, `${local} must not be in the index`);
  }
  const trackedClaudeMd = fs.readFileSync(path.join(REPO_ROOT, 'CLAUDE.md'), 'utf8');
  assert.ok(!/^@\.claude\/skills\/quorate\//m.test(trackedClaudeMd),
    'a committed import pointing into a gitignored directory resolves to nothing in every clone');

  // CONDITIONAL, because the dev install is OPTIONAL — and this test required the file, so it passed
  // only on a machine that had one. The pre-push hook caught it the moment the file was gone: a test
  // depending on gitignored machine state is the same defect as shipping that state, pointed the other
  // way. A fresh clone, a CI runner and a developer who never set the install up must all go green.
  const recPath = path.join(REPO_ROOT, '.claude', 'dev-install.json');
  if (fs.existsSync(recPath)) {
    const rec = JSON.parse(fs.readFileSync(recPath, 'utf8'));
    assert.match(rec.pinned_commit, /^[0-9a-f]{40}$/);
    assert.match(rec.stable_on_purpose, /must not break the tooling used to review it/,
      'the reason it is pinned rather than live must travel with the pin');
  }
});

// A PROJECT'S OWN HOOK IS NOT A STALE ONE. story-pipeline keeps its own pre-commit/pre-push and CHAINS
// quorate's from them; check-install compared those with the shipped bodies, called both STALE, exited 1,
// and told the operator to re-run install.mjs — which correctly refuses a hook it did not write
// (2026-10-04). What matters about an own hook is whether it calls quorate's, and that is what is said now.
test('regression: a project-owned hook is described, never reported stale', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-ownhooks-'));
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: dir });
    fs.copyFileSync(path.join(REPO_ROOT, 'CLAUDE.md'), path.join(dir, 'CLAUDE.md'));
    const hooks = path.join(dir, '.git', 'hooks');
    fs.writeFileSync(path.join(hooks, 'pre-push'),
      '#!/bin/sh\n# the project\'s own gate\nsh "$ROOT/.claude/skills/quorate/.claude/hooks/pre-push" "$@" || exit 1\n');
    fs.writeFileSync(path.join(hooks, 'pre-commit'), '#!/bin/sh\n# the project\'s own, calling nothing of quorate\'s\nexit 0\n');
    const out = runScript('check-install.mjs', ['--repo-root', dir]).output;
    assert.doesNotMatch(out, /STALE: hook/, 'an own hook is not a stale install');
    assert.match(out, /hook 'pre-push' is this project's own and calls quorate's pre-push/);
    assert.match(out, /hook 'pre-commit' is this project's own and calls nothing of quorate's — commits on the default branch/,
      'an own hook that calls nothing of quorate\'s states what is lost');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('check-install recognises a quorate-installed hook by the very marker install.mjs writes', () => {
  const marker = (rel, re) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8').match(re)?.[1];
  const installs = marker('.claude/hooks/install.mjs', /const MARKER = '([^']+)'/);
  const checks = marker('scripts/check-install.mjs', /const HOOK_MARKER = '([^']+)'/);
  assert.ok(installs, 'install.mjs must still declare its MARKER');
  assert.equal(checks, installs, 'the two must be the same text, or every installed hook reads as the project\'s own');
});

// A REVIEWS .gitignore SHORT OF A RULE IS A STALE INSTALL. run-graph writes the full file only when it is absent,
// so one written by an older quorate stays short forever; check-install said "install is current" over exactly that
// in M1's story-pipeline sandbox, where the file lacked '.preflight-cache/' (ledgered at check-install.mjs:560).
test('regression: a reviews .gitignore missing a rule the engine needs is reported stale, by name', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-reviewsignore-'));
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: dir });
    fs.copyFileSync(path.join(REPO_ROOT, 'CLAUDE.md'), path.join(dir, 'CLAUDE.md'));
    fs.mkdirSync(path.join(dir, '.claude', 'reviews'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'reviews', '.gitignore'), '*/evidence/\n');
    const out = runScript('check-install.mjs', ['--repo-root', dir]).output;
    assert.match(out, /STALE: .*\.gitignore lacks .*\.preflight-cache/, 'the missing rule is named');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// G-3 of 20261025-095239-srf-remediation-2-review: idsIn turned EVERY listing error into "no ids", so a permission or I/O
// failure read as a framework with no skills and the collision checks passed without running. Only an absent directory
// is empty; any other error is reported.
test('regression: a framework directory that cannot be listed fails closed, not as zero ids', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'check-install.mjs'), 'utf8');
  const m = /function idsIn\(dir, file\) \{[\s\S]*?\n\}\n/.exec(src);
  assert.ok(m, 'idsIn is defined in check-install.mjs');
  const idsIn = (io) => new Function('fs', 'path', `${m[0]}\nreturn idsIn;`)(io, path);
  const failing = (code) => ({
    readdirSync: () => { throw Object.assign(new Error(code), { code }); },
    existsSync: () => true,
  });
  assert.deepEqual(idsIn(failing('ENOENT'))('x', 'SKILL.md'), [], 'an absent directory has no ids');
  for (const code of ['EACCES', 'EPERM', 'EIO']) {
    assert.throws(() => idsIn(failing(code))('x', 'SKILL.md'), new RegExp(code), `${code} must not read as zero ids`);
  }
  // G-3 of 20261025-104155-srf-remediation-3-review: the marker was asked with existsSync, which reads an access or I/O
  // error as "absent", so an unreadable skill directory left the collision checks in silence. existsSync stands for that.
  const markerFailing = (code) => ({
    readdirSync: () => [{ name: 'a', isDirectory: () => true }, { name: 'b', isDirectory: () => true }],
    existsSync: () => false,
    statSync: (p) => {
      if (p.includes(`${path.sep}b${path.sep}`)) return { isFile: () => true };
      throw Object.assign(new Error(code), { code });
    },
  });
  for (const code of ['EACCES', 'EPERM', 'EIO']) {
    assert.throws(() => idsIn(markerFailing(code))('x', 'SKILL.md'), new RegExp(code), `a marker ${code} must not read as absent`);
  }
  assert.deepEqual(idsIn(markerFailing('ENOENT'))('x', 'SKILL.md'), ['b'], 'a directory with no marker is not an id');
});
