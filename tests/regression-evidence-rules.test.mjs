// regression-evidence-rules.test.mjs — remediation-evidence-rules.plan.md (design E-D1, E-D2, E-D3).
//
// The runner's evidence gate refused, in four of five remediations running, fixes it does not count as shown. Each case
// here is a real refused report, kept as a fixture under tests/fixtures/remediation-evidence/<case>/ by
// tests/tools/build-remediation-evidence-fixture.mjs: the payload groups involved and each cited capture's header.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { admitGroups, planClusterCommits } from '../scripts/lib/remediation-chain.mjs';
import { captureFacts } from '../scripts/io/capture-facts.mjs';

const CONTRACT = { source_globs: ['scripts/**', 'shared/**', 'skills/**', 'prompts/**'], test_globs: ['tests/**', '**/*.test.mjs'] };

function load(name) {
  const dir = path.join(REPO_ROOT, 'tests', 'fixtures', 'remediation-evidence', name);
  const c = JSON.parse(fs.readFileSync(path.join(dir, 'case.json'), 'utf8'));
  const cited = c.groups.flatMap((g) => [g.red_evidence, g.green_evidence]).flatMap((f) => String(f ?? '').split(';'))
    .map((s) => s.trim()).filter(Boolean);
  return { ...c, evidence: captureFacts(dir, cited) };
}

/** Admission then planning, as remediate.mjs runs them, with every reported file changed in git. */
function run(c, groups = c.groups) {
  const files = [...new Set(groups.flatMap((g) => g.files ?? []))];
  const ctx = { confirmed: c.confirmed, symptoms: c.symptoms, evidence: c.evidence, contract: CONTRACT, caseInsensitive: false };
  const { plannable, checks } = admitGroups({ groups, ...ctx });
  const clusters = planClusterCommits({ groups: plannable, status: { files, refused: [] }, ...ctx, reviewedFiles: c.reviewed_files });
  return { plannable, checks, clusters };
}

// E-D3: G-15 is a symptom of G-9 (the reconciler's decision) fixed in G-9's cluster; its red and green are G-9's, of a
// test file only G-9's group commits. It was refused (`evidence-refused`), and G-9, G-10 and G-16 with it.
test('E-D3: a symptom fixed in its root\'s cluster is admitted on its root\'s red and green (ciss-d1-4)', () => {
  const c = load('ciss-d1-4-symptom');
  const { checks, clusters } = run(c);
  assert.deepEqual(checks.filter((x) => x.kind !== 'deferred-file'), [], 'a group was refused');
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].committable, true, clusters[0].notes.join('; '));
  assert.deepEqual([...clusters[0].groups].sort(), ['G-10', 'G-15', 'G-16', 'G-9']);
});

test('E-D3: a symptom whose root is not reported is still refused, and a group that is no symptom keeps today\'s rule', () => {
  const c = load('ciss-d1-4-symptom');
  const noRoot = run(c, c.groups.filter((g) => g.group_id !== 'G-9'));
  assert.ok(noRoot.checks.some((x) => x.group === 'G-15'), 'G-15 was admitted without its root');
  // Its own cluster, apart from its root, with the root's red: the red cites a test this group does not commit.
  const apart = c.groups.map((g) => (g.group_id === 'G-15' ? { ...g, cluster: 'c9' } : g));
  const r = run({ ...c, symptoms: {}, confirmed: [...c.confirmed, 'G-15'] }, apart);
  assert.ok(r.checks.some((x) => x.group === 'G-15' && x.kind === 'evidence-refused'), 'a non-symptom citing another group\'s test was admitted');
});

test('E-D3: a symptom with no red of its own, in its root\'s cluster with the root\'s red, is not "red-before-green skipped"', () => {
  const c = load('ciss-d1-4-symptom');
  const groups = c.groups.map((g) => (g.group_id === 'G-15' ? { ...g, red_evidence: '', green_evidence: '' } : g));
  const { clusters } = run(c, groups);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].committable, true, clusters[0].notes.join('; '));
  // A group with no red that is not a symptom still is.
  const plain = run({ ...c, symptoms: {}, confirmed: [...c.confirmed, 'G-15'] }, groups);
  assert.match(plain.clusters[0].notes.join('; '), /red-before-green skipped: G-15/);
});

