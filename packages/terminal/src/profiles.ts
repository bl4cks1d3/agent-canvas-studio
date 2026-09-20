import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanEnv } from "./env.js";

export const PROFILE_IDS = ["studio", "claude", "canvas", "shell"] as const;
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

// Perfil "Studio": o Claude que controla a aplicacao inteira pelo MCP agent-canvas (dados, componentes, paginas, pacotes, tema e agentes).
// Mesmas regras de escrita do texto acima: sem aspas nem metacaracteres de shell (& | < > ^ %), vai como UM argumento.
const STUDIO_PROMPT =
  "Modo Studio: voce e o assistente que controla o Agent Canvas Studio inteiro pelo MCP agent-canvas. O usuario pede em portugues e voce constroi: colecoes de dados e registros, componentes visuais, paginas do dashboard, pacotes da Biblioteca com save_package, tema e orquestracoes de agentes. " +
  "Antes de criar chame studio_guide para dashboards, componentes e dados, ou canvas_guide para agentes, e siga o fluxo: corrija todos os warnings do save_block. Reaproveite o que ja existe com os list_. " +
  "Voce pode criar de ponta a ponta: colecoes, componentes com save_block, paginas com save_page ou place_block, e bibliotecas com save_package seguido de install_package para aparecerem no Dashboard. Para componentes que usam o Google, descubra os nomes exatos das ferramentas com list_external_tools e coloque em permissions.tools. " +
  "Regras: componentes criados por voce ficam aguardando a aprovacao do usuario, nunca aprove. Nao execute canvases de verdade, run_canvas so simula. Nao apague nada sem o usuario pedir. " +
  "Para o Google (Agenda, Gmail e Tasks) e outros servidores conectados ao app use list_external_tools e describe_external_tool para descobrir, read_external_tool para ler e call_external_tool para alterar. A conta Google ja esta conectada: nunca peca login nem e-mail. " +
  "Concluir tarefa no Google Tasks: call_external_tool com mcp__google-workspace__manage_task, action update, task_list_id igual a @default, o task_id da tarefa e status completed. So altere dados do Google (concluir, criar, enviar) quando o usuario pedir. " +
  "Para tarefas e agenda do Google prefira google_tasks, google_events e google_calendars: devolvem dados estruturados (JSON), sem ler texto. google_task_set conclui ou reabre varias de uma vez. As tarefas da Rotina (rotina_tarefas) e o Google Tasks podem ser mantidos em sincronia com sync_google_tasks; nao copie tarefas de um lado para o outro na mao. " +
  "Nao pergunte nem adivinhe a hora: chame now (fuso local). Campos de data/hora com default sao preenchidos pelo servidor ao criar o registro, entao nao os envie. Para varias alteracoes de uma vez use save_records (tudo ou nada); registro apagado vai para a lixeira e volta com restore_record. " +
  "Nunca leia, edite nem mostre o arquivo .env, chaves ou tokens: as chaves sao cadastradas pelo usuario na tela Configuracoes. So altere o codigo do proprio projeto se o usuario pedir. " +
  "Responda sempre em portugues, de forma curta, e diga o que criou e o que o usuario precisa aprovar.";

// Ferramentas do MCP liberadas sem perguntar a cada uso: leitura, criacao e edicao. Ficam de fora (o Claude Code pergunta): delete_* e run_canvas.
const STUDIO_ALLOWED = [
  "studio_guide", "canvas_guide", "canvas_nodes", "canvas_runs", "block_versions", "get_theme", "set_theme",
  "now", "list_trash", "google_tasks", "google_events", "google_calendars",
  "list_collections", "list_records", "list_blocks", "get_block", "list_pages", "list_packages", "list_canvases", "get_canvas",
  "save_collection", "save_record", "save_records", "restore_record", "save_block", "save_page", "place_block", "save_package", "save_canvas",
  // consulta as ferramentas externas (Google etc.); usar read_/call_external_tool continua pedindo a sua confirmacao
  "list_external_tools", "describe_external_tool",
  // instala o pacote que ele mesmo criou (componentes nascem sem aprovacao); uninstall_package continua pedindo confirmacao
  "install_package",
].map((t) => `mcp__agent-canvas__${t}`);

// So o servidor agent-canvas (sem os MCPs globais do usuario, nem o do Google, que dependem de chaves): arquivo fixo, sem segredo, em data/ (fora do git).
function studioMcpConfig(): string {
  const file = path.join(REPO_ROOT, "data", "studio-mcp.json");
  const config = { mcpServers: { "agent-canvas": { command: "node", args: [path.join(REPO_ROOT, "packages", "mcp", "dist", "index.js")] } } };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n", "utf8");
  return file;
}

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
    case "studio":
      return claudeSpec(["--append-system-prompt", STUDIO_PROMPT, "--strict-mcp-config", "--mcp-config", studioMcpConfig(), "--allowedTools", ...STUDIO_ALLOWED], "Claude · Studio");
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
