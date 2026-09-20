# Arquitetura

## Visão geral

```
                    ┌──────────────────────────── seu computador (tudo em 127.0.0.1) ────────────────────────────┐
                    │                                                                                             │
 Navegador ─────────┼─▶ App web  :5200  (Next.js 14, React 18)                                                    │
  │   ▲             │      │  fetch + SSE                                                                         │
  │   │ iframes     │      ▼                                                                                      │
  │   │ isolados    │   API  :5100  (NestJS) ──── node:sqlite ──▶ data/agent-canvas.db                            │
  │   │ (componentes)      │  ▲  ▲                                                                              │
  │   │             │      │  │  └── MCP "agent-canvas" (stdio) ◀── Claude Code (terminal do app, ou qualquer)    │
  │   └─ postMessage│      │  │                                                                                   │
  │                 │      │  └───── HTTP ──▶ Groq · Gemini · Anthropic   (agentes de orquestração)              │
  └─ WebSocket ─────┼─▶ Terminal :5300 (node-pty) ──▶ Claude Code / shell                                        │
                    │      │                                                                                      │
                    │      └─ a API também é CLIENTE MCP: conecta em servidores do .mcp.json                     │
                    │         (ex.: Google Workspace via uvx workspace-mcp) e expõe as ferramentas aos agentes   │
                    └─────────────────────────────────────────────────────────────────────────────────────────────┘
```

Quatro processos independentes (`pnpm dev` sobe todos). O estado vive **só no SQLite**; a API é a única a escrever nele. Quem cria ou altera coisas (você na tela, o Claude pelo MCP, um agente de orquestração, um lembrete) passa sempre pelos mesmos *services* do servidor, e é isso que garante validação, permissões e avisos em tempo real iguais para todos.

## Estrutura do repositório

```
apps/web            Next.js 14: Dashboard, Orquestração (React Flow), Biblioteca, Componentes, Dados,
                    Configurações, Terminal e "Criar com Claude"
packages/shared     Tipos compartilhados (canvas, coleções, componentes, páginas, pacotes, ferramentas)
packages/server     API NestJS + node:sqlite (a maior parte da lógica)
packages/mcp        Servidor MCP (stdio) que o Claude Code usa para construir
packages/terminal   Serviço de terminal (node-pty + WebSocket), só loopback, com perfis do Claude Code
scripts             Instaladores, testes, harness de componentes, empacotamento do Pi
docs                Esta documentação
```

### Módulos do servidor (`packages/server/src`)

| Pasta | Responsabilidade |
|---|---|
| `data/` | Coleções e registros: validação, relações, valores automáticos, lote, lixeira |
| `blocks/` | Componentes (código, permissões, aprovação, versões, estado, lint) e o tema |
| `pages/` | Páginas do dashboard (grade de 12 colunas) |
| `packages/` | Pacotes: biblioteca (`library/`), instalação, conexões, padrão de fábrica |
| `canvases/` | Orquestração: catálogo de nós, validação do grafo, motor de execução, interpretador de expressões |
| `llm/` | Provedores de IA por HTTP (Groq, Anthropic, Gemini), laço de ferramentas e o agente `claude -p` |
| `tools/` | Registro único de ferramentas (embutidas, do Studio, do Google e de servidores MCP) e o cliente MCP |
| `integrations/` | Configurações: chaves e modelos, conta Google, tarefas do Google e sincronização |
| `notifications/` | Notificações (banco + SSE + notificação nativa do sistema) |
| `reminders/` | Agendador dos lembretes recorrentes |
| `builder/` | *Criar com Claude*: roda o Claude Code em segundo plano |
| `events/` | Canal de eventos em tempo real (`GET /events`) |
| `clock.ts` | Relógio no fuso local (`GET /clock`) |
| `db.ts` | Esquema do SQLite |

## Modelo de dados

Um único arquivo SQLite (`data/agent-canvas.db`).

| Tabela | Guarda |
|---|---|
| `collections` | Definição das coleções (nome, título, campos em JSON) |
| `records` | Registros das coleções (`data` em JSON, `created_at`/`updated_at` em UTC) |
| `record_trash` | Registros apagados (30 dias, no máximo 500 por coleção) |
| `blocks` | Componentes: html, css, js, permissões, `approved`, `source`, `package_id`, `config` |
| `block_versions` | Histórico de código/permissões (30 por componente) |
| `block_state` | Estado próprio de cada componente (`ctx.store`) |
| `block_inbox` | O que um nó *Componente* de uma orquestração entregou ao componente |
| `dashboard_pages` | Páginas: posição e layout (JSON) |
| `canvases` / `runs` | Orquestrações e o histórico de execuções |
| `installed_packages` / `custom_packages` | Pacotes instalados (com os ids do que criaram) e definições criadas/importadas |
| `notifications` | Últimas 200 notificações |
| `studio_settings` | Tema, notificações, marca do padrão de fábrica, sincronização de tarefas |

## Como uma alteração chega na tela

Quando o Claude (ou qualquer origem) grava algo, a tela atualiza em cerca de 1 segundo, sem recarregar:

