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
import { contractVersionGap, contractVersionMessage, declaredContractVersion } from '../lib/contract-version.mjs';

/**
 * `{ review, request, contract }` from the repository's contract (`contract` the whole parsed block, as new-run
 * --print-contract prints it, for a hook that needs more than the review block: G-15 of 20261123-161216-m3s9-review), or
 * `{ review: {}, request: null, contract: null, unreadable }`.
 */
export function sessionContract(repoRoot) {
  try {
    const entries = CONTRACT_CANDIDATES.map((rel) => {
      const abs = path.join(repoRoot, rel);
      return { path: rel, text: fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null };
    });
    const chosen = chooseContractSource(entries);
    // `absent` kept, so a caller can tell no contract from one it cannot read, as new-run --print-contract's outcome does
    // (G-13 of 20261124-021129-m3s9-remediation-2-review-b: the freshness refresh reads through here now).
    if (!chosen.ok) return { review: {}, request: null, contract: null, unreadable: chosen.why, ...(chosen.absent ? { absent: true } : {}) };
    const c = parseContractYaml(chosen.yaml);
    // The version is held as the engine's reader holds it (G-7 of 20261124-030759-m3s9-remediation-3-review-b): an
    // invalid or ahead contract is refused by new-run --print-contract, and the freshness refresh runs the adapter
    // commands this returns, so it is unreadable here too; `behind` is read, as there.
    const declared = declaredContractVersion(c);
    const gap = contractVersionGap(declared.value, undefined, declared.key);
    if (gap.state === 'invalid' || gap.state === 'ahead') {
      return { review: {}, request: null, contract: null, unreadable: contractVersionMessage(gap) };
    }
    return { review: c?.review ?? {}, request: c?.doc_roles?.request || null, contract: c ?? null };
  } catch (e) {
    return { review: {}, request: null, contract: null, unreadable: e?.message ?? String(e) };
  }
}
