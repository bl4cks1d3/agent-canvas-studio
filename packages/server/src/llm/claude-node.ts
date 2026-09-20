import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir } from "../db";
import { CLAUDE_SAFE_TOOLS } from "../canvases/graph";
import { ENV_EMAIL, ENV_ID, ENV_SECRET, GOOGLE_SERVER } from "../integrations/google-workspace";
import { MCP_CONFIG_PATH } from "../tools/mcp-manager";
import { withCompanions } from "./tool-hints";

// Sem os marcadores de sessao do Claude Code: o servico pode ter sido iniciado de dentro de outra sessao,
// e o Claude filho se acharia "sub-sessao" (sem gravar transcricao) e herdaria credenciais alheias.
const MARKERS = /^(CLAUDECODE|CLAUDE_AGENT_SDK_.*|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_PREVIEW_.*|CLAUDE_CODE_(?!USE_).*)$/i;
export const cleanEnv = (): NodeJS.ProcessEnv => Object.fromEntries(Object.entries(process.env).filter(([k]) => !MARKERS.test(k)));

const IS_WIN = process.platform === "win32";

/** No Windows o "claude" do PATH pode ser um shim .cmd (execFile sem shell da EINVAL): usa o .exe real do app. */
export function findClaude(): string {
  if (IS_WIN) {
    const base = join(process.env.APPDATA ?? "", "Claude", "claude-code");
    try {
      const versions = readdirSync(base, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort()
        .reverse();
      for (const v of versions) {
        const exe = join(base, v, "claude.exe");
        if (existsSync(exe)) return exe;
      }
    } catch {
      // sem o app: cai no PATH
    }
  }
  return "claude";
}

export interface ClaudeStatus {
  installed: boolean;
  version?: string;
}

let cache: { at: number; value: ClaudeStatus } | null = null;

export function claudeStatus(): Promise<ClaudeStatus> {
  if (cache && Date.now() - cache.at < 60_000) return Promise.resolve(cache.value);
  return new Promise((done) => {
    execFile(findClaude(), ["--version"], { timeout: 8000, windowsHide: true, env: cleanEnv() }, (err, stdout) => {
      const line = String(stdout ?? "").trim().split(/\r?\n/)[0] ?? "";
      const value: ClaudeStatus = err || !line ? { installed: false } : { installed: true, version: line.split(/\s+/)[0] };
      cache = { at: Date.now(), value };
      done(value);
    });
  });
}

export const allowBash = () => process.env.CLAUDE_NODE_ALLOW_BASH === "true";

export interface ClaudeArgs {
  instructions: string;
  prompt: string;
  cwd?: string;
  allowedTools?: string;
  maxTurns?: number;
  signal?: AbortSignal;
}

export interface ClaudeAgentArgs {
  system: string;
  prompt: string;
  /** Ferramentas do agente: so as de servidores MCP (mcp__servidor__ferramenta) chegam ao Claude Code. */
  tools: string[];
  maxSteps: number;
  model?: string;
  signal?: AbortSignal;
}

/**
 * Agente "agent.llm" com provedor Claude Code: roda `claude -p` na conta do usuario (sem chave de API) e liga so os servidores MCP
 * das ferramentas marcadas no no, liberando SO essas ferramentas (`--allowedTools`; o resto e negado, sem perguntar).
 * A configuracao dos servidores (com as chaves do Google, se preciso) vai num arquivo temporario fora da pasta de trabalho, apagado no fim.
 */
export async function runClaudeAgent(a: ClaudeAgentArgs): Promise<{ text: string; steps: number; toolsUsed: string[] }> {
  const cwd = resolve(dataDir(), "work");
  mkdirSync(cwd, { recursive: true });
  const mcpTools = withCompanions(a.tools.filter((t) => t.startsWith("mcp__")));
  let tmp: string | undefined;
  const args = ["-p", "--append-system-prompt", a.system, "--permission-mode", "dontAsk", "--output-format", "text", "--max-turns", String(Math.min(30, Math.max(3, a.maxSteps * 2)))];
  if (a.model?.trim()) args.push("--model", a.model.trim());
  try {
    if (mcpTools.length) {
      const wanted = new Set(mcpTools.map((t) => /^mcp__(.+?)__/.exec(t)?.[1] ?? ""));
      let known: Record<string, { command: string; args?: string[]; env?: Record<string, string> }> = {};
      try {
        known = JSON.parse(readFileSync(MCP_CONFIG_PATH, "utf8")).mcpServers ?? {};
      } catch {
        throw new Error("não consegui ler o .mcp.json para ligar as ferramentas ao Claude Code");
      }
      const servers: typeof known = {};
      for (const name of wanted) {
        const cfg = known[name];
        if (!cfg) throw new Error(`o servidor MCP "${name}" não está no .mcp.json`);
        const extra: Record<string, string> = {};
        if (name === GOOGLE_SERVER) for (const k of [ENV_ID, ENV_SECRET, ENV_EMAIL]) if (process.env[k]) extra[k] = String(process.env[k]);
        servers[name] = { ...cfg, env: { ...(cfg.env ?? {}), ...extra } };
      }
      tmp = mkdtempSync(join(tmpdir(), "agent-canvas-mcp-"));
      const file = join(tmp, "mcp.json");
      writeFileSync(file, JSON.stringify({ mcpServers: servers }), { mode: 0o600 });
      args.push("--strict-mcp-config", "--mcp-config", file, "--allowedTools", ...mcpTools);
    }
    const text = await new Promise<string>((done, fail) => {
      const child = execFile(findClaude(), args, { cwd, env: cleanEnv(), timeout: 5 * 60_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
        if (err) return fail(new Error(String(stderr || stdout || err.message).trim().slice(0, 600)));
        done(String(stdout).trim());
      });
      child.stdin?.end(a.prompt || "(nenhum contexto recebido: siga as instruções)");
      a.signal?.addEventListener("abort", () => child.kill(), { once: true });
    });
    return { text, steps: 1, toolsUsed: [] };
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
}

/** claude -p (sem shell, argumentos como lista) numa pasta de trabalho, com so as ferramentas liberadas. */
export function runClaude(a: ClaudeArgs): Promise<string> {
  const cwd = a.cwd?.trim() ? resolve(a.cwd.trim()) : resolve(dataDir(), "work");
  if (!existsSync(cwd)) {
    if (a.cwd?.trim()) throw new Error(`a pasta de trabalho não existe: ${cwd}`);
    mkdirSync(cwd, { recursive: true });
  }
  const safe = new Set(allowBash() ? [...CLAUDE_SAFE_TOOLS, "Bash"] : CLAUDE_SAFE_TOOLS);
  const tools = (a.allowedTools ?? "Read,Grep,Glob")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const bad = tools.filter((t) => !safe.has(t));
  if (bad.length) throw new Error(`ferramenta(s) do Claude Code não permitida(s): ${bad.join(", ")}`);
  const args = [
    "-p",
    a.prompt,
    "--append-system-prompt",
    a.instructions,
    "--allowedTools",
    ...tools,
    "--max-turns",
    String(Math.min(30, Math.max(1, a.maxTurns ?? 10))),
    "--output-format",
    "text",
  ];
  return new Promise((done, fail) => {
    const child = execFile(findClaude(), args, { cwd, env: cleanEnv(), timeout: 5 * 60_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return fail(new Error(String(stderr || stdout || err.message).trim().slice(0, 600)));
      done(String(stdout).trim());
    });
    child.stdin?.end();
    a.signal?.addEventListener("abort", () => child.kill(), { once: true });
  });
}
