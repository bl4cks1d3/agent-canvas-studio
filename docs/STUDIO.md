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

`POST /collections` `{name, label, description?, fields:[…]}`. O `name` usa minúsculas, números e `_` (2 a 40 caracteres, começa com letra). Prefixe por domínio para evitar colisão (`crm_contatos`). Limites: 40 campos por coleção, 10 000 registros por coleção.

### Campos

`{name, label?, type, required?, options?, collection?, default?}`

| Tipo | Guarda | Observações |
|---|---|---|
| `text` | Texto até 2 000 caracteres | |
| `longtext` | Texto até 20 000 caracteres | |
| `number` | Número | Texto numérico (`"3"`) é convertido |
| `date` | Data ISO (`2026-10-01`) ou data e hora ISO (`2026-10-01T14:30:00-03:00`) | |
| `boolean` | Verdadeiro/falso | Aceita `"true"`/`"false"` |
| `select` | Uma das `options` | `options` é obrigatório (até 50) |
| `relation` | O **id** de um registro de outra coleção | `collection` é obrigatório. O servidor **recusa um id que não existe**, com a explicação e a coleção onde procurar |

Nomes de campo: minúsculas, números e `_`. `id`, `createdAt` e `updatedAt` existem em todo registro e não podem ser usados como nome de campo. Ao **editar**, enviar `null` num campo o limpa; texto vazio (`""`) é tratado como "não informado" e não altera o campo (ao criar, também conta como ausente).

**Valores automáticos (`default`).** Em campos `date` ou `text`, `default` preenche o campo **ao criar** o registro quando ele vem vazio, sempre no **fuso local da máquina**:

| `default` | Valor | Tipos permitidos |
|---|---|---|
| `today` | `2026-09-20` | `date`, `text` |
| `now` | `2026-09-20T14:11:37-03:00` (data e hora com fuso) | `date`, `text` |
| `time` | `14:11` | só `text` |

Quem informar o valor mantém o que informou. Assim ninguém precisa perguntar as horas nem misturar UTC com hora local. `createdAt`/`updatedAt` continuam em **UTC**; para a hora local use `GET /clock` (ferramenta MCP `now`).

### Registros

`GET /collections/:nome/records` aceita `?campo=valor` (igualdade), `q` (busca em todos os campos), `sort` (um campo, `createdAt` ou `updatedAt`), `order` (`asc`/`desc`), `limit` (até 1000, padrão 500) e `offset`. Registros são validados contra o esquema (tipo, opção, obrigatório, relação).

### Lote (tudo ou nada)

`POST /collections/:nome/records/batch` com `{create:[{…}], update:[{id, data}], delete:[ids]}` (até 200 operações). Se **qualquer** operação falhar, **nada** é gravado (transação). Resposta: `{created, updated, deleted}`.

### Lixeira (desfazer)

Apagar um registro (`DELETE …/records/:id`, o botão da tela, `ctx.records().remove` ou `delete` num lote) o **manda para a lixeira por 30 dias** (até 500 por coleção; o que passar disso ou de 30 dias é descartado). `GET /collections/:nome/trash` lista; `POST /collections/:nome/records/:id/restore` restaura com o mesmo id e os mesmos dados; `DELETE /collections/:nome/trash[/:id]` esvazia de vez (irreversível). Na tela: botão **Lixeira** em Dados. Excluir a **coleção** inteira não passa pela lixeira.

## Componentes

Um componente é `{html, css, js, permissions, refreshSeconds}`. O `js` sempre começa com `studio.main(async (ctx) => { … })`. A referência completa (o `ctx`, o design system, permissões, aprovação, versões, lint e isolamento) está em **[COMPONENTES.md](COMPONENTES.md)**.

Em resumo:

