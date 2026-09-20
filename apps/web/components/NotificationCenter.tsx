"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SERVER } from "@/lib/api";
import Icon from "@/lib/icons";
import { loadSoundPrefs, playTone, unlockAudio } from "@/lib/notify-sound";
import { clearNotifications, getNotifySettings, listNotifications, markNotificationsRead, NOTIFY_SETTINGS_EVENT, type AppNotification, type NotifySettings } from "@/lib/notifications-api";

/** Avisos que chegaram ha mais que isso (Studio fechado ou sem conexao) vao so para o sino, sem balao. */
const FRESH_MS = 2 * 60_000;
const TOAST_MS = 7000;
type Permission = NotificationPermission | "unsupported";

const when = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === today.toDateString() ? time : `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${time}`;
};

/**
 * Sino de notificacoes do Studio: recebe por SSE tudo que o servidor avisa (ferramenta `notify`, no "Notificar" das
 * orquestracoes, lembretes) e mostra como balao. Com a permissao do navegador, avisa tambem quando a aba esta em segundo plano.
 */
export default function NotificationCenter() {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [toasts, setToasts] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [permission, setPermission] = useState<Permission>("default");
  const seen = useRef(new Set<string>());
  const box = useRef<HTMLDivElement>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  // preferencias de entrega (som e modo desktop) vindas do servidor; o ref evita "closure velha" nos handlers
  const settings = useRef<Pick<NotifySettings, "desktop" | "sound">>({ desktop: false, sound: true });

  useEffect(() => {
    const load = () =>
      void getNotifySettings()
        .then((s) => (settings.current = { desktop: s.desktop, sound: s.sound }))
        .catch(() => undefined);
    load();
    window.addEventListener(NOTIFY_SETTINGS_EVENT, load);
    // navegadores so liberam o som depois de um gesto do usuario
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener(NOTIFY_SETTINGS_EVENT, load);
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    setPermission(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  }, []);

  const announce = useCallback((n: AppNotification) => {
    if (seen.current.has(n.id)) return;
    seen.current.add(n.id);
    setToasts((t) => [...t.slice(-3), n]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== n.id)), TOAST_MS);
    // modo desktop ligado: o servidor ja mostra a notificacao nativa (com o som do sistema); aqui so o balao, sem duplicar
    if (settings.current.desktop) return;
    if (settings.current.sound) {
      const prefs = loadSoundPrefs();
      playTone(prefs.tone, prefs.volume, n.level);
    }
    if (typeof Notification !== "undefined" && Notification.permission === "granted" && (document.hidden || !document.hasFocus())) {
      try {
        new Notification(n.title, { body: n.message || undefined, tag: n.id });
      } catch {
        // alguns navegadores exigem service worker: o balao no Studio continua valendo
      }
    }
  }, []);

  useEffect(() => {
    let dead = false;
    const load = async () => {
      try {
        const list = await listNotifications(50);
        if (dead) return;
        setItems(list);
        [...list].reverse().forEach((n) => {
          if (!n.read && Date.now() - Date.parse(n.createdAt) < FRESH_MS) announce(n);
          else seen.current.add(n.id);
        });
      } catch {
        // servidor fora: o EventSource tenta reconectar sozinho
      }
    };
    const es = new EventSource(`${SERVER}/notifications/stream`);
    es.onopen = () => void load();
    es.onmessage = (e) => {
      try {
        const n = JSON.parse(e.data) as AppNotification;
        setItems((prev) => (prev.some((p) => p.id === n.id) ? prev : [n, ...prev].slice(0, 100)));
        announce(n);
      } catch {
        // mensagem que nao e aviso
      }
    };
    return () => {
      dead = true;
      es.close();
    };
  }, [announce]);

  const unread = items.filter((n) => !n.read).length;

  const markAllRead = useCallback(async () => {
    if (!itemsRef.current.some((n) => !n.read)) return;
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    await markNotificationsRead().catch(() => undefined);
  }, []);

  // fecha o painel ao clicar fora e marca tudo como lido
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) {
        setOpen(false);
        void markAllRead();
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, markAllRead]);

  async function askPermission() {
    if (typeof Notification === "undefined") return;
    setPermission(await Notification.requestPermission());
  }
  async function clearAll() {
    setItems([]);
    await clearNotifications().catch(() => undefined);
  }

  return (
    <>
      <div className="notif" ref={box}>
        <button
          className="tab"
          onClick={() => {
            if (open) void markAllRead();
            setOpen(!open);
          }}
          title="Notificações"
          aria-label={`Notificações${unread ? `: ${unread} não lida(s)` : ""}`}
        >
          <Icon name="bell" size={14} />
          {unread > 0 && <span className="notif-count">{unread > 9 ? "9+" : unread}</span>}
        </button>
        {open && (
          <div className="notif-panel">
            <div className="notif-head">
              <b>Notificações</b>
              <span style={{ flex: 1 }} />
              <button className="btn" onClick={() => void clearAll()} disabled={!items.length}>
                Limpar
              </button>
            </div>
            {permission === "default" && (
              <div className="notif-perm">
                <span>Receber também quando esta aba estiver em segundo plano.</span>
                <button className="btn btn-primary" onClick={() => void askPermission()}>
                  Ativar avisos do navegador
                </button>
              </div>
            )}
            {permission === "denied" && <div className="notif-perm">Avisos do navegador bloqueados: libere nas permissões do site (ícone de cadeado) e recarregue.</div>}
            {permission === "unsupported" && <div className="notif-perm">Este navegador não oferece notificações do sistema; os avisos aparecem só aqui no Studio.</div>}
            <div className="notif-list">
              {items.length === 0 && <div className="notif-empty">Nenhuma notificação ainda.</div>}
              {items.map((n) => (
                <div key={n.id} className={`notif-item lv-${n.level}${n.read ? "" : " unread"}`}>
                  <div className="notif-title">{n.title}</div>
                  {n.message && <div className="notif-msg">{n.message}</div>}
                  <div className="notif-meta">
                    {when(n.createdAt)}
                    {n.source ? ` · ${n.source}` : ""}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="notif-toasts" aria-live="polite">
        {!open && toasts.map((n) => (
          <button key={n.id} className={`notif-toast lv-${n.level}`} onClick={() => setToasts((t) => t.filter((x) => x.id !== n.id))}>
            <span className="notif-title">{n.title}</span>
            {n.message && <span className="notif-msg">{n.message}</span>}
          </button>
        ))}
      </div>
    </>
  );
}
