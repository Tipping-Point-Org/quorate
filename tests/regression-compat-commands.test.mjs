// THE COMMANDS 1.x PROMISES (shared/compatibility.md, "Commands"; m3-v1.plan.md stage 3).
//
// The entry points and flags QUORATE.md documents keep working as documented. Nothing compared QUORATE.md with what the
// scripts accept: a documented invocation could be refused by its own script (the --claude-bin rename of 0.3.0 was such
// a break, caught by hand). Each invocation QUORATE.md writes out is parsed against lib/argv-specs.mjs, the one argv
// owner the scripts parse with, and each frozen flag must stay accepted and documented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT, releaseTags } from './helpers.mjs';
import { ARGV_SPECS } from '../scripts/lib/argv-specs.mjs';
import { parseArgv } from '../scripts/lib/argv.mjs';
import * as lib from '../scripts/lib/compatibility.mjs';

const { documentedInvocations, mentionedFlags, freezeHolds, preRelease } = lib;

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const compat = JSON.parse(read('scripts/compatibility.json'));
const quorateMd = read('QUORATE.md');
const INSTALL = '.claude/hooks/install.mjs';

test('every invocation QUORATE.md writes out parses against its script\'s argv spec', () => {
  const inv = documentedInvocations(quorateMd, ARGV_SPECS);
  assert.ok(inv.length >= 12, `read only ${inv.length} invocations: the reading, not QUORATE.md`);
  const refused = [];
  for (const i of inv) {
    try { parseArgv(i.argv, ARGV_SPECS[i.script]); } catch (e) { refused.push(`${i.script} ${i.argv.join(' ')}: ${e.message}`); }
  }
  assert.deepEqual(refused, [], 'QUORATE.md documents these and their own script refuses them');
});

// The flags a document writes beside a script: G-3 of 20261124-021129-m3s9-remediation-2-review-b found the check used
// one global set (mentionedFlags), so a flag documented under the wrong command still passed. The fallback keeps the old
// reading so this file shows that defect where lib has no per-script reading.
const flagsFor = (text, script) => (lib.flagsDocumentedWith ? lib.flagsDocumentedWith(text, script) : mentionedFlags(text));

test('every frozen flag is still accepted by its script and still documented in QUORATE.md', () => {
  const problems = [];
  for (const [script, { flags, words }] of Object.entries(compat.commands)) {
    const documented = flagsFor(quorateMd, script);
    if (script === INSTALL) {
      for (const f of flags) if (!documented.has(f)) problems.push(`${script} ${f}: no longer documented with it in QUORATE.md`);
      continue;
    }
    const spec = ARGV_SPECS[script];
    if (!spec) { problems.push(`${script}: no argv spec`); continue; }
    if (!new RegExp(`\\b${script}(\\.mjs)?\\b`).test(quorateMd)) problems.push(`${script}: no longer in QUORATE.md`);
    for (const f of flags) {
      if (!Object.hasOwn(spec.options ?? {}, f.slice(2))) problems.push(`${script} ${f}: not accepted`);
      if (!documented.has(f)) problems.push(`${script} ${f}: no longer documented with it in QUORATE.md`);
    }
    for (const w of words) if (!new RegExp(`${script}\\.mjs ${w}\\b`).test(quorateMd)) problems.push(`${script} ${w}: no longer in QUORATE.md`);
  }
  assert.deepEqual(problems, [], 'a frozen command or flag was removed or renamed, which waits for 2.0');
});

test('G-3: a frozen flag documented only under another command is not documented for its own', () => {
  const md = [
    '# Setup', '',
    '- **Stop log**: `node scripts/stop-log.mjs --summary` reports the record.', '',
    '- **Stop guard**: run `node scripts/stop-guard.mjs` from the Stop hook.', '',
    '  With `--turn-start` it notes a turn.', '',
    '- **Elsewhere**: `--stop-failure` is a flag of something.', '',
  ].join('\n');
  assert.ok(flagsFor(md, 'stop-log').has('--summary'), 'a flag beside its script is documented for it');
  assert.ok(flagsFor(md, 'stop-guard').has('--turn-start'), 'a flag in the same list item as its script is documented for it');
  assert.ok(!flagsFor(md, 'stop-guard').has('--stop-failure'), 'a flag written under another item passed as documented for stop-guard');
  assert.ok(!flagsFor(md, 'stop-log').has('--turn-start'), 'stop-guard\'s flag passed as documented for stop-log');
});

