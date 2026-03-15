# AI SPEC — Vibe Design Extractor

> Specification for AI-agent implementation via SDD.
> Every section is a binding contract. No inference or interpretation required.

---

## S1. System Identity

- **Name**: Vibe Design Extractor
- **Language**: Python 3.12+, HTML/CSS/JS (vanilla, no framework)
- **Package manager**: uv
- **Web framework**: Flask
- **AI framework**: LangChain + LangGraph
- **UI language**: Brazilian Portuguese (pt-BR)
- **Existing codebase**: `app.py`, `downloader.py`, `templates/index.html` — must be preserved and extended, not rewritten from scratch

---

## S2. File Map

Create or modify exactly these files:

| Action | File | Purpose |
|--------|------|---------|
| CREATE | `config.py` | Load `.env`, expose constants |
| CREATE | `workspace.py` | Workspace folder management |
| CREATE | `llm_factory.py` | LLM provider factory |
| CREATE | `extractor.py` | LangGraph pipeline for design system extraction |
| CREATE | `static/css/app.css` | Application styles |
| CREATE | `static/js/app.js` | Frontend logic |
| CREATE | `.env.example` | Template for environment variables |
| MODIFY | `app.py` | Add new API routes, keep existing download logic |
| REPLACE | `templates/index.html` | New SPA layout (replaces current single-purpose UI) |
| MODIFY | `pyproject.toml` | Add new dependencies |
| MODIFY | `Dockerfile` | Add `workspace/` dir, copy `.env` if exists |

Do NOT create, modify, or delete any other files.

---

## S3. Dependencies

Add to `pyproject.toml` `dependencies` list:

```
"langchain-core>=0.3",
"langchain-openai>=0.3",
"langchain-anthropic>=0.3",
"langchain-google-genai>=2.1",
"langgraph>=0.4",
"python-dotenv>=1.1",
```

Keep all existing dependencies unchanged.

---

## S4. Configuration — `config.py`

```python
import os
from dotenv import load_dotenv

load_dotenv()

WORKSPACE_DIR = os.getenv("WORKSPACE_DIR", "./workspace")
DOWNLOAD_FOLDER = "downloads"
DEFAULT_LLM_PROVIDER = os.getenv("DEFAULT_LLM_PROVIDER", "openai")
DEFAULT_LLM_MODEL = os.getenv("DEFAULT_LLM_MODEL", "gpt-4o")

PROVIDERS = {
    "openai": {
        "name": "OpenAI",
        "env_key": "OPENAI_API_KEY",
        "models": ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini"],
    },
    "anthropic": {
        "name": "Anthropic",
        "env_key": "ANTHROPIC_API_KEY",
        "models": ["claude-sonnet-4-20250514", "claude-opus-4-20250514", "claude-haiku-4-5-20251001"],
    },
    "google": {
        "name": "Google",
        "env_key": "GOOGLE_API_KEY",
        "models": ["gemini-2.5-pro", "gemini-2.5-flash"],
    },
    "openai-compatible": {
        "name": "OpenAI Compatible",
        "env_key": "CUSTOM_LLM_API_KEY",
        "models": [],
        "requires_base_url": True,
    },
}

CONFIG_FILE = os.path.join(WORKSPACE_DIR, ".config.json")
```

The file must also expose:
- `ensure_workspace()`: creates `WORKSPACE_DIR` if it does not exist
- `load_user_config() -> dict`: reads `CONFIG_FILE` (JSON). Returns empty dict if file missing
- `save_user_config(data: dict)`: writes JSON to `CONFIG_FILE`

User config JSON schema:
```json
{
  "default_provider": "string",
  "default_model": "string",
  "api_keys": {
    "openai": "string|null",
    "anthropic": "string|null",
    "google": "string|null",
    "openai-compatible": "string|null"
  },
  "custom_base_url": "string|null"
}
```

---

## S5. Workspace Manager — `workspace.py`

### Functions (all required):

#### `create_site_folder(url: str) -> str`
- Extract domain from URL (strip `www.`), sanitize to `[a-zA-Z0-9._-]`
- If path exists, append `_2`, `_3`, etc. (do NOT merge into existing folder)
- Create the folder inside `WORKSPACE_DIR`
- Return absolute path

#### `unzip_to_workspace(zip_path: str, url: str) -> str`
- Call `create_site_folder(url)` to get target directory
- Extract ZIP contents into that directory (flat — files at root, not nested)
- Delete the ZIP file after extraction
- Return absolute path of the created folder

