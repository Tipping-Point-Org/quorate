def g(): pass
import os
type A = g()
type B[T: g()] = list[T]
