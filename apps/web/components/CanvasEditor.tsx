"use client";

import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import Icon, { NODE_ICON } from "@/lib/icons";
import { useTheme } from "@/lib/theme";
import { ApiError, deleteCanvas, getCanvas, saveCanvas, type Canvas, type CanvasEdge, type CanvasNode, type CanvasRun, type Catalog, type NodeType } from "@/lib/api";
import NodeCard, { type CardData } from "./NodeCard";
import Inspector from "./Inspector";
import UiBlockNode, { type UiBlockData } from "./UiBlockNode";
import { listBlocks, listCollections, usePolled } from "@/lib/studio-api";

const nodeTypes = { card: NodeCard, uiblock: UiBlockNode };
const CATEGORY_LABEL: Record<string, string> = { input: "Entrada", agent: "Agentes", tool: "Ferramentas", data: "Dados", ui: "Componentes", logic: "Lógica", output: "Saída", note: "Notas" };
const ID_BASE: Record<string, string> = {
  "input.prompt": "pedido",
  "agent.llm": "agente",
  "agent.claude": "claude",
  "tool.call": "ferramenta",
  "data.records": "dados",
  "action.record": "gravar",
  "action.notify": "notificar",
  "ui.block": "componente",
  "logic.if": "se",
  "output.result": "resultado",
  note: "nota",
};

function uniqueId(type: string, taken: string[]): string {
  const base = ID_BASE[type] ?? "no";
  if (!taken.includes(base)) return base;
  for (let i = 2; i < 1000; i++) if (!taken.includes(`${base}${i}`)) return `${base}${i}`;
  return `${base}_${Date.now() % 100000}`;
}

const toRfNode = (n: CanvasNode): Node<CardData> =>
  n.type === "ui.block"
    ? { id: n.id, type: "uiblock", position: { x: n.x, y: n.y }, data: { node: n }, style: { width: Number(n.config.w) || 520, height: Number(n.config.h) || 380 }, dragHandle: ".uib-head" }
    : { id: n.id, type: "card", position: { x: n.x, y: n.y }, data: { node: n } };
const toRfEdge = (e: CanvasEdge): Edge => ({ id: e.id, source: e.from, target: e.to, sourceHandle: e.fromPort });

function reaches(edges: Edge[], from: string, target: string): boolean {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === target) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of edges) if (e.source === id) stack.push(e.target);
  }
  return false;
}

