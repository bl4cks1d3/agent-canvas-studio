studio.main(async (ctx) => {
  const root = ctx.root, esc = ctx.escape;
  const H = ctx.records('rotina_habitos'), C = ctx.records('rotina_checkins'), T = ctx.records('rotina_tarefas');
  const S = ctx.records('estudo_sessoes'), K = ctx.records('estudo_cartoes'), D = ctx.records('rotina_diario');
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const EMO = { pessimo: '😞', ruim: '😕', neutro: '😐', bom: '🙂', otimo: '😄' };
  const fmt = (m) => m >= 60 ? Math.floor(m / 60) + 'h ' + pad(m % 60) + 'min' : m + ' min';

  function streak(set) {
    let d = new Date(); d.setHours(0, 0, 0, 0);
    if (!set.has(iso(d))) d = addDays(d, -1);
    let n = 0;
    while (set.has(iso(d))) { n++; d = addDays(d, -1); }
    return n;
  }

  async function load() {
    const [habitos, checks, tarefas, sessoes, cartoes, diario] = await Promise.all([
      H.list({ limit: 500 }), C.list({ limit: 2000 }), T.list({ limit: 1000 }), S.list({ limit: 2000 }), K.list({ limit: 2000 }), D.list({ limit: 60 }),
    ]);
    const hoje = iso(new Date());
    const ativos = habitos.filter((h) => h.ativo !== false);
    const feitosHoje = ativos.filter((h) => checks.some((c) => c.habito_id === h.id && c.data === hoje)).length;
    const seqMax = ativos.reduce((m, h) => Math.max(m, streak(new Set(checks.filter((c) => c.habito_id === h.id).map((c) => c.data)))), 0);
    const abertas = tarefas.filter((t) => !t.feito), vencendo = abertas.filter((t) => t.prazo && t.prazo <= hoje).length;
    const minHoje = sessoes.filter((s) => s.data === hoje).reduce((a, s) => a + (Number(s.minutos) || 0), 0);
    const revisar = cartoes.filter((c) => !c.proxima_revisao || c.proxima_revisao <= hoje).length;
    const dia = diario.find((r) => r.data === hoje);
    const pct = ativos.length ? Math.round(feitosHoje / ativos.length * 100) : 0;
    const card = (t, n, s, extra) => '<div class="ac-card rs-card ac-stack"><div class="ac-muted">' + t + '</div><div class="ac-big">' + n + '</div>' + (extra || '') + '<div class="ac-muted">' + s + '</div></div>';
    root.querySelector('#kpis').innerHTML =
      card('Hábitos hoje', feitosHoje + '/' + ativos.length, pct + '% concluído', '<div class="ac-bar"><i style="width:' + pct + '%"></i></div>') +
      card('Sequência', seqMax + ' d', 'maior sequência ativa') +
      card('Tarefas abertas', abertas.length, vencendo + ' com prazo hoje/atrasadas') +
      card('Foco hoje', fmt(minHoje), 'tempo de estudo registrado') +
      card('Cartões', revisar, 'para revisar hoje') +
      card('Humor', dia && dia.humor ? EMO[dia.humor] : '—', dia && dia.energia ? 'energia ' + esc(String(dia.energia)) + '/5' : 'sem check-in hoje');
  }

  await load();
  ctx.main(async () => { await load(); });
});
