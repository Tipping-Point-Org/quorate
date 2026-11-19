// Review 20261102-220302-rbr-remediation-5-review, remediated in 20261102-224644-rbr-remediation-6: what decide.mjs does
// with the engine's home, the seats' scratch, a child's stderr, and the runtime override it hands runtimeCall.
//   G-4: the decision surfaces' owner was rooted at fs.realpathSync(quorateHome()), so a link or junction at the named
//        home was resolved away before the owner's root check could see it (the class G-2 of rbr-remediation-4 fixed for
//        --repo-root).
//   G-6: the same, for each seat's scratch: confined(fs.realpathSync(scratch)).
//   G-3: every stderr chunk of a seat or moderator call was appended to one uncapped string, though only its last line
//        is ever used.
//   G-5: the generic panel seam took a provider-named `claudeBin` option; the runtime override is `runtimeBin`, as in
//        spawn-node.mjs and claim-check.mjs; since 2026-11-11 the flag is --runtime-bin too (operator: "A. Rename, keep an
//        alias (Recommended)"), the old spelling an alias lib/argv-specs.mjs owns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runtimeCall } from '../scripts/lib/decision-panel.mjs';
import { REPO_ROOT } from './helpers.mjs';

const SRC = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'decide.mjs'), 'utf8');

test('G-4, G-6: no confined owner in decide.mjs is rooted at a real path, which would hide a link at its root', () => {
  const sites = SRC.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /confined\(\s*(fs\.)?realpathSync/.test(l));
  assert.deepEqual(sites.map(([n, l]) => `${n}: ${l.trim()}`), [], 'an owner is rooted at a resolved path, so a link at its root is followed');
});

test('G-3: a child\'s stderr is kept to a bounded tail, never appended whole', () => {
  assert.doesNotMatch(SRC, /stderr\.on\('data',\s*\(d\)\s*=>\s*\{\s*err \+= d;\s*\}\)/, 'every stderr chunk is appended to one uncapped string');
  assert.match(SRC, /stderr\.on\('data',[^\n]*slice\(-/, 'the stderr kept is not cut to a tail');
});

test('G-5: runtimeCall takes the runtime override as runtimeBin, and decide.mjs names no vendor-named spelling of it', () => {
  const surface = fs.mkdtempSync(path.join(os.tmpdir(), 'decide-surface-'));
  try {
    const call = runtimeCall({ scripts: '/s', promptFile: '/rec/p.md', out: '/rec/o.json', result: '/rec/r.json', repoRoot: REPO_ROOT,
      surface, runtimeBin: '/fake/runtime.mjs' });
    const at = call.argv.indexOf('--runtime-bin'); // runtime-neutral since G-4 of 20261104-171128-epo-remediation-3-review
    assert.ok(at >= 0 && call.argv[at + 1] === '/fake/runtime.mjs', `the runtime override was not passed on: ${call.argv.join(' ')}`);
  } finally { fs.rmSync(surface, { recursive: true, force: true }); }
  assert.doesNotMatch(SRC, new RegExp(['claude', 'Bin'].join('')), 'decide.mjs still names the runtime override after one provider');
});

// G-5 of 20261102-231209-rbr-remediation-6-review: dropSurface caught every confinement or removal failure and said
// nothing, so a surface left behind was left silently.
test('G-5: a surface that cannot be removed is named on stderr, never dropped silently', () => {
  const line = SRC.split('\n').find((l) => /^const dropSurface\b/.test(l)) ?? '';
  assert.notEqual(line, '', 'dropSurface is not defined where it was');
  assert.doesNotMatch(line, /catch\s*\{\s*\/\*[^*]*\*\/\s*\}/, 'dropSurface swallows its error with an empty catch');
  assert.match(line, /catch\s*\(e\)\s*\{[^}]*console\.error\(/, 'dropSurface does not report a failed removal');
});

// G-13 of 20261102-231209-rbr-remediation-6-review (root of G-1): G-5's fix renamed one spelling of the class and left its
// siblings in the same seam, the exported claudeCall, its messages, and decide.mjs's claudeName, claudeSeq and '-claude'
// surface suffix. ARCHITECTURE A-9: no vendor name in a variable, a function or a message. The flag is --runtime-bin since
// 2026-11-11; its old spelling lives only in lib/argv-specs.mjs, as an alias.
test('G-13: the panel\'s runtime seam names no vendor, in decision-panel.mjs or decide.mjs', async () => {
  const panel = await import('../scripts/lib/decision-panel.mjs');
  assert.equal(typeof panel.runtimeCall, 'function', 'the seam is not exported under a vendor-neutral name');
  assert.equal(panel.claudeCall, undefined, 'the seam is still exported as claudeCall');
  for (const f of ['scripts/lib/decision-panel.mjs', 'scripts/decide.mjs']) {
    const code = fs.readFileSync(path.join(REPO_ROOT, f), 'utf8').replace(/--runtime-bin|'runtime-bin'/g, '');
    const hits = code.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /\bclaude[A-Z]\w*|-claude\b/.test(l));
    assert.deepEqual(hits.map(([n, l]) => `${f}:${n}: ${l.trim()}`), [], 'a vendor name in the runtime seam');
  }
});
