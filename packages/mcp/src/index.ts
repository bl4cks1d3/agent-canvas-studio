import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { GUIDE } from "./guide.js";
import { STUDIO_GUIDE } from "./studio-guide.js";

// stdout e o protocolo MCP: qualquer log vai para stderr.
const log = (...args: unknown[]) => console.error("[agent-canvas-mcp]", ...args);

const SERVER = (process.env.AGENT_CANVAS_URL ?? "http://localhost:5100").replace(/\/$/, "");
const MAX_OUTPUT = 60_000;
const enc = encodeURIComponent;
type Args = Record<string, unknown>;

async function api(method: string, path: string, body?: unknown): Promise<any> {
  let res: Response;
  try {
    res = await fetch(`${SERVER}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    throw new Error(`O servidor do Agent Canvas não responde em ${SERVER}. Suba-o com "pnpm dev" (ou "pnpm dev:server"). (${err instanceof Error ? err.message : err})`);
  }
  const raw = await res.text();
  let parsed: any = raw;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    // texto puro
  }
  if (!res.ok) {
    const message = parsed?.message;
    throw new Error(Array.isArray(message) ? message.join("; ") : (message ?? `HTTP ${res.status}: ${raw.slice(0, 300)}`));
  }
  return parsed;
}

const summarize = (c: any) => ({
  id: c.id,
  name: c.name,
  origem: c.source,
  nos: c.nodes.length,
  fios: c.edges.length,
  agentes: c.nodes.filter((n: any) => n.type.startsWith("agent.")).map((n: any) => n.name),
  ...(c.lastRunAt ? { ultimaExecucao: `${c.lastRunAt} (${c.lastStatus})` } : {}),
});

const summarizeRun = (run: any) => ({
  id: run.id,
  status: run.status,
  modo: run.mode === "dry" ? "simulacao" : "real",
  ...(run.result ? { resultado: String(run.result).slice(0, 1500) } : {}),
  ...(run.error ? { erro: run.error } : {}),
  nos: run.nodes.map((n: any) => ({
    no: `${n.name} (${n.nodeId})`,
    status: n.status,
    entrou: n.itemsIn,
    saiu: n.itemsOut,
    ...(n.steps ? { passos: n.steps } : {}),
    ...(n.toolsUsed?.length ? { ferramentas: n.toolsUsed } : {}),
    ...(n.error ? { erro: n.error } : {}),
    ...(n.warnings?.length ? { avisos: n.warnings } : {}),
  })),
});

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Args) => Promise<unknown>;
}

const summarizeBlock = (b: any) => ({
  id: b.id,
  nome: b.name,
  origem: b.source,
  aprovado: b.approved,
  ...(b.packageId ? { pacote: b.packageId } : {}),
  permissoes: b.permissions,
  tamanho: `${b.html.length + b.css.length + b.js.length} caracteres`,
  ...(b.warnings?.length ? { warnings: b.warnings } : {}),
});

const summarizePage = (p: any) => ({
  id: p.id,
  nome: p.name,
  itens: p.layout.map((i: any) => (i.kind === "heading" ? `título "${i.text}" [x${i.x} y${i.y} ${i.w}x${i.h}]` : `componente ${i.blockId} [x${i.x} y${i.y} ${i.w}x${i.h}]`)),
});

const PERMISSIONS_SCHEMA = {
  type: "object",
  description: "{read:['col:x'], write:['col:x'], tools:['nome_exato'], agents:['idDoCanvas'|'*']}",
  properties: { read: { type: "array", items: { type: "string" } }, write: { type: "array", items: { type: "string" } }, tools: { type: "array", items: { type: "string" } }, agents: { type: "array", items: { type: "string" } } },
};

const STUDIO_TOOLS: ToolDef[] = [
  {
    name: "studio_guide",
    description: "Guia do Studio: como construir dashboards, componentes visuais (HTML/CSS/JS), dados persistentes, design system e paginas. LEIA antes de criar qualquer componente.",
    inputSchema: { type: "object", properties: {} },
    run: async () => STUDIO_GUIDE,
  },
  {
    name: "list_collections",
    description: "Lista as colecoes (tabelas do banco do Studio): nome, campos e numero de registros.",
    inputSchema: { type: "object", properties: {} },
    run: async () => (await api("GET", "/collections")).map((c: any) => ({ nome: c.name, titulo: c.label, campos: c.fields.map((f: any) => `${f.name}:${f.type}${f.required ? "*" : ""}${f.options ? `(${f.options.join("|")})` : ""}`), registros: c.records })),
  },
  {
    name: "save_collection",
    description: "Cria a colecao (ou atualiza titulo/campos se ja existir). fields: [{name, type: text|longtext|number|date|boolean|select, label?, required?, options? (select)}]. Os dados persistem no banco.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" }, label: { type: "string" }, description: { type: "string" }, fields: { type: "array", items: { type: "object" } } },
      required: ["name", "fields"],
    },
    run: async (a) => {
      const exists = (await api("GET", "/collections")).some((c: any) => c.name === a.name);
      const body = { name: a.name, label: a.label, description: a.description, fields: a.fields };
      return exists ? api("PATCH", `/collections/${enc(String(a.name))}`, body) : api("POST", "/collections", body);
    },
  },
  {
    name: "list_records",
    description: "Lista registros de uma colecao. Filtros: q (busca), where (igualdade por campo), sort, order (asc|desc), limit.",
    inputSchema: { type: "object", properties: { collection: { type: "string" }, q: { type: "string" }, where: { type: "object" }, sort: { type: "string" }, order: { type: "string" }, limit: { type: "number" } }, required: ["collection"] },
    run: async (a) => {
      const params = new URLSearchParams();
      for (const k of ["q", "sort", "order", "limit"]) if (a[k] !== undefined) params.set(k, String(a[k]));
      for (const [k, v] of Object.entries((a.where ?? {}) as Record<string, unknown>)) params.set(k, String(v));
      return api("GET", `/collections/${enc(String(a.collection))}/records?${params}`);
    },
  },
  {
    name: "save_record",
    description: "Cria (sem recordId) ou atualiza (com recordId; null limpa um campo) um registro. Use para dados de exemplo ou quando o usuario pedir para registrar algo.",
    inputSchema: { type: "object", properties: { collection: { type: "string" }, recordId: { type: "string" }, data: { type: "object" } }, required: ["collection", "data"] },
    run: async (a) =>
      a.recordId
        ? api("PATCH", `/collections/${enc(String(a.collection))}/records/${enc(String(a.recordId))}`, a.data)
        : api("POST", `/collections/${enc(String(a.collection))}/records`, a.data),
  },
  {
    name: "delete_record",
    description: "Exclui um registro de uma colecao (so quando o usuario pedir).",
    inputSchema: { type: "object", properties: { collection: { type: "string" }, recordId: { type: "string" } }, required: ["collection", "recordId"] },
    run: (a) => api("DELETE", `/collections/${enc(String(a.collection))}/records/${enc(String(a.recordId))}`),
  },
  {
    name: "list_blocks",
    description: "Lista os componentes visuais (nome, origem, aprovado, permissoes).",
    inputSchema: { type: "object", properties: {} },
    run: async () => (await api("GET", "/blocks")).map(summarizeBlock),
  },
  {
    name: "get_block",
    description: "Le o codigo (html, css, js) e as permissoes de um componente. Para alterar: edite e envie com save_block (id + campos).",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    run: (a) => api("GET", `/blocks/${enc(String(a.id))}`),
  },
  {
    name: "save_block",
    description:
      "Cria (sem id) ou atualiza (com id; envie so o que muda) um componente visual: name, description, html, css, js (studio.main(async ctx => ...)), permissions, refreshSeconds, versionNote. Fica AGUARDANDO APROVACAO do usuario. A resposta traz warnings de design/dados/isolamento: corrija ate ficar sem nenhum. Leia studio_guide antes.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        html: { type: "string" },
        css: { type: "string" },
        js: { type: "string" },
        permissions: PERMISSIONS_SCHEMA,
        refreshSeconds: { type: "number" },
        versionNote: { type: "string", description: "o que mudou (vai para o historico de versoes)" },
      },
      required: [],
    },
    run: async (a) => {
      const { id, ...rest } = a as Args;
      const body = { ...rest, source: "agent" };
      const saved = id ? await api("PUT", `/blocks/${enc(String(id))}`, body) : await api("POST", "/blocks", body);
      return { ...summarizeBlock(saved), proximoPasso: saved.warnings?.length ? "Corrija os warnings e salve de novo." : "Coloque o componente numa pagina (save_page/place_block) e avise o usuario que precisa aprova-lo." };
    },
  },
  {
    name: "delete_block",
    description: "Exclui um componente (e o historico dele). Use so a pedido do usuario ou para limpar duplicatas que voce mesmo criou.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    run: (a) => api("DELETE", `/blocks/${enc(String(a.id))}`),
  },
  {
    name: "block_versions",
    description: "Historico de versoes do design/codigo de um componente (para entender o que mudou).",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    run: (a) => api("GET", `/blocks/${enc(String(a.id))}/versions`),
  },
  {
    name: "list_pages",
    description: "Lista as paginas do dashboard e a organizacao (grade de 12 colunas) de cada uma.",
    inputSchema: { type: "object", properties: {} },
    run: async () => (await api("GET", "/pages")).map(summarizePage),
  },
  {
    name: "save_page",
    description:
      "Cria (sem id) ou substitui (com id) uma pagina do dashboard. layout: [{kind:'heading', text, x, y, w, h}, {kind:'block', blockId, x, y, w, h}]. Grade de 12 colunas, linha de 40 px; sem sobreposicao. O usuario reorganiza depois arrastando.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, name: { type: "string" }, layout: { type: "array", items: { type: "object" } } },
      required: ["name", "layout"],
    },
    run: async (a) => summarizePage(a.id ? await api("PUT", `/pages/${enc(String(a.id))}`, { name: a.name, layout: a.layout }) : await api("POST", "/pages", { name: a.name, layout: a.layout })),
  },
  {
    name: "place_block",
    description: "Acrescenta um componente no fim de uma pagina existente (w padrao 6, h padrao 9).",
    inputSchema: { type: "object", properties: { pageId: { type: "string" }, blockId: { type: "string" }, w: { type: "number" }, h: { type: "number" } }, required: ["pageId", "blockId"] },
    run: async (a) => summarizePage(await api("POST", `/pages/${enc(String(a.pageId))}/place`, { blockId: a.blockId, w: a.w, h: a.h })),
  },
  {
    name: "delete_page",
    description: "Exclui uma pagina do dashboard (os componentes continuam existindo).",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    run: (a) => api("DELETE", `/pages/${enc(String(a.id))}`),
  },
  {
    name: "list_packages",
    description: "Lista os pacotes da biblioteca (instalados ou nao) e as conexoes que cada um pede. Traz tambem um exemplo do formato de manifesto para save_package.",
    inputSchema: { type: "object", properties: {} },
    run: async () => ({
      pacotes: (await api("GET", "/packages")).map((p: any) => ({ id: p.id, nome: p.name, instalado: p.installed, pronto: p.ready, conexoes: p.connections.map((c: any) => `${c.label}: ${c.status}`) })),
      exemplo: {
        id: "meu-pacote",
        name: "Meu pacote",
        description: "…",
        category: "produtividade",
        version: "1.0.0",
        requires: [{ id: "ia", kind: "ai", label: "Provedor de IA", optional: true }, { id: "agenda", kind: "tool", label: "Listar eventos", hint: "…", match: ["calendar"], optional: true }],
        collections: [{ name: "x_itens", label: "Itens", fields: [{ name: "titulo", type: "text", required: true }] }],
        blocks: [{ key: "lista", name: "Lista", html: "…", css: "…", js: "studio.main(async ctx => {…})", permissions: { read: ["col:x_itens"], write: ["col:x_itens"], tools: ["@agenda"], agents: ["assistente"] } }],
        canvases: [{ key: "assistente", name: "Assistente", nodes: [], edges: [] }],
        pages: [{ name: "Itens", layout: [{ blockKey: "lista", x: 0, y: 0, w: 12, h: 10 }] }],
        seed: { x_itens: [{ titulo: "Exemplo" }] },
      },
    }),
  },
  {
    name: "save_package",
    description: "Salva um pacote na biblioteca (NAO instala: use install_package para criar de fato colecoes, componentes e paginas). Erros de validacao voltam para corrigir. Use quando o usuario pedir algo reutilizavel/instalavel.",
    inputSchema: { type: "object", properties: { package: { type: "object", description: "manifesto completo (veja list_packages → exemplo)" } }, required: ["package"] },
    run: async (a) => api("POST", "/packages", { ...(a.package as object), source: "agent" }),
  },
  {
    name: "install_package",
    description:
      "Instala um pacote da biblioteca: cria as colecoes (reaproveita as que ja existem, com os dados), os componentes, as paginas do dashboard e os canvases dele. Componentes de pacote criado por voce ficam AGUARDANDO a aprovacao do usuario (nunca aprove). Diga ao usuario o que instalou, as conexoes pendentes e o que ele precisa aprovar.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "id do pacote (veja list_packages)" } }, required: ["id"] },
    run: async (a) => {
      const p = await api("POST", `/packages/${enc(String(a.id))}/install`);
      return { id: p.id, nome: p.name, instalado: p.installed, pronto: p.ready, componentes: p.blockIds?.length ?? p.counts?.blocks, paginas: p.pageIds, conexoes: p.connections?.map((c: any) => `${c.label}: ${c.status}`), proximoPasso: "Peca ao usuario para aprovar os componentes (aba Componentes) e abrir a pagina no Dashboard." };
    },
  },
  {
    name: "uninstall_package",
    description: "Desinstala um pacote (remove componentes, paginas e canvases dele; dropData=true apaga tambem as colecoes e os DADOS). So quando o usuario pedir.",
    inputSchema: { type: "object", properties: { id: { type: "string" }, dropData: { type: "boolean" } }, required: ["id"] },
    run: (a) => api("DELETE", `/packages/${enc(String(a.id))}?dropData=${a.dropData === true}`),
  },
  {
    name: "get_theme",
    description: "Le o tema do Studio (cor de destaque, cantos, fonte, densidade) que vale para todos os componentes.",
    inputSchema: { type: "object", properties: {} },
    run: () => api("GET", "/theme"),
  },
  {
    name: "set_theme",
    description: "Altera o tema do Studio (accent #rrggbb ou vazio, radius 0-24, fontSize 11-18, density compact|comfortable). So quando o usuario pedir mudanca de visual.",
    inputSchema: { type: "object", properties: { accent: { type: "string" }, radius: { type: "number" }, fontSize: { type: "number" }, density: { type: "string" } } },
    run: (a) => api("PUT", "/theme", a),
  },
];

// ---------------------------------------------------------------- ferramentas externas (servidores MCP conectados AO APP: Google Workspace etc.)
// O Claude do terminal so enxerga este MCP. Estas ferramentas dao acesso ao que o app ja tem conectado, pela mesma camada dos agentes
// (conta Google ja preenchida, argumentos conferidos). So ferramentas mcp__* (nunca as do proprio Studio, que ja existem acima).

interface ExternalTool {
  name: string;
  description: string;
  params: string[];
  required: string[];
  source: string;
  readOnly: boolean;
}

async function externalTools(): Promise<ExternalTool[]> {
  const all = (await api("GET", "/tools")) as ExternalTool[];
  return all.filter((t) => t.name.startsWith("mcp__") && t.source.startsWith("mcp:"));
}

async function callExternal(a: Args, onlyRead: boolean): Promise<unknown> {
  const name = String(a.name ?? "");
  const tool = (await externalTools()).find((t) => t.name === name);
  if (!tool) throw new Error(`ferramenta externa desconhecida: ${name}. Use list_external_tools para ver as disponiveis.`);
  if (onlyRead && !tool.readOnly) throw new Error(`${name} altera dados (nao e so leitura): use call_external_tool, que pede a confirmacao do usuario.`);
  const args = a.args && typeof a.args === "object" && !Array.isArray(a.args) ? (a.args as Args) : {};
  return (await api("POST", "/tools/call", { name, args })).result;
}

const EXTERNAL_ARGS_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "nome exato, ex.: mcp__google-workspace__list_tasks" },
    args: { type: "object", description: "argumentos conforme describe_external_tool. A conta Google ja esta conectada: NAO informe user_google_email." },
  },
  required: ["name"],
};

const EXTERNAL_TOOLS: ToolDef[] = [
  {
    name: "list_external_tools",
    description:
      "Lista as ferramentas de servidores MCP conectados ao app (ex.: Google Workspace: Agenda, Gmail, Tasks) que voce pode usar por read_external_tool/call_external_tool. Mostra nome, descricao e se so le (somenteLeitura) ou altera dados. filter opcional: trecho do nome (ex.: task).",
    inputSchema: { type: "object", properties: { filter: { type: "string" } } },
    run: async (a) => {
      const f = String(a.filter ?? "").toLowerCase();
      return (await externalTools())
        .filter((t) => !f || t.name.toLowerCase().includes(f))
        .map((t) => ({ nome: t.name, somenteLeitura: t.readOnly, descricao: t.description.split("\n")[0].slice(0, 160), obrigatorios: t.required.filter((r) => r !== "user_google_email") }));
    },
  },
  {
    name: "describe_external_tool",
    description: "Esquema (JSON Schema) e descricao completa de uma ferramenta externa: parametros, tipos e valores aceitos. Use antes de chamar.",
    inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    run: async (a) => {
      const name = String(a.name ?? "");
      if (!(await externalTools()).some((t) => t.name === name)) throw new Error(`ferramenta externa desconhecida: ${name}`);
      return api("GET", `/tools/schema?name=${enc(name)}`);
    },
  },
  {
    name: "read_external_tool",
    description: "Chama uma ferramenta externa SO DE LEITURA (listar tarefas, eventos, buscar e-mails). Recusa ferramentas que alteram dados. Devolve o texto que a ferramenta respondeu.",
    inputSchema: EXTERNAL_ARGS_SCHEMA,
    run: (a) => callExternal(a, true),
  },
  {
    name: "call_external_tool",
    description:
      "Chama QUALQUER ferramenta externa, inclusive as que ALTERAM dados na conta do usuario (concluir/criar tarefa, criar evento, enviar e-mail). Use so quando o usuario pediu essa acao; o usuario confirma cada uso. Ex.: concluir tarefa no Google Tasks = mcp__google-workspace__manage_task com {action:'update', task_list_id:'@default', task_id, status:'completed'}.",
    inputSchema: EXTERNAL_ARGS_SCHEMA,
    run: (a) => callExternal(a, false),
  },
];

const TOOLS: ToolDef[] = [
  ...STUDIO_TOOLS,
  ...EXTERNAL_TOOLS,
  {
    name: "canvas_guide",
    description: "Guia completo do Agent Canvas (nos, expressoes, padroes de times de agentes). Leia antes de montar.",
    inputSchema: { type: "object", properties: {} },
    run: async () => GUIDE,
  },
  {
    name: "canvas_nodes",
    description: "Tipos de no (campos, portas, exemplo), ferramentas disponiveis (nome e parametros; inclui as de servidores MCP), provedores de IA configurados e se o Claude Code esta instalado.",
    inputSchema: { type: "object", properties: {} },
    run: async () => {
      const cat = await api("GET", "/catalog");
      return {
        nos: cat.nodes.map((n: any) => ({
          tipo: n.type,
          descricao: n.description,
          entrada: n.inputs === 1,
          saidas: n.outputs,
          campos: n.fields.map((f: any) => `${f.key}${f.required ? "*" : ""}:${f.kind}`),
          exemplo: n.example,
        })),
        ferramentas: cat.tools.map((t: any) => `${t.name}(${t.params.map((p: string) => (t.required.includes(p) ? `${p}*` : p)).join(", ")})${t.readOnly ? " [leitura]" : ""} — ${t.description.slice(0, 90)}`),
        provedores: cat.providers.map((p: any) => `${p.id}${p.available ? "" : " (sem chave)"} ${p.model}`),
        claudeCode: cat.claude,
      };
    },
  },
  {
    name: "list_canvases",
    description: "Lista os canvases (nome, quantidade de nos, agentes, ultima execucao).",
    inputSchema: { type: "object", properties: {} },
    run: async () => (await api("GET", "/canvases")).map(summarize),
  },
  {
    name: "get_canvas",
    description: "Le um canvas completo (nos, configuracao, fios e problemas). Para editar: altere e envie tudo de volta com save_canvas.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    run: (a) => api("GET", `/canvases/${enc(String(a.id))}`),
  },
  {
    name: "save_canvas",
    description:
      "Cria (sem id) ou substitui (com id) um canvas de agentes. nodes: [{id, type, name, config}], edges: [{from, fromPort ('main'; 'true'/'false' no Se), to}]. x/y opcionais. Erros de validacao voltam para voce corrigir. Fica como rascunho do agente: o usuario revisa e executa.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "id do canvas (de list_canvases) para substituir; omita para criar" },
        name: { type: "string" },
        description: { type: "string" },
        nodes: { type: "array", items: { type: "object" } },
        edges: { type: "array", items: { type: "object" } },
      },
      required: ["name", "nodes"],
    },
    run: async (a) => {
      const body = { name: a.name, description: a.description, nodes: a.nodes, edges: a.edges ?? [], source: "agent" };
      const saved = a.id ? await api("PUT", `/canvases/${enc(String(a.id))}`, body) : await api("POST", "/canvases", body);
      return { ...summarize(saved), proximoPasso: "Simule com run_canvas; depois peca ao usuario para abrir o canvas, revisar e clicar em Executar." };
    },
  },
  {
    name: "run_canvas",
    description:
      "SIMULA o canvas (nao gasta IA nem escreve nada: agentes e escritas sao simulados; leituras rodam) e devolve, por no, o que entrou/saiu, avisos e erros. Use para testar o desenho. input = pedido de teste (opcional).",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, input: { type: "string", description: "pedido de teste; vazio = texto do no Pedido" }, startNodeId: { type: "string" } },
      required: ["id"],
    },
    run: async (a) => {
      const started = await api("POST", `/canvases/${enc(String(a.id))}/run`, { mode: "dry", input: a.input, startNodeId: a.startNodeId });
      for (let i = 0; i < 60; i++) {
        const run = await api("GET", `/runs/${enc(started.id)}`);
        if (run.status !== "running") return summarizeRun(run);
        await new Promise((r) => setTimeout(r, 1000));
      }
      throw new Error("a simulação não terminou em 60 s");
    },
  },
  {
    name: "canvas_runs",
    description: "Ultimas execucoes de um canvas (reais e simulacoes) com o resultado por no: para descobrir por que algo falhou.",
    inputSchema: { type: "object", properties: { id: { type: "string" }, limit: { type: "number" } }, required: ["id"] },
    run: async (a) => (await api("GET", `/canvases/${enc(String(a.id))}/runs?limit=${Math.min(10, Number(a.limit) || 5)}`)).map(summarizeRun),
  },
  {
    name: "delete_canvas",
    description: "Exclui um canvas e seu historico.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    run: (a) => api("DELETE", `/canvases/${enc(String(a.id))}`),
  },
];

const byName = new Map(TOOLS.map((t) => [t.name, t]));

function asText(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n… (cortado em ${MAX_OUTPUT} caracteres)` : text;
}

const server = new Server(
  { name: "agent-canvas", version: "0.1.0" },
  {
    capabilities: { tools: {}, prompts: {}, resources: {} },
    instructions:
      "Agent Canvas Studio. (1) Dashboards/componentes/dados: o usuario descreve (kanban, CRM, notas, painel...) e voce constroi com colecoes, componentes e paginas; chame studio_guide ANTES; componentes ficam aguardando aprovacao do usuario. (2) Agentes: desenhe o canvas (save_canvas), simule (run_canvas) e explique; chame canvas_guide antes. Nunca execute canvases de verdade nem aprove componentes: so o usuario.",
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = byName.get(request.params.name);
  if (!tool) return { isError: true, content: [{ type: "text", text: `ferramenta desconhecida: ${request.params.name}` }] };
  try {
    return { content: [{ type: "text", text: asText(await tool.run((request.params.arguments ?? {}) as Args)) }] };
  } catch (err) {
    return { isError: true, content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }] };
  }
});

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [
    {
      name: "construir-dashboard",
      description: "Descreva o dashboard/componente que voce quer (ex.: 'um kanban de tarefas', 'um CRM simples', 'painel de notas') e o Claude constroi dados, componentes e pagina.",
      arguments: [{ name: "pedido", description: "O que voce quer ver no dashboard", required: true }],
    },
    {
      name: "construir-canvas",
      description: "Descreva o time de agentes que voce quer (ex.: 'um pesquisador, um redator e um revisor') e o Claude desenha o canvas como rascunho para voce executar.",
      arguments: [{ name: "pedido", description: "O que o time de agentes deve fazer", required: true }],
    },
  ],
}));

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const pedido = String(request.params.arguments?.pedido ?? "").trim();
  if (request.params.name === "construir-dashboard") {
    return {
      description: "Construir dados, componentes e pagina do dashboard a partir de um pedido",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `${STUDIO_GUIDE}\n\n---\n## Meu pedido\n${pedido || "(o usuario ainda vai descrever)"}\n\n` +
              `Construa agora, seguindo o fluxo padrao: veja o que existe, crie colecoes, escreva os componentes (sem warnings), monte a pagina e resuma o que criou e o que preciso aprovar.`,
          },
        },
      ],
    };
  }
  if (request.params.name !== "construir-canvas") throw new Error(`prompt desconhecido: ${request.params.name}`);
  return {
    description: "Construir um canvas de agentes a partir de um pedido em linguagem natural",
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text:
            `${GUIDE}\n\n---\n## Meu pedido\n${pedido || "(o usuario ainda vai descrever)"}\n\n` +
            `Construa agora: consulte canvas_nodes e list_canvases, desenhe o time com save_canvas, simule com run_canvas, corrija o que falhar e resuma em poucas linhas quem faz o que. ` +
            `Diga que eu preciso abrir o canvas, revisar e clicar em Executar.`,
        },
      },
    ],
  };
});

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    { uri: "canvas://guia", name: "Guia do Agent Canvas", description: "Nos, expressoes e padroes de times de agentes", mimeType: "text/markdown" },
    { uri: "studio://guia", name: "Guia do Studio", description: "Componentes, dados, design system e paginas do dashboard", mimeType: "text/markdown" },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  if (request.params.uri === "studio://guia") return { contents: [{ uri: request.params.uri, mimeType: "text/markdown", text: STUDIO_GUIDE }] };
  if (request.params.uri !== "canvas://guia") throw new Error(`recurso desconhecido: ${request.params.uri}`);
  return { contents: [{ uri: request.params.uri, mimeType: "text/markdown", text: GUIDE }] };
});

await server.connect(new StdioServerTransport());
log(`pronto (servidor ${SERVER})`);
