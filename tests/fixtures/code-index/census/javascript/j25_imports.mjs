import d from './other.mjs';
import { x as y, 'a b' as z } from './other.mjs';
import * as ns from 'pkg';
d(); y(); z(); ns.f();
