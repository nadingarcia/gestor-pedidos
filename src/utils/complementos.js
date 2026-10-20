// Linha de complemento: "+ Bacon", mas "Sem Feijão" sem o "+"
// (grupos "já vem no prato" do cardápio mandam só o que o cliente tirou).
export const linhaComplemento = (texto = '') => {
  const t = String(texto)
  return /^sem\s/i.test(t) ? t : `+ ${t}`
}
