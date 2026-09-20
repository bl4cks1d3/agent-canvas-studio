// Design system do Agent Canvas Studio para blocos. E injetado em TODO bloco (e em
// todo modal) automaticamente: o Claude e voce montam telas so com estas
// classes, e o resultado fica com a cara do dashboard.

const DS_RULES = [
  "*{box-sizing:border-box}",
  "html,body{margin:0;height:100%}",
  'body{font:var(--ac-fs,13px)/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;color:var(--ac-fg);background:transparent;padding:12px;overflow:auto}',
  "#root{display:flow-root}",
  /* layout */
  ".ac-stack{display:flex;flex-direction:column;gap:var(--ac-gap,10px)}",
  ".ac-row{display:flex;gap:8px;align-items:center}",
  ".ac-row-between{justify-content:space-between}",
  ".ac-row-end{justify-content:flex-end}",
  ".ac-wrap{flex-wrap:wrap}",
  ".ac-grow{flex:1;min-width:0}",
  ".ac-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:var(--ac-gap,10px)}",
  ".ac-card{border:1px solid var(--ac-border);border-radius:var(--ac-radius);padding:10px 12px;background:var(--ac-surface)}",
  /* texto */
  ".ac-title{font-weight:700;font-size:14px;margin:0 0 8px}",
  ".ac-subtitle{font-weight:600;font-size:12px;letter-spacing:.03em;text-transform:uppercase;color:var(--ac-muted);margin:0 0 6px}",
  ".ac-muted{color:var(--ac-muted)}",
  ".ac-big{font-size:28px;font-weight:800;line-height:1.1}",
  ".ac-link{cursor:pointer}.ac-link:hover{text-decoration:underline}",
  /* botoes */
  ".ac-btn{font:inherit;font-weight:590;cursor:pointer;border:1px solid var(--ac-border);background:transparent;color:var(--ac-fg);border-radius:999px;padding:4px 14px}",
  ".ac-btn:hover:not(:disabled){background:var(--ac-hover)}",
  ".ac-btn:disabled{opacity:.5;cursor:default}",
  ".ac-btn-primary{background:var(--ac-accent);border-color:var(--ac-accent);color:#fff}",
  ".ac-btn-primary:hover:not(:disabled){background:#2569c4}",
  ".ac-btn-danger{color:var(--ac-danger);border-color:var(--ac-danger)}",
  ".ac-btn-sm{padding:1px 9px;font-size:12px}",
  /* formularios */
  ".ac-input,.ac-select,.ac-textarea{font:inherit;width:100%;padding:7px 12px;border:1px solid var(--ac-border);border-radius:10px;background:var(--ac-bg);color:var(--ac-fg)}",
  ".ac-input:focus,.ac-select:focus,.ac-textarea:focus{outline:2px solid var(--ac-accent);outline-offset:-1px}",
  ".ac-textarea{min-height:80px;resize:vertical}",
  ".ac-field{display:flex;flex-direction:column;gap:4px}",
  ".ac-field>label{font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--ac-muted)}",
  /* dados */
  ".ac-badge{display:inline-block;padding:1px 8px;border-radius:99px;background:var(--ac-hover);font-size:11px}",
  ".ac-badge-ok{background:rgba(47,168,79,.16);color:var(--ac-ok)}.ac-badge-warn{background:rgba(217,163,0,.18);color:var(--ac-warn)}.ac-badge-accent{background:var(--ac-accent-soft);color:var(--ac-accent)}",
  ".ac-bar{height:6px;border-radius:99px;background:var(--ac-track);overflow:hidden}",
  ".ac-bar>i{display:block;height:100%;background:var(--ac-accent)}",
  ".ac-table{width:100%;border-collapse:collapse}.ac-table th{text-align:left;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--ac-muted);font-weight:600}",
  ".ac-table th,.ac-table td{padding:6px 8px;border-bottom:1px solid var(--ac-border)}",
  ".ac-list>*{padding:7px 0;border-bottom:1px solid var(--ac-border)}",
  ".ac-tabs{display:flex;gap:4px;border-bottom:1px solid var(--ac-border);margin-bottom:10px}",
  ".ac-tab{font:inherit;cursor:pointer;border:0;background:transparent;padding:6px 12px;color:var(--ac-muted);border-bottom:2px solid transparent}",
  ".ac-tab.active{color:var(--ac-fg);border-bottom-color:var(--ac-accent);font-weight:600}",
  ".ac-badge-danger{background:rgba(217,45,58,.14);color:var(--ac-danger)}",
  ".ac-danger{color:var(--ac-danger)}",
  ".ac-btn-ghost{border-color:transparent}",
  ".ac-empty{color:var(--ac-muted);padding:8px 0}",
  ".ac-error{margin-top:8px;padding:8px 10px;border-radius:8px;background:var(--ac-accent-soft);color:var(--ac-accent);font-size:12px;white-space:pre-wrap}",
  /* modal DENTRO do bloco (cobre so a area do bloco; para modal de tela cheia use ctx.ui.modal) */
  ".ac-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;padding:12px;z-index:10}",
  ".ac-modal{background:var(--ac-bg);border-radius:var(--ac-radius);box-shadow:0 12px 40px rgba(0,0,0,.25);width:100%;max-width:420px;max-height:100%;overflow:auto;padding:14px}",
  ".ac-modal-title{font-weight:700;font-size:15px;margin:0 0 10px}",
  ".ac-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}",
].join("\n");

