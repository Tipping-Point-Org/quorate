def f(mode, act):
    wanted = "a"
    try:
        act()
    except Exception as wanted:
        pass
    return mode == wanted
