function g() {}
import * as ns from './other.mjs';
g: for (;;) { g(); break g; }
