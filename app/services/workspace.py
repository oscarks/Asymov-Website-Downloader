import os
import re
import zipfile
from datetime import datetime
from urllib.parse import urlparse
from glob import glob

from app.config import WORKSPACE_DIR, ensure_workspace


def _sanitize_name(name):
    """Sanitize a string to be safe as a folder name."""
    return re.sub(r'[^a-zA-Z0-9._-]', '_', name)


def create_site_folder(url):
    """Create a unique site folder in the workspace based on URL domain."""
    ensure_workspace()
    parsed = urlparse(url)
    domain = parsed.netloc.replace('www.', '')
    folder_name = _sanitize_name(domain)

    if not folder_name:
        folder_name = "site"

    target = os.path.join(WORKSPACE_DIR, folder_name)
    if not os.path.exists(target):
        os.makedirs(target)
        return os.path.abspath(target)

    # Append suffix to avoid collision
    counter = 2
    while True:
        suffixed = f"{folder_name}_{counter}"
        target = os.path.join(WORKSPACE_DIR, suffixed)
        if not os.path.exists(target):
            os.makedirs(target)
            return os.path.abspath(target)
        counter += 1


def unzip_to_workspace(zip_path, url):
    """Extract ZIP contents into a new site folder in the workspace."""
    site_folder = create_site_folder(url)

    with zipfile.ZipFile(zip_path, 'r') as zf:
        zf.extractall(site_folder)

    # Remove the ZIP file after extraction
    try:
        os.remove(zip_path)
    except OSError:
        pass

    return site_folder


def list_sites():
    """List all site directories in the workspace."""
    ensure_workspace()
    sites = []

    for entry in sorted(os.listdir(WORKSPACE_DIR)):
        if entry.startswith('.'):
            continue
        full_path = os.path.join(WORKSPACE_DIR, entry)
        if not os.path.isdir(full_path):
            continue

        ds_files = _find_design_systems(full_path)
        sites.append({
            "name": entry,
            "path": os.path.abspath(full_path),
            "has_index": os.path.isfile(os.path.join(full_path, "index.html")),
            "design_systems": [os.path.basename(f) for f in ds_files],
            "design_system_count": len(ds_files),
        })

    return sites


def _find_design_systems(site_folder):
    """Find all design system HTML files in a site folder."""
    pattern = os.path.join(site_folder, "design-system_*.html")
    return sorted(glob(pattern), reverse=True)


def list_design_systems(site_folder):
    """List design system files with parsed metadata."""
    ds_files = _find_design_systems(site_folder)
    result = []

    for fpath in ds_files:
        filename = os.path.basename(fpath)
        meta = _parse_ds_filename(filename)
        meta["filename"] = filename
        meta["path"] = os.path.abspath(fpath)
        result.append(meta)

    return result


def _parse_ds_filename(filename):
    """Parse design-system_{provider}_{model}_{timestamp}.html into components."""
    # Remove prefix and extension
    stem = filename.replace("design-system_", "").replace(".html", "")
    parts = stem.rsplit("_", 1)

    if len(parts) == 2:
        provider_model = parts[0]
        ts_str = parts[1]
    else:
        provider_model = stem
        ts_str = ""

    # Split provider from model: first segment is provider
    pm_parts = provider_model.split("_", 1)
    provider = pm_parts[0] if pm_parts else "unknown"
    model = pm_parts[1] if len(pm_parts) > 1 else "unknown"

    # Parse timestamp
    timestamp = ""
    if ts_str:
        try:
            dt = datetime.strptime(ts_str, "%Y%m%d-%H%M%S")
            timestamp = dt.strftime("%Y-%m-%d %H:%M:%S")
        except ValueError:
            timestamp = ts_str

    return {
        "provider": provider,
        "model": model,
        "timestamp": timestamp,
    }


def generate_ds_filename(provider, model):
    """Generate a unique design system filename."""
    model_sanitized = re.sub(r'[/ ]', '-', model).lower()
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    return f"design-system_{provider}_{model_sanitized}_{ts}.html"
