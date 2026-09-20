import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Block, BlockPermissions, PackageConnection, PackageInfo, PackageManifest, Requirement } from "@agent-canvas/shared";
import { BlocksService } from "../blocks/blocks.service";
import { CanvasesService } from "../canvases/canvases.service";
import { CANVAS_DB } from "../database.module";
import type { CanvasDb } from "../db";
import { DataService } from "../data/data.service";
import { PagesService } from "../pages/pages.service";
import { providerAvailable, PROVIDER_ORDER } from "../llm/providers";
import { ToolRegistry } from "../tools/tool-registry";
import { loadLibrary } from "./library";

interface InstalledRow {
  id: string;
  version: string;
  connections: string;
  block_ids: string;
  canvas_ids: string;
  page_ids: string;
  installed_at: string;
}

interface CustomRow {
  id: string;
  manifest: string;
  source: string;
}

const ID_RE = /^[a-z][a-z0-9-]{1,39}$/;
const KEY_RE = /^[a-z][a-z0-9_]{0,31}$/;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const parse = <T>(raw: string, fallback: T): T => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

/**
 * Biblioteca de pacotes de dashboard. Instalar cria as colecoes, os componentes e os canvases do pacote;
 * depois o Studio PEDE as conexoes que ele precisa (ferramentas de um MCP como o Google Workspace, chave de IA…).
 */
@Injectable()
export class PackagesService {
  private library: PackageManifest[] | null = null;

  constructor(
    @Inject(CANVAS_DB) private readonly db: CanvasDb,
    private readonly data: DataService,
    private readonly blocks: BlocksService,
    private readonly canvases: CanvasesService,
    private readonly tools: ToolRegistry,
    private readonly pages: PagesService
  ) {}

  // ---------------------------------------------------------------- consulta

  private libraryAt = 0;

  /** Relê a pasta da biblioteca a cada 2 s (barato; permite editar um pacote sem reiniciar o servidor). */
  private lib(): PackageManifest[] {
    if (!this.library || Date.now() - this.libraryAt > 2000) {
      this.library = loadLibrary();
      this.libraryAt = Date.now();
    }
    return this.library;
  }

  private custom(): Array<{ manifest: PackageManifest; source: string }> {
    return (this.db.prepare(`SELECT id, manifest, source FROM custom_packages ORDER BY created_at ASC`).all() as unknown as CustomRow[]).map((r) => ({ manifest: parse<PackageManifest>(r.manifest, {} as PackageManifest), source: r.source }));
  }

  private find(id: string): { manifest: PackageManifest; origin: "biblioteca" | "criado"; source: string } {
    const lib = this.lib().find((m) => m.id === id);
    if (lib) return { manifest: lib, origin: "biblioteca", source: "package" };
    const c = this.custom().find((x) => x.manifest.id === id);
    if (c) return { manifest: c.manifest, origin: "criado", source: c.source };
    throw new NotFoundException("pacote nao encontrado");
  }

  private installedRow(id: string): InstalledRow | undefined {
    return this.db.prepare(`SELECT * FROM installed_packages WHERE id = ?`).get(id) as InstalledRow | undefined;
  }

  list(): PackageInfo[] {
    return [...this.lib().map((m) => this.info(m, "biblioteca")), ...this.custom().map((c) => this.info(c.manifest, "criado"))];
  }

  get(id: string): PackageInfo & { manifest: PackageManifest } {
    const f = this.find(id);
    return { ...this.info(f.manifest, f.origin), manifest: f.manifest };
  }

