// Google Workspace: Agenda, E-mails (Gmail, só leitura) e Tarefas (Google Tasks). Cada componente chama as ferramentas de um
// servidor MCP que você conecta na Biblioteca (ctx.config.tools.<requisito>) e mostra o resultado em cartões.
// O modo vem do html: <div id="app" data-modo="agenda|emails|tarefas">.
//
// As respostas dos servidores MCP variam muito, então tudo passa por normalizar(): o resultado pode ser um texto JSON,
// um array, um objeto com items/events/messages/tasks/results… ou só texto. Se nada for reconhecido, mostra o texto bruto.

// ======================= normalizador (sem DOM: é testado em Node) =======================
const CHAVES_LISTA = ["items", "events", "messages", "tasks", "results", "threads", "data", "entries", "list", "value", "records", "documents", "emails", "event", "content", "result", "output", "structuredContent", "response"];
const CHAVES_TITULO = ["summary", "title", "subject", "name", "displayName"];
const CHAVES_QUANDO = ["start.dateTime", "start.date", "start", "date", "internalDate", "receivedAt", "receivedDateTime", "created", "updated"];
const CHAVES_FIM = ["end.dateTime", "end.date", "end"];
const CHAVES_QUEM = ["from", "from.name", "from.email", "from.emailAddress.name", "from.emailAddress.address", "sender", "organizer.displayName", "organizer.email"];

function pegar(o, caminho) {
  let c = o;
  for (const p of caminho.split(".")) {
    if (c === null || typeof c !== "object") return undefined;
    c = c[p];
  }
  return c;
}

function primeiroCaminho(o, caminhos) {
  for (const c of caminhos) {
    const v = pegar(o, c);
    const t = typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
    if (t.trim()) return t.trim();
  }
  return "";
}

function limparTexto(s, max) {
  const t = String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}

