// A Claude Code hook's input, read from stdin to a cap (G-16 and G-17 of 20261024-235344-arp-remediation-2-review for
// the stop guard; G-3 of 20261025-021243-arp-remediation-3c-review for the command log): every chunk had been joined
// with no limit. One reader for both hooks, so the cap is stated once. Past it the reader rejects; each hook decides
// what that means (the stop guard allows the stop, the command log refuses the command).

export const HOOK_INPUT_MAX_BYTES = 8 * 1024 * 1024;

export function readHookInput(stream = process.stdin, maxBytes = HOOK_INPUT_MAX_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    stream.on('data', (d) => {
      bytes += d.length;
      if (bytes > maxBytes) {
        stream.destroy();
        reject(new Error(`the hook input is larger than ${maxBytes} bytes`));
        return;
      }
      chunks.push(d);
    });
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}
