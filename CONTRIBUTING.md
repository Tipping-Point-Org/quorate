# Contributing

Thank you for looking. Bug reports, design discussion and pull requests are all welcome.

## How changes reach this repository

This public repository is a **release mirror**. quorate is developed in a separate repository, and each release
arrives here as one commit, its message taken from that release's `CHANGELOG.md` entry. So a pull request here is
not merged as it stands, since the next release commit would overwrite it. Instead:

1. Open the pull request here as usual. It is read and discussed here.
2. An accepted change is applied in the development repository, where it goes through the same review every change
   does: quorate reviews itself, and a fix is judged by a later review before it counts as done.
3. It ships in the next release commit, and its author is credited in that release's `CHANGELOG.md` entry. The pull
   request is then closed with a pointer to the release, not merged.

A change that is not taken is closed with the reason.

## Before you send a change

- **Run the suite.** There is nothing to compile, and no dependencies to install:

  ```
  node scripts/check-syntax.mjs
  node tests/run-all.mjs
  ```

  Node 22, 24 or 26 (QUORATE.md, "Node.js"). The suite is offline: no test reaches a model or the network, and one
  that does is a defect.
- **A fix carries its test.** Every test here records the defect it exists to prevent, in its own text. A test that
  checks behaviour is worth more than one that reads source text, which breaks on the first harmless refactor.
- **Keep the dependency count at zero.** quorate uses Node's standard library only; the code index's JavaScript
  extractor loads acorn from the consuming project, never from here.
- **Every platform.** Windows, Linux and macOS: anything operating-system specific goes behind `scripts/platform/`
  (ARCHITECTURE.md, the Platform row of section 2).
- **One owner per fact.** Each document owns its subject (README, "Where things are written down"); a change to a
  rule changes its owner, and other places point at it rather than restating it.

## Reporting a problem

Open an issue with the quorate version, your operating system and Node version, the command you ran, and what
happened. For anything that may be a vulnerability, use the private route in `SECURITY.md` instead.

Design records are private: the code and the documents cite the requests and reviews each change was decided in,
and those stay in the development repository (README, "Where things are written down").
