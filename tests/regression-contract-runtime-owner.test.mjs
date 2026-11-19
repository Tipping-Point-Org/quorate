// ONE OWNER FOR THE CONTRACT'S ADAPTER TABLE AND NODE RUNTIME (contract-runtime-and-session-files.plan.md stage 1; design
// CR-D1 A, CR-D2 A, operator 2026-11-05). Fifteen files each merged the contract's adapter declarations and chose the node
// runtime themselves, and three remediation rounds of autonomous-run's delivery chain found one after another getting it
// wrong: overrides ignored (G-1, G-15 of 20261105-013235-ar-d1-c-remediation-review), then `review.runtime` ignored (G-2,
// G-17 of 20261105-021654-ar-d1-c-remediation-2-review), then the same in cli-freshness (G-3 of
// 20261105-031048-ar-d1-c-remediation-3-review). `selectAdapters` is now the one place; this file holds its precedence and
// the census that refuses a site composing its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SCRIPTS_DIR, runScript } from './helpers.mjs';
import * as lib from '../scripts/lib/reviewers.mjs';

const BUILTINS = {
  alpha: { cmd: 'alpha', roles: ['node', 'reviewer'], label: 'Alpha' },
  beta: { cmd: 'beta', roles: ['node'], label: 'Beta' },
};
const RAW = { default_node_runtime: 'alpha' };

test('selectAdapters: --runtime over review.runtime over the table default', () => {
  assert.equal(typeof lib.selectAdapters, 'function', 'lib/reviewers.mjs exports no selectAdapters');
  const pick = (o) => lib.selectAdapters({ builtins: BUILTINS, raw: RAW, ...o }).runtime;
  assert.equal(pick({}), 'alpha');
  assert.equal(pick({ contract: { review: { runtime: 'beta' } } }), 'beta');
  assert.equal(pick({ contract: { review: { runtime: 'beta' } }, runtimeArg: 'alpha' }), 'alpha');
  assert.equal(pick({ runtimeArg: 'beta' }), 'beta');
});

// G-9 and G-10 of 20261105-070121-crsf-remediation-2-review (panel-codex-contract): a malformed review.runtime was refused
// before --runtime was consulted, so a valid flag could not take precedence; and a blank --runtime was read as absent,
// falling through to the contract or the default with no refusal.
const selRt = (o) => lib.selectAdapters({ builtins: BUILTINS, raw: RAW, ...o });
test('G-9: a valid --runtime wins over a malformed review.runtime', () => {
  const sel = selRt;
  assert.equal(sel({ contract: { review: { runtime: '   ' } }, runtimeArg: 'beta' }).runtime, 'beta',
    'a malformed contract value overrode an explicit --runtime');
  assert.equal(sel({ contract: { review: { runtime: 7 } }, runtimeArg: 'alpha' }).runtime, 'alpha');
});

test('G-10: a blank --runtime is refused, named, never read as absent', () => {
  const sel = selRt;
  for (const blank of ['', '   ']) {
    assert.throws(() => sel({ runtimeArg: blank }).runtime, /--runtime must be an adapter name, not ""|--runtime must be an adapter name, not "   "/,
      `a blank --runtime ${JSON.stringify(blank)} fell through silently`);
    assert.throws(() => sel({ contract: { review: { runtime: 'beta' } }, runtimeArg: blank }).runtime, /--runtime must be an adapter name/);
  }
  assert.throws(() => sel({ contract: { review: { runtime: '   ' } } }).runtime, /review\.runtime must be an adapter name/,
    'the contract value is still refused when no --runtime is given');
});

test('selectAdapters: an unknown or malformed runtime is refused, naming it', () => {
  const sel = (o) => lib.selectAdapters({ builtins: BUILTINS, raw: RAW, ...o });
  assert.throws(() => sel({ contract: { review: { runtime: 'nosuch' } } }).runtime, /nosuch.*not in the adapter table/);
  assert.throws(() => sel({ runtimeArg: 'nosuch' }).runtime, /nosuch.*not in the adapter table/);
  assert.throws(() => sel({ contract: { review: { runtime: 7 } } }).runtime, /review\.runtime/);
});

test('selectAdapters: the table is merged with the declarations and the overrides named; the runtime is asked only when read', () => {
  const declared = { alpha: { cmd: 'alpha-wrapped' }, gamma: { cmd: 'gamma', roles: ['reviewer'] } };
  const s = lib.selectAdapters({ builtins: BUILTINS, raw: {}, contract: { reviewers: declared } });
  assert.equal(s.table.alpha.cmd, 'alpha-wrapped');
  assert.equal(s.table.alpha.label, 'Alpha', 'an override merges over the built-in rather than replacing it');
  assert.ok(s.table.gamma);
  assert.deepEqual(s.overrides.map((o) => o.name), ['alpha']);
  // Two node-capable adapters and no declared default: no runtime, but a caller that needs only the table is not refused.
  assert.throws(() => s.runtime, /no default node runtime/);
  // `declared` stands in for contract.reviewers where a caller has only the declarations.
  assert.equal(lib.selectAdapters({ builtins: BUILTINS, raw: RAW, declared }).table.alpha.cmd, 'alpha-wrapped');
});

