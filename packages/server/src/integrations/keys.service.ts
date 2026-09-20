import { BadRequestException, Injectable } from "@nestjs/common";
import { readEnvNames, removeEnvKey, writeEnv } from "./env-file";

/** So nomes de segredo (…KEY, …TOKEN, …SECRET, …PASSWORD): impede trocar variaveis que mudam o comportamento do processo (PATH, NODE_OPTIONS…). */
const NAME_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const SECRET_SUFFIX = /(KEY|TOKEN|SECRET|PASSWORD|PASS|CREDENTIALS?)$/;
/** Ja tem cartao proprio em Configuracoes (IAs, Google): nao entram na lista de "outras chaves". */
const MANAGED = /^(GROQ_|GEMINI_|ANTHROPIC_|GOOGLE_OAUTH_|USER_GOOGLE_|AI_PROVIDER)/;
/** Ascii visivel, sem espaco e sem aspas no comeco (o dotenv tiraria): um valor com quebra de linha viraria outra variavel. */
const VALUE_RE = /^[\x21-\x7E]{1,500}$/;

const checkName = (raw: unknown): string => {
  const name = String(raw ?? "").trim();
  if (!NAME_RE.test(name) || !SECRET_SUFFIX.test(name)) throw new BadRequestException("Nome inválido: use MAIÚSCULAS, números e _, terminando em KEY, TOKEN, SECRET ou PASSWORD (ex.: GITHUB_TOKEN).");
  if (MANAGED.test(name)) throw new BadRequestException("Esta chave tem cartão próprio acima (provedores de IA ou conta Google).");
  return name;
};

/**
 * "Outras chaves privadas": tokens de qualquer servico (ex.: GITHUB_TOKEN para um servidor MCP). Ficam no .env, valem na hora para
 * este processo e sao herdadas pelos servidores MCP quando reconectados. A API so devolve os NOMES, nunca os valores.
 */
@Injectable()
export class KeysService {
  list(): { keys: string[] } {
    return { keys: Array.from(new Set(readEnvNames().filter((n) => NAME_RE.test(n) && SECRET_SUFFIX.test(n) && !MANAGED.test(n)))).sort() };
  }

  save(body: { name?: unknown; value?: unknown }) {
    const name = checkName(body?.name);
    const value = String(body?.value ?? "");
    if (!VALUE_RE.test(value) || /^["'`]/.test(value)) throw new BadRequestException("Valor inválido: cole só a chave, sem espaços, aspas nem quebras de linha.");
    writeEnv({ [name]: value });
    return this.list();
  }

  remove(rawName: string) {
    removeEnvKey(checkName(rawName));
    return this.list();
  }
}
