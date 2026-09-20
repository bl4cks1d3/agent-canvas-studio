"use client";

import { useCallback, useEffect, useState } from "react";
import GoogleConnect from "@/components/GoogleConnect";
import { aiModels, aiSave, aiSetPreferred, aiStatus, aiTest, keysList, keysRemove, keysSave, reloadTools, type AiProviderId, type AiProviderStatus, type AiStatus } from "@/lib/integrations-api";
import { desktopTest, getNotifySettings, saveNotifySettings, sendTestNotification, type NotifySettings } from "@/lib/notifications-api";
import { loadSoundPrefs, playTone, saveSoundPrefs, TONES, type SoundPrefs, type Tone } from "@/lib/notify-sound";

const KEY_LINK: Record<AiProviderId, { url: string; label: string; hint: string }> = {
  groq: { url: "https://console.groq.com/keys", label: "console.groq.com/keys", hint: "Grátis, mas com limite de tokens por minuto (o modelo grande estoura fácil). Troque o modelo abaixo ou use o Gemini." },
  gemini: { url: "https://aistudio.google.com/apikey", label: "aistudio.google.com/apikey", hint: "Plano grátis mais folgado. Recomendado como reserva quando o Groq estourar o limite." },
  anthropic: { url: "https://console.anthropic.com/settings/keys", label: "console.anthropic.com/settings/keys", hint: "Cobrança por uso, separada da assinatura do Claude Code." },
};

type Note = { kind: "ok" | "err"; text: string } | null;

function ProviderCard({ p, onStatus }: { p: AiProviderStatus; onStatus: (s: AiStatus) => void }) {
  const [key, setKey] = useState("");
  const [model, setModel] = useState(p.model);
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState<Note>(null);
  const link = KEY_LINK[p.id];

  useEffect(() => setModel(p.model), [p.model]);

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

  return (
    <div className="pk">
      <div className="pk-top">
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3>{p.label}</h3>
          <p>{link.hint}</p>
        </div>
        <span className={`chip ${p.hasKey ? "chip-ok" : "chip-off"}`}>{p.hasKey ? "chave salva" : "sem chave"}</span>
      </div>

      <label className="label">
        {p.hasKey ? "Trocar a chave" : "Chave de API"}
        <input className="input mono" type="password" autoComplete="off" spellCheck={false} placeholder={p.hasKey ? "•••••••• (cole outra para trocar)" : "cole a chave aqui"} value={key} onChange={(e) => setKey(e.target.value)} />
        <span className="help">
          Crie em{" "}
          <a href={link.url} target="_blank" rel="noopener noreferrer">
            {link.label}
          </a>
          . Fica só no .env deste computador e nunca volta para esta tela.
        </span>
      </label>
      <div className="pk-actions" style={{ marginTop: 0 }}>
        <button
          className="btn btn-primary"
          disabled={!!busy || !key.trim()}
          onClick={() =>
            void run("key", async () => {
              onStatus(await aiSave(p.id, { apiKey: key.trim() }));
              setKey("");
              setNote({ kind: "ok", text: "Chave salva. Já vale, sem reiniciar." });
            })
          }
        >
          {busy === "key" ? "Salvando…" : "Salvar chave"}
        </button>
        {p.hasKey && (
          <button
            className="btn btn-danger"
            disabled={!!busy}
            onClick={() => {
              if (!window.confirm(`Remover a chave do ${p.label}?`)) return;
              void run("rm", async () => {
                onStatus(await aiSave(p.id, { remove: true }));
                setNote({ kind: "ok", text: "Chave removida." });
              });
            }}
          >
            Remover chave
          </button>
        )}
      </div>

      <label className="label">
        Modelo padrão
        <input className="input mono" list={`models-${p.id}`} spellCheck={false} placeholder="id exato do modelo" value={model} onChange={(e) => setModel(e.target.value)} />
        <datalist id={`models-${p.id}`}>
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <span className="help">
          Vale para os agentes em “auto” e para os deste provedor sem modelo próprio. Apague o campo e salve para voltar ao padrão do Studio.
          {models.length > 0 && ` ${models.length} modelos disponíveis: clique no campo para escolher.`}
        </span>
      </label>
      <div className="pk-actions" style={{ marginTop: 0 }}>
        <button
          className="btn"
          disabled={!!busy || !p.hasKey}
          title={p.hasKey ? "Pergunta à API do provedor quais modelos a sua chave enxerga" : "Cadastre a chave primeiro"}
          onClick={() =>
            void run("models", async () => {
              const r = await aiModels(p.id);
              setModels(r.models);
              setNote({ kind: "ok", text: `${r.models.length} modelos de conversa encontrados.` });
            })
          }
        >
          {busy === "models" ? "Buscando…" : "Carregar modelos"}
        </button>
        <button
          className="btn"
          disabled={!!busy || model.trim() === p.model}
          onClick={() =>
            void run("model", async () => {
              onStatus(await aiSave(p.id, { model: model.trim() }));
              setNote({ kind: "ok", text: "Modelo salvo." });
            })
          }
        >
          Salvar modelo
        </button>
        <button
          className="btn"
          disabled={!!busy || !p.hasKey}
          title="Faz um pedido mínimo (“ping”) com este modelo"
          onClick={() =>
            void run("test", async () => {
              const r = await aiTest(p.id, model.trim() || undefined);
              setNote(r.ok ? { kind: "ok", text: `Funcionou em ${(r.ms / 1000).toFixed(1)} s com ${r.model}.` } : { kind: "err", text: r.message });
            })
          }
        >
          {busy === "test" ? "Testando…" : "Testar"}
        </button>
      </div>

      {note && (
        <div className={note.kind === "err" ? "err" : "warnbox"} onClick={() => setNote(null)}>
          {note.text}
        </div>
      )}
    </div>
  );
}

