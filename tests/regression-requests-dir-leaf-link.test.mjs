// G-13 of 20261121-233915-m3s7-b2-review: resolvedRequestsDir with `mustExist: false` realpathed only the
// PARENT, even when `.claude/requests` already existed, so a symlink or junction there leading out of the
// repository passed containment, and recovery wrote an inferred request through it. An existing leaf is
// resolved itself; only a leaf that does not exist falls back to proving its parent contained.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import * as projectPaths from '../scripts/lib/project-paths.mjs';

const ROOT = path.resolve('/virtual/repo');
const REQ = path.join(ROOT, '.claude', 'requests');

function io({ leaf }) {
  const enoent = (p) => Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
  return {
    fs: {
      realpathSync: (p) => {
        const a = path.resolve(p);
        if (a === REQ) {
          if (leaf === 'absent') throw enoent(p);
          if (leaf === 'dangling') throw enoent(p);
          return leaf === 'link-out' ? path.resolve('/elsewhere/requests') : a;
        }
        return a;
      },
      lstatSync: (p) => {
        if (path.resolve(p) === REQ && leaf === 'absent') throw enoent(p);
        return { isSymbolicLink: () => leaf === 'link-out' || leaf === 'dangling' };
      },
      readFileSync() {},
    },
  };
}

test('G-13: an existing requests directory linked out of the repository is refused with mustExist: false', () => {
  assert.equal(projectPaths.resolvedRequestsDir(ROOT, { mustExist: false, io: io({ leaf: 'link-out' }) }), null);
});

test('G-13: a dangling link at the requests directory is refused with mustExist: false', () => {
  assert.equal(projectPaths.resolvedRequestsDir(ROOT, { mustExist: false, io: io({ leaf: 'dangling' }) }), null);
});

test('G-13: an absent requests directory is still proved through its parent', () => {
  assert.equal(projectPaths.resolvedRequestsDir(ROOT, { mustExist: false, io: io({ leaf: 'absent' }) }), REQ);
});

test('G-13: an existing, contained requests directory resolves to itself', () => {
  assert.equal(projectPaths.resolvedRequestsDir(ROOT, { mustExist: false, io: io({ leaf: 'plain' }) }), REQ);
});
