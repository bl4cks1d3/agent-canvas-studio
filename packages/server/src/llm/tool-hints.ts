import { GOOGLE_SERVER } from "../integrations/google-workspace";

/**
 * Ferramentas de LEITURA que um agente precisa chamar so para descobrir ids (a de tarefas exige o id da lista; a de agenda, o da agenda).
 * Sem elas o agente tenta descobrir, e a negacao vira "as tarefas nao estao acessiveis". Nao abrem nenhum dado alem do que a ferramenta
 * marcada ja abre: so listam as listas/agendas.
 */
const COMPANIONS: Record<string, string[]> = {
  list_tasks: ["list_task_lists"],
  get_task: ["list_task_lists", "list_tasks"],
  get_events: ["list_calendars"],
};

/** As ferramentas marcadas no agente + as de descoberta dos mesmos servidores MCP (sem repetir). */
export function withCompanions(tools: string[]): string[] {
  const out = new Set(tools);
  for (const t of tools) {
    const m = /^(mcp__.+?__)(.+)$/.exec(t);
    if (m) for (const extra of COMPANIONS[m[2]] ?? []) out.add(m[1] + extra);
  }
  return Array.from(out);
}

/** Dicas de uso que evitam o modelo pedir login, e-mail ou ids que o sistema ja resolve. */
export function toolHints(tools: string[]): string {
  if (!tools.some((t) => t.startsWith(`mcp__${GOOGLE_SERVER}__`))) return "";
  return (
    '\n\nNotas sobre as ferramentas do Google: a conta Google JÁ está conectada. Nunca peça login, autorização, conexão nem o e-mail do usuário (o sistema preenche). ' +
    'Lista de tarefas padrão: task_list_id "@default" (se preferir, descubra com list_task_lists). Agenda principal: calendar_id "primary".'
  );
}
