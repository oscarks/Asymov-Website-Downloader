import os

from flask import Blueprint, request, jsonify

from app import config
from app.llm.factory import test_connection

bp = Blueprint('config_routes', __name__)


@bp.route('/api/config', methods=['GET'])
def api_get_config():
    """Return config (without actual API key values)."""
    user_cfg = config.load_user_config()
    api_keys = user_cfg.get("api_keys", {})

    configured = {}
    for provider_key in config.PROVIDERS:
        has_user_key = bool(api_keys.get(provider_key))
        has_env_key = bool(os.getenv(config.PROVIDERS[provider_key]["env_key"], ""))
        configured[provider_key] = has_user_key or has_env_key

    return jsonify({
        "default_provider": user_cfg.get("default_provider", config.DEFAULT_LLM_PROVIDER),
        "default_model": user_cfg.get("default_model", config.DEFAULT_LLM_MODEL),
        "configured": configured,
        "custom_base_url": user_cfg.get("custom_base_url", ""),
    })


@bp.route('/api/config', methods=['POST'])
def api_set_config():
    """Update config."""
    data = request.get_json()
    user_cfg = config.load_user_config()

    if "default_provider" in data:
        user_cfg["default_provider"] = data["default_provider"]
    if "default_model" in data:
        user_cfg["default_model"] = data["default_model"]
    if "api_keys" in data:
        existing_keys = user_cfg.get("api_keys", {})
        for k, v in data["api_keys"].items():
            if v is not None and v != "":
                existing_keys[k] = v
        user_cfg["api_keys"] = existing_keys
    if "custom_base_url" in data:
        user_cfg["custom_base_url"] = data["custom_base_url"]

    config.save_user_config(user_cfg)
    return jsonify({"success": True})


@bp.route('/api/providers')
def api_providers():
    """List available LLM providers and models."""
    return jsonify(config.PROVIDERS)


@bp.route('/api/config/test', methods=['POST'])
def api_test_connection():
    """Test LLM connection."""
    data = request.get_json()
    provider = data.get('provider')
    model = data.get('model')

    if not provider or not model:
        return jsonify({'error': 'provider e model são obrigatórios'}), 400

    api_key = config.get_api_key(provider)
    if not api_key:
        return jsonify({'success': False, 'error': 'API key não configurada'}), 200

    base_url = config.get_custom_base_url() if provider == "openai-compatible" else None
    result = test_connection(provider, model, api_key, base_url)
    return jsonify(result)
