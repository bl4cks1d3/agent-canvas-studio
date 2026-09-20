import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool as McpTool } from "@modelcontextprotocol/sdk/types.js";

// Mesma convencao do .mcp.json do Claude Code: { "mcpServers": { "nome": { "command": ..., "args": [...] } } }
// AGENT_CANVAS_MCP_CONFIG troca o arquivo (testes, instalacoes com outra pasta de configuracao)
export const MCP_CONFIG_PATH = process.env.AGENT_CANVAS_MCP_CONFIG ? resolve(process.env.AGENT_CANVAS_MCP_CONFIG) : resolve(__dirname, "../../../../.mcp.json");
const CONFIG_PATH = MCP_CONFIG_PATH;

interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface ConnectedServer {
  name: string;
  client: Client;
  tools: McpTool[];
}

export interface McpToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  server: string;
}

/**
 * Torna o Agent Canvas um host MCP: conecta nos servidores do .mcp.json (Postgres, arquivos, GitHub…) e
 * expoe as ferramentas deles aos agentes como "mcp__servidor__ferramenta" (mesma convencao do Claude Code).
 */
@Injectable()
export class McpManager implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(McpManager.name);
  private readonly servers: ConnectedServer[] = [];
  /** Motivo da ultima falha de conexao de cada servidor (a tela de conexoes mostra em vez de so "nao apareceu"). */
  private readonly errors = new Map<string, string>();

  errorOf(name: string): string | undefined {
    return this.errors.get(name);
  }

  async onModuleInit(): Promise<void> {
    await this.load();
  }

  /** Relê o .mcp.json e reconecta tudo (o assistente de conexões dos pacotes usa depois de você adicionar um servidor). */
  async reload(): Promise<number> {
    await this.onModuleDestroy();
    this.servers.length = 0;
    this.errors.clear();
    await this.load();
    return this.servers.length;
  }

  private async load(): Promise<void> {
    if (!existsSync(CONFIG_PATH)) return;
    let config: { mcpServers?: Record<string, McpServerConfig> };
    try {
      config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    } catch (err) {
      this.logger.warn(`nao consegui ler .mcp.json: ${err instanceof Error ? err.message : err}`);
      return;
    }
    await Promise.all(Object.entries(config.mcpServers ?? {}).map(([name, cfg]) => this.connect(name, cfg)));
  }

  private async connect(name: string, cfg: McpServerConfig): Promise<void> {
    // o MCP do proprio Agent Canvas e para o Claude Code: conecta-lo aqui seria recursao
    if (name === "agent-canvas") return;
    try {
      const client = new Client({ name: "agent-canvas", version: "0.1.0" });
      await client.connect(new StdioClientTransport({ command: cfg.command, args: cfg.args, env: { ...(process.env as Record<string, string>), ...(cfg.env ?? {}) } }));
      const { tools } = await client.listTools();
      this.servers.push({ name, client, tools });
      this.errors.delete(name);
      this.logger.log(`MCP conectado: ${name} (${tools.length} ferramenta(s))`);
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      this.errors.set(name, why);
      this.logger.warn(`falha ao conectar no MCP "${name}": ${why}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.servers.map((s) => s.client.close().catch(() => undefined)));
  }

  list(): McpToolDef[] {
    return this.servers.flatMap((s) =>
      s.tools.map((t) => ({ name: `mcp__${s.name}__${t.name}`, description: t.description ?? "", parameters: t.inputSchema as Record<string, unknown>, server: s.name }))
    );
  }

  async call(prefixed: string, args: Record<string, unknown>): Promise<unknown> {
    const m = prefixed.match(/^mcp__(.+?)__(.+)$/);
    if (!m) throw new Error(`nome de ferramenta MCP invalido: ${prefixed}`);
    const server = this.servers.find((s) => s.name === m[1]);
    if (!server) throw new Error(`servidor MCP nao conectado: ${m[1]}`);
    const schema = server.tools.find((t) => t.name === m[2])?.inputSchema as { properties?: Record<string, unknown>; additionalProperties?: unknown } | undefined;
    const props = schema?.properties ?? {};
    let sent = args;
    // Servidores como o do Google recusam argumento desconhecido ("Unexpected keyword argument"). Quem chama sem saber o nome exato
    // (componentes de pacote mandam varios apelidos: maxResults, max_results, pageSize…) fica so com o que a ferramenta declara.
    if (Object.keys(props).length && schema?.additionalProperties !== true) {
      sent = Object.fromEntries(Object.entries(args).filter(([k]) => k in props));
      const dropped = Object.keys(args).filter((k) => !(k in props));
      if (dropped.length) this.logger.debug(`${prefixed}: argumentos ignorados (nao existem na ferramenta): ${dropped.join(", ")}`);
    }
    // servidores do Google exigem user_google_email em quase toda ferramenta. Ha uma conta conectada, entao o e-mail salvo vale SEMPRE:
    // um e-mail inventado por um modelo (ou de outra conta) faria o servidor pedir login em vez de usar a conexao ativa
    const email = process.env.USER_GOOGLE_EMAIL;
    if (email && "user_google_email" in props) sent = { ...sent, user_google_email: email };
    const result = await server.client.callTool({ name: m[2], arguments: sent });
    const text = ((result.content ?? []) as Array<{ type: string; text?: string }>)
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("\n");
    return text || result;
  }
}
