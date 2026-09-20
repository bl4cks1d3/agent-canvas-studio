# Segurança

O Agent Canvas Studio é feito para **uso pessoal, na sua própria máquina**. O código dos componentes e as ordens dos agentes vêm de IA (e de terceiros, se você importar pacotes), então o desenho parte de uma regra: **nada que uma IA escreva roda ou altera algo importante sem passar por barreiras que você controla.**

## Modelo em uma página

| O que protegemos | Como |
|---|---|
| Sua **máquina** e a **rede** | Componentes rodam em iframe isolado, **sem rede**. A API e o terminal escutam só em `127.0.0.1`. |
| Suas **chaves** (IA, Google) | Ficam no `.env`; nenhuma resposta da API as devolve; o Claude é instruído a nunca ler o `.env`. |
| **Você decide** o que roda | Componentes de agente nascem **sem aprovação**; alterar código ou permissões revoga. Só você aprova. |
| Seus **dados** | Cada componente só acessa as coleções que suas permissões listam, conferidas a cada chamada. Apagar vai para a lixeira. |
| Sua **conta Google** | Só é alterada por pedido seu; ferramentas que alteram dados pedem confirmação no terminal. |
| **Custos** de IA | O Claude só **simula** orquestrações; a execução ao vivo exige confirmação explícita. |

## Componentes (código de IA)

Cada componente roda em `<iframe sandbox="allow-scripts">`:

- **origem opaca**: sem acesso ao DOM, cookies ou storage do app;
- **CSP fechada** (`default-src 'none'`, `connect-src 'none'`): nenhum `fetch`, WebSocket ou recurso externo;
- **scripts só com *nonce***: o HTML do componente não injeta `<script>` nem handlers inline;
- sem `alert/confirm/prompt`, sem `localStorage`;
- a **única** saída é uma ponte `postMessage` com a página pai, que confere as permissões (`read`, `write`, `tools`, `agents`) **a cada chamada** e limita a **120 chamadas por 5 s**;
- modais são iframes isolados que herdam as permissões do componente (até 2 níveis).

**Aprovação humana.** Um componente criado por agente ou pela API (`source: "agent"`) mostra *Aguardando aprovação* e não executa nada. Alterar `html`, `css`, `js` ou `permissions` revoga a aprovação. O Claude não tem ferramenta para aprovar. Componentes dos pacotes de fábrica são código do repositório (revisado por você) e já vêm aprovados.

**Permissões** para coleção inexistente são recusadas; o *lint* avisa quando o código usa dado ou ferramenta sem permissão.

## API, terminal e rede

- A API escuta em `127.0.0.1` (`SERVER_HOST`); o terminal também. **Não há senha**: quem alcança a porta tem acesso total. Por isso **não exponha 5100 nem 5300 na rede**. Para usar de outro computador, use um túnel SSH (`ssh -L 5200:localhost:5200 -L 5100:localhost:5100 usuario@maquina`).
- O **terminal** é execução remota de código por definição. Além de só loopback, exige `Origin` conhecida (WebSocket não passa por CORS: sem isso qualquer site aberto no navegador conseguiria conectar e digitar comandos) e `Host` conhecido (barra *DNS rebinding*). O navegador só escolhe o **nome** do perfil; comandos, argumentos e pasta saem do servidor.
- Rotas sensíveis da API exigem que a chamada venha **da própria máquina** e de uma **origem conhecida do Studio** (ou sem origem, como `curl`): `/tools/*`, `/builder/*`, `/integrations/*` (chaves de IA, Google, chaves personalizadas), escrita em `/notifications`, `/factory/restore` e `/sync/google-tasks`.
- **Chaves.** Cadastradas na tela Configurações; o servidor grava no `.env` com validação (nome em maiúsculas terminando em `KEY/TOKEN/SECRET/PASSWORD`; valor sem espaços, aspas nem quebras de linha, o que impede injetar outra linha no arquivo) e **nunca** devolve o valor. Variáveis que não são segredo (como `PATH`) não podem ser alteradas por essa tela.
- Links de login do Google: o app só abre URLs de `accounts.google.com`.

### Limitações conhecidas

Seja honesto sobre o que **não** está coberto:

1. **As rotas de dados, componentes, páginas, pacotes e orquestrações da API não conferem a origem** e a API responde a CORS de qualquer origem. Se você abrir um site malicioso **no mesmo navegador enquanto o Studio está rodando**, esse site poderia, em teoria, chamar `http://localhost:5100` (ler dados, alterar registros, **aprovar componentes**, disparar uma orquestração ao vivo com `confirmed: true`). A barreira na prática é que o site precisaria saber que o Studio existe e adivinhar os ids. A correção planejada é restringir CORS e conferir `Origin` nas rotas que gravam. Enquanto isso: **não navegue em sites desconhecidos no mesmo navegador do Studio** enquanto ele estiver aberto, ou use um perfil de navegador só para ele.
2. **Sem autenticação**: qualquer processo local do seu usuário (e qualquer pessoa com acesso à máquina) acessa a API.
3. O app web em desenvolvimento escuta em todas as interfaces (`next dev`); ele só serve a interface, e os dados continuam atrás da API em loopback. Mesmo assim, num Wi-Fi público, mantenha o firewall ligado.

## Claude Code e agentes

- O **construtor** (*Criar com Claude*) roda o Claude Code com `--strict-mcp-config`, **só** o MCP `agent-canvas` liberado (nada de Bash, arquivos ou web), `--permission-mode dontAsk` e limite de 12 minutos.
- O **terminal do Studio** libera sem perguntar apenas leitura, criação e edição de coisas do Studio; o Claude Code **pergunta** antes de apagar, desinstalar, simular/executar canvases e usar ferramentas externas que alteram dados.
- O **agente Claude Code de uma orquestração** usa uma lista curta de ferramentas (`Read,Grep,Glob…`); `Bash` só com `CLAUDE_NODE_ALLOW_BASH=true` e roda apenas quando **você** executa.
- Agentes de IA por HTTP só usam as ferramentas marcadas no nó. As ferramentas de arquivo (`fs_*`) ficam presas à pasta `data/files/`.
- Limites por execução: itens, chamadas a agentes e ferramentas, notificações e tempo ([ORQUESTRACAO.md](ORQUESTRACAO.md#simular-e-executar)).

## Dados

- **Lixeira**: apagar um registro o guarda por 30 dias (máx. 500 por coleção). Esvaziar a lixeira é irreversível e só por pedido explícito.
- **Lote** é atômico (tudo ou nada).
- **Concorrência**: editar com dados velhos retorna `409` (páginas, canvases, componentes).
- **Backup**: copie `data/agent-canvas.db` com o servidor parado ([INSTALACAO.md](INSTALACAO.md#backup)).

## Boas práticas

- Cadastre chaves **só** na tela Configurações; nunca as cole em conversas nem em arquivos do projeto.
- Revise as **permissões** de um componente antes de aprovar: o que ele lê, o que grava, que ferramentas chama.
- Use a **simulação** antes de executar uma orquestração; confira o custo de IA.
- No Google Cloud, deixe o app em modo de teste com **só o seu e-mail** como usuário de teste.
- Mantenha o Node, o `pnpm` e o Claude Code atualizados.

## Reportando um problema de segurança

Abra uma *issue* privada (ou fale diretamente com o mantenedor) descrevendo o cenário, sem publicar exploits. O projeto é de uso pessoal e mantido no tempo livre; não há prazo garantido de resposta.
