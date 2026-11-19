function g() {}
import * as ns from './other.mjs';
class C {
  get x() { return g(); }
  set x(v) { this.m(); }
  static s() {}
  m() { this.s(); this.x(); }
}
