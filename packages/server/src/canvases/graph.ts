import type { CanvasEdge, CanvasNode, NodeType, ToolInfo } from "@agent-canvas/shared";
import { conditionPaths, templatePaths } from "./expr";
import { NODE_TYPES, specOf } from "./node-specs";

export const MAX_NODES = 60;
export const MAX_EDGES = 200;
const ID_RE = /^[a-z][a-z0-9_]{0,31}$/;
/** Raizes que um {{ }} pode usar. */
const ROOTS = new Set(["json", "index", "input", "nodes", "now"]);
const PROVIDERS = ["auto", "groq", "anthropic", "gemini", "claude-code"];
/** Ferramentas do Claude Code que um no pode liberar (Bash so com CLAUDE_NODE_ALLOW_BASH=true). */
export const CLAUDE_SAFE_TOOLS = ["Read", "Grep", "Glob", "LS", "WebSearch", "WebFetch", "Edit", "Write", "TodoWrite"];

export interface ValidationContext {
  /** Catalogo de ferramentas (undefined = nao confere). */
  tools?: ToolInfo[];
  allowBash: boolean;
  hasCollection: (name: string) => boolean;
  hasBlock: (id: string) => boolean;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");

/** Aceita o que o editor e o Claude mandam; erros de forma viram excecao, erros de regra viram lista (validateGraph). */
export function normalizeGraph(input: { nodes?: unknown; edges?: unknown }): { nodes: CanvasNode[]; edges: CanvasEdge[]; problems: string[] } {
  const problems: string[] = [];
  const rawNodes = input.nodes === undefined ? [] : input.nodes;
  const rawEdges = input.edges === undefined ? [] : input.edges;
  if (!Array.isArray(rawNodes)) throw new Error("nodes deve ser uma lista");
  if (!Array.isArray(rawEdges)) throw new Error("edges deve ser uma lista");
  if (rawNodes.length > MAX_NODES) throw new Error(`no maximo ${MAX_NODES} nos por canvas`);
  if (rawEdges.length > MAX_EDGES) throw new Error(`no maximo ${MAX_EDGES} fios por canvas`);

  const nodes = rawNodes.map((raw, i): CanvasNode => {
    const n = isObject(raw) ? raw : {};
    const type = String(n.type ?? "") as NodeType;
    const spec = specOf(type);
    const id = str(n.id, 40);
    const config: Record<string, unknown> = isObject(n.config) ? { ...n.config } : {};
    for (const f of spec?.fields ?? []) {
      const v = config[f.key];
      if (f.kind === "json" && typeof v === "string") {
        if (!v.trim()) delete config[f.key];
        else {
          try {
            config[f.key] = JSON.parse(v);
          } catch {
            problems.push(`nó "${id || i}": o campo "${f.label}" não é JSON válido`);
          }
        }
      }
    }
    return {
      id,
      type,
      name: str(n.name, 80) || spec?.label || id,
      x: Number.isFinite(Number(n.x)) && n.x !== null && n.x !== "" ? Math.round(Number(n.x)) : Number.NaN,
      y: Number.isFinite(Number(n.y)) && n.y !== null && n.y !== "" ? Math.round(Number(n.y)) : Number.NaN,
      config,
      ...(n.onError === "continue" ? { onError: "continue" as const } : {}),
    };
  });

  const edges = rawEdges.map((raw): CanvasEdge => {
    const e = isObject(raw) ? raw : {};
    const from = str(e.from, 40);
    const to = str(e.to, 40);
    const fromPort = str(e.fromPort, 20) || "main";
    return { id: str(e.id, 100) || `${from}_${fromPort}_${to}`, from, fromPort, to };
  });
  return { nodes, edges, problems };
}

function walkStrings(value: unknown, visit: (s: string) => void, depth = 0): void {
  if (depth > 24) return;
  if (typeof value === "string") visit(value);
  else if (Array.isArray(value)) value.forEach((v) => walkStrings(v, visit, depth + 1));
  else if (isObject(value)) Object.values(value).forEach((v) => walkStrings(v, visit, depth + 1));
}

function checkPaths(label: string, paths: string[], ids: Set<string>, problems: string[]): void {
  for (const p of paths) {
    const parts = p.replace(/\[(\d+)\]/g, ".$1").split(".");
    const root = parts[0];
    if (!ROOTS.has(root)) problems.push(`${label}: "{{${p}}}" usa "${root}", que não existe (use ${Array.from(ROOTS).join(", ")})`);
    else if (root === "nodes" && parts[1] && !ids.has(parts[1])) problems.push(`${label}: "{{${p}}}" aponta para um nó que não existe ("${parts[1]}")`);
  }
}

export function validateGraph(nodes: CanvasNode[], edges: CanvasEdge[], ctx: ValidationContext): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const byId = new Map<string, CanvasNode>();

