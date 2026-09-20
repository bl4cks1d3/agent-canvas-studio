#!/usr/bin/env bash
# Instala o Agent Canvas Studio no Raspberry Pi (ou qualquer Linux) a partir do pacote gerado no PC por "pnpm pack:pi".
#
#   ./scripts/pi/install-on-pi.sh                   instala Node 22 (se faltar), dependências e os serviços (systemd)
#   ./scripts/pi/install-on-pi.sh --user-service    serviços do SEU usuário (necessário para notificação desktop/kiosk com tela)
#   ./scripts/pi/install-on-pi.sh --no-service      só instala; você inicia na mão
#   ./scripts/pi/install-on-pi.sh --no-node         não instala o Node (você já tem o 22.5 ou mais novo)
#   ./scripts/pi/install-on-pi.sh --dry-run         mostra o que faria, sem alterar nada
#   ./scripts/pi/install-on-pi.sh --uninstall       remove os serviços (não apaga seus dados)
#
# O padrão de fábrica (bibliotecas, componentes e páginas) se instala sozinho na primeira subida do servidor.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NO_NODE=0; NO_SERVICE=0; USER_SERVICE=0; DRY=0; UNINSTALL=0
for a in "$@"; do
  case "$a" in
    --no-node) NO_NODE=1 ;;
    --no-service) NO_SERVICE=1 ;;
    --user-service) USER_SERVICE=1 ;;
    --dry-run) DRY=1 ;;
    --uninstall) UNINSTALL=1 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "opção desconhecida: $a"; exit 2 ;;
  esac
done

say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
ok()   { printf '  ✔ %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*"; }
die()  { printf '\n✖ %s\n' "$*" >&2; exit 1; }
run()  { if [ "$DRY" = 1 ]; then printf '  [dry-run] %s\n' "$*"; else "$@"; fi; }

SUDO=""
if [ "$(id -u)" -ne 0 ]; then SUDO="sudo"; fi

# ------------------------------------------------------------------ --uninstall
if [ "$UNINSTALL" = 1 ]; then
  say "Removendo os serviços"
  if [ "$USER_SERVICE" = 1 ]; then
    run systemctl --user disable --now agent-canvas-web.service agent-canvas-server.service || true
    run rm -f "$HOME/.config/systemd/user/agent-canvas-web.service" "$HOME/.config/systemd/user/agent-canvas-server.service"
    run systemctl --user daemon-reload
  else
    run $SUDO systemctl disable --now agent-canvas-web.service agent-canvas-server.service || true
    run $SUDO rm -f /etc/systemd/system/agent-canvas-web.service /etc/systemd/system/agent-canvas-server.service
    run $SUDO systemctl daemon-reload
  fi
  ok "Serviços removidos. Seus dados (data/ e .env) ficaram em $DIR."
  exit 0
fi

[ -f "$DIR/packages/server/dist/main.js" ] || die "Não achei packages/server/dist/main.js em $DIR. Este script roda a partir do pacote gerado por 'pnpm pack:pi' no PC (o Pi não compila o projeto)."

# ------------------------------------------------------------------ 1. arquitetura
ARCH="$(uname -m)"
case "$ARCH" in
  armv7l)  NODE_ARCH="armv7l"; TERMINAL_OK=0 ;;
  aarch64|arm64) NODE_ARCH="arm64"; TERMINAL_OK=1 ;;
  x86_64)  NODE_ARCH="x64"; TERMINAL_OK=1 ;;
  armv6l)  die "Raspberry Pi Zero/1 (armv6l): o Node 22 não tem versão para esta arquitetura." ;;
  *)       die "Arquitetura não suportada: $ARCH" ;;
esac
say "Sistema: $ARCH ($(. /etc/os-release 2>/dev/null && echo "${PRETTY_NAME:-Linux}" || echo Linux))"
MEM_MB=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo 0)
ok "Memória: ${MEM_MB} MB"
if [ "$MEM_MB" -gt 0 ] && [ "$MEM_MB" -lt 1500 ]; then
  warn "Pouca memória: se o Pi travar, aumente o swap (sudo dphys-swapfile swapoff; edite CONF_SWAPSIZE=1024 em /etc/dphys-swapfile; sudo dphys-swapfile setup; sudo dphys-swapfile swapon)."
fi
if [ "$TERMINAL_OK" = 0 ]; then
  warn "ARM de 32 bits: o terminal embutido (node-pty) e o Claude Code não têm versão para esta arquitetura. O restante funciona. Use o Claude Code no seu PC (docs/RASPBERRY-PI.md)."
fi

# ------------------------------------------------------------------ 2. Node 22.5+
node_ok() { command -v node >/dev/null 2>&1 && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=5)?0:1)'; }

install_node() {
  command -v curl >/dev/null 2>&1 || die "Preciso do curl (sudo apt install curl)."
  local base="https://nodejs.org/dist/latest-v22.x" ext="tar.xz"
  command -v xz >/dev/null 2>&1 || ext="tar.gz"
  local sums file sha tmp dest
  sums="$(curl -fsSL "$base/SHASUMS256.txt")" || die "Não consegui baixar a lista de versões do Node."
  file="$(printf '%s\n' "$sums" | awk -v s="linux-${NODE_ARCH}.${ext}" '$2 ~ s"$" {print $2; exit}')"
  sha="$(printf '%s\n' "$sums" | awk -v f="$file" '$2==f {print $1; exit}')"
  [ -n "$file" ] || die "O Node 22 não publica versão linux-${NODE_ARCH}."
  dest="$HOME/.local/node22"
  say "Instalando $file em $dest"
  if [ "$DRY" = 1 ]; then printf '  [dry-run] baixar %s/%s, conferir SHA-256 e extrair\n' "$base" "$file"; return; fi
  tmp="$(mktemp -d)"
  curl -fSL "$base/$file" -o "$tmp/$file"
  echo "$sha  $tmp/$file" | sha256sum -c - >/dev/null || die "SHA-256 do Node não confere: download corrompido."
  ok "SHA-256 conferido"
  rm -rf "$dest"; mkdir -p "$dest"
  tar -xf "$tmp/$file" -C "$dest" --strip-components=1
  rm -rf "$tmp"
}

