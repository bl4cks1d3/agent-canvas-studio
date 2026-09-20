import { ChangesService } from "../events/changes.service";
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Collection, CollectionField, CollectionFieldType, FieldDefault } from "@agent-canvas/shared";
import { localDate, localIso, localTime } from "../clock";
import type { CanvasDb } from "../db";
import { CANVAS_DB } from "../database.module";

const NAME_RE = /^[a-z][a-z0-9_]{1,39}$/;
const FIELD_RE = /^[a-z][a-z0-9_]{0,39}$/;
const RESERVED_FIELDS = new Set(["id", "createdat", "updatedat", "created_at", "updated_at"]);
const TYPES: CollectionFieldType[] = ["text", "longtext", "number", "date", "boolean", "select", "relation"];
const DEFAULTS: FieldDefault[] = ["now", "today", "time"];
const TRASH_DAYS = 30;
const TRASH_MAX_PER_COLLECTION = 500;
const MAX_FIELDS = 40;
const MAX_RECORDS = 10_000;
const MAX_TEXT = 2_000;
const MAX_LONGTEXT = 20_000;

interface CollectionRow {
  id: string;
  name: string;
  label: string;
  description: string | null;
  fields: string;
  created_at: string;
  updated_at: string;
}

interface RecordRow {
  id: string;
  collection_id: string;
  data: string;
  created_at: string;
  updated_at: string;
}

export type FlatRecord = { id: string; createdAt: string; updatedAt: string } & Record<string, unknown>;

