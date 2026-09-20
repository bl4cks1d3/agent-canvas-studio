#!/usr/bin/env node
// Exporta um pacote criado pelo Claude (ou importado) para a BIBLIOTECA DE FÁBRICA do repositório:
// packages/server/src/packages/library/<id>/ com manifest.json + os arquivos de cada componente (.html/.css/.js).
// Pacotes da biblioteca vão junto com o código (git) e podem ser instalados de fábrica em qualquer máquina.
//
//   node scripts/export-package.mjs rotina-estudo               exporta para a pasta da biblioteca
//   node scripts/export-package.mjs rotina-estudo --drop-custom depois apaga a definição "criada" do banco (evita duplicar na Biblioteca)
//
// Precisa do servidor no ar (SERVER_URL, padrão http://localhost:5100).
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER = (process.env.SERVER_URL ?? "http://localhost:5100").replace(/\/$/, "");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [id, ...flags] = process.argv.slice(2);
if (!id || id.startsWith("-")) {
  console.error("Uso: node scripts/export-package.mjs <id-do-pacote> [--drop-custom]");
  process.exit(1);
}

async function api(method, path) {
  const res = await fetch(SERVER + path, { method });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path}: ${Array.isArray(body.message) ? body.message.join("; ") : (body.message ?? res.status)}`);
  return body;
}

const pkg = await api("GET", `/packages/${encodeURIComponent(id)}`);
if (pkg.origin === "biblioteca") {
  console.log(`"${id}" já é um pacote da biblioteca: nada a exportar.`);
  process.exit(0);
}
const m = pkg.manifest;
const dir = join(root, "packages", "server", "src", "packages", "library", id);
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const write = (name, text) => writeFileSync(join(dir, name), text.endsWith("\n") || text === "" ? text : text + "\n", "utf8");
const blocks = m.blocks.map(({ html, css, js, ...b }) => {
  const files = { htmlFile: `${b.key}.html`, jsFile: `${b.key}.js` };
  write(files.htmlFile, html ?? "");
  write(files.jsFile, js ?? "");
  if (css) {
    files.cssFile = `${b.key}.css`;
    write(files.cssFile, css);
  }
  return { ...b, ...files };
});
const manifest = { ...m, blocks };
delete manifest.source;
write("manifest.json", JSON.stringify(manifest, null, 2));
console.log(`✔ ${id}: ${blocks.length} componente(s), ${m.collections.length} coleção(ões), ${(m.pages ?? []).length} página(s) → ${dir}`);

if (flags.includes("--drop-custom")) {
  await api("DELETE", `/packages/${encodeURIComponent(id)}/definition`);
  console.log(`✔ definição "criada" de ${id} removida do banco (agora vale a da biblioteca).`);
}
