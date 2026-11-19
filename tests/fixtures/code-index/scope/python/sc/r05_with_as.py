def f(mode, ctx):
    wanted = "a"
    with ctx as wanted:
        pass
    return mode == wanted
