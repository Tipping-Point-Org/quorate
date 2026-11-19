def f(mode):
    wanted = "a"

    def change():
        nonlocal wanted
        wanted = "b"
    change()
    return mode == wanted
