wanted = "a"


def change():
    global wanted
    wanted = "b"


def f(mode):
    change()
    return mode == wanted
