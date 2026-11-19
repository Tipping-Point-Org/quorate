// THE REFERENCE JAVASCRIPT EXTRACTOR EMITS THE GOLDEN FACTS, AT THE HTML FILE'S LINES (code-index.plan.md stage 5).
//
// The extractor loads acorn from the request's root, never from quorate, so quorate keeps no package.json and no
// node_modules. The test copies the fixtures and an acorn install into one temporary root, outside the checkout, and
// runs the extractor there. Where acorn comes from: QUORATE_ACORN_DIR names a directory whose node_modules holds it.
// CI installs a pinned acorn there.
//
// Without that, the conformance test is skipped and the skip says why. QUORATE_REQUIRE_ACORN=1 (CI, and the
// before-delivery run the plan records) turns the skip into a failure, so CI proves the test ran.
//
// What runs everywhere, acorn or not: with no acorn at the root, every file answers not_configured, with the reason.
// That is the state a consumer with no Node packages is in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from './helpers.mjs';
import { responseErrors } from '../scripts/lib/code-index-schema.mjs';

const EXTRACTOR = path.join(REPO_ROOT, 'extractors', 'javascript', 'extract.mjs');
const FIX = path.join(REPO_ROOT, 'tests', 'fixtures', 'code-index');
const golden = JSON.parse(fs.readFileSync(path.join(FIX, 'golden.json'), 'utf8'));
const TABLE_OF = { symbol: 'definitions', calls: 'calls', constructions: 'constructions', literals: 'literals',
  comparisons: 'comparisons', callees: 'calls', handlers: 'handlers' };

const acornHome = process.env.QUORATE_ACORN_DIR;
const acornAt = acornHome && fs.existsSync(path.join(acornHome, 'node_modules', 'acorn', 'package.json'))
  ? path.join(acornHome, 'node_modules', 'acorn') : null;
const skip = acornAt ? false : 'no acorn: set QUORATE_ACORN_DIR to a directory whose node_modules holds acorn (QUORATE_REQUIRE_ACORN=1 makes this a failure)';

test('a missing acorn is a failure where the conformance run is required', { skip: process.env.QUORATE_REQUIRE_ACORN !== '1' }, () => {
  assert.ok(acornAt, 'QUORATE_REQUIRE_ACORN=1 and no acorn under QUORATE_ACORN_DIR: the JS conformance test cannot run');
});

function root({ withAcorn }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-code-index-js-'));
  fs.cpSync(path.join(FIX, 'javascript'), dir, { recursive: true });
  if (withAcorn) fs.cpSync(acornAt, path.join(dir, 'node_modules', 'acorn'), { recursive: true });
  return dir;
}

function extract(dir) {
  const request = { code_index_request: 1, language: 'javascript', root: dir, files: ['index.html'], options: {} };
  const file = path.join(dir, 'request.json');
  fs.writeFileSync(file, JSON.stringify(request));
  const r = spawnSync(process.execPath, [EXTRACTOR, '--language', 'javascript', '--request', file], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  assert.equal(r.status, 0, r.stderr);
  return { request, response: JSON.parse(r.stdout) };
}

const covers = (fact, expected) => Object.entries(expected).every(([k, v]) => {
  if (k === 'line') return fact.span?.start?.line === v;
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) return fact[k] && covers(fact[k], v);
  return JSON.stringify(fact[k] ?? null) === JSON.stringify(v);
});

test('with acorn, the extractor emits every golden fact, spans mapped to the HTML file\'s lines', { skip }, () => {
  const dir = root({ withAcorn: true });
  try {
    const { request, response } = extract(dir);
    assert.deepEqual(responseErrors(response, request), []);
    for (const s of golden.sweeps.filter((x) => x.language === 'javascript')) {
      const facts = response.facts[TABLE_OF[s.shape]];
      for (const row of s.expected) {
        assert.ok(facts.some((f) => f.path === row.path && covers(f, row)), `${s.name}: no ${TABLE_OF[s.shape]} fact matches ${JSON.stringify(row)}`);
      }
    }
    const id = JSON.parse(spawnSync(process.execPath, [EXTRACTOR, '--identity', '--root', dir], { encoding: 'utf8' }).stdout);
    assert.match(id.parser, /^acorn \d+\.\d+\.\d+$/, 'identity does not name the acorn it resolves from the root');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('without acorn at the root, every file answers not_configured with the reason, and identity names no parser', () => {
  const dir = root({ withAcorn: false });
  try {
    const { request, response } = extract(dir);
    assert.deepEqual(responseErrors(response, request), []);
    assert.deepEqual(response.files.map((f) => [f.status, f.outcome]), [['not_processed', 'not_configured']]);
    assert.match(response.files[0].reason, /acorn not found/);
    const id = JSON.parse(spawnSync(process.execPath, [EXTRACTOR, '--identity', '--root', dir], { encoding: 'utf8' }).stdout);
    assert.equal(id.parser, null);
    assert.match(id.modules['extract.mjs'], /^[0-9a-f]{64}$/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// extractors/javascript/extract.mjs:110 on the ledger (G-1 of 20261022-230755-ciss-d1-4-remediation-review): scriptBlocks
// sliced and split the whole HTML prefix for every block to find its line, O(H×S) for H bytes and S blocks. The bound is
// stated as a ratio, so it holds on a slow or loaded machine: quadrupling the blocks (and with them the bytes) must cost
// well under the sixteenfold a quadratic count gives. Each size is timed twice and the faster kept, against a stall.
test('scriptBlocks finds block lines in time linear in the page, not per block over the whole prefix', { skip }, () => {
  const dir = root({ withAcorn: true });
  try {
    const timed = (blocks) => {
      fs.writeFileSync(path.join(dir, 'index.html'),
        `<html><body>\n${Array.from({ length: blocks }, (_, i) => `<script>function f${i}() { return ${i}; }</script>`).join('\n')}\n</body></html>\n`);
      let best = Infinity;
      for (let n = 0; n < 2; n += 1) {
        const t0 = process.hrtime.bigint();
        const { response } = extract(dir);
        best = Math.min(best, Number(process.hrtime.bigint() - t0) / 1e6);
        assert.equal(response.files[0].status, 'processed');
      }
      return best;
    };
    const small = timed(4000);
    const large = timed(16000);
    assert.ok(large / small < 6, `16000 blocks took ${large.toFixed(0)} ms against ${small.toFixed(0)} ms for 4000: ${(large / small).toFixed(1)}x, a quadratic count`);
    // The last block's line is still right: the page's line 1 is <html><body>, block i sits on line i + 2.
    const { response } = extract(dir);
    const last = response.facts.definitions.find((d) => d.name === 'f15999');
    assert.equal(last?.span?.start?.line, 16001);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// The JS extractor's dependency is the consumer's, never quorate's: no manifest and no installed packages at the root.
test('quorate itself has no package.json and no node_modules', () => {
  assert.equal(fs.existsSync(path.join(REPO_ROOT, 'package.json')), false);
  assert.equal(fs.existsSync(path.join(REPO_ROOT, 'node_modules')), false);
});
