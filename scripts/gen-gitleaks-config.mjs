#!/usr/bin/env node
// gen-gitleaks-config.mjs — writes .claude/hooks/gitleaks.toml from scripts/lib/secret-shapes.mjs
// (secret-shapes-and-refusals, 1a). The push rules and redaction come from one definition; this is how the push
// half is produced. A test fails when the committed file differs from what this writes.
//
//   node scripts/gen-gitleaks-config.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderGitleaksToml } from './lib/secret-shapes.mjs';
import { confined } from './io/confined-path.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const segs = ['.claude', 'hooks', 'gitleaks.toml'];
const out = path.join(repoRoot, ...segs);
// Atomic (G-2 of 20261022-025041-cid1a-remediation-review): a bare write truncates first, so an interruption could leave
// the push scan's rules empty or partial. THROUGH THE REPOSITORY'S OWNER (G-2 of 20261122-204359-llo-remediation-review;
// ARCHITECTURE A-30): a link or junction at .claude or .claude/hooks sent the temporary write and its rename outside the
// repository. The owner's replace is atomic too, and refuses a link at any level before anything is written.
try {
  confined(repoRoot).replace(segs, renderGitleaksToml());
} catch (e) {
  process.stderr.write(`gen-gitleaks-config: ${e.message}\n`);
  process.exit(1);
}
process.stdout.write(`gen-gitleaks-config: wrote ${path.relative(process.cwd(), out) || out}\n`);
