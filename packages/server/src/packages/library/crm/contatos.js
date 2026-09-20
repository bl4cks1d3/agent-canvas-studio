// CRM: contatos (crm_contatos). A quantidade de negócios vem de crm_negocios, casando pelo nome do contato.
studio.main(async (ctx) => {
  const ORIGENS = [["indicacao", "Indicação"], ["site", "Site"], ["evento", "Evento"], ["redes-sociais", "Redes sociais"], ["prospeccao", "Prospecção"], ["outro", "Outro"]];
  const contatos = ctx.records("crm_contatos");
  const negocios = ctx.records("crm_negocios");
  const $ = (id) => document.getElementById(id);
  const brl = (n) => Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const chave = (s) => String(s || "").trim().toLowerCase();
  const rotuloOrigem = (o) => (ORIGENS.find((x) => x[0] === o) || [0, o || ""])[1];
  let lista = [];
  let deals = [];
  let filtro = String(await ctx.store.get("busca", ""));
  let ordem = String(await ctx.store.get("ordem", "nome"));

  const FORM_HTML =
    '<div class="ac-stack">' +
    '<div class="ac-field"><label>Nome</label><input id="nome" class="ac-input"></div>' +
    '<div class="ac-field"><label>Empresa</label><input id="empresa" class="ac-input"></div>' +
    '<div class="ac-row"><div class="ac-field ac-grow"><label>E-mail</label><input id="email" type="email" class="ac-input"></div>' +
    '<div class="ac-field ac-grow"><label>Telefone</label><input id="telefone" class="ac-input"></div></div>' +
    '<div class="ac-field"><label>Origem</label><select id="origem" class="ac-select"><option value="">—</option>' +
    ORIGENS.map(([k, r]) => '<option value="' + k + '">' + r + "</option>").join("") +
    "</select></div>" +
    '<div class="ac-field"><label>Notas</label><textarea id="notas" class="ac-textarea"></textarea></div>' +
    '<div class="ac-row ac-row-between"><button id="del" class="ac-btn ac-btn-danger">Excluir</button>' +
    '<div class="ac-row"><button id="cancel" class="ac-btn">Cancelar</button><button id="save" class="ac-btn ac-btn-primary">Salvar</button></div></div>' +
    "</div>";

  function formJs(init) {
    return (
      "const init = " + JSON.stringify(init) + ";" +
      "studio.main(async (m) => {" +
      " const f = (id) => document.getElementById(id);" +
      " ['nome','empresa','email','telefone','origem','notas'].forEach((k) => { if (init[k]) f(k).value = init[k]; });" +
      " if (!init.id) f('del').style.display = 'none';" +
      " f('cancel').onclick = () => m.close(null);" +
      " f('del').onclick = async () => {" +
      "  const aviso = init.negocios ? 'Excluir este contato? Os ' + init.negocios + ' negócio(s) dele continuam no funil.' : 'Excluir este contato?';" +
      "  if (await m.ui.confirm(aviso, { danger: true, confirmLabel: 'Excluir' })) m.close({ remove: true }); };" +
      " f('save').onclick = () => { const n = f('nome').value.trim(); if (!n) { m.ui.toast('Informe o nome', 'warn'); return; }" +
      "  const v = (k) => f(k).value.trim() || null;" +
      "  m.close({ nome: n, empresa: v('empresa'), email: v('email'), telefone: v('telefone'), origem: f('origem').value || null, notas: v('notas') }); };" +
      "});"
    );
  }

  function negociosDe(c) {
    return deals.filter((d) => chave(d.contato) && chave(d.contato) === chave(c.nome));
  }

  async function editar(c) {
    const init = c ? { id: c.id, nome: c.nome, empresa: c.empresa, email: c.email, telefone: c.telefone, origem: c.origem, notas: c.notas, negocios: negociosDe(c).length } : {};
    const res = await ctx.ui.modal({ title: c ? "Editar contato" : "Novo contato", html: FORM_HTML, js: formJs(init), size: "sm" });
    if (!res) return;
    try {
      if (res.remove) await contatos.remove(c.id);
      else if (c) {
        const vinculados = negociosDe(c);
        await contatos.update(c.id, res);
        // renomear o contato mantém os negócios ligados a ele (o vínculo é pelo nome)
        if (res.nome !== c.nome) for (const d of vinculados) await negocios.update(d.id, { contato: res.nome });
      } else await contatos.create(res);
    } catch (err) {
      ctx.ui.toast(err.message, "error");
    }
    await carregar();
  }

  function render() {
    const q = chave(filtro);
    let itens = lista.filter((c) => !q || [c.nome, c.empresa, c.email, c.telefone, c.notas].join(" ").toLowerCase().includes(q));
    const qtd = (c) => negociosDe(c).length;
    itens = itens.slice().sort((a, b) => {
      if (ordem === "negocios") return qtd(b) - qtd(a) || String(a.nome).localeCompare(String(b.nome));
      const x = String(a[ordem] || "");
      const y = String(b[ordem] || "");
      if (!x !== !y) return x ? -1 : 1; // vazios por último
      return x.localeCompare(y, "pt-BR");
    });
    $("linhas").innerHTML = itens.map((c) => {
      const ns = negociosDe(c);
      const total = ns.reduce((s, d) => s + (Number(d.valor) || 0), 0);
      return (
        '<tr data-id="' + ctx.escape(c.id) + '"><td><b>' + ctx.escape(c.nome) + "</b>" + (c.email ? "<small>" + ctx.escape(c.email) + "</small>" : "") + "</td>" +
        "<td>" + ctx.escape(c.empresa || "") + "</td><td>" + ctx.escape(c.telefone || "") + "</td>" +
        "<td>" + (c.origem ? '<span class="ac-badge">' + ctx.escape(rotuloOrigem(c.origem)) + "</span>" : "") + "</td>" +
        "<td>" + (ns.length ? '<span class="ac-badge ac-badge-accent" title="' + ctx.escape(brl(total)) + ' em negócios">' + ns.length + "</span>" : '<span class="ac-muted">0</span>') + "</td>" +
        '<td class="acoes"><button class="ac-btn ac-btn-sm" data-act="edit">Editar</button><button class="ac-btn ac-btn-sm ac-btn-danger" data-act="del">Excluir</button></td></tr>'
      );
    }).join("");
    const vazio = $("vazio");
    vazio.hidden = itens.length > 0;
    vazio.textContent = lista.length ? "Nenhum contato encontrado para a busca." : "Nenhum contato ainda. Clique em “+ Contato” para começar.";
  }

  async function carregar() {
    [lista, deals] = await Promise.all([contatos.list(), negocios.list()]);
    render();
  }

  $("linhas").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    const tr = e.target.closest("tr");
    if (!tr) return;
    const c = lista.find((x) => x.id === tr.dataset.id);
    if (!c) return;
    if (btn && btn.dataset.act === "del") {
      if (!(await ctx.ui.confirm('Excluir o contato "' + c.nome + '"?', { danger: true, confirmLabel: "Excluir" }))) return;
      try { await contatos.remove(c.id); } catch (err) { ctx.ui.toast(err.message, "error"); }
      await carregar();
    } else editar(c);
  });
  $("q").value = filtro;
  $("q").addEventListener("input", (e) => {
    filtro = e.target.value;
    ctx.store.set("busca", filtro);
    render();
  });
  $("ordem").value = ordem;
  $("ordem").addEventListener("change", (e) => {
    ordem = e.target.value;
    ctx.store.set("ordem", ordem);
    render();
  });
  $("add").addEventListener("click", () => editar(null));

  await carregar();
  ctx.main(async () => { await carregar(); });
});
