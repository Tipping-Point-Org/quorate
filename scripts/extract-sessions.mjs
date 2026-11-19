#!/usr/bin/env node
// extract-sessions.mjs — turn Claude Code transcripts into a digest a human can actually read.
//
// The build log was first written from git history, because that was what was in front of me. Git
// is the wrong primary source: a commit message is written after the fact, by the person who made
// the change, and already carries their framing of it. The transcripts are the record.
//
// WHAT IS ACTUALLY IN THE TRANSCRIPT DIRECTORY, measured before this script was written, because
// the assumption and the reality differed:
//
//   170 of 171 sessions are `sdk-cli`  — nodes this engine SPAWNED (arch-review, security-audit,
//                                        second-opinion, …), one transcript per node per run
//     1 of 171 is `cli`                — an interactive human session
//
// So the directory is mostly the engine's own subprocess record. That makes two datasets, not one,
// and this script emits both:
//
//   sessions/<date>.md   the human record: every user turn verbatim, timestamped, with the commits
//                        that landed in the same window. This is what a log entry is written FROM.
//   sessions/nodes.json  the node record: per lens, per run — turns, tools, duration, model. What
//                        the lenses actually DID, which nothing has ever measured.
//
// Streams line by line: the directory is 147 MB and one session file is 31 MB.
//
// NO GRAPH_NODE_DEPTH GUARD: reads files, spawns nothing (§8, same class as capture.mjs).
//
//   node scripts/extract-sessions.mjs [--project F--quorate] [--out blog/sessions]
//                                     [--since 2026-09-01] [--nodes-only|--human-only]
//
// Exit codes: 0 wrote a digest · 1 could not read the transcripts · 2 usage.

import fs from 'node:fs';
import { parseArgv, ArgvError } from './lib/argv.mjs';
import { ARGV_SPECS } from './lib/argv-specs.mjs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { gitSync } from './io/git.mjs';

function die(msg, code = 2) {
  console.error(`extract-sessions: ${msg}`);
  process.exit(code);
}

const args = { project: 'F--quorate', out: 'blog/sessions' };
{
  // ONE PARSER, lib/argv.mjs's, against this script's spec in lib/argv-specs.mjs (entrypoint-argv.plan.md).
  let v;
  try { ({ values: v } = parseArgv(process.argv.slice(2), ARGV_SPECS['extract-sessions'])); } catch (e) { if (e instanceof ArgvError) die(e.message); throw e; }
  if (v.project !== undefined) args.project = v.project;
  if (v.out !== undefined) args.out = v.out;
  if (v.since !== undefined) args.since = v.since;
  if (v['nodes-only']) args.nodesOnly = true;
  if (v['human-only']) args.humanOnly = true;
}

const PROJECTS = path.join(os.homedir(), '.claude', 'projects');
const SRC = path.join(PROJECTS, args.project);
if (!fs.existsSync(SRC)) {
  // No PROJECTS directory at all is a first-use machine: say so, rather than die listing it (G-3 of 20261023-205906-ger-delivery).
  // One that exists but cannot be listed is named the same way, not thrown past `die` (G-1 of 20261023-214545-ger-remediation-review).
  let available;
  try { available = fs.readdirSync(PROJECTS).filter((d) => !d.startsWith('C--Users')).join(', '); } catch (e) { available = e.code === 'ENOENT' ? `none (no ${PROJECTS})` : `none (${PROJECTS} cannot be listed: ${e.code ?? e.message})`; }
  die(`no transcript directory at ${SRC}. Available: ${available}`, 1);
}

const OUT = path.resolve(args.out);
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------- reading a session
//
// One pass per file, one line at a time. A transcript line can be megabytes (a tool result carrying
// a whole file), so nothing is accumulated that is not needed: text is truncated at read time
// rather than after.
const TEXT_CAP = 4000;

/** The plain text of a message, whatever shape the content is in. */
function textOf(message) {
  const c = message?.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c.filter((i) => i?.type === 'text').map((i) => String(i.text ?? '')).join('\n');
}