function AiSection({ onChanged }: { onChanged: () => void }) {
  const [st, setSt] = useState<AiStatus | null>(null);
  const [error, setError] = useState("");
  const apply = useCallback(
    (s: AiStatus) => {
      setSt(s);
      onChanged();
    },
    [onChanged]
  );

  useEffect(() => {
    void aiStatus()
      .then(setSt)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) return <div className="err">{error}</div>;
  if (!st) return <p className="help">Carregando…</p>;
  const withKey = st.providers.filter((p) => p.hasKey).length;

  return (
    <>
      <div className="conn">
        <label className="label">
          Provedor preferido do modo “auto”
          <select
            className="input"
            value={st.preferred}
            onChange={(e) =>
              void aiSetPreferred(e.target.value as AiProviderId | "auto")
                .then(apply)
                .catch((err) => setError(err instanceof Error ? err.message : String(err)))
            }
          >
            <option value="auto">Automático (Groq → Gemini → Anthropic)</option>
            {st.providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
                {p.hasKey ? "" : " (sem chave)"}
              </option>
            ))}
          </select>
          <span className="help">
            Agentes em “auto” usam este primeiro. Se o limite de uso estourar ou o serviço cair, o Studio tenta sozinho o próximo provedor que tiver chave
            {withKey < 2 ? " — cadastre pelo menos duas chaves para isso funcionar." : "."}
          </span>
        </label>
      </div>

      <div className="grid">
        {st.providers.map((p) => (
          <ProviderCard key={p.id} p={p} onStatus={apply} />
        ))}
        <div className="pk">
          <div className="pk-top">
            <div style={{ minWidth: 0, flex: 1 }}>
              <h3>Claude Code</h3>
              <p>Usa a sua conta do Claude Code, sem chave de API. Escolha “claude-code” no provedor de um agente (aba Orquestração).</p>
            </div>
            <span className={`chip ${st.claude.installed ? "chip-ok" : "chip-off"}`}>{st.claude.installed ? `instalado ${st.claude.version ?? ""}` : "não instalado"}</span>
          </div>
          <p className="help">
            No modo “claude-code” o agente só enxerga as ferramentas de servidores MCP marcadas nele (como as do Google Workspace), e cada uso conta na sua assinatura. No campo de modelo do agente
            pode usar <code>sonnet</code>, <code>opus</code> ou <code>haiku</code>.
          </p>
        </div>
      </div>
    </>
  );
}