- Rodam num iframe isolado, sem rede; só enxergam o que `permissions` liberar, conferido a cada chamada.
- **Aprovação**: os criados por agente/API nascem `approved: false`; alterar `html/css/js/permissions` revoga; só o usuário aprova (`PATCH /blocks/:id/approve`).
- **Versões**: 30 por componente, restauráveis (`POST /blocks/:id/versions/:versionId/restore`).
- **Lint** ao salvar (`warnings`): rede, storage, handlers inline, cor/fonte fixas, coleção ou ferramenta sem permissão…
- **Atualizam sozinhos** quando os dados que leem mudam ([ARQUITETURA.md](ARQUITETURA.md#como-uma-alteração-chega-na-tela)).

### Design system e tema

As classes `ac-*` e as variáveis `--ac-*` são injetadas em todo componente e modal (`apps/web/lib/design-system.ts`). O **tema** (`GET/PUT /theme`: `accent`, `radius`, `fontSize`, `density`) é salvo no banco e aplicado a todos os componentes e ao app, em claro e escuro.

## Notificações e lembretes

- **Notificação** = registro em `notifications` (últimas 200) + evento SSE (`GET /notifications/stream`). O sino do Studio mostra o balão e, com a permissão do navegador, dispara `new Notification(...)` com a aba em segundo plano. Avisos recebidos com o Studio fechado ficam não lidos no sino. Em **Configurações** há o som (toque e volume) e o **modo desktop** (notificação nativa do sistema).
- **Quem pode avisar**: qualquer componente (`ctx.tool("notify", {title, message, level})` com `permissions.tools: ["notify"]`), qualquer agente (`notify` em `tools`), o nó **`action.notify`** de uma orquestração (a simulação não notifica; máx. 20 por execução) e os lembretes.
- **Lembretes recorrentes**: coleção `sistema_lembretes` (criada pelo servidor). A cada 15 s o `RemindersService` dispara os lembretes `ativo` dentro da janela `inicio`–`fim` (hora local) cujo intervalo venceu. Um servidor parado dispara **uma** vez ao voltar (não acumula). Campos:

  | Campo | Descrição |
  |---|---|
  | `chave` | Quem criou (ex.: `agua`); o componente acha o seu por aqui |
  | `titulo`* / `mensagem` | Texto da notificação |
  | `ativo` | Liga/desliga |
  | `a_cada_min` | Intervalo em minutos |
  | `inicio` / `fim` | Janela do dia (`HH:MM`); aceita atravessar a meia-noite |
  | `canvas_id` | (opcional) orquestração executada **ao vivo** a cada disparo, com a mensagem como pedido |
  | `depois_de` | (opcional) nome de uma coleção: o intervalo passa a contar do **registro mais recente dela**. Exemplo: `saude_agua` faz o lembrete de água esperar 60 min **depois do último copo registrado**, em vez de disparar de hora em hora mesmo depois de você beber |
  | `ultimo_disparo` | Controlado pelo **servidor** (o componente só o grava ao ativar, para o primeiro aviso vir depois do intervalo) |

- Não crie agendador dentro de um componente (timers do iframe morrem ao fechar a página): use a coleção de lembretes.

## Páginas do dashboard

`DashboardPage {id, name, position, layout[]}`; cada item `{i, kind: "block"|"heading", blockId|text, x, y, w, h}` numa **grade de 12 colunas** (linha de 40 px). `PUT /pages/:id` aceita `baseUpdatedAt` (409 em conflito). `POST /pages/:id/place` acrescenta um componente no fim. Reordenar: `PUT /pages/order {ids}`. A barra lateral do Dashboard lista as páginas; **Editar layout** liga arrastar/redimensionar/bandeja; **Tela cheia** usa a Fullscreen API.

## Pacotes (biblioteca)

Um pacote reúne coleções, componentes, orquestrações, páginas e as conexões que pede. Catálogo, formato do manifesto, padrão de fábrica e como criar um: **[BIBLIOTECA.md](BIBLIOTECA.md)**.

## Google

Ferramentas estruturadas (`google_tasks_list`, `google_events_list`…), Kanban Google e a **sincronização de tarefas** entre a Rotina e o Google Tasks: **[GOOGLE.md](GOOGLE.md)**.

## Criar com Claude (construtor autônomo)

`POST /builder/runs {prompt, pageId?}` executa `claude -p` (Claude Code) em segundo plano com `--strict-mcp-config`, **só** o MCP `agent-canvas` liberado (sem Bash/arquivos/web), `--permission-mode dontAsk` e um prompt de sistema que manda seguir o `studio_guide`. O progresso (chamadas de ferramenta, falas) fica em `GET /builder/runs/:id`; ao terminar traz o que foi criado ou alterado (coleções, componentes com estado de aprovação, páginas). Uma execução por vez; limite de 12 minutos. As ferramentas do MCP estão em **[MCP.md](MCP.md)**.
