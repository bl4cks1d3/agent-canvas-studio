import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { upsertEnv } from "./google-workspace";

/** O .env da raiz do projeto (o mesmo que o servidor le no boot). Fora do git. */
export const ENV_PATH = resolve(__dirname, "../../../../.env");

/** Nomes das variaveis do .env que tem valor (nunca os valores). */
export function readEnvNames(): string[] {
  if (!existsSync(ENV_PATH)) return [];
  const names: string[] = [];
  for (const line of readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(\S.*)$/.exec(line);
    if (m && !line.trim().startsWith("#")) names.push(m[1]);
  }
  return names;
}

/** Apaga a linha KEY=… do .env e a variavel deste processo. */
export function removeEnvKey(name: string): void {
  if (existsSync(ENV_PATH)) {
    const kept = readFileSync(ENV_PATH, "utf8")
      .split(/\r?\n/)
      .filter((line) => !new RegExp(`^\\s*${name}\\s*=`).test(line));
    writeFileSync(ENV_PATH, kept.join("\n").replace(/\n*$/, "\n"), "utf8");
  }
  delete process.env[name];
}

/**
 * Grava KEY=valor no .env (preservando o resto) e ja vale para este processo: valor vazio apaga a chave do ambiente.
 * Quem chama valida o formato antes (nada de quebra de linha: um valor assim viraria outra variavel).
 */
export function writeEnv(entries: Record<string, string>): void {
  const current = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
  writeFileSync(ENV_PATH, upsertEnv(current, entries), "utf8");
  for (const [k, v] of Object.entries(entries)) {
    if (v) process.env[k] = v;
    else delete process.env[k];
  }
}
