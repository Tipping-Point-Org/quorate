#!/usr/bin/env node
// code-index.mjs — the code index: run each declared extractor, keep its facts in a cache that every reader re-checks,
// and answer one question per call (shared/code-index.md; code-index.plan.md stages 6 and 7).
//
//   node scripts/code-index.mjs build
//   node scripts/code-index.mjs <shape> [--language <l>] --args '<json>'       shapes: symbol calls constructions
//                                                                              literals comparisons callees handlers
//   node scripts/code-index.mjs ask --needs "<the shape it would need>" "<the question>"
//   node scripts/code-index.mjs unsupported
//   node scripts/code-index.mjs conformance --language <l> --extractor "<cmd>" --fixtures <dir>
//   node scripts/code-index.mjs compare --answers <file> [--language <l>]
//
// Every option may be followed by --repo-root <dir>. Exit: 0 answered, 1 a conformance or comparison mismatch, 2
// refused (usage, contract), 4 the inputs moved between hashing and reading.
//
// THE EXTRACTOR IS A CONTRACT COMMAND, and runs like one (design D7, amended 2026-10-20): argv-split, in the repository,
// with exactly the platform's process basics plus the language's declared `env` (extractorEnvFor), and a timeout. It
// does not run through capture.mjs, which needs a run directory; a capture with none is M2 item 7.
//
// THE CACHE LIVES UNDER THE ENGINE'S HOME, outside every working tree (plan stage 6), so no .gitignore rule is needed.
// An entry is trusted only while its key, recomputed before every read, still matches.
import fs from 'node:fs';
import { parseArgv, ArgvError } from './lib/argv.mjs';
import { ARGV_SPECS } from './lib/argv-specs.mjs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readContract } from './io/contract-reader.mjs';
import { preflightInputSet, preflightEvictions } from './io/preflight-cache.mjs';
import { quorateHome } from './io/reviews-root.mjs';
import { spawnCapture } from './io/spawn-capture.mjs';
import { writeJsonAtomic } from './io/atomic.mjs';
import { frameworkStamp } from './io/version.mjs';
import { hostPlatform } from './platform/index.mjs';
import { contractArgv } from './lib/decisions.mjs';
import { codeIndexContractErrors } from './lib/code-index-contract.mjs';
import { contractGlobErrors } from './lib/contract-glob.mjs';
import { stopHeldOnExit } from './io/stop-on-exit.mjs';
import { SHAPES, responseErrors, envelopeErrors, identityErrors, conformanceIdentityErrors, argsErrors, requestErrors, CODE_INDEX_ANSWER, CODE_INDEX_REQUEST } from './lib/code-index-schema.mjs';
import { extractorEnvFor, cacheKey, childFailure, timeoutMinutes, cacheCapBytes, namedPaths, indexDirName, headMatchesPin, treeIsClean } from './lib/code-index-cache.mjs';
import { answer, sweepMatches, answersFileErrors } from './lib/code-index-query.mjs';
import { SCOPE_TABLES, scopeConstructsDifferences } from './lib/scope-constructs.mjs';
import { gitSync } from './io/git.mjs';
import { isWithin } from './io/finding-scope.mjs';

const FRAMEWORK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UNSUPPORTED_KEEP = 1000;
const NETWORK = 'the extractor\'s network and file access: nothing constrains them (design D7)';

const die = (msg, code = 2) => { console.error(`code-index: ${msg}`); process.exit(code); };

// ---------------------------------------------------------------------------------------------------- arguments
const argv = process.argv.slice(2);
const command = argv[0];
// The arguments after the command, through the one parser, lib/argv.mjs's, against this script's spec in
// lib/argv-specs.mjs (entrypoint-argv.plan.md): every flag takes a value, and an unknown one is refused naming it.
let opts;
let positional;
try { ({ values: opts, positionals: positional } = parseArgv(argv.slice(1), ARGV_SPECS['code-index'])); } catch (e) { if (e instanceof ArgvError) die(e.message); throw e; }
const USAGE = 'usage: code-index.mjs build | <shape> --args <json> | ask --needs <shape> <question> | unsupported '
  + '| conformance --language <l> --extractor <cmd> --fixtures <dir> | compare --answers <file>';
