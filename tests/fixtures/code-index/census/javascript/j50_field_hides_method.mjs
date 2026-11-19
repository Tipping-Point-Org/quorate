function g() {}
export class A { xxx = 1; xxx() { return this.xxx(); } }
export class C { yyy() { return this.xxx(); } xxx() { return xxx(); } }
function xxx() { return 0; }
