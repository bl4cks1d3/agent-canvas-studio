"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { runBridgeCall, useStudioTheme, type BlockPermissions } from "@/lib/studio-api";
import { buildSrcDoc, newNonce } from "@/lib/block-runtime";
import { useOnChange } from "@/lib/changes";
import { useTheme } from "@/lib/theme";

export interface FrameBlock {
  id?: string;
  config?: Record<string, unknown>;
  html: string;
  css: string;
  js: string;
  permissions: BlockPermissions;
  approved: boolean;
  refreshSeconds: number;
}

export interface FrameLog {
  level: "log" | "error";
  text: string;
  at: number;
}

interface Props {
  block: FrameBlock;
  /** Mudar este numero recarrega o bloco do zero (novo iframe). */
  reloadKey?: number;
  onLog?: (log: FrameLog) => void;
  /** Profundidade de modais (bloco = 0). Passa de 2, ctx.ui.modal e recusado. */
  depth?: number;
  /** So existe quando este iframe e o conteudo de um modal: ctx.close(valor). */
  onCloseModal?: (value: unknown) => void;
  onSize?: (height: number) => void;
}

interface ModalEntry {
  id: number;
  title: string;
  html: string;
  css: string;
  js: string;
  width: number;
  fixedHeight?: number;
  height: number;
  /** So aparece depois do primeiro relato de tamanho: evita o "flash" de um modal grande e em branco. */
  ready: boolean;
  resolve: (value: unknown) => void;
}

interface DialogEntry {
  id: number;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
  resolve: (value: boolean) => void;
}

interface ToastEntry {
  id: number;
  text: string;
  kind: string;
}

const MAX_CALLS = 120;
const WINDOW_MS = 5000;
const MAX_DEPTH = 2;
const MAX_MODAL_TEXT = 100_000;
const SIZES = { sm: 420, md: 560, lg: 820 } as const;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/**
 * Executa um bloco num iframe `sandbox="allow-scripts"` (origem opaca: sem
 * cookies, sem localStorage, sem acesso ao dashboard) com CSP sem rede. O
 * unico caminho para dados e ferramentas e esta ponte, que confere as
 * permissoes do bloco a cada chamada. Modais (ctx.ui.modal) abrem por cima
 * de todo o dashboard, em outro iframe isolado que HERDA as permissoes do
 * bloco que o abriu -- nunca mais que isso.
 */
