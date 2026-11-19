class LLMSettings:
    provider: str = "ollama"
    model: str = "auto"
    retries: int = 3


class Settings:
    llm: LLMSettings = None
