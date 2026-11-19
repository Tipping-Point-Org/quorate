def f(mode, get):
    wanted = "a"
    if (wanted := get()):
        pass
    return mode == wanted