function Editor({ id, catalog, run, remoteUpdatedAt, onDeleted, onSelectNode, selectRequest, flushRef }: Props) {
  const theme = useTheme();
  const rf = useReactFlow();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [canvas, setCanvas] = useState<Canvas | null>(null);
  const [nodes, setNodes] = useState<Node<CardData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"salvo" | "salvando" | "pendente" | "erro">("salvo");
  const [error, setError] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [external, setExternal] = useState(false);
  const [menu, setMenu] = useState<"" | "add" | "problems">("");
  const [rev, setRev] = useState(0);
  const dirty = useRef(false);
  const revRef = useRef(0);
  const base = useRef("");
  const saving = useRef<Promise<void> | null>(null);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;
  const nameRef = useRef(name);
  nameRef.current = name;

  const blocksQ = usePolled(listBlocks, 10_000, ["blocks"]);
  const collectionsQ = usePolled(listCollections, 15_000, ["data"]);
  const blockMap = useMemo(() => new Map((blocksQ.data ?? []).map((b) => [b.id, b])), [blocksQ.data]);

  const specs = useMemo(() => new Map((catalog?.nodes ?? []).map((s) => [s.type, s])), [catalog]);
  const logs = useMemo(() => new Map((run?.nodes ?? []).map((l) => [l.nodeId, l])), [run]);

  const apply = useCallback(
    (c: Canvas & { problems?: string[] }, fit = false) => {
      setCanvas(c);
      base.current = c.updatedAt;
      setName(c.name);
      setNodes(c.nodes.map(toRfNode));
      setEdges(c.edges.map(toRfEdge));
      setProblems(c.problems ?? []);
      dirty.current = false;
      setStatus("salvo");
      setExternal(false);
      if (fit) setTimeout(() => void rf.fitView({ padding: 0.25, duration: 250, maxZoom: 1 }), 60);
    },
    [rf]
  );

  useEffect(() => {
    let dead = false;
    getCanvas(id)
      .then((c) => !dead && apply(c, true))
      .catch((e) => !dead && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      dead = true;
    };
    // so ao trocar de canvas
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ---------------------------------------------------------------- salvar
  const touch = useCallback(() => {
    dirty.current = true;
    revRef.current += 1;
    setStatus("pendente");
    setRev((r) => r + 1);
  }, []);

  const save = useCallback(async (): Promise<void> => {
    if (saving.current) await saving.current;
    if (!dirty.current) return;
    const startRev = revRef.current;
    const job = (async () => {
      setStatus("salvando");
      const payloadNodes: CanvasNode[] = nodesRef.current.map((n) => ({ ...n.data.node, x: Math.round(n.position.x), y: Math.round(n.position.y) }));
      const payloadEdges: CanvasEdge[] = edgesRef.current.map((e) => ({ id: e.id, from: e.source, fromPort: e.sourceHandle ?? "main", to: e.target }));
      try {
        const saved = await saveCanvas(id, { name: nameRef.current, nodes: payloadNodes, edges: payloadEdges, baseUpdatedAt: base.current });
        base.current = saved.updatedAt;
        setCanvas(saved);
        setProblems(saved.problems ?? []);
        if (revRef.current === startRev) {
          dirty.current = false;
          setStatus("salvo");
        }
        setError("");
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) setExternal(true);
        setStatus("erro");
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    saving.current = job;
    await job;
    saving.current = null;
  }, [id]);

  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(() => void save(), 900);
    return () => clearTimeout(t);
  }, [rev, save]);

  // antes de executar, o painel pede para gravar o que estiver pendente
  useEffect(() => {
    if (flushRef) flushRef.current = save;
    return () => {
      if (flushRef) flushRef.current = null;
    };
  }, [save, flushRef]);

  // ---------------------------------------------------------------- mudancas de fora (o Claude via MCP, outra janela)
  useEffect(() => {
    if (!remoteUpdatedAt || !canvas || remoteUpdatedAt === base.current) return;
    if (!dirty.current && !saving.current) getCanvas(id).then((c) => apply(c)).catch(() => undefined);
    else setExternal(true);
  }, [remoteUpdatedAt, canvas, id, apply]);

  // ---------------------------------------------------------------- grafo
  const onNodesChange = useCallback(
    (changes: NodeChange<Node<CardData>>[]) => {
      setNodes((ns) => applyNodeChanges(changes, ns));
      if (changes.some((c) => c.type === "remove")) touch();
    },
    [touch]
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((es) => applyEdgeChanges(changes, es));
      if (changes.some((c) => c.type === "remove")) touch();
    },
    [touch]
  );
  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      if (!c.source || !c.target || c.source === c.target) return false;
      const target = nodesRef.current.find((n) => n.id === c.target);
      if (!target || (specs.get(target.data.node.type)?.inputs ?? 1) === 0) return false;
      if (edgesRef.current.some((e) => e.source === c.source && e.target === c.target && (e.sourceHandle ?? "main") === (c.sourceHandle ?? "main"))) return false;
      return !reaches(edgesRef.current, c.target, c.source);
    },
    [specs]
  );
  const onConnect = useCallback(
    (c: Connection) => {
      const port = c.sourceHandle ?? "main";
      setEdges((es) => [...es, { id: `${c.source}_${port}_${c.target}`, source: c.source, target: c.target, sourceHandle: port }]);
      touch();
    },
    [touch]
  );

  function patchNode(nodeId: string, fn: (n: CanvasNode) => CanvasNode) {
    setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, node: fn(n.data.node) } } : n)));
    touch();
  }

  function addNode(type: NodeType) {
    const spec = specs.get(type);
    if (!spec) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    const jitter = (nodesRef.current.length % 5) * 24;
    const pos = rf.screenToFlowPosition({ x: (rect?.left ?? 0) + (rect?.width ?? 600) / 2 + jitter, y: (rect?.top ?? 0) + (rect?.height ?? 400) / 2 + jitter });
    const nid = uniqueId(type, nodesRef.current.map((n) => n.id));
    const config = type === "agent.llm" ? { provider: "auto", tools: [] } : type === "ui.block" ? { w: 520, h: 380 } : {};
    const node: CanvasNode = { id: nid, type, name: spec.label, x: pos.x, y: pos.y, config };
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { ...toRfNode(node), selected: true }]);
    setMenu("");
    touch();
  }

  async function remove() {
    if (!window.confirm(`Excluir o canvas "${name}"?`)) return;
    try {
      await deleteCanvas(id);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  // ---------------------------------------------------------------- derivados
  const invalidIds = useMemo(() => {
    const set = new Set<string>();
    for (const p of problems) for (const m of Array.from(p.matchAll(/\(([a-z][a-z0-9_]*)\)/g))) set.add(m[1]);
    return set;
  }, [problems]);
  const onResized = useCallback(
    (nodeId: string, w: number, h: number) => {
      setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, node: { ...n.data.node, config: { ...n.data.node.config, w, h } } } } : n)));
      touch();
    },
    [touch]
  );
  const viewNodes = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        data: { ...n.data, spec: specs.get(n.data.node.type), log: logs.get(n.id), invalid: invalidIds.has(n.id), block: blockMap.get(String(n.data.node.config.blockId ?? "")), onResized } as CardData & Partial<UiBlockData>,
      })),
    [nodes, specs, logs, invalidIds, blockMap, onResized]
  );
  const viewEdges = useMemo(
    () =>
      edges.map((e) => {
        const count = logs.get(e.source)?.itemsOut[e.sourceHandle ?? "main"] ?? 0;
        const target = logs.get(e.target);
        return count > 0 && target && target.status !== "skipped" ? { ...e, animated: run?.status === "running", label: `${count}`, className: "edge-run" } : e;
      }),
    [edges, logs, run?.status]
  );
  const selected = nodes.find((n) => n.selected);

  // o painel de execucao pediu para selecionar um no
  useEffect(() => {
    if (!selectRequest) return;
    setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === selectRequest.id })));
    const n = nodesRef.current.find((x) => x.id === selectRequest.id);
    if (n) void rf.setCenter(n.position.x + 125, n.position.y + 40, { zoom: 1, duration: 300 });
  }, [selectRequest, rf]);
  useEffect(() => onSelectNode?.(selected?.id ?? null), [selected?.id, onSelectNode]);

  if (!canvas) return <div className="empty">{error || "Carregando canvas…"}</div>;

  return (
    <div className="ed" ref={wrapRef}>
      <div className="ed-bar">
        <input className="ed-name" value={name} onChange={(e) => (setName(e.target.value), touch())} aria-label="Nome do canvas" />
        {canvas.source === "agent" && <span className="chip" title="Editado pelo Claude via MCP: revise antes de executar">rascunho do Claude</span>}
        <span className="ed-muted">{status === "salvo" ? "Salvo" : status === "salvando" ? "Salvando…" : status === "pendente" ? "Alterações…" : "Erro ao salvar"}</span>
        <span className="ed-spacer" />
        {problems.length > 0 && (
          <button className="btn" style={{ borderColor: "var(--warn)", color: "var(--warn)" }} onClick={() => setMenu(menu === "problems" ? "" : "problems")}>
            <Icon name="alert" size={12} /> {problems.length} {problems.length === 1 ? "problema" : "problemas"}
          </button>
        )}
        <button className="icon-btn" title="Excluir canvas" onClick={() => void remove()}>
          <Icon name="trash" size={14} />
        </button>
      </div>

      {external && (
        <div className="banner">
          Este canvas foi alterado em outro lugar (o Claude ou outra janela).
          <button className="btn" onClick={() => getCanvas(id).then((c) => apply(c, true)).catch((e) => setError(String(e)))}>
            Recarregar
          </button>
          <button
            className="btn"
            onClick={() => {
              if (remoteUpdatedAt) base.current = remoteUpdatedAt;
              setExternal(false);
            }}
          >
            Manter a minha
          </button>
        </div>
      )}
      {error && (
        <div className="err toast" onClick={() => setError("")}>
          {error}
        </div>
      )}

      <div className="ed-body">
        <ReactFlow
          nodes={viewNodes}
          edges={viewEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          onNodeDragStop={touch}
          onPaneClick={() => setMenu("")}
          deleteKeyCode={["Backspace", "Delete"]}
          colorMode={theme}
          minZoom={0.2}
          maxZoom={1.6}
          fitView
          fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={22} size={1.2} />
          <Controls showInteractive={false} position="bottom-left" />
          <MiniMap pannable zoomable position="bottom-right" nodeStrokeWidth={2} />
        </ReactFlow>

        <div className="ed-add">
          <button className="btn btn-primary" onClick={() => setMenu(menu === "add" ? "" : "add")} disabled={!catalog}>
            <Icon name="plus" size={13} /> Adicionar nó
          </button>
          {menu === "add" && catalog && (
            <div className="menu">
              {(["input", "agent", "tool", "data", "ui", "logic", "output", "note"] as const).map((cat) => (
                <div key={cat}>
                  <div className="menu-label">{CATEGORY_LABEL[cat]}</div>
                  {catalog.nodes
                    .filter((s) => s.category === cat)
                    .map((s) => (
                      <button key={s.type} className="menu-item" onClick={() => addNode(s.type)} title={s.description}>
                        <Icon name={NODE_ICON[s.type] ?? "agent"} size={14} />
                        <span>{s.label}</span>
                      </button>
                    ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {menu === "problems" && (
          <div className="problems">
            <b>O que falta</b>
            <ul>
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        )}

        {selected && (
          <Inspector
            key={selected.id}
            node={selected.data.node}
            spec={specs.get(selected.data.node.type)}
            catalog={catalog}
            collections={collectionsQ.data ?? []}
            blocks={blocksQ.data ?? []}
            log={logs.get(selected.id)}
            onRename={(v) => patchNode(selected.id, (n) => ({ ...n, name: v }))}
            onConfig={(key, value) =>
              patchNode(selected.id, (n) => {
                const config = { ...n.config };
                if (value === undefined) delete config[key];
                else config[key] = value;
                return { ...n, config };
              })
            }
            onOnError={(v) => patchNode(selected.id, (n) => ({ ...n, onError: v }))}
            onDelete={() => void rf.deleteElements({ nodes: [{ id: selected.id }] })}
            onClose={() => setNodes((ns) => ns.map((n) => ({ ...n, selected: false })))}
          />
        )}
      </div>
    </div>
  );
}

interface Props {
  id: string;
  catalog: Catalog | null;
  run: CanvasRun | null;
  /** updatedAt do canvas na lista (o pai consulta): se mudar, o editor recarrega ou avisa. */
  remoteUpdatedAt?: string;
  onDeleted: () => void;
  onSelectNode?: (id: string | null) => void;
  /** Muda para pedir que o editor selecione/centralize um no. */
  selectRequest?: { id: string; n: number } | null;
  /** O pai chama `flushRef.current()` antes de executar para gravar o que estiver pendente. */
  flushRef?: { current: (() => Promise<void>) | null };
}

/** Editor visual do canvas (React Flow): nos, fios, configuracao e dados de execucao por no. */
export default function CanvasEditor(props: Props) {
  return (
    <ReactFlowProvider>
      <Editor {...props} />
    </ReactFlowProvider>
  );
}
