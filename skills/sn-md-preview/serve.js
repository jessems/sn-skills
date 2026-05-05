#!/usr/bin/env node
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execSync, execFileSync } = require('node:child_process');
const crypto = require('node:crypto');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PORT_START = 3333;
const PORT_END = 3343;
const DEBOUNCE_MS = 300;
const MMDC = (() => { try { return execSync('which mmdc', { stdio: ['pipe','pipe','pipe'] }).toString().trim(); } catch (_) { return 'mmdc'; } })();

const mdFilePath = path.resolve(process.argv[2] || '');
if (!mdFilePath || !fs.existsSync(mdFilePath)) {
  console.error('Usage: node serve.js <path-to-markdown-file>');
  process.exit(1);
}
const mdDir = path.dirname(mdFilePath);

// ---------------------------------------------------------------------------
// Markdown-it setup
// ---------------------------------------------------------------------------
const MarkdownIt = require('markdown-it');
const md = new MarkdownIt({ html: true, linkify: true, typographer: false });

// ---------------------------------------------------------------------------
// Mermaid extraction & PNG rendering
// ---------------------------------------------------------------------------
const pngCache = new Map();       // contentHash -> base64 PNG
const pngBufferCache = new Map(); // contentHash -> raw Buffer

function extractMermaidBlocks(source) {
  const blocks = [];
  const cleaned = source.replace(/```mermaid\s*\n([\s\S]*?)```/g, function (match, code) {
    const id = 'mermaid-' + blocks.length;
    blocks.push({ id: id, code: code.trim() });
    return '<!--MERMAID_PLACEHOLDER_' + blocks.length + '-->';
  });
  return { cleaned: cleaned, blocks: blocks };
}

function renderPng(mermaidCode) {
  var hash = crypto.createHash('sha256').update(mermaidCode).digest('hex').slice(0, 16);
  if (pngCache.has(hash)) return { b64: pngCache.get(hash), hash: hash };

  var tmpDir = path.join(require('node:os').tmpdir(), 'publish-preview');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  var inFile = path.join(tmpDir, hash + '.mmd');
  var outFile = path.join(tmpDir, hash + '.png');
  fs.writeFileSync(inFile, mermaidCode, 'utf8');

  try {
    execFileSync(MMDC, ['-i', inFile, '-o', outFile, '-s', '2', '-b', 'transparent', '-q'], {
      timeout: 30000,
      stdio: 'pipe',
    });
    var png = fs.readFileSync(outFile);
    pngBufferCache.set(hash, png);
    var b64 = 'data:image/png;base64,' + png.toString('base64');
    pngCache.set(hash, b64);
    return { b64: b64, hash: hash };
  } catch (err) {
    console.error('mmdc failed for block:', err.message);
    return null;
  }
}

function renderAllPngs(blocks) {
  return blocks.map(function (b) {
    var result = renderPng(b.code);
    return { id: b.id, code: b.code, png: result ? result.b64 : null, hash: result ? result.hash : null };
  });
}

