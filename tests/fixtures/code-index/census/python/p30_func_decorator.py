def g(): pass
import os
def deco(x): return x
@deco
@g()
def f():
    pass
