export const GUIDE = `
# Agent Canvas: canvas de agentes conectados
O usuario ve cada canvas como um desenho de nos ligados por fios: um **Pedido** entra, **agentes** de IA trabalham em cadeia (ou em paralelo) e o **Resultado** sai. Voce monta com save_canvas, simula com run_canvas e explica ao usuario. **Nunca execute de verdade**: so o usuario executa (botao Executar), porque agentes gastam cota de IA e o Claude Code roda no PC dele.

Fluxo: canvas_nodes (tipos, ferramentas, provedores) -> list_canvases -> save_canvas -> **run_canvas (simulacao)** -> corrija o que falhar -> resuma o desenho e diga para abrir o canvas e clicar em Executar.

## Modelo
- Cada no recebe **itens** (objetos JSON; o texto de um agente fica em \`text\`) e entrega itens por uma porta. Sem itens de entrada o no e pulado.
- nodes: [{ id, type, name, config }]  |  edges: [{ from, fromPort, to }]. id = a-z, 0-9 e _ (comeca com letra). fromPort = "main" (padrao) ou "true"/"false" no Se.
- Sem ciclos. x/y opcionais (organizamos em colunas). Use nos "note" para explicar etapas.
- **Agente com varias entradas (fan-in)** recebe TUDO junto: bom para "juiz", "consolidador", "revisor". **Uma saida ligada a varios agentes (fan-out)** manda o mesmo texto para todos: bom para pareceres em paralelo.

## Nos (config)
- **input.prompt** { text } — ponto de partida (o usuario pode trocar o texto ao executar).
- **agent.llm** { instructions (papel e tarefa; aceita {{json.text}} {{input.text}}), provider ("auto"|"groq"|"anthropic"|"gemini"|"claude-code"), model?, tools: ["get_time", ...] (SO as que o agente precisa), maxSteps (1-12) } — sem tools, so conversa. "auto" usa o provedor preferido do usuario e, se o limite estourar, o proximo com chave; "claude-code" usa a conta do Claude Code do usuario (so ferramentas mcp__servidor__…).
- **agent.claude** { instructions, cwd?, allowedTools: "Read,Grep,Glob", maxTurns } — Claude Code (claude -p) no PC, numa pasta; use para ler/editar arquivos de codigo. Prefira so leitura (Read,Grep,Glob). Bash so se o usuario liberou.
- **tool.call** { tool, args } — chama uma ferramenta (nome e PARAMETROS exatos de canvas_nodes; o save confere) para cada item.
- **action.notify** { title, message?, level?: "info"|"ok"|"warn"|"error" } — notifica o usuario (balao no Studio + notificacao do navegador) para cada item; title/message aceitam expressoes ({{json.text}}). O item segue adiante. Na simulacao nao notifica; ao vivo, no maximo 20 por execucao. Um agente tambem pode usar a ferramenta \`notify\` (liste em tools).
- **data.records** { collection, where?, q?, limit? } — le registros de uma colecao e os entrega como itens (a colecao vem de list_collections; veja studio_guide).
- **action.record** { collection, data } — grava um registro por item; data aceita expressoes ({"titulo": "{{json.text}}"}). Na simulacao nao grava.
- **ui.block** { blockId, w, h } — mostra um componente (bloco) funcionando dentro do canvas; o que chegar ao no vai para a caixa de entrada do componente (ctx.inbox()). O canvas e a ORQUESTRACAO do dashboard: agentes alimentam colecoes e componentes.
- **logic.if** { condition } — separa em true/false. Ex.: json.text contains "erro".
- **output.result** { title? } — o que chegar aqui vira o resultado da execucao. Sem ele, vale a fala do ultimo agente.
- **note** { text }.

## Expressoes ({{ }}; sem codigo)
{{json.text}} item atual | {{input.text}} pedido da execucao | {{nodes.<id>.items[0].text}} saida de outro no | {{now.iso}} {{now.date}} {{now.time}} | filtros: {{json.text | upper}} (json length first last join upper lower). Condicoes: json.text contains "x" && !(json.n > 3) (== != > >= < <= contains && || !).

## Como desenhar bons times de agentes
- Um papel por agente, instrucoes curtas e concretas (entrada -> o que fazer -> formato da saida).
- Paralelo + juiz: Pedido -> [Agente A, Agente B] -> Juiz -> Resultado.
- Pesquisa -> Redacao -> Revisao em cadeia; roteamento: Agente classificador -> Se (json.text contains "urgente") -> caminhos.
- Ferramentas so onde precisam: agente que usa muitas ferramentas gasta mais passos. Ferramentas de servidores MCP do usuario aparecem em canvas_nodes como mcp__servidor__ferramenta.
- Simule sempre (run_canvas): nos "simulated" = nao gastou IA; leia os avisos e erros por no.

## Regras
- Tudo que voce salva fica como rascunho do agente (source "agent"); o usuario revisa antes de executar.
- Sem segredos nos nos. Nao invente ferramentas, provedores nem eventos.
`;
