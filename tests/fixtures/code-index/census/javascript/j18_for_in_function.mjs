function g() {}
import * as ns from './other.mjs';
function f() { for (const g of []) g(); }
