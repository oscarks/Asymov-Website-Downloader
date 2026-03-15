"""
AI Assistant for modifying website pages and design systems.
Builds intelligent context from site files, calls LLM, and applies changes.
"""

import os
import re
import json
import copy
import shutil
from glob import glob
from datetime import datetime

from bs4 import BeautifulSoup
from langchain_core.messages import SystemMessage, HumanMessage

from app.llm.factory import get_llm


# ─── Structure Map ────────────────────────────────────────────────────────────

def _generate_structure_map(html_content):
    """Generate a compact structural map of the HTML (tags, classes, IDs)."""
    soup = BeautifulSoup(html_content, "html.parser")
    lines = []

    def _walk(el, depth):
        if el.name is None:
            return
        # Skip non-visible elements
        if el.name in ("script", "style", "link", "meta", "noscript"):
            return

        tag = el.name
        attrs = ""
        if el.get("id"):
            attrs += f"#{el['id']}"
        if el.get("class"):
            cls = ".".join(el["class"][:3])
            attrs += f".{cls}"

        indent = "  " * depth
        children = [c for c in el.children if hasattr(c, "name") and c.name is not None]
        visible_children = [c for c in children if c.name not in ("script", "style", "link", "meta", "noscript")]

        # Check for repeated siblings of the same type
        line = f"{indent}{tag}{attrs}"

        # Add text hint for leaf nodes
        if not visible_children:
            text = el.get_text(strip=True)[:50]
            if text:
                line += f'  "{text}"'

        lines.append(line)

        for child in visible_children:
            _walk(child, depth + 1)

    body = soup.find("body")
    if body:
        _walk(body, 0)
    else:
        for child in soup.children:
            if hasattr(child, "name") and child.name:
                _walk(child, 0)

    return "\n".join(lines)


# ─── CSS Variables Extraction ─────────────────────────────────────────────────

def _extract_css_variables(css_content):
    """Extract CSS custom properties (--var: value) from CSS content."""
    variables = {}
    # Match :root or * blocks with custom properties
    pattern = re.compile(r'--([a-zA-Z0-9_-]+)\s*:\s*([^;]+);')
    for match in pattern.finditer(css_content):
        var_name = f"--{match.group(1)}"
        var_value = match.group(2).strip()
        variables[var_name] = var_value
    return variables


# ─── Context Builder ──────────────────────────────────────────────────────────

