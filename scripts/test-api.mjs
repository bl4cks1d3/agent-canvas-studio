// Testes de ponta a ponta da API (servidor em http://localhost:5100). Usa a IA de verdade nas execucoes reais
// (poucos tokens). Uso: node scripts/test-api.mjs
const S = process.env.SERVER_URL ?? "http://localhost:5100";
let failures = 0;
const check = (n, c, x = "") => {
  console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  -> " + String(x).slice(0, 220) : ""}`);
  if (!c) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = async (m, p, b) => {
  const r = await fetch(S + p, { method: m, headers: { "Content-Type": "application/json" }, body: b === undefined ? undefined : JSON.stringify(b) });
  const t = await r.text();
  let json = null;
  try { json = JSON.parse(t); } catch {}
  return { status: r.status, json, text: t };
};
const created = [];
const waitRun = async (runId, ms = 90000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const r = (await call("GET", `/runs/${runId}`)).json;
    if (r.status !== "running") return r;
    await sleep(700);
  }
  throw new Error("execução não terminou a tempo");
};
const make = async (body) => {
  const r = await call("POST", "/canvases", body);
  if (r.json?.id) created.push(r.json.id);
  return r;
};

// ------------------------------------------------------------ catálogo
let r = await call("GET", "/catalog");
check("catálogo: 11 tipos de nó (com Notificar), ferramentas embutidas, provedores (3 de IA + Claude Code) e Claude Code", r.json?.nodes?.length === 11 && r.json.nodes.some((n) => n.type === "action.notify") && r.json.tools.some((t) => t.name === "get_time") && r.json.tools.some((t) => t.name === "notify") && r.json.providers.length === 4 && r.json.providers.some((p) => p.id === "claude-code") && typeof r.json.claude.installed === "boolean", `${r.json?.nodes?.length} nós, ${r.json?.tools?.length} ferramentas, groq=${r.json?.providers?.find((p) => p.id === "groq")?.available}`);
const hasAI = r.json?.providers?.some((p) => p.available);

// ------------------------------------------------------------ validação (agente = estrito)
const start = { id: "pedido", type: "input.prompt", name: "Pedido", config: { text: "Diga olá." } };
r = await make({ name: "ZZ ruim", source: "agent", nodes: [start, { id: "a", type: "agent.llm", config: { instructions: "x", tools: ["ferramenta_que_nao_existe"] } }], edges: [{ from: "pedido", to: "a" }] });
check("ferramenta inexistente no agente => 400", r.status === 400 && /ferramenta_que_nao_existe/.test(r.text), r.text);
r = await make({ name: "ZZ ruim", source: "agent", nodes: [start, { id: "t", type: "tool.call", config: { tool: "fs_read", args: { caminho: "x" } } }], edges: [{ from: "pedido", to: "t" }] });
check("parâmetro errado em tool.call => 400 com a dica", r.status === 400 && /caminho/.test(r.text) && /path/.test(r.text), r.text);
r = await make({ name: "ZZ ruim", source: "agent", nodes: [start, { id: "a", type: "agent.llm", config: { instructions: "" } }], edges: [{ from: "pedido", to: "a" }] });
check("agente sem instruções => 400", r.status === 400 && /Instruções/.test(r.text), r.text);
r = await make({ name: "ZZ ciclo", source: "agent", nodes: [{ id: "a", type: "agent.llm", config: { instructions: "x" } }, { id: "b", type: "agent.llm", config: { instructions: "y" } }], edges: [{ from: "a", to: "b" }, { from: "b", to: "a" }] });
check("ciclo => 400", r.status === 400 && /ciclo/.test(r.text), r.text);
r = await make({ name: "ZZ claude", source: "agent", nodes: [start, { id: "c", type: "agent.claude", config: { instructions: "x", allowedTools: "Bash" } }], edges: [{ from: "pedido", to: "c" }] });
check("Claude Code com Bash (sem liberar no .env) => 400", r.status === 400 && /Bash/.test(r.text), r.text);
r = await make({ name: "ZZ ruim", source: "user", nodes: [start, { id: "a", type: "agent.llm", config: {} }], edges: [{ from: "pedido", to: "a" }] });
check("editor (tolerante) salva com problemas e devolve a lista", (r.status === 201 || r.status === 200) && r.json?.problems?.length > 0, JSON.stringify(r.json?.problems));

