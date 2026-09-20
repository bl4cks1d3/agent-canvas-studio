"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import Icon, { NODE_ICON } from "@/lib/icons";
import type { CanvasNode, NodeLog, NodeSpec } from "@/lib/api";

export interface CardData extends Record<string, unknown> {
  node: CanvasNode;
  spec?: NodeSpec;
  log?: NodeLog;
  invalid?: boolean;
}

const PORT_LABEL: Record<string, string> = { true: "verdadeiro", false: "falso" };
const STATUS_LABEL: Record<string, string> = { ok: "ok", error: "erro", skipped: "pulado", simulated: "simulado", running: "rodando…" };

const text = (v: unknown) => (typeof v === "string" ? v : v === undefined || v === null ? "" : JSON.stringify(v));

function subtitle(n: CanvasNode): string {
  const c = n.config;
  switch (n.type) {
    case "input.prompt":
      return text(c.text);
    case "agent.llm":
    case "agent.claude":
      return text(c.instructions);
    case "tool.call":
      return text(c.tool);
    case "logic.if":
      return text(c.condition);
    case "output.result":
      return text(c.title);
    default:
      return "";
  }
}

/** Texto que o no produziu na ultima execucao (o "dado ao vivo" do cartao). */
function preview(log?: NodeLog): string {
  const items = log?.output?.main ?? log?.output?.result ?? Object.values(log?.output ?? {})[0];
  const first = items?.[0] as Record<string, unknown> | undefined;
  if (!first) return "";
  return typeof first.text === "string" ? first.text : JSON.stringify(first);
}

/** Cartao de um no: entrada a esquerda, saidas a direita, e o que o no produziu na ultima execucao. */
export default function NodeCard({ data, selected }: NodeProps) {
  const { node, spec, log, invalid } = data as CardData;
  if (node.type === "note") {
    return (
      <div className={`note-node${selected ? " sel" : ""}`}>
        <b>{node.name}</b>
        <p>{text(node.config.text)}</p>
      </div>
    );
  }
  const outputs = spec?.outputs ?? ["main"];
  const cat = spec?.category ?? "agent";
  const tools = Array.isArray(node.config.tools) ? (node.config.tools as string[]) : [];
  const out = preview(log);
  return (
    <div className={`node cat-${cat}${selected ? " sel" : ""}${log ? ` run-${log.status}` : ""}${invalid ? " invalid" : ""}`}>
      {(spec?.inputs ?? 1) === 1 && <Handle type="target" position={Position.Left} className="handle" />}
      <div className="node-head">
        <Icon name={NODE_ICON[node.type] ?? "agent"} size={15} />
        <b title={node.name}>{node.name}</b>
        {log && <span className={`badge badge-${log.status}`}>{STATUS_LABEL[log.status]}</span>}
      </div>
      <div className="node-sub" title={subtitle(node)}>
        {subtitle(node) || spec?.label}
      </div>
      {node.type === "agent.llm" && (
        <div className="node-tags">
          <span className="tag">{String(node.config.provider || "auto")}</span>
          {tools.slice(0, 3).map((t) => (
            <span key={t} className="tag">
              {t.replace(/^mcp__/, "")}
            </span>
          ))}
          {tools.length > 3 && <span className="tag">+{tools.length - 3}</span>}
        </div>
      )}
      {log?.error && <div className="node-out" style={{ color: "var(--danger)" }}>{log.error}</div>}
      {!log?.error && out && log?.status !== "skipped" && <div className="node-out">{out}</div>}
      {log && (
        <div className="node-io">
          {log.status === "skipped" ? "sem entrada" : `${log.itemsIn} → ${Object.values(log.itemsOut).join(" · ") || 0}`}
          {log.steps ? ` · ${log.steps} passo(s)` : ""}
          {log.toolsUsed?.length ? ` · ${log.toolsUsed.join(", ")}` : ""}
          {log.durationMs ? ` · ${(log.durationMs / 1000).toFixed(1)}s` : ""}
        </div>
      )}
      {invalid && (
        <span className="warn-dot" title="Faltam dados neste nó">
          <Icon name="alert" size={12} />
        </span>
      )}
      {outputs.map((port, i) => (
        <Handle
          key={port}
          type="source"
          id={port}
          position={Position.Right}
          className="handle"
          style={outputs.length > 1 ? { top: `${((i + 1) / (outputs.length + 1)) * 100}%` } : undefined}
        >
          {outputs.length > 1 && <span className="port-label">{PORT_LABEL[port] ?? port}</span>}
        </Handle>
      ))}
    </div>
  );
}
