"use client";

import { useCallback, useEffect, useState } from "react";
import { useOnChange } from "./changes";
import type { Canvas, CanvasEdge, CanvasNode, CanvasRun, Catalog } from "@agent-canvas/shared";

export type { Canvas, CanvasEdge, CanvasNode, CanvasRun, Catalog, NodeLog, NodeSpec, FieldSpec, NodeType, ToolInfo } from "@agent-canvas/shared";

export const SERVER = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:5100";

export type CanvasWithProblems = Canvas & { problems: string[] };

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public problems: string[]
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SERVER}${path}`, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
  if (!res.ok) {
    const problems = Array.isArray(body.message) ? body.message : body.message ? [body.message] : [];
    throw new ApiError(problems.join("; ") || `Servidor respondeu ${res.status}`, res.status, problems);
  }
  return body as T;
}

export const listCanvases = () => api<Canvas[]>("/canvases");
export const getCanvas = (id: string) => api<CanvasWithProblems>(`/canvases/${id}`);
export const getCatalog = () => api<Catalog>("/catalog");
export const createCanvas = (input: { name: string; description?: string; nodes?: unknown[]; edges?: unknown[] }) =>
  api<CanvasWithProblems>("/canvases", { method: "POST", body: JSON.stringify({ ...input, source: "user" }) });
export const saveCanvas = (id: string, input: { name: string; nodes: CanvasNode[]; edges: CanvasEdge[]; baseUpdatedAt?: string }) =>
  api<CanvasWithProblems>(`/canvases/${id}`, { method: "PUT", body: JSON.stringify({ ...input, source: "user" }) });
export const deleteCanvas = (id: string) => api<{ ok: true }>(`/canvases/${id}`, { method: "DELETE" });
export const startRun = (id: string, body: { mode: "live" | "dry"; input?: string; startNodeId?: string; confirmed?: boolean }) =>
  api<CanvasRun>(`/canvases/${id}/run`, { method: "POST", body: JSON.stringify(body) });
export const getRun = (runId: string) => api<CanvasRun>(`/runs/${runId}`);
export const cancelRun = (runId: string) => api<{ ok: true }>(`/runs/${runId}/cancel`, { method: "POST" });
export const listRuns = (id: string, limit = 10) => api<CanvasRun[]>(`/canvases/${id}/runs?limit=${limit}`);

/** Lista de canvases atualizada a cada `everyMs` (pausa com a aba oculta). */
export function useCanvasList(everyMs = 8000) {
  const [list, setList] = useState<Canvas[] | null>(null);
  const [online, setOnline] = useState(true);
  const refresh = useCallback(async () => {
    try {
      const next = await listCanvases();
      setList(next);
      setOnline(true);
      return next;
    } catch {
      setOnline(false);
      return null;
    }
  }, []);
  useEffect(() => {
    void refresh();
    const t = setInterval(() => {
      if (!document.hidden) void refresh();
    }, everyMs);
    return () => clearInterval(t);
  }, [refresh, everyMs]);
  useOnChange(["canvases"], () => void refresh());
  return { list, online, refresh };
}
