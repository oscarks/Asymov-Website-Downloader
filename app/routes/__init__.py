from app.routes.download import bp as download_bp
from app.routes.workspace import bp as workspace_bp
from app.routes.extraction import bp as extraction_bp
from app.routes.assistant import bp as assistant_bp
from app.routes.config import bp as config_bp


def register_blueprints(app):
    """Register all route blueprints on the Flask app."""
    app.register_blueprint(download_bp)
    app.register_blueprint(workspace_bp)
    app.register_blueprint(extraction_bp)
    app.register_blueprint(assistant_bp)
    app.register_blueprint(config_bp)
