// Testes de ponta a ponta do Studio (servidor em http://localhost:5100): colecoes, componentes, estado, versoes, lint,
// tema, paginas do dashboard e pacotes. Usa o prefixo "zz" e limpa o que cria. Uso: node scripts/test-studio.mjs
const S = process.env.SERVER_URL ?? "http://localhost:5100";
let failures = 0;
const check = (n, c, x = "") => {
  console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  -> " + String(x).slice(0, 200) : ""}`);
  if (!c) failures++;
};
const call = async (m, p, b) => {
  const r = await fetch(S + p, { method: m, headers: { "Content-Type": "application/json" }, body: b === undefined ? undefined : JSON.stringify(b) });
  const t = await r.text();
  let json = null;
  try { json = JSON.parse(t); } catch {}
  return { status: r.status, json, text: t };
};
const msg = (r) => (Array.isArray(r.json?.message) ? r.json.message.join(" | ") : (r.json?.message ?? r.text));

const cleanup = { blocks: [], pages: [], collections: [], packages: [], notifications: [] };
let theme0;

try {
  // ------------------------------------------------------------ colecoes e registros
  let r = await call("POST", "/collections", { name: "zz_itens", label: "ZZ Itens", fields: [{ name: "titulo", type: "text", required: true }, { name: "qtd", type: "number" }, { name: "status", type: "select", options: ["a", "b"] }] });
  cleanup.collections.push("zz_itens");
  check("colecao: cria", r.status === 201 && r.json?.name === "zz_itens", msg(r));
  r = await call("POST", "/collections", { name: "zz_itens", fields: [] });
  check("colecao: nome repetido -> 409", r.status === 409);
  r = await call("POST", "/collections/zz_itens/records", { titulo: "Um", qtd: "3", status: "a" });
  check("registro: cria e converte numero", r.status === 201 && r.json?.qtd === 3, msg(r));
  const rec = r.json;
  r = await call("POST", "/collections/zz_itens/records", { qtd: 1 });
  check("registro: campo obrigatorio", r.status === 400, msg(r));
  r = await call("POST", "/collections/zz_itens/records", { titulo: "x", status: "zzz" });
  check("registro: select invalido", r.status === 400, msg(r));
  r = await call("PATCH", `/collections/zz_itens/records/${rec.id}`, { qtd: null });
  check("registro: null limpa o campo", r.status === 200 && r.json?.qtd === undefined && r.json?.titulo === "Um", msg(r));

  // ------------------------------------------------------------ componentes: consistencia, aprovacao, versoes, estado
  r = await call("POST", "/blocks", { name: "zz ruim", js: "studio.main(async c=>{})", permissions: { read: ["col:nao_existe_zz"] } });
  check("componente: colecao inexistente em permissions -> 400", r.status === 400 && /inexistente/i.test(msg(r)), msg(r));
  r = await call("POST", "/blocks", { name: "ZZ Bloco", html: '<div id="a"></div>', css: ".a{color:var(--ac-fg)}", js: "studio.main(async (ctx) => { await ctx.records('zz_itens').list(); });", permissions: { read: ["col:zz_itens"] }, source: "agent" });
  const blk = r.json;
  cleanup.blocks.push(blk?.id);
  check("componente do agente nasce SEM aprovacao e sem warnings", r.status === 201 && blk.approved === false && blk.warnings?.length === 0, JSON.stringify(blk?.warnings));
  r = await call("PUT", `/blocks/${blk.id}`, { css: ".a{color:#fff}", js: "fetch('x'); localStorage.a=1; studio.main(async c=>{ c.records('zz_itens').create({}) });", source: "agent", versionNote: "regressao" });
  check("lint avisa cor fixa, rede, storage e escrita sem permissao", r.json?.warnings?.length >= 4, JSON.stringify(r.json?.warnings?.map((w) => w.slice(0, 30))));
  r = await call("PATCH", `/blocks/${blk.id}/approve`, { approved: true });
  check("usuario aprova", r.status === 200 && r.json?.approved === true);
  r = await call("PUT", `/blocks/${blk.id}`, { js: "studio.main(async c=>{})", source: "user" });
  check("editar codigo revoga a aprovacao", r.json?.approved === false);
  r = await call("GET", `/blocks/${blk.id}/versions`);
  check("versoes: cada alteracao guarda a anterior", Array.isArray(r.json) && r.json.length === 2, r.json?.length);
  const first = r.json?.[r.json.length - 1];
  r = await call("POST", `/blocks/${blk.id}/versions/${first.id}/restore`);
  check("versoes: restaurar volta o design original", r.status === 201 && r.json?.css === ".a{color:var(--ac-fg)}", msg(r));
  r = await call("PUT", `/blocks/${blk.id}/state/filtro`, { value: { q: "abc", n: [1, 2] } });
  check("estado do componente: grava", r.status === 200);
  r = await call("GET", `/blocks/${blk.id}/state`);
  check("estado do componente: persiste", r.json?.filtro?.n?.[1] === 2, JSON.stringify(r.json));
  r = await call("PUT", `/blocks/${blk.id}/state/${encodeURIComponent("chave ruim!")}`, { value: 1 });
  check("estado: chave invalida -> 400", r.status === 400);
  r = await call("PUT", `/blocks/${blk.id}/state/grande`, { value: "x".repeat(70000) });
  check("estado: valor grande demais -> 400", r.status === 400);
  await call("DELETE", `/blocks/${blk.id}/state/filtro`);
  r = await call("GET", `/blocks/${blk.id}/state`);
  check("estado: remove", r.json?.filtro === undefined);

  // ------------------------------------------------------------ tema
  theme0 = (await call("GET", "/theme")).json;
  r = await call("PUT", "/theme", { accent: "#22aa66", radius: 6, fontSize: 14, density: "compact" });
  check("tema: salva tokens", r.status === 200 && r.json?.accent === "#22aa66" && r.json?.density === "compact", msg(r));
  r = await call("PUT", "/theme", { accent: "vermelho" });
  check("tema: cor invalida -> 400", r.status === 400);
  r = await call("PUT", "/theme", { radius: 99 });
  check("tema: raio fora do limite -> 400", r.status === 400);

  // ------------------------------------------------------------ paginas do dashboard
  r = await call("POST", "/pages", { name: "ZZ Pagina", layout: [{ kind: "heading", text: "Secao", x: 0, y: 0, w: 12, h: 1 }, { kind: "block", blockId: blk.id, x: 3, y: 1, w: 20, h: 9 }] });
  const page = r.json;
  cleanup.pages.push(page?.id);
  check("pagina: cria e ajusta a grade (w<=12, x+w<=12)", r.status === 201 && page.layout[1].w === 12 && page.layout[1].x === 0, JSON.stringify(page?.layout?.[1]));
  r = await call("POST", "/pages", { name: "x", layout: [{ kind: "block", blockId: "nao-existe", x: 0, y: 0, w: 4, h: 4 }] });
  check("pagina: componente inexistente -> 400", r.status === 400, msg(r));
  r = await call("POST", `/pages/${page.id}/place`, { blockId: blk.id, w: 6, h: 5 });
  check("pagina: place acrescenta no fim", r.status === 201 && r.json?.layout?.length === 3 && r.json.layout[2].y >= 10, JSON.stringify(r.json?.layout?.[2]));
  r = await call("PUT", `/pages/${page.id}`, { name: "ZZ Renomeada", baseUpdatedAt: "2000-01-01T00:00:00.000Z" });
  check("pagina: edicao com base velha -> 409", r.status === 409);
  r = await call("PUT", `/pages/${page.id}`, { name: "ZZ Renomeada", baseUpdatedAt: r.json ? (await call("GET", `/pages/${page.id}`)).json.updatedAt : undefined });
  check("pagina: renomeia", r.status === 200 && r.json?.name === "ZZ Renomeada");
  const p2 = (await call("POST", "/pages", { name: "ZZ Segunda", layout: [] })).json;
  cleanup.pages.push(p2.id);
  const order = (await call("GET", "/pages")).json.map((p) => p.id);
  const swapped = [...order.filter((id) => id !== p2.id), p2.id].reverse();
  r = await call("PUT", "/pages/order", { ids: swapped });
  check("pagina: reordena (paginacao)", r.status === 200 && r.json?.[0]?.id === swapped[0], r.json?.map((p) => p.name).join(","));
  await call("PUT", "/pages/order", { ids: order });

  // ------------------------------------------------------------ nos de dados/UI no canvas
  r = await call("POST", "/canvases", {
    name: "ZZ dados",
    source: "agent",
    nodes: [
      { id: "pedido", type: "input.prompt", name: "Pedido", config: { text: "Item novo" } },
      { id: "gravar", type: "action.record", name: "Gravar", config: { collection: "zz_itens", data: { titulo: "{{input.text}}", qtd: 7 } } },
      { id: "ler", type: "data.records", name: "Ler", config: { collection: "zz_itens" } },
      { id: "painel", type: "ui.block", name: "Painel", config: { blockId: blk.id } },
    ],
    edges: [{ from: "pedido", to: "gravar" }, { from: "gravar", to: "ler" }, { from: "ler", to: "painel" }],
  });
  const canvasId = r.json?.id;
  check("canvas com nos de dados e componente valida", r.status === 201 && r.json?.problems?.length === 0, JSON.stringify(r.json?.problems ?? msg(r)));
  r = await call("POST", `/canvases/${canvasId}/run`, { mode: "live", confirmed: true });
  let run = r.json;
  for (let i = 0; i < 60 && run?.status === "running"; i++) {
    await new Promise((res) => setTimeout(res, 500));
    run = (await call("GET", `/runs/${run.id}`)).json;
  }
  const list = (await call("GET", "/collections/zz_itens/records")).json;
  check("canvas: action.record gravou no banco", run?.status === "ok" && list.some((x) => x.titulo === "Item novo" && x.qtd === 7), `${run?.status} ${run?.error ?? ""}`);
  const inbox = (await call("GET", `/blocks/${blk.id}/inbox`)).json;
  check("canvas: ui.block entregou itens na caixa de entrada do componente", inbox?.items?.length >= 1, JSON.stringify(inbox).slice(0, 120));
  await call("DELETE", `/canvases/${canvasId}`);

  // ------------------------------------------------------------ pacotes (criado por agente -> instalar -> conectar -> desinstalar)
  const manifest = {
    id: "zz-pkg",
    name: "ZZ Pacote",
    description: "teste",
    category: "teste",
    version: "0.0.1",
    requires: [{ id: "agenda", kind: "tool", label: "Listar eventos", hint: "x", match: ["get_time"], optional: true }],
    collections: [{ name: "zz_pkg_itens", label: "ZZ Pkg", fields: [{ name: "titulo", type: "text" }] }],
    blocks: [{ key: "lista", name: "ZZ Lista Pkg", html: "<div></div>", js: "studio.main(async (ctx) => { await ctx.records('zz_pkg_itens').list(); });", permissions: { read: ["col:zz_pkg_itens"], write: [], tools: ["@agenda"], agents: ["ajudante"] } }],
    canvases: [
      { key: "ajudante", name: "ZZ Ajudante", nodes: [{ id: "pedido", type: "input.prompt", name: "Pedido", config: { text: "oi" } }, { id: "ag", type: "agent.llm", name: "Ag", config: { instructions: "x", provider: "auto", tools: ["@agenda"] } }], edges: [{ id: "e1", from: "pedido", fromPort: "main", to: "ag" }] },
    ],
    pages: [{ name: "ZZ Pagina Pkg", layout: [{ kind: "heading", text: "Titulo", x: 0, y: 0, w: 12, h: 1 }, { blockKey: "lista", x: 0, y: 1, w: 12, h: 8 }] }],
    seed: { zz_pkg_itens: [{ titulo: "semente" }] },
  };
  r = await call("POST", "/packages", { ...manifest, blocks: [{ ...manifest.blocks[0], permissions: { read: ["col:zz_pkg_itens"], write: [], tools: ["@naoexiste"], agents: ["ajudante"] } }], source: "agent" });
  check("pacote: valida referencia de conexao", r.status === 400 && /requisito/.test(msg(r)), msg(r));
  r = await call("POST", "/packages", { ...manifest, source: "agent" });
  cleanup.packages.push("zz-pkg");
  check("pacote: agente salva definicao (sem instalar)", r.status === 201 && r.json?.installed === false, msg(r));
  r = await call("POST", "/packages/zz-pkg/install");
  check("pacote: instala (colecao, componente, canvas, pagina)", r.status === 201 && r.json?.installed && r.json.pageIds.length === 1 && r.json.canvasIds.length === 1, msg(r));
  const seeded = (await call("GET", "/collections/zz_pkg_itens/records")).json;
  check("pacote: dados de exemplo", seeded?.length === 1);
  const pkBlock = (await call("GET", "/blocks")).json.find((b) => b.name === "ZZ Lista Pkg");
  check("pacote de agente: componente nasce SEM aprovacao e aponta os agentes", pkBlock && pkBlock.approved === false && pkBlock.permissions.agents.length === 1 && pkBlock.permissions.agents[0] !== "ajudante", JSON.stringify(pkBlock?.permissions));
  r = await call("GET", "/packages/zz-pkg");
  check("pacote: conexao de ferramenta opcional ainda nao mapeada", r.json?.connections?.find((c) => c.id === "agenda")?.status === "optional" && r.json.ready === true, JSON.stringify(r.json?.connections?.[0]));
  r = await call("PUT", "/packages/zz-pkg/connections", { agenda: "ferramenta_que_nao_existe" });
  check("pacote: conectar ferramenta inexistente -> 400", r.status === 400);
  r = await call("PUT", "/packages/zz-pkg/connections", { agenda: "get_time" });
  const pkBlock2 = (await call("GET", `/blocks/${pkBlock.id}`)).json;
  check("pacote: conectar mapeia a ferramenta nas permissoes e no config do componente", r.status === 200 && pkBlock2.permissions.tools.includes("get_time") && pkBlock2.config.tools.agenda === "get_time", JSON.stringify(pkBlock2.config));
  const cv = (await call("GET", `/canvases/${r.json.canvasIds[0]}`)).json;
  check("pacote: conectar tambem resolve a ferramenta no no de agente do canvas", cv?.nodes?.find((n) => n.id === "ag")?.config?.tools?.includes("get_time"), JSON.stringify(cv?.nodes?.find((n) => n.id === "ag")?.config));
  r = await call("DELETE", "/packages/zz-pkg?dropData=true");
  const gone = (await call("GET", "/blocks")).json.every((b) => b.name !== "ZZ Lista Pkg") && (await call("GET", "/pages")).json.every((p) => p.name !== "ZZ Pagina Pkg") && (await call("GET", "/collections/zz_pkg_itens")).status === 404;
  check("pacote: desinstalar remove componente, pagina, canvas e dados", r.status === 200 && gone);
  r = await call("DELETE", "/packages/zz-pkg/definition");
  check("pacote: exclui a definicao", r.status === 200);
  cleanup.packages.length = 0;

  // ------------------------------------------------------------ ferramentas de agente do Studio
  r = await call("POST", "/tools/call", { name: "save_record", args: { collection: "zz_itens", data: { titulo: "via ferramenta" } } });
  check("ferramenta save_record", r.status === 201 && r.json?.result?.titulo === "via ferramenta", msg(r));
  r = await call("POST", "/tools/call", { name: "save_block", args: { name: "ZZ Do Agente", js: "studio.main(async c=>{})" } });
  const viaTool = r.json?.result;
  if (viaTool?.id) cleanup.blocks.push(viaTool.id);
  check("ferramenta save_block cria sem aprovacao e devolve warnings", viaTool?.approved === false && Array.isArray(viaTool?.warnings), msg(r));

  // ------------------------------------------------------------ notificacoes: ferramenta, API, no "Notificar" e lembretes
  const ZZ = "zz-teste";
  const nIds = cleanup.notifications;
  const notifs = async () => (await call("GET", "/notifications?limit=200")).json ?? [];
  r = await call("POST", "/notifications", { title: "ZZ aviso", message: "corpo", level: "warn", source: ZZ });
  if (r.json?.id) nIds.push(r.json.id);
  check("notificacao: cria pela API", r.status === 201 && r.json?.level === "warn" && r.json?.read === false, msg(r));
  r = await call("POST", "/notifications", { title: "" });
  check("notificacao: titulo obrigatorio", r.status === 400, msg(r));
  r = await call("POST", "/notifications", { title: "x", level: "zzz" });
  check("notificacao: level invalido", r.status === 400, msg(r));
  r = await call("POST", "/tools/call", { name: "notify", args: { title: "ZZ via ferramenta", level: "ok" } });
  if (r.json?.result?.id) nIds.push(r.json.result.id);
  check("ferramenta notify cria a notificacao", r.status === 201 && r.json?.result?.title === "ZZ via ferramenta", msg(r));
  let lista = await notifs();
  check("notificacao: aparece na lista", lista.some((n) => n.title === "ZZ aviso") && lista.some((n) => n.title === "ZZ via ferramenta"));

  // o canal SSE entrega o aviso novo em tempo real
  const sse = await fetch(S + "/notifications/stream");
  const reader = sse.body.getReader();
  const got = (async () => {
    let buf = "";
    const dec = new TextDecoder();
    for (let i = 0; i < 40; i++) {
      const { value, done } = await reader.read();
      if (done) return false;
      buf += dec.decode(value);
      if (buf.includes("ZZ sse")) return true;
    }
    return false;
  })();
  await new Promise((res) => setTimeout(res, 300));
  r = await call("POST", "/notifications", { title: "ZZ sse", source: ZZ });
  if (r.json?.id) nIds.push(r.json.id);
  const viaSse = await Promise.race([got, new Promise((res) => setTimeout(() => res(false), 4000))]);
  await reader.cancel().catch(() => undefined);
  check("notificacao: SSE entrega o aviso em tempo real", viaSse === true);
  r = await call("POST", "/notifications/read", { ids: [nIds[0]] });
  lista = await notifs();
  check("notificacao: marca como lida", r.status === 201 && lista.find((n) => n.id === nIds[0])?.read === true);

  // canvas com o no "Notificar": na simulacao nao notifica; ao vivo notifica uma vez por item
  r = await call("POST", "/canvases", {
    name: "ZZ notificar",
    source: "agent",
    nodes: [
      { id: "pedido", type: "input.prompt", name: "Pedido", config: { text: "Fim do ZZ" } },
      { id: "avisar", type: "action.notify", name: "Avisar", config: { title: "ZZ canvas: {{input.text}}", message: "corpo {{json.text}}", level: "ok" } },
    ],
    edges: [{ from: "pedido", to: "avisar" }],
  });
  const nCanvas = r.json?.id;
  check("canvas com no Notificar valida", r.status === 201 && r.json?.problems?.length === 0, JSON.stringify(r.json?.problems ?? msg(r)));
  const runCanvas = async (mode) => {
    let nrun = (await call("POST", `/canvases/${nCanvas}/run`, { mode, confirmed: mode === "live" ? true : undefined })).json;
    for (let i = 0; i < 40 && nrun?.status === "running"; i++) {
      await new Promise((res) => setTimeout(res, 250));
      nrun = (await call("GET", `/runs/${nrun.id}`)).json;
    }
    return nrun;
  };
  const doCanvas = async () => (await notifs()).filter((n) => n.title.startsWith("ZZ canvas"));
  const antes = (await doCanvas()).length;
  let nr = await runCanvas("dry");
  const meio = (await doCanvas()).length;
  check("no Notificar: simulacao nao notifica", nr?.status === "ok" && meio === antes && nr.nodes.find((n) => n.nodeId === "avisar")?.status === "simulated", `${nr?.status} ${nr?.error ?? ""}`);
  nr = await runCanvas("live");
  const feitas = await doCanvas();
  feitas.forEach((n) => nIds.push(n.id));
  check("no Notificar: ao vivo cria a notificacao com o nome do canvas como origem", nr?.status === "ok" && feitas.length === antes + 1 && feitas.some((n) => n.title === "ZZ canvas: Fim do ZZ" && n.source === "ZZ notificar"), `${nr?.status} ${nr?.error ?? ""} ${JSON.stringify(feitas[0])}`);
  await call("DELETE", `/canvases/${nCanvas}`);
  r = await call("POST", "/canvases", {
    name: "ZZ notificar ruim",
    source: "agent",
    nodes: [
      { id: "pedido", type: "input.prompt", name: "Pedido", config: { text: "x" } },
      { id: "avisar", type: "action.notify", name: "Avisar", config: { title: "t", level: "zzz" } },
    ],
    edges: [{ from: "pedido", to: "avisar" }],
  });
  check("no Notificar: tipo invalido e rejeitado", r.status === 400 && /Tipo/.test(msg(r)), msg(r));

  // lembretes: o servidor dispara sozinho quando o intervalo vence (ativo, dentro da janela do dia)
  r = await call("GET", "/collections/sistema_lembretes");
  check("lembretes: colecao do sistema existe", r.status === 200 && r.json?.fields?.some((f) => f.name === "a_cada_min"), msg(r));
  const hm = (d) => String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  const venceu = new Date(Date.now() - 5 * 60_000).toISOString();
  const fora = new Date(Date.now() + 3 * 3600_000);
  const remIds = [];
  for (const body of [
    { titulo: "ZZ lembrete vencido", ativo: true, a_cada_min: 1, inicio: "00:00", fim: "23:59", ultimo_disparo: venceu },
    { titulo: "ZZ lembrete inativo", ativo: false, a_cada_min: 1, ultimo_disparo: venceu },
    { titulo: "ZZ lembrete fora da janela", ativo: true, a_cada_min: 1, inicio: hm(fora), fim: hm(new Date(fora.getTime() + 600_000)), ultimo_disparo: venceu },
  ]) {
    r = await call("POST", "/collections/sistema_lembretes/records", { chave: ZZ, ...body });
    remIds.push(r.json?.id);
  }
  let disparou = null;
  for (let i = 0; i < 30 && !disparou; i++) {
    await new Promise((res) => setTimeout(res, 1000));
    disparou = (await notifs()).find((n) => n.title === "ZZ lembrete vencido");
  }
  if (disparou) nIds.push(disparou.id);
  check("lembrete vencido dispara uma notificacao (origem lembrete)", !!disparou && disparou.source === "lembrete");
  lista = await notifs();
  check("lembrete inativo ou fora da janela nao dispara", !lista.some((n) => n.title === "ZZ lembrete inativo" || n.title === "ZZ lembrete fora da janela"));
  const rec1 = (await call("GET", `/collections/sistema_lembretes/records?chave=${ZZ}`)).json?.find((x) => x.id === remIds[0]);
  check("lembrete: servidor atualiza o ultimo disparo (nao repete a cada tick)", !!rec1 && Date.parse(rec1.ultimo_disparo) > Date.parse(venceu));
  for (const id of remIds) if (id) await call("DELETE", `/collections/sistema_lembretes/records/${id}`);

  // ------------------------------------------------------------ conexao da conta Google (so validacoes: nao grava .env nem .mcp.json)
  r = await call("GET", "/integrations/google");
  check("google: status traz o estado e o mapeamento do pacote", r.status === 200 && typeof r.json?.uv === "boolean" && typeof r.json?.running === "boolean" && Array.isArray(r.json?.mapped) && !("clientSecret" in r.json), msg(r));
  check("google: status nao expoe segredo", !/secret|GOCSPX/i.test(JSON.stringify(r.json).replace(/hasCredentials/g, "")));
  r = await call("POST", "/integrations/google/setup", { email: "nao-e-email" });
  check("google: e-mail invalido -> 400", r.status === 400 && /e-mail/i.test(msg(r)), msg(r));
  r = await call("POST", "/integrations/google/setup", { email: "a@b.com", clientId: "x.apps.googleusercontent.com.evil", clientSecret: "abcdefghijk" });
  check("google: client id invalido -> 400", r.status === 400 && /Client ID/i.test(msg(r)), msg(r));
  r = await call("POST", "/integrations/google/setup", { email: "a@b.com", clientId: "123456789012-abcdefghij.apps.googleusercontent.com", clientSecret: "x y\nGROQ_API_KEY=z" });
  check("google: secret com quebra de linha (injecao no .env) -> 400", r.status === 400 && /secret/i.test(msg(r)), msg(r));
  const gStatus = (await call("GET", "/integrations/google")).json;
  if (!gStatus?.running) {
    r = await call("POST", "/integrations/google/authorize");
    check("google: entrar sem servidor conectado -> 400", r.status === 400, msg(r));
    r = await call("POST", "/integrations/google/test");
    check("google: testar sem servidor conectado -> 400", r.status === 400, msg(r));
  }

  // ------------------------------------------------------------ padrao de fabrica (so leitura: a instalacao em banco vazio esta em scripts/test-factory.mjs)
  r = await call("GET", "/factory");
  check("fabrica: status lista os pacotes do padrao, todos disponiveis na biblioteca", r.status === 200 && r.json?.packages?.length >= 5 && r.json.packages.every((p) => p.available === true), JSON.stringify(r.json?.packages?.filter((p) => !p.available)));
  const lib = (await call("GET", "/packages")).json ?? [];
  check("fabrica: cada pacote de fabrica e da biblioteca (nao um 'criado' duplicado)", r.json.packages.every((f) => lib.filter((p) => p.id === f.id).length === 1 && lib.find((p) => p.id === f.id).origin === "biblioteca"), JSON.stringify(lib.filter((p) => p.origin === "criado").map((p) => p.id)));
  const semAgente = (await call("GET", "/blocks")).json.filter((b) => b.packageId && r.json.packages.some((f) => f.id === b.packageId));
  check("fabrica: componentes instalados de pacotes de biblioteca nascem aprovados", semAgente.every((b) => b.approved === true || b.source !== "package"), semAgente.filter((b) => !b.approved).map((b) => b.name).join(", "));

  // ------------------------------------------------------------ provedores de IA (so validacoes e leitura: nao grava chave nem modelo no .env)
  r = await call("GET", "/integrations/ai");
  check("ia: status lista os provedores e o Claude Code", r.status === 200 && r.json?.providers?.length === 3 && typeof r.json?.claude?.installed === "boolean" && ["auto", "groq", "gemini", "anthropic"].includes(r.json?.preferred), msg(r));
  check("ia: status nunca traz a chave", !/gsk_|AIza|sk-ant|AQ\./.test(r.text) && r.json.providers.every((p) => !("apiKey" in p) && !("key" in p)));
  r = await call("PUT", "/integrations/ai/gemini", { apiKey: "chave com espaco\nGROQ_API_KEY=x" });
  check("ia: chave com espaco/quebra de linha (injecao no .env) -> 400", r.status === 400 && /Chave inválida/i.test(msg(r)), msg(r));
  r = await call("PUT", "/integrations/ai/groq", { model: "modelo com espaco" });
  check("ia: modelo invalido -> 400", r.status === 400, msg(r));
  r = await call("PUT", "/integrations/ai/groq", {});
  check("ia: sem nada para salvar -> 400", r.status === 400, msg(r));
  r = await call("PUT", "/integrations/ai/openai", { apiKey: "abcdefghijkl" });
  check("ia: provedor desconhecido -> 404", r.status === 404, msg(r));
  r = await call("PUT", "/integrations/ai/preferred", { preferred: "openai" });
  check("ia: provedor preferido invalido -> 400", r.status === 400, msg(r));
  const semChave = (await call("GET", "/integrations/ai")).json.providers.find((p) => !p.hasKey);
  if (semChave) {
    r = await call("GET", `/integrations/ai/${semChave.id}/models`);
    check("ia: listar modelos sem chave -> 400", r.status === 400 && /chave/i.test(msg(r)), msg(r));
    r = await call("POST", `/integrations/ai/${semChave.id}/test`, {});
    check("ia: testar sem chave -> 400", r.status === 400, msg(r));
  }
  r = await call("GET", "/catalog");
  check("ia: catalogo oferece claude-code como provedor de agente", r.json?.providers?.some((p) => p.id === "claude-code"), JSON.stringify(r.json?.providers?.map((p) => p.id)));
  r = await call("POST", "/canvases", { name: "ZZ claude-code", source: "agent", nodes: [{ id: "pedido", type: "input.prompt", name: "Pedido", config: { text: "x" } }, { id: "ag", type: "agent.llm", name: "Agente", config: { provider: "claude-code", instructions: "x", tools: [] } }], edges: [{ from: "pedido", to: "ag" }] });
  check("ia: agente com provider claude-code valida", r.status === 201 && r.json?.problems?.length === 0, JSON.stringify(r.json?.problems ?? msg(r)));
  if (r.json?.id) await call("DELETE", `/canvases/${r.json.id}`);
  r = await call("POST", "/canvases", { name: "ZZ provedor ruim", source: "agent", nodes: [{ id: "pedido", type: "input.prompt", name: "Pedido", config: { text: "x" } }, { id: "ag", type: "agent.llm", name: "Agente", config: { provider: "openai", instructions: "x" } }], edges: [{ from: "pedido", to: "ag" }] });
  check("ia: agente com provider desconhecido -> 400", r.status === 400 && /provedor/i.test(msg(r)), msg(r));

  // ------------------------------------------------------------ preferencias de notificacao (som e modo desktop)
  const nPrefs0 = (await call("GET", "/notifications/settings")).json;
  check("notificacao: preferencias trazem som, desktop e suporte da plataforma", typeof nPrefs0?.sound === "boolean" && typeof nPrefs0?.desktop === "boolean" && typeof nPrefs0?.desktopSupported === "boolean" && !!nPrefs0?.platform, JSON.stringify(nPrefs0));
  r = await call("PUT", "/notifications/settings", { sound: "sim" });
  check("notificacao: preferencia nao booleana -> 400", r.status === 400, msg(r));
  r = await call("PUT", "/notifications/settings", { sound: !nPrefs0.sound });
  const nPrefs1 = (await call("GET", "/notifications/settings")).json;
  check("notificacao: preferencia de som persiste", r.status === 200 && nPrefs1.sound === !nPrefs0.sound && nPrefs1.desktop === nPrefs0.desktop, JSON.stringify(nPrefs1));
  await call("PUT", "/notifications/settings", { sound: nPrefs0.sound });

  // ------------------------------------------------------------ outras chaves privadas (.env): so nomes voltam, nunca valores
  for (const [nome, corpo] of [
    ["PATH nao e nome de segredo", { name: "PATH", value: "x" }],
    ["NODE_OPTIONS nao e nome de segredo", { name: "NODE_OPTIONS", value: "--require x" }],
    ["nome em minusculas", { name: "zz_token", value: "abc" }],
    ["chave de IA tem cartao proprio", { name: "GROQ_API_KEY", value: "abcdefghijk" }],
    ["valor com espaco", { name: "ZZ_TEST_TOKEN", value: "com espaco" }],
    ["valor com quebra de linha (injecao no .env)", { name: "ZZ_TEST_TOKEN", value: "abc\nOUTRA_KEY=x" }],
    ["valor com aspas no comeco", { name: "ZZ_TEST_TOKEN", value: '"abc' }],
  ]) {
    r = await call("PUT", "/integrations/keys", corpo);
    check(`chaves: ${nome} -> 400`, r.status === 400, msg(r));
  }
  r = await call("PUT", "/integrations/keys", { name: "ZZ_TEST_TOKEN", value: "valor-secreto-zz-123" });
  check("chaves: salva e lista so o nome", r.status === 200 && r.json?.keys?.includes("ZZ_TEST_TOKEN") && !r.text.includes("valor-secreto-zz-123"), msg(r));
  r = await call("GET", "/integrations/keys");
  check("chaves: a listagem nunca traz o valor", r.json?.keys?.includes("ZZ_TEST_TOKEN") && !r.text.includes("valor-secreto-zz-123"));
  r = await call("DELETE", "/integrations/keys/ZZ_TEST_TOKEN");
  check("chaves: remove", r.status === 200 && !r.json?.keys?.includes("ZZ_TEST_TOKEN"), msg(r));
  r = await call("DELETE", "/integrations/keys/PATH");
  check("chaves: nao remove variavel que nao e de segredo -> 400", r.status === 400, msg(r));

  // ------------------------------------------------------------ eventos (a tela atualiza na hora quando o Claude muda algo)
  {
    const got = [];
    const ac = new AbortController();
    const res = await fetch(S + "/events", { signal: ac.signal, headers: { Accept: "text/event-stream" } });
    check("eventos: GET /events abre um stream SSE", res.status === 200 && (res.headers.get("content-type") ?? "").includes("text/event-stream"), res.headers.get("content-type"));
    (async () => {
      const dec = new TextDecoder();
      let buf = "";
      try {
        for await (const part of res.body) {
          buf += dec.decode(part, { stream: true });
          const events = buf.split(/\n\n/);
          buf = events.pop() ?? "";
          for (const ev of events) {
            const m = ev.match(/^data: (.+)$/m);
            if (m) try { got.push(JSON.parse(m[1])); } catch {}
          }
        }
      } catch {}
    })();
    const wait = async (fn, ms = 2000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        if (got.some(fn)) return true;
        await new Promise((ok) => setTimeout(ok, 50));
      }
      return false;
    };
    r = await call("POST", "/collections", { name: "zz_evt", label: "ZZ evt", fields: [{ name: "t", type: "text" }] });
    cleanup.collections.push("zz_evt");
    check("eventos: criar colecao avisa {data, zz_evt}", await wait((e) => e.type === "data" && e.key === "zz_evt"));
    got.length = 0;
    r = await call("POST", "/collections/zz_evt/records", { t: "a" });
    check("eventos: gravar registro avisa a colecao", await wait((e) => e.type === "data" && e.key === "zz_evt"));
    got.length = 0;
    for (let i = 0; i < 5; i++) await call("POST", "/collections/zz_evt/records", { t: "x" + i });
    await new Promise((ok) => setTimeout(ok, 400));
    check("eventos: 5 gravacoes seguidas viram poucos avisos (agrupados em 80 ms)", got.filter((e) => e.type === "data" && e.key === "zz_evt").length <= 3, JSON.stringify(got));
    got.length = 0;
    r = await call("POST", "/blocks", { name: "zz evt bloco", source: "agent", html: "<p>x</p>", js: "", permissions: { read: [], write: [], tools: [], agents: [] } });
    if (r.json?.id) cleanup.blocks.push(r.json.id);
    check("eventos: criar componente avisa {blocks, id}", await wait((e) => e.type === "blocks" && e.key === r.json?.id), msg(r));
    got.length = 0;
    r = await call("POST", "/pages", { name: "zz evt pagina" });
    if (r.json?.id) cleanup.pages.push(r.json.id);
    check("eventos: criar pagina avisa {pages}", await wait((e) => e.type === "pages"), msg(r));
    got.length = 0;
    const tema = (await call("GET", "/theme")).json;
    r = await call("PUT", "/theme", tema);
    check("eventos: salvar tema avisa {theme}", await wait((e) => e.type === "theme"), msg(r));
    ac.abort();
  }
} finally {
  await call("DELETE", "/integrations/keys/ZZ_TEST_TOKEN");
  for (const id of cleanup.notifications) await call("DELETE", `/notifications/${id}`);
  for (const id of cleanup.pages) await call("DELETE", `/pages/${id}`);
  for (const id of cleanup.blocks) if (id) await call("DELETE", `/blocks/${id}`);
  for (const n of cleanup.collections) await call("DELETE", `/collections/${n}`);
  for (const id of cleanup.packages) await call("DELETE", `/packages/${id}?dropData=true`).then(() => call("DELETE", `/packages/${id}/definition`));
  if (theme0) await call("PUT", "/theme", theme0);
}

console.log(failures ? `\n${failures} FALHA(S)` : "\nTODOS OS TESTES PASSARAM");
process.exit(failures ? 1 : 0);
