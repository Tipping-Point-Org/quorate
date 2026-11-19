def g(): pass
import os
def f():
    def g(): pass
    return lambda a=g(): a
