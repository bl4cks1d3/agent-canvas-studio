"use client";

import { useCallback, useEffect, useState } from "react";
import type { Block, BlockPermissions, Collection, CollectionField, CanvasRun, PackageInfo, PackageManifest } from "@agent-canvas/shared";
import { api, getRun, startRun } from "./api";

export type { Block, BlockPermissions, Collection, CollectionField, PackageInfo, PackageManifest, PackageConnection } from "@agent-canvas/shared";

export type CollectionWithCount = Collection & { records: number };
export type DataRecord = { id: string; createdAt: string; updatedAt: string } & Record<string, unknown>;

// ------------------------------------------------------------------ colecoes e registros
export const listCollections = () => api<CollectionWithCount[]>("/collections");
export const createCollection = (input: { name: string; label?: string; description?: string; fields: CollectionField[] }) => api<Collection>("/collections", { method: "POST", body: JSON.stringify(input) });
export const updateCollection = (name: string, input: { label?: string; description?: string; fields?: CollectionField[] }) => api<Collection>(`/collections/${name}`, { method: "PATCH", body: JSON.stringify(input) });
export const deleteCollection = (name: string) => api<{ ok: true }>(`/collections/${name}`, { method: "DELETE" });
export const listRecords = (name: string, params: Record<string, string> = {}) => {
  const qs = new URLSearchParams(params).toString();
  return api<DataRecord[]>(`/collections/${name}/records${qs ? `?${qs}` : ""}`);
};
export const createRecord = (name: string, body: Record<string, unknown>) => api<DataRecord>(`/collections/${name}/records`, { method: "POST", body: JSON.stringify(body) });
export const updateRecord = (name: string, id: string, body: Record<string, unknown>) => api<DataRecord>(`/collections/${name}/records/${id}`, { method: "PATCH", body: JSON.stringify(body) });
export const deleteRecord = (name: string, id: string) => api<{ ok: true }>(`/collections/${name}/records/${id}`, { method: "DELETE" });

// ------------------------------------------------------------------ componentes
export const listBlocks = () => api<Block[]>("/blocks");
export const getBlock = (id: string) => api<Block>(`/blocks/${id}`);
export const saveBlock = (id: string, input: Partial<Block> & { approved?: boolean }) => api<Block>(`/blocks/${id}`, { method: "PUT", body: JSON.stringify({ ...input, source: "user" }) });
export const createBlock = (input: Partial<Block>) => api<Block>("/blocks", { method: "POST", body: JSON.stringify({ ...input, source: "user" }) });
export const approveBlock = (id: string, approved: boolean) => api<Block>(`/blocks/${id}/approve`, { method: "PATCH", body: JSON.stringify({ approved }) });
export const deleteBlock = (id: string) => api<{ ok: true }>(`/blocks/${id}`, { method: "DELETE" });
export interface BlockVersionInfo {
  id: string;
  createdAt: string;
  author: string;
  note?: string;
  bytes: number;
}
export const listVersions = (id: string) => api<BlockVersionInfo[]>(`/blocks/${id}/versions`);
export const restoreVersion = (id: string, versionId: string) => api<Block>(`/blocks/${id}/versions/${versionId}/restore`, { method: "POST" });
export const getLint = (id: string) => api<{ warnings: string[] }>(`/blocks/${id}/lint`);
export const getInbox = (id: string) => api<{ items: unknown[]; updatedAt?: string }>(`/blocks/${id}/inbox`);

// ------------------------------------------------------------------ tema (design tokens salvos no banco)
export interface StudioTheme {
  accent: string;
  radius: number;
  fontSize: number;
  density: "compact" | "comfortable";
}
export const DEFAULT_TOKENS: StudioTheme = { accent: "", radius: 12, fontSize: 13, density: "comfortable" };
export const getTheme = () => api<StudioTheme>("/theme");
export const saveTheme = async (input: Partial<StudioTheme>) => {
  const next = await api<StudioTheme>("/theme", { method: "PUT", body: JSON.stringify(input) });
  window.dispatchEvent(new CustomEvent("studio-theme", { detail: next }));
  return next;
};

