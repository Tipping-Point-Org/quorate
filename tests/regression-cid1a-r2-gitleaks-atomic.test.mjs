// G-2 of 20261022-025041-cid1a-remediation-review: gen-gitleaks-config wrote the tracked push-scan rules with a bare
// writeFileSync, which truncates before it writes, so an interruption could leave the secret scan's policy empty or
// partial. The census of G-4 (gen-rule-text, the same class) missed it. Every generator writes through writeTextAtomic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('the generators write their tracked output atomically', () => {
  for (const f of ['gen-gitleaks-config.mjs', 'gen-rule-text.mjs']) {
    const src = fs.readFileSync(new URL(`../scripts/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /\bfs\.writeFileSync\(/, `${f} truncates its output before writing it`);
    // The owner's replace is atomic too: gen-gitleaks-config writes through it since G-2 of
    // 20261122-204359-llo-remediation-review, so a link at .claude/hooks is refused.
    assert.match(src, /\bwriteTextAtomic\(|\bconfined\([^)]*\)\.replace\(/, f);
  }
});
