import os
import re
from glob import glob
from typing import TypedDict, Callable

from langgraph.graph import StateGraph, END
from langchain_core.messages import SystemMessage, HumanMessage

from app.llm.factory import get_llm
from app.services.workspace import generate_ds_filename

# Project root directory
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))

# Load prompt template once at module level
_PROMPT_TEMPLATE_PATH = os.path.join(
    _PROJECT_ROOT, "docs", "referencias", "Prompt_Extract_Design_System.md"
)

def _load_prompt_template():
    with open(_PROMPT_TEMPLATE_PATH, "r", encoding="utf-8") as f:
        return f.read()


class ExtractionState(TypedDict, total=False):
    site_folder: str
    provider: str
    model: str
    api_key: str
    base_url: str | None
    html_content: str
    css_contents: str
    prompt: list
    llm_response: str
    output_path: str
    output_filename: str
    error: str | None
    log_callback: Callable


def _log(state, message):
    cb = state.get("log_callback")
    if cb:
        cb(message)


def load_html(state):
    _log(state, "📄 Lendo HTML do site...")
    index_path = os.path.join(state["site_folder"], "index.html")
    if not os.path.isfile(index_path):
        _log(state, "❌ Arquivo index.html não encontrado")
        return {"error": "index.html não encontrado"}
    with open(index_path, "r", encoding="utf-8", errors="ignore") as f:
        html_content = f.read()
    _log(state, f"   ✅ HTML carregado ({len(html_content)} caracteres)")
    return {"html_content": html_content}


def load_css(state):
    if state.get("error"):
        return {}
    css_files = sorted(glob(os.path.join(state["site_folder"], "assets", "*.css")))
    _log(state, f"🎨 Lendo {len(css_files)} arquivos CSS...")
    parts = []
    for css_path in css_files:
        filename = os.path.basename(css_path)
        try:
            with open(css_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
            parts.append(f"/* === assets/{filename} === */\n{content}")
        except OSError:
            pass
    css_contents = "\n\n".join(parts)
    _log(state, f"   ✅ CSS carregado ({len(css_contents)} caracteres)")
    return {"css_contents": css_contents}


def build_prompt(state):
    if state.get("error"):
        return {}
    _log(state, "🔧 Montando prompt para a LLM...")
    template = _load_prompt_template()
    system_content = template.replace(
        "`$ARGUMENTS`",
        "the HTML file content provided in the user message below"
    ).replace(
        "$ARGUMENTS",
        "the HTML file content provided in the user message below"
    )

    user_content = (
        "Here is the reference website HTML:\n\n"
        "```html\n"
        f"{state['html_content']}\n"
        "```\n\n"
        "Here are the CSS files used by the site:\n\n"
        "```css\n"
        f"{state.get('css_contents', '')}\n"
        "```\n\n"
        "Generate the design-system.html file now. Output ONLY the complete HTML code, no explanations."
    )

    messages = [
        SystemMessage(content=system_content),
        HumanMessage(content=user_content),
    ]
    return {"prompt": messages}


def call_llm(state):
    if state.get("error"):
        return {}
    provider = state["provider"]
    model = state["model"]
    _log(state, f"🤖 Chamando {provider}/{model}...")
    try:
        llm = get_llm(provider, model, state["api_key"], state.get("base_url"))
        response = llm.invoke(state["prompt"])
        text = response.content if hasattr(response, "content") else str(response)

        # Extract HTML from markdown code fences if present
        fence_match = re.search(r'```html\s*\n(.*?)```', text, re.DOTALL)
        if fence_match:
            text = fence_match.group(1).strip()
        else:
            # Try generic code fence
            fence_match = re.search(r'```\s*\n(.*?)```', text, re.DOTALL)
            if fence_match:
                text = fence_match.group(1).strip()

        _log(state, f"✅ Resposta recebida ({len(text)} caracteres)")
        return {"llm_response": text}
    except Exception as e:
        error_msg = str(e)
        _log(state, f"❌ Erro na LLM: {error_msg}")
        return {"error": error_msg}


def save_result(state):
    if state.get("error"):
        return {}
    filename = generate_ds_filename(state["provider"], state["model"])
    output_path = os.path.join(state["site_folder"], filename)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(state["llm_response"])
    _log(state, f"💾 Design System salvo: {filename}")
    return {"output_path": output_path, "output_filename": filename}


def _should_continue(state):
    """Check if pipeline should continue or stop due to error."""
    if state.get("error"):
        return END
    return "continue"


# Build the graph
def _build_graph():
    graph = StateGraph(ExtractionState)
    graph.add_node("load_html", load_html)
    graph.add_node("load_css", load_css)
    graph.add_node("build_prompt", build_prompt)
    graph.add_node("call_llm", call_llm)
    graph.add_node("save_result", save_result)

    graph.set_entry_point("load_html")
    graph.add_edge("load_html", "load_css")
    graph.add_edge("load_css", "build_prompt")
    graph.add_edge("build_prompt", "call_llm")
    graph.add_edge("call_llm", "save_result")
    graph.add_edge("save_result", END)

    return graph.compile()


_compiled_graph = _build_graph()


def extract_design_system(
    site_folder,
    provider,
    model,
    api_key,
    base_url=None,
    log_callback=print,
):
    """
    Run the extraction pipeline synchronously.
    Returns {"success": True, "output_path": "...", "filename": "..."} or
            {"success": False, "error": "..."}
    """
    initial_state = {
        "site_folder": site_folder,
        "provider": provider,
        "model": model,
        "api_key": api_key,
        "base_url": base_url,
        "log_callback": log_callback,
    }

    try:
        result = _compiled_graph.invoke(initial_state)
    except Exception as e:
        log_callback(f"❌ Erro inesperado: {e}")
        return {"success": False, "error": str(e)}

    if result.get("error"):
        return {"success": False, "error": result["error"]}

    return {
        "success": True,
        "output_path": result.get("output_path", ""),
        "filename": result.get("output_filename", ""),
    }
