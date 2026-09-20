#!/usr/bin/env node
// Reinstala o padrão de fábrica que faltar (bibliotecas, componentes, páginas). Não remove nem altera nada já instalado.
//   node scripts/factory-restore.mjs        (servidor no ar em SERVER_URL, padrão http://localhost:5100)
const S = (process.env.SERVER_URL ?? "http://localhost:5100").replace(/\/$/, "");

try {
  const before = await (await fetch(`${S}/factory`)).json();
  console.log("Padrão de fábrica:");
  for (const p of before.packages) console.log(`  ${p.installed ? "✔" : "·"} ${p.id}${p.available ? "" : "  (não encontrado na biblioteca)"}`);
  const res = await fetch(`${S}/factory/restore`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  const r = await res.json();
  if (!res.ok) throw new Error(Array.isArray(r.message) ? r.message.join("; ") : (r.message ?? res.status));
  console.log(`\nInstalados agora: ${r.installed.join(", ") || "nenhum (já estava tudo)"}`);
  if (r.failed.length) {
    console.error(`Falharam: ${r.failed.map((f) => `${f.id} (${f.error})`).join("; ")}`);
    process.exit(1);
  }
} catch (err) {
  console.error(`✖ ${err instanceof Error ? err.message : err}\n  O servidor está no ar? (pnpm dev)`);
  process.exit(1);
}