if (!command) die(USAGE);

const root = path.resolve(opts['repo-root'] ?? process.cwd());
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const platform = hostPlatform();

// ------------------------------------------------------------------------------------------------------ the home
const home = () => {
  let real = root;
  try { real = fs.realpathSync(root); } catch { /* the path as given */ }
  return path.join(quorateHome(), 'code-index', indexDirName(real));
};

// --------------------------------------------------------------------------------------------------- the contract
function contractOrDie() {
  const read = readContract({ repoRoot: root });
  if (!read.contract) die(`no contract to read: ${read.error ?? read.message ?? 'graph_contract absent'}`);
  const c = read.contract;
  if (c.code_index === undefined || c.code_index === null) {
    die('code_index is not declared in the contract, so the code index is off (shared/claude-md-contract.md, code_index)');
  }
  // Both kinds of error in one refusal, so a contract carrying both is not fixed one error at a time (G-7 of
  // 20261022-215413-ciss-d1-3-remediation-review). The globs in the contract's grammar, as mint and pre-flight check
  // them (G-10 of 20261020-043006-code-index-delivery).
  const errs = codeIndexContractErrors(c);
  const globErrs = contractGlobErrors(c).filter((e) => e.startsWith('code_index.'));
  const said = [];
  if (errs.length) said.push(`${errs.join('; ')} (shared/claude-md-contract.md, code_index)`);
  if (globErrs.length) said.push(`the contract declares globs outside the contract's glob grammar: ${globErrs.join('; ')}`);
  if (said.length) die(said.join('; '));
  const t = timeoutMinutes(c.review?.code_index_timeout_minutes);
  if (!t.ok) die(t.why);
  const cap = cacheCapBytes(c.review?.code_index_cache_max_mb);
  if (!cap.ok) die(cap.why);
  return { contract: c, timeoutMs: t.minutes * 60_000, maxBytes: cap.maxBytes };
}

// ------------------------------------------------------------------------------------------------- the extractor
// A listed path whose real path lies outside the repository (a tracked symlink) is never read or handed to the extractor;
// it is kept aside, and the response names it as not processed (G-11 of 20261020-043006-code-index-delivery).
function manifestOf(globs, at = root, outside = []) {
  if (!Array.isArray(globs) || !globs.length) return [];
  const set = preflightInputSet({ repoRoot: at, contract: { review: { preflight_inputs: globs } } });
  let realRoot = path.resolve(at);
  try { realRoot = fs.realpathSync(at); } catch { /* the root as given */ }
  const inside = (p) => {
    // Through the host-aware owner (G-5 of 20261029-212858-rdr-remediation-2-review), not a local case-sensitive prefix.
    try { return isWithin(realRoot, fs.realpathSync(path.join(at, p))); } catch { return false; }
  };
  const out = [];
  for (const p of set.relFiles) {
    if (inside(p)) out.push({ path: p, sha256: sha256(path.join(at, p)) });
    else outside.push(p);
  }
  return out;
}

function namedFiles(cmdArgv, at) {
  return namedPaths(cmdArgv).map((p) => {
    const abs = path.resolve(at, p);
    return { path: p.split(path.sep).join('/'), sha256: fs.existsSync(abs) && fs.statSync(abs).isFile() ? sha256(abs) : null };
  });
}

// EVERY EXTRACTOR CHILD IS HELD, so an interrupted CLI stops it and says so rather than leaving it running with the
// declared environment (G-13 of 20261020-061457-code-index-full-sweep; ARCHITECTURE A-25).
const live = new Map();
let childSeq = 0;
stopHeldOnExit({
  held: () => live.entries(),
  record: (key, outcome, reason) => console.error(`code-index: ${key} ${reason}: ${outcome.outcome}${outcome.pid ? ` (pid ${outcome.pid})` : ''}`),
  onStart: (reason, n) => { if (n) console.error(`code-index: ${reason}, stopping ${n} extractor(s)`); },
});
async function runExtractor(cmdArgv, extra, { env, timeoutMs, cwd }) {
  const key = `extractor-${++childSeq}`;
  return spawnCapture(cmdArgv[0], [...cmdArgv.slice(1), ...extra], { cwd, env, windowsHide: true }, {
    timeoutMs, maxBytes: 256 * 1024 * 1024,
    onSpawn: (child) => { live.set(key, child); },
    onDone: ({ survivor }) => { if (!survivor) live.delete(key); },
  });
}

