// lib/template.mjs, BOUND TO THIS HOST: template loading reads prompts/_templates/ through the
// platform. See scripts/io/finding-scope.mjs for why this layer exists.
import * as pure from '../lib/template.mjs';
import { hostPlatform } from '../platform/index.mjs';

export * from '../lib/template.mjs';

export const readTemplate = (name) => pure.readTemplate(name, hostPlatform());

/**
 * A HOOK'S NOTICE, rendered from the prompt library and NEVER THROWN (G-9, G-10 of
 * 20261106-022028-stoplog-g8-remediation-2-review): a template that is missing or whose slots drifted costs the notice,
 * said on stderr (or to `say`), and never the record or the print beside it. The text ends in one newline.
 */
export function noticeText(name, slots, { say = (l) => console.error(l) } = {}) {
  try {
    const text = pure.renderTemplate(readTemplate(name), slots, name.replace(/\.md$/, ''));
    return text.endsWith('\n') ? text : `${text}\n`;
  } catch (e) {
    say(`quorate: the notice ${name} could not be rendered (${e?.message ?? e})`);
    return '';
  }
}
