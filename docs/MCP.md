# MCP e Claude Code

O Studio expõe um **servidor MCP** (`agent-canvas`, em `packages/mcp`) para que o **Claude Code** construa e opere tudo em português: coleções, componentes, páginas, pacotes, tema e orquestrações. Ele é só um *cliente HTTP* da API (`AGENT_CANVAS_URL`, padrão `http://localhost:5100`): tudo o que o Claude faz passa pelos mesmos *services*, com a mesma validação, e a tela atualiza sozinha.

## Duas formas de usar o Claude

1. **Terminal do app** (aba *Terminal*, ou ``Ctrl+` ``). Já vem com o MCP do Studio, um prompt de sistema e uma lista de ferramentas liberadas. Perfis:

   | Perfil | O que abre |
   |---|---|
   | **Claude — controlar o Studio** | Claude Code com o MCP `agent-canvas` e o modo Studio: constrói dados, componentes, páginas, pacotes e tema |
   | **Claude — montar canvases** | Claude Code orientado a montar orquestrações de agentes |
   | **Claude Code** | Claude Code puro, na pasta do projeto |
   | **Shell** | PowerShell (Windows) ou o shell do sistema |

2. **Qualquer Claude Code**: `pnpm install:claude` registra o MCP para valer em qualquer pasta ([INSTALACAO.md](INSTALACAO.md#registrar-ou-conferir-as-ferramentas-no-claude-code)). Abrindo o Claude Code **na pasta do projeto**, o `.mcp.json` já o registra.

Também há o botão **Criar com Claude** (o *construtor*): roda o Claude Code em segundo plano, com **só** as ferramentas do Agent Canvas (sem Bash, arquivos ou web), `--permission-mode dontAsk` e limite de 12 minutos; o progresso aparece na tela e ao final você aprova os componentes.

### O terminal por dentro

O serviço de terminal (`packages/terminal`, porta 5300) usa `node-pty`. As sessões **vivem no servidor**: recarregar a página só desconecta o WebSocket; o processo continua e o histórico recente (256 KB) é reanexado. Até 8 sessões (`TERMINAL_MAX_SESSIONS`); sessões desconectadas são removidas após 12 h (`TERMINAL_IDLE_HOURS`) e as encerradas após 1 h. Só aceita conexões de `127.0.0.1` com `Origin` e `Host` conhecidos ([SEGURANCA.md](SEGURANCA.md)). O navegador só escolhe o **nome** do perfil; o comando, os argumentos e a pasta saem do servidor: nenhum texto do navegador vira comando.

## Regras que o Claude segue no modo Studio

- Componentes que ele cria **ficam aguardando a sua aprovação**; ele nunca aprova.
- `run_canvas` **só simula**; execução ao vivo é sua.
- **Não apaga nada** sem você pedir. Apagar registros vai para a lixeira (dá para desfazer).
- Para o Google, só altera dados (concluir, criar, enviar) quando você pede.
- Nunca lê, edita nem mostra o `.env`, chaves ou tokens: as chaves são cadastradas por você na tela **Configurações**.
- A hora vem da ferramenta `now` (fuso local), não de suposição.

Ferramentas **liberadas sem perguntar** no terminal do Studio: leitura, criação e edição (`now`, `list_*`, `get_*`, `save_*`, `restore_record`, `install_package`, `google_tasks`, `google_events`, `google_calendars`, `list_external_tools`, `describe_external_tool`…). O Claude Code **pergunta** antes de: `delete_*`, `uninstall_package`, `run_canvas`, `read_external_tool`, `call_external_tool`, `google_task_set` e `sync_google_tasks`.

## Ferramentas

### Guias

| Ferramenta | O que faz |
|---|---|
| `studio_guide` | Guia do Studio: componentes, dados, design system, páginas. **O Claude lê antes de criar** |
| `canvas_guide` | Guia das orquestrações: nós, expressões, padrões de times de agentes |
| `canvas_nodes` | Tipos de nó (campos, portas, exemplo), ferramentas disponíveis, provedores de IA e se o Claude Code está instalado |

### Dados

| Ferramenta | O que faz |
|---|---|
| `list_collections` | Coleções: nome, campos (`nome:tipo`, `*` obrigatório, `->outra` relação, `=today` valor automático) e nº de registros |
| `save_collection` | Cria a coleção ou atualiza título/campos. Tipos: `text`, `longtext`, `number`, `date`, `boolean`, `select`, `relation`; opções `required`, `options`, `collection`, `default` |
| `list_records` | Lista registros. Filtros: `q`, `where` (igualdade por campo), `sort`, `order`, `limit` |
| `save_record` | Cria (sem `recordId`) ou atualiza (com `recordId`; `null` limpa um campo) |
| `save_records` | **Vários** de uma vez, **tudo ou nada**: `create`, `update: [{id, data}]`, `delete: [ids]` (até 200) |
| `delete_record` | Apaga (vai para a lixeira) |
| `list_trash` | Registros apagados de uma coleção (30 dias) |
| `restore_record` | Desfaz a exclusão |
| `now` | Data e hora no fuso local: `local`, `date`, `time`, `weekday`, `timezone`, `text` |

### Componentes, páginas e tema

| Ferramenta | O que faz |
|---|---|
| `list_blocks` / `get_block` | Lista componentes; lê código e permissões |
| `save_block` | Cria ou atualiza (envie só o que muda). Devolve os **avisos do lint** para corrigir. Fica aguardando aprovação |
| `delete_block` | Apaga o componente e o histórico dele |
| `block_versions` | Histórico de versões do código |
| `list_pages` | Páginas e o layout (grade de 12 colunas) |
| `save_page` | Cria ou substitui uma página (`layout` com `heading` e `block`) |
| `place_block` | Acrescenta um componente no fim de uma página (padrão 6×9) |
| `delete_page` | Apaga a página (os componentes continuam) |
| `get_theme` / `set_theme` | Lê ou altera o tema (`accent`, `radius` 0–24, `fontSize` 11–18, `density`) |

### Pacotes

| Ferramenta | O que faz |
|---|---|
| `list_packages` | Pacotes (instalados ou não), conexões que pedem e um **exemplo** de manifesto |
| `save_package` | Salva um pacote na Biblioteca (não instala) |
| `install_package` | Instala: cria coleções, componentes, páginas e orquestrações |
| `uninstall_package` | Desinstala (`dropData=true` apaga também os dados) |

### Orquestração

| Ferramenta | O que faz |
|---|---|
| `list_canvases` / `get_canvas` | Lista e lê orquestrações (com os problemas) |
| `save_canvas` | Cria ou substitui (`nodes`, `edges`); erros de validação voltam para corrigir |
| `run_canvas` | **Simula** e devolve, por nó, o que entrou e saiu |
| `canvas_runs` | Últimas execuções com o resultado por nó |
| `delete_canvas` | Apaga a orquestração e o histórico |

### Google (dados estruturados)

| Ferramenta | O que faz |
|---|---|
| `google_tasks` | Tarefas como JSON (`showCompleted`) |
| `google_task_set` | Conclui/reabre uma ou várias (`ids`) |
| `google_events` | Eventos da Agenda como JSON (`calendar`, `days`, `from`, `to`) |
| `google_calendars` | Agendas como JSON |
| `sync_google_tasks` | Sincroniza `rotina_tarefas` com o Google Tasks; com `enabled`/`everyMinutes` liga ou desliga a automática; `statusOnly` mostra o estado |

Detalhes e regras em [GOOGLE.md](GOOGLE.md).

### Ferramentas externas (qualquer servidor MCP conectado ao app)

O Claude do terminal só enxerga o MCP do Studio; estas ferramentas dão a ele acesso ao que o **app** já tem conectado, pela mesma camada dos agentes (conta Google já preenchida, argumentos conferidos). Só entram ferramentas `mcp__*`.

| Ferramenta | O que faz |
|---|---|
| `list_external_tools` | Lista as ferramentas (com `filter` opcional), dizendo se **só leem** ou **alteram** dados |
| `describe_external_tool` | Esquema JSON completo de uma ferramenta |
| `read_external_tool` | Chama uma ferramenta **só de leitura**; recusa as que alteram |
| `call_external_tool` | Chama **qualquer** uma, inclusive as que alteram dados (você confirma cada uso) |

Exemplo (concluir uma tarefa direto no servidor do Google): `mcp__google-workspace__manage_task` com `{action: "update", task_list_id: "@default", task_id, status: "completed"}`. A conta Google já está preenchida: **não** informe `user_google_email`.

## Prompts e recursos

| Tipo | Nome | Para quê |
|---|---|---|
| Prompt | `construir-dashboard` (`/mcp__agent-canvas__construir-dashboard`) | Constrói um dashboard a partir de um pedido |
| Prompt | `construir-canvas` | Monta uma orquestração de agentes a partir de um pedido |
| Recurso | `studio://guia` | Guia do Studio (markdown) |
| Recurso | `canvas://guia` | Guia das orquestrações (markdown) |

## Como o app usa outros servidores MCP

A **API** também é cliente MCP: na subida lê o `.mcp.json` (ou o caminho de `AGENT_CANVAS_MCP_CONFIG`) e conecta em cada servidor (menos o `agent-canvas`, que seria recursão). As ferramentas viram `mcp__<servidor>__<ferramenta>`, ficam disponíveis para agentes, componentes (em `permissions.tools`) e para o Claude (`list_external_tools`). Depois de editar o `.mcp.json` use **Biblioteca → Reconectar ferramentas** (ou `POST /tools/reload`).