/** How much of the assistant's previous message to keep for the quoted-back check. */
const ASSISTANT_TAIL = 12000;

/** Whitespace-insensitive, case-insensitive text, for comparing a quote against its source. */
const flat = (t) => String(t ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * THE OPERATOR'S CONVENTION, and the defect that made it worth encoding.
 *
 * Turns are written as `<context>: <reply>` — context first, usually a phrase copied out of the
 * assistant's previous message, then the actual question after the colon. Sometimes several such
 * pairs in one turn, one per line. Sometimes no colon at all.
 *
 * Read naively the whole line looks like the operator speaking, and a build log written that way
 * put THE ASSISTANT'S OWN WORDS in the operator's mouth — four quotations out of eight, on a page
 * whose standing claim is that nothing in it is paraphrase.
 *
 * The comparison is whitespace-normalised on purpose: copying two lines of output collapses
 * `xxxx\nyyyy` into `xxxx yyyy`, with the spacing tidied by hand or not. An exact-match test would
 * miss most real cases and give a false impression that none exist.
 *
 * Conservative by design. A match is strong evidence the prefix was quoted; a NON-match proves
 * nothing, because the context is not always a quotation. So this annotates, and never rewrites.
 */
function quotedBackPrefixes(turnText, assistantText) {
  const hay = flat(assistantText);
  if (!hay) return [];
  const out = [];
  for (const line of String(turnText ?? '').split('\n')) {
    const at = line.indexOf(':');
    if (at < 12) continue;                       // too short to be a meaningful quotation
    const prefix = line.slice(0, at).trim();
    if (prefix.length > 220) continue;           // a long line with a colon is prose, not a label
    if (hay.includes(flat(prefix))) out.push(prefix);
  }
  return out;
}

/** Tool names a message invoked, in order. */
function toolsOf(message) {
  const c = message?.content;
  if (!Array.isArray(c)) return [];
  return c.filter((i) => i?.type === 'tool_use').map((i) => String(i.name ?? '?'));
}

async function readSession(file) {
  const s = {
    file: path.basename(file),
    sessionId: null,
    title: null,
    entrypoint: null,
    cwd: null,
    branch: null,
    firstAt: null,
    lastAt: null,
    userTurns: [],       // human record
    plumbingTurns: 0,    // slash-command echoes and reminders: counted, never quoted
    assistantTurns: 0,
    tools: {},           // node record; commits come from git (commitsByDay), not from here (G-3 of 20261023-214545-ger-remediation-review)
    models: new Set(),
    efforts: new Set(),
  };

  let lastAssistantText = '';

  const rl = readline.createInterface({
    input: fs.createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let d;
    // Counted, never dropped in silence: a truncated live transcript is a partial record (G-4 of 20261023-205906-ger-delivery),
    // and so is any line that is not a JSON object, whatever its first character (G-2 of 20261023-214545-ger-remediation-review).
    try { d = JSON.parse(line); if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('not a record'); } catch { s.unparsed = (s.unparsed ?? 0) + 1; continue; }

    if (d.type === 'ai-title' && !s.title) s.title = String(d.aiTitle ?? '').slice(0, 120);
    if (d.sessionId && !s.sessionId) s.sessionId = d.sessionId;
    if (d.entrypoint && !s.entrypoint) s.entrypoint = d.entrypoint;
    if (d.cwd && !s.cwd) s.cwd = d.cwd;
    if (d.gitBranch && !s.branch) s.branch = d.gitBranch;
    if (d.timestamp) {
      if (!s.firstAt || d.timestamp < s.firstAt) s.firstAt = d.timestamp;
      if (!s.lastAt || d.timestamp > s.lastAt) s.lastAt = d.timestamp;
    }

    if (d.type === 'assistant') {
      s.assistantTurns += 1;
      // The last thing the assistant said, kept so the NEXT user turn can be checked against it.
      // Bounded: only the tail is ever needed, and one transcript line can be megabytes.
      const said = textOf(d.message);
      if (said.trim()) lastAssistantText = said.slice(-ASSISTANT_TAIL);
      if (d.message?.model) s.models.add(d.message.model);
      if (d.effort) s.efforts.add(d.effort);
      for (const t of toolsOf(d.message)) s.tools[t] = (s.tools[t] ?? 0) + 1;
      continue;
    }

    if (d.type !== 'user') continue;
    // A `user` record is not necessarily a person: tool results come back as user messages, and a
    // spawned node's whole prompt arrives as one. Both are excluded — the first by shape, the
    // second because a node session has no human in it at all.
    const t = textOf(d.message);
    if (!t.trim()) continue;
    if (Array.isArray(d.message?.content) && d.message.content.some((i) => i?.type === 'tool_result')) continue;
    // NOT EVERY `user` RECORD IS THE OPERATOR. Slash-command plumbing arrives on the same channel —
    // `<command-name>/exit</command-name>`, the stdout it produced, the caveat the CLI attaches to
    // it — and so do system reminders. The first version of this script wrote those into a file
    // whose own header promises "every turn below is the operator's own words", which is precisely
    // the defect this project hunts elsewhere: an artifact asserting more than it holds.
    //
    // Dropped, but COUNTED and reported, because a digest that silently omits part of its source is
    // the same failure in the other direction.
    if (/^\s*<(command-name|command-message|command-args|local-command-stdout|local-command-caveat|system-reminder)/.test(t)) {
      s.plumbingTurns += 1;
      continue;
    }
    s.userTurns.push({
      at: d.timestamp ?? null,
      text: t.length > TEXT_CAP ? `${t.slice(0, TEXT_CAP)}\n…[${t.length - TEXT_CAP} more characters]` : t,
      quotedBack: quotedBackPrefixes(t, lastAssistantText),
      // A continuation summary is ABOUT the conversation, not speech in it. Quoting one as the
      // operator's words is second-hand at best: it is the assistant's summary of what they said.
      isSummary: /This session is being continued from a previous conversation|Primary Request and Intent/.test(t),
    });
  }

  s.models = [...s.models];
  s.efforts = [...s.efforts];
  return s;
}

// ---------------------------------------------------------------------------- commits, for context
//
// A human turn is more legible next to what it produced. Commits are read once, from the repository
// this script lives in, and matched to a turn by time window rather than by guessing.
function commitsByDay() {
  // Bounded by --since when given: only days on or after it are written (G-4 of 20261023-214545-ger-remediation-review). A
  // day early, because git reads the date in local time and by committer date, and a day is bucketed by its author offset.
  const sinceMs = args.since ? Date.parse(args.since) : NaN;
  const window = Number.isNaN(sinceMs) ? [] : [`--since=${new Date(sinceMs - 86400000).toISOString().slice(0, 10)}`];
  const r = gitSync(['log', '--format=%aI%x09%s', ...window], { encoding: 'utf8' });
  const byDay = {};
  if (r.status !== 0) return byDay;
  for (const line of r.stdout.split('\n')) {
    const [iso, subject] = line.split('\t');
    if (!iso || !subject) continue;
    const day = iso.slice(0, 10);
    (byDay[day] ??= []).push({ at: iso, subject });
  }
  return byDay;
}

// ---------------------------------------------------------------------------------------- output
const esc = (s) => String(s ?? '').replace(/\r/g, '');

function writeHumanDigest(sessions, commits) {
  const byDay = {};
  for (const s of sessions) {
    for (const turn of s.userTurns) {
      const day = (turn.at ?? s.firstAt ?? '').slice(0, 10) || 'undated';
      (byDay[day] ??= []).push({ ...turn, session: s });
    }
  }

  const days = Object.keys(byDay).sort();
  for (const day of days) {
    const turns = byDay[day].sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const L = [];
    L.push(`# ${day} — session digest`, '');
    L.push('> Extracted verbatim from Claude Code transcripts by `scripts/extract-sessions.mjs`.',
      '> Every turn below is the operator\'s own words. Nothing here is paraphrase, and nothing is',
      '> summarised — that is the whole point of extracting rather than remembering.', '');

    const sessionsToday = [...new Set(turns.map((t) => t.session.sessionId))];
    L.push(`**Sessions:** ${sessionsToday.map((id) => `\`${String(id).slice(0, 8)}\``).join(', ')}`, '');
    const plumbing = [...new Set(turns.map((t) => t.session))].reduce((n, s2) => n + (s2.plumbingTurns ?? 0), 0);
    if (plumbing) {
      L.push('', `_${plumbing} slash-command echo(es) and system reminder(s) were excluded from this`
        + ` session — they arrive on the same channel as the operator's turns and are not their words._`);
    }
    L.push('');

    const dayCommits = commits[day] ?? [];
    if (dayCommits.length) {
      L.push(`**Commits that day (${dayCommits.length}):**`, '');
      for (const c of dayCommits) L.push(`- \`${c.at.slice(11, 16)}\` ${c.subject}`);
      L.push('');
    }

    L.push('## Turns', '');
    for (const t of turns) {
      const time = t.at ? t.at.slice(11, 19) : '--:--:--';
      L.push(`### ${time} · \`${String(t.session.sessionId).slice(0, 8)}\``, '');
      // THE WARNINGS COME FIRST, so nobody quotes the turn before reading them.
      if (t.isSummary) {
        L.push('**CONTINUATION SUMMARY — not speech.** This turn is the assistant\'s summary of an',
          'earlier conversation. Anything in it attributed to the operator is second-hand and must not',
          'be quoted as their words.', '');
      }
      if (t.quotedBack?.length) {
        L.push(`**${t.quotedBack.length} line(s) open by quoting the assistant.** The operator's own words`,
          'begin after the colon; the prefix is context they copied in — do not attribute it to them:', '');
        for (const q of t.quotedBack) L.push(`  - quoted back: \`${q.replace(/`/g, "'")}\``);
        L.push('');
      }
      L.push(esc(t.text).split('\n').map((l) => `> ${l}`).join('\n'), '');
    }
    fs.writeFileSync(path.join(OUT, `${day}.md`), `${L.join('\n')}\n`);
  }
  return days;
}

