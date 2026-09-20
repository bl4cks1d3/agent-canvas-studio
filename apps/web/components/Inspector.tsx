"use client";

import { useEffect, useState } from "react";
import Icon from "@/lib/icons";
import type { Catalog, CanvasNode, FieldSpec, NodeLog, NodeSpec } from "@/lib/api";
import type { Block, Collection } from "@/lib/studio-api";

function JsonField({ value, onChange, placeholder, rows = 5 }: { value: unknown; onChange: (v: unknown) => void; placeholder?: string; rows?: number }) {
  const initial = value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const [text, setText] = useState(initial);
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setText(initial);
    setBad(false);
    // ressincroniza so ao trocar de no (o pai muda a key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <textarea
      className={`input mono${bad ? " bad" : ""}`}
      rows={rows}
      value={text}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => {
        const v = e.target.value;
        setText(v);
        if (!v.trim()) {
          setBad(false);
          onChange(undefined);
          return;
        }
        try {
          onChange(JSON.parse(v));
          setBad(false);
        } catch {
          setBad(true);
          onChange(v);
        }
      }}
    />
  );
}

function Field({ spec, node, catalog, collections, blocks, onConfig }: { spec: FieldSpec; node: CanvasNode; catalog: Catalog | null; collections: Collection[]; blocks: Block[]; onConfig: (key: string, value: unknown) => void }) {
  const value = node.config[spec.key];
  const set = (v: unknown) => onConfig(spec.key, v);
  const str = typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
  switch (spec.kind) {
    case "textarea":
      return <textarea className="input" rows={5} value={str} placeholder={spec.placeholder} onChange={(e) => set(e.target.value)} />;
    case "number":
      return <input className="input" type="number" value={str} placeholder={spec.placeholder} onChange={(e) => set(e.target.value === "" ? undefined : Number(e.target.value))} />;
    case "select": {
      const options = spec.key === "provider" ? (catalog?.providers.map((p) => p.id) ?? spec.options ?? []) : (spec.options ?? []);
      const withAuto = spec.key === "provider" ? ["auto", ...options.filter((o) => o !== "auto")] : options;
      return (
        <select className="input" value={str || withAuto[0]} onChange={(e) => set(e.target.value)}>
          {withAuto.map((o) => {
            const p = catalog?.providers.find((x) => x.id === o);
            return (
              <option key={o} value={o}>
                {o}
                {p && !p.available ? " (sem chave)" : ""}
              </option>
            );
          })}
        </select>
      );
    }
    case "json":
      return <JsonField key={node.id + spec.key} value={value} placeholder={spec.placeholder} onChange={set} />;
    case "tool": {
      const tool = catalog?.tools.find((t) => t.name === str);
      return (
        <>
          <input className="input mono" list="ac-tools" value={str} placeholder={spec.placeholder} onChange={(e) => set(e.target.value)} />
          <datalist id="ac-tools">
            {(catalog?.tools ?? []).map((t) => (
              <option key={t.name} value={t.name}>
                {t.description}
              </option>
            ))}
          </datalist>
          {tool && (
            <p className="help">
              Parâmetros: {tool.params.map((p) => (tool.required.includes(p) ? `${p}*` : p)).join(", ") || "nenhum"}
              {tool.readOnly ? " · leitura (roda até na simulação)" : ""}
            </p>
          )}
        </>
      );
    }
    case "tools": {
      const selected = new Set(Array.isArray(value) ? (value as string[]) : []);
      const toggle = (name: string) => {
        const next = new Set(selected);
        if (next.has(name)) next.delete(name);
        else next.add(name);
        set(Array.from(next));
      };
      return (
        <div className="tools-list">
          {(catalog?.tools ?? []).map((t) => (
            <label key={t.name} className="tool-opt" title={t.description}>
              <input type="checkbox" checked={selected.has(t.name)} onChange={() => toggle(t.name)} />
              <span>
                {t.name.replace(/^mcp__/, "")}
                <small>{t.source}</small>
              </span>
            </label>
          ))}
          {catalog && catalog.tools.length === 0 && <span className="help">Nenhuma ferramenta disponível.</span>}
        </div>
      );
    }
    case "collection":
      return (
        <select className="input" value={str} onChange={(e) => set(e.target.value || undefined)}>
          <option value="">— escolha —</option>
          {collections.map((c) => (
            <option key={c.name} value={c.name}>
              {c.label} ({c.name})
            </option>
          ))}
        </select>
      );
    case "block":
      return (
        <select className="input" value={str} onChange={(e) => set(e.target.value || undefined)}>
          <option value="">— escolha —</option>
          {blocks.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
              {b.approved ? "" : " (aguardando aprovação)"}
            </option>
          ))}
        </select>
      );
    default:
      return <input className="input" value={str} placeholder={spec.placeholder} onChange={(e) => set(e.target.value)} />;
  }
}

