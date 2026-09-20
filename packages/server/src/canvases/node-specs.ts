import type { NodeSpec, NodeType } from "@agent-canvas/shared";

/**
 * Catalogo dos nos. O editor (formularios e paleta), a validacao e o servidor MCP leem daqui:
 * para criar um tipo novo, acrescente aqui, valide em graph.ts e execute em engine.ts.
 */
export const NODE_SPECS: NodeSpec[] = [
  {
    type: "input.prompt",
    category: "input",
    label: "Pedido",
    description: "Ponto de partida: o texto que entra no canvas. Ao executar você pode trocar por outro pedido.",
    inputs: 0,
    outputs: ["main"],
    fields: [{ key: "text", label: "Texto padrão", kind: "textarea", placeholder: "Pesquise as novidades sobre …" }],
    example: { text: "Explique em 3 frases o que é um canvas de agentes." },
  },
  {
    type: "agent.llm",
    category: "agent",
    label: "Agente",
    description: "Um agente de IA: recebe o que chegou dos nós ligados a ele, segue as instruções, pode usar as ferramentas marcadas e entrega o texto para os próximos.",
    inputs: 1,
    outputs: ["main"],
    fields: [
      { key: "instructions", label: "Instruções (papel do agente)", kind: "textarea", required: true, placeholder: "Você é um pesquisador. Resuma o pedido em tópicos.", help: "Aceita {{json.text}} e {{input.text}}." },
      { key: "provider", label: "Provedor", kind: "select", options: ["auto", "groq", "anthropic", "gemini", "claude-code"], help: "auto = o preferido em “Provedores de IA” e, se estourar o limite, o próximo com chave. claude-code usa a sua conta do Claude Code (só ferramentas de servidores MCP)." },
      { key: "model", label: "Modelo (opcional)", kind: "text", placeholder: "padrão do provedor", help: "Ex.: openai/gpt-oss-20b (Groq), gemini-2.5-flash, sonnet (Claude Code). A lista de modelos está em “Provedores de IA”." },
      { key: "tools", label: "Ferramentas que ele pode usar", kind: "tools", help: "Sem marcar nada, o agente só conversa." },
      { key: "maxSteps", label: "Máx. de passos", kind: "number", placeholder: "6" },
    ],
    example: { instructions: "Você é um assistente objetivo.", provider: "auto", tools: [], maxSteps: 6 },
  },
  {
    type: "agent.claude",
    category: "agent",
    label: "Claude Code",
    description: "Roda o Claude Code (claude -p) no seu computador com o que chegou como pedido. Pode ler/editar arquivos numa pasta. Só roda quando VOCÊ executa.",
    inputs: 1,
    outputs: ["main"],
    fields: [
      { key: "instructions", label: "Instruções", kind: "textarea", required: true, placeholder: "Revise o código e liste os problemas." },
      { key: "cwd", label: "Pasta de trabalho", kind: "text", placeholder: "vazio = data/work" },
      { key: "allowedTools", label: "Ferramentas liberadas", kind: "text", placeholder: "Read,Grep,Glob", help: "Read, Grep, Glob, LS, WebSearch, WebFetch, Edit, Write. Bash exige CLAUDE_NODE_ALLOW_BASH=true." },
      { key: "maxTurns", label: "Máx. de turnos", kind: "number", placeholder: "10" },
    ],
    example: { instructions: "Responda em português.", allowedTools: "Read,Grep,Glob", maxTurns: 10 },
  },
  {
    type: "tool.call",
    category: "tool",
    label: "Ferramenta",
    description: "Chama uma ferramenta (arquivos, hora, servidores MCP) para cada item. Se devolver uma lista, cada elemento vira um item.",
    inputs: 1,
    outputs: ["main"],
    fields: [
      { key: "tool", label: "Ferramenta", kind: "tool", required: true, placeholder: "fs_read" },
      { key: "args", label: "Argumentos (JSON)", kind: "json", placeholder: '{"path": "notas.md"}', help: "Use {{json.text}} para dados do item." },
    ],
    example: { tool: "get_time", args: {} },
  },
  {
    type: "data.records",
    category: "data",
    label: "Ler registros",
    description: "Lê registros de uma coleção do banco (uma vez por execução); cada registro vira um item. É assim que um agente enxerga os dados do dashboard.",
    inputs: 1,
    outputs: ["main"],
    fields: [
      { key: "collection", label: "Coleção", kind: "collection", required: true },
      { key: "where", label: "Filtro (JSON, opcional)", kind: "json", placeholder: '{"coluna": "Fazendo"}' },
      { key: "q", label: "Busca (opcional)", kind: "text" },
      { key: "limit", label: "Limite", kind: "number", placeholder: "100" },
    ],
    example: { collection: "kanban_cards", limit: 100 },
  },
  {
    type: "action.record",
    category: "data",
    label: "Salvar registro",
    description: "Cria um registro numa coleção do banco (os componentes ligados a ela atualizam). Devolve o registro criado.",
    inputs: 1,
    outputs: ["main"],
    fields: [
      { key: "collection", label: "Coleção", kind: "collection", required: true },
      { key: "data", label: "Campos (JSON)", kind: "json", required: true, placeholder: '{"title": "{{json.text}}"}' },
    ],
    example: { collection: "notes_items", data: { title: "Resumo", body: "{{json.text}}" } },
  },
  {
    type: "action.notify",
    category: "output",
    label: "Notificar",
    description: "Envia uma notificação ao usuário para cada item (balão no Studio e notificação do navegador). O item segue adiante, então dá para notificar no meio do caminho. Na simulação não notifica.",
    inputs: 1,
    outputs: ["main"],
    fields: [
      { key: "title", label: "Título", kind: "text", required: true, placeholder: "Análise concluída", help: "Aceita {{json.text}} e {{input.text}}." },
      { key: "message", label: "Mensagem (opcional)", kind: "textarea", placeholder: "{{json.text}}" },
      { key: "level", label: "Tipo", kind: "select", options: ["info", "ok", "warn", "error"] },
    ],
    example: { title: "Análise concluída", message: "{{json.text}}", level: "ok" },
  },
  {
    type: "ui.block",
    category: "ui",
    label: "Componente",
    description: "Mostra um componente visual (bloco) no canvas, funcionando ao vivo. O que chegar ao nó fica na caixa de entrada do componente (ctx.inbox()); o componente também pode executar agentes (ctx.agent.run).",
    inputs: 1,
    outputs: [],
    fields: [
      { key: "blockId", label: "Componente", kind: "block", required: true },
      { key: "w", label: "Largura (px)", kind: "number", placeholder: "520" },
      { key: "h", label: "Altura (px)", kind: "number", placeholder: "380" },
    ],
    example: { w: 520, h: 380 },
  },
  {
    type: "logic.if",
    category: "logic",
    label: "Se / Senão",
    description: "Separa os itens: os que cumprem a condição saem por 'verdadeiro', os outros por 'falso'.",
    inputs: 1,
    outputs: ["true", "false"],
    fields: [{ key: "condition", label: "Condição", kind: "condition", required: true, placeholder: 'json.text contains "erro"', help: "Operadores: == != > >= < <= contains && || ! ( )" }],
    example: { condition: 'json.text contains "erro"' },
  },
  {
    type: "output.result",
    category: "output",
    label: "Resultado",
    description: "Final do caminho: o que chega aqui vira o resultado da execução (mostrado no painel).",
    inputs: 1,
    outputs: [],
    fields: [{ key: "title", label: "Título (opcional)", kind: "text", placeholder: "Relatório final" }],
    example: { title: "Resultado" },
  },
  {
    type: "note",
    category: "note",
    label: "Nota",
    description: "Comentário no desenho (não executa). Use para explicar o que cada parte faz.",
    inputs: 0,
    outputs: [],
    fields: [{ key: "text", label: "Texto", kind: "textarea" }],
    example: { text: "Explique aqui o que este grupo de nós faz." },
  },
];

const BY_TYPE = new Map<string, NodeSpec>(NODE_SPECS.map((s) => [s.type, s]));

export const specOf = (type: string): NodeSpec | undefined => BY_TYPE.get(type);
export const NODE_TYPES = NODE_SPECS.map((s) => s.type) as NodeType[];
export const isStart = (type: string) => type === "input.prompt";
export const isAgent = (type: string) => type === "agent.llm" || type === "agent.claude";
