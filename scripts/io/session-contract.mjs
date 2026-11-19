// What the session hooks need of the contract (session-record-files.plan.md stages 2 and 3): the record's retention
// age and the plan in flight. The engine's own reader (io/contract-reader.mjs) spawns new-run --print-contract, too heavy
// for a hook that runs before every command, so this reads the contract in process through the same source rule
// (lib/contract-source.mjs, one block, the preferred file first) and the same strict parser (lib/contract-yaml.mjs).
//
// It fails soft, unlike the engine's reader: a contract it cannot read gives the defaults (no task, the default
// retention), because a hook that refused to log over a contract problem would block every command for a reason the
// contract's own checks already report.

import fs from 'node:fs';
import path from 'node:path';
import { CONTRACT_CANDIDATES, chooseContractSource } from '../lib/contract-source.mjs';
import { parseContractYaml } from '../lib/contract-yaml.mjs';

/** `{ review, request }` from the repository's contract, or `{ review: {}, request: null, unreadable }`. */
export function sessionContract(repoRoot) {
  try {
    const entries = CONTRACT_CANDIDATES.map((rel) => {
      const abs = path.join(repoRoot, rel);
      return { path: rel, text: fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null };
    });
    const chosen = chooseContractSource(entries);
    if (!chosen.ok) return { review: {}, request: null, unreadable: chosen.why };
    const c = parseContractYaml(chosen.yaml);
    return { review: c?.review ?? {}, request: c?.doc_roles?.request || null };
  } catch (e) {
    return { review: {}, request: null, unreadable: e?.message ?? String(e) };
  }
}
