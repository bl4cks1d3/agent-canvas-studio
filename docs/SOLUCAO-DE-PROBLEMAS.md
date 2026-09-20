# Solução de problemas

Comece por aqui: **a API está no ar?**

```bash
curl http://localhost:5100/health      # deve responder 200
```

Se não responde, o app mostra *“O servidor não responde”* na barra lateral. Suba com `pnpm dev` (ou `pnpm dev:server`) e olhe a mensagem de erro no terminal onde ele roda.

## Instalação e inicialização

| Sintoma | Causa e solução |
|---|---|
| `Node … é antigo demais` / erro com `node:sqlite` | O Studio exige **Node 22.5 ou mais novo**. Atualize em nodejs.org |
| `pnpm: comando não encontrado` | `corepack enable` (vem com o Node) ou `npm install -g pnpm` |
| Porta em uso (`EADDRINUSE` em 5100, 5200 ou 5300) | Há outra instância rodando (por exemplo, um `pnpm dev` em outro terminal). Feche-a. Para a API e o terminal dá para trocar a porta (`SERVER_PORT`, `TERMINAL_PORT` no `.env`); a do app web (5200) é fixa nos scripts |
| A API cai logo ao subir com `Nest can't resolve dependencies…` | Um módulo novo sem a dependência declarada. Ao mexer no código do servidor, o `pnpm typecheck` **não** pega isso: suba o servidor e leia o log |
| Depois de `pnpm build` o modo `pnpm dev` quebra (página em branco, erros de *chunk*) | O `next build` reescreve a pasta `.next` que o `next dev` usa. Pare o `pnpm dev`, apague `apps/web/.next` e suba de novo. Para gerar builds sem mexer no dev use `NEXT_DIST_DIR=.next-outro` |
| O terminal do app mostra *“serviço de terminal não responde”* | O processo do terminal (porta 5300) não subiu. Rode `pnpm dev:terminal` e leia o erro. Em ARM de 32 bits o `node-pty` não existe ([RASPBERRY-PI.md](RASPBERRY-PI.md)) |
| Nada aparece no Dashboard de uma instalação nova | O padrão de fábrica só instala com o banco **vazio**. Rode `pnpm factory:restore` (não apaga nada) |
| Depois de `git pull` as ferramentas do Claude não mudaram | O MCP roda de `packages/mcp/dist`: rode `pnpm build:mcp` e reinicie a sessão do Claude Code |

## Claude Code e MCP