#### `list_sites() -> list[dict]`
- List immediate subdirectories of `WORKSPACE_DIR`
- For each, return:
  ```json
  {
    "name": "folder_name",
    "path": "absolute_path",
    "has_index": true,
    "design_systems": ["design-system_anthropic_claude-sonnet_20260314-143022.html", ...],
    "design_system_count": 2
  }
  ```
- Sort alphabetically by name
- Skip hidden files/folders (starting with `.`)

#### `list_design_systems(site_folder: str) -> list[dict]`
- Glob `design-system_*.html` in the given folder
- For each, parse filename to extract:
  ```json
  {
    "filename": "design-system_anthropic_claude-sonnet_20260314-143022.html",
    "provider": "anthropic",
    "model": "claude-sonnet",
    "timestamp": "2026-03-14 14:30:22",
    "path": "absolute_path"
  }
  ```
- Sort by timestamp descending (newest first)

#### `generate_ds_filename(provider: str, model: str) -> str`
- Format: `design-system_{provider}_{model_sanitized}_{YYYYMMDD-HHmmss}.html`
- Sanitize model name: replace `/` and spaces with `-`, lowercase
- Use current local time

---

## S6. LLM Factory — `llm_factory.py`

### Function:

#### `get_llm(provider: str, model: str, api_key: str, base_url: str | None = None) -> BaseChatModel`

Implementation:

```python
from langchain_openai import ChatOpenAI
from langchain_anthropic import ChatAnthropic
from langchain_google_genai import ChatGoogleGenerativeAI

def get_llm(provider, model, api_key, base_url=None):
    if provider == "openai":
        return ChatOpenAI(model=model, api_key=api_key, temperature=0.2)
    elif provider == "anthropic":
        return ChatAnthropic(model=model, api_key=api_key, temperature=0.2, max_tokens=16000)
    elif provider == "google":
        return ChatGoogleGenerativeAI(model=model, google_api_key=api_key, temperature=0.2)
    elif provider == "openai-compatible":
        return ChatOpenAI(model=model, api_key=api_key, base_url=base_url, temperature=0.2)
    else:
        raise ValueError(f"Provider desconhecido: {provider}")
```

#### `test_connection(provider: str, model: str, api_key: str, base_url: str | None = None) -> dict`
- Send a minimal message ("Hi") to the LLM
- Return `{"success": True}` or `{"success": False, "error": "message"}`
- Catch all exceptions and return error message

---

## S7. Design System Extractor — `extractor.py`

### Prompt Loading

1. Read `docs/referencias/Prompt_Extract_Design_System.md` at module load time
2. This is the **system prompt template**. It contains `$ARGUMENTS` as placeholder
3. The content of `$ARGUMENTS` will be replaced with instructions to analyze the HTML provided in the user message

### LangGraph Pipeline

Define a `StateGraph` with this state schema:

```python
class ExtractionState(TypedDict):
    site_folder: str          # Input: absolute path to site folder
    provider: str             # Input: LLM provider key
    model: str                # Input: model name
    api_key: str              # Input: API key
    base_url: str | None      # Input: for openai-compatible
    html_content: str         # Populated by load_html
    css_contents: str         # Populated by load_css
    prompt: list              # Populated by build_prompt
    llm_response: str         # Populated by call_llm
    output_path: str          # Populated by save_result
    error: str | None         # Set on error
    log_callback: Callable    # Input: function to send progress messages
```

#### Nodes (5 total):

**1. `load_html`**
- Read `{site_folder}/index.html`
- If not found, set `error` and return
- Log: `"📄 Lendo HTML do site..."`

**2. `load_css`**
- Glob `{site_folder}/assets/*.css`
- Read each file, concatenate with filename headers:
  ```
  /* === assets/style_abc123.css === */
  <content>
  ```
- Log: `"🎨 Lendo {n} arquivos CSS..."`

**3. `build_prompt`**
- Load the prompt template from `docs/referencias/Prompt_Extract_Design_System.md`
- Replace `$ARGUMENTS` with: `"the HTML file content provided in the user message below"`
- Build messages list:
  - `SystemMessage`: the processed template
  - `HumanMessage`:
    ```
    Here is the reference website HTML:

    ```html
    {html_content}
    ```

    Here are the CSS files used by the site:

    ```css
    {css_contents}
    ```

    Generate the design-system.html file now. Output ONLY the complete HTML code, no explanations.
    ```
