# Studio: dados, componentes, páginas e pacotes

## Modelo

```
Coleção ──registros──▶ (persistem no SQLite)
   ▲ read/write (permissions)
Componente (html+css+js, iframe isolado) ──ctx.store──▶ estado próprio (persiste)
   │  ctx.tool / ctx.agent.run
   ▼
Canvas de orquestração (agentes, ferramentas MCP, dados)      Página do dashboard = grade de componentes
Pacote = coleções + componentes + canvases + páginas + conexões pedidas
```

## Coleções (banco sob medida)

`POST /collections` `{name, label, fields:[{name, type, required?, options?}]}`. Tipos: `text`, `longtext`, `number`, `date`, `boolean`, `select`. Registros são validados contra o esquema (número convertido, select restrito, obrigatórios). Campos `id`, `createdAt`, `updatedAt` existem em todo registro. Enviar `null` num campo o limpa. Limites: 40 campos, 10 000 registros por coleção.

## Componentes

Um componente é `{html, css, js, permissions, refreshSeconds}`. O `js` sempre começa com `studio.main(async (ctx) => { … })`.

| API | O que faz |
|---|---|
| `ctx.records("colecao")` | `list(params)`, `create`, `update(id, body)`, `remove(id)` — só o que `permissions.read/write` liberar |
| `ctx.store.get/set/remove/all` | estado persistente do componente (chaves `[A-Za-z0-9_.:-]{1,60}`, ≤ 64 KB por valor, ≤ 100 chaves) |
| `ctx.tool(nome, args)` | ferramentas de `permissions.tools` (embutidas e de servidores MCP) |
| `ctx.agent.run(idOuChave, texto)` | executa um canvas de agentes (`permissions.agents`); devolve `{status, result, error}` |
| `ctx.inbox()` | itens entregues por um nó `ui.block` do canvas |
| `ctx.ui.modal / confirm / toast`, `ctx.close` | interface (modais são iframes isolados que herdam as permissões) |
| `ctx.config` | configuração do pacote (`agents`, `tools` mapeadas) |

Isolamento: `sandbox="allow-scripts"` (origem opaca), CSP `connect-src 'none'`, scripts só com nonce (HTML do componente não injeta script nem handlers inline), sem `alert/confirm/prompt`, sem `localStorage`. Limite de 120 chamadas/5 s por componente.

**Aprovação**: componentes criados por agente/API (`source: "agent"`) nascem `approved: false`; alterar `html/css/js/permissions` revoga; só o usuário aprova (`PATCH /blocks/:id/approve`, botões “Aprovar” no dashboard, em Componentes e no painel “Criar com Claude”).

**Versões**: cada alteração de código/permissões guarda a versão anterior (30 por componente). `POST /blocks/:id/versions/:versionId/restore` volta (e revoga a aprovação).

**Consistência (lint)**: `POST/PUT /blocks` devolvem `warnings`: falta `studio.main`; rede/`localStorage`/`alert` (bloqueados); handlers inline e `<script>` no html; recursos externos; **cores/fonte fixas** (use as variáveis do design system); coleção/ferramenta usada **sem permissão**; escrita com permissão só de leitura. Permissões para coleção inexistente são **recusadas** (400).

### Design system e tema

Classes `ac-*` e variáveis `--ac-*` são injetadas em todo componente e modal (`apps/web/lib/design-system.ts`). O **tema** (`GET/PUT /theme`: `accent`, `radius`, `fontSize`, `density`) é salvo no banco e aplicado a todos os componentes e ao app — assim componentes de origens diferentes ficam consistentes, em claro e escuro.

## Notificações e lembretes

