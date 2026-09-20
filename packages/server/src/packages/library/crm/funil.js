// CRM: funil de negócios. Registros de crm_negocios; cada coluna é o campo "etapa".
studio.main(async (ctx) => {
  const ETAPAS = [["lead", "Lead"], ["contato", "Contato"], ["proposta", "Proposta"], ["negociacao", "Negociação"], ["ganho", "Ganho"], ["perdido", "Perdido"]];
  const ABERTAS = ["lead", "contato", "proposta", "negociacao"];
  const negocios = ctx.records("crm_negocios");
  const contatos = ctx.records("crm_contatos");
  const $ = (id) => document.getElementById(id);
  const brl = (n) => Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const dataBr = (d) => { const p = String(d || "").slice(0, 10).split("-"); return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : ""; };
  const hoje = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  let all = [];
  let nomes = [];
  let filtro = String(await ctx.store.get("filtro", ""));

  const FORM_HTML =
    '<div class="ac-stack">' +
    '<div class="ac-field"><label>Título</label><input id="titulo" class="ac-input"></div>' +
    '<div class="ac-field"><label>Contato</label><input id="contato" class="ac-input" list="nomes" placeholder="Nome do contato"><datalist id="nomes"></datalist></div>' +
    '<div class="ac-row"><div class="ac-field ac-grow"><label>Valor (R$)</label><input id="valor" type="number" min="0" step="0.01" class="ac-input"></div>' +
    '<div class="ac-field ac-grow"><label>Etapa</label><select id="etapa" class="ac-select">' +
    ETAPAS.map(([k, r]) => '<option value="' + k + '">' + r + "</option>").join("") +
    "</select></div></div>" +
    '<div class="ac-field"><label>Fechamento previsto</label><input id="fechamento" type="date" class="ac-input"></div>' +
    '<div class="ac-field"><label>Notas</label><textarea id="notas" class="ac-textarea"></textarea></div>' +
    '<div class="ac-row ac-row-between"><button id="del" class="ac-btn ac-btn-danger">Excluir</button>' +
    '<div class="ac-row"><button id="cancel" class="ac-btn">Cancelar</button><button id="save" class="ac-btn ac-btn-primary">Salvar</button></div></div>' +
    "</div>";

  function formJs(init, lista) {
    return (
      "const init = " + JSON.stringify(init) + "; const nomes = " + JSON.stringify(lista) + ";" +
      "studio.main(async (m) => {" +
      " const f = (id) => document.getElementById(id);" +
      " nomes.forEach((n) => { const o = document.createElement('option'); o.value = n; f('nomes').appendChild(o); });" +
      " ['titulo','contato','valor','etapa','fechamento','notas'].forEach((k) => { if (init[k] !== undefined && init[k] !== null) f(k).value = init[k]; });" +
      " if (!init.id) f('del').style.display = 'none';" +
      " f('cancel').onclick = () => m.close(null);" +
      " f('del').onclick = async () => { if (await m.ui.confirm('Excluir este negócio?', { danger: true, confirmLabel: 'Excluir' })) m.close({ remove: true }); };" +
      " f('save').onclick = () => { const t = f('titulo').value.trim(); if (!t) { m.ui.toast('Informe o título', 'warn'); return; }" +
      "  const v = f('valor').value; const c = f('contato').value.trim(); const n = f('notas').value.trim();" +
      "  m.close({ titulo: t, contato: c || null, valor: v === '' ? null : Number(v), etapa: f('etapa').value, fechamento: f('fechamento').value || null, notas: n || null }); };" +
      "});"
    );
  }

  async function editar(n) {
    const init = n
      ? { id: n.id, titulo: n.titulo, contato: n.contato, valor: n.valor, etapa: n.etapa || "lead", fechamento: n.fechamento ? String(n.fechamento).slice(0, 10) : "", notas: n.notas }
      : { etapa: "lead" };
    const res = await ctx.ui.modal({ title: n ? "Editar negócio" : "Novo negócio", html: FORM_HTML, js: formJs(init, nomes), size: "sm" });
    if (!res) return;
    try {
      if (res.remove) await negocios.remove(n.id);
      else if (n) await negocios.update(n.id, res);
      else await negocios.create(res);
    } catch (err) {
      ctx.ui.toast(err.message, "error");
    }
    await carregar();
  }

  function cartao(n) {
    const atrasado = ABERTAS.includes(n.etapa || "lead") && n.fechamento && String(n.fechamento).slice(0, 10) < hoje();
    return (
      '<div class="card" draggable="true" data-id="' + ctx.escape(n.id) + '"><b>' + ctx.escape(n.titulo) + "</b>" +
      (n.contato ? "<small>" + ctx.escape(n.contato) + "</small>" : "") +
      '<div class="valor">' + brl(n.valor) + "</div>" +
      (n.fechamento ? '<div class="meta"><span class="ac-badge' + (atrasado ? " ac-badge-danger" : "") + '">' + (atrasado ? "venceu " : "") + dataBr(n.fechamento) + "</span></div>" : "") +
      "</div>"
    );
  }

  function render() {
    const q = filtro.trim().toLowerCase();
    const visiveis = all.filter((n) => !q || [n.titulo, n.contato, n.notas].join(" ").toLowerCase().includes(q));
    $("board").innerHTML = ETAPAS.map(([key, rotulo]) => {
      const itens = visiveis.filter((n) => (n.etapa || "lead") === key).sort((a, b) => (Number(b.valor) || 0) - (Number(a.valor) || 0));
      const total = itens.reduce((s, n) => s + (Number(n.valor) || 0), 0);
      return (
        '<section class="col" data-col="' + key + '"><div class="col-head"><b>' + rotulo + '</b><span class="ac-badge">' + itens.length + "</span></div>" +
        '<div class="col-total">' + brl(total) + "</div>" + itens.map(cartao).join("") + "</section>"
      );
    }).join("");
  }

  async function carregar() {
    const [n, c] = await Promise.all([negocios.list(), contatos.list({ sort: "nome" })]);
    all = n;
    nomes = c.map((x) => x.nome).filter(Boolean);
    render();
  }

  let dragId = null;
  const board = $("board");
  board.addEventListener("click", (e) => {
    const el = e.target.closest(".card");
    if (el) editar(all.find((n) => n.id === el.dataset.id));
  });
  board.addEventListener("dragstart", (e) => {
    const el = e.target.closest(".card");
    if (!el) return;
    dragId = el.dataset.id;
    el.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", dragId);
  });
  board.addEventListener("dragend", () => {
    dragId = null;
    board.querySelectorAll(".dragging,.over").forEach((n) => n.classList.remove("dragging", "over"));
  });
  board.addEventListener("dragover", (e) => {
    const col = e.target.closest(".col");
    if (!col || !dragId) return;
    e.preventDefault();
    board.querySelectorAll(".over").forEach((n) => n !== col && n.classList.remove("over"));
    col.classList.add("over");
  });
  board.addEventListener("drop", async (e) => {
    const col = e.target.closest(".col");
    if (!col || !dragId) return;
    e.preventDefault();
    const id = dragId;
    const n = all.find((x) => x.id === id);
    if (n && (n.etapa || "lead") !== col.dataset.col) {
      n.etapa = col.dataset.col;
      render();
      try { await negocios.update(id, { etapa: col.dataset.col }); } catch (err) { ctx.ui.toast(err.message, "error"); await carregar(); }
    }
  });

  $("q").value = filtro;
  $("q").addEventListener("input", (e) => {
    filtro = e.target.value;
    ctx.store.set("filtro", filtro);
    render();
  });
  $("add").addEventListener("click", () => editar(null));

  $("pergunta").value = String(await ctx.store.get("pergunta", ""));
  $("pergunta").addEventListener("change", (e) => ctx.store.set("pergunta", e.target.value));
  async function perguntar() {
    const btn = $("ia");
    const texto = $("pergunta").value.trim() || "Quais negócios precisam de follow-up esta semana e por quê?";
    ctx.store.set("pergunta", $("pergunta").value);
    btn.disabled = true;
    btn.textContent = "Analisando…";
    try {
      const r = await ctx.agent.run("analista", texto);
      if (r.status !== "ok") ctx.ui.toast("A IA terminou com problemas: " + (r.error || r.status), "warn");
      if (r.result) {
        await ctx.ui.modal({
          title: "Análise do funil",
          size: "lg",
          html: '<div class="ac-stack"><div class="ac-muted">' + ctx.escape(texto) + '</div><div class="resp">' + ctx.escape(r.result) + '</div><div class="ac-row ac-row-end"><button id="ok" class="ac-btn ac-btn-primary">Fechar</button></div></div>',
          css: ".resp{white-space:pre-wrap;overflow-wrap:anywhere}",
          js: "studio.main(async (m) => { document.getElementById('ok').onclick = () => m.close(null); });",
        });
      }
    } catch (err) {
      ctx.ui.toast(err.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Perguntar à IA";
    }
  }
  $("ia").addEventListener("click", perguntar);
  $("pergunta").addEventListener("keydown", (e) => { if (e.key === "Enter") perguntar(); });

  await carregar();
  ctx.main(async () => { await carregar(); });
});