- Log: `"🔧 Montando prompt para a LLM..."`

**4. `call_llm`**
- Instantiate LLM via `get_llm(provider, model, api_key, base_url)`
- Invoke with the messages from `prompt`
- Extract the text content from the response
- If response contains markdown code fences (`` ```html ... ``` ``), extract only the content between them
- Log: `"🤖 Chamando {provider}/{model}..."`
- On success log: `"✅ Resposta recebida ({n} caracteres)"`
- On error: set `error`, log: `"❌ Erro na LLM: {error}"`

**5. `save_result`**
- Generate filename via `generate_ds_filename(provider, model)`
- Write `llm_response` to `{site_folder}/{filename}`
- Set `output_path` to the full path
- Log: `"💾 Design System salvo: {filename}"`

#### Graph edges:
```
load_html -> load_css -> build_prompt -> call_llm -> save_result
```
If any node sets `error`, skip remaining nodes and end.

### Entry point function:

```python
def extract_design_system(
    site_folder: str,
    provider: str,
    model: str,
    api_key: str,
    base_url: str | None = None,
    log_callback: Callable = print
) -> dict:
    """
    Runs the extraction pipeline synchronously.
    Returns {"success": True, "output_path": "...", "filename": "..."} or
            {"success": False, "error": "..."}
    """
```

---

## S8. Backend Routes — `app.py`

### Preserve existing functionality:
- `cleanup_downloads_folder()` on startup
- `message_queues` and `download_results` dicts
- `cleanup_abandoned_sessions()` thread
- SSE pattern with `EventSource`

### Modify existing:
- Import `config`, `workspace`, `extractor`
- Call `config.ensure_workspace()` on startup
- After successful download in `process_download()`, add step:
  ```python
  q.put("📂 Salvando no workspace...")
  site_folder = workspace.unzip_to_workspace(zip_path, url)
  q.put(f"✅ Site salvo em: {os.path.basename(site_folder)}")
  ```
  Update `download_results` to include `site_folder`
- Keep the ZIP download route functional as fallback (but primary flow now saves to workspace)

### New routes:

#### `GET /api/workspace`
- Return: `workspace.list_sites()` as JSON

#### `GET /api/workspace/<site_name>/design-systems`
- `site_name`: folder name (not path)
- Resolve to `WORKSPACE_DIR/site_name`
- Return: `workspace.list_design_systems(folder)` as JSON

#### `GET /api/workspace/<site_name>/preview`
#### `GET /api/workspace/<site_name>/preview/<path:filename>`
- Serve files from the site folder for iframe rendering
- First route serves `index.html`
- Second route serves any file (assets, images, etc.)
- Set `Content-Type` based on file extension
- Add header `X-Frame-Options: SAMEORIGIN`

#### `GET /api/workspace/<site_name>/ds/<filename>`
- Serve a specific design system HTML file for iframe rendering
- Same headers as preview

#### `POST /api/extract`
- Body: `{"site_name": "string", "provider": "string", "model": "string"}`
- Resolve API key from user config or environment
- Create session, spawn thread, return `{"session_id": "..."}`
- Thread runs `extractor.extract_design_system()` with `log_callback` piping to SSE queue
- On completion, send SSE `done` event with `{"status": "complete", "filename": "..."}`

#### `GET /api/extract/stream/<session_id>`
- Same SSE pattern as `/stream/<session_id>` but for extraction progress

#### `GET /api/config`
- Return current config (provider list, default provider/model, which keys are configured)
- **NEVER return actual API key values**. Return `{"configured": true/false}` per provider

#### `POST /api/config`
- Body: `{"provider": "string", "model": "string", "api_keys": {...}, "custom_base_url": "string|null"}`
- Save via `config.save_user_config()`
- Return `{"success": true}`

#### `GET /api/providers`
- Return `config.PROVIDERS` dict as JSON

#### `POST /api/config/test`
- Body: `{"provider": "string", "model": "string"}`
- Resolve API key from saved config
- Call `llm_factory.test_connection()`
- Return result

---

## S9. Frontend — `templates/index.html`

### Page structure (exact HTML skeleton):

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Vibe Design Extractor</title>
    <link rel="stylesheet" href="/static/css/app.css">