function KeysSection() {
  const [keys, setKeys] = useState<string[] | null>(null);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState<Note>(null);

  useEffect(() => {
    void keysList()
      .then((r) => setKeys(r.keys))
      .catch((e) => setNote({ kind: "err", text: e instanceof Error ? e.message : String(e) }));
  }, []);

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

  return (
    <div className="pk">
      <p className="help">
        Tokens de qualquer serviço (ex.: <code>GITHUB_TOKEN</code>, <code>BRAVE_API_KEY</code>) que um servidor MCP ou uma ferramenta precise. Ficam no .env deste computador, nunca voltam para esta tela e são herdados pelos servidores MCP
        quando as ferramentas são reconectadas.
      </p>
      {keys && keys.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {keys.map((k) => (
            <div key={k} className="conn-head" style={{ justifyContent: "space-between" }}>
              <span>
                <span className="st st-ok" /> <code>{k}</code> <span className="conn-hint">•••••••• salva</span>
              </span>
              <button
                className="btn btn-danger"
                disabled={!!busy}
                onClick={() => {
                  if (!window.confirm(`Remover ${k} do .env?`)) return;
                  void run("rm", async () => {
                    setKeys((await keysRemove(k)).keys);
                    setNote({ kind: "ok", text: `${k} removida.` });
                  });
                }}
              >
                Remover
              </button>
            </div>
          ))}
        </div>
      )}
      {keys && keys.length === 0 && <p className="help">Nenhuma chave avulsa ainda.</p>}
      <label className="label">
        Nome da variável
        <input className="input mono" placeholder="GITHUB_TOKEN" spellCheck={false} value={name} onChange={(e) => setName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))} />
        <span className="help">MAIÚSCULAS e _, terminando em KEY, TOKEN, SECRET ou PASSWORD.</span>
      </label>
      <label className="label">
        Valor
        <input className="input mono" type="password" autoComplete="off" spellCheck={false} placeholder="cole a chave aqui" value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      <div className="pk-actions" style={{ marginTop: 0 }}>
        <button
          className="btn btn-primary"
          disabled={!!busy || !name || !value}
          onClick={() =>
            void run("save", async () => {
              setKeys((await keysSave(name, value.trim())).keys);
              setNote({ kind: "ok", text: `${name} salva. Para um servidor MCP já conectado enxergá-la, clique em “Reconectar ferramentas”.` });
              setName("");
              setValue("");
            })
          }
        >
          {busy === "save" ? "Salvando…" : "Salvar chave"}
        </button>
        <button
          className="btn"
          disabled={!!busy}
          title="Reinicia os servidores MCP do .mcp.json para eles lerem as chaves novas"
          onClick={() =>
            void run("reload", async () => {
              const r = await reloadTools();
              setNote({ kind: "ok", text: `${r.servers} servidor(es) MCP reconectado(s), ${r.tools} ferramenta(s).` });
            })
          }
        >
          {busy === "reload" ? "Reconectando…" : "Reconectar ferramentas"}
        </button>
      </div>
      {note && (
        <div className={note.kind === "err" ? "err" : "warnbox"} onClick={() => setNote(null)}>
          {note.text}
        </div>
      )}
    </div>
  );
}

