// secret-shapes.mjs — the secret shapes quorate's two guards are held to (secret-shapes-and-refusals, 1a).
//
// Two guards stop a credential reaching git: redaction at every tracked write (lib/redact.mjs), and the push-time
// scan with the rules quorate ships (.claude/hooks/gitleaks.toml). They were kept by hand, in two regex engines,
// with the credential words written five times, and each review found the next shape one of them missed (G-11 of
// ltb-review, G-12 and G-13 of r2, G-1 and G-2 of r3, G-2 and G-3 of r4).
//
// CASES IS THE SCOPE (operator, 2026-09-29: "1 as suggested"). Every row runs through both guards, and a shape
// this table does not list is not a defect in either: it is a request for a row, closed by adding the row with the
// test it brings. A review that finds such a shape keeps its rating; what changes is that it has a finish line.
//
// Credential names and token bodies are BUILT here, never written out, so this file does not trip the scan it
// defines (operator, 2026-09-28: "build at runtime").

// ------------------------------------------------------------------------------------------- the definition

// A credential's NAME, as the words it ends in. A compound word is accepted joined, or split by `_` or `-`.
const WORDS = ['password', 'passwd', 'pwd', 'secret', 'token'];
const COMPOUNDS = [['api', 'key'], ['access', 'key'], ['private', 'key'], ['client', 'secret']];

// The name as a regex: prefixed names count (`db_password`); a name that only STARTS with a credential word does
// not (`secret_scan`, `tokens`), because the name must be followed by `=` or `:`.
const NAME_WORD = `(?:${[...WORDS, ...COMPOUNDS.map(([a, b]) => `${a}[_-]?${b}`)].join('|')})`;

// The command log's names (lib/command-log.mjs): these words, and the shorter stems an environment variable's name carries,
// matched anywhere in the name. They were a second list there (G-11 of 20261025-104155-srf-remediation-3-review); the
// stems are the command line's only, so the shared shapes and the push rules are unchanged by them.
const COMMAND_NAME_STEMS = ['pass', 'credential', 'private', 'auth'];

/** A command line's credential NAME as a regex source (used case-insensitively): a word or stem anywhere in it. */
export function commandSecretNameSource() {
  const words = [...WORDS, ...COMPOUNDS.map(([a, b]) => `${a}_?${b}`), ...COMMAND_NAME_STEMS];
  return String.raw`[A-Za-z0-9_]*(?:${words.join('|')})[A-Za-z0-9_]*`;
}

/** Every spelling of every credential word, lower case: the push rules' keyword prefilter, and nothing else. */
export const CREDENTIAL_SPELLINGS = Object.freeze([
  ...WORDS, ...COMPOUNDS.flatMap(([a, b]) => ['', '_', '-'].map((sep) => a + sep + b)),
]);

// One character of an UNQUOTED value: anything but a space, a quote or a delimiter — so `.`, `$` and `?` are value
// characters (G-3 of ltb-review-r4), and a bracket or parenthesis ends the value, which keeps a call out.
const VALUE_CHAR = String.raw`[^\s"'\x60,;(){}\[\]<>]`;
// What may follow an unquoted value. A value running into `(` is a call's name, not a secret.
const VALUE_END = String.raw`[\s,;)}\]]`;

/**
 * Shapes recognisable without a name. `source` is written once and is valid in both engines: JavaScript for
 * redaction and RE2 for gitleaks. `id` names the push rule; `label` is what redaction writes in the value's place.
 */