function writeNodeDigest(sessions) {
  // A node session's title is the lens it ran; its cwd names the run directory when the node was
  // spawned inside one. Both are recorded so a row can be traced back to the run that produced it.
  const rows = sessions.map((s) => ({
    session: s.sessionId,
    title: s.title,
    at: s.firstAt,
    duration_s: s.firstAt && s.lastAt
      ? Math.round((Date.parse(s.lastAt) - Date.parse(s.firstAt)) / 1000)
      : null,
    cwd: s.cwd,
    branch: s.branch,
    assistant_turns: s.assistantTurns,
    tools: s.tools,
    tool_calls: Object.values(s.tools).reduce((n, v) => n + v, 0),
    models: s.models,
    efforts: s.efforts,
  })).sort((a, b) => String(a.at).localeCompare(String(b.at)));

  fs.writeFileSync(path.join(OUT, 'nodes.json'), `${JSON.stringify({
    schema_version: 1,
    extracted_at: new Date().toISOString(),
    source: SRC,
    count: rows.length,
    rows,
  }, null, 2)}\n`);
  return rows;
}

// ------------------------------------------------------------------------------------------ main
// A directory that exists but cannot be listed is a diagnostic, not a raw exception (G-5 of 20261023-214545-ger-remediation-review).
let listed;
try { listed = fs.readdirSync(SRC); } catch (e) { die(`cannot list ${SRC}: ${e.code ?? e.message}`, 1); }
const files = listed.filter((f) => f.endsWith('.jsonl')).map((f) => path.join(SRC, f));
if (!files.length) die(`no .jsonl transcripts in ${SRC}`, 1);