// RUN, NOT READ (G-10 of 20261123-174149-m3s9-remediation-review-b): the check was that `'--force'` appears in the
// installer's source, which a comment or a dead literal satisfies. The installer now runs in a throwaway repository
// holding a pre-commit it does not manage: refused without the flag, replaced with it.
test('install.mjs, which reads its argv without the owner, still takes --force', (t) => {
  assert.deepEqual(compat.commands[INSTALL].flags, ['--force'], 'a frozen installer flag this test does not run');
  assert.ok(quorateMd.includes('install.mjs'), 'QUORATE.md no longer documents install.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-install-force-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  spawnSync('git', ['init', '-q', '.'], { cwd: dir });
  const hook = path.join(dir, '.git', 'hooks', 'pre-commit');
  fs.mkdirSync(path.dirname(hook), { recursive: true });
  fs.writeFileSync(hook, '#!/bin/sh\necho mine\n');
  const install = (...a) => spawnSync(process.execPath, [path.join(REPO_ROOT, INSTALL), ...a], { cwd: dir, encoding: 'utf8' });
  const refused = install();
  assert.equal(refused.status, 1, `a hook it does not manage was not refused:\n${refused.stdout}${refused.stderr}`);
  assert.equal(fs.readFileSync(hook, 'utf8'), '#!/bin/sh\necho mine\n');
  const forced = install('--force');
  assert.equal(forced.status, 0, `--force was not taken:\n${forced.stdout}${forced.stderr}`);
  assert.equal(fs.readFileSync(hook, 'utf8'), fs.readFileSync(path.join(REPO_ROOT, '.claude', 'hooks', 'pre-commit'), 'utf8').replace(/\r\n/g, '\n'),
    '--force did not replace the hook with the committed body');
});

test('before 1.0, every flag QUORATE.md mentions is frozen for a command or named as another program\'s', () => {
  const frozenFlags = new Set(Object.values(compat.commands).flatMap((c) => c.flags));
  const foreign = new Set(Object.keys(compat.not_quorate_flags).filter((k) => k.startsWith('--')));
  const current = [...mentionedFlags(quorateMd)].filter((f) => !foreign.has(f));
  const invoked = documentedInvocations(quorateMd, ARGV_SPECS).flatMap((i) => i.flags);
  const { missing, unfrozen } = freezeHolds({ frozen: frozenFlags, current: new Set([...current, ...invoked]), preRelease: preRelease(read('VERSION'), releaseTags()) });
  assert.deepEqual(missing, [], 'a frozen flag is no longer mentioned in QUORATE.md');
  assert.deepEqual(unfrozen, [], 'QUORATE.md mentions these flags and compatibility.json freezes none of them: add each to its command, or to not_quorate_flags');
});

// G-11 of 20261123-161216-m3s9-review: documentedInvocations skips a script with no argv spec, so a newly documented entry
// point that parses argv itself was checked by nothing (I-4's failure mode). Each such script is now named, and must be
// one compatibility.json lists with its own hand check (install.mjs above) or a script whose flags QUORATE.md never writes.
test('every script QUORATE.md invokes without an argv spec is named, and each is checked another way', () => {
  const named = lib.invocationsWithoutSpec?.('`node scripts/no-spec-here.mjs --x` and `new-run.mjs --dry-run`', ARGV_SPECS);
  assert.deepEqual(named, ['no-spec-here'], 'a documented script with no argv spec is dropped without a word');
  const handChecked = new Set(Object.keys(compat.commands).map((k) => path.basename(k, '.mjs')));
  const unchecked = lib.invocationsWithoutSpec(quorateMd, ARGV_SPECS)
    .filter((s) => !handChecked.has(s) && !Object.hasOwn(compat.not_argv_scripts ?? {}, s));
  assert.deepEqual(unchecked, [], 'QUORATE.md invokes these scripts and nothing checks their arguments: give each an argv spec, or list it in compatibility.json not_argv_scripts with why');
});

test('documentedInvocations reads a placeholder as a value and stops at the end of the code span', () => {
  const [a, b] = documentedInvocations('`node scripts/code-index.mjs <shape> --args \'<json>\'` and `telemetry.mjs report` x', ARGV_SPECS);
  assert.deepEqual(a.argv, ['x', '--args', 'x']);
  assert.deepEqual(b.words, ['report']);
  assert.equal(documentedInvocations('`not-a-script.mjs --x`', ARGV_SPECS).length, 0);
});
