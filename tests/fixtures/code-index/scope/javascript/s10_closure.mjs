function outer() {
  const h = () => 1;
  function f() {
    return h();
  }
  return f;
}