const parseJson = (s) => { try { return JSON.parse(s); } catch { return undefined; } };

/**
 * Everything one language's key is made of, read now: the extractor's identity, the manifest and the files the command
 * names. Returns { identity, failure } | { cmdArgv, run, identity, manifest, named, key }.
 */
async function inputsOf(language, spec, { contract, timeoutMs }, at = root) {
  const cmdArgv = contractArgv(spec.extractor, contract.commands?.shell);
  const env = extractorEnvFor(process.env, { basics: platform.processEnvBasics, declared: spec.env ?? [],
    caseInsensitiveEnv: platform.caseInsensitiveEnv });
  const run = { env, timeoutMs, cwd: at };
  const idRun = await runExtractor(cmdArgv, ['--identity', '--root', at], run);
  const idFail = childFailure(idRun);
  // An extractor that cannot say who it is is still named in the answer, by its command (D7: every answer names its
  // extractor).
  const unidentified = { name: `unidentified: ${spec.extractor}`, version: null, runtime: null, parser: null };
  if (idFail) return { identity: unidentified, failure: { ...idFail, stderr: idRun.stderr.slice(-2000) } };
  const identity = parseJson(idRun.stdout);
  // The whole identity, not its name: a part it leaves out cannot invalidate the cache (G-14 of
  // 20261020-061457-code-index-full-sweep).
  const idErrors = identityErrors(identity);
  if (idErrors.length) {
    return { identity: unidentified, failure: { detail: 'invalid-response', why: idErrors.join('; ') } };
  }
  // THE SCOPE TABLE IS PART OF THE EXTRACTOR CONTRACT (code-index-d1-part-b.plan.md stage 5; operator, 2026-10-21: "What
  // the extractor extracts is part of the contract, right?"). An extractor that models a different set than
  // shared/code-index.md's table for its language is refused, each difference named: a construct added is one whose
  // answers no shared test checks. A language with no table is not compared, and its answers say so.
  const differences = scopeConstructsDifferences(language, identity.scope_constructs);
  if (differences?.length) {
    return { identity, failure: { detail: 'invalid-response',
      why: `${identity.name} models a different scope table than shared/code-index.md's for ${language}: ${differences.join('; ')}` } };
  }
  const outside = [];
  const manifest = manifestOf(spec.globs, at, outside);
  // The configuration the extractor says it reads is part of the key, so a changed package.json invalidates the facts
  // it shaped (G-5 of 20261020-070113-code-index-remediation-4-review). Matched against git's list, as the manifest is.
  const reads = manifestOf(identity.reads ?? [], at).map((m) => ({ path: `reads:${m.path}`, sha256: m.sha256 }));
  const named = [...namedFiles(cmdArgv, at), ...reads];
  return { cmdArgv, run, identity, manifest, named, outside, key: cacheKey({ language, spec, manifest, named, identity }) };
}

/**
 * One language's facts: from the cache while its key still matches, else by running the extractor. Returns
 * { language, notConfigured } | { language, failure } | { language, key, identity, response, manifest, named }.
 */
/** A request an extractor may be given, or a refusal: requestErrors had no call site, so no request it was written for was
 *  ever held to it (G-3 of 20261021-190234-ciss-d1-remediations-review). */
function checkedRequest(request) {
  const errors = requestErrors(request);
  if (errors.length) throw new Error(`code-index: the ${request?.language ?? ''} request is not one an extractor may be given: ${errors.join('; ')}`);
  return request;
}

