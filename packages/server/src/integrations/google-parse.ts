// Transforma as respostas em TEXTO do servidor MCP do Google (workspace-mcp) em dados estruturados. Sem dependencias: e testado
// direto por scripts/test-google-parse.mjs. Quando o formato do servidor mudar, o conserto e so aqui (e nao em cada componente/agente).

export interface GoogleTask {
  id: string;
  title: string;
  /** open = pendente, done = concluida (o Google so tem esses dois estados). */
  status: "open" | "done";
  /** AAAA-MM-DD */
  due?: string;
  /** Quando foi concluida (ISO). */
  completedAt?: string;
}

export interface GoogleEvent {
  id: string;
  title: string;
  /** ISO com hora, ou AAAA-MM-DD para evento de dia inteiro. */
  start: string;
  end: string;
  allDay: boolean;
  meet: boolean;
  calendarId: string;
}

export interface GoogleCalendar {
  id: string;
  name: string;
  primary: boolean;
}

const lines = (text: string) => String(text ?? "").split(/\r?\n/);

/** Motivo pelo qual a resposta NAO e dado (pede login, erro do Google...), ou undefined se parece uma resposta normal. */
export function googleProblem(text: string): string | undefined {
  const t = String(text ?? "");
  if (/accounts\.google\.com|authoriz|autoriz/i.test(t)) return "A conta Google precisa de login: abra Configurações → Conta Google.";
  if (/^\s*(error|erro|failed)|not found|invalid|exception|unauthor|HttpError/i.test(t.slice(0, 300))) return t.trim().slice(0, 200);
  return undefined;
}

/** "- Titulo (ID: abc)" seguido de linhas "  Status: needsAction", "  Due: 2026-09-30...", "  Completed: ...". */
export function parseTasks(text: string): GoogleTask[] {
  const out: GoogleTask[] = [];
  let cur: GoogleTask | null = null;
  for (const l of lines(text)) {
    const t = /^-\s+(.*?)\s+\(ID:\s*([^)]+)\)\s*$/.exec(l);
    if (t) {
      cur = { title: t[1], id: t[2].trim(), status: "open" };
      out.push(cur);
      continue;
    }
    const k = /^\s+(Status|Due|Completed):\s*(.*)$/.exec(l);
    if (!k || !cur) continue;
    const value = k[2].trim();
    if (k[1] === "Status") cur.status = /^completed$/i.test(value) ? "done" : "open";
    else if (k[1] === "Due") cur.due = /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0];
    else cur.completedAt = value;
  }
  return out;
}

/** '- "Titulo" (Starts: ..., Ends: ...) ID: x Meeting: link' */
export function parseEvents(text: string, calendarId: string): GoogleEvent[] {
  const out: GoogleEvent[] = [];
  for (const l of lines(text)) {
    const m = /^\s*-\s+"(.*)"\s+\(Starts:\s*([^\s,\]]+)(?:\s*\[[^\]]*\])?,\s*Ends:\s*([^\s,\]]+)(?:\s*\[[^\]]*\])?\)(.*)$/.exec(l);
    if (!m) continue;
    const id = /ID:\s*(\S+)/.exec(m[4]);
    out.push({
      id: id ? id[1] : `${m[1]}${m[2]}`,
      title: m[1],
      start: m[2],
      end: m[3],
      allDay: /^\d{4}-\d{2}-\d{2}$/.test(m[2]),
      meet: /Meeting:\s*\S+/i.test(m[4]),
      calendarId,
    });
  }
  return out;
}

/** '- "Nome" (Primary) (ID: xxx)' ou '- "Nome" (ID: xxx)' */
export function parseCalendars(text: string): GoogleCalendar[] {
  const out: GoogleCalendar[] = [];
  for (const l of lines(text)) {
    const m = /^\s*-\s+"(.*)"(\s+\(Primary\))?\s+\(ID:\s*(\S+)\)/.exec(l);
    if (m) out.push({ id: m[2] ? "primary" : m[3], name: m[2] ? "Principal" : m[1], primary: !!m[2] });
  }
  return out;
}

/** Id de uma tarefa recem-criada, quando a resposta da criacao o traz ("... (ID: xxx)"). */
export function createdTaskId(text: string): string | undefined {
  return /\bID:\s*([^\s),]+)/.exec(String(text ?? ""))?.[1];
}
