import { api } from "./api";

export interface GoogleStatus {
  uv: boolean;
  hasCredentials: boolean;
  email: string;
  configured: boolean;
  running: boolean;
  tools: number;
  error?: string;
  packageInstalled: boolean;
  mapped: Array<{ id: string; label: string; tool: string | null }>;
}

export interface GoogleProbe {
  ok: boolean;
  needsAuth: boolean;
  url?: string;
  message: string;
}

export const googleStatus = () => api<GoogleStatus>("/integrations/google");
export const googleSetup = (body: { email: string; clientId?: string; clientSecret?: string }) => api<GoogleStatus>("/integrations/google/setup", { method: "POST", body: JSON.stringify(body) });
export const googleRefresh = () => api<GoogleStatus>("/integrations/google/refresh", { method: "POST" });
export const googleAuthorize = () => api<{ url?: string; message: string }>("/integrations/google/authorize", { method: "POST" });
export const googleTest = () => api<GoogleProbe>("/integrations/google/test", { method: "POST" });
export const googleDisconnect = () => api<GoogleStatus>("/integrations/google", { method: "DELETE" });

// ---- Provedores de IA (nenhuma resposta traz a chave; so se ela existe) ----

export type AiProviderId = "groq" | "gemini" | "anthropic";

export interface AiProviderStatus {
  id: AiProviderId;
  label: string;
  hasKey: boolean;
  model: string;
  customModel: boolean;
}

export interface AiStatus {
  preferred: AiProviderId | "auto";
  providers: AiProviderStatus[];
  claude: { installed: boolean; version?: string };
}

export const aiStatus = () => api<AiStatus>("/integrations/ai");
export const aiSave = (id: AiProviderId, body: { apiKey?: string; model?: string; remove?: boolean }) => api<AiStatus>(`/integrations/ai/${id}`, { method: "PUT", body: JSON.stringify(body) });
export const aiSetPreferred = (preferred: AiProviderId | "auto") => api<AiStatus>("/integrations/ai/preferred", { method: "PUT", body: JSON.stringify({ preferred }) });
export const aiTest = (id: AiProviderId, model?: string) => api<{ ok: boolean; ms: number; model: string; message: string }>(`/integrations/ai/${id}/test`, { method: "POST", body: JSON.stringify({ model }) });
export const aiModels = (id: AiProviderId) => api<{ models: string[] }>(`/integrations/ai/${id}/models`);

// ---- Outras chaves privadas (a API so devolve os nomes, nunca os valores) ----

export const keysList = () => api<{ keys: string[] }>("/integrations/keys");
export const keysSave = (name: string, value: string) => api<{ keys: string[] }>("/integrations/keys", { method: "PUT", body: JSON.stringify({ name, value }) });
export const keysRemove = (name: string) => api<{ keys: string[] }>(`/integrations/keys/${encodeURIComponent(name)}`, { method: "DELETE" });
export const reloadTools = () => api<{ servers: number; tools: number }>("/tools/reload", { method: "POST" });

/** Lê o client_secret_*.json baixado do Google Cloud (chave "installed" ou "web"). O conteúdo só passa por aqui e vai direto ao servidor local. */
export function parseGoogleClientFile(raw: string): { clientId: string; clientSecret: string; type: "installed" | "web" } {
  let json: { installed?: Record<string, unknown>; web?: Record<string, unknown> };
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("O arquivo não é um JSON válido.");
  }
  const type = json.installed ? "installed" : json.web ? "web" : null;
  const c = type ? json[type] : undefined;
  if (!type || typeof c?.client_id !== "string" || typeof c?.client_secret !== "string") {
    throw new Error("Este arquivo não parece o client_secret do Google (falta client_id/client_secret). Baixe-o de novo em Credenciais → ID do cliente OAuth → Fazer download do JSON.");
  }
  return { clientId: c.client_id, clientSecret: c.client_secret, type };
}
