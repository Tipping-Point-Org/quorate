// ONE OWNER FOR external-review.mjs --out (external-review-out.plan.md; design decided, operator 2026-10-09: D1
// "Contract owns, ids (Recommended)", D2 "Refuse <sink>/evidence/ (Recommended)"). Three candidate-pool reviews running
// each found a document behind --out's code — the round cap.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runScript, withTempDir, seedReviewerProbe } from './helpers.mjs';
import { proposeSchema } from '../scripts/lib/reviewer-schemas.mjs';

// The offline reviewer: a PATH shim running the real adapter end to end, as tests/regression-panel-runtime.test.mjs's.
function fakeCodex(dir, body) {
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, 'fake-codex.mjs'), [
    "import fsx from 'node:fs';",
    'const a = process.argv;',
    "const i = a.indexOf('--output-last-message');",
    `const body = ${JSON.stringify(body)};`,
    'if (i !== -1 && a[i + 1]) fsx.writeFileSync(a[i + 1], body);',
    'process.stdout.write(body);',
    '',
  ].join('\n'));
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(binDir, 'codex.cmd'), `@"${process.execPath}" "%~dp0fake-codex.mjs" %*\r\n`);
  } else {
    const shim = path.join(binDir, 'codex');
    fs.writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/fake-codex.mjs" "$@"\n`);
    fs.chmodSync(shim, 0o755);
  }
  return binDir;
}

// A sink under a temp engine home (valid without touching the repository), the reviewer, and a launcher.
function setup(dir) {
  const binDir = fakeCodex(dir, JSON.stringify({ status: 'ok', candidates: [{ name: 'a' }] }));
  const home = path.join(dir, 'home');
  const sink = path.join(home, 'ev');
  fs.mkdirSync(sink, { recursive: true });
  const prompt = path.join(dir, 'prompt.md');
  fs.writeFileSync(prompt, 'Propose options for the declared goal.');
  const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
  const pathValue = `${binDir}${path.delimiter}${process.env[pathKey] ?? ''}`;
  // THESE TESTS ARE ABOUT --out, not the preflight: the fake is recorded as a proposer that passed its probe, which its
  // own answer (a candidate named 'a', not the one named 'probe' the probe asks for) would not (G-9 of r7).
  const probes = path.join(dir, 'probes');
  seedReviewerProbe(probes, { mode: 'propose', route: 'prompt-and-scan', pathValue });
  const launch = (out, extra = []) => runScript('external-review.mjs', [
    '--reviewer', 'codex', '--mode', 'propose', '--prompt-file', prompt, '--schema', '{"candidates":"array"}',
    '--evidence-dir', sink, '--out', out, ...extra,
  ], { env: { [pathKey]: pathValue, QUORATE_HOME: home, QUORATE_REVIEWER_PROBES: probes } });
  return { sink, launch };
}

const refusedWithOut8 = (r, out) => {
  assert.equal(r.status, 2, r.output);
  assert.match(r.output, /OUT-8/);
  assert.equal(fs.existsSync(out), false, 'nothing created');
};

// ------------------------------------------------------------------ stage 1 (D2): --out off the adapter's tree (OUT-8)
// Ledger scripts/external-review.mjs:850: the adapter writes its own schema at <sink>/evidence/<node-id>/<node-id>.schema.json with a
// truncating write, and an --out naming that path was accepted. With a schema built (--candidate-fields), the file
// reserved for the response is refilled with the schema and the response written over its head, so the schema's tail
// survives — when the response is shorter than the schema, which this test asserts first.
test('stage 1: an --out on the adapter\'s own schema file is refused (OUT-8), not corrupted', () => {
  withTempDir((dir) => {
    const { sink, launch } = setup(dir);
    fs.mkdirSync(path.join(sink, 'evidence', 'panel-codex'), { recursive: true });
    const out = path.join(sink, 'evidence', 'panel-codex', 'panel-codex.schema.json');
    const schemaBytes = Buffer.byteLength(JSON.stringify(proposeSchema('name'), null, 2) + '\n');
    const r = launch(out, ['--candidate-fields', 'name']);
    if (r.status === 0) {
      assert.ok(Buffer.byteLength(r.stdout) < schemaBytes, `precondition: the response (${Buffer.byteLength(r.stdout)} B) is shorter than the schema (${schemaBytes} B)`);
      assert.equal(fs.readFileSync(out, 'utf8'), r.stdout, 'accepted, and the schema write corrupted the response');
    }
    refusedWithOut8(r, out);
  });
});

