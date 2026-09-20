studio.main(async (ctx) => {
  const H = ctx.records('rotina_habitos'), C = ctx.records('rotina_checkins');
  const root = ctx.root, esc = ctx.escape;
  const $ = (s) => root.querySelector(s);
  const DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
  const CATS = { saude: 'Saúde', estudo: 'Estudo', trabalho: 'Trabalho', mental: 'Mente', casa: 'Casa', outro: 'Outro' };
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const monday = (d) => addDays(d, -((d.getDay() + 6) % 7));
  const short = (d) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  let habitos = [], checks = [], offset = await ctx.store.get('offset', 0);

  function streak(set) {
    let d = new Date(); d.setHours(0, 0, 0, 0);
    if (!set.has(iso(d))) d = addDays(d, -1);
    let n = 0;
    while (set.has(iso(d))) { n++; d = addDays(d, -1); }
    return n;
  }

  async function load() {
    habitos = await H.list({ sort: 'createdAt', limit: 500 });
    checks = await C.list({ limit: 2000 });
    render();
  }

  function render() {
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const hojeIso = iso(hoje);
    const ini = addDays(monday(hoje), offset * 7);
    const dias = DIAS.map((_, i) => addDays(ini, i));
    $('#periodo').textContent = short(dias[0]) + ' – ' + short(dias[6]);
    const ativos = habitos.filter((h) => h.ativo !== false);
    if (!ativos.length) { $('#lista').innerHTML = '<div class="ac-empty">Nenhum hábito ainda. Adicione o primeiro acima.</div>'; return; }
    const por = {};
    checks.forEach((c) => { (por[c.habito_id] = por[c.habito_id] || new Set()).add(c.data); });
    const head = '<tr><th>Hábito</th>' + dias.map((d, i) =>
      '<th class="hab-day">' + (iso(d) === hojeIso ? '<span class="ac-badge ac-badge-accent">' + DIAS[i] + '</span>' : DIAS[i]) + '<div class="ac-muted">' + pad(d.getDate()) + '</div></th>').join('') +
      '<th>Meta</th><th>Sequência</th><th></th></tr>';
    const rows = ativos.map((h) => {
      const set = por[h.id] || new Set();
      const meta = Math.min(7, Math.max(1, Number(h.meta_semanal) || 7));
      const feitos = dias.filter((d) => set.has(iso(d))).length;
      const pct = Math.min(100, Math.round(feitos / meta * 100));
      const seq = streak(set);
      const cells = dias.map((d) => {
        const k = iso(d), on = set.has(k), fut = d > hoje;
        return '<td class="hab-day"><button class="ac-btn ac-btn-sm' + (on ? ' ac-btn-primary' : '') + '" data-toggle="' + esc(h.id) + '" data-dia="' + k + '"' + (fut ? ' disabled' : '') + '>' + (on ? '✓' : '·') + '</button></td>';
      }).join('');
      return '<tr><td><b>' + esc(h.nome) + '</b><div class="ac-muted">' + esc(CATS[h.categoria] || '') + '</div></td>' + cells +
        '<td class="hab-bar"><div class="ac-bar"><i style="width:' + pct + '%"></i></div><div class="ac-muted">' + feitos + '/' + meta + '</div></td>' +
        '<td>' + (seq ? '<span class="ac-badge ac-badge-warn">🔥 ' + seq + ' d</span>' : '<span class="ac-muted">—</span>') + '</td>' +
        '<td><button class="ac-btn ac-btn-sm ac-btn-ghost" data-del="' + esc(h.id) + '" title="Remover hábito">×</button></td></tr>';
    }).join('');
    $('#lista').innerHTML = '<table class="ac-table"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table>';
  }

  root.addEventListener('click', async (e) => {
    const w = e.target.closest('[data-week]');
    if (w) { const v = Number(w.dataset.week); offset = v === 0 ? 0 : offset + v; await ctx.store.set('offset', offset); render(); return; }
    const t = e.target.closest('[data-toggle]');
    if (t) {
      const ex = checks.find((c) => c.habito_id === t.dataset.toggle && c.data === t.dataset.dia);
      if (ex) await C.remove(ex.id); else await C.create({ habito_id: t.dataset.toggle, data: t.dataset.dia });
      await load(); return;
    }
    const d = e.target.closest('[data-del]');
    if (d && await ctx.ui.confirm('Remover este hábito e todo o histórico dele?', { danger: true, confirmLabel: 'Remover' })) {
      const id = d.dataset.del;
      for (const c of checks.filter((c) => c.habito_id === id)) await C.remove(c.id);
      await H.remove(id);
      await load();
    }
  });

  $('#novo').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, nome = f.nome.value.trim();
    if (!nome) return;
    await H.create({ nome, categoria: f.categoria.value, meta_semanal: Number(f.meta.value) || 7, ativo: true });
    f.nome.value = '';
    ctx.ui.toast('Hábito criado', 'ok');
    await load();
  });

  await load();
});
