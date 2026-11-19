// run-dir-descendants.plan.md stage 4 (D-D4 A): after admitRun, an entry script uses only the directory it returned.
// Over every ARGV_SPECS entry with a run-directory option, no line after the script's first admission uses the raw
// option value, except: the admission itself, a message naming what was refused, and a test of whether the flag was
// given at all. A read of a recorded run-pointing field (a remediation frame's run_dir or reconciled_md, a follow-up's
// run_dir) passes through admission first.
//
// THE RESIDUAL, stated: a rewrite that carries the raw value under another name (const d = args.runDir; ... use d)
// evades a source-shape test like this one. Stage 3's behavioural tests hold the cases on record.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { ARGV_SPECS } from '../scripts/lib/argv-specs.mjs';

// The raw spellings of each run-directory option, as the entry scripts name them.
const RAW = {
  'run-dir': ['givenRunDir', 'args\\.runDir', "args\\['run-dir'\\]", "v\\['run-dir'\\]"],
  remediates: ['args\\.remediates'],
  'follows-remediation': ['args\\.followsRemediation'],
};
const ADMISSION = /\badmitRun\(|\brunDirOrDie\(/;
const MESSAGE = /\bdie\(|console\.(error|log)\(/;
const code = (src) => src.split(/\r?\n/).map((l, i) => ({ l, n: i + 1 })).filter(({ l }) => !/^\s*(\/\/|\*|\/\*)/.test(l));

/** The lines after the first admission that use a raw option value other than as a test of whether it was given. */
export function rawUsesAfterAdmission(src, rawNames) {
  const lines = code(src);
  const first = lines.findIndex(({ l }) => ADMISSION.test(l) && !/^\s*import\b/.test(l));
  if (first < 0) return ['no admission found'];
  const raw = new RegExp(`(?:${rawNames.join('|')})`);
  // A test of whether the flag was given: `if (RAW`, `RAW ?` (not `??`), `RAW &&`, `!RAW`.
  const tests = new RegExp(`if \\(\\s*(?:${rawNames.join('|')})\\b|(?:${rawNames.join('|')})\\s*(?:\\?(?!\\?)|&&)|!(?:${rawNames.join('|')})\\b`, 'g');
  return lines.slice(first + 1)
    .filter(({ l }) => raw.test(l) && !ADMISSION.test(l) && !MESSAGE.test(l) && raw.test(l.replace(tests, '')))
    .map(({ l, n }) => `${n}: ${l.trim().slice(0, 110)}`);
}

test('run-dir-descendants stage 4: the check reports a raw value used after admission, and allows the three forms', () => {
  const names = RAW['run-dir'];
  const src = [
    "const admitted = admitRun({ runDir: path.resolve(args.runDir), repoRoot });",
    "if (!admitted.ok) die(`--run-dir ${args.runDir}: ${admitted.why}`);",
    "const flag = args.runDir ? '--run-dir' : '--evidence-dir';",
    "const evidence = path.join(args.runDir, 'evidence');",
  ].join('\n');
  assert.deepEqual(rawUsesAfterAdmission(src, names).map((s) => s.split(':')[0]), ['4'], 'only the path built from the raw value');
  assert.deepEqual(rawUsesAfterAdmission('fs.readFileSync(path.join(args.runDir, "run.json"));', names), ['no admission found']);
});

test('run-dir-descendants stage 4: no entry script uses a raw run-directory value after admitting it', () => {
  const offenders = [];
  let scripts = 0;
  for (const [name, spec] of Object.entries(ARGV_SPECS)) {
    const options = Object.keys(spec.options ?? spec.flags ?? spec).filter((o) => RAW[o]);
    if (!options.length) continue;
    const file = path.join(REPO_ROOT, 'scripts', `${name}.mjs`);
    assert.ok(fs.existsSync(file), `${name} declares a run-directory option and has no script at scripts/${name}.mjs`);
    scripts++;
    for (const hit of rawUsesAfterAdmission(fs.readFileSync(file, 'utf8'), options.flatMap((o) => RAW[o]))) offenders.push(`scripts/${name}.mjs:${hit}`);
  }
  assert.deepEqual(offenders, [], `a raw run-directory value used after admission:\n${offenders.join('\n')}`);
  // Dated, indicative: 2026-10-29, ten entry scripts take a run-directory option.
  assert.ok(scripts >= 8, `only ${scripts} script(s) found with a run-directory option: the spec lookup has stopped matching`);
});

test('run-dir-descendants stage 4: a recorded run-pointing field is read only through admission', () => {
  const offenders = [];
  const FIELD = /\bframe\.(run_dir|reconciled_md)\b|remediation_frame\.(run_dir|reconciled_md)\b|\bfollows\.run_dir\b|followup_run_dir/;
  for (const f of ['run-graph.mjs', 'remediate.mjs', 'new-run.mjs', 'findings-ledger.mjs', 'archive-run.mjs']) {
    for (const { l, n } of code(fs.readFileSync(path.join(REPO_ROOT, 'scripts', f), 'utf8'))) {
      if (!FIELD.test(l)) continue;
      // The admission, an admitting resolver, a message, or the field written or tested for presence.
      if (ADMISSION.test(l) || /resolveLinkedRun\(/.test(l) || MESSAGE.test(l) || /followup_run_dir: /.test(l) || /if \(run\.followup_run_dir\)/.test(l)) continue;
      offenders.push(`scripts/${f}:${n}: ${l.trim().slice(0, 110)}`);
    }
  }
  assert.deepEqual(offenders, [], `a recorded run path read without admission:\n${offenders.join('\n')}`);
});
