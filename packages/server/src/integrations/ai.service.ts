import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { claudeStatus } from "../llm/claude-node";
import { PROVIDER_LABEL, PROVIDER_ORDER, preferredProvider, providerAvailable, providerModel, runLoop, type ProviderId } from "../llm/providers";
import { writeEnv } from "./env-file";

const KEY_ENV: Record<ProviderId, string> = { groq: "GROQ_API_KEY", gemini: "GEMINI_API_KEY", anthropic: "ANTHROPIC_API_KEY" };
const MODEL_ENV: Record<ProviderId, string> = { groq: "GROQ_MODEL", gemini: "GEMINI_MODEL", anthropic: "ANTHROPIC_MODEL" };
/** Chaves reais so tem letras, numeros, ponto, - e _ (Groq gsk_…, Anthropic sk-ant-…, Gemini AIza…/AQ.…). */
const KEY_RE = /^[A-Za-z0-9._-]{10,300}$/;
const MODEL_RE = /^[A-Za-z0-9._:/-]{1,100}$/;
const NOT_CHAT = /whisper|tts|guard|orpheus|playai|embed|moderation|imagen|veo|aqa|image|audio|live|robotics/i;

export interface AiProviderStatus {
  id: ProviderId;
  label: string;
  hasKey: boolean;
  /** Modelo em uso (o do .env ou o padrao). */
  model: string;
  /** O .env tem um modelo escolhido por voce (senao vale o padrao). */
  customModel: boolean;
}

export interface AiStatus {
  preferred: ProviderId | "auto";
  providers: AiProviderStatus[];
  claude: { installed: boolean; version?: string };
}

const provider = (id: string): ProviderId => {
  if (!(id in KEY_ENV)) throw new NotFoundException(`provedor desconhecido: ${id}`);
  return id as ProviderId;
};

async function getJson(url: string, headers: Record<string, string>): Promise<Record<string, any>> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 300);
    try {
      detail = JSON.parse(text).error?.message ?? detail;
    } catch {
      // texto puro
    }
    throw new BadRequestException(`${res.status}: ${detail}`);
  }
  return JSON.parse(text);
}

/**
 * "Provedores de IA": o usuario cola a chave (nunca volta para o navegador), escolhe o modelo padrao de cada provedor e qual o
 * "auto" tenta primeiro. Tudo vai para o .env e vale na hora, sem reiniciar.
 */
@Injectable()
export class AiService {
  async status(): Promise<AiStatus> {
    const claude = await claudeStatus();
    return {
      preferred: preferredProvider(),
      providers: PROVIDER_ORDER.map((id) => ({ id, label: PROVIDER_LABEL[id], hasKey: providerAvailable(id), model: providerModel(id), customModel: !!process.env[MODEL_ENV[id]]?.trim() })),
      claude,
    };
  }

  /** apiKey: salva; remove: apaga a chave; model: "" volta ao padrao. */
  async save(id: string, body: { apiKey?: unknown; model?: unknown; remove?: unknown }): Promise<AiStatus> {
    const p = provider(id);
    const entries: Record<string, string> = {};
    if (body?.remove === true) entries[KEY_ENV[p]] = "";
    else if (body?.apiKey !== undefined && body.apiKey !== "") {
      const key = String(body.apiKey).trim();
      if (!KEY_RE.test(key)) throw new BadRequestException("Chave inválida: use só letras, números, ponto, - e _ (copie de novo, sem espaços).");
      entries[KEY_ENV[p]] = key;
    }
    if (body?.model !== undefined) {
      const model = String(body.model).trim();
      if (model && !MODEL_RE.test(model)) throw new BadRequestException("Modelo inválido: use o id exato do modelo (letras, números, . - _ : /).");
      entries[MODEL_ENV[p]] = model;
    }
    if (!Object.keys(entries).length) throw new BadRequestException("Nada para salvar: envie apiKey, model ou remove.");
    writeEnv(entries);
    return this.status();
  }

  async setPreferred(value: unknown): Promise<AiStatus> {
    const v = String(value ?? "auto");
    if (v !== "auto" && !(v in KEY_ENV)) throw new BadRequestException("preferred deve ser auto, groq, gemini ou anthropic");
    writeEnv({ AI_PROVIDER: v === "auto" ? "" : v });
    return this.status();
  }

  /** Um pedido minimo ("ping") para saber se a chave e o modelo funcionam. */
  async test(id: string, model?: unknown): Promise<{ ok: boolean; ms: number; model: string; message: string }> {
    const p = provider(id);
    if (!providerAvailable(p)) throw new BadRequestException(`${PROVIDER_LABEL[p]} ainda não tem chave.`);
    const m = typeof model === "string" && model.trim() ? model.trim() : providerModel(p);
    if (!MODEL_RE.test(m)) throw new BadRequestException("Modelo inválido.");
    const t0 = Date.now();
    try {
      const r = await runLoop(p, { system: "Responda somente: ok", prompt: "ping", tools: [], maxSteps: 1, model: m, signal: AbortSignal.timeout(30_000), callTool: async () => "" });
      return { ok: true, ms: Date.now() - t0, model: m, message: r.text.slice(0, 80) || "(resposta vazia)" };
    } catch (e) {
      return { ok: false, ms: Date.now() - t0, model: m, message: (e instanceof Error ? e.message : String(e)).slice(0, 400) };
    }
  }

  /** Modelos que a chave enxerga (so os de conversa), direto da API do provedor. */
  async models(id: string): Promise<{ models: string[] }> {
    const p = provider(id);
    if (!providerAvailable(p)) throw new BadRequestException(`${PROVIDER_LABEL[p]} ainda não tem chave.`);
    const key = String(process.env[KEY_ENV[p]]);
    let ids: string[];
    if (p === "groq") {
      const j = await getJson("https://api.groq.com/openai/v1/models", { Authorization: `Bearer ${key}` });
      ids = (j.data ?? []).map((m: { id: string }) => m.id);
    } else if (p === "gemini") {
      const j = await getJson("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { "x-goog-api-key": key });
      ids = (j.models ?? [])
        .filter((m: { supportedGenerationMethods?: string[] }) => m.supportedGenerationMethods?.includes("generateContent"))
        .map((m: { name: string }) => m.name.replace(/^models\//, ""));
    } else {
      const j = await getJson("https://api.anthropic.com/v1/models?limit=100", { "x-api-key": key, "anthropic-version": "2023-06-01" });
      ids = (j.data ?? []).map((m: { id: string }) => m.id);
    }
    return { models: Array.from(new Set(ids.filter((m) => m && !NOT_CHAT.test(m)))).sort() };
  }
}
