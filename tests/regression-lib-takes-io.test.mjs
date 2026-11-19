// os-platform-adapters stage 3: lib/ modules that must ask the filesystem take the platform
// implementation as `io` instead of importing node:fs. The property that buys is testability WITHOUT
// a filesystem — so these tests hand the pure layer a FAKE io and never touch the disk. The same
// functions against real temporary trees are exercised, host-bound, by the tests that predate this.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as scope from '../scripts/lib/finding-scope.mjs';
import * as excerpt from '../scripts/lib/excerpt.mjs';
import * as locate from '../scripts/lib/locate.mjs';
import * as projectPaths from '../scripts/lib/project-paths.mjs';
import * as version from '../scripts/lib/version.mjs';
import * as reviewers from '../scripts/lib/reviewers.mjs';
import * as prompts from '../scripts/lib/review-prompts.mjs';
import * as template from '../scripts/lib/template.mjs';
import * as profile from '../scripts/lib/project-profile.mjs';
import * as artifacts from '../scripts/lib/run-artifacts.mjs';

const ROOT = path.resolve('/virtual/repo');

/** A filesystem that exists only in this map: path -> file text. Links are `{ link: target }`. */
function fakeIo(files) {
  const abs = (p) => path.resolve(p);
  const real = (p) => {
    const v = files[abs(p)];
    if (v && typeof v === 'object' && v.link) return real(v.link);
    if (v === undefined && abs(p) !== ROOT) {
      const e = new Error(`ENOENT: ${p}`); e.code = 'ENOENT'; throw e;
    }
    return abs(p);
  };
  return {
    fs: {
      existsSync: (p) => abs(p) === ROOT || files[abs(p)] !== undefined,
      realpathSync: real,
      readFileSync: (p) => {
        const h = files[real(p)];
        if (h && typeof h === 'object' && typeof h.hard === 'string') return h.hard;
        const v = h;
        if (typeof v !== 'string') { const e = new Error(`ENOENT: ${p}`); e.code = 'ENOENT'; throw e; }
        return v;
      },
      // The egress owner's lstat, level by level (G-14 of 20261112-063354-hl-remediation-4-review: the excerpt reads
      // through it): a string is a file with one name, `{ link }` a link, a folder above a file a directory.
      lstatSync: (p) => {
        const a = abs(p);
        const v = files[a];
        const kind = (k, nlink = 1) => ({ isFile: () => k === 'file', isDirectory: () => k === 'dir', isSymbolicLink: () => k === 'link', nlink, size: typeof v === 'string' ? v.length : 0 });
        if (typeof v === 'string') return kind('file');
        // `{ hard }`: a file with a second name, its content another file's.
        if (v && typeof v === 'object' && typeof v.hard === 'string') return kind('file', 2);
        if (v && typeof v === 'object' && v.link) return kind('link');
        if (a === ROOT || Object.keys(files).some((f) => f.startsWith(a + path.sep))) return kind('dir');
        const e = new Error(`ENOENT: ${p}`); e.code = 'ENOENT'; throw e;
      },
    },
  };
}

const IO = fakeIo({
  [path.join(ROOT, 'src', 'a.mjs')]: 'one\ntwo\nthree\n',
  [path.join(ROOT, 'src', 'leak.mjs')]: { link: path.resolve('/elsewhere/secret.env') },
  [path.resolve('/elsewhere/secret.env')]: 'TOKEN=x\n',
  [path.join(ROOT, 'src', 'hard.mjs')]: { hard: 'TOKEN=x\n' },
});

