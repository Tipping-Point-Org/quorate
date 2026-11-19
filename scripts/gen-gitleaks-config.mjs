#!/usr/bin/env node
// gen-gitleaks-config.mjs — writes .claude/hooks/gitleaks.toml from scripts/lib/secret-shapes.mjs
// (secret-shapes-and-refusals, 1a). The push rules and redaction come from one definition; this is how the push
// half is produced. A test fails when the committed file differs from what this writes.
//
//   node scripts/gen-gitleaks-config.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderGitleaksToml } from './lib/secret-shapes.mjs';
import { writeTextAtomic } from './io/atomic.mjs';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.claude', 'hooks', 'gitleaks.toml');
// Atomic (G-2 of 20261022-025041-cid1a-remediation-review): a bare write truncates first, so an interruption could leave
// the push scan's rules empty or partial.
writeTextAtomic(out, renderGitleaksToml());
process.stdout.write(`gen-gitleaks-config: wrote ${path.relative(process.cwd(), out) || out}\n`);
