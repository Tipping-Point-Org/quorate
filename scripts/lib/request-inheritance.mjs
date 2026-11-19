// WHICH REQUEST A REMEDIATION, AND ITS FOLLOW-UP, ARE JUDGED AGAINST (remediation-consumer-findings.plan.md stage 1, AC5;
// operator, 2026-10-20: "Inherit, refuse conflict (Recommended)").
//
// new-run resolved every run's request from --request or the contract, so a remediation of a review minted with
// --request named the contract's document instead, with no stamp, and its follow-up inherited the wrong one
// (story-pipeline's 20261020-103911). A run minted from another run takes that run's request: the reviewed run for
// --remediates, the remediation for --follows-remediation, whose own request is the reviewed run's. Pure: the caller
// reads the record and proves the document exists.

const norm = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '');

/**
 * `source`: the run record inherited from ({ run_id, request: { path } | null, stamps, request_missing_reason }).
 * `explicit`: the --request given, or null; `noRequest`: --no-request given.
 * Returns { refusal } when the command line asks for a different request than the one inherited, else
 * { kind: 'request', path, inferred } or { kind: 'none', reason }.
 */
export function inheritedRequest(source, { explicit = null, noRequest = false } = {}) {
  const id = source?.run_id ?? 'the run this one follows';
  const req = source?.request?.path ? norm(source.request.path) : null;
  const given = explicit && String(explicit).trim() ? norm(String(explicit).trim()) : null;
  if (req) {
    if (noRequest) return { refusal: `--no-request: ${id} was judged against ${req}, and a run minted from it is judged against the same request` };
    if (given && given !== req) {
      return { refusal: `--request ${given} names a different document than ${req}, the request ${id} was judged against; drop --request, or review against ${given} in a new review` };
    }
    return { kind: 'request', path: req, inferred: (source.stamps ?? []).includes('REQUEST-INFERRED') };
  }
  if (given) return { refusal: `--request ${given}: ${id} was judged against no request, and a run minted from it is judged against the same` };
  return { kind: 'none', reason: `${id} was judged against no request (${source?.request_missing_reason ?? 'no reason recorded'})` };
}

/**
 * THE SAME REQUEST, NOT ONLY THE SAME PATH (G-8 of 20261021-014056-rcf-delivery): the inherited document's bytes now,
 * hashed by the caller as `actualSha`, against the hash `source` recorded when it was judged. A request edited since is a
 * different set of criteria under the same name, so it is refused, not re-recorded. Returns the refusal, or null; a
 * source that recorded no hash has nothing to compare and returns null.
 */
export function inheritedRequestChanged(source, actualSha) {
  const frozen = source?.request?.sha256;
  if (!frozen || frozen === actualSha) return null;
  const id = source?.run_id ?? 'the run this one follows';
  return `the request ${norm(source.request.path)} has changed since ${id} was judged against it (sha256 ${String(frozen).slice(0, 12)}, now ${String(actualSha).slice(0, 12)}); restore it, or review again against the new text`;
}
