# unbash 6.0.4, vendored

The parser of capture's interactive front end (`.claude/requests/capture-interactive.plan.md` stage 4). Chosen by the
stage-1 bench (operator, 2026-11-15: "unbash 6.0.4 (Recommended)"); placed here, pinned and not reviewed (operator,
2026-11-15: "third_party/, pinned, not reviewed (Recommended)").

- Package: `unbash@6.0.4` on npm, <https://www.npmjs.com/package/unbash>, source <https://github.com/webpro-nl/unbash>.
- Licence: ISC, `LICENSE` here, copied from the tarball unchanged.
- Tarball integrity, checked against the registry's `dist.integrity` on 2026-11-15:
  `sha512-t3OptUArewg9OpYGDskTSlxhyLDahfmZ4d36hE44Efb1y3HRLLpzsVqwH+AwBVymP4t7pP71xN+nnduudn2awA==`.
- What is here: `dist/parser.js` and its import closure, 17 of the package's 20 JavaScript files, unchanged; the type
  declarations and the printer (`./printer`) are not vendored. Nothing is installed, no package.json is added.

## Upgrading

Fetch the new version with `npm pack unbash@<version> --ignore-scripts`, check its integrity against `npm view
unbash@<version> dist.integrity`, copy `dist/parser.js`'s import closure and `LICENSE`, and replace the table below.
`tests/regression-third-party-pinned.test.mjs` fails on any byte that differs from it, so an upgrade is one visible diff.

## Files (sha256)

- `LICENSE` `a8715bd6ba5604134c8bfea951ebc2379ae9e71e78262275f7f87a50c845ae96`
- `dist/ansi-c.js` `cfa5f6331a87cee25bcb0548fef2511a39116d3a63dee66028df4547396303e8`
- `dist/arithmetic-parts.js` `3a239c568cc95fb4bb6eb7886bfdf1a162cb77763aae6d9157e2bcc0fddee2d5`
- `dist/arithmetic.js` `68e8c4057a2ecadc208e4996fd4c46b2ee4d9ba612b61a9fc693cfebb3ff248d`
- `dist/assignment.js` `e1a2b311d13fe9da820e6716c0c4f8636cffa7635bd104dbfa9c0faac56bb43f`
- `dist/chars.js` `3d7878e0996ec9a53929b88e533bec99453148f4df4eeb36593c94c37c0f958c`
- `dist/command.js` `79063e3a47b6b1e6c67e0d923a4aac2ac0caae733a05dac339c476fb1960bef5`
- `dist/expansion.js` `fc2c7c401c82adc99f3ab2ae45346e2008c5934b67f0a51e0864c52128544b72`
- `dist/glob.js` `980cf241f65858977abe1f87fbb065d031e573a7965bdb5252460ed454c4d248`
- `dist/heredoc.js` `7dee6fac7f3f227b022b2d6e4dad8a7a5ecdbc5b31fbd64503fa804e2d8352fd`
- `dist/lexer.js` `51fd6f6825b9e6f9ffaab6204792a5f0d92f10019231291a7f77827659812195`
- `dist/limits.js` `7c8787f8d24b650f08dd84451d569506a5ed597eed4f158c503a8a69169327f6`
- `dist/parser.js` `07efd84d434683101cb3282da17cec5a158cbb99c1dd0aa68d2f67d1a01d53d3`
- `dist/parts.js` `619440e8d0c201b47773a052ce9b124ccb8926df985b4a65be1f14b9e4072b91`
- `dist/substitution-context.js` `a1d753ce693e791f7f4a480a53034b1ee797d8e2bd686ee93dced2ba18530af1`
- `dist/traversal.js` `3fc2d90f966ec9ece4dd1b76eddf0d1b5721b528b6ea1263b06b45cc3241c8c8`
- `dist/word-value.js` `b58af57fa9d85310c57e5fa1f3f7fc4c370b5fea7f537206124dfb1da328d9d6`
- `dist/word.js` `69ccece2f49492588e6fa9870ca610526959a126ae9ebff4787895cad4abc6b4`
