# API HTTP (servidor em `http://localhost:5100`)

Sem autenticação: **só localhost**. As rotas sensíveis (`/tools/*`, `/builder/*`, `/integrations/*`, escrita em `/notifications`, `/factory/restore`, `/sync/google-tasks`) exigem, além disso, `Origin` do Studio (`http://localhost:5200`) ou ausente (curl); veja [SEGURANCA.md](SEGURANCA.md). Corpo e resposta em JSON. Erros de validação: `400 {message: string | string[]}`; não encontrado: `404`; conflito de edição: `409`.

## Saúde, relógio e eventos

| Rota | O que faz |
|---|---|
| `GET /health` | `200` se a API está no ar |
| `GET /clock` | Hora atual no fuso local: `{utc, local, date, time, weekday, timezone, offsetMinutes, text}` |
| `GET /events` | **SSE** de mudanças: cada mensagem é `{type, key?}` com `type` = `data` (`key` = coleção), `blocks` (`key` = id), `pages`, `canvases`, `packages` ou `theme`. Avisos iguais em 80 ms chegam como um só. `ping` a cada 25 s. É o que faz a tela atualizar sozinha |

## Orquestração (canvases)

| Método e rota | |
|---|---|
| `GET /catalog` | Tipos de nó, ferramentas (embutidas, do Studio e MCP), provedores de IA, Claude Code |
| `GET/POST /canvases`, `GET/PUT/DELETE /canvases/:id` | CRUD; `PUT` aceita `baseUpdatedAt`; a resposta traz `problems` |
| `POST /canvases/:id/run {mode: "live"\|"dry", input?, startNodeId?, confirmed?}` | `live` exige `confirmed: true`; devolve a execução (`running`) |
| `GET /runs/:id`, `POST /runs/:id/cancel`, `GET /canvases/:id/runs` | Acompanhar |

Tipos de nó: `input.prompt`, `agent.llm`, `agent.claude`, `tool.call`, `data.records`, `action.record`, `action.notify`, `ui.block`, `logic.if`, `output.result`, `note` ([ORQUESTRACAO.md](ORQUESTRACAO.md)).

## Dados

| Rota | |
|---|---|
| `GET/POST /collections` | Listar (com nº de registros) e criar |
| `GET/PATCH/DELETE /collections/:name` | Ler, alterar título/campos, excluir a coleção (e seus registros) |
| `GET /collections/:name/records` | Filtros `?campo=valor&q=&sort=&order=&limit=&offset=` |
| `POST /collections/:name/records` | Cria (valida tipos, opções, obrigatórios e **relações**; preenche os `default`) |
| `PATCH /collections/:name/records/:id` | Atualiza (`null` limpa um campo) |
| `DELETE /collections/:name/records/:id` | Apaga → **lixeira**: `{ok, trashed: true, restore}` |
| `POST /collections/:name/records/batch` | `{create:[…], update:[{id,data}], delete:[ids]}`, **tudo ou nada**, até 200 → `{created, updated, deleted}` |
| `GET /collections/:name/trash` | Registros apagados (30 dias), com `deletedAt` |
| `POST /collections/:name/records/:id/restore` | Restaura da lixeira |
| `DELETE /collections/:name/trash` · `…/trash/:id` | Esvazia a lixeira (todos ou um). **Irreversível** |

