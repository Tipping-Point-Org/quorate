function g() {}
import * as ns from './other.mjs';
class C {
  static {
    const parseInt = 1;
    parseInt();
    g();
  }
}