test('finding-scope decides from a fake filesystem, with no disk behind it', () => {
  assert.equal(scope.countLines(path.join(ROOT, 'src', 'a.mjs'), IO), 3);
  assert.equal(scope.countLines(path.join(ROOT, 'src', 'none.mjs'), IO), null, 'unreadable is null, never zero');
  assert.equal(scope.escapesAfterRealpath(ROOT, path.join(ROOT, 'src', 'a.mjs'), IO), false);
  assert.equal(scope.escapesAfterRealpath(ROOT, path.join(ROOT, 'src', 'leak.mjs'), IO), true,
    'a link out of the tree escapes — decided entirely from what io reported');
  const errs = (file, line = 1) => scope.findingScopeErrors({ file, line }, { repoRoot: ROOT, io: IO });
  assert.deepEqual(errs('src/a.mjs', 2), []);
  assert.match(errs('src/a.mjs', 9)[0], /exceeds/);
  assert.match(errs('src/leak.mjs')[0], /through a link/);
  assert.match(errs('src/none.mjs')[0], /does not exist/);
});

test('excerpt reads through io, so a fake filesystem is enough', () => {
  const r = excerpt.readExcerpt({ repoRoot: ROOT, file: 'src/a.mjs', line: 2, radius: 1, io: IO });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.body, /two/);
  assert.deepEqual([r.from, r.to, r.of], [1, 3, 3], "a window of radius 1 around line 2, of a 3-line file");
  assert.equal(excerpt.readExcerpt({ repoRoot: ROOT, file: 'src/leak.mjs', line: 1, io: IO }).ok, false);
  // G-14 of 20261112-063354-hl-remediation-4-review: the excerpt goes into every judge's prompt, so a file with a second
  // name is refused by the egress owner, as at every other egress site.
  const hard = excerpt.readExcerpt({ repoRoot: ROOT, file: 'src/hard.mjs', line: 1, io: IO });
  assert.equal(hard.ok, false, `a hard-linked file was excerpted for a judge: ${JSON.stringify(hard)}`);
  assert.match(hard.why, /hard link/);
});

test('a missing io fails at the call, naming the function', () => {
  assert.throws(() => scope.countLines('x'), /countLines: an io implementation is required/);
  assert.throws(() => scope.escapesAfterRealpath('a', 'b'), /escapesAfterRealpath: an io implementation/);
  assert.throws(() => scope.findingScopeErrors({ file: 'x' }, { repoRoot: ROOT }), /findingScopeErrors: an io/);
  assert.throws(() => excerpt.readExcerpt({ repoRoot: ROOT, file: 'x', line: 1 }), /readExcerpt: an io/);
});

test('the converted modules import no filesystem or process module', () => {
  for (const m of ['finding-scope', 'excerpt', 'io-param', 'locate', 'project-paths',
    'version', 'reviewers', 'review-prompts', 'template', 'stamp-notes', 'project-profile', 'run-artifacts']) {
    const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'scripts', 'lib', `${m}.mjs`), 'utf8');
    assert.doesNotMatch(src, /from 'node:(fs|fs\/promises|child_process)'/, `lib/${m}.mjs does no I/O of its own`);
  }
});

test('locate and project-paths decide from a fake filesystem', () => {
  const scripts = path.join(ROOT, 'scripts');
  const io = { fs: { existsSync: (p) => [path.join(ROOT, 'skills'), path.join(ROOT, 'prompts', 'code-audit', 'PROMPT.md')].includes(path.resolve(p)), readFileSync() {} } };
  const dirs = locate.resolveFrameworkDirs(scripts, { io });
  assert.equal(dirs.skillsDir, path.join(ROOT, 'skills'));
  assert.deepEqual(locate.nodeInstructions(dirs, 'code-audit', { io }),
    { file: path.join(ROOT, 'prompts', 'code-audit', 'PROMPT.md'), home: 'prompts' });
  // An injected `exists` still needs no io at all — the seam these functions already had.
  assert.equal(locate.nodeInstructions(dirs, 'nope', { exists: () => false }), null);
  assert.throws(() => locate.resolveFrameworkDirs(scripts), /resolveFrameworkDirs: an io/);

  const skills = projectPaths.shadowedSkills({
    frameworkIds: ['code-audit'], consumerSkillsDir: '/x',
    readdir: () => ['code-audit', 'mine'], exists: () => false,
  });
  assert.ok(JSON.stringify(skills).includes('code-audit'), 'a collision is found from injected readers alone');
  assert.throws(() => projectPaths.shadowedSkills({ frameworkIds: [], consumerSkillsDir: '/x' }), /shadowedSkills: an io/);
});

