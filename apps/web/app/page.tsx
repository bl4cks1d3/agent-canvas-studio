"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import BuilderPanel from "@/components/BuilderPanel";
import CanvasEditor from "@/components/CanvasEditor";
import ComponentsView from "@/components/ComponentsView";
import DashboardView from "@/components/DashboardView";
import DataView from "@/components/DataView";
import LibraryView from "@/components/LibraryView";
import NotificationCenter from "@/components/NotificationCenter";
import Icon from "@/lib/icons";
import RunPanel from "@/components/RunPanel";
import SettingsView from "@/components/SettingsView";
import Sidebar, { type Template } from "@/components/Sidebar";
import TerminalDock from "@/components/TerminalDock";
import { createPage, deletePage, listPages, reorderPages, usePolled, useStudioTheme } from "@/lib/studio-api";
import { cancelRun, createCanvas, getCatalog, getRun, listRuns, startRun, useCanvasList, type CanvasRun, type Catalog } from "@/lib/api";

const ACTIVE_KEY = "agent-canvas.active";
type View = "dashboard" | "canvas" | "library" | "components" | "data" | "settings";
const PAGE_KEY = "agent-canvas.page";
const VIEWS: Array<{ id: View; label: string; icon: string }> = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard" },
  { id: "canvas", label: "Orquestração", icon: "canvas" },
  { id: "library", label: "Biblioteca", icon: "library" },
  { id: "components", label: "Componentes", icon: "layout" },
  { id: "data", label: "Dados", icon: "database" },
  { id: "settings", label: "Configurações", icon: "gear" },
];

