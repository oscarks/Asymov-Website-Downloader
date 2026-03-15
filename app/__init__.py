import os
import shutil

from flask import Flask, render_template

from app import config
from app.session import start_cleanup_thread
from app.routes import register_blueprints

# Project root directory (parent of app/)
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def create_app():
    """Flask application factory."""
    app = Flask(
        __name__,
        template_folder=os.path.join(_PROJECT_ROOT, 'templates'),
        static_folder=os.path.join(_PROJECT_ROOT, 'static'),
    )

    # Ensure directories exist
    if not os.path.exists(config.DOWNLOAD_FOLDER):
        os.makedirs(config.DOWNLOAD_FOLDER)
    config.ensure_workspace()

    # Cleanup downloads folder on startup
    _cleanup_downloads_folder()

    # Register all route blueprints
    register_blueprints(app)

    # Index page
    @app.route('/')
    def index():
        return render_template('index.html')

    # Start background cleanup thread
    start_cleanup_thread()

    return app


def _cleanup_downloads_folder():
    """Remove all files and folders from downloads directory"""
    try:
        for item in os.listdir(config.DOWNLOAD_FOLDER):
            item_path = os.path.join(config.DOWNLOAD_FOLDER, item)
            if os.path.isfile(item_path):
                os.remove(item_path)
            elif os.path.isdir(item_path):
                shutil.rmtree(item_path)
        print(f"🧹 Pasta downloads limpa com sucesso")
    except Exception as e:
        print(f"⚠️ Erro ao limpar pasta downloads: {e}")