// E-D2: rdt-remediation-2's c1 held G-9, G-11, G-13 and G-6 with no red (a read the adoption test cannot see; a race
// between two reads), in a cluster with the adoption test, and was refused as "red-before-green skipped". With each
// declaration of why no test can fail first, the cluster is planned, and the declarations travel with it.
const NO_RED = {
  'G-9': 'the adoption test cannot see an artifact read other than run.json',
  'G-11': 'the adoption test\'s .dir rule was already satisfied at the cited line',
  'G-13': 'as G-11',
  'G-6': 'a race between two reads, not drivable offline',
};
test('E-D2: a fix declared to have no possible red is admitted in a cluster with a test, its reason recorded (rdt-remediation-2 c1)', () => {
  const c = load('rdt-2-no-red');
  const bare = run(c);
  assert.equal(bare.clusters.length, 1);
  assert.match(bare.clusters[0].notes.join('; '), /red-before-green skipped/, 'the fixture no longer reproduces the refusal');
  assert.equal(bare.clusters[0].committable, false);
  const declared = c.groups.map((g) => (NO_RED[g.group_id] ? { ...g, no_red: NO_RED[g.group_id] } : g));
  const { clusters } = run(c, declared);
  assert.equal(clusters[0].committable, true, clusters[0].notes.join('; '));
  assert.deepEqual(clusters[0].declared_no_red.map((d) => d.group).sort(), ['G-11', 'G-13', 'G-6', 'G-9']);
});

test('E-D2: an empty red with no declaration, a blank one, or one from before the field is still a skipped red', () => {
  const c = load('rdt-2-no-red');
  for (const no_red of [null, '', '   ', undefined]) {
    const groups = c.groups.map((g) => (NO_RED[g.group_id] ? { ...g, no_red } : g));
    assert.match(run(c, groups).clusters[0].notes.join('; '), /red-before-green skipped/, `no_red ${JSON.stringify(no_red)} was taken as a declaration`);
  }
  emptyRedWithNoTestIsSkipped();   // G-1, G-4 of 20261023-062611-rer-remediation-review-2
});

test('E-D2: a red beside a no_red declaration is named by the report check', async () => {
  const { stopReasonChecks } = await import('../scripts/lib/remediation-chain.mjs');
  const lines = stopReasonChecks([{ group_id: 'G-1', disposition: 'fixed', red_evidence: 'evidence/remediation/r.log', no_red: 'why' }]);
  assert.ok(lines.some((l) => /G-1: a red and a no_red declaration/.test(l)), lines.join('\n'));
});

// G-1 of 20261023-062611-rer-remediation-review-2: the skipped-red refusal was computed only for a cluster with a test,
// so a source-only cluster whose group had an empty red and no `no_red` committed as "not expressible as a test".
// Run inside the E-D2 test below, so the suite's count, which CLAUDE.md states, is unchanged.
function emptyRedWithNoTestIsSkipped() {
  const plan = (extra) => planClusterCommits({
    groups: [{ group_id: 'G-1', disposition: 'fixed', red_evidence: '', green_evidence: '', cluster: 'c1', files: ['scripts/x.mjs'], ...extra }],
    status: { files: ['scripts/x.mjs'], refused: [] }, contract: CONTRACT, confirmed: ['G-1'], symptoms: {}, caseInsensitive: false,
  })[0];
  for (const no_red of [null, '', '  ', undefined]) {
    const c = plan({ no_red });
    assert.equal(c.committable, false, `no_red ${JSON.stringify(no_red)} committed a source-only cluster with no red: ${c.notes.join('; ')}`);
    assert.match(c.notes.join('; '), /red-before-green skipped: G-1/);
  }
  const ok = plan({ no_red: 'a static change no test can observe' });
  assert.equal(ok.committable, true, ok.notes.join('; '));
  assert.deepEqual(ok.declared_no_red.map((d) => d.group), ['G-1']);
  // G-4 of the same review: the runner read committed-without-test off this note's wording; the plan states it as a field.
  assert.equal(ok.without_test, true, 'the plan does not state that the cluster commits without a test');
  assert.equal(plan({ no_red: null }).without_test, false, 'a refused cluster is stated to commit without a test');
}

