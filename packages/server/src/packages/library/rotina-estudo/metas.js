studio.main(async (ctx) => {
  const M = ctx.records('estudo_materias'), S = ctx.records('estudo_sessoes');
  const root = ctx.root, esc = ctx.escape;
  const $ = (s) => root.querySelector(s);
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const monday = (d) => addDays(d, -((d.getDay() + 6) % 7));
  const short = (d) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  const fmt = (m) => m >= 60 ? Math.floor(m / 60) + 'h' + (m % 60 ? ' ' + pad(m % 60) + 'min' : '') : m + 'min';
  let materias = [], sessoes = [];

  async function load() {
    materias = await M.list({ sort: 'createdAt', limit: 200 });
    sessoes = await S.list({ limit: 2000 });
    $('#nova-sessao [name=data]').value = $('#nova-sessao [name=data]').value || iso(new Date());
    render();
  }

  function render() {
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const ini = monday(hoje), fim = addDays(ini, 6);
    $('#periodo').textContent = short(ini) + ' – ' + short(fim);
    const semana = sessoes.filter((s) => s.data >= iso(ini) && s.data <= iso(fim));
    const por = {};
    semana.forEach((s) => { por[s.materia_id || ''] = (por[s.materia_id || ''] || 0) + (Number(s.minutos) || 0); });
    const total = semana.reduce((a, s) => a + (Number(s.minutos) || 0), 0);
    $('#total').textContent = 'Total: ' + fmt(total);
    const sel = $('#nova-sessao [name=materia]'), atual = sel.value;
    sel.innerHTML = '<option value="">Sem matéria</option>' + materias.map((m) => '<option value="' + esc(m.id) + '">' + esc(m.nome) + '</option>').join('');
    sel.value = atual;
    const linhas = materias.map((m) => {
      const feito = por[m.id] || 0, meta = Number(m.meta_semanal_min) || 0;
      const pct = meta ? Math.min(100, Math.round(feito / meta * 100)) : 0;
      return '<tr><td><b>' + esc(m.nome) + '</b></td><td class="es-bar"><div class="ac-bar"><i style="width:' + pct + '%"></i></div></td><td>' + fmt(feito) + (meta ? ' / ' + fmt(meta) : '') +
        (meta && feito >= meta ? ' <span class="ac-badge ac-badge-ok">meta</span>' : '') + '</td><td><button class="ac-btn ac-btn-sm ac-btn-ghost" data-del="' + esc(m.id) + '" title="Remover matéria">×</button></td></tr>';
    });
    if (por['']) linhas.push('<tr><td><span class="ac-muted">Sem matéria</span></td><td></td><td>' + fmt(por['']) + '</td><td></td></tr>');
    $('#lista').innerHTML = linhas.length ? '<table class="ac-table"><thead><tr><th>Matéria</th><th>Progresso</th><th>Semana</th><th></th></tr></thead><tbody>' + linhas.join('') + '</tbody></table>' : '<div class="ac-empty">Cadastre suas matérias e metas semanais.</div>';
  }

  root.addEventListener('click', async (e) => {
    const d = e.target.closest('[data-del]');
    if (d && await ctx.ui.confirm('Remover esta matéria? As sessões já registradas continuam no histórico.', { danger: true, confirmLabel: 'Remover' })) { await M.remove(d.dataset.del); await load(); }
  });
  $('#nova-materia').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, nome = f.nome.value.trim();
    if (!nome) return;
    await M.create({ nome, meta_semanal_min: Math.round((Number(f.horas.value) || 0) * 60) });
    f.nome.value = '';
    await load();
  });
  $('#nova-sessao').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, minutos = Number(f.minutos.value);
    if (!minutos || !f.data.value) return;
    await S.create({ materia_id: f.materia.value, minutos, data: f.data.value });
    ctx.ui.toast('Sessão registrada', 'ok');
    await load();
  });

  await load();
});