// Found while moving project-paths onto io: `real.startsWith(realRoot + path.sep)` matches nothing
// when the repository IS a filesystem root, because path.resolve already ends `F:\` or `/` in a
// separator. isWithin is the one owner of that comparison (G-24, G-37) and handles it.
test('a repository at a filesystem root still resolves its requests directory', () => {
  const root = path.parse(process.cwd()).root;          // F:\ here, / on POSIX
  const requests = path.join(root, '.claude', 'requests');
  const io = { fs: { realpathSync: (p) => path.resolve(p), readFileSync() {} } };
  assert.equal(projectPaths.resolvedRequestsDir(root, { io }), requests);
  // Refusal is tested in an ORDINARY repository: at a filesystem root everything on the volume is
  // inside, so there is no "elsewhere" to escape to.
  const inRepo = path.join(ROOT, '.claude', 'requests');
  const away = { fs: { realpathSync: (p) => (path.resolve(p) === inRepo ? path.resolve('/elsewhere') : path.resolve(p)), readFileSync() {} } };
  assert.equal(projectPaths.resolvedRequestsDir(ROOT, { io: away }), null, 'a requests dir linked out of the repo is refused');
  assert.equal(projectPaths.resolvedRequestsDir(ROOT, { io }), inRepo);
});

test('version stamps from a fake filesystem and a fake git, with no process spawned', () => {
  const calls = [];
  const io = {
    fs: { readFileSync: (p) => { if (p.endsWith('VERSION')) return '9.9.9\n'; throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); } },
    git: (args) => { calls.push(['git', ...args].join(' ')); return { status: 0, stdout: args.includes('rev-parse') ? 'abc123\n' : '' }; },
  };
  const stamp = version.frameworkStamp('/fw', { io });
  assert.deepEqual({ version: stamp.version, commit: stamp.commit, dirty: stamp.dirty }, { version: '9.9.9', commit: 'abc123', dirty: false });
  assert.ok(calls.every((c) => c.startsWith('git -C /fw')), 'git is reached only through io.git, the engine\'s one git owner');
  assert.throws(() => version.frameworkStamp('/fw'), /frameworkStamp: an io/);
});

