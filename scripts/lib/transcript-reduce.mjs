// What of a session transcript the claim checker reads (operator, 2026-10-25: "exploring the repo looks like tokens better
// spent than reading command outputs"; and, on the files a reduced copy no longer shows, "when such reference is found
// output some text about it. this may reduce the repo exploration").
//
// The checker reads the transcript to check a claim about the operator: their words, the question they answered, the
// option they chose. Commands and their outputs are dropped (measured 2026-10-25: 53.4 MB down to 0.87 MB, the copy's
// preparation from 3 min 23 s to about 1 s, the attribution claim confirmed instead of turned into a question). Three
// things are kept: operator and assistant text (system reminders dropped); the question tool's exchanges, because an
// option the operator picks there is stored as a tool result; and one line per file change and commit, so the checker
// knows which files the conversation touched without reading the calls that touched them.
//
// Pure: one parsed record in, the record to write (or null) out. `state` carries what a later record needs from an
// earlier one (which tool calls were questions or commits).

const EDIT_TOOLS = { Edit: 'edited', MultiEdit: 'edited', Write: 'wrote', NotebookEdit: 'edited' };
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
const REMINDER = /^<(system-reminder|task-notification)/;
// git commit's first output line: "[branch abc1234] subject" (a root commit adds "(root-commit)").
const COMMITTED = /^\[[^\]\s]+(?: \(root-commit\))? ([0-9a-f]{7,40})\] (.+)$/m;

export function newReduceState() {
  return { questions: new Set(), commits: new Set() };
}

const marker = (text) => ({ type: 'text', text });

function resultText(part) {
  const c = part?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter((x) => x?.type === 'text').map((x) => x.text).join('\n');
  return '';
}

/** The reduced record, or null when nothing of it is kept. */
export function reduceRecord(o, state) {
  if (!o || !['user', 'assistant'].includes(o.type)) return null;
  const c = o.message?.content;
  if (c == null) return null;
  const parts = typeof c === 'string' ? [{ type: 'text', text: c }] : Array.isArray(c) ? c : [];
  const kept = [];
  for (const p of parts) {
    if (p?.type === 'text') {
      if (!REMINDER.test(String(p.text ?? '').trim())) kept.push({ type: 'text', text: p.text });
    } else if (p?.type === 'tool_use') {
      const input = p.input ?? {};
      if (p.name === 'AskUserQuestion') {
        state.questions.add(p.id);
        kept.push(p);
      } else if (EDIT_TOOLS[p.name] && (input.file_path || input.notebook_path)) {
        kept.push(marker(`[${EDIT_TOOLS[p.name]} ${input.file_path ?? input.notebook_path}]`));
      } else if (SHELL_TOOLS.has(p.name) && /\bgit\b[^\n]*\bcommit\b/.test(String(input.command ?? ''))) {
        state.commits.add(p.id);
      }
    } else if (p?.type === 'tool_result') {
      if (state.questions.has(p.tool_use_id)) kept.push(p);
      else if (state.commits.has(p.tool_use_id)) {
        const m = COMMITTED.exec(resultText(p));
        if (m) kept.push(marker(`[committed ${m[1]}: ${m[2]}]`));
      }
    }
  }
  if (!kept.length) return null;
  return { type: o.type, timestamp: o.timestamp, message: { role: o.message?.role ?? o.type, content: kept } };
}
