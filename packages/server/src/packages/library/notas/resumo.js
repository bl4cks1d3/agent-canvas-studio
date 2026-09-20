// Notas: resumo somente leitura (totais, fixadas e as últimas alteradas) da coleção notas_itens.
studio.main(async (ctx) => {
  const todas = await ctx.records("notas_itens").list();
  const tagsDe = (n) => String(n.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
  const trecho = (s) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > 80 ? t.slice(0, 80) + "…" : t; };
  const quando = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }); };
  const recentes = (l) => l.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const fixadas = recentes(todas.filter((n) => n.fixada));
  const ultimas = recentes(todas.filter((n) => !n.fixada)).slice(0, 5);
  const tags = new Set();
  todas.forEach((n) => tagsDe(n).forEach((t) => tags.add(t.toLowerCase())));

  const entrada = (n) =>
    '<div class="entrada"><b>' + ctx.escape(n.titulo) + "</b>" +
    (n.corpo ? "<small>" + ctx.escape(trecho(n.corpo)) + "</small>" : "") +
    '<div class="meta"><span class="ac-badge">' + quando(n.updatedAt) + "</span>" + tagsDe(n).slice(0, 3).map((t) => '<span class="ac-badge">' + ctx.escape(t) + "</span>").join("") + "</div></div>";
  const lista = (itens, vazio) => (itens.length ? itens.map(entrada).join("") : '<div class="ac-empty">' + vazio + "</div>");

  ctx.root.innerHTML =
    '<div class="ac-grid">' +
    '<div class="ac-card"><div class="ac-subtitle">Notas</div><div class="ac-big">' + todas.length + "</div></div>" +
    '<div class="ac-card"><div class="ac-subtitle">Fixadas</div><div class="ac-big">' + fixadas.length + "</div></div>" +
    '<div class="ac-card"><div class="ac-subtitle">Tags</div><div class="ac-big">' + tags.size + "</div></div>" +
    "</div>" +
    '<div class="secao"><div class="ac-subtitle">Fixadas</div>' + lista(fixadas, "Nenhuma nota fixada.") + "</div>" +
    '<div class="secao"><div class="ac-subtitle">Recentes</div>' + lista(ultimas, "Nenhuma outra nota.") + "</div>";
});