// ------------------------------------------------------------ ferramentas puras (sem IA): escreve, lê, decide
const chain = await make({
  name: "ZZ ferramentas",
  source: "agent",
  nodes: [
    start,
    { id: "gravar", type: "tool.call", name: "Gravar", config: { tool: "fs_write", args: { path: "zz/teste.txt", content: "arquivo: {{json.text}}" } } },
    { id: "ler", type: "tool.call", name: "Ler", config: { tool: "fs_read", args: { path: "zz/teste.txt" } } },
    { id: "se", type: "logic.if", name: "Tem 'arquivo'?", config: { condition: 'json.text contains "arquivo"' } },
    { id: "fim", type: "output.result", name: "Resultado", config: { title: "ok" } },
    { id: "nada", type: "note", name: "Nota", config: { text: "sem entrada" } },
  ],
  edges: [{ from: "pedido", to: "gravar" }, { from: "gravar", to: "ler" }, { from: "ler", to: "se" }, { from: "se", fromPort: "true", to: "fim" }],
});
check("cria canvas de ferramentas como agente (sem problemas)", chain.json?.problems?.length === 0 && !!chain.json?.id, chain.text);
const cid = chain.json.id;
r = await call("POST", `/canvases/${cid}/run`, { mode: "live", input: "olá mundo" });
check("execução real SEM confirmação => 400", r.status === 400 && /confirma/.test(r.text), r.text);
r = await call("POST", `/canvases/${cid}/run`, { mode: "dry", input: "olá mundo" });
let run = await waitRun(r.json.id);
check("simulação: escrita é simulada, leitura roda de verdade", run.status === "ok" && run.nodes.find((n) => n.nodeId === "gravar")?.status === "simulated", JSON.stringify(run.nodes.map((n) => n.nodeId + ":" + n.status)));
r = await call("POST", `/canvases/${cid}/run`, { mode: "live", confirmed: true, input: "olá mundo" });
run = await waitRun(r.json.id);
check("execução real: grava, lê, decide e entrega o resultado", run.status === "ok" && /arquivo: olá mundo/.test(run.result ?? ""), `${run.status} ${run.error ?? ""} ${run.result}`);
check("dados por nó: 'Se' separou (true=1,false=0)", run.nodes.find((n) => n.nodeId === "se")?.itemsOut.true === 1 && run.nodes.find((n) => n.nodeId === "se")?.itemsOut.false === 0);
check("execução real atualiza o 'último resultado' do canvas", (await call("GET", `/canvases/${cid}`)).json?.lastStatus === "ok");
const empty = await make({ name: "ZZ vazio", source: "agent", nodes: [{ id: "pedido", type: "input.prompt", name: "Pedido", config: {} }, { id: "fim", type: "output.result", name: "Resultado", config: {} }], edges: [{ from: "pedido", to: "fim" }] });
r = await call("POST", `/canvases/${empty.json.id}/run`, { mode: "live", confirmed: true, input: "" });
run = await waitRun(r.json.id);
check("pedido vazio => a execução termina com erro claro", run.status === "error" && /pedido está vazio/.test(run.error ?? ""), run.error);

