// Provedores de IA por HTTP (sem SDKs): Groq (compativel com OpenAI), Anthropic e Gemini.
// Cada um roda o mesmo laco: pergunta -> (ferramentas -> resultado)* -> texto final.

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LoopArgs {
  system: string;
  prompt: string;
  tools: ToolDef[];
  maxSteps: number;
  model?: string;
  callTool: (name: string, args: Record<string, unknown>) => Promise<string>;
  signal?: AbortSignal;
}

export interface LoopResult {
  text: string;
  steps: number;
  toolsUsed: string[];
}

export type ProviderId = "groq" | "anthropic" | "gemini";
export const PROVIDER_ORDER: ProviderId[] = ["groq", "gemini", "anthropic"];

const MAX_TOOL_OUTPUT = 12_000;

const DEFAULT_MODEL: Record<ProviderId, () => string> = {
  groq: () => process.env.GROQ_MODEL || "openai/gpt-oss-120b",
  anthropic: () => process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
  gemini: () => process.env.GEMINI_MODEL || "gemini-2.5-flash",
};
const KEY_ENV: Record<ProviderId, string> = { groq: "GROQ_API_KEY", anthropic: "ANTHROPIC_API_KEY", gemini: "GEMINI_API_KEY" };
export const PROVIDER_LABEL: Record<ProviderId, string> = { groq: "Groq", anthropic: "Anthropic (Claude)", gemini: "Google Gemini" };

export const providerAvailable = (id: ProviderId): boolean => !!process.env[KEY_ENV[id]]?.trim();
export const providerModel = (id: ProviderId): string => DEFAULT_MODEL[id]();

/** Provedor que o "auto" tenta primeiro (AI_PROVIDER no .env; padrao: a ordem fixa groq, gemini, anthropic). */
export function preferredProvider(): ProviderId | "auto" {
  const v = (process.env.AI_PROVIDER ?? "").trim().toLowerCase();
  return v in KEY_ENV ? (v as ProviderId) : "auto";
}

/** Provedores com chave, na ordem em que o "auto" tenta (o preferido primeiro; os outros servem de reserva). */
export function autoCandidates(): ProviderId[] {
  const pref = preferredProvider();
  const order = pref === "auto" ? PROVIDER_ORDER : [pref, ...PROVIDER_ORDER.filter((p) => p !== pref)];
  return order.filter(providerAvailable);
}

export function resolveProvider(choice: string | undefined): ProviderId {
  if (choice && choice !== "auto") {
    if (!(choice in KEY_ENV)) throw new Error(`provedor desconhecido: ${choice}`);
    if (!providerAvailable(choice as ProviderId)) throw new Error(`${PROVIDER_LABEL[choice as ProviderId]} sem chave: cadastre em "Provedores de IA" (menu lateral) ou preencha ${KEY_ENV[choice as ProviderId]} no .env`);
    return choice as ProviderId;
  }
  const first = autoCandidates()[0];
  if (!first) throw new Error('nenhuma chave de IA configurada: cadastre uma em "Provedores de IA" (menu lateral) ou preencha GROQ_API_KEY, GEMINI_API_KEY ou ANTHROPIC_API_KEY no .env');
  return first;
}

/** Erro de provedor que vale tentar em outro: limite de taxa/cota, servico ocupado ou fora do ar. */
export const isRetryableProviderError = (err: unknown): boolean => /^(429|500|502|503|504)\b|rate limit|quota|overloaded|resource.?exhausted|timed? ?out|timeout/i.test(err instanceof Error ? err.message : String(err));

/** Quanto esperar antes de tentar de novo: cabecalho Retry-After ou o aviso no corpo ("try again in 1.71s", "retry in 26s", "retryDelay": "26s"). */
export function retryDelayMs(retryAfter: string | null, body: string): number | undefined {
  const header = Number(retryAfter);
  if (retryAfter && Number.isFinite(header) && header >= 0) return Math.ceil(header * 1000);
  const m = /(?:try again|retry) in\s+(?:(\d+)m)?\s*([\d.]+)s/i.exec(body) ?? /"retryDelay":\s*"([\d.]+)s"/.exec(body);
  if (!m) return undefined;
  const secs = m.length === 3 ? Number(m[1] ?? 0) * 60 + Number(m[2]) : Number(m[1]);
  return Number.isFinite(secs) ? Math.ceil(secs * 1000) : undefined;
}

const MAX_WAIT_MS = 25_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function postJson(url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal): Promise<Record<string, any>> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
    });
    const text = await res.text();
    if (res.ok) return JSON.parse(text);
    // limite de taxa / servico ocupado: espera o tempo que o provedor pediu e tenta de novo (free tiers);
    // pedido longo demais para esperar vira erro na hora (no "auto", o proximo provedor assume)
    if ((res.status === 429 || res.status === 503) && attempt < 3) {
      const wait = retryDelayMs(res.headers.get("retry-after"), text) ?? 2500 * (attempt + 1);
      if (wait <= MAX_WAIT_MS) {
        await sleep(wait + 300);
        continue;
      }
    }
    let detail = text.slice(0, 400);
    try {
      const j = JSON.parse(text);
      detail = j.error?.message ?? j.message ?? detail;
    } catch {
      // texto puro
    }
    throw new Error(`${res.status}: ${detail}`);
  }
}

const cut = (s: string) => (s.length > MAX_TOOL_OUTPUT ? `${s.slice(0, MAX_TOOL_OUTPUT)}… (cortado)` : s);

async function runTools(
  calls: Array<{ id: string; name: string; args: Record<string, unknown> }>,
  args: LoopArgs,
  used: Set<string>
): Promise<string[]> {
  const out: string[] = [];
  for (const call of calls) {
    used.add(call.name);
    try {
      out.push(cut(await args.callTool(call.name, call.args)));
    } catch (err) {
      out.push(`erro: ${err instanceof Error ? err.message : err}`);
    }
  }
  return out;
}

