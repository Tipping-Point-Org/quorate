// The stop record's place, decided on what the path resolves to (G-3 of 20261024-235344-arp-remediation-2-review). The
// check that keeps the personal record out of the repository compared the two paths as text: a home named
// `<repo>/..cache` read as outside because its relative path starts with `..`, and a home reached through a link or
// junction outside the repository that resolves inside it passed as well.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stopLogPath } from '../scripts/io/stop-log.mjs';

test('regression: a home whose name inside the repository starts with two dots is refused', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'stoplog-repo-'));
  try {
    assert.throws(() => stopLogPath(repo, { home: path.join(repo, '..cache') }), /inside the repository/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('regression: a home reached through a link that resolves inside the repository is refused', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'stoplog-repo-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'stoplog-out-'));
  const link = path.join(outside, 'home-link');
  try {
    fs.mkdirSync(path.join(repo, 'inner'));
    fs.symlinkSync(path.join(repo, 'inner'), link, 'junction');
    assert.throws(() => stopLogPath(repo, { home: link }), /inside the repository/);
    assert.throws(() => stopLogPath(repo, { home: path.join(link, 'not-yet') }), /inside the repository/,
      'a home not made yet is decided on its nearest existing parent');
    assert.doesNotThrow(() => stopLogPath(repo, { home: path.join(outside, 'home') }), 'a home truly outside is taken');
  } finally {
    fs.rmSync(link, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
