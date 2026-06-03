class LLMError(Exception):
    """Raised when LLM service is unavailable or returns invalid response."""


def llm_complete(user_prompt: str, system_prompt: str = "", **params) -> str:
    """Placeholder for future LLM integration."""
    raise LLMError("LLM integration is not implemented yet")
