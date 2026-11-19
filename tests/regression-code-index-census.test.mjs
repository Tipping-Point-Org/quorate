// regression-code-index-census.test.mjs — code-index-d1-part-b.plan.md stage 1 (design note, Verification 1 and 2).
//
// The code-index-schema-and-scope D1 chain drew an extractor MEDIUM in three reviews running, each fix reaching the
// reported construct and the next round finding its sibling. A census probed every construct instead
// (tests/fixtures/code-index/census/{python,javascript}.md, measured at 34763e78) and found false resolved edges and
// dropped calls. Its probes are this corpus, each call with its correct answer, and two tests hold the extractors to it:
//
// - coverage: every call node the PARSER sees (list_calls.py / list_calls.mjs, independent of the extractor) has exactly
//   one row. A missing row is a dropped call, which shared/code-index.md says never happens.
// - no false edge: every row answers its expected target or `unresolved`, never another target. Unresolved is always
//   allowed: it makes an answer `partial`, honestly. A wrong target makes it `complete` and wrong.
//
// KNOWN_FAILING names what fails today, each with the plan stage that fixes it. It is exact both ways: a failure it does
// not list fails the test, and so does a listed one that now passes, so the list cannot outlive its fix. It is empty by
// stage 4.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from './helpers.mjs';

const CENSUS = path.join(REPO_ROOT, 'tests', 'fixtures', 'code-index', 'census');
const EXTRACTOR = {
  python: path.join(REPO_ROOT, 'extractors', 'python', 'extract.py'),
  javascript: path.join(REPO_ROOT, 'extractors', 'javascript', 'extract.mjs'),
};

// Some probes use 3.12 and 3.13 syntax (PEP 695 type parameters, TypeVar defaults), so the corpus needs 3.13.
const python = ['python3', 'python', 'py'].map((p) => [p, p === 'py' ? ['-3.13'] : []]).find(([p, pre]) => {
  const r = spawnSync(p, [...pre, '-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 13) else 1)'], { encoding: 'utf8' });
  return r.status === 0;
});
const acornHome = process.env.QUORATE_ACORN_DIR;
const acornAt = acornHome && fs.existsSync(path.join(acornHome, 'node_modules', 'acorn', 'package.json'))
  ? path.join(acornHome, 'node_modules', 'acorn') : null;
const SKIP = {
  python: python ? false : 'no Python >= 3.13 on PATH (python3, python, py -3.13): the corpus has 3.12 and 3.13 syntax',
  javascript: acornAt ? false : 'no acorn: set QUORATE_ACORN_DIR to a directory whose node_modules holds acorn',
};

// `<language>:<file>:<line>:<col>` -> the stage that fixes it.
const KNOWN_FAILING = JSON.parse(fs.readFileSync(path.join(CENSUS, 'known-failing.json'), 'utf8'));

function corpus(language) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `quorate-census-${language}-`));
  const src = path.join(CENSUS, language);
  // A probe the parser must refuse (j32's decorator) is stored as `<name>.fixture`, so the repository's own build check,
  // which parses every .mjs, does not fail on it; it is restored to its name here.
  const stored = fs.readdirSync(src).filter((f) => /\.(py|mjs|cjs)(\.fixture)?$/.test(f));
  for (const f of stored) fs.copyFileSync(path.join(src, f), path.join(dir, f.replace(/\.fixture$/, '')));
  const files = stored.map((f) => f.replace(/\.fixture$/, '')).sort();
  if (language === 'javascript') fs.cpSync(acornAt, path.join(dir, 'node_modules', 'acorn'), { recursive: true });
  return { dir, files };
}

function run(language, dir, files) {
  const request = { code_index_request: 1, language, root: dir, files, options: {} };
  fs.writeFileSync(path.join(dir, 'request.json'), JSON.stringify(request));
  const [cmd, pre] = language === 'python' ? [python[0], [...python[1], '-I']] : [process.execPath, []];
  const extracted = spawnSync(cmd, [...pre, EXTRACTOR[language], '--language', language, '--request', path.join(dir, 'request.json')],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(extracted.status, 0, extracted.stderr);
  const lister = path.join(CENSUS, language === 'python' ? 'list_calls.py' : 'list_calls.mjs');
  const listed = spawnSync(cmd, [...pre, lister, dir, ...files], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(listed.status, 0, listed.stderr);
  return { response: JSON.parse(extracted.stdout), nodes: JSON.parse(listed.stdout) };
}

for (const language of ['python', 'javascript']) {
  test(`${language}: every call node has one row, and none resolves to the wrong target`, { skip: SKIP[language] }, (t) => {
    const expected = JSON.parse(fs.readFileSync(path.join(CENSUS, `${language}.json`), 'utf8')).calls;
    const { dir, files } = corpus(language);
    t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
    const { response, nodes } = run(language, dir, files);
    const key = (c) => `${language}:${c.file}:${c.line}:${c.col}`;

    // The expected answers name exactly the call nodes the parser sees: a probe edited without its answers fails here.
    assert.deepEqual(expected.map(key).sort(), nodes.map(key).sort(), 'tests/fixtures/code-index/census/<language>.json is out of step with the probes');
    assert.ok(nodes.length >= 70, `${nodes.length} call nodes; the census corpus has more than 70 per language`);
    // A file the parser refuses is answered parse_error, never dropped silently: JavaScript decorators (design note B-D3).
    if (language === 'javascript') {
      const dec = response.files.find((f) => f.path === 'j32_decorator.mjs');
      assert.equal(dec?.outcome, 'parse_error', JSON.stringify(dec));
    }

    const rows = new Map();
    for (const r of response.facts.calls) {
      const k = `${language}:${r.path}:${r.span.start.line}:${r.span.start.col}`;
      rows.set(k, [...(rows.get(k) ?? []), r]);
    }
    const failures = {};
    for (const c of expected) {
      const k = key(c);
      const at = rows.get(k) ?? [];
      if (at.length !== 1) { failures[k] = at.length ? `${at.length} rows` : 'dropped'; continue; }
      const r = at[0];
      if (r.resolved && r.callee !== c.expected) failures[k] = `resolved to ${r.callee}, expected ${c.expected}`;
    }
    const known = Object.keys(KNOWN_FAILING).filter((k) => k.startsWith(`${language}:`)).sort();
    assert.deepEqual(Object.keys(failures).sort().map((k) => `${k} ${failures[k]}`).filter((l) => !known.includes(l.split(' ')[0])), [],
      'a call is dropped or resolves to the wrong target, and KNOWN_FAILING does not list it');
    assert.deepEqual(known.filter((k) => !(k in failures)), [],
      'KNOWN_FAILING lists a call that now passes: remove it, since its fix has landed');
  });
}
