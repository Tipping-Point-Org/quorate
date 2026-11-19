function g() {}
import * as ns from './other.mjs';
export function e1() { g(); }
export default function () { g(); }
export const e2 = () => g();
export { g as gg };
export * from './other.mjs';
