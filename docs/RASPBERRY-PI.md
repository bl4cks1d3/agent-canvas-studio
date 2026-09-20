# Agent Canvas no Raspberry Pi

## O que roda em um Raspberry Pi 2 Model B (e o que não roda)

O Pi 2 B tem processador **ARM de 32 bits (ARMv7)** e **1 GB de RAM**. Isso decide o que funciona:

| Peça | No Pi 2 B | Por quê |
|---|---|---|
| Servidor + app web (dashboards, componentes, bibliotecas, dados, notificações, lembretes) | **Roda** | Node 22 tem versão oficial `linux-armv7l`. Em repouso cada processo usa cerca de 90 MB (medido no PC) |
| Padrão de fábrica (bibliotecas, componentes, páginas) | **Vem instalado** | O servidor instala sozinho na primeira subida com o banco vazio |
| Provedores de IA por HTTP (Groq, Gemini, Anthropic) | **Roda** | São só chamadas de rede |
| Compilar o app web (`next build`) | **Não** | Precisa de bem mais que 1 GB. Por isso você compila no PC (`pnpm pack:pi`) e leva pronto |
| **Claude Code** no Pi | **Não** | Exige processador x64 ou ARM64 e 4 GB de RAM ([requisitos](https://code.claude.com/docs/en/setup)). Use o Claude Code no **seu PC** (veja abaixo) |
| Terminal embutido no app (`node-pty`) | **Não** (32 bits) | O `node-pty` só tem versão para x64 e ARM64. O painel de terminal mostra "serviço de terminal não responde" |
| Conta Google (`workspace-mcp` via `uvx`) | **Não testado** | É um servidor Python; no ARMv7 algumas dependências podem precisar ser compiladas (lento, pode falhar). Se falhar, o resto do Studio segue normal |
| Notificação do sistema (modo desktop) | **Parcial** | No Linux usa `notify-send` (sem som do sistema). O som dentro do Studio (navegador) funciona |

Se o seu Pi 2 for a revisão **v1.2** e você instalar um sistema de **64 bits**, o terminal embutido também passa a funcionar; o Claude Code continua exigindo 4 GB.

> Tudo aqui foi testado no PC (empacotar, extrair numa pasta limpa, instalar só as dependências de produção e subir o servidor e o app web a partir dos arquivos compilados). **Não foi testado num Raspberry Pi de verdade**: o `install-on-pi.sh` foi conferido com `bash -n` e `--dry-run`.

## Passo a passo

### 1. No PC: gerar o pacote

```bash
pnpm pack:pi
```

Compila tudo e cria `dist-pi/agent-canvas-pi.tar.gz` (menos de 1 MB, sem `node_modules`). O app web é compilado numa pasta própria (`.next-pi`), então **não** atrapalha o `pnpm dev` que estiver aberto.

### 2. Levar para o Pi e instalar

**Opção A — baixar direto do GitHub (release, sem precisar do PC):**

```bash
cd ~
curl -fL -o agent-canvas-pi.tar.gz https://github.com/bl4cks1d3/agent-canvas-studio/releases/latest/download/agent-canvas-pi.tar.gz
curl -fL -o agent-canvas-pi.tar.gz.sha256 https://github.com/bl4cks1d3/agent-canvas-studio/releases/latest/download/agent-canvas-pi.tar.gz.sha256
sha256sum -c agent-canvas-pi.tar.gz.sha256          # deve mostrar: agent-canvas-pi.tar.gz: OK
tar xzf agent-canvas-pi.tar.gz && cd agent-canvas
bash scripts/pi/install-on-pi.sh
```

**Opção B — copiar do PC** (o que você acabou de gerar no passo 1):

```bash
scp dist-pi/agent-canvas-pi.tar.gz pi@raspberrypi.local:~/
ssh pi@raspberrypi.local
tar xzf agent-canvas-pi.tar.gz && cd agent-canvas && bash scripts/pi/install-on-pi.sh
```

Não use `sudo` no `tar` nem no instalador (ele chama o `sudo` só onde precisa).

O instalador: confere a arquitetura e a memória, instala o **Node 22** (baixa da nodejs.org e confere o SHA-256) se faltar, instala só as dependências de produção (`pnpm install --prod --frozen-lockfile`), cria o `.env`, e registra dois serviços do **systemd** (`agent-canvas-server` e `agent-canvas-web`) que sobem no boot. Ao final mostra quantos pacotes de fábrica foram instalados.

Opções (depois de `bash scripts/pi/install-on-pi.sh`): `--dry-run` (só mostra), `--no-service` (você inicia na mão), `--no-node`, `--user-service` (serviços do seu usuário, necessário para notificação com tela), `--uninstall`.

Abra `http://localhost:5200` no navegador **do Pi**. Para deixar como painel: `chromium-browser --kiosk http://localhost:5200` no autostart do desktop.

### 3. Acessar do seu PC (sem abrir a rede)

A API do Studio **não tem senha** e por isso escuta só em `127.0.0.1` (o app web também). Para usar do PC, abra um túnel SSH:

```bash
ssh -L 5200:localhost:5200 -L 5100:localhost:5100 pi@raspberrypi.local
```

e abra `http://localhost:5200` no PC. (`SERVER_HOST=0.0.0.0` no `.env` expõe a API na rede local: não recomendado.)

### 4. Claude Code do PC controlando o Studio do Pi

Com o túnel aberto (porta 5100), o Claude Code do PC fala com o Studio do Pi:

```bash
node scripts/install-mcp.mjs --url http://localhost:5100
```

Ou seja, o MCP `agent-canvas` roda no PC e usa o túnel. Se o Studio do PC também estiver ligado, use portas diferentes (`-L 5101:localhost:5100` e `--url http://localhost:5101`).

## Chaves, conta Google e dados

- **Chaves de IA e conta Google**: cadastre na aba **Configurações** do Studio no Pi (ficam no `.env` do Pi, com permissão 600). Não copie o `.env` do PC sem necessidade.
- **Login do Google**: o token fica com o servidor MCP do Google (pasta do usuário do Pi). No Pi é preciso autorizar de novo; o login redireciona para `localhost:8000`, então faça pelo navegador do próprio Pi ou com o túnel `-L 8000:localhost:8000`.
- **Levar os dados do PC**: pare os serviços e copie `data/agent-canvas.db` (o arquivo do banco) para `data/` no Pi. **Atenção**: o padrão de fábrica só se instala com o banco **vazio**. Se você copiar o banco do PC, ele traz o que estiver lá (inclusive cópias soltas de componentes). Para começar limpo, não copie nada e use `bash scripts/pi/install-on-pi.sh`.
- Para reinstalar o padrão de fábrica que faltar: `node scripts/factory-restore.mjs` (não apaga nada).

## Desempenho e problemas comuns

- **Pouca memória**: aumente o swap para 1 GB (`CONF_SWAPSIZE=1024` em `/etc/dphys-swapfile`). Os serviços já limitam o heap do Node (256 MB o servidor, 384 MB o app web).
- **Logs**: `journalctl -u agent-canvas-server -f` (com `--user-service`: `journalctl --user -u ...`).
- **Reiniciar**: `sudo systemctl restart agent-canvas-server agent-canvas-web`.
- **Atualizar**: baixe/gere o pacote novo, pare os serviços (`sudo systemctl stop agent-canvas-web agent-canvas-server`), extraia por cima (o `data/` e o `.env` não fazem parte do pacote), rode `bash scripts/pi/install-on-pi.sh` de novo e ele reinicia tudo.
- **Publicar uma versão nova (no PC)**: `pnpm pack:pi`, depois `gh release create vX.Y.Z dist-pi/agent-canvas-pi.tar.gz dist-pi/agent-canvas-pi.tar.gz.sha256 --title vX.Y.Z --notes "..."`.
