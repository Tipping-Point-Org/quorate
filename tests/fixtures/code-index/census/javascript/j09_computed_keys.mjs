function g() {}
import * as ns from './other.mjs';
const k = "m";
class C {
  [g()]() { this.n(); }
  [k]() {}
  n() { this.k(); }
}