test('reviewers and run-artifacts read through io', () => {
  const io = { fs: { readFileSync: () => '{"reviewers":{"zed":{"cmd":"zed"}}}', existsSync: () => false } };
  assert.deepEqual(reviewers.builtinReviewers(io), { zed: { cmd: 'zed' } });
  assert.deepEqual(reviewers.builtinReviewers(() => '{"reviewers":{}}'), {}, 'an injected reader needs no io');
  assert.throws(() => reviewers.builtinReviewers(), /builtinReviewers: an io/);
  // A declared-reviewers probe with an injected reader needs no io; one reading a run's record must say so.
  assert.deepEqual(reviewers.declaredReviewers({ readContract: () => ({ absent: 'x' }) }), {});
  // A run's record is read through the caller's owner, which carries its own io (G-12 of
  // 20261029-235315-rdr-remediation-4-review); a raw run path is refused rather than given an io here.
  assert.throws(() => reviewers.declaredReviewers({ runDir: '/r' }), /declaredReviewers: pass `run`/);
  // A run holding only its record reads as empty, from io alone. A directory with NO record is refused outright
  // (secret-shapes-and-refusals, 2a: RunRefused), which this io, with nothing on it, also shows without the disk.
  // The run is read through the owner (run-dir-reads.plan.md stage 3), which lstats each name: only run.json is there,
  // a file and no link; everything else is ENOENT.
  const only = (p) => {
    if (!/run\.json$/.test(p)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return { isSymbolicLink: () => false, isFile: () => true, isDirectory: () => false };
  };
  const runOnly = { fs: {
    existsSync: (p) => /run\.json$/.test(p), lstatSync: only, statSync: only,
    readFileSync: () => '{"run_id":"20260101-000000-x"}', realpathSync: (p) => path.resolve(p),
  } };
  assert.doesNotThrow(() => artifacts.collectRun('/run', { io: runOnly }), 'a run holding only its record reads as empty, from io alone');
  assert.throws(() => artifacts.collectRun('/run', { io }), (e) => e?.name === 'RunRefused', 'a directory with no record is not refused');
  assert.throws(() => artifacts.collectRun('/run'), /collectRun: an io/);
  assert.throws(() => profile.listProfiles({ repoRoot: '/r' }), /listProfiles: an io/);
  assert.deepEqual(profile.listProfiles({ repoRoot: '/r', readdir: () => ['b.md', 'a.md', 'x.txt'] }), ['a', 'b']);
});

test('the prompt library renders from fake templates — the text a model reads comes through io', () => {
  const scriptsDir = path.resolve(import.meta.dirname, '..', 'scripts');
  const root = path.dirname(scriptsDir);
  const templates = path.join(root, 'prompts', '_templates');
  // lstatSync: a template is read through the egress owner (G-10 of 20261112-054852-hl-remediation-3-review), which checks
  // the file is a plain file with one name before the read the fake answers.
  const io = { fs: {
    existsSync: (p) => path.resolve(p) === path.join(root, 'skills'),
    lstatSync: (p) => {
      const dir = path.resolve(p) === templates;
      return { isFile: () => !dir, isDirectory: () => dir, isSymbolicLink: () => false, nlink: 1, size: 0 };
    },
    readFileSync: (p) => {
      if (path.dirname(p) !== templates) throw new Error(`unexpected read ${p}`);
      return `[${path.basename(p)}]`;
    },
  } };
  assert.equal(template.readTemplate('brief-feedback.md', io), '[brief-feedback.md]');
  const missing = { fs: { ...io.fs, readFileSync: () => { throw new Error('ENOENT'); } } };
  assert.throws(() => template.readTemplate('nope.md', missing), /prompt template nope\.md is missing at/);
  assert.throws(() => template.readTemplate('brief-feedback.md'), /readTemplate: an io/);
  assert.throws(() => prompts.vendorLabel('codex'), /vendorLabel: an io/, 'no silent fallback to the raw id');
  assert.equal(prompts.vendorLabel('codex', { codex: { label: 'Codex' } }), 'Codex', 'a supplied table needs no io');
});

// Criterion 5: lib/ reads neither the clock nor the environment — not even as a default parameter.
// Each of these used to fall back to Date.now(), new Date(), process.env or os.homedir() when the
// caller left the value out; now the value is an argument, and leaving it out is an error.
test('criterion 5: no clock or environment default in lib/', async () => {
  const { crashRecord } = await import('../scripts/lib/crash.mjs');
  const roots = await import('../scripts/lib/reviews-root.mjs');
  assert.throws(() => crashRecord({ phase: 'p', error: new Error('x') }), /crashRecord: `at` is required/);
  assert.equal(crashRecord({ phase: 'p', error: new Error('x'), at: 'T' }).at, 'T');
  assert.throws(() => roots.quorateHome(), /quorateHome: env and homedir are required/);
  assert.equal(roots.quorateHome({}, '/home/u'), path.join('/home/u', '.quorate'));
  assert.throws(() => roots.defaultReviewsRoot({ project: 'q', repoRoot: '/r' }), /defaultReviewsRoot: home is required/);
});

// CRITERIA 4 AND 5, LOCKED (os-platform-adapters stage 6). ARCHITECTURE §2 defines lib/ as the pure
// layer — "No I/O, no clock, no environment, no spawning. Inputs arrive as parameters." — and that
// sentence was false of 15 of 39 modules when G-4 of 20260924-181523-post-med5 raised it. This is what
// keeps it true: it reads every module rather than a list, so a module added tomorrow is covered.
//
// REWRITTEN for G-29 and G-30 of 20260925-015614-platform-review. The first version matched only a
// single-quoted `from '...'` import, so `import fs from "node:fs"`, a bare `import "node:fs"` and a
// dynamic `import('node:fs')` all passed; and it erased every template literal before scanning, so
// `${process.env.TOKEN}` — CODE, inside a template — was never seen. A lock with a hole shaped like
// an ordinary quoting choice is not a lock.
//
// Four things are refused:
//   - importing fs, fs/promises, child_process or os, with or without `node:`, in any import form;
//   - importing scripts/platform/ or scripts/io/ — the back door into the host;
//   - reading process.env, process.platform, process.cwd(), Date.now() or a bare new Date() in CODE;
//   - a raw path.resolve( outside lib/paths.mjs (G-15): resolving a relative path reads the working
//     directory, the same ambient read as process.cwd() spelled another way. lib/paths.mjs is the one
//     place a path becomes absolute, and it refuses a relative one instead of resolving it.

/** Every module specifier a line imports, in any of the three ESM forms. */
const SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"]+)\1/g;
const FORBIDDEN_SPEC = /^(?:node:)?(?:fs|fs\/promises|child_process|os)$|^\.\.\/(?:platform|io)\//;
const AMBIENT = /process\.(env|platform|execPath|cwd\(\))|Date\.now\(|new Date\(\)|path\.resolve\(/;

/**
 * The CODE of a module: comments and string text removed, newlines kept (so line numbers survive),
 * and the expressions inside a template's `${...}` KEPT — they execute. A small lexer rather than a
 * regex, because a regex cannot know it is inside a template, a comment or a regex literal.
 */
function codeOnly(src) {
  let out = '';
  let i = 0;
  const stack = [];   // brace depth at which each open template's ${ } returns to template text
  let depth = 0;
  let prevSignificant = '';
  const regexCanStart = () => prevSignificant === '' || /[(,=:[!&|?{};+\-*%<>~^]/.test(prevSignificant)
    || /\b(return|typeof|case|of|in)$/.test(out.trimEnd());
  const inTemplate = () => stack.length > 0 && stack[stack.length - 1] === -1;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (inTemplate()) {
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { stack.pop(); out += "''"; i += 1; prevSignificant = "'"; continue; }
      if (c === '$' && n === '{') { stack[stack.length - 1] = depth; depth += 1; out += ' '; i += 2; continue; }
      if (c === '\n') out += '\n';
      i += 1;
      continue;
    }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
    if (c === '/' && n === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') out += '\n'; i += 1; }
      i += 2;
      continue;
    }
    if (c === "'" || c === '"') {
      i += 1;
      while (i < src.length && src[i] !== c && src[i] !== '\n') i += src[i] === '\\' ? 2 : 1;
      i += 1; out += "''"; prevSignificant = "'";
      continue;
    }
    if (c === '`') { stack.push(-1); i += 1; continue; }
    if (c === '/' && regexCanStart()) {
      i += 1;
      let cls = false;
      while (i < src.length && src[i] !== '\n') {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '[') cls = true; else if (src[i] === ']') cls = false;
        else if (src[i] === '/' && !cls) break;
        i += 1;
      }
      i += 1;
      while (/[a-z]/.test(src[i] ?? '')) i += 1;
      out += '/r/'; prevSignificant = '/';
      continue;
    }
    if (c === '{') depth += 1;
    if (c === '}') {
      depth -= 1;
      if (stack.length && stack[stack.length - 1] === depth) { stack[stack.length - 1] = -1; i += 1; continue; }
    }
    out += c;
    if (!/\s/.test(c)) prevSignificant = c;
    i += 1;
  }
  return out;
}

function offencesIn(name, src) {
  const offences = [];
  const code = codeOnly(src);
  // Imports are checked on the RAW source (a specifier is a string, which codeOnly removes), with
  // comment lines skipped — a comment naming node:fs is documentation, not an import.
  src.split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    for (const m of line.matchAll(SPEC)) {
      if (FORBIDDEN_SPEC.test(m[2])) offences.push(`${name}:${i + 1} imports ${m[2]}`);
    }
  });
  if (name !== 'paths.mjs') {
    code.split('\n').forEach((line, i) => {
      const m = line.match(AMBIENT);
      if (m) offences.push(`${name}:${i + 1} reads ${m[0]}`);
    });
  } else {
    code.split('\n').forEach((line, i) => {
      const m = line.match(/process\.(env|platform|cwd\(\))|Date\.now\(|new Date\(\)/);
      if (m) offences.push(`${name}:${i + 1} reads ${m[0]}`);
    });
  }
  return offences;
}

test('criteria 4 and 5: no module in scripts/lib/ does I/O or reads the clock, environment or cwd', () => {
  const LIB = path.join(import.meta.dirname, '..', 'scripts', 'lib');
  const offences = [];
  for (const f of fs.readdirSync(LIB).filter((n) => n.endsWith('.mjs'))) {
    offences.push(...offencesIn(f, fs.readFileSync(path.join(LIB, f), 'utf8')));
  }
  assert.deepEqual(offences, [], 'take it as a parameter (io, now, env), make the path absolute through lib/paths.mjs, or move the code to scripts/io/');
});

test('the lock can fail — every import form and every place code can hide', () => {
  const bad = [
    ["import fs from 'node:fs';", 'single quotes'],
    ['import fs from "node:fs";', 'double quotes (G-29)'],
    ["import 'node:child_process';", 'bare side-effect import'],
    ["const m = await import('node:fs');", 'dynamic import (G-29)'],
    ["import { spawn } from 'child_process';", 'no node: prefix'],
    ["import { hostFs } from '../platform/index.mjs';", 'the platform back door'],
    ["import { x } from '../io/atomic.mjs';", 'the io back door'],
    ['const t = `token ${process.env.TOKEN}`;', 'an interpolation inside a template (G-30)'],
    ['const d = new Date();', 'a bare clock read'],
    ['const a = path.resolve(p);', 'a cwd-relative resolve (G-15)'],
  ];
  for (const [src, what] of bad) assert.ok(offencesIn('x.mjs', src).length > 0, `must catch: ${what}`);
  const fine = [
    ['// import fs from "node:fs"', 'a comment'],
    ["const s = 'process.env is not read here';", 'a string'],
    ['const s = `no ${1 + 1} reads of process.env here`;', 'template TEXT'],
    ['const d = new Date(entry.at);', 'converting a given time'],
    ["const re = /['\"]process.env/;", 'a regex literal containing quotes'],
  ];
  for (const [src, what] of fine) assert.deepEqual(offencesIn('x.mjs', src), [], `must not flag: ${what}`);
});

// G-15 of 20260925-015614-platform-review, behaviourally: two decisions that let the working
// directory fill in a missing parameter.
test('G-15: a relative QUORATE_HOME is refused, and an empty reviews_dir is refused, not "here"', async () => {
  const roots = await import('../scripts/lib/reviews-root.mjs');
  assert.throws(() => roots.quorateHome({ QUORATE_HOME: 'relative/home' }, path.resolve('/home/u')), /QUORATE_HOME: an absolute path is required/);
  assert.equal(roots.quorateHome({ QUORATE_HOME: path.resolve('/q') }, path.resolve('/home/u')), path.resolve('/q'));
  // path.resolve('') is the working directory, so this refusal could never fire before.
  const r = roots.reviewsRootAllowed({ repoRoot: path.resolve('/r'), home: path.resolve('/h'), candidate: '', isWithin: () => true });
  assert.deepEqual([r.ok, r.why], [false, 'review.reviews_dir resolved to nothing']);
  assert.equal(roots.runDirAllowed({ repoRoot: path.resolve('/r'), home: path.resolve('/h'), runDir: '', isWithin: () => true, escapesAfterRealpath: () => false }).ok, false);
});