export default function Page() {
  const { list, online, refresh } = useCanvasList();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [run, setRun] = useState<CanvasRun | null>(null);
  const [view, setView] = useState<View>("dashboard");
  const pages = usePolled(listPages, 4000);
  const [pageId, setPageId] = useState<string | null>(null);
  const [focus, setFocus] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const tokens = useStudioTheme();
  useEffect(() => {
    const root = document.documentElement.style;
    if (tokens.accent) root.setProperty("--accent", tokens.accent);
    else root.removeProperty("--accent");
  }, [tokens.accent]);
  const [dock, setDock] = useState<"run" | "terminal" | "min">("run");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [selectReq, setSelectReq] = useState<{ id: string; n: number } | null>(null);
  const flushRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    getCatalog().then(setCatalog).catch(() => undefined);
  }, [online]);

  // canvas ativo: o ultimo usado, ou o primeiro da lista
  useEffect(() => {
    if (!list) return;
    if (activeId && list.some((c) => c.id === activeId)) return;
    const saved = window.localStorage.getItem(ACTIVE_KEY);
    setActiveId(list.find((c) => c.id === saved)?.id ?? list[0]?.id ?? null);
  }, [list, activeId]);

  const active = list?.find((c) => c.id === activeId);

  useEffect(() => {
    const ps = pages.data;
    if (!ps) return;
    if (pageId && ps.some((p) => p.id === pageId)) return;
    const saved = window.localStorage.getItem(PAGE_KEY);
    setPageId(ps.find((p) => p.id === saved)?.id ?? ps[0]?.id ?? null);
  }, [pages.data, pageId]);
  useEffect(() => {
    if (pageId) window.localStorage.setItem(PAGE_KEY, pageId);
  }, [pageId]);
  const activePage = pages.data?.find((p) => p.id === pageId);

  // tela cheia de verdade (Fullscreen API); Esc sai
  useEffect(() => {
    const onChange = () => setFocus(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  function toggleFocus() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else {
      setFocus(true);
      void document.documentElement.requestFullscreen().catch(() => undefined);
    }
  }

  async function newPage() {
    const name = window.prompt("Nome da nova página:", "Nova página");
    if (!name?.trim()) return;
    try {
      const created = await createPage(name.trim());
      await pages.refresh();
      setPageId(created.id);
      setView("dashboard");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }
  async function removePage(target: { id: string; name: string }) {
    if (!window.confirm(`Excluir a página "${target.name}"? Os componentes continuam existindo.`)) return;
    await deletePage(target.id).catch(() => undefined);
    if (pageId === target.id) setPageId(null);
    await pages.refresh();
  }
  async function movePage(id: string, dir: -1 | 1) {
    const ids = (pages.data ?? []).map((x) => x.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await reorderPages(ids).catch(() => undefined);
    await pages.refresh();
  }

  // ao trocar de canvas: mostra a ultima execucao dele
  useEffect(() => {
    setRun(null);
    setMessage("");
    if (!activeId) return;
    window.localStorage.setItem(ACTIVE_KEY, activeId);
    let dead = false;
    listRuns(activeId, 1).then((r) => !dead && setRun(r[0] ?? null)).catch(() => undefined);
    return () => {
      dead = true;
    };
  }, [activeId]);

  // acompanha a execucao em andamento
  useEffect(() => {
    if (!run || run.status !== "running") return;
    const t = setInterval(() => {
      getRun(run.id).then((r) => {
        setRun(r);
        if (r.status !== "running") void refresh();
      }).catch(() => undefined);
    }, 700);
    return () => clearInterval(t);
  }, [run?.id, run?.status, refresh]);

  async function create(t: Template) {
    try {
      const c = await createCanvas(t.build());
      await refresh();
      setActiveId(c.id);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  async function start(mode: "dry" | "live", input: string) {
    if (!active) return;
    setMessage("");
    if (mode === "live") {
      const claude = active.nodes.some((n) => n.type === "agent.claude");
      const text = claude
        ? "Executar de verdade?\n\nOs agentes de IA vão consumir cota e este canvas roda o Claude Code no seu computador (com as ferramentas que você liberou nos nós)."
        : "Executar de verdade?\n\nOs agentes de IA vão consumir cota do provedor e as ferramentas marcadas vão agir (ex.: gravar arquivos).";
      if (!window.confirm(text)) return;
    }
    setBusy(true);
    try {
      await flushRef.current?.();
      setRun(await startRun(active.id, { mode, input, confirmed: mode === "live" ? true : undefined }));
      setDock("run");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`app${focus ? " focus" : ""}`}>
      <Sidebar mode={view === "canvas" ? "canvas" : "dashboard"} pages={pages.data} activePageId={pageId} onPickPage={(id) => (setPageId(id), setView("dashboard"))} onCreatePage={() => void newPage()} onDeletePage={(pg) => void removePage(pg)} onMovePage={(id, d) => void movePage(id, d)} list={list} online={online} activeId={activeId} catalog={catalog} onPick={(id) => (setActiveId(id), setView("canvas"))} onCreate={(t) => void create(t)} onOpenSettings={() => setView("settings")} />
      <main className="main">
        <div className="tabs">
          {VIEWS.map((v) => (
            <button key={v.id} className={`tab${view === v.id ? " active" : ""}`} onClick={() => setView(v.id)}>
              <Icon name={v.icon} size={14} /> {v.label}
            </button>
          ))}
          <span className="tab-spacer" />
          <button className="tab" onClick={() => setBuilderOpen(true)} title="O Claude Code constrói dados, componentes e páginas a partir do seu pedido">
            <Icon name="agent" size={14} /> Criar com Claude
          </button>
          <NotificationCenter />
        </div>
        {view === "library" && (
          <LibraryView
            onOpenPage={(id) => {
              void pages.refresh().then(() => {
                setPageId(id);
                setView("dashboard");
              });
            }}
            onOpenCanvas={(id) => {
              void refresh().then(() => {
                setActiveId(id);
                setView("canvas");
              });
            }}
          />
        )}
        {view === "dashboard" &&
          (pageId ? (
            <DashboardView key={pageId} pageId={pageId} remoteUpdatedAt={activePage?.updatedAt} focus={focus} onToggleFocus={toggleFocus} onRenamed={() => void pages.refresh()} />
          ) : (
            <div className="empty">{pages.data ? "Nenhuma página ainda. Crie uma ao lado, instale um pacote na Biblioteca ou peça ao Claude." : "Carregando…"}</div>
          ))}
        {view === "components" && <ComponentsView />}
        {view === "data" && <DataView />}
        {view === "settings" && <SettingsView onCatalogChanged={() => void getCatalog().then(setCatalog).catch(() => undefined)} onGoogleChanged={() => void getCatalog().then(setCatalog).catch(() => undefined)} />}
        <div className="editor-slot" style={{ display: view === "canvas" ? undefined : "none" }}>
          {activeId && active ? (
            <CanvasEditor
              key={activeId}
              id={activeId}
              catalog={catalog}
              run={run}
              remoteUpdatedAt={active.updatedAt}
              flushRef={flushRef}
              selectRequest={selectReq}
              onDeleted={() => {
                setActiveId(null);
                void refresh();
              }}
            />
          ) : (
            <div className="empty">{online ? "Crie um canvas (modelo ou peça ao Claude no terminal) para começar." : "Aguardando o servidor…"}</div>
          )}
        </div>
        <div className={`dock${dock === "min" ? " min" : ""}`} style={{ display: view === "canvas" ? undefined : "none" }}>
          <div className="dock-tabs">
            <button className={`dock-tab${dock === "run" ? " on" : ""}`} onClick={() => setDock("run")}>
              Execução
            </button>
            <button className={`dock-tab${dock === "terminal" ? " on" : ""}`} onClick={() => setDock("terminal")}>
              Terminal
            </button>
            <span style={{ flex: 1 }} />
            <button className="dock-tab" onClick={() => setDock(dock === "min" ? "run" : "min")}>
              {dock === "min" ? "Expandir" : "Recolher"}
            </button>
          </div>
          <div className="dock-body" style={{ display: dock === "min" ? "none" : undefined }}>
            <div style={{ height: "100%", display: dock === "run" ? "block" : "none" }}>
              <RunPanel
                defaultInput={String(active?.nodes.find((n) => n.type === "input.prompt")?.config.text ?? "")}
                run={run}
                busy={busy || !active}
                message={message}
                onStart={(m, i) => void start(m, i)}
                onCancel={() => run && void cancelRun(run.id).catch(() => undefined)}
                onSelectNode={(id) => setSelectReq({ id, n: Date.now() })}
              />
            </div>
            <div style={{ height: "100%", display: dock === "terminal" ? "block" : "none" }}>
              <TerminalDock />
            </div>
          </div>
        </div>
      </main>
      <BuilderPanel
        open={builderOpen}
        onClose={() => setBuilderOpen(false)}
        pageId={view === "dashboard" ? pageId : null}
        onOpenPage={(id) => {
          void pages.refresh().then(() => {
            setPageId(id);
            setView("dashboard");
          });
        }}
        onChanged={() => void pages.refresh()}
      />
    </div>
  );
}
