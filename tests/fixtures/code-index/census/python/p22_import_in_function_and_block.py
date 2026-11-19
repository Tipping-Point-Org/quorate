def g(): pass
import os
def f():
    if True:
        from os import path as p
    p.join()
try:
    import json as j
except ImportError:
    j = None
j.dumps()
