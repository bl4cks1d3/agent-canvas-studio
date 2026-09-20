"use client";

import { useEffect, useState } from "react";
import { createTerminalSession, deleteTerminalSession, getClaudeStatus, listTerminalSessions, type ClaudeStatus, type TerminalProfile, type TerminalSession } from "@/lib/terminal-api";
import TerminalPane from "./TerminalPane";

const KEY = "agent-canvas.terminal.session";

/** Terminal de verdade (PTY) no rodape: Claude Code ja orientado a montar canvases pelo MCP, Claude Code puro ou shell. */
export default function TerminalDock() {
  const [session, setSession] = useState<TerminalSession | null>(null);
  const [claude, setClaude] = useState<ClaudeStatus | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let dead = false;
    getClaudeStatus().then((c) => !dead && setClaude(c)).catch(() => undefined);
    (async () => {
      try {
        const saved = window.localStorage.getItem(KEY);
        const list = await listTerminalSessions();
        const found = list.find((s) => s.id === saved && !s.exited);
        if (!dead) setSession(found ?? null);
      } catch {
        if (!dead) setError("O serviço de terminal não responde (pnpm dev:terminal).");
      } finally {
        if (!dead) setLoading(false);
      }
    })();
    return () => {
      dead = true;
    };
  }, []);

  async function open(profile: TerminalProfile) {
    setError("");
    try {
      const s = await createTerminalSession(profile, 110, 18);
      window.localStorage.setItem(KEY, s.id);
      setSession(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function close() {
    if (!session) return;
    await deleteTerminalSession(session.id).catch(() => undefined);
    window.localStorage.removeItem(KEY);
    setSession(null);
  }

  const noClaude = claude !== null && !claude.installed;
  return (
    <div className="term">
      <div className="term-bar">
        {!session && (
          <>
            <button className="btn btn-primary" disabled={noClaude || loading} onClick={() => void open("studio")} title="Claude Code com o MCP do Studio: cria dados, componentes, páginas, pacotes, tema e agentes">
              Claude — controlar o Studio
            </button>
            <button className="btn" disabled={noClaude || loading} onClick={() => void open("canvas")} title="Claude Code orientado a montar canvases de agentes pelo MCP">
              Claude — montar canvases
            </button>
            <button className="btn" disabled={noClaude || loading} onClick={() => void open("claude")}>
              Claude Code
            </button>
            <button className="btn" disabled={loading} onClick={() => void open("shell")}>
              Shell
            </button>
            {noClaude && <span className="help">Claude Code não instalado.</span>}
          </>
        )}
        {session && (
          <>
            <b>{session.title}</b>
            <span className="help">{session.cwd}</span>
            <span style={{ flex: 1 }} />
            <button className="btn" onClick={() => void close()}>
              Encerrar terminal
            </button>
          </>
        )}
        {error && <span className="err">{error}</span>}
      </div>
      <div className="term-host">
        {session ? (
          <TerminalPane sessionId={session.id} autoFocus />
        ) : (
          <div className="empty" style={{ color: "#9a9ca4" }}>
            Abra o Claude aqui e peça em português o que quiser no Studio: dashboards, componentes, dados, pacotes ou um time de agentes. Ele cria pelo MCP e você vê aparecer na tela; componentes novos esperam a sua aprovação.
          </div>
        )}
      </div>
    </div>
  );
}
