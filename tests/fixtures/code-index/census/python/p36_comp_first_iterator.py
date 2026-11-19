def g(): pass
import os
def f():
    def g(): pass
    return [x for x in g() for y in g()]
