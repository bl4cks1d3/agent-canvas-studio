# Agent Canvas Studio

[![Licença: MIT](https://img.shields.io/badge/licença-MIT-blue.svg)](LICENSE)
![Node ≥ 22.5](https://img.shields.io/badge/node-%E2%89%A5%2022.5-339933)

Um estúdio para **construir dashboards sob medida em linguagem natural**. Você descreve (“um kanban”, “um CRM”, “meus hábitos e minhas tarefas do Google”) e o **Claude constrói dentro do app**: os dados (coleções no banco), os componentes visuais (HTML + CSS + JS), a página do dashboard e, se precisar, os agentes de IA que os alimentam. Tudo **persiste no banco**: dados, design e organização da tela. E a tela **se atualiza sozinha** quando o Claude ou um agente muda alguma coisa.

Roda 100 % na sua máquina (Node + SQLite). Nada sobe para a nuvem, exceto o que você mesmo conecta: chaves de IA (Groq, Gemini, Anthropic) e a conta Google.

## O que tem aqui

| Área | Para que serve |
|---|---|
| **Dashboard** | A visão principal: páginas (na barra lateral) com os componentes funcionando. *Editar layout* liga a grade: arraste, redimensione e puxe componentes da bandeja. *Tela cheia* para usar como painel. |
| **Orquestração** | O canvas (estilo n8n): agentes de IA, ferramentas, leitura e gravação de dados, condições, notificações e componentes ligados por fios. Simula sem gastar cota e executa ao vivo quando você manda. |
| **Biblioteca** | Pacotes prontos (Rotina e Estudo, Kanban, Kanban Google, Saúde, CRM, ERP leve, Notas, Google Workspace). Ao instalar, o Studio pede as conexões que o pacote precisa. |
| **Componentes** | Todos os componentes: quem criou, permissões, **aprovação**, código, **versões** e o **tema** (cor, cantos, fonte, densidade) que vale para todos. |
| **Dados** | Coleções e registros (esquema definido em uso), com relações, lote e **lixeira** de 30 dias. |
| **Configurações** | Chaves e modelos das IAs, conta Google, som e notificações do sistema. |
| **Terminal** | O Claude Code dentro do app, com o MCP do Studio (``Ctrl+` ``): peça em português e veja aparecer na tela. Com **voz**: toque no Espaço e fale. |
| **Botão de voz** | O círculo flutuante da barra lateral: fale o que o Studio deve fazer e ele executa (com conferência do texto antes de enviar). |
| **Criar com Claude** | Você descreve; o Claude Code trabalha em segundo plano e entrega coleções, componentes e páginas para você aprovar. |

## Começando

Requisitos: **Node ≥ 22.5** (usa o `node:sqlite` embutido), **pnpm 10** e, para o terminal e o “Criar com Claude”, o **Claude Code** instalado. A conta Google pede também o **uv** (`uvx`).

```bash
pnpm setup      # instala, compila, cria o .env e registra o MCP no Claude Code
pnpm dev        # API :5100 · app web :5200 · terminal :5300
```

Abra <http://localhost:5200>. Numa instalação nova o **padrão de fábrica** já vem pronto: hábitos, tarefas, diário, pomodoro, flashcards, kanban, hidratação com lembrete e o painel do Google. As chaves de IA e a conta Google você cadastra na aba **Configurações** (nunca é preciso editar o `.env` na mão). Passo a passo em [docs/INSTALACAO.md](docs/INSTALACAO.md).

## Documentação

| Documento | Conteúdo |
|---|---|
| [Instalação](docs/INSTALACAO.md) | Requisitos, instalação, primeira execução, atualização e desinstalação |
| [Guia do usuário](docs/GUIA-DO-USUARIO.md) | Tour por cada área e receitas do dia a dia |
| [Arquitetura](docs/ARQUITETURA.md) | Pacotes, fluxo de dados, eventos em tempo real, banco de dados |
| [Configuração](docs/CONFIGURACAO.md) | Todas as variáveis de ambiente, portas e pastas |
| [Studio](docs/STUDIO.md) | Modelo de dados, componentes, páginas, pacotes, lembretes |
| [Componentes](docs/COMPONENTES.md) | Como escrever um componente: `ctx`, design system, permissões, lint |
| [Orquestração](docs/ORQUESTRACAO.md) | Tipos de nó, expressões, execução, provedores de IA |
| [Biblioteca](docs/BIBLIOTECA.md) | Catálogo de pacotes, padrão de fábrica e como criar um pacote |
| [Google](docs/GOOGLE.md) | Conta Google, Tarefas, Agenda e sincronização |
| [MCP e Claude Code](docs/MCP.md) | Todas as ferramentas do MCP e os perfis do terminal |
| [API HTTP](docs/API.md) | Referência de rotas |
| [Segurança](docs/SEGURANCA.md) | Modelo de ameaças, isolamento, o que nunca é feito |
| [Solução de problemas](docs/SOLUCAO-DE-PROBLEMAS.md) | Erros comuns e como resolver |
| [Desenvolvimento](docs/DEVELOPMENT.md) | Estrutura do código, testes, como contribuir |
| [Raspberry Pi](docs/RASPBERRY-PI.md) | Empacotar e instalar no Pi (opcional) |
| [Changelog](CHANGELOG.md) | Histórico de mudanças |

## Como o Claude constrói

1. **No app**: *Criar com Claude* → descreva → acompanhe → aprove os componentes.
2. **No terminal do app** (ou em qualquer Claude Code com o MCP `agent-canvas`): peça direto, por exemplo *“crie um controle de gastos com categorias e um gráfico por mês”*. O Claude lê o guia do Studio e usa `save_collection`, `save_block`, `save_page`, `save_package`, `save_canvas`…

Componentes criados por agente **nascem sem aprovação**: só rodam depois que você revisa as permissões e aprova. O Claude não tem ferramenta para aprovar, só simula orquestrações (a execução ao vivo é sua) e é instruído a nunca ler as suas chaves.

## Segurança em uma frase

Tudo escuta só em `127.0.0.1`; componentes rodam em iframe isolado sem rede e só enxergam o que suas permissões liberam; as chaves ficam no `.env` e nenhuma resposta da API as devolve. Detalhes em [docs/SEGURANCA.md](docs/SEGURANCA.md). **Não exponha as portas na rede.**

## Licença

[MIT](LICENSE) © 2026 bl4cks1d3.
