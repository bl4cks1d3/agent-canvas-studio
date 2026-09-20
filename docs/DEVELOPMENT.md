# Desenvolvimento

## Estrutura

```
apps/web            Next.js 14 (React 18): Dashboard (react-grid-layout), Orquestração (React Flow), Biblioteca, Componentes, Dados, Criar com Claude
packages/shared     tipos compartilhados (canvas, coleções, componentes, páginas, pacotes)
packages/server     NestJS + node:sqlite: canvases (motor de grafo), data, blocks, pages, packages (+ library/), builder, tools (host MCP)
packages/mcp        servidor MCP (stdio) que o Claude Code usa para construir (canvas + Studio)
packages/terminal   terminal (node-pty + WebSocket, só loopback) com perfis do Claude Code
scripts             testes de API, harness de componentes, instalador do MCP
```

## Comandos

```bash
pnpm dev              # tudo (compila shared e mcp antes)
pnpm typecheck        # todos os pacotes
pnpm test             # test-api (usa IA de verdade, poucos tokens) + test-studio
pnpm test:studio      # só o Studio (colecoes, componentes, versoes, tema, paginas, pacotes)
pnpm build:mcp        # precisa ter rodado para "Criar com Claude" e para o MCP
pnpm mcp:install      # registra o MCP agent-canvas no Claude Code
```

Dados: `data/agent-canvas.db` (SQLite; muda com `DATA_DIR`). `.env`: chaves de IA e portas (`.env.example`).

## Escrevendo um pacote da biblioteca

Copie `packages/server/src/packages/library/kanban/` (manifesto + `quadro.html/css/js`). O servidor relê a pasta a cada 2 s: instale pela aba Biblioteca (ou `POST /packages/<id>/install`) e itere. Regras (o lint confere): só classes `ac-*` e variáveis `--ac-*`, sem cor fixa, permissões exatas, dados em coleções, estado de tela em `ctx.store`. Depois de instalar, `GET /blocks/<id>/lint` deve devolver `{"warnings":[]}`.

## Testando um componente no navegador

O componente real roda num iframe de origem opaca (não dá para inspecionar o DOM dele). O **harness** gera uma página de teste com o mesmo runtime num iframe *same-origin* e a ponte falando com o servidor de verdade:

```bash
cd packages/server
./node_modules/.bin/ts-node --transpile-only --compiler-options '{"module":"commonjs","target":"es2022","moduleResolution":"node"}' ../../scripts/block-harness.ts "Quadro Kanban" _harness.html
# abra http://localhost:5200/_harness.html ; no console: document.getElementById('f').contentDocument
# window.__logs / __toasts / __rpc ; window.__answers.push(valor) responde o próximo ctx.ui.modal (senão abre o modal de verdade em iframe.modal)
```

Apague `apps/web/public/_harness*.html` depois (estão no `.gitignore`).

## Motor de grafo (orquestração)

Itens (objetos JSON; texto de agente em `text`) fluem por portas (`main`, `true`/`false`) em ordem topológica a partir do nó Pedido; cada nó registra entrada/saída/tempo. **Simulação (dry)**: agentes e escritas são simulados, leituras rodam. Templates e condições usam um interpretador seguro (`expr.ts`, sem `eval`). Agentes `agent.llm` fazem o laço de ferramentas por HTTP puro (Groq, Anthropic, Gemini) e só usam as ferramentas marcadas no nó; `agent.claude` executa `claude -p` com uma lista segura de ferramentas.
