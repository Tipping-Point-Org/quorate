def g(): pass
import os
def f(a=g(), *, b=g()):
    def g(): pass
