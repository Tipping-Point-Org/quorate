function g() {}
import * as ns from './other.mjs';
function f() {
  { let g = 1; }
  g();
  if (1) { function h() {} }
  h();
}
