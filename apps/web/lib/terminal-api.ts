const TERMINAL_URL = process.env.NEXT_PUBLIC_TERMINAL_URL ?? "http://127.0.0.1:5300";

export type TerminalProfile = "studio" | "claude" | "canvas" | "shell";

export interface TerminalSession {
  id: string;
  profile: TerminalProfile;
  title: string;
  cwd: string;
  createdAt: string;
  exited: boolean;
  exitCode?: number;
  clients: number;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${TERMINAL_URL}${path}`, {
    ...init,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `terminal respondeu ${res.status}`);
  return body as T;
}

export interface ClaudeStatus {
  installed: boolean;
  version?: string;
  path?: string;
}

export function getClaudeStatus(): Promise<ClaudeStatus> {
  return request<ClaudeStatus>("/claude");
}

export function listTerminalSessions(): Promise<TerminalSession[]> {
  return request<TerminalSession[]>("/sessions");
}

export function createTerminalSession(profile: TerminalProfile, cols: number, rows: number): Promise<TerminalSession> {
  return request<TerminalSession>("/sessions", { method: "POST", body: JSON.stringify({ profile, cols, rows }) });
}

export function deleteTerminalSession(id: string): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/sessions/${id}`, { method: "DELETE" });
}

export function terminalWsUrl(sessionId: string, cols: number, rows: number): string {
  const url = new URL(TERMINAL_URL);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/pty";
  url.search = new URLSearchParams({ session: sessionId, cols: String(cols), rows: String(rows) }).toString();
  return url.toString();
}
