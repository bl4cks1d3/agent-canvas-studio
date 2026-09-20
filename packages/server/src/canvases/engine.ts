import { randomUUID } from "node:crypto";
import type { Canvas, CanvasEdge, CanvasNode, CanvasRun, NodeLog, RunStatus } from "@agent-canvas/shared";
import { evalCondition, resolveDeep, stringify, type Ctx } from "./expr";
import { isStart } from "./node-specs";

export type Item = Record<string, unknown>;

export const LIMITS = {
  items: 200,
  agentCalls: 30,
  toolCalls: 200,
  notifications: 20,
  runMs: 10 * 60_000,
  sampleItems: 5,
  sampleChars: 2500,
};

/** Tudo que o motor precisa do mundo fora do grafo (injetado: facilita testar). */
export interface EngineDeps {
  runAgent(a: { name: string; provider: string; model?: string; instructions: string; prompt: string; tools: string[]; maxSteps: number; signal?: AbortSignal }): Promise<{ text: string; steps: number; toolsUsed: string[] }>;
  runClaude(a: { instructions: string; prompt: string; cwd?: string; allowedTools?: string; maxTurns?: number; signal?: AbortSignal }): Promise<string>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  notify(n: { title: string; message: string; level: string }): unknown;
  isReadOnlyTool(name: string): boolean;
  listRecords(collection: string, query: Record<string, string | undefined>): Item[];
  createRecord(collection: string, data: Record<string, unknown>): Item;
  setBlockInbox(blockId: string, items: Item[]): void;
}