export default function BlockFrame({ block, reloadKey = 0, onLog, depth = 0, onCloseModal, onSize }: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const blockRef = useRef(block);
  blockRef.current = block;
  const onLogRef = useRef(onLog);
  onLogRef.current = onLog;
  const onCloseRef = useRef(onCloseModal);
  onCloseRef.current = onCloseModal;
  const onSizeRef = useRef(onSize);
  onSizeRef.current = onSize;
  const calls = useRef<number[]>([]);
  const nextId = useRef(1);

  const [modals, setModals] = useState<ModalEntry[]>([]);
  const [dialogs, setDialogs] = useState<DialogEntry[]>([]);
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const modalsRef = useRef(modals);
  modalsRef.current = modals;
  const dialogsRef = useRef(dialogs);
  dialogsRef.current = dialogs;

  const theme = useTheme();
  const tokens = useStudioTheme();
  const runnable = block.approved;
  const nonce = useMemo(() => newNonce(), [reloadKey]);
  const srcDoc = useMemo(
    () => (runnable ? buildSrcDoc(block, nonce, theme, tokens) : ""),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runnable, block.html, block.css, block.js, JSON.stringify(block.config ?? {}), nonce, theme, tokens.accent, tokens.radius, tokens.fontSize, tokens.density]
  );

  function closeModal(id: number, value: unknown) {
    const entry = modalsRef.current.find((m) => m.id === id);
    if (!entry) return;
    setModals((prev) => prev.filter((m) => m.id !== id));
    entry.resolve(value);
  }

  function markReady(id: number) {
    setModals((prev) => prev.map((x) => (x.id === id && !x.ready ? { ...x, ready: true } : x)));
  }

  function closeDialog(id: number, value: boolean) {
    const entry = dialogsRef.current.find((d) => d.id === id);
    if (!entry) return;
    setDialogs((prev) => prev.filter((d) => d.id !== id));
    entry.resolve(value);
  }

  useEffect(() => {
    function reply(message: Record<string, unknown>) {
      frameRef.current?.contentWindow?.postMessage({ __ac: 1, ...message }, "*");
    }

    function handleUi(method: string, args: unknown[]): Promise<unknown> | unknown {
      if (method === "ui.close") {
        if (!onCloseRef.current) throw new Error("ctx.close só existe dentro de um modal");
        onCloseRef.current(args[0] ?? null);
        return true;
      }
      if (method === "ui.toast") {
        const id = nextId.current++;
        const text = str(args[0], 200);
        const kind = ["ok", "warn", "error"].includes(String(args[1])) ? String(args[1]) : "info";
        setToasts((prev) => [...prev.slice(-3), { id, text, kind }]);
        setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
        return true;
      }
      if (method === "ui.confirm") {
        const opts = (args[1] && typeof args[1] === "object" ? args[1] : {}) as Record<string, unknown>;
        return new Promise<boolean>((resolve) => {
          setDialogs((prev) => [
            ...prev,
            {
              id: nextId.current++,
              message: str(args[0], 500),
              confirmLabel: str(opts.confirmLabel, 40) || "Confirmar",
              cancelLabel: str(opts.cancelLabel, 40) || "Cancelar",
              danger: opts.danger === true,
              resolve,
            },
          ]);
        });
      }
      if (method === "ui.modal") {
        if (depth >= MAX_DEPTH) throw new Error("modais aninhados demais");
        const o = (args[0] && typeof args[0] === "object" ? args[0] : {}) as Record<string, unknown>;
        const size = typeof o.size === "string" && o.size in SIZES ? (o.size as keyof typeof SIZES) : "md";
        const width = clamp(Number(o.width) || SIZES[size], 280, 1000);
        const fixed = Number(o.height) > 0 ? clamp(Number(o.height), 120, 720) : undefined;
        return new Promise<unknown>((resolve) => {
          const id = nextId.current++;
          // se o iframe nunca reportar o tamanho, mostra assim mesmo
          setTimeout(() => markReady(id), 900);
          setModals((prev) => [
            ...prev,
            {
              id,
              title: str(o.title, 120),
              html: str(o.html, MAX_MODAL_TEXT),
              css: str(o.css, MAX_MODAL_TEXT),
              js: str(o.js, MAX_MODAL_TEXT),
              width,
              fixedHeight: fixed,
              height: 160,
              ready: false,
              resolve,
            },
          ]);
        });
      }
      throw new Error(`método desconhecido: ${method}`);
    }

    async function onMessage(event: MessageEvent) {
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      const m = event.data as {
        __ac?: number;
        type?: string;
        id?: number;
        method?: string;
        args?: unknown[];
        level?: string;
        text?: string;
        height?: number;
      };
      if (!m || m.__ac !== 1) return;

      if (m.type === "log") {
        onLogRef.current?.({ level: m.level === "error" ? "error" : "log", text: String(m.text ?? ""), at: Date.now() });
        return;
      }
      if (m.type === "size") {
        if (typeof m.height === "number") onSizeRef.current?.(m.height);
        return;
      }
      if (m.type !== "rpc" || typeof m.id !== "number" || typeof m.method !== "string") return;

      const now = Date.now();
      calls.current = calls.current.filter((t) => now - t < WINDOW_MS);
      if (calls.current.length >= MAX_CALLS) {
        reply({ type: "rpc-result", id: m.id, ok: false, error: "muitas chamadas seguidas" });
        return;
      }
      calls.current.push(now);

      const args = Array.isArray(m.args) ? m.args : [];
      try {
        const result = m.method.startsWith("ui.")
          ? await handleUi(m.method, args)
          : await runBridgeCall(blockRef.current, m.method, args);
        reply({ type: "rpc-result", id: m.id, ok: true, result });
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err);
        reply({ type: "rpc-result", id: m.id, ok: false, error: text });
        onLogRef.current?.({ level: "error", text: `${m.method}: ${text}`, at: Date.now() });
      }
    }

    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      modalsRef.current.forEach((entry) => entry.resolve(undefined));
      dialogsRef.current.forEach((entry) => entry.resolve(false));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!runnable || !block.refreshSeconds || block.refreshSeconds < 5) return;
    const timer = setInterval(() => {
      frameRef.current?.contentWindow?.postMessage({ __ac: 1, type: "refresh" }, "*");
    }, block.refreshSeconds * 1000);
    return () => clearInterval(timer);
  }, [runnable, block.refreshSeconds, nonce]);

  // Claude/agente mudou uma colecao que este componente le (ou a caixa de entrada dele): roda `main` de novo na hora.
  // O intervalo minimo evita laco se o proprio componente grava a cada execucao.
  const lastPush = useRef(0);
  useOnChange(
    ["data", "blocks"],
    () => {
      if (!runnable || Date.now() - lastPush.current < 2000) return;
      lastPush.current = Date.now();
      frameRef.current?.contentWindow?.postMessage({ __ac: 1, type: "refresh" }, "*");
    },
    (c) => (c.type === "data" ? c.key === undefined || block.permissions.read.includes(`col:${c.key}`) : c.key === block.id),
    250
  );

  // Esc fecha o modal/confirmacao do topo
  useEffect(() => {
    if (modals.length === 0 && dialogs.length === 0) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (dialogsRef.current.length) closeDialog(dialogsRef.current[dialogsRef.current.length - 1].id, false);
      else if (modalsRef.current.length) closeModal(modalsRef.current[modalsRef.current.length - 1].id, undefined);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modals.length, dialogs.length]);

  if (!runnable) {
    const p = block.permissions;
    return (
      <div className="bframe-pending">
        <strong>Aguardando aprovação</strong>
        <span>Este componente só roda depois que você aprovar as permissões na aba Componentes.</span>
        <span className="bframe-perms">
          {[p.read.length ? `ler: ${p.read.join(", ")}` : "", p.write.length ? `gravar: ${p.write.join(", ")}` : "", p.tools.length ? `ferramentas: ${p.tools.join(", ")}` : ""]
            .filter(Boolean)
            .join(" · ") || "sem permissões pedidas"}
        </span>
      </div>
    );
  }

  const maxH = typeof window === "undefined" ? 600 : Math.floor(window.innerHeight * 0.75);
  const hasLayers = modals.length > 0 || dialogs.length > 0 || toasts.length > 0;

  return (
    <>
      <iframe
        ref={frameRef}
        className="bframe"
        sandbox="allow-scripts"
        srcDoc={srcDoc}
        title="componente"
        onLoad={() => onCloseModal && frameRef.current?.focus()}
      />
      {hasLayers &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            {modals.map((m, i) => (
              <div
                key={m.id}
                className="bmodal-backdrop"
                style={{ zIndex: 1000 + i }}
                onMouseDown={(e) => e.target === e.currentTarget && closeModal(m.id, undefined)}
              >
                <div className="bmodal" style={{ width: m.width, visibility: m.ready ? "visible" : "hidden" }}>
                  <div className="bmodal-bar">
                    <span>{m.title}</span>
                    <button onClick={() => closeModal(m.id, undefined)} title="Fechar (Esc)">
                      ×
                    </button>
                  </div>
                  <div className="bmodal-body" style={{ height: m.fixedHeight ?? clamp(m.height, 120, maxH) }}>
                    <BlockFrame
                      block={{ id: blockRef.current.id, config: blockRef.current.config, html: m.html, css: m.css, js: m.js, permissions: blockRef.current.permissions, approved: true, refreshSeconds: 0 }}
                      depth={depth + 1}
                      onLog={onLog}
                      onCloseModal={(value) => closeModal(m.id, value)}
                      onSize={(h) => {
                        setModals((prev) => prev.map((x) => (x.id === m.id && x.height !== h ? { ...x, height: h } : x)));
                        setTimeout(() => markReady(m.id), 80);
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
            {dialogs.map((d, i) => (
              <div key={d.id} className="bmodal-backdrop" style={{ zIndex: 1100 + i }} onMouseDown={(e) => e.target === e.currentTarget && closeDialog(d.id, false)}>
                <div className="bmodal bmodal-confirm">
                  <div className="bmodal-message">{d.message}</div>
                  <div className="bmodal-actions">
                    <button className="btn" onClick={() => closeDialog(d.id, false)}>
                      {d.cancelLabel}
                    </button>
                    <button className="btn btn-primary" onClick={() => closeDialog(d.id, true)}>
                      {d.confirmLabel}
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {toasts.length > 0 && (
              <div className="btoast-stack">
                {toasts.map((t) => (
                  <div key={t.id} className={`btoast btoast-${t.kind}`}>
                    {t.text}
                  </div>
                ))}
              </div>
            )}
          </>,
          document.body
        )}
    </>
  );
}
