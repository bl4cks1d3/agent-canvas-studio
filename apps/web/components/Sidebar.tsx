"use client";

import { useState } from "react";
import Icon from "@/lib/icons";
import VoiceButton from "./VoiceButton";
import { setTheme, useTheme } from "@/lib/theme";
import type { Canvas, Catalog } from "@/lib/api";
import type { DashboardPage } from "@/lib/studio-api";

export interface Template {
  label: string;
  hint: string;
  build: () => { name: string; nodes: unknown[]; edges: unknown[] };
}

const pedido = (text: string) => ({ id: "pedido", type: "input.prompt", name: "Pedido", config: { text } });
const fim = { id: "resultado", type: "output.result", name: "Resultado", config: {} };

export const TEMPLATES: Template[] = [
  {
    label: "Em branco",
    hint: "Pedido → Agente → Resultado",
    build: () => ({
      name: "Novo canvas",
      nodes: [pedido("Explique em 3 frases o que é um canvas de agentes."), { id: "agente", type: "agent.llm", name: "Agente", config: { instructions: "Responda ao pedido de forma clara e objetiva.", provider: "auto", tools: [] } }, fim],
      edges: [{ from: "pedido", to: "agente" }, { from: "agente", to: "resultado" }],
    }),
  },
  {
    label: "Pesquisador + Redator",
    hint: "dois agentes em cadeia",
    build: () => ({
      name: "Pesquisador + Redator",
      nodes: [
        pedido("Fale sobre a história do café."),
        { id: "pesquisador", type: "agent.llm", name: "Pesquisador", config: { instructions: "Liste 5 fatos verificáveis e relevantes sobre o pedido, em tópicos curtos.", provider: "auto", tools: [] } },
        { id: "redator", type: "agent.llm", name: "Redator", config: { instructions: "Escreva um parágrafo envolvente usando só os fatos recebidos.", provider: "auto", tools: [] } },
        fim,
      ],
      edges: [{ from: "pedido", to: "pesquisador" }, { from: "pesquisador", to: "redator" }, { from: "redator", to: "resultado" }],
    }),
  },
  {
    label: "Painel + Juiz",
    hint: "dois pareceres em paralelo e um juiz",
    build: () => ({
      name: "Painel de especialistas + Juiz",
      nodes: [
        pedido("Vale a pena aprender programação em 2026?"),
        { id: "otimista", type: "agent.llm", name: "Otimista", config: { instructions: "Defenda o lado positivo do tema em 3 frases.", provider: "auto", tools: [] } },
        { id: "cetico", type: "agent.llm", name: "Cético", config: { instructions: "Aponte os riscos e o lado negativo do tema em 3 frases.", provider: "auto", tools: [] } },
        { id: "juiz", type: "agent.llm", name: "Juiz", config: { instructions: "Você recebeu dois pareceres. Dê um veredito equilibrado em 4 frases.", provider: "auto", tools: [] } },
        fim,
      ],
      edges: [{ from: "pedido", to: "otimista" }, { from: "pedido", to: "cetico" }, { from: "otimista", to: "juiz" }, { from: "cetico", to: "juiz" }, { from: "juiz", to: "resultado" }],
    }),
  },
];