/**
 * Does this transcript begin before `since`, judged from its head alone?
 *
 * Reads a small prefix rather than the file: a session's first event is its earliest, so the first
 * line carrying a timestamp answers the question. Returns false when it cannot tell — an undated or
 * unreadable head means "do not skip", so the authoritative check after the full read still decides
 * and a malformed file is still reported by name.
 */
async function startsBefore(file, since) {
  let handle;
  try {
    handle = await fsp.open(file, 'r');
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(64 * 1024), 0, 64 * 1024, 0);
    const head = buffer.subarray(0, bytesRead).toString('utf8');
    for (const line of head.split(String.fromCharCode(10))) {
      if (!line.trim()) continue;
      let d;
      try { d = JSON.parse(line); } catch { continue; }   // a truncated last line is not an answer
      if (typeof d?.timestamp === 'string' && d.timestamp) {
        return d.timestamp.slice(0, 10) < since;
      }
    }
    return false;
  } catch {
    return false;
  } finally {
    await handle?.close();
  }
}

const sessions = [];
for (const f of files) {
  try {
    // THE WINDOW IS APPLIED BEFORE THE READ (G-14, perf-audit). `--since` was tested against
    // `s.firstAt` only AFTER readSession had streamed the whole transcript and JSON.parsed every
    // line of it, so a session entirely outside the window still cost its full read and was then
    // discarded — the flag named a window it did not bound, and the work stayed proportional to the
    // whole corpus. On this machine that corpus is ~184 MB and grows with every session, with a
    // single transcript recorded at 31 MB.
    //
    // The first timestamped line is enough to decide, and it is at the head of the file: a session's
    // first event is its earliest. A file whose head carries no timestamp is READ, not skipped —
    // this is a cheap pre-filter, and the authoritative test below still runs. An unreadable head is
    // the same: fall through and let readSession report it by name.
    if (args.since && await startsBefore(f, args.since)) continue;
    const s = await readSession(f);
    if (s.unparsed) console.error(`  ${s.unparsed} unparseable record(s) skipped in ${path.basename(f)}`);
    if (args.since && s.firstAt && s.firstAt.slice(0, 10) < args.since) continue;
    sessions.push(s);
  } catch (e) {
    // A transcript that cannot be read is NAMED, never skipped in silence: a digest that quietly
    // covered 170 of 171 sessions would be exactly the kind of partial record this whole project
    // refuses elsewhere.
    console.error(`  unreadable: ${path.basename(f)} (${e.code ?? e.message})`);
  }
}

