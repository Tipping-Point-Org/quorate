// regression-probe-limit-sum.test.mjs — probe-limit-sum.plan.md stage 1 (design note, Verification 1-3).
//
// The reviewer probe's limits enter one timer as a sum, 3 x version + 2 x probe + 4 x margin. A remediation answered that
// by lowering the probe limit's own maximum to 17,865 (PROBE_MAX in lib/check-timeout.mjs), which put the fit rule in a
// second place that could disagree with the real sum (G-1 of 20261022-131046-cid1a-remediation-3-review). Now each value
// keeps the one maximum, and probeLimits, the one owner of the sum, checks it at mint and at the call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runScript, REPO_ROOT } from './helpers.mjs';
import { minutes, MINUTES, TIMER_MAX_MINUTES } from '../scripts/lib/check-timeout.mjs';
import { probeLimits } from '../scripts/lib/reviewer-probe.mjs';

test('the probe limit takes the one maximum as a value; the registry has no second maximum', () => {
  assert.equal(minutes('reviewers.probe_timeout_minutes', TIMER_MAX_MINUTES), TIMER_MAX_MINUTES);
  assert.equal(MINUTES['reviewers.probe_timeout_minutes'].max, TIMER_MAX_MINUTES);
  for (const [key, spec] of Object.entries(MINUTES)) assert.equal(spec.max, TIMER_MAX_MINUTES, `${key} has a maximum of its own`);
});

test('probeLimits refuses a set whose sum does not fit one timer, naming each term', () => {
  const defaults = { probe_timeout_minutes: 5, version_timeout_seconds: 30, check_margin_seconds: 60 };
  assert.doesNotThrow(() => probeLimits({ probe_timeout_minutes: 17_000 }, defaults));
  // The whole refusal, the computed sum and the timer's maximum included (G-5 of 20261022-141455-pls-delivery): the regex
  // stopped after the margin term, so dropping both values from the message left this green.
  const sum = 3 * 30_000 + 2 * 20_000 * 60_000 + 4 * 60_000;
  assert.throws(() => probeLimits({ probe_timeout_minutes: 20_000 }, defaults),
    new RegExp(`do not fit one timer together: 3 x version \\(30 s\\) \\+ 2 x probe \\(20000 min\\) \\+ 4 x margin \\(60 s\\) = ${sum} ms, above a Node timer's 2147483647 ms; lower the probe limits`));
});

test('the documented largest probe limit fits with the shipped limits, and the next hundredth does not', () => {
  // G-4 of 20261022-141455-pls-delivery: the limit takes a fraction, and "17,892" left 17,892.9 fitting above it.
  const doc = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'claude-md-contract.md'), 'utf8');
  const m = doc.match(/a\s+probe\s+limit\s+fits\s+up\s+to\s+([\d,.]+)\s+minutes/);
  assert.ok(m, 'shared/claude-md-contract.md no longer states the largest probe limit that fits');
  const largest = Number(m[1].replace(/,/g, ''));
  const defaults = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'reviewers.json'), 'utf8')).probe_defaults;
  assert.doesNotThrow(() => probeLimits({ probe_timeout_minutes: largest }, defaults));
  const next = Math.round((largest + 0.01) * 100) / 100;
  assert.throws(() => probeLimits({ probe_timeout_minutes: next }, defaults), /do not fit one timer together/,
    `${next} minutes fits, so the documented ${m[1]} is not the largest`);
});

function repoWith(t, contractLines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-probe-sum-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.mjs'), 'export const a = 1;\n');
  const yaml = ['graph_contract: 1', 'project: t', 'commands:', '  build: ""', '  test: ""', 'source_globs: ["src/**"]', ...contractLines].join('\n');
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# t\n\n```yaml\n' + yaml + '\n```\n');
  return dir;
}
const mint = (dir) => runScript('new-run.mjs', ['--dry-run', '--repo-root', dir, '--no-request', '--no-verify-sandbox', '--full-sweep', 'src'], { cwd: dir });

test('new-run refuses at mint a declared reviewer whose probe limits fit alone but not as a sum, and mints one that fits', (t) => {
  const over = mint(repoWith(t, ['reviewers:', '  codex:', '    probe_timeout_minutes: 20000']));
  assert.notEqual(over.status, 0, 'a probe limit set whose sum exceeds a timer was accepted at mint');
  assert.match(over.output, /codex: probeLimits: the probe limits do not fit one timer together/, over.output);
  const fits = mint(repoWith(t, ['reviewers:', '  codex:', '    probe_timeout_minutes: 17000']));
  assert.doesNotMatch(fits.output, /do not fit one timer together/, fits.output);
  // The mint SUCCEEDS (G-7 of 20261022-141455-pls-delivery): any unrelated failure without the phrase passed this half.
  assert.equal(fits.status, 0, fits.output);
});

