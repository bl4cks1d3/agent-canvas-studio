// ERP: indicadores calculados a partir de erp_pedidos e erp_produtos.
studio.main(async (ctx) => {
  const brl = (n) => Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const num = (n) => Number(n || 0).toLocaleString("pt-BR");
  const status = (p) => p.status || "aberto";
  const total = (lista) => lista.reduce((s, p) => s + (Number(p.total) || 0), 0);

  const [produtos, pedidos] = await Promise.all([ctx.records("erp_produtos").list(), ctx.records("erp_pedidos").list()]);
  const faturados = pedidos.filter((p) => ["pago", "enviado"].includes(status(p)));
  const abertos = pedidos.filter((p) => status(p) === "aberto");
  const baixos = produtos.filter((p) => Number(p.minimo) > 0 && Number(p.estoque || 0) < Number(p.minimo));
  const ticket = faturados.length ? total(faturados) / faturados.length : 0;

  // mais vendidos: faturamento por produto (pedidos pagos e enviados)
  const porProduto = {};
  faturados.forEach((p) => {
    const r = porProduto[p.produto] || (porProduto[p.produto] = { nome: p.produto, unidades: 0, valor: 0 });
    r.unidades += Number(p.quantidade) || 0;
    r.valor += Number(p.total) || 0;
  });
  const top = Object.values(porProduto).sort((a, b) => b.valor - a.valor).slice(0, 5);
  const maior = Math.max(1, ...top.map((t) => t.valor));

  const card = (titulo, valor, nota, alerta) =>
    '<div class="ac-card"><div class="ac-subtitle">' + titulo + '</div><div class="ac-big' + (alerta ? " ac-danger" : "") + '">' + valor + '</div><div class="ac-muted">' + nota + "</div></div>";

  ctx.root.innerHTML =
    '<div class="kpi"><div class="cards">' +
    card("Faturamento", brl(total(faturados)), faturados.length + (faturados.length === 1 ? " pedido pago ou enviado" : " pedidos pagos ou enviados")) +
    card("Pedidos em aberto", String(abertos.length), brl(total(abertos)) + " a receber") +
    card("Abaixo do mínimo", String(baixos.length), baixos.length ? "precisam de reposição" : "estoque em dia", baixos.length > 0) +
    card("Ticket médio", brl(ticket), faturados.length ? "por pedido faturado" : "sem pedidos faturados") +
    '</div><div><div class="ac-subtitle">Produtos mais vendidos</div>' +
    (top.length
      ? top.map((t) => '<div class="top"><span class="nome">' + ctx.escape(t.nome) + '</span><span class="ac-muted">' + num(t.unidades) + " un. · " + brl(t.valor) + '</span><div class="ac-bar"><i style="width:' + Math.round((t.valor / maior) * 100) + '%"></i></div></div>').join("")
      : '<div class="ac-empty">Ainda não há pedidos pagos ou enviados.</div>') +
    "</div></div>";
});
