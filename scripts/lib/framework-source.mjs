// framework-source.mjs — the marker a COPIED framework carries to say where it came from.
//
// One owner, because two modules need it and they must agree byte for byte: lib/worktree.mjs writes
// it when it populates a submodule path inside a panel worktree, and lib/version.mjs reads it when
// it is asked what build this framework is. A copy has no `.git`, so without this git answers with
// the ENCLOSING repository's commit — the reviewed project's — and frameworkStamp's whole promise
// is that a field is never confidently wrong.
export const SOURCE_STAMP = '.quorate-source.json';
