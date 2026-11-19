def g(): pass
class A:
    def xxx(self): return self.xxx()
    xxx = 1
class B:
    xxx = 1
    def xxx(self): return self.xxx()
class C:
    def yyy(self): return self.xxx()
    def xxx(self): return xxx()
def xxx(): return 0
