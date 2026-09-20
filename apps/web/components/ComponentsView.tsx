"use client";

import { useEffect, useState } from "react";
import Icon from "@/lib/icons";
import { approveBlock, createBlock, deleteBlock, getLint, listBlocks, listVersions, restoreVersion, saveBlock, saveTheme, usePolled, useStudioTheme, type Block, type StudioTheme } from "@/lib/studio-api";
import BlockFrame, { type FrameLog } from "./BlockFrame";

const STARTER = {
  html: '<div class="ac-stack"><div class="ac-title">Meu componente</div><div id="out" class="ac-muted">Carregando…</div></div>',
  css: "",
  js: "studio.main(async (ctx) => {\n  document.getElementById('out').textContent = 'Olá do Studio!';\n});",
};

const SOURCE_LABEL = { package: "pacote", user: "você", agent: "Claude" } as const;

function permLine(b: Block): string {
  const p = b.permissions;
  return (
    [p.read.length ? `ler: ${p.read.join(", ")}` : "", p.write.length ? `gravar: ${p.write.join(", ")}` : "", p.tools.length ? `ferramentas: ${p.tools.join(", ")}` : "", p.agents.length ? `agentes: ${p.agents.join(", ")}` : ""]
      .filter(Boolean)
      .join(" · ") || "nenhuma permissão pedida"
  );
}

/** Design tokens do Studio: valem para TODOS os componentes e para o app (ficam salvos no banco). */
function ThemePanel() {
  const tokens = useStudioTheme();
  const [error, setError] = useState("");
  const set = (patch: Partial<StudioTheme>) => saveTheme(patch).then(() => setError("")).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  return (
    <div className="conn">
      <div className="conn-head">Tema (design consistente em todos os componentes)</div>
      <div className="pk-actions" style={{ alignItems: "center" }}>
        <label className="label" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          Cor de destaque
          <input type="color" value={tokens.accent || "#2f7de1"} onChange={(e) => void set({ accent: e.target.value })} />
          <button className="btn btn-sm" onClick={() => void set({ accent: "" })} disabled={!tokens.accent}>
            padrão
          </button>
        </label>
        <label className="label" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          Cantos
          <input type="range" min={0} max={24} value={tokens.radius} onChange={(e) => void set({ radius: Number(e.target.value) })} />
          <span className="mono">{tokens.radius}px</span>
        </label>
        <label className="label" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          Fonte
          <input type="range" min={11} max={18} value={tokens.fontSize} onChange={(e) => void set({ fontSize: Number(e.target.value) })} />
          <span className="mono">{tokens.fontSize}px</span>
        </label>
        <label className="label" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          Densidade
          <select className="input" style={{ width: "auto" }} value={tokens.density} onChange={(e) => void set({ density: e.target.value as StudioTheme["density"] })}>
            <option value="comfortable">Confortável</option>
            <option value="compact">Compacta</option>
          </select>
        </label>
      </div>
      {error && <div className="err">{error}</div>}
    </div>
  );
}

function Versions({ block, onChanged }: { block: Block; onChanged: () => void }) {
  const versions = usePolled(() => listVersions(block.id), 10_000, ["blocks"]);
  const [error, setError] = useState("");
  const list = versions.data ?? [];
  return (
    <div className="stack" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span className="help">Cada alteração de design/código guarda a versão anterior. Restaurar coloca o componente de volta (e pede nova aprovação).</span>
      {error && <div className="err">{error}</div>}
      {list.map((v) => (
        <div key={v.id} className="row-item" style={{ cursor: "default" }}>
          <span className="grow">
            {new Date(v.createdAt).toLocaleString()} · {v.author === "agent" ? "Claude" : "você"}
            {v.note ? ` · ${v.note}` : ""}
          </span>
          <span className="chip">{Math.ceil(v.bytes / 1024)} KB</span>
          <button
            className="btn btn-sm"
            onClick={() =>
              window.confirm("Restaurar esta versão? A atual vai para o histórico.") &&
              restoreVersion(block.id, v.id)
                .then(() => (onChanged(), versions.refresh()))
                .catch((e) => setError(e instanceof Error ? e.message : String(e)))
            }
          >
            Restaurar
          </button>
        </div>
      ))}
      {versions.data && list.length === 0 && <div className="empty">Ainda sem versões anteriores.</div>}
    </div>
  );
}