test('an unrelated refusal at mint does not hide the probe-limit sum\'s', (t) => {
  // G-1 of 20261022-141455-pls-delivery: the sum was checked only when no other error had been found, so an age-limit
  // error hid it until a second mint.
  const both = mint(repoWith(t, ['review:', '  reviewer_probe_max_age_hours: -5', 'reviewers:', '  codex:', '    probe_timeout_minutes: 20000']));
  assert.notEqual(both.status, 0, both.output);
  assert.match(both.output, /reviewer_probe_max_age_hours must be/, both.output);
  assert.match(both.output, /codex: probeLimits: the probe limits do not fit one timer together/, both.output);
});

test('an adapter\'s own unrelated refusal does not hide its probe-limit sum\'s', (t) => {
  // G-1 of 20261022-151016-pls-remediation-b-review: the sum was skipped for an adapter with ANY adapterErrors result, a
  // missing prompt.via included, not only for one whose own probe limits were refused.
  const both = mint(repoWith(t, ['reviewers:', '  vendorx:', '    cmd: vendorx', '    response: { from: file }',
    '    probe_timeout_minutes: 20000']));
  assert.notEqual(both.status, 0, both.output);
  assert.match(both.output, /reviewer 'vendorx' declares no prompt\.via/, both.output);
  assert.match(both.output, /vendorx: probeLimits: the probe limits do not fit one timer together/, both.output);
});

test('a declared non-built-in adapter is sum-checked at mint, and the whole refusal reaches the operator', (t) => {
  // G-5 of 20261022-151016-pls-remediation-b-review: the mint tests declared only an override of the built-in codex, so
  // dropping declared adapters from the loop left them green, and they matched only the refusal's prefix.
  const defaults = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'reviewers.json'), 'utf8')).probe_defaults;
  const v = defaults.version_timeout_seconds;
  const mg = defaults.check_margin_seconds;
  const sum = 3 * v * 1000 + 2 * 20_000 * 60_000 + 4 * mg * 1000;
  const over = mint(repoWith(t, ['reviewers:', '  vendorx:', '    cmd: vendorx', '    response: { from: file }',
    '    prompt: { via: stdin }', '    probe_timeout_minutes: 20000']));
  assert.notEqual(over.status, 0, over.output);
  assert.match(over.output, new RegExp(`vendorx: probeLimits: the probe limits do not fit one timer together: 3 x version \\(${v} s\\) `
    + `\\+ 2 x probe \\(20000 min\\) \\+ 4 x margin \\(${mg} s\\) = ${sum} ms, above a Node timer's 2147483647 ms; lower the probe limits`), over.output);
});

test('no copy of the probe\'s fit rule outside probeLimits', () => {
  // The authority is probeLimits itself: the sum it computes is named checkBoundMs, and the per-key shortcut was PROBE_MAX.
  // [[:space:]], not \s (ci-path-identity.plan.md stage 3b): POSIX ERE has no \s, and macOS's git grep -E found nothing
  // with it, so the search exited 1 there (CI run 44220656481).
  const hits = execFileSync('git', ['grep', '-n', '-E', 'PROBE_MAX|checkBoundMs[[:space:]]*=|TIMER_MAX_MINUTES[[:space:]]*-[[:space:]]*[0-9]', '--', 'scripts'],
    { cwd: REPO_ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  assert.deepEqual(hits.filter((l) => !l.startsWith('scripts/lib/reviewer-probe.mjs:')), []);
  assert.ok(hits.some((l) => l.startsWith('scripts/lib/reviewer-probe.mjs:')), 'probeLimits no longer computes checkBoundMs');
  // BY SHAPE TOO (G-8 of 20261022-141455-pls-delivery): a copy of the sum under other names passed the name search. Any
  // code line adding a version term to a probe or margin term is the fit expression, and only probeLimits may hold it.
  const sums = execFileSync('git', ['grep', '-n', '-i', '-E',
    'version[A-Za-z_]*[^;]*\\+[^;]*(probe|margin)|(probe|margin)[A-Za-z_]*[^;]*\\+[^;]*version', '--', 'scripts/*.mjs'],
  { cwd: REPO_ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  const code = sums.filter((l) => !/^[^:]+:\d+:\s*(\/\/|\*|\/\*)/.test(l));
  assert.deepEqual(code.filter((l) => !l.startsWith('scripts/lib/reviewer-probe.mjs:')), []);
});
