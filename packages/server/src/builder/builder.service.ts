import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { BlocksService } from "../blocks/blocks.service";
import { DataService } from "../data/data.service";
import { dataDir } from "../db";
import { claudeStatus, cleanEnv, findClaude } from "../llm/claude-node";
import { PagesService } from "../pages/pages.service";

const MCP_ENTRY = resolve(__dirname, "../../../mcp/dist/index.js");
const MAX_MS = 12 * 60_000;
const MAX_EVENTS = 400;
const KEEP_RUNS = 20;

export interface BuilderEvent {
  at: string;
  kind: "say" | "tool" | "error" | "info";
  text: string;
}

export interface BuilderChanges {
  collections: string[];
  blocksCreated: Array<{ id: string; name: string; approved: boolean }>;
  blocksUpdated: Array<{ id: string; name: string; approved: boolean }>;
  pagesCreated: Array<{ id: string; name: string }>;
  pagesUpdated: Array<{ id: string; name: string }>;
}

export interface BuilderRun {
  id: string;
  prompt: string;
  status: "running" | "ok" | "error" | "cancelled";
  events: BuilderEvent[];
  result?: string;
  error?: string;
  changes?: BuilderChanges;
  startedAt: string;
  finishedAt?: string;
}

const SYSTEM = `Você é o CONSTRUTOR do Agent Canvas Studio, rodando de forma autônoma dentro do app. O usuário descreveu em linguagem natural o que quer ver no dashboard.
Regras:
1. Comece chamando studio_guide e siga o fluxo padrão (ver o que existe → colecoes → componentes → pagina).
2. Use SOMENTE as ferramentas do Agent Canvas (MCP). Nao peça confirmação: decida com bom senso e construa.
3. Todo dado persiste em colecoes; estado de tela em ctx.store; use so o design system (nada de cores fixas). Corrija todos os warnings dos componentes.
4. Reaproveite o que já existe (list_collections/list_blocks/list_pages); ao alterar, use get_block e save_block com id + versionNote.
5. Nunca aprove componentes nem execute canvases de verdade: o usuário revisa e aprova.
6. Termine com um resumo curto em português: o que criou (coleções, componentes, páginas), o que o usuário precisa aprovar ou conectar e onde abrir.`;

const short = (v: unknown, n = 90): string => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

function describeTool(name: string, input: Record<string, unknown>): string {
  const n = name.replace(/^mcp__agent-canvas__/, "");
  const label = (input.name ?? input.collection ?? input.id ?? input.pageId ?? "") as string;
  return label ? `${n}: ${short(label, 60)}` : n;
}

/**
 * Construtor autonomo: executa o Claude Code em segundo plano (claude -p) SO com as ferramentas do Agent Canvas,
 * para criar dados, componentes e paginas a partir de um pedido em linguagem natural. Mostra o progresso ao vivo.
 */
@Injectable()
export class BuilderService {
  private readonly logger = new Logger(BuilderService.name);
  private readonly runs = new Map<string, BuilderRun>();
  private readonly children = new Map<string, ChildProcess>();
  private active: string | null = null;

  constructor(
    private readonly blocks: BlocksService,
    private readonly pages: PagesService,
    private readonly data: DataService
  ) {}

  status() {
    return claudeStatus().then((c) => ({ claude: c, mcpBuilt: existsSync(MCP_ENTRY), busy: this.active !== null }));
  }

  list(): BuilderRun[] {
    return Array.from(this.runs.values()).reverse();
  }

  get(id: string): BuilderRun {
    const r = this.runs.get(id);
    if (!r) throw new NotFoundException("execução não encontrada");
    return r;
  }

  private snapshot() {
    return {
      collections: new Set(this.data.listCollections().map((c) => c.name)),
      blocks: new Map(this.blocks.list().map((b) => [b.id, b.updatedAt])),
      pages: new Map(this.pages.list().map((p) => [p.id, p.updatedAt])),
    };
  }

  private diff(before: ReturnType<BuilderService["snapshot"]>): BuilderChanges {
    const b = this.blocks.list();
    const p = this.pages.list();
    return {
      collections: this.data.listCollections().map((c) => c.name).filter((n) => !before.collections.has(n)),
      blocksCreated: b.filter((x) => !before.blocks.has(x.id)).map((x) => ({ id: x.id, name: x.name, approved: x.approved })),
      blocksUpdated: b.filter((x) => before.blocks.has(x.id) && before.blocks.get(x.id) !== x.updatedAt).map((x) => ({ id: x.id, name: x.name, approved: x.approved })),
      pagesCreated: p.filter((x) => !before.pages.has(x.id)).map((x) => ({ id: x.id, name: x.name })),
      pagesUpdated: p.filter((x) => before.pages.has(x.id) && before.pages.get(x.id) !== x.updatedAt).map((x) => ({ id: x.id, name: x.name })),
    };
  }

