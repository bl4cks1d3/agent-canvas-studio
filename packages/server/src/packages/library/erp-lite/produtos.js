// ERP: produtos e estoque (erp_produtos). Os pedidos (erp_pedidos) ligam-se ao produto pelo nome.
studio.main(async (ctx) => {
  const produtos = ctx.records("erp_produtos");
  const pedidos = ctx.records("erp_pedidos");
  const $ = (id) => document.getElementById(id);
  const brl = (n) => Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const num = (n) => Number(n || 0).toLocaleString("pt-BR");
  const chave = (s) => String(s || "").trim().toLowerCase();
  const baixo = (p) => Number(p.minimo) > 0 && Number(p.estoque || 0) < Number(p.minimo);
  let lista = [];
  let ordens = [];
  let filtro = String(await ctx.store.get("busca", ""));
  let soBaixo = (await ctx.store.get("soBaixo", false)) === true;

  const FORM_HTML =
    '<div class="ac-stack">' +
    '<div class="ac-field"><label>Nome</label><input id="nome" class="ac-input"></div>' +
    '<div class="ac-field"><label>SKU</label><input id="sku" class="ac-input" placeholder="Ex.: CAM-001"></div>' +
    '<div class="ac-row"><div class="ac-field ac-grow"><label>Preço (R$)</label><input id="preco" type="number" min="0" step="0.01" class="ac-input"></div>' +
    '<div class="ac-field ac-grow"><label>Estoque</label><input id="estoque" type="number" min="0" step="1" class="ac-input"></div>' +
    '<div class="ac-field ac-grow"><label>Mínimo</label><input id="minimo" type="number" min="0" step="1" class="ac-input"></div></div>' +
    '<div class="ac-row ac-row-between"><button id="del" class="ac-btn ac-btn-danger">Excluir</button>' +
    '<div class="ac-row"><button id="cancel" class="ac-btn">Cancelar</button><button id="save" class="ac-btn ac-btn-primary">Salvar</button></div></div>' +
    "</div>";

  function formJs(init, outros) {
    return (
      "const init = " + JSON.stringify(init) + "; const outros = " + JSON.stringify(outros) + ";" +
      "studio.main(async (m) => {" +
      " const f = (id) => document.getElementById(id);" +
      " ['nome','sku','preco','estoque','minimo'].forEach((k) => { if (init[k] !== undefined && init[k] !== null) f(k).value = init[k]; });" +
      " if (!init.id) f('del').style.display = 'none';" +
      " f('cancel').onclick = () => m.close(null);" +
      " f('del').onclick = async () => {" +
      "  const aviso = init.pedidos ? 'Excluir este produto? Os ' + init.pedidos + ' pedido(s) dele continuam no histórico.' : 'Excluir este produto?';" +
      "  if (await m.ui.confirm(aviso, { danger: true, confirmLabel: 'Excluir' })) m.close({ remove: true }); };" +
      " f('save').onclick = () => {" +
      "  const nome = f('nome').value.trim(); if (!nome) { m.ui.toast('Informe o nome', 'warn'); return; }" +
      "  if (outros.includes(nome.toLowerCase())) { m.ui.toast('Já existe um produto com esse nome', 'warn'); return; }" +
      "  const n = (k) => f(k).value === '' ? null : Number(f(k).value);" +
      "  for (const k of ['preco','estoque','minimo']) { const v = n(k); if (v !== null && (!isFinite(v) || v < 0)) { m.ui.toast('Valores não podem ser negativos', 'warn'); return; } }" +
      "  m.close({ nome: nome, sku: f('sku').value.trim() || null, preco: n('preco'), estoque: n('estoque'), minimo: n('minimo') }); };" +
      "});"
    );
  }

  async function editar(p) {
    const nPedidos = p ? ordens.filter((o) => chave(o.produto) === chave(p.nome)).length : 0;
    const init = p ? { id: p.id, nome: p.nome, sku: p.sku, preco: p.preco, estoque: p.estoque, minimo: p.minimo, pedidos: nPedidos } : { estoque: 0, minimo: 0 };
    const outros = lista.filter((x) => !p || x.id !== p.id).map((x) => chave(x.nome));
    const res = await ctx.ui.modal({ title: p ? "Editar produto" : "Novo produto", html: FORM_HTML, js: formJs(init, outros), size: "sm" });
    if (!res) return;
    try {
      if (res.remove) await produtos.remove(p.id);
      else if (p) {
        await produtos.update(p.id, res);
        // renomear mantém os pedidos ligados ao produto (o vínculo é pelo nome)
        if (res.nome !== p.nome) for (const o of ordens.filter((x) => chave(x.produto) === chave(p.nome))) await pedidos.update(o.id, { produto: res.nome });
      } else await produtos.create(res);
    } catch (err) {
      ctx.ui.toast(err.message, "error");
    }
    await carregar();
  }

  async function ajustar(p, delta) {
    const novo = Math.max(0, Number(p.estoque || 0) + delta);
    if (novo === Number(p.estoque || 0)) return;
    p.estoque = novo;
    render();
    try { await produtos.update(p.id, { estoque: novo }); } catch (err) { ctx.ui.toast(err.message, "error"); await carregar(); }
  }

  function render() {
    const q = chave(filtro);
    const itens = lista
      .filter((p) => (!q || [p.nome, p.sku].join(" ").toLowerCase().includes(q)) && (!soBaixo || baixo(p)))
      .sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR"));
    $("linhas").innerHTML = itens.map((p) => {
      const b = baixo(p);
      return (
        '<tr data-id="' + ctx.escape(p.id) + '"><td><b>' + ctx.escape(p.nome) + "</b>" + (p.sku ? "<small>" + ctx.escape(p.sku) + "</small>" : "") + (b ? '<small class="ac-danger">abaixo do mínimo</small>' : "") + "</td>" +
        "<td>" + (p.preco === undefined ? '<span class="ac-muted">—</span>' : brl(p.preco)) + "</td>" +
        '<td class="estoque"><button class="ac-btn ac-btn-sm" data-act="menos" title="Tirar 1 do estoque">−</button><span class="ac-badge' + (b ? " ac-badge-danger" : "") + '">' + num(p.estoque) + '</span><button class="ac-btn ac-btn-sm" data-act="mais" title="Adicionar 1 ao estoque">+</button></td>' +
        "<td>" + (p.minimo === undefined ? '<span class="ac-muted">—</span>' : num(p.minimo)) + "</td>" +
        '<td class="acoes"><button class="ac-btn ac-btn-sm" data-act="edit">Editar</button></td></tr>'
      );
    }).join("");
    const vazio = $("vazio");
    vazio.hidden = itens.length > 0;
    vazio.textContent = lista.length ? "Nenhum produto encontrado com esse filtro." : "Nenhum produto ainda. Clique em “+ Produto” para começar.";
  }

  async function carregar() {
    [lista, ordens] = await Promise.all([produtos.list(), pedidos.list()]);
    render();
  }

  $("linhas").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act]");
    const tr = e.target.closest("tr");
    if (!btn || !tr) return;
    const p = lista.find((x) => x.id === tr.dataset.id);
    if (!p) return;
    if (btn.dataset.act === "menos") ajustar(p, -1);
    else if (btn.dataset.act === "mais") ajustar(p, 1);
    else editar(p);
  });
  $("q").value = filtro;
  $("q").addEventListener("input", (e) => {
    filtro = e.target.value;
    ctx.store.set("busca", filtro);
    render();
  });
  $("baixo").checked = soBaixo;
  $("baixo").addEventListener("change", (e) => {
    soBaixo = e.target.checked;
    ctx.store.set("soBaixo", soBaixo);
    render();
  });
  $("add").addEventListener("click", () => editar(null));

  $("ia").addEventListener("click", async () => {
    const btn = $("ia");
    btn.disabled = true;
    btn.textContent = "Analisando…";
    try {
      const r = await ctx.agent.run("reposicao", "Monte a lista de reposição de estoque.");
      if (r.status !== "ok") ctx.ui.toast("A IA terminou com problemas: " + (r.error || r.status), "warn");
      if (r.result) {
        await ctx.ui.modal({
          title: "Sugestão de reposição",
          size: "lg",
          html: '<div class="ac-stack"><div class="resp">' + ctx.escape(r.result) + '</div><div class="ac-row ac-row-end"><button id="ok" class="ac-btn ac-btn-primary">Fechar</button></div></div>',
          css: ".resp{white-space:pre-wrap;overflow-wrap:anywhere}",
          js: "studio.main(async (m) => { document.getElementById('ok').onclick = () => m.close(null); });",
        });
      }
    } catch (err) {
      ctx.ui.toast(err.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Sugerir reposição (IA)";
    }
  });

  await carregar();
  ctx.main(async () => { await carregar(); });
});
