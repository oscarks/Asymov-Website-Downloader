import os
import mimetypes

from flask import Blueprint, request, Response, jsonify, abort

from app import config
import app.services.workspace as ws

bp = Blueprint('workspace', __name__)


@bp.route('/api/workspace')
def api_workspace():
    """List all sites in the workspace."""
    return jsonify(ws.list_sites())


@bp.route('/api/workspace/<site_name>/design-systems')
def api_design_systems(site_name):
    """List design systems for a site."""
    site_folder = os.path.join(config.WORKSPACE_DIR, site_name)
    if not os.path.isdir(site_folder):
        return jsonify({'error': 'Site não encontrado'}), 404
    return jsonify(ws.list_design_systems(site_folder))


@bp.route('/api/workspace/<site_name>/preview')
def api_preview_index(site_name):
    """Serve site index.html for iframe preview."""
    return _serve_site_file(site_name, "index.html")


@bp.route('/api/workspace/<site_name>/preview/<path:filename>')
@bp.route('/api/workspace/<site_name>/<path:filename>')
def api_preview(site_name, filename=None):
    """Serve any file from a site folder (assets, images, etc.)."""
    if filename is None:
        filename = "index.html"
    return _serve_site_file(site_name, filename)


@bp.route('/api/workspace/<site_name>/ds/<path:filename>')
def api_design_system_preview(site_name, filename):
    """Serve a specific design system HTML for iframe preview."""
    return _serve_site_file(site_name, filename)


@bp.route('/api/workspace/<site_name>/save', methods=['POST'])
def api_save_file(site_name):
    """Save edited HTML back to the site's workspace folder."""
    site_folder = os.path.join(config.WORKSPACE_DIR, site_name)
    if not os.path.isdir(site_folder):
        return jsonify({'error': 'Site não encontrado'}), 404

    data = request.get_json()
    filename = data.get('filename', 'index.html')
    content = data.get('content')

    if not content:
        return jsonify({'error': 'Conteúdo vazio'}), 400

    file_path = os.path.join(site_folder, filename)
    # Prevent path traversal
    if not os.path.abspath(file_path).startswith(os.path.abspath(site_folder)):
        abort(403)

    if not os.path.isfile(file_path):
        return jsonify({'error': 'Arquivo não encontrado'}), 404

    try:
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(content)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def _serve_site_file(site_name, filename):
    """Serve a file from a site's workspace folder with path traversal protection."""
    site_folder = os.path.join(config.WORKSPACE_DIR, site_name)
    if not os.path.isdir(site_folder):
        abort(404)

    file_path = os.path.join(site_folder, filename)
    # Prevent path traversal
    if not os.path.abspath(file_path).startswith(os.path.abspath(site_folder)):
        abort(403)

    if not os.path.isfile(file_path):
        abort(404)

    content_type, _ = mimetypes.guess_type(file_path)
    if content_type is None:
        content_type = 'application/octet-stream'

    with open(file_path, 'rb') as f:
        data = f.read()

    response = Response(data, content_type=content_type)
    response.headers['X-Frame-Options'] = 'SAMEORIGIN'
    return response