// texto -> JSON, tolerando texto solto antes/depois e um JSON por linha
function lerJson(s) {
  const t = String(s).trim();
  if (!t) return undefined;
  try { return JSON.parse(t); } catch (e) { /* segue */ }
  const i = t.search(/[[{]/);
  const j = Math.max(t.lastIndexOf("]"), t.lastIndexOf("}"));
  if (i >= 0 && j > i) { try { return JSON.parse(t.slice(i, j + 1)); } catch (e) { /* segue */ } }
  const linhas = t.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (linhas.length > 1) {
    const objs = [];
    for (const l of linhas) { try { objs.push(JSON.parse(l)); } catch (e) { return undefined; } }
    return objs;
  }
  return undefined;
}

function pareceItem(o) {
  return ["summary", "title", "subject", "name", "snippet", "id", "start", "payload"].some((k) => o[k] !== undefined);
}

// acha a lista de itens dentro do que a ferramenta devolveu; null = formato não reconhecido
function extrairLista(v, prof) {
  prof = prof || 0;
  if (v === null || v === undefined || prof > 5) return null;
  if (typeof v === "string") {
    const j = lerJson(v);
    return j === undefined ? null : extrairLista(j, prof + 1);
  }
  if (Array.isArray(v)) {
    // resposta MCP bruta: [{ type: "text", text: "..." }]
    if (v.length && v.every((x) => x && typeof x === "object" && x.type === "text" && typeof x.text === "string")) {
      const partes = v.map((x) => extrairLista(x.text, prof + 1));
      return partes.every((p) => p) ? [].concat(...partes) : null;
    }
    // várias listas de tarefas: [{ title: "Minhas tarefas", tasks: [...] }]
    if (v.length && v.every((x) => x && typeof x === "object" && Array.isArray(x.tasks || x.items))) {
      return [].concat(...v.map((x) => x.tasks || x.items));
    }
    return v;
  }
  if (typeof v === "object") {
    for (const k of CHAVES_LISTA) {
      if (v[k] !== undefined && v[k] !== null) {
        const r = extrairLista(v[k], prof + 1);
        if (r) return r;
      }
    }
    for (const k of Object.keys(v)) if (Array.isArray(v[k]) && v[k].length && v[k][0] && typeof v[k][0] === "object") return v[k];
    if (pareceItem(v)) return [v];
  }
  return null;
}

const p2 = (n) => String(n).padStart(2, "0");
const fmtData = (d) => p2(d.getDate()) + "/" + p2(d.getMonth() + 1) + "/" + d.getFullYear();
const fmtHora = (d) => p2(d.getHours()) + ":" + p2(d.getMinutes());
const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

// data/hora em qualquer formato comum (ISO, AAAA-MM-DD, RFC 2822, epoch em ms ou s) -> { d, soData } ou null
function lerQuando(bruto) {
  const b = String(bruto || "").trim();
  if (!b) return null;
  let d;
  let soData = false;
  if (/^\d{9,}$/.test(b)) d = new Date(b.length <= 10 ? Number(b) * 1000 : Number(b));
  else if (/^\d{4}-\d{2}-\d{2}$/.test(b)) { soData = true; d = new Date(b + "T00:00:00"); }
  else if (/^\d{4}-\d{2}-\d{2}T00:00:00(\.0+)?Z$/.test(b)) { soData = true; d = new Date(b.slice(0, 10) + "T00:00:00"); } // "due" do Google Tasks: só a data
  else d = new Date(b);
  return isNaN(d.getTime()) ? null : { d, soData };
}

// um item de agenda ou e-mail -> { titulo, quando, ts, dia, sub[] }
function mapearItem(o, tipo) {
  if (o === null || o === undefined) return null;
  if (typeof o !== "object") return { titulo: limparTexto(o, 200) || "(sem título)", quando: "", ts: null, dia: "", sub: [] };
  const cab = {};
  const hs = pegar(o, "payload.headers") || o.headers;
  if (Array.isArray(hs)) hs.forEach((h) => { if (h && h.name) cab[String(h.name).toLowerCase()] = typeof h.value === "string" ? h.value : ""; });
  const titulo = limparTexto(primeiroCaminho(o, CHAVES_TITULO) || cab.subject, 200) || "(sem título)";
  const q = lerQuando(primeiroCaminho(o, CHAVES_QUANDO) || cab.date);
  let quando = "";
  let dia = "";
  if (q) {
    dia = fmtData(q.d);
    if (q.soData) quando = tipo === "agenda" ? "Dia todo" : dia;
    else {
      quando = (tipo === "agenda" ? "" : dia + " ") + fmtHora(q.d);
      const f = tipo === "agenda" ? lerQuando(primeiroCaminho(o, CHAVES_FIM)) : null;
      if (f && !f.soData && fmtData(f.d) === dia) quando += " – " + fmtHora(f.d);
    }
  } else {
    quando = limparTexto(primeiroCaminho(o, CHAVES_QUANDO) || cab.date, 40);
  }
  const quem = limparTexto(primeiroCaminho(o, CHAVES_QUEM) || cab.from, 120);
  const local = limparTexto(primeiroCaminho(o, ["location"]), 120);
  const texto = limparTexto(primeiroCaminho(o, ["snippet", "description", "preview", "bodyPreview", "body", "text"]), 180);
  const sub = tipo === "agenda" ? [local, texto, quem] : [quem, texto];
  return { titulo, quando, ts: q ? q.d.getTime() : null, dia, sub: sub.filter((s, i) => s && sub.indexOf(s) === i).slice(0, 2) };
}

// uma tarefa do Google Tasks -> { id, titulo, notas, vence, ts, atrasada, concluida }
function mapearTarefa(o, hojeMs) {
  if (o === null || o === undefined) return null;
  if (typeof o !== "object") return { id: "", titulo: limparTexto(o, 200) || "(sem título)", notas: "", vence: "", ts: null, atrasada: false, concluida: false };
  const status = String(o.status || "").toLowerCase();
  const concluida = status === "completed" || status === "done" || o.completed === true || (typeof o.completed === "string" && o.completed !== "") || o.done === true;
  const q = lerQuando(primeiroCaminho(o, ["due", "dueDate", "due_date", "deadline"]));
  const hoje = hojeMs === undefined ? new Date().setHours(0, 0, 0, 0) : hojeMs;
  return {
    id: String(o.id || o.taskId || o.task_id || ""),
    titulo: limparTexto(primeiroCaminho(o, ["title", "name", "summary"]), 200) || "(sem título)",
    notas: limparTexto(primeiroCaminho(o, ["notes", "description", "body"]), 180),
    vence: q ? fmtData(q.d) : "",
    ts: q ? q.d.getTime() : null,
    atrasada: !concluida && !!q && q.d.getTime() < hoje,
    concluida,
  };
}

// Respostas em TEXTO formatado (o workspace-mcp devolve texto, não JSON): linhas viram objetos que mapearItem/mapearTarefa entendem.
// null = não reconheci (o componente mostra o texto bruto); [] = o servidor disse que não há nada.
function textoParaLista(raw, tipo) {
  if (typeof raw !== "string") return null;
  const linhas = raw.split(/\r?\n/);
  const itens = [];
  if (tipo === "agenda") {
    // - "Título" (Starts: 2026-09-22T13:00:00-03:00 [fuso; ...], Ends: 2026-09-22T14:00:00-03:00 [...]) Meeting: https://meet... ID: ... | Link: ...
    for (const l of linhas) {
      const m = /^\s*-\s+"(.*)"\s+\(Starts:\s*([^\s,\]]+)(?:\s*\[[^\]]*\])?,\s*Ends:\s*([^\s,\]]+)(?:\s*\[[^\]]*\])?\)(.*)$/.exec(l);
      if (!m) continue;
      const local = /Location:\s*(.+?)\s*(?:Meeting:|ID:|\||$)/i.exec(m[4]);
      itens.push({ summary: m[1], start: m[2], end: m[3], location: local ? local[1] : "", description: /Meeting:\s*\S+/i.test(m[4]) ? "Google Meet" : "" });
    }
    return itens.length ? itens : /no events|nenhum evento/i.test(raw) ? [] : null;
  }
  if (tipo === "tarefa") {
    // - Título (ID: abc)\n  Status: needsAction\n  Due: 2026-09-20T00:00:00.000Z\n  Notes: ...
    let cur = null;
    for (const l of linhas) {
      const t = /^-\s+(.*?)\s+\(ID:\s*([^)]+)\)\s*$/.exec(l);
      if (t) { cur = { title: t[1], id: t[2].trim() }; itens.push(cur); continue; }
      const k = /^\s+(Status|Due|Notes|Completed):\s*(.*)$/.exec(l);
      if (k && cur) cur[k[1].toLowerCase()] = k[2].trim();
    }
    return itens.length ? itens : /no tasks|nenhuma tarefa/i.test(raw) ? [] : null;
  }
  if (tipo === "email") {
    // 1. Message ID: abc\n     Subject: ...\n     From: ...\n     Date: ...
    let cur = null;
    for (const l of linhas) {
      const m = /^\s*\d+\.\s+Message ID:\s*(\S+)/.exec(l);
      if (m) { cur = { id: m[1] }; itens.push(cur); continue; }
      const k = /^\s+(Subject|From|Date):\s*(.*)$/.exec(l);
      if (k && cur) cur[k[1].toLowerCase()] = k[2].trim();
    }
    return itens.length ? itens : /no messages|nenhuma mensagem/i.test(raw) ? [] : null;
  }
  return null;
}

