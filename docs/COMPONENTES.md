# Escrevendo componentes

Um **componente** (no código, *bloco*) é um pedacinho de interface (HTML + CSS + JS) que vive numa célula da grade de uma página do dashboard. O Claude escreve componentes para você, mas você também pode escrever ou editar (aba **Componentes**). Este documento é a referência do que existe dentro do componente.

## Anatomia

```jsonc
{
  "name": "Lista de tarefas",
  "description": "opcional",
  "html": "<div id=\"lista\"></div>",          // vai dentro de <div id="root">
  "css": ".linha { display: flex; gap: 8px }",
  "js": "studio.main(async (ctx) => { … })",   // SEMPRE começa com studio.main
  "permissions": {
    "read":  ["col:tarefas"],                    // coleções que pode ler
    "write": ["col:tarefas"],                    // coleções que pode criar/editar/apagar
    "tools": ["notify"],                         // ferramentas que pode chamar (nome exato)
    "agents": ["<id do canvas>"]                 // orquestrações que pode disparar ("*" = todas)
  },
  "refreshSeconds": 0                            // 0 = só ao abrir; ou 5 a 3600
}
```

Exemplo mínimo e completo:

```js
studio.main(async (ctx) => {
  const tarefas = ctx.records("tarefas");
  const rows = await tarefas.list({ sort: "createdAt", order: "desc", limit: 50 });

  ctx.root.querySelector("#lista").innerHTML = rows
    .map((r) => `<div class="ac-row"><input type="checkbox" data-id="${ctx.escape(r.id)}" ${r.feito ? "checked" : ""}> ${ctx.escape(r.titulo)}</div>`)
    .join("");

  // o listener fica em ctx.root, que sobrevive entre execuções: registre UMA vez (senão cada atualização soma mais um)
  if (!ctx.root.dataset.pronto) {
    ctx.root.dataset.pronto = "1";
    ctx.root.addEventListener("change", async (e) => {
      const id = e.target.dataset && e.target.dataset.id;
      if (id) { await tarefas.update(id, { feito: e.target.checked }); ctx.refresh(); }
    });
  }
});
```

`studio.main` é executado ao abrir e **de novo sempre que o componente precisa atualizar** (veja *Atualização automática*). Por isso ele deve montar a tela do zero a cada execução e registrar *listeners* em `ctx.root` uma única vez, como acima (o `innerHTML` é refeito, mas `ctx.root` continua o mesmo elemento).

## O objeto `ctx`

| API | O que faz |
|---|---|
| `ctx.root` | O elemento `#root`, onde está o seu HTML |
| `ctx.escape(texto)` | Escapa HTML. **Use sempre** ao colocar dados de registros em `innerHTML` |
| `ctx.config` | Configuração do pacote (`agents`, `tools` mapeadas). `{}` fora de pacotes |
| `ctx.records(nome)` | `list(params)`, `create(corpo)`, `update(id, corpo)`, `remove(id)`. Só o que `permissions.read`/`write` liberar |
| `ctx.store.get(chave, padrão)` / `set` / `remove` / `all()` | Estado próprio do componente, persistente (aba escolhida, filtros, preferências) |
| `ctx.tool(nome, args)` | Chama uma ferramenta de `permissions.tools` (embutidas e de servidores MCP) |
| `ctx.agent.run(idOuChave, texto)` | Executa uma orquestração de `permissions.agents`; devolve `{ status, result, error }` |
| `ctx.inbox()` | Itens entregues por um nó *Componente* de uma orquestração |
| `ctx.ui.toast(texto, tipo)` | Aviso rápido (`info`, `ok`, `warn`, `error`) |
| `ctx.ui.confirm(texto, {confirmLabel, cancelLabel, danger})` | Confirmação; devolve `true`/`false` |
| `ctx.ui.modal({title, html, css, js, size, width, height})` | Abre um modal (um iframe isolado que herda as permissões); `size` é `sm`, `md` ou `lg`. Devolve o valor passado a `ctx.close(valor)` dentro do modal. Até 2 níveis |
| `ctx.close(valor)` | Só dentro de um modal: fecha e devolve o valor |
| `ctx.refresh()` | Roda o `studio.main` de novo agora |
| `studio.main(fn)` | Registra a função principal |

