import { BadRequestException, ConflictException, Injectable, Logger } from "@nestjs/common";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { ToolInfo } from "@agent-canvas/shared";
import { PackagesService } from "../packages/packages.service";
import { MCP_CONFIG_PATH } from "../tools/mcp-manager";
import { ToolRegistry } from "../tools/tool-registry";
import { writeEnv } from "./env-file";
import { buildArgs, CLIENT_ID_RE, CLIENT_SECRET_RE, EMAIL_RE, ENV_EMAIL, ENV_ID, ENV_SECRET, extractAuthUrl, findAuthTool, GOOGLE_MCP, GOOGLE_PACKAGE, GOOGLE_SERVER, pickTools } from "./google-workspace";

export interface GoogleStatus {
  /** `uvx` (roda o servidor MCP do Google) instalado. */
  uv: boolean;
  hasCredentials: boolean;
  email: string;
  /** O servidor esta declarado no .mcp.json. */
  configured: boolean;
  /** O servidor esta conectado e expondo ferramentas. */
  running: boolean;
  tools: number;
  error?: string;
  packageInstalled: boolean;
  mapped: Array<{ id: string; label: string; tool: string | null }>;
}

export interface GoogleProbe {
  ok: boolean;
  needsAuth: boolean;
  url?: string;
  message: string;
}

const text = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));
const why = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Botao "Conectar conta Google": grava as credenciais no .env, declara o servidor MCP (workspace-mcp via uvx) no .mcp.json,
 * reconecta e liga as ferramentas ao pacote Google Workspace. O login em si e do proprio servidor MCP (o usuario autoriza no Google).
 * As credenciais nunca voltam para o navegador nem vao para log.
 */
@Injectable()
export class GoogleService {
  private readonly logger = new Logger(GoogleService.name);
  private busy = false;
  private uv?: { ok: boolean; at: number };

  constructor(
    private readonly tools: ToolRegistry,
    private readonly packages: PackagesService
  ) {}

  // ---------------------------------------------------------------- estado

  status(): GoogleStatus {
    const own = this.own();
    let packageInstalled = false;
    let mapped: GoogleStatus["mapped"] = [];
    try {
      const pkg = this.packages.get(GOOGLE_PACKAGE);
      packageInstalled = pkg.installed;
      mapped = pkg.connections.filter((c) => c.kind === "tool").map((c) => ({ id: c.id, label: c.label, tool: c.value ?? null }));
    } catch {
      // pacote fora da biblioteca: so nao mostra o mapeamento
    }
    return {
      uv: this.hasUv(),
      hasCredentials: !!process.env[ENV_ID] && !!process.env[ENV_SECRET],
      email: process.env[ENV_EMAIL] ?? "",
      configured: !!this.readMcp().mcpServers?.[GOOGLE_SERVER],
      running: own.length > 0,
      tools: own.length,
      error: own.length ? undefined : this.tools.mcpError(GOOGLE_SERVER),
      packageInstalled,
      mapped,
    };
  }

  // ---------------------------------------------------------------- acoes

