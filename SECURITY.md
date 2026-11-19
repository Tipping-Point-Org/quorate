# Security

quorate is a developer tool. It spawns subprocesses that carry your credentials, writes to a run directory, runs the
commands your project's contract declares, and, when you turn the external panel on, sends prompts to third-party
model vendors. A defect in any of those is a security defect, and this page says how to report one.

## Reporting a vulnerability

Report it privately, through GitHub's **private vulnerability reporting** on this repository: the **Security** tab,
then **Report a vulnerability**. If you cannot use that, email `security@tippingpointconsultoria.com.br`. Please do
not open a public issue for it.

Include what you can of:

- the quorate version (`VERSION`, or the commit your submodule pins);
- your operating system and Node version;
- the command you ran, and what the contract it read declares (the `graph_contract` block, with any secrets removed);
- what happened, and what you expected to happen.

This is a small project. A report is acknowledged when it is read, and fixed in a release whose `CHANGELOG.md` entry
says what changed and what a consumer must do. There is no bounty.

## What is in scope

The threat model is declared in this repository's own contract (`threat_model` in `CLAUDE.md`), and that declaration
is the authority. In short, in scope:

- arbitrary command execution through contract keys or `scripts/capture.mjs`;
- credentials leaking into child processes;
- escaping the intent sandbox that keeps the intent node from reading the implementation it precedes;
- path traversal through run directories or evidence paths, including through a link or a hard link already standing
  below a run directory (`ARCHITECTURE.md` A-30);
- a node spawning further nodes;
- source leaving the machine through the external panel beyond what `shared/external-reviewers.md` says leaves.

Out of scope: network listeners, authentication, multi-tenancy and transport security. quorate serves nothing and
listens on nothing.

## What is already documented as not covered

Some limits are stated on purpose, and are not vulnerabilities by themselves:

- A contract is trusted like any command it declares: a contract that overrides a built-in reviewer adapter decides
  where that vendor's credentials go, and the override is named wherever it runs (`ARCHITECTURE.md` A-26).
- A link swapped in between a check and an open, by a process that can already write the run directory, is a named
  residual (`ARCHITECTURE.md` A-30).
- The command log masks the secret shapes it knows and logs any other shape as typed, so it is not a credential-safe
  place (`shared/session-rules.md`).
- What quorate does not verify is listed in `shared/unverified-claims.md`.

A report that one of these is weaker than its document says is in scope.
