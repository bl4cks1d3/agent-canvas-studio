import type { BlockPermissions } from "@agent-canvas/shared";

export interface LintInput {
  html: string;
  css: string;
  js: string;
  permissions: BlockPermissions;
}

const names = (re: RegExp, text: string): string[] => Array.from(new Set(Array.from(text.matchAll(re), (m) => m[1])));

/**
 * Consistencia de design e de dados de um componente. Nao bloqueia (o componente salva), mas devolve avisos que o
 * Claude e o usuario veem: o que quebra no isolamento, o que foge do design system e o que usa dado sem permissao.
 */
export function lintBlock(b: LintInput): string[] {
  const w: string[] = [];
  const code = `${b.js}\n${b.html}`;

  if (!/studio\s*\.\s*main\s*\(/.test(b.js)) w.push("O js não chama studio.main(async (ctx) => { ... }): sem isso o componente não carrega dados nem reage a nada.");

  // isolamento
  const blocked: Array<[RegExp, string]> = [
    [/\bfetch\s*\(|XMLHttpRequest|\bWebSocket\b|EventSource/, "rede (fetch/XHR/WebSocket): a CSP bloqueia — use ctx.records, ctx.tool ou ctx.agent.run"],
    [/localStorage|sessionStorage|indexedDB|document\.cookie/, "armazenamento do navegador: não existe no isolamento — use ctx.store (estado do componente) ou ctx.records (dados)"],
    [/(?<![.\w])(?:window\.)?(?:alert|confirm|prompt)\s*\(/, "alert/confirm/prompt: bloqueados — use ctx.ui.confirm / ctx.ui.modal / ctx.ui.toast"],
  ];
  for (const [re, msg] of blocked) if (re.test(b.js)) w.push(`Usa ${msg}.`);
  if (/\son[a-z]+\s*=\s*["']/i.test(b.html)) w.push("HTML com handler inline (onclick=…): a CSP bloqueia — use addEventListener no js.");
  if (/<script\b/i.test(b.html)) w.push("<script> dentro do html não roda — coloque o código no campo js.");
  if (/(?:src|href)\s*=\s*["']https?:/i.test(b.html) || /url\(\s*["']?https?:/i.test(b.css)) w.push("Recurso externo (imagem/fonte/link http): a CSP bloqueia — use data: URIs ou nada.");

  // design consistente: cores e fontes vindas do design system
  const hard = `${b.css}\n${b.html.match(/style\s*=\s*"[^"]*"/gi)?.join("\n") ?? ""}`;
  if (/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(hard)) w.push("Cor fixa no CSS (#hex/rgb/hsl): use as variáveis do design system (var(--ac-accent), var(--ac-fg), var(--ac-muted), var(--ac-border), var(--ac-surface), var(--ac-bg), var(--ac-danger), var(--ac-ok), var(--ac-warn)) para respeitar tema claro/escuro e o design do Studio.");
  if (/font-family\s*:/i.test(hard)) w.push("font-family fixa: o design system já define a fonte; remova para manter a consistência.");

  // dados: so o que as permissoes liberam
  const readable = new Set([...b.permissions.read, ...b.permissions.write].map((r) => r.replace(/^col:/, "")));
  const writable = new Set(b.permissions.write.map((r) => r.replace(/^col:/, "")));
  const used = names(/(?:records|data\.(?:list|create|update|remove))\s*\(\s*["'`]([a-z][a-z0-9_]*)["'`]/g, b.js);
  for (const c of used) if (!readable.has(c)) w.push(`Usa a coleção "${c}" sem permissão: adicione "col:${c}" em permissions.read (e write se gravar).`);
  const writes = names(/(?:records\s*\(\s*["'`]([a-z][a-z0-9_]*)["'`]\s*\)|data)\s*\.\s*(?:create|update|remove)\b/g, b.js);
  for (const c of writes) if (readable.has(c) && !writable.has(c)) w.push(`Grava na coleção "${c}" mas só tem leitura: adicione "col:${c}" em permissions.write.`);
  const tools = names(/ctx\s*\.\s*tool\s*\(\s*["'`]([^"'`]+)["'`]/g, b.js);
  for (const t of tools) if (!b.permissions.tools.includes(t)) w.push(`Chama a ferramenta "${t}" sem permissão: adicione em permissions.tools.`);

  if (code.length > 60_000) w.push("Componente muito grande: divida em componentes menores.");
  return w;
}
