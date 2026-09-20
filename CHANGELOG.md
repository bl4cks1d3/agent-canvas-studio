# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). O projeto ainda não segue versionamento semântico estrito.

## [Não lançado]

### Adicionado

- **Atualização automática da tela.** Um canal de eventos (`GET /events`, SSE) avisa qualquer mudança de dados, componentes, páginas, orquestrações, pacotes e tema, venha ela da tela, do Claude (MCP), de um agente ou de um lembrete. A tela recarrega as listas afetadas em cerca de 1 segundo, e os componentes que leem a coleção alterada reexecutam sozinhos. O polling continua como reserva.
- **Relógio e fuso local.** `GET /clock` e a ferramenta `now` (MCP); `get_time` devolve também data, hora, dia da semana e fuso. Campos `date`/`text` aceitam `default` (`today`, `now`, `time`) e se preenchem sozinhos ao criar o registro, no fuso local.
- **Campo `relation`.** Guarda o id de um registro de outra coleção e o servidor recusa ids inexistentes. Formulário com lista para escolher e rótulos na tabela. *Rotina e Estudo* passou a usar em `habito_id` e `materia_id`.
- **Lote e lixeira.** `POST /collections/:nome/records/batch` (tudo ou nada, até 200) e a ferramenta `save_records`. Apagar um registro vai para uma lixeira de 30 dias (listar, restaurar e esvaziar; botão **Lixeira** em Dados; `list_trash` e `restore_record` no MCP).
- **Lembretes ligados a registros.** `depois_de` em `sistema_lembretes`: o intervalo passa a contar do registro mais recente de uma coleção. O lembrete de água agora espera depois do último copo registrado.
- **Google como dados.** `google_tasks_list`, `google_task_set`, `google_task_create`, `google_events_list` e `google_calendars_list` devolvem JSON (no MCP: `google_tasks`, `google_task_set`, `google_events`, `google_calendars`), em vez de texto para interpretar.
- **Sincronização de tarefas com o Google Tasks.** `rotina_tarefas` ↔ Google Tasks: vincula a mesma tarefa por título (sem duplicar), replica concluir/reabrir nos dois sentidos, importa e exporta tarefas abertas e nunca apaga. Manual (`POST /sync/google-tasks`, `sync_google_tasks`) ou automática (desligada por padrão).
- **Favicon** do projeto (`icon.svg`, `favicon.ico`, `apple-icon.png`).
- **Documentação completa** em `docs/` e **licença MIT**.

### Alterado

- `save_collection`, `list_collections` e os guias do Claude descrevem `relation` e `default`.
- O perfil *Claude — controlar o Studio* libera sem perguntar `now`, `list_trash`, `save_records`, `restore_record` e as leituras do Google; continua perguntando antes de apagar, desinstalar, simular canvases, alterar a conta Google e sincronizar.
- Esquemas do padrão de fábrica: `rotina_checkins`, `rotina_diario`, `estudo_sessoes`, `estudo_cartoes` e `saude_agua` com relações e valores automáticos (versão 1.1.0 dos pacotes).

### Corrigido

- O lembrete de água deixa de disparar logo depois de você registrar que bebeu.

## [0.1.0] — 2026-09-20

Primeira versão publicada (com o pacote para Raspberry Pi como *release*).

### Adicionado

- **Studio:** dashboards em páginas com grade arrastável, coleções com esquema, componentes em iframe isolado com aprovação, versões, estado e tema, pacotes (biblioteca) e o construtor *Criar com Claude*.
- **Orquestração:** canvas de agentes com 11 tipos de nó, simulação e execução ao vivo, expressões seguras, provedores Groq, Gemini, Anthropic e Claude Code.
- **Notificações** (sino, som e notificação do sistema) e **lembretes recorrentes** disparados pelo servidor, também com o Studio fechado.
- **Configurações:** chaves e modelos de IA (gravadas no `.env`, sem nunca voltar pela API) e **conta Google** (botão *Conectar*, leitura do `client_secret.json`, login e teste).
- **Terminal central** com o Claude Code e o MCP do Studio (``Ctrl+` ``), e o servidor MCP com ferramentas de construção e acesso às ferramentas externas (Google).
- **Padrão de fábrica** instalado na primeira subida: *Rotina e Estudo*, *Kanban Google*, *Saúde: Hidratação*, *Kanban* e *Google Workspace*. Biblioteca com CRM, ERP leve e Notas.
- **Instaladores:** `pnpm setup`, registro do MCP no Claude Code e `pnpm factory:restore`.
- **Raspberry Pi:** empacotamento compilado (`pnpm pack:pi`), instalador com serviços `systemd` e documentação do que roda em um Pi 2.

### Segurança

- Componentes sem rede, com permissões conferidas a cada chamada e aprovação humana; API e terminal só em `127.0.0.1`; validação das chaves gravadas no `.env`.