// E-D1: rdt-remediation-2's c3 fixed seven findings about tests (silent returns), each reported against a test file, with
// reds from a whole-suite check; it changed tests only and was refused as "not a fix".
test('E-D1: a cluster changing tests only is a fix when every group in it was reported against a test file (rdt-remediation-2 c3)', () => {
  const c = load('rdt-2-test-only');
  const { clusters } = run(c);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].committable, true, clusters[0].notes.join('; '));
  assert.ok(clusters[0].notes.some((n) => /a fix to tests only/.test(n)));
});

test('E-D1: a test-only cluster with a group reported against a source file, or with the reviewed files unknown, is still not a fix', () => {
  const c = load('rdt-2-test-only');
  for (const reviewed of [{ ...c.reviewed_files, 'G-18': 'scripts/capture.mjs' }, {}]) {
    const { clusters } = run({ ...c, reviewed_files: reviewed });
    assert.equal(clusters[0].committable, false);
    assert.match(clusters[0].notes.join('; '), /so it is not a fix/);
  }
});

// Stage 4: the rules are stated where the node and a reader find them, and the new commit-check kind is documented.
test('the prompt, the doctrine and the contract document state the three rules and the declared-no-red kind', async () => {
  const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8').replace(/\s+/g, ' ');
  const prompt = read('prompts/remediation/PROMPT.md');
  const doctrine = read('shared/remediation.md');
  for (const [where, text] of [['PROMPT.md', prompt], ['shared/remediation.md', doctrine]]) {
    assert.match(text, /finding about a test/i, `${where}: the test-finding rule`);
    assert.match(text, /symptom/i, `${where}: the symptom rule`);
    assert.match(text, /`no_red`/, `${where}: the no_red declaration`);
  }
  assert.match(doctrine, /## What a fix must show/);
  const { COMMIT_CHECK_KINDS } = await import('../scripts/lib/remediation-chain.mjs');
  assert.ok(COMMIT_CHECK_KINDS['declared-no-red'] && COMMIT_CHECK_KINDS['declared-no-red'].stamps === false);
  assert.match(read('shared/claude-md-contract.md'), /`declared-no-red`/);
  const schema = read('prompts/_templates/schema-fields.json');
  assert.match(schema, /"remediation_no_red"/);
  // G-16, G-14, G-1, G-18 of 20261023-044746-rer-delivery: the keywords above passed while the skill, both protocol rows
  // and the model-facing red_evidence description still stated the old rule — an empty red commits only without a test,
  // and its reason goes in `reason`. Each is held to the new one, and the procedures, not only their names (I-7).
  const skill = read('skills/remediate/SKILL.md');
  assert.doesNotMatch(skill, /commits only in a cluster with no test file/, 'the skill still says a red-less claim commits only without a test');
  // G-12/G-11/G-9 of 20261023-062611-rer-remediation-review-2: one exact phrase passed while other spellings of the old
  // rule stayed (SKILL.md:77, the COMMIT-CHECK row). Any statement that a red-less group is refused BECAUSE a test is
  // present, or that a no-test cluster commits because its claims were "not expressible", is the old rule.
  for (const [p, t] of [['skills/remediate/SKILL.md', skill], ...['shared/disk-first-protocol.md', 'shared/claude-md-contract.md', 'prompts/_templates/stamp-consequences.json'].map((q) => [q, read(q)])]) {
    assert.doesNotMatch(t, /a cluster with a test and a group with no red is refused/, `${p} still refuses any red-less group beside a test`);
    assert.doesNotMatch(t, /test file (committed )?beside a group with no red/, `${p} still ties the skipped red to a test file`);
    assert.doesNotMatch(t, /in a cluster that commits a test refuses that cluster/, `${p} still ties the skipped red to a test file`);
    assert.doesNotMatch(t, /no test because its claims were reported not expressible/, `${p} still commits a no-test cluster on "not expressible"`);
  }
  // The skill points at the rule's owner rather than restating it (evidence-rules-text-owner.plan.md stage 2; T-D1 A).
  assert.match(skill, /`no_red`[^.]*`shared\/remediation\.md`/, 'the skill does not point at the owner of the no_red rule');
  assert.doesNotMatch(skill, /admitted in any cluster/, 'the skill restates the no_red rule instead of pointing at its owner');
  // Read through the loader, which fills the rule slot: the raw table's `{{rule_no_red}}` would satisfy /no_red/ alone.
  const { hostPlatform } = await import('../scripts/platform/index.mjs');
  const { schemaField } = await import('../scripts/lib/review-prompts.mjs');
  const red = schemaField('remediation_red_evidence', hostPlatform());
  assert.doesNotMatch(red, /then reason says/, 'red_evidence still sends the explanation to reason');
  assert.match(red, /no_red/, 'red_evidence does not name no_red');
  assert.match(red, /symptom/i, 'red_evidence does not name the symptom shown by its root');
  const rows = fs.readFileSync(path.join(REPO_ROOT, 'shared/disk-first-protocol.md'), 'utf8').split('\n');
  for (const name of ['REPORT-CHECK', 'COMMIT-CHECK']) {
    const row = rows.find((l) => l.startsWith(`| \`${name}\` |`));
    assert.match(row, /no red and no `no_red`/, `the ${name} row refuses any red-less group beside a test`);
    assert.match(row, /symptom shown by its root/, `the ${name} row omits the symptom exception`);
  }
  for (const p of ['prompts/remediation/PROMPT.md', 'shared/remediation.md']) {
    const t = read(p);
    assert.match(t, /strengthened check run against the OLD test|strengthened check run against the old test/, `${p}: the strengthened-old-test red`);
    assert.match(t, /`no_red`[^.]*before-state/, `${p}: a no_red declaration names its before-state`);
  }
});

// evidence-rules-text-owner.plan.md stage 1 (T-D1 A; G-1, G-11 of 20261023-081135-rer-remediation-3-review): stage 4 of
// remediation-evidence-rules missed two places that restate the shapes. Both are now held to their owners, not to one
// word each: every kind the runner records, and every field the remediation schema requires.
test('every COMMIT_CHECK_KINDS kind is named in the COMMIT-CHECK consequence and the contract document', async () => {
  const { COMMIT_CHECK_KINDS } = await import('../scripts/lib/remediation-chain.mjs');
  const consequence = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'prompts/_templates/stamp-consequences.json'), 'utf8'))['COMMIT-CHECK'];
  const contract = fs.readFileSync(path.join(REPO_ROOT, 'shared/claude-md-contract.md'), 'utf8');
  const missing = Object.keys(COMMIT_CHECK_KINDS).flatMap((k) => [
    ...(consequence.includes(k) ? [] : [`COMMIT-CHECK consequence: ${k}`]),
    ...(contract.includes(`\`${k}\``) ? [] : [`shared/claude-md-contract.md: ${k}`]),
  ]);
  assert.deepEqual(missing, []);
  assert.match(consequence, /declared-no-red[^.]*does not stamp/, 'the consequence says declared-no-red does not stamp');
});