| Sintoma | Causa e solução |
|---|---|
| *Criar com Claude* diz que o Claude Code não está instalado | Instale o Claude Code e abra um terminal novo; o status aparece em *Configurações* e no rodapé da barra lateral |
| O Claude não enxerga as ferramentas `agent-canvas` | `node scripts/install-mcp.mjs --check`; depois `pnpm install:claude`; abra uma nova sessão do Claude Code. Abrindo-o na pasta do projeto, o `.mcp.json` já registra o MCP |
| As ferramentas dizem *“O servidor do Agent Canvas não responde em …”* | A API não está no ar (`pnpm dev`) ou `AGENT_CANVAS_URL` aponta para o lugar errado |
| No Windows, comandos com `/mcp` digitados no Git Bash viram caminhos estranhos | O MSYS converte `/…` em caminho do Windows. Use `MSYS_NO_PATHCONV=1` ou o PowerShell |
| O Claude do terminal pergunta a cada uso de uma ferramenta | É esperado para as que apagam, desinstalam, simulam ou alteram a sua conta Google ([MCP.md](MCP.md#regras-que-o-claude-segue-no-modo-studio)) |

## IA e orquestração

| Sintoma | Causa e solução |
|---|---|
| *“Nenhuma chave de IA”* | Cadastre uma chave em **Configurações → Provedores de IA** |
| Erro **429 / limite de taxa** (Groq, por exemplo) | Cota gratuita esgotada. O modo `auto` tenta o próximo provedor com chave; cadastre mais de um. Também é possível trocar o modelo do nó |
| O agente diz que precisa de login do Google / pede o e-mail | Ele está usando o Claude Code sem as ferramentas do Google liberadas, ou a conta Google não está autorizada. Reconecte em **Configurações → Conta Google** e marque as ferramentas no nó |
| *“Corrija antes de executar”* | O canvas tem problemas de validação (ciclo, ferramenta inexistente, agente sem instruções, sem nó *Pedido*). A lista aparece na resposta e no editor |
| *“execução real exige confirmação”* | Executar ao vivo pede confirmação explícita; use **Simular** para testar |
| *“muitas execuções ao mesmo tempo”* / *“já está executando”* | No máximo 3 execuções simultâneas e uma por canvas |
| Um nó `agent.claude` recusa `Bash` | `Bash` só com `CLAUDE_NODE_ALLOW_BASH=true` no `.env` |

## Componentes

| Sintoma | Causa e solução |
|---|---|
| *“Aguardando aprovação”* | Normal para componentes criados pelo Claude. Revise as permissões e aprove (Dashboard ou Componentes). Editar o código revoga a aprovação |
| O componente mostra um erro em vermelho | Abra **Componentes → código** e veja os avisos do lint; o erro costuma ser permissão faltando (`col:…` em `read`/`write`, ferramenta em `tools`) |
| *“muitas chamadas seguidas”* | Passou de 120 chamadas em 5 s (laço no código). Agrupe as leituras ou use `save_records` para gravações em lote |
| O componente não atualiza sozinho | Só atualiza quando muda uma coleção listada em `permissions.read`; dados que vêm de fora (Google) dependem de `refreshSeconds` (5 a 3600) |
| `409` ao salvar | Alguém (o Claude, outra aba) alterou o item depois que você o abriu. Recarregue e refaça a edição |
| `400 … permissão para coleção inexistente` | Corrija o nome em `permissions` ou crie a coleção antes |

## Dados

| Sintoma | Causa e solução |
|---|---|
| `nao existe registro com id "…" em <coleção>` | Campo de **relação** com id inexistente. Use o id de `list_records <coleção>` (na tela, escolha na lista) |
| `campo obrigatorio: …` | Faltou um campo `required` (campos com `default` se preenchem sozinhos e não precisam ser enviados) |
| `campo desconhecido em <coleção>: …` | O campo não existe no esquema. Acrescente-o com `save_collection` ou `PATCH /collections/:nome` |
| Apaguei um registro sem querer | **Dados → coleção → Lixeira → restaurar** (30 dias) ou `restore_record` |
| Lote falhou e “não gravou nada” | É o comportamento: o lote é **tudo ou nada**. A mensagem diz qual item falhou; corrija e envie de novo |
| Hora errada em registros | `createdAt`/`updatedAt` são **UTC** de propósito. Campos preenchidos automaticamente (`default`) usam o fuso local; o fuso vem do sistema operacional |

## Google

Veja a tabela em [GOOGLE.md](GOOGLE.md#problemas-comuns). Resumo: instale o `uv`, ative as três APIs no Google Cloud, adicione seu e-mail como usuário de teste, **autorize** e **teste** a conexão.

| Sintoma | Causa e solução |
|---|---|
| A sincronização diz *“a colecao rotina_tarefas nao existe”* | Instale o pacote **Rotina e Estudo** (`pnpm factory:restore`) |
| Tarefas duplicadas depois de sincronizar | A vinculação é por **título idêntico** (ignorando acento e caixa) entre tarefas **abertas**. Títulos diferentes (“Tirar louça” × “Tirar a louça”) não se vinculam. Renomeie um dos lados antes da primeira sincronização |
| A sincronização automática não roda | Vem **desligada**. Ligue com `sync_google_tasks` (`enabled: true`) e confira `GET /sync/google-tasks` (`lastResult`) |

## Notificações

| Sintoma | Causa e solução |
|---|---|
| Não chega notificação com a aba em segundo plano | Permita as notificações do navegador quando ele pedir, ou ligue o **modo desktop** em Configurações |
| O lembrete de água não dispara | Confira: `ativo`, janela `inicio`–`fim` (hora local), intervalo e — se houver `depois_de` — se você registrou algo há pouco (o intervalo conta do último registro). O servidor precisa estar rodando |
| Modo desktop sem som | No Linux usa `notify-send` (sem som do sistema). O som do Studio só toca no navegador |

## Avançado

- **Ver o que o servidor está fazendo:** o terminal onde roda `pnpm dev` mostra o log (`[McpManager]`, `[Nest]`, lembretes, fábrica).
- **Conferir o estado da API:** `curl localhost:5100/collections`, `curl localhost:5100/tools`, `curl localhost:5100/factory`, `curl localhost:5100/sync/google-tasks`.
- **Acompanhar os eventos em tempo real:** `curl -N localhost:5100/events`.
- **Rodar os testes** (com a API no ar): `pnpm test`. Eles usam a **sua** API: criam dados com o prefixo `zz` (e uma chave temporária `ZZ_TEST_TOKEN` no `.env`) e limpam tudo no fim. O `test-api` também faz chamadas reais de IA (poucos tokens) se houver chave.
- **Banco corrompido ou dados estranhos:** pare o servidor, copie `data/agent-canvas.db` como backup e abra com qualquer cliente SQLite. Para recomeçar do zero, mova `data/` para outro lugar (o padrão de fábrica volta na próxima subida).