function Sample({ title, items }: { title: string; items?: unknown[] }) {
  if (!items) return null;
  const shown = items.map((i) => (typeof (i as { text?: unknown }).text === "string" ? (i as { text: string }).text : JSON.stringify(i, null, 2))).join("\n\n— — —\n\n");
  return (
    <details className="sample" open={items.length > 0 && items.length <= 2}>
      <summary>
        {title} <span className="help">({items.length}{items.length >= 5 ? "+" : ""})</span>
      </summary>
      <pre>{items.length ? shown : "vazio"}</pre>
    </details>
  );
}

/** Painel de configuracao do no selecionado + dados da ultima execucao. */
export default function Inspector(props: {
  node: CanvasNode;
  spec?: NodeSpec;
  catalog: Catalog | null;
  collections: Collection[];
  blocks: Block[];
  log?: NodeLog;
  onRename: (name: string) => void;
  onConfig: (key: string, value: unknown) => void;
  onOnError: (v: "stop" | "continue") => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { node, spec, catalog, log } = props;
  return (
    <aside className="insp" onKeyDown={(e) => e.stopPropagation()}>
      <div className="insp-head">
        <b>{spec?.label ?? node.type}</b>
        <button className="icon-btn" title="Fechar" onClick={props.onClose}>
          <Icon name="x" size={14} />
        </button>
      </div>
      <p className="help">{spec?.description}</p>
      <label className="label">
        Nome
        <input className="input" value={node.name} onChange={(e) => props.onRename(e.target.value)} />
      </label>
      {spec?.fields.map((f) => (
        <label key={f.key} className="label">
          {f.label}
          {f.required ? " *" : ""}
          <Field spec={f} node={node} catalog={catalog} collections={props.collections} blocks={props.blocks} onConfig={props.onConfig} />
          {f.help && <span className="help">{f.help}</span>}
        </label>
      ))}
      {spec && spec.inputs === 1 && node.type !== "output.result" && (
        <label className="label">
          Se der erro
          <select className="input" value={node.onError ?? "stop"} onChange={(e) => props.onOnError(e.target.value as "stop" | "continue")}>
            <option value="stop">Parar a execução</option>
            <option value="continue">Descartar e seguir</option>
          </select>
        </label>
      )}
      <p className="help">
        Use <code>{"{{json.text}}"}</code> (item atual), <code>{"{{input.text}}"}</code> (pedido) e <code>{"{{nodes.<id>.items[0].text}}"}</code>. id deste nó: <code>{node.id}</code>
      </p>
      {log && (
        <div>
          <b>Última execução</b>
          {log.error && <div className="err">{log.error}</div>}
          {log.warnings?.map((w) => (
            <div key={w} className="warnbox">
              {w}
            </div>
          ))}
          <Sample title="Entrada" items={log.input} />
          {log.output && Object.entries(log.output).map(([port, items]) => <Sample key={port} title={`Saída${Object.keys(log.output ?? {}).length > 1 ? ` (${port})` : ""}`} items={items} />)}
        </div>
      )}
      <button className="btn btn-danger" onClick={props.onDelete}>
        <Icon name="trash" size={13} /> Excluir nó
      </button>
    </aside>
  );
}
