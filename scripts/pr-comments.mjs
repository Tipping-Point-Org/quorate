#!/usr/bin/env node
// pr-comments.mjs — a finished review's confirmed findings, posted to a pull request as one GitHub review
// (.claude/requests/pr-review-comments.md).
//
//   node <framework-root>/scripts/pr-comments.mjs --run-dir <run> --pr <number> [--post] [--repo-root <dir>]
//
// An explicit command, run after the review and never by it: the run must have gated. Without --post it prints exactly
// what it would post and sends nothing; --post sends that same review. The pull request, its repository and the GitHub
// credentials are gh's (quorate holds none). Refused, with why, when the run's tree was dirty or not known clean, or when
// the pull request's head is not the commit the run reviewed.
//
// Exit codes: 0 printed, or posted · 1 gh failed · 2 refused, or usage.
import path from 'node:path';
import { parseArgv, ArgvError } from './lib/argv.mjs';
import { ARGV_SPECS } from './lib/argv-specs.mjs';
import { admitRun, callerRepoRoot } from './io/reviews-root.mjs';
import { egressRunReader } from './io/egress-read.mjs';
import { readReconcileArtifacts } from './io/run-artifacts.mjs';
import { buildReview, postRefusal } from './lib/pr-comments.mjs';
import { gh } from './io/gh.mjs';

const die = (msg, code = 2) => { console.error(`pr-comments: ${msg}`); process.exit(code); };

let v;
try { ({ values: v } = parseArgv(process.argv.slice(2), ARGV_SPECS['pr-comments'])); } catch (e) { if (e instanceof ArgvError) die(e.message); throw e; }
if (!v['run-dir']) die('--run-dir <run> is required: the finished review whose findings to post');
if (!/^[1-9]\d*$/.test(String(v.pr ?? ''))) die('--pr <number> is required: the pull request to post to');
const repoRoot = callerRepoRoot(v['repo-root']);
const ghBin = v['gh-bin'] ?? null;

// THE RUN, ADMITTED AND READ THROUGH ITS OWNER, as the ledger fold reads one: one of this repository's runs, a link at any
// level refused. ITS FILES THROUGH THE EGRESS OWNER (G-8 of 20261121-001829-prc-remediation-review): what they hold is
// posted to GitHub, and the run owner cannot see a hard link, so a file with a second name (content from outside the
// run) is refused here, as every other run file bound for a vendor is (io/egress-read.mjs egressRunReader).
const admitted = admitRun({ runDir: path.resolve(v['run-dir']), repoRoot });
if (!admitted.ok) die(admitted.why);
const owner = egressRunReader(admitted.dir);
let gate = null;
try { gate = JSON.parse(owner.read(['gate.json'])); } catch (e) {
  if (e.code !== 'ENOENT') die(`gate.json cannot be read (${e.message})`);
}
const before = postRefusal({ gated: gate !== null, record: admitted.record, prHead: admitted.record.head_commit });
if (before) die(before);
const artifacts = readReconcileArtifacts(owner);
for (const [what, why] of Object.entries(artifacts.refused)) die(`${what} refused: ${why}`);
if (artifacts.groups && !artifacts.payload) die('the run formed finding groups but has no reconcile payload, so its confirmed set is unknown');

// GH: present, logged in, and the pull request's head is the commit the run reviewed.
const call = (args, opts = {}) => gh(args, { bin: ghBin, cwd: repoRoot, ...opts });
const auth = call(['auth', 'status']);
if (auth.missing) die('gh is not installed or not on PATH: install the GitHub CLI and run `gh auth login`');
if (!auth.ok) die(`gh is not logged in (${auth.stderr.trim().split('\n')[0] || `exit ${auth.status}`}): run \`gh auth login\``);
const view = call(['pr', 'view', String(v.pr), '--json', 'headRefOid,url']);
if (!view.ok) die(`gh pr view ${v.pr} failed: ${view.stderr.trim().split('\n')[0]}`, 1);
let pr;
try { pr = JSON.parse(view.stdout); } catch { die(`gh pr view ${v.pr} did not answer JSON`, 1); }
const mismatch = postRefusal({ gated: true, record: admitted.record, prHead: pr.headRefOid });
if (mismatch) die(mismatch);
const repo = call(['repo', 'view', '--json', 'nameWithOwner']);
if (!repo.ok) die(`gh repo view failed: ${repo.stderr.trim().split('\n')[0]}`, 1);
let slug;
try { slug = JSON.parse(repo.stdout).nameWithOwner; } catch { die('gh repo view did not answer JSON', 1); }
// One JSON object per line (--jq '.[]'), so --paginate's pages join without a slurp.
const list = call(['api', `repos/${slug}/pulls/${v.pr}/files`, '--paginate', '--jq', '.[] | {filename, patch}']);
if (!list.ok) die(`gh api .../pulls/${v.pr}/files failed: ${list.stderr.trim().split('\n')[0]}`, 1);
let files;
try { files = list.stdout.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)); } catch { die('the pull request\'s file list was not JSON lines', 1); }

const review = buildReview({
  runId: admitted.record.run_id, gate, payload: artifacts.payload, groups: artifacts.groups, files, commitId: pr.headRefOid,
});
const { placed, unplaced, ...body } = review;
if (!v.post) {
  console.log(JSON.stringify(body, null, 2));
  console.log(`pr-comments: dry run: ${placed.length} inline comment(s), ${unplaced.length} in the summary, for ${pr.url}; nothing was sent (pass --post to send)`);
  process.exit(0);
}
const sent = call(['api', `repos/${slug}/pulls/${v.pr}/reviews`, '--method', 'POST', '--input', '-'], { input: JSON.stringify(body) });
if (!sent.ok) die(`posting the review failed: ${sent.stderr.trim().split('\n')[0]}`, 1);
let url = pr.url;
try { url = JSON.parse(sent.stdout).html_url ?? url; } catch { /* the review was posted; its address is the pull request's */ }
console.log(`pr-comments: posted ${placed.length} inline comment(s) and a summary with ${unplaced.length} more: ${url}`);