### `ctx.records(nome).list(params)`

Parâmetros: `campo: valor` (igualdade em qualquer campo), `q` (busca em todos os campos), `sort` (um campo, `createdAt` ou `updatedAt`), `order` (`asc`/`desc`), `limit` (até 1000, padrão 500), `offset`. Cada registro traz também `id`, `createdAt` e `updatedAt` (UTC).

`create` e `update` validam contra o esquema da coleção: campo desconhecido, tipo errado, opção inválida ou **id de relação inexistente** viram erro (`400` com a explicação). Campos com `default` (`today`, `now`, `time`) se preenchem sozinhos ao criar, então **não os envie**. Enviar `null` num campo o limpa. `remove` manda o registro para a **lixeira** (30 dias).

### `ctx.store`

Chaves `[A-Za-z0-9_.:-]{1,60}`; até 64 KB por valor e 100 chaves por componente. Vale para o componente, em todas as páginas onde ele aparecer. Use para **estado de tela**; dados de verdade vão em coleções.

## Atualização automática

O componente reexecuta `studio.main` quando:

1. **os dados mudam**: o Claude, um agente, um lembrete, outra aba ou o próprio usuário gravou numa coleção listada em `permissions.read` (ou a caixa de entrada do componente mudou). Acontece em cerca de 1 segundo, com no mínimo 2 s entre execuções, para não entrar em laço se o componente grava a cada execução;
2. **o código muda** (o Claude editou): o iframe é recriado;
3. `refreshSeconds` está entre 5 e 3600: reexecuta nesse intervalo (útil para dados que vêm de fora do banco, como Google Agenda);
4. o componente chama `ctx.refresh()`.

## Design system

O visual vem do app, não do componente: as classes `ac-*` e as variáveis `--ac-*` já estão injetadas em todo componente e modal, em claro e escuro, e obedecem ao **tema** (cor de destaque, cantos, fonte, densidade). Componentes de origens diferentes ficam consistentes.

**Variáveis:** `--ac-accent`, `--ac-accent-soft`, `--ac-fg`, `--ac-muted`, `--ac-border`, `--ac-surface`, `--ac-bg`, `--ac-hover`, `--ac-track`, `--ac-ok`, `--ac-warn`, `--ac-danger`, `--ac-radius`, `--ac-gap`, `--ac-fs`.

| Classe | Uso |
|---|---|
| `ac-stack` / `ac-row` / `ac-row-between` / `ac-row-end` / `ac-wrap` / `ac-grow` | Layout em coluna, linha, com espaço entre, alinhado ao fim, com quebra, ocupando o resto |
| `ac-grid` | Grade responsiva (`auto-fit`, mínimo de 150 px) |
| `ac-card` | Caixa com borda e fundo |
| `ac-title` / `ac-subtitle` / `ac-muted` / `ac-big` | Textos: título, rótulo em caixa alta, apagado, número grande |
| `ac-btn` (+ `-primary`, `-danger`, `-ghost`, `-sm`) | Botões |
| `ac-input` / `ac-select` / `ac-textarea` / `ac-field` | Campos de formulário (`ac-field` = rótulo + campo) |
| `ac-badge` (+ `-ok`, `-warn`, `-accent`, `-danger`) | Etiquetas |
| `ac-bar` | Barra de progresso: `<div class="ac-bar"><i style="width:60%"></i></div>` |
| `ac-table`, `ac-list` | Tabela e lista com separadores |
| `ac-tabs` / `ac-tab` (`.active`) | Abas |
| `ac-empty`, `ac-error`, `ac-danger`, `ac-link` | Estado vazio, erro, texto de perigo, link clicável |
| `ac-modal`, `ac-modal-title`, `ac-modal-actions`, `ac-modal-backdrop` | Estrutura dos modais |