// A junction is refused with OUT-4 before anything below the sink is resolved (G-6 of
// 20261029-212858-rdr-remediation-2-review): it was followed to name it OUT-8, outside the sink's owner.
test('stage 1: an --out reaching the adapter\'s tree through a junction is refused as a link (OUT-4), not followed', () => {
  withTempDir((dir) => {
    const { sink, launch } = setup(dir);
    const target = path.join(sink, 'evidence', 'panel-codex');
    fs.mkdirSync(target, { recursive: true });
    fs.symlinkSync(target, path.join(sink, 'lnk'), 'junction');
    const r = launch(path.join(sink, 'lnk', 'x.json'));
    assert.equal(r.status, 2, r.output);
    assert.match(r.output, /OUT-4/);
    assert.doesNotMatch(r.output, /OUT-8/, 'the link is not followed to choose the diagnostic');
    assert.equal(fs.existsSync(path.join(target, 'x.json')), false, 'nothing created');
  });
});

test('stage 1: a case variant of the adapter\'s tree is refused on every filesystem (OUT-8)', () => {
  withTempDir((dir) => {
    const { sink, launch } = setup(dir);
    fs.mkdirSync(path.join(sink, 'EVIDENCE', 'panel-codex'), { recursive: true });
    const out = path.join(sink, 'EVIDENCE', 'panel-codex', 'x.json');
    refusedWithOut8(launch(out), out);
  });
});

test('stage 1: --out naming <sink>/evidence itself is refused (OUT-8)', () => {
  withTempDir((dir) => {
    const { sink, launch } = setup(dir);
    const out = path.join(sink, 'evidence');
    assert.equal(fs.existsSync(out), false, 'precondition: <sink>/evidence does not exist (else OUT-6 refuses it)');
    refusedWithOut8(launch(out), out);
  });
});

// A guard, green at HEAD: candidate-pool's documented usage, with no <sink>/evidence yet.
test('stage 1 (guard): candidate-pool\'s documented --out <dir>/<proposer>.json is accepted', () => {
  withTempDir((dir) => {
    const { sink, launch } = setup(dir);
    const out = path.join(sink, 'codex.json');
    const r = launch(out);
    assert.equal(r.status, 0, r.output);
    assert.equal(fs.readFileSync(out, 'utf8'), r.stdout);
  });
});

// G-8 of 20261016-214749-sp-bugs-remediation-2-review: on Windows the reviewer is the bare name `codex` under shell:true
// with cwd the reviewed snapshot, and cmd.exe looks in the current directory before PATH — so a codex.cmd the reviewed
// tree carries ran in place of the reviewer, with the forwarded credentials.
test('G-8: a codex.cmd in the directory the reviewer reads is not run in place of the reviewer', { skip: process.platform !== 'win32' && 'cmd.exe lookup' }, () => {
  withTempDir((dir) => {
    const { sink, launch } = setup(dir);
    const surface = path.join(dir, 'surface');
    fs.mkdirSync(surface);
    const marker = path.join(surface, 'planted-ran.txt');
    fs.writeFileSync(path.join(surface, 'codex.cmd'), '@echo planted> "%~dp0planted-ran.txt"\r\n@exit /b 1\r\n');
    const r = launch(path.join(sink, 'codex.json'), ['--surface', surface]);
    assert.equal(fs.existsSync(marker), false, `the reviewed tree's codex.cmd ran: ${r.output}`);
    assert.equal(r.status, 0, `the reviewer on PATH answered: ${r.output}`);
  });
});

// G-8, the same lookup in the probe's version command: cliVersion launches the vendor the way external-review does, a
// shell where the adapter needs one, from whatever directory the caller stands in.
test('G-8: the version command launched through a shell does not look in the current directory', async () => {
  const { cliVersion } = await import('../scripts/io/reviewer-probe.mjs');
  const seen = [];
  const spawn = (cmd, argv, opts) => { seen.push(opts); return { status: 0, stdout: 'codex 1.0\n', stderr: '' }; };
  const adapter = { cmd: 'codex', version_argv: ['--version'], needs_shell_on_windows: true };
  cliVersion(adapter, { versionMs: 1000 }, { spawn, platform: { needsShellForShims: true }, env: { PATH: 'x' } });
  assert.equal(seen[0]?.shell, true, 'precondition: launched through a shell');
  assert.equal(seen[0]?.env?.NoDefaultCurrentDirectoryInExePath, '1', JSON.stringify(seen[0]?.env));
});

