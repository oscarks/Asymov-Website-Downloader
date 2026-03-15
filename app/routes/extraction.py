import os
import uuid
import queue
import threading
import time

from flask import Blueprint, request, Response, jsonify

from app import config
from app.session import message_queues, extract_results
from app.services.extractor import extract_design_system

bp = Blueprint('extraction', __name__)


@bp.route('/api/extract', methods=['POST'])
def api_extract():
    """Start design system extraction."""
    data = request.get_json()
    site_name = data.get('site_name')
    provider = data.get('provider')
    model = data.get('model')

    if not all([site_name, provider, model]):
        return jsonify({'error': 'site_name, provider e model são obrigatórios'}), 400

    site_folder = os.path.join(config.WORKSPACE_DIR, site_name)
    if not os.path.isdir(site_folder):
        return jsonify({'error': 'Site não encontrado'}), 404

    api_key = config.get_api_key(provider)
    if not api_key:
        return jsonify({'error': f'API key não configurada para {provider}'}), 400

    base_url = config.get_custom_base_url() if provider == "openai-compatible" else None

    session_id = str(uuid.uuid4())
    message_queues[session_id] = queue.Queue()
    extract_results[session_id] = {'status': 'processing'}

    thread = threading.Thread(
        target=process_extraction,
        args=(session_id, site_folder, provider, model, api_key, base_url)
    )
    thread.daemon = True
    thread.start()

    return jsonify({'session_id': session_id})


def process_extraction(session_id, site_folder, provider, model, api_key, base_url):
    """Background extraction process."""
    q = message_queues[session_id]

    def log_callback(message):
        q.put(message)

    result = extract_design_system(
        site_folder=site_folder,
        provider=provider,
        model=model,
        api_key=api_key,
        base_url=base_url,
        log_callback=log_callback,
    )

    if result["success"]:
        q.put("🎉 Design System gerado com sucesso!")
        extract_results[session_id] = {
            'status': 'complete',
            'filename': result.get('filename', ''),
            'created_at': time.time(),
        }
    else:
        q.put(f"❌ Falha na extração: {result.get('error', 'Erro desconhecido')}")
        extract_results[session_id] = {
            'status': 'error',
            'error': result.get('error', ''),
        }


@bp.route('/api/extract/stream/<session_id>')
def api_extract_stream(session_id):
    """SSE endpoint for extraction progress."""
    def generate():
        if session_id not in message_queues:
            yield f"data: ❌ Sessão não encontrada\n\n"
            return

        q = message_queues[session_id]

        while True:
            try:
                message = q.get(timeout=120)
                yield f"data: {message}\n\n"

                result = extract_results.get(session_id, {})
                if result.get('status') in ['complete', 'error']:
                    extra = ""
                    if result.get('filename'):
                        extra = f"|{result['filename']}"
                    yield f"event: done\ndata: {result['status']}{extra}\n\n"
                    break

            except queue.Empty:
                yield f": keepalive\n\n"

    return Response(generate(), mimetype='text/event-stream')
