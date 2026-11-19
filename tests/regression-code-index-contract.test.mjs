// THE code_index BLOCK IS IN ITS GRAMMAR, OR THE RUN IS REFUSED (code-index.plan.md stage 3).
//
// One nested map per language: `extractor` (a command), `globs` (contract globs), optional `options` (a map passed to the
// extractor) and optional `env` (names that reach it). Each wrong shape is refused at mint and at pre-flight, through one
// validator, as every other contract key is. `env` is the dangerous one: it is the only way a variable reaches a command
// a consumer declared, so a scalar that would spread into letters, a duplicate, and any entry admitting the Claude
// credentials' families are refused, with the message naming the key that holds them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { parseContractYaml } from '../scripts/lib/contract-yaml.mjs';
import { CONTRACT_BLOCK_RE } from '../scripts/lib/contract-version.mjs';
import { contractGlobErrors } from '../scripts/lib/contract-glob.mjs';
import { candidateEnvErrors } from '../scripts/lib/decisions.mjs';
import { codeIndexContractErrors } from '../scripts/lib/code-index-contract.mjs';

const BLOCK = [
  'code_index:',
  '  python:',
  '    extractor: "python .claude/skills/quorate/extractors/python/extract.py"',
  '    globs: ["src/**/*.py"]',
  '    options: { import_roots: ["src"] }',
  '    env: []',
  '',
].join('\n');

test('the parser reads the per-language block and the empty declaration as they are written', () => {
  assert.deepEqual(parseContractYaml(BLOCK), { code_index: { python: {
    extractor: 'python .claude/skills/quorate/extractors/python/extract.py', globs: ['src/**/*.py'],
    options: { import_roots: ['src'] }, env: [] } } });
  assert.deepEqual(parseContractYaml('code_index: {}\n'), { code_index: {} });
});

const lang = (over = {}) => ({ code_index: { python: { extractor: 'python x.py', globs: ['src/**/*.py'], ...over } } });

test('absent, {} and a well-formed language are accepted', () => {
  assert.deepEqual(codeIndexContractErrors({}), []);
  assert.deepEqual(codeIndexContractErrors({ code_index: {} }), []);
  assert.deepEqual(codeIndexContractErrors(lang({ options: { import_roots: ['src'] }, env: ['PYTHONPATH'] })), []);
  assert.deepEqual(codeIndexContractErrors(lang({ extractor: '' })), [], 'an empty extractor is not_configured, not an error');
});

test('each wrong shape is refused, naming the key that holds it', () => {
  const refused = (contract, pattern, why) => {
    const errors = codeIndexContractErrors(contract);
    assert.ok(errors.some((e) => pattern.test(e)), `${why}: got ${JSON.stringify(errors)}`);
  };
  refused({ code_index: 'python' }, /^code_index:.*map/, 'a scalar block');
  refused({ code_index: { python: 'x.py' } }, /code_index\.python:.*map/, 'a language that is not a map');
  refused({ code_index: { 'Py thon': { extractor: 'x', globs: [] } } }, /language name/, 'a language name that is not a word');
  refused(lang({ extractor: undefined }), /code_index\.python\.extractor/, 'no extractor');
  refused(lang({ options: 'fast' }), /code_index\.python\.options.*map/, 'options that are not a map');
  refused(lang({ shell: 'bash' }), /code_index\.python\.shell.*not a code_index key/, 'an unknown key');
  refused(lang({ env: 'PYTHONPATH' }), /code_index\.python\.env must be a list/, 'env as a scalar, which would spread into letters');
  refused(lang({ env: ['PYTHONPATH', 'pythonpath'] }), /code_index\.python\.env: pythonpath is declared twice/, 'a duplicate');
  refused(lang({ env: ['ANTHROPIC_*'] }), /code_index\.python\.env: ANTHROPIC_\* .*credential/, 'a prefix admitting ANTHROPIC_BASE_URL');
  refused(lang({ env: ['CLAUDE_CODE_OAUTH_TOKEN'] }), /code_index\.python\.env: CLAUDE_CODE_OAUTH_TOKEN/, 'a Claude credential');
  refused(lang({ env: ['MY_API_KEY'] }), /code_index\.python\.env: MY_API_KEY .*secret/, 'a secret-shaped name');
});

test('a code_index glob outside the grammar is refused by the contract glob check, as every glob is', () => {
  const errors = contractGlobErrors(lang({ globs: ['src/**/*.py', '../other/**'] }));
  assert.ok(errors.some((e) => /^code_index\.python\.globs: \.\.\/other\/\*\* — /.test(e)), JSON.stringify(errors));
  assert.deepEqual(contractGlobErrors(lang()), []);
  // The glob check owns the globs' shape too, as it does for every glob key: a scalar is refused, not spread.
  assert.ok(contractGlobErrors(lang({ globs: 'src/**/*.py' })).some((e) => /^code_index\.python\.globs: .*not a list/.test(e)));
});

test('candidateEnvErrors names the key it was given, so an extractor\'s refused list is not blamed on review.candidate_env', () => {
  assert.match(candidateEnvErrors('X', 'code_index.python.env')[0], /^code_index\.python\.env must be a list/);
  assert.match(candidateEnvErrors('X')[0], /^review\.candidate_env must be a list/, 'the default key changed');
});

test('mint and pre-flight both refuse a code_index block outside its grammar', () => {
  for (const f of ['new-run.mjs', 'preflight.mjs']) {
    assert.match(fs.readFileSync(path.join(REPO_ROOT, 'scripts', f), 'utf8'), /codeIndexContractErrors\(contract\)/, `${f} does not check code_index`);
  }
});

// check-install's missingKeys recurses into a nested map: a language in the template would be reported missing from every
// consumer that does not declare it. So the template carries the empty declaration and nothing under it.
test('the template declares code_index empty, so no consumer is told a language it did not declare is missing', () => {
  const tpl = fs.readFileSync(path.join(REPO_ROOT, 'CLAUDE.template.md'), 'utf8').split('\r\n').join('\n');
  const at = CONTRACT_BLOCK_RE.exec(tpl).index;
  const parsed = parseContractYaml(tpl.slice(at).split('\n```')[0]);
  assert.deepEqual(parsed.code_index, {});
});