const LIGHT_VARS =
  ":root{--ac-fg:#1d1d1f;--ac-muted:#6e6e73;--ac-accent:#2f7de1;--ac-accent-soft:#eaf2fd;--ac-danger:#d92d3a;--ac-border:rgba(60,60,67,.16);--ac-surface:#fafafc;--ac-ok:#2fa84f;--ac-warn:#d9a300;--ac-radius:12px;--ac-bg:#fff;--ac-hover:rgba(60,60,67,.08);--ac-track:rgba(60,60,67,.12)}";
const DARK_VARS =
  ":root{color-scheme:dark;--ac-fg:#e6e6e8;--ac-muted:#a3a3aa;--ac-accent:#4c9aff;--ac-accent-soft:rgba(76,154,255,.16);--ac-danger:#ff6b76;--ac-border:rgba(255,255,255,.12);--ac-surface:#262627;--ac-ok:#3ecf6a;--ac-warn:#e0b400;--ac-radius:12px;--ac-bg:#1b1b1c;--ac-hover:rgba(255,255,255,.08);--ac-track:rgba(255,255,255,.12)}";

export type DsTheme = "light" | "dark";

/** Design tokens do Studio (tema salvo no banco): valem para todos os componentes. */
export interface DsTokens {
  accent: string;
  radius: number;
  fontSize: number;
  density: "compact" | "comfortable";
}

/** CSS do design system para o tema (variaveis + regras). Injetado em todo bloco e modal. */
export function dsCss(theme: DsTheme = "light", tokens?: DsTokens): string {
  let over = "";
  if (tokens) {
    const accent = /^#[0-9a-f]{6}$/i.test(tokens.accent) ? tokens.accent : "";
    over =
      ":root{" +
      (accent ? `--ac-accent:${accent};--ac-accent-soft:color-mix(in srgb,${accent} 16%,transparent);` : "") +
      `--ac-radius:${Number(tokens.radius) || 12}px;--ac-gap:${tokens.density === "compact" ? 6 : 10}px;--ac-fs:${Number(tokens.fontSize) || 13}px}`;
  }
  return (theme === "dark" ? DARK_VARS : LIGHT_VARS) + "\n" + DS_RULES + "\n" + over;
}

export const DS_CSS = dsCss("light");

export interface DsComponent {
  id: string;
  name: string;
  html: string;
}

/** Catalogo mostrado no Construtor (aba Componentes): pre-visualizacao + "Inserir". */
export const DS_COMPONENTS: DsComponent[] = [
  { id: "botoes", name: "Botões", html: '<div class="ac-row ac-wrap"><button class="ac-btn">Padrão</button><button class="ac-btn ac-btn-primary">Principal</button><button class="ac-btn ac-btn-danger">Perigo</button><button class="ac-btn ac-btn-sm">Pequeno</button></div>' },
  {
    id: "campos",
    name: "Campos de formulário",
    html: '<div class="ac-stack"><div class="ac-field"><label>Título</label><input class="ac-input" placeholder="Digite…"></div><div class="ac-field"><label>Tipo</label><select class="ac-select"><option>Um</option><option>Dois</option></select></div><div class="ac-field"><label>Notas</label><textarea class="ac-textarea"></textarea></div></div>',
  },
  { id: "cartao", name: "Cartão", html: '<div class="ac-card"><div class="ac-subtitle">Resumo</div><div class="ac-big">42</div><div class="ac-muted">itens</div></div>' },
  { id: "grade", name: "Grade de cartões", html: '<div class="ac-grid"><div class="ac-card"><div class="ac-big">3</div><div class="ac-muted">abertas</div></div><div class="ac-card"><div class="ac-big">1</div><div class="ac-muted">atrasada</div></div></div>' },
  { id: "badges", name: "Selos", html: '<div class="ac-row ac-wrap"><span class="ac-badge">neutro</span><span class="ac-badge ac-badge-ok">ok</span><span class="ac-badge ac-badge-warn">atenção</span><span class="ac-badge ac-badge-accent">urgente</span></div>' },
  { id: "progresso", name: "Barra de progresso", html: '<div class="ac-stack"><div class="ac-row ac-row-between"><span>Projeto</span><span class="ac-muted">60%</span></div><div class="ac-bar"><i style="width:60%"></i></div></div>' },
  { id: "tabela", name: "Tabela", html: '<table class="ac-table"><thead><tr><th>Nome</th><th>Valor</th></tr></thead><tbody><tr><td>Item A</td><td>10</td></tr><tr><td>Item B</td><td>20</td></tr></tbody></table>' },
  { id: "lista", name: "Lista", html: '<div class="ac-list"><div class="ac-row ac-row-between"><span>Primeiro</span><span class="ac-muted">hoje</span></div><div class="ac-row ac-row-between"><span>Segundo</span><span class="ac-muted">amanhã</span></div></div>' },
  { id: "abas", name: "Abas", html: '<div class="ac-tabs"><button class="ac-tab active">Geral</button><button class="ac-tab">Detalhes</button></div>' },
  { id: "modal-interno", name: "Modal dentro do bloco", html: '<div class="ac-modal-backdrop" style="position:relative;height:150px"><div class="ac-modal"><div class="ac-modal-title">Título</div><div>Conteúdo do modal.</div><div class="ac-modal-actions"><button class="ac-btn">Cancelar</button><button class="ac-btn ac-btn-primary">OK</button></div></div></div>' },
];