def build_context(site_folder, target_file="index.html"):
    """
    Build LLM context from site files.
    Returns dict with css_files, css_variables, html_map, html_full, file_list.
    """
    context = {
        "css_files": {},
        "css_variables": {},
        "html_map": "",
        "html_full": "",
        "file_list": [],
        "target_file": target_file,
    }

    # File inventory
    for root, dirs, files in os.walk(site_folder):
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for f in files:
            fpath = os.path.join(root, f)
            rel = os.path.relpath(fpath, site_folder)
            size = os.path.getsize(fpath)
            context["file_list"].append({"path": rel, "size": size})

    # CSS files
    css_patterns = [
        os.path.join(site_folder, "assets", "*.css"),
        os.path.join(site_folder, "**", "*.css"),
    ]
    seen_css = set()
    for pattern in css_patterns:
        for css_path in sorted(glob(pattern, recursive=True)):
            rel = os.path.relpath(css_path, site_folder)
            if rel in seen_css:
                continue
            seen_css.add(rel)
            try:
                with open(css_path, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()
                context["css_files"][rel] = content
                context["css_variables"].update(_extract_css_variables(content))
            except OSError:
                pass

    # HTML
    html_path = os.path.join(site_folder, target_file)
    if os.path.isfile(html_path):
        with open(html_path, "r", encoding="utf-8", errors="ignore") as f:
            html_content = f.read()
        context["html_full"] = html_content
        context["html_map"] = _generate_structure_map(html_content)

    return context


# ─── System Prompt ────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """Você é um assistente de design web especializado em analisar e modificar páginas HTML e CSS.
O usuário pode pedir modificações visuais ou fazer perguntas sobre os estilos e estrutura da página.
Você recebe os arquivos CSS e a estrutura HTML da página como contexto.

REGRAS:
1. Responda SEMPRE em JSON no formato especificado abaixo.
2. O campo "explanation" é a sua resposta principal ao usuário. IMPORTANTE: use markdown para formatar o texto — use \\n para quebras de linha, ## para títulos, - para listas, **negrito** para destaques, e `código` para seletores CSS e valores.
3. Quando o pedido é uma PERGUNTA ou CONSULTA (listar estilos, descrever cores, explicar estrutura), responda com explanation detalhado e modifications vazio.
4. Quando o pedido é uma MODIFICAÇÃO, prefira alterar CSS em vez de HTML. Altere HTML apenas se estritamente necessário.
5. Para mudanças de cor e tipografia, priorize variáveis CSS (custom properties como --primary-color) quando existirem.
6. Use operações search/replace precisas — o texto de busca deve ser exato e único no arquivo.
7. Preserve a estrutura e formatação existente dos arquivos.
8. Ao alterar cores, use o formato hex (#rrggbb) ou rgb() conforme o original.
9. Se precisar alterar múltiplas ocorrências do mesmo valor, use "replace_all": true.

FORMATO DE RESPOSTA (JSON estrito):
{
  "explanation": "## Título\\n\\nTexto com **negrito** e `código`.\\n\\n- Item 1\\n- Item 2\\n\\n1. Passo 1\\n2. Passo 2",
  "modifications": [
    {
      "file": "caminho/relativo/do/arquivo",
      "changes": [
        {
          "search": "texto exato a buscar no arquivo",
          "replace": "texto substituto",
          "replace_all": false
        }
      ]
    }
  ]
}

Se o pedido é uma consulta ou não há modificações a fazer:
{
  "explanation": "## Resposta\\n\\nSua resposta completa e detalhada com markdown aqui.",
  "modifications": []
}"""


# ─── Prompt Composer ──────────────────────────────────────────────────────────

def compose_messages(context, user_prompt, history=None):
    """Compose LangChain messages for the LLM call."""
    messages = [SystemMessage(content=SYSTEM_PROMPT)]

    # Add conversation history
    if history:
        for entry in history[-10:]:  # Last 10 exchanges max
            if entry["role"] == "user":
                messages.append(HumanMessage(content=entry["content"]))
            else:
                messages.append(SystemMessage(content=f"Sua resposta anterior: {entry['content']}"))

    # Build user message with context
    parts = []

    parts.append(f"ARQUIVO ALVO: {context['target_file']}")

    # CSS variables
    if context["css_variables"]:
        var_lines = [f"  {k}: {v}" for k, v in context["css_variables"].items()]
        parts.append("VARIÁVEIS CSS:\n" + "\n".join(var_lines))

    # CSS files
    for rel_path, content in context["css_files"].items():
        parts.append(f"=== {rel_path} ===\n{content}")

    # HTML structure map
    if context["html_map"]:
        parts.append(f"ESTRUTURA HTML:\n{context['html_map']}")

    # Full HTML (include if not too large)
    if context["html_full"] and len(context["html_full"]) < 60000:
        parts.append(f"HTML COMPLETO:\n```html\n{context['html_full']}\n```")

    # User prompt
    parts.append(f"PEDIDO:\n{user_prompt}")

    messages.append(HumanMessage(content="\n\n".join(parts)))
    return messages


# ─── Response Parser ──────────────────────────────────────────────────────────

def parse_llm_response(text):
    """Extract JSON from LLM response text."""
    # Try to find JSON in code fences first
    fence_match = re.search(r'```(?:json)?\s*\n(.*?)```', text, re.DOTALL)
    if fence_match:
        text = fence_match.group(1).strip()

    # Try to find JSON object
    brace_start = text.find("{")
    if brace_start == -1:
        return {"explanation": text, "modifications": []}

    # Find matching closing brace
    depth = 0
    for i in range(brace_start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                json_str = text[brace_start:i + 1]
                try:
                    return json.loads(json_str)
                except json.JSONDecodeError:
                    break

    return {"explanation": text, "modifications": []}


# ─── Backup / Undo ────────────────────────────────────────────────────────────

_BACKUP_DIR_NAME = ".assistant_backups"


def _backup_dir(site_folder):
    return os.path.join(site_folder, _BACKUP_DIR_NAME)


def create_backup(site_folder, modifications):
    """Backup files that will be modified. Returns backup_id."""
    backup_base = _backup_dir(site_folder)
    backup_id = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    backup_path = os.path.join(backup_base, backup_id)
    os.makedirs(backup_path, exist_ok=True)

    manifest = []
    for mod in modifications:
        src = os.path.join(site_folder, mod["file"])
        if os.path.isfile(src):
            # Preserve directory structure in backup
            rel = mod["file"]
            dst = os.path.join(backup_path, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(src, dst)
            manifest.append(rel)

    # Save manifest
    with open(os.path.join(backup_path, "_manifest.json"), "w") as f:
        json.dump(manifest, f)

    return backup_id


def restore_backup(site_folder, backup_id):
    """Restore files from a backup."""
    backup_path = os.path.join(_backup_dir(site_folder), backup_id)
    if not os.path.isdir(backup_path):
        return False

    manifest_path = os.path.join(backup_path, "_manifest.json")
    if not os.path.isfile(manifest_path):
        return False

    with open(manifest_path, "r") as f:
        manifest = json.load(f)

    for rel in manifest:
        src = os.path.join(backup_path, rel)
        dst = os.path.join(site_folder, rel)
        if os.path.isfile(src):
            shutil.copy2(src, dst)

    # Remove the backup after restoring
    shutil.rmtree(backup_path, ignore_errors=True)
    return True


def list_backups(site_folder):
    """List available backup IDs (most recent first)."""
    backup_base = _backup_dir(site_folder)
    if not os.path.isdir(backup_base):
        return []
    backups = sorted(os.listdir(backup_base), reverse=True)
    return [b for b in backups if os.path.isdir(os.path.join(backup_base, b))]


# ─── Conversation Persistence ─────────────────────────────────────────────────

_ASSISTANT_DIR = ".assistant"
_MAX_ARCHIVED = 10
_BACKUP_MAX_AGE_HOURS = 24


def _assistant_dir(site_folder):
    return os.path.join(site_folder, _ASSISTANT_DIR)


def _conversations_dir(site_folder):
    return os.path.join(_assistant_dir(site_folder), "history")


def _current_path(site_folder):
    return os.path.join(_assistant_dir(site_folder), "current.json")


def _new_conversation(site_name, target="index.html"):
    """Create a new empty conversation dict."""
    now = datetime.now().isoformat(timespec="seconds")
    return {
        "id": datetime.now().strftime("%Y%m%d_%H%M%S"),
        "site_name": site_name,
        "target": target,
        "created_at": now,
        "updated_at": now,
        "summary": "",
        "messages": [],
    }


def load_conversation(site_folder):
    """Load the current conversation for a site. Returns None if none exists."""
    path = _current_path(site_folder)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def save_conversation(site_folder, conversation):
    """Save the current conversation to disk."""
    base = _assistant_dir(site_folder)
    os.makedirs(base, exist_ok=True)
    conversation["updated_at"] = datetime.now().isoformat(timespec="seconds")
    path = _current_path(site_folder)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(conversation, f, ensure_ascii=False, indent=2)


def archive_conversation(site_folder):
    """Archive the current conversation and return a new empty one."""
    current = load_conversation(site_folder)
    if current and current.get("messages"):
        hist_dir = _conversations_dir(site_folder)
        os.makedirs(hist_dir, exist_ok=True)
        archive_name = current.get("id", datetime.now().strftime("%Y%m%d_%H%M%S"))
        archive_path = os.path.join(hist_dir, f"{archive_name}.json")
        with open(archive_path, "w", encoding="utf-8") as f:
            json.dump(current, f, ensure_ascii=False, indent=2)
        _cleanup_old_archives(site_folder)

    # Remove current
    path = _current_path(site_folder)
    if os.path.isfile(path):
        os.remove(path)

    site_name = os.path.basename(site_folder)
    return _new_conversation(site_name)


def _cleanup_old_archives(site_folder):
    """Keep only the last N archived conversations."""
    hist_dir = _conversations_dir(site_folder)
    if not os.path.isdir(hist_dir):
        return
    files = sorted(
        [f for f in os.listdir(hist_dir) if f.endswith(".json")],
        reverse=True,
    )
    for old_file in files[_MAX_ARCHIVED:]:
        try:
            os.remove(os.path.join(hist_dir, old_file))
        except OSError:
            pass


def get_history_for_llm(conversation, max_recent=6):
    """
    Extract message history for LLM context.
    Returns summary (if any) + last N messages.
    """
    if not conversation:
        return []

    messages = conversation.get("messages", [])
    summary = conversation.get("summary", "")

    result = []
    if summary:
        result.append({
            "role": "assistant",
            "content": f"Resumo da conversa anterior: {summary}",
        })

    # Last N messages (pairs of user+assistant)
    recent = messages[-(max_recent * 2):]
    for msg in recent:
        result.append({"role": msg["role"], "content": msg["content"]})

    return result


def add_message(conversation, role, content, backup_id=None):
    """Add a message to the conversation."""
    msg = {
        "role": role,
        "content": content,
        "ts": datetime.now().isoformat(timespec="seconds"),
    }
    if backup_id:
        msg["backup_id"] = backup_id
    conversation["messages"].append(msg)
    return conversation


def cleanup_old_backups(site_folder):
    """Remove assistant backups older than 24 hours."""
    backup_base = _backup_dir(site_folder)
    if not os.path.isdir(backup_base):
        return
    now = datetime.now()
    for name in os.listdir(backup_base):
        path = os.path.join(backup_base, name)
        if not os.path.isdir(path):
            continue
        try:
            # Parse timestamp from backup_id: YYYYMMDD_HHMMSS_ffffff
            dt = datetime.strptime(name[:15], "%Y%m%d_%H%M%S")
            age_hours = (now - dt).total_seconds() / 3600
            if age_hours > _BACKUP_MAX_AGE_HOURS:
                shutil.rmtree(path, ignore_errors=True)
        except (ValueError, IndexError):
            pass


# ─── Apply Modifications ─────────────────────────────────────────────────────

def apply_modifications(site_folder, modifications):
    """
    Apply search/replace modifications to files.
    Returns list of results per file.
    """
    results = []

    for mod in modifications:
        file_rel = mod.get("file", "")
        filepath = os.path.join(site_folder, file_rel)

        # Path traversal protection
        if not os.path.abspath(filepath).startswith(os.path.abspath(site_folder)):
            results.append({"file": file_rel, "ok": False, "error": "Caminho inválido"})
            continue

        if not os.path.isfile(filepath):
            results.append({"file": file_rel, "ok": False, "error": "Arquivo não encontrado"})
            continue

        try:
            with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
        except OSError as e:
            results.append({"file": file_rel, "ok": False, "error": str(e)})
            continue

        changes_applied = 0
        changes_failed = []

        for change in mod.get("changes", []):
            search = change.get("search", "")
            replace = change.get("replace", "")
            replace_all = change.get("replace_all", False)

            if not search:
                changes_failed.append("search vazio")
                continue

            if search not in content:
                changes_failed.append(f"não encontrado: {search[:60]}...")
                continue

            if replace_all:
                content = content.replace(search, replace)
            else:
                content = content.replace(search, replace, 1)
            changes_applied += 1

        # Write back
        if changes_applied > 0:
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(content)

        results.append({
            "file": file_rel,
            "ok": changes_applied > 0,
            "applied": changes_applied,
            "failed": changes_failed,
        })

    return results


# ─── Main Assistant Call ──────────────────────────────────────────────────────

def run_assistant(
    site_folder,
    target_file,
    user_prompt,
    provider,
    model,
    api_key,
    base_url=None,
    history=None,
    log_callback=None,
):
    """
    Run the assistant: build context, call LLM, apply modifications.
    Returns dict with explanation, modifications, results, backup_id.
    """
    def log(msg):
        if log_callback:
            log_callback(msg)

    # 1. Build context
    log("Analisando arquivos do site...")
    context = build_context(site_folder, target_file)

    css_count = len(context["css_files"])
    var_count = len(context["css_variables"])
    log(f"Contexto: {css_count} CSS, {var_count} variáveis, HTML {len(context['html_full'])} chars")

    # 2. Compose messages
    messages = compose_messages(context, user_prompt, history)

    # 3. Call LLM
    log(f"Consultando {provider}/{model}...")
    try:
        llm = get_llm(provider, model, api_key, base_url)
        response = llm.invoke(messages)
        text = response.content if hasattr(response, "content") else str(response)
    except Exception as e:
        return {
            "success": False,
            "explanation": f"Erro na chamada LLM: {str(e)}",
            "modifications": [],
            "results": [],
            "backup_id": None,
        }

    # 4. Parse response
    log("Processando resposta...")
    parsed = parse_llm_response(text)
    explanation = parsed.get("explanation", "")
    modifications = parsed.get("modifications", [])

    if not modifications:
        return {
            "success": True,
            "explanation": explanation,
            "modifications": [],
            "results": [],
            "backup_id": None,
        }

    # 5. Backup
    log("Criando backup...")
    backup_id = create_backup(site_folder, modifications)

    # 6. Apply modifications
    log("Aplicando modificações...")
    results = apply_modifications(site_folder, modifications)

    applied_count = sum(1 for r in results if r.get("ok"))
    log(f"Concluído: {applied_count} arquivo(s) modificado(s)")

    return {
        "success": True,
        "explanation": explanation,
        "modifications": modifications,
        "results": results,
        "backup_id": backup_id,
    }
