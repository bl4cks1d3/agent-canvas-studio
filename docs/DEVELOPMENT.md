# Desenvolvimento

## Estrutura

```
apps/web            Next.js 14 (React 18): Dashboard (react-grid-layout), Orquestração (React Flow), Biblioteca,
                    Componentes, Dados, Configurações, Terminal e Criar com Claude
packages/shared     Tipos compartilhados (canvas, coleções, componentes, páginas, pacotes)
packages/server     NestJS + node:sqlite: canvases (motor de grafo), data, blocks, pages, packages (+ library/),
                    builder, tools (host MCP), integrations, notifications, reminders, events
packages/mcp        Servidor MCP (stdio) que o Claude Code usa para construir (canvas + Studio)
packages/terminal   Terminal (node-pty + WebSocket, só loopback) com perfis do Claude Code
scripts             Testes de API, harness de componentes, instaladores, empacotamento do Pi
docs                Documentação
```

A visão de como as peças se falam está em [ARQUITETURA.md](ARQUITETURA.md).

## Ambiente

- Node ≥ 22.5, pnpm 10. `pnpm install` na raiz.
- `pnpm dev` compila `shared` e `mcp` e sobe API (ts-node-dev, recarrega ao editar), app web (Next em modo dev) e terminal (tsx watch).
- **`packages/shared` precisa estar compilado** para os outros pacotes (o `pnpm dev` mantém `tsc --watch`). Depois de mudar um tipo em `shared`, rode `pnpm --filter @agent-canvas/shared build` se não estiver com o `pnpm dev` ligado.
- O **MCP roda de `packages/mcp/dist`**: depois de editar `packages/mcp/src`, rode `pnpm build:mcp` e reinicie a sessão do Claude Code.
- Fins de linha: o repositório usa LF nos scripts de Linux (`.gitattributes`: `*.sh` e `*.tmpl`); no Windows o Git avisa sobre CRLF nos demais arquivos, o que é normal.

## Comandos

```bash
pnpm dev              # tudo (compila shared e mcp antes)
pnpm typecheck        # todos os pacotes
pnpm build            # compila todos os pacotes (com o dev PARADO: o next build reescreve .next)
pnpm build:mcp        # shared + mcp
pnpm test             # test-api + test-studio + test-google-sync (API no ar)
pnpm test:api         # orquestração: catálogo, validação, ferramentas, execução (usa IA de verdade, poucos tokens)
pnpm test:studio      # coleções, componentes, versões, tema, páginas, pacotes, eventos, lote, lixeira, lembretes…
pnpm test:google      # analisadores do Google e planejador de sincronização (offline, sem servidor)
pnpm test:factory     # instalação NOVA em servidor isolado (porta 5197, banco temporário)
pnpm install:claude   # registra o MCP agent-canvas no Claude Code
pnpm factory:restore  # reinstala o padrão de fábrica que faltar
pnpm export:package <id>   # pacote criado pelo Claude → biblioteca do repositório
pnpm pack:pi          # pacote compilado para o Raspberry Pi
```

## Testes

| Script | O que cobre | Precisa de |
|---|---|---|
| `scripts/test-api.mjs` | Catálogo, validação de canvases (agente estrito, editor tolerante), ferramentas puras, laço de ferramentas, Claude Code, notificações | API no ar em `SERVER_URL` (padrão `:5100`); usa IA real se houver chave |
| `scripts/test-studio.mjs` | Coleções e registros, **relações**, **valores automáticos**, **lote atômico**, **lixeira**, **relógio**, componentes (aprovação, versões, estado, lint), tema, páginas, pacotes, notificações, chaves, **eventos SSE**, **lembrete com `depois_de`** | API no ar |
| `scripts/test-google-sync.mjs` | Leitura do texto do Google (tarefas, eventos, agendas) e o **planejador** da sincronização de tarefas (vinculação por título, quem mudou, sem duplicar) | Node ≥ 22.18 ou ≥ 23.6 (executam os `.ts` direto, sem flag); **não** precisa de servidor nem de conta Google |
| `scripts/test-factory.mjs` | Instalação nova com banco temporário: pacotes de fábrica instalados e aprovados, sem avisos de lint, segunda subida não duplica | Nada em execução (sobe o próprio servidor) |

Os testes que usam a sua API criam dados com o prefixo **`zz`** (e uma chave temporária `ZZ_TEST_TOKEN` no `.env`) e **limpam** no fim. O de lembretes espera até ~24 s pelo agendador (que roda a cada 15 s) e apaga a notificação que gera.

