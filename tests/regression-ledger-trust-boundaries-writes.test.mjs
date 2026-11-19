// ledger-trust-boundaries, stage 1 — what reaches a tracked file, and what is read from a run.
// (plan: .claude/requests/ledger-trust-boundaries.plan.md, approved 2026-09-28: "A, approved, start stage 1")
//
// 1b — every tracked write passes through the one redaction owner; the push scan ships a key-value rule.
// 2a — one strict reader for a run's files, whose callers each keep their own policy.
//
// HOW FAR THIS REACHES, stated (a deviation from the plan's wording, recorded in the stage-1 commit): no
// offline harness gets run-graph to write reconciled.md — seeding a finding makes it spawn a real reconcile
// node, which would reach a billed vendor. So the tracked-write guarantee is tested at three levels: a lens
// report end to end through spawn-node with a fake CLI; the redaction owner itself; and a source check that
// every raw write in run-graph.mjs and spawn-node.mjs outside evidence/ is a known machine-data target —
// which, like enumerating a run directory, also catches a writer added later.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runScript, REPO_ROOT, repoRunDir } from './helpers.mjs';
import { redactTree } from '../scripts/lib/redact.mjs';
import { readKeptVerdict, readNodeStatus, readRunRecord, collectRun } from '../scripts/io/run-artifacts.mjs';
import { secretScanArgv, secretScanConfig } from '../scripts/lib/push-gate.mjs';

const GH = 'ghp_' + 'Q7w'.repeat(12);                   // a token shape both guards know
const JSON_PW = 'Tr0ub4dor&3xq9Zk';                    // what G-11 showed the owner missed
const SECRETS = [GH, JSON_PW];
// The credential NAME built at runtime (operator, 2026-09-28: "build at runtime"): written literally, a
// `"password": "…"` fixture is exactly what the shipped gitleaks rule blocks on push.
const PW = 'pass' + 'word';

function tmp(t, prefix = 'q-ltbw-') {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}
// Every file under `dir` outside evidence/, with its text.
function trackedFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'evidence') walk(p); } else out.push([path.relative(dir, p), fs.readFileSync(p, 'utf8')]);
    }
  };
  walk(dir);
  return out;
}

