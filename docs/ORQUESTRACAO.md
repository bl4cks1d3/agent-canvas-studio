# Orquestração (canvas de agentes)

A aba **Orquestração** é um editor visual (React Flow, estilo n8n) onde você liga **nós** por **fios**: um pedido entra, passa por agentes de IA, ferramentas, leitura e gravação de dados, condições e notificações, e sai como resultado (ou aparece num componente). É a forma de fazer *agentes que alimentam o dashboard*: um agente pode ler uma coleção, resumir e gravar o resultado em outra, e os componentes ligados a ela se atualizam sozinhos.

## Conceitos

- **Item**: um objeto JSON. O texto de um agente vem em `text`; um registro lido do banco traz os campos dele.
- **Nó**: faz uma coisa com cada item que chega e entrega itens para o próximo.
- **Fio**: liga a porta de saída de um nó à entrada de outro. O nó *Se / Senão* tem duas saídas (`true` e `false`); os demais têm uma (`main`).
- **Execução** (*run*): percorre o grafo em ordem topológica a partir do nó **Pedido**. Cada nó registra entrada, saída, tempo, ferramentas usadas e erros, tudo visível no painel de execução.

## Tipos de nó

| Tipo | Rótulo | O que faz |
|---|---|---|
| `input.prompt` | Pedido | Ponto de partida: o texto que entra. Ao executar você pode trocá-lo. |
| `agent.llm` | Agente | Agente de IA: recebe o que veio dos nós ligados, segue as **instruções**, pode usar as **ferramentas** marcadas e entrega o texto. Campos: `instructions`, `provider` (`auto`, `groq`, `anthropic`, `gemini`, `claude-code`), `model`, `tools`, `maxSteps` (1 a 12, padrão 6). Sem ferramentas marcadas, só conversa. |
| `agent.claude` | Claude Code | Roda o `claude -p` no seu computador com o que chegou como pedido; pode ler/editar arquivos numa pasta. Campos: `instructions`, `cwd` (vazio = `data/work`), `allowedTools` (`Read,Grep,Glob,LS,WebSearch,WebFetch,Edit,Write`; `Bash` só com `CLAUDE_NODE_ALLOW_BASH=true`), `maxTurns`. **Só roda quando você executa.** |
| `tool.call` | Ferramenta | Chama uma ferramenta (arquivos, hora, Google, servidores MCP) para cada item. Se devolver uma lista, cada elemento vira um item. Campos: `tool`, `args` (JSON, aceita `{{json.text}}`). |
| `data.records` | Ler registros | Lê registros de uma coleção (uma vez por execução); cada registro vira um item. É assim que um agente enxerga os dados do dashboard. Campos: `collection`, `where`, `q`, `limit` (até 200). |
| `action.record` | Salvar registro | Cria um registro numa coleção; os componentes ligados a ela atualizam. Campos: `collection`, `data` (JSON com templates). |
| `action.notify` | Notificar | Envia uma notificação por item (balão no Studio e notificação do navegador). O item segue adiante. Campos: `title`, `message`, `level`. Na simulação não notifica. |
| `ui.block` | Componente | Mostra um componente funcionando ao vivo no canvas. O que chegar ao nó fica na caixa de entrada dele (`ctx.inbox()`); o componente também pode executar agentes (`ctx.agent.run`). |
| `logic.if` | Se / Senão | Separa os itens pela condição: os que cumprem saem por *verdadeiro*, os outros por *falso*. |
| `output.result` | Resultado | Final do caminho: o que chega aqui vira o resultado da execução. |
| `note` | Nota | Comentário no desenho; não executa. |

Limites de um canvas: 60 nós e 200 fios.

## Expressões e templates

Campos de texto e JSON aceitam templates `{{ … }}`. É um interpretador próprio e fechado (sem `eval`), porque as definições podem vir de agentes e de texto de terceiros.

```
Olá {{json.text}}
{{nodes.pesquisa.items[0].text | upper}}
```

