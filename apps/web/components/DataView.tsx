"use client";

import { useEffect, useState } from "react";
import Icon from "@/lib/icons";
import {
  createCollection,
  createRecord,
  deleteCollection,
  deleteRecord,
  listCollections,
  listRecords,
  updateRecord,
  usePolled,
  type CollectionField,
  type CollectionWithCount,
  type DataRecord,
} from "@/lib/studio-api";

const TYPE_HELP = "tipos: text, longtext, number, date, boolean, select(a|b|c)";

function parseFields(text: string): CollectionField[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, rawType = "text"] = line.split(":").map((s) => s.trim());
      const sel = rawType.match(/^select\((.*)\)$/);
      if (sel) return { name, type: "select", options: sel[1].split("|").map((o) => o.trim()).filter(Boolean) };
      return { name, type: rawType as CollectionField["type"] };
    });
}

function display(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "boolean") return v ? "sim" : "não";
  return String(v);
}

function RecordForm({ c, initial, onSave, onCancel }: { c: CollectionWithCount; initial?: DataRecord; onSave: (body: Record<string, unknown>) => Promise<void>; onCancel: () => void }) {
  const [values, setValues] = useState<Record<string, unknown>>(() => Object.fromEntries(c.fields.map((f) => [f.name, initial?.[f.name] ?? (f.type === "boolean" ? false : "")])));
  const [error, setError] = useState("");
  return (
    <div className="conn">
      {c.fields.map((f) => (
        <label key={f.name} className="label">
          {f.label ?? f.name}
          {f.required ? " *" : ""}
          {f.type === "boolean" ? (
            <input type="checkbox" checked={values[f.name] === true} onChange={(e) => setValues({ ...values, [f.name]: e.target.checked })} />
          ) : f.type === "select" ? (
            <select className="input" value={String(values[f.name] ?? "")} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}>
              <option value="" />
              {(f.options ?? []).map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          ) : f.type === "longtext" ? (
            <textarea className="input" rows={3} value={String(values[f.name] ?? "")} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} />
          ) : (
            <input className="input" type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"} value={String(values[f.name] ?? "")} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} />
          )}
        </label>
      ))}
      {error && <div className="err">{error}</div>}
      <div className="pk-actions">
        <button
          className="btn btn-primary"
          onClick={() =>
            onSave(Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v === "" ? null : v]))).catch((e) => setError(e instanceof Error ? e.message : String(e)))
          }
        >
          Salvar
        </button>
        <button className="btn" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

function Records({ c, onChanged }: { c: CollectionWithCount; onChanged: () => void }) {
  const [rows, setRows] = useState<DataRecord[] | null>(null);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<DataRecord | "new" | null>(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      setRows(await listRecords(c.name, { limit: "200", ...(q ? { q } : {}) }));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => {
    void load();
    const t = setInterval(() => !document.hidden && !editing && void load(), 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.name, q, editing]);

  return (
    <div className="split-main">
      <div className="page-head">
        <div style={{ flex: 1, minWidth: 220 }}>
          <h2 style={{ fontSize: 17 }}>
            {c.label} <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>{c.name}</span>
          </h2>
          <p>{c.description || `${c.records} registro(s)`}</p>
        </div>
        <input className="input" style={{ width: 200 }} placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn btn-primary" onClick={() => setEditing("new")}>
          <Icon name="plus" size={13} /> Registro
        </button>
        <button className="btn btn-danger" onClick={() => window.confirm(`Excluir a coleção "${c.label}" e todos os registros?`) && void deleteCollection(c.name).then(onChanged).catch((e) => setError(String(e)))}>
          <Icon name="trash" size={13} />
        </button>
      </div>
      {error && <div className="err">{error}</div>}
      {editing && (
        <RecordForm
          c={c}
          initial={editing === "new" ? undefined : editing}
          onCancel={() => setEditing(null)}
          onSave={async (body) => {
            if (editing === "new") await createRecord(c.name, body);
            else await updateRecord(c.name, editing.id, body);
            setEditing(null);
            onChanged();
            await load();
          }}
        />
      )}
      <div style={{ overflow: "auto" }}>
        <table className="tbl">
          <thead>
            <tr>
              {c.fields.map((f) => (
                <th key={f.name}>{f.label ?? f.name}</th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((r) => (
              <tr key={r.id}>
                {c.fields.map((f) => (
                  <td key={f.name}>{display(r[f.name])}</td>
                ))}
                <td style={{ whiteSpace: "nowrap" }}>
                  <button className="btn" onClick={() => setEditing(r)}>
                    editar
                  </button>{" "}
                  <button className="btn btn-danger" onClick={() => void deleteRecord(c.name, r.id).then(() => (onChanged(), load())).catch((e) => setError(String(e)))}>
                    <Icon name="trash" size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows && rows.length === 0 && <div className="empty">Nenhum registro.</div>}
      </div>
    </div>
  );
}

/** Banco do Studio: coleções (esquema definido em uso) e seus registros. */
export default function DataView() {
  const cols = usePolled(listCollections, 5000);
  const [activeName, setActiveName] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", label: "", fields: "titulo: text\nstatus: select(aberto|feito)" });
  const [error, setError] = useState("");
  const list = cols.data ?? [];
  const active = list.find((c) => c.name === activeName) ?? list[0];

  async function create() {
    try {
      const c = await createCollection({ name: form.name.trim(), label: form.label.trim() || undefined, fields: parseFields(form.fields) });
      setCreating(false);
      await cols.refresh();
      setActiveName(c.name);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ flex: 1, minWidth: 260 }}>
          <h2>Dados</h2>
          <p>Coleções que persistem o que os componentes e agentes gravam. O esquema nasce em uso: você (ou o Claude) define os campos.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(!creating)}>
          <Icon name="plus" size={13} /> Nova coleção
        </button>
      </div>
      {(error || cols.error) && <div className="err">{error || cols.error}</div>}
      {creating && (
        <div className="conn">
          <label className="label">
            Nome (minúsculas e _)
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="tarefas" />
          </label>
          <label className="label">
            Título
            <input className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Tarefas" />
          </label>
          <label className="label">
            Campos (um por linha, nome: tipo)
            <textarea className="code" style={{ minHeight: 100 }} value={form.fields} onChange={(e) => setForm({ ...form, fields: e.target.value })} />
            <span className="help">{TYPE_HELP}</span>
          </label>
          <div className="pk-actions">
            <button className="btn btn-primary" onClick={() => void create()}>
              Criar
            </button>
          </div>
        </div>
      )}
      <div className="split">
        <div className="split-list">
          {list.map((c) => (
            <button key={c.name} className={`row-item${active?.name === c.name ? " active" : ""}`} onClick={() => setActiveName(c.name)}>
              <Icon name="database" size={14} />
              <span className="grow">{c.label}</span>
              <span className="chip">{c.records}</span>
            </button>
          ))}
          {cols.data && list.length === 0 && <div className="empty">Nenhuma coleção. Instale um pacote ou crie uma.</div>}
        </div>
        {active && <Records key={active.name} c={active} onChanged={() => void cols.refresh()} />}
      </div>
    </div>
  );
}
