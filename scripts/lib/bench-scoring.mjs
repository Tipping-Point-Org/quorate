// bench-scoring.mjs — pure scoring for the seeded-defect benchmark.
//
// The framework measures process integrity everywhere and defect-finding effectiveness nowhere:
// no lens has a recall figure, the reconciler has no precision figure, and the open question of
// reasoning effort (CODEX_RUNTIME_FINDINGS item 2) is unanswerable without a harness. This module
// is that harness's decision layer: given one seeded defect and the findings a run produced, did
// any lens land on it, and which of the lenses expected to catch it did.
//
// Pure on purpose, like everything in lib/: the expensive part of a benchmark is the model run,
// and the one part that must never be wrong quietly — the scoring — is the part that costs
// nothing to test.

/** Manifest shape errors, or empty. A manifest that half-parses scores garbage silently. */
export function validateManifest(m) {
  const errors = [];
  if (!m || typeof m !== 'object') return ['manifest is not an object'];
  if (!/^[a-z0-9-]+$/.test(m.id ?? '')) errors.push('id must be a [a-z0-9-]+ slug');
  if (!m.title) errors.push('title is required');
  if (!['historical', 'mutation'].includes(m.source)) {
    errors.push("source must be 'historical' or 'mutation'");
  }
  const d = m.defect;
  if (!d || typeof d !== 'object') {
    errors.push('defect {file, anchor, lenses} is required');
  } else {
    if (typeof d.file !== 'string' || !d.file.trim()) errors.push('defect.file is required');
    if (typeof d.anchor !== 'string' || !d.anchor.trim()) {
      errors.push('defect.anchor is required: a literal line fragment from the SEEDED file, unique within it');
    }
    // An absolute line is FORBIDDEN, not merely optional. Kept alongside the anchor it would be a
    // second source of truth for the same fact, free to disagree with it silently — which is the
    // drift the anchor exists to end.
    if (d.line !== undefined) {
      errors.push('defect.line is no longer used: the line is resolved from defect.anchor at score time');
    }
    if (!Array.isArray(d.lenses) || !d.lenses.length) {
      errors.push('defect.lenses must name at least one lens expected to catch this');
    } else if (d.lenses.some((l) => typeof l !== 'string' || !l.trim() || l !== l.trim())) {
      // No surrounding space either (G-2 of 20261114-032609-m2-7b-remediation-review): ' code-audit ' passed the blank
      // test, escaped the duplicate test below, and named a lens no run has.
      errors.push('defect.lenses must hold lens names, each a nonempty string with no surrounding space');
    } else if (new Set(d.lenses).size !== d.lenses.length) {
      // summarize counts every entry, so a lens named twice would count one seed twice in its recall.
      errors.push('defect.lenses must name each lens once');
    }
  }
  if (!Array.isArray(m.scope) || !m.scope.length) {
    errors.push('scope must list the paths handed to --full-sweep');
  } else if (m.scope.some((p) => typeof p !== 'string' || !p.trim())) {
    // Each one a path (G-3 of 20261114-032609-m2-7b-remediation-review): they are spread into --full-sweep's argv.
    errors.push('scope must hold paths, each a nonempty string');
  }
  // Why a seed patch removes tests: a defect the regression suite catches never reaches a lens —
  // the pre-flight barrier fails first, and the benchmark measures the tests instead of the
  // reviewers. Seeds recreate the PRE-DISCOVERY state, which is the state a review exists for.
  if (m.tolerance !== undefined && (!Number.isInteger(m.tolerance) || m.tolerance < 0)) {
    errors.push('tolerance, when present, must be a non-negative integer');
  }
  if (m.request !== undefined && (typeof m.request !== 'string' || !m.request.trim())) {
    errors.push('request, when present, must be a repo-relative path the seed patch creates');
  }
  if (typeof m.removes_tests !== 'boolean') {
    errors.push('removes_tests must be stated explicitly (true when the patch strips regression tests, and why)');
  }
  return errors;
}

/**
 * The line ranges a patch touches in the POST-patch file, for one path.
 *
 * `defect.line` is an absolute line number recorded when the seed was authored, and it rots the
 * moment anything above the defect grows. Nothing caught that: the corpus check verifies the patch
 * still APPLIES, and `git apply` matches by surrounding context, so a patch keeps applying happily
 * while the manifest's line drifts arbitrarily far from where it lands.
 *
 * The cost is a benchmark that lies. probe-substring-match recorded line 174; the file had grown by
 * 89 lines, the defect actually sat at 270, and code-audit reported it at exactly 270 with HIGH
 * severity — scored a MISS because 96 > tolerance. One seed of six, reported as a recall failure of
 * the lens, when the lens was precisely right and the instrument was wrong.
 *
 * Hunk headers are `@@ -old,count +new,count @@`; the `+new,count` half is the range in the file the
 * seeded worktree actually gets, which is the coordinate system defect.line has to live in.
 */
