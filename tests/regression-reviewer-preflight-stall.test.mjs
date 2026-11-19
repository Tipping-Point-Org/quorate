// Part 3 of 6 of regression-reviewer-preflight.test.mjs: a child stalling for a quarter of its bound. Split by
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

// THE BOUND. Each test asserts its specific reason: at HEAD the forwarding flags do not exist and new-run refuses them as
// an unknown argument (exit 2, no run directory), so "refused" alone would pass there for the wrong reason.
test('stage 3: a child whose stall is a quarter of its bound is not refused', (t) => {
  // A quarter, not the plan's "at most half" taken at its limit: the check itself runs before the stall and takes
  // its own seconds, and the headroom left must outlast a loaded machine.
  const f = mintFixture(t);
  const r = f.mint(['--test-preflight-stall-ms', String(BOUND_MS / 4)]);
  assert.equal(r.status, 0, r.output);
  assert.equal(f.runs().length, 1);
});