function Detail({ block, onChanged }: { block: Block; onChanged: () => void }) {
  const [tab, setTab] = useState<"preview" | "js" | "html" | "css" | "versoes">("preview");
  const lint = usePolled(() => getLint(block.id), 12_000, ["blocks", "data"]);
  const [draft, setDraft] = useState({ html: block.html, css: block.css, js: block.js });
  const [reload, setReload] = useState(0);
  const [logs, setLogs] = useState<FrameLog[]>([]);
  const [error, setError] = useState("");
  const dirty = draft.html !== block.html || draft.css !== block.css || draft.js !== block.js;

  useEffect(() => {
    setDraft({ html: block.html, css: block.css, js: block.js });
  }, [block.id, block.updatedAt, block.html, block.css, block.js]);

  async function act(fn: () => Promise<unknown>) {
    setError("");
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="split-main">
      <div className="page-head">
        <div style={{ flex: 1, minWidth: 220 }}>
          <h2 style={{ fontSize: 17 }}>{block.name}</h2>
          <p>{block.description || "Sem descrição."}</p>
        </div>
        <span className="chip">{SOURCE_LABEL[block.source]}</span>
        {block.approved ? <span className="chip chip-ok">aprovado</span> : <span className="chip chip-off">aguardando aprovação</span>}
      </div>
      <div className="perm-line">{permLine(block)}</div>
      {error && <div className="err">{error}</div>}
      <div className="pk-actions">
        {block.approved ? (
          <button className="btn" onClick={() => void act(() => approveBlock(block.id, false))}>
            Revogar aprovação
          </button>
        ) : (
          <button className="btn btn-primary" onClick={() => void act(() => approveBlock(block.id, true))} title="Libera este componente a usar as permissões acima">
            <Icon name="check" size={13} /> Aprovar permissões
          </button>
        )}
        <button
          className="btn btn-danger"
          onClick={() => window.confirm(`Excluir o componente "${block.name}"?`) && void act(() => deleteBlock(block.id))}
        >
          <Icon name="trash" size={13} /> Excluir
        </button>
        <button className="btn" onClick={() => setReload((n) => n + 1)}>
          Recarregar
        </button>
      </div>
      <div className="tabs" style={{ borderBottom: "1px solid var(--border)" }}>
        {(["preview", "js", "html", "css", "versoes"] as const).map((t) => (
          <button key={t} className={`tab${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>
            {t === "preview" ? "Pré-visualização" : t === "versoes" ? "Versões" : t.toUpperCase()}
          </button>
        ))}
      </div>
      {(lint.data?.warnings.length ?? 0) > 0 && (
        <div className="warnbox">
          <b>Consistência</b>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {lint.data?.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      {tab === "versoes" ? (
        <Versions block={block} onChanged={onChanged} />
      ) : tab === "preview" ? (
        <>
          <div className="preview">
            <BlockFrame
              block={{ id: block.id, config: block.config, html: block.html, css: block.css, js: block.js, permissions: block.permissions, approved: block.approved, refreshSeconds: block.refreshSeconds }}
              reloadKey={reload}
              onLog={(l) => setLogs((prev) => [...prev.slice(-30), l])}
            />
          </div>
          {logs.length > 0 && (
            <pre className="sample" style={{ maxHeight: 120, overflow: "auto", margin: 0 }}>
              {logs.map((l) => `${l.level === "error" ? "ERRO " : ""}${l.text}`).join("\n")}
            </pre>
          )}
        </>
      ) : (
        <>
          <textarea className="code" style={{ minHeight: 320 }} spellCheck={false} value={draft[tab]} onChange={(e) => setDraft({ ...draft, [tab]: e.target.value })} />
          <div className="pk-actions">
            <button className="btn btn-primary" disabled={!dirty} onClick={() => void act(() => saveBlock(block.id, draft))}>
              Salvar (revoga a aprovação)
            </button>
            {dirty && (
              <button className="btn" onClick={() => setDraft({ html: block.html, css: block.css, js: block.js })}>
                Descartar
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Componentes visuais (blocos): quem criou, permissões, aprovação, código e pré-visualização ao vivo. */
export default function ComponentsView() {
  const blocks = usePolled(listBlocks, 8000, ["blocks"]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const list = blocks.data ?? [];
  const active = list.find((b) => b.id === activeId) ?? list[0];

  async function create() {
    const name = window.prompt("Nome do novo componente:");
    if (!name?.trim()) return;
    try {
      const b = await createBlock({ name: name.trim(), ...STARTER });
      await blocks.refresh();
      setActiveId(b.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ flex: 1, minWidth: 260 }}>
          <h2>Componentes</h2>
          <p>Telas do seu dashboard: HTML + CSS + JS guardados no banco. Rodam isolados e só acessam o que você aprovar. Peça ao Claude no terminal para criar novos.</p>
        </div>
        <button className="btn btn-primary" onClick={() => void create()}>
          <Icon name="plus" size={13} /> Novo componente
        </button>
      </div>
      {(error || blocks.error) && <div className="err">{error || blocks.error}</div>}
      <ThemePanel />
      <div className="split">
        <div className="split-list">
          {list.map((b) => (
            <button key={b.id} className={`row-item${active?.id === b.id ? " active" : ""}`} onClick={() => setActiveId(b.id)}>
              <Icon name="layout" size={14} />
              <span className="grow">{b.name}</span>
              {!b.approved && <span className="st st-pending" title="aguardando aprovação" />}
            </button>
          ))}
          {blocks.data && list.length === 0 && <div className="empty">Nenhum componente ainda. Instale um pacote na Biblioteca ou peça ao Claude.</div>}
        </div>
        {active && <Detail key={active.id} block={active} onChanged={() => void blocks.refresh()} />}
      </div>
    </div>
  );
}
