// regression-admit-run-adoption.test.mjs — run-dir-trust.plan.md stage 4 (ARCHITECTURE A-28; design R-D3 A).
//
// The rounds this answers came from each entry script composing its own subset of the checks on a run directory it was
// given. The set of scripts that take one is not a list kept here: it is every entry in scripts/lib/argv-specs.mjs, the
// one record of every entrypoint's command line, whose options name a run directory. Each such script must admit it
// through admitRun, and none may decide containment or ownership for it with the helpers admitRun is built from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { ARGV_SPECS } from '../scripts/lib/argv-specs.mjs';

// The options that name a run directory. `evidence-dir` is not one: it names a sink with no run.json, held to
// external-review's own write rules (where a raw vendor response may land), and admits nothing.
const RUN_DIR_OPTIONS = ['run-dir', 'remediates', 'follows-remediation'];

/** Every entry whose options name a run directory, from the authority, with the source of its script. */
export function runDirEntries(specs = ARGV_SPECS) {
  return Object.entries(specs)
    .filter(([, spec]) => Object.keys(spec.options ?? {}).some((o) => RUN_DIR_OPTIONS.includes(o)))
    .map(([name]) => ({ name, file: path.join(REPO_ROOT, 'scripts', `${name}.mjs`) }));
}

/** What is wrong with one script's source, or [] when it admits its run directory through the owner. */
export function adoptionProblems(src) {
  const problems = [];
  if (!/import \{[^}]*\badmitRun\b[^}]*\} from '\.\/io\/reviews-root\.mjs'/.test(src)) problems.push('does not import admitRun from ./io/reviews-root.mjs');
  if (!/\badmitRun\(/.test(src)) problems.push('never calls admitRun');
  // The pieces admitRun composes, used directly, are a second decision about the same directory.
  for (const piece of ['runDirAllowed', 'runBelongsToRepo']) {
    if (new RegExp(`\\b${piece}\\(`).test(src)) problems.push(`calls ${piece} itself`);
  }
  // A CALL WHOSE ANSWER IS USED, AND A RECORD READ ONLY THROUGH IT (G-19 of 20261023-014400-rdt-delivery): any textual
  // `admitRun(` passed, so a call whose refusal was discarded did too, and so did a script that admitted the directory
  // and then re-read run.json from the path the caller named (G-13 in remediate, G-5 in capture), acting on a record
  // admitRun never checked.
  if (/(^|[;{}])\s*admitRun\(/m.test(src)) problems.push('discards the result of admitRun');
  if (/\badmitRun\(/.test(src) && !/\.ok\b/.test(src)) problems.push('never checks admitRun\'s ok');
  // Each name handed to admitRun as the run directory, and the source AFTER that call: a read of run.json through the
  // same name there is a second record admitRun never checked.
  const reported = new Set();
  // The value is a name (`runDir: given`), the shorthand (`runDir`), or an expression (`runDir: frame.run_dir`), which
  // names no variable a later read could reuse and is skipped: reading it as the shorthand flagged remediate's own
  // admitted `runDir` as a re-read.
  for (const m of src.matchAll(/\badmitRun\(\{\s*runDir\s*(?::\s*([^,}]+?)\s*)?[,}]/g)) {
    if (m[1] !== undefined && !/^[A-Za-z_$][\w$]*$/.test(m[1])) continue;
    const v = m[1] ?? 'runDir';
    const after = src.slice(m.index + m[0].length);
    const reread = new RegExp(`readFileSync\\(\\s*path\\.join\\(\\s*${v}\\s*,\\s*'run\\.json'\\s*\\)|\\breadRun\\(\\s*${v}\\s*\\)`
      + `|\\b(\\w+)\\s*=\\s*path\\.join\\(\\s*${v}\\s*,\\s*'run\\.json'\\s*\\)`);
    if (!reported.has(v) && reread.test(after)) {
      reported.add(v);
      problems.push(`re-reads run.json from ${v}, the directory the caller named, instead of the admitted record`);
    }
  }
  return problems;
}

test('every script whose command line names a run directory admits it through admitRun, and only through it', () => {
  const entries = runDirEntries();
  // A floor from the authority as it stood when this was written (2026-10-23, ten entries; dated, indicative): a change to
  // how the options are spelled that matched nothing would otherwise pass this test with nothing checked.
  assert.ok(entries.length >= 10, `only ${entries.length} entries name a run directory: ${entries.map((e) => e.name).join(', ')}`);
  const failing = [];
  for (const { name, file } of entries) {
    assert.ok(fs.existsSync(file), `${name} is in argv-specs but scripts/${name}.mjs does not exist`);
    const problems = adoptionProblems(fs.readFileSync(file, 'utf8'));
    if (problems.length) failing.push(`${name}: ${problems.join('; ')}`);
  }
  assert.deepEqual(failing, [], 'a script reads a run directory without the one owner (ARCHITECTURE A-28)');
});

test('the check is not vacuous: a script with a run-directory flag that does not call the owner is caught', () => {
  const specs = { ...ARGV_SPECS, 'scratch-reader': { options: { 'run-dir': 'string' } } };
  assert.ok(runDirEntries(specs).some((e) => e.name === 'scratch-reader'), 'a new run-directory flag is not enumerated');
  const src = "import { runDirAllowed } from './io/reviews-root.mjs';\nconst ok = runDirAllowed({ runDir });\n";
  assert.deepEqual(adoptionProblems(src), [
    'does not import admitRun from ./io/reviews-root.mjs', 'never calls admitRun', 'calls runDirAllowed itself',
  ]);
  const imp = "import { admitRun } from './io/reviews-root.mjs';\n";
  assert.deepEqual(adoptionProblems(`${imp}const a = admitRun({ runDir });\nif (!a.ok) die(a.why);\nuse(a.record);\n`), []);
  // G-19: the shapes that bypass the owner while still spelling its name.
  assert.deepEqual(adoptionProblems(`${imp}admitRun({ runDir });\n`), ['discards the result of admitRun', 'never checks admitRun\'s ok']);
  assert.deepEqual(adoptionProblems(`${imp}const a = admitRun({ runDir });\nif (!a.ok) die(a.why);\n`
    + "const rj = JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8'));\n"),
  ['re-reads run.json from runDir, the directory the caller named, instead of the admitted record']);
  assert.deepEqual(adoptionProblems(`${imp}const a = admitRun({ runDir: given, repoRoot });\nif (!a.ok) die(a.why);\nconst run = readRun(given);\n`),
    ['re-reads run.json from given, the directory the caller named, instead of the admitted record']);
  // An expression value names no variable: a later read of another name is not a re-read of it.
  assert.deepEqual(adoptionProblems(`${imp}const a = admitRun({ runDir: given, repoRoot });\nif (!a.ok) die(a.why);\nconst runDir = a.dir;\n`
    + "const b = admitRun({ runDir: frame.run_dir, repoRoot });\nif (!b.ok) die(b.why);\nconst run = readRun(runDir);\n"), []);
});

test('A-28 names the owner and the rule this test holds', () => {
  const arch = fs.readFileSync(path.join(REPO_ROOT, 'ARCHITECTURE.md'), 'utf8');
  assert.match(arch, /### A-28 — A run directory a caller names is admitted by one owner/);
  assert.match(arch, /`admitRun`/);
});
