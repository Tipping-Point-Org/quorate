from pkg.client import complete as _complete
from pkg.client import assert_local_allowed
from missing.module import thing as _thing


def render(scene):
    try:
        return _complete(scene, model="auto")
    except Exception:
        return None


def unguarded(scene):
    try:
        return scene.upper()
    except Exception:
        return None


def mystery(scene):
    return _thing(scene)


def dynamic(obj, name):
    return getattr(obj, name)(1)