</head>
<body>
    <!-- TOP BAR -->
    <header id="topbar">
        <div class="topbar-left">
            <span class="logo">Vibe Design Extractor</span>
        </div>
        <nav class="topbar-actions">
            <button id="btnDownload" title="Baixar site">Baixar Site</button>
            <button id="btnExtract" title="Extrair Design System" disabled>Extrair Design System</button>
            <button id="btnConfig" title="Configurações">Configurações</button>
        </nav>
    </header>

    <!-- MAIN LAYOUT -->
    <div id="main">
        <!-- LEFT: FILE EXPLORER -->
        <aside id="sidebar">
            <div class="sidebar-header">Workspace</div>
            <div id="fileExplorer">
                <!-- Populated by JS -->
                <p class="empty-state">Nenhum site baixado ainda</p>
            </div>
        </aside>

        <!-- RIGHT: PREVIEW AREA -->
        <section id="previewArea">
            <!-- TAB BAR -->
            <div id="previewTabs">
                <button class="tab active" data-tab="original">Site Original</button>
                <button class="tab" data-tab="design-system">Design System</button>
                <div class="tab-actions">
                    <select id="dsVersionSelect" style="display:none">
                        <!-- Populated by JS -->
                    </select>
                    <button id="btnSplitView" title="Split view">Split View</button>
                </div>
            </div>

            <!-- SINGLE VIEW (default) -->
            <div id="singleView">
                <iframe id="previewFrame" sandbox="allow-same-origin allow-scripts"></iframe>
            </div>

            <!-- SPLIT VIEW (hidden by default) -->
            <div id="splitView" style="display:none">
                <iframe id="splitOriginal" sandbox="allow-same-origin allow-scripts"></iframe>
                <div class="split-divider"></div>
                <iframe id="splitDesignSystem" sandbox="allow-same-origin allow-scripts"></iframe>
            </div>

            <!-- EMPTY STATE -->
            <div id="previewEmpty">
                <p>Selecione um site no painel lateral para visualizar</p>
            </div>
        </section>
    </div>

    <!-- MODAL: DOWNLOAD -->
    <div class="modal-overlay" id="modalDownload">
        <div class="modal">
            <div class="modal-header">
                <h2>Baixar Site</h2>
                <button class="modal-close">&times;</button>
            </div>
            <div class="modal-body">
                <input type="url" id="downloadUrl" placeholder="https://exemplo.com">
                <button id="btnStartDownload">Baixar</button>
                <div class="log-container" id="downloadLog"></div>
            </div>
        </div>
    </div>

    <!-- MODAL: EXTRACT -->
    <div class="modal-overlay" id="modalExtract">
        <div class="modal">
            <div class="modal-header">
                <h2>Extrair Design System</h2>
                <button class="modal-close">&times;</button>
            </div>
            <div class="modal-body">
                <p>Site: <strong id="extractSiteName"></strong></p>
                <label>Provedor LLM</label>
                <select id="extractProvider"></select>
                <label>Modelo</label>
                <select id="extractModel"></select>
                <button id="btnStartExtract">Extrair</button>
                <div class="log-container" id="extractLog"></div>
            </div>
        </div>
    </div>

    <!-- MODAL: CONFIG -->
    <div class="modal-overlay" id="modalConfig">
        <div class="modal modal-wide">
            <div class="modal-header">
                <h2>Configurações</h2>
                <button class="modal-close">&times;</button>
            </div>
            <div class="modal-body">
                <div id="configProviders">
                    <!-- Rendered by JS: one section per provider -->
                </div>
                <div class="config-section">
                    <label>Provedor padrão</label>
                    <select id="configDefaultProvider"></select>
                    <label>Modelo padrão</label>
                    <select id="configDefaultModel"></select>
                </div>
                <button id="btnSaveConfig">Salvar</button>
            </div>
        </div>
    </div>

    <script src="/static/js/app.js"></script>
</body>
</html>
```

---

## S10. Frontend — `static/css/app.css`

### Design tokens (CSS custom properties):

```css
:root {
    --bg-primary: #0f1117;
    --bg-secondary: #1a1b23;
    --bg-tertiary: #252630;
    --bg-hover: #2a2b36;
    --text-primary: #e4e4e7;
    --text-secondary: #a1a1aa;
    --text-muted: #71717a;
    --accent: #6366f1;
    --accent-hover: #818cf8;
    --accent-subtle: rgba(99, 102, 241, 0.15);
    --success: #10b981;
    --error: #ef4444;
    --border: #2e2f3a;
    --radius: 8px;
    --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    --font-mono: "SF Mono", "Monaco", "Consolas", monospace;
}
```

### Layout rules:
- `body`: full viewport, no scroll, `display: grid`, `grid-template-rows: 48px 1fr`
- `#topbar`: height 48px, `var(--bg-secondary)`, border-bottom, flex row, items center
- `#main`: `display: grid`, `grid-template-columns: 260px 1fr`
- `#sidebar`: `var(--bg-secondary)`, border-right, overflow-y auto
- `#previewArea`: flex column, background `var(--bg-primary)`
- `#previewTabs`: height 40px, flex row, border-bottom
- `iframe`: width 100%, flex 1, border none, background white
- Split view: flex column, each iframe `flex: 1`, divider 4px `var(--border)`