// THE CENSUS. Instrument, run over every .mjs below scripts/: the lines, comments excepted, matching
//   /\b(mergeReviewers|defaultNodeRuntime|benchRuntime)\(|\breview\??\.runtime\b/, and readsRuntime below: the key by
//   bracket, by destructuring, nested under `review:`, or through an alias of the review section the file binds.
// THE RESIDUAL: an alias the scan cannot see bind (a function parameter, a spread, Object.entries) is not followed.
// A site outside the owner that composes the table or reads the key is refused, unless named below with its reason.
const OWNER = 'lib/reviewers.mjs';
const EXCEPTIONS = {
  // Records what a run or check FROZE, never today's choice (G-20 of 20261025-215217-tel-remediation-2-review): a run's
  // contract's review.runtime, else run.json's host.runtime. Selecting would re-decide a past run with today's table.
  'io/telemetry-record.mjs': /runRuntime = /,
};
const PATTERN = /\b(mergeReviewers|defaultNodeRuntime|benchRuntime)\(|\breview\??\.runtime\b/;
// G-12 of 20261105-061926-crsf-remediation-review: the key read in every spelling a source line can carry, through the
// review section's own name or any alias of it the same file binds. An alias is a name assigned the section
// (`const x = contract.review ?? {}`) or bound by renaming it in a pattern or literal (`{ review: x }`).
const IDENT = '[A-Za-z_$][\\w$]*';
// The section by dot or, since G-16 of 20261105-163851-crsf-d1-review, by bracket (`x['review']`, `x?.["review"]`).
const SECTION = `(?:\\.review\\b|(?:\\?\\.)?\\[\\s*['"\`]review['"\`]\\s*\\])`;
const ALIAS_ASSIGN = new RegExp(`\\b(?:const|let|var)\\s+(${IDENT})\\s*=\\s*[\\w$.?]*${SECTION}\\s*(?:\\?\\?|\\|\\||;|$)`);
const ALIAS_RENAME = new RegExp(`\\breview\\s*:\\s*(${IDENT})`, 'g');
const NESTED = /\breview\s*:\s*\{[^}]*\bruntime\b/;
// The section taken by bracket, then its runtime by dot or bracket (G-16).
const BRACKET_SECTION = new RegExp(`(?:\\?\\.)?\\[\\s*['"\`]review['"\`]\\s*\\]\\s*(?:\\?\\.\\s*runtime\\b|\\.\\s*runtime\\b|(?:\\?\\.)?\\[\\s*['"\`]runtime['"\`]\\s*\\])`);
const esc = (s) => s.replace(/[$]/g, '\\$');
const readsRuntime = (line, aliases) => NESTED.test(line) || BRACKET_SECTION.test(line) || aliases.some((a) => {
  const A = esc(a);
  return new RegExp(`\\b${A}\\s*\\??\\.\\s*runtime\\b`).test(line)
    || new RegExp(`\\b${A}\\s*(?:\\?\\.)?\\[\\s*['"\`]runtime['"\`]\\s*\\]`).test(line)
    || new RegExp(`\\{[^}]*\\bruntime\\b[^}]*\\}\\s*=\\s*[\\w$.?]*\\b${A}\\b\\s*(?:\\?\\?|\\|\\||;|$)`).test(line);
});
const aliasesIn = (lines) => {
  const out = new Set(['review']);
  for (const l of lines) {
    const m = ALIAS_ASSIGN.exec(l); if (m) out.add(m[1]);
    for (const r of l.matchAll(ALIAS_RENAME)) out.add(r[1]);
  }
  return [...out];
};

function mjsFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) mjsFiles(p, out); else if (e.name.endsWith('.mjs')) out.push(p);
  }
  return out;
}

// The scan, over { rel: source }: every line, comments excepted, that composes the table or reads the runtime key.
function censusHits(sources) {
  const hits = [];
  for (const [rel, src] of Object.entries(sources)) {
    if (rel === OWNER) continue;
    const lines = src.split(/\r?\n/);
    const isComment = (code) => code.startsWith('//') || code.startsWith('*') || code.startsWith('/*');
    const aliases = aliasesIn(lines.filter((l) => !isComment(l.trim())));
    lines.forEach((line, i) => {
      const code = line.trim();
      if (isComment(code)) return;
      if (!PATTERN.test(line) && !readsRuntime(line, aliases)) return;
      if (EXCEPTIONS[rel]?.test(line)) return;
      hits.push(`${rel}:${i + 1}: ${code.slice(0, 120)}`);
    });
  }
  return hits;
}

