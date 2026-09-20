// Guia do Studio: como o Claude constroi dashboards, componentes visuais e o banco (colecoes) dentro do Agent Canvas.
export const STUDIO_GUIDE = `# Agent Canvas Studio: construir dashboards, componentes e dados

O usuario pede em linguagem natural (\"um kanban\", \"um CRM\", \"um painel do Google Workspace\", \"notas\") e VOCE constroi, dentro do app, usando estas ferramentas:
**dados** (colecoes), **componentes** (blocos: HTML+CSS+JS), **paginas do dashboard** (grade de componentes) e, se preciso, **agentes** (canvases de orquestracao).

## Fluxo padrao (sempre nesta ordem)
1. \`list_collections\`, \`list_blocks\`, \`list_pages\` — veja o que ja existe (reaproveite e nao duplique).
2. Modele os DADOS: \`save_collection\` (uma colecao por entidade). Os dados persistem no banco.
3. Escreva cada COMPONENTE com \`save_block\` (html + css + js + permissions). A resposta traz \`warnings\`: corrija TODOS ate ficar vazio.
4. Monte a PAGINA: \`save_page\` (layout completo) ou \`place_block\` (acrescenta no fim).
5. Se o componente precisar de IA/automacao: monte o canvas de agentes (guia: canvas_guide) e permita-o no componente (\`permissions.agents\`).
6. Diga ao usuario: componentes criados por voce ficam **aguardando aprovacao**; ele revisa as permissoes e clica em Aprovar (aba Componentes, ou \"Editar layout\" no dashboard). Voce nunca aprova.

## Persistencia e consistencia (regras duras)
- **Todo dado do usuario vive numa colecao** (nunca so em memoria; \`localStorage\`/\`sessionStorage\`/\`indexedDB\`/cookies NAO existem no isolamento).
- **Estado de tela** (aba, filtro, ordenacao, item selecionado, rascunho) vai em \`ctx.store\` (persistente por componente): restaure-o ao abrir.
- O **design** persiste: o codigo do componente fica no banco com historico de versoes (restauravel). Ao ALTERAR um componente que ja existe use \`get_block\` e depois \`save_block\` com o \`id\` e um \`versionNote\` curto; nao recrie do zero.
- **Design consistente**: use so as classes \`ac-*\` e as variaveis CSS do design system (abaixo). Nunca #hex/rgb/hsl nem font-family — o tema (cor de destaque, cantos, fonte, densidade) e do usuario e vale para todos os componentes, claro e escuro.
- **Dados consistentes**: permissions apontam so para colecoes existentes; declare exatamente o que usa (\`read\`/\`write\` com \`col:<nome>\`); o mesmo campo tem o mesmo tipo em todos os componentes; calcule totais a partir dos registros (nao duplique valores derivados em campos).
- Idempotencia: ao (re)criar coisas, procure antes por nome (list_*) e atualize em vez de duplicar.

## Colecoes (save_collection)
\`{name (minusculas/_ 2-40, comeca com letra), label, description, fields:[{name, label?, type: text|longtext|number|date|boolean|select|relation, required?, options? (select), collection? (relation), default? (now|today|time)}]}\`.
Nomes de campo: minusculas/_; nao use id, createdAt, updatedAt (existem sozinhos em todo registro). Datas em ISO (\`2026-10-01\`). Prefixe colecoes por dominio quando houver risco de colisao (\`crm_contatos\`).
- **relation**: o campo guarda o **id** de um registro de outra colecao (\`{name:"habito_id", type:"relation", collection:"rotina_habitos"}\`). O servidor recusa um id que nao existe. Prefira relation a text para ligar colecoes.
- **default** (so em date e text): preenche sozinho ao CRIAR, no fuso local. \`today\` = AAAA-MM-DD; \`now\` = data e hora com fuso (2026-09-20T14:11:37-03:00); \`time\` = HH:MM (so em text). Assim ninguem precisa perguntar as horas nem misturar UTC com hora local. \`createdAt\`/\`updatedAt\` sao sempre UTC; a ferramenta \`now\` da a hora local.
- Varios registros de uma vez: \`save_records\` (tudo ou nada). Apagar vai para a lixeira por 30 dias (\`list_trash\`, \`restore_record\`).

## Componente (save_block)
\`{id? (para editar), name, description, html, css, js, permissions:{read:[\"col:x\"], write:[\"col:x\"], tools:[\"nome_exato_da_ferramenta\"], agents:[\"id_do_canvas\"]}, refreshSeconds (0 ou 5-3600), versionNote?}\`.
Roda num iframe isolado (sem rede). O html vai dentro de \`<div id=\"root\">\`; o js SEMPRE comeca com \`studio.main(async (ctx) => { ... })\`.

### API do ctx
- \`ctx.records(\"colecao\")\` → \`{list(params), create(body), update(id, body), remove(id)}\`. list: \`q\` (busca), \`sort\`, \`order\`, \`limit\`, e \`campo: valor\` (igualdade). update com \`null\` limpa o campo. Cada registro tem \`id, createdAt, updatedAt\`.
- \`ctx.store.get(chave, padrao)\` / \`set(chave, valor)\` / \`remove(chave)\` / \`all()\` — estado persistente do componente (ate 64 KB por chave).
- \`ctx.tool(nome, args)\` — chama uma ferramenta (so as de \`permissions.tools\`; use os nomes de \`canvas_nodes\`).
- \`ctx.agent.run(\"idDoCanvas\", \"texto\")\` → \`{status, result, error}\` — executa o time de agentes de um canvas (so os de \`permissions.agents\`, ou \"*\"). Leva segundos: mostre estado de carregando.
- \`ctx.ui.modal({title, html, js, css, size:'sm'|'md'|'lg'})\` → valor passado a \`ctx.close(valor)\` dentro do modal (o modal e outro iframe com o mesmo runtime; passe os dados iniciais embutindo \`JSON.stringify(dados)\` no js do modal). \`ctx.ui.confirm(msg,{danger,confirmLabel})\`, \`ctx.ui.toast(msg,'ok'|'warn'|'error')\`. **Nao use alert/confirm/prompt.**
- \`ctx.escape(texto)\` — SEMPRE escape dados do usuario ao montar innerHTML. \`ctx.config\` — configuracao do pacote (ferramentas/agentes mapeados).
- Eventos: sem atributos inline (onclick=...): use \`addEventListener\` (delegacao no root e o padrao). Arrastar e soltar (HTML5 dnd) funciona.
- Com \`refreshSeconds\` > 0 o main roda de novo periodicamente: ligue os listeners UMA vez e, no fim do main, troque o handler de atualizacao com \`ctx.main(async () => { await load(); })\` (assim so recarrega os dados).

### Padrao de componente (resumo)
\`\`\`js
studio.main(async (ctx) => {
  const items = ctx.records('tarefas');
  const root = ctx.root;
  let all = [], filtro = await ctx.store.get('filtro', '');
  async function load() { all = await items.list({ sort: 'createdAt' }); render(); }
  function render() { root.innerHTML = '...' + all.map(t => '<div class=\"ac-card\">' + ctx.escape(t.titulo) + '</div>').join(''); }
  root.addEventListener('click', async (e) => { const b = e.target.closest('[data-del]'); if (b && await ctx.ui.confirm('Excluir?', { danger: true })) { await items.remove(b.dataset.del); await load(); } });
  await load();
  ctx.main(async () => { await load(); });
});
\`\`\`
Formulario de criar/editar: abra \`ctx.ui.modal\` com o html do form e um js que le os campos e chama \`ctx.close({...})\`; depois do retorno faca \`create/update\` e \`load()\`.

## Design system (classes e variaveis; injetados em todo componente e modal)
Layout: \`ac-stack\` (coluna), \`ac-row\`, \`ac-row-between\`, \`ac-row-end\`, \`ac-wrap\`, \`ac-grow\`, \`ac-grid\` (colunas auto), \`ac-card\`.
Texto: \`ac-title\`, \`ac-subtitle\`, \`ac-muted\`, \`ac-big\` (numeros de KPI), \`ac-link\`, \`ac-danger\`, \`ac-empty\` (estado vazio).
Acao: \`ac-btn\`, \`ac-btn-primary\`, \`ac-btn-danger\`, \`ac-btn-sm\`, \`ac-btn-ghost\`. Formulario: \`ac-field\` (>label + campo), \`ac-input\`, \`ac-select\`, \`ac-textarea\`.
Dados: \`ac-badge\` (+ \`-ok\`, \`-warn\`, \`-accent\`, \`-danger\`), \`ac-bar\` (>\`i\` com width%), \`ac-table\`, \`ac-list\`, \`ac-tabs\`/\`ac-tab\` (\`.active\`).
Variaveis: \`--ac-accent --ac-accent-soft --ac-fg --ac-muted --ac-border --ac-surface --ac-bg --ac-hover --ac-ok --ac-warn --ac-danger --ac-radius --ac-gap\`.
CSS proprio so para layout (grid/flex/tamanhos), sempre com essas variaveis para cor. Componentes vivem em celulas redimensionaveis (4 a 12 colunas): seja responsivo (grid com \`auto-fit\`, \`min-width: 0\`, sem larguras fixas).

## Paginas do dashboard (save_page / place_block)
Grade de **12 colunas**; a linha tem 40 px (h=9 ≈ 360 px). \`layout\`: \`[{kind:\"heading\", text:\"Vendas\", x:0, y:0, w:12, h:1}, {kind:\"block\", blockId:\"...\", x:0, y:1, w:6, h:9}, ...]\`. Sem sobreposicao: comece pelos KPIs no topo (h 3-4), depois os componentes principais (w 6 ou 12, h 9-14). Titulos de secao organizam a pagina. O usuario reorganiza arrastando e redimensionando — seu layout e o ponto de partida.

## Agentes
Um componente pode acionar agentes (canvases) com \`ctx.agent.run\`. Crie o canvas com \`save_canvas\` (veja canvas_guide), simule com \`run_canvas\`, e ponha o **id** dele em \`permissions.agents\` do componente. Agentes leem/gravam a mesma colecao pelas ferramentas \`list_records\`/\`save_record\`.

## Notificacoes e lembretes
- Ferramenta \`notify\` {title*, message?, level?: info|ok|warn|error}: avisa o usuario (balao + sino no Studio; notificacao do navegador se ele ativou). Um componente a usa com \`ctx.tool('notify', {...})\` e \`permissions.tools: ['notify']\`; agentes/canvases a usam listando \`notify\` em \`tools\` ou no no **action.notify** (veja canvas_guide).
- **Lembretes recorrentes**: colecao do sistema \`sistema_lembretes\` {chave (quem criou, ex.: \"agua\"), titulo*, mensagem, ativo (boolean), a_cada_min (numero), inicio/fim (\"HH:MM\", janela do dia), canvas_id (opcional: orquestracao executada a cada disparo, ao vivo), depois_de (opcional: nome de uma colecao, ex.: \"saude_agua\"; o intervalo passa a contar do registro MAIS RECENTE dela, entao registrar adia o proximo aviso), ultimo_disparo (o SERVIDOR controla)}. O servidor dispara sozinho (mesmo com o Studio fechado). O componente so cria/edita o registro (\`read\`/\`write\` \`col:sistema_lembretes\`), achando o seu por \`chave\`; ao ativar, grave \`ultimo_disparo\` = agora para o primeiro aviso vir depois do intervalo.
- Nao invente agendador no componente (timers do iframe morrem ao fechar a pagina): use a colecao de lembretes.

## Conexoes externas (Google Workspace, CRM, ERP…)
Componentes acessam sistemas externos so por **ferramentas MCP** ja conectadas no servidor (veja canvas_nodes → ferramentas \`mcp__servidor__...\`). Nunca invente ferramentas: liste-as e use os nomes exatos em \`permissions.tools\`. Se a ferramenta necessaria nao existe, diga ao usuario qual servidor MCP conectar (aba Biblioteca → \"Reconectar ferramentas\").

## Pacotes (save_package)
Um pacote reune colecoes + componentes + canvases + paginas + as conexoes que pede (\`requires\`) para o usuario instalar de novo em outro lugar. Use quando o usuario quiser \"um pacote\" reutilizavel; para uso imediato basta criar as pecas direto (colecoes/componentes/paginas). Formato: veja o campo \`exemplo\` de list_packages.

## Checklist antes de responder
- warnings vazios em todos os componentes; permissions minimas e corretas;
- dados de exemplo (\`save_record\`) so se o usuario quiser demonstracao;
- pagina montada sem sobreposicao e com titulos de secao;
- resumo curto: o que foi criado (colecoes, componentes, paginas), o que o usuario precisa aprovar/conectar e como abrir (aba Dashboard).
`;
