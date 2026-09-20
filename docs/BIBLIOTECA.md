# Biblioteca e padrão de fábrica

A **Biblioteca** reúne **pacotes**: um pacote é um conjunto pronto de *coleções + componentes + orquestrações + páginas* mais as **conexões** que ele pede (ferramentas MCP, uma chave de IA). Instalar é um clique; o Studio pede o que faltar.

## Catálogo

| Pacote | Categoria | O que traz |
|---|---|---|
| **Rotina e Estudo** `rotina-estudo` | produtividade | Rastreador de hábitos com sequência, tarefas do dia, matriz de Eisenhower, diário e humor, mapa de constância, resumo do dia, pomodoro, metas de estudo e flashcards com repetição espaçada. Coleções: `rotina_habitos`, `rotina_checkins`, `rotina_tarefas`, `rotina_diario`, `estudo_materias`, `estudo_sessoes`, `estudo_cartoes`. Páginas: *Rotina* e *Estudo* |
| **Kanban Google** `kanban-google` | produtividade | Kanban *A fazer / Fazendo / Feito* ligado ao Google Tasks e à Agenda (dias e agendas à escolha). Coleção `kanban_google_estado`. Precisa da conta Google |
| **Saúde: Hidratação** `saude-hidratacao` | saúde | Contador de água com meta diária, histórico de 7 dias e **lembrete recorrente** por notificação (o servidor avisa mesmo com o Studio fechado). Coleção `saude_agua` |
| **Kanban** `kanban` | produtividade | Quadro em colunas com arrastar-e-soltar, prioridade e prazo; a orquestração *Kanban: planejador* quebra um objetivo em cartões. Coleção `kanban_cartoes` |
| **Google Workspace** `google-workspace` | integração | Agenda, Gmail e Tasks num painel: resumo do dia, agenda, tarefas (criar e concluir) e e-mails. *Experimental*: o formato das respostas varia entre servidores |
| **CRM** `crm` | vendas | Funil de negócios com arrastar-e-soltar, base de contatos e indicadores; a orquestração *CRM: analista* sugere follow-ups. Coleções `crm_contatos`, `crm_negocios` |
| **ERP leve** `erp-lite` | negócios | Produtos, estoque e pedidos com indicadores de faturamento; o estoque baixa ao criar um pedido e volta ao cancelar; *ERP: reposição* sugere compras. Coleções `erp_produtos`, `erp_pedidos` |
| **Notas** `notas` | produtividade | Caderno com busca, tags, notas fixadas e editor com salvamento explícito; *Notas: resumir* resume ou extrai ações. Coleção `notas_itens` |

Os pacotes com orquestração (Kanban, CRM, ERP, Notas, Workspace) pedem, de forma **opcional**, um provedor de IA; sem ele os componentes funcionam e só a parte de agente fica desligada.

## Instalar, conectar e desinstalar

1. **Biblioteca → Instalar.** Cria as coleções, os componentes, as orquestrações e as páginas (com *rollback* se algo falhar no meio). Componentes de pacotes **da biblioteca** já vêm aprovados (o código é do repositório); os de pacotes **criados por agente** esperam a sua aprovação.
2. **Conexões.** Se o pacote pede uma ferramenta (por exemplo *Calendário: listar eventos*), escolha, entre as ferramentas dos servidores MCP conectados, qual usar. O Studio sugere pelo nome. O mapeamento resolve os `@id` nas permissões dos componentes e nos nós de agente.
3. **Desinstalar** remove componentes, páginas e orquestrações do pacote. Os **dados** só são apagados se você marcar essa opção.

