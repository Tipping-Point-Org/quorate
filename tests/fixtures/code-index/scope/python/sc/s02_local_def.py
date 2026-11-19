def f():
    def inner():
        return 1
    return inner()
