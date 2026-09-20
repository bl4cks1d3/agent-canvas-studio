// Resumo do dia: um agente lê agenda, e-mails e tarefas pelas ferramentas conectadas. O último resumo fica salvo (ctx.store).
studio.main(async (ctx) => {
  const $ = (id) => document.getElementById(id);
  let ultimo = await ctx.store.get("ultimo", null);

  function render() {
    $("texto").textContent = ultimo ? ultimo.texto : "";
    $("quando").textContent = ultimo ? "Gerado em " + new Date(ultimo.em).toLocaleString("pt-BR") : "Nenhum resumo ainda. O agente usa as ferramentas do Google Workspace que você conectou na Biblioteca.";
  }

  $("gerar").addEventListener("click", async () => {
    const btn = $("gerar");
    btn.disabled = true;
    btn.textContent = "Gerando…";
    try {
      const r = await ctx.agent.run("resumo_do_dia", "Faça o resumo do meu dia.");
      if (r.status === "ok" && r.result) {
        ultimo = { texto: r.result, em: new Date().toISOString() };
        await ctx.store.set("ultimo", ultimo);
      } else {
        ctx.ui.toast("Não foi possível gerar o resumo: " + (r.error || r.status), "warn");
      }
    } catch (err) {
      ctx.ui.toast(err.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Gerar resumo do dia";
      render();
    }
  });

  render();
});
