// ONE HELPER IS THE ONLY PLACE A TEST CATCHES A LINK FAILURE (.claude/requests/silent-platform-skips.md;
// link-failure-owner.plan.md stage 2; design LF-D2 A, LF-D3 A).
//
// Windows without Developer Mode refuses a file symlink. A test that caught that failure and then left out its link
// assertion with no skip reported a full pass while the link check never ran (first instance: G-9 of
// 20261108-080036-si-remediation-8-review). The first census judged each catch body, by reading JavaScript by hand, and
// three reviews running found a new way past it: any `throw` token passed (G-9 of 20261120-183934-spl-delivery-tests), a
// `link fallback:` diagnostic stood in for a rethrow (G-5 of 20261120-212536-spl-remediation-review), and braces hid a
// `return` (G-3 of 20261120-222511-spl-remediation-2-review). So nothing a catch does is read any more. tests/helpers.mjs
// makeLink is the one place a link failure may be caught, and this census checks structure only: a link call outside it
// must not sit inside a `try` that has a `catch`. Blocks are read by their braces over the source with strings,
// comments, template text and regular expressions blanked; a `try` the reading cannot close is reported, never passed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

/** `src` with every string, comment, template text and regex literal replaced by spaces, newlines kept. */
export function codeMask(src) {
  const out = src.split('');
  const blank = (from, to) => { for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' '; };
  const stack = [];   // brace depth at each open `${`, so the template resumes at its own `}`
  let depth = 0;
  let i = 0;
  const prevSignificant = (at) => { let k = at - 1; while (k >= 0 && /\s/.test(src[k])) k--; return k < 0 ? '' : src[k]; };
  const template = (from) => {   // from just after a backtick, or after the `}` that closes a `${`
    let k = from;
    while (k < src.length) {
      if (src[k] === '\\') { k += 2; continue; }
      if (src[k] === '`') { blank(from, k); return k + 1; }
      if (src[k] === '$' && src[k + 1] === '{') { blank(from, k); stack.push(depth); depth++; return k + 2; }
      k++;
    }
    blank(from, k); return k;
  };
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? src.length : e; blank(i, end); i = end; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? src.length : e + 2; blank(i, end); i = end; continue; }
    if (c === '\'' || c === '"') {
      let k = i + 1;
      while (k < src.length && src[k] !== c && src[k] !== '\n') k += src[k] === '\\' ? 2 : 1;
      blank(i + 1, k); i = k + 1; continue;
    }
    if (c === '`') { i = template(i + 1); continue; }
    if (c === '/' && (/[(,=:[!&|?{};+\-*%<>~^]/.test(prevSignificant(i)) || prevSignificant(i) === ''
      || /\b(return|typeof|in|of|case|throw)$/.test(src.slice(Math.max(0, i - 8), i).trimEnd()))) {
      let k = i + 1; let cls = false;
      while (k < src.length && src[k] !== '\n') {
        if (src[k] === '\\') { k += 2; continue; }
        if (src[k] === '[') cls = true; else if (src[k] === ']') cls = false;
        else if (src[k] === '/' && !cls) break;
        k++;
      }
      blank(i + 1, k); i = k + 1; continue;
    }
    if (c === '{') depth++;
    if (c === '}') {
      depth--;
      if (stack.length && depth === stack[stack.length - 1]) { stack.pop(); i = template(i + 1); continue; }
    }
    i++;
  }
  return out.join('');
}

/** The index of the `}` closing the `{` at `open`, over masked text, or -1. */
function closeOf(m, open) {
  let d = 0;
  for (let k = open; k < m.length; k++) {
    if (m[k] === '{') d++;
    else if (m[k] === '}' && --d === 0) return k;
  }
  return -1;
}

/**
 * A LINK CALL (the plan's stage 2): `symlinkSync(` or `linkSync(` called bare (an imported name) or on fs, fsp or
 * promises (fs.promises included), or `symlink(` or `link(` called on one of those receivers. A `.link(` or `.symlink(`
 * on any other receiver is not one. Read over masked text, so a mention in a string or comment is not a call.
 */
