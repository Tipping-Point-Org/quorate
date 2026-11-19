def g(): pass
import os
xs = []
a = {g() for g in xs}
b = {g(): 1 for g in xs}
c = (g() for g in xs)
