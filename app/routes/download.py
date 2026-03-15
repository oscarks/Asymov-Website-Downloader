import os
import uuid
import queue
import shutil
import threading
import time

from flask import Blueprint, request, send_file, Response, jsonify

from app import config
from app.session import message_queues, download_results
from app.services.downloader import WebsiteDownloader, zip_directory, get_site_name
import app.services.workspace as ws

bp = Blueprint('download', __name__)


@bp.route('/api/download', methods=['POST'])
@bp.route('/start-download', methods=['POST'])
def start_download():
    """Start download process and return session ID for SSE"""
    data = request.get_json()
    url = data.get('url')

    if not url:
        return jsonify({'error': 'URL é obrigatória'}), 400

    session_id = str(uuid.uuid4())
    message_queues[session_id] = queue.Queue()
    download_results[session_id] = {'status': 'processing', 'zip_path': None, 'filename': None}

    thread = threading.Thread(target=process_download, args=(session_id, url))
    thread.daemon = True
    thread.start()

    return jsonify({'session_id': session_id})


def process_download(session_id, url):
    """Background download process — downloads, zips, then saves to workspace"""
    q = message_queues[session_id]
    request_id = session_id
    download_dir = os.path.join(config.DOWNLOAD_FOLDER, request_id)
    zip_path = os.path.join(config.DOWNLOAD_FOLDER, f"{request_id}.zip")

    def log_callback(message):
        q.put(message)

    try:
        downloader = WebsiteDownloader(url, download_dir, log_callback=log_callback)
        success = downloader.process()

        if not success:
            q.put("❌ Falha no download")
            download_results[session_id] = {'status': 'error', 'error': 'Failed to download site'}
            return

        site_name = get_site_name(url)
        zip_filename = f"{site_name}.zip"

        q.put("📦 Criando arquivo ZIP...")
        zip_directory(download_dir, zip_path)

        # Cleanup raw download files
        shutil.rmtree(download_dir)

        # Save to workspace
        q.put("📂 Salvando no workspace...")
        site_folder = ws.unzip_to_workspace(zip_path, url)
        folder_name = os.path.basename(site_folder)
        q.put(f"✅ Site salvo em: {folder_name}")

        q.put("🎉 Download pronto!")
        download_results[session_id] = {
            'status': 'complete',
            'zip_path': zip_path,
            'filename': zip_filename,
            'site_folder': site_folder,
            'site_name': folder_name,
            'created_at': time.time()
        }

    except Exception as e:
        q.put(f"❌ Erro: {str(e)}")
        download_results[session_id] = {'status': 'error', 'error': str(e)}
        try:
            if os.path.exists(download_dir):
                shutil.rmtree(download_dir)
            if os.path.exists(zip_path):
                os.remove(zip_path)
        except:
            pass


@bp.route('/stream/<session_id>')
@bp.route('/api/download/stream/<session_id>')
def stream(session_id):
    """SSE endpoint for log streaming"""
    def generate():
        if session_id not in message_queues:
            yield f"data: ❌ Sessão não encontrada\n\n"
            return

        q = message_queues[session_id]

        while True:
            try:
                message = q.get(timeout=60)
                yield f"data: {message}\n\n"

                result = download_results.get(session_id, {})
                if result.get('status') in ['complete', 'error']:
                    extra = ""
                    if result.get('site_name'):
                        extra = f"|{result['site_name']}"
                    yield f"event: done\ndata: {result['status']}{extra}\n\n"
                    break

            except queue.Empty:
                yield f": keepalive\n\n"

    return Response(generate(), mimetype='text/event-stream')


@bp.route('/download-file/<session_id>')
def download_file(session_id):
    """Download the generated ZIP file (legacy fallback)"""
    result = download_results.get(session_id)

    if not result or result['status'] != 'complete':
        return "File not ready", 404

    zip_path = result.get('zip_path')
    filename = result.get('filename')

    if not zip_path or not os.path.exists(zip_path):
        return "File not found", 404

    try:
        response = send_file(zip_path, as_attachment=True, download_name=filename)

        def cleanup():
            time.sleep(1)
            try:
                if os.path.exists(zip_path):
                    os.remove(zip_path)
                if session_id in message_queues:
                    del message_queues[session_id]
                if session_id in download_results:
                    del download_results[session_id]
            except:
                pass

        t = threading.Thread(target=cleanup, daemon=True)
        t.start()
        return response
    except Exception as e:
        print(f"❌ Erro ao enviar arquivo: {e}")
        return "Error sending file", 500
