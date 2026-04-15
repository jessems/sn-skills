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
const MMDC = '/Users/jmscdch/.nvm/versions/node/v22.17.0/bin/mmdc';

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
  var htmlBody = md.render(result.cleaned);
  var enrichedBlocks = renderAllPngs(result.blocks);

  // Replace placeholders with dual containers
  enrichedBlocks.forEach(function (b, i) {
    var placeholder = '<!--MERMAID_PLACEHOLDER_' + (i + 1) + '-->';
    var pngDataAttr = b.png ? ' data-png="' + b.png + '"' : '';
    var pngUrlAttr = b.hash ? ' data-png-url="/mermaid-png/' + b.hash + '.png"' : '';
    var codeAttr = ' data-code="' + escapeHtml(b.code) + '"';
    var diagramHtml = '<div class="mermaid-container"' + pngDataAttr + pngUrlAttr + codeAttr + '>'
      + '<pre class="mermaid">' + escapeHtml(b.code) + '</pre></div>';
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
    + '.copy-btns { position: fixed; top: 12px; right: 12px; z-index: 1000; display: flex; flex-direction: column; gap: 6px; }'
    + '.copy-btns button { padding: 6px 14px; border: 1px solid #d0d7de; border-radius: 6px; '
    + '  background: #f6f8fa; cursor: pointer; font-size: 13px; font-family: -apple-system, sans-serif; '
    + '  box-shadow: 0 1px 3px rgba(0,0,0,0.08); transition: background 0.15s; white-space: nowrap; }'
    + '.copy-btns button:hover { background: #eaeef2; }'
    + '.copy-btns button svg { vertical-align: -2px; margin-right: 5px; }'
    + '</style>'
    + '</head><body>'
    + '<div class="copy-btns">'
    + '<button id="copy-confluence"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>Copy for Confluence</button>'
    + '<button id="copy-servicenow"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>Copy for ServiceNow</button>'
    + '</div>'
    + '<article class="markdown-body">'
    + htmlBody
    + '</article>'
    + '<script>'
    + 'mermaid.initialize({ startOnLoad: true, theme: "default" });'
    + '(function() {'
    + '  var clipIcon = \'<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>\';'
    + '  var checkIcon = \'<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1a7f37" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>\';'
    + '  function flashDone(btn, label) {'
    + '    btn.innerHTML = checkIcon + "Copied!";'
    + '    setTimeout(function() { btn.innerHTML = clipIcon + label; }, 1500);'
    + '  }'
    + '  function extractDiagramTitle(code) {'
    + '    var yamlMatch = code.match(/^---[\\s\\S]*?title:\\s*(.+?)[\\s\\S]*?---/m);'
    + '    if (yamlMatch) return yamlMatch[1].trim();'
    + '    var titleMatch = code.match(/^\\s*title[\\s:]+(.+)/im);'
    + '    if (titleMatch) return titleMatch[1].trim();'
    + '    return code.trim().split("\\n")[0].trim() || "Diagram";'
    + '  }'
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
    + '    navigator.clipboard.write([new ClipboardItem({ "text/html": blob })]).then(function() { flashDone(btn, "Copy for Confluence"); });'
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
    + '    var blob = new Blob([clone.innerHTML], { type: "text/html" });'
    + '    navigator.clipboard.write([new ClipboardItem({ "text/html": blob })]).then(function() { flashDone(btn, "Copy for ServiceNow"); });'
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
