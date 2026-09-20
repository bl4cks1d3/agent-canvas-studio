// Gera apps/web/public/<saida>.html: roda um componente do Studio num iframe SAME-ORIGIN (so para teste) com a ponte
// falando com o servidor de verdade, para clicar/inspecionar o DOM do componente (e dos modais) pelo navegador.
//
// Uso (a partir de packages/server; o servidor precisa estar no ar):
//   ./node_modules/.bin/ts-node --transpile-only --compiler-options '{"module":"commonjs","target":"es2022","moduleResolution":"node"}' ../../scripts/block-harness.ts "<nome do componente>" _harness-x.html
// Apague o _harness-*.html depois (esta no .gitignore).
// Depois abra http://localhost:5200/_harness-x.html e use javascript_tool:
//   const d = document.getElementById('f').contentDocument;   // DOM do componente
//   window.__logs / window.__toasts / window.__rpc            // erros, avisos e chamadas da ponte
//   window.__answers.push(valor)                              // resposta pronta para o PROXIMO ctx.ui.modal (senao abre o modal de verdade em iframe.modal)
//   document.querySelector('iframe.modal').contentDocument    // DOM do modal aberto
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSrcDoc, newNonce } from "../apps/web/lib/block-runtime";

const esc = (s: string) => s.split("</").join("<\\/");

