import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanEnv } from "./env.js";

export const PROFILE_IDS = ["claude", "canvas", "shell"] as const;
export type ProfileId = (typeof PROFILE_IDS)[number];

export interface ProfileSpec {
  file: string;
  args: string[];
  cwd: string;
  title: string;
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const IS_WIN = process.platform === "win32";
const COMSPEC = cleanEnv.ComSpec ?? cleanEnv.COMSPEC ?? "cmd.exe";

export function isProfileId(value: unknown): value is ProfileId {
  return typeof value === "string" && (PROFILE_IDS as readonly string[]).includes(value);
}

// No Windows o "claude" do PATH pode ser um shim .cmd: usa o claude.exe real da instalacao mais recente.
function findClaudeExe(): string | null {
  if (!IS_WIN) return null;
  const base = path.join(cleanEnv.APPDATA ?? "", "Claude", "claude-code");
  try {
    const versions = fs
      .readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
      .reverse();
    for (const version of versions) {
      const exe = path.join(base, version, "claude.exe");
      if (fs.existsSync(exe)) return exe;
    }
  } catch {
    // sem instalacao do app: cai no fallback abaixo
  }
  return null;
}

function claudeCwd(): string {
  return process.env.CLAUDE_CODE_CWD?.trim() || REPO_ROOT;
}

// Texto fixo e simples (sem aspas nem metacaracteres): vai como UM argumento.
const CANVAS_PROMPT =
  "Modo Agent Canvas Studio. O usuario descreve em portugues o que quer: (1) dashboards, componentes visuais e dados - kanban, CRM, notas, paineis - ou (2) um time de agentes de IA. " +
  "Use as ferramentas MCP do servidor agent-canvas. Para dashboards e componentes chame studio_guide ANTES e siga o fluxo (colecoes, save_block sem warnings, save_page); os componentes ficam aguardando a aprovacao do usuario. " +
  "Para agentes chame canvas_guide, canvas_nodes, list_canvases e save_canvas, e simule com run_canvas. " +
  "Nunca execute canvases de verdade nem aprove componentes: peca ao usuario. Nao edite arquivos do projeto neste modo. " +
  "Responda sempre em portugues, de forma curta.";

function claudeSpec(args: string[], title: string): ProfileSpec {
  const exe = findClaudeExe();
  if (exe) return { file: exe, args, cwd: claudeCwd(), title };
  if (IS_WIN) return { file: COMSPEC, args: ["/d", "/c", "claude", ...args], cwd: claudeCwd(), title };
  return { file: "claude", args, cwd: claudeCwd(), title };
}

// O cliente so escolhe o NOME do perfil; comando, argumentos e pasta saem daqui.
// Nenhum texto vindo do navegador vira comando.
export function resolveProfile(id: ProfileId): ProfileSpec {
  switch (id) {
    case "claude":
      return claudeSpec([], "Claude Code");
    case "canvas":
      return claudeSpec(["--append-system-prompt", CANVAS_PROMPT], "Claude · Canvas");
    case "shell":
      if (IS_WIN) return { file: "powershell.exe", args: ["-NoLogo"], cwd: REPO_ROOT, title: "Shell" };
      return { file: cleanEnv.SHELL || "bash", args: [], cwd: REPO_ROOT, title: "Shell" };
  }
}

export interface ClaudeStatus {
  installed: boolean;
  version?: string;
  path?: string;
}

let claudeCache: { at: number; value: ClaudeStatus } | null = null;

// Roda "claude --version" (sem shell, argumentos fixos) para saber se o Claude Code esta instalado.
export function detectClaude(): Promise<ClaudeStatus> {
  if (claudeCache && Date.now() - claudeCache.at < 60_000) return Promise.resolve(claudeCache.value);
  const spec = resolveProfile("claude");
  return new Promise((resolvePromise) => {
    execFile(spec.file, [...spec.args, "--version"], { timeout: 8000, windowsHide: true, env: cleanEnv }, (err, stdout) => {
      const line = String(stdout ?? "").trim().split(/\r?\n/)[0] ?? "";
      const value: ClaudeStatus =
        err || !line
          ? { installed: false }
          : { installed: true, version: line.split(/\s+/)[0], path: path.isAbsolute(spec.file) && spec.file.toLowerCase().endsWith("claude.exe") ? spec.file : undefined };
      claudeCache = { at: Date.now(), value };
      resolvePromise(value);
    });
  });
}