  async start(promptRaw: unknown, pageId?: unknown): Promise<BuilderRun> {
    const prompt = typeof promptRaw === "string" ? promptRaw.trim() : "";
    if (!prompt) throw new BadRequestException("descreva o que você quer construir");
    if (prompt.length > 4000) throw new BadRequestException("pedido longo demais (máx. 4000 caracteres)");
    if (this.active) throw new ConflictException("já existe uma construção em andamento");
    const claude = await claudeStatus();
    if (!claude.installed) throw new BadRequestException("o Claude Code não está instalado neste computador");
    if (!existsSync(MCP_ENTRY)) throw new BadRequestException('o MCP do Agent Canvas não foi compilado: rode "pnpm build:mcp"');

    let context = "";
    if (typeof pageId === "string" && pageId) {
      try {
        const page = this.pages.get(pageId);
        context = `\n\n(Contexto: o usuário está vendo a página "${page.name}" (id ${page.id}). Se fizer sentido, coloque os componentes novos nela com place_block.)`;
      } catch {
        // pagina inexistente: sem contexto
      }
    }

    const id = randomUUID();
    const run: BuilderRun = { id, prompt, status: "running", events: [], startedAt: new Date().toISOString() };
    this.runs.set(id, run);
    while (this.runs.size > KEEP_RUNS) this.runs.delete(this.runs.keys().next().value as string);
    this.active = id;
    const before = this.snapshot();
    const push = (kind: BuilderEvent["kind"], text: string) => {
      if (run.events.length < MAX_EVENTS) run.events.push({ at: new Date().toISOString(), kind, text });
    };

    const cwd = resolve(dataDir(), "work");
    if (!existsSync(cwd)) mkdirSync(cwd, { recursive: true });
    const mcpConfig = JSON.stringify({ mcpServers: { "agent-canvas": { command: process.execPath, args: [MCP_ENTRY], env: { AGENT_CANVAS_URL: `http://localhost:${process.env.SERVER_PORT ?? 5100}` } } } });
    const args = [
      "-p",
      `${prompt}${context}`,
      "--output-format",
      "stream-json",
      "--verbose",
      "--strict-mcp-config",
      "--mcp-config",
      mcpConfig,
      "--allowedTools",
      "mcp__agent-canvas",
      "--permission-mode",
      "dontAsk",
      "--append-system-prompt",
      SYSTEM,
      "--max-turns",
      "45",
      "--no-session-persistence",
    ];
    push("info", "Claude Code iniciado…");
    const child = spawn(findClaude(), args, { cwd, env: cleanEnv(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    this.children.set(id, child);
    const timer = setTimeout(() => child.kill(), MAX_MS);

    let buffer = "";
    let stderr = "";
    const handleLine = (line: string) => {
      if (!line.trim()) return;
      let ev: any;
      try {
        ev = JSON.parse(line);
      } catch {
        return;
      }
      if (ev.type === "assistant") {
        for (const part of ev.message?.content ?? []) {
          if (part.type === "text" && part.text?.trim()) push("say", part.text.trim());
          else if (part.type === "tool_use") push("tool", describeTool(String(part.name), (part.input ?? {}) as Record<string, unknown>));
        }
      } else if (ev.type === "user") {
        for (const part of ev.message?.content ?? []) {
          if (part.type === "tool_result" && part.is_error) push("error", short(typeof part.content === "string" ? part.content : (part.content?.[0]?.text ?? "erro"), 220));
        }
      } else if (ev.type === "result") {
        run.result = typeof ev.result === "string" ? ev.result : undefined;
        const last = run.events[run.events.length - 1];
        if (last && last.kind === "say" && last.text === run.result?.trim()) run.events.pop();
        if (ev.is_error) run.error = run.result || "o Claude terminou com erro";
      }
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let i: number;
      while ((i = buffer.indexOf("\n")) >= 0) {
        handleLine(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-1500);
    });
    const finish = (code: number | null) => {
      clearTimeout(timer);
      if (buffer.trim()) handleLine(buffer);
      this.children.delete(id);
      if (this.active === id) this.active = null;
      run.finishedAt = new Date().toISOString();
      run.changes = this.diff(before);
      if (run.status === "cancelled") return;
      if (run.error || (code !== 0 && code !== null)) {
        run.status = "error";
        run.error = run.error || stderr.trim() || `o Claude Code terminou com código ${code}`;
        push("error", run.error.slice(0, 300));
      } else run.status = "ok";
    };
    child.on("error", (err) => {
      run.error = err.message;
      finish(1);
    });
    child.on("close", (code) => finish(code));
    this.logger.log(`construtor iniciado: ${short(prompt, 80)}`);
    return run;
  }

  cancel(id: string) {
    const run = this.get(id);
    const child = this.children.get(id);
    if (child && run.status === "running") {
      run.status = "cancelled";
      child.kill();
      run.events.push({ at: new Date().toISOString(), kind: "info", text: "Cancelado." });
    }
    return { ok: true };
  }
}