async function build(language, spec, { contract, timeoutMs, maxBytes }, at = root) {
  if (!spec.extractor) return { language, notConfigured: `${language}: extractor is empty` };
  const inputs = await inputsOf(language, spec, { contract, timeoutMs }, at);
  if (inputs.failure) return { language, identity: inputs.identity, failure: inputs.failure };
  const { cmdArgv, run, identity, manifest, named, key, outside } = inputs;
  const dir = home();
  const entryFile = path.join(dir, `${key}.json`);
  const request = checkedRequest({ code_index_request: CODE_INDEX_REQUEST, language, root: at, files: manifest.map((m) => m.path),
    options: spec.options ?? {} });
  // Read once: an exists-then-read pair could see the entry evicted between the two (G-10 of 20261020-070113).
  let cached;
  try { cached = parseJson(fs.readFileSync(entryFile, 'utf8')); } catch { cached = undefined; }
  // A hit passes the validation a fresh response passes: an entry written before the validator was strengthened is
  // extracted again, not trusted (G-3 of 20261020-051530-code-index-remediation-review).
  if (cached && cached.key === key && cached.response && !responseErrors(cached.response, request, identity).length) {
    const now = new Date();
    try { fs.utimesSync(entryFile, now, now); } catch { /* the entry is still valid; only its recency is not recorded */ }
    // A hit is counted toward the cap too, and an entry over it is said (G-10, G-12 of 20261020-070113).
    const overCap = evict(dir, `${key}.json`, maxBytes);
    return { language, key, identity, response: withOutside(cached.response, outside), manifest, named, cached: true,
      ...(overCap ? { overCap: overCapNote(maxBytes) } : {}) };
  }
  fs.mkdirSync(path.join(dir, 'requests'), { recursive: true });
  const requestFile = path.join(dir, 'requests', `${key}.json`);
  writeJsonAtomic(requestFile, request);
  const r = await runExtractor(cmdArgv, ['--language', language, '--request', requestFile], run);
  // A request with no entry beside it is outside the cap evict() enforces, so a failure removes its own (G-13 of
  // 20261020-043006-code-index-delivery).
  const dropRequest = () => fs.rmSync(requestFile, { force: true });
  const fail = childFailure(r);
  if (fail) { dropRequest(); return { language, key, identity, failure: { ...fail, stderr: r.stderr.slice(-2000) } }; }
  const response = parseJson(r.stdout);
  // The response must name the extractor its identity call named (rule response-matches-identity, G-15 of 070113).
  const errors = responseErrors(response, request, identity);
  if (errors.length) { dropRequest(); return { language, key, identity, failure: { detail: 'invalid-response', why: errors.slice(0, 20).join('; ') } }; }
  writeJsonAtomic(entryFile, { key, language, identity, response });
  const overCap = evict(dir, `${key}.json`, maxBytes);
  return { language, key, identity, response: withOutside(response, outside), manifest, named, cached: false,
    ...(overCap ? { overCap: overCapNote(maxBytes) } : {}) };
}

// The files kept aside because their real path is outside the repository, named as not processed.
const withOutside = (response, outside) => (outside?.length ? { ...response, files: [...response.files,
  ...outside.map((p) => ({ path: p, status: 'not_processed', outcome: 'unsupported', reason: 'its real path is outside the repository' }))] } : response);

// An entry's size is its own file and the request kept beside it, which the cap would otherwise not see (G-5 of
// 20261020-051530-code-index-remediation-review).
function evict(dir, keep, maxBytes) {
  // Uncapped evicts nothing, so it scans nothing: the scan was O(entries) stat calls on every hit (G-6 of
  // 20261022-211328-ciss-d1-2-remediation-b-review). A capped hit still scans, because a hit counts toward the cap.
  if (maxBytes == null) return false;
  const entries = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => {
    const st = fs.statSync(path.join(dir, n));
    const request = path.join(dir, 'requests', n);
    const requestBytes = fs.existsSync(request) ? fs.statSync(request).size : 0;
    return { hash: n, bytes: st.size + requestBytes, lastUsed: st.mtimeMs };
  });
  const { evict: gone, overCap } = preflightEvictions(entries, { maxBytes, keep });
  for (const n of gone) {
    fs.rmSync(path.join(dir, n), { force: true });
    fs.rmSync(path.join(dir, 'requests', n), { force: true });
  }
  // The newest entry is kept even when it alone exceeds the cap; that is said, not left silent (G-16 of
  // 20261020-061457-code-index-full-sweep).
  return overCap;
}