const TOKEN_SHAPES = [
  { id: 'private-key-block', label: 'private key', source: String.raw`-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)` },
  { id: 'aws-key', label: 'AWS key', source: String.raw`\b(?:AKIA|ASIA)[0-9A-Z]{16}\b` },
  { id: 'github-token', label: 'GitHub token', source: String.raw`\bgh[pousr]_[A-Za-z0-9]{36,}\b` },
  { id: 'github-fine-grained-token', label: 'GitHub token', source: String.raw`\bgithub_pat_[A-Za-z0-9_]{20,}\b` },
  { id: 'sk-api-key', label: 'API key', source: String.raw`\bsk-[A-Za-z0-9_-]{20,}\b` },
  { id: 'slack-token', label: 'Slack token', source: String.raw`\bxox[abprs]-[A-Za-z0-9-]{10,}\b` },
  { id: 'bearer-token', label: 'bearer token', source: String.raw`\b[Bb]earer\s+[A-Za-z0-9._~+/-]{16,}=*` },
];

/**
 * The patterns redaction applies, in order: [regex, label, keepName]. keepName leaves the credential's name in
 * place and replaces only its value (group 1 is the name and its `=` or `:`).
 */
export function redactionPatterns() {
  const KEY = String.raw`[A-Za-z0-9_]*?${NAME_WORD}`;
  const NAME = String.raw`((?:["']${KEY}["']|\b${KEY})\s*[=:]\s*)`;
  return [
    ...TOKEN_SHAPES.map((s) => [new RegExp(s.source, 'g'), s.label, false]),
    // A QUOTED value of 4+ characters, escaped quotes included. Fewer is a placeholder, not a credential.
    [new RegExp(String.raw`${NAME}"(?:[^"\\]|\\.){4,}"`, 'gi'), 'secret value', true],
    [new RegExp(String.raw`${NAME}'(?:[^'\\]|\\.){4,}'`, 'gi'), 'secret value', true],
    // An UNQUOTED value that looks generated: a digit in it and 6+ characters, or 16+ characters. An unquoted word
    // after a credential name is prose far more often than a secret — "every token: short-flag clusters" in a
    // tracked intent.md was the measured case. Never a placeholder an earlier pattern already wrote.
    [new RegExp(String.raw`${NAME}(?!\[redacted)(?:(?=${VALUE_CHAR}*\d)${VALUE_CHAR}{6,}|${VALUE_CHAR}{16,})(?=${VALUE_END}|$)`, 'gi'), 'secret value', true],
  ];
}

const tomlString = (s) => `'''${s}'''`;
const tomlList = (xs) => `[${xs.map((x) => JSON.stringify(x)).join(', ')}]`;

/**
 * The gitleaks configuration quorate ships, as text. RE2 has no lookahead, so the unquoted rule states "has a digit"
 * as a digit somewhere in the value and keeps short values out with an entropy floor instead of a length — the one
 * place the two renderings differ, which is why CASES runs through both rather than assuming they agree.
 */
export function renderGitleaksToml() {
  const name = `(?i)[a-z0-9_]*${NAME_WORD}["']?\\s*[=:]\\s*`;
  const rule = (id, description, regex, extra = []) => [
    '', '[[rules]]', `id = "${id}"`, `description = ${JSON.stringify(description)}`, `regex = ${tomlString(regex)}`, ...extra,
  ];
  return [
    '# GENERATED by scripts/gen-gitleaks-config.mjs from scripts/lib/secret-shapes.mjs — do not edit by hand.',
    '# A test fails when this file differs from what the generator writes.',
    '#',
    '# gitleaks\' default rules, plus the shapes quorate redacts at every tracked write, from the one definition both',
    '# guards are built from (secret-shapes-and-refusals, 1a). Its CASES table is their scope: a shape it does not',
    '# list is a request for a row, not a defect in either guard.',
    '#',
    '# - quorate-key-value: a credential name followed by a QUOTED value of 4+ characters, escaped quotes included.',
    '# - quorate-key-value-unquoted: a credential name followed by an UNQUOTED value that looks generated — it holds a',
    '#   digit or runs 16+ characters, with an entropy floor — and does not run into a call.',
    '# - quorate-<token>: token shapes recognisable without a name.',
    '# The name must END in a credential word, so `secret_scan: "required"` passes.',
    '#',
    '# Used by the pre-push hook and scripts/check-secrets.mjs through secretScanArgv\'s --config',
    '# (scripts/lib/push-gate.mjs). A consumer\'s own .gitleaks.toml takes precedence, and check-install says so.',
    '',
    'title = "quorate"',
    '',
    '[extend]',
    'useDefault = true',
    ...rule('quorate-key-value', 'A credential name followed by a quoted value (JSON, YAML or assignment)',
      String.raw`${name}["']((?:[^"'\\\r\n]|\\.){4,})["']`,
      ['secretGroup = 1', `keywords = ${tomlList(CREDENTIAL_SPELLINGS)}`]),
    ...rule('quorate-key-value-unquoted', 'A credential name followed by an unquoted value that holds a digit or runs 16+ characters (not a call or a placeholder)',
      String.raw`${name}(${VALUE_CHAR}*[0-9]${VALUE_CHAR}*|${VALUE_CHAR}{16,})(?:${VALUE_END}|$)`,
      ['secretGroup = 1', 'entropy = 2.5', `keywords = ${tomlList(CREDENTIAL_SPELLINGS)}`]),
    ...TOKEN_SHAPES.flatMap((s) => rule(`quorate-${s.id}`, `${s.label} (${s.id})`, s.source)),
    '',
  ].join('\n');
}

