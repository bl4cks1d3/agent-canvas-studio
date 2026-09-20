// Modelo de dados do Agent Canvas: um canvas e um grafo de nos ligados por fios.
// Cada no recebe itens (objetos JSON; o texto de um agente fica em `text`) e entrega itens por uma porta.

export type NodeType =
  | "input.prompt"
  | "agent.llm"
  | "agent.claude"
  | "tool.call"
  | "data.records"
  | "action.record"
  | "action.notify"
  | "ui.block"
  | "logic.if"
  | "output.result"
  | "note";

export interface CanvasNode {
  /** a-z, 0-9 e _ (usado em {{nodes.<id>.items}}). */
  id: string;
  type: NodeType;
  name: string;
  x: number;
  y: number;
  config: Record<string, unknown>;
  /** "stop" (padrao): o erro interrompe a execucao; "continue": descarta o item e segue. */
  onError?: "stop" | "continue";
}

export interface CanvasEdge {
  id: string;
  from: string;
  /** Porta de saida do no de origem ("main"; "true"/"false" no Se). */
  fromPort: string;
  to: string;
}

export type CanvasSource = "user" | "agent";

export interface Canvas {
  id: string;
  name: string;
  description?: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  /** Quem editou por ultimo: "agent" = o Claude via MCP (o usuario revisa antes de executar). */
  source: CanvasSource;
  lastRunAt?: string;
  lastStatus?: RunStatus;
  createdAt: string;
  updatedAt: string;
}

export type RunStatus = "running" | "ok" | "partial" | "error" | "cancelled";
export type NodeStatus = "running" | "ok" | "error" | "skipped" | "simulated";

export interface NodeLog {
  nodeId: string;
  name: string;
  type: NodeType;
  status: NodeStatus;
  itemsIn: number;
  itemsOut: Record<string, number>;
  /** Amostra (cortada) do que entrou e do que saiu por porta. */
  input?: unknown[];
  output?: Record<string, unknown[]>;
  /** Agentes: quantos passos do laco de ferramentas e quais ferramentas usaram. */
  steps?: number;
  toolsUsed?: string[];
  error?: string;
  failed?: number;
  warnings?: string[];
  startedAt?: string;
  durationMs: number;
}