// G-12 of 20261105-061926-crsf-remediation-review (four codex arms): the census matched only dotted `review.runtime`, so
// bracket access, destructuring and an alias of the review section read the key unseen.
test('G-12: the census sees review.runtime read by bracket, by destructuring and through an alias', () => {
  const planted = {
    'scratch-bracket.mjs': "const name = contract.review['runtime'];\n",
    'scratch-optbracket.mjs': "const name = contract?.review?.[\"runtime\"];\n",
    'scratch-destructure.mjs': "const { runtime } = contract.review;\n",
    'scratch-nested.mjs': "const { review: { runtime } } = contract;\n",
    'scratch-alias.mjs': "const frozen = run.contract?.review ?? {};\nconst name = frozen.runtime;\n",
    'scratch-rename.mjs': "const { review: r } = contract;\nconst name = r?.runtime;\n",
  };
  const hits = censusHits(planted).map((h) => h.split(':')[0]);
  assert.deepEqual(hits.sort(), Object.keys(planted).sort(), `planted runtime reads the census did not see: ${
    Object.keys(planted).filter((k) => !hits.includes(k)).join(', ')}`);
  assert.deepEqual(censusHits({ 'scratch-ok.mjs': "const adapters = selectAdapters({ contract: { review: frozen } });\nconst rt = ADAPTERS.runtime;\n" }),
    [], 'passing the review section to the owner, or reading the owner\'s answer, is not a read of the key');
});

// G-16 of 20261105-163851-crsf-d1-review: bracket access was recognised only after a dotted or aliased review section, so
// the section itself taken by bracket (`contract['review']['runtime']`) read the key unseen, and so did an alias bound to it.
test('G-16: the census sees the review section taken by bracket', () => {
  const planted = {
    'scratch-both-brackets.mjs': "const name = contract['review']['runtime'];\n",
    'scratch-section-bracket.mjs': "const name = contract?.[\"review\"]?.runtime;\n",
    'scratch-bracket-alias.mjs': "const sec = contract['review'] ?? {};\nconst name = sec.runtime;\n",
  };
  const hits = censusHits(planted).map((h) => h.split(':')[0]);
  assert.deepEqual([...new Set(hits)].sort(), Object.keys(planted).sort(), `planted runtime reads the census did not see: ${
    Object.keys(planted).filter((k) => !hits.includes(k)).join(', ')}`);
  assert.deepEqual(censusHits({ 'scratch-ok.mjs': "const models = contract['review']['models'];\n" }), [],
    'another key of the section is not a read of the runtime');
});

test('census: no site outside the owner composes the adapter table or reads review.runtime', () => {
  const sources = Object.fromEntries(mjsFiles(SCRIPTS_DIR)
    .map((file) => [path.relative(SCRIPTS_DIR, file).split(path.sep).join('/'), fs.readFileSync(file, 'utf8')]));
  const hits = censusHits(sources);
  assert.deepEqual(hits, [], `table or runtime chosen outside ${OWNER}:\n${hits.join('\n')}`);
});

// G-3 of 20261105-031048-ar-d1-c-remediation-3-review: the freshness check seeded its adapters from the table's default
// runtime and never read review.runtime, so a contract running another runtime had that CLI unchecked.
test('the CLI freshness check checks the runtime the contract declares', async () => {
  const { checkFreshness } = await import('../scripts/io/cli-freshness.mjs');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cro-fresh-'));
  try {
    const declared = { altnode: { cmd: 'altnode', roles: ['node'], version_argv: ['--version'] } };
    const asked = [];
    const run = (c) => { asked.push(c.cmd); return { ok: true, version: '1.0.0' }; };
    checkFreshness({ home, now: new Date('2026-11-05T12:00:00Z'), run, force: true, declared, contract: { review: { runtime: 'altnode' } } });
    assert.ok(asked.includes('altnode'), `the declared runtime's CLI was not checked: ${asked.join(', ')}`);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

// A site that ignored review.runtime now takes it: a contract naming a runtime the table lacks is refused before anything
// is spawned. Spawn-subagent is driven with a fake runtime binary, so the old behaviour (spawning the default) costs
// nothing; the refusal is what the fix adds.
test('spawn-subagent takes a declared review.runtime: an unknown one is refused before any spawn', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cro-subagent-'));
  try {
    const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
    git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# t\n\n```yaml\ngraph_contract_version: 6\nproject: t\ncommands:\n  build: ""\n'
      + '  test: ""\nreview:\n  runtime: nosuch\n  models: { judgment: opus, mechanical: sonnet }\n  effort: { judgment: low }\n'
      + 'ui:\n  surface: none\n```\n');
    git('add', '-A'); git('commit', '-qm', 'init');
    const marker = path.join(dir, 'spawned.txt');
    const fake = path.join(dir, 'fake-runtime.mjs');
    fs.writeFileSync(fake, `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'x');\n`
      + 'process.stdout.write(JSON.stringify({ type: "result", result: "{}" }));\n');
    const prompt = path.join(dir, 'p.md'); fs.writeFileSync(prompt, 'say ok\n');
    const r = runScript('spawn-subagent.mjs', ['--prompt-file', prompt, '--out', path.join(dir, 'out.json'),
      '--repo-root', dir, '--runtime-bin', fake]);
    assert.match(r.output, /nosuch.*not in the adapter table/, r.output);
    assert.notEqual(r.status, 0);
    assert.equal(fs.existsSync(marker), false, 'the runtime was spawned before the declared runtime was checked');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