const overCapNote = (maxBytes) => `the cache entry for this answer alone exceeds review.code_index_cache_max_mb `
  + `(${Math.round(maxBytes / (1024 * 1024))} MB); it is kept, and the cache is over its cap`;

// --------------------------------------------------------------------------------------------------- the answers
function chooseLanguage(contract) {
  const declared = Object.keys(contract.code_index ?? {});
  if (opts.language) {
    if (!declared.includes(opts.language)) die(`--language ${opts.language} is not declared in code_index (${declared.join(', ') || 'none'})`);
    return opts.language;
  }
  if (declared.length === 1) return declared[0];
  return declared.length ? die(`give --language: code_index declares ${declared.join(', ')}`) : null;
}

const extractorIds = (b) => (b.identity ? [{ name: b.identity.name, version: b.identity.version,
  runtime: b.identity.runtime ?? null, parser: b.identity.parser ?? null }] : []);

function envelope(shape, language, result, b) {
  const stamp = frameworkStamp(FRAMEWORK_ROOT);
  const notChecked = [...(result.not_checked ?? []), NETWORK];
  if (b?.overCap) notChecked.push(b.overCap);
  if (b?.named && !b.named.some((n) => n.sha256)) notChecked.push(`${language}: the extractor names no file, so it is keyed by its command alone`);
  if (b?.identity && language && !Object.hasOwn(SCOPE_TABLES, language)) {
    notChecked.push(`${language}: shared/code-index.md has no scope table for this language, so the scope model the extractor reports is unchecked`);
  }
  const e = {
    code_index_answer: CODE_INDEX_ANSWER, shape, language, outcome: result.outcome,
    ...(result.detail ? { detail: result.detail } : {}), ...(result.why ? { why: result.why } : {}),
    rows: result.rows ?? [], input_hash: b?.key ?? null, extractors: b ? extractorIds(b) : [],
    framework: { commit: String(stamp.commit), dirty: typeof stamp.dirty === 'boolean' ? stamp.dirty : null },
    not_checked: notChecked,
  };
  const errs = envelopeErrors(e);
  if (errs.length) die(`internal: the answer this would print is refused by its own schema: ${errs.join('; ')}`, 1);
  return e;
}