Via API: `POST /packages/:id/install`, `PUT /packages/:id/connections`, `DELETE /packages/:id?dropData=true` ([API.md](API.md#pacotes)).

## Padrão de fábrica

Numa instalação **nova** (banco totalmente vazio: nenhum componente, página, orquestração nem pacote), o servidor instala sozinho, **uma única vez**:

`rotina-estudo` → `kanban-google` → `saude-hidratacao` → `kanban` → `google-workspace`

A ordem importa: a primeira página do primeiro pacote (*Rotina*) vira a página inicial do Dashboard. Os componentes já vêm aprovados.

- Um banco que **já tem dados nunca é alterado sozinho**.
- Para reinstalar o que faltar (depois de apagar alguma coisa, ou depois de adicionar um pacote à lista): `pnpm factory:restore` ou `POST /factory/restore`. Não altera nada já instalado.
- `AGENT_CANVAS_NO_FACTORY=1` desliga a instalação automática.
- A lista fica em `FACTORY_PACKAGES`, em `packages/server/src/packages/factory.service.ts`.

> **Atualizações de pacote não se propagam sozinhas.** Se o repositório mudar um pacote (novos campos, novos componentes), quem já o instalou continua com a versão instalada. O esquema de coleções pode ser ajustado com `PATCH /collections/:nome` (só o esquema; os registros ficam); componentes podem ser reinstalados desinstalando e instalando de novo.

## Criando um pacote

### Pelo Claude

Peça (“crie um pacote para controle de gastos”): o Claude monta as peças e usa `save_package` (a definição vira uma entrada na Biblioteca) e `install_package`. Ele descobre o formato em `list_packages` (campo `exemplo`).

### Por arquivos (para o repositório)

Uma pasta em `packages/server/src/packages/library/<id>/` com o `manifest.json` e os arquivos dos componentes (`.html`, `.css`, `.js`). O servidor relê a pasta a cada 2 s: instale pela Biblioteca e itere. Copie o pacote `kanban/` como ponto de partida.

Para transformar um pacote criado pelo Claude em pacote do repositório:

```bash
pnpm export:package <id>                 # grava em packages/server/src/packages/library/<id>/
node scripts/export-package.mjs <id> --drop-custom   # depois apaga a definição "criada" do banco (evita duplicar na Biblioteca)
```

Para torná-lo padrão de fábrica, acrescente o `id` em `FACTORY_PACKAGES`.

### Formato do manifesto

```jsonc
{
  "id": "meu-pacote", "name": "Meu pacote", "description": "…", "category": "produtividade",
  "version": "1.0.0", "experimental": false,

  "requires": [                                   // o que o pacote pede ao usuário
    { "id": "ia", "kind": "ai", "label": "Provedor de IA", "optional": true },
    { "id": "agenda", "kind": "tool", "label": "Listar eventos",
      "hint": "Ferramenta do MCP que lista eventos", "match": ["calendar", "event"], "optional": true }
  ],

  "collections": [                                // esquema dos dados (campos: text, longtext, number,
    { "name": "x_itens", "label": "Itens",        //   date, boolean, select, relation; default; required)
      "fields": [ { "name": "titulo", "type": "text", "required": true },
                  { "name": "criado", "type": "date", "default": "today" } ] }
  ],

  "blocks": [                                     // componentes
    { "key": "lista", "name": "Lista", "htmlFile": "lista.html", "cssFile": "lista.css", "jsFile": "lista.js",
      "permissions": { "read": ["col:x_itens"], "write": ["col:x_itens"],
                       "tools": ["@agenda"], "agents": ["assistente"] },
      "refreshSeconds": 0 }
  ],

  "canvases": [ { "key": "assistente", "name": "Assistente", "nodes": [], "edges": [] } ],

  "pages": [ { "name": "Itens", "layout": [ { "blockKey": "lista", "x": 0, "y": 0, "w": 12, "h": 10 } ] } ],

  "seed": { "x_itens": [ { "titulo": "Exemplo" } ] }  // registros de exemplo (opcional)
}
```

- `"@agenda"` em `permissions.tools` (ou em `tools` de um nó de agente) é resolvido para a ferramenta que o usuário conectar ao requisito `agenda`; se não conectar, sai da lista. O componente a chama com `ctx.config.tools.agenda`.
- `"agents": ["assistente"]` é a `key` de um canvas do pacote; ao instalar vira o id real.
- Coleções existentes com o mesmo nome são reaproveitadas, não recriadas; o `seed` só é gravado numa coleção **vazia** (até 200 registros por coleção).

### Regras do lint para pacotes

O lint dos componentes vale para pacotes ([COMPONENTES.md](COMPONENTES.md#lint-avisos-ao-salvar)): só classes `ac-*` e variáveis `--ac-*`, sem cor fixa, permissões exatas, dados em coleções, estado de tela em `ctx.store`. Depois de instalar, `GET /blocks/<id>/lint` deve devolver `{"warnings":[]}`. O teste `pnpm test:factory` confere isso para todos os componentes de fábrica.
