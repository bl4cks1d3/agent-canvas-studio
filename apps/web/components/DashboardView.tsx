"use client";

import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import GridLayout, { type Layout } from "react-grid-layout";
import Icon from "@/lib/icons";
import { ApiError } from "@/lib/api";
import { approveBlock, getPage, listBlocks, savePage, usePolled, type Block, type DashboardPage, type PageItem } from "@/lib/studio-api";
import BlockFrame from "./BlockFrame";

const COLS = 12;
const ROW = 40;
const MARGIN: [number, number] = [12, 12];

const newId = () => Math.random().toString(36).slice(2, 10);

interface Props {
  pageId: string;
  /** updatedAt da pagina na lista (o pai consulta): se mudar, recarrega ou avisa. */
  remoteUpdatedAt?: string;
  focus: boolean;
  onToggleFocus: () => void;
  onRenamed: () => void;
}

/**
 * Modo dashboard: a pagina com os componentes prontos funcionando. "Editar layout" liga a organizacao: arraste
 * pelo cabecalho, redimensione pelo canto e puxe componentes da bandeja para a grade. O layout persiste no banco.
 */
export default function DashboardView({ pageId, remoteUpdatedAt, focus, onToggleFocus, onRenamed }: Props) {
  const [page, setPage] = useState<DashboardPage | null>(null);
  const [items, setItems] = useState<PageItem[]>([]);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<"salvo" | "pendente" | "salvando" | "erro">("salvo");
  const [error, setError] = useState("");
  const [external, setExternal] = useState(false);
  const [width, setWidth] = useState(0);
  const blocks = usePolled(listBlocks, 10_000, ["blocks"]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dirty = useRef(false);
  const base = useRef("");
  const saving = useRef<Promise<void> | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const nameRef = useRef(name);
  nameRef.current = name;
  const blockMap = useMemo(() => new Map((blocks.data ?? []).map((b) => [b.id, b])), [blocks.data]);

  const apply = useCallback((p: DashboardPage) => {
    setPage(p);
    setItems(p.layout);
    setName(p.name);
    base.current = p.updatedAt;
    dirty.current = false;
    setStatus("salvo");
    setExternal(false);
  }, []);

  useEffect(() => {
    let dead = false;
    setPage(null);
    setEditing(false);
    getPage(pageId)
      .then((p) => !dead && apply(p))
      .catch((e) => !dead && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      dead = true;
    };
  }, [pageId, apply]);

  useEffect(() => {
    if (!remoteUpdatedAt || !page || remoteUpdatedAt === base.current) return;
    if (!dirty.current && !saving.current) getPage(pageId).then(apply).catch(() => undefined);
    else setExternal(true);
  }, [remoteUpdatedAt, page, pageId, apply]);

  // largura real da grade
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      setWidth(Math.max(0, el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [page]);

  // ---------------------------------------------------------------- salvar (layout persiste no banco)
  const touch = useCallback(() => {
    dirty.current = true;
    setStatus("pendente");
  }, []);

  const save = useCallback(async () => {
    if (saving.current) await saving.current;
    if (!dirty.current) return;
    const job = (async () => {
      setStatus("salvando");
      try {
        const saved = await savePage(pageId, { name: nameRef.current, layout: itemsRef.current, baseUpdatedAt: base.current });
        base.current = saved.updatedAt;
        dirty.current = false;
        setStatus("salvo");
        setError("");
        onRenamed();
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) setExternal(true);
        setStatus("erro");
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    saving.current = job;
    await job;
    saving.current = null;
  }, [pageId, onRenamed]);

  useEffect(() => {
    if (status !== "pendente") return;
    const t = setTimeout(() => void save(), 700);
    return () => clearTimeout(t);
  }, [status, items, name, save]);

  // ---------------------------------------------------------------- edicao
  const layout: Layout[] = useMemo(
    () => items.map((it) => ({ i: it.i, x: it.x, y: it.y, w: it.w, h: it.h, minW: it.kind === "heading" ? 2 : 2, minH: it.kind === "heading" ? 1 : 3, maxH: it.kind === "heading" ? 2 : undefined, static: !editing })),
    [items, editing]
  );

  function onLayoutChange(next: Layout[]) {
    if (!editing) return;
    const byId = new Map(next.map((l) => [l.i, l]));
    let changed = false;
    const merged = itemsRef.current.map((it) => {
      const l = byId.get(it.i);
      if (!l || (l.x === it.x && l.y === it.y && l.w === it.w && l.h === it.h)) return it;
      changed = true;
      return { ...it, x: l.x, y: l.y, w: l.w, h: l.h };
    });
    if (changed) {
      setItems(merged);
      touch();
    }
  }

  function add(kind: "block" | "heading", blockId?: string, at?: { x: number; y: number; w: number; h: number }) {
    const bottom = itemsRef.current.reduce((m, it) => Math.max(m, it.y + it.h), 0);
    const w = at?.w ?? (kind === "heading" ? COLS : 6);
    const item: PageItem = {
      i: newId(),
      kind,
      x: at ? Math.min(at.x, COLS - w) : 0,
      y: at?.y ?? bottom,
      w,
      h: at?.h ?? (kind === "heading" ? 1 : 9),
      ...(kind === "block" ? { blockId } : { text: "Nova seção" }),
    };
    setItems((prev) => [...prev, item]);
    touch();
  }

  function remove(i: string) {
    setItems((prev) => prev.filter((it) => it.i !== i));
    touch();
  }

  function onDrop(_: Layout[], dropped: Layout, e: Event) {
    const data = (e as DragEvent).dataTransfer?.getData("text/plain") ?? "";
    if (data === "heading") add("heading", undefined, { x: 0, y: dropped.y, w: COLS, h: 1 });
    else if (data.startsWith("block:")) add("block", data.slice(6), { x: dropped.x, y: dropped.y, w: dropped.w, h: dropped.h });
  }

  async function approve(b: Block) {
    try {
      await approveBlock(b.id, true);
      await blocks.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (!page) return <div className="empty">{error || "Carregando página…"}</div>;
  const missing = (it: PageItem) => it.kind === "block" && !blockMap.has(it.blockId ?? "");

  return (
    <div className={`dash${editing ? " editing" : ""}${focus ? " focus" : ""}`}>
      <div className="dash-bar">
        {editing ? <input className="ed-name" value={name} onChange={(e) => (setName(e.target.value), touch())} aria-label="Nome da página" /> : <h2>{page.name}</h2>}
        <span className="ed-muted">{status === "salvo" ? (editing ? "Layout salvo" : "") : status === "erro" ? "Erro ao salvar" : "Salvando…"}</span>
        <span className="ed-spacer" />
        {!focus && (
          <button
            className={`btn${editing ? " btn-primary" : ""}`}
            onClick={async () => {
              if (editing) await save();
              setEditing(!editing);
            }}
          >
            <Icon name={editing ? "check" : "layout"} size={13} /> {editing ? "Concluir" : "Editar layout"}
          </button>
        )}
        <button className="btn" onClick={onToggleFocus} title={focus ? "Sair da tela cheia (Esc)" : "Tela cheia"}>
          <Icon name={focus ? "x" : "expand"} size={13} /> {focus ? "Sair" : "Tela cheia"}
        </button>
      </div>

      {external && (
        <div className="banner">
          Esta página foi alterada em outro lugar (o Claude ou outra janela).
          <button className="btn" onClick={() => getPage(pageId).then(apply).catch((e) => setError(String(e)))}>
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

      <div className="dash-body">
        <div className="dash-scroll" ref={wrapRef}>
          {items.length === 0 && (
            <div className="empty" style={{ padding: 40 }}>
              Página vazia. {editing ? "Arraste um componente da bandeja para cá." : "Clique em “Editar layout” e arraste componentes para organizar a tela."}
            </div>
          )}
          {width > 0 && (
            <GridLayout
              className="dash-grid"
              layout={layout}
              cols={COLS}
              rowHeight={ROW}
              width={width}
              margin={MARGIN}
              containerPadding={[0, 0]}
              compactType="vertical"
              isDraggable={editing}
              isResizable={editing}
              isDroppable={editing}
              droppingItem={{ i: "__drop__", w: 6, h: 9 }}
              draggableHandle=".gi-head"
              onLayoutChange={onLayoutChange}
              onDrop={onDrop}
              useCSSTransforms
            >
              {items.map((it) => {
                const b = it.blockId ? blockMap.get(it.blockId) : undefined;
                return (
                  <div key={it.i} className={`gi${it.kind === "heading" ? " gi-heading" : ""}`}>
                    {editing && (
                      <div className="gi-head">
                        <Icon name={it.kind === "heading" ? "note" : "layout"} size={13} />
                        <span className="grow">{it.kind === "heading" ? "Título de seção" : (b?.name ?? "Componente removido")}</span>
                        {b && !b.approved && (
                          <button className="btn btn-sm" onMouseDown={(e) => e.stopPropagation()} onClick={() => void approve(b)} title="Aprovar as permissões deste componente">
                            Aprovar
                          </button>
                        )}
                        <button className="icon-btn" onMouseDown={(e) => e.stopPropagation()} onClick={() => remove(it.i)} title="Remover da página">
                          <Icon name="x" size={13} />
                        </button>
                      </div>
                    )}
                    {it.kind === "heading" ? (
                      editing ? (
                        <input
                          className="gi-heading-input"
                          value={it.text ?? ""}
                          onMouseDown={(e) => e.stopPropagation()}
                          onChange={(e) => (setItems((prev) => prev.map((x) => (x.i === it.i ? { ...x, text: e.target.value } : x))), touch())}
                        />
                      ) : (
                        <h3 className="gi-heading-text">{it.text}</h3>
                      )
                    ) : (
                      <div className="gi-body">
                        {b ? (
                          <BlockFrame block={{ id: b.id, config: b.config, html: b.html, css: b.css, js: b.js, permissions: b.permissions, approved: b.approved, refreshSeconds: b.refreshSeconds }} />
                        ) : (
                          <div className="uib-empty">{missing(it) && blocks.data ? "Este componente foi removido." : "Carregando…"}</div>
                        )}
                        {editing && <div className="gi-shield" />}
                      </div>
                    )}
                  </div>
                );
              })}
            </GridLayout>
          )}
        </div>

        {editing && (
          <aside className="dash-palette">
            <b>Bandeja</b>
            <span className="help">Arraste para a página (ou clique em +).</span>
            <div
              className="pal-item"
              draggable
              unselectable="on"
              onDragStart={(e) => e.dataTransfer.setData("text/plain", "heading")}
              onClick={() => add("heading")}
            >
              <Icon name="note" size={13} />
              <span className="grow">Título de seção</span>
              <Icon name="plus" size={12} />
            </div>
            {(blocks.data ?? []).map((b) => (
              <div key={b.id} className="pal-item" draggable unselectable="on" onDragStart={(e) => e.dataTransfer.setData("text/plain", `block:${b.id}`)} onClick={() => add("block", b.id)} title={b.description}>
                <Icon name="layout" size={13} />
                <span className="grow">{b.name}</span>
                {!b.approved && <span className="st st-pending" title="aguardando aprovação" />}
                <Icon name="plus" size={12} />
              </div>
            ))}
            {blocks.data && blocks.data.length === 0 && <span className="help">Nenhum componente ainda: instale um pacote na Biblioteca ou peça ao Claude.</span>}
          </aside>
        )}
      </div>
    </div>
  );
}