- **Notificação** = registro em `notifications` (últimas 200) + evento SSE (`GET /notifications/stream`). O sino do Studio (`NotificationCenter`) mostra o balão e, com a permissão do navegador, dispara `new Notification(...)` quando a aba está em segundo plano. Avisos recebidos com o Studio fechado ficam não lidos no sino.
- **Quem pode avisar**: qualquer componente (`ctx.tool("notify", {title, message, level})` com `permissions.tools: ["notify"]`), qualquer agente (`notify` em `tools`), o nó **`action.notify`** de uma orquestração (simulação não notifica; máx. 20 por execução) e os lembretes.
- **Lembretes**: coleção `sistema_lembretes` (criada pelo servidor). A cada 15 s o `RemindersService` dispara os lembretes `ativo` dentro da janela `inicio`–`fim` cujo `a_cada_min` venceu (`ultimo_disparo` é do servidor; um servidor parado dispara uma vez ao voltar) e, se houver `canvas_id`, executa essa orquestração ao vivo com a mensagem como pedido.

## Páginas do dashboard

`DashboardPage {id, name, position, layout[]}`; cada item `{i, kind: "block"|"heading", blockId|text, x, y, w, h}` numa **grade de 12 colunas** (linha de 40 px). `PUT /pages/:id` aceita `baseUpdatedAt` (409 em conflito). `POST /pages/:id/place` acrescenta um componente no fim. Reordenar: `PUT /pages/order {ids}`. A barra lateral do Dashboard lista as páginas (paginação); **Editar layout** liga arrastar/redimensionar/bandeja; **Tela cheia** usa a Fullscreen API.

## Pacotes (biblioteca)

Pasta `packages/server/src/packages/library/<id>/` com `manifest.json` + arquivos dos componentes (`htmlFile/cssFile/jsFile`). O manifesto:

```jsonc
{ "id", "name", "description", "category", "version", "experimental?",
  "requires": [ {"id","kind":"collection","label","collection"},
                {"id","kind":"tool","label","hint","match":["calendar"],"optional?"},   // o usuário mapeia uma ferramenta MCP
                {"id","kind":"ai","label","optional?"} ],
  "collections": [...], "blocks": [{"key","name","permissions":{"tools":["@idDoRequisito"],"agents":["chaveDoCanvas"]}, ...}],
  "canvases": [{"key","name","nodes","edges"}],   // nós agent.llm podem listar "@idDoRequisito" em tools
  "pages": [{"name","layout":[{"blockKey","x","y","w","h"}]}], "seed": {"colecao":[{...}]} }
```

`POST /packages/:id/install` cria tudo (com rollback em caso de erro) e `PUT /packages/:id/connections {idDoRequisito: "mcp__servidor__ferramenta"}` conecta: resolve `@id` nas permissões dos componentes e nos nós de agente, e entrega `ctx.config.tools`. Pacotes **criados pelo Claude** (`save_package`) ou importados entram na biblioteca; se vieram de agente, o componente instalado exige aprovação. Desinstalar remove componentes, páginas e canvases (e, opcionalmente, os dados).

## Criar com Claude (construtor autônomo)

`POST /builder/runs {prompt, pageId?}` executa `claude -p` (Claude Code) em segundo plano com `--strict-mcp-config`, **só** o MCP `agent-canvas` liberado (`--allowedTools mcp__agent-canvas`, sem Bash/arquivos/web), `--permission-mode dontAsk` e um prompt de sistema que manda seguir o `studio_guide`. O progresso (chamadas de ferramenta, falas) fica em `GET /builder/runs/:id`; ao terminar traz o que foi criado/alterado (coleções, componentes com estado de aprovação, páginas). Uma execução por vez; limite de 12 min.

## MCP (`packages/mcp`)

Ferramentas: `studio_guide`, `list_collections`, `save_collection`, `list_records`, `save_record`, `delete_record`, `list_blocks`, `get_block`, `save_block`, `delete_block`, `block_versions`, `list_pages`, `save_page`, `place_block`, `delete_page`, `list_packages`, `save_package`, `get_theme`, `set_theme`, além das de orquestração (`canvas_guide`, `canvas_nodes`, `list_canvases`, `get_canvas`, `save_canvas`, `run_canvas` — só simulação —, `canvas_runs`, `delete_canvas`). Prompts: `construir-dashboard`, `construir-canvas`. Recursos: `studio://guia`, `canvas://guia`.
