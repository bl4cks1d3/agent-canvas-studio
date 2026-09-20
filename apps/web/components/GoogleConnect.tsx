"use client";

import { useEffect, useRef, useState } from "react";
import {
  googleAuthorize,
  googleDisconnect,
  googleRefresh,
  googleSetup,
  googleStatus,
  googleTest,
  parseGoogleClientFile,
  type GoogleStatus,
} from "@/lib/integrations-api";

type Note = { kind: "ok" | "err" | "info"; text: string; url?: string };

const Step = ({ ok, label, hint }: { ok: boolean; label: string; hint?: string }) => (
  <div className="conn-head">
    <span className={`st ${ok ? "st-ok" : "st-pending"}`} />
    {label}
    {hint && <span className="conn-hint">{hint}</span>}
  </div>
);

/**
 * Botao "Conectar conta Google" do pacote Google Workspace: escolhe o client_secret.json baixado do Google Cloud (ou cola as chaves),
 * o servidor grava no .env, declara o servidor MCP e reconecta; depois "Entrar com o Google" abre o login e "Testar" confirma.
 */
export default function GoogleConnect({ onChanged }: { onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [st, setSt] = useState<GoogleStatus | null>(null);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState<Note | null>(null);
  const [email, setEmail] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [fileInfo, setFileInfo] = useState("");
  const [replacing, setReplacing] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    void googleStatus()
      .then((s) => {
        setSt(s);
        setEmail((cur) => cur || s.email);
      })
      .catch((e) => setNote({ kind: "err", text: e instanceof Error ? e.message : String(e) }));
  }, [open]);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setNote(null);
    try {
      await fn();
    } catch (e) {
      setNote({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy("");
    }
  }

  function pickFile(f: File | undefined) {
    if (!f) return;
    void f
      .text()
      .then((raw) => {
        const c = parseGoogleClientFile(raw);
        setClientId(c.clientId);
        setClientSecret(c.clientSecret);
        setFileInfo(`${f.name} (${c.type === "web" ? "aplicativo da Web: registre o URI de redirecionamento http://localhost:8000/oauth2callback no Google Cloud" : "app para computador"})`);
        setNote(null);
      })
      .catch((e) => setNote({ kind: "err", text: e instanceof Error ? e.message : String(e) }));
  }

  const done = (s: GoogleStatus, text: string) => {
    setSt(s);
    setClientId("");
    setClientSecret("");
    setFileInfo("");
    setReplacing(false);
    setNote({ kind: s.running ? "ok" : "err", text: s.running ? text : s.error ? `O servidor do Google não iniciou: ${s.error}` : "O servidor do Google não iniciou. Veja o terminal do servidor." });
    onChanged();
  };

  function save() {
    if (!window.confirm("Isto vai gravar as chaves no .env e ligar o servidor MCP do Google, que roda no seu computador via uvx (baixa o pacote workspace-mcp na primeira vez, pode levar 1 min).\n\nContinuar?")) return;
    void run("setup", async () => done(await googleSetup({ email: email.trim(), clientId: clientId.trim(), clientSecret: clientSecret.trim() }), "Servidor conectado. Agora clique em “Entrar com o Google”."));
  }

  const needsKeys = !st?.hasCredentials || replacing;
  const canSave = !!email.trim() && (!needsKeys || (!!clientId && !!clientSecret));

  return (
    <div className="conn" style={{ gap: 10 }}>
      <div className="pk-actions" style={{ marginTop: 0 }}>
        <button className="btn btn-primary" onClick={() => setOpen(!open)}>
          {open ? "Fechar" : st?.running ? "Conta Google" : "Conectar conta Google"}
        </button>
        {!open && <span className="conn-hint">Agenda, Gmail e Tasks. Você escolhe o arquivo client_secret.json do Google Cloud e faz o login.</span>}
      </div>

      {open && (
        <>
          {st && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <Step ok={st.uv} label="uv instalado" hint={st.uv ? undefined : "o servidor não achou o uvx: instale (docs.astral.sh/uv); se já instalou, reinicie o servidor (pnpm dev) para ele enxergar o PATH"} />
              <Step ok={st.hasCredentials} label="Chaves do Google salvas" hint={st.hasCredentials && st.email ? st.email : undefined} />
              <Step ok={st.running} label="Servidor do Google conectado" hint={st.running ? `${st.tools} ferramentas` : st.error ? st.error.slice(0, 160) : st.configured ? "configurado, não iniciou" : undefined} />
              {st.packageInstalled && st.mapped.length > 0 && (
                <Step ok={st.mapped.some((m) => m.tool)} label="Ferramentas ligadas ao pacote" hint={`${st.mapped.filter((m) => m.tool).length} de ${st.mapped.length}`} />
              )}
            </div>
          )}

          <label className="label">
            E-mail da conta Google
            <input className="input" type="email" placeholder="voce@gmail.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>

          {needsKeys ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="pk-actions" style={{ marginTop: 0, alignItems: "center" }}>
                <input ref={file} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={(e) => pickFile(e.target.files?.[0])} />
                <button className="btn" onClick={() => file.current?.click()}>
                  Escolher client_secret.json
                </button>
                {fileInfo ? <span className="conn-hint">✓ {fileInfo}</span> : <span className="conn-hint">baixado do Google Cloud; a leitura acontece aqui no seu navegador</span>}
              </div>
              <details>
                <summary className="conn-hint" style={{ cursor: "pointer" }}>
                  Ou cole o Client ID e o Client secret
                </summary>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                  <input className="input mono" placeholder="Client ID (…apps.googleusercontent.com)" value={clientId} onChange={(e) => setClientId(e.target.value)} />
                  <input className="input mono" type="password" autoComplete="off" placeholder="Client secret" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} />
                </div>
              </details>
              <details>
                <summary className="conn-hint" style={{ cursor: "pointer" }}>
                  Como conseguir esse arquivo
                </summary>
                <ol className="help" style={{ paddingLeft: 18, marginTop: 6 }}>
                  <li>Em console.cloud.google.com, crie um projeto e ative as APIs Google Calendar, Gmail e Tasks.</li>
                  <li>Tela de consentimento OAuth: usuário “Externo” e adicione seu e-mail como usuário de teste.</li>
                  <li>Credenciais → Criar credenciais → ID do cliente OAuth → “App para computador”.</li>
                  <li>Baixe o JSON (ícone de download) e escolha aqui. Depois pode apagar o arquivo da pasta Downloads.</li>
                </ol>
              </details>
            </div>
          ) : (
            <div className="conn-hint">
              Chaves salvas no .env. <button className="btn btn-sm" onClick={() => setReplacing(true)}>Trocar arquivo</button>
            </div>
          )}

          <div className="pk-actions" style={{ marginTop: 0 }}>
            <button className="btn btn-primary" disabled={!!busy || !canSave || (st ? !st.uv : false)} onClick={save}>
              {busy === "setup" ? "Conectando… (na primeira vez baixa o servidor)" : st?.running ? "Salvar e reconectar" : "Salvar e conectar"}
            </button>
            <button
              className="btn"
              disabled={!!busy || !st?.running}
              title="Abre o login do Google numa nova aba"
              onClick={() =>
                void run("auth", async () => {
                  const r = await googleAuthorize();
                  if (r.url) {
                    window.open(r.url, "_blank", "noopener,noreferrer");
                    setNote({ kind: "info", text: "Faça o login na aba que abriu e volte aqui para clicar em “Testar conexão”.", url: r.url });
                  } else setNote({ kind: "info", text: `O servidor não devolveu um link de login (talvez já esteja autorizado). Resposta: ${r.message}` });
                })
              }
            >
              {busy === "auth" ? "Pedindo o link…" : "Entrar com o Google"}
            </button>
            <button
              className="btn"
              disabled={!!busy || !st?.running}
              onClick={() =>
                void run("test", async () => {
                  const r = await googleTest();
                  setNote(r.ok ? { kind: "ok", text: "Conta autorizada: a agenda respondeu. Abra o dashboard Workspace." } : r.needsAuth ? { kind: "info", text: "Ainda falta autorizar a conta. Use “Entrar com o Google”.", url: r.url } : { kind: "err", text: r.message });
                })
              }
            >
              {busy === "test" ? "Testando…" : "Testar conexão"}
            </button>
            <button
              className="btn"
              disabled={!!busy}
              title="Relê o .mcp.json, reconecta e liga as ferramentas ao pacote"
              onClick={() => void run("refresh", async () => done(await googleRefresh(), "Ferramentas reconectadas."))}
            >
              {busy === "refresh" ? "Verificando…" : "Verificar ferramentas"}
            </button>
            {(st?.configured || st?.hasCredentials) && (
              <button
                className="btn btn-danger"
                disabled={!!busy}
                onClick={() => {
                  if (!window.confirm("Desconectar? Isto remove o servidor do .mcp.json e apaga as chaves do Google do .env. (O login autorizado fica guardado pelo servidor do Google; revogue em myaccount.google.com/permissions se quiser.)")) return;
                  void run("off", async () => {
                    setSt(await googleDisconnect());
                    setNote({ kind: "info", text: "Conta desconectada." });
                    onChanged();
                  });
                }}
              >
                Desconectar
              </button>
            )}
          </div>

          {note && (
            <div className={note.kind === "err" ? "err" : "warnbox"} onClick={() => setNote(null)}>
              {note.text}
              {note.url && (
                <>
                  {" "}
                  <a href={note.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                    abrir o login
                  </a>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