Campos: `{name, label?, type, required?, options?, collection?, default?}` com `type` = `text`, `longtext`, `number`, `date`, `boolean`, `select`, `relation`; `default` = `today`, `now` ou `time` ([STUDIO.md](STUDIO.md#coleções-banco-sob-medida)).

## Componentes e tema

`GET/POST /blocks`, `GET/PUT/DELETE /blocks/:id` (POST/PUT devolvem `warnings`), `GET /blocks/:id/lint`, `PATCH /blocks/:id/approve {approved}`, `GET /blocks/:id/inbox`.
Estado: `GET /blocks/:id/state`, `PUT /blocks/:id/state/:key {value}`, `DELETE /blocks/:id/state/:key`.
Versões: `GET /blocks/:id/versions`, `GET /blocks/:id/versions/:versionId`, `POST /blocks/:id/versions/:versionId/restore`.
Tema: `GET/PUT /theme` (`accent`, `radius`, `fontSize`, `density`).

## Páginas do dashboard

`GET/POST /pages`, `PUT /pages/order {ids}`, `GET/PUT/DELETE /pages/:id` (`PUT` aceita `name`, `layout`, `baseUpdatedAt`), `POST /pages/:id/place {blockId, w?, h?}`.

## Pacotes

`GET /packages`, `POST /packages` (salva definição criada/importada), `GET /packages/:id`, `POST /packages/:id/install`, `DELETE /packages/:id?dropData=true`, `PUT /packages/:id/connections {idDoRequisito: "mcp__servidor__ferramenta"}`, `DELETE /packages/:id/definition`.

### Padrão de fábrica

`GET /factory` (pacotes de fábrica: disponível na biblioteca? instalado? banco vazio? já instalou?) e `POST /factory/restore` (instala os que faltam; não altera nada já instalado; só a própria máquina). Numa subida com o banco **vazio** o servidor instala o padrão sozinho uma vez (`AGENT_CANVAS_NO_FACTORY=1` desliga). Lista em `FACTORY_PACKAGES` (`packages/server/src/packages/factory.service.ts`).

## Ferramentas e construtor

| Rota | |
|---|---|
| `GET /tools` | Ferramentas (nome, parâmetros, origem, só leitura?) |
| `GET /tools/schema?name=` | Esquema JSON de uma ferramenta (sem o campo da conta Google) |
| `POST /tools/call {name, args}` | Executa uma ferramenta → `{result}`. Usado pela ponte dos componentes (que já conferiu as permissões) e pelo MCP |
| `POST /tools/reload` | Relê o `.mcp.json` e reconecta os servidores MCP |
| `GET /builder/status`, `GET /builder/runs`, `POST /builder/runs {prompt, pageId?}`, `GET /builder/runs/:id`, `POST /builder/runs/:id/cancel` | *Criar com Claude* |

Ferramentas embutidas: `get_time` (agora devolve também `local`, `date`, `time`, `weekday`, `timezone`), `fs_list`, `fs_read`, `fs_write`. Do Studio: `notify`, `list_collections`, `list_records`, `save_record`, `save_collection`, `list_blocks`, `get_block`, `save_block`. Do Google (JSON): `google_tasks_list`, `google_task_set`, `google_task_create`, `google_events_list`, `google_calendars_list`.

## Notificações

`GET /notifications?limit=` (mais novas primeiro), `GET /notifications/stream` (SSE: cada aviso novo chega como mensagem; `ping` a cada 25 s), `POST /notifications {title, message?, level?: info|ok|warn|error, source?}`, `POST /notifications/read {ids?}` (sem `ids` marca todas), `DELETE /notifications/:id`, `DELETE /notifications`. Escrita só da própria máquina/Studio. Também é a ferramenta `notify` e o nó `action.notify`. Lembretes: coleção `sistema_lembretes` ([STUDIO.md](STUDIO.md#notificações-e-lembretes)).

## Configurações

**Provedores de IA** (grava no `.env` e vale na hora; nenhuma resposta traz a chave):

- `GET /integrations/ai`: chave salva?, modelo, provedor preferido, Claude Code instalado;
- `PUT /integrations/ai/:provider {apiKey?, model?, remove?}` (`groq|gemini|anthropic`; `model: ""` volta ao padrão);
- `PUT /integrations/ai/preferred {preferred: "auto"|provider}` (`AI_PROVIDER`);
- `POST /integrations/ai/:provider/test {model?}` (pedido mínimo);
- `GET /integrations/ai/:provider/models` (modelos de conversa que a chave enxerga).

**Chaves personalizadas**: `GET /integrations/keys` (só os nomes), `PUT /integrations/keys {name, value}`, `DELETE /integrations/keys/:name`.

**Notificações**: `GET/PUT /notifications/settings {desktop?, sound?}` (`desktop` = notificação nativa do sistema: PowerShell/WinRT no Windows, `osascript` no macOS, `notify-send` no Linux; com ele ligado o Studio não toca som nem notifica pelo navegador, só mostra o balão), `POST /notifications/desktop-test`. O som dentro do Studio (toque e volume) fica no navegador.

## Conta Google e tarefas

- `GET /integrations/google`: estado (uv, chaves salvas, servidor conectado, ferramentas ligadas ao pacote; nunca devolve segredo).
- `POST /integrations/google/setup {email, clientId?, clientSecret?}`: grava `GOOGLE_OAUTH_CLIENT_ID/SECRET` e `USER_GOOGLE_EMAIL` no `.env`, declara `google-workspace` no `.mcp.json` com `uvx workspace-mcp`, reconecta e liga as ferramentas ao pacote (sem client id/secret reaproveita os salvos).
- `POST /integrations/google/refresh`; `POST /integrations/google/authorize` (devolve o link de login, só `accounts.google.com`); `POST /integrations/google/test` (lê a agenda: `ok` ou `needsAuth`); `DELETE /integrations/google` (remove do `.mcp.json` e apaga as chaves do `.env`).
- `GET /sync/google-tasks`: configuração e último resultado (`{enabled, everyMinutes, lastRunAt, lastResult}`).
- `POST /sync/google-tasks`: sincroniza **agora** `rotina_tarefas` com o Google Tasks (**escreve no Google**) → `{ok, importedFromGoogle, createdInGoogle, closedLocal, reopenedLocal, closedInGoogle, reopenedInGoogle, problems[]}`.
- `PUT /sync/google-tasks {enabled?, everyMinutes?}`: liga/desliga a automática (1 a 1440 min).

Nas chamadas MCP, `user_google_email` é preenchido com o e-mail salvo quando a ferramenta o exige. Todas só da própria máquina/Studio. Detalhes em [GOOGLE.md](GOOGLE.md).