Regras: use **só** essas classes e variáveis para cor e fonte (o *lint* avisa sobre `#hex`, `rgb()` e `font-family`). CSS próprio só para layout (grid, flex, tamanhos). Componentes vivem em células redimensionáveis (4 a 12 colunas): seja responsivo (`grid` com `auto-fit`, `min-width: 0`, sem larguras fixas).

## Permissões, aprovação e versões

- **Aprovação.** Componentes criados por agente ou pela API (`source: "agent"`) **nascem sem aprovação** e mostram *Aguardando aprovação*. Só o usuário aprova (botão no Dashboard, em Componentes ou no painel *Criar com Claude*). Alterar `html`, `css`, `js` ou `permissions` **revoga** a aprovação. Componentes dos pacotes de fábrica (código do repositório) já vêm aprovados.
- **Permissões conferidas a cada chamada**, na página pai (fora do iframe). Coleção inexistente em `permissions` é recusada (`400`).
- **Versões.** Toda alteração de código ou permissões guarda a versão anterior (30 por componente). Componentes → *Versões* → restaurar (isso também revoga a aprovação).
- **Concorrência.** Editar com dados velhos dá `409`: recarregue e tente de novo.

## Isolamento (o que **não** existe no componente)

O componente roda em `<iframe sandbox="allow-scripts">` (origem opaca) com uma CSP fechada:

- **sem rede**: `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` e recursos externos (`http://…`) são bloqueados. Use `ctx.records`, `ctx.tool` ou `ctx.agent.run`;
- **sem armazenamento do navegador**: `localStorage`, `sessionStorage`, `indexedDB`, cookies. Use `ctx.store`;
- **sem `alert`/`confirm`/`prompt`**: use `ctx.ui.*`;
- **sem `<script>` no HTML nem handlers inline** (`onclick="…"`): scripts só rodam com *nonce*; use `addEventListener`;
- links não navegam;
- limite de **120 chamadas por 5 segundos** por componente.

## Lint (avisos ao salvar)

Salvar nunca é bloqueado por avisos, mas eles aparecem para você e para o Claude (que os corrige):

- falta `studio.main(…)`;
- rede, armazenamento do navegador, `alert/confirm/prompt`, handler inline, `<script>` no HTML, recurso externo;
- **cor fixa** (`#hex`, `rgb()`, `hsl()`) ou `font-family` fixa;
- usa coleção **sem permissão** em `read`; grava em coleção que só tem leitura; chama ferramenta sem permissão em `tools`;
- componente maior que 60 000 caracteres.

`GET /blocks/<id>/lint` devolve os avisos atuais. Um componente saudável devolve `{"warnings":[]}`.

## Dicas

- **Dados consistentes:** declare exatamente o que usa; o mesmo campo tem o mesmo tipo em todos os componentes; calcule totais a partir dos registros em vez de guardar valores derivados.
- **Idempotência:** ao criar coisas por código, procure por nome antes e atualize em vez de duplicar.
- **Lembretes e agendamentos:** não crie timers no componente (morrem quando a página fecha). Use a coleção `sistema_lembretes` ([STUDIO.md](STUDIO.md#notificações-e-lembretes)).
- **Google e sistemas externos:** só por ferramentas MCP ([GOOGLE.md](GOOGLE.md)); prefira as ferramentas estruturadas (`google_tasks_list`, …) que devolvem JSON.
- **Testar no navegador:** o iframe real tem origem opaca e não dá para inspecionar o DOM dele. O *harness* de teste está em [DEVELOPMENT.md](DEVELOPMENT.md#testando-um-componente-no-navegador).
