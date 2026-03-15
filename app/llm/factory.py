from langchain_openai import ChatOpenAI
from langchain_anthropic import ChatAnthropic
from langchain_google_genai import ChatGoogleGenerativeAI


def get_llm(provider, model, api_key, base_url=None):
    """Instantiate a LangChain chat model for the given provider."""
    if provider == "openai":
        return ChatOpenAI(model=model, api_key=api_key, temperature=0.2)
    elif provider == "anthropic":
        return ChatAnthropic(model=model, api_key=api_key, temperature=0.2, max_tokens=16000)
    elif provider == "google":
        return ChatGoogleGenerativeAI(model=model, google_api_key=api_key, temperature=0.2)
    elif provider == "openai-compatible":
        return ChatOpenAI(model=model, api_key=api_key, base_url=base_url, temperature=0.2)
    else:
        raise ValueError(f"Provider desconhecido: {provider}")


def test_connection(provider, model, api_key, base_url=None):
    """Test LLM connection with a minimal message."""
    try:
        llm = get_llm(provider, model, api_key, base_url)
        llm.invoke("Hi")
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}