  private info(m: PackageManifest, origin: "biblioteca" | "criado"): PackageInfo {
    const row = this.installedRow(m.id);
    const conn = parse<Record<string, string>>(row?.connections ?? "{}", {});
    const collections = new Set(this.data.listCollections().map((c) => c.name));
    const toolList = this.tools.list();
    const connections: PackageConnection[] = m.requires.map((r): PackageConnection => {
      if (r.kind === "collection") return { id: r.id, kind: r.kind, label: r.label, status: collections.has(r.collection) ? "ok" : "pending" };
      if (r.kind === "ai") {
        const ok = PROVIDER_ORDER.some(providerAvailable);
        return { id: r.id, kind: r.kind, label: r.label, hint: "Preencha uma chave de IA no .env (Groq, Gemini ou Anthropic).", status: ok ? "ok" : r.optional ? "optional" : "pending" };
      }
      const value = conn[r.id];
      const connected = !!value && toolList.some((t) => t.name === value);
      const patterns = r.match.map((p) => p.toLowerCase());
      const suggestions = toolList.filter((t) => t.source.startsWith("mcp:") && patterns.some((p) => t.name.toLowerCase().includes(p))).map((t) => t.name).slice(0, 8);
      return { id: r.id, kind: r.kind, label: r.label, hint: r.hint, status: connected ? "ok" : r.optional ? "optional" : "pending", value: connected ? value : undefined, suggestions };
    });
    return {
      id: m.id,
      name: m.name,
      description: m.description,
      category: m.category,
      version: m.version,
      icon: m.icon,
      experimental: m.experimental,
      origin,
      counts: { blocks: m.blocks.length, canvases: m.canvases.length, collections: m.collections.length, pages: (m.pages ?? []).length },
      installed: !!row,
      installedAt: row?.installed_at,
      connections,
      ready: !!row && connections.every((c) => c.status !== "pending"),
      canvasIds: parse<string[]>(row?.canvas_ids ?? "[]", []),
      pageIds: parse<string[]>(row?.page_ids ?? "[]", []),
    };
  }

  // ---------------------------------------------------------------- instalar / desinstalar

