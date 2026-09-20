# Agent Canvas Studio

Um estúdio para **construir dashboards sob medida em linguagem natural**. Você descreve (“um kanban”, “um CRM”, “um painel do Google Workspace”, “notas”) e o **Claude constrói dentro do app**: os dados (coleções no banco), os componentes visuais (HTML + CSS + JS), a página do dashboard e, se precisar, os agentes de IA que os alimentam. Tudo **persiste no banco** — dados, design e organização da tela.

| Área | Para que serve |
|---|---|
| **Dashboard** | A visão principal: páginas (na barra lateral, como paginação) com os componentes prontos funcionando. “Editar layout” liga a organização em grade: arraste, redimensione e puxe componentes da bandeja. **Tela cheia** para usar como painel. |
| **Orquestração** | O canvas (React Flow, estilo n8n): agentes de IA, ferramentas MCP, leitura/gravação de dados, condições e componentes ligados por fios. É onde se orquestra o que alimenta o dashboard. |
| **Biblioteca** | Dashboards prontos (Kanban, CRM, Notas, ERP leve, Google Workspace…). Ao instalar, o Studio **pede as conexões** que o pacote precisa (ferramentas de MCP, chave de IA). |
| **Componentes** | Todos os componentes: quem criou, permissões, aprovação, código, **versões** e o **tema** (design tokens) que vale para todos. |
| **Dados** | As coleções e seus registros (esquema definido em uso). |
| **Criar com Claude** | Você descreve; o Claude Code trabalha em segundo plano (só com as ferramentas do Agent Canvas) e entrega coleções, componentes e páginas. Você aprova. |

## Rodando

Requisitos: Node ≥ 22.5 (usa `node:sqlite`), pnpm 10, e — para “Criar com Claude” e o terminal — o Claude Code instalado.

```bash
pnpm install
cp .env.example .env      # preencha ao menos UMA chave de IA (Groq, Anthropic ou Gemini)
pnpm dev                  # servidor :5100, web :5200, terminal :5300
```

Abra <http://localhost:5200>. Sem chave de IA tudo funciona, menos os agentes.

## Como o Claude constrói

1. **Pelo app**: botão **Criar com Claude** → descreva → acompanhe o progresso → aprove os componentes.
2. **Pelo terminal do app** (aba Terminal, na Orquestração) ou por qualquer Claude Code: `pnpm mcp:install` registra o MCP `agent-canvas`; use o prompt `/mcp__agent-canvas__construir-dashboard` ou simplesmente peça.

O Claude usa o guia `studio_guide` (design system, API dos componentes, regras de persistência/consistência) e as ferramentas `save_collection`, `save_block`, `save_page`, `place_block`, `save_package`, `save_canvas`… Componentes criados por agente **nascem sem aprovação**: só rodam depois que você revisa as permissões e aprova.

## Persistência e consistência

- **Dados**: coleções com esquema (tipos, obrigatórios, opções) e validação; registros em SQLite.
- **Estado de tela** (`ctx.store`): aba, filtro, seleção… persistem por componente.
- **Design**: o código do componente fica no banco com **histórico de versões** (restaurável); o layout de cada página (posição/tamanho na grade) também; o **tema** (cor de destaque, cantos, fonte, densidade) vale para todos os componentes e para o app.
- **Consistência**: avisos ao salvar um componente (cor fixa fora do design system, APIs bloqueadas, coleção sem permissão…), permissões só para coleções existentes, edição concorrente detectada (409).

Detalhes em [docs/STUDIO.md](docs/STUDIO.md), API em [docs/API.md](docs/API.md), desenvolvimento em [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Segurança

- Componentes rodam em **iframe isolado** (`sandbox="allow-scripts"`, CSP sem rede); só acessam o que suas permissões liberam, conferidas a cada chamada. Código de agente/API só roda após **aprovação do usuário**; alterar código ou permissões revoga a aprovação.
- O servidor e o terminal aceitam apenas `localhost`; ferramentas e o construtor exigem origem conhecida do Studio. **Não exponha as portas na rede.**
- “Criar com Claude” roda o Claude Code **apenas com as ferramentas do Agent Canvas** (sem Bash, arquivos ou web).
