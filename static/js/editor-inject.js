/**
 * Editor Inject Script
 * Injected into the iframe to enable element selection, removal,
 * ancestor navigation, and DOM tree synchronization.
 * Communicates with the parent via postMessage.
 */
(function () {
    "use strict";

    const HIGHLIGHT_COLOR = "rgba(239, 68, 68, 0.6)";
    const SELECTED_COLOR = "rgba(99, 102, 241, 0.8)";
    const PROTECTED_TAGS = new Set(["HTML", "BODY", "HEAD"]);
    const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "LINK", "META", "NOSCRIPT", "BR", "WBR"]);

    let hoveredEl = null;
    let selectedEl = null;
    let childHistory = []; // stack for navigate-child
    let undoStack = [];    // { element, parent, nextSibling }

    // ─── Overlays ────────────────────────────────────────────────────────────

    const overlay = document.createElement("div");
    overlay.id = "__editor-overlay";
    overlay.style.cssText =
        "position:fixed;pointer-events:none;z-index:2147483646;" +
        "border:2px solid " + HIGHLIGHT_COLOR + ";background:rgba(239,68,68,0.08);" +
        "transition:top 0.05s,left 0.05s,width 0.05s,height 0.05s;display:none;";
    document.body.appendChild(overlay);

    const selOverlay = document.createElement("div");
    selOverlay.id = "__editor-sel-overlay";
    selOverlay.style.cssText =
        "position:fixed;pointer-events:none;z-index:2147483645;" +
        "border:2px solid " + SELECTED_COLOR + ";background:rgba(99,102,241,0.08);" +
        "display:none;";
    document.body.appendChild(selOverlay);

    function isEditorElement(el) {
        if (!el) return false;
        return el.id === "__editor-overlay" || el.id === "__editor-sel-overlay";
    }

    function positionOverlay(overlayEl, targetEl) {
        const rect = targetEl.getBoundingClientRect();
        overlayEl.style.top = rect.top + "px";
        overlayEl.style.left = rect.left + "px";
        overlayEl.style.width = rect.width + "px";
        overlayEl.style.height = rect.height + "px";
        overlayEl.style.display = "block";
    }

    // ─── Path utilities ──────────────────────────────────────────────────────

    function getPath(el) {
        const path = [];
        let current = el;
        while (current && current !== document.body && current.parentElement) {
            const parent = current.parentElement;
            const children = Array.from(parent.children).filter(c => !isEditorElement(c));
            const idx = children.indexOf(current);
            path.unshift(idx);
            current = parent;
        }
        return path;
    }

    function getElementByPath(path) {
        let el = document.body;
        for (const idx of path) {
            const children = Array.from(el.children).filter(c => !isEditorElement(c));
            if (idx < 0 || idx >= children.length) return null;
            el = children[idx];
        }
        return el;
    }

    function getNodeLabel(el) {
        let tag = el.tagName.toLowerCase();
        if (el.id) tag += "#" + el.id;
        else if (el.className && typeof el.className === "string") {
            const cls = el.className.trim().split(/\s+/).slice(0, 2).join(".");
            if (cls) tag += "." + cls;
        }
        return tag;
    }

    function getBreadcrumb(el) {
        const parts = [];
        let current = el;
        while (current && current !== document.documentElement) {
            parts.unshift(getNodeLabel(current));
            current = current.parentElement;
        }
        return parts.join(" > ");
    }

    function notifyParent(type, data) {
        window.parent.postMessage({ source: "editor-inject", type, ...data }, "*");
    }

    // ─── Color utilities ────────────────────────────────────────────────────

    function getElementColorInfo(el, property) {
        // 1. Check inline style first
        var inlineValue = el.style.getPropertyValue(property);
        if (inlineValue) {
            return { value: inlineValue, source: "inline", sheetIndex: -1, ruleIndex: -1, cssSelector: "" };
        }

        // 2. Search stylesheets for matching CSS rule
        var bestMatch = null;
        try {
            for (var si = 0; si < document.styleSheets.length; si++) {
                var sheet = document.styleSheets[si];
                var rules;
                try {
                    rules = sheet.cssRules || sheet.rules;
                } catch (e) {
                    // CORS — skip cross-origin sheets
                    continue;
                }
                if (!rules) continue;

                for (var ri = 0; ri < rules.length; ri++) {
                    var rule = rules[ri];
                    if (!rule.selectorText || !rule.style) continue;
                    var ruleValue = rule.style.getPropertyValue(property);
                    if (!ruleValue) continue;

                    try {
                        if (el.matches(rule.selectorText)) {
                            // Later rules / higher index = higher cascade priority
                            bestMatch = {
                                value: ruleValue,
                                source: "css",
                                sheetIndex: si,
                                ruleIndex: ri,
                                cssSelector: rule.selectorText,
                            };
                        }
                    } catch (e) {
                        // Invalid selector — skip
                    }
                }
            }
        } catch (e) {
            // Stylesheet access error
        }

        if (bestMatch) return bestMatch;

        // 3. No specific rule found — use computed value as default
        var computed = window.getComputedStyle(el).getPropertyValue(property);
        return { value: computed || "", source: "default", sheetIndex: -1, ruleIndex: -1, cssSelector: "" };
    }

    function getElementColors(el) {
        return {
            color: getElementColorInfo(el, "color"),
            backgroundColor: getElementColorInfo(el, "background-color"),
        };
    }

    function changeColor(property, value) {
        if (!selectedEl) {
            notifyParent("error", { message: "Nenhum elemento selecionado" });
            return;
        }

        var info = getElementColorInfo(selectedEl, property);

        // Save undo entry
        undoStack.push({
            type: "color",
            element: selectedEl,
            property: property,
            oldValue: info.value,
            oldSource: info.source,
            sheetIndex: info.sheetIndex,
            ruleIndex: info.ruleIndex,
        });

        // Apply change: CSS rule first, inline as fallback
        if (info.source === "css") {
            try {
                var rule = document.styleSheets[info.sheetIndex].cssRules[info.ruleIndex];
                rule.style.setProperty(property, value);
            } catch (e) {
                // Fallback to inline if CSS modification fails
                selectedEl.style.setProperty(property, value);
            }
        } else {
            selectedEl.style.setProperty(property, value);
        }

        // Notify parent with updated colors
        notifyParent("color-changed", {
            undoCount: undoStack.length,
            colors: getElementColors(selectedEl),
        });
    }

    function undoColor(action) {
        if (action.oldSource === "css" && action.sheetIndex >= 0) {
            try {
                var rule = document.styleSheets[action.sheetIndex].cssRules[action.ruleIndex];
                rule.style.setProperty(action.property, action.oldValue);
            } catch (e) {
                action.element.style.setProperty(action.property, action.oldValue);
            }
        } else if (action.oldSource === "inline") {
            action.element.style.setProperty(action.property, action.oldValue);
        } else {
            // Was default — remove any inline override
            action.element.style.removeProperty(action.property);
        }
    }

    // ─── Selection helper ────────────────────────────────────────────────────

    function selectElement(el) {
        if (!el || PROTECTED_TAGS.has(el.tagName) || isEditorElement(el)) return;
        selectedEl = el;
        childHistory = [];
        positionOverlay(selOverlay, selectedEl);
        notifySelection();
    }

    function notifySelection() {
        if (!selectedEl) return;
        notifyParent("select", {
            breadcrumb: getBreadcrumb(selectedEl),
            tagName: selectedEl.tagName.toLowerCase(),
            path: getPath(selectedEl),
            dimensions: {
                width: Math.round(selectedEl.offsetWidth),
                height: Math.round(selectedEl.offsetHeight),
            },
            hasParent: selectedEl.parentElement && !PROTECTED_TAGS.has(selectedEl.parentElement.tagName),
            hasChildren: Array.from(selectedEl.children).filter(c => !isEditorElement(c) && !SKIP_TAGS.has(c.tagName)).length > 0,
            colors: getElementColors(selectedEl),
        });
    }

    // ─── DOM Tree builder ────────────────────────────────────────────────────

    function buildTreeNode(el, path, depth, maxDepth) {
        if (isEditorElement(el) || SKIP_TAGS.has(el.tagName)) return null;

        const children = Array.from(el.children).filter(c => !isEditorElement(c) && !SKIP_TAGS.has(c.tagName));
        const node = {
            tag: el.tagName.toLowerCase(),
            id: el.id || "",
            classes: (el.className && typeof el.className === "string")
                ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3)
                : [],
            path: path,
            childCount: children.length,
            children: [],
        };

        // Add short text preview for leaf nodes
        if (children.length === 0 && el.textContent) {
            const text = el.textContent.trim().substring(0, 40);
            if (text) node.text = text + (el.textContent.trim().length > 40 ? "..." : "");
        }

        if (depth < maxDepth) {
            let idx = 0;
            for (const child of el.children) {
                if (isEditorElement(child) || SKIP_TAGS.has(child.tagName)) continue;
                const childNode = buildTreeNode(child, [...path, idx], depth + 1, maxDepth);
                if (childNode) node.children.push(childNode);
                idx++;
            }
        }

        return node;
    }

    function sendDomTree() {
        const tree = buildTreeNode(document.body, [], 0, 20);
        notifyParent("dom-tree", { tree });
    }

    function sendSubtree(path) {
        const el = getElementByPath(path);
        if (!el) return;
        const node = buildTreeNode(el, path, 0, 20);
        notifyParent("subtree", { node, parentPath: path });
    }

    // ─── Mouse Events ────────────────────────────────────────────────────────

    document.addEventListener("mouseover", function (e) {
        if (isEditorElement(e.target)) return;
        if (PROTECTED_TAGS.has(e.target.tagName)) return;

        hoveredEl = e.target;
        positionOverlay(overlay, hoveredEl);
    }, true);

    document.addEventListener("mouseout", function (e) {
        if (isEditorElement(e.target)) return;
        if (e.target === hoveredEl) {
            overlay.style.display = "none";
            hoveredEl = null;
        }
    }, true);

    document.addEventListener("click", function (e) {
        if (isEditorElement(e.target)) return;
        e.preventDefault();
        e.stopPropagation();

        const target = e.target;
        if (PROTECTED_TAGS.has(target.tagName)) return;

        selectElement(target);
    }, true);

    // ─── Commands from Parent ────────────────────────────────────────────────

    window.addEventListener("message", function (e) {
        if (!e.data || e.data.source !== "editor-parent") return;

        switch (e.data.command) {
            case "remove":
                removeSelected();
                break;
            case "undo":
                undoLast();
                break;
            case "get-html":
                sendHTML();
                break;
            case "deselect":
                deselect();
                break;
            case "navigate-parent":
                navigateParent();
                break;
            case "navigate-child":
                navigateChild();
                break;
            case "select-by-path":
                selectByPath(e.data.path);
                break;
            case "get-dom-tree":
                sendDomTree();
                break;
            case "get-subtree":
                sendSubtree(e.data.path);
                break;
            case "change-color":
                changeColor(e.data.property, e.data.value);
                break;
        }
    });

    function navigateParent() {
        if (!selectedEl || !selectedEl.parentElement) return;
        const parent = selectedEl.parentElement;
        if (PROTECTED_TAGS.has(parent.tagName)) return;

        childHistory.push(selectedEl);
        selectedEl = parent;
        positionOverlay(selOverlay, selectedEl);
        scrollToElement(selectedEl);
        notifySelection();
    }

    function navigateChild() {
        if (childHistory.length > 0) {
            // Go back to the previously selected child
            selectedEl = childHistory.pop();
        } else if (selectedEl) {
            // Go to first visible child
            const children = Array.from(selectedEl.children).filter(c => !isEditorElement(c) && !SKIP_TAGS.has(c.tagName));
            if (children.length === 0) return;
            selectedEl = children[0];
        }
        if (selectedEl) {
            positionOverlay(selOverlay, selectedEl);
            scrollToElement(selectedEl);
            notifySelection();
        }
    }

    function selectByPath(path) {
        const el = getElementByPath(path);
        if (!el) return;
        selectedEl = el;
        childHistory = [];
        positionOverlay(selOverlay, selectedEl);
        scrollToElement(selectedEl);
        notifySelection();
    }

    function scrollToElement(el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    function removeSelected() {
        if (!selectedEl || !selectedEl.parentNode) {
            notifyParent("error", { message: "Nenhum elemento selecionado" });
            return;
        }

        const path = getPath(selectedEl);

        undoStack.push({
            element: selectedEl,
            parent: selectedEl.parentNode,
            nextSibling: selectedEl.nextSibling,
        });

        selectedEl.remove();
        selOverlay.style.display = "none";
        overlay.style.display = "none";

        notifyParent("removed", {
            undoCount: undoStack.length,
            removedPath: path,
        });

        selectedEl = null;
        hoveredEl = null;
        childHistory = [];

        // Send updated tree
        sendDomTree();
    }

    function undoLast() {
        if (undoStack.length === 0) {
            notifyParent("error", { message: "Nada para desfazer" });
            return;
        }

        const action = undoStack.pop();

        if (action.type === "color") {
            // Undo color change
            undoColor(action);
            notifyParent("undone", { undoCount: undoStack.length });

            // Re-select same element to update color panel
            if (action.element === selectedEl) {
                notifySelection();
            }
            return;
        }

        // Undo element removal
        action.parent.insertBefore(action.element, action.nextSibling);

        notifyParent("undone", { undoCount: undoStack.length });

        selectedEl = action.element;
        childHistory = [];
        positionOverlay(selOverlay, selectedEl);
        notifySelection();

        // Send updated tree
        sendDomTree();
    }

    function deselect() {
        selectedEl = null;
        childHistory = [];
        selOverlay.style.display = "none";
        overlay.style.display = "none";
        notifyParent("deselected", {});
    }

    function sendHTML() {
        overlay.style.display = "none";
        selOverlay.style.display = "none";

        const overlayRef = overlay;
        const selRef = selOverlay;
        overlayRef.remove();
        selRef.remove();

        // Also remove the injected script tag
        const scripts = document.querySelectorAll('script[src*="editor-inject"]');
        const scriptBackup = [];
        scripts.forEach(s => {
            scriptBackup.push({ el: s, parent: s.parentNode, next: s.nextSibling });
            s.remove();
        });

        let html = "";
        if (document.doctype) {
            html += "<!DOCTYPE " + document.doctype.name;
            if (document.doctype.publicId) html += ' PUBLIC "' + document.doctype.publicId + '"';
            if (document.doctype.systemId) html += ' "' + document.doctype.systemId + '"';
            html += ">\n";
        }
        html += document.documentElement.outerHTML;

        notifyParent("html", { html });

        // Re-add everything
        document.body.appendChild(overlayRef);
        document.body.appendChild(selRef);
        scriptBackup.forEach(s => s.parent.insertBefore(s.el, s.next));
    }

    // ─── Overlay position updates ────────────────────────────────────────────

    function updateOverlays() {
        if (hoveredEl && hoveredEl.parentNode) positionOverlay(overlay, hoveredEl);
        if (selectedEl && selectedEl.parentNode) positionOverlay(selOverlay, selectedEl);
    }

    window.addEventListener("scroll", updateOverlays, true);
    window.addEventListener("resize", updateOverlays);

    // ─── Init ────────────────────────────────────────────────────────────────

    notifyParent("ready", {});
    // Send initial DOM tree after a brief delay so the page fully settles
    setTimeout(sendDomTree, 200);
})();
