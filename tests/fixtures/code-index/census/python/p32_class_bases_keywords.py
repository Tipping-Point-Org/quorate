def g(): pass
import os
class C(g(), metaclass=g()):
    pass
