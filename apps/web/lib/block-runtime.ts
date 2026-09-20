import { dsCss, type DsTheme, type DsTokens } from "./design-system";

// Codigo que roda DENTRO do iframe isolado de cada componente. Nao usa template literals de proposito
// (fica dentro de uma string TS) e conversa com o Studio so por postMessage.
const RUNTIME = [
  "(function () {",
  "  var pending = {}, seq = 0, mainFn = null, running = false;",
  "  function send(msg) { msg.__ac = 1; parent.postMessage(msg, '*'); }",
  "  function rpc(method, args) {",
  "    return new Promise(function (resolve, reject) {",
  "      var id = ++seq; pending[id] = { resolve: resolve, reject: reject };",
  "      send({ type: 'rpc', id: id, method: method, args: args });",
  "    });",
  "  }",
  "  window.addEventListener('message', function (e) {",
  "    var m = e.data; if (!m || m.__ac !== 1) return;",
  "    if (m.type === 'rpc-result') {",
  "      var p = pending[m.id]; if (!p) return; delete pending[m.id];",
  "      if (m.ok) p.resolve(m.result); else p.reject(new Error(m.error));",
  "    } else if (m.type === 'refresh') { run(); }",
  "  });",
  "  function escapeHtml(s) {",
  "    return String(s == null ? '' : s).replace(/[&<>\"']/g, function (c) {",
  "      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' }[c];",
  "    });",
  "  }",
  "  function report(level, text) { send({ type: 'log', level: level, text: text }); }",
  "  ['log', 'info', 'warn', 'error'].forEach(function (k) {",
  "    var orig = console[k];",
  "    console[k] = function () {",
  "      report(k === 'error' ? 'error' : 'log', Array.prototype.map.call(arguments, function (a) {",
  "        try { return typeof a === 'string' ? a : JSON.stringify(a); } catch (e) { return String(a); }",
  "      }).join(' '));",
  "      try { orig.apply(console, arguments); } catch (e) {}",
  "    };",
  "  });",
  "  function showError(err) {",
  "    var text = err && err.message ? err.message : String(err);",
  "    var box = document.getElementById('ac-error');",
  "    if (!box) { box = document.createElement('div'); box.id = 'ac-error'; box.className = 'ac-error'; document.body.appendChild(box); }",
  "    box.textContent = 'Erro: ' + text;",
  "    report('error', text);",
  "  }",
  "  function clearError() { var box = document.getElementById('ac-error'); if (box) box.remove(); }",
  "  function records(name) {",
  "    return {",
  "      list: function (p) { return rpc('data.list', [name, p || {}]); },",
  "      create: function (body) { return rpc('data.create', [name, body || {}]); },",
  "      update: function (id, body) { return rpc('data.update', [name, id, body || {}]); },",
  "      remove: function (id) { return rpc('data.remove', [name, id]); }",
  "    };",
  "  }",
  "  var ctx = {",
  "    root: document.getElementById('root'),",
  "    escape: escapeHtml,",
  "    config: window.__acConfig || {},",
  "    records: records,",
  "    data: {",
  "      list: function (r, p) { return rpc('data.list', [r, p || {}]); },",
  "      create: function (r, body) { return rpc('data.create', [r, body || {}]); },",
  "      update: function (r, id, body) { return rpc('data.update', [r, id, body || {}]); },",
  "      remove: function (r, id) { return rpc('data.remove', [r, id]); }",
  "    },",
  "    tool: function (name, args) { return rpc('tool.call', [name, args || {}]); },",
  "    agent: { run: function (key, input) { return rpc('agent.run', [String(key), input == null ? '' : String(input)]); } },",
  "    inbox: function () { return rpc('inbox.get', []); },",
  "    store: {",
  "      get: function (key, fallback) { return rpc('store.get', [String(key)]).then(function (v) { return v === null || v === undefined ? fallback : v; }); },",
  "      set: function (key, value) { return rpc('store.set', [String(key), value === undefined ? null : value]); },",
  "      remove: function (key) { return rpc('store.remove', [String(key)]); },",
  "      all: function () { return rpc('store.all', []); }",
  "    },",
  "    ui: {",
  "      modal: function (opts) { return rpc('ui.modal', [opts || {}]); },",
  "      confirm: function (message, opts) { return rpc('ui.confirm', [String(message), opts || {}]); },",
  "      toast: function (message, kind) { return rpc('ui.toast', [String(message), kind || 'info']); }",
  "    },",
  "    close: function (value) { return rpc('ui.close', [value === undefined ? null : value]); },",
  "    refresh: function () { return run(); },",
  "    main: function (fn) { mainFn = fn; }",
  "  };",
  "  window.studio = ctx;",
  "  function reportSize() {",
  "    var r = document.getElementById('root');",
  "    if (r) send({ type: 'size', height: Math.ceil(r.getBoundingClientRect().height) + 24 });",
  "  }",
  "  if (window.ResizeObserver) { new ResizeObserver(reportSize).observe(document.getElementById('root')); }",
  "  async function run() {",
  "    if (!mainFn || running) return;",
  "    running = true;",
  "    try { clearError(); await mainFn(ctx); } catch (err) { showError(err); } finally { running = false; reportSize(); }",
  "  }",
  "  window.addEventListener('error', function (e) { showError(e.error || e.message); });",
  "  window.addEventListener('unhandledrejection', function (e) { showError(e.reason); });",
  "  document.addEventListener('click', function (e) { var a = e.target && e.target.closest && e.target.closest('a'); if (a) e.preventDefault(); });",
  "  window.__acStart = function () { run(); };",
  "})();",
].join("\n");

function scriptSafe(js: string): string {
  return js.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");
}

function styleSafe(css: string): string {
  return css.replace(/<\/style/gi, "<\\/style");
}

export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Documento do iframe. A CSP fecha a rede (connect-src 'none', sem imagens externas) e so deixa rodar os
 * <script> com o nonce -- ou seja, so o runtime e o js do componente; o HTML dele nao injeta script nem handlers inline.
 */
export function buildSrcDoc(block: { html: string; css: string; js: string; config?: Record<string, unknown> }, nonce: string, theme: DsTheme = "light", tokens?: DsTokens): string {
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "font-src data:",
    "media-src data:",
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  const config = JSON.stringify(block.config ?? {}).replace(/</g, "\\u003c");
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    `<style>${dsCss(theme, tokens)}</style><style>${styleSafe(block.css)}</style></head>` +
    `<body><div id="root">${block.html}</div>` +
    `<script nonce="${nonce}">window.__acConfig=${config};</script>` +
    `<script nonce="${nonce}">${RUNTIME}</script>` +
    `<script nonce="${nonce}">${scriptSafe(block.js)}</script>` +
    `<script nonce="${nonce}">window.__acStart&&window.__acStart()</script></body></html>`
  );
}