export function patchHunkRanges(patchText, file) {
  const want = String(file ?? '').replace(/\\/g, '/');
  const out = [];
  let inFile = false;
  for (const line of String(patchText ?? '').split('\n')) {
    const plus = /^\+\+\+ (?:b\/)?(.+?)\s*$/.exec(line);
    if (plus) { inFile = plus[1].replace(/\\/g, '/') === want; continue; }
    if (!inFile) continue;
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (h) {
      const start = Number(h[1]);
      const count = h[2] === undefined ? 1 : Number(h[2]);
      // A pure deletion produces count 0; the defect is then the ABSENCE at that point, so the
      // range must still contain the position rather than collapsing to nothing.
      out.push({ start, end: start + Math.max(count, 1) - 1 });
    }
  }
  return out;
}

/**
 * Where the defect IS, found by what it says rather than by a number someone wrote down.
 *
 * `defect.line` was an absolute line recorded when the seed was authored, and it rotted whenever
 * anything above the defect grew. Three seeds rotted in a single day of ordinary edits, and the
 * failure is invisible without a check: the patch still applies (git matches by context), the lens
 * still reports the defect correctly, and the benchmark scores it a MISS. It fails PESSIMISTICALLY,
 * which is the direction nobody investigates.
 *
 * An anchor is a literal string from the SEEDED file, and the line is computed at score time. There
 * is nothing left to go stale: the tree can grow arbitrarily above the defect and the anchor still
 * names the same place.
 *
 * TWO RULES, both refusals rather than guesses:
 *
 *   Zero matches means the seed no longer describes the tree — regenerate it. Falling back to a
 *   remembered line here would restore exactly the silent rot being removed.
 *
 *   More than one match is ambiguous, and picking the first would be the same positional guess the
 *   contract parser was fixed for. Lengthen the anchor until it is unique.
 *
 * A pure DELETION defect has no seeded line to quote — the defect is the absence. Anchor those on
 * the surviving line immediately above the removal: it is stable, it is in the patch's context, and
 * it is where a reviewer noticing the gap would point.
 */
export function resolveAnchor(fileText, anchor) {
  const a = String(anchor ?? '');
  if (!a.trim()) return { ok: false, why: 'defect.anchor is empty' };
  const lines = String(fileText ?? '').replace(/\r\n/g, '\n').split('\n');
  const at = [];
  for (let i = 0; i < lines.length; i++) if (lines[i].includes(a)) at.push(i + 1);

  if (!at.length) {
    return { ok: false, why: `defect.anchor is not in the seeded file: ${JSON.stringify(a.slice(0, 80))}` };
  }
  if (at.length > 1) {
    return {
      ok: false,
      why: `defect.anchor matches ${at.length} lines (${at.join(', ')}); lengthen it until it is unique`,
    };
  }
  return { ok: true, line: at[0] };
}

