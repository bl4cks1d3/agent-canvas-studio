# Guia do usuário

Este guia mostra o que cada parte do app faz e como resolver as tarefas comuns. Se ainda não instalou, comece por [INSTALACAO.md](INSTALACAO.md).

## Tour rápido

Ao abrir <http://localhost:5200> você vê a **barra lateral** (páginas, ou orquestrações, conforme a aba), as **abas** no topo e o **sino** de notificações.

| Aba | Para que serve |
|---|---|
| **Dashboard** | O seu painel. Uma **página** por assunto (Rotina, Estudo, Saúde, Kanban…) com os componentes funcionando |
| **Orquestração** | Desenhar times de agentes de IA que leem e gravam os seus dados |
| **Biblioteca** | Instalar pacotes prontos |
| **Componentes** | Ver, aprovar, editar e versionar os componentes; mudar o **tema** |
| **Dados** | As coleções (tabelas) e seus registros; a **lixeira** |
| **Configurações** | Chaves de IA, conta Google, som e notificações |
| **Terminal** | O Claude Code dentro do app (``Ctrl+` ``) |
| **Criar com Claude** | Descreva o que quer; o Claude constrói em segundo plano |

Na primeira execução o **padrão de fábrica** já vem instalado: páginas **Rotina**, **Estudo**, **Saúde**, **Kanban**, **Kanban Google** e **Workspace**.

## Dashboard

- **Páginas** na barra lateral: clique para trocar, use ▲ ▼ para reordenar, a lixeira para excluir (os componentes continuam existindo) e **Nova página** para criar.
- **Editar layout** liga a grade: arraste e redimensione os componentes e puxe outros da bandeja. Desligue quando terminar.
- **Tela cheia** transforma o Studio num painel (bom para uma segunda tela).
- O tema **claro/escuro** fica no rodapé da barra lateral.
- Tudo **atualiza sozinho**: se o Claude (ou um agente) mudar dados, a tela mostra em cerca de 1 segundo.

### O que vem de fábrica

| Página | Componentes |
|---|---|
| **Rotina** | *Resumo do dia* (hábitos, tarefas, foco, cartões a revisar, sequência, humor) · *Rastreador de hábitos* (grade semanal, meta semanal, sequência) · *Tarefas do dia* (prazo, importância, urgência; abas Hoje/Abertas/Concluídas) · *Matriz de Eisenhower* (arraste entre 4 quadrantes) · *Diário e humor* · *Constância* (mapa de calor de 16 semanas) |
| **Estudo** | *Pomodoro* (registra cada pomodoro como sessão) · *Metas de estudo* (meta semanal por matéria) · *Flashcards* (repetição espaçada: só o que vence hoje) |
| **Saúde** | *Hidratação*: contador de água com meta diária, histórico de 7 dias e **lembrete** recorrente |
| **Kanban** | Quadro *A fazer / Fazendo / Revisão / Feito*, com arrastar-e-soltar |
| **Kanban Google** | Suas tarefas do Google Tasks e os compromissos da Agenda em colunas; arraste para concluir |
| **Workspace** | Resumo do dia, agenda, tarefas e e-mails do Google |

## Componentes e aprovação

Componentes criados pelo Claude **aparecem como “Aguardando aprovação”** e não fazem nada até você aprovar. Para aprovar:

1. Abra **Componentes** (ou clique em *Aprovar* no próprio componente).
2. Leia o que ele **lê**, **grava** e **chama** (as permissões).
3. Aprove. Se você (ou o Claude) alterar o código ou as permissões depois, a aprovação **volta a ser pedida**.

Em Componentes você também vê o código, o **histórico de versões** (restaure qualquer uma) e os **avisos de consistência** (lint). O **tema** (cor de destaque, cantos, fonte, densidade) vale para todos os componentes e para o app.

## Dados

**Dados** lista as coleções. Em cada uma: buscar, **Registro** (criar), *editar*, excluir e **Lixeira**.

- Campos do tipo **relação** aparecem como uma lista para escolher (por exemplo, o hábito de um check-in), em vez de um id solto.
- Campos de data e hora com **preenchimento automático** já vêm com o valor certo ao criar.
- **Excluir um registro o manda para a Lixeira**: clique em *Lixeira* → *restaurar* (30 dias). Excluir uma **coleção** inteira não tem volta.
- **Nova coleção**: um campo por linha, `nome: tipo`. Tipos: `text`, `longtext`, `number`, `date`, `boolean`, `select(a|b|c)`, `relation(colecao)`. Acrescente `=today`, `=now` ou `=time` para preencher sozinho ao criar (`data: date=today`).

## Biblioteca

Escolha um pacote → **Instalar**. Se ele pedir uma ferramenta (por exemplo, listar eventos do Google), o Studio mostra as opções conectadas. **Desinstalar** remove o pacote; os dados só saem se você marcar. Detalhes em [BIBLIOTECA.md](BIBLIOTECA.md).

## Orquestração

Para times de agentes: **Novo canvas** (em branco ou de um modelo) → arraste nós, ligue com fios → **Simular** (não gasta IA nem escreve) → **Executar** (ao vivo, com confirmação). Um agente pode ler uma coleção, resumir e gravar o resultado em outra; os componentes ligados a ela atualizam sozinhos. Guia completo: [ORQUESTRACAO.md](ORQUESTRACAO.md).

## Configurações

- **Provedores de IA**: cole a chave (Groq, Gemini, Anthropic), escolha o modelo, **Testar** e defina o provedor preferido. O Claude Code aparece como disponível se estiver instalado.
- **Conta Google**: [GOOGLE.md](GOOGLE.md).
- **Notificações**: som (toque e volume) e **modo desktop** (notificação do sistema).

As chaves ficam no `.env` da sua máquina e a tela nunca as mostra de volta.

## Notificações e lembretes

O **sino** guarda os avisos (também os que chegaram com o Studio fechado). Ative as notificações do navegador quando ele pedir, para receber com a aba em segundo plano.

**Lembrete de água**: em *Saúde*, ligue o lembrete, escolha o intervalo e a janela do dia (ex.: a cada 60 min, das 08:00 às 22:00). O servidor avisa mesmo com o Studio fechado. Ao **registrar um copo**, o próximo aviso conta a partir dele: você não é lembrado de beber logo depois de beber.

## Trabalhando com o Claude

Abra o **Terminal** (``Ctrl+` ``) → **Claude — controlar o Studio** e peça em português:

