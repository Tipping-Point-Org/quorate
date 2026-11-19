function g() {}
import * as ns from './other.mjs';
class C {
  a = g();
  b = this.m();
  h = () => this.m();
  static s = g();
  m() {}
}