test('the contract document\'s remediation payload shape names every field the schema requires', async () => {
  const { CENSUS_FIELDS } = await import('../scripts/lib/census.mjs');
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts/spawn-node.mjs'), 'utf8');
  const block = src.slice(src.indexOf("if (variant === 'remediation')"));
  const required = block.match(/required: \['group_id',([^\]]*)\]/)[1];
  const fields = ['group_id', ...required.split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter((s) => s && !s.startsWith('...')),
    ...(required.includes('...CENSUS_FIELDS') ? CENSUS_FIELDS : [])];
  assert.ok(fields.includes('no_red') && fields.length > 10, `the schema's required fields were not read: ${fields}`);
  const row = fs.readFileSync(path.join(REPO_ROOT, 'shared/claude-md-contract.md'), 'utf8').split('\n')
    .find((l) => l.startsWith('| `remediation/PROMPT.md` |')) ?? '';
  const shape = (row.match(/`\{group_id[^`]*\}`/) ?? [''])[0];
  assert.deepEqual(fields.filter((f) => !new RegExp(`\\b${f}\\b`).test(shape)), [], `the payload shape: ${shape}`);
});

// evidence-rules-text-owner.plan.md stage 2 (T-D1 A; G-14 with G-12 of 20261023-081135-rer-remediation-3-review): the
// no-red rule was restated in at least five places, and shared/remediation.md claimed its rules were restated nowhere.
// One template owns the model-facing text: a gen-rule-text region in the prompt and in shared/remediation.md, a
// {{rule_no_red}} slot filled at load in the two JSON tables a model reads; the other documents point at the owner.
test('stage 2: every reader of the no-red rule gets the template\'s one text, with no slot left', async () => {
  const { hostPlatform } = await import('../scripts/platform/index.mjs');
  const { RULES } = await import('../scripts/lib/rule-text.mjs');
  const { stampConsequence } = await import('../scripts/lib/stamp-notes.mjs');
  const { schemaField } = await import('../scripts/lib/review-prompts.mjs');
  assert.ok(RULES['no-red'], 'the no-red rule is not registered');
  const io = hostPlatform();
  const rule = fs.readFileSync(path.join(REPO_ROOT, 'prompts/_templates/rule-no-red.md'), 'utf8').trim();
  const readers = {
    'COMMIT-CHECK': stampConsequence('COMMIT-CHECK', io),
    'COMMIT-CHECK-FAILED': stampConsequence('COMMIT-CHECK-FAILED', io),
    remediation_red_evidence: schemaField('remediation_red_evidence', io),
    remediation_no_red: schemaField('remediation_no_red', io),
  };
  for (const [k, text] of Object.entries(readers)) {
    assert.ok(text.includes(rule), `${k} does not carry the rule's text`);
    assert.doesNotMatch(text, /\{\{rule_/, `${k} left a slot unfilled`);
  }
  const prompt = fs.readFileSync(path.join(REPO_ROOT, 'prompts/remediation/PROMPT.md'), 'utf8');
  const owner = fs.readFileSync(path.join(REPO_ROOT, 'shared/remediation.md'), 'utf8');
  for (const [f, t] of [['PROMPT.md', prompt], ['shared/remediation.md', owner]]) {
    assert.match(t, /<!-- rule:no-red -->/, `${f} carries no rule:no-red region`);
  }
  // G-11 of 20261023-205906-ger-delivery: ruleTable had a substitution grammar of its own, and a `{{slot}}` outside its
  // `rule_*` shape reached the model unfilled. It now fills through lib/template.mjs, which throws on any unfilled slot.
  const { ruleTable } = await import('../scripts/lib/rule-text.mjs');
  // lstatSync too: a template is read through the egress owner, which checks the planted file is a plain file with one name
  // (G-10 of 20261112-054852-hl-remediation-3-review).
  const plantedStat = { isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false, nlink: 1, size: 0 };
  // No descriptor reads (G-9 of 20261112-154323-hl-review-c): the planted file is served by readFileSync alone, so the
  // owner's whole-file read is the one it takes.
  const planted = { ...io, fs: { ...io.fs, openSync: undefined, readSync: undefined, lstatSync: (p, o) => (String(p).endsWith('qplanted.json') ? plantedStat : io.fs.lstatSync(p, o)),
    readFileSync: (p, e) => (String(p).endsWith('qplanted.json')
    ? JSON.stringify({ a: 'x {{other_slot}} y', b: '{{rule_no_red}}' }) : io.fs.readFileSync(p, e)) } };
  assert.throws(() => ruleTable('qplanted.json', planted), /other_slot/, 'an unfilled non-rule slot reached the table');
});

test('stage 2: no restatement of the no-red rule outside its regions and slots, across the tree', async () => {
  const { execFileSync } = await import('node:child_process');
  const out = execFileSync(process.execPath, [path.join(REPO_ROOT, 'scripts/gen-rule-text.mjs'), '--check'],
    { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.match(out, /0 stale region\(s\), 0 restatement\(s\)/, out);
  const { restatementsIn } = await import('../scripts/lib/rule-text.mjs');
  const planted = restatementsIn('An empty red with no reason is a skipped red.\n', 'shared/other.md');
  assert.ok(planted.some((r) => r.id === 'no-red'), 'a planted restatement is not named');
});
