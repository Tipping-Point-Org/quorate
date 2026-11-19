// What the intent grant probe (scripts/check-intent-grant.mjs) concludes about one ORIGINAL file it asked the node to
// read. Pure: the probe gathers the runtime's answer and its recorded denials; this decides.
//
// THREE OUTCOMES, NOT TWO (G-5 of 20261001-155615-cgg-review-r3). The probe scored "the file's marker is absent from the
// answer" as refused, so a node that never attempted the read — no denial, no content — passed exactly like one the
// policy stopped, and the probe could report agreement with sandbox enforcement unproven. A refusal is a RECORDED
// denial of that path; an answer carrying the marker is a read; anything else is not attempted, which proves nothing.
import path from 'node:path';

/** 'read' | 'refused' | 'not-attempted'. `denied` is the list of paths the runtime recorded as denied. */
//
// A RECORDED DENIAL DECIDES FIRST. A declared document's copy carries the same marker as its original, so an answer can
// hold the marker because the COPY was read; the first version checked the marker first and scored every refused inside
// original as read — measured on the live re-run of this probe, where each was denied.
export function judgeOriginalRead({ file, marker, denied = [], text = '' }) {
  // normalize, not resolve: both sides are absolute, and lib/ does not read the working directory.
  const want = path.normalize(file);
  if (denied.some((d) => path.normalize(String(d)) === want)) return 'refused';
  if (String(text).includes(marker)) return 'read';
  return 'not-attempted';
}

/** The probe agrees on one form only when both originals were REFUSED — not merely absent from the answer. */
export const originalsRefused = ({ inside, outside }) => inside === 'refused' && outside === 'refused';
