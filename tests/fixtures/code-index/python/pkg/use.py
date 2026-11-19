from pkg.config import LLMConfig, Asset
from pkg.client import assert_local_allowed as guard


def locality():
    return "local"


def build(self):
    config = LLMConfig(provider="ollama", model="auto", by_model={"fast": "small", "slow": "large"})
    guard(config)
    mode = locality()
    if mode == "local":
        Asset("a.png", kind="image")
    if config.by_model == locality():
        return None
    bind(self.settings.llm)
    return config


def bind(config):
    return config


def check(config):
    wanted = "auto"
    return config.model == wanted
