// Teste de instalacao NOVA: sobe um servidor separado (porta 5197) com banco e pasta de dados vazios e confere que o padrao de
// fabrica (bibliotecas, componentes, paginas, colecoes) veio instalado e aprovado, e que uma segunda subida nao duplica nada.
// Nao toca no seu banco nem no .env. Uso: node scripts/test-factory.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 5197;
const S = `http://localhost:${PORT}`;
const tmp = mkdtempSync(join(tmpdir(), "ac-factory-"));
const mcpConfig = join(tmp, "mcp.json");
writeFileSync(mcpConfig, JSON.stringify({ mcpServers: {} }));

let failures = 0;
const check = (n, c, x = "") => {
  console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  -> " + String(x).slice(0, 200) : ""}`);
  if (!c) failures++;
};
const get = async (p) => (await fetch(S + p)).json();

async function boot() {
  const child = spawn(process.execPath, [join(root, "packages/server/node_modules/ts-node/dist/bin.js"), "--transpile-only", "src/main.ts"], {
    cwd: join(root, "packages/server"),
    // chaves vazias: o dotenv nao sobrescreve variaveis ja definidas, entao esta instancia nunca usa as chaves reais do .env
    env: { ...process.env, DATA_DIR: join(tmp, "data"), SERVER_PORT: String(PORT), AGENT_CANVAS_MCP_CONFIG: mcpConfig, GROQ_API_KEY: "", GEMINI_API_KEY: "", ANTHROPIC_API_KEY: "", GOOGLE_OAUTH_CLIENT_ID: "", GOOGLE_OAUTH_CLIENT_SECRET: "", USER_GOOGLE_EMAIL: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      if ((await fetch(S + "/health")).ok) return { child, log: () => log };
    } catch {
      // ainda subindo
    }
  }
  child.kill();
  throw new Error("o servidor de teste nao subiu em 90 s:\n" + log.slice(-800));
}

const stop = (child) => new Promise((res) => { child.once("exit", res); child.kill(); setTimeout(res, 3000); });
let srv;
try {
  srv = await boot();
  await new Promise((r) => setTimeout(r, 1500)); // o padrao de fabrica roda logo apos a subida
  const f = await get("/factory");
  check("fabrica: todos os pacotes do padrao existem na biblioteca", f.packages.length >= 5 && f.packages.every((p) => p.available), JSON.stringify(f.packages.filter((p) => !p.available)));
  check("fabrica: todos vieram instalados", f.packages.every((p) => p.installed), JSON.stringify(f.packages.filter((p) => !p.installed)));
  check("fabrica: marcou como concluido (nao reinstala sozinho de novo)", f.done === true);

  const blocks = await get("/blocks");
  const pages = await get("/pages");
  const cols = await get("/collections");
  const canvases = await get("/canvases");
  check("componentes de fabrica: todos aprovados (codigo do repositorio)", blocks.length >= 16 && blocks.every((b) => b.approved === true), `${blocks.length} componentes, nao aprovados: ${blocks.filter((b) => !b.approved).map((b) => b.name).join(", ")}`);
  check("componentes de fabrica: sem avisos de lint", (await Promise.all(blocks.map(async (b) => (await get(`/blocks/${b.id}/lint`)).length ?? 0))).every((n) => n === 0));
  check("paginas de fabrica: Rotina e a primeira (inicial)", pages[0]?.name === "Rotina", pages.map((p) => p.name).join(", "));
  const nomes = pages.map((p) => p.name);
  check("paginas de fabrica: Rotina, Estudo, Kanban Google, Saude, Kanban e Workspace", ["Rotina", "Estudo", "Kanban Google", "Saúde", "Kanban", "Workspace"].every((n) => nomes.includes(n)), nomes.join(", "));
  const esperadas = ["rotina_habitos", "rotina_checkins", "rotina_tarefas", "rotina_diario", "estudo_materias", "estudo_sessoes", "estudo_cartoes", "saude_agua", "kanban_google_estado", "kanban_cartoes", "sistema_lembretes"];
  check("colecoes de fabrica criadas", esperadas.every((n) => cols.some((c) => c.name === n)), esperadas.filter((n) => !cols.some((c) => c.name === n)).join(", "));
  check("canvases de fabrica (planejador do Kanban, resumo do dia)", canvases.length >= 2, canvases.map((c) => c.name).join(", "));
  const ids = new Set(blocks.map((b) => b.id));
  check("paginas so apontam para componentes que existem", pages.every((p) => p.layout.filter((i) => i.kind === "block").every((i) => ids.has(i.blockId))));

  // segunda subida com o mesmo banco: nao duplica
  const antes = { blocks: blocks.length, pages: pages.length };
  await stop(srv.child);
  srv = await boot();
  await new Promise((r) => setTimeout(r, 1500));
  const depois = { blocks: (await get("/blocks")).length, pages: (await get("/pages")).length };
  check("segunda subida nao duplica componentes nem paginas", antes.blocks === depois.blocks && antes.pages === depois.pages, `${JSON.stringify(antes)} -> ${JSON.stringify(depois)}`);

  // restaurar padrao de fabrica e idempotente
  const r = await (await fetch(S + "/factory/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json();
  check("restaurar padrao de fabrica: nada a reinstalar quando ja esta tudo", r.installed.length === 0 && r.already.length >= 5 && r.failed.length === 0, JSON.stringify(r));
} catch (err) {
  check("teste de instalacao nova", false, err instanceof Error ? err.message : String(err));
} finally {
  if (srv) await stop(srv.child);
  rmSync(tmp, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} FALHA(S)` : "\nTODOS OS TESTES PASSARAM");
process.exit(failures ? 1 : 0);
