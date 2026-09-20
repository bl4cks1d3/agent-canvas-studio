"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "@/lib/icons";
import { approveBlock, builderStatus, cancelBuild, getBuild, listBuilds, startBuild, type BuilderRun } from "@/lib/studio-api";

const EXAMPLES = [
  "Um kanban de tarefas com prioridade e prazo",
  "Um CRM simples: contatos, negócios e funil de vendas",
  "Um controle de gastos do mês com gráfico por categoria",
  "Um painel de notas rápidas com busca e tags",
];

const KIND_LABEL: Record<string, string> = { say: "Claude", tool: "ferramenta", error: "erro", info: "" };

/**
 * "Criar com Claude": descreva o que quer e o Claude Code (em segundo plano, so com as ferramentas do Agent Canvas)
 * constroi dados, componentes e paginas sozinho. Os componentes dele ficam aguardando a sua aprovacao.
 */
export default function BuilderPanel({ open, onClose, pageId, onOpenPage, onChanged }: { open: boolean; onClose: () => void; pageId: string | null; onOpenPage: (id: string) => void; onChanged: () => void }) {
  const [prompt, setPrompt] = useState("");
  const [run, setRun] = useState<BuilderRun | null>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState<{ ok: boolean; why: string } | null>(null);
  const [approved, setApproved] = useState<Record<string, boolean>>({});
  const logRef = useRef<HTMLDivElement>(null);
  const running = run?.status === "running";

  // ao abrir: checa o Claude Code e retoma a execucao mais recente
  useEffect(() => {
    if (!open) return;
    builderStatus()
      .then((s) => setReady(s.claude.installed ? (s.mcpBuilt ? { ok: true, why: "" } : { ok: false, why: 'Compile o MCP: pnpm build:mcp' }) : { ok: false, why: "O Claude Code não está instalado neste computador." }))
      .catch(() => setReady({ ok: false, why: "O servidor não responde." }));
    listBuilds()
      .then((r) => r[0] && setRun((cur) => cur ?? r[0]))
      .catch(() => undefined);
  }, [open]);

  // acompanha a execucao em andamento
  useEffect(() => {
    if (!run || run.status !== "running") return;
    const t = setInterval(() => {
      getBuild(run.id)
        .then((r) => {
          setRun(r);
          if (r.status !== "running") onChanged();
        })
        .catch(() => undefined);
    }, 1500);
    return () => clearInterval(t);
  }, [run?.id, run?.status, onChanged]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [run?.events.length]);

  async function start() {
    setError("");
    try {
      setApproved({});
      setRun(await startBuild(prompt.trim(), pageId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function approve(id: string) {
    try {
      await approveBlock(id, true);
      setApproved((a) => ({ ...a, [id]: true }));
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (!open) return null;
  const ch = run?.changes;
  const blocks = [...(ch?.blocksCreated ?? []), ...(ch?.blocksUpdated ?? [])];

  return (
    <aside className="builder">
      <div className="builder-head">
        <Icon name="agent" size={16} />
        <b>Criar com Claude</b>
        <span style={{ flex: 1 }} />
        <button className="icon-btn" onClick={onClose} title="Fechar">
          <Icon name="x" size={14} />
        </button>
      </div>
      <div className="builder-body">
        {ready && !ready.ok && <div className="warnbox">{ready.why}</div>}
        <p className="help">
          Descreva o que você quer no dashboard. O Claude Code cria sozinho as coleções (dados), os componentes e a página, usando o design system do Studio. Os componentes dele só rodam depois que você aprovar.
        </p>
        <textarea className="input" rows={4} value={prompt} placeholder="Ex.: um kanban de projetos com colunas e prazo…" onChange={(e) => setPrompt(e.target.value)} disabled={running} />
        <div className="pk-meta">
          {EXAMPLES.map((ex) => (
            <button key={ex} className="chip chip-btn" disabled={running} onClick={() => setPrompt(ex)}>
              {ex}
            </button>
          ))}
        </div>
        <div className="pk-actions">
          {running ? (
            <button className="btn btn-danger" onClick={() => run && void cancelBuild(run.id)}>
              <Icon name="stop" size={13} /> Cancelar
            </button>
          ) : (
            <button className="btn btn-primary" disabled={!prompt.trim() || (ready ? !ready.ok : false)} onClick={() => void start()}>
              <Icon name="play" size={13} /> Construir
            </button>
          )}
          {pageId && !running && <span className="help">Os componentes novos podem entrar na página atual.</span>}
        </div>
        {error && <div className="err">{error}</div>}

        {run && (
          <>
            <div className="builder-status">
              <span className={`st st-${run.status === "ok" ? "ok" : run.status === "running" ? "pending" : ""}`} />
              {run.status === "running" ? "Construindo…" : run.status === "ok" ? "Concluído" : run.status === "cancelled" ? "Cancelado" : "Terminou com erro"}
              <span className="help" style={{ marginLeft: "auto", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={run.prompt}>
                {run.prompt}
              </span>
            </div>
            <div className="builder-log" ref={logRef}>
              {run.events.map((e, i) => (
                <div key={i} className={`bl bl-${e.kind}`}>
                  {KIND_LABEL[e.kind] && <small>{KIND_LABEL[e.kind]}</small>}
                  <span>{e.text}</span>
                </div>
              ))}
            </div>
            {run.error && <div className="err">{run.error}</div>}
            {run.result && run.status !== "running" && <div className="builder-result">{run.result}</div>}
            {ch && run.status !== "running" && (
              <div className="builder-changes">
                {ch.collections.length > 0 && (
                  <div>
                    <b>Coleções criadas</b> {ch.collections.join(", ")}
                  </div>
                )}
                {blocks.map((b) => (
                  <div key={b.id} className="row-item" style={{ cursor: "default" }}>
                    <Icon name="layout" size={13} />
                    <span className="grow">{b.name}</span>
                    {b.approved || approved[b.id] ? (
                      <span className="chip chip-ok">aprovado</span>
                    ) : (
                      <button className="btn btn-sm btn-primary" onClick={() => void approve(b.id)} title="Libera o componente a usar as permissões dele (veja em Componentes)">
                        Aprovar
                      </button>
                    )}
                  </div>
                ))}
                {[...ch.pagesCreated, ...ch.pagesUpdated].map((p) => (
                  <div key={p.id} className="row-item" style={{ cursor: "default" }}>
                    <Icon name="page" size={13} />
                    <span className="grow">{p.name}</span>
                    <button className="btn btn-sm" onClick={() => onOpenPage(p.id)}>
                      Abrir
                    </button>
                  </div>
                ))}
                {ch.collections.length + blocks.length + ch.pagesCreated.length + ch.pagesUpdated.length === 0 && <div className="help">Nada foi criado ou alterado.</div>}
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
