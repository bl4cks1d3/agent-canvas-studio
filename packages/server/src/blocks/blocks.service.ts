import { ChangesService } from "../events/changes.service";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Block, BlockPermissions, BlockSource } from "@agent-canvas/shared";
import { CANVAS_DB } from "../database.module";
import type { CanvasDb } from "../db";
import { DataService } from "../data/data.service";
import { lintBlock } from "./block-lint";

const MAX_CODE = 100_000;
const RES_RE = /^col:[a-z][a-z0-9_]{1,39}$/;
const STATE_KEY_RE = /^[a-zA-Z0-9_.:-]{1,60}$/;
const MAX_STATE_VALUE = 64_000;
const MAX_STATE_KEYS = 100;
const MAX_VERSIONS = 30;

export interface BlockVersionInfo {
  id: string;
  createdAt: string;
  author: string;
  note?: string;
  bytes: number;
}

interface Row {
  id: string;
  name: string;
  description: string | null;
  html: string;
  css: string;
  js: string;
  permissions: string;
  refresh_seconds: number;
  source: string;
  approved: number;
  package_id: string | null;
  config: string;
  created_at: string;
  updated_at: string;
}

function parse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const toBlock = (r: Row): Block => ({
  id: r.id,
  name: r.name,
  description: r.description ?? undefined,
  html: r.html,
  css: r.css,
  js: r.js,
  permissions: { read: [], write: [], tools: [], agents: [], ...parse<Partial<BlockPermissions>>(r.permissions, {}) },
  refreshSeconds: r.refresh_seconds,
  source: r.source as BlockSource,
  approved: r.approved === 1,
  packageId: r.package_id ?? undefined,
  config: parse<Record<string, unknown>>(r.config, {}),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Componentes visuais (blocos): HTML + CSS + JS guardados no banco, criados pelo usuario, por pacotes
 * ou pelo agente. O codigo roda num iframe isolado no navegador; so o que as permissoes liberam.
 */
@Injectable()
export class BlocksService {
  constructor(
    @Inject(CANVAS_DB) private readonly db: CanvasDb,
    private readonly data: DataService,
    private readonly changes: ChangesService
  ) {}

  list(): Block[] {
    return (this.db.prepare(`SELECT * FROM blocks ORDER BY created_at ASC`).all() as unknown as Row[]).map(toBlock);
  }

  get(id: string): Block {
    const row = this.db.prepare(`SELECT * FROM blocks WHERE id = ?`).get(id) as Row | undefined;
    if (!row) throw new NotFoundException("bloco nao encontrado");
    return toBlock(row);
  }

  find(id: string): Block | undefined {
    const row = this.db.prepare(`SELECT * FROM blocks WHERE id = ?`).get(id) as Row | undefined;
    return row ? toBlock(row) : undefined;
  }

  create(input: Record<string, unknown>): Block {
    const source: BlockSource = input.source === "agent" ? "agent" : input.source === "package" ? "package" : "user";
    const now = new Date().toISOString();
    const fields = this.fields(input, undefined);
    this.assertCollections(fields.permissions);
    const block: Block = {
      id: randomUUID(),
      ...fields,
      source,
      // codigo que veio de agente/API nasce sem aprovacao; pacotes da biblioteca e o proprio usuario podem aprovar
      approved: source === "agent" ? false : input.approved === true,
      packageId: typeof input.packageId === "string" ? input.packageId : undefined,
      config: isObject(input.config) ? input.config : {},
      createdAt: now,
      updatedAt: now,
    };
    return this.save(block);
  }

  update(id: string, input: Record<string, unknown>): Block {
    const current = this.get(id);
    const fields = this.fields(input, current);
    this.assertCollections(fields.permissions);
    const changedCode = fields.html !== current.html || fields.css !== current.css || fields.js !== current.js || JSON.stringify(fields.permissions) !== JSON.stringify(current.permissions);
    const fromAgent = input.source === "agent";
    if (changedCode) this.snapshot(current, current.source === "agent" ? "agent" : "user", typeof input.versionNote === "string" ? input.versionNote.slice(0, 120) : undefined);
    const next: Block = {
      ...current,
      ...fields,
      source: fromAgent ? "agent" : current.source,
      // mudar codigo/permissoes revoga a aprovacao (salvo o usuario aprovar na mesma gravacao)
      approved: input.approved === true && !fromAgent ? true : changedCode ? false : current.approved,
      config: isObject(input.config) ? input.config : current.config,
      updatedAt: new Date().toISOString(),
    };
    return this.save(next);
  }

  approve(id: string, approved: boolean): Block {
    const current = this.get(id);
    return this.save({ ...current, approved, updatedAt: new Date().toISOString() });
  }

  /** Uso interno (pacotes): troca a configuracao/permissoes sem revogar a aprovacao. */
  patchInternal(id: string, patch: Partial<Pick<Block, "config" | "permissions">>): Block {
    const current = this.get(id);
    return this.save({ ...current, ...patch, updatedAt: new Date().toISOString() });
  }

  remove(id: string) {
    this.get(id);
    this.db.prepare(`DELETE FROM block_inbox WHERE block_id = ?`).run(id);
    this.db.prepare(`DELETE FROM block_state WHERE block_id = ?`).run(id);
    this.db.prepare(`DELETE FROM block_versions WHERE block_id = ?`).run(id);
    this.db.prepare(`DELETE FROM blocks WHERE id = ?`).run(id);
    this.changes.emit("blocks", id);
    return { ok: true };
  }

  inbox(blockId: string): { items: unknown[]; updatedAt?: string } {
    const row = this.db.prepare(`SELECT items, updated_at FROM block_inbox WHERE block_id = ?`).get(blockId) as { items: string; updated_at: string } | undefined;
    return row ? { items: parse<unknown[]>(row.items, []), updatedAt: row.updated_at } : { items: [] };
  }

  setInbox(blockId: string, items: unknown[]): void {
    this.db
      .prepare(`INSERT INTO block_inbox (block_id, items, updated_at) VALUES (?, ?, ?) ON CONFLICT(block_id) DO UPDATE SET items = excluded.items, updated_at = excluded.updated_at`)
      .run(blockId, JSON.stringify(items.slice(0, 200)), new Date().toISOString());
    this.changes.emit("blocks", blockId);
  }

  // ---------------------------------------------------------------- consistencia

  /** Avisos de design/dados/isolamento (nao bloqueiam): o Claude e a tela mostram para corrigir. */
  lint(b: Block): string[] {
    return lintBlock(b);
  }

  /** Permissoes so podem apontar para colecoes que existem (dado e componente ficam consistentes). */
  private assertCollections(p: BlockPermissions): void {
    const existing = new Set(this.data.listCollections().map((c) => c.name));
    const missing = Array.from(new Set([...p.read, ...p.write].map((r) => r.replace(/^col:/, "")))).filter((n) => !existing.has(n));
    if (missing.length) throw new BadRequestException(`Coleção inexistente em permissions: ${missing.join(", ")}. Crie primeiro (save_collection) e depois salve o componente.`);
  }

  // ---------------------------------------------------------------- estado proprio (ctx.store)

  getState(blockId: string): Record<string, unknown> {
    const rows = this.db.prepare(`SELECT key, value FROM block_state WHERE block_id = ?`).all(blockId) as unknown as Array<{ key: string; value: string }>;
    return Object.fromEntries(rows.map((r) => [r.key, parse<unknown>(r.value, null)]));
  }

  setState(blockId: string, key: string, value: unknown): { ok: true } {
    if (!STATE_KEY_RE.test(key)) throw new BadRequestException("chave inválida (letras, números e _ . : -, até 60)");
    const raw = JSON.stringify(value ?? null);
    if (raw.length > MAX_STATE_VALUE) throw new BadRequestException(`valor grande demais (máx. ${MAX_STATE_VALUE} caracteres); para dados de verdade use uma coleção`);
    const exists = this.db.prepare(`SELECT 1 FROM block_state WHERE block_id = ? AND key = ?`).get(blockId, key);
    if (!exists) {
      const n = this.db.prepare(`SELECT COUNT(*) AS n FROM block_state WHERE block_id = ?`).get(blockId) as { n: number };
      if (n.n >= MAX_STATE_KEYS) throw new BadRequestException(`máximo de ${MAX_STATE_KEYS} chaves de estado por componente`);
    }
    this.db
      .prepare(`INSERT INTO block_state (block_id, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(block_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
      .run(blockId, key, raw, new Date().toISOString());
    return { ok: true };
  }

  removeState(blockId: string, key: string): { ok: true } {
    this.db.prepare(`DELETE FROM block_state WHERE block_id = ? AND key = ?`).run(blockId, key);
    return { ok: true };
  }

  // ---------------------------------------------------------------- versoes do design/codigo

  private snapshot(b: Block, author: string, note?: string): void {
    this.db
      .prepare(`INSERT INTO block_versions (id, block_id, html, css, js, permissions, note, author, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), b.id, b.html, b.css, b.js, JSON.stringify(b.permissions), note ?? null, author, new Date().toISOString());
    this.db
      .prepare(`DELETE FROM block_versions WHERE block_id = ? AND id NOT IN (SELECT id FROM block_versions WHERE block_id = ? ORDER BY created_at DESC LIMIT ${MAX_VERSIONS})`)
      .run(b.id, b.id);
  }

  versions(blockId: string): BlockVersionInfo[] {
    this.get(blockId);
    const rows = this.db.prepare(`SELECT id, created_at, author, note, length(html) + length(css) + length(js) AS bytes FROM block_versions WHERE block_id = ? ORDER BY created_at DESC`).all(blockId) as unknown as Array<{ id: string; created_at: string; author: string; note: string | null; bytes: number }>;
    return rows.map((r) => ({ id: r.id, createdAt: r.created_at, author: r.author, note: r.note ?? undefined, bytes: r.bytes }));
  }

  version(blockId: string, versionId: string): { id: string; html: string; css: string; js: string; permissions: BlockPermissions; createdAt: string; author: string; note?: string } {
    const r = this.db.prepare(`SELECT * FROM block_versions WHERE id = ? AND block_id = ?`).get(versionId, blockId) as { id: string; html: string; css: string; js: string; permissions: string; note: string | null; author: string; created_at: string } | undefined;
    if (!r) throw new NotFoundException("versão não encontrada");
    return { id: r.id, html: r.html, css: r.css, js: r.js, permissions: parse<BlockPermissions>(r.permissions, { read: [], write: [], tools: [], agents: [] }), createdAt: r.created_at, author: r.author, note: r.note ?? undefined };
  }

  /** Volta ao design/codigo de uma versao (a atual vira uma versao no historico; a aprovacao e revogada). */
  restore(blockId: string, versionId: string): Block {
    const v = this.version(blockId, versionId);
    return this.update(blockId, { html: v.html, css: v.css, js: v.js, permissions: v.permissions, versionNote: `restaurou a versão de ${v.createdAt.slice(0, 16).replace("T", " ")}`, source: "user" });
  }

  // ---------------------------------------------------------------- interno

  private save(b: Block): Block {
    this.db
      .prepare(
        `INSERT INTO blocks (id, name, description, html, css, js, permissions, refresh_seconds, source, approved, package_id, config, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, html = excluded.html, css = excluded.css, js = excluded.js,
           permissions = excluded.permissions, refresh_seconds = excluded.refresh_seconds, source = excluded.source, approved = excluded.approved,
           package_id = excluded.package_id, config = excluded.config, updated_at = excluded.updated_at`
      )
      .run(b.id, b.name, b.description ?? null, b.html, b.css, b.js, JSON.stringify(b.permissions), b.refreshSeconds, b.source, b.approved ? 1 : 0, b.packageId ?? null, JSON.stringify(b.config), b.createdAt, b.updatedAt);
    this.changes.emit("blocks", b.id);
    return this.get(b.id);
  }

  private fields(input: Record<string, unknown>, current: Block | undefined) {
    const name = input.name !== undefined ? String(input.name ?? "").trim() : (current?.name ?? "");
    if (!name) throw new BadRequestException("name e obrigatorio");
    if (name.length > 80) throw new BadRequestException("name passa do limite de 80 caracteres");
    const code = (key: "html" | "css" | "js"): string => {
      const v = input[key] !== undefined ? input[key] : current?.[key] ?? "";
      if (typeof v !== "string") throw new BadRequestException(`${key} deve ser texto`);
      if (v.length > MAX_CODE) throw new BadRequestException(`${key} passa do limite de ${MAX_CODE} caracteres`);
      return v;
    };
    const perms = input.permissions !== undefined ? this.permissions(input.permissions) : (current?.permissions ?? { read: [], write: [], tools: [], agents: [] });
    const refresh = input.refreshSeconds !== undefined ? Number(input.refreshSeconds) : (current?.refreshSeconds ?? 0);
    if (!Number.isFinite(refresh) || refresh < 0 || refresh > 3600 || (refresh > 0 && refresh < 5)) throw new BadRequestException("refreshSeconds deve ser 0 ou de 5 a 3600");
    const description = input.description !== undefined ? String(input.description ?? "").slice(0, 300) || undefined : current?.description;
    return { name, description, html: code("html"), css: code("css"), js: code("js"), permissions: perms, refreshSeconds: refresh };
  }

  private permissions(value: unknown): BlockPermissions {
    if (!isObject(value)) throw new BadRequestException("permissions deve ser um objeto {read, write, tools, agents}");
    const list = (key: string, check?: (s: string) => boolean): string[] => {
      const v = value[key];
      if (v === undefined) return [];
      if (!Array.isArray(v) || !v.every((s) => typeof s === "string")) throw new BadRequestException(`permissions.${key} deve ser uma lista de textos`);
      const out = Array.from(new Set(v.map((s) => (s as string).trim()).filter(Boolean)));
      if (check) for (const s of out) if (!check(s)) throw new BadRequestException(`permissions.${key}: valor invalido "${s}"`);
      return out.slice(0, 60);
    };
    const res = (s: string) => RES_RE.test(s);
    return { read: list("read", res), write: list("write", res), tools: list("tools", (s) => s.length <= 120), agents: list("agents", (s) => s === "*" || s.length <= 60) };
  }
}
