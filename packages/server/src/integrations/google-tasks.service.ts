import { BadRequestException, Controller, Get, Inject, Injectable, Logger, Post, Put, Body, Req, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { localDate } from "../clock";
import { CANVAS_DB } from "../database.module";
import { DataService } from "../data/data.service";
import type { CanvasDb } from "../db";
import { ChangesService } from "../events/changes.service";
import { ToolRegistry } from "../tools/tool-registry";
import { assertLocal } from "../tools/tools.controller";
import type { GoogleTask } from "./google-parse";
import { planSync, type LocalTask } from "./tasks-sync-plan";

export const LOCAL_TASKS = "rotina_tarefas";
const SETTING_KEY = "google_tasks_sync";
const EXTRA_FIELDS = [
  { name: "google_id", type: "text", label: "Google Tasks (id; o servidor preenche)" },
  { name: "google_sync", type: "text", label: "Último estado sincronizado (o servidor preenche)" },
];

interface Settings {
  /** Sincroniza sozinho (ao mudar uma tarefa local e a cada `everyMinutes`). Desligado ate o usuario pedir. */
  enabled: boolean;
  everyMinutes: number;
  lastRunAt?: string;
  lastResult?: SyncResult;
}

export interface SyncResult {
  ok: boolean;
  error?: string;
  importedFromGoogle: number;
  createdInGoogle: number;
  closedLocal: number;
  reopenedLocal: number;
  closedInGoogle: number;
  reopenedInGoogle: number;
  problems: string[];
}

const empty = (): SyncResult => ({ ok: true, importedFromGoogle: 0, createdInGoogle: 0, closedLocal: 0, reopenedLocal: 0, closedInGoogle: 0, reopenedInGoogle: 0, problems: [] });

/**
 * Uma lista de tarefas so, em dois lugares: mantem a colecao local `rotina_tarefas` e o Google Tasks em sincronia
 * (regras em tasks-sync-plan.ts). Nunca apaga nada. Manual (POST /sync/google-tasks) ou automatica se o usuario ligar.
 */
@Injectable()
export class GoogleTasksService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GoogleTasksService.name);
  private timer?: NodeJS.Timeout;
  private debounce?: NodeJS.Timeout;
  private running = false;
  private quietUntil = 0;
  private off?: () => void;

  constructor(
    @Inject(CANVAS_DB) private readonly db: CanvasDb,
    private readonly tools: ToolRegistry,
    private readonly data: DataService,
    private readonly changes: ChangesService
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.maybeRun("periodico"), 60_000);
    this.timer.unref();
    // uma tarefa local mudou (marcada como feita, criada...): sincroniza logo, sem esperar o intervalo
    const sub = this.changes.stream.subscribe((c) => {
      if (c.type !== "data" || c.key !== LOCAL_TASKS || this.running || Date.now() < this.quietUntil) return;
      clearTimeout(this.debounce);
      this.debounce = setTimeout(() => void this.maybeRun("mudanca"), 4_000);
      this.debounce.unref();
    });
    this.off = () => sub.unsubscribe();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    clearTimeout(this.debounce);
    this.off?.();
  }

  // ---------------------------------------------------------------- configuracao

  settings(): Settings {
    const row = this.db.prepare(`SELECT value FROM studio_settings WHERE key = ?`).get(SETTING_KEY) as { value: string } | undefined;
    try {
      return { enabled: false, everyMinutes: 10, ...(row ? (JSON.parse(row.value) as Partial<Settings>) : {}) };
    } catch {
      return { enabled: false, everyMinutes: 10 };
    }
  }

  private save(s: Settings): Settings {
    this.db
      .prepare(`INSERT INTO studio_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
      .run(SETTING_KEY, JSON.stringify(s), new Date().toISOString());
    return s;
  }

  configure(input: Record<string, unknown>): Settings {
    const s = this.settings();
    if (input.enabled !== undefined) s.enabled = input.enabled === true;
    if (input.everyMinutes !== undefined) {
      const n = Number(input.everyMinutes);
      if (!Number.isFinite(n) || n < 1 || n > 1440) throw new BadRequestException("everyMinutes deve ser de 1 a 1440");
      s.everyMinutes = Math.round(n);
    }
    return this.save(s);
  }

  private async maybeRun(why: "periodico" | "mudanca"): Promise<void> {
    const s = this.settings();
    if (!s.enabled || this.running) return;
    if (why === "periodico" && s.lastRunAt && Date.now() - Date.parse(s.lastRunAt) < s.everyMinutes * 60_000) return;
    await this.sync().catch((err) => this.logger.warn(`sincronizacao: ${err instanceof Error ? err.message : err}`));
  }

  // ---------------------------------------------------------------- sincronizacao

  private ensureLocalFields(): void {
    let collection;
    try {
      collection = this.data.getCollection(LOCAL_TASKS);
    } catch {
      throw new BadRequestException(`a colecao ${LOCAL_TASKS} nao existe: instale a biblioteca "Rotina e Estudo" (ou crie uma colecao com esse nome e os campos titulo, prazo, feito, concluido_em)`);
    }
    const missing = EXTRA_FIELDS.filter((f) => !collection.fields.some((x) => x.name === f.name));
    if (missing.length) this.data.updateCollection(LOCAL_TASKS, { fields: [...collection.fields, ...missing] });
  }

  async sync(): Promise<SyncResult> {
    if (this.running) throw new BadRequestException("ja existe uma sincronizacao em andamento");
    this.running = true;
    const result = empty();
    try {
      this.ensureLocalFields();
      const listed = (await this.tools.call("google_tasks_list", { showCompleted: true })) as { tasks: GoogleTask[] };
      const local = this.data.listRecords(LOCAL_TASKS, { limit: "1000" }) as unknown as LocalTask[];
      const plan = planSync(listed.tasks, local, { today: localDate() });

      const failed = new Set<string>();
      for (const s of plan.googleSets) {
        try {
          await this.tools.call("google_task_set", { id: s.googleId, done: s.done });
          if (s.done) result.closedInGoogle++;
          else result.reopenedInGoogle++;
        } catch (err) {
          failed.add(s.localId);
          result.problems.push(`Google: nao consegui ${s.done ? "concluir" : "reabrir"} a tarefa ${s.googleId}: ${err instanceof Error ? err.message : err}`);
        }
      }

      const created: Array<{ localId: string; title: string; googleId?: string }> = [];
      for (const c of plan.googleCreates) {
        try {
          const r = (await this.tools.call("google_task_create", { title: c.title, due: c.due })) as { id?: string };
          created.push({ localId: c.localId, title: c.title, googleId: r.id });
          result.createdInGoogle++;
        } catch (err) {
          result.problems.push(`Google: nao consegui criar "${c.title}": ${err instanceof Error ? err.message : err}`);
        }
      }
      // a resposta da criacao nem sempre traz o id: acha pelo titulo entre as tarefas do Google que ainda nao tem par local
      if (created.some((c) => !c.googleId)) {
        const again = (await this.tools.call("google_tasks_list", { showCompleted: true })) as { tasks: GoogleTask[] };
        const taken = new Set([...local.map((l) => l.google_id), ...created.map((c) => c.googleId)].filter(Boolean));
        for (const c of created.filter((x) => !x.googleId)) {
          const hit = again.tasks.find((g) => g.status === "open" && g.title === c.title && !taken.has(g.id));
          if (hit) {
            c.googleId = hit.id;
            taken.add(hit.id);
          } else result.problems.push(`"${c.title}" foi criada no Google, mas nao achei o id para vincular (a proxima sincronizacao tenta de novo, sem duplicar se o titulo for unico)`);
        }
      }

      this.quietUntil = Date.now() + 8_000; // as gravacoes abaixo nao devem disparar outra sincronizacao
      for (const u of plan.localUpdates) {
        if (failed.has(u.id)) continue;
        try {
          this.data.updateRecord(LOCAL_TASKS, u.id, u.data);
          if (u.data.feito === true) result.closedLocal++;
          else if (u.data.feito === false) result.reopenedLocal++;
        } catch (err) {
          result.problems.push(`local: ${err instanceof Error ? err.message : err}`);
        }
      }
      for (const c of plan.localCreates) {
        try {
          this.data.createRecord(LOCAL_TASKS, { titulo: c.titulo, prazo: c.prazo, feito: false, google_id: c.google_id, google_sync: "aberta" });
          result.importedFromGoogle++;
        } catch (err) {
          result.problems.push(`local: nao consegui importar "${c.titulo}": ${err instanceof Error ? err.message : err}`);
        }
      }
      for (const c of created.filter((x) => x.googleId)) {
        try {
          this.data.updateRecord(LOCAL_TASKS, c.localId, { google_id: c.googleId, google_sync: "aberta" });
        } catch (err) {
          result.problems.push(`local: ${err instanceof Error ? err.message : err}`);
        }
      }
      result.ok = result.problems.length === 0;
    } catch (err) {
      result.ok = false;
      result.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.quietUntil = Date.now() + 8_000;
      this.running = false;
      this.save({ ...this.settings(), lastRunAt: new Date().toISOString(), lastResult: result });
    }
    return result;
  }
}

interface Request {
  socket: { remoteAddress?: string };
  headers: { origin?: string | string[] };
}

@Controller("sync/google-tasks")
export class GoogleTasksController {
  constructor(private readonly sync: GoogleTasksService) {}

  @Get()
  status() {
    return this.sync.settings();
  }

  /** Sincroniza agora (le e ESCREVE no Google Tasks): so da propria maquina. */
  @Post()
  run(@Req() req: Request) {
    assertLocal(req);
    return this.sync.sync();
  }

  /** { enabled?: boolean, everyMinutes?: number } */
  @Put()
  configure(@Req() req: Request, @Body() body: Record<string, unknown>) {
    assertLocal(req);
    return this.sync.configure(body ?? {});
  }
}
