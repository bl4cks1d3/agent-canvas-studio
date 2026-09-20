# API HTTP (servidor em `http://localhost:5100`)

Sem autenticação: **só localhost**. `/tools/*` e `/builder/*` exigem além disso `Origin` do Studio (`http://localhost:5200`) ou ausente (curl). Erros de validação: `400 {message: string | string[]}`; conflito de edição: `409`.

## Orquestração (canvases)
| Método e rota | |
|---|---|
| `GET /health`, `GET /catalog` | tipos de nó, ferramentas (embutidas, Studio e MCP), provedores de IA, Claude Code |
| `GET/POST /canvases`, `GET/PUT/DELETE /canvases/:id` | CRUD; `PUT` aceita `baseUpdatedAt` |
| `POST /canvases/:id/run {mode: "live"|"dry", input?, startNodeId?, confirmed?}` | `live` exige `confirmed: true`; devolve o run (`running`) |
| `GET /runs/:id`, `POST /runs/:id/cancel`, `GET /canvases/:id/runs` | acompanhar |

Tipos de nó: `input.prompt`, `agent.llm`, `agent.claude`, `tool.call`, `data.records`, `action.record`, `action.notify`, `ui.block`, `logic.if`, `output.result`, `note`.

## Notificações
`GET /notifications?limit=` (mais novas primeiro), `GET /notifications/stream` (SSE: cada aviso novo chega como mensagem; `ping` a cada 25 s), `POST /notifications {title, message?, level?: info|ok|warn|error, source?}`, `POST /notifications/read {ids?}` (sem `ids` marca todas), `DELETE /notifications/:id`, `DELETE /notifications`. Escrita só da própria máquina/Studio. Também é a ferramenta `notify` (`POST /tools/call`) e o nó `action.notify`. Lembretes: coleção `sistema_lembretes` (ver STUDIO.md).

## Configurações (página "Configurações" do app)
**Provedores de IA** (grava no `.env` e vale na hora; nenhuma resposta traz a chave): `GET /integrations/ai` (chave salva?, modelo, provedor preferido, Claude Code instalado), `PUT /integrations/ai/:provider {apiKey?, model?, remove?}` (`groq|gemini|anthropic`; `model: ""` volta ao padrão), `PUT /integrations/ai/preferred {preferred: "auto"|provider}` (`AI_PROVIDER`), `POST /integrations/ai/:provider/test {model?}` (pedido mínimo), `GET /integrations/ai/:provider/models` (modelos de conversa que a chave enxerga). Agentes `agent.llm` em `auto` tentam o provedor preferido e, em 429/cota/serviço fora do ar, o próximo com chave; o `provider: "claude-code"` roda `claude -p` na conta do usuário só com os servidores MCP das ferramentas marcadas (`--allowedTools`, `--permission-mode dontAsk`). Limite de taxa: o servidor espera o tempo que o provedor pede (até 25 s, 3 tentativas) antes de trocar.
**Notificações**: `GET/PUT /notifications/settings {desktop?, sound?}` (`desktop` = notificação nativa do sistema: PowerShell/WinRT no Windows, `osascript` no macOS, `notify-send` no Linux; com ele ligado o Studio não toca som nem notifica pelo navegador, só mostra o balão), `POST /notifications/desktop-test`. O som dentro do Studio (toque e volume) fica no navegador.

## Dados
`GET/POST /collections`, `GET/PATCH/DELETE /collections/:name`, `GET/POST /collections/:name/records` (filtros `?campo=valor&q=&sort=&order=&limit=&offset=`), `PATCH/DELETE /collections/:name/records/:id`.

## Componentes
`GET/POST /blocks`, `GET/PUT/DELETE /blocks/:id` (POST/PUT devolvem `warnings`), `GET /blocks/:id/lint`, `PATCH /blocks/:id/approve {approved}`, `GET /blocks/:id/inbox`,
estado: `GET /blocks/:id/state`, `PUT /blocks/:id/state/:key {value}`, `DELETE /blocks/:id/state/:key`,
versões: `GET /blocks/:id/versions`, `GET /blocks/:id/versions/:versionId`, `POST /blocks/:id/versions/:versionId/restore`.
Tema: `GET/PUT /theme`.

## Páginas do dashboard
`GET/POST /pages`, `PUT /pages/order {ids}`, `GET/PUT/DELETE /pages/:id` (`PUT` aceita `name`, `layout`, `baseUpdatedAt`), `POST /pages/:id/place {blockId, w?, h?}`.

## Pacotes
`GET /packages`, `POST /packages` (salva definição criada/importada), `GET /packages/:id`, `POST /packages/:id/install`, `DELETE /packages/:id?dropData=true`, `PUT /packages/:id/connections`, `DELETE /packages/:id/definition`.

## Conta Google (botão "Conectar conta Google" da Biblioteca)
`GET /integrations/google` (estado: uv, chaves salvas, servidor conectado, ferramentas ligadas ao pacote; nunca devolve segredo), `POST /integrations/google/setup {email, clientId?, clientSecret?}` (grava `GOOGLE_OAUTH_CLIENT_ID/SECRET` e `USER_GOOGLE_EMAIL` no `.env`, declara `google-workspace` no `.mcp.json` com `uvx workspace-mcp`, reconecta e liga as ferramentas ao pacote; sem client id/secret reaproveita os salvos), `POST /integrations/google/refresh`, `POST /integrations/google/authorize` (devolve o link de login do Google, só `accounts.google.com`), `POST /integrations/google/test` (lê a agenda: `ok` ou `needsAuth`), `DELETE /integrations/google` (remove do `.mcp.json` e apaga as chaves do `.env`). Só a própria máquina/Studio. Nas chamadas MCP, `user_google_email` é preenchido com o e-mail salvo quando a ferramenta o exige e quem chamou não mandou.

## Padrão de fábrica
`GET /factory` (pacotes de fábrica: disponível na biblioteca? instalado? banco vazio? já instalou?), `POST /factory/restore` (instala os que faltam; não altera nada já instalado; só a própria máquina). Numa subida com o banco **vazio** o servidor instala o padrão sozinho uma vez (`AGENT_CANVAS_NO_FACTORY=1` desliga). Lista em `FACTORY_PACKAGES` (`packages/server/src/packages/factory.service.ts`). A API escuta em `SERVER_HOST` (padrão `127.0.0.1`).

## Ferramentas e construtor
`GET /tools`, `POST /tools/call {name, args}`, `POST /tools/reload` (relê o `.mcp.json` e reconecta os servidores MCP);
`GET /builder/status`, `GET /builder/runs`, `POST /builder/runs {prompt, pageId?}`, `GET /builder/runs/:id`, `POST /builder/runs/:id/cancel`.
