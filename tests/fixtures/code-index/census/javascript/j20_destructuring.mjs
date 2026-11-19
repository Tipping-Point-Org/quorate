function g() {}
import * as ns from './other.mjs';
const { a = g(), [g()]: b } = {};
function f({ g }) { g(); }
const [parseInt] = [];
parseInt();