// ------------------------------------------------------------------ stage 2 (D1): the contract owns the rules, with ids
// Three reviews running found a document behind --out's code (20261008-175234-cpool-and-design-step, -r2, -r3). The
// contract row states each rule once as OUT-n; every refusal carries its id; the other documents point at the row.
import { REPO_ROOT } from './helpers.mjs';
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const ADAPTER = 'scripts/external-review.mjs';
const contractRow = () => read('shared/claude-md-contract.md').split('\n').find((l) => l.startsWith('| `scripts/external-review.mjs`'));

// Each whole die(...) call, by bracket matching — several span lines.
function dieCalls(src) {
  const calls = [];
  for (const m of src.matchAll(/\bdie\(/g)) {
    let depth = 0, quote = null;
    for (let i = m.index + 3; i < src.length; i++) {
      const ch = src[i];
      if (quote) { if (ch === '\\') { i++; continue; } if (ch === quote) quote = null; continue; }
      if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
      if (ch === '(') depth++;
      else if (ch === ')' && --depth === 0) { calls.push({ text: src.slice(m.index, i + 1), line: src.slice(0, m.index).split('\n').length }); break; }
    }
  }
  return calls;
}
const OUT_FLAG = /--out(?![\w-])/;

// The phrases that state each rule (plan, "Detecting a restatement"); a pointing paragraph matching one restates it.
const PHRASES = {
  'OUT-2': [/inside the evidence/i],
  'OUT-3': [/does not exist/i, /folder[^.]*exist/i],
  'OUT-4': [/through a link/i],
  'OUT-5': [/git-ignored/i, /tracked surface/i],
  // "refused at once" (G-13 of 20261009-055155-ero-review): the skill restated OUT-6's behaviour in other words.
  'OUT-6': [/exclusively/i, /already exists/i, /refused if it exists/i, /refused at once/i],
  'OUT-8': [/evidence\//i],
};
// The scoped text: each blank-line paragraph containing the whole --out flag (for the header, its --out line).
const scoped = (text) => text.split(/\n\s*\n/).filter((p) => OUT_FLAG.test(p));
const restatements = (paras) => paras.flatMap((p) => Object.entries(PHRASES)
  .filter(([, res]) => res.some((re) => re.test(p))).map(([id]) => id));

test('stage 2 (a): every refusal of --out carries its OUT-n id', () => {
  const missing = dieCalls(read(ADAPTER)).filter((c) => OUT_FLAG.test(c.text) && !/OUT-\d/.test(c.text)).map((c) => `${c.line}: ${c.text.slice(0, 70)}`);
  assert.deepEqual(missing, []);
});

test('stage 2 (b, c): the ids in the code are the contract row\'s, and the row states each once', () => {
  const inCode = new Set(dieCalls(read(ADAPTER)).filter((c) => OUT_FLAG.test(c.text)).flatMap((c) => c.text.match(/OUT-\d+/g) ?? []));
  const row = contractRow();
  const inRow = row.match(/OUT-\d+/g) ?? [];
  for (const id of inCode) assert.ok(inRow.includes(id), `${id} is in the code and not the contract row`);
  for (const id of new Set(inRow)) assert.ok(inCode.has(id) || id === 'OUT-7', `${id} is in the row and refused nowhere (only OUT-7 is not a refusal)`);
  for (const id of new Set(inRow)) assert.equal(inRow.filter((x) => x === id).length, 1, `${id} is stated more than once`);
  assert.deepEqual([...new Set(inRow)].sort(), ['OUT-1', 'OUT-2', 'OUT-3', 'OUT-4', 'OUT-5', 'OUT-6', 'OUT-7', 'OUT-8']);
});

test('stage 2 (d): the header, external-reviewers.md and the candidate-pool skill point at the row, restating no rule', () => {
  const header = read(ADAPTER).split('\n').slice(0, 40).filter((l) => /^\/\//.test(l) && OUT_FLAG.test(l));
  assert.deepEqual(restatements(header), [], `header: ${header.join(' | ')}`);
  for (const doc of ['shared/external-reviewers.md', 'skills/candidate-pool/SKILL.md']) {
    const paras = scoped(read(doc));
    assert.ok(paras.length, `${doc} still names --out`);
    assert.deepEqual(restatements(paras), [], doc);
    assert.ok(paras.some((p) => /claude-md-contract\.md/.test(p) && /OUT-/.test(p)), `${doc} points at the row's OUT-* rules`);
  }
});

// OUT-7, a guard (green at HEAD: the exit handler exists): a die after the reservation leaves no --out file behind.
test('stage 2 (guard): a refusal after the reservation leaves no --out file (OUT-7)', () => {
  withTempDir((dir) => {
    const { sink, launch } = setup(dir);
    const out = path.join(sink, 'codex.json');
    const r = launch(out, ['--surface', path.join(dir, 'not-a-dir.txt')]);
    assert.notEqual(r.status, 0, r.output);
    assert.match(r.output, /is not a directory/);
    assert.equal(fs.existsSync(out), false, 'the unused reservation is removed');
  });
});

// run-dir-descendants.plan.md stage 2 (G-10, G-11 of 20261024-122231-rdt-remediation-3-review): every evidence write
// made evidence/<node> recursively under the checked root, so a link planted below it, even one resolving inside the
// sink, carried the raw vendor response wherever it led. The one owner walks each level and refuses a link at any.
test('run-dir-descendants stage 2: a link at evidence/ below the sink is refused, and nothing is written through it', () => {
  withTempDir((dir) => {
    const { sink, launch } = setup(dir);
    const real = path.join(sink, 'real');
    fs.mkdirSync(real);
    fs.symlinkSync(real, path.join(sink, 'evidence'), 'junction');
    fs.mkdirSync(path.join(sink, 'outs'));
    const r = launch(path.join(sink, 'outs', 'answer.json'));
    assert.notEqual(r.status, 0, `the evidence was written through the link: ${r.output.slice(-400)}`);
    assert.match(r.output, /link or junction/);
    assert.deepEqual(fs.readdirSync(real), [], 'nothing was created through the link');
  });
});

// G-8 of 20261029-212858-rdr-remediation-2-review: why the answer file gave nothing was asked of a raw existsSync below
// the evidence sink, so a link standing at <node>.response.json was followed and the failure said the response "did not
// parse". The sink's owner is asked, and the link is named as refused.
test('G-8: a link at the answer file below the sink is named as refused, not followed', () => {
  withTempDir((dir) => {
    const binDir = fakeCodex(dir, 'not json');
    // This reviewer answers on stdout only and writes no answer file, as one that failed to would.
    fs.writeFileSync(path.join(binDir, 'fake-codex.mjs'), "process.stdout.write('not json');\n");
    const home = path.join(dir, 'home');
    const sink = path.join(home, 'ev');
    const nodeDir = path.join(sink, 'evidence', 'panel-codex');
    fs.mkdirSync(nodeDir, { recursive: true });
    const elsewhere = path.join(dir, 'elsewhere');
    fs.mkdirSync(elsewhere);
    fs.symlinkSync(elsewhere, path.join(nodeDir, 'panel-codex.response.json'), 'junction');
    const prompt = path.join(dir, 'prompt.md');
    fs.writeFileSync(prompt, 'Propose options for the declared goal.');
    const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
    const pathValue = `${binDir}${path.delimiter}${process.env[pathKey] ?? ''}`;
    const probes = path.join(dir, 'probes');
    seedReviewerProbe(probes, { mode: 'propose', route: 'native', pathValue });
    const r = runScript('external-review.mjs', [
      '--reviewer', 'codex', '--mode', 'propose', '--prompt-file', prompt, '--schema', '{"candidates":"array"}',
      '--candidate-fields', 'name', '--evidence-dir', sink,
    ], { env: { [pathKey]: pathValue, QUORATE_HOME: home, QUORATE_REVIEWER_PROBES: probes } });
    assert.match(r.output, /the response file was refused/, r.output);
    assert.doesNotMatch(r.output, /the response did not parse/, 'the link was followed to word the failure');
  });
});

// G-7 of 20261029-212858-rdr-remediation-2-review: emit() wrote stdout, then swallowed a failed mirror of the envelope
// into evidence/, so nothing said the durable copy was missing. Here the reviewer replaces its evidence folder with a
// junction while it runs, so every write there is refused, and the response must name the lost envelope copy.
test('G-7: an envelope that could not be mirrored into evidence/ is named in not_checked and on stderr', () => {
  withTempDir((dir) => {
    const binDir = fakeCodex(dir, '');
    const home = path.join(dir, 'home');
    const sink = path.join(home, 'ev');
    fs.mkdirSync(sink, { recursive: true });
    const nodeDir = path.join(sink, 'evidence', 'panel-codex');
    fs.writeFileSync(path.join(binDir, 'fake-codex.mjs'), [
      "import fsx from 'node:fs';",
      `const d = ${JSON.stringify(nodeDir)};`,
      "if (!process.argv.includes('--version')) { fsx.renameSync(d, d + '-moved'); fsx.symlinkSync(d + '-moved', d, 'junction'); }",
      `process.stdout.write(${JSON.stringify(JSON.stringify({ status: 'ok', candidates: [{ name: 'a' }] }))});`,
      '',
    ].join('\n'));
    const prompt = path.join(dir, 'prompt.md');
    fs.writeFileSync(prompt, 'Propose options for the declared goal.');
    const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
    const pathValue = `${binDir}${path.delimiter}${process.env[pathKey] ?? ''}`;
    const probes = path.join(dir, 'probes');
    // Review mode: the one whose envelope emit() mirrors.
    seedReviewerProbe(probes, { mode: 'review', route: 'native', pathValue });
    const r = runScript('external-review.mjs', [
      '--reviewer', 'codex', '--prompt-file', prompt, '--evidence-dir', sink,
    ], { env: { [pathKey]: pathValue, QUORATE_HOME: home, QUORATE_REVIEWER_PROBES: probes } });
    assert.ok(fs.lstatSync(nodeDir).isSymbolicLink(), `precondition: the reviewer replaced its evidence folder\n${r.output}`);
    const env = JSON.parse(r.stdout);
    assert.ok(env.not_checked.some((n) => n.item === 'envelope evidence copy'), `the lost envelope copy is not named\n${r.stdout}`);
    assert.match(r.stderr, /the envelope could not be mirrored/);
  });
});

// G-20 of 20261029-190658-rdr-delivery (panel-codex-docs): the link's refusal waited for OUT-8, whose real-path read of
// the --out folder threw on a DANGLING link, so the refusal OUT-4 promises never came; a raw ENOENT crash came instead.
test('G-20: an --out below a dangling link is refused with OUT-4, not a crash', () => {
  withTempDir((dir) => {
    const { sink, launch } = setup(dir);
    const gone = path.join(sink, 'gone');
    fs.mkdirSync(gone);
    fs.symlinkSync(gone, path.join(sink, 'lnk'), 'junction');
    fs.rmdirSync(gone);
    const r = launch(path.join(sink, 'lnk', 'x.json'));
    assert.equal(r.status, 2, r.output);
    assert.match(r.output, /OUT-4/);
  });
});

// G-5 of 20261029-190658-rdr-delivery (doc-consistency-review): OUT-4 refuses any link below the sink whatever it leads
// to, and its message still said the --out path "leaves" the sink, the old rule's wording, for a link that stays inside.
test('G-5: a link below the sink that stays inside it is refused with OUT-4, and not said to leave it', () => {
  withTempDir((dir) => {
    const { sink, launch } = setup(dir);
    const real = path.join(sink, 'real');
    fs.mkdirSync(real);
    fs.symlinkSync(real, path.join(sink, 'lnk'), 'junction');
    const r = launch(path.join(sink, 'lnk', 'x.json'));
    assert.equal(r.status, 2, r.output);
    assert.match(r.output, /OUT-4/);
    assert.doesNotMatch(r.output, /leaves/, 'a link inside the sink is not an escape');
  });
});

// G-5 of 20261103-022403-rbr-remediation-8-review: the walk that refuses a link at the sink's own path (G-8 of r7) ran
// only when --out had a folder below the sink, so an --out directly under a sink that is itself a junction skipped
// `confined` and was written through the link.
test('G-5: an --out directly under a sink that is a junction is refused with OUT-4, not written through it', () => {
  withTempDir((dir) => {
    const { sink, launch } = setup(dir);
    const real = path.join(path.dirname(sink), 'real-ev');
    fs.mkdirSync(real);
    fs.rmdirSync(sink);
    fs.symlinkSync(real, sink, 'junction');
    const r = launch(path.join(sink, 'codex.json'));
    assert.equal(r.status, 2, r.output);
    assert.match(r.output, /OUT-4/);
    assert.equal(fs.existsSync(path.join(real, 'codex.json')), false, 'nothing written through the link');
  });
});
