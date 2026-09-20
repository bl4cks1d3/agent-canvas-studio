import type { Canvas, CanvasEdge, CanvasNode, CanvasRun, NodeLog, RunStatus } from "@agent-canvas/shared";
import type { CanvasDb } from "../db";

interface CanvasRow {
  id: string;
  name: string;
  description: string | null;
  graph: string;
  source: string;
  last_run_at: string | null;
  last_status: string | null;
  created_at: string;
  updated_at: string;
}

interface RunRow {
  id: string;
  canvas_id: string;
  status: string;
  mode: string;
  start_node: string;
  input: string;
  nodes: string;
  result: string | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

const KEEP_RUNS = 30;

function parse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const toCanvas = (r: CanvasRow): Canvas => {
  const g = parse<{ nodes?: CanvasNode[]; edges?: CanvasEdge[] }>(r.graph, {});
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? undefined,
    nodes: g.nodes ?? [],
    edges: g.edges ?? [],
    source: r.source === "agent" ? "agent" : "user",
    lastRunAt: r.last_run_at ?? undefined,
    lastStatus: (r.last_status as RunStatus | null) ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
};

const toRun = (r: RunRow): CanvasRun => ({
  id: r.id,
  canvasId: r.canvas_id,
  status: r.status as RunStatus,
  mode: r.mode === "dry" ? "dry" : "live",
  startNodeId: r.start_node,
  input: r.input,
  nodes: parse<NodeLog[]>(r.nodes, []),
  result: r.result ?? undefined,
  error: r.error ?? undefined,
  startedAt: r.started_at,
  finishedAt: r.finished_at ?? undefined,
});

export const listCanvases = (db: CanvasDb): Canvas[] => (db.prepare(`SELECT * FROM canvases ORDER BY created_at ASC`).all() as unknown as CanvasRow[]).map(toCanvas);

export function getCanvas(db: CanvasDb, id: string): Canvas | undefined {
  const row = db.prepare(`SELECT * FROM canvases WHERE id = ?`).get(id) as CanvasRow | undefined;
  return row ? toCanvas(row) : undefined;
}

export function saveCanvas(db: CanvasDb, c: Canvas): Canvas {
  db.prepare(
    `INSERT INTO canvases (id, name, description, graph, source, last_run_at, last_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, graph = excluded.graph,
       source = excluded.source, updated_at = excluded.updated_at`
  ).run(c.id, c.name, c.description ?? null, JSON.stringify({ nodes: c.nodes, edges: c.edges }), c.source, c.lastRunAt ?? null, c.lastStatus ?? null, c.createdAt, c.updatedAt);
  return getCanvas(db, c.id)!;
}

export function deleteCanvas(db: CanvasDb, id: string): void {
  db.prepare(`DELETE FROM runs WHERE canvas_id = ?`).run(id);
  db.prepare(`DELETE FROM canvases WHERE id = ?`).run(id);
}

/** Grava (ou atualiza) a execucao; execucoes reais terminadas atualizam o "ultimo resultado" do canvas. */
export function saveRun(db: CanvasDb, run: CanvasRun): void {
  db.prepare(
    `INSERT INTO runs (id, canvas_id, status, mode, start_node, input, nodes, result, error, started_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status = excluded.status, nodes = excluded.nodes, result = excluded.result,
       error = excluded.error, finished_at = excluded.finished_at`
  ).run(run.id, run.canvasId, run.status, run.mode, run.startNodeId, run.input, JSON.stringify(run.nodes), run.result ?? null, run.error ?? null, run.startedAt, run.finishedAt ?? null);
  if (run.finishedAt && run.mode === "live") {
    db.prepare(`UPDATE canvases SET last_run_at = ?, last_status = ? WHERE id = ?`).run(run.finishedAt, run.status, run.canvasId);
  }
  if (run.finishedAt) {
    db.prepare(`DELETE FROM runs WHERE canvas_id = ? AND id NOT IN (SELECT id FROM runs WHERE canvas_id = ? ORDER BY started_at DESC LIMIT ?)`).run(run.canvasId, run.canvasId, KEEP_RUNS);
  }
}

export function getRun(db: CanvasDb, id: string): CanvasRun | undefined {
  const row = db.prepare(`SELECT * FROM runs WHERE id = ?`).get(id) as RunRow | undefined;
  return row ? toRun(row) : undefined;
}

export const listRuns = (db: CanvasDb, canvasId: string, limit: number): CanvasRun[] =>
  (db.prepare(`SELECT * FROM runs WHERE canvas_id = ? ORDER BY started_at DESC LIMIT ?`).all(canvasId, limit) as unknown as RunRow[]).map(toRun);

/** Execucoes que ficaram "running" (servidor caiu no meio): viram erro. */
export function failStaleRuns(db: CanvasDb): void {
  db.prepare(`UPDATE runs SET status = 'error', error = 'interrompida (o servidor reiniciou)', finished_at = ? WHERE status = 'running'`).run(new Date().toISOString());
}
