// Remediation of review 20260929-145942-ssr-review-r2 (operator, 2026-09-29: "1 fix, 2 A, 3 as suggested, 4 as
// suggested, 5 yes"). Fixed: G-11a (refusal reasons carrying absolute paths), G-7 (one bad seed aborting the
// second-opinion benchmark), G-1 (A-10 not naming bench/results), G-15 (the quote_by doc), and G-12 pulled forward
// (a nodes/ or evidence/ that is a file throwing instead of refusing).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectRun } from '../scripts/io/run-artifacts.mjs';
import { collectRun as pureCollectRun } from '../scripts/lib/run-artifacts.mjs';
import { hostPlatform } from '../scripts/platform/index.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const quiet = { warn: () => {} };

function run(t) {
  const r = path.join(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-ssr2-'))), 'run');
  t.after(() => fs.rmSync(path.dirname(r), { recursive: true, force: true }));
  fs.mkdirSync(path.join(r, 'nodes'), { recursive: true });
  fs.writeFileSync(path.join(r, 'run.json'), JSON.stringify({ run_id: '20260101-000000-x' }));
  return r;
}

// G-11a: an error's message is not a safe reason. A filesystem error names the absolute path it failed on, and a JSON
// parse error quotes the text it failed on — and run.json holds absolute paths (repo_root, cwd).
test('G-11a: no refusal reason carries an absolute path, from a filesystem error or from the text a parse error quotes', (t) => {
  const r = run(t);
  // A filesystem error, as EACCES and an ENOENT race report it: the message names the absolute path. Injected, since
  // which errors carry a path differs by platform (EISDIR on Windows does not).
  fs.writeFileSync(path.join(r, 'nodes', 'code-audit.status.json'), JSON.stringify({ node_id: 'code-audit', state: 'OK', findings_count: 0 }));
  const h = hostPlatform();
  const denied = { ...h, fs: { ...h.fs, readFileSync: (p, ...rest) => {
    if (String(p).endsWith('code-audit.status.json')) throw Object.assign(new Error(`EACCES: permission denied, open '${p}'`), { code: 'EACCES' });
    return h.fs.readFileSync(p, ...rest);
  } } };
  // A parse error quotes the text it failed on: here a marker standing for a path in run.json-like content.
  fs.writeFileSync(path.join(r, 'nodes', 'security-audit.status.json'), 'QUOTEDTEXT is not json');
  const c = pureCollectRun(r, { io: denied });
  const reasons = Object.values(c.refused);
  assert.equal(reasons.length, 2, `expected both refusals: ${JSON.stringify(c.refused)}`);
  for (const why of reasons) {
    assert.ok(!why.includes(r) && !why.includes(os.tmpdir()), `an absolute path in a refusal: ${why}`);
    assert.ok(!why.includes('QUOTEDTEXT'), `a parse error's quote of the file's text in a refusal: ${why}`);
  }
});

// G-12: a nodes/ or evidence/ that exists but is not a directory is a refusal, not an exception out of collectRun.
test('G-12: a nodes/ or evidence/ that is a file is refused, and the rest of the run still reads', (t) => {
  for (const which of ['nodes', 'evidence']) {
    const r = run(t);
    fs.rmSync(path.join(r, which), { recursive: true, force: true });
    fs.writeFileSync(path.join(r, which), 'not a directory');
    let c;
    assert.doesNotThrow(() => { c = collectRun(r, quiet); }, `${which} as a file threw out of collectRun`);
    assert.ok(Object.keys(c.refused).includes(which), `${which} as a file was not refused: ${JSON.stringify(c.refused)}`);
  }
});

// G-7: nothing in a seed's setup may throw out of runSeed. Every precondition read happens before the seed's try, so
// each must be a guarded read that records NOT RUN — the benchmark runs seeds in sequence and one throw ends it.
test('G-7: bench-second-opinion parses nothing unguarded before a seed\'s try, and reads run.json through the shared reader', () => {
  const src = fs.readFileSync(path.join(REPO, 'scripts', 'bench-second-opinion.mjs'), 'utf8');
  const start = src.indexOf('async function runSeed(');
  const setup = src.slice(start, src.indexOf('\n  try {\n', start));   // the seed's own try, alone on its line
  assert.ok(start > 0 && setup.length > 0, 'runSeed not found');
  const unguarded = setup.split('\n').filter((l) => /JSON\.parse\(fs\.readFileSync/.test(l) && !/\btry \{/.test(l));
  assert.deepEqual(unguarded, [], 'a raw parse before the seed\'s try aborts the whole benchmark');
  assert.match(setup, /readRunRecord\(/, 'the seed\'s run.json is not read through the shared strict reader');
});

// G-1: A-10 names every tracked carrier of model prose.
test('G-1: ARCHITECTURE A-10 names bench/results among the tracked carriers of model prose', () => {
  const a = fs.readFileSync(path.join(REPO, 'ARCHITECTURE.md'), 'utf8');
  const a10 = a.slice(a.indexOf('### A-10'), a.indexOf('### A-11'));
  assert.match(a10, /bench\/results/, 'A-10 does not name bench/results');
  assert.doesNotMatch(a10, /\bTwo things do carry\b/, 'A-10 still counts two carriers');
});

// G-15 (and G-19 of 20260929-124952-ssr-review): the engine never writes or reads quote_by, and the shipped doc says
// so rather than describing it as a field of the ledger format.
test('G-15: the ledger doc says the engine never writes or reads quote_by', () => {
  const doc = fs.readFileSync(path.join(REPO, 'shared', 'ledger-transitions.md'), 'utf8');
  const i = doc.indexOf('`quote_by`');
  assert.ok(i > 0, 'quote_by is no longer mentioned at all');
  assert.match(doc.slice(i, i + 500), /never writes or reads it/, 'the doc still reads as if the engine writes quote_by');
});
