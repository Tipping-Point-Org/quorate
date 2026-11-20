// The install a newcomer does, run on a clean machine: ROADMAP.md M2's exit gate, "a fresh clone, on a machine that is
// not this one, installs into a throwaway consumer by following QUORATE.md alone, and check-install reports no problems".
// CI runs it on the public repository's push (checks.yml, job `install`), because the operator has no second machine
// (2026-11-19: "I have no spare machi so it is up to you if we use a container or wsl").
//
//   node tests/tools/install-from-repo.mjs --url <clone url> [--ref <commit or tag>]
//
// Every step is a QUORATE.md Setup step, in its order. The engine home, HOME and the git config are fresh and empty, and
// the clone is unauthenticated. Exit 0 only when every step does.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const url = flag('--url'), ref = flag('--ref');
if (!url || args.some((a, i) => a.startsWith('--') && !['--url', '--ref'].includes(a) && i % 2 === 0)) {
  console.error('usage: node tests/tools/install-from-repo.mjs --url <clone url> [--ref <commit or tag>]');
  process.exit(2);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-install-'));
const home = path.join(work, 'home'), consumer = path.join(work, 'consumer');
fs.mkdirSync(home); fs.mkdirSync(consumer);
// An allow-list, not a deny-list: a fresh machine has none of the runner's git environment config (GIT_CONFIG_COUNT and
// its GIT_CONFIG_KEY_n/VALUE_n), credential helpers (GIT_ASKPASS, SSH_ASKPASS), agent sockets (SSH_AUTH_SOCK), tokens or
// QUORATE_* settings, and any of them would let the install pass on what only the runner has (G-12 of
// 20261120-010728-m2-gaps-review). Kept: what a process needs to start and find git and node.
const KEEP = new Set(['PATH', 'PATHEXT', 'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR',
  'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'TZ', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMDATA', 'NUMBER_OF_PROCESSORS']);
const env = {};
for (const [k, v] of Object.entries(process.env)) if (KEEP.has(k.toUpperCase())) env[k] = v;
Object.assign(env, { HOME: home, USERPROFILE: home, GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig'),
  GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' });

let failed = false;
const step = (title, cmd, argv, { mayFail = false } = {}) => {
  console.log(`\n$ ${cmd} ${argv.join(' ')}   # ${title}`);
  const r = spawnSync(cmd, argv, { cwd: consumer, env, encoding: 'utf8' });
  process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || '');
  console.log(`[exit ${r.status}]`);
  if (r.status !== 0 && !mayFail) failed = true;
  return r;
};

step('git identity for the consumer', 'git', ['config', '--global', 'user.name', 'install check']);
step('', 'git', ['config', '--global', 'user.email', 'install-check@example.invalid']);
step('a throwaway consumer', 'git', ['init', '-q']);
fs.mkdirSync(path.join(consumer, 'src'));
fs.writeFileSync(path.join(consumer, 'src', 'app.js'), 'export const answer = 42;\n');
step('', 'git', ['add', 'src']);
step('', 'git', ['commit', '-qm', 'consumer: initial']);

// Setup step 1: collisions, then mount.
const skills = path.join(consumer, '.claude', 'skills');
console.log(`\n# step 1: skill names already here: ${fs.existsSync(skills) ? fs.readdirSync(skills).join(', ') || 'none' : 'none'}`);
step('mount', 'git', ['-c', 'credential.helper=', 'submodule', 'add', url, '.claude/skills/quorate']);
if (ref) {
  step('pin the mount to the commit under test', 'git', ['-C', '.claude/skills/quorate', 'fetch', '-q', 'origin', ref]);
  step('', 'git', ['-C', '.claude/skills/quorate', 'checkout', '-q', '--detach', 'FETCH_HEAD']);
}
step('what is mounted', 'git', ['-C', '.claude/skills/quorate', 'log', '-1', '--format=%H %s']);

// Setup step 2: the contract from the template, its two name placeholders filled, and the QUORATE.md import.
const template = path.join(consumer, '.claude', 'skills', 'quorate', 'CLAUDE.template.md');
if (fs.existsSync(template)) {
  let text = fs.readFileSync(template, 'utf8')
    .replace('<your-project-name>', 'install-check').replace('<project-slug>', 'install-check');
  if (!text.includes('@.claude/skills/quorate/QUORATE.md')) text = text.replace(/\n/, '\n\n@.claude/skills/quorate/QUORATE.md\n');
  fs.writeFileSync(path.join(consumer, 'CLAUDE.md'), text);
  console.log('\n# step 2: CLAUDE.md written from the template');
} else { console.log(`\n# step 2: no template at ${template}`); failed = true; }
step('validate the contract', process.execPath, ['.claude/skills/quorate/scripts/new-run.mjs', '--dry-run', '--full-sweep', 'src']);

// Setup step 3: check the install.
step('check the install', process.execPath, ['.claude/skills/quorate/scripts/check-install.mjs']);

fs.rmSync(work, { recursive: true, force: true });
console.log(`\ninstall check: ${failed ? 'FAILED' : 'every step passed'}`);
process.exit(failed ? 1 : 0);
