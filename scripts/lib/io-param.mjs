// THE `io` PARAMETER, CHECKED (os-platform-adapters stage 3).
//
// A lib/ function that needs the filesystem or a process takes the scripts/platform implementation
// as a parameter instead of importing node:fs — which is what makes this layer do no I/O of its own
// (criterion 4) and testable with a fake. A missing `io` must fail at the call, naming the function,
// not three frames later as "cannot read properties of undefined (reading 'readFileSync')".

export function requireIo(io, fn) {
  if (!io || typeof io.fs?.readFileSync !== 'function') {
    throw new Error(`${fn}: an io implementation is required — pass hostPlatform() (scripts/platform), `
      + 'or import the host-bound version from scripts/io/. lib/ does no I/O of its own.');
  }
  return io;
}