// resultado bruto da ferramenta -> { ok, itens[], cru }
function normalizar(raw, tipo, hojeMs) {
  const doTexto = typeof raw === "string" && !/^\s*[[{]/.test(raw) ? textoParaLista(raw, tipo) : null;
  const lista = doTexto || extrairLista(raw);
  if (lista) return { ok: true, itens: lista.map((x) => (tipo === "tarefa" ? mapearTarefa(x, hojeMs) : mapearItem(x, tipo))).filter(Boolean), cru: "" };
  let cru = "";
  if (typeof raw === "string") cru = raw;
  else if (raw !== null && raw !== undefined) { try { cru = JSON.stringify(raw, null, 2); } catch (e) { cru = String(raw); } }
  return { ok: false, itens: [], cru: cru.slice(0, 4000) };
}
// ======================= fim do normalizador =======================

studio.main(async (ctx) => {
  const app = document.getElementById("app");
  const modo = (app && app.dataset.modo) || "agenda";
  const $ = (id) => document.getElementById(id);

  // ---- Palpites de argumentos das ferramentas ------------------------------------------------------------
  // AJUSTE AQUI: cada servidor MCP nomeia os argumentos de um jeito (query/q, maxResults/max_results/pageSize,
  // tasklist/task_list_id…). A ferramenta recebe todos os palpites de uma vez; valores vazios são omitidos. Se der erro,
  // o componente tenta de novo só com o essencial. Para ver o que o seu servidor aceita: aba Ferramentas do Studio.
  const inicioDoDia = () => new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const emDias = (n) => new Date(new Date().setHours(0, 0, 0, 0) + n * 86400000).toISOString();
  const LISTA_PADRAO = "@default";
  const PALPITES_DE_ARGUMENTOS = {
    // próximas 4 semanas (sem limite, eventos anuais de 1 ou 2 anos à frente enchem a lista)
    agenda: (busca, max) => ({ query: busca, q: busca, maxResults: max, max_results: max, pageSize: max, timeMin: inicioDoDia(), time_min: inicioDoDia(), timeMax: emDias(28), time_max: emDias(28), singleEvents: true, orderBy: "startTime" }),
    emails: (busca, max) => ({ query: busca || "in:inbox", q: busca || "in:inbox", maxResults: max, max_results: max, pageSize: max, page_size: max, include_headers: true }),
    tarefas: (busca, max, concluidas) => ({ tasklist: LISTA_PADRAO, tasklist_id: LISTA_PADRAO, task_list_id: LISTA_PADRAO, taskListId: LISTA_PADRAO, maxResults: max, max_results: max, showCompleted: concluidas, show_completed: concluidas }),
    criarTarefa: (t) => ({ action: "create", tasklist: LISTA_PADRAO, tasklist_id: LISTA_PADRAO, task_list_id: LISTA_PADRAO, taskListId: LISTA_PADRAO, title: t.titulo, notes: t.notas, due: t.vence ? t.vence + "T00:00:00.000Z" : "" }),
    concluirTarefa: (t) => ({ action: "update", tasklist: LISTA_PADRAO, tasklist_id: LISTA_PADRAO, task_list_id: LISTA_PADRAO, taskListId: LISTA_PADRAO, task: t.id, task_id: t.id, taskId: t.id, id: t.id, status: "completed" }),
  };

  const DEF = {
    agenda: { req: "calendario_listar", rotulo: "Calendário: listar eventos", dica: "Ferramenta do MCP do Google Workspace que lista eventos (ex.: calendar list events).", tipo: "agenda", max: 25, vazio: "Nenhum evento encontrado." },
    emails: { req: "gmail_buscar", rotulo: "Gmail: buscar mensagens", dica: "Ferramenta do MCP do Google Workspace que busca ou lista e-mails, somente leitura (ex.: gmail search messages).", tipo: "email", max: 15, vazio: "Nenhum e-mail encontrado." },
    tarefas: { req: "tarefas_listar", rotulo: "Tarefas: listar tarefas", dica: "Ferramenta do MCP do Google Workspace que lista as tarefas do Google Tasks (ex.: tasks list tasks).", tipo: "tarefa", max: 50, vazio: "Nenhuma tarefa por aqui." },
  }[modo];

  const limpar = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== "" && v !== undefined && v !== null));
  const ferramenta = (req) => (ctx.config.tools && ctx.config.tools[req]) || "";
  const nomeListar = ferramenta(DEF.req);

  let busca = String(await ctx.store.get("busca", ""));
  let concluidas = (await ctx.store.get("concluidas", false)) === true;
  let estado = "carregando"; // carregando | ok | erro
  let dados = { ok: true, itens: [], cru: "" };
  let erro = "";

  async function chamar(nome, args, minimo) {
    try {
      return await ctx.tool(nome, limpar(args));
    } catch (err) {
      try { return await ctx.tool(nome, limpar(minimo || {})); } catch (err2) { throw err; }
    }
  }

  async function carregar() {
    if (!nomeListar) return;
    estado = "carregando";
    render();
    try {
      const args = modo === "tarefas" ? PALPITES_DE_ARGUMENTOS.tarefas(busca, DEF.max, concluidas) : PALPITES_DE_ARGUMENTOS[modo](busca, DEF.max);
      const raw = await chamar(nomeListar, args, modo === "tarefas" ? { task_list_id: LISTA_PADRAO } : { query: busca || (modo === "emails" ? "in:inbox" : "") });
      dados = normalizar(raw, DEF.tipo);
      if (modo === "agenda" && dados.itens.every((i) => i.ts !== null)) dados.itens.sort((a, b) => a.ts - b.ts);
      if (modo === "tarefas") {
        dados.itens.sort((a, b) => (a.concluida - b.concluida) || ((a.ts === null) - (b.ts === null)) || ((a.ts || 0) - (b.ts || 0)));
      }
      estado = "ok";
    } catch (err) {
      estado = "erro";
      erro = err.message;
    }
    render();
  }

  function avisoSemFerramenta() {
    return (
      '<div class="ac-card"><div class="ac-title">Conecte a ferramenta na Biblioteca</div><div class="ac-stack">' +
      "<div>Este componente precisa da ferramenta <b>" + ctx.escape(DEF.rotulo) + "</b>.</div>" +
      '<div class="ac-muted">' + ctx.escape(DEF.dica) + "</div>" +
      '<div class="ac-muted">Na Biblioteca, abra o pacote Google Workspace e escolha, na conexão “' + ctx.escape(DEF.rotulo) + '”, a ferramenta correspondente do seu servidor MCP.</div></div></div>'
    );
  }

  const cartao = (it) =>
    '<div class="ac-card"><div class="ac-row ac-row-between ac-wrap"><b class="tit">' + ctx.escape(it.titulo) + "</b>" + (it.quando ? '<span class="ac-muted">' + ctx.escape(it.quando) + "</span>" : "") + "</div>" +
    it.sub.map((s) => '<div class="ac-muted sub">' + ctx.escape(s) + "</div>").join("") + "</div>";

  function cartaoTarefa(t, i) {
    const podeConcluir = !!ferramenta("tarefas_concluir") && !t.concluida && t.id;
    return (
      '<div class="ac-card tarefa' + (t.concluida ? " feita" : "") + '"><div class="ac-row">' +
      (podeConcluir ? '<button class="ac-btn ac-btn-sm" data-act="concluir" data-i="' + i + '" title="Marcar como concluída">✓</button>' : "") +
      '<div class="ac-grow"><b class="tit">' + ctx.escape(t.titulo) + "</b>" + (t.notas ? '<div class="ac-muted sub">' + ctx.escape(t.notas) + "</div>" : "") + "</div>" +
      (t.concluida ? '<span class="ac-badge ac-badge-ok">concluída</span>' : t.atrasada ? '<span class="ac-badge ac-badge-danger">atrasada · ' + ctx.escape(t.vence) + "</span>" : t.vence ? '<span class="ac-badge">' + ctx.escape(t.vence) + "</span>" : "") +
      "</div></div>"
    );
  }

  function render() {
    const c = $("conteudo");
    if (document.activeElement !== $("q") && $("q")) $("q").value = busca;
    if (!nomeListar) { c.innerHTML = avisoSemFerramenta(); return; }
    if (estado === "carregando") { c.innerHTML = '<div class="ac-empty">Carregando…</div>'; return; }
    if (estado === "erro") {
      c.innerHTML = '<div class="ac-card"><div class="ac-danger">Não foi possível chamar a ferramenta: ' + ctx.escape(erro) + '</div><div class="ac-muted">Confira os nomes dos argumentos em PALPITES_DE_ARGUMENTOS no código do componente e use “Recarregar”.</div></div>';
      return;
    }
    if (!dados.ok) {
      c.innerHTML = dados.cru
        ? '<div class="ac-muted">Não reconheci o formato da resposta; este é o texto como veio:</div><pre class="cru">' + ctx.escape(dados.cru) + "</pre>"
        : '<div class="ac-empty">A ferramenta não devolveu nada.</div>';
      return;
    }
    let itens = dados.itens;
    if (modo === "tarefas") {
      if (!concluidas) itens = itens.filter((t) => !t.concluida);
      const q = busca.trim().toLowerCase();
      if (q) itens = itens.filter((t) => (t.titulo + " " + t.notas).toLowerCase().includes(q));
    }
    if (!itens.length) { c.innerHTML = '<div class="ac-empty">' + DEF.vazio + "</div>"; return; }
    let html = "";
    if (modo === "agenda") {
      let diaAtual = null;
      const hoje = fmtData(new Date());
      const amanha = fmtData(new Date(Date.now() + 86400000));
      itens.forEach((it) => {
        if (it.dia !== diaAtual) {
          diaAtual = it.dia;
          const partes = it.dia.split("/");
          const dt = new Date(Number(partes[2]), Number(partes[1]) - 1, Number(partes[0]));
          html += '<div class="ac-subtitle dia">' + (it.dia === hoje ? "Hoje" : it.dia === amanha ? "Amanhã" : it.dia ? DIAS[dt.getDay()] + ", " + partes[0] + "/" + partes[1] : "Sem data") + "</div>";
        }
        html += cartao(it);
      });
    } else if (modo === "tarefas") {
      html = itens.map((t) => cartaoTarefa(t, dados.itens.indexOf(t))).join("");
    } else {
      html = itens.map(cartao).join("");
    }
    c.innerHTML = '<div class="ac-stack">' + html + "</div>";
  }

  // ---- ações de tarefa (só com as ferramentas de ação conectadas) ----
  const FORM_HTML =
    '<div class="ac-stack"><div class="ac-field"><label>Título</label><input id="titulo" class="ac-input"></div>' +
    '<div class="ac-field"><label>Notas</label><textarea id="notas" class="ac-textarea"></textarea></div>' +
    '<div class="ac-field"><label>Vence em</label><input id="vence" type="date" class="ac-input"></div>' +
    '<div class="ac-row ac-row-end"><button id="cancel" class="ac-btn">Cancelar</button><button id="save" class="ac-btn ac-btn-primary">Criar</button></div></div>';
  const FORM_JS =
    "studio.main(async (m) => { const f = (i) => document.getElementById(i);" +
    " f('cancel').onclick = () => m.close(null);" +
    " f('save').onclick = () => { const t = f('titulo').value.trim(); if (!t) { m.ui.toast('Informe o título', 'warn'); return; }" +
    " m.close({ titulo: t, notas: f('notas').value.trim(), vence: f('vence').value }); }; });";

  async function novaTarefa() {
    const r = await ctx.ui.modal({ title: "Nova tarefa", html: FORM_HTML, js: FORM_JS, size: "sm" });
    if (!r) return;
    try {
      await chamar(ferramenta("tarefas_criar"), PALPITES_DE_ARGUMENTOS.criarTarefa(r), { action: "create", title: r.titulo, task_list_id: LISTA_PADRAO });
      ctx.ui.toast("Tarefa criada", "ok");
      await carregar();
    } catch (err) {
      ctx.ui.toast(err.message, "error");
    }
  }

  async function concluir(i) {
    const t = dados.itens[i];
    if (!t || !t.id) return;
    try {
      await chamar(ferramenta("tarefas_concluir"), PALPITES_DE_ARGUMENTOS.concluirTarefa(t), { action: "update", task_id: t.id, task_list_id: LISTA_PADRAO, status: "completed" });
      t.concluida = true;
      t.atrasada = false;
      ctx.ui.toast("Tarefa concluída", "ok");
    } catch (err) {
      ctx.ui.toast(err.message, "error");
    }
    render();
  }

  function buscar() {
    busca = $("q").value;
    ctx.store.set("busca", busca);
    carregar();
  }

  $("conteudo").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-act]");
    if (b && b.dataset.act === "concluir") concluir(Number(b.dataset.i));
  });
  $("q").addEventListener("keydown", (e) => { if (e.key === "Enter") buscar(); });
  $("q").addEventListener("input", () => { busca = $("q").value; ctx.store.set("busca", busca); if (modo === "tarefas") render(); });
  $("recarregar").addEventListener("click", buscar);
  if ($("concluidas")) {
    $("concluidas").checked = concluidas;
    $("concluidas").addEventListener("change", () => { concluidas = $("concluidas").checked; ctx.store.set("concluidas", concluidas); carregar(); });
  }
  if ($("nova")) {
    $("nova").hidden = !ferramenta("tarefas_criar");
    $("nova").addEventListener("click", novaTarefa);
  }

  render();
  await carregar();
  ctx.main(async () => { await carregar(); });
});