export default function Sidebar(props: {
  /** "dashboard": lista as paginas (paginacao); "canvas": lista os canvases de orquestracao. */
  mode: "dashboard" | "canvas";
  pages: DashboardPage[] | null;
  activePageId: string | null;
  onPickPage: (id: string) => void;
  onCreatePage: () => void;
  onDeletePage: (p: DashboardPage) => void;
  onMovePage: (id: string, dir: -1 | 1) => void;
  list: Canvas[] | null;
  online: boolean;
  activeId: string | null;
  catalog: Catalog | null;
  onPick: (id: string) => void;
  onCreate: (t: Template) => void;
  /** Abre a tela de Configuracoes (chaves de IA, Google, notificacoes). */
  onOpenSettings?: () => void;
  /** Botão de voz flutuante: recebe o texto falado (vira um pedido para o Claude construir). */
  onVoiceCommand?: (text: string) => void;
}) {
  const theme = useTheme();
  const [menu, setMenu] = useState(false);
  return (
    <aside className="side">
      <div className="side-head">
        <Icon name="canvas" size={18} /> Agent Canvas
      </div>
      {props.mode === "dashboard" ? (
        <>
          <div className="side-actions">
            <button className="btn btn-primary" onClick={props.onCreatePage} disabled={!props.online}>
              <Icon name="plus" size={13} /> Nova página
            </button>
          </div>
          <div className="side-list">
            <div className="side-title">Páginas</div>
            {!props.online && <div className="err">O servidor não responde (pnpm dev:server).</div>}
            {props.pages?.map((p, idx) => (
              <div key={p.id} className={`side-item page-item${p.id === props.activePageId ? " on" : ""}`} onClick={() => props.onPickPage(p.id)} role="button" tabIndex={0}>
                <Icon name="page" size={14} />
                <span>{p.name}</span>
                <small>{p.layout.filter((i) => i.kind === "block").length}</small>
                <span className="page-actions" onClick={(e) => e.stopPropagation()}>
                  <button className="icon-btn" title="Subir" disabled={idx === 0} onClick={() => props.onMovePage(p.id, -1)}>
                    ▲
                  </button>
                  <button className="icon-btn" title="Descer" disabled={idx === (props.pages?.length ?? 1) - 1} onClick={() => props.onMovePage(p.id, 1)}>
                    ▼
                  </button>
                  <button className="icon-btn" title="Excluir página" onClick={() => props.onDeletePage(p)}>
                    <Icon name="trash" size={12} />
                  </button>
                </span>
              </div>
            ))}
            {props.pages && props.pages.length === 0 && <p className="help" style={{ padding: 8 }}>Nenhuma página. Crie uma, instale um pacote na Biblioteca ou peça ao Claude.</p>}
          </div>
        </>
      ) : (
        <>
      <div className="side-actions" style={{ position: "relative" }}>
        <button className="btn btn-primary" onClick={() => setMenu((v) => !v)} disabled={!props.online}>
          <Icon name="plus" size={13} /> Novo canvas
        </button>
        {menu && (
          <div className="menu" style={{ top: "calc(100% - 4px)", left: 14 }}>
            <div className="menu-label">Começar de um modelo</div>
            {TEMPLATES.map((t) => (
              <button
                key={t.label}
                className="menu-item"
                onClick={() => {
                  setMenu(false);
                  props.onCreate(t);
                }}
              >
                <span style={{ flex: 1 }}>
                  {t.label}
                  <small style={{ display: "block", color: "var(--muted)" }}>{t.hint}</small>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="side-list">
        <div className="side-title">Canvases</div>
        {!props.online && <div className="err">O servidor não responde (pnpm dev:server).</div>}
        {props.list?.map((c) => (
          <button key={c.id} className={`side-item${c.id === props.activeId ? " on" : ""}`} onClick={() => props.onPick(c.id)}>
            <Icon name="canvas" size={14} />
            <span>{c.name}</span>
            <small>{c.nodes.filter((n) => n.type.startsWith("agent.")).length} ag.</small>
          </button>
        ))}
        {props.list && props.list.length === 0 && <p className="help" style={{ padding: 8 }}>Nenhum canvas ainda. Crie um a partir de um modelo ou peça ao Claude no terminal.</p>}
      </div>
        </>
      )}
      {props.onVoiceCommand && <VoiceButton onCommand={props.onVoiceCommand} />}
      <div className="side-foot">
        <div className="prov">
          {props.catalog?.providers.filter((p) => p.id !== "claude-code").map((p) => (
            <span key={p.id} className={`chip ${p.available ? "chip-ok" : "chip-off"}`} title={p.available ? `modelo: ${p.model}` : "sem chave: cadastre em Configurações"}>
              {p.label}
            </span>
          ))}
          {props.catalog && (
            <span className={`chip ${props.catalog.claude.installed ? "chip-ok" : "chip-off"}`} title={props.catalog.claude.version}>
              Claude Code
            </span>
          )}
        </div>
        {props.catalog && !props.catalog.providers.some((p) => p.id !== "claude-code" && p.available) && <div className="warnbox">Nenhuma chave de IA: cadastre em Configurações.</div>}
        {props.onOpenSettings && (
          <button className="btn btn-primary" onClick={props.onOpenSettings} title="Chaves privadas das IAs, conta Google e notificações">
            <Icon name="gear" size={13} /> Configurações e chaves
          </button>
        )}
        <button className="btn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          <Icon name={theme === "dark" ? "sun" : "moon"} size={13} /> {theme === "dark" ? "Tema claro" : "Tema escuro"}
        </button>
      </div>
    </aside>
  );
}
