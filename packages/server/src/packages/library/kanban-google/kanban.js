studio.main(async (ctx) => {
  const LIST = 'mcp__google-workspace__list_tasks';
  const MANAGE = 'mcp__google-workspace__manage_task';
  const EVENTS = 'mcp__google-workspace__get_events';
  const CALS = 'mcp__google-workspace__list_calendars';
  const LISTA = '@default';
  const E = ctx.records('kanban_google_estado');
  const root = ctx.root, esc = ctx.escape;
  const $ = (s) => root.querySelector(s);
  const COLS = [{ id: 'a-fazer', nome: 'A fazer' }, { id: 'fazendo', nome: 'Fazendo' }, { id: 'feito', nome: 'Feito' }];
  const DIA = 86400000;
  const PROXIMOS = [3, 7, 14, 30, 60, 90];
  const PASSADOS = [0, 1, 3, 7];
  const pad = (n) => String(n).padStart(2, '0');
  const fmtData = (d) => pad(d.getDate()) + '/' + pad(d.getMonth() + 1);
  const fmtHora = (d) => pad(d.getHours()) + ':' + pad(d.getMinutes());
  const inicioHoje = () => new Date(new Date().setHours(0, 0, 0, 0));
  let filtro = await ctx.store.get('filtro', 'tudo');
  // preferencias: quantos dias de compromissos e de quais agendas (null = escolhe Principal + Familia na primeira vez)
  let cfg = Object.assign({ proximos: 14, passados: 3, agendas: null }, await ctx.store.get('cfg', {}));
  let tarefas = [], eventos = [], estados = [], calendarios = [], erros = {}, arrastando = null, ocupado = false;

  // ---- Respostas em texto do servidor do Google (o mesmo formato do componente Workspace) ----
  function parseTarefas(txt) {
    const itens = []; let cur = null;
    for (const l of String(txt).split(/\r?\n/)) {
      const t = /^-\s+(.*?)\s+\(ID:\s*([^)]+)\)\s*$/.exec(l);
      if (t) { cur = { titulo: t[1], id: t[2].trim() }; itens.push(cur); continue; }
      const k = /^\s+(Status|Due|Completed):\s*(.*)$/.exec(l);
      if (k && cur) cur[k[1].toLowerCase()] = k[2].trim();
    }
    return itens;
  }
  function parseEventos(txt, agenda) {
    const itens = [];
    for (const l of String(txt).split(/\r?\n/)) {
      const m = /^\s*-\s+"(.*)"\s+\(Starts:\s*([^\s,\]]+)(?:\s*\[[^\]]*\])?,\s*Ends:\s*([^\s,\]]+)(?:\s*\[[^\]]*\])?\)(.*)$/.exec(l);
      if (!m) continue;
      const id = /ID:\s*(\S+)/.exec(m[4]);
      itens.push({ titulo: m[1], ini: m[2], fim: m[3], id: (id ? id[1] : m[1] + m[2]) + '@' + agenda.id, meet: /Meeting:\s*\S+/i.test(m[4]), agenda });
    }
    return itens;
  }
  // - "Nome" (Primary) (ID: xxx)   ou   - "Nome" (ID: xxx)
  function parseAgendas(txt) {
    const out = [];
    for (const l of String(txt).split(/\r?\n/)) {
      const m = /^\s*-\s+"(.*)"(\s+\(Primary\))?\s+\(ID:\s*(\S+)\)/.exec(l);
      if (m) out.push({ nome: m[2] ? 'Principal' : m[1], primaria: !!m[2], id: m[2] ? 'primary' : m[3] });
    }
    return out;
  }
  const pareceLogin = (txt) => /accounts\.google\.com|authoriz|autoriz/i.test(String(txt));
  const falhou = (txt) => /^\s*(error|erro|failed)|not found|invalid|exception|unauthor|HttpError/i.test(String(txt).slice(0, 300));

  // ---- Compromissos: a coluna vem da hora (se movem sozinhos) ----
  function janela(ev) {
    const diaTodo = /^\d{4}-\d{2}-\d{2}$/.test(ev.ini);
    return diaTodo ? { ini: new Date(ev.ini + 'T00:00:00'), fim: new Date(ev.fim + 'T00:00:00'), diaTodo } : { ini: new Date(ev.ini), fim: new Date(ev.fim), diaTodo };
  }

  function colunaDe(t) {
    if (t.status === 'completed') return 'feito';
    return estados.some((e) => e.ref === 'task:' + t.id && e.coluna === 'fazendo') ? 'fazendo' : 'a-fazer';
  }

  function montar(agora) {
    const hoje = inicioHoje().getTime();
    const cards = [];
    tarefas.forEach((t) => {
      const prazo = t.due ? new Date(t.due.slice(0, 10) + 'T00:00:00') : null;
      const coluna = colunaDe(t);
      cards.push({
        ref: 'task:' + t.id, tipo: 'tarefa', titulo: t.titulo, coluna, origem: '',
        quando: prazo ? 'até ' + fmtData(prazo) : 'sem prazo', ts: prazo ? prazo.getTime() : 8e15,
        atrasada: coluna !== 'feito' && !!prazo && prazo.getTime() < hoje, concluidaEm: t.completed ? Date.parse(t.completed) || 0 : 0,
      });
    });
    eventos.forEach((ev) => {
      const j = janela(ev);
      if (isNaN(j.ini.getTime()) || isNaN(j.fim.getTime())) return;
      const coluna = agora >= j.fim.getTime() ? 'feito' : agora >= j.ini.getTime() ? 'fazendo' : 'a-fazer';
      const quando = j.diaTodo ? 'Dia todo · ' + fmtData(j.ini) : fmtData(j.ini) + ' ' + fmtHora(j.ini) + ' – ' + fmtHora(j.fim);
      cards.push({ ref: 'event:' + ev.id, tipo: 'evento', titulo: ev.titulo, coluna, origem: ev.agenda.primaria ? '' : ev.agenda.nome, quando: quando + (ev.meet ? ' · Meet' : ''), ts: j.ini.getTime(), fimTs: j.fim.getTime(), atrasada: false, concluidaEm: 0 });
    });
    return cards;
  }

  function cardHtml(c) {
    const tarefa = c.tipo === 'tarefa';
    return '<div class="ac-card kb-card" ' + (tarefa ? 'draggable="true" ' : '') + 'data-ref="' + esc(c.ref) + '">' +
      '<div class="ac-row-between ac-wrap"><span class="ac-badge' + (tarefa ? ' ac-badge-accent' : '') + '">' + (tarefa ? 'Tarefa' : 'Compromisso') + '</span>' +
      (c.origem ? '<span class="ac-badge ac-badge-warn">' + esc(c.origem) + '</span>' : '') + (c.atrasada ? '<span class="ac-badge ac-badge-danger">atrasada</span>' : '') + '</div>' +
      '<div><b>' + esc(c.titulo) + '</b></div><div class="ac-muted">' + esc(c.quando) + '</div></div>';
  }

  function render() {
    root.querySelectorAll('[data-f]').forEach((b) => b.classList.toggle('active', b.dataset.f === filtro));
    const cards = montar(Date.now()).filter((c) => filtro === 'tudo' || c.tipo === filtro);
    $('#quadro').innerHTML = COLS.map((col) => {
      const lista = cards.filter((c) => c.coluna === col.id).sort((a, b) => col.id === 'feito' ? ((b.concluidaEm || b.fimTs || b.ts) - (a.concluidaEm || a.fimTs || a.ts)) : (a.ts - b.ts)).slice(0, col.id === 'feito' ? 25 : 300);
      return '<div class="kb-col" data-col="' + col.id + '"><div class="ac-row-between"><b>' + col.nome + '</b><span class="ac-badge">' + lista.length + '</span></div>' +
        (lista.length ? lista.map(cardHtml).join('') : '<div class="ac-muted">Vazio</div>') + '</div>';
    }).join('');
    const av = [];
    if (erros.tarefas) av.push('<div class="ac-card ac-danger"><b>Tarefas:</b> ' + esc(erros.tarefas) + '</div>');
    if (erros.agenda) av.push('<div class="ac-card ac-danger"><b>Agenda:</b> ' + esc(erros.agenda) + '</div>');
    $('#avisos').innerHTML = av.join('');
    const nomes = calendarios.filter((c) => (cfg.agendas || []).includes(c.id)).map((c) => c.nome);
    $('#sub').textContent = 'Compromissos: próximos ' + cfg.proximos + ' dias' + (cfg.passados ? ' e últimos ' + cfg.passados : '') + (nomes.length ? ' · ' + nomes.join(', ') : '') + ' · atualizado ' + fmtHora(new Date());
  }

  function renderConfig() {
    const opt = (lista, atual) => lista.map((n) => '<option value="' + n + '"' + (n === atual ? ' selected' : '') + '>' + n + '</option>').join('');
    $('#config').innerHTML = '<div class="ac-card ac-stack">' +
      '<div class="ac-row ac-wrap"><label class="ac-row ac-muted">Próximos <select class="ac-select" id="c-prox">' + opt(PROXIMOS, cfg.proximos) + '</select> dias</label>' +
      '<label class="ac-row ac-muted">Últimos <select class="ac-select" id="c-pass">' + opt(PASSADOS, cfg.passados) + '</select> dias (coluna Feito)</label></div>' +
      '<div class="ac-subtitle">Agendas do Google</div>' +
      (calendarios.length ? calendarios.map((c) => '<label class="ac-row"><input type="checkbox" data-cal="' + esc(c.id) + '"' + ((cfg.agendas || []).includes(c.id) ? ' checked' : '') + '> ' + esc(c.nome) + '</label>').join('') : '<div class="ac-muted">Nenhuma agenda encontrada.</div>') +
      '</div>';
  }

  async function carregarAgendas() {
    try {
      const txt = String(await ctx.tool(CALS, {}));
      const lista = parseAgendas(txt);
      if (lista.length) calendarios = lista;
    } catch (err) { /* segue com o que ja tinha: a agenda principal sempre funciona */ }
    if (!calendarios.length) calendarios = [{ nome: 'Principal', primaria: true, id: 'primary' }];
    if (!cfg.agendas) {
      // primeira vez: Principal + Familia (se existir); feriados e outras ficam desligadas
      const pref = calendarios.filter((c) => c.primaria || /fam[ií]lia|family/i.test(c.nome)).map((c) => c.id);
      cfg.agendas = pref.length ? pref : ['primary'];
      await ctx.store.set('cfg', cfg);
    }
  }

  async function carregar() {
    const hoje = inicioHoje().getTime();
    const selecionadas = calendarios.filter((c) => (cfg.agendas || []).includes(c.id));
    const [rt, rs, ...res] = await Promise.allSettled([
      ctx.tool(LIST, { task_list_id: LISTA, max_results: 200, show_completed: true, show_hidden: true }),
      E.list({ limit: 1000 }),
      ...selecionadas.map((c) => ctx.tool(EVENTS, { calendar_id: c.id, time_min: new Date(hoje - cfg.passados * DIA).toISOString(), time_max: new Date(hoje + (cfg.proximos + 1) * DIA).toISOString(), max_results: 250, single_events: true })),
    ]);
    erros = {};
    if (rs.status === 'fulfilled') estados = rs.value;
    if (rt.status === 'fulfilled') {
      const txt = String(rt.value);
      if (pareceLogin(txt)) erros.tarefas = 'A conta Google precisa de login: abra Configurações → Conta Google.';
      else if (/Tasks in list|No tasks/i.test(txt)) {
        const limite = Date.now() - 7 * DIA;
        tarefas = parseTarefas(txt).filter((t) => t.status !== 'completed' || !t.completed || Date.parse(t.completed) >= limite);
      } else erros.tarefas = 'Resposta inesperada do Google Tasks: ' + txt.slice(0, 120);
    } else erros.tarefas = String((rt.reason && rt.reason.message) || rt.reason);
    const todos = []; const falhas = [];
    res.forEach((r, i) => {
      const cal = selecionadas[i];
      if (r.status !== 'fulfilled') { falhas.push(cal.nome + ': ' + String((r.reason && r.reason.message) || r.reason)); return; }
      const txt = String(r.value);
      if (pareceLogin(txt)) falhas.push(cal.nome + ': a conta Google precisa de login (Configurações → Conta Google).');
      else if (/retrieved|No events|Successfully/i.test(txt)) todos.push(...parseEventos(txt, cal));
      else falhas.push(cal.nome + ': resposta inesperada: ' + txt.slice(0, 100));
    });
    eventos = todos;
    if (falhas.length) erros.agenda = falhas.join(' | ');
    render();
  }

  // ---- Mover tarefas: concluir/reabrir escreve no Google; "Fazendo" fica guardado aqui ----
  async function mover(ref, destino) {
    const t = tarefas.find((x) => 'task:' + x.id === ref);
    if (!t || ocupado) return;
    if (colunaDe(t) === destino) return;
    const eraConcluida = t.status === 'completed';
    const quer = destino === 'feito';
    ocupado = true;
    // otimista: o card muda de coluna na hora; o Google confirma logo em seguida
    t.status = quer ? 'completed' : 'needsAction';
    if (quer) t.completed = new Date().toISOString();
    estados = estados.filter((e) => e.ref !== ref);
    if (destino === 'fazendo') estados = estados.concat([{ ref, coluna: 'fazendo', id: '_tmp' }]);
    render();
    try {
      if (quer !== eraConcluida) {
        const r = String(await ctx.tool(MANAGE, { action: 'update', task_list_id: LISTA, task_id: t.id, status: quer ? 'completed' : 'needsAction' }));
        if (falhou(r)) throw new Error(r.slice(0, 160));
      }
      const salvos = (await E.list({ limit: 1000 })).filter((e) => e.ref === ref);
      if (destino === 'fazendo') { if (!salvos.length) await E.create({ ref, coluna: 'fazendo' }); }
      else for (const e of salvos) await E.remove(e.id);
    } catch (err) {
      ctx.ui.toast('Não consegui atualizar no Google: ' + String((err && err.message) || err), 'error');
    }
    ocupado = false;
    await carregar();
  }

  async function criar(titulo, prazo) {
    const args = { action: 'create', task_list_id: LISTA, title: titulo };
    if (prazo) args.due = prazo + 'T00:00:00.000Z';
    const r = String(await ctx.tool(MANAGE, args));
    if (falhou(r)) throw new Error(r.slice(0, 160));
  }

  // ---- Eventos do navegador ----
  root.addEventListener('dragstart', (e) => {
    const c = e.target.closest('[data-ref]');
    if (!c || c.getAttribute('draggable') !== 'true') return;
    arrastando = c.dataset.ref;
    e.dataTransfer.setData('text/plain', arrastando);
    e.dataTransfer.effectAllowed = 'move';
    c.classList.add('arrastando');
  });
  root.addEventListener('dragend', () => { arrastando = null; root.querySelectorAll('.arrastando,.over').forEach((x) => x.classList.remove('arrastando', 'over')); });
  root.addEventListener('dragover', (e) => {
    const col = e.target.closest('[data-col]');
    if (!col || !arrastando) return;
    e.preventDefault();
    root.querySelectorAll('.kb-col.over').forEach((x) => x.classList.remove('over'));
    col.classList.add('over');
  });
  root.addEventListener('dragleave', (e) => { const col = e.target.closest('[data-col]'); if (col && !col.contains(e.relatedTarget)) col.classList.remove('over'); });
  root.addEventListener('drop', async (e) => {
    const col = e.target.closest('[data-col]');
    if (!col || !arrastando) return;
    e.preventDefault();
    col.classList.remove('over');
    const ref = e.dataTransfer.getData('text/plain') || arrastando;
    arrastando = null;
    await mover(ref, col.dataset.col);
  });
  root.addEventListener('click', async (e) => {
    const f = e.target.closest('[data-f]');
    if (f) { filtro = f.dataset.f; await ctx.store.set('filtro', filtro); render(); return; }
    if (e.target.closest('#recarregar')) { await carregarAgendas(); await carregar(); ctx.ui.toast('Atualizado', 'ok'); return; }
    if (e.target.closest('#config-btn')) { const c = $('#config'); c.hidden = !c.hidden; if (!c.hidden) renderConfig(); }
  });
  root.addEventListener('change', async (e) => {
    if (e.target.id === 'c-prox') cfg.proximos = Number(e.target.value);
    else if (e.target.id === 'c-pass') cfg.passados = Number(e.target.value);
    else if (e.target.dataset && e.target.dataset.cal) {
      const marcadas = new Set(cfg.agendas || []);
      if (e.target.checked) marcadas.add(e.target.dataset.cal); else marcadas.delete(e.target.dataset.cal);
      if (!marcadas.size) { marcadas.add('primary'); ctx.ui.toast('Pelo menos uma agenda fica ligada: a Principal foi mantida.', 'warn'); }
      cfg.agendas = Array.from(marcadas);
    } else return;
    await ctx.store.set('cfg', cfg);
    renderConfig();
    await carregar();
  });
  $('#nova').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, titulo = f.titulo.value.trim();
    if (!titulo) return;
    try { await criar(titulo, f.prazo.value); f.reset(); ctx.ui.toast('Tarefa criada no Google Tasks', 'ok'); }
    catch (err) { ctx.ui.toast('Não consegui criar: ' + String((err && err.message) || err), 'error'); return; }
    await carregar();
  });

  await carregarAgendas();
  await carregar();
  // compromissos mudam de coluna com o passar da hora, sem chamar o Google de novo
  setInterval(render, 30000);
  ctx.main(async () => { await carregar(); });
});