// ------------------------------------------------------------------ Groq (OpenAI compat)

async function groqLoop(a: LoopArgs): Promise<LoopResult> {
  const messages: Array<Record<string, unknown>> = [
    { role: "system", content: a.system },
    { role: "user", content: a.prompt },
  ];
  const used = new Set<string>();
  const tools = a.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description.slice(0, 500), parameters: t.parameters } }));
  for (let step = 1; step <= a.maxSteps; step++) {
    const data = await postJson(
      "https://api.groq.com/openai/v1/chat/completions",
      { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      { model: a.model || providerModel("groq"), messages, ...(tools.length ? { tools, tool_choice: "auto" } : {}) },
      a.signal
    );
    const msg = data.choices?.[0]?.message ?? {};
    const calls = (msg.tool_calls ?? []) as Array<{ id: string; function: { name: string; arguments: string } }>;
    if (!calls.length) return { text: String(msg.content ?? "").trim(), steps: step, toolsUsed: [...used] };
    messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: calls });
    const parsed = calls.map((c) => ({ id: c.id, name: c.function.name, args: safeJson(c.function.arguments) }));
    const results = await runTools(parsed, a, used);
    parsed.forEach((c, i) => messages.push({ role: "tool", tool_call_id: c.id, content: results[i] }));
  }
  return { text: "(o agente atingiu o limite de passos sem uma resposta final)", steps: a.maxSteps, toolsUsed: [...used] };
}

// ------------------------------------------------------------------ Anthropic

async function anthropicLoop(a: LoopArgs): Promise<LoopResult> {
  const messages: Array<Record<string, unknown>> = [{ role: "user", content: a.prompt }];
  const used = new Set<string>();
  const tools = a.tools.map((t) => ({ name: t.name, description: t.description.slice(0, 500), input_schema: t.parameters }));
  for (let step = 1; step <= a.maxSteps; step++) {
    const data = await postJson(
      "https://api.anthropic.com/v1/messages",
      { "x-api-key": String(process.env.ANTHROPIC_API_KEY), "anthropic-version": "2023-06-01" },
      { model: a.model || providerModel("anthropic"), max_tokens: 4096, system: a.system, messages, ...(tools.length ? { tools } : {}) },
      a.signal
    );
    const blocks = (data.content ?? []) as Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
    const calls = blocks.filter((b) => b.type === "tool_use");
    if (!calls.length) return { text: blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim(), steps: step, toolsUsed: [...used] };
    messages.push({ role: "assistant", content: blocks });
    const results = await runTools(calls.map((c) => ({ id: c.id!, name: c.name!, args: c.input ?? {} })), a, used);
    messages.push({ role: "user", content: calls.map((c, i) => ({ type: "tool_result", tool_use_id: c.id, content: results[i] })) });
  }
  return { text: "(o agente atingiu o limite de passos sem uma resposta final)", steps: a.maxSteps, toolsUsed: [...used] };
}

// ------------------------------------------------------------------ Gemini

/** Gemini aceita so um subconjunto de JSON Schema. */
function cleanSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return schema;
  const s = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of ["type", "description", "enum", "format", "required", "nullable"]) if (k in s) out[k] = s[k];
  if (s.properties && typeof s.properties === "object") out.properties = Object.fromEntries(Object.entries(s.properties as Record<string, unknown>).map(([k, v]) => [k, cleanSchema(v)]));
  if (s.items) out.items = cleanSchema(s.items);
  return out;
}

async function geminiLoop(a: LoopArgs): Promise<LoopResult> {
  const contents: Array<Record<string, unknown>> = [{ role: "user", parts: [{ text: a.prompt }] }];
  const used = new Set<string>();
  const decls = a.tools.map((t) => {
    const hasParams = t.parameters && typeof t.parameters === "object" && Object.keys((t.parameters as { properties?: object }).properties ?? {}).length > 0;
    return { name: t.name, description: t.description.slice(0, 500), ...(hasParams ? { parameters: cleanSchema(t.parameters) } : {}) };
  });
  const model = a.model || providerModel("gemini");
  for (let step = 1; step <= a.maxSteps; step++) {
    const data = await postJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      { "x-goog-api-key": String(process.env.GEMINI_API_KEY) },
      { systemInstruction: { parts: [{ text: a.system }] }, contents, ...(decls.length ? { tools: [{ functionDeclarations: decls }] } : {}) },
      a.signal
    );
    const parts = (data.candidates?.[0]?.content?.parts ?? []) as Array<{ text?: string; functionCall?: { name: string; args?: Record<string, unknown> } }>;
    const calls = parts.filter((p) => p.functionCall);
    if (!calls.length) return { text: parts.map((p) => p.text ?? "").join("").trim(), steps: step, toolsUsed: [...used] };
    contents.push({ role: "model", parts });
    const results = await runTools(calls.map((c, i) => ({ id: String(i), name: c.functionCall!.name, args: c.functionCall!.args ?? {} })), a, used);
    contents.push({ role: "user", parts: calls.map((c, i) => ({ functionResponse: { name: c.functionCall!.name, response: { result: results[i] } } })) });
  }
  return { text: "(o agente atingiu o limite de passos sem uma resposta final)", steps: a.maxSteps, toolsUsed: [...used] };
}

function safeJson(text: string): Record<string, unknown> {
  try {
    const v = JSON.parse(text || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export async function runLoop(provider: ProviderId, args: LoopArgs): Promise<LoopResult> {
  switch (provider) {
    case "groq":
      return groqLoop(args);
    case "anthropic":
      return anthropicLoop(args);
    case "gemini":
      return geminiLoop(args);
  }
}
