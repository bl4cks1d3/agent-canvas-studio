// CRM: indicadores calculados a partir de crm_negocios (e a contagem de crm_contatos).
studio.main(async (ctx) => {
  const ETAPAS = [["lead", "Lead"], ["contato", "Contato"], ["proposta", "Proposta"], ["negociacao", "Negociação"], ["ganho", "Ganho"], ["perdido", "Perdido"]];
  const ABERTAS = ["lead", "contato", "proposta", "negociacao"];
  const brl = (n) => Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const etapaDe = (n) => n.etapa || "lead";
  const soma = (lista) => lista.reduce((s, n) => s + (Number(n.valor) || 0), 0);

  const [negocios, contatos] = await Promise.all([ctx.records("crm_negocios").list(), ctx.records("crm_contatos").list()]);
  const abertos = negocios.filter((n) => ABERTAS.includes(etapaDe(n)));
  const ganhos = negocios.filter((n) => etapaDe(n) === "ganho");
  const perdidos = negocios.filter((n) => etapaDe(n) === "perdido");
  const encerrados = ganhos.length + perdidos.length;
  const taxa = encerrados ? Math.round((ganhos.length / encerrados) * 100) + "%" : "—";
  const maior = Math.max(1, ...ETAPAS.map(([k]) => negocios.filter((n) => etapaDe(n) === k).length));

  const card = (titulo, valor, nota) =>
    '<div class="ac-card"><div class="ac-subtitle">' + titulo + '</div><div class="ac-big">' + valor + '</div><div class="ac-muted">' + nota + "</div></div>";

  const barras = ETAPAS.map(([k, rotulo]) => {
    const lista = negocios.filter((n) => etapaDe(n) === k);
    return (
      '<div class="stage"><span>' + rotulo + '</span><div class="ac-bar"><i style="width:' + Math.round((lista.length / maior) * 100) + '%"></i></div>' +
      '<span class="ac-muted">' + lista.length + " · " + brl(soma(lista)) + "</span></div>"
    );
  }).join("");

  ctx.root.innerHTML =
    '<div class="kpi"><div class="cards">' +
    card("Em aberto", brl(soma(abertos)), abertos.length + (abertos.length === 1 ? " negócio no funil" : " negócios no funil")) +
    card("Ganho", brl(soma(ganhos)), ganhos.length + (ganhos.length === 1 ? " negócio fechado" : " negócios fechados")) +
    card("Taxa de conversão", taxa, encerrados ? ganhos.length + " ganhos de " + encerrados + " encerrados" : "sem negócios encerrados") +
    card("Contatos", String(contatos.length), "na base") +
    '</div><div><div class="ac-subtitle">Negócios por etapa</div>' + barras + "</div></div>";
});
