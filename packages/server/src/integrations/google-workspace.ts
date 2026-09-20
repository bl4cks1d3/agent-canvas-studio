import type { ToolInfo } from "@agent-canvas/shared";

/** Nome do servidor no .mcp.json (as ferramentas viram mcp__google-workspace__*) e do pacote da Biblioteca. */
export const GOOGLE_SERVER = "google-workspace";
export const GOOGLE_PACKAGE = "google-workspace";
export const GOOGLE_MCP = { command: "uvx", args: ["workspace-mcp", "--tools", "calendar", "gmail", "tasks"] };
export const ENV_ID = "GOOGLE_OAUTH_CLIENT_ID";
export const ENV_SECRET = "GOOGLE_OAUTH_CLIENT_SECRET";
export const ENV_EMAIL = "USER_GOOGLE_EMAIL";

export const CLIENT_ID_RE = /^[A-Za-z0-9._-]{10,200}\.apps\.googleusercontent\.com$/;
export const CLIENT_SECRET_RE = /^[A-Za-z0-9_-]{10,200}$/;
export const EMAIL_RE = /^[^\s@"'#=]{1,64}@[^\s@"'#=]{1,190}\.[^\s@"'#=]{2,}$/;

/** Troca (ou acrescenta) KEY=valor num texto .env, preservando comentarios, ordem e as outras chaves. */
export function upsertEnv(text: string, entries: Record<string, string>): string {
  const lines = text.split(/\r?\n/);
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  const done = new Set<string>();
  const out = lines.map((line) => {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (m && Object.prototype.hasOwnProperty.call(entries, m[1])) {
      done.add(m[1]);
      return `${m[1]}=${entries[m[1]]}`;
    }
    return line;
  });
  for (const [k, v] of Object.entries(entries)) if (!done.has(k)) out.push(`${k}=${v}`);
  return out.join("\n") + "\n";
}

/** Primeiro link de login do Google num texto (so accounts.google.com: e o unico destino que o botao abre). */
export function extractAuthUrl(text: string): string | undefined {
  const m = /https:\/\/accounts\.google\.com\/[^\s"'<>)\]\\]+/.exec(text);
  return m ? m[0].replace(/[.,;:]+$/, "") : undefined;
}

const WRITE = /send|draft|delete|remove|modify|create|insert|update|manage|move|clear|batch|import|share|watch|attachment|content|label|filter|reply|forward/;

/** Cada requisito do pacote Google Workspace -> preferencias de nome (da mais especifica a mais generica). */
const RULES: Array<{ id: string; prefer: RegExp[]; allowWrite?: boolean }> = [
  { id: "calendario_listar", prefer: [/^(get|list|search)_events?$/, /^(get|list|search)_.*events?/] },
  { id: "gmail_buscar", prefer: [/^search_gmail_messages$/, /^search_.*(gmail|mail|message)/, /^(list|get)_.*(gmail|message)s?$/] },
  { id: "tarefas_listar", prefer: [/^list_tasks$/, /^(list|get)_tasks?$/] },
  // manage_task (workspace-mcp recente) cria, atualiza e conclui pelo parametro `action`
  { id: "tarefas_criar", prefer: [/^create_task$/, /^manage_task$/], allowWrite: true },
  { id: "tarefas_concluir", prefer: [/^complete_task$/, /^update_task$/, /^patch_task$/, /^manage_task$/], allowWrite: true },
];

/** Mapeia as ferramentas REAIS do servidor do Google aos requisitos do pacote; so devolve o que achou (nada e inventado). */
export function pickTools(tools: ToolInfo[]): Record<string, string> {
  const own = tools.filter((t) => t.source === `mcp:${GOOGLE_SERVER}`);
  const short = (t: ToolInfo) => t.name.slice(`mcp__${GOOGLE_SERVER}__`.length).toLowerCase();
  const out: Record<string, string> = {};
  for (const rule of RULES) {
    for (const re of rule.prefer) {
      const hit = own.find((t) => re.test(short(t)) && (rule.allowWrite || !WRITE.test(short(t))));
      if (hit) {
        out[rule.id] = hit.name;
        break;
      }
    }
  }
  return out;
}

/** A ferramenta que inicia o login, se o servidor tiver uma (o nome varia entre versoes). */
export function findAuthTool(tools: ToolInfo[]): ToolInfo | undefined {
  return tools.find((t) => t.source === `mcp:${GOOGLE_SERVER}` && /auth/i.test(t.name) && !/revoke|logout|status|check/i.test(t.name));
}

/** Monta argumentos so com os parametros que a ferramenta declara (o resto o servidor completa ou reclama, e o texto vai para a tela). */
export function buildArgs(tool: ToolInfo, ctx: { email?: string; today: string }): Record<string, unknown> {
  const mail = /gmail|mail|message/i.test(tool.name);
  const values: Record<string, unknown> = {
    user_google_email: ctx.email,
    email: ctx.email,
    calendar_id: "primary",
    max_results: 5,
    page_size: 5,
    query: mail ? "in:inbox" : undefined,
    time_min: ctx.today,
    service_name: "calendar",
  };
  const out: Record<string, unknown> = {};
  for (const p of tool.params) if (values[p] !== undefined && values[p] !== "") out[p] = values[p];
  return out;
}
