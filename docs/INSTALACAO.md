# Instalação

## Requisitos

| Item | Versão | Para quê |
|---|---|---|
| **Node.js** | 22.5 ou mais novo | O servidor usa o SQLite embutido (`node:sqlite`). Versões anteriores não funcionam. |
| **pnpm** | 10 | Gerenciador do monorepo. Se faltar, o instalador o ativa pelo `corepack` (vem com o Node). |
| **Claude Code** | qualquer recente | Opcional. Necessário para o terminal do app, o *Criar com Claude* e o agente do tipo *Claude Code*. |
| **uv** (`uvx`) | qualquer | Opcional. Só para a conta Google (roda o servidor MCP `workspace-mcp`). |
| Chave de IA | Groq, Gemini ou Anthropic | Opcional. Sem chave tudo funciona, menos os agentes de orquestração. |

Sistemas: Windows, macOS e Linux em **x64 ou ARM64**. Em ARM de 32 bits (Raspberry Pi 2) o servidor e o app rodam, mas o terminal embutido e o Claude Code não; veja [RASPBERRY-PI.md](RASPBERRY-PI.md).

## Instalação em um comando

```bash
git clone https://github.com/bl4cks1d3/agent-canvas-studio.git
cd agent-canvas-studio
pnpm setup
```

`pnpm setup` (`node scripts/install.mjs`) faz, nesta ordem:

1. confere os pré-requisitos (Node ≥ 22.5, pnpm; avisa se o sistema é de 32 bits);
2. `pnpm install`;
3. compila `packages/shared` e o servidor MCP (`packages/mcp`);
4. cria o `.env` a partir do `.env.example` (se ainda não existir; nunca sobrescreve);
5. registra o MCP `agent-canvas` no Claude Code, para valer em qualquer pasta. Se o Claude Code não estiver instalado, nada quebra: ao abrir o Claude Code **nesta pasta**, o `.mcp.json` já registra as ferramentas.

Opções: `--no-claude` (não mexe no Claude Code), `--skip-install` (pula o `pnpm install`), `--url http://localhost:5100` (Claude Code apontando para um Studio em outra máquina, via túnel SSH).

## Primeira execução

```bash
pnpm dev
```

Sobe quatro processos: `shared` (compilação contínua), **API** em `http://localhost:5100`, **app web** em `http://localhost:5200` e **terminal** em `http://localhost:5300`. Abra <http://localhost:5200>.

Numa instalação nova (banco vazio) o servidor instala sozinho o **padrão de fábrica**: os pacotes *Rotina e Estudo*, *Kanban Google*, *Saúde: Hidratação*, *Kanban* e *Google Workspace*, com os componentes já aprovados e a primeira página (Rotina) como inicial. Isso acontece uma única vez; um banco que já tem dados nunca é tocado sozinho.

### Configurando IA e Google (na tela, sem editar arquivos)

Abra **Configurações** (barra lateral):

- **Provedores de IA**: cole a chave de Groq, Gemini e/ou Anthropic, escolha o modelo e teste. A chave é gravada no `.env` e vale na hora; a tela nunca a mostra de volta.
- **Conta Google**: siga o passo a passo em [GOOGLE.md](GOOGLE.md).
- **Notificações**: som e modo *desktop* (notificação nativa do sistema).

## Registrar (ou conferir) as ferramentas no Claude Code

```bash
pnpm install:claude                    # registra o MCP agent-canvas (escopo user)
node scripts/install-mcp.mjs --check   # só mostra o estado
node scripts/install-mcp.mjs --remove  # remove
node scripts/install-mcp.mjs --scope local              # só para este projeto
node scripts/install-mcp.mjs --url http://localhost:5100 # Studio em outra máquina (túnel SSH)
```

## Comandos úteis

| Comando | O que faz |
|---|---|
| `pnpm dev` | Sobe tudo em modo desenvolvimento (recarrega ao editar) |
| `pnpm build` | Compila todos os pacotes |
| `pnpm typecheck` | Confere os tipos de todos os pacotes |
| `pnpm test` | Testes de API, Studio e Google (o servidor precisa estar no ar) |
| `pnpm factory:restore` | Reinstala o padrão de fábrica que faltar (não apaga nada) |
| `pnpm export:package <id>` | Grava um pacote criado pelo Claude na biblioteca do repositório |
| `pnpm pack:pi` | Gera o pacote compilado para o Raspberry Pi |

## Onde ficam seus dados

Tudo o que é seu está em `data/` (ignorada pelo git):

```
data/agent-canvas.db     o banco SQLite: coleções, registros, componentes, páginas, canvases, notificações…
data/files/              arquivos criados pelos agentes (ferramentas fs_*)
data/work/               pasta de trabalho do agente Claude Code
data/studio-mcp.json     configuração do MCP usada pelo terminal do Studio (sem segredos)
.env                     chaves e portas (nunca vai para o git)
.mcp.json                servidores MCP conectados (Google Workspace, se você conectou)
```

Para mudar a pasta de dados use `DATA_DIR` ([CONFIGURACAO.md](CONFIGURACAO.md)).

### Backup

Pare o servidor e copie `data/agent-canvas.db` (e `.env`, se quiser guardar as chaves). Para restaurar, coloque o arquivo de volta no lugar. Com o servidor rodando, prefira copiar depois de pará-lo, para não pegar o banco no meio de uma gravação.

## Atualizando

```bash
git pull
pnpm install
pnpm build:mcp        # o MCP roda a partir de packages/mcp/dist
pnpm dev
```

Seus dados e o `.env` são preservados. Pacotes da biblioteca que mudaram no repositório **não reinstalam sozinhos** no que você já instalou: o que já existe no banco continua como está. Para reaplicar o padrão de fábrica que faltar use `pnpm factory:restore` (não altera nada já instalado).

## Desinstalando

1. Remova o registro do Claude Code: `node scripts/install-mcp.mjs --remove`.
2. Apague a pasta do projeto (isso inclui `data/` e o `.env`; faça backup antes se precisar).

## Rodando em produção (sem `pnpm dev`)

O uso normal é local, com `pnpm dev`. Para um processo mais enxuto: `pnpm build` (com o `pnpm dev` **parado**: o `next build` reescreve a pasta `.next` que o modo de desenvolvimento usa), depois `pnpm --filter @agent-canvas/server start` (API), `pnpm --filter @agent-canvas/web start` (app web, porta 5200) e `pnpm --filter @agent-canvas/terminal start` (terminal). O empacotamento completo para outra máquina (com serviços `systemd`) está em [RASPBERRY-PI.md](RASPBERRY-PI.md).
