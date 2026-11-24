// THE ONE §8 EXEMPTION WITH NO RESOLVED PATH was the one that failed in a consumer mount.
//
// Three things a node is pointed at live OUTSIDE the reviewed tree: capture.mjs, the doctrine file,
// and find-inert-features.mjs. The brief resolved the first two -- `{{capture_rel}}` since G-24,
// `{{doctrine_path}}` since G-63 -- and left the detector as a literal
// `<framework-root>/scripts/find-inert-features.mjs` inside doc-consistency-review's contract.
//
// Meanwhile every one of those prompts carried the sentence "your brief interpolates the resolved
// path; prefer it verbatim". True of capture.mjs and the doctrine; false of the detector, which had
// no brief slot at all. An inert guarantee sitting in the instructions that tell a node how to find
// the engine -- the project's own central defect pattern, in the paragraph explaining how to avoid
// it.
//
// It stayed free in this repository because `<framework-root>` and the repository root coincide
// here. panel-codex-docs is where it came due: in the story-pipeline mount the arm reported the
// detector "absent", which was true of the empty submodule directory and would have been the arm's
// problem regardless, since nothing told it where to look.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from './helpers.mjs';

const read = (...p) => fs.readFileSync(path.join(REPO_ROOT, ...p), 'utf8');

test('regression: every §8 exemption reaches the node as a RESOLVED path', () => {
  const brief = read('prompts', '_templates', 'run-brief.md');
  for (const slot of ['{{capture_rel}}', '{{detector_abs}}', '{{doctrine_path}}']) {
    assert.ok(brief.includes(slot), `the brief must interpolate ${slot}, or the prompts lie about it`);
  }
  // And the orchestrator must FILL it. A slot nothing populates renders as the literal braces and
  // is worse than the placeholder it replaced.
  const graph = read('scripts', 'run-graph.mjs');
  assert.match(graph, /detector_abs: briefHead\(path\.join\(scriptsDir, 'find-inert-features\.mjs'\)/,
    'resolved from the framework scripts dir, which is the location capture derives its own copy from');
});

// RESOLVED IS NOT THE SAME AS RUNNABLE (G-3). The slot above was filled, with a relative path, and
// capture.mjs admits the detector ONLY as an absolute one — on purpose, because a relative spelling
// resolves against the spawn's working directory and once let a file inside the REVIEWED tree run
// through the evidence channel. So the brief ordered a command, told the node to run it verbatim and
// through capture, and capture refused it at the allow-list. The test above passed throughout: it
// asked whether the path was resolved, never whether the resolved value would be accepted.
//
// Asked of capture ITSELF here, by making it print its own permitted list. Nothing is mirrored: add
// or remove a spelling in capture.mjs and this follows.
test('regression: the detector path the brief hands out is one capture.mjs actually admits', () => {
  // INSIDE THE REPOSITORY, because capture refuses a run directory outside it before it ever looks
  // at the command — the containment check that exists so a counterfeit run.json cannot redirect
  // evidence. A tmpdir run directory tests the refusal, not the allow-list.
  const id = `20260101-000000-g3probe${process.pid}`;
  const runDir = path.join(REPO_ROOT, '.claude', 'reviews', id);
  try {
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({
      run_id: id, repo_root: REPO_ROOT, contract: { commands: {} }, stamps: [], host: { cwd: REPO_ROOT },
    }));
    // Refused on purpose: the refusal is what prints the permitted list, and it costs nothing.
    const r = spawnSync(process.execPath, [
      path.join(REPO_ROOT, 'scripts', 'capture.mjs'),
      '--run-dir', runDir, '--node', 'code-audit', '--name', 'probe',
      '--', 'node', 'definitely-not-permitted.mjs',
    ], { encoding: 'utf8', cwd: REPO_ROOT });
    const permitted = /Permitted starts: (.*)/.exec(r.stderr ?? '')?.[1];
    assert.ok(permitted, `capture must name what it permits; got:\n${(r.stderr ?? '').slice(-500)}`);

    // The value the orchestrator interpolates, computed the way it computes it.
    const detectorAbs = path.join(REPO_ROOT, 'scripts', 'find-inert-features.mjs')
      .split(path.sep).join('/');
    assert.ok(permitted.includes(`node ${detectorAbs}`),
      `the brief orders \`node ${detectorAbs}\` and capture permits only:\n  ${permitted}\n`
      + 'a mandatory sweep spelled a way the evidence channel refuses produces no artifact at all');

    // And the relative spelling — what the brief used to hand out — must still be refused, or the
    // fix would have been to widen the allow-list, which is the thing that was dangerous.
    assert.ok(!permitted.includes('node scripts/find-inert-features.mjs'),
      'a relative detector path resolves against the working directory; widening capture to accept '
      + 'one would let the reviewed tree supply the script that runs');
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});

// THE OTHER GATE, which is a different mechanism and was also shut. capture.mjs is reachable because
// the node policy grants `Bash(node scripts/capture.mjs:*)`; there is no grant for the detector, so a
// node running the sweep BARE is denied by the runtime before capture is ever consulted. The brief
// now shows the wrapped form for that reason, not only for the evidence path.
test('regression: the brief runs the detector THROUGH capture, the one command the policy grants', () => {
  const brief = read('prompts', '_templates', 'run-brief.md');
  const line = brief.split('\n').find((l) => l.includes('{{detector_abs}}'));
  assert.ok(line, 'the detector line must exist');
  assert.match(line, /node \{\{capture_rel\}\}.*-- node \{\{detector_abs\}\}/,
    'the only Bash grant a node gets is capture.mjs; a bare detector invocation is denied by the '
    + 'permission policy, so the brief must not show one');
});

test('regression: no prompt hands a node a framework path it has to guess', () => {
  // The detector's contract is the one that ORDERS a node to run it, so it is the one that must not
  // carry a literal. The parenthetical explaining why may name `<framework-root>` -- prose about a
  // placeholder is not an instruction to use one -- but the runnable block may not.
  const lens = read('prompts', 'doc-consistency-review', 'PROMPT.md');
  const fenced = [...lens.matchAll(/```[\s\S]*?```/g)].map((m) => m[0]).join('\n');
  assert.ok(!/<framework-root>/.test(fenced),
    'a runnable block naming <framework-root> is a path the node must guess, and guessing got ENOENT');
  // Whitespace-tolerant, because this is prose in a wrapped markdown file and the phrase happens to
  // straddle a line break. An exact substring test over hand-wrapped text asserts the wrapping.
  assert.match(lens.replace(/\s+/g, ' '), /path already resolved for this mount/,
    'and it must point the node at the brief, which is where the resolved path is');
});
