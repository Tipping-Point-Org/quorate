// G-12 of run 20260925-015614-platform-review (panel-codex-security; its third sighting): a consuming
// project could declare `env_prefixes: ["AWS_"]` on a reviewer, and every AWS_* variable in the
// operator's environment was forwarded to that vendor's CLI. Validation checked only the prefix's
// SHAPE.
//
// Settled with the operator on 2026-09-25: a consumer-declared reviewer names EXACT variables
// (`env_names`); the built-in vendors' prefixes stay in scripts/reviewers.json, maintained by quorate,
// and a consumer can neither add nor widen them. A pattern language was considered and rejected — it
// makes the entry easier to write and gives quorate no guarantee, since `^AWS_.*$` is exactly as broad
// as the prefix it would replace.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { declaredEnvErrors, mergeReviewers, envNamesOf } from '../scripts/lib/reviewers.mjs';
import { reviewerEnv } from '../scripts/lib/decisions.mjs';

test('G-12: a consumer entry declaring prefixes is refused, naming the exact-name form', () => {
  const errs = declaredEnvErrors({ grok: { cmd: 'grok', env_prefixes: ['AWS_'] } });
  assert.equal(errs.length, 1);
  assert.match(errs[0], /grok/);
  assert.match(errs[0], /env_names/, 'the error names the fix');
  assert.deepEqual(declaredEnvErrors({ grok: { cmd: 'grok', env_names: ['GROK_API_KEY'] } }), []);
  assert.equal(declaredEnvErrors({ grok: { env_names: ['NOT A NAME'] } }).length, 1, 'a name must be a variable name');
});

test('G-12: merging never takes prefixes from a consumer entry, so a built-in cannot be widened', () => {
  const builtin = { codex: { cmd: 'codex', env_prefixes: ['CODEX_', 'OPENAI_'] } };
  const merged = mergeReviewers(builtin, { codex: { env_prefixes: ['AWS_'] }, grok: { cmd: 'grok', env_prefixes: ['GH_'], env_names: ['GROK_API_KEY'] } });
  assert.deepEqual(merged.codex.env_prefixes, ['CODEX_', 'OPENAI_'], 'the vendor prefixes quorate maintains, unwidened');
  assert.equal(merged.grok.env_prefixes, undefined, 'a consumer reviewer carries no prefixes at all');
  assert.deepEqual(envNamesOf(merged.grok), ['GROK_API_KEY']);
});

test('G-12: only the named variables cross, never a neighbour sharing their prefix', () => {
  const source = { GROK_API_KEY: 'k', GROK_DEBUG_TOKEN: 't', AWS_SECRET_ACCESS_KEY: 's', PATH: '/bin' };
  const { passed } = reviewerEnv('grok', source, { depth: 0, prefixes: [], names: ['GROK_API_KEY'] });
  assert.ok(passed.includes('GROK_API_KEY'));
  assert.ok(!passed.includes('GROK_DEBUG_TOKEN'), 'an exact name is exact');
  assert.ok(!passed.includes('AWS_SECRET_ACCESS_KEY'));
  // G-8 of 20261023-214545-ger-remediation-review: names and prefixes were compared case-sensitively, so Windows' stored
  // spelling of a credential (`OpenAI_API_KEY`) was omitted though the CLI reads it case-insensitively. Folded, as A-29's
  // other name matches are; a neighbour is still a neighbour.
  const folded = reviewerEnv('codex', { OpenAI_API_KEY: 'o', Grok_Api_Key: 'g', Grok_Debug_Token: 't', SystemRoot: 'C:\\W', SYSTEMROOT: 'C:\\W' },
    { depth: 0, prefixes: ['OPENAI_'], names: ['GROK_API_KEY'] }).passed;
  assert.ok(folded.includes('OpenAI_API_KEY'), 'a prefix matches whatever the stored case');
  assert.ok(folded.includes('Grok_Api_Key'), 'an exact name matches whatever the stored case');
  assert.ok(!folded.includes('Grok_Debug_Token'), 'an exact name is still exact');
  assert.ok(folded.includes('SYSTEMROOT'), 'a platform basic matches whatever the stored case');
});

test('G-12: mint refuses a consumer prefix, and every spawner passes the exact names', () => {
  const root = path.join(import.meta.dirname, '..', 'scripts');
  assert.match(fs.readFileSync(path.join(root, 'new-run.mjs'), 'utf8'), /declaredEnvErrors\(/, 'checked at mint');
  for (const f of ['run-graph.mjs', 'external-review.mjs']) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    const calls = [...src.matchAll(/reviewerEnv\(([\s\S]*?)\}\)/g)].map((m) => m[1]);
    assert.ok(calls.length > 0, `${f} builds a reviewer environment`);
    for (const c of calls) assert.match(c, /names:/, `${f}: every reviewerEnv call passes the exact names`);
  }
});