- **Caminhos:** `json.campo` (item atual), `index`, `input.text` (o pedido da execução), `nodes.<id>.items[0].campo` (saída de outro nó), `now.date`.
- **Filtros:** `json`, `length`, `first`, `last`, `join`, `upper`, `lower`.
- Se a string inteira é **um** template, o valor mantém o tipo (lista, objeto, número).
- **Condições** (em *Se / Senão*): `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `&&`, `||`, `!`, parênteses. Exemplo: `json.text contains "erro" && !(json.status == "ok")`.

## Simular e executar

| Modo | O que acontece |
|---|---|
| **Simular** (`dry`) | Não gasta cota de IA e não escreve nada: os agentes e as escritas (registros, notificações, ferramentas que alteram dados) são **simulados**; as leituras (registros, `list…`/`get…` de servidores MCP) rodam de verdade. Mostra, por nó, o que entrou e saiu, com avisos e erros. |
| **Executar** (`live`) | Chama os agentes e grava de verdade. Exige **confirmação explícita**. O Claude do terminal só simula, nunca executa ao vivo. |

Limites por execução: 200 itens, 30 chamadas a agentes, 200 chamadas a ferramentas, 20 notificações, 10 minutos. No máximo 3 execuções simultâneas; um mesmo canvas não roda duas vezes ao mesmo tempo.

Antes de executar, o canvas é validado: ciclo, ferramenta inexistente, parâmetro errado em `tool.call`, agente sem instruções, nó *Pedido* ausente. Erros de um canvas criado por agente são **estritos** (recusados com a explicação e a dica do nome certo); os de um canvas criado por você viram avisos.

## Provedores de IA

Cada agente escolhe o provedor:

- **`auto`** (padrão): usa o preferido (`AI_PROVIDER` ou o painel *Provedores de IA*) e, se estourar o limite (429), a cota ou o serviço estiver fora do ar, tenta o **próximo provedor com chave**. Antes de trocar, espera o tempo que o provedor pediu (até 25 s, 3 tentativas).
- **`groq`**, **`gemini`**, **`anthropic`**: chamados por HTTP, com laço de ferramentas (o agente só usa as marcadas no nó).
- **`claude-code`**: usa a **sua conta do Claude Code** (`claude -p`), sem chave de API. Só enxerga ferramentas de servidores MCP (`mcp__servidor__…`) marcadas no nó, com `--allowedTools` e `--permission-mode dontAsk`.

Modelos padrão: Groq `openai/gpt-oss-120b`, Gemini `gemini-2.5-flash`, Anthropic `claude-sonnet-5` (mude em Configurações ou no campo *Modelo* do nó).

## Modelos prontos e exemplos

Ao criar um canvas (*Novo canvas*) há três modelos:

- **Em branco**: Pedido → Agente → Resultado.
- **Pesquisador + Redator**: dois agentes em cadeia.
- **Painel + Juiz**: dois pareceres em paralelo e um juiz.

Os pacotes da biblioteca trazem orquestrações prontas (por exemplo *Kanban: planejador*, *CRM: analista*, *Notas: resumir*, *Workspace: resumo do dia*), que aparecem na aba Orquestração depois de instalados.

## Disparando de outros lugares

- **Componente**: `ctx.agent.run(idOuChave, texto)` (com o id em `permissions.agents`).
- **Lembrete**: em `sistema_lembretes`, o campo `canvas_id` executa a orquestração ao vivo a cada disparo, com a mensagem como pedido.
- **Claude / API**: `POST /canvases/:id/run` com `{mode, input, startNodeId, confirmed}`; no MCP, `run_canvas` só simula.

## Criando pelo Claude

No terminal do app (perfil *Claude — montar canvases*) ou por qualquer Claude Code com o MCP, peça em português. O Claude usa `canvas_guide` e `canvas_nodes`, monta com `save_canvas`, testa com `run_canvas` (simulação) e diz o que você precisa revisar antes de clicar em **Executar**.