export interface RunOptions {
  runId?: string;
  mode: "live" | "dry";
  startNodeId: string;
  input: string;
  signal?: AbortSignal;
  /** Chamado a cada mudanca (no comecou/terminou) com o registro parcial. */
  onProgress?: (run: CanvasRun) => void;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const toItem = (v: unknown): Item => (isObject(v) ? v : { value: v });

/** Texto de um item: o campo `text` (agentes) ou o JSON. */
export const itemText = (item: Item): string => (typeof item.text === "string" ? item.text : JSON.stringify(item));

function nowCtx(): Record<string, unknown> {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return { iso: d.toISOString(), date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, weekday: d.getDay() };
}

function resultToItems(value: unknown): Item[] {
  let v = value;
  if (typeof v === "string" && /^\s*[[{]/.test(v)) {
    try {
      v = JSON.parse(v);
    } catch {
      // continua texto
    }
  }
  if (Array.isArray(v)) return v.map(toItem);
  if (isObject(v)) return [v];
  return [{ text: stringify(v) }];
}

function sample(items: Item[]): unknown[] {
  return items.slice(0, LIMITS.sampleItems).map((item) => {
    const text = JSON.stringify(item);
    return text.length > LIMITS.sampleChars ? { _cortado: text.slice(0, LIMITS.sampleChars) } : item;
  });
}

export async function executeCanvas(canvas: Canvas, opts: RunOptions, deps: EngineDeps): Promise<CanvasRun> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const byId = new Map<string, CanvasNode>(canvas.nodes.map((n) => [n.id, n]));
  const start = byId.get(opts.startNodeId);
  const logs: NodeLog[] = [];
  const dry = opts.mode === "dry";
  const run: CanvasRun = {
    id: opts.runId ?? randomUUID(),
    canvasId: canvas.id,
    status: "running",
    mode: opts.mode,
    startNodeId: opts.startNodeId,
    input: opts.input,
    nodes: logs,
    startedAt,
  };
  const progress = () => opts.onProgress?.({ ...run, nodes: [...logs] });
  const done = (status: RunStatus, error?: string): CanvasRun => {
    run.status = status;
    if (error) run.error = error;
    run.finishedAt = new Date().toISOString();
    run.nodes = [...logs];
    progress();
    return run;
  };
  if (!start || !isStart(start.type)) return done("error", "ponto de partida (nó Pedido) não encontrado");

  // subgrafo alcancavel a partir do pedido, em ordem topologica
  const out = new Map<string, CanvasEdge[]>();
  const inc = new Map<string, CanvasEdge[]>();
  for (const e of canvas.edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue;
    (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e);
    (inc.get(e.to) ?? inc.set(e.to, []).get(e.to)!).push(e);
  }
  const reach = new Set<string>([start.id]);
  const stack = [start.id];
  while (stack.length) for (const e of out.get(stack.pop()!) ?? []) if (!reach.has(e.to)) (reach.add(e.to), stack.push(e.to));
  const indeg = new Map<string, number>();
  reach.forEach((id) => indeg.set(id, (inc.get(id) ?? []).filter((e) => reach.has(e.from)).length));
  const order: string[] = [];
  const ready = Array.from(reach).filter((id) => (indeg.get(id) ?? 0) === 0);
  while (ready.length) {
    const id = ready.shift()!;
    order.push(id);
    for (const e of out.get(id) ?? []) {
      if (!reach.has(e.to)) continue;
      indeg.set(e.to, (indeg.get(e.to) ?? 1) - 1);
      if (indeg.get(e.to) === 0) ready.push(e.to);
    }
  }

  const outputs = new Map<string, Record<string, Item[]>>();
  const nodesCtx: Record<string, unknown> = {};
  const finals: Item[] = [];
  let lastAgentText = "";
  let agentCalls = 0;
  let toolCalls = 0;
  let notifyCalls = 0;
  let fatal: string | undefined;
  let partial = false;

  for (const id of order) {
    if (opts.signal?.aborted) return done("cancelled", "execução cancelada");
    if (fatal) break;
    if (Date.now() - t0 > LIMITS.runMs) {
      fatal = `tempo máximo de ${LIMITS.runMs / 60_000} min excedido`;
      break;
    }
    const node = byId.get(id)!;
    const isFirst = id === start.id;
    const inputs: Item[] = isFirst
      ? [{ text: opts.input }]
      : (inc.get(id) ?? []).filter((e) => reach.has(e.from)).flatMap((e) => outputs.get(e.from)?.[e.fromPort] ?? []);

    const log: NodeLog = { nodeId: id, name: node.name, type: node.type, status: "running", itemsIn: inputs.length, itemsOut: {}, durationMs: 0, startedAt: new Date().toISOString() };
    if (!isFirst && inputs.length === 0) {
      log.status = "skipped";
      outputs.set(id, {});
      logs.push(log);
      progress();
      continue;
    }
    logs.push(log);
    progress();

    const warnings = new Set<string>();
    const warn = (m: string) => {
      if (warnings.size < 10) warnings.add(m);
    };
    const nodeStart = Date.now();
    const ctxFor = (item: Item, index: number): Ctx => ({ json: item, index, input: { text: opts.input }, nodes: nodesCtx, now: nowCtx() });
    const c = node.config;
    let ports: Record<string, Item[]> = {};
    let simulated = false;
    let failed = 0;

    const each = async (fn: (item: Item, index: number) => Promise<Item[]>): Promise<Item[]> => {
      const acc: Item[] = [];
      for (let i = 0; i < inputs.length; i++) {
        try {
          acc.push(...(await fn(inputs[i], i)));
        } catch (err) {
          if (node.onError === "continue") {
            failed++;
            warn(`item ${i + 1}: ${errText(err)}`);
          } else throw err;
        }
      }
      return acc;
    };

    try {
      switch (node.type) {
        case "input.prompt": {
          if (!opts.input.trim()) throw new Error("o pedido está vazio: escreva o texto no nó Pedido ou ao executar");
          ports = { main: inputs };
          break;
        }
        case "agent.llm": {
          if (++agentCalls > LIMITS.agentCalls) throw new Error(`limite de ${LIMITS.agentCalls} chamadas de agente por execução`);
          const ctx = ctxFor(inputs[0] ?? {}, 0);
          const instructions = stringify(resolveDeep(String(c.instructions ?? ""), ctx, warn));
          const prompt = inputs.map(itemText).join("\n\n---\n\n");
          if (dry) {
            simulated = true;
            ports = { main: [{ text: `(simulado) ${node.name}`, simulated: true }] };
            break;
          }
          const r = await deps.runAgent({
            name: node.name,
            provider: String(c.provider ?? "auto"),
            model: typeof c.model === "string" && c.model ? c.model : undefined,
            instructions,
            prompt,
            tools: Array.isArray(c.tools) ? (c.tools as string[]) : [],
            maxSteps: Math.min(12, Math.max(1, Number(c.maxSteps) || 6)),
            signal: opts.signal,
          });
          log.steps = r.steps;
          log.toolsUsed = r.toolsUsed;
          lastAgentText = r.text;
          ports = { main: [{ text: r.text, agent: node.name }] };
          break;
        }
        case "agent.claude": {
          if (++agentCalls > LIMITS.agentCalls) throw new Error(`limite de ${LIMITS.agentCalls} chamadas de agente por execução`);
          const ctx = ctxFor(inputs[0] ?? {}, 0);
          const instructions = stringify(resolveDeep(String(c.instructions ?? ""), ctx, warn));
          const prompt = inputs.map(itemText).join("\n\n---\n\n");
          if (dry) {
            simulated = true;
            ports = { main: [{ text: `(simulado) Claude Code: ${node.name}`, simulated: true }] };
            break;
          }
          const text = await deps.runClaude({
            instructions,
            prompt,
            cwd: typeof c.cwd === "string" ? c.cwd : undefined,
            allowedTools: typeof c.allowedTools === "string" ? c.allowedTools : undefined,
            maxTurns: Number(c.maxTurns) || undefined,
            signal: opts.signal,
          });
          lastAgentText = text;
          ports = { main: [{ text, agent: node.name }] };
          break;
        }
        case "tool.call": {
          const tool = String(c.tool ?? "");
          ports = {
            main: await each(async (item, i) => {
              const args = resolveDeep(c.args ?? {}, ctxFor(item, i), warn) as Record<string, unknown>;
              if (dry && !deps.isReadOnlyTool(tool)) {
                simulated = true;
                return [{ simulated: true, tool, args }];
              }
              if (++toolCalls > LIMITS.toolCalls) throw new Error(`limite de ${LIMITS.toolCalls} chamadas de ferramenta por execução`);
              try {
                return resultToItems(await deps.callTool(tool, args));
              } catch (err) {
                // na simulacao, uma leitura pode falhar so porque a escrita anterior foi simulada: segue com aviso
                if (!dry) throw err;
                simulated = true;
                warn(`leitura falhou na simulação: ${errText(err)}`);
                return [{ simulated: true, tool, error: errText(err) }];
              }
            }),
          };
          break;
        }
        case "data.records": {
          const ctx = ctxFor(inputs[0] ?? {}, 0);
          const where = resolveDeep(c.where ?? {}, ctx, warn) as Record<string, unknown>;
          const query: Record<string, string | undefined> = { limit: String(Math.min(LIMITS.items, Math.max(1, Number(c.limit) || 100))) };
          for (const [k, v] of Object.entries(where)) query[k] = stringify(v);
          if (typeof c.q === "string" && c.q) query.q = stringify(resolveDeep(c.q, ctx, warn));
          ports = { main: deps.listRecords(String(c.collection), query) };
          break;
        }
        case "action.record":
          ports = {
            main: await each(async (item, i) => {
              const data = resolveDeep(c.data ?? {}, ctxFor(item, i), warn) as Record<string, unknown>;
              if (dry) {
                simulated = true;
                return [{ simulated: true, collection: c.collection, data }];
              }
              return [deps.createRecord(String(c.collection), data)];
            }),
          };
          break;
        case "action.notify":
          ports = {
            main: await each(async (item, i) => {
              const ctx = ctxFor(item, i);
              const n = {
                title: stringify(resolveDeep(String(c.title ?? ""), ctx, warn)).trim(),
                message: stringify(resolveDeep(String(c.message ?? ""), ctx, warn)).trim(),
                level: String(c.level || "info"),
              };
              if (!n.title) throw new Error("o título da notificação ficou vazio");
              if (dry) {
                simulated = true;
                return [{ ...item, simulated: true, notification: n }];
              }
              if (++notifyCalls > LIMITS.notifications) throw new Error(`limite de ${LIMITS.notifications} notificações por execução`);
              deps.notify(n);
              return [{ ...item, notified: n.title }];
            }),
          };
          break;
        case "ui.block":
          if (dry) simulated = true;
          else deps.setBlockInbox(String(c.blockId), inputs);
          ports = {};
          break;
        case "logic.if": {
          const t: Item[] = [];
          const f: Item[] = [];
          await each(async (item, i) => {
            (evalCondition(String(c.condition ?? ""), ctxFor(item, i)) ? t : f).push(item);
            return [];
          });
          ports = { true: t, false: f };
          break;
        }
        case "output.result":
          finals.push(...inputs);
          ports = {};
          break;
        default:
          throw new Error(`tipo de nó sem execução: ${node.type}`);
      }
      for (const [port, items] of Object.entries(ports)) {
        if (items.length > LIMITS.items) {
          warn(`${port}: ${items.length} itens; mantidos os primeiros ${LIMITS.items}`);
          ports[port] = items.slice(0, LIMITS.items);
        }
      }
      outputs.set(id, ports);
      nodesCtx[id] = { items: ports.main ?? Object.values(ports).flat(), ...ports };
      log.status = simulated ? "simulated" : "ok";
      log.itemsOut = Object.fromEntries(Object.entries(ports).map(([p, items]) => [p, items.length]));
      log.input = sample(inputs);
      log.output = Object.fromEntries(Object.entries(ports).map(([p, items]) => [p, sample(items)]));
      if (node.type === "output.result") log.output = { result: sample(inputs) };
      if (failed) {
        log.failed = failed;
        partial = true;
      }
    } catch (err) {
      if (opts.signal?.aborted) {
        log.status = "error";
        log.error = "cancelado";
        log.durationMs = Date.now() - nodeStart;
        return done("cancelled", "execução cancelada");
      }
      log.status = "error";
      log.error = errText(err);
      log.input = sample(inputs);
      outputs.set(id, {});
      if (node.onError === "continue") partial = true;
      else fatal = `${node.name}: ${errText(err)}`;
    }
    if (warnings.size) log.warnings = Array.from(warnings);
    log.durationMs = Date.now() - nodeStart;
    progress();
  }

  run.result = finals.length ? finals.map(itemText).join("\n\n") : lastAgentText || undefined;
  return done(fatal ? "error" : partial ? "partial" : "ok", fatal);
}
