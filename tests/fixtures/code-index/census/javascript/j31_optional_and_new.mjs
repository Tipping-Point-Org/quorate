function g() {}
import * as ns from './other.mjs';
g?.();
ns?.f();
new g();
new ns.K();
