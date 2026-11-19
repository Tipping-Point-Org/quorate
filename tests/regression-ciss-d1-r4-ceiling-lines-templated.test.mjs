// regression-ciss-d1-r4-ceiling-lines-templated.test.mjs — G-12 of review 20261021-194056-ciss-d1-remediation-3-review.
//
// The brief's degraded-mode lines (severity ceiling, severity floor, verdict ceiling) were model-facing prose written
// inside run-graph.mjs, so prompt ownership was split between the orchestrator and prompts/_templates and the two could
// drift again, as the verdict line already had (ARCHITECTURE.md §2). The orchestrator now supplies the value; the
// sentence lives in a template.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { renderTemplate } from '../scripts/lib/template.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('G-12: run-graph writes no degraded-mode sentence of its own; each is a template it fills', () => {
  const rg = read('scripts/run-graph.mjs');
  assert.doesNotMatch(rg, /`Degraded: /, 'run-graph still carries model-facing "Degraded:" prose');
  for (const [name, slot, value, phrase] of [
    ['degraded-severity-ceiling.md', 'severity_ceiling', 'LOW', /no finding may exceed severity LOW — except a §6 invariant/],
    ['degraded-severity-floor.md', 'severity_floor', 'LOW', /every finding is recorded at least at severity LOW/],
    ['degraded-verdict-ceiling.md', 'verdict_ceiling', 'RISK', /may not exceed RISK — except one a §6 invariant finding drives/],
  ]) {
    const file = `prompts/_templates/${name}`;
    assert.ok(fs.existsSync(new URL(`../${file}`, import.meta.url)), `${file} does not exist`);
    assert.match(renderTemplate(read(file), { [slot]: value }, name), phrase, `${file} does not render its sentence`);
    assert.match(rg, new RegExp(`readTemplate\\('${name.replace('.', '\\.')}'\\)`), `run-graph does not read ${file}`);
  }
});
