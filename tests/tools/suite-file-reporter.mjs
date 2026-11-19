// suite-file-reporter.mjs — a node:test reporter that writes, per test file, its whole duration and its counts, one JSON
// line each (telemetry-run-time.plan.md stage 3). The TAP reporter run-all already uses carries no file per passing test,
// so the per-file figures come from the events that do: a file's own `test:complete` (named after the file, its duration
// the file's whole time, module load included) and its `test:summary` (the file's counts). No test name, no output.
// tests/run-all.mjs adds it only when it writes a suite record; scripts/io/telemetry-record.mjs reads what it wrote.

import path from 'node:path';

export default async function* suiteFileReporter(source) {
  for await (const e of source) {
    const d = e?.data ?? {};
    if (typeof d.file !== 'string') continue;
    // The file's own event is named after the path the runner was given (relative to its cwd, which is this process's),
    // so it is matched by the path it resolves to, never by its spelling.
    if (e.type === 'test:complete' && d.nesting === 0 && typeof d.name === 'string' && path.resolve(d.name) === path.resolve(d.file)) {
      yield `${JSON.stringify({ event: 'file', file: d.file, duration_ms: d.details?.duration_ms ?? null })}\n`;
    } else if (e.type === 'test:summary') {
      yield `${JSON.stringify({ event: 'summary', file: d.file, counts: d.counts ?? null })}\n`;
    }
  }
}
