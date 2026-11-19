function g() {}
import * as ns from './other.mjs';
const a = () => g();
const b = (g) => g();
[1].map((x) => g(x));