// ---------------------------------------------------------------------------------- 1b, end to end
test('1b: a lens whose claim, not_checked reason and observation quote a secret leaves it in no tracked file', () => {
  const { base, dir: runDir } = repoRunDir({ runId: '20260101-000000-ltbredact' });
  try {
    fs.writeFileSync(path.join(runDir, 'node-settings.json'), JSON.stringify({ permissions: { defaultMode: 'manual', allow: [], deny: [] } }));
    // A VALID lens verdict, or the node degrades before it writes a report: every envelope field, a
    // non-empty not_checked, a real in-scope file, and evidence the node wrote AFTER it started.
    const ev = path.join(runDir, 'evidence', 'code-audit', 'x.log');
    const payload = {
      schema_version: 1, run_id: '20260101-000000-ltbredact', node_id: 'code-audit', intent_sha: null, verdict: 'RISK', checked_clean: [],
      findings: [{ file: 'scripts/run-graph.mjs', line: 3, severity: 'LOW', basis: 'convention',
        claim: `the config ships {"${PW}": "${JSON_PW}"} and ${GH}`, evidence_path: 'evidence/code-audit/x.log' }],
      not_checked: [{ item: 'the vault', reason: `token ${GH} was not tried` }],
      out_of_scope_observations: [{ file: 'y.mjs', note: `also "${PW}": "${JSON_PW}"` }],
    };
    const fake = path.join(base, 'fake-claude.mjs');
    fs.writeFileSync(fake, [
      `import fs from 'node:fs';`,
      `fs.mkdirSync(${JSON.stringify(path.dirname(ev))}, { recursive: true });`,
      `fs.writeFileSync(${JSON.stringify(ev)}, 'captured');`,
      `process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.01, num_turns: 1, result: ${JSON.stringify(JSON.stringify(payload))} }));`,
      '',
    ].join('\n'));
    runScript('spawn-node.mjs', ['--run-dir', runDir, '--repo-root', REPO_ROOT, '--node-id', 'code-audit', '--mode', 'lens',
      '--prompt', 'x', '--allowed-basis', 'convention', '--timeout-minutes', '1', '--runtime-bin', fake]);
    const files = trackedFiles(runDir);
    assert.ok(files.some(([p]) => p.endsWith('code-audit-report.md')), `no report was written: ${files.map(([p]) => p)}`);
    for (const [p, text] of files) for (const s of SECRETS) assert.ok(!text.includes(s), `${p} carries a secret`);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('1b: redactTree redacts every string leaf of a structure and keeps its shape', () => {
  const out = redactTree({ a: [`x ${GH}`, 3, null], b: { c: `{"${PW}": "${JSON_PW}"}`, d: true } });
  assert.deepEqual(Object.keys(out), ['a', 'b']);
  assert.equal(out.a[1], 3);
  assert.equal(out.b.d, true);
  for (const s of SECRETS) assert.ok(!JSON.stringify(out).includes(s));
});

test('1b: the intent cache — tracked under .claude/reviews/.intent-cache/ — stores its intent text redacted', async (t) => {
  // Found while wiring stage 3: 20 cache files are tracked, each carrying the intent-capture node's text, and the
  // cache lives outside the run directory, so enumerating a run could not have seen it.
  const { writeIntentCache } = await import('../scripts/io/intent-cache.mjs');
  const d = tmp(t);
  const p = writeIntentCache(d, 'a'.repeat(64), { intent_md: `criteria mention "${PW}": "${JSON_PW}" and ${GH}` });
  const text = fs.readFileSync(p, 'utf8');
  for (const s of SECRETS) assert.ok(!text.includes(s), 'the intent cache stored a secret');
});

// Machine-data and evidence targets: the only raw writes allowed. Everything else carries text a model or
// a vendor wrote and must go through the tracked writers. A new raw write fails here until it is named.
// NOT exempt, since claim-checking the stage-1..6 report: node briefs, the arms' prompts (both tracked under
// nodes/, and the arm prompts embed the intent criteria the intent-capture model wrote), reconcile-divergence.json
// and the adjudication pointer. 1b is every tracked write, and the first version of this list exempted them.
// queuePath (telemetry-run-time.plan.md stage 2): queue.json holds node ids and the times they were ready, nothing else.
// armCensus (run-dir-descendants.plan.md stage 2): the remediation census copied into the arms' own directory, which is
// not tracked; it was a copyFileSync this pattern did not match, and is now read from the run through its owner.
const RAW_OK = /evidence|evDir|evidenceDir|runJsonPath|queuePath|expected\.json|checks\.json|failure\.json|crash\.json|ruling\.json|latest\.txt|snapDir|effectiveBriefPath|payload\.json|armCensus/;
function rawWriteOffenders(f, lines) {
  const offenders = [];
  lines.forEach((ln, i) => {
    if (/^\s*\/\//.test(ln)) return;
    if (!/(fs\.writeFileSync|fs\.appendFileSync|\bwriteJson\(|writeJsonAtomic\(|writeTextAtomic\(|appendTextAtomic\()/.test(ln)) return;
    // The tracked writers' own bodies, and writeJson's, are where the raw call belongs.
    if (/function (writeJson|writeTracked|writeTrackedJson|appendTracked|writeTrackedReport)\(/.test(lines.slice(Math.max(0, i - 6), i + 1).join(' '))) return;
    // The write's own arguments: from the call to its closing parenthesis, at most three lines, comments stripped.
    const text = lines.slice(i, i + 3).map((l) => l.replace(/\/\/.*$/, '')).join(' ');
    const from = text.search(/(fs\.writeFileSync|fs\.appendFileSync|\bwriteJson\(|writeJsonAtomic\(|writeTextAtomic\(|appendTextAtomic\()/);
    // Only the TARGET, the call's first argument, may exempt it (G-13 of 20261027-083759-trt-remediation-review): an
    // allowed word in the payload exempted a raw tracked write.
    const open = text.indexOf('(', from);
    // A delimiter inside a string literal is not one (G-7 of 20261027-094343-trt-remediation-2-review): the literal is
    // skipped to its unescaped closing quote.
    let depth = 0; let end = text.length;
    for (let k = open; k < text.length; k++) {
      if ('"\'`'.includes(text[k])) {
        const q = text[k];
        for (k++; k < text.length && text[k] !== q; k++) if (text[k] === '\\') k++;
        continue;
      }
      if ('([{'.includes(text[k])) depth += 1;
      else if (')]}'.includes(text[k]) && --depth === 0) { end = k; break; }
      else if (text[k] === ',' && depth === 1) { end = k; break; }
    }
    const win = text.slice(open + 1, end);
    if (!RAW_OK.test(win)) offenders.push(`${f}:${i + 1}: ${ln.trim().slice(0, 90)}`);
  });
  return offenders;
}
test('1b: every raw write in run-graph.mjs and spawn-node.mjs outside evidence/ is a named machine-data target', () => {
  const offenders = [];
  for (const f of ['scripts/run-graph.mjs', 'scripts/spawn-node.mjs']) {
    offenders.push(...rawWriteOffenders(f, fs.readFileSync(path.join(REPO_ROOT, f), 'utf8').split(/\r?\n/)));
  }
  assert.deepEqual(offenders, [], `raw writes of model or vendor text into tracked files:\n${offenders.join('\n')}`);
  // G-16 of 20261027-071443-trt-delivery: the word "evidence" anywhere in a three-line window, a comment's included,
  // exempted a raw write. Only the write's own target, in code, may exempt it.
  assert.deepEqual(rawWriteOffenders('x.mjs', ['  fs.writeFileSync(trackedReport, text); // not evidence']).length, 1, 'a comment exempted it');
  assert.deepEqual(rawWriteOffenders('x.mjs', ['  writeJson(trackedPath, body);', '  const evDir = 1;']).length, 1, 'the next line exempted it');
  assert.deepEqual(rawWriteOffenders('x.mjs', ['  writeJson(path.join(evDir, "a.json"), body);']), [], 'an evidence target is exempt');
  assert.deepEqual(rawWriteOffenders('x.mjs', ['  writeJson(', '    path.join(evDir, "a.json"), body);']), [], 'a target on the next line is still the write\'s');
  // G-13 of 20261027-083759-trt-remediation-review: an allowed word in the payload, not the target, exempted a raw write.
  assert.deepEqual(rawWriteOffenders('x.mjs', ['  writeJson(trackedPath, { evidence: text });']).length, 1, 'a payload exempted it');
  assert.deepEqual(rawWriteOffenders('x.mjs', ['  fs.writeFileSync(trackedReport, JSON.stringify({ runJsonPath }), "utf8");']).length, 1, 'a payload exempted it');
  // G-7 of 20261027-094343-trt-remediation-2-review: a delimiter inside a string literal was counted, so the target's end
  // was missed and the payload's allowed word fell into the window.
  for (const q of ['"', "'", '`']) {
    assert.deepEqual(rawWriteOffenders('x.mjs', [`  writeJson(path.join(base, ${q}(${q}), { evidence: text });`]).length, 1, `a ${q}(${q} in the target exempted it`);
  }
  assert.deepEqual(rawWriteOffenders('x.mjs', ['  writeJson(path.join(evDir, "a)b.json"), body);']), [], 'a ) in an evidence target\'s string ended it early');
});

// ---------------------------------------------------------------------------------- 2a, the reader
function runFixture(t, { verdict = null, status = { state: 'OK', findings_count: 0 }, runJson = { run_id: '20260101-000000-x' } } = {}) {
  const d = tmp(t);
  const run = path.join(d, 'run');
  fs.mkdirSync(path.join(run, 'nodes'), { recursive: true });
  fs.mkdirSync(path.join(run, 'evidence', 'code-audit'), { recursive: true });
  if (runJson !== null) fs.writeFileSync(path.join(run, 'run.json'), JSON.stringify(runJson));
  if (status !== null) fs.writeFileSync(path.join(run, 'nodes', 'code-audit.status.json'), typeof status === 'string' ? status : JSON.stringify({ node_id: 'code-audit', ...status }));
  if (verdict !== null) fs.writeFileSync(path.join(run, 'evidence', 'code-audit', 'verdict.kept.json'), typeof verdict === 'string' ? verdict : JSON.stringify(verdict));
  return { d, run };
}

test('2a: the reader refuses each malformed kept verdict by name, and reports a missing one as missing', (t) => {
  const bad = ['null', '[]', '{"findings": "abc"}', '{"findings": [null]}', '{"findings": [[1]]}', '{ not json'];
  for (const v of bad) {
    const { run } = runFixture(t, { verdict: v });
    const r = readKeptVerdict(run, 'code-audit');
    assert.equal(r.ok, false, `accepted ${v}`);
    assert.match(r.why, /verdict\.kept\.json/);
  }
  const { run: none } = runFixture(t);
  assert.deepEqual({ ok: readKeptVerdict(none, 'code-audit').ok, missing: readKeptVerdict(none, 'code-audit').missing }, { ok: false, missing: true });
  const { run: good } = runFixture(t, { verdict: { findings: [{ file: 'a', line: 1 }] } });
  assert.equal(readKeptVerdict(good, 'code-audit').ok, true);
});

test('2a: the reader refuses a kept verdict whose real path leaves the run directory (r5 G-5)', (t) => {
  const { d, run } = runFixture(t);
  const outside = path.join(d, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'verdict.kept.json'), JSON.stringify({ findings: [] }));
  fs.rmSync(path.join(run, 'evidence', 'code-audit'), { recursive: true });
  fs.symlinkSync(outside, path.join(run, 'evidence', 'code-audit'), process.platform === 'win32' ? 'junction' : 'dir');
  const r = readKeptVerdict(run, 'code-audit');
  assert.equal(r.ok, false, 'a verdict outside the run directory was read as the run\'s');
  assert.match(r.why, /outside|real path/i);
});

test('2a: the reader refuses a status whose count is not a non-negative integer, and a missing run record', (t) => {
  for (const n of [-1, 1.5, '3']) {
    const { run } = runFixture(t, { status: { state: 'OK', findings_count: n } });
    assert.equal(readNodeStatus(run, 'code-audit').ok, false, `accepted findings_count ${JSON.stringify(n)}`);
  }
  const { run: garbled } = runFixture(t, { status: '{ nope' });
  assert.equal(readNodeStatus(garbled, 'code-audit').ok, false);
  const { run: norec } = runFixture(t, { runJson: null });
  const r = readRunRecord(norec);
  assert.equal(r.ok, false);
  assert.match(r.why, /run\.json/);
});

test('2a: the benchmarks\' collectRun reports a refused verdict instead of dropping the node silently', (t) => {
  const { run } = runFixture(t, { verdict: '{"findings": "abc"}' });
  const c = collectRun(run);
  assert.ok(c.refused && c.refused['code-audit'], 'a malformed verdict vanished from the benchmark\'s view');
});

test('2a: the fold and the barrier\'s two readers call the one reader', () => {
  const rg = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  const fl = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'findings-ledger.mjs'), 'utf8');
  const collect = rg.slice(rg.indexOf('function collectFindings'), rg.indexOf('function collectFindings') + 3000);
  assert.match(collect, /readKeptVerdict\(/, 'collectFindings reads verdict.kept.json itself');
  const obs = rg.slice(rg.indexOf('out_of_scope_observations', rg.indexOf('gate.md') - 2000));
  assert.match(rg, /readKeptVerdict\([^)]*\)[\s\S]{0,400}out_of_scope_observations|out_of_scope_observations[\s\S]{0,400}readKeptVerdict\(/, 'the gate\'s observations read verdict.kept.json themselves');
  assert.ok(obs.length > 0);
  // Since ledger-identity stage 5 the fold reads the barrier's decisions, not the kept verdicts — through the one reader
  // of those, readReconcileArtifacts, extracted from collectRun so both see the same refusals.
  for (const fn of ['readReconcileArtifacts(', 'readNodeStatus(', 'readRunRecord(']) assert.ok(fl.includes(fn), `findings-ledger.mjs does not call ${fn}`);
  assert.ok(!/JSON\.parse\(fs\.readFileSync\(kept/.test(fl), 'the fold still parses verdict.kept.json itself');
  assert.ok(!/finding-groups\.json'\)?,\s*'utf8'\)/.test(fl), 'the fold parses finding-groups.json itself');
});

// ---------------------------------------------------------------------------------- 1b, the push scan
const SHIPPED = path.join(REPO_ROOT, '.claude', 'hooks', 'gitleaks.toml');

test('1b: the framework ships a gitleaks config that extends the defaults with a key-value rule', () => {
  assert.ok(fs.existsSync(SHIPPED), 'no gitleaks config ships with the framework');
  const toml = fs.readFileSync(SHIPPED, 'utf8');
  assert.match(toml, /\[extend\][\s\S]*useDefault\s*=\s*true/);
  assert.match(toml, /id\s*=\s*"quorate-key-value"/);
});

test('1b: the scan passes the shipped config — unless the consumer has its own, which governs', () => {
  assert.deepEqual(secretScanArgv('/r', null, { config: '/fw/cfg.toml' }).slice(-2), ['--config', '/fw/cfg.toml']);
  assert.ok(!secretScanArgv('/r', null).includes('--config'));
  const has = new Set(['/consumer/.gitleaks.toml']);
  const exists = (p) => has.has(p.replace(/\\/g, '/'));
  assert.equal(secretScanConfig({ repoRoot: '/plain', frameworkRoot: '/fw', exists }).replace(/\\/g, '/'), '/fw/.claude/hooks/gitleaks.toml');
  assert.equal(secretScanConfig({ repoRoot: '/consumer', frameworkRoot: '/fw', exists }), null);
  for (const f of ['.claude/hooks/checks.mjs', 'scripts/check-secrets.mjs']) {
    assert.match(fs.readFileSync(path.join(REPO_ROOT, f), 'utf8'), /secretScanConfig\(/, `${f} scans without the shipped rule`);
  }
});

test('1b: check-install says when a consumer\'s own gitleaks config keeps quorate\'s rule out of force', (t) => {
  const d = tmp(t);
  spawnSync('git', ['init', '-q'], { cwd: d });
  fs.copyFileSync(path.join(REPO_ROOT, 'CLAUDE.template.md'), path.join(d, 'CLAUDE.md'));
  fs.writeFileSync(path.join(d, '.gitleaks.toml'), '[extend]\nuseDefault = true\n');
  const r = runScript('check-install.mjs', ['--repo-root', d]);
  assert.match(`${r.stdout}\n${r.stderr}`, /gitleaks[\s\S]{0,200}(not in force|own)/i, r.stdout);
});

const gitleaks = spawnSync('gitleaks', ['version'], { encoding: 'utf8' });
test('1b: with the shipped config, gitleaks finds the JSON and spaced key-value shapes', { skip: gitleaks.status !== 0 && 'gitleaks is not installed; CI installs it' }, (t) => {
  const d = tmp(t);
  fs.writeFileSync(path.join(d, 'a.json'), `{"${PW}": "${JSON_PW}"}\n`);
  fs.writeFileSync(path.join(d, 'b.yml'), `db_${PW}: "s3cr3t-value with spaces here"\n`);
  const r = spawnSync('gitleaks', ['dir', d, '--no-banner', '--redact', '--report-format', 'json', '--report-path', path.join(d, 'r.json'), '--config', SHIPPED], { encoding: 'utf8' });
  assert.ok(fs.existsSync(path.join(d, 'r.json')), r.stderr);
  const found = JSON.parse(fs.readFileSync(path.join(d, 'r.json'), 'utf8')).map((x) => path.basename(x.File)).sort();
  assert.deepEqual(found, ['a.json', 'b.yml']);
});
