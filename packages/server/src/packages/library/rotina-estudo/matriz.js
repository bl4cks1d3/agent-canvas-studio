studio.main(async (ctx) => {
  const T = ctx.records('rotina_tarefas');
  const root = ctx.root, esc = ctx.escape;
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const Q = [
    { id: 'q1', titulo: 'Fazer agora', dica: 'Urgente e importante', importante: true, urgente: true, badge: 'ac-badge-danger' },
    { id: 'q2', titulo: 'Agendar', dica: 'Importante, não urgente', importante: true, urgente: false, badge: 'ac-badge-accent' },
    { id: 'q3', titulo: 'Delegar', dica: 'Urgente, não importante', importante: false, urgente: true, badge: 'ac-badge-warn' },
    { id: 'q4', titulo: 'Eliminar', dica: 'Nem urgente, nem importante', importante: false, urgente: false, badge: '' },
  ];
  let tarefas = [];

  async function load() { tarefas = (await T.list({ sort: 'createdAt', limit: 1000 })).filter((t) => !t.feito); render(); }

  const quadrante = (t) => Q.find((q) => q.importante === !!t.importante && q.urgente === !!t.urgente);

  function render() {
    root.querySelector('#grade').innerHTML = Q.map((q) => {
      const itens = tarefas.filter((t) => quadrante(t) === q);
      return '<div class="ac-card mx-q ac-stack" data-q="' + q.id + '">' +
        '<div class="ac-row-between"><div><div class="ac-subtitle">' + q.titulo + '</div><div class="ac-muted">' + q.dica + '</div></div><span class="ac-badge ' + q.badge + '">' + itens.length + '</span></div>' +
        (itens.length ? itens.map((t) => '<div class="mx-item" draggable="true" data-id="' + esc(t.id) + '"><input type="checkbox" data-check="' + esc(t.id) + '"><span>' + esc(t.titulo) + '</span><button class="ac-btn ac-btn-sm ac-btn-ghost" data-del="' + esc(t.id) + '" title="Excluir">×</button></div>').join('') : '<div class="ac-muted">Solte tarefas aqui</div>') +
        '<form class="ac-row" data-add="' + q.id + '"><input class="ac-input ac-grow" name="titulo" placeholder="Adicionar…"><button class="ac-btn ac-btn-sm" type="submit">+</button></form></div>';
    }).join('');
  }

  root.addEventListener('dragstart', (e) => {
    const it = e.target.closest('[data-id]');
    if (it) { e.dataTransfer.setData('text/plain', it.dataset.id); e.dataTransfer.effectAllowed = 'move'; }
  });
  root.addEventListener('dragover', (e) => {
    const q = e.target.closest('[data-q]');
    if (!q) return;
    e.preventDefault();
    root.querySelectorAll('.mx-q.over').forEach((x) => x.classList.remove('over'));
    q.classList.add('over');
  });
  root.addEventListener('dragleave', (e) => { const q = e.target.closest('[data-q]'); if (q && !q.contains(e.relatedTarget)) q.classList.remove('over'); });
  root.addEventListener('drop', async (e) => {
    const q = e.target.closest('[data-q]');
    if (!q) return;
    e.preventDefault();
    q.classList.remove('over');
    const id = e.dataTransfer.getData('text/plain'), alvo = Q.find((x) => x.id === q.dataset.q);
    if (!id || !alvo) return;
    await T.update(id, { importante: alvo.importante, urgente: alvo.urgente });
    await load();
  });
  root.addEventListener('change', async (e) => {
    const c = e.target.closest('[data-check]');
    if (c && c.checked) { await T.update(c.dataset.check, { feito: true, concluido_em: iso(new Date()) }); ctx.ui.toast('Tarefa concluída', 'ok'); await load(); }
  });
  root.addEventListener('click', async (e) => {
    const d = e.target.closest('[data-del]');
    if (d && await ctx.ui.confirm('Excluir esta tarefa?', { danger: true, confirmLabel: 'Excluir' })) { await T.remove(d.dataset.del); await load(); }
  });
  root.addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-add]');
    if (!f) return;
    e.preventDefault();
    const titulo = f.titulo.value.trim(), q = Q.find((x) => x.id === f.dataset.add);
    if (!titulo || !q) return;
    await T.create({ titulo, importante: q.importante, urgente: q.urgente, feito: false });
    await load();
  });

  await load();
});
