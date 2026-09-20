"use client";

import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import Icon from "@/lib/icons";
import type { Block } from "@/lib/studio-api";
import type { CanvasNode } from "@/lib/api";
import BlockFrame from "./BlockFrame";

export interface UiBlockData extends Record<string, unknown> {
  node: CanvasNode;
  block?: Block;
  onResized?: (id: string, w: number, h: number) => void;
  invalid?: boolean;
}

/** Nó "Componente": o componente visual rodando ao vivo dentro do canvas (iframe isolado, com as permissões dele). */
export default function UiBlockNode({ data, selected }: NodeProps) {
  const { node, block, onResized, invalid } = data as UiBlockData;
  return (
    <div className={`uib${selected ? " selected" : ""}`} style={{ width: "100%", height: "100%", borderColor: invalid ? "var(--warn)" : undefined }}>
      <NodeResizer isVisible={selected} minWidth={240} minHeight={160} onResizeEnd={(_, p) => onResized?.(node.id, Math.round(p.width), Math.round(p.height))} />
      <Handle type="target" position={Position.Left} className="handle" />
      <div className="uib-head">
        <Icon name="layout" size={14} />
        <span className="grow" title={node.name}>
          {block?.name ?? node.name}
        </span>
        {block && !block.approved && <span className="badge badge-skipped">aguardando aprovação</span>}
      </div>
      <div className="uib-body nodrag nowheel nopan">
        {block ? (
          <BlockFrame block={{ id: block.id, config: block.config, html: block.html, css: block.css, js: block.js, permissions: block.permissions, approved: block.approved, refreshSeconds: block.refreshSeconds }} />
        ) : (
          <div className="uib-empty">Escolha o componente deste nó no painel à direita.</div>
        )}
      </div>
    </div>
  );
}