- *“Crie um controle de gastos com categoria e valor, e um gráfico por mês.”*
- *“Adicione um campo ‘humor’ ao diário e mostre no resumo do dia.”*
- *“Quais são minhas tarefas do Google para amanhã? Conclua as duas primeiras.”*
- *“Sincronize as tarefas da Rotina com o Google.”*
- *“Marque como feitas as tarefas A, B e C de uma vez.”* (vira **um** lote, tudo ou nada)
- *“Apaguei sem querer o registro X: restaure.”*
- *“Que horas são?”* (ele consulta o relógio do Studio, no seu fuso)

Ele monta os dados, os componentes e a página; você vê aparecer na tela, **aprova** os componentes novos e ajusta o que quiser. Ele não aprova, não executa orquestrações de verdade e pergunta antes de apagar ou de alterar a sua conta Google. Veja [MCP.md](MCP.md).

O botão **Criar com Claude** faz o mesmo em segundo plano, com uma caixa de pedido e o progresso na tela.

## Receitas

**Um painel só para mim.** Abra o Dashboard, **Nova página**, peça ao Claude para colocar os componentes que você quer e use **Editar layout** para arrumar. Ligue **Tela cheia**.

**Tarefas do Google em um lugar só.** Conecte a conta ([GOOGLE.md](GOOGLE.md)) e use o **Kanban Google**. Se também usa a Rotina, peça ao Claude *“sincronize minhas tarefas”*: a mesma tarefa nos dois lados é vinculada, não duplicada, e concluir de um lado conclui no outro.

**Ver a agenda da família.** No **Kanban Google**, clique em **Configurar**, escolha os dias (próximos e passados) e marque a agenda *Família*.

**Um agente que resume minhas notas.** Instale **Notas** na Biblioteca, cadastre uma chave de IA e execute a orquestração *Notas: resumir*.

**Voltar atrás numa exclusão.** Dados → coleção → **Lixeira** → *restaurar*.

**Backup.** Pare o Studio e copie `data/agent-canvas.db` ([INSTALACAO.md](INSTALACAO.md#backup)).

## Quando algo não funciona

[SOLUCAO-DE-PROBLEMAS.md](SOLUCAO-DE-PROBLEMAS.md) lista os erros mais comuns e como resolvê-los.
