def g(): pass
import os
def f(xs):
    return [g() for g in xs]