function toCollection(row: CollectionRow): Collection {
  return {
    id: row.id,
    name: row.name,
    label: row.label,
    description: row.description ?? undefined,
    fields: JSON.parse(row.fields) as CollectionField[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRecord(row: RecordRow): FlatRecord {
  const data = JSON.parse(row.data) as Record<string, unknown>;
  return { ...data, id: row.id, createdAt: row.created_at, updatedAt: row.updated_at };
}

/**
 * "Banco de dados sob medida": colecoes com esquema definido em tempo de uso
 * (pelo usuario ou pelo Claude) e registros validados contra ele. Fica no mesmo
 * SQLite; os blocos acessam como o recurso "col:<nome>" e os agentes pelas ferramentas db_*.
 */
@Injectable()
export class DataService {
  constructor(
    @Inject(CANVAS_DB) private readonly db: CanvasDb,
    private readonly changes: ChangesService
  ) {}

  // ---------------------------------------------------------------- colecoes

  listCollections(): Array<Collection & { records: number }> {
    const rows = this.db.prepare(`SELECT * FROM collections ORDER BY created_at ASC`).all() as unknown as CollectionRow[];
    return rows.map((r) => {
      const count = this.db.prepare(`SELECT COUNT(*) AS n FROM records WHERE collection_id = ?`).get(r.id) as { n: number };
      return { ...toCollection(r), records: count.n };
    });
  }

  getCollection(name: string): Collection {
    const row = this.db.prepare(`SELECT * FROM collections WHERE name = ?`).get(name) as CollectionRow | undefined;
    if (!row) throw new NotFoundException(`colecao nao encontrada: ${name}`);
    return toCollection(row);
  }

  createCollection(input: Record<string, unknown>): Collection {
    const name = this.slug(input.name, NAME_RE, "name (minusculas, numeros e _; comeca com letra; 2-40 caracteres)");
    const exists = this.db.prepare(`SELECT 1 FROM collections WHERE name = ?`).get(name);
    if (exists) throw new ConflictException(`ja existe uma colecao chamada ${name}`);
    const now = new Date().toISOString();
    const collection: Collection = {
      id: randomUUID(),
      name,
      label: this.text(input.label, "label", 80) || name,
      description: this.text(input.description, "description", 300) || undefined,
      fields: this.fields(input.fields),
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare(`INSERT INTO collections (id, name, label, description, fields, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(collection.id, collection.name, collection.label, collection.description ?? null, JSON.stringify(collection.fields), now, now);
    this.changes.emit("data", name);
    return collection;
  }

  updateCollection(name: string, input: Record<string, unknown>): Collection {
    const current = this.getCollection(name);
    const next: Collection = {
      ...current,
      label: input.label !== undefined ? this.text(input.label, "label", 80) || current.name : current.label,
      description: input.description !== undefined ? this.text(input.description, "description", 300) || undefined : current.description,
      fields: input.fields !== undefined ? this.fields(input.fields) : current.fields,
      updatedAt: new Date().toISOString(),
    };
    this.db
      .prepare(`UPDATE collections SET label = ?, description = ?, fields = ?, updated_at = ? WHERE id = ?`)
      .run(next.label, next.description ?? null, JSON.stringify(next.fields), next.updatedAt, next.id);
    this.changes.emit("data", name);
    return next;
  }

  removeCollection(name: string) {
    const collection = this.getCollection(name);
    this.db.prepare(`DELETE FROM records WHERE collection_id = ?`).run(collection.id);
    this.db.prepare(`DELETE FROM record_trash WHERE collection_name = ?`).run(collection.name);
    this.db.prepare(`DELETE FROM collections WHERE id = ?`).run(collection.id);
    this.changes.emit("data", name);
    return { ok: true };
  }

  // ---------------------------------------------------------------- registros

  listRecords(name: string, query: Record<string, string | undefined>): FlatRecord[] {
    const collection = this.getCollection(name);
    const rows = this.db
      .prepare(`SELECT * FROM records WHERE collection_id = ? ORDER BY created_at ASC`)
      .all(collection.id) as unknown as RecordRow[];
    let records = rows.map(toRecord);

    const fieldNames = new Set(collection.fields.map((f) => f.name));
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || !fieldNames.has(key)) continue;
      records = records.filter((r) => String(r[key] ?? "") === value);
    }
    const q = query.q?.trim().toLowerCase();
    if (q) {
      records = records.filter((r) => collection.fields.some((f) => String(r[f.name] ?? "").toLowerCase().includes(q)));
    }
    const sort = query.sort;
    if (sort && (fieldNames.has(sort) || sort === "createdAt" || sort === "updatedAt")) {
      const dir = query.order === "desc" ? -1 : 1;
      records.sort((a, b) => {
        const x = a[sort];
        const y = b[sort];
        if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
        return String(x ?? "").localeCompare(String(y ?? "")) * dir;
      });
    }
    const offset = Math.max(0, Math.floor(Number(query.offset) || 0));
    const limit = Math.min(1000, Math.max(1, Math.floor(Number(query.limit) || 500)));
    return records.slice(offset, offset + limit);
  }

  createRecord(name: string, input: Record<string, unknown>): FlatRecord {
    const collection = this.getCollection(name);
    const count = this.db.prepare(`SELECT COUNT(*) AS n FROM records WHERE collection_id = ?`).get(collection.id) as { n: number };
    if (count.n >= MAX_RECORDS) throw new BadRequestException(`limite de ${MAX_RECORDS} registros por colecao`);
    const data = this.validate(collection, input, true);
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db.prepare(`INSERT INTO records (id, collection_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(id, collection.id, JSON.stringify(data), now, now);
    this.changes.emit("data", name);
    return { ...data, id, createdAt: now, updatedAt: now };
  }

  updateRecord(name: string, id: string, input: Record<string, unknown>): FlatRecord {
    const collection = this.getCollection(name);
    const row = this.db.prepare(`SELECT * FROM records WHERE id = ? AND collection_id = ?`).get(id, collection.id) as RecordRow | undefined;
    if (!row) throw new NotFoundException("registro nao encontrado");
    const merged = { ...(JSON.parse(row.data) as Record<string, unknown>), ...this.validate(collection, input, false) };
    // um campo enviado como null limpa o valor
    for (const [key, value] of Object.entries(input)) if (value === null) delete merged[key];
    const now = new Date().toISOString();
    this.db.prepare(`UPDATE records SET data = ?, updated_at = ? WHERE id = ?`).run(JSON.stringify(merged), now, id);
    this.changes.emit("data", name);
    return { ...merged, id, createdAt: row.created_at, updatedAt: now };
  }

  /** Apagar manda para a lixeira (restaurar com restoreRecord por 30 dias). */
  removeRecord(name: string, id: string) {
    const collection = this.getCollection(name);
    this.trash(collection, id);
    this.changes.emit("data", name);
    return { ok: true, trashed: true, restore: `POST /collections/${name}/records/${id}/restore` };
  }

  private trash(collection: Collection, id: string): void {
    const row = this.db.prepare(`SELECT * FROM records WHERE id = ? AND collection_id = ?`).get(id, collection.id) as RecordRow | undefined;
    if (!row) throw new NotFoundException("registro nao encontrado");
    const now = new Date();
    this.db
      .prepare(`INSERT OR REPLACE INTO record_trash (id, collection_name, data, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(row.id, collection.name, row.data, row.created_at, row.updated_at, now.toISOString());
    this.db.prepare(`DELETE FROM records WHERE id = ?`).run(id);
    // a lixeira nao cresce sem fim: some o que passou de 30 dias e o excedente de 500 por colecao
    this.db.prepare(`DELETE FROM record_trash WHERE deleted_at < ?`).run(new Date(now.getTime() - TRASH_DAYS * 86_400_000).toISOString());
    this.db
      .prepare(`DELETE FROM record_trash WHERE collection_name = ? AND id NOT IN (SELECT id FROM record_trash WHERE collection_name = ? ORDER BY deleted_at DESC LIMIT ?)`)
      .run(collection.name, collection.name, TRASH_MAX_PER_COLLECTION);
  }

  listTrash(name: string): Array<FlatRecord & { deletedAt: string }> {
    this.getCollection(name);
    const rows = this.db.prepare(`SELECT * FROM record_trash WHERE collection_name = ? ORDER BY deleted_at DESC`).all(name) as unknown as Array<RecordRow & { deleted_at: string }>;
    return rows.map((r) => ({ ...toRecord({ ...r, collection_id: "" }), deletedAt: r.deleted_at }));
  }

  /** Apaga DE VEZ da lixeira (um registro, ou todos se nao passar o id). Irreversivel: so quando o usuario pedir. */
  purgeTrash(name: string, id?: string): { ok: true; purged: number } {
    this.getCollection(name);
    const r = id
      ? this.db.prepare(`DELETE FROM record_trash WHERE collection_name = ? AND id = ?`).run(name, id)
      : this.db.prepare(`DELETE FROM record_trash WHERE collection_name = ?`).run(name);
    return { ok: true, purged: Number(r.changes) };
  }

  restoreRecord(name: string, id: string): FlatRecord {
    const collection = this.getCollection(name);
    const row = this.db.prepare(`SELECT * FROM record_trash WHERE id = ? AND collection_name = ?`).get(id, name) as unknown as (RecordRow & { deleted_at: string }) | undefined;
    if (!row) throw new NotFoundException("registro nao esta na lixeira (ja restaurado ou passou de 30 dias)");
    const count = this.db.prepare(`SELECT COUNT(*) AS n FROM records WHERE collection_id = ?`).get(collection.id) as { n: number };
    if (count.n >= MAX_RECORDS) throw new BadRequestException(`limite de ${MAX_RECORDS} registros por colecao`);
    this.db.prepare(`INSERT INTO records (id, collection_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(row.id, collection.id, row.data, row.created_at, row.updated_at);
    this.db.prepare(`DELETE FROM record_trash WHERE id = ?`).run(id);
    this.changes.emit("data", name);
    return toRecord({ ...row, collection_id: collection.id });
  }

  /**
   * Varias operacoes de uma vez, tudo ou nada: se uma falha (campo invalido, id que nao existe), NADA e gravado.
   * body: { create?: [dados...], update?: [{ id, data }...], delete?: [id...] } (ate 200 no total; delete vai para a lixeira).
   */
  batchRecords(name: string, body: Record<string, unknown>) {
    const collection = this.getCollection(name);
    const list = (v: unknown, what: string): unknown[] => {
      if (v === undefined || v === null) return [];
      if (!Array.isArray(v)) throw new BadRequestException(`${what} deve ser uma lista`);
      return v;
    };
    const creates = list(body.create, "create");
    const updates = list(body.update, "update");
    const deletes = list(body.delete, "delete");
    if (creates.length + updates.length + deletes.length === 0) throw new BadRequestException("nada a fazer: envie create, update e/ou delete");
    if (creates.length + updates.length + deletes.length > 200) throw new BadRequestException("no maximo 200 operacoes por lote");
    const created: FlatRecord[] = [];
    const updated: FlatRecord[] = [];
    const deleted: string[] = [];
    this.db.exec("BEGIN");
    try {
      creates.forEach((d, i) => {
        if (typeof d !== "object" || d === null || Array.isArray(d)) throw new BadRequestException(`create[${i}] deve ser um objeto`);
        created.push(this.createRecord(name, d as Record<string, unknown>));
      });
      updates.forEach((u, i) => {
        const o = (u ?? {}) as { id?: unknown; data?: unknown };
        if (typeof o.id !== "string" || typeof o.data !== "object" || o.data === null) throw new BadRequestException(`update[${i}] deve ser { id, data }`);
        updated.push(this.updateRecord(name, o.id, o.data as Record<string, unknown>));
      });
      deletes.forEach((id, i) => {
        if (typeof id !== "string") throw new BadRequestException(`delete[${i}] deve ser um id`);
        this.trash(collection, id);
        deleted.push(id);
      });
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    this.changes.emit("data", name);
    return { created, updated, deleted };
  }

  // ---------------------------------------------------------------- validacao

  private slug(value: unknown, re: RegExp, what: string): string {
    if (typeof value !== "string" || !re.test(value)) throw new BadRequestException(`${what} invalido`);
    return value;
  }

  private text(value: unknown, field: string, max: number): string {
    if (value === undefined || value === null) return "";
    if (typeof value !== "string") throw new BadRequestException(`${field} deve ser texto`);
    if (value.length > max) throw new BadRequestException(`${field} passa do limite de ${max} caracteres`);
    return value.trim();
  }

  private fields(value: unknown): CollectionField[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new BadRequestException("fields deve ser uma lista");
    if (value.length > MAX_FIELDS) throw new BadRequestException(`no maximo ${MAX_FIELDS} campos`);
    const seen = new Set<string>();
    return value.map((raw) => {
      const f = (raw ?? {}) as Record<string, unknown>;
      const name = this.slug(f.name, FIELD_RE, `nome de campo "${String(f.name)}" (minusculas, numeros e _; comeca com letra)`);
      if (RESERVED_FIELDS.has(name.replace(/_/g, "")) || RESERVED_FIELDS.has(name)) throw new BadRequestException(`nome de campo reservado: ${name}`);
      if (seen.has(name)) throw new BadRequestException(`campo repetido: ${name}`);
      seen.add(name);
      const type = f.type as CollectionFieldType;
      if (!TYPES.includes(type)) throw new BadRequestException(`tipo do campo ${name} deve ser: ${TYPES.join(", ")}`);
      const field: CollectionField = { name, type };
      if (typeof f.label === "string" && f.label.trim()) field.label = f.label.trim().slice(0, 80);
      if (f.required === true) field.required = true;
      if (type === "relation") {
        field.collection = this.slug(f.collection, NAME_RE, `campo ${name} (relation) precisa de "collection": o nome da colecao apontada`);
      }
      if (f.default !== undefined && f.default !== null && f.default !== "") {
        if (!DEFAULTS.includes(f.default as FieldDefault)) throw new BadRequestException(`default do campo ${name} deve ser: ${DEFAULTS.join(", ")}`);
        const okType = f.default === "time" ? type === "text" : type === "date" || type === "text";
        if (!okType) throw new BadRequestException(`default "${String(f.default)}" nao serve para o campo ${name} (${type}): "time" so em text; "now" e "today" em date ou text`);
        field.default = f.default as FieldDefault;
      }
      if (type === "select") {
        const options = Array.isArray(f.options) ? f.options.filter((o): o is string => typeof o === "string" && o.trim() !== "").map((o) => o.trim()) : [];
        if (options.length === 0) throw new BadRequestException(`campo ${name} (select) precisa de options`);
        field.options = [...new Set(options)].slice(0, 50);
      }
      return field;
    });
  }

  private validate(collection: Collection, input: Record<string, unknown>, creating: boolean): Record<string, unknown> {
    const byName = new Map(collection.fields.map((f) => [f.name, f]));
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (key === "id" || key === "createdAt" || key === "updatedAt") continue;
      const field = byName.get(key);
      if (!field) throw new BadRequestException(`campo desconhecido em ${collection.name}: ${key}`);
      if (value === null || value === undefined || value === "") continue;
      out[key] = this.coerce(field, value);
    }
    if (creating) {
      const now = new Date();
      for (const field of collection.fields) {
        // data/hora preenchidas pelo servidor, no fuso local (ninguem precisa perguntar as horas nem misturar UTC com hora local)
        if (out[field.name] === undefined && field.default) out[field.name] = field.default === "now" ? localIso(now) : field.default === "today" ? localDate(now) : localTime(now);
        if (field.required && out[field.name] === undefined) throw new BadRequestException(`campo obrigatorio: ${field.name}`);
      }
    }
    return out;
  }

  private coerce(field: CollectionField, value: unknown): unknown {
    switch (field.type) {
      case "number": {
        const n = typeof value === "number" ? value : Number(value);
        if (!Number.isFinite(n)) throw new BadRequestException(`${field.name} deve ser um numero`);
        return n;
      }
      case "boolean":
        if (typeof value === "boolean") return value;
        if (value === "true" || value === "false") return value === "true";
        throw new BadRequestException(`${field.name} deve ser verdadeiro/falso`);
      case "date": {
        if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new BadRequestException(`${field.name} deve ser uma data ISO (ex: 2026-09-30)`);
        return value;
      }
      case "select":
        if (typeof value !== "string" || !field.options?.includes(value)) throw new BadRequestException(`${field.name} deve ser um de: ${field.options?.join(", ")}`);
        return value;
      case "relation": {
        if (typeof value !== "string") throw new BadRequestException(`${field.name} deve ser o id de um registro de ${field.collection}`);
        const hit = this.db
          .prepare(`SELECT 1 FROM records r JOIN collections c ON c.id = r.collection_id WHERE c.name = ? AND r.id = ?`)
          .get(field.collection ?? "", value);
        if (!hit) throw new BadRequestException(`${field.name}: nao existe registro com id "${value}" em ${field.collection} (use o id de list_records ${field.collection})`);
        return value;
      }
      case "longtext":
      case "text":
        if (typeof value !== "string") throw new BadRequestException(`${field.name} deve ser texto`);
        if (value.length > (field.type === "text" ? MAX_TEXT : MAX_LONGTEXT)) throw new BadRequestException(`${field.name} passa do limite de caracteres`);
        return value;
    }
  }

}
