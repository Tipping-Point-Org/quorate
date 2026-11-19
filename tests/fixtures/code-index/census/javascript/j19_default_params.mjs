function g() {}
import * as ns from './other.mjs';
function f(a = g(), b = parseInt()) {
  function g() {}
  let parseInt;
}
const k = (a = g()) => a;