// ------------------------------------------------------------ agentes de verdade (IA)
if (!hasAI) {
  console.log("SKIP  sem chave de IA no .env: testes com agentes reais pulados");
} else {
  const team = await make({
    name: "ZZ equipe",
    source: "agent",
    nodes: [
      { id: "pedido", type: "input.prompt", name: "Pedido", config: { text: "Qual é a data de hoje?" } },
      { id: "pesq", type: "agent.llm", name: "Pesquisador", config: { instructions: "Use a ferramenta get_time para responder o pedido em UMA frase curta.", tools: ["get_time"], maxSteps: 4 } },
      { id: "resumo", type: "agent.llm", name: "Redator", config: { instructions: "Reescreva o que recebeu em no máximo 12 palavras, sem mudar os fatos.", maxSteps: 2 } },
      { id: "fim", type: "output.result", name: "Resultado", config: {} },
    ],
    edges: [{ from: "pedido", to: "pesq" }, { from: "pesq", to: "resumo" }, { from: "resumo", to: "fim" }],
  });
  check("cria equipe de 2 agentes ligados", !!team.json?.id && team.json.problems.length === 0, team.text);
  r = await call("POST", `/canvases/${team.json.id}/run`, { mode: "dry" });
  run = await waitRun(r.json.id);
  check("simulação de agentes não gasta IA (nós 'simulated')", run.status === "ok" && run.nodes.filter((n) => n.type === "agent.llm").every((n) => n.status === "simulated"));
  r = await call("POST", `/canvases/${team.json.id}/run`, { mode: "live", confirmed: true });
  run = await waitRun(r.json.id);
  const pesq = run.nodes.find((n) => n.nodeId === "pesq");
  const resumo = run.nodes.find((n) => n.nodeId === "resumo");
  check("agentes reais rodam em cadeia e entregam o resultado", run.status === "ok" && (run.result ?? "").length > 5, `${run.status} ${run.error ?? ""} | ${run.result}`);
  check("o 1º agente usou a ferramenta get_time (laço de ferramentas)", pesq?.toolsUsed?.includes("get_time") && (pesq.steps ?? 0) >= 2, JSON.stringify({ steps: pesq?.steps, tools: pesq?.toolsUsed }));
  check("o 2º agente recebeu a saída do 1º (itemsIn=1) e não usou ferramentas", resumo?.itemsIn === 1 && !(resumo.toolsUsed?.length));

  // fan-out / fan-in: dois agentes leem o mesmo pedido, um terceiro recebe os dois
  const fan = await make({
    name: "ZZ fan",
    source: "agent",
    nodes: [
      { id: "pedido", type: "input.prompt", name: "Pedido", config: { text: "Tema: café" } },
      { id: "a", type: "agent.llm", name: "Otimista", config: { instructions: "Escreva UMA frase otimista sobre o tema.", maxSteps: 1 } },
      { id: "b", type: "agent.llm", name: "Cético", config: { instructions: "Escreva UMA frase cética sobre o tema.", maxSteps: 1 } },
      { id: "juiz", type: "agent.llm", name: "Juiz", config: { instructions: "Você recebeu duas opiniões. Diga em uma frase qual é mais convincente.", maxSteps: 1 } },
    ],
    edges: [{ from: "pedido", to: "a" }, { from: "pedido", to: "b" }, { from: "a", to: "juiz" }, { from: "b", to: "juiz" }],
  });
  r = await call("POST", `/canvases/${fan.json.id}/run`, { mode: "live", confirmed: true });
  run = await waitRun(r.json.id);
  check("fan-in: o Juiz recebeu os dois pareceres (itemsIn=2)", run.status === "ok" && run.nodes.find((n) => n.nodeId === "juiz")?.itemsIn === 2, `${run.status} ${run.error ?? ""} | in=${run.nodes.find((n) => n.nodeId === "juiz")?.itemsIn}`);
  check("sem nó Resultado, o resultado é a fala do último agente", (run.result ?? "").length > 5);
}

// ------------------------------------------------------------ cancelar e limpeza
for (const id of created) await call("DELETE", `/canvases/${id}`);
r = await call("GET", "/canvases");
check("limpeza: nenhum canvas ZZ sobrando", !(r.json ?? []).some((c) => c.name.startsWith("ZZ")));
console.log(failures ? `${failures} FALHA(S)` : "TODOS PASSARAM");
process.exit(failures ? 1 : 0);
