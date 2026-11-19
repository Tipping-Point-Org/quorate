function f(mode) {
  let wanted = "a";
  const change = () => { wanted = "b"; };
  change();
  return mode === wanted;
}
