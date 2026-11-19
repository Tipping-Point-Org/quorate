import os
class C:
    def deco(x): return x
    @deco
    def m(self, a=deco(1)):
        pass