const human = sessions.filter((s) => s.entrypoint === 'cli');
const nodes = sessions.filter((s) => s.entrypoint !== 'cli');

console.log(`extract-sessions: ${sessions.length} session(s) in ${args.project}`);
console.log(`  ${human.length} interactive (cli) · ${nodes.length} spawned nodes (sdk-cli)`);

if (!args.nodesOnly) {
  const days = writeHumanDigest(human, commitsByDay());
  console.log(`  wrote ${days.length} day digest(s): ${days.join(', ') || '(none)'}`);
}
if (!args.humanOnly) {
  const rows = writeNodeDigest(nodes);
  const byLens = {};
  for (const r of rows) {
    const k = (r.title ?? 'untitled').toLowerCase().replace(/[^a-z-]+/g, ' ').trim().split(' ')[0] || 'untitled';
    (byLens[k] ??= []).push(r);
  }
  console.log(`  wrote nodes.json (${rows.length} node session(s))`);
  for (const [k, v] of Object.entries(byLens).sort((a, b) => b[1].length - a[1].length).slice(0, 8)) {
    const turns = v.map((r) => r.assistant_turns).sort((a, b) => a - b);
    const median = turns[Math.floor(turns.length / 2)] ?? 0;
    console.log(`    ${String(v.length).padStart(3)} × ${k.padEnd(14)} median ${String(median).padStart(3)} turns`);
  }
}
console.log(`  → ${path.relative(process.cwd(), OUT)}`);
