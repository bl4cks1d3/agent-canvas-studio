// Quadro Kanban: registros da coleção kanban_cartoes; cada coluna é o campo "coluna".
studio.main(async (ctx) => {
  const COLS = [["a-fazer", "A fazer"], ["fazendo", "Fazendo"], ["revisao", "Revisão"], ["feito", "Feito"]];
  const PRIO = { alta: "ac-badge-danger", media: "ac-badge-warn", baixa: "" };
  const cards = ctx.records("kanban_cartoes");
  const $ = (id) => document.getElementById(id);
  let all = [];
  let filter = "";

  const FORM_HTML =
    '<div class="ac-stack">' +
    '<div class="ac-field"><label>Título</label><input id="titulo" class="ac-input"></div>' +
    '<div class="ac-field"><label>Descrição</label><textarea id="descricao" class="ac-textarea"></textarea></div>' +
    '<div class="ac-row"><div class="ac-field ac-grow"><label>Coluna</label><select id="coluna" class="ac-select">' +
    '<option value="a-fazer">A fazer</option><option value="fazendo">Fazendo</option><option value="revisao">Revisão</option><option value="feito">Feito</option></select></div>' +
    '<div class="ac-field ac-grow"><label>Prioridade</label><select id="prioridade" class="ac-select"><option value="baixa">Baixa</option><option value="media">Média</option><option value="alta">Alta</option></select></div></div>' +
    '<div class="ac-row"><div class="ac-field ac-grow"><label>Responsável</label><input id="responsavel" class="ac-input"></div>' +
    '<div class="ac-field ac-grow"><label>Prazo</label><input id="prazo" type="date" class="ac-input"></div></div>' +
    '<div class="ac-row ac-row-between"><button id="del" class="ac-btn ac-btn-danger">Excluir</button>' +
    '<div class="ac-row"><button id="cancel" class="ac-btn">Cancelar</button><button id="save" class="ac-btn ac-btn-primary">Salvar</button></div></div>' +
    '</div>';

  function formJs(init) {
    return (
      "const init = " + JSON.stringify(init) + ";" +
      "studio.main(async (m) => {" +
      " const f = (id) => document.getElementById(id);" +
      " ['titulo','descricao','coluna','prioridade','responsavel','prazo'].forEach((k) => { if (init[k]) f(k).value = init[k]; });" +
      " if (!init.id) f('del').style.display = 'none';" +
      " f('cancel').onclick = () => m.close(null);" +
      " f('del').onclick = async () => { if (await m.ui.confirm('Excluir este cartão?', { danger: true, confirmLabel: 'Excluir' })) m.close({ remove: true }); };" +
      " f('save').onclick = () => { const t = f('titulo').value.trim(); if (!t) { m.ui.toast('Informe o título', 'warn'); return; }" +
      "  m.close({ titulo: t, descricao: f('descricao').value, coluna: f('coluna').value, prioridade: f('prioridade').value, responsavel: f('responsavel').value, prazo: f('prazo').value || null }); };" +
      "});"
    );
  }

  async function edit(card) {
    const init = card || { coluna: "a-fazer", prioridade: "media" };
    const res = await ctx.ui.modal({ title: card ? "Editar cartão" : "Novo cartão", html: FORM_HTML, js: formJs(init), size: "sm" });
    if (!res) return;
    if (res.remove) await cards.remove(card.id);
    else if (card) await cards.update(card.id, res);
    else await cards.create(res);
    await load();
  }

  function render() {
    const q = filter.toLowerCase();
    const visible = all.filter((c) => !q || [c.titulo, c.descricao, c.responsavel].join(" ").toLowerCase().includes(q));
    $("board").innerHTML = COLS.map(([key, label]) => {
      const items = visible.filter((c) => (c.coluna || "a-fazer") === key);
      return (
        '<section class="col" data-col="' + key + '"><div class="col-head"><b>' + label + '</b><span class="ac-badge">' + items.length + "</span></div>" +
        items.map((c) =>
          '<div class="card" draggable="true" data-id="' + ctx.escape(c.id) + '"><b>' + ctx.escape(c.titulo) + "</b>" +
          (c.descricao ? "<small>" + ctx.escape(c.descricao) + "</small>" : "") +
          '<div class="meta">' +
          (c.prioridade ? '<span class="ac-badge ' + (PRIO[c.prioridade] || "") + '">' + c.prioridade + "</span>" : "") +
          (c.responsavel ? '<span class="ac-badge">' + ctx.escape(c.responsavel) + "</span>" : "") +
          (c.prazo ? '<span class="ac-badge">' + ctx.escape(String(c.prazo).slice(0, 10)) + "</span>" : "") +
          "</div></div>"
        ).join("") + "</section>"
      );
    }).join("");
  }

  async function load() {
    all = await cards.list();
    render();
  }

  let dragId = null;
  const board = $("board");
  board.addEventListener("click", (e) => {
    const el = e.target.closest(".card");
    if (el) edit(all.find((c) => c.id === el.dataset.id));
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
    const card = all.find((c) => c.id === id);
    if (card && card.coluna !== col.dataset.col) {
      card.coluna = col.dataset.col;
      render();
      try { await cards.update(id, { coluna: col.dataset.col }); } catch (err) { ctx.ui.toast(err.message, "error"); await load(); }
    }
  });
  $("q").addEventListener("input", (e) => { filter = e.target.value; render(); });
  $("add").addEventListener("click", () => edit(null));
  $("ia").addEventListener("click", async () => {
    const goal = await ctx.ui.modal({
      title: "Planejar com IA",
      size: "sm",
      html: '<div class="ac-stack"><div class="ac-muted">Descreva o objetivo. Um agente cria os cartões no quadro.</div><textarea id="goal" class="ac-textarea" placeholder="Ex.: lançar um site de portfólio com blog"></textarea><div class="ac-row ac-row-end"><button id="cancel" class="ac-btn">Cancelar</button><button id="go" class="ac-btn ac-btn-primary">Criar cartões</button></div></div>',
      js: "studio.main(async (m) => { const f = (i) => document.getElementById(i); f('cancel').onclick = () => m.close(null); f('go').onclick = () => { const v = f('goal').value.trim(); if (v) m.close(v); }; });",
    });
    if (!goal) return;
    const btn = $("ia");
    btn.disabled = true;
    btn.textContent = "Planejando…";
    try {
      const r = await ctx.agent.run("planejador", goal);
      ctx.ui.toast(r.status === "ok" ? "Cartões criados pelo agente" : "O agente terminou com problemas: " + (r.error || r.status), r.status === "ok" ? "ok" : "warn");
    } catch (err) {
      ctx.ui.toast(err.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Planejar com IA";
      await load();
    }
  });

  await load();
  ctx.main(async () => { await load(); });
});
