// load-join.mjs — the avp/load sampler's rows joined to timed runs (test-selection-exploration.md).
//
// As a module: joinLoad(runs, csvPath) gives each run (plain, candidate, unchanged) the mean avp and total CPU of the
// samples taken while it ran. As a script: `node load-join.mjs --csv <sampler csv> <overhead-*.json>...` re-joins saved
// results in place, for runs measured before the harness read the file at the end.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// The sampler's rows are local HH:MM:SS.mmm with no date, so they are read as today's.
export function readSamples(csvPath) {
  if (!csvPath || !fs.existsSync(csvPath)) return null;
  return fs.readFileSync(csvPath, 'utf8').replace(/^﻿/, '').split(/\r?\n/).slice(1).filter(Boolean).map((l) => {
    const [time, avp, total] = l.split(',');
    const [h, m, s] = time.split(':');
    const d = new Date(); d.setHours(Number(h), Number(m), 0, 0);
    return { t: d.getTime() + Number(s) * 1000, avp: Number(avp), total: Number(total) };
  });
}

export function loadOf(samples, r) {
  if (!samples) return null;
  // The sampler writes about every 3 s; a run shorter than that is given the sample that follows it.
  const a = Date.parse(r.started_at); const b = Date.parse(r.ended_at) + 3500;
  const hit = samples.filter((x) => x.t >= a && x.t <= b);
  if (!hit.length) return null;
  const mean = (k) => +(hit.reduce((n, x) => n + x[k], 0) / hit.length).toFixed(2);
  return { n: hit.length, avp_pct: mean('avp'), total_pct: mean('total'), avp_max: Math.max(...hit.map((x) => x.avp)) };
}

export function joinLoad(runs, csvPath) {
  const samples = readSamples(csvPath);
  for (const p of runs) for (const k of ['plain', 'candidate', 'unchanged']) if (p[k]) p[k].load = loadOf(samples, p[k]);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const i = process.argv.indexOf('--csv');
  const csv = process.argv[i + 1];
  for (const f of process.argv.slice(2).filter((a, j) => j + 2 !== i && j + 2 !== i + 1)) {
    const r = JSON.parse(fs.readFileSync(f, 'utf8'));
    joinLoad(r.runs, csv);
    fs.writeFileSync(f, `${JSON.stringify(r, null, 2)}\n`);
    const all = r.runs.flatMap((p) => ['plain', 'candidate', 'unchanged'].filter((k) => p[k]).map((k) => p[k]));
    console.log(`${f}: ${all.filter((x) => x.load).length}/${all.length} joined`);
  }
}