/** Tema do Studio (salvo no banco). Aplica o destaque no app inteiro; os componentes recebem os mesmos tokens. */
export function useStudioTheme(): StudioTheme {
  const [tokens, setTokens] = useState<StudioTheme>(DEFAULT_TOKENS);
  useEffect(() => {
    let dead = false;
    const load = () => getTheme().then((t) => !dead && setTokens(t)).catch(() => undefined);
    void load();
    const timer = setInterval(() => !document.hidden && void load(), 10_000);
    const onSaved = (e: Event) => setTokens((e as CustomEvent<StudioTheme>).detail);
    window.addEventListener("studio-theme", onSaved);
    return () => {
      dead = true;
      clearInterval(timer);
      window.removeEventListener("studio-theme", onSaved);
    };
  }, []);
  return tokens;
}

// ------------------------------------------------------------------ pacotes
export const listPackages = () => api<PackageInfo[]>("/packages");
export const getPackage = (id: string) => api<PackageInfo & { manifest: PackageManifest }>(`/packages/${id}`);
export const installPackage = (id: string) => api<PackageInfo>(`/packages/${id}/install`, { method: "POST" });
export const uninstallPackage = (id: string, dropData: boolean) => api<{ ok: true }>(`/packages/${id}?dropData=${dropData}`, { method: "DELETE" });
export const connectPackage = (id: string, body: Record<string, string | null>) => api<PackageInfo>(`/packages/${id}/connections`, { method: "PUT", body: JSON.stringify(body) });
export const importPackage = (manifest: unknown) => api<PackageInfo>("/packages", { method: "POST", body: JSON.stringify({ ...(manifest as object), source: "user" }) });
export const deletePackageDefinition = (id: string) => api<{ ok: true }>(`/packages/${id}/definition`, { method: "DELETE" });

/** Lista que se atualiza sozinha (o Claude pode criar/alterar pelo MCP); pausa com a aba oculta. */
export function usePolled<T>(load: () => Promise<T>, everyMs = 4000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const next = await load();
      setData(next);
      setError("");
      return next;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    void refresh();
    const t = setInterval(() => {
      if (!document.hidden) void refresh();
    }, everyMs);
    return () => clearInterval(t);
  }, [refresh, everyMs]);
  return { data, error, refresh };
}

// ------------------------------------------------------------------ ponte dos componentes
const RUN_TIMEOUT_MS = 180_000;

interface BridgeBlock {
  id?: string;
  permissions: BlockPermissions;
  config?: Record<string, unknown>;
}

const has = (list: string[], item: string) => list.includes(item);

export interface AgentRunResult {
  status: CanvasRun["status"];
  result: string;
  error?: string;
  nodes: Array<{ id: string; name: string; status: string; text?: string }>;
}

async function runAgent(block: BridgeBlock, keyOrId: string, input: string): Promise<AgentRunResult> {
  const agents = ((block.config?.agents as Record<string, string> | undefined) ?? {}) as Record<string, string>;
  const id = agents[keyOrId] ?? keyOrId;
  if (!has(block.permissions.agents, "*") && !has(block.permissions.agents, id)) throw new Error(`o componente não tem permissão para executar o agente "${keyOrId}"`);
  let run = await startRun(id, { mode: "live", input, confirmed: true });
  const deadline = Date.now() + RUN_TIMEOUT_MS;
  while (run.status === "running") {
    if (Date.now() > deadline) throw new Error("o agente demorou demais");
    await new Promise((r) => setTimeout(r, 700));
    run = await getRun(run.id);
  }
  return {
    status: run.status,
    result: run.result ?? "",
    error: run.error,
    nodes: run.nodes.map((n) => {
      const first = (n.output?.main ?? n.output?.true ?? [])[0] as { text?: unknown } | undefined;
      return { id: n.nodeId, name: n.name, status: n.status, text: typeof first?.text === "string" ? first.text : undefined };
    }),
  };
}

