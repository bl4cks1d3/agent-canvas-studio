import { Injectable } from "@nestjs/common";
import type { ToolInfo } from "@agent-canvas/shared";
import { BlocksService } from "../blocks/blocks.service";
import { DataService } from "../data/data.service";
import type { ToolDef } from "../llm/providers";
import { LEVELS, NotificationsService } from "../notifications/notifications.service";
import { BUILTIN_TOOLS, type BuiltinTool } from "./builtin";
import { McpManager } from "./mcp-manager";

/** Leitura pura de servidores MCP (nome comeca com list/get/read/search/find/describe/show/count): roda ate na simulacao. */
const MCP_READ = /^mcp__.+?__(list|get|read|search|find|describe|show|count)([_a-z0-9-]*)$/i;

/**
 * Ferramentas do Google pedem `user_google_email` (obrigatorio). Com uma conta conectada, o servidor preenche sozinho (McpManager.call);
 * o campo sai do esquema que o modelo enxerga, senao ele pergunta o e-mail, inventa um ou diz que precisa de login.
 */
function hideConnectedAccount(parameters: Record<string, unknown>): Record<string, unknown> {
  const props = (parameters as { properties?: Record<string, unknown> }).properties;
  if (!process.env.USER_GOOGLE_EMAIL || !props || !("user_google_email" in props)) return parameters;
  const { user_google_email: _drop, ...rest } = props;
  const required = ((parameters as { required?: string[] }).required ?? []).filter((k) => k !== "user_google_email");
  return { ...parameters, properties: rest, ...(required.length ? { required } : { required: undefined }) };
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, ...(required.length ? { required } : {}) });

/**
 * Ponto unico de ferramentas dos agentes: as embutidas, as do Studio (banco e componentes) e as dos
 * servidores MCP. As de escrita do Studio deixam o agente CONSTRUIR: colecoes e componentes novos —
 * componentes de agente nascem sem aprovacao (so o usuario aprova).
 */
@Injectable()
export class ToolRegistry {
  private readonly studio: BuiltinTool[];

  constructor(
    private readonly mcp: McpManager,
    private readonly data: DataService,
    private readonly blocks: BlocksService,
    private readonly notifications: NotificationsService
  ) {
    this.studio = this.studioTools();
  }