function NotificationsSection() {
  const [st, setSt] = useState<NotifySettings | null>(null);
  const [prefs, setPrefs] = useState<SoundPrefs>({ tone: "sino", volume: 0.6 });
  const [note, setNote] = useState<Note>(null);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    setPrefs(loadSoundPrefs());
    void getNotifySettings()
      .then(setSt)
      .catch((e) => setNote({ kind: "err", text: e instanceof Error ? e.message : String(e) }));
  }, []);

  const save = (patch: { desktop?: boolean; sound?: boolean }) =>
    void saveNotifySettings(patch)
      .then(setSt)
      .catch((e) => setNote({ kind: "err", text: e instanceof Error ? e.message : String(e) }));
  const setPref = (next: SoundPrefs) => {
    setPrefs(next);
    saveSoundPrefs(next);
  };

  if (!st) return note ? <div className="err">{note.text}</div> : <p className="help">Carregando…</p>;
  const osName = st.platform === "win32" ? "Windows" : st.platform === "darwin" ? "macOS" : "Linux";

  return (
    <div className="pk">
      <label className="label" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <input type="checkbox" checked={st.sound} onChange={(e) => save({ sound: e.target.checked })} />
        Tocar som nas notificações
      </label>
      <label className="label" style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
        <input type="checkbox" checked={st.desktop} disabled={!st.desktopSupported} onChange={(e) => save({ desktop: e.target.checked })} style={{ marginTop: 3 }} />
        <span>
          Modo desktop: notificação nativa do {osName}
          <span className="help" style={{ display: "block" }}>
            O servidor mostra o aviso no sistema, com o som do {osName}, mesmo com o navegador fechado (basta o servidor estar rodando). Com ele ligado, o Studio só mostra o balão, sem repetir o som.
          </span>
        </span>
      </label>

      <div className="conn">
        <b style={{ fontSize: 12 }}>Som dentro do Studio {st.desktop ? "(desligado enquanto o modo desktop estiver ativo)" : ""}</b>
        <div className="pk-actions" style={{ marginTop: 0, alignItems: "center" }}>
          <select className="input" style={{ width: "auto" }} value={prefs.tone} onChange={(e) => setPref({ ...prefs, tone: e.target.value as Tone })}>
            {TONES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <label className="help" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            Volume
            <input type="range" min={0} max={1} step={0.05} value={prefs.volume} onChange={(e) => setPref({ ...prefs, volume: Number(e.target.value) })} />
          </label>
          <button
            className="btn"
            onClick={() => {
              const ok = playTone(prefs.tone, prefs.volume);
              if (!ok) setNote({ kind: "err", text: "O navegador ainda não liberou o som: clique em qualquer lugar da página e tente de novo." });
            }}
          >
            Ouvir
          </button>
        </div>
      </div>

      <div className="pk-actions" style={{ marginTop: 0 }}>
        <button
          className="btn"
          disabled={!!busy || !st.desktopSupported}
          onClick={() => {
            setBusy("desktop");
            setNote(null);
            void desktopTest()
              .then((r) => setNote(r.ok ? { kind: "ok", text: "Notificação enviada ao sistema. Se não apareceu, confira o modo Foco/Não perturbe do Windows." } : { kind: "err", text: `Não consegui notificar pelo sistema: ${r.error}` }))
              .catch((e) => setNote({ kind: "err", text: e instanceof Error ? e.message : String(e) }))
              .finally(() => setBusy(""));
          }}
        >
          {busy === "desktop" ? "Enviando…" : "Testar notificação do sistema"}
        </button>
        <button
          className="btn"
          disabled={!!busy}
          onClick={() => {
            setNote(null);
            void sendTestNotification().catch((e) => setNote({ kind: "err", text: e instanceof Error ? e.message : String(e) }));
          }}
        >
          Enviar aviso de teste
        </button>
      </div>
      {note && (
        <div className={note.kind === "err" ? "err" : "warnbox"} onClick={() => setNote(null)}>
          {note.text}
        </div>
      )}
    </div>
  );
}

/** Configuracoes: chaves e modelos dos provedores de IA, notificacoes (som e modo desktop) e conta Google. */
export default function SettingsView({ onCatalogChanged, onGoogleChanged }: { onCatalogChanged: () => void; onGoogleChanged: () => void }) {
  return (
    <div className="page">
      <div className="page-head">
        <div style={{ flex: 1, minWidth: 260 }}>
          <h2>Configurações</h2>
          <p>Cadastre aqui as chaves das IAs e conecte suas contas. Tudo é gravado no .env deste computador e vale na hora, sem reiniciar.</p>
        </div>
      </div>

      <b>Provedores de IA</b>
      <AiSection onChanged={onCatalogChanged} />

      <b>Outras chaves privadas</b>
      <div className="grid">
        <KeysSection />
      </div>

      <b>Notificações: som e modo desktop</b>
      <div className="grid">
        <NotificationsSection />
      </div>

      <b>Conta Google (Agenda, Gmail e Tasks)</b>
      <div className="grid">
        <div className="pk">
          <GoogleConnect onChanged={onGoogleChanged} />
        </div>
      </div>
    </div>
  );
}
