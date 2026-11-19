// regression-rule-text-real-tree.test.mjs — code-index-d1-part-a.plan.md stage 5 (design note A-D4′, Verification 4).
//
// The degraded-cap rule was stated in dozens of places and the document named as the owner of key meanings was among
// the wrong ones (G-17 of 20261021-202611-ciss-d1-remediation-4-review). Over this repository: every region is current,
// no restatement stands outside a region without the exception, every site the census found is a region, carries the
// exception, or is allowed with a reason, and the allow-list has no entry that matches nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runScript, REPO_ROOT, replacedInSnapshot, publishedForm } from './helpers.mjs';
import { RULES, regionsIn } from '../scripts/lib/rule-text.mjs';

const read = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8');
const census = JSON.parse(fs.readFileSync(new URL('./fixtures/rule-text/degraded-cap-census.json', import.meta.url), 'utf8'));

test('gen-rule-text --check passes over this repository: no stale region, no restatement outside one', () => {
  const r = runScript('gen-rule-text.mjs', ['--check'], { cwd: REPO_ROOT });
  assert.equal(r.status, 0, r.output);
});

// A row or allowance on a file the release snapshot replaces (CLAUDE.md) is about the private file's text, absent there;
// the published file is still held to the rule by gen-rule-text --check above. Skipped by name, never silently.
test('every census site is a region, carries the exception, or is allowed with a reason', (t) => {
  const rule = RULES['degraded-cap'];
  assert.ok(census.rows.length >= 30, `the census has ${census.rows.length} rows; it was taken with 38`);
  const wrong = [];
  for (const row of census.rows) {
    const skip = replacedInSnapshot(row.file);
    if (skip) { t.diagnostic(`census row skipped: ${skip}`); continue; }
    const text = read(row.file);
    const at = text.indexOf(row.anchor);
    if (at < 0 || text.indexOf(row.anchor, at + 1) >= 0) { wrong.push(`${row.file}: anchor not found exactly once: ${row.anchor}`); continue; }
    const lineNo = text.slice(0, at).split('\n').length;
    const line = text.split('\n')[lineNo - 1];
    if (row.status === 'region') {
      const near = regionsIn(text, row.file).filter((g) => g.id === 'degraded-cap')
        .some((g) => Math.abs(text.slice(0, g.start).split('\n').length - lineNo) <= 3);
      if (!near) wrong.push(`${row.file}:${lineNo}: no rule:degraded-cap region within 3 lines`);
    } else if (row.status === 'pointer') {
      // A copy turned into a pointer at the owner (operator, 2026-11-05: "Pointers, all 6"): no region near it, and a
      // line near it names disk-first-protocol.md §7, so the rule is stated once, in §7.
      const lines = text.split('\n');
      const near = (re) => lines.slice(Math.max(0, lineNo - 4), lineNo + 3).some((l) => re.test(l));
      const region = regionsIn(text, row.file).filter((g) => g.id === 'degraded-cap')
        .some((g) => Math.abs(text.slice(0, g.start).split('\n').length - lineNo) <= 3);
      if (region) wrong.push(`${row.file}:${lineNo}: a pointer row still has a rule:degraded-cap region near it`);
      if (!near(/disk-first-protocol\.md`? §7/)) wrong.push(`${row.file}:${lineNo}: no pointer to disk-first-protocol.md §7 within 3 lines`);
      if (!String(row.why ?? '').trim()) wrong.push(`${row.file}:${lineNo}: pointer with no reason`);
    } else if (row.status === 'exception') {
      if (!rule.exception.test(line)) wrong.push(`${row.file}:${lineNo}: the line does not carry the exception`);
    } else if (row.status !== 'allowed' || !String(row.why ?? '').trim()) {
      wrong.push(`${row.file}:${lineNo}: status ${row.status} with no reason`);
    }
  }
  assert.deepEqual(wrong, []);
});

test('§7 owns the rule: it carries a region for each degraded lens', () => {
  const dfp = read('shared/disk-first-protocol.md');
  const s7 = dfp.slice(dfp.indexOf('## §7'));
  const subjects = regionsIn(s7, 'x.md').filter((g) => g.id === 'degraded-cap').map((g) => g.args.subject);
  for (const lens of ['arch-review', 'perf-audit', 'contract-audit']) {
    assert.ok(subjects.some((s) => s.includes(lens)), `§7 has no degraded-cap region for ${lens}`);
  }
});

// Which allowances are wrong in a tree (G-9 of 20261119-000606-m2-9c-d1). Skipping an allowance on a replaced file left
// it untested in exactly the published layout, where CLAUDE.md still exists and the allowance still applies to it.
// So an allowance on a file the snapshot replaces is held in both: here, live on the private file and excusing no line of
// its published source; in the snapshot, excusing no line of the published file it still applies to.
const allowanceProblems = (allowed, { read: rd, replaced, source = () => null }) => {
  const problems = [];
  for (const [f, sub] of allowed) {
    const has = (text) => text.split('\n').some((l) => l.includes(sub));
    if (replaced(f)) {
      if (has(rd(f))) problems.push(`${f}: the published form has a line the private file's allowance excuses: ${sub}`);
      continue;
    }
    if (!has(rd(f))) problems.push(`${f}: no line matches ${sub}`);
    const from = source(f);
    if (from && has(rd(from))) problems.push(`${from}: the published source of ${f} has a line its allowance excuses: ${sub}`);
  }
  return problems;
};

test('every allow-list entry matches a line it excuses', () => {
  const source = (f) => { const p = publishedForm(f); return p !== f ? p : null; };
  assert.deepEqual(allowanceProblems(RULES['degraded-cap'].allowed ?? [], { read, replaced: replacedInSnapshot, source }), []);
});

test('an allowance on a replaced file is checked in both layouts, never skipped', () => {
  const allowed = [['CLAUDE.md', 'private history line']];
  // The published layout: CLAUDE.md is the published form; a private line the allowance names has leaked into it.
  const snapshot = { 'CLAUDE.md': 'x\nprivate history line\n' };
  assert.notDeepEqual(allowanceProblems(allowed, { read: (f) => snapshot[f], replaced: () => 'published form' }), [],
    'an allowance on the published form excused a line of it, unreported');
  // The private layout: the allowance is live on the private file, and its published source carries no line it excuses.
  const priv = { 'CLAUDE.md': 'private history line\n', 'publish/CLAUDE.public.md': 'private history line\n' };
  assert.notDeepEqual(allowanceProblems(allowed, { read: (f) => priv[f], replaced: () => false, source: () => 'publish/CLAUDE.public.md' }), [],
    'the published source carries a line the private allowance excuses, unreported');
  const clean = { 'CLAUDE.md': 'private history line\n', 'publish/CLAUDE.public.md': 'public text\n' };
  assert.deepEqual(allowanceProblems(allowed, { read: (f) => clean[f], replaced: () => false, source: () => 'publish/CLAUDE.public.md' }), []);
  assert.deepEqual(allowanceProblems(allowed, { read: () => 'public text\n', replaced: () => 'published form' }), []);
});

test('the contract document carries the minutes table, generated from the owner', () => {
  const doc = read('shared/claude-md-contract.md');
  const table = regionsIn(doc, 'shared/claude-md-contract.md').find((g) => g.id === 'minutes-table');
  assert.ok(table, 'shared/claude-md-contract.md has no rule:minutes-table region');
  assert.match(table.body, /`review\.node_timeout_minutes` \| 30 \|/);
  assert.match(read('CLAUDE.template.md'), /node_timeout_minutes: 30\b/, 'the template still shows the old absent default');
});

// G-2 of 20261105-173030-crsf-d1-remediation-review (operator, 2026-11-05: "Pointers, all 6"): the degraded-cap rule is
// stated once, in shared/disk-first-protocol.md; every other document points at §7 instead of carrying a copy.
test('no document outside disk-first-protocol.md carries a degraded-cap region', () => {
  const r = runScript('gen-rule-text.mjs', ['--check'], { cwd: REPO_ROOT });
  assert.equal(r.status, 0, r.output);
  const files = ['QUORATE.md', 'CLAUDE.md', 'README.md', 'shared/claude-md-contract.md', 'skills/full-review/SKILL.md', 'skills/request/SKILL.md'];
  const holders = files.filter((f) => regionsIn(read(f), f).some((g) => g.id === 'degraded-cap'));
  assert.deepEqual(holders, []);
});
