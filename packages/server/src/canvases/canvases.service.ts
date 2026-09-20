import { ChangesService } from "../events/changes.service";
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, type OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Canvas, CanvasRun, CanvasSource, Catalog } from "@agent-canvas/shared";
import { CANVAS_DB } from "../database.module";
import type { CanvasDb } from "../db";
import { allowBash, claudeStatus, runClaude, runClaudeAgent } from "../llm/claude-node";
import { toolHints, withCompanions } from "../llm/tool-hints";
import { autoCandidates, isRetryableProviderError, PROVIDER_LABEL, PROVIDER_ORDER, providerAvailable, providerModel, resolveProvider, runLoop } from "../llm/providers";
import { BlocksService } from "../blocks/blocks.service";
import { DataService } from "../data/data.service";
import { NotificationsService } from "../notifications/notifications.service";
import { ToolRegistry } from "../tools/tool-registry";
import * as repo from "./canvases.repo";
import { executeCanvas, type EngineDeps } from "./engine";
import { autoLayout, normalizeGraph, validateGraph } from "./graph";
import { NODE_SPECS } from "./node-specs";

export type WithProblems = Canvas & { problems: string[] };
type Body = Record<string, unknown>;

const MAX_CONCURRENT = 3;

@Injectable()
export class CanvasesService implements OnModuleInit {
  private readonly running = new Map<string, AbortController>(); // runId -> cancelamento
  private readonly runningCanvas = new Set<string>();

  constructor(
    @Inject(CANVAS_DB) private readonly db: CanvasDb,
    private readonly tools: ToolRegistry,
    private readonly data: DataService,
    private readonly blocks: BlocksService,
    private readonly notifications: NotificationsService,
    private readonly changes: ChangesService
  ) {}

  onModuleInit(): void {
    repo.failStaleRuns(this.db);
  }

  // ---------------------------------------------------------------- consulta

  list(): Canvas[] {
    return repo.listCanvases(this.db);
  }

  find(id: string): Canvas {
    const c = repo.getCanvas(this.db, id);
    if (!c) throw new NotFoundException("canvas nao encontrado");
    return c;
  }

  get(id: string): WithProblems {
    const c = this.find(id);
    return { ...c, problems: this.problemsOf(c) };
  }

  async catalog(): Promise<Catalog> {
    const claude = await claudeStatus();
    return {
      nodes: NODE_SPECS,
      tools: this.tools.list(),
      providers: [
        ...PROVIDER_ORDER.map((id) => ({ id, label: PROVIDER_LABEL[id], available: providerAvailable(id), model: providerModel(id) })),
        // Claude Code como provedor de agente: usa a conta logada do `claude` (sem chave de API)
        { id: "claude-code", label: "Claude Code", available: claude.installed, model: "padrão da sua conta" },
      ],
      claude,
    };
  }

  runs(canvasId: string, limit: number): CanvasRun[] {
    this.find(canvasId);
    return repo.listRuns(this.db, canvasId, Math.min(30, Math.max(1, limit || 10)));
  }

  getRun(runId: string): CanvasRun {
    const r = repo.getRun(this.db, runId);
    if (!r) throw new NotFoundException("execucao nao encontrada");
    return r;
  }

  // ---------------------------------------------------------------- escrita

  create(input: Body): WithProblems {
    const built = this.build(input, undefined);
    const now = new Date().toISOString();
    const saved = repo.saveCanvas(this.db, { id: randomUUID(), ...built, createdAt: now, updatedAt: now });
    this.changes.emit("canvases", saved.id);
    return { ...saved, problems: this.problemsOf(saved) };
  }

  update(id: string, input: Body): WithProblems {
    const current = this.find(id);
    if (typeof input.baseUpdatedAt === "string" && input.baseUpdatedAt !== current.updatedAt) {
      throw new ConflictException("canvas alterado em outro lugar; recarregue");
    }
    const built = this.build(input, current);
    const saved = repo.saveCanvas(this.db, { ...current, ...built, id: current.id, createdAt: current.createdAt, updatedAt: new Date().toISOString() });
    this.changes.emit("canvases", saved.id);
    return { ...saved, problems: this.problemsOf(saved) };
  }

