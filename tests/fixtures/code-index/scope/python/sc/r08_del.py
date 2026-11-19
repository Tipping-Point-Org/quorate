def f(mode):
    wanted = "a"
    del wanted
    wanted = mode
    return mode == wanted
