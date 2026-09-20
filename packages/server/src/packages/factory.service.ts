import { Body, Controller, Get, Inject, Injectable, Logger, Post, Req, type OnApplicationBootstrap } from "@nestjs/common";
import { CANVAS_DB } from "../database.module";
import type { CanvasDb } from "../db";
import { assertLocal } from "../tools/tools.controller";
import { PackagesService } from "./packages.service";

/**
 * Padrao de fabrica: os pacotes da Biblioteca que vem instalados numa instalacao nova (ex.: um Raspberry Pi recem-configurado).
 * A ordem importa: a primeira pagina do primeiro pacote vira a pagina inicial do Dashboard.
 * Sao pacotes do repositorio (codigo revisado por voce), por isso os componentes ja nascem aprovados.
 */
export const FACTORY_PACKAGES = ["rotina-estudo", "kanban-google", "saude-hidratacao", "kanban", "google-workspace"];

const FLAG_KEY = "factory";

export interface FactoryResult {
  installed: string[];
  already: string[];
  failed: Array<{ id: string; error: string }>;
}

/**
 * Na primeira subida com o banco VAZIO (nenhum componente, pagina, canvas nem pacote), instala o padrao de fabrica uma unica vez.
 * Banco com dados nunca e tocado sozinho: para reinstalar o que faltar use POST /factory/restore ("pnpm factory:restore").
 * AGENT_CANVAS_NO_FACTORY=1 desliga a instalacao automatica.
 */
@Injectable()
export class FactoryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(FactoryService.name);

  constructor(
    @Inject(CANVAS_DB) private readonly db: CanvasDb,
    private readonly packages: PackagesService
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.AGENT_CANVAS_NO_FACTORY === "1" || this.done() || !this.isFresh()) return;
    const r = await this.restore();
    this.db.prepare(`INSERT OR REPLACE INTO studio_settings (key, value, updated_at) VALUES (?, ?, ?)`).run(FLAG_KEY, JSON.stringify({ at: new Date().toISOString(), ...r }), new Date().toISOString());
    this.logger.log(`padrão de fábrica instalado: ${r.installed.join(", ") || "nada"}${r.failed.length ? ` | falhou: ${r.failed.map((f) => `${f.id} (${f.error})`).join("; ")}` : ""}`);
  }

  private done(): boolean {
    return !!this.db.prepare(`SELECT 1 FROM studio_settings WHERE key = ?`).get(FLAG_KEY);
  }

  private isFresh(): boolean {
    const count = (table: string) => (this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    return ["blocks", "dashboard_pages", "canvases", "installed_packages"].every((t) => count(t) === 0);
  }

  status(): { fresh: boolean; done: boolean; packages: Array<{ id: string; available: boolean; installed: boolean }> } {
    const all = this.packages.list();
    return {
      fresh: this.isFresh(),
      done: this.done(),
      packages: FACTORY_PACKAGES.map((id) => {
        const p = all.find((x) => x.id === id && x.origin === "biblioteca");
        return { id, available: !!p, installed: !!p?.installed };
      }),
    };
  }

  /** Instala o que ainda nao esta instalado do padrao de fabrica. Nao mexe no que ja existe. */
  async restore(): Promise<FactoryResult> {
    const result: FactoryResult = { installed: [], already: [], failed: [] };
    for (const id of FACTORY_PACKAGES) {
      const p = this.packages.list().find((x) => x.id === id && x.origin === "biblioteca");
      if (!p) {
        result.failed.push({ id, error: "pacote não encontrado na biblioteca" });
        continue;
      }
      if (p.installed) {
        result.already.push(id);
        continue;
      }
      try {
        await this.packages.install(id);
        result.installed.push(id);
      } catch (err) {
        result.failed.push({ id, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return result;
  }
}

@Controller("factory")
export class FactoryController {
  constructor(private readonly factory: FactoryService) {}

  @Get()
  status() {
    return this.factory.status();
  }

  /** Instala os pacotes de fabrica que faltam (nao remove nem altera nada que ja esta instalado). */
  @Post("restore")
  restore(@Req() req: Parameters<typeof assertLocal>[0], @Body() _body: unknown) {
    assertLocal(req);
    return this.factory.restore();
  }
}
