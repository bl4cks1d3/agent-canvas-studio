"use client";

import { useEffect, useState } from "react";
import Icon from "@/lib/icons";
import type { CanvasRun } from "@/lib/api";

const STATUS: Record<string, string> = { running: "executando…", ok: "concluída", partial: "concluída com falhas", error: "erro", cancelled: "cancelada" };

/** Comando da execucao: pedido, Simular/Executar/Cancelar, resultado final e a linha do tempo por no. */
export default function RunPanel(props: {
  defaultInput: string;
  run: CanvasRun | null;
  busy: boolean;
  message: string;
  onStart: (mode: "dry" | "live", input: string) => void;
  onCancel: () => void;
  onSelectNode: (id: string) => void;
}) {
  const { run } = props;
  const [input, setInput] = useState(props.defaultInput);
  useEffect(() => setInput(props.defaultInput), [props.defaultInput]);
  const running = run?.status === "running";

  return (
    <div className="runp">
      <div className="runp-left">
        <label className="label">
          Pedido desta execução
          <textarea className="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="O que os agentes devem fazer?" />
        </label>
        <div className="runp-actions">
          <button className="btn" disabled={props.busy || running} onClick={() => props.onStart("dry", input)} title="Não gasta IA nem escreve nada: agentes e escritas são simulados">
            <Icon name="flask" size={13} /> Simular
          </button>
          <button className="btn btn-primary" disabled={props.busy || running} onClick={() => props.onStart("live", input)} title="Executa de verdade: agentes de IA, ferramentas e Claude Code">
            <Icon name="play" size={13} /> Executar
          </button>
          {running && (
            <button className="btn btn-danger" onClick={props.onCancel}>
              <Icon name="stop" size={12} /> Cancelar
            </button>
          )}
        </div>
        {props.message && <div className="err">{props.message}</div>}
        <p className="help">Simular mostra o caminho dos dados sem gastar cota. Executar chama os agentes de verdade.</p>
      </div>
      <div className="runp-right">
        {!run && <div className="empty">Nenhuma execução ainda. Escreva o pedido e clique em Executar.</div>}
        {run && (
          <>
            <div>
              <b>{run.mode === "dry" ? "Simulação" : "Execução"}</b> <span className={`badge badge-${run.status === "running" ? "running" : run.status === "ok" ? "ok" : run.status === "error" ? "error" : "skipped"}`}>{STATUS[run.status]}</span>
              {run.finishedAt && <span className="help"> · {((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000).toFixed(1)}s</span>}
            </div>
            {run.error && <div className="err">{run.error}</div>}
            {run.result && <div className="result">{run.result}</div>}
            {run.nodes.map((n) => (
              <div key={n.nodeId} className="step" onClick={() => props.onSelectNode(n.nodeId)}>
                <span className={`dot dot-${n.status}`} />
                <b>{n.name}</b>
                <span className="help">
                  {n.status === "skipped" ? "pulado" : `${n.itemsIn} → ${Object.values(n.itemsOut).join(" · ") || 0}`}
                  {n.steps ? ` · ${n.steps} passo(s)` : ""}
                  {n.toolsUsed?.length ? ` · ${n.toolsUsed.join(", ")}` : ""}
                </span>
                {n.error && <span style={{ color: "var(--danger)" }}>{n.error}</span>}
                <small>{n.durationMs ? `${(n.durationMs / 1000).toFixed(1)}s` : ""}</small>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
