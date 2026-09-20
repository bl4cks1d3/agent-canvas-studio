studio.main(async (ctx) => {
  const S = ctx.records('estudo_sessoes'), M = ctx.records('estudo_materias');
  const root = ctx.root, esc = ctx.escape;
  const $ = (s) => root.querySelector(s);
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const cfg = await ctx.store.get('cfg', { foco: 25, pausa: 5 });
  const dur = (m) => Math.max(1, Number(cfg[m]) || 1) * 60;
  let st = await ctx.store.get('st', null);
  if (!st) st = { modo: 'foco', restante: dur('foco'), endsAt: null };
  let finishing = false;

  const restante = () => st.endsAt ? Math.max(0, Math.round((st.endsAt - Date.now()) / 1000)) : st.restante;
  const fmt = (s) => pad(Math.floor(s / 60)) + ':' + pad(s % 60);
  const save = () => ctx.store.set('st', st);

  function draw() {
    const r = restante(), tot = dur(st.modo);
    $('#tempo').textContent = fmt(r);
    $('#prog').style.width = Math.max(0, Math.min(100, Math.round((1 - r / tot) * 100))) + '%';
    $('#play').textContent = st.endsAt ? 'Pausar' : (r < tot ? 'Continuar' : 'Iniciar');
    root.querySelectorAll('[data-modo]').forEach((b) => b.classList.toggle('active', b.dataset.modo === st.modo));
    if (st.endsAt && r <= 0) finish();
  }

  async function loadHoje() {
    const todas = await S.list({ limit: 1000 });
    const hoje = todas.filter((s) => s.data === iso(new Date()));
    const min = hoje.reduce((a, s) => a + (Number(s.minutos) || 0), 0);
    $('#hoje').textContent = 'Hoje: ' + hoje.length + ' sessão(ões) · ' + min + ' min de foco';
  }

  async function finish() {
    if (finishing) return;
    finishing = true;
    const anterior = st.modo;
    st = { modo: anterior === 'foco' ? 'pausa' : 'foco', restante: 0, endsAt: null };
    st.restante = dur(st.modo);
    await save();
    if (anterior === 'foco') {
      await S.create({ materia_id: $('#materia').value, minutos: Number(cfg.foco) || 25, data: iso(new Date()), foco: $('#foco').value.trim() });
      ctx.ui.toast('Pomodoro concluído! Hora da pausa.', 'ok');
      await loadHoje();
    } else {
      ctx.ui.toast('Pausa encerrada. Vamos focar?', 'ok');
    }
    finishing = false;
    draw();
  }

  const materias = await M.list({ sort: 'nome', limit: 200 });
  $('#materia').innerHTML = '<option value="">Sem matéria</option>' + materias.map((m) => '<option value="' + esc(m.id) + '">' + esc(m.nome) + '</option>').join('');
  $('#materia').value = await ctx.store.get('materia', '');
  $('#foco').value = await ctx.store.get('assunto', '');
  $('#min-foco').value = cfg.foco;
  $('#min-pausa').value = cfg.pausa;

  root.addEventListener('click', async (e) => {
    const m = e.target.closest('[data-modo]');
    if (m) { st = { modo: m.dataset.modo, restante: dur(m.dataset.modo), endsAt: null }; await save(); draw(); return; }
    if (e.target.closest('#play')) {
      if (st.endsAt) { st.restante = restante(); st.endsAt = null; }
      else st.endsAt = Date.now() + restante() * 1000;
      await save(); draw(); return;
    }
    if (e.target.closest('#reset')) { st = { modo: st.modo, restante: dur(st.modo), endsAt: null }; await save(); draw(); }
  });

  root.addEventListener('change', async (e) => {
    if (e.target.id === 'materia') await ctx.store.set('materia', e.target.value);
    if (e.target.id === 'min-foco' || e.target.id === 'min-pausa') {
      cfg.foco = Math.max(1, Number($('#min-foco').value) || 25);
      cfg.pausa = Math.max(1, Number($('#min-pausa').value) || 5);
      await ctx.store.set('cfg', cfg);
      if (!st.endsAt) { st.restante = dur(st.modo); await save(); }
      draw();
    }
  });
  $('#foco').addEventListener('change', (e) => ctx.store.set('assunto', e.target.value));

  setInterval(draw, 500);
  draw();
  await loadHoje();
});
