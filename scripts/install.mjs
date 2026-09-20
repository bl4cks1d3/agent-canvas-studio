#!/usr/bin/env node
// Instalador do Agent Canvas Studio (Windows, macOS, Linux e Raspberry Pi 64 bits): prepara tudo em um comando.
//
//   node scripts/install.mjs              instala dependências, compila, cria o .env e registra as ferramentas no Claude Code
//   node scripts/install.mjs --no-claude  não mexe no Claude Code
//   node scripts/install.mjs --url http://localhost:5100   Studio em outra máquina (túnel SSH) para o Claude Code
//   node scripts/install.mjs --skip-install               pula o "pnpm install" (já feito)
//
// O padrão de fábrica (bibliotecas, componentes e páginas) NÃO precisa de passo nenhum: o servidor o instala sozinho na
// primeira subida com o banco vazio. Para reinstalar o que faltar depois: pnpm factory:restore.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valueOf = (f) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : undefined);
const step = (n, text) => console.log(`\n[${n}] ${text}`);
const ok = (text) => console.log(`  ✔ ${text}`);
const warn = (text) => console.log(`  ! ${text}`);
const fail = (text) => {
  console.error(`\n✖ ${text}`);
  process.exit(1);
};

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: isWin, ...opts });
}

if (has("--help") || has("-h")) {
  console.log("Uso: node scripts/install.mjs [--no-claude] [--url <studio>] [--skip-install]");
  process.exit(0);
}

// ---------------------------------------------------------------- 1. pré-requisitos
step(1, "Conferindo pré-requisitos");
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  fail(`Node ${process.versions.node} é antigo demais: o Studio usa o SQLite embutido (node:sqlite), que exige Node 22.5 ou mais novo (https://nodejs.org).`);
}
ok(`Node ${process.versions.node} (${process.platform}/${process.arch})`);
if (process.arch === "arm" || process.arch === "ia32") {
  warn(`Sistema de 32 bits (${process.arch}): o servidor e o app web rodam, mas o terminal embutido (node-pty) e o Claude Code não têm versão para esta arquitetura. Veja docs/RASPBERRY-PI.md.`);
}
let pnpm = spawnSync("pnpm", ["--version"], { encoding: "utf8", shell: isWin });
if (pnpm.status !== 0) {
  warn("pnpm não encontrado: ativando pelo corepack (vem com o Node).");
  run("corepack", ["enable"]);
  run("corepack", ["prepare", "pnpm@10.28.2", "--activate"]);
  pnpm = spawnSync("pnpm", ["--version"], { encoding: "utf8", shell: isWin });
  if (pnpm.status !== 0) fail("Não consegui ativar o pnpm. Instale com: npm install -g pnpm");
}
ok(`pnpm ${pnpm.stdout.trim()}`);

// ---------------------------------------------------------------- 2. dependências e compilação
if (!has("--skip-install")) {
  step(2, "Instalando dependências (pnpm install)");
  // no Windows/macOS/x64/arm64 instala tudo; em 32 bits o terminal (node-pty) nao existe, entao fica de fora
  const filter = process.arch === "arm" || process.arch === "ia32" ? ["--filter", "!@agent-canvas/terminal"] : [];
  const r = run("pnpm", ["install", "--frozen-lockfile", ...filter]);
  if (r.status !== 0) fail("pnpm install falhou (veja a mensagem acima).");
} else {
  step(2, "Dependências: pulado (--skip-install)");
}

step(3, "Compilando os pacotes compartilhados e o servidor MCP");
const build = run("pnpm", ["build:mcp"]);
if (build.status !== 0) fail("A compilação falhou.");
ok("packages/shared e packages/mcp compilados");

// ---------------------------------------------------------------- 3. .env
step(4, "Configuração (.env)");
const env = join(root, ".env");
if (existsSync(env)) ok(".env já existe (mantido).");
else {
  copyFileSync(join(root, ".env.example"), env);
  ok(".env criado a partir do .env.example. As chaves de IA e do Google se cadastram na aba Configurações do app.");
}

// ---------------------------------------------------------------- 4. Claude Code
if (has("--no-claude")) {
  step(5, "Claude Code: pulado (--no-claude)");
} else {
  step(5, "Registrando as ferramentas do Studio no Claude Code");
  const args = [join(root, "scripts", "install-mcp.mjs")];
  if (valueOf("--url")) args.push("--url", valueOf("--url"));
  const r = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" });
  if (r.status !== 0) {
    warn("Não registrei no Claude Code (ele não está instalado aqui, ou falhou). Nada quebra: ao abrir o Claude Code NESTA pasta, o .mcp.json já registra as ferramentas.");
  }
}

console.log(`
Pronto. Para usar:
  pnpm dev                 sobe servidor (5100), app web (5200) e terminal (5300)
  http://localhost:5200    abra no navegador — o padrão de fábrica (dashboards, bibliotecas e componentes) já vem instalado
  pnpm factory:restore     reinstala o padrão de fábrica que faltar (não apaga nada seu)
  pnpm test                testes de API (com o servidor no ar)
`);