  private studioTools(): BuiltinTool[] {
    return [
      {
        name: "notify",
        description:
          "Envia uma notificacao ao usuario (aviso no Studio e notificacao do navegador). Use para lembretes, alertas e para avisar que uma tarefa terminou. Titulo curto; message opcional.",
        parameters: obj({ title: { type: "string" }, message: { type: "string" }, level: { type: "string", enum: LEVELS } }, ["title"]),
        readOnly: false,
        run: async (a) => this.notifications.create({ title: a.title, message: a.message, level: a.level, source: "ferramenta" }),
      },
      {
        name: "list_collections",
        description: "Lista as colecoes do banco (nome, campos e numero de registros).",
        parameters: obj({}),
        readOnly: true,
        run: async () => this.data.listCollections().map((c) => ({ name: c.name, label: c.label, fields: c.fields, records: c.records })),
      },
      {
        name: "list_records",
        description: "Lista registros de uma colecao. Filtros: q (busca), where (igualdade por campo), sort, order, limit.",
        parameters: obj({ collection: { type: "string" }, q: { type: "string" }, where: { type: "object" }, sort: { type: "string" }, order: { type: "string", enum: ["asc", "desc"] }, limit: { type: "number" } }, ["collection"]),
        readOnly: true,
        run: async (a) => {
          const query: Record<string, string | undefined> = {};
          for (const k of ["q", "sort", "order", "limit"]) if (a[k] !== undefined) query[k] = String(a[k]);
          for (const [k, v] of Object.entries((a.where ?? {}) as Record<string, unknown>)) query[k] = String(v);
          return this.data.listRecords(String(a.collection), query);
        },
      },
      {
        name: "save_record",
        description: "Cria (sem recordId) ou atualiza (com recordId; null limpa o campo) um registro de uma colecao.",
        parameters: obj({ collection: { type: "string" }, recordId: { type: "string" }, data: { type: "object" } }, ["collection", "data"]),
        readOnly: false,
        run: async (a) => {
          const data = (a.data ?? {}) as Record<string, unknown>;
          return a.recordId ? this.data.updateRecord(String(a.collection), String(a.recordId), data) : this.data.createRecord(String(a.collection), data);
        },
      },
      {
        name: "save_collection",
        description: "Cria a colecao (tabela) ou atualiza o esquema se ja existir. fields: [{name, type: text|longtext|number|date|boolean|select, label?, required?, options?}].",
        parameters: obj({ name: { type: "string" }, label: { type: "string" }, description: { type: "string" }, fields: { type: "array", items: { type: "object" } } }, ["name"]),
        readOnly: false,
        run: async (a) => {
          const name = String(a.name);
          const exists = this.data.listCollections().some((c) => c.name === name);
          return exists ? this.data.updateCollection(name, a) : this.data.createCollection(a);
        },
      },
      {
        name: "list_blocks",
        description: "Lista os componentes visuais (blocos): nome, origem, aprovado e permissoes.",
        parameters: obj({}),
        readOnly: true,
        run: async () => this.blocks.list().map((b) => ({ id: b.id, name: b.name, source: b.source, approved: b.approved, permissions: b.permissions })),
      },
      {
        name: "get_block",
        description: "Le o codigo (html, css, js) e as permissoes de um componente para editar.",
        parameters: obj({ id: { type: "string" } }, ["id"]),
        readOnly: true,
        run: async (a) => this.blocks.get(String(a.id)),
      },
      {
        name: "save_block",
        description:
          "Cria (sem id) ou atualiza (com id) um componente visual: html + css + js (studio.main(async ctx => ...)) e permissions {read:['col:x'], write:['col:x'], tools:[], agents:[]}. Fica AGUARDANDO APROVACAO do usuario.",
        parameters: obj(
          { id: { type: "string" }, name: { type: "string" }, description: { type: "string" }, html: { type: "string" }, css: { type: "string" }, js: { type: "string" }, permissions: { type: "object" }, refreshSeconds: { type: "number" } },
          ["name", "js"]
        ),
        readOnly: false,
        run: async (a) => {
          const body = { ...a, source: "agent" };
          delete (body as Record<string, unknown>).id;
          const saved = a.id ? this.blocks.update(String(a.id), body) : this.blocks.create(body);
          return { ...saved, warnings: this.blocks.lint(saved) };
        },
      },
    ];
  }

  private all(): Array<ToolDef & { source: string; readOnly: boolean }> {
    return [
      ...BUILTIN_TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters, source: "embutida", readOnly: t.readOnly })),
      ...this.studio.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters, source: "studio", readOnly: t.readOnly })),
      ...this.mcp.list().map((t) => ({ name: t.name, description: t.description, parameters: t.parameters, source: `mcp:${t.server}`, readOnly: MCP_READ.test(t.name) })),
    ];
  }

  reloadMcp(): Promise<number> {
    return this.mcp.reload();
  }

  mcpError(server: string): string | undefined {
    return this.mcp.errorOf(server);
  }

  list(): ToolInfo[] {
    return this.all().map((t) => {
      const props = Object.keys(((t.parameters as { properties?: object }).properties ?? {}) as object);
      const required = ((t.parameters as { required?: string[] }).required ?? []) as string[];
      return { name: t.name, description: t.description, params: props, required, source: t.source, readOnly: t.readOnly };
    });
  }

  defs(names: string[]): ToolDef[] {
    const wanted = new Set(names);
    return this.all()
      .filter((t) => wanted.has(t.name))
      .map(({ name, description, parameters }) => ({ name, description, parameters: hideConnectedAccount(parameters) }));
  }

  isReadOnly(name: string): boolean {
    return this.all().find((t) => t.name === name)?.readOnly ?? false;
  }

  async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    const tool = BUILTIN_TOOLS.find((t) => t.name === name) ?? this.studio.find((t) => t.name === name);
    if (tool) return tool.run(args);
    if (name.startsWith("mcp__")) return this.mcp.call(name, args);
    throw new Error(`ferramenta desconhecida: ${name}`);
  }
}
