import { ChangesService } from "../events/changes.service";
import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { CANVAS_DB } from "../database.module";
import type { CanvasDb } from "../db";

export interface StudioTheme {
  /** #rrggbb; vazio = o azul padrao do Studio (claro/escuro). */
  accent: string;
  /** Raio dos cantos (px). */
  radius: number;
  /** Tamanho da fonte base dos componentes (px). */
  fontSize: number;
  /** Espacamento entre elementos. */
  density: "compact" | "comfortable";
}

export const DEFAULT_THEME: StudioTheme = { accent: "", radius: 12, fontSize: 13, density: "comfortable" };

/**
 * Design tokens do Studio, guardados no banco: valem para TODOS os componentes (injetados como variaveis CSS)
 * e para o proprio app. Assim o design persiste e fica consistente entre componentes criados por pessoas/agentes diferentes.
 */
@Injectable()
export class ThemeService {
  constructor(
    @Inject(CANVAS_DB) private readonly db: CanvasDb,
    private readonly changes: ChangesService
  ) {}

  get(): StudioTheme {
    const row = this.db.prepare(`SELECT value FROM studio_settings WHERE key = 'theme'`).get() as { value: string } | undefined;
    if (!row) return { ...DEFAULT_THEME };
    try {
      return this.clean(JSON.parse(row.value) as Record<string, unknown>, DEFAULT_THEME);
    } catch {
      return { ...DEFAULT_THEME };
    }
  }

  set(input: Record<string, unknown>): StudioTheme {
    const next = this.clean(input, this.get(), true);
    this.db
      .prepare(`INSERT INTO studio_settings (key, value, updated_at) VALUES ('theme', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
      .run(JSON.stringify(next), new Date().toISOString());
    this.changes.emit("theme");
    return next;
  }

  private clean(input: Record<string, unknown>, base: StudioTheme, strict = false): StudioTheme {
    const out = { ...base };
    if (input.accent !== undefined) {
      const v = String(input.accent ?? "").trim();
      if (v && !/^#[0-9a-fA-F]{6}$/.test(v)) {
        if (strict) throw new BadRequestException("accent deve ser uma cor #rrggbb (ou vazio para o padrão)");
      } else out.accent = v.toLowerCase();
    }
    const num = (key: "radius" | "fontSize", min: number, max: number) => {
      if (input[key] === undefined) return;
      const n = Number(input[key]);
      if (!Number.isFinite(n) || n < min || n > max) {
        if (strict) throw new BadRequestException(`${key} deve ser um número entre ${min} e ${max}`);
        return;
      }
      out[key] = Math.round(n);
    };
    num("radius", 0, 24);
    num("fontSize", 11, 18);
    if (input.density !== undefined) {
      if (input.density === "compact" || input.density === "comfortable") out.density = input.density;
      else if (strict) throw new BadRequestException('density deve ser "compact" ou "comfortable"');
    }
    return out;
  }
}
