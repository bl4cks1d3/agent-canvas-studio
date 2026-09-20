#!/usr/bin/env node
// Gera, no SEU PC, um pacote COMPILADO para copiar para o Raspberry Pi: dist-pi/agent-canvas-pi.tar.gz.
// O Pi 2 tem 1 GB de RAM e não consegue compilar o app web (next build precisa de bem mais): compile aqui e leve pronto.
//
//   pnpm pack:pi                      compila e empacota
//   pnpm pack:pi -- --skip-build      só empacota o que já está compilado
//
// No Pi:  tar xzf agent-canvas-pi.tar.gz && cd agent-canvas && ./scripts/pi/install-on-pi.sh
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const isWin = process.platform === "win32";
const out = join(root, "dist-pi");
const stage = join(out, "agent-canvas");
const skipBuild = process.argv.includes("--skip-build");
const WEB_DIST = ".next-pi";

const fail = (msg) => {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
};

if (!skipBuild) {
  console.log("[1/3] Compilando (shared, mcp, server e app web)…");
  // o app web compila numa pasta propria: o "next build" no .next quebraria o "next dev" que estiver aberto
  const r = spawnSync("pnpm", ["build"], { cwd: root, stdio: "inherit", shell: isWin, env: { ...process.env, NEXT_DIST_DIR: WEB_DIST } });
  if (r.status !== 0) fail("A compilação falhou.");
} else {
  console.log("[1/3] Compilação: pulada (--skip-build)");
}

console.log("[2/3] Montando a pasta do pacote…");
rmSync(out, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

const need = (rel) => {
  if (!existsSync(join(root, rel))) fail(`Falta ${rel}. Rode "pnpm pack:pi" sem --skip-build.`);
};
for (const rel of ["packages/shared/dist", "packages/mcp/dist", "packages/server/dist/main.js", "packages/server/dist/packages/library", `apps/web/${WEB_DIST}`]) need(rel);

const copy = (rel, filter) => {
  if (!existsSync(join(root, rel))) return;
  cpSync(join(root, rel), join(stage, rel), { recursive: true, filter });
};
for (const f of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".env.example", ".mcp.json", "README.md"]) copy(f);
copy("docs");
copy("scripts", (src) => !src.endsWith("block-harness.ts"));
// shared, mcp e server: so o manifesto e o compilado (o codigo-fonte fica no PC)
for (const p of ["shared", "mcp", "server"]) {
  copy(`packages/${p}/package.json`);
  copy(`packages/${p}/dist`);
}
// o terminal (node-pty) nao existe para ARM de 32 bits: vai so o package.json, para o pnpm-lock.yaml continuar valendo (nao e instalado)
copy("packages/terminal/package.json");
copy("apps/web/package.json");
copy("apps/web/next.config.mjs");
copy("apps/web/public");
copy(`apps/web/${WEB_DIST}`, (src) => !src.includes(`${sep}${WEB_DIST}${sep}cache`));

// scripts de Linux precisam de LF (um checkout no Windows pode ter convertido para CRLF)
for (const f of ["install-on-pi.sh", "agent-canvas-server.service.tmpl", "agent-canvas-web.service.tmpl"]) {
  const p = join(stage, "scripts", "pi", f);
  if (existsSync(p)) writeFileSync(p, readFileSync(p, "utf8").replace(/\r\n/g, "\n"));
}

const gitRev = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).stdout?.trim() || "sem git";
writeFileSync(join(stage, "PACK-INFO.txt"), `Agent Canvas Studio para Raspberry Pi\nGerado em ${new Date().toISOString()}\nCommit: ${gitRev}\nNode do PC: ${process.version} (${process.platform}/${process.arch})\n`);

console.log("[3/3] Compactando…");
const tar = spawnSync("tar", ["-czf", "agent-canvas-pi.tar.gz", "agent-canvas"], { cwd: out, stdio: "inherit" });
if (tar.status !== 0) fail('O comando "tar" falhou (no Windows 10/11 ele já vem instalado).');
const mb = (statSync(join(out, "agent-canvas-pi.tar.gz")).size / 1024 / 1024).toFixed(1);
console.log(`
✔ ${join(out, "agent-canvas-pi.tar.gz")} (${mb} MB)

Próximos passos:
  scp dist-pi/agent-canvas-pi.tar.gz pi@raspberrypi.local:~/
  ssh pi@raspberrypi.local
  tar xzf agent-canvas-pi.tar.gz && cd agent-canvas && ./scripts/pi/install-on-pi.sh
Leia docs/RASPBERRY-PI.md (o que roda no Pi 2 e o que não roda, como levar seus dados e como usar o Claude Code do seu PC).`);
