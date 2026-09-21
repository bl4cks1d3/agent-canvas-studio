# Configuração

A configuração fica em um arquivo `.env` na raiz do projeto (modelo: `.env.example`). Você raramente precisa editá-lo à mão: **chaves de IA, modelos e a conta Google** são cadastrados na aba **Configurações** do app, que grava no `.env` e vale na hora. O `.env` nunca vai para o git.

## Portas

| Serviço | Porta padrão | Escuta em | Observação |
|---|---|---|---|
| API (NestJS) | **5100** | `127.0.0.1` | `SERVER_PORT` e `SERVER_HOST` |
| App web (Next.js) | **5200** | todas as interfaces do computador | fixa nos scripts de `apps/web/package.json` |
| Terminal (node-pty) | **5300** | `127.0.0.1` | `TERMINAL_PORT` |

As portas são incomuns de propósito, para não colidir com outros projetos. A API e o terminal **não têm senha**: por isso escutam só na própria máquina. Veja [SEGURANCA.md](SEGURANCA.md) antes de mudar isso.

## Variáveis de ambiente

### Provedores de IA

| Variável | Padrão | Descrição |
|---|---|---|
| `AI_PROVIDER` | vazio | Provedor que o modo `auto` tenta primeiro: `groq`, `gemini` ou `anthropic`. Vazio = a ordem fixa Groq → Gemini → Anthropic (o primeiro que tiver chave). |
| `GROQ_API_KEY` | — | Chave do Groq. |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Modelo padrão do Groq. |
| `GEMINI_API_KEY` | — | Chave do Google Gemini. |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Modelo padrão do Gemini. |
| `ANTHROPIC_API_KEY` | — | Chave da API da Anthropic. |
| `ANTHROPIC_MODEL` | `claude-sonnet-5` | Modelo padrão da Anthropic. |

O provedor **Claude Code** (`claude-code`) não usa chave: roda `claude -p` com a sua conta do Claude Code. Um agente pode trocar o modelo no próprio nó (campo *Modelo*). Em erro de limite (429), cota ou serviço fora do ar, o modo `auto` passa para o próximo provedor com chave; antes de trocar, o servidor espera o tempo que o provedor pediu (até 25 s, 3 tentativas).

### Servidor e terminal

| Variável | Padrão | Descrição |
|---|---|---|
| `SERVER_PORT` | `5100` | Porta da API. |
| `SERVER_HOST` | `127.0.0.1` | Onde a API escuta. `0.0.0.0` abre para a rede **por sua conta e risco** (não há senha). Para outro computador prefira um túnel SSH. |
| `TERMINAL_PORT` | `5300` | Porta do terminal. |
| `TERMINAL_ALLOWED_ORIGINS` | vazio | Origens extras (separadas por vírgula) que podem abrir o terminal e chamar `/tools` e `/builder`. Só o Studio (`http://localhost:5200` e `http://127.0.0.1:5200`) vem liberado. |
| `TOOLS_ALLOWED_ORIGINS` | vazio | Mesma ideia para `/tools/*` e `/builder/*` da API. |
| `TERMINAL_MAX_SESSIONS` | `8` | Máximo de sessões de terminal abertas. |
| `TERMINAL_IDLE_HOURS` | `12` | Horas até o terminal remover uma sessão desconectada. |
| `CLAUDE_CODE_CWD` | raiz do projeto | Pasta onde os terminais do Claude Code abrem. |
| `TERMINAL_VOICE` | `tap` | Liga o ditado por voz (`/voice`) do Claude Code nos terminais do Studio: `tap` (toque no Espaço para gravar e toque de novo para enviar), `hold` (segure o Espaço) ou `off`. Vale só para os terminais do app (vai por `--settings`, sem mexer no seu `~/.claude/settings.json`) e exige conta claude.ai. Veja [MCP.md](MCP.md#voz). |
| `TERMINAL_VOICE_LANGUAGE` | `pt` | Idioma do ditado **e das respostas** do Claude nesses terminais. Vazio = não define (o ditado cai para inglês). |

### Dados e comportamento

| Variável | Padrão | Descrição |
|---|---|---|
| `DATA_DIR` | `<projeto>/data` | Pasta do banco, arquivos e pasta de trabalho. |
| `AGENT_CANVAS_NO_FACTORY` | vazio | `1` desliga a instalação automática do padrão de fábrica. |
| `AGENT_CANVAS_MCP_CONFIG` | `<projeto>/.mcp.json` | Caminho do arquivo de servidores MCP que o app conecta (Google Workspace, etc.). |
| `AGENT_CANVAS_URL` | `http://localhost:5100` | Endereço da API que o MCP e o instalador usam. |
| `CLAUDE_NODE_ALLOW_BASH` | vazio | `true` deixa o agente **Claude Code** de uma orquestração usar `Bash`. Desligado por padrão; ligue só se entender o risco. |
| `NEXT_PUBLIC_SERVER_URL` | `http://localhost:5100` | URL da API vista pelo navegador. Só mude se não for localhost. |
| `NEXT_PUBLIC_TERMINAL_URL` | `http://localhost:5300` | URL do terminal vista pelo navegador. |
| `NEXT_DIST_DIR` | `.next` | Pasta de saída do Next (usada para gerar o pacote do Pi sem mexer no modo de desenvolvimento). |

### Conta Google

O botão **Conectar conta Google** (Configurações e Biblioteca) preenche estas três linhas:

| Variável | Descrição |
|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | ID do cliente OAuth criado por você no Google Cloud. |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Segredo do cliente OAuth. **Nunca** compartilhe. |
| `USER_GOOGLE_EMAIL` | E-mail da conta. É enviado automaticamente nas chamadas ao Google, então nem você nem o Claude precisam informá-lo. |

## Chaves personalizadas

A tela de Configurações também guarda outras chaves (por exemplo `GITHUB_TOKEN`) para servidores MCP que você conecte. Regras: o **nome** em MAIÚSCULAS, números e `_`, terminando em `KEY`, `TOKEN`, `SECRET` ou `PASSWORD`; o **valor** sem espaços, aspas nem quebras de linha (isso impede injetar outra linha no `.env`). Variáveis que não são de segredo (como `PATH`) nunca podem ser alteradas por essa tela.

## Configurações guardadas no banco

Estas **não** estão no `.env`; ficam na tabela `studio_settings` e mudam pela interface ou pela API:

| Chave | O que guarda | Onde muda |
|---|---|---|
| `theme` | Tema: cor de destaque, cantos, tamanho da fonte, densidade | Componentes → Tema (`GET/PUT /theme`) |
| `notifications` | Som e modo desktop | Configurações → Notificações |
| `factory` | Marca de que o padrão de fábrica já foi instalado | automática |
| `google_tasks_sync` | Sincronização de tarefas com o Google (ligada?, intervalo, último resultado) | MCP `sync_google_tasks` ou `PUT /sync/google-tasks` |
