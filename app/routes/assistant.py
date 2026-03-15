import os
import json
import uuid
import queue
import threading

from flask import Blueprint, request, Response, jsonify

from app import config
from app.session import message_queues, assistant_results
from app.services.assistant import (
    run_assistant, restore_backup, load_conversation, save_conversation,
    archive_conversation, add_message, get_history_for_llm,
    cleanup_old_backups, _new_conversation,
)

bp = Blueprint('assistant', __name__)


@bp.route('/api/assistant', methods=['POST'])
def api_assistant():
    """Start an assistant session: send prompt, get session_id for SSE."""
    data = request.get_json()
    site_name = data.get('site_name')
    prompt = data.get('prompt')
    target = data.get('target', 'index.html')

    if not site_name or not prompt:
        return jsonify({'error': 'site_name e prompt são obrigatórios'}), 400

    site_folder = os.path.join(config.WORKSPACE_DIR, site_name)
    if not os.path.isdir(site_folder):
        return jsonify({'error': 'Site não encontrado'}), 404

    # Resolve provider/model from config
    user_cfg = config.load_user_config()
    provider = user_cfg.get('default_provider', config.DEFAULT_LLM_PROVIDER)
    model = user_cfg.get('default_model', config.DEFAULT_LLM_MODEL)

    api_key = config.get_api_key(provider)
    if not api_key:
        return jsonify({'error': f'API key não configurada para {provider}'}), 400

    base_url = config.get_custom_base_url() if provider == "openai-compatible" else None

    session_id = str(uuid.uuid4())
    message_queues[session_id] = queue.Queue()
    assistant_results[session_id] = {'status': 'processing'}

    # Load or create conversation from disk
    conversation = load_conversation(site_folder)
    if not conversation:
        conversation = _new_conversation(site_name, target)

    # Cleanup old backups opportunistically
    cleanup_old_backups(site_folder)

    thread = threading.Thread(
        target=process_assistant,
        args=(session_id, site_folder, target, prompt, provider, model,
              api_key, base_url, conversation),
    )
    thread.daemon = True
    thread.start()

    return jsonify({'session_id': session_id})


def process_assistant(session_id, site_folder, target, prompt, provider, model,
                      api_key, base_url, conversation):
    """Background assistant process."""
    q = message_queues[session_id]

    def log_callback(message):
        q.put(message)

    # Build history for LLM from persisted conversation
    history = get_history_for_llm(conversation)

    result = run_assistant(
        site_folder=site_folder,
        target_file=target,
        user_prompt=prompt,
        provider=provider,
        model=model,
        api_key=api_key,
        base_url=base_url,
        history=history,
        log_callback=log_callback,
    )

    # Persist messages to conversation file
    add_message(conversation, "user", prompt)
    backup_id = result.get("backup_id")
    add_message(conversation, "assistant", result.get("explanation", ""), backup_id)
    save_conversation(site_folder, conversation)

    if result.get("success"):
        q.put("OK")
        assistant_results[session_id] = {
            'status': 'complete',
            'explanation': result.get('explanation', ''),
            'modifications': result.get('modifications', []),
            'results': result.get('results', []),
            'backup_id': backup_id,
        }
    else:
        q.put(f"Erro: {result.get('explanation', 'Erro desconhecido')}")
        assistant_results[session_id] = {
            'status': 'error',
            'error': result.get('explanation', ''),
        }


@bp.route('/api/assistant/stream/<session_id>')
def api_assistant_stream(session_id):
    """SSE endpoint for assistant progress."""
    def generate():
        if session_id not in message_queues:
            yield f"data: Sessão não encontrada\n\n"
            return

        q = message_queues[session_id]

        while True:
            try:
                message = q.get(timeout=120)
                yield f"data: {message}\n\n"

                result = assistant_results.get(session_id, {})
                if result.get('status') in ['complete', 'error']:
                    payload = json.dumps(result, ensure_ascii=False)
                    yield f"event: done\ndata: {payload}\n\n"
                    break

            except queue.Empty:
                yield f": keepalive\n\n"

    return Response(generate(), mimetype='text/event-stream')


@bp.route('/api/assistant/conversation/<site_name>')
def api_assistant_conversation(site_name):
    """Load the current conversation for a site."""
    site_folder = os.path.join(config.WORKSPACE_DIR, site_name)
    if not os.path.isdir(site_folder):
        return jsonify({'error': 'Site não encontrado'}), 404

    conversation = load_conversation(site_folder)
    if not conversation:
        return jsonify({'messages': []})

    # Return only what the frontend needs
    return jsonify({
        'messages': conversation.get('messages', []),
        'target': conversation.get('target', 'index.html'),
    })


@bp.route('/api/assistant/conversation/<site_name>/new', methods=['POST'])
def api_assistant_new_conversation(site_name):
    """Archive current conversation and start a new one."""
    site_folder = os.path.join(config.WORKSPACE_DIR, site_name)
    if not os.path.isdir(site_folder):
        return jsonify({'error': 'Site não encontrado'}), 404

    archive_conversation(site_folder)
    return jsonify({'success': True})


@bp.route('/api/assistant/undo', methods=['POST'])
def api_assistant_undo():
    """Undo the last assistant operation."""
    data = request.get_json()
    site_name = data.get('site_name')
    backup_id = data.get('backup_id')

    if not site_name or not backup_id:
        return jsonify({'error': 'site_name e backup_id são obrigatórios'}), 400

    site_folder = os.path.join(config.WORKSPACE_DIR, site_name)
    if not os.path.isdir(site_folder):
        return jsonify({'error': 'Site não encontrado'}), 404

    success = restore_backup(site_folder, backup_id)
    if success:
        return jsonify({'success': True})
    else:
        return jsonify({'error': 'Backup não encontrado'}), 404
