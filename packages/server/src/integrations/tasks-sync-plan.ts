// Planejador da sincronizacao entre as tarefas locais (colecao rotina_tarefas) e o Google Tasks. So decide O QUE fazer (funcao pura,
// testada por scripts/test-google-sync.mjs); quem executa e o GoogleTasksService. Regras:
//  - o vinculo e o campo local `google_id` (na 1a vez, tarefa ABERTA local e ABERTA no Google com o MESMO titulo sao vinculadas, sem duplicar); `google_sync` guarda o ultimo estado igual nos dois lados ("aberta" | "feita");
//  - concluir/reabrir de um lado vai para o outro (quem mudou desde a ultima sincronizacao);
//  - tarefa aberta do Google que nao existe aqui vira registro local; tarefa local aberta sem vinculo vai para o Google;
//  - nunca apaga nada de nenhum lado, nem sobrescreve titulo/prazo de tarefa ja vinculada;
//  - sem historico: a 1a sincronizacao so importa tarefas ABERTAS do Google.
import type { GoogleTask } from "./google-parse";

export interface LocalTask {
  id: string;
  titulo?: string;
  prazo?: string;
  feito?: boolean;
  google_id?: string;
  google_sync?: string;
}

export interface SyncPlan {
  /** Tarefas do Google que ainda nao existem aqui. */
  localCreates: Array<{ titulo: string; prazo?: string; google_id: string }>;
  /** Tarefas locais a atualizar (estado e vinculo). */
  localUpdates: Array<{ id: string; data: { feito?: boolean; google_sync?: string; google_id?: string; concluido_em?: string | null } }>;
  /** Tarefas locais sem vinculo que vao ser criadas no Google. */
  googleCreates: Array<{ localId: string; title: string; due?: string }>;
  /** Concluir/reabrir no Google. */
  googleSets: Array<{ googleId: string; localId: string; done: boolean }>;
}

const state = (done: boolean) => (done ? "feita" : "aberta");

/** Titulo comparavel: sem acento, caixa e espacos repetidos ("Tirar a louça " = "tirar a louca"). */
const norm = (s: string | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export function planSync(google: GoogleTask[], local: LocalTask[], opts: { today: string; push?: boolean } = { today: "" }): SyncPlan {
  const plan: SyncPlan = { localCreates: [], localUpdates: [], googleCreates: [], googleSets: [] };
  const byGoogleId = new Map(local.filter((l) => l.google_id).map((l) => [l.google_id as string, l]));

  // 1a vez: a mesma tarefa que ja existe nos dois lados (aberta em ambos, mesmo titulo) e VINCULADA, nao duplicada
  const justLinked = new Set<string>();
  for (const g of google) {
    if (g.status !== "open" || byGoogleId.has(g.id)) continue;
    const match = local.find((l) => !l.google_id && l.feito !== true && !justLinked.has(l.id) && norm(l.titulo) !== "" && norm(l.titulo) === norm(g.title));
    if (!match) continue;
    justLinked.add(match.id);
    byGoogleId.set(g.id, { ...match, google_id: g.id, google_sync: "aberta" });
    plan.localUpdates.push({ id: match.id, data: { google_id: g.id, google_sync: "aberta" } });
  }

  for (const g of google) {
    const l = byGoogleId.get(g.id);
    if (!l) {
      if (g.status === "open") plan.localCreates.push({ titulo: g.title, prazo: g.due, google_id: g.id });
      continue;
    }
    const gDone = g.status === "done";
    const lDone = l.feito === true;
    const last = l.google_sync; // undefined = nunca sincronizada
    if (gDone === lDone) {
      if (last !== state(gDone)) plan.localUpdates.push({ id: l.id, data: { google_sync: state(gDone) } });
      continue;
    }
    // os dois lados divergem: quem mudou em relacao a ultima sincronizacao manda.
    // Sem sincronizacao anterior, "concluida" vence (nunca reabre uma tarefa que alguem ja fechou).
    const googleChanged = last === undefined ? gDone : gDone !== (last === "feita");
    if (googleChanged) {
      plan.localUpdates.push({ id: l.id, data: { feito: gDone, google_sync: state(gDone), concluido_em: gDone ? opts.today : null } });
    } else {
      plan.googleSets.push({ googleId: g.id, localId: l.id, done: lDone });
      plan.localUpdates.push({ id: l.id, data: { google_sync: state(lDone) } });
    }
  }

  if (opts.push !== false) {
    for (const l of local) {
      if (justLinked.has(l.id)) continue;
      if (l.google_id) continue; // vinculada (ou a uma tarefa que sumiu do Google): nao recria nem apaga
      if (l.feito === true || !l.titulo?.trim()) continue; // so o que esta aberto vale ir para o Google
      plan.googleCreates.push({ localId: l.id, title: l.titulo.trim(), due: l.prazo });
    }
  }
  return plan;
}
