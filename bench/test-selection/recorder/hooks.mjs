// hooks.mjs — the loader half of preload.mjs: posts every resolved file URL to the main thread, and makes `.md`
// importable as a string (candidate 2's loader; nothing in the suite imports `.md` yet, so it is here for the tests
// converted later).
import fs from 'node:fs';

let port = null;
export async function initialize(data) { port = data?.port ?? null; }

export async function resolve(specifier, context, next) {
  const r = await next(specifier, context);
  if (port && r?.url?.startsWith('file:')) port.postMessage(r.url);
  return r;
}

export async function load(url, context, next) {
  if (url.startsWith('file:') && url.endsWith('.md')) {
    return { format: 'module', shortCircuit: true, source: `export default ${JSON.stringify(fs.readFileSync(new URL(url), 'utf8'))};` };
  }
  return next(url, context);
}
