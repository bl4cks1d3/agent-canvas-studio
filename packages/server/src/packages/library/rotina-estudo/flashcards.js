studio.main(async (ctx) => {
  const K = ctx.records('estudo_cartoes'), M = ctx.records('estudo_materias');
  const root = ctx.root, esc = ctx.escape;
  const $ = (s) => root.querySelector(s);
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  let cartoes = [], materias = [], mostrar = false;
  let aba = await ctx.store.get('aba', 'revisar');
  let filtro = await ctx.store.get('filtro', '');
  const nomeMateria = (id) => (materias.find((m) => m.id === id) || {}).nome || '';

  async function load() {
    materias = await M.list({ sort: 'nome', limit: 200 });
    cartoes = await K.list({ sort: 'createdAt', limit: 2000 });
    $('#filtro').innerHTML = '<option value="">Todas as matérias</option>' + materias.map((m) => '<option value="' + esc(m.id) + '">' + esc(m.nome) + '</option>').join('');
    $('#filtro').value = filtro;
    render();
  }

  const filtrados = () => cartoes.filter((c) => !filtro || c.materia_id === filtro);
  const vencidos = () => {
    const h = iso(new Date());
    return filtrados().filter((c) => !c.proxima_revisao || c.proxima_revisao <= h)
      .sort((a, b) => (a.proxima_revisao || '').localeCompare(b.proxima_revisao || ''));
  };

  function render() {
    root.querySelectorAll('[data-aba]').forEach((b) => b.classList.toggle('active', b.dataset.aba === aba));
    if (aba === 'revisar') renderRevisar(); else renderCartoes();
  }

  function renderRevisar() {
    const fila = vencidos();
    if (!fila.length) { $('#corpo').innerHTML = '<div class="ac-empty">Nada para revisar agora 🎉<br><span class="ac-muted">' + filtrados().length + ' cartão(ões) no baralho.</span></div>'; return; }
    const c = fila[0];
    $('#corpo').innerHTML = '<div class="ac-stack">' +
      '<div class="ac-row-between"><span class="ac-muted">' + fila.length + ' para revisar hoje</span>' + (nomeMateria(c.materia_id) ? '<span class="ac-badge">' + esc(nomeMateria(c.materia_id)) + '</span>' : '') + '</div>' +
      '<div class="ac-card fc-card ac-stack"><div class="ac-subtitle">Pergunta</div><div class="ac-title fc-texto">' + esc(c.frente) + '</div>' +
      (mostrar ? '<div class="ac-subtitle">Resposta</div><div class="fc-texto">' + esc(c.verso) + '</div>' : '') + '</div>' +
      (mostrar
        ? '<div class="fc-notas"><button class="ac-btn ac-btn-danger" data-nota="0">Errei</button><button class="ac-btn" data-nota="1">Difícil</button><button class="ac-btn ac-btn-primary" data-nota="2">Bom</button><button class="ac-btn" data-nota="3">Fácil</button></div>'
        : '<button class="ac-btn ac-btn-primary" id="mostrar">Mostrar resposta</button>') + '</div>';
  }

  function renderCartoes() {
    const lista = filtrados();
    const opts = '<option value="">Sem matéria</option>' + materias.map((m) => '<option value="' + esc(m.id) + '">' + esc(m.nome) + '</option>').join('');
    const linhas = lista.map((c) => '<tr><td class="fc-texto">' + esc(c.frente) + '</td><td>' + esc(nomeMateria(c.materia_id)) + '</td><td>' +
      (c.proxima_revisao ? esc(c.proxima_revisao.split('-').reverse().join('/')) : '<span class="ac-badge ac-badge-accent">novo</span>') +
      '</td><td><button class="ac-btn ac-btn-sm ac-btn-ghost" data-del="' + esc(c.id) + '" title="Excluir">×</button></td></tr>').join('');
    $('#corpo').innerHTML = '<div class="ac-stack"><form class="ac-stack" id="novo">' +
      '<input class="ac-input" name="frente" placeholder="Pergunta / termo" required>' +
      '<textarea class="ac-textarea" name="verso" rows="2" placeholder="Resposta" required></textarea>' +
      '<div class="ac-row ac-wrap"><select class="ac-select ac-grow" name="materia">' + opts + '</select><button class="ac-btn ac-btn-primary" type="submit">Adicionar cartão</button></div></form>' +
      (lista.length ? '<table class="ac-table"><thead><tr><th>Pergunta</th><th>Matéria</th><th>Próxima</th><th></th></tr></thead><tbody>' + linhas + '</tbody></table>' : '<div class="ac-empty">Nenhum cartão ainda.</div>') + '</div>';
    const sel = $('#novo select'); if (sel && filtro) sel.value = filtro;
  }

  async function avaliar(nota) {
    const c = vencidos()[0]; if (!c) return;
    const iv = Number(c.intervalo_dias) || 0;
    const novo = nota === 0 ? 1 : nota === 1 ? Math.max(1, Math.round(iv * 1.2)) : nota === 2 ? Math.max(2, Math.round(iv * 2)) : Math.max(4, Math.round(Math.max(iv, 1) * 3));
    await K.update(c.id, {
      intervalo_dias: novo, proxima_revisao: iso(addDays(new Date(), novo)),
      acertos: (Number(c.acertos) || 0) + (nota > 0 ? 1 : 0), erros: (Number(c.erros) || 0) + (nota === 0 ? 1 : 0),
    });
    mostrar = false;
    await load();
  }

  root.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-aba]');
    if (a) { aba = a.dataset.aba; mostrar = false; await ctx.store.set('aba', aba); render(); return; }
    if (e.target.closest('#mostrar')) { mostrar = true; render(); return; }
    const n = e.target.closest('[data-nota]');
    if (n) { await avaliar(Number(n.dataset.nota)); return; }
    const d = e.target.closest('[data-del]');
    if (d && await ctx.ui.confirm('Excluir este cartão?', { danger: true, confirmLabel: 'Excluir' })) { await K.remove(d.dataset.del); await load(); }
  });
  root.addEventListener('change', async (e) => {
    if (e.target.id === 'filtro') { filtro = e.target.value; mostrar = false; await ctx.store.set('filtro', filtro); render(); }
  });
  root.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, frente = f.frente.value.trim(), verso = f.verso.value.trim();
    if (!frente || !verso) return;
    await K.create({ frente, verso, materia_id: f.materia.value, intervalo_dias: 0, acertos: 0, erros: 0 });
    ctx.ui.toast('Cartão adicionado', 'ok');
    await load();
  });

  await load();
});
