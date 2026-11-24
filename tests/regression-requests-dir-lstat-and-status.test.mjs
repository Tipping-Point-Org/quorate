// G-12 and G-13 of 20261122-002915-m3s7-b2-remediation-review, both in lib/project-paths.mjs.
//
// G-12: resolvedRequestsDir with `mustExist: false` took ANY lstat failure as proof that nothing stands at
// `.claude/requests`, so a leaf that exists but answers EACCES or EIO had only its parent realpath-checked, the
// containment gap the leaf check was added to close. Only ENOENT (or ENOTDIR) establishes absence; any other failure
// is not evidence of containment.
//
// G-13: requestStatus returned the first `status:` line in the front matter and never saw a later, conflicting one, so
// a header carrying both `status: draft` and `status: approved` was silently read as whichever came first.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolvedRequestsDir, requestStatus, requestIsApproved } from '../scripts/lib/project-paths.mjs';

const ROOT = path.resolve('/virtual/repo');
const REQ = path.join(ROOT, '.claude', 'requests');

function io(code) {
  return {
    fs: {
      realpathSync: (p) => {
        const a = path.resolve(p);
        // The leaf, if anything reached it, leads out of the repository.
        if (a === REQ) return path.resolve('/elsewhere/requests');
        return a;
      },
      lstatSync: (p) => {
        if (path.resolve(p) === REQ) throw Object.assign(new Error(`${code}: ${p}`), { code });
        return { isSymbolicLink: () => false };
      },
      readFileSync() {},
    },
  };
}

for (const code of ['EACCES', 'EIO', 'EPERM']) {
  test(`G-12: an lstat ${code} at the requests leaf is not absence, and proves no containment`, () => {
    assert.equal(resolvedRequestsDir(ROOT, { mustExist: false, io: io(code) }), null);
  });
}

test('G-12: ENOENT at the leaf still falls back to proving the parent', () => {
  assert.equal(resolvedRequestsDir(ROOT, { mustExist: false, io: io('ENOENT') }), REQ);
});

test('G-13: two status lines in the front matter are no status, whichever comes first', () => {
  assert.equal(requestStatus('---\nstatus: draft\nstatus: approved\n---\n'), null);
  assert.equal(requestIsApproved('---\nstatus: approved\nrequest: x\nstatus: draft\n---\n'), false);
});

test('G-13: one status line still reads', () => {
  assert.equal(requestStatus('---\nrequest: x\nstatus: approved\n---\n\nstatus: draft\n'), 'approved');
});
