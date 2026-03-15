/* ─── State ────────────────────────────────────────────────────────────────── */

const state = {
    selectedSite: null,
    sites: [],
    activeTab: "original",
    splitView: false,
    providers: {},
    config: {},
    editorActive: false,
    editorUndoCount: 0,
    assistantOpen: false,
    assistantLoadedSite: null,
    assistantBackups: [],  // stack of { backup_id, site_name }
};

/* ─── Init ─────────────────────────────────────────────────────────────────── */

document.addEventListener("DOMContentLoaded", init);

function init() {
    loadProviders();
    loadConfig();
    loadWorkspace();
    bindEvents();
}

function bindEvents() {
    document.getElementById("btnDownload").addEventListener("click", openDownloadModal);
    document.getElementById("btnExtract").addEventListener("click", openExtractModal);
    document.getElementById("btnConfig").addEventListener("click", openConfigModal);
    document.getElementById("btnSplitView").addEventListener("click", toggleSplitView);
    document.getElementById("dsVersionSelect").addEventListener("change", onDsVersionChange);

    // Editor toolbar
    document.getElementById("btnEditorRemove").addEventListener("click", editorRemove);
    document.getElementById("btnEditorUndo").addEventListener("click", editorUndo);
    document.getElementById("btnEditorSave").addEventListener("click", editorSave);
    document.getElementById("btnEditorCancel").addEventListener("click", editorCancel);
    document.getElementById("btnEditorParent").addEventListener("click", editorNavigateParent);
    document.getElementById("btnEditorChild").addEventListener("click", editorNavigateChild);
    document.getElementById("btnToggleDomTree").addEventListener("click", toggleDomTreePanel);

    // Color picker inputs
    document.getElementById("editorColorText").addEventListener("input", onColorTextChange);
    document.getElementById("editorColorBg").addEventListener("input", onColorBgChange);

    // DOM tree panel resizer
    initDomTreeResizer();

    // Listen for messages from editor iframe
    window.addEventListener("message", onEditorMessage);

    // Keyboard shortcuts for editor navigation
    document.addEventListener("keydown", onEditorKeydown);

    // Tabs
    document.querySelectorAll(".tab").forEach(tab => {
        tab.addEventListener("click", () => showPreview(tab.dataset.tab));
    });

    // Modal close buttons
    document.querySelectorAll(".modal-close").forEach(btn => {
        btn.addEventListener("click", () => {
            const overlay = btn.closest(".modal-overlay");
            if (overlay) closeModal(overlay.id);
        });
    });

    // Close modal on overlay click
    document.querySelectorAll(".modal-overlay").forEach(overlay => {
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) closeModal(overlay.id);
        });
    });

    // Download modal actions
    document.getElementById("btnStartDownload").addEventListener("click", startDownload);
    document.getElementById("downloadUrl").addEventListener("keypress", (e) => {
        if (e.key === "Enter") startDownload();
    });

    // Extract modal actions
    document.getElementById("btnStartExtract").addEventListener("click", startExtract);
    document.getElementById("extractProvider").addEventListener("change", onProviderChange);

    // Config modal actions
    document.getElementById("btnSaveConfig").addEventListener("click", saveConfig);

    // Assistant
    document.getElementById("btnAssistant").addEventListener("click", toggleAssistant);
    document.getElementById("btnAssistantClose").addEventListener("click", toggleAssistant);
    document.getElementById("btnAssistantNew").addEventListener("click", newAssistantConversation);
    document.getElementById("btnAssistantSend").addEventListener("click", sendAssistantMessage);
    document.getElementById("assistantInput").addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendAssistantMessage();
        }
    });
}

/* ─── API Helpers ──────────────────────────────────────────────────────────── */

async function api(url, options = {}) {
    const resp = await fetch(url, options);
    return resp.json();
}

