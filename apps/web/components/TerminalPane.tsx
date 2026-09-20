"use client";

import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";
import { terminalWsUrl } from "@/lib/terminal-api";

export type PaneStatus = "conectando" | "conectado" | "encerrado" | "desconectado";

interface Props {
  sessionId: string;
  autoFocus?: boolean;
  onStatus?: (status: PaneStatus) => void;
  /** Tamanho da fonte em px (o canvas escala com o zoom); ao mudar, o terminal reajusta colunas/linhas. */
  fontSize?: number;
}

/**
 * Um terminal de verdade (xterm.js) ligado por WebSocket a uma sessao PTY do
 * servico de terminal. Desmontar so fecha o WebSocket: o processo continua
 * vivo no servidor e o historico e reenviado ao reconectar.
 */
export default function TerminalPane({ sessionId, autoFocus, onStatus, fontSize = 13 }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<{ focus: () => void; options: { fontSize?: number } } | null>(null);
  const fitRef = useRef<() => void>(() => undefined);
  const fontRef = useRef(fontSize);
  fontRef.current = fontSize;
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  const autoFocusRef = useRef(autoFocus);
  autoFocusRef.current = autoFocus;

  useEffect(() => {
    const term = termRef.current;
    if (!term || term.options.fontSize === fontSize) return;
    term.options.fontSize = fontSize;
    fitRef.current();
  }, [fontSize]);

  // Foco e imperativo: recriar o terminal a cada troca de foco (como acontecia
  // quando autoFocus era dependencia do efeito abaixo) perde selecao e teclas.
  useEffect(() => {
    if (autoFocus) termRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    let disposed = false;
    let cleanup: () => void = () => undefined;

    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
      const host = hostRef.current;
      if (disposed || !host) return;

      const term = new Terminal({
        fontFamily: '"Cascadia Mono", ui-monospace, Menlo, Consolas, monospace',
        fontSize: fontRef.current,
        cursorBlink: true,
        scrollback: 5000,
        theme: {
          background: "#14151a",
          foreground: "#e6e6ea",
          cursor: "#ec3013",
          selectionBackground: "#3a3d4a",
        },
      });
      const fit = new FitAddon();
      termRef.current = term;
      term.loadAddon(fit);
      term.open(host);
      const safeFit = () => {
        try {
          fit.fit();
        } catch {
          // container ainda sem tamanho (aba escondida)
        }
      };
      fitRef.current = () => {
        safeFit();
        sendResize();
      };
      safeFit();

      // Ctrl+C com texto selecionado copia (como em qualquer terminal grafico);
      // sem selecao, segue como interrupcao (SIGINT) para o processo.
      term.attachCustomKeyEventHandler((e) => {
        if (e.type === "keydown" && e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "c" && term.hasSelection()) {
          void navigator.clipboard.writeText(term.getSelection());
          return false;
        }
        return true;
      });

      onStatusRef.current?.("conectando");
      const ws = new WebSocket(terminalWsUrl(sessionId, term.cols, term.rows));
      let exited = false;

      ws.onopen = () => onStatusRef.current?.("conectado");
      ws.onmessage = (event) => {
        let message: { type?: string; data?: string; code?: number };
        try {
          message = JSON.parse(event.data as string);
        } catch {
          return;
        }
        if (message.type === "output" && typeof message.data === "string") {
          term.write(message.data);
        } else if (message.type === "exit") {
          exited = true;
          term.write(`\r\n\x1b[90m[processo encerrado, código ${message.code ?? "?"}]\x1b[0m\r\n`);
          onStatusRef.current?.("encerrado");
        }
      };
      ws.onclose = () => {
        if (!exited && !disposed) {
          term.write("\r\n\x1b[90m[conexão com o serviço de terminal perdida]\x1b[0m\r\n");
          onStatusRef.current?.("desconectado");
        }
      };

      const sendResize = () => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
      };
      const dataSub = term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input", data }));
      });

      let frame = 0;
      const observer = new ResizeObserver(() => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          safeFit();
          sendResize();
        });
      });
      observer.observe(host);

      if (autoFocusRef.current) term.focus();

      cleanup = () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        dataSub.dispose();
        ws.close();
        term.dispose();
        if (termRef.current === term) termRef.current = null;
      };
    })();

    return () => {
      disposed = true;
      cleanup();
    };
  }, [sessionId]);

  return <div ref={hostRef} className="tnode-term" />;
}