const norm = (p) => String(p ?? '').replace(/\\/g, '/').replace(/^\.\//, '');

/**
 * Score one seed against the findings each node kept.
 *
 * A finding hits the seed when it names the same file and lands within `tolerance` lines of the
 * seeded site. The window exists because a real reviewer cites the call site, the guard, or the
 * consequence — all near, none guaranteed to be the exact seeded line. Findings that hit no seed
 * are counted per node as false-positive CANDIDATES, not false positives: on a tree with one
 * seeded defect they are probably noise, but only adjudication can say so, and the count is named
 * accordingly rather than laundered into a precision figure it does not support.
 */
export function scoreSeed({ manifest, findingsByNode, tolerance = 15, defectLine }) {
  const file = norm(manifest.defect.file);
  // Resolved by the caller from defect.anchor against the seeded file. Passed in rather than read
  // from the manifest so there is ONE source of truth for where the defect is: a manifest that also
  // carried a line would be a second one, free to disagree, which is the drift being removed.
  const line = defectLine;
  if (!Number.isInteger(line) || line < 1) {
    throw new Error(
      `scoreSeed needs a resolved defectLine for '${manifest.id}'. Resolve defect.anchor against the ` +
      `seeded file with resolveAnchor(); scoring against a remembered line is what rotted.`);
  }

  const caughtBy = [];
  const hits = [];
  const fpCandidates = {};
  for (const [node, findings] of Object.entries(findingsByNode ?? {})) {
    let nodeHits = 0;
    for (const f of findings ?? []) {
      const sameFile = norm(f.file) === file;
      const near = Number.isInteger(f.line) && Math.abs(f.line - line) <= tolerance;
      if (sameFile && near) {
        nodeHits++;
        hits.push({ node, ...f });
      } else {
        fpCandidates[node] = (fpCandidates[node] ?? 0) + 1;
      }
    }
    if (nodeHits) caughtBy.push(node);
  }

  const expected = manifest.defect.lenses;
  return {
    seed: manifest.id,
    // The window that actually scored this seed. The artifact used to record only the CLI value
    // while a manifest's own tolerance override did the scoring, so the persisted measurement
    // could not be reproduced from its own stated parameters (G-7).
    tolerance,
    caught: caughtBy.length > 0,
    caught_by: caughtBy.sort(),
    hits,
    expected_hit: expected.filter((l) => caughtBy.includes(l)).sort(),
    expected_missed: expected.filter((l) => !caughtBy.includes(l)).sort(),
    fp_candidates: fpCandidates,
  };
}

/**
 * DID THE BARRIER KEEP WHAT THE LENSES FOUND?
 *
 * Every number this harness produced measured DETECTION and stopped there. A lens finding the
 * seeded defect scores a hit even if `reconcile` then drops the group — so a barrier that discards
 * true findings would have shown up as recall 1.0, and the corpus had no way to see it. That is the
 * one failure mode a fan-in graph is uniquely exposed to, and it went unmeasured while `reconcile`
 * took 22-34% of every pass.
 *
 * Scoreable from artifacts that already exist, which is why this needed no new corpus:
 *   evidence/reconcile/payload.json  -> group_id -> decision      (the model's schema-validated call)
 *   finding-groups.json              -> group_id -> file, line     (the mechanical anchor)
 * Joined on group_id. The PROSE report is never read, for the reason collectRun already states: a
 * report with no validated artifact behind it is precisely what must not be trusted.
 *
 * `kept` is true when at least one group anchored on the seed survived as `confirmed`. Anything
 * else — dropped, waived, filed as a symptom — means the graph found the defect and then lost it,
 * which is a worse outcome than never finding it: the gate reports clean on a tree the lenses
 * correctly flagged.
 */
export function scoreReconcile({ groupIndex, decisions, file, defectLine, tolerance = 15 }) {
  const want = norm(file);
  if (!Number.isInteger(defectLine) || defectLine < 1) {
    throw new Error('scoreReconcile needs a resolved defectLine, for the same reason scoreSeed does');
  }
  if (!decisions || !Object.keys(decisions).length) {
    return { state: 'not-reported', kept: null, anchored: [], decisions: {} };
  }
  const anchored = (groupIndex ?? [])
    .filter((g) => norm(g.file) === want
      && Number.isInteger(g.line) && Math.abs(g.line - defectLine) <= tolerance)
    .map((g) => g.group_id);
  if (!anchored.length) {
    return { state: 'no-anchored-group', kept: null, anchored: [], decisions: {} };
  }

  // WHICH DECISIONS MEAN THE DEFECT SURVIVED, from the reconcile prompt's own table rather than
  // from the word's connotation. `confirmed` is real and defensible. `symptom` is ALSO real --
  // "real, but downstream of another group" -- and reaches the gate under its root cause, so
  // scoring it as a loss would report false losses on every correctly-attributed seed. The first
  // version of this function did exactly that: `kept = decision === 'confirmed'` called
  // probe-substring-match lost when the reconciler had correctly filed it as a symptom.
  //
  // `dropped` ("not defensible") and `coincidence` ("does not survive contact with the other's
  // evidence") are losses. For a SEEDED defect both are wrong by construction: the defect is real,
  // so a barrier that judged otherwise discarded a true finding.
  //
  // A symptom is only as alive as its root cause. If root_cause_group was itself dropped, the
  // defect is gone with it, so the chain is followed -- with a visited set, because a cycle in
  // model-authored ids would otherwise hang the scorer.
  const survives = (id, seen = new Set()) => {
    if (seen.has(id)) return false;
    seen.add(id);
    const g = decisions[id];
    const d = String(g?.decision ?? '').toLowerCase();
    if (d === 'confirmed') return true;
    if (d !== 'symptom') return false;
    const root = g?.root_cause_group;
    // A symptom with no usable root cause still reached the gate as a reported group, so it counts
    // as surviving rather than being punished for the reconciler's missing pointer.
    return root ? survives(root, seen) : true;
  };

  const picked = {};
  for (const id of anchored) {
    const g = decisions[id];
    picked[id] = g ? { decision: g.decision ?? null, root_cause_group: g.root_cause_group || undefined } : null;
  }
  const kept = anchored.some((id) => survives(id));
  return { state: kept ? 'kept' : 'lost', kept, anchored, decisions: picked };
}

/**
 * Aggregate seed scores into per-lens recall. Recall for a lens counts only the seeds that lens
 * was EXPECTED to catch — blaming feature-verify for missing a logic bug in a pure function would
 * make every number meaningless. `overall` is the fraction of seeds any node caught.
 */
export function summarize(scores, costsByNode = {}) {
  const perLens = {};
  for (const s of scores) {
    for (const lens of [...s.expected_hit, ...s.expected_missed]) {
      perLens[lens] ??= { expected: 0, caught: 0 };
      perLens[lens].expected++;
      if (s.expected_hit.includes(lens)) perLens[lens].caught++;
    }
  }
  const lenses = {};
  for (const [lens, v] of Object.entries(perLens)) {
    lenses[lens] = {
      ...v,
      recall: v.expected ? Number((v.caught / v.expected).toFixed(3)) : null,
      cost_usd: costsByNode[lens] ?? null,
    };
  }
  const caught = scores.filter((s) => s.caught).length;
  return {
    seeds: scores.length,
    caught,
    overall_recall: scores.length ? Number((caught / scores.length).toFixed(3)) : null,
    lenses,
  };
}
