# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Website Downloader is a Flask web app that creates offline replicas of websites. It uses Playwright/Chromium to render pages (including JS-heavy SPAs), captures all network resources, rewrites URLs to local paths, and packages everything into a ZIP file.

## Development Commands

```bash
# Install dependencies
uv sync

# Install Playwright browser
uv run playwright install chromium

# Run development server (localhost:5001)
uv run python app.py

# Production (Docker)
docker build -t website-downloader .
docker run -p 8080:8080 website-downloader
```

## Architecture

Two Python files contain all application logic:

- **`app.py`** — Flask server with three main routes:
  - `POST /start-download` — Creates a session, spawns a background thread for download
  - `GET /stream/<session_id>` — SSE endpoint streaming real-time log messages
  - `GET /download-file/<session_id>` — Serves the ZIP and triggers cleanup
  - Uses `message_queues` (dict of `queue.Queue`) for per-session SSE streaming and `download_results` for tracking session state

- **`downloader.py`** — `WebsiteDownloader` class that orchestrates the full pipeline:
  1. Launches headless Chromium via Playwright, intercepts all network responses (`page.on("response")`) into `self.network_resources`
  2. Detects and extracts iframe content (site builders like Aura, Webflow)
  3. Scrolls page to trigger lazy-loaded images
  4. Parses HTML with BeautifulSoup, rewrites all asset URLs (CSS, JS, images, fonts) to local `assets/` paths
  5. Fixes offline viewing: removes smooth-scroll libraries (Lenis, Locomotive), injects CSS overrides for scroll/visibility
  6. Strips SPA framework scripts (Next.js, Gatsby, Nuxt) while preserving third-party analytics
  7. Converts navigation links to `#` for offline use

- **`templates/index.html`** — Single-page UI (vanilla JS, no build step). Uses SSE via `EventSource` to display real-time progress logs.

## Key Patterns

- **Resource resolution order**: network capture cache → `requests` fallback download → original URL
- **CSS url() rewriting**: `_rewrite_css_urls()` resolves URLs relative to the CSS file's location, not the page
- **Log callback**: `WebsiteDownloader` accepts a `log_callback` function; `app.py` pipes it to the SSE queue
- **Session cleanup**: Background thread removes abandoned sessions after 30 minutes; downloads folder is cleaned on startup

## Deployment

Uses Docker (Python 3.11-slim + Playwright Chromium). Configured for Railway (`entrypoint.sh`, port 8080) and Render (`render.yaml`). Production runs via Gunicorn with `gthread` worker class, 1 worker, 2 threads, 300s timeout.

## Language

UI text and log messages are in Brazilian Portuguese.
