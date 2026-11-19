function g() {}
import * as ns from './other.mjs';
const o = { m() { this.n(); }, n() {} };
class C {
  m() { [1].map(() => this.n()); }
  n() {}
}
