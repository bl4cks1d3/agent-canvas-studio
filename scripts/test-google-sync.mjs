// Testes offline (sem servidor, sem conta Google) do que le o texto do Google e decide a sincronizacao de tarefas.
// Uso: node scripts/test-google-sync.mjs   (o Node 22.6+ executa os .ts direto)
import { createdTaskId, googleProblem, parseCalendars, parseEvents, parseTasks } from "../packages/server/src/integrations/google-parse.ts";
import { planSync } from "../packages/server/src/integrations/tasks-sync-plan.ts";

let failures = 0;
const check = (n, c, x = "") => {
  console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  -> " + String(x).slice(0, 200) : ""}`);
  if (!c) failures++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ------------------------------------------------------------ leitura do texto do Google
const tarefasTxt = `Tasks in list @default for user@example.com:
- Tirar a louça (ID: T1)
  Status: needsAction
  Due: 2026-09-21T00:00:00.000Z
- Comprar pão (ID: T2)
  Status: completed
  Completed: 2026-09-19T12:00:00.000Z
- Sem prazo (ID: T3)
  Status: needsAction
`;
const t = parseTasks(tarefasTxt);
check("tarefas: 3 itens com id, titulo, status e prazo (so a data)", t.length === 3 && same(t[0], { title: "Tirar a louça", id: "T1", status: "open", due: "2026-09-21" }), JSON.stringify(t[0]));
check("tarefas: concluida traz completedAt e status done", t[1].status === "done" && t[1].completedAt === "2026-09-19T12:00:00.000Z");
check("tarefas: sem prazo fica sem due", t[2].due === undefined && t[2].status === "open");
check("tarefas: texto sem tarefas -> lista vazia", parseTasks("No tasks found.").length === 0);

const eventosTxt = `Successfully retrieved 3 events from calendar 'primary':
- "Dentista" (Starts: 2026-09-22T10:00:00-03:00, Ends: 2026-09-22T11:00:00-03:00) ID: ev1 | Link: x
- "Feriado" (Starts: 2026-09-25, Ends: 2026-09-26) ID: ev2
- "Reunião" (Starts: 2026-09-23T09:00:00-03:00 [America/Sao_Paulo], Ends: 2026-09-23T09:30:00-03:00 [America/Sao_Paulo]) ID: ev3 Meeting: https://meet.google.com/abc
`;
const e = parseEvents(eventosTxt, "primary");
check("eventos: 3 itens estruturados", e.length === 3 && e[0].title === "Dentista" && e[0].id === "ev1" && e[0].allDay === false && e[0].start === "2026-09-22T10:00:00-03:00", JSON.stringify(e[0]));
check("eventos: dia inteiro e reuniao com Meet", e[1].allDay === true && e[2].meet === true && e[2].start === "2026-09-23T09:00:00-03:00");
const c = parseCalendars(`Calendars:\n- "Ana" (Primary) (ID: ana@x.com)\n- "Família" (ID: fam123@group.calendar.google.com)\n`);
check("agendas: principal vira id primary", c.length === 2 && c[0].id === "primary" && c[0].primary && c[1].id === "fam123@group.calendar.google.com" && c[1].name === "Família");
check("problema: pedido de login detectado", /login/i.test(googleProblem("Please authorize at https://accounts.google.com/o/oauth2/x") ?? ""));
check("problema: erro do Google detectado", !!googleProblem("Error: 404 not found"));
check("problema: resposta normal nao e problema", googleProblem(tarefasTxt) === undefined);
check("id da tarefa criada", createdTaskId("Created task 'X' (ID: abc123)") === "abc123" && createdTaskId("ok") === undefined);

// ------------------------------------------------------------ plano de sincronizacao
const hoje = "2026-09-20";
const G = (id, status = "open", title = "t" + id, due) => ({ id, title, status, due });
const L = (id, o = {}) => ({ id, titulo: "l" + id, feito: false, ...o });

let p = planSync([G("g1", "open", "Nova", "2026-10-01"), G("g2", "done", "Velha")], [], { today: hoje });
check("importa so tarefa ABERTA do Google (nada de historico)", p.localCreates.length === 1 && same(p.localCreates[0], { titulo: "Nova", prazo: "2026-10-01", google_id: "g1" }));

p = planSync([], [L("a"), L("b", { feito: true }), L("c", { titulo: "  " })], { today: hoje });
check("local aberta sem vinculo vai para o Google; feita e sem titulo nao", p.googleCreates.length === 1 && p.googleCreates[0].localId === "a" && p.googleCreates[0].title === "la");
p = planSync([], [L("a")], { today: hoje, push: false });
check("push=false: nao envia nada ao Google", p.googleCreates.length === 0);

p = planSync([G("g1", "done")], [L("a", { google_id: "g1", google_sync: "aberta" })], { today: hoje });
check("concluida no Google -> conclui o local (com data)", p.localUpdates.length === 1 && p.localUpdates[0].data.feito === true && p.localUpdates[0].data.concluido_em === hoje && p.googleSets.length === 0);
p = planSync([G("g1", "open")], [L("a", { google_id: "g1", google_sync: "feita", feito: true })], { today: hoje });
check("reaberta no Google -> reabre o local e limpa concluido_em", p.localUpdates[0].data.feito === false && p.localUpdates[0].data.concluido_em === null);
p = planSync([G("g1", "open")], [L("a", { google_id: "g1", google_sync: "aberta", feito: true })], { today: hoje });
check("concluida no app -> conclui no Google", same(p.googleSets, [{ googleId: "g1", localId: "a", done: true }]) && p.localUpdates[0].data.google_sync === "feita");
p = planSync([G("g1", "done")], [L("a", { google_id: "g1", google_sync: "feita", feito: false })], { today: hoje });
check("reaberta no app -> reabre no Google", same(p.googleSets, [{ googleId: "g1", localId: "a", done: false }]));
p = planSync([G("g1", "done")], [L("a", { google_id: "g1" })], { today: hoje });
check("sem sincronizacao anterior, 'concluida' vence (nao reabre o que alguem fechou)", p.localUpdates[0].data.feito === true && p.googleSets.length === 0);
p = planSync([G("g1", "open")], [L("a", { google_id: "g1", feito: true })], { today: hoje });
check("sem sincronizacao anterior, feita no app conclui no Google", p.googleSets.length === 1 && p.googleSets[0].done === true);
p = planSync([G("g1", "open")], [L("a", { google_id: "g1", google_sync: "aberta" })], { today: hoje });
check("em sincronia: nada a fazer", p.localUpdates.length + p.googleSets.length + p.googleCreates.length + p.localCreates.length === 0);
p = planSync([G("g1", "open")], [L("a", { google_id: "g1" })], { today: hoje });
check("em sincronia mas sem marca: so grava a marca", p.localUpdates.length === 1 && p.localUpdates[0].data.google_sync === "aberta" && p.googleSets.length === 0);
p = planSync([], [L("a", { google_id: "sumiu" })], { today: hoje });
check("vinculada a tarefa que sumiu do Google: nao recria nem apaga", p.googleCreates.length === 0 && p.localUpdates.length === 0);
p = planSync([G("g1", "open", "X")], [L("a", { google_id: "g1", google_sync: "aberta", titulo: "Outro titulo" })], { today: hoje });
check("nunca sobrescreve titulo de tarefa vinculada", p.localUpdates.length === 0 && p.googleSets.length === 0);
p = planSync([G("g1", "open", "Tirar a louça")], [L("a", { titulo: "  tirar a LOUCA " })], { today: hoje });
check("mesma tarefa nos dois lados (o caso 'Tirar a louça'): VINCULA, sem duplicar em nenhum lado", p.localCreates.length === 0 && p.googleCreates.length === 0 && same(p.localUpdates, [{ id: "a", data: { google_id: "g1", google_sync: "aberta" } }]), JSON.stringify(p));
p = planSync([G("g1", "open", "Louça"), G("g2", "open", "Louça")], [L("a", { titulo: "Louça" })], { today: hoje });
check("titulos repetidos: 1 vinculo por tarefa (o outro do Google vira local)", p.localUpdates.length === 1 && p.localCreates.length === 1 && p.localCreates[0].google_id === "g2");
p = planSync([G("g1", "open", "Louça")], [L("a", { titulo: "Louça", feito: true })], { today: hoje });
check("local JA FEITA + Google aberta com o mesmo titulo (tarefa recorrente): nao vincula nem fecha a nova", p.googleSets.length === 0 && p.localCreates.length === 1);

console.log(failures ? `\n${failures} FALHA(S)` : "\nTODOS OS TESTES PASSARAM");
process.exit(failures ? 1 : 0);
