def g(): pass
import os
def f():
    def h(): pass
    def inner():
        nonlocal h
        h()
    h()
