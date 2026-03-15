# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Website Downloader is a Flask web app that creates offline replicas of websites. It uses Playwright/Chromium to render pages (including JS-heavy SPAs), captures all network resources, rewrites URLs to local paths, and packages everything into a ZIP file. It also includes an AI assistant for modifying downloaded sites and extracting design systems.

## Development Commands

```bash
# Install dependencies
uv sync

# Install Playwright browser
uv run playwright install chromium

# Run development server (localhost:5001)
uv run python run.py

# Production (Docker)
docker build -t website-downloader .
docker run -p 8080:8080 website-downloader
```

## Architecture

The project is organized in layers:

```
app/
├── __init__.py              # Flask app factory (create_app)
├── config.py                # Configuration, env vars, LLM providers
├── session.py               # Shared SSE queues and session state
├── routes/                  # Web layer (Flask Blueprints)
│   ├── download.py          # /api/download, /stream, /download-file
│   ├── workspace.py         # /api/workspace/*
│   ├── extraction.py        # /api/extract/*
│   ├── assistant.py         # /api/assistant/*
│   └── config.py            # /api/config/*, /api/providers
├── services/                # Business logic layer
│   ├── downloader.py        # WebsiteDownloader (Playwright scraping)
│   ├── extractor.py         # Design system extraction (LangGraph pipeline)
│   ├── assistant.py         # AI assistant (context builder, LLM call, apply mods)
│   └── workspace.py         # Workspace/site folder management
└── llm/                     # LLM infrastructure
    └── factory.py           # LangChain model factory (OpenAI, Anthropic, Google)
```

- **`run.py`** — Entry point. Creates the Flask app via `create_app()`.
- **`templates/index.html`** — Single-page UI (vanilla JS, no build step). Uses SSE via `EventSource`.
- **`static/`** — CSS and JS assets for the UI.

### Key Services

- **`services/downloader.py`** — `WebsiteDownloader` class:
  1. Launches headless Chromium via Playwright, intercepts all network responses
  2. Detects and extracts iframe content (site builders like Aura, Webflow)
  3. Scrolls page to trigger lazy-loaded images
  4. Parses HTML with BeautifulSoup, rewrites all asset URLs to local `assets/` paths
  5. Fixes offline viewing: removes smooth-scroll libraries, injects CSS overrides
  6. Strips SPA framework scripts (Next.js, Gatsby, Nuxt) while preserving analytics

- **`services/assistant.py`** — AI assistant that builds context from site files, calls LLM, and applies search/replace modifications with backup/undo support.

- **`services/extractor.py`** — LangGraph pipeline that extracts design systems from downloaded sites using LLM analysis.

## Key Patterns

- **Resource resolution order**: network capture cache → `requests` fallback download → original URL
- **CSS url() rewriting**: `_rewrite_css_urls()` resolves URLs relative to the CSS file's location, not the page
- **Log callback**: Services accept a `log_callback` function; routes pipe it to SSE queues
- **Session state**: `app/session.py` holds shared dicts (`message_queues`, `download_results`, etc.) used across routes
- **Session cleanup**: Background thread removes abandoned sessions after 30 minutes; downloads folder is cleaned on startup

## Deployment

Uses Docker (Python 3.11-slim + Playwright Chromium). Configured for Railway (`entrypoint.sh`, port 8080) and Render (`render.yaml`). Production runs via Gunicorn (`run:app`) with `gthread` worker class, 1 worker, 2 threads, 300s timeout.

## Language

UI text and log messages are in Brazilian Portuguese.
