// Notas: caderno de duas colunas sobre a coleção notas_itens. O editor só grava ao clicar em Salvar (ou Ctrl+S).
studio.main(async (ctx) => {
  const notas = ctx.records("notas_itens");
  const $ = (id) => document.getElementById(id);
  let all = [];
  let sel = null; // id da nota aberta; null com `novo` = rascunho de uma nota nova
  let novo = false;
  let snap = null; // valores como estão gravados (para saber se há alterações)
  let busca = String(await ctx.store.get("busca", ""));
  let tagAtiva = String(await ctx.store.get("tag", ""));

  const tagsDe = (n) => String((n && n.tags) || "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  const normTags = (s) => Array.from(new Set(String(s || "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))).join(", ");
  const quando = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }); };
  const trecho = (s) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > 90 ? t.slice(0, 90) + "…" : t; };
  const atual = () => ({ titulo: $("titulo").value.trim(), corpo: $("corpo").value, tags: normTags($("tagsin").value), fixada: $("fixada").checked });
  const igual = (a, b) => a.titulo === b.titulo && a.corpo === b.corpo && a.tags === b.tags && a.fixada === b.fixada;
  const daNota = (n) => ({ titulo: n.titulo || "", corpo: n.corpo || "", tags: normTags(n.tags), fixada: !!n.fixada });
  const sujo = () => !!snap && !igual(atual(), snap);

  function ordenadas() {
    return all.slice().sort((a, b) => (b.fixada ? 1 : 0) - (a.fixada ? 1 : 0) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  function atualizarEstado() {
    const s = sujo();
    const badge = $("estado");
    badge.textContent = novo ? (s ? "Nota nova (não salva)" : "Nota nova") : s ? "Alterações não salvas" : "Salvo";
    badge.className = "ac-badge" + (s ? " ac-badge-warn" : novo ? "" : " ac-badge-ok");
    $("salvar").disabled = !s;
    $("excluir").hidden = novo;
    const palavras = ($("corpo").value.trim().match(/\S+/g) || []).length;
    const n = all.find((x) => x.id === sel);
    $("meta").textContent = palavras + (palavras === 1 ? " palavra" : " palavras") + (n && !novo ? " · alterada em " + quando(n.updatedAt) : "");
  }

  function renderTags() {
    const cont = {};
    all.forEach((n) => tagsDe(n).forEach((t) => (cont[t] = (cont[t] || 0) + 1)));
    const nomes = Object.keys(cont).sort((a, b) => cont[b] - cont[a] || a.localeCompare(b));
    if (tagAtiva && !cont[tagAtiva]) tagAtiva = "";
    $("tags").innerHTML = nomes.map((t) => '<span class="ac-badge chip' + (t === tagAtiva ? " ac-badge-accent" : "") + '" data-tag="' + ctx.escape(t) + '">' + ctx.escape(t) + " " + cont[t] + "</span>").join("");
  }

  function renderLista() {
    renderTags();
    const q = busca.trim().toLowerCase();
    const itens = ordenadas().filter((n) => (!tagAtiva || tagsDe(n).includes(tagAtiva)) && (!q || [n.titulo, n.corpo, n.tags].join(" ").toLowerCase().includes(q)));
    $("itens").innerHTML = itens.map((n) =>
      '<div class="item' + (n.id === sel && !novo ? " sel" : "") + '" data-id="' + ctx.escape(n.id) + '"><div class="ac-row ac-row-between"><b>' + ctx.escape(n.titulo) + "</b>" + (n.fixada ? '<span class="ac-badge ac-badge-accent">fixada</span>' : "") + "</div>" +
      (n.corpo ? "<small>" + ctx.escape(trecho(n.corpo)) + "</small>" : "") +
      (tagsDe(n).length ? '<div class="meta">' + tagsDe(n).map((t) => '<span class="ac-badge">' + ctx.escape(t) + "</span>").join("") + "</div>" : "") +
      "</div>"
    ).join("");
    $("semitens").hidden = itens.length > 0;
    $("semitens").textContent = all.length ? "Nenhuma nota corresponde à busca." : "Nenhuma nota ainda. Clique em “+ Nova”.";
  }

  function preencher(v, n) {
    $("titulo").value = v.titulo;
    $("corpo").value = v.corpo;
    $("tagsin").value = v.tags;
    $("fixada").checked = v.fixada;
    $("vazio").hidden = true;
    $("form").hidden = false;
    snap = n ? daNota(n) : atual();
    atualizarEstado();
  }

  function mostrarVazio() {
    sel = null;
    novo = false;
    snap = null;
    $("form").hidden = true;
    $("vazio").hidden = false;
    ctx.store.remove("selecionada");
  }

  function abrir(id) {
    const n = all.find((x) => x.id === id);
    if (!n) return mostrarVazio();
    sel = id;
    novo = false;
    preencher(daNota(n), n);
    ctx.store.set("selecionada", id);
    renderLista();
  }

  // trocar de nota / criar outra com alterações pendentes pede confirmação
  async function podeSair() {
    if (!sujo()) return true;
    return ctx.ui.confirm("Descartar as alterações não salvas desta nota?", { danger: true, confirmLabel: "Descartar" });
  }

  async function criar() {
    if (!(await podeSair())) return;
    sel = null;
    novo = true;
    preencher({ titulo: "", corpo: "", tags: tagAtiva || "", fixada: false }, null);
    ctx.store.remove("selecionada");
    renderLista();
    $("titulo").focus();
  }

  async function salvar() {
    const v = atual();
    if (!v.titulo) { ctx.ui.toast("Dê um título à nota", "warn"); $("titulo").focus(); return; }
    // null limpa o campo no banco (texto vazio seria ignorado)
    const dados = { titulo: v.titulo, corpo: v.corpo.trim() ? v.corpo : null, tags: v.tags || null, fixada: v.fixada };
    $("salvar").disabled = true;
    try {
      const gravada = novo ? await notas.create(dados) : await notas.update(sel, dados);
      sel = gravada.id;
      novo = false;
      await carregar(true);
      abrir(sel);
      ctx.ui.toast("Nota salva", "ok");
    } catch (err) {
      ctx.ui.toast(err.message, "error");
      atualizarEstado();
    }
  }

  async function excluir() {
    const n = all.find((x) => x.id === sel);
    if (!n || novo) return;
    if (!(await ctx.ui.confirm('Excluir a nota "' + n.titulo + '"? Isso não pode ser desfeito.', { danger: true, confirmLabel: "Excluir" }))) return;
    try {
      await notas.remove(n.id);
    } catch (err) {
      ctx.ui.toast(err.message, "error");
      return;
    }
    const lista = ordenadas();
    const i = lista.findIndex((x) => x.id === n.id);
    await carregar(true);
    const prox = ordenadas()[Math.min(i, all.length - 1)];
    if (prox) abrir(prox.id); else { mostrarVazio(); renderLista(); }
    ctx.ui.toast("Nota excluída", "ok");
  }

  async function resumir() {
    const v = atual();
    if (!v.corpo.trim()) { ctx.ui.toast("A nota está vazia: escreva algo para resumir", "warn"); return; }
    const btn = $("ia");
    btn.disabled = true;
    btn.textContent = "Resumindo…";
    try {
      const r = await ctx.agent.run("resumir", "Título: " + (v.titulo || "(sem título)") + "\n\n" + v.corpo);
      if (r.status !== "ok") ctx.ui.toast("A IA terminou com problemas: " + (r.error || r.status), "warn");
      if (r.result) {
        const acao = await ctx.ui.modal({
          title: "Resumo da nota",
          size: "md",
          html: '<div class="ac-stack"><div class="resp">' + ctx.escape(r.result) + '</div><div class="ac-row ac-row-end"><button id="ok" class="ac-btn">Fechar</button><button id="anexar" class="ac-btn ac-btn-primary">Anexar à nota</button></div></div>',
          css: ".resp{white-space:pre-wrap;overflow-wrap:anywhere}",
          js: "studio.main(async (m) => { document.getElementById('ok').onclick = () => m.close(null); document.getElementById('anexar').onclick = () => m.close('anexar'); });",
        });
        if (acao === "anexar") {
          const c = $("corpo");
          c.value = c.value.replace(/\s+$/, "") + "\n\n— Resumo da IA —\n" + r.result;
          atualizarEstado();
        }
      }
    } catch (err) {
      ctx.ui.toast(err.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Resumir com IA";
    }
  }

  async function carregar(silencioso) {
    all = await notas.list();
    renderLista();
    if (silencioso) return;
    // atualização periódica: sem mexer no que o usuário está digitando
    if (sel && !novo) {
      const n = all.find((x) => x.id === sel);
      if (!n) { if (!sujo()) mostrarVazio(); }
      else if (!sujo() && (!snap || !igual(snap, daNota(n)))) preencher(daNota(n), n);
    }
  }

  $("itens").addEventListener("click", async (e) => {
    const el = e.target.closest(".item");
    if (!el || (el.dataset.id === sel && !novo)) return;
    if (await podeSair()) abrir(el.dataset.id);
  });
  $("tags").addEventListener("click", (e) => {
    const el = e.target.closest(".chip");
    if (!el) return;
    tagAtiva = tagAtiva === el.dataset.tag ? "" : el.dataset.tag;
    ctx.store.set("tag", tagAtiva);
    renderLista();
  });
  $("q").value = busca;
  $("q").addEventListener("input", (e) => {
    busca = e.target.value;
    ctx.store.set("busca", busca);
    renderLista();
  });
  ["titulo", "corpo", "tagsin", "fixada"].forEach((id) => { $(id).addEventListener("input", atualizarEstado); $(id).addEventListener("change", atualizarEstado); });
  $("nova").addEventListener("click", criar);
  $("salvar").addEventListener("click", salvar);
  $("excluir").addEventListener("click", excluir);
  $("ia").addEventListener("click", resumir);
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); if (sujo()) salvar(); }
  });

  await carregar(true);
  const guardada = String(await ctx.store.get("selecionada", ""));
  const inicial = all.find((n) => n.id === guardada) || ordenadas()[0];
  if (inicial) abrir(inicial.id); else mostrarVazio();
  renderLista();
  ctx.main(async () => { await carregar(false); });
});
