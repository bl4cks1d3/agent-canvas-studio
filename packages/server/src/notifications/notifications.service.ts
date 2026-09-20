import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Subject } from "rxjs";
import { CANVAS_DB } from "../database.module";
import type { CanvasDb } from "../db";

export type NotificationLevel = "info" | "ok" | "warn" | "error";
export const LEVELS: NotificationLevel[] = ["info", "ok", "warn", "error"];
const KEEP = 200;

export interface NotifySettings {
  desktop: boolean;
  sound: boolean;
}

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  level: NotificationLevel;
  source: string;
  read: boolean;
  createdAt: string;
}

interface Row {
  id: string;
  title: string;
  message: string;
  level: string;
  source: string;
  read: number;
  created_at: string;
}

const toNotification = (r: Row): AppNotification => ({ id: r.id, title: r.title, message: r.message, level: r.level as NotificationLevel, source: r.source, read: r.read === 1, createdAt: r.created_at });

/**
 * Ponto unico de avisos ao usuario. Quem quiser avisar (ferramenta `notify`, no "Notificar" de um canvas, lembretes)
 * chama create(): o aviso e guardado e empurrado por SSE para o Studio aberto, que mostra o balao e a notificacao do navegador.
 */
@Injectable()
export class NotificationsService {
  readonly created = new Subject<AppNotification>();

  constructor(@Inject(CANVAS_DB) private readonly db: CanvasDb) {}

  /** Preferencias de entrega: desktop = notificacao nativa do sistema (com o navegador fechado); sound = som (nativo ou do Studio). */
  getSettings(): NotifySettings {
    const row = this.db.prepare(`SELECT value FROM studio_settings WHERE key = 'notifications'`).get() as { value: string } | undefined;
    let v: { desktop?: unknown; sound?: unknown } = {};
    try {
      v = row ? JSON.parse(row.value) : {};
    } catch {
      // config corrompida: volta ao padrao
    }
    return { desktop: v.desktop === true, sound: v.sound !== false };
  }

  setSettings(patch: { desktop?: unknown; sound?: unknown }): NotifySettings {
    for (const k of ["desktop", "sound"] as const) if (patch[k] !== undefined && typeof patch[k] !== "boolean") throw new BadRequestException(`${k} deve ser true ou false`);
    const next = { ...this.getSettings(), ...(patch.desktop !== undefined ? { desktop: patch.desktop as boolean } : {}), ...(patch.sound !== undefined ? { sound: patch.sound as boolean } : {}) };
    this.db
      .prepare(`INSERT INTO studio_settings (key, value, updated_at) VALUES ('notifications', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
      .run(JSON.stringify(next), new Date().toISOString());
    return next;
  }

  create(input: { title?: unknown; message?: unknown; level?: unknown; source?: unknown }): AppNotification {
    const title = String(input.title ?? "").trim();
    if (!title) throw new BadRequestException("title e obrigatorio");
    if (title.length > 120) throw new BadRequestException("title passa do limite de 120 caracteres");
    const message = String(input.message ?? "").trim();
    if (message.length > 500) throw new BadRequestException("message passa do limite de 500 caracteres");
    const level = input.level === undefined || input.level === "" || input.level === null ? "info" : String(input.level);
    if (!LEVELS.includes(level as NotificationLevel)) throw new BadRequestException(`level deve ser um de: ${LEVELS.join(", ")}`);
    const source = String(input.source ?? "").trim().slice(0, 60);
    const n: AppNotification = { id: randomUUID(), title, message, level: level as NotificationLevel, source, read: false, createdAt: new Date().toISOString() };
    this.db.prepare(`INSERT INTO notifications (id, title, message, level, source, read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)`).run(n.id, n.title, n.message, n.level, n.source, n.createdAt);
    this.db.prepare(`DELETE FROM notifications WHERE id NOT IN (SELECT id FROM notifications ORDER BY created_at DESC LIMIT ${KEEP})`).run();
    this.created.next(n);
    return n;
  }

  list(limit = 50): AppNotification[] {
    const rows = this.db.prepare(`SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?`).all(Math.min(KEEP, Math.max(1, Math.floor(limit) || 50))) as unknown as Row[];
    return rows.map(toNotification);
  }

  /** Sem ids marca todas como lidas. */
  markRead(ids?: string[]): { ok: true } {
    if (ids?.length) for (const id of ids.slice(0, KEEP)) this.db.prepare(`UPDATE notifications SET read = 1 WHERE id = ?`).run(String(id));
    else this.db.prepare(`UPDATE notifications SET read = 1`).run();
    return { ok: true };
  }

  remove(id: string): { ok: true } {
    this.db.prepare(`DELETE FROM notifications WHERE id = ?`).run(id);
    return { ok: true };
  }

  clear(): { ok: true } {
    this.db.prepare(`DELETE FROM notifications`).run();
    return { ok: true };
  }
}
