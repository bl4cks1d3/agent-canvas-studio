import type { ToolInfo } from "@agent-canvas/shared";
import { createdTaskId, googleProblem, parseCalendars, parseEvents, parseTasks } from "../integrations/google-parse";
import { pickTools, GOOGLE_SERVER } from "../integrations/google-workspace";
import type { BuiltinTool } from "./builtin";
import type { McpManager } from "./mcp-manager";

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, ...(required.length ? { required } : {}) });
const DAY = 86_400_000;

/**
 * Google Tasks e Agenda com resposta ESTRUTURADA (JSON), para o Claude e os agentes nao precisarem ler o texto do servidor do Google.
 * Usam o mesmo servidor MCP conectado (a conta Google ja vem preenchida); se ele nao estiver conectado, dizem isso.
 */
export function googleTools(mcp: McpManager, listTools: () => ToolInfo[]): BuiltinTool[] {
  const full = (short: string) => `mcp__${GOOGLE_SERVER}__${short}`;
  const has = (short: string) => mcp.list().some((t) => t.name === full(short));
  const need = (name: string | undefined, what: string): string => {
    if (!name) throw new Error(`${what}: o servidor do Google Workspace nao esta conectado (Configuracoes -> Conta Google).`);
    return name;
  };
  const text = async (name: string, args: Record<string, unknown>): Promise<string> => {
    const raw = await mcp.call(name, args);
    const t = typeof raw === "string" ? raw : JSON.stringify(raw);
    const problem = googleProblem(t);
    if (problem) throw new Error(problem);
    return t;
  };
  const list = (a: Record<string, unknown>) => (typeof a.list === "string" && a.list ? a.list : "@default");

  return [
    {
      name: "google_tasks_list",
      description:
        "Lista as tarefas do Google Tasks como DADOS: { count, tasks: [{ id, title, status: 'open'|'done', due (AAAA-MM-DD), completedAt }] }. showCompleted=true inclui as concluidas. Use o id em google_task_set.",
      parameters: obj({ list: { type: "string", description: "id da lista; padrao @default" }, showCompleted: { type: "boolean" }, maxResults: { type: "number" } }),
      readOnly: true,
      run: async (a) => {
        const name = need(pickTools(listTools()).tarefas_listar, "google_tasks_list");
        const t = await text(name, { task_list_id: list(a), max_results: Math.min(500, Number(a.maxResults) || 200), show_completed: a.showCompleted !== false, show_hidden: a.showCompleted !== false });
        const all = parseTasks(t);
        if (all.length === 0 && !/Tasks in list|No tasks/i.test(t)) throw new Error(`resposta inesperada do Google Tasks: ${t.slice(0, 120)}`);
        const tasks = a.showCompleted === true ? all : all.filter((x) => x.status === "open");
        return { count: tasks.length, tasks };
      },
    },
    {
      name: "google_task_set",
      description: "Conclui (done=true) ou reabre (done=false) uma tarefa do Google Tasks pelo id (de google_tasks_list). ALTERA a conta do usuario: so quando ele pediu.",
      parameters: obj({ id: { type: "string" }, done: { type: "boolean" }, list: { type: "string" } }, ["id", "done"]),
      readOnly: false,
      run: async (a) => {
        const name = need(pickTools(listTools()).tarefas_concluir, "google_task_set");
        const args = /manage_task$/.test(name)
          ? { action: "update", task_list_id: list(a), task_id: String(a.id), status: a.done === false ? "needsAction" : "completed" }
          : { task_list_id: list(a), task_id: String(a.id), status: a.done === false ? "needsAction" : "completed" };
        await text(name, args);
        return { ok: true, id: String(a.id), status: a.done === false ? "open" : "done" };
      },
    },
    {
      name: "google_task_create",
      description: "Cria uma tarefa no Google Tasks. title obrigatorio; due (AAAA-MM-DD) e notes opcionais. Devolve { ok, id? }. ALTERA a conta do usuario: so quando ele pediu.",
      parameters: obj({ title: { type: "string" }, due: { type: "string" }, notes: { type: "string" }, list: { type: "string" } }, ["title"]),
      readOnly: false,
      run: async (a) => {
        const name = need(pickTools(listTools()).tarefas_criar, "google_task_create");
        const args: Record<string, unknown> = { ...(/manage_task$/.test(name) ? { action: "create" } : {}), task_list_id: list(a), title: String(a.title) };
        if (typeof a.due === "string" && /^\d{4}-\d{2}-\d{2}/.test(a.due)) args.due = `${a.due.slice(0, 10)}T00:00:00.000Z`;
        if (typeof a.notes === "string" && a.notes) args.notes = a.notes;
        const t = await text(name, args);
        return { ok: true, id: createdTaskId(t) };
      },
    },
    {
      name: "google_calendars_list",
      description: "Lista as agendas do Google como DADOS: { calendars: [{ id, name, primary }] }.",
      parameters: obj({}),
      readOnly: true,
      run: async () => {
        if (!has("list_calendars")) throw new Error("google_calendars_list: o servidor do Google Workspace nao esta conectado (Configuracoes -> Conta Google).");
        return { calendars: parseCalendars(await text(full("list_calendars"), {})) };
      },
    },
    {
      name: "google_events_list",
      description:
        "Lista eventos da Agenda do Google como DADOS: { count, events: [{ id, title, start, end, allDay, meet, calendarId }] }. calendar (id; padrao primary), days (a partir de hoje, padrao 7) ou from/to (ISO).",
      parameters: obj({ calendar: { type: "string" }, days: { type: "number" }, from: { type: "string" }, to: { type: "string" }, maxResults: { type: "number" } }),
      readOnly: true,
      run: async (a) => {
        const name = need(pickTools(listTools()).calendario_listar, "google_events_list");
        const calendar = typeof a.calendar === "string" && a.calendar ? a.calendar : "primary";
        const from = typeof a.from === "string" && a.from ? a.from : new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
        const to = typeof a.to === "string" && a.to ? a.to : new Date(Date.parse(from) + Math.max(1, Math.min(365, Number(a.days) || 7)) * DAY).toISOString();
        const t = await text(name, { calendar_id: calendar, time_min: from, time_max: to, max_results: Math.min(250, Number(a.maxResults) || 100), single_events: true });
        if (!/retrieved|No events|Successfully/i.test(t)) throw new Error(`resposta inesperada da Agenda: ${t.slice(0, 120)}`);
        const events = parseEvents(t, calendar);
        return { count: events.length, events };
      },
    },
  ];
}