// A failure's reason with the last line the extractor wrote on stderr, which is where a controlled refusal names itself
// (the Python floor's "needs Python 3.10"); `why` alone was the process outcome (G-10 of 20261022-183032-pb-delivery).
function failureWhy(failure) {
  const said = String(failure.stderr ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop();
  return said ? `${failure.why}: ${said.slice(0, 500)}` : failure.why;
}

function resultOf(shape, args, b) {
  if (b.notConfigured) return { outcome: 'not_configured', why: b.notConfigured, rows: [], not_checked: [] };
  if (b.failure) return { outcome: 'extractor_failed', detail: b.failure.detail, why: failureWhy(b.failure), rows: [], not_checked: [] };
  const files = b.response.files;
  if (files.length && files.every((f) => f.status !== 'processed' && f.outcome === 'not_configured')) {
    return { outcome: 'not_configured', why: files[0].reason ?? 'the extractor is not configured', rows: [], not_checked: [] };
  }
  return answer(shape, args, { facts: b.response.facts, files });
}

async function ask(shape) {
  const ctx = contractOrDie();
  const language = chooseLanguage(ctx.contract);
  if (!language) {
    console.log(JSON.stringify(envelope(shape, null, { outcome: 'not_configured', why: 'code_index declares no language' }, null), null, 2));
    return;
  }
  let args = {};
  if (opts.args !== undefined) {
    args = parseJson(opts.args);
    if (!args || typeof args !== 'object' || Array.isArray(args)) die('--args must be a JSON object, such as \'{"callee":"pkg.mod.f"}\'');
  }
  // Each shape's own filters, before anything runs (G-18 of 20261020-061457-code-index-full-sweep).
  const argErrs = argsErrors(shape, args);
  if (argErrs.length) die(`--args: ${argErrs.join('; ')} (shared/code-index.md, "Shapes")`);
  const b = await build(language, ctx.contract.code_index[language], ctx);
  const result = resultOf(shape, args, b);
  // RE-KEYED AFTER READING (design D4): an input that moved while the answer was computed makes the answer stale. The
  // whole key, not the manifest alone: a named file or the extractor's identity moves the facts too (G-8 of
  // 20261020-051530-code-index-remediation-review).
  if (b.manifest) {
    const now = await inputsOf(language, ctx.contract.code_index[language], ctx);
    // A re-read that FAILED has no key to compare: it is the extractor failing, and is answered as one, not as moved
    // inputs with an instruction to ask again (scripts/code-index.mjs:340 on the ledger).
    if (now.failure) {
      const failed = { language, identity: now.identity, failure: now.failure };
      console.log(JSON.stringify(envelope(shape, language, resultOf(shape, args, failed), failed), null, 2));
      return;
    }
    if (now.key !== b.key) die('the inputs changed while the answer was computed; ask again', 4);
  }
  console.log(JSON.stringify(envelope(shape, language, result, b), null, 2));
}

// ------------------------------------------------------------------------------------ questions the shapes cannot ask
function record() {
  if (!opts.needs || !positional.length) die('usage: code-index.mjs ask --needs "<the shape it would need>" "<the question>"');
  const dir = home();
  fs.mkdirSync(dir, { recursive: true });
  const log = path.join(dir, 'unsupported.jsonl');
  const lines = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
  lines.push(JSON.stringify({ at: new Date().toISOString(), needs: opts.needs, question: positional.join(' ') }));
  fs.writeFileSync(log, `${lines.slice(-UNSUPPORTED_KEEP).join('\n')}\n`);
  console.log(JSON.stringify({ outcome: 'unsupported', needs: opts.needs, recorded_in: log }, null, 2));
}

function countUnsupported() {
  const log = path.join(home(), 'unsupported.jsonl');
  const lines = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
  const counts = {};
  for (const l of lines) { const n = parseJson(l)?.needs ?? '(unreadable)'; counts[n] = (counts[n] ?? 0) + 1; }
  console.log(JSON.stringify({ total: lines.length, by_needs: counts, log }, null, 2));
}

// ----------------------------------------------------------------------------------------------- conformance
const EXTENSIONS = { python: /\.py$/i, javascript: /\.(html?|m?js|cjs)$/i };
function filesUnder(dir, re) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (!re || re.test(e.name)) out.push(path.relative(dir, p).split(path.sep).join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

async function conformance() {
  const { language, extractor, fixtures } = opts;
  if (!language || !extractor || !fixtures) die('usage: code-index.mjs conformance --language <l> --extractor "<cmd>" --fixtures <dir>');
  const fixDir = path.resolve(fixtures);
  const golden = parseJson(fs.readFileSync(path.join(fixDir, 'golden.json'), 'utf8'));
  if (!golden?.roots || !Array.isArray(golden.sweeps)) die(`${fixDir}/golden.json has no roots and sweeps`);
  const hasRoot = (l) => Object.hasOwn(golden.roots, l);
  // Every sweep is checked for its shape before any is filtered by language: a null or a sweep with no string language
  // threw a TypeError, whose exit 1 read as a conformance mismatch (scripts/code-index.mjs:380 on the ledger).
  const malformed = golden.sweeps.findIndex((s) => s === null || typeof s !== 'object' || Array.isArray(s) || typeof s.language !== 'string');
  if (malformed >= 0) die(`${fixDir}/golden.json: sweep ${malformed + 1} is not an object with a string language`);
  const sweeps = golden.sweeps.filter((s) => s.language === language || hasRoot(s.language) && s.language.startsWith(`${language}-`));
  if (!sweeps.length) die(`${fixDir}/golden.json has no sweep for ${language}`);
  const rootless = sweeps.find((s) => !hasRoot(s.language));
  if (rootless) die(`${fixDir}/golden.json has no root for ${rootless.language}`);
  const byRoot = new Map();
  let failed = 0;
  for (const s of sweeps) {
    const at = path.join(fixDir, golden.roots[s.language]);
    if (!byRoot.has(at)) {
      // Own keys only: a language named like an inherited property found Object.prototype's (G-10 of 191112).
      const files = filesUnder(at, Object.hasOwn(EXTENSIONS, language) ? EXTENSIONS[language] : undefined);
      const spec = { extractor, globs: [], options: {} };
      byRoot.set(at, await buildFixture(language, spec, at, files));
    }
    const b = byRoot.get(at);
    const result = resultOf(s.shape, s.args, b);
    const m = sweepMatches(result, s);
    if (!m.ok) failed++;
    const why = result.why ? ` (${result.detail ? `${result.detail}: ` : ''}${result.why})` : '';
    console.log(`${m.ok ? 'ok  ' : 'FAIL'} ${s.name}: ${m.got.outcome}, ${m.got.rows} row(s)${m.ok ? '' : `${why}; expected ${s.outcome}, ${s.expected.length}; missing ${JSON.stringify(m.missing)}`}`);
  }
  console.log(`code-index conformance: ${sweeps.length - failed}/${sweeps.length} sweep(s) match`);
  process.exit(failed ? 1 : 0);
}

// A fixture directory is not a repository: its files are listed directly, and its facts are never cached.
async function buildFixture(language, spec, at, files) {
  const cmdArgv = contractArgv(spec.extractor, '');
  const env = extractorEnvFor(process.env, { basics: platform.processEnvBasics, declared: [], caseInsensitiveEnv: platform.caseInsensitiveEnv });
  // Run from the repository the command was given in, so a relative extractor path means what the caller typed; the
  // request carries the fixture root.
  const run = { env, timeoutMs: 10 * 60_000, cwd: root };
  const idRun = await runExtractor(cmdArgv, ['--identity', '--root', at], run);
  // A refusal keeps the reason it wrote on stderr, as inputsOf's does (G-11 of 20261022-191112-pb-remediation-review).
  const idFail = childFailure(idRun);
  if (idFail) return { language, failure: { ...idFail, stderr: idRun.stderr.slice(-2000) } };
  const identity = parseJson(idRun.stdout);
  // conformance holds an extractor to what normal use requires, and to declaring what it reads (G-9 of 070113).
  const idErrors = conformanceIdentityErrors(identity);
  if (idErrors.length) return { language, failure: { detail: 'invalid-response', why: idErrors.join('; ') } };
  // And to the contract's scope table for its language, as normal use is (code-index-d1-part-b.plan.md stage 5).
  const differences = scopeConstructsDifferences(language, identity.scope_constructs);
  if (differences?.length) {
    return { language, failure: { detail: 'invalid-response', why: `the scope table differs from shared/code-index.md's: ${differences.join('; ')}` } };
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-code-index-conformance-'));
  try {
    const request = checkedRequest({ code_index_request: CODE_INDEX_REQUEST, language, root: at, files, options: {} });
    const requestFile = path.join(tmp, 'request.json');
    fs.writeFileSync(requestFile, JSON.stringify(request));
    const r = await runExtractor(cmdArgv, ['--language', language, '--request', requestFile], run);
    const fail = childFailure(r);
    if (fail) return { language, failure: { ...fail, stderr: r.stderr.slice(-2000) } };
    const response = parseJson(r.stdout);
    // Held to response-matches-identity as build is: the check that certifies an extractor must not be laxer than the
    // path it certifies (G-17 of 20261020-094311-ciss-delivery).
    const errors = responseErrors(response, request, identity);
    if (errors.length) return { language, failure: { detail: 'invalid-response', why: errors.slice(0, 20).join('; ') } };
    return { language, identity, response, key: null };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------------- compare
async function compare() {
  if (!opts.answers) die('usage: code-index.mjs compare --answers <file> [--language <l>]');
  // THE CONTRACT FIRST, as build and query (G-6 of 20261030-124823-ciss-stage7): an answer or pin error masked it.
  const ctx = contractOrDie();
  const file = parseJson(fs.readFileSync(path.resolve(opts.answers), 'utf8'));
  const errs = answersFileErrors(file);
  if (errs.length) die(`the answer file is refused: ${errs.join('; ')}`);
  // I-16: HEAD must BE the pinned commit. An abbreviated pin is a prefix of HEAD; a HEAD git could not read is refused,
  // never matched, because '' is a prefix of everything (G-19 of 20261020-043006-code-index-delivery).
  // The decision is pure (headMatchesPin, scripts/lib/code-index-cache.mjs; G-11 of 051530, G-19 of 043006).
  const pinned = headMatchesPin(gitSync(['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }), file.pinned_commit);
  if (!pinned.ok) die(`${pinned.why}: the answers' pinned_commit ${file.pinned_commit} is the only commit they hold at`);
  // And the bytes the build reads must be that commit's: an edit or an untracked file is not (G-10 of
  // 20261022-200543-ciss-d1-review-2).
  const clean = treeIsClean(gitSync(['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8' }));
  if (!clean.ok) die(`${clean.why}: the answers' pinned_commit ${file.pinned_commit} holds only for that commit's own bytes`);
  const built = new Map();
  let failed = 0;
  for (const s of file.sweeps) {
    const language = s.language ?? chooseLanguage(ctx.contract);
    // A sweep's language must be one code_index declares, as an own key: a plain index found Object.prototype's for
    // `constructor` and compared it as an empty extractor (G-12 of 20261022-191112-pb-remediation-review).
    if (!Object.hasOwn(ctx.contract.code_index, language ?? '')) {
      die(`sweep ${JSON.stringify(s.name)}: ${language} is not declared in code_index (${Object.keys(ctx.contract.code_index).join(', ') || 'none'})`);
    }
    if (!built.has(language)) built.set(language, await build(language, ctx.contract.code_index[language], ctx));
    const result = resultOf(s.shape, s.args ?? {}, built.get(language));
    const m = sweepMatches(result, { ...s, outcome: s.outcome ?? 'complete' });
    if (!m.ok) failed++;
    console.log(`${m.ok ? 'match' : 'DIFFERS'} ${s.name}: ${m.got.outcome}, ${m.got.rows} row(s)${m.ok ? '' : `; expected ${s.outcome ?? 'complete'}, ${s.expected.length}; missing ${JSON.stringify(m.missing)}`}`);
  }
  console.log(`code-index compare at ${file.pinned_commit}: ${file.sweeps.length - failed}/${file.sweeps.length} sweep(s) match`);
  process.exit(failed ? 1 : 0);
}

// ------------------------------------------------------------------------------------------------------- main
if (command === 'build') {
  const ctx = contractOrDie();
  const out = [];
  for (const [language, spec] of Object.entries(ctx.contract.code_index)) {
    const b = await build(language, spec, ctx);
    out.push({ language, ...(b.notConfigured ? { outcome: 'not_configured', why: b.notConfigured } : {}),
      ...(b.failure ? { outcome: 'extractor_failed', detail: b.failure.detail, why: failureWhy(b.failure) } : {}),
      ...(b.response ? { input_hash: b.key, cached: b.cached, files: b.response.files.length,
        not_processed: b.response.files.filter((f) => f.status !== 'processed').map((f) => f.path) } : {}) });
  }
  console.log(JSON.stringify({ languages: out, home: home() }, null, 2));
} else if (SHAPES.includes(command)) {
  await ask(command);
} else if (command === 'ask') {
  record();
} else if (command === 'unsupported') {
  countUnsupported();
} else if (command === 'conformance') {
  await conformance();
} else if (command === 'compare') {
  await compare();
} else {
  die(`unknown command ${JSON.stringify(command)}; ${USAGE}`);
}
