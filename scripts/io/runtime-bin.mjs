// THE RUNTIME BINARY OVERRIDE AS A SCRIPT READS IT (operator, 2026-11-11: "A. Rename, keep an alias (Recommended)",
// decision 20261111-172326-aaa7f7): `--runtime-bin`, through the one owner (lib/argv-specs.mjs runtimeBinFrom). Its alias
// `--claude-bin` was removed in 0.3.0 (operator, 2026-11-13: "0.3.0, remove the alias (Recommended)"); the owner refuses it,
// naming the new spelling.
import { runtimeBinFrom, RUNTIME_BIN_FLAG } from '../lib/argv-specs.mjs';

/** The override's path, or null. Throws as runtimeBinFrom does. */
export function runtimeBinArg(values) {
  return runtimeBinFrom(values).bin;
}

/** The argv a script passes a child to hand it the override. */
export const runtimeBinArgv = (bin) => (bin ? [`--${RUNTIME_BIN_FLAG}`, bin] : []);