export interface CanvasRun {
  id: string;
  canvasId: string;
  status: RunStatus;
  /** "dry" = simulacao: agentes e escritas sao simulados; so leituras rodam de verdade. */
  mode: "live" | "dry";
  startNodeId: string;
  input: string;
  nodes: NodeLog[];
  /** Texto final: o que chegou nos nos de resultado (ou o ultimo agente). */
  result?: string;
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

export type FieldKind = "text" | "textarea" | "number" | "select" | "json" | "tool" | "tools" | "condition" | "collection" | "block";

export interface FieldSpec {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: string[];
}

/** Catalogo dos tipos de no (o editor, a validacao e o MCP leem daqui). */
export interface NodeSpec {
  type: NodeType;
  category: "input" | "agent" | "tool" | "data" | "ui" | "logic" | "output" | "note";
  label: string;
  description: string;
  inputs: 0 | 1;
  outputs: string[];
  fields: FieldSpec[];
  example: Record<string, unknown>;
}

export interface ToolInfo {
  name: string;
  description: string;
  params: string[];
  required: string[];
  source: string;
  /** Leitura pura: roda de verdade ate na simulacao. */
  readOnly: boolean;
}

export interface Catalog {
  nodes: NodeSpec[];
  tools: ToolInfo[];
  providers: Array<{ id: string; label: string; available: boolean; model: string }>;
  claude: { installed: boolean; version?: string };
}

// ---------------------------------------------------------------------------
// Studio: banco (colecoes), componentes visuais (blocos) e pacotes
// ---------------------------------------------------------------------------

export type CollectionFieldType = "text" | "longtext" | "number" | "date" | "boolean" | "select";

export interface CollectionField {
  name: string;
  label?: string;
  type: CollectionFieldType;
  required?: boolean;
  options?: string[];
}

export interface Collection {
  id: string;
  name: string;
  label: string;
  description?: string;
  fields: CollectionField[];
  createdAt: string;
  updatedAt: string;
}

export interface BlockPermissions {
  /** Colecoes que o bloco pode ler ("col:<nome>"). */
  read: string[];
  /** Colecoes que o bloco pode criar/editar/excluir registros ("col:<nome>"). */
  write: string[];
  /** Ferramentas (nome exato) que o bloco pode chamar. */
  tools: string[];
  /** Canvases (id) cujos agentes o bloco pode executar; "*" = todos. */
  agents: string[];
}

export type BlockSource = "package" | "user" | "agent";

export interface Block {
  id: string;
  name: string;
  description?: string;
  html: string;
  css: string;
  js: string;
  permissions: BlockPermissions;
  refreshSeconds: number;
  source: BlockSource;
  /** Bloco do agente/API so roda depois que o usuario aprova as permissoes. */
  approved: boolean;
  packageId?: string;
  /** Configuracao entregue ao bloco em ctx.config (conexoes do pacote: ferramentas e agentes). */
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Dashboard: paginas com componentes organizados numa grade (o canvas orquestra; o dashboard mostra)
// ---------------------------------------------------------------------------

/** A grade tem 12 colunas; a altura e em linhas de 40 px. */
export const GRID_COLS = 12;

export interface PageItem {
  /** Identificador do item na pagina (unico). */
  i: string;
  kind: "block" | "heading";
  /** kind = "block": o componente. */
  blockId?: string;
  /** kind = "heading": titulo de secao (organiza a pagina). */
  text?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DashboardPage {
  id: string;
  name: string;
  position: number;
  layout: PageItem[];
  packageId?: string;
  createdAt: string;
  updatedAt: string;
}

/** O que um pacote precisa para funcionar: o Studio pede cada conexao ao instalar. */
export type Requirement =
  | { id: string; kind: "collection"; label: string; collection: string }
  | { id: string; kind: "tool"; label: string; hint: string; match: string[]; optional?: boolean }
  | { id: string; kind: "ai"; label: string; optional?: boolean };

export interface PackageBlockDef {
  key: string;
  name: string;
  description?: string;
  html: string;
  css?: string;
  js: string;
  /** agents: chaves de `canvases`; tools: "@<id do requisito>" (vira a ferramenta conectada). */
  permissions: BlockPermissions;
  refreshSeconds?: number;
}

export interface PackageCanvasDef {
  key: string;
  name: string;
  description?: string;
  /** Nos do canvas; `ui.block` usa config.blockKey (chave de `blocks`). */
  nodes: unknown[];
  edges: unknown[];
}

export interface PackagePageDef {
  key?: string;
  name: string;
  /** blockKey = chave de `blocks` do pacote (vira o id do componente ao instalar). */
  layout: Array<{ kind?: "block" | "heading"; blockKey?: string; text?: string; x: number; y: number; w: number; h: number }>;
}

export interface PackageManifest {
  id: string;
  name: string;
  description: string;
  category: string;
  version: string;
  icon?: string;
  experimental?: boolean;
  requires: Requirement[];
  collections: Array<{ name: string; label: string; description?: string; fields: CollectionField[] }>;
  blocks: PackageBlockDef[];
  canvases: PackageCanvasDef[];
  /** Paginas de dashboard prontas (organizam os componentes do pacote). */
  pages?: PackagePageDef[];
  seed?: Record<string, Array<Record<string, unknown>>>;
}

export type ConnectionStatus = "ok" | "pending" | "optional";

export interface PackageConnection {
  id: string;
  kind: Requirement["kind"];
  label: string;
  hint?: string;
  status: ConnectionStatus;
  /** Para "tool": a ferramenta conectada. */
  value?: string;
  /** Para "tool": ferramentas disponiveis que parecem servir (por nome). */
  suggestions?: string[];
}

export interface PackageInfo {
  id: string;
  name: string;
  description: string;
  category: string;
  version: string;
  icon?: string;
  experimental?: boolean;
  origin: "biblioteca" | "criado";
  counts: { blocks: number; canvases: number; collections: number; pages: number };
  installed: boolean;
  installedAt?: string;
  connections: PackageConnection[];
  /** Instalado e sem conexao obrigatoria pendente. */
  ready: boolean;
  canvasIds: string[];
  pageIds: string[];
}
