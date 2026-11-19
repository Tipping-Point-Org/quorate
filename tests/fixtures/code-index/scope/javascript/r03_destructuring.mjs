function f(mode, pair) {
  let wanted = "a";
  [, wanted] = pair;
  return mode === wanted;
}
