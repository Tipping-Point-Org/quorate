// .claude/requests/observation-guard-and-sibling-census.md, part B. story-pipeline's follow-up review found 4 of 5 fixes
// too narrow: each had a red-then-green test written from the same reading as the fix, the remediation recorded only the
// search COMMAND, and the follow-up review never saw it (.claude/findings/2026-10-15-evidence-gate-under-reach.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as census from '../scripts/lib/census.mjs';
import * as prompts from '../scripts/io/review-prompts.mjs';

const SRC = (rel) => fs.readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const FIELDS = ['search_sites', 'not_in_class', 'unmatched_spellings'];
// The renderer is the prompt library's (G-3 of 20261017-031552-ogsc-review), bound to the host there.
const censusSection = (opts) => prompts.censusSection(opts);
const remediationBlock = () => {
  const src = SRC('scripts/spawn-node.mjs');
  return src.slice(src.indexOf("variant === 'remediation'"), src.indexOf("variant === 'reconcile'"));
};

test('AC4: the remediation schema requires the three census fields, each described', () => {
  const block = remediationBlock();
  const required = block.match(/required: \[([^\]]*'group_id'[^\]]*)\]/)?.[1] ?? '';
  assert.match(required, /\.\.\.CENSUS_FIELDS/, 'the census fields are not required of a group');
  assert.deepEqual(census.CENSUS_FIELDS, FIELDS);
  // The properties are built from CENSUS_ITEMS (G-4 of 20261017-040138-ogsc-remediation-review), so each needs a shape.
  for (const f of FIELDS) assert.ok(census.CENSUS_ITEMS[f], `${f} has no property`);
  assert.match(block, /CENSUS_FIELDS\.map\(\(f\) => \[f,\s*\{ type: 'array', items: CENSUS_ITEMS\[f\]/, 'the census properties are not built');
  const described = JSON.parse(SRC('prompts/_templates/schema-fields.json'));
  for (const f of FIELDS) assert.ok(described[`remediation_${f}`], `remediation_${f} has no description`);
});

// G-2 of 20261017-031552-ogsc-review: the schema and the follow-up renderer each spelled the three names, so they could
// drift and a valid report would be labelled "no census". One definition, in lib, used by both.
test('G-2: the schema takes the census field names from the one definition the renderer uses', () => {
  const required = remediationBlock().match(/required: \[([^\]]*'group_id'[^\]]*)\]/)?.[1] ?? '';
  for (const f of FIELDS) assert.doesNotMatch(required, new RegExp(`'${f}'`), `${f} is spelled again in the schema`);
  assert.match(SRC('scripts/spawn-node.mjs'), /import \{[^}]*\bCENSUS_FIELDS\b[^}]*\} from '\.\/lib\/census\.mjs'/);
  // From a leaf: spawn-node is code the reviewer probe loads, so whatever it imports joins the probe's key.
  assert.doesNotMatch(SRC('scripts/lib/census.mjs'), /^import /m, 'the census names pull a module into the probe key');
});

// G-6 of 20261017-031552-ogsc-review: `{ site: "", reason: "" }` validated, and so did an empty spelling or reason.
test('G-6: a census entry and a group reason cannot be empty strings', () => {
  const block = remediationBlock();
  // The census item shapes moved into lib/census (G-4 of 20261017-040138-ogsc-remediation-review); read them there.
  const nonEmpty = { type: 'string', minLength: 1 };
  const nic = census.CENSUS_ITEMS.not_in_class;
  assert.deepEqual(nic.required, ['site', 'reason']);
  assert.deepEqual(nic.properties.site, nonEmpty, 'not_in_class.site accepts ""');
  assert.deepEqual(nic.properties.reason, nonEmpty, 'not_in_class.reason accepts ""');
  assert.deepEqual(census.CENSUS_ITEMS.search_sites, nonEmpty, 'a search site may be ""');
  assert.deepEqual(census.CENSUS_ITEMS.unmatched_spellings, nonEmpty, 'a spelling may be ""');
  assert.match(block, /\n\s*reason: nonEmpty,/, 'a group reason may be "", so an empty unmatched_spellings says nothing');
  assert.match(block, /const nonEmpty = \{ type: 'string', minLength: 1 \}/);
});

// G-3 of 20261017-031552-ogsc-review: model-facing sentences were built in scripts/lib/remediation-chain.mjs, outside
// the prompt library that owns every sentence a model reads (ARCHITECTURE.md §2).
test('G-3: the census section\'s sentences live in prompts/_templates, not in the decision module', () => {
  const lib = SRC('scripts/lib/remediation-chain.mjs');
  assert.doesNotMatch(lib, /Judge whether the fix reaches/, 'the instruction is still built in lib');
  assert.doesNotMatch(lib, /the remediation predates it/, 'the row sentence is still built in lib');
  assert.doesNotMatch(lib, /export function censusSection/, 'the renderer is still in the decision module');
  assert.match(SRC('prompts/_templates/remediation-census.md'), /Judge whether the fix reaches every site/);
  assert.match(SRC('prompts/_templates/remediation-census-unreadable.md'), /not_checked/);
  assert.match(SRC('prompts/_templates/remediation-census-row-none.md'), /predates/);
});

