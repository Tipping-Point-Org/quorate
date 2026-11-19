function g() {}
import * as ns from './other.mjs';
class B { m() {} }
class C extends B {
  #p() {}
  m() { this.#p(); super.m(); }
  constructor() { super(); }
}