  async install(id: string): Promise<PackageInfo> {
    const { manifest, origin, source } = this.find(id);
    if (this.installedRow(id)) throw new BadRequestException("pacote ja instalado");
    const fromAgent = origin === "criado" && source === "agent";

    const blockIds: Record<string, string> = {};
    const created: Block[] = [];
    const canvasIds: Record<string, string> = {};
    const newCollections: string[] = [];
    const pageIds: string[] = [];
    try {
    for (const c of manifest.collections) {
      if (!this.data.listCollections().some((x) => x.name === c.name)) {
        this.data.createCollection(c as unknown as Record<string, unknown>);
        newCollections.push(c.name);
      }
    }

    // componentes primeiro (os canvases apontam para eles); as permissoes de agentes entram depois
    for (const b of manifest.blocks) {
      const block = this.blocks.create({
        name: b.name,
        description: b.description,
        html: b.html,
        css: b.css ?? "",
        js: b.js,
        permissions: { ...b.permissions, tools: b.permissions.tools.filter((t) => !t.startsWith("@")), agents: [] },
        refreshSeconds: b.refreshSeconds ?? 0,
        source: fromAgent ? "agent" : "package",
        approved: !fromAgent,
        packageId: manifest.id,
      });
      blockIds[b.key] = block.id;
      created.push(block);
    }

    for (const cv of manifest.canvases) {
      const nodes = cv.nodes.map((n) => {
        const node = isObject(n) ? { ...n, config: isObject(n.config) ? { ...n.config } : {} } : n;
        if (isObject(node) && isObject(node.config) && Array.isArray(node.config.tools)) node.config.tools = this.resolveTools(node.config.tools as string[], {});
        if (isObject(node) && node.type === "ui.block" && isObject(node.config) && typeof node.config.blockKey === "string") {
          node.config.blockId = blockIds[node.config.blockKey];
          delete node.config.blockKey;
        }
        return node;
      });
      const saved = this.canvases.create({ name: cv.name, description: cv.description, nodes, edges: cv.edges, source: fromAgent ? "agent" : "user" });
      canvasIds[cv.key] = saved.id;
    }

    for (const pg of manifest.pages ?? []) {
      const layout = pg.layout
        .filter((it) => it.kind === "heading" || blockIds[String(it.blockKey)])
        .map((it) => (it.kind === "heading" ? { kind: "heading", text: it.text, x: it.x, y: it.y, w: it.w, h: it.h } : { kind: "block", blockId: blockIds[String(it.blockKey)], x: it.x, y: it.y, w: it.w, h: it.h }));
      pageIds.push(this.pages.create({ name: pg.name, layout, packageId: manifest.id }).id);
    }

    if (manifest.seed) {
      for (const [collection, rows] of Object.entries(manifest.seed)) {
        if (this.data.listRecords(collection, { limit: "1" }).length === 0) for (const row of rows.slice(0, 200)) this.data.createRecord(collection, row);
      }
    }
    } catch (err) {
      for (const b of created) this.blocks.remove(b.id);
      for (const cid of Object.values(canvasIds)) this.canvases.remove(cid);
      for (const pid of pageIds) this.pages.remove(pid);
      for (const name of newCollections) this.data.removeCollection(name);
      throw err;
    }

    this.db
      .prepare(`INSERT INTO installed_packages (id, version, connections, block_ids, canvas_ids, page_ids, installed_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(manifest.id, manifest.version, "{}", JSON.stringify(created.map((b) => b.id)), JSON.stringify(Object.values(canvasIds)), JSON.stringify(pageIds), new Date().toISOString());
    this.applyConnections(manifest, blockIds, canvasIds, {});
    return this.get(id);
  }

  uninstall(id: string, dropData: boolean) {
    const row = this.installedRow(id);
    if (!row) throw new NotFoundException("pacote nao instalado");
    const { manifest } = this.find(id);
    for (const pid of parse<string[]>(row.page_ids, [])) {
      try {
        this.pages.remove(pid);
      } catch {
        // ja excluida
      }
    }
    for (const bid of parse<string[]>(row.block_ids, [])) if (this.blocks.find(bid)) this.blocks.remove(bid);
    for (const cid of parse<string[]>(row.canvas_ids, [])) {
      try {
        this.canvases.remove(cid);
      } catch {
        // ja excluido
      }
    }
    if (dropData) for (const c of manifest.collections) {
      try {
        this.data.removeCollection(c.name);
      } catch {
        // ja excluida
      }
    }
    this.db.prepare(`DELETE FROM installed_packages WHERE id = ?`).run(id);
    return { ok: true };
  }

  // ---------------------------------------------------------------- conexoes

  connect(id: string, body: Record<string, unknown>): PackageInfo {
    const row = this.installedRow(id);
    if (!row) throw new BadRequestException("instale o pacote antes de conectar");
    const { manifest } = this.find(id);
    const conn = parse<Record<string, string>>(row.connections, {});
    const toolList = this.tools.list();
    for (const [reqId, value] of Object.entries(body)) {
      const req = manifest.requires.find((r) => r.id === reqId);
      if (!req || req.kind !== "tool") throw new BadRequestException(`conexao desconhecida: ${reqId}`);
      if (value === null || value === "") delete conn[reqId];
      else if (typeof value !== "string" || !toolList.some((t) => t.name === value)) throw new BadRequestException(`a ferramenta "${String(value)}" nao existe (conecte o servidor MCP e reinicie o servidor)`);
      else conn[reqId] = value;
    }
    this.db.prepare(`UPDATE installed_packages SET connections = ? WHERE id = ?`).run(JSON.stringify(conn), id);
    const blockIds = parse<string[]>(row.block_ids, []);
    const keyToBlock: Record<string, string> = {};
    manifest.blocks.forEach((b, i) => (keyToBlock[b.key] = blockIds[i]));
    const canvasIds = parse<string[]>(row.canvas_ids, []);
    const keyToCanvas: Record<string, string> = {};
    manifest.canvases.forEach((c, i) => (keyToCanvas[c.key] = canvasIds[i]));
    this.applyConnections(manifest, keyToBlock, keyToCanvas, conn);
    this.patchCanvasTools(manifest, keyToCanvas, conn);
    return this.get(id);
  }

  /** "@id" vira a ferramenta conectada; sem conexao, sai da lista. */
  private resolveTools(tools: string[], conn: Record<string, string>): string[] {
    return Array.from(new Set(tools.map((t) => (typeof t === "string" && t.startsWith("@") ? conn[t.slice(1)] : t)).filter((t): t is string => !!t)));
  }

  /** Reaplica as conexoes nos nos de agente dos canvases do pacote (sem mexer no resto do que o usuario editou). */
  private patchCanvasTools(manifest: PackageManifest, canvasIds: Record<string, string>, conn: Record<string, string>): void {
    for (const cv of manifest.canvases) {
      const id = canvasIds[cv.key];
      if (!id) continue;
      let current;
      try {
        current = this.canvases.find(id);
      } catch {
        continue;
      }
      let changed = false;
      const nodes = current.nodes.map((n) => {
        const original = cv.nodes.find((x) => isObject(x) && x.id === n.id) as { config?: { tools?: unknown } } | undefined;
        const tools = original?.config?.tools;
        if (!Array.isArray(tools) || !tools.some((t) => typeof t === "string" && t.startsWith("@"))) return n;
        changed = true;
        return { ...n, config: { ...n.config, tools: this.resolveTools(tools as string[], conn) } };
      });
      if (changed) this.canvases.update(id, { name: current.name, description: current.description, nodes, edges: current.edges, source: current.source });
    }
  }

  /** Calcula ctx.config e as permissoes de ferramentas/agentes de cada componente a partir das conexoes. */
  private applyConnections(manifest: PackageManifest, blockIds: Record<string, string>, canvasIds: Record<string, string>, conn: Record<string, string>): void {
    for (const b of manifest.blocks) {
      const bid = blockIds[b.key];
      if (!bid || !this.blocks.find(bid)) continue;
      const tools = b.permissions.tools.map((t) => (t.startsWith("@") ? conn[t.slice(1)] : t)).filter((t): t is string => !!t);
      const agents = b.permissions.agents.map((a) => (a === "*" ? "*" : canvasIds[a])).filter((a): a is string => !!a);
      const permissions: BlockPermissions = { ...this.blocks.get(bid).permissions, tools, agents };
      this.blocks.patchInternal(bid, { permissions, config: { agents: canvasIds, tools: conn, package: manifest.id } });
    }
  }

  // ---------------------------------------------------------------- pacotes criados (agente ou importados)

  saveCustom(input: unknown, source: "user" | "agent"): PackageInfo {
    const m = this.validateManifest(input);
    if (this.lib().some((x) => x.id === m.id)) throw new BadRequestException(`ja existe um pacote da biblioteca com o id "${m.id}"`);
    const now = new Date().toISOString();
    const installed = this.installedRow(m.id);
    if (installed) throw new BadRequestException("desinstale o pacote antes de substituir a definicao dele");
    this.db
      .prepare(`INSERT INTO custom_packages (id, manifest, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET manifest = excluded.manifest, source = excluded.source, updated_at = excluded.updated_at`)
      .run(m.id, JSON.stringify(m), source, now, now);
    return this.get(m.id);
  }

  removeCustom(id: string) {
    // se a biblioteca tem um pacote com o mesmo id (foi promovido a padrao de fabrica), a definicao "criada" e so uma copia velha: pode sair mesmo instalado
    if (this.installedRow(id) && !this.lib().some((m) => m.id === id)) throw new BadRequestException("desinstale o pacote antes");
    const r = this.db.prepare(`DELETE FROM custom_packages WHERE id = ?`).run(id);
    if (Number(r.changes) === 0) throw new NotFoundException("pacote criado nao encontrado");
    return { ok: true };
  }

  private validateManifest(input: unknown): PackageManifest {
    const problems: string[] = [];
    if (!isObject(input)) throw new BadRequestException("o pacote deve ser um objeto");
    const m = input as Partial<PackageManifest>;
    const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
    if (!m.id || !ID_RE.test(m.id)) problems.push('id invalido (minusculas, numeros e "-", 2-40, comeca com letra)');
    if (!str(m.name, 80)) problems.push("falta name");
    if (!str(m.description, 300)) problems.push("falta description");
    const requires = Array.isArray(m.requires) ? m.requires : [];
    const collections = Array.isArray(m.collections) ? m.collections : [];
    const blocks = Array.isArray(m.blocks) ? m.blocks : [];
    const canvases = Array.isArray(m.canvases) ? m.canvases : [];
    if (blocks.length > 20 || canvases.length > 10 || collections.length > 20 || requires.length > 10) problems.push("pacote grande demais");
    const reqIds = new Set<string>();
    for (const r of requires as Requirement[]) {
      if (!r || !KEY_RE.test(String(r.id))) problems.push(`requisito com id invalido: ${String((r as { id?: unknown })?.id)}`);
      else if (reqIds.has(r.id)) problems.push(`requisito repetido: ${r.id}`);
      else reqIds.add(r.id);
      if (!["collection", "tool", "ai"].includes(String(r?.kind))) problems.push(`requisito ${r?.id}: kind deve ser collection, tool ou ai`);
      if (r?.kind === "tool" && (!Array.isArray(r.match) || r.match.length === 0)) problems.push(`requisito ${r.id}: informe match (trechos de nome para sugerir ferramentas)`);
    }
    const canvasKeys = new Set<string>();
    for (const c of canvases) {
      if (!c || !KEY_RE.test(String(c.key))) problems.push(`canvas com key invalida: ${String((c as { key?: unknown })?.key)}`);
      else canvasKeys.add(c.key);
    }
    const blockKeys = new Set<string>();
    for (const b of blocks) {
      if (!b || !KEY_RE.test(String(b.key))) {
        problems.push(`componente com key invalida: ${String((b as { key?: unknown })?.key)}`);
        continue;
      }
      if (blockKeys.has(b.key)) problems.push(`componente repetido: ${b.key}`);
      blockKeys.add(b.key);
      if (typeof b.js !== "string" || !b.js.trim()) problems.push(`componente ${b.key}: falta js`);
      const p = b.permissions;
      if (!isObject(p)) problems.push(`componente ${b.key}: falta permissions {read, write, tools, agents}`);
      else {
        for (const a of Array.isArray(p.agents) ? (p.agents as string[]) : []) if (a !== "*" && !canvasKeys.has(a)) problems.push(`componente ${b.key}: permissions.agents "${a}" nao e uma key de canvas do pacote`);
        for (const t of Array.isArray(p.tools) ? (p.tools as string[]) : []) if (t.startsWith("@") && !reqIds.has(t.slice(1))) problems.push(`componente ${b.key}: permissions.tools "${t}" nao corresponde a um requisito`);
      }
    }
    for (const c of canvases) {
      for (const n of Array.isArray(c.nodes) ? c.nodes : []) {
        const node = n as { type?: string; config?: { blockKey?: string } };
        if (node?.type === "ui.block" && !blockKeys.has(String(node.config?.blockKey))) problems.push(`canvas ${c.key}: nó ui.block aponta para o componente "${String(node.config?.blockKey)}" que nao existe (use config.blockKey)`);
      }
    }
    const pagesIn = Array.isArray((m as { pages?: unknown }).pages) ? ((m as { pages: NonNullable<PackageManifest["pages"]> }).pages) : [];
    if (pagesIn.length > 10) problems.push("no máximo 10 páginas por pacote");
    for (const pg of pagesIn) {
      if (!pg || !str(pg.name, 60)) problems.push("página sem name");
      for (const it of Array.isArray(pg?.layout) ? pg.layout : []) {
        if (it.kind !== "heading" && !blockKeys.has(String(it.blockKey))) problems.push(`página "${pg.name}": blockKey "${String(it.blockKey)}" não é um componente do pacote`);
        if (it.kind === "heading" && !it.text) problems.push(`página "${pg.name}": título de seção sem text`);
      }
    }
    if (problems.length) throw new BadRequestException(["Corrija o pacote e envie de novo:", ...problems.slice(0, 15)]);
    return {
      id: m.id!,
      name: str(m.name, 80),
      description: str(m.description, 300),
      category: str(m.category, 40) || "geral",
      version: str(m.version, 20) || "0.1.0",
      icon: str(m.icon, 4) || undefined,
      requires: requires as Requirement[],
      collections: collections as PackageManifest["collections"],
      blocks: blocks.map((b) => ({ ...b, css: b.css ?? "", permissions: { read: b.permissions.read ?? [], write: b.permissions.write ?? [], tools: b.permissions.tools ?? [], agents: b.permissions.agents ?? [] } })),
      canvases: canvases as PackageManifest["canvases"],
      pages: pagesIn.length ? pagesIn : undefined,
      seed: isObject(m.seed) ? (m.seed as PackageManifest["seed"]) : undefined,
    };
  }
}
