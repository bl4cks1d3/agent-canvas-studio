"use client";

import { useState } from "react";
import GoogleConnect from "@/components/GoogleConnect";
import Icon from "@/lib/icons";
import { api, getCatalog, type Catalog } from "@/lib/api";
import { connectPackage, deletePackageDefinition, importPackage, installPackage, listPackages, uninstallPackage, usePolled, type PackageConnection, type PackageInfo } from "@/lib/studio-api";

const CATEGORY_ICON: Record<string, string> = { produtividade: "note", vendas: "database", financeiro: "record", integração: "link", integracao: "link" };

function ConnectionRow({ pkg, conn, catalog, onChanged, onError }: { pkg: PackageInfo; conn: PackageConnection; catalog: Catalog | null; onChanged: () => void; onError: (m: string) => void }) {
  const tools = (catalog?.tools ?? []).filter((t) => t.source.startsWith("mcp:"));
  const suggested = new Set(conn.suggestions ?? []);
  const ordered = [...tools.filter((t) => suggested.has(t.name)), ...tools.filter((t) => !suggested.has(t.name))];
  return (
    <div className="conn">
      <div className="conn-head">
        <span className={`st st-${conn.status === "ok" ? "ok" : conn.status === "pending" ? "pending" : ""}`} />
        {conn.label}
        {conn.status === "optional" && <span className="chip">opcional</span>}
      </div>
      {conn.hint && <div className="conn-hint">{conn.hint}</div>}
      {conn.kind === "tool" && (
        <>
          <select
            value={conn.value ?? ""}
            onChange={(e) =>
              connectPackage(pkg.id, { [conn.id]: e.target.value || null })
                .then(onChanged)
                .catch((err) => onError(err instanceof Error ? err.message : String(err)))
            }
          >
            <option value="">— escolha a ferramenta —</option>
            {ordered.map((t) => (
              <option key={t.name} value={t.name}>
                {suggested.has(t.name) ? "★ " : ""}
                {t.name.replace(/^mcp__/, "")}
              </option>
            ))}
          </select>
          {tools.length === 0 && (
            <div className="conn-hint">
              Nenhuma ferramenta de MCP conectada. Adicione o servidor no <code>.mcp.json</code> (ex.: Google Workspace) e use “Reconectar ferramentas”.
            </div>
          )}
        </>
      )}
      {conn.kind === "collection" && conn.status !== "ok" && <div className="conn-hint">A coleção é criada na instalação.</div>}
    </div>
  );
}

