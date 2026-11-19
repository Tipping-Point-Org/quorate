// The open ledger entries at MEDIUM or above that any code-index review raised: the set
// code-index-schema-and-scope.plan.md stage 5 answers. Selected by the run that raised them, not by a path list.
import fs from 'node:fs';
const l = JSON.parse(fs.readFileSync('.claude/reviews/ledger.json', 'utf8'));
const es = l.entries ?? l;
const rank = { BLOCKER: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
for (const [k, e] of Object.entries(es)) {
  if (!(e.sightings ?? []).some((s) => /code-index/.test(JSON.stringify(s)))) continue;
  if (['fixed', 'closed', 'declined', 'withdrawn'].includes(e.status ?? e.state)) continue;
  if ((rank[e.severity ?? e.max_severity] ?? 0) < 2) continue;
  console.log(`${k} ${e.severity ?? e.max_severity} ${e.status ?? e.state}`);
}
