import { api } from "./api";

export type NotificationLevel = "info" | "ok" | "warn" | "error";

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  level: NotificationLevel;
  source: string;
  read: boolean;
  createdAt: string;
}

export const listNotifications = (limit = 50) => api<AppNotification[]>(`/notifications?limit=${limit}`);
export const markNotificationsRead = (ids?: string[]) => api<{ ok: true }>("/notifications/read", { method: "POST", body: JSON.stringify({ ids }) });
export const clearNotifications = () => api<{ ok: true }>("/notifications", { method: "DELETE" });

export interface NotifySettings {
  /** Notificacao nativa do sistema (funciona com o navegador fechado). */
  desktop: boolean;
  sound: boolean;
  platform: string;
  desktopSupported: boolean;
}

/** Avisa o sino (NotificationCenter) que as preferencias mudaram. */
export const NOTIFY_SETTINGS_EVENT = "ac-notify-settings";

export const getNotifySettings = () => api<NotifySettings>("/notifications/settings");
export const saveNotifySettings = (patch: { desktop?: boolean; sound?: boolean }) =>
  api<NotifySettings>("/notifications/settings", { method: "PUT", body: JSON.stringify(patch) }).then((s) => {
    window.dispatchEvent(new Event(NOTIFY_SETTINGS_EVENT));
    return s;
  });
export const desktopTest = () => api<{ ok: boolean; error?: string }>("/notifications/desktop-test", { method: "POST" });
export const sendTestNotification = () => api<AppNotification>("/notifications", { method: "POST", body: JSON.stringify({ title: "Notificação de teste", message: "Se você ouviu o som ou viu o aviso, está funcionando.", level: "info", source: "teste" }) });
