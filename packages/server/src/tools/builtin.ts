import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { dataDir } from "../db";

export interface BuiltinTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  readOnly: boolean;
  run: (args: Record<string, unknown>) => Promise<unknown>;
}

/** Pasta onde os agentes leem e escrevem arquivos (nada fora dela). */
export const filesRoot = () => resolve(dataDir(), "files");

function safePath(p: unknown): string {
  const root = filesRoot();
  mkdirSync(root, { recursive: true });
  const full = resolve(root, String(p ?? "."));
  if (full !== root && !full.startsWith(root + sep)) throw new Error("caminho fora da pasta de arquivos");
  return full;
}

export const BUILTIN_TOOLS: BuiltinTool[] = [
  {
    name: "get_time",
    description: "Data e hora atuais (local) e dia da semana.",
    parameters: { type: "object", properties: {} },
    readOnly: true,
    run: async () => {
      const d = new Date();
      return { iso: d.toISOString(), local: d.toLocaleString("pt-BR", { dateStyle: "full", timeStyle: "short" }), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
    },
  },
  {
    name: "fs_list",
    description: "Lista arquivos e pastas dentro da pasta de arquivos do Agent Canvas (path opcional).",
    parameters: { type: "object", properties: { path: { type: "string", description: "subpasta; vazio = raiz" } } },
    readOnly: true,
    run: async (a) => {
      const dir = safePath(a.path);
      return readdirSync(dir, { withFileTypes: true }).map((e) => ({ name: e.name, type: e.isDirectory() ? "pasta" : "arquivo", ...(e.isFile() ? { bytes: statSync(resolve(dir, e.name)).size } : {}) }));
    },
  },
  {
    name: "fs_read",
    description: "Lê um arquivo de texto (até 50 KB) da pasta de arquivos.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    readOnly: true,
    run: async (a) => {
      const file = safePath(a.path);
      if (statSync(file).size > 50_000) throw new Error("arquivo maior que 50 KB");
      return readFileSync(file, "utf8");
    },
  },
  {
    name: "fs_write",
    description: "Cria ou substitui um arquivo de texto (até 100 KB) na pasta de arquivos.",
    parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
    readOnly: false,
    run: async (a) => {
      const file = safePath(a.path);
      const content = String(a.content ?? "");
      if (content.length > 100_000) throw new Error("conteúdo maior que 100 KB");
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content, "utf8");
      return { ok: true, path: relative(filesRoot(), file).split(sep).join("/") };
    },
  },
];