Convenção dos scripts: `check("nome", condição, detalhe)` imprime `PASS`/`FAIL`, e o processo termina com código 1 se algo falhou. Ao acrescentar um recurso, acrescente aqui uma seção no `test-studio` (via HTTP) ou, se a lógica for pura, teste-a como em `test-google-sync` (funções sem dependências, importadas direto do `.ts`).

## Escrevendo um pacote da biblioteca

Copie `packages/server/src/packages/library/kanban/` (manifesto + `quadro.html/css/js`). O servidor relê a pasta a cada 2 s: instale pela aba Biblioteca (ou `POST /packages/<id>/install`) e itere. Regras (o lint confere): só classes `ac-*` e variáveis `--ac-*`, sem cor fixa, permissões exatas, dados em coleções, estado de tela em `ctx.store`. Depois de instalar, `GET /blocks/<id>/lint` deve devolver `{"warnings":[]}`. Formato do manifesto em [BIBLIOTECA.md](BIBLIOTECA.md#formato-do-manifesto).

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

Itens (objetos JSON; texto de agente em `text`) fluem por portas (`main`, `true`/`false`) em ordem topológica a partir do nó Pedido; cada nó registra entrada/saída/tempo. **Simulação (dry)**: agentes e escritas são simulados, leituras rodam. Templates e condições usam um interpretador seguro (`expr.ts`, sem `eval`). Agentes `agent.llm` fazem o laço de ferramentas por HTTP puro (Groq, Anthropic, Gemini) e só usam as ferramentas marcadas no nó; `agent.claude` executa `claude -p` com uma lista segura de ferramentas. Para criar um **tipo de nó novo**: acrescente em `canvases/node-specs.ts` (catálogo, lido pelo editor, pela validação e pelo MCP), valide em `graph.ts` e execute em `engine.ts`.

## Receitas para contribuir

### Novo recurso no servidor

1. Lógica no *service* do módulo (é o que garante que tela, MCP, agentes e lembretes se comportem igual).
2. **Avise a tela**: injete `ChangesService` e chame `this.changes.emit("<tipo>", chave?)` no ponto de gravação (`events/changes.service.ts`). Sem isso a tela só verá a mudança no polling de reserva.
3. Exponha na API (controller) e, se o Claude precisar, no MCP (`packages/mcp/src/index.ts`, mais o `studio-guide.ts` e a lista `STUDIO_ALLOWED` em `packages/terminal/src/profiles.ts` se for seguro liberar sem perguntar).
4. Rotas sensíveis (chaves, alterar contas, executar coisas): use `assertLocal` (`tools/tools.controller.ts`).
5. Teste, documente ([API.md](API.md), [STUDIO.md](STUDIO.md)) e rode `pnpm typecheck` **e suba o servidor** (a injeção de dependências do Nest só falha em tempo de execução: um módulo novo precisa importar os módulos dos *services* que injeta).

### Novo tipo de campo

`packages/shared/src/index.ts` (tipo), `data/data.service.ts` (lista `TYPES`, validação em `fields()` e coerção em `coerce()`), `apps/web/components/DataView.tsx` (formulário e `parseFields`), guias (`studio-guide.ts`, `STUDIO.md`).

### Nova ferramenta de agente

Embutida em `tools/builtin.ts`; do Studio em `tools/tool-registry.ts`; do Google (estruturada) em `tools/google-tools.ts` com o analisador em `integrations/google-parse.ts`. Descreva bem (`description` e `parameters`): é o que o modelo lê.

### Mudando um pacote de fábrica

Edite o manifesto e os arquivos em `library/<id>/` e **aumente a versão**. Lembre que quem já instalou não recebe a mudança sozinho ([BIBLIOTECA.md](BIBLIOTECA.md#padrão-de-fábrica)); para o seu banco use `PATCH /collections/:nome` (só esquema) ou reinstale o pacote. `pnpm test:factory` deve continuar passando.

### Estilo

- TypeScript estrito, comentários em português explicando o **porquê**.
- Nomes de campos, coleções e rotas em minúsculas com `_` (dados) ou kebab (rotas), como no código existente.
- Sem dependências novas sem necessidade; o servidor usa só `node:sqlite`, NestJS e o SDK MCP.

## Raspberry Pi

`pnpm pack:pi` (gera `dist-pi/agent-canvas-pi.tar.gz` com o app já compilado, sem mexer no seu `.next` de desenvolvimento) e `scripts/pi/install-on-pi.sh`. Veja [RASPBERRY-PI.md](RASPBERRY-PI.md).
