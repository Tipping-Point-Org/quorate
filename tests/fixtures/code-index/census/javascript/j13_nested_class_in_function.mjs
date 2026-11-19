function g() {}
import * as ns from './other.mjs';
function f() {
  class L { m() { this.n(); } n() {} }
  new L();
}