  for (const n of nodes) {
    if (!ID_RE.test(n.id)) {
      problems.push(`id de nó inválido: "${n.id}" (use a-z, 0-9 e _, começando por letra, até 32 caracteres)`);
      continue;
    }
    if (ids.has(n.id)) {
      problems.push(`id de nó repetido: "${n.id}"`);
      continue;
    }
    ids.add(n.id);
    byId.set(n.id, n);
    if (!NODE_TYPES.includes(n.type)) problems.push(`nó "${n.id}": tipo desconhecido "${n.type}" (use canvas_nodes para ver os tipos)`);
  }

  for (const n of nodes) {
    const spec = specOf(n.type);
    if (!spec || !byId.has(n.id)) continue;
    const label = `nó "${n.name}" (${n.id})`;
    const c = n.config;
    for (const f of spec.fields) {
      if (f.required && (c[f.key] === undefined || c[f.key] === null || c[f.key] === "")) problems.push(`${label}: falta "${f.label}"`);
    }

    switch (n.type) {
      case "agent.llm": {
        if (c.provider !== undefined && !PROVIDERS.includes(String(c.provider))) problems.push(`${label}: provedor "${c.provider}" desconhecido (${PROVIDERS.join(", ")})`);
        if (c.maxSteps !== undefined && !(Number(c.maxSteps) >= 1 && Number(c.maxSteps) <= 12)) problems.push(`${label}: "Máx. de passos" deve ser de 1 a 12`);
        if (c.tools !== undefined && !(Array.isArray(c.tools) && c.tools.every((t) => typeof t === "string"))) problems.push(`${label}: "tools" deve ser uma lista de nomes`);
        else if (ctx.tools && Array.isArray(c.tools)) {
          const known = new Set(ctx.tools.map((t) => t.name));
          const unknown = (c.tools as string[]).filter((t) => !known.has(t));
          if (unknown.length) problems.push(`${label}: ferramenta(s) inexistente(s): ${unknown.join(", ")} (use canvas_nodes para ver as disponíveis)`);
        }
        break;
      }
      case "agent.claude": {
        if (c.maxTurns !== undefined && !(Number(c.maxTurns) >= 1 && Number(c.maxTurns) <= 30)) problems.push(`${label}: "Máx. de turnos" deve ser de 1 a 30`);
        if (typeof c.allowedTools === "string" && c.allowedTools.trim()) {
          const allowed = new Set(ctx.allowBash ? [...CLAUDE_SAFE_TOOLS, "Bash"] : CLAUDE_SAFE_TOOLS);
          const bad = c.allowedTools.split(",").map((t) => t.trim()).filter((t) => t && !allowed.has(t));
          if (bad.length) problems.push(`${label}: ferramenta(s) do Claude Code não permitida(s): ${bad.join(", ")} (permitidas: ${Array.from(allowed).join(", ")})`);
        }
        break;
      }
      case "tool.call": {
        const tool = typeof c.tool === "string" ? c.tool : "";
        if (!tool) break;
        if (c.args !== undefined && !isObject(c.args)) {
          problems.push(`${label}: "args" deve ser um objeto JSON`);
          break;
        }
        const def = ctx.tools?.find((t) => t.name === tool);
        if (ctx.tools && !def) {
          problems.push(`${label}: a ferramenta "${tool}" não existe (veja canvas_nodes)`);
          break;
        }
        if (def) {
          const given = Object.keys((c.args as Record<string, unknown>) ?? {});
          const unknownKeys = given.filter((k) => !def.params.includes(k));
          const missing = def.required.filter((k) => !given.includes(k));
          if (unknownKeys.length) problems.push(`${label}: "${tool}" não tem o parâmetro ${unknownKeys.join(", ")} (parâmetros: ${def.params.join(", ") || "nenhum"})`);
          if (missing.length) problems.push(`${label}: "${tool}" exige ${missing.join(", ")}`);
        }
        break;
      }
      case "data.records":
        if (typeof c.collection === "string" && c.collection && !ctx.hasCollection(c.collection)) problems.push(`${label}: a coleção "${c.collection}" não existe`);
        if (c.where !== undefined && !isObject(c.where)) problems.push(`${label}: "Filtro" deve ser um objeto JSON`);
        break;
      case "action.record":
        if (typeof c.collection === "string" && c.collection && !ctx.hasCollection(c.collection)) problems.push(`${label}: a coleção "${c.collection}" não existe`);
        if (c.data !== undefined && !isObject(c.data)) problems.push(`${label}: "Campos" deve ser um objeto JSON`);
        break;
      case "action.notify":
        if (c.level !== undefined && c.level !== "" && !["info", "ok", "warn", "error"].includes(String(c.level))) problems.push(`${label}: "Tipo" deve ser info, ok, warn ou error`);
        break;
      case "ui.block":
        if (typeof c.blockId === "string" && c.blockId && !ctx.hasBlock(c.blockId)) problems.push(`${label}: o componente "${c.blockId}" não existe (use list_blocks)`);
        break;
      case "logic.if":
        if (typeof c.condition === "string" && c.condition) {
          try {
            checkPaths(label, conditionPaths(c.condition), ids, problems);
          } catch (err) {
            problems.push(`${label}: ${err instanceof Error ? err.message : err}`);
          }
        }
        break;
      default:
        break;
    }

    if (n.type !== "logic.if" && n.type !== "note") {
      const paths: string[] = [];
      walkStrings(c, (s) => paths.push(...templatePaths(s)));
      checkPaths(label, paths, ids, problems);
    }
  }