// ---------------------------------------------------------------------------
// HTML builder
// ---------------------------------------------------------------------------
function buildHtml(source) {
  // Strip Obsidian-style internal links: [[target|display]] -> display, [[target]] -> target
  var stripped = source.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1');
  var result = extractMermaidBlocks(stripped);
  var htmlBody = makeAccordions(md.render(result.cleaned));
  var enrichedBlocks = renderAllPngs(result.blocks);

  // Replace placeholders with dual containers
  enrichedBlocks.forEach(function (b, i) {
    var placeholder = '<!--MERMAID_PLACEHOLDER_' + (i + 1) + '-->';
    var pngDataAttr = b.png ? ' data-png="' + b.png + '"' : '';
    var pngUrlAttr = b.hash ? ' data-png-url="/mermaid-png/' + b.hash + '.png"' : '';
    var codeAttr = ' data-code="' + escapeHtml(b.code) + '"';
    var diagramHtml = '<div class="mermaid-container"' + pngDataAttr + pngUrlAttr + codeAttr + ' data-zoom="1">'
      + '<div class="mermaid-toolbar">'
      + '<div class="mermaid-zoom-controls">'
      + '<button class="mermaid-zoom-btn zoom-out" title="Zoom out"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg></button>'
      + '<span class="mermaid-zoom-level">100%</span>'
      + '<button class="mermaid-zoom-btn zoom-in" title="Zoom in"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>'
      + '</div>'
      + '<button class="diagram-copy-btn" title="Copy diagram as PNG"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg></button>'
      + '</div>'
      + '<div class="mermaid-zoom-wrap"><pre class="mermaid">' + escapeHtml(b.code) + '</pre></div></div>';
    htmlBody = htmlBody.replace(placeholder, diagramHtml);
  });

  return '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>' + escapeHtml(path.basename(mdFilePath)) + '</title>'
    + '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.8.1/github-markdown-light.min.css">'
    + '<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"><\/script>'
    + '<style>'
    + 'body { max-width: 980px; margin: 0 auto; padding: 32px 16px; }'
    + '.markdown-body { font-size: 16px; }'
    + '.mermaid-container { position: relative; }'
    + '.mermaid-toolbar { position: absolute; top: 8px; right: 8px; z-index: 10; display: flex; align-items: center; gap: 6px; opacity: 0; transition: opacity 0.15s; }'
    + '.mermaid-container:hover .mermaid-toolbar { opacity: 1; }'
    + '.mermaid-zoom-controls { display: flex; align-items: center; border: 1px solid #d0d7de; border-radius: 5px; background: rgba(246,248,250,0.9); box-shadow: 0 1px 3px rgba(0,0,0,0.08); overflow: hidden; }'
    + '.mermaid-zoom-btn { padding: 4px 7px; border: none; background: transparent; cursor: pointer; line-height: 0; color: #57606a; }'
    + '.mermaid-zoom-btn:hover { background: #eaeef2; color: #24292f; }'
    + '.mermaid-zoom-level { font-size: 11px; font-family: ui-monospace,"SF Mono",Menlo,monospace; color: #57606a; min-width: 36px; text-align: center; user-select: none; border-left: 1px solid #d0d7de; border-right: 1px solid #d0d7de; padding: 3px 2px; cursor: pointer; }'
    + '.mermaid-zoom-level:hover { background: #eaeef2; color: #24292f; }'
    + '.mermaid-zoom-wrap { overflow: hidden; cursor: grab; }'
    + '.mermaid-zoom-wrap.panning { cursor: grabbing; user-select: none; }'
    + '.mermaid-zoom-wrap > .mermaid { transform-origin: top left; transition: transform 0.15s ease; }'
    + '.mermaid-zoom-wrap > .mermaid svg { max-width: 100%; height: auto; }'
    + '.diagram-copy-btn { padding: 4px 6px; border: 1px solid #d0d7de; border-radius: 5px; '
    + '  background: rgba(246,248,250,0.9); cursor: pointer; line-height: 0; '
    + '  box-shadow: 0 1px 3px rgba(0,0,0,0.08); }'
    + '.diagram-copy-btn:hover { background: #eaeef2; }'
    + '.fab-wrap { position: fixed; top: 16px; right: 16px; z-index: 1000; }'
    + '.fab-btn { width: 42px; height: 42px; border-radius: 50%; background: #2da44e; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; color: #fff; padding: 0; box-shadow: 0 2px 8px rgba(45,164,78,0.4), 0 1px 3px rgba(0,0,0,0.12); transition: background 0.15s, transform 0.15s, box-shadow 0.15s; }'
    + '.fab-btn:hover { background: #2c974b; transform: scale(1.07); box-shadow: 0 4px 14px rgba(45,164,78,0.5), 0 2px 4px rgba(0,0,0,0.12); }'
    + '.fab-btn.open { background: #1f7d3a; transform: scale(0.94); }'
    + '.fab-options { position: absolute; top: 0; right: calc(100% + 10px); display: flex; flex-direction: column; align-items: flex-end; gap: 8px; pointer-events: none; }'
    + '.fab-opt { padding: 0 15px; height: 34px; border-radius: 17px; background: #fff; border: 1px solid rgba(0,0,0,0.1); cursor: pointer; font-size: 12px; font-family: ui-monospace,"SF Mono",Menlo,monospace; font-weight: 500; letter-spacing: 0.03em; color: #24292f; box-shadow: 0 2px 8px rgba(0,0,0,0.09), 0 1px 2px rgba(0,0,0,0.05); white-space: nowrap; opacity: 0; transform: translateX(10px); transition: opacity 0.2s ease, transform 0.2s ease, background 0.12s; pointer-events: none; }'
    + '.fab-opt:hover { background: #f3f4f6; }'
    + '.fab-options.open { pointer-events: auto; }'
    + '.fab-options.open .fab-opt { opacity: 1; transform: translateX(0); pointer-events: auto; }'
    + '.fab-options.open .fab-opt:nth-child(1) { transition-delay: 0.03s; }'
    + '.fab-options.open .fab-opt:nth-child(2) { transition-delay: 0.07s; }'
    + 'details { margin-top: 24px; }'
    + 'details > summary { list-style: none; cursor: pointer; position: relative; }'
    + 'details > summary::-webkit-details-marker { display: none; }'
    + 'details > summary::before { content: "▶"; position: absolute; left: -1.4em; top: 50%; transform: translateY(-50%); font-size: 0.55em; transition: opacity 0.15s, transform 0.15s; color: #57606a; opacity: 0; }'
    + 'details > summary:hover::before { opacity: 0.5; }'
    + 'details[open] > summary::before { transform: translateY(-50%) rotate(90deg); }'
    + 'details[open] > summary:hover::before { opacity: 0.5; }'
    + 'details > summary > h1, details > summary > h2, details > summary > h3, details > summary > h4, details > summary > h5, details > summary > h6 { margin: 0 !important; border-bottom: none !important; padding-bottom: 0 !important; }'
    + '.accordion-content { padding-top: 16px; }'
    + '</style>'
    + '</head><body>'
    + '<div class="fab-wrap">'
    + '<div class="fab-options" id="fab-options">'
    + '<button class="fab-opt" id="copy-confluence"><svg width="13" height="13" viewBox="0 0 32 32" style="vertical-align:-1px;margin-right:6px"><path d="M2.3 24.2c-.5.8-.2 1.8.6 2.2l6.2 3.6c.8.5 1.8.2 2.2-.6L18 16l-7-4z" fill="#2684FF"/><path d="M29.7 7.8c.5-.8.2-1.8-.6-2.2l-6.2-3.6c-.8-.5-1.8-.2-2.2.6L14 16l7 4z" fill="#2684FF"/></svg>Confluence</button>'
    + '<button class="fab-opt" id="copy-servicenow"><svg width="13" height="13" viewBox="-1 -1 26 26" style="vertical-align:-1px;margin-right:6px"><circle cx="12" cy="12" r="11" fill="#293740"/><path d="M8.5 15c0-1.8 1.3-3.2 3-3.7l1.5-.4c1.7-.5 3-1.9 3-3.7 0-2-1.8-3.7-4-3.7S8 5.2 8 7.2" stroke="#62D84E" stroke-width="1.7" stroke-linecap="round" fill="none"/><circle cx="12" cy="17.5" r="1.5" fill="#62D84E"/></svg>ServiceNow</button>'
    + '</div>'
    + '<button class="fab-btn" id="copy-fab" aria-label="Copy to\u2026"><svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg></button>'
    + '</div>'
    + '<article class="markdown-body">'
    + htmlBody
    + '</article>'
    + '<script>'
    + 'mermaid.initialize({ startOnLoad: true, theme: "default" });'
    + '(function() {'
    + '  var checkIcon = \'<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#1a7f37" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:4px"><polyline points="20 6 9 17 4 12"/></svg>\';'
    + '  var fab = document.getElementById("copy-fab");'
    + '  var fabOptions = document.getElementById("fab-options");'
    + '  fab.addEventListener("click", function(e) {'
    + '    e.stopPropagation();'
    + '    var isOpen = fabOptions.classList.contains("open");'
    + '    fabOptions.classList.toggle("open", !isOpen);'
    + '    fab.classList.toggle("open", !isOpen);'
    + '  });'
    + '  document.addEventListener("click", function() {'
    + '    fabOptions.classList.remove("open");'
    + '    fab.classList.remove("open");'
    + '  });'
    + '  fabOptions.addEventListener("click", function(e) { e.stopPropagation(); });'
    + '  function flashDone(btn) {'
    + '    var orig = btn.innerHTML;'
    + '    btn.innerHTML = checkIcon + "Copied!";'
    + '    setTimeout(function() { btn.innerHTML = orig; fabOptions.classList.remove("open"); fab.classList.remove("open"); }, 1200);'
    + '  }'
    + '  function extractDiagramTitle(code) {'
    + '    var yamlMatch = code.match(/^---[\\s\\S]*?title:\\s*(.+?)[\\s\\S]*?---/m);'
    + '    if (yamlMatch) return yamlMatch[1].trim();'
    + '    var titleMatch = code.match(/^\\s*title[\\s:]+(.+)/im);'
    + '    if (titleMatch) return titleMatch[1].trim();'
    + '    return code.trim().split("\\n")[0].trim() || "Diagram";'
    + '  }'
    + '  document.querySelectorAll(".diagram-copy-btn").forEach(function(btn) {'
    + '    btn.addEventListener("click", function(e) {'
    + '      e.stopPropagation();'
    + '      var b64 = btn.closest(".mermaid-container").getAttribute("data-png");'
    + '      if (!b64) return;'
    + '      var binary = atob(b64.split(",")[1]);'
    + '      var bytes = new Uint8Array(binary.length);'
    + '      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);'
    + '      var blob = new Blob([bytes], { type: "image/png" });'
    + '      var checkIcon = \'<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1a7f37" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>\';'
    + '      var clipIcon = \'<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>\';'
    + '      navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]).then(function() {'
    + '        btn.innerHTML = checkIcon;'
    + '        setTimeout(function() { btn.innerHTML = clipIcon; }, 1500);'
    + '      });'
    + '    });'
    + '  });'
    + '  var ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];'
    + '  function applyTransform(target, zoom, panX, panY) {'
    + '    if (zoom === 1 && panX === 0 && panY === 0) { target.style.transform = ""; }'
    + '    else { target.style.transform = "translate(" + panX + "px," + panY + "px) scale(" + zoom + ")"; }'
    + '  }'
    + '  document.querySelectorAll(".mermaid-container").forEach(function(c) {'
    + '    var state = { zoom: 1, panX: 0, panY: 0 };'
    + '    var wrap = c.querySelector(".mermaid-zoom-wrap");'
    + '    var target = wrap.querySelector(".mermaid");'
    + '    function applyZoom(zoom) {'
    + '      var old = state.zoom;'
    + '      state.zoom = zoom;'
    + '      if (old !== 0) { state.panX = state.panX * (zoom / old); state.panY = state.panY * (zoom / old); }'
    + '      c.setAttribute("data-zoom", zoom);'
    + '      c.querySelector(".mermaid-zoom-level").textContent = Math.round(zoom * 100) + "%";'
    + '      applyTransform(target, state.zoom, state.panX, state.panY);'
    + '    }'
    + '    c.querySelector(".zoom-in").addEventListener("click", function(e) {'
    + '      e.stopPropagation();'
    + '      var next = state.zoom;'
    + '      for (var i = 0; i < ZOOM_STEPS.length; i++) { if (ZOOM_STEPS[i] > state.zoom + 0.001) { next = ZOOM_STEPS[i]; break; } }'
    + '      applyZoom(next);'
    + '    });'
    + '    c.querySelector(".zoom-out").addEventListener("click", function(e) {'
    + '      e.stopPropagation();'
    + '      var next = state.zoom;'
    + '      for (var i = ZOOM_STEPS.length - 1; i >= 0; i--) { if (ZOOM_STEPS[i] < state.zoom - 0.001) { next = ZOOM_STEPS[i]; break; } }'
    + '      applyZoom(next);'
    + '    });'
    + '    c.querySelector(".mermaid-zoom-level").addEventListener("click", function(e) {'
    + '      e.stopPropagation();'
    + '      applyZoom(1);'
    + '    });'
    + '    var pan = { active: false, startX: 0, startY: 0, origPanX: 0, origPanY: 0 };'
    + '    wrap.addEventListener("mousedown", function(e) {'
    + '      if (e.button !== 0) return;'
    + '      pan.active = true;'
    + '      pan.startX = e.clientX;'
    + '      pan.startY = e.clientY;'
    + '      pan.origPanX = state.panX;'
    + '      pan.origPanY = state.panY;'
    + '      wrap.classList.add("panning");'
    + '      target.style.transition = "none";'
    + '      e.preventDefault();'
    + '    });'
    + '    document.addEventListener("mousemove", function(e) {'
    + '      if (!pan.active) return;'
    + '      state.panX = pan.origPanX + (e.clientX - pan.startX);'
    + '      state.panY = pan.origPanY + (e.clientY - pan.startY);'
    + '      applyTransform(target, state.zoom, state.panX, state.panY);'
    + '    });'
    + '    document.addEventListener("mouseup", function() {'
    + '      if (!pan.active) return;'
    + '      pan.active = false;'
    + '      wrap.classList.remove("panning");'
    + '      target.style.transition = "";'
    + '    });'
    + '    wrap.addEventListener("wheel", function(e) {'
    + '      if (!e.ctrlKey && !e.metaKey) return;'
    + '      e.preventDefault();'
    + '      var rect = wrap.getBoundingClientRect();'
    + '      var mouseX = e.clientX - rect.left;'
    + '      var mouseY = e.clientY - rect.top;'
    + '      var contentX = (mouseX - state.panX) / state.zoom;'
    + '      var contentY = (mouseY - state.panY) / state.zoom;'
    + '      var factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;'
    + '      var newZoom = Math.min(10, Math.max(0.1, state.zoom * factor));'
    + '      state.panX = mouseX - contentX * newZoom;'
    + '      state.panY = mouseY - contentY * newZoom;'
    + '      state.zoom = newZoom;'
    + '      c.setAttribute("data-zoom", newZoom);'
    + '      c.querySelector(".mermaid-zoom-level").textContent = Math.round(newZoom * 100) + "%";'
    + '      target.style.transition = "none";'
    + '      applyTransform(target, state.zoom, state.panX, state.panY);'
    + '      requestAnimationFrame(function() { target.style.transition = ""; });'
    + '    }, { passive: false });'
    + '  });'
    + '  document.getElementById("copy-confluence").addEventListener("click", function() {'
    + '    var btn = this;'
    + '    var clone = document.querySelector(".markdown-body").cloneNode(true);'
    + '    var containers = clone.querySelectorAll(".mermaid-container");'
    + '    for (var i = 0; i < containers.length; i++) {'
    + '      var code = containers[i].getAttribute("data-code") || "";'
    + '      var title = extractDiagramTitle(code);'
    + '      var placeholder = document.createElement("div");'
    + '      placeholder.setAttribute("style", "border:2px dashed #d0d7de;padding:16px;margin:16px 0;background:#f6f8fa;color:#57606a;font-family:-apple-system,sans-serif;font-size:14px;text-align:center;border-radius:6px;");'
    + '      placeholder.textContent = "[ Diagram placeholder: \\"" + title + "\\" — paste image here ]";'
    + '      containers[i].parentNode.replaceChild(placeholder, containers[i]);'
    + '    }'
    + '    var blob = new Blob([clone.innerHTML], { type: "text/html" });'
    + '    navigator.clipboard.write([new ClipboardItem({ "text/html": blob })]).then(function() { flashDone(btn); });'
    + '  });'
    + '  document.getElementById("copy-servicenow").addEventListener("click", function() {'
    + '    var btn = this;'
    + '    var clone = document.querySelector(".markdown-body").cloneNode(true);'
    + '    var containers = clone.querySelectorAll(".mermaid-container[data-png]");'
    + '    for (var i = 0; i < containers.length; i++) {'
    + '      var img = document.createElement("img");'
    + '      img.src = containers[i].getAttribute("data-png");'
    + '      img.setAttribute("width", "100%"); img.style.maxWidth = "100%"; img.style.height = "auto";'
    + '      containers[i].innerHTML = ""; containers[i].appendChild(img);'
    + '    }'
    + '    var details = clone.querySelectorAll("details");'
    + '    for (var i = 0; i < details.length; i++) {'
    + '      var d = details[i];'
    + '      var summary = d.querySelector("summary");'
    + '      var content = d.querySelector(".accordion-content");'
    + '      var frag = document.createDocumentFragment();'
    + '      if (summary) { while (summary.firstChild) frag.appendChild(summary.firstChild); }'
    + '      if (content) { while (content.firstChild) frag.appendChild(content.firstChild); }'
    + '      d.parentNode.replaceChild(frag, d);'
    + '    }'
    + '    var blob = new Blob([clone.innerHTML], { type: "text/html" });'
    + '    navigator.clipboard.write([new ClipboardItem({ "text/html": blob })]).then(function() { flashDone(btn); });'
    + '  });'
    + '})();'
    + '(function() {'
    + '  document.querySelectorAll("details").forEach(function(details) {'
    + '    var summary = details.querySelector("summary");'
    + '    var content = details.querySelector(".accordion-content");'
    + '    var animating = false;'
    + '    summary.addEventListener("click", function(e) {'
    + '      e.preventDefault();'
    + '      if (animating) return;'
    + '      if (details.open) {'
    + '        animating = true;'
    + '        content.style.height = content.scrollHeight + "px";'
    + '        content.style.overflow = "hidden";'
    + '        requestAnimationFrame(function() { requestAnimationFrame(function() {'
    + '          content.style.transition = "height 0.2s ease-in";'
    + '          content.style.height = "0px";'
    + '        }); });'
    + '        var onClose = function() {'
    + '          content.removeEventListener("transitionend", onClose);'
    + '          details.removeAttribute("open");'
    + '          content.style.cssText = "";'
    + '          animating = false;'
    + '        };'
    + '        content.addEventListener("transitionend", onClose);'
    + '      } else {'
    + '        animating = true;'
    + '        details.setAttribute("open", "");'
    + '        var endH = content.scrollHeight;'
    + '        content.style.height = "0px";'
    + '        content.style.overflow = "hidden";'
    + '        requestAnimationFrame(function() { requestAnimationFrame(function() {'
    + '          content.style.transition = "height 0.2s ease-out";'
    + '          content.style.height = endH + "px";'
    + '        }); });'
    + '        var onOpen = function() {'
    + '          content.removeEventListener("transitionend", onOpen);'
    + '          content.style.cssText = "";'
    + '          animating = false;'
    + '        };'
    + '        content.addEventListener("transitionend", onOpen);'
    + '      }'
    + '    });'
    + '  });'
    + '})();'
    + '(function() {'
    + '  var es = new EventSource("/events");'
    + '  es.onmessage = function(e) { if (e.data === "reload") location.reload(); };'
    + '  es.onerror = function() { setTimeout(function() { location.reload(); }, 1000); };'
    + '})();'
    + '<\/script>'
    + '</body></html>';
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Accordion: wrap heading sections in <details>/<summary>
// ---------------------------------------------------------------------------
function parseAccordionNodes(html) {
  var nodes = [];
  var lastIndex = 0;
  var re = /<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/g;
  var match;
  while ((match = re.exec(html)) !== null) {
    if (match.index > lastIndex) {
      nodes.push({ type: 'text', content: html.slice(lastIndex, match.index) });
    }
    nodes.push({ type: 'heading', level: parseInt(match[1]), attrs: match[2], text: match[3], full: match[0] });
    lastIndex = re.lastIndex;
  }
  if (lastIndex < html.length) {
    nodes.push({ type: 'text', content: html.slice(lastIndex) });
  }
  return nodes;
}

function renderAccordionNodes(nodes) {
  var minLevel = 7;
  for (var i = 0; i < nodes.length; i++) {
    if (nodes[i].type === 'heading' && nodes[i].level < minLevel) minLevel = nodes[i].level;
  }
  if (minLevel === 7) {
    return nodes.map(function(n) { return n.type === 'text' ? n.content : n.full; }).join('');
  }
  var result = '';
  var i = 0;
  while (i < nodes.length) {
    var node = nodes[i];
    if (node.type === 'text') {
      result += node.content;
      i++;
    } else if (node.level === minLevel) {
      var sectionNodes = [];
      i++;
      while (i < nodes.length && !(nodes[i].type === 'heading' && nodes[i].level <= minLevel)) {
        sectionNodes.push(nodes[i]);
        i++;
      }
      var inner = renderAccordionNodes(sectionNodes);
      result += '<details open><summary><h' + minLevel + node.attrs + '>' + node.text + '</h' + minLevel + '></summary>'
             + '<div class="accordion-content">' + inner + '</div></details>';
    } else {
      result += node.full;
      i++;
    }
  }
  return result;
}

function makeAccordions(html) {
  return renderAccordionNodes(parseAccordionNodes(html));
}

// ---------------------------------------------------------------------------
// SSE clients
// ---------------------------------------------------------------------------
var sseClients = [];

function addSseClient(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  res.write('data: connected\n\n');
  sseClients.push(res);
  res.on('close', function () {
    sseClients = sseClients.filter(function (c) { return c !== res; });
  });
}

function notifyClients() {
  sseClients.forEach(function (res) {
    res.write('data: reload\n\n');
  });
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
var currentHtml = buildHtml(fs.readFileSync(mdFilePath, 'utf8'));

// ---------------------------------------------------------------------------
// File watcher
// ---------------------------------------------------------------------------
var debounceTimer = null;
fs.watch(mdFilePath, function () {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(function () {
    try {
      var source = fs.readFileSync(mdFilePath, 'utf8');
      currentHtml = buildHtml(source);
      notifyClients();
      console.log('[reload] ' + new Date().toISOString());
    } catch (err) {
      console.error('Watch rebuild error:', err.message);
    }
  }, DEBOUNCE_MS);
});

// ---------------------------------------------------------------------------
// MIME types for static files
// ---------------------------------------------------------------------------
var MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.css': 'text/css', '.js': 'text/javascript',
  '.pdf': 'application/pdf',
};

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
function handler(req, res) {
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(currentHtml);
    return;
  }

  if (req.url === '/events') {
    addSseClient(res);
    return;
  }

  if (req.url.startsWith('/mermaid-png/')) {
    var hash = path.basename(req.url, '.png');
    if (pngBufferCache.has(hash)) {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
      res.end(pngBufferCache.get(hash));
      return;
    }
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  // Serve static files relative to the markdown file's directory
  var safePath = path.normalize(decodeURIComponent(req.url)).replace(/^(\.\.[/\\])+/, '');
  var filePath = path.join(mdDir, safePath);
  var ext = path.extname(filePath).toLowerCase();
  var mime = MIME[ext];

  if (mime && fs.existsSync(filePath)) {
    res.writeHead(200, { 'Content-Type': mime });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  res.writeHead(404);
  res.end('Not found');
}

function tryListen(port) {
  if (port > PORT_END) {
    console.error('All ports ' + PORT_START + '-' + PORT_END + ' in use');
    process.exit(1);
  }
  var server = http.createServer(handler);
  server.on('error', function (err) {
    if (err.code === 'EADDRINUSE') {
      console.log('Port ' + port + ' busy, trying ' + (port + 1));
      tryListen(port + 1);
    } else {
      throw err;
    }
  });
  server.listen(port, function () {
    var url = 'http://localhost:' + port;
    console.log('Serving ' + path.basename(mdFilePath) + ' at ' + url);
    try { execSync('open ' + url); } catch (_) { /* non-macOS */ }
  });
}

tryListen(PORT_START);
