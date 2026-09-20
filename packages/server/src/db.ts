import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type CanvasDb = DatabaseSync;

/** Pasta de dados (banco, arquivos dos agentes, pasta de trabalho do Claude Code). Fora do git. */
export function dataDir(): string {
  return resolve(process.env.DATA_DIR ?? resolve(__dirname, "../../../data"));
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS canvases (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  graph TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
  source TEXT NOT NULL DEFAULT 'user',
  last_run_at TEXT,
  last_status TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  canvas_id TEXT NOT NULL,
  status TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'live',
  start_node TEXT NOT NULL DEFAULT '',
  input TEXT NOT NULL DEFAULT '',
  nodes TEXT NOT NULL DEFAULT '[]',
  result TEXT,
  error TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_canvas ON runs(canvas_id, started_at);

CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  description TEXT,
  fields TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_records_collection ON records(collection_id);

CREATE TABLE IF NOT EXISTS blocks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  html TEXT NOT NULL DEFAULT '',
  css TEXT NOT NULL DEFAULT '',
  js TEXT NOT NULL DEFAULT '',
  permissions TEXT NOT NULL DEFAULT '{"read":[],"write":[],"tools":[],"agents":[]}',
  refresh_seconds INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'user',
  approved INTEGER NOT NULL DEFAULT 0,
  package_id TEXT,
  config TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- o que um agente entregou a um componente (no "ui.block"): o bloco le com ctx.inbox()
CREATE TABLE IF NOT EXISTS block_inbox (
  block_id TEXT PRIMARY KEY,
  items TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);

-- estado proprio de cada componente (ctx.store): preferencias, filtro, aba… persiste entre aberturas
CREATE TABLE IF NOT EXISTS block_state (
  block_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (block_id, key)
);

-- historico do design/codigo de cada componente: toda alteracao guarda a versao anterior (da para restaurar)
CREATE TABLE IF NOT EXISTS block_versions (
  id TEXT PRIMARY KEY,
  block_id TEXT NOT NULL,
  html TEXT NOT NULL,
  css TEXT NOT NULL,
  js TEXT NOT NULL,
  permissions TEXT NOT NULL,
  note TEXT,
  author TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_block_versions_block ON block_versions (block_id, created_at);

-- configuracoes do Studio (ex.: tema/design tokens aplicados a TODOS os componentes)
CREATE TABLE IF NOT EXISTS studio_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- paginas do dashboard: cada uma e uma grade de componentes (layout persistido: posicao e tamanho)
CREATE TABLE IF NOT EXISTS dashboard_pages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  layout TEXT NOT NULL DEFAULT '[]',
  package_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS installed_packages (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  connections TEXT NOT NULL DEFAULT '{}',
  block_ids TEXT NOT NULL DEFAULT '[]',
  canvas_ids TEXT NOT NULL DEFAULT '[]',
  page_ids TEXT NOT NULL DEFAULT '[]',
  installed_at TEXT NOT NULL
);

-- pacotes criados pelo agente (ou importados): aparecem na biblioteca ao lado dos prontos
CREATE TABLE IF NOT EXISTS custom_packages (
  id TEXT PRIMARY KEY,
  manifest TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- avisos para o usuario (ferramenta "notify", no "Notificar" dos canvases, lembretes): o Studio mostra e o navegador notifica
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  level TEXT NOT NULL DEFAULT 'info',
  source TEXT NOT NULL DEFAULT '',
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications (created_at);
`;

export function openDatabase(): DatabaseSync {
  const file = resolve(dataDir(), "agent-canvas.db");
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  const cols = db.prepare(`PRAGMA table_info(installed_packages)`).all() as unknown as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "page_ids")) db.exec(`ALTER TABLE installed_packages ADD COLUMN page_ids TEXT NOT NULL DEFAULT '[]'`);
  return db;
}
