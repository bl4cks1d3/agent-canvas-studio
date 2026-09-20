studio.main(async (ctx) => {
  const A = ctx.records('saude_agua'), R = ctx.records('sistema_lembretes');
  const root = ctx.root, esc = ctx.escape;
  const $ = (s) => root.querySelector(s);
  const CHAVE = 'agua';
  const ATALHOS = [200, 300, 500, 750];
  const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const hhmm = (d) => pad(d.getHours()) + ':' + pad(d.getMinutes());
  const litros = (ml) => ml >= 1000 ? String(+(ml / 1000).toFixed(2)).replace('.', ',') + ' L' : ml + ' ml';
  let registros = [], lembrete = null;
  let meta = Number(await ctx.store.get('meta', 2000)) || 2000;

  async function load() {
    registros = await A.list({ sort: 'createdAt', limit: 1000 });
    lembrete = (await R.list({ chave: CHAVE, limit: 5 }))[0] || null;
    render();
  }

  const somaDia = (dia) => registros.filter((r) => r.data === dia).reduce((a, r) => a + (Number(r.ml) || 0), 0);

  function proximo(l) {
    if (!l || l.ativo !== true) return null;
    const cada = Number(l.a_cada_min) || 60;
    let t = (Date.parse(l.ultimo_disparo) || Date.now()) + cada * 60000;
    if (t < Date.now()) t = Date.now();
    const d = new Date(t);
    const [ih, im] = String(l.inicio || '00:00').split(':').map(Number);
    const [fh, fm] = String(l.fim || '23:59').split(':').map(Number);
    const cur = d.getHours() * 60 + d.getMinutes(), a = ih * 60 + im, b = fh * 60 + fm;
    if (a <= b ? (cur >= a && cur <= b) : (cur >= a || cur <= b)) return d;
    const n = new Date(d); n.setHours(ih, im, 0, 0);
    if (n <= d) n.setDate(n.getDate() + 1);
    return n;
  }

  function render() {
    const hoje = iso(new Date());
    const total = somaDia(hoje);
    const pct = Math.min(100, Math.round(total / meta * 100));
    $('#dia').textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
    $('#total').textContent = litros(total);
    $('#pct').textContent = pct + '% de ' + litros(meta) + (total >= meta ? ' — meta batida!' : ' · faltam ' + litros(meta - total));
    $('#barra').style.width = pct + '%';
    if (document.activeElement !== $('#meta')) $('#meta').value = meta;
    $('#atalhos').innerHTML = ATALHOS.map((ml) => '<button class="ac-btn ac-btn-primary" data-add="' + ml + '">+ ' + ml + ' ml</button>').join('');
    const de = registros.filter((r) => r.data === hoje).sort((a, b) => String(b.hora || '').localeCompare(String(a.hora || '')));
    $('#hoje').innerHTML = de.length
      ? de.map((r) => '<span class="ac-badge">' + esc(r.hora || '') + ' · ' + esc(String(r.ml)) + ' ml <button class="ac-btn ac-btn-sm ac-btn-ghost" data-del="' + esc(r.id) + '" title="Remover">×</button></span>').join('')
      : '<span class="ac-muted">Nenhum registro hoje.</span>';
    $('#semana').innerHTML = [6, 5, 4, 3, 2, 1, 0].map((i) => {
      const d = addDays(new Date(), -i), ml = somaDia(iso(d)), p = Math.min(100, Math.round(ml / meta * 100));
      return '<div class="ac-row"><span class="ag-dia">' + DIAS[d.getDay()] + '</span><div class="ac-bar ac-grow"><i style="width:' + p + '%"></i></div><span class="ac-muted ag-val">' + litros(ml) + '</span></div>';
    }).join('');
    const l = lembrete;
    $('#l-ativo').checked = !!l && l.ativo === true;
    if (document.activeElement !== $('#l-int')) $('#l-int').value = String(l && l.a_cada_min ? l.a_cada_min : 60);
    if (document.activeElement !== $('#l-ini')) $('#l-ini').value = (l && l.inicio) || '08:00';
    if (document.activeElement !== $('#l-fim')) $('#l-fim').value = (l && l.fim) || '22:00';
    if (document.activeElement !== $('#l-msg')) $('#l-msg').value = (l && l.mensagem) || 'Hora de beber água 💧';
    const p = proximo(l);
    $('#l-status').textContent = p ? 'Próximo lembrete por volta de ' + hhmm(p) + (iso(p) !== hoje ? ' (amanhã)' : '') : 'Lembrete desligado.';
  }

  async function adicionar(ml) {
    if (!(ml > 0)) return;
    const antes = somaDia(iso(new Date()));
    await A.create({ data: iso(new Date()), ml, hora: hhmm(new Date()) });
    await load();
    if (antes < meta && antes + ml >= meta) {
      try { await ctx.tool('notify', { title: 'Meta de água batida! 🎉', message: 'Você chegou a ' + litros(antes + ml) + ' hoje.', level: 'ok' }); } catch (e) { ctx.ui.toast('Meta batida!', 'ok'); }
    }
  }

  async function salvarLembrete(extra) {
    const corpo = Object.assign({
      chave: CHAVE, titulo: 'Beber água', ativo: $('#l-ativo').checked,
      a_cada_min: Number($('#l-int').value) || 60, inicio: $('#l-ini').value || '08:00', fim: $('#l-fim').value || '22:00',
      mensagem: $('#l-msg').value.trim() || 'Hora de beber água 💧',
    }, extra || {});
    if (lembrete) await R.update(lembrete.id, corpo); else await R.create(corpo);
    await load();
  }

  root.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-add]');
    if (a) { await adicionar(Number(a.dataset.add)); return; }
    const d = e.target.closest('[data-del]');
    if (d) { await A.remove(d.dataset.del); await load(); return; }
    if (e.target.closest('#desfazer')) {
      const ult = registros.filter((r) => r.data === iso(new Date())).pop();
      if (ult) { await A.remove(ult.id); await load(); }
      return;
    }
    if (e.target.closest('#l-teste')) {
      try {
        await ctx.tool('notify', { title: 'Teste de lembrete', message: $('#l-msg').value.trim() || 'Hora de beber água 💧', level: 'info' });
        ctx.ui.toast('Notificação enviada. Veja o sino no topo.', 'ok');
      } catch (err) { ctx.ui.toast(String(err && err.message || err), 'error'); }
    }
  });

  $('#outro').addEventListener('submit', async (e) => {
    e.preventDefault();
    const ml = Number(e.target.ml.value);
    e.target.ml.value = '';
    await adicionar(ml);
  });

  root.addEventListener('change', async (e) => {
    if (e.target.id === 'meta') { meta = Math.max(500, Number(e.target.value) || 2000); await ctx.store.set('meta', meta); render(); return; }
    if (e.target.id === 'l-ativo') { await salvarLembrete(e.target.checked ? { ultimo_disparo: new Date().toISOString() } : {}); return; }
    if (['l-int', 'l-ini', 'l-fim', 'l-msg'].includes(e.target.id)) await salvarLembrete();
  });

  await load();
  ctx.main(async () => { await load(); });
});