/** Executa uma chamada vinda do iframe, conferindo as permissoes do componente a cada uma. */
export async function runBridgeCall(block: BridgeBlock, method: string, args: unknown[]): Promise<unknown> {
  const perms = block.permissions;
  const resource = (name: unknown) => {
    if (typeof name !== "string" || !/^[a-z][a-z0-9_]{1,39}$/.test(name)) throw new Error("nome de coleção inválido");
    return name;
  };
  switch (method) {
    case "data.list": {
      const name = resource(args[0]);
      if (!has(perms.read, `col:${name}`) && !has(perms.write, `col:${name}`)) throw new Error(`sem permissão para ler "${name}"`);
      const params = (args[1] && typeof args[1] === "object" ? args[1] : {}) as Record<string, unknown>;
      return listRecords(name, Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])));
    }
    case "data.create":
    case "data.update":
    case "data.remove": {
      const name = resource(args[0]);
      if (!has(perms.write, `col:${name}`)) throw new Error(`sem permissão para gravar em "${name}"`);
      if (method === "data.create") return createRecord(name, (args[1] ?? {}) as Record<string, unknown>);
      if (typeof args[1] !== "string") throw new Error("id do registro inválido");
      if (method === "data.update") return updateRecord(name, args[1], (args[2] ?? {}) as Record<string, unknown>);
      return deleteRecord(name, args[1]);
    }
    case "tool.call": {
      const name = String(args[0] ?? "");
      if (!has(perms.tools, name)) throw new Error(`sem permissão para a ferramenta "${name}"`);
      const res = await api<{ result: unknown }>("/tools/call", { method: "POST", body: JSON.stringify({ name, args: args[1] ?? {} }) });
      return res.result;
    }
    case "agent.run":
      return runAgent(block, String(args[0] ?? ""), String(args[1] ?? ""));
    case "store.get": {
      if (!block.id) return null;
      const all = await api<Record<string, unknown>>(`/blocks/${block.id}/state`);
      return all[String(args[0])] ?? null;
    }
    case "store.all":
      return block.id ? api<Record<string, unknown>>(`/blocks/${block.id}/state`) : {};
    case "store.set":
      if (!block.id) throw new Error("este componente ainda não foi salvo");
      await api(`/blocks/${block.id}/state/${encodeURIComponent(String(args[0]))}`, { method: "PUT", body: JSON.stringify({ value: args[1] ?? null }) });
      return true;
    case "store.remove":
      if (block.id) await api(`/blocks/${block.id}/state/${encodeURIComponent(String(args[0]))}`, { method: "DELETE" });
      return true;
    case "inbox.get": {
      if (!block.id) return [];
      return (await getInbox(block.id)).items;
    }
    default:
      throw new Error(`método desconhecido: ${method}`);
  }
}

// ------------------------------------------------------------------ paginas do dashboard
export type { DashboardPage, PageItem } from "@agent-canvas/shared";
import type { DashboardPage, PageItem } from "@agent-canvas/shared";
export const listPages = () => api<DashboardPage[]>("/pages");
export const getPage = (id: string) => api<DashboardPage>(`/pages/${id}`);
export const createPage = (name: string, layout: PageItem[] = []) => api<DashboardPage>("/pages", { method: "POST", body: JSON.stringify({ name, layout }) });
export const savePage = (id: string, input: { name?: string; layout?: PageItem[]; baseUpdatedAt?: string }) => api<DashboardPage>(`/pages/${id}`, { method: "PUT", body: JSON.stringify(input) });
export const deletePage = (id: string) => api<{ ok: true }>(`/pages/${id}`, { method: "DELETE" });
export const reorderPages = (ids: string[]) => api<DashboardPage[]>("/pages/order", { method: "PUT", body: JSON.stringify({ ids }) });

// ------------------------------------------------------------------ construtor autonomo (Claude Code)
export interface BuilderEvent {
  at: string;
  kind: "say" | "tool" | "error" | "info";
  text: string;
}
export interface BuilderChanges {
  collections: string[];
  blocksCreated: Array<{ id: string; name: string; approved: boolean }>;
  blocksUpdated: Array<{ id: string; name: string; approved: boolean }>;
  pagesCreated: Array<{ id: string; name: string }>;
  pagesUpdated: Array<{ id: string; name: string }>;
}
export interface BuilderRun {
  id: string;
  prompt: string;
  status: "running" | "ok" | "error" | "cancelled";
  events: BuilderEvent[];
  result?: string;
  error?: string;
  changes?: BuilderChanges;
  startedAt: string;
  finishedAt?: string;
}
export const builderStatus = () => api<{ claude: { installed: boolean; version?: string }; mcpBuilt: boolean; busy: boolean }>("/builder/status");
export const listBuilds = () => api<BuilderRun[]>("/builder/runs");
export const getBuild = (id: string) => api<BuilderRun>(`/builder/runs/${id}`);
export const startBuild = (prompt: string, pageId?: string | null) => api<BuilderRun>("/builder/runs", { method: "POST", body: JSON.stringify({ prompt, pageId: pageId ?? undefined }) });
export const cancelBuild = (id: string) => api<{ ok: true }>(`/builder/runs/${id}/cancel`, { method: "POST" });
