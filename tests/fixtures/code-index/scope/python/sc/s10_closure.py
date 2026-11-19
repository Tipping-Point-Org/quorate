def outer():
    def h():
        return 1

    def f():
        return h()
    return f
