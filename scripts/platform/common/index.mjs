// WHAT IS IDENTICAL ON EVERY OPERATING SYSTEM (os-platform-adapters, criterion 1).
//
// Node's filesystem and process APIs already behave the same on win32, linux and macos for every
// operation the engine performs, so they are implemented once, here, and each OS folder builds on
// these objects and supplies only what differs. A member that turns out to differ later moves into
// the OS folders then — the interface does not change, only who implements it.
import fs from 'node:fs';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';

export const commonFs = Object.freeze({
  readFileSync: fs.readFileSync,
  writeFileSync: fs.writeFileSync,
  existsSync: fs.existsSync,
  statSync: fs.statSync,
  lstatSync: fs.lstatSync,
  realpathSync: fs.realpathSync,
  readdirSync: fs.readdirSync,
  readlinkSync: fs.readlinkSync,
  mkdirSync: fs.mkdirSync,
  rmSync: fs.rmSync,
  renameSync: fs.renameSync,
  copyFileSync: fs.copyFileSync,
  cpSync: fs.cpSync,
  symlinkSync: fs.symlinkSync,
  openSync: fs.openSync,
  readSync: fs.readSync,
  fsyncSync: fs.fsyncSync,
  closeSync: fs.closeSync,
  appendFileSync: fs.appendFileSync,
  utimesSync: fs.utimesSync,
  rmdirSync: fs.rmdirSync,
  chmodSync: fs.chmodSync,
});

export const commonProc = Object.freeze({
  spawn,
  spawnSync,
  // Signal 0 delivers nothing and only tests existence, on every OS Node supports. EPERM means the
  // process exists but belongs to someone else — alive, which is the answer a lock needs.
  isAlive(pid) {
    try { process.kill(pid, 0); return true; } catch (e) { return e?.code === 'EPERM'; }
  },
});

export const commonAmbient = Object.freeze({
  env: () => process.env,
  now: () => Date.now(),
  cwd: () => process.cwd(),
  homedir: () => os.homedir(),
  tmpdir: () => os.tmpdir(),
  execPath: () => process.execPath,   // the running Node binary (G-15)
});