const LINK_CALL = /(?<![\w$.])(?:symlinkSync|linkSync)\s*\(|\b(?:fs|fsp|promises)\s*\.\s*(?:symlinkSync|linkSync|symlink|link)\s*\(/g;

/**
 * Every link call in `src` that sits inside a `try` block that has a `catch`: `{ line, problem }`, plus a report for any
 * `try` or `catch` the reading cannot close. A `try` with only `finally` catches nothing.
 */
export function caughtLinkCalls(src) {
  const m = codeMask(src);
  const line = (at) => src.slice(0, at).split('\n').length;
  const out = [];
  const catching = [];
  for (const t of m.matchAll(/\btry\s*\{/g)) {
    const open = t.index + t[0].length - 1;
    const close = closeOf(m, open);
    if (close < 0) { out.push({ line: line(t.index), problem: 'a try block the census cannot close' }); continue; }
    if (/^\s*catch\b/.test(m.slice(close + 1))) catching.push({ open, close });
  }
  for (const call of m.matchAll(LINK_CALL)) {
    if (catching.some((b) => b.open < call.index && call.index < b.close)) {
      out.push({ line: line(call.index), problem: 'a link call caught outside tests/helpers.mjs: make it with makeLink, which skips or names a fallback, or let a refusal fail the test' });
    }
  }
  return out;
}

// Every .mjs under tests/, helpers and fixtures included, as the request sets it.
function testFiles(dir) {
  return fs.readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith('.mjs')).map((f) => path.join(dir, f));
}

test('no test catches a link failure outside tests/helpers.mjs', () => {
  const helpers = path.join(REPO_ROOT, 'tests', 'helpers.mjs');
  const failures = [];
  let calls = 0;
  for (const file of testFiles(path.join(REPO_ROOT, 'tests'))) {
    const src = fs.readFileSync(file, 'utf8');
    calls += [...codeMask(src).matchAll(LINK_CALL)].length;
    if (file === helpers || file === path.join(REPO_ROOT, 'tests', 'regression-link-failures-not-silent.test.mjs')) continue;
    for (const r of caughtLinkCalls(src)) failures.push(`${path.relative(REPO_ROOT, file).split(path.sep).join('/')}:${r.line}: ${r.problem}`);
  }
  assert.ok(calls >= 100, `the census read only ${calls} link calls: the reading, not the tree`);
  assert.deepEqual(failures, []);
});

test('the census reads structure: a caught call fails, an uncaught or finally-only one passes', () => {
  const n = (src) => caughtLinkCalls(src).length;
  assert.equal(n('try { fs.symlinkSync(a, b); } catch { t.skip("x"); }'), 1, 'a caught call, even one that skips, is refused: only the helper may catch');
  assert.equal(n('fs.symlinkSync(a, b);'), 0);
  assert.equal(n('try { fs.symlinkSync(a, b); } finally { cleanup(); }'), 0, 'finally catches nothing');
  assert.equal(n('try { x(); } catch { try { fs.linkSync(a, b); } catch {} }'), 1, 'a nested try inside a catch');
  assert.equal(n('try { await fsp.link(a, b); } catch (e) { throw e; }'), 1, 'fsp.link is a link call');
  assert.equal(n('try { await fs.promises.symlink(a, b); } catch {}'), 1);
  assert.equal(n('try { other.link(a); router.symlink(b); } catch {}'), 0, 'another receiver\'s link is not a link call');
  assert.equal(n('try { const s = "fs.symlinkSync(a, b)"; } catch {}'), 0, 'a call written in a string is not a call');
  assert.equal(n('try { fs.symlinkSync(a, b); '), 1, 'an unclosed try is reported, never passed');
});

/**
 * THE OLD CENSUS, as each of its three versions judged a catch around a link call (G-16 of 20261120-235710-lfo-delivery:
 * the hole fixtures asserted only that the new census refuses them, so nothing showed the old one passed them). Each is
 * the judgment of that commit's linkCatches, over the same codeMask and closeOf as above, which no version changed:
 * 3315d8d9 credited any `throw` or `.skip(` token; 4348f2ff wanted one at the catch's top level, but a real
 * `t.diagnostic('link fallback:')` excused the catch; 889352a4 credited the diagnostic only beside a fallback link, and
 * stopped at a top-level return. True when every caught link call in `src` passes that version.
 */
const OLD_LINK_CALL = /\bsymlinkSync\s*\(|\.symlink\s*\(|\blinkSync\s*\(|\.link\s*\(/;
const oldNamed = (masked, raw) => [...masked.matchAll(/(?<![\w$.])t\s*\.\s*diagnostic\s*\(/g)]
  .some((d) => /^\s*['"`]link fallback:/.test(raw.slice(d.index + d[0].length)));
const oldTopLevel = (masked) => {
  const body = masked.slice(1).split('');
  let d = 0;
  for (let k = 0; k < body.length; k++) {
    const c = body[k];
    if ('({['.includes(c)) { d++; if (d > 1) body[k] = ' '; continue; }
    if (')}]'.includes(c)) { d--; if (d > 0) body[k] = ' '; continue; }
    if (d > 0) body[k] = ' ';
  }
  return body.join('').split(/[;}]/);
};
const OLD_JUDGES = {
  '3315d8d9': (masked, raw) => (OLD_LINK_CALL.test(masked) ? /\bdiagnostic\s*\(\s*['"`]link fallback:/.test(raw)
    : /\bthrow\b/.test(masked) || /\.skip\s*\(/.test(masked)),
  '4348f2ff': (masked, raw) => (OLD_LINK_CALL.test(masked) ? oldNamed(masked, raw)
    : oldNamed(masked, raw) || oldTopLevel(masked).some((s) => /^\s*(?:throw\b|(?:return\s+)?[\w$]+\s*\.\s*skip\s*\()/.test(s))),
  '889352a4': (masked, raw) => {
    if (OLD_LINK_CALL.test(masked)) return oldNamed(masked, raw);
    for (const s of oldTopLevel(masked)) {
      if (/^\s*(?:throw\b|(?:return\s+)?t\s*\.\s*skip\s*\()/.test(s)) return true;
      if (/(?<![\w$.])(?:return|break|continue)\b/.test(s)) return false;
    }
    return false;
  },
};
function oldCensusPasses(version, src) {
  const m = codeMask(src);
  const tries = [];
  for (const t of m.matchAll(/\btry\s*\{/g)) {
    const open = t.index + t[0].length - 1;
    const close = closeOf(m, open);
    if (close < 0) return false;
    const c = /^\s*catch\s*(?:\([^)]*\))?\s*\{/.exec(m.slice(close + 1));
    if (!c) continue;
    const cOpen = close + 1 + c.index + c[0].length - 1;
    const cClose = closeOf(m, cOpen);
    if (cClose < 0) return false;
    tries.push({ open, close, cOpen, cClose });
  }
  const sites = new Set();
  for (const call of m.matchAll(new RegExp(OLD_LINK_CALL.source, 'g'))) {
    const around = tries.filter((t) => t.open < call.index && call.index < t.close);
    if (around.length) sites.add(around.reduce((a, b) => (b.open > a.open ? b : a)));
  }
  return [...sites].every((t) => OLD_JUDGES[version](m.slice(t.cOpen, t.cClose), src.slice(t.cOpen, t.cClose)));
}

// The chain's three holes, each with the census version it got past and the version that closed it.
const HOLES = [
  { finding: 'G-9, any throw token', passed: '3315d8d9', closedBy: '4348f2ff', src: 'try { fs.symlinkSync(a, b); } catch (e) { if (e.code !== "EPERM") throw e; }' },
  { finding: 'G-5, a diagnostic for a rethrow', passed: '4348f2ff', closedBy: '889352a4', src: 'try { fs.symlinkSync(a, b); } catch (e) { t.diagnostic("link fallback: none"); }' },
  { finding: 'G-3, braces hid a return', passed: '889352a4', closedBy: null, src: 'try { fs.symlinkSync(a, b); } catch (e) { if (e.code === "EPERM") { return; } throw e; }' },
];

test('the old census models refuse what each version refused, so a pass under them is not vacuous', () => {
  for (const v of Object.keys(OLD_JUDGES)) {
    assert.equal(oldCensusPasses(v, 'try { fs.symlinkSync(a, b); } catch { }'), false, `${v} passed an empty catch`);
    assert.equal(oldCensusPasses(v, 'try { fs.symlinkSync(a, b); } catch (e) { throw e; }'), true, `${v} refused a rethrow`);
    assert.equal(oldCensusPasses(v, 'try { fs.symlinkSync(a, b); } catch { fs.symlinkSync(d, b, "junction"); }'), false, `${v} passed an unnamed fallback`);
  }
});

test('the three ways past the old census: each passed the census it got past, and the new census refuses each', () => {
  for (const h of HOLES) {
    assert.equal(oldCensusPasses(h.passed, h.src), true, `${h.finding}: the old census ${h.passed} did not pass it, so it shows no difference`);
    if (h.closedBy) assert.equal(oldCensusPasses(h.closedBy, h.src), false, `${h.finding}: ${h.closedBy} still passed it`);
    assert.equal(caughtLinkCalls(h.src).length, 1, `the new census passed: ${h.src}`);
  }
});
