# Google: Agenda, Gmail e Tarefas

O Studio conversa com a sua conta Google por um **servidor MCP** (`workspace-mcp`, rodado com `uvx`) que a própria API conecta e vigia. Os componentes, os agentes e o Claude usam o Google **por ferramentas**, sem nunca ver a sua senha nem o segredo do cliente OAuth.

## Conectando a conta

Requisito: o **uv** instalado ([docs.astral.sh/uv](https://docs.astral.sh/uv/)). Se você instalou depois de subir o Studio, reinicie o `pnpm dev` para ele enxergar o `PATH`.

### 1. Crie as credenciais no Google Cloud (uma vez)

1. Em [console.cloud.google.com](https://console.cloud.google.com), crie um projeto e **ative as APIs** *Google Calendar*, *Gmail* e *Google Tasks*.
2. **Tela de consentimento OAuth**: tipo de usuário **Externo**; adicione o seu e-mail como **usuário de teste**.
3. **Credenciais → Criar credenciais → ID do cliente OAuth → “App para computador”.**
4. Baixe o JSON (ícone de download). Depois de conectar você pode apagar o arquivo da pasta Downloads.

> Se o cliente for do tipo *Aplicativo da Web*, registre o URI de redirecionamento `http://localhost:8000/oauth2callback` no Google Cloud; o app avisa quando o arquivo é desse tipo.

### 2. Conecte no Studio

**Configurações → Conta Google** (ou o botão na **Biblioteca**):

1. Digite o **e-mail** da conta.
2. Clique em **Escolher client_secret.json** (a leitura do arquivo acontece no seu navegador) ou, em *Ou cole o Client ID e o Client secret*, cole os dois valores.
3. **Salvar e conectar.** Na primeira vez baixa o servidor (`uvx workspace-mcp`). O app grava `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` e `USER_GOOGLE_EMAIL` no `.env`, declara o servidor `google-workspace` no `.mcp.json`, reconecta e liga as ferramentas ao pacote *Google Workspace*.
4. **Autorizar no Google**: abre o login do Google numa nova aba (o app só abre links de `accounts.google.com`). Faça o login e volte.
5. **Testar conexão**: lê a agenda e responde *ok* ou *precisa de login*.

O painel mostra o estado em quatro passos: `uv` instalado · chaves salvas · servidor conectado (com o número de ferramentas) · ferramentas ligadas ao pacote.

**Desconectar** remove o servidor do `.mcp.json` e apaga as três chaves do `.env`.

O cliente OAuth é **seu** (da sua conta do Google Cloud) e o segredo fica só no seu `.env`. Ninguém, inclusive o Claude, precisa dele: o `user_google_email` e a autorização são tratados pelo servidor MCP.

## O que o Studio faz com o Google

| Onde | O que |
|---|---|
| Pacote **Google Workspace** | Quatro componentes (resumo do dia, agenda, tarefas, e-mails) e a orquestração *Workspace: resumo do dia* |
| Pacote **Kanban Google** | Kanban *A fazer / Fazendo / Feito* ligado ao Google Tasks (arraste para concluir), com a Agenda ao lado: escolha quantos dias mostrar e quais agendas (por exemplo *Família*) |
| **Ferramentas estruturadas** | `google_tasks_list`, `google_task_set`, `google_task_create`, `google_events_list`, `google_calendars_list`: devolvem JSON |
| **Sincronização de tarefas** | Mantém `rotina_tarefas` e o Google Tasks em sincronia (abaixo) |

### Kanban Google e a coluna “Fazendo”

O Google Tasks só guarda dois estados: **pendente** e **concluída**. Por isso a coluna *Fazendo* é um marcador **local**: a coleção `kanban_google_estado` (`ref`, `coluna`) só aceita o valor `fazendo`, e só lista as tarefas que você arrastou para lá. *A fazer* = pendente sem marcador; *Feito* = concluída no Google. Não é um defeito: não existe outra coluna a guardar. Compromissos da Agenda entram nas colunas pela hora e **se movem sozinhos** (a fazer → em andamento → feito).

## Ferramentas estruturadas (JSON)

O servidor do Google responde em texto (`- Título (ID: …)` seguido de linhas `Status:`, `Due:`). As ferramentas `google_*` do app fazem essa leitura **uma vez**, no servidor, e devolvem dados. Assim nem o Claude nem os agentes nem os componentes precisam interpretar texto.

| Ferramenta | Devolve |
|---|---|
| `google_tasks_list` `{list?, showCompleted?, maxResults?}` | `{ count, tasks: [{ id, title, status: "open"\|"done", due, completedAt }] }` |
| `google_task_set` `{id, done, list?}` | conclui ou reabre (`{ ok, id, status }`). **Altera** a conta |
| `google_task_create` `{title, due?, notes?, list?}` | cria (`{ ok, id? }`). **Altera** a conta |
| `google_events_list` `{calendar?, days?, from?, to?, maxResults?}` | `{ count, events: [{ id, title, start, end, allDay, meet, calendarId }] }` |
| `google_calendars_list` `{}` | `{ calendars: [{ id, name, primary }] }` |

Se a resposta pedir login ou for um erro do Google, a ferramenta **falha com uma mensagem clara** (“a conta Google precisa de login…”) em vez de devolver texto que pareça dado. As leituras são seguras para a simulação; `google_task_set` e `google_task_create` só rodam ao vivo.

No Claude Code (MCP): `google_tasks`, `google_task_set` (aceita `ids` para várias de uma vez), `google_events`, `google_calendars`. Para qualquer outra coisa do Google (Gmail, criar evento…) continuam `list_external_tools`, `describe_external_tool`, `read_external_tool` e `call_external_tool`; veja [MCP.md](MCP.md).

## Tarefas em um lugar só: a sincronização

Se você usa a lista de tarefas da **Rotina** (`rotina_tarefas`) e o **Google Tasks**, a sincronização evita consultar os dois. Ela **nunca apaga** nada de nenhum lado.

**Regras**

1. **Vínculo.** Cada tarefa local guarda o `google_id` da tarefa do Google e o `google_sync` (o último estado igual nos dois lados: `aberta` ou `feita`). Os dois campos são acrescentados à coleção na primeira sincronização.
2. **Primeira vez, sem duplicar.** Uma tarefa **aberta** local e uma **aberta** do Google com o **mesmo título** (sem diferenciar acento, caixa nem espaços repetidos) são **vinculadas**, não duplicadas. Tarefa local já feita nunca é vinculada a uma do Google com o mesmo título (é comum tarefa recorrente, como “Tirar a louça”).
3. **Concluir e reabrir vão para o outro lado.** Quem mudou desde a última sincronização manda. Sem sincronização anterior, *concluída* vence: uma tarefa que alguém já fechou não é reaberta.
4. **Novas de um lado aparecem no outro.** Tarefa aberta do Google que não existe aqui vira registro local; tarefa local aberta sem vínculo é criada no Google. Não se importa histórico: só tarefas **abertas** do Google.
5. **Não sobrescreve** título, prazo ou notas de uma tarefa já vinculada.
6. Uma tarefa vinculada que **sumiu do Google** não é recriada nem apagada.

**Como usar**

- Peça ao Claude: *“sincronize minhas tarefas com o Google”* (`sync_google_tasks`), ou `POST /sync/google-tasks`. O resultado traz quantas foram importadas, criadas no Google, concluídas/reabertas de cada lado e os problemas encontrados.
- **Automática** (vem desligada): `sync_google_tasks` com `{enabled: true, everyMinutes: 10}` (ou `PUT /sync/google-tasks`). Ligada, sincroniza ao mudar uma tarefa local (após 4 s) e a cada N minutos. Se algo falhar, o resultado fica em `GET /sync/google-tasks`.
- A sincronização **escreve na sua conta Google**, por isso só roda por pedido seu (manual ou ao ligar a automática) e o Claude do terminal pede confirmação antes de usá-la.

Se você não usa a Rotina e prefere o Google como fonte única, use só o **Kanban Google** ou o componente *Workspace: tarefas* e ignore `rotina_tarefas`.

## Segurança e privacidade

- As chaves ficam no `.env` e nenhuma resposta da API as devolve.
- Os componentes só usam as ferramentas listadas em `permissions.tools` (por exemplo `mcp__google-workspace__list_tasks`, `google_tasks_list`); o Claude só altera dados do Google quando você pede.
- O e-mail salvo é aplicado a **toda** chamada ao Google, então um modelo não consegue usar outra conta por engano.
- O Gmail é acessado só em leitura pelos componentes de fábrica.

## Problemas comuns

| Sintoma | Causa e solução |
|---|---|
| “uv instalado” não fica verde | Instale o `uv`; reinicie `pnpm dev` |
| “configurado, não iniciou” | Veja o erro abaixo do passo; confira se as APIs foram ativadas no projeto do Google Cloud |
| “a conta Google precisa de login” | Clique em **Autorizar no Google**, faça o login e depois **Testar conexão** |
| Login recusado (“app não verificado”) | Adicione seu e-mail em *Usuários de teste* na tela de consentimento |
| Componente diz “Resposta inesperada” | O formato do servidor mudou: o conserto é no analisador `packages/server/src/integrations/google-parse.ts` |
