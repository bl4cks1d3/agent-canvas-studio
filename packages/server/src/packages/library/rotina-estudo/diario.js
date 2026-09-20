studio.main(async (ctx) => {
  const D = ctx.records('rotina_diario');
  const root = ctx.root, esc = ctx.escape;
  const $ = (s) => root.querySelector(s);
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const HUM = [
    { v: 'pessimo', e: '😞', n: 1, t: 'Péssimo' }, { v: 'ruim', e: '😕', n: 2, t: 'Ruim' }, { v: 'neutro', e: '😐', n: 3, t: 'Neutro' },
    { v: 'bom', e: '🙂', n: 4, t: 'Bom' }, { v: 'otimo', e: '😄', n: 5, t: 'Ótimo' },
  ];
  const hoje = iso(new Date());
  let registros = [], humor = '', energia = 0, atual = null;
  $('#data-hoje').textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });

  async function load() {
    registros = await D.list({ sort: 'data', order: 'desc', limit: 60 });
    atual = registros.find((r) => r.data === hoje) || null;
    if (atual) { humor = atual.humor || ''; energia = Number(atual.energia) || 0; $('#nota').value = atual.nota || ''; }
    render();
  }

  function render() {
    $('#humores').innerHTML = HUM.map((h) => '<button class="ac-btn' + (humor === h.v ? ' ac-btn-primary' : '') + '" data-humor="' + h.v + '" title="' + h.t + '">' + h.e + '</button>').join('');
    $('#energia').innerHTML = [1, 2, 3, 4, 5].map((n) => '<button class="ac-tab' + (energia === n ? ' active' : '') + '" data-energia="' + n + '">' + n + '</button>').join('');
    const ult = registros.slice(0, 14);
    const com = ult.filter((r) => r.humor);
    const media = com.length ? com.reduce((a, r) => a + (HUM.find((h) => h.v === r.humor) || { n: 3 }).n, 0) / com.length : 0;
    $('#media').textContent = media ? 'Média 14 d: ' + (HUM[Math.round(media) - 1] || HUM[2]).e + ' ' + media.toFixed(1) : 'Sem histórico';
    if (!ult.length) { $('#historico').innerHTML = '<div class="ac-empty">Faça o primeiro check-in.</div>'; return; }
    const tira = '<div class="di-tira">' + ult.slice().reverse().map((r) => {
      const h = HUM.find((x) => x.v === r.humor);
      return '<div class="di-dia" title="' + esc(r.data) + (r.energia ? ' · energia ' + esc(String(r.energia)) : '') + '"><div>' + (h ? h.e : '·') + '</div><div class="ac-muted">' + esc(r.data.slice(8)) + '</div></div>';
    }).join('') + '</div>';
    const notas = ult.filter((r) => r.nota).slice(0, 3).map((r) => '<div class="di-nota"><span class="ac-badge">' + esc(r.data.split('-').reverse().slice(0, 2).join('/')) + '</span> ' + esc(r.nota) + '</div>').join('');
    $('#historico').innerHTML = '<div class="ac-stack">' + tira + notas + '</div>';
  }

  root.addEventListener('click', async (e) => {
    const h = e.target.closest('[data-humor]');
    if (h) { humor = h.dataset.humor; render(); return; }
    const n = e.target.closest('[data-energia]');
    if (n) { energia = Number(n.dataset.energia); render(); return; }
    if (e.target.closest('#salvar')) {
      if (!humor) { ctx.ui.toast('Escolha como você está.', 'warn'); return; }
      const corpo = { humor, energia: energia || null, nota: $('#nota').value.trim() || null };
      if (atual) await D.update(atual.id, corpo); else await D.create(Object.assign({ data: hoje }, corpo));
      ctx.ui.toast('Check-in salvo', 'ok');
      await load();
    }
  });

  await load();
});
