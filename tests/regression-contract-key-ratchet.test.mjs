// ADDING A CONTRACT KEY WAS UNRATCHETED, AND THE CONTRACT IS THE MOST LOAD-BEARING FILE HERE.
//
// A key has to land in at least three places to work: this repository's own `graph_contract`, the
// `CLAUDE.template.md` block every consumer COPIES, and `shared/claude-md-contract.md`, the document
// QUORATE.md names as where "every key is documented". Nothing compared them. At the time this test
// was written all three happened to agree — 42 keys, no drift — by care rather than by construction,
// which is precisely the state that produced every "promised in three documents, delivered by none"
// defect in this ledger. A blacklist fails exactly when something is added; so does no list at all.
//
// The template half is not cosmetic. `check-install` measures a consumer's contract against the
// TEMPLATE, so a key missing there can never be surfaced to a consumer — which is how a project keeps
// a 15-minute barrier cap long after this repository measured that it kills the reconciler. The one
// existing check in this area (regression-published-enums) pins a single key's VALUE list and says so
// in its own closing comment; this is the missing half it names.
//
// THE KEYS COME FROM THE ENGINE'S OWN PARSER, never from a regex written beside it. A second
// extractor could disagree with `parseContractYaml` and still pass, leaving the ratchet green while
// the engine reads a different set — the "two owners of one fact" defect this repository keeps
// paying for. That parser lived inside new-run.mjs, a CLI that would have executed a whole mint on
// import, which is the mechanical reason this test could not previously have been written.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { parseContractYaml } from '../scripts/lib/contract-yaml.mjs';
import { CONTRACT_BLOCK_RE } from '../scripts/lib/contract-version.mjs';

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8').split('\r\n').join('\n');

/** The fenced `graph_contract` block in a markdown file, as the engine would see it. */
function contractBlock(rel) {
  const text = read(rel);
  // BY THE KEY, NOT BY A VERSION NUMBER. This searched for the literal `graph_contract: 1` and so
  // stopped finding the block the first time the schema version was bumped — a ratchet that fails
  // for its own reason, on the very edit it exists to supervise.
  // Either spelling: the key was renamed to graph_contract_version in v3, and the ratchet must
  // keep finding the block through the rename it is supposed to supervise.
  const m = CONTRACT_BLOCK_RE.exec(text);
  const at = m ? m.index : -1;
  assert.notEqual(at, -1, `${rel} carries no graph_contract block — this test is pinning nothing`);
  const body = text.slice(at).split('\n```')[0];
  assert.ok(body.length > 200, `${rel}: the block parsed suspiciously short (${body.length} bytes)`);
  return body;
}

/** Every key path in a contract, `a.b.c`, from the ENGINE'S parser rather than a regex. */
function keyPaths(rel) {
  const walk = (obj, prefix = []) => {
    const out = [];
    for (const [k, v] of Object.entries(obj ?? {})) {
      const full = [...prefix, k];
      out.push(full.join('.'));
      // A nested map is more keys; an array or scalar is a value, and its contents are not keys.
      if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...walk(v, full));
    }
    return out;
  };
  return new Set(walk(parseContractYaml(contractBlock(rel))));
}

test('this repository and the template consumers copy declare the SAME keys', () => {
  const mine = keyPaths('CLAUDE.md');
  const tmpl = keyPaths('CLAUDE.template.md');

  assert.ok(mine.size >= 30, `parsed only ${mine.size} keys from CLAUDE.md — the parse, not the file`);

  const missingFromTemplate = [...mine].filter((k) => !tmpl.has(k)).sort();
  assert.deepEqual(missingFromTemplate, [],
    'these keys exist here and NOT in CLAUDE.template.md. check-install measures a consumer\'s '
    + 'contract against the template, so a key absent there can never be surfaced to them: they keep '
    + 'whatever default they were given, silently, forever.');

  const missingFromMine = [...tmpl].filter((k) => !mine.has(k)).sort();
  assert.deepEqual(missingFromMine, [],
    'these keys are offered to consumers and this repository does not declare them, so no run here '
    + 'ever exercises them — shipped and never dogfooded');
});

test('every contract key is documented in the file QUORATE.md sends readers to', () => {
  const doc = read('shared/claude-md-contract.md');
  const undocumented = [...keyPaths('CLAUDE.md')].filter((k) => {
    const leaf = k.split('.').pop();
    // The owning document addresses keys by leaf name, in prose, headings and tables alike.
    return !new RegExp(`\\b${leaf.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(doc);
  }).sort();

  assert.deepEqual(undocumented, [],
    'QUORATE.md tells every consumer that "every key is documented in shared/claude-md-contract.md". '
    + 'A key that file never mentions makes that sentence false, and leaves the consumer guessing at '
    + 'the meaning of something their gate depends on.');
});

test('every contract key is read by something in scripts/', () => {
  // The inert-key class: declared, documented, copied by consumers, and consulted by nothing. The
  // engine reads keys as property accesses (`contract.review.concurrency`), so the leaf name is what
  // a reader must contain — this cannot prove a key is USED correctly, only that it is not orphaned.
  const sources = fs.readdirSync(path.join(REPO_ROOT, 'scripts'), { recursive: true })
    .filter((f) => String(f).endsWith('.mjs'))
    .map((f) => fs.readFileSync(path.join(REPO_ROOT, 'scripts', String(f)), 'utf8'))
    .join('\n');

  const orphaned = [...keyPaths('CLAUDE.md')].filter((k) => {
    const leaf = k.split('.').pop();
    return !new RegExp(`\\b${leaf.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(sources);
  }).sort();

  assert.deepEqual(orphaned, [],
    'these keys are declared and no script mentions them. A contract key nothing reads looks exactly '
    + 'like one that works, and a consumer filling it in gets a guarantee nobody enforces.');
});