say "Node.js"
if node_ok; then
  ok "Node $(node -v) já serve"
elif [ "$NO_NODE" = 1 ]; then
  die "Node 22.5 ou mais novo é obrigatório (o Studio usa o SQLite embutido) e --no-node foi pedido."
else
  install_node
  export PATH="$HOME/.local/node22/bin:$PATH"
fi
[ "$DRY" = 1 ] && NODE_BIN="$(command -v node || echo "$HOME/.local/node22/bin/node")" || NODE_BIN="$(command -v node)"
ok "Node em $NODE_BIN"

# ------------------------------------------------------------------ 3. pnpm e dependências
say "Dependências (só as de produção)"
PNPM_VERSION="$(grep -o '"packageManager": *"pnpm@[^"]*"' "$DIR/package.json" | sed 's/.*pnpm@//; s/"//')"
if ! command -v pnpm >/dev/null 2>&1; then
  run corepack enable
  run corepack prepare "pnpm@${PNPM_VERSION:-10.28.2}" --activate
fi
cd "$DIR"
FILTER=()
[ "$TERMINAL_OK" = 0 ] && FILTER=(--filter '!@agent-canvas/terminal')
run pnpm install --prod --frozen-lockfile "${FILTER[@]}"

# ------------------------------------------------------------------ 4. .env
say "Configuração"
if [ -f "$DIR/.env" ]; then ok ".env já existe (mantido)"; else run cp "$DIR/.env.example" "$DIR/.env"; ok ".env criado: cadastre as chaves de IA/Google na aba Configurações do app"; fi
run chmod 600 "$DIR/.env"
run mkdir -p "$DIR/data"

# ------------------------------------------------------------------ 5. serviços
render() { # render <modelo> <destino>
  local userline=""
  [ "$USER_SERVICE" = 0 ] && userline="User=$(id -un)"
  local wanted="multi-user.target"; [ "$USER_SERVICE" = 1 ] && wanted="default.target"
  sed -e "s|@DIR@|$DIR|g" -e "s|@NODE@|$NODE_BIN|g" -e "s|@USERLINE@|$userline|g" -e "s|@WANTED@|$wanted|g" "$1"
}

if [ "$NO_SERVICE" = 1 ]; then
  say "Serviços: pulado (--no-service)"
  cat <<EOF
Para iniciar na mão (dois terminais):
  cd $DIR/packages/server && $NODE_BIN dist/main.js
  cd $DIR/apps/web && NEXT_DIST_DIR=.next-pi $NODE_BIN node_modules/next/dist/bin/next start -p 5200 -H 127.0.0.1
Depois abra http://localhost:5200 no navegador do Pi.
EOF
  exit 0
fi

say "Serviços (systemd)"
if [ "$USER_SERVICE" = 1 ]; then
  UNITDIR="$HOME/.config/systemd/user"; SC=(systemctl --user)
  run mkdir -p "$UNITDIR"
  run $SUDO loginctl enable-linger "$(id -un)"
else
  UNITDIR="/etc/systemd/system"; SC=($SUDO systemctl)
fi
for u in agent-canvas-server agent-canvas-web; do
  if [ "$DRY" = 1 ]; then
    printf '  [dry-run] gerar %s/%s.service a partir de %s.service.tmpl\n' "$UNITDIR" "$u" "$u"
  elif [ "$USER_SERVICE" = 1 ]; then
    render "$DIR/scripts/pi/$u.service.tmpl" > "$UNITDIR/$u.service"
  else
    render "$DIR/scripts/pi/$u.service.tmpl" | $SUDO tee "$UNITDIR/$u.service" >/dev/null
  fi
done
run "${SC[@]}" daemon-reload
run "${SC[@]}" enable --now agent-canvas-server.service agent-canvas-web.service

if [ "$DRY" = 0 ]; then
  say "Esperando o servidor subir"
  for i in $(seq 1 60); do
    if curl -fs "http://127.0.0.1:5100/health" >/dev/null 2>&1; then
      ok "Servidor no ar"
      curl -fs "http://127.0.0.1:5100/factory" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const f=JSON.parse(s);console.log("  padrão de fábrica: "+f.packages.filter(p=>p.installed).length+"/"+f.packages.length+" pacotes instalados")})' || true
      break
    fi
    sleep 2
  done
fi

cat <<EOF

Pronto. No navegador do Pi: http://localhost:5200  (dashboards, bibliotecas e componentes de fábrica já instalados)
Para usar de outro computador: ssh -L 5200:localhost:5200 -L 5100:localhost:5100 $(id -un)@$(hostname).local  e abra http://localhost:5200
Logs:      journalctl ${USER_SERVICE:+--user }-u agent-canvas-server -f
Reiniciar: ${SC[*]} restart agent-canvas-server agent-canvas-web
Remover:   ./scripts/pi/install-on-pi.sh --uninstall${USER_SERVICE:+ --user-service}
EOF