### Component styles:
- Buttons: `var(--bg-tertiary)`, hover `var(--bg-hover)`, text `var(--text-primary)`, radius `var(--radius)`
- Primary buttons (download, extract): `var(--accent)` background
- Tabs: transparent default, `var(--accent-subtle)` when active, bottom border `var(--accent)` when active
- File explorer items: padding `8px 12px`, hover `var(--bg-hover)`, cursor pointer
- Selected item: `var(--accent-subtle)` background, left border `var(--accent)`
- Modals: centered overlay `rgba(0,0,0,0.6)`, modal card `var(--bg-secondary)`, max-width 480px (modal-wide: 600px)
- Inputs: `var(--bg-tertiary)`, border `var(--border)`, focus border `var(--accent)`
- Log container: `var(--bg-primary)`, monospace font, max-height 200px, overflow-y auto
- Log entries: `var(--text-secondary)`, last entry `var(--success)`
- Empty state text: centered, `var(--text-muted)`

---

## S11. Frontend — `static/js/app.js`

### State:

```javascript
const state = {
    selectedSite: null,        // { name, path, has_index, design_systems, design_system_count }
    sites: [],                 // from /api/workspace
    activeTab: "original",     // "original" | "design-system"
    splitView: false,
    providers: {},             // from /api/providers
    config: {},                // from /api/config
};
```

### Functions (all required):

#### Initialization
- `init()`: called on `DOMContentLoaded`. Load providers, config, workspace. Bind event listeners.

#### Workspace
- `loadWorkspace()`: GET `/api/workspace`, update `state.sites`, render file explorer
- `renderFileExplorer()`: render `state.sites` as list items in `#fileExplorer`. Each item shows folder name + badge with DS count
- `selectSite(siteName)`: set `state.selectedSite`, highlight in explorer, enable "Extrair" button, load preview. Call `loadDesignSystems(siteName)`
- `loadDesignSystems(siteName)`: GET `/api/workspace/{siteName}/design-systems`, populate `#dsVersionSelect`

#### Preview
- `showPreview(tab)`: set `state.activeTab`, update tab styles, load correct URL in iframe
  - `"original"`: iframe src = `/api/workspace/{siteName}/preview`
  - `"design-system"`: iframe src = `/api/workspace/{siteName}/ds/{selected_filename}`
- `toggleSplitView()`: toggle `state.splitView`, show/hide `#singleView` and `#splitView`, load both iframes
- `onDsVersionChange()`: when select changes, reload design system iframe

#### Download modal
- `openDownloadModal()`: show `#modalDownload`, focus input
- `startDownload()`: POST `/api/download` with URL, connect SSE, show logs. On done: close modal, call `loadWorkspace()`, auto-select the new site
- `addLog(containerId, message)`: append log entry to container

#### Extract modal
- `openExtractModal()`: show `#modalExtract`, set site name, populate provider/model selects from `state.providers` and `state.config`
- `onProviderChange()`: update model select options
- `startExtract()`: POST `/api/extract` with site_name, provider, model. Connect SSE for extraction progress. On done: close modal, call `loadDesignSystems()`, switch to DS tab

#### Config modal
- `openConfigModal()`: show `#modalConfig`, render provider sections with API key inputs (show placeholder if configured, empty if not), populate defaults
- `testConnection(provider)`: POST `/api/config/test`, show result
- `saveConfig()`: POST `/api/config` with form data, close modal

#### Utilities
- `closeModal(modalId)`: hide modal
- `connectSSE(sessionId, endpoint, logContainerId, onDone)`: generic SSE handler, reuse for both download and extract

