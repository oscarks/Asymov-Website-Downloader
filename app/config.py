import os
import json
from dotenv import load_dotenv

load_dotenv()

WORKSPACE_DIR = os.getenv("WORKSPACE_DIR", "./workspace")
DOWNLOAD_FOLDER = "downloads"
DEFAULT_LLM_PROVIDER = os.getenv("DEFAULT_LLM_PROVIDER", "openai")
DEFAULT_LLM_MODEL = os.getenv("DEFAULT_LLM_MODEL", "gpt-4o")

PROVIDERS = {
    "openai": {
        "name": "OpenAI",
        "env_key": "OPENAI_API_KEY",
        "models": ["o3", "o4-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-4o", "gpt-4o-mini", "gpt-5.4", "gpt-5-mini", "gpt-5-nano", "gpt-5.4-pro"],
    },
    "anthropic": {
        "name": "Anthropic",
        "env_key": "ANTHROPIC_API_KEY",
        "models": ["claude-sonnet-4-20250514", "claude-opus-4-20250514", "claude-haiku-4-5-20251001"],
    },
    "google": {
        "name": "Google",
        "env_key": "GOOGLE_API_KEY",
        "models": ["gemini-2.5-pro", "gemini-2.5-flash"],
    },
    "openai-compatible": {
        "name": "OpenAI Compatible",
        "env_key": "CUSTOM_LLM_API_KEY",
        "models": [],
        "requires_base_url": True,
    },
}

CONFIG_FILE = os.path.join(WORKSPACE_DIR, ".config.json")


def ensure_workspace():
    """Create workspace directory if it does not exist."""
    os.makedirs(WORKSPACE_DIR, exist_ok=True)


def load_user_config():
    """Read config JSON file. Returns empty dict if file missing."""
    if not os.path.exists(CONFIG_FILE):
        return {}
    try:
        with open(CONFIG_FILE, "r") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return {}


def save_user_config(data):
    """Write config JSON to CONFIG_FILE."""
    ensure_workspace()
    with open(CONFIG_FILE, "w") as f:
        json.dump(data, f, indent=2)


def get_api_key(provider):
    """Resolve API key for a provider from user config or environment."""
    user_cfg = load_user_config()
    api_keys = user_cfg.get("api_keys", {})
    key = api_keys.get(provider)
    if key:
        return key
    provider_info = PROVIDERS.get(provider, {})
    env_key = provider_info.get("env_key", "")
    return os.getenv(env_key, "")


def get_custom_base_url():
    """Resolve custom base URL from user config or environment."""
    user_cfg = load_user_config()
    url = user_cfg.get("custom_base_url")
    if url:
        return url
    return os.getenv("CUSTOM_LLM_BASE_URL", "")
