// ERP: pedidos (erp_pedidos). Criar um pedido baixa o estoque do produto (erp_produtos); cancelar (ou excluir) devolve.
// O vínculo com o produto é pelo nome; o total é preço x quantidade no momento da criação.
studio.main(async (ctx) => {
  const pedidos = ctx.records("erp_pedidos");
  const produtos = ctx.records("erp_produtos");
  const STATUS = [["aberto", "Aberto"], ["pago", "Pago"], ["enviado", "Enviado"], ["cancelado", "Cancelado"]];
  const $ = (id) => document.getElementById(id);
  const brl = (n) => Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const chave = (s) => String(s || "").trim().toLowerCase();
  const arred = (n) => Math.round(n * 100) / 100;
  const dataBr = (d) => { const p = String(d || "").slice(0, 10).split("-"); return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : ""; };
  const hoje = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const statusDe = (p) => p.status || "aberto";
  let lista = [];
  let filtro = String(await ctx.store.get("busca", ""));
  let filtroStatus = String(await ctx.store.get("status", ""));

  const FORM_HTML =
    '<div class="ac-stack">' +
    '<div class="ac-field"><label>Cliente</label><input id="cliente" class="ac-input"></div>' +
    '<div class="ac-field"><label>Produto</label><select id="produto" class="ac-select"></select></div>' +
    '<div class="ac-row"><div class="ac-field ac-grow"><label>Quantidade</label><input id="quantidade" type="number" min="1" step="1" value="1" class="ac-input"></div>' +
    '<div class="ac-field ac-grow"><label>Data</label><input id="data" type="date" class="ac-input"></div></div>' +
    '<div class="ac-field"><label>Status inicial</label><select id="status" class="ac-select"><option value="aberto">Aberto</option><option value="pago">Pago</option><option value="enviado">Enviado</option></select></div>' +
    '<div class="ac-card"><div class="ac-row ac-row-between"><span id="info" class="ac-muted"></span><b id="total"></b></div></div>' +
    '<div class="ac-row ac-row-end"><button id="cancel" class="ac-btn">Cancelar</button><button id="save" class="ac-btn ac-btn-primary">Criar pedido</button></div>' +
    "</div>";

  function formJs(prods, dia) {
    return (
      "const prods = " + JSON.stringify(prods) + "; const dia = " + JSON.stringify(dia) + ";" +
      "studio.main(async (m) => {" +
      " const f = (id) => document.getElementById(id);" +
      " const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });" +
      " prods.forEach((p, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = p.nome + (p.sku ? ' (' + p.sku + ')' : '') + ' — ' + brl(p.preco) + (p.estoque > 0 ? '' : ' — sem estoque'); o.disabled = !(p.estoque > 0); f('produto').appendChild(o); });" +
      " const primeiro = prods.findIndex((p) => p.estoque > 0); if (primeiro >= 0) f('produto').value = String(primeiro);" +
      " f('data').value = dia;" +
      " const atual = () => prods[Number(f('produto').value)];" +
      " const qtd = () => Number(f('quantidade').value);" +
      " const calc = () => { const p = atual(); if (!p) return; const q = qtd(); const ok = Number.isInteger(q) && q >= 1;" +
      "  f('total').textContent = ok ? brl(Math.round(p.preco * q * 100) / 100) : '—';" +
      "  f('info').textContent = 'Em estoque: ' + p.estoque + (ok && q > p.estoque ? ' (quantidade acima do estoque)' : '');" +
      "  f('info').className = ok && q > p.estoque ? 'ac-danger' : 'ac-muted'; };" +
      " ['produto','quantidade'].forEach((id) => { f(id).addEventListener('input', calc); f(id).addEventListener('change', calc); });" +
      " calc();" +
      " f('cancel').onclick = () => m.close(null);" +
      " f('save').onclick = () => {" +
      "  const p = atual(); const q = qtd(); const cliente = f('cliente').value.trim();" +
      "  if (!cliente) { m.ui.toast('Informe o cliente', 'warn'); return; }" +
      "  if (!p || !(p.estoque > 0)) { m.ui.toast('Escolha um produto com estoque', 'warn'); return; }" +
      "  if (!Number.isInteger(q) || q < 1) { m.ui.toast('A quantidade deve ser um número inteiro maior que zero', 'warn'); return; }" +
      "  if (q > p.estoque) { m.ui.toast('Estoque insuficiente: só há ' + p.estoque + ' unidade(s) de ' + p.nome, 'warn'); return; }" +
      "  m.close({ cliente: cliente, produto: p.nome, quantidade: q, data: f('data').value || null, status: f('status').value }); };" +
      "});"
    );
  }

  async function produtoPorNome(nome) {
    const todos = await produtos.list();
    return todos.find((p) => chave(p.nome) === chave(nome)) || null;
  }

  async function novoPedido() {
    const todos = await produtos.list();
    if (!todos.length) { ctx.ui.toast("Cadastre um produto antes de criar pedidos", "warn"); return; }
    const prods = todos.slice().sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR")).map((p) => ({ nome: p.nome, sku: p.sku || "", preco: Number(p.preco) || 0, estoque: Number(p.estoque) || 0 }));
    const res = await ctx.ui.modal({ title: "Novo pedido", html: FORM_HTML, js: formJs(prods, hoje()), size: "sm" });
    if (!res) return;
    // confere de novo com o estoque de agora (pode ter mudado com o modal aberto)
    const p = await produtoPorNome(res.produto);
    if (!p) { ctx.ui.toast("Produto não encontrado", "error"); return; }
    const estoque = Number(p.estoque) || 0;
    if (res.quantidade > estoque) { ctx.ui.toast("Estoque insuficiente: só há " + estoque + " unidade(s) de " + p.nome, "warn"); return; }
    let criado = null;
    try {
      criado = await pedidos.create({ cliente: res.cliente, produto: p.nome, quantidade: res.quantidade, total: arred((Number(p.preco) || 0) * res.quantidade), status: res.status, data: res.data });
      await produtos.update(p.id, { estoque: estoque - res.quantidade });
      ctx.ui.toast("Pedido criado; estoque de " + p.nome + ": " + (estoque - res.quantidade), "ok");
    } catch (err) {
      if (criado) { try { await pedidos.remove(criado.id); } catch (e) { /* o pedido fica sem baixa: avisa abaixo */ } }
      ctx.ui.toast("Não foi possível criar o pedido: " + err.message, "error");
    }
    await carregar();
  }

  // trocar o status; cancelar devolve o estoque e reabrir um cancelado baixa de novo
  async function mudarStatus(pedido, novo) {
    const antigo = statusDe(pedido);
    if (novo === antigo) return;
    const qtd = Number(pedido.quantidade) || 0;
    let ajuste = 0; // variação aplicada ao estoque do produto
    let prod = null;
    try {
      if (novo === "cancelado" || antigo === "cancelado") {
        prod = await produtoPorNome(pedido.produto);
        if (novo === "cancelado") {
          if (prod) ajuste = qtd;
          else ctx.ui.toast('Produto "' + pedido.produto + '" não existe mais: nenhum estoque foi devolvido', "warn");
        } else {
          if (!prod) { ctx.ui.toast('Produto "' + pedido.produto + '" não existe mais: não dá para reabrir o pedido', "warn"); await carregar(); return; }
          if ((Number(prod.estoque) || 0) < qtd) { ctx.ui.toast("Estoque insuficiente para reabrir: só há " + (Number(prod.estoque) || 0) + " unidade(s) de " + prod.nome, "warn"); await carregar(); return; }
          ajuste = -qtd;
        }
        if (ajuste) await produtos.update(prod.id, { estoque: (Number(prod.estoque) || 0) + ajuste });
      }
      try {
        await pedidos.update(pedido.id, { status: novo });
      } catch (err) {
        if (ajuste) await produtos.update(prod.id, { estoque: Number(prod.estoque) || 0 });
        throw err;
      }
      if (novo === "cancelado" && ajuste) ctx.ui.toast(qtd + " unidade(s) de " + prod.nome + " voltaram ao estoque", "ok");
    } catch (err) {
      ctx.ui.toast(err.message, "error");
    }
    await carregar();
  }

  async function excluir(pedido) {
    const devolve = statusDe(pedido) !== "cancelado";
    const msg = 'Excluir o pedido de "' + pedido.cliente + '"?' + (devolve ? " As " + (Number(pedido.quantidade) || 0) + " unidade(s) voltam ao estoque." : "");
    if (!(await ctx.ui.confirm(msg, { danger: true, confirmLabel: "Excluir" }))) return;
    try {
      const prod = devolve ? await produtoPorNome(pedido.produto) : null;
      await pedidos.remove(pedido.id);
      if (prod) await produtos.update(prod.id, { estoque: (Number(prod.estoque) || 0) + (Number(pedido.quantidade) || 0) });
    } catch (err) {
      ctx.ui.toast(err.message, "error");
    }
    await carregar();
  }

  function render() {
    const q = chave(filtro);
    const itens = lista
      .filter((p) => (!filtroStatus || statusDe(p) === filtroStatus) && (!q || [p.cliente, p.produto].join(" ").toLowerCase().includes(q)))
      .sort((a, b) => String(b.data || "").localeCompare(String(a.data || "")) || String(b.createdAt).localeCompare(String(a.createdAt)));
    $("linhas").innerHTML = itens.map((p) => {
      const s = statusDe(p);
      return (
        '<tr class="' + s + '" data-id="' + ctx.escape(p.id) + '"><td class="num">' + dataBr(p.data) + "</td><td>" + ctx.escape(p.cliente) + "</td><td>" + ctx.escape(p.produto) + '</td><td class="num">' + (Number(p.quantidade) || 0) + '</td><td class="num">' + brl(p.total) + "</td>" +
        '<td><select class="ac-select" data-act="status" style="width:auto">' + STATUS.map(([k, r]) => '<option value="' + k + '"' + (k === s ? " selected" : "") + ">" + r + "</option>").join("") + "</select></td>" +
        '<td class="acoes"><button class="ac-btn ac-btn-sm ac-btn-danger" data-act="del">Excluir</button></td></tr>'
      );
    }).join("");
    const vazio = $("vazio");
    vazio.hidden = itens.length > 0;
    vazio.textContent = lista.length ? "Nenhum pedido encontrado com esse filtro." : "Nenhum pedido ainda. Clique em “+ Pedido” para começar.";
    const validos = itens.filter((p) => statusDe(p) !== "cancelado");
    $("soma").textContent = itens.length ? itens.length + (itens.length === 1 ? " pedido" : " pedidos") + " · " + brl(validos.reduce((s, p) => s + (Number(p.total) || 0), 0)) + " (sem os cancelados)" : "";
  }

  async function carregar() {
    lista = await pedidos.list();
    render();
  }

  $("linhas").addEventListener("change", (e) => {
    const sel = e.target.closest("select[data-act=status]");
    const tr = e.target.closest("tr");
    if (!sel || !tr) return;
    const p = lista.find((x) => x.id === tr.dataset.id);
    if (p) mudarStatus(p, sel.value);
  });
  $("linhas").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act=del]");
    const tr = e.target.closest("tr");
    if (!btn || !tr) return;
    const p = lista.find((x) => x.id === tr.dataset.id);
    if (p) excluir(p);
  });
  $("q").value = filtro;
  $("q").addEventListener("input", (e) => {
    filtro = e.target.value;
    ctx.store.set("busca", filtro);
    render();
  });
  $("filtro").value = filtroStatus;
  $("filtro").addEventListener("change", (e) => {
    filtroStatus = e.target.value;
    ctx.store.set("status", filtroStatus);
    render();
  });
  $("add").addEventListener("click", novoPedido);

  await carregar();
  ctx.main(async () => { await carregar(); });
});