function PackageCard({ pkg, catalog, onChanged, onOpenCanvas, onOpenPage }: { pkg: PackageInfo; catalog: Catalog | null; onChanged: () => void; onOpenCanvas: (id: string) => void; onOpenPage: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = pkg.connections.filter((c) => c.status === "pending").length;

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pk">
      <div className="pk-top">
        <span className="pk-icon">
          <Icon name={CATEGORY_ICON[pkg.category] ?? "puzzle"} size={26} />
        </span>
        <div style={{ minWidth: 0 }}>
          <h3>{pkg.name}</h3>
          <p>{pkg.description}</p>
        </div>
      </div>
      <div className="pk-meta">
        <span className="chip">{pkg.category}</span>
        <span className="chip">{pkg.counts.blocks} componente(s)</span>
        <span className="chip">{pkg.counts.collections} coleção(ões)</span>
        <span className="chip">{pkg.counts.pages} página(s)</span>
        <span className="chip">{pkg.counts.canvases} canvas</span>
        {pkg.experimental && <span className="chip chip-off">experimental</span>}
        {pkg.origin === "criado" && <span className="chip">criado por você/Claude</span>}
        {pkg.installed && (pkg.ready ? <span className="chip chip-ok">instalado</span> : <span className="chip chip-off">{pending} conexão(ões) pendente(s)</span>)}
      </div>

      {pkg.id === "google-workspace" && <GoogleConnect onChanged={onChanged} />}

      {pkg.connections.length > 0 && (pkg.installed || open) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <b style={{ fontSize: 12 }}>{pkg.installed ? "Conexões" : "Vai pedir estas conexões"}</b>
          {pkg.connections.map((c) => (
            <ConnectionRow key={c.id} pkg={pkg} conn={c} catalog={catalog} onChanged={onChanged} onError={setError} />
          ))}
        </div>
      )}
      {error && <div className="err">{error}</div>}

      <div className="pk-actions">
        {!pkg.installed ? (
          <>
            <button className="btn btn-primary" disabled={busy} onClick={() => void run(() => installPackage(pkg.id).then(() => setOpen(true)))}>
              <Icon name="download" size={13} /> Instalar
            </button>
            {pkg.connections.length > 0 && (
              <button className="btn" onClick={() => setOpen(!open)}>
                {open ? "Ocultar conexões" : "Ver o que pede"}
              </button>
            )}
            {pkg.origin === "criado" && (
              <button className="btn btn-danger" disabled={busy} onClick={() => window.confirm(`Excluir a definição do pacote "${pkg.name}"?`) && void run(() => deletePackageDefinition(pkg.id))}>
                Excluir
              </button>
            )}
          </>
        ) : (
          <>
            {pkg.pageIds[0] && (
              <button className="btn btn-primary" onClick={() => onOpenPage(pkg.pageIds[0])}>
                <Icon name="dashboard" size={13} /> Abrir no dashboard
              </button>
            )}
            {pkg.canvasIds[0] && (
              <button className="btn" onClick={() => onOpenCanvas(pkg.canvasIds[0])} title="Os agentes deste pacote (orquestração)">
                <Icon name="canvas" size={13} /> Orquestração
              </button>
            )}
            <button
              className="btn btn-danger"
              disabled={busy}
              onClick={() => {
                if (!window.confirm(`Desinstalar "${pkg.name}"? Os componentes e canvases dele serão removidos.`)) return;
                const drop = window.confirm("Apagar também as coleções e os dados deste pacote?\n\nOK = apagar os dados · Cancelar = manter os dados");
                void run(() => uninstallPackage(pkg.id, drop));
              }}
            >
              Desinstalar
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Biblioteca de pacotes prontos (dashboards): instala e PEDE as conexões de que cada um precisa. */
export default function LibraryView({ onOpenCanvas, onOpenPage }: { onOpenCanvas: (id: string) => void; onOpenPage: (id: string) => void }) {
  const packages = usePolled(listPackages, 4000);
  const catalog = usePolled(getCatalog, 10000);
  const [importing, setImporting] = useState(false);
  const [text, setText] = useState("");
  const [message, setMessage] = useState("");
  const [reloading, setReloading] = useState(false);

  async function reload() {
    setReloading(true);
    try {
      const r = await api<{ servers: number; tools: number }>("/tools/reload", { method: "POST" });
      setMessage(`${r.servers} servidor(es) MCP conectado(s), ${r.tools} ferramenta(s) no total.`);
      await catalog.refresh();
      await packages.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setReloading(false);
    }
  }

  async function doImport() {
    try {
      const info = await importPackage(JSON.parse(text));
      setMessage(`Pacote "${info.name}" adicionado à biblioteca.`);
      setImporting(false);
      setText("");
      await packages.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }

  const list = packages.data ?? [];
  const installed = list.filter((p) => p.installed);
  const available = list.filter((p) => !p.installed);

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ flex: 1, minWidth: 260 }}>
          <h2>Biblioteca</h2>
          <p>Dashboards prontos. Ao instalar, o Studio cria as coleções, os componentes, as páginas do dashboard e os canvases (orquestração) do pacote e pede as conexões que ele precisa (ferramentas de MCP, chave de IA).</p>
        </div>
        <button className="btn" disabled={reloading} onClick={() => void reload()} title="Relê o .mcp.json e reconecta os servidores MCP">
          {reloading ? "Reconectando…" : "Reconectar ferramentas"}
        </button>
        <button className="btn" onClick={() => setImporting(!importing)}>
          Importar pacote (JSON)
        </button>
      </div>
      {message && (
        <div className="warnbox" onClick={() => setMessage("")}>
          {message}
        </div>
      )}
      {packages.error && <div className="err">{packages.error}</div>}
      {importing && (
        <div className="conn">
          <textarea className="code" placeholder='{"id":"meu-pacote","name":"…","description":"…","requires":[],"collections":[],"blocks":[],"canvases":[]}' value={text} onChange={(e) => setText(e.target.value)} />
          <div className="pk-actions">
            <button className="btn btn-primary" disabled={!text.trim()} onClick={() => void doImport()}>
              Adicionar
            </button>
          </div>
        </div>
      )}
      {installed.length > 0 && (
        <>
          <b>Instalados</b>
          <div className="grid">
            {installed.map((p) => (
              <PackageCard key={p.id} pkg={p} catalog={catalog.data} onChanged={() => void packages.refresh()} onOpenCanvas={onOpenCanvas} onOpenPage={onOpenPage} />
            ))}
          </div>
        </>
      )}
      <b>Disponíveis</b>
      <div className="grid">
        {available.map((p) => (
          <PackageCard key={p.id} pkg={p} catalog={catalog.data} onChanged={() => void packages.refresh()} onOpenCanvas={onOpenCanvas} onOpenPage={onOpenPage} />
        ))}
        {packages.data && available.length === 0 && <div className="empty">Tudo instalado.</div>}
      </div>
    </div>
  );
}
