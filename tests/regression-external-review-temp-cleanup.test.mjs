// regression-external-review-temp-cleanup.test.mjs — G-1 of 20261118-142344-cpi-remediation-2-review.
//
// With no evidence directory, external-review.mjs writes the native schema and the reviewer's answer file into a folder
// in the shared OS temporary directory and removes it before it answers. cleanupTempSchema discarded every removal
// error, so a source-derived reviewer response could stay there with nothing recording it. The failure is now named in
// the response's not_checked[] and on stderr.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runScript, withTempDir, seedReviewerProbe } from './helpers.mjs';

test('a temporary schema folder that could not be removed is named in not_checked and on stderr (G-1)', () => {
  withTempDir((dir) => {
    const binDir = path.join(dir, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    const body = JSON.stringify({ status: 'ok', candidates: [{ name: 'a' }] });
    // The reviewer answers, and leaves a folder holding a file beside its answer file, which cleanup's unlink cannot remove.
    fs.writeFileSync(path.join(binDir, 'fake-codex.mjs'), [
      "import fsx from 'node:fs';",
      "import px from 'node:path';",
      'const a = process.argv;',
      "const i = a.indexOf('--output-last-message');",
      `const body = ${JSON.stringify(body)};`,
      'if (i !== -1 && a[i + 1]) {',
      '  fsx.writeFileSync(a[i + 1], body);',
      "  const stuck = px.join(px.dirname(a[i + 1]), 'stuck');",
      "  fsx.mkdirSync(stuck, { recursive: true }); fsx.writeFileSync(px.join(stuck, 'f.txt'), 'x');",
      '}',
      'process.stdout.write(body);',
      '',
    ].join('\n'));
    if (process.platform === 'win32') {
      fs.writeFileSync(path.join(binDir, 'codex.cmd'), `@"${process.execPath}" "%~dp0fake-codex.mjs" %*\r\n`);
    } else {
      const shim = path.join(binDir, 'codex');
      fs.writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/fake-codex.mjs" "$@"\n`);
      fs.chmodSync(shim, 0o755);
    }
    const home = path.join(dir, 'home');
    fs.mkdirSync(home, { recursive: true });
    const tmp = path.join(dir, 'tmp');
    fs.mkdirSync(tmp, { recursive: true });
    const prompt = path.join(dir, 'prompt.md');
    fs.writeFileSync(prompt, 'Propose options for the declared goal.');
    const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
    const pathValue = `${binDir}${path.delimiter}${process.env[pathKey] ?? ''}`;
    const probes = path.join(dir, 'probes');
    seedReviewerProbe(probes, { mode: 'propose', route: 'native', pathValue });
    const r = runScript('external-review.mjs', [
      '--reviewer', 'codex', '--mode', 'propose', '--prompt-file', prompt, '--schema', '{"candidates":"array"}',
      '--candidate-fields', 'name',
    ], { env: { [pathKey]: pathValue, QUORATE_HOME: home, QUORATE_REVIEWER_PROBES: probes, TMP: tmp, TEMP: tmp, TMPDIR: tmp } });
    const left = fs.readdirSync(tmp).filter((n) => n.startsWith('quorate-schema-'));
    assert.equal(left.length, 1, `precondition: the temporary schema folder stayed (${left.join(', ')}); output: ${r.output}`);
    const start = r.stdout.indexOf('{');
    const env = JSON.parse(r.stdout.slice(start));
    const gap = (env.not_checked ?? []).find((n) => /temporary schema/.test(`${n.item} ${n.reason}`));
    assert.ok(gap, `the leftover folder is named in none of not_checked: ${JSON.stringify(env.not_checked)}`);
    assert.match(r.stderr ?? r.output, /temporary schema/, 'stderr does not name the leftover folder');
  });
});