async function main() {
  const name = process.argv[2] ?? "";
  const outName = process.argv[3] ?? "_harness.html";
  const blocks = (await (await fetch("http://localhost:5100/blocks")).json()) as Array<{ id: string; name: string; html: string; css: string; js: string; permissions: { read: string[]; write: string[]; tools: string[]; agents: string[] }; config: Record<string, unknown> }>;
  const block = blocks.find((b) => b.name === name || b.id === name);
  if (!block) throw new Error("componente nao encontrado: " + name + " / " + blocks.map((b) => b.name).join(", "));
  const tokens = (await (await fetch("http://localhost:5100/theme")).json()) as { accent: string; radius: number; fontSize: number; density: "compact" | "comfortable" };
  const srcdoc = buildSrcDoc(block, newNonce(), "dark", tokens);
  const modalTpl = buildSrcDoc({ html: "__HTML__", css: "__CSS__", js: "__JS__", config: block.config }, newNonce(), "dark", tokens);
  const page = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#1b1c20"><iframe id="f" style="width:1000px;height:600px;border:0" sandbox="allow-scripts allow-same-origin"></iframe>
<script>
const SERVER = "http://localhost:5100";
const block = ${JSON.stringify({ id: block.id, permissions: block.permissions, config: block.config })};
window.__toasts = []; window.__logs = []; window.__modals = []; window.__answers = []; window.__rpc = []; window.__confirm = true;
const f = document.getElementById("f");
f.srcdoc = ${esc(JSON.stringify(srcdoc))};
const MODAL_TPL = ${esc(JSON.stringify(modalTpl))};
const modalResolvers = new Map();
async function api(path, init) { const r = await fetch(SERVER + path, { ...init, headers: { "Content-Type": "application/json" } }); const b = await r.json().catch(() => ({})); if (!r.ok) throw new Error(Array.isArray(b.message) ? b.message.join("; ") : b.message || r.status); return b; }
const has = (l, x) => l.includes(x);
function openModal(o) {
  return new Promise((resolve) => {
    const fr = document.createElement("iframe"); fr.className = "modal"; fr.setAttribute("sandbox", "allow-scripts allow-same-origin");
    fr.style.cssText = "position:fixed;left:1010px;top:0;width:" + (o.width || 420) + "px;height:600px;border:1px solid #888;background:#1b1c20";
    fr.srcdoc = MODAL_TPL.split("__HTML__").join(o.html || "").split("__CSS__").join(o.css || "").split("__JS__").join(o.js || "");
    document.body.appendChild(fr); modalResolvers.set(fr.contentWindow, { fr, resolve });
    setTimeout(() => modalResolvers.set(fr.contentWindow, { fr, resolve }), 50);
  });
}
async function bridge(method, a, src) {
  const p = block.permissions;
  if (method === "data.list") { if (!has(p.read, "col:" + a[0]) && !has(p.write, "col:" + a[0])) throw new Error("sem permissao ler " + a[0]); const qs = new URLSearchParams(a[1] || {}).toString(); return api("/collections/" + a[0] + "/records" + (qs ? "?" + qs : "")); }
  if (method === "data.create") { if (!has(p.write, "col:" + a[0])) throw new Error("sem permissao gravar"); return api("/collections/" + a[0] + "/records", { method: "POST", body: JSON.stringify(a[1]) }); }
  if (method === "data.update") { if (!has(p.write, "col:" + a[0])) throw new Error("sem permissao gravar"); return api("/collections/" + a[0] + "/records/" + a[1], { method: "PATCH", body: JSON.stringify(a[2]) }); }
  if (method === "data.remove") { if (!has(p.write, "col:" + a[0])) throw new Error("sem permissao gravar"); return api("/collections/" + a[0] + "/records/" + a[1], { method: "DELETE" }); }
  if (method === "tool.call") { if (!has(p.tools, a[0])) throw new Error("sem permissao ferramenta " + a[0]); return (await api("/tools/call", { method: "POST", body: JSON.stringify({ name: a[0], args: a[1] }) })).result; }
  if (method === "agent.run") { const id = (block.config.agents || {})[a[0]] || a[0]; if (!has(p.agents, "*") && !has(p.agents, id)) throw new Error("sem permissao agente"); let run = await api("/canvases/" + id + "/run", { method: "POST", body: JSON.stringify({ mode: window.__agentMode || "live", input: a[1], confirmed: true }) }); while (run.status === "running") { await new Promise(r => setTimeout(r, 700)); run = await api("/runs/" + run.id); } return { status: run.status, result: run.result || "", error: run.error, nodes: [] }; }
  if (method === "inbox.get") return (await api("/blocks/" + block.id + "/inbox")).items;
  if (method === "store.get") { const all = await api("/blocks/" + block.id + "/state"); return all[a[0]] ?? null; }
  if (method === "store.all") return api("/blocks/" + block.id + "/state");
  if (method === "store.set") { await api("/blocks/" + block.id + "/state/" + encodeURIComponent(a[0]), { method: "PUT", body: JSON.stringify({ value: a[1] }) }); return true; }
  if (method === "store.remove") { await api("/blocks/" + block.id + "/state/" + encodeURIComponent(a[0]), { method: "DELETE" }); return true; }
  if (method === "ui.toast") { window.__toasts.push(a[0] + "|" + a[1]); return true; }
  if (method === "ui.confirm") return window.__confirm;
  if (method === "ui.close") { const m = modalResolvers.get(src); if (!m) throw new Error("ctx.close so existe dentro de um modal"); modalResolvers.delete(src); m.fr.remove(); m.resolve(a[0] ?? null); return true; }
  if (method === "ui.modal") { window.__modals.push(a[0]); if (window.__answers.length) { const ans = window.__answers.shift(); return ans === undefined ? null : ans; } return openModal(a[0] || {}); }
  throw new Error("metodo " + method);
}
window.addEventListener("message", async (e) => {
  const m = e.data; if (!m || m.__ac !== 1) return;
  const isMain = e.source === f.contentWindow;
  const isModal = [...document.querySelectorAll("iframe.modal")].some((x) => x.contentWindow === e.source);
  if (!isMain && !isModal) return;
  if (m.type === "log") window.__logs.push(m.level + ": " + m.text);
  if (m.type !== "rpc") return;
  window.__rpc.push(m.method);
  try { const result = await bridge(m.method, m.args, e.source); e.source.postMessage({ __ac: 1, type: "rpc-result", id: m.id, ok: true, result }, "*"); }
  catch (err) { window.__logs.push("rpc-erro " + m.method + ": " + err.message); try { e.source.postMessage({ __ac: 1, type: "rpc-result", id: m.id, ok: false, error: err.message }, "*"); } catch (_) {} }
});
</script>`;
  writeFileSync(resolve(__dirname, "../apps/web/public", outName), page);
  console.log("ok " + block.id + " -> http://localhost:5200/" + outName);
}
void main();
