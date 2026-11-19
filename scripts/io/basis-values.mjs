// The basis values, read from their machine copy: the `basis` enum of scripts/verdict.schema.json, which holds the table
// of shared/disk-first-protocol.md §4 (ARCHITECTURE.md A-6: §4 owns the values, and no document restates them). A reader
// that needs the set, `review.grounding_floor`'s among them (decision-records.plan.md stage 2), takes it from here and
// never keeps a copy.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'verdict.schema.json');

/** The basis enum of the verdict schema, in its declared order. Throws when the schema carries none. */
export function basisValues() {
  const found = [];
  const walk = (v, key) => {
    if (!v || typeof v !== 'object') return;
    if (key === 'basis' && Array.isArray(v.enum)) found.push(v.enum);
    for (const [k, c] of Object.entries(v)) walk(c, k);
  };
  walk(JSON.parse(fs.readFileSync(SCHEMA, 'utf8')), null);
  if (!found.length) throw new Error(`${SCHEMA} declares no basis enum`);
  return [...found[0]];
}
