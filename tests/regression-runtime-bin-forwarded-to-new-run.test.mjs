// G-6 and G-4 of 20261111-224124-runtime-bin-d1-review: check-intent-grant and bench-repair-pass spawn new-run.mjs without
// the runtime override, and new-run always probes its runtime's version (runtimeProbe), so an offline grant probe or a
// benchmark given a fake runtime still ran the installed real one. Each test hands the script a fake that records every
// version probe beside itself, and reads what new-run recorded as the runtime's version.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScript } from './helpers.mjs';
import { refusedCase } from './bench-repair-pass-fixture.mjs';

const VERSION_LOGGER = [
  "import fs from 'node:fs';",
  "import path from 'node:path';",
  "if (process.argv.includes('--version')) fs.appendFileSync(path.join(path.dirname(process.argv[1]), 'versions.log'), 'v\\n');",
].join('\n');
const versions = (dir) => {
  const p = path.join(dir, 'versions.log');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).length : 0;
};

test('G-6: check-intent-grant hands its --runtime-bin to the new-run it spawns', (t) => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-grant-fwd-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const bin = path.join(base, 'fake.mjs');
  fs.writeFileSync(bin, `${VERSION_LOGGER}\nif (process.argv.includes('--version')) process.stdout.write('0.0.0 (fake)');\n`
    + "else process.stdout.write(JSON.stringify({ result: '', permission_denials: [] }));\n");
  const r = runScript('check-intent-grant.mjs', ['--runtime-bin', bin, '--out', path.join(base, 'report.json')], {
    env: { QUORATE_LIVE: '1', QUORATE_HOME: path.join(base, 'home'), CLAUDE_CODE_OAUTH_TOKEN: '', ANTHROPIC_API_KEY: '' },
  });
  assert.ok(versions(base) >= 1, `new-run probed a runtime other than the --runtime-bin the grant probe was given:\n${r.output}`);
});

test('G-4: bench-repair-pass hands its --runtime-bin to both scratch new-run mints', (t) => {
  const f = refusedCase(t);
  const original = fs.readFileSync(f.bin, 'utf8');
  fs.writeFileSync(f.bin, `${VERSION_LOGGER}\n${original}`);
  const r = f.bench();
  assert.equal(r.status, 0, r.output);
  const c = f.caseResult();
  assert.ok(c.scratch_runs, JSON.stringify(c));
  // Every run.json new-run wrote below the engine's home for the two scratch mints records the fake's version.
  const found = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name === 'run.json' && [c.scratch_runs.review, c.scratch_runs.remediation].includes(path.basename(d))) found.push(JSON.parse(fs.readFileSync(p, 'utf8')));
  } };
  walk(path.join(f.base, 'home'));
  assert.equal(found.length, 2, `the scratch runs' run.json were not found (${found.length})`);
  for (const run of found) assert.equal(run.host?.runtime_version, '0.0.0', `scratch run ${run.run_id} probed ${run.host?.runtime_version}, not the fake`);
});