  remove(id: string) {
    this.find(id);
    repo.deleteCanvas(this.db, id);
    this.changes.emit("canvases", id);
    return { ok: true };
  }

  // ---------------------------------------------------------------- execucao

  /** Comeca a execucao em segundo plano e devolve o registro (status "running"); o cliente acompanha por GET /runs/:id. */
  run(canvasId: string, opts: { mode?: unknown; startNodeId?: unknown; input?: unknown; confirmed?: unknown }): CanvasRun {
    const canvas = this.find(canvasId);
    const mode: "live" | "dry" = opts.mode === "dry" ? "dry" : "live";
    if (mode === "live" && opts.confirmed !== true) {
      throw new BadRequestException("execução real exige confirmação do usuário (confirmed: true); use mode 'dry' para simular");
    }
    const problems = this.problemsOf(canvas);
    if (problems.length) throw new BadRequestException(["Corrija antes de executar:", ...problems]);
    const starts = canvas.nodes.filter((n) => n.type === "input.prompt");
    const start = typeof opts.startNodeId === "string" && opts.startNodeId ? starts.find((n) => n.id === opts.startNodeId) : starts[0];
    if (!start) throw new BadRequestException("o canvas precisa de um nó Pedido para começar");
    if (this.runningCanvas.has(canvasId)) throw new ConflictException("este canvas já está executando");
    if (this.running.size >= MAX_CONCURRENT) throw new ConflictException("muitas execuções ao mesmo tempo; tente de novo");

    const input = typeof opts.input === "string" && opts.input.trim() ? opts.input : String(start.config.text ?? "");
    const controller = new AbortController();
    const runId = randomUUID();
    this.running.set(runId, controller);
    this.runningCanvas.add(canvasId);
    const initial: CanvasRun = { id: runId, canvasId, status: "running", mode, startNodeId: start.id, input, nodes: [], startedAt: new Date().toISOString() };
    repo.saveRun(this.db, initial);

    void executeCanvas(canvas, { runId, mode, startNodeId: start.id, input, signal: controller.signal, onProgress: (r) => repo.saveRun(this.db, r) }, this.deps(canvas.name))
      .catch((err) => {
        repo.saveRun(this.db, { ...initial, status: "error", error: err instanceof Error ? err.message : String(err), finishedAt: new Date().toISOString() });
      })
      .finally(() => {
        this.running.delete(runId);
        this.runningCanvas.delete(canvasId);
        this.changes.emit("canvases", canvasId); // ultimo status/execucao mudou
      });
    return initial;
  }

  cancel(runId: string) {
    const c = this.running.get(runId);
    if (!c) throw new NotFoundException("execucao nao esta rodando");
    c.abort();
    return { ok: true };
  }

  // ---------------------------------------------------------------- interno

  private build(input: Body, current: Canvas | undefined) {
    const name = input.name !== undefined ? String(input.name ?? "").trim() : (current?.name ?? "");
    if (!name) throw new BadRequestException("name e obrigatorio");
    if (name.length > 80) throw new BadRequestException("name passa do limite de 80 caracteres");
    const source: CanvasSource = input.source === "agent" ? "agent" : input.source === "user" ? "user" : (current?.source ?? "user");
    const strict = source === "agent" || input.strict === true;

    let nodes = current?.nodes ?? [];
    let edges = current?.edges ?? [];
    let shape: string[] = [];
    if (input.nodes !== undefined || input.edges !== undefined) {
      let g;
      try {
        g = normalizeGraph({ nodes: input.nodes ?? nodes, edges: input.edges ?? edges });
      } catch (err) {
        throw new BadRequestException(err instanceof Error ? err.message : String(err));
      }
      ({ nodes, edges } = g);
      shape = g.problems;
      autoLayout(nodes, edges);
    }
    if (JSON.stringify({ nodes, edges }).length > 400_000) throw new BadRequestException("canvas grande demais");
    if (strict) {
      const problems = [...shape, ...validateGraph(nodes, edges, this.validationContext())];
      if (problems.length) throw new BadRequestException(["Corrija e envie de novo:", ...problems]);
    }
    const description = input.description !== undefined ? String(input.description ?? "").slice(0, 500) || undefined : current?.description;
    return { name, description, nodes, edges, source, lastRunAt: current?.lastRunAt, lastStatus: current?.lastStatus };
  }

