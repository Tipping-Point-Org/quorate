// Part 4 of 6 of regression-reviewer-preflight.test.mjs: a child that overruns its bound. Split by
// split-slow-test-files.md; the fixture is reviewer-preflight-fixture.mjs.

import { defaultReviewsRoot } from '../scripts/lib/reviews-root.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adapterErrors } from '../scripts/lib/reviewers.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { probeKey, KEY_FIELDS, recordCounts, probePassed, probeLimits, maxAgeHoursOf, adapterHash, PROBE_REVIEW_SCHEMA } from '../scripts/lib/reviewer-probe.mjs';
import { cliVersion, readProbeRecord, writeProbeRecord } from '../scripts/io/reviewer-probe.mjs';
import { REPO_ROOT, runScript, seedReviewerProbe, noRealReviewers } from './helpers.mjs';
import { classifyPanelProbe } from '../scripts/lib/decisions.mjs';
import { CAPPING_STAMPS } from '../scripts/lib/decisions.mjs';
import { base, combo, tmpHome, worker, run, safePathDirs, fakeReviewer, REVIEW_OK, setup2, calls, UNIVERSAL_OK, FAST_LIMITS, BOUND_MS, agyIsTheFake, mintFixture } from './reviewer-preflight-fixture.mjs';

test('stage 3: a child that overruns its bound is refused, named as such', (t) => {
  const f = mintFixture(t);
  const r = f.mint(['--test-preflight-stall-ms', String(BOUND_MS + 30_000)]);
  assert.notEqual(r.status, 0, r.output);
  assert.ok(r.output.includes(`overran its bound of ${BOUND_MS / 1000} s`), r.output);
  assert.deepEqual(f.runs(), []);
});
