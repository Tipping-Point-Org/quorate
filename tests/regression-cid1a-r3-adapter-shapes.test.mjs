// G-5 and G-4 of 20261022-034225-cid1a-remediation-2-review: adapterErrors iterated env_prefixes after finding it was not
// an array, so an object or number threw TypeError and the mint aborted with no named refusal; and it only truth-tested
// `cmd`, so an array or object passed at mint and made spawnSync throw later.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adapterErrors } from '../scripts/lib/reviewers.mjs';

test('a non-iterable env_prefixes is refused by name, not thrown', () => {
  for (const bad of [{ a: 1 }, 7, true]) {
    let errs;
    assert.doesNotThrow(() => { errs = adapterErrors('x', { cmd: 'x', env_prefixes: bad }); }, JSON.stringify(bad));
    assert.ok(errs.some((e) => /env_prefixes must be an array/.test(e)), JSON.stringify(errs));
  }
});

test('a cmd that is not a non-empty string is refused at mint', () => {
  for (const bad of [['codex'], { bin: 'codex' }, 5, '  ']) {
    const errs = adapterErrors('x', { cmd: bad });
    assert.ok(errs.some((e) => /\bcmd\b/.test(e)), `${JSON.stringify(bad)}: ${JSON.stringify(errs)}`);
  }
  assert.ok(!adapterErrors('x', { cmd: 'codex' }).some((e) => /\bcmd\b/.test(e)));
});