async function apiPost(url, body) {
    return api(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

/* ─── Providers & Config ───────────────────────────────────────────────────── */

async function loadProviders() {
    state.providers = await api("/api/providers");
}

async function loadConfig() {
    state.config = await api("/api/config");
}

/* ─── Workspace ────────────────────────────────────────────────────────────── */

async function loadWorkspace() {
    state.sites = await api("/api/workspace");
    renderFileExplorer();
}

function renderFileExplorer() {
    const el = document.getElementById("fileExplorer");

    if (state.sites.length === 0) {
        el.innerHTML = '<p class="empty-state">Nenhum site baixado ainda.<br>Clique em "Baixar Site" para começar.</p>';
        return;
    }

    el.innerHTML = state.sites.map(site => {
        const selected = state.selectedSite && state.selectedSite.name === site.name ? " selected" : "";
        const badge = site.design_system_count > 0
            ? `<span class="site-item-badge">${site.design_system_count}</span>`
            : "";
        return `<div class="site-item${selected}" data-name="${site.name}">
            <span class="site-item-name">${site.name}</span>
            ${badge}
        </div>`;
    }).join("");

    el.querySelectorAll(".site-item").forEach(item => {
        item.addEventListener("click", () => selectSite(item.dataset.name));
    });
}

function selectSite(siteName) {
    const site = state.sites.find(s => s.name === siteName);
    if (!site) return;

    state.selectedSite = site;
    document.getElementById("btnExtract").disabled = false;
    document.getElementById("btnAssistant").disabled = false;
    // Reset assistant for new site
    state.assistantLoadedSite = null;
    updateAssistantTargets();

    renderFileExplorer();
    loadDesignSystems(siteName);

    // Show preview area, hide empty state
    document.getElementById("previewEmpty").style.display = "none";
    document.getElementById("previewTabs").style.display = "flex";

    // Reset to original tab when switching sites
    if (state.activeTab === "editor") {
        state.activeTab = "original";
    }

    showPreview(state.activeTab);
}

async function loadDesignSystems(siteName) {
    const ds = await api(`/api/workspace/${siteName}/design-systems`);
    const select = document.getElementById("dsVersionSelect");

    if (ds.length > 0) {
        select.style.display = "inline-block";
        select.innerHTML = ds.map(d =>
            `<option value="${d.filename}">${d.provider}/${d.model} — ${d.timestamp}</option>`
        ).join("");
    } else {
        select.style.display = "none";
        select.innerHTML = "";
    }

    // Update site in state
    if (state.selectedSite && state.selectedSite.name === siteName) {
        state.selectedSite.design_systems = ds.map(d => d.filename);
        state.selectedSite.design_system_count = ds.length;
    }
}

/* ─── Preview ──────────────────────────────────────────────────────────────── */

function showPreview(tab) {
    state.activeTab = tab;

    // Update tab styles
    document.querySelectorAll(".tab").forEach(t => {
        t.classList.toggle("active", t.dataset.tab === tab);
    });

    // Toggle editor toolbar
    const editorToolbar = document.getElementById("editorToolbar");
    const editorView = document.getElementById("editorView");

    if (tab === "editor") {
        editorToolbar.style.display = "flex";
        editorView.style.display = "flex";
        document.getElementById("singleView").style.display = "none";
        document.getElementById("splitView").style.display = "none";
        if (state.selectedSite) activateEditor();
        return;
    }

    // Hide editor when switching away
    editorToolbar.style.display = "none";
    editorView.style.display = "none";
    state.editorActive = false;

    if (!state.selectedSite) return;
    const siteName = state.selectedSite.name;

    if (state.splitView) {
        document.getElementById("singleView").style.display = "none";
        document.getElementById("splitView").style.display = "flex";
        const origFrame = document.getElementById("splitOriginal");
        const dsFrame = document.getElementById("splitDesignSystem");
        origFrame.src = `/api/workspace/${siteName}/preview`;
        loadDsIntoFrame(dsFrame);
    } else {
        document.getElementById("singleView").style.display = "flex";
        document.getElementById("splitView").style.display = "none";
        const frame = document.getElementById("previewFrame");
        if (tab === "original") {
            frame.src = `/api/workspace/${siteName}/preview`;
        } else {
            loadDsIntoFrame(frame);
        }
    }
}

function loadDsIntoFrame(frame) {
    if (!state.selectedSite) return;
    const siteName = state.selectedSite.name;
    const select = document.getElementById("dsVersionSelect");
    const filename = select.value;

    if (filename) {
        frame.src = `/api/workspace/${siteName}/ds/${filename}`;
    } else {
        frame.srcdoc = `<html><body style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:#666;"><p>Nenhum Design System gerado ainda.<br>Clique em "Extrair Design System" para gerar.</p></body></html>`;
    }
}

function toggleSplitView() {
    state.splitView = !state.splitView;

    const btn = document.getElementById("btnSplitView");
    btn.classList.toggle("active", state.splitView);

    document.getElementById("singleView").style.display = state.splitView ? "none" : "flex";
    document.getElementById("splitView").style.display = state.splitView ? "flex" : "none";

    if (state.selectedSite) {
        showPreview(state.activeTab);
    }
}

function onDsVersionChange() {
    if (state.splitView) {
        const dsFrame = document.getElementById("splitDesignSystem");
        loadDsIntoFrame(dsFrame);
    } else if (state.activeTab === "design-system") {
        const frame = document.getElementById("previewFrame");
        loadDsIntoFrame(frame);
    }
}

/* ─── Editor ───────────────────────────────────────────────────────────────── */

function activateEditor() {
    if (!state.selectedSite) return;

    state.editorActive = true;
    state.editorUndoCount = 0;
    state.editorSelectedPath = null;
    updateEditorToolbar(null);

    // Clear DOM tree
    document.getElementById("domTreeContent").innerHTML =
        '<p class="empty-state" style="padding:12px;font-size:12px;">Carregando...</p>';

    const frame = document.getElementById("editorFrame");
    frame.src = `/api/workspace/${state.selectedSite.name}/preview`;

    frame.onload = function () {
        try {
            const doc = frame.contentDocument || frame.contentWindow.document;
            const script = doc.createElement("script");
            script.src = "/static/js/editor-inject.js";
            doc.body.appendChild(script);
        } catch (e) {
            console.error("Failed to inject editor script:", e);
        }
    };
}

function sendEditorCommand(command, data) {
    const frame = document.getElementById("editorFrame");
    if (frame && frame.contentWindow) {
        frame.contentWindow.postMessage({ source: "editor-parent", command, ...data }, "*");
    }
}

function onEditorMessage(e) {
    if (!e.data || e.data.source !== "editor-inject") return;

    switch (e.data.type) {
        case "ready":
            break;
        case "dom-tree":
            renderDomTree(e.data.tree);
            break;
        case "select":
            state.editorSelectedPath = e.data.path;
            updateEditorToolbar(e.data);
            updateColorPanel(e.data.colors);
            highlightTreeNode(e.data.path);
            break;
        case "color-changed":
            state.editorUndoCount = e.data.undoCount;
            updateColorPanel(e.data.colors);
            document.getElementById("btnEditorUndo").disabled = state.editorUndoCount === 0;
            break;
        case "removed":
            state.editorUndoCount = e.data.undoCount;
            state.editorSelectedPath = null;
            updateEditorToolbar(null);
            updateColorPanel(null);
            break;
        case "undone":
            state.editorUndoCount = e.data.undoCount;
            // The iframe will also send a 'select' for the restored element
            break;
        case "deselected":
            state.editorSelectedPath = null;
            updateEditorToolbar(null);
            updateColorPanel(null);
            clearTreeSelection();
            break;
        case "html":
            saveEditorHTML(e.data.html);
            break;
        case "error":
            console.warn("Editor:", e.data.message);
            break;
    }
}

function updateEditorToolbar(selectionData) {
    const breadcrumb = document.getElementById("editorBreadcrumb");
    const removeBtn = document.getElementById("btnEditorRemove");
    const undoBtn = document.getElementById("btnEditorUndo");
    const parentBtn = document.getElementById("btnEditorParent");
    const childBtn = document.getElementById("btnEditorChild");

    if (selectionData) {
        breadcrumb.textContent = selectionData.breadcrumb;
        breadcrumb.classList.add("has-selection");
        removeBtn.disabled = false;
        parentBtn.disabled = !selectionData.hasParent;
        childBtn.disabled = !selectionData.hasChildren;
    } else {
        breadcrumb.textContent = "Clique em um elemento para selecionar";
        breadcrumb.classList.remove("has-selection");
        removeBtn.disabled = true;
        parentBtn.disabled = true;
        childBtn.disabled = true;
    }

    undoBtn.disabled = state.editorUndoCount === 0;
}

function editorRemove() {
    sendEditorCommand("remove");
}

function editorUndo() {
    sendEditorCommand("undo");
}

function editorNavigateParent() {
    sendEditorCommand("navigate-parent");
}

function editorNavigateChild() {
    sendEditorCommand("navigate-child");
}

function onEditorKeydown(e) {
    if (!state.editorActive) return;
    // Only handle if no input/textarea is focused
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;

    if (e.key === "ArrowUp" && (e.altKey || e.metaKey)) {
        e.preventDefault();
        editorNavigateParent();
    } else if (e.key === "ArrowDown" && (e.altKey || e.metaKey)) {
        e.preventDefault();
        editorNavigateChild();
    } else if (e.key === "Delete" || e.key === "Backspace") {
        if (state.editorSelectedPath) {
            e.preventDefault();
            editorRemove();
        }
    } else if (e.key === "z" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        editorUndo();
    }
}

function editorSave() {
    document.getElementById("btnEditorSave").disabled = true;
    document.getElementById("btnEditorSave").textContent = "Salvando...";
    sendEditorCommand("get-html");
}

async function saveEditorHTML(html) {
    if (!state.selectedSite) return;

    try {
        const result = await apiPost(`/api/workspace/${state.selectedSite.name}/save`, {
            filename: "index.html",
            content: html,
        });

        const saveBtn = document.getElementById("btnEditorSave");
        if (result.success) {
            saveBtn.textContent = "Salvo!";
            saveBtn.style.background = "var(--success)";
            saveBtn.style.borderColor = "var(--success)";
        } else {
            saveBtn.textContent = "Erro ao salvar";
            saveBtn.style.background = "var(--error)";
            saveBtn.style.borderColor = "var(--error)";
        }
        setTimeout(() => {
            saveBtn.textContent = "Salvar";
            saveBtn.style.background = "";
            saveBtn.style.borderColor = "";
            saveBtn.disabled = false;
        }, 2000);
    } catch (err) {
        console.error("Save error:", err);
        const saveBtn = document.getElementById("btnEditorSave");
        saveBtn.textContent = "Salvar";
        saveBtn.disabled = false;
    }
}

function editorCancel() {
    if (state.selectedSite) {
        activateEditor(); // Reloads everything fresh
    }
}

/* ─── Color Panel ──────────────────────────────────────────────────────────── */

function rgbToHex(rgb) {
    if (!rgb) return "#000000";
    // Already hex
    if (rgb.startsWith("#")) {
        if (rgb.length === 4) {
            return "#" + rgb[1] + rgb[1] + rgb[2] + rgb[2] + rgb[3] + rgb[3];
        }
        return rgb.substring(0, 7);
    }
    // Parse rgb/rgba
    const match = rgb.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (!match) return "#000000";
    const r = parseInt(match[1]).toString(16).padStart(2, "0");
    const g = parseInt(match[2]).toString(16).padStart(2, "0");
    const b = parseInt(match[3]).toString(16).padStart(2, "0");
    return "#" + r + g + b;
}

function isTransparent(colorValue) {
    if (!colorValue) return true;
    const v = colorValue.trim().toLowerCase();
    if (v === "transparent") return true;
    const match = v.match(/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)/);
    return match && parseFloat(match[1]) === 0;
}

function sourceLabel(source) {
    if (source === "css") return "CSS";
    if (source === "inline") return "inline";
    return "";
}

function updateColorPanel(colors) {
    const panel = document.getElementById("editorColorPanel");

    if (!colors) {
        panel.style.display = "none";
        return;
    }

    panel.style.display = "flex";

    const textInput = document.getElementById("editorColorText");
    const bgInput = document.getElementById("editorColorBg");
    const textSource = document.getElementById("editorColorTextSource");
    const bgSource = document.getElementById("editorColorBgSource");

    // Text color
    textInput.value = rgbToHex(colors.color.value);
    textSource.textContent = sourceLabel(colors.color.source);
    textSource.className = "color-source" + (colors.color.source === "css" ? " source-css" : colors.color.source === "inline" ? " source-inline" : "");

    // Background color
    if (isTransparent(colors.backgroundColor.value)) {
        bgInput.value = "#ffffff";
    } else {
        bgInput.value = rgbToHex(colors.backgroundColor.value);
    }
    bgSource.textContent = sourceLabel(colors.backgroundColor.source);
    bgSource.className = "color-source" + (colors.backgroundColor.source === "css" ? " source-css" : colors.backgroundColor.source === "inline" ? " source-inline" : "");
}

function onColorTextChange(e) {
    sendEditorCommand("change-color", { property: "color", value: e.target.value });
}

function onColorBgChange(e) {
    sendEditorCommand("change-color", { property: "background-color", value: e.target.value });
}

/* ─── DOM Tree ─────────────────────────────────────────────────────────────── */

function renderDomTree(tree) {
    const container = document.getElementById("domTreeContent");
    container.innerHTML = "";
    if (!tree) return;
    const el = createTreeNodeEl(tree, 0);
    container.appendChild(el);
    // Auto-expand the root (body)
    el.classList.add("expanded");
}

function createTreeNodeEl(node, depth) {
    const wrapper = document.createElement("div");
    wrapper.className = "dom-node";
    wrapper.dataset.path = JSON.stringify(node.path);

    const row = document.createElement("div");
    row.className = "dom-node-row";
    row.style.paddingLeft = (depth * 14 + 4) + "px";

    // Toggle arrow
    const toggle = document.createElement("span");
    toggle.className = "dom-node-toggle" + (node.childCount === 0 ? " empty" : "");
    toggle.textContent = "\u25B6"; // ▶
    toggle.addEventListener("click", function (e) {
        e.stopPropagation();
        toggleTreeNode(wrapper);
    });
    row.appendChild(toggle);

    // Label
    const label = document.createElement("span");
    label.innerHTML = buildNodeLabel(node);
    row.appendChild(label);

    // Click to select in iframe
    row.addEventListener("click", function () {
        sendEditorCommand("select-by-path", { path: node.path });
    });

    wrapper.appendChild(row);

    // Children container
    if (node.children && node.children.length > 0) {
        const childContainer = document.createElement("div");
        childContainer.className = "dom-node-children";
        for (const child of node.children) {
            childContainer.appendChild(createTreeNodeEl(child, depth + 1));
        }
        wrapper.appendChild(childContainer);
    }

    return wrapper;
}

function buildNodeLabel(node) {
    let html = '<span class="dom-node-tag">' + escapeHtml(node.tag) + '</span>';
    if (node.id) {
        html += '<span class="dom-node-id">#' + escapeHtml(node.id) + '</span>';
    }
    if (node.classes && node.classes.length > 0) {
        html += '<span class="dom-node-class">.' + node.classes.map(escapeHtml).join('.') + '</span>';
    }
    if (node.text) {
        html += '<span class="dom-node-text">"' + escapeHtml(node.text) + '"</span>';
    }
    return html;
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

function toggleTreeNode(wrapper) {
    wrapper.classList.toggle("expanded");
    const toggle = wrapper.querySelector(":scope > .dom-node-row > .dom-node-toggle");
    if (toggle && !toggle.classList.contains("empty")) {
        toggle.textContent = wrapper.classList.contains("expanded") ? "\u25BC" : "\u25B6"; // ▼ or ▶
    }
}

function highlightTreeNode(path) {
    clearTreeSelection();
    if (!path) return;

    const container = document.getElementById("domTreeContent");
    const pathStr = JSON.stringify(path);

    // Expand all ancestors
    for (let i = 1; i <= path.length; i++) {
        const ancestorPath = JSON.stringify(path.slice(0, i));
        const ancestorNode = container.querySelector(`.dom-node[data-path='${ancestorPath}']`);
        if (ancestorNode) {
            // Expand ancestor if not expanded
            if (!ancestorNode.classList.contains("expanded")) {
                ancestorNode.classList.add("expanded");
                const toggle = ancestorNode.querySelector(":scope > .dom-node-row > .dom-node-toggle");
                if (toggle && !toggle.classList.contains("empty")) {
                    toggle.textContent = "\u25BC";
                }
            }
        }
    }

    // Find and highlight the target node
    const targetNode = container.querySelector(`.dom-node[data-path='${pathStr}']`);
    if (targetNode) {
        const row = targetNode.querySelector(":scope > .dom-node-row");
        if (row) {
            row.classList.add("selected");
            row.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
    }
}

function clearTreeSelection() {
    document.querySelectorAll("#domTreeContent .dom-node-row.selected").forEach(el => {
        el.classList.remove("selected");
    });
}

function toggleDomTreePanel() {
    const panel = document.getElementById("domTreePanel");
    const btn = document.getElementById("btnToggleDomTree");
    const resizer = document.getElementById("domTreeResizer");

    panel.classList.toggle("collapsed");
    const collapsed = panel.classList.contains("collapsed");
    btn.innerHTML = collapsed ? "&#9654;" : "&#9664;"; // ► or ◄
    btn.title = collapsed ? "Expandir painel" : "Recolher painel";
    resizer.style.display = collapsed ? "none" : "block";
}

function initDomTreeResizer() {
    const resizer = document.getElementById("domTreeResizer");
    const panel = document.getElementById("domTreePanel");
    let startX, startWidth;

    resizer.addEventListener("mousedown", function (e) {
        e.preventDefault();
        startX = e.clientX;
        startWidth = panel.offsetWidth;
        resizer.classList.add("dragging");
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
    });

    function onMouseMove(e) {
        const delta = e.clientX - startX;
        const newWidth = Math.max(180, Math.min(500, startWidth + delta));
        panel.style.width = newWidth + "px";
    }

    function onMouseUp() {
        resizer.classList.remove("dragging");
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
    }
}

/* ─── Download Modal ───────────────────────────────────────────────────────── */

function openDownloadModal() {
    document.getElementById("downloadUrl").value = "";
    document.getElementById("downloadLog").classList.remove("active");
    document.getElementById("downloadLog").innerHTML = "";
    document.getElementById("btnStartDownload").disabled = false;
    openModal("modalDownload");
    setTimeout(() => document.getElementById("downloadUrl").focus(), 100);
}

function startDownload() {
    const url = document.getElementById("downloadUrl").value.trim();
    if (!url) return;

    const btn = document.getElementById("btnStartDownload");
    btn.disabled = true;
    btn.textContent = "Baixando...";

    const logEl = document.getElementById("downloadLog");
    logEl.innerHTML = "";
    logEl.classList.add("active");

    apiPost("/api/download", { url }).then(data => {
        if (data.error) {
            addLog("downloadLog", "❌ " + data.error);
            btn.disabled = false;
            btn.textContent = "Baixar";
            return;
        }
        connectSSE(data.session_id, "/api/download/stream/", "downloadLog", (eventData) => {
            btn.textContent = "Baixar";
            btn.disabled = false;
            // Parse site_name from done event: "complete|site_name"
            const parts = eventData.split("|");
            if (parts[0] === "complete") {
                loadWorkspace().then(() => {
                    if (parts[1]) selectSite(parts[1]);
                });
                setTimeout(() => closeModal("modalDownload"), 1500);
            }
        });
    }).catch(err => {
        addLog("downloadLog", "❌ Erro de conexão: " + err.message);
        btn.disabled = false;
        btn.textContent = "Baixar";
    });
}

/* ─── Extract Modal ────────────────────────────────────────────────────────── */

function openExtractModal() {
    if (!state.selectedSite) return;

    document.getElementById("extractSiteName").textContent = state.selectedSite.name;
    document.getElementById("extractLog").classList.remove("active");
    document.getElementById("extractLog").innerHTML = "";
    document.getElementById("btnStartExtract").disabled = false;

    // Populate provider select
    const provSelect = document.getElementById("extractProvider");
    provSelect.innerHTML = Object.entries(state.providers).map(([key, info]) =>
        `<option value="${key}"${key === state.config.default_provider ? " selected" : ""}>${info.name}</option>`
    ).join("");

    onProviderChange();
    openModal("modalExtract");
}

function onProviderChange() {
    const provider = document.getElementById("extractProvider").value;
    const modelSelect = document.getElementById("extractModel");
    const providerInfo = state.providers[provider];

    if (!providerInfo) return;

    const models = providerInfo.models || [];
    if (models.length === 0) {
        modelSelect.innerHTML = '<option value="">Insira o modelo na configuração</option>';
        return;
    }

    const defaultModel = state.config.default_model || "";
    modelSelect.innerHTML = models.map(m =>
        `<option value="${m}"${m === defaultModel ? " selected" : ""}>${m}</option>`
    ).join("");
}

function startExtract() {
    if (!state.selectedSite) return;

    const provider = document.getElementById("extractProvider").value;
    const model = document.getElementById("extractModel").value;

    if (!provider || !model) return;

    const btn = document.getElementById("btnStartExtract");
    btn.disabled = true;
    btn.textContent = "Extraindo...";

    const logEl = document.getElementById("extractLog");
    logEl.innerHTML = "";
    logEl.classList.add("active");

    apiPost("/api/extract", {
        site_name: state.selectedSite.name,
        provider,
        model,
    }).then(data => {
        if (data.error) {
            addLog("extractLog", "❌ " + data.error);
            btn.disabled = false;
            btn.textContent = "Extrair";
            return;
        }
        connectSSE(data.session_id, "/api/extract/stream/", "extractLog", (eventData) => {
            btn.textContent = "Extrair";
            btn.disabled = false;
            const parts = eventData.split("|");
            if (parts[0] === "complete") {
                loadDesignSystems(state.selectedSite.name).then(() => {
                    loadWorkspace();
                    showPreview("design-system");
                });
                setTimeout(() => closeModal("modalExtract"), 1500);
            }
        });
    }).catch(err => {
        addLog("extractLog", "❌ Erro de conexão: " + err.message);
        btn.disabled = false;
        btn.textContent = "Extrair";
    });
}

/* ─── Config Modal ─────────────────────────────────────────────────────────── */

function openConfigModal() {
    loadConfig().then(() => {
        renderConfigProviders();
        openModal("modalConfig");
    });
}

function renderConfigProviders() {
    const container = document.getElementById("configProviders");
    const configured = state.config.configured || {};

    container.innerHTML = Object.entries(state.providers).map(([key, info]) => {
        const isConfigured = configured[key] || false;
        const statusClass = isConfigured ? "ok" : "missing";
        const statusText = isConfigured ? "Configurada" : "Não configurada";
        const extraFields = info.requires_base_url
            ? `<label>Base URL</label>
               <input type="text" class="config-base-url" data-provider="${key}" placeholder="https://api.example.com/v1" value="${state.config.custom_base_url || ""}">`
            : "";

        return `<div class="config-section">
            <h3>${info.name}</h3>
            <div class="config-row">
                <input type="password" class="config-api-key" data-provider="${key}" placeholder="API Key">
                <span class="config-status ${statusClass}">${statusText}</span>
            </div>
            ${extraFields}
            <button class="btn-secondary btn-test-connection" data-provider="${key}">Testar conexão</button>
        </div>`;
    }).join("");

    // Default provider/model selects
    const defProvSelect = document.getElementById("configDefaultProvider");
    defProvSelect.innerHTML = Object.entries(state.providers).map(([key, info]) =>
        `<option value="${key}"${key === state.config.default_provider ? " selected" : ""}>${info.name}</option>`
    ).join("");

    defProvSelect.addEventListener("change", () => {
        const prov = defProvSelect.value;
        const defModelSelect = document.getElementById("configDefaultModel");
        const models = (state.providers[prov] || {}).models || [];
        defModelSelect.innerHTML = models.map(m => `<option value="${m}">${m}</option>`).join("");
    });
    defProvSelect.dispatchEvent(new Event("change"));

    // Set default model
    const defModelSelect = document.getElementById("configDefaultModel");
    if (state.config.default_model) {
        defModelSelect.value = state.config.default_model;
    }

    // Test connection buttons
    container.querySelectorAll(".btn-test-connection").forEach(btn => {
        btn.addEventListener("click", () => testConnection(btn.dataset.provider, btn));
    });
}

async function testConnection(provider, btn) {
    const providerInfo = state.providers[provider];
    if (!providerInfo) return;

    const model = (providerInfo.models || [])[0];
    if (!model) {
        btn.textContent = "Sem modelo disponível";
        return;
    }

    // Save any key that was entered first
    const keyInput = document.querySelector(`.config-api-key[data-provider="${provider}"]`);
    if (keyInput && keyInput.value) {
        await apiPost("/api/config", { api_keys: { [provider]: keyInput.value } });
    }

    btn.textContent = "Testando...";
    btn.disabled = true;

    const result = await apiPost("/api/config/test", { provider, model });

    if (result.success) {
        btn.textContent = "Conexão OK!";
        btn.style.color = "var(--success)";
    } else {
        btn.textContent = "Falhou: " + (result.error || "Erro").substring(0, 50);
        btn.style.color = "var(--error)";
    }

    btn.disabled = false;
    setTimeout(() => {
        btn.textContent = "Testar conexão";
        btn.style.color = "";
        loadConfig();
    }, 3000);
}

async function saveConfig() {
    const apiKeys = {};
    document.querySelectorAll(".config-api-key").forEach(input => {
        if (input.value) {
            apiKeys[input.dataset.provider] = input.value;
        }
    });

    const baseUrlInput = document.querySelector('.config-base-url[data-provider="openai-compatible"]');
    const customBaseUrl = baseUrlInput ? baseUrlInput.value : "";

    const payload = {
        default_provider: document.getElementById("configDefaultProvider").value,
        default_model: document.getElementById("configDefaultModel").value,
        api_keys: apiKeys,
        custom_base_url: customBaseUrl,
    };

    await apiPost("/api/config", payload);
    await loadConfig();
    closeModal("modalConfig");
}

/* ─── Assistant ─────────────────────────────────────────────────────────────── */

function toggleAssistant() {
    state.assistantOpen = !state.assistantOpen;
    const dialog = document.getElementById("assistantDialog");
    dialog.classList.toggle("open", state.assistantOpen);

    if (state.assistantOpen && state.selectedSite) {
        updateAssistantTargets();
        loadAssistantConversation();
        setTimeout(() => document.getElementById("assistantInput").focus(), 100);
    }
}

function updateAssistantTargets() {
    if (!state.selectedSite) return;
    const select = document.getElementById("assistantTarget");
    const options = ['<option value="index.html">Site Original</option>'];

    if (state.selectedSite.design_systems) {
        for (const ds of state.selectedSite.design_systems) {
            options.push(`<option value="${ds}">${ds}</option>`);
        }
    }
    select.innerHTML = options.join("");
}

async function loadAssistantConversation() {
    if (!state.selectedSite) return;

    // Check if we already loaded for this site
    if (state.assistantLoadedSite === state.selectedSite.name) return;

    const container = document.getElementById("assistantMessages");
    // Keep only the welcome message (first child)
    while (container.children.length > 1) {
        container.removeChild(container.lastChild);
    }

    try {
        const data = await api(`/api/assistant/conversation/${state.selectedSite.name}`);
        if (data.messages && data.messages.length > 0) {
            // Set target from conversation
            if (data.target) {
                const select = document.getElementById("assistantTarget");
                if (select.querySelector(`option[value="${data.target}"]`)) {
                    select.value = data.target;
                }
            }
            // Render persisted messages
            for (const msg of data.messages) {
                if (msg.role === "user") {
                    appendAssistantMsg("user", msg.content);
                } else {
                    appendAssistantMsg("bot", msg.content);
                    // Render undo button if backup_id exists
                    if (msg.backup_id) {
                        const lastMsg = container.lastElementChild;
                        if (lastMsg) {
                            const undoBtn = document.createElement("button");
                            undoBtn.className = "assistant-undo-btn";
                            undoBtn.textContent = "Desfazer";
                            undoBtn.addEventListener("click", function () {
                                undoAssistantAction(msg.backup_id, undoBtn);
                            });
                            lastMsg.appendChild(undoBtn);
                        }
                    }
                }
            }
        }
        state.assistantLoadedSite = state.selectedSite.name;
    } catch (e) {
        // Ignore — fresh conversation
    }
}

async function newAssistantConversation() {
    if (!state.selectedSite) return;
    try {
        await apiPost(`/api/assistant/conversation/${state.selectedSite.name}/new`);
    } catch (e) {
        // Ignore
    }
    state.assistantLoadedSite = null;
    // Clear chat UI
    const container = document.getElementById("assistantMessages");
    while (container.children.length > 1) {
        container.removeChild(container.lastChild);
    }
    state.assistantLoadedSite = state.selectedSite.name;
}

function sendAssistantMessage() {
    const input = document.getElementById("assistantInput");
    const prompt = input.value.trim();
    if (!prompt || !state.selectedSite) return;

    input.value = "";
    input.disabled = true;
    document.getElementById("btnAssistantSend").disabled = true;

    const target = document.getElementById("assistantTarget").value;

    // Add user message to chat
    appendAssistantMsg("user", prompt);

    // Add status indicator
    const statusId = "assistant-status-" + Date.now();
    appendAssistantStatus(statusId, "Processando...");

    apiPost("/api/assistant", {
        site_name: state.selectedSite.name,
        prompt: prompt,
        target: target,
    }).then(data => {
        if (data.error) {
            removeAssistantStatus(statusId);
            appendAssistantMsg("bot", data.error);
            input.disabled = false;
            document.getElementById("btnAssistantSend").disabled = false;
            return;
        }

        connectAssistantSSE(data.session_id, statusId);
    }).catch(err => {
        removeAssistantStatus(statusId);
        appendAssistantMsg("bot", "Erro de conexão: " + err.message);
        input.disabled = false;
        document.getElementById("btnAssistantSend").disabled = false;
    });
}

function connectAssistantSSE(sessionId, statusId) {
    const es = new EventSource("/api/assistant/stream/" + sessionId);

    es.onmessage = (event) => {
        updateAssistantStatus(statusId, event.data);
    };

    es.addEventListener("done", (event) => {
        es.close();
        removeAssistantStatus(statusId);

        let result;
        try {
            result = JSON.parse(event.data);
        } catch (e) {
            appendAssistantMsg("bot", "Erro ao processar resposta.");
            enableAssistantInput();
            return;
        }

        if (result.status === "error") {
            appendAssistantMsg("bot", result.error || "Erro desconhecido");
        } else {
            appendAssistantResult(result);
        }

        enableAssistantInput();
    });

    es.onerror = () => {
        es.close();
        removeAssistantStatus(statusId);
        appendAssistantMsg("bot", "Conexão perdida.");
        enableAssistantInput();
    };
}

function enableAssistantInput() {
    document.getElementById("assistantInput").disabled = false;
    document.getElementById("btnAssistantSend").disabled = false;
    document.getElementById("assistantInput").focus();
}

function inlineFmt(s) {
    s = escapeHtml(s);
    // Bold: **text**
    s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    // Code: `text`
    s = s.replace(/`([^`]+)`/g, '<code class="assistant-code">$1</code>');
    return s;
}

function renderMarkdown(text) {
    // Lightweight markdown-to-HTML for assistant messages
    try {
        // Normalize line endings
        text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

        // If text has no newlines, just apply inline formatting
        if (!text.includes("\n")) {
            return { html: inlineFmt(text), hasMarkdown: false };
        }

        var lines = text.split("\n");
        var result = [];
        var inList = false;
        var listType = "";
        var inTable = false;
        var hasMarkdown = false;

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];

            // Detect table separator row: |---|---|
            var isTableSep = /^\|[\s\-:|]+\|$/.test(line.trim());
            // Detect table data row: | x | y |
            var isTableRow = /^\|.+\|$/.test(line.trim());

            // Close list if current line doesn't continue it
            var isBullet = /^\s*[-*•]\s+/.test(line);
            var isNumbered = /^\s*\d+[.)]\s+/.test(line);
            if (inList && !isBullet && !isNumbered) {
                result.push(listType === "ul" ? "</ul>" : "</ol>");
                inList = false;
            }

            // Close table if current line isn't a table row
            if (inTable && !isTableRow && !isTableSep) {
                result.push("</tbody></table>");
                inTable = false;
            }

            // Empty line
            if (line.trim() === "") {
                if (inList) {
                    result.push(listType === "ul" ? "</ul>" : "</ol>");
                    inList = false;
                }
                if (inTable) {
                    result.push("</tbody></table>");
                    inTable = false;
                }
                result.push("<br>");
                continue;
            }

            // Table separator — skip (already handled by table header)
            if (isTableSep) {
                continue;
            }

            // Table row: | col1 | col2 | col3 |
            if (isTableRow) {
                hasMarkdown = true;
                var cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|");

                // Check if next line is separator → this is a header row
                var nextLine = (i + 1 < lines.length) ? lines[i + 1].trim() : "";
                var nextIsSep = /^\|[\s\-:|]+\|$/.test(nextLine);

                if (!inTable && nextIsSep) {
                    // Header row
                    result.push('<table class="assistant-table"><thead><tr>');
                    for (var c = 0; c < cells.length; c++) {
                        result.push("<th>" + inlineFmt(cells[c].trim()) + "</th>");
                    }
                    result.push("</tr></thead><tbody>");
                    inTable = true;
                    i++; // Skip separator line
                } else {
                    // Data row
                    if (!inTable) {
                        result.push('<table class="assistant-table"><tbody>');
                        inTable = true;
                    }
                    result.push("<tr>");
                    for (var c = 0; c < cells.length; c++) {
                        result.push("<td>" + inlineFmt(cells[c].trim()) + "</td>");
                    }
                    result.push("</tr>");
                }
                continue;
            }

            // Headers: ## Header
            var headerMatch = line.match(/^(#{1,4})\s+(.*)$/);
            if (headerMatch) {
                hasMarkdown = true;
                var level = Math.min(headerMatch[1].length + 2, 6);
                result.push('<h' + level + ' class="assistant-heading">' + inlineFmt(headerMatch[2]) + '</h' + level + '>');
                continue;
            }

            // Bullet list: - item, * item, • item
            var bulletMatch = line.match(/^\s*[-*•]\s+(.*)$/);
            if (bulletMatch) {
                hasMarkdown = true;
                if (!inList || listType !== "ul") {
                    if (inList) result.push(listType === "ul" ? "</ul>" : "</ol>");
                    result.push('<ul class="assistant-list">');
                    inList = true;
                    listType = "ul";
                }
                result.push("<li>" + inlineFmt(bulletMatch[1]) + "</li>");
                continue;
            }

            // Numbered list: 1. item, 1) item
            var numMatch = line.match(/^\s*\d+[.)]\s+(.*)$/);
            if (numMatch) {
                hasMarkdown = true;
                if (!inList || listType !== "ol") {
                    if (inList) result.push(listType === "ul" ? "</ul>" : "</ol>");
                    result.push('<ol class="assistant-list">');
                    inList = true;
                    listType = "ol";
                }
                result.push("<li>" + inlineFmt(numMatch[1]) + "</li>");
                continue;
            }

            // Regular paragraph
            result.push('<p class="assistant-para">' + inlineFmt(line) + '</p>');
        }

        if (inList) result.push(listType === "ul" ? "</ul>" : "</ol>");
        if (inTable) result.push("</tbody></table>");

        return { html: result.join(""), hasMarkdown: hasMarkdown };
    } catch (e) {
        // Fallback: escape and preserve newlines via CSS
        console.error("renderMarkdown error:", e);
        return { html: escapeHtml(text), hasMarkdown: false };
    }
}

function appendAssistantMsg(role, content) {
    const container = document.getElementById("assistantMessages");
    const msgEl = document.createElement("div");
    msgEl.className = "assistant-msg " + (role === "user" ? "assistant-msg-user" : "assistant-msg-bot");

    const contentEl = document.createElement("div");
    contentEl.className = "assistant-msg-content";
    if (role === "bot") {
        const md = renderMarkdown(content);
        contentEl.innerHTML = md.html;
        if (md.hasMarkdown) contentEl.classList.add("has-markdown");
    } else {
        contentEl.textContent = content;
    }
    msgEl.appendChild(contentEl);

    container.appendChild(msgEl);
    container.scrollTop = container.scrollHeight;
}

function appendAssistantResult(result) {
    const container = document.getElementById("assistantMessages");
    const msgEl = document.createElement("div");
    msgEl.className = "assistant-msg assistant-msg-bot";

    // Explanation
    const contentEl = document.createElement("div");
    contentEl.className = "assistant-msg-content";
    const md = renderMarkdown(result.explanation || "Operação concluída.");
    contentEl.innerHTML = md.html;
    if (md.hasMarkdown) contentEl.classList.add("has-markdown");
    msgEl.appendChild(contentEl);

    // File chips
    if (result.results && result.results.length > 0) {
        const filesEl = document.createElement("div");
        filesEl.className = "assistant-msg-files";
        for (const r of result.results) {
            const chip = document.createElement("span");
            chip.className = "assistant-file-chip" + (r.ok ? "" : " error");
            chip.textContent = r.file + (r.ok ? "" : " (erro)");
            filesEl.appendChild(chip);
        }
        msgEl.appendChild(filesEl);
    }

    // Undo button
    if (result.backup_id) {
        state.assistantBackups.push({
            backup_id: result.backup_id,
            site_name: state.selectedSite.name,
        });

        const undoBtn = document.createElement("button");
        undoBtn.className = "assistant-undo-btn";
        undoBtn.textContent = "Desfazer";
        undoBtn.addEventListener("click", function () {
            undoAssistantAction(result.backup_id, undoBtn);
        });
        msgEl.appendChild(undoBtn);
    }

    container.appendChild(msgEl);
    container.scrollTop = container.scrollHeight;

    // Reload preview iframe
    refreshPreviewAfterAssistant();
}

function appendAssistantStatus(id, text) {
    const container = document.getElementById("assistantMessages");
    const el = document.createElement("div");
    el.id = id;
    el.className = "assistant-msg assistant-msg-bot";
    const statusEl = document.createElement("div");
    statusEl.className = "assistant-msg-status";
    statusEl.textContent = text;
    el.appendChild(statusEl);
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
}

function updateAssistantStatus(id, text) {
    const el = document.getElementById(id);
    if (!el) return;
    const statusEl = el.querySelector(".assistant-msg-status");
    if (statusEl) statusEl.textContent = text;
    const container = document.getElementById("assistantMessages");
    container.scrollTop = container.scrollHeight;
}

function removeAssistantStatus(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}

async function undoAssistantAction(backupId, btn) {
    if (!state.selectedSite) return;
    btn.disabled = true;
    btn.textContent = "Desfazendo...";

    try {
        const result = await apiPost("/api/assistant/undo", {
            site_name: state.selectedSite.name,
            backup_id: backupId,
        });

        if (result.success) {
            btn.textContent = "Desfeito!";
            btn.style.color = "var(--success)";
            refreshPreviewAfterAssistant();
        } else {
            btn.textContent = "Erro";
            btn.style.color = "var(--error)";
        }
    } catch (e) {
        btn.textContent = "Erro";
        btn.style.color = "var(--error)";
    }

    setTimeout(() => {
        btn.style.display = "none";
    }, 2000);
}

function refreshPreviewAfterAssistant() {
    // Reload whichever iframe is currently showing
    if (state.activeTab === "editor") {
        activateEditor();
    } else if (state.activeTab === "original") {
        if (state.splitView) {
            document.getElementById("splitOriginal").src += "";
        } else {
            document.getElementById("previewFrame").src += "";
        }
    } else if (state.activeTab === "design-system") {
        if (state.splitView) {
            document.getElementById("splitDesignSystem").src += "";
        } else {
            document.getElementById("previewFrame").src += "";
        }
    }
}

/* ─── SSE Helper ───────────────────────────────────────────────────────────── */

function connectSSE(sessionId, endpoint, logContainerId, onDone) {
    const es = new EventSource(endpoint + sessionId);

    es.onmessage = (event) => {
        addLog(logContainerId, event.data);
    };

    es.addEventListener("done", (event) => {
        es.close();
        if (onDone) onDone(event.data);
    });

    es.onerror = () => {
        es.close();
    };
}

/* ─── Log Helper ───────────────────────────────────────────────────────────── */

function addLog(containerId, message) {
    const container = document.getElementById(containerId);
    const entry = document.createElement("div");
    entry.className = "log-entry";
    entry.textContent = message;
    container.appendChild(entry);
    container.scrollTop = container.scrollHeight;
}

/* ─── Modal Helpers ────────────────────────────────────────────────────────── */

function openModal(modalId) {
    document.getElementById(modalId).classList.add("open");
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove("open");
}
