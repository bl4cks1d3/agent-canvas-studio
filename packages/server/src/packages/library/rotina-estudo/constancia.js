studio.main(async (ctx) => {
  const C = ctx.records('rotina_checkins'), S = ctx.records('estudo_sessoes'), T = ctx.records('rotina_tarefas');
  const root = ctx.root;
  const $ = (s) => root.querySelector(s);
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const monday = (d) => addDays(d, -((d.getDay() + 6) % 7));
  const SEMANAS = 16;
  const LIM = { habitos: [1, 2, 3, 5], estudo: [1, 30, 60, 120], tarefas: [1, 2, 3, 5] };
  const UN = { habitos: 'hábito(s)', estudo: 'min de estudo', tarefas: 'tarefa(s)' };
  let aba = await ctx.store.get('aba', 'habitos');
  let checks = [], sessoes = [], tarefas = [];

  async function load() {
    checks = await C.list({ limit: 2000 });
    sessoes = await S.list({ limit: 2000 });
    tarefas = await T.list({ limit: 2000 });
    render();
  }

  function valores() {
    const v = {};
    if (aba === 'habitos') checks.forEach((c) => { v[c.data] = (v[c.data] || 0) + 1; });
    else if (aba === 'estudo') sessoes.forEach((s) => { v[s.data] = (v[s.data] || 0) + (Number(s.minutos) || 0); });
    else tarefas.forEach((t) => { if (t.feito && t.concluido_em) v[t.concluido_em] = (v[t.concluido_em] || 0) + 1; });
    return v;
  }

  const nivel = (x) => { if (!x) return 0; const l = LIM[aba]; return x >= l[3] ? 4 : x >= l[2] ? 3 : x >= l[1] ? 2 : 1; };

  function render() {
    root.querySelectorAll('[data-aba]').forEach((b) => b.classList.toggle('active', b.dataset.aba === aba));
    const v = valores();
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const ini = addDays(monday(hoje), -(SEMANAS - 1) * 7);
    let html = '', atual = 0, melhor = 0, corrida = 0, ativos = 0, total = 0;
    for (let i = 0; i < SEMANAS * 7; i++) {
      const d = addDays(ini, i), k = iso(d), x = v[k] || 0;
      if (d > hoje) { html += '<i class="fut"></i>'; continue; }
      html += '<i class="l' + nivel(x) + '" title="' + k.split('-').reverse().join('/') + ': ' + x + ' ' + UN[aba] + '"></i>';
      total += x;
      if (x > 0) { ativos++; corrida++; melhor = Math.max(melhor, corrida); } else if (k !== iso(hoje)) corrida = 0;
      atual = corrida;
    }
    $('#mapa').innerHTML = html;
    const card = (t, n, s) => '<div class="ac-card"><div class="ac-muted">' + t + '</div><div class="ac-big">' + n + '</div><div class="ac-muted">' + s + '</div></div>';
    $('#stats').innerHTML = card('Sequência atual', atual, 'dias seguidos') + card('Melhor sequência', melhor, 'em ' + SEMANAS + ' semanas') + card('Dias ativos', ativos, 'de ' + SEMANAS * 7) + card('Total', total, UN[aba]);
  }

  root.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-aba]');
    if (a) { aba = a.dataset.aba; await ctx.store.set('aba', aba); render(); }
  });

  await load();
  ctx.main(async () => { await load(); });
});