  /** Salva credenciais + declara o servidor + reconecta + liga as ferramentas. Sem client id/secret, reaproveita os ja salvos. */
  async setup(body: { email?: unknown; clientId?: unknown; clientSecret?: unknown }): Promise<GoogleStatus> {
    const email = String(body?.email ?? "").trim();
    const clientId = String(body?.clientId ?? "").trim();
    const clientSecret = String(body?.clientSecret ?? "").trim();
    if (!EMAIL_RE.test(email)) throw new BadRequestException("Informe o e-mail da conta Google que você vai usar.");
    const reuse = !clientId && !clientSecret && !!process.env[ENV_ID] && !!process.env[ENV_SECRET];
    if (!reuse) {
      if (!CLIENT_ID_RE.test(clientId)) throw new BadRequestException("Client ID inválido: deve terminar em .apps.googleusercontent.com.");
      if (!CLIENT_SECRET_RE.test(clientSecret)) throw new BadRequestException("Client secret inválido: use só letras, números, - e _ (copie de novo do Google Cloud).");
    }
    return this.exclusive(async () => {
      const entries: Record<string, string> = { [ENV_EMAIL]: email };
      if (!reuse) Object.assign(entries, { [ENV_ID]: clientId, [ENV_SECRET]: clientSecret });
      this.writeEnv(entries);
      const cfg = this.readMcp();
      cfg.mcpServers = { ...(cfg.mcpServers ?? {}) };
      if (!cfg.mcpServers[GOOGLE_SERVER]) cfg.mcpServers[GOOGLE_SERVER] = { ...GOOGLE_MCP };
      writeFileSync(MCP_CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n", "utf8");
      await this.tools.reloadMcp();
      this.automap();
      return this.status();
    });
  }

  /** Relê o .mcp.json, reconecta e refaz o mapeamento das ferramentas. */
  async refresh(): Promise<GoogleStatus> {
    return this.exclusive(async () => {
      await this.tools.reloadMcp();
      this.automap();
      return this.status();
    });
  }

  /** Pede ao servidor o link de login do Google (ferramenta de login, ou uma leitura, que responde com o link se ainda nao autorizou). */
  async authorize(): Promise<{ url?: string; message: string }> {
    this.needRunning();
    const all = this.tools.list();
    let message = "";
    let url: string | undefined;
    for (const t of [findAuthTool(all), this.readTool(all)]) {
      if (!t || url) continue;
      try {
        message = text(await this.tools.call(t.name, this.argsFor(t)));
        url = extractAuthUrl(message);
      } catch (e) {
        message = why(e);
        url = extractAuthUrl(message);
      }
    }
    return { url, message: message.slice(0, 600) || "O servidor não devolveu um link de login." };
  }

  /** Chama uma leitura de agenda para saber se a conta ja esta autorizada. */
  async test(): Promise<GoogleProbe> {
    this.needRunning();
    const t = this.readTool(this.tools.list());
    if (!t) return { ok: false, needsAuth: false, message: "Não achei uma ferramenta de agenda para testar. Escolha as ferramentas na lista de conexões." };
    let message: string;
    let failed = false;
    try {
      message = text(await this.tools.call(t.name, this.argsFor(t)));
    } catch (e) {
      message = why(e);
      failed = true;
    }
    const url = extractAuthUrl(message);
    const needsAuth = !!url || /authenticat|authoriz|credentials|log ?in/i.test(message);
    return { ok: !failed && !needsAuth, needsAuth, url, message: message.slice(0, 600) };
  }

  /** Tira o servidor do .mcp.json e apaga as credenciais do .env (o token de login fica com o servidor MCP, na pasta dele). */
  async disconnect(): Promise<GoogleStatus> {
    return this.exclusive(async () => {
      const cfg = this.readMcp();
      if (cfg.mcpServers?.[GOOGLE_SERVER]) {
        delete cfg.mcpServers[GOOGLE_SERVER];
        writeFileSync(MCP_CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n", "utf8");
      }
      this.writeEnv({ [ENV_ID]: "", [ENV_SECRET]: "", [ENV_EMAIL]: "" });
      for (const k of [ENV_ID, ENV_SECRET, ENV_EMAIL]) delete process.env[k];
      await this.tools.reloadMcp();
      return this.status();
    });
  }

  // ---------------------------------------------------------------- interno

  private own(): ToolInfo[] {
    return this.tools.list().filter((t) => t.source === `mcp:${GOOGLE_SERVER}`);
  }

  private needRunning(): void {
    if (!this.own().length) throw new BadRequestException("O servidor do Google não está conectado. Use “Salvar e conectar” primeiro.");
  }

  private readTool(all: ToolInfo[]): ToolInfo | undefined {
    const name = pickTools(all).calendario_listar;
    return all.find((t) => t.name === name);
  }

  private argsFor(t: ToolInfo): Record<string, unknown> {
    return buildArgs(t, { email: process.env[ENV_EMAIL], today: new Date(new Date().setHours(0, 0, 0, 0)).toISOString() });
  }

  private async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (this.busy) throw new ConflictException("Já há uma conexão em andamento; aguarde terminar.");
    this.busy = true;
    try {
      return await fn();
    } finally {
      this.busy = false;
    }
  }

  /** Liga so o que ainda nao esta conectado (nao desfaz uma escolha manual do usuario). */
  private automap(): void {
    try {
      const pkg = this.packages.get(GOOGLE_PACKAGE);
      if (!pkg.installed) return;
      const picked = pickTools(this.tools.list());
      const todo: Record<string, string> = {};
      for (const c of pkg.connections) if (c.kind === "tool" && !c.value && picked[c.id]) todo[c.id] = picked[c.id];
      if (Object.keys(todo).length) this.packages.connect(GOOGLE_PACKAGE, todo);
    } catch (e) {
      this.logger.warn(`mapeamento automatico do Google Workspace: ${why(e)}`);
    }
  }

  private hasUv(): boolean {
    if (this.uv && Date.now() - this.uv.at < 30_000) return this.uv.ok;
    const r = spawnSync("uvx", ["--version"], { timeout: 20_000, windowsHide: true });
    this.uv = { ok: !r.error && r.status === 0, at: Date.now() };
    return this.uv.ok;
  }

  private readMcp(): { mcpServers?: Record<string, unknown>; [k: string]: unknown } {
    if (!existsSync(MCP_CONFIG_PATH)) return {};
    try {
      return JSON.parse(readFileSync(MCP_CONFIG_PATH, "utf8"));
    } catch {
      throw new BadRequestException("O .mcp.json está com JSON inválido; corrija (ou apague) antes de conectar.");
    }
  }

  private writeEnv(entries: Record<string, string>): void {
    writeEnv(entries);
  }
}
