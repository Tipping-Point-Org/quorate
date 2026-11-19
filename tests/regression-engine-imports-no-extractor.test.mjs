// A-27: THE ENGINE NEVER IMPORTS AN EXTRACTOR (ARCHITECTURE.md; code-index.plan.md stage 9).
//
// extractors/ holds products that run in a consumer's own runtime, with dependencies the consumer installs. If any
// engine module imported one, quorate would carry that dependency, and the zero-dependency property would hold only
// until the first import. So every static and dynamic import specifier under scripts/ is read, resolved against its
// file, and refused if it lands in extractors/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const EXTRACTORS = path.join(REPO_ROOT, 'extractors') + path.sep;
const SPECIFIER = /(?:import\s[^'"]*?from\s*|import\s*\(\s*|^\s*import\s*|export\s[^'"]*?from\s*)['"]([^'"]+)['"]/gm;

const mjs = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? mjs(p) : /\.m?js$/.test(e.name) ? [p] : [];
});

// Each { file, text }: the source is passed in, so the self-check below needs no file written into scripts/.
function extractorImports(sources) {
  const out = [];
  for (const { file: f, text } of sources) {
    for (const m of text.matchAll(SPECIFIER)) {
      const spec = m[1];
      if (!spec.startsWith('.')) continue;
      const target = path.resolve(path.dirname(f), spec);
      if (target.startsWith(EXTRACTORS)) out.push(`${path.relative(REPO_ROOT, f)} imports ${spec}`);
    }
  }
  return out;
}

test('no engine module imports from extractors/', () => {
  const files = mjs(path.join(REPO_ROOT, 'scripts'));
  assert.ok(files.length > 50, 'the engine walk found almost nothing, so this test is pinning nothing');
  assert.deepEqual(extractorImports(files.map((file) => ({ file, text: fs.readFileSync(file, 'utf8') }))), []);
});

test('the check sees an import into extractors/, static or dynamic', () => {
  const file = path.join(REPO_ROOT, 'scripts', 'lib', 'imagined.mjs');
  const text = "import { a } from '../../extractors/javascript/extract.mjs';\nconst b = await import('../../extractors/python/x.mjs');\n";
  assert.equal(extractorImports([{ file, text }]).length, 2);
});
