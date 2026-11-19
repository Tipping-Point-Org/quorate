function g() {}
import * as ns from './other.mjs';
class C extends g() {
  m() { this.n(); g(); }
  n() {}
}
