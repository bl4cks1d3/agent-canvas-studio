"use client";

import { useEffect, useRef } from "react";
import { SERVER } from "./api";

/** Espelha ChangesService do servidor. `all` = perdi a conexao e voltei: qualquer coisa pode ter mudado. */
export type ChangeType = "data" | "blocks" | "pages" | "canvases" | "packages" | "theme";
export interface ChangeEvent {
  type: ChangeType | "all";
  key?: string;
}

type Listener = (c: ChangeEvent) => void;

const listeners = new Set<Listener>();
let source: EventSource | null = null;
let opened = false;

const emit = (c: ChangeEvent) => listeners.forEach((l) => l(c));

/** Uma unica conexao GET /events compartilhada por toda a tela; fecha quando ninguem mais escuta. */
function connect() {
  if (source || typeof EventSource === "undefined") return;
  source = new EventSource(`${SERVER}/events`);
  source.onopen = () => {
    // reconexao: pode ter perdido avisos enquanto estava fora do ar
    if (opened) emit({ type: "all" });
    opened = true;
  };
  source.onmessage = (e) => {
    try {
      const c = JSON.parse(e.data) as ChangeEvent;
      if (c && typeof c.type === "string") emit(c);
    } catch {
      // mensagem que nao e mudanca
    }
  };
}

/** Escuta mudancas (do Claude, de agentes ou de outra aba). Devolve a funcao que cancela. */
export function onChange(cb: Listener): () => void {
  listeners.add(cb);
  connect();
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && source) {
      source.close();
      source = null;
      opened = false;
    }
  };
}

/**
 * Chama `cb` quando mudar algo dos tipos pedidos (ou apos reconectar). Varias mudancas seguidas viram uma chamada so.
 * `match` refina por chave (ex.: so a colecao "tarefas"); sem ele qualquer mudanca do tipo dispara.
 */
export function useOnChange(types: ChangeType[], cb: () => void, match?: (c: ChangeEvent) => boolean, debounceMs = 150) {
  const cbRef = useRef(cb);
  const matchRef = useRef(match);
  cbRef.current = cb;
  matchRef.current = match;
  const typesKey = types.join(",");
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = onChange((c) => {
      if (c.type !== "all" && !typesKey.split(",").includes(c.type)) return;
      if (c.type !== "all" && matchRef.current && !matchRef.current(c)) return;
      clearTimeout(timer);
      timer = setTimeout(() => cbRef.current(), debounceMs);
    });
    return () => {
      clearTimeout(timer);
      off();
    };
  }, [typesKey, debounceMs]);
}