// G-4 of 20261017-031552-ogsc-review: the loader joined follows_remediation.run_dir straight to the payload and never
// checked run_id, so a moved run lost its census and a reused directory showed another remediation's.
test('G-4: the census loader follows the link by its run_id, through resolveLinkedRun', () => {
  const rg = SRC('scripts/run-graph.mjs');
  const loader = rg.slice(rg.indexOf('const REMEDIATION_CENSUS'), rg.indexOf('function writeBrief'));
  assert.ok(loader.length > 0, 'no census loader found');
  assert.match(loader, /resolveLinkedRun\(\{[^}]*runId: follows\.run_id/, 'the link is not resolved by its run_id');
  assert.doesNotMatch(loader, /path\.join\(follows\.run_dir/, 'the recorded path is still read directly');
});

// G-5 of 20261017-031552-ogsc-review: the payload was named relative to the repository, while a staged run lives outside
// it and a lens can read only the repository and its own run. The loader copies it into this run's evidence.
test('G-5: the census names a copy of the payload inside this run, which a lens can read', () => {
  const rg = SRC('scripts/run-graph.mjs');
  const loader = rg.slice(rg.indexOf('const REMEDIATION_CENSUS'), rg.indexOf('function writeBrief'));
  assert.doesNotMatch(loader, /path\.relative\(repoRoot, payloadPath\)/, 'the payload is still named from the repository');
  assert.match(loader, /path\.join\(runDir, 'evidence', 'remediation-census', 'payload\.json'\)/);
  const s = censusSection({ followsRemediation: follows, payloadPath: '/run/evidence/remediation-census/payload.json',
    payload: { groups: [] } });
  assert.ok(s.includes('/run/evidence/remediation-census/payload.json'));
  assert.match(s, /cannot read/i, 'a reader that cannot open the copy (an external arm) is not told to say so');
});

// G-3 of 20261017-040138-ogsc-remediation-review: the loader named the copy by its absolute path, so the host's run
// directory reached every tracked lens brief and, through it, the prompts sent to external reviewers.
test('G-3: the census names its copy relative to the run, never by a host path', () => {
  const rg = SRC('scripts/run-graph.mjs');
  const loader = rg.slice(rg.indexOf('const REMEDIATION_CENSUS'), rg.indexOf('function writeBrief'));
  const arg = loader.match(/censusSection\(\{[^}]*payloadPath: ([^,}]+)/)?.[1]?.trim();
  assert.ok(arg, 'the loader does not pass a payloadPath');
  assert.equal(arg, "'evidence/remediation-census/payload.json'", 'the copy is not named relative to the run');
});

// G-4 of 20261017-040138-ogsc-remediation-review: the schema spelled the three census properties beside the
// CENSUS_FIELDS that drives `required`, so a renamed field would be required and forbidden by additionalProperties.
test('G-4: the census properties of the remediation schema are built from CENSUS_FIELDS, not spelled again', () => {
  const block = remediationBlock();
  const props = block.slice(block.indexOf('properties: {', block.indexOf("'group_id'")), block.indexOf('deferred: {'));
  for (const f of FIELDS) assert.doesNotMatch(props, new RegExp(`\\b${f}: \\{`), `${f} is spelled again in the schema's properties`);
  assert.match(props, /CENSUS_FIELDS\.map/, 'the census properties are not derived from CENSUS_FIELDS');
  assert.deepEqual(Object.keys(census.CENSUS_ITEMS), [...census.CENSUS_FIELDS], 'the item shapes and the names have two owners');
});

test('AC4: the remediation prompt says how to fill each field, and that two helpers must refuse alike', () => {
  const prompt = SRC('prompts/remediation/PROMPT.md');
  for (const f of FIELDS) assert.match(prompt, new RegExp('`' + f + '`'), `the prompt does not name ${f}`);
  assert.match(prompt, /refuse/i);
  assert.match(prompt, /raises/, 'the agreement-of-refusals rule is missing');
});

const follows = { run_id: '20261017-010101-rem', run_dir: '/repo/.claude/reviews/20261017-010101-rem' };
const payloadPath = '/staged/20261017-020202-follow/evidence/remediation-census/payload.json';

test('AC5: a review with no remediation gets no section', () => {
  assert.equal(censusSection({ followsRemediation: null }), '');
});

test('AC5: the section names the payload and counts each group\'s census, copying none of its text', () => {
  const payload = { groups: [
    { group_id: 'G-1', search_command: 'git grep -n SECRET-COMMAND', search_sites: ['a.py:3', 'b.py:9'],
      not_in_class: [{ site: 'b.py:9', reason: 'SECRET-REASON' }], unmatched_spellings: ['SECRET-SPELLING'] },
    { group_id: 'G-2', search_command: 'x', search_sites: [], not_in_class: [], unmatched_spellings: [] },
  ] };
  const s = censusSection({ followsRemediation: follows, payload, payloadPath });
  assert.match(s, /20261017-010101-rem/);
  assert.ok(s.includes(payloadPath), 'the payload path is not named');
  assert.match(s, /G-1: 2 search_sites, 1 not_in_class, 1 unmatched_spellings/);
  assert.match(s, /G-2: 0 search_sites, 0 not_in_class, 0 unmatched_spellings/);
  assert.match(s, /every site/i, 'the lens is not asked whether the fix reaches every site');
  assert.doesNotMatch(s, /SECRET/, 'model text from the payload reached the tracked brief');
});

test('AC5: a payload that predates the fields, or cannot be read, is said to be so', () => {
  const old = censusSection({ followsRemediation: follows, payloadPath,
    payload: { groups: [{ group_id: 'G-3', search_command: 'x', deferred: [] }] } });
  assert.match(old, /G-3: no census \(the remediation predates it\)/);
  const none = censusSection({ followsRemediation: follows, payloadPath, payload: null });
  assert.match(none, /could not be read/);
});

test('AC5: the run brief carries the section, filled by run-graph from the run it follows', () => {
  assert.match(SRC('prompts/_templates/run-brief.md'), /\{\{remediation_census\}\}/);
  const rg = SRC('scripts/run-graph.mjs');
  assert.match(rg, /remediation_census: /);
  assert.match(rg, /follows_remediation/);
});

// THE ARMS GET THE CENSUS WHERE THEY CAN READ IT (20261020-132503-ciss-remediation-5-review; operator, 2026-10-20: "Census
// file in the arms' snapshot (Recommended)"). An arm's prompt carried the lens's census section, which names the copy
// relative to the run directory the same prompt forbids it to read; two codex arms reported themselves incomplete. The
// copy is placed in the directory the arms read, outside git, and the arm's prompt names it there.
test('the arm prompt names the census copy in the arms\' directory, and run-graph places it there', () => {
  const brief = censusSection({ followsRemediation: follows, payloadPath: 'evidence/remediation-census/payload.json', payload: { groups: [] } });
  const arm = prompts.buildArmShadowPrompt({ lensId: 'code-audit', skillMarkdown: '# code-audit\n\nlens text\n', runBrief: brief,
    reviewer: 'codex', intentMode: 'forbidden' });
  assert.doesNotMatch(arm, /relative to its run directory/, 'the arm is pointed at the run directory it may not read');
  assert.ok(arm.includes(prompts.ARM_CENSUS_PATH), 'the arm is not told where its copy of the census is');
  const rg = SRC('scripts/run-graph.mjs');
  assert.match(rg, /ARM_CENSUS_PATH/, 'run-graph does not place the census in the arms\' directory');
});

// A REFUSED PAYLOAD IS SAID TO BE REFUSED (G-13 of 20261029-224143-rdr-remediation-3-review): run-graph's census read
// caught ECONFINED and discarded it, so a payload behind a link standing below the admitted run was reported only as
// "not found or could not be read", and a follow-up review lost the fact that the read was actively refused.
test('G-13: a census payload refused by its owner is named as refused, with the reason', () => {
  const s = censusSection({ followsRemediation: follows, payloadPath, payload: null,
    refused: 'a link stands below the admitted run: evidence/remediation' });
  assert.match(s, /refused/i, 'a refused read is described as merely unreadable');
  assert.ok(s.includes('a link stands below the admitted run'), 'the refusal reason is dropped');
  const rg = SRC('scripts/run-graph.mjs');
  const block = rg.slice(rg.indexOf('const REMEDIATION_CENSUS'), rg.indexOf('function writeBrief'));
  assert.match(block, /ECONFINED/, 'the census read still discards ECONFINED');
  assert.match(block, /censusSection\(\{[^}]*refused/, 'run-graph does not pass the refusal to censusSection');
});

// G-15 of 20261029-235315-rdr-remediation-4-review (panel-codex-security): the refusal's own message names the linked
// run's absolute path, and run-graph forwarded it into every lens brief and external prompt. The reason is said relative
// to the run, as the payload path already is.
test('G-15: the census refusal carries no absolute path into the briefs', () => {
  const rg = SRC('scripts/run-graph.mjs');
  const block = rg.slice(rg.indexOf('const REMEDIATION_CENSUS'), rg.indexOf('function writeBrief'));
  assert.doesNotMatch(block, /refused\s*=\s*e\.message/, 'the ECONFINED message, with its absolute path, becomes the reason');
});
