// usage-report-followup.plan.md stage 2; G-2 of 20261031-033859-urr-remediation-2-review: bench-second-opinion assigned the raw JSON.parse of --forged and --from
// and dereferenced `.injection_rule` and `.scores` with no shape check, so valid JSON such as `null` crashed with a
// TypeError instead of a refusal naming the file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { benchFixture, runBench } from './tools/bench-fixture.mjs';

// The fixture's own engine home, so nothing is staged under the operator's ~/.quorate.
const home = (fx) => ({ QUORATE_HOME: path.join(path.dirname(fx.fw), 'home') });

const RESULT = '2026-09-24T00-04-14-249Z';
const SEED = 'clamp-silent-noop';

for (const bad of ['null', '[]', '7', '{"scores": 7}']) {
  test(`G-2: --from holding ${bad} is refused by name, not a TypeError`, (t) => {
    const fx = benchFixture(t);
    const from = path.join(fx.fw, 'bench', 'results', `${RESULT}.json`);
    fs.writeFileSync(from, bad);
    const r = runBench(fx, 'bench-second-opinion.mjs', ['--from', from, '--seed', SEED, '--dry-run'], home(fx));
    assert.doesNotMatch(r.output, /TypeError/, r.output.slice(-800));
    assert.match(r.output, /is not a bench result/, r.output.slice(-800));
  });
}

for (const bad of ['null', '[]', '"x"', '{"seeds": 7}']) {
  test(`G-2: --forged holding ${bad} is refused by name, not a TypeError`, (t) => {
    const fx = benchFixture(t);
    const forged = path.join(path.dirname(fx.fw), 'forged.json');
    fs.writeFileSync(forged, bad);
    const r = runBench(fx, 'bench-second-opinion.mjs',
      ['--from', path.join(fx.fw, 'bench', 'results', `${RESULT}.json`), '--seed', SEED, '--forged', forged, '--dry-run'], home(fx));
    assert.doesNotMatch(r.output, /TypeError/, r.output.slice(-800));
    assert.match(r.output, /is not a forged-paragraphs file/, r.output.slice(-800));
  });
}
