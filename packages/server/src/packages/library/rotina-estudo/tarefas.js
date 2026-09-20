studio.main(async (ctx) => {
  const T = ctx.records('rotina_tarefas');
  const root = ctx.root, esc = ctx.escape;
  const $ = (s) => root.querySelector(s);
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const br = (s) => s.split('-').reverse().join('/');
  let tarefas = [], aba = await ctx.store.get('aba', 'hoje');

  async function load() { tarefas = await T.list({ sort: 'createdAt', limit: 1000 }); render(); }

  function conjunto() {
    const h = iso(new Date());
    if (aba === 'hoje') return tarefas.filter((t) => t.feito ? t.concluido_em === h : (t.prazo && t.prazo <= h));
    if (aba === 'abertas') return tarefas.filter((t) => !t.feito);
    return tarefas.filter((t) => t.feito).sort((a, b) => (b.concluido_em || '').localeCompare(a.concluido_em || ''));
  }

  function render() {
    root.querySelectorAll('[data-aba]').forEach((b) => b.classList.toggle('active', b.dataset.aba === aba));
    const h = iso(new Date());
    const lista = conjunto().sort((a, b) => (a.feito ? 1 : 0) - (b.feito ? 1 : 0) || (a.prazo || '9999').localeCompare(b.prazo || '9999'));
    const feitas = lista.filter((t) => t.feito).length;
    $('#progresso').innerHTML = aba === 'feitas' ? '' :
      '<div class="ac-row"><div class="ac-bar ac-grow"><i style="width:' + (lista.length ? Math.round(feitas / lista.length * 100) : 0) + '%"></i></div><span class="ac-muted">' + feitas + '/' + lista.length + '</span></div>';
    if (!lista.length) { $('#lista').innerHTML = '<div class="ac-empty">' + (aba === 'hoje' ? 'Nada para hoje. Defina um prazo para uma tarefa aparecer aqui.' : 'Nenhuma tarefa.') + '</div>'; return; }
    $('#lista').innerHTML = '<div class="ac-list">' + lista.map((t) =>
      '<div class="tar-item' + (t.feito ? ' tar-feita' : '') + '"><input type="checkbox" data-check="' + esc(t.id) + '"' + (t.feito ? ' checked' : '') + '>' +
      '<span class="tar-texto">' + esc(t.titulo) + '</span>' +
      (t.importante ? '<span class="ac-badge ac-badge-accent">importante</span>' : '') +
      (t.urgente ? '<span class="ac-badge ac-badge-danger">urgente</span>' : '') +
      (t.prazo ? '<span class="ac-badge' + (!t.feito && t.prazo < h ? ' ac-badge-warn' : '') + '">' + esc(br(t.prazo)) + '</span>' : '') +
      '<button class="ac-btn ac-btn-sm ac-btn-ghost" data-del="' + esc(t.id) + '" title="Excluir">×</button></div>').join('') + '</div>';
  }

  root.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-aba]');
    if (a) { aba = a.dataset.aba; await ctx.store.set('aba', aba); render(); return; }
    const d = e.target.closest('[data-del]');
    if (d && await ctx.ui.confirm('Excluir esta tarefa?', { danger: true, confirmLabel: 'Excluir' })) { await T.remove(d.dataset.del); await load(); }
  });
  root.addEventListener('change', async (e) => {
    const c = e.target.closest('[data-check]');
    if (!c) return;
    await T.update(c.dataset.check, c.checked ? { feito: true, concluido_em: iso(new Date()) } : { feito: false, concluido_em: null });
    await load();
  });
  $('#novo').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, titulo = f.titulo.value.trim();
    if (!titulo) return;
    const body = { titulo, importante: f.importante.checked, urgente: f.urgente.checked, feito: false };
    if (f.prazo.value) body.prazo = f.prazo.value;
    await T.create(body);
    f.reset();
    await load();
  });

  await load();
});
