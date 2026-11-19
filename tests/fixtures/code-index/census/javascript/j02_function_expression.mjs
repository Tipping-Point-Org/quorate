function g() {}
import * as ns from './other.mjs';
const a = function b() { g(); };
foo(function () { g(); });
function foo() {}
