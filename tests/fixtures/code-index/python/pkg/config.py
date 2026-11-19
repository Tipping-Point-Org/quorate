class LLMConfig:
    def __init__(self, provider, model="auto", by_model=None):
        self.provider = provider
        self.model = model
        self.by_model = by_model or {}


class Asset:
    def __init__(self, path, kind="image"):
        self.path = path
        self.kind = kind
