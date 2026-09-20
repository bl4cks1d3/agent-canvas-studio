import * as pty from "@lydell/node-pty";
import { randomUUID } from "node:crypto";
import type { RawData, WebSocket } from "ws";
import { cleanEnv } from "./env.js";
import { isProfileId, resolveProfile, type ProfileId } from "./profiles.js";

const MAX_SESSIONS = Number(process.env.TERMINAL_MAX_SESSIONS ?? 8);
const BUFFER_LIMIT = 256 * 1024;
const MAX_INPUT = 64 * 1024;
const DETACHED_TTL_MS = Number(process.env.TERMINAL_IDLE_HOURS ?? 12) * 3_600_000;
const EXITED_TTL_MS = 3_600_000;

export class ProfileError extends Error {}
export class LimitError extends Error {}

interface Session {
  id: string;
  profile: ProfileId;
  title: string;
  cwd: string;
  createdAt: string;
  term: pty.IPty;
  buffer: string;
  clients: Set<WebSocket>;
  exited: boolean;
  exitCode?: number;
  lastActive: number;
}

export interface SessionInfo {
  id: string;
  profile: ProfileId;
  title: string;
  cwd: string;
  createdAt: string;
  exited: boolean;
  exitCode?: number;
  clients: number;
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function send(ws: WebSocket, message: Record<string, unknown>): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

/**
 * As sessoes vivem no servidor, nao na aba do navegador: recarregar a pagina so desconecta o
 * WebSocket; o processo continua rodando, com o historico recente guardado para reanexar.
 */
export class SessionManager {
  private readonly sessions = new Map<string, Session>();

  constructor() {
    setInterval(() => this.reap(), 10 * 60_000).unref();
  }

  list(): SessionInfo[] {
    return [...this.sessions.values()].map((s) => ({
      id: s.id,
      profile: s.profile,
      title: s.title,
      cwd: s.cwd,
      createdAt: s.createdAt,
      exited: s.exited,
      exitCode: s.exitCode,
      clients: s.clients.size,
    }));
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  create(profile: unknown, cols: unknown, rows: unknown): SessionInfo {
    if (!isProfileId(profile)) throw new ProfileError("perfil de terminal invalido");
    if (this.sessions.size >= MAX_SESSIONS) {
      throw new LimitError(`limite de ${MAX_SESSIONS} terminais abertos; feche algum antes de abrir outro`);
    }
    const spec = resolveProfile(profile);
    const c = clamp(cols, 1, 500, 100);
    const r = clamp(rows, 1, 200, 30);
    let term: pty.IPty;
    try {
      term = pty.spawn(spec.file, spec.args, {
        name: "xterm-256color",
        cols: c,
        rows: r,
        cwd: spec.cwd,
        env: { ...cleanEnv, TERM: "xterm-256color", COLORTERM: "truecolor" },
      });
    } catch (err) {
      throw new Error(`nao foi possivel iniciar "${spec.title}": ${err instanceof Error ? err.message : err}`);
    }

    const session: Session = {
      id: randomUUID(),
      profile,
      title: spec.title,
      cwd: spec.cwd,
      createdAt: new Date().toISOString(),
      term,
      buffer: "",
      clients: new Set(),
      exited: false,
      lastActive: Date.now(),
    };

    term.onData((data) => {
      session.buffer += data;
      if (session.buffer.length > BUFFER_LIMIT) {
        const cut = session.buffer.length - BUFFER_LIMIT;
        const nextLine = session.buffer.indexOf("\n", cut);
        session.buffer = session.buffer.slice(nextLine === -1 ? cut : nextLine + 1);
      }
      for (const ws of session.clients) send(ws, { type: "output", data });
    });
    term.onExit(({ exitCode }) => {
      session.exited = true;
      session.exitCode = exitCode;
      session.lastActive = Date.now();
      for (const ws of session.clients) send(ws, { type: "exit", code: exitCode });
    });

    this.sessions.set(session.id, session);
    return this.list().find((s) => s.id === session.id)!;
  }

  attach(session: Session, ws: WebSocket, cols: number, rows: number): void {
    session.clients.add(ws);
    session.lastActive = Date.now();
    send(ws, { type: "ready", id: session.id, profile: session.profile, title: session.title });
    if (session.buffer) send(ws, { type: "output", data: session.buffer });
    if (session.exited) {
      send(ws, { type: "exit", code: session.exitCode });
    } else {
      this.nudge(session, cols, rows);
    }

    ws.on("message", (raw) => this.onMessage(session, raw));
    ws.on("close", () => {
      session.clients.delete(ws);
      session.lastActive = Date.now();
    });
    ws.on("error", () => undefined);
  }

  // Apps de tela cheia (como o Claude Code) so se redesenham quando o
  // tamanho muda; sem isso, reanexar mostraria um quadro velho/cortado.
  private nudge(session: Session, cols: number, rows: number): void {
    this.resize(session, cols, Math.max(rows - 1, 1));
    setTimeout(() => {
      if (!session.exited) this.resize(session, cols, rows);
    }, 60);
  }

  private resize(session: Session, cols: number, rows: number): void {
    try {
      session.term.resize(cols, rows);
    } catch {
      // processo ja encerrou
    }
  }

  private onMessage(session: Session, raw: RawData): void {
    let message: { type?: string; data?: unknown; cols?: unknown; rows?: unknown };
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (session.exited) return;
    if (message.type === "input" && typeof message.data === "string" && message.data.length <= MAX_INPUT) {
      session.lastActive = Date.now();
      session.term.write(message.data);
    } else if (message.type === "resize") {
      this.resize(session, clamp(message.cols, 1, 500, 100), clamp(message.rows, 1, 200, 30));
    }
  }

  kill(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    if (!session.exited) {
      try {
        session.term.kill();
      } catch {
        // ja encerrou
      }
    }
    for (const ws of session.clients) ws.close(1000, "sessao encerrada");
    this.sessions.delete(id);
    return true;
  }

  killAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id);
  }

  private reap(): void {
    const now = Date.now();
    for (const session of [...this.sessions.values()]) {
      if (session.clients.size > 0) continue;
      const idle = now - session.lastActive;
      if ((session.exited && idle > EXITED_TTL_MS) || idle > DETACHED_TTL_MS) this.kill(session.id);
    }
  }
}

export { clamp };