// ------------------------------------------------------------------------------------------- the scope

const PW = 'pass' + 'word';
const TOKEN = 'tok' + 'en';
const ACCESS = 'access';
const PRIVATE = 'private';
const KEYWORD = 'k' + 'ey';

// A deterministic stand-in for a generated value: `n` characters drawn from `alphabet`.
const fake = (n, alphabet) => Array.from({ length: n }, (_, i) => alphabet[(i * 7 + 3) % alphabet.length]).join('');
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const PEM = 'PRIVATE ' + 'KEY';

/**
 * One row per shape. `catch: true` rows name the `value` that must not survive redaction, and the push scan must
 * report them; `catch: false` rows must pass both guards untouched. `why` names the finding or reason the row is for.
 */
export const CASES = Object.freeze([
  // A credential name followed by a QUOTED value.
  { text: `{"${PW}": "Tr0ub4dor&3xq9Zk"}`, catch: true, value: 'Tr0ub4dor&3xq9Zk', why: 'JSON value (G-11 of ltr-review-r5)' },
  { text: `db_${PW}: "s3cr3t value with spaces"`, catch: true, value: 's3cr3t value with spaces', why: 'spaced YAML value with spaces (1b)' },
  { text: `'${PW}': 'secret-value-here'`, catch: true, value: 'secret-value-here', why: 'single-quoted name and value (G-11 of ltb-review)' },
  { text: `${PW}: "ab12"`, catch: true, value: 'ab12', why: 'a 4-character value (G-12 of ltb-review-r2)' },
  { text: `${PW}: "ab\\"cdefgh"`, catch: true, value: 'cdefgh', why: 'an escaped double quote inside the value (G-1 of ltb-review-r3)' },
  { text: `${PW} = 'ab\\'cd\\'efgh'`, catch: true, value: 'efgh', why: 'escaped single quotes inside the value (G-12 of ltb-review-r2)' },
  // A credential name followed by an UNQUOTED value that looks generated: a digit in it, or 16+ characters.
  { text: `'${PW}': hunter2secret9`, catch: true, value: 'hunter2secret9', why: 'quoted name, unquoted value (G-13 of ltb-review-r2)' },
  { text: `${PW}: x1abcdefgh`, catch: true, value: 'x1abcdefgh', why: 'the only digit in second place (G-2 of ltb-review-r3)' },
  { text: `${TOKEN}=AbCdEfGhIjKlMnOpQrSt`, catch: true, value: 'AbCdEfGhIjKlMnOpQrSt', why: '16+ characters, no digit (1b)' },
  { text: `${PW}: ab.cd9efgh`, catch: true, value: 'ab.cd9efgh', why: 'a dot inside an unquoted value (G-3 of ltb-review-r4)' },
  { text: `${PW}: ab$cd9efgh`, catch: true, value: 'ab$cd9efgh', why: 'a dollar sign inside an unquoted value (G-3 of ltb-review-r4)' },
  { text: `${PW}: ab?cd9efgh`, catch: true, value: 'ab?cd9efgh', why: 'a question mark inside an unquoted value (G-3 of ltb-review-r4)' },
  // Every spelling of a compound credential name (G-2 of ltb-review-r4: the regexes accepted these, the keywords did not).
  { text: `${ACCESS}${KEYWORD}: "Zq8Pw2LmX9ab"`, catch: true, value: 'Zq8Pw2LmX9ab', why: 'accesskey, quoted (G-2 of ltb-review-r4)' },
  { text: `${ACCESS}-${KEYWORD}: Zq8Pw2LmX9ab`, catch: true, value: 'Zq8Pw2LmX9ab', why: 'access-key, unquoted (G-2 of ltb-review-r4)' },
  { text: `${PRIVATE}${KEYWORD} = "Zq8Pw2LmX9ab"`, catch: true, value: 'Zq8Pw2LmX9ab', why: 'privatekey, quoted (G-2 of ltb-review-r4)' },
  { text: `${PRIVATE}-${KEYWORD}=Zq8Pw2LmX9ab`, catch: true, value: 'Zq8Pw2LmX9ab', why: 'private-key, unquoted (G-2 of ltb-review-r4)' },
  // Token shapes, recognisable without a name.
  { text: `uses ghp_${fake(36, ALNUM)}`, catch: true, value: `ghp_${fake(36, ALNUM)}`, why: 'GitHub token' },
  { text: `uses github_pat_${fake(40, ALNUM + '_')}`, catch: true, value: `github_pat_${fake(40, ALNUM + '_')}`, why: 'GitHub fine-grained token' },
  { text: `uses sk-${fake(40, ALNUM)}`, catch: true, value: `sk-${fake(40, ALNUM)}`, why: 'API key with an sk- prefix' },
  { text: `uses xoxb-${fake(12, '0123456789')}-${fake(24, ALNUM)}`, catch: true, value: `xoxb-${fake(12, '0123456789')}-${fake(24, ALNUM)}`, why: 'Slack token' },
  { text: `Authorization: Bearer ${fake(32, ALNUM)}`, catch: true, value: fake(32, ALNUM), why: 'bearer token' },
  { text: `uses AKIA${fake(16, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567')}`, catch: true, value: `AKIA${fake(16, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567')}`, why: 'AWS access key' },
  { text: `-----BEGIN RSA ${PEM}-----\nMIIEow${fake(60, ALNUM)}\n-----END RSA ${PEM}-----`, catch: true, value: `MIIEow${fake(60, ALNUM)}`, why: 'PEM private key' },

  // Must pass both guards untouched.
  { text: 'secret_scan: required', catch: false, why: 'the contract\'s own key: the name must END in a credential word' },
  { text: `const ${TOKEN} = getToken();`, catch: false, why: 'ordinary code: a call' },
  { text: 'api_key = process.env.X', catch: false, why: 'ordinary code: a reference' },
  { text: `${PW}: ""`, catch: false, why: 'an empty value' },
  { text: `${PW}: "ab"`, catch: false, why: 'a placeholder under 4 characters' },
  { text: `const n = ${TOKEN}: 5;`, catch: false, why: 'a short value: the push rule\'s entropy floor' },
  { text: `every ${TOKEN}: short-flag clusters`, catch: false, why: 'prose: an unquoted word after a credential name (the measured intent.md case)' },
  { text: 'the api_key: required for this node', catch: false, why: 'prose' },
  { text: `the ${PW} field at line 12 is checked`, catch: false, why: 'prose naming a credential field' },
]);