```
Claude ── MCP save_record ──▶ API ── DataService.createRecord ──▶ SQLite
                                          │
                                          └─ ChangesService.emit("data", "<coleção>")
                                                   │  (avisos iguais em 80 ms viram um só)
                                                   ▼
                                            GET /events  (SSE)
                                                   ▼
                       apps/web/lib/changes.ts  (uma única conexão EventSource para toda a tela)
                          ├─ usePolled(...)  → recarrega listas (páginas, componentes, coleções, pacotes, canvases, tema)
                          ├─ Dados          → recarrega os registros da coleção aberta
                          └─ BlockFrame     → manda {__ac:1, type:"refresh"} ao iframe dos componentes que leem aquela coleção
```

- **Tipos de evento:** `data` (chave = nome da coleção), `blocks` (chave = id), `pages`, `canvases`, `packages`, `theme`.
- Os *services* emitem no ponto de gravação, por isso vale para qualquer origem, inclusive agentes e lembretes.
- Se a conexão cair e voltar, a tela recarrega tudo (evento sintético `all`).
- O polling periódico continua como **rede de segurança** (8 a 15 s, pausado com a aba oculta).
- As **notificações** têm um canal próprio (`GET /notifications/stream`).

## Como um componente acessa dados

Componentes rodam em `<iframe sandbox="allow-scripts">` (origem opaca, CSP sem rede). Eles não falam com a API: falam com a página pai por `postMessage`.

```
iframe: ctx.records("tarefas").list()
   │  postMessage (chamada "data.list", com os argumentos)
   ▼
BlockFrame (página): confere `permissions.read` do componente  →  fetch para a API
   │                                                            ▲
   └─ postMessage {type:"rpc-result", …} ◀───────────────────────┘
```

A conferência de permissões acontece **a cada chamada**, no lado da página (fora do iframe). Limite de 120 chamadas por 5 s por componente. Detalhes em [COMPONENTES.md](COMPONENTES.md).

## Orquestração (motor de grafo)

Itens (objetos JSON) fluem pelas portas dos nós em ordem topológica, a partir do nó *Pedido*. Cada nó registra entrada, saída e tempo. Na **simulação** os agentes e as escritas são simulados e as leituras rodam; na execução **ao vivo** (com confirmação explícita) tudo acontece de verdade. Expressões e condições usam um interpretador próprio, sem `eval`. Detalhes em [ORQUESTRACAO.md](ORQUESTRACAO.md).

## Ferramentas e servidores MCP

O `ToolRegistry` é o ponto único de ferramentas dos agentes e dos componentes:

1. **embutidas**: `get_time`, `fs_list`, `fs_read`, `fs_write` (os arquivos ficam em `data/files/`);
2. **do Studio**: `notify`, `list_collections`, `list_records`, `save_record`, `save_collection`, `list_blocks`, `get_block`, `save_block`;
3. **do Google (estruturadas)**: `google_tasks_list`, `google_task_set`, `google_task_create`, `google_events_list`, `google_calendars_list`;
4. **de servidores MCP** do `.mcp.json` (`mcp__<servidor>__<ferramenta>`), conectados na subida pelo `McpManager`.

Leituras puras de servidores MCP (nome começando por `list`, `get`, `read`, `search`, `find`, `describe`, `show` ou `count`) rodam até na simulação; as que alteram dados só rodam ao vivo. O `McpManager` filtra os argumentos para os que a ferramenta declara e preenche `user_google_email` sozinho.

## Subida do servidor

Na ordem em que acontece ao iniciar a API:

1. abre o banco e cria/atualiza o esquema;
2. conecta nos servidores MCP do `.mcp.json` (o `agent-canvas` é ignorado: seria recursão);
3. se o banco estiver **vazio** e `AGENT_CANVAS_NO_FACTORY` não for `1`, instala o padrão de fábrica uma vez;
4. garante a coleção `sistema_lembretes` (e os campos novos dela) e inicia o agendador (a cada 15 s);
5. inicia o serviço de sincronização de tarefas (a cada 60 s verifica; só age se você ligou);
6. escuta em `SERVER_HOST:SERVER_PORT`.

## Fuso horário e datas

- Carimbos internos (`createdAt`, `updatedAt`, `deletedAt`) são **UTC** em ISO 8601: ordenáveis e sem ambiguidade.
- O que aparece ao usuário e preenche campos usa o **fuso local da máquina** (`clock.ts`): `date` (AAAA-MM-DD), `time` (HH:MM) e `local` (data e hora com deslocamento, por exemplo `2026-09-20T14:11:37-03:00`).
- Campos com `default` (`today`, `now`, `time`) se preenchem sozinhos ao criar o registro. A janela dos lembretes (`inicio`/`fim`) também usa a hora local.

## Decisões de projeto

| Decisão | Motivo |
|---|---|
| SQLite embutido (`node:sqlite`) | Zero instalação de banco; um arquivo para copiar e fazer backup |
| Componentes em iframe sem rede | Código escrito por IA nunca deve alcançar a rede nem o resto do app; só a ponte com permissões |
| Interpretador de expressões próprio | As definições vêm de agentes e de texto de terceiros: nada de `eval` |
| Aprovação humana de componentes | O Claude constrói, **você** decide o que roda |
| API sem senha, só loopback | Uso pessoal local; senha exigiria um fluxo de login que o uso local não precisa. Acesso remoto: túnel SSH |
| Tudo passa pelos mesmos *services* | Mesma validação e mesmos avisos em tempo real para tela, MCP, agentes e lembretes |
