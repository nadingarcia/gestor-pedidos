// Linha de complemento: "+ Bacon", mas "Sem Feijão" sem o "+"
// (grupos "já vem no prato" do cardápio mandam só o que o cliente tirou),
// e "Marmita 1: Bife · Sem Feijão" (combo) também vai sem "+".
export const linhaComplemento = (texto = '') => {
  const t = String(texto)
  return /^sem\s/i.test(t) || t.includes(': ') ? t : `+ ${t}`
}
