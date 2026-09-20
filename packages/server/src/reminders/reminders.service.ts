import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { CanvasesService } from "../canvases/canvases.service";
import { DataService } from "../data/data.service";
import { NotificationsService } from "../notifications/notifications.service";

export const REMINDERS_COLLECTION = "sistema_lembretes";
const TICK_MS = 15_000;

const FIELDS = [
  { name: "chave", type: "text", label: "Chave (quem criou)" },
  { name: "titulo", type: "text", label: "Título", required: true },
  { name: "mensagem", type: "text", label: "Mensagem" },
  { name: "ativo", type: "boolean", label: "Ativo" },
  { name: "a_cada_min", type: "number", label: "A cada (min)" },
  { name: "inicio", type: "text", label: "Início (HH:MM)" },
  { name: "fim", type: "text", label: "Fim (HH:MM)" },
  { name: "canvas_id", type: "text", label: "Orquestração a executar (id do canvas)" },
  { name: "ultimo_disparo", type: "text", label: "Último disparo (controlado pelo servidor)" },
];

/** "HH:MM" -> minutos desde a meia-noite (invalido -> fallback). */
function minutesOf(value: unknown, fallback: number): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? "").trim());
  if (!m) return fallback;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h > 23 || min > 59 ? fallback : h * 60 + min;
}

/** Dentro da janela diaria [inicio, fim]; aceita janela que atravessa a meia-noite (22:00 -> 06:00). */
export function inWindow(now: Date, inicio: unknown, fim: unknown): boolean {
  const cur = now.getHours() * 60 + now.getMinutes();
  const a = minutesOf(inicio, 0);
  const b = minutesOf(fim, 23 * 60 + 59);
  return a <= b ? cur >= a && cur <= b : cur >= a || cur <= b;
}

/**
 * Agendador de lembretes: a cada 15 s olha a colecao `sistema_lembretes` e, para cada lembrete ativo dentro da janela do dia
 * cujo intervalo venceu, cria uma notificacao (e, se houver `canvas_id`, executa essa orquestracao). Funciona com o Studio fechado:
 * as notificacoes ficam guardadas e aparecem quando ele abrir. Um servidor parado dispara UMA vez ao voltar (nao acumula).
 */
@Injectable()
export class RemindersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RemindersService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly data: DataService,
    private readonly notifications: NotificationsService,
    private readonly canvases: CanvasesService
  ) {}

  onModuleInit(): void {
    if (!this.data.listCollections().some((c) => c.name === REMINDERS_COLLECTION)) {
      this.data.createCollection({ name: REMINDERS_COLLECTION, label: "Lembretes", description: "Lembretes recorrentes por notificação (o servidor dispara na hora certa).", fields: FIELDS });
    }
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  tick(now = new Date()): number {
    let fired = 0;
    let reminders;
    try {
      reminders = this.data.listRecords(REMINDERS_COLLECTION, { limit: "1000" });
    } catch (err) {
      this.logger.warn(`lembretes: ${err instanceof Error ? err.message : err}`);
      return 0;
    }
    for (const r of reminders) {
      try {
        const every = Number(r.a_cada_min);
        if (r.ativo !== true || !(every >= 1) || !inWindow(now, r.inicio, r.fim)) continue;
        const last = Date.parse(String(r.ultimo_disparo ?? ""));
        if (Number.isNaN(last)) {
          // primeira vez: arma o relogio a partir de agora (nao dispara na hora em que foi criado)
          this.data.updateRecord(REMINDERS_COLLECTION, r.id, { ultimo_disparo: now.toISOString() });
          continue;
        }
        if (now.getTime() - last < every * 60_000) continue;
        this.data.updateRecord(REMINDERS_COLLECTION, r.id, { ultimo_disparo: now.toISOString() });
        this.fire(r);
        fired++;
      } catch (err) {
        this.logger.warn(`lembrete ${String(r.titulo ?? r.id)}: ${err instanceof Error ? err.message : err}`);
      }
    }
    return fired;
  }

  private fire(r: Record<string, unknown>): void {
    const title = String(r.titulo ?? "Lembrete");
    const message = String(r.mensagem ?? "");
    this.notifications.create({ title, message, level: "info", source: "lembrete" });
    const canvasId = String(r.canvas_id ?? "").trim();
    if (!canvasId) return;
    try {
      this.canvases.run(canvasId, { mode: "live", confirmed: true, input: message || title });
    } catch (err) {
      this.notifications.create({ title: `Lembrete "${title}": a orquestração não rodou`, message: err instanceof Error ? err.message : String(err), level: "warn", source: "lembrete" });
    }
  }
}
