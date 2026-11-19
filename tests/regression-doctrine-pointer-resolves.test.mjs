// A POINTER INTO A SECTION THAT MOVED IS THE DEFECT THIS REPOSITORY KEEPS FINDING IN OTHER PEOPLE'S
// DOCUMENTS, AND THEN SHIPPED.
//
// QUORATE.md's "Rules your sessions inherit" is explicitly a pointer block -- "the section named
// beside it owns the rule" -- written that way after G-5, because four rules restated in full were
// four more places for the doctrine to drift from itself. Pointers cost nothing to write and fail
// silently: the named section is renamed or split, the citation still reads fine, and a consumer
// following it lands nowhere.
//
// This is not hypothetical here. The consumer fixture's own review skills carried two stale
// citations found on 2026-09-19 -- `architecture.md §11.7` for candidate lists that had moved to
// `adapter_architecture.md`, and a mode table cited as §3.3 when it is §3.4 -- and quorate's own
// CLAUDE.md pointed at a `tie_breaker` key the roster no longer had. Every one of them was a
// pointer whose target moved.
//
// So the pointer block gets a test: every doctrine section QUORATE.md names by title must exist,
// verbatim, as a heading in the file it names.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

test('every doctrine section QUORATE.md cites by title exists as a heading in the named file', () => {
  // Whitespace-collapsed, because a pointer is prose and prose wraps: the citation this test was
  // written for is split across two lines in QUORATE.md, and a literal `includes` failed on its
  // first run. A test that forces the document to avoid line breaks is testing the formatter.
  const quorateMd = read('QUORATE.md').replace(/\s+/g, ' ');

  // Each entry: the quoted section title as QUORATE.md writes it, and the file that owns it.
  // Add a row when a pointer is added; the point is that the title is checked, not merely present.
  const CITED = [
    { file: 'shared/unverified-claims.md', title: 'A second class: claims about WHO ASKED' },
    // The decision rule reached no consumer session until this pointer existed (story-pipeline, 2026-10-06).
    { file: 'skills/claim-check/SKILL.md', title: 'Presenting a decision' },
    { file: 'skills/claim-check/SKILL.md', title: 'When' },
  ];

  for (const { file, title } of CITED) {
    assert.ok(
      quorateMd.includes(title),
      `QUORATE.md no longer cites "${title}" — update this test with the pointer's new wording, `
        + 'or remove the row if the pointer is gone',
    );
    const owner = read(file);
    const headings = owner
      .split('\n')
      .filter((l) => /^#{1,4} /.test(l))
      .map((l) => l.replace(/^#{1,4} /, '').trim());
    assert.ok(
      headings.includes(title),
      `QUORATE.md points at "${title}" in ${file}, which has no such heading. `
        + `Headings present: ${headings.join(' | ')}`,
    );
  }
});

test('the attribution rule states the citation requirement where the doctrine owns it', () => {
  // The rule is worth nothing if the pointer resolves to a section that no longer carries it --
  // the same failure one level down. Pin the load-bearing clause, not the prose around it.
  const doctrine = read('shared/unverified-claims.md');
  assert.match(
    doctrine,
    /cite, or do not claim/i,
    'the provenance section must keep the rule itself, not just the story that produced it',
  );
  assert.match(
    doctrine,
    /I proposed the review; you approved it/,
    'the section must keep the worked form for an approved proposal — the case that was got wrong',
  );
});

test('the decision rule states options, pros, cons and a labelled suggestion where claim-check owns it', () => {
  // Same failure one level down as the attribution rule: a pointer that resolves to a heading which has
  // lost the rule. A consumer's session never saw this rule at all until the pointer existed
  // (story-pipeline, 2026-10-06), so the clause itself is what is pinned.
  const skill = read('skills/claim-check/SKILL.md');
  // Whitespace-collapsed for the same reason as the pointer test: prose wraps.
  const section = (skill.split(/^## /m).find((s) => s.startsWith('Presenting a decision')) ?? '').replace(/\s+/g, ' ');
  assert.match(section, /pros and its cons/, 'the section must require each option\'s pros and cons');
  assert.match(section, /suggestion/, 'the section must require a suggestion');
  assert.match(section, /labelled as judgement unless a measurement backs it/,
    'the suggestion must be labelled as judgement unless measured (A-22)');
  assert.match(section, /checked like any other draft/, 'the decision must go through the check before it is sent');
});