  const seen = new Set<string>();
  for (const e of edges) {
    const from = byId.get(e.from);
    const to = byId.get(e.to);
    const label = `fio ${e.from} → ${e.to}`;
    if (!from || !to) {
      problems.push(`${label}: aponta para um nó que não existe`);
      continue;
    }
    const fromSpec = specOf(from.type);
    const toSpec = specOf(to.type);
    if (!fromSpec || !toSpec) continue;
    if (e.from === e.to) problems.push(`${label}: um nó não pode ligar nele mesmo`);
    if (!fromSpec.outputs.includes(e.fromPort)) problems.push(`${label}: "${from.name}" não tem a saída "${e.fromPort}" (saídas: ${fromSpec.outputs.join(", ") || "nenhuma"})`);
    if (toSpec.inputs === 0) problems.push(`${label}: "${to.name}" não recebe entrada (pedidos e notas ficam no começo)`);
    const key = `${e.from}|${e.fromPort}|${e.to}`;
    if (seen.has(key)) problems.push(`${label}: fio repetido`);
    seen.add(key);
  }

  const adj = new Map<string, string[]>();
  for (const e of edges) if (byId.has(e.from) && byId.has(e.to)) (adj.get(e.from) ?? adj.set(e.from, []).get(e.from)!).push(e.to);
  const state = new Map<string, 1 | 2>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 2) return false;
    if (state.get(id) === 1) return true;
    state.set(id, 1);
    for (const next of adj.get(id) ?? []) if (visit(next)) return true;
    state.set(id, 2);
    return false;
  };
  if (Array.from(byId.keys()).some(visit)) problems.push("o desenho tem um ciclo (fios voltando para trás): use só fios para frente");
  return problems.slice(0, 15);
}

/** Posiciona em colunas por profundidade os nos sem x/y; componentes conexos empilhados, notas no topo. */
export function autoLayout(nodes: CanvasNode[], edges: CanvasEdge[]): void {
  const needs = nodes.filter((n) => Number.isNaN(n.x) || Number.isNaN(n.y));
  if (needs.length === 0) return;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map<string, string[]>();
  const incoming = new Map<string, number>();
  const undirected = new Map<string, Set<string>>();
  for (const n of nodes) {
    out.set(n.id, []);
    undirected.set(n.id, new Set());
  }
  for (const e of edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue;
    out.get(e.from)!.push(e.to);
    incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
    undirected.get(e.from)!.add(e.to);
    undirected.get(e.to)!.add(e.from);
  }
  const COL = 300;
  const ROW = 140;
  const placed = new Set<string>();
  let yOffset = 0;
  const ordered = [...nodes.filter((n) => n.type === "note"), ...nodes.filter((n) => n.type !== "note")];
  for (const start of ordered) {
    if (placed.has(start.id)) continue;
    const component: string[] = [];
    const stack = [start.id];
    const seen = new Set([start.id]);
    while (stack.length) {
      const id = stack.pop()!;
      component.push(id);
      undirected.get(id)!.forEach((next) => {
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      });
    }
    const depth = new Map<string, number>();
    const sources = component.filter((id) => !incoming.get(id));
    const queue = (sources.length ? sources : [component[0]]).map((id) => (depth.set(id, 0), id));
    for (let guard = 0; queue.length && guard < 5000; guard++) {
      const id = queue.shift()!;
      for (const next of out.get(id) ?? []) {
        const d = (depth.get(id) ?? 0) + 1;
        if (d > component.length) continue;
        if ((depth.get(next) ?? -1) < d) (depth.set(next, d), queue.push(next));
      }
    }
    const rows = new Map<number, number>();
    let maxRows = 1;
    for (const id of component) {
      const node = byId.get(id)!;
      placed.add(id);
      if (!Number.isNaN(node.x) && !Number.isNaN(node.y)) continue;
      const col = depth.get(id) ?? 0;
      const row = rows.get(col) ?? 0;
      rows.set(col, row + 1);
      maxRows = Math.max(maxRows, row + 1);
      node.x = 60 + col * COL;
      node.y = 60 + yOffset + row * ROW;
    }
    yOffset += maxRows * ROW + 40;
  }
}
