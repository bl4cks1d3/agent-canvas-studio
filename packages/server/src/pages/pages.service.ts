import { ChangesService } from "../events/changes.service";
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { GRID_COLS, type DashboardPage, type PageItem } from "@agent-canvas/shared";
import { BlocksService } from "../blocks/blocks.service";
import { CANVAS_DB } from "../database.module";
import type { CanvasDb } from "../db";

interface Row {
  id: string;
  name: string;
  position: number;
  layout: string;
  package_id: string | null;
  created_at: string;
  updated_at: string;
}

const MAX_ITEMS = 60;
const MAX_PAGES = 60;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const int = (v: unknown, fallback: number) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : fallback);
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

function toPage(r: Row): DashboardPage {
  let layout: PageItem[] = [];
  try {
    layout = JSON.parse(r.layout) as PageItem[];
  } catch {
    // layout ilegivel: pagina vazia
  }
  return { id: r.id, name: r.name, position: r.position, layout, packageId: r.package_id ?? undefined, createdAt: r.created_at, updatedAt: r.updated_at };
}

/**
 * Paginas do dashboard: cada uma guarda a ORGANIZACAO dos componentes (posicao e tamanho numa grade de 12 colunas).
 * O layout persiste no banco; o canvas (orquestracao) e o Claude tambem podem montar paginas.
 */
@Injectable()
export class PagesService {
  constructor(
    @Inject(CANVAS_DB) private readonly db: CanvasDb,
    private readonly blocks: BlocksService,
    private readonly changes: ChangesService
  ) {}

  list(): DashboardPage[] {
    return (this.db.prepare(`SELECT * FROM dashboard_pages ORDER BY position ASC, created_at ASC`).all() as unknown as Row[]).map(toPage);
  }

  get(id: string): DashboardPage {
    const r = this.db.prepare(`SELECT * FROM dashboard_pages WHERE id = ?`).get(id) as Row | undefined;
    if (!r) throw new NotFoundException("página não encontrada");
    return toPage(r);
  }

  create(input: { name?: unknown; layout?: unknown; packageId?: string }): DashboardPage {
    const count = this.db.prepare(`SELECT COUNT(*) AS n, COALESCE(MAX(position), -1) AS p FROM dashboard_pages`).get() as { n: number; p: number };
    if (count.n >= MAX_PAGES) throw new BadRequestException(`no máximo ${MAX_PAGES} páginas`);
    const now = new Date().toISOString();
    const page: DashboardPage = {
      id: randomUUID(),
      name: this.name(input.name),
      position: count.p + 1,
      layout: this.layout(input.layout ?? []),
      packageId: input.packageId,
      createdAt: now,
      updatedAt: now,
    };
    return this.save(page);
  }

  update(id: string, input: { name?: unknown; layout?: unknown; baseUpdatedAt?: unknown }): DashboardPage {
    const current = this.get(id);
    if (typeof input.baseUpdatedAt === "string" && input.baseUpdatedAt !== current.updatedAt) throw new ConflictException("página alterada em outro lugar; recarregue");
    return this.save({
      ...current,
      name: input.name !== undefined ? this.name(input.name) : current.name,
      layout: input.layout !== undefined ? this.layout(input.layout) : current.layout,
      updatedAt: new Date().toISOString(),
    });
  }

  remove(id: string) {
    this.get(id);
    this.db.prepare(`DELETE FROM dashboard_pages WHERE id = ?`).run(id);
    this.changes.emit("pages", id);
    return { ok: true };
  }

  reorder(ids: unknown): DashboardPage[] {
    if (!Array.isArray(ids) || !ids.every((x) => typeof x === "string")) throw new BadRequestException("ids deve ser uma lista de ids de páginas");
    (ids as string[]).forEach((id, position) => this.db.prepare(`UPDATE dashboard_pages SET position = ? WHERE id = ?`).run(position, id));
    this.changes.emit("pages");
    return this.list();
  }

  /** Coloca um componente na pagina, no fim da grade (o Claude usa; o usuario ajusta arrastando). */
  place(id: string, blockId: string, size: { w?: unknown; h?: unknown } = {}): DashboardPage {
    const page = this.get(id);
    this.blocks.get(blockId);
    const bottom = page.layout.reduce((m, it) => Math.max(m, it.y + it.h), 0);
    const w = clamp(int(size.w, 6), 1, GRID_COLS);
    const h = clamp(int(size.h, 9), 1, 60);
    const layout: PageItem[] = [...page.layout, { i: randomUUID().slice(0, 8), kind: "block", blockId, x: 0, y: bottom, w, h }];
    return this.update(id, { layout });
  }

  // ---------------------------------------------------------------- interno

  private save(p: DashboardPage): DashboardPage {
    this.db
      .prepare(
        `INSERT INTO dashboard_pages (id, name, position, layout, package_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, position = excluded.position, layout = excluded.layout, updated_at = excluded.updated_at`
      )
      .run(p.id, p.name, p.position, JSON.stringify(p.layout), p.packageId ?? null, p.createdAt, p.updatedAt);
    this.changes.emit("pages", p.id);
    return this.get(p.id);
  }

  private name(v: unknown): string {
    const name = typeof v === "string" ? v.trim() : "";
    if (!name) throw new BadRequestException("name é obrigatório");
    if (name.length > 60) throw new BadRequestException("name passa do limite de 60 caracteres");
    return name;
  }

  private layout(value: unknown): PageItem[] {
    if (!Array.isArray(value)) throw new BadRequestException("layout deve ser uma lista de itens {kind, blockId|text, x, y, w, h}");
    if (value.length > MAX_ITEMS) throw new BadRequestException(`no máximo ${MAX_ITEMS} itens por página`);
    const seen = new Set<string>();
    return value.map((raw, idx) => {
      if (!isObject(raw)) throw new BadRequestException(`layout[${idx}] deve ser um objeto`);
      const kind = raw.kind === "heading" ? "heading" : "block";
      let i = typeof raw.i === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(raw.i) ? raw.i : randomUUID().slice(0, 8);
      while (seen.has(i)) i = randomUUID().slice(0, 8);
      seen.add(i);
      const w = clamp(int(raw.w, kind === "heading" ? GRID_COLS : 6), 1, GRID_COLS);
      const item: PageItem = { i, kind, x: clamp(int(raw.x, 0), 0, GRID_COLS - w), y: clamp(int(raw.y, 0), 0, 500), w, h: clamp(int(raw.h, kind === "heading" ? 1 : 9), 1, 60) };
      if (kind === "heading") {
        const text = typeof raw.text === "string" ? raw.text.trim().slice(0, 120) : "";
        if (!text) throw new BadRequestException(`layout[${idx}]: título de seção precisa de text`);
        item.text = text;
      } else {
        if (typeof raw.blockId !== "string" || !this.blocks.find(raw.blockId)) throw new BadRequestException(`layout[${idx}]: componente inexistente (blockId)`);
        item.blockId = raw.blockId;
      }
      return item;
    });
  }
}
