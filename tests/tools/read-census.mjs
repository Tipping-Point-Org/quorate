// read-census.mjs — the read family the read censuses hold scripts/ to: the census regex of run-dir-reads.design.md.
// One copy, imported by tests/regression-confined-read-adoption.test.mjs and tests/regression-set-aside-identity.test.mjs
// (set-aside-identity.plan.md stage 1), whose set-aside census reads between the markers of scripts/io/set-aside.mjs since the
// set-aside moved there (runner-test-seam.plan.md stage 1). A module with no tests of its own, so importing it runs none twice.
// `realpathSync.native(` is the same read (G-18 of 20261029-212858-rdr-remediation-2-review). A COPY READS ITS SOURCE (G-7
// of 20261030-010649-rdr-remediation-5-review). The second alternative is the same family spelled as a promise or a
// callback, on an fs-named receiver (G-13 of 20261105-070121-crsf-remediation-2-review).
export const READ = /\b(readFileSync|existsSync|statSync|lstatSync|readdirSync|realpathSync(?:\.native)?|createReadStream|openSync|readJson|readText|readRunRecord|readJsonSafe|copyFileSync|cpSync|promises\.cp)\(|\b(?:fs|fsp|hostFs|promises)\.(?:promises\.)?(?:readFile|readdir|stat|lstat|realpath|readlink|access|opendir|open|copyFile)\(/;
