function g() {}
import * as ns from './other.mjs';
import('./other.mjs');
(await import('./other.mjs')).f();
g`x`;
import.meta.resolve('x');