  private validationContext() {
    const collections = new Set(this.data.listCollections().map((c) => c.name));
    return {
      tools: this.tools.list(),
      allowBash: allowBash(),
      hasCollection: (name: string) => collections.has(name),
      hasBlock: (id: string) => !!this.blocks.find(id),
    };
  }

  private problemsOf(c: Canvas): string[] {
    return validateGraph(c.nodes, c.edges, this.validationContext());
  }

  private deps(canvasName: string): EngineDeps {
    const system = (name: string, instructions: string) =>
      `Você é o agente "${name}" de um canvas de agentes conectados. Responda em português, de forma direta.\n` +
      `Você recebe, como mensagem do usuário, o que os nós anteriores produziram; entregue como resposta final apenas o resultado para os próximos nós.\n` +
      `Data e hora atuais: ${new Date().toLocaleString("pt-BR", { dateStyle: "full", timeStyle: "short" })}.\n\nSuas instruções:\n${instructions}`;
    return {
      runAgent: async (a) => {
        const sys = system(a.name, a.instructions) + toolHints(a.tools);
        // as ferramentas de descoberta (ex.: listar as listas de tarefas) acompanham as marcadas, para o agente achar os ids
        const allowed = withCompanions(a.tools);
        if (a.provider === "claude-code") {
          return runClaudeAgent({ system: sys, prompt: a.prompt, tools: a.tools, maxSteps: a.maxSteps, model: a.model, signal: a.signal });
        }
        // provedor explicito: so ele. "auto": o preferido primeiro e, se estourar o limite/cota ou cair, o proximo com chave
        const chain = a.provider && a.provider !== "auto" ? [resolveProvider(a.provider)] : autoCandidates();
        if (!chain.length) resolveProvider("auto"); // sem nenhuma chave: lanca o erro com o passo a passo
        let lastError: unknown;
        for (let i = 0; i < chain.length; i++) {
          try {
            return await runLoop(chain[i], {
              system: sys,
              prompt: a.prompt || "(nenhum contexto recebido: siga as instruções)",
              tools: this.tools.defs(allowed),
              maxSteps: a.maxSteps,
              // o modelo escolhido no no vale para o primeiro provedor; os de reserva usam o padrao deles
              model: i === 0 ? a.model : undefined,
              signal: a.signal,
              callTool: async (name, args) => {
                if (!allowed.includes(name)) throw new Error(`o agente não tem acesso à ferramenta ${name}`);
                const out = await this.tools.call(name, args);
                return typeof out === "string" ? out : JSON.stringify(out);
              },
            });
          } catch (err) {
            lastError = err;
            if (a.signal?.aborted || i === chain.length - 1 || !isRetryableProviderError(err)) break;
          }
        }
        const why = lastError instanceof Error ? lastError.message : String(lastError);
        const hint = isRetryableProviderError(lastError) && chain.length < 2 ? ' Dica: cadastre outro provedor (Gemini) em "Provedores de IA" no menu lateral para o Studio trocar sozinho quando o limite estourar.' : "";
        throw new Error(why + hint);
      },
      runClaude: (a) => runClaude({ ...a, instructions: a.instructions || "Responda em português." }),
      callTool: (name, args) => this.tools.call(name, args),
      notify: (n) => this.notifications.create({ ...n, source: canvasName }),
      isReadOnlyTool: (name) => this.tools.isReadOnly(name),
      listRecords: (collection, query) => this.data.listRecords(collection, query),
      createRecord: (collection, data) => this.data.createRecord(collection, data),
      setBlockInbox: (blockId, items) => this.blocks.setInbox(blockId, items),
    };
  }
}

