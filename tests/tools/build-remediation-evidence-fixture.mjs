#!/usr/bin/env node
// build-remediation-evidence-fixture.mjs — tests/regression-evidence-rules.test.mjs's fixtures, from a real remediation run.
//
//   node tests/tools/build-remediation-evidence-fixture.mjs <remediation run dir> <case name> <G-a,G-b,...> <reviewed run dir>
//
import fs from 'node:fs';
import path from 'node:path';
const [runDir, name, ids, reviewDir] = process.argv.slice(2);
const want = ids.split(',');
const out = path.join('tests', 'fixtures', 'remediation-evidence', name);
const payload = JSON.parse(fs.readFileSync(path.join(runDir, 'evidence', 'remediation', 'payload.json'), 'utf8'));
const groups = payload.groups.filter((g) => want.includes(g.group_id));
const recon = JSON.parse(fs.readFileSync(path.join(reviewDir, 'evidence', 'reconcile', 'payload.json'), 'utf8')).groups;
const fg = JSON.parse(fs.readFileSync(path.join(reviewDir, 'finding-groups.json'), 'utf8')).groups;
const confirmed = recon.filter((g) => g.decision === 'confirmed').map((g) => g.group_id);
const symptoms = Object.fromEntries(recon.filter((g) => g.decision === 'symptom').map((g) => [g.group_id, g.root_cause_group]));
const reviewedFiles = Object.fromEntries(fg.filter((g) => want.includes(g.group_id)).map((g) => [g.group_id, g.file]));
fs.mkdirSync(path.join(out, 'evidence', 'remediation'), { recursive: true });
const keep = ['group_id', 'disposition', 'cluster', 'files', 'red_evidence', 'green_evidence'];
fs.writeFileSync(path.join(out, 'case.json'), JSON.stringify({
  source: `${path.basename(runDir)} (payload groups ${want.join(', ')}); review ${path.basename(reviewDir)}`,
  groups: groups.map((g) => Object.fromEntries(keep.map((k) => [k, g[k]]))), confirmed, symptoms, reviewed_files: reviewedFiles,
}, null, 2) + '\n');
const cited = new Set(groups.flatMap((g) => [g.red_evidence, g.green_evidence]).flatMap((f) => String(f ?? '').split(';')).map((s) => s.trim()).filter(Boolean));
for (const rel of cited) {
  const text = fs.readFileSync(path.join(runDir, rel), 'utf8');
  const lines = text.split('\n');
  const end = lines.findIndex((l) => /^-{20,}/.test(l));
  fs.writeFileSync(path.join(out, rel), lines.slice(0, end + 1).join('\n') + '\n');
}
console.log(`${out}: ${groups.length} groups, ${cited.size} captures`);
