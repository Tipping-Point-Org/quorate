// G-29 of run 20260925-200721-platform-remediated (panel-codex-docs): claude-md-contract.md said
// `env_names` is the credential boundary, full stop. That is true of a reviewer a contract DECLARES,
// and false of one it OVERRIDES: overriding a built-in keeps that vendor's own prefixes from
// reviewers.json — deliberately, so pinning a model flag does not strip the vendor's credentials —
// and adds the named variables. An operator reading the old text believed the process got less than
// it does. The behaviour is pinned here, and the document must say it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mergeReviewers } from '../scripts/lib/reviewers.mjs';

test('G-29: overriding a built-in keeps its prefixes; a consumer still cannot add one', () => {
  const builtin = { codex: { cmd: 'codex', env_prefixes: ['CODEX_', 'OPENAI_'] } };
  const merged = mergeReviewers(builtin, { codex: { model: 'x', env_names: ['EXTRA'], env_prefixes: ['AWS_'] } });
  assert.deepEqual(merged.codex.env_prefixes, ['CODEX_', 'OPENAI_']);
  assert.deepEqual(merged.codex.env_names, ['EXTRA']);
});

test('G-29: the contract document says an override keeps the built-in vendor\'s prefixes', () => {
  const doc = fs.readFileSync(path.join(import.meta.dirname, '..', 'shared', 'claude-md-contract.md'), 'utf8');
  const at = doc.indexOf('`env_names` is the credential boundary');
  assert.ok(at > -1);
  assert.match(doc.slice(at, at + 1500), /overrid[a-z]* a built-in[^.]*keeps[^.]*prefixes/i);
});