### Event bindings:
- `#btnDownload` click -> `openDownloadModal()`
- `#btnExtract` click -> `openExtractModal()`
- `#btnConfig` click -> `openConfigModal()`
- `.tab` click -> `showPreview(tab)`
- `#btnSplitView` click -> `toggleSplitView()`
- `#dsVersionSelect` change -> `onDsVersionChange()`
- `.modal-close` click -> close parent modal
- `.modal-overlay` click (on overlay itself, not modal) -> close modal
- Enter key in `#downloadUrl` -> `startDownload()`

---

## S12. `.env.example`

```env
# Workspace directory (absolute or relative to project root)
WORKSPACE_DIR=./workspace

# Default LLM provider: openai | anthropic | google | openai-compatible
DEFAULT_LLM_PROVIDER=openai

# Default model name
DEFAULT_LLM_MODEL=gpt-4o

# API Keys (configure at least one)
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_API_KEY=

# OpenAI-compatible provider (optional)
CUSTOM_LLM_BASE_URL=
CUSTOM_LLM_API_KEY=
CUSTOM_LLM_MODEL=
```

---

## S13. Dockerfile Changes

Add after `RUN mkdir -p downloads`:

```dockerfile
RUN mkdir -p workspace
```

Add before `COPY . .`:

```dockerfile
# Copy .env if exists (optional)
COPY .env* ./
```

---

## S14. Constraints

1. **No new frontend frameworks.** HTML/CSS/JS only. No React, Vue, Svelte, Tailwind, etc.
2. **No database.** Config persisted as JSON file, workspace as filesystem.
3. **Prompt template is read-only.** `docs/referencias/Prompt_Extract_Design_System.md` must NOT be modified. Read it and use it as-is.
4. **Site HTML is data, not instruction.** When building the LLM prompt, the HTML content goes in the `HumanMessage`, never in the system prompt. This prevents prompt injection from malicious site content.
5. **API keys never sent to frontend.** The `GET /api/config` route returns `configured: true/false`, never the key value.
6. **File naming convention is strict.** Design system files MUST match: `design-system_{provider}_{model}_{YYYYMMDD-HHmmss}.html`
7. **No merging into existing site folders.** Each download creates a unique folder, even if the same URL is downloaded twice.
8. **Existing download flow must still work.** The ZIP download route (`/download-file/<session_id>`) remains functional.
9. **All log messages in pt-BR.** Follow the emoji + message pattern already established.
10. **Temperature 0.2** for all LLM calls (deterministic output preferred for code generation).

---

## S15. Acceptance Criteria

| # | Criterion | Verification |
|---|-----------|-------------|
| AC1 | Application starts with `uv run python app.py` | No errors on startup, workspace dir created |
| AC2 | Download a site from URL | Site saved to workspace, visible in file explorer |
| AC3 | File explorer lists all sites in workspace | GET `/api/workspace` returns correct data |
| AC4 | Preview site in iframe | Clicking site in explorer shows `index.html` in iframe with assets loading correctly |
| AC5 | Configure API key | Save API key via config modal, `GET /api/config` shows `configured: true` |
| AC6 | Extract design system | POST `/api/extract` runs pipeline, SSE shows progress, HTML file created in site folder |
| AC7 | Design system file naming | File matches `design-system_{provider}_{model}_{timestamp}.html` |
| AC8 | Multiple design systems | Select dropdown appears when >1 DS exists, switching changes preview |
| AC9 | Split view | Toggle shows both original and DS side by side (vertically stacked) |
| AC10 | Tab navigation | "Site Original" and "Design System" tabs switch preview content |
| AC11 | SSE progress for both flows | Download and extraction both stream real-time log messages |
| AC12 | Provider selection | Modal shows available providers and models, selection persists in config |
| AC13 | Error handling | LLM errors shown in log, do not crash server |
| AC14 | Dark theme | UI uses dark color scheme per S10 design tokens |

---

## S16. Implementation Order

Execute in this exact sequence:

1. `config.py`
2. `.env.example`
3. `workspace.py`
4. `llm_factory.py`
5. `extractor.py`
6. `app.py` (modifications)
7. `static/css/app.css`
8. `static/js/app.js`
9. `templates/index.html`
10. `pyproject.toml` (add dependencies)
11. `Dockerfile` (minor update)

---

## S17. Out of Scope

- OAuth authentication for LLM providers
- User authentication/login
- Multi-user support
- Token estimation or cost preview
- Streaming LLM responses (use batch invoke)
- Mobile-responsive layout
- Internationalization (pt-BR only)
- Tests (to be added in a separate spec)
