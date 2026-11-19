function g() {}
import * as ns from './other.mjs';
async function f() { await g(); }
function* h() { yield g(); }
const k = async () => { await g(); };
